# Operit MVU v3 Complete Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Operit MVU 3.0.0 with actor-aware effect groups, a reusable condition library, bounded v3 persistence/querying, searchable large-data UI, four-section navigation, and verified compatibility with the modified OperitAI APK.

**Architecture:** Keep the feature plugin-local. Introduce v3 domain modules beside the current app service, migrate v2 into a separate v3 dataset without overwriting it, append history into committed JSONL segments, and expose all large collections through typed query IPC. Split the monolithic WebView script into a small shared runtime plus four page modules that consume query responses instead of a full dataset snapshot.

**Tech Stack:** TypeScript 5.9, Node.js `node:test`/`assert`, ToolPkg Files and IPC APIs, vanilla JavaScript WebView UI, CSS Grid, pnpm, ADB against the modified OperitAI APK.

**Spec:** `docs/superpowers/specs/2026-08-25-operit-mvu-v3-complete-redesign-design.md`

## Global Constraints

- Set package and manifest version to `3.0.0`; produce `release/operit_mvu-3.0.0.toolpkg`.
- Do not modify or overwrite `operit_mvu.dataset.v2.json`; migration writes v3 files and switches only after validation.
- Do not modify OperitAI host source; use the APK under `OperitAI` only for integration verification.
- Missing `triggerActorId` must skip the affected action and record a diagnostic; it must never broaden to all actors.
- Effect calculation order is base delta, filters, fixed adjustment, directional multiplier, general multiplier, step normalization, then min/max clamp.
- Rule and field management pages show 5 items per page; records show 10; conditions and effect groups show 10.
- Field, actor, and group selection opens a searchable picker; no user-facing “加载更多” action is allowed.
- Do not reduce body font size to increase density.
- Preserve the existing untracked `artifacts/` directory and unrelated user changes.
- Every behavior change follows red-green-refactor and ends in a focused commit.

## File Structure

New backend files:

- `src/mvu/app/model-v3.ts`: canonical v3 entities and discriminated unions.
- `src/mvu/app/migration-v3.ts`: pure v2-to-v3 conversion and migration report.
- `src/mvu/app/condition-engine.ts`: recursive condition evaluation and AI predicate collection.
- `src/mvu/app/effect-engine.ts`: target resolution, activation, and field-delta pipeline.
- `src/mvu/app/rule-engine-v3.ts`: actor filtering, condition evaluation, and rule action planning.
- `src/mvu/app/query.ts`: stable search/filter/sort/page operations and page-size policy.
- `src/mvu/app/record-store.ts`: JSONL segment metadata and crash-safe record transactions.
- `src/mvu/app/store-v3.ts`: v3 configuration CAS, migration startup, and v2 fallback status.

New frontend files:

- `static/app_ui/runtime.js`: browser state, native calls, routing, render scheduling, and shared events.
- `static/app_ui/components.js`: top bars, four-item bottom navigation, segmented controls, pagination, and searchable picker.
- `static/app_ui/pages-status.js`: character/group status, detail, and records.
- `static/app_ui/pages-config.js`: field list/editor, scope binding, natural/per-turn/link configuration.
- `static/app_ui/pages-rules.js`: rules, condition library, effect groups, and their editors.
- `static/app_ui/pages-advanced.js`: appearance, import/export, migration, defaults, and diagnostics.
- `static/app_ui/app.js`: event delegation and boot only.

New verification files:

- `tests/helpers.mjs`: builders and in-memory/fake file adapters.
- `tests/migration-v3.test.mjs`
- `tests/condition-engine.test.mjs`
- `tests/effect-engine.test.mjs`
- `tests/rule-engine-v3.test.mjs`
- `tests/record-store.test.mjs`
- `tests/query.test.mjs`
- `scripts/audit-v3-ui.mjs`
- `scripts/audit-v3-package.mjs`

Existing integration files modified across tasks:

- `src/mvu/app/model.ts`, `validation.ts`, `service.ts`, `automation.ts`, `state-prompt.ts`, `system-model.ts`, `store.ts`, `index.ts`, `seed.ts`
- `src/shared/ipc.ts`, `src/ui/web_container/index.ui.ts`, `src/main.ts`
- `static/app_ui/index.html`, `static/app_ui/styles.css`, `scripts/build-web.mjs`, `scripts/audit-web-ui.mjs`, `scripts/audit-temporary-effects.mjs`
- `package.json`, `manifest.json`, `README.md`, versioned files in `docs/`

---

### Task 1: Establish the v3 test harness and canonical domain model

**Files:**
- Create: `tests/helpers.mjs`
- Create: `tests/migration-v3.test.mjs`
- Create: `src/mvu/app/model-v3.ts`
- Create: `src/mvu/app/migration-v3.ts`
- Modify: `package.json`
- Modify: `src/mvu/app/validation.ts`

**Interfaces:**
- Consumes: v2 `MvuDataset` and `normalizeMvuDataset(raw)` from `model.ts`/`validation.ts`.
- Produces: `MvuDatasetV3`, `ConditionDefinition`, `EffectGroupDefinition`, `ActiveEffectInstance`, `RuleDefinitionV3`, `migrateDatasetV2ToV3(v2, now): MigrationResult`.

`tests/helpers.mjs` exports `legacyDatasetFixture`, `conditionContextFixture`, `effectFixture`, `largeDatasetFixture`, and `createFakeFiles`. Define the shared rule contracts in this task so later engines use one exact vocabulary:

```ts
export type RuleActorSelector =
  | { kind: "any" }
  | { kind: "current_actor" }
  | { kind: "selected"; actorIds: string[] }
  | { kind: "group"; groupIds: string[] };

export type RuleTargetSelector =
  | { kind: "trigger_actor" }
  | { kind: "all_bound" }
  | { kind: "selected"; actorIds: string[] };

export type RuleActionV3 =
  | { kind: "change_field"; fieldId: string; target: RuleTargetSelector; delta: number; effectGroupIds: string[] }
  | { kind: "activate_effect_group"; effectGroupId: string };

export interface RuleDefinitionV3 {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  triggerActorSelector: RuleActorSelector;
  conditionId: string;
  actions: RuleActionV3[];
  cooldownHours: number;
  executionOrder: number;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 1: Add a Node test command and failing migration tests**

Add `"test:v3": "tsc -p tsconfig.json && node --test tests/*.test.mjs"` and make `check` run it after static audits. Write assertions that v2 remains unchanged, v3 has `formatVersion: 3`, old rule effects retain field/delta/import references, old temporary targets become field-first effects, and old conditions become reusable definitions.

```js
test("migrates v2 without mutating or overwriting it", () => {
  const v2 = legacyDatasetFixture();
  const before = structuredClone(v2);
  const result = migrateDatasetV2ToV3(v2, 2_000_000_000_000);
  assert.deepEqual(v2, before);
  assert.equal(result.dataset.formatVersion, 3);
  assert.equal(result.dataset.rules[0].conditionId, result.dataset.conditions[0].id);
  assert.equal(result.dataset.effectGroups[0].fieldEffects.length, 2);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm run typecheck; node --test tests/migration-v3.test.mjs`

Expected: FAIL because `model-v3.js` and `migration-v3.js` do not exist.

- [ ] **Step 3: Define exact v3 unions and pure migration**

Define the approved structures, including these stable discriminants:

```ts
export type EffectActorSelector =
  | { kind: "all_bound" }
  | { kind: "trigger_actor" }
  | { kind: "selected"; actorIds: string[] };

export type EffectOperation =
  | { kind: "immediate_delta"; value: number }
  | { kind: "fixed_adjustment"; value: number; sources: ChangeSource[] }
  | { kind: "positive_multiplier"; value: number; sources: ChangeSource[] }
  | { kind: "negative_multiplier"; value: number; sources: ChangeSource[] }
  | { kind: "all_multiplier"; value: number; sources: ChangeSource[] };

export interface MigrationResult {
  dataset: MvuDatasetV3;
  report: { migratedFields: number; migratedRules: number; migratedConditions: number; migratedEffectGroups: number; warnings: string[] };
}
```

Map each legacy condition to one generated `ConditionDefinition`, each auto rule to `RuleDefinitionV3`, and each legacy effect to a named effect group plus an active instance when it was enabled. Use deterministic IDs derived from legacy IDs so retrying migration is idempotent.

- [ ] **Step 4: Run migration and type tests GREEN**

Run: `pnpm run typecheck; node --test tests/migration-v3.test.mjs`

Expected: PASS with no mutation of the v2 fixture.

- [ ] **Step 5: Commit the domain boundary**

```powershell
git add package.json src/mvu/app/model-v3.ts src/mvu/app/migration-v3.ts src/mvu/app/validation.ts tests/helpers.mjs tests/migration-v3.test.mjs
git commit -m "feat: add MVU v3 domain and migration"
```

### Task 2: Build the complete reusable condition library

**Files:**
- Create: `tests/condition-engine.test.mjs`
- Create: `src/mvu/app/condition-engine.ts`
- Modify: `src/mvu/app/model-v3.ts`
- Modify: `src/mvu/app/seed.ts`
- Modify: `src/mvu/app/validation.ts`

**Interfaces:**
- Consumes: `ConditionDefinition`, `ConditionExpression`, message facts, field values, trigger actor context.
- Produces: `evaluateCondition(expression, context): ConditionEvaluation`, `collectAiPredicates(expression): AiSemanticPredicate[]`, `buildDefaultConditionLibrary(now): ConditionDefinition[]`.

- [ ] **Step 1: Write failing tests for expressions and every predicate family**

Cover nested AND/OR/NOT; field comparison; count windows; include/exclude keywords; sender/actor/group; inactivity; concrete/repeating dates; AI semantic confidence; disabled conditions; and high-frequency hourly buckets.

```js
test("filters actor before evaluating an AI predicate", () => {
  const result = evaluateCondition(actorAndAiExpression("actor_t"), contextFor("actor_u"));
  assert.equal(result.matched, false);
  assert.deepEqual(result.pendingAiPredicateIds, []);
});
```

- [ ] **Step 2: Run condition tests RED**

Run: `pnpm run typecheck; node --test tests/condition-engine.test.mjs`

Expected: FAIL because the evaluator is missing.

- [ ] **Step 3: Implement recursive deterministic evaluation and AI collection**

Return both a boolean result and unresolved AI IDs so the caller can batch only predicates that survive deterministic actor filtering. Validate recursion depth at 12, reject empty AND/OR children, cap keyword entries at 100, and require AI confidence in `[0, 1]`.

```ts
export interface ConditionEvaluation {
  matched: boolean;
  pendingAiPredicateIds: string[];
  diagnostics: string[];
}
```

Seed editable condition definitions corresponding to the legacy presets. Do not auto-reseed deleted presets; expose `buildDefaultConditionLibrary` only for explicit restore.

- [ ] **Step 4: Run condition tests GREEN**

Run: `pnpm run typecheck; node --test tests/condition-engine.test.mjs`

Expected: PASS for all deterministic, AI collection, and high-frequency cases.

- [ ] **Step 5: Commit the condition library**

```powershell
git add src/mvu/app/model-v3.ts src/mvu/app/condition-engine.ts src/mvu/app/seed.ts src/mvu/app/validation.ts tests/condition-engine.test.mjs
git commit -m "feat: add reusable condition library"
```

### Task 3: Implement field-first effect groups and actor-aware calculations

**Files:**
- Create: `tests/effect-engine.test.mjs`
- Create: `src/mvu/app/effect-engine.ts`
- Modify: `src/mvu/app/temporary-effect.ts`
- Modify: `src/mvu/app/validation.ts`
- Modify: `src/mvu/app/mvu-bridge.ts`

**Interfaces:**
- Consumes: effect definitions/instances, trigger actor, field bindings, source delta.
- Produces: `activateEffectGroup(input): EffectActivationResult`, `applyActiveEffects(input): AppliedFieldDelta`, `resolveEffectReason(input): EffectReasonSnapshot`.

- [ ] **Step 1: Write failing actor-isolation and operation-order tests**

```js
test("T event changes only T and preserves U and V", () => {
  const activation = activateEffectGroup(tDesireFixture());
  assert.deepEqual(activation.immediateChanges, [{ actorId: "T", fieldId: "A", delta: -30 }]);
  assert.equal(applyFor("T", 10, activation.instances).effectiveDelta, 5);
  assert.equal(applyFor("U", 10, activation.instances).effectiveDelta, 10);
  assert.equal(applyFor("V", 10, activation.instances).effectiveDelta, 10);
});
```

Also assert fixed adjustment precedes directional/general multipliers, negative changes use only the negative multiplier, source filters exclude unrelated sources, then step/min/max normalize last.

- [ ] **Step 2: Run effect tests RED**

Run: `pnpm run typecheck; node --test tests/effect-engine.test.mjs`

Expected: FAIL because the v3 effect engine is missing.

- [ ] **Step 3: Implement activation, targeting, reason snapshots, and calculation**

Resolve `all_bound`, `selected`, and `trigger_actor` into exact scope keys during activation. Return `MVU_EFFECT_TRIGGER_ACTOR_MISSING` diagnostics and no targets when a dynamic actor is absent. Support default reason templates and custom text with safe visual variables; persist the fully rendered reason snapshot.

- [ ] **Step 4: Run effect tests and legacy regression GREEN**

Run: `pnpm run typecheck; node --test tests/effect-engine.test.mjs; node scripts/audit-temporary-effects.mjs`

Expected: new tests pass; update the legacy audit fixture to assert compatibility through v3 migration.

- [ ] **Step 5: Commit the effect engine**

```powershell
git add src/mvu/app/effect-engine.ts src/mvu/app/temporary-effect.ts src/mvu/app/validation.ts src/mvu/app/mvu-bridge.ts tests/effect-engine.test.mjs scripts/audit-temporary-effects.mjs
git commit -m "feat: add actor-aware effect groups"
```

### Task 4: Integrate actor-bound rules and batched AI predicates

**Files:**
- Create: `tests/rule-engine-v3.test.mjs`
- Create: `src/mvu/app/rule-engine-v3.ts`
- Modify: `src/mvu/app/automation.ts`
- Modify: `src/mvu/app/service.ts`
- Modify: `src/mvu/app/system-model.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `RuleDefinitionV3`, `ConditionDefinition`, event actor, batched AI answers, effect engine.
- Produces: `planRuleEvaluation(input): RuleEvaluationPlan`, `executeRulePlan(input): RuleExecutionResult`, role-aware `judgeConditions(request)`.

- [ ] **Step 1: Write failing tests for actor binding and action separation**

Test any/current/selected/group trigger selectors; verify nonmatching actors produce no AI predicates; verify `change_field` and `activate_effect_group` actions remain results and never contain trigger-condition data; verify all AI predicates from one event produce one model call.

- [ ] **Step 2: Run rule tests RED**

Run: `pnpm run typecheck; node --test tests/rule-engine-v3.test.mjs`

Expected: FAIL because v3 rule planning is missing.

- [ ] **Step 3: Implement two-phase evaluation**

Phase one filters actors and evaluates deterministic expression branches. Phase two sends surviving AI predicates in one strict JSON request carrying `{ role, actorId, actorName, content }`, merges answers by predicate ID, then executes ordered actions. AI failure resolves only AI predicates as false.

- [ ] **Step 4: Route message processing through v3 rule/effect execution**

Update `MvuService.processPersistedMessage` so direct field changes use the effect pipeline and effect-group actions activate instances with the current event actor. Cap `processedMessageIds` at 2048, message facts at 50, and maintain independent hourly frequency buckets.

- [ ] **Step 5: Run rule, effect, and full checks GREEN**

Run: `pnpm run typecheck; node --test tests/rule-engine-v3.test.mjs tests/effect-engine.test.mjs`

Expected: PASS with one AI request and exact T-only behavior.

- [ ] **Step 6: Commit rule integration**

```powershell
git add src/mvu/app/rule-engine-v3.ts src/mvu/app/automation.ts src/mvu/app/service.ts src/mvu/app/system-model.ts src/main.ts tests/rule-engine-v3.test.mjs
git commit -m "feat: add actor-bound v3 rule execution"
```

### Task 5: Add committed record segments and safe v3 startup migration

**Files:**
- Create: `tests/record-store.test.mjs`
- Create: `src/mvu/app/record-store.ts`
- Create: `src/mvu/app/store-v3.ts`
- Modify: `src/mvu/app/store.ts`
- Modify: `src/mvu/app/index.ts`
- Modify: `src/mvu/app/service.ts`

**Interfaces:**
- Consumes: `MvuFileApi`, v2 store, migration converter, v3 config and records.
- Produces: `V3MvuStore`, `SegmentedRecordStore`, `MigrationStatus`, `queryRecords(request)`.

- [ ] **Step 1: Write failing fake-files tests**

Use a Map-backed adapter that supports whole read, line-part read, append, move, delete, and mkdir. Test 500-record rotation, committed line visibility, orphan-tail trimming, CAS conflict, v2 preservation, successful switch, and failed migration fallback.

- [ ] **Step 2: Run storage tests RED**

Run: `pnpm run typecheck; node --test tests/record-store.test.mjs`

Expected: FAIL because v3 stores do not exist.

- [ ] **Step 3: Expand `MvuFileApi` and implement segmented records**

Add these exact methods:

```ts
readTextPart(path: string, startLine: number, endLine: number): Promise<string>;
appendText(path: string, content: string): Promise<void>;
deleteFile(path: string): Promise<void>;
```

Write records first at `revision + 1`, atomically move the config temp file second, and expose only segment `committedLineCount` from the committed dataset.

- [ ] **Step 4: Implement startup migration and compatibility status**

On startup, prefer valid v3. If absent and v2 exists, build v3 in new paths, validate counts and references, then commit. On failure retain v2-backed operation and expose `{ mode: "v2_compat", error }` for the advanced page.

- [ ] **Step 5: Run storage tests GREEN**

Run: `pnpm run typecheck; node --test tests/record-store.test.mjs tests/migration-v3.test.mjs`

Expected: PASS, including simulated interrupted append and migration retry.

- [ ] **Step 6: Commit persistence**

```powershell
git add src/mvu/app/record-store.ts src/mvu/app/store-v3.ts src/mvu/app/store.ts src/mvu/app/index.ts src/mvu/app/service.ts tests/record-store.test.mjs tests/helpers.mjs
git commit -m "feat: add crash-safe v3 persistence"
```

### Task 6: Add bounded query services and typed IPC

**Files:**
- Create: `tests/query.test.mjs`
- Create: `src/mvu/app/query.ts`
- Modify: `src/mvu/app/index.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/ui/web_container/index.ui.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: v3 store, actor directory, host group snapshot.
- Produces: `QueryRequest`, `QueryResponse<T>`, all eight approved query methods, mutation methods for conditions/effect groups/rules, and compact `MvuPageSnapshot`.

- [ ] **Step 1: Write failing large-query tests**

Generate 500 fields, 200 actors/groups, 1000 rules and 100,000 record metadata entries. Assert normalized search, stable tie-breaking by ID, no duplicate/skip between pages, exact totals, fields/rules page size 5, records 10, conditions/effects 10, and picker cursor batches no greater than 30.

- [ ] **Step 2: Run query tests RED**

Run: `pnpm run typecheck; node --test tests/query.test.mjs`

Expected: FAIL because query APIs do not exist.

- [ ] **Step 3: Implement pure query policy and backend endpoints**

Define:

```ts
export interface QueryRequest {
  search?: string;
  filters?: Record<string, string | boolean | number>;
  sort?: { key: string; direction: "asc" | "desc" };
  page?: number;
  cursor?: string;
}

export interface QueryResponse<T> {
  items: T[];
  loadedCount: number;
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
}
```

Reject management page sizes other than the server-owned policy. Picker queries accept a stable cursor and silently fetch more on scroll. Snapshot returns context, counts, selected summaries, migration status, and the first required page only.

- [ ] **Step 4: Add strict request parsers, WebView dispatch, and CRUD IPC**

Add query methods and condition/effect/rule create-update-copy-toggle-delete/reference methods to `MVU_IPC`, `MVU_REQUEST_PARSERS`, client, runtime dispatch, and `NativeMvu` bridge. Parse exact allowed keys and reject unknown or oversized query strings.

- [ ] **Step 5: Run query and bridge audits GREEN**

Run: `pnpm run typecheck; node --test tests/query.test.mjs; node scripts/audit-web-ui.mjs`

Expected: all UI-referenced native methods have bridge cases and all query tests pass.

- [ ] **Step 6: Commit query IPC**

```powershell
git add src/mvu/app/query.ts src/mvu/app/index.ts src/shared/ipc.ts src/ui/web_container/index.ui.ts src/main.ts tests/query.test.mjs scripts/audit-web-ui.mjs
git commit -m "feat: add bounded v3 query IPC"
```

### Task 7: Replace the page shell with four-section navigation and safe layout

**Files:**
- Create: `static/app_ui/runtime.js`
- Create: `static/app_ui/components.js`
- Create: `static/app_ui/pages-status.js`
- Create: `static/app_ui/pages-config.js`
- Create: `static/app_ui/pages-rules.js`
- Create: `static/app_ui/pages-advanced.js`
- Modify: `static/app_ui/app.js`
- Modify: `static/app_ui/index.html`
- Modify: `static/app_ui/styles.css`
- Modify: `scripts/build-web.mjs`
- Create: `scripts/audit-v3-ui.mjs`
- Modify: `scripts/audit-web-ui.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: compact snapshot and query IPC from Task 6.
- Produces: `window.MvuUi` modules, four root routes, shared top bar/bottom nav/pagination/picker, and normal-flow page layout.

- [ ] **Step 1: Use the impeccable workflow before UI edits**

Run its context command once, load its craft-floor reference and the reference matching mobile app information architecture. Record the resulting UI constraints in comments at the top of `scripts/audit-v3-ui.mjs`; do not add a separate design page.

- [ ] **Step 2: Write a failing static UI audit**

Assert exactly four bottom items (`状态/配置/规则/高级`), menu icons only on root pages, unframed back arrows on child pages, appearance absent from the drawer, no absolute positioning on `.bottom-nav` or `.bottom-action`, module script order, view transitions, and reduced-motion CSS.

Assert trend canvases receive the field minimum, maximum, stage thresholds, and stage colors used by the stage strip. The drawing code must not derive an independent Y range from recent samples.

Update the existing `audit-web-ui.mjs` assertions that encode the old five-item navigation and monolithic function boundaries. Keep its accessibility, bridge-action, field-range, effect-import, reason, and transition guarantees. Add `audit:v3` to `package.json` and make `audit` run both audit scripts.

- [ ] **Step 3: Run UI audit RED**

Run: `node scripts/audit-v3-ui.mjs`

Expected: FAIL on the current five-item nav and absolute bottom layout.

- [ ] **Step 4: Split the frontend and implement the new shell**

Expose a single namespace rather than globals:

```js
window.MvuUi = {
  state,
  native,
  components: {},
  pages: {},
  navigate,
  render,
};
```

Inline scripts in dependency order through `build-web.mjs`. Use an app-screen grid with rows `auto minmax(0, 1fr) auto auto`; keep actions and nav in normal flow. Preserve browser history and restore child routes to their owning root.

Render trend Y positions from `(value - field.minimum) / (field.maximum - field.minimum)`, draw lightweight stage bands or threshold lines from the same thresholds used by the stage strip, and reuse stage colors. Improve small-delta readability through points/current-value labels, never through independent Y-axis autoscaling.

- [ ] **Step 5: Run UI audit and build GREEN**

Run: `node scripts/audit-v3-ui.mjs; pnpm run build:web`

Expected: four roots, no overlap-prone absolute bottom elements, and one self-contained `dist/app.html`.

- [ ] **Step 6: Commit the UI foundation**

```powershell
git add static/app_ui scripts/build-web.mjs scripts/audit-v3-ui.mjs scripts/audit-web-ui.mjs package.json
git commit -m "feat: rebuild MVU four-section UI shell"
```

### Task 8: Implement searchable pickers, pagination, and compact management lists

**Files:**
- Modify: `static/app_ui/runtime.js`
- Modify: `static/app_ui/components.js`
- Modify: `static/app_ui/pages-status.js`
- Modify: `static/app_ui/pages-config.js`
- Modify: `static/app_ui/pages-rules.js`
- Modify: `static/app_ui/styles.css`
- Modify: `scripts/audit-v3-ui.mjs`

**Interfaces:**
- Consumes: `queryFields/queryActors/queryGroups/queryRules/queryConditions/queryEffectGroups/queryRecords`.
- Produces: `openEntityPicker(config)`, `renderPagination(page)`, compact field/rule rows, visible result counts.

- [ ] **Step 1: Extend the audit with failing list-density and picker assertions**

Assert fields/rules use page size 5, records 10, conditions/effects 10; all field selectors call `openEntityPicker({ entity: "fields" })`; no `<select>` is populated by all fields; no `加载更多` copy or action exists; counts use `本页`/`匹配` and total.

- [ ] **Step 2: Run the focused audit RED**

Run: `node scripts/audit-v3-ui.mjs`

Expected: FAIL until every large selector and list is routed through queries.

- [ ] **Step 3: Implement the searchable dialog and virtual result window**

Keep selected entities pinned, debounce search by 180 ms, discard stale responses by request token, automatically fetch the next cursor near the scroll boundary, and preserve selected IDs when a query fails. Provide single and multiple selection modes with explicit confirm only for multi-select.

- [ ] **Step 4: Implement compact list rows and server-owned pagination**

Field rows show scope, binding name, value/range, status, `查看`, and `修改`. Rule rows show name, enabled state, bound actor summary, condition summary, and action summary. Do not reduce text size; reduce card padding and decorative whitespace.

- [ ] **Step 5: Run audits and browser smoke build GREEN**

Run: `node scripts/audit-v3-ui.mjs; pnpm run build:web`

Expected: all large-field entry assertions pass and the generated HTML contains no `加载更多`.

- [ ] **Step 6: Commit large-data UI behavior**

```powershell
git add static/app_ui/runtime.js static/app_ui/components.js static/app_ui/pages-status.js static/app_ui/pages-config.js static/app_ui/pages-rules.js static/app_ui/styles.css scripts/audit-v3-ui.mjs
git commit -m "feat: add searchable paged MVU lists"
```

### Task 9: Complete field scopes, condition CRUD, rule binding, and effect-group editors

**Files:**
- Modify: `static/app_ui/pages-config.js`
- Modify: `static/app_ui/pages-rules.js`
- Modify: `static/app_ui/pages-advanced.js`
- Modify: `static/app_ui/components.js`
- Modify: `static/app_ui/styles.css`
- Modify: `scripts/audit-v3-ui.mjs`
- Modify: `src/shared/ipc.ts`

**Interfaces:**
- Consumes: CRUD/query IPC and searchable picker.
- Produces: complete visual editors matching the v3 contracts.

- [ ] **Step 1: Add failing audit cases for every approved editor behavior**

Assert current-session auto-bind and collapsed advanced binding; readable group/chat labels; condition create/copy/edit/toggle/delete/reference actions; nested AND/OR/NOT controls; AI type/requirement/confidence fields; rule actor binding; field-first effect rows; actor selector default `all_bound`; multiple operations; visible default/custom reason mode and preview; repair badges for missing references.

- [ ] **Step 2: Run UI audit RED**

Run: `node scripts/audit-v3-ui.mjs`

Expected: FAIL on missing v3 editors.

- [ ] **Step 3: Implement field scope and visual hierarchy**

Selecting current session immediately binds the open chat and displays its title. Keep multi-chat management inside a collapsed `<details>`. Use the same section-heading component for basic info, scope, appearance, and detailed configuration; keep role/group IDs secondary.

- [ ] **Step 4: Implement condition and rule editors**

Render recursive expression groups as nested cards with direct add-condition/add-group actions. Show affected rule references before shared edits/deletes. Put trigger actor binding before condition selection, then render actions separately under `触发后改变的字段内容`.

- [ ] **Step 5: Implement effect-group editor**

Require name, render each target field as a parent card, default actor selection to all bound actors, support trigger actor and explicit actor search, add multiple operations per field, and keep default/custom reason controls directly visible with a rendered preview.

- [ ] **Step 6: Run UI and TypeScript checks GREEN**

Run: `node scripts/audit-v3-ui.mjs; pnpm run typecheck; pnpm run build:web`

Expected: all approved editor interactions are represented and all IPC payloads typecheck.

- [ ] **Step 7: Commit complete editors**

```powershell
git add static/app_ui/pages-config.js static/app_ui/pages-rules.js static/app_ui/pages-advanced.js static/app_ui/components.js static/app_ui/styles.css scripts/audit-v3-ui.mjs src/shared/ipc.ts
git commit -m "feat: complete MVU v3 visual editors"
```

### Task 10: Bound model input and finish migration/diagnostic UI

**Files:**
- Modify: `src/mvu/app/state-prompt.ts`
- Modify: `src/mvu/app/system-model.ts`
- Modify: `src/mvu/app/service.ts`
- Modify: `static/app_ui/pages-advanced.js`
- Modify: `static/app_ui/pages-rules.js`
- Create: `tests/model-budget.test.mjs`

**Interfaces:**
- Consumes: referenced field IDs, field visibility priority, recent changes, migration status and diagnostics.
- Produces: `selectModelFields(input): ModelFieldSelection`, UI `本轮使用 X / 共 Y 个字段`, restore/export/repair actions.

- [ ] **Step 1: Write failing model-budget tests**

Assert every rule-referenced field is retained, high-priority fields precede recency supplements, hidden fields are excluded unless directly required, and the returned count reports used/total.

- [ ] **Step 2: Run model-budget tests RED**

Run: `pnpm run typecheck; node --test tests/model-budget.test.mjs`

Expected: FAIL because selection is currently unbounded.

- [ ] **Step 3: Implement deterministic field budgeting**

Add `selectModelFields({ fields, referencedFieldIds, recentChangeIds, maxFields: 40 })`. Send role and actor metadata with every current message. Expose counts to rules/advanced pages.

- [ ] **Step 4: Complete advanced data operations**

Show current data mode, v2 migration error/retry, v3 export/import, explicit restore-default-conditions preview, missing-reference repair list, and diagnostic record filtering. Keep appearance and import/export as the primary advanced groups; migration/diagnostics live under collapsed system maintenance.

- [ ] **Step 5: Run model and full tests GREEN**

Run: `pnpm run typecheck; node --test tests/model-budget.test.mjs; pnpm run check`

Expected: all tests and audits pass.

- [ ] **Step 6: Commit bounded AI and diagnostics**

```powershell
git add src/mvu/app/state-prompt.ts src/mvu/app/system-model.ts src/mvu/app/service.ts static/app_ui/pages-advanced.js static/app_ui/pages-rules.js tests/model-budget.test.mjs
git commit -m "feat: bound MVU model input and diagnostics"
```

### Task 11: Version, documentation, package verification, and modified-APK acceptance

**Files:**
- Create: `scripts/audit-v3-package.mjs`
- Modify: `package.json`
- Modify: `manifest.json`
- Modify: `README.md`
- Modify: `docs/MVU_API.md`
- Modify: `docs/MVU_PORT.md`
- Modify: `docs/HOST_INTERFACE_REQUIREMENTS.md`
- Modify: `docs/OPERITAI_CHANGES.md`

**Interfaces:**
- Consumes: complete v3 implementation and modified OperitAI APK.
- Produces: verified `release/operit_mvu-3.0.0.toolpkg`, QA evidence, source commit, GitHub release.

- [ ] **Step 1: Write a failing package audit**

Assert package/manifest/docs version `3.0.0`, dataset docs state v3 plus v2 migration, release name is exact, archive excludes tests/QA/artifacts, and archive contains one root `app.html` plus runtime files.

- [ ] **Step 2: Run package audit RED**

Run: `node scripts/audit-v3-package.mjs`

Expected: FAIL while version remains 2.0.1.

- [ ] **Step 3: Update version and user-facing documentation**

Replace versioned artifact references with `operit_mvu-3.0.0.toolpkg`. Document condition library, actor-bound rules, effect groups, page sizes, searchable pickers, v2 migration, v3 export, and recovery behavior.

- [ ] **Step 4: Run complete verification and package**

Run: `pnpm run check; pnpm run pack; node scripts/audit-v3-package.mjs`

Expected: PASS and a new `release/operit_mvu-3.0.0.toolpkg`.

- [ ] **Step 5: Perform visual verification**

Build the local app and inspect 320/360/393/430 widths plus 130% text sizing. Capture bounded evidence for four-nav routing, unframed back arrows, no bottom overlap, 5/5/10 pagination, picker search/counts, condition CRUD, effect-group actor controls, and identical relative value placement between the stage strip and trend chart.

- [ ] **Step 6: Test in the modified OperitAI APK**

Locate the APK with `rg --files OperitAI -g '*.apk'`, install/update it with ADB, import the 3.0.0 ToolPkg, then exercise the eight integration scenarios in the spec. Record commands, package hashes, device identity, and observed results without modifying the OperitAI worktree.

- [ ] **Step 7: Request code review and fix findings**

Use `superpowers:requesting-code-review`, review all changes from `ba3086d` to HEAD, address every confirmed issue with focused tests, and rerun the complete verification suite.

- [ ] **Step 8: Commit release metadata**

```powershell
git add package.json manifest.json README.md docs scripts/audit-v3-package.mjs
git commit -m "release: prepare Operit MVU 3.0.0"
```

- [ ] **Step 9: Push and publish only the verified commit**

Push the implementation branch, merge according to the repository’s existing release workflow, create tag `v3.0.0`, and publish `release/operit_mvu-3.0.0.toolpkg` as the GitHub release asset. Verify the remote tag commit and uploaded asset SHA-256 match local values.
