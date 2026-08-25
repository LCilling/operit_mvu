# Task 9 report

## Task 9A backend checkpoint — 2026-08-25

Task 9A implements the portable, versioned `operit-mvu-field-template` backend without changing the Configuration/Fields frontend. It is intentionally separate from the full-dataset backup contract and uses the existing v3 CAS store transaction path.

### Backend contract

- Export includes field definition/configuration, stages, appearance, natural/per-turn/AI settings, and a bounded readable list of intentionally omitted dependencies. Dependency entries contain only kind, source ID, and readable name; they cover link rules, rules, recursively field-referencing/shared conditions, and effect groups without serializing entity payloads.
- Character and group values are serialized only for explicitly enabled targets with `includeValue: true`; readable source actor/group names accompany stable source IDs.
- Global templates have no actor/group matrix. Chat templates omit saved/source chat UUIDs and bind only to the importing runtime's current chat.
- Preview strictly validates the complete document, schema/version, checksum, exact keys, field/target/stage/dependency counts, text limits, model validity, scope references, conflicts, portable copy IDs, readable mapping needs, stable-ID/unique-name suggestions, omitted-dependency repair warnings, and deterministic range/step value adjustments without mutation.
- Import supports default `create_copy`, explicit `update`, and explicit `replace`; searchable mappings are supplied as IDs with per-target enable and value policy. Scope-changing updates are unavailable and rejected before transaction so existing bindings/state cannot be reinterpreted.
- Multi-field `create_copy` uses one deterministic plan shared by preview and commit: exact source IDs absent from local state are reserved first, then conflicting IDs allocate against local, reserved, and already planned IDs. A local `foo` plus template `foo`/`foo_copy` therefore previews and commits `foo_copy_2`/`foo_copy` without late atomic-store discovery.
- Definition-only character/group templates use explicit `unboundTargets`, allowing users to enable any local targets or create an inactive field with every offered target disabled. Template values are forbidden when no source value exists, and duplicate, cross-kind, missing, or context-inappropriate targets reject atomically.
- `replace` reconciles existing `pendingBootstrapFieldIds` before V3 validation: bound/current-chat/global replacements clear the marker, eligible unbound replacements preserve an existing marker, and an explicitly all-disabled import never invents one.
- Missing, duplicate, unknown, malformed, stale, or invalid input rejects before the single atomic `transactV3` call. A composition test exercises the real `V3MvuStore`/`FileMvuStore` CAS path, verifies one atomic publication, restart durability, and stale-revision rejection without a second write.
- Export validates the fully serialized/checksummed document with the same portable parser used by preview/import before returning it to the host. Model-valid but portable-oversize IDs, text, stage counts, field counts, or target counts therefore reject before directory creation or file write; exact boundary documents round-trip successfully.
- Typed IPC parsers, clients, persistent-main handlers, and the native WebView bridge expose `exportFieldTemplate`, `previewFieldTemplateImport`, and `importFieldTemplate`.
- The export host accepts no caller path, validates the backend-generated filename, creates `/sdcard/Download/Operit/exports`, checks both host file-operation results, writes the selected template JSON, and returns `fileName`, `savedPath`, and exact field/target/value counts.

### TDD and verification

- Initial interface/core RED contract: commit `5225c37`; atomic core GREEN: commit `5b6f4ef`.
- Expanded acceptance RED isolated three missing IPC/bridge/runtime boundaries at 13/16 passing; a final edge RED covered bounded copy IDs and initial step alignment. The original focused suite reached 17/17 passing.
- Protocol review RED was independently confirmed at 14/24 passing with ten expected failures across cross-scope update safety, definition-only mapping, match suggestions, readable omitted dependencies, and typed IPC shape. GREEN is 24/24.
- Second protocol review RED was 25/29 with four expected failures covering batch ID planning, pending-bootstrap replacement, portable export rejection, and host zero-write behavior. GREEN is 29/29 with typecheck passing.
- `pnpm check`: PASS in a clean detached verification snapshot built from base `91ab12c` plus the exact staged Task 9A patch — manifest/web/v3/effect audits, typecheck, 221/221 Node tests, fresh-build DOM gate 4/4. Expected negative-path atomic-store diagnostics were emitted by passing fault-injection tests. The shared worktree's concurrent uncommitted Task 9B UI audit was intentionally excluded rather than modified.
- `pnpm build`: PASS — all audits/typecheck and web build; `dist/app.html` 9,248,481 UTF-8 bytes.
- Focused/worktree/staged/isolated diff checks pass for commit `3d9a22573b9d6d21e04e151e6d5e84450d02ac9f`.

### Scope and residuals

- No `static/app_ui` file, release version, or release metadata was modified by the Task 9A commit; concurrent user-owned frontend/V3 work remained unstaged and untouched.
- Existing untracked Task 8 artifacts remain untracked and untouched.
- Task 9B still owns the Configuration/Fields visual import/export flow and the other Task 9 editors. Modified APK/MuMu/real-host acceptance remains Task 11.
