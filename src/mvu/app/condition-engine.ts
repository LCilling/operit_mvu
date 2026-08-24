import type {
  AiSemanticPredicate,
  ConditionDefinition,
  ConditionExpression,
  ConditionPredicate,
  HourlyMessageBucket,
} from "./model-v3";
import type { MessageFact } from "./model";
import { buildDefaultConditionLibrary } from "./seed";
import { validateConditionDefinition, validateConditionExpression } from "./validation";

const HOUR_IN_MILLISECONDS = 3_600_000;

export interface AiSemanticResult {
  matched: boolean;
  confidence: number;
}

export interface ConditionEvaluationContext {
  actorId: string | null;
  groupId: string | null;
  chatId: string | null;
  now: string | number;
  fieldValues: Readonly<Record<string, number>>;
  messageFacts: readonly MessageFact[];
  hourlyMessageBuckets: readonly HourlyMessageBucket[];
  aiSemanticResults?: Readonly<Record<string, AiSemanticResult | undefined>>;
}

export interface ConditionEvaluation {
  matched: boolean;
  pendingAiPredicateIds: string[];
  diagnostics: string[];
}

type EvaluationState = "matched" | "unmatched" | "pending";

interface RecursiveEvaluation {
  state: EvaluationState;
  pendingAiPredicateIds: string[];
}

/**
 * Evaluates every deterministic branch synchronously. A pending AI predicate is
 * treated as a possible match, allowing callers to collect only predicates that
 * survive actor, group, field, and message-fact prefilters.
 */
export function evaluateCondition(
  condition: ConditionExpression | ConditionDefinition,
  context: ConditionEvaluationContext,
): ConditionEvaluation {
  const expression = conditionExpression(condition);
  if (isConditionDefinition(condition) && !condition.enabled) {
    return { matched: false, pendingAiPredicateIds: [], diagnostics: [] };
  }
  try {
    if (isConditionDefinition(condition)) validateConditionDefinition(condition);
    else validateConditionExpression(expression);
    const now = timestamp(context.now);
    if (now === null) return invalidEvaluation("MVU_V3_CONDITION_CONTEXT_NOW_INVALID");
    const result = evaluateExpression(expression, context, now);
    return {
      matched: result.state !== "unmatched",
      pendingAiPredicateIds: result.state === "unmatched" ? [] : unique(result.pendingAiPredicateIds),
      diagnostics: [],
    };
  } catch (error) {
    return invalidEvaluation(error instanceof Error ? error.message : "MVU_V3_CONDITION_INVALID");
  }
}

/** Returns all semantic predicates in a valid expression, in first-use order. */
export function collectAiPredicates(condition: ConditionExpression | ConditionDefinition): AiSemanticPredicate[] {
  if (isConditionDefinition(condition)) {
    if (!condition.enabled) return [];
    validateConditionDefinition(condition);
  } else {
    validateConditionExpression(condition);
  }
  const collected: AiSemanticPredicate[] = [];
  collect(conditionExpression(condition), collected);
  return collected;
}

export { buildDefaultConditionLibrary };

function evaluateExpression(
  expression: ConditionExpression,
  context: ConditionEvaluationContext,
  now: number,
): RecursiveEvaluation {
  switch (expression.kind) {
    case "predicate": return evaluatePredicate(expression.predicate, context, now);
    case "not": {
      const child = evaluateExpression(expression.child, context, now);
      if (child.state === "pending") return child;
      return { state: child.state === "matched" ? "unmatched" : "matched", pendingAiPredicateIds: [] };
    }
    case "and": {
      const pending: string[] = [];
      for (const child of expression.children) {
        const result = evaluateExpression(child, context, now);
        if (result.state === "unmatched") return { state: "unmatched", pendingAiPredicateIds: [] };
        pending.push(...result.pendingAiPredicateIds);
      }
      return pending.length > 0
        ? { state: "pending", pendingAiPredicateIds: pending }
        : { state: "matched", pendingAiPredicateIds: [] };
    }
    case "or": {
      const pending: string[] = [];
      for (const child of expression.children) {
        const result = evaluateExpression(child, context, now);
        if (result.state === "matched") return { state: "matched", pendingAiPredicateIds: [] };
        pending.push(...result.pendingAiPredicateIds);
      }
      return pending.length > 0
        ? { state: "pending", pendingAiPredicateIds: pending }
        : { state: "unmatched", pendingAiPredicateIds: [] };
    }
  }
}

function evaluatePredicate(
  predicate: ConditionPredicate,
  context: ConditionEvaluationContext,
  now: number,
): RecursiveEvaluation {
  const matches = (matched: boolean): RecursiveEvaluation => ({
    state: matched ? "matched" : "unmatched",
    pendingAiPredicateIds: [],
  });
  switch (predicate.kind) {
    case "recent_positive":
      return matches(context.messageFacts.some((fact) => (fact.recentPositiveCount ?? -Infinity) >= predicate.count));
    case "long_inactive": {
      const interactionAt = latestInteraction(context.messageFacts);
      return matches(interactionAt !== null && now - interactionAt >= predicate.hours * HOUR_IN_MILLISECONDS);
    }
    case "user_care": return matches(context.messageFacts.some((fact) => fact.userCareDetected === true));
    case "special_day": return matches(context.messageFacts.some((fact) => fact.specialDayDetected === true));
    case "high_frequency": return matches(matchesHighFrequency(predicate, context.hourlyMessageBuckets, now));
    case "field_comparison": return matches(compare(context.fieldValues[predicate.fieldId], predicate.operator, predicate.value));
    case "message_count": return matches(factsWithin(context.messageFacts, now, predicate.windowHours)
      .filter((fact) => predicate.sender === undefined || fact.role === predicate.sender).length >= predicate.count);
    case "keywords": return matches(matchesKeywords(predicate, context.messageFacts, now));
    case "sender": {
      const fact = latestFact(context.messageFacts);
      return matches(fact !== undefined && predicate.senders.includes(fact.role));
    }
    case "actor": return matches(context.actorId !== null && predicate.actorIds.includes(context.actorId));
    case "group": return matches(context.groupId !== null && predicate.groupIds.includes(context.groupId));
    case "concrete_date": return matches(predicate.dates.includes(utcDate(now)));
    case "repeating_date": {
      const date = new Date(now);
      return matches(date.getUTCMonth() + 1 === predicate.month && date.getUTCDate() === predicate.day);
    }
    case "ai_semantic": {
      const result = context.aiSemanticResults?.[predicate.id];
      if (result === undefined) return { state: "pending", pendingAiPredicateIds: [predicate.id] };
      return matches(result.matched && Number.isFinite(result.confidence) && result.confidence >= predicate.minimumConfidence);
    }
  }
}

function matchesHighFrequency(
  predicate: Extract<ConditionPredicate, { kind: "high_frequency" }>,
  hourlyBuckets: readonly HourlyMessageBucket[],
  now: number,
): boolean {
  const windowHours = predicate.windowHours ?? 24;
  const bucketHours = predicate.bucketHours ?? 1;
  const bucketMilliseconds = bucketHours * HOUR_IN_MILLISECONDS;
  const cutoff = now - windowHours * HOUR_IN_MILLISECONDS;
  const counts = new Map<number, number>();
  for (const bucket of hourlyBuckets) {
    if (!Number.isFinite(bucket.startedAt) || !Number.isFinite(bucket.messageCount) || bucket.messageCount < 0 ||
      bucket.startedAt > now || bucket.startedAt + HOUR_IN_MILLISECONDS <= cutoff) continue;
    const index = Math.floor((now - bucket.startedAt) / bucketMilliseconds);
    counts.set(index, (counts.get(index) ?? 0) + bucket.messageCount);
  }
  return [...counts.values()].some((count) => count >= predicate.messages);
}

function matchesKeywords(
  predicate: Extract<ConditionPredicate, { kind: "keywords" }>,
  facts: readonly MessageFact[],
  now: number,
): boolean {
  const source = factsWithin(facts, now, predicate.windowHours ?? 24).map((fact) =>
    predicate.caseSensitive ? fact.content : fact.content.toLocaleLowerCase()
  );
  const normalize = (entry: string): string => predicate.caseSensitive ? entry : entry.toLocaleLowerCase();
  return (predicate.includeAny.length === 0 || predicate.includeAny.some((entry) =>
    source.some((content) => content.includes(normalize(entry)))
  )) && predicate.includeAll.every((entry) => source.some((content) => content.includes(normalize(entry)))) &&
    predicate.exclude.every((entry) => source.every((content) => !content.includes(normalize(entry))));
}

function factsWithin(facts: readonly MessageFact[], now: number, windowHours: number): MessageFact[] {
  const cutoff = now - windowHours * HOUR_IN_MILLISECONDS;
  return facts.filter((fact) => Number.isFinite(fact.occurredAt) && fact.occurredAt >= cutoff && fact.occurredAt <= now);
}

function latestInteraction(facts: readonly MessageFact[]): number | null {
  const values = facts.map((fact) => fact.lastInteractionAt).filter((value): value is number =>
    typeof value === "number" && Number.isFinite(value)
  );
  return values.length === 0 ? null : Math.max(...values);
}

function latestFact(facts: readonly MessageFact[]): MessageFact | undefined {
  return facts.reduce<MessageFact | undefined>((latest, fact) =>
    latest === undefined || fact.occurredAt > latest.occurredAt ? fact : latest, undefined
  );
}

function compare(value: number | undefined, operator: Extract<ConditionPredicate, { kind: "field_comparison" }>["operator"], expected: number): boolean {
  if (value === undefined || !Number.isFinite(value)) return false;
  switch (operator) {
    case ">=": return value >= expected;
    case "<=": return value <= expected;
    case ">": return value > expected;
    case "<": return value < expected;
    case "==": return value === expected;
  }
}

function collect(expression: ConditionExpression, output: AiSemanticPredicate[]): void {
  switch (expression.kind) {
    case "predicate":
      if (expression.predicate.kind === "ai_semantic") {
        const { triggerType, requirement, minimumConfidence } = expression.predicate;
        output.push({ id: expression.predicate.id, triggerType, requirement, minimumConfidence });
      }
      return;
    case "not":
      collect(expression.child, output);
      return;
    case "and":
    case "or":
      for (const child of expression.children) collect(child, output);
      return;
  }
}

function conditionExpression(condition: ConditionExpression | ConditionDefinition): ConditionExpression {
  return isConditionDefinition(condition) ? condition.expression : condition;
}

function isConditionDefinition(condition: ConditionExpression | ConditionDefinition): condition is ConditionDefinition {
  return "expression" in condition;
}

function timestamp(value: string | number): number | null {
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function utcDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function invalidEvaluation(diagnostic: string): ConditionEvaluation {
  return { matched: false, pendingAiPredicateIds: [], diagnostics: [diagnostic] };
}
