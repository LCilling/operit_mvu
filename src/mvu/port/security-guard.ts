/**
 * port/security-guard.ts
 *
 * 路径与输入预算保护（PATCHES core-11 / core-12）。
 *
 * - 路径在命令执行前统一校验：危险键、保留字段、层级与长度上限。
 * - 输入在 updateVariables 入口做预算限制：文本大小、命令条数、单值大小、嵌套深度。
 *
 * 违反时返回对应的 MVU_* 错误码，宿主按 ErrorCatalog 呈现；核心不静默截断。
 */

import { toPath } from './util';

export const MAX_PATH_SEGMENTS = 32;
export const MAX_PATH_LENGTH = 256;

export const DANGEROUS_KEYS = new Set<string>(['__proto__', 'prototype', 'constructor']);
export const RESERVED_PREFIXES = new Set<string>(['$operit', '$internal']);

/** 判断路径是否包含危险键之一（含拆分后的任一段）。 */
export function containsDangerousKey(pathSegments: string[]): string | undefined {
  for (const seg of pathSegments) {
    if (DANGEROUS_KEYS.has(seg)) return seg;
  }
  return undefined;
}

/** 判断路径是否触达保留字段（$operit / $internal 或其子路径）。 */
export function touchesReservedField(pathSegments: string[]): string | undefined {
  for (const seg of pathSegments) {
    if (RESERVED_PREFIXES.has(seg)) return seg;
  }
  return undefined;
}

export interface PathGuardOk {
  ok: true;
  pathSegments: string[];
}

export interface PathGuardFail {
  ok: false;
  code: string;
  detail: Record<string, unknown>;
}

export type PathGuardResult = PathGuardOk | PathGuardFail;

/** 校验原始命令路径字符串（尚未拆段）合规。 */
export function guardPath(rawPath: string): PathGuardResult {
  if (typeof rawPath !== 'string') {
    // 非字符串路径视为空路径（保留：空路径 "" 在核心中表示根对象）
    return { ok: true, pathSegments: [] };
  }
  if (rawPath.length > MAX_PATH_LENGTH) {
    return { ok: false, code: 'MVU_PATH_TOO_LONG', detail: { max: MAX_PATH_LENGTH } };
  }
  const segments = toPath(rawPath);
  if (segments.length > MAX_PATH_SEGMENTS) {
    return { ok: false, code: 'MVU_PATH_TOO_DEEP', detail: { max: MAX_PATH_SEGMENTS } };
  }
  const dangerous = containsDangerousKey(segments);
  if (dangerous !== undefined) {
    return { ok: false, code: 'MVU_PATH_DANGEROUS_KEY', detail: { key: dangerous } };
  }
  const reserved = touchesReservedField(segments);
  if (reserved !== undefined) {
    return { ok: false, code: 'MVU_PATH_RESERVED_FIELD', detail: { field: reserved } };
  }
  return { ok: true, pathSegments: segments };
}

/** 输入预算常量（core-12）。 */
export const INPUT_LIMITS = {
  maxMessageBytes: 64 * 1024,
  maxCommandCount: 128,
  maxValueBytes: 32 * 1024,
  maxNestDepth: 32,
} as const;

/** 校验单次更新文本的大小。 */
export function guardMessageSize(content: string): { ok: boolean; code?: string } {
  const bytes = byteLength(content);
  if (bytes > INPUT_LIMITS.maxMessageBytes) {
    return { ok: false, code: 'MVU_INPUT_TOO_LARGE' };
  }
  return { ok: true };
}

/** 校验命令条数。 */
export function guardCommandCount(count: number): { ok: boolean; code?: string } {
  if (count > INPUT_LIMITS.maxCommandCount) {
    return { ok: false, code: 'MVU_TOO_MANY_COMMANDS' };
  }
  return { ok: true };
}

/** 校验结构化值的大小（JSON 序列化后字节数）。 */
export function guardValueSize(value: unknown): { ok: boolean; code?: string } {
  let bytes = 0;
  try {
    bytes = byteLength(JSON.stringify(value));
  } catch {
    return { ok: false, code: 'MVU_VALUE_TOO_LARGE' };
  }
  if (bytes > INPUT_LIMITS.maxValueBytes) {
    return { ok: false, code: 'MVU_VALUE_TOO_LARGE' };
  }
  return { ok: true };
}

/** 估算嵌套深度（对象/数组），超限返回 false。 */
export function checkNestDepth(value: unknown, limit: number = INPUT_LIMITS.maxNestDepth): boolean {
  if (limit < 0) return false;
  if (value === null || typeof value !== 'object') return true;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!checkNestDepth(item, limit - 1)) return false;
    }
  } else {
    for (const key of Object.keys(value as object)) {
      if (!checkNestDepth((value as Record<string, unknown>)[key], limit - 1)) return false;
    }
  }
  return true;
}

/**
 * 逐个 UTF-16 code unit 计算标准 UTF-8 字节长度。
 * 修改意图：QuickJS 不提供 TextEncoder，依赖该宿主全局会让保存数值在预算校验阶段抛错，
 * 因此在核心内完成跨引擎确定性计数；孤立代理项按 U+FFFD 计为三字节。
 */
export function byteLength(value: string): number {
  let bytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }

  return bytes;
}
