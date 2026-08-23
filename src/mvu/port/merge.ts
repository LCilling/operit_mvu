/**
 * port/merge.ts
 *
 * 从 MagVarUpdate 上游 `util/common.ts` 移植 `correctlyMerge`（修正 _.merge 对数组的
 * 合并逻辑：rhs 是数组时直接用 rhs 覆盖，[1,2,3] + [4,5] → [4,5]）。
 */

import { isArray, mergeWith } from './util';

export function correctlyMerge<TObject, TSource>(lhs: TObject, rhs: TSource): TObject & TSource {
  return mergeWith(lhs as Record<string, unknown>, rhs as unknown, (_lhs, sourceValue) =>
    isArray(sourceValue) ? sourceValue : undefined
  ) as TObject & TSource;
}
