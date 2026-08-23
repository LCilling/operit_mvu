/**
 * port/error-catalog.ts
 *
 * 稳定错误码与文案目录，替代上游对 `tr()`（i18n）和 toastr 的依赖。
 * 核心只依赖 `ErrorCatalog.build(code, params)` 返回的 `{ code, message }`，
 * 由宿主决定如何呈现（UI 提示 / 诊断包 / 日志）。
 *
 * 错误码约定：`MVU_<SNAKE_CASE>`。所有错误码唯一、稳定，写入测试。
 */

export interface MvuErrorEntry {
  code: string;
  /** zh 文案，可含 {placeholder} 占位符。 */
  message: string;
}

const CATALOG: Record<string, MvuErrorEntry> = {
  // path 保护（core-11）
  MVU_PATH_DANGEROUS_KEY: { code: 'MVU_PATH_DANGEROUS_KEY', message: '危险路径键：{key}' },
  MVU_PATH_RESERVED_FIELD: { code: 'MVU_PATH_RESERVED_FIELD', message: '路径写入保留字段：{field}' },
  MVU_PATH_TOO_DEEP: { code: 'MVU_PATH_TOO_DEEP', message: '路径层级超过上限（max {max} 层）' },
  MVU_PATH_TOO_LONG: { code: 'MVU_PATH_TOO_LONG', message: '路径长度超过上限（max {max} 字符）' },

  // 输入预算（core-12）
  MVU_INPUT_TOO_LARGE: { code: 'MVU_INPUT_TOO_LARGE', message: '更新文本超过上限（max {maxBytes} KiB）' },
  MVU_TOO_MANY_COMMANDS: { code: 'MVU_TOO_MANY_COMMANDS', message: '命令数量超过上限（max {max} 条）' },
  MVU_VALUE_TOO_LARGE: { code: 'MVU_VALUE_TOO_LARGE', message: '单个结构化值超过上限（max {maxBytes} KiB）' },
  MVU_NEST_TOO_DEEP: { code: 'MVU_NEST_TOO_DEEP', message: '解析嵌套超过上限（max {max} 层）' },

  // 数学求值（core-13）
  MVU_MATH_EXPR_NOT_ALLOWED: { code: 'MVU_MATH_EXPR_NOT_ALLOWED', message: '含不允许的数学节点：{token}' },

  // move 不支持
  MVU_MOVE_UNSUPPORTED: { code: 'MVU_MOVE_UNSUPPORTED', message: 'move 命令暂不支持' },

  // set
  MVU_SET_PATH_MISSING: { code: 'MVU_SET_PATH_MISSING', message: 'set 路径不存在：{path} {reason}' },

  // insert / assign
  MVU_ASSIGN_PRIMITIVE: { code: 'MVU_ASSIGN_PRIMITIVE', message: '不能向原始值路径插入：{path}（type={type}）{reason}' },
  MVU_ASSIGN_NON_EXTENSIBLE_OBJECT: { code: 'MVU_ASSIGN_NON_EXTENSIBLE_OBJECT', message: '目标对象不可扩展，无法合并：{path} {reason}' },
  MVU_ASSIGN_UNKNOWN_KEY: { code: 'MVU_ASSIGN_UNKNOWN_KEY', message: '对象不可扩展，未知键：{key} @ {path} {reason}' },
  MVU_ASSIGN_NON_EXTENSIBLE_ARRAY: { code: 'MVU_ASSIGN_NON_EXTENSIBLE_ARRAY', message: '目标数组不可扩展：{path} {reason}' },
  MVU_ASSIGN_MISSING_PARENT: { code: 'MVU_ASSIGN_MISSING_PARENT', message: '插入父路径不存在或不可扩展：{path} {reason}' },
  MVU_ASSIGN_MERGE_ARRAY_INTO_OBJECT: { code: 'MVU_ASSIGN_MERGE_ARRAY_INTO_OBJECT', message: '不能把数组合并到对象：{path}' },
  MVU_ASSIGN_MERGE_NON_OBJECT_INTO_OBJECT: { code: 'MVU_ASSIGN_MERGE_NON_OBJECT_INTO_OBJECT', message: '不能把非对象合并到对象：{path}' },
  MVU_ASSIGN_INVALID_ARGUMENTS: { code: 'MVU_ASSIGN_INVALID_ARGUMENTS', message: 'insert 参数无效：{path}' },
  MVU_TEMPLATE_RESOLUTION_FAILED: { code: 'MVU_TEMPLATE_RESOLUTION_FAILED', message: '模板应用失败：{path}（{cause}）' },

  // delete / remove
  MVU_REMOVE_PATH_UNDEFINED: { code: 'MVU_REMOVE_PATH_UNDEFINED', message: 'remove 路径不存在：{path}' },
  MVU_REMOVE_PATH_MISSING: { code: 'MVU_REMOVE_PATH_MISSING', message: 'remove 容器路径不存在：{path} {reason}' },
  MVU_REMOVE_NON_EXTENSIBLE_ARRAY: { code: 'MVU_REMOVE_NON_EXTENSIBLE_ARRAY', message: '目标数组不可扩展：{path} {reason}' },
  MVU_REMOVE_REQUIRED_KEY: { code: 'MVU_REMOVE_REQUIRED_KEY', message: '不能删除必填键：{key} @ {path} {reason}' },
  MVU_REMOVE_NON_COLLECTION: { code: 'MVU_REMOVE_NON_COLLECTION', message: '删除目标不是集合：{path} {reason}' },
  MVU_REMOVE_TARGET_UNDETERMINED: { code: 'MVU_REMOVE_TARGET_UNDETERMINED', message: '无法确定删除目标：{path} {reason}' },
  MVU_REMOVE_FAILED: { code: 'MVU_REMOVE_FAILED', message: 'remove 执行失败：{path}' },

  // add
  MVU_ADD_PATH_MISSING: { code: 'MVU_ADD_PATH_MISSING', message: 'add 路径不存在：{path} {reason}' },
  MVU_ADD_DELTA_NOT_NUMBER: { code: 'MVU_ADD_DELTA_NOT_NUMBER', message: 'add 增量不是数字：{delta} {reason}' },
  MVU_ADD_DATE_DELTA_NOT_NUMBER: { code: 'MVU_ADD_DATE_DELTA_NOT_NUMBER', message: '日期增量不是数字：{delta} {reason}' },
  MVU_ADD_UNSUPPORTED_VALUE: { code: 'MVU_ADD_UNSUPPORTED_VALUE', message: 'add 不支持的值类型：{path} {reason}' },
  MVU_ADD_INVALID_ARGUMENTS: { code: 'MVU_ADD_INVALID_ARGUMENTS', message: 'add 参数无效：{path} {reason}' },

  // parse
  MVU_PARSE_FORMAT_INVALID: { code: 'MVU_PARSE_FORMAT_INVALID', message: '结构化内容解析失败：{content}' },

  // 其他
  MVU_UNKNOWN_COMMAND: { code: 'MVU_UNKNOWN_COMMAND', message: '未知命令' },
  MVU_ACTOR_CONTEXT_INCOMPLETE: { code: 'MVU_ACTOR_CONTEXT_INCOMPLETE', message: '当前发言角色未知，未执行角色状态写入' },
};

function interpolate(template: string, params?: Record<string, unknown>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_match, key) => {
    const value = params[key];
    if (value === undefined) return `{${key}}`;
    return String(value);
  });
}

export class ErrorCatalog {
  static has(code: string): boolean {
    return Object.prototype.hasOwnProperty.call(CATALOG, code);
  }

  static build(code: string, params?: Record<string, unknown>): { code: string; message: string } {
    const entry = CATALOG[code];
    if (!entry) {
      return { code, message: `未知错误码：${code}` };
    }
    return { code: entry.code, message: interpolate(entry.message, params) };
  }
}

export const errorCatalog = ErrorCatalog;
