/**
 * Dynamic-state automation rules.
 *
 * This module intentionally has no store, clock, or host dependencies. Callers
 * must provide every fact used by a condition and decide how to commit the
 * returned effects. Missing facts never count as a positive match.
 */
import type {
  AiRuleJudgement,
  AutoRuleCondition,
  DataAutoRule,
  DataLinkRule,
} from "./model";
import type { HourlyMessageBucket } from "./model-v3";

export const MAX_LINK_CHAIN_DEPTH = 8;
export const MAX_PROCESSED_MESSAGE_IDS_V3 = 2_048;
export const MAX_MESSAGE_FACTS_PER_SCOPE_V3 = 50;
const HOUR_IN_MILLISECONDS = 3_600_000;

/** Append one event to sorted hourly counters without consulting capped facts. */
export function appendHourlyMessageBucket(
  buckets: readonly HourlyMessageBucket[],
  occurredAt: number,
): HourlyMessageBucket[] {
  requireFinite(occurredAt, "MVU_V3_HOURLY_BUCKET_TIME_INVALID");
  const startedAt = Math.floor(occurredAt / HOUR_IN_MILLISECONDS) * HOUR_IN_MILLISECONDS;
  const next = buckets.map((bucket) => ({ ...bucket }));
  const existing = next.find((bucket) => bucket.startedAt === startedAt);
  if (existing === undefined) {
    next.push({ startedAt, messageCount: 1 });
    next.sort((left, right) => left.startedAt - right.startedAt);
  } else {
    existing.messageCount += 1;
  }
  return next;
}

/** Build deterministic counters from every supplied fact before any fact cap. */
export function hourlyMessageBucketsFromFacts(
  facts: readonly { occurredAt: number }[],
): HourlyMessageBucket[] {
  let buckets: HourlyMessageBucket[] = [];
  for (const fact of facts) buckets = appendHourlyMessageBucket(buckets, fact.occurredAt);
  return buckets;
}

/** Facts derived by the host from one persisted-message evaluation window. */
export interface AutomationMessageFacts {
  readonly occurredAt: number;
  readonly stateValues: Readonly<Record<string, number>>;
  readonly recentPositiveCount?: number;
  readonly userCareDetected?: boolean;
  readonly lastInteractionAt?: number;
  readonly messageCountInLast24Hours?: number;
  readonly specialDayDetected?: boolean;
  readonly aiRuleJudgements?: Readonly<Record<string, AiRuleJudgement>>;
}

export interface AutoRuleEvaluationInput {
  readonly rules: readonly DataAutoRule[];
  readonly facts: AutomationMessageFacts;
  readonly lastTriggeredAtByRuleId: Readonly<Record<string, number>>;
}

export interface AutoRuleEffectResult {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly ruleOrder: number;
  readonly effectIndex: number;
  readonly fieldId: string;
  readonly delta: number;
  readonly temporaryEffectIds: readonly string[];
  readonly triggerReason: string | null;
  readonly triggerConfidence: number | null;
}

export interface AutoRuleMatchResult {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly ruleOrder: number;
  readonly effects: readonly AutoRuleEffectResult[];
  readonly triggerReason: string | null;
}

export interface RuleCooldownUpdate {
  readonly ruleId: string;
  readonly triggeredAt: number;
}

export interface AutoRuleEvaluationResult {
  readonly matchedRules: readonly AutoRuleMatchResult[];
  readonly effects: readonly AutoRuleEffectResult[];
  readonly cooldownUpdates: readonly RuleCooldownUpdate[];
}

/**
 * Evaluate enabled automatic rules in ascending `order`. Equal-order entries
 * retain their input order so effects are deterministic without mutating rules.
 */
export function evaluateAutoRules(input: AutoRuleEvaluationInput): AutoRuleEvaluationResult {
  requireFinite(input.facts.occurredAt, "MVU_AUTOMATION_OCCURRED_AT_INVALID");
  requireUniqueRuleIds(input.rules.map((rule) => rule.id), "MVU_AUTO_RULE_ID_DUPLICATE");
  for (const rule of input.rules) {
    requireFinite(rule.order, `MVU_AUTO_RULE_ORDER_INVALID:${rule.id}`);
  }

  const orderedRules = input.rules
    .map((rule, inputIndex) => ({ rule, inputIndex }))
    .sort((left, right) => {
      const orderDifference = left.rule.order - right.rule.order;
      return orderDifference === 0 ? left.inputIndex - right.inputIndex : orderDifference;
    });
  const matchedRules: AutoRuleMatchResult[] = [];
  const effects: AutoRuleEffectResult[] = [];
  const cooldownUpdates: RuleCooldownUpdate[] = [];

  for (const { rule } of orderedRules) {
    if (!rule.enabled) continue;
    requireNonNegativeFinite(rule.cooldownMs, `MVU_AUTO_RULE_COOLDOWN_INVALID:${rule.id}`);

    const lastTriggeredAt = input.lastTriggeredAtByRuleId[rule.id];
    if (
      lastTriggeredAt !== undefined &&
      input.facts.occurredAt - lastTriggeredAt < rule.cooldownMs
    ) {
      continue;
    }
    if (!matchesAutoRuleCondition(rule.condition, input.facts, rule.id)) continue;

    const triggerReason = rule.condition.kind === "aiJudgement"
      ? input.facts.aiRuleJudgements?.[rule.id]?.reason ?? null
      : null;
    const triggerConfidence = rule.condition.kind === "aiJudgement"
      ? input.facts.aiRuleJudgements?.[rule.id]?.confidence ?? null
      : null;

    const ruleEffects = rule.effects.map((effect, effectIndex): AutoRuleEffectResult => {
      requireFinite(effect.delta, `MVU_AUTO_RULE_EFFECT_INVALID:${rule.id}:${effectIndex}`);
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        ruleOrder: rule.order,
        effectIndex,
        fieldId: effect.fieldId,
        delta: effect.delta,
        temporaryEffectIds: [...effect.temporaryEffectIds],
        triggerReason,
        triggerConfidence,
      };
    });
    matchedRules.push({
      ruleId: rule.id,
      ruleName: rule.name,
      ruleOrder: rule.order,
      effects: ruleEffects,
      triggerReason,
    });
    effects.push(...ruleEffects);
    cooldownUpdates.push({ ruleId: rule.id, triggeredAt: input.facts.occurredAt });
  }

  return { matchedRules, effects, cooldownUpdates };
}

/** Return false when a condition's required fact is absent or non-finite. */
export function matchesAutoRuleCondition(
  condition: AutoRuleCondition,
  facts: AutomationMessageFacts,
  ruleId?: string
): boolean {
  switch (condition.kind) {
    case "stateThreshold": {
      const value = facts.stateValues[condition.fieldId];
      if (!Number.isFinite(value) || !Number.isFinite(condition.threshold)) return false;
      return compare(value, condition.operator, condition.threshold);
    }
    case "userCare":
      return facts.userCareDetected === true;
    case "recentPositive": {
      const recentPositiveCount = facts.recentPositiveCount;
      return isNonNegativeFinite(recentPositiveCount) &&
        isNonNegativeFinite(condition.count) &&
        recentPositiveCount >= condition.count;
    }
    case "longInactive": {
      const lastInteractionAt = facts.lastInteractionAt;
      return lastInteractionAt !== undefined &&
        Number.isFinite(lastInteractionAt) &&
        isNonNegativeFinite(condition.hours) &&
        facts.occurredAt >= lastInteractionAt &&
        facts.occurredAt - lastInteractionAt >= condition.hours * 3_600_000;
    }
    case "highFreq": {
      const messageCount = facts.messageCountInLast24Hours;
      return isNonNegativeFinite(messageCount) &&
        isNonNegativeFinite(condition.messages) &&
        messageCount >= condition.messages;
    }
    case "specialDay":
      return facts.specialDayDetected === true;
    case "aiJudgement": {
      if (ruleId === undefined) return false;
      const judgement = facts.aiRuleJudgements?.[ruleId];
      return judgement !== undefined && judgement.matched &&
        judgement.confidence >= condition.minimumConfidence;
    }
  }
}

export interface FieldDeltaInput {
  readonly fieldId: string;
  readonly delta: number;
}

export interface LinkRuleEvaluationInput {
  readonly rules: readonly DataLinkRule[];
  readonly stateValues: Readonly<Record<string, number>>;
  /** Pending changes before link rules. Duplicate field IDs are summed. */
  readonly baseDeltas: readonly FieldDeltaInput[];
  /** Source fields allowed to start link propagation for this evaluation. */
  readonly triggerFieldIds: readonly string[];
}

export interface LinkRuleApplication {
  readonly ruleId: string;
  readonly sourceFieldId: string;
  readonly targetFieldId: string;
  readonly depth: number;
  readonly beforeDelta: number;
  readonly afterDelta: number;
  readonly ruleIdChain: readonly string[];
}

export interface LinkedFieldDeltaResult {
  readonly fieldId: string;
  readonly baseDelta: number;
  readonly finalDelta: number;
  readonly triggeredRuleIds: readonly string[];
}

export interface LinkRuleEvaluationResult {
  readonly changes: readonly LinkedFieldDeltaResult[];
  readonly applications: readonly LinkRuleApplication[];
  readonly selfLoopRuleIds: readonly string[];
  readonly cycleRuleIds: readonly string[];
  readonly depthLimitedRuleIds: readonly string[];
}

interface LinkQueueEntry {
  readonly sourceFieldId: string;
  readonly fieldPath: readonly string[];
  readonly ruleIdChain: readonly string[];
}

/**
 * Apply link rules to existing pending field changes.
 *
 * A delta effect adds to the target's current pending delta and may create a
 * target change from zero. A multiplier only scales an already pending target
 * delta. Enabled rules preserve input order. Each rule applies at most once,
 * direct/indirect cycles are rejected, and a propagation path is capped at
 * eight rule applications.
 */
export function evaluateLinkRules(input: LinkRuleEvaluationInput): LinkRuleEvaluationResult {
  requireUniqueRuleIds(input.rules.map((rule) => rule.id), "MVU_LINK_RULE_ID_DUPLICATE");

  const fieldOrder: string[] = [];
  const baseDeltaByField = new Map<string, number>();
  for (const change of input.baseDeltas) {
    requireFinite(change.delta, `MVU_LINK_BASE_DELTA_INVALID:${change.fieldId}`);
    const existing = baseDeltaByField.get(change.fieldId);
    if (existing === undefined) {
      fieldOrder.push(change.fieldId);
      baseDeltaByField.set(change.fieldId, change.delta);
    } else {
      const combinedDelta = existing + change.delta;
      requireFinite(combinedDelta, `MVU_LINK_BASE_DELTA_SUM_INVALID:${change.fieldId}`);
      baseDeltaByField.set(change.fieldId, combinedDelta);
    }
  }

  const finalDeltaByField = new Map(baseDeltaByField);
  const triggeredRuleIdsByField = new Map<string, string[]>();
  const enabledRules = input.rules.filter((rule) => rule.enabled);
  const selfLoopRuleIds = enabledRules
    .filter((rule) => rule.sourceFieldId === rule.targetFieldId)
    .map((rule) => rule.id);
  const selfLoopRuleIdSet = new Set(selfLoopRuleIds);
  const appliedRuleIds = new Set<string>();
  const cycleRuleIds: string[] = [];
  const cycleRuleIdSet = new Set<string>();
  const depthLimitedRuleIds: string[] = [];
  const depthLimitedRuleIdSet = new Set<string>();
  const applications: LinkRuleApplication[] = [];
  const queue: LinkQueueEntry[] = [];
  const queuedRoots = new Set<string>();

  for (const fieldId of input.triggerFieldIds) {
    if (queuedRoots.has(fieldId)) continue;
    queuedRoots.add(fieldId);
    queue.push({ sourceFieldId: fieldId, fieldPath: [fieldId], ruleIdChain: [] });
  }

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const entry = queue[queueIndex];
    for (const rule of enabledRules) {
      if (selfLoopRuleIdSet.has(rule.id)) continue;
      if (appliedRuleIds.has(rule.id)) continue;
      if (rule.sourceFieldId !== entry.sourceFieldId) continue;

      let targetDelta = finalDeltaByField.get(rule.targetFieldId);
      if (targetDelta === undefined) {
        if (rule.effect.kind === "multiplier") continue;
        targetDelta = 0;
        fieldOrder.push(rule.targetFieldId);
        baseDeltaByField.set(rule.targetFieldId, 0);
        finalDeltaByField.set(rule.targetFieldId, 0);
      }
      const sourceState = input.stateValues[rule.sourceFieldId];
      if (!Number.isFinite(sourceState) || !Number.isFinite(rule.sourceThreshold)) continue;
      const sourceDelta = finalDeltaByField.get(rule.sourceFieldId);
      const projectedSourceState = sourceDelta === undefined ? sourceState : sourceState + sourceDelta;
      if (!compare(projectedSourceState, rule.operator, rule.sourceThreshold)) continue;

      const nextDepth = entry.ruleIdChain.length + 1;
      if (nextDepth > MAX_LINK_CHAIN_DEPTH) {
        pushUnique(depthLimitedRuleIds, depthLimitedRuleIdSet, rule.id);
        continue;
      }
      if (entry.fieldPath.includes(rule.targetFieldId)) {
        pushUnique(cycleRuleIds, cycleRuleIdSet, rule.id);
        continue;
      }

      requireFinite(rule.effect.value, `MVU_LINK_EFFECT_INVALID:${rule.id}`);
      const afterDelta = rule.effect.kind === "delta"
        ? targetDelta + rule.effect.value
        : targetDelta * rule.effect.value;
      requireFinite(afterDelta, `MVU_LINK_RESULT_INVALID:${rule.id}`);
      const ruleIdChain = [...entry.ruleIdChain, rule.id];

      appliedRuleIds.add(rule.id);
      finalDeltaByField.set(rule.targetFieldId, afterDelta);
      const targetRuleIds = triggeredRuleIdsByField.get(rule.targetFieldId);
      if (targetRuleIds === undefined) {
        triggeredRuleIdsByField.set(rule.targetFieldId, [rule.id]);
      } else {
        targetRuleIds.push(rule.id);
      }
      applications.push({
        ruleId: rule.id,
        sourceFieldId: rule.sourceFieldId,
        targetFieldId: rule.targetFieldId,
        depth: nextDepth,
        beforeDelta: targetDelta,
        afterDelta,
        ruleIdChain,
      });

      if (afterDelta !== targetDelta) {
        queue.push({
          sourceFieldId: rule.targetFieldId,
          fieldPath: [...entry.fieldPath, rule.targetFieldId],
          ruleIdChain,
        });
      }
    }
  }

  const changes = fieldOrder.map((fieldId): LinkedFieldDeltaResult => {
    const baseDelta = baseDeltaByField.get(fieldId);
    const finalDelta = finalDeltaByField.get(fieldId);
    if (baseDelta === undefined || finalDelta === undefined) {
      throw new Error(`MVU_LINK_DELTA_MISSING:${fieldId}`);
    }
    const triggeredRuleIds = triggeredRuleIdsByField.get(fieldId);
    return {
      fieldId,
      baseDelta,
      finalDelta,
      triggeredRuleIds: triggeredRuleIds === undefined ? [] : [...triggeredRuleIds],
    };
  });

  return {
    changes,
    applications,
    selfLoopRuleIds,
    cycleRuleIds,
    depthLimitedRuleIds,
  };
}

function compare(
  actual: number,
  operator: DataLinkRule["operator"] | Extract<AutoRuleCondition, { kind: "stateThreshold" }>["operator"],
  expected: number
): boolean {
  switch (operator) {
    case ">=":
      return actual >= expected;
    case ">":
      return actual > expected;
    case "<=":
      return actual <= expected;
    case "<":
      return actual < expected;
    case "==":
      return actual === expected;
  }
}

function isNonNegativeFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

function requireFinite(value: number, errorCode: string): void {
  if (!Number.isFinite(value)) throw new Error(errorCode);
}

function requireNonNegativeFinite(value: number, errorCode: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(errorCode);
}

function requireUniqueRuleIds(ids: readonly string[], errorCode: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`${errorCode}:${id}`);
    seen.add(id);
  }
}

function pushUnique(target: string[], seen: Set<string>, value: string): void {
  if (seen.has(value)) return;
  seen.add(value);
  target.push(value);
}
