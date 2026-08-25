import assert from "node:assert/strict";
import test from "node:test";

import {
  MVU_SNAPSHOT_MAX_BYTES,
  MVU_SNAPSHOT_URI_MAX_BYTES,
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

test("every field query page and field detail carry the active-context value stage binding and scope key", async () => {
  const dataset = makeDataset();
  dataset.fields = Array.from({ length: 12 }, (_, index) => ({
    ...field(index),
    order: index,
    scope: "character",
    bindingIds: ["actor_000"],
    modelVisibility: index % 2 === 0 ? "full" : "stage_only",
    stages: [
      { id: "low", name: "低", description: "低阶段", threshold: 0 },
      { id: "close", name: "接近", description: "接近阶段", threshold: 45 },
    ],
  }));
  dataset.stateValues["character:actor_000"] = Object.fromEntries(
    dataset.fields.map((item, index) => [item.id, 41 + index]),
  );
  const fixture = createSource(dataset, {
    queryCommittedRecords: async () => ({ items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null }),
  });
  const service = new MvuQueryService(fixture.source, fixture.options);

  const page2 = await service.queryFields({ page: 2, sort: { key: "order", direction: "asc" } });
  const first = page2.items[0];
  assert.equal(first.id, "field_0005");
  assert.equal(first.currentValue, 46);
  assert.equal(first.currentStage.id, "close");
  assert.equal(first.scopeKey, "character:actor_000");
  assert.equal(first.bindingDisplay, "Actor 000");

  const detail = await service.getEntityById({ entityType: "field", id: first.id });
  assert.equal(detail.currentValue, 46);
  assert.equal(detail.currentStage.id, "close");
  assert.equal(detail.scopeKey, "character:actor_000");
  assert.equal(detail.bindingDisplay, "Actor 000");

  const stageOnly = await service.queryFields({ filters: { type: "stage_only" }, page: 1 });
  assert.equal(stageOnly.totalCount, 6);
  assert.equal(stageOnly.items.every((item) => item.modelVisibility === "stage_only"), true);
  assert.deepEqual(MVU_REQUEST_PARSERS.queryFields({ filters: { type: "stage_only" } }), {
    filters: { type: "stage_only" },
  });
});

test("group membership filtering is server-owned and cursor tokens cannot be reused", async () => {
  const fixture = createSource(makeDataset(), {
    queryCommittedRecords: async () => ({ items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null }),
  });
  const service = new MvuQueryService({
    ...fixture.source,
    async listActorsForGroup(groupId) {
      return groupId === "group_031"
        ? [{ characterId: "actor_000", name: "Actor 000", enabled: true }]
        : [{ characterId: "someone_else", name: "Other", enabled: true }];
    },
  }, fixture.options);

  const memberGroups = await service.queryGroups({ filters: { actorId: "actor_000" } });
  assert.deepEqual(memberGroups.items.map((group) => group.characterGroupId), ["group_031"]);
  assert.deepEqual(MVU_REQUEST_PARSERS.queryGroups({ filters: { actorId: "actor_000" } }), {
    filters: { actorId: "actor_000" },
  });

  const first = await service.queryActors({ search: "Actor" });
  assert.notEqual(first.nextCursor, null);
  await service.queryActors({ search: "Actor", cursor: first.nextCursor });
  await assert.rejects(
    service.queryActors({ search: "Actor", cursor: first.nextCursor }),
    /MVU_QUERY_CURSOR_INVALID/,
  );
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

test("picker keyset cursors do not duplicate rows inserted before the prior batch", async () => {
  const fixture = createSource(makeDataset(), {
    queryCommittedRecords: async () => ({ items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null }),
  });
  const actors = makeActors();
  const source = {
    ...fixture.source,
    async listActors() {
      return structuredClone(actors);
    },
  };
  const service = new MvuQueryService(source, fixture.options);
  const first = await service.queryActors({});
  const comparisonFirst = await service.queryActors({});
  const expectedSecond = await service.queryActors({ cursor: comparisonFirst.nextCursor });
  actors.push({ characterId: "actor_inserted", name: "Actor -001", enabled: true });
  const second = await service.queryActors({ cursor: first.nextCursor });

  const firstIds = new Set(first.items.map((item) => item.characterId));
  assert.equal(second.items.some((item) => firstIds.has(item.characterId)), false);
  assert.equal(second.items[0].characterId, expectedSecond.items[0].characterId);
});

test("picker cursors are opaque query-bound bounded tokens with expiry and eviction", async () => {
  let clock = NOW;
  let tokenSequence = 0;
  const fixture = createSource(makeDataset(), {
    queryCommittedRecords: async () => ({ items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null }),
  });
  const service = new MvuQueryService(fixture.source, {
    ...fixture.options,
    now: () => clock,
    cursorTtlMs: 1_000,
    cursorCapacity: 2,
    createCursorToken: () => `opaque_${++tokenSequence}`,
  });

  const first = await service.queryActors({ search: "actor" });
  assert.match(first.nextCursor, /^c1_[A-Za-z0-9_-]{1,80}$/);
  assert.ok(first.nextCursor.length <= 96);
  await assert.rejects(
    service.queryGroups({ search: "actor", cursor: first.nextCursor }),
    /MVU_QUERY_CURSOR_INVALID/,
  );
  await assert.rejects(
    service.queryActors({ search: "different", cursor: first.nextCursor }),
    /MVU_QUERY_CURSOR_INVALID/,
  );
  await assert.rejects(
    service.queryActors({ search: "actor", cursor: `${first.nextCursor}x` }),
    /MVU_QUERY_CURSOR_INVALID/,
  );

  const longUnicode = "Ａ".repeat(QUERY_SEARCH_MAX_LENGTH);
  const unicodePage = await service.queryActors({ search: longUnicode });
  if (unicodePage.nextCursor !== null) {
    assert.ok(unicodePage.nextCursor.length <= 96);
    await service.queryActors({ search: longUnicode, cursor: unicodePage.nextCursor });
  }

  const second = await service.queryActors({ search: "Actor 0" });
  const third = await service.queryActors({ search: "Actor 1" });
  assert.notEqual(second.nextCursor, null);
  assert.notEqual(third.nextCursor, null);
  await assert.rejects(
    service.queryActors({ search: "actor", cursor: first.nextCursor }),
    /MVU_QUERY_CURSOR_INVALID/,
  );

  clock += 1_001;
  await assert.rejects(
    service.queryActors({ search: "Actor 1", cursor: third.nextCursor }),
    /MVU_QUERY_CURSOR_INVALID/,
  );
});

test("picker cursor fingerprints normalize search but preserve exact filter string identity", async () => {
  const dataset = makeDataset();
  dataset.fields = Array.from({ length: 62 }, (_, index) => ({
    ...field(index),
    order: index,
    scope: "character",
    bindingIds: [index < 31 ? "Actor_A" : "actor_a"],
  }));
  const fixture = createSource(dataset, {
    queryCommittedRecords: async () => ({ items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null }),
  });
  let cursorSequence = 0;
  const service = new MvuQueryService(fixture.source, {
    ...fixture.options,
    createCursorToken: () => `fingerprint_${++cursorSequence}`,
  });

  const exact = await service.queryFields({
    filters: { mode: "picker", bindingId: "Actor_A" },
    sort: { key: "order", direction: "asc" },
  });
  assert.equal(exact.totalCount, 31);
  assert.notEqual(exact.nextCursor, null);
  await service.queryFields({
    filters: { bindingId: "Actor_A", mode: "picker" },
    sort: { direction: "asc", key: "order" },
    cursor: exact.nextCursor,
  });
  await assert.rejects(
    service.queryFields({
      filters: { mode: "picker", bindingId: "actor_a" },
      sort: { key: "order", direction: "asc" },
      cursor: exact.nextCursor,
    }),
    /MVU_QUERY_CURSOR_INVALID/,
  );

  const normalizedSearch = await service.queryActors({ search: "  ＡＣＴＯＲ   ０  " });
  assert.notEqual(normalizedSearch.nextCursor, null);
  await service.queryActors({ search: "actor 0", cursor: normalizedSearch.nextCursor });
});

test("all exact string filters preserve case and code-unit identity", async () => {
  const dataset = makeDataset();
  dataset.fields = [
    { ...field(0), id: "Field_A", bindingIds: ["Actor_A"] },
    { ...field(1), id: "field_a", bindingIds: ["actor_a"] },
  ];
  dataset.conditions = [
    { ...condition(0), id: "Condition_A" },
    { ...condition(1), id: "condition_a" },
  ];
  dataset.effectGroups = [
    { ...effectGroup(0), id: "Effect_A", fieldEffects: [{ ...effectGroup(0).fieldEffects[0], fieldId: "Field_A" }] },
    { ...effectGroup(1), id: "effect_a", fieldEffects: [{ ...effectGroup(1).fieldEffects[0], fieldId: "field_a" }] },
  ];
  dataset.rules = [
    { ...rule(0), id: "rule_condition_upper", conditionId: "Condition_A" },
    { ...rule(1), id: "rule_condition_lower", conditionId: "condition_a" },
    { ...rule(2), id: "rule_actor_upper", triggerActorSelector: { kind: "selected", actorIds: ["Actor_A"] } },
    { ...rule(3), id: "rule_actor_lower", triggerActorSelector: { kind: "selected", actorIds: ["actor_a"] } },
    { ...rule(4), id: "rule_group_upper", triggerActorSelector: { kind: "group", groupIds: ["Group_A"] } },
    { ...rule(5), id: "rule_group_lower", triggerActorSelector: { kind: "group", groupIds: ["group_a"] } },
  ];
  const fixture = createSource(dataset, {
    queryCommittedRecords: async () => ({ items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null }),
  });
  const service = new MvuQueryService(fixture.source, fixture.options);

  assert.deepEqual((await service.queryFields({ filters: { bindingId: "Actor_A" } })).items.map((item) => item.id), ["Field_A"]);
  assert.deepEqual((await service.queryFields({ filters: { bindingId: "actor_a" } })).items.map((item) => item.id), ["field_a"]);
  assert.deepEqual((await service.queryRules({ filters: { conditionId: "Condition_A" } })).items.map((item) => item.id), ["rule_condition_upper"]);
  assert.deepEqual((await service.queryRules({ filters: { conditionId: "condition_a" } })).items.map((item) => item.id), ["rule_condition_lower"]);
  assert.deepEqual((await service.queryRules({ filters: { actorId: "Actor_A" } })).items.map((item) => item.id), ["rule_actor_upper"]);
  assert.deepEqual((await service.queryRules({ filters: { actorId: "actor_a" } })).items.map((item) => item.id), ["rule_actor_lower"]);
  assert.deepEqual((await service.queryRules({ filters: { groupId: "Group_A" } })).items.map((item) => item.id), ["rule_group_upper"]);
  assert.deepEqual((await service.queryRules({ filters: { groupId: "group_a" } })).items.map((item) => item.id), ["rule_group_lower"]);
  assert.deepEqual((await service.queryEffectGroups({ filters: { fieldId: "Field_A" } })).items.map((item) => item.id), ["Effect_A"]);
  assert.deepEqual((await service.queryEffectGroups({ filters: { fieldId: "field_a" } })).items.map((item) => item.id), ["effect_a"]);
});

test("picker pagination uses normalized human sort and raw ID as the final tie-break", async () => {
  const dataset = makeDataset();
  const fixture = createSource(dataset, {
    queryCommittedRecords: async () => ({ items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null }),
  });
  const regular = Array.from({ length: 29 }, (_, index) => ({
    characterId: `id_${String(index).padStart(2, "0")}`,
    name: "Same",
    enabled: true,
  }));
  const actors = [
    ...regular,
    { characterId: "tie_a", name: "Same", enabled: true },
    { characterId: "tie_Ａ", name: "Same", enabled: true },
    { characterId: "tie_A", name: "Same", enabled: true },
  ];
  const service = new MvuQueryService({
    ...fixture.source,
    async listActors() { return structuredClone(actors); },
  }, fixture.options);

  const first = await service.queryActors({});
  const second = await service.queryActors({ cursor: first.nextCursor });
  const ids = [...first.items, ...second.items].map((item) => item.characterId);
  assert.deepEqual(ids.slice(-3), ["tie_A", "tie_a", "tie_Ａ"]);
  assert.equal(new Set(ids).size, actors.length);
});

test("actor picker can be restricted to authoritative members of one group", async () => {
  const fixture = createSource(makeDataset());
  const service = new MvuQueryService({
    ...fixture.source,
    async listActorsForGroup(groupId) {
      assert.equal(groupId, "group_007");
      return [
        { characterId: "member_b", name: "成员乙", enabled: true },
        { characterId: "member_a", name: "成员甲", enabled: true },
      ];
    },
  }, fixture.options);

  assert.deepEqual(MVU_REQUEST_PARSERS.queryActors({ filters: { groupId: "group_007" } }), {
    filters: { groupId: "group_007" },
  });
  const result = await service.queryActors({ filters: { groupId: "group_007" } });
  assert.deepEqual(result.items.map((actor) => actor.characterId), ["member_b", "member_a"]);
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
    () => MVU_REQUEST_PARSERS.createCondition({ expectedRevision: 1, condition: {
      name: "bounded",
      description: "x".repeat(4_097),
      enabled: true,
      expression: { kind: "predicate", predicate: { kind: "user_care" } },
    } }),
    /MVU_CONDITION_INPUT_INVALID/,
  );
  assert.throws(
    () => MVU_REQUEST_PARSERS.createRule({ expectedRevision: 1, rule: {
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
  assert.throws(
    () => MVU_REQUEST_PARSERS.copyCondition({ id: "x".repeat(257), expectedRevision: 1 }),
    /MVU_.*REQUEST_INVALID/,
  );
  assert.throws(
    () => MVU_REQUEST_PARSERS.getRuleReferences({ id: "x".repeat(257) }),
    /MVU_.*(?:INVALID|REQUIRED)/,
  );
  const polluted = Object.create({ expectedRevision: 1 });
  polluted.id = "condition_0000";
  assert.throws(
    () => MVU_REQUEST_PARSERS.deleteCondition(polluted),
    /MVU_.*REQUEST_INVALID/,
  );
});

test("oversized reference IDs are rejected before any dataset read", async () => {
  let reads = 0;
  const fixture = createSource(makeDataset(), {
    queryCommittedRecords: async () => ({ items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null }),
  });
  const service = new MvuQueryService({
    ...fixture.source,
    async readV3() {
      reads += 1;
      return fixture.source.readV3();
    },
  }, fixture.options);

  await assert.rejects(service.getConditionReferences({ id: "x".repeat(257), page: 1 }), /MVU_ENTITY_ID_INVALID/);
  await assert.rejects(service.getEffectGroupReferences({ id: "x".repeat(257), page: 1 }), /MVU_ENTITY_ID_INVALID/);
  await assert.rejects(service.getRuleReferences({ id: "x".repeat(257) }), /MVU_ENTITY_ID_INVALID/);
  assert.equal(reads, 0);
});

test("v3 mutation parsers require strict client revisions and reject unknown keys", () => {
  assert.deepEqual(
    MVU_REQUEST_PARSERS.copyCondition({ id: "condition_0000", expectedRevision: 7 }),
    { id: "condition_0000", expectedRevision: 7 },
  );
  assert.throws(
    () => MVU_REQUEST_PARSERS.copyCondition({ id: "condition_0000" }),
    /MVU_.*REQUEST_INVALID/,
  );
  assert.throws(
    () => MVU_REQUEST_PARSERS.toggleRule({ id: "rule_0000", enabled: true, expectedRevision: 7, force: true }),
    /MVU_TOGGLE_RULE_REQUEST_INVALID/,
  );
  assert.throws(
    () => MVU_REQUEST_PARSERS.deleteEffectGroup({ id: "effect_0000", expectedRevision: -1 }),
    /MVU_.*REQUEST_INVALID/,
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
  const dataset = makeDataset();
  dataset.activeEffects = [];
  dataset.fields[0].bindingIds = ["actor_000"];
  dataset.fields[0].stages = [
    { id: "stage_low", name: "Low", description: "Low state", threshold: 0 },
    { id: "stage_high", name: "High", description: "High state", threshold: 40 },
  ];
  dataset.stateValues["character:actor_000"] = { field_0000: 48 };
  const fixture = createSource(dataset, {
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

  assert.equal(snapshot.pages.fields.items.length, 1);
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
  const projectedField = snapshot.pages.fields.items.find((item) => item.id === "field_0000");
  assert.deepEqual(projectedField.current, {
    value: 48,
    stage: { id: "stage_high", name: "High", threshold: 40 },
    scopeKey: "character:actor_000",
    actorId: "actor_000",
    groupId: "group_000",
    chatId: "chat_main",
  });
  assert.deepEqual(projectedField.range, { minimum: 0, maximum: 100, step: 1 });
  assert.deepEqual(projectedField.theme, { icon: dataset.fields[0].icon, color: dataset.fields[0].themeColor });
  assert.equal("stages" in projectedField, false);
  assert.equal("bindingIds" in projectedField, false);
  assert.equal("ai" in projectedField, false);
  assert.equal("actions" in snapshot.pages.rules.items[0], false);
  assert.equal("expression" in snapshot.pages.conditions.items[0], false);
  assert.equal("fieldEffects" in snapshot.pages.effectGroups.items[0], false);
  assert.equal("ruleIds" in snapshot.pages.records.items[0], false);
  assert.equal("effectIds" in snapshot.pages.records.items[0], false);
  assert.ok(JSON.stringify(snapshot).length < 24_000);
  assert.equal("actors" in snapshot, false);
  assert.equal("groups" in snapshot, false);
  assert.equal("records" in snapshot, false);
});

test("status snapshot filters disabled and context-inapplicable fields before taking five", async () => {
  const dataset = makeDataset();
  dataset.fields = Array.from({ length: 12 }, (_, index) => ({
    ...field(index),
    enabled: index >= 6,
    scope: "character",
    bindingIds: index >= 6 ? ["actor_000"] : ["actor_elsewhere"],
  }));
  const fixture = createSource(dataset, {
    queryCommittedRecords: async () => ({ items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null }),
  });

  const snapshot = await new MvuQueryService(fixture.source, fixture.options).pageSnapshot();

  assert.deepEqual(snapshot.pages.fields.items.map((item) => item.id), [
    "field_0007", "field_0008", "field_0009", "field_0010", "field_0011",
  ]);
  assert.equal(snapshot.pages.fields.totalCount, 6);
});

test("record query forwards exact field and scope filters to the bounded store", async () => {
  const fixture = createSource(makeDataset(), {
    queryCommittedRecords: async (request) => {
      assert.deepEqual(request, {
        offset: 0, limit: 10, direction: "desc", fieldId: "field_0001", scopeKey: "character:actor_000",
      });
      return { items: [record(7)], loadedCount: 1, totalCount: 1, hasMore: false, nextOffset: null };
    },
  });

  const response = await new MvuQueryService(fixture.source, fixture.options).queryRecords({
    page: 1,
    filters: { fieldId: "field_0001", scopeKey: "character:actor_000" },
  });
  assert.equal(response.items[0].id, "record_7");
  assert.equal(response.totalCount, 1);
});

test("compact snapshot preserves exact identity reference timestamp and color values", async () => {
  const collisionPrefix = "f".repeat(40);
  const fieldIdA = `${collisionPrefix}A`;
  const fieldIdB = `${collisionPrefix}B`;
  const actorId = `Actor_${"A".repeat(64)}`;
  const groupId = `Group_${"G".repeat(64)}`;
  const chatId = `Chat_${"C".repeat(64)}`;
  const stageId = `stage_${"s".repeat(64)}`;
  const conditionId = `condition_${"c".repeat(64)}`;
  const ruleId = `rule_${"r".repeat(64)}`;
  const effectId = `effect_${"e".repeat(64)}`;
  const recordId = `record_${"d".repeat(64)}`;
  const longZoneTimestamp = "2033-05-18T03:33:20.000+08:00";
  const themeColor = "color(display-p3 0.1 0.2 0.3 / 0.75)";
  const iconProtocol = "custom_protocol_icon_v1_with_suffix";
  const migrationCode = `MVU_${"P".repeat(64)}`;
  const indexingCode = "MVU_RECORD_INDEX_RETRY";
  const dataset = makeDataset();
  dataset.activeEffects = [];
  dataset.fields = [
    {
      ...field(0),
      id: fieldIdA,
      order: 0,
      scope: "character",
      bindingIds: [actorId],
      themeColor,
      icon: iconProtocol,
      stages: [{ id: stageId, name: "Identity stage", description: "", threshold: 0 }],
    },
    {
      ...field(1),
      id: fieldIdB,
      order: 1,
      scope: "character",
      bindingIds: [actorId],
      themeColor,
    },
  ];
  dataset.conditions = [{ ...condition(0), id: conditionId, updatedAt: longZoneTimestamp }];
  dataset.rules = [{
    ...rule(0),
    id: ruleId,
    conditionId,
    updatedAt: longZoneTimestamp,
    actions: [{
      kind: "change_field",
      fieldId: fieldIdA,
      target: { kind: "selected", actorIds: [actorId] },
      delta: 1,
      effectGroupIds: [effectId],
    }],
  }];
  dataset.effectGroups = [{
    ...effectGroup(0),
    id: effectId,
    updatedAt: longZoneTimestamp,
    fieldEffects: [{ ...effectGroup(0).fieldEffects[0], fieldId: fieldIdA }],
  }];
  dataset.stateValues = { [`character:${actorId}`]: { [fieldIdA]: 48 } };
  const exactRecord = {
    ...record(0),
    id: recordId,
    scopeKey: `character:${actorId}`,
    fieldId: fieldIdA,
    actorId,
    groupId,
    chatId,
  };
  const fixture = createSource(dataset, {
    queryCommittedRecords: async () => ({
      items: [exactRecord], loadedCount: 1, totalCount: 1, hasMore: false, nextOffset: null,
    }),
  });
  const source = {
    ...fixture.source,
    async listActors() {
      return [{ characterId: actorId, name: "Actor identity", avatarUri: null, enabled: true }];
    },
    async listGroups() {
      return [{ characterGroupId: groupId, name: "Group identity", avatarUri: null }];
    },
    async activeContext() {
      return { actorId, groupId, chatId, actorName: "Actor identity" };
    },
    async migrationStatus() {
      return {
        mode: "v3",
        source: "existing",
        cleanup: { state: "pending", error: { code: migrationCode, message: "repair pending" } },
        indexing: { state: "pending", error: { code: indexingCode, message: "index publication pending" } },
      };
    },
  };
  const service = new MvuQueryService(source, fixture.options);
  const snapshot = await service.pageSnapshot();

  assert.deepEqual(snapshot.pages.fields.items.map((item) => item.id), [fieldIdA, fieldIdB]);
  assert.equal(new Set(snapshot.pages.fields.items.map((item) => item.id)).size, 2);
  const fieldSummary = snapshot.pages.fields.items[0];
  assert.equal(fieldSummary.id, fieldIdA);
  assert.equal(fieldSummary.current.stage.id, stageId);
  assert.equal(fieldSummary.current.actorId, actorId);
  assert.equal(fieldSummary.current.groupId, groupId);
  assert.equal(fieldSummary.current.chatId, chatId);
  assert.equal(fieldSummary.current.scopeKey, `character:${actorId}`);
  assert.equal(fieldSummary.theme.color, themeColor);
  assert.equal(fieldSummary.theme.icon, iconProtocol);
  assert.equal(snapshot.pages.rules.items[0].id, ruleId);
  assert.equal(snapshot.pages.rules.items[0].conditionId, conditionId);
  assert.equal(snapshot.pages.rules.items[0].updatedAt, longZoneTimestamp);
  assert.equal(snapshot.pages.conditions.items[0].id, conditionId);
  assert.equal(snapshot.pages.conditions.items[0].updatedAt, longZoneTimestamp);
  assert.equal(snapshot.pages.effectGroups.items[0].id, effectId);
  assert.equal(snapshot.pages.effectGroups.items[0].updatedAt, longZoneTimestamp);
  assert.equal(snapshot.pages.records.items[0].id, recordId);
  assert.equal(snapshot.pages.records.items[0].fieldId, fieldIdA);
  assert.equal(snapshot.pages.records.items[0].actorId, actorId);
  assert.equal(snapshot.pages.records.items[0].groupId, groupId);
  assert.equal(snapshot.activeContext.actorId, actorId);
  assert.equal(snapshot.activeContext.groupId, groupId);
  assert.equal(snapshot.activeContext.chatId, chatId);
  assert.equal(snapshot.revision, dataset.revision);
  assert.equal(snapshot.migrationStatus.cleanup.error.code, migrationCode);
  assert.equal(snapshot.migrationStatus.indexing.error.code, indexingCode);
  assert.equal(Number.isFinite(Date.parse(snapshot.pages.rules.items[0].updatedAt)), true);

  const roundTrip = await service.getEntityById({ entityType: "field", id: fieldSummary.id });
  assert.equal(roundTrip.id, fieldIdA);
  assert.deepEqual(roundTrip.bindingIds, [actorId]);
});

test("snapshot avatar URIs are complete below the byte cap or null with an unavailable marker", async () => {
  const safeUri = `data:image/png;base64,${"a".repeat(2_000)}`;
  const oversizedUri = `data:image/png;base64,${"😀".repeat(1_100)}`;
  const fixture = createSource(makeDataset(), {
    queryCommittedRecords: async () => ({ items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null }),
  });
  const source = {
    ...fixture.source,
    async listActors() {
      return [{ characterId: "actor_000", name: "Actor", avatarUri: safeUri, enabled: true }];
    },
    async listGroups() {
      return [{ characterGroupId: "group_000", name: "Group", avatarUri: oversizedUri }];
    },
  };
  const snapshot = await new MvuQueryService(source, fixture.options).pageSnapshot();

  assert.equal(Buffer.byteLength(safeUri, "utf8") <= MVU_SNAPSHOT_URI_MAX_BYTES, true);
  assert.equal(Buffer.byteLength(oversizedUri, "utf8") > MVU_SNAPSHOT_URI_MAX_BYTES, true);
  assert.equal(snapshot.selected.actor.avatarUri, safeUri);
  assert.equal(snapshot.selected.actor.avatarUriUnavailable, false);
  assert.equal(snapshot.selected.group.avatarUri, null);
  assert.equal(snapshot.selected.group.avatarUriUnavailable, true);
});

test("snapshot byte pressure reduces returned summaries without corrupting structured values", async () => {
  const maxId = (namespace, index) => {
    const prefix = `${namespace}_${index}_`;
    return `${prefix}${"x".repeat(256 - prefix.length)}`;
  };
  const hugeLabel = "😀".repeat(100_000);
  const hugeValidColor = `rgb(${" ".repeat(20_000)}1 2 3)`;
  const actorId = maxId("actor", 0);
  const groupId = maxId("group", 0);
  const chatId = maxId("chat", 0);
  const fieldIds = Array.from({ length: 5 }, (_, index) => maxId("field", index));
  const conditionIds = Array.from({ length: 5 }, (_, index) => maxId("condition", index));
  const effectIds = Array.from({ length: 5 }, (_, index) => maxId("effect", index));
  const dataset = makeDataset();
  dataset.activeEffects = [];
  dataset.fields = fieldIds.map((id, index) => ({
    ...field(index),
    id,
    name: hugeLabel,
    description: hugeLabel,
    order: index,
    scope: "character",
    bindingIds: [actorId],
    themeColor: hugeValidColor,
    stages: [{ id: maxId("stage", index), name: hugeLabel, description: hugeLabel, threshold: 0 }],
  }));
  dataset.conditions = conditionIds.map((id, index) => ({
    ...condition(index), id, name: hugeLabel, description: hugeLabel,
  }));
  dataset.effectGroups = effectIds.map((id, index) => ({
    ...effectGroup(index),
    id,
    name: hugeLabel,
    description: hugeLabel,
    fieldEffects: [{ ...effectGroup(index).fieldEffects[0], fieldId: fieldIds[index] }],
  }));
  dataset.rules = Array.from({ length: 5 }, (_, index) => ({
    ...rule(index),
    id: maxId("rule", index),
    name: hugeLabel,
    description: hugeLabel,
    conditionId: conditionIds[index],
    executionOrder: index,
    actions: [{ kind: "activate_effect_group", effectGroupId: effectIds[index] }],
  }));
  dataset.stateValues = {
    [`character:${actorId}`]: Object.fromEntries(fieldIds.map((id, index) => [id, index])),
  };
  const exactRecords = Array.from({ length: 5 }, (_, index) => ({
    ...record(index),
    id: maxId("record", index),
    scopeKey: `character:${actorId}`,
    fieldId: fieldIds[index],
    fieldName: hugeLabel,
    actorId,
    actorName: hugeLabel,
    groupId,
    chatId,
    reason: hugeLabel,
  }));
  const fixture = createSource(dataset, {
    queryCommittedRecords: async () => ({
      items: exactRecords, loadedCount: 5, totalCount: 5, hasMore: false, nextOffset: null,
    }),
  });
  const source = {
    ...fixture.source,
    async listActors() {
      return [{ characterId: actorId, name: hugeLabel, avatarUri: hugeLabel, enabled: true }];
    },
    async listGroups() {
      return [{ characterGroupId: groupId, name: hugeLabel, avatarUri: hugeLabel }];
    },
    async activeContext() {
      return { actorId, groupId, chatId, actorName: hugeLabel };
    },
  };
  const snapshot = await new MvuQueryService(source, fixture.options).pageSnapshot({
    groupName: hugeLabel,
    chatName: hugeLabel,
  });

  assert.ok(Buffer.byteLength(JSON.stringify(snapshot), "utf8") <= MVU_SNAPSHOT_MAX_BYTES);
  assert.equal(snapshot.snapshotTruncated, true);
  assert.deepEqual(snapshot.counts, {
    fields: 5, actors: 1, groups: 1, rules: 5, conditions: 5, effectGroups: 5, records: 5,
  });
  for (const key of ["fields", "rules", "conditions", "effectGroups", "records"]) {
    assert.equal(snapshot.returnedCount[key], snapshot.pages[key].items.length);
    assert.equal(snapshot.pages[key].totalCount, 5);
    if (snapshot.returnedCount[key] < 5) assert.equal(snapshot.pages[key].hasMore, true);
  }
  assert.ok(snapshot.returnedCount.fields > 0 && snapshot.returnedCount.fields < 5);
  for (const item of snapshot.pages.fields.items) {
    assert.equal(item.id.length, 256);
    assert.equal(item.theme.color, hugeValidColor);
  }
  assert.equal(snapshot.selected.actor.characterId, actorId);
  assert.equal(snapshot.selected.group.characterGroupId, groupId);
  assert.equal(snapshot.activeContext.chatId, chatId);
  assert.equal(snapshot.selected.actor.avatarUri, null);
  assert.equal(snapshot.selected.actor.avatarUriUnavailable, true);
});

test("compact snapshot stays below a deterministic byte cap for multi-megabyte legacy labels", async () => {
  const huge = "😀".repeat(1_000_000);
  assert.equal(huge.length, 2_000_000);
  const dataset = makeDataset();
  dataset.activeEffects = [];
  dataset.fields = [{
    ...field(0),
    name: huge,
    description: "\ud800".repeat(100),
    bindingIds: ["actor_000"],
  }];
  dataset.conditions = [{ ...condition(0), name: huge, description: huge }];
  dataset.effectGroups = [{ ...effectGroup(0), name: huge, description: huge }];
  dataset.rules = [{ ...rule(0), name: huge, description: huge }];
  const hugeRecord = { ...record(0), fieldName: huge, actorName: huge, reason: huge };
  const fixture = createSource(dataset, {
    queryCommittedRecords: async () => ({
      items: [hugeRecord],
      loadedCount: 1,
      totalCount: 1,
      hasMore: false,
      nextOffset: null,
    }),
  });
  const source = {
    ...fixture.source,
    async listActors() {
      return [{ characterId: "actor_000", name: huge, avatarUri: huge, enabled: true }];
    },
    async listGroups() {
      return [{ characterGroupId: "group_000", name: huge, avatarUri: huge }];
    },
    async activeContext() {
      return { chatId: "chat_main", actorId: "actor_000", groupId: "group_000", actorName: huge };
    },
    async migrationStatus() {
      return {
        mode: "v3",
        source: "migrated",
        report: {
          migratedFields: 1,
          migratedRules: 1,
          migratedConditions: 1,
          migratedEffectGroups: 1,
          warnings: Array.from({ length: 12 }, () => huge),
        },
        cleanup: { state: "pending", error: { code: "MVU_LEGACY_WARNING", message: huge } },
      };
    },
  };
  const snapshot = await new MvuQueryService(source, fixture.options).pageSnapshot({
    groupName: huge,
    chatName: huge,
  });

  assert.ok(Buffer.byteLength(JSON.stringify(snapshot), "utf8") <= MVU_SNAPSHOT_MAX_BYTES);
  assert.equal(snapshot.pages.fields.items[0].truncated, true);
  assert.equal(snapshot.pages.rules.items[0].truncated, true);
  assert.equal(snapshot.pages.conditions.items[0].truncated, true);
  assert.equal(snapshot.pages.effectGroups.items[0].truncated, true);
  assert.equal(snapshot.pages.records.items[0].truncated, true);
  assert.equal(snapshot.selected.actor.truncated, true);
  assert.equal(snapshot.selected.group.truncated, true);
  assert.equal(snapshot.selected.actor.avatarUri, null);
  assert.equal(snapshot.selected.actor.avatarUriUnavailable, true);
  assert.equal(snapshot.selected.group.avatarUri, null);
  assert.equal(snapshot.selected.group.avatarUriUnavailable, true);
  assert.equal(snapshot.activeContext.truncated, true);
  assert.equal(snapshot.contextLabels.truncated, true);
  assert.equal(snapshot.migrationStatus.truncated, true);
  assert.equal(snapshot.migrationStatus.report.warningCount, 12);
  assert.equal(snapshot.migrationStatus.report.warnings.length, 8);
  assert.equal(snapshot.migrationStatus.report.warningsTruncated, true);
  assert.equal(snapshot.pages.fields.items[0].name.isWellFormed(), true);
  assert.equal(snapshot.pages.fields.items[0].description.isWellFormed(), true);
  assert.equal(snapshot.contextLabels.chatName.isWellFormed(), true);
});

test("condition and effect references are exact bounded pages including active instances", async () => {
  const dataset = makeDataset();
  dataset.conditions = [condition(0)];
  dataset.effectGroups = [effectGroup(0)];
  dataset.rules = Array.from({ length: 25 }, (_, index) => ({
    ...rule(index),
    conditionId: "condition_0000",
    actions: [{ kind: "activate_effect_group", effectGroupId: "effect_0000" }],
  }));
  dataset.activeEffects = Array.from({ length: 23 }, (_, index) => ({
    id: `active_effect_${String(index).padStart(3, "0")}`,
    definitionId: "effect_0000",
    resolvedTargets: [{
      fieldId: "field_0000",
      actorId: "actor_t",
      scope: "character",
      scopeKey: "character:actor_t",
    }],
    duration: { expiresAt: null, remainingTurns: null },
    activatedAt: new Date(NOW + index).toISOString(),
    reason: { mode: "custom", template: "general", text: `instance ${index}` },
  }));
  const fixture = createSource(dataset, {
    queryCommittedRecords: async () => ({ items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null }),
  });
  const service = new MvuQueryService(fixture.source, fixture.options);

  const conditionPage1 = await service.getConditionReferences({ id: "condition_0000", page: 1 });
  const conditionPage3 = await service.getConditionReferences({ id: "condition_0000", page: 3 });
  assertExactResponse(conditionPage1, { totalCount: 25, hasMore: true });
  assert.equal(conditionPage1.items.length, 10);
  assert.equal(conditionPage3.items.length, 5);

  const effectPage1 = await service.getEffectGroupReferences({ id: "effect_0000", page: 1 });
  const effectPage5 = await service.getEffectGroupReferences({ id: "effect_0000", page: 5 });
  assertExactResponse(effectPage1, { totalCount: 48, hasMore: true });
  assert.equal(effectPage1.items.length, 10);
  assert.equal(effectPage1.items.every((item) => item.relation === "active_instance"), true);
  assert.equal(effectPage5.items.length, 8);
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

  assert.deepEqual((await service.getConditionReferences({ id: "condition_0000", page: 1 })).items.map((item) => item.id), ["rule_0000"]);
  assert.deepEqual((await service.getEffectGroupReferences({ id: "effect_0000", page: 1 })).items.map((item) => item.id), []);
  const outgoing = await service.getRuleReferences({ id: "rule_0000" });
  assert.deepEqual(outgoing.map((item) => [item.entityType, item.id]), [
    ["condition", "condition_0000"],
    ["field", "field_0000"],
  ]);

  let revision = dataset.revision;
  const createdConditionResult = await service.createCondition({ expectedRevision: revision, condition: {
    name: "Created condition",
    description: "created",
    enabled: true,
    expression: { kind: "predicate", predicate: { kind: "user_care" } },
  } });
  revision = createdConditionResult.revision;
  const createdCondition = createdConditionResult.entity;
  revision = (await service.updateCondition({ id: createdCondition.id, expectedRevision: revision, patch: { description: "updated" } })).revision;
  revision = (await service.toggleCondition({ id: createdCondition.id, enabled: false, expectedRevision: revision })).revision;
  const copiedConditionResult = await service.copyCondition({ id: createdCondition.id, expectedRevision: revision });
  revision = copiedConditionResult.revision;
  const copiedCondition = copiedConditionResult.entity;
  assert.equal(copiedCondition.enabled, false);
  revision = (await service.deleteCondition({ id: copiedCondition.id, expectedRevision: revision })).revision;

  const createdEffectResult = await service.createEffectGroup({ expectedRevision: revision, effectGroup: {
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
  revision = createdEffectResult.revision;
  const createdEffect = createdEffectResult.entity;
  revision = (await service.updateEffectGroup({ id: createdEffect.id, expectedRevision: revision, patch: { description: "updated" } })).revision;
  revision = (await service.toggleEffectGroup({ id: createdEffect.id, enabled: false, expectedRevision: revision })).revision;
  const copiedEffectResult = await service.copyEffectGroup({ id: createdEffect.id, expectedRevision: revision });
  revision = copiedEffectResult.revision;
  const copiedEffect = copiedEffectResult.entity;
  revision = (await service.deleteEffectGroup({ id: copiedEffect.id, expectedRevision: revision })).revision;

  const createdRuleResult = await service.createRule({ expectedRevision: revision, rule: {
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
  revision = createdRuleResult.revision;
  const createdRule = createdRuleResult.entity;
  revision = (await service.updateRule({ id: createdRule.id, expectedRevision: revision, patch: { description: "updated" } })).revision;
  revision = (await service.toggleRule({ id: createdRule.id, enabled: false, expectedRevision: revision })).revision;
  const copiedRuleResult = await service.copyRule({ id: createdRule.id, expectedRevision: revision });
  revision = copiedRuleResult.revision;
  const copiedRule = copiedRuleResult.entity;
  assert.deepEqual((await service.getEffectGroupReferences({ id: createdEffect.id, page: 1 })).items.map((item) => item.id).sort(), [
    copiedRule.id,
    createdRule.id,
  ].sort());
  revision = (await service.deleteRule({ id: copiedRule.id, expectedRevision: revision })).revision;
  revision = (await service.deleteRule({ id: createdRule.id, expectedRevision: revision })).revision;
  revision = (await service.deleteEffectGroup({ id: createdEffect.id, expectedRevision: revision })).revision;
  revision = (await service.deleteCondition({ id: createdCondition.id, expectedRevision: revision })).revision;

  assert.equal(fixture.current().conditions.some((item) => item.id === createdCondition.id), false);
  assert.equal(fixture.current().effectGroups.some((item) => item.id === createdEffect.id), false);
  assert.equal(fixture.current().rules.some((item) => item.id === createdRule.id), false);
});

test("all condition effect-group and rule mutations enforce revision CAS before writes", async (t) => {
  const conditionInput = {
    name: "Matrix condition",
    description: "matrix",
    enabled: true,
    expression: { kind: "predicate", predicate: { kind: "user_care" } },
  };
  const effectGroupInput = {
    name: "Matrix effect",
    description: "matrix",
    enabled: true,
    fieldEffects: [{
      id: "field_effect_matrix",
      fieldId: "field_0000",
      actorSelector: { kind: "all_bound" },
      operations: [{ kind: "immediate_delta", value: 1 }],
    }],
  };
  const ruleInput = {
    name: "Matrix rule",
    description: "matrix",
    enabled: true,
    triggerActorSelector: { kind: "any" },
    conditionId: "condition_0000",
    actions: [{ kind: "activate_effect_group", effectGroupId: "effect_0000" }],
    cooldownHours: 0,
    executionOrder: 1,
  };
  const operations = [
    ["condition create", (service, expectedRevision) => service.createCondition({ expectedRevision, condition: conditionInput })],
    ["condition update", (service, expectedRevision) => service.updateCondition({ id: "condition_0000", expectedRevision, patch: { description: "updated" } })],
    ["condition copy", (service, expectedRevision) => service.copyCondition({ id: "condition_0000", expectedRevision })],
    ["condition toggle", (service, expectedRevision) => service.toggleCondition({ id: "condition_0000", enabled: false, expectedRevision })],
    ["condition delete", (service, expectedRevision) => service.deleteCondition({ id: "condition_0000", expectedRevision })],
    ["effect-group create", (service, expectedRevision) => service.createEffectGroup({ expectedRevision, effectGroup: effectGroupInput })],
    ["effect-group update", (service, expectedRevision) => service.updateEffectGroup({ id: "effect_0000", expectedRevision, patch: { description: "updated" } })],
    ["effect-group copy", (service, expectedRevision) => service.copyEffectGroup({ id: "effect_0000", expectedRevision })],
    ["effect-group toggle", (service, expectedRevision) => service.toggleEffectGroup({ id: "effect_0000", enabled: false, expectedRevision })],
    ["effect-group delete", (service, expectedRevision) => service.deleteEffectGroup({ id: "effect_0000", expectedRevision })],
    ["rule create", (service, expectedRevision) => service.createRule({ expectedRevision, rule: ruleInput })],
    ["rule update", (service, expectedRevision) => service.updateRule({ id: "rule_0000", expectedRevision, patch: { description: "updated" } })],
    ["rule copy", (service, expectedRevision) => service.copyRule({ id: "rule_0000", expectedRevision })],
    ["rule toggle", (service, expectedRevision) => service.toggleRule({ id: "rule_0000", enabled: false, expectedRevision })],
    ["rule delete", (service, expectedRevision) => service.deleteRule({ id: "rule_0000", expectedRevision })],
  ];

  for (const [name, mutate] of operations) {
    await t.test(name, async () => {
      const dataset = makeDataset();
      dataset.conditions = [condition(0)];
      dataset.effectGroups = [effectGroup(0)];
      dataset.rules = name === "condition delete" || name === "effect-group delete" ? [] : [rule(0)];
      dataset.activeEffects = [];
      const fixture = createSource(dataset, {
        queryCommittedRecords: async () => ({ items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null }),
      });
      let writes = 0;
      const transactV3 = fixture.source.transactV3;
      const service = new MvuQueryService({
        ...fixture.source,
        async transactV3(...args) {
          writes += 1;
          return transactV3(...args);
        },
      }, fixture.options);
      const before = fixture.current();

      await assert.rejects(mutate(service, dataset.revision + 99), /MVU_STALE_REVISION/);
      assert.equal(writes, 0);
      assert.deepEqual(fixture.current(), before);

      const committed = await mutate(service, dataset.revision);
      assert.equal(committed.revision, dataset.revision + 1);
      assert.equal(writes, 1);
      assert.equal(fixture.current().revision, dataset.revision + 1);
    });
  }
});

test("copying nested conditions assigns fresh IDs to every AI predicate", async () => {
  const dataset = makeDataset();
  dataset.activeEffects = [];
  dataset.conditions = [{
    ...condition(0),
    expression: {
      kind: "and",
      children: [
        { kind: "predicate", predicate: { kind: "ai_semantic", id: "ai_original_1", triggerType: "mood", requirement: "happy", minimumConfidence: 0.5 } },
        { kind: "not", child: { kind: "or", children: [
          { kind: "predicate", predicate: { kind: "ai_semantic", id: "ai_original_2", triggerType: "event", requirement: "gift", minimumConfidence: 0.7 } },
          { kind: "predicate", predicate: { kind: "user_care" } },
        ] } },
      ],
    },
  }];
  dataset.rules = [];
  const fixture = createSource(dataset, {
    queryCommittedRecords: async () => ({ items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null }),
  });
  const service = new MvuQueryService(fixture.source, fixture.options);
  const copied = await service.copyCondition({ id: "condition_0000", expectedRevision: dataset.revision });
  const serialized = JSON.stringify(copied.entity.expression);
  assert.doesNotMatch(serialized, /ai_original_[12]/);
  assert.match(serialized, /ai_predicate_created_/);
  assert.equal(fixture.current().conditions.length, 2);
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
