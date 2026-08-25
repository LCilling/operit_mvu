# Task 9C — Complete Condition Library UI Report

Date: 2026-08-26
Branch: `codex/mvu-v3-complete-redesign`
Commit message: `feat: complete condition library editor`

## Outcome

Task 9C is complete within Rules → 条件设定. No root navigation item, settings window, rule editor, effect editor, model, IPC parser, package, version, documentation, or artifact ownership was added or changed.

The condition library retains server-owned search and ten-row pagination, shows explicit `显示 x–y / 共 n`, and gives each row a readable expression, enabled state, reference status, whole-row open affordance, explicit toggle, and more-actions menu. New, view, edit, copy, toggle, and delete flows use the real condition IPC contract with exact revisions.

Referenced edits visibly identify affected rules. Delete always fetches references first: referenced conditions remain blocked with readable guidance, zero-reference deletion requires explicit confirmation, and larger reference sets use a searchable ten-row paged dialog.

## Recursive editor and predicate coverage

The editor preserves and serializes recursive AND, OR, NOT, and predicate nodes without flattening or dropping existing data. Every group exposes direct add-predicate, add-AND, add-OR, add-NOT, AND/OR conversion, and removal controls. NOT retains exactly one child by wrapping or replacing its child safely. Client and Demo validation enforce a non-empty valid expression, depth at most 12, at most 100 nodes, numeric/date/list limits, valid references, and unique valid AI IDs.

All production predicate kinds are visible and editable in the DOM and serialize with exact production keys:

- `recent_positive`, `long_inactive`, `user_care`, `special_day`
- `high_frequency`, `field_comparison`, `message_count`, `keywords`, `sender`
- `actor`, `group`, `concrete_date`, `repeating_date`, `ai_semantic`

Field, actor, and group predicates use the existing bounded searchable picker. Keyword/date lists use bounded text/chip-style counts. AI semantic cards show the stable ID, built-in trigger suggestions, direct custom trigger type input, requirement, and minimum confidence together. Existing AI predicates can be edited or removed; copied expressions receive fresh AI IDs.

## Mutation and Demo parity

Create/update/copy/toggle/delete calls carry the exact current `expectedRevision`. Mutation locks prevent duplicate submissions. Drafts survive validation, host, and stale-revision failures. Stale saves reload the latest authoritative revision while retaining the draft for explicit retry. A committed mutation followed by a failed refresh is shown as committed and offers refresh-only recovery, preventing accidental duplicate mutation.

Demo mode implements condition CRUD, reference paging, strict unknown-key and expression validation, field/actor/group reference validation, referenced-delete rejection, AI ID refresh on copy, atomic revision semantics, and authoritative query/entity/reference refresh behavior.

## TDD evidence

Behavior tests were added before each implementation slice and observed failing:

- Initial RED: 0/3 passed — ten-row condition library controls, exact complete serializer vocabulary, and referenced-delete blocking were absent.
- Second RED: existing 3 passed; 3 new failures — real DOM AI create, deep recursive edit/save, and copy/toggle/delete revision flows were absent.
- Third RED: 8/11 passed — stale revision recovery, paged references, and strict Demo unknown-key rejection failed.
- Fourth RED: 12/14 passed — committed list-refresh recovery and narrow/reduced-motion CSS contracts failed.
- Pressure/vocabulary RED: DOM transition setup and full predicate-card assertions exposed incomplete test stabilization; the final test verifies state-changing UI events and rendered per-kind controls.

Final GREEN:

- `node --test tests/ui-task9-condition-dom.test.cjs`: 16/16 passed.
- `node --test tests/ui-task9-field-template-dom.test.cjs`: 20/20 passed.
- `node scripts/audit-v3-ui.mjs`: PASS, seven modules and exactly four roots.
- `pnpm check`: PASS — all audits/typecheck/effect audit, 257/257 v3 tests, and 4/4 DOM gates.
- `pnpm build`: PASS; `dist/app.html` generated successfully.
- Syntax checks for `runtime.js`, `pages-rules.js`, `app.js`, and the audit script passed.
- `git diff --check`: PASS.

## 320px and 130% pressure evidence

The condition test launches installed Chromium at a 320px viewport for both 100% and the repository's real 130% text-only scaling fixture. It loads a depth-12 expression containing an AI semantic card and measures live layout:

| Scale | Body size / line | Nodes | document | app | editor | tree | off-screen cards |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 100% | 14px / 21px | 13 | 0px | 0px | 0px | 0px | 0 |
| 130% | 18.2px / 27.3px | 13 | 0px | 0px | 0px | 0px | 0 |

Both cases retained the required `Roboto, "Noto Sans SC", system-ui, sans-serif` stack and all three editable AI inputs. Targeted transitions use 200ms and become immediate under reduced motion. Text is wrapped rather than shrunk.

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

- Chromium pressure tests cover the web layout and real 130% fixture, but not every vendor WebView rendering quirk on physical Android devices.
- Reference search filters the currently loaded ten-row page; navigation remains server-paged so no unbounded rule directory enters the DOM.
- Impeccable's detector flags the mandated Roboto stack as a generic-font warning. The explicit product typography requirement takes precedence. Its side-accent warning was addressed by replacing the thick nested-card border cue with restrained icon color and shallow background depth cues.
