import assert from "node:assert/strict";
import test from "node:test";

import { createRuntime } from "../dist/mvu/app/index.js";
import {
  createEmptyRecordManifest,
  SegmentedRecordStore,
} from "../dist/mvu/app/record-store.js";
import { V3MvuStore } from "../dist/mvu/app/store-v3.js";
import { FileMvuStore, StaleRevisionError } from "../dist/mvu/app/store.js";
import {
  createFakeMvuFileApi,
  largeDatasetFixture,
  legacyDatasetFixture,
} from "./helpers.mjs";

const CONFIG_DIR = "/config";
const V2_PATH = `${CONFIG_DIR}/operit_mvu.dataset.v2.json`;
const V3_PATH = `${CONFIG_DIR}/operit_mvu.dataset.v3.json`;
const RECORD_DIRECTORY = `${CONFIG_DIR}/operit_mvu.records.v3`;
const NOW = Date.parse("2033-05-18T03:33:20.000Z");

function legacyStore(files, initial) {
  return new FileMvuStore({
    getConfigDir: () => CONFIG_DIR,
    files,
    createInitialDataset: () => structuredClone(initial),
  });
}

function v3Store(files, initial) {
  return new V3MvuStore({
    getConfigDir: () => CONFIG_DIR,
    files,
    legacyStore: legacyStore(files, initial),
    createInitialDataset: () => structuredClone(initial),
    now: () => NOW,
  });
}

function fixtureFiles(initial) {
  return createFakeMvuFileApi({ [V2_PATH]: JSON.stringify(initial, null, 2) });
}

function changeRecord(index) {
  return {
    id: `hardening_record_${index}`,
    scope: "character",
    scopeKey: "character:T",
    fieldId: "field_affinity",
    fieldName: "Affinity",
    actorId: "T",
    actorName: "T",
    chatId: "chat_main",
    groupId: null,
    before: index,
    after: index + 1,
    requestedDelta: 1,
    effectiveRequestedDelta: 1,
    delta: 1,
    stageBefore: "stage_low",
    stageAfter: "stage_low",
    reason: "hardening fixture",
    source: "rule",
    ruleIds: [],
    effectIds: [],
    confidence: null,
    messageId: `hardening_message_${index}`,
    variantId: null,
    occurredAt: NOW + index,
  };
}

function iso(offset = 0) {
  return new Date(NOW + offset).toISOString();
}

function target(actorId = "T") {
  return {
    fieldId: "field_affinity",
    actorId,
    scope: "character",
    scopeKey: `character:${actorId}`,
  };
}

test("config publication requires atomic replace and never falls back to ordinary move", async () => {
  const initial = legacyDatasetFixture();
  const files = fixtureFiles(initial);
  files.failNext(
    "replaceAtomically",
    ({ destination }) => destination === V3_PATH,
    new Error("ATOMIC_REPLACE_UNAVAILABLE"),
  );

  const status = await v3Store(files, initial).initialize();

  assert.equal(status.mode, "v2_compat");
  assert.match(status.error.message, /ATOMIC_REPLACE_UNAVAILABLE/);
  assert.equal(files.snapshot()[V3_PATH], undefined);
  assert.equal(files.operations().some((operation) =>
    operation.operation === "move" && operation.destination === V3_PATH), false);
});

test("the host fake distinguishes interrupted ordinary move from failed atomic replace", async () => {
  const files = createFakeMvuFileApi({
    "/ordinary.source": "new ordinary",
    "/ordinary.destination": "old ordinary",
    "/atomic.source": "new atomic",
    "/atomic.destination": "old atomic",
  });
  files.failNext("moveAfterCopy", () => true, new Error("INTERRUPTED_AFTER_COPY"));
  await assert.rejects(
    files.move("/ordinary.source", "/ordinary.destination"),
    /INTERRUPTED_AFTER_COPY/,
  );
  assert.equal(files.snapshot()["/ordinary.destination"], "new ordinary");
  assert.equal(files.snapshot()["/ordinary.source"], "new ordinary");

  files.failNext("replaceAtomically", () => true, new Error("ATOMIC_REPLACE_FAILED"));
  await assert.rejects(
    files.replaceAtomically("/atomic.source", "/atomic.destination"),
    /ATOMIC_REPLACE_FAILED/,
  );
  assert.equal(files.snapshot()["/atomic.destination"], "old atomic");
  assert.equal(files.snapshot()["/atomic.source"], "new atomic");
});

test("the real Tools adapter rejects an unsuccessful atomic-replace result", async (t) => {
  const previousTools = globalThis.Tools;
  t.after(() => {
    if (previousTools === undefined) delete globalThis.Tools;
    else globalThis.Tools = previousTools;
  });
  const initial = legacyDatasetFixture();
  const files = fixtureFiles(initial);
  const success = { successful: true, details: "" };
  globalThis.Tools = { Files: {
    async exists(path) { return { exists: await files.exists(path) }; },
    async read(path) { return { content: await files.readText(path) }; },
    async readPart(path, startLine, endLine) {
      return { content: await files.readTextPart(path, startLine, endLine) };
    },
    async write(path, content, append = false) {
      if (append) await files.appendText(path, content);
      else await files.writeText(path, content);
      return success;
    },
    async move(source, destination) {
      await files.move(source, destination);
      return success;
    },
    async replaceAtomically() {
      return { successful: false, details: "atomic capability denied" };
    },
    async deleteFile(path) {
      await files.deleteFile(path);
      return success;
    },
    async mkdir(path) {
      await files.mkdir(path);
      return success;
    },
  } };

  const runtime = createRuntime({ getConfigDir: () => CONFIG_DIR });
  const status = await runtime.initialize();

  assert.equal(status.mode, "v2_compat");
  assert.equal(status.error.code, "TOOLS_FILES_ATOMIC_REPLACE_FAILED");
  assert.match(status.error.message, /atomic capability denied/);
  assert.equal(files.snapshot()[V3_PATH], undefined);
});

test("record queries ignore decorated partial reads and slice bounded raw segments locally", async () => {
  const files = createFakeMvuFileApi({}, { partialReadLineLimit: 1 });
  const records = new SegmentedRecordStore({ getConfigDir: () => CONFIG_DIR, files });
  const staged = await records.stageAppend(
    createEmptyRecordManifest(),
    [changeRecord(1), changeRecord(2), changeRecord(3)],
    1,
  );
  files.clearOperations();
  files.failNext("readTextPart", () => true, new Error("HOST_DECORATED_PARTIAL_READ_FORBIDDEN"));

  const result = await records.queryRecords(staged.manifest, {
    offset: 1,
    limit: 2,
    direction: "asc",
  });

  assert.deepEqual(result.items.map(({ id }) => id), ["hardening_record_2", "hardening_record_3"]);
  assert.equal(files.operations().some(({ operation }) => operation === "readTextPart"), false);
  assert.equal(files.operations().filter(({ operation }) => operation === "readText").length, 1);
});

test("two store instances serialize one path and the stale writer cannot publish", async () => {
  const initial = legacyDatasetFixture();
  const files = fixtureFiles(initial);
  const seed = v3Store(files, initial);
  await seed.initialize();
  const first = v3Store(files, initial);
  const second = v3Store(files, initial);
  await Promise.all([first.initialize(), second.initialize()]);
  const before = await first.readV3();
  const firstNext = structuredClone(before.dataset);
  firstNext.settings.aiEnabled = false;
  const secondNext = structuredClone(before.dataset);
  secondNext.settings.aiEnabled = true;
  const barrier = files.pauseNext(
    "appendText",
    ({ content }) => content.includes("hardening_record_1"),
  );

  const firstWrite = first.transactV3(before.revision, firstNext, [changeRecord(1)]);
  await barrier.entered;
  const staleWrite = second.transactV3(before.revision, secondNext, [changeRecord(2)]);
  await new Promise((resolve) => setImmediate(resolve));
  barrier.release();

  await firstWrite;
  await assert.rejects(staleWrite, StaleRevisionError);
  assert.deepEqual(
    (await first.queryRecords({ offset: 0, limit: 10, direction: "asc" })).items.map(({ id }) => id),
    ["hardening_record_1"],
  );
});

test("normal writes never destructively clean an orphan allocated at the next index", async () => {
  const initial = legacyDatasetFixture();
  const files = fixtureFiles(initial);
  const store = v3Store(files, initial);
  await store.initialize();
  const before = await store.readV3();
  const orphanPath = `${RECORD_DIRECTORY}/segment-000001.jsonl`;
  await files.writeText(orphanPath, "orphan bytes\n");
  files.clearOperations();

  await assert.rejects(
    store.transactV3(before.revision, structuredClone(before.dataset), [changeRecord(1)]),
    /MVU_V3_RECORD_SEGMENT_COLLISION/,
  );

  assert.equal(files.snapshot()[orphanPath], "orphan bytes\n");
  assert.equal(files.operations().some((operation) =>
    operation.operation === "deleteFile" && operation.path === orphanPath), false);
});

test("a later in-runtime write performs exclusive recovery after interrupted append publication", async () => {
  const initial = legacyDatasetFixture();
  const files = fixtureFiles(initial);
  const store = v3Store(files, initial);
  await store.initialize();
  const empty = await store.readV3();
  const before = await store.transactV3(
    empty.revision,
    structuredClone(empty.dataset),
    [changeRecord(0)],
  );
  files.failNext(
    "appendTextAfterWrite",
    ({ content }) => content.includes("hardening_record_1"),
  );
  await assert.rejects(
    store.transactV3(before.revision, structuredClone(before.dataset), [changeRecord(1)]),
    /FAKE_APPENDTEXTAFTERWRITE_FAILED/,
  );

  const committed = await store.transactV3(
    before.revision,
    structuredClone(before.dataset),
    [changeRecord(2)],
  );

  assert.equal(committed.dataset.recordManifest.recordCount, 2);
  assert.deepEqual(
    (await store.queryRecords({ offset: 0, limit: 10, direction: "asc" })).items.map(({ id }) => id),
    ["hardening_record_0", "hardening_record_2"],
  );
  assert.equal(files.operations().some((operation) =>
    operation.operation === "replaceAtomically" &&
    operation.destination === `${RECORD_DIRECTORY}/segment-000001.jsonl`), true);
});

test("retry is coalesced in compatibility mode and rejected after valid v3 exists", async () => {
  const initial = legacyDatasetFixture();
  const files = createFakeMvuFileApi({
    [V2_PATH]: JSON.stringify(initial, null, 2),
    [V3_PATH]: "{invalid v3",
  });
  const store = v3Store(files, initial);
  assert.equal((await store.initialize()).mode, "v2_compat");
  files.clearOperations();

  const [first, second] = await Promise.all([store.retryMigration(), store.retryMigration()]);

  assert.equal(first.mode, "v3");
  assert.deepEqual(second, first);
  assert.equal(files.operations().filter((operation) =>
    operation.operation === "replaceAtomically" && operation.destination === V3_PATH).length, 1);
  assert.equal(files.operations().some((operation) =>
    operation.operation === "deleteFile" && operation.path === V3_PATH), false);
  const validBytes = files.snapshot()[V3_PATH];
  await assert.rejects(store.retryMigration(), /MVU_V3_MIGRATION_RETRY_NOT_ALLOWED/);
  assert.equal(files.snapshot()[V3_PATH], validBytes);
});

test("normal compatibility reads are bounded independently of 100k-record history", async () => {
  const initial = largeDatasetFixture();
  const files = fixtureFiles(initial);
  const store = v3Store(files, initial);
  assert.equal((await store.initialize()).mode, "v3");
  files.clearOperations();

  const snapshot = await store.read();

  assert.equal(snapshot.dataset.records.length <= 500, true);
  const segmentReads = files.operations().filter((operation) =>
    operation.operation === "readText" && operation.path.startsWith(`${RECORD_DIRECTORY}/segment-`));
  assert.equal(segmentReads.length <= 1, true);
  assert.equal(files.operations().some(({ operation }) => operation === "readTextPart"), false);
});

test("legacy rule edits preserve hidden selectors, targets, references, and shared conditions", async () => {
  const initial = legacyDatasetFixture();
  initial.fields[0].bindingIds = ["T"];
  initial.autoRules = [];
  initial.temporaryEffects = [];
  const files = fixtureFiles(initial);
  const store = v3Store(files, initial);
  await store.initialize();
  const before = await store.readV3();
  const configured = structuredClone(before.dataset);
  configured.conditions = [{
    id: "condition_shared",
    name: "Shared",
    description: "hidden condition metadata",
    enabled: true,
    expression: { kind: "predicate", predicate: { kind: "recent_positive", count: 2 } },
    createdAt: iso(),
    updatedAt: iso(),
  }];
  configured.effectGroups = [{
    id: "effect_group_visible",
    name: "Visible",
    description: "",
    enabled: true,
    fieldEffects: [{
      id: "field_effect_visible",
      fieldId: "field_affinity",
      actorSelector: { kind: "selected", actorIds: ["T"] },
      operations: [{ kind: "fixed_adjustment", value: 1, sources: ["natural"] }],
    }],
    createdAt: iso(),
    updatedAt: iso(),
  }, {
    id: "effect_group_hidden",
    name: "Hidden immediate",
    description: "",
    enabled: true,
    fieldEffects: [{
      id: "field_effect_hidden",
      fieldId: "field_affinity",
      actorSelector: { kind: "trigger_actor" },
      operations: [{ kind: "immediate_delta", value: 3 }],
    }],
    createdAt: iso(),
    updatedAt: iso(),
  }];
  configured.activeEffects = [{
    id: "active_visible",
    definitionId: "effect_group_visible",
    resolvedTargets: [target()],
    duration: { expiresAt: null, remainingTurns: 3 },
    activatedAt: iso(),
    reason: { mode: "custom", template: "general", text: "visible reason" },
  }];
  const baseRule = {
    description: "hidden rule metadata",
    enabled: true,
    triggerActorSelector: { kind: "selected", actorIds: ["T"] },
    conditionId: "condition_shared",
    actions: [{
      kind: "change_field",
      fieldId: "field_affinity",
      target: { kind: "selected", actorIds: ["T"] },
      delta: 2,
      effectGroupIds: ["effect_group_hidden", "effect_group_visible"],
    }],
    cooldownHours: 1,
    executionOrder: 1,
    createdAt: iso(),
    updatedAt: iso(),
  };
  configured.rules = [{ id: "rule_first", name: "First", ...baseRule }, {
    id: "rule_second",
    name: "Second",
    ...structuredClone(baseRule),
    actions: [{
      kind: "change_field",
      fieldId: "field_affinity",
      target: { kind: "selected", actorIds: ["T"] },
      delta: 4,
      effectGroupIds: ["effect_group_hidden", "effect_group_visible"],
    }],
    executionOrder: 2,
  }];
  await store.transactV3(before.revision, configured, []);
  const runtime = createRuntime({ store });

  await runtime.service.updateAutoRule("rule_first", {
    name: "First edited",
    enabled: false,
    condition: { kind: "recentPositive", count: 9 },
    effects: [{ fieldId: "field_affinity", delta: 7, temporaryEffectIds: ["visible"] }],
  });

  const after = (await store.readV3()).dataset;
  const first = after.rules.find(({ id }) => id === "rule_first");
  const second = after.rules.find(({ id }) => id === "rule_second");
  assert.deepEqual(first.triggerActorSelector, { kind: "selected", actorIds: ["T"] });
  assert.deepEqual(first.actions[0].target, { kind: "selected", actorIds: ["T"] });
  assert.deepEqual(first.actions[0].effectGroupIds, ["effect_group_hidden", "effect_group_visible"]);
  assert.equal(first.actions[0].delta, 7);
  assert.notEqual(first.conditionId, second.conditionId);
  assert.deepEqual(
    after.conditions.find(({ id }) => id === second.conditionId).expression,
    { kind: "predicate", predicate: { kind: "recent_positive", count: 2 } },
  );
  assert.deepEqual(
    after.conditions.find(({ id }) => id === first.conditionId).expression,
    { kind: "predicate", predicate: { kind: "recent_positive", count: 9 } },
  );
});

test("legacy effect writes preserve reusable semantics and every active instance", async () => {
  const initial = legacyDatasetFixture();
  initial.fields[0].bindingIds = ["T", "U"];
  initial.autoRules = [];
  initial.temporaryEffects = [];
  const files = fixtureFiles(initial);
  const store = v3Store(files, initial);
  await store.initialize();
  const before = await store.readV3();
  const configured = structuredClone(before.dataset);
  configured.effectGroups = [{
    id: "effect_group_multi",
    name: "Multi",
    description: "hidden definition metadata",
    enabled: true,
    fieldEffects: [{
      id: "field_effect_multi",
      fieldId: "field_affinity",
      actorSelector: { kind: "selected", actorIds: ["T"] },
      operations: [{ kind: "fixed_adjustment", value: 2, sources: ["manual", "ai"] }],
    }],
    createdAt: iso(),
    updatedAt: iso(),
  }];
  configured.activeEffects = [{
    id: "active_t",
    definitionId: "effect_group_multi",
    triggerActorId: "T",
    resolvedTargets: [target("T")],
    duration: { expiresAt: iso(60_000), remainingTurns: 2 },
    activatedAt: iso(-60_000),
    reason: { mode: "custom", template: "general", text: "reason T" },
  }, {
    id: "active_u",
    definitionId: "effect_group_multi",
    triggerActorId: "U",
    resolvedTargets: [target("U")],
    duration: { expiresAt: null, remainingTurns: 5 },
    activatedAt: iso(-30_000),
    reason: { mode: "template", template: "positive", text: "positive" },
  }];
  await store.transactV3(before.revision, configured, []);
  const runtime = createRuntime({ store });
  const instancesBefore = structuredClone(configured.activeEffects);

  await runtime.service.updateTemporaryEffect("multi", { value: 3 });

  const after = (await store.readV3()).dataset;
  const definition = after.effectGroups.find(({ id }) => id === "effect_group_multi");
  assert.deepEqual(definition.fieldEffects[0].actorSelector, { kind: "selected", actorIds: ["T"] });
  assert.deepEqual(definition.fieldEffects[0].operations, [{
    kind: "fixed_adjustment", value: 3, sources: ["manual", "ai"],
  }]);
  assert.deepEqual(after.activeEffects, instancesBefore);

  await runtime.service.updateTemporaryEffect("multi", { enabled: false });
  const settled = (await store.readV3()).dataset;
  assert.equal(settled.effectGroups[0].enabled, true);
  assert.deepEqual(settled.activeEffects, []);
});

test("expiry settles active instances without disabling their reusable definition", async () => {
  const initial = legacyDatasetFixture();
  initial.fields[0].bindingIds = ["T"];
  initial.autoRules = [];
  initial.temporaryEffects = [];
  const files = fixtureFiles(initial);
  const store = v3Store(files, initial);
  await store.initialize();
  const before = await store.readV3();
  const configured = structuredClone(before.dataset);
  configured.effectGroups = [{
    id: "effect_group_expiring",
    name: "Reusable",
    description: "",
    enabled: true,
    fieldEffects: [{
      id: "field_effect_expiring",
      fieldId: "field_affinity",
      actorSelector: { kind: "selected", actorIds: ["T"] },
      operations: [{ kind: "fixed_adjustment", value: 2, sources: ["natural"] }],
    }],
    createdAt: iso(-60_000),
    updatedAt: iso(-60_000),
  }];
  configured.activeEffects = [{
    id: "active_expired",
    definitionId: "effect_group_expiring",
    triggerActorId: "T",
    resolvedTargets: [target()],
    duration: { expiresAt: iso(-1), remainingTurns: null },
    activatedAt: iso(-60_000),
    reason: { mode: "custom", template: "general", text: "must survive projection" },
  }];
  await store.transactV3(before.revision, configured, []);
  const runtime = createRuntime({ store });

  await runtime.service.settleNatural({
    chatId: "chat_main", actorId: "T", groupId: null, actorName: "T",
  }, NOW);

  const after = (await store.readV3()).dataset;
  assert.equal(after.effectGroups[0].enabled, true);
  assert.deepEqual(after.activeEffects, []);
});

test("revision and manifest counters reject unsafe integers and guarded increments", async () => {
  assert.throws(
    () => createEmptyRecordManifest(Number.MAX_SAFE_INTEGER + 1),
    /MVU_V3_RECORD_NEXT_SEGMENT_INVALID/,
  );
  const initial = legacyDatasetFixture();
  const files = fixtureFiles(initial);
  const seed = v3Store(files, initial);
  await seed.initialize();
  const unsafeNext = JSON.parse(files.snapshot()[V3_PATH]);
  unsafeNext.revision = Number.MAX_SAFE_INTEGER;
  await files.writeText(V3_PATH, JSON.stringify(unsafeNext));
  const store = v3Store(files, initial);
  assert.equal((await store.initialize()).mode, "v3");
  const before = await store.readV3();
  files.clearOperations();

  await assert.rejects(
    store.transactV3(before.revision, structuredClone(before.dataset), []),
    /MVU_V3_REVISION_OVERFLOW/,
  );
  assert.equal(files.operations().some(({ operation }) =>
    operation === "appendText" || operation === "replaceAtomically"), false);
});
