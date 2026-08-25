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
