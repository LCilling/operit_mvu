import assert from "node:assert/strict";
import test from "node:test";

import {
  MODEL_FIELD_LIMIT,
  buildStateSectionBlock,
  selectModelFields,
} from "../dist/mvu/app/state-prompt.js";
import { HostSystemModelApi } from "../dist/mvu/app/system-model.js";
import { MvuService } from "../dist/mvu/app/service.js";

const CONTEXT = { chatId: "chat-main", actorId: "actor-t", groupId: "group-main", actorName: "T" };

function field(id, order, overrides = {}) {
  return {
    id,
    name: id,
    description: `${id} description`,
    minimum: 0,
    maximum: 100,
    step: 1,
    initialValue: 20,
    icon: "favorite",
    themeColor: "#ff4f87",
    enabled: true,
    scope: "character",
    modelVisibility: "full",
    ai: { enabled: true, minConfidence: 0.7, maxDelta: 10, prompt: "judge carefully" },
    stages: [
      { id: "low", name: "低", description: "低阶段", threshold: 0 },
      { id: "high", name: "高", description: "高阶段", threshold: 50 },
    ],
    bindingIds: ["actor-t"],
    naturalChange: { enabled: false, unitMs: 3_600_000, amount: 0 },
    perTurnChange: { enabled: false, intervalTurns: 1, amount: 0, countMode: "both" },
    order,
    ...overrides,
  };
}

function condition(id, expression, overrides = {}) {
  return {
    id,
    name: id,
    description: "",
    enabled: true,
    expression,
    createdAt: "2036-01-01T00:00:00.000Z",
    updatedAt: "2036-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function rule(id, conditionId, actions, overrides = {}) {
  return {
    id,
    name: id,
    description: "",
    enabled: true,
    triggerActorSelector: { kind: "current_actor" },
    conditionId,
    actions,
    cooldownHours: 0,
    executionOrder: 0,
    createdAt: "2036-01-01T00:00:00.000Z",
    updatedAt: "2036-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function effectGroup(id, fieldIds, overrides = {}) {
  return {
    id,
    name: id,
    description: "",
    enabled: true,
    fieldEffects: fieldIds.map((fieldId, index) => ({
      id: `${id}-${index}`,
      fieldId,
      actorSelector: { kind: "trigger_actor" },
      operations: [{ kind: "immediate_delta", value: 1 }],
    })),
    defaultReason: { mode: "template", template: "rule", text: "规则触发" },
    createdAt: "2036-01-01T00:00:00.000Z",
    updatedAt: "2036-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function dataset(fields, overrides = {}) {
  return {
    formatVersion: 3,
    createdAt: "2036-01-01T00:00:00.000Z",
    revision: 1,
    settings: { aiEnabled: true },
    fields,
    pendingBootstrapFieldIds: [],
    linkRules: [],
    conditions: [],
    rules: [],
    effectGroups: [],
    activeEffects: [],
    stateValues: {},
    recordManifest: { segments: [], recordCount: 0, nextSegmentIndex: 1 },
    lastSettled: {},
    turnCounters: {},
    processedMessageIds: [],
    ruleLastTriggered: {},
    messageFacts: {},
    hourlyMessageBuckets: {},
    ...overrides,
  };
}

function legacyDataset(fields, overrides = {}) {
  return {
    formatVersion: 2,
    createdAt: 2_000_000_000_000,
    revision: 1,
    settings: { aiEnabled: true },
    fields,
    pendingBootstrapFieldIds: [],
    rules: [],
    autoRules: [],
    temporaryEffects: [],
    stateValues: {},
    records: [],
    lastSettled: {},
    turnCounters: {},
    processedMessageIds: [],
    ruleLastTriggered: {},
    messageFacts: {},
    ...overrides,
  };
}

function ids(selection) {
  return selection.fields.map((item) => item.id);
}

test("uses every eligible field below the limit and reports bounded budget statistics", () => {
  const input = dataset(Array.from({ length: 12 }, (_, index) => field(`field-${index}`, index)));

  const selected = selectModelFields(input, CONTEXT);

  assert.equal(MODEL_FIELD_LIMIT, 40);
  assert.equal(selected.fields.length, 12);
  assert.deepEqual(selected.stats, {
    used: 12,
    total: 12,
    limit: 40,
    referencedIncluded: 0,
    referencedTotal: 0,
    overflow: false,
    diagnostics: [],
  });
});

test("service preserves projectFields while exposing the same bounded statistics separately", async () => {
  const source = legacyDataset(Array.from({ length: 44 }, (_, index) => field(`service-${index}`, index)));
  const store = {
    async read() { return { revision: source.revision, dataset: structuredClone(source) }; },
    async transact() { throw new Error("unexpected mutation"); },
  };
  const service = new MvuService(store, {});

  const detailed = await service.projectModelFields(CONTEXT);
  const compatible = await service.projectFields(CONTEXT);

  assert.equal(detailed.fields.length, 40);
  assert.deepEqual(detailed.budget, {
    used: 40,
    total: 44,
    limit: 40,
    referencedIncluded: 0,
    referencedTotal: 0,
    overflow: true,
    diagnostics: [],
  });
  assert.deepEqual(compatible, detailed.fields);
});

test("caps ordinary fields at 40 and is deterministic for identical and reordered input", () => {
  const fields = Array.from({ length: 55 }, (_, index) => field(`field-${String(index).padStart(2, "0")}`, index));
  const first = selectModelFields(dataset(fields), CONTEXT);
  const retry = selectModelFields(dataset([...fields].reverse()), CONTEXT);

  assert.equal(first.fields.length, 40);
  assert.deepEqual(ids(first), ids(retry));
  assert.deepEqual(ids(first), fields.slice(0, 40).map((item) => item.id));
  assert.equal(first.stats.total, 55);
  assert.equal(first.stats.overflow, true);
});

test("retains recursively and indirectly referenced fields including hidden direct references", () => {
  const fields = Array.from({ length: 45 }, (_, index) => field(`ordinary-${index}`, index));
  fields.push(field("hidden-condition", 100, { modelVisibility: "hidden" }));
  fields.push(field("hidden-action", 101, { modelVisibility: "hidden" }));
  fields.push(field("hidden-effect", 102, { modelVisibility: "hidden" }));
  const input = dataset(fields, {
    conditions: [condition("condition-main", {
      kind: "and",
      children: [
        { kind: "predicate", predicate: { kind: "sender", senders: ["user"] } },
        { kind: "not", child: { kind: "predicate", predicate: {
          kind: "field_comparison", fieldId: "hidden-condition", operator: ">=", value: 1,
        } } },
      ],
    })],
    effectGroups: [effectGroup("effect-main", ["hidden-effect"])],
    rules: [rule("rule-main", "condition-main", [
      { kind: "change_field", fieldId: "hidden-action", target: { kind: "trigger_actor" }, delta: 1, effectGroupIds: ["effect-main"] },
      { kind: "activate_effect_group", effectGroupId: "effect-main" },
    ])],
  });

  const selected = selectModelFields(input, CONTEXT);

  assert.equal(selected.fields.length, 40);
  assert.equal(selected.stats.referencedTotal, 3);
  assert.equal(selected.stats.referencedIncluded, 3);
  assert.equal(selected.stats.total, 48);
  assert.ok(ids(selected).includes("hidden-condition"));
  assert.ok(ids(selected).includes("hidden-action"));
  assert.ok(ids(selected).includes("hidden-effect"));
});

test("excludes disabled fields even when referenced and diagnoses missing or unreachable references", () => {
  const fields = [
    field("enabled", 0),
    field("disabled", 1, { enabled: false }),
    field("unreachable", 2, { modelVisibility: "hidden" }),
  ];
  const input = dataset(fields, {
    conditions: [
      condition("condition-main", { kind: "predicate", predicate: {
        kind: "field_comparison", fieldId: "disabled", operator: ">", value: 1,
      } }),
      condition("condition-disabled", { kind: "predicate", predicate: {
        kind: "field_comparison", fieldId: "unreachable", operator: ">", value: 1,
      } }, { enabled: false }),
    ],
    rules: [
      rule("rule-main", "condition-main", [
        { kind: "change_field", fieldId: "missing-field", target: { kind: "trigger_actor" }, delta: 1, effectGroupIds: ["missing-effect"] },
      ]),
      rule("rule-disabled-condition", "condition-disabled", [
        { kind: "change_field", fieldId: "unreachable", target: { kind: "trigger_actor" }, delta: 1, effectGroupIds: [] },
      ]),
      rule("rule-missing-condition", "missing-condition", []),
      rule("rule-disabled", "condition-main", [], { enabled: false }),
    ],
  });

  const selected = selectModelFields(input, CONTEXT);

  assert.deepEqual(ids(selected), ["enabled"]);
  assert.equal(selected.stats.referencedTotal, 0);
  assert.ok(selected.stats.diagnostics.includes("MVU_MODEL_REFERENCE_FIELD_DISABLED:disabled"));
  assert.ok(selected.stats.diagnostics.includes("MVU_MODEL_REFERENCE_FIELD_MISSING:missing-field"));
  assert.ok(selected.stats.diagnostics.includes("MVU_MODEL_REFERENCE_EFFECT_GROUP_MISSING:missing-effect"));
  assert.ok(selected.stats.diagnostics.includes("MVU_MODEL_REFERENCE_CONDITION_DISABLED:condition-disabled"));
  assert.ok(selected.stats.diagnostics.includes("MVU_MODEL_REFERENCE_CONDITION_MISSING:missing-condition"));
  assert.equal(selected.stats.diagnostics.some((item) => item.includes("rule-disabled")), false);
});

test("uses visibility, recent change, order and stable id as deterministic tie-breakers", () => {
  const input = dataset([
    field("stage", 0, { modelVisibility: "stage_only" }),
    field("old", 4),
    field("recent-b", 2),
    field("recent-a", 2),
  ]);
  const selected = selectModelFields(input, CONTEXT, {
    maxFields: 3,
    recentChanges: [
      { fieldId: "recent-a", occurredAt: 20 },
      { fieldId: "recent-b", occurredAt: 20 },
      { fieldId: "old", occurredAt: 10 },
    ],
  });

  assert.deepEqual(ids(selected), ["recent-a", "recent-b", "old"]);
});

test("returns deterministic overflow diagnostics when valid references exceed the hard limit", () => {
  const fields = Array.from({ length: 45 }, (_, index) => field(`ref-${String(index).padStart(2, "0")}`, index));
  const expression = {
    kind: "and",
    children: fields.map((item) => ({ kind: "predicate", predicate: {
      kind: "field_comparison", fieldId: item.id, operator: ">=", value: 0,
    } })),
  };
  const input = dataset(fields, {
    conditions: [condition("condition-overflow", expression)],
    rules: [rule("rule-overflow", "condition-overflow", [])],
  });

  const selected = selectModelFields(input, CONTEXT);

  assert.equal(selected.fields.length, 40);
  assert.equal(selected.stats.referencedTotal, 45);
  assert.equal(selected.stats.referencedIncluded, 40);
  assert.equal(selected.stats.overflow, true);
  assert.ok(selected.stats.diagnostics.includes("MVU_MODEL_REFERENCED_FIELDS_OVERFLOW:45:40"));
  assert.deepEqual(ids(selected), fields.slice(0, 40).map((item) => item.id));
});

test("counts only fields applicable to character, group, chat and global contexts", () => {
  const input = dataset([
    field("character-hit", 0),
    field("character-miss", 1, { bindingIds: ["actor-u"] }),
    field("group-hit", 2, { scope: "group", bindingIds: ["group-main"] }),
    field("group-miss", 3, { scope: "group", bindingIds: ["group-other"] }),
    field("chat-hit", 4, { scope: "chat", bindingIds: ["chat-main"] }),
    field("chat-miss", 5, { scope: "chat", bindingIds: ["chat-other"] }),
    field("global", 6, { scope: "global", bindingIds: [] }),
  ]);

  const selected = selectModelFields(input, CONTEXT);

  assert.deepEqual(ids(selected), ["character-hit", "group-hit", "chat-hit", "global"]);
  assert.equal(selected.stats.total, 4);
});

test("stage_only projection exposes the stage but not its numeric value", () => {
  const stage = field("stage-only", 0, { modelVisibility: "stage_only" });
  const input = dataset([stage], {
    stateValues: { "character:actor-t": { "stage-only": 73 } },
  });

  const block = buildStateSectionBlock(input, CONTEXT, [stage]);

  assert.match(block, /阶段「高」/);
  assert.doesNotMatch(block, /73/);
});

test("sends bounded role and actor metadata for the current message with one completion", async () => {
  const completions = [];
  let probeCount = 0;
  const api = new HostSystemModelApi({
    async probe() { probeCount += 1; return { available: true }; },
    async complete(request) {
      completions.push(request);
      return { text: '{"changes":[]}' };
    },
  });
  const definition = field("affinity", 0);
  const projection = {
    definition,
    bound: true,
    scopeKey: "character:actor-t",
    currentValue: 20,
    currentStage: definition.stages[0],
  };

  await api.judgeState({
    context: CONTEXT,
    fields: [projection],
    recentFacts: [],
    message: { role: "character", actorId: "actor-t", actorName: "T", content: "hello" },
  });

  assert.equal(probeCount, 1);
  assert.equal(completions.length, 1);
  const currentLine = completions[0].userPrompt.split("\n").find((line) => line.startsWith("本次消息："));
  assert.deepEqual(JSON.parse(currentLine.slice("本次消息：".length)), {
    role: "character",
    actorId: "actor-t",
    actorName: "T",
    chatId: "chat-main",
    groupId: "group-main",
    content: "hello",
  });
  assert.equal(completions[0].jsonSchema.name, "mvu_state_judgement");
});

test("stage_only state and rule model contracts never expose the numeric value", async () => {
  const completions = [];
  const api = new HostSystemModelApi({
    async probe() { return { available: true }; },
    async complete(request) {
      completions.push(request);
      return request.jsonSchema.name === "mvu_state_judgement"
        ? { text: '{"changes":[]}' }
        : { text: '{"matches":[{"ruleId":"rule-ai","matched":false,"confidence":0.8,"reason":"not met"}]}' };
    },
  });
  const definition = field("secret-value", 0, { modelVisibility: "stage_only" });
  const projection = {
    definition,
    bound: true,
    scopeKey: "character:actor-t",
    currentValue: 73,
    currentStage: definition.stages[1],
  };
  const message = { role: "user", actorId: "actor-t", actorName: "T", content: "hello" };

  await api.judgeState({ context: CONTEXT, fields: [projection], recentFacts: [], message });
  await api.judgeRules({
    context: CONTEXT,
    fields: [projection],
    recentFacts: [],
    message,
    rules: [{
      id: "rule-ai", name: "rule-ai", description: "", enabled: true,
      condition: { kind: "aiJudgement", triggerType: "event", requirement: "test", minimumConfidence: 0.7 },
      effects: [], cooldownMs: 0, order: 0,
    }],
  });

  assert.equal(completions.length, 2);
  for (const completion of completions) {
    assert.doesNotMatch(completion.systemPrompt, /"currentValue":73|"value":73/);
    assert.match(completion.systemPrompt, /"currentStage":"高"|"stage":"高"/);
  }
});
