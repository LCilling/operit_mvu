# Task 7 Final Fix Round Implementation Plan

> Execute this approved plan without another design checkpoint. Keep the 3.0.0 release target unchanged.

## Goal

Close the remaining Task 7 review gaps with fail-closed runtime contracts, context-correct navigation, a crash-safe legacy record-index backfill, and verified mobile/accessibility behavior.

## Commit 1: Runtime contracts and context projection

**Files:** `static/app_ui/runtime.js`, `static/app_ui/app.js`, `scripts/build-web.mjs`, `tests/ui-shell.test.mjs`

1. Add failing tests for initial group-scoped actor-directory loading and group-to-character switching with missing/invalid actor history.
2. Add failing malformed-payload cases for nested stages/actions/field effects/condition expressions, records, actor/group DTOs, and entity-kind mismatches.
3. Make status-mode switching transactional: resolve the selected group directory and actor snapshot before publishing character mode.
4. Implement per-kind recursive validators with a bounded condition depth and exact requested-entity validation.
5. Make demo snapshot/query data honor actor/group parameters with visibly distinct values and nonuniform stages.
6. Make the build output report UTF-8 bytes with `Buffer.byteLength` and cover it with a behavioral build test.

## Commit 2: Legacy filtered-record index backfill

**Files:** `src/mvu/app/record-store.ts`, `src/mvu/app/store-v3.ts`, `src/mvu/app/query.ts`, `tests/record-store.test.mjs`

1. Add failing tests for a valid legacy v3 manifest with many missing `filterCounts`, exact totals, one-time publication, and bounded filtered reads.
2. Add a publication-failure/retry test proving valid v3 remains authoritative and filtered queries fail closed without segment scans.
3. Have startup validation compute exact missing per-segment counts while it performs required integrity scans.
4. CAS-check the loaded revision/manifest before atomically publishing the backfilled manifest.
5. Expose pending indexing status on publication failure and reject filtered queries until a retry/restart publishes the index.
6. Remove the per-query legacy segment-scan fallback.

## Commit 3: Range, reduced motion, and verification report

**Files:** `static/app_ui/app.js`, `static/app_ui/styles.css`, `scripts/audit-v3-ui.mjs`, `tests/ui-shell.test.mjs`, `tests/fixtures/ui-native-malformed.html`, Task 7 report/progress docs

1. Add failing tests proving empty and whitespace range values are invalid before numeric coercion.
2. Replace blanket reduced-motion overrides with targeted route/drawer/control/view-transition rules while preserving immediate focus and selected-state feedback.
3. Run targeted RED/GREEN tests, `pnpm run check`, `pnpm run build`, and `git diff --check`.
4. Run the Impeccable detector once.
5. Test 320/360/393/430 px at real 100% and 130% text, plus empty range, arbitrary nonuniform stages, group/actor projection changes, and malformed NativeMvu recovery.
6. Record exact counts, measurements, residuals, and commit SHAs in Task 7 report/progress docs.

## Completion

- Commit 1: `d9240f9`
- Commit 2: `604163b`
- Commit 3: `ef61492`
- Final checks: `162/162` tests, production build `9,176,851` UTF-8 bytes, `git diff --check` clean.
- Browser: `40` route/scale cases at `320/360/393/430 × 100/130`, no overflow or clipped/off-screen actions; exact nonuniform stage anchors and zero label collisions at the narrowest 130% case.
- Final Impeccable detector: `[]` (run once after UI edits).
- Release target: `3.0.0`, unchanged.
