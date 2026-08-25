/** Operit ToolPkg entry point for the MVU dynamic-state plugin. */
import webContainerScreen from "./ui/web_container/index.ui.js";
import {
  createRuntime,
  MvuQueryService,
  type MvuQuerySource,
  type MvuRuntime,
  type StateScopeContext,
} from "./mvu/app/index";
import {
  activeContextFromHostSnapshot,
  actorsFromHostSnapshot,
  assertPersistedEventMatchesHost,
  automationSignalsForMessage,
  bootstrapContextsFromHostSnapshot,
  memberContextsFromHostSnapshot,
  persistedEventContext,
} from "./mvu/app/host-context";
import { HostSystemModelApi } from "./mvu/app/system-model";
import { migrateDatasetV2ToV3 } from "./mvu/app/migration-v3";
import { isV3MvuStore } from "./mvu/app/store-v3";
import {
  installMvuIpc,
  type MvuPageSnapshot,
  type SnapshotRequest,
} from "./shared/ipc.js";

const ROUTE = "toolpkg:com.lcilling.operit_mvu:ui:state";
const TOOLPKG_ID = "com.lcilling.operit_mvu";

let runtime: MvuRuntime | undefined;
let systemModel: HostSystemModelApi | undefined;
let queryService: MvuQueryService | undefined;
let ipcInstalled = false;
let persistedMessageTail: Promise<void> = Promise.resolve();

function ensureRuntime(): MvuRuntime {
  if (runtime !== undefined) return runtime;
  runtime = createRuntime({
    getConfigDir: () => ToolPkg.getConfigDir(TOOLPKG_ID),
  });
  return runtime;
}

function ensureSystemModel(): HostSystemModelApi {
  if (systemModel !== undefined) return systemModel;
  systemModel = new HostSystemModelApi(ToolPkg.systemModel);
  return systemModel;
}

function ensureQueryService(): MvuQueryService {
  if (queryService !== undefined) return queryService;
  queryService = new MvuQueryService(createQuerySource());
  return queryService;
}

function ensureIpcInstalled(): void {
  if (ipcInstalled) return;
  installMvuIpc(ensureRuntime(), {
    snapshot: buildActiveSnapshot,
    systemModel: ensureSystemModel(),
    queries: ensureQueryService(),
  });
  ipcInstalled = true;
}

export function registerToolPkg(): boolean {
  // Install IPC before publishing the route so its first WebView request cannot race registration.
  ensureIpcInstalled();

  ToolPkg.registerUiRoute({
    id: "operit_mvu_state",
    route: ROUTE,
    runtime: "compose_dsl",
    screen: webContainerScreen,
    params: {},
    title: { zh: "动态状态", en: "Dynamic State" },
    // Keep Operit's native app bar above the WebView so host navigation remains reachable.
    // The WebView intentionally keeps its own reference-page header below that native bar.
    // The route must also destroy its WebView when leaving; retaining it can cover Operit.
    keepAlive: false,
    topBar: "host",
  });

  ToolPkg.registerNavigationEntry({
    id: "operit_mvu_state_sidebar",
    route: ROUTE,
    surface: "main_sidebar_plugins",
    title: { zh: "动态状态", en: "Dynamic State" },
    icon: Icons.Favorite,
    order: 130,
  });

  ToolPkg.registerAppLifecycleHook({
    id: "operit_mvu_ready",
    event: "application_on_create",
    function: onApplicationCreate,
  });
  ToolPkg.registerChatMessageHook({
    id: "operit_mvu_message_persisted",
    function: onChatMessagePersisted,
  });
  ToolPkg.registerSystemPromptComposeHook({
    id: "operit_mvu_state_projection",
    function: onSystemPromptCompose,
  });
  return true;
}

export async function onApplicationCreate(): Promise<{ ok: boolean }> {
  try {
    await ensureRuntime().initialize();
    ensureSystemModel();
    ensureIpcInstalled();
    return { ok: true };
  } catch (error) {
    console.error("MVU runtime initialization failed", error);
    throw error;
  }
}

export function onChatMessagePersisted(
  event: ToolPkg.ChatMessageHookEvent
): Promise<null> {
  if (event.eventName !== "message_persisted" || !event.eventPayload.isComplete) {
    return Promise.resolve(null);
  }
  const run = persistedMessageTail.then(
    () => processPersistedMessage(event.eventPayload),
    () => processPersistedMessage(event.eventPayload)
  );
  persistedMessageTail = run.then(
    () => undefined,
    () => undefined
  );
  return run.then(() => null);
}

async function processPersistedMessage(
  payload: ToolPkg.ChatMessageEventPayload
): Promise<void> {
  try {
    const activeRuntime = ensureRuntime();
    const context = persistedEventContext(payload);
    const identity = {
      context,
      messageId: payload.messageId,
      variantId: payload.variantId,
    };
    if (await activeRuntime.hasProcessedMessage(identity)) return;

    const hostSnapshot = await ToolPkg.chatContext.snapshot({ chatId: payload.chatId });
    assertPersistedEventMatchesHost(payload, hostSnapshot);
    await synchronizeHostSnapshot(hostSnapshot);
    await activeRuntime.bootstrapActors([
      ...bootstrapContextsFromHostSnapshot(hostSnapshot),
      context,
    ]);

    const migrationStatus = await activeRuntime.migrationStatus();
    const recentFacts = await activeRuntime.getRecentMessageFacts(context);
    const dataset = await activeRuntime.dataset();
    const fields = await activeRuntime.service.projectFields(context);
    let aiRuleJudgements: Awaited<ReturnType<HostSystemModelApi["judgeRules"]>>["judgements"] = [];
    if (migrationStatus.mode === "v2_compat") {
      const aiRules = await activeRuntime.service.getApplicableAiRules(context, payload.timestamp);
      if (aiRules.length > 0) {
      const judgement = await ensureSystemModel().judgeRules({
        context,
        rules: aiRules,
        fields,
        recentFacts,
        message: payload.content,
      });
      if (judgement.available) aiRuleJudgements = judgement.judgements;
      }
    }
    let aiChanges: Awaited<ReturnType<HostSystemModelApi["judgeState"]>>["changes"] = [];
    if (dataset.settings.aiEnabled && fields.some((projection) =>
      projection.bound && projection.definition.enabled && projection.definition.ai.enabled
    )) {
      const judgement = await ensureSystemModel().judgeState({
        context,
        fields,
        recentFacts,
        message: payload.content,
      });
      if (judgement.available) aiChanges = judgement.changes;
    }

    await activeRuntime.processPersistedMessage({
      context,
      messageId: payload.messageId,
      variantId: payload.variantId,
      content: payload.content,
      role: persistedRole(payload.sender),
      occurredAt: payload.timestamp,
      signals: automationSignalsForMessage(recentFacts, payload),
      aiChanges,
      aiRuleJudgements,
      currentActorId: activeContextFromHostSnapshot(hostSnapshot).actorId,
      actorNamesById: Object.fromEntries((await activeRuntime.listActors()).map((actor) => [
        actor.characterId,
        actor.name,
      ])),
      judgeConditions: migrationStatus.mode === "v3"
        ? (request) => ensureSystemModel().judgeConditions(request)
        : undefined,
    });
  } catch (error) {
    console.error("MVU persisted message processing failed", error);
    throw error;
  }
}

export async function onSystemPromptCompose(
  event: ToolPkg.SystemPromptComposeHookEvent
): Promise<ToolPkg.PromptHookObjectResult | null> {
  if (
    event.eventPayload.stage !== "compose_system_prompt_sections" ||
    event.eventPayload.functionType !== "CHAT" ||
    event.eventPayload.promptFunctionType !== "CHAT"
  ) {
    return null;
  }
  const currentSystemPrompt = event.eventPayload.systemPrompt;
  if (currentSystemPrompt === undefined) throw new Error("MVU_SYSTEM_PROMPT_MISSING");
  const chatId = event.eventPayload.chatId;
  if (chatId === undefined || chatId.trim().length === 0) return null;

  try {
    const hostSnapshot = await ToolPkg.chatContext.snapshot({ chatId });
    const synchronized = await synchronizeHostSnapshot(hostSnapshot);
    await settleContexts(synchronized.context, synchronized.members);
    const section = await ensureRuntime().buildStateSection(
      synchronized.context,
      synchronized.members
    );
    if (section.trim().length === 0) return null;
    // Prompt hook mutations replace the whole value, so preserve the complete Operit prompt.
    return { systemPrompt: `${currentSystemPrompt}\n\n${section}` };
  } catch (error) {
    console.error("MVU state projection failed", error);
    throw error;
  }
}

async function buildActiveSnapshot(request: SnapshotRequest): Promise<MvuPageSnapshot> {
  try {
    const hostSnapshot = await ToolPkg.chatContext.snapshot(
      request.groupId === undefined ? undefined : { groupId: request.groupId }
    );
    const synchronized = await synchronizeHostSnapshot(hostSnapshot);
    await settleContexts(synchronized.context, synchronized.members);
    const selectedContext = activeContextFromHostSnapshot(hostSnapshot, request.actorId);
    const snapshot = await new MvuQueryService(createQuerySource(hostSnapshot, selectedContext)).pageSnapshot();
    const contextOwnerName = hostSnapshot.activeGroup?.name ??
      hostSnapshot.activeCharacter?.name ??
      hostSnapshot.activePrompt?.name ??
      "";
    return {
      ...snapshot,
      contextLabels: {
        groupName: hostSnapshot.activeGroup?.name ?? null,
        chatName: contextOwnerName.length > 0 ? `${contextOwnerName} 的会话` : "当前会话",
      },
    };
  } catch (error) {
    console.error("MVU active snapshot failed", error);
    throw error;
  }
}

function createQuerySource(
  fixedHostSnapshot?: ToolPkg.ChatContextSnapshot,
  fixedContext?: StateScopeContext,
): MvuQuerySource {
  const activeRuntime = ensureRuntime();
  const hostSnapshot = async (): Promise<ToolPkg.ChatContextSnapshot> =>
    fixedHostSnapshot ?? ToolPkg.chatContext.snapshot();
  return {
    async readV3() {
      const status = await activeRuntime.migrationStatus();
      if (status.mode === "v3" && isV3MvuStore(activeRuntime.store)) {
        return activeRuntime.store.readV3();
      }
      const legacy = await activeRuntime.dataset();
      const migrated = migrateDatasetV2ToV3(legacy, Date.now()).dataset;
      migrated.revision = legacy.revision;
      return { revision: legacy.revision, dataset: migrated };
    },
    async transactV3(expectedRevision, next, newRecords = []) {
      const status = await activeRuntime.migrationStatus();
      if (status.mode !== "v3" || !isV3MvuStore(activeRuntime.store)) {
        throw new Error("MVU_V3_MUTATION_UNAVAILABLE_IN_COMPAT_MODE");
      }
      return activeRuntime.store.transactV3(expectedRevision, next, newRecords);
    },
    async queryCommittedRecords(request) {
      const status = await activeRuntime.migrationStatus();
      if (status.mode === "v3" && isV3MvuStore(activeRuntime.store)) {
        return activeRuntime.store.queryRecords(request);
      }
      const records = (await activeRuntime.dataset()).records;
      const offset = request.offset ?? 0;
      const ordered = request.direction === "asc" ? records : [...records].reverse();
      const items = ordered.slice(offset, offset + request.limit);
      const hasMore = offset + items.length < ordered.length;
      return {
        items,
        loadedCount: items.length,
        totalCount: ordered.length,
        hasMore,
        nextOffset: hasMore ? offset + items.length : null,
      };
    },
    async listActors() {
      return actorsFromHostSnapshot(await hostSnapshot());
    },
    async listGroups() {
      return (await hostSnapshot()).groups;
    },
    async activeContext() {
      return fixedContext ?? activeContextFromHostSnapshot(await hostSnapshot());
    },
    migrationStatus() {
      return activeRuntime.migrationStatus();
    },
  };
}

async function synchronizeHostSnapshot(
  snapshot: ToolPkg.ChatContextSnapshot
): Promise<{ context: StateScopeContext; members: StateScopeContext[] }> {
  const activeRuntime = ensureRuntime();
  activeRuntime.actors.replaceCharacters(actorsFromHostSnapshot(snapshot));
  await activeRuntime.bootstrapActors(bootstrapContextsFromHostSnapshot(snapshot));
  return {
    context: activeContextFromHostSnapshot(snapshot),
    members: memberContextsFromHostSnapshot(snapshot),
  };
}

async function settleContexts(
  context: StateScopeContext,
  members: readonly StateScopeContext[]
): Promise<void> {
  const contexts = [context, ...members];
  const seen = new Set<string>();
  for (const candidate of contexts) {
    const key = JSON.stringify([
      candidate.chatId,
      candidate.actorId,
      candidate.groupId,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    await ensureRuntime().service.settleNatural(candidate);
  }
}

function persistedRole(sender: string): "user" | "character" {
  if (sender === "user") return "user";
  if (sender === "ai") return "character";
  throw new Error(`MVU_HOST_MESSAGE_SENDER_INVALID:${sender}`);
}

export function onApplicationReady(): void {
  void ensureRuntime().initialize().catch((error) => {
    console.error("MVU runtime initialization failed", error);
  });
  ensureSystemModel();
  ensureIpcInstalled();
}
