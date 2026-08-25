import { klona } from "../port/util";
import { migrateDatasetV2ToV3 } from "./migration-v3";
import type {
  AutoRuleCondition,
  DataAutoRule,
  DataChangeRecord,
  DataTemporaryEffect,
  MvuDataset,
} from "./model";
import type {
  ConditionPredicate,
  EffectGroupDefinition,
  MigrationResult,
  MvuDatasetV3,
} from "./model-v3";
import {
  createEmptyRecordManifest,
  SegmentedRecordStore,
  type RecordQueryRequest,
  type RecordQueryResult,
} from "./record-store";
import type { MvuFileApi, MvuStore, MvuStoreSnapshot } from "./store";
import { StaleRevisionError } from "./store";
import { assertMvuDataset, assertMvuDatasetV3 } from "./validation";

const V2_FILE_NAME = "operit_mvu.dataset.v2.json";
const V3_FILE_NAME = "operit_mvu.dataset.v3.json";
const COMPATIBILITY_RECORD_LIMIT = 500;
const runtimePathTails = new Map<string, Promise<void>>();
const runtimeRecoveryRequired = new Set<string>();

export interface V3MvuStoreSnapshot {
  revision: number;
  dataset: MvuDatasetV3;
}

export interface MigrationError {
  code: string;
  message: string;
}

export type MigrationStatus =
  | {
      mode: "v3";
      source: "existing" | "migrated" | "initialized";
      report?: MigrationResult["report"];
    }
  | { mode: "v2_compat"; error: MigrationError };

export interface V3MvuStoreOptions {
  getConfigDir: () => string;
  files: MvuFileApi;
  legacyStore: MvuStore;
  createInitialDataset: () => MvuDataset;
  now?: () => number;
}

type RecordMutation =
  | { kind: "append"; records: readonly DataChangeRecord[] }
  | { kind: "replace"; records: readonly DataChangeRecord[] };

export class V3UnavailableError extends Error {
  constructor(status: Extract<MigrationStatus, { mode: "v2_compat" }>) {
    super(`MVU_V3_UNAVAILABLE:${status.error.code}:${status.error.message}`);
    this.name = "V3UnavailableError";
  }
}

/**
 * Crash-safe v3 configuration store. It also implements the v2 MvuStore shape
 * as a temporary UI/service adapter until the bounded v3 query APIs own every
 * screen in Tasks 6-9.
 */
export class V3MvuStore implements MvuStore {
  private readonly getConfigDir: () => string;
  private readonly files: MvuFileApi;
  private readonly legacyStore: MvuStore;
  private readonly createInitialDataset: () => MvuDataset;
  private readonly now: () => number;
  private readonly records: SegmentedRecordStore;
  private initialization: Promise<MigrationStatus> | undefined;
  private retryInFlight: Promise<MigrationStatus> | undefined;

  constructor(options: V3MvuStoreOptions) {
    this.getConfigDir = options.getConfigDir;
    this.files = options.files;
    this.legacyStore = options.legacyStore;
    this.createInitialDataset = options.createInitialDataset;
    this.now = options.now ?? Date.now;
    this.records = new SegmentedRecordStore({
      getConfigDir: options.getConfigDir,
      files: options.files,
    });
  }

  initialize(): Promise<MigrationStatus> {
    if (this.initialization === undefined) {
      this.initialization = this.enqueuePath(() => this.initializeAttempt(false));
    }
    return this.initialization;
  }

  async migrationStatus(): Promise<MigrationStatus> {
    return this.initialize();
  }

  async retryMigration(): Promise<MigrationStatus> {
    if (this.retryInFlight !== undefined) return this.retryInFlight;
    const status = await this.initialize();
    if (this.retryInFlight !== undefined) return this.retryInFlight;
    if (status.mode !== "v2_compat") {
      throw new Error("MVU_V3_MIGRATION_RETRY_NOT_ALLOWED");
    }
    if (this.retryInFlight !== undefined) return this.retryInFlight;
    const retry = this.enqueuePath(() => this.initializeAttempt(true));
    this.retryInFlight = retry;
    this.initialization = retry;
    try {
      return await retry;
    } finally {
      if (this.retryInFlight === retry) this.retryInFlight = undefined;
    }
  }

  async readV3(): Promise<V3MvuStoreSnapshot> {
    const status = await this.initialize();
    if (status.mode !== "v3") throw new V3UnavailableError(status);
    return this.enqueuePath(() => this.loadV3Config());
  }

  async transactV3(
    expectedRevision: number,
    next: MvuDatasetV3,
    newRecords: readonly DataChangeRecord[],
  ): Promise<V3MvuStoreSnapshot> {
    const status = await this.initialize();
    if (status.mode !== "v3") throw new V3UnavailableError(status);
    return this.enqueuePath(async () => {
      const current = await this.loadV3Config();
      await this.recoverIfRequired(current);
      return this.commitLoaded(current, expectedRevision, next, {
        kind: "append",
        records: newRecords,
      });
    });
  }

  async queryRecords(request: RecordQueryRequest): Promise<RecordQueryResult> {
    const snapshot = await this.readV3();
    return this.records.queryRecords(snapshot.dataset.recordManifest, request);
  }

  async read(): Promise<MvuStoreSnapshot> {
    const status = await this.initialize();
    if (status.mode === "v2_compat") return this.legacyStore.read();
    return this.enqueuePath(async () => {
      const current = await this.loadV3Config();
      const committedRecords = await this.readCompatibilityRecords(current.dataset);
      return compatibilitySnapshot(current.dataset, committedRecords);
    });
  }

  async transact(expectedRevision: number, next: MvuDataset): Promise<MvuStoreSnapshot> {
    const status = await this.initialize();
    if (status.mode === "v2_compat") return this.legacyStore.transact(expectedRevision, next);
    return this.enqueuePath(async () => {
      const current = await this.loadV3Config();
      await this.recoverIfRequired(current);
      if (current.revision !== expectedRevision) {
        throw new StaleRevisionError(expectedRevision, current.revision);
      }
      const currentRecords = await this.readCompatibilityRecords(current.dataset);
      const projected = compatibilityDataset(current.dataset, currentRecords);
      assertMvuDataset(next);
      const merged = mergeCompatibilityDataset(current.dataset, projected, next, this.now());
      const recordMutation = compatibilityRecordMutation(currentRecords, next.records);
      const committed = await this.commitLoaded(
        current,
        expectedRevision,
        merged,
        recordMutation,
      );
      return compatibilitySnapshot(committed.dataset, next.records.slice(-COMPATIBILITY_RECORD_LIMIT));
    });
  }

  private async initializeAttempt(forceRebuild: boolean): Promise<MigrationStatus> {
    try {
      const configDir = this.configDir();
      const v3Path = this.v3Path(configDir);
      if (await this.files.exists(v3Path)) {
        try {
          const existing = await this.loadV3Config();
          await this.records.validateAndRepair(existing.dataset.recordManifest, existing.revision);
          runtimeRecoveryRequired.delete(v3Path);
          return { mode: "v3", source: "existing" };
        } catch (error) {
          if (!forceRebuild) throw error;
        }
      }

      if (!forceRebuild && !(await this.files.exists(v3Path)) &&
        await this.files.exists(this.records.directoryPath())) {
        // With no committed v3 config, every record path is an interrupted migration artifact.
        await this.files.deleteFile(this.records.directoryPath());
      }

      const v2Path = `${configDir}/${V2_FILE_NAME}`;
      const hasV2 = await this.files.exists(v2Path);
      const legacySnapshot = hasV2
        ? await this.legacyStore.read()
        : { revision: 0, dataset: klona(this.createInitialDataset()) };
      assertMvuDataset(legacySnapshot.dataset);
      const migration = migrateDatasetV2ToV3(legacySnapshot.dataset, this.now());
      validateMigrationResult(legacySnapshot.dataset, migration);
      if (!Number.isSafeInteger(migration.dataset.revision + 1)) {
        throw new Error("MVU_V3_REVISION_OVERFLOW");
      }
      const commitRevision = migration.dataset.revision + 1;
      runtimeRecoveryRequired.add(v3Path);
      const staged = await this.records.stageReplace(
        createEmptyRecordManifest(),
        migration.records,
        commitRevision,
      );
      const committed = klona(migration.dataset);
      committed.revision = commitRevision;
      committed.recordManifest = staged.manifest;
      assertMvuDatasetV3(committed);
      await this.records.validateAndRepair(committed.recordManifest, committed.revision);
      await this.persistConfig(v3Path, committed);
      runtimeRecoveryRequired.delete(v3Path);
      return {
        mode: "v3",
        source: hasV2 ? "migrated" : "initialized",
        report: migration.report,
      };
    } catch (error) {
      return {
        mode: "v2_compat",
        error: structuredMigrationError(error),
      };
    }
  }

  private async loadV3Config(): Promise<V3MvuStoreSnapshot> {
    const path = this.v3Path(this.configDir());
    if (!(await this.files.exists(path))) throw new Error("MVU_V3_CONFIG_MISSING");
    const raw = await this.files.readText(path);
    const parsed = JSON.parse(raw) as unknown;
    assertMvuDatasetV3(parsed);
    return { revision: parsed.revision, dataset: klona(parsed) };
  }

  private async commitLoaded(
    current: V3MvuStoreSnapshot,
    expectedRevision: number,
    next: MvuDatasetV3,
    recordMutation: RecordMutation,
  ): Promise<V3MvuStoreSnapshot> {
    if (expectedRevision !== current.revision) {
      throw new StaleRevisionError(expectedRevision, current.revision);
    }
    if (JSON.stringify(next.recordManifest) !== JSON.stringify(current.dataset.recordManifest)) {
      throw new Error("MVU_V3_RECORD_MANIFEST_IS_STORE_OWNED");
    }
    if (!Number.isSafeInteger(current.revision + 1)) {
      throw new Error("MVU_V3_REVISION_OVERFLOW");
    }
    const commitRevision = current.revision + 1;
    const configPath = this.v3Path(this.configDir());
    runtimeRecoveryRequired.add(configPath);
    const staged = recordMutation.kind === "append"
      ? await this.records.stageAppend(current.dataset.recordManifest, recordMutation.records, commitRevision)
      : await this.records.stageReplace(current.dataset.recordManifest, recordMutation.records, commitRevision);
    const committed = klona(next);
    committed.revision = commitRevision;
    committed.recordManifest = staged.manifest;
    assertMvuDatasetV3(committed);
    await this.persistConfig(configPath, committed);
    runtimeRecoveryRequired.delete(configPath);
    return { revision: committed.revision, dataset: klona(committed) };
  }

  private async readCompatibilityRecords(dataset: MvuDatasetV3): Promise<DataChangeRecord[]> {
    if (dataset.recordManifest.recordCount === 0) return [];
    const records = (await this.records.queryRecords(dataset.recordManifest, {
      offset: 0,
      limit: Math.min(COMPATIBILITY_RECORD_LIMIT, dataset.recordManifest.recordCount),
      direction: "desc",
    })).items;
    records.reverse();
    return records;
  }

  private async persistConfig(path: string, dataset: MvuDatasetV3): Promise<void> {
    const configDir = this.configDir();
    if (!(await this.files.exists(configDir))) await this.files.mkdir(configDir);
    const temporaryPath = `${path}.tmp.${nextTransactionId()}`;
    await this.files.writeText(temporaryPath, JSON.stringify(dataset, null, 2));
    await this.files.replaceAtomically(temporaryPath, path);
  }

  private async recoverIfRequired(current: V3MvuStoreSnapshot): Promise<void> {
    const path = this.v3Path(this.configDir());
    if (!runtimeRecoveryRequired.has(path)) return;
    await this.records.validateAndRepair(current.dataset.recordManifest, current.revision);
    runtimeRecoveryRequired.delete(path);
  }

  private enqueuePath<T>(operation: () => Promise<T>): Promise<T> {
    return enqueueRuntimePath(this.v3Path(this.configDir()), operation);
  }

  private configDir(): string {
    const value = this.getConfigDir().replace(/[\\/]+$/, "");
    if (value.length === 0) throw new Error("MVU_CONFIG_DIR_EMPTY");
    return value;
  }

  private v3Path(configDir: string): string {
    return `${configDir}/${V3_FILE_NAME}`;
  }
}

export function isV3MvuStore(store: MvuStore): store is V3MvuStore {
  return store instanceof V3MvuStore;
}

function compatibilitySnapshot(dataset: MvuDatasetV3, records: readonly DataChangeRecord[]): MvuStoreSnapshot {
  const compatibility = compatibilityDataset(dataset, records);
  return { revision: dataset.revision, dataset: klona(compatibility) };
}

function compatibilityDataset(
  dataset: MvuDatasetV3,
  records: readonly DataChangeRecord[],
): MvuDataset {
  const effects = compatibilityEffects(dataset);
  const effectIds = new Set(effects.map((effect) => effect.id));
  const autoRules = compatibilityRules(dataset, effectIds);
  const compatibility: MvuDataset = {
    formatVersion: 2,
    createdAt: Date.parse(dataset.createdAt),
    revision: dataset.revision,
    settings: klona(dataset.settings),
    fields: klona(dataset.fields),
    pendingBootstrapFieldIds: [...dataset.pendingBootstrapFieldIds],
    rules: klona(dataset.linkRules),
    autoRules,
    temporaryEffects: effects,
    stateValues: klona(dataset.stateValues),
    records: records.map((record) => klona(record)),
    lastSettled: klona(dataset.lastSettled),
    turnCounters: klona(dataset.turnCounters),
    processedMessageIds: [...dataset.processedMessageIds],
    ruleLastTriggered: klona(dataset.ruleLastTriggered),
    messageFacts: klona(dataset.messageFacts),
  };
  assertMvuDataset(compatibility);
  return compatibility;
}

function compatibilityEffects(dataset: MvuDatasetV3): DataTemporaryEffect[] {
  const effects: DataTemporaryEffect[] = [];
  for (const definition of dataset.effectGroups) {
    const operation = compatibleEffectOperation(definition);
    if (operation === null) continue;
    const instances = dataset.activeEffects.filter((instance) => instance.definitionId === definition.id);
    const targets = instances.flatMap((instance) => instance.resolvedTargets).map((target) => ({
      fieldId: target.fieldId,
      scope: target.scope,
      scopeKey: target.scopeKey,
    }));
    if (targets.length === 0) continue;
    const duration = instances[0]?.duration ?? { expiresAt: null, remainingTurns: null };
    const reason = instances[0]?.reason;
    effects.push({
      id: legacyEffectId(definition.id),
      targets: uniqueTargets(targets),
      mode: operation.mode,
      value: operation.value,
      enabled: definition.enabled && instances.length > 0,
      expiresAt: duration.expiresAt === null ? null : Date.parse(duration.expiresAt),
      remainingTurns: duration.remainingTurns,
      reasonMode: reason?.mode ?? "template",
      reasonTemplate: reason?.template ?? "general",
      reason: reason?.mode === "custom" ? reason.text : "",
      createdAt: Date.parse(definition.createdAt),
    });
  }
  return effects;
}

function compatibleEffectOperation(
  definition: EffectGroupDefinition,
): { mode: DataTemporaryEffect["mode"]; value: number } | null {
  const operations = definition.fieldEffects.flatMap((effect) => effect.operations);
  if (operations.length === 0 || operations.some((operation) =>
    operation.kind !== "fixed_adjustment" && operation.kind !== "all_multiplier")) return null;
  const first = operations[0];
  if (operations.some((operation) => operation.kind !== first.kind || operation.value !== first.value)) return null;
  return {
    mode: first.kind === "fixed_adjustment" ? "additive" : "multiplier",
    value: first.value,
  };
}

function compatibilityRules(dataset: MvuDatasetV3, effectIds: ReadonlySet<string>): DataAutoRule[] {
  const conditions = new Map(dataset.conditions.map((condition) => [condition.id, condition]));
  const rules: DataAutoRule[] = [];
  for (const rule of dataset.rules) {
    const conditionDefinition = conditions.get(rule.conditionId);
    if (conditionDefinition === undefined || conditionDefinition.expression.kind !== "predicate") continue;
    const condition = compatibilityCondition(conditionDefinition.expression.predicate);
    if (condition === null || rule.actions.some((action) => action.kind !== "change_field")) continue;
    const effects = rule.actions.map((action) => {
      if (action.kind !== "change_field") throw new Error("MVU_V3_COMPAT_RULE_ACTION_INVALID");
      return {
        fieldId: action.fieldId,
        delta: action.delta,
        temporaryEffectIds: action.effectGroupIds
          .map(legacyEffectId)
          .filter((id) => effectIds.has(id)),
      };
    });
    if (effects.length === 0) continue;
    rules.push({
      id: rule.id,
      name: rule.name,
      description: rule.description,
      enabled: rule.enabled,
      condition,
      effects,
      cooldownMs: rule.cooldownHours * 3_600_000,
      order: rule.executionOrder,
    });
  }
  return rules;
}

function compatibilityCondition(predicate: ConditionPredicate): AutoRuleCondition | null {
  switch (predicate.kind) {
    case "recent_positive": return { kind: "recentPositive", count: predicate.count };
    case "long_inactive": return { kind: "longInactive", hours: predicate.hours };
    case "user_care": return { kind: "userCare" };
    case "special_day": return { kind: "specialDay" };
    case "high_frequency": return { kind: "highFreq", messages: predicate.messages };
    case "field_comparison": {
      if (predicate.operator === "==") return null;
      return {
        kind: "stateThreshold",
        fieldId: predicate.fieldId,
        operator: predicate.operator,
        threshold: predicate.value,
      };
    }
    case "ai_semantic": return {
      kind: "aiJudgement",
      triggerType: predicate.triggerType,
      requirement: predicate.requirement,
      minimumConfidence: predicate.minimumConfidence,
    };
    default: return null;
  }
}

function mergeCompatibilityDataset(
  current: MvuDatasetV3,
  projected: MvuDataset,
  next: MvuDataset,
  now: number,
): MvuDatasetV3 {
  const merged = klona(current);
  merged.settings = klona(next.settings);
  merged.fields = klona(next.fields);
  merged.pendingBootstrapFieldIds = [...next.pendingBootstrapFieldIds];
  merged.linkRules = klona(next.rules);
  merged.stateValues = klona(next.stateValues);
  merged.lastSettled = klona(next.lastSettled);
  merged.turnCounters = klona(next.turnCounters);
  merged.processedMessageIds = [...next.processedMessageIds];
  merged.ruleLastTriggered = klona(next.ruleLastTriggered);
  merged.messageFacts = klona(next.messageFacts);
  const autoRulesChanged = JSON.stringify(next.autoRules) !== JSON.stringify(projected.autoRules);
  const temporaryEffectsChanged = JSON.stringify(next.temporaryEffects) !==
    JSON.stringify(projected.temporaryEffects);
  if (autoRulesChanged || temporaryEffectsChanged) {
    const migrated = migrateDatasetV2ToV3({ ...klona(next), records: [] }, now).dataset;
    if (autoRulesChanged) {
      const reconciled = reconcileCompatibilityRules(current, projected, next, migrated);
      merged.conditions = reconciled.conditions;
      merged.rules = reconciled.rules;
    }
    if (temporaryEffectsChanged) {
      const reconciled = reconcileCompatibilityEffects(current, projected, next, migrated, now);
      merged.effectGroups = reconciled.effectGroups;
      merged.activeEffects = reconciled.activeEffects;
    }
  }
  merged.revision = current.revision;
  merged.recordManifest = klona(current.recordManifest);
  assertMvuDatasetV3(merged);
  return merged;
}

function reconcileCompatibilityRules(
  current: MvuDatasetV3,
  projected: MvuDataset,
  next: MvuDataset,
  migrated: MvuDatasetV3,
): Pick<MvuDatasetV3, "conditions" | "rules"> {
  const projectedById = new Map(projected.autoRules.map((rule) => [rule.id, rule]));
  const nextById = new Map(next.autoRules.map((rule) => [rule.id, rule]));
  const migratedRulesById = new Map(migrated.rules.map((rule) => [rule.id, rule]));
  const migratedConditionsById = new Map(migrated.conditions.map((condition) => [condition.id, condition]));
  const currentRulesById = new Map(current.rules.map((rule) => [rule.id, rule]));
  const touchedRuleIds = new Set<string>();

  for (const [id, rule] of projectedById) {
    const replacement = nextById.get(id);
    if (replacement === undefined || JSON.stringify(replacement) !== JSON.stringify(rule)) {
      touchedRuleIds.add(id);
    }
  }
  for (const id of nextById.keys()) {
    if (!projectedById.has(id)) touchedRuleIds.add(id);
  }

  const rules = current.rules.map((rule) => klona(rule));
  const conditions = current.conditions.map((condition) => klona(condition));
  const projectedEffectIds = new Set(projected.temporaryEffects.map((effect) => effect.id));
  for (const id of touchedRuleIds) {
    const currentRule = currentRulesById.get(id);
    const projectedRule = projectedById.get(id);
    if (currentRule !== undefined && projectedRule === undefined) {
      throw new Error(`MVU_V3_COMPAT_RULE_ID_CONFLICT:${id}`);
    }
    const nextRule = nextById.get(id);
    if (nextRule === undefined) {
      const index = rules.findIndex((rule) => rule.id === id);
      if (index >= 0) rules.splice(index, 1);
      continue;
    }
    const migratedRule = migratedRulesById.get(id);
    if (migratedRule === undefined) throw new Error(`MVU_V3_COMPAT_RULE_MIGRATION_MISSING:${id}`);
    const migratedCondition = migratedConditionsById.get(migratedRule.conditionId);
    if (migratedCondition === undefined) {
      throw new Error(`MVU_V3_COMPAT_CONDITION_MIGRATION_MISSING:${migratedRule.conditionId}`);
    }
    if (currentRule === undefined || projectedRule === undefined) {
      const conditionId = uniqueConditionId(migratedRule.conditionId, conditions);
      rules.push({ ...klona(migratedRule), conditionId });
      conditions.push({ ...klona(migratedCondition), id: conditionId });
      continue;
    }

    const patched = klona(currentRule);
    patched.name = nextRule.name;
    patched.description = nextRule.description;
    patched.enabled = nextRule.enabled;
    patched.cooldownHours = nextRule.cooldownMs / 3_600_000;
    patched.executionOrder = nextRule.order;
    patched.updatedAt = migratedRule.updatedAt;
    patched.actions = currentRule.actions.map((action, index) => {
      if (action.kind !== "change_field") return klona(action);
      const desired = migratedRule.actions[index];
      if (desired === undefined || desired.kind !== "change_field") {
        throw new Error(`MVU_V3_COMPAT_RULE_ACTION_MISSING:${id}:${index}`);
      }
      const hiddenEffectGroupIds = action.effectGroupIds.filter((effectGroupId) =>
        !projectedEffectIds.has(legacyEffectId(effectGroupId)));
      return {
        ...klona(action),
        fieldId: desired.fieldId,
        delta: desired.delta,
        effectGroupIds: uniqueStrings([
          ...hiddenEffectGroupIds,
          ...desired.effectGroupIds,
        ]),
      };
    });

    if (JSON.stringify(projectedRule.condition) !== JSON.stringify(nextRule.condition)) {
      const currentConditionIndex = conditions.findIndex((condition) =>
        condition.id === currentRule.conditionId);
      if (currentConditionIndex < 0) {
        throw new Error(`MVU_V3_COMPAT_CONDITION_NOT_FOUND:${currentRule.conditionId}`);
      }
      const shared = current.rules.some((rule) =>
        rule.id !== currentRule.id && rule.conditionId === currentRule.conditionId);
      const updatedCondition = klona(conditions[currentConditionIndex]);
      updatedCondition.expression = klona(migratedCondition.expression);
      updatedCondition.updatedAt = migratedCondition.updatedAt;
      if (shared) {
        updatedCondition.id = uniqueConditionId(
          `${currentRule.conditionId}_${currentRule.id}`,
          conditions,
        );
        conditions.push(updatedCondition);
        patched.conditionId = updatedCondition.id;
      } else {
        conditions[currentConditionIndex] = updatedCondition;
      }
    }

    const currentRuleIndex = rules.findIndex((rule) => rule.id === id);
    if (currentRuleIndex < 0) throw new Error(`MVU_V3_COMPAT_RULE_NOT_FOUND:${id}`);
    rules[currentRuleIndex] = patched;
  }
  return { conditions, rules };
}

function reconcileCompatibilityEffects(
  current: MvuDatasetV3,
  projected: MvuDataset,
  next: MvuDataset,
  migrated: MvuDatasetV3,
  now: number,
): Pick<MvuDatasetV3, "effectGroups" | "activeEffects"> {
  const projectedById = new Map(projected.temporaryEffects.map((effect) => [effect.id, effect]));
  const nextById = new Map(next.temporaryEffects.map((effect) => [effect.id, effect]));
  const currentGroupsByLegacyId = new Map(
    current.effectGroups.map((group) => [legacyEffectId(group.id), group]),
  );
  const migratedGroupsByLegacyId = new Map(
    migrated.effectGroups.map((group) => [legacyEffectId(group.id), group]),
  );
  const touchedEffectIds = new Set<string>();

  for (const [id, effect] of projectedById) {
    const replacement = nextById.get(id);
    if (replacement === undefined || JSON.stringify(replacement) !== JSON.stringify(effect)) {
      touchedEffectIds.add(id);
    }
  }
  for (const id of nextById.keys()) {
    if (!projectedById.has(id)) touchedEffectIds.add(id);
  }

  const effectGroups = current.effectGroups.map((group) => klona(group));
  let activeEffects = current.activeEffects.map((instance) => klona(instance));
  for (const id of touchedEffectIds) {
    const projectedEffect = projectedById.get(id);
    const currentGroup = projectedEffect === undefined ? undefined : currentGroupsByLegacyId.get(id);
    if (currentGroup === undefined && currentGroupsByLegacyId.has(id)) {
      throw new Error(`MVU_V3_COMPAT_EFFECT_ID_CONFLICT:${id}`);
    }

    const nextEffect = nextById.get(id);
    if (nextEffect === undefined) {
      if (currentGroup !== undefined && current.rules.some((rule) => rule.actions.some((action) =>
        action.kind === "activate_effect_group"
          ? action.effectGroupId === currentGroup.id
          : action.effectGroupIds.includes(currentGroup.id)))) {
        throw new Error(`MVU_V3_COMPAT_EFFECT_IN_USE:${id}`);
      }
      if (currentGroup !== undefined) {
        const groupIndex = effectGroups.findIndex((group) => group.id === currentGroup.id);
        if (groupIndex >= 0) effectGroups.splice(groupIndex, 1);
        activeEffects = activeEffects.filter((instance) => instance.definitionId !== currentGroup.id);
      }
      continue;
    }

    const migratedGroup = migratedGroupsByLegacyId.get(id);
    if (migratedGroup === undefined) throw new Error(`MVU_V3_COMPAT_EFFECT_MIGRATION_MISSING:${id}`);
    const migratedInstances = migrated.activeEffects.filter((instance) =>
      instance.definitionId === migratedGroup.id);
    if (currentGroup === undefined || projectedEffect === undefined) {
      if (effectGroups.some((group) => group.id === migratedGroup.id)) {
        throw new Error(`MVU_V3_COMPAT_EFFECT_ID_CONFLICT:${id}`);
      }
      effectGroups.push(klona(migratedGroup));
      for (const instance of migratedInstances) {
        if (activeEffects.some((candidate) => candidate.id === instance.id)) {
          throw new Error(`MVU_V3_COMPAT_ACTIVE_EFFECT_ID_CONFLICT:${instance.id}`);
        }
        activeEffects.push(klona(instance));
      }
      continue;
    }

    const groupIndex = effectGroups.findIndex((group) => group.id === currentGroup.id);
    if (groupIndex < 0) throw new Error(`MVU_V3_COMPAT_EFFECT_NOT_FOUND:${id}`);
    const patchedGroup = klona(currentGroup);
    patchedGroup.fieldEffects = patchedGroup.fieldEffects.map((fieldEffect) => ({
      ...fieldEffect,
      operations: fieldEffect.operations.map((operation) => {
        if (operation.kind !== "fixed_adjustment" && operation.kind !== "all_multiplier") {
          return operation;
        }
        return {
          ...operation,
          kind: nextEffect.mode === "additive" ? "fixed_adjustment" as const : "all_multiplier" as const,
          value: nextEffect.value,
        };
      }),
    }));
    patchedGroup.updatedAt = migratedGroup.updatedAt;

    const expirySettlement = projectedEffect.enabled && !nextEffect.enabled &&
      projectedEffect.expiresAt !== null && projectedEffect.expiresAt <= now &&
      sameEffectExceptEnabled(projectedEffect, nextEffect);
    if (expirySettlement) {
      activeEffects = activeEffects.filter((instance) =>
        instance.definitionId !== currentGroup.id || instance.duration.expiresAt === null ||
        Date.parse(instance.duration.expiresAt) > now);
    } else {
      const directSettlement = projectedEffect.enabled && !nextEffect.enabled &&
        sameEffectInstanceProjection(projectedEffect, nextEffect);
      if (directSettlement) {
        activeEffects = activeEffects.filter((instance) =>
          instance.definitionId !== currentGroup.id);
      } else if (!sameEffectInstanceProjection(projectedEffect, nextEffect)) {
        const currentInstances = activeEffects.filter((instance) =>
          instance.definitionId === currentGroup.id);
        if (currentInstances.length !== 1 || migratedInstances.length !== 1) {
          throw new Error(`MVU_V3_COMPAT_EFFECT_INSTANCES_AMBIGUOUS:${id}`);
        }
        const currentInstance = currentInstances[0];
        const migratedInstance = migratedInstances[0];
        const replacement = {
          ...klona(currentInstance),
          resolvedTargets: klona(migratedInstance.resolvedTargets),
          duration: klona(migratedInstance.duration),
          reason: klona(migratedInstance.reason),
        };
        const instanceIndex = activeEffects.findIndex((instance) => instance.id === currentInstance.id);
        if (!nextEffect.enabled && replacement.duration.remainingTurns === 0) {
          activeEffects.splice(instanceIndex, 1);
        } else {
          activeEffects[instanceIndex] = replacement;
        }
      } else if (projectedEffect.enabled !== nextEffect.enabled) {
        throw new Error(`MVU_V3_COMPAT_EFFECT_ACTIVATION_AMBIGUOUS:${id}`);
      }
    }
    effectGroups[groupIndex] = patchedGroup;
  }
  return { effectGroups, activeEffects };
}

function compatibilityRecordMutation(
  current: readonly DataChangeRecord[],
  next: readonly DataChangeRecord[],
): RecordMutation {
  const prefixMatches = next.length >= current.length && current.every((record, index) =>
    JSON.stringify(record) === JSON.stringify(next[index]));
  if (prefixMatches) return { kind: "append", records: next.slice(current.length) };
  return { kind: "replace", records: next };
}

function validateMigrationResult(v2: MvuDataset, result: MigrationResult): void {
  assertMvuDatasetV3(result.dataset);
  if (result.dataset.fields.length !== v2.fields.length ||
    result.dataset.rules.length !== v2.autoRules.length ||
    result.dataset.conditions.length !== v2.autoRules.length ||
    result.dataset.effectGroups.length !== v2.temporaryEffects.length ||
    result.records.length !== v2.records.length ||
    result.report.migratedFields !== v2.fields.length ||
    result.report.migratedRules !== v2.autoRules.length ||
    result.report.migratedConditions !== v2.autoRules.length ||
    result.report.migratedEffectGroups !== v2.temporaryEffects.length) {
    throw new Error("MVU_V3_MIGRATION_COUNT_MISMATCH");
  }
}

function legacyEffectId(effectGroupId: string): string {
  return effectGroupId.startsWith("effect_group_")
    ? effectGroupId.slice("effect_group_".length)
    : effectGroupId;
}

function uniqueTargets(targets: DataTemporaryEffect["targets"]): DataTemporaryEffect["targets"] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.fieldId}\u0000${target.scope}\u0000${target.scopeKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueConditionId(
  preferred: string,
  conditions: readonly MvuDatasetV3["conditions"][number][],
): string {
  const ids = new Set(conditions.map((condition) => condition.id));
  if (!ids.has(preferred)) return preferred;
  let suffix = 2;
  while (ids.has(`${preferred}_${suffix}`)) suffix += 1;
  return `${preferred}_${suffix}`;
}

function sameEffectExceptEnabled(left: DataTemporaryEffect, right: DataTemporaryEffect): boolean {
  const leftComparable = { ...left, enabled: true };
  const rightComparable = { ...right, enabled: true };
  return JSON.stringify(leftComparable) === JSON.stringify(rightComparable);
}

function sameEffectInstanceProjection(left: DataTemporaryEffect, right: DataTemporaryEffect): boolean {
  return JSON.stringify({
    targets: left.targets,
    expiresAt: left.expiresAt,
    remainingTurns: left.remainingTurns,
    reasonMode: left.reasonMode,
    reasonTemplate: left.reasonTemplate,
    reason: left.reason,
    createdAt: left.createdAt,
  }) === JSON.stringify({
    targets: right.targets,
    expiresAt: right.expiresAt,
    remainingTurns: right.remainingTurns,
    reasonMode: right.reasonMode,
    reasonTemplate: right.reasonTemplate,
    reason: right.reason,
    createdAt: right.createdAt,
  });
}

function structuredMigrationError(error: unknown): MigrationError {
  const message = error instanceof Error ? error.message : String(error);
  const separator = message.indexOf(":");
  return {
    code: (separator < 0 ? message : message.slice(0, separator)) || "MVU_V3_MIGRATION_FAILED",
    message,
  };
}

function enqueueRuntimePath<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = runtimePathTails.get(path) ?? Promise.resolve();
  const run = previous.then(operation, operation);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  runtimePathTails.set(path, tail);
  void tail.finally(() => {
    if (runtimePathTails.get(path) === tail) runtimePathTails.delete(path);
  });
  return run;
}

let transactionSequence = 0;

function nextTransactionId(): string {
  transactionSequence += 1;
  if (!Number.isSafeInteger(transactionSequence)) transactionSequence = 1;
  return `${Date.now().toString(36)}_${transactionSequence.toString(36)}`;
}
