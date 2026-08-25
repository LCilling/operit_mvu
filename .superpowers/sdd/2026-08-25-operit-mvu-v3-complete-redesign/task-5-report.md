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
