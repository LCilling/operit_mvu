# SDD ledger — plan: docs/superpowers/plans/2026-08-25-operit-mvu-v3-complete-redesign.md

Spec: docs/superpowers/specs/2026-08-25-operit-mvu-v3-complete-redesign-design.md
Branch: codex/mvu-v3-complete-redesign
Worktree: D:/ProjectFile/operit_mvu/.worktrees/mvu-v3-complete-redesign
Merge base: bb7892f
Baseline: `pnpm run check` PASS (UI audit 15 screens; TypeScript; temporary-effect regression).

## Pre-flight dependency and consistency scan

| Tasks | Producer / consumer or internal check | Finding |
|---|---|---|
| 1 | v3 contracts, migration result, fixtures and test command | Internally consistent; compiled JS tests depend on the specified TypeScript emission. |
| 2 | condition expression evaluator consumes Task 1 model | Consistent; actor prefilter precedes pending AI collection. |
| 3 | effect activation/calculation consumes Task 1 actor and operation unions | Consistent; exact-target activation prevents dynamic actors broadening. |
| 4 | rule engine consumes Tasks 2–3 and updates service/model calls | Consistent; deterministic phase then one AI batch then action execution. |
| 5 | v3 stores consume Task 1 migration and write records from Task 4 service | Consistent; configuration commit owns record visibility. |
| 6 | queries consume Task 5 store and expose Task 1 entities through IPC | Consistent; server owns management page sizes. |
| 7 | UI shell consumes Task 6 compact snapshot/IPC | Old UI audit encodes five navigation items and monolithic boundaries. Ruling recorded below. |
| 8 | pickers and management lists consume Task 6 queries and Task 7 components | Consistent; user-facing load-more is forbidden while cursor fetching remains internal. |
| 9 | visual editors consume Task 6 CRUD and Task 8 picker | Consistent; recursive conditions, actor binding and field-first effects use canonical contracts. |
| 10 | model budget consumes Task 1 fields and Task 4 rule references | Consistent; direct references override visibility budget. |
| 11 | package/release consumes all implementation and verification outputs | Release directory is ignored and must be uploaded, not committed. Plan already corrected. |
| 1 ↔ 2 | `model-v3.ts`, `seed.ts`, `validation.ts` | Task 2 extends, rather than renames, Task 1 discriminants. |
| 1 ↔ 3 | `model-v3.ts`, `validation.ts` | Task 3 uses exact operation kinds declared by Task 1. |
| 1 ↔ 5 | `migration-v3.ts`, `MvuDatasetV3` | Task 5 persists the pure migration result without mutating v2. |
| 1 ↔ 6 | test script and query test compilation | Repeated TypeScript compilation is harmless but can be optimized without changing evidence. |
| 2 ↔ 4 | `ConditionEvaluation.pendingAiPredicateIds` | Task 4 must merge AI answers by predicate ID and rerun expression truth, not treat pending as matched. |
| 2 ↔ 9 | condition CRUD and recursive editor | UI payload must preserve expression discriminants and shared references. |
| 2 ↔ 10 | AI predicate field references and prompt budget | Referenced fields are mandatory inputs even if hidden. |
| 3 ↔ 4 | effect activation from rule action | `activate_effect_group` passes current event actor as `triggerActorId`. |
| 3 ↔ 5 | active instance persistence | Resolved targets and reason snapshots are persisted in v3 config. |
| 3 ↔ 9 | effect-group editor | UI defaults `actorSelector.kind` to `all_bound` and supports all operation kinds. |
| 4 ↔ 5 | bounded runtime arrays and persisted facts | Service caps are applied before each v3 transaction. |
| 4 ↔ 10 | role-aware model request | Task 10 keeps `{role, actorId, actorName, content}` introduced by Task 4. |
| 5 ↔ 6 | record query and configuration query | Queries read only committed segment line counts. |
| 5 ↔ 10 | migration/diagnostic UI | Store exposes structured status; UI does not parse storage files directly. |
| 5 ↔ 11 | v2/v3 import-export docs and package tests | Documentation must describe fallback without claiming v2 overwrite. |
| 6 ↔ 7 | compact snapshot and page roots | Root renders must request page data instead of assuming full arrays. |
| 6 ↔ 8 | search cursor contract | Picker discards stale responses and treats cursor pagination as invisible implementation detail. |
| 6 ↔ 9 | CRUD parsers and editor payloads | Strict parser keys must be updated with each canonical editor payload. |
| 7 ↔ 8 | shared `runtime.js`, `components.js`, styles | Task 8 extends exported namespace functions; no duplicate navigation state. |
| 7 ↔ 9 | page modules and CSS | Task 9 adds editor views within the four-root ownership map. |
| 7 ↔ 11 | build script and package audit | Multi-script sources are inlined into one root `app.html`. |
| 8 ↔ 9 | shared picker | Every potentially large field/actor/group selector uses the same modal. |
| 8 ↔ 11 | static audit and visual evidence | Page counts and absence of load-more are checked both statically and visually. |
| 9 ↔ 10 | advanced/rules pages | System maintenance remains collapsed below appearance and import/export. |
| 10 ↔ 11 | model-budget test and docs | User-facing used/total field count must match backend selection. |

Ruling: Task 7 must rewrite obsolete assertions in `scripts/audit-web-ui.mjs` while preserving accessibility and bridge guarantees — the v3 spec requires four roots and split modules — cost if wrong: an old regression assertion may be weakened, so the new audit must carry each retained invariant explicitly.

Ruling: Use `node --test tests` instead of the glob form if the Windows Node runner does not expand `tests/*.test.mjs` — this changes only test discovery portability, not coverage — cost if wrong: test discovery could omit a file, so the package audit must enumerate discovered test count.

Ruling: The generated ToolPkg stays git-ignored and is attached to GitHub Release rather than forced into source history — the repository already treats release artifacts this way — cost if wrong: consumers rely on the Release asset, so remote SHA verification is mandatory.

Ruling: Push, tag and GitHub publication are external side effects; implementation and local APK verification continue automatically, but publication requires an explicit final approval immediately before execution — cost if wrong: one additional approval round before release.

Task 1: base bb7892f9e45f6c961e33125b8df8e193ab9dde60
Task 1: fix round 1/5 (1 addressed, 0 open — auto-rule target broadening fixed; commits de596b8..6f50494)
Task 1: out-of-scope carried to Tasks 3–4 — independently test that a missing trigger actor skips executor actions; migration now encodes `trigger_actor` but Task 1 does not own execution.
Task 1: complete (commits bb7892f..6f50494, review clean)

Ruling: The field trend chart must use the same fixed field min/max axis, stage thresholds, and stage colors as the stage visualization — the screenshot shows the existing recent-data autoscale makes one value occupy inconsistent visual positions — cost if wrong: fixed-axis trends may look flatter for small changes, so preserve readable points and labels without reverting to independent scaling.

Ruling: Field-detail cards use one 12px vertical stack gap, including value→stage, stage→trend, and trend→recent sections; remove negative or one-off collapsed spacing — the screenshot shows the stage/trend seam is uniquely compressed — cost if wrong: the page becomes slightly taller, so density must be recovered inside cards rather than by collapsing inter-card rhythm.

Task 2: base 5062869bdec776144113ecdd6eb3c57bff453ca8
Task 2: minor (deferred): date validation accepts malformed concrete dates and impossible repeating dates; final review must triage before merge.
Task 2: fix round 1/5 (5 addressed, 0 open — hourly buckets, keyword modes, sender fail-closed, AI IDs, boundary tests; commits 608edf1..341012e)
Task 2: out-of-scope carried to Tasks 4–5 — persist durable hourly message buckets in `MvuDatasetV3` and populate them during message processing; evaluator input alone is insufficient.
Task 2: complete (commits 5062869..341012e, review clean)

Task 3: base e7a12376a4f61d0c312b7ead6eb2281a5bae0d90
Task 3: minor (deferred): effect expiry compares timestamp strings lexically although validation accepts equivalent timestamps with offsets; final review must triage.
Task 3: fix round 1/5 (4 addressed, 0 open — atomic activation, legacy same-field grouping, custom reason validation, multi-field test; commits 80420c6..e96acd1)
Task 3: out-of-scope carried to Task 4 — route production rule actions and field changes through the pure v3 engine.
Task 3: complete (commits e7a1237..e96acd1, review clean)

Ruling: Task 4 implements the complete v3 rule engine and a callable v3 message-processing service path, while Task 5 switches the production runtime after v3 CAS/record storage exists — routing production `processPersistedMessage` earlier would require unsafe v2/v3 partial writes — cost if wrong: integration proof is split across two tasks, so Task 5 review must require an end-to-end production-path test.

Task 4: base e96acd10888b6b49df7d66f2293a3e6d8b947fbc
Task 4: minor (deferred): selector matrix carries unused expected booleans and confusing `wrong_current` naming; final review must triage test clarity.
Task 4: fix round 1/5 (4 addressed, 0 open — missing-actor immutability, current-event sender, exact action contracts, proof matrix; commits a8b035e..ddd43da)
Task 4: out-of-scope carried to Task 5 — atomically persist `processPersistedMessageV3` output and switch production routing only after end-to-end composition proof.
Task 4: out-of-scope carried to Task 5 — define retention/compaction for hourly buckets without dropping hours still referenced by user condition windows.
Task 4: complete (commits e96acd1..ddd43da, review clean)

Ruling: Task 5 owns the actual production switch only after v3 configuration, active effects, frequency facts, and record visibility can be committed as one crash-safe transaction; retaining the v2 production route after Task 5 is not completion — cost if wrong: UI work could be built over a runtime that never exercises the new architecture.

Ruling: Hourly message-frequency history must remain correct for every currently enabled condition window. Prefer lossless segmented storage or an explicit retention horizon derived from active windows; never silently prune hours that an enabled condition still references — cost if wrong: long-window and high-frequency rules become nondeterministic after cleanup.

Task 5: base ddd43da73ff19b825f3787cc4795bc6a0fc1dfdb
Task 5: implementer attempt 1 interrupted before report/commit; uncommitted WIP preserved. Controller diagnostic only: typecheck plus 9 focused storage tests passed, but no acceptance or review credit assigned.
Task 5: implementer attempt 2 was closed after an extended running audit produced no changes, report, or actionable checkpoint; WIP remains preserved and focused tests remain green.
Task 5: implementation complete pending independent review (implementation 6d960b5; report bcb2cd9; final implementer verification 57/57).
Task 5: review round 1 — 3 Critical, 5 Important, 1 Minor. Not accepted. Required fixes: host atomic replace/raw reads; cross-instance transaction exclusion and startup-only repair; preserve hidden v3 rule/effect semantics; bound ordinary record work; safe migration retry; host-faithful race/failure tests; safe counters.
Task 5: fix round 1/5 implemented (d40e0f6; report 9424d63; 70/70) — pending reviewer recheck of all 9 findings.
Task 5: re-review round 1 — 5/9 resolved; 1 Critical, 3 Important, 1 Minor remain. Critical is cross-execution-engine CAS/recovery ownership; Important are undeclared atomic host capability, discarded legacy action additions, and multi-instance/target effect reconciliation.
Task 5: fix round 2/5 implemented (8eb1230; report 819ceb8; 85/85; package built) — pending reviewer recheck.
Task 5: re-review round 2 — prior 5 findings resolved; 2 new Important and 1 Minor remain: full export is truncated to bounded snapshot, replaced/cleared segments lack durable cleanup, and ordinary rejected staging may leak known temp files.
Task 5: fix round 3/5 implemented (319b100; report eb50ca1; 91/91; package built) — pending final reviewer recheck.
Task 5: re-review round 3 — export and temp cleanup resolved; 1 Critical remains: cleanup failure after valid v3 validation incorrectly falls back to stale v2 and can lose accepted mutations.
Task 5: fix round 4/5 implemented (9a1b0bd; report 831fa48; 92/92; package built) — pending final reviewer recheck.
Task 5: re-review round 4 — Critical resolved; 1 Important remains: post-commit cleanup failure rejects an already committed replacement and leaves runtime cleanup status falsely clean.
Task 5: fix round 5/5 implemented (ee7fe8a; report d45ea9f; 93/93; package built) — pending decisive reviewer recheck.
Task 5: complete (commits ddd43da..d45ea9f, 93/93, final independent review clean)

Task 6: base d45ea9f7d389deebcf4c9b250e403dcefc8a6fa0
Task 6: implementation complete pending review (474a1d9 + 6f62e8c; 103/103).
Task 6: independent review rejected initial implementation — 1 Critical, 7 Important, 2 Minor themes; required client revision CAS, opaque bounded cursors, raw-ID tie-breaks, deep AI copy IDs, summary/current-state snapshot, bounded references, immutable active effects, and strict pre-read IDs.
Task 6: review fix round complete (c36bf63 + 6845819 + e03e03e + afa36f8; 113/113; `pnpm run check` and `git diff --check` PASS). Pending fresh independent re-review.
Task 6: review fix round 2 complete (`c63b8d8`; query 35/35, full 131/131; exact filter fingerprints, 64 KiB legacy-safe compact snapshot, formal 15-operation CAS matrix; `pnpm run check` and `git diff --check` PASS). Pending fresh independent re-review; Task 7 monolith remains untouched.
Task 6: final identity-preservation fix complete (`d2b957f`; query 38/38, full 134/134; exact IDs/references/timestamps/colors, atomic 2 KiB URI handling, 64 KiB cardinality reduction with `snapshotTruncated`/`returnedCount`; `pnpm run check` and `git diff --check` PASS). Task 7 monolith remains untouched.
Task 6: complete (final independent review clean; 134/134; bounded query/IPC contracts sealed).

Task 7: base ab6d927 (Task 6 final review closeout).
Task 7: TDD RED confirmed (33 initial shell violations; focused regressions for delegated route collision, segmented font size, cache invalidation, background bounds, drawer isolation, and child-editor entry actions).
Task 7: implementation complete (`2c2ccb1`; seven modules, four roots, compact snapshot adapter, normal-flow bottom layout, fixed-range stage/trend visuals, uniform 12px detail stack).
Task 7: local 393×852 visual pass clean after one interaction fix — group selector 1 / actor selector 0 in group mode; four bottom items; static nav; 11.99px card gaps; action/nav overlap 0; transparent back target.
Task 7: verification clean (`pnpm run build:web`, `pnpm run check`, 134/134, `git diff --check`; Impeccable detector `[]`).
Task 7: complete pending independent review; Task 8 owns live search/pagination/pickers and Task 9 owns complete editor mutations.
Task 7: review fix A complete (`4129d58`; runtime import/export contracts, group projections/member filtering, app-owned navigation, per-kind DTO validators).
Task 7: review fix B complete (`139d4d2`; range validation/preview, exact stage projection, context-before-page filtering, indexed field+scope record queries).
Task 7: review fix C complete (`d37e64e`; scalable viewport, no forced text zoom, drawer focus trap/restore, roving segmented tabs, avatar/background hardening, 130% fixture).
Task 7: remediation verification clean (`pnpm run check`, 149/149; `pnpm run build:web`, 9,150,635 bytes; `git diff --check`; Impeccable detector `[]`). Browser matrix 320/360/393/430 plus 130%: horizontal/action overflow 0, action/nav overlap 0, stage/trend gap 11.99px, normalized stage error 0–0.01px.
Task 7: modified APK/MuMu host acceptance remains Task 11; release target remains 3.0.0 and was not modified here.
