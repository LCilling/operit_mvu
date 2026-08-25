# Task 9 report

## Task 9A backend checkpoint — 2026-08-25

Task 9A implements the portable, versioned `operit-mvu-field-template` backend without changing the Configuration/Fields frontend. It is intentionally separate from the full-dataset backup contract and uses the existing v3 CAS store transaction path.

### Backend contract

- Export includes field definition/configuration, stages, appearance, natural/per-turn/AI settings, and bounded dependency counts. It excludes records, rules, conditions, effects, full dependency entities/IDs, bindings, and state values by default.
- Character and group values are serialized only for explicitly enabled targets with `includeValue: true`; readable source actor/group names accompany stable source IDs.
- Global templates have no actor/group matrix. Chat templates omit saved/source chat UUIDs and bind only to the importing runtime's current chat.
- Preview strictly validates the complete document, schema/version, checksum, exact keys, field/target/stage counts, text limits, model validity, scope references, conflicts, portable copy IDs, readable mapping needs, and deterministic range/step value adjustments without mutation.
- Import supports default `create_copy`, explicit `update`, and explicit `replace`; searchable mappings are supplied as IDs with per-target enable and value policy. Missing, duplicate, unknown, malformed, stale, or invalid input rejects before the single atomic `transactV3` call.
- Typed IPC parsers, clients, persistent-main handlers, and the native WebView bridge expose `exportFieldTemplate`, `previewFieldTemplateImport`, and `importFieldTemplate`.
- The export host accepts no caller path, validates the backend-generated filename, creates `/sdcard/Download/Operit/exports`, checks both host file-operation results, writes the selected template JSON, and returns `fileName`, `savedPath`, and exact field/target/value counts.

### TDD and verification

- Initial interface/core RED contract: commit `5225c37`; atomic core GREEN: commit `5b6f4ef`.
- Expanded acceptance RED isolated three missing IPC/bridge/runtime boundaries at 13/16 passing; a final edge RED covered bounded copy IDs and initial step alignment. The focused suite is 17/17 passing.
- `pnpm check`: PASS — manifest/web/v3/effect audits, typecheck, 209/209 Node tests, fresh-build DOM gate 4/4.
- `pnpm build`: PASS — all audits/typecheck and web build; `dist/app.html` 9,248,481 UTF-8 bytes.
- `git diff --check`: PASS before checkpoint commit.

### Scope and residuals

- No `static/app_ui` file, release version, or release metadata was modified.
- Existing untracked Task 8 artifacts remain untracked and untouched.
- Task 9B still owns the Configuration/Fields visual import/export flow and the other Task 9 editors. Modified APK/MuMu/real-host acceptance remains Task 11.
