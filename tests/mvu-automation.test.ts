/** Pure automatic/link rule engine tests. */
import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_LINK_CHAIN_DEPTH,
  evaluateAutoRules,
  evaluateLinkRules,
  type AutomationMessageFacts,
  type FieldDeltaInput,
} from "../src/mvu/app/automation";
import type { DataAutoRule, DataLinkRule } from "../src/mvu/app/model";

const HOUR_MS = 3_600_000;

function autoRule(
  id: string,
  order: number,
  condition: DataAutoRule["condition"],
  effects: DataAutoRule["effects"] = [{ fieldId: "affinity", delta: 1 }]
): DataAutoRule {
  return {
    id,
    name: id,
    description: id,
    enabled: true,
    condition,
    effects,
    cooldownMs: 0,
    order,
  };
}

function linkRule(
  id: string,
  sourceFieldId: string,
  targetFieldId: string,
  effect: DataLinkRule["effect"],
  sourceThreshold = 0
): DataLinkRule {
  return {
    id,
    sourceFieldId,
    operator: ">=",
    sourceThreshold,
    targetFieldId,
    effect,
    enabled: true,
  };
}

test("auto rules cover every condition, stable order, enabled, and multiple effects", () => {
  const occurredAt = 100 * HOUR_MS;
  const facts: AutomationMessageFacts = {
    occurredAt,
    stateValues: { affinity: 62 },
    recentPositiveCount: 6,
    userCareDetected: true,
    lastInteractionAt: occurredAt - 25 * HOUR_MS,
    messageCountInLast24Hours: 21,
    specialDayDetected: true,
  };
  const disabled = autoRule("disabled", 0, { kind: "userCare" });
  disabled.enabled = false;
  const rules: DataAutoRule[] = [
    autoRule("high-frequency", 4, { kind: "highFreq", messages: 20 }),
    autoRule("user-care", 1, { kind: "userCare" }, [
      { fieldId: "trust", delta: 3 },
      { fieldId: "affinity", delta: 2 },
    ]),
    autoRule("recent-positive", 1, { kind: "recentPositive", count: 6 }),
    autoRule("long-inactive", 2, { kind: "longInactive", hours: 24 }),
    autoRule("special-day", 3, { kind: "specialDay" }),
    autoRule("state-threshold", 5, {
      kind: "stateThreshold",
      fieldId: "affinity",
      operator: ">=",
      threshold: 60,
    }),
    disabled,
  ];
  const rulesBefore = structuredClone(rules);
  const factsBefore = structuredClone(facts);

  const result = evaluateAutoRules({ rules, facts, lastTriggeredAtByRuleId: {} });

  assert.deepEqual(
    result.matchedRules.map((rule) => rule.ruleId),
    ["user-care", "recent-positive", "long-inactive", "special-day", "high-frequency", "state-threshold"]
  );
  assert.deepEqual(
    result.effects.slice(0, 2).map((effect) => [effect.fieldId, effect.delta]),
    [["trust", 3], ["affinity", 2]]
  );
  assert.equal(result.effects.length, 7);
  assert.deepEqual(result.cooldownUpdates.map((update) => update.ruleId), result.matchedRules.map((rule) => rule.ruleId));
  assert.deepEqual(rules, rulesBefore);
  assert.deepEqual(facts, factsBefore);
});

test("auto rules do not infer absent facts", () => {
  const rules = [
    autoRule("care", 1, { kind: "userCare" }),
    autoRule("positive", 2, { kind: "recentPositive", count: 1 }),
    autoRule("inactive", 3, { kind: "longInactive", hours: 1 }),
    autoRule("frequency", 4, { kind: "highFreq", messages: 1 }),
    autoRule("day", 5, { kind: "specialDay" }),
    autoRule("state", 6, {
      kind: "stateThreshold",
      fieldId: "missing",
      operator: ">",
      threshold: 0,
    }),
  ];

  const result = evaluateAutoRules({
    rules,
    facts: { occurredAt: 10 * HOUR_MS, stateValues: {} },
    lastTriggeredAtByRuleId: {},
  });

  assert.deepEqual(result.matchedRules, []);
  assert.deepEqual(result.effects, []);
  assert.deepEqual(result.cooldownUpdates, []);
});

test("auto rule cooldown blocks before and allows exactly at its boundary", () => {
  const rule = autoRule("cooldown", 1, { kind: "userCare" });
  rule.cooldownMs = 2 * HOUR_MS;
  const lastTriggeredAt = 20 * HOUR_MS;

  const blocked = evaluateAutoRules({
    rules: [rule],
    facts: {
      occurredAt: lastTriggeredAt + 2 * HOUR_MS - 1,
      stateValues: {},
      userCareDetected: true,
    },
    lastTriggeredAtByRuleId: { cooldown: lastTriggeredAt },
  });
  const allowed = evaluateAutoRules({
    rules: [rule],
    facts: {
      occurredAt: lastTriggeredAt + 2 * HOUR_MS,
      stateValues: {},
      userCareDetected: true,
    },
    lastTriggeredAtByRuleId: { cooldown: lastTriggeredAt },
  });

  assert.equal(blocked.matchedRules.length, 0);
  assert.deepEqual(allowed.matchedRules.map((match) => match.ruleId), ["cooldown"]);
});

test("link rules preserve input order and calculate delta then multiplier", () => {
  const rules = [
    linkRule("add", "source", "target", { kind: "delta", value: 2 }),
    linkRule("multiply", "source", "target", { kind: "multiplier", value: 2 }),
  ];

  const result = evaluateLinkRules({
    rules,
    stateValues: { source: 10, target: 20 },
    baseDeltas: [{ fieldId: "target", delta: 4 }],
    triggerFieldIds: ["source"],
  });

  assert.deepEqual(result.applications.map((application) => application.ruleId), ["add", "multiply"]);
  assert.deepEqual(result.applications.map((application) => [application.beforeDelta, application.afterDelta]), [
    [4, 6],
    [6, 12],
  ]);
  assert.deepEqual(result.changes, [{
    fieldId: "target",
    baseDelta: 4,
    finalDelta: 12,
    triggeredRuleIds: ["add", "multiply"],
  }]);
});

test("link rules support every comparison operator", () => {
  const cases: Array<{
    id: string;
    operator: DataLinkRule["operator"];
    threshold: number;
  }> = [
    { id: "gte", operator: ">=", threshold: 10 },
    { id: "gt", operator: ">", threshold: 9 },
    { id: "lte", operator: "<=", threshold: 10 },
    { id: "lt", operator: "<", threshold: 11 },
    { id: "eq", operator: "==", threshold: 10 },
  ];
  const rules = cases.map(({ id, operator, threshold }): DataLinkRule => ({
    id,
    sourceFieldId: "source",
    operator,
    sourceThreshold: threshold,
    targetFieldId: id,
    effect: { kind: "delta", value: 1 },
    enabled: true,
  }));

  const result = evaluateLinkRules({
    rules,
    stateValues: { source: 10 },
    baseDeltas: cases.map(({ id }) => ({ fieldId: id, delta: 1 })),
    triggerFieldIds: ["source"],
  });

  assert.deepEqual(result.applications.map((application) => application.ruleId), cases.map(({ id }) => id));
  assert.ok(result.changes.every((change) => change.finalDelta === 2));
});

test("link rules propagate with projected source state and retain rule chains", () => {
  const rules = [
    linkRule("a-to-b", "a", "b", { kind: "multiplier", value: 1.5 }, 10),
    linkRule("b-to-c", "b", "c", { kind: "delta", value: -1 }, 25),
  ];
  const baseDeltas: FieldDeltaInput[] = [
    { fieldId: "b", delta: 4 },
    { fieldId: "c", delta: 2 },
  ];

  const result = evaluateLinkRules({
    rules,
    stateValues: { a: 12, b: 20, c: 30 },
    baseDeltas,
    triggerFieldIds: ["a"],
  });

  assert.deepEqual(result.changes.map((change) => [change.fieldId, change.baseDelta, change.finalDelta]), [
    ["b", 4, 6],
    ["c", 2, 1],
  ]);
  assert.deepEqual(result.applications[0].ruleIdChain, ["a-to-b"]);
  assert.deepEqual(result.applications[1].ruleIdChain, ["a-to-b", "b-to-c"]);
  assert.equal(result.applications[1].depth, 2);
});

test("link rules detect direct and indirect cycles", () => {
  const result = evaluateLinkRules({
    rules: [
      linkRule("self", "a", "a", { kind: "delta", value: 1 }),
      linkRule("a-to-b", "a", "b", { kind: "delta", value: 1 }),
      linkRule("b-to-a", "b", "a", { kind: "delta", value: 1 }),
    ],
    stateValues: { a: 10, b: 10 },
    baseDeltas: [
      { fieldId: "a", delta: 1 },
      { fieldId: "b", delta: 1 },
    ],
    triggerFieldIds: ["a"],
  });

  assert.deepEqual(result.selfLoopRuleIds, ["self"]);
  assert.deepEqual(result.cycleRuleIds, ["b-to-a"]);
  assert.deepEqual(result.applications.map((application) => application.ruleId), ["a-to-b"]);
});

test("link propagation stops after eight rules", () => {
  const stateValues: Record<string, number> = {};
  const baseDeltas: FieldDeltaInput[] = [];
  const rules: DataLinkRule[] = [];
  for (let index = 0; index <= MAX_LINK_CHAIN_DEPTH + 1; index += 1) {
    stateValues[`f${index}`] = 10;
    baseDeltas.push({ fieldId: `f${index}`, delta: 1 });
    if (index <= MAX_LINK_CHAIN_DEPTH) {
      rules.push(linkRule(`r${index}`, `f${index}`, `f${index + 1}`, { kind: "multiplier", value: 2 }));
    }
  }

  const result = evaluateLinkRules({
    rules,
    stateValues,
    baseDeltas,
    triggerFieldIds: ["f0"],
  });

  assert.equal(result.applications.length, MAX_LINK_CHAIN_DEPTH);
  assert.equal(result.applications.at(-1)?.ruleIdChain.length, MAX_LINK_CHAIN_DEPTH);
  assert.deepEqual(result.depthLimitedRuleIds, [`r${MAX_LINK_CHAIN_DEPTH}`]);
  assert.equal(result.changes.find((change) => change.fieldId === `f${MAX_LINK_CHAIN_DEPTH + 1}`)?.finalDelta, 1);
});

test("link evaluation does not mutate rules, states, base deltas, or triggers", () => {
  const rules = [linkRule("link", "source", "target", { kind: "delta", value: 2 })];
  const stateValues = { source: 10, target: 20 };
  const baseDeltas: FieldDeltaInput[] = [{ fieldId: "target", delta: 3 }];
  const triggerFieldIds = ["source"];
  const before = structuredClone({ rules, stateValues, baseDeltas, triggerFieldIds });

  evaluateLinkRules({ rules, stateValues, baseDeltas, triggerFieldIds });

  assert.deepEqual({ rules, stateValues, baseDeltas, triggerFieldIds }, before);
});
