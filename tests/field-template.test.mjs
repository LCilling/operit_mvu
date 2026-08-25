import assert from "node:assert/strict";
import test from "node:test";

import { migrateDatasetV2ToV3 } from "../dist/mvu/app/migration-v3.js";
import { MvuQueryService } from "../dist/mvu/app/query.js";
import {
  MVU_IPC,
  MVU_REQUEST_PARSERS,
  installMvuIpc,
  mvuIpcClient,
} from "../dist/shared/ipc.js";
import webContainerScreen from "../dist/ui/web_container/index.ui.js";
import { legacyDatasetFixture } from "./helpers.mjs";

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
    sourceTargets: [{ kind: "actor", sourceId: "actor_t", name: "角色 T", hasValue: false }],
  }]);
  assert.equal(fixture.transactionCount(), 0);
  assert.deepEqual(fixture.current(), before);
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
    ],
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

test("export filenames are path-safe and dependency metadata contains counts but no dependency entities or IDs", async () => {
  const fixture = createFixture();
  const data = fixture.current();
  data.fields[0].name = "../../\\evil\u0000字段";
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
  assert.deepEqual(Object.keys(document.fields[0].dependencySummary).sort(), [
    "automationRuleCount", "effectGroupCount", "linkRuleCount",
  ]);
  assert.equal(JSON.stringify(document.fields[0].dependencySummary).includes("rule_"), false);
  const forbidden = new Set(["records", "rules", "conditions", "effects", "effectGroups", "dependencies"]);
  for (const key of collectObjectKeys(document)) assert.equal(forbidden.has(key), false, `forbidden entity key ${key}`);
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
