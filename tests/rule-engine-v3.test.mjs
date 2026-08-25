import assert from "node:assert/strict";
import test from "node:test";

import {
  executeRulePlan,
  planRuleEvaluation,
} from "../dist/mvu/app/rule-engine-v3.js";
import { migrateDatasetV2ToV3 } from "../dist/mvu/app/migration-v3.js";
import { automationScopeKey } from "../dist/mvu/app/scope.js";
import { processPersistedMessageV3 } from "../dist/mvu/app/service.js";
import { HostSystemModelApi } from "../dist/mvu/app/system-model.js";
import { assertMvuDatasetV3 } from "../dist/mvu/app/validation.js";
import { legacyDatasetFixture } from "./helpers.mjs";

const NOW = Date.parse("2033-05-18T03:33:20.000Z");
const NOW_ISO = new Date(NOW).toISOString();
const HOUR = 3_600_000;

function messageFact(overrides = {}) {
  return {
    messageId: "message_old",
    variantId: null,
    content: "hello",
    chatId: "chat_main",
    actorId: "T",
    groupId: "G",
    role: "user",
    occurredAt: NOW - 1_000,
    recentPositiveCount: null,
    userCareDetected: null,
    lastInteractionAt: null,
    messageCountInLast24Hours: null,
    specialDayDetected: null,
    ...overrides,
  };
}

function condition(id, expression) {
  return {
    id,
    name: id,
    description: "",
    enabled: true,
    expression,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  };
}

function aiCondition(id, predicateId = `${id}_ai`) {
  return condition(id, {
    kind: "predicate",
    predicate: {
      kind: "ai_semantic",
      id: predicateId,
      triggerType: "event",
      requirement: `match ${id}`,
      minimumConfidence: 0.7,
    },
  });
}

function rule(id, conditionId, triggerActorSelector, actions = []) {
  return {
    id,
    name: id,
    description: "",
    enabled: true,
    triggerActorSelector,
    conditionId,
    actions,
    cooldownHours: 0,
    executionOrder: 0,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  };
}

function evaluationContext(overrides = {}) {
  return {
    actorId: "T",
    groupId: "G",
    chatId: "chat_main",
    now: NOW,
    fieldValues: { field_affinity: 50 },
    messageFacts: [messageFact()],
    hourlyMessageBuckets: [],
    currentMessage: messageFact({ occurredAt: NOW }),
    ...overrides,
  };
}

function senderAndAiCondition(id, sender) {
  return condition(id, {
    kind: "and",
    children: [
      { kind: "predicate", predicate: { kind: "sender", senders: [sender] } },
      { kind: "predicate", predicate: {
        kind: "ai_semantic",
        id: `${id}_ai`,
        triggerType: "sender",
        requirement: `${sender} event`,
        minimumConfidence: 0.5,
      } },
    ],
  });
}

function v3Dataset() {
  const legacy = legacyDatasetFixture();
  legacy.fields = [legacy.fields[0]];
  legacy.fields[0].bindingIds = ["T", "U", "V"];
  legacy.fields[0].initialValue = 50;
  legacy.autoRules = [];
  legacy.temporaryEffects = [];
  const dataset = migrateDatasetV2ToV3(legacy, NOW).dataset;
  dataset.stateValues = {
    "character:T": { field_affinity: 50 },
    "character:U": { field_affinity: 50 },
    "character:V": { field_affinity: 50 },
  };
  return dataset;
}

function persistedInput(dataset, overrides = {}) {
  return {
    dataset,
    context: { chatId: "chat_main", actorId: "T", groupId: "G", actorName: "T" },
    currentActorId: "T",
    messageId: "message_new",
    variantId: null,
    content: "A role-aware event",
    role: "user",
    occurredAt: NOW,
    signals: {
      recentPositiveCount: null,
      userCareDetected: null,
      lastInteractionAt: null,
      messageCountInLast24Hours: null,
      specialDayDetected: null,
    },
    ...overrides,
  };
}

test("actor and sender filters run before deterministic and AI predicate work", () => {
  const selectors = [
    ["any", { kind: "any" }, true],
    ["current", { kind: "current_actor" }, true],
    ["selected", { kind: "selected", actorIds: ["T"] }, true],
    ["group", { kind: "group", groupIds: ["G"] }, true],
    ["wrong_current", { kind: "current_actor" }, false],
    ["wrong_selected", { kind: "selected", actorIds: ["U"] }, false],
    ["wrong_group", { kind: "group", groupIds: ["other"] }, false],
  ];
  const conditions = selectors.map(([id]) => aiCondition(`condition_${id}`, `predicate_${id}`));
  conditions.push(condition("condition_role", {
    kind: "and",
    children: [
      { kind: "predicate", predicate: { kind: "sender", senders: ["character"] } },
      { kind: "predicate", predicate: {
        kind: "ai_semantic", id: "predicate_role", triggerType: "role", requirement: "character only", minimumConfidence: 0.5,
      } },
    ],
  }));
  const rules = selectors.map(([id, selector]) => rule(`rule_${id}`, `condition_${id}`, selector));
  rules.push(rule("rule_role", "condition_role", { kind: "any" }));

  const plan = planRuleEvaluation({
    rules,
    conditions,
    context: evaluationContext(),
    currentActorId: "T",
    lastTriggeredAtByRuleId: {},
  });
  const mismatchedCurrentPlan = planRuleEvaluation({
    rules: [rules[4]],
    conditions: [conditions[4]],
    context: evaluationContext(),
    currentActorId: "U",
    lastTriggeredAtByRuleId: {},
  });

  assert.deepEqual(plan.aiPredicates.map((predicate) => predicate.id), [
    "predicate_any",
    "predicate_current",
    "predicate_selected",
    "predicate_group",
    "predicate_wrong_current",
  ]);
  assert.deepEqual(mismatchedCurrentPlan.aiPredicates, []);
  assert.equal(plan.candidates.some((candidate) => candidate.rule.id === "rule_role"), false);
  assert.equal(plan.candidates.some((candidate) => candidate.rule.id === "rule_wrong_selected"), false);
  assert.equal(plan.candidates.some((candidate) => candidate.rule.id === "rule_wrong_group"), false);
});

test("executeRulePlan keeps direct changes and effect activation as separate ordered actions", () => {
  const conditions = [aiCondition("condition_effect"), aiCondition("condition_change")];
  const rules = [
    rule("rule_change", "condition_change", { kind: "any" }, [{
      kind: "change_field",
      fieldId: "field_affinity",
      target: { kind: "trigger_actor", triggerCondition: "injected target data" },
      delta: 10,
      effectGroupIds: ["effect_group_focus"],
      condition: { injected: true },
    }]),
    { ...rule("rule_effect", "condition_effect", { kind: "any" }, [{
      kind: "activate_effect_group",
      effectGroupId: "effect_group_focus",
      triggerCondition: "injected action data",
    }]), executionOrder: -1 },
  ];
  const plan = planRuleEvaluation({
    rules,
    conditions,
    context: evaluationContext(),
    currentActorId: "T",
    lastTriggeredAtByRuleId: {},
  });

  const result = executeRulePlan({
    plan,
    aiSemanticResults: {
      condition_effect_ai: { matched: true, confidence: 0.9 },
      condition_change_ai: { matched: true, confidence: 0.9 },
    },
  });

  assert.deepEqual(result.actions, [
    {
      ruleId: "rule_effect",
      ruleName: "rule_effect",
      actionIndex: 0,
      action: { kind: "activate_effect_group", effectGroupId: "effect_group_focus" },
    },
    {
      ruleId: "rule_change",
      ruleName: "rule_change",
      actionIndex: 0,
      action: {
        kind: "change_field",
        fieldId: "field_affinity",
        target: { kind: "trigger_actor" },
        delta: 10,
        effectGroupIds: ["effect_group_focus"],
      },
    },
  ]);
  assert.deepEqual(result.matchedRuleIds, ["rule_effect", "rule_change"]);
  assert.deepEqual(result.cooldownUpdates, [
    { ruleId: "rule_effect", triggeredAt: NOW },
    { ruleId: "rule_change", triggeredAt: NOW },
  ]);
  assert.equal("triggerCondition" in result.actions[0].action, false);
  assert.equal("condition" in result.actions[1].action, false);
  assert.equal("triggerCondition" in result.actions[1].action.target, false);
});

test("one v3 message batches all AI predicates and applies T-only actions through the effect pipeline", async () => {
  const dataset = v3Dataset();
  dataset.conditions = [aiCondition("condition_effect"), aiCondition("condition_change")];
  dataset.effectGroups = [{
    id: "effect_group_focus",
    name: "Focus",
    description: "",
    enabled: true,
    fieldEffects: [{
      id: "field_effect_focus",
      fieldId: "field_affinity",
      actorSelector: { kind: "trigger_actor" },
      operations: [
        { kind: "immediate_delta", value: -30 },
        { kind: "positive_multiplier", value: 0.5, sources: ["rule"] },
      ],
    }],
    defaultReason: { mode: "template", template: "general", text: "" },
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  }];
  dataset.rules = [
    { ...rule("rule_effect", "condition_effect", { kind: "any" }, [{
      kind: "activate_effect_group", effectGroupId: "effect_group_focus",
    }]), executionOrder: -1 },
    rule("rule_change", "condition_change", { kind: "selected", actorIds: ["T"] }, [{
      kind: "change_field",
      fieldId: "field_affinity",
      target: { kind: "trigger_actor" },
      delta: 10,
      effectGroupIds: ["effect_group_focus"],
    }]),
  ];
  const requests = [];

  const result = await processPersistedMessageV3(persistedInput(dataset, {
    judgeConditions: async (request) => {
      requests.push(request);
      return {
        available: true,
        judgements: request.predicates.map((predicate) => ({
          predicateId: predicate.id,
          matched: true,
          confidence: 0.9,
        })),
        raw: "fixture",
      };
    },
  }));

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].predicates.map((predicate) => predicate.id), [
    "condition_effect_ai",
    "condition_change_ai",
  ]);
  assert.deepEqual(requests[0].message, {
    role: "user",
    actorId: "T",
    actorName: "T",
    content: "A role-aware event",
  });
  assert.equal(result.dataset.stateValues["character:T"].field_affinity, 25);
  assert.equal(result.dataset.stateValues["character:U"].field_affinity, 50);
  assert.equal(result.dataset.stateValues["character:V"].field_affinity, 50);
  assert.equal(result.dataset.activeEffects.length, 1);
  assert.equal(result.dataset.activeEffects[0].triggerActorId, "T");
  assert.deepEqual(result.matchedRuleIds, ["rule_effect", "rule_change"]);
  assert.equal(result.records.length, 2);
});

test("the v3 path caps identities and facts while preserving independent hourly counts", async () => {
  const dataset = v3Dataset();
  const eventKey = automationScopeKey({ chatId: "chat_main", actorId: "T", groupId: "G", actorName: "T" });
  dataset.conditions = [condition("condition_frequency", {
    kind: "predicate",
    predicate: { kind: "high_frequency", messages: 81, windowHours: 1, bucketHours: 1 },
  })];
  dataset.rules = [rule("rule_frequency", "condition_frequency", { kind: "any" }, [{
    kind: "change_field",
    fieldId: "field_affinity",
    target: { kind: "trigger_actor" },
    delta: 1,
    effectGroupIds: [],
  }])];
  dataset.processedMessageIds = Array.from({ length: 2_048 }, (_, index) => `old-${index}`);
  dataset.messageFacts[eventKey] = Array.from({ length: 50 }, (_, index) =>
    messageFact({ messageId: `fact-${index}`, occurredAt: NOW - index * 1_000 }));
  dataset.hourlyMessageBuckets[eventKey] = [{
    startedAt: Math.floor(NOW / HOUR) * HOUR,
    messageCount: 80,
  }];

  const result = await processPersistedMessageV3(persistedInput(dataset));

  assert.equal(result.dataset.processedMessageIds.length, 2_048);
  assert.equal(result.dataset.processedMessageIds.includes("old-0"), false);
  assert.equal(result.dataset.messageFacts[eventKey].length, 50);
  assert.equal(result.dataset.messageFacts[eventKey].some((fact) => fact.messageId === "fact-0"), false);
  assert.equal(result.dataset.messageFacts[eventKey].some((fact) => fact.messageId === "message_new"), true);
  assert.deepEqual(result.dataset.hourlyMessageBuckets[eventKey], [{
    startedAt: Math.floor(NOW / HOUR) * HOUR,
    messageCount: 81,
  }]);
  assert.deepEqual(result.matchedRuleIds, ["rule_frequency"]);
  assert.equal(result.dataset.stateValues["character:T"].field_affinity, 51);
});

test("the v3 path creates a new UTC-hour bucket on rollover", async () => {
  const dataset = v3Dataset();
  const eventKey = automationScopeKey({ chatId: "chat_main", actorId: "T", groupId: "G", actorName: "T" });
  const currentHour = Math.floor(NOW / HOUR) * HOUR;
  dataset.hourlyMessageBuckets[eventKey] = [{ startedAt: currentHour - HOUR, messageCount: 3 }];

  const result = await processPersistedMessageV3(persistedInput(dataset));

  assert.deepEqual(result.dataset.hourlyMessageBuckets[eventKey], [
    { startedAt: currentHour - HOUR, messageCount: 3 },
    { startedAt: currentHour, messageCount: 1 },
  ]);
});

test("missing trigger actors preserve all state and permit retry after actor resolution", async () => {
  const dataset = v3Dataset();
  dataset.conditions = [condition("condition_user", {
    kind: "predicate", predicate: { kind: "sender", senders: ["user"] },
  })];
  dataset.rules = [rule("rule_retry", "condition_user", { kind: "any" }, [{
    kind: "change_field",
    fieldId: "field_affinity",
    target: { kind: "trigger_actor" },
    delta: 1,
    effectGroupIds: [],
  }])];
  const before = structuredClone(dataset);
  let calls = 0;

  const skipped = await processPersistedMessageV3(persistedInput(dataset, {
    context: { chatId: "chat_main", actorId: null, groupId: "G", actorName: "" },
    currentActorId: null,
    judgeConditions: async () => {
      calls += 1;
      throw new Error("must not run");
    },
  }));

  assert.equal(calls, 0);
  assert.equal(skipped.duplicate, false);
  assert.deepEqual(skipped.dataset, before);
  assert.deepEqual(skipped.records, []);
  assert.deepEqual(skipped.matchedRuleIds, []);
  assert.deepEqual(skipped.diagnostics, [{ code: "MVU_RULE_TRIGGER_ACTOR_MISSING" }]);

  const retried = await processPersistedMessageV3(persistedInput(skipped.dataset));

  assert.equal(retried.duplicate, false);
  assert.equal(retried.dataset.stateValues["character:T"].field_affinity, 51);
  assert.equal(retried.dataset.stateValues["character:U"].field_affinity, 50);
  assert.equal(retried.dataset.stateValues["character:V"].field_affinity, 50);
  assert.equal(retried.dataset.processedMessageIds.length, 1);
  assert.equal(Object.values(retried.dataset.messageFacts).flat().length, 1);
  assert.equal(Object.values(retried.dataset.hourlyMessageBuckets).flat().reduce(
    (sum, bucket) => sum + bucket.messageCount, 0), 1);
});

test("missing trigger actors emit diagnostics with zero or only disabled rules", async () => {
  for (const rules of [[], [{ ...rule("rule_disabled", "condition_ai", { kind: "any" }), enabled: false }]]) {
    const dataset = v3Dataset();
    dataset.conditions = [aiCondition("condition_ai")];
    dataset.rules = rules;
    const before = structuredClone(dataset);

    const result = await processPersistedMessageV3(persistedInput(dataset, {
      context: { chatId: "chat_main", actorId: null, groupId: "G", actorName: "" },
      currentActorId: null,
    }));

    assert.deepEqual(result.dataset, before);
    assert.deepEqual(result.diagnostics, [{ code: "MVU_RULE_TRIGGER_ACTOR_MISSING" }]);
  }
});

test("AI batch failure makes only AI predicates false and deterministic rules still execute", async () => {
  const dataset = v3Dataset();
  dataset.conditions = [
    condition("condition_user", { kind: "predicate", predicate: { kind: "sender", senders: ["user"] } }),
    aiCondition("condition_ai"),
  ];
  dataset.rules = [
    rule("rule_user", "condition_user", { kind: "any" }, [{
      kind: "change_field", fieldId: "field_affinity", target: { kind: "trigger_actor" }, delta: 4, effectGroupIds: [],
    }]),
    rule("rule_ai", "condition_ai", { kind: "any" }, [{
      kind: "change_field", fieldId: "field_affinity", target: { kind: "trigger_actor" }, delta: 100, effectGroupIds: [],
    }]),
  ];

  const result = await processPersistedMessageV3(persistedInput(dataset, {
    judgeConditions: async () => { throw new Error("offline"); },
  }));

  assert.equal(result.dataset.stateValues["character:T"].field_affinity, 54);
  assert.deepEqual(result.matchedRuleIds, ["rule_user"]);
  assert.equal(result.diagnostics.some((entry) => entry.code === "MVU_RULE_AI_BATCH_FAILED"), true);
});

test("current event sender wins over a prior fact with a newer timestamp before AI batching", async () => {
  const dataset = v3Dataset();
  const eventKey = automationScopeKey({ chatId: "chat_main", actorId: "T", groupId: "G", actorName: "T" });
  dataset.messageFacts[eventKey] = [messageFact({
    messageId: "future_character",
    role: "character",
    occurredAt: NOW + HOUR,
  })];
  dataset.conditions = [
    senderAndAiCondition("condition_user_sender", "user"),
    senderAndAiCondition("condition_character_sender", "character"),
  ];
  dataset.rules = [
    rule("rule_user_sender", "condition_user_sender", { kind: "any" }),
    rule("rule_character_sender", "condition_character_sender", { kind: "any" }),
  ];
  const requests = [];

  await processPersistedMessageV3(persistedInput(dataset, {
    role: "user",
    judgeConditions: async (request) => {
      requests.push(request);
      return {
        available: true,
        judgements: request.predicates.map((predicate) => ({
          predicateId: predicate.id, matched: false, confidence: 0,
        })),
        raw: "fixture",
      };
    },
  }));

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].predicates.map((predicate) => predicate.id), ["condition_user_sender_ai"]);
});

test("current event sender wins over a prior equal-timestamp fact before AI batching", async () => {
  const dataset = v3Dataset();
  const eventKey = automationScopeKey({ chatId: "chat_main", actorId: "T", groupId: "G", actorName: "T" });
  dataset.messageFacts[eventKey] = [messageFact({
    messageId: "equal_character",
    role: "character",
    occurredAt: NOW,
  })];
  dataset.conditions = [
    senderAndAiCondition("condition_user_equal", "user"),
    senderAndAiCondition("condition_character_equal", "character"),
  ];
  dataset.rules = [
    rule("rule_user_equal", "condition_user_equal", { kind: "any" }),
    rule("rule_character_equal", "condition_character_equal", { kind: "any" }),
  ];
  const requests = [];

  await processPersistedMessageV3(persistedInput(dataset, {
    role: "user",
    judgeConditions: async (request) => {
      requests.push(request);
      return {
        available: true,
        judgements: request.predicates.map((predicate) => ({
          predicateId: predicate.id, matched: false, confidence: 0,
        })),
        raw: "fixture",
      };
    },
  }));

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].predicates.map((predicate) => predicate.id), ["condition_user_equal_ai"]);
});

test("actor condition predicates suppress AI before the model call", async () => {
  const dataset = v3Dataset();
  dataset.conditions = [condition("condition_wrong_actor", {
    kind: "and",
    children: [
      { kind: "predicate", predicate: { kind: "actor", actorIds: ["U"] } },
      { kind: "predicate", predicate: {
        kind: "ai_semantic",
        id: "condition_wrong_actor_ai",
        triggerType: "actor",
        requirement: "U only",
        minimumConfidence: 0.5,
      } },
    ],
  })];
  dataset.rules = [rule("rule_wrong_actor", "condition_wrong_actor", { kind: "any" })];
  let calls = 0;

  await processPersistedMessageV3(persistedInput(dataset, {
    judgeConditions: async () => {
      calls += 1;
      throw new Error("must not run");
    },
  }));

  assert.equal(calls, 0);
});

test("migration builds deterministic hourly buckets from uncapped legacy facts", () => {
  const legacy = legacyDatasetFixture();
  const key = "event:chat=chat_main;actor=T;group=G";
  legacy.messageFacts[key] = [
    messageFact({ messageId: "a", occurredAt: NOW - 10_000 }),
    messageFact({ messageId: "b", occurredAt: NOW - 20_000 }),
    messageFact({ messageId: "c", occurredAt: NOW - HOUR - 10_000 }),
  ];

  const first = migrateDatasetV2ToV3(legacy, NOW).dataset;
  const retry = migrateDatasetV2ToV3(legacy, NOW).dataset;

  assert.deepEqual(first, retry);
  assert.deepEqual(first.hourlyMessageBuckets[key], [
    { startedAt: Math.floor((NOW - HOUR - 10_000) / HOUR) * HOUR, messageCount: 1 },
    { startedAt: Math.floor((NOW - 10_000) / HOUR) * HOUR, messageCount: 2 },
  ]);
});

test("HostSystemModelApi sends one strict role-aware condition batch", async () => {
  const completions = [];
  const api = new HostSystemModelApi({
    async probe() { return { available: true }; },
    async complete(request) {
      completions.push(request);
      return {
        text: JSON.stringify({
          judgements: [
            { predicateId: "predicate_a", matched: true, confidence: 0.9 },
            { predicateId: "predicate_b", matched: false, confidence: 0.2 },
          ],
        }),
      };
    },
  });
  const predicates = [aiCondition("condition_a", "predicate_a").expression.predicate,
    aiCondition("condition_b", "predicate_b").expression.predicate];
  const message = { role: "character", actorId: "T", actorName: "T", content: "hello" };

  const result = await api.judgeConditions({ predicates, message });

  assert.equal(completions.length, 1);
  assert.equal(completions[0].jsonSchema.name, "mvu_condition_judgement");
  assert.deepEqual(JSON.parse(completions[0].userPrompt), message);
  assert.deepEqual(result.judgements, [
    { predicateId: "predicate_a", matched: true, confidence: 0.9 },
    { predicateId: "predicate_b", matched: false, confidence: 0.2 },
  ]);
});

test("v3 validation rejects each malformed actor-bound rule guarantee independently", () => {
  const dataset = v3Dataset();
  dataset.conditions = [condition("condition_user", {
    kind: "predicate", predicate: { kind: "sender", senders: ["user"] },
  })];
  dataset.rules = [rule("rule_valid", "condition_user", { kind: "selected", actorIds: ["T"] }, [{
    kind: "change_field",
    fieldId: "field_affinity",
    target: { kind: "selected", actorIds: ["T"] },
    delta: 1,
    effectGroupIds: [],
  }])];

  const emptyTriggerSelection = structuredClone(dataset);
  emptyTriggerSelection.rules[0].triggerActorSelector.actorIds = [];
  assert.throws(() => assertMvuDatasetV3(emptyTriggerSelection), /INVALID_MVU_V3_RULE_ACTOR_SELECTOR/);

  const missingField = structuredClone(dataset);
  missingField.rules[0].actions[0].fieldId = "missing_field";
  assert.throws(() => assertMvuDatasetV3(missingField), /INVALID_MVU_V3_RULE_EFFECT_REFERENCE/);

  const emptyTargetSelection = structuredClone(dataset);
  emptyTargetSelection.rules[0].actions[0].target.actorIds = [];
  assert.throws(() => assertMvuDatasetV3(emptyTargetSelection), /INVALID_MVU_V3_RULE_TARGET_SELECTOR/);

  const nonFiniteDelta = structuredClone(dataset);
  nonFiniteDelta.rules[0].actions[0].delta = Number.NaN;
  assert.throws(() => assertMvuDatasetV3(nonFiniteDelta), /INVALID_MVU_V3_RULE_EFFECT_REFERENCE/);
});

test("v3 validation rejects extra trigger-selector keys", () => {
  const selectors = [
    { kind: "any", condition: "injected" },
    { kind: "current_actor", condition: "injected" },
    { kind: "selected", actorIds: ["T"], condition: "injected" },
    { kind: "group", groupIds: ["G"], condition: "injected" },
  ];
  for (const triggerActorSelector of selectors) {
    const dataset = v3Dataset();
    dataset.conditions = [condition("condition_user", {
      kind: "predicate", predicate: { kind: "sender", senders: ["user"] },
    })];
    dataset.rules = [rule("rule_extra_selector", "condition_user", triggerActorSelector)];
    assert.throws(() => assertMvuDatasetV3(dataset), /INVALID_MVU_V3_RULE_ACTOR_SELECTOR/);
  }
});

test("v3 validation rejects extra target-selector keys", () => {
  const targets = [
    { kind: "trigger_actor", condition: "injected" },
    { kind: "all_bound", condition: "injected" },
    { kind: "selected", actorIds: ["T"], condition: "injected" },
  ];
  for (const target of targets) {
    const dataset = v3Dataset();
    dataset.conditions = [condition("condition_user", {
      kind: "predicate", predicate: { kind: "sender", senders: ["user"] },
    })];
    dataset.rules = [rule("rule_extra_target", "condition_user", { kind: "any" }, [{
      kind: "change_field",
      fieldId: "field_affinity",
      target,
      delta: 1,
      effectGroupIds: [],
    }])];
    assert.throws(() => assertMvuDatasetV3(dataset), /INVALID_MVU_V3_RULE_TARGET_SELECTOR/);
  }
});

test("v3 validation rejects extra keys on each rule action variant", () => {
  const changeDataset = v3Dataset();
  changeDataset.conditions = [condition("condition_user", {
    kind: "predicate", predicate: { kind: "sender", senders: ["user"] },
  })];
  changeDataset.rules = [rule("rule_extra_change", "condition_user", { kind: "any" }, [{
    kind: "change_field",
    fieldId: "field_affinity",
    target: { kind: "trigger_actor" },
    delta: 1,
    effectGroupIds: [],
    condition: "injected",
  }])];
  assert.throws(() => assertMvuDatasetV3(changeDataset), /INVALID_MVU_V3_RULE_ACTION/);

  const activateDataset = v3Dataset();
  activateDataset.effectGroups = [{
    id: "effect_group_validation",
    name: "Validation",
    description: "",
    enabled: true,
    fieldEffects: [{
      id: "field_effect_validation",
      fieldId: "field_affinity",
      actorSelector: { kind: "trigger_actor" },
      operations: [{ kind: "immediate_delta", value: 1 }],
    }],
    defaultReason: { mode: "template", template: "general", text: "" },
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  }];
  activateDataset.conditions = [condition("condition_user", {
    kind: "predicate", predicate: { kind: "sender", senders: ["user"] },
  })];
  activateDataset.rules = [rule("rule_extra_activate", "condition_user", { kind: "any" }, [{
    kind: "activate_effect_group",
    effectGroupId: "effect_group_validation",
    triggerCondition: "injected",
  }])];
  assert.throws(() => assertMvuDatasetV3(activateDataset), /INVALID_MVU_V3_RULE_ACTION/);
});
