import assert from "node:assert/strict";
import test from "node:test";

import { migrateDatasetV2ToV3 } from "../dist/mvu/app/migration-v3.js";
import { MvuQueryService } from "../dist/mvu/app/query.js";
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
