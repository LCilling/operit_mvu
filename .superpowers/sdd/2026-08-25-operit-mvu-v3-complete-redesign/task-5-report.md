# Task 5 report — committed record segments and safe v3 startup migration

## Scope and commit

- Worktree: `D:\ProjectFile\operit_mvu\.worktrees\mvu-v3-complete-redesign`
- Branch: `codex/mvu-v3-complete-redesign`
- Required base and starting `HEAD`: `ddd43da73ff19b825f3787cc4795bc6a0fc1dfdb`
- Focused implementation commit: `6d960b5b2e77f80d82ff71cb21a4a4966582f586` (`feat: add crash-safe v3 persistence`)
- `progress.md` was read but not edited.

## Preserved-WIP findings

The worktree was already a linked worktree on the requested branch, and both `HEAD` and the merge-base against the supplied base were exactly `ddd43da73ff19b825f3787cc4795bc6a0fc1dfdb`. The preserved WIP initially contained nine modified files and three untracked files. It already implemented most Task 5 storage, migration, runtime wiring, and tests, but it had no report or commit.

The controller's earlier 9/9 result was no longer the current baseline. The preserved test file had grown to 11 tests. A fresh run found two failures:

- A legacy compatibility auto-rule write replaced all v3-only conditions, rules, effect groups, and active effects.
- A production-composition assertion expected six compatibility records even though the transaction, committed manifest, and compatibility snapshot all contained the same seven records.

The compatibility merge was corrected to reconcile changed legacy rule/condition identities while preserving untouched v3-only assets. A separate RED-first test then exposed the analogous legacy temporary-effect write problem; the effect-group/active-instance merge now reconciles identities and preserves hidden v3 definitions. The stale record expectation was corrected to seven after a temporary boundary diagnostic proved that all seven records were committed and returned in the same order; the diagnostic was removed.

## Honest RED status

Original Task 5 creation RED evidence is unavailable because the implementation and its initial tests predated this continuation. No artificial reconstruction of that original RED was made.

Fresh preserved-WIP RED:

```text
Command: node --test tests/record-store.test.mjs
Result: exit 1; tests 11; pass 9; fail 2
Failures:
- legacy compatibility writes preserve v3-only conditions, rules, and effects
  AssertionError: false !== true at tests/record-store.test.mjs:449
- production runtime composes legacy field behavior with v3 rules in one committed transaction
  AssertionError: 7 !== 6 at tests/record-store.test.mjs:853
```

Fresh full-check RED before fixes:

```text
Command: pnpm run check
Result: exit 1; UI audit PASS; TypeScript PASS; temporary-effect audit PASS;
        tests 56; pass 54; fail 2
```

Additional genuine RED added during the audit:

```text
Command: node --test --test-name-pattern="legacy temporary-effect writes" tests/record-store.test.mjs
Result: exit 1; tests 1; pass 0; fail 1
Failure: legacy temporary-effect writes preserve hidden v3 effect definitions
         AssertionError: false !== true at tests/record-store.test.mjs:502
```

A hypothesized missing-trigger-actor persistence regression was tested and passed immediately. The hypothesis was therefore rejected, the non-RED test was removed, and no production change was made for it.

## Storage and runtime invariants

- Record segments rotate after exactly 500 committed JSONL records.
- The committed config manifest is the sole visibility boundary. Queries use only each segment's `committedLineCount` and `readTextPart` ranges.
- Record lines carry `commitRevision`; records are appended/staged at `current revision + 1` before the config temp file is atomically moved into place.
- A stale CAS revision is rejected before staging records.
- Restart validation parses committed lines only, trims an uncommitted tail, and removes contiguous unlisted orphan segments from `nextSegmentIndex`.
- A failed config move leaves the old config and record manifest authoritative; restart repairs the tail/orphan and permits a clean retry.
- Startup prefers a valid v3 config. Migration writes only new v3 config/record paths and never mutates the v2 file. Invalid or failed v3 startup returns structured `{ mode: "v2_compat", error }`; explicit retry rebuilds from preserved v2 data.
- The v2 compatibility adapter reads committed records and preserves untouched v3-only conditions, rules, effect definitions, and active instances during legacy CRUD.
- The real `src/main.ts` persisted-message hook initializes the runtime and routes production messages through `V3MvuStore.transactV3`, combining configuration/facts/effects and newly appended records in one commit.
- Legacy natural, per-turn, state-AI, and link behavior runs before v3 ordered rule/effect execution. Role-aware condition AI, actor targeting, source-aware effects, caps, and v3 validation remain active.
- Hourly retention recursively derives the maximum enabled high-frequency window, keeps any UTC bucket that can overlap that window, ignores disabled conditions, and has no independent count cap that could prune referenced hours.

## Files in the implementation commit

- `src/main.ts`
- `src/mvu/app/automation.ts`
- `src/mvu/app/index.ts`
- `src/mvu/app/migration-v3.ts`
- `src/mvu/app/model-v3.ts`
- `src/mvu/app/record-store.ts`
- `src/mvu/app/service.ts`
- `src/mvu/app/store.ts`
- `src/mvu/app/store-v3.ts`
- `src/mvu/app/validation.ts`
- `tests/helpers.mjs`
- `tests/record-store.test.mjs`

## Verification evidence

```text
Command: pnpm run typecheck
Result: exit 0
```

```text
Command: node --test --test-name-pattern="legacy compatibility writes|legacy temporary-effect writes|production runtime composes" tests/record-store.test.mjs
Result: exit 0; tests 3; pass 3; fail 0
```

```text
Command: node --test tests/record-store.test.mjs tests/migration-v3.test.mjs
Result: exit 0; tests 16; pass 16; fail 0
```

Final verification after the complete diff review:

```text
Command: pnpm run check
Result: exit 0
- UI audit: PASS (15 screens, 42 declared actions, 48 handled actions, 20 native methods)
- TypeScript: PASS
- Temporary-effect audit: PASS
- Node tests: 57 total, 57 pass, 0 fail, 0 skipped, 0 todo
```

```text
Command: git diff --cached --check
Result: exit 0; no whitespace errors
```

## Acceptance checklist

- [x] **500-record segmented store; committed-count-only reads; orphan-tail repair.** `SegmentedRecordStore` rotates at 500, queries with manifest line counts and partial reads, trims uncommitted tails, and deletes unlisted contiguous orphan segments. Covered by rotation, visibility, and repair tests.
- [x] **CAS atomic config + records; interrupted append recovery.** `commitLoaded` checks CAS, stages revision+1 records, validates the staged manifest, then moves the config temp file. Covered by stale-CAS and failed-config-move restart/retry tests.
- [x] **Exact `MvuFileApi` additions and real tools adapter.** Added exactly `readTextPart`, `appendText`, and `deleteFile`; the production adapter calls `Tools.Files.readPart`, append-mode `Tools.Files.write`, and `Tools.Files.deleteFile`, checking operation success.
- [x] **Safe non-overwriting v2→v3 startup migration, valid-v3 preference, structured fallback and retry.** Covered by byte-preservation, valid-v3 preference, invalid reference/count, failed move, fallback, and retry tests.
- [x] **Real `src/main.ts` production path uses the v3 atomic transaction.** The registered production chat hook is invoked through `registerToolPkg`; it writes one v3 config commit plus revision-tagged records and leaves v2 bytes unchanged.
- [x] **Production-path composition proof.** The registered hook test exercises natural change, per-turn change, state AI, legacy links, batched role-aware v3 condition AI, ordered v3 rules, effect activation, source-aware effect application, turn consumption, message facts, hourly buckets, and committed record queries through the real tools adapter.
- [x] **Pre-Task-6 UI/runtime compatibility.** `V3MvuStore` continues to implement `MvuStore`, exposes committed records in snapshots, returns migration status, and preserves v3-only assets during legacy auto-rule and temporary-effect writes.
- [x] **Hourly retention derives from enabled condition windows without silent pruning.** Recursive nested high-frequency windows determine the horizon; disabled larger windows do not alter it; overlapping referenced buckets survive.
- [x] **Role-aware AI semantics, caps, validation, and v2 bytes are preserved.** Existing Task 4 tests plus the production hook prove role/actor payloads, AI confidence/caps, 2048 processed IDs, 50 recent facts, strict v3 validation, and byte-identical v2 preservation.
- [x] **`pnpm run check` green.** Final result: 57/57 tests and both audits passed.

## Review and residual risks

- The session exposed no subagent/reviewer capability, so an independent code-review agent could not be dispatched. The diff and acceptance checklist were reviewed directly; this is the principal process residual risk.
- Atomicity relies on the host's documented file move behavior. The fake adapter proves ordering and interruption recovery, not device-filesystem implementation internals.
- The v2 compatibility view is intentionally lossy for v3-only concepts. Untouched hidden assets are preserved; conflicting legacy IDs and deletion of a legacy-projected effect still referenced by a hidden v3 rule fail explicitly instead of silently overwriting v3 data.
- Explicit migration retry replaces an invalid v3 candidate and its uncommitted record directory from the preserved v2 source. The v2 bytes remain the recovery anchor.

## Review round 1 fix — 2026-08-25

This section supersedes the earlier report's statements that config publication used an ordinary move, JSONL queries used host `readPart`, retry rebuilt by deleting the v3 candidate, and compatibility reads materialized every record. Those were accurate for the pre-review Task 5 commit and are no longer true after the hardening commit.

### Starting WIP and review findings

- Review-fix starting `HEAD`: `bcb2cd9bafe9e7909a7c6a495fd69b1e08037aa2`.
- The branch and linked worktree matched the requested locations and were clean at the start of this fix round.
- The complete round-1 review was read. Direct code and host-interface inspection confirmed all three Critical findings, all five Important findings, and the unsafe-integer Minor finding.
- The adjacent OperitAI host declarations and implementation expose `Tools.Files.replaceAtomically(source, destination)`. It is a checked, same-directory atomic replacement that fails instead of degrading to ordinary copy/delete. No host file lock, lease, or conditional-write primitive is exposed to this plugin.
- Existing commits and ignored SDD artifacts were preserved. `progress.md` was not edited.

### Honest RED evidence

The host-faithful decorated-partial-read fake first broke the existing tests before the production reader was changed:

```text
Command: pnpm run typecheck; node --test tests/record-store.test.mjs
Result: exit 1; tests 12; pass 4; fail 8
Representative failure: MVU_V3_RECORD_LINE_INVALID:segment-000001.jsonl:496
Affected coverage: segmented queries, repair/query, atomic transaction queries,
migration queries, and both production-composition paths.
```

The dedicated round-1 regressions were then run against the uncorrected production implementation:

```text
Command: pnpm run typecheck; node --test tests/record-store-hardening.test.mjs
Result: exit 1; tests 10; pass 0; fail 10
Failures proved:
- atomic replacement was not called (`'v3' !== 'v2_compat'` under injected atomic failure)
- decorated JSONL reached the parser
- two store instances corrupted/staged the same segment instead of rejecting stale CAS
- normal writes deleted/reused an orphan instead of failing collision-safe
- retry used no atomic replacement and was not fail-closed
- 100k-history compatibility read used the unbounded/decorated path
- rule selector/target/reference/shared-condition data was replaced
- effect actor/source semantics and multiple instances were collapsed
- expiry disabled the reusable definition
- `Number.MAX_SAFE_INTEGER + 1` was accepted as a segment counter
```

Two additional missing contracts were found during GREEN integration and each received a fresh RED before its fix:

```text
Command: pnpm run typecheck; node --test --test-name-pattern="later in-runtime write" tests/record-store-hardening.test.mjs
Result: exit 1; tests 1; pass 0; fail 1
Failure: MVU_V3_RECORD_SEGMENT_COLLISION:segment-000001.jsonl
Meaning: the same runtime did not enter exclusive recovery after a partial append write.
```

```text
Command: pnpm run typecheck; node --test --test-name-pattern="legacy effect writes" tests/record-store-hardening.test.mjs
Result: exit 1; tests 1; pass 0; fail 1
Failure: AssertionError false !== true
Meaning: a legacy active-effect toggle still disabled the reusable v3 definition.
```

No artificial RED was added. The unsuccessful-result adapter assertion and ordinary-move-versus-atomic fake assertion extend the already-RED atomic-publication contract.

### Hardened invariants

- V2 and v3 config files are published only with checked `replaceAtomically`; ordinary `move` is never a config publication fallback. Config, repair, and retry temp paths carry runtime-unique identifiers.
- Segment queries use bounded whole-segment raw reads and slice locally. Host `readPart` remains modeled as decorated/truncatable/error-injectable but is never used for JSONL.
- A module-wide queue serializes every v3 startup, recovery, read transaction, and write transaction by config path across `V3MvuStore` instances in one JavaScript runtime. Each writer rereads the on-disk revision while holding that exclusion and stale CAS fails before staging.
- A failed or partial append marks the path recovery-required. The next write, or startup, exclusively validates committed lines, atomically trims an orphan tail, and removes contiguous unlisted new segments before another append.
- Normal writes never destructively delete a colliding uncommitted segment. Replacement/migration finds a new contiguous unused segment run; failed retry staging remains invisible because only the atomically published manifest controls visibility.
- Startup is the only unconditional full-history validation path. `readV3` is config-only; v2 compatibility snapshots load at most the newest 500 records using at most one 500-line segment read for that snapshot.
- A legacy rule edit patches only v2-representable name/description/toggle/cooldown/order/condition/effect fields. Existing actor selectors, targets, creation metadata, and hidden effect-group references survive. Shared conditions use copy-on-write.
- A legacy effect operation edit preserves reusable definition identity, field-effect identity, actor selectors, source filters, every active instance, each reason, trigger actor, target, activation time, and lifetime. Expiry/direct settlement removes active instances without disabling the reusable definition; ambiguous multi-instance projection edits fail closed.
- `retryMigration` is accepted only while the store reports `v2_compat`, simultaneous calls are coalesced, a valid v3 is preferred again under the path lock, and valid-v3 retry attempts reject without deletion or mutation.
- Persisted revisions, record counts, segment indexes, line counts, and segment revisions require safe integers. Revision/count/index increments are checked before publication or append-side effects.

### Files changed in the hardening commit

- `src/mvu/app/index.ts`
- `src/mvu/app/record-store.ts`
- `src/mvu/app/store-v3.ts`
- `src/mvu/app/store.ts`
- `src/mvu/app/validation.ts`
- `types/files.d.ts`
- `tests/helpers.mjs`
- `tests/record-store.test.mjs`
- `tests/record-store-hardening.test.mjs`

Focused implementation commit:

```text
d40e0f6100dd08c07a21f5b7bcc4aab70445c824 fix: harden crash-safe v3 persistence
9 files changed, 1046 insertions(+), 164 deletions(-)
```

### Exact GREEN verification

```text
Command: node --test tests/record-store-hardening.test.mjs
Result: exit 0; tests 13; pass 13; fail 0; skipped 0; todo 0
```

```text
Command: node --test tests/record-store.test.mjs tests/migration-v3.test.mjs
Result: exit 0; tests 16; pass 16; fail 0; skipped 0; todo 0
```

```text
Command: pnpm run check
Result: exit 0
- UI audit: PASS (15 screens, 42 declared actions, 48 handled actions, 20 native methods)
- TypeScript: PASS
- Temporary-effect audit: PASS
- Node tests: 70 total, 70 pass, 0 fail, 0 skipped, 0 todo
```

```text
Command: git diff --check
Result: exit 0; no output

Command: git diff --cached --check
Result: exit 0; no output
```

The expected `MVU persisted message processing failed Error: FAKE_REPLACEATOMICALLY_FAILED` diagnostic appears during the production-hook failure test; that rejection is asserted and the suite exits zero.

### Round-1 acceptance matrix

- [x] **Atomic host capability and checked failure.** `MvuFileApi` and `types/files.d.ts` declare `replaceAtomically`; the real adapter checks `successful`; v2 and v3 config publishers call only atomic replace. Tests distinguish interrupted ordinary move from failed atomic replacement and assert failed host result handling.
- [x] **Raw bounded JSONL reads.** Record queries read at most the needed 500-line segment(s), slice locally, ignore physical lines beyond `committedLineCount`, and never call decorated/truncated `readPart`.
- [x] **Cross-instance serialization and stale-writer safety.** Two stores on one path are deterministically interleaved with a barrier; only one publishes and the stale writer receives `StaleRevisionError`. Unique config/repair temp IDs and collision-free migration segment runs prevent shared fixed staging names.
- [x] **Hidden v3 rule semantics.** Exact regression coverage preserves selectors, targets, hidden effect references, metadata, and the untouched side of a shared condition while representable fields change.
- [x] **Reusable definitions versus active instances.** Operation edits preserve source/actor filters and multiple exact instances; direct toggle and expiry settle instances without disabling the reusable definition.
- [x] **Bounded normal work.** The 100,000-record test clears startup operation history, performs a compatibility read, and proves no partial read and at most one record-segment whole read. Full segment validation is startup/recovery-only.
- [x] **Fail-closed migration retry.** Retry is compatibility-only, coalesced for double-clicks, stages on unique paths, atomically switches, preserves v2 bytes, and never deletes valid v3.
- [x] **Host-faithful fake and production ordering.** The fake decorates/truncates partial reads, distinguishes ordinary move from atomic replace, supports pre-operation barriers and pre/post-write failures, and records operations. The registered `src/main.ts` hook test proves records append before config publication; injected publication failure leaves committed config/revision/count unchanged.
- [x] **Safe integers.** Revisions/counts/indexes and increments are guarded with `Number.isSafeInteger`.
- [x] **500-line committed record store and repair.** Rotation remains exactly 500, manifest counts are the read boundary, and both restart and same-runtime interrupted-append recovery are covered.
- [x] **Safe v2→v3 startup migration.** Valid v3 wins; v2 bytes remain byte-identical; failure returns structured `v2_compat`; retries use new segment/config staging paths and atomic switch.
- [x] **Real production transaction and composition.** The registered production hook exercises legacy natural/per-turn/state-AI/link behavior plus v3 role-aware rules, effect activation/consumption, hourly facts, caps, and committed records in one v3 transaction—not an internal helper alone.
- [x] **Pre-Task-6 compatibility.** `V3MvuStore` still implements the v2 `MvuStore` interface with a documented bounded recent-record snapshot while v3 paging remains available.
- [x] **Hourly retention.** Existing recursive enabled-condition-window coverage remains green and does not count-cap referenced hours.
- [x] **Role-aware AI, caps, validation, and v2 preservation.** Task 4 semantic/validation tests, migration tests, and production hook assertions all remain green.
- [x] **Full check.** `pnpm run check` passes with 70/70 Node tests.

### Residual risks after round 1

- The host API exposed to this plugin has no lock/lease/conditional-write primitive. The implementation and deterministic tests prove path serialization across all `V3MvuStore` instances sharing this JavaScript module/runtime; they do not prove exclusion between separate host processes. No broader claim is made.
- A crashed or failed uniquely staged migration/replacement can leave invisible old segment or temp files. They cannot become committed through the manifest and contiguous forward orphans are repaired, but lower-index staging generations may consume storage until a future host listing/garbage-collection capability is introduced.
- The pre-Task-6 v2 compatibility snapshot intentionally exposes only the newest 500 records. Full history remains available through v3 paged `queryRecords`; Task 6 should keep UI history on that API.
- Atomic durability still depends on the host's documented same-directory `replaceAtomically` implementation. The adapter fails closed and the fake tests observable contract/failure behavior, not device-filesystem internals.
- No subagent/code-review dispatch tool was available in this session. A direct diff and acceptance audit was performed; this is a process limitation, not an unreported independent review.

## Review round 2 fix — 2026-08-25

### Starting WIP and host-boundary findings

- Round-2 starting `HEAD`: `9424d63d42d1eb352eaaad151842f99a05e1cef2`; the requested branch/worktree were clean and unchanged.
- The complete round-2 review was read. All five findings were reproduced or verified against the implementation. Existing commits and ignored SDD artifacts were preserved; `progress.md` was not edited.
- OperitAI has no package-visible file lock or conditional-write primitive. Its documented boundary instead gives ordinary ToolPkg hooks one persistent engine at `toolpkg_main:<container>` (`PackageManagerToolPkgFacade.resolveToolPkgExecutionContextKey` plus `ToolPkgManager.getToolPkgExecutionEngine`), and MVU UI IPC already targets `main` with `toolpkg_main:com.lcilling.operit_mvu`.
- OperitAI durable invalidation events are exactly `chat_deleted` and `chat_history_reset`; they execute in fresh `toolpkg_invalidation:<package>:<uuid>` engines. MVU's production hook was verified to return for both names before `ensureRuntime`, `ToolPkg.getConfigDir`, or store access.
- OperitAI owner isolation prevents another package from resolving the MVU package's private config root. The manifest now makes this production dependency explicit instead of claiming an impossible cross-process CAS property from unconditional atomic replacement.
- The existing exact IPC target and invalidation early-return behavior were already correct. Their newly added tests passed in the first RED run, so no artificial RED or unnecessary production change was made for those two subcontracts. The external-writer reproduction also passed before the fix and deliberately demonstrates the documented out-of-scope boundary.

### Honest round-2 RED evidence

Initial host-contract regressions against `9424d63`:

```text
Command: node --test tests/host-boundary.test.mjs
Result: exit 1; tests 4; pass 2; fail 2
Failures:
- root manifest requires the complete Operit ToolPkg API-v3 host contract
  actual `host_requirements`: undefined
- the package audit enforces the manifest host contract
  actual audit command: `node scripts/audit-web-ui.mjs`
Already GREEN: exact UI main target; both fresh durable invalidations return before ToolPkg access.
```

Initial persistence regressions against `9424d63`:

```text
Command: node --test tests/record-store.test.mjs
Result: exit 1; tests 23; pass 13; fail 10
Failures:
- segment staging: `0 !== 2` transaction staging writes
- orphan bound: `Missing expected rejection`
- replacement allocation bound: `Missing expected rejection`
- MAX_SAFE_INTEGER pre-delete: orphan bytes were already deleted
- rule action addition: `1 !== 2`
- rule reorder: `INVALID_MVU_V3_RULE_EFFECT_REFERENCE`
- representable removal: `MVU_V3_COMPAT_RULE_ACTION_MISSING:auto_positive:1`
- ambiguous removal returned the old ACTION_MISSING error instead of fail-closed ambiguity
- expired non-first instance survived
- added effect target had no matching field-effect definition
Already GREEN: external writers are outside the generic store CAS boundary.
```

The first GREEN integration exposed one stale test barrier, not a production regression: the cross-instance test still paused direct append even though new segments now publish from unique staging via atomic replacement. Moving that barrier to the actual segment atomic-publication boundary restored the deterministic interleaving proof.

A final side-effect-order review found one additional real RED:

```text
Command: node --test --test-name-pattern="orphan recovery has a hard probe bound" tests/record-store.test.mjs
Result: exit 1; tests 1; pass 0; fail 1
Failure: `true !== false` — recovery deleted part of an oversized orphan run before rejecting its bound.
```

Recovery now collects and bounds the complete contiguous run, including safe successor checks, before performing any deletion.

### Round-2 invariants and fixes

- Root `manifest.json` declares API `operit-toolpkg-host`, version `3`, and exactly seven unique lexically sorted capabilities: actor identity, immutable chat history, durable chat invalidation, atomic file replace, IPC owner isolation, structured system model, and bounded async runtime.
- `scripts/audit-manifest.mjs` validates the exact host contract and package/manifest version equality. The normal `audit`, `build`, `check`, and `pack` paths now transitively enforce it.
- `V3MvuStore` documents its actual guarantee: crash-safe atomic publication and path-serialized CAS across store instances in one persistent ToolPkg main JavaScript runtime. It explicitly excludes external writers and cross-process safety.
- Every new record segment is written to a transaction-owned unique `.stage.<operation>.<ordinal>` path and atomically published before config publication. Failed in-process staging cleans only its own path; stale crash leftovers cannot collide with later transactions.
- Replacement collision probing and startup/recovery orphan probing are hard-bounded at 1,024 candidates. Oversized runs and unsafe successor indexes fail before deletion; the MAX_SAFE_INTEGER orphan is never removed.
- Broad recursive record-directory deletion was removed. Normal writes still never clean or overwrite a colliding uncommitted segment; destructive orphan cleanup occurs only during exclusive startup/recovery.
- Legacy rule actions are reconciled by visible action identity, not array slot. Exact reorders retain targets and hidden effect references; true additions use migrated trigger-actor defaults; unambiguous representable removals succeed; edits that cannot safely identify hidden semantics reject with `MVU_V3_COMPAT_RULE_ACTIONS_AMBIGUOUS`.
- Effect expiry projects the earliest instance deadline and settles every instance against its own absolute deadline. Reusable definitions remain enabled, surviving instances retain IDs, trigger actors, targets, durations, activation timestamps, and distinct reason snapshots, and mixed reasons project neutrally rather than borrowing `instances[0]`.
- A newly represented target field receives the matching migrated field-effect definition and honest all-source legacy semantics. Existing actor selectors and source filters remain untouched; multi-instance target/lifetime/reason edits still fail closed when v2 cannot identify an instance.

### Files in the round-2 code/test commit

- `manifest.json`
- `package.json`
- `scripts/audit-manifest.mjs`
- `src/mvu/app/record-store.ts`
- `src/mvu/app/store-v3.ts`
- `tests/host-boundary.test.mjs`
- `tests/record-store-hardening.test.mjs`
- `tests/record-store.test.mjs`

Focused implementation commit:

```text
8eb12301643fc03b56cf7d67adebfcd44418df4c fix: close v3 persistence review gaps
8 files changed, 759 insertions(+), 45 deletions(-)
```

### Exact round-2 GREEN verification

```text
Command: node --test tests/host-boundary.test.mjs
Result: exit 0; tests 4; pass 4; fail 0; skipped 0; todo 0
```

```text
Command: pnpm run typecheck; node --test tests/record-store-hardening.test.mjs tests/record-store.test.mjs
Result: exit 0; tests 36; pass 36; fail 0; skipped 0; todo 0
```

```text
Command: node --test --test-name-pattern="legacy effect writes|expiry settles|expired non-first|adding a legacy effect target" tests/record-store-hardening.test.mjs tests/record-store.test.mjs
Result: exit 0; tests 4; pass 4; fail 0; skipped 0; todo 0
```

Final verification on committed code:

```text
Command: pnpm run check
Result: exit 0
- Manifest audit: PASS (`operit-toolpkg-host`, API 3, 7 capabilities)
- UI audit: PASS (15 screens, 42 declared actions, 48 handled actions, 20 native methods)
- TypeScript: PASS
- Temporary-effect audit: PASS
- Node tests: 85 total, 85 pass, 0 fail, 0 skipped, 0 todo
```

```text
Command: pnpm run pack
Result: exit 0
- Manifest/UI/type/effect audits: PASS
- Web build: `dist/app.html` 9,323,226 bytes
- Package: `release/operit_mvu-2.0.1.toolpkg`, 54 entries, 9,933,792 bytes data
```

```text
Command: git diff --check
Result: exit 0; no output
```

The expected `MVU persisted message processing failed Error: FAKE_REPLACEATOMICALLY_FAILED` diagnostic remains part of the asserted production failure-order test; it does not represent a suite failure.

### Round-2 acceptance matrix

- [x] **API-v3 manifest requirements.** Root manifest, executable audit, package scripts, and tests require `files.atomic_replace` plus every currently used host capability; entries are exact, unique, and sorted.
- [x] **Actual single-writer host boundary.** OperitAI source evidence proves one persistent ordinary main engine per package context; all 20 UI IPC methods target its exact key; both fresh durable invalidation names return before runtime/store access; owner-isolation and durable-invalidation capabilities are required. No external-writer or cross-process CAS claim remains.
- [x] **Bounded, owned recovery staging.** Segment/config staging identifiers are transaction-owned and unique in the runtime; allocation and orphan probes are bounded; all bound/safe-integer checks complete before orphan deletion; broad directory cleanup is gone.
- [x] **Legacy rule add/remove/reorder.** Additions, unambiguous removals, exact reorders, hidden target/reference preservation, rule selector preservation, and ambiguous fail-closed behavior have deterministic regressions. Existing shared-condition isolation remains green.
- [x] **Independent active-effect settlement.** A non-first expired instance is removed independently while a future instance, its reason/actor/duration/targets, reusable definition, actor selectors, and source filters remain exact. Newly added target fields gain matching definitions; ambiguous multi-instance edits fail closed.
- [x] **Safe side-effect ordering.** Revision/count/index validation remains safe-integer strict. MAX_SAFE_INTEGER and oversized orphan runs reject before any affected deletion; collision scanning completes before staging writes.
- [x] **Reviewer reproduction coverage.** Tests cover the external-writer scope boundary, true action addition, expired non-first instance, added effect target, bounded always-present segment probes, and MAX_SAFE_INTEGER pre-delete behavior.
- [x] **Required verification.** Focused RED/GREEN commands, `pnpm run check`, manifest/package audits, packaging, and `git diff --check` are all recorded above and green.
- [x] **Original Task 5 acceptance remains intact.** The 500-line committed-count store, orphan-tail repair, checked atomic config/records ordering, raw whole-segment JSONL reads, safe v2→v3 fallback/retry, real production hook transaction/composition, bounded 100k compatibility read, pre-Task-6 adapter, hourly retention, role-aware AI/caps/validation, and byte-identical v2 preservation all remain covered in the 85-test suite.

### Residual limitations after round 2

- External OS/process writers are outside the proven contract. Correctness relies on OperitAI's one persistent package-main engine plus owner-isolated private storage; the external-writer reproduction intentionally shows that unconditional atomic replacement alone cannot provide interprocess CAS.
- The host file API exposes no directory listing. A process crash after writing a unique `.stage` file but before atomic publication can leave an invisible staging file; uniqueness prevents collision or accidental commitment, but storage reclamation requires a future bounded listing/GC capability.
- Recovery fails closed when a contiguous orphan/allocation run reaches the 1,024-path bound. It performs no orphan deletion in that case and may require host/operator cleanup rather than risking unbounded or partial destructive work.
- The v2 compatibility projection cannot faithfully represent several distinct active-instance reasons or identify arbitrary multi-instance lifetime/target edits. It preserves the v3 instances and uses a neutral projection or explicit ambiguity error instead of silently collapsing data.
- No subagent dispatcher was available for the requested independent code-review skill. A direct full-diff/acceptance audit found and fixed the partial-deletion ordering issue above; the lack of an independent reviewer remains a process limitation.

## Review round 3 fix — 2026-08-25

### Starting WIP and findings

- Round-3 starting `HEAD`: `819ceb89ca9012f14be4ecd7856fd4eebb1d64aa`; branch `codex/mvu-v3-complete-redesign` and the requested linked worktree were verified before editing.
- `pnpm run check` was GREEN at the round-2 baseline: 85 tests, 85 pass, 0 fail, 0 skipped, 0 todo. Existing commits and ignored SDD/build artifacts were preserved; `progress.md` was not edited.
- Ordinary v3 compatibility reads correctly loaded only the newest 500 records, but production export called the same bounded runtime dataset API and therefore omitted older committed records.
- Replacement and clear published a new manifest but had no durable record of the old committed paths, so superseded segment files were never reclaimed.
- Unique record-stage, repair, v2 config, and v3 config paths cleaned up some publication failures, but their initial write was outside the rejection guard. A host write that wrote bytes and then rejected left a known owned temp behind.
- The review specified no host directory-listing capability. The fix therefore uses exact transaction-owned paths and a bounded cleanup journal, without claiming that arbitrary crash leftovers can be discovered.

### Honest round-3 RED evidence

All five reviewer reproductions failed before production edits:

```text
Command: node --test --test-name-pattern="production IPC export|record replacement journals|partial superseded|cleanup journal whose|owned record" tests/record-store.test.mjs
Result: exit 1; tests 5; pass 0; fail 5; skipped 0; todo 0
Failures:
- production IPC export: `500 !== 1001`
- replacement ordering: cleanup journal was undefined before config publication
- partial cleanup: `Missing expected rejection`
- failed config publication: no cleanup journal was retained for restart reconciliation
- write-then-reject: an owned `.stage` path remained (`true !== false`)
```

The first implementation GREEN run was:

```text
Command: pnpm run typecheck && node --test --test-name-pattern="production IPC export|record replacement journals|partial superseded|cleanup journal whose|owned record" tests/record-store.test.mjs
Result: exit 0; tests 5; pass 5; fail 0; skipped 0; todo 0
```

The first full-suite attempt exposed a Windows ESM test-isolation problem, not a production persistence failure:

```text
Command: pnpm run check
Result: exit 1; tests 90; pass 89; fail 1
Failure: the second dynamic import of `dist/main.js` reused the already-registered module, so the new test could not capture a fresh `operit_mvu:export_dataset` handler.
Correction: install the real production `installMvuIpc` handlers against the persistent runtime and real Tools adapter in the export test. Existing production-main registration coverage remains unchanged.
```

The required review gate had no subagent dispatcher in this session, so a direct full-diff audit was performed. It found an additional fail-closed retry defect and reproduced it before the fix:

```text
Command: node --test --test-name-pattern="retry after repeated cleanup failure" tests/record-store.test.mjs
Result: exit 1; tests 1; pass 0; fail 1
Failure: expected `v2_compat`, actual `v3` — force retry rebuilt from v2 after repeated cleanup rejection even though the atomically published v3 config was valid.
```

Cleanup recovery is now outside the invalid-config force-rebuild catch. A validated v3 config is never made eligible for v2 rebuild merely because deletion failed:

```text
Command: pnpm run typecheck && node --test --test-name-pattern="retry after repeated cleanup failure" tests/record-store.test.mjs
Result: exit 0; tests 1; pass 1; fail 0; skipped 0; todo 0
```

### Round-3 invariants and fixes

- `V3MvuStore.readForExport()` is the explicit expensive compatibility-export API. It pages every committed record in ascending 500-record batches and validates the final count. Ordinary `read()`/runtime snapshots remain capped at the newest 500 records.
- Export and normal record queries hold the existing dataset/config path queue while reading the selected committed manifest. A replace/import cleanup therefore cannot delete a segment halfway through an in-runtime read.
- Production `operit_mvu:export_dataset` calls `runtime.exportDataset()`. V3 uses the complete paged export API; v2-only and structured `v2_compat` modes retain their full legacy-store read.
- Before a record replacement publishes config, the store atomically publishes `operit_mvu.records.v3.cleanup.json`. The journal contains the exact superseded absolute paths, expected safe-integer revision, and exact expected record-manifest identity.
- Config publication remains the only commit point. Cleanup runs afterward under the same dataset path queue, checks every journal path and the 1,024-path bound before deletion, and rejects any path present in the committed replacement manifest.
- Startup/recovery validates the committed manifest, then reconciles the journal. Exact revision/manifest matches resume idempotent deletion and finally remove the journal; mismatches remove only the journal and never its listed segments because the intended config publication did not occur.
- A partial delete leaves the unchanged exact journal. Restart skips already-absent old paths, deletes the remainder, and removes the journal. Repeated clear with no committed segments creates no empty journal and remains idempotent.
- Cleanup recovery failure cannot route a valid v3 config through force migration. Retry remains structured `v2_compat`, preserves the valid v3 and byte-identical v2 documents, and retries cleanup only.
- `publishOwnedTemporaryFile` wraps the initial write and atomic replacement for record stage files, repair files, legacy config, v3 config, and cleanup-journal publication. Any observable in-process rejection attempts deletion of that operation's unique temp path while preserving the original error.
- The host fake now models a write that stores bytes and then rejects, in addition to atomic-replace rejection. Tests cover both phases for segment, repair, config, and journal owners.

### Files in the round-3 code/test commit

- `src/mvu/app/index.ts`
- `src/mvu/app/record-store.ts`
- `src/mvu/app/store-v3.ts`
- `src/mvu/app/store.ts`
- `src/shared/ipc.ts`
- `tests/helpers.mjs`
- `tests/record-store.test.mjs`

Implementation commit:

```text
319b100ef11777464b20ddc648567fae934254c8 fix: complete v3 export and segment cleanup
7 files changed, 485 insertions(+), 31 deletions(-)
```

### Exact round-3 GREEN verification

Final focused reviewer coverage:

```text
Command: pnpm run typecheck && node --test --test-name-pattern="production IPC export|runtime import and repeated clear|partial superseded|cleanup journal whose|retry after repeated cleanup|owned record" tests/record-store.test.mjs
Result: exit 0; tests 6; pass 6; fail 0; skipped 0; todo 0
```

Final full verification on the implementation commit:

```text
Command: pnpm run check
Result: exit 0
- Manifest audit: PASS (`operit-toolpkg-host`, API 3, 7 capabilities)
- UI audit: PASS (15 screens, 42 declared actions, 48 handled actions, 20 native methods)
- TypeScript: PASS
- Temporary-effect audit: PASS
- Node tests: 91 total, 91 pass, 0 fail, 0 skipped, 0 todo
```

```text
Command: pnpm run pack
Result: exit 0
- Manifest/UI/type/effect audits: PASS
- Web build: `dist/app.html` 9,323,226 bytes
- Package: `release/operit_mvu-2.0.1.toolpkg`, 54 entries, 9,941,588 bytes data
```

```text
Command: git diff --check
Result: exit 0; no output
```

The expected `MVU persisted message processing failed Error: FAKE_REPLACEATOMICALLY_FAILED` and legacy-store rejection diagnostics are emitted by deterministic failure-order tests; all corresponding assertions pass.

### Round-3 acceptance matrix

- [x] **Bounded ordinary reads and complete explicit export.** Ordinary compatibility snapshots remain 500 records. The production IPC export test migrates and exports 1,001 committed records, checks exact count, first/last IDs, complete ordered ID sequence, and no gaps or duplicates; it also verifies v2 object shape and byte-identical source v2 storage.
- [x] **Crash-resumable superseded-segment cleanup.** Runtime import/replace and clear journal exact old paths plus expected revision/manifest before config publication, atomically publish config, delete only old unreferenced paths under the queue, and remove the journal after success.
- [x] **Safe startup reconciliation.** Matching committed replacement journals resume after partial deletion; mismatched journals from failed config publication are discarded without deleting committed old paths; valid v3 retry never rebuilds from v2 because cleanup failed.
- [x] **Protected new manifest and bounded deletion.** Journal validation rejects duplicates, malformed/non-record paths, protected replacement paths, unsafe revisions/manifests, and more than 1,024 old paths before deletion. Successful replace tests prove new segment generations remain while old generations are removed.
- [x] **Required failure injection.** Deterministic tests cover journal write-after-write rejection, journal atomic publication rejection, config write-after-write rejection, config atomic publication rejection, partial old-segment deletion, restart completion, successful import replacement, clear, and repeated clear.
- [x] **Ordinary owned-temp rejection cleanup.** Segment stage, orphan-tail repair, v2 config, v3 config, and cleanup-journal temp owners all use one checked write-plus-atomic-publication guard and best-effort deletion on observable rejection. Both write-then-reject and replace-failure phases are covered.
- [x] **Prior guarantees preserved.** All 85 pre-round-3 tests remain green, including 500-line committed-count segments, orphan-tail repair, atomic config/record ordering, raw whole-segment reads, bounded normal work, migration/fallback/retry, production message transaction composition, v3 compatibility semantics, effect handling, hourly retention, role-aware AI, caps, validation, safe integers, manifest capability audits, and byte-identical v2 preservation.
- [x] **Required verification.** Focused RED/GREEN evidence, final 91-test `pnpm run check`, `pnpm run pack`, and `git diff --check` are recorded and green.

### Residual limitations after round 3

- The atomic/CAS scope remains one persistent ToolPkg main JavaScript runtime with owner-isolated storage. External processes/writers remain outside the proven host contract, as documented in round 2.
- A true process crash after writing a unique stage/config/journal temp but before rejection handling can leave that temp. The host exposes no bounded directory listing, so it cannot be honestly discovered or reclaimed; unique names prevent collision or commitment.
- Superseded-segment cleanup deliberately fails closed before publication when more than 1,024 committed old segment paths would need deletion. This avoids unbounded/destructive recovery but requires future host/operator cleanup for such an extreme replacement.
- Explicit export is intentionally O(total committed history), materializes the v2 JSON document, and holds the in-runtime path queue for a consistent manifest. Ordinary message/UI compatibility paths remain bounded; very large exports may consume substantial time and memory.
- Atomic durability still depends on the host's declared same-directory `files.atomic_replace` capability. Tests prove the adapter's checked ordering and failure behavior, not lower-level device filesystem internals.
- No code-review subagent dispatcher was available. The direct full-diff audit found and fixed the valid-v3 force-retry issue, but this remains a process limitation rather than an independent review.

## Review round 4 fix — 2026-08-25

### Starting state and Critical root cause

- Round-4 starting `HEAD`: `eb50ca17385bbac751518ef6b8635b6972d41869`; branch and linked worktree were verified before edits. Existing commits and ignored artifacts were preserved; `progress.md` was not edited.
- Baseline `pnpm run check` passed 91 tests, with 91 pass, 0 fail, 0 skipped, and 0 todo.
- Round 4 verified that valid config and committed-record validation completed before `resumeSegmentCleanup()`, but both operations still shared `initializeAttempt()`'s outer migration catch. A delete rejection therefore returned `v2_compat` even though v3 remained valid and atomically published.
- The compatibility service then accepted writes into stale v2. A later initialization rediscovered v3 and made those apparently successful v2 mutations disappear.
- Mutation preflight also awaited cleanup as a required operation, so even after startup authority was corrected, a repeated delete failure prevented v3 commits.
- Finally, cleanup journal matching required exact revision/manifest equality. Any later valid v3 commit made the old journal appear stale and caused its pending old paths to be abandoned.
- This section supersedes round 3's incorrect claim that cleanup-only failure should return structured `v2_compat`. The correct contract is structured `mode: "v3"` with optional pending-cleanup status; migration retry is unavailable while valid v3 exists.

### Honest round-4 RED evidence

The direct-store and production-runtime regressions both failed before production edits at the same authority boundary:

```text
Command: node --test --test-name-pattern="valid v3 stays authoritative|production runtime keeps valid v3 authoritative" tests/record-store.test.mjs
Result: exit 1; tests 2; pass 0; fail 2; skipped 0; todo 0
Both failures: expected `v3`, actual `v2_compat` after injected `FAKE_DELETEFILE_FAILED` during startup cleanup.
```

TDD then applied only the startup-authority/status correction. That exposed the independent mutation defect before descendant matching or mutation recovery was changed:

```text
Command: pnpm run typecheck && node --test --test-name-pattern="valid v3 stays authoritative|production runtime keeps valid v3 authoritative" tests/record-store.test.mjs
Result: exit 1; tests 2; pass 0; fail 2
Both failures: `FAKE_DELETEFILE_FAILED` escaped mutation preflight, so direct `transactV3` and production `runtime.updateSettings` could not commit.
```

After cleanup preflight became best-effort and journal matching became descendant-aware:

```text
Command: pnpm run typecheck && node --test --test-name-pattern="valid v3 stays authoritative|production runtime keeps valid v3 authoritative" tests/record-store.test.mjs
Result: exit 0; tests 2; pass 2; fail 0; skipped 0; todo 0
```

### Round-4 invariants and fixes

- Valid v3 config plus committed records establish authority before superseded-segment cleanup. `tryResumeSegmentCleanup()` records cleanup errors but never routes validated v3 through migration fallback.
- `MigrationStatus` in v3 mode may now include `{ cleanup: { state: "pending", error } }`. `migrationStatus()` decorates the authoritative v3 status from current cleanup state, allowing advanced/runtime consumers to distinguish maintenance warning from migration failure.
- `retryMigration()` still checks the initialized mode. Cleanup-pending v3 remains `mode: "v3"`, so retry rejects with `MVU_V3_MIGRATION_RETRY_NOT_ALLOWED` and cannot rebuild from stale v2.
- Mutation recovery validates any runtime-required record repair, then attempts pending superseded-file cleanup best-effort. A cleanup rejection remains structured pending state while the v3 CAS transaction proceeds normally.
- A config-only descendant leaves the manifest exact at a later safe revision. An append descendant may extend only the prior final segment or allocate segments at/after the prior `nextSegmentIndex`; earlier segments remain exact. The matcher validates this lineage before cleanup.
- Cleanup journal eligibility accepts either the exact expected publication or a strictly later proven descendant revision. A later revision whose manifest lineage cannot be proven retains the journal and reports pending error rather than deleting paths or silently abandoning cleanup.
- Before any cleanup deletion, every journal path is still checked against the complete live manifest. A live path raises `MVU_V3_SEGMENT_CLEANUP_PROTECTED_PATH`; it is never deleted.
- Direct-store coverage appends `record_9000` after repeated cleanup failure, proves the old journal revision is retained across the new config revision, then restarts and proves cleanup removes only the old segment while the appended record and v3 setting survive.
- Production-runtime coverage uses the real Tools file adapter, starts with valid v3 plus injected cleanup failure, reads zero v3 records instead of 501 stale v2 records, commits `aiEnabled: false` to v3, preserves v2 bytes/revision, then restarts, clears the journal, and retains the v3 mutation.

### Files and implementation commit

- `src/mvu/app/store-v3.ts`
- `tests/record-store.test.mjs`

```text
9a1b0bd2fd3553ddd13e10463461f7f716e4e7b0 fix: keep valid v3 authoritative during cleanup
2 files changed, 177 insertions(+), 16 deletions(-)
```

### Exact round-4 GREEN verification

```text
Command: pnpm run typecheck && node --test --test-name-pattern="valid v3 stays authoritative|production runtime keeps valid v3 authoritative" tests/record-store.test.mjs
Result: exit 0; tests 2; pass 2; fail 0; skipped 0; todo 0
```

```text
Command: pnpm run check
Result: exit 0
- Manifest audit: PASS (`operit-toolpkg-host`, API 3, 7 capabilities)
- UI audit: PASS (15 screens, 42 declared actions, 48 handled actions, 20 native methods)
- TypeScript: PASS
- Temporary-effect audit: PASS
- Node tests: 92 total, 92 pass, 0 fail, 0 skipped, 0 todo
```

```text
Command: pnpm run pack
Result: exit 0
- Manifest/UI/type/effect audits: PASS
- Web build: `dist/app.html` 9,323,226 bytes
- Package: `release/operit_mvu-2.0.1.toolpkg`, 54 entries, 9,944,486 bytes data
```

```text
Command: git diff --check
Result: exit 0; no output
```

### Round-4 acceptance matrix

- [x] **Startup authority separated from cleanup.** Once v3 config and committed records validate, cleanup rejection is caught as maintenance state and cannot select `v2_compat`.
- [x] **Structured pending cleanup.** V3 migration status exposes a pending state and exact structured error while all reads and production decisions remain on v3.
- [x] **Mutation after cleanup failure.** Direct append and production runtime setting mutations commit to v3 after another injected delete failure; stale v2 bytes and revision remain exact and unchanged.
- [x] **Journal preserved across revision.** Both regressions prove the original expected revision remains in the journal after a later v3 commit; no migration or config publication overwrites it.
- [x] **Descendant cleanup recovery.** Later restart accepts exact-manifest config descendants and record-manifest append descendants, deletes only superseded absent paths, clears the journal, and preserves the intervening v3 mutations.
- [x] **Never delete live paths.** Descendant lineage is validated and all journal paths are checked against the current manifest before the first deletion; the direct append remains queryable after cleanup.
- [x] **Retry fails closed.** `retryMigration()` rejects while cleanup-pending valid v3 exists and cannot become a stale-v2 escape hatch.
- [x] **Production and direct regressions.** Both paths inject startup and mutation cleanup failures, assert v3 reads/commits, restart, recover, clear the journal, and verify durable mutation visibility.
- [x] **Prior suite preserved.** All 91 round-3 tests remain green; the added production regression raises the complete suite to 92/92.
- [x] **Required verification.** Focused RED/GREEN, `pnpm run check`, `pnpm run pack`, and `git diff --check` are recorded above and pass.

### Residual limitations after round 4

- Cleanup warning state is runtime-local and refreshed by startup or mutation cleanup attempts. If another store instance clears the journal, an already-initialized idle instance can display a stale warning until its next attempt; v3 authority and persisted data are unaffected.
- A later higher v3 revision whose record manifest cannot be proven as a descendant retains the cleanup journal and warning indefinitely rather than risking deletion. This is fail-closed and may require operator/host intervention.
- Existing scope limitations remain: one persistent ToolPkg main runtime, no interprocess/external-writer CAS claim, no directory listing for arbitrary crash-temp reclamation, a 1,024-path cleanup bound, and explicit export's intentional O(total history) cost.
- No code-review subagent dispatcher was available. A direct full-diff safety audit was performed before final verification; the absence of independent review remains a process limitation.

## Review round 5/5 fix — 2026-08-25

### Starting state and Important root cause

- Round-5 starting `HEAD`: `831fa48f5b342255a5876e428616b742cb60754f`; branch `codex/mvu-v3-complete-redesign` and the requested linked worktree were verified clean before edits.
- Baseline `pnpm run check` passed all 92 existing tests: 92 pass, 0 fail, 0 skipped, 0 todo. Existing commits and ignored SDD artifacts were preserved; `progress.md` was not edited.
- Round 4 correctly made startup and mutation preflight cleanup best-effort, but `commitLoaded()` still called throwing `resumeSegmentCleanup()` after `persistConfig()` had atomically committed the replacement/clear config.
- A post-commit old-segment deletion failure therefore rejected the user operation even though its result was already durable. The same-runtime caller did not receive the committed snapshot/result or structured pending-cleanup status through the normal success path.

### Honest round-5 RED evidence

Tests were changed before production code. The focused run used the unchanged throwing post-publication call:

```text
Command: pnpm run typecheck; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; node --test --test-name-pattern="post-commit partial cleanup|cleanup journal whose config publication failed|valid v3 stays authoritative|production runtime keeps valid|production IPC import resolves" tests/record-store.test.mjs
Result: exit 1; tests 5; pass 1; fail 4; skipped 0; todo 0
Passing control: cleanup journal whose config publication failed (pre-publication `FAKE_REPLACEATOMICALLY_FAILED` still rejected).
Four failures: direct clear, valid-v3 descendant mutation setup, production runtime setup, and production IPC import all rejected with `FAKE_DELETEFILE_FAILED` after config publication.
```

The production IPC regression was subsequently tightened to inject a pre-publication atomic-replace failure before its post-publication deletion failure. Its first assertion incorrectly assumed an uncommitted replacement segment would already be absent. The durable config correctly remained at the old revision and referenced only old segments; the known uncommitted segment is removed/reused by the next exclusive recovery. The assertion was corrected to test committed-manifest authority rather than physical absence before recovery. No production change resulted from that test-calibration failure.

### Round-5 fix and invariants

- `commitLoaded()` keeps atomic config publication as the commit point. All journal creation, record staging, safe-integer validation, and `persistConfig()` failures still reject before a committed result can be returned.
- Only after `persistConfig()` succeeds does replacement/clear call `tryResumeSegmentCleanup(committed)`. The wrapper awaits the cleanup attempt, catches a deletion error, preserves its structured message, and lets the operation return its committed snapshot/result.
- A partial delete leaves the exact cleanup journal in place. `migrationStatus()` in the same store/runtime reports `mode: "v3"` and `cleanup.state: "pending"` with the real `FAKE_DELETEFILE_FAILED` error.
- Restart/retry uses the existing exact/descendant manifest proof and protected-live-path checks. It skips already-absent old paths, removes only superseded paths absent from the live manifest, then clears the journal and warning.
- Direct coverage proves a clear returns revision `before + 1`, zero committed records, same-runtime pending status, restart cleanup, and byte-identical v2 with unchanged legacy revision.
- Production coverage invokes the actually registered `operit_mvu:import_dataset` handler. A pre-publication atomic-replace failure rejects and leaves the old committed manifest authoritative; a later post-publication delete failure resolves, commits the one-record replacement in a new live segment, reports pending cleanup in the same runtime, and recovers safely on restart.
- The production restart proves the live replacement segment and `record_7000` survive while only old superseded segments and the cleanup journal disappear. V2 bytes and revision remain unchanged throughout.

### Files and implementation commit

- `src/mvu/app/store-v3.ts`
- `tests/record-store.test.mjs`

```text
ee7fe8ac38fe0fa22ef1f4b353aef212c2598341 fix: report post-commit cleanup as pending
2 files changed, 91 insertions(+), 5 deletions(-)
```

### Exact round-5 GREEN verification

Final focused coverage, including both pre- and post-publication production IPC failures:

```text
Command: pnpm run typecheck; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; node --test --test-name-pattern="post-commit partial cleanup|cleanup journal whose config publication failed|valid v3 stays authoritative|production runtime keeps valid|production IPC import resolves" tests/record-store.test.mjs
Result: exit 0; tests 5; pass 5; fail 0; skipped 0; todo 0
Expected diagnostics: production IPC logs `FAKE_REPLACEATOMICALLY_FAILED` for the asserted pre-publication rejection.
```

```text
Command: pnpm run check
Result: exit 0
- Manifest audit: PASS (`operit-toolpkg-host`, API 3, 7 capabilities)
- UI audit: PASS (15 screens, 42 declared actions, 48 handled actions, 20 native methods)
- TypeScript: PASS
- Temporary-effect audit: PASS
- Node tests: 93 total, 93 pass, 0 fail, 0 skipped, 0 todo
```

```text
Command: pnpm run pack
Result: exit 0
- Manifest/UI/type/effect audits: PASS
- Web build: `dist/app.html` 9,323,226 bytes
- Package: `release/operit_mvu-2.0.1.toolpkg`, 54 entries, 9,944,489 bytes data
```

```text
Command: git diff --check
Result: exit 0; no output
```

### Round-5 acceptance matrix

- [x] **Post-commit cleanup is non-throwing.** Replacement/clear invokes `tryResumeSegmentCleanup()` only after atomic config publication and returns the committed result when deletion fails.
- [x] **Same-runtime warning is exact.** The journal remains and migration status reports authoritative v3 plus pending cleanup carrying the injected deletion error.
- [x] **Recovery is safe and resumable.** Later restart clears the journal and old segment remainder without deleting the live replacement path or losing the committed imported record.
- [x] **V2 remains untouched.** Direct and production IPC regressions compare exact serialized v2 bytes and its legacy revision before and after failure/recovery.
- [x] **Pre-publication failures still reject.** Both the existing direct config-publication test and production IPC import inject `replaceAtomically` failure, observe rejection, and prove the old config revision/manifest remains authoritative.
- [x] **Direct and production wiring covered.** The store regression checks the returned snapshot; the production test invokes the registered IPC handler and checks the durable runtime/store result rather than an internal helper.
- [x] **Prior guarantees preserved.** All 92 round-4 tests remain green; the added production IPC regression raises the suite to 93/93.
- [x] **Required verification complete.** Focused RED/GREEN, `pnpm run check`, `pnpm run pack`, and `git diff --check` are recorded above and pass.

### Residual limitations after round 5

- Cleanup warning state remains runtime-local. Another store instance may clear the durable journal while an idle initialized instance retains its last warning until its next cleanup attempt; v3 authority and committed data are unaffected.
- A pre-publication rejection can leave an uncommitted record segment until the next exclusive in-runtime recovery. The durable manifest never references it, so it is not visible as committed data; ordinary rejected-operation temp paths are still best-effort removed as documented in round 3.
- The established scope remains one persistent ToolPkg main JavaScript runtime with owner-isolated storage; there is no cross-process/external-writer CAS claim.
- Atomic durability depends on the host's declared same-directory `files.atomic_replace` capability. A true process crash may leave unique temporary files that cannot be enumerated through the available bounded host API.
- No code-review subagent dispatcher was exposed in this session. The required review skill therefore ended in a direct contract-focused diff audit; no Critical, Important, or Minor issue was found in the round-5 change.
