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

## Independent review fix round 2 — 2026-08-25

### Code checkpoint

- Code/tests/package commit: `5d7ef15da555fc66b2c2e527898903e2ce4d6de4` (`fix: close task 8 independent review gaps`).
- The checkpoint contains findings 1–4 first, then the executable DOM gate and bounded browser-smoke increment. No artifact path is tracked by the commit.
- Release target/version, release metadata, and the separate OperitAI worktree remain untouched.

### Six confirmed findings and fixes

1. The status actor finder now derives its visible total from the authoritative current-group `queryActors` result, sends the active `groupId` through `openStatusPicker`, and locks that server filter. The demo's `group-a` has 50 authoritative members, including tail members beyond 30; an outsider is absent from both pages and cannot be selected into the group context.
2. The former 3,840-total fatal gate is gone. Valid first pages with totals 3,841, 100,000, or larger remain usable and searchable. The retained-page cap pauses only a subsequent auto-fetch, preserves retained rows and selected pins, asks the user to narrow search, and deliberately offers no destructive retry action.
3. `patchManagementList` records and re-resolves logical search/filter/pagination focus, preserves the live scroll container and `scrollTop`, and falls back to the remaining enabled pagination control at a tail page. Status context commits await `ViewTransition.updateCallbackDone`, then resolve the logical opener in the newly rendered context instead of focusing a detached node or `BODY`.
4. Query response validation now uses method/mode page ceilings plus safe-integer totals rather than a global 10,000 ceiling. `queryRecords` accepts 100,000 and the selected edge policy accepts `Number.MAX_SAFE_INTEGER`; negative values and values above the safe-integer boundary fail closed. Existing 5/10/30 item ceilings, loaded-count coherence, cursor progress/non-reuse, and `hasMore`/`nextCursor` equivalence remain enforced.
5. The DOM regression is now an executable repository gate. `pnpm run test:dom` performs a fresh web build and runs three live-DOM behavioral tests through declared `happy-dom@20.11.6`; `pnpm run check` invokes it. A deliberate mutation that removed pagination focus restoration failed the gate with an undefined logical route/direction/page, then the restored production line returned GREEN. Declared `playwright-core@1.62.1` and system Chrome/Edge executable discovery support the optional real-browser smoke without `NODE_PATH` or an undeclared full Playwright package.
6. The smoke now uses current opaque `demo_c1_*` cursors, asserts 60 retained rows with only 15–16 rendered rows (bounded at 24), verifies spacers/back-window accessibility, exact noun-bearing count copy, four roots, no `加载更多`, and zero horizontal overflow. The 130% fixture scales both font size and line height. A 320px/130% RED first exposed title line-height remaining 28px instead of 36.4px; after fixing the fixture it exposed a 38px/39px title clipping edge, fixed by one pixel of block padding without shrinking the 21px title or 14px body.

Count-copy behavior is asserted independently with the required noun/unit form, including `已显示 5 个字段 / 匹配 51 个字段 / 共 51 个字段` and page-two semantics. The stable browser demo has 13 fields, so its exact page-one and page-two evidence is `已显示 5 个字段 / 匹配 13 个字段 / 共 13 个字段`.

### RED, GREEN, and mutation evidence

- Finding 1 RED: three focused assertions failed because the status page used the all-actor total, the actor picker request omitted the active `groupId`, and the current-group filter could be broadened to expose an outsider.
- Findings 2 and 4 RED: four focused assertions failed on valid huge totals, the retained-page boundary, retry behavior, and noun-bearing count output. The old validator rejected 3,841+/100,000 responses before the first page could render.
- Finding 3 RED: two focused DOM/controller assertions left pagination/status focus on a detached/BODY surrogate and did not preserve the expected scroll/focus identity across the asynchronous patch.
- Finding 5 environment RED: the fresh-build DOM command failed with `Cannot find module 'playwright'`, proving the dormant script depended on an undeclared environment. The final mandatory gate instead uses the declared live-DOM runtime; the optional browser runner uses declared `playwright-core` plus executable discovery.
- Finding 6 RED: the actual 320px/130% run first reported unscaled title line-height, then a clipped title after line-height scaling. Both defects were corrected before the final matrix.
- Focused `node --test tests/query.test.mjs tests/ui-shell.test.mjs`: 91/91 pass.
- Full `pnpm run check`: PASS — audits/typecheck/effects pass, 192/192 Node tests pass, and the fresh-build DOM gate passes 3/3.
- `pnpm run build`: PASS; `dist/app.html` is 9,248,481 UTF-8 bytes.
- `git diff --check` and staged diff checks: PASS.

### Browser and typography evidence

The bounded local Chrome matrix passed 8/8 at 320/360/393/430 CSS pixels × 100%/130%. It covers title, body, management and picker search/filter controls, pagination, stage, and trend typography; every checked text target uses `Roboto, "Noto Sans SC", system-ui, sans-serif` with no `Segoe UI`. Body/title are 14px/21px at 100% and 18.2px/27.3px at 130%; line-height scales from 21px/28px to 27.3px/36.4px. No checked target clips, overlaps, leaves the viewport, or creates horizontal overflow.

Evidence is untracked under `D:\ProjectFile\operit_mvu\.worktrees\mvu-v3-complete-redesign\artifacts\task-8-remediation-r2`:

- `picker-{320,360,393,430}-{100,130}.png`
- `detail-320-130.png` and `detail-430-100.png`
- `result.json`

The final evidence folder has 11 files with manifest SHA-256 `51266be73fb2380ed8620fb8187689477c3a2c40bb009557c66a45b497cb6361` (sorted `relative-path|length|file-sha256` records).

One final Impeccable detector invocation scanned all changed production UI targets plus the text-scale fixture. It reported one `overused-font` finding for `Roboto`. That heuristic conflicts directly with the approved OperitAI host authority in `D:\ProjectFile\OperitAI\app\src\main\java\com\ai\assistance\operit\ui\theme\Type.kt` (`FontFamily.Default`), so the existing design authority wins: the required Android-default stack is retained, Material Symbols remains icon-only, and there were no other detector findings.

### Artifact preservation and residuals

- Every one of the 15 pre-existing files in `artifacts/task-8-browser-smoke` still matches the baseline per-file SHA-256 recorded before this round. Its aggregate sorted manifest SHA-256 is `8721de91cab97af41039bdace2b4c1c962c68323c1effbec922009770f0c4a52`.
- Only `artifacts/task-8-remediation-r2` received new evidence. No artifact path is staged or committed.
- No local Task 8 server/process remains running.
- No known Task 8 production, test, DOM, or browser regression remains. The sole detector item is the intentional host-font requirement described above.
- Modified APK/MuMu and real-host acceptance remain the existing Task 11 gate.
