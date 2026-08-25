import type { DataField, StateScope } from "./model";
import type {
  ActiveEffectDefinitionSnapshot,
  ActiveEffectInstance,
  EffectActorSelector,
  EffectDuration,
  EffectGroupDefinition,
  EffectOperation,
  EffectReasonConfig,
  EffectReasonSnapshot,
  ResolvedEffectTarget,
} from "./model-v3";
import {
  EFFECT_REASON_LEGACY_STORAGE_MAX_LENGTH,
  EFFECT_REASON_RENDERED_MAX_LENGTH,
  EFFECT_REASON_SOURCE_MAX_LENGTH,
  EFFECT_REASON_VARIABLE_MAX_LENGTH,
  V3_EFFECT_REASON_TEMPLATES,
  truncateEffectReasonText,
  type ChangeSource,
} from "./model-v3";
import {
  renderEffectReasonText,
  type EffectReasonVariables,
} from "./temporary-effect";

export interface EffectReasonInput {
  mode: EffectReasonSnapshot["mode"];
  template: EffectReasonSnapshot["template"];
  text?: string;
}

export interface EffectDiagnostic {
  code: "MVU_EFFECT_TRIGGER_ACTOR_MISSING" | "MVU_EFFECT_TRIGGER_ACTOR_NOT_BOUND";
  definitionId: string;
  fieldEffectId: string;
}

export interface ImmediateFieldChange {
  actorId: string | null;
  fieldId: string;
  delta: number;
}

export interface ActivateEffectGroupInput {
  definition: EffectGroupDefinition;
  fields: readonly DataField[];
  triggerActorId?: string;
  instanceId: string;
  activatedAt: string;
  duration?: EffectDuration;
  /** Omit to use the reusable definition default. */
  reason?: EffectReasonInput;
  reasonVariables?: EffectReasonVariables;
  /** Values use the collision-safe `${scopeKey}\0${fieldId}` address. */
  currentValues?: Readonly<Record<string, number>>;
}

export interface EffectActivationResult {
  instances: ActiveEffectInstance[];
  immediateChanges: ImmediateFieldChange[];
  diagnostics: EffectDiagnostic[];
}

export interface ApplyActiveEffectsInput {
  field: DataField;
  actorId: string | null;
  /** Required for group/chat fields; character/global keys are derived when omitted. */
  scopeKey?: string;
  source: ChangeSource;
  sourceDelta: number;
  currentValue: number;
  activeEffects: readonly ActiveEffectInstance[];
  effectGroups: readonly EffectGroupDefinition[];
  occurredAt?: string;
}

export interface AppliedFieldDelta {
  requestedDelta: number;
  effectiveDelta: number;
  nextValue: number;
  effectIds: string[];
  reasons: EffectReasonSnapshot[];
}

/**
 * Resolve actor selectors once at activation, so later field calculations never
 * reinterpret a dynamic selector as a broader set of bindings.
 */
export function activateEffectGroup(input: ActivateEffectGroupInput): EffectActivationResult {
  const diagnostics: EffectDiagnostic[] = [];
  const resolvedTargets: ResolvedEffectTarget[] = [];
  const immediateChanges: ImmediateFieldChange[] = [];
  if (input.reason !== undefined && (input.reason.text?.length ?? 0) > EFFECT_REASON_SOURCE_MAX_LENGTH) {
    throw new Error("MVU_EFFECT_REASON_TOO_LONG");
  }
  const configuredReason: EffectReasonInput = input.reason ?? input.definition.defaultReason ?? DEFAULT_EFFECT_REASON;
  const reason = resolveEffectReason({
    reason: configuredReason,
    variables: {
      effectGroupName: input.definition.name,
      fieldName: effectFieldNames(input.definition, input.fields),
      ...input.reasonVariables,
    },
  });
  let activationBlocked = false;

  if (!input.definition.enabled) return { instances: [], immediateChanges, diagnostics };

  for (const fieldEffect of input.definition.fieldEffects) {
    const field = input.fields.find((candidate) => candidate.id === fieldEffect.fieldId);
    if (field === undefined || !field.enabled) continue;
    const targets = resolveTargets(field, fieldEffect.actorSelector, input.triggerActorId, input.definition.id, fieldEffect.id, diagnostics);
    if (fieldEffect.actorSelector.kind === "trigger_actor" && targets.length === 0) activationBlocked = true;
    for (const target of targets) {
      resolvedTargets.push(target);
      const immediateDelta = fieldEffect.operations
        .filter((operation): operation is Extract<EffectOperation, { kind: "immediate_delta" }> =>
          operation.kind === "immediate_delta")
        .reduce((sum, operation) => sum + operation.value, 0);
      if (immediateDelta === 0) continue;
      const currentValue = input.currentValues?.[targetValueKey(target.scopeKey, target.fieldId)] ?? field.initialValue;
      const nextValue = normalizeValue(currentValue + immediateDelta, field);
      immediateChanges.push({ actorId: target.actorId, fieldId: target.fieldId, delta: round(nextValue - currentValue) });
    }
  }

  if (activationBlocked || resolvedTargets.length === 0) return { instances: [], immediateChanges: [], diagnostics };
  return {
    instances: [{
      id: input.instanceId,
      definitionId: input.definition.id,
      ...(input.triggerActorId === undefined ? {} : { triggerActorId: input.triggerActorId }),
      resolvedTargets,
      duration: input.duration ?? input.definition.defaultDuration ?? { expiresAt: null, remainingTurns: null },
      activatedAt: input.activatedAt,
      reason,
      definitionSnapshot: snapshotEffectDefinition(input.definition),
    }],
    immediateChanges,
    diagnostics,
  };
}

/** Applies active v3 effect operations to one already-resolved field change. */
export function applyActiveEffects(input: ApplyActiveEffectsInput): AppliedFieldDelta {
  const scopeKey = input.scopeKey ?? targetScopeKey(input.field.scope, input.actorId);
  if (scopeKey === null) return unchanged(input);
  let value = input.sourceDelta;
  const directionalSign = Math.sign(input.sourceDelta);
  const groups = new Map(input.effectGroups.map((group) => [group.id, group]));
  const applicableOperations: EffectOperation[] = [];
  const effectIds: string[] = [];
  const reasons: EffectReasonSnapshot[] = [];

  for (const instance of input.activeEffects) {
    if (!instanceApplies(instance, input.field.id, scopeKey, input.occurredAt)) continue;
    const currentDefinition = groups.get(instance.definitionId);
    const fieldEffects = instance.definitionSnapshot?.fieldEffects ?? currentDefinition?.fieldEffects;
    const fieldEffect = fieldEffects?.find((candidate) => candidate.fieldId === input.field.id);
    if (fieldEffect === undefined || (instance.definitionSnapshot === undefined && !currentDefinition?.enabled)) continue;
    applicableOperations.push(...fieldEffect.operations.filter((operation) => operationApplies(operation, input.source)));
    effectIds.push(instance.id);
    reasons.push(instance.reason);
  }

  value += applicableOperations
    .filter((operation): operation is Extract<EffectOperation, { kind: "fixed_adjustment" }> =>
      operation.kind === "fixed_adjustment")
    .reduce((sum, operation) => sum + operation.value, 0);
  if (directionalSign > 0) value *= multiplierFor(applicableOperations, "positive_multiplier");
  if (directionalSign < 0) value *= multiplierFor(applicableOperations, "negative_multiplier");
  value *= multiplierFor(applicableOperations, "all_multiplier");

  if (!Number.isFinite(value)) throw new Error(`MVU_EFFECT_RESULT_INVALID:${input.field.id}`);
  const nextValue = normalizeValue(input.currentValue + value, input.field);
  return {
    requestedDelta: input.sourceDelta,
    effectiveDelta: round(nextValue - input.currentValue),
    nextValue,
    effectIds,
    reasons: uniqueReasons(reasons),
  };
}

/** Upgrades pre-snapshot v3 instances once using the definition visible at load time. */
export function hydrateLegacyActiveEffectSnapshots(dataset: {
  effectGroups: readonly EffectGroupDefinition[];
  activeEffects: ActiveEffectInstance[];
}): void {
  const groups = new Map(dataset.effectGroups.map((definition) => [definition.id, definition]));
  for (const instance of dataset.activeEffects) {
    if (instance.definitionSnapshot !== undefined) continue;
    const definition = groups.get(instance.definitionId);
    if (definition === undefined) throw new Error(`MVU_EFFECT_DEFINITION_NOT_FOUND:${instance.definitionId}`);
    instance.definitionSnapshot = snapshotEffectDefinition(definition);
  }
}

function snapshotEffectDefinition(definition: EffectGroupDefinition): ActiveEffectDefinitionSnapshot {
  return {
    name: definition.name,
    description: definition.description,
    updatedAt: definition.updatedAt,
    fieldEffects: definition.fieldEffects.map((fieldEffect) => ({
      ...fieldEffect,
      actorSelector: cloneSelector(fieldEffect.actorSelector),
      operations: fieldEffect.operations.map(cloneOperation),
    })),
  };
}

function cloneSelector(selector: EffectActorSelector): EffectActorSelector {
  return selector.kind === "selected"
    ? { kind: "selected", actorIds: [...selector.actorIds] }
    : { kind: selector.kind };
}

function cloneOperation(operation: EffectOperation): EffectOperation {
  return operation.kind === "immediate_delta"
    ? { ...operation }
    : { ...operation, sources: [...operation.sources] };
}

/** Renders only the supported visual variables and stores the completed text. */
export function resolveEffectReason(input: {
  reason: EffectReasonInput;
  variables?: EffectReasonVariables;
}): EffectReasonSnapshot {
  if (input.reason.mode === "custom" && (input.reason.text?.trim().length ?? 0) === 0) {
    throw new Error("MVU_EFFECT_REASON_EMPTY");
  }
  if ((input.reason.text?.length ?? 0) > EFFECT_REASON_LEGACY_STORAGE_MAX_LENGTH) {
    throw new Error("MVU_EFFECT_REASON_TOO_LONG");
  }
  const sourceText = input.reason.mode === "custom"
    ? input.reason.text?.trim() ?? ""
    : V3_EFFECT_REASON_TEMPLATES[input.reason.template];
  const variables = normalizeReasonVariables(input.variables);
  const rendered = renderEffectReasonText(sourceText, variables);
  return {
    mode: input.reason.mode,
    template: input.reason.template,
    text: normalizeRenderedEffectReason(rendered),
  };
}

/** Normalizes a completed reason before it crosses an active-instance or record boundary. */
export function normalizeRenderedEffectReason(value: string): string {
  const normalized = truncateEffectReasonText(value, EFFECT_REASON_RENDERED_MAX_LENGTH)
    .replace(/\u0000/g, "")
    .trim();
  return truncateEffectReasonText(
    normalized.length === 0 ? V3_EFFECT_REASON_TEMPLATES.general : normalized,
    EFFECT_REASON_RENDERED_MAX_LENGTH,
  );
}

function normalizeReasonVariables(variables: EffectReasonVariables | undefined): EffectReasonVariables {
  if (variables === undefined) return {};
  return {
    triggerActorName: normalizeEffectReasonVariable(variables.triggerActorName),
    ruleName: normalizeEffectReasonVariable(variables.ruleName),
    effectGroupName: normalizeEffectReasonVariable(variables.effectGroupName),
    fieldName: normalizeEffectReasonVariable(variables.fieldName),
    event: normalizeEffectReasonVariable(variables.event),
  };
}

export function normalizeEffectReasonVariable(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return truncateEffectReasonText(value, EFFECT_REASON_VARIABLE_MAX_LENGTH)
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DEFAULT_EFFECT_REASON: EffectReasonConfig = {
  mode: "template",
  template: "general",
  text: "",
};

function effectFieldNames(
  definition: EffectGroupDefinition,
  fields: readonly DataField[],
): string {
  const names = new Set<string>();
  let result = "";
  for (const fieldEffect of definition.fieldEffects) {
    const name = fields.find((field) => field.id === fieldEffect.fieldId)?.name ?? fieldEffect.fieldId;
    if (names.has(name)) continue;
    names.add(name);
    const separator = result.length === 0 ? "" : "、";
    const remaining = EFFECT_REASON_VARIABLE_MAX_LENGTH - result.length - separator.length;
    if (remaining <= 0) break;
    result += separator + truncateEffectReasonText(name, remaining);
    if (result.length >= EFFECT_REASON_VARIABLE_MAX_LENGTH) break;
  }
  return result;
}

function resolveTargets(
  field: DataField,
  selector: EffectActorSelector,
  triggerActorId: string | undefined,
  definitionId: string,
  fieldEffectId: string,
  diagnostics: EffectDiagnostic[],
): ResolvedEffectTarget[] {
  if (selector.kind === "trigger_actor") {
    if (triggerActorId === undefined || triggerActorId.length === 0) {
      diagnostics.push({ code: "MVU_EFFECT_TRIGGER_ACTOR_MISSING", definitionId, fieldEffectId });
      return [];
    }
    if (field.scope !== "character" || !field.bindingIds.includes(triggerActorId)) {
      diagnostics.push({ code: "MVU_EFFECT_TRIGGER_ACTOR_NOT_BOUND", definitionId, fieldEffectId });
      return [];
    }
    return [targetFor(field, triggerActorId)];
  }
  if (selector.kind === "selected") {
    if (field.scope !== "character") return [];
    return selector.actorIds
      .filter((actorId) => field.bindingIds.includes(actorId))
      .map((actorId) => targetFor(field, actorId));
  }
  if (field.scope === "global") return [targetFor(field, null)];
  return field.bindingIds.map((bindingId) => targetFor(field, bindingId));
}

function targetFor(field: DataField, bindingId: string | null): ResolvedEffectTarget {
  const scopeKey = field.scope === "global" ? "global" : `${field.scope}:${bindingId}`;
  return {
    fieldId: field.id,
    actorId: field.scope === "character" ? bindingId : null,
    scope: field.scope,
    scopeKey,
  };
}

function instanceApplies(
  instance: ActiveEffectInstance,
  fieldId: string,
  scopeKey: string,
  occurredAt: string | undefined,
): boolean {
  if (instance.duration.remainingTurns !== null && instance.duration.remainingTurns <= 0) return false;
  if (occurredAt !== undefined && instance.duration.expiresAt !== null && instance.duration.expiresAt <= occurredAt) return false;
  return instance.resolvedTargets.some((target) => target.fieldId === fieldId && target.scopeKey === scopeKey);
}

function operationApplies(operation: EffectOperation, source: ChangeSource): boolean {
  return operation.kind === "immediate_delta" || operation.sources.includes(source);
}

function multiplierFor(
  operations: readonly EffectOperation[],
  kind: "positive_multiplier" | "negative_multiplier" | "all_multiplier",
): number {
  return operations
    .filter((operation): operation is Extract<EffectOperation, { kind: typeof kind }> => operation.kind === kind)
    .reduce((product, operation) => product * operation.value, 1);
}

function targetScopeKey(scope: StateScope, actorId: string | null): string | null {
  if (scope === "global") return "global";
  if (scope !== "character") return null;
  return actorId === null ? null : `character:${actorId}`;
}

function normalizeValue(value: number, field: Pick<DataField, "minimum" | "maximum" | "step">): number {
  const steps = Math.round((value - field.minimum) / field.step);
  const stepped = field.minimum + steps * field.step;
  return Math.min(field.maximum, Math.max(field.minimum, round(stepped)));
}

function unchanged(input: ApplyActiveEffectsInput): AppliedFieldDelta {
  const nextValue = normalizeValue(input.currentValue + input.sourceDelta, input.field);
  return {
    requestedDelta: input.sourceDelta,
    effectiveDelta: round(nextValue - input.currentValue),
    nextValue,
    effectIds: [],
    reasons: [],
  };
}

function targetValueKey(scopeKey: string, fieldId: string): string { return `${scopeKey}\u0000${fieldId}`; }
function round(value: number): number { return Math.round(value * 1_000_000) / 1_000_000; }

function uniqueReasons(reasons: readonly EffectReasonSnapshot[]): EffectReasonSnapshot[] {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = `${reason.mode}\u0000${reason.template}\u0000${reason.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
