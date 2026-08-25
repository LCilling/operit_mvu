# Task 8 implementation report

## Status and commits

- Status: complete.
- Implementation: `527ff57d667b982a5994eaf2fea4940312bcf926` (`feat: add searchable paged MVU lists`).
- Review fix round 1: `217f96851b38d7c9dbcee875ed714615c5cda3d5` (`fix: harden searchable paged MVU lists`).
- Report/progress: committed separately after this report was written; the exact SHA is recorded in the controller handoff.

## Changed files

- `scripts/audit-v3-ui.mjs`
- `static/app_ui/app.js`
- `static/app_ui/components.js`
- `static/app_ui/pages-config.js`
- `static/app_ui/pages-rules.js`
- `static/app_ui/pages-status.js`
- `static/app_ui/runtime.js`
- `static/app_ui/styles.css`
- `tests/ui-shell.test.mjs`
- `tests/ui-task8-browser-smoke.cjs`

## TDD evidence

RED was observed before each replacement-controller fix:

- `node --test --test-name-pattern="demo management|management route|picker" tests/ui-shell.test.mjs`: 5 failures from missing management list state/API and picker behavior.
- `node scripts/audit-v3-ui.mjs`: 18 Task 8 violations.
- The new count/demo/pinned tests failed 3/4 cases against the inherited implementation.
- The stable-opener regression failed with focus left on the BODY surrogate when the click target was supplied independently of `document.activeElement`.
- Local Playwright then reproduced the optional-grid defect (a 140px footer at 320px) and replayed picker entrance animation after selection rerenders before their focused fixes.

GREEN and full verification:

- Focused `tests/ui-shell.test.mjs`: 29/29 pass, including 9 Task 8 behaviors.
- `pnpm run check`: PASS; UI audit, typecheck, effects audit, and 171/171 Node tests pass.
- `pnpm run build`: PASS; `dist/app.html` built at 9,219,074 bytes.
- `git diff --check`: PASS.
- Impeccable final detector: `[]` for all seven changed UI targets.

The behavioral suite exercises live demo query search/filter/sort/pagination, stale async response rejection, preserved failed-search input and selection, pinned-selection DOM bounds, focus restoration, keyboard/Escape behavior, immediate single selection, explicit multi-selection confirmation, cursor auto-fetch, exact page sizes, visible ranges, and authoritative totals. Unfiltered counts render `本页 x–y / 共 X`; filtered counts render `本页 x–y · 匹配 X / 共 Y`, with `Y` sourced from compact snapshot counts rather than client-side full arrays.

## Browser smoke

The local Playwright/Chrome smoke used the repository runtime's built-in deterministic demo controls and passed at 320, 360, 393, and 430 CSS pixels at both 100% and actual 130% text scaling (8/8 matrix cases). Every case reported four navigation roots, zero document/app/picker horizontal overflow, a viewport-bounded picker, and 14px/18.2px body type respectively. It passed picker autofocus, debounced search, stale-response discard, two near-boundary cursor fetches with a 60-row DOM cap, close/Escape/cancel/single-commit/multi-confirm focus restoration, failure preservation, 30 selected IDs with only 12 rendered pins plus `另 18 项`, exact 5/5/10/10/10 pages and absence of `加载更多`.

Visual evidence:

- `D:\ProjectFile\operit_mvu\.worktrees\mvu-v3-complete-redesign\artifacts\task-8-browser-smoke\picker-search-stale-393.png`
- `D:\ProjectFile\operit_mvu\.worktrees\mvu-v3-complete-redesign\artifacts\task-8-browser-smoke\picker-pinned-window-393.png`
- `D:\ProjectFile\operit_mvu\.worktrees\mvu-v3-complete-redesign\artifacts\task-8-browser-smoke\paged-lists-filtered-430.png`
- Responsive screenshots: `picker-{320,360,393,430}-{100,130}.png` in the same directory.
- Machine-readable matrix: `D:\ProjectFile\operit_mvu\.worktrees\mvu-v3-complete-redesign\artifacts\task-8-browser-smoke\result.json`

## Residual concerns

- No known Task 8 code, test, detector, or local-browser residual remains.
- Modified APK/MuMu and real-host acceptance remain the existing Task 11 release gate.
- Browser screenshots and `result.json` remain untracked verification artifacts by design.
- Playwright was resolved from the local Codex runtime through `NODE_PATH`; no dependency or release metadata was added to the repository.
- The release target/version was untouched.

## Review fix round 1 — 2026-08-25

### Confirmed fixes

- Status role/group selectors now expose server-backed `查找角色` / `查找群组` pickers with authoritative totals, so entities beyond the compact 30-item directory remain reachable.
- Every `queryFields` page and field detail lookup returns the active-context projection (`currentValue`, `currentStage`, `bindingDisplay`, and `scopeKey`); the page-two UI and detail route no longer depend on the compact first page.
- Picker/list responses patch their owned regions and preserve live input identity, selection, focus, option focus, and scroll position instead of replacing `appRoot`.
- Picker results use retained, raw-ID-deduplicated data plus a bounded virtual row window and spacers. Selected IDs are excluded from normal results; pinned rendering remains bounded while state preserves every selection.
- Visible field and actor/group filters are server-owned. List copy is exactly `已显示 X / 匹配 Y / 共 Z`, where `Y` comes from the filtered query and `Z` comes from the unfiltered compact snapshot/directory count.
- Response validation enforces method/mode page ceilings (5/10/30), item/count coherence, total bounds, cursor progress/non-reuse, and exact `hasMore`/`nextCursor` combinations. Invalid responses fail closed without automatic retry loops.
- Demo cursors are opaque, one-shot, and bound to entity/search/filter state; deterministic delay, failure, oversize, and bad-cursor controls coexist with stable management fixtures.
- The final focus regression was caused by the asynchronous status-context commit rerender occurring after the picker's immediate close restoration. `commitEntityPicker` now restores immediately on close and re-resolves the logical opener after the commit promise settles on either success or failure. The exact controller reproduction is GREEN.

### TDD and final gates

- Focused `node --test tests/query.test.mjs tests/ui-shell.test.mjs`: 83/83 pass, including `single commit restores its logical opener again after an asynchronous context rerender`.
- `pnpm run check`: PASS; audits, typecheck, temporary-effect regression, and 184/184 Node tests pass.
- `pnpm run build`: PASS; `dist/app.html` built at 9,243,981 bytes.
- `git diff --check`: PASS before the code commit; the staged code diff also passed `git diff --cached --check`.
- The priority checkpoint explicitly stopped further browser/demo runs. No remediation screenshots or metrics were added, and no artifact path was staged or committed. The existing `artifacts/task-8-browser-smoke` evidence remained untracked and untouched.
- No new Impeccable detector was run after the review fixes because the final checkpoint limited work to the enumerated check/build/diff/audit/commit actions. The earlier Task 8 detector result was `[]`, but it is not claimed as post-fix detector evidence.

### Six-line `audit-v3-ui.mjs` deletion review

The six deleted physical lines are three obsolete two-line source-text assertions; each is replaced by executable behavior coverage:

1. The old `PICKER_RESULT_LIMIT = 60` plus `slice(-PICKER_RESULT_LIMIT)` assertion required destructive tail slicing. That contradicts true virtualization because it makes earlier pages unreachable. `picker virtual window retains deduped cursor pages, excludes pins, and back-scrolls to the first page` now loads overlapping cursor pages, asserts raw-ID deduplication and 89 retained rows, bounds rendered options to 18, verifies spacers/deep rows, and then scrolls back to the earliest retained row. `picker rendering bounds pinned DOM while preserving every selected ID` covers the separate pinned window.
2. The old `<select ... fields ...>` text regex could reject the new bounded scope/type/enabled filter selects and could not prove that entity data was bounded. `status directories expose full role and group picker entries and field picker renders server filters` verifies picker triggers/totals and the bounded field filters; `management and picker filter controls send typed filters to their server queries` verifies the field picker issues `queryFields` with `mode: picker`; and `tests/ui-task8-dom-behavior.cjs` opens the rule field selector as the searchable `选择字段` dialog. No unique coverage was lost.
3. The old `const counts = filtered ... 本页` source regex encoded the superseded implementation/copy shape. `management count copy is exact and distinguishes matched totals from authoritative all totals` asserts exact unfiltered and filtered output for fields, rules, conditions, effects, and records. The retained static audit still verifies that all-total values come from compact snapshot counts.

### Typography decision

The host authority is `D:\ProjectFile\OperitAI\app\src\main\java\com\ai\assistance\operit\ui\theme\Type.kt`: `FontFamily.Default`, `bodyLarge` 16sp/24sp/Normal, `titleLarge` 22sp/28sp/Normal, `labelSmall` 11sp/16sp/Medium, with global `fontScale`. The plugin intentionally keeps its established 14px/21px body density and 21px/28px regular page title, does not shrink them, and uses `Roboto, "Noto Sans SC", system-ui, sans-serif` without `Segoe UI` or a body/display webfont. `Material Symbols Rounded` remains icon-only. This tradeoff is also recorded in `docs/design.md`.

### Current residuals

- No known code or test regression remains in the review-fix scope.
- Post-fix browser and Impeccable reruns were intentionally omitted by the final priority checkpoint, not reported as passing.
- Modified APK/MuMu and real-host acceptance remain the existing Task 11 release gate.
- Release target/version and OperitAI sources were not modified.
