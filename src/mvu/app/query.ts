import { klona } from "../port/util";
import type { DataActor, DataChangeRecord, DataField, MvuSettings, StateScopeContext } from "./model";
import type {
  ConditionDefinition,
  EffectGroupDefinition,
  MvuDatasetV3,
  RuleDefinitionV3,
} from "./model-v3";
import type { RecordQueryRequest, RecordQueryResult } from "./record-store";
import type { MigrationStatus, V3MvuStoreSnapshot } from "./store-v3";
import { assertMvuDatasetV3 } from "./validation";

export const QUERY_SEARCH_MAX_LENGTH = 120;
export const QUERY_CURSOR_MAX_LENGTH = 2_048;
export const PICKER_BATCH_SIZE = 30;

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
  listGroups(): Promise<QueryGroup[]>;
  activeContext(): Promise<StateScopeContext>;
  migrationStatus(): Promise<MigrationStatus>;
}

export interface MvuQueryServiceOptions {
  now?: () => number;
  createId?: (prefix: "condition" | "effect_group" | "rule" | "field_effect") => string;
}

export interface MvuCompactPageSnapshot {
  revision: number;
  activeContext: StateScopeContext;
  settings: MvuSettings;
  migrationStatus: MigrationStatus;
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
    actor: DataActor | null;
    group: QueryGroup | null;
  };
  pages: {
    fields: QueryResponse<DataField>;
    rules: QueryResponse<RuleDefinitionV3>;
    conditions: QueryResponse<ConditionDefinition>;
    effectGroups: QueryResponse<EffectGroupDefinition>;
    records: QueryResponse<DataChangeRecord>;
  };
}

interface CursorPayload {
  version: 1;
  entity: "fields" | "actors" | "groups";
  fingerprint: string;
  anchorValue: Sortable;
  anchorId: string;
}

type Sortable = string | number | boolean;
type FilterValue = string | boolean | number;

export class MvuQueryService {
  private readonly now: () => number;
  private readonly createId: NonNullable<MvuQueryServiceOptions["createId"]>;

  constructor(
    private readonly source: MvuQuerySource,
    options: MvuQueryServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? defaultId;
  }

  async queryFields(request: QueryRequest): Promise<QueryResponse<DataField>> {
    const dataset = (await this.source.readV3()).dataset;
    const picker = request.filters?.mode === "picker" || request.cursor !== undefined;
    return queryCollection({
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
        bindingId: (item, value) => typeof value === "string" && item.bindingIds.includes(value),
      },
      validateFilters: (filters) => {
        requireFilter(filters, "mode", (value) => value === "picker");
        requireFilter(filters, "enabled", (value) => typeof value === "boolean");
        requireFilter(filters, "scope", (value) =>
          value === "character" || value === "group" || value === "global" || value === "chat");
        requireFilter(filters, "bindingId", isNonEmptyFilterString);
      },
      searchText: (item) => [item.id, item.name, item.description, ...item.bindingIds],
      id: (item) => item.id,
    });
  }

  async queryActors(request: QueryRequest): Promise<QueryResponse<DataActor>> {
    return queryCollection({
      entity: "actors",
      items: await this.source.listActors(),
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
      },
      validateFilters: (filters) => requireFilter(
        filters, "enabled", (value) => typeof value === "boolean",
      ),
      searchText: (item) => [item.characterId, item.name],
      id: (item) => item.characterId,
    });
  }

  async queryGroups(request: QueryRequest): Promise<QueryResponse<QueryGroup>> {
    return queryCollection({
      entity: "groups",
      items: await this.source.listGroups(),
      request,
      pageSize: PICKER_BATCH_SIZE,
      cursor: true,
      defaultSort: { key: "name", direction: "asc" },
      sortKeys: {
        id: (item) => item.characterGroupId,
        name: (item) => item.name,
      },
      filterKeys: {},
      searchText: (item) => [item.characterGroupId, item.name],
      id: (item) => item.characterGroupId,
    });
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
    DataField | DataActor | QueryGroup | RuleDefinitionV3 | ConditionDefinition | EffectGroupDefinition
  > {
    if (!isQueryEntityType(request.entityType)) throw new Error("MVU_ENTITY_TYPE_INVALID");
    if (typeof request.id !== "string" || request.id.length === 0 || request.id.length > 256) {
      throw new Error("MVU_ENTITY_ID_INVALID");
    }
    let entity: DataField | DataActor | QueryGroup | RuleDefinitionV3 | ConditionDefinition | EffectGroupDefinition | undefined;
    if (request.entityType === "actor") {
      entity = (await this.source.listActors()).find((item) => item.characterId === request.id);
    } else if (request.entityType === "group") {
      entity = (await this.source.listGroups()).find((item) => item.characterGroupId === request.id);
    } else {
      const dataset = (await this.source.readV3()).dataset;
      if (request.entityType === "field") entity = dataset.fields.find((item) => item.id === request.id);
      if (request.entityType === "rule") entity = dataset.rules.find((item) => item.id === request.id);
      if (request.entityType === "condition") entity = dataset.conditions.find((item) => item.id === request.id);
      if (request.entityType === "effectGroup") entity = dataset.effectGroups.find((item) => item.id === request.id);
    }
    if (entity === undefined) throw new Error(`MVU_ENTITY_NOT_FOUND:${request.entityType}:${request.id}`);
    return klona(entity);
  }

  async pageSnapshot(): Promise<MvuCompactPageSnapshot> {
    const [snapshot, actors, groups, activeContext, migrationStatus, records] = await Promise.all([
      this.source.readV3(),
      this.source.listActors(),
      this.source.listGroups(),
      this.source.activeContext(),
      this.source.migrationStatus(),
      this.queryRecords({ page: 1 }),
    ]);
    const dataset = snapshot.dataset;
    const fields = queryCollectionFromValidated("fields", dataset.fields, {}, MANAGEMENT_PAGE_SIZES.fields, false, {
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
    return {
      revision: snapshot.revision,
      activeContext,
      settings: klona(dataset.settings),
      migrationStatus,
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
        actor: activeContext.actorId === null
          ? null
          : klona(actors.find((item) => item.characterId === activeContext.actorId) ?? null),
        group: activeContext.groupId === null
          ? null
          : klona(groups.find((item) => item.characterGroupId === activeContext.groupId) ?? null),
      },
      pages: { fields, rules, conditions, effectGroups, records },
    };
  }

  createCondition(request: { condition: ConditionInput }): Promise<ConditionDefinition> {
    return this.createEntity("condition", request.condition, (draft, created) => draft.conditions.push(created));
  }

  updateCondition(request: { id: string; patch: ConditionPatch }): Promise<void> {
    return this.updateEntity("condition", request.id, request.patch, (draft) => draft.conditions);
  }

  copyCondition(request: { id: string }): Promise<ConditionDefinition> {
    return this.copyEntity("condition", request.id, (draft) => draft.conditions);
  }

  toggleCondition(request: { id: string; enabled: boolean }): Promise<void> {
    return this.updateCondition({ id: request.id, patch: { enabled: request.enabled } });
  }

  async deleteCondition(request: { id: string }): Promise<void> {
    await this.mutate((draft) => {
      if (draft.rules.some((rule) => rule.conditionId === request.id)) {
        throw new Error("MVU_CONDITION_REFERENCED");
      }
      removeRequired(draft.conditions, request.id, "MVU_CONDITION_NOT_FOUND");
    });
  }

  async getConditionReferences(request: { id: string }): Promise<EntityReferenceSummary[]> {
    const dataset = (await this.source.readV3()).dataset;
    requireById(dataset.conditions, request.id, "MVU_CONDITION_NOT_FOUND");
    return sortReferences(dataset.rules.filter((rule) => rule.conditionId === request.id).map((rule) => ({
      entityType: "rule" as const,
      id: rule.id,
      name: rule.name,
      relation: "referenced_by" as const,
    })));
  }

  createEffectGroup(request: { effectGroup: EffectGroupInput }): Promise<EffectGroupDefinition> {
    return this.createEntity("effect_group", request.effectGroup, (draft, created) => draft.effectGroups.push(created));
  }

  updateEffectGroup(request: { id: string; patch: EffectGroupPatch }): Promise<void> {
    return this.updateEntity("effect_group", request.id, request.patch, (draft) => draft.effectGroups);
  }

  copyEffectGroup(request: { id: string }): Promise<EffectGroupDefinition> {
    return this.copyEntity("effect_group", request.id, (draft) => draft.effectGroups);
  }

  toggleEffectGroup(request: { id: string; enabled: boolean }): Promise<void> {
    return this.updateEffectGroup({ id: request.id, patch: { enabled: request.enabled } });
  }

  async deleteEffectGroup(request: { id: string }): Promise<void> {
    await this.mutate((draft) => {
      const ruleReference = draft.rules.some((rule) => rule.actions.some((action) =>
        action.kind === "activate_effect_group"
          ? action.effectGroupId === request.id
          : action.effectGroupIds.includes(request.id)));
      if (ruleReference || draft.activeEffects.some((instance) => instance.definitionId === request.id)) {
        throw new Error("MVU_EFFECT_GROUP_REFERENCED");
      }
      removeRequired(draft.effectGroups, request.id, "MVU_EFFECT_GROUP_NOT_FOUND");
    });
  }

  async getEffectGroupReferences(request: { id: string }): Promise<EntityReferenceSummary[]> {
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
    return sortReferences([...ruleReferences, ...activeReferences]);
  }

  createRule(request: { rule: RuleInput }): Promise<RuleDefinitionV3> {
    return this.createEntity("rule", request.rule, (draft, created) => draft.rules.push(created));
  }

  updateRule(request: { id: string; patch: RulePatch }): Promise<void> {
    return this.updateEntity("rule", request.id, request.patch, (draft) => draft.rules);
  }

  copyRule(request: { id: string }): Promise<RuleDefinitionV3> {
    return this.copyEntity("rule", request.id, (draft) => draft.rules);
  }

  toggleRule(request: { id: string; enabled: boolean }): Promise<void> {
    return this.updateRule({ id: request.id, patch: { enabled: request.enabled } });
  }

  async deleteRule(request: { id: string }): Promise<void> {
    await this.mutate((draft) => removeRequired(draft.rules, request.id, "MVU_RULE_NOT_FOUND"));
  }

  async getRuleReferences(request: { id: string }): Promise<EntityReferenceSummary[]> {
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
    prefix: "condition" | "effect_group" | "rule",
    input: TInput,
    append: (draft: MvuDatasetV3, created: TEntity) => void,
  ): Promise<TEntity> {
    let result: TEntity | undefined;
    await this.mutate((draft) => {
      const timestamp = new Date(this.now()).toISOString();
      result = {
        ...klona(input),
        id: this.createId(prefix),
        createdAt: timestamp,
        updatedAt: timestamp,
      } as TEntity;
      append(draft, result);
    });
    if (result === undefined) throw new Error("MVU_ENTITY_CREATE_FAILED");
    return klona(result);
  }

  private async updateEntity<TEntity extends { id: string; updatedAt: string }>(
    prefix: "condition" | "effect_group" | "rule",
    id: string,
    patch: object,
    select: (draft: MvuDatasetV3) => TEntity[],
  ): Promise<void> {
    await this.mutate((draft) => {
      const entity = requireById(select(draft), id, `MVU_${prefix.toUpperCase()}_NOT_FOUND`);
      Object.assign(entity, klona(patch), { updatedAt: new Date(this.now()).toISOString() });
    });
  }

  private async copyEntity<TEntity extends { id: string; name: string; createdAt: string; updatedAt: string }>(
    prefix: "condition" | "effect_group" | "rule",
    id: string,
    select: (draft: MvuDatasetV3) => TEntity[],
  ): Promise<TEntity> {
    let result: TEntity | undefined;
    await this.mutate((draft) => {
      const source = requireById(select(draft), id, `MVU_${prefix.toUpperCase()}_NOT_FOUND`);
      const timestamp = new Date(this.now()).toISOString();
      result = {
        ...klona(source),
        id: this.createId(prefix),
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
      select(draft).push(result);
    });
    if (result === undefined) throw new Error("MVU_ENTITY_COPY_FAILED");
    return klona(result);
  }

  private async mutate(change: (draft: MvuDatasetV3) => void): Promise<void> {
    const snapshot = await this.source.readV3();
    const draft = klona(snapshot.dataset);
    change(draft);
    assertMvuDatasetV3(draft);
    await this.source.transactV3(snapshot.revision, draft, []);
  }
}

interface CollectionQueryOptions<T> {
  entity: CursorPayload["entity"] | "rules" | "conditions" | "effectGroups";
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

function queryCollection<T>(options: CollectionQueryOptions<T>): QueryResponse<T> {
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
  return sliceCollection(entity, sorted, request, pageSize, cursor, sortKeys[sort.key], sort.direction, id);
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
): QueryResponse<T> {
  const fingerprint = queryFingerprint(request);
  let offset = ((request.page ?? 1) - 1) * pageSize;
  if (cursor) {
    offset = 0;
    if (request.cursor !== undefined) {
      const anchor = decodeCursor(request.cursor, entity, fingerprint);
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
      ? encodeCursor({
          version: 1,
          entity: entity as CursorPayload["entity"],
          fingerprint,
          anchorValue: sortValue(last),
          anchorId: id(last),
        })
      : null,
  };
}

function compareToAnchor<T>(
  item: T,
  anchor: CursorPayload,
  sortValue: (item: T) => Sortable,
  direction: "asc" | "desc",
  id: (item: T) => string,
): number {
  const primary = compareSortable(sortValue(item), anchor.anchorValue);
  if (primary !== 0) return direction === "asc" ? primary : -primary;
  return compareText(id(item), anchor.anchorId);
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
    return compareText(id(left), id(right));
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
  validateQueryRequest(request, { cursor: false, sortKeys: ["occurredAt"], filterKeys: [] });
  if ((request.search ?? "").length > 0 || Object.keys(request.filters ?? {}).length > 0) {
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
  const filters = Object.entries(request.filters ?? {}).sort(([left], [right]) => compareText(left, right));
  return JSON.stringify({
    search: normalizeSearch(request.search ?? ""),
    filters,
    sort: request.sort ?? null,
  });
}

function encodeCursor(payload: CursorPayload): string {
  return `v1:${encodeURIComponent(JSON.stringify(payload))}`;
}

function decodeCursor(cursor: string, entity: string, fingerprint: string): CursorPayload {
  if (!cursor.startsWith("v1:")) throw new Error("MVU_QUERY_CURSOR_INVALID");
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(cursor.slice(3)));
  } catch {
    throw new Error("MVU_QUERY_CURSOR_INVALID");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("MVU_QUERY_CURSOR_INVALID");
  }
  const candidate = parsed as Partial<CursorPayload>;
  const anchorType = typeof candidate.anchorValue;
  if (Object.keys(parsed).length !== 5 || candidate.version !== 1 || candidate.entity !== entity ||
    candidate.fingerprint !== fingerprint ||
    (anchorType !== "string" && anchorType !== "number" && anchorType !== "boolean") ||
    (anchorType === "number" && !Number.isFinite(candidate.anchorValue)) ||
    typeof candidate.anchorId !== "string" || candidate.anchorId.length === 0 ||
    candidate.anchorId.length > 256) {
    throw new Error("MVU_QUERY_CURSOR_INVALID");
  }
  return candidate as CursorPayload;
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
  if (typeof id !== "string" || id.length === 0 || id.length > 256) {
    throw new Error("MVU_ENTITY_ID_INVALID");
  }
}

function sortReferences(references: EntityReferenceSummary[]): EntityReferenceSummary[] {
  return references.sort((left, right) =>
    compareText(left.entityType, right.entityType) || compareText(left.id, right.id));
}

let generatedIdSequence = 0;

function defaultId(prefix: "condition" | "effect_group" | "rule" | "field_effect"): string {
  generatedIdSequence += 1;
  if (!Number.isSafeInteger(generatedIdSequence)) generatedIdSequence = 1;
  return `${prefix}_${Date.now().toString(36)}_${generatedIdSequence.toString(36)}`;
}
