# Task 9C — Complete Condition Library UI Report

Date: 2026-08-26
Branch: `codex/mvu-v3-complete-redesign`
Original commit: `a1bb95c feat: complete condition library editor`
Follow-up commit message: `fix: harden condition editor UX`

## Outcome

Task 9C remains entirely under Rules → 条件设定. No root navigation item, settings window, rule/effect editor feature, model/parser, package/version, or artifact change was introduced.

The condition library retains server-owned search and ten-row pagination with explicit `显示 x–y / 共 n`. Rows expose readable expression, enabled and reference status, whole-row view/edit, toggle, copy, and delete actions. Create/update/copy/toggle/delete use real condition IPC calls and exact revisions; Demo implements the same strict, atomic flow.

The recursive editor renders AND, OR, NOT, and all 14 production predicates as editable nested cards. The 14 kinds are individually exercised from DOM input through exact save payload and authoritative entity reload, not only through serializer tests:

- `recent_positive`, `long_inactive`, `user_care`, `special_day`
- `high_frequency`, `field_comparison`, `message_count`, `keywords`, `sender`
- `actor`, `group`, `concrete_date`, `repeating_date`, `ai_semantic`

## Independent-review hardening

1. Required numeric controls now have HTML `required` and use one `parseRequiredFinite` path that rejects raw empty strings before conversion. Required/optional numeric fields across every numeric predicate retain exact production-shaped numbers or omitted optional keys.
2. Concrete dates use year-aware Gregorian validation, so rolled dates such as `2026-02-31` fail. Repeating dates use each month's maximum, permit February 29, reject February 30/31, and visibly explain that February 29 triggers only in leap years.
3. UI and Demo enforce condition array/string boundaries: 100 entries, 256 code units per entry, keyword total bounds, field/AI string bounds, and 4,096-unit AI requirements. Demo rejects 101-item actor/group/date mutations without changing revision. Condition actor/group pickers stop at 100 and show the count plus a readable reason.
4. A failed reference read now states `影响范围未知`, never claims zero references, blocks save, preserves the draft, and provides a persistent retry. A successful retry restores the authoritative affected-rule summary and permits save.
5. Condition picker selected items are built from hydrated entity cache entries. Multiple selections outside the first cursor page render `名称 · ID`; missing labels still render the stable ID, including accessible removal labels.
6. Condition-tree rerenders restore focus to the same logical control. The reference modal receives initial focus, traps Tab/Shift+Tab, closes with Escape, and returns focus to its live delete opener.
7. At widths below 350px the picker footer stacks and wraps instead of shrinking text. The picker no longer uses hidden overflow as a mask; live Chromium measurements cover the footer, filters, pinned selection, results, buttons, and all tested internal containers.
8. A stale list mutation loads the latest authoritative revision and leaves a persistent recovery panel that prevents accidental repeat until the user explicitly rechecks the list.
9. The focused suite now parameterizes all 14 predicate cards through DOM entry, mutation payload, commit, and authoritative reload. It also covers reference retry, modal keyboard behavior, picker hydration/limit, and 130% picker pressure.

## TDD evidence

Review fixes were test-first and observed failing before implementation:

- First RED: 16/21 passed, 5 failed — required numeric semantics, Gregorian date validity, 101-item Demo bounds, unknown-reference copy, and save blocking.
- Second RED: five focused interaction gaps reproduced — picker item 101, off-cursor labels, tree focus restoration, reference-modal focus lifecycle, and Chromium picker overflow masking.
- Stale recovery RED: 2/3 focused tests passed; the stale list case timed out waiting for a persistent recovery entry.
- Repeating-date copy RED: 0/1 passed until the visible Gregorian/leap-day explanation was added beside the month/day controls.
- Hydrated-picker cache RED: 0/1 passed when direct confirmation duplicated the display ID; the display-only label is now stripped before the authoritative cache update.

Final verification:

- `node --test tests/ui-task9-condition-dom.test.cjs`: 29/29 passed.
- `node --test tests/ui-task9-field-template-dom.test.cjs`: 20/20 passed.
- `node --test tests/ui-shell.test.mjs`: 48/48 passed; `node tests/ui-task8-dom-behavior.cjs`: 4/4 passed.
- `node scripts/audit-v3-ui.mjs`: PASS, seven modules and exactly four roots.
- Syntax checks: `app.js`, `pages-rules.js`, `runtime.js`, and `audit-v3-ui.mjs` passed.
- `pnpm run typecheck`: PASS.
- `pnpm check`: an earlier full run passed with 271/271 v3 tests and 4/4 DOM gates. A final rerun after the shared worktree's out-of-scope `tests/model-budget.test.mjs` changed passed 260 in-scope v3 tests but failed that single concurrent test because it expects a `state-prompt` export absent from the concurrent build. That file was neither modified nor staged by Task 9C.
- Committed Node regression constructed with `git ls-files tests/*.test.mjs` and explicitly excluding the concurrent `tests/model-budget.test.mjs`: 260/260 passed across 13 files.
- `pnpm build`: PASS; `dist/app.html` generated successfully.
- `git diff --check`: PASS before staging and commit.

## 320px and 130% pressure evidence

Installed Chromium ran at a 320px viewport using both normal typography and the repository's actual 130% text-only fixture.

| View | Scale | document | app | tested inner containers | off-screen cards |
| --- | ---: | ---: | ---: | ---: | ---: |
| Depth-12 AI editor | 100% | 0px | 0px | editor/tree 0px | 0 |
| Depth-12 AI editor | 130% | 0px | 0px | editor/tree 0px | 0 |
| Open actor picker | 100% | 0px | 0px | every measured container 0px | 0 |
| Open actor picker | 130% | 0px | 0px | every measured container 0px | 0 |

The editor retained 14px/21px at normal scale and 18.2px/27.3px at 130%, with `Roboto, "Noto Sans SC", system-ui, sans-serif`. Picker/footer computed horizontal overflow is visible rather than hidden, while every measured `scrollWidth - clientWidth` is zero.

## Owned files

- `static/app_ui/pages-rules.js`
- `static/app_ui/app.js`
- `static/app_ui/runtime.js`
- `static/app_ui/styles.css`
- `scripts/audit-v3-ui.mjs`
- `tests/ui-task9-condition-dom.test.cjs`
- `.superpowers/sdd/2026-08-25-operit-mvu-v3-complete-redesign/task-9c-condition-ui-report.md`

`static/app_ui/components.js` was not needed. Existing untracked `artifacts/` content was preserved and excluded from the commit.

## Residual risks

- Chromium verifies the repository's real 320px/130% pressure fixture, but physical Android WebViews may still differ in vendor font metrics.
- Reference search remains intentionally bounded to the currently loaded server page; navigation provides the next/previous authoritative pages without creating an unbounded directory in the DOM.
