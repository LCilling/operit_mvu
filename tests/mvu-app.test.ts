/** MVU v2 application-state, transaction, and persistence tests. */
import assert from "node:assert/strict";
import test from "node:test";

import { createRuntime } from "../src/mvu/app/index";
import type { ApplyCommandAudit } from "../src/mvu/app/mvu-bridge";
import type {
  DataActor,
  DataAutoRule,
  DataField,
  DataLinkRule,
  DataTemporaryEffect,
  MessageAutomationSignals,
  MvuDataset,
  StateScope,
  StateScopeContext,
} from "../src/mvu/app/model";
import { buildSeedDataset } from "../src/mvu/app/seed";
import type {
  PersistedAiChange,
  PersistedMessageInput,
} from "../src/mvu/app/service";
import {
  FileMvuStore,
  InMemoryMvuStore,
  type MvuFileApi,
} from "../src/mvu/app/store";

const CONTEXT_A: StateScopeContext = {
  chatId: "chat_a",
  actorId: "actor_a",
  groupId: "group_shared",
  actorName: "角色甲",
};

const CONTEXT_B: StateScopeContext = {
  chatId: "chat_b",
  actorId: "actor_b",
  groupId: "group_shared",
  actorName: "角色乙",
};

const ACTOR_A: DataActor = { characterId: "actor_a", name: "角色甲", enabled: true };

const NO_SIGNALS: MessageAutomationSignals = {
  recentPositiveCount: null,
  userCareDetected: null,
  lastInteractionAt: null,
  messageCountInLast24Hours: null,
  specialDayDetected: null,
};

function testField(
  id: string,
  scope: StateScope = "character",
  bindingIds: readonly string[] = ["actor_a"]
): DataField {
  const base = buildSeedDataset(1_000).fields[0];
  return {
    ...base,
    id,
    name: id,
    scope,
    bindingIds: scope === "global" ? [] : [...bindingIds],
    enabled: true,
    ai: { ...base.ai, enabled: false },
    stages: base.stages.map((stage) => ({ ...stage })),
    naturalChange: { enabled: false, unitMs: 1_000, amount: 0 },
    perTurnChange: { enabled: false, intervalTurns: 1, amount: 0, countMode: "both" },
  };
}

function testDataset(options: {
  fields: DataField[];
  rules?: DataLinkRule[];
  autoRules?: DataAutoRule[];
  temporaryEffects?: DataTemporaryEffect[];
  pendingBootstrapFieldIds?: string[];
}): MvuDataset {
  return {
    ...buildSeedDataset(1_000),
    fields: options.fields,
    pendingBootstrapFieldIds: options.pendingBootstrapFieldIds ?? [],
    rules: options.rules ?? [],
    autoRules: options.autoRules ?? [],
    temporaryEffects: options.temporaryEffects ?? [],
  };
}

function createTestRuntime(
  dataset: MvuDataset = buildSeedDataset(1_000),
  actors: DataActor[] = []
) {
  return createRuntime({ store: new InMemoryMvuStore(dataset), initialActors: actors });
}

function message(options: {
  context?: StateScopeContext;
  messageId: string;
  variantId?: string | null;
  content?: string;
  role: "user" | "character";
  occurredAt: number;
  signals?: MessageAutomationSignals;
  aiChanges?: readonly PersistedAiChange[];
}): PersistedMessageInput {
  return {
    context: options.context ?? CONTEXT_A,
    messageId: options.messageId,
    variantId: options.variantId ?? null,
    content: options.content ?? `content:${options.messageId}`,
    role: options.role,
    occurredAt: options.occurredAt,
    signals: options.signals ?? NO_SIGNALS,
    aiChanges: options.aiChanges ?? [],
  };
}

function audit(occurredAt: number, requestedDelta: number | null = null): ApplyCommandAudit {
  return {
    reason: "测试变更",
    source: "manual",
    requestedDelta,
    ruleIds: [],
    confidence: null,
    messageId: null,
    variantId: null,
    occurredAt,
  };
}

class MemoryMvuFiles implements MvuFileApi {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.directories.has(path);
  }

  async readText(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`FILE_NOT_FOUND:${path}`);
    return content;
  }

  async writeText(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async move(source: string, destination: string): Promise<void> {
    const content = this.files.get(source);
    if (content === undefined) throw new Error(`FILE_NOT_FOUND:${source}`);
    this.files.set(destination, content);
    this.files.delete(source);
  }

  async mkdir(path: string): Promise<void> {
    this.directories.add(path);
  }
}

test("v2 seed has templates but no fake identities or runtime history", async () => {
  const dataset = buildSeedDataset(123);
  assert.equal(dataset.formatVersion, 2);
  assert.equal(dataset.createdAt, 123);
  assert.equal(dataset.fields.length > 0, true);
  assert.equal(dataset.fields.every((field) => field.bindingIds.length === 0), true);
  assert.deepEqual(
    dataset.pendingBootstrapFieldIds,
    dataset.fields.filter((field) => field.scope !== "global").map((field) => field.id)
  );
  assert.deepEqual(dataset.stateValues, {});
  assert.deepEqual(dataset.records, []);
  assert.deepEqual(dataset.temporaryEffects, []);

  const runtime = createTestRuntime(dataset, [ACTOR_A]);
  await runtime.bootstrapActors([CONTEXT_A]);
  const bootstrapped = await runtime.dataset();
  assert.equal(
    bootstrapped.fields
      .filter((field) => field.scope === "character")
      .every((field) => field.bindingIds.includes("actor_a")),
    true
  );
  assert.deepEqual(bootstrapped.pendingBootstrapFieldIds, []);
  assert.deepEqual(bootstrapped.stateValues, {});
});

test("bootstrap initializes only empty templates and never expands manual bindings", async () => {
  const manuallyBound = testField("field_manual_binding", "character", ["actor_a"]);
  const untouchedTemplate = testField("field_empty_binding", "character", []);
  const runtime = createTestRuntime(testDataset({
    fields: [manuallyBound, untouchedTemplate],
    pendingBootstrapFieldIds: [untouchedTemplate.id],
  }));

  await runtime.bootstrapActors([CONTEXT_B]);
  let dataset = await runtime.dataset();
  assert.deepEqual(
    dataset.fields.find((field) => field.id === manuallyBound.id)?.bindingIds,
    ["actor_a"]
  );
  assert.deepEqual(
    dataset.fields.find((field) => field.id === untouchedTemplate.id)?.bindingIds,
    ["actor_b"]
  );
  assert.deepEqual(dataset.pendingBootstrapFieldIds, []);

  await runtime.bootstrapActors([CONTEXT_A]);
  dataset = await runtime.dataset();
  assert.deepEqual(
    dataset.fields.find((field) => field.id === untouchedTemplate.id)?.bindingIds,
    ["actor_b"]
  );
});

test("a user-cleared final binding is never restored by later actor discovery", async () => {
  const field = testField("field_user_cleared_binding", "character", []);
  const runtime = createTestRuntime(testDataset({
    fields: [field],
    pendingBootstrapFieldIds: [field.id],
  }));

  await runtime.bootstrapActors([CONTEXT_A]);
  assert.deepEqual((await runtime.dataset()).fields[0].bindingIds, ["actor_a"]);
  await runtime.service.updateField(field.id, { bindingIds: [] });
  let dataset = await runtime.dataset();
  assert.deepEqual(dataset.fields[0].bindingIds, []);
  assert.deepEqual(dataset.pendingBootstrapFieldIds, []);

  await runtime.bootstrapActors([CONTEXT_B]);
  dataset = await runtime.dataset();
  assert.deepEqual(dataset.fields[0].bindingIds, []);
  assert.deepEqual(dataset.pendingBootstrapFieldIds, []);
});

test("character/group/global/chat values use exact isolated scope keys", async () => {
  const fields = [
    testField("field_character", "character", ["actor_a", "actor_b"]),
    testField("field_group", "group", ["group_shared"]),
    testField("field_global", "global"),
    testField("field_chat", "chat", ["chat_a", "chat_b"]),
  ];
  const runtime = createTestRuntime(testDataset({ fields }));
  const changes = [
    { fieldId: "field_character", value: 40, occurredAt: 2_000 },
    { fieldId: "field_group", value: 45, occurredAt: 2_001 },
    { fieldId: "field_global", value: 55, occurredAt: 2_002 },
    { fieldId: "field_chat", value: 60, occurredAt: 2_003 },
  ];
  for (const change of changes) {
    await runtime.service.setStateValue({
      context: CONTEXT_A,
      ...change,
      reason: "范围测试",
      source: "manual",
      ruleIds: [],
      confidence: null,
      messageId: null,
      variantId: null,
    });
  }
  assert.equal(await runtime.service.getStateValue(CONTEXT_B, "field_character"), 30);
  assert.equal(await runtime.service.getStateValue(CONTEXT_B, "field_group"), 45);
  assert.equal(await runtime.service.getStateValue(CONTEXT_B, "field_global"), 55);
  assert.equal(await runtime.service.getStateValue(CONTEXT_B, "field_chat"), 30);
  const dataset = await runtime.dataset();
  assert.equal(dataset.stateValues["character:actor_a"].field_character, 40);
  assert.equal(dataset.stateValues["group:group_shared"].field_group, 45);
  assert.equal(dataset.stateValues.global.field_global, 55);
  assert.equal(dataset.stateValues["chat:chat_a"].field_chat, 60);
});

test("snapshot projects context, actors, definition, value, stage, and binding", async () => {
  const runtime = createTestRuntime(
    testDataset({ fields: [testField("field_snapshot")] }),
    [ACTOR_A]
  );
  const snapshot = await runtime.snapshot(CONTEXT_A);
  assert.deepEqual(snapshot.activeContext, CONTEXT_A);
  assert.deepEqual(snapshot.actors, [ACTOR_A]);
  assert.equal(snapshot.fields[0].definition.id, "field_snapshot");
  assert.equal(snapshot.fields[0].bound, true);
  assert.equal(snapshot.fields[0].scopeKey, "character:actor_a");
  assert.equal(snapshot.fields[0].currentValue, 30);
  assert.equal(snapshot.fields[0].currentStage?.id, "stage_1");
  assert.equal("stateValues" in snapshot, false);
  assert.deepEqual(snapshot.temporaryEffects, []);
});

test("group prompt includes every member character state and one shared projection", async () => {
  const character = testField("field_member", "character", ["actor_a", "actor_b"]);
  const group = testField("field_group_prompt", "group", ["group_shared"]);
  const chat = testField("field_chat_prompt", "chat", ["chat_group"]);
  const global = testField("field_global_prompt", "global");
  const hidden = testField("field_hidden_prompt", "global");
  hidden.modelVisibility = "hidden";
  const stageOnly = testField("field_stage_prompt", "global");
  stageOnly.modelVisibility = "stage_only";
  const runtime = createTestRuntime(testDataset({
    fields: [character, group, chat, global, hidden, stageOnly],
  }));
  const groupContext: StateScopeContext = {
    chatId: "chat_group",
    actorId: null,
    groupId: "group_shared",
    actorName: "群聊",
  };
  const memberA = { ...CONTEXT_A, chatId: "chat_group" };
  const memberB = { ...CONTEXT_B, chatId: "chat_group" };
  const prompt = await runtime.buildStateSection(groupContext, [memberA, memberB, memberA]);
  assert.equal((prompt.match(/field_member: 30/g) ?? []).length, 2);
  assert.equal((prompt.match(/field_group_prompt: 30/g) ?? []).length, 1);
  assert.equal((prompt.match(/field_chat_prompt: 30/g) ?? []).length, 1);
  assert.equal((prompt.match(/field_global_prompt: 30/g) ?? []).length, 1);
  assert.equal(prompt.includes("field_hidden_prompt"), false);
  assert.match(prompt, /field_stage_prompt: 阶段「熟悉」/);
});

test("message processing uses chat/message/variant idempotency and paired turn counts", async () => {
  const turnField = testField("field_turn");
  turnField.perTurnChange = { enabled: true, intervalTurns: 1, amount: 2, countMode: "both" };
  const runtime = createTestRuntime(testDataset({ fields: [turnField] }));
  const user = message({ messageId: "message_1", role: "user", occurredAt: 2_000 });
  const character = message({ messageId: "message_2", role: "character", occurredAt: 2_001 });
  assert.equal((await runtime.processPersistedMessage(user)).duplicate, false);
  assert.equal(await runtime.service.getStateValue(CONTEXT_A, "field_turn"), 30);
  assert.equal((await runtime.processPersistedMessage(character)).duplicate, false);
  assert.equal(await runtime.service.getStateValue(CONTEXT_A, "field_turn"), 32);
  assert.equal(await runtime.hasProcessedMessage({
    context: CONTEXT_A,
    messageId: "message_2",
    variantId: null,
  }), true);
  assert.equal(await runtime.hasProcessedMessage({
    context: CONTEXT_A,
    messageId: "message_2",
    variantId: "original:null",
  }), false);

  const beforeDuplicate = await runtime.dataset();
  assert.equal((await runtime.processPersistedMessage(character)).duplicate, true);
  assert.equal((await runtime.dataset()).revision, beforeDuplicate.revision);

  assert.equal((await runtime.processPersistedMessage(message({
    messageId: "message_2",
    variantId: "original:null",
    role: "character",
    occurredAt: 2_002,
  }))).duplicate, false);
  assert.equal((await runtime.processPersistedMessage(message({
    context: { ...CONTEXT_A, chatId: "chat_other" },
    messageId: "message_2",
    role: "user",
    occurredAt: 2_003,
  }))).duplicate, false);
  const dataset = await runtime.dataset();
  assert.equal(dataset.processedMessageIds.length, 4);
  assert.equal(new Set(dataset.processedMessageIds).size, 4);
});

test("recent facts retain capped content and only the latest twenty current-scope messages", async () => {
  const runtime = createTestRuntime(testDataset({ fields: [testField("field_facts")] }));
  for (let index = 0; index < 22; index += 1) {
    await runtime.processPersistedMessage(message({
      messageId: `fact_${index}`,
      content: index === 21 ? "长".repeat(2_100) : `消息${index}`,
      role: index % 2 === 0 ? "user" : "character",
      occurredAt: 3_000 + index,
    }));
  }
  await runtime.processPersistedMessage(message({
    context: { ...CONTEXT_A, chatId: "chat_other" },
    messageId: "other_scope",
    role: "user",
    occurredAt: 4_000,
  }));
  const recent = await runtime.getRecentMessageFacts(CONTEXT_A);
  assert.equal(recent.length, 20);
  assert.equal(recent[0].messageId, "fact_2");
  assert.equal(recent[19].messageId, "fact_21");
  assert.equal(recent[19].content.length, 2_000);
  assert.equal(recent.some((fact) => fact.messageId === "other_scope"), false);
  assert.equal((await runtime.getRecentMessageFacts(CONTEXT_A, 3)).length, 3);
});

test("automatic cooldown and link effects commit in one message transaction", async () => {
  const source = testField("field_source");
  const target = testField("field_target");
  const autoRule: DataAutoRule = {
    id: "auto_care_test", name: "主动关心", description: "测试", enabled: true,
    condition: { kind: "userCare" }, effects: [{ fieldId: source.id, delta: 10 }],
    cooldownMs: 1_000, order: 1,
  };
  const linkRule: DataLinkRule = {
    id: "rule_source_target", sourceFieldId: source.id, operator: ">=",
    sourceThreshold: 35, targetFieldId: target.id,
    effect: { kind: "delta", value: 5 }, enabled: true,
  };
  const runtime = createTestRuntime(testDataset({
    fields: [source, target], rules: [linkRule], autoRules: [autoRule],
  }));
  const careSignals = { ...NO_SIGNALS, userCareDetected: true };
  const first = await runtime.processPersistedMessage(message({
    messageId: "care_1", role: "user", occurredAt: 10_000, signals: careSignals,
  }));
  assert.deepEqual(first.matchedRuleIds, [autoRule.id]);
  assert.equal(first.records.length, 2);
  assert.equal(await runtime.service.getStateValue(CONTEXT_A, source.id), 40);
  assert.equal(await runtime.service.getStateValue(CONTEXT_A, target.id), 35);
  assert.equal((await runtime.dataset()).revision, 1);

  const cooled = await runtime.processPersistedMessage(message({
    messageId: "care_2", role: "user", occurredAt: 10_500, signals: careSignals,
  }));
  assert.deepEqual(cooled.matchedRuleIds, []);
  assert.deepEqual(cooled.records, []);
});

test("temporary effects alter deltas, are audited, expire, and consume turns", async () => {
  const field = testField("field_effect");
  field.perTurnChange = { enabled: true, intervalTurns: 1, amount: 2, countMode: "character" };
  const baseEffect = {
    targetFieldId: field.id,
    scope: "character" as const,
    scopeKey: "character:actor_a",
    enabled: true,
    remainingTurns: 1,
    createdAt: 1_000,
  };
  const effects: DataTemporaryEffect[] = [
    { ...baseEffect, id: "effect_multiplier", mode: "multiplier", value: 2,
      expiresAt: null, reason: "双倍", source: "manual" },
    { ...baseEffect, id: "effect_additive", mode: "additive", value: 1,
      expiresAt: null, reason: "额外", source: "rule" },
    { ...baseEffect, id: "effect_expired", mode: "additive", value: 100,
      expiresAt: 1_500, remainingTurns: null, reason: "过期", source: "ai" },
  ];
  const runtime = createTestRuntime(testDataset({ fields: [field], temporaryEffects: effects }));
  const first = await runtime.processPersistedMessage(message({
    messageId: "effect_1", role: "character", occurredAt: 2_000,
  }));
  assert.equal(first.records[0].requestedDelta, 2);
  assert.equal(first.records[0].effectiveRequestedDelta, 5);
  assert.deepEqual(first.records[0].effectIds, ["effect_multiplier", "effect_additive"]);
  assert.equal(await runtime.service.getStateValue(CONTEXT_A, field.id), 35);
  let dataset = await runtime.dataset();
  assert.equal(dataset.temporaryEffects.every((effect) => !effect.enabled), true);
  assert.equal(dataset.temporaryEffects[0].remainingTurns, 0);

  const second = await runtime.processPersistedMessage(message({
    messageId: "effect_2", role: "character", occurredAt: 3_000,
  }));
  assert.equal(second.records[0].effectiveRequestedDelta, 2);
  assert.deepEqual(second.records[0].effectIds, []);
  assert.equal(await runtime.service.getStateValue(CONTEXT_A, field.id), 37);
  dataset = await runtime.dataset();
  assert.equal(dataset.records.length, 2);
});

test("manual absolute edits ignore temporary effects and preserve the entered value", async () => {
  const field = testField("field_manual_effect");
  const effect: DataTemporaryEffect = {
    id: "effect_manual_ignored",
    targetFieldId: field.id,
    scope: "character",
    scopeKey: "character:actor_a",
    mode: "multiplier",
    value: 3,
    enabled: true,
    expiresAt: null,
    remainingTurns: null,
    reason: "仅影响自动变化",
    source: "manual",
    createdAt: 1_000,
  };
  const runtime = createTestRuntime(testDataset({
    fields: [field],
    temporaryEffects: [effect],
  }));
  const result = await runtime.service.setStateValue({
    context: CONTEXT_A,
    fieldId: field.id,
    value: 50,
    reason: "用户直接输入",
    source: "manual",
    ruleIds: [],
    confidence: null,
    messageId: null,
    variantId: null,
    occurredAt: 2_000,
  });
  assert.equal(result.record?.after, 50);
  assert.equal(result.record?.requestedDelta, 20);
  assert.equal(result.record?.effectiveRequestedDelta, 20);
  assert.deepEqual(result.record?.effectIds, []);
});

test("manual absolute edits trigger linked rule records while zero changes trigger nothing", async () => {
  const source = testField("field_manual_link_source");
  const target = testField("field_manual_link_target");
  const link: DataLinkRule = {
    id: "rule_manual_link",
    sourceFieldId: source.id,
    operator: ">=",
    sourceThreshold: 40,
    targetFieldId: target.id,
    effect: { kind: "delta", value: 5 },
    enabled: true,
  };
  const effects: DataTemporaryEffect[] = [
    {
      id: "effect_manual_source_ignored",
      targetFieldId: source.id,
      scope: "character",
      scopeKey: "character:actor_a",
      mode: "multiplier",
      value: 3,
      enabled: true,
      expiresAt: null,
      remainingTurns: null,
      reason: "手工主值不使用",
      source: "manual",
      createdAt: 1_000,
    },
    {
      id: "effect_manual_link_target",
      targetFieldId: target.id,
      scope: "character",
      scopeKey: "character:actor_a",
      mode: "multiplier",
      value: 2,
      enabled: true,
      expiresAt: null,
      remainingTurns: null,
      reason: "联动目标加速",
      source: "rule",
      createdAt: 1_000,
    },
  ];
  const runtime = createTestRuntime(testDataset({
    fields: [source, target],
    rules: [link],
    temporaryEffects: effects,
  }));
  const input = {
    context: CONTEXT_A,
    fieldId: source.id,
    value: 40,
    reason: "用户绝对设置",
    source: "manual" as const,
    ruleIds: [],
    confidence: null,
    messageId: null,
    variantId: null,
    occurredAt: 2_000,
  };
  const result = await runtime.service.setStateValue(input);
  assert.equal(result.record?.after, 40);
  assert.equal(result.record?.source, "manual");
  assert.deepEqual(result.record?.effectIds, []);
  let dataset = await runtime.dataset();
  assert.equal(dataset.stateValues["character:actor_a"][source.id], 40);
  assert.equal(dataset.stateValues["character:actor_a"][target.id], 40);
  assert.equal(dataset.records.length, 2);
  const linked = dataset.records.find((record) => record.fieldId === target.id);
  assert.equal(linked?.source, "rule");
  assert.deepEqual(linked?.ruleIds, [link.id]);
  assert.equal(linked?.requestedDelta, 5);
  assert.equal(linked?.effectiveRequestedDelta, 10);
  assert.deepEqual(linked?.effectIds, ["effect_manual_link_target"]);

  const revision = dataset.revision;
  const unchanged = await runtime.service.setStateValue({ ...input, occurredAt: 2_001 });
  assert.equal(unchanged.changed, false);
  dataset = await runtime.dataset();
  assert.equal(dataset.revision, revision);
  assert.equal(dataset.records.length, 2);
});

test("temporary effects apply to natural, per-turn, rule, and AI changes", async () => {
  const sources = ["natural", "per_turn", "rule", "ai"] as const;
  const fields = sources.map((source) => testField(`field_effect_${source}`));
  const effects: DataTemporaryEffect[] = fields.map((field, index) => ({
    id: `effect_source_${index}`,
    targetFieldId: field.id,
    scope: "character",
    scopeKey: "character:actor_a",
    mode: "multiplier",
    value: 2,
    enabled: true,
    expiresAt: null,
    remainingTurns: null,
    reason: "自动变化加速",
    source: "manual",
    createdAt: 1_000,
  }));
  const runtime = createTestRuntime(testDataset({ fields, temporaryEffects: effects }));
  for (let index = 0; index < sources.length; index += 1) {
    const field = fields[index];
    const result = await runtime.applyCommand(
      CONTEXT_A,
      `_.add('states.${field.id}', 1);`,
      {
        ...audit(3_000 + index, 1),
        source: sources[index],
        confidence: sources[index] === "ai" ? 0.9 : null,
      }
    );
    assert.equal(result.record?.after, 32);
    assert.equal(result.record?.effectiveRequestedDelta, 2);
    assert.deepEqual(result.record?.effectIds, [effects[index].id]);
  }
});

test("AI candidates are revalidated and join per-turn/link effects in one atomic transaction", async () => {
  const source = testField("field_ai_source");
  source.ai = { enabled: true, minConfidence: 0.8, maxDelta: 5, prompt: "判断变化" };
  source.perTurnChange = { enabled: true, intervalTurns: 1, amount: 2, countMode: "character" };
  const target = testField("field_ai_target");
  const link: DataLinkRule = {
    id: "rule_ai_target",
    sourceFieldId: source.id,
    operator: ">=",
    sourceThreshold: 35,
    targetFieldId: target.id,
    effect: { kind: "delta", value: 4 },
    enabled: true,
  };
  const runtime = createTestRuntime(testDataset({ fields: [source, target], rules: [link] }));

  await assert.rejects(() => runtime.processPersistedMessage(message({
    messageId: "ai_rejected",
    role: "character",
    occurredAt: 20_000,
    aiChanges: [{ fieldId: source.id, delta: 6, reason: "越界", confidence: 0.9 }],
  })), /MVU_AI_DELTA_EXCEEDED/);
  let dataset = await runtime.dataset();
  assert.equal(dataset.revision, 0);
  assert.deepEqual(dataset.processedMessageIds, []);
  assert.deepEqual(dataset.turnCounters, {});
  assert.deepEqual(dataset.messageFacts, {});

  await assert.rejects(() => runtime.processPersistedMessage(message({
    messageId: "ai_low_confidence",
    role: "character",
    occurredAt: 20_001,
    aiChanges: [{ fieldId: source.id, delta: 3, reason: "低置信度", confidence: 0.7 }],
  })), /MVU_AI_CONFIDENCE_TOO_LOW/);
  assert.equal((await runtime.dataset()).revision, 0);

  const applied = await runtime.processPersistedMessage(message({
    messageId: "ai_applied",
    role: "character",
    occurredAt: 20_002,
    aiChanges: [{ fieldId: source.id, delta: 3, reason: "语气明显变暖", confidence: 0.9 }],
  }));
  assert.equal(applied.records.length, 2);
  dataset = await runtime.dataset();
  assert.equal(dataset.revision, 1);
  assert.equal(dataset.stateValues["character:actor_a"][source.id], 35);
  assert.equal(dataset.stateValues["character:actor_a"][target.id], 34);
  const sourceRecord = dataset.records.find((record) => record.fieldId === source.id);
  assert.equal(sourceRecord?.source, "ai");
  assert.equal(sourceRecord?.requestedDelta, 5);
  assert.equal(sourceRecord?.confidence, 0.9);
  assert.equal(sourceRecord?.reason, "语气明显变暖");
  const targetRecord = dataset.records.find((record) => record.fieldId === target.id);
  assert.equal(targetRecord?.source, "rule");
  assert.deepEqual(targetRecord?.ruleIds, [link.id]);
});

test("AI, per-turn, automatic, and link deltas preserve one complete field audit", async () => {
  const driver = testField("field_audit_driver");
  driver.ai = { enabled: true, minConfidence: 0.8, maxDelta: 5, prompt: "驱动" };
  const target = testField("field_audit_target");
  target.ai = { enabled: true, minConfidence: 0.8, maxDelta: 5, prompt: "目标" };
  target.perTurnChange = { enabled: true, intervalTurns: 1, amount: 2, countMode: "character" };
  const autoRule: DataAutoRule = {
    id: "auto_audit_target",
    name: "自动叠加",
    description: "审计测试",
    enabled: true,
    condition: { kind: "userCare" },
    effects: [{ fieldId: target.id, delta: 4 }],
    cooldownMs: 0,
    order: 1,
  };
  const linkRule: DataLinkRule = {
    id: "rule_audit_target",
    sourceFieldId: driver.id,
    operator: ">=",
    sourceThreshold: 31,
    targetFieldId: target.id,
    effect: { kind: "delta", value: 5 },
    enabled: true,
  };
  const runtime = createTestRuntime(testDataset({
    fields: [driver, target],
    rules: [linkRule],
    autoRules: [autoRule],
  }));
  await runtime.processPersistedMessage(message({
    messageId: "audit_all_sources",
    role: "character",
    occurredAt: 22_000,
    signals: { ...NO_SIGNALS, userCareDetected: true },
    aiChanges: [
      { fieldId: driver.id, delta: 1, reason: "AI驱动", confidence: 0.95 },
      { fieldId: target.id, delta: 3, reason: "AI目标", confidence: 0.9 },
    ],
  }));
  const targetRecord = (await runtime.dataset()).records.find((record) =>
    record.fieldId === target.id
  );
  assert.equal(targetRecord?.requestedDelta, 14);
  assert.equal(targetRecord?.source, "rule");
  assert.equal(targetRecord?.reason, "AI目标；消息规则结算");
  assert.equal(targetRecord?.confidence, 0.9);
  assert.deepEqual(targetRecord?.ruleIds, [autoRule.id, linkRule.id]);
});

test("AI candidates reject disabled dataset and disabled field switches", async () => {
  const disabledField = testField("field_ai_disabled");
  const fieldRuntime = createTestRuntime(testDataset({ fields: [disabledField] }));
  await assert.rejects(() => fieldRuntime.processPersistedMessage(message({
    messageId: "ai_field_disabled",
    role: "user",
    occurredAt: 21_000,
    aiChanges: [{ fieldId: disabledField.id, delta: 1, reason: "不应执行", confidence: 1 }],
  })), /MVU_FIELD_AI_DISABLED/);

  const enabledField = testField("field_ai_global_disabled");
  enabledField.ai = { enabled: true, minConfidence: 0, maxDelta: 5, prompt: "判断" };
  const disabledDataset = testDataset({ fields: [enabledField] });
  disabledDataset.settings.aiEnabled = false;
  const datasetRuntime = createTestRuntime(disabledDataset);
  await assert.rejects(() => datasetRuntime.processPersistedMessage(message({
    messageId: "ai_dataset_disabled",
    role: "user",
    occurredAt: 21_001,
    aiChanges: [{ fieldId: enabledField.id, delta: 1, reason: "不应执行", confidence: 1 }],
  })), /MVU_AI_DISABLED/);
});

test("applyAiJudgement commits AI, link, and temporary effects without fake message state", async () => {
  const source = testField("field_judgement_source");
  source.ai = { enabled: true, minConfidence: 0.8, maxDelta: 5, prompt: "判断" };
  source.naturalChange = { enabled: true, unitMs: 1_000, amount: 10 };
  const target = testField("field_judgement_target");
  const link: DataLinkRule = {
    id: "rule_judgement_target",
    sourceFieldId: source.id,
    operator: ">=",
    sourceThreshold: 32,
    targetFieldId: target.id,
    effect: { kind: "delta", value: 3 },
    enabled: true,
  };
  const autoRule: DataAutoRule = {
    id: "auto_not_used_by_judgement",
    name: "不应执行",
    description: "judgeState 不运行自动规则",
    enabled: true,
    condition: { kind: "userCare" },
    effects: [{ fieldId: target.id, delta: 20 }],
    cooldownMs: 0,
    order: 1,
  };
  const effect: DataTemporaryEffect = {
    id: "effect_judgement_source",
    targetFieldId: source.id,
    scope: "character",
    scopeKey: "character:actor_a",
    mode: "multiplier",
    value: 2,
    enabled: true,
    expiresAt: null,
    remainingTurns: 1,
    reason: "AI 加速",
    source: "ai",
    createdAt: 1_000,
  };
  const runtime = createTestRuntime(testDataset({
    fields: [source, target],
    rules: [link],
    autoRules: [autoRule],
    temporaryEffects: [effect],
  }));

  const records = await runtime.applyAiJudgement({
    context: CONTEXT_A,
    changes: [{
      fieldId: source.id,
      delta: 2,
      reason: "本轮明确更亲近",
      confidence: 0.9,
    }],
    occurredAt: 30_000,
  });
  assert.equal(records.length, 2);
  const dataset = await runtime.dataset();
  assert.equal(dataset.revision, 1);
  assert.equal(dataset.stateValues["character:actor_a"][source.id], 34);
  assert.equal(dataset.stateValues["character:actor_a"][target.id], 33);
  assert.deepEqual(dataset.processedMessageIds, []);
  assert.deepEqual(dataset.messageFacts, {});
  assert.deepEqual(dataset.turnCounters, {});
  assert.deepEqual(dataset.ruleLastTriggered, {});
  assert.deepEqual(dataset.lastSettled, {});
  assert.equal(dataset.temporaryEffects[0].remainingTurns, 1);
  const sourceRecord = records.find((record) => record.fieldId === source.id);
  assert.equal(sourceRecord?.source, "ai");
  assert.equal(sourceRecord?.messageId, null);
  assert.equal(sourceRecord?.variantId, null);
  assert.deepEqual(sourceRecord?.effectIds, [effect.id]);
  const targetRecord = records.find((record) => record.fieldId === target.id);
  assert.equal(targetRecord?.source, "rule");
  assert.deepEqual(targetRecord?.ruleIds, [link.id]);
});

test("applyAiJudgement rejects an invalid batch atomically before expiring effects", async () => {
  const first = testField("field_judgement_atomic_a");
  first.ai = { enabled: true, minConfidence: 0.8, maxDelta: 5, prompt: "判断" };
  const second = testField("field_judgement_atomic_b");
  second.ai = { enabled: true, minConfidence: 0.8, maxDelta: 5, prompt: "判断" };
  const expiringEffect: DataTemporaryEffect = {
    id: "effect_judgement_expiring",
    targetFieldId: first.id,
    scope: "character",
    scopeKey: "character:actor_a",
    mode: "additive",
    value: 1,
    enabled: true,
    expiresAt: 2_000,
    remainingTurns: null,
    reason: "等待事务验证",
    source: "ai",
    createdAt: 1_000,
  };
  const runtime = createTestRuntime(testDataset({
    fields: [first, second],
    temporaryEffects: [expiringEffect],
  }));

  await assert.rejects(() => runtime.applyAiJudgement({
    context: CONTEXT_A,
    changes: [
      { fieldId: first.id, delta: 2, reason: "有效候选", confidence: 0.9 },
      { fieldId: second.id, delta: 6, reason: "越界候选", confidence: 0.9 },
    ],
    occurredAt: 3_000,
  }), /MVU_AI_DELTA_EXCEEDED/);
  const dataset = await runtime.dataset();
  assert.equal(dataset.revision, 0);
  assert.deepEqual(dataset.stateValues, {});
  assert.deepEqual(dataset.records, []);
  assert.equal(dataset.temporaryEffects[0].enabled, true);
});

test("natural change writes a deterministic first anchor", async () => {
  const field = testField("field_natural");
  field.naturalChange = { enabled: true, unitMs: 1_000, amount: 1 };
  const runtime = createTestRuntime(testDataset({ fields: [field] }));
  assert.deepEqual(await runtime.service.settleNatural(CONTEXT_A, 5_000), []);
  assert.equal((await runtime.dataset()).lastSettled["character:actor_a"][field.id], 5_000);
  const records = await runtime.service.settleNatural(CONTEXT_A, 7_500);
  assert.equal(records[0].requestedDelta, 2);
  assert.equal(await runtime.service.getStateValue(CONTEXT_A, field.id), 32);
  assert.equal((await runtime.dataset()).lastSettled["character:actor_a"][field.id], 7_000);
});

test("multiple natural fields evaluate links once and preserve primary natural audit", async () => {
  const first = testField("field_natural_link_a");
  first.naturalChange = { enabled: true, unitMs: 1_000, amount: 1 };
  const second = testField("field_natural_link_b");
  second.naturalChange = { enabled: true, unitMs: 1_000, amount: 1 };
  const target = testField("field_natural_link_target");
  const firstRule: DataLinkRule = {
    id: "rule_natural_a",
    sourceFieldId: first.id,
    operator: ">=",
    sourceThreshold: 31,
    targetFieldId: target.id,
    effect: { kind: "delta", value: 2 },
    enabled: true,
  };
  const secondRule: DataLinkRule = {
    id: "rule_natural_b",
    sourceFieldId: second.id,
    operator: ">=",
    sourceThreshold: 31,
    targetFieldId: target.id,
    effect: { kind: "delta", value: 3 },
    enabled: true,
  };
  const speedEffect: DataTemporaryEffect = {
    id: "effect_natural_speed",
    targetFieldId: first.id,
    scope: "character",
    scopeKey: "character:actor_a",
    mode: "multiplier",
    value: 2,
    enabled: true,
    expiresAt: null,
    remainingTurns: null,
    reason: "自然变化加速",
    source: "rule",
    createdAt: 500,
  };
  const runtime = createTestRuntime(testDataset({
    fields: [first, second, target],
    rules: [firstRule, secondRule],
    temporaryEffects: [speedEffect],
  }));
  assert.deepEqual(await runtime.service.settleNatural(CONTEXT_A, 1_000), []);
  const records = await runtime.service.settleNatural(CONTEXT_A, 2_000);
  assert.equal(records.length, 3);
  assert.equal(records.filter((record) => record.source === "natural").length, 2);
  assert.equal(records.filter((record) => record.fieldId === target.id).length, 1);
  const firstRecord = records.find((record) => record.fieldId === first.id);
  assert.equal(firstRecord?.source, "natural");
  assert.equal(firstRecord?.requestedDelta, 1);
  assert.equal(firstRecord?.effectiveRequestedDelta, 2);
  const linked = records.find((record) => record.fieldId === target.id);
  assert.equal(linked?.source, "rule");
  assert.deepEqual(linked?.ruleIds, [firstRule.id, secondRule.id]);
  assert.equal(linked?.requestedDelta, 5);
  const dataset = await runtime.dataset();
  assert.equal(dataset.stateValues["character:actor_a"][first.id], 32);
  assert.equal(dataset.stateValues["character:actor_a"][second.id], 31);
  assert.equal(dataset.stateValues["character:actor_a"][target.id], 35);
});

test("settleNatural disables expired temporary effects even on the initial anchor", async () => {
  const field = testField("field_natural_expired_effect");
  field.naturalChange = { enabled: true, unitMs: 1_000, amount: 1 };
  const effect: DataTemporaryEffect = {
    id: "effect_expired_on_settlement",
    targetFieldId: field.id,
    scope: "character",
    scopeKey: "character:actor_a",
    mode: "additive",
    value: 10,
    enabled: true,
    expiresAt: 1_500,
    remainingTurns: null,
    reason: "已经到期",
    source: "manual",
    createdAt: 1_000,
  };
  const runtime = createTestRuntime(testDataset({
    fields: [field],
    temporaryEffects: [effect],
  }));
  assert.deepEqual(await runtime.service.settleNatural(CONTEXT_A, 2_000), []);
  const dataset = await runtime.dataset();
  assert.equal(dataset.temporaryEffects[0].enabled, false);
  assert.equal(dataset.lastSettled["character:actor_a"][field.id], 2_000);
  assert.deepEqual(dataset.records, []);
  assert.deepEqual(dataset.stateValues, {});
});

test("field scope and binding edits remove incompatible temporary effects before validation", async () => {
  const scopeField = testField(
    "field_effect_scope_edit",
    "character",
    ["actor_a", "actor_b"]
  );
  const scopeEffects: DataTemporaryEffect[] = ["actor_a", "actor_b"].map((actorId, index) => ({
    id: `effect_scope_edit_${index}`,
    targetFieldId: scopeField.id,
    scope: "character",
    scopeKey: `character:${actorId}`,
    mode: "additive",
    value: 1,
    enabled: true,
    expiresAt: null,
    remainingTurns: null,
    reason: "作用域变更清理",
    source: "manual",
    createdAt: 1_000,
  }));
  const scopeRuntime = createTestRuntime(testDataset({
    fields: [scopeField],
    temporaryEffects: scopeEffects,
  }));
  await scopeRuntime.service.updateField(scopeField.id, {
    scope: "chat",
    bindingIds: ["chat_a"],
  });
  assert.deepEqual((await scopeRuntime.dataset()).temporaryEffects, []);

  const bindingField = testField(
    "field_effect_binding_edit",
    "character",
    ["actor_a", "actor_b"]
  );
  const bindingEffects: DataTemporaryEffect[] = ["actor_a", "actor_b"].map((actorId, index) => ({
    id: `effect_binding_edit_${index}`,
    targetFieldId: bindingField.id,
    scope: "character",
    scopeKey: `character:${actorId}`,
    mode: "multiplier",
    value: 2,
    enabled: true,
    expiresAt: null,
    remainingTurns: null,
    reason: "解绑清理",
    source: "manual",
    createdAt: 1_000,
  }));
  const bindingRuntime = createTestRuntime(testDataset({
    fields: [bindingField],
    temporaryEffects: bindingEffects,
  }));
  await bindingRuntime.service.updateField(bindingField.id, { bindingIds: ["actor_b"] });
  assert.deepEqual(
    (await bindingRuntime.dataset()).temporaryEffects.map((effect) => effect.scopeKey),
    ["character:actor_b"]
  );
});

test("explicit field and configuration edits cancel pending bootstrap intent", async () => {
  const scopeEdited = testField("field_explicit_scope", "character", []);
  const scopeRuntime = createTestRuntime(testDataset({
    fields: [scopeEdited],
    pendingBootstrapFieldIds: [scopeEdited.id],
  }));
  await scopeRuntime.service.updateField(scopeEdited.id, { scope: "chat" });
  await scopeRuntime.bootstrapActors([CONTEXT_A]);
  let dataset = await scopeRuntime.dataset();
  assert.deepEqual(dataset.pendingBootstrapFieldIds, []);
  assert.deepEqual(dataset.fields[0].bindingIds, []);

  const original = testField("field_pending_before_configuration", "character", []);
  const configurationRuntime = createTestRuntime(testDataset({
    fields: [original],
    pendingBootstrapFieldIds: [original.id],
  }));
  const imported = testField("field_explicit_configuration", "chat", []);
  await configurationRuntime.service.replaceConfiguration({
    fields: [imported],
    rules: [],
    autoRules: [],
    temporaryEffects: [],
    settings: { aiEnabled: true },
  });
  await configurationRuntime.bootstrapActors([CONTEXT_A]);
  dataset = await configurationRuntime.dataset();
  assert.deepEqual(dataset.pendingBootstrapFieldIds, []);
  assert.deepEqual(dataset.fields[0].bindingIds, []);

  const deleted = testField("field_pending_delete", "character", []);
  const deleteRuntime = createTestRuntime(testDataset({
    fields: [deleted],
    pendingBootstrapFieldIds: [deleted.id],
  }));
  await deleteRuntime.service.deleteField(deleted.id);
  dataset = await deleteRuntime.dataset();
  assert.deepEqual(dataset.fields, []);
  assert.deepEqual(dataset.pendingBootstrapFieldIds, []);
});

test("pending bootstrap metadata strictly requires unique existing empty non-global fields", async () => {
  const empty = testField("field_pending_valid", "character", []);
  const bound = testField("field_pending_bound", "character", ["actor_a"]);
  const global = testField("field_pending_global", "global");
  const runtime = createTestRuntime(testDataset({ fields: [testField("field_local_valid")] }));
  const cases: Array<{ dataset: MvuDataset; error: RegExp }> = [
    {
      dataset: testDataset({
        fields: [empty],
        pendingBootstrapFieldIds: [empty.id, empty.id],
      }),
      error: /MVU_PENDING_BOOTSTRAP_FIELD_DUPLICATE/,
    },
    {
      dataset: testDataset({
        fields: [empty],
        pendingBootstrapFieldIds: ["field_pending_missing"],
      }),
      error: /MVU_PENDING_BOOTSTRAP_FIELD_NOT_FOUND/,
    },
    {
      dataset: testDataset({
        fields: [global],
        pendingBootstrapFieldIds: [global.id],
      }),
      error: /MVU_PENDING_BOOTSTRAP_FIELD_GLOBAL/,
    },
    {
      dataset: testDataset({
        fields: [bound],
        pendingBootstrapFieldIds: [bound.id],
      }),
      error: /MVU_PENDING_BOOTSTRAP_FIELD_BOUND/,
    },
  ];
  const before = await runtime.dataset();
  for (const invalid of cases) {
    await assert.rejects(() => runtime.service.replaceDataset(invalid.dataset), invalid.error);
    assert.deepEqual(await runtime.dataset(), before);
  }
});

test("configuration import rejects invalid ranges, stages, and self loops before mutation", async () => {
  const original = testField("field_original");
  const runtime = createTestRuntime(testDataset({ fields: [original] }));
  const revision = (await runtime.dataset()).revision;
  await assert.rejects(() => runtime.service.replaceConfiguration({
    fields: [{ ...original, maximum: original.minimum }], rules: [], autoRules: [],
    temporaryEffects: [], settings: { aiEnabled: true },
  }), /MVU_FIELD_RANGE_INVALID/);
  const invalidStage = testField("field_invalid_stage");
  invalidStage.stages[0] = { ...invalidStage.stages[0], threshold: 1 };
  await assert.rejects(() => runtime.service.replaceConfiguration({
    fields: [invalidStage], rules: [], autoRules: [], temporaryEffects: [],
    settings: { aiEnabled: true },
  }), /MVU_STAGE_FIRST_THRESHOLD_INVALID/);
  const invalidLoop: DataLinkRule = {
    id: "rule_self_loop", sourceFieldId: original.id, operator: ">=", sourceThreshold: 0,
    targetFieldId: original.id, effect: { kind: "delta", value: 1 }, enabled: true,
  };
  await assert.rejects(() => runtime.service.replaceConfiguration({
    fields: [original], rules: [invalidLoop], autoRules: [], temporaryEffects: [],
    settings: { aiEnabled: true },
  }), /MVU_LINK_SELF_LOOP/);
  assert.equal((await runtime.dataset()).revision, revision);

  const replacement = testField("field_replacement", "global");
  await runtime.service.replaceConfiguration({
    fields: [replacement], rules: [], autoRules: [], temporaryEffects: [],
    settings: { aiEnabled: false },
  });
  assert.deepEqual((await runtime.dataset()).fields.map((field) => field.id), [replacement.id]);
});

test("replaceDataset imports complete v2 runtime state but preserves local CAS revision atomically", async () => {
  const importedField = testField("field_imported_runtime");
  const importedPendingField = testField("field_imported_pending", "chat", []);
  importedField.perTurnChange = {
    enabled: true,
    intervalTurns: 1,
    amount: 3,
    countMode: "user",
  };
  const sourceRuntime = createTestRuntime(testDataset({
    fields: [importedField, importedPendingField],
    pendingBootstrapFieldIds: [importedPendingField.id],
  }));
  await sourceRuntime.processPersistedMessage(message({
    messageId: "imported_message",
    content: "需要完整导入的事实",
    role: "user",
    occurredAt: 40_000,
  }));
  await sourceRuntime.updateSettings({ aiEnabled: false });
  const imported = await sourceRuntime.dataset();
  imported.revision = 900;

  const localField = testField("field_local_before_import");
  const runtime = createTestRuntime(testDataset({ fields: [localField] }));
  await runtime.service.setStateValue({
    context: CONTEXT_A,
    fieldId: localField.id,
    value: 45,
    reason: "建立本地 revision",
    source: "manual",
    ruleIds: [],
    confidence: null,
    messageId: null,
    variantId: null,
    occurredAt: 39_000,
  });
  assert.equal((await runtime.dataset()).revision, 1);

  await runtime.service.replaceDataset(imported);
  const replaced = await runtime.dataset();
  assert.deepEqual(replaced, { ...imported, revision: 2 });
  assert.equal(replaced.settings.aiEnabled, false);
  assert.equal(replaced.stateValues["character:actor_a"][importedField.id], 33);
  assert.equal(replaced.records.length, 1);
  assert.equal(replaced.processedMessageIds.length, 1);
  assert.deepEqual(replaced.pendingBootstrapFieldIds, [importedPendingField.id]);
  assert.equal(
    replaced.messageFacts["event:chat=chat_a;actor=actor_a;group=group_shared"][0].content,
    "需要完整导入的事实"
  );

  const invalid: MvuDataset = {
    ...replaced,
    fields: replaced.fields.map((field) => field.id === importedField.id
      ? { ...field, maximum: field.minimum }
      : field),
  };
  await assert.rejects(
    () => runtime.service.replaceDataset(invalid),
    /MVU_FIELD_RANGE_INVALID/
  );
  assert.deepEqual(await runtime.dataset(), replaced);

  const invalidPending: MvuDataset = {
    ...replaced,
    pendingBootstrapFieldIds: [importedField.id],
  };
  await assert.rejects(
    () => runtime.service.replaceDataset(invalidPending),
    /MVU_PENDING_BOOTSTRAP_FIELD_BOUND/
  );
  assert.deepEqual(await runtime.dataset(), replaced);
});

test("deleting a field cleans live references but keeps readable history snapshots", async () => {
  const deleted = testField("field_deleted");
  const retained = testField("field_retained");
  const link: DataLinkRule = {
    id: "rule_deleted_retained", sourceFieldId: deleted.id, operator: ">=", sourceThreshold: 0,
    targetFieldId: retained.id, effect: { kind: "delta", value: 1 }, enabled: true,
  };
  const effect: DataTemporaryEffect = {
    id: "effect_deleted", targetFieldId: deleted.id, scope: "character",
    scopeKey: "character:actor_a", mode: "multiplier", value: 2, enabled: true,
    expiresAt: null, remainingTurns: null, reason: "删除", source: "manual", createdAt: 1_000,
  };
  const runtime = createTestRuntime(testDataset({
    fields: [deleted, retained], rules: [link], temporaryEffects: [effect],
  }));
  await runtime.service.setStateValue({
    context: CONTEXT_A, fieldId: deleted.id, value: 40, reason: "历史", source: "manual",
    ruleIds: [], confidence: null, messageId: null, variantId: null, occurredAt: 2_000,
  });
  await runtime.service.mutate((draft) => {
    draft.lastSettled["character:actor_a"] = { [deleted.id]: 2_000 };
    draft.turnCounters["character:actor_a"] = {
      [deleted.id]: { userMessages: 1, characterMessages: 1 },
    };
  });
  await runtime.service.deleteField(deleted.id);
  const dataset = await runtime.dataset();
  assert.equal(dataset.rules.length, 0);
  assert.equal(dataset.temporaryEffects.length, 0);
  assert.equal(dataset.stateValues["character:actor_a"][deleted.id], undefined);
  assert.equal(dataset.lastSettled["character:actor_a"][deleted.id], undefined);
  assert.equal(dataset.turnCounters["character:actor_a"][deleted.id], undefined);
  assert.equal(dataset.records.find((record) => record.fieldId === deleted.id)?.fieldName, deleted.name);
});

test("command writes serialize and zero changes do not create revisions or records", async () => {
  const field = testField("field_transaction");
  const runtime = createTestRuntime(testDataset({ fields: [field] }));
  await Promise.all([
    runtime.applyCommand(CONTEXT_A, "_.add('states.field_transaction', 1);", audit(2_000, 1)),
    runtime.applyCommand(CONTEXT_A, "_.add('states.field_transaction', 1);", audit(2_001, 1)),
  ]);
  let dataset = await runtime.dataset();
  assert.equal(dataset.stateValues["character:actor_a"].field_transaction, 32);
  assert.equal(dataset.records.length, 2);
  const revision = dataset.revision;
  assert.equal((await runtime.applyCommand(
    CONTEXT_A, "_.add('states.field_transaction', 0);", audit(2_002, 0)
  )).changed, false);
  dataset = await runtime.dataset();
  assert.equal(dataset.revision, revision);
  assert.equal(dataset.records.length, 2);
});

test("InMemory snapshots are deep copies and stale revisions are rejected", async () => {
  const store = new InMemoryMvuStore(testDataset({ fields: [testField("field_store")] }));
  const first = await store.read();
  first.dataset.fields[0].name = "外部修改";
  assert.equal((await store.read()).dataset.fields[0].name, "field_store");
  const draft = (await store.read()).dataset;
  draft.stateValues["character:actor_a"] = { field_store: 40 };
  const committed = await store.transact(draft.revision, draft);
  committed.dataset.stateValues["character:actor_a"].field_store = 99;
  assert.equal((await store.read()).dataset.stateValues["character:actor_a"].field_store, 40);
  await assert.rejects(() => store.transact(draft.revision, draft), /STALE_REVISION/);
});

test("FileMvuStore initializes v2 and restores committed scoped state", async () => {
  const files = new MemoryMvuFiles();
  const createStore = () => new FileMvuStore({
    getConfigDir: () => "/config", files,
    createInitialDataset: () => testDataset({ fields: [testField("field_persist")] }),
  });
  const firstRuntime = createRuntime({ store: createStore() });
  assert.equal(await firstRuntime.service.getStateValue(CONTEXT_A, "field_persist"), 30);
  assert.equal(files.files.has("/config/operit_mvu.dataset.v2.json"), true);
  await firstRuntime.service.setStateValue({
    context: CONTEXT_A, fieldId: "field_persist", value: 42, reason: "持久化",
    source: "manual", ruleIds: [], confidence: null, messageId: null,
    variantId: null, occurredAt: 2_000,
  });
  const secondRuntime = createRuntime({ store: createStore() });
  assert.equal(await secondRuntime.service.getStateValue(CONTEXT_A, "field_persist"), 42);
  assert.equal((await secondRuntime.dataset()).revision, 1);
});

test("FileMvuStore rejects invalid JSON without replacing it", async () => {
  const files = new MemoryMvuFiles();
  files.directories.add("/config");
  files.files.set("/config/operit_mvu.dataset.v2.json", "{not-json");
  const store = new FileMvuStore({
    getConfigDir: () => "/config", files, createInitialDataset: buildSeedDataset,
  });
  await assert.rejects(() => store.read());
  assert.equal(files.files.get("/config/operit_mvu.dataset.v2.json"), "{not-json");
});
