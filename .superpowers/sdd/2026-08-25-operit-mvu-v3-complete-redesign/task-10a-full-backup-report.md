# Task 10A — True full-dataset backup/restore backend

## Outcome

Implemented a versioned native-v3 backup envelope and an atomic, revisioned replacement restore path. Export reads v3 configuration and every committed logical record under the store path queue, so the snapshot is from one committed revision and is not subject to the 500-record compatibility cap. Restore reparses and rechecksums the exact submitted JSON, requires an explicit replacement confirmation and current expected revision, stages a complete replacement, and uses the existing atomic v3 configuration publication boundary. The store rebuilds its own segment manifest and advances the local revision; source revision is metadata only.

Legacy raw v2 datasets and prior v2 exports remain importable through complete v2-to-v3 migration. Portable field-template parsing and IPC remain separate.

## Format contract

```json
{
  "format": "operit-mvu-full-backup",
  "schemaVersion": 1,
  "exportedAt": "<ISO timestamp>",
  "sourceFormatVersion": 3,
  "checksum": {
    "algorithm": "sha256",
    "value": "<64 lowercase hex characters>"
  },
  "payload": {
    "sourceRevision": 123,
    "config": "<complete MvuDatasetV3 except revision and recordManifest>",
    "records": "<all logical DataChangeRecord objects>"
  }
}
```

The checksum covers every unsigned envelope field and is computed from canonical JSON with recursively sorted object keys. It is stable across source key order and whitespace changes. Envelope, payload, checksum, v3 configuration, nested union variants, and records use exact-key validation. Physical segment filenames and the source manifest are intentionally excluded; records are portable logical objects and the destination store rebuilds segmentation.

Export filenames use `operit-mvu-full-backup-v3-schema1-YYYYMMDD-HHMMSSZ.json`. The main IPC validates the finished bytes through the public import parser and validates the filename before creating the fixed export directory or writing the host file.

Import preview is non-mutating and reports full-v3 versus legacy-v2 kind, source/schema version, export time, source/current revision, field/condition/rule/effect/active/record counts, bounded migration warnings, the replacement warning, and the required confirmation value. Restore requests have exactly `json`, `expectedRevision`, and `confirmation`; the legacy `{ json }` request fails closed.

## Explicit limits

- Serialized UTF-8 input/output: 128 MiB.
- Logical records: 250,000.
- Each primary configuration collection: 100,000 items.
- Any JSON array: 1,000,000 items.
- Any text value: 1,048,576 UTF-16 code units.
- JSON nesting depth: 64.
- Traversed JSON nodes: 10,000,000.
- Preview migration warnings: first 100 entries, each truncated to 512 code units; total count is retained.

Export and import share the byte, record, structural, and text checks. Export therefore fails before host I/O rather than producing a file that restore would reject.

## TDD evidence

RED was observed before implementation for the missing `dist/mvu/app/full-backup.js` module, then for missing migration/preview contracts, missing queued store APIs, and the old unrevisioned IPC/runtime contract. Subsequent focused RED cases exposed and drove fixes for the millisecond-bearing filename, prior v2 temporary effects without `temporaryEffectIds`, and UTF-8 byte accounting for multibyte input.

GREEN:

- `pnpm run typecheck` — PASS.
- `node --test --test-timeout=15000 tests/full-backup.test.mjs` — 17/17 PASS.
- Focused backend/template regression (`full-backup`, `record-store`, `record-store-hardening`, `migration-v3`, `field-template`, `host-boundary`, `query`) — 146/146 PASS.
- `pnpm run audit:effects` — PASS.
- Full `pnpm run test:v3` reached 256/257 PASS. Its sole failure is the concurrently modified UI range-input handler in `static/app_ui/app.js` (`tests/ui-shell.test.mjs:546`, `target.matches is not a function`), outside Task 10A ownership.

Expected error logs in the green backend runs come from assertions that inject stage, atomic-publication, cleanup, filename, tamper, oversize, and host-write failures.

## Repository check/build status

`pnpm run check` and `pnpm run build` both stop in their shared first `audit` step at `scripts/audit-web-ui.mjs:66`: the concurrently modified `static/app_ui/pages-rules.js` does not yet contain the audited five AI trigger-type labels. Neither command reaches its later check/build steps. Task 10A does not modify `static/**` or its UI audits, so this failure was not changed or bypassed. TypeScript compilation and the complete owned/relevant backend test matrix pass independently as recorded above.

## Files

- `src/mvu/app/full-backup.ts` — envelope codec, canonical SHA-256, strict bounds/key validation, preview, legacy v2 migration contract.
- `src/mvu/app/store-v3.ts` — queued complete read and CAS-confirmed atomic replacement restore.
- `src/mvu/app/index.ts` — runtime export/preview/import APIs.
- `src/shared/ipc.ts` — strict IPC requests, client/handlers, validated safe host export.
- `src/ui/web_container/index.ui.ts` — native bridge dispatch for import preview.
- `tests/full-backup.test.mjs` — full codec/store/runtime/IPC/fault/restart coverage.
- `tests/record-store.test.mjs` — existing production IPC/store fixtures updated to the new exact contract.
- `.superpowers/sdd/2026-08-25-operit-mvu-v3-complete-redesign/task-10a-full-backup-report.md` — this report.

## Residual risks

- A maximum-size backup necessarily occupies substantial memory during parse, canonical hashing, deep-copying, and pretty serialization; the 128 MiB file limit is a safety boundary, not a low-memory streaming format.
- The existing store queue/CAS model serializes writers in the persistent ToolPkg main runtime. As documented by the store architecture, it does not claim cross-process locking against an unrelated writer bypassing that runtime.
- Post-publication deletion of superseded segments can fail without rolling back the newly visible snapshot. Existing cleanup-journal recovery resumes that safe cleanup on restart; this is tested.
- Repository-wide UI audit/build completion remains dependent on the separately owned condition UI changes described above.
