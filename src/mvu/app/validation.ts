import { MAX_LINK_CHAIN_DEPTH } from "./automation";
import type {
  AutoRuleCondition,
  DataAutoRule,
  DataChangeRecord,
  DataField,
  DataLinkRule,
  DataTemporaryEffect,
  MessageFact,
  MvuConfiguration,
  MvuDataset,
  MvuSettings,
  TurnCounter,
} from "./model";
import type { ConditionDefinition, ConditionExpression, ConditionPredicate, MvuDatasetV3 } from "./model-v3";
import {
  TEMPORARY_EFFECT_REASON_TEMPLATES,
} from "./temporary-effect";

const STABLE_ID = /^[A-Za-z][A-Za-z0-9_]*$/;

function fail(code: string): never {
  throw new Error(code);
}

function requireFinite(value: number, code: string): void {
  if (!Number.isFinite(value)) fail(code);
}

function requireNonNegative(value: number, code: string): void {
  requireFinite(value, code);
  if (value < 0) fail(code);
}

function requireStableId(value: string, code: string): void {
  if (!STABLE_ID.test(value)) fail(code);
}

function requireUnique(values: readonly string[], code: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) fail(`${code}:${value}`);
    seen.add(value);
  }
}

export function validateDataField(field: DataField): void {
  requireStableId(field.id, `MVU_FIELD_ID_INVALID:${field.id}`);
  if (field.name.trim().length === 0) fail(`MVU_FIELD_NAME_EMPTY:${field.id}`);
  requireFinite(field.minimum, `MVU_FIELD_MIN_INVALID:${field.id}`);
  requireFinite(field.maximum, `MVU_FIELD_MAX_INVALID:${field.id}`);
  if (field.minimum >= field.maximum) fail(`MVU_FIELD_RANGE_INVALID:${field.id}`);
  requireFinite(field.step, `MVU_FIELD_STEP_INVALID:${field.id}`);
  if (field.step <= 0) fail(`MVU_FIELD_STEP_INVALID:${field.id}`);
  requireFinite(field.initialValue, `MVU_FIELD_INITIAL_INVALID:${field.id}`);
  if (field.initialValue < field.minimum || field.initialValue > field.maximum) {
    fail(`MVU_FIELD_INITIAL_OUT_OF_RANGE:${field.id}`);
  }
  requireFinite(field.order, `MVU_FIELD_ORDER_INVALID:${field.id}`);
  if (field.themeColor.trim().length === 0) fail(`MVU_FIELD_THEME_COLOR_EMPTY:${field.id}`);
  requireUnique(field.bindingIds, `MVU_FIELD_BINDING_DUPLICATE:${field.id}`);
  if (field.bindingIds.some((bindingId) => bindingId.length === 0)) {
    fail(`MVU_FIELD_BINDING_EMPTY:${field.id}`);
  }
  if (field.scope === "global" && field.bindingIds.length > 0) {
    fail(`MVU_GLOBAL_FIELD_HAS_BINDINGS:${field.id}`);
  }

  if (field.stages.length === 0) fail(`MVU_FIELD_STAGE_EMPTY:${field.id}`);
  requireUnique(field.stages.map((stage) => stage.id), `MVU_STAGE_ID_DUPLICATE:${field.id}`);
  let previousThreshold = field.minimum - 1;
  for (let index = 0; index < field.stages.length; index += 1) {
    const stage = field.stages[index];
    requireStableId(stage.id, `MVU_STAGE_ID_INVALID:${field.id}:${stage.id}`);
    if (stage.name.trim().length === 0) fail(`MVU_STAGE_NAME_EMPTY:${field.id}:${stage.id}`);
    requireFinite(stage.threshold, `MVU_STAGE_THRESHOLD_INVALID:${field.id}:${stage.id}`);
    if (index === 0 && stage.threshold !== field.minimum) {
      fail(`MVU_STAGE_FIRST_THRESHOLD_INVALID:${field.id}`);
    }
    if (stage.threshold <= previousThreshold || stage.threshold > field.maximum) {
      fail(`MVU_STAGE_THRESHOLD_ORDER_INVALID:${field.id}:${stage.id}`);
    }
    previousThreshold = stage.threshold;
  }

  requireFinite(field.naturalChange.unitMs, `MVU_NATURAL_UNIT_INVALID:${field.id}`);
  if (field.naturalChange.unitMs <= 0) fail(`MVU_NATURAL_UNIT_INVALID:${field.id}`);
  requireFinite(field.naturalChange.amount, `MVU_NATURAL_AMOUNT_INVALID:${field.id}`);
  requireFinite(field.perTurnChange.intervalTurns, `MVU_TURN_INTERVAL_INVALID:${field.id}`);
  if (!Number.isInteger(field.perTurnChange.intervalTurns) || field.perTurnChange.intervalTurns <= 0) {
    fail(`MVU_TURN_INTERVAL_INVALID:${field.id}`);
  }
  requireFinite(field.perTurnChange.amount, `MVU_TURN_AMOUNT_INVALID:${field.id}`);
  requireFinite(field.ai.minConfidence, `MVU_AI_CONFIDENCE_INVALID:${field.id}`);
  if (field.ai.minConfidence < 0 || field.ai.minConfidence > 1) {
    fail(`MVU_AI_CONFIDENCE_INVALID:${field.id}`);
  }
  requireNonNegative(field.ai.maxDelta, `MVU_AI_MAX_DELTA_INVALID:${field.id}`);
}

function validateAutoCondition(
  condition: AutoRuleCondition,
  fieldIds: ReadonlySet<string>,
  ruleId: string
): void {
  switch (condition.kind) {
    case "recentPositive":
      requireNonNegative(condition.count, `MVU_AUTO_CONDITION_INVALID:${ruleId}`);
      return;
    case "longInactive":
      requireNonNegative(condition.hours, `MVU_AUTO_CONDITION_INVALID:${ruleId}`);
      return;
    case "highFreq":
      requireNonNegative(condition.messages, `MVU_AUTO_CONDITION_INVALID:${ruleId}`);
      return;
    case "stateThreshold":
      if (!fieldIds.has(condition.fieldId)) fail(`MVU_AUTO_FIELD_NOT_FOUND:${ruleId}:${condition.fieldId}`);
      requireFinite(condition.threshold, `MVU_AUTO_CONDITION_INVALID:${ruleId}`);
      return;
    case "aiJudgement":
      if (condition.triggerType.trim().length === 0 || condition.triggerType.length > 80 ||
        condition.requirement.trim().length === 0 || condition.requirement.length > 2_000) {
        fail(`MVU_AUTO_AI_CONDITION_TEXT_INVALID:${ruleId}`);
      }
      requireFinite(condition.minimumConfidence, `MVU_AUTO_AI_CONFIDENCE_INVALID:${ruleId}`);
      if (condition.minimumConfidence < 0 || condition.minimumConfidence > 1) {
        fail(`MVU_AUTO_AI_CONFIDENCE_INVALID:${ruleId}`);
      }
      return;
    case "userCare":
    case "specialDay":
      return;
  }
}

export function validateLinkRule(rule: DataLinkRule, fields: readonly DataField[]): void {
  requireStableId(rule.id, `MVU_LINK_RULE_ID_INVALID:${rule.id}`);
  const fieldIds = new Set(fields.map((field) => field.id));
  if (!fieldIds.has(rule.sourceFieldId)) fail(`MVU_LINK_SOURCE_NOT_FOUND:${rule.id}`);
  if (!fieldIds.has(rule.targetFieldId)) fail(`MVU_LINK_TARGET_NOT_FOUND:${rule.id}`);
  if (rule.sourceFieldId === rule.targetFieldId) fail(`MVU_LINK_SELF_LOOP:${rule.id}`);
  requireFinite(rule.sourceThreshold, `MVU_LINK_THRESHOLD_INVALID:${rule.id}`);
  requireFinite(rule.effect.value, `MVU_LINK_EFFECT_INVALID:${rule.id}`);
  if (rule.effect.kind === "multiplier" && rule.effect.value < 0) {
    fail(`MVU_LINK_MULTIPLIER_INVALID:${rule.id}`);
  }
}

export function validateAutoRule(
  rule: DataAutoRule,
  fields: readonly DataField[],
  temporaryEffects: readonly DataTemporaryEffect[]
): void {
  requireStableId(rule.id, `MVU_AUTO_RULE_ID_INVALID:${rule.id}`);
  if (rule.name.trim().length === 0) fail(`MVU_AUTO_RULE_NAME_EMPTY:${rule.id}`);
  requireNonNegative(rule.cooldownMs, `MVU_AUTO_RULE_COOLDOWN_INVALID:${rule.id}`);
  requireFinite(rule.order, `MVU_AUTO_RULE_ORDER_INVALID:${rule.id}`);
  if (rule.effects.length === 0) fail(`MVU_AUTO_RULE_EFFECTS_EMPTY:${rule.id}`);
  const fieldIds = new Set(fields.map((field) => field.id));
  validateAutoCondition(rule.condition, fieldIds, rule.id);
  for (const effect of rule.effects) {
    if (!fieldIds.has(effect.fieldId)) fail(`MVU_AUTO_EFFECT_FIELD_NOT_FOUND:${rule.id}:${effect.fieldId}`);
    requireFinite(effect.delta, `MVU_AUTO_EFFECT_DELTA_INVALID:${rule.id}:${effect.fieldId}`);
    requireUnique(effect.temporaryEffectIds, `MVU_AUTO_EFFECT_IMPORT_DUPLICATE:${rule.id}:${effect.fieldId}`);
    for (const temporaryEffectId of effect.temporaryEffectIds) {
      const temporaryEffect = temporaryEffects.find((candidate) => candidate.id === temporaryEffectId);
      if (temporaryEffect === undefined) {
        fail(`MVU_AUTO_EFFECT_IMPORT_NOT_FOUND:${rule.id}:${temporaryEffectId}`);
      }
      if (!temporaryEffect.targets.some((target) => target.fieldId === effect.fieldId)) {
        fail(`MVU_AUTO_EFFECT_IMPORT_TARGET_MISMATCH:${rule.id}:${temporaryEffectId}`);
      }
    }
  }
}

export function validateTemporaryEffect(
  effect: DataTemporaryEffect,
  fields: readonly DataField[]
): void {
  requireStableId(effect.id, `MVU_EFFECT_ID_INVALID:${effect.id}`);
  if (effect.targets.length === 0) fail(`MVU_EFFECT_TARGETS_EMPTY:${effect.id}`);
  requireUnique(
    effect.targets.map((target) => `${target.fieldId}\u0000${target.scopeKey}`),
    `MVU_EFFECT_TARGET_DUPLICATE:${effect.id}`
  );
  for (const target of effect.targets) {
    const field = fields.find((candidate) => candidate.id === target.fieldId);
    if (field === undefined) fail(`MVU_EFFECT_FIELD_NOT_FOUND:${effect.id}:${target.fieldId}`);
    if (field.scope !== target.scope) fail(`MVU_EFFECT_SCOPE_MISMATCH:${effect.id}:${target.fieldId}`);
    const validScopeKey = target.scope === "global"
      ? target.scopeKey === "global"
      : target.scopeKey.startsWith(`${target.scope}:`) &&
        target.scopeKey.length > target.scope.length + 1;
    if (!validScopeKey) fail(`MVU_EFFECT_SCOPE_KEY_INVALID:${effect.id}:${target.fieldId}`);
    if (target.scope !== "global") {
      const bindingId = target.scopeKey.slice(target.scope.length + 1);
      if (!field.bindingIds.includes(bindingId)) {
        fail(`MVU_EFFECT_SCOPE_NOT_BOUND:${effect.id}:${target.fieldId}`);
      }
    }
  }
  requireFinite(effect.value, `MVU_EFFECT_VALUE_INVALID:${effect.id}`);
  if (effect.mode === "multiplier" && effect.value < 0) fail(`MVU_EFFECT_MULTIPLIER_INVALID:${effect.id}`);
  if (effect.expiresAt !== null) requireNonNegative(effect.expiresAt, `MVU_EFFECT_EXPIRES_INVALID:${effect.id}`);
  if (effect.remainingTurns !== null) {
    requireNonNegative(effect.remainingTurns, `MVU_EFFECT_TURNS_INVALID:${effect.id}`);
    if (!Number.isInteger(effect.remainingTurns)) fail(`MVU_EFFECT_TURNS_INVALID:${effect.id}`);
    if (effect.enabled && effect.remainingTurns === 0) fail(`MVU_EFFECT_ENABLED_WITHOUT_TURNS:${effect.id}`);
  }
  requireNonNegative(effect.createdAt, `MVU_EFFECT_CREATED_INVALID:${effect.id}`);
  if (!(effect.reasonTemplate in TEMPORARY_EFFECT_REASON_TEMPLATES)) {
    fail(`MVU_EFFECT_REASON_TEMPLATE_INVALID:${effect.id}`);
  }
  if (effect.reasonMode === "custom" && effect.reason.trim().length === 0) {
    fail(`MVU_EFFECT_REASON_EMPTY:${effect.id}`);
  }
}

function validateLinkGraph(rules: readonly DataLinkRule[]): void {
  const outgoing = new Map<string, DataLinkRule[]>();
  for (const rule of rules) {
    const entries = outgoing.get(rule.sourceFieldId);
    if (entries === undefined) outgoing.set(rule.sourceFieldId, [rule]);
    else entries.push(rule);
  }

  const visit = (fieldId: string, path: readonly string[], depth: number): void => {
    const entries = outgoing.get(fieldId) ?? [];
    for (const rule of entries) {
      if (path.includes(rule.targetFieldId)) fail(`MVU_LINK_CYCLE:${rule.id}`);
      if (depth + 1 > MAX_LINK_CHAIN_DEPTH) fail(`MVU_LINK_DEPTH_EXCEEDED:${rule.id}`);
      visit(rule.targetFieldId, [...path, rule.targetFieldId], depth + 1);
    }
  };
  for (const sourceFieldId of outgoing.keys()) visit(sourceFieldId, [sourceFieldId], 0);
}

export function validateConfiguration(configuration: MvuConfiguration): void {
  requireUnique(configuration.fields.map((field) => field.id), "MVU_FIELD_ID_DUPLICATE");
  for (const field of configuration.fields) validateDataField(field);
  requireUnique(configuration.rules.map((rule) => rule.id), "MVU_LINK_RULE_ID_DUPLICATE");
  for (const rule of configuration.rules) validateLinkRule(rule, configuration.fields);
  validateLinkGraph(configuration.rules);
  requireUnique(configuration.autoRules.map((rule) => rule.id), "MVU_AUTO_RULE_ID_DUPLICATE");
  for (const rule of configuration.autoRules) {
    validateAutoRule(rule, configuration.fields, configuration.temporaryEffects);
  }
  requireUnique(configuration.temporaryEffects.map((effect) => effect.id), "MVU_EFFECT_ID_DUPLICATE");
  for (const effect of configuration.temporaryEffects) {
    validateTemporaryEffect(effect, configuration.fields);
  }
  if (typeof configuration.settings.aiEnabled !== "boolean") fail("MVU_SETTINGS_AI_ENABLED_INVALID");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Version 2 was already published with single-target temporary effects. Keep the
 * document version stable while converting those records to the canonical
 * multi-target shape before strict validation.
 */
export function normalizeMvuDataset(value: unknown): MvuDataset {
  let normalized = value;
  if (isRecord(value) && value.formatVersion === 2 && Array.isArray(value.temporaryEffects)) {
    normalized = {
      ...value,
      temporaryEffects: value.temporaryEffects.map(normalizeLegacyTemporaryEffect),
      autoRules: Array.isArray(value.autoRules)
        ? value.autoRules.map(normalizeLegacyAutoRule)
        : value.autoRules,
    };
  }
  assertMvuDataset(normalized);
  return normalized;
}

function normalizeLegacyTemporaryEffect(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const {
    triggerSources: _legacyTriggerSources,
    source: _legacySource,
    targetFieldId,
    scope,
    scopeKey,
    ...rest
  } = value;
  if (Array.isArray(value.targets)) return { ...rest, targets: value.targets };
  if (typeof targetFieldId !== "string" || typeof scope !== "string" ||
    typeof scopeKey !== "string") return value;
  return {
    ...rest,
    targets: [{ fieldId: targetFieldId, scope, scopeKey }],
    reasonMode: "custom",
    reasonTemplate: "general",
  };
}

function normalizeLegacyAutoRule(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.effects)) return value;
  return {
    ...value,
    effects: value.effects.map((effect) => isRecord(effect)
      ? {
          ...effect,
          temporaryEffectIds: Array.isArray(effect.temporaryEffectIds)
            ? effect.temporaryEffectIds
            : [],
        }
      : effect),
  };
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function assertDataFieldShape(value: unknown): asserts value is DataField {
  if (!isRecord(value) || !isRecord(value.ai) || !isRecord(value.naturalChange) || !isRecord(value.perTurnChange)) {
    fail("INVALID_MVU_FIELD");
  }
  if (
    typeof value.id !== "string" || typeof value.name !== "string" ||
    typeof value.description !== "string" || !isFiniteNumber(value.minimum) ||
    !isFiniteNumber(value.maximum) || !isFiniteNumber(value.step) ||
    !isFiniteNumber(value.initialValue) || typeof value.icon !== "string" ||
    typeof value.themeColor !== "string" || typeof value.enabled !== "boolean" ||
    (value.scope !== "character" && value.scope !== "group" && value.scope !== "global" && value.scope !== "chat") ||
    (value.modelVisibility !== "full" && value.modelVisibility !== "stage_only" && value.modelVisibility !== "hidden") ||
    typeof value.ai.enabled !== "boolean" || !isFiniteNumber(value.ai.minConfidence) ||
    !isFiniteNumber(value.ai.maxDelta) || typeof value.ai.prompt !== "string" ||
    !Array.isArray(value.stages) || !Array.isArray(value.bindingIds) ||
    !value.bindingIds.every((entry) => typeof entry === "string") ||
    typeof value.naturalChange.enabled !== "boolean" || !isFiniteNumber(value.naturalChange.unitMs) ||
    !isFiniteNumber(value.naturalChange.amount) || typeof value.perTurnChange.enabled !== "boolean" ||
    !isFiniteNumber(value.perTurnChange.intervalTurns) || !isFiniteNumber(value.perTurnChange.amount) ||
    (value.perTurnChange.countMode !== "user" && value.perTurnChange.countMode !== "character" && value.perTurnChange.countMode !== "both") ||
    !isFiniteNumber(value.order)
  ) fail("INVALID_MVU_FIELD");
  for (const stage of value.stages) {
    if (!isRecord(stage) || typeof stage.id !== "string" || typeof stage.name !== "string" ||
      typeof stage.description !== "string" || !isFiniteNumber(stage.threshold)) {
      fail("INVALID_MVU_STAGE");
    }
  }
}

function assertLinkRuleShape(value: unknown): asserts value is DataLinkRule {
  if (!isRecord(value) || !isRecord(value.effect) || typeof value.id !== "string" ||
    typeof value.sourceFieldId !== "string" || typeof value.targetFieldId !== "string" ||
    !isFiniteNumber(value.sourceThreshold) || typeof value.enabled !== "boolean" ||
    (value.operator !== ">=" && value.operator !== ">" && value.operator !== "<=" && value.operator !== "<" && value.operator !== "==") ||
    (value.effect.kind !== "multiplier" && value.effect.kind !== "delta") ||
    !isFiniteNumber(value.effect.value)) fail("INVALID_MVU_LINK_RULE");
}

function assertAutoRuleShape(value: unknown): asserts value is DataAutoRule {
  if (!isRecord(value) || !isRecord(value.condition) || !Array.isArray(value.effects) ||
    typeof value.id !== "string" || typeof value.name !== "string" ||
    typeof value.description !== "string" || typeof value.enabled !== "boolean" ||
    !isFiniteNumber(value.cooldownMs) || !isFiniteNumber(value.order) ||
    typeof value.condition.kind !== "string") fail("INVALID_MVU_AUTO_RULE");
  const kind = value.condition.kind;
  if (kind === "recentPositive" && !isFiniteNumber(value.condition.count)) fail("INVALID_MVU_AUTO_CONDITION");
  if (kind === "longInactive" && !isFiniteNumber(value.condition.hours)) fail("INVALID_MVU_AUTO_CONDITION");
  if (kind === "highFreq" && !isFiniteNumber(value.condition.messages)) fail("INVALID_MVU_AUTO_CONDITION");
  if (kind === "stateThreshold" && (typeof value.condition.fieldId !== "string" ||
    !isFiniteNumber(value.condition.threshold) ||
    (value.condition.operator !== ">=" && value.condition.operator !== "<=" && value.condition.operator !== ">" && value.condition.operator !== "<"))) {
    fail("INVALID_MVU_AUTO_CONDITION");
  }
  if (kind === "aiJudgement" && (typeof value.condition.triggerType !== "string" ||
    typeof value.condition.requirement !== "string" ||
    !isFiniteNumber(value.condition.minimumConfidence))) fail("INVALID_MVU_AUTO_CONDITION");
  if (kind !== "recentPositive" && kind !== "longInactive" && kind !== "userCare" &&
    kind !== "specialDay" && kind !== "highFreq" && kind !== "stateThreshold" &&
    kind !== "aiJudgement") fail("INVALID_MVU_AUTO_CONDITION");
  for (const effect of value.effects) {
    if (!isRecord(effect) || typeof effect.fieldId !== "string" || !isFiniteNumber(effect.delta) ||
      !Array.isArray(effect.temporaryEffectIds) ||
      !effect.temporaryEffectIds.every((entry) => typeof entry === "string")) {
      fail("INVALID_MVU_AUTO_EFFECT");
    }
  }
}

function assertSettingsShape(value: unknown): asserts value is MvuSettings {
  if (!isRecord(value) || typeof value.aiEnabled !== "boolean") fail("INVALID_MVU_SETTINGS");
}

function assertTemporaryEffectShape(value: unknown): asserts value is DataTemporaryEffect {
  if (!isRecord(value) || typeof value.id !== "string" || !Array.isArray(value.targets) ||
    (value.mode !== "multiplier" && value.mode !== "additive") || !isFiniteNumber(value.value) ||
    typeof value.enabled !== "boolean" || !(value.expiresAt === null || isFiniteNumber(value.expiresAt)) ||
    !(value.remainingTurns === null || isFiniteNumber(value.remainingTurns)) ||
    (value.reasonMode !== "template" && value.reasonMode !== "custom") ||
    (value.reasonTemplate !== "general" && value.reasonTemplate !== "positive" &&
      value.reasonTemplate !== "negative" && value.reasonTemplate !== "environment" &&
      value.reasonTemplate !== "relationship") ||
    typeof value.reason !== "string" ||
    !isFiniteNumber(value.createdAt)) fail("INVALID_MVU_TEMPORARY_EFFECT");
  for (const target of value.targets) {
    if (!isRecord(target) || typeof target.fieldId !== "string" ||
      (target.scope !== "character" && target.scope !== "group" &&
        target.scope !== "global" && target.scope !== "chat") ||
      typeof target.scopeKey !== "string") fail("INVALID_MVU_TEMPORARY_EFFECT_TARGET");
  }
}

function assertRecordShape(value: unknown): asserts value is DataChangeRecord {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.scopeKey !== "string" ||
    (value.scope !== "character" && value.scope !== "group" && value.scope !== "global" && value.scope !== "chat") ||
    typeof value.fieldId !== "string" || typeof value.fieldName !== "string" ||
    !isStringOrNull(value.actorId) || typeof value.actorName !== "string" ||
    !isStringOrNull(value.chatId) || !isStringOrNull(value.groupId) ||
    !isFiniteNumber(value.before) || !isFiniteNumber(value.after) ||
    !isFiniteNumber(value.requestedDelta) || !isFiniteNumber(value.effectiveRequestedDelta) ||
    !isFiniteNumber(value.delta) ||
    typeof value.stageBefore !== "string" || typeof value.stageAfter !== "string" ||
    typeof value.reason !== "string" || !Array.isArray(value.ruleIds) || !Array.isArray(value.effectIds) ||
    !value.ruleIds.every((entry) => typeof entry === "string") ||
    !value.effectIds.every((entry) => typeof entry === "string") ||
    !(value.confidence === null || isFiniteNumber(value.confidence)) ||
    !isStringOrNull(value.messageId) || !isStringOrNull(value.variantId) ||
    !isFiniteNumber(value.occurredAt) ||
    (value.source !== "manual" && value.source !== "natural" && value.source !== "per_turn" && value.source !== "rule" && value.source !== "ai")) {
    fail("INVALID_MVU_CHANGE_RECORD");
  }
}

function assertTurnCounterShape(value: unknown): asserts value is TurnCounter {
  if (!isRecord(value) || !isFiniteNumber(value.userMessages) ||
    !isFiniteNumber(value.characterMessages) || !Number.isInteger(value.userMessages) ||
    !Number.isInteger(value.characterMessages) || value.userMessages < 0 || value.characterMessages < 0) {
    fail("INVALID_MVU_TURN_COUNTER");
  }
}

function assertMessageFactShape(value: unknown): asserts value is MessageFact {
  if (!isRecord(value) || typeof value.messageId !== "string" || !isStringOrNull(value.variantId) ||
    typeof value.content !== "string" || value.content.length > 2_000 ||
    !isStringOrNull(value.chatId) || !isStringOrNull(value.actorId) || !isStringOrNull(value.groupId) ||
    (value.role !== "user" && value.role !== "character") || !isFiniteNumber(value.occurredAt) ||
    !(value.recentPositiveCount === null || isFiniteNumber(value.recentPositiveCount)) ||
    !(value.userCareDetected === null || typeof value.userCareDetected === "boolean") ||
    !(value.lastInteractionAt === null || isFiniteNumber(value.lastInteractionAt)) ||
    !(value.messageCountInLast24Hours === null || isFiniteNumber(value.messageCountInLast24Hours)) ||
    !(value.specialDayDetected === null || typeof value.specialDayDetected === "boolean")) {
    fail("INVALID_MVU_MESSAGE_FACT");
  }
}

function assertNestedNumberMap(value: unknown): asserts value is Record<string, Record<string, number>> {
  if (!isRecord(value)) fail("INVALID_MVU_NUMBER_MAP");
  for (const entry of Object.values(value)) {
    if (!isRecord(entry) || !Object.values(entry).every(isFiniteNumber)) fail("INVALID_MVU_NUMBER_MAP");
  }
}

function assertNestedCounterMap(value: unknown): asserts value is Record<string, Record<string, TurnCounter>> {
  if (!isRecord(value)) fail("INVALID_MVU_COUNTER_MAP");
  for (const entry of Object.values(value)) {
    if (!isRecord(entry)) fail("INVALID_MVU_COUNTER_MAP");
    for (const counter of Object.values(entry)) assertTurnCounterShape(counter);
  }
}

function assertMessageFactsMap(value: unknown): asserts value is Record<string, MessageFact[]> {
  if (!isRecord(value)) fail("INVALID_MVU_MESSAGE_FACTS");
  for (const entry of Object.values(value)) {
    if (!Array.isArray(entry) || entry.length > 20) fail("INVALID_MVU_MESSAGE_FACTS");
    for (const fact of entry) assertMessageFactShape(fact);
  }
}

function isProcessedMessageKey(value: string): boolean {
  return /^chat:(?:null|value:[^|]+)\|message:value:[^|]+\|variant:(?:original:null|value:[^|]+)$/.test(value);
}

function runtimeKeyAppliesToField(key: string, field: DataField): boolean {
  if (field.scope === "global") return key === "global";
  const prefix = `${field.scope}:`;
  return key.startsWith(prefix) && field.bindingIds.includes(key.slice(prefix.length));
}

function assertRuntimeFieldMaps(dataset: MvuDataset): void {
  const fields = new Map(dataset.fields.map((field) => [field.id, field]));
  for (const [key, state] of Object.entries(dataset.stateValues)) {
    for (const [fieldId, value] of Object.entries(state)) {
      const field = fields.get(fieldId);
      if (field === undefined || !runtimeKeyAppliesToField(key, field) ||
        value < field.minimum || value > field.maximum) fail("INVALID_MVU_STATE_VALUE");
    }
  }
  for (const [key, settled] of Object.entries(dataset.lastSettled)) {
    for (const fieldId of Object.keys(settled)) {
      const field = fields.get(fieldId);
      if (field === undefined || !runtimeKeyAppliesToField(key, field)) {
        fail("INVALID_MVU_SETTLEMENT_KEY");
      }
    }
  }
  for (const [key, counters] of Object.entries(dataset.turnCounters)) {
    for (const fieldId of Object.keys(counters)) {
      const field = fields.get(fieldId);
      if (field === undefined || !runtimeKeyAppliesToField(key, field)) {
        fail("INVALID_MVU_TURN_COUNTER_KEY");
      }
    }
  }
}

function validatePendingBootstrapFields(dataset: MvuDataset): void {
  requireUnique(
    dataset.pendingBootstrapFieldIds,
    "MVU_PENDING_BOOTSTRAP_FIELD_DUPLICATE"
  );
  const fieldsById = new Map(dataset.fields.map((field) => [field.id, field]));
  for (const fieldId of dataset.pendingBootstrapFieldIds) {
    const field = fieldsById.get(fieldId);
    if (field === undefined) fail(`MVU_PENDING_BOOTSTRAP_FIELD_NOT_FOUND:${fieldId}`);
    if (field.scope === "global") fail(`MVU_PENDING_BOOTSTRAP_FIELD_GLOBAL:${fieldId}`);
    if (field.bindingIds.length > 0) fail(`MVU_PENDING_BOOTSTRAP_FIELD_BOUND:${fieldId}`);
  }
}

export function assertMvuDataset(value: unknown): asserts value is MvuDataset {
  if (!isRecord(value) || value.formatVersion !== 2 || !isFiniteNumber(value.createdAt) ||
    !isFiniteNumber(value.revision) || !Number.isInteger(value.revision) || value.revision < 0 ||
    !Array.isArray(value.fields) || !Array.isArray(value.rules) || !Array.isArray(value.autoRules) ||
    !Array.isArray(value.pendingBootstrapFieldIds) ||
    !value.pendingBootstrapFieldIds.every((entry) => typeof entry === "string") ||
    !Array.isArray(value.temporaryEffects) ||
    !Array.isArray(value.records) || !Array.isArray(value.processedMessageIds)) {
    fail("INVALID_MVU_DATASET");
  }
  const settings = value.settings;
  assertSettingsShape(settings);
  const fields = value.fields.map((field) => {
    assertDataFieldShape(field);
    return field;
  });
  const rules = value.rules.map((rule) => {
    assertLinkRuleShape(rule);
    return rule;
  });
  const autoRules = value.autoRules.map((rule) => {
    assertAutoRuleShape(rule);
    return rule;
  });
  const temporaryEffects = value.temporaryEffects.map((effect) => {
    assertTemporaryEffectShape(effect);
    return effect;
  });
  const records = value.records.map((record) => {
    assertRecordShape(record);
    return record;
  });
  const processedMessageIds = value.processedMessageIds.map((entry) => {
    if (typeof entry !== "string" || !isProcessedMessageKey(entry)) fail("INVALID_MVU_DATASET");
    return entry;
  });
  const stateValues = value.stateValues;
  assertNestedNumberMap(stateValues);
  const lastSettled = value.lastSettled;
  assertNestedNumberMap(lastSettled);
  const turnCounters = value.turnCounters;
  assertNestedCounterMap(turnCounters);
  const ruleLastTriggered = value.ruleLastTriggered;
  assertNestedNumberMap(ruleLastTriggered);
  const messageFacts = value.messageFacts;
  assertMessageFactsMap(messageFacts);

  const dataset: MvuDataset = {
    formatVersion: 2,
    createdAt: value.createdAt,
    revision: value.revision,
    settings,
    fields,
    pendingBootstrapFieldIds: value.pendingBootstrapFieldIds,
    rules,
    autoRules,
    temporaryEffects,
    stateValues,
    records,
    lastSettled,
    turnCounters,
    processedMessageIds,
    ruleLastTriggered,
    messageFacts,
  };
  validateConfiguration(dataset);
  validatePendingBootstrapFields(dataset);
  assertRuntimeFieldMaps(dataset);
  requireUnique(dataset.processedMessageIds, "MVU_PROCESSED_MESSAGE_DUPLICATE");
}

/**
 * Lightweight boundary validation for Task 1's pure conversion. Detailed v3
 * entity validation grows with the condition and effect engines in later tasks.
 */
export function assertMvuDatasetV3(value: unknown): asserts value is MvuDatasetV3 {
  if (!isRecord(value) || value.formatVersion !== 3 || !Array.isArray(value.fields) ||
    !Array.isArray(value.linkRules) || !Array.isArray(value.conditions) ||
    !Array.isArray(value.rules) || !Array.isArray(value.effectGroups) ||
    !Array.isArray(value.activeEffects)) fail("INVALID_MVU_V3_DATASET");

  const conditionIds = new Set<string>();
  const aiPredicateIds = new Set<string>();
  for (const condition of value.conditions) {
    if (!isRecord(condition) || typeof condition.id !== "string" || conditionIds.has(condition.id)) {
      fail("INVALID_MVU_V3_CONDITION");
    }
    assertConditionDefinitionShape(condition);
    for (const aiPredicateId of conditionAiPredicateIds(condition.expression)) {
      if (aiPredicateIds.has(aiPredicateId)) fail("MVU_V3_CONDITION_AI_ID_DUPLICATE");
      aiPredicateIds.add(aiPredicateId);
    }
    conditionIds.add(condition.id);
  }
  const effectGroupIds = new Set<string>();
  for (const effectGroup of value.effectGroups) {
    if (!isRecord(effectGroup) || typeof effectGroup.id !== "string" || effectGroupIds.has(effectGroup.id)) {
      fail("INVALID_MVU_V3_EFFECT_GROUP");
    }
    effectGroupIds.add(effectGroup.id);
  }
  for (const rule of value.rules) {
    if (!isRecord(rule) || typeof rule.conditionId !== "string" || !conditionIds.has(rule.conditionId) ||
      !Array.isArray(rule.actions)) fail("INVALID_MVU_V3_RULE");
    for (const action of rule.actions) {
      if (!isRecord(action)) fail("INVALID_MVU_V3_RULE_ACTION");
      if (action.kind === "change_field") {
        if (!Array.isArray(action.effectGroupIds) ||
          !action.effectGroupIds.every((id) => typeof id === "string" && effectGroupIds.has(id))) {
          fail("INVALID_MVU_V3_RULE_EFFECT_REFERENCE");
        }
      } else if (action.kind === "activate_effect_group") {
        if (typeof action.effectGroupId !== "string" || !effectGroupIds.has(action.effectGroupId)) {
          fail("INVALID_MVU_V3_RULE_EFFECT_REFERENCE");
        }
      } else {
        fail("INVALID_MVU_V3_RULE_ACTION");
      }
    }
  }
  for (const instance of value.activeEffects) {
    if (!isRecord(instance) || typeof instance.definitionId !== "string" ||
      !effectGroupIds.has(instance.definitionId)) fail("INVALID_MVU_V3_ACTIVE_EFFECT");
  }
}

/** Validates reusable expressions before they are persisted or evaluated. */
export function validateConditionExpression(expression: ConditionExpression): void {
  assertConditionExpressionShape(expression, 0);
  assertUniqueAiPredicateIds(expression);
}

/** Validates reusable condition metadata and its bounded expression tree. */
export function validateConditionDefinition(condition: ConditionDefinition): void {
  assertConditionDefinitionShape(condition);
  assertUniqueAiPredicateIds(condition.expression);
}

function assertConditionDefinitionShape(value: unknown): asserts value is ConditionDefinition {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" ||
    typeof value.description !== "string" || typeof value.enabled !== "boolean" ||
    typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") {
    fail("INVALID_MVU_V3_CONDITION");
  }
  assertConditionExpressionShape(value.expression, 0);
}

function assertConditionExpressionShape(value: unknown, depth: number): asserts value is ConditionExpression {
  if (!isRecord(value) || typeof value.kind !== "string") fail("MVU_V3_CONDITION_EXPRESSION_INVALID");
  if (depth > 12) fail("MVU_V3_CONDITION_DEPTH_EXCEEDED");
  switch (value.kind) {
    case "predicate":
      assertConditionPredicateShape(value.predicate);
      return;
    case "not":
      assertConditionExpressionShape(value.child, depth + 1);
      return;
    case "and":
    case "or":
      if (!Array.isArray(value.children) || value.children.length === 0) {
        fail(`MVU_V3_CONDITION_${value.kind.toUpperCase()}_EMPTY`);
      }
      for (const child of value.children) assertConditionExpressionShape(child, depth + 1);
      return;
    default:
      fail("MVU_V3_CONDITION_EXPRESSION_INVALID");
  }
}

function assertConditionPredicateShape(value: unknown): asserts value is ConditionPredicate {
  if (!isRecord(value) || typeof value.kind !== "string") fail("MVU_V3_CONDITION_PREDICATE_INVALID");
  switch (value.kind) {
    case "recent_positive":
      requireNonNegativeUnknown(value.count, "MVU_V3_CONDITION_RECENT_POSITIVE_INVALID");
      return;
    case "long_inactive":
      requireNonNegativeUnknown(value.hours, "MVU_V3_CONDITION_INACTIVITY_INVALID");
      return;
    case "user_care":
    case "special_day":
      return;
    case "high_frequency":
      requireNonNegativeUnknown(value.messages, "MVU_V3_CONDITION_HIGH_FREQUENCY_INVALID");
      optionalNonNegativeUnknown(value.windowHours, "MVU_V3_CONDITION_HIGH_FREQUENCY_INVALID");
      optionalPositiveUnknown(value.bucketHours, "MVU_V3_CONDITION_HIGH_FREQUENCY_INVALID");
      return;
    case "field_comparison":
      if (typeof value.fieldId !== "string" || !isFiniteNumber(value.value) ||
        (value.operator !== ">=" && value.operator !== "<=" && value.operator !== ">" && value.operator !== "<" && value.operator !== "==")) {
        fail("MVU_V3_CONDITION_FIELD_COMPARISON_INVALID");
      }
      return;
    case "message_count":
      requireNonNegativeUnknown(value.count, "MVU_V3_CONDITION_MESSAGE_COUNT_INVALID");
      requireNonNegativeUnknown(value.windowHours, "MVU_V3_CONDITION_MESSAGE_COUNT_INVALID");
      if (value.sender !== undefined && value.sender !== "user" && value.sender !== "character") {
        fail("MVU_V3_CONDITION_MESSAGE_COUNT_INVALID");
      }
      return;
    case "keywords":
      assertStringArray(value.includeAny, "MVU_V3_CONDITION_KEYWORDS_INVALID");
      assertStringArray(value.includeAll, "MVU_V3_CONDITION_KEYWORDS_INVALID");
      assertStringArray(value.exclude, "MVU_V3_CONDITION_KEYWORDS_INVALID");
      if (value.includeAny.length + value.includeAll.length + value.exclude.length > 100 ||
        (value.windowHours !== undefined && !isFiniteNonNegative(value.windowHours)) ||
        (value.caseSensitive !== undefined && typeof value.caseSensitive !== "boolean")) {
        fail("MVU_V3_CONDITION_KEYWORDS_INVALID");
      }
      return;
    case "sender":
      assertSenderArray(value.senders, "MVU_V3_CONDITION_SENDER_INVALID");
      return;
    case "actor":
      assertStringArray(value.actorIds, "MVU_V3_CONDITION_ACTOR_INVALID");
      return;
    case "group":
      assertStringArray(value.groupIds, "MVU_V3_CONDITION_GROUP_INVALID");
      return;
    case "concrete_date":
      assertStringArray(value.dates, "MVU_V3_CONDITION_CONCRETE_DATE_INVALID");
      return;
    case "repeating_date":
      if (typeof value.month !== "number" || !Number.isInteger(value.month) || value.month < 1 || value.month > 12 ||
        typeof value.day !== "number" || !Number.isInteger(value.day) || value.day < 1 || value.day > 31) {
        fail("MVU_V3_CONDITION_REPEATING_DATE_INVALID");
      }
      return;
    case "ai_semantic":
      if (typeof value.id !== "string" || !STABLE_ID.test(value.id) || typeof value.triggerType !== "string" ||
        value.triggerType.trim().length === 0 || typeof value.requirement !== "string" ||
        value.requirement.trim().length === 0 || !isFiniteNumber(value.minimumConfidence) ||
        value.minimumConfidence < 0 || value.minimumConfidence > 1) {
        fail("MVU_V3_CONDITION_AI_SEMANTIC_INVALID");
      }
      return;
    default:
      fail("MVU_V3_CONDITION_PREDICATE_INVALID");
  }
}

function assertUniqueAiPredicateIds(expression: ConditionExpression): void {
  const seen = new Set<string>();
  for (const id of conditionAiPredicateIds(expression)) {
    if (seen.has(id)) fail("MVU_V3_CONDITION_AI_ID_DUPLICATE");
    seen.add(id);
  }
}

function conditionAiPredicateIds(expression: ConditionExpression): string[] {
  switch (expression.kind) {
    case "predicate": return expression.predicate.kind === "ai_semantic" ? [expression.predicate.id] : [];
    case "not": return conditionAiPredicateIds(expression.child);
    case "and":
    case "or": return expression.children.flatMap(conditionAiPredicateIds);
  }
}

function requireNonNegativeUnknown(value: unknown, code: string): void {
  if (!isFiniteNonNegative(value)) fail(code);
}

function optionalNonNegativeUnknown(value: unknown, code: string): void {
  if (value !== undefined && !isFiniteNonNegative(value)) fail(code);
}

function optionalPositiveUnknown(value: unknown, code: string): void {
  if (value !== undefined && (!isFiniteNumber(value) || value <= 0)) fail(code);
}

function isFiniteNonNegative(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function assertStringArray(value: unknown, code: string): asserts value is string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) fail(code);
}

function assertSenderArray(value: unknown, code: string): void {
  if (!Array.isArray(value) || !value.every((entry) => entry === "user" || entry === "character")) fail(code);
}
