/**
 * core/command-executor.ts
 *
 * 从 MagVarUpdate 上游 `src/function/update_variables.ts` 的执行部分移植。
 * 保留 set/insert/delete/add 的执行语义、VWD(ValueWithDescription)、模板、schema 调和、
 * display_data/delta_data 与事件时序。
 *
 * 同时在入口接入安全修订：
 *   - core-12：输入预算（文本大小 / 命令条数 / 值大小 / 嵌套深度）
 *   - core-11：路径保护（危险键、保留字段、层级、长度）
 *   - move：返回明确错误 MVU_MOVE_UNSUPPORTED（上游执行器无 move 分支）
 *   - commands 由 parseCommandValue 解析值（受限数学，无 new Function，见 core-10/13）
 */

import { klona, get, set, has, unset, isObject, isEqual, merge, concat, toPath as toPathLocal } from '../port/util';
import {
  parseCommandValue,
  trimQuotesAndBackslashes,
} from '../port/structured-parser';
import { guardPath, guardMessageSize, guardCommandCount } from '../port/security-guard';
import { errorCatalog } from '../port/error-catalog';
import {
  assertVWD,
  isArraySchema,
  isObjectSchema,
  isValueWithDescriptionStatData,
  MvuData,
  TemplateType,
  UpdateContext,
  variable_events,
} from './variable-def';
import { getSchemaForPath, generateSchema, reconcileAndApplySchema, cleanUpMetadata } from './schema';
import { extractCommands, pathFix } from './command-parser';
import type { EventArgs, MvuEventBus } from './events';
import type { MvuPortContext } from '../port/context';

/** 执行器依赖：事件总线与宿主上下文。 */
export interface CommandExecutorHooks {
  bus: MvuEventBus;
  port: MvuPortContext;
}

/** 单步执行错误信息（供宿主选择呈现方式）。 */
export interface MvuExecutionError {
  code: string;
  message: string;
  command?: string;
}

export function applyTemplate(
  value: any,
  template: TemplateType | undefined,
  strict_array_cast: boolean = false,
  array_merge_concat: boolean = true
): any {
  if (!template) {
    return value;
  }

  const value_is_object = isObject(value) && !Array.isArray(value) && !(value instanceof Date);
  const value_is_array = Array.isArray(value);
  const template_is_array = Array.isArray(template);

  if (value_is_object && !template_is_array) {
    return merge({}, template, value) as any;
  } else if (value_is_array && template_is_array) {
    if (array_merge_concat) return concat(value as any[], template as any[]) as any;
    return merge([] as unknown as Record<string, unknown>, template, value) as any;
  } else if (
    ((value_is_object || value_is_array) && template_is_array !== value_is_array) ||
    (!value_is_object && !value_is_array && isObject(template) && !Array.isArray(template))
  ) {
    console.error(
      `Template type mismatch: template is ${template_is_array ? 'array' : 'object'}, but value is ${value_is_array ? 'array' : 'object'}. Skipping template merge.`
    );
    return value;
  } else if (!value_is_object && !value_is_array && template_is_array) {
    if (strict_array_cast) return value;
    if (array_merge_concat) return concat([value] as any[], template as any[]) as any;
    return merge([] as unknown as Record<string, unknown>, template, [value]) as any;
  } else {
    return value;
  }
}

/** 命令执行前的路径修复（与上游一致；JSON Patch 路径跳过修复）。 */
function pathFixPass(_unused: MvuData, commands: any[], _unusedContent: string): void {
  for (const command of commands) {
    if (command.reason === 'json_patch') continue;
    command.args[0] = pathFix(trimQuotesAndBackslashes(command.args[0]));
  }
}

function isNullOrWhiteSpace(str: string): boolean {
  return str == null || str.trim().length === 0;
}

/** 把路径段数组序列化为 lodash bracket 形式（供容器路径拼接）。 */
function pathSegmentsToLodashPath(segments: string[]): string {
  return segments.map((s) => `["${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`).join('');
}

export async function updateVariablesWithSecurity(
  currentMessageContent: string,
  variables: MvuData,
  hooks: CommandExecutorHooks
): Promise<{ modified: boolean; errors: MvuExecutionError[] }> {
  const { bus, port } = hooks;
  const errors: MvuExecutionError[] = [];
  const emit = (event: string, args: EventArgs) => bus.emit(event, args);

  // ---- core-12 输入预算 ----
  const sizeCheck = guardMessageSize(currentMessageContent);
  if (!sizeCheck.ok) {
    errors.push(errorCatalog.build(sizeCheck.code!) as MvuExecutionError);
    return { modified: false, errors };
  }

  const variables_before_update: MvuData = klona(variables);
  const out_status: MvuData = klona(variables);
  const delta_status: Partial<MvuData> = { stat_data: {} };

  const macros = {};
  const processed_message_content = port.substituteMacros
    ? port.substituteMacros(currentMessageContent, macros)
    : currentMessageContent;

  const commands = extractCommands(processed_message_content);

  const commandCount = guardCommandCount(commands.length);
  if (!commandCount.ok) {
    errors.push(errorCatalog.build(commandCount.code!) as MvuExecutionError);
    return { modified: false, errors };
  }

  // ---- 触发 VARIABLE_UPDATE_STARTED ----
  set(variables.stat_data, '$internal', {
    display_data: out_status.stat_data,
    delta_data: (delta_status.stat_data || {}) as Record<string, unknown>,
  });
  emit(variable_events.VARIABLE_UPDATE_STARTED, {
    kind: 'variables',
    payload: variables,
  });

  let errorInfo: MvuExecutionError | undefined;
  let currentCommand: any;
  const outError = (code: string, params?: Record<string, unknown>, command?: string) => {
    const entry = errorCatalog.build(code, params);
    const error = { code: entry.code, message: entry.message, command: command ?? currentCommand?.full_match };
    errors.push(error);
    errorInfo = error;
  };

  const schema = variables.schema;
  const strict_template = schema?.strictTemplate ?? false;
  const concat_template_array = schema?.concatTemplateArray ?? true;
  const strict_set = schema?.strictSet ?? false;

  // 处理别名
  for (const cmd of commands) {
    if (cmd.type === 'remove') {
      cmd.type = 'delete';
    } else if (cmd.type === 'assign') {
      cmd.type = 'insert';
    } else if (cmd.type === 'unset') {
      cmd.type = 'delete';
    }
  }

  emit(variable_events.COMMAND_PARSED, {
    kind: 'commands',
    variables,
    commands,
    messageContent: currentMessageContent,
  });
  emit(`${variable_events.COMMAND_PARSED}_for_zod`, {
    kind: 'commands',
    variables,
    commands,
    messageContent: currentMessageContent,
  });
  emit(`${variable_events.COMMAND_PARSED}_ended_for_zod`, {
    kind: 'commands',
    variables,
    commands,
    messageContent: currentMessageContent,
  });

  pathFixPass(variables, commands, currentMessageContent);

  for (const command of commands) {
    const path = command.args[0];
    const reason_str = command.reason ? `(${command.reason})` : '';
    let display_str = '';
    currentCommand = command;

    // ---- core-11 路径保护（json_patch 路径已编码，只对命令路径校验）----
    if (command.type !== 'move') {
      const guard = guardPath(path ?? '');
      if (!guard.ok) {
        outError(guard.code, guard.detail as Record<string, unknown>);
        continue;
      }
    }

    switch (command.type) {
      case 'move': {
        outError('MVU_MOVE_UNSUPPORTED');
        continue;
      }
      case 'set': {
        if (path !== '' && !has(variables.stat_data, path)) {
          outError('MVU_SET_PATH_MISSING', { path, reason: reason_str });
          continue;
        }

        let oldValue: any = path === '' ? klona(variables.stat_data) : get(variables.stat_data, path);
        let newValue = parseCommandValue(command.args.at(-1)!);

        if (newValue instanceof Date) {
          newValue = newValue.toISOString();
        }

        let isPathVWD = false;
        if (
          !strict_set &&
          Array.isArray(oldValue) &&
          oldValue.length === 2 &&
          typeof oldValue[1] === 'string' &&
          !Array.isArray(oldValue[0])
        ) {
          const oldValueCopy = klona(oldValue[0]);
          oldValue[0] =
            typeof oldValue[0] === 'number' && newValue !== null
              ? Number(newValue)
              : newValue;
          oldValue = oldValueCopy;
          isPathVWD = true;
        } else if (
          typeof oldValue === 'number' &&
          newValue !== null &&
          typeof newValue === 'string'
        ) {
          set(variables.stat_data, path, Number(newValue));
        } else if (path) {
          set(variables.stat_data, path, newValue);
        } else {
          variables.stat_data = newValue as MvuData['stat_data'];
        }

        let finalNewValue: any = path === '' ? variables.stat_data : get(variables.stat_data, path);
        assertVWD(isPathVWD, finalNewValue as never);
        if (isPathVWD) {
          finalNewValue = Array.isArray(finalNewValue) ? finalNewValue[0] : finalNewValue;
        }

        const isStrict = !strict_set;
        if (
          isStrict &&
          isValueWithDescriptionStatData(oldValue as never) &&
          Array.isArray(finalNewValue)
        ) {
          display_str = `${trimQuotesAndBackslashes(JSON.stringify(oldValue[0]))}->${trimQuotesAndBackslashes(JSON.stringify(finalNewValue[0]))} ${reason_str}`;
        } else {
          display_str = `${trimQuotesAndBackslashes(JSON.stringify(oldValue))}->${trimQuotesAndBackslashes(JSON.stringify(finalNewValue))} ${reason_str}`;
        }

        console.info(`Set '${path}' to '${JSON.stringify(finalNewValue)}' ${reason_str}`);

        emit(variable_events.SINGLE_VARIABLE_UPDATED, {
          kind: 'single_variable',
          statData: variables.stat_data,
          path,
          oldValue,
          newValue: finalNewValue,
        });
        break;
      }

      case 'insert': {
        const targetPath = path;
        const existingValue =
          targetPath === '' ? variables.stat_data : get(variables.stat_data, targetPath);
        const targetSchema = getSchemaForPath(schema, targetPath);

        // 验证1：目标是否为原始类型？
        if (existingValue !== null && !Array.isArray(existingValue) && !isObject(existingValue)) {
          outError('MVU_ASSIGN_PRIMITIVE', {
            path: targetPath,
            type: typeof existingValue,
            reason: reason_str,
          });
          continue;
        }

        // 验证2：Schema 规则
        if (targetSchema) {
          if (targetSchema.type === 'object' && targetSchema.extensible === false) {
            if (command.args.length === 2) {
              outError('MVU_ASSIGN_NON_EXTENSIBLE_OBJECT', { path: targetPath, reason: reason_str });
              continue;
            }
            if (command.args.length >= 3) {
              const newKey = String(parseCommandValue(command.args[1]));
              if (!has(targetSchema.properties, newKey)) {
                outError('MVU_ASSIGN_UNKNOWN_KEY', {
                  key: newKey,
                  path: targetPath,
                  reason: reason_str,
                });
                continue;
              }
            }
          } else if (
            targetSchema.type === 'array' &&
            (targetSchema.extensible === false || targetSchema.extensible === undefined)
          ) {
            outError('MVU_ASSIGN_NON_EXTENSIBLE_ARRAY', { path: targetPath, reason: reason_str });
            continue;
          }
        } else if (
          targetPath !== '' &&
          !get(variables.stat_data, pathSegmentsToLodashPath(toPathLocal(targetPath).slice(0, -1)))
        ) {
          outError('MVU_ASSIGN_MISSING_PARENT', { path: targetPath, reason: reason_str });
          continue;
        }

        const oldValue: any = klona(existingValue);
        let successful = false;

        if (command.args.length === 2) {
          let valueToAssign = parseCommandValue(command.args[1]);
          if (valueToAssign instanceof Date) {
            valueToAssign = valueToAssign.toISOString();
          } else if (Array.isArray(valueToAssign)) {
            valueToAssign = valueToAssign.map((item) =>
              item instanceof Date ? item.toISOString() : item
            );
          }

          let collection = targetPath === '' ? variables.stat_data : get(variables.stat_data, path);
          if (!Array.isArray(collection) && !isObject(collection)) {
            collection = Array.isArray(valueToAssign) ? [] : {};
            set(variables.stat_data, path, collection);
          }

          if (Array.isArray(collection)) {
            const template =
              targetSchema && isArraySchema(targetSchema) ? targetSchema.template : undefined;
            valueToAssign = applyTemplate(
              valueToAssign,
              template,
              strict_template,
              concat_template_array
            );
            collection.push(valueToAssign);
            display_str = `ASSIGNED ${JSON.stringify(valueToAssign)} into array '${path}' ${reason_str}`;
            successful = true;
          } else if (isObject(collection)) {
            if (isObject(valueToAssign) && !Array.isArray(valueToAssign)) {
              merge(collection as Record<string, unknown>, valueToAssign);
              display_str = `MERGED object ${JSON.stringify(valueToAssign)} into object '${path}' ${reason_str}`;
              successful = true;
            } else {
              outError(
                Array.isArray(valueToAssign)
                  ? 'MVU_ASSIGN_MERGE_ARRAY_INTO_OBJECT'
                  : 'MVU_ASSIGN_MERGE_NON_OBJECT_INTO_OBJECT',
                { path }
              );
              continue;
            }
          }
        } else if (command.args.length >= 3) {
          let valueToAssign = parseCommandValue(command.args[2]);
          const keyOrIndex = parseCommandValue(command.args[1]);
          if (valueToAssign instanceof Date) {
            valueToAssign = valueToAssign.toISOString();
          } else if (Array.isArray(valueToAssign)) {
            valueToAssign = valueToAssign.map((item) =>
              item instanceof Date ? item.toISOString() : item
            );
          }

          let collection = targetPath === '' ? variables.stat_data : get(variables.stat_data, path);
          const template =
            targetSchema && (isArraySchema(targetSchema) || isObjectSchema(targetSchema))
              ? targetSchema.template
              : undefined;

          if (Array.isArray(collection) && (typeof keyOrIndex === 'number' || keyOrIndex === '-')) {
            const insertIndex = keyOrIndex === '-' ? collection.length : (keyOrIndex as number);
            const positionLabel = keyOrIndex === '-' || keyOrIndex === -1 ? 'tail' : keyOrIndex;
            valueToAssign = applyTemplate(
              valueToAssign,
              template,
              strict_template,
              concat_template_array
            );
            collection.splice(insertIndex, 0, valueToAssign);
            display_str = `ASSIGNED ${JSON.stringify(valueToAssign)} into '${path}' at index ${positionLabel} ${reason_str}`;
            successful = true;
          } else if (isObject(collection)) {
            valueToAssign = applyTemplate(
              valueToAssign,
              template,
              strict_template,
              concat_template_array
            );
            (collection as Record<string, unknown>)[String(keyOrIndex)] = valueToAssign;
            display_str = `ASSIGNED key '${keyOrIndex}' with value ${JSON.stringify(valueToAssign)} into object '${path}' ${reason_str}`;
            successful = true;
          } else {
            collection = {};
            set(variables.stat_data, path, collection);
            valueToAssign = applyTemplate(
              valueToAssign,
              template,
              strict_template,
              concat_template_array
            );
            (collection as Record<string, unknown>)[String(keyOrIndex)] = valueToAssign;
            display_str = `CREATED object at '${path}' and ASSIGNED key '${keyOrIndex}' ${reason_str}`;
            successful = true;
          }
        }

        if (successful) {
          const newValue = isNullOrWhiteSpace(path)
            ? variables.stat_data
            : get(variables.stat_data, path);
          console.info(display_str);
          emit(variable_events.SINGLE_VARIABLE_UPDATED, {
            kind: 'single_variable',
            statData: variables.stat_data,
            path,
            oldValue,
            newValue,
          });
          try {
            const currentDataClone = klona(newValue);
            const newSchema = generateSchema(currentDataClone, targetSchema ?? undefined);
            if (targetSchema) {
              merge(targetSchema as Record<string, unknown>, newSchema as Record<string, unknown>);
            }
            cleanUpMetadata(newValue);
          } catch (error) {
            outError('MVU_TEMPLATE_RESOLUTION_FAILED', {
              path,
              cause: error instanceof Error ? error.message : String(error),
            });
          }
        } else {
          outError('MVU_ASSIGN_INVALID_ARGUMENTS', { path });
          continue;
        }
        break;
      }

      case 'delete': {
        const pathParts = toPathLocal(path);
        const lastPart = pathParts[pathParts.length - 1];
        const isArrayElementPath = /^\d+$/.test(lastPart as string);

        if (command.args.length === 1 && isArrayElementPath) {
          const containerPath = pathSegmentsToLodashPath(pathParts.slice(0, -1));
          const container = get(variables.stat_data, containerPath) as unknown[];
          const indexToRemove = parseInt(lastPart as string, 10);
          if (Array.isArray(container) && indexToRemove < container.length) {
            const originalArray = klona(container);
            container.splice(indexToRemove, 1);
            display_str = `REMOVED item from '${containerPath}' at index ${indexToRemove} ${reason_str}`;
            console.info(display_str);
            emit(variable_events.SINGLE_VARIABLE_UPDATED, {
              kind: 'single_variable',
              statData: variables.stat_data,
              path: containerPath,
              oldValue: originalArray,
              newValue: container,
            });
            continue;
          }
        }

        if (!has(variables.stat_data, path)) {
          outError('MVU_REMOVE_PATH_UNDEFINED', { path });
          continue;
        }

        let containerPath = path;
        let keyOrIndexToRemove: string | number | undefined;

        if (command.args.length > 1) {
          keyOrIndexToRemove = parseCommandValue(command.args[1]) as string | number;
          if (typeof keyOrIndexToRemove === 'string') {
            keyOrIndexToRemove = trimQuotesAndBackslashes(keyOrIndexToRemove);
          }
        } else {
          const pp = toPathLocal(path);
          const last = pp.pop() as string | undefined;
          if (last) {
            keyOrIndexToRemove = /^\d+$/.test(last) ? Number(last) : last;
            containerPath = pathSegmentsToLodashPath(pp);
          }
        }

        if (keyOrIndexToRemove === undefined) {
          outError('MVU_REMOVE_TARGET_UNDETERMINED', { path, reason: reason_str });
          continue;
        }

        if (containerPath !== '' && !has(variables.stat_data, containerPath)) {
          outError('MVU_REMOVE_PATH_MISSING', { path: containerPath, reason: reason_str });
          continue;
        }

        const containerSchema = getSchemaForPath(schema, containerPath);
        if (containerSchema) {
          if (containerSchema.type === 'array') {
            if (containerSchema.extensible !== true) {
              outError('MVU_REMOVE_NON_EXTENSIBLE_ARRAY', {
                path: containerPath,
                reason: reason_str,
              });
              continue;
            }
          } else if (containerSchema.type === 'object') {
            const keyString = String(keyOrIndexToRemove);
            if (
              has(containerSchema.properties, keyString) &&
              containerSchema.properties[keyString].required === true
            ) {
              outError('MVU_REMOVE_REQUIRED_KEY', {
                key: keyString,
                path: containerPath,
                reason: reason_str,
              });
              continue;
            }
          }
        }

        const targetToRemove =
          command.args.length > 1 ? parseCommandValue(command.args[1]) : undefined;
        let itemRemoved = false;

        if (targetToRemove === undefined) {
          const oldValue = get(variables.stat_data, path);
          unset(variables.stat_data, path);
          display_str = `REMOVED path '${path}' ${reason_str}`;
          itemRemoved = true;
          emit(variable_events.SINGLE_VARIABLE_UPDATED, {
            kind: 'single_variable',
            statData: variables.stat_data,
            path,
            oldValue,
            newValue: undefined,
          });
        } else {
          const collection = get(variables.stat_data, path);
          if (!Array.isArray(collection) && !isObject(collection)) {
            outError('MVU_REMOVE_NON_COLLECTION', { path, reason: reason_str });
            continue;
          }

          if (Array.isArray(collection)) {
            const originalArray = klona(collection);
            let indexToRemove = -1;
            if (typeof targetToRemove === 'number') {
              indexToRemove = targetToRemove;
            } else {
              indexToRemove = collection.findIndex((item) => isEqual(item, targetToRemove));
            }
            if (indexToRemove >= 0 && indexToRemove < collection.length) {
              collection.splice(indexToRemove, 1);
              itemRemoved = true;
              display_str = `REMOVED item from '${path}' ${reason_str}`;
              emit(variable_events.SINGLE_VARIABLE_UPDATED, {
                kind: 'single_variable',
                statData: variables.stat_data,
                path,
                oldValue: originalArray,
                newValue: collection,
              });
            }
          } else if (isObject(collection)) {
            if (typeof targetToRemove === 'number') {
              const keys = Object.keys(collection);
              const index = targetToRemove;
              if (index >= 0 && index < keys.length) {
                const keyToRemove = keys[index];
                unset(collection as Record<string, unknown>, keyToRemove);
                itemRemoved = true;
                display_str = `REMOVED ${index + 1}th entry ('${keyToRemove}') from object '${path}' ${reason_str}`;
              }
            } else {
              const keyToRemove = String(targetToRemove);
              if (has(collection, keyToRemove)) {
                delete (collection as Record<string, unknown>)[keyToRemove];
                itemRemoved = true;
                display_str = `REMOVED key '${keyToRemove}' from object '${path}' ${reason_str}`;
              }
            }
          }
        }

        if (!itemRemoved) {
          outError('MVU_REMOVE_FAILED', { path });
          continue;
        }
        console.info(display_str);
        break;
      }

      case 'add': {
        if (!has(variables.stat_data, path)) {
          outError('MVU_ADD_PATH_MISSING', { path, reason: reason_str });
          continue;
        }
        const initialValue = klona(get(variables.stat_data, path)) as any;
        const oldValue: any = get(variables.stat_data, path);
        let valueToAdd: any = oldValue;
        const isVWD = isValueWithDescriptionStatData(oldValue as never) && typeof oldValue[0] !== 'object';

        if (isVWD) {
          assertVWD(isVWD, oldValue as never);
          valueToAdd = oldValue[0];
        }

        let potentialDate: Date | null = null;
        if (valueToAdd instanceof Date) {
          potentialDate = valueToAdd;
        } else if (typeof valueToAdd === 'string') {
          const parsedDate = new Date(valueToAdd);
          if (!isNaN(parsedDate.getTime()) && isNaN(Number(valueToAdd))) {
            potentialDate = parsedDate;
          }
        }

        if (command.args.length === 2) {
          const delta = parseCommandValue(command.args[1]);

          if (potentialDate) {
            if (typeof delta !== 'number') {
              outError('MVU_ADD_DATE_DELTA_NOT_NUMBER', {
                delta: command.args[1],
                reason: reason_str,
              });
              continue;
            }
            const newDate = new Date(potentialDate.getTime() + delta);
            const finalValueToSet = newDate.toISOString();
            if (isVWD) {
              assertVWD(isVWD, oldValue as never);
              oldValue[0] = finalValueToSet;
              set(variables.stat_data, path, oldValue);
            } else {
              set(variables.stat_data, path, finalValueToSet);
            }
            const finalNewValue = get(variables.stat_data, path);
            display_str = isVWD
              ? `${JSON.stringify((initialValue as any[])[0])}->${JSON.stringify((finalNewValue as any[])[0])} ${reason_str}`
              : `${JSON.stringify(initialValue)}->${JSON.stringify(finalNewValue)} ${reason_str}`;
            console.info(
              `ADDED date '${path}' from '${potentialDate.toISOString()}' to '${newDate.toISOString()}' by delta '${delta}'ms ${reason_str}`
            );
            emit(variable_events.SINGLE_VARIABLE_UPDATED, {
              kind: 'single_variable',
              statData: variables.stat_data,
              path,
              oldValue: initialValue,
              newValue: finalNewValue,
            });
          } else if (typeof valueToAdd === 'number') {
            if (typeof delta !== 'number') {
              outError('MVU_ADD_DELTA_NOT_NUMBER', { delta: command.args[1], reason: reason_str });
              continue;
            }
            let newValue = valueToAdd + delta;
            newValue = parseFloat(newValue.toPrecision(12));
            if (isVWD) {
              oldValue[0] = newValue;
              set(variables.stat_data, path, oldValue);
            } else {
              set(variables.stat_data, path, newValue);
            }
            const finalNewValue = get(variables.stat_data, path);
            display_str = isVWD
              ? `${JSON.stringify((initialValue as any[])[0])}->${JSON.stringify((finalNewValue as any[])[0])} ${reason_str}`
              : `${JSON.stringify(initialValue)}->${JSON.stringify(finalNewValue)} ${reason_str}`;
            console.info(
              `ADDED number '${path}' from '${valueToAdd}' to '${newValue}' by delta '${delta}' ${reason_str}`
            );
            emit(variable_events.SINGLE_VARIABLE_UPDATED, {
              kind: 'single_variable',
              statData: variables.stat_data,
              path,
              oldValue: initialValue,
              newValue: finalNewValue,
            });
          } else {
            outError('MVU_ADD_UNSUPPORTED_VALUE', { path, reason: reason_str });
            continue;
          }
        } else {
          outError('MVU_ADD_INVALID_ARGUMENTS', { path, reason: reason_str });
          continue;
        }
        break;
      }

      default:
        outError('MVU_UNKNOWN_COMMAND');
        break;
    }

    if (display_str) {
      set(out_status.stat_data, path, display_str);
      set(delta_status.stat_data!, path, display_str);
    }
  }

  variables.display_data = out_status.stat_data;
  variables.delta_data = delta_status.stat_data!;
  emit(variable_events.VARIABLE_UPDATE_ENDED, {
    kind: 'variables_pair',
    variables,
    variablesBeforeUpdate: variables_before_update,
  });
  unset(variables.stat_data, '$internal');

  const is_modified = !isEqual(variables.stat_data, variables_before_update.stat_data);
  if (is_modified) {
    reconcileAndApplySchema(variables);
  }

  emit(`${variable_events.VARIABLE_UPDATE_ENDED}_for_zod`, {
    kind: 'variables_pair',
    variables,
    variablesBeforeUpdate: variables_before_update,
  });

  return { modified: is_modified, errors };
}
