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

Export base filenames use `operit-mvu-full-backup-v3-schema1-YYYYMMDD-HHMMSSmmmZ-r<sourceRevision>-<checksum12>.json`. The main IPC reparses the finished bytes and specifically requires a full-v3/schema-1 envelope, derives and compares that exact base filename from the parsed export timestamp, revision, and checksum, and compares every summary count plus UTF-8 byte count against the parsed data. A raw v2 dataset cannot masquerade as a host export. Before writing, the handler probes for the base name and bounded `-2` through `-100` suffixes inside a same-runtime export queue, so repeated identical exports do not overwrite an existing backup. Filename, parsing, summary, and existence checks all precede host directory creation and write.

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
- Host filename collision probes: 100 candidates including the unsuffixed base name.

Export and import share the byte, record, structural, and text checks. Integer values at any JSON depth must be safe integers; this includes runtime state, timestamps/counters, and record bodies. Export therefore fails before host I/O rather than producing a file that restore would reject. Tests may inject a lower byte ceiling, but cannot raise the production 128 MiB maximum.

## TDD evidence

RED was observed before implementation for the missing `dist/mvu/app/full-backup.js` module, then for missing migration/preview contracts, missing queued store APIs, and the old unrevisioned IPC/runtime contract. Subsequent focused RED cases exposed and drove fixes for the millisecond-bearing filename, prior v2 temporary effects without `temporaryEffectIds`, and UTF-8 byte accounting for multibyte input.

The independent-review follow-up added RED reproductions for re-signed `Number.MAX_SAFE_INTEGER + 1` values (initially reaching the later v3 validator as `INVALID_MVU_STATE_VALUE`), second-only filename collisions, and absent host existence probes. A low-memory multibyte self-export test proves exact UTF-8 acceptance at its injected byte ceiling and rejection at one byte less on both export and import. The runtime test was updated from the obsolete seconds-only pattern to derive the exact self-importable filename contract.

GREEN:

- `pnpm run typecheck` — PASS.
- `node --test tests/full-backup.test.mjs` — 20/20 PASS.
- Focused backend/template regression (`full-backup`, `record-store`, `record-store-hardening`, `migration-v3`, `field-template`, `host-boundary`, `query`) — 149/149 PASS.
- `pnpm run audit:effects` — PASS.
- `pnpm run build` — PASS, including audit, typecheck, effects audit, and web build.
- First `pnpm run check` — PASS: all audits, typecheck, effects audit, 260/260 `test:v3`, and 4/4 DOM tests.
- Final `pnpm run check` rerun after adding the `-3`/100-probe assertions — audits, typecheck, effects audit, and all Task 10A tests PASS, but the concurrently added model-budget suite finishes 267/270. Its three failures are in `tests/model-budget.test.mjs` against separately modified `src/mvu/app/state-prompt.ts` (one deterministic field-order expectation and two `request.message.trim` type errors). Task 10A does not modify or submit either file.

Expected error logs in the green backend runs come from assertions that inject stage, atomic-publication, cleanup, filename, tamper, oversize, and host-write failures.

## Repository check/build status

`pnpm run build` completes successfully and generated only the ignored `dist/app.html`. A complete `pnpm run check` also passed before the concurrent model-budget files appeared. The final rerun's unrelated three failures are recorded above; source status at handoff keeps `src/mvu/app/state-prompt.ts`, `tests/model-budget.test.mjs`, and `artifacts/` outside this follow-up commit.

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
- Host collision selection is serialized within this installed main-runtime handler and checks existing files before write. The available host API does not expose exclusive create, so an unrelated external process could still race between existence probing and write.
- Post-publication deletion of superseded segments can fail without rolling back the newly visible snapshot. Existing cleanup-journal recovery resumes that safe cleanup on restart; this is tested.
