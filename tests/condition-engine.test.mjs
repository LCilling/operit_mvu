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

test("evaluates field comparisons, count windows, and keyword inclusion and exclusion", () => {
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
    { kind: "predicate", predicate: { kind: "keywords", include: ["care", "help"], exclude: ["stop"], windowHours: 1 } },
    context,
  ).matched, true);
  assert.equal(evaluateCondition(
    { kind: "predicate", predicate: { kind: "keywords", include: ["care"], exclude: ["stop"], windowHours: 4 } },
    context,
  ).matched, false);
});

test("evaluates sender, actor, group, inactivity, and concrete and repeating dates", () => {
  const context = contextFor("actor_t", { messageFacts: [fact()] });

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

test("uses hourly buckets for high-frequency checks", () => {
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

  assert.equal(evaluateCondition(expression, contextFor("actor_t", { messageFacts: facts })).matched, true);
  assert.equal(evaluateCondition(expression, contextFor("actor_t", {
    messageFacts: facts.map((entry, index) => ({ ...entry, occurredAt: NOW_MS - (index + 1) * HOUR })),
  })).matched, false);
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
  assert.notEqual(buildDefaultConditionLibrary(NOW), library);
});

test("rejects expressions beyond depth 12, more than 100 keywords, and invalid AI confidence", () => {
  const migrated = migrateDatasetV2ToV3(legacyDatasetFixture(), NOW_MS).dataset;
  let deeplyNested = { kind: "predicate", predicate: { kind: "user_care" } };
  for (let index = 0; index < 13; index += 1) deeplyNested = { kind: "not", child: deeplyNested };

  const tooDeep = structuredClone(migrated);
  tooDeep.conditions[0].expression = deeplyNested;
  assert.throws(() => assertMvuDatasetV3(tooDeep), /MVU_V3_CONDITION_DEPTH_EXCEEDED/);

  const tooManyKeywords = structuredClone(migrated);
  tooManyKeywords.conditions[0].expression = {
    kind: "predicate",
    predicate: { kind: "keywords", include: Array.from({ length: 101 }, (_, index) => `word_${index}`), exclude: [] },
  };
  assert.throws(() => assertMvuDatasetV3(tooManyKeywords), /MVU_V3_CONDITION_KEYWORDS_INVALID/);

  const invalidConfidence = structuredClone(migrated);
  invalidConfidence.conditions[0].expression = {
    kind: "predicate",
    predicate: {
      kind: "ai_semantic",
      id: "semantic_invalid",
      triggerType: "care",
      requirement: "The user expresses care.",
      minimumConfidence: 1.01,
    },
  };
  assert.throws(() => assertMvuDatasetV3(invalidConfidence), /MVU_V3_CONDITION_AI_SEMANTIC_INVALID/);
});
