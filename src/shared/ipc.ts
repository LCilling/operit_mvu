/** Strict typed IPC contract shared by the ToolPkg main runtime and WebView container. */
import type { MvuRuntime, MvuSnapshotView } from "../mvu/app/index";
import type {
  AutoRuleCondition,
  DataAutoRule,
  DataField,
  DataLinkRule,
  DataTemporaryEffect,
  MvuSettings,
  StateScopeContext,
} from "../mvu/app/model";
import type { PersistedAiChange } from "../mvu/app/service";
import type {
  BackgroundModelProbeResult,
  SystemModelApi,
} from "../mvu/app/system-model";
import { assertMvuDataset } from "../mvu/app/validation";

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
  addTemporaryEffect: "operit_mvu:add_temporary_effect",
  updateTemporaryEffect: "operit_mvu:update_temporary_effect",
  deleteTemporaryEffect: "operit_mvu:delete_temporary_effect",
} as const;

export type EmptyRequest = Record<string, never>;
export interface SnapshotRequest { actorId?: string; }
export interface MvuPageSnapshot extends MvuSnapshotView {
  selectableActorIds: string[];
}
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

export interface ImportDatasetRequest { json: string; }
export interface AddTemporaryEffectRequest { effect: TemporaryEffectInput; }
export interface UpdateTemporaryEffectRequest { id: string; patch: TemporaryEffectPatch; }

export interface MvuIpcDependencies {
  snapshot(request: SnapshotRequest): Promise<MvuPageSnapshot>;
  systemModel: SystemModelApi;
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
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  assertKeys(record, [], ["actorId"], "MVU_SNAPSHOT_REQUEST_INVALID");
  if (!hasOwn(record, "actorId")) return {};
  const actorId = requireNonEmptyString(record, "actorId", "MVU_SNAPSHOT_ACTOR_ID_INVALID");
  if (actorId.trim().length === 0) fail("MVU_SNAPSHOT_ACTOR_ID_INVALID");
  return { actorId };
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
    ["recentPositive", "longInactive", "userCare", "specialDay", "highFreq", "stateThreshold"] as const,
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
    case "userCare":
    case "specialDay":
      assertKeys(record, ["kind"], [], "MVU_AUTO_CONDITION_INVALID");
      return { kind };
  }
}

function parseAutoEffect(value: unknown): DataAutoRule["effects"][number] {
  const record = requireRecord(value, "MVU_AUTO_EFFECT_INVALID");
  assertKeys(record, ["fieldId", "delta"], [], "MVU_AUTO_EFFECT_INVALID");
  return {
    fieldId: requireNonEmptyString(record, "fieldId", "MVU_AUTO_EFFECT_FIELD_REQUIRED"),
    delta: requireNumber(record, "delta", "MVU_AUTO_EFFECT_DELTA_REQUIRED"),
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
  "targetFieldId", "scope", "scopeKey", "mode", "value", "enabled", "expiresAt",
  "remainingTurns", "reason", "source", "createdAt",
] as const;

function parseTemporaryEffectInput(value: unknown): TemporaryEffectInput {
  const record = requireRecord(value, "MVU_TEMPORARY_EFFECT_INPUT_INVALID");
  assertKeys(record, TEMPORARY_EFFECT_KEYS, [], "MVU_TEMPORARY_EFFECT_INPUT_INVALID");
  return {
    targetFieldId: requireNonEmptyString(record, "targetFieldId", "MVU_EFFECT_TARGET_REQUIRED"),
    scope: requireEnum(record, "scope", ["character", "group", "global", "chat"] as const, "MVU_EFFECT_SCOPE_REQUIRED"),
    scopeKey: requireNonEmptyString(record, "scopeKey", "MVU_EFFECT_SCOPE_KEY_REQUIRED"),
    mode: requireEnum(record, "mode", ["multiplier", "additive"] as const, "MVU_EFFECT_MODE_REQUIRED"),
    value: requireNumber(record, "value", "MVU_EFFECT_VALUE_REQUIRED"),
    enabled: requireBoolean(record, "enabled", "MVU_EFFECT_ENABLED_REQUIRED"),
    expiresAt: requireNullableNumber(record, "expiresAt", "MVU_EFFECT_EXPIRES_REQUIRED"),
    remainingTurns: requireNullableNumber(record, "remainingTurns", "MVU_EFFECT_TURNS_REQUIRED"),
    reason: requireString(record, "reason", "MVU_EFFECT_REASON_REQUIRED"),
    source: requireEnum(record, "source", ["manual", "rule", "ai"] as const, "MVU_EFFECT_SOURCE_REQUIRED"),
    createdAt: requireNumber(record, "createdAt", "MVU_EFFECT_CREATED_REQUIRED"),
  };
}

function parseTemporaryEffectPatch(value: unknown): TemporaryEffectPatch {
  const record = requireRecord(value, "MVU_TEMPORARY_EFFECT_PATCH_INVALID");
  assertKeys(record, [], TEMPORARY_EFFECT_KEYS, "MVU_TEMPORARY_EFFECT_PATCH_INVALID");
  const patch: TemporaryEffectPatch = {};
  if (hasOwn(record, "targetFieldId")) patch.targetFieldId = requireNonEmptyString(record, "targetFieldId", "MVU_EFFECT_TARGET_REQUIRED");
  if (hasOwn(record, "scope")) patch.scope = requireEnum(record, "scope", ["character", "group", "global", "chat"] as const, "MVU_EFFECT_SCOPE_REQUIRED");
  if (hasOwn(record, "scopeKey")) patch.scopeKey = requireNonEmptyString(record, "scopeKey", "MVU_EFFECT_SCOPE_KEY_REQUIRED");
  if (hasOwn(record, "mode")) patch.mode = requireEnum(record, "mode", ["multiplier", "additive"] as const, "MVU_EFFECT_MODE_REQUIRED");
  if (hasOwn(record, "value")) patch.value = requireNumber(record, "value", "MVU_EFFECT_VALUE_REQUIRED");
  if (hasOwn(record, "enabled")) patch.enabled = requireBoolean(record, "enabled", "MVU_EFFECT_ENABLED_REQUIRED");
  if (hasOwn(record, "expiresAt")) patch.expiresAt = requireNullableNumber(record, "expiresAt", "MVU_EFFECT_EXPIRES_REQUIRED");
  if (hasOwn(record, "remainingTurns")) patch.remainingTurns = requireNullableNumber(record, "remainingTurns", "MVU_EFFECT_TURNS_REQUIRED");
  if (hasOwn(record, "reason")) patch.reason = requireString(record, "reason", "MVU_EFFECT_REASON_REQUIRED");
  if (hasOwn(record, "source")) patch.source = requireEnum(record, "source", ["manual", "rule", "ai"] as const, "MVU_EFFECT_SOURCE_REQUIRED");
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
  return { id: requireNonEmptyString(record, "id", "MVU_ID_REQUIRED") };
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
  addTemporaryEffect: parseAddTemporaryEffectRequest,
  updateTemporaryEffect: parseUpdateTemporaryEffectRequest,
  deleteTemporaryEffect: parseIdRequest,
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
        const json = JSON.stringify(await runtime.dataset(), null, 2);
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
        const parsed: unknown = JSON.parse(request.json);
        assertMvuDataset(parsed);
        await runtime.service.replaceDataset(parsed);
      })
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
  addTemporaryEffect(request: AddTemporaryEffectRequest): Promise<DataTemporaryEffect> {
    return call<AddTemporaryEffectRequest, DataTemporaryEffect>(MVU_IPC.addTemporaryEffect, request);
  },
  updateTemporaryEffect(request: UpdateTemporaryEffectRequest): Promise<void> {
    return call<UpdateTemporaryEffectRequest, void>(MVU_IPC.updateTemporaryEffect, request);
  },
  deleteTemporaryEffect(request: IdRequest): Promise<void> {
    return call<IdRequest, void>(MVU_IPC.deleteTemporaryEffect, request);
  },
} as const;
