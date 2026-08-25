# Task 8 implementation report

## Status and commits

- Status: complete.
- Implementation: `527ff57d667b982a5994eaf2fea4940312bcf926` (`feat: add searchable paged MVU lists`).
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
