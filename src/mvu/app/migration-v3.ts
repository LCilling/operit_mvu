import type { AutoRuleCondition, DataTemporaryEffect, DataTemporaryEffectTarget, MvuDataset } from "./model";
import {
  hourlyMessageBucketsFromFacts,
  MAX_MESSAGE_FACTS_PER_SCOPE_V3,
  MAX_PROCESSED_MESSAGE_IDS_V3,
} from "./automation";
import type {
  ActiveEffectInstance,
  ConditionDefinition,
  ConditionPredicate,
  EffectActorSelector,
  EffectGroupDefinition,
  EffectReasonConfig,
  EffectReasonSnapshot,
  MvuDatasetV3,
  MigrationResult,
  ResolvedEffectTarget,
  RuleDefinitionV3,
} from "./model-v3";
import {
  EFFECT_REASON_LEGACY_STORAGE_MAX_LENGTH,
  EFFECT_REASON_RENDERED_MAX_LENGTH,
  truncateEffectReasonText,
} from "./model-v3";
import { assertMvuDatasetV3, normalizeMvuDataset } from "./validation";
import { hydrateLegacyActiveEffectSnapshots, normalizeRenderedEffectReason } from "./effect-engine";
import { TEMPORARY_EFFECT_REASON_TEMPLATES } from "./temporary-effect";

const HOURS_IN_MILLISECONDS = 3_600_000;
const ALL_CHANGE_SOURCES = ["manual", "natural", "per_turn", "rule", "ai"] as const;

/**
 * Converts validated v2 data into an independent v3 document. It never persists
 * or mutates its input, so callers can retry safely after a failed v3 write.
 */
export function migrateDatasetV2ToV3(v2: MvuDataset, now: number): MigrationResult {
  const source = normalizeMvuDataset(cloneJson(v2));
  const nowIso = isoTimestamp(now);
  const warnings: string[] = [];
  const reasonConfigs = new Map(source.temporaryEffects.map((effect) => [
    effect.id,
    migrateLegacyReasonConfig(effect, warnings),
  ]));
  const effectGroups = source.temporaryEffects.map((effect) =>
    migrateEffectGroup(effect, reasonConfigs.get(effect.id)!));
  const conditions = source.autoRules.map((rule) => migrateCondition(rule, nowIso));
  const rules = source.autoRules.map((rule) => migrateRule(rule, nowIso));
  const activeEffects = source.temporaryEffects.filter((effect) => effect.enabled).map((effect) =>
    migrateActiveEffect(effect, reasonConfigs.get(effect.id)!));
  const hourlyMessageBuckets = Object.fromEntries(Object.entries(source.messageFacts).map(([key, facts]) => [
    key,
    hourlyMessageBucketsFromFacts(facts),
  ]));
  const messageFacts = Object.fromEntries(Object.entries(source.messageFacts).map(([key, facts]) => [
    key,
    cloneJson(facts.slice(-MAX_MESSAGE_FACTS_PER_SCOPE_V3)),
  ]));

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
    recordManifest: { segments: [], recordCount: 0, nextSegmentIndex: 1 },
    lastSettled: cloneJson(source.lastSettled),
    turnCounters: cloneJson(source.turnCounters),
    processedMessageIds: source.processedMessageIds.slice(-MAX_PROCESSED_MESSAGE_IDS_V3),
    ruleLastTriggered: cloneJson(source.ruleLastTriggered),
    messageFacts,
    hourlyMessageBuckets,
  };
  hydrateLegacyActiveEffectSnapshots(dataset);
  assertMvuDatasetV3(dataset);

  return {
    dataset,
    records: source.records.map((record) => normalizeLegacyRecord(record, warnings)),
    report: {
      migratedFields: dataset.fields.length,
      migratedRules: dataset.rules.length,
      migratedConditions: dataset.conditions.length,
      migratedEffectGroups: dataset.effectGroups.length,
      warnings,
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

function migrateEffectGroup(effect: DataTemporaryEffect, reason: EffectReasonConfig): EffectGroupDefinition {
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
    description: effect.reasonMode === "custom" ? reason.text : effect.reasonTemplate,
    enabled: effect.enabled,
    fieldEffects: [...targetsByField.entries()].map(([fieldId, targets], index) => ({
      id: `field_effect_${effect.id}_${index}`,
      fieldId,
      actorSelector: actorSelectorForTargets(targets),
      operations: [effect.mode === "additive"
        ? { kind: "fixed_adjustment", value: effect.value, sources: [...ALL_CHANGE_SOURCES] }
        : { kind: "all_multiplier", value: effect.value, sources: [...ALL_CHANGE_SOURCES] }],
    })),
    defaultReason: cloneJson(reason),
    createdAt,
    updatedAt: createdAt,
  };
}

function migrateActiveEffect(effect: DataTemporaryEffect, reason: EffectReasonConfig): ActiveEffectInstance {
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
    reason: reasonSnapshot(reason),
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

function reasonSnapshot(reason: EffectReasonConfig): EffectReasonSnapshot {
  return {
    mode: reason.mode,
    template: reason.template,
    text: normalizeRenderedEffectReason(reason.mode === "custom"
      ? reason.text
      : TEMPORARY_EFFECT_REASON_TEMPLATES[reason.template]),
  };
}

function migrateLegacyReasonConfig(
  effect: DataTemporaryEffect,
  warnings: string[],
): EffectReasonConfig {
  const text = truncateEffectReasonText(effect.reason, EFFECT_REASON_LEGACY_STORAGE_MAX_LENGTH);
  if (text !== effect.reason) {
    warnings.push(
      `MVU_EFFECT_REASON_LEGACY_TRUNCATED:${effect.id}:${effect.reason.length}:${EFFECT_REASON_LEGACY_STORAGE_MAX_LENGTH}`,
    );
  }
  return {
    mode: effect.reasonMode,
    template: effect.reasonTemplate,
    text,
  };
}

function normalizeLegacyRecord(
  record: MvuDataset["records"][number],
  warnings: string[],
): MvuDataset["records"][number] {
  const reason = truncateEffectReasonText(record.reason, EFFECT_REASON_RENDERED_MAX_LENGTH);
  if (reason !== record.reason) {
    warnings.push(
      `MVU_CHANGE_RECORD_REASON_LEGACY_TRUNCATED:${record.id}:${record.reason.length}:${EFFECT_REASON_RENDERED_MAX_LENGTH}`,
    );
  }
  return { ...cloneJson(record), reason };
}

function conditionId(legacyRuleId: string): string { return `condition_${legacyRuleId}`; }
function effectGroupId(legacyEffectId: string): string { return `effect_group_${legacyEffectId}`; }
function isoTimestamp(value: number): string { return new Date(value).toISOString(); }
function cloneJson<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
