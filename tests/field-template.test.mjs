import assert from "node:assert/strict";
import test from "node:test";

import { migrateDatasetV2ToV3 } from "../dist/mvu/app/migration-v3.js";
import { MvuQueryService } from "../dist/mvu/app/query.js";
import { V3MvuStore } from "../dist/mvu/app/store-v3.js";
import { FileMvuStore } from "../dist/mvu/app/store.js";
import { assertMvuDatasetV3 } from "../dist/mvu/app/validation.js";
import {
  MVU_IPC,
  MVU_REQUEST_PARSERS,
  installMvuIpc,
  mvuIpcClient,
} from "../dist/shared/ipc.js";
import webContainerScreen from "../dist/ui/web_container/index.ui.js";
import { createFakeMvuFileApi, legacyDatasetFixture } from "./helpers.mjs";

const NOW = Date.parse("2033-05-18T03:33:20.000Z");

function createFixture() {
  const dataset = migrateDatasetV2ToV3(legacyDatasetFixture(), NOW).dataset;
  const actors = [
    { characterId: "actor_t", name: "角色 T", avatarUri: "content://actors/t", enabled: true },
    { characterId: "actor_u", name: "角色 U", avatarUri: null, enabled: true },
  ];
  let current = structuredClone(dataset);
  let transactionCount = 0;
  const source = {
    async readV3() {
      return { revision: current.revision, dataset: structuredClone(current) };
    },
    async transactV3(expectedRevision, next) {
      assert.equal(expectedRevision, current.revision);
      transactionCount += 1;
      current = structuredClone(next);
      current.revision = expectedRevision + 1;
      return { revision: current.revision, dataset: structuredClone(current) };
    },
    async queryCommittedRecords() {
      return { items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null };
    },
    async listActors() {
      return structuredClone(actors);
    },
    async listGroups() {
      return [{ characterGroupId: "group_main", name: "主群组", avatarUri: null }];
    },
    async activeContext() {
      return {
        chatId: "chat_current",
        actorId: "actor_t",
        groupId: "group_main",
        actorName: "角色 T",
      };
    },
    async migrationStatus() {
      return { mode: "v3", source: "existing" };
    },
  };
  return {
    dataset,
    service: new MvuQueryService(source, {
      now: () => NOW,
      createId: (prefix) => `${prefix}_deterministic`,
    }),
    current: () => structuredClone(current),
    transactionCount: () => transactionCount,
    advanceRevision: () => { current.revision += 1; },
  };
}

function actorMatrix(...targets) {
  return [{ fieldId: "field_affinity", targets }];
}

function collectObjectKeys(value, keys = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, keys);
    return keys;
  }
  if (value === null || typeof value !== "object") return keys;
  for (const [key, item] of Object.entries(value)) {
    keys.add(key);
    collectObjectKeys(item, keys);
  }
  return keys;
}

function createServiceFrom(dataset, {
  actors = [],
  groups = [],
  context = { chatId: "chat_current", actorId: null, groupId: null, actorName: "" },
} = {}) {
  let current = structuredClone(dataset);
  let transactionCount = 0;
  const service = new MvuQueryService({
    async readV3() { return { revision: current.revision, dataset: structuredClone(current) }; },
    async transactV3(expectedRevision, next) {
      assert.equal(expectedRevision, current.revision);
      transactionCount += 1;
      current = structuredClone(next);
      current.revision = expectedRevision + 1;
      return { revision: current.revision, dataset: structuredClone(current) };
    },
    async queryCommittedRecords() { return { items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null }; },
    async listActors() { return structuredClone(actors); },
    async listGroups() { return structuredClone(groups); },
    async activeContext() { return structuredClone(context); },
    async migrationStatus() { return { mode: "v3", source: "existing" }; },
  }, { now: () => NOW });
  return {
    service,
    current: () => structuredClone(current),
    transactionCount: () => transactionCount,
    advanceRevision: () => { current.revision += 1; },
  };
}

async function createRealStoreHarness(legacy, configDir, actors = []) {
  const v2Path = `${configDir}/operit_mvu.dataset.v2.json`;
  const v3Path = `${configDir}/operit_mvu.dataset.v3.json`;
  const files = createFakeMvuFileApi({ [v2Path]: JSON.stringify(legacy, null, 2) });
  const createLegacyStore = () => new FileMvuStore({
    getConfigDir: () => configDir,
    files,
    createInitialDataset: () => structuredClone(legacy),
  });
  const createStore = () => new V3MvuStore({
    getConfigDir: () => configDir,
    files,
    legacyStore: createLegacyStore(),
    createInitialDataset: () => structuredClone(legacy),
    now: () => NOW,
  });
  const createService = (store) => new MvuQueryService({
    readV3: () => store.readV3(),
    transactV3: (expectedRevision, next, records = []) => store.transactV3(expectedRevision, next, records),
    queryCommittedRecords: (request) => store.queryRecords(request),
    async listActors() { return structuredClone(actors); },
    async listGroups() { return []; },
    async activeContext() { return { chatId: "chat_current", actorId: "actor_t", groupId: null, actorName: "角色 T" }; },
    migrationStatus: () => store.migrationStatus(),
  }, { now: () => NOW });
  const store = createStore();
  await store.initialize();
  return { files, v3Path, store, service: createService(store), createStore };
}

function checksumFields(fields) {
  const input = JSON.stringify(fields);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function mutateAndResign(json, mutate) {
  const document = JSON.parse(json);
  mutate(document);
  document.checksum.value = checksumFields(document.fields);
  return JSON.stringify(document);
}

test("field template export defaults to portable field configuration without values or dataset entities", async () => {
  const fixture = createFixture();

  const result = await fixture.service.exportFieldTemplate({
    fieldIds: ["field_affinity"],
    targetSelections: actorMatrix({
      targetId: "actor_t",
      enabled: true,
      includeValue: false,
    }),
  });
  const document = JSON.parse(result.json);

  assert.equal(document.format, "operit-mvu-field-template");
  assert.equal(document.schemaVersion, 1);
  assert.deepEqual(Object.keys(document).sort(), [
    "checksum", "exportedAt", "fields", "format", "schemaVersion",
  ]);
  assert.equal(document.fields.length, 1);
  assert.equal(document.fields[0].sourceFieldId, "field_affinity");
  assert.equal("id" in document.fields[0].definition, false);
  assert.equal("bindingIds" in document.fields[0].definition, false);
  assert.deepEqual(document.fields[0].sourceTargets, [{
    kind: "actor",
    sourceId: "actor_t",
    name: "角色 T",
    enabled: true,
  }]);
  assert.deepEqual(result.summary, {
    fieldCount: 1,
    targetCount: 1,
    valueCount: 0,
  });
  const forbiddenKeys = ["records", "rules", "conditions", "effects", "stateValues"];
  const keys = collectObjectKeys(document);
  for (const key of forbiddenKeys) assert.equal(keys.has(key), false, `forbidden key ${key}`);
});

test("field template export carries values only for explicitly selected actor targets", async () => {
  const fixture = createFixture();
  const before = fixture.current();
  before.fields[0].bindingIds = ["actor_t", "actor_u"];
  before.stateValues["character:actor_t"] = { field_affinity: 42 };
  before.stateValues["character:actor_u"] = { field_affinity: 77 };

  // Recreate the service around the exact state so export still exercises only
  // the public API; production receives no test-only setter.
  let current = structuredClone(before);
  const service = new MvuQueryService({
    async readV3() { return { revision: current.revision, dataset: structuredClone(current) }; },
    async transactV3(expectedRevision, next) {
      current = structuredClone(next);
      current.revision = expectedRevision + 1;
      return { revision: current.revision, dataset: structuredClone(current) };
    },
    async queryCommittedRecords() { return { items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null }; },
    async listActors() { return [
      { characterId: "actor_t", name: "角色 T", avatarUri: null, enabled: true },
      { characterId: "actor_u", name: "角色 U", avatarUri: null, enabled: true },
    ]; },
    async listGroups() { return []; },
    async activeContext() { return { chatId: "chat_current", actorId: "actor_t", groupId: null, actorName: "角色 T" }; },
    async migrationStatus() { return { mode: "v3", source: "existing" }; },
  }, { now: () => NOW });

  const result = await service.exportFieldTemplate({
    fieldIds: ["field_affinity"],
    targetSelections: actorMatrix(
      { targetId: "actor_t", enabled: true, includeValue: true },
      { targetId: "actor_u", enabled: true, includeValue: false },
    ),
  });
  const targets = JSON.parse(result.json).fields[0].sourceTargets;

  assert.deepEqual(targets, [
    { kind: "actor", sourceId: "actor_t", name: "角色 T", enabled: true, value: 42 },
    { kind: "actor", sourceId: "actor_u", name: "角色 U", enabled: true },
  ]);
  assert.equal(JSON.stringify(result).includes("77"), false);
  assert.equal(result.summary.valueCount, 1);
});

test("export at every portable field and stage boundary round-trips through the strict preview parser", async () => {
  const data = createFixture().dataset;
  const sourceFieldId = `f${"x".repeat(255)}`;
  const field = {
    ...structuredClone(data.fields[0]),
    id: sourceFieldId,
    name: "N".repeat(512),
    description: "D".repeat(4_096),
    minimum: 0,
    maximum: 99,
    step: 1,
    initialValue: 0,
    icon: "I".repeat(512),
    themeColor: "C".repeat(512),
    scope: "global",
    bindingIds: [],
    ai: { ...data.fields[0].ai, prompt: "P".repeat(4_096) },
    stages: Array.from({ length: 100 }, (_, index) => ({
      id: `stage_${String(index).padStart(3, "0")}`,
      name: "S".repeat(512),
      description: "E".repeat(4_096),
      threshold: index,
    })),
  };
  data.fields = [field];
  data.linkRules = [];
  data.conditions = [];
  data.rules = [];
  data.effectGroups = [];
  data.activeEffects = [];
  data.stateValues = {};
  data.lastSettled = {};
  data.turnCounters = {};
  assert.doesNotThrow(() => assertMvuDatasetV3(data));
  const source = createServiceFrom(data);

  const exported = await source.service.exportFieldTemplate({ fieldIds: [sourceFieldId], targetSelections: [] });
  const preview = await source.service.previewFieldTemplateImport({ json: exported.json });
  assert.equal(preview.valid, true);
  assert.equal(preview.fields[0].sourceFieldId, sourceFieldId);
  assert.equal(preview.fields[0].config.stages, 100);
  assert.equal(Buffer.byteLength(exported.json, "utf8") <= 1_048_576, true);
});

test("export rejects model-valid IDs, text, stages, field counts, and target counts beyond portable parser limits", async () => {
  const isolatedDataset = (fields) => {
    const data = createFixture().dataset;
    data.fields = fields;
    data.pendingBootstrapFieldIds = [];
    data.linkRules = [];
    data.conditions = [];
    data.rules = [];
    data.effectGroups = [];
    data.activeEffects = [];
    data.stateValues = {};
    data.lastSettled = {};
    data.turnCounters = {};
    assert.doesNotThrow(() => assertMvuDatasetV3(data));
    return data;
  };
  const globalField = (overrides = {}) => ({
    ...structuredClone(createFixture().dataset.fields[0]),
    scope: "global",
    bindingIds: [],
    ...overrides,
  });
  const overlongId = `f${"x".repeat(256)}`;
  const idData = isolatedDataset([globalField({ id: overlongId })]);
  const textData = isolatedDataset([globalField({ name: "N".repeat(513) })]);
  const stageData = isolatedDataset([globalField({
    maximum: 100,
    stages: Array.from({ length: 101 }, (_, index) => ({
      id: `stage_${index}`,
      name: `Stage ${index}`,
      description: "",
      threshold: index,
    })),
  })]);
  const fieldCountData = isolatedDataset(Array.from({ length: 101 }, (_, index) =>
    globalField({ id: `field_limit_${index}`, name: `Field ${index}`, order: index })));
  const actorIds = Array.from({ length: 1_001 }, (_, index) => `actor_limit_${index}`);
  const targetData = isolatedDataset([{
    ...globalField(),
    scope: "character",
    bindingIds: actorIds,
  }]);
  const capture = async (operation) => {
    try {
      await operation();
      return "resolved";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  const outcomes = await Promise.all([
    capture(() => createServiceFrom(idData).service.exportFieldTemplate({ fieldIds: [overlongId], targetSelections: [] })),
    capture(() => createServiceFrom(textData).service.exportFieldTemplate({ fieldIds: ["field_affinity"], targetSelections: [] })),
    capture(() => createServiceFrom(stageData).service.exportFieldTemplate({ fieldIds: ["field_affinity"], targetSelections: [] })),
    capture(() => createServiceFrom(fieldCountData).service.exportFieldTemplate({
      fieldIds: fieldCountData.fields.map(({ id }) => id),
      targetSelections: [],
    })),
    capture(() => createServiceFrom(targetData, { actors: actorIds.map((characterId) => ({
      characterId, name: characterId, enabled: true,
    })) }).service.exportFieldTemplate({
      fieldIds: ["field_affinity"],
      targetSelections: [{ fieldId: "field_affinity", targets: actorIds.map((targetId) => ({
        targetId, enabled: true, includeValue: false,
      })) }],
    })),
  ]);
  assert.deepEqual(outcomes, [
    "MVU_FIELD_TEMPLATE_FIELD_INVALID",
    "MVU_FIELD_TEMPLATE_TEXT_LIMIT",
    "MVU_FIELD_TEMPLATE_STAGE_LIMIT",
    "MVU_FIELD_TEMPLATE_INVALID",
    "MVU_FIELD_TEMPLATE_TARGET_LIMIT",
  ]);
});

test("field template preview is deterministic and reports conflicts and readable mapping needs without mutation", async () => {
  const fixture = createFixture();
  const exported = await fixture.service.exportFieldTemplate({
    fieldIds: ["field_affinity"],
    targetSelections: actorMatrix({ targetId: "actor_t", enabled: true, includeValue: false }),
  });
  const before = fixture.current();

  const first = await fixture.service.previewFieldTemplateImport({ json: exported.json });
  const second = await fixture.service.previewFieldTemplateImport({ json: exported.json });

  assert.deepEqual(second, first);
  assert.equal(first.valid, true);
  assert.equal(first.revision, before.revision);
  assert.deepEqual(first.fields.map((field) => ({
    sourceFieldId: field.sourceFieldId,
    name: field.name,
    conflict: field.conflict,
    proposedCopyId: field.proposedCopyId,
  })), [{
    sourceFieldId: "field_affinity",
    name: "Affinity",
    conflict: "id",
    proposedCopyId: "field_affinity_copy",
  }]);
  assert.deepEqual(first.mappingNeeds, [{
    fieldId: "field_affinity",
    scope: "character",
    requiresLocalTargets: false,
    templateValueAvailable: false,
    sourceTargets: [{
      kind: "actor",
      sourceId: "actor_t",
      name: "角色 T",
      hasValue: false,
      requiresSearch: false,
      suggestedTarget: { targetId: "actor_t", name: "角色 T", reason: "stable_id" },
    }],
  }]);
  assert.equal(fixture.transactionCount(), 0);
  assert.deepEqual(fixture.current(), before);
});

test("multi-field create-copy reserves exact source IDs before allocating deterministic collision-safe copies", async () => {
  const sourceData = createFixture().dataset;
  const foo = {
    ...structuredClone(sourceData.fields[0]),
    id: "foo",
    name: "Foo",
    scope: "global",
    bindingIds: [],
    order: 0,
  };
  const fooCopy = { ...structuredClone(foo), id: "foo_copy", name: "Foo copy", order: 1 };
  sourceData.fields = [foo, fooCopy];
  sourceData.linkRules = [];
  sourceData.conditions = [];
  sourceData.rules = [];
  sourceData.effectGroups = [];
  sourceData.activeEffects = [];
  sourceData.stateValues = {};
  sourceData.lastSettled = {};
  sourceData.turnCounters = {};
  const source = createServiceFrom(sourceData);
  const exported = await source.service.exportFieldTemplate({
    fieldIds: ["foo_copy", "foo"],
    targetSelections: [],
  });

  const targetData = structuredClone(sourceData);
  targetData.fields = [structuredClone(foo)];
  const target = createServiceFrom(targetData);
  const preview = await target.service.previewFieldTemplateImport({ json: exported.json });
  assert.deepEqual(preview.fields.map(({ sourceFieldId, conflict, proposedCopyId }) => ({
    sourceFieldId, conflict, proposedCopyId,
  })), [
    { sourceFieldId: "foo", conflict: "id", proposedCopyId: "foo_copy_2" },
    { sourceFieldId: "foo_copy", conflict: "none", proposedCopyId: "foo_copy" },
  ]);
  assert.equal(target.transactionCount(), 0);

  const result = await target.service.importFieldTemplate({
    json: exported.json,
    expectedRevision: preview.revision,
    decisions: { fields: [
      { sourceFieldId: "foo", mappings: [] },
      { sourceFieldId: "foo_copy", mappings: [] },
    ] },
  });
  assert.deepEqual(result.summary.created, ["foo_copy_2", "foo_copy"]);
  assert.equal(target.transactionCount(), 1);
  assert.deepEqual(target.current().fields.map(({ id }) => id), ["foo", "foo_copy_2", "foo_copy"]);
  assert.equal(new Set(target.current().fields.map(({ id }) => id)).size, 3);
});

test("create-copy import maps one source actor to multiple explicitly enabled local actors in one transaction", async () => {
  const fixture = createFixture();
  const state = fixture.current();
  state.stateValues["character:actor_t"] = { field_affinity: 42 };
  let sourceState = structuredClone(state);
  const exporter = new MvuQueryService({
    async readV3() { return { revision: sourceState.revision, dataset: structuredClone(sourceState) }; },
    async transactV3() { throw new Error("UNEXPECTED_EXPORT_WRITE"); },
    async queryCommittedRecords() { return { items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null }; },
    async listActors() { return [{ characterId: "actor_t", name: "角色 T", enabled: true }]; },
    async listGroups() { return []; },
    async activeContext() { return { chatId: "chat_source", actorId: "actor_t", groupId: null, actorName: "角色 T" }; },
    async migrationStatus() { return { mode: "v3", source: "existing" }; },
  }, { now: () => NOW });
  const exported = await exporter.exportFieldTemplate({
    fieldIds: ["field_affinity"],
    targetSelections: actorMatrix({ targetId: "actor_t", enabled: true, includeValue: true }),
  });

  const result = await fixture.service.importFieldTemplate({
    json: exported.json,
    expectedRevision: fixture.dataset.revision,
    decisions: { fields: [{
      sourceFieldId: "field_affinity",
      mappings: [{
        sourceTargetId: "actor_t",
        targets: [
          { targetId: "actor_t", enabled: true, valuePolicy: "template_value" },
          { targetId: "actor_u", enabled: true, valuePolicy: "template_value" },
        ],
      }],
    }] },
  });

  assert.equal(result.revision, fixture.dataset.revision + 1);
  assert.deepEqual(result.summary, {
    created: ["field_affinity_copy"], updated: [], replaced: [], skippedTargets: 0, valueWrites: 2,
  });
  assert.equal(fixture.transactionCount(), 1);
  const imported = fixture.current().fields.find((field) => field.id === "field_affinity_copy");
  assert.deepEqual(imported.bindingIds, ["actor_t", "actor_u"]);
  assert.equal(fixture.current().stateValues["character:actor_t"].field_affinity_copy, 42);
  assert.equal(fixture.current().stateValues["character:actor_u"].field_affinity_copy, 42);
});

test("stale revision and an incomplete mapping reject before the atomic store write", async () => {
  const fixture = createFixture();
  const exported = await fixture.service.exportFieldTemplate({
    fieldIds: ["field_affinity"],
    targetSelections: actorMatrix({ targetId: "actor_t", enabled: true, includeValue: false }),
  });
  const before = fixture.current();
  const request = {
    json: exported.json,
    decisions: { fields: [{ sourceFieldId: "field_affinity", mappings: [] }] },
  };

  await assert.rejects(
    fixture.service.importFieldTemplate({ ...request, expectedRevision: before.revision + 1 }),
    /MVU_STALE_REVISION/,
  );
  await assert.rejects(
    fixture.service.importFieldTemplate({ ...request, expectedRevision: before.revision }),
    /MVU_FIELD_TEMPLATE_MAPPING_MISSING/,
  );
  assert.equal(fixture.transactionCount(), 0);
  assert.deepEqual(fixture.current(), before);
});

test("update preserves local bindings and values while replace applies the explicit mapping and initial-value policy", async () => {
  const updateFixture = createFixture();
  const exported = await updateFixture.service.exportFieldTemplate({
    fieldIds: ["field_affinity"],
    targetSelections: actorMatrix({ targetId: "actor_t", enabled: true, includeValue: false }),
  });
  const local = updateFixture.current();
  local.fields[0].name = "Local name";
  local.fields[0].bindingIds = ["actor_u"];
  local.stateValues["character:actor_u"] = { field_affinity: 77 };
  let current = structuredClone(local);
  let writes = 0;
  const service = new MvuQueryService({
    async readV3() { return { revision: current.revision, dataset: structuredClone(current) }; },
    async transactV3(expectedRevision, next) { writes += 1; current = structuredClone(next); current.revision = expectedRevision + 1; return { revision: current.revision, dataset: structuredClone(current) }; },
    async queryCommittedRecords() { return { items: [], loadedCount: 0, totalCount: 0, hasMore: false, nextOffset: null }; },
    async listActors() { return [
      { characterId: "actor_t", name: "角色 T", enabled: true },
      { characterId: "actor_u", name: "角色 U", enabled: true },
    ]; },
    async listGroups() { return []; },
    async activeContext() { return { chatId: "chat_current", actorId: "actor_t", groupId: null, actorName: "角色 T" }; },
    async migrationStatus() { return { mode: "v3", source: "existing" }; },
  }, { now: () => NOW });

  const updated = await service.importFieldTemplate({
    json: exported.json,
    expectedRevision: current.revision,
    decisions: { fields: [{ sourceFieldId: "field_affinity", strategy: "update", mappings: [] }] },
  });
  assert.deepEqual(updated.summary.updated, ["field_affinity"]);
  assert.equal(current.fields[0].name, "Affinity");
  assert.deepEqual(current.fields[0].bindingIds, ["actor_u"]);
  assert.equal(current.stateValues["character:actor_u"].field_affinity, 77);

  const replaced = await service.importFieldTemplate({
    json: exported.json,
    expectedRevision: current.revision,
    decisions: { fields: [{
      sourceFieldId: "field_affinity",
      strategy: "replace",
      mappings: [{
        sourceTargetId: "actor_t",
        targets: [{ targetId: "actor_u", enabled: true, valuePolicy: "field_initial" }],
      }],
    }] },
  });
  assert.deepEqual(replaced.summary.replaced, ["field_affinity"]);
  assert.deepEqual(current.fields[0].bindingIds, ["actor_u"]);
  assert.equal(current.stateValues["character:actor_u"].field_affinity, 0);
  assert.equal(writes, 2);
});

test("cross-scope update is unavailable in preview and rejects without reinterpreting local bindings or values", async () => {
  for (const importedScope of ["group", "global", "chat"]) {
    const sourceData = createFixture().dataset;
    sourceData.fields[0] = {
      ...sourceData.fields[0],
      scope: importedScope,
      bindingIds: [],
    };
    sourceData.stateValues = {};
    const source = createServiceFrom(sourceData);
    const exported = await source.service.exportFieldTemplate({
      fieldIds: ["field_affinity"],
      targetSelections: [],
    });

    const localData = createFixture().dataset;
    localData.fields[0].bindingIds = ["actor_t"];
    localData.stateValues = { "character:actor_t": { field_affinity: 37 } };
    const target = createServiceFrom(localData, {
      actors: [{ characterId: "actor_t", name: "角色 T", enabled: true }],
      groups: [{ characterGroupId: "group_main", name: "主群组", avatarUri: null }],
    });
    const before = target.current();
    const preview = await target.service.previewFieldTemplateImport({ json: exported.json });
    assert.deepEqual(preview.fields[0].updateCompatibility, {
      available: false,
      localScope: "character",
      reason: "scope_mismatch",
    });
    await assert.rejects(target.service.importFieldTemplate({
      json: exported.json,
      expectedRevision: preview.revision,
      decisions: { fields: [{ sourceFieldId: "field_affinity", strategy: "update", mappings: [] }] },
    }), /MVU_FIELD_TEMPLATE_UPDATE_SCOPE_MISMATCH/);
    assert.equal(target.transactionCount(), 0, importedScope);
    assert.deepEqual(target.current(), before, importedScope);
  }
});

test("definition-only character templates require explicit unbound targets and allow every target to be disabled", async () => {
  const source = createFixture();
  const exported = await source.service.exportFieldTemplate({
    fieldIds: ["field_affinity"],
    targetSelections: [],
  });
  const targetData = createFixture().dataset;
  targetData.fields = [];
  targetData.stateValues = {};
  const target = createServiceFrom(targetData, {
    actors: [
      { characterId: "actor_t", name: "角色 T", enabled: true },
      { characterId: "actor_u", name: "角色 U", enabled: true },
    ],
    groups: [{ characterGroupId: "group_main", name: "主群组", avatarUri: null }],
  });
  const preview = await target.service.previewFieldTemplateImport({ json: exported.json });
  assert.deepEqual(preview.mappingNeeds, [{
    fieldId: "field_affinity",
    scope: "character",
    requiresLocalTargets: true,
    templateValueAvailable: false,
    sourceTargets: [],
  }]);
  await assert.rejects(target.service.importFieldTemplate({
    json: exported.json,
    expectedRevision: preview.revision,
    decisions: { fields: [{ sourceFieldId: "field_affinity", mappings: [] }] },
  }), /MVU_FIELD_TEMPLATE_UNBOUND_TARGETS_REQUIRED/);
  const result = await target.service.importFieldTemplate({
    json: exported.json,
    expectedRevision: preview.revision,
    decisions: { fields: [{
      sourceFieldId: "field_affinity",
      mappings: [],
      unboundTargets: [
        { targetId: "actor_t", enabled: false, valuePolicy: "field_initial" },
        { targetId: "actor_u", enabled: false, valuePolicy: "keep_existing" },
      ],
    }] },
  });
  assert.deepEqual(result.summary, {
    created: ["field_affinity"], updated: [], replaced: [], skippedTargets: 2, valueWrites: 0,
  });
  assert.deepEqual(target.current().fields[0].bindingIds, []);
  assert.deepEqual(target.current().stateValues, {});
  assert.equal(target.transactionCount(), 1);
});

test("definition-only group targets import explicitly and reject template values, duplicates, cross-kind, or missing IDs atomically", async () => {
  const sourceData = createFixture().dataset;
  sourceData.fields[0] = { ...sourceData.fields[0], id: "field_group", scope: "group", bindingIds: [] };
  const source = createServiceFrom(sourceData);
  const exported = await source.service.exportFieldTemplate({ fieldIds: ["field_group"], targetSelections: [] });
  const targetData = createFixture().dataset;
  targetData.fields = [];
  targetData.stateValues = {};
  const target = createServiceFrom(targetData, {
    actors: [{ characterId: "actor_t", name: "角色 T", enabled: true }],
    groups: [
      { characterGroupId: "group_alpha", name: "Alpha", avatarUri: null },
      { characterGroupId: "group_beta", name: "Beta", avatarUri: null },
    ],
  });
  const revision = targetData.revision;
  const request = (unboundTargets) => ({
    json: exported.json,
    expectedRevision: revision,
    decisions: { fields: [{ sourceFieldId: "field_group", mappings: [], unboundTargets }] },
  });
  await assert.rejects(target.service.importFieldTemplate(request([
    { targetId: "group_alpha", enabled: true, valuePolicy: "template_value" },
  ])), /MVU_FIELD_TEMPLATE_UNBOUND_TEMPLATE_VALUE_INVALID/);
  await assert.rejects(target.service.importFieldTemplate(request([
    { targetId: "group_alpha", enabled: true, valuePolicy: "field_initial" },
    { targetId: "group_alpha", enabled: false, valuePolicy: "field_initial" },
  ])), /MVU_FIELD_TEMPLATE_UNBOUND_TARGET_DUPLICATE/);
  for (const targetId of ["actor_t", "group_missing"]) {
    await assert.rejects(target.service.importFieldTemplate(request([
      { targetId, enabled: true, valuePolicy: "field_initial" },
    ])), /MVU_FIELD_TEMPLATE_UNBOUND_TARGET_INVALID/);
  }
  assert.equal(target.transactionCount(), 0);
  assert.deepEqual(target.current(), targetData);

  const committed = await target.service.importFieldTemplate(request([
    { targetId: "group_alpha", enabled: true, valuePolicy: "field_initial" },
    { targetId: "group_beta", enabled: false, valuePolicy: "keep_existing" },
  ]));
  assert.equal(committed.summary.valueWrites, 1);
  assert.deepEqual(target.current().fields[0].bindingIds, ["group_alpha"]);
  assert.equal(target.current().stateValues["group:group_alpha"].field_group, 0);
});

test("unbound targets are forbidden for mapped, global, chat, and update decisions", async () => {
  const fixture = createFixture();
  const mapped = await fixture.service.exportFieldTemplate({
    fieldIds: ["field_affinity"],
    targetSelections: actorMatrix({ targetId: "actor_t", enabled: true, includeValue: false }),
  });
  const unboundTargets = [{ targetId: "actor_t", enabled: true, valuePolicy: "field_initial" }];
  await assert.rejects(fixture.service.importFieldTemplate({
    json: mapped.json,
    expectedRevision: fixture.dataset.revision,
    decisions: { fields: [{ sourceFieldId: "field_affinity", mappings: [{
      sourceTargetId: "actor_t", targets: unboundTargets,
    }], unboundTargets }] },
  }), /MVU_FIELD_TEMPLATE_UNBOUND_TARGETS_INAPPROPRIATE/);
  await assert.rejects(fixture.service.importFieldTemplate({
    json: mapped.json,
    expectedRevision: fixture.dataset.revision,
    decisions: { fields: [{ sourceFieldId: "field_affinity", strategy: "update", mappings: [], unboundTargets }] },
  }), /MVU_FIELD_TEMPLATE_UNBOUND_TARGETS_INAPPROPRIATE/);
  for (const scope of ["global", "chat"]) {
    const data = createFixture().dataset;
    data.fields[0] = { ...data.fields[0], scope, bindingIds: [] };
    const source = createServiceFrom(data);
    const exported = await source.service.exportFieldTemplate({ fieldIds: ["field_affinity"], targetSelections: [] });
    await assert.rejects(fixture.service.importFieldTemplate({
      json: exported.json,
      expectedRevision: fixture.dataset.revision,
      decisions: { fields: [{ sourceFieldId: "field_affinity", mappings: [], unboundTargets }] },
    }), /MVU_FIELD_TEMPLATE_UNBOUND_TARGETS_INAPPROPRIATE/);
  }
  assert.equal(fixture.transactionCount(), 0);
});

test("group templates export readable group metadata and map one source group only to explicit local groups", async () => {
  const base = createFixture().dataset;
  base.fields[0] = {
    ...base.fields[0],
    id: "field_group_morale",
    name: "Group morale",
    scope: "group",
    bindingIds: ["group_source"],
  };
  base.stateValues = { "group:group_source": { field_group_morale: 64 } };
  const source = createServiceFrom(base, {
    groups: [{ characterGroupId: "group_source", name: "远征队", avatarUri: null }],
  });
  const exported = await source.service.exportFieldTemplate({
    fieldIds: ["field_group_morale"],
    targetSelections: [{ fieldId: "field_group_morale", targets: [
      { targetId: "group_source", enabled: true, includeValue: true },
    ] }],
  });
  const document = JSON.parse(exported.json);
  assert.deepEqual(document.fields[0].sourceTargets, [{
    kind: "group", sourceId: "group_source", name: "远征队", enabled: true, value: 64,
  }]);

  const targetData = createFixture().dataset;
  targetData.fields = [];
  targetData.stateValues = {};
  const target = createServiceFrom(targetData, {
    groups: [
      { characterGroupId: "group_alpha", name: "Alpha", avatarUri: null },
      { characterGroupId: "group_beta", name: "Beta", avatarUri: null },
      { characterGroupId: "group_unselected", name: "Other", avatarUri: null },
      { characterGroupId: "group_same_name", name: "远征队", avatarUri: null },
    ],
  });
  const preview = await target.service.previewFieldTemplateImport({ json: exported.json });
  assert.deepEqual(preview.mappingNeeds[0].sourceTargets[0].suggestedTarget, {
    targetId: "group_same_name", name: "远征队", reason: "unique_name",
  });
  await target.service.importFieldTemplate({
    json: exported.json,
    expectedRevision: targetData.revision,
    decisions: { fields: [{ sourceFieldId: "field_group_morale", mappings: [{
      sourceTargetId: "group_source",
      targets: [
        { targetId: "group_alpha", enabled: true, valuePolicy: "template_value" },
        { targetId: "group_beta", enabled: false, valuePolicy: "template_value" },
      ],
    }] }] },
  });
  assert.deepEqual(target.current().fields[0].bindingIds, ["group_alpha"]);
  assert.equal(target.current().stateValues["group:group_alpha"].field_group_morale, 64);
  assert.equal(target.current().stateValues["group:group_beta"], undefined);
  assert.equal(target.current().fields[0].bindingIds.includes("group_unselected"), false);
  assert.equal(target.transactionCount(), 1);
});

test("global templates have no actor matrix and import without actor or group broadening", async () => {
  const data = createFixture().dataset;
  data.fields[0] = { ...data.fields[0], id: "field_world", scope: "global", bindingIds: [] };
  data.stateValues = { global: { field_world: 12 } };
  const source = createServiceFrom(data, {
    actors: [{ characterId: "actor_secret", name: "Secret", enabled: true }],
    groups: [{ characterGroupId: "group_secret", name: "Secret group", avatarUri: null }],
  });
  const exported = await source.service.exportFieldTemplate({
    fieldIds: ["field_world"],
    targetSelections: [],
  });
  const document = JSON.parse(exported.json);
  assert.deepEqual(document.fields[0].sourceTargets, []);
  assert.equal(exported.json.includes("actor_secret"), false);
  assert.equal(exported.json.includes("group_secret"), false);
  const preview = await source.service.previewFieldTemplateImport({ json: exported.json });
  assert.deepEqual(preview.mappingNeeds, []);

  const targetData = structuredClone(data);
  targetData.fields = [];
  targetData.stateValues = {};
  const target = createServiceFrom(targetData);
  await target.service.importFieldTemplate({
    json: exported.json,
    expectedRevision: targetData.revision,
    decisions: { fields: [{ sourceFieldId: "field_world", mappings: [] }] },
  });
  assert.deepEqual(target.current().fields[0].bindingIds, []);
  assert.deepEqual(target.current().stateValues, {});
});

test("chat templates never export saved chat UUIDs and bind only the current importing session", async () => {
  const data = createFixture().dataset;
  data.fields[0] = {
    ...data.fields[0], id: "field_chat_tone", scope: "chat", bindingIds: ["saved_chat_uuid_private"],
  };
  data.stateValues = { "chat:saved_chat_uuid_private": { field_chat_tone: 88 } };
  const source = createServiceFrom(data, {
    context: { chatId: "source_session_private", actorId: "actor_t", groupId: null, actorName: "T" },
  });
  const exported = await source.service.exportFieldTemplate({
    fieldIds: ["field_chat_tone"],
    targetSelections: [],
  });
  assert.equal(exported.json.includes("saved_chat_uuid_private"), false);
  assert.equal(exported.json.includes("source_session_private"), false);
  assert.deepEqual((await source.service.previewFieldTemplateImport({ json: exported.json })).mappingNeeds, []);

  const targetData = structuredClone(data);
  targetData.fields = [];
  targetData.stateValues = {};
  const target = createServiceFrom(targetData, {
    context: { chatId: "current_import_session", actorId: "actor_u", groupId: null, actorName: "U" },
  });
  await target.service.importFieldTemplate({
    json: exported.json,
    expectedRevision: targetData.revision,
    decisions: { fields: [{ sourceFieldId: "field_chat_tone", mappings: [] }] },
  });
  assert.deepEqual(target.current().fields[0].bindingIds, ["current_import_session"]);
  assert.equal(JSON.stringify(target.current().fields[0]).includes("saved_chat_uuid_private"), false);
});

test("preview suggests exact stable IDs before unique names and requires search for duplicate or missing names", async () => {
  const sourceData = createFixture().dataset;
  sourceData.fields[0].bindingIds = ["actor_exact", "actor_unique", "actor_duplicate", "actor_missing"];
  const source = createServiceFrom(sourceData, { actors: [
    { characterId: "actor_exact", name: "Renamed source", enabled: true },
    { characterId: "actor_unique", name: "Unique name", enabled: true },
    { characterId: "actor_duplicate", name: "Duplicate name", enabled: true },
    { characterId: "actor_missing", name: "Missing name", enabled: true },
  ] });
  const exported = await source.service.exportFieldTemplate({
    fieldIds: ["field_affinity"],
    targetSelections: actorMatrix(
      { targetId: "actor_exact", enabled: true, includeValue: false },
      { targetId: "actor_unique", enabled: true, includeValue: false },
      { targetId: "actor_duplicate", enabled: true, includeValue: false },
      { targetId: "actor_missing", enabled: true, includeValue: false },
    ),
  });
  const target = createServiceFrom(createFixture().dataset, { actors: [
    { characterId: "actor_exact", name: "Local exact ID wins", enabled: true },
    { characterId: "local_unique", name: "Unique name", enabled: true },
    { characterId: "local_duplicate_a", name: "Duplicate name", enabled: true },
    { characterId: "local_duplicate_b", name: "Duplicate name", enabled: true },
  ] });
  const preview = await target.service.previewFieldTemplateImport({ json: exported.json });
  const suggestions = Object.fromEntries(preview.mappingNeeds[0].sourceTargets.map((entry) => [entry.sourceId, entry]));
  assert.deepEqual(suggestions.actor_exact.suggestedTarget, {
    targetId: "actor_exact", name: "Local exact ID wins", reason: "stable_id",
  });
  assert.equal(suggestions.actor_exact.requiresSearch, false);
  assert.deepEqual(suggestions.actor_unique.suggestedTarget, {
    targetId: "local_unique", name: "Unique name", reason: "unique_name",
  });
  assert.equal(suggestions.actor_unique.requiresSearch, false);
  assert.equal("suggestedTarget" in suggestions.actor_duplicate, false);
  assert.equal(suggestions.actor_duplicate.requiresSearch, true);
  assert.equal("suggestedTarget" in suggestions.actor_missing, false);
  assert.equal(suggestions.actor_missing.requiresSearch, true);
  assert.equal(target.transactionCount(), 0, "suggestions are preview-only");
});

test("preview reports deterministic range and step adjustments before importing selected target values", async () => {
  const fixture = createFixture();
  const exported = await fixture.service.exportFieldTemplate({
    fieldIds: ["field_affinity"],
    targetSelections: actorMatrix({ targetId: "actor_t", enabled: true, includeValue: false }),
  });
  const adjustedJson = mutateAndResign(exported.json, (document) => {
    document.fields[0].sourceTargets[0].value = 1000;
  });

  const preview = await fixture.service.previewFieldTemplateImport({ json: adjustedJson });
  assert.deepEqual(preview.mappingNeeds[0].sourceTargets[0].valueAdjustment, {
    from: 1000,
    to: 100,
    reason: "clamp",
  });
  const result = await fixture.service.importFieldTemplate({
    json: adjustedJson,
    expectedRevision: preview.revision,
    decisions: { fields: [{ sourceFieldId: "field_affinity", mappings: [{
      sourceTargetId: "actor_t",
      targets: [{ targetId: "actor_u", enabled: true, valuePolicy: "template_value" }],
    }] }] },
  });
  assert.equal(result.summary.valueWrites, 1);
  assert.equal(fixture.current().stateValues["character:actor_u"].field_affinity_copy, 100);
});

test("invalid and duplicate mappings, malformed values, and stale preview revisions roll back the whole import", async () => {
  const fixture = createFixture();
  const exported = await fixture.service.exportFieldTemplate({
    fieldIds: ["field_affinity"],
    targetSelections: actorMatrix({ targetId: "actor_t", enabled: true, includeValue: false }),
  });
  const before = fixture.current();
  const duplicate = {
    json: exported.json,
    expectedRevision: before.revision,
    decisions: { fields: [{ sourceFieldId: "field_affinity", mappings: [{
      sourceTargetId: "actor_t",
      targets: [
        { targetId: "actor_u", enabled: true, valuePolicy: "field_initial" },
        { targetId: "actor_u", enabled: true, valuePolicy: "field_initial" },
      ],
    }] }] },
  };
  await assert.rejects(fixture.service.importFieldTemplate(duplicate), /MVU_FIELD_TEMPLATE_MAPPING_DUPLICATE/);
  await assert.rejects(fixture.service.importFieldTemplate({
    ...duplicate,
    decisions: { fields: [{ sourceFieldId: "field_affinity", mappings: [{
      sourceTargetId: "actor_t",
      targets: [{ targetId: "actor_missing", enabled: true, valuePolicy: "field_initial" }],
    }] }] },
  }), /MVU_FIELD_TEMPLATE_MAPPING_TARGET_INVALID/);
  const malformedJson = mutateAndResign(exported.json, (document) => {
    document.fields[0].sourceTargets[0].value = "not-a-number";
  });
  await assert.rejects(fixture.service.previewFieldTemplateImport({ json: malformedJson }), /MVU_FIELD_TEMPLATE_TARGET_INVALID/);

  const preview = await fixture.service.previewFieldTemplateImport({ json: exported.json });
  fixture.advanceRevision();
  await assert.rejects(fixture.service.importFieldTemplate({
    ...duplicate,
    expectedRevision: preview.revision,
    decisions: { fields: [{ sourceFieldId: "field_affinity", mappings: [{
      sourceTargetId: "actor_t",
      targets: [{ targetId: "actor_u", enabled: true, valuePolicy: "field_initial" }],
    }] }] },
  }), /MVU_STALE_REVISION/);
  assert.equal(fixture.transactionCount(), 0);
  assert.deepEqual({ ...fixture.current(), revision: before.revision }, before);
});

test("template parsing rejects checksum tampering, unknown nested keys, oversize input, and bounded count or text abuse", async () => {
  const fixture = createFixture();
  const exported = await fixture.service.exportFieldTemplate({
    fieldIds: ["field_affinity"],
    targetSelections: actorMatrix({ targetId: "actor_t", enabled: true, includeValue: false }),
  });
  const tampered = JSON.parse(exported.json);
  tampered.fields[0].definition.name = "Tampered";
  await assert.rejects(
    fixture.service.previewFieldTemplateImport({ json: JSON.stringify(tampered) }),
    /MVU_FIELD_TEMPLATE_CHECKSUM_MISMATCH/,
  );
  const unknownNested = mutateAndResign(exported.json, (document) => {
    document.fields[0].definition.ai.untrusted = true;
  });
  await assert.rejects(
    fixture.service.previewFieldTemplateImport({ json: unknownNested }),
    /MVU_FIELD_TEMPLATE_UNKNOWN_KEYS/,
  );
  await assert.rejects(
    fixture.service.previewFieldTemplateImport({ json: `{"padding":"${"x".repeat(1_048_576)}"}` }),
    /MVU_FIELD_TEMPLATE_TOO_LARGE/,
  );
  const tooManyFields = mutateAndResign(exported.json, (document) => {
    const seed = document.fields[0];
    document.fields = Array.from({ length: 101 }, (_, index) => ({
      ...structuredClone(seed), sourceFieldId: `field_limit_${index}`,
    }));
  });
  await assert.rejects(
    fixture.service.previewFieldTemplateImport({ json: tooManyFields }),
    /MVU_FIELD_TEMPLATE_INVALID/,
  );
  const textAbuse = mutateAndResign(exported.json, (document) => {
    document.fields[0].sourceTargets[0].name = "x".repeat(513);
  });
  await assert.rejects(
    fixture.service.previewFieldTemplateImport({ json: textAbuse }),
    /MVU_FIELD_TEMPLATE_TEXT_LIMIT/,
  );
  const offStepInitial = mutateAndResign(exported.json, (document) => {
    document.fields[0].definition.initialValue = 0.5;
  });
  await assert.rejects(
    fixture.service.previewFieldTemplateImport({ json: offStepInitial }),
    /MVU_FIELD_TEMPLATE_INITIAL_VALUE_INVALID/,
  );
});

test("copy IDs remain stable and bounded at the maximum portable source-ID length", async () => {
  const data = createFixture().dataset;
  const sourceFieldId = `f${"x".repeat(255)}`;
  data.fields[0] = { ...data.fields[0], id: sourceFieldId };
  const fixture = createServiceFrom(data, {
    actors: [{ characterId: "actor_t", name: "角色 T", enabled: true }],
  });
  const exported = await fixture.service.exportFieldTemplate({
    fieldIds: [sourceFieldId],
    targetSelections: [{ fieldId: sourceFieldId, targets: [
      { targetId: "actor_t", enabled: true, includeValue: false },
    ] }],
  });
  const preview = await fixture.service.previewFieldTemplateImport({ json: exported.json });
  assert.equal(preview.fields[0].conflict, "id");
  assert.equal(preview.fields[0].proposedCopyId.length, 256);
  assert.match(preview.fields[0].proposedCopyId, /^[A-Za-z][A-Za-z0-9_]*_copy$/);
  const imported = await fixture.service.importFieldTemplate({
    json: exported.json,
    expectedRevision: preview.revision,
    decisions: { fields: [{ sourceFieldId, mappings: [{
      sourceTargetId: "actor_t",
      targets: [{ targetId: "actor_t", enabled: true, valuePolicy: "field_initial" }],
    }] }] },
  });
  assert.deepEqual(imported.summary.created, [preview.fields[0].proposedCopyId]);
});

test("export filenames are path-safe and dependency metadata contains only bounded readable omission entries", async () => {
  const fixture = createFixture();
  const data = fixture.current();
  data.fields[0].name = "../../\\evil\u0000字段";
  data.linkRules.push({
    id: "link_affinity_excite",
    sourceFieldId: "field_affinity",
    operator: ">=",
    sourceThreshold: 50,
    targetFieldId: "field_excite",
    effect: { kind: "delta", value: 1 },
    enabled: true,
  });
  data.conditions.push({
    id: "condition_direct_affinity",
    name: "Affinity threshold",
    description: "Nested direct reference",
    enabled: true,
    expression: { kind: "and", children: [
      { kind: "predicate", predicate: { kind: "sender", senders: ["user"] } },
      { kind: "or", children: [{
        kind: "predicate",
        predicate: { kind: "field_comparison", fieldId: "field_affinity", operator: ">=", value: 50 },
      }] },
    ] },
    createdAt: "2033-05-18T03:33:20.000Z",
    updatedAt: "2033-05-18T03:33:20.000Z",
  });
  const source = createServiceFrom(data, {
    actors: [{ characterId: "actor_t", name: "角色 T", enabled: true }],
  });
  const exported = await source.service.exportFieldTemplate({
    fieldIds: ["field_affinity"],
    targetSelections: actorMatrix({ targetId: "actor_t", enabled: true, includeValue: false }),
  });
  assert.match(exported.fileName, /^operit-mvu-field-template-[a-z0-9-]+-\d{8}-\d{6}Z\.json$/);
  assert.equal(exported.fileName.includes(".."), false);
  assert.equal(/[\\/\u0000]/.test(exported.fileName), false);
  const document = JSON.parse(exported.json);
  assert.deepEqual(Object.keys(document.fields[0].omittedDependencies).sort(), [
    "items", "totalCount", "truncated",
  ]);
  assert.equal(document.fields[0].omittedDependencies.totalCount, 5);
  assert.equal(document.fields[0].omittedDependencies.truncated, false);
  assert.deepEqual(document.fields[0].omittedDependencies.items.map(({ kind, sourceId, readableName }) => ({
    kind, sourceId, readableName,
  })), [
    { kind: "condition", sourceId: "condition_auto_positive", readableName: "Positive interaction condition" },
    { kind: "condition", sourceId: "condition_direct_affinity", readableName: "Affinity threshold" },
    { kind: "effect_group", sourceId: "effect_group_effect_warm", readableName: "Migrated effect effect_warm" },
    { kind: "link_rule", sourceId: "link_affinity_excite", readableName: "../../\\evil\u0000字段 → Excitement" },
    { kind: "rule", sourceId: "auto_positive", readableName: "Positive interaction" },
  ]);
  const forbidden = new Set(["records", "rules", "conditions", "effects", "effectGroups", "dependencies"]);
  for (const key of collectObjectKeys(document)) assert.equal(forbidden.has(key), false, `forbidden entity key ${key}`);
  for (const key of ["actions", "expression", "fieldEffects", "operations", "conditionId"]) {
    assert.equal(collectObjectKeys(document).has(key), false, `dependency payload key ${key}`);
  }
  const preview = await source.service.previewFieldTemplateImport({ json: exported.json });
  assert.deepEqual(preview.omittedDependencies, [{
    fieldId: "field_affinity",
    totalCount: 5,
    truncated: false,
    items: document.fields[0].omittedDependencies.items,
  }]);
  assert.deepEqual(preview.invalidReferences, [
    "OMITTED_DEPENDENCY:field_affinity:condition:condition_auto_positive",
    "OMITTED_DEPENDENCY:field_affinity:condition:condition_direct_affinity",
    "OMITTED_DEPENDENCY:field_affinity:effect_group:effect_group_effect_warm",
    "OMITTED_DEPENDENCY:field_affinity:link_rule:link_affinity_excite",
    "OMITTED_DEPENDENCY:field_affinity:rule:auto_positive",
  ]);
});

test("omitted dependency metadata is deterministically bounded and strict about keys, counts, and text", async () => {
  const data = createFixture().dataset;
  data.linkRules = Array.from({ length: 205 }, (_, index) => ({
    id: `link_limit_${String(index).padStart(3, "0")}`,
    sourceFieldId: "field_affinity",
    operator: ">=",
    sourceThreshold: index % 100,
    targetFieldId: "field_excite",
    effect: { kind: "delta", value: 1 },
    enabled: true,
  }));
  const source = createServiceFrom(data, {
    actors: [{ characterId: "actor_t", name: "角色 T", enabled: true }],
  });
  const exported = await source.service.exportFieldTemplate({
    fieldIds: ["field_affinity"],
    targetSelections: [],
  });
  const dependencies = JSON.parse(exported.json).fields[0].omittedDependencies;
  assert.equal(dependencies.totalCount, 208);
  assert.equal(dependencies.truncated, true);
  assert.equal(dependencies.items.length, 200);
  assert.deepEqual(dependencies.items[0], {
    kind: "condition", sourceId: "condition_auto_positive", readableName: "Positive interaction condition",
  });
  assert.deepEqual(dependencies.items.at(-1), {
    kind: "link_rule", sourceId: "link_limit_197", readableName: "Affinity → Excitement",
  });

  const unknown = mutateAndResign(exported.json, (document) => {
    document.fields[0].omittedDependencies.items[0].payload = {};
  });
  await assert.rejects(source.service.previewFieldTemplateImport({ json: unknown }), /MVU_FIELD_TEMPLATE_UNKNOWN_KEYS/);
  const badCount = mutateAndResign(exported.json, (document) => {
    document.fields[0].omittedDependencies.totalCount = 1;
  });
  await assert.rejects(source.service.previewFieldTemplateImport({ json: badCount }), /MVU_FIELD_TEMPLATE_DEPENDENCIES_INVALID/);
  const longText = mutateAndResign(exported.json, (document) => {
    document.fields[0].omittedDependencies.items[0].readableName = "x".repeat(513);
  });
  await assert.rejects(source.service.previewFieldTemplateImport({ json: longText }), /MVU_FIELD_TEMPLATE_TEXT_LIMIT/);
});

test("typed IPC parsers and client expose strict field-template requests", () => {
  const exportRequest = {
    fieldIds: ["field_affinity"],
    targetSelections: actorMatrix({ targetId: "actor_t", enabled: true, includeValue: false }),
  };
  assert.deepEqual(MVU_REQUEST_PARSERS.exportFieldTemplate(exportRequest), exportRequest);
  assert.deepEqual(MVU_REQUEST_PARSERS.previewFieldTemplateImport({ json: "{}" }), { json: "{}" });
  const importRequest = {
    json: "{}",
    expectedRevision: 7,
    decisions: { fields: [{
      sourceFieldId: "field_affinity",
      strategy: "create_copy",
      unboundTargets: [{ targetId: "actor_u", enabled: false, valuePolicy: "field_initial" }],
      mappings: [{
        sourceTargetId: "actor_t",
        targets: [{ targetId: "actor_u", enabled: true, valuePolicy: "keep_existing" }],
      }],
    }] },
  };
  assert.deepEqual(MVU_REQUEST_PARSERS.importFieldTemplate(importRequest), importRequest);
  for (const method of ["exportFieldTemplate", "previewFieldTemplateImport", "importFieldTemplate"]) {
    assert.equal(typeof MVU_IPC[method], "string");
    assert.equal(typeof MVU_REQUEST_PARSERS[method], "function");
    assert.equal(typeof mvuIpcClient[method], "function");
  }
  assert.throws(
    () => MVU_REQUEST_PARSERS.exportFieldTemplate({ ...exportRequest, outputPath: "../../escape" }),
    /MVU_FIELD_TEMPLATE_EXPORT_REQUEST_INVALID/,
  );
  assert.throws(
    () => MVU_REQUEST_PARSERS.importFieldTemplate({ ...importRequest, decisions: {
      ...importRequest.decisions, unexpected: true,
    } }),
    /MVU_FIELD_TEMPLATE_IMPORT_REQUEST_INVALID/,
  );
});

test("main IPC registrations save an explicitly selected export to the fixed Operit directory and reject unsafe names", async (t) => {
  const previousToolPkg = globalThis.ToolPkg;
  const previousTools = globalThis.Tools;
  t.after(() => {
    if (previousToolPkg === undefined) delete globalThis.ToolPkg;
    else globalThis.ToolPkg = previousToolPkg;
    if (previousTools === undefined) delete globalThis.Tools;
    else globalThis.Tools = previousTools;
  });
  const handlers = {};
  const writes = [];
  globalThis.ToolPkg = { ipc: { on(channel, handler) { handlers[channel] = handler; return () => {}; } } };
  globalThis.Tools = { Files: {
    async mkdir(path, recursive, location) { writes.push(["mkdir", path, recursive, location]); return { successful: true, details: "ok" }; },
    async write(path, contents, append, location) { writes.push(["write", path, contents, append, location]); return { successful: true, details: "ok" }; },
  } };
  const request = {
    fieldIds: ["field_affinity"],
    targetSelections: actorMatrix({ targetId: "actor_t", enabled: true, includeValue: true }),
  };
  const calls = [];
  let exportedFileName = "operit-mvu-field-template-affinity-20330518-033320Z.json";
  const queries = {
    async exportFieldTemplate(value) {
      calls.push(["export", value]);
      return { fileName: exportedFileName, json: "{\"portable\":true}", summary: { fieldCount: 1, targetCount: 1, valueCount: 1 } };
    },
    async previewFieldTemplateImport(value) { calls.push(["preview", value]); return { valid: true }; },
    async importFieldTemplate(value) { calls.push(["import", value]); return { revision: 8, summary: {} }; },
  };
  const uninstall = installMvuIpc({}, { snapshot() {}, systemModel: {}, queries });
  t.after(uninstall);
  for (const operation of ["exportFieldTemplate", "previewFieldTemplateImport", "importFieldTemplate"]) {
    assert.equal(typeof handlers[MVU_IPC[operation]], "function", `${operation} main handler`);
  }

  const response = await handlers[MVU_IPC.exportFieldTemplate](request);
  assert.deepEqual(response, {
    fileName: exportedFileName,
    savedPath: `/sdcard/Download/Operit/exports/${exportedFileName}`,
    summary: { fieldCount: 1, targetCount: 1, valueCount: 1 },
  });
  assert.deepEqual(calls[0], ["export", request]);
  assert.deepEqual(writes, [
    ["mkdir", "/sdcard/Download/Operit/exports", true, "android"],
    ["write", `/sdcard/Download/Operit/exports/${exportedFileName}`, "{\"portable\":true}", false, "android"],
  ]);

  exportedFileName = "../../escape.json";
  const expectedLogs = [];
  const originalConsoleError = console.error;
  console.error = (...args) => expectedLogs.push(args);
  try {
    await assert.rejects(handlers[MVU_IPC.exportFieldTemplate](request), /MVU_FIELD_TEMPLATE_EXPORT_FILENAME_INVALID/);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(expectedLogs.length, 1);
  assert.match(String(expectedLogs[0][0]), /MVU IPC exportFieldTemplate failed/);
  assert.match(String(expectedLogs[0][1]), /MVU_FIELD_TEMPLATE_EXPORT_FILENAME_INVALID/);
  assert.equal(writes.length, 2, "unsafe names must not reach the filesystem");

  const invalidData = createFixture().dataset;
  invalidData.fields[0].name = "N".repeat(513);
  const invalidExporter = createServiceFrom(invalidData, {
    actors: [{ characterId: "actor_t", name: "角色 T", enabled: true }],
  });
  queries.exportFieldTemplate = (value) => invalidExporter.service.exportFieldTemplate(value);
  const portableLimitLogs = [];
  console.error = (...args) => portableLimitLogs.push(args);
  try {
    await assert.rejects(handlers[MVU_IPC.exportFieldTemplate](request), /MVU_FIELD_TEMPLATE_TEXT_LIMIT/);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(portableLimitLogs.length, 1);
  assert.equal(writes.length, 2, "portable validation must finish before directory creation or file write");

  await handlers[MVU_IPC.previewFieldTemplateImport]({ json: "{}" });
  await handlers[MVU_IPC.importFieldTemplate]({
    json: "{}", expectedRevision: 7, decisions: { fields: [] },
  });
  assert.deepEqual(calls.slice(2), [
    ["preview", { json: "{}" }],
    ["import", { json: "{}", expectedRevision: 7, decisions: { fields: [] } }],
  ]);
});

test("native UI bridge dispatches all field-template operations through typed main-runtime IPC", async (t) => {
  const previousToolPkg = globalThis.ToolPkg;
  t.after(() => {
    if (previousToolPkg === undefined) delete globalThis.ToolPkg;
    else globalThis.ToolPkg = previousToolPkg;
  });
  const calls = [];
  globalThis.ToolPkg = { ipc: { async call(...args) { calls.push(args); return {}; } } };
  let nativeBridge;
  const controller = {
    addJavascriptInterface(_name, value) { nativeBridge = value; },
    async evaluateJavascript() {},
  };
  const ctx = {
    createWebViewController() { return controller; },
    useRef(_key, initial) { return { current: initial }; },
    useState(_key, initial) { return [initial, () => {}]; },
    UI: {
      Box(...args) { return { kind: "box", args }; },
      Text(value) { return { kind: "text", value }; },
      WebView(value) { return { kind: "webview", value }; },
    },
    async reportError() {},
  };
  const renderScreen = webContainerScreen.default ?? webContainerScreen;
  renderScreen(ctx);
  assert.equal(typeof nativeBridge.call, "function");
  const requests = [
    ["exportFieldTemplate", {
      fieldIds: ["field_affinity"],
      targetSelections: actorMatrix({ targetId: "actor_t", enabled: true, includeValue: false }),
    }],
    ["previewFieldTemplateImport", { json: "{}" }],
    ["importFieldTemplate", { json: "{}", expectedRevision: 7, decisions: { fields: [] } }],
  ];
  requests.forEach(([method, params], index) => nativeBridge.call([method, JSON.stringify(params), index + 1]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls.map(([channel]) => channel), [
    MVU_IPC.exportFieldTemplate,
    MVU_IPC.previewFieldTemplateImport,
    MVU_IPC.importFieldTemplate,
  ]);
  assert.equal(calls.every(([, , target]) => JSON.stringify(target) === JSON.stringify({
    targetRuntime: "main",
    targetContextKey: "toolpkg_main:com.lcilling.operit_mvu",
  })), true);
});

test("replace clears a stale pending-bootstrap marker before V3 atomic validation and survives restart", async () => {
  const source = createFixture();
  const exported = await source.service.exportFieldTemplate({
    fieldIds: ["field_affinity"],
    targetSelections: actorMatrix({ targetId: "actor_t", enabled: true, includeValue: false }),
  });
  const legacy = legacyDatasetFixture();
  legacy.fields[0].bindingIds = [];
  legacy.pendingBootstrapFieldIds = ["field_affinity"];
  legacy.autoRules = [];
  legacy.temporaryEffects = [];
  legacy.stateValues = {};
  const harness = await createRealStoreHarness(legacy, "/field-template-pending-bound", [
    { characterId: "actor_t", name: "角色 T", enabled: true },
  ]);
  const before = await harness.store.readV3();
  assert.doesNotThrow(() => assertMvuDatasetV3(before.dataset));
  const stale = structuredClone(before.dataset);
  stale.fields.find(({ id }) => id === "field_affinity").bindingIds = ["actor_t"];
  assert.throws(() => assertMvuDatasetV3(stale), /MVU_PENDING_BOOTSTRAP_FIELD_BOUND:field_affinity/);

  harness.files.clearOperations();
  const result = await harness.service.importFieldTemplate({
    json: exported.json,
    expectedRevision: before.revision,
    decisions: { fields: [{
      sourceFieldId: "field_affinity",
      strategy: "replace",
      mappings: [{
        sourceTargetId: "actor_t",
        targets: [{ targetId: "actor_t", enabled: true, valuePolicy: "field_initial" }],
      }],
    }] },
  });
  assert.equal(result.revision, before.revision + 1);
  assert.equal(harness.files.operations().filter(({ operation, destination }) =>
    operation === "replaceAtomically" && destination === harness.v3Path).length, 1);

  const restarted = harness.createStore();
  assert.equal((await restarted.initialize()).mode, "v3");
  const durable = await restarted.readV3();
  assert.deepEqual(durable.dataset.pendingBootstrapFieldIds, []);
  assert.deepEqual(durable.dataset.fields.find(({ id }) => id === "field_affinity").bindingIds, ["actor_t"]);
  assert.equal(durable.dataset.stateValues["character:actor_t"].field_affinity, 0);
});

test("replace preserves an existing pending marker for an unbound definition but never invents one for all-disabled import", async () => {
  const sourceData = createFixture().dataset;
  sourceData.fields[0].bindingIds = [];
  sourceData.linkRules = [];
  sourceData.conditions = [];
  sourceData.rules = [];
  sourceData.effectGroups = [];
  sourceData.activeEffects = [];
  sourceData.stateValues = {};
  const source = createServiceFrom(sourceData);
  const exported = await source.service.exportFieldTemplate({
    fieldIds: ["field_affinity"],
    targetSelections: [],
  });
  const makeLegacy = (pending) => {
    const legacy = legacyDatasetFixture();
    legacy.fields[0].bindingIds = [];
    legacy.pendingBootstrapFieldIds = pending ? ["field_affinity"] : [];
    legacy.autoRules = [];
    legacy.temporaryEffects = [];
    legacy.stateValues = {};
    return legacy;
  };
  for (const [label, pending, expected] of [
    ["existing", true, ["field_affinity"]],
    ["all-disabled", false, []],
  ]) {
    const harness = await createRealStoreHarness(makeLegacy(pending), `/field-template-pending-${label}`, [
      { characterId: "actor_t", name: "角色 T", enabled: true },
    ]);
    const before = await harness.store.readV3();
    await harness.service.importFieldTemplate({
      json: exported.json,
      expectedRevision: before.revision,
      decisions: { fields: [{
        sourceFieldId: "field_affinity",
        strategy: "replace",
        mappings: [],
        unboundTargets: [{ targetId: "actor_t", enabled: false, valuePolicy: "field_initial" }],
      }] },
    });
    const restarted = harness.createStore();
    await restarted.initialize();
    const durable = await restarted.readV3();
    assert.deepEqual(durable.dataset.pendingBootstrapFieldIds, expected, label);
    assert.deepEqual(durable.dataset.fields.find(({ id }) => id === "field_affinity").bindingIds, [], label);
  }
});

test("field-template import composes with the real V3 store CAS path and survives restart", async () => {
  const configDir = "/field-template-real-store";
  const v2Path = `${configDir}/operit_mvu.dataset.v2.json`;
  const v3Path = `${configDir}/operit_mvu.dataset.v3.json`;
  const legacy = legacyDatasetFixture();
  const files = createFakeMvuFileApi({ [v2Path]: JSON.stringify(legacy, null, 2) });
  const createLegacyStore = () => new FileMvuStore({
    getConfigDir: () => configDir,
    files,
    createInitialDataset: () => structuredClone(legacy),
  });
  const createStore = () => new V3MvuStore({
    getConfigDir: () => configDir,
    files,
    legacyStore: createLegacyStore(),
    createInitialDataset: () => structuredClone(legacy),
    now: () => NOW,
  });
  const store = createStore();
  await store.initialize();
  const querySource = {
    readV3: () => store.readV3(),
    transactV3: (expectedRevision, next, records = []) => store.transactV3(expectedRevision, next, records),
    queryCommittedRecords: (request) => store.queryRecords(request),
    async listActors() { return [{ characterId: "actor_t", name: "角色 T", enabled: true }]; },
    async listGroups() { return []; },
    async activeContext() { return { chatId: "chat_current", actorId: "actor_t", groupId: null, actorName: "角色 T" }; },
    migrationStatus: () => store.migrationStatus(),
  };
  const service = new MvuQueryService(querySource, { now: () => NOW });
  const exported = await service.exportFieldTemplate({
    fieldIds: ["field_affinity"],
    targetSelections: actorMatrix({ targetId: "actor_t", enabled: true, includeValue: false }),
  });
  const preview = await service.previewFieldTemplateImport({ json: exported.json });
  files.clearOperations();
  const result = await service.importFieldTemplate({
    json: exported.json,
    expectedRevision: preview.revision,
    decisions: { fields: [{ sourceFieldId: "field_affinity", mappings: [{
      sourceTargetId: "actor_t",
      targets: [{ targetId: "actor_t", enabled: true, valuePolicy: "field_initial" }],
    }] }] },
  });
  assert.equal(result.revision, preview.revision + 1);
  assert.deepEqual(result.summary.created, ["field_affinity_copy"]);
  assert.equal(files.operations().filter(({ operation, destination }) =>
    operation === "replaceAtomically" && destination === v3Path).length, 1);

  files.clearOperations();
  await assert.rejects(service.importFieldTemplate({
    json: exported.json,
    expectedRevision: preview.revision,
    decisions: { fields: [{ sourceFieldId: "field_affinity", mappings: [{
      sourceTargetId: "actor_t",
      targets: [{ targetId: "actor_t", enabled: true, valuePolicy: "field_initial" }],
    }] }] },
  }), /MVU_STALE_REVISION/);
  assert.equal(files.operations().some(({ operation }) => operation === "replaceAtomically"), false);

  const restarted = createStore();
  assert.equal((await restarted.initialize()).mode, "v3");
  const durable = await restarted.readV3();
  assert.equal(durable.revision, result.revision);
  assert.deepEqual(durable.dataset.fields.find(({ id }) => id === "field_affinity_copy").bindingIds, ["actor_t"]);
  assert.equal(durable.dataset.stateValues["character:actor_t"].field_affinity_copy, 0);
});
