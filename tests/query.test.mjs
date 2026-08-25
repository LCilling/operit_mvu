import assert from "node:assert/strict";
import test from "node:test";

import {
  MvuQueryService,
  QUERY_SEARCH_MAX_LENGTH,
} from "../dist/mvu/app/query.js";
import {
  createEmptyRecordManifest,
  SegmentedRecordStore,
} from "../dist/mvu/app/record-store.js";
import { MVU_IPC, MVU_REQUEST_PARSERS, mvuIpcClient } from "../dist/shared/ipc.js";
import { createFakeMvuFileApi, legacyDatasetFixture } from "./helpers.mjs";
import { migrateDatasetV2ToV3 } from "../dist/mvu/app/migration-v3.js";

const NOW = Date.parse("2033-05-18T03:33:20.000Z");
const CONFIG_DIR = "/config";
const RECORD_DIRECTORY = `${CONFIG_DIR}/operit_mvu.records.v3`;

function field(index, name = `Field ${String(index).padStart(4, "0")}`) {
  const base = legacyDatasetFixture().fields[0];
  return {
    ...structuredClone(base),
    id: `field_${String(index).padStart(4, "0")}`,
    name,
    order: index % 7,
  };
}

function condition(index, name = `Condition ${String(index).padStart(4, "0")}`) {
  return {
    id: `condition_${String(index).padStart(4, "0")}`,
    name,
    description: `${name} description`,
    enabled: index % 2 === 0,
    expression: { kind: "predicate", predicate: { kind: "user_care" } },
    createdAt: new Date(NOW + index).toISOString(),
    updatedAt: new Date(NOW + index).toISOString(),
  };
}

function effectGroup(index, name = `Effect ${String(index).padStart(4, "0")}`) {
  return {
    id: `effect_${String(index).padStart(4, "0")}`,
    name,
    description: `${name} description`,
    enabled: index % 2 === 0,
    fieldEffects: [{
      id: `field_effect_${index}`,
      fieldId: "field_0000",
      actorSelector: { kind: "all_bound" },
      operations: [{ kind: "immediate_delta", value: 1 }],
    }],
    createdAt: new Date(NOW + index).toISOString(),
    updatedAt: new Date(NOW + index).toISOString(),
  };
}

function rule(index, name = `Rule ${String(index).padStart(4, "0")}`) {
  return {
    id: `rule_${String(index).padStart(4, "0")}`,
    name,
    description: `${name} description`,
    enabled: index % 2 === 0,
    triggerActorSelector: { kind: "any" },
    conditionId: "condition_0000",
    actions: [{
      kind: "change_field",
      fieldId: "field_0000",
      target: { kind: "all_bound" },
      delta: 1,
      effectGroupIds: [],
    }],
    cooldownHours: 0,
    executionOrder: index % 11,
    createdAt: new Date(NOW + index).toISOString(),
    updatedAt: new Date(NOW + index).toISOString(),
  };
}

function record(index) {
  return {
    id: `record_${index}`,
    scope: "character",
    scopeKey: "character:actor_000",
    fieldId: "field_0000",
    fieldName: "Field 0000",
    actorId: "actor_000",
    actorName: "Actor 000",
    chatId: "chat_main",
    groupId: "group_000",
    before: index,
    after: index + 1,
    requestedDelta: 1,
    effectiveRequestedDelta: 1,
    delta: 1,
    stageBefore: "low",
    stageAfter: "low",
    reason: "large record fixture",
    source: "rule",
    ruleIds: [],
    effectIds: [],
    confidence: null,
    messageId: `message_${index}`,
    variantId: null,
    occurredAt: NOW + index,
  };
}

function recordManifest(recordCount = 100_000) {
  const segments = [];
  for (let index = 0; index < recordCount / 500; index += 1) {
    segments.push({
      index: index + 1,
      fileName: `segment-${String(index + 1).padStart(6, "0")}.jsonl`,
      committedLineCount: 500,
      firstOccurredAt: NOW + index * 500,
      lastOccurredAt: NOW + index * 500 + 499,
      firstRevision: index + 1,
      lastRevision: index + 1,
    });
  }
  return { segments, recordCount, nextSegmentIndex: segments.length + 1 };
}

function makeDataset() {
  const migrated = migrateDatasetV2ToV3(legacyDatasetFixture(), NOW).dataset;
  migrated.fields = Array.from({ length: 500 }, (_, index) => field(index));
  migrated.conditions = Array.from({ length: 24 }, (_, index) => condition(index));
  migrated.effectGroups = Array.from({ length: 24 }, (_, index) => effectGroup(index));
  migrated.rules = Array.from({ length: 1_000 }, (_, index) => rule(index));
  migrated.recordManifest = recordManifest();
  return migrated;
}

function makeActors() {
  return Array.from({ length: 200 }, (_, index) => ({
    characterId: `actor_${String(index).padStart(3, "0")}`,
    name: index === 17 ? "ＡＣＴＯＲ   １７" : `Actor ${String(index).padStart(3, "0")}`,
    enabled: index % 2 === 0,
  }));
}

function makeGroups() {
  return Array.from({ length: 200 }, (_, index) => ({
    characterGroupId: `group_${String(index).padStart(3, "0")}`,
    name: `Group ${String(index).padStart(3, "0")}`,
    avatarUri: null,
  }));
}

function createSource(dataset, overrides = {}) {
  let current = structuredClone(dataset);
  const actors = makeActors();
  const groups = makeGroups();
  let idSequence = 0;
  return {
    source: {
      async readV3() {
        return { revision: current.revision, dataset: structuredClone(current) };
      },
      async transactV3(expectedRevision, next) {
        assert.equal(expectedRevision, current.revision);
        current = structuredClone(next);
        current.revision = expectedRevision + 1;
        return { revision: current.revision, dataset: structuredClone(current) };
      },
      async queryCommittedRecords(request) {
        return overrides.queryCommittedRecords(request);
      },
      async listActors() {
        return structuredClone(actors);
      },
      async listGroups() {
        return structuredClone(groups);
      },
      async activeContext() {
        return {
          chatId: "chat_main",
          actorId: "actor_000",
          groupId: "group_000",
          actorName: "Actor 000",
        };
      },
      async migrationStatus() {
        return { mode: "v3", migrated: false, cleanupPending: null };
      },
    },
    options: {
      now: () => NOW,
      createId(prefix) {
        idSequence += 1;
        return `${prefix}_created_${idSequence}`;
      },
    },
    current: () => structuredClone(current),
  };
}

function assertExactResponse(response, expected) {
  assert.deepEqual(Object.keys(response).sort(), [
    "hasMore", "items", "loadedCount", "nextCursor", "totalCount",
  ]);
  assert.equal(response.loadedCount, response.items.length);
  assert.equal(response.totalCount, expected.totalCount);
  assert.equal(response.hasMore, expected.hasMore);
}

test("management queries own exact page sizes and stable ID tie-breaking", async () => {
  const dataset = makeDataset();
  dataset.fields[20].name = "Same";
  dataset.fields[21].name = "Same";
  dataset.fields[20].order = 0;
  dataset.fields[21].order = 0;
  dataset.rules[20].name = "Same";
  dataset.rules[21].name = "Same";
  dataset.rules[20].executionOrder = 0;
  dataset.rules[21].executionOrder = 0;
  const fixture = createSource(dataset, {
    queryCommittedRecords: async () => ({ items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null }),
  });
  const service = new MvuQueryService(fixture.source, fixture.options);

  const fieldPage1 = await service.queryFields({ page: 1, sort: { key: "order", direction: "asc" } });
  const fieldPage2 = await service.queryFields({ page: 2, sort: { key: "order", direction: "asc" } });
  assertExactResponse(fieldPage1, { totalCount: 500, hasMore: true });
  assert.equal(fieldPage1.items.length, 5);
  assert.equal(fieldPage2.items.length, 5);
  assert.equal(new Set([...fieldPage1.items, ...fieldPage2.items].map((item) => item.id)).size, 10);
  const sameFields = (await service.queryFields({ search: "same", page: 1, sort: { key: "order", direction: "asc" } })).items;
  assert.deepEqual(sameFields.map((item) => item.id), ["field_0020", "field_0021"]);

  const rulePage = await service.queryRules({ page: 1 });
  const conditionPage = await service.queryConditions({ page: 1 });
  const effectPage = await service.queryEffectGroups({ page: 1 });
  assert.equal(rulePage.items.length, 5);
  assert.equal(rulePage.totalCount, 1_000);
  assert.equal(conditionPage.items.length, 10);
  assert.equal(effectPage.items.length, 10);
  assert.equal(rulePage.nextCursor, null);
  assert.equal(conditionPage.nextCursor, null);
});

test("actor group and field pickers normalize Unicode case and whitespace with stable cursors", async () => {
  const fixture = createSource(makeDataset(), {
    queryCommittedRecords: async () => ({ items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null }),
  });
  const service = new MvuQueryService(fixture.source, fixture.options);

  const normalized = await service.queryActors({ search: "  actor 17  " });
  assert.ok(normalized.totalCount > 0);
  assert.ok(normalized.items.some((item) => item.characterId === "actor_017"));

  for (const query of [
    (request) => service.queryActors(request),
    (request) => service.queryGroups(request),
    (request) => service.queryFields({ ...request, filters: { mode: "picker" } }),
  ]) {
    const ids = [];
    let cursor;
    let final;
    do {
      final = await query(cursor === undefined ? {} : { cursor });
      assert.ok(final.loadedCount <= 30);
      ids.push(...final.items.map((item) => item.id ?? item.characterId ?? item.characterGroupId));
      cursor = final.nextCursor ?? undefined;
    } while (cursor !== undefined);
    assert.equal(ids.length, final.totalCount);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(final.hasMore, false);
    assert.equal(final.nextCursor, null);
  }
});

test("100,000-record paging reads only the needed committed line range", async () => {
  const manifest = recordManifest();
  const last = manifest.segments.at(-1);
  const lines = Array.from({ length: 500 }, (_, offset) => {
    const index = 99_500 + offset;
    return JSON.stringify({ commitRevision: last.lastRevision, record: record(index) });
  }).join("\n") + "\n";
  const files = createFakeMvuFileApi({
    [`${RECORD_DIRECTORY}/${last.fileName}`]: lines,
  });
  const recordStore = new SegmentedRecordStore({ getConfigDir: () => CONFIG_DIR, files });
  const fixture = createSource(makeDataset(), {
    queryCommittedRecords: (request) => recordStore.queryRecords(manifest, request),
  });
  const service = new MvuQueryService(fixture.source, fixture.options);

  const page = await service.queryRecords({ page: 1 });
  assertExactResponse(page, { totalCount: 100_000, hasMore: true });
  assert.equal(page.items.length, 10);
  assert.deepEqual(page.items.map((item) => item.id), [
    "record_99999", "record_99998", "record_99997", "record_99996", "record_99995",
    "record_99994", "record_99993", "record_99992", "record_99991", "record_99990",
  ]);
  const reads = files.operations().filter((operation) => operation.operation.startsWith("readText"));
  assert.deepEqual(reads, [{
    operation: "readTextPart",
    path: `${RECORD_DIRECTORY}/${last.fileName}`,
    startLine: 491,
    endLine: 500,
  }]);
});

test("query parsers reject unknown oversized and unsafe query input", () => {
  assert.deepEqual(MVU_REQUEST_PARSERS.queryFields({ page: 1 }), { page: 1 });
  assert.throws(
    () => MVU_REQUEST_PARSERS.queryFields({ page: 1, pageSize: 500 }),
    /MVU_QUERY_REQUEST_INVALID/,
  );
  assert.throws(
    () => MVU_REQUEST_PARSERS.queryFields({ search: "x".repeat(QUERY_SEARCH_MAX_LENGTH + 1) }),
    /MVU_QUERY_SEARCH_TOO_LONG/,
  );
  assert.throws(
    () => MVU_REQUEST_PARSERS.queryFields({ sort: { key: "__proto__", direction: "asc" } }),
    /MVU_QUERY_SORT_INVALID/,
  );
  assert.throws(
    () => MVU_REQUEST_PARSERS.queryRecords({ filters: { fileName: "../../secret" } }),
    /MVU_QUERY_FILTER_INVALID/,
  );
  assert.throws(
    () => MVU_REQUEST_PARSERS.queryActors({ cursor: "x".repeat(2_049) }),
    /MVU_QUERY_CURSOR_TOO_LONG/,
  );
  assert.throws(
    () => MVU_REQUEST_PARSERS.queryFields({ filters: { scope: "filesystem" } }),
    /MVU_QUERY_FILTER_INVALID/,
  );
  assert.throws(
    () => MVU_REQUEST_PARSERS.queryActors({ filters: { enabled: "true" } }),
    /MVU_QUERY_FILTER_INVALID/,
  );
  assert.throws(
    () => MVU_REQUEST_PARSERS.createCondition({ condition: {
      name: "bounded",
      description: "x".repeat(4_097),
      enabled: true,
      expression: { kind: "predicate", predicate: { kind: "user_care" } },
    } }),
    /MVU_CONDITION_INPUT_INVALID/,
  );
  assert.throws(
    () => MVU_REQUEST_PARSERS.createRule({ rule: {
      name: "strict",
      description: "strict",
      enabled: true,
      triggerActorSelector: { kind: "any", injected: true },
      conditionId: "condition_0000",
      actions: [],
      cooldownHours: 0,
      executionOrder: 0,
    } }),
    /MVU_RULE_ACTOR_SELECTOR_INVALID/,
  );
});

test("typed IPC exposes every query and v3 condition effect-group and rule operation", () => {
  const methods = [
    "queryFields", "queryActors", "queryGroups", "queryRules", "queryConditions",
    "queryEffectGroups", "queryRecords", "getEntityById",
    "createCondition", "updateCondition", "copyCondition", "toggleCondition",
    "deleteCondition", "getConditionReferences",
    "createEffectGroup", "updateEffectGroup", "copyEffectGroup", "toggleEffectGroup",
    "deleteEffectGroup", "getEffectGroupReferences",
    "createRule", "updateRule", "copyRule", "toggleRule", "deleteRule", "getRuleReferences",
  ];
  for (const method of methods) {
    assert.equal(typeof MVU_IPC[method], "string", `${method} channel`);
    assert.equal(typeof MVU_REQUEST_PARSERS[method], "function", `${method} parser`);
    assert.equal(typeof mvuIpcClient[method], "function", `${method} client`);
  }
  assert.throws(
    () => MVU_REQUEST_PARSERS.toggleRule({ id: "rule_1", enabled: true, force: true }),
    /MVU_TOGGLE_RULE_REQUEST_INVALID/,
  );
  assert.throws(
    () => MVU_REQUEST_PARSERS.getEntityById({ entityType: "record", id: "record_1" }),
    /MVU_ENTITY_TYPE_INVALID/,
  );
});

test("compact snapshot contains summaries counts and first pages without option arrays or full history", async () => {
  const fixture = createSource(makeDataset(), {
    queryCommittedRecords: async ({ offset, limit }) => ({
      items: Array.from({ length: limit }, (_, index) => record(100_000 - 1 - offset - index)),
      loadedCount: limit,
      totalCount: 100_000,
      hasMore: offset + limit < 100_000,
      nextOffset: offset + limit,
    }),
  });
  const service = new MvuQueryService(fixture.source, fixture.options);
  const snapshot = await service.pageSnapshot();

  assert.equal(snapshot.pages.fields.items.length, 5);
  assert.equal(snapshot.pages.rules.items.length, 5);
  assert.equal(snapshot.pages.conditions.items.length, 10);
  assert.equal(snapshot.pages.effectGroups.items.length, 10);
  assert.equal(snapshot.pages.records.items.length, 10);
  assert.deepEqual(snapshot.counts, {
    fields: 500,
    actors: 200,
    groups: 200,
    rules: 1_000,
    conditions: 24,
    effectGroups: 24,
    records: 100_000,
  });
  assert.equal(snapshot.selected.actor.characterId, "actor_000");
  assert.equal(snapshot.selected.group.characterGroupId, "group_000");
  assert.equal("actors" in snapshot, false);
  assert.equal("groups" in snapshot, false);
  assert.equal("records" in snapshot, false);
});

test("entity lookup is type-scoped and cannot become a file or cross-owner accessor", async () => {
  const fixture = createSource(makeDataset(), {
    queryCommittedRecords: async () => ({ items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null }),
  });
  const service = new MvuQueryService(fixture.source, fixture.options);

  assert.equal((await service.getEntityById({ entityType: "field", id: "field_0001" })).id, "field_0001");
  assert.equal((await service.getEntityById({ entityType: "actor", id: "actor_001" })).characterId, "actor_001");
  assert.equal((await service.getEntityById({ entityType: "group", id: "group_001" })).characterGroupId, "group_001");
  await assert.rejects(
    service.getEntityById({ entityType: "file", id: "../../operit_mvu.dataset.v3.json" }),
    /MVU_ENTITY_TYPE_INVALID/,
  );
  await assert.rejects(
    service.getEntityById({ entityType: "actor", id: "../../actor_001" }),
    /MVU_ENTITY_NOT_FOUND/,
  );
});

test("condition effect-group and rule CRUD copy toggle delete and references stay canonical", async () => {
  const dataset = makeDataset();
  dataset.conditions = [condition(0)];
  dataset.effectGroups = [effectGroup(0)];
  dataset.rules = [rule(0)];
  dataset.activeEffects = [];
  const fixture = createSource(dataset, {
    queryCommittedRecords: async () => ({ items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null }),
  });
  const service = new MvuQueryService(fixture.source, fixture.options);

  assert.deepEqual((await service.getConditionReferences({ id: "condition_0000" })).map((item) => item.id), ["rule_0000"]);
  assert.deepEqual((await service.getEffectGroupReferences({ id: "effect_0000" })).map((item) => item.id), []);
  const outgoing = await service.getRuleReferences({ id: "rule_0000" });
  assert.deepEqual(outgoing.map((item) => [item.entityType, item.id]), [
    ["condition", "condition_0000"],
    ["field", "field_0000"],
  ]);

  const createdCondition = await service.createCondition({ condition: {
    name: "Created condition",
    description: "created",
    enabled: true,
    expression: { kind: "predicate", predicate: { kind: "user_care" } },
  } });
  await service.updateCondition({ id: createdCondition.id, patch: { description: "updated" } });
  await service.toggleCondition({ id: createdCondition.id, enabled: false });
  const copiedCondition = await service.copyCondition({ id: createdCondition.id });
  assert.equal(copiedCondition.enabled, false);
  await service.deleteCondition({ id: copiedCondition.id });

  const createdEffect = await service.createEffectGroup({ effectGroup: {
    name: "Created effect",
    description: "created",
    enabled: true,
    fieldEffects: [{
      id: "field_effect_created",
      fieldId: "field_0000",
      actorSelector: { kind: "all_bound" },
      operations: [{ kind: "immediate_delta", value: 1 }],
    }],
  } });
  await service.updateEffectGroup({ id: createdEffect.id, patch: { description: "updated" } });
  await service.toggleEffectGroup({ id: createdEffect.id, enabled: false });
  const copiedEffect = await service.copyEffectGroup({ id: createdEffect.id });
  await service.deleteEffectGroup({ id: copiedEffect.id });

  const createdRule = await service.createRule({ rule: {
    name: "Created rule",
    description: "created",
    enabled: true,
    triggerActorSelector: { kind: "any" },
    conditionId: createdCondition.id,
    actions: [{
      kind: "activate_effect_group",
      effectGroupId: createdEffect.id,
    }],
    cooldownHours: 0,
    executionOrder: 2,
  } });
  await service.updateRule({ id: createdRule.id, patch: { description: "updated" } });
  await service.toggleRule({ id: createdRule.id, enabled: false });
  const copiedRule = await service.copyRule({ id: createdRule.id });
  assert.deepEqual((await service.getEffectGroupReferences({ id: createdEffect.id })).map((item) => item.id).sort(), [
    copiedRule.id,
    createdRule.id,
  ].sort());
  await service.deleteRule({ id: copiedRule.id });
  await service.deleteRule({ id: createdRule.id });
  await service.deleteEffectGroup({ id: createdEffect.id });
  await service.deleteCondition({ id: createdCondition.id });

  assert.equal(fixture.current().conditions.some((item) => item.id === createdCondition.id), false);
  assert.equal(fixture.current().effectGroups.some((item) => item.id === createdEffect.id), false);
  assert.equal(fixture.current().rules.some((item) => item.id === createdRule.id), false);
});

test("query response contract remains exact for empty committed history", async () => {
  const fixture = createSource({
    ...makeDataset(),
    recordManifest: createEmptyRecordManifest(),
  }, {
    queryCommittedRecords: async () => ({ items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null }),
  });
  const response = await new MvuQueryService(fixture.source, fixture.options).queryRecords({ page: 1 });
  assert.deepEqual(response, {
    items: [],
    loadedCount: 0,
    totalCount: 0,
    hasMore: false,
    nextCursor: null,
  });
});
