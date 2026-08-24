/** Typed bridge between scoped application state and the MVU command executor. */
import type { CommandExecutorHooks } from "../core/command-executor";
import { updateVariablesWithSecurity } from "../core/command-executor";
import { generateSchema, reconcileAndApplySchema } from "../core/schema";
import type { MvuData } from "../core/variable-def";
import { clamp, klona } from "../port/util";
import type {
  DataChangeRecord,
  DataField,
  MvuDataset,
  StateScopeContext,
} from "./model";
import {
  deriveStage,
  fieldAppliesToContext,
  scopeKey,
  stateValueForField,
} from "./scope";
import { resolveTemporaryEffectReason } from "./temporary-effect";

export interface ApplyCommandAudit {
  reason: string;
  source: DataChangeRecord["source"];
  requestedDelta: number | null;
  ruleIds: readonly string[];
  /** null selects every current matching effect; an array is an explicit result-level import. */
  temporaryEffectIds: readonly string[] | null;
  confidence: number | null;
  messageId: string | null;
  variantId: string | null;
  occurredAt: number;
}

export interface ApplyResult {
  changed: boolean;
  record?: DataChangeRecord;
}

export function buildMvuData(dataset: MvuDataset, context: StateScopeContext): MvuData {
  const states: Record<string, unknown> = {};
  for (const field of dataset.fields) {
    if (!fieldAppliesToContext(field, context)) continue;
    states[field.id] = [stateValueForField(dataset, field, context), field.description];
  }
  const data: MvuData = {
    initialized_lorebooks: {},
    stat_data: { states } as MvuData["stat_data"],
    schema: { type: "object", properties: {} },
    display_data: {},
    delta_data: {},
  };
  const schema = generateSchema(klona(data.stat_data));
  if (schema.type === "object") {
    data.schema = schema;
    data.schema.strictSet = true;
    data.schema.strictTemplate = true;
    data.schema.concatTemplateArray = false;
  }
  return data;
}

/**
 * Apply one field command to a transaction draft. It is intentionally not a
 * store API: callers must invoke it inside MvuService.transact.
 */
export async function applyMvuCommand(
  dataset: MvuDataset,
  hooks: CommandExecutorHooks,
  context: StateScopeContext,
  commandText: string,
  audit: ApplyCommandAudit
): Promise<ApplyResult> {
  const field = extractFieldFromCommand(commandText, dataset);
  if (field === undefined) throw new Error("MVU_COMMAND_FIELD_NOT_FOUND");
  if (!fieldAppliesToContext(field, context)) {
    throw new Error(`MVU_FIELD_NOT_BOUND:${field.id}`);
  }

  const before = stateValueForField(dataset, field, context);
  const mvu = buildMvuData(dataset, context);
  const { modified } = await updateVariablesWithSecurity(commandText, mvu, hooks);
  if (!modified) return { changed: false };

  const raw = readVwdValue(mvu.stat_data, field.id);
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new Error(`MVU_COMMAND_VALUE_INVALID:${field.id}`);
  }
  const requestedDelta = audit.requestedDelta === null ? round(raw - before) : round(audit.requestedDelta);
  if (requestedDelta === 0) return { changed: false };
  if (audit.source === "manual" && audit.temporaryEffectIds === null) {
    throw new Error("MVU_MANUAL_EFFECT_SELECTION_REQUIRED");
  }
  const selectedEffectIds = audit.temporaryEffectIds === null
    ? null
    : new Set(audit.temporaryEffectIds);
  if (selectedEffectIds !== null && selectedEffectIds.size !== audit.temporaryEffectIds?.length) {
    throw new Error("MVU_EFFECT_SELECTION_DUPLICATE");
  }
  const activeEffects = dataset.temporaryEffects.filter((effect) =>
    (selectedEffectIds === null || selectedEffectIds.has(effect.id)) &&
    effect.enabled &&
    effect.targets.some((target) =>
      target.fieldId === field.id &&
      target.scope === field.scope &&
      target.scopeKey === scopeKey(field.scope, context)
    ) &&
    (effect.expiresAt === null || effect.expiresAt > audit.occurredAt) &&
    (effect.remainingTurns === null || effect.remainingTurns > 0)
  );
  const multiplier = activeEffects
    .filter((effect) => effect.mode === "multiplier")
    .reduce((product, effect) => product * effect.value, 1);
  const additive = activeEffects
    .filter((effect) => effect.mode === "additive")
    .reduce((sum, effect) => sum + effect.value, 0);
  const effectiveRequestedDelta = round(requestedDelta * multiplier + additive);
  if (!Number.isFinite(effectiveRequestedDelta)) {
    throw new Error(`MVU_EFFECT_RESULT_INVALID:${field.id}`);
  }
  const after = normalizeToStep(before + effectiveRequestedDelta, field);
  const actualDelta = round(after - before);
  if (actualDelta === 0) return { changed: false };

  const key = scopeKey(field.scope, context);
  dataset.stateValues[key] = dataset.stateValues[key] ?? {};
  dataset.stateValues[key][field.id] = after;
  const stageBefore = deriveStage(field, before);
  const stageAfter = deriveStage(field, after);
  const effectReasons = [...new Set(activeEffects.map(resolveTemporaryEffectReason))];
  const recordReason = effectReasons.length === 0
    ? audit.reason
    : `${audit.reason}；临时效果：${effectReasons.join("、")}`;
  const record: DataChangeRecord = {
    id: makeRecordId(audit.occurredAt),
    scope: field.scope,
    scopeKey: key,
    fieldId: field.id,
    fieldName: field.name,
    actorId: context.actorId,
    actorName: context.actorName,
    chatId: context.chatId,
    groupId: context.groupId,
    before,
    after,
    requestedDelta,
    effectiveRequestedDelta,
    delta: actualDelta,
    stageBefore: stageBefore.id,
    stageAfter: stageAfter.id,
    reason: recordReason,
    source: audit.source,
    ruleIds: [...audit.ruleIds],
    effectIds: activeEffects.map((effect) => effect.id),
    confidence: audit.confidence,
    messageId: audit.messageId,
    variantId: audit.variantId,
    occurredAt: audit.occurredAt,
  };
  dataset.records.push(record);
  return { changed: true, record };
}

export function buildSetCommand(fieldId: string, value: number): string {
  if (!Number.isFinite(value)) throw new Error(`MVU_SET_VALUE_INVALID:${fieldId}`);
  return `_.set('states.${fieldId}', ${value});`;
}

export function buildDeltaCommand(fieldId: string, delta: number): string {
  if (!Number.isFinite(delta)) throw new Error(`MVU_DELTA_VALUE_INVALID:${fieldId}`);
  return `_.add('states.${fieldId}', ${delta});`;
}

function normalizeToStep(value: number, field: DataField): number {
  const steps = Math.round((value - field.minimum) / field.step);
  const stepped = field.minimum + steps * field.step;
  return clamp(round(stepped), field.minimum, field.maximum);
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function makeRecordId(occurredAt: number): string {
  return `rec_${occurredAt.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function readVwdValue(statData: unknown, fieldId: string): unknown {
  const states = (statData as { states?: Record<string, unknown> }).states;
  const raw = states?.[fieldId];
  if (Array.isArray(raw) && raw.length === 2 && typeof raw[1] === "string") return raw[0];
  return raw;
}

function extractFieldFromCommand(commandText: string, dataset: MvuDataset): DataField | undefined {
  const match = /states\.([A-Za-z][A-Za-z0-9_]*)/.exec(commandText);
  if (match === null) return undefined;
  return dataset.fields.find((field) => field.id === match[1]);
}

export function seedSchemaOnMvuData(data: MvuData): MvuData {
  reconcileAndApplySchema(data);
  return data;
}
