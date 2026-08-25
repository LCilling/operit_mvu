/** Strict typed IPC contract shared by the ToolPkg main runtime and WebView container. */
import type { MvuRuntime } from "../mvu/app/index";
import type {
  AutoRuleCondition,
  DataActor,
  DataAutoRule,
  DataChangeRecord,
  DataField,
  DataLinkRule,
  DataTemporaryEffect,
  MvuSettings,
  StateScopeContext,
} from "../mvu/app/model";
import type { PersistedAiChange } from "../mvu/app/service";
import {
  FIELD_TEMPLATE_MAX_BYTES,
  FIELD_TEMPLATE_MAX_FIELDS,
  FIELD_TEMPLATE_MAX_ID_LENGTH,
  FIELD_TEMPLATE_MAX_TARGETS_PER_FIELD,
  type ExportFieldTemplateRequest,
  type FieldTemplateExportSummary,
  type FieldTemplateImportResult,
  type FieldTemplatePreview,
  type ImportFieldTemplateRequest,
  type PreviewFieldTemplateImportRequest,
} from "../mvu/app/field-template";
import {
  QUERY_CURSOR_MAX_LENGTH,
  QUERY_SEARCH_MAX_LENGTH,
  type ConditionInput,
  type ConditionPatch,
  type DeleteMutationResponse,
  type EffectGroupInput,
  type EffectGroupPatch,
  type EntityReferenceSummary,
  type FieldQueryItem,
  type GetEntityByIdRequest,
  type MvuCompactPageSnapshot,
  type MvuQueryService,
  type MutationResponse,
  type QueryGroup,
  type QueryRequest,
  type QueryResponse,
  type ReferenceQueryRequest,
  type RevisionedIdRequest,
  type RuleInput,
  type RulePatch,
} from "../mvu/app/query";
import type {
  ConditionDefinition,
  ConditionExpression,
  ConditionPredicate,
  ChangeSource,
  EffectActorSelector,
  EffectDuration,
  EffectGroupDefinition,
  EffectReasonConfig,
  EffectOperation,
  FieldEffectDefinition,
  RuleActionV3,
  RuleActorSelector,
  RuleDefinitionV3,
  RuleTargetSelector,
} from "../mvu/app/model-v3";
import {
  EFFECT_REASON_LEGACY_STORAGE_MAX_LENGTH,
  EFFECT_REASON_SOURCE_MAX_LENGTH,
} from "../mvu/app/model-v3";
import type {
  BackgroundModelProbeResult,
  SystemModelApi,
} from "../mvu/app/system-model";
import { normalizeMvuDataset } from "../mvu/app/validation";

export const MVU_TOOLPKG_ID = "com.lcilling.operit_mvu";
export const MVU_IPC_TARGET_CONTEXT_KEY = `toolpkg_main:${MVU_TOOLPKG_ID}`;

const MAIN_TARGET: ToolPkg.IpcCallOptions = {
  targetRuntime: "main",
  targetContextKey: MVU_IPC_TARGET_CONTEXT_KEY,
};

export const MVU_IPC = {
  snapshot: "operit_mvu:snapshot",
  setStateValue: "operit_mvu:set_state_value",
  addField: "operit_mvu:add_field",
  updateField: "operit_mvu:update_field",
  deleteField: "operit_mvu:delete_field",
  settleNatural: "operit_mvu:settle_natural",
  addLinkRule: "operit_mvu:add_link_rule",
  updateLinkRule: "operit_mvu:update_link_rule",
  deleteLinkRule: "operit_mvu:delete_link_rule",
  addAutoRule: "operit_mvu:add_auto_rule",
  updateAutoRule: "operit_mvu:update_auto_rule",
  deleteAutoRule: "operit_mvu:delete_auto_rule",
  updateSettings: "operit_mvu:update_settings",
  probeModel: "operit_mvu:probe_model",
  judgeState: "operit_mvu:judge_state",
  exportDataset: "operit_mvu:export_dataset",
  importDataset: "operit_mvu:import_dataset",
  exportFieldTemplate: "operit_mvu:export_field_template",
  previewFieldTemplateImport: "operit_mvu:preview_field_template_import",
  importFieldTemplate: "operit_mvu:import_field_template",
  addTemporaryEffect: "operit_mvu:add_temporary_effect",
  updateTemporaryEffect: "operit_mvu:update_temporary_effect",
  deleteTemporaryEffect: "operit_mvu:delete_temporary_effect",
  queryFields: "operit_mvu:query_fields",
  queryActors: "operit_mvu:query_actors",
  queryGroups: "operit_mvu:query_groups",
  queryRules: "operit_mvu:query_rules_v3",
  queryConditions: "operit_mvu:query_conditions",
  queryEffectGroups: "operit_mvu:query_effect_groups",
  queryRecords: "operit_mvu:query_records",
  getEntityById: "operit_mvu:get_entity_by_id",
  createCondition: "operit_mvu:create_condition",
  updateCondition: "operit_mvu:update_condition",
  copyCondition: "operit_mvu:copy_condition",
  toggleCondition: "operit_mvu:toggle_condition",
  deleteCondition: "operit_mvu:delete_condition",
  getConditionReferences: "operit_mvu:get_condition_references",
  createEffectGroup: "operit_mvu:create_effect_group",
  updateEffectGroup: "operit_mvu:update_effect_group",
  copyEffectGroup: "operit_mvu:copy_effect_group",
  toggleEffectGroup: "operit_mvu:toggle_effect_group",
  deleteEffectGroup: "operit_mvu:delete_effect_group",
  getEffectGroupReferences: "operit_mvu:get_effect_group_references",
  createRule: "operit_mvu:create_rule_v3",
  updateRule: "operit_mvu:update_rule_v3",
  copyRule: "operit_mvu:copy_rule_v3",
  toggleRule: "operit_mvu:toggle_rule_v3",
  deleteRule: "operit_mvu:delete_rule_v3",
  getRuleReferences: "operit_mvu:get_rule_references",
} as const;

export type EmptyRequest = Record<string, never>;
export interface SnapshotRequest { actorId?: string; groupId?: string; }
export type MvuPageSnapshot = MvuCompactPageSnapshot;
export type FieldInput = Omit<DataField, "id" | "order">;
export type FieldPatch = Partial<Omit<DataField, "id">>;
export type LinkRuleInput = Omit<DataLinkRule, "id">;
export type LinkRulePatch = Partial<Omit<DataLinkRule, "id">>;
export type AutoRuleInput = Omit<DataAutoRule, "id">;
export type AutoRulePatch = Partial<Omit<DataAutoRule, "id">>;
export type TemporaryEffectInput = Omit<DataTemporaryEffect, "id">;
export type TemporaryEffectPatch = Partial<Omit<DataTemporaryEffect, "id">>;
export type SettingsPatch = Partial<MvuSettings>;

export interface SetStateValueRequest {
  scopeContext: StateScopeContext;
  fieldId: string;
  value: number;
  reason: string;
}

export interface AddFieldRequest { field: FieldInput; }
export interface UpdateFieldRequest { id: string; patch: FieldPatch; }
export interface IdRequest { id: string; }
export interface ScopeContextRequest { scopeContext: StateScopeContext; }
export interface AddLinkRuleRequest { rule: LinkRuleInput; }
export interface UpdateLinkRuleRequest { id: string; patch: LinkRulePatch; }
export interface AddAutoRuleRequest { rule: AutoRuleInput; }
export interface UpdateAutoRuleRequest { id: string; patch: AutoRulePatch; }
export interface UpdateSettingsRequest { patch: SettingsPatch; }

export interface JudgeStateRequest {
  scopeContext: StateScopeContext;
  message: string;
  commit: boolean;
}

export interface JudgeStateResponse {
  available: boolean;
  applied: boolean;
  changes: PersistedAiChange[];
  raw: string;
}

export interface ExportDatasetResponse {
  fileName: string;
  savedPath: string;
}

export interface ExportFieldTemplateResponse {
  fileName: string;
  savedPath: string;
  summary: FieldTemplateExportSummary;
}

export interface ImportDatasetRequest { json: string; }
export interface AddTemporaryEffectRequest { effect: TemporaryEffectInput; }
export interface UpdateTemporaryEffectRequest { id: string; patch: TemporaryEffectPatch; }
export interface CreateConditionRequest { expectedRevision: number; condition: ConditionInput; }
export interface UpdateConditionRequest extends RevisionedIdRequest { patch: ConditionPatch; }
export interface CreateEffectGroupRequest { expectedRevision: number; effectGroup: EffectGroupInput; }
export interface UpdateEffectGroupRequest extends RevisionedIdRequest { patch: EffectGroupPatch; }
export interface CreateRuleRequest { expectedRevision: number; rule: RuleInput; }
export interface UpdateRuleRequest extends RevisionedIdRequest { patch: RulePatch; }
export interface ToggleEntityRequest extends RevisionedIdRequest { enabled: boolean; }

export interface MvuIpcDependencies {
  snapshot(request: SnapshotRequest): Promise<MvuPageSnapshot>;
  systemModel: SystemModelApi;
  queries: MvuQueryService;
}

type UnknownRecord = Record<string, unknown>;

const MVU_EXPORT_DIRECTORY = "/sdcard/Download/Operit/exports";

interface FileOperationResult {
  successful: boolean;
  details: string;
}

function requireSuccessfulFileOperation(
  operation: string,
  result: FileOperationResult
): void {
  if (!result.successful) {
    throw new Error(`MVU_EXPORT_${operation}_FAILED:${result.details}`);
  }
}

function buildExportFileName(now: Date): string {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").replace(/\.\d{3}Z$/, "Z");
  return `operit_mvu-dataset-v2-${timestamp}.json`;
}

function fail(code: string): never {
  throw new Error(code);
}

function isUnknownRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireRecord(value: unknown, code: string): UnknownRecord {
  if (!isUnknownRecord(value)) fail(code);
  return value;
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function assertKeys(
  record: UnknownRecord,
  required: readonly string[],
  optional: readonly string[],
  code: string
): void {
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(record).some((key) => !allowed.has(key)) ||
      required.some((key) => !hasOwn(record, key))) {
    fail(code);
  }
}

function requireString(record: UnknownRecord, key: string, code: string): string {
  const value = record[key];
  if (typeof value !== "string") fail(code);
  return value;
}

function requireNonEmptyString(record: UnknownRecord, key: string, code: string): string {
  const value = requireString(record, key, code);
  if (value.length === 0) fail(code);
  return value;
}

function requireBoolean(record: UnknownRecord, key: string, code: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") fail(code);
  return value;
}

function requireNumber(record: UnknownRecord, key: string, code: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) fail(code);
  return value;
}

function requireNullableNumber(record: UnknownRecord, key: string, code: string): number | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) fail(code);
  return value;
}

function requireNullableString(record: UnknownRecord, key: string, code: string): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string") fail(code);
  return value;
}

function requireEnum<TValue extends string>(
  record: UnknownRecord,
  key: string,
  values: readonly TValue[],
  code: string
): TValue {
  const value = record[key];
  if (typeof value !== "string") fail(code);
  const matched = values.find((candidate) => candidate === value);
  if (matched === undefined) fail(code);
  return matched;
}

function requireStringArray(value: unknown, code: string): string[] {
  if (!Array.isArray(value)) fail(code);
  return value.map((entry) => {
    if (typeof entry !== "string") fail(code);
    return entry;
  });
}

function parseEmptyRequest(value: unknown): EmptyRequest {
  const record = requireRecord(value, "MVU_EMPTY_REQUEST_INVALID");
  assertKeys(record, [], [], "MVU_EMPTY_REQUEST_INVALID");
  return {};
}

function parseSnapshotRequest(value: unknown): SnapshotRequest {
  const record = requireRecord(value, "MVU_SNAPSHOT_REQUEST_INVALID");
  assertKeys(record, [], ["actorId", "groupId"], "MVU_SNAPSHOT_REQUEST_INVALID");
  const request: SnapshotRequest = {};
  if (hasOwn(record, "actorId")) {
    request.actorId = requireNonEmptyString(record, "actorId", "MVU_SNAPSHOT_ACTOR_ID_INVALID");
  }
  if (hasOwn(record, "groupId")) {
    request.groupId = requireNonEmptyString(record, "groupId", "MVU_SNAPSHOT_GROUP_ID_INVALID");
  }
  return request;
}

function parseScopeContext(value: unknown): StateScopeContext {
  const record = requireRecord(value, "MVU_SCOPE_CONTEXT_INVALID");
  assertKeys(record, ["chatId", "actorId", "groupId", "actorName"], [], "MVU_SCOPE_CONTEXT_INVALID");
  return {
    chatId: requireNullableString(record, "chatId", "MVU_SCOPE_CONTEXT_CHAT_INVALID"),
    actorId: requireNullableString(record, "actorId", "MVU_SCOPE_CONTEXT_ACTOR_INVALID"),
    groupId: requireNullableString(record, "groupId", "MVU_SCOPE_CONTEXT_GROUP_INVALID"),
    actorName: requireString(record, "actorName", "MVU_SCOPE_CONTEXT_ACTOR_NAME_INVALID"),
  };
}

function parseStage(value: unknown): DataField["stages"][number] {
  const record = requireRecord(value, "MVU_STAGE_INPUT_INVALID");
  assertKeys(record, ["id", "name", "description", "threshold"], [], "MVU_STAGE_INPUT_INVALID");
  return {
    id: requireNonEmptyString(record, "id", "MVU_STAGE_ID_REQUIRED"),
    name: requireString(record, "name", "MVU_STAGE_NAME_REQUIRED"),
    description: requireString(record, "description", "MVU_STAGE_DESCRIPTION_REQUIRED"),
    threshold: requireNumber(record, "threshold", "MVU_STAGE_THRESHOLD_REQUIRED"),
  };
}

function parseStages(value: unknown): DataField["stages"] {
  if (!Array.isArray(value)) fail("MVU_FIELD_STAGES_INVALID");
  return value.map(parseStage);
}

function parseFieldAi(value: unknown): DataField["ai"] {
  const record = requireRecord(value, "MVU_FIELD_AI_INVALID");
  assertKeys(record, ["enabled", "minConfidence", "maxDelta", "prompt"], [], "MVU_FIELD_AI_INVALID");
  return {
    enabled: requireBoolean(record, "enabled", "MVU_FIELD_AI_ENABLED_REQUIRED"),
    minConfidence: requireNumber(record, "minConfidence", "MVU_FIELD_AI_CONFIDENCE_REQUIRED"),
    maxDelta: requireNumber(record, "maxDelta", "MVU_FIELD_AI_MAX_DELTA_REQUIRED"),
    prompt: requireString(record, "prompt", "MVU_FIELD_AI_PROMPT_REQUIRED"),
  };
}

function parseNaturalChange(value: unknown): DataField["naturalChange"] {
  const record = requireRecord(value, "MVU_FIELD_NATURAL_INVALID");
  assertKeys(record, ["enabled", "unitMs", "amount"], [], "MVU_FIELD_NATURAL_INVALID");
  return {
    enabled: requireBoolean(record, "enabled", "MVU_FIELD_NATURAL_ENABLED_REQUIRED"),
    unitMs: requireNumber(record, "unitMs", "MVU_FIELD_NATURAL_UNIT_REQUIRED"),
    amount: requireNumber(record, "amount", "MVU_FIELD_NATURAL_AMOUNT_REQUIRED"),
  };
}

function parsePerTurnChange(value: unknown): DataField["perTurnChange"] {
  const record = requireRecord(value, "MVU_FIELD_PER_TURN_INVALID");
  assertKeys(record, ["enabled", "intervalTurns", "amount", "countMode"], [], "MVU_FIELD_PER_TURN_INVALID");
  return {
    enabled: requireBoolean(record, "enabled", "MVU_FIELD_PER_TURN_ENABLED_REQUIRED"),
    intervalTurns: requireNumber(record, "intervalTurns", "MVU_FIELD_PER_TURN_INTERVAL_REQUIRED"),
    amount: requireNumber(record, "amount", "MVU_FIELD_PER_TURN_AMOUNT_REQUIRED"),
    countMode: requireEnum(record, "countMode", ["user", "character", "both"] as const, "MVU_FIELD_PER_TURN_MODE_REQUIRED"),
  };
}

const FIELD_INPUT_KEYS = [
  "name", "description", "minimum", "maximum", "step", "initialValue", "icon",
  "themeColor", "enabled", "scope", "modelVisibility", "ai", "stages", "bindingIds",
  "naturalChange", "perTurnChange",
] as const;

function parseFieldInput(value: unknown): FieldInput {
  const record = requireRecord(value, "MVU_FIELD_INPUT_INVALID");
  assertKeys(record, FIELD_INPUT_KEYS, [], "MVU_FIELD_INPUT_INVALID");
  return {
    name: requireString(record, "name", "MVU_FIELD_NAME_REQUIRED"),
    description: requireString(record, "description", "MVU_FIELD_DESCRIPTION_REQUIRED"),
    minimum: requireNumber(record, "minimum", "MVU_FIELD_MINIMUM_REQUIRED"),
    maximum: requireNumber(record, "maximum", "MVU_FIELD_MAXIMUM_REQUIRED"),
    step: requireNumber(record, "step", "MVU_FIELD_STEP_REQUIRED"),
    initialValue: requireNumber(record, "initialValue", "MVU_FIELD_INITIAL_REQUIRED"),
    icon: requireString(record, "icon", "MVU_FIELD_ICON_REQUIRED"),
    themeColor: requireString(record, "themeColor", "MVU_FIELD_THEME_REQUIRED"),
    enabled: requireBoolean(record, "enabled", "MVU_FIELD_ENABLED_REQUIRED"),
    scope: requireEnum(record, "scope", ["character", "group", "global", "chat"] as const, "MVU_FIELD_SCOPE_REQUIRED"),
    modelVisibility: requireEnum(record, "modelVisibility", ["full", "stage_only", "hidden"] as const, "MVU_FIELD_MODEL_VISIBILITY_REQUIRED"),
    ai: parseFieldAi(record.ai),
    stages: parseStages(record.stages),
    bindingIds: requireStringArray(record.bindingIds, "MVU_FIELD_BINDINGS_REQUIRED"),
    naturalChange: parseNaturalChange(record.naturalChange),
    perTurnChange: parsePerTurnChange(record.perTurnChange),
  };
}

function parseFieldPatch(value: unknown): FieldPatch {
  const record = requireRecord(value, "MVU_FIELD_PATCH_INVALID");
  assertKeys(record, [], [...FIELD_INPUT_KEYS, "order"], "MVU_FIELD_PATCH_INVALID");
  const patch: FieldPatch = {};
  if (hasOwn(record, "name")) patch.name = requireString(record, "name", "MVU_FIELD_NAME_REQUIRED");
  if (hasOwn(record, "description")) patch.description = requireString(record, "description", "MVU_FIELD_DESCRIPTION_REQUIRED");
  if (hasOwn(record, "minimum")) patch.minimum = requireNumber(record, "minimum", "MVU_FIELD_MINIMUM_REQUIRED");
  if (hasOwn(record, "maximum")) patch.maximum = requireNumber(record, "maximum", "MVU_FIELD_MAXIMUM_REQUIRED");
  if (hasOwn(record, "step")) patch.step = requireNumber(record, "step", "MVU_FIELD_STEP_REQUIRED");
  if (hasOwn(record, "initialValue")) patch.initialValue = requireNumber(record, "initialValue", "MVU_FIELD_INITIAL_REQUIRED");
  if (hasOwn(record, "icon")) patch.icon = requireString(record, "icon", "MVU_FIELD_ICON_REQUIRED");
  if (hasOwn(record, "themeColor")) patch.themeColor = requireString(record, "themeColor", "MVU_FIELD_THEME_REQUIRED");
  if (hasOwn(record, "enabled")) patch.enabled = requireBoolean(record, "enabled", "MVU_FIELD_ENABLED_REQUIRED");
  if (hasOwn(record, "scope")) patch.scope = requireEnum(record, "scope", ["character", "group", "global", "chat"] as const, "MVU_FIELD_SCOPE_REQUIRED");
  if (hasOwn(record, "modelVisibility")) patch.modelVisibility = requireEnum(record, "modelVisibility", ["full", "stage_only", "hidden"] as const, "MVU_FIELD_MODEL_VISIBILITY_REQUIRED");
  if (hasOwn(record, "ai")) patch.ai = parseFieldAi(record.ai);
  if (hasOwn(record, "stages")) patch.stages = parseStages(record.stages);
  if (hasOwn(record, "bindingIds")) patch.bindingIds = requireStringArray(record.bindingIds, "MVU_FIELD_BINDINGS_REQUIRED");
  if (hasOwn(record, "naturalChange")) patch.naturalChange = parseNaturalChange(record.naturalChange);
  if (hasOwn(record, "perTurnChange")) patch.perTurnChange = parsePerTurnChange(record.perTurnChange);
  if (hasOwn(record, "order")) patch.order = requireNumber(record, "order", "MVU_FIELD_ORDER_REQUIRED");
  return patch;
}

function parseLinkEffect(value: unknown): DataLinkRule["effect"] {
  const record = requireRecord(value, "MVU_LINK_EFFECT_INVALID");
  assertKeys(record, ["kind", "value"], [], "MVU_LINK_EFFECT_INVALID");
  const kind = requireEnum(record, "kind", ["multiplier", "delta"] as const, "MVU_LINK_EFFECT_KIND_REQUIRED");
  const effectValue = requireNumber(record, "value", "MVU_LINK_EFFECT_VALUE_REQUIRED");
  return kind === "multiplier"
    ? { kind: "multiplier", value: effectValue }
    : { kind: "delta", value: effectValue };
}

const LINK_RULE_KEYS = [
  "sourceFieldId", "operator", "sourceThreshold", "targetFieldId", "effect", "enabled",
] as const;

function parseLinkRuleInput(value: unknown): LinkRuleInput {
  const record = requireRecord(value, "MVU_LINK_RULE_INPUT_INVALID");
  assertKeys(record, LINK_RULE_KEYS, [], "MVU_LINK_RULE_INPUT_INVALID");
  return {
    sourceFieldId: requireNonEmptyString(record, "sourceFieldId", "MVU_LINK_SOURCE_REQUIRED"),
    operator: requireEnum(record, "operator", [">=", ">", "<=", "<", "=="] as const, "MVU_LINK_OPERATOR_REQUIRED"),
    sourceThreshold: requireNumber(record, "sourceThreshold", "MVU_LINK_THRESHOLD_REQUIRED"),
    targetFieldId: requireNonEmptyString(record, "targetFieldId", "MVU_LINK_TARGET_REQUIRED"),
    effect: parseLinkEffect(record.effect),
    enabled: requireBoolean(record, "enabled", "MVU_LINK_ENABLED_REQUIRED"),
  };
}

function parseLinkRulePatch(value: unknown): LinkRulePatch {
  const record = requireRecord(value, "MVU_LINK_RULE_PATCH_INVALID");
  assertKeys(record, [], LINK_RULE_KEYS, "MVU_LINK_RULE_PATCH_INVALID");
  const patch: LinkRulePatch = {};
  if (hasOwn(record, "sourceFieldId")) patch.sourceFieldId = requireNonEmptyString(record, "sourceFieldId", "MVU_LINK_SOURCE_REQUIRED");
  if (hasOwn(record, "operator")) patch.operator = requireEnum(record, "operator", [">=", ">", "<=", "<", "=="] as const, "MVU_LINK_OPERATOR_REQUIRED");
  if (hasOwn(record, "sourceThreshold")) patch.sourceThreshold = requireNumber(record, "sourceThreshold", "MVU_LINK_THRESHOLD_REQUIRED");
  if (hasOwn(record, "targetFieldId")) patch.targetFieldId = requireNonEmptyString(record, "targetFieldId", "MVU_LINK_TARGET_REQUIRED");
  if (hasOwn(record, "effect")) patch.effect = parseLinkEffect(record.effect);
  if (hasOwn(record, "enabled")) patch.enabled = requireBoolean(record, "enabled", "MVU_LINK_ENABLED_REQUIRED");
  return patch;
}

function parseAutoCondition(value: unknown): AutoRuleCondition {
  const record = requireRecord(value, "MVU_AUTO_CONDITION_INVALID");
  const kind = requireEnum(
    record,
    "kind",
    ["recentPositive", "longInactive", "userCare", "specialDay", "highFreq", "stateThreshold", "aiJudgement"] as const,
    "MVU_AUTO_CONDITION_KIND_REQUIRED"
  );
  switch (kind) {
    case "recentPositive":
      assertKeys(record, ["kind", "count"], [], "MVU_AUTO_CONDITION_INVALID");
      return { kind, count: requireNumber(record, "count", "MVU_AUTO_COUNT_REQUIRED") };
    case "longInactive":
      assertKeys(record, ["kind", "hours"], [], "MVU_AUTO_CONDITION_INVALID");
      return { kind, hours: requireNumber(record, "hours", "MVU_AUTO_HOURS_REQUIRED") };
    case "highFreq":
      assertKeys(record, ["kind", "messages"], [], "MVU_AUTO_CONDITION_INVALID");
      return { kind, messages: requireNumber(record, "messages", "MVU_AUTO_MESSAGES_REQUIRED") };
    case "stateThreshold":
      assertKeys(record, ["kind", "fieldId", "operator", "threshold"], [], "MVU_AUTO_CONDITION_INVALID");
      return {
        kind,
        fieldId: requireNonEmptyString(record, "fieldId", "MVU_AUTO_FIELD_REQUIRED"),
        operator: requireEnum(record, "operator", [">=", "<=", ">", "<"] as const, "MVU_AUTO_OPERATOR_REQUIRED"),
        threshold: requireNumber(record, "threshold", "MVU_AUTO_THRESHOLD_REQUIRED"),
      };
    case "aiJudgement":
      assertKeys(
        record,
        ["kind", "triggerType", "requirement", "minimumConfidence"],
        [],
        "MVU_AUTO_CONDITION_INVALID"
      );
      return {
        kind,
        triggerType: requireNonEmptyString(record, "triggerType", "MVU_AUTO_AI_TRIGGER_TYPE_REQUIRED"),
        requirement: requireNonEmptyString(record, "requirement", "MVU_AUTO_AI_REQUIREMENT_REQUIRED"),
        minimumConfidence: requireNumber(record, "minimumConfidence", "MVU_AUTO_AI_CONFIDENCE_REQUIRED"),
      };
    case "userCare":
    case "specialDay":
      assertKeys(record, ["kind"], [], "MVU_AUTO_CONDITION_INVALID");
      return { kind };
  }
}

function parseAutoEffect(value: unknown): DataAutoRule["effects"][number] {
  const record = requireRecord(value, "MVU_AUTO_EFFECT_INVALID");
  assertKeys(record, ["fieldId", "delta", "temporaryEffectIds"], [], "MVU_AUTO_EFFECT_INVALID");
  return {
    fieldId: requireNonEmptyString(record, "fieldId", "MVU_AUTO_EFFECT_FIELD_REQUIRED"),
    delta: requireNumber(record, "delta", "MVU_AUTO_EFFECT_DELTA_REQUIRED"),
    temporaryEffectIds: requireStringArray(
      record.temporaryEffectIds,
      "MVU_AUTO_EFFECT_IMPORTS_REQUIRED"
    ),
  };
}

function parseAutoEffects(value: unknown): DataAutoRule["effects"] {
  if (!Array.isArray(value)) fail("MVU_AUTO_EFFECTS_INVALID");
  return value.map(parseAutoEffect);
}

const AUTO_RULE_KEYS = [
  "name", "description", "enabled", "condition", "effects", "cooldownMs", "order",
] as const;

function parseAutoRuleInput(value: unknown): AutoRuleInput {
  const record = requireRecord(value, "MVU_AUTO_RULE_INPUT_INVALID");
  assertKeys(record, AUTO_RULE_KEYS, [], "MVU_AUTO_RULE_INPUT_INVALID");
  return {
    name: requireString(record, "name", "MVU_AUTO_NAME_REQUIRED"),
    description: requireString(record, "description", "MVU_AUTO_DESCRIPTION_REQUIRED"),
    enabled: requireBoolean(record, "enabled", "MVU_AUTO_ENABLED_REQUIRED"),
    condition: parseAutoCondition(record.condition),
    effects: parseAutoEffects(record.effects),
    cooldownMs: requireNumber(record, "cooldownMs", "MVU_AUTO_COOLDOWN_REQUIRED"),
    order: requireNumber(record, "order", "MVU_AUTO_ORDER_REQUIRED"),
  };
}

function parseAutoRulePatch(value: unknown): AutoRulePatch {
  const record = requireRecord(value, "MVU_AUTO_RULE_PATCH_INVALID");
  assertKeys(record, [], AUTO_RULE_KEYS, "MVU_AUTO_RULE_PATCH_INVALID");
  const patch: AutoRulePatch = {};
  if (hasOwn(record, "name")) patch.name = requireString(record, "name", "MVU_AUTO_NAME_REQUIRED");
  if (hasOwn(record, "description")) patch.description = requireString(record, "description", "MVU_AUTO_DESCRIPTION_REQUIRED");
  if (hasOwn(record, "enabled")) patch.enabled = requireBoolean(record, "enabled", "MVU_AUTO_ENABLED_REQUIRED");
  if (hasOwn(record, "condition")) patch.condition = parseAutoCondition(record.condition);
  if (hasOwn(record, "effects")) patch.effects = parseAutoEffects(record.effects);
  if (hasOwn(record, "cooldownMs")) patch.cooldownMs = requireNumber(record, "cooldownMs", "MVU_AUTO_COOLDOWN_REQUIRED");
  if (hasOwn(record, "order")) patch.order = requireNumber(record, "order", "MVU_AUTO_ORDER_REQUIRED");
  return patch;
}

const TEMPORARY_EFFECT_KEYS = [
  "targets", "mode", "value", "enabled", "expiresAt", "remainingTurns",
  "reasonMode", "reasonTemplate", "reason", "createdAt",
] as const;

function parseTemporaryEffectTargets(value: unknown): DataTemporaryEffect["targets"] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("MVU_EFFECT_TARGETS_REQUIRED");
  }
  return value.map((entry) => {
    const record = requireRecord(entry, "MVU_EFFECT_TARGET_INVALID");
    assertKeys(record, ["fieldId", "scope", "scopeKey"], [], "MVU_EFFECT_TARGET_INVALID");
    return {
      fieldId: requireNonEmptyString(record, "fieldId", "MVU_EFFECT_TARGET_FIELD_REQUIRED"),
      scope: requireEnum(
        record,
        "scope",
        ["character", "group", "global", "chat"] as const,
        "MVU_EFFECT_TARGET_SCOPE_REQUIRED"
      ),
      scopeKey: requireNonEmptyString(record, "scopeKey", "MVU_EFFECT_TARGET_SCOPE_KEY_REQUIRED"),
    };
  });
}

function parseTemporaryEffectInput(value: unknown): TemporaryEffectInput {
  const record = requireRecord(value, "MVU_TEMPORARY_EFFECT_INPUT_INVALID");
  assertKeys(record, TEMPORARY_EFFECT_KEYS, [], "MVU_TEMPORARY_EFFECT_INPUT_INVALID");
  return {
    targets: parseTemporaryEffectTargets(record.targets),
    mode: requireEnum(record, "mode", ["multiplier", "additive"] as const, "MVU_EFFECT_MODE_REQUIRED"),
    value: requireNumber(record, "value", "MVU_EFFECT_VALUE_REQUIRED"),
    enabled: requireBoolean(record, "enabled", "MVU_EFFECT_ENABLED_REQUIRED"),
    expiresAt: requireNullableNumber(record, "expiresAt", "MVU_EFFECT_EXPIRES_REQUIRED"),
    remainingTurns: requireNullableNumber(record, "remainingTurns", "MVU_EFFECT_TURNS_REQUIRED"),
    reasonMode: requireEnum(record, "reasonMode", ["template", "custom"] as const, "MVU_EFFECT_REASON_MODE_REQUIRED"),
    reasonTemplate: requireEnum(
      record,
      "reasonTemplate",
      ["general", "positive", "negative", "environment", "relationship"] as const,
      "MVU_EFFECT_REASON_TEMPLATE_REQUIRED"
    ),
    reason: requireBoundedString(
      record,
      "reason",
      EFFECT_REASON_SOURCE_MAX_LENGTH,
      "MVU_EFFECT_REASON_TOO_LONG",
    ),
    createdAt: requireNumber(record, "createdAt", "MVU_EFFECT_CREATED_REQUIRED"),
  };
}

function parseTemporaryEffectPatch(value: unknown): TemporaryEffectPatch {
  const record = requireRecord(value, "MVU_TEMPORARY_EFFECT_PATCH_INVALID");
  assertKeys(record, [], TEMPORARY_EFFECT_KEYS, "MVU_TEMPORARY_EFFECT_PATCH_INVALID");
  const patch: TemporaryEffectPatch = {};
  if (hasOwn(record, "targets")) patch.targets = parseTemporaryEffectTargets(record.targets);
  if (hasOwn(record, "mode")) patch.mode = requireEnum(record, "mode", ["multiplier", "additive"] as const, "MVU_EFFECT_MODE_REQUIRED");
  if (hasOwn(record, "value")) patch.value = requireNumber(record, "value", "MVU_EFFECT_VALUE_REQUIRED");
  if (hasOwn(record, "enabled")) patch.enabled = requireBoolean(record, "enabled", "MVU_EFFECT_ENABLED_REQUIRED");
  if (hasOwn(record, "expiresAt")) patch.expiresAt = requireNullableNumber(record, "expiresAt", "MVU_EFFECT_EXPIRES_REQUIRED");
  if (hasOwn(record, "remainingTurns")) patch.remainingTurns = requireNullableNumber(record, "remainingTurns", "MVU_EFFECT_TURNS_REQUIRED");
  if (hasOwn(record, "reasonMode")) {
    patch.reasonMode = requireEnum(record, "reasonMode", ["template", "custom"] as const, "MVU_EFFECT_REASON_MODE_REQUIRED");
  }
  if (hasOwn(record, "reasonTemplate")) {
    patch.reasonTemplate = requireEnum(
      record,
      "reasonTemplate",
      ["general", "positive", "negative", "environment", "relationship"] as const,
      "MVU_EFFECT_REASON_TEMPLATE_REQUIRED"
    );
  }
  if (hasOwn(record, "reason")) {
    patch.reason = requireBoundedString(
      record,
      "reason",
      EFFECT_REASON_LEGACY_STORAGE_MAX_LENGTH,
      "MVU_EFFECT_REASON_TOO_LONG",
    );
  }
  if (hasOwn(record, "createdAt")) patch.createdAt = requireNumber(record, "createdAt", "MVU_EFFECT_CREATED_REQUIRED");
  return patch;
}

function parseSettingsPatch(value: unknown): SettingsPatch {
  const record = requireRecord(value, "MVU_SETTINGS_PATCH_INVALID");
  assertKeys(record, [], ["aiEnabled"], "MVU_SETTINGS_PATCH_INVALID");
  const patch: SettingsPatch = {};
  if (hasOwn(record, "aiEnabled")) patch.aiEnabled = requireBoolean(record, "aiEnabled", "MVU_SETTINGS_AI_ENABLED_REQUIRED");
  return patch;
}

function parseSetStateValueRequest(value: unknown): SetStateValueRequest {
  const record = requireRecord(value, "MVU_SET_STATE_REQUEST_INVALID");
  assertKeys(record, ["scopeContext", "fieldId", "value", "reason"], [], "MVU_SET_STATE_REQUEST_INVALID");
  return {
    scopeContext: parseScopeContext(record.scopeContext),
    fieldId: requireNonEmptyString(record, "fieldId", "MVU_SET_STATE_FIELD_REQUIRED"),
    value: requireNumber(record, "value", "MVU_SET_STATE_VALUE_REQUIRED"),
    reason: requireString(record, "reason", "MVU_SET_STATE_REASON_REQUIRED"),
  };
}

function parseAddFieldRequest(value: unknown): AddFieldRequest {
  const record = requireRecord(value, "MVU_ADD_FIELD_REQUEST_INVALID");
  assertKeys(record, ["field"], [], "MVU_ADD_FIELD_REQUEST_INVALID");
  return { field: parseFieldInput(record.field) };
}

function parseUpdateFieldRequest(value: unknown): UpdateFieldRequest {
  const record = requireRecord(value, "MVU_UPDATE_FIELD_REQUEST_INVALID");
  assertKeys(record, ["id", "patch"], [], "MVU_UPDATE_FIELD_REQUEST_INVALID");
  return {
    id: requireNonEmptyString(record, "id", "MVU_FIELD_ID_REQUIRED"),
    patch: parseFieldPatch(record.patch),
  };
}

function parseIdRequest(value: unknown): IdRequest {
  const record = requireRecord(value, "MVU_ID_REQUEST_INVALID");
  assertKeys(record, ["id"], [], "MVU_ID_REQUEST_INVALID");
  return { id: requireBoundedNonEmptyString(record, "id", 256, "MVU_ID_REQUIRED") };
}

function requireExpectedRevision(record: UnknownRecord, code: string): number {
  const revision = requireNumber(record, "expectedRevision", code);
  if (!Number.isSafeInteger(revision) || revision < 0) fail(code);
  return revision;
}

function parseRevisionedIdRequest(value: unknown, code: string): RevisionedIdRequest {
  const record = requireRecord(value, code);
  assertKeys(record, ["id", "expectedRevision"], [], code);
  return {
    id: requireBoundedNonEmptyString(record, "id", 256, code),
    expectedRevision: requireExpectedRevision(record, code),
  };
}

function parseReferenceQueryRequest(value: unknown, code: string): ReferenceQueryRequest {
  const record = requireRecord(value, code);
  assertKeys(record, ["id"], ["page"], code);
  const request: ReferenceQueryRequest = {
    id: requireBoundedNonEmptyString(record, "id", 256, code),
  };
  if (hasOwn(record, "page")) {
    const page = requireNumber(record, "page", code);
    if (!Number.isSafeInteger(page) || page < 1) fail(code);
    request.page = page;
  }
  return request;
}

function parseScopeContextRequest(value: unknown): ScopeContextRequest {
  const record = requireRecord(value, "MVU_SCOPE_CONTEXT_REQUEST_INVALID");
  assertKeys(record, ["scopeContext"], [], "MVU_SCOPE_CONTEXT_REQUEST_INVALID");
  return { scopeContext: parseScopeContext(record.scopeContext) };
}

function parseAddLinkRuleRequest(value: unknown): AddLinkRuleRequest {
  const record = requireRecord(value, "MVU_ADD_LINK_RULE_REQUEST_INVALID");
  assertKeys(record, ["rule"], [], "MVU_ADD_LINK_RULE_REQUEST_INVALID");
  return { rule: parseLinkRuleInput(record.rule) };
}

function parseUpdateLinkRuleRequest(value: unknown): UpdateLinkRuleRequest {
  const record = requireRecord(value, "MVU_UPDATE_LINK_RULE_REQUEST_INVALID");
  assertKeys(record, ["id", "patch"], [], "MVU_UPDATE_LINK_RULE_REQUEST_INVALID");
  return {
    id: requireNonEmptyString(record, "id", "MVU_LINK_RULE_ID_REQUIRED"),
    patch: parseLinkRulePatch(record.patch),
  };
}

function parseAddAutoRuleRequest(value: unknown): AddAutoRuleRequest {
  const record = requireRecord(value, "MVU_ADD_AUTO_RULE_REQUEST_INVALID");
  assertKeys(record, ["rule"], [], "MVU_ADD_AUTO_RULE_REQUEST_INVALID");
  return { rule: parseAutoRuleInput(record.rule) };
}

function parseUpdateAutoRuleRequest(value: unknown): UpdateAutoRuleRequest {
  const record = requireRecord(value, "MVU_UPDATE_AUTO_RULE_REQUEST_INVALID");
  assertKeys(record, ["id", "patch"], [], "MVU_UPDATE_AUTO_RULE_REQUEST_INVALID");
  return {
    id: requireNonEmptyString(record, "id", "MVU_AUTO_RULE_ID_REQUIRED"),
    patch: parseAutoRulePatch(record.patch),
  };
}

function parseUpdateSettingsRequest(value: unknown): UpdateSettingsRequest {
  const record = requireRecord(value, "MVU_UPDATE_SETTINGS_REQUEST_INVALID");
  assertKeys(record, ["patch"], [], "MVU_UPDATE_SETTINGS_REQUEST_INVALID");
  return { patch: parseSettingsPatch(record.patch) };
}

function parseJudgeStateRequest(value: unknown): JudgeStateRequest {
  const record = requireRecord(value, "MVU_JUDGE_STATE_REQUEST_INVALID");
  assertKeys(record, ["scopeContext", "message", "commit"], [], "MVU_JUDGE_STATE_REQUEST_INVALID");
  return {
    scopeContext: parseScopeContext(record.scopeContext),
    message: requireString(record, "message", "MVU_JUDGE_MESSAGE_REQUIRED"),
    commit: requireBoolean(record, "commit", "MVU_JUDGE_COMMIT_REQUIRED"),
  };
}

function parseImportDatasetRequest(value: unknown): ImportDatasetRequest {
  const record = requireRecord(value, "MVU_IMPORT_DATASET_REQUEST_INVALID");
  assertKeys(record, ["json"], [], "MVU_IMPORT_DATASET_REQUEST_INVALID");
  return { json: requireString(record, "json", "MVU_IMPORT_JSON_REQUIRED") };
}

function parseTemplateJsonRequest(value: unknown): PreviewFieldTemplateImportRequest {
  const code = "MVU_FIELD_TEMPLATE_PREVIEW_REQUEST_INVALID";
  const record = requireRecord(value, code);
  assertKeys(record, ["json"], [], code);
  const json = requireString(record, "json", code);
  if (json.length > FIELD_TEMPLATE_MAX_BYTES) fail("MVU_FIELD_TEMPLATE_TOO_LARGE");
  return { json };
}

function parseExportFieldTemplateRequest(value: unknown): ExportFieldTemplateRequest {
  const code = "MVU_FIELD_TEMPLATE_EXPORT_REQUEST_INVALID";
  const record = requireRecord(value, code);
  assertKeys(record, ["fieldIds", "targetSelections"], [], code);
  const fieldIds = requireStringArray(record.fieldIds, code);
  if (fieldIds.length === 0 || fieldIds.length > FIELD_TEMPLATE_MAX_FIELDS ||
    fieldIds.some((id) => id.length === 0 || id.length > FIELD_TEMPLATE_MAX_ID_LENGTH) ||
    new Set(fieldIds).size !== fieldIds.length) fail(code);
  if (!Array.isArray(record.targetSelections) || record.targetSelections.length > FIELD_TEMPLATE_MAX_FIELDS) fail(code);
  const selectedFields = new Set<string>();
  const targetSelections = record.targetSelections.map((value) => {
    const selection = requireRecord(value, code);
    assertKeys(selection, ["fieldId", "targets"], [], code);
    const fieldId = requireBoundedNonEmptyString(selection, "fieldId", FIELD_TEMPLATE_MAX_ID_LENGTH, code);
    if (!fieldIds.includes(fieldId) || selectedFields.has(fieldId) || !Array.isArray(selection.targets) ||
      selection.targets.length > FIELD_TEMPLATE_MAX_TARGETS_PER_FIELD) fail(code);
    selectedFields.add(fieldId);
    const targetIds = new Set<string>();
    const targets = selection.targets.map((targetValue) => {
      const target = requireRecord(targetValue, code);
      assertKeys(target, ["targetId", "enabled", "includeValue"], [], code);
      const targetId = requireBoundedNonEmptyString(target, "targetId", FIELD_TEMPLATE_MAX_ID_LENGTH, code);
      if (targetIds.has(targetId)) fail(code);
      targetIds.add(targetId);
      const enabled = requireBoolean(target, "enabled", code);
      const includeValue = requireBoolean(target, "includeValue", code);
      if (!enabled && includeValue) fail(code);
      return { targetId, enabled, includeValue };
    });
    return { fieldId, targets };
  });
  return { fieldIds, targetSelections };
}

function parseImportFieldTemplateRequest(value: unknown): ImportFieldTemplateRequest {
  const code = "MVU_FIELD_TEMPLATE_IMPORT_REQUEST_INVALID";
  const record = requireRecord(value, code);
  assertKeys(record, ["json", "expectedRevision", "decisions"], [], code);
  const json = requireString(record, "json", code);
  if (json.length > FIELD_TEMPLATE_MAX_BYTES) fail("MVU_FIELD_TEMPLATE_TOO_LARGE");
  const decisionsRecord = requireRecord(record.decisions, code);
  assertKeys(decisionsRecord, ["fields"], [], code);
  if (!Array.isArray(decisionsRecord.fields) || decisionsRecord.fields.length > FIELD_TEMPLATE_MAX_FIELDS) fail(code);
  const fields = decisionsRecord.fields.map((fieldValue) => {
    const field = requireRecord(fieldValue, code);
    assertKeys(field, ["sourceFieldId", "mappings"], ["strategy", "unboundTargets"], code);
    const sourceFieldId = requireBoundedNonEmptyString(field, "sourceFieldId", FIELD_TEMPLATE_MAX_ID_LENGTH, code);
    if (!Array.isArray(field.mappings) || field.mappings.length > FIELD_TEMPLATE_MAX_TARGETS_PER_FIELD) fail(code);
    const mappings = field.mappings.map((mappingValue) => {
      const mapping = requireRecord(mappingValue, code);
      assertKeys(mapping, ["sourceTargetId", "targets"], [], code);
      const sourceTargetId = requireBoundedNonEmptyString(mapping, "sourceTargetId", FIELD_TEMPLATE_MAX_ID_LENGTH, code);
      if (!Array.isArray(mapping.targets) || mapping.targets.length > FIELD_TEMPLATE_MAX_TARGETS_PER_FIELD) fail(code);
      const targets = mapping.targets.map((targetValue) => parseFieldTemplateImportTarget(targetValue, code));
      return { sourceTargetId, targets };
    });
    const parsed = { sourceFieldId, mappings } as ImportFieldTemplateRequest["decisions"]["fields"][number];
    if (hasOwn(field, "strategy")) {
      parsed.strategy = requireEnum(field, "strategy", ["create_copy", "update", "replace"] as const, code);
    }
    if (hasOwn(field, "unboundTargets")) {
      if (!Array.isArray(field.unboundTargets) || field.unboundTargets.length > FIELD_TEMPLATE_MAX_TARGETS_PER_FIELD) fail(code);
      parsed.unboundTargets = field.unboundTargets.map((targetValue) => parseFieldTemplateImportTarget(targetValue, code));
    }
    return parsed;
  });
  return {
    json,
    expectedRevision: requireExpectedRevision(record, code),
    decisions: { fields },
  };
}

function parseFieldTemplateImportTarget(
  value: unknown,
  code: string,
): ImportFieldTemplateRequest["decisions"]["fields"][number]["mappings"][number]["targets"][number] {
  const target = requireRecord(value, code);
  assertKeys(target, ["targetId", "enabled", "valuePolicy"], [], code);
  return {
    targetId: requireBoundedNonEmptyString(target, "targetId", FIELD_TEMPLATE_MAX_ID_LENGTH, code),
    enabled: requireBoolean(target, "enabled", code),
    valuePolicy: requireEnum(target, "valuePolicy", ["template_value", "keep_existing", "field_initial"] as const, code),
  };
}

function parseAddTemporaryEffectRequest(value: unknown): AddTemporaryEffectRequest {
  const record = requireRecord(value, "MVU_ADD_EFFECT_REQUEST_INVALID");
  assertKeys(record, ["effect"], [], "MVU_ADD_EFFECT_REQUEST_INVALID");
  return { effect: parseTemporaryEffectInput(record.effect) };
}

function parseUpdateTemporaryEffectRequest(value: unknown): UpdateTemporaryEffectRequest {
  const record = requireRecord(value, "MVU_UPDATE_EFFECT_REQUEST_INVALID");
  assertKeys(record, ["id", "patch"], [], "MVU_UPDATE_EFFECT_REQUEST_INVALID");
  return {
    id: requireNonEmptyString(record, "id", "MVU_EFFECT_ID_REQUIRED"),
    patch: parseTemporaryEffectPatch(record.patch),
  };
}

function parseQueryRequest(
  value: unknown,
  sortKeys: readonly string[],
  filterKeys: readonly string[],
): QueryRequest {
  const record = requireRecord(value, "MVU_QUERY_REQUEST_INVALID");
  assertKeys(record, [], ["search", "filters", "sort", "page", "cursor"], "MVU_QUERY_REQUEST_INVALID");
  const request: QueryRequest = {};
  if (hasOwn(record, "search")) {
    const search = requireString(record, "search", "MVU_QUERY_SEARCH_INVALID");
    if (search.length > QUERY_SEARCH_MAX_LENGTH) fail("MVU_QUERY_SEARCH_TOO_LONG");
    request.search = search;
  }
  if (hasOwn(record, "filters")) {
    const filters = requireRecord(record.filters, "MVU_QUERY_FILTER_INVALID");
    if (Object.keys(filters).length > 12 || Object.keys(filters).some((key) => !filterKeys.includes(key))) {
      fail("MVU_QUERY_FILTER_INVALID");
    }
    const parsedFilters: Record<string, string | boolean | number> = {};
    for (const [key, entry] of Object.entries(filters)) {
      if (typeof entry !== "string" && typeof entry !== "boolean" &&
        (typeof entry !== "number" || !Number.isFinite(entry))) fail("MVU_QUERY_FILTER_INVALID");
      if (typeof entry === "string" && entry.length > 256) fail("MVU_QUERY_FILTER_INVALID");
      parsedFilters[key] = entry;
    }
    request.filters = parsedFilters;
  }
  if (hasOwn(record, "sort")) {
    const sort = requireRecord(record.sort, "MVU_QUERY_SORT_INVALID");
    assertKeys(sort, ["key", "direction"], [], "MVU_QUERY_SORT_INVALID");
    const key = requireString(sort, "key", "MVU_QUERY_SORT_INVALID");
    if (!sortKeys.includes(key)) fail("MVU_QUERY_SORT_INVALID");
    request.sort = {
      key,
      direction: requireEnum(sort, "direction", ["asc", "desc"] as const, "MVU_QUERY_SORT_INVALID"),
    };
  }
  if (hasOwn(record, "page")) {
    const page = requireNumber(record, "page", "MVU_QUERY_PAGE_INVALID");
    if (!Number.isSafeInteger(page) || page < 1) fail("MVU_QUERY_PAGE_INVALID");
    request.page = page;
  }
  if (hasOwn(record, "cursor")) {
    const cursor = requireString(record, "cursor", "MVU_QUERY_CURSOR_INVALID");
    if (cursor.length > QUERY_CURSOR_MAX_LENGTH) fail("MVU_QUERY_CURSOR_TOO_LONG");
    request.cursor = cursor;
  }
  if (request.page !== undefined && request.cursor !== undefined) fail("MVU_QUERY_REQUEST_INVALID");
  return request;
}

function parseFieldsQuery(value: unknown): QueryRequest {
  const request = parseQueryRequest(
    value,
    ["id", "name", "order", "enabled", "scope", "minimum", "maximum"],
    ["mode", "enabled", "scope", "type", "bindingId"],
  );
  assertFilterValue(request, "mode", (entry) => entry === "picker");
  assertFilterValue(request, "enabled", (entry) => typeof entry === "boolean");
  assertFilterValue(request, "scope", (entry) =>
    entry === "character" || entry === "group" || entry === "global" || entry === "chat");
  assertFilterValue(request, "type", (entry) =>
    entry === "full" || entry === "stage_only" || entry === "hidden");
  assertFilterValue(request, "bindingId", isBoundedFilterString);
  return request;
}

function parseActorsQuery(value: unknown): QueryRequest {
  const request = parseQueryRequest(value, ["id", "name", "enabled"], ["enabled", "groupId"]);
  assertFilterValue(request, "enabled", (entry) => typeof entry === "boolean");
  assertFilterValue(request, "groupId", isBoundedFilterString);
  return request;
}

function parseGroupsQuery(value: unknown): QueryRequest {
  const request = parseQueryRequest(value, ["id", "name"], ["actorId"]);
  assertFilterValue(request, "actorId", isBoundedFilterString);
  return request;
}

function parseRulesQuery(value: unknown): QueryRequest {
  const request = parseQueryRequest(
    value, ["id", "name", "enabled", "executionOrder", "updatedAt"],
    ["enabled", "conditionId", "actorId", "groupId"],
  );
  assertFilterValue(request, "enabled", (entry) => typeof entry === "boolean");
  for (const key of ["conditionId", "actorId", "groupId"] as const) {
    assertFilterValue(request, key, isBoundedFilterString);
  }
  return request;
}

function parseConditionsQuery(value: unknown): QueryRequest {
  const request = parseQueryRequest(value, ["id", "name", "enabled", "updatedAt"], ["enabled"]);
  assertFilterValue(request, "enabled", (entry) => typeof entry === "boolean");
  return request;
}

function parseEffectGroupsQuery(value: unknown): QueryRequest {
  const request = parseQueryRequest(
    value, ["id", "name", "enabled", "updatedAt"], ["enabled", "fieldId"],
  );
  assertFilterValue(request, "enabled", (entry) => typeof entry === "boolean");
  assertFilterValue(request, "fieldId", isBoundedFilterString);
  return request;
}
const parseRecordsQuery = (value: unknown): QueryRequest => parseQueryRequest(
  value, ["occurredAt"], ["fieldId", "scopeKey"],
);

function assertFilterValue(
  request: QueryRequest,
  key: string,
  predicate: (value: string | boolean | number) => boolean,
): void {
  const value = request.filters?.[key];
  if (value !== undefined && !predicate(value)) fail("MVU_QUERY_FILTER_INVALID");
}

function isBoundedFilterString(value: string | boolean | number): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function parseGetEntityByIdRequest(value: unknown): GetEntityByIdRequest {
  const record = requireRecord(value, "MVU_GET_ENTITY_REQUEST_INVALID");
  assertKeys(record, ["entityType", "id"], [], "MVU_GET_ENTITY_REQUEST_INVALID");
  return {
    entityType: requireEnum(
      record,
      "entityType",
      ["field", "actor", "group", "rule", "condition", "effectGroup"] as const,
      "MVU_ENTITY_TYPE_INVALID",
    ),
    id: requireBoundedNonEmptyString(record, "id", 256, "MVU_ENTITY_ID_INVALID"),
  };
}

function requireBoundedNonEmptyString(
  record: UnknownRecord,
  key: string,
  maximum: number,
  code: string,
): string {
  const value = requireNonEmptyString(record, key, code);
  if (value.length > maximum) fail(code);
  return value;
}

function requireBoundedString(
  record: UnknownRecord,
  key: string,
  maximum: number,
  code: string,
): string {
  const value = requireString(record, key, code);
  if (value.length > maximum) fail(code);
  return value;
}

function parseConditionExpression(value: unknown, depth = 0): ConditionExpression {
  if (depth > 12) fail("MVU_CONDITION_EXPRESSION_INVALID");
  const record = requireRecord(value, "MVU_CONDITION_EXPRESSION_INVALID");
  const kind = requireEnum(
    record,
    "kind",
    ["and", "or", "not", "predicate"] as const,
    "MVU_CONDITION_EXPRESSION_INVALID",
  );
  if (kind === "and" || kind === "or") {
    assertKeys(record, ["kind", "children"], [], "MVU_CONDITION_EXPRESSION_INVALID");
    if (!Array.isArray(record.children) || record.children.length > 100) fail("MVU_CONDITION_EXPRESSION_INVALID");
    return { kind, children: record.children.map((child) => parseConditionExpression(child, depth + 1)) };
  }
  if (kind === "not") {
    assertKeys(record, ["kind", "child"], [], "MVU_CONDITION_EXPRESSION_INVALID");
    return { kind, child: parseConditionExpression(record.child, depth + 1) };
  }
  assertKeys(record, ["kind", "predicate"], [], "MVU_CONDITION_EXPRESSION_INVALID");
  return { kind, predicate: parseConditionPredicate(record.predicate) };
}

function parseConditionPredicate(value: unknown): ConditionPredicate {
  const record = requireRecord(value, "MVU_CONDITION_PREDICATE_INVALID");
  const kind = requireString(record, "kind", "MVU_CONDITION_PREDICATE_INVALID");
  switch (kind) {
    case "recent_positive":
      assertKeys(record, ["kind", "count"], [], "MVU_CONDITION_PREDICATE_INVALID");
      return { kind, count: requireNumber(record, "count", "MVU_CONDITION_PREDICATE_INVALID") };
    case "long_inactive":
      assertKeys(record, ["kind", "hours"], [], "MVU_CONDITION_PREDICATE_INVALID");
      return { kind, hours: requireNumber(record, "hours", "MVU_CONDITION_PREDICATE_INVALID") };
    case "user_care":
    case "special_day":
      assertKeys(record, ["kind"], [], "MVU_CONDITION_PREDICATE_INVALID");
      return { kind };
    case "high_frequency": {
      assertKeys(record, ["kind", "messages"], ["windowHours", "bucketHours"], "MVU_CONDITION_PREDICATE_INVALID");
      const result: Extract<ConditionPredicate, { kind: "high_frequency" }> = {
        kind, messages: requireNumber(record, "messages", "MVU_CONDITION_PREDICATE_INVALID"),
      };
      if (hasOwn(record, "windowHours")) result.windowHours = requireNumber(record, "windowHours", "MVU_CONDITION_PREDICATE_INVALID");
      if (hasOwn(record, "bucketHours")) result.bucketHours = requireNumber(record, "bucketHours", "MVU_CONDITION_PREDICATE_INVALID");
      return result;
    }
    case "field_comparison":
      assertKeys(record, ["kind", "fieldId", "operator", "value"], [], "MVU_CONDITION_PREDICATE_INVALID");
      return {
        kind,
        fieldId: requireBoundedNonEmptyString(record, "fieldId", 256, "MVU_CONDITION_PREDICATE_INVALID"),
        operator: requireEnum(record, "operator", [">=", "<=", ">", "<", "=="] as const, "MVU_CONDITION_PREDICATE_INVALID"),
        value: requireNumber(record, "value", "MVU_CONDITION_PREDICATE_INVALID"),
      };
    case "message_count": {
      assertKeys(record, ["kind", "count", "windowHours"], ["sender"], "MVU_CONDITION_PREDICATE_INVALID");
      const result: Extract<ConditionPredicate, { kind: "message_count" }> = {
        kind,
        count: requireNumber(record, "count", "MVU_CONDITION_PREDICATE_INVALID"),
        windowHours: requireNumber(record, "windowHours", "MVU_CONDITION_PREDICATE_INVALID"),
      };
      if (hasOwn(record, "sender")) result.sender = requireEnum(record, "sender", ["user", "character"] as const, "MVU_CONDITION_PREDICATE_INVALID");
      return result;
    }
    case "keywords": {
      assertKeys(record, ["kind", "includeAny", "includeAll", "exclude"], ["windowHours", "caseSensitive"], "MVU_CONDITION_PREDICATE_INVALID");
      const result: Extract<ConditionPredicate, { kind: "keywords" }> = {
        kind,
        includeAny: parseBoundedStringArray(record.includeAny, "MVU_CONDITION_PREDICATE_INVALID"),
        includeAll: parseBoundedStringArray(record.includeAll, "MVU_CONDITION_PREDICATE_INVALID"),
        exclude: parseBoundedStringArray(record.exclude, "MVU_CONDITION_PREDICATE_INVALID"),
      };
      if (hasOwn(record, "windowHours")) result.windowHours = requireNumber(record, "windowHours", "MVU_CONDITION_PREDICATE_INVALID");
      if (hasOwn(record, "caseSensitive")) result.caseSensitive = requireBoolean(record, "caseSensitive", "MVU_CONDITION_PREDICATE_INVALID");
      return result;
    }
    case "sender":
      assertKeys(record, ["kind", "senders"], [], "MVU_CONDITION_PREDICATE_INVALID");
      return { kind, senders: parseSenderArray(record.senders) };
    case "actor":
      assertKeys(record, ["kind", "actorIds"], [], "MVU_CONDITION_PREDICATE_INVALID");
      return { kind, actorIds: parseBoundedStringArray(record.actorIds, "MVU_CONDITION_PREDICATE_INVALID") };
    case "group":
      assertKeys(record, ["kind", "groupIds"], [], "MVU_CONDITION_PREDICATE_INVALID");
      return { kind, groupIds: parseBoundedStringArray(record.groupIds, "MVU_CONDITION_PREDICATE_INVALID") };
    case "concrete_date":
      assertKeys(record, ["kind", "dates"], [], "MVU_CONDITION_PREDICATE_INVALID");
      return { kind, dates: parseBoundedStringArray(record.dates, "MVU_CONDITION_PREDICATE_INVALID") };
    case "repeating_date":
      assertKeys(record, ["kind", "month", "day"], [], "MVU_CONDITION_PREDICATE_INVALID");
      return {
        kind,
        month: requireNumber(record, "month", "MVU_CONDITION_PREDICATE_INVALID"),
        day: requireNumber(record, "day", "MVU_CONDITION_PREDICATE_INVALID"),
      };
    case "ai_semantic":
      assertKeys(record, ["kind", "id", "triggerType", "requirement", "minimumConfidence"], [], "MVU_CONDITION_PREDICATE_INVALID");
      return {
        kind,
        id: requireBoundedNonEmptyString(record, "id", 256, "MVU_CONDITION_PREDICATE_INVALID"),
        triggerType: requireBoundedNonEmptyString(record, "triggerType", 256, "MVU_CONDITION_PREDICATE_INVALID"),
        requirement: requireBoundedNonEmptyString(record, "requirement", 4_096, "MVU_CONDITION_PREDICATE_INVALID"),
        minimumConfidence: requireNumber(record, "minimumConfidence", "MVU_CONDITION_PREDICATE_INVALID"),
      };
    default:
      return fail("MVU_CONDITION_PREDICATE_INVALID");
  }
}

function parseBoundedStringArray(value: unknown, code: string): string[] {
  const entries = requireStringArray(value, code);
  if (entries.length > 100 || entries.some((entry) => entry.length > 256)) fail(code);
  return entries;
}

function parseSenderArray(value: unknown): Array<"user" | "character"> {
  const entries = parseBoundedStringArray(value, "MVU_CONDITION_PREDICATE_INVALID");
  if (entries.some((entry) => entry !== "user" && entry !== "character")) {
    fail("MVU_CONDITION_PREDICATE_INVALID");
  }
  return entries as Array<"user" | "character">;
}

function parseConditionInput(value: unknown, patch: false): ConditionInput;
function parseConditionInput(value: unknown, patch: true): ConditionPatch;
function parseConditionInput(value: unknown, patch: boolean): ConditionInput | ConditionPatch {
  const record = requireRecord(value, patch ? "MVU_CONDITION_PATCH_INVALID" : "MVU_CONDITION_INPUT_INVALID");
  const keys = ["name", "description", "enabled", "expression"];
  assertKeys(record, patch ? [] : keys, patch ? keys : [], patch ? "MVU_CONDITION_PATCH_INVALID" : "MVU_CONDITION_INPUT_INVALID");
  const result: ConditionPatch = {};
  if (hasOwn(record, "name")) result.name = requireBoundedNonEmptyString(record, "name", 256, "MVU_CONDITION_INPUT_INVALID");
  if (hasOwn(record, "description")) result.description = requireBoundedString(record, "description", 4_096, "MVU_CONDITION_INPUT_INVALID");
  if (hasOwn(record, "enabled")) result.enabled = requireBoolean(record, "enabled", "MVU_CONDITION_INPUT_INVALID");
  if (hasOwn(record, "expression")) result.expression = parseConditionExpression(record.expression);
  return result;
}

function parseEffectActorSelector(value: unknown): EffectActorSelector {
  const record = requireRecord(value, "MVU_EFFECT_ACTOR_SELECTOR_INVALID");
  const kind = requireEnum(record, "kind", ["all_bound", "trigger_actor", "selected"] as const, "MVU_EFFECT_ACTOR_SELECTOR_INVALID");
  if (kind !== "selected") {
    assertKeys(record, ["kind"], [], "MVU_EFFECT_ACTOR_SELECTOR_INVALID");
    return { kind };
  }
  assertKeys(record, ["kind", "actorIds"], [], "MVU_EFFECT_ACTOR_SELECTOR_INVALID");
  return { kind, actorIds: parseBoundedStringArray(record.actorIds, "MVU_EFFECT_ACTOR_SELECTOR_INVALID") };
}

function parseEffectOperation(value: unknown): EffectOperation {
  const record = requireRecord(value, "MVU_EFFECT_OPERATION_INVALID");
  const kind = requireEnum(
    record,
    "kind",
    ["immediate_delta", "fixed_adjustment", "positive_multiplier", "negative_multiplier", "all_multiplier"] as const,
    "MVU_EFFECT_OPERATION_INVALID",
  );
  if (kind === "immediate_delta") {
    assertKeys(record, ["kind", "value"], [], "MVU_EFFECT_OPERATION_INVALID");
    return { kind, value: requireNumber(record, "value", "MVU_EFFECT_OPERATION_INVALID") };
  }
  assertKeys(record, ["kind", "value", "sources"], [], "MVU_EFFECT_OPERATION_INVALID");
  const sources = parseBoundedStringArray(record.sources, "MVU_EFFECT_OPERATION_INVALID");
  if (sources.some((source) => !["manual", "natural", "per_turn", "rule", "ai"].includes(source))) {
    fail("MVU_EFFECT_OPERATION_INVALID");
  }
  return {
    kind,
    value: requireNumber(record, "value", "MVU_EFFECT_OPERATION_INVALID"),
    sources: sources as ChangeSource[],
  };
}

function parseFieldEffect(value: unknown): FieldEffectDefinition {
  const record = requireRecord(value, "MVU_FIELD_EFFECT_INVALID");
  assertKeys(record, ["id", "fieldId", "actorSelector", "operations"], [], "MVU_FIELD_EFFECT_INVALID");
    if (!Array.isArray(record.operations) || record.operations.length > 100) fail("MVU_FIELD_EFFECT_INVALID");
  return {
    id: requireBoundedNonEmptyString(record, "id", 256, "MVU_FIELD_EFFECT_INVALID"),
    fieldId: requireBoundedNonEmptyString(record, "fieldId", 256, "MVU_FIELD_EFFECT_INVALID"),
    actorSelector: parseEffectActorSelector(record.actorSelector),
    operations: record.operations.map(parseEffectOperation),
  };
}

function parseEffectDuration(value: unknown): EffectDuration {
  const record = requireRecord(value, "MVU_EFFECT_DURATION_INVALID");
  assertKeys(record, ["expiresAt", "remainingTurns"], [], "MVU_EFFECT_DURATION_INVALID");
  return {
    expiresAt: requireNullableString(record, "expiresAt", "MVU_EFFECT_DURATION_INVALID"),
    remainingTurns: requireNullableNumber(record, "remainingTurns", "MVU_EFFECT_DURATION_INVALID"),
  };
}

function parseEffectReasonConfig(value: unknown): EffectReasonConfig {
  const record = requireRecord(value, "MVU_EFFECT_REASON_CONFIG_INVALID");
  assertKeys(record, ["mode", "template", "text"], [], "MVU_EFFECT_REASON_CONFIG_INVALID");
  const mode = requireEnum(record, "mode", ["template", "custom"] as const, "MVU_EFFECT_REASON_CONFIG_INVALID");
  const template = requireEnum(
    record,
    "template",
    ["general", "rule", "natural", "per_turn", "ai", "manual"] as const,
    "MVU_EFFECT_REASON_CONFIG_INVALID",
  );
  const text = requireBoundedString(record, "text", EFFECT_REASON_SOURCE_MAX_LENGTH, "MVU_EFFECT_REASON_CONFIG_INVALID");
  if (mode === "custom" && text.trim().length === 0) fail("MVU_EFFECT_REASON_CONFIG_INVALID");
  return { mode, template, text };
}

function parseEffectGroupInput(value: unknown, patch: false): EffectGroupInput;
function parseEffectGroupInput(value: unknown, patch: true): EffectGroupPatch;
function parseEffectGroupInput(value: unknown, patch: boolean): EffectGroupInput | EffectGroupPatch {
  const record = requireRecord(value, patch ? "MVU_EFFECT_GROUP_PATCH_INVALID" : "MVU_EFFECT_GROUP_INPUT_INVALID");
  const required = ["name", "description", "enabled", "fieldEffects", "defaultReason"];
  const optional = ["defaultDuration"];
  assertKeys(record, patch ? [] : required, patch ? [...required, ...optional] : optional,
    patch ? "MVU_EFFECT_GROUP_PATCH_INVALID" : "MVU_EFFECT_GROUP_INPUT_INVALID");
  const result: EffectGroupPatch = {};
  if (hasOwn(record, "name")) result.name = requireBoundedNonEmptyString(record, "name", 256, "MVU_EFFECT_GROUP_INPUT_INVALID");
  if (hasOwn(record, "description")) result.description = requireBoundedString(record, "description", 4_096, "MVU_EFFECT_GROUP_INPUT_INVALID");
  if (hasOwn(record, "enabled")) result.enabled = requireBoolean(record, "enabled", "MVU_EFFECT_GROUP_INPUT_INVALID");
  if (hasOwn(record, "fieldEffects")) {
    if (!Array.isArray(record.fieldEffects) || record.fieldEffects.length > 100) fail("MVU_EFFECT_GROUP_INPUT_INVALID");
    result.fieldEffects = record.fieldEffects.map(parseFieldEffect);
  }
  if (hasOwn(record, "defaultReason")) result.defaultReason = parseEffectReasonConfig(record.defaultReason);
  if (hasOwn(record, "defaultDuration")) result.defaultDuration = parseEffectDuration(record.defaultDuration);
  return result;
}

function parseRuleActorSelector(value: unknown): RuleActorSelector {
  const record = requireRecord(value, "MVU_RULE_ACTOR_SELECTOR_INVALID");
  const kind = requireEnum(record, "kind", ["any", "current_actor", "selected", "group"] as const, "MVU_RULE_ACTOR_SELECTOR_INVALID");
  if (kind === "any" || kind === "current_actor") {
    assertKeys(record, ["kind"], [], "MVU_RULE_ACTOR_SELECTOR_INVALID");
    return { kind };
  }
  const key = kind === "selected" ? "actorIds" : "groupIds";
  assertKeys(record, ["kind", key], [], "MVU_RULE_ACTOR_SELECTOR_INVALID");
  const ids = parseBoundedStringArray(record[key], "MVU_RULE_ACTOR_SELECTOR_INVALID");
  return kind === "selected" ? { kind, actorIds: ids } : { kind, groupIds: ids };
}

function parseRuleTargetSelector(value: unknown): RuleTargetSelector {
  const record = requireRecord(value, "MVU_RULE_TARGET_SELECTOR_INVALID");
  const kind = requireEnum(record, "kind", ["trigger_actor", "all_bound", "selected"] as const, "MVU_RULE_TARGET_SELECTOR_INVALID");
  if (kind !== "selected") {
    assertKeys(record, ["kind"], [], "MVU_RULE_TARGET_SELECTOR_INVALID");
    return { kind };
  }
  assertKeys(record, ["kind", "actorIds"], [], "MVU_RULE_TARGET_SELECTOR_INVALID");
  return { kind, actorIds: parseBoundedStringArray(record.actorIds, "MVU_RULE_TARGET_SELECTOR_INVALID") };
}

function parseRuleAction(value: unknown): RuleActionV3 {
  const record = requireRecord(value, "MVU_RULE_ACTION_INVALID");
  const kind = requireEnum(record, "kind", ["change_field", "activate_effect_group"] as const, "MVU_RULE_ACTION_INVALID");
  if (kind === "activate_effect_group") {
    assertKeys(record, ["kind", "effectGroupId"], [], "MVU_RULE_ACTION_INVALID");
    return { kind, effectGroupId: requireBoundedNonEmptyString(record, "effectGroupId", 256, "MVU_RULE_ACTION_INVALID") };
  }
  assertKeys(record, ["kind", "fieldId", "target", "delta", "effectGroupIds"], [], "MVU_RULE_ACTION_INVALID");
  return {
    kind,
    fieldId: requireBoundedNonEmptyString(record, "fieldId", 256, "MVU_RULE_ACTION_INVALID"),
    target: parseRuleTargetSelector(record.target),
    delta: requireNumber(record, "delta", "MVU_RULE_ACTION_INVALID"),
    effectGroupIds: parseBoundedStringArray(record.effectGroupIds, "MVU_RULE_ACTION_INVALID"),
  };
}

function parseRuleInput(value: unknown, patch: false): RuleInput;
function parseRuleInput(value: unknown, patch: true): RulePatch;
function parseRuleInput(value: unknown, patch: boolean): RuleInput | RulePatch {
  const record = requireRecord(value, patch ? "MVU_RULE_PATCH_INVALID" : "MVU_RULE_INPUT_INVALID");
  const keys = ["name", "description", "enabled", "triggerActorSelector", "conditionId", "actions", "cooldownHours", "executionOrder"];
  assertKeys(record, patch ? [] : keys, patch ? keys : [], patch ? "MVU_RULE_PATCH_INVALID" : "MVU_RULE_INPUT_INVALID");
  const result: RulePatch = {};
  if (hasOwn(record, "name")) result.name = requireBoundedNonEmptyString(record, "name", 256, "MVU_RULE_INPUT_INVALID");
  if (hasOwn(record, "description")) result.description = requireBoundedString(record, "description", 4_096, "MVU_RULE_INPUT_INVALID");
  if (hasOwn(record, "enabled")) result.enabled = requireBoolean(record, "enabled", "MVU_RULE_INPUT_INVALID");
  if (hasOwn(record, "triggerActorSelector")) result.triggerActorSelector = parseRuleActorSelector(record.triggerActorSelector);
  if (hasOwn(record, "conditionId")) result.conditionId = requireBoundedNonEmptyString(record, "conditionId", 256, "MVU_RULE_INPUT_INVALID");
  if (hasOwn(record, "actions")) {
    if (!Array.isArray(record.actions) || record.actions.length > 100) fail("MVU_RULE_INPUT_INVALID");
    result.actions = record.actions.map(parseRuleAction);
  }
  if (hasOwn(record, "cooldownHours")) result.cooldownHours = requireNumber(record, "cooldownHours", "MVU_RULE_INPUT_INVALID");
  if (hasOwn(record, "executionOrder")) result.executionOrder = requireNumber(record, "executionOrder", "MVU_RULE_INPUT_INVALID");
  return result;
}

function parseCreateConditionRequest(value: unknown): CreateConditionRequest {
  const record = requireRecord(value, "MVU_CREATE_CONDITION_REQUEST_INVALID");
  assertKeys(record, ["condition", "expectedRevision"], [], "MVU_CREATE_CONDITION_REQUEST_INVALID");
  return {
    expectedRevision: requireExpectedRevision(record, "MVU_CREATE_CONDITION_REVISION_INVALID"),
    condition: parseConditionInput(record.condition, false),
  };
}

function parseUpdateConditionRequest(value: unknown): UpdateConditionRequest {
  const record = requireRecord(value, "MVU_UPDATE_CONDITION_REQUEST_INVALID");
  assertKeys(record, ["id", "patch", "expectedRevision"], [], "MVU_UPDATE_CONDITION_REQUEST_INVALID");
  return {
    id: requireBoundedNonEmptyString(record, "id", 256, "MVU_CONDITION_ID_INVALID"),
    expectedRevision: requireExpectedRevision(record, "MVU_UPDATE_CONDITION_REVISION_INVALID"),
    patch: parseConditionInput(record.patch, true),
  };
}

function parseCreateEffectGroupRequest(value: unknown): CreateEffectGroupRequest {
  const record = requireRecord(value, "MVU_CREATE_EFFECT_GROUP_REQUEST_INVALID");
  assertKeys(record, ["effectGroup", "expectedRevision"], [], "MVU_CREATE_EFFECT_GROUP_REQUEST_INVALID");
  return {
    expectedRevision: requireExpectedRevision(record, "MVU_CREATE_EFFECT_GROUP_REVISION_INVALID"),
    effectGroup: parseEffectGroupInput(record.effectGroup, false),
  };
}

function parseUpdateEffectGroupRequest(value: unknown): UpdateEffectGroupRequest {
  const record = requireRecord(value, "MVU_UPDATE_EFFECT_GROUP_REQUEST_INVALID");
  assertKeys(record, ["id", "patch", "expectedRevision"], [], "MVU_UPDATE_EFFECT_GROUP_REQUEST_INVALID");
  return {
    id: requireBoundedNonEmptyString(record, "id", 256, "MVU_EFFECT_GROUP_ID_INVALID"),
    expectedRevision: requireExpectedRevision(record, "MVU_UPDATE_EFFECT_GROUP_REVISION_INVALID"),
    patch: parseEffectGroupInput(record.patch, true),
  };
}

function parseCreateRuleRequest(value: unknown): CreateRuleRequest {
  const record = requireRecord(value, "MVU_CREATE_RULE_REQUEST_INVALID");
  assertKeys(record, ["rule", "expectedRevision"], [], "MVU_CREATE_RULE_REQUEST_INVALID");
  return {
    expectedRevision: requireExpectedRevision(record, "MVU_CREATE_RULE_REVISION_INVALID"),
    rule: parseRuleInput(record.rule, false),
  };
}

function parseUpdateRuleRequest(value: unknown): UpdateRuleRequest {
  const record = requireRecord(value, "MVU_UPDATE_RULE_REQUEST_INVALID");
  assertKeys(record, ["id", "patch", "expectedRevision"], [], "MVU_UPDATE_RULE_REQUEST_INVALID");
  return {
    id: requireBoundedNonEmptyString(record, "id", 256, "MVU_RULE_ID_INVALID"),
    expectedRevision: requireExpectedRevision(record, "MVU_UPDATE_RULE_REVISION_INVALID"),
    patch: parseRuleInput(record.patch, true),
  };
}

function parseToggleRequest(value: unknown, entity: "CONDITION" | "EFFECT_GROUP" | "RULE"): ToggleEntityRequest {
  const code = `MVU_TOGGLE_${entity}_REQUEST_INVALID`;
  const record = requireRecord(value, code);
  assertKeys(record, ["id", "enabled", "expectedRevision"], [], code);
  return {
    id: requireBoundedNonEmptyString(record, "id", 256, code),
    expectedRevision: requireExpectedRevision(record, code),
    enabled: requireBoolean(record, "enabled", code),
  };
}

export const MVU_REQUEST_PARSERS = {
  snapshot: parseSnapshotRequest,
  setStateValue: parseSetStateValueRequest,
  addField: parseAddFieldRequest,
  updateField: parseUpdateFieldRequest,
  deleteField: parseIdRequest,
  settleNatural: parseScopeContextRequest,
  addLinkRule: parseAddLinkRuleRequest,
  updateLinkRule: parseUpdateLinkRuleRequest,
  deleteLinkRule: parseIdRequest,
  addAutoRule: parseAddAutoRuleRequest,
  updateAutoRule: parseUpdateAutoRuleRequest,
  deleteAutoRule: parseIdRequest,
  updateSettings: parseUpdateSettingsRequest,
  probeModel: parseEmptyRequest,
  judgeState: parseJudgeStateRequest,
  exportDataset: parseEmptyRequest,
  importDataset: parseImportDatasetRequest,
  exportFieldTemplate: parseExportFieldTemplateRequest,
  previewFieldTemplateImport: parseTemplateJsonRequest,
  importFieldTemplate: parseImportFieldTemplateRequest,
  addTemporaryEffect: parseAddTemporaryEffectRequest,
  updateTemporaryEffect: parseUpdateTemporaryEffectRequest,
  deleteTemporaryEffect: parseIdRequest,
  queryFields: parseFieldsQuery,
  queryActors: parseActorsQuery,
  queryGroups: parseGroupsQuery,
  queryRules: parseRulesQuery,
  queryConditions: parseConditionsQuery,
  queryEffectGroups: parseEffectGroupsQuery,
  queryRecords: parseRecordsQuery,
  getEntityById: parseGetEntityByIdRequest,
  createCondition: parseCreateConditionRequest,
  updateCondition: parseUpdateConditionRequest,
  copyCondition: (value: unknown) => parseRevisionedIdRequest(value, "MVU_COPY_CONDITION_REQUEST_INVALID"),
  toggleCondition: (value: unknown) => parseToggleRequest(value, "CONDITION"),
  deleteCondition: (value: unknown) => parseRevisionedIdRequest(value, "MVU_DELETE_CONDITION_REQUEST_INVALID"),
  getConditionReferences: (value: unknown) => parseReferenceQueryRequest(value, "MVU_CONDITION_REFERENCES_REQUEST_INVALID"),
  createEffectGroup: parseCreateEffectGroupRequest,
  updateEffectGroup: parseUpdateEffectGroupRequest,
  copyEffectGroup: (value: unknown) => parseRevisionedIdRequest(value, "MVU_COPY_EFFECT_GROUP_REQUEST_INVALID"),
  toggleEffectGroup: (value: unknown) => parseToggleRequest(value, "EFFECT_GROUP"),
  deleteEffectGroup: (value: unknown) => parseRevisionedIdRequest(value, "MVU_DELETE_EFFECT_GROUP_REQUEST_INVALID"),
  getEffectGroupReferences: (value: unknown) => parseReferenceQueryRequest(value, "MVU_EFFECT_GROUP_REFERENCES_REQUEST_INVALID"),
  createRule: parseCreateRuleRequest,
  updateRule: parseUpdateRuleRequest,
  copyRule: (value: unknown) => parseRevisionedIdRequest(value, "MVU_COPY_RULE_REQUEST_INVALID"),
  toggleRule: (value: unknown) => parseToggleRequest(value, "RULE"),
  deleteRule: (value: unknown) => parseRevisionedIdRequest(value, "MVU_DELETE_RULE_REQUEST_INVALID"),
  getRuleReferences: parseIdRequest,
} as const;

function guarded<TRequest, TResult>(
  operation: string,
  parse: (payload: unknown) => TRequest,
  handler: (request: TRequest) => TResult | Promise<TResult>
): (payload: unknown) => Promise<TResult> {
  return async (payload: unknown): Promise<TResult> => {
    try {
      return await handler(parse(payload));
    } catch (error) {
      console.error(`MVU IPC ${operation} failed`, error);
      throw error;
    }
  };
}

export function installMvuIpc(runtime: MvuRuntime, deps: MvuIpcDependencies): () => void {
  const unsubscribers = [
    ToolPkg.ipc.on<unknown, MvuPageSnapshot>(
      MVU_IPC.snapshot,
      guarded("snapshot", MVU_REQUEST_PARSERS.snapshot, (request) => deps.snapshot(request))
    ),
    ToolPkg.ipc.on<unknown, void>(
      MVU_IPC.setStateValue,
      guarded("setStateValue", MVU_REQUEST_PARSERS.setStateValue, async (request) => {
        await runtime.service.setStateValue({
          context: request.scopeContext,
          fieldId: request.fieldId,
          value: request.value,
          reason: request.reason,
          source: "manual",
          ruleIds: [],
          confidence: null,
          messageId: null,
          variantId: null,
          occurredAt: Date.now(),
        });
      })
    ),
    ToolPkg.ipc.on<unknown, DataField>(
      MVU_IPC.addField,
      guarded("addField", MVU_REQUEST_PARSERS.addField, (request) => runtime.service.addField(request.field))
    ),
    ToolPkg.ipc.on<unknown, void>(
      MVU_IPC.updateField,
      guarded("updateField", MVU_REQUEST_PARSERS.updateField, (request) => runtime.service.updateField(request.id, request.patch))
    ),
    ToolPkg.ipc.on<unknown, void>(
      MVU_IPC.deleteField,
      guarded("deleteField", MVU_REQUEST_PARSERS.deleteField, (request) => runtime.service.deleteField(request.id))
    ),
    ToolPkg.ipc.on<unknown, void>(
      MVU_IPC.settleNatural,
      guarded("settleNatural", MVU_REQUEST_PARSERS.settleNatural, async (request) => {
        await runtime.service.settleNatural(request.scopeContext);
      })
    ),
    ToolPkg.ipc.on<unknown, DataLinkRule>(
      MVU_IPC.addLinkRule,
      guarded("addLinkRule", MVU_REQUEST_PARSERS.addLinkRule, (request) => runtime.service.addLinkRule(request.rule))
    ),
    ToolPkg.ipc.on<unknown, void>(
      MVU_IPC.updateLinkRule,
      guarded("updateLinkRule", MVU_REQUEST_PARSERS.updateLinkRule, (request) => runtime.service.updateLinkRule(request.id, request.patch))
    ),
    ToolPkg.ipc.on<unknown, void>(
      MVU_IPC.deleteLinkRule,
      guarded("deleteLinkRule", MVU_REQUEST_PARSERS.deleteLinkRule, (request) => runtime.service.deleteLinkRule(request.id))
    ),
    ToolPkg.ipc.on<unknown, DataAutoRule>(
      MVU_IPC.addAutoRule,
      guarded("addAutoRule", MVU_REQUEST_PARSERS.addAutoRule, (request) => runtime.service.addAutoRule(request.rule))
    ),
    ToolPkg.ipc.on<unknown, void>(
      MVU_IPC.updateAutoRule,
      guarded("updateAutoRule", MVU_REQUEST_PARSERS.updateAutoRule, (request) => runtime.service.updateAutoRule(request.id, request.patch))
    ),
    ToolPkg.ipc.on<unknown, void>(
      MVU_IPC.deleteAutoRule,
      guarded("deleteAutoRule", MVU_REQUEST_PARSERS.deleteAutoRule, (request) => runtime.service.deleteAutoRule(request.id))
    ),
    ToolPkg.ipc.on<unknown, void>(
      MVU_IPC.updateSettings,
      guarded("updateSettings", MVU_REQUEST_PARSERS.updateSettings, async (request) => {
        const dataset = await runtime.dataset();
        await runtime.service.updateSettings({ ...dataset.settings, ...request.patch });
      })
    ),
    ToolPkg.ipc.on<unknown, BackgroundModelProbeResult>(
      MVU_IPC.probeModel,
      guarded("probeModel", MVU_REQUEST_PARSERS.probeModel, () => deps.systemModel.probe())
    ),
    ToolPkg.ipc.on<unknown, JudgeStateResponse>(
      MVU_IPC.judgeState,
      guarded("judgeState", MVU_REQUEST_PARSERS.judgeState, async (request) => {
        const [fields, recentFacts] = await Promise.all([
          runtime.service.projectFields(request.scopeContext),
          runtime.getRecentMessageFacts(request.scopeContext, 20),
        ]);
        const judgement = await deps.systemModel.judgeState({
          context: request.scopeContext,
          fields,
          recentFacts,
          message: request.message,
        });
        let applied = false;
        if (request.commit && judgement.available) {
          const records = await runtime.applyAiJudgement({
            context: request.scopeContext,
            changes: judgement.changes,
            occurredAt: Date.now(),
          });
          applied = records.length > 0;
        }
        return {
          available: judgement.available,
          applied,
          changes: judgement.changes,
          raw: judgement.raw,
        };
      })
    ),
    ToolPkg.ipc.on<unknown, ExportDatasetResponse>(
      MVU_IPC.exportDataset,
      guarded("exportDataset", MVU_REQUEST_PARSERS.exportDataset, async () => {
        const fileName = buildExportFileName(new Date());
        const savedPath = `${MVU_EXPORT_DIRECTORY}/${fileName}`;
        const json = JSON.stringify(await runtime.exportDataset(), null, 2);
        const directoryResult = await Tools.Files.mkdir(MVU_EXPORT_DIRECTORY, true, "android");
        requireSuccessfulFileOperation("DIRECTORY_CREATE", directoryResult);
        const writeResult = await Tools.Files.write(savedPath, json, false, "android");
        requireSuccessfulFileOperation("WRITE", writeResult);
        return { fileName, savedPath };
      })
    ),
    ToolPkg.ipc.on<unknown, void>(
      MVU_IPC.importDataset,
      guarded("importDataset", MVU_REQUEST_PARSERS.importDataset, async (request) => {
        const parsed = normalizeMvuDataset(JSON.parse(request.json));
        await runtime.service.replaceDataset(parsed);
      })
    ),
    ToolPkg.ipc.on<unknown, ExportFieldTemplateResponse>(
      MVU_IPC.exportFieldTemplate,
      guarded("exportFieldTemplate", MVU_REQUEST_PARSERS.exportFieldTemplate, async (request) => {
        const exported = await deps.queries.exportFieldTemplate(request);
        if (!/^operit-mvu-field-template-[a-z0-9][a-z0-9-]{0,80}-\d{8}-\d{6}Z\.json$/.test(exported.fileName)) {
          throw new Error("MVU_FIELD_TEMPLATE_EXPORT_FILENAME_INVALID");
        }
        const savedPath = `${MVU_EXPORT_DIRECTORY}/${exported.fileName}`;
        const directoryResult = await Tools.Files.mkdir(MVU_EXPORT_DIRECTORY, true, "android");
        requireSuccessfulFileOperation("DIRECTORY_CREATE", directoryResult);
        const writeResult = await Tools.Files.write(savedPath, exported.json, false, "android");
        requireSuccessfulFileOperation("WRITE", writeResult);
        return { fileName: exported.fileName, savedPath, summary: exported.summary };
      })
    ),
    ToolPkg.ipc.on<unknown, FieldTemplatePreview>(
      MVU_IPC.previewFieldTemplateImport,
      guarded("previewFieldTemplateImport", MVU_REQUEST_PARSERS.previewFieldTemplateImport,
        (request) => deps.queries.previewFieldTemplateImport(request))
    ),
    ToolPkg.ipc.on<unknown, FieldTemplateImportResult>(
      MVU_IPC.importFieldTemplate,
      guarded("importFieldTemplate", MVU_REQUEST_PARSERS.importFieldTemplate,
        (request) => deps.queries.importFieldTemplate(request))
    ),
    ToolPkg.ipc.on<unknown, DataTemporaryEffect>(
      MVU_IPC.addTemporaryEffect,
      guarded("addTemporaryEffect", MVU_REQUEST_PARSERS.addTemporaryEffect, (request) => runtime.service.addTemporaryEffect(request.effect))
    ),
    ToolPkg.ipc.on<unknown, void>(
      MVU_IPC.updateTemporaryEffect,
      guarded("updateTemporaryEffect", MVU_REQUEST_PARSERS.updateTemporaryEffect, (request) => runtime.service.updateTemporaryEffect(request.id, request.patch))
    ),
    ToolPkg.ipc.on<unknown, void>(
      MVU_IPC.deleteTemporaryEffect,
      guarded("deleteTemporaryEffect", MVU_REQUEST_PARSERS.deleteTemporaryEffect, (request) => runtime.service.deleteTemporaryEffect(request.id))
    ),
    ToolPkg.ipc.on<unknown, QueryResponse<FieldQueryItem>>(
      MVU_IPC.queryFields,
      guarded("queryFields", MVU_REQUEST_PARSERS.queryFields, (request) => deps.queries.queryFields(request))
    ),
    ToolPkg.ipc.on<unknown, QueryResponse<DataActor>>(
      MVU_IPC.queryActors,
      guarded("queryActors", MVU_REQUEST_PARSERS.queryActors, (request) => deps.queries.queryActors(request))
    ),
    ToolPkg.ipc.on<unknown, QueryResponse<QueryGroup>>(
      MVU_IPC.queryGroups,
      guarded("queryGroups", MVU_REQUEST_PARSERS.queryGroups, (request) => deps.queries.queryGroups(request))
    ),
    ToolPkg.ipc.on<unknown, QueryResponse<RuleDefinitionV3>>(
      MVU_IPC.queryRules,
      guarded("queryRules", MVU_REQUEST_PARSERS.queryRules, (request) => deps.queries.queryRules(request))
    ),
    ToolPkg.ipc.on<unknown, QueryResponse<ConditionDefinition>>(
      MVU_IPC.queryConditions,
      guarded("queryConditions", MVU_REQUEST_PARSERS.queryConditions, (request) => deps.queries.queryConditions(request))
    ),
    ToolPkg.ipc.on<unknown, QueryResponse<EffectGroupDefinition>>(
      MVU_IPC.queryEffectGroups,
      guarded("queryEffectGroups", MVU_REQUEST_PARSERS.queryEffectGroups, (request) => deps.queries.queryEffectGroups(request))
    ),
    ToolPkg.ipc.on<unknown, QueryResponse<DataChangeRecord>>(
      MVU_IPC.queryRecords,
      guarded("queryRecords", MVU_REQUEST_PARSERS.queryRecords, (request) => deps.queries.queryRecords(request))
    ),
    ToolPkg.ipc.on<unknown, Awaited<ReturnType<MvuQueryService["getEntityById"]>>>(
      MVU_IPC.getEntityById,
      guarded("getEntityById", MVU_REQUEST_PARSERS.getEntityById, (request) => deps.queries.getEntityById(request))
    ),
    ToolPkg.ipc.on<unknown, MutationResponse<ConditionDefinition>>(
      MVU_IPC.createCondition,
      guarded("createCondition", MVU_REQUEST_PARSERS.createCondition, (request) => deps.queries.createCondition(request))
    ),
    ToolPkg.ipc.on<unknown, MutationResponse<ConditionDefinition>>(
      MVU_IPC.updateCondition,
      guarded("updateCondition", MVU_REQUEST_PARSERS.updateCondition, (request) => deps.queries.updateCondition(request))
    ),
    ToolPkg.ipc.on<unknown, MutationResponse<ConditionDefinition>>(
      MVU_IPC.copyCondition,
      guarded("copyCondition", MVU_REQUEST_PARSERS.copyCondition, (request) => deps.queries.copyCondition(request))
    ),
    ToolPkg.ipc.on<unknown, MutationResponse<ConditionDefinition>>(
      MVU_IPC.toggleCondition,
      guarded("toggleCondition", MVU_REQUEST_PARSERS.toggleCondition, (request) => deps.queries.toggleCondition(request))
    ),
    ToolPkg.ipc.on<unknown, DeleteMutationResponse>(
      MVU_IPC.deleteCondition,
      guarded("deleteCondition", MVU_REQUEST_PARSERS.deleteCondition, (request) => deps.queries.deleteCondition(request))
    ),
    ToolPkg.ipc.on<unknown, QueryResponse<EntityReferenceSummary>>(
      MVU_IPC.getConditionReferences,
      guarded("getConditionReferences", MVU_REQUEST_PARSERS.getConditionReferences, (request) => deps.queries.getConditionReferences(request))
    ),
    ToolPkg.ipc.on<unknown, MutationResponse<EffectGroupDefinition>>(
      MVU_IPC.createEffectGroup,
      guarded("createEffectGroup", MVU_REQUEST_PARSERS.createEffectGroup, (request) => deps.queries.createEffectGroup(request))
    ),
    ToolPkg.ipc.on<unknown, MutationResponse<EffectGroupDefinition>>(
      MVU_IPC.updateEffectGroup,
      guarded("updateEffectGroup", MVU_REQUEST_PARSERS.updateEffectGroup, (request) => deps.queries.updateEffectGroup(request))
    ),
    ToolPkg.ipc.on<unknown, MutationResponse<EffectGroupDefinition>>(
      MVU_IPC.copyEffectGroup,
      guarded("copyEffectGroup", MVU_REQUEST_PARSERS.copyEffectGroup, (request) => deps.queries.copyEffectGroup(request))
    ),
    ToolPkg.ipc.on<unknown, MutationResponse<EffectGroupDefinition>>(
      MVU_IPC.toggleEffectGroup,
      guarded("toggleEffectGroup", MVU_REQUEST_PARSERS.toggleEffectGroup, (request) => deps.queries.toggleEffectGroup(request))
    ),
    ToolPkg.ipc.on<unknown, DeleteMutationResponse>(
      MVU_IPC.deleteEffectGroup,
      guarded("deleteEffectGroup", MVU_REQUEST_PARSERS.deleteEffectGroup, (request) => deps.queries.deleteEffectGroup(request))
    ),
    ToolPkg.ipc.on<unknown, QueryResponse<EntityReferenceSummary>>(
      MVU_IPC.getEffectGroupReferences,
      guarded("getEffectGroupReferences", MVU_REQUEST_PARSERS.getEffectGroupReferences, (request) => deps.queries.getEffectGroupReferences(request))
    ),
    ToolPkg.ipc.on<unknown, MutationResponse<RuleDefinitionV3>>(
      MVU_IPC.createRule,
      guarded("createRule", MVU_REQUEST_PARSERS.createRule, (request) => deps.queries.createRule(request))
    ),
    ToolPkg.ipc.on<unknown, MutationResponse<RuleDefinitionV3>>(
      MVU_IPC.updateRule,
      guarded("updateRule", MVU_REQUEST_PARSERS.updateRule, (request) => deps.queries.updateRule(request))
    ),
    ToolPkg.ipc.on<unknown, MutationResponse<RuleDefinitionV3>>(
      MVU_IPC.copyRule,
      guarded("copyRule", MVU_REQUEST_PARSERS.copyRule, (request) => deps.queries.copyRule(request))
    ),
    ToolPkg.ipc.on<unknown, MutationResponse<RuleDefinitionV3>>(
      MVU_IPC.toggleRule,
      guarded("toggleRule", MVU_REQUEST_PARSERS.toggleRule, (request) => deps.queries.toggleRule(request))
    ),
    ToolPkg.ipc.on<unknown, DeleteMutationResponse>(
      MVU_IPC.deleteRule,
      guarded("deleteRule", MVU_REQUEST_PARSERS.deleteRule, (request) => deps.queries.deleteRule(request))
    ),
    ToolPkg.ipc.on<unknown, EntityReferenceSummary[]>(
      MVU_IPC.getRuleReferences,
      guarded("getRuleReferences", MVU_REQUEST_PARSERS.getRuleReferences, (request) => deps.queries.getRuleReferences(request))
    ),
  ];

  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

function call<TRequest, TResult>(channel: string, payload: TRequest): Promise<TResult> {
  return ToolPkg.ipc.call<TRequest, TResult>(channel, payload, MAIN_TARGET);
}

export const mvuIpcClient = {
  snapshot(request: SnapshotRequest): Promise<MvuPageSnapshot> {
    return call<SnapshotRequest, MvuPageSnapshot>(MVU_IPC.snapshot, request);
  },
  setStateValue(request: SetStateValueRequest): Promise<void> {
    return call<SetStateValueRequest, void>(MVU_IPC.setStateValue, request);
  },
  addField(request: AddFieldRequest): Promise<DataField> {
    return call<AddFieldRequest, DataField>(MVU_IPC.addField, request);
  },
  updateField(request: UpdateFieldRequest): Promise<void> {
    return call<UpdateFieldRequest, void>(MVU_IPC.updateField, request);
  },
  deleteField(request: IdRequest): Promise<void> {
    return call<IdRequest, void>(MVU_IPC.deleteField, request);
  },
  settleNatural(request: ScopeContextRequest): Promise<void> {
    return call<ScopeContextRequest, void>(MVU_IPC.settleNatural, request);
  },
  addLinkRule(request: AddLinkRuleRequest): Promise<DataLinkRule> {
    return call<AddLinkRuleRequest, DataLinkRule>(MVU_IPC.addLinkRule, request);
  },
  updateLinkRule(request: UpdateLinkRuleRequest): Promise<void> {
    return call<UpdateLinkRuleRequest, void>(MVU_IPC.updateLinkRule, request);
  },
  deleteLinkRule(request: IdRequest): Promise<void> {
    return call<IdRequest, void>(MVU_IPC.deleteLinkRule, request);
  },
  addAutoRule(request: AddAutoRuleRequest): Promise<DataAutoRule> {
    return call<AddAutoRuleRequest, DataAutoRule>(MVU_IPC.addAutoRule, request);
  },
  updateAutoRule(request: UpdateAutoRuleRequest): Promise<void> {
    return call<UpdateAutoRuleRequest, void>(MVU_IPC.updateAutoRule, request);
  },
  deleteAutoRule(request: IdRequest): Promise<void> {
    return call<IdRequest, void>(MVU_IPC.deleteAutoRule, request);
  },
  updateSettings(request: UpdateSettingsRequest): Promise<void> {
    return call<UpdateSettingsRequest, void>(MVU_IPC.updateSettings, request);
  },
  probeModel(request: EmptyRequest): Promise<BackgroundModelProbeResult> {
    return call<EmptyRequest, BackgroundModelProbeResult>(MVU_IPC.probeModel, request);
  },
  judgeState(request: JudgeStateRequest): Promise<JudgeStateResponse> {
    return call<JudgeStateRequest, JudgeStateResponse>(MVU_IPC.judgeState, request);
  },
  exportDataset(request: EmptyRequest): Promise<ExportDatasetResponse> {
    return call<EmptyRequest, ExportDatasetResponse>(MVU_IPC.exportDataset, request);
  },
  importDataset(request: ImportDatasetRequest): Promise<void> {
    return call<ImportDatasetRequest, void>(MVU_IPC.importDataset, request);
  },
  exportFieldTemplate(request: ExportFieldTemplateRequest): Promise<ExportFieldTemplateResponse> {
    return call<ExportFieldTemplateRequest, ExportFieldTemplateResponse>(MVU_IPC.exportFieldTemplate, request);
  },
  previewFieldTemplateImport(request: PreviewFieldTemplateImportRequest): Promise<FieldTemplatePreview> {
    return call<PreviewFieldTemplateImportRequest, FieldTemplatePreview>(MVU_IPC.previewFieldTemplateImport, request);
  },
  importFieldTemplate(request: ImportFieldTemplateRequest): Promise<FieldTemplateImportResult> {
    return call<ImportFieldTemplateRequest, FieldTemplateImportResult>(MVU_IPC.importFieldTemplate, request);
  },
  addTemporaryEffect(request: AddTemporaryEffectRequest): Promise<DataTemporaryEffect> {
    return call<AddTemporaryEffectRequest, DataTemporaryEffect>(MVU_IPC.addTemporaryEffect, request);
  },
  updateTemporaryEffect(request: UpdateTemporaryEffectRequest): Promise<void> {
    return call<UpdateTemporaryEffectRequest, void>(MVU_IPC.updateTemporaryEffect, request);
  },
  deleteTemporaryEffect(request: IdRequest): Promise<void> {
    return call<IdRequest, void>(MVU_IPC.deleteTemporaryEffect, request);
  },
  queryFields(request: QueryRequest): Promise<QueryResponse<FieldQueryItem>> {
    return call<QueryRequest, QueryResponse<FieldQueryItem>>(MVU_IPC.queryFields, request);
  },
  queryActors(request: QueryRequest): Promise<QueryResponse<DataActor>> {
    return call<QueryRequest, QueryResponse<DataActor>>(MVU_IPC.queryActors, request);
  },
  queryGroups(request: QueryRequest): Promise<QueryResponse<QueryGroup>> {
    return call<QueryRequest, QueryResponse<QueryGroup>>(MVU_IPC.queryGroups, request);
  },
  queryRules(request: QueryRequest): Promise<QueryResponse<RuleDefinitionV3>> {
    return call<QueryRequest, QueryResponse<RuleDefinitionV3>>(MVU_IPC.queryRules, request);
  },
  queryConditions(request: QueryRequest): Promise<QueryResponse<ConditionDefinition>> {
    return call<QueryRequest, QueryResponse<ConditionDefinition>>(MVU_IPC.queryConditions, request);
  },
  queryEffectGroups(request: QueryRequest): Promise<QueryResponse<EffectGroupDefinition>> {
    return call<QueryRequest, QueryResponse<EffectGroupDefinition>>(MVU_IPC.queryEffectGroups, request);
  },
  queryRecords(request: QueryRequest): Promise<QueryResponse<DataChangeRecord>> {
    return call<QueryRequest, QueryResponse<DataChangeRecord>>(MVU_IPC.queryRecords, request);
  },
  getEntityById(request: GetEntityByIdRequest): ReturnType<MvuQueryService["getEntityById"]> {
    return call<GetEntityByIdRequest, Awaited<ReturnType<MvuQueryService["getEntityById"]>>>(MVU_IPC.getEntityById, request);
  },
  createCondition(request: CreateConditionRequest): Promise<MutationResponse<ConditionDefinition>> {
    return call<CreateConditionRequest, MutationResponse<ConditionDefinition>>(MVU_IPC.createCondition, request);
  },
  updateCondition(request: UpdateConditionRequest): Promise<MutationResponse<ConditionDefinition>> {
    return call<UpdateConditionRequest, MutationResponse<ConditionDefinition>>(MVU_IPC.updateCondition, request);
  },
  copyCondition(request: RevisionedIdRequest): Promise<MutationResponse<ConditionDefinition>> {
    return call<RevisionedIdRequest, MutationResponse<ConditionDefinition>>(MVU_IPC.copyCondition, request);
  },
  toggleCondition(request: ToggleEntityRequest): Promise<MutationResponse<ConditionDefinition>> {
    return call<ToggleEntityRequest, MutationResponse<ConditionDefinition>>(MVU_IPC.toggleCondition, request);
  },
  deleteCondition(request: RevisionedIdRequest): Promise<DeleteMutationResponse> {
    return call<RevisionedIdRequest, DeleteMutationResponse>(MVU_IPC.deleteCondition, request);
  },
  getConditionReferences(request: ReferenceQueryRequest): Promise<QueryResponse<EntityReferenceSummary>> {
    return call<ReferenceQueryRequest, QueryResponse<EntityReferenceSummary>>(MVU_IPC.getConditionReferences, request);
  },
  createEffectGroup(request: CreateEffectGroupRequest): Promise<MutationResponse<EffectGroupDefinition>> {
    return call<CreateEffectGroupRequest, MutationResponse<EffectGroupDefinition>>(MVU_IPC.createEffectGroup, request);
  },
  updateEffectGroup(request: UpdateEffectGroupRequest): Promise<MutationResponse<EffectGroupDefinition>> {
    return call<UpdateEffectGroupRequest, MutationResponse<EffectGroupDefinition>>(MVU_IPC.updateEffectGroup, request);
  },
  copyEffectGroup(request: RevisionedIdRequest): Promise<MutationResponse<EffectGroupDefinition>> {
    return call<RevisionedIdRequest, MutationResponse<EffectGroupDefinition>>(MVU_IPC.copyEffectGroup, request);
  },
  toggleEffectGroup(request: ToggleEntityRequest): Promise<MutationResponse<EffectGroupDefinition>> {
    return call<ToggleEntityRequest, MutationResponse<EffectGroupDefinition>>(MVU_IPC.toggleEffectGroup, request);
  },
  deleteEffectGroup(request: RevisionedIdRequest): Promise<DeleteMutationResponse> {
    return call<RevisionedIdRequest, DeleteMutationResponse>(MVU_IPC.deleteEffectGroup, request);
  },
  getEffectGroupReferences(request: ReferenceQueryRequest): Promise<QueryResponse<EntityReferenceSummary>> {
    return call<ReferenceQueryRequest, QueryResponse<EntityReferenceSummary>>(MVU_IPC.getEffectGroupReferences, request);
  },
  createRule(request: CreateRuleRequest): Promise<MutationResponse<RuleDefinitionV3>> {
    return call<CreateRuleRequest, MutationResponse<RuleDefinitionV3>>(MVU_IPC.createRule, request);
  },
  updateRule(request: UpdateRuleRequest): Promise<MutationResponse<RuleDefinitionV3>> {
    return call<UpdateRuleRequest, MutationResponse<RuleDefinitionV3>>(MVU_IPC.updateRule, request);
  },
  copyRule(request: RevisionedIdRequest): Promise<MutationResponse<RuleDefinitionV3>> {
    return call<RevisionedIdRequest, MutationResponse<RuleDefinitionV3>>(MVU_IPC.copyRule, request);
  },
  toggleRule(request: ToggleEntityRequest): Promise<MutationResponse<RuleDefinitionV3>> {
    return call<ToggleEntityRequest, MutationResponse<RuleDefinitionV3>>(MVU_IPC.toggleRule, request);
  },
  deleteRule(request: RevisionedIdRequest): Promise<DeleteMutationResponse> {
    return call<RevisionedIdRequest, DeleteMutationResponse>(MVU_IPC.deleteRule, request);
  },
  getRuleReferences(request: IdRequest): Promise<EntityReferenceSummary[]> {
    return call<IdRequest, EntityReferenceSummary[]>(MVU_IPC.getRuleReferences, request);
  },
} as const;
