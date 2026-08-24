import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDefaultConditionLibrary,
  collectAiPredicates,
  evaluateCondition,
} from "../dist/mvu/app/condition-engine.js";
import { assertMvuDatasetV3 } from "../dist/mvu/app/validation.js";
import { migrateDatasetV2ToV3 } from "../dist/mvu/app/migration-v3.js";
import { legacyDatasetFixture } from "./helpers.mjs";

const HOUR = 3_600_000;
const NOW = "2033-05-18T03:33:20.000Z";
const NOW_MS = Date.parse(NOW);

function contextFor(actorId = "actor_t", overrides = {}) {
  return {
    actorId,
    groupId: "group_main",
    chatId: "chat_main",
    now: NOW,
    fieldValues: { field_affinity: 30, field_excite: 20 },
    messageFacts: [],
    hourlyMessageBuckets: [],
    currentMessage: null,
    aiSemanticResults: {},
    ...overrides,
  };
}

function fact(overrides = {}) {
  return {
    messageId: "message_1",
    variantId: null,
    content: "I care about you and want to help.",
    chatId: "chat_main",
    actorId: "actor_t",
    groupId: "group_main",
    role: "user",
    occurredAt: NOW_MS - HOUR,
    recentPositiveCount: 6,
    userCareDetected: true,
    lastInteractionAt: NOW_MS - HOUR,
    messageCountInLast24Hours: 20,
    specialDayDetected: false,
    ...overrides,
  };
}

function actorAndAiExpression(actorId = "actor_t") {
  return {
    kind: "and",
    children: [
      { kind: "predicate", predicate: { kind: "actor", actorIds: [actorId] } },
      {
        kind: "predicate",
        predicate: {
          kind: "ai_semantic",
          id: "semantic_care",
          triggerType: "care",
          requirement: "The user expresses genuine care.",
          minimumConfidence: 0.8,
        },
      },
    ],
  };
}

test("evaluates nested AND OR and NOT expressions", () => {
  const expression = {
    kind: "and",
    children: [
      { kind: "predicate", predicate: { kind: "field_comparison", fieldId: "field_affinity", operator: ">=", value: 30 } },
      {
        kind: "or",
        children: [
          { kind: "not", child: { kind: "predicate", predicate: { kind: "group", groupIds: ["group_other"] } } },
          { kind: "predicate", predicate: { kind: "actor", actorIds: ["actor_other"] } },
        ],
      },
    ],
  };

  assert.deepEqual(evaluateCondition(expression, contextFor()), {
    matched: true,
    pendingAiPredicateIds: [],
    diagnostics: [],
  });
});

test("evaluates field comparisons, count windows, and keyword include-any/include-all/exclusion", () => {
  const facts = [
    fact({ messageId: "recent_1", content: "I care about you." }),
    fact({ messageId: "recent_2", occurredAt: NOW_MS - 30 * 60_000, content: "Please help me." }),
    fact({ messageId: "old", occurredAt: NOW_MS - 3 * HOUR, content: "I care, but stop now." }),
  ];
  const context = contextFor("actor_t", { messageFacts: facts });

  assert.equal(evaluateCondition(
    { kind: "predicate", predicate: { kind: "field_comparison", fieldId: "field_affinity", operator: ">", value: 20 } },
    context,
  ).matched, true);
  assert.equal(evaluateCondition(
    { kind: "predicate", predicate: { kind: "message_count", count: 2, windowHours: 1, sender: "user" } },
    context,
  ).matched, true);
  assert.equal(evaluateCondition(
    { kind: "predicate", predicate: { kind: "keywords", includeAny: ["care", "missing"], includeAll: ["care", "help"], exclude: ["stop"], windowHours: 1 } },
    context,
  ).matched, true);
  assert.equal(evaluateCondition(
    { kind: "predicate", predicate: { kind: "keywords", includeAny: [], includeAll: ["care"], exclude: ["stop"], windowHours: 4 } },
    context,
  ).matched, false);
  assert.equal(evaluateCondition(
    { kind: "predicate", predicate: { kind: "keywords", includeAny: ["care"], includeAll: ["missing"], exclude: [], windowHours: 1 } },
    context,
  ).matched, false);
});

test("evaluates sender, actor, group, inactivity, and concrete and repeating dates", () => {
  const currentMessage = fact();
  const context = contextFor("actor_t", { messageFacts: [currentMessage], currentMessage });

  for (const predicate of [
    { kind: "sender", senders: ["user"] },
    { kind: "actor", actorIds: ["actor_t"] },
    { kind: "group", groupIds: ["group_main"] },
    { kind: "long_inactive", hours: 0.5 },
    { kind: "concrete_date", dates: ["2033-05-18"] },
    { kind: "repeating_date", month: 5, day: 18 },
  ]) {
    assert.equal(evaluateCondition({ kind: "predicate", predicate }, context).matched, true);
  }
});

test("uses durable independent hourly buckets for high-frequency checks", () => {
  const facts = [
    fact({ messageId: "a", occurredAt: NOW_MS - 5 * 60_000 }),
    fact({ messageId: "b", occurredAt: NOW_MS - 20 * 60_000 }),
    fact({ messageId: "c", occurredAt: NOW_MS - 50 * 60_000 }),
    fact({ messageId: "d", occurredAt: NOW_MS - 70 * 60_000 }),
  ];
  const expression = {
    kind: "predicate",
    predicate: { kind: "high_frequency", messages: 3, windowHours: 2, bucketHours: 1 },
  };

  assert.equal(evaluateCondition(expression, contextFor("actor_t", {
    messageFacts: [],
    hourlyMessageBuckets: [
      { startedAt: NOW_MS - HOUR, messageCount: 3 },
      { startedAt: NOW_MS - 2 * HOUR, messageCount: 1 },
    ],
  })).matched, true);
  assert.equal(evaluateCondition(expression, contextFor("actor_t", {
    messageFacts: facts,
    hourlyMessageBuckets: [
      { startedAt: NOW_MS - HOUR, messageCount: 1 },
      { startedAt: NOW_MS - 2 * HOUR, messageCount: 1 },
    ],
  })).matched, false);
  assert.equal(evaluateCondition(
    { kind: "predicate", predicate: { kind: "high_frequency", messages: 2, windowHours: 3 } },
    contextFor("actor_t", {
      hourlyMessageBuckets: [
        { startedAt: NOW_MS - HOUR, messageCount: 1 },
        { startedAt: NOW_MS - 2 * HOUR, messageCount: 1 },
        { startedAt: NOW_MS - 3 * HOUR, messageCount: 1 },
      ],
    }),
  ).matched, false);
});

test("does not match a character sender predicate without a message fact", () => {
  const result = evaluateCondition(
    { kind: "predicate", predicate: { kind: "sender", senders: ["character"] } },
    contextFor(),
  );
  assert.deepEqual(result, { matched: false, pendingAiPredicateIds: [], diagnostics: [] });
});

test("filters actor before evaluating an AI predicate", () => {
  const result = evaluateCondition(actorAndAiExpression("actor_t"), contextFor("actor_u"));
  assert.equal(result.matched, false);
  assert.deepEqual(result.pendingAiPredicateIds, []);
});

test("collects AI predicates and honors returned confidence", () => {
  const expression = actorAndAiExpression();
  assert.deepEqual(collectAiPredicates(expression), [{
    id: "semantic_care",
    triggerType: "care",
    requirement: "The user expresses genuine care.",
    minimumConfidence: 0.8,
  }]);
  assert.deepEqual(evaluateCondition(expression, contextFor()), {
    matched: true,
    pendingAiPredicateIds: ["semantic_care"],
    diagnostics: [],
  });
  assert.equal(evaluateCondition(expression, contextFor("actor_t", {
    aiSemanticResults: { semantic_care: { matched: true, confidence: 0.79 } },
  })).matched, false);
  assert.equal(evaluateCondition(expression, contextFor("actor_t", {
    aiSemanticResults: { semantic_care: { matched: true, confidence: 0.8 } },
  })).matched, true);
});

test("does not evaluate disabled condition definitions", () => {
  const definition = {
    id: "condition_disabled",
    name: "Disabled",
    description: "Disabled test condition.",
    enabled: false,
    expression: actorAndAiExpression(),
    createdAt: NOW,
    updatedAt: NOW,
  };

  assert.deepEqual(evaluateCondition(definition, contextFor()), {
    matched: false,
    pendingAiPredicateIds: [],
    diagnostics: [],
  });
});

test("validates expression limits and exposes restorable legacy condition assets", () => {
  const migrated = migrateDatasetV2ToV3(legacyDatasetFixture(), NOW_MS).dataset;
  const invalid = structuredClone(migrated);
  invalid.conditions[0].expression = { kind: "and", children: [] };
  assert.throws(() => assertMvuDatasetV3(invalid), /MVU_V3_CONDITION_AND_EMPTY/);

  const library = buildDefaultConditionLibrary(NOW);
  assert.deepEqual(library.map((condition) => condition.id), [
    "condition_auto_positive",
    "condition_auto_inactive",
    "condition_auto_care",
    "condition_auto_special",
    "condition_auto_high_frequency",
  ]);
  assert.deepEqual(library[4].expression, {
    kind: "predicate",
    predicate: { kind: "high_frequency", messages: 20, bucketHours: 1 },
  });
  assert.notEqual(buildDefaultConditionLibrary(NOW), library);
});

test("uses required collision-safe AI IDs and deterministic migration IDs", () => {
  const legacy = legacyDatasetFixture();
  legacy.autoRules[0].condition = {
    kind: "aiJudgement",
    triggerType: "care",
    requirement: "The user expresses care.",
    minimumConfidence: 0.8,
  };
  const migrated = migrateDatasetV2ToV3(legacy, NOW_MS).dataset;
  assert.equal(migrated.conditions[0].expression.predicate.id, "condition_auto_positive_ai_0");

  const duplicateIds = structuredClone(migrated);
  duplicateIds.conditions[0].expression = {
    kind: "and",
    children: [
      { kind: "predicate", predicate: { kind: "ai_semantic", id: "ai_unique", triggerType: "care", requirement: "First.", minimumConfidence: 0 } },
      { kind: "predicate", predicate: { kind: "ai_semantic", id: "ai_unique", triggerType: "care", requirement: "Second.", minimumConfidence: 1 } },
    ],
  };
  assert.throws(() => assertMvuDatasetV3(duplicateIds), /MVU_V3_CONDITION_AI_ID_DUPLICATE/);

  const missingId = structuredClone(migrated);
  delete missingId.conditions[0].expression.predicate.id;
  assert.throws(() => assertMvuDatasetV3(missingId), /MVU_V3_CONDITION_AI_SEMANTIC_INVALID/);
});

test("enforces exact expression, keyword, and AI confidence boundaries", () => {
  const migrated = migrateDatasetV2ToV3(legacyDatasetFixture(), NOW_MS).dataset;
  const emptyOr = structuredClone(migrated);
  emptyOr.conditions[0].expression = { kind: "or", children: [] };
  assert.throws(() => assertMvuDatasetV3(emptyOr), /MVU_V3_CONDITION_OR_EMPTY/);

  let depthTwelve = { kind: "predicate", predicate: { kind: "user_care" } };
  for (let index = 0; index < 12; index += 1) depthTwelve = { kind: "not", child: depthTwelve };
  const acceptedDepth = structuredClone(migrated);
  acceptedDepth.conditions[0].expression = depthTwelve;
  assert.doesNotThrow(() => assertMvuDatasetV3(acceptedDepth));

  let depthThirteen = { kind: "predicate", predicate: { kind: "user_care" } };
  for (let index = 0; index < 13; index += 1) depthThirteen = { kind: "not", child: depthThirteen };

  const tooDeep = structuredClone(migrated);
  tooDeep.conditions[0].expression = depthThirteen;
  assert.throws(() => assertMvuDatasetV3(tooDeep), /MVU_V3_CONDITION_DEPTH_EXCEEDED/);

  const oneHundredKeywords = structuredClone(migrated);
  oneHundredKeywords.conditions[0].expression = {
    kind: "predicate",
    predicate: { kind: "keywords", includeAny: Array.from({ length: 100 }, (_, index) => `word_${index}`), includeAll: [], exclude: [] },
  };
  assert.doesNotThrow(() => assertMvuDatasetV3(oneHundredKeywords));

  const tooManyKeywords = structuredClone(migrated);
  tooManyKeywords.conditions[0].expression = {
    kind: "predicate",
    predicate: { kind: "keywords", includeAny: Array.from({ length: 101 }, (_, index) => `word_${index}`), includeAll: [], exclude: [] },
  };
  assert.throws(() => assertMvuDatasetV3(tooManyKeywords), /MVU_V3_CONDITION_KEYWORDS_INVALID/);

  for (const confidence of [0, 1]) {
    const acceptedConfidence = structuredClone(migrated);
    acceptedConfidence.conditions[0].expression = {
      kind: "predicate",
      predicate: { kind: "ai_semantic", id: `ai_confidence_${confidence}`, triggerType: "care", requirement: "The user expresses care.", minimumConfidence: confidence },
    };
    assert.doesNotThrow(() => assertMvuDatasetV3(acceptedConfidence));
  }
  for (const confidence of [-0.01, 1.01]) {
    const rejectedConfidence = structuredClone(migrated);
    rejectedConfidence.conditions[0].expression = {
      kind: "predicate",
      predicate: { kind: "ai_semantic", id: "ai_invalid_confidence", triggerType: "care", requirement: "The user expresses care.", minimumConfidence: confidence },
    };
    assert.throws(() => assertMvuDatasetV3(rejectedConfidence), /MVU_V3_CONDITION_AI_SEMANTIC_INVALID/);
  }
});
