import { klona } from "../port/util";
import type { DataChangeRecord, MessageFact, TurnCounter } from "./model";
import type {
  ActiveEffectInstance,
  ConditionExpression,
  ConditionPredicate,
  EffectActorSelector,
  EffectGroupDefinition,
  EffectOperation,
  MvuDatasetV3,
  RuleActionV3,
  RuleActorSelector,
  RuleTargetSelector,
} from "./model-v3";
import { migrateDatasetV2ToV3 } from "./migration-v3";
import { assertDataChangeRecord, assertMvuDatasetV3, normalizeMvuDataset } from "./validation";

export const FULL_BACKUP_FORMAT = "operit-mvu-full-backup";
export const FULL_BACKUP_SCHEMA_VERSION = 1;
/** Import and export share this limit so an emitted file is always importable. */
export const FULL_BACKUP_MAX_BYTES = 128 * 1_024 * 1_024;
/** Complete logical history is supported up to this explicit restore boundary. */
export const FULL_BACKUP_MAX_RECORDS = 250_000;
export const FULL_BACKUP_MAX_CONFIG_ITEMS = 100_000;
export const FULL_BACKUP_MAX_TEXT_LENGTH = 1_048_576;
export const FULL_BACKUP_MAX_DEPTH = 64;
export const FULL_BACKUP_REPLACEMENT_CONFIRMATION = "replace-all-mvu-data";
export const FULL_BACKUP_MAX_PREVIEW_WARNINGS = 100;

const FULL_BACKUP_MAX_ARRAY_ITEMS = 1_000_000;
const FULL_BACKUP_MAX_NODES = 10_000_000;

export type FullBackupV3Config = Omit<MvuDatasetV3, "revision" | "recordManifest">;

export interface FullBackupSourceSnapshot {
  revision: number;
  dataset: MvuDatasetV3;
  records: DataChangeRecord[];
}

export interface FullBackupSummary {
  sourceRevision: number;
  fieldCount: number;
  conditionCount: number;
  ruleCount: number;
  effectGroupCount: number;
  activeEffectCount: number;
  recordCount: number;
  byteCount: number;
}

export interface FullBackupExport {
  fileName: string;
  json: string;
  summary: FullBackupSummary;
}

export interface ParsedFullV3Import {
  kind: "full_v3";
  sourceFormatVersion: 3;
  schemaVersion: 1;
  exportedAt: string;
  sourceRevision: number;
  config: FullBackupV3Config;
  records: DataChangeRecord[];
  warnings: string[];
  warningCount: number;
}

export interface ParsedLegacyV2Import {
  kind: "legacy_v2";
  sourceFormatVersion: 2;
  schemaVersion: null;
  exportedAt: null;
  sourceRevision: number;
  config: FullBackupV3Config;
  records: DataChangeRecord[];
  warnings: string[];
  warningCount: number;
}

export type ParsedDatasetImport = ParsedFullV3Import | ParsedLegacyV2Import;

export interface DatasetImportPreview {
  valid: true;
  kind: ParsedDatasetImport["kind"];
  sourceFormatVersion: 2 | 3;
  schemaVersion: 1 | null;
  exportedAt: string | null;
  sourceRevision: number;
  previewRevision: number;
  expectedRevision: number;
  summary: Omit<FullBackupSummary, "sourceRevision" | "byteCount">;
  migrationWarnings: { items: string[]; totalCount: number; truncated: boolean };
  replacementWarning: string;
  confirmationValue: typeof FULL_BACKUP_REPLACEMENT_CONFIRMATION;
}

export interface DatasetImportRestoreRequest {
  json: string;
  expectedRevision: number;
  confirmation: typeof FULL_BACKUP_REPLACEMENT_CONFIRMATION;
}

export interface DatasetImportRestoreResult {
  revision: number;
  kind: ParsedDatasetImport["kind"];
  sourceFormatVersion: 2 | 3;
  sourceRevision: number;
  recordCount: number;
  migrationWarnings: { items: string[]; totalCount: number; truncated: boolean };
}

interface FullBackupDocument {
  format: typeof FULL_BACKUP_FORMAT;
  schemaVersion: typeof FULL_BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  sourceFormatVersion: 3;
  checksum: { algorithm: "sha256"; value: string };
  payload: {
    sourceRevision: number;
    config: FullBackupV3Config;
    records: DataChangeRecord[];
  };
}

type UnknownRecord = Record<string, unknown>;

const CONFIG_KEYS = [
  "formatVersion", "createdAt", "settings", "fields", "pendingBootstrapFieldIds",
  "linkRules", "conditions", "rules", "effectGroups", "activeEffects", "stateValues",
  "lastSettled", "turnCounters", "processedMessageIds", "ruleLastTriggered",
  "messageFacts", "hourlyMessageBuckets",
] as const;

const FIELD_KEYS = [
  "id", "name", "description", "minimum", "maximum", "step", "initialValue", "icon",
  "themeColor", "enabled", "scope", "modelVisibility", "ai", "stages", "bindingIds",
  "naturalChange", "perTurnChange", "order",
] as const;

const RECORD_KEYS = [
  "id", "scope", "scopeKey", "fieldId", "fieldName", "actorId", "actorName", "chatId",
  "groupId", "before", "after", "requestedDelta", "effectiveRequestedDelta", "delta",
  "stageBefore", "stageAfter", "reason", "source", "ruleIds", "effectIds", "confidence",
  "messageId", "variantId", "occurredAt",
] as const;

export function createFullBackupExport(snapshot: FullBackupSourceSnapshot, now: number): FullBackupExport {
  requireSafeRevision(snapshot.revision, "MVU_FULL_BACKUP_SOURCE_REVISION_INVALID");
  if (snapshot.dataset.revision !== snapshot.revision) {
    throw new Error("MVU_FULL_BACKUP_SNAPSHOT_REVISION_MISMATCH");
  }
  if (snapshot.dataset.recordManifest.recordCount > FULL_BACKUP_MAX_RECORDS ||
    snapshot.records.length > FULL_BACKUP_MAX_RECORDS) {
    throw new Error("MVU_FULL_BACKUP_RECORD_LIMIT");
  }
  if (snapshot.dataset.recordManifest.recordCount !== snapshot.records.length) {
    throw new Error("MVU_FULL_BACKUP_RECORD_COUNT_MISMATCH");
  }
  assertMvuDatasetV3(snapshot.dataset);
  const { revision: _revision, recordManifest: _manifest, ...config } = snapshot.dataset;
  assertFullV3Config(config);
  assertLogicalRecords(snapshot.records);
  const exportedAt = isoTimestamp(now);
  const unsigned: Omit<FullBackupDocument, "checksum"> = {
    format: FULL_BACKUP_FORMAT,
    schemaVersion: FULL_BACKUP_SCHEMA_VERSION,
    exportedAt,
    sourceFormatVersion: 3 as const,
    payload: {
      sourceRevision: snapshot.revision,
      config: klona(config),
      records: klona(snapshot.records),
    },
  };
  const document: FullBackupDocument = {
    format: unsigned.format,
    schemaVersion: unsigned.schemaVersion,
    exportedAt: unsigned.exportedAt,
    sourceFormatVersion: unsigned.sourceFormatVersion,
    checksum: { algorithm: "sha256", value: canonicalSha256(unsigned) },
    payload: unsigned.payload,
  };
  const json = JSON.stringify(document, null, 2);
  const byteCount = fullBackupUtf8ByteLength(json);
  if (byteCount > FULL_BACKUP_MAX_BYTES) throw new Error("MVU_FULL_BACKUP_TOO_LARGE");

  // This is deliberately a full public-boundary parse, not an internal assertion.
  // No caller can receive bytes that the restore endpoint would reject.
  parseDatasetImport(json, now);
  return {
    fileName: buildFullBackupFileName(exportedAt),
    json,
    summary: summaryOf(snapshot.revision, config, snapshot.records.length, byteCount),
  };
}

export function parseDatasetImport(json: string, now: number): ParsedDatasetImport {
  if (typeof json !== "string" || fullBackupUtf8ByteLength(json) > FULL_BACKUP_MAX_BYTES) {
    throw new Error("MVU_FULL_BACKUP_TOO_LARGE");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new Error("MVU_FULL_BACKUP_JSON_INVALID");
  }
  assertJsonResourceBounds(parsed);
  const document = requirePlainRecord(parsed, "MVU_FULL_BACKUP_DOCUMENT_INVALID");
  if (document.formatVersion === 2 && document.format === undefined) {
    return parseLegacyV2Import(document, now);
  }
  if (document.format !== FULL_BACKUP_FORMAT) throw new Error("MVU_DATASET_IMPORT_FORMAT_UNKNOWN");
  assertExactKeys(document, ["format", "schemaVersion", "exportedAt", "sourceFormatVersion", "checksum", "payload"]);
  if (document.schemaVersion !== FULL_BACKUP_SCHEMA_VERSION) {
    throw new Error("MVU_FULL_BACKUP_SCHEMA_VERSION_UNSUPPORTED");
  }
  if (document.sourceFormatVersion !== 3) throw new Error("MVU_FULL_BACKUP_SOURCE_VERSION_UNSUPPORTED");
  if (!isIsoTimestamp(document.exportedAt)) throw new Error("MVU_FULL_BACKUP_EXPORTED_AT_INVALID");
  const checksum = requirePlainRecord(document.checksum, "MVU_FULL_BACKUP_CHECKSUM_INVALID");
  assertExactKeys(checksum, ["algorithm", "value"]);
  if (checksum.algorithm !== "sha256" || typeof checksum.value !== "string" ||
    !/^[a-f0-9]{64}$/.test(checksum.value)) {
    throw new Error("MVU_FULL_BACKUP_CHECKSUM_INVALID");
  }
  const payload = requirePlainRecord(document.payload, "MVU_FULL_BACKUP_PAYLOAD_INVALID");
  assertExactKeys(payload, ["sourceRevision", "config", "records"]);
  const unsigned = {
    format: document.format,
    schemaVersion: document.schemaVersion,
    exportedAt: document.exportedAt,
    sourceFormatVersion: document.sourceFormatVersion,
    payload: document.payload,
  };
  if (canonicalSha256(unsigned) !== checksum.value) throw new Error("MVU_FULL_BACKUP_CHECKSUM_MISMATCH");
  requireSafeRevision(payload.sourceRevision, "MVU_FULL_BACKUP_SOURCE_REVISION_INVALID");
  const config = payload.config;
  assertFullV3Config(config);
  if (!Array.isArray(payload.records)) throw new Error("MVU_FULL_BACKUP_RECORDS_INVALID");
  assertLogicalRecords(payload.records);
  return {
    kind: "full_v3",
    sourceFormatVersion: 3,
    schemaVersion: 1,
    exportedAt: document.exportedAt,
    sourceRevision: payload.sourceRevision,
    config: klona(config),
    records: klona(payload.records),
    warnings: [],
    warningCount: 0,
  };
}

export function createDatasetImportPreview(
  json: string,
  currentRevision: number,
  now: number,
): DatasetImportPreview {
  requireSafeRevision(currentRevision, "MVU_FULL_BACKUP_PREVIEW_REVISION_INVALID");
  const parsed = parseDatasetImport(json, now);
  return {
    valid: true,
    kind: parsed.kind,
    sourceFormatVersion: parsed.sourceFormatVersion,
    schemaVersion: parsed.schemaVersion,
    exportedAt: parsed.exportedAt,
    sourceRevision: parsed.sourceRevision,
    previewRevision: currentRevision,
    expectedRevision: currentRevision,
    summary: {
      fieldCount: parsed.config.fields.length,
      conditionCount: parsed.config.conditions.length,
      ruleCount: parsed.config.rules.length,
      effectGroupCount: parsed.config.effectGroups.length,
      activeEffectCount: parsed.config.activeEffects.length,
      recordCount: parsed.records.length,
    },
    migrationWarnings: {
      items: [...parsed.warnings],
      totalCount: parsed.warningCount,
      truncated: parsed.warningCount > parsed.warnings.length,
    },
    replacementWarning: "Restoring this backup replaces all current MVU configuration, runtime state, active effects, and history. It never merges data.",
    confirmationValue: FULL_BACKUP_REPLACEMENT_CONFIRMATION,
  };
}

function parseLegacyV2Import(document: UnknownRecord, now: number): ParsedLegacyV2Import {
  assertLegacyV2Keys(document);
  if (!Array.isArray(document.records)) throw new Error("MVU_FULL_BACKUP_RECORDS_INVALID");
  if (document.records.length > FULL_BACKUP_MAX_RECORDS) throw new Error("MVU_FULL_BACKUP_RECORD_LIMIT");
  const legacy = normalizeMvuDataset(klona(document));
  const migration = migrateDatasetV2ToV3(legacy, now);
  const { revision: _revision, recordManifest: _manifest, ...config } = migration.dataset;
  assertFullV3Config(config);
  assertLogicalRecords(migration.records);
  const warnings = migration.report.warnings.slice(0, FULL_BACKUP_MAX_PREVIEW_WARNINGS).map((warning) =>
    warning.slice(0, 512));
  return {
    kind: "legacy_v2",
    sourceFormatVersion: 2,
    schemaVersion: null,
    exportedAt: null,
    sourceRevision: legacy.revision,
    config: klona(config),
    records: klona(migration.records),
    warnings,
    warningCount: migration.report.warnings.length,
  };
}

function assertLegacyV2Keys(value: UnknownRecord): void {
  assertExactKeys(value, [
    "formatVersion", "createdAt", "revision", "settings", "fields", "pendingBootstrapFieldIds",
    "rules", "autoRules", "temporaryEffects", "stateValues", "records", "lastSettled",
    "turnCounters", "processedMessageIds", "ruleLastTriggered", "messageFacts",
  ]);
  assertExactKeys(requirePlainRecord(value.settings, "MVU_FULL_BACKUP_LEGACY_INVALID"), ["aiEnabled"]);
  requireCollection(value.fields, "fields").forEach(assertFieldKeys);
  requireCollection(value.rules, "linkRules").forEach((entry) => {
    const rule = requirePlainRecord(entry, "MVU_FULL_BACKUP_LEGACY_INVALID");
    assertExactKeys(rule, ["id", "sourceFieldId", "operator", "sourceThreshold", "targetFieldId", "effect", "enabled"]);
    assertExactKeys(requirePlainRecord(rule.effect, "MVU_FULL_BACKUP_LEGACY_INVALID"), ["kind", "value"]);
  });
  requireCollection(value.autoRules, "rules").forEach(assertLegacyAutoRuleKeys);
  requireCollection(value.temporaryEffects, "effectGroups").forEach(assertLegacyTemporaryEffectKeys);
  if (!Array.isArray(value.records)) throw new Error("MVU_FULL_BACKUP_RECORDS_INVALID");
  value.records.forEach((record) => assertExactKeys(
    requirePlainRecord(record, "MVU_FULL_BACKUP_RECORD_INVALID"), RECORD_KEYS));
  assertStringArray(value.pendingBootstrapFieldIds);
  assertNestedNumberMapKeys(value.stateValues);
  assertNestedNumberMapKeys(value.lastSettled);
  assertNestedCounterMapKeys(value.turnCounters);
  assertStringArray(value.processedMessageIds);
  assertNestedNumberMapKeys(value.ruleLastTriggered);
  assertMessageFactsKeys(value.messageFacts);
}

function assertLegacyAutoRuleKeys(value: unknown): void {
  const rule = requirePlainRecord(value, "MVU_FULL_BACKUP_LEGACY_INVALID");
  assertExactKeys(rule, ["id", "name", "description", "enabled", "condition", "effects", "cooldownMs", "order"]);
  const condition = requirePlainRecord(rule.condition, "MVU_FULL_BACKUP_LEGACY_INVALID");
  switch (condition.kind) {
    case "recentPositive": assertExactKeys(condition, ["kind", "count"]); break;
    case "longInactive": assertExactKeys(condition, ["kind", "hours"]); break;
    case "userCare":
    case "specialDay": assertExactKeys(condition, ["kind"]); break;
    case "highFreq": assertExactKeys(condition, ["kind", "messages"]); break;
    case "stateThreshold": assertExactKeys(condition, ["kind", "fieldId", "operator", "threshold"]); break;
    case "aiJudgement": assertExactKeys(condition, ["kind", "triggerType", "requirement", "minimumConfidence"]); break;
    default: throw new Error("MVU_FULL_BACKUP_LEGACY_INVALID");
  }
  if (!Array.isArray(rule.effects)) throw new Error("MVU_FULL_BACKUP_LEGACY_INVALID");
  rule.effects.forEach((effectValue) => {
    const effect = requirePlainRecord(effectValue, "MVU_FULL_BACKUP_LEGACY_INVALID");
    assertExactKeys(effect, [
      "fieldId", "delta", ...(effect.temporaryEffectIds === undefined ? [] : ["temporaryEffectIds"]),
    ]);
  });
}

function assertLegacyTemporaryEffectKeys(value: unknown): void {
  const effect = requirePlainRecord(value, "MVU_FULL_BACKUP_LEGACY_INVALID");
  const optional = [
    ...(effect.triggerSources === undefined ? [] : ["triggerSources"]),
    ...(effect.source === undefined ? [] : ["source"]),
    ...(effect.reasonMode === undefined ? [] : ["reasonMode"]),
    ...(effect.reasonTemplate === undefined ? [] : ["reasonTemplate"]),
  ];
  if (Array.isArray(effect.targets)) {
    assertExactKeys(effect, [
      "id", "targets", "mode", "value", "enabled", "expiresAt", "remainingTurns",
      ...optional, "reason", "createdAt",
    ]);
    effect.targets.forEach((target) => assertExactKeys(
      requirePlainRecord(target, "MVU_FULL_BACKUP_LEGACY_INVALID"), ["fieldId", "scope", "scopeKey"]));
    return;
  }
  assertExactKeys(effect, [
    "id", "targetFieldId", "scope", "scopeKey", "mode", "value", "enabled", "expiresAt",
    "remainingTurns", ...optional, "reason", "createdAt",
  ]);
}

function summaryOf(
  sourceRevision: number,
  config: FullBackupV3Config,
  recordCount: number,
  byteCount: number,
): FullBackupSummary {
  return {
    sourceRevision,
    fieldCount: config.fields.length,
    conditionCount: config.conditions.length,
    ruleCount: config.rules.length,
    effectGroupCount: config.effectGroups.length,
    activeEffectCount: config.activeEffects.length,
    recordCount,
    byteCount,
  };
}

function assertFullV3Config(value: unknown): asserts value is FullBackupV3Config {
  const config = requirePlainRecord(value, "MVU_FULL_BACKUP_CONFIG_INVALID");
  assertExactKeys(config, CONFIG_KEYS);
  if (config.formatVersion !== 3) throw new Error("MVU_FULL_BACKUP_SOURCE_VERSION_UNSUPPORTED");
  requireCollection(config.fields, "fields").forEach(assertFieldKeys);
  requireCollection(config.linkRules, "linkRules").forEach((entry) => {
    const rule = requirePlainRecord(entry, "MVU_FULL_BACKUP_CONFIG_INVALID");
    assertExactKeys(rule, ["id", "sourceFieldId", "operator", "sourceThreshold", "targetFieldId", "effect", "enabled"]);
    const effect = requirePlainRecord(rule.effect, "MVU_FULL_BACKUP_CONFIG_INVALID");
    assertExactKeys(effect, ["kind", "value"]);
  });
  requireCollection(config.conditions, "conditions").forEach((entry) => {
    const condition = requirePlainRecord(entry, "MVU_FULL_BACKUP_CONFIG_INVALID");
    assertExactKeys(condition, ["id", "name", "description", "enabled", "expression", "createdAt", "updatedAt"]);
    assertConditionExpressionKeys(condition.expression);
  });
  requireCollection(config.rules, "rules").forEach(assertRuleKeys);
  requireCollection(config.effectGroups, "effectGroups").forEach(assertEffectGroupKeys);
  requireCollection(config.activeEffects, "activeEffects").forEach(assertActiveEffectKeys);
  assertExactKeys(requirePlainRecord(config.settings, "MVU_FULL_BACKUP_CONFIG_INVALID"), ["aiEnabled"]);
  assertStringArray(config.pendingBootstrapFieldIds);
  assertNestedNumberMapKeys(config.stateValues);
  assertNestedNumberMapKeys(config.lastSettled);
  assertNestedCounterMapKeys(config.turnCounters);
  assertStringArray(config.processedMessageIds);
  assertNestedNumberMapKeys(config.ruleLastTriggered);
  assertMessageFactsKeys(config.messageFacts);
  assertHourlyBucketKeys(config.hourlyMessageBuckets);

  const candidate: MvuDatasetV3 = {
    ...(config as unknown as FullBackupV3Config),
    revision: 0,
    recordManifest: { segments: [], recordCount: 0, nextSegmentIndex: 1 },
  };
  assertMvuDatasetV3(candidate);
}

function assertFieldKeys(value: unknown): void {
  const field = requirePlainRecord(value, "MVU_FULL_BACKUP_CONFIG_INVALID");
  assertExactKeys(field, FIELD_KEYS);
  assertExactKeys(requirePlainRecord(field.ai, "MVU_FULL_BACKUP_CONFIG_INVALID"),
    ["enabled", "minConfidence", "maxDelta", "prompt"]);
  if (!Array.isArray(field.stages)) throw new Error("MVU_FULL_BACKUP_CONFIG_INVALID");
  field.stages.forEach((stage) => assertExactKeys(
    requirePlainRecord(stage, "MVU_FULL_BACKUP_CONFIG_INVALID"),
    ["id", "name", "description", "threshold"],
  ));
  assertStringArray(field.bindingIds);
  assertExactKeys(requirePlainRecord(field.naturalChange, "MVU_FULL_BACKUP_CONFIG_INVALID"),
    ["enabled", "unitMs", "amount"]);
  assertExactKeys(requirePlainRecord(field.perTurnChange, "MVU_FULL_BACKUP_CONFIG_INVALID"),
    ["enabled", "intervalTurns", "amount", "countMode"]);
}

function assertRuleKeys(value: unknown): void {
  const rule = requirePlainRecord(value, "MVU_FULL_BACKUP_CONFIG_INVALID");
  assertExactKeys(rule, [
    "id", "name", "description", "enabled", "triggerActorSelector", "conditionId", "actions",
    "cooldownHours", "executionOrder", "createdAt", "updatedAt",
  ]);
  assertRuleActorSelectorKeys(rule.triggerActorSelector);
  if (!Array.isArray(rule.actions)) throw new Error("MVU_FULL_BACKUP_CONFIG_INVALID");
  rule.actions.forEach(assertRuleActionKeys);
}

function assertRuleActorSelectorKeys(value: unknown): void {
  const selector = requirePlainRecord(value, "MVU_FULL_BACKUP_CONFIG_INVALID") as unknown as RuleActorSelector;
  if (selector.kind === "any" || selector.kind === "current_actor") {
    assertExactKeys(selector as unknown as UnknownRecord, ["kind"]);
  } else if (selector.kind === "selected") {
    assertExactKeys(selector as unknown as UnknownRecord, ["kind", "actorIds"]);
    assertStringArray(selector.actorIds);
  } else if (selector.kind === "group") {
    assertExactKeys(selector as unknown as UnknownRecord, ["kind", "groupIds"]);
    assertStringArray(selector.groupIds);
  } else {
    throw new Error("MVU_FULL_BACKUP_CONFIG_INVALID");
  }
}

function assertRuleActionKeys(value: unknown): void {
  const action = requirePlainRecord(value, "MVU_FULL_BACKUP_CONFIG_INVALID") as unknown as RuleActionV3;
  if (action.kind === "change_field") {
    assertExactKeys(action as unknown as UnknownRecord, ["kind", "fieldId", "target", "delta", "effectGroupIds"]);
    assertRuleTargetSelectorKeys(action.target);
    assertStringArray(action.effectGroupIds);
  } else if (action.kind === "activate_effect_group") {
    assertExactKeys(action as unknown as UnknownRecord, ["kind", "effectGroupId"]);
  } else {
    throw new Error("MVU_FULL_BACKUP_CONFIG_INVALID");
  }
}

function assertRuleTargetSelectorKeys(value: unknown): void {
  const selector = requirePlainRecord(value, "MVU_FULL_BACKUP_CONFIG_INVALID") as unknown as RuleTargetSelector;
  if (selector.kind === "trigger_actor" || selector.kind === "all_bound") {
    assertExactKeys(selector as unknown as UnknownRecord, ["kind"]);
  } else if (selector.kind === "selected") {
    assertExactKeys(selector as unknown as UnknownRecord, ["kind", "actorIds"]);
    assertStringArray(selector.actorIds);
  } else {
    throw new Error("MVU_FULL_BACKUP_CONFIG_INVALID");
  }
}

function assertEffectGroupKeys(value: unknown): void {
  const group = requirePlainRecord(value, "MVU_FULL_BACKUP_CONFIG_INVALID") as unknown as EffectGroupDefinition;
  assertExactKeys(group as unknown as UnknownRecord, [
    "id", "name", "description", "enabled", "fieldEffects", "defaultReason",
    ...(group.defaultDuration === undefined ? [] : ["defaultDuration"]), "createdAt", "updatedAt",
  ]);
  assertReasonKeys(group.defaultReason);
  if (group.defaultDuration !== undefined) assertDurationKeys(group.defaultDuration);
  if (!Array.isArray(group.fieldEffects)) throw new Error("MVU_FULL_BACKUP_CONFIG_INVALID");
  group.fieldEffects.forEach((entry) => {
    const fieldEffect = requirePlainRecord(entry, "MVU_FULL_BACKUP_CONFIG_INVALID");
    assertExactKeys(fieldEffect, ["id", "fieldId", "actorSelector", "operations"]);
    assertEffectActorSelectorKeys(fieldEffect.actorSelector);
    if (!Array.isArray(fieldEffect.operations)) throw new Error("MVU_FULL_BACKUP_CONFIG_INVALID");
    fieldEffect.operations.forEach(assertEffectOperationKeys);
  });
}

function assertEffectActorSelectorKeys(value: unknown): void {
  const selector = requirePlainRecord(value, "MVU_FULL_BACKUP_CONFIG_INVALID") as unknown as EffectActorSelector;
  if (selector.kind === "all_bound" || selector.kind === "trigger_actor") {
    assertExactKeys(selector as unknown as UnknownRecord, ["kind"]);
  } else if (selector.kind === "selected") {
    assertExactKeys(selector as unknown as UnknownRecord, ["kind", "actorIds"]);
    assertStringArray(selector.actorIds);
  } else {
    throw new Error("MVU_FULL_BACKUP_CONFIG_INVALID");
  }
}

function assertEffectOperationKeys(value: unknown): void {
  const operation = requirePlainRecord(value, "MVU_FULL_BACKUP_CONFIG_INVALID") as unknown as EffectOperation;
  if (operation.kind === "immediate_delta") {
    assertExactKeys(operation as unknown as UnknownRecord, ["kind", "value"]);
  } else if (operation.kind === "fixed_adjustment" || operation.kind === "positive_multiplier" ||
    operation.kind === "negative_multiplier" || operation.kind === "all_multiplier") {
    assertExactKeys(operation as unknown as UnknownRecord, ["kind", "value", "sources"]);
    assertStringArray(operation.sources);
  } else {
    throw new Error("MVU_FULL_BACKUP_CONFIG_INVALID");
  }
}

function assertActiveEffectKeys(value: unknown): void {
  const active = requirePlainRecord(value, "MVU_FULL_BACKUP_CONFIG_INVALID") as unknown as ActiveEffectInstance;
  assertExactKeys(active as unknown as UnknownRecord, [
    "id", "definitionId", ...(active.triggerActorId === undefined ? [] : ["triggerActorId"]),
    "resolvedTargets", "duration", "activatedAt", "reason",
    ...(active.definitionSnapshot === undefined ? [] : ["definitionSnapshot"]),
  ]);
  if (!Array.isArray(active.resolvedTargets)) throw new Error("MVU_FULL_BACKUP_CONFIG_INVALID");
  active.resolvedTargets.forEach((target) => assertExactKeys(
    requirePlainRecord(target, "MVU_FULL_BACKUP_CONFIG_INVALID"),
    ["fieldId", "actorId", "scope", "scopeKey"],
  ));
  assertDurationKeys(active.duration);
  assertReasonKeys(active.reason);
  if (active.definitionSnapshot !== undefined) {
    const snapshot = requirePlainRecord(active.definitionSnapshot, "MVU_FULL_BACKUP_CONFIG_INVALID");
    assertExactKeys(snapshot, ["name", "description", "updatedAt", "fieldEffects"]);
    if (!Array.isArray(snapshot.fieldEffects)) throw new Error("MVU_FULL_BACKUP_CONFIG_INVALID");
    snapshot.fieldEffects.forEach((fieldEffect) => {
      const entry = requirePlainRecord(fieldEffect, "MVU_FULL_BACKUP_CONFIG_INVALID");
      assertExactKeys(entry, ["id", "fieldId", "actorSelector", "operations"]);
      assertEffectActorSelectorKeys(entry.actorSelector);
      if (!Array.isArray(entry.operations)) throw new Error("MVU_FULL_BACKUP_CONFIG_INVALID");
      entry.operations.forEach(assertEffectOperationKeys);
    });
  }
}

function assertReasonKeys(value: unknown): void {
  assertExactKeys(requirePlainRecord(value, "MVU_FULL_BACKUP_CONFIG_INVALID"), ["mode", "template", "text"]);
}

function assertDurationKeys(value: unknown): void {
  assertExactKeys(requirePlainRecord(value, "MVU_FULL_BACKUP_CONFIG_INVALID"), ["expiresAt", "remainingTurns"]);
}

function assertConditionExpressionKeys(value: unknown): void {
  const expression = requirePlainRecord(value, "MVU_FULL_BACKUP_CONFIG_INVALID") as unknown as ConditionExpression;
  if (expression.kind === "predicate") {
    assertExactKeys(expression as unknown as UnknownRecord, ["kind", "predicate"]);
    assertConditionPredicateKeys(expression.predicate);
  } else if (expression.kind === "not") {
    assertExactKeys(expression as unknown as UnknownRecord, ["kind", "child"]);
    assertConditionExpressionKeys(expression.child);
  } else if (expression.kind === "and" || expression.kind === "or") {
    assertExactKeys(expression as unknown as UnknownRecord, ["kind", "children"]);
    if (!Array.isArray(expression.children)) throw new Error("MVU_FULL_BACKUP_CONFIG_INVALID");
    expression.children.forEach(assertConditionExpressionKeys);
  } else {
    throw new Error("MVU_FULL_BACKUP_CONFIG_INVALID");
  }
}

function assertConditionPredicateKeys(value: unknown): void {
  const predicate = requirePlainRecord(value, "MVU_FULL_BACKUP_CONFIG_INVALID") as unknown as ConditionPredicate;
  switch (predicate.kind) {
    case "recent_positive": assertExactKeys(predicate as unknown as UnknownRecord, ["kind", "count"]); return;
    case "long_inactive": assertExactKeys(predicate as unknown as UnknownRecord, ["kind", "hours"]); return;
    case "user_care":
    case "special_day": assertExactKeys(predicate as unknown as UnknownRecord, ["kind"]); return;
    case "high_frequency": assertExactKeys(predicate as unknown as UnknownRecord, [
      "kind", "messages", ...(predicate.windowHours === undefined ? [] : ["windowHours"]),
      ...(predicate.bucketHours === undefined ? [] : ["bucketHours"]),
    ]); return;
    case "field_comparison": assertExactKeys(predicate as unknown as UnknownRecord,
      ["kind", "fieldId", "operator", "value"]); return;
    case "message_count": assertExactKeys(predicate as unknown as UnknownRecord,
      ["kind", "count", "windowHours", ...(predicate.sender === undefined ? [] : ["sender"])]); return;
    case "keywords": assertExactKeys(predicate as unknown as UnknownRecord, [
      "kind", "includeAny", "includeAll", "exclude",
      ...(predicate.windowHours === undefined ? [] : ["windowHours"]),
      ...(predicate.caseSensitive === undefined ? [] : ["caseSensitive"]),
    ]); return;
    case "sender": assertExactKeys(predicate as unknown as UnknownRecord, ["kind", "senders"]); return;
    case "actor": assertExactKeys(predicate as unknown as UnknownRecord, ["kind", "actorIds"]); return;
    case "group": assertExactKeys(predicate as unknown as UnknownRecord, ["kind", "groupIds"]); return;
    case "concrete_date": assertExactKeys(predicate as unknown as UnknownRecord, ["kind", "dates"]); return;
    case "repeating_date": assertExactKeys(predicate as unknown as UnknownRecord, ["kind", "month", "day"]); return;
    case "ai_semantic": assertExactKeys(predicate as unknown as UnknownRecord,
      ["kind", "id", "triggerType", "requirement", "minimumConfidence"]); return;
  }
}

function assertLogicalRecords(value: readonly unknown[]): asserts value is DataChangeRecord[] {
  if (value.length > FULL_BACKUP_MAX_RECORDS) throw new Error("MVU_FULL_BACKUP_RECORD_LIMIT");
  const ids = new Set<string>();
  for (const entry of value) {
    const record = requirePlainRecord(entry, "MVU_FULL_BACKUP_RECORD_INVALID");
    assertExactKeys(record, RECORD_KEYS);
    assertDataChangeRecord(record);
    if (ids.has(record.id as string)) throw new Error(`MVU_FULL_BACKUP_RECORD_ID_DUPLICATE:${record.id as string}`);
    ids.add(record.id as string);
  }
}

function assertNestedNumberMapKeys(value: unknown): void {
  const outer = requirePlainRecord(value, "MVU_FULL_BACKUP_CONFIG_INVALID");
  for (const inner of Object.values(outer)) requirePlainRecord(inner, "MVU_FULL_BACKUP_CONFIG_INVALID");
}

function assertNestedCounterMapKeys(value: unknown): void {
  const outer = requirePlainRecord(value, "MVU_FULL_BACKUP_CONFIG_INVALID");
  for (const innerValue of Object.values(outer)) {
    const inner = requirePlainRecord(innerValue, "MVU_FULL_BACKUP_CONFIG_INVALID");
    for (const counterValue of Object.values(inner)) {
      const counter = requirePlainRecord(counterValue, "MVU_FULL_BACKUP_CONFIG_INVALID") as unknown as TurnCounter;
      assertExactKeys(counter as unknown as UnknownRecord, ["userMessages", "characterMessages"]);
    }
  }
}

function assertMessageFactsKeys(value: unknown): void {
  const map = requirePlainRecord(value, "MVU_FULL_BACKUP_CONFIG_INVALID");
  for (const factsValue of Object.values(map)) {
    if (!Array.isArray(factsValue)) throw new Error("MVU_FULL_BACKUP_CONFIG_INVALID");
    for (const factValue of factsValue) {
      const fact = requirePlainRecord(factValue, "MVU_FULL_BACKUP_CONFIG_INVALID") as unknown as MessageFact;
      assertExactKeys(fact as unknown as UnknownRecord, [
        "messageId", "variantId", "content", "chatId", "actorId", "groupId", "role", "occurredAt",
        "recentPositiveCount", "userCareDetected", "lastInteractionAt", "messageCountInLast24Hours",
        "specialDayDetected",
      ]);
    }
  }
}

function assertHourlyBucketKeys(value: unknown): void {
  const map = requirePlainRecord(value, "MVU_FULL_BACKUP_CONFIG_INVALID");
  for (const buckets of Object.values(map)) {
    if (!Array.isArray(buckets)) throw new Error("MVU_FULL_BACKUP_CONFIG_INVALID");
    buckets.forEach((bucket) => assertExactKeys(
      requirePlainRecord(bucket, "MVU_FULL_BACKUP_CONFIG_INVALID"),
      ["startedAt", "messageCount"],
    ));
  }
}

function requireCollection(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error("MVU_FULL_BACKUP_CONFIG_INVALID");
  if (value.length > FULL_BACKUP_MAX_CONFIG_ITEMS) throw new Error(`MVU_FULL_BACKUP_${name.toUpperCase()}_LIMIT`);
  return value;
}

function assertStringArray(value: unknown): void {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error("MVU_FULL_BACKUP_CONFIG_INVALID");
  }
}

function assertJsonResourceBounds(root: unknown): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > FULL_BACKUP_MAX_NODES) throw new Error("MVU_FULL_BACKUP_NODE_LIMIT");
    if (current.depth > FULL_BACKUP_MAX_DEPTH) throw new Error("MVU_FULL_BACKUP_DEPTH_LIMIT");
    if (typeof current.value === "number" && !Number.isFinite(current.value)) {
      throw new Error("MVU_FULL_BACKUP_UNSAFE_NUMBER");
    }
    if (typeof current.value === "string" && current.value.length > FULL_BACKUP_MAX_TEXT_LENGTH) {
      throw new Error("MVU_FULL_BACKUP_TEXT_LIMIT");
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > FULL_BACKUP_MAX_ARRAY_ITEMS) throw new Error("MVU_FULL_BACKUP_ARRAY_LIMIT");
      for (const entry of current.value) stack.push({ value: entry, depth: current.depth + 1 });
      continue;
    }
    if (current.value !== null && typeof current.value === "object") {
      const record = requirePlainRecord(current.value, "MVU_FULL_BACKUP_OBJECT_INVALID");
      for (const [key, entry] of Object.entries(record)) {
        if (key === "__proto__" || key === "prototype" || key === "constructor") {
          throw new Error(`MVU_FULL_BACKUP_UNKNOWN_KEY:${key}`);
        }
        stack.push({ value: entry, depth: current.depth + 1 });
      }
    }
  }
}

function requirePlainRecord(value: unknown, code: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("MVU_FULL_BACKUP_OBJECT_NOT_PLAIN");
  return value as UnknownRecord;
}

function assertExactKeys(value: UnknownRecord, expected: readonly string[]): void {
  const allowed = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`MVU_FULL_BACKUP_UNKNOWN_KEY:${key}`);
  }
  if (Object.keys(value).length !== expected.length || expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error("MVU_FULL_BACKUP_REQUIRED_KEY_MISSING");
  }
}

function requireSafeRevision(value: unknown, code: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(code);
}

function isoTimestamp(now: number): string {
  if (!Number.isFinite(now)) throw new Error("MVU_FULL_BACKUP_TIME_INVALID");
  const value = new Date(now).toISOString();
  if (!isIsoTimestamp(value)) throw new Error("MVU_FULL_BACKUP_TIME_INVALID");
  return value;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function buildFullBackupFileName(exportedAt: string): string {
  const compact = exportedAt.replace(/[-:]/g, "").replace("T", "-").replace(/\.\d{3}Z$/, "Z");
  return `operit-mvu-full-backup-v3-schema1-${compact}.json`;
}

export function fullBackupUtf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function canonicalSha256(value: unknown): string {
  const hash = new Sha256();
  updateCanonical(hash, value);
  return hash.digestHex();
}

function updateCanonical(hash: Sha256, value: unknown): void {
  if (value === null) {
    hash.updateText("null");
  } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    hash.updateText(JSON.stringify(value));
  } else if (Array.isArray(value)) {
    hash.updateText("[");
    value.forEach((entry, index) => {
      if (index > 0) hash.updateText(",");
      updateCanonical(hash, entry);
    });
    hash.updateText("]");
  } else {
    const record = requirePlainRecord(value, "MVU_FULL_BACKUP_CANONICAL_VALUE_INVALID");
    hash.updateText("{");
    Object.keys(record).sort().forEach((key, index) => {
      if (index > 0) hash.updateText(",");
      hash.updateText(JSON.stringify(key));
      hash.updateText(":");
      updateCanonical(hash, record[key]);
    });
    hash.updateText("}");
  }
}

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

class Sha256 {
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private blockLength = 0;
  private byteLength = 0;
  private finalized = false;

  updateText(value: string): void {
    if (this.finalized) throw new Error("MVU_FULL_BACKUP_HASH_FINALIZED");
    for (let index = 0; index < value.length; index += 1) {
      let codePoint = value.charCodeAt(index);
      if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < value.length) {
        const low = value.charCodeAt(index + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
          index += 1;
        }
      }
      if (codePoint < 0x80) this.updateByte(codePoint);
      else if (codePoint < 0x800) {
        this.updateByte(0xc0 | (codePoint >>> 6));
        this.updateByte(0x80 | (codePoint & 0x3f));
      } else if (codePoint < 0x10000) {
        this.updateByte(0xe0 | (codePoint >>> 12));
        this.updateByte(0x80 | ((codePoint >>> 6) & 0x3f));
        this.updateByte(0x80 | (codePoint & 0x3f));
      } else {
        this.updateByte(0xf0 | (codePoint >>> 18));
        this.updateByte(0x80 | ((codePoint >>> 12) & 0x3f));
        this.updateByte(0x80 | ((codePoint >>> 6) & 0x3f));
        this.updateByte(0x80 | (codePoint & 0x3f));
      }
    }
  }

  digestHex(): string {
    if (this.finalized) throw new Error("MVU_FULL_BACKUP_HASH_FINALIZED");
    const originalLength = this.byteLength;
    this.updateByte(0x80);
    while (this.blockLength !== 56) this.updateByte(0);
    const bitHigh = Math.floor(originalLength / 0x20000000);
    const bitLow = (originalLength << 3) >>> 0;
    for (let shift = 24; shift >= 0; shift -= 8) this.updateByte((bitHigh >>> shift) & 0xff);
    for (let shift = 24; shift >= 0; shift -= 8) this.updateByte((bitLow >>> shift) & 0xff);
    this.finalized = true;
    return [...this.state].map((word) => word.toString(16).padStart(8, "0")).join("");
  }

  private updateByte(value: number): void {
    this.block[this.blockLength] = value;
    this.blockLength += 1;
    this.byteLength += 1;
    if (this.blockLength === 64) {
      this.transform();
      this.blockLength = 0;
    }
  }

  private transform(): void {
    const words = new Uint32Array(64);
    for (let index = 0; index < 16; index += 1) {
      const offset = index * 4;
      words[index] = ((this.block[offset] << 24) | (this.block[offset + 1] << 16) |
        (this.block[offset + 2] << 8) | this.block[offset + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15];
      const previous2 = words[index - 2];
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = this.state;
    for (let index = 0; index < 64; index += 1) {
      const upper1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + upper1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const upper0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (upper0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temporary1) >>> 0;
      d = c; c = b; b = a; a = (temporary1 + temporary2) >>> 0;
    }
    this.state[0] = (this.state[0] + a) >>> 0;
    this.state[1] = (this.state[1] + b) >>> 0;
    this.state[2] = (this.state[2] + c) >>> 0;
    this.state[3] = (this.state[3] + d) >>> 0;
    this.state[4] = (this.state[4] + e) >>> 0;
    this.state[5] = (this.state[5] + f) >>> 0;
    this.state[6] = (this.state[6] + g) >>> 0;
    this.state[7] = (this.state[7] + h) >>> 0;
  }
}

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}
