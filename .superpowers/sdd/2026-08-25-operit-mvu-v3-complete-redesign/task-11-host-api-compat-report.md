# Task 11 — Operit host API compatibility

## Scope and baseline

- Baseline: `Operit official public surface + OPERITAI_CHANGES #1-#8`.
- `Tools.Files.replaceAtomically` is retained as documented extension #8.
- `docs/OPERITAI_CHANGES.md` and `docs/HOST_INTERFACE_REQUIREMENTS.md` were treated as read-only, pre-existing controller changes and are not part of this task's commit.

## TDD evidence

RED (`node --test tests/host-api-compat.test.mjs`): 0/7 passed. The failures proved the test caught the private manifest capability block, non-variadic WebView declaration and implementation, missing variadic rejection callback, exposed `localModels`, and missing AST release gate.

GREEN:

- `node --test tests/host-api-compat.test.mjs`: 7/7 passed.
- `node --test tests/host-api-compat.test.mjs tests/host-boundary.test.mjs`: 11/11 passed.
- `node scripts/audit-manifest.mjs`: passed.
- `node scripts/audit-host-api-compat.mjs`: passed; 77 files scanned, `dist/main.js` scanned, zero violations.
- `pnpm run typecheck`: passed.
- `pnpm run build`: passed, including host audit before the build and again after the generated artifacts were refreshed.
- `git diff --check`: passed.

## Implemented contract

- Removed nonstandard `manifest.host_requirements`; the manifest audit now accepts exactly this package's standard Operit keys and validates its required shape.
- Restored the official `(...args: unknown[])` Compose WebView callback type.
- Normalized both current single-array host payloads and standard variadic callbacks before parsing, including rejection callback IDs.
- Removed `ToolPkg.localModels` and its local-model types from the plugin overlay while retaining `chatContext` and `systemModel` extensions.
- Added an AST-based source/type/build host API audit with an explicit official + extensions #1-#8 allowlist. It hard-fails on `localModels`, `prepareDispatch`, `dispatchToken`, `maxOutputChars`, `structuredOutput`, `chatContext.history`, `chatContext.exists`, private manifest capabilities, and unknown host symbols.
- Added the gate to `audit`, post-build verification, and `check` without recursive scripts.

## Remaining release blocker outside authorized files

`src/main.ts` does not currently assert the availability and shape of registered extensions before installing IPC/routes. A host missing `ToolPkg.chatContext`, `ToolPkg.systemModel`, or `Tools.Files.replaceAtomically` can therefore produce a generic property-access error instead of a readable incompatibility message. Closing this item requires a narrow change and tests around `src/main.ts`; that file was explicitly outside this task's write set, so it was not modified.
