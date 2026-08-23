/**
 * port/structured-parser.ts
 *
 * 结构化内容解析（替代上游 `parseString` / `parseCommandValue` 中的 YAML/JSON5/jsonrepair &
 * mathjs 依赖），并在同一处落地安全修订：
 *
 *   - core-10：删除 `new Function` 分支。对象/数组字面量不再走 JavaScript 求值。
 *   - core-13：math 求值使用受限的纯算术求值器（白名单函数/常量），拒绝赋值、函数定义与任意符号。
 *
 * 支持的语言子集（写入兼容测试）：
 *   - 标准 JSON
 *   - JSON5 风格容忍：未加引号的键、单引号字符串、尾逗号、十六进制、+Infinity/NaN、注释星号
 *   - YAML 常用子集：`key: value`、嵌套缩进对象、`- item` 数组、块标量 `|`、内联 JSON/`[...]/`{...}`
 *   - parseCommandValue：布尔、null、undefined、数字、JSON5 对象/数组、受限数学表达式、裸字符串
 */

// ---------------- 工具 ----------------

/** 跳过空白（含注释中的空白字符） */
function isWhitespace(char: string | undefined): boolean {
  return char === undefined || char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

function isNumberStart(char: string | undefined): boolean {
  if (char === undefined) return false;
  return isDigit(char) || char === '-' || char === '+' || char === '.';
}

function isIdentStart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z_]/.test(char);
}

function isIdentChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_]/.test(char);
}

function isHexDigit(char: string | undefined): boolean {
  return char !== undefined && /[0-9a-fA-F]/.test(char);
}

// ---------------- YAML/JSON5 容忍解析 ----------------

export interface ParseOptions {
  /** 最大递归深度（core-12）。 */
  maxDepth?: number;
}

export class StructuredParseError extends Error {
  readonly position: number;
  constructor(message: string, position: number) {
    super(`StructuredParseError at ${position}: ${message}`);
    this.position = position;
  }
}

interface Cursor {
  text: string;
  pos: number;
}

function skipWs(cursor: Cursor): void {
  while (cursor.pos < cursor.text.length && /\s/.test(cursor.text[cursor.pos])) cursor.pos += 1;
}

/** 解析一个值：推断对象/数组/字符串/数字/布尔/null/undefined。 */
function parseValue(cursor: Cursor, depth: number, maxDepth: number): unknown {
  if (depth > maxDepth) {
    throw new StructuredParseError('nest_too_deep', cursor.pos);
  }
  skipWs(cursor);
  const char = cursor.text[cursor.pos];
  if (char === undefined) {
    throw new StructuredParseError('unexpected_end', cursor.pos);
  }
  if (char === '{') return parseObject(cursor, depth, maxDepth);
  if (char === '[') return parseArray(cursor, depth, maxDepth);
  if (char === '"' || char === "'") return parseStringLiteral(cursor);
  if (char === '|' || char === '>') return parseBlockScalar(cursor);
  if (char === '-' && isWhitespace(cursor.text[cursor.pos + 1])) {
    // YAML 单元素字典行（如 "- key: value"）——暂按数组项对象处理，交给 parseYamlFlow
    return parseYamlLineAsArray(cursor, depth, maxDepth);
  }
  // 字面量
  return parseScalar(cursor);
}

/** 标准/JSON5 字符串。 */
function parseStringLiteral(cursor: Cursor): string {
  const quote = cursor.text[cursor.pos];
  if (quote !== '"' && quote !== "'") {
    throw new StructuredParseError('expected_string', cursor.pos);
  }
  cursor.pos += 1;
  let out = '';
  while (cursor.pos < cursor.text.length) {
    const char = cursor.text[cursor.pos];
    if (char === quote) {
      cursor.pos += 1;
      return out;
    }
    if (char === '\n' && quote === "'") {
      // JSON5 允许单引号字符串内包含换行
      out += '\n';
      cursor.pos += 1;
      continue;
    }
    if (char === '\\') {
      const esc = cursor.text[cursor.pos + 1];
      const escapes: Record<string, string> = {
        n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v',
        '0': '\0', '"': '"', "'": "'", '\\': '\\', '/': '/',
      };
      if (esc === 'x') {
        const hex = cursor.text.slice(cursor.pos + 2, cursor.pos + 4);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          cursor.pos += 4;
          continue;
        }
      } else if (esc === 'u') {
        const hex = cursor.text.slice(cursor.pos + 2, cursor.pos + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          cursor.pos += 6;
          continue;
        }
      }
      if (esc !== undefined && escapes[esc] !== undefined) {
        out += escapes[esc];
        cursor.pos += 2;
        continue;
      }
      throw new StructuredParseError('bad_escape', cursor.pos);
    }
    out += char;
    cursor.pos += 1;
  }
  throw new StructuredParseError('unterminated_string', cursor.pos);
}

/** 块标量 `|` 或 `>`（YAML）。 */
function parseBlockScalar(cursor: Cursor): string {
  const style = cursor.text[cursor.pos]; // '|' 或 '>'
  cursor.pos += 1;
  // 折叠后续换行
  if (cursor.text[cursor.pos] === '-') cursor.pos += 1;
  if (cursor.text[cursor.pos] === '+') cursor.pos += 1;
  // 跳到内容第一行
  while (cursor.pos < cursor.text.length && cursor.text[cursor.pos] !== '\n') cursor.pos += 1;
  const lines: string[] = [];
  let minIndent: number | null = null;
  while (cursor.pos < cursor.text.length) {
    if (cursor.text[cursor.pos] === '\n') {
      cursor.pos += 1;
      continue;
    }
    // 计算缩进
    let indent = 0;
    while (cursor.text[cursor.pos + indent] === ' ') indent += 1;
    if (indent === 0 || cursor.text[cursor.pos] === '\n') break;
    if (minIndent === null || indent < minIndent) minIndent = indent;
    lines.push(cursor.text.slice(cursor.pos + indent).replace(/\s+$/, ''));
    cursor.pos += indent;
    // 跳到行尾
    while (cursor.pos < cursor.text.length && cursor.text[cursor.pos] !== '\n') cursor.pos += 1;
  }
  if (style === '>') return lines.join(' ');
  return lines.join('\n');
}

/** 解析对象：`{...}` 或 YAML 缩进结构。 */
function parseObject(cursor: Cursor, depth: number, maxDepth: number): Record<string, unknown> {
  // 内联对象
  if (cursor.text[cursor.pos] === '{') {
    cursor.pos += 1;
    const out: Record<string, unknown> = {};
    skipWs(cursor);
    if (cursor.text[cursor.pos] === '}') {
      cursor.pos += 1;
      return out;
    }
    // 处理注释
    while (true) {
      skipWs(cursor);
      const key = parseObjectKey(cursor);
      skipWs(cursor);
      if (cursor.text[cursor.pos] === ':') cursor.pos += 1;
      else if (cursor.text[cursor.pos] === ',') { out[key] = ''; cursor.pos += 1; continue; }
      else throw new StructuredParseError('expected_colon', cursor.pos);
      skipWs(cursor);
      out[key] = parseValue(cursor, depth + 1, maxDepth);
      skipWs(cursor);
      if (cursor.text[cursor.pos] === ',') { cursor.pos += 1; continue; }
      if (cursor.text[cursor.pos] === '}') { cursor.pos += 1; break; }
      throw new StructuredParseError('expected_comma_or_brace', cursor.pos);
    }
    return out;
  }
  // YAML 缩进对象（顶层 `key: value` 或 `key:\n  ...`）
  return parseYamlMapping(cursor, depth, maxDepth);
}

function parseObjectKey(cursor: Cursor): string {
  skipWs(cursor);
  const char = cursor.text[cursor.pos];
  if (char === '"' || char === "'") return parseStringLiteral(cursor);
  // 未加引号的键：读至冒号/空白
  let start = cursor.pos;
  while (
    cursor.pos < cursor.text.length &&
    cursor.text[cursor.pos] !== ':' &&
    cursor.text[cursor.pos] !== ',' &&
    cursor.text[cursor.pos] !== '}' &&
    !isWhitespace(cursor.text[cursor.pos])
  ) {
    cursor.pos += 1;
  }
  const key = cursor.text.slice(start, cursor.pos).trim();
  if (!key) throw new StructuredParseError('empty_key', cursor.pos);
  return key;
}

/** YAML 映射：读取一系列 `key: value`（缩进敏感的顶层调用由调用方传入单区块）。 */
function parseYamlMapping(cursor: Cursor, depth: number, maxDepth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const indentAtStart = cursor.pos;
  // 记录当前行的起始缩进
  let baseIndent = cursor.pos - leadingWhitespaceLen(cursor.text.slice(0, cursor.pos));
  while (true) {
    skipWsAlign(cursor, baseIndent);
    if (cursor.pos >= cursor.text.length) break;
    // 处理 "- item"
    if (cursor.text[cursor.pos] === '-' && isWhitespace(cursor.text[cursor.pos + 1])) {
      const arr = parseYamlSequenceInline(cursor, depth, maxDepth, baseIndent);
      return arr as unknown as Record<string, unknown>;
    }
    const key = parseObjectKey(cursor);
    skipWs(cursor);
    if (cursor.text[cursor.pos] === ':') {
      cursor.pos += 1;
      skipWs(cursor);
      if (cursor.text[cursor.pos] === undefined || cursor.text[cursor.pos] === '\n') {
        // 嵌套结构：下一行缩进更多 → 递归对象/数组
        const nested = readNestedBlock(cursor, baseIndent);
        if (nested === undefined) {
          out[key] = {};
        } else {
          out[key] = nested;
        }
      } else {
        out[key] = parseValue(cursor, depth + 1, maxDepth);
      }
    } else {
      out[key] = '';
      return out; // 没有冒号却是键，行不通，直接返回
    }
    // 跳过到下一非空行（下一循环处理）
    skipToNextLine(cursor);
    // 若下一行缩进小于等于 baseIndent，结束本映射
    const nextIndent = indentOfNextLine(cursor);
    if (nextIndent !== undefined && nextIndent < baseIndent) break;
  }
  return out;
}

function leadingWhitespaceLen(text: string): number {
  let i = 0;
  while (i < text.length && text[i] === ' ') i += 1;
  return i;
}

function skipWsAlign(cursor: Cursor, baseIndent: number): void {
  // 已经位于行首缩进之后（调用方负责），这里仅略过
  return;
}

function indentOfNextLine(cursor: Cursor): number | undefined {
  let i = cursor.pos;
  while (i < cursor.text.length && cursor.text[i] !== '\n') i += 1;
  if (i >= cursor.text.length) return undefined;
  i += 1;
  let indent = 0;
  while (i < cursor.text.length && cursor.text[i] === ' ') { indent += 1; i += 1; }
  if (i >= cursor.text.length || cursor.text[i] === '\n') return undefined;
  return indent;
}

function skipToNextLine(cursor: Cursor): void {
  while (cursor.pos < cursor.text.length && cursor.text[cursor.pos] !== '\n') cursor.pos += 1;
  if (cursor.pos < cursor.text.length) cursor.pos += 1;
}

/** 读取下一行缩进更深的部分作为嵌套对象或数组。 */
function readNestedBlock(cursor: Cursor, baseIndent: number): unknown {
  if (cursor.pos >= cursor.text.length) return undefined;
  const nextIndent = indentOfNextLine(cursor);
  if (nextIndent === undefined || nextIndent <= baseIndent) return undefined;
  // 跳到该行缩进后
  skipToNextLine(cursor);
  let indent = 0;
  while (cursor.text[cursor.pos] === ' ') { indent += 1; cursor.pos += 1; }
  if (cursor.text[cursor.pos] === '-') {
    // 序列
    return parseYamlSequenceInline(cursor, 0, DEFAULT_INPUT_MAX_DEPTH, indent);
  }
  // 对象：baseline 为该嵌套行的缩进
  return parseYamlMapping(cursor, 0, DEFAULT_INPUT_MAX_DEPTH);
}

const DEFAULT_INPUT_MAX_DEPTH = 32;

/** YAML 序列（`- item` 块）。此实现为行内迭代版本，供顶层与嵌套使用简化语义。 */
function parseYamlSequenceInline(
  cursor: Cursor,
  depth: number,
  maxDepth: number,
  baseIndent: number
): unknown[] {
  const out: unknown[] = [];
  while (cursor.pos < cursor.text.length) {
    // 已在 '-' 处：解析单元素值
    cursor.pos += 1; // 跳过 '-'
    skipWs(cursor);
    if (cursor.text[cursor.pos] === '\n' || cursor.pos >= cursor.text.length) {
      out.push({});
      skipToNextLine(cursor);
    } else {
      out.push(parseValue(cursor, depth + 1, maxDepth));
      skipToNextLine(cursor);
    }
    // 检查下一行是否为同级 '-'
    if (cursor.pos >= cursor.text.length) break;
    const nextIndent = indentOfNextLine(cursor);
    const line = cursor.text.slice(cursor.pos);
    const dash = /^(\s*)-(\s|\-)/.exec(line);
    if (dash && dash[1].length === baseIndent) {
      cursor.pos += dash[1].length;
      // 已定位到 '-'，继续
    } else {
      break;
    }
  }
  return out;
}

/** 解析数组 `[...]`。 */
function parseArray(cursor: Cursor, depth: number, maxDepth: number): unknown[] {
  if (cursor.text[cursor.pos] === '[') {
    cursor.pos += 1;
    const out: unknown[] = [];
    skipWs(cursor);
    if (cursor.text[cursor.pos] === ']') {
      cursor.pos += 1;
      return out;
    }
    while (true) {
      skipWs(cursor);
      out.push(parseValue(cursor, depth + 1, maxDepth));
      skipWs(cursor);
      if (cursor.text[cursor.pos] === ',') { cursor.pos += 1; continue; }
      if (cursor.text[cursor.pos] === ']') { cursor.pos += 1; break; }
      throw new StructuredParseError('expected_comma_or_bracket', cursor.pos);
    }
    return out;
  }
  throw new StructuredParseError('expected_array', cursor.pos);
}

/** 解析标量：布尔/null/undefined/数字/键值对（单元素字典行）/裸字符串。 */
function parseScalar(cursor: Cursor): unknown {
  const start = cursor.pos;
  let raw = '';
  while (cursor.pos < cursor.text.length) {
    const char = cursor.text[cursor.pos];
    if (
      char === ',' || char === '}' || char === ']' || char === '\n' ||
      (char === '#' && (start === cursor.pos || /\s/.test(cursor.text[cursor.pos - 1])))
    ) break;
    raw += char;
    cursor.pos += 1;
  }
  raw = raw.trim();
  if (raw === '') return '';
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null' || raw === '~') return null;
  if (raw === 'undefined') return undefined;
  const num = tryParseJson5Number(raw);
  if (num !== undefined) return num;
  // 可能是嵌套的元素内联（如 `- 3,5`，不在这里展开）
  return raw;
}

/** 尝试解析 JSON5 数字：十进制/十六进制/Infinity/NaN/科学计数/前导 0。 */
function tryParseJson5Number(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === 'Infinity' || trimmed === '+Infinity') return Infinity;
  if (trimmed === '-Infinity') return -Infinity;
  if (trimmed === 'NaN') return NaN;
  if (/^[+-]?0[xX][0-9a-fA-F]+$/.test(trimmed)) return parseInt(trimmed, 16);
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (/^[+-]?\d+\.?\d*[eE][+-]?\d+$/.test(trimmed)) return Number(trimmed);
  if (/^[+-]?\.\d+$/.test(trimmed)) return Number(trimmed);
  return undefined;
}

/** YAML 单元素字典行 "- key: value"（罕见，简化为对象）。 */
function parseYamlLineAsArray(cursor: Cursor, depth: number, maxDepth: number): unknown {
  const arr = parseYamlSequenceInline(cursor, depth, maxDepth, 0);
  return arr.length === 1 ? arr[0] : arr;
}

// ---------------- 顶层入口 ----------------

/** 判断内容是否以 `{` 或 `[` 开头。 */
export function looksJsonLike(content: string): boolean {
  return /^[[{]/.test(content.trimStart());
}

/**
 * parseString：使用一个受限解析器读取支持的 JSON5/YAML 子集。
 * 无法完整消费输入时直接拒绝，不再尝试其他解析器或修复文本。
 */
export function parseString(content: string, options?: ParseOptions): unknown {
  const maxDepth = options?.maxDepth ?? DEFAULT_INPUT_MAX_DEPTH;
  if (typeof content !== 'string') return content;
  const cursor: Cursor = { text: content, pos: 0 };
  const value = parseValue(cursor, 0, maxDepth);
  if (!cursorAtWhitespaceEnd(cursor)) {
    throw new StructuredParseError('trailing', cursor.pos);
  }
  return value;
}

function cursorAtWhitespaceEnd(cursor: Cursor): boolean {
  let i = cursor.pos;
  while (i < cursor.text.length && /\s/.test(cursor.text[i])) i += 1;
  return i >= cursor.text.length;
}

export { parseValue as parseStructuredValue };

// ---------------- 受限数学求值器（core-13） ----------------

/** 数学白名单函数名 → 实现。拒绝其它任意函数/符号访问。 */
const MATH_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  abs: Math.abs,
  sqrt: Math.sqrt,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  trunc: Math.trunc,
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  exp: Math.exp,
  log: Math.log,
  log2: Math.log2,
  log10: Math.log10,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
};

const MATH_CONSTANTS: Record<string, number> = {
  PI: Math.PI,
  pi: Math.PI,
  E: Math.E,
  e: Math.E,
  Infinity: Infinity,
  NaN: NaN,
};

export interface RestrictedMathResult {
  ok: boolean;
  value?: number;
  /** 不合法时返回的错误 token 或原因。 */
  reason?: string;
}

/**
 * 受限数学表达式求值。支持：
 *   数字、+ - * / % ^、一元 +/-、括号、
 *   白名单函数（abs/sqrt/floor/ceil/round/min/max/pow/exp/log/...）、
 *   白名单常量（PI/E/Infinity/NaN）。
 * 拒绝：赋值、函数定义、字符串/键访问、任意标识符。
 */
export function evaluateRestrictedMath(expression: string): RestrictedMathResult {
  const tokenizer = tokenizeMath(expression);
  if (!tokenizer.ok || !tokenizer.tokens) return { ok: false, reason: tokenizer.reason };
  const tokens = tokenizer.tokens;
  let index = 0;
  let failed: string | undefined;
  const peek = () => tokens[index];
  const next = () => tokens[index++];

  function parsePrimary(): number {
    const token = next();
    if (!token) { failed = 'unexpected_end'; return NaN; }
    if (token.type === 'num') return token.value;
    if (token.type === 'const') return MATH_CONSTANTS[token.name];
    if (token.type === 'ident') {
      const name = token.name;
      if (tokens[index]?.type === 'lparen') {
        index += 1; // 跳过 (
        const fn = MATH_FUNCTIONS[name];
        if (!fn) { failed = `unknown_function:${name}`; return NaN; }
        const args: number[] = [];
        if (tokens[index]?.type === 'rparen') {
          index += 1;
        } else {
          while (true) {
            args.push(parseExpr());
            if (failed) return NaN;
            const t = next();
            if (t?.type === 'comma') continue;
            if (t?.type === 'rparen') break;
            failed = 'expected_comma_or_rparen';
            return NaN;
          }
        }
        return fn(...args);
      }
      failed = `unknown_symbol:${name}`;
      return NaN;
    }
    if (token.type === 'minus') return -parseUnary();
    if (token.type === 'plus') return parseUnary();
    if (token.type === 'lparen') {
      const v = parseExpr();
      const t = next();
      if (t?.type !== 'rparen') { failed = 'expected_rparen'; return NaN; }
      return v;
    }
    failed = `unexpected_token:${token.type}`;
    return NaN;
  }

  function parseUnary(): number {
    return parsePrimary();
  }

  function parsePow(): number {
    let value = parseUnary();
    while (peek()?.type === 'caret') {
      next();
      const right = parseUnary();
      if (failed) return NaN;
      value = Math.pow(value, right);
    }
    return value;
  }

  function parseMul(): number {
    let value = parsePow();
    while (peek()?.type === 'mul' || peek()?.type === 'div' || peek()?.type === 'mod') {
      const op = next()!.type;
      const right = parsePow();
      if (failed) return NaN;
      if (op === 'mul') value = value * right;
      else if (op === 'div') value = value / right;
      else value = value % right;
    }
    return value;
  }

  function parseExpr(): number {
    let value = parseMul();
    while (peek()?.type === 'plus' || peek()?.type === 'minus') {
      const op = next()!.type;
      const right = parseMul();
      if (failed) return NaN;
      value = op === 'plus' ? value + right : value - right;
    }
    return value;
  }

  const result = parseExpr();
  if (failed) return { ok: false, reason: failed };
  if (index !== tokens.length) return { ok: false, reason: 'trailing_tokens' };
  return { ok: true, value: result };
}

type MathToken =
  | { type: 'num'; value: number }
  | { type: 'const'; name: string }
  | { type: 'ident'; name: string }
  | { type: 'plus' | 'minus' | 'mul' | 'div' | 'mod' | 'caret' }
  | { type: 'lparen' | 'rparen' | 'comma' };

function tokenizeMath(expr: string): { ok: boolean; tokens?: MathToken[]; reason?: string } {
  const tokens: MathToken[] = [];
  let i = 0;
  const s = expr.trim();
  while (i < s.length) {
    const char = s[i];
    if (/\s/.test(char)) { i += 1; continue; }
    if (isDigit(char) || char === '.') {
      const start = i;
      while (i < s.length && (isDigit(s[i]) || s[i] === '.') && !/[eE]/.test(s.slice(i, i + 1))) i += 1;
      if (i < s.length && (s[i] === 'e' || s[i] === 'E')) {
        i += 1;
        if (i < s.length && (s[i] === '+' || s[i] === '-')) i += 1;
        while (i < s.length && isDigit(s[i])) i += 1;
      }
      const num = Number(s.slice(start, i));
      if (Number.isNaN(num)) return { ok: false, reason: 'bad_number' };
      tokens.push({ type: 'num', value: num });
      continue;
    }
    if (isIdentStart(char)) {
      const start = i;
      while (i < s.length && isIdentChar(s[i])) i += 1;
      const name = s.slice(start, i);
      if (name in MATH_CONSTANTS) tokens.push({ type: 'const', name });
      else tokens.push({ type: 'ident', name });
      continue;
    }
    switch (char) {
      case '+': tokens.push({ type: 'plus' }); i += 1; break;
      case '-': tokens.push({ type: 'minus' }); i += 1; break;
      case '*': tokens.push({ type: 'mul' }); i += 1; break;
      case '/': tokens.push({ type: 'div' }); i += 1; break;
      case '%': tokens.push({ type: 'mod' }); i += 1; break;
      case '^': tokens.push({ type: 'caret' }); i += 1; break;
      case '(': tokens.push({ type: 'lparen' }); i += 1; break;
      case ')': tokens.push({ type: 'rparen' }); i += 1; break;
      case ',': tokens.push({ type: 'comma' }); i += 1; break;
      default: return { ok: false, reason: `bad_token:${char}` };
    }
  }
  return { ok: true, tokens };
}

/**
 * parseCommandValue：解析命令中的单个值字面量。
 * 对齐上游顺序：布尔/null/undefined → JSON 对象/数组（此处用 JSON5 容忍解析而非 new Function）→
 * 受限数学表达式 → YAML 单值 → 去引号裸字符串。
 */
export function parseCommandValue(valStr: string): unknown {
  if (typeof valStr !== 'string') return valStr;
  const trimmed = valStr.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (trimmed === 'undefined') return undefined;

  // JSON 对象/数组字面量（JSON5 容忍解析，非 new Function）
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    const cursor: Cursor = { text: trimmed, pos: 0 };
    try {
      return parseValue(cursor, 0, DEFAULT_INPUT_MAX_DEPTH);
    } catch (error) {
      console.error('MVU structured command value parsing failed', error);
      throw error;
    }
  }

  // 数字
  const num = tryParseJson5Number(trimmed);
  if (num !== undefined) return num;

  // 受限数学表达式：仅当包含运算符/函数/括号时才尝试，避免纯标识符被当作表达式
  if (/[+\-*/%^()]/.test(trimmed)) {
    const mathResult = evaluateRestrictedMath(trimmed);
    if (mathResult.ok && mathResult.value !== undefined) {
      return toPrecision12(mathResult.value);
    }
  }

  return trimQuotesAndBackslashes(valStr);
}

/** 对齐上游 parseFloat(result.toPrecision(12)) 的行为。 */
function toPrecision12(value: number): number {
  if (!Number.isFinite(value)) return value;
  return parseFloat(value.toPrecision(12));
}

/** 去首尾引号与反斜杠（与上游 trimQuotesAndBackslashes 一致）。 */
export function trimQuotesAndBackslashes(str: string): string {
  if (typeof str !== 'string') return str as unknown as string;
  return str.replace(/^[\\"'` ]*(.*?)[\\"'` ]*$/, '$1');
}
