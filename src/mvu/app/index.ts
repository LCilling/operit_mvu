/** MVU application runtime composition. */
import type { CommandExecutorHooks } from "../core/command-executor";
import { createEventBus, type MvuEventBus } from "../core/events";
import { createDefaultPortContext, type MvuPortContext } from "../port/context";
import { HostActorDirectory } from "./actor-source";
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
  visibleFieldsForContext,
} from "./state-prompt";
import type { MvuFileApi, MvuStore } from "./store";
import { FileMvuStore } from "./store";

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
}

export interface MvuRuntime {
  events: MvuEventBus;
  portContext: MvuPortContext;
  hooks: CommandExecutorHooks;
  service: MvuService;
  actors: HostActorDirectory;
  store: MvuStore;
  dataset(): Promise<MvuDataset>;
  snapshot(context: StateScopeContext): Promise<MvuSnapshotView>;
  buildMvuData(context: StateScopeContext): Promise<ReturnType<typeof buildMvuData>>;
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
    async dataset() {
      return service.getDataset();
    },
    async snapshot(activeContext) {
      const [dataset, actorList, fields] = await Promise.all([
        service.getDataset(),
        actors.listCharacters(),
        service.projectFields(activeContext),
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
      };
    },
    async buildMvuData(activeContext) {
      return buildMvuData(await service.getDataset(), activeContext);
    },
    async applyCommand(activeContext, commandText, audit) {
      return service.applyCommand(activeContext, commandText, audit);
    },
    async buildStateSection(activeContext, memberContexts = []) {
      const dataset = await service.getDataset();
      return buildScopedStateSectionBlock(dataset, activeContext, memberContexts);
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
    async writeText(path, content) {
      const result = await Tools.Files.write(path, content, false);
      requireSuccessfulFileOperation("write", result);
    },
    async move(source, destination) {
      const result = await Tools.Files.move(source, destination);
      requireSuccessfulFileOperation("move", result);
    },
    async mkdir(path) {
      const result = await Tools.Files.mkdir(path, true);
      requireSuccessfulFileOperation("mkdir", result);
    },
  };
}

function createPersistentStore(getConfigDir: (() => string) | undefined): MvuStore {
  if (getConfigDir === undefined) throw new Error("MVU_RUNTIME_REQUIRES_CONFIG_DIR_OR_EXPLICIT_STORE");
  return new FileMvuStore({
    getConfigDir,
    files: createToolsFileApi(),
    createInitialDataset: buildSeedDataset,
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
