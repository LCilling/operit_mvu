# Task 9B1 independent-review fix report

## Scope

This follow-up stays inside the Task 9B1 browser UI, demo native bridge, UI audit, and focused DOM test surface. It does not change `src/**`, backend field-template tests, package metadata, manifests, versions, rule/advanced pages, progress tracking, or artifacts.

## Confirmed findings and fixes

1. **Committed field saves cannot be duplicated.** The field editor now has an in-flight submit lock and disables its save control while a mutation is pending. Mutation and authoritative refresh are separate phases. If `addField`/`updateField` commits but snapshot/list refresh fails, the editor says the field was saved, removes the mutation action, and offers only a field-list reload. A repeated click cannot issue a second mutation.
2. **Stale re-preview validates retained mappings.** Previous mappings survive only when the local actor/group still exists with the required kind. Removed or wrong-kind targets are dropped and counted as a named `已移除失效映射` repair category. Fresh preview suggestions are trusted from the new preview; manually retained targets are resolved against the current local directory.
3. **A target is unique within one field.** Duplicate preview suggestions remain unmapped. Picker commits reject targets already assigned to another source mapping, and a centralized pre-submit validator blocks malformed state before native import. Update decisions are exempt because they intentionally preserve local bindings and send no mapping.
4. **Large legal template views are bounded.** Content fields, dependencies, conflicts, mapping fields, source rows, mapped-target summaries, and export selections/matrices use searchable five-row windows with explicit `显示 x–y / 共 n 条` copy. Pagination replaces unbounded expansion; no `加载更多` control is introduced.
5. **Conversation bindings preserve unrelated sessions.** Selecting or clearing the current conversation only adds/removes the current chat ID. Other chat IDs are preserved. Collapsed advanced management provides search, five-row pagination, readable current chat name, secondary IDs, exact-ID manual add/remove, and honest `名称不可用` copy when the host cannot enumerate historical chat names.
6. **Demo import has production-like failure semantics.** Demo import now validates revisions, field decisions, strategies, scope/type/existence, source coverage, per-field target uniqueness, and all three exact value policies: `template_value`, `keep_existing`, and `field_initial`. It applies changes atomically and persists imported values in demo `stateValues`; invalid imports reject instead of returning a synthetic success.
7. **Loading is not an error.** Template preview has an explicit loading state with progress copy/icon. Error UI stays empty until an actual failure occurs.
8. **Effect-reason compatibility has split boundaries.** Full response/persisted `defaultReason` DTOs accept legacy source text through 16,384 code units. Browser create/update requests retain the editor boundary of 512 code units, exact keys/enums, and visibly nonblank custom text.
9. **Export recommendations remain honest.** The backend protocol omits unchecked source targets, so the UI does not claim that a disabled recommendation or its value was exported. Import mappings remain explicit and never silently overwrite by source ID.

## Interaction and visual constraints

- All new high-cardinality controls remain searchable and bounded; field windows never exceed five rows.
- The existing inline Task 9B1 dialog hierarchy is retained. No root route, bottom-navigation item, or independent page was added.
- Newly added status, binding-name, binding-ID, and pagination text uses the OperitAI-aligned 14px/21px body rhythm and medium weight only where emphasis is required. Space is controlled with wrapping and pagination rather than smaller text.
- The existing reduced-motion contract remains intact, and the 320–430px single-column fallback keeps manual chat binding controls tappable without horizontal expansion.

## Strict TDD evidence

RED was captured before implementation with:

```text
pnpm run build:web
node tests/ui-task9-field-template-dom.test.cjs
```

The first review suite had 20 tests: 11 passed and 9 failed. Each failure corresponded to one confirmed behavior gap: duplicate save, committed-refresh recovery, stale local-target deletion, duplicate suggestions/manual mappings, large-preview DOM bounds, multi-chat preservation, demo value persistence/parity, loading/error separation, and the legacy-response/editor-request reason boundary.

GREEN after the implementation:

- `node tests/ui-task9-field-template-dom.test.cjs`: 20/20 passed.
- `node scripts/audit-v3-ui.mjs`: PASS (`modules: 7`, `roots: 4`).
- `node --check static/app_ui/app.js`, `pages-config.js`, and `runtime.js`: PASS.
- `pnpm run check`: PASS, including 237/237 Node tests and 4/4 existing DOM build-gate tests. Expected fault-injection diagnostics in record-store negative-path tests did not fail the suite.
- `pnpm run build`: PASS; generated `dist/app.html` at 9,360,022 UTF-8 bytes.
- `git diff --check`: PASS before staging; a staged diff check is required immediately before commit.

## Files in this review fix

- `static/app_ui/app.js`
- `static/app_ui/pages-config.js`
- `static/app_ui/runtime.js`
- `static/app_ui/styles.css`
- `scripts/audit-v3-ui.mjs`
- `tests/ui-task9-field-template-dom.test.cjs`
- this report

## Residual protocol and validation boundaries

- Export cannot encode an unchecked-but-retained source recommendation with a value under the current production protocol. Unchecked means omitted; the UI says so.
- The host currently exposes the active readable chat name but not a historical chat-name directory. Existing IDs are preserved and manageable, but unknown historical names remain honestly labelled and must be entered by exact ID.
- This review is verified at DOM, strict browser DTO, demo bridge, TypeScript, audit, and web-build levels. It does not install an APK or exercise the Android file chooser/storage permissions in MuMu; that remains release/integration validation.
- Existing untracked `artifacts/` and all backend-agent files are intentionally excluded from the commit.
