# Task 9 report

## Task 9A backend checkpoint — 2026-08-25

Task 9A implements the portable, versioned `operit-mvu-field-template` backend without changing the Configuration/Fields frontend. It is intentionally separate from the full-dataset backup contract and uses the existing v3 CAS store transaction path.

### Backend contract

- Export includes field definition/configuration, stages, appearance, natural/per-turn/AI settings, and a bounded readable list of intentionally omitted dependencies. Dependency entries contain only kind, source ID, and readable name; they cover link rules, rules, recursively field-referencing/shared conditions, and effect groups without serializing entity payloads.
- Character and group values are serialized only for explicitly enabled targets with `includeValue: true`; readable source actor/group names accompany stable source IDs.
- Global templates have no actor/group matrix. Chat templates omit saved/source chat UUIDs and bind only to the importing runtime's current chat.
- Preview strictly validates the complete document, schema/version, checksum, exact keys, field/target/stage/dependency counts, text limits, model validity, scope references, conflicts, portable copy IDs, readable mapping needs, stable-ID/unique-name suggestions, omitted-dependency repair warnings, and deterministic range/step value adjustments without mutation.
- Import supports default `create_copy`, explicit `update`, and explicit `replace`; searchable mappings are supplied as IDs with per-target enable and value policy. Scope-changing updates are unavailable and rejected before transaction so existing bindings/state cannot be reinterpreted.
- Definition-only character/group templates use explicit `unboundTargets`, allowing users to enable any local targets or create an inactive field with every offered target disabled. Template values are forbidden when no source value exists, and duplicate, cross-kind, missing, or context-inappropriate targets reject atomically.
- Missing, duplicate, unknown, malformed, stale, or invalid input rejects before the single atomic `transactV3` call. A composition test exercises the real `V3MvuStore`/`FileMvuStore` CAS path, verifies one atomic publication, restart durability, and stale-revision rejection without a second write.
- Typed IPC parsers, clients, persistent-main handlers, and the native WebView bridge expose `exportFieldTemplate`, `previewFieldTemplateImport`, and `importFieldTemplate`.
- The export host accepts no caller path, validates the backend-generated filename, creates `/sdcard/Download/Operit/exports`, checks both host file-operation results, writes the selected template JSON, and returns `fileName`, `savedPath`, and exact field/target/value counts.

### TDD and verification

- Initial interface/core RED contract: commit `5225c37`; atomic core GREEN: commit `5b6f4ef`.
- Expanded acceptance RED isolated three missing IPC/bridge/runtime boundaries at 13/16 passing; a final edge RED covered bounded copy IDs and initial step alignment. The original focused suite reached 17/17 passing.
- Protocol review RED was independently confirmed at 14/24 passing with ten expected failures across cross-scope update safety, definition-only mapping, match suggestions, readable omitted dependencies, and typed IPC shape. GREEN is 24/24.
- `pnpm check`: PASS — manifest/web/v3/effect audits, typecheck, 216/216 Node tests, fresh-build DOM gate 4/4. Expected negative-path atomic-store diagnostics were emitted by passing fault-injection tests.
- `pnpm build`: PASS — all audits/typecheck and web build; `dist/app.html` 9,248,481 UTF-8 bytes.
- Final diff/staging checks are recorded with the fix commit.

### Scope and residuals

- No `static/app_ui` file, release version, or release metadata was modified.
- Existing untracked Task 8 artifacts remain untracked and untouched.
- Task 9B still owns the Configuration/Fields visual import/export flow and the other Task 9 editors. Modified APK/MuMu/real-host acceptance remains Task 11.
