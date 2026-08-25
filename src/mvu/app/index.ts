/** MVU application runtime composition. */
import type { CommandExecutorHooks } from "../core/command-executor";
import { createEventBus, type MvuEventBus } from "../core/events";
import { generateSchema } from "../core/schema";
import { createDefaultPortContext, type MvuPortContext } from "../port/context";
import { klona } from "../port/util";
import { HostActorDirectory } from "./actor-source";
import {
  createFullBackupExport,
  type DatasetImportPreview,
  type DatasetImportRestoreRequest,
  type DatasetImportRestoreResult,
  type FullBackupExport,
} from "./full-backup";
import type {
  DataActor,
  DataAutoRule,
  DataChangeRecord,
  DataLinkRule,
  DataTemporaryEffect,
  MessageFact,
  MvuDataset,
  MvuSettings,
  StateScopeContext,
} from "./model";
import {
  applyMvuCommand,
  buildMvuData,
  type ApplyCommandAudit,
  type ApplyResult,
} from "./mvu-bridge";
import { buildSeedDataset, DEFAULT_ACTORS } from "./seed";
import {
  MvuService,
  type ApplyAiJudgementInput,
  type FieldStateProjection,
  type PersistedMessageInput,
  type PersistedAiChange,
  type PersistedMessageIdentity,
  type ProcessPersistedMessageResult,
} from "./service";
import {
  buildScopedStateSectionBlock,
  buildStateSectionBlock,
  type ModelFieldBudgetStats,
  visibleFieldsForContext,
} from "./state-prompt";
import type { MvuFileApi, MvuStore } from "./store";
import { FileMvuStore } from "./store";
import {
  isV3MvuStore,
  V3MvuStore,
  type MigrationStatus,
} from "./store-v3";

export interface RuntimeOptions {
  store?: MvuStore;
  getConfigDir?: () => string;
  initialActors?: DataActor[];
}

export interface MvuSnapshotView {
  revision: number;
  activeContext: StateScopeContext;
  actors: DataActor[];
  fields: FieldStateProjection[];
  rules: DataLinkRule[];
  autoRules: DataAutoRule[];
  temporaryEffects: DataTemporaryEffect[];
  records: DataChangeRecord[];
  settings: MvuSettings;
  migrationStatus: MigrationStatus;
}

export interface MvuRuntime {
  events: MvuEventBus;
  portContext: MvuPortContext;
  hooks: CommandExecutorHooks;
  service: MvuService;
  actors: HostActorDirectory;
  store: MvuStore;
  initialize(): Promise<MigrationStatus>;
  migrationStatus(): Promise<MigrationStatus>;
  dataset(): Promise<MvuDataset>;
  exportDataset(): Promise<FullBackupExport>;
  previewDatasetImport(json: string): Promise<DatasetImportPreview>;
  importDataset(request: DatasetImportRestoreRequest): Promise<DatasetImportRestoreResult>;
  snapshot(context: StateScopeContext): Promise<MvuSnapshotView>;
  buildMvuData(context: StateScopeContext): Promise<ReturnType<typeof buildMvuData>>;
  modelBudget(context: StateScopeContext): Promise<ModelFieldBudgetStats>;
  applyCommand(
    context: StateScopeContext,
    commandText: string,
    audit: ApplyCommandAudit
  ): Promise<ApplyResult>;
  buildStateSection(
    context: StateScopeContext,
    memberContexts?: readonly StateScopeContext[]
  ): Promise<string>;
  listActors(): Promise<DataActor[]>;
  bootstrapActors(contexts: readonly StateScopeContext[]): Promise<void>;
  processPersistedMessage(input: PersistedMessageInput): Promise<ProcessPersistedMessageResult>;
  applyAiJudgement(input: ApplyAiJudgementInput): Promise<DataChangeRecord[]>;
  getRecentMessageFacts(context: StateScopeContext, limit?: number): Promise<MessageFact[]>;
  hasProcessedMessage(identity: PersistedMessageIdentity): Promise<boolean>;
  updateSettings(settings: MvuSettings): Promise<void>;
  clearRecords(): Promise<void>;
}

export function createRuntime(options: RuntimeOptions = {}): MvuRuntime {
  const store = options.store ?? createPersistentStore(options.getConfigDir);
  const events = createEventBus();
  const portContext = createDefaultPortContext();
  const hooks: CommandExecutorHooks = { bus: events, port: portContext };
  const service = new MvuService(store, hooks);
  const actors = new HostActorDirectory(options.initialActors ?? DEFAULT_ACTORS);
  return {
    events,
    portContext,
    hooks,
    service,
    actors,
    store,
    initialize() {
      return runtimeMigrationStatus(store);
    },
    migrationStatus() {
      return runtimeMigrationStatus(store);
    },
    async dataset() {
      return service.getDataset();
    },
    async exportDataset() {
      if (!isV3MvuStore(store)) throw new Error("MVU_FULL_BACKUP_REQUIRES_V3_STORE");
      return createFullBackupExport(await store.readFullBackup(), Date.now());
    },
    previewDatasetImport(json) {
      if (!isV3MvuStore(store)) return Promise.reject(new Error("MVU_FULL_BACKUP_REQUIRES_V3_STORE"));
      return store.previewDatasetImport(json);
    },
    importDataset(request) {
      if (!isV3MvuStore(store)) return Promise.reject(new Error("MVU_FULL_BACKUP_REQUIRES_V3_STORE"));
      return store.restoreDatasetImport(request);
    },
    async snapshot(activeContext) {
      const [dataset, actorList, fields, migrationStatus] = await Promise.all([
        service.getDataset(),
        actors.listCharacters(),
        service.projectFields(activeContext),
        runtimeMigrationStatus(store),
      ]);
      return {
        revision: dataset.revision,
        activeContext: { ...activeContext },
        actors: actorList,
        fields,
        rules: dataset.rules,
        autoRules: dataset.autoRules,
        temporaryEffects: dataset.temporaryEffects,
        records: dataset.records,
        settings: dataset.settings,
        migrationStatus,
      };
    },
    async buildMvuData(activeContext) {
      const [dataset, projection] = await Promise.all([
        service.getDataset(),
        service.projectModelFields(activeContext),
      ]);
      const data = buildMvuData(modelProjectionDataset(dataset, projection.fields), activeContext);
      const states = data.stat_data.states as Record<string, unknown>;
      for (const field of projection.fields) {
        if (field.definition.modelVisibility !== "stage_only" || field.currentStage === null) continue;
        states[field.definition.id] = [field.currentStage.name, field.definition.description];
      }
      const schema = generateSchema(klona(data.stat_data));
      if (schema.type === "object") {
        data.schema = schema;
        data.schema.strictSet = true;
        data.schema.strictTemplate = true;
        data.schema.concatTemplateArray = false;
      }
      return data;
    },
    async modelBudget(activeContext) {
      return (await service.projectModelFields(activeContext)).budget;
    },
    async applyCommand(activeContext, commandText, audit) {
      return service.applyCommand(activeContext, commandText, audit);
    },
    async buildStateSection(activeContext, memberContexts = []) {
      return (await service.buildModelStateSection(activeContext, memberContexts)).section;
    },
    listActors() {
      return actors.listCharacters();
    },
    bootstrapActors(contexts) {
      return service.bootstrapActors(contexts);
    },
    processPersistedMessage(input) {
      return service.processPersistedMessage(input);
    },
    applyAiJudgement(input) {
      return service.applyAiJudgement(input);
    },
    getRecentMessageFacts(activeContext, limit) {
      return service.getRecentMessageFacts(activeContext, limit);
    },
    hasProcessedMessage(identity) {
      return service.hasProcessedMessage(identity);
    },
    updateSettings(settings) {
      return service.updateSettings(settings);
    },
    clearRecords() {
      return service.clearRecords();
    },
  };
}

function modelProjectionDataset(
  dataset: MvuDataset,
  projections: readonly FieldStateProjection[],
): MvuDataset {
  const projected: MvuDataset = {
    ...dataset,
    fields: projections.map((projection) => projection.definition),
    stateValues: {},
  };
  for (const projection of projections) {
    if (!projection.bound || projection.scopeKey === null || projection.currentValue === null) continue;
    projected.stateValues[projection.scopeKey] ??= {};
    projected.stateValues[projection.scopeKey]![projection.definition.id] = projection.currentValue;
  }
  return projected;
}

interface ToolFileOperationResult {
  successful: boolean;
  details: string;
}

function requireSuccessfulFileOperation(operation: string, result: ToolFileOperationResult): void {
  if (!result.successful) {
    throw new Error(`TOOLS_FILES_${operation.toUpperCase()}_FAILED: ${result.details}`);
  }
}

function createToolsFileApi(): MvuFileApi {
  return {
    async exists(path) {
      return (await Tools.Files.exists(path)).exists;
    },
    async readText(path) {
      return (await Tools.Files.read(path)).content;
    },
    async readTextPart(path, startLine, endLine) {
      return (await Tools.Files.readPart(path, startLine, endLine)).content;
    },
    async writeText(path, content) {
      const result = await Tools.Files.write(path, content, false);
      requireSuccessfulFileOperation("write", result);
    },
    async appendText(path, content) {
      const result = await Tools.Files.write(path, content, true);
      requireSuccessfulFileOperation("append", result);
    },
    async move(source, destination) {
      const result = await Tools.Files.move(source, destination);
      requireSuccessfulFileOperation("move", result);
    },
    async replaceAtomically(source, destination) {
      const result = await Tools.Files.replaceAtomically(source, destination);
      requireSuccessfulFileOperation("atomic_replace", result);
    },
    async deleteFile(path) {
      const result = await Tools.Files.deleteFile(path, true);
      requireSuccessfulFileOperation("delete", result);
    },
    async mkdir(path) {
      const result = await Tools.Files.mkdir(path, true);
      requireSuccessfulFileOperation("mkdir", result);
    },
  };
}

function createPersistentStore(getConfigDir: (() => string) | undefined): MvuStore {
  if (getConfigDir === undefined) throw new Error("MVU_RUNTIME_REQUIRES_CONFIG_DIR_OR_EXPLICIT_STORE");
  const files = createToolsFileApi();
  const legacyStore = new FileMvuStore({
    getConfigDir,
    files,
    createInitialDataset: buildSeedDataset,
  });
  return new V3MvuStore({
    getConfigDir,
    files,
    legacyStore,
    createInitialDataset: buildSeedDataset,
  });
}

function runtimeMigrationStatus(store: MvuStore): Promise<MigrationStatus> {
  if (isV3MvuStore(store)) return store.migrationStatus();
  return Promise.resolve({
    mode: "v2_compat",
    error: {
      code: "MVU_V3_STORE_NOT_CONFIGURED",
      message: "The runtime was explicitly constructed with a v2-only store.",
    },
  });
}

export type {
  ApplyAiJudgementInput,
  ApplyCommandAudit,
  DataActor,
  MvuDataset,
  PersistedMessageInput,
  PersistedAiChange,
  PersistedMessageIdentity,
  ProcessPersistedMessageResult,
  StateScopeContext,
};
export {
  applyMvuCommand,
  buildMvuData,
  buildScopedStateSectionBlock,
  buildStateSectionBlock,
  visibleFieldsForContext,
};
export {
  MvuQueryService,
  MVU_SNAPSHOT_MAX_BYTES,
  MVU_SNAPSHOT_URI_MAX_BYTES,
  PICKER_BATCH_SIZE,
  QUERY_CURSOR_MAX_LENGTH,
  QUERY_SEARCH_MAX_LENGTH,
} from "./query";
export type {
  EntityReferenceSummary,
  GetEntityByIdRequest,
  MvuCompactPageSnapshot,
  MvuQueryServiceOptions,
  MvuQuerySource,
  QueryEntityType,
  QueryGroup,
  QueryRequest,
  QueryResponse,
  SnapshotActorSummary,
  SnapshotContextLabels,
  SnapshotDisplayLabels,
  SnapshotGroupSummary,
  SnapshotMigrationStatus,
  SnapshotScopeContext,
} from "./query";
