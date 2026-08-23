/**
 * core/initvar.ts
 *
 * 从 MagVarUpdate 上游 `src/function/initvar/variable_init.ts` 的纯函数部分移植。
 * 保留 createEmptyGameData、loadInitVarData 的内核逻辑与 merge 语义；
 * 世界书读取（getLorebookEntries / getCharLorebooks）由宿主通过 InitSourceAdapter 提供，
 * 见 PATCHES core-14。上层聊天/swipe 生命周期由宿主 MessageLifecycleAdapter 接管，不在核心内。
 */

import { EXTENSIBLE_MARKER, generateSchema, cleanUpMetadata } from './schema';
import { isObjectSchema, MvuData, ObjectSchemaNode, RootAdditionalProps } from './variable-def';
import { correctlyMerge } from '../port/merge';
import { parseString } from '../port/structured-parser';
import { has, isObject, klona } from '../port/util';

export interface LorebookEntry {
  content: string;
  comment?: string;
}

/**
 * 初始变量数据来源适配器（PATCHES core-14）。
 * 宿主实现提供每个待初始化世界书/源的条目列表；核心只负责解析与合并。
 */
export interface InitSourceAdapter {
  /** 返回要参与初始化的源名称列表（如世界书名）。 */
  getEnabledLorebookList(): Promise<string[]>;
  /** 返回指定源的全部条目。 */
  getLorebookEntries(lorebook: string): Promise<LorebookEntry[]>;
  /** 宏替换（可选）。 */
  substituteMacros?(content: string): string;
}

/**
 * 创建一个新的空 MvuData 对象。
 */
export function createEmptyGameData(): MvuData {
  return {
    display_data: {},
    initialized_lorebooks: {},
    stat_data: {},
    delta_data: {},
    schema: {
      type: 'object',
      properties: {},
    },
  };
}

/**
 * 从所有启用的 initvar 条目加载初始变量并合并到 mvu_data。
 * 返回是否有数据被更新。
 */
export async function loadInitVarData(
  mvu_data: MvuData,
  source: InitSourceAdapter
): Promise<boolean> {
  const enabled = await source.getEnabledLorebookList();
  let is_updated = false;

  if (!mvu_data.initialized_lorebooks || Array.isArray(mvu_data.initialized_lorebooks)) {
    mvu_data.initialized_lorebooks = {};
  }

  for (const currentLorebook of enabled) {
    if (has(mvu_data.initialized_lorebooks, currentLorebook)) continue;
    mvu_data.initialized_lorebooks[currentLorebook] = [];
    try {
      const initEntries = (await source.getLorebookEntries(currentLorebook)) as LorebookEntry[];
      const mergedData: Record<string, unknown> = {};
      for (const entry of initEntries) {
        if (entry.comment?.toLowerCase().includes('[initvar]')) {
          const xmlMatch = entry.content.trim().match(/.*<initvar>.*\n([\s\S]*)\n.*<\/initvar>.*/m);
          if (xmlMatch) {
            entry.content = xmlMatch[1];
          }
          const codeblockMatch = entry.content.trim().match(/```.*\n([\s\S]*)\n```/m);
          if (codeblockMatch) {
            entry.content = codeblockMatch[1];
          }
          const content = source.substituteMacros
            ? source.substituteMacros(entry.content)
            : entry.content;
          try {
            const parsedData = parseString(content);
            if (parsedData) {
              correctlyMerge(mergedData, parsedData);
            }
          } catch (e) {
            console.error(
              `initvar entry parse failed: ${entry.comment ?? ''} (${String(e)})`
            );
            throw e;
          }
        }
      }
      mvu_data.stat_data = { ...mergedData, ...mvu_data.stat_data } as MvuData['stat_data'];
      is_updated = true;
    } catch (e) {
      console.error(e);
    }
  }

  return is_updated;
}

/**
 * 在数据初始化后生成最终 schema。对齐上游 variable_init 的收尾逻辑：
 * 当 is_updated 或 schema 缺失/为空时，克隆数据生成 schema，读回 $meta 根选项，写回变量。
 */
export function finalizeInitSchema(
  variables: MvuData,
  isUpdated: boolean
): void {
  if (isUpdated || !variables.schema || isEmpty(variables.schema)) {
    const dataForSchema = klona(variables.stat_data);
    const generatedSchema: ObjectSchemaNode & RootAdditionalProps = generateSchema(
      dataForSchema,
      variables.schema
    ) as ObjectSchemaNode & RootAdditionalProps;

    if (isObjectSchema(generatedSchema)) {
      if (has(variables.stat_data, '$meta.strictTemplate'))
        generatedSchema.strictTemplate = variables.stat_data['$meta']?.strictTemplate as boolean;
      if (has(variables.stat_data, '$meta.concatTemplateArray'))
        generatedSchema.concatTemplateArray = variables.stat_data['$meta']
          ?.concatTemplateArray as boolean;
      if (has(variables.stat_data, '$meta.strictSet'))
        generatedSchema.strictSet = variables.stat_data['$meta']?.strictSet as boolean;
      variables.schema = generatedSchema;
    }
    cleanUpMetadata(variables.stat_data);
  }
}

// 供 finalizeInitSchema 使用的空对象判断
export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isObject(value)) return Object.keys(value).length === 0;
  return false;
}

export { EXTENSIBLE_MARKER };
