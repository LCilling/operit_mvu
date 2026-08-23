/**
 * core/command-parser.ts
 *
 * 从 MagVarUpdate 上游 `src/function/update_variables.ts` 中命令提取/路径修复部分移植。
 * 覆盖：extractCommands、findMatchingCloseParen、parseParameters、pathFix、
 * pathSegmentsToLodashPath、jsonPatchPathToCommandPath、extractJsonPatch、trimQuotesAndBackslashes。
 */

import { concat, omit, sortBy, toPath } from '../port/util';
import { parseString } from '../port/structured-parser';
import type { MvuCommand } from './variable-def';

type CommandNames = 'set' | 'insert' | 'assign' | 'remove' | 'unset' | 'delete' | 'add' | 'move';

/** 判断一个解析结果是否为 JSON Patch 操作数组（与上游 util.ts isJsonPatch 对齐）。 */
export function isJsonPatch(patch: unknown): boolean {
  if (!Array.isArray(patch)) {
    return false;
  }
  if (patch.length === 0) {
    return true;
  }
  return patch.every(
    (op) =>
      op !== null &&
      typeof op === 'object' &&
      typeof (op as { op?: unknown }).op === 'string' &&
      (typeof (op as { path?: unknown }).path === 'string' ||
        ((op as { op?: unknown }).op === 'move' && typeof (op as { to?: unknown }).to === 'string'))
  );
}

function trimQuotesAndBackslashes(str: string): string {
  if (typeof str !== 'string') return str;
  return str.replace(/^[\\"'` ]*(.*?)[\\"'` ]*$/, '$1');
}

function pathSegmentsToLodashPath(pathSegments: string[]): string {
  return pathSegments
    .map((segment) => `["${segment.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`)
    .join('');
}

function jsonPatchPathToCommandPath(path: string | undefined): string {
  if (!path) return '';
  const pathWithoutRoot = path.startsWith('/') ? path.substring(1) : path;
  const pathSegments = pathWithoutRoot
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  return pathSegmentsToLodashPath(pathSegments);
}

function extractJsonPatch(patch: any): MvuCommand[] {
  const translated_commands: MvuCommand[] = [];

  for (const op of patch) {
    const path = jsonPatchPathToCommandPath(op.path ?? op.to);
    switch (op.op) {
      case 'replace':
        translated_commands.push({
          type: 'set',
          full_match: JSON.stringify(op),
          args: [path, JSON.stringify(op.value)],
          reason: 'json_patch',
        });
        break;
      case 'delta': {
        translated_commands.push({
          type: 'add',
          full_match: JSON.stringify(op),
          args: [path, JSON.stringify(op.value)],
          reason: 'json_patch',
        });
        break;
      }
      case 'insert':
      case 'add': {
        const pathParts = toPath(path);
        const lastPart = pathParts[pathParts.length - 1];
        const containerPath = pathSegmentsToLodashPath(pathParts.slice(0, -1));
        // 保留 JSON Patch 的 "-" 特殊 token，交给执行阶段结合目标集合类型解释。
        const keyOrIndexArg = /^\d+$/.test(lastPart) ? lastPart : JSON.stringify(lastPart);
        translated_commands.push({
          type: 'insert',
          full_match: JSON.stringify(op),
          args: [containerPath, keyOrIndexArg, JSON.stringify(op.value)],
          reason: 'json_patch',
        });
        break;
      }
      case 'remove':
        translated_commands.push({
          type: 'delete',
          full_match: JSON.stringify(op),
          args: [path],
          reason: 'json_patch',
        });
        break;
      case 'move':
        translated_commands.push({
          type: 'move',
          full_match: JSON.stringify(op),
          args: [jsonPatchPathToCommandPath(op.from), path],
          reason: 'json_patch',
        });
        break;
    }
  }
  return translated_commands;
}

/**
 * 从输入文本中提取所有命令（`_.set/assign/remove/unset/delete/add` 与 `<json_patch>`）。
 */
export function extractCommands(inputText: string): MvuCommand[] {
  const results: (MvuCommand & { $index: number })[] = [];

  // $\u003Cjson_patch> 块
  const jsonPatchMatches = [
    ...inputText.matchAll(
      /<(json_?patch)>(?:\s*```.*)?((?:(?!<json_?patch>)[\s\S])*?)(?:```\s*)?<\/\1>/gim
    ),
  ];
  for (const match of jsonPatchMatches) {
    const index = match.index ?? 0;
    const string = match[2].trim();
    try {
      const patch = parseString(string);
      if (isJsonPatch(patch)) {
        for (const command of extractJsonPatch(patch)) {
          results.push({ $index: index, ...command });
        }
      }
    } catch {
      /* ignore */
    }
  }

  let i = 0;
  while (i < inputText.length) {
    const setMatch = inputText.substring(i).match(/_\.(set|insert|assign|remove|unset|delete|add)\(/);
    if (!setMatch || setMatch.index === undefined) {
      break;
    }

    const commandType = setMatch[1] as CommandNames;
    const setStart = i + setMatch.index;
    const openParen = setStart + setMatch[0].length;

    const closeParen = findMatchingCloseParen(inputText, openParen);
    if (closeParen === -1) {
      i = openParen;
      continue;
    }

    let endPos = closeParen + 1;
    if (endPos >= inputText.length || inputText[endPos] !== ';') {
      i = closeParen + 1;
      continue;
    }
    endPos++;

    let comment = '';
    const potentialComment = inputText.substring(endPos).match(/^\s*\/\/(.*)/);
    if (potentialComment) {
      comment = potentialComment[1].trim();
      endPos += potentialComment[0].length;
    }

    const fullMatch = inputText.substring(setStart, endPos);
    const paramsString = inputText.substring(openParen, closeParen);
    const params = parseParameters(paramsString);

    let isValid = false;
    if (commandType === 'set' && params.length >= 2) isValid = true;
    else if (commandType === 'assign' && params.length >= 2) isValid = true;
    else if (commandType === 'insert' && params.length >= 2) isValid = true;
    else if (commandType === 'remove' && params.length >= 1) isValid = true;
    else if (commandType === 'unset' && params.length >= 1) isValid = true;
    else if (commandType === 'delete' && params.length >= 1) isValid = true;
    else if (commandType === 'add' && params.length === 2) isValid = true;

    if (isValid) {
      results.push({
        $index: setStart,
        type: commandType,
        full_match: fullMatch,
        args: params,
        reason: comment,
      });
    }

    i = endPos;
  }

  // 与上游一致：按命令在原文中的起始位置稳定排序，然后丢掉内部 $index 字段。
  const sorted = sortBy(results, (r) => r.$index);
  return sorted.map((r) => omit(r, ['$index']) as unknown as MvuCommand);
}

/**
 * 找到匹配的闭括号，忽略引号与字符串内的括号。
 */
function findMatchingCloseParen(str: string, startPos: number): number {
  let parenCount = 1;
  let inQuote = false;
  let quoteChar = '';

  for (let i = startPos; i < str.length; i++) {
    const char = str[i];
    const prevChar = i > 0 ? str[i - 1] : '';

    if ((char === '"' || char === "'" || char === '`') && prevChar !== '\\') {
      if (!inQuote) {
        inQuote = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inQuote = false;
      }
    }

    if (!inQuote) {
      if (char === '(') {
        parenCount++;
      } else if (char === ')') {
        parenCount--;
        if (parenCount === 0) {
          return i;
        }
      }
    }
  }
  return -1;
}

/**
 * 解析参数字符串，处理嵌套结构。
 */
export function parseParameters(paramsString: string): string[] {
  const params: string[] = [];
  let currentParam = '';
  let inQuote = false;
  let quoteChar = '';
  let bracketCount = 0;
  let braceCount = 0;
  let parenCount = 0;

  for (let i = 0; i < paramsString.length; i++) {
    const char = paramsString[i];

    if (
      (char === '"' || char === "'" || char === '`') &&
      (i === 0 || paramsString[i - 1] !== '\\')
    ) {
      if (!inQuote) {
        inQuote = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inQuote = false;
      }
    }

    if (!inQuote) {
      if (char === '(') parenCount++;
      if (char === ')') parenCount--;
      if (char === '[') bracketCount++;
      if (char === ']') bracketCount--;
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;
    }

    if (
      char === ',' &&
      !inQuote &&
      parenCount === 0 &&
      bracketCount === 0 &&
      braceCount === 0
    ) {
      params.push(currentParam.trim());
      currentParam = '';
      continue;
    }

    currentParam += char;
  }

  if (currentParam.trim()) {
    params.push(currentParam.trim());
  }

  return params;
}

export function pathFix(path: string): string {
  if (!path) return path;

  // 1. 处理 [] 内的内容，区分数字索引 / 字符串 key
  const fixedBrackets = path.replace(/\[([^\]]*)\]/g, (_match, rawInner: string) => {
    let inner = rawInner.trim();
    if (!inner) {
      return '[]';
    }

    let wasQuoted = false;
    const first = inner[0];
    const last = inner[inner.length - 1];

    if (inner.length >= 2 && (first === '"' || first === "'") && first === last) {
      wasQuoted = true;
      inner = inner.slice(1, -1);
    }

    const isPureDigits = /^\d+$/.test(inner);
    const hasWhitespace = /\s/.test(inner);

    if (isPureDigits) {
      if (!wasQuoted) {
        return `[${inner}]`;
      } else {
        const escaped = inner.replace(/"/g, '\\"');
        return `["${escaped}"]`;
      }
    }

    if (hasWhitespace) {
      const escaped = inner.replace(/"/g, '\\"');
      return `["${escaped}"]`;
    } else {
      return `[${inner}]`;
    }
  });

  // 2. 处理点分段中被整体引号包裹的字段
  const fixedDots = fixedBrackets.replace(
    /(^|\.)(["'])([^"']*)\2(?=\.|\[|$)/g,
    (_match, prefix: string, _quote: string, name: string) => {
      const hasWhitespace = /\s/.test(name);
      const hasSpecial = /[.[\]]/.test(name);

      if (!hasWhitespace && !hasSpecial) {
        return prefix + name;
      } else {
        const escaped = name.replace(/"/g, '\\"');
        if (prefix === '.') {
          return `["${escaped}"]`;
        } else {
          return `${prefix}["${escaped}"]`;
        }
      }
    }
  );

  return fixedDots;
}

// re-export 供外部使用（JSON Patch 路径转换）。
export { pathSegmentsToLodashPath, jsonPatchPathToCommandPath };
