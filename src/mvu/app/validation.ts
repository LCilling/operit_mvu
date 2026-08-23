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

export function validateAutoRule(rule: DataAutoRule, fields: readonly DataField[]): void {
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
  }
}

export function validateTemporaryEffect(
  effect: DataTemporaryEffect,
  fields: readonly DataField[]
): void {
  requireStableId(effect.id, `MVU_EFFECT_ID_INVALID:${effect.id}`);
  const field = fields.find((candidate) => candidate.id === effect.targetFieldId);
  if (field === undefined) fail(`MVU_EFFECT_FIELD_NOT_FOUND:${effect.id}`);
  if (field.scope !== effect.scope) fail(`MVU_EFFECT_SCOPE_MISMATCH:${effect.id}`);
  const validScopeKey = effect.scope === "global"
    ? effect.scopeKey === "global"
    : effect.scopeKey.startsWith(`${effect.scope}:`) && effect.scopeKey.length > effect.scope.length + 1;
  if (!validScopeKey) fail(`MVU_EFFECT_SCOPE_KEY_INVALID:${effect.id}`);
  if (effect.scope !== "global") {
    const bindingId = effect.scopeKey.slice(effect.scope.length + 1);
    if (!field.bindingIds.includes(bindingId)) fail(`MVU_EFFECT_SCOPE_NOT_BOUND:${effect.id}`);
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
  if (effect.reason.trim().length === 0) fail(`MVU_EFFECT_REASON_EMPTY:${effect.id}`);
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
  for (const rule of configuration.autoRules) validateAutoRule(rule, configuration.fields);
  requireUnique(configuration.temporaryEffects.map((effect) => effect.id), "MVU_EFFECT_ID_DUPLICATE");
  for (const effect of configuration.temporaryEffects) {
    validateTemporaryEffect(effect, configuration.fields);
  }
  if (typeof configuration.settings.aiEnabled !== "boolean") fail("MVU_SETTINGS_AI_ENABLED_INVALID");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  if (kind !== "recentPositive" && kind !== "longInactive" && kind !== "userCare" &&
    kind !== "specialDay" && kind !== "highFreq" && kind !== "stateThreshold") fail("INVALID_MVU_AUTO_CONDITION");
  for (const effect of value.effects) {
    if (!isRecord(effect) || typeof effect.fieldId !== "string" || !isFiniteNumber(effect.delta)) {
      fail("INVALID_MVU_AUTO_EFFECT");
    }
  }
}

function assertSettingsShape(value: unknown): asserts value is MvuSettings {
  if (!isRecord(value) || typeof value.aiEnabled !== "boolean") fail("INVALID_MVU_SETTINGS");
}

function assertTemporaryEffectShape(value: unknown): asserts value is DataTemporaryEffect {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.targetFieldId !== "string" ||
    (value.scope !== "character" && value.scope !== "group" && value.scope !== "global" && value.scope !== "chat") ||
    typeof value.scopeKey !== "string" ||
    (value.mode !== "multiplier" && value.mode !== "additive") || !isFiniteNumber(value.value) ||
    typeof value.enabled !== "boolean" || !(value.expiresAt === null || isFiniteNumber(value.expiresAt)) ||
    !(value.remainingTurns === null || isFiniteNumber(value.remainingTurns)) ||
    typeof value.reason !== "string" ||
    (value.source !== "manual" && value.source !== "rule" && value.source !== "ai") ||
    !isFiniteNumber(value.createdAt)) fail("INVALID_MVU_TEMPORARY_EFFECT");
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
