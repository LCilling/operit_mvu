import { klona } from "../port/util";
import type { DataActor, DataChangeRecord, DataField, MvuSettings, StateScopeContext } from "./model";
import type {
  ConditionDefinition,
  ConditionExpression,
  EffectGroupDefinition,
  MvuDatasetV3,
  RuleDefinitionV3,
} from "./model-v3";
import type { RecordQueryRequest, RecordQueryResult } from "./record-store";
import type { MigrationStatus, V3MvuStoreSnapshot } from "./store-v3";
import { assertMvuDatasetV3 } from "./validation";

export const QUERY_SEARCH_MAX_LENGTH = 120;
export const QUERY_CURSOR_MAX_LENGTH = 96;
export const PICKER_BATCH_SIZE = 30;
export const ENTITY_ID_MAX_LENGTH = 256;
export const MVU_SNAPSHOT_MAX_BYTES = 65_536;
export const MVU_SNAPSHOT_URI_MAX_BYTES = 2_048;
const DEFAULT_CURSOR_TTL_MS = 5 * 60_000;
const DEFAULT_CURSOR_CAPACITY = 128;
const SNAPSHOT_NAME_MAX_CODE_POINTS = 28;
const SNAPSHOT_DESCRIPTION_MAX_CODE_POINTS = 32;
const SNAPSHOT_REASON_MAX_CODE_POINTS = 40;
const SNAPSHOT_CONTEXT_MAX_CODE_POINTS = 40;
const SNAPSHOT_MIGRATION_WARNING_LIMIT = 8;

const MANAGEMENT_PAGE_SIZES = {
  fields: 5,
  rules: 5,
  conditions: 10,
  effectGroups: 10,
  records: 10,
} as const;

export interface QueryRequest {
  search?: string;
  filters?: Record<string, string | boolean | number>;
  sort?: { key: string; direction: "asc" | "desc" };
  page?: number;
  cursor?: string;
}

export interface QueryResponse<T> {
  items: T[];
  loadedCount: number;
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface FieldQueryItem extends DataField {
  currentValue: number | null;
  currentStage: DataField["stages"][number] | null;
  bindingDisplay: string;
  scopeKey: string | null;
}

export type QueryGroup = ToolPkg.ChatContextGroupSnapshot;

export type QueryEntityType =
  | "field"
  | "actor"
  | "group"
  | "rule"
  | "condition"
  | "effectGroup";

export interface GetEntityByIdRequest {
  entityType: QueryEntityType;
  id: string;
}

export interface EntityReferenceSummary {
  entityType: QueryEntityType | "activeEffect";
  id: string;
  name: string;
  relation: "references" | "referenced_by" | "active_instance";
}

export interface RevisionedRequest {
  expectedRevision: number;
}

export interface RevisionedIdRequest extends RevisionedRequest {
  id: string;
}

export interface ReferenceQueryRequest {
  id: string;
  page?: number;
}

export interface MutationResponse<TEntity = never> {
  revision: number;
  entity: TEntity;
}

export interface DeleteMutationResponse {
  revision: number;
}

export type ConditionInput = Omit<ConditionDefinition, "id" | "createdAt" | "updatedAt">;
export type ConditionPatch = Partial<ConditionInput>;
export type EffectGroupInput = Omit<EffectGroupDefinition, "id" | "createdAt" | "updatedAt">;
export type EffectGroupPatch = Partial<EffectGroupInput>;
export type RuleInput = Omit<RuleDefinitionV3, "id" | "createdAt" | "updatedAt">;
export type RulePatch = Partial<RuleInput>;

export interface MvuQuerySource {
  readV3(): Promise<V3MvuStoreSnapshot>;
  transactV3(
    expectedRevision: number,
    next: MvuDatasetV3,
    newRecords?: readonly DataChangeRecord[],
  ): Promise<V3MvuStoreSnapshot>;
  queryCommittedRecords(request: RecordQueryRequest): Promise<RecordQueryResult>;
  listActors(): Promise<DataActor[]>;
  listActorsForGroup?(groupId: string): Promise<DataActor[]>;
  listGroups(): Promise<QueryGroup[]>;
  activeContext(): Promise<StateScopeContext>;
  migrationStatus(): Promise<MigrationStatus>;
}

export interface MvuQueryServiceOptions {
  now?: () => number;
  createId?: (prefix: GeneratedIdPrefix) => string;
  createCursorToken?: () => string;
  cursorTtlMs?: number;
  cursorCapacity?: number;
}

export interface FieldPageSummary {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  scope: DataField["scope"];
  order: number;
  range: { minimum: number; maximum: number; step: number };
  theme: { icon: string; color: string };
  current: {
    value: number;
    stage: { id: string; name: string; threshold: number };
    scopeKey: string;
    actorId: string | null;
    groupId: string | null;
    chatId: string | null;
  } | null;
  truncated: boolean;
}

export interface RulePageSummary {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  conditionId: string;
  actionCount: number;
  executionOrder: number;
  updatedAt: string;
  truncated: boolean;
}

export interface ConditionPageSummary {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  rootKind: ConditionExpression["kind"];
  updatedAt: string;
  truncated: boolean;
}

export interface EffectGroupPageSummary {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  fieldCount: number;
  updatedAt: string;
  truncated: boolean;
}

export interface RecordPageSummary {
  id: string;
  fieldId: string;
  fieldName: string;
  actorId: string | null;
  actorName: string;
  groupId: string | null;
  before: number;
  after: number;
  delta: number;
  reason: string;
  source: DataChangeRecord["source"];
  occurredAt: number;
  truncated: boolean;
}

export interface SnapshotActorSummary {
  characterId: string;
  name: string;
  avatarUri: string | null;
  avatarUriUnavailable: boolean;
  enabled: boolean;
  truncated: boolean;
}

export interface SnapshotGroupSummary {
  characterGroupId: string;
  name: string;
  avatarUri: string | null;
  avatarUriUnavailable: boolean;
  truncated: boolean;
}

export interface SnapshotScopeContext {
  chatId: string | null;
  actorId: string | null;
  groupId: string | null;
  actorName: string;
  truncated: boolean;
}

export interface SnapshotDisplayLabels {
  groupName: string | null;
  chatName: string;
}

export interface SnapshotContextLabels extends SnapshotDisplayLabels {
  truncated: boolean;
}

export type SnapshotMigrationStatus =
  | {
      mode: "v3";
      source: "existing" | "migrated" | "initialized";
      report?: {
        migratedFields: number;
        migratedRules: number;
        migratedConditions: number;
        migratedEffectGroups: number;
        warnings: string[];
        warningCount: number;
        warningsTruncated: boolean;
      };
      cleanup?: { state: "pending"; error: { code: string; message: string } };
      indexing?: { state: "pending"; error: { code: string; message: string } };
      truncated: boolean;
    }
  | {
      mode: "v2_compat";
      error: { code: string; message: string };
      truncated: boolean;
    };

export interface MvuCompactPageSnapshot {
  revision: number;
  snapshotTruncated: boolean;
  activeContext: SnapshotScopeContext;
  settings: MvuSettings;
  migrationStatus: SnapshotMigrationStatus;
  counts: {
    fields: number;
    actors: number;
    groups: number;
    rules: number;
    conditions: number;
    effectGroups: number;
    records: number;
  };
  selected: {
    actor: SnapshotActorSummary | null;
    group: SnapshotGroupSummary | null;
  };
  contextLabels: SnapshotContextLabels;
  returnedCount: {
    fields: number;
    rules: number;
    conditions: number;
    effectGroups: number;
    records: number;
  };
  pages: {
    fields: QueryResponse<FieldPageSummary>;
    rules: QueryResponse<RulePageSummary>;
    conditions: QueryResponse<ConditionPageSummary>;
    effectGroups: QueryResponse<EffectGroupPageSummary>;
    records: QueryResponse<RecordPageSummary>;
  };
}

type CursorEntity = "fields" | "actors" | "groups";
type GeneratedIdPrefix = "condition" | "effect_group" | "rule" | "field_effect" | "ai_predicate";

interface CursorState {
  entity: CursorEntity;
  fingerprint: string;
  anchorValue: Sortable;
  anchorId: string;
  expiresAt: number;
}

type Sortable = string | number | boolean;
type FilterValue = string | boolean | number;

export class MvuQueryService {
  private readonly now: () => number;
  private readonly createId: NonNullable<MvuQueryServiceOptions["createId"]>;
  private readonly createCursorToken: NonNullable<MvuQueryServiceOptions["createCursorToken"]>;
  private readonly cursorTtlMs: number;
  private readonly cursorCapacity: number;
  private readonly cursors = new Map<string, CursorState>();

  constructor(
    private readonly source: MvuQuerySource,
    options: MvuQueryServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? defaultId;
    this.createCursorToken = options.createCursorToken ?? defaultCursorToken;
    this.cursorTtlMs = positiveSafeInteger(options.cursorTtlMs, DEFAULT_CURSOR_TTL_MS);
    this.cursorCapacity = positiveSafeInteger(options.cursorCapacity, DEFAULT_CURSOR_CAPACITY);
  }

  async queryFields(request: QueryRequest): Promise<QueryResponse<FieldQueryItem>> {
    const [snapshot, context, actors, groups] = await Promise.all([
      this.source.readV3(),
      this.source.activeContext(),
      this.source.listActors(),
      this.source.listGroups(),
    ]);
    const dataset = snapshot.dataset;
    const picker = request.filters?.mode === "picker" || request.cursor !== undefined;
    const response = queryCollection({
      entity: "fields",
      items: dataset.fields,
      request,
      pageSize: picker ? PICKER_BATCH_SIZE : MANAGEMENT_PAGE_SIZES.fields,
      cursor: picker,
      defaultSort: { key: "order", direction: "asc" },
      sortKeys: {
        id: (item) => item.id,
        name: (item) => item.name,
        order: (item) => item.order,
        enabled: (item) => item.enabled,
        scope: (item) => item.scope,
        minimum: (item) => item.minimum,
        maximum: (item) => item.maximum,
      },
      filterKeys: {
        mode: (_item, value) => value === "picker",
        enabled: (item, value) => item.enabled === value,
        scope: (item, value) => item.scope === value,
        type: (item, value) => item.modelVisibility === value,
        bindingId: (item, value) => typeof value === "string" && item.bindingIds.includes(value),
      },
      validateFilters: (filters) => {
        requireFilter(filters, "mode", (value) => value === "picker");
        requireFilter(filters, "enabled", (value) => typeof value === "boolean");
        requireFilter(filters, "scope", (value) =>
          value === "character" || value === "group" || value === "global" || value === "chat");
        requireFilter(filters, "type", (value) =>
          value === "full" || value === "stage_only" || value === "hidden");
        requireFilter(filters, "bindingId", isNonEmptyFilterString);
      },
      searchText: (item) => [item.id, item.name, item.description, ...item.bindingIds],
      id: (item) => item.id,
    }, this.cursorAccess());
    return mapQueryResponse(response, (field) => projectField(field, dataset, context, actors, groups));
  }

  async queryActors(request: QueryRequest): Promise<QueryResponse<DataActor>> {
    const groupId = request.filters?.groupId;
    if (groupId !== undefined && (typeof groupId !== "string" || this.source.listActorsForGroup === undefined)) {
      throw new Error("MVU_QUERY_FILTER_INVALID");
    }
    return queryCollection({
      entity: "actors",
      items: typeof groupId === "string"
        ? await this.source.listActorsForGroup!(groupId)
        : await this.source.listActors(),
      request,
      pageSize: PICKER_BATCH_SIZE,
      cursor: true,
      defaultSort: { key: "name", direction: "asc" },
      sortKeys: {
        id: (item) => item.characterId,
        name: (item) => item.name,
        enabled: (item) => item.enabled,
      },
      filterKeys: {
        enabled: (item, value) => item.enabled === value,
        groupId: (_item, value) => value === groupId,
      },
      validateFilters: (filters) => {
        requireFilter(filters, "enabled", (value) => typeof value === "boolean");
        requireFilter(filters, "groupId", isNonEmptyFilterString);
      },
      searchText: (item) => [item.characterId, item.name],
      id: (item) => item.characterId,
    }, this.cursorAccess());
  }

  async queryGroups(request: QueryRequest): Promise<QueryResponse<QueryGroup>> {
    const actorId = request.filters?.actorId;
    if (actorId !== undefined &&
        (typeof actorId !== "string" || actorId.length === 0 || this.source.listActorsForGroup === undefined)) {
      throw new Error("MVU_QUERY_FILTER_INVALID");
    }
    const groups = await this.source.listGroups();
    const memberGroupIds = typeof actorId === "string"
      ? new Set((await Promise.all(groups.map(async (group) => ({
          id: group.characterGroupId,
          actors: await this.source.listActorsForGroup!(group.characterGroupId),
        })))).filter((entry) => entry.actors.some((actor) => actor.characterId === actorId)).map((entry) => entry.id))
      : null;
    return queryCollection({
      entity: "groups",
      items: groups,
      request,
      pageSize: PICKER_BATCH_SIZE,
      cursor: true,
      defaultSort: { key: "name", direction: "asc" },
      sortKeys: {
        id: (item) => item.characterGroupId,
        name: (item) => item.name,
      },
      filterKeys: {
        actorId: (item, value) => typeof value === "string" && memberGroupIds?.has(item.characterGroupId) === true,
      },
      validateFilters: (filters) => requireFilter(filters, "actorId", isNonEmptyFilterString),
      searchText: (item) => [item.characterGroupId, item.name],
      id: (item) => item.characterGroupId,
    }, this.cursorAccess());
  }

  async queryRules(request: QueryRequest): Promise<QueryResponse<RuleDefinitionV3>> {
    const dataset = (await this.source.readV3()).dataset;
    return queryCollection({
      entity: "rules",
      items: dataset.rules,
      request,
      pageSize: MANAGEMENT_PAGE_SIZES.rules,
      cursor: false,
      defaultSort: { key: "executionOrder", direction: "asc" },
      sortKeys: {
        id: (item) => item.id,
        name: (item) => item.name,
        enabled: (item) => item.enabled,
        executionOrder: (item) => item.executionOrder,
        updatedAt: (item) => item.updatedAt,
      },
      filterKeys: {
        enabled: (item, value) => item.enabled === value,
        conditionId: (item, value) => item.conditionId === value,
        actorId: (item, value) => ruleReferencesActor(item, value),
        groupId: (item, value) => ruleReferencesGroup(item, value),
      },
      validateFilters: (filters) => {
        requireFilter(filters, "enabled", (value) => typeof value === "boolean");
        requireFilter(filters, "conditionId", isNonEmptyFilterString);
        requireFilter(filters, "actorId", isNonEmptyFilterString);
        requireFilter(filters, "groupId", isNonEmptyFilterString);
      },
      searchText: (item) => [item.id, item.name, item.description, item.conditionId],
      id: (item) => item.id,
    });
  }

  async queryConditions(request: QueryRequest): Promise<QueryResponse<ConditionDefinition>> {
    const dataset = (await this.source.readV3()).dataset;
    return queryCollection({
      entity: "conditions",
      items: dataset.conditions,
      request,
      pageSize: MANAGEMENT_PAGE_SIZES.conditions,
      cursor: false,
      defaultSort: { key: "name", direction: "asc" },
      sortKeys: {
        id: (item) => item.id,
        name: (item) => item.name,
        enabled: (item) => item.enabled,
        updatedAt: (item) => item.updatedAt,
      },
      filterKeys: {
        enabled: (item, value) => item.enabled === value,
      },
      validateFilters: (filters) => requireFilter(
        filters, "enabled", (value) => typeof value === "boolean",
      ),
      searchText: (item) => [item.id, item.name, item.description],
      id: (item) => item.id,
    });
  }

  async queryEffectGroups(request: QueryRequest): Promise<QueryResponse<EffectGroupDefinition>> {
    const dataset = (await this.source.readV3()).dataset;
    return queryCollection({
      entity: "effectGroups",
      items: dataset.effectGroups,
      request,
      pageSize: MANAGEMENT_PAGE_SIZES.effectGroups,
      cursor: false,
      defaultSort: { key: "name", direction: "asc" },
      sortKeys: {
        id: (item) => item.id,
        name: (item) => item.name,
        enabled: (item) => item.enabled,
        updatedAt: (item) => item.updatedAt,
      },
      filterKeys: {
        enabled: (item, value) => item.enabled === value,
        fieldId: (item, value) => typeof value === "string" &&
          item.fieldEffects.some((fieldEffect) => fieldEffect.fieldId === value),
      },
      validateFilters: (filters) => {
        requireFilter(filters, "enabled", (value) => typeof value === "boolean");
        requireFilter(filters, "fieldId", isNonEmptyFilterString);
      },
      searchText: (item) => [
        item.id,
        item.name,
        item.description,
        ...item.fieldEffects.map((fieldEffect) => fieldEffect.fieldId),
      ],
      id: (item) => item.id,
    });
  }

  async queryRecords(request: QueryRequest): Promise<QueryResponse<DataChangeRecord>> {
    validateRecordRequest(request);
    const page = request.page ?? 1;
    const direction = request.sort?.direction ?? "desc";
    const result = await this.source.queryCommittedRecords({
      offset: (page - 1) * MANAGEMENT_PAGE_SIZES.records,
      limit: MANAGEMENT_PAGE_SIZES.records,
      direction,
      fieldId: request.filters?.fieldId as string | undefined,
      scopeKey: request.filters?.scopeKey as string | undefined,
    });
    return {
      items: result.items,
      loadedCount: result.items.length,
      totalCount: result.totalCount,
      hasMore: result.hasMore,
      nextCursor: null,
    };
  }

  async getEntityById(request: GetEntityByIdRequest): Promise<
    FieldQueryItem | DataActor | QueryGroup | RuleDefinitionV3 | ConditionDefinition | EffectGroupDefinition
  > {
    if (!isQueryEntityType(request.entityType)) throw new Error("MVU_ENTITY_TYPE_INVALID");
    if (typeof request.id !== "string" || request.id.length === 0 || request.id.length > 256) {
      throw new Error("MVU_ENTITY_ID_INVALID");
    }
    let entity: FieldQueryItem | DataActor | QueryGroup | RuleDefinitionV3 | ConditionDefinition | EffectGroupDefinition | undefined;
    if (request.entityType === "actor") {
      entity = (await this.source.listActors()).find((item) => item.characterId === request.id);
    } else if (request.entityType === "group") {
      entity = (await this.source.listGroups()).find((item) => item.characterGroupId === request.id);
    } else {
      const snapshot = await this.source.readV3();
      const dataset = snapshot.dataset;
      if (request.entityType === "field") {
        const field = dataset.fields.find((item) => item.id === request.id);
        if (field !== undefined) {
          const [context, actors, groups] = await Promise.all([
            this.source.activeContext(),
            this.source.listActors(),
            this.source.listGroups(),
          ]);
          entity = projectField(field, dataset, context, actors, groups);
        }
      }
      if (request.entityType === "rule") entity = dataset.rules.find((item) => item.id === request.id);
      if (request.entityType === "condition") entity = dataset.conditions.find((item) => item.id === request.id);
      if (request.entityType === "effectGroup") entity = dataset.effectGroups.find((item) => item.id === request.id);
    }
    if (entity === undefined) throw new Error(`MVU_ENTITY_NOT_FOUND:${request.entityType}:${request.id}`);
    return klona(entity);
  }

  async pageSnapshot(labels?: SnapshotDisplayLabels): Promise<MvuCompactPageSnapshot> {
    const [snapshot, actors, groups, activeContext, migrationStatus, records] = await Promise.all([
      this.source.readV3(),
      this.source.listActors(),
      this.source.listGroups(),
      this.source.activeContext(),
      this.source.migrationStatus(),
      this.queryRecords({ page: 1 }),
    ]);
    const dataset = snapshot.dataset;
    const applicableFields = dataset.fields.filter((field) => field.enabled && contextScopeKey(field, activeContext) !== null);
    const fields = queryCollectionFromValidated("fields", applicableFields, {}, MANAGEMENT_PAGE_SIZES.fields, false, {
      key: "order", direction: "asc",
    }, { order: (item) => item.order }, (item) => item.id);
    const rules = queryCollectionFromValidated("rules", dataset.rules, {}, MANAGEMENT_PAGE_SIZES.rules, false, {
      key: "executionOrder", direction: "asc",
    }, { executionOrder: (item) => item.executionOrder }, (item) => item.id);
    const conditions = queryCollectionFromValidated("conditions", dataset.conditions, {}, MANAGEMENT_PAGE_SIZES.conditions, false, {
      key: "name", direction: "asc",
    }, { name: (item) => item.name }, (item) => item.id);
    const effectGroups = queryCollectionFromValidated("effectGroups", dataset.effectGroups, {}, MANAGEMENT_PAGE_SIZES.effectGroups, false, {
      key: "name", direction: "asc",
    }, { name: (item) => item.name }, (item) => item.id);
    const selectedActor = activeContext.actorId === null
      ? null
      : actors.find((item) => item.characterId === activeContext.actorId) ?? null;
    const selectedGroup = activeContext.groupId === null
      ? null
      : groups.find((item) => item.characterGroupId === activeContext.groupId) ?? null;
    const result: MvuCompactPageSnapshot = {
      revision: snapshot.revision,
      snapshotTruncated: false,
      activeContext: summarizeScopeContext(activeContext),
      settings: klona(dataset.settings),
      migrationStatus: summarizeMigrationStatus(migrationStatus),
      counts: {
        fields: dataset.fields.length,
        actors: actors.length,
        groups: groups.length,
        rules: dataset.rules.length,
        conditions: dataset.conditions.length,
        effectGroups: dataset.effectGroups.length,
        records: records.totalCount,
      },
      selected: {
        actor: selectedActor === null ? null : summarizeActor(selectedActor),
        group: selectedGroup === null ? null : summarizeGroup(selectedGroup),
      },
      contextLabels: summarizeContextLabels(labels ?? {
        groupName: selectedGroup?.name ?? null,
        chatName: activeContext.actorName.length > 0 ? `${activeContext.actorName} 的会话` : "当前会话",
      }),
      returnedCount: {
        fields: fields.items.length,
        rules: rules.items.length,
        conditions: conditions.items.length,
        effectGroups: effectGroups.items.length,
        records: records.items.length,
      },
      pages: {
        fields: mapQueryResponse(fields, (field) => summarizeField(field, dataset, activeContext)),
        rules: mapQueryResponse(rules, summarizeRule),
        conditions: mapQueryResponse(conditions, summarizeCondition),
        effectGroups: mapQueryResponse(effectGroups, summarizeEffectGroup),
        records: mapQueryResponse(records, summarizeRecord),
      },
    };
    fitSnapshotToByteBound(result);
    requireSnapshotByteBound(result);
    return result;
  }

  createCondition(request: RevisionedRequest & { condition: ConditionInput }): Promise<MutationResponse<ConditionDefinition>> {
    return this.createEntity(request.expectedRevision, "condition", request.condition, (draft, created) => draft.conditions.push(created));
  }

  updateCondition(request: RevisionedIdRequest & { patch: ConditionPatch }): Promise<MutationResponse<ConditionDefinition>> {
    return this.updateEntity(request.expectedRevision, "condition", request.id, request.patch, (draft) => draft.conditions);
  }

  copyCondition(request: RevisionedIdRequest): Promise<MutationResponse<ConditionDefinition>> {
    return this.copyEntity(request.expectedRevision, "condition", request.id, (draft) => draft.conditions);
  }

  toggleCondition(request: RevisionedIdRequest & { enabled: boolean }): Promise<MutationResponse<ConditionDefinition>> {
    return this.updateCondition({ id: request.id, expectedRevision: request.expectedRevision, patch: { enabled: request.enabled } });
  }

  async deleteCondition(request: RevisionedIdRequest): Promise<DeleteMutationResponse> {
    requireEntityId(request.id);
    const committed = await this.mutate(request.expectedRevision, (draft) => {
      if (draft.rules.some((rule) => rule.conditionId === request.id)) {
        throw new Error("MVU_CONDITION_REFERENCED");
      }
      removeRequired(draft.conditions, request.id, "MVU_CONDITION_NOT_FOUND");
    });
    return { revision: committed.revision };
  }

  async getConditionReferences(request: ReferenceQueryRequest): Promise<QueryResponse<EntityReferenceSummary>> {
    requireEntityId(request.id);
    const dataset = (await this.source.readV3()).dataset;
    requireById(dataset.conditions, request.id, "MVU_CONDITION_NOT_FOUND");
    return pageReferences(sortReferences(dataset.rules.filter((rule) => rule.conditionId === request.id).map((rule) => ({
      entityType: "rule" as const,
      id: rule.id,
      name: rule.name,
      relation: "referenced_by" as const,
    }))), request.page);
  }

  createEffectGroup(request: RevisionedRequest & { effectGroup: EffectGroupInput }): Promise<MutationResponse<EffectGroupDefinition>> {
    return this.createEntity(request.expectedRevision, "effect_group", request.effectGroup, (draft, created) => draft.effectGroups.push(created));
  }

  updateEffectGroup(request: RevisionedIdRequest & { patch: EffectGroupPatch }): Promise<MutationResponse<EffectGroupDefinition>> {
    return this.updateEntity(request.expectedRevision, "effect_group", request.id, request.patch, (draft) => draft.effectGroups);
  }

  copyEffectGroup(request: RevisionedIdRequest): Promise<MutationResponse<EffectGroupDefinition>> {
    return this.copyEntity(request.expectedRevision, "effect_group", request.id, (draft) => draft.effectGroups);
  }

  toggleEffectGroup(request: RevisionedIdRequest & { enabled: boolean }): Promise<MutationResponse<EffectGroupDefinition>> {
    return this.updateEffectGroup({ id: request.id, expectedRevision: request.expectedRevision, patch: { enabled: request.enabled } });
  }

  async deleteEffectGroup(request: RevisionedIdRequest): Promise<DeleteMutationResponse> {
    requireEntityId(request.id);
    const committed = await this.mutate(request.expectedRevision, (draft) => {
      const ruleReference = draft.rules.some((rule) => rule.actions.some((action) =>
        action.kind === "activate_effect_group"
          ? action.effectGroupId === request.id
          : action.effectGroupIds.includes(request.id)));
      if (ruleReference || draft.activeEffects.some((instance) => instance.definitionId === request.id)) {
        throw new Error("MVU_EFFECT_GROUP_REFERENCED");
      }
      removeRequired(draft.effectGroups, request.id, "MVU_EFFECT_GROUP_NOT_FOUND");
    });
    return { revision: committed.revision };
  }

  async getEffectGroupReferences(request: ReferenceQueryRequest): Promise<QueryResponse<EntityReferenceSummary>> {
    requireEntityId(request.id);
    const dataset = (await this.source.readV3()).dataset;
    requireById(dataset.effectGroups, request.id, "MVU_EFFECT_GROUP_NOT_FOUND");
    const ruleReferences = dataset.rules.filter((rule) => rule.actions.some((action) =>
      action.kind === "activate_effect_group"
        ? action.effectGroupId === request.id
        : action.effectGroupIds.includes(request.id))).map((rule) => ({
      entityType: "rule" as const,
      id: rule.id,
      name: rule.name,
      relation: "referenced_by" as const,
    }));
    const activeReferences = dataset.activeEffects.filter((instance) =>
      instance.definitionId === request.id).map((instance) => ({
      entityType: "activeEffect" as const,
      id: instance.id,
      name: instance.reason.text,
      relation: "active_instance" as const,
    }));
    return pageReferences(sortReferences([...ruleReferences, ...activeReferences]), request.page);
  }

  createRule(request: RevisionedRequest & { rule: RuleInput }): Promise<MutationResponse<RuleDefinitionV3>> {
    return this.createEntity(request.expectedRevision, "rule", request.rule, (draft, created) => draft.rules.push(created));
  }

  updateRule(request: RevisionedIdRequest & { patch: RulePatch }): Promise<MutationResponse<RuleDefinitionV3>> {
    return this.updateEntity(request.expectedRevision, "rule", request.id, request.patch, (draft) => draft.rules);
  }

  copyRule(request: RevisionedIdRequest): Promise<MutationResponse<RuleDefinitionV3>> {
    return this.copyEntity(request.expectedRevision, "rule", request.id, (draft) => draft.rules);
  }

  toggleRule(request: RevisionedIdRequest & { enabled: boolean }): Promise<MutationResponse<RuleDefinitionV3>> {
    return this.updateRule({ id: request.id, expectedRevision: request.expectedRevision, patch: { enabled: request.enabled } });
  }

  async deleteRule(request: RevisionedIdRequest): Promise<DeleteMutationResponse> {
    requireEntityId(request.id);
    const committed = await this.mutate(request.expectedRevision, (draft) => removeRequired(draft.rules, request.id, "MVU_RULE_NOT_FOUND"));
    return { revision: committed.revision };
  }

  async getRuleReferences(request: { id: string }): Promise<EntityReferenceSummary[]> {
    requireEntityId(request.id);
    const dataset = (await this.source.readV3()).dataset;
    const rule = requireById(dataset.rules, request.id, "MVU_RULE_NOT_FOUND");
    const references: EntityReferenceSummary[] = [];
    const condition = dataset.conditions.find((item) => item.id === rule.conditionId);
    if (condition !== undefined) references.push({
      entityType: "condition", id: condition.id, name: condition.name, relation: "references",
    });
    const fieldIds = new Set<string>();
    const effectGroupIds = new Set<string>();
    for (const action of rule.actions) {
      if (action.kind === "change_field") {
        fieldIds.add(action.fieldId);
        for (const id of action.effectGroupIds) effectGroupIds.add(id);
      } else {
        effectGroupIds.add(action.effectGroupId);
      }
    }
    for (const id of fieldIds) {
      const field = dataset.fields.find((item) => item.id === id);
      if (field !== undefined) references.push({
        entityType: "field", id: field.id, name: field.name, relation: "references",
      });
    }
    for (const id of effectGroupIds) {
      const group = dataset.effectGroups.find((item) => item.id === id);
      if (group !== undefined) references.push({
        entityType: "effectGroup", id: group.id, name: group.name, relation: "references",
      });
    }
    return sortReferences(references);
  }

  private async createEntity<
    TInput extends object,
    TEntity extends TInput & { id: string; createdAt: string; updatedAt: string },
  >(
    expectedRevision: number,
    prefix: "condition" | "effect_group" | "rule",
    input: TInput,
    append: (draft: MvuDatasetV3, created: TEntity) => void,
  ): Promise<MutationResponse<TEntity>> {
    const id = this.createId(prefix);
    const committed = await this.mutate(expectedRevision, (draft) => {
      const timestamp = new Date(this.now()).toISOString();
      const result = {
        ...klona(input),
        id,
        createdAt: timestamp,
        updatedAt: timestamp,
      } as TEntity;
      append(draft, result);
    });
    const result = requireById(entityCollection<TEntity>(committed.dataset, prefix), id, "MVU_ENTITY_CREATE_FAILED");
    return { revision: committed.revision, entity: klona(result) };
  }

  private async updateEntity<TEntity extends { id: string; updatedAt: string }>(
    expectedRevision: number,
    prefix: "condition" | "effect_group" | "rule",
    id: string,
    patch: object,
    select: (draft: MvuDatasetV3) => TEntity[],
  ): Promise<MutationResponse<TEntity>> {
    requireEntityId(id);
    const committed = await this.mutate(expectedRevision, (draft) => {
      const entity = requireById(select(draft), id, `MVU_${prefix.toUpperCase()}_NOT_FOUND`);
      Object.assign(entity, klona(patch), { updatedAt: new Date(this.now()).toISOString() });
    });
    return {
      revision: committed.revision,
      entity: klona(requireById(select(committed.dataset), id, `MVU_${prefix.toUpperCase()}_NOT_FOUND`)),
    };
  }

  private async copyEntity<TEntity extends { id: string; name: string; createdAt: string; updatedAt: string }>(
    expectedRevision: number,
    prefix: "condition" | "effect_group" | "rule",
    id: string,
    select: (draft: MvuDatasetV3) => TEntity[],
  ): Promise<MutationResponse<TEntity>> {
    requireEntityId(id);
    const copiedId = this.createId(prefix);
    const committed = await this.mutate(expectedRevision, (draft) => {
      const source = requireById(select(draft), id, `MVU_${prefix.toUpperCase()}_NOT_FOUND`);
      const timestamp = new Date(this.now()).toISOString();
      const result = {
        ...klona(source),
        id: copiedId,
        name: `${source.name} 副本`,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      if (prefix === "effect_group") {
        const effect = result as unknown as EffectGroupDefinition;
        effect.fieldEffects = effect.fieldEffects.map((fieldEffect) => ({
          ...fieldEffect,
          id: this.createId("field_effect"),
        }));
      }
      if (prefix === "condition") {
        const condition = result as unknown as ConditionDefinition;
        condition.expression = copyConditionExpression(condition.expression, this.createId);
      }
      select(draft).push(result);
    });
    const result = requireById(select(committed.dataset), copiedId, "MVU_ENTITY_COPY_FAILED");
    return { revision: committed.revision, entity: klona(result) };
  }

  private async mutate(expectedRevision: number, change: (draft: MvuDatasetV3) => void): Promise<V3MvuStoreSnapshot> {
    requireExpectedRevision(expectedRevision);
    const snapshot = await this.source.readV3();
    if (snapshot.revision !== expectedRevision) {
      throw new Error(`MVU_STALE_REVISION:${expectedRevision}:${snapshot.revision}`);
    }
    const draft = klona(snapshot.dataset);
    change(draft);
    assertMvuDatasetV3(draft);
    return this.source.transactV3(expectedRevision, draft, []);
  }

  private cursorAccess(): CursorAccess {
    return {
      issue: (state) => this.issueCursor(state),
      resolve: (token, entity, fingerprint) => this.resolveCursor(token, entity, fingerprint),
    };
  }

  private issueCursor(state: Omit<CursorState, "expiresAt">): string {
    this.purgeExpiredCursors();
    while (this.cursors.size >= this.cursorCapacity) {
      const oldest = this.cursors.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cursors.delete(oldest);
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const opaque = this.createCursorToken();
      const token = `c1_${opaque}`;
      if (!/^c1_[A-Za-z0-9_-]{1,80}$/.test(token) || token.length > QUERY_CURSOR_MAX_LENGTH) {
        throw new Error("MVU_QUERY_CURSOR_TOKEN_INVALID");
      }
      if (this.cursors.has(token)) continue;
      this.cursors.set(token, { ...state, expiresAt: this.now() + this.cursorTtlMs });
      return token;
    }
    throw new Error("MVU_QUERY_CURSOR_TOKEN_COLLISION");
  }

  private resolveCursor(token: string, entity: CursorEntity, fingerprint: string): CursorState {
    if (token.length > QUERY_CURSOR_MAX_LENGTH || !/^c1_[A-Za-z0-9_-]{1,80}$/.test(token)) {
      throw new Error("MVU_QUERY_CURSOR_INVALID");
    }
    const state = this.cursors.get(token);
    if (state === undefined || state.expiresAt <= this.now() ||
      state.entity !== entity || state.fingerprint !== fingerprint) {
      if (state !== undefined && state.expiresAt <= this.now()) this.cursors.delete(token);
      throw new Error("MVU_QUERY_CURSOR_INVALID");
    }
    this.cursors.delete(token);
    return state;
  }

  private purgeExpiredCursors(): void {
    const now = this.now();
    for (const [token, state] of this.cursors) {
      if (state.expiresAt <= now) this.cursors.delete(token);
    }
  }
}

interface CollectionQueryOptions<T> {
  entity: CursorEntity | "rules" | "conditions" | "effectGroups";
  items: readonly T[];
  request: QueryRequest;
  pageSize: number;
  cursor: boolean;
  defaultSort: NonNullable<QueryRequest["sort"]>;
  sortKeys: Record<string, (item: T) => Sortable>;
  filterKeys: Record<string, (item: T, value: FilterValue) => boolean>;
  validateFilters?: (filters: Readonly<Record<string, FilterValue>>) => void;
  searchText: (item: T) => readonly string[];
  id: (item: T) => string;
}

interface CursorAccess {
  issue(state: Omit<CursorState, "expiresAt">): string;
  resolve(token: string, entity: CursorEntity, fingerprint: string): CursorState;
}

function queryCollection<T>(options: CollectionQueryOptions<T>, cursors?: CursorAccess): QueryResponse<T> {
  validateQueryRequest(options.request, {
    cursor: options.cursor,
    sortKeys: Object.keys(options.sortKeys),
    filterKeys: Object.keys(options.filterKeys),
  });
  const search = normalizeSearch(options.request.search ?? "");
  const filters = options.request.filters ?? {};
  options.validateFilters?.(filters);
  const filtered = options.items.filter((item) => {
    if (search.length > 0 && !options.searchText(item).some((text) =>
      normalizeSearch(text).includes(search))) return false;
    return Object.entries(filters).every(([key, value]) => {
      const predicate = options.filterKeys[key];
      return predicate !== undefined && predicate(item, value);
    });
  });
  const sort = options.request.sort ?? options.defaultSort;
  const sorted = [...filtered].sort(stableComparator(options.sortKeys[sort.key], sort.direction, options.id));
  return sliceCollection(
    options.entity,
    sorted,
    options.request,
    options.pageSize,
    options.cursor,
    options.sortKeys[sort.key],
    sort.direction,
    options.id,
    cursors,
  );
}

function queryCollectionFromValidated<T>(
  entity: CollectionQueryOptions<T>["entity"],
  items: readonly T[],
  request: QueryRequest,
  pageSize: number,
  cursor: boolean,
  sort: NonNullable<QueryRequest["sort"]>,
  sortKeys: Record<string, (item: T) => Sortable>,
  id: (item: T) => string,
): QueryResponse<T> {
  const sorted = [...items].sort(stableComparator(sortKeys[sort.key], sort.direction, id));
  return sliceCollection(entity, sorted, request, pageSize, cursor, sortKeys[sort.key], sort.direction, id, undefined);
}

function sliceCollection<T>(
  entity: CollectionQueryOptions<T>["entity"],
  sorted: readonly T[],
  request: QueryRequest,
  pageSize: number,
  cursor: boolean,
  sortValue: (item: T) => Sortable,
  direction: "asc" | "desc",
  id: (item: T) => string,
  cursors: CursorAccess | undefined,
): QueryResponse<T> {
  const fingerprint = queryFingerprint(request);
  let offset = ((request.page ?? 1) - 1) * pageSize;
  if (cursor) {
    offset = 0;
    if (request.cursor !== undefined) {
      if (cursors === undefined || (entity !== "fields" && entity !== "actors" && entity !== "groups")) {
        throw new Error("MVU_QUERY_CURSOR_INVALID");
      }
      const anchor = cursors.resolve(request.cursor, entity, fingerprint);
      const next = sorted.findIndex((item) =>
        compareToAnchor(item, anchor, sortValue, direction, id) > 0);
      offset = next < 0 ? sorted.length : next;
    }
  }
  const items = sorted.slice(offset, offset + pageSize).map((item) => klona(item));
  const hasMore = offset + items.length < sorted.length;
  const last = items.at(-1);
  return {
    items,
    loadedCount: items.length,
    totalCount: sorted.length,
    hasMore,
    nextCursor: cursor && hasMore && last !== undefined
      ? (cursors?.issue({
          entity: entity as CursorEntity,
          fingerprint,
          anchorValue: sortValue(last),
          anchorId: id(last),
        }) ?? null)
      : null,
  };
}

function compareToAnchor<T>(
  item: T,
  anchor: CursorState,
  sortValue: (item: T) => Sortable,
  direction: "asc" | "desc",
  id: (item: T) => string,
): number {
  const primary = compareSortable(sortValue(item), anchor.anchorValue);
  if (primary !== 0) return direction === "asc" ? primary : -primary;
  return compareRawId(id(item), anchor.anchorId);
}

function stableComparator<T>(
  value: ((item: T) => Sortable) | undefined,
  direction: "asc" | "desc",
  id: (item: T) => string,
): (left: T, right: T) => number {
  if (value === undefined) throw new Error("MVU_QUERY_SORT_INVALID");
  return (left, right) => {
    const comparison = compareSortable(value(left), value(right));
    if (comparison !== 0) return direction === "asc" ? comparison : -comparison;
    return compareRawId(id(left), id(right));
  };
}

function compareSortable(left: Sortable, right: Sortable): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  return compareText(String(left), String(right));
}

function compareText(left: string, right: string): number {
  const normalizedLeft = normalizeSearch(left);
  const normalizedRight = normalizeSearch(right);
  return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
}

function compareRawId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeSearch(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/gu, " ");
}

function validateQueryRequest(
  request: QueryRequest,
  policy: { cursor: boolean; sortKeys: readonly string[]; filterKeys: readonly string[] },
): void {
  if (request.search !== undefined &&
    (typeof request.search !== "string" || request.search.length > QUERY_SEARCH_MAX_LENGTH)) {
    throw new Error("MVU_QUERY_SEARCH_TOO_LONG");
  }
  if (request.page !== undefined && (!Number.isSafeInteger(request.page) || request.page < 1)) {
    throw new Error("MVU_QUERY_PAGE_INVALID");
  }
  if (policy.cursor && request.page !== undefined) throw new Error("MVU_QUERY_PAGE_INVALID");
  if (!policy.cursor && request.cursor !== undefined) throw new Error("MVU_QUERY_CURSOR_INVALID");
  if (request.cursor !== undefined &&
    (typeof request.cursor !== "string" || request.cursor.length > QUERY_CURSOR_MAX_LENGTH)) {
    throw new Error("MVU_QUERY_CURSOR_TOO_LONG");
  }
  if (request.sort !== undefined && !policy.sortKeys.includes(request.sort.key)) {
    throw new Error("MVU_QUERY_SORT_INVALID");
  }
  if (request.filters !== undefined) {
    for (const key of Object.keys(request.filters)) {
      if (!policy.filterKeys.includes(key)) throw new Error("MVU_QUERY_FILTER_INVALID");
    }
  }
}

function validateRecordRequest(request: QueryRequest): void {
  validateQueryRequest(request, { cursor: false, sortKeys: ["occurredAt"], filterKeys: ["fieldId", "scopeKey"] });
  if ((request.search ?? "").length > 0) {
    throw new Error("MVU_QUERY_FILTER_INVALID");
  }
  requireFilter(request.filters ?? {}, "fieldId", isNonEmptyFilterString);
  requireFilter(request.filters ?? {}, "scopeKey", isNonEmptyFilterString);
  if ((request.filters?.fieldId === undefined) !== (request.filters?.scopeKey === undefined)) {
    throw new Error("MVU_QUERY_FILTER_INVALID");
  }
  if (request.sort !== undefined && request.sort.key !== "occurredAt") {
    throw new Error("MVU_QUERY_SORT_INVALID");
  }
}

function requireFilter(
  filters: Readonly<Record<string, FilterValue>>,
  key: string,
  predicate: (value: FilterValue) => boolean,
): void {
  const value = filters[key];
  if (value !== undefined && !predicate(value)) throw new Error("MVU_QUERY_FILTER_INVALID");
}

function isNonEmptyFilterString(value: FilterValue): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function queryFingerprint(request: QueryRequest): string {
  const filters = Object.entries(request.filters ?? {})
    .sort(([left], [right]) => compareRawId(left, right));
  return JSON.stringify({
    search: normalizeSearch(request.search ?? ""),
    filters,
    sort: request.sort === undefined
      ? null
      : { key: request.sort.key, direction: request.sort.direction },
  });
}

function ruleReferencesActor(rule: RuleDefinitionV3, value: FilterValue): boolean {
  if (typeof value !== "string") return false;
  return (rule.triggerActorSelector.kind === "selected" &&
    rule.triggerActorSelector.actorIds.includes(value)) || rule.actions.some((action) =>
    action.kind === "change_field" && action.target.kind === "selected" &&
    action.target.actorIds.includes(value));
}

function ruleReferencesGroup(rule: RuleDefinitionV3, value: FilterValue): boolean {
  return typeof value === "string" && rule.triggerActorSelector.kind === "group" &&
    rule.triggerActorSelector.groupIds.includes(value);
}

function isQueryEntityType(value: unknown): value is QueryEntityType {
  return value === "field" || value === "actor" || value === "group" || value === "rule" ||
    value === "condition" || value === "effectGroup";
}

function requireById<TEntity extends { id: string }>(
  items: readonly TEntity[],
  id: string,
  error: string,
): TEntity {
  requireEntityId(id);
  const entity = items.find((item) => item.id === id);
  if (entity === undefined) throw new Error(`${error}:${id}`);
  return entity;
}

function removeRequired<TEntity extends { id: string }>(items: TEntity[], id: string, error: string): void {
  requireEntityId(id);
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) throw new Error(`${error}:${id}`);
  items.splice(index, 1);
}

function requireEntityId(id: string): void {
  if (typeof id !== "string" || id.length === 0 || id.length > ENTITY_ID_MAX_LENGTH) {
    throw new Error("MVU_ENTITY_ID_INVALID");
  }
}

function sortReferences(references: EntityReferenceSummary[]): EntityReferenceSummary[] {
  return references.sort((left, right) =>
    compareText(left.entityType, right.entityType) || compareRawId(left.id, right.id));
}

function mapQueryResponse<TSource, TResult>(
  response: QueryResponse<TSource>,
  map: (item: TSource) => TResult,
): QueryResponse<TResult> {
  return {
    items: response.items.map(map),
    loadedCount: response.loadedCount,
    totalCount: response.totalCount,
    hasMore: response.hasMore,
    nextCursor: response.nextCursor,
  };
}

function projectField(
  field: DataField,
  dataset: MvuDatasetV3,
  context: StateScopeContext,
  actors: readonly DataActor[],
  groups: readonly QueryGroup[],
): FieldQueryItem {
  const scopeKey = contextScopeKey(field, context);
  const currentValue = scopeKey === null
    ? null
    : dataset.stateValues[scopeKey]?.[field.id] ?? field.initialValue;
  const currentStage = currentValue === null ? null : stageForValue(field, currentValue);
  return {
    ...klona(field),
    currentValue,
    currentStage: currentStage === null ? null : klona(currentStage),
    bindingDisplay: fieldBindingDisplay(field, context, actors, groups),
    scopeKey,
  };
}

function fieldBindingDisplay(
  field: DataField,
  context: StateScopeContext,
  actors: readonly DataActor[],
  groups: readonly QueryGroup[],
): string {
  if (field.scope === "global") return "所有角色、群组和会话";
  if (field.bindingIds.length === 0) return "未绑定";
  if (field.scope === "chat") {
    if (context.chatId !== null && field.bindingIds.includes(context.chatId)) {
      return context.actorName.length > 0 ? `${context.actorName} 的会话` : "当前会话";
    }
    return `${field.bindingIds.length} 个会话`;
  }
  const names = field.scope === "character"
    ? new Map(actors.map((actor) => [actor.characterId, actor.name]))
    : new Map(groups.map((group) => [group.characterGroupId, group.name]));
  const firstName = names.get(field.bindingIds[0]);
  if (firstName === undefined) {
    return `${field.bindingIds.length}${field.scope === "character" ? " 个角色" : " 个群组"}`;
  }
  return field.bindingIds.length === 1
    ? firstName
    : `${firstName} 等 ${field.bindingIds.length}${field.scope === "character" ? " 个角色" : " 个群组"}`;
}

function summarizeField(
  field: DataField,
  dataset: MvuDatasetV3,
  context: StateScopeContext,
): FieldPageSummary {
  const name = boundedText(field.name, SNAPSHOT_NAME_MAX_CODE_POINTS);
  const description = boundedText(field.description, SNAPSHOT_DESCRIPTION_MAX_CODE_POINTS);
  const scopeKey = contextScopeKey(field, context);
  const value = scopeKey === null
    ? null
    : dataset.stateValues[scopeKey]?.[field.id] ?? field.initialValue;
  const stage = value === null ? null : stageForValue(field, value);
  const stageName = stage === null ? null : boundedText(stage.name, SNAPSHOT_NAME_MAX_CODE_POINTS);
  return {
    id: field.id,
    name: name.value,
    description: description.value,
    enabled: field.enabled,
    scope: field.scope,
    order: field.order,
    range: { minimum: field.minimum, maximum: field.maximum, step: field.step },
    theme: { icon: field.icon, color: field.themeColor },
    current: scopeKey === null || value === null || stage === null ? null : {
      value,
      stage: { id: stage.id, name: stageName!.value, threshold: stage.threshold },
      scopeKey,
      actorId: context.actorId,
      groupId: context.groupId,
      chatId: context.chatId,
    },
    truncated: anyTruncated([name, description, stageName]),
  };
}

function contextScopeKey(field: DataField, context: StateScopeContext): string | null {
  if (field.scope === "global") return "global";
  const bindingId = field.scope === "character"
    ? context.actorId
    : field.scope === "group"
      ? context.groupId
      : context.chatId;
  if (bindingId === null || !field.bindingIds.includes(bindingId)) return null;
  return `${field.scope}:${bindingId}`;
}

function stageForValue(field: DataField, value: number): DataField["stages"][number] | null {
  let matched: DataField["stages"][number] | null = null;
  for (const stage of field.stages) {
    if (stage.threshold <= value && (matched === null || stage.threshold > matched.threshold)) matched = stage;
  }
  return matched;
}

function summarizeRule(rule: RuleDefinitionV3): RulePageSummary {
  const name = boundedText(rule.name, SNAPSHOT_NAME_MAX_CODE_POINTS);
  const description = boundedText(rule.description, SNAPSHOT_DESCRIPTION_MAX_CODE_POINTS);
  return {
    id: rule.id,
    name: name.value,
    description: description.value,
    enabled: rule.enabled,
    conditionId: rule.conditionId,
    actionCount: rule.actions.length,
    executionOrder: rule.executionOrder,
    updatedAt: rule.updatedAt,
    truncated: anyTruncated([name, description]),
  };
}

function summarizeCondition(condition: ConditionDefinition): ConditionPageSummary {
  const name = boundedText(condition.name, SNAPSHOT_NAME_MAX_CODE_POINTS);
  const description = boundedText(condition.description, SNAPSHOT_DESCRIPTION_MAX_CODE_POINTS);
  return {
    id: condition.id,
    name: name.value,
    description: description.value,
    enabled: condition.enabled,
    rootKind: condition.expression.kind,
    updatedAt: condition.updatedAt,
    truncated: anyTruncated([name, description]),
  };
}

function summarizeEffectGroup(effectGroup: EffectGroupDefinition): EffectGroupPageSummary {
  const name = boundedText(effectGroup.name, SNAPSHOT_NAME_MAX_CODE_POINTS);
  const description = boundedText(effectGroup.description, SNAPSHOT_DESCRIPTION_MAX_CODE_POINTS);
  return {
    id: effectGroup.id,
    name: name.value,
    description: description.value,
    enabled: effectGroup.enabled,
    fieldCount: effectGroup.fieldEffects.length,
    updatedAt: effectGroup.updatedAt,
    truncated: anyTruncated([name, description]),
  };
}

function summarizeRecord(record: DataChangeRecord): RecordPageSummary {
  const fieldName = boundedText(record.fieldName, SNAPSHOT_NAME_MAX_CODE_POINTS);
  const actorName = boundedText(record.actorName, SNAPSHOT_NAME_MAX_CODE_POINTS);
  const reason = boundedText(record.reason, SNAPSHOT_REASON_MAX_CODE_POINTS);
  return {
    id: record.id,
    fieldId: record.fieldId,
    fieldName: fieldName.value,
    actorId: record.actorId,
    actorName: actorName.value,
    groupId: record.groupId,
    before: record.before,
    after: record.after,
    delta: record.delta,
    reason: reason.value,
    source: record.source,
    occurredAt: record.occurredAt,
    truncated: anyTruncated([fieldName, actorName, reason]),
  };
}

interface BoundedText {
  value: string;
  truncated: boolean;
}

interface BoundedNullableText {
  value: string | null;
  truncated: boolean;
}

interface BoundedUri {
  value: string | null;
  unavailable: boolean;
}

function boundedText(value: string, maxCodePoints: number): BoundedText {
  let codePoints = 0;
  let sanitized = false;
  let result = "";
  for (const symbol of value) {
    if (codePoints === maxCodePoints) {
      return { value: result, truncated: true };
    }
    codePoints += 1;
    const codeUnit = symbol.charCodeAt(0);
    if (symbol.length === 1 && codeUnit >= 0xd800 && codeUnit <= 0xdfff) {
      result += "\ufffd";
      sanitized = true;
    } else {
      result += symbol;
    }
  }
  return { value: sanitized ? result : value, truncated: sanitized };
}

function boundedNullableText(value: string | null, maxCodePoints: number): BoundedNullableText {
  if (value === null) return { value: null, truncated: false };
  return boundedText(value, maxCodePoints);
}

function boundedUri(value: string | null | undefined): BoundedUri {
  if (value === null || value === undefined) return { value: null, unavailable: false };
  if (utf8ByteLength(value) > MVU_SNAPSHOT_URI_MAX_BYTES) {
    return { value: null, unavailable: true };
  }
  return { value, unavailable: false };
}

function anyTruncated(values: readonly (BoundedText | BoundedNullableText | null)[]): boolean {
  return values.some((value) => value?.truncated === true);
}

function summarizeActor(actor: DataActor): SnapshotActorSummary {
  const name = boundedText(actor.name, SNAPSHOT_NAME_MAX_CODE_POINTS);
  const avatarUri = boundedUri(actor.avatarUri);
  return {
    characterId: actor.characterId,
    name: name.value,
    avatarUri: avatarUri.value,
    avatarUriUnavailable: avatarUri.unavailable,
    enabled: actor.enabled,
    truncated: name.truncated,
  };
}

function summarizeGroup(group: QueryGroup): SnapshotGroupSummary {
  const name = boundedText(group.name, SNAPSHOT_NAME_MAX_CODE_POINTS);
  const avatarUri = boundedUri(group.avatarUri);
  return {
    characterGroupId: group.characterGroupId,
    name: name.value,
    avatarUri: avatarUri.value,
    avatarUriUnavailable: avatarUri.unavailable,
    truncated: name.truncated,
  };
}

function summarizeScopeContext(context: StateScopeContext): SnapshotScopeContext {
  const actorName = boundedText(context.actorName, SNAPSHOT_NAME_MAX_CODE_POINTS);
  return {
    chatId: context.chatId,
    actorId: context.actorId,
    groupId: context.groupId,
    actorName: actorName.value,
    truncated: actorName.truncated,
  };
}

function summarizeContextLabels(labels: SnapshotDisplayLabels): SnapshotContextLabels {
  const groupName = boundedNullableText(labels.groupName, SNAPSHOT_NAME_MAX_CODE_POINTS);
  const chatName = boundedText(labels.chatName, SNAPSHOT_CONTEXT_MAX_CODE_POINTS);
  return {
    groupName: groupName.value,
    chatName: chatName.value,
    truncated: anyTruncated([groupName, chatName]),
  };
}

function summarizeMigrationStatus(status: MigrationStatus): SnapshotMigrationStatus {
  if (status.mode === "v2_compat") {
    const message = boundedText(status.error.message, SNAPSHOT_DESCRIPTION_MAX_CODE_POINTS);
    return {
      mode: "v2_compat",
      error: { code: status.error.code, message: message.value },
      truncated: message.truncated,
    };
  }
  const warnings = status.report?.warnings ?? [];
  const boundedWarnings = warnings.slice(0, SNAPSHOT_MIGRATION_WARNING_LIMIT)
    .map((warning) => boundedText(warning, SNAPSHOT_DESCRIPTION_MAX_CODE_POINTS));
  const cleanupCode = status.cleanup === undefined
    ? null
    : status.cleanup.error.code;
  const cleanupMessage = status.cleanup === undefined
    ? null
    : boundedText(status.cleanup.error.message, SNAPSHOT_DESCRIPTION_MAX_CODE_POINTS);
  const indexingCode = status.indexing === undefined
    ? null
    : status.indexing.error.code;
  const indexingMessage = status.indexing === undefined
    ? null
    : boundedText(status.indexing.error.message, SNAPSHOT_DESCRIPTION_MAX_CODE_POINTS);
  const warningsTruncated = warnings.length > boundedWarnings.length || anyTruncated(boundedWarnings);
  return {
    mode: "v3",
    source: status.source,
    ...(status.report === undefined ? {} : {
      report: {
        migratedFields: status.report.migratedFields,
        migratedRules: status.report.migratedRules,
        migratedConditions: status.report.migratedConditions,
        migratedEffectGroups: status.report.migratedEffectGroups,
        warnings: boundedWarnings.map((warning) => warning.value),
        warningCount: warnings.length,
        warningsTruncated,
      },
    }),
    ...(status.cleanup === undefined ? {} : {
      cleanup: {
        state: "pending" as const,
        error: { code: cleanupCode!, message: cleanupMessage!.value },
      },
    }),
    ...(status.indexing === undefined ? {} : {
      indexing: {
        state: "pending" as const,
        error: { code: indexingCode!, message: indexingMessage!.value },
      },
    }),
    truncated: warningsTruncated || cleanupMessage?.truncated === true || indexingMessage?.truncated === true,
  };
}

type SnapshotPageName = keyof MvuCompactPageSnapshot["pages"];

const SNAPSHOT_TRIM_ORDER: readonly SnapshotPageName[] = [
  "records",
  "effectGroups",
  "conditions",
  "rules",
  "fields",
];

function fitSnapshotToByteBound(snapshot: MvuCompactPageSnapshot): void {
  while (snapshotByteLength(snapshot) > MVU_SNAPSHOT_MAX_BYTES) {
    const pageName = SNAPSHOT_TRIM_ORDER.find((candidate) => snapshot.pages[candidate].items.length > 0);
    if (pageName === undefined) throw new Error("MVU_SNAPSHOT_SIZE_LIMIT_EXCEEDED");
    const page = snapshot.pages[pageName] as QueryResponse<unknown>;
    page.items.pop();
    page.loadedCount = page.items.length;
    page.hasMore = page.items.length < page.totalCount;
    snapshot.returnedCount[pageName] = page.items.length;
    snapshot.snapshotTruncated = true;
  }
}

function requireSnapshotByteBound(snapshot: MvuCompactPageSnapshot): void {
  if (snapshotByteLength(snapshot) > MVU_SNAPSHOT_MAX_BYTES) {
    throw new Error("MVU_SNAPSHOT_SIZE_LIMIT_EXCEEDED");
  }
}

function snapshotByteLength(snapshot: MvuCompactPageSnapshot): number {
  return utf8ByteLength(JSON.stringify(snapshot));
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function pageReferences(
  references: readonly EntityReferenceSummary[],
  page = 1,
): QueryResponse<EntityReferenceSummary> {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error("MVU_QUERY_PAGE_INVALID");
  const offset = (page - 1) * MANAGEMENT_PAGE_SIZES.conditions;
  const items = references.slice(offset, offset + MANAGEMENT_PAGE_SIZES.conditions).map((item) => klona(item));
  return {
    items,
    loadedCount: items.length,
    totalCount: references.length,
    hasMore: offset + items.length < references.length,
    nextCursor: null,
  };
}

function entityCollection<TEntity extends { id: string }>(
  dataset: MvuDatasetV3,
  prefix: "condition" | "effect_group" | "rule",
): TEntity[] {
  if (prefix === "condition") return dataset.conditions as unknown as TEntity[];
  if (prefix === "effect_group") return dataset.effectGroups as unknown as TEntity[];
  return dataset.rules as unknown as TEntity[];
}

function copyConditionExpression(
  expression: ConditionExpression,
  createId: (prefix: GeneratedIdPrefix) => string,
): ConditionExpression {
  if (expression.kind === "and" || expression.kind === "or") {
    return {
      kind: expression.kind,
      children: expression.children.map((child) => copyConditionExpression(child, createId)),
    };
  }
  if (expression.kind === "not") {
    return { kind: "not", child: copyConditionExpression(expression.child, createId) };
  }
  if (expression.predicate.kind !== "ai_semantic") return klona(expression);
  return {
    kind: "predicate",
    predicate: { ...klona(expression.predicate), id: createId("ai_predicate") },
  };
}

function requireExpectedRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("MVU_EXPECTED_REVISION_INVALID");
}

function positiveSafeInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

let generatedIdSequence = 0;

function defaultId(prefix: GeneratedIdPrefix): string {
  generatedIdSequence += 1;
  if (!Number.isSafeInteger(generatedIdSequence)) generatedIdSequence = 1;
  return `${prefix}_${Date.now().toString(36)}_${generatedIdSequence.toString(36)}`;
}

function defaultCursorToken(): string {
  return `${randomTokenPart()}${randomTokenPart()}${randomTokenPart()}${randomTokenPart()}`;
}

function randomTokenPart(): string {
  return Math.floor(Math.random() * 0x1_0000_0000).toString(36).padStart(7, "0");
}
