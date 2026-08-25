/** Deterministic, bounded model projection for explicit host scope contexts. */
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
  scopeKey,
  stateValueForField,
} from "./scope";

export const MODEL_FIELD_LIMIT = 40;
const MODEL_DIAGNOSTIC_LIMIT = 32;
const MODEL_DIAGNOSTIC_TEXT_LIMIT = 256;
const MODEL_LABEL_LIMIT = 32;
const MODEL_DESCRIPTION_LIMIT = 48;
const MODEL_ID_LIMIT = 256;

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

export interface ModelFieldRecency {
  fieldId: string;
  scopeKey: string;
  occurredAt: number;
}

export interface SelectModelFieldsOptions {
  /** A lower caller budget is allowed, but the product hard limit is always 40. */
  maxFields?: number;
  /** Exact field/scope recency supplied by the bounded persistent record lookup. */
  recentChanges?: readonly ModelFieldRecency[];
  /** Persisted event actor. Undefined means a projection across possible visible actors. */
  eventActorId?: string | null;
  /** Selected actor, intentionally distinct from the persisted event actor. */
  currentActorId?: string | null;
  /** Optional event time used with the durable cooldown map. */
  occurredAt?: number;
  lastTriggeredAtByRuleId?: Readonly<Record<string, number>>;
}

export interface ModelStateEntry {
  field: DataField;
  context: StateScopeContext;
  scopeKey: string;
}

export interface ModelStateEntrySelection {
  entries: ModelStateEntry[];
  stats: ModelFieldBudgetStats;
}

export interface ScopedStateSectionProjection {
  section: string;
  budget: ModelFieldBudgetStats;
}

type ModelFieldDataset = MvuDataset | MvuDatasetV3;

/** Single-context compatibility API backed by the final entry budget. */
export function selectModelFields(
  dataset: ModelFieldDataset,
  context: StateScopeContext,
  options: SelectModelFieldsOptions = {},
): ModelFieldSelection {
  const selected = selectModelStateEntries(dataset, context, [], options);
  return { fields: selected.entries.map((entry) => entry.field), stats: selected.stats };
}

/**
 * The hard budget unit is one final `(fieldId, scopeKey)` state entry. A group
 * with 20 members and 40 character fields therefore has 800 candidates but can
 * serialize at most 40 field rows.
 */
export function selectModelStateEntries(
  dataset: ModelFieldDataset,
  context: StateScopeContext,
  memberContexts: readonly StateScopeContext[] = [],
  options: SelectModelFieldsOptions = {},
): ModelStateEntrySelection {
  const requestedLimit = options.maxFields ?? MODEL_FIELD_LIMIT;
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    throw new Error("MVU_MODEL_FIELD_LIMIT_INVALID");
  }
  const limit = Math.min(requestedLimit, MODEL_FIELD_LIMIT);
  const contexts = uniqueScopeContexts([context, ...memberContexts]);
  const diagnostics: string[] = [];
  const references = collectReferencedEntries(dataset, context, contexts, options, diagnostics);
  const candidates = buildStateEntries(dataset, context, contexts, references);
  const candidateKeys = new Set(candidates.map(modelEntryKey));
  const latestChanges = collectLatestChanges(dataset, options.recentChanges, candidateKeys);
  const ranked = [...candidates].sort((left, right) =>
    compareModelEntries(left, right, references, latestChanges));
  const entries = ranked.slice(0, limit);
  const selectedKeys = new Set(entries.map(modelEntryKey));
  const referencedTotal = [...references].filter((key) => candidateKeys.has(key)).length;
  const referencedIncluded = [...references].filter((key) => selectedKeys.has(key)).length;
  if (referencedTotal > limit) {
    diagnostics.push(`MVU_MODEL_REFERENCED_FIELDS_OVERFLOW:${referencedTotal}:${limit}`);
  }
  return {
    entries,
    stats: {
      used: entries.length,
      total: candidates.length,
      limit,
      referencedIncluded,
      referencedTotal,
      overflow: candidates.length > limit,
      diagnostics: boundedDiagnostics(diagnostics),
    },
  };
}

export function modelRecencyTargets(
  dataset: ModelFieldDataset,
  context: StateScopeContext,
  memberContexts: readonly StateScopeContext[] = [],
): Array<{ fieldId: string; scopeKey: string }> {
  const contexts = uniqueScopeContexts([context, ...memberContexts]);
  const seen = new Set<string>();
  const result: Array<{ fieldId: string; scopeKey: string }> = [];
  for (const field of dataset.fields) {
    if (!field.enabled) continue;
    const targetContexts = field.scope === "character" ? contexts : [context];
    for (const candidate of targetContexts) {
      if (!fieldAppliesToContext(field, candidate)) continue;
      const key = scopeKey(field.scope, candidate);
      const identity = modelScopeIdentity(field.id, key);
      if (seen.has(identity)) continue;
      seen.add(identity);
      result.push({ fieldId: field.id, scopeKey: key });
    }
  }
  return result;
}

export function buildStateSectionBlock(
  dataset: ModelFieldDataset,
  context: StateScopeContext,
  fields: readonly DataField[],
): string {
  const actorLabel = boundedLine(context.actorName.length > 0 ? context.actorName : "当前上下文", MODEL_LABEL_LIMIT);
  const lines: string[] = [
    `<WorldState actorId="${escapeXml(boundedLine(context.actorId ?? "", MODEL_ID_LIMIT))}" actor="${escapeXml(actorLabel)}">`,
    `[动态状态 · ${actorLabel}]`,
  ];
  const permittedIds = new Set(fields.map((field) => field.id));
  const selected = selectModelFields(dataset, context).fields.filter((field) => permittedIds.has(field.id));
  appendFieldLines(lines, dataset, context, selected);
  lines.push("</WorldState>");
  return lines.join("\n");
}

export function buildScopedStateSectionProjection(
  dataset: ModelFieldDataset,
  context: StateScopeContext,
  memberContexts: readonly StateScopeContext[] = [],
  options: SelectModelFieldsOptions = {},
): ScopedStateSectionProjection {
  const selection = selectModelStateEntries(dataset, context, memberContexts, options);
  if (selection.entries.length === 0) return { section: "", budget: selection.stats };
  const lines: string[] = [
    `<WorldState chatId="${escapeXml(boundedLine(context.chatId ?? "", MODEL_ID_LIMIT))}" groupId="${escapeXml(boundedLine(context.groupId ?? "", MODEL_ID_LIMIT))}">`,
  ];
  const shared = selection.entries.filter((entry) => entry.field.scope !== "character");
  if (shared.length > 0) {
    lines.push("[共享动态状态]");
    appendEntryLines(lines, dataset, shared);
  }
  const characterGroups = new Map<string, ModelStateEntry[]>();
  for (const entry of selection.entries) {
    if (entry.field.scope !== "character" || entry.context.actorId === null) continue;
    const existing = characterGroups.get(entry.context.actorId) ?? [];
    existing.push(entry);
    characterGroups.set(entry.context.actorId, existing);
  }
  for (const actorId of [...characterGroups.keys()].sort(compareStableText)) {
    const entries = characterGroups.get(actorId) ?? [];
    const member = entries[0]?.context;
    if (member === undefined) continue;
    const actorLabel = boundedLine(member.actorName.length > 0 ? member.actorName : actorId, MODEL_LABEL_LIMIT);
    lines.push(
      `<ActorState actorId="${escapeXml(boundedLine(actorId, MODEL_ID_LIMIT))}" actor="${escapeXml(actorLabel)}">`,
      `[角色动态状态 · ${actorLabel}]`,
    );
    appendEntryLines(lines, dataset, entries);
    lines.push("</ActorState>");
  }
  lines.push("</WorldState>");
  return { section: lines.join("\n"), budget: selection.stats };
}

export function buildScopedStateSectionBlock(
  dataset: ModelFieldDataset,
  context: StateScopeContext,
  memberContexts: readonly StateScopeContext[] = [],
): string {
  return buildScopedStateSectionProjection(dataset, context, memberContexts).section;
}

export function visibleFieldsForContext(
  dataset: ModelFieldDataset,
  context: StateScopeContext,
): DataField[] {
  return dataset.fields.filter((field) =>
    fieldAppliesToContext(field, context) && field.modelVisibility !== "hidden");
}

function buildStateEntries(
  dataset: ModelFieldDataset,
  rootContext: StateScopeContext,
  contexts: readonly StateScopeContext[],
  references: ReadonlySet<string>,
): ModelStateEntry[] {
  const entries: ModelStateEntry[] = [];
  const seen = new Set<string>();
  for (const field of dataset.fields) {
    if (!field.enabled) continue;
    const targetContexts = field.scope === "character" ? contexts : [rootContext];
    for (const candidate of targetContexts) {
      if (!fieldAppliesToContext(field, candidate)) continue;
      const key = scopeKey(field.scope, candidate);
      const identity = modelScopeIdentity(field.id, key);
      if (seen.has(identity) || (field.modelVisibility === "hidden" && !references.has(identity))) continue;
      seen.add(identity);
      entries.push({ field, context: candidate, scopeKey: key });
    }
  }
  return entries;
}

function compareModelEntries(
  left: ModelStateEntry,
  right: ModelStateEntry,
  referenced: ReadonlySet<string>,
  latestChanges: ReadonlyMap<string, number>,
): number {
  const leftKey = modelEntryKey(left);
  const rightKey = modelEntryKey(right);
  const referenceOrder = Number(referenced.has(rightKey)) - Number(referenced.has(leftKey));
  if (referenceOrder !== 0) return referenceOrder;
  const visibility = visibilityRank(right.field.modelVisibility) - visibilityRank(left.field.modelVisibility);
  if (visibility !== 0) return visibility;
  const leftRecent = latestChanges.get(leftKey) ?? Number.NEGATIVE_INFINITY;
  const rightRecent = latestChanges.get(rightKey) ?? Number.NEGATIVE_INFINITY;
  if (leftRecent !== rightRecent) return rightRecent > leftRecent ? 1 : -1;
  if (left.field.order !== right.field.order) return left.field.order - right.field.order;
  const fieldId = compareStableText(left.field.id, right.field.id);
  return fieldId !== 0 ? fieldId : compareStableText(left.scopeKey, right.scopeKey);
}

function visibilityRank(visibility: DataField["modelVisibility"]): number {
  if (visibility === "full") return 2;
  if (visibility === "stage_only") return 1;
  return 0;
}

function collectLatestChanges(
  dataset: ModelFieldDataset,
  explicit: readonly ModelFieldRecency[] | undefined,
  eligible: ReadonlySet<string>,
): Map<string, number> {
  const latest = new Map<string, number>();
  const records: readonly ModelFieldRecency[] = explicit ??
    (dataset.formatVersion === 2 ? dataset.records : []);
  for (const record of records) {
    if (!Number.isFinite(record.occurredAt)) continue;
    const identity = modelScopeIdentity(record.fieldId, record.scopeKey);
    if (!eligible.has(identity)) continue;
    const previous = latest.get(identity);
    if (previous === undefined || record.occurredAt > previous) latest.set(identity, record.occurredAt);
  }
  return latest;
}

function collectReferencedEntries(
  dataset: ModelFieldDataset,
  rootContext: StateScopeContext,
  contexts: readonly StateScopeContext[],
  options: SelectModelFieldsOptions,
  diagnostics: string[],
): Set<string> {
  const references = new Set<string>();
  const fieldsById = new Map(dataset.fields.map((field) => [field.id, field]));
  const eventContexts = eventContextsForSelection(rootContext, contexts, options.eventActorId);
  const referencesByEvent = eventContexts.map((eventContext) => ({
    eventContext,
    fieldIds: dataset.formatVersion === 3
      ? collectV3ReferenceIds(dataset, rootContext, eventContext, options, diagnostics)
      : collectV2ReferenceIds(dataset, diagnostics),
  }));
  for (const { eventContext, fieldIds } of referencesByEvent) {
    for (const fieldId of fieldIds) {
      const field = fieldsById.get(fieldId);
      if (field === undefined) {
        diagnostics.push(`MVU_MODEL_REFERENCE_FIELD_MISSING:${fieldId}`);
        continue;
      }
      if (!field.enabled) {
        diagnostics.push(`MVU_MODEL_REFERENCE_FIELD_DISABLED:${fieldId}`);
        continue;
      }
      if (field.scope === "character") {
        if (!fieldAppliesToContext(field, eventContext)) {
          diagnostics.push(`MVU_MODEL_REFERENCE_FIELD_OUT_OF_SCOPE:${fieldId}`);
          continue;
        }
        references.add(modelScopeIdentity(fieldId, scopeKey(field.scope, eventContext)));
        continue;
      }
      if (!fieldAppliesToContext(field, rootContext)) {
        diagnostics.push(`MVU_MODEL_REFERENCE_FIELD_OUT_OF_SCOPE:${fieldId}`);
        continue;
      }
      references.add(modelScopeIdentity(fieldId, scopeKey(field.scope, rootContext)));
    }
  }
  return references;
}

function collectV3ReferenceIds(
  dataset: MvuDatasetV3,
  rootContext: StateScopeContext,
  eventContext: StateScopeContext,
  options: SelectModelFieldsOptions,
  diagnostics: string[],
): Set<string> {
  const referenced = new Set<string>();
  const conditions = new Map(dataset.conditions.map((condition) => [condition.id, condition]));
  const effects = new Map(dataset.effectGroups.map((effect) => [effect.id, effect]));
  const currentActorId = options.currentActorId === undefined ? rootContext.actorId : options.currentActorId;
  for (const rule of [...dataset.rules].sort(compareRule)) {
    if (!ruleIsReachable(rule, eventContext, currentActorId, options)) continue;
    const condition = conditions.get(rule.conditionId);
    if (condition === undefined) {
      diagnostics.push(`MVU_MODEL_REFERENCE_CONDITION_MISSING:${rule.conditionId}`);
      continue;
    }
    if (!condition.enabled) {
      diagnostics.push(`MVU_MODEL_REFERENCE_CONDITION_DISABLED:${condition.id}`);
      continue;
    }
    collectConditionFields(condition.expression, referenced);
    for (const action of rule.actions) {
      if (action.kind === "change_field") {
        referenced.add(action.fieldId);
        for (const effectGroupId of action.effectGroupIds) {
          collectEffectFields(effectGroupId, effects, referenced, diagnostics);
        }
      } else {
        collectEffectFields(action.effectGroupId, effects, referenced, diagnostics);
      }
    }
  }
  return referenced;
}

function collectV2ReferenceIds(dataset: MvuDataset, diagnostics: string[]): Set<string> {
  const referenced = new Set<string>();
  const effects = new Map(dataset.temporaryEffects.map((effect) => [effect.id, effect]));
  for (const rule of [...dataset.autoRules].sort((left, right) =>
    left.order - right.order || compareStableText(left.id, right.id))) {
    if (!rule.enabled) continue;
    if (rule.condition.kind === "stateThreshold") referenced.add(rule.condition.fieldId);
    for (const effect of rule.effects) {
      referenced.add(effect.fieldId);
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
        for (const target of temporary.targets) referenced.add(target.fieldId);
      }
    }
  }
  return referenced;
}

function ruleIsReachable(
  rule: RuleDefinitionV3,
  eventContext: StateScopeContext,
  currentActorId: string | null,
  options: SelectModelFieldsOptions,
): boolean {
  if (!rule.enabled || eventContext.actorId === null) return false;
  const selector = rule.triggerActorSelector;
  const actorMatches = selector.kind === "any" ||
    (selector.kind === "current_actor" && currentActorId !== null && eventContext.actorId === currentActorId) ||
    (selector.kind === "selected" && selector.actorIds.includes(eventContext.actorId)) ||
    (selector.kind === "group" && eventContext.groupId !== null && selector.groupIds.includes(eventContext.groupId));
  if (!actorMatches || !Number.isFinite(rule.cooldownHours) || rule.cooldownHours < 0) return false;
  if (options.occurredAt === undefined) return true;
  if (!Number.isFinite(options.occurredAt)) return false;
  const lastTriggered = options.lastTriggeredAtByRuleId?.[rule.id];
  return lastTriggered === undefined ||
    options.occurredAt - lastTriggered >= rule.cooldownHours * 3_600_000;
}

function eventContextsForSelection(
  rootContext: StateScopeContext,
  contexts: readonly StateScopeContext[],
  eventActorId: string | null | undefined,
): StateScopeContext[] {
  if (eventActorId !== undefined) {
    if (eventActorId === null) return [];
    const exact = contexts.find((context) => context.actorId === eventActorId);
    return [exact ?? { ...rootContext, actorId: eventActorId }];
  }
  return contexts.filter((context) => context.actorId !== null);
}

function collectConditionFields(expression: ConditionExpression, output: Set<string>): void {
  if (expression.kind === "and" || expression.kind === "or") {
    for (const child of expression.children) collectConditionFields(child, output);
    return;
  }
  if (expression.kind === "not") {
    collectConditionFields(expression.child, output);
    return;
  }
  if (expression.predicate.kind === "field_comparison") output.add(expression.predicate.fieldId);
}

function collectEffectFields(
  effectGroupId: string,
  effects: ReadonlyMap<string, EffectGroupDefinition>,
  output: Set<string>,
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
  for (const fieldEffect of effect.fieldEffects) output.add(fieldEffect.fieldId);
}

function appendEntryLines(
  lines: string[],
  dataset: ModelFieldDataset,
  entries: readonly ModelStateEntry[],
): void {
  for (const entry of entries) appendFieldLine(lines, dataset, entry.context, entry.field);
}

function appendFieldLines(
  lines: string[],
  dataset: ModelFieldDataset,
  context: StateScopeContext,
  fields: readonly DataField[],
): void {
  for (const field of fields) {
    if (fieldAppliesToContext(field, context)) appendFieldLine(lines, dataset, context, field);
  }
}

function appendFieldLine(
  lines: string[],
  dataset: ModelFieldDataset,
  context: StateScopeContext,
  field: DataField,
): void {
  const value = stateValueForField(dataset, field, context);
  const stage = deriveStage(field, value);
  const fieldName = boundedLine(field.name, MODEL_LABEL_LIMIT);
  const stageName = boundedLine(stage.name, MODEL_LABEL_LIMIT);
  if (field.modelVisibility === "stage_only") {
    lines.push(`- ${fieldName}: 阶段「${stageName}」`);
    if (stage.description.length > 0) lines.push(`  ${boundedLine(stage.description, MODEL_DESCRIPTION_LIMIT)}`);
    return;
  }
  lines.push(`- ${fieldName}: ${value}（阶段：${stageName}）`);
  if (field.description.length > 0) lines.push(`  ${boundedLine(field.description, MODEL_DESCRIPTION_LIMIT)}`);
  if (stage.description.length > 0) {
    lines.push(`  阶段说明：${boundedLine(stage.description, MODEL_DESCRIPTION_LIMIT)}`);
  }
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
  return [...unique.values()].sort((left, right) => compareStableText(
    `${left.actorId ?? ""}\u0000${left.groupId ?? ""}\u0000${left.chatId ?? ""}`,
    `${right.actorId ?? ""}\u0000${right.groupId ?? ""}\u0000${right.chatId ?? ""}`,
  ));
}

function modelEntryKey(entry: ModelStateEntry): string {
  return modelScopeIdentity(entry.field.id, entry.scopeKey);
}

function modelScopeIdentity(fieldId: string, key: string): string {
  return `${fieldId.length}:${fieldId}${key}`;
}

function boundedDiagnostics(diagnostics: readonly string[]): string[] {
  const unique = [...new Set(diagnostics.map((diagnostic) =>
    boundedLine(diagnostic, MODEL_DIAGNOSTIC_TEXT_LIMIT)))].sort(compareStableText);
  if (unique.length <= MODEL_DIAGNOSTIC_LIMIT) return unique;
  const retained = unique.slice(0, MODEL_DIAGNOSTIC_LIMIT - 1);
  retained.push(`MVU_MODEL_DIAGNOSTICS_TRUNCATED:${unique.length}`);
  return retained;
}

function boundedLine(value: string, maximum: number): string {
  const sanitized = value.replace(/[\r\n]+/g, " ").trim();
  const characters = Array.from(sanitized);
  return characters.length <= maximum ? sanitized : characters.slice(0, maximum).join("");
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
