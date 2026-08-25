import type { DataField } from "./model";
import type { MvuQuerySource } from "./query";
import { klona } from "../port/util";
import { validateDataField } from "./validation";

export const FIELD_TEMPLATE_FORMAT = "operit-mvu-field-template";
export const FIELD_TEMPLATE_SCHEMA_VERSION = 1;
export const FIELD_TEMPLATE_MAX_BYTES = 1_048_576;
export const FIELD_TEMPLATE_MAX_FIELDS = 100;
export const FIELD_TEMPLATE_MAX_TARGETS_PER_FIELD = 1_000;
export const FIELD_TEMPLATE_MAX_STAGES_PER_FIELD = 100;
export const FIELD_TEMPLATE_MAX_ID_LENGTH = 256;
export const FIELD_TEMPLATE_MAX_NAME_LENGTH = 512;
export const FIELD_TEMPLATE_MAX_DESCRIPTION_LENGTH = 4_096;

export interface FieldTemplateTargetSelection { targetId: string; enabled: boolean; includeValue: boolean; }
export interface FieldTemplateFieldSelection { fieldId: string; targets: FieldTemplateTargetSelection[]; }
export interface ExportFieldTemplateRequest { fieldIds: string[]; targetSelections: FieldTemplateFieldSelection[]; }
export interface FieldTemplateExportSummary { fieldCount: number; targetCount: number; valueCount: number; }
export interface FieldTemplateExportPayload { fileName: string; json: string; summary: FieldTemplateExportSummary; }
export interface PreviewFieldTemplateImportRequest { json: string; }
export type FieldTemplateConflictStrategy = "create_copy" | "update" | "replace";
export type FieldTemplateValuePolicy = "template_value" | "keep_existing" | "field_initial";
export interface FieldTemplateImportTargetDecision {
  targetId: string;
  enabled: boolean;
  valuePolicy: FieldTemplateValuePolicy;
}
export interface FieldTemplateSourceMapping {
  sourceTargetId: string;
  targets: FieldTemplateImportTargetDecision[];
}
export interface FieldTemplateImportFieldDecision {
  sourceFieldId: string;
  strategy?: FieldTemplateConflictStrategy;
  mappings: FieldTemplateSourceMapping[];
}
export interface ImportFieldTemplateRequest {
  json: string;
  expectedRevision: number;
  decisions: { fields: FieldTemplateImportFieldDecision[] };
}
export interface FieldTemplateImportResult {
  revision: number;
  summary: {
    created: string[];
    updated: string[];
    replaced: string[];
    skippedTargets: number;
    valueWrites: number;
  };
}

type PortableFieldDefinition = Omit<DataField, "id" | "bindingIds">;
interface PortableSourceTarget {
  kind: "actor" | "group";
  sourceId: string;
  name: string;
  enabled: true;
  value?: number;
}
interface PortableFieldEntry {
  sourceFieldId: string;
  definition: PortableFieldDefinition;
  sourceTargets: PortableSourceTarget[];
  dependencySummary: { linkRuleCount: number; automationRuleCount: number; effectGroupCount: number; };
}
interface FieldTemplateDocument {
  format: typeof FIELD_TEMPLATE_FORMAT;
  schemaVersion: typeof FIELD_TEMPLATE_SCHEMA_VERSION;
  exportedAt: string;
  checksum: { algorithm: "fnv1a32"; value: string };
  fields: PortableFieldEntry[];
}

export interface FieldTemplatePreview {
  valid: true;
  revision: number;
  format: typeof FIELD_TEMPLATE_FORMAT;
  schemaVersion: typeof FIELD_TEMPLATE_SCHEMA_VERSION;
  fields: Array<{
    sourceFieldId: string;
    name: string;
    scope: DataField["scope"];
    conflict: "none" | "id";
    proposedCopyId: string;
    config: { stages: number; naturalChange: boolean; perTurnChange: boolean; ai: boolean; appearance: boolean; };
  }>;
  mappingNeeds: Array<{
    fieldId: string;
    scope: DataField["scope"];
    sourceTargets: Array<{
      kind: "actor" | "group";
      sourceId: string;
      name: string;
      hasValue: boolean;
      valueAdjustment?: { from: number; to: number; reason: "clamp" | "step" };
    }>;
  }>;
  invalidReferences: string[];
}

const PORTABLE_DEFINITION_KEYS = [
  "name", "description", "minimum", "maximum", "step", "initialValue", "icon",
  "themeColor", "enabled", "scope", "modelVisibility", "ai", "stages",
  "naturalChange", "perTurnChange", "order",
] as const;

export async function createFieldTemplateExport(
  source: MvuQuerySource,
  request: ExportFieldTemplateRequest,
  now: number,
): Promise<FieldTemplateExportPayload> {
  requireUniqueNonEmpty(request.fieldIds, "MVU_FIELD_TEMPLATE_FIELD_IDS_INVALID");
  const [snapshot, actors, groups] = await Promise.all([source.readV3(), source.listActors(), source.listGroups()]);
  const selections = new Map(request.targetSelections.map((selection) => [selection.fieldId, selection]));
  if (selections.size !== request.targetSelections.length) throw new Error("MVU_FIELD_TEMPLATE_SELECTION_DUPLICATE");
  const fields: PortableFieldEntry[] = [];
  for (const fieldId of request.fieldIds) {
    const field = snapshot.dataset.fields.find((candidate) => candidate.id === fieldId);
    if (field === undefined) throw new Error(`MVU_FIELD_TEMPLATE_FIELD_NOT_FOUND:${fieldId}`);
    requireFieldValue(field, field.initialValue, "MVU_FIELD_TEMPLATE_INITIAL_VALUE_INVALID");
    const sourceTargets: PortableSourceTarget[] = [];
    const seenTargets = new Set<string>();
    for (const selected of selections.get(fieldId)?.targets ?? []) {
      if (seenTargets.has(selected.targetId)) throw new Error("MVU_FIELD_TEMPLATE_TARGET_DUPLICATE");
      seenTargets.add(selected.targetId);
      if (!selected.enabled) {
        if (selected.includeValue) throw new Error("MVU_FIELD_TEMPLATE_DISABLED_VALUE_INVALID");
        continue;
      }
      if ((field.scope !== "character" && field.scope !== "group") || !field.bindingIds.includes(selected.targetId)) {
        throw new Error(`MVU_FIELD_TEMPLATE_TARGET_NOT_BOUND:${fieldId}:${selected.targetId}`);
      }
      const directoryEntry = field.scope === "character"
        ? actors.find((actor) => actor.characterId === selected.targetId)
        : groups.find((group) => group.characterGroupId === selected.targetId);
      if (directoryEntry === undefined) throw new Error(`MVU_FIELD_TEMPLATE_TARGET_NOT_FOUND:${selected.targetId}`);
      const target: PortableSourceTarget = {
        kind: field.scope === "character" ? "actor" : "group",
        sourceId: selected.targetId,
        name: directoryEntry.name,
        enabled: true,
      };
      if (selected.includeValue) {
        const value = snapshot.dataset.stateValues[`${field.scope}:${selected.targetId}`]?.[field.id] ?? field.initialValue;
        requireFieldValue(field, value, "MVU_FIELD_TEMPLATE_CURRENT_VALUE_INVALID");
        target.value = value;
      }
      sourceTargets.push(target);
    }
    sourceTargets.sort((left, right) => compareRaw(left.sourceId, right.sourceId));
    const { id: _id, bindingIds: _bindingIds, ...definition } = field;
    fields.push({
      sourceFieldId: field.id,
      definition,
      sourceTargets,
      dependencySummary: {
        linkRuleCount: snapshot.dataset.linkRules.filter((rule) =>
          rule.sourceFieldId === field.id || rule.targetFieldId === field.id).length,
        automationRuleCount: snapshot.dataset.rules.filter((rule) => rule.actions.some((action) =>
          action.kind === "change_field" && action.fieldId === field.id)).length,
        effectGroupCount: snapshot.dataset.effectGroups.filter((group) => group.fieldEffects.some((effect) =>
          effect.fieldId === field.id)).length,
      },
    });
  }
  fields.sort((left, right) => compareRaw(left.sourceFieldId, right.sourceFieldId));
  const exportedAt = new Date(now).toISOString();
  const document: FieldTemplateDocument = {
    format: FIELD_TEMPLATE_FORMAT,
    schemaVersion: FIELD_TEMPLATE_SCHEMA_VERSION,
    exportedAt,
    checksum: { algorithm: "fnv1a32", value: checksumFields(fields) },
    fields,
  };
  const json = JSON.stringify(document, null, 2);
  if (byteLength(json) > FIELD_TEMPLATE_MAX_BYTES) throw new Error("MVU_FIELD_TEMPLATE_TOO_LARGE");
  return {
    fileName: buildFileName(fields, exportedAt),
    json,
    summary: {
      fieldCount: fields.length,
      targetCount: fields.reduce((sum, field) => sum + field.sourceTargets.length, 0),
      valueCount: fields.reduce((sum, field) => sum + field.sourceTargets.filter((target) => target.value !== undefined).length, 0),
    },
  };
}

export async function previewFieldTemplate(
  source: MvuQuerySource,
  request: PreviewFieldTemplateImportRequest,
): Promise<FieldTemplatePreview> {
  const document = parseFieldTemplateDocument(request.json);
  const snapshot = await source.readV3();
  const occupied = new Set(snapshot.dataset.fields.map((field) => field.id));
  return {
    valid: true,
    revision: snapshot.revision,
    format: document.format,
    schemaVersion: document.schemaVersion,
    fields: document.fields.map((entry) => ({
      sourceFieldId: entry.sourceFieldId,
      name: entry.definition.name,
      scope: entry.definition.scope,
      conflict: occupied.has(entry.sourceFieldId) ? "id" : "none",
      proposedCopyId: collisionSafeCopyId(entry.sourceFieldId, occupied),
      config: {
        stages: entry.definition.stages.length,
        naturalChange: entry.definition.naturalChange.enabled,
        perTurnChange: entry.definition.perTurnChange.enabled,
        ai: entry.definition.ai.enabled,
        appearance: entry.definition.icon.length > 0 && entry.definition.themeColor.length > 0,
      },
    })),
    mappingNeeds: document.fields.filter((entry) =>
      entry.definition.scope === "character" || entry.definition.scope === "group").map((entry) => ({
      fieldId: entry.sourceFieldId,
      scope: entry.definition.scope,
      sourceTargets: entry.sourceTargets.map((target) => ({
        kind: target.kind,
        sourceId: target.sourceId,
        name: target.name,
        hasValue: target.value !== undefined,
        ...(target.value === undefined ? {} : adjustmentPreview(entry.definition, target.value)),
      })),
    })),
    invalidReferences: [],
  };
}

export async function commitFieldTemplateImport(
  source: MvuQuerySource,
  request: ImportFieldTemplateRequest,
): Promise<FieldTemplateImportResult> {
  if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) {
    throw new Error("MVU_FIELD_TEMPLATE_REVISION_INVALID");
  }
  const document = parseFieldTemplateDocument(request.json);
  const [snapshot, actors, groups, context] = await Promise.all([
    source.readV3(), source.listActors(), source.listGroups(), source.activeContext(),
  ]);
  if (snapshot.revision !== request.expectedRevision) {
    throw new Error(`MVU_STALE_REVISION:${request.expectedRevision}:${snapshot.revision}`);
  }
  const decisions = new Map(request.decisions.fields.map((decision) => [decision.sourceFieldId, decision]));
  if (decisions.size !== request.decisions.fields.length || decisions.size !== document.fields.length) {
    throw new Error("MVU_FIELD_TEMPLATE_DECISIONS_INVALID");
  }
  const draft = klona(snapshot.dataset);
  const occupied = new Set(draft.fields.map((field) => field.id));
  const summary: FieldTemplateImportResult["summary"] = {
    created: [], updated: [], replaced: [], skippedTargets: 0, valueWrites: 0,
  };
  for (const entry of document.fields) {
    const decision = decisions.get(entry.sourceFieldId);
    if (decision === undefined) throw new Error("MVU_FIELD_TEMPLATE_DECISIONS_INVALID");
    const existing = draft.fields.find((field) => field.id === entry.sourceFieldId);
    const strategy = decision.strategy ?? "create_copy";
    if (strategy === "update") {
      if (existing === undefined) throw new Error("MVU_FIELD_TEMPLATE_CONFLICT_REQUIRED");
      const bindings = [...existing.bindingIds];
      Object.assign(existing, klona(entry.definition), { id: existing.id, bindingIds: bindings });
      validateDataField(existing);
      validateExistingValues(draft.stateValues, existing);
      summary.updated.push(existing.id);
      continue;
    }
    if (strategy === "replace" && existing === undefined) throw new Error("MVU_FIELD_TEMPLATE_CONFLICT_REQUIRED");
    const fieldId = strategy === "replace"
      ? entry.sourceFieldId
      : existing === undefined ? entry.sourceFieldId : collisionSafeCopyId(entry.sourceFieldId, occupied);
    const bindings = resolveImportBindings(entry, decision, actors, groups, summary);
    const field: DataField = { ...klona(entry.definition), id: fieldId, bindingIds: bindings.ids };
    if (field.scope === "chat") {
      if (context.chatId === null || context.chatId.length === 0) throw new Error("MVU_FIELD_TEMPLATE_CURRENT_CHAT_MISSING");
      field.bindingIds = [context.chatId];
    }
    if (field.scope === "global") field.bindingIds = [];
    validateDataField(field);
    if (strategy === "replace") {
      const index = draft.fields.findIndex((candidate) => candidate.id === fieldId);
      draft.fields[index] = field;
      removeFieldValues(draft.stateValues, fieldId);
      summary.replaced.push(fieldId);
    } else {
      draft.fields.push(field);
      occupied.add(fieldId);
      summary.created.push(fieldId);
    }
    for (const write of bindings.writes) {
      const sourceTarget = entry.sourceTargets.find((target) => target.sourceId === write.sourceTargetId)!;
      const scopeKey = `${field.scope}:${write.targetId}`;
      const existingValue = snapshot.dataset.stateValues[scopeKey]?.[entry.sourceFieldId];
      const value = write.valuePolicy === "template_value"
        ? sourceTarget.value === undefined ? undefined : normalizeTemplateValue(field, sourceTarget.value).value
        : write.valuePolicy === "keep_existing" ? existingValue ?? field.initialValue : field.initialValue;
      if (value === undefined) throw new Error("MVU_FIELD_TEMPLATE_VALUE_MISSING");
      requireFieldValue(field, value, "MVU_FIELD_TEMPLATE_VALUE_INVALID");
      draft.stateValues[scopeKey] ??= {};
      draft.stateValues[scopeKey][fieldId] = value;
      summary.valueWrites += 1;
    }
  }
  const committed = await source.transactV3(request.expectedRevision, draft, []);
  return { revision: committed.revision, summary };
}

function resolveImportBindings(
  entry: PortableFieldEntry,
  decision: FieldTemplateImportFieldDecision,
  actors: Awaited<ReturnType<MvuQuerySource["listActors"]>>,
  groups: Awaited<ReturnType<MvuQuerySource["listGroups"]>>,
  summary: FieldTemplateImportResult["summary"],
): { ids: string[]; writes: Array<FieldTemplateImportTargetDecision & { sourceTargetId: string }> } {
  if (entry.definition.scope !== "character" && entry.definition.scope !== "group") {
    if (decision.mappings.length > 0) throw new Error("MVU_FIELD_TEMPLATE_MAPPING_SCOPE_INVALID");
    return { ids: [], writes: [] };
  }
  const mappings = new Map(decision.mappings.map((mapping) => [mapping.sourceTargetId, mapping]));
  if (mappings.size !== decision.mappings.length || mappings.size !== entry.sourceTargets.length ||
    entry.sourceTargets.some((target) => !mappings.has(target.sourceId))) {
    throw new Error("MVU_FIELD_TEMPLATE_MAPPING_MISSING");
  }
  const ids: string[] = [];
  const writes: Array<FieldTemplateImportTargetDecision & { sourceTargetId: string }> = [];
  const seen = new Set<string>();
  for (const sourceTarget of entry.sourceTargets) {
    const mapping = mappings.get(sourceTarget.sourceId)!;
    const localTargets = new Set<string>();
    for (const target of mapping.targets) {
      if (localTargets.has(target.targetId) || seen.has(target.targetId)) throw new Error("MVU_FIELD_TEMPLATE_MAPPING_DUPLICATE");
      localTargets.add(target.targetId);
      seen.add(target.targetId);
      const exists = entry.definition.scope === "character"
        ? actors.some((actor) => actor.characterId === target.targetId)
        : groups.some((group) => group.characterGroupId === target.targetId);
      if (!exists) throw new Error(`MVU_FIELD_TEMPLATE_MAPPING_TARGET_INVALID:${target.targetId}`);
      if (!target.enabled) {
        summary.skippedTargets += 1;
        continue;
      }
      ids.push(target.targetId);
      writes.push({ ...target, sourceTargetId: sourceTarget.sourceId });
    }
  }
  return { ids: [...ids].sort(compareRaw), writes };
}

function validateExistingValues(stateValues: Record<string, Record<string, number>>, field: DataField): void {
  for (const values of Object.values(stateValues)) {
    if (values[field.id] !== undefined) requireFieldValue(field, values[field.id], "MVU_FIELD_TEMPLATE_EXISTING_VALUE_INVALID");
  }
}

function removeFieldValues(stateValues: Record<string, Record<string, number>>, fieldId: string): void {
  for (const values of Object.values(stateValues)) delete values[fieldId];
}

function parseFieldTemplateDocument(json: string): FieldTemplateDocument {
  if (typeof json !== "string" || byteLength(json) > FIELD_TEMPLATE_MAX_BYTES) throw new Error("MVU_FIELD_TEMPLATE_TOO_LARGE");
  const document = requireRecord(JSON.parse(json), "MVU_FIELD_TEMPLATE_INVALID");
  assertExactKeys(document, ["format", "schemaVersion", "exportedAt", "checksum", "fields"]);
  if (document.format !== FIELD_TEMPLATE_FORMAT || document.schemaVersion !== FIELD_TEMPLATE_SCHEMA_VERSION ||
    typeof document.exportedAt !== "string" || !Number.isFinite(Date.parse(document.exportedAt)) ||
    !Array.isArray(document.fields) || document.fields.length === 0 || document.fields.length > FIELD_TEMPLATE_MAX_FIELDS) {
    throw new Error("MVU_FIELD_TEMPLATE_INVALID");
  }
  const checksum = requireRecord(document.checksum, "MVU_FIELD_TEMPLATE_CHECKSUM_INVALID");
  assertExactKeys(checksum, ["algorithm", "value"]);
  if (checksum.algorithm !== "fnv1a32" || typeof checksum.value !== "string") throw new Error("MVU_FIELD_TEMPLATE_CHECKSUM_INVALID");
  const fields = document.fields.map(parsePortableField);
  requireUniqueNonEmpty(fields.map((field) => field.sourceFieldId), "MVU_FIELD_TEMPLATE_FIELD_IDS_INVALID");
  if (checksum.value !== checksumFields(fields)) throw new Error("MVU_FIELD_TEMPLATE_CHECKSUM_MISMATCH");
  return {
    format: FIELD_TEMPLATE_FORMAT,
    schemaVersion: FIELD_TEMPLATE_SCHEMA_VERSION,
    exportedAt: document.exportedAt,
    checksum: { algorithm: "fnv1a32", value: checksum.value },
    fields,
  };
}

function parsePortableField(value: unknown): PortableFieldEntry {
  const field = requireRecord(value, "MVU_FIELD_TEMPLATE_FIELD_INVALID");
  assertExactKeys(field, ["sourceFieldId", "definition", "sourceTargets", "dependencySummary"]);
  if (typeof field.sourceFieldId !== "string" || field.sourceFieldId.length > FIELD_TEMPLATE_MAX_ID_LENGTH ||
    !Array.isArray(field.sourceTargets)) throw new Error("MVU_FIELD_TEMPLATE_FIELD_INVALID");
  const definition = requireRecord(field.definition, "MVU_FIELD_TEMPLATE_DEFINITION_INVALID");
  assertExactKeys(definition, PORTABLE_DEFINITION_KEYS);
  assertPortableDefinitionShape(definition);
  const targets = field.sourceTargets.map(parsePortableTarget);
  if (targets.length > FIELD_TEMPLATE_MAX_TARGETS_PER_FIELD) throw new Error("MVU_FIELD_TEMPLATE_TARGET_LIMIT");
  if (targets.length > 0) requireUniqueNonEmpty(targets.map((target) => target.sourceId), "MVU_FIELD_TEMPLATE_TARGET_DUPLICATE");
  const dependencySummary = requireRecord(field.dependencySummary, "MVU_FIELD_TEMPLATE_DEPENDENCIES_INVALID");
  assertExactKeys(dependencySummary, ["linkRuleCount", "automationRuleCount", "effectGroupCount"]);
  if (Object.values(dependencySummary).some((count) => !Number.isSafeInteger(count) || (count as number) < 0)) {
    throw new Error("MVU_FIELD_TEMPLATE_DEPENDENCIES_INVALID");
  }
  const validated = { ...definition, id: field.sourceFieldId, bindingIds: targets.map((target) => target.sourceId) } as DataField;
  validateDataField(validated);
  requireFieldValue(validated, validated.initialValue, "MVU_FIELD_TEMPLATE_INITIAL_VALUE_INVALID");
  for (const target of targets) {
    if ((validated.scope === "character" && target.kind !== "actor") ||
      (validated.scope === "group" && target.kind !== "group") ||
      (validated.scope !== "character" && validated.scope !== "group")) throw new Error("MVU_FIELD_TEMPLATE_TARGET_SCOPE_INVALID");
    if (target.value !== undefined && !Number.isFinite(target.value)) throw new Error("MVU_FIELD_TEMPLATE_VALUE_INVALID");
  }
  return {
    sourceFieldId: field.sourceFieldId,
    definition: definition as unknown as PortableFieldDefinition,
    sourceTargets: targets,
    dependencySummary: dependencySummary as unknown as PortableFieldEntry["dependencySummary"],
  };
}

function parsePortableTarget(value: unknown): PortableSourceTarget {
  const target = requireRecord(value, "MVU_FIELD_TEMPLATE_TARGET_INVALID");
  assertExactKeys(target, target.value === undefined
    ? ["kind", "sourceId", "name", "enabled"]
    : ["kind", "sourceId", "name", "enabled", "value"]);
  if ((target.kind !== "actor" && target.kind !== "group") || typeof target.sourceId !== "string" ||
    target.sourceId.length === 0 || target.sourceId.length > FIELD_TEMPLATE_MAX_ID_LENGTH ||
    typeof target.name !== "string" || target.name.trim().length === 0 ||
    target.name.length > FIELD_TEMPLATE_MAX_NAME_LENGTH ||
    target.enabled !== true || (target.value !== undefined &&
      (typeof target.value !== "number" || !Number.isFinite(target.value)))) {
    if (typeof target.name === "string" && target.name.length > FIELD_TEMPLATE_MAX_NAME_LENGTH) {
      throw new Error("MVU_FIELD_TEMPLATE_TEXT_LIMIT");
    }
    throw new Error("MVU_FIELD_TEMPLATE_TARGET_INVALID");
  }
  return target as unknown as PortableSourceTarget;
}

function checksumFields(fields: PortableFieldEntry[]): string {
  const input = JSON.stringify(fields);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function collisionSafeCopyId(sourceId: string, occupied: Set<string>): string {
  const copySuffix = "_copy";
  const base = `${sourceId.slice(0, FIELD_TEMPLATE_MAX_ID_LENGTH - copySuffix.length)}${copySuffix}`;
  if (!occupied.has(base)) return base;
  for (let suffix = 2; suffix <= 10_000; suffix += 1) {
    const numberedSuffix = `_copy_${suffix}`;
    const candidate = `${sourceId.slice(0, FIELD_TEMPLATE_MAX_ID_LENGTH - numberedSuffix.length)}${numberedSuffix}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error("MVU_FIELD_TEMPLATE_ID_EXHAUSTED");
}

function buildFileName(fields: PortableFieldEntry[], exportedAt: string): string {
  const label = fields.length === 1
    ? fields[0].definition.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "field"
    : `${fields.length}-fields`;
  const timestamp = exportedAt.replace(/[-:]/g, "").replace("T", "-").replace(/\.\d{3}Z$/, "Z");
  return `operit-mvu-field-template-${label.slice(0, 48)}-${timestamp}.json`;
}

function assertPortableDefinitionShape(definition: Record<string, unknown>): void {
  const textFields: Array<[unknown, number]> = [
    [definition.name, FIELD_TEMPLATE_MAX_NAME_LENGTH],
    [definition.description, FIELD_TEMPLATE_MAX_DESCRIPTION_LENGTH],
    [definition.icon, FIELD_TEMPLATE_MAX_NAME_LENGTH],
    [definition.themeColor, FIELD_TEMPLATE_MAX_NAME_LENGTH],
  ];
  if (textFields.some(([value, limit]) => typeof value !== "string" || value.length > limit)) {
    throw new Error("MVU_FIELD_TEMPLATE_TEXT_LIMIT");
  }
  const ai = requireRecord(definition.ai, "MVU_FIELD_TEMPLATE_DEFINITION_INVALID");
  assertExactKeys(ai, ["enabled", "minConfidence", "maxDelta", "prompt"]);
  if (typeof ai.prompt !== "string" || ai.prompt.length > FIELD_TEMPLATE_MAX_DESCRIPTION_LENGTH) {
    throw new Error("MVU_FIELD_TEMPLATE_TEXT_LIMIT");
  }
  const natural = requireRecord(definition.naturalChange, "MVU_FIELD_TEMPLATE_DEFINITION_INVALID");
  assertExactKeys(natural, ["enabled", "unitMs", "amount"]);
  const perTurn = requireRecord(definition.perTurnChange, "MVU_FIELD_TEMPLATE_DEFINITION_INVALID");
  assertExactKeys(perTurn, ["enabled", "intervalTurns", "amount", "countMode"]);
  if (!Array.isArray(definition.stages) || definition.stages.length > FIELD_TEMPLATE_MAX_STAGES_PER_FIELD) {
    throw new Error("MVU_FIELD_TEMPLATE_STAGE_LIMIT");
  }
  for (const value of definition.stages) {
    const stage = requireRecord(value, "MVU_FIELD_TEMPLATE_DEFINITION_INVALID");
    assertExactKeys(stage, ["id", "name", "description", "threshold"]);
    if (typeof stage.id !== "string" || stage.id.length > FIELD_TEMPLATE_MAX_ID_LENGTH ||
      typeof stage.name !== "string" || stage.name.length > FIELD_TEMPLATE_MAX_NAME_LENGTH ||
      typeof stage.description !== "string" || stage.description.length > FIELD_TEMPLATE_MAX_DESCRIPTION_LENGTH) {
      throw new Error("MVU_FIELD_TEMPLATE_TEXT_LIMIT");
    }
  }
}

function adjustmentPreview(
  field: PortableFieldDefinition,
  value: number,
): { valueAdjustment?: { from: number; to: number; reason: "clamp" | "step" } } {
  const normalized = normalizeTemplateValue(field as DataField, value);
  return normalized.adjustment === undefined ? {} : { valueAdjustment: normalized.adjustment };
}

function normalizeTemplateValue(
  field: Pick<DataField, "minimum" | "maximum" | "step">,
  value: number,
): { value: number; adjustment?: { from: number; to: number; reason: "clamp" | "step" } } {
  if (!Number.isFinite(value)) throw new Error("MVU_FIELD_TEMPLATE_VALUE_INVALID");
  const clamped = Math.min(field.maximum, Math.max(field.minimum, value));
  const stepped = field.minimum + Math.round((clamped - field.minimum) / field.step) * field.step;
  const normalized = Math.min(field.maximum, Math.max(field.minimum, Number(stepped.toPrecision(15))));
  if (Math.abs(normalized - value) <= 1e-7) return { value: normalized };
  return {
    value: normalized,
    adjustment: {
      from: value,
      to: normalized,
      reason: value < field.minimum || value > field.maximum ? "clamp" : "step",
    },
  };
}

function requireFieldValue(field: DataField, value: number, code: string): void {
  if (!Number.isFinite(value) || value < field.minimum || value > field.maximum) throw new Error(code);
  const steps = (value - field.minimum) / field.step;
  if (Math.abs(steps - Math.round(steps)) > 1e-7) throw new Error(code);
}

function requireUniqueNonEmpty(values: string[], code: string): void {
  if (values.length === 0 || values.some((value) => typeof value !== "string" || value.length === 0) ||
    new Set(values).size !== values.length) throw new Error(code);
}

function requireRecord(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new Error(code);
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error("MVU_FIELD_TEMPLATE_UNKNOWN_KEYS");
  }
}

function compareRaw(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function byteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index)!;
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else {
      bytes += 4;
      index += 1;
    }
  }
  return bytes;
}
