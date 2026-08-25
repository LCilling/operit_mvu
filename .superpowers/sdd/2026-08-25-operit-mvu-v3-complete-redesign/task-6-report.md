# Task 6 Report — Bounded query services and typed IPC

## Outcome

Implemented Task 6 on `codex/mvu-v3-complete-redesign` and committed the production/test change as:

- Commit: `474a1d9ff583e114dba56d046d974f397ae2c159`
- Subject: `feat: add bounded v3 query IPC`
- Review fix: `6f62e8c8162ba2911c3f9cc6a9677622f3f9b759` (`fix: stabilize v3 picker cursors`)
- Base: `d45ea9f7d389deebcf4c9b250e403dcefc8a6fa0`

The SDD multi-agent dispatch tools were unavailable in this session. The work therefore used controller-run strict TDD followed by separate read-only spec-compliance and code-quality review passes. `progress.md` was never edited.

## RED evidence

Initial command:

```text
pnpm run typecheck; node --test tests/query.test.mjs
```

Observed result:

- `pnpm run typecheck`: PASS.
- Focused query test: FAIL, 0 pass / 1 fail.
- Expected failure: `ERR_MODULE_NOT_FOUND` for `dist/mvu/app/query.js` because the query API did not exist.

Review hardening RED:

```text
pnpm run typecheck; node --test --test-name-pattern "query parsers reject" tests/query.test.mjs
```

Observed result:

- Typecheck: PASS.
- Focused boundary test: FAIL, 0 pass / 1 fail.
- Expected failure: invalid entity-specific filter values were accepted before value allowlists were added.

Cursor review RED:

```text
pnpm run typecheck; node --test --test-name-pattern "picker keyset" tests/query.test.mjs
```

- Typecheck: PASS.
- Focused cursor test: FAIL, 0 pass / 1 fail.
- Expected failure: an actor inserted before an offset cursor caused a duplicate row in the next batch.
- Resolution: cursor payloads now anchor on the stable primary sort value plus ID rather than an array offset.

## GREEN evidence

Direct Task 6 contract:

```text
node --test tests/query.test.mjs
```

- PASS: 10 tests / 10 passed / 0 failed.

Focused query plus Task 5 storage regression:

```text
pnpm run typecheck
node --test tests/query.test.mjs tests/record-store-hardening.test.mjs tests/record-store.test.mjs
node scripts/audit-web-ui.mjs
```

- Typecheck: PASS.
- Focused tests: 53 tests / 53 passed / 0 failed.
- UI bridge/accessibility audit: PASS (`15` screens, `42` declared actions, `48` handled actions, `20` currently UI-referenced native methods), with all 26 new v3 bridge methods additionally required by the audit.

Full verification:

```text
pnpm run check
git diff --check
```

- Full tests: 103 tests / 103 passed / 0 failed.
- Original Task 5 baseline preserved: all prior 93 tests remain in the passing suite.
- Static audits, TypeScript, temporary-effect regression: PASS.
- `git diff --check`: PASS with no whitespace errors.

The expected failure-injection tests continue to print their intentional simulated persistence errors while passing their assertions.

## Review results

- Task-scoped spec/quality review found one Important issue: offset picker cursors could duplicate a row after an insertion before the prior batch.
- Fix round 1 replaced offsets with sort-value/ID keysets and added an independently failing regression test.
- Scoped re-review of `474a1d9..6f62e8c` found the issue addressed with no new Critical or Important findings.
- Final whole-task review of `d45ea9f..6f62e8c` found no open Critical or Important findings. The session lacked multi-agent dispatch support, so these were role-separated controller reviews rather than separate-agent verdicts.

## Design decisions

1. `QueryRequest` and `QueryResponse<T>` are defined once in `query.ts`; every collection uses the exact five response keys.
2. Management page sizes are constants owned by the backend: fields/rules `5`, conditions/effect groups `10`, records `10`. Client-supplied page-size keys are rejected by exact-key parsers.
3. Actor/group pickers always use cursor batches of at most `30`. Field queries enter picker mode only through the allowlisted `filters.mode = "picker"`; cursor state is opaque, query-fingerprinted, and keyset-anchored by sort value plus ID.
4. Search applies NFKC Unicode normalization, case folding, trimming, and whitespace collapsing. Every collection sort uses its stable ID as the final tie-break.
5. Record pagination reads exact committed line ranges through `readTextPart`; decorated host line prefixes are validated and removed before JSON parsing. Whole record history and whole segment bodies are not materialized by ordinary record queries.
6. The page snapshot exposes active context, selected actor/group summaries, counts, migration/cleanup status, settings, and only the first bounded field/rule/condition/effect/record pages. It contains no actor/group option arrays or full history.
7. `getEntityById` accepts only six explicit entity types and resolves only through the current dataset or host-owned actor/group directories. Record/file/path access is not exposed.
8. Condition/effect-group/rule mutations use v3 CAS transactions and whole-dataset validation. Deletes reject live references; reference methods return bounded configuration/active-instance summaries rather than scanning history.
9. Record query filtering/search is fail-closed in Task 6 because exact totals for arbitrary history filters would require scanning all committed record bodies. Only stable committed-order paging with the safe `occurredAt` direction control is exposed; richer indexed diagnostic filtering remains a later-task concern.
10. In `v2_compat` mode, read-only compact queries use an in-memory migration projection over the already bounded compatibility dataset. Mutations fail closed until v3 is available.

## Files

- Added `src/mvu/app/query.ts`.
- Added `tests/query.test.mjs`.
- Modified `src/mvu/app/index.ts` to expose the query facade.
- Modified `src/mvu/app/record-store.ts` for exact committed line-range reads.
- Modified `src/shared/ipc.ts` for typed channels, parsers, handlers, and client calls.
- Modified `src/ui/web_container/index.ui.ts` for every NativeMvu dispatch case.
- Modified `src/main.ts` for host-backed query composition and compact snapshots.
- Modified `scripts/audit-web-ui.mjs` while retaining all prior assertions and adding required v3 bridge cases.
- Updated the two directly related Task 5 record-read assertions in `tests/record-store-hardening.test.mjs` and `tests/record-store.test.mjs` from whole-segment reads to exact partial-read expectations.

## Acceptance checklist

- [x] All eight methods implemented: `queryFields`, `queryActors`, `queryGroups`, `queryRules`, `queryConditions`, `queryEffectGroups`, `queryRecords`, `getEntityById`.
- [x] Exact query contracts and exact-key request parsing.
- [x] Unknown keys, overlong search/cursor/IDs, oversized nested mutation data, unsafe sort keys, filter keys, and filter values rejected.
- [x] Server-owned page sizes: 5/5/10/10.
- [x] Picker cursor batches never exceed 30 and do not expose user-facing load-more behavior.
- [x] Unicode/case/whitespace search normalization.
- [x] Stable ID tie-breaking and duplicate/skip coverage across pages/cursors.
- [x] Exact `loadedCount`, `totalCount`, `hasMore`, and `nextCursor` behavior.
- [x] Large fixtures: 500 fields, 200 actors, 200 groups, 1,000 rules, and 100,000 committed record metadata.
- [x] Record page reads only the required committed segment line range and does not materialize history.
- [x] Compact page snapshot contains no full options/history.
- [x] Typed IPC/client/NativeMvu bridge covers all query and v3 CRUD/copy/toggle/delete/reference methods.
- [x] `getEntityById` is entity-type and ownership scoped.
- [x] Task 5 atomic export/import/cleanup behavior preserved; all prior tests still pass.
- [x] Existing web audit invariants retained and extended.
- [x] Focused tests, `pnpm run check`, and `git diff --check` pass.
- [x] Required implementation commit created.

## Risks and follow-up boundaries

- The next UI tasks must consume `snapshot.pages` and query IPC; the legacy monolithic UI still expects the pre-v3 full snapshot shape and is intentionally replaced by Task 7.
- Arbitrary record-body search/filtering remains unsupported until a bounded persisted index is designed; implementing it by scanning 100,000 records would violate this task’s bounded-I/O requirement.
- Keyset cursors prevent duplicate/skip behavior when rows are inserted before the previous batch. Totals can still change when the host directory itself changes between requests because host snapshots do not expose a revision token.
- Host `readPart` decoration is validated against exact requested line numbers. A future host formatting change must preserve or explicitly version that contract.

## Independent review fix round 2

The independent review of `d45ea9f..6f62e8c` superseded the earlier clean-review statement above. It found one Critical concurrency defect and seven Important query/snapshot/effect defects. This round addressed every requested item in four focused implementation commits:

- `c36bf63` — strict client-owned `expectedRevision`, committed-revision responses, opaque server-owned cursor state, raw-ID tie-breaking, deep AI predicate copy IDs, strict parser prototypes/keys.
- `6845819` — bounded summary-only first-page snapshot with real current-state projections; exact bounded condition/effect reference pages.
- `e03e03e` — immutable active-effect definition snapshots, v2 migration snapshots, and safe one-time hydration of older v3 instances.
- `afa36f8` — reject oversized IDs before any dataset read, including reference services.

### TDD evidence

- Initial review tests failed on embedded JSON cursors, normalized-ID collisions, missing revision contracts, unbounded IDs/prototypes, stale-client overwrites, duplicate nested AI IDs, full-definition snapshots, missing current-state projections, and mutable active effects.
- Snapshot/reference tests failed before summary DTO/current-state projection support was added.
- Effect immutability test initially failed because `hydrateLegacyActiveEffectSnapshots` did not exist.
- The final pre-read ID tests failed with three dataset reads before validation; after the fix they pass with zero reads.

### Final verification

```text
pnpm run check
git diff --check
```

- Static manifest/WebView audits: PASS (`15` screens, `42` declared actions, `48` handled actions, `20` currently UI-referenced native methods).
- TypeScript: PASS.
- Temporary-effect audit: PASS.
- Full tests: `113` passed / `0` failed.
- Query tests: `17` passed / `0` failed.
- New effect-immutability tests: `3` passed / `0` failed.
- The 100,000-record test still reads only the requested 10 committed lines and obtains the exact total from the manifest.
- Task 5 atomic publication, recovery, migration, cleanup, compatibility, and bounded-history regressions remain green.
- `git diff --check`: PASS.

Expected failure-injection diagnostics remain visible in the test output while their assertions pass.

### Residual boundaries

- `static/app_ui/app.js` still targets the legacy snapshot shape by explicit Task 7 scope; Task 6 now provides and tests the typed bounded replacement contract without patching the monolith.
- Cursor state is intentionally runtime-local, capped at 128 entries and expires after five minutes; a runtime restart invalidates outstanding picker cursors and the UI must restart that search.
- Actor/group directory totals can change between cursor requests because the host does not provide a directory revision token.
- Arbitrary record-body search remains fail-closed to preserve the bounded 100,000-record I/O guarantee.
- Two unrelated release-version document edits were present in the shared worktree during final verification. They were not staged or modified by this Task 6 round.
