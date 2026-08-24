import type { AutoRuleCondition, DataTemporaryEffect, DataTemporaryEffectTarget, MvuDataset } from "./model";
import type {
  ActiveEffectInstance,
  ConditionDefinition,
  ConditionPredicate,
  EffectActorSelector,
  EffectGroupDefinition,
  EffectReasonSnapshot,
  MvuDatasetV3,
  MigrationResult,
  ResolvedEffectTarget,
  RuleDefinitionV3,
} from "./model-v3";
import { assertMvuDatasetV3, normalizeMvuDataset } from "./validation";

const HOURS_IN_MILLISECONDS = 3_600_000;
const ALL_CHANGE_SOURCES = ["manual", "natural", "per_turn", "rule", "ai"] as const;

/**
 * Converts validated v2 data into an independent v3 document. It never persists
 * or mutates its input, so callers can retry safely after a failed v3 write.
 */
export function migrateDatasetV2ToV3(v2: MvuDataset, now: number): MigrationResult {
  const source = normalizeMvuDataset(cloneJson(v2));
  const nowIso = isoTimestamp(now);
  const effectGroups = source.temporaryEffects.map(migrateEffectGroup);
  const conditions = source.autoRules.map((rule) => migrateCondition(rule, nowIso));
  const rules = source.autoRules.map((rule) => migrateRule(rule, nowIso));
  const activeEffects = source.temporaryEffects.filter((effect) => effect.enabled).map(migrateActiveEffect);

  const dataset: MvuDatasetV3 = {
    formatVersion: 3,
    createdAt: isoTimestamp(source.createdAt),
    revision: source.revision,
    settings: cloneJson(source.settings),
    fields: cloneJson(source.fields),
    pendingBootstrapFieldIds: [...source.pendingBootstrapFieldIds],
    linkRules: cloneJson(source.rules),
    conditions,
    rules,
    effectGroups,
    activeEffects,
    stateValues: cloneJson(source.stateValues),
    records: cloneJson(source.records),
    lastSettled: cloneJson(source.lastSettled),
    turnCounters: cloneJson(source.turnCounters),
    processedMessageIds: [...source.processedMessageIds],
    ruleLastTriggered: cloneJson(source.ruleLastTriggered),
    messageFacts: cloneJson(source.messageFacts),
  };
  assertMvuDatasetV3(dataset);

  return {
    dataset,
    report: {
      migratedFields: dataset.fields.length,
      migratedRules: dataset.rules.length,
      migratedConditions: dataset.conditions.length,
      migratedEffectGroups: dataset.effectGroups.length,
      warnings: [],
    },
  };
}

function migrateCondition(rule: MvuDataset["autoRules"][number], nowIso: string): ConditionDefinition {
  return {
    id: conditionId(rule.id),
    name: `${rule.name} condition`,
    description: rule.description,
    enabled: true,
    expression: { kind: "predicate", predicate: migrateConditionPredicate(rule.condition, conditionId(rule.id)) },
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function migrateConditionPredicate(condition: AutoRuleCondition, conditionIdValue: string): ConditionPredicate {
  switch (condition.kind) {
    case "recentPositive": return { kind: "recent_positive", count: condition.count };
    case "longInactive": return { kind: "long_inactive", hours: condition.hours };
    case "userCare": return { kind: "user_care" };
    case "specialDay": return { kind: "special_day" };
    case "highFreq": return { kind: "high_frequency", messages: condition.messages };
    case "stateThreshold": return {
      kind: "field_comparison", fieldId: condition.fieldId, operator: condition.operator, value: condition.threshold,
    };
    case "aiJudgement": return {
      kind: "ai_semantic", id: `${conditionIdValue}_ai_0`, triggerType: condition.triggerType,
      requirement: condition.requirement, minimumConfidence: condition.minimumConfidence,
    };
  }
}

function migrateRule(rule: MvuDataset["autoRules"][number], nowIso: string): RuleDefinitionV3 {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    triggerActorSelector: { kind: "any" },
    conditionId: conditionId(rule.id),
    actions: rule.effects.map((effect) => ({
      kind: "change_field",
      fieldId: effect.fieldId,
      // v2 applies auto-rule changes in the event context. A triggerless v3
      // execution must skip this target rather than broaden it to all bindings.
      target: { kind: "trigger_actor" },
      delta: effect.delta,
      effectGroupIds: effect.temporaryEffectIds.map(effectGroupId),
    })),
    cooldownHours: rule.cooldownMs / HOURS_IN_MILLISECONDS,
    executionOrder: rule.order,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function migrateEffectGroup(effect: DataTemporaryEffect): EffectGroupDefinition {
  const createdAt = isoTimestamp(effect.createdAt);
  const targetsByField = new Map<string, DataTemporaryEffectTarget[]>();
  for (const target of effect.targets) {
    const targets = targetsByField.get(target.fieldId);
    if (targets === undefined) targetsByField.set(target.fieldId, [target]);
    else targets.push(target);
  }
  return {
    id: effectGroupId(effect.id),
    name: `Migrated effect ${effect.id}`,
    description: effect.reasonMode === "custom" ? effect.reason : effect.reasonTemplate,
    enabled: effect.enabled,
    fieldEffects: [...targetsByField.entries()].map(([fieldId, targets], index) => ({
      id: `field_effect_${effect.id}_${index}`,
      fieldId,
      actorSelector: actorSelectorForTargets(targets),
      operations: [effect.mode === "additive"
        ? { kind: "fixed_adjustment", value: effect.value, sources: [...ALL_CHANGE_SOURCES] }
        : { kind: "all_multiplier", value: effect.value, sources: [...ALL_CHANGE_SOURCES] }],
    })),
    createdAt,
    updatedAt: createdAt,
  };
}

function migrateActiveEffect(effect: DataTemporaryEffect): ActiveEffectInstance {
  return {
    id: `active_effect_${effect.id}`,
    definitionId: effectGroupId(effect.id),
    resolvedTargets: effect.targets.map((target) => ({
      fieldId: target.fieldId,
      actorId: actorIdFromTarget(target.scope, target.scopeKey),
      scope: target.scope,
      scopeKey: target.scopeKey,
    })),
    duration: {
      expiresAt: effect.expiresAt === null ? null : isoTimestamp(effect.expiresAt),
      remainingTurns: effect.remainingTurns,
    },
    activatedAt: isoTimestamp(effect.createdAt),
    reason: reasonSnapshot(effect),
  };
}

function actorSelectorForTargets(targets: readonly DataTemporaryEffectTarget[]): EffectActorSelector {
  const actorIds = targets.map((target) => actorIdFromTarget(target.scope, target.scopeKey));
  if (actorIds.every((actorId): actorId is string => actorId !== null)) {
    return { kind: "selected", actorIds: [...new Set(actorIds)] };
  }
  return { kind: "all_bound" };
}

function actorIdFromTarget(scope: ResolvedEffectTarget["scope"] | undefined, scopeKey: string | undefined): string | null {
  if (scope !== "character" || scopeKey === undefined || !scopeKey.startsWith("character:")) return null;
  const actorId = scopeKey.slice("character:".length);
  return actorId.length > 0 ? actorId : null;
}

function reasonSnapshot(effect: DataTemporaryEffect): EffectReasonSnapshot {
  return {
    mode: effect.reasonMode,
    template: effect.reasonTemplate,
    text: effect.reasonMode === "custom" ? effect.reason : effect.reasonTemplate,
  };
}

function conditionId(legacyRuleId: string): string { return `condition_${legacyRuleId}`; }
function effectGroupId(legacyEffectId: string): string { return `effect_group_${legacyEffectId}`; }
function isoTimestamp(value: number): string { return new Date(value).toISOString(); }
function cloneJson<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
