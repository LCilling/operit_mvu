/** Deterministic model projection for an explicit host scope context. */
import type { DataChangeRecord, DataField, MvuDataset, StateScopeContext } from "./model";
import type {
  ConditionExpression,
  EffectGroupDefinition,
  MvuDatasetV3,
  RuleDefinitionV3,
} from "./model-v3";
import {
  deriveStage,
  fieldAppliesToContext,
  stateValueForField,
} from "./scope";

export const MODEL_FIELD_LIMIT = 40;
const MODEL_DIAGNOSTIC_LIMIT = 32;

export interface ModelFieldBudgetStats {
  used: number;
  total: number;
  limit: number;
  referencedIncluded: number;
  referencedTotal: number;
  overflow: boolean;
  diagnostics: string[];
}

export interface ModelFieldSelection {
  fields: DataField[];
  stats: ModelFieldBudgetStats;
}

export interface SelectModelFieldsOptions {
  /** A lower caller budget is allowed, but the product hard limit is always 40. */
  maxFields?: number;
  /** Bounded callers can provide their most recent committed record window. */
  recentChanges?: readonly Pick<DataChangeRecord, "fieldId" | "occurredAt">[];
  /** Group prompts rank one shared field definition across every visible member context. */
  additionalContexts?: readonly StateScopeContext[];
}

type ModelFieldDataset = MvuDataset | MvuDatasetV3;

/**
 * Deterministically selects the model-visible field definitions. Referenced fields
 * win over visibility and recency. If references alone exceed the hard limit, the
 * same ranking (visibility, recency, order, id) chooses the first 40 and emits an
 * explicit overflow diagnostic; model input never exceeds the hard limit.
 */
export function selectModelFields(
  dataset: ModelFieldDataset,
  context: StateScopeContext,
  options: SelectModelFieldsOptions = {},
): ModelFieldSelection {
  const requestedLimit = options.maxFields ?? MODEL_FIELD_LIMIT;
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    throw new Error("MVU_MODEL_FIELD_LIMIT_INVALID");
  }
  const limit = Math.min(requestedLimit, MODEL_FIELD_LIMIT);
  const contexts = uniqueScopeContexts([context, ...(options.additionalContexts ?? [])]);
  const diagnostics: string[] = [];
  const referencedIds = collectReferencedFieldIds(dataset, contexts, diagnostics);
  const latestChanges = collectLatestChanges(dataset, options.recentChanges);
  const eligible = dataset.fields.filter((field) => {
    if (!field.enabled || !contexts.some((candidate) => fieldAppliesToContext(field, candidate))) {
      return false;
    }
    return field.modelVisibility !== "hidden" || referencedIds.has(field.id);
  });
  const eligibleIds = new Set(eligible.map((field) => field.id));
  const referencedTotal = [...referencedIds].filter((id) => eligibleIds.has(id)).length;
  const ranked = [...eligible].sort((left, right) =>
    compareModelFields(left, right, referencedIds, latestChanges));
  const fields = ranked.slice(0, limit);
  const selectedIds = new Set(fields.map((field) => field.id));
  const referencedIncluded = [...referencedIds].filter((id) => selectedIds.has(id)).length;
  if (referencedTotal > limit) {
    diagnostics.push(`MVU_MODEL_REFERENCED_FIELDS_OVERFLOW:${referencedTotal}:${limit}`);
  }
  return {
    fields,
    stats: {
      used: fields.length,
      total: eligible.length,
      limit,
      referencedIncluded,
      referencedTotal,
      overflow: eligible.length > limit,
      diagnostics: boundedDiagnostics(diagnostics),
    },
  };
}

export function buildStateSectionBlock(
  dataset: MvuDataset,
  context: StateScopeContext,
  fields: readonly DataField[]
): string {
  const actorLabel = context.actorName.length > 0 ? context.actorName : "当前上下文";
  const lines: string[] = [
    `<WorldState actorId="${escapeXml(context.actorId ?? "")}" actor="${escapeXml(actorLabel)}">`,
    `[动态状态 · ${sanitizeLine(actorLabel)}]`,
  ];
  const permittedIds = new Set(fields.map((field) => field.id));
  const selected = selectModelFields(dataset, context).fields.filter((field) => permittedIds.has(field.id));
  appendFieldLines(lines, dataset, context, selected);
  lines.push("</WorldState>");
  return lines.join("\n");
}

/**
 * Group-aware projection. Character-scoped fields are rendered once for each
 * explicit member identity; group/chat/global fields are rendered once from
 * the active context, so a group prompt cannot duplicate shared state.
 */
export function buildScopedStateSectionBlock(
  dataset: MvuDataset,
  context: StateScopeContext,
  memberContexts: readonly StateScopeContext[] = []
): string {
  const lines: string[] = [
    `<WorldState chatId="${escapeXml(context.chatId ?? "")}" groupId="${escapeXml(context.groupId ?? "")}">`,
  ];
  const selectedFields = selectModelFields(dataset, context, {
    additionalContexts: memberContexts,
  }).fields;
  const sharedFields = selectedFields.filter((field) =>
    field.scope !== "character" && fieldAppliesToContext(field, context));
  if (sharedFields.length > 0) {
    lines.push("[共享动态状态]");
    appendFieldLines(lines, dataset, context, sharedFields);
  }

  const uniqueMembers = new Map<string, StateScopeContext>();
  if (context.actorId !== null) uniqueMembers.set(context.actorId, context);
  for (const member of memberContexts) {
    if (member.actorId !== null && !uniqueMembers.has(member.actorId)) {
      uniqueMembers.set(member.actorId, member);
    }
  }
  for (const member of uniqueMembers.values()) {
    const characterFields = selectedFields.filter((field) =>
      field.scope === "character" && fieldAppliesToContext(field, member));
    if (characterFields.length === 0) continue;
    const actorLabel = member.actorName.length > 0 ? member.actorName : member.actorId ?? "";
    lines.push(
      `<ActorState actorId="${escapeXml(member.actorId ?? "")}" actor="${escapeXml(actorLabel)}">`,
      `[角色动态状态 · ${sanitizeLine(actorLabel)}]`
    );
    appendFieldLines(lines, dataset, member, characterFields);
    lines.push("</ActorState>");
  }
  if (lines.length === 1) return "";
  lines.push("</WorldState>");
  return lines.join("\n");
}

export function visibleFieldsForContext(
  dataset: MvuDataset,
  context: StateScopeContext
): DataField[] {
  return selectModelFields(dataset, context).fields;
}

function appendFieldLines(
  lines: string[],
  dataset: MvuDataset,
  context: StateScopeContext,
  fields: readonly DataField[]
): void {
  for (const field of fields) {
    if (!fieldAppliesToContext(field, context)) continue;
    const value = stateValueForField(dataset, field, context);
    const stage = deriveStage(field, value);
    if (field.modelVisibility === "stage_only") {
      lines.push(`- ${sanitizeLine(field.name)}: 阶段「${sanitizeLine(stage.name)}」`);
      if (stage.description.length > 0) lines.push(`  ${sanitizeLine(stage.description)}`);
      continue;
    }
    lines.push(`- ${sanitizeLine(field.name)}: ${value}（阶段：${sanitizeLine(stage.name)}）`);
    if (field.description.length > 0) lines.push(`  ${sanitizeLine(field.description)}`);
    if (stage.description.length > 0) lines.push(`  阶段说明：${sanitizeLine(stage.description)}`);
  }
}

function compareModelFields(
  left: DataField,
  right: DataField,
  referencedIds: ReadonlySet<string>,
  latestChanges: ReadonlyMap<string, number>,
): number {
  const referenced = Number(referencedIds.has(right.id)) - Number(referencedIds.has(left.id));
  if (referenced !== 0) return referenced;
  const visibility = visibilityRank(right.modelVisibility) - visibilityRank(left.modelVisibility);
  if (visibility !== 0) return visibility;
  const leftRecent = latestChanges.get(left.id) ?? Number.NEGATIVE_INFINITY;
  const rightRecent = latestChanges.get(right.id) ?? Number.NEGATIVE_INFINITY;
  if (leftRecent !== rightRecent) return rightRecent > leftRecent ? 1 : -1;
  if (left.order !== right.order) return left.order - right.order;
  return compareStableText(left.id, right.id);
}

function visibilityRank(visibility: DataField["modelVisibility"]): number {
  if (visibility === "full") return 2;
  if (visibility === "stage_only") return 1;
  return 0;
}

function collectLatestChanges(
  dataset: ModelFieldDataset,
  explicit: readonly Pick<DataChangeRecord, "fieldId" | "occurredAt">[] | undefined,
): Map<string, number> {
  const latest = new Map<string, number>();
  const records = explicit ?? (dataset.formatVersion === 2 ? dataset.records : []);
  for (const record of records) {
    if (!Number.isFinite(record.occurredAt)) continue;
    const previous = latest.get(record.fieldId);
    if (previous === undefined || record.occurredAt > previous) {
      latest.set(record.fieldId, record.occurredAt);
    }
  }
  return latest;
}

function collectReferencedFieldIds(
  dataset: ModelFieldDataset,
  contexts: readonly StateScopeContext[],
  diagnostics: string[],
): Set<string> {
  const referenced = new Set<string>();
  const fieldsById = new Map(dataset.fields.map((field) => [field.id, field]));
  const addField = (fieldId: string): void => {
    const field = fieldsById.get(fieldId);
    if (field === undefined) {
      diagnostics.push(`MVU_MODEL_REFERENCE_FIELD_MISSING:${fieldId}`);
      return;
    }
    if (!field.enabled) {
      diagnostics.push(`MVU_MODEL_REFERENCE_FIELD_DISABLED:${fieldId}`);
      return;
    }
    if (!contexts.some((context) => fieldAppliesToContext(field, context))) {
      diagnostics.push(`MVU_MODEL_REFERENCE_FIELD_OUT_OF_SCOPE:${fieldId}`);
      return;
    }
    referenced.add(fieldId);
  };
  if (dataset.formatVersion === 3) {
    collectV3References(dataset, contexts, addField, diagnostics);
  } else {
    collectV2References(dataset, addField, diagnostics);
  }
  return referenced;
}

function collectV3References(
  dataset: MvuDatasetV3,
  contexts: readonly StateScopeContext[],
  addField: (fieldId: string) => void,
  diagnostics: string[],
): void {
  const conditions = new Map(dataset.conditions.map((condition) => [condition.id, condition]));
  const effects = new Map(dataset.effectGroups.map((effect) => [effect.id, effect]));
  for (const rule of [...dataset.rules].sort((left, right) => compareRule(left, right))) {
    if (!rule.enabled || !ruleAppliesToContexts(rule, contexts)) continue;
    const condition = conditions.get(rule.conditionId);
    if (condition === undefined) {
      diagnostics.push(`MVU_MODEL_REFERENCE_CONDITION_MISSING:${rule.conditionId}`);
      continue;
    }
    if (!condition.enabled) {
      diagnostics.push(`MVU_MODEL_REFERENCE_CONDITION_DISABLED:${condition.id}`);
      continue;
    }
    collectConditionFields(condition.expression, addField);
    for (const action of rule.actions) {
      if (action.kind === "change_field") {
        addField(action.fieldId);
        for (const effectGroupId of action.effectGroupIds) {
          collectEffectFields(effectGroupId, effects, addField, diagnostics);
        }
      } else {
        collectEffectFields(action.effectGroupId, effects, addField, diagnostics);
      }
    }
  }
}

function collectV2References(
  dataset: MvuDataset,
  addField: (fieldId: string) => void,
  diagnostics: string[],
): void {
  const effects = new Map(dataset.temporaryEffects.map((effect) => [effect.id, effect]));
  for (const rule of [...dataset.autoRules].sort((left, right) =>
    left.order - right.order || compareStableText(left.id, right.id))) {
    if (!rule.enabled) continue;
    if (rule.condition.kind === "stateThreshold") addField(rule.condition.fieldId);
    for (const effect of rule.effects) {
      addField(effect.fieldId);
      for (const effectId of effect.temporaryEffectIds) {
        const temporary = effects.get(effectId);
        if (temporary === undefined) {
          diagnostics.push(`MVU_MODEL_REFERENCE_EFFECT_GROUP_MISSING:${effectId}`);
          continue;
        }
        if (!temporary.enabled) {
          diagnostics.push(`MVU_MODEL_REFERENCE_EFFECT_GROUP_DISABLED:${effectId}`);
          continue;
        }
        for (const target of temporary.targets) addField(target.fieldId);
      }
    }
  }
}

function collectConditionFields(
  expression: ConditionExpression,
  addField: (fieldId: string) => void,
): void {
  if (expression.kind === "and" || expression.kind === "or") {
    for (const child of expression.children) collectConditionFields(child, addField);
    return;
  }
  if (expression.kind === "not") {
    collectConditionFields(expression.child, addField);
    return;
  }
  if (expression.predicate.kind === "field_comparison") addField(expression.predicate.fieldId);
}

function collectEffectFields(
  effectGroupId: string,
  effects: ReadonlyMap<string, EffectGroupDefinition>,
  addField: (fieldId: string) => void,
  diagnostics: string[],
): void {
  const effect = effects.get(effectGroupId);
  if (effect === undefined) {
    diagnostics.push(`MVU_MODEL_REFERENCE_EFFECT_GROUP_MISSING:${effectGroupId}`);
    return;
  }
  if (!effect.enabled) {
    diagnostics.push(`MVU_MODEL_REFERENCE_EFFECT_GROUP_DISABLED:${effectGroupId}`);
    return;
  }
  for (const fieldEffect of effect.fieldEffects) addField(fieldEffect.fieldId);
}

function ruleAppliesToContexts(
  rule: RuleDefinitionV3,
  contexts: readonly StateScopeContext[],
): boolean {
  const selector = rule.triggerActorSelector;
  if (selector.kind === "any") return true;
  if (selector.kind === "current_actor") return contexts.some((context) => context.actorId !== null);
  if (selector.kind === "selected") {
    return contexts.some((context) => context.actorId !== null && selector.actorIds.includes(context.actorId));
  }
  return contexts.some((context) => context.groupId !== null && selector.groupIds.includes(context.groupId));
}

function compareRule(left: RuleDefinitionV3, right: RuleDefinitionV3): number {
  if (left.executionOrder !== right.executionOrder) return left.executionOrder - right.executionOrder;
  return compareStableText(left.id, right.id);
}

function uniqueScopeContexts(contexts: readonly StateScopeContext[]): StateScopeContext[] {
  const unique = new Map<string, StateScopeContext>();
  for (const context of contexts) {
    const key = `${context.chatId ?? ""}\u0000${context.actorId ?? ""}\u0000${context.groupId ?? ""}`;
    if (!unique.has(key)) unique.set(key, context);
  }
  return [...unique.values()];
}

function boundedDiagnostics(diagnostics: readonly string[]): string[] {
  const unique = [...new Set(diagnostics)].sort(compareStableText);
  if (unique.length <= MODEL_DIAGNOSTIC_LIMIT) return unique;
  const retained = unique.slice(0, MODEL_DIAGNOSTIC_LIMIT - 1);
  retained.push(`MVU_MODEL_DIAGNOSTICS_TRUNCATED:${unique.length}`);
  return retained;
}

function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sanitizeLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function escapeXml(value: string): string {
  return sanitizeLine(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
