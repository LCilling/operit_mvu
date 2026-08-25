import assert from "node:assert/strict";
import test from "node:test";

import { activateEffectGroup } from "../dist/mvu/app/effect-engine.js";
import { migrateDatasetV2ToV3 } from "../dist/mvu/app/migration-v3.js";
import {
  EFFECT_REASON_LEGACY_STORAGE_MAX_LENGTH,
  EFFECT_REASON_RENDERED_MAX_LENGTH,
  EFFECT_REASON_SOURCE_MAX_LENGTH,
} from "../dist/mvu/app/model-v3.js";
import { MvuQueryService } from "../dist/mvu/app/query.js";
import { processPersistedMessageV3 } from "../dist/mvu/app/service.js";
import { V3MvuStore } from "../dist/mvu/app/store-v3.js";
import { FileMvuStore } from "../dist/mvu/app/store.js";
import { assertDataChangeRecord, assertMvuDatasetV3 } from "../dist/mvu/app/validation.js";
import { MVU_REQUEST_PARSERS } from "../dist/shared/ipc.js";
import {
  createFakeMvuFileApi,
  legacyDatasetFixture,
} from "./helpers.mjs";

const CONFIG_DIR = "/config";
const V2_PATH = `${CONFIG_DIR}/operit_mvu.dataset.v2.json`;
const V3_PATH = `${CONFIG_DIR}/operit_mvu.dataset.v3.json`;
const NOW = Date.parse("2033-05-18T03:33:20.000Z");
const NOW_ISO = new Date(NOW).toISOString();

function legacyStore(files, initial = legacyDatasetFixture()) {
  return new FileMvuStore({
    getConfigDir: () => CONFIG_DIR,
    files,
    createInitialDataset: () => structuredClone(initial),
  });
}

function v3Store(files, initial = legacyDatasetFixture()) {
  return new V3MvuStore({
    getConfigDir: () => CONFIG_DIR,
    files,
    legacyStore: legacyStore(files, initial),
    createInitialDataset: () => structuredClone(initial),
    now: () => NOW,
  });
}

function filesWithV2(dataset = legacyDatasetFixture()) {
  return createFakeMvuFileApi({ [V2_PATH]: JSON.stringify(dataset, null, 2) });
}

function baseV3Dataset() {
  const legacy = legacyDatasetFixture();
  legacy.fields = [legacy.fields[0]];
  legacy.fields[0].bindingIds = ["actor_t"];
  legacy.fields[0].initialValue = 50;
  legacy.autoRules = [];
  legacy.temporaryEffects = [];
  const dataset = migrateDatasetV2ToV3(legacy, NOW).dataset;
  dataset.stateValues = { "character:actor_t": { field_affinity: 50 } };
  return dataset;
}

function condition(id) {
  return {
    id,
    name: id,
    description: "",
    enabled: true,
    expression: { kind: "predicate", predicate: { kind: "sender", senders: ["user"] } },
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  };
}

function rule(id, name, conditionId, effectGroupId, executionOrder) {
  return {
    id,
    name,
    description: "",
    enabled: true,
    triggerActorSelector: { kind: "any" },
    conditionId,
    actions: [{ kind: "activate_effect_group", effectGroupId }],
    cooldownHours: 0,
    executionOrder,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  };
}

function effectGroup(id, name, defaultReason, delta = 1) {
  return {
    id,
    name,
    description: "",
    enabled: true,
    fieldEffects: [{
      id: `field_effect_${id}`,
      fieldId: "field_affinity",
      actorSelector: { kind: "trigger_actor" },
      operations: [{ kind: "immediate_delta", value: delta }],
    }],
    defaultReason,
    defaultDuration: { expiresAt: null, remainingTurns: 2 },
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  };
}

function effectGroupInput(defaultReason) {
  return {
    name: "可配置原因效果",
    description: "",
    enabled: true,
    fieldEffects: [{
      id: "field_effect_reason",
      fieldId: "field_affinity",
      actorSelector: { kind: "all_bound" },
      operations: [{ kind: "immediate_delta", value: 1 }],
    }],
    defaultReason,
  };
}

function changeRecord(reason) {
  return {
    id: "record_reason_bound",
    scope: "character",
    scopeKey: "character:actor_t",
    fieldId: "field_affinity",
    fieldName: "Affinity",
    actorId: "actor_t",
    actorName: "角色T",
    chatId: "chat_main",
    groupId: "group_main",
    before: 50,
    after: 51,
    requestedDelta: 1,
    effectiveRequestedDelta: 1,
    delta: 1,
    stageBefore: "stage_neutral",
    stageAfter: "stage_neutral",
    reason,
    source: "rule",
    ruleIds: ["rule_reason"],
    effectIds: ["active_reason"],
    confidence: null,
    messageId: "message_reason",
    variantId: null,
    occurredAt: NOW,
  };
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

test("v2 migration preserves definition reason configuration and resolves the active snapshot", () => {
  const templateLegacy = legacyDatasetFixture();
  templateLegacy.temporaryEffects[0].reasonMode = "template";
  templateLegacy.temporaryEffects[0].reasonTemplate = "positive";
  templateLegacy.temporaryEffects[0].reason = "legacy template metadata";
  const template = migrateDatasetV2ToV3(templateLegacy, NOW).dataset;

  assert.deepEqual(template.effectGroups[0].defaultReason, {
    mode: "template",
    template: "positive",
    text: "legacy template metadata",
  });
  assert.deepEqual(template.activeEffects[0].reason, {
    mode: "template",
    template: "positive",
    text: "临时增益",
  });

  const customLegacy = legacyDatasetFixture();
  customLegacy.temporaryEffects[0].reasonMode = "custom";
  customLegacy.temporaryEffects[0].reasonTemplate = "relationship";
  customLegacy.temporaryEffects[0].reason = "T 触发了 B 事件";
  const custom = migrateDatasetV2ToV3(customLegacy, NOW).dataset;

  assert.deepEqual(custom.effectGroups[0].defaultReason, {
    mode: "custom",
    template: "relationship",
    text: "T 触发了 B 事件",
  });
  assert.deepEqual(custom.activeEffects[0].reason, {
    mode: "custom",
    template: "relationship",
    text: "T 触发了 B 事件",
  });
});

test("old v3 files missing defaultReason backfill deterministically and persist on the next commit", async () => {
  const oldV3 = migrateDatasetV2ToV3(legacyDatasetFixture(), NOW).dataset;
  delete oldV3.effectGroups[0].defaultReason;
  oldV3.activeEffects[0].reason = {
    mode: "custom",
    template: "general",
    text: "frozen legacy instance",
  };
  const frozenSnapshot = structuredClone(oldV3.activeEffects[0].definitionSnapshot);
  const files = createFakeMvuFileApi({ [V3_PATH]: JSON.stringify(oldV3, null, 2) });

  const firstStore = v3Store(files);
  assert.equal((await firstStore.initialize()).mode, "v3");
  const first = await firstStore.readV3();
  assert.deepEqual(first.dataset.effectGroups[0].defaultReason, {
    mode: "template",
    template: "general",
    text: "",
  });
  assert.equal(first.dataset.activeEffects[0].reason.text, "frozen legacy instance");
  assert.deepEqual(first.dataset.activeEffects[0].definitionSnapshot, frozenSnapshot);

  await firstStore.transactV3(first.revision, first.dataset, []);
  assert.deepEqual(JSON.parse(files.snapshot()[V3_PATH]).effectGroups[0].defaultReason, {
    mode: "template",
    template: "general",
    text: "",
  });

  const restarted = await v3Store(files).readV3();
  assert.deepEqual(restarted.dataset.effectGroups[0].defaultReason, {
    mode: "template",
    template: "general",
    text: "",
  });
  assert.equal(restarted.dataset.activeEffects[0].reason.text, "frozen legacy instance");
  assert.deepEqual(restarted.dataset.activeEffects[0].definitionSnapshot, frozenSnapshot);
});

test("old persisted v3 normalizes pathological definition and active reason sizes only at the read boundary", async () => {
  const oldV3 = migrateDatasetV2ToV3(legacyDatasetFixture(), NOW).dataset;
  const definitionText = "定".repeat(EFFECT_REASON_LEGACY_STORAGE_MAX_LENGTH + 100);
  const activeText = "例".repeat(EFFECT_REASON_RENDERED_MAX_LENGTH + 100);
  oldV3.effectGroups[0].defaultReason = { mode: "custom", template: "general", text: definitionText };
  oldV3.activeEffects[0].reason = { mode: "custom", template: "general", text: activeText };
  const files = createFakeMvuFileApi({ [V3_PATH]: JSON.stringify(oldV3, null, 2) });
  const store = v3Store(files);

  assert.equal((await store.initialize()).mode, "v3");
  const first = await store.readV3();
  assert.equal(first.dataset.effectGroups[0].defaultReason.text, definitionText.slice(0, EFFECT_REASON_LEGACY_STORAGE_MAX_LENGTH));
  assert.equal(first.dataset.activeEffects[0].reason.text, activeText.slice(0, EFFECT_REASON_RENDERED_MAX_LENGTH));
  const frozenActiveReason = structuredClone(first.dataset.activeEffects[0].reason);
  first.dataset.effectGroups[0].defaultReason = { mode: "custom", template: "general", text: "新定义" };
  await store.transactV3(first.revision, first.dataset, []);

  const restarted = await v3Store(files).readV3();
  assert.deepEqual(restarted.dataset.activeEffects[0].reason, frozenActiveReason);
  assert.equal(restarted.dataset.effectGroups[0].defaultReason.text, "新定义");
});

test("effect-group create update copy query and restart preserve independent reason configs", async () => {
  const files = filesWithV2();
  const store = v3Store(files);
  await store.initialize();
  let idSequence = 0;
  const queries = new MvuQueryService(store, {
    now: () => NOW,
    createId: (prefix) => `${prefix}_reason_${++idSequence}`,
  });
  let revision = (await store.readV3()).revision;
  const created = await queries.createEffectGroup({
    expectedRevision: revision,
    effectGroup: effectGroupInput({ mode: "template", template: "environment", text: "" }),
  });
  revision = created.revision;
  assert.deepEqual(created.entity.defaultReason, {
    mode: "template",
    template: "environment",
    text: "",
  });

  const oldInstanceReason = structuredClone((await store.readV3()).dataset.activeEffects[0].reason);
  const activeDefinitionId = (await store.readV3()).dataset.activeEffects[0].definitionId;
  const updated = await queries.updateEffectGroup({
    id: created.entity.id,
    expectedRevision: revision,
    patch: { defaultReason: { mode: "custom", template: "general", text: "{{event}} 后生效" } },
  });
  revision = updated.revision;
  const listed = await queries.queryEffectGroups({ search: "可配置原因效果", page: 1 });
  assert.deepEqual(listed.items.find(({ id }) => id === created.entity.id).defaultReason, {
    mode: "custom",
    template: "general",
    text: "{{event}} 后生效",
  });
  const copied = await queries.copyEffectGroup({ id: created.entity.id, expectedRevision: revision });
  revision = copied.revision;
  copied.entity.defaultReason.text = "mutated response only";
  await queries.updateEffectGroup({
    id: activeDefinitionId,
    expectedRevision: revision,
    patch: {
      name: "改名后的定义",
      defaultReason: { mode: "custom", template: "relationship", text: "只供新实例使用" },
    },
  });

  const restarted = await v3Store(files).readV3();
  const storedOriginal = restarted.dataset.effectGroups.find(({ id }) => id === created.entity.id);
  const storedCopy = restarted.dataset.effectGroups.find(({ id }) => id === copied.entity.id);
  assert.deepEqual(storedOriginal.defaultReason, {
    mode: "custom",
    template: "general",
    text: "{{event}} 后生效",
  });
  assert.deepEqual(storedCopy.defaultReason, storedOriginal.defaultReason);
  assert.notEqual(storedCopy.defaultReason, storedOriginal.defaultReason);
  assert.deepEqual(restarted.dataset.effectGroups.find(({ id }) => id === activeDefinitionId).defaultReason, {
    mode: "custom",
    template: "relationship",
    text: "只供新实例使用",
  });
  assert.deepEqual(restarted.dataset.activeEffects[0].reason, oldInstanceReason);
});

test("rule activation resolves custom variables and template reasons into immutable instances and immediate records", async () => {
  const dataset = baseV3Dataset();
  dataset.conditions = [condition("condition_custom"), condition("condition_template")];
  dataset.effectGroups = [
    effectGroup(
      "effect_group_custom",
      "自定义效果",
      {
        mode: "custom",
        template: "general",
        text: "{{triggerActorName}}|{{ruleName}}|{{effectGroupName}}|{{fieldName}}|{{event}}",
      },
      1,
    ),
    effectGroup(
      "effect_group_template",
      "模板效果",
      { mode: "template", template: "negative", text: "" },
      2,
    ),
  ];
  dataset.rules = [
    rule("rule_custom", "自定义规则", "condition_custom", "effect_group_custom", 0),
    rule("rule_template", "模板规则", "condition_template", "effect_group_template", 1),
  ];

  const result = await processPersistedMessageV3({
    dataset,
    context: { chatId: "chat_main", actorId: "actor_t", groupId: "group_main", actorName: "角色T" },
    currentActorId: "actor_t",
    messageId: "message_reason",
    variantId: null,
    content: "B事件",
    role: "user",
    occurredAt: NOW,
    signals: {
      recentPositiveCount: null,
      userCareDetected: null,
      lastInteractionAt: null,
      messageCountInLast24Hours: null,
      specialDayDetected: null,
    },
  });

  assert.deepEqual(result.dataset.activeEffects.map(({ reason }) => reason), [
    {
      mode: "custom",
      template: "general",
      text: "角色T|自定义规则|自定义效果|Affinity|B事件",
    },
    { mode: "template", template: "negative", text: "临时减益" },
  ]);
  assert.deepEqual(result.records.map(({ reason }) => reason), [
    "规则触发：自定义规则；效果：角色T|自定义规则|自定义效果|Affinity|B事件",
    "规则触发：模板规则；效果：临时减益",
  ]);
  assert.equal(result.records.some(({ reason }) => reason.endsWith("激活效果组")), false);
});

test("manual activation uses the definition default unless the caller explicitly overrides it", () => {
  const dataset = baseV3Dataset();
  const definition = effectGroup(
    "effect_group_manual",
    "手动效果",
    { mode: "custom", template: "general", text: "{{effectGroupName}}/{{fieldName}}" },
  );
  const automatic = activateEffectGroup({
    definition,
    fields: dataset.fields,
    triggerActorId: "actor_t",
    instanceId: "active_manual_default",
    activatedAt: NOW_ISO,
  });
  const overridden = activateEffectGroup({
    definition,
    fields: dataset.fields,
    triggerActorId: "actor_t",
    instanceId: "active_manual_override",
    activatedAt: NOW_ISO,
    reason: { mode: "template", template: "positive" },
  });

  assert.equal(automatic.instances[0].reason.text, "手动效果/Affinity");
  assert.deepEqual(overridden.instances[0].reason, {
    mode: "template",
    template: "positive",
    text: "临时增益",
  });
});

test("IPC and v3 validation accept exact reason configs and reject unknown blank or oversized values", () => {
  const validRequest = {
    expectedRevision: 1,
    effectGroup: effectGroupInput({ mode: "template", template: "general", text: "" }),
  };
  assert.deepEqual(MVU_REQUEST_PARSERS.createEffectGroup(validRequest), validRequest);
  assert.deepEqual(MVU_REQUEST_PARSERS.updateEffectGroup({
    id: "effect_group_reason",
    expectedRevision: 1,
    patch: { defaultReason: { mode: "custom", template: "general", text: "更新原因" } },
  }), {
    id: "effect_group_reason",
    expectedRevision: 1,
    patch: { defaultReason: { mode: "custom", template: "general", text: "更新原因" } },
  });

  const invalidReasons = [
    { mode: "custom", template: "general", text: "   " },
    { mode: "custom", template: "general", text: "x".repeat(513) },
    { mode: "template", template: "general", text: "", injected: true },
  ];
  for (const defaultReason of invalidReasons) {
    assert.throws(() => MVU_REQUEST_PARSERS.createEffectGroup({
      expectedRevision: 1,
      effectGroup: effectGroupInput(defaultReason),
    }), /MVU_EFFECT_REASON_CONFIG_INVALID/);
    assert.throws(() => MVU_REQUEST_PARSERS.updateEffectGroup({
      id: "effect_group_reason",
      expectedRevision: 1,
      patch: { defaultReason },
    }), /MVU_EFFECT_REASON_CONFIG_INVALID/);

  }
  for (const defaultReason of [invalidReasons[0], invalidReasons[2]]) {
    const dataset = baseV3Dataset();
    dataset.effectGroups = [effectGroup("effect_group_invalid", "无效", defaultReason)];
    assert.throws(() => assertMvuDatasetV3(dataset), /MVU_V3_EFFECT_REASON_CONFIG_INVALID/);
  }
  const legacySized = baseV3Dataset();
  legacySized.effectGroups = [effectGroup("effect_group_legacy_sized", "兼容", invalidReasons[1])];
  assert.doesNotThrow(() => assertMvuDatasetV3(legacySized));
});

test("v2 compatibility reads definition reasons and updates defaults without rewriting active snapshots", async () => {
  const seeded = migrateDatasetV2ToV3(legacyDatasetFixture(), NOW).dataset;
  seeded.effectGroups[0].defaultReason = {
    mode: "custom",
    template: "relationship",
    text: "定义默认原因",
  };
  seeded.activeEffects[0].reason = {
    mode: "custom",
    template: "general",
    text: "旧实例快照",
  };
  const files = createFakeMvuFileApi({ [V3_PATH]: JSON.stringify(seeded, null, 2) });
  const store = v3Store(files);

  const compatibility = await store.read();
  assert.deepEqual({
    reasonMode: compatibility.dataset.temporaryEffects[0].reasonMode,
    reasonTemplate: compatibility.dataset.temporaryEffects[0].reasonTemplate,
    reason: compatibility.dataset.temporaryEffects[0].reason,
  }, {
    reasonMode: "custom",
    reasonTemplate: "relationship",
    reason: "定义默认原因",
  });

  const next = structuredClone(compatibility.dataset);
  next.temporaryEffects[0].reasonMode = "custom";
  next.temporaryEffects[0].reasonTemplate = "environment";
  const updatedLegacyText = "更新".repeat(300);
  next.temporaryEffects[0].reason = updatedLegacyText;
  await store.transact(compatibility.revision, next);

  const after = await store.readV3();
  assert.deepEqual(after.dataset.effectGroups[0].defaultReason, {
    mode: "custom",
    template: "environment",
    text: updatedLegacyText,
  });
  assert.deepEqual(after.dataset.activeEffects[0].reason, {
    mode: "custom",
    template: "general",
    text: "旧实例快照",
  });
});

test("million-character events and oversized display names render bounded deterministic snapshots and records", async () => {
  const dataset = baseV3Dataset();
  const hugeEvent = "事".repeat(1_000_000);
  const hugeName = "名".repeat(20_000);
  dataset.fields[0].name = hugeName;
  dataset.conditions = [condition("condition_bounded")];
  dataset.effectGroups = [effectGroup(
    "effect_group_bounded",
    hugeName,
    {
      mode: "custom",
      template: "general",
      text: "{{triggerActorName}}|{{ruleName}}|{{effectGroupName}}|{{fieldName}}|{{event}}",
    },
  )];
  dataset.rules = [rule("rule_bounded", hugeName, "condition_bounded", "effect_group_bounded", 0)];
  const input = {
    dataset,
    context: { chatId: "chat_main", actorId: "actor_t", groupId: "group_main", actorName: hugeName },
    currentActorId: "actor_t",
    messageId: "message_bounded",
    variantId: null,
    content: hugeEvent,
    role: "user",
    occurredAt: NOW,
    signals: {
      recentPositiveCount: null,
      userCareDetected: null,
      lastInteractionAt: null,
      messageCountInLast24Hours: null,
      specialDayDetected: null,
    },
  };

  const first = await processPersistedMessageV3(structuredClone(input));
  const second = await processPersistedMessageV3(structuredClone(input));
  const firstReason = first.dataset.activeEffects[0].reason.text;
  assert.equal(firstReason, second.dataset.activeEffects[0].reason.text);
  assert.ok(firstReason.length > 0 && firstReason.length <= EFFECT_REASON_RENDERED_MAX_LENGTH);
  assert.ok(first.records[0].reason.length <= EFFECT_REASON_RENDERED_MAX_LENGTH);
  const persistedFact = Object.values(first.dataset.messageFacts).flat().at(-1);
  assert.equal(persistedFact.content.length, 2_000);
  assert.doesNotThrow(() => assertMvuDatasetV3(first.dataset));
  assert.doesNotThrow(() => assertDataChangeRecord(first.records[0]));
});

test("legacy v2 reasons preserve ordinary oversized text and deterministically cap pathological text", async () => {
  const compatibleText = "旧".repeat(EFFECT_REASON_SOURCE_MAX_LENGTH + 88);
  const compatibleV2 = legacyDatasetFixture();
  compatibleV2.temporaryEffects[0].reasonMode = "custom";
  compatibleV2.temporaryEffects[0].reason = compatibleText;
  const compatible = migrateDatasetV2ToV3(compatibleV2, NOW);
  assert.equal(compatible.dataset.effectGroups[0].defaultReason.text, compatibleText);
  assert.equal(compatible.dataset.activeEffects[0].reason.text, compatibleText);
  assert.deepEqual(compatible.report.warnings, []);

  const compatibleFiles = filesWithV2(compatibleV2);
  const compatibleStore = v3Store(compatibleFiles, compatibleV2);
  assert.equal((await compatibleStore.initialize()).mode, "v3");
  assert.equal((await compatibleStore.read()).dataset.temporaryEffects[0].reason, compatibleText);
  assert.equal((await v3Store(compatibleFiles, compatibleV2).readV3()).dataset.effectGroups[0].defaultReason.text, compatibleText);

  const pathologicalText = "病".repeat(EFFECT_REASON_LEGACY_STORAGE_MAX_LENGTH + 10_000);
  const pathologicalV2 = legacyDatasetFixture();
  pathologicalV2.temporaryEffects[0].reasonMode = "custom";
  pathologicalV2.temporaryEffects[0].reason = pathologicalText;
  const pathological = migrateDatasetV2ToV3(pathologicalV2, NOW);
  assert.equal(pathological.dataset.effectGroups[0].defaultReason.text.length, EFFECT_REASON_LEGACY_STORAGE_MAX_LENGTH);
  assert.equal(
    pathological.dataset.effectGroups[0].defaultReason.text,
    pathologicalText.slice(0, EFFECT_REASON_LEGACY_STORAGE_MAX_LENGTH),
  );
  assert.equal(pathological.dataset.activeEffects[0].reason.text.length, EFFECT_REASON_RENDERED_MAX_LENGTH);
  assert.match(pathological.report.warnings.join("\n"), /MVU_EFFECT_REASON_LEGACY_TRUNCATED/);

  const pathologicalFiles = filesWithV2(pathologicalV2);
  const pathologicalStore = v3Store(pathologicalFiles, pathologicalV2);
  const status = await pathologicalStore.initialize();
  assert.equal(status.mode, "v3");
  assert.match(status.report.warnings.join("\n"), /MVU_EFFECT_REASON_LEGACY_TRUNCATED/);
  const beforeRestart = await pathologicalStore.readV3();
  const afterRestart = await v3Store(pathologicalFiles, pathologicalV2).readV3();
  assert.deepEqual(afterRestart.dataset.effectGroups[0].defaultReason, beforeRestart.dataset.effectGroups[0].defaultReason);
  assert.deepEqual(afterRestart.dataset.activeEffects[0].reason, beforeRestart.dataset.activeEffects[0].reason);
});

test("v3 validation is pure and normal create or transact cannot backfill a missing default reason", async () => {
  const valid = deepFreeze(baseV3Dataset());
  const validJson = JSON.stringify(valid);
  assert.doesNotThrow(() => assertMvuDatasetV3(valid));
  assert.equal(JSON.stringify(valid), validJson);

  const missing = baseV3Dataset();
  missing.effectGroups = [effectGroup(
    "effect_group_missing",
    "缺少原因",
    { mode: "template", template: "general", text: "" },
  )];
  delete missing.effectGroups[0].defaultReason;
  const missingJson = JSON.stringify(missing);
  deepFreeze(missing);
  assert.throws(() => assertMvuDatasetV3(missing), /INVALID_MVU_V3_EFFECT_GROUP/);
  assert.equal(JSON.stringify(missing), missingJson);

  const files = filesWithV2();
  const store = v3Store(files);
  await store.initialize();
  const snapshot = await store.readV3();
  const invalidCommit = structuredClone(snapshot.dataset);
  delete invalidCommit.effectGroups[0].defaultReason;
  await assert.rejects(
    store.transactV3(snapshot.revision, invalidCommit, []),
    /INVALID_MVU_V3_EFFECT_GROUP/,
  );
  assert.equal((await store.readV3()).revision, snapshot.revision);
  await assert.rejects(
    store.transactV3(
      snapshot.revision,
      structuredClone(snapshot.dataset),
      [changeRecord("x".repeat(EFFECT_REASON_RENDERED_MAX_LENGTH + 1))],
    ),
    /INVALID_MVU_CHANGE_RECORD/,
  );
  assert.equal((await store.readV3()).revision, snapshot.revision);

  const queries = new MvuQueryService(store, { now: () => NOW, createId: (prefix) => `${prefix}_missing` });
  const missingInput = effectGroupInput({ mode: "template", template: "general", text: "" });
  delete missingInput.defaultReason;
  await assert.rejects(
    queries.createEffectGroup({ expectedRevision: snapshot.revision, effectGroup: missingInput }),
    /MVU_EFFECT_REASON_CONFIG_INVALID/,
  );
});

test("active snapshots and persisted records require exact bounded rendered reasons", () => {
  const dataset = baseV3Dataset();
  const definition = effectGroup(
    "effect_group_active_validation",
    "活动效果",
    { mode: "template", template: "general", text: "" },
  );
  dataset.effectGroups = [definition];
  dataset.activeEffects = activateEffectGroup({
    definition,
    fields: dataset.fields,
    triggerActorId: "actor_t",
    instanceId: "active_validation",
    activatedAt: NOW_ISO,
  }).instances;
  dataset.activeEffects[0].reason.injected = true;
  assert.throws(() => assertMvuDatasetV3(dataset), /MVU_V3_ACTIVE_EFFECT_REASON_INVALID/);

  const oversized = structuredClone(dataset);
  delete oversized.activeEffects[0].reason.injected;
  oversized.activeEffects[0].reason.text = "x".repeat(EFFECT_REASON_RENDERED_MAX_LENGTH + 1);
  assert.throws(() => assertMvuDatasetV3(oversized), /MVU_V3_ACTIVE_EFFECT_REASON_INVALID/);

  const record = changeRecord("x".repeat(EFFECT_REASON_RENDERED_MAX_LENGTH + 1));
  assert.throws(() => assertDataChangeRecord(record), /INVALID_MVU_CHANGE_RECORD/);
});

test("new query API keeps the 512 source limit while legacy definitions remain activatable", async () => {
  const files = filesWithV2();
  const store = v3Store(files);
  await store.initialize();
  const queries = new MvuQueryService(store, {
    now: () => NOW,
    createId: (prefix) => `${prefix}_source_bound`,
  });
  const revision = (await store.readV3()).revision;
  const tooLong = { mode: "custom", template: "general", text: "x".repeat(EFFECT_REASON_SOURCE_MAX_LENGTH + 1) };
  await assert.rejects(
    queries.createEffectGroup({ expectedRevision: revision, effectGroup: effectGroupInput(tooLong) }),
    /MVU_EFFECT_REASON_CONFIG_INVALID/,
  );
  const existingId = (await store.readV3()).dataset.effectGroups[0].id;
  await assert.rejects(
    queries.updateEffectGroup({ id: existingId, expectedRevision: revision, patch: { defaultReason: tooLong } }),
    /MVU_EFFECT_REASON_CONFIG_INVALID/,
  );

  const legacyText = "旧".repeat(EFFECT_REASON_SOURCE_MAX_LENGTH + 1);
  const legacyV2 = legacyDatasetFixture();
  legacyV2.temporaryEffects[0].reasonMode = "custom";
  legacyV2.temporaryEffects[0].reason = legacyText;
  const legacyV3 = migrateDatasetV2ToV3(legacyV2, NOW).dataset;
  const activation = activateEffectGroup({
    definition: legacyV3.effectGroups[0],
    fields: legacyV3.fields,
    instanceId: "active_legacy_reason",
    activatedAt: NOW_ISO,
  });
  assert.equal(activation.instances[0].reason.text, legacyText);

  assert.throws(() => activateEffectGroup({
    definition: legacyV3.effectGroups[0],
    fields: legacyV3.fields,
    instanceId: "active_explicit_reason",
    activatedAt: NOW_ISO,
    reason: tooLong,
  }), /MVU_EFFECT_REASON_TOO_LONG/);
});
