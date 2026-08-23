/**
 * port/util.ts
 *
 * Operit 对 MagVarUpdate 核心所需 lodash / klona 能力的确定性替代实现。
 *
 * 背景：ToolPkg 运行时没有 node_modules，不引入完整 lodash / klona 依赖。
 * 这里只实现锁定上游实际使用的最小函数子集，保证语义与 lodash 对齐，
 * 并全部以纯函数形式实现（供快速执行与单测）。
 *
 * 覆盖函数（对应被移植核心中的调用点）：
 *   toPath / get / set / has / unset
 *   isObject / isDate / isPlainObject / isString / isEqual
 *   merge / mergeWith / concat / clamp / omit / sortBy / escape / size
 * 深度克隆：klona 等价实现 plainClone（对象/数组 + Date 保留原值）。
 */

export type PathSegment = string;
export type PathLike = string | (string | number)[];

/** 将 lodash 风格的路径字符串拆成段数组，支持点、bracket、数组索引。 */
export function toPath(value: PathLike): string[] {
  if (Array.isArray(value)) {
    return value.map((seg) => String(seg));
  }
  const result: string[] = [];
  const text = String(value ?? '');
  let i = 0;
  const n = text.length;
  while (i < n) {
    const char = text[i];
    if (char === '.') {
      // 单个点只是分隔符：仅在“后随另一个点”或“紧接着上一个是点”时产生空段
      if (result.length === 0) {
        // 前导点（".a"）→ 空键
        result.push('');
      } else if (i > 0 && text[i - 1] === '.') {
        result.push('');
      }
      i += 1;
      continue;
    }
    if (char === '[') {
      // 找到匹配的 ]，考虑引号
      let j = i + 1;
      let quote: string | null = null;
      while (j < n) {
        const c = text[j];
        if (quote) {
          if (c === '\\') j += 2;
          else if (c === quote) quote = null, j += 1;
          else j += 1;
        } else if (c === '"' || c === "'" || c === '`') {
          quote = c;
          j += 1;
        } else if (c === ']') {
          break;
        } else {
          j += 1;
        }
      }
      if (j >= n) {
        // 未闭合 bracket：整段按字面量处理
        result.push(text.slice(i));
        break;
      }
      let inner = text.slice(i + 1, j);
      inner = inner.trim();
      if (
        inner.length >= 2 &&
        (inner[0] === '"' || inner[0] === "'") &&
        inner[0] === inner[inner.length - 1]
      ) {
        inner = inner.slice(1, -1).replace(/\\(["'`\\])/g, '$1');
      }
      result.push(inner);
      i = j + 1;
      continue;
    }
    // 普通字符，读至下一个 . 或 [
    let j = i;
    while (j < n && text[j] !== '.' && text[j] !== '[') j += 1;
    result.push(text.slice(i, j));
    i = j;
  }
  // 去除尾部空串（如 "a." 的 "a"）
  while (result.length > 0 && result[result.length - 1] === '') result.pop();
  return result;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export function isDate(value: unknown): value is Date {
  return Object.prototype.toString.call(value) === '[object Date]';
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** 深度相等（对象/数组逐字段比较，简单值 ===，忽略 undefined 键的不等差异）。 */
export function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  if (isDate(a) || isDate(b)) return isDate(a) && isDate(b) && a.getTime() === b.getTime();
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  const aKeys = Object.keys(a as object).sort();
  const bKeys = Object.keys(b as object).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i += 1) {
    const key = aKeys[i];
    if (bKeys[i] !== key) return false;
    if (!isEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}

/** 深拷贝（对象/数组；Date、原始类型原样返回；不保留自定义原型之外的成员）。 */
export function klona<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => klona(item)) as unknown as T;
  if (isDate(value)) return new Date(value.getTime()) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as object)) {
    out[key] = klona((value as Record<string, unknown>)[key]);
  }
  return out as unknown as T;
}

/** lodash get：按路径读取，缺失返回 defaultV。 */
export function get(object: unknown, pathLike: PathLike, defaultV?: unknown): unknown {
  const path = toPath(pathLike);
  let cur: unknown = object;
  for (const seg of path) {
    if (cur == null) return defaultV;
    if (typeof cur !== 'object') return defaultV;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur === undefined ? defaultV : cur;
}

/** lodash has：判断路径是否存在（含值为 undefined 的情况）。 */
export function has(object: unknown, pathLike: PathLike): boolean {
  const path = toPath(pathLike);
  let cur: unknown = object;
  for (let i = 0; i < path.length; i += 1) {
    if (cur == null || typeof cur !== 'object') return false;
    const seg = path[i];
    const obj = cur as Record<string, unknown>;
    if (!(seg in obj)) return false;
    cur = obj[seg];
  }
  return true;
}

/** lodash set：按路径写值，自动创建缺失的中间对象。 */
export function set(object: Record<string, unknown>, pathLike: PathLike, value: unknown): void {
  const path = toPath(pathLike);
  if (path.length === 0) return;
  let cur: Record<string, unknown> = object;
  for (let i = 0; i < path.length - 1; i += 1) {
    const seg = path[i];
    const next = cur[seg];
    if (next == null || typeof next !== 'object' || isDate(next)) {
      const created: Record<string, unknown> = {};
      cur[seg] = created;
      cur = created;
    } else {
      cur = next as Record<string, unknown>;
    }
  }
  cur[path[path.length - 1]] = value;
}

/** lodash unset：按路径删除键，返回是否删除到某键。 */
export function unset(object: Record<string, unknown>, pathLike: PathLike): boolean {
  const path = toPath(pathLike);
  if (path.length === 0) return false;
  let cur: unknown = object;
  for (let i = 0; i < path.length - 1; i += 1) {
    if (cur == null || typeof cur !== 'object') return false;
    const seg = path[i];
    if (!(seg in (cur as Record<string, unknown>))) return false;
    cur = (cur as Record<string, unknown>)[seg];
  }
  if (cur == null || typeof cur !== 'object') return false;
  const last = path[path.length - 1];
  if (!(last in (cur as Record<string, unknown>))) return false;
  delete (cur as Record<string, unknown>)[last];
  return true;
}

/** lodash merge：递归合并，数组情况下以 source 覆盖（与 lodash 默认一致）。 */
export function merge(target: Record<string, unknown>, ...sources: unknown[]): Record<string, unknown> {
  for (const source of sources) {
    mergeWithInto(target, source, undefined);
  }
  return target;
}

type MergeCustomizer = (lhs: unknown, rhs: unknown, key?: string) => unknown;

/** 私有：把 source 合并进 target。 */
function mergeWithInto(
  target: unknown,
  source: unknown,
  customizer?: MergeCustomizer
): unknown {
  if (Array.isArray(source)) {
    if (customizer) {
      const custom = customizer(target, source);
      if (custom !== undefined) return custom;
    }
    if (!Array.isArray(target)) return source;
    // lodash merge 对数组：源数组逐下标覆盖目标数组
    for (let i = 0; i < source.length; i += 1) {
      if (source[i] === undefined) continue;
      target[i] = mergeWithInto(target[i], source[i], customizer);
    }
    return target;
  }
  if (source !== null && typeof source === 'object' && !isDate(source)) {
    if (
      target === null ||
      typeof target !== 'object' ||
      isDate(target) ||
      Array.isArray(target)
    ) {
      const base: Record<string, unknown> = Array.isArray(target)
        ? ([] as unknown as Record<string, unknown>)
        : ({ } as Record<string, unknown>);
      mergeWithInto(base, target, customizer);
      target = base;
    }
    const srcObj = source as Record<string, unknown>;
    const tgtObj = target as Record<string, unknown>;
    for (const key of Object.keys(srcObj)) {
      const rhs = srcObj[key];
      if (rhs === undefined) continue;
      const lhs = tgtObj[key];
      const custom = customizer ? customizer(lhs, rhs, key) : undefined;
      if (custom !== undefined) {
        tgtObj[key] = custom;
      } else {
        tgtObj[key] = mergeWithInto(lhs, rhs, customizer);
      }
    }
    return target;
  }
  if (customizer) {
    const custom = customizer(target, source);
    if (custom !== undefined) return custom;
  }
  return source;
}

/** lodash mergeWith：带自定义合并器（用于 correctlyMerge 覆盖 lodash 内置数组语义）。 */
export function mergeWith(target: Record<string, unknown>, source: unknown, customizer: MergeCustomizer): Record<string, unknown> {
  mergeWithInto(target, source, customizer);
  return target;
}

/** lodash concat：把多个数组/元素拼接到一个数组。 */
export function concat<T>(array: T[], ...values: unknown[]): T[] {
  const out: T[] = [...array];
  for (const value of values) {
    if (Array.isArray(value)) out.push(...(value as T[]));
    else out.push(value as T);
  }
  return out;
}

/** lodash clamp：把数值约束到 [lower, upper]。 */
export function clamp(number: number, lower?: number, upper?: number): number {
  let value = number;
  if (upper === undefined) {
    upper = lower;
    lower = undefined as unknown as number;
  }
  if (lower !== undefined && value < lower) value = lower;
  if (upper !== undefined && value > upper) value = upper;
  return value;
}

/** lodash omit：删除指定键，返回新对象。 */
export function omit<T extends object, K extends string>(object: T, keys: K[]): Omit<T, K> {
  const out: Record<string, unknown> = {};
  const keySet = new Set<string>(keys);
  for (const key of Object.keys(object)) {
    if (!keySet.has(key)) out[key] = (object as Record<string, unknown>)[key];
  }
  return out as Omit<T, K>;
}

/** lodash sortBy：按访问器函数升序稳定排序，返回新数组。 */
export function sortBy<T>(collection: T[], iteratee: (item: T) => unknown): T[] {
  return collection
    .map((item, index) => ({ item, index, key: iteratee(item) }))
    .sort((a, b) => {
      const c = compareKey(a.key, b.key);
      if (c !== 0) return c;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

function compareKey(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return b == null ? 0 : -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/** lodash escape：HTML 转义。 */
export function escape(value: string): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char] as string
  );
}

/** lodash size：数组/对象/字符串长度。 */
export function size(value: unknown): number {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
}

/** 导出统一的 `_` 风格的命名空间对象，便于核心代码按 lodash 习惯使用。 */
export const lodash = {
  toPath,
  get,
  set,
  has,
  unset,
  isObject,
  isDate,
  isPlainObject,
  isString,
  isArray,
  isEqual,
  merge,
  mergeWith,
  concat,
  clamp,
  omit,
  sortBy,
  escape,
  size,
};
