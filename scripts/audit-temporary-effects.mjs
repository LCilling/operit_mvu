import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createRuntime } = require("../dist/mvu/app/index.js");
const { buildSeedDataset } = require("../dist/mvu/app/seed.js");
const { InMemoryMvuStore } = require("../dist/mvu/app/store.js");
const { normalizeMvuDataset } = require("../dist/mvu/app/validation.js");
const { evaluateAutoRules } = require("../dist/mvu/app/automation.js");
const { HostSystemModelApi } = require("../dist/mvu/app/system-model.js");

const actorId = "actor_effect_audit";
const context = {
  chatId: "chat_effect_audit",
  actorId,
  groupId: null,
  actorName: "效果审计角色",
};
const occurredAt = 2_000_000_000_000;
const seed = buildSeedDataset(occurredAt - 1_000);
const firstField = seed.fields[0];
const secondField = seed.fields[1];

for (const field of [firstField, secondField]) {
  field.bindingIds = [actorId];
  field.naturalChange.enabled = false;
  field.perTurnChange.enabled = false;
}
seed.fields = [firstField, secondField];
seed.pendingBootstrapFieldIds = [];
seed.rules = [];
seed.autoRules = [{
  id: "auto_effect_audit",
  name: "双字段规则审计",
  description: "验证规则结果经过多目标临时效果。",
  enabled: true,
  condition: { kind: "userCare" },
  effects: [
    { fieldId: firstField.id, delta: 3, temporaryEffectIds: ["effect_multi_rule_audit"] },
    { fieldId: secondField.id, delta: 2, temporaryEffectIds: ["effect_multi_rule_audit"] },
  ],
  cooldownMs: 0,
  order: 0,
}];
seed.temporaryEffects = [{
  id: "effect_multi_rule_audit",
  targets: [firstField, secondField].map((field) => ({
    fieldId: field.id,
    scope: field.scope,
    scopeKey: `character:${actorId}`,
  })),
  mode: "multiplier",
  value: 2,
  enabled: true,
  expiresAt: null,
  remainingTurns: null,
  reasonMode: "custom",
  reasonTemplate: "general",
  reason: "雨夜散步带来的放松效果",
  createdAt: occurredAt - 100,
}];

const runtime = createRuntime({ store: new InMemoryMvuStore(seed) });
const result = await runtime.processPersistedMessage({
  context,
  messageId: "message_effect_audit",
  variantId: null,
  content: "你今天还好吗？",
  role: "user",
  occurredAt,
  signals: {
    recentPositiveCount: null,
    userCareDetected: true,
    lastInteractionAt: null,
    messageCountInLast24Hours: null,
    specialDayDetected: null,
  },
  aiChanges: [],
  aiRuleJudgements: [],
});

assert.deepEqual(result.matchedRuleIds, ["auto_effect_audit"]);
assert.equal(result.records.length, 2, "one rule must update both temporary-effect targets");
for (const record of result.records) {
  assert.equal(record.source, "rule");
  assert.equal(record.effectiveRequestedDelta, record.requestedDelta * 2);
  assert.deepEqual(record.effectIds, ["effect_multi_rule_audit"]);
  assert.match(record.reason, /雨夜散步带来的放松效果/);
}

const legacyDataset = structuredClone(seed);
legacyDataset.autoRules[0].effects = [{ fieldId: firstField.id, delta: 1 }];
legacyDataset.temporaryEffects = [{
  id: "effect_legacy_audit",
  targetFieldId: firstField.id,
  scope: firstField.scope,
  scopeKey: `character:${actorId}`,
  mode: "additive",
  value: 1,
  enabled: true,
  expiresAt: null,
  remainingTurns: null,
  source: "manual",
  reason: "旧版临时原因",
  createdAt: occurredAt - 200,
}];
const migrated = normalizeMvuDataset(legacyDataset);
assert.deepEqual(migrated.temporaryEffects[0].targets, [{
  fieldId: firstField.id,
  scope: firstField.scope,
  scopeKey: `character:${actorId}`,
}]);
assert.equal("triggerSources" in migrated.temporaryEffects[0], false);
assert.deepEqual(migrated.autoRules[0].effects[0].temporaryEffectIds, []);
assert.equal(migrated.temporaryEffects[0].reasonMode, "custom");
assert.equal(migrated.temporaryEffects[0].reason, "旧版临时原因");

const aiRule = {
  id: "auto_ai_audit",
  name: "AI 情绪触发",
  description: "验证 AI 只判断条件，不生成字段结果。",
  enabled: true,
  condition: {
    kind: "aiJudgement",
    triggerType: "情绪变化",
    requirement: "消息明确表达从紧张转为放松",
    minimumConfidence: 0.75,
  },
  effects: [{ fieldId: firstField.id, delta: 1, temporaryEffectIds: [] }],
  cooldownMs: 0,
  order: 0,
};
let capturedRuleSchema = "";
const model = new HostSystemModelApi({
  probe: async () => ({ available: true, provider: "audit", model: "strict-json" }),
  complete: async (request) => {
    capturedRuleSchema = request.jsonSchema?.name ?? "";
    return {
      text: JSON.stringify({
        matches: [{
          ruleId: aiRule.id,
          matched: true,
          confidence: 0.91,
          reason: "消息明确描述已放松",
        }],
      }),
    };
  },
});
const aiJudgement = await model.judgeRules({
  context,
  rules: [aiRule],
  fields: [{
    definition: firstField,
    bound: true,
    scopeKey: `character:${actorId}`,
    currentValue: firstField.initialValue,
    currentStage: firstField.stages[0],
  }],
  recentFacts: [],
  message: "刚才还有点紧张，现在终于放松下来了。",
});
assert.equal(capturedRuleSchema, "mvu_rule_judgement");
assert.equal(aiJudgement.judgements[0].ruleId, aiRule.id);
const aiEvaluation = evaluateAutoRules({
  rules: [aiRule],
  facts: {
    occurredAt,
    stateValues: { [firstField.id]: firstField.initialValue },
    aiRuleJudgements: { [aiRule.id]: aiJudgement.judgements[0] },
  },
  lastTriggeredAtByRuleId: {},
});
assert.deepEqual(aiEvaluation.matchedRules.map((rule) => rule.ruleId), [aiRule.id]);
assert.equal(aiEvaluation.effects[0].fieldId, firstField.id);

console.log(JSON.stringify({
  matchedRuleIds: result.matchedRuleIds,
  changedFields: result.records.map((record) => record.fieldId),
  migratedLegacyTargets: migrated.temporaryEffects[0].targets.length,
  aiRuleMatches: aiEvaluation.matchedRules.length,
  result: "PASS",
}, null, 2));
