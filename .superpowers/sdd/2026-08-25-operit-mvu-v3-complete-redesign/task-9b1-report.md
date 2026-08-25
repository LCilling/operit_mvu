# Task 9B1 report — field editor and portable field-template UI

## Scope and outcome

Task 9B1 completes the Configuration → Fields workflow without adding a root route, bottom-navigation item, or standalone settings page. The code commit is `76248f2`.

- The server-owned field list remains five rows per page with its existing search and filters. Each row has explicit view and edit actions, and the page now exposes integrated “导入字段” and “导出字段” actions.
- The field editor is a state-backed form rather than DOM-only state. Basic information, scope, appearance, and detailed configuration share one section-heading hierarchy. It saves new and existing fields through exact `addField({ field })` and `updateField({ id, patch })` requests, then reloads the authoritative snapshot/list.
- Character and group scopes share the bounded searchable entity picker, show readable names before IDs, and retain selections through rerenders. Global scope has concise product copy. Conversation scope uses a natural name, binds the currently open readable conversation by default, and keeps the optional inactive-template binding switch in collapsed advanced details.
- Numeric minimum, maximum, step, initial value, stages, appearance, and required automation configuration are editable and validated inline. Host failures preserve the user's draft and can be corrected and retried.
- Typography remains aligned with OperitAI: `Roboto, "Noto Sans SC", system-ui, sans-serif`, 14px/21px body text, 21px/28px titles, and normal/medium weights. Material Symbols remain icon-only.

## Portable export flow

- Export is an accessible inline modal/drawer inside the fields configuration flow. Fields and potentially large character/group target sets are chosen only through searchable pickers; the page never expands an unbounded target list.
- Each selected field always carries its definition/configuration. Character/group fields expose a target matrix with explicit inclusion and current-value controls. Global fields have no actor matrix; conversation fields explain current-session behavior.
- The UI explicitly explains that source target IDs are mapping suggestions and will not silently overwrite local entities during import.
- The production request matches the backend protocol exactly. The UI consumes only `fileName`, `savedPath`, and `summary`; it does not depend on a `response.json` field. A successful `savedPath` is surfaced in the toast.
- Demo native stores an internal generated JSON fixture only so the DOM flow can be exercised; this behavior is not required from or used by the production bridge.

## Import flow and recovery

- A dedicated JSON file input is the only import source and resets after every selection so the same file can be selected again.
- The integrated flow has three visible steps: content preview, conflict policy, and character/group mapping. It calls `previewFieldTemplateImport` before commit and sends the returned `previewRevision` with the exact `expectedRevision` to `importFieldTemplate`.
- Conflict policy defaults to `create_copy` and offers `update` and `replace` only as explicit choices.
- Mapping uses readable local names with secondary IDs and exact backend value policies: `template_value`, `keep_existing`, and `field_initial`.
- Each field mapping provides “全部启用”, “全部停用”, and “采用文件建议”. Individual local targets still have an explicit enable switch and value policy. These UI-only suggestions are removed before the native payload is built.
- Range/step adjustments, dependency omissions, and invalid references are shown as separate, deduplicated repair categories. The final result displays native `created`, `updated`, `replaced`, `skippedTargets`, and `valueWrites`; repair work is derived honestly from preview data rather than inventing a native `repair` result.
- A stale revision exposes “重新预览当前文件”, re-previews the same parsed file, advances the revision, and retains compatible conflict/mapping choices. Incompatible choices fall back to `create_copy` with an explicit prompt to review again.
- Preview, save, export, and import host errors stay inline. They do not silently close the flow or discard state.

## Accessibility, responsive behavior, and motion

- The template dialog uses `role="dialog"` and `aria-modal="true"`, closes with Escape, traps Tab and Shift+Tab, ignores inner-content overlay clicks, and restores focus to the logical import/export opener. File-input import restores to the visible “导入字段” button.
- Search pickers use stable logical openers, so their state and focus survive shell rerenders.
- At 320, 360, 393, and 430 CSS pixels, browser measurements found `documentElement.scrollWidth === innerWidth`, body width equal to viewport width, and zero overflowing descendants. A 331px equivalent usable width check (430px at 130% layout pressure) also reported zero overflow.
- Dialog controls remain compact but tappable. Short 180ms transitions are targeted, and the new batch controls join the existing `prefers-reduced-motion` immediate-state rules.

## Strict runtime contract

- Complete effect-group browser DTO validation now requires exact `defaultReason` keys `{ mode, template, text }`, exact mode/template enums, a 512-code-unit text maximum, and non-blank custom text. Missing or unknown keys fail closed.
- Full demo effect-group entities provide a complete default reason. Summary DTOs remain summaries and are not incorrectly required to contain the full definition field.

## TDD evidence

RED was captured before implementation:

- The UI audit reported nine missing Task 9B1 contract checks.
- The first focused DOM suite failed five field-editor/template behaviors.
- Follow-up acceptance tests independently failed before stale-revision recovery, categorized repair work, internal-overlay protection/focus restoration, and strict `defaultReason` validation were implemented.
- The final acceptance increment failed before per-field “全部启用/全部停用/采用文件建议” behavior and honest export mapping copy were added.

GREEN and regression evidence after the final code change:

- `pnpm run build:web && node tests/ui-task9-field-template-dom.test.cjs`: 12/12 pass.
- `node scripts/audit-v3-ui.mjs`: PASS.
- `pnpm run check`: PASS — manifest/web/v3/effect audits, typecheck, 234/234 Node tests, and 4/4 existing Task 8 DOM tests. Fault-injection diagnostics printed by the record-store negative-path tests are expected passing-test output.
- `pnpm run build`: PASS; `dist/app.html` generated at 9,333,330 UTF-8 bytes.
- `git diff --check` and staged `git diff --cached --check`: PASS.
- Browser responsive inspection: 320/360/393/430px plus 331px equivalent pressure, all with zero horizontal overflow; computed body typography was 14px/21px with the OperitAI-aligned stack.

## Known protocol boundary and residual validation

- The current backend export protocol represents only included/enabled source targets. It cannot serialize a separate disabled-but-suggested target. Therefore an unchecked export target is honestly omitted; the UI does not claim that a disabled recommendation was exported. Import still supports explicit per-target enable state and the three per-field batch controls.
- Production import remains file-input-only and production export remains host-path-only by contract.
- This task verified demo/native-bridge behavior in DOM and responsive browser runs. It did not install an APK or run the Android host inside MuMu; real-host APK integration, file chooser/storage permissions, and final visual acceptance remain the release/integration task.
- Concurrent backend-agent files under `src/**` and backend tests, plus existing `artifacts/`, were deliberately left unstaged and are not part of the Task 9B1 code commit or this report commit.
