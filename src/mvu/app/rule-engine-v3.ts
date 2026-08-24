import {
  collectAiPredicates,
  evaluateCondition,
  type AiSemanticResult,
  type ConditionEvaluationContext,
} from "./condition-engine";
import type {
  AiSemanticPredicate,
  ConditionDefinition,
  RuleActionV3,
  RuleDefinitionV3,
} from "./model-v3";

export interface RuleDiagnostic {
  code:
    | "MVU_RULE_TRIGGER_ACTOR_MISSING"
    | "MVU_RULE_CONDITION_NOT_FOUND"
    | "MVU_RULE_CONDITION_INVALID"
    | "MVU_RULE_AI_BATCH_FAILED"
    | "MVU_RULE_ACTION_TARGET_EMPTY"
    | "MVU_RULE_EFFECT_GROUP_NOT_FOUND"
    | "MVU_RULE_FIELD_NOT_FOUND";
  ruleId?: string;
  conditionId?: string;
  actionIndex?: number;
  detail?: string;
}

export interface PlanRuleEvaluationInput {
  rules: readonly RuleDefinitionV3[];
  conditions: readonly ConditionDefinition[];
  context: ConditionEvaluationContext;
  /** Selected actor in the current UI/runtime context, distinct from the event actor. */
  currentActorId: string | null;
  lastTriggeredAtByRuleId: Readonly<Record<string, number>>;
}

export interface RuleEvaluationCandidate {
  rule: RuleDefinitionV3;
  condition: ConditionDefinition;
  pendingAiPredicateIds: string[];
}

export interface RuleEvaluationPlan {
  context: ConditionEvaluationContext;
  candidates: RuleEvaluationCandidate[];
  aiPredicates: AiSemanticPredicate[];
  diagnostics: RuleDiagnostic[];
}

export interface ExecutedRuleAction {
  ruleId: string;
  ruleName: string;
  actionIndex: number;
  action: RuleActionV3;
}

export interface RuleExecutionResult {
  actions: ExecutedRuleAction[];
  matchedRuleIds: string[];
  cooldownUpdates: Array<{ ruleId: string; triggeredAt: number }>;
  diagnostics: RuleDiagnostic[];
}

export interface ExecuteRulePlanInput {
  plan: RuleEvaluationPlan;
  aiSemanticResults?: Readonly<Record<string, AiSemanticResult | undefined>>;
}

/**
 * Phase one: actor/cooldown filters and deterministic branches run before any
 * semantic predicate is exposed to a caller for batching.
 */
export function planRuleEvaluation(input: PlanRuleEvaluationInput): RuleEvaluationPlan {
  const now = timestamp(input.context.now);
  if (now === null) throw new Error("MVU_RULE_CONTEXT_NOW_INVALID");
  const conditions = new Map(input.conditions.map((condition) => [condition.id, condition]));
  const diagnostics: RuleDiagnostic[] = [];
  const candidates: RuleEvaluationCandidate[] = [];
  const predicatesById = new Map<string, AiSemanticPredicate>();
  const orderedRules = input.rules
    .map((rule, inputIndex) => ({ rule, inputIndex }))
    .sort((left, right) => left.rule.executionOrder - right.rule.executionOrder || left.inputIndex - right.inputIndex);

  for (const { rule } of orderedRules) {
    if (!rule.enabled) continue;
    if (input.context.actorId === null) {
      diagnostics.push({ code: "MVU_RULE_TRIGGER_ACTOR_MISSING", ruleId: rule.id });
      continue;
    }
    if (!actorMatches(rule, input.context.actorId, input.currentActorId, input.context.groupId)) continue;
    if (!Number.isFinite(rule.cooldownHours) || rule.cooldownHours < 0) {
      diagnostics.push({ code: "MVU_RULE_CONDITION_INVALID", ruleId: rule.id, detail: "MVU_RULE_COOLDOWN_INVALID" });
      continue;
    }
    const lastTriggeredAt = input.lastTriggeredAtByRuleId[rule.id];
    if (lastTriggeredAt !== undefined && now - lastTriggeredAt < rule.cooldownHours * 3_600_000) continue;

    const condition = conditions.get(rule.conditionId);
    if (condition === undefined) {
      diagnostics.push({ code: "MVU_RULE_CONDITION_NOT_FOUND", ruleId: rule.id, conditionId: rule.conditionId });
      continue;
    }
    const evaluation = evaluateCondition(condition, input.context);
    if (evaluation.diagnostics.length > 0) {
      diagnostics.push({
        code: "MVU_RULE_CONDITION_INVALID",
        ruleId: rule.id,
        conditionId: condition.id,
        detail: evaluation.diagnostics.join(","),
      });
      continue;
    }
    if (!evaluation.matched) continue;

    const pendingIds = new Set(evaluation.pendingAiPredicateIds);
    for (const predicate of collectAiPredicates(condition)) {
      if (pendingIds.has(predicate.id) && !predicatesById.has(predicate.id)) {
        predicatesById.set(predicate.id, predicate);
      }
    }
    candidates.push({ rule, condition, pendingAiPredicateIds: [...pendingIds] });
  }

  return {
    context: input.context,
    candidates,
    aiPredicates: [...predicatesById.values()],
    diagnostics,
  };
}

/** Phase two: merge predicate-ID answers, rerun truth, then emit ordered actions. */
export function executeRulePlan(input: ExecuteRulePlanInput): RuleExecutionResult {
  const now = timestamp(input.plan.context.now);
  if (now === null) throw new Error("MVU_RULE_CONTEXT_NOW_INVALID");
  const resolvedAiResults: Record<string, AiSemanticResult> = {};
  for (const predicate of input.plan.aiPredicates) {
    resolvedAiResults[predicate.id] = input.aiSemanticResults?.[predicate.id] ?? {
      matched: false,
      confidence: 0,
    };
  }
  const actions: ExecutedRuleAction[] = [];
  const matchedRuleIds: string[] = [];
  const cooldownUpdates: Array<{ ruleId: string; triggeredAt: number }> = [];

  for (const candidate of input.plan.candidates) {
    const evaluation = evaluateCondition(candidate.condition, {
      ...input.plan.context,
      aiSemanticResults: resolvedAiResults,
    });
    if (!evaluation.matched || evaluation.pendingAiPredicateIds.length > 0 || evaluation.diagnostics.length > 0) continue;
    matchedRuleIds.push(candidate.rule.id);
    cooldownUpdates.push({ ruleId: candidate.rule.id, triggeredAt: now });
    candidate.rule.actions.forEach((action, actionIndex) => {
      actions.push({
        ruleId: candidate.rule.id,
        ruleName: candidate.rule.name,
        actionIndex,
        action: cloneAction(action),
      });
    });
  }

  return {
    actions,
    matchedRuleIds,
    cooldownUpdates,
    diagnostics: [...input.plan.diagnostics],
  };
}

function actorMatches(
  rule: RuleDefinitionV3,
  eventActorId: string,
  currentActorId: string | null,
  groupId: string | null,
): boolean {
  const selector = rule.triggerActorSelector;
  switch (selector.kind) {
    case "any": return true;
    case "current_actor": return currentActorId !== null && eventActorId === currentActorId;
    case "selected": return selector.actorIds.includes(eventActorId);
    case "group": return groupId !== null && selector.groupIds.includes(groupId);
  }
}

function cloneAction(action: RuleActionV3): RuleActionV3 {
  if (action.kind === "activate_effect_group") {
    return { kind: "activate_effect_group", effectGroupId: action.effectGroupId };
  }
  return {
    kind: "change_field",
    fieldId: action.fieldId,
    target: cloneTargetSelector(action.target),
    delta: action.delta,
    effectGroupIds: [...action.effectGroupIds],
  };
}

function cloneTargetSelector(
  target: Extract<RuleActionV3, { kind: "change_field" }>["target"],
): Extract<RuleActionV3, { kind: "change_field" }>["target"] {
  if (target.kind === "selected") return { kind: "selected", actorIds: [...target.actorIds] };
  if (target.kind === "trigger_actor") return { kind: "trigger_actor" };
  return { kind: "all_bound" };
}

function timestamp(value: string | number): number | null {
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
