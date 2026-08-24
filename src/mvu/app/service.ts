/** Transactional application service for scoped MVU state. */
import type { CommandExecutorHooks } from "../core/command-executor";
import { klona } from "../port/util";
import {
  appendHourlyMessageBucket,
  evaluateAutoRules,
  evaluateLinkRules,
  MAX_MESSAGE_FACTS_PER_SCOPE_V3,
  MAX_PROCESSED_MESSAGE_IDS_V3,
  type AutomationMessageFacts,
} from "./automation";
import { activateEffectGroup, applyActiveEffects } from "./effect-engine";
import type {
  AiRuleJudgement,
  DataActor,
  DataAutoRule,
  DataChangeRecord,
  DataField,
  DataLinkRule,
  DataStage,
  DataTemporaryEffect,
  DataTemporaryEffectTarget,
  MessageAutomationSignals,
  MessageFact,
  MvuConfiguration,
  MvuDataset,
  MvuSettings,
  StateScopeContext,
  TurnCounter,
} from "./model";
import type {
  MvuDatasetV3,
  RuleTargetSelector,
} from "./model-v3";
import {
  applyMvuCommand,
  buildDeltaCommand,
  buildSetCommand,
  type ApplyCommandAudit,
  type ApplyResult,
} from "./mvu-bridge";
import {
  automationScopeKey,
  bindingIdForScope,
  deriveStage,
  fieldAppliesToContext,
  scopeKey,
  stateValueForField,
} from "./scope";
import { temporaryEffectTargetMatchesContext } from "./temporary-effect";
import {
  executeRulePlan,
  planRuleEvaluation,
  type RuleDiagnostic,
} from "./rule-engine-v3";
import type {
  ConditionJudgementRequest,
  ConditionJudgementResult,
} from "./system-model";
import type { MvuStore } from "./store";
import { StaleRevisionError } from "./store";
import {
  assertMvuDataset,
  assertMvuDatasetV3,
  normalizeMvuDataset,
  validateAutoRule,
  validateConfiguration,
  validateDataField,
  validateLinkRule,
  validateTemporaryEffect,
} from "./validation";

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface MvuTransactionResult<TResult> {
  dataset: MvuDataset;
  result: TResult;
}

export interface StateValueChangeInput {
  context: StateScopeContext;
  fieldId: string;
  value: number;
  reason: string;
  source: DataChangeRecord["source"];
  ruleIds: readonly string[];
  confidence: number | null;
  messageId: string | null;
  variantId: string | null;
  occurredAt: number;
}

export interface PersistedMessageIdentity {
  context: StateScopeContext;
  messageId: string;
  variantId: string | null;
}

export interface PersistedMessageInput extends PersistedMessageIdentity {
  content: string;
  role: "user" | "character";
  occurredAt: number;
  signals: MessageAutomationSignals;
  aiChanges: readonly PersistedAiChange[];
  aiRuleJudgements: readonly AiRuleJudgement[];
}

export interface PersistedAiChange {
  fieldId: string;
  delta: number;
  reason: string;
  confidence: number;
}

export interface ApplyAiJudgementInput {
  context: StateScopeContext;
  changes: readonly PersistedAiChange[];
  occurredAt: number;
}

export interface ProcessPersistedMessageResult {
  duplicate: boolean;
  records: DataChangeRecord[];
  matchedRuleIds: string[];
}

export interface PersistedMessageV3Input extends PersistedMessageIdentity {
  dataset: MvuDatasetV3;
  currentActorId: string | null;
  content: string;
  role: "user" | "character";
  occurredAt: number;
  signals: MessageAutomationSignals;
  actorNamesById?: Readonly<Record<string, string>>;
  judgeConditions?: (request: ConditionJudgementRequest) => Promise<ConditionJudgementResult>;
}

export interface ProcessPersistedMessageV3Result {
  dataset: MvuDatasetV3;
  duplicate: boolean;
  records: DataChangeRecord[];
  matchedRuleIds: string[];
  diagnostics: RuleDiagnostic[];
}

export interface FieldStateProjection {
  definition: DataField;
  bound: boolean;
  scopeKey: string | null;
  currentValue: number | null;
  currentStage: DataStage | null;
}

interface PendingFieldChange {
  delta: number;
  perTurn: boolean;
  autoRuleIds: string[];
  autoRuleReasons: string[];
  temporaryEffectIds: string[];
  aiReason: string | null;
  aiConfidence: number | null;
}

/**
 * Callable v3 message path used before Task 5 supplies an atomic v3 store. It
 * returns a new dataset and never writes through the production v2 store.
 */
export async function processPersistedMessageV3(
  input: PersistedMessageV3Input,
): Promise<ProcessPersistedMessageV3Result> {
  validatePersistedMessageInput({ ...input, aiChanges: [], aiRuleJudgements: [] });
  assertMvuDatasetV3(input.dataset);
  const draft = klona(input.dataset);
  const messageKey = processedMessageKey(input);
  if (draft.processedMessageIds.includes(messageKey)) {
    return { dataset: draft, duplicate: true, records: [], matchedRuleIds: [], diagnostics: [] };
  }

  const eventKey = automationScopeKey(input.context);
  const fact = messageFact({ ...input, aiChanges: [], aiRuleJudgements: [] });
  const facts = [...(draft.messageFacts[eventKey] ?? []), fact];
  draft.messageFacts[eventKey] = facts.slice(-MAX_MESSAGE_FACTS_PER_SCOPE_V3);
  draft.hourlyMessageBuckets[eventKey] = appendHourlyMessageBucket(
    draft.hourlyMessageBuckets[eventKey] ?? [],
    input.occurredAt,
  );

  const plan = planRuleEvaluation({
    rules: draft.rules,
    conditions: draft.conditions,
    context: {
      actorId: input.context.actorId,
      groupId: input.context.groupId,
      chatId: input.context.chatId,
      now: input.occurredAt,
      fieldValues: stateValuesForV3Context(draft, input.context),
      messageFacts: draft.messageFacts[eventKey],
      hourlyMessageBuckets: draft.hourlyMessageBuckets[eventKey],
    },
    currentActorId: input.currentActorId,
    lastTriggeredAtByRuleId: draft.ruleLastTriggered[eventKey] ?? {},
  });
  const diagnostics = [...plan.diagnostics];
  const aiSemanticResults: Record<string, { matched: boolean; confidence: number }> = {};
  if (plan.aiPredicates.length > 0) {
    try {
      if (input.judgeConditions === undefined) throw new Error("MVU_AI_CONDITION_JUDGE_UNAVAILABLE");
      const judged = await input.judgeConditions({
        predicates: plan.aiPredicates,
        message: {
          role: input.role,
          actorId: input.context.actorId,
          actorName: input.context.actorName,
          content: input.content,
        },
      });
      if (!judged.available) throw new Error("MVU_AI_CONDITION_JUDGE_UNAVAILABLE");
      for (const judgement of judged.judgements) {
        if (plan.aiPredicates.some((predicate) => predicate.id === judgement.predicateId)) {
          aiSemanticResults[judgement.predicateId] = {
            matched: judgement.matched,
            confidence: judgement.confidence,
          };
        }
      }
    } catch (error) {
      diagnostics.push({
        code: "MVU_RULE_AI_BATCH_FAILED",
        detail: error instanceof Error ? error.message : "MVU_AI_CONDITION_JUDGE_FAILED",
      });
    }
  }

  const execution = executeRulePlan({ plan, aiSemanticResults });
  const records: DataChangeRecord[] = [];
  let recordSequence = 0;
  for (const executed of execution.actions) {
    const action = executed.action;
    if (action.kind === "change_field") {
      const field = draft.fields.find((candidate) => candidate.id === action.fieldId);
      if (field === undefined || !field.enabled) {
        diagnostics.push({ code: "MVU_RULE_FIELD_NOT_FOUND", ruleId: executed.ruleId, actionIndex: executed.actionIndex });
        continue;
      }
      const targets = resolveRuleActionTargets(field, action.target, input.context.actorId);
      if (targets.length === 0) {
        diagnostics.push({ code: "MVU_RULE_ACTION_TARGET_EMPTY", ruleId: executed.ruleId, actionIndex: executed.actionIndex });
        continue;
      }
      const selectedGroups = new Set(action.effectGroupIds);
      const selectedActiveEffects = draft.activeEffects.filter((instance) => selectedGroups.has(instance.definitionId));
      for (const target of targets) {
        const record = applyV3RuleChange({
          draft,
          field,
          target,
          sourceDelta: action.delta,
          activeEffects: selectedActiveEffects,
          ruleId: executed.ruleId,
          ruleName: executed.ruleName,
          input,
          recordId: v3RecordId(messageKey, recordSequence),
        });
        recordSequence += 1;
        if (record !== null) records.push(record);
      }
      continue;
    }

    const definition = draft.effectGroups.find((candidate) => candidate.id === action.effectGroupId);
    if (definition === undefined) {
      diagnostics.push({ code: "MVU_RULE_EFFECT_GROUP_NOT_FOUND", ruleId: executed.ruleId, actionIndex: executed.actionIndex });
      continue;
    }
    const activation = activateEffectGroup({
      definition,
      fields: draft.fields,
      triggerActorId: input.context.actorId ?? undefined,
      instanceId: v3EffectInstanceId(messageKey, executed.ruleId, executed.actionIndex),
      activatedAt: new Date(input.occurredAt).toISOString(),
      reason: { mode: "template", template: "general" },
      reasonVariables: {
        triggerActorName: input.context.actorName,
        ruleName: executed.ruleName,
        effectGroupName: definition.name,
        event: "message",
      },
      currentValues: flattenV3StateValues(draft),
    });
    for (const diagnostic of activation.diagnostics) {
      diagnostics.push({ code: "MVU_RULE_ACTION_TARGET_EMPTY", ruleId: executed.ruleId, actionIndex: executed.actionIndex, detail: diagnostic.code });
    }
    draft.activeEffects.push(...activation.instances);
    const resolvedTargets = activation.instances[0]?.resolvedTargets ?? [];
    const targetUseCount = new Map<string, number>();
    for (const change of activation.immediateChanges) {
      const target = takeActivationTarget(resolvedTargets, change.fieldId, change.actorId, targetUseCount);
      const field = draft.fields.find((candidate) => candidate.id === change.fieldId);
      if (target === undefined || field === undefined) continue;
      const record = applyV3ImmediateChange({
        draft,
        field,
        scopeKey: target.scopeKey,
        actorId: target.actorId,
        delta: change.delta,
        effectId: activation.instances[0]?.id ?? null,
        ruleId: executed.ruleId,
        ruleName: executed.ruleName,
        input,
        recordId: v3RecordId(messageKey, recordSequence),
      });
      recordSequence += 1;
      if (record !== null) records.push(record);
    }
  }

  draft.ruleLastTriggered[eventKey] = draft.ruleLastTriggered[eventKey] ?? {};
  for (const update of execution.cooldownUpdates) {
    draft.ruleLastTriggered[eventKey][update.ruleId] = update.triggeredAt;
  }
  draft.processedMessageIds.push(messageKey);
  draft.processedMessageIds = draft.processedMessageIds.slice(-MAX_PROCESSED_MESSAGE_IDS_V3);
  draft.records.push(...records);
  assertMvuDatasetV3(draft);
  return {
    dataset: draft,
    duplicate: false,
    records,
    matchedRuleIds: execution.matchedRuleIds,
    diagnostics,
  };
}

export class MvuService {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: MvuStore,
    private readonly hooks: CommandExecutorHooks
  ) {}

  async getDataset(): Promise<MvuDataset> {
    return (await this.store.read()).dataset;
  }

  async mutate(fn: (draft: MvuDataset) => void | Promise<void>): Promise<MvuDataset> {
    return (await this.transact(fn)).dataset;
  }

  async transact<TResult>(
    fn: (draft: MvuDataset) => TResult | Promise<TResult>
  ): Promise<MvuTransactionResult<TResult>> {
    const run = this.mutationTail.then(
      () => this.executeTransaction(fn),
      () => this.executeTransaction(fn)
    );
    this.mutationTail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async executeTransaction<TResult>(
    fn: (draft: MvuDataset) => TResult | Promise<TResult>
  ): Promise<MvuTransactionResult<TResult>> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const snapshot = await this.store.read();
      const draft = klona(snapshot.dataset);
      const result = await fn(draft);
      assertMvuDataset(draft);
      if (JSON.stringify(draft) === JSON.stringify(snapshot.dataset)) {
        return { dataset: snapshot.dataset, result };
      }
      try {
        const committed = await this.store.transact(snapshot.revision, draft);
        return { dataset: committed.dataset, result };
      } catch (error) {
        if (error instanceof StaleRevisionError && attempt < 7) continue;
        console.error("MVU transaction failed", error);
        throw error;
      }
    }
    throw new Error("MVU_MUTATION_CONFLICT");
  }

  async bootstrapActors(contexts: readonly StateScopeContext[]): Promise<void> {
    await this.mutate((draft) => {
      const completedFieldIds = new Set<string>();
      for (const fieldId of draft.pendingBootstrapFieldIds) {
        const field = requireField(draft, fieldId);
        if (field.scope === "global") {
          throw new Error(`MVU_PENDING_BOOTSTRAP_FIELD_GLOBAL:${field.id}`);
        }
        for (const context of contexts) {
          const bindingId = bindingIdForScope(field.scope, context);
          if (bindingId !== null && bindingId.length > 0 && !field.bindingIds.includes(bindingId)) {
            field.bindingIds.push(bindingId);
          }
        }
        if (field.bindingIds.length > 0) completedFieldIds.add(field.id);
      }
      draft.pendingBootstrapFieldIds = draft.pendingBootstrapFieldIds.filter(
        (fieldId) => !completedFieldIds.has(fieldId)
      );
      validateConfiguration(draft);
    });
  }

  async projectFields(context: StateScopeContext): Promise<FieldStateProjection[]> {
    const dataset = await this.getDataset();
    return dataset.fields.map((field) => {
      const bound = fieldAppliesToContext(field, context);
      if (!bound) {
        return {
          definition: field,
          bound: false,
          scopeKey: null,
          currentValue: null,
          currentStage: null,
        };
      }
      const value = stateValueForField(dataset, field, context);
      return {
        definition: field,
        bound: true,
        scopeKey: scopeKey(field.scope, context),
        currentValue: value,
        currentStage: deriveStage(field, value),
      };
    });
  }

  async getApplicableAiRules(
    context: StateScopeContext,
    occurredAt: number
  ): Promise<DataAutoRule[]> {
    if (!Number.isFinite(occurredAt)) throw new Error("MVU_AI_RULE_TIME_INVALID");
    const dataset = await this.getDataset();
    const lastTriggered = dataset.ruleLastTriggered[automationScopeKey(context)] ?? {};
    return klona(applicableAutoRules(dataset, context).filter((rule) => {
      if (!rule.enabled || rule.condition.kind !== "aiJudgement") return false;
      const last = lastTriggered[rule.id];
      return last === undefined || occurredAt - last >= rule.cooldownMs;
    }));
  }

  async addField(field: Omit<DataField, "id" | "order">): Promise<DataField> {
    const created: DataField = { ...klona(field), id: makeId("field"), order: Date.now() };
    validateDataField(created);
    await this.mutate((draft) => {
      draft.fields.push(created);
      validateConfiguration(draft);
    });
    return klona(created);
  }

  async updateField(id: string, patch: Partial<Omit<DataField, "id">>): Promise<void> {
    await this.mutate((draft) => {
      const field = requireField(draft, id);
      const nextPatch = klona(patch);
      const nextMinimum = nextPatch.minimum ?? field.minimum;
      const nextMaximum = nextPatch.maximum ?? field.maximum;
      if (nextMinimum !== field.minimum || nextMaximum !== field.maximum) {
        // Range is a unit definition shared by values, stages and rule thresholds. Updating only
        // the two bounds leaves a structurally invalid field or silently drops runtime values.
        // Remap every dependent quantity in the same transaction to preserve relative meaning.
        remapFieldRange(draft, field, nextMinimum, nextMaximum);
        delete nextPatch.minimum;
        delete nextPatch.maximum;
      }
      Object.assign(field, nextPatch);
      if (Object.prototype.hasOwnProperty.call(patch, "bindingIds") ||
        Object.prototype.hasOwnProperty.call(patch, "scope")) {
        draft.pendingBootstrapFieldIds = draft.pendingBootstrapFieldIds.filter(
          (fieldId) => fieldId !== id
        );
      }
      draft.temporaryEffects = reconcileTemporaryEffectsForField(
        draft.temporaryEffects,
        field
      );
      reconcileAutoRuleEffectImports(draft);
      validateConfiguration(draft);
      cleanRuntimeForConfiguration(draft);
    });
  }

  async deleteField(id: string): Promise<void> {
    await this.mutate((draft) => {
      requireField(draft, id);
      draft.fields = draft.fields.filter((field) => field.id !== id);
      draft.pendingBootstrapFieldIds = draft.pendingBootstrapFieldIds.filter(
        (fieldId) => fieldId !== id
      );
      draft.rules = draft.rules.filter((rule) =>
        rule.sourceFieldId !== id && rule.targetFieldId !== id
      );
      draft.autoRules = draft.autoRules
        .filter((rule) => !(rule.condition.kind === "stateThreshold" && rule.condition.fieldId === id))
        .map((rule) => ({
          ...rule,
          effects: rule.effects.filter((effect) => effect.fieldId !== id),
        }))
        .filter((rule) => rule.effects.length > 0);
      draft.temporaryEffects = removeFieldFromTemporaryEffects(draft.temporaryEffects, id);
      reconcileAutoRuleEffectImports(draft);
      removeFieldFromRuntimeMaps(draft, id);
      validateConfiguration(draft);
    });
  }

  async addLinkRule(rule: Omit<DataLinkRule, "id">): Promise<DataLinkRule> {
    const created: DataLinkRule = { ...klona(rule), id: makeId("rule") };
    await this.mutate((draft) => {
      validateLinkRule(created, draft.fields);
      draft.rules.push(created);
      validateConfiguration(draft);
    });
    return klona(created);
  }

  async updateLinkRule(id: string, patch: Partial<Omit<DataLinkRule, "id">>): Promise<void> {
    await this.mutate((draft) => {
      const rule = draft.rules.find((candidate) => candidate.id === id);
      if (rule === undefined) throw new Error(`MVU_LINK_RULE_NOT_FOUND:${id}`);
      Object.assign(rule, klona(patch));
      validateConfiguration(draft);
    });
  }

  async deleteLinkRule(id: string): Promise<void> {
    await this.mutate((draft) => {
      if (!draft.rules.some((rule) => rule.id === id)) throw new Error(`MVU_LINK_RULE_NOT_FOUND:${id}`);
      draft.rules = draft.rules.filter((rule) => rule.id !== id);
    });
  }

  async addAutoRule(rule: Omit<DataAutoRule, "id">): Promise<DataAutoRule> {
    const created: DataAutoRule = { ...klona(rule), id: makeId("auto") };
    await this.mutate((draft) => {
      validateAutoRule(created, draft.fields, draft.temporaryEffects);
      draft.autoRules.push(created);
      validateConfiguration(draft);
    });
    return klona(created);
  }

  async updateAutoRule(id: string, patch: Partial<Omit<DataAutoRule, "id">>): Promise<void> {
    await this.mutate((draft) => {
      const rule = draft.autoRules.find((candidate) => candidate.id === id);
      if (rule === undefined) throw new Error(`MVU_AUTO_RULE_NOT_FOUND:${id}`);
      Object.assign(rule, klona(patch));
      validateConfiguration(draft);
    });
  }

  async deleteAutoRule(id: string): Promise<void> {
    await this.mutate((draft) => {
      if (!draft.autoRules.some((rule) => rule.id === id)) throw new Error(`MVU_AUTO_RULE_NOT_FOUND:${id}`);
      draft.autoRules = draft.autoRules.filter((rule) => rule.id !== id);
      for (const triggerMap of Object.values(draft.ruleLastTriggered)) delete triggerMap[id];
    });
  }

  async addTemporaryEffect(
    effect: Omit<DataTemporaryEffect, "id">
  ): Promise<DataTemporaryEffect> {
    const created: DataTemporaryEffect = { ...klona(effect), id: makeId("effect") };
    await this.mutate((draft) => {
      validateTemporaryEffect(created, draft.fields);
      draft.temporaryEffects.push(created);
      validateConfiguration(draft);
    });
    return klona(created);
  }

  async updateTemporaryEffect(
    id: string,
    patch: Partial<Omit<DataTemporaryEffect, "id">>
  ): Promise<void> {
    await this.mutate((draft) => {
      const effect = draft.temporaryEffects.find((candidate) => candidate.id === id);
      if (effect === undefined) throw new Error(`MVU_EFFECT_NOT_FOUND:${id}`);
      Object.assign(effect, klona(patch));
      reconcileAutoRuleEffectImports(draft);
      validateConfiguration(draft);
    });
  }

  async deleteTemporaryEffect(id: string): Promise<void> {
    await this.mutate((draft) => {
      if (!draft.temporaryEffects.some((effect) => effect.id === id)) {
        throw new Error(`MVU_EFFECT_NOT_FOUND:${id}`);
      }
      draft.temporaryEffects = draft.temporaryEffects.filter((effect) => effect.id !== id);
      reconcileAutoRuleEffectImports(draft);
    });
  }

  async exportConfiguration(): Promise<MvuConfiguration> {
    const dataset = await this.getDataset();
    return klona({
      fields: dataset.fields,
      rules: dataset.rules,
      autoRules: dataset.autoRules,
      temporaryEffects: dataset.temporaryEffects,
      settings: dataset.settings,
    });
  }

  async replaceConfiguration(configuration: MvuConfiguration): Promise<void> {
    const next = klona(configuration);
    validateConfiguration(next);
    await this.mutate((draft) => {
      draft.fields = next.fields;
      draft.pendingBootstrapFieldIds = [];
      draft.rules = next.rules;
      draft.autoRules = next.autoRules;
      draft.temporaryEffects = next.temporaryEffects;
      draft.settings = next.settings;
      cleanRuntimeForConfiguration(draft);
    });
  }

  /** Import one complete v2 document while keeping the local CAS revision authoritative. */
  async replaceDataset(dataset: MvuDataset): Promise<void> {
    const next = normalizeMvuDataset(klona(dataset));
    await this.mutate((draft) => {
      const currentRevision = draft.revision;
      Object.assign(draft, next);
      draft.revision = currentRevision;
    });
  }

  async updateSettings(settings: MvuSettings): Promise<void> {
    const next = klona(settings);
    await this.mutate((draft) => {
      draft.settings = next;
      validateConfiguration(draft);
    });
  }

  async getStateValue(context: StateScopeContext, fieldId: string): Promise<number> {
    const dataset = await this.getDataset();
    const field = requireApplicableField(dataset, context, fieldId);
    return stateValueForField(dataset, field, context);
  }

  async setStateValue(input: StateValueChangeInput): Promise<ApplyResult> {
    const transaction = await this.transact(async (draft) => {
      expireTemporaryEffects(draft, input.occurredAt);
      const field = requireApplicableField(draft, input.context, input.fieldId);
      const before = stateValueForField(draft, field, input.context);
      const stateValuesBefore = stateValuesForContext(draft, input.context);
      const primary = await applyMvuCommand(
        draft,
        this.hooks,
        input.context,
        buildSetCommand(field.id, input.value),
        {
          reason: input.reason,
          source: input.source,
          requestedDelta: input.value - before,
          ruleIds: input.ruleIds,
          temporaryEffectIds: [],
          confidence: input.confidence,
          messageId: input.messageId,
          variantId: input.variantId,
          occurredAt: input.occurredAt,
        }
      );
      if (primary.record === undefined) return primary;
      await this.applyLinkedChangesFromBaseDraft(
        draft,
        input.context,
        stateValuesBefore,
        [primary.record],
        input.occurredAt,
        input.messageId,
        input.variantId
      );
      return primary;
    });
    return transaction.result;
  }

  async applyCommand(
    context: StateScopeContext,
    commandText: string,
    audit: ApplyCommandAudit
  ): Promise<ApplyResult> {
    return (await this.transact((draft) =>
      applyMvuCommand(draft, this.hooks, context, commandText, audit)
    )).result;
  }

  async settleNatural(
    context: StateScopeContext,
    now: number = Date.now()
  ): Promise<DataChangeRecord[]> {
    return (await this.transact((draft) => {
      expireTemporaryEffects(draft, now);
      return this.settleNaturalDraft(draft, context, now);
    })).result;
  }

  async applyAiJudgement(input: ApplyAiJudgementInput): Promise<DataChangeRecord[]> {
    validateAiJudgementInput(input);
    return (await this.transact(async (draft) => {
      validateAiChangesForDataset(draft, input.context, input.changes);
      expireTemporaryEffects(draft, input.occurredAt);
      const pending = new Map<string, PendingFieldChange>();
      collectAiDeltas(draft, input.context, input.changes, pending);
      return this.applyPendingChangesDraft(
        draft,
        input.context,
        pending,
        input.occurredAt,
        null,
        null
      );
    })).result;
  }

  private async settleNaturalDraft(
    draft: MvuDataset,
    context: StateScopeContext,
    now: number,
    messageId: string | null = null,
    variantId: string | null = null
  ): Promise<DataChangeRecord[]> {
    if (!Number.isFinite(now)) throw new Error("MVU_NATURAL_NOW_INVALID");
    expireTemporaryEffects(draft, now);
    const stateValuesBefore = stateValuesForContext(draft, context);
    const records: DataChangeRecord[] = [];
    for (const field of draft.fields) {
      if (!fieldAppliesToContext(field, context) || !field.naturalChange.enabled) continue;
      const key = scopeKey(field.scope, context);
      draft.lastSettled[key] = draft.lastSettled[key] ?? {};
      const last = draft.lastSettled[key][field.id];
      if (last === undefined) {
        draft.lastSettled[key][field.id] = now;
        continue;
      }
      if (now < last) throw new Error(`MVU_NATURAL_CLOCK_REVERSED:${field.id}`);
      const units = Math.floor((now - last) / field.naturalChange.unitMs);
      if (units === 0) continue;
      draft.lastSettled[key][field.id] = last + units * field.naturalChange.unitMs;
      const requestedDelta = units * field.naturalChange.amount;
      const result = await applyMvuCommand(
        draft,
        this.hooks,
        context,
        buildDeltaCommand(field.id, requestedDelta),
        {
          reason: "按时间自然变化",
          source: "natural",
          requestedDelta,
          ruleIds: [],
          temporaryEffectIds: null,
          confidence: null,
          messageId,
          variantId,
          occurredAt: now,
        }
      );
      if (result.record !== undefined) records.push(result.record);
    }
    const linkedRecords = await this.applyLinkedChangesFromBaseDraft(
      draft,
      context,
      stateValuesBefore,
      records,
      now,
      messageId,
      variantId
    );
    return [...records, ...linkedRecords];
  }

  async processPersistedMessage(input: PersistedMessageInput): Promise<ProcessPersistedMessageResult> {
    validatePersistedMessageInput(input);
    return (await this.transact(async (draft) => {
      const messageKey = processedMessageKey(input);
      if (draft.processedMessageIds.includes(messageKey)) {
        return { duplicate: true, records: [], matchedRuleIds: [] };
      }

      validateAiChangesForDataset(draft, input.context, input.aiChanges);
      validateAiRuleJudgementsForDataset(draft, input.aiRuleJudgements);
      expireTemporaryEffects(draft, input.occurredAt);
      const records = await this.settleNaturalDraft(
        draft,
        input.context,
        input.occurredAt,
        input.messageId,
        input.variantId
      );
      const pending = collectPerTurnDeltas(draft, input);
      collectAiDeltas(draft, input.context, input.aiChanges, pending);
      const stateValues = stateValuesForContext(draft, input.context);
      const eventKey = automationScopeKey(input.context);
      const autoResult = evaluateAutoRules({
        rules: applicableAutoRules(draft, input.context),
        facts: automationFacts(input, stateValues, input.aiRuleJudgements),
        lastTriggeredAtByRuleId: draft.ruleLastTriggered[eventKey] ?? {},
      });
      for (const effect of autoResult.effects) {
        addPendingDelta(
          pending,
          effect.fieldId,
          effect.delta,
          false,
          effect.ruleId,
          effect.temporaryEffectIds,
          effect.triggerReason,
          effect.triggerConfidence
        );
      }

      records.push(...await this.applyPendingChangesDraft(
        draft,
        input.context,
        pending,
        input.occurredAt,
        input.messageId,
        input.variantId
      ));

      draft.ruleLastTriggered[eventKey] = draft.ruleLastTriggered[eventKey] ?? {};
      for (const update of autoResult.cooldownUpdates) {
        draft.ruleLastTriggered[eventKey][update.ruleId] = update.triggeredAt;
      }
      draft.processedMessageIds.push(messageKey);
      draft.messageFacts[eventKey] = draft.messageFacts[eventKey] ?? [];
      draft.messageFacts[eventKey].push(messageFact(input));
      if (draft.messageFacts[eventKey].length > 20) {
        draft.messageFacts[eventKey].splice(0, draft.messageFacts[eventKey].length - 20);
      }
      if (input.role === "character") consumeTemporaryEffectTurns(draft, input.context);
      return {
        duplicate: false,
        records,
        matchedRuleIds: autoResult.matchedRules.map((rule) => rule.ruleId),
      };
    })).result;
  }

  private async applyPendingChangesDraft(
    draft: MvuDataset,
    context: StateScopeContext,
    pending: Map<string, PendingFieldChange>,
    occurredAt: number,
    messageId: string | null,
    variantId: string | null
  ): Promise<DataChangeRecord[]> {
    const stateValues = stateValuesForContext(draft, context);
    const linkResult = evaluateLinkRules({
      rules: applicableLinkRules(draft, context),
      stateValues,
      baseDeltas: [...pending.entries()].map(([fieldId, change]) => ({
        fieldId,
        delta: change.delta,
      })),
      triggerFieldIds: [...pending.entries()]
        .filter(([, change]) => change.delta !== 0)
        .map(([fieldId]) => fieldId),
    });
    if (linkResult.selfLoopRuleIds.length > 0 || linkResult.cycleRuleIds.length > 0 ||
      linkResult.depthLimitedRuleIds.length > 0) {
      throw new Error("MVU_LINK_EVALUATION_REJECTED");
    }

    const records: DataChangeRecord[] = [];
    for (const change of linkResult.changes) {
      if (change.finalDelta === 0) continue;
      const field = requireApplicableField(draft, context, change.fieldId);
      const pendingChange = pending.get(change.fieldId);
      const ruleIds = uniqueStrings([
        ...(pendingChange?.autoRuleIds ?? []),
        ...change.triggeredRuleIds,
      ]);
      const aiReason = pendingChange?.aiReason ?? null;
      let source: DataChangeRecord["source"] = "per_turn";
      let reason = "每轮变化";
      if (aiReason !== null) {
        source = "ai";
        reason = aiReason;
      }
      if (ruleIds.length > 0) {
        source = "rule";
        const ruleReasons = pendingChange?.autoRuleReasons ?? [];
        const ruleReason = ruleReasons.length > 0
          ? `AI 触发：${ruleReasons.join("、")}`
          : "消息规则结算";
        reason = aiReason === null ? ruleReason : `${aiReason}；${ruleReason}`;
      }
      const result = await applyMvuCommand(
        draft,
        this.hooks,
        context,
        buildDeltaCommand(field.id, change.finalDelta),
        {
          reason,
          source,
          requestedDelta: change.finalDelta,
          ruleIds,
          temporaryEffectIds: ruleIds.length > 0
            ? pendingChange?.temporaryEffectIds ?? []
            : null,
          confidence: pendingChange?.aiConfidence ?? null,
          messageId,
          variantId,
          occurredAt,
        }
      );
      if (result.record !== undefined) records.push(result.record);
    }
    return records;
  }

  private async applyLinkedChangesFromBaseDraft(
    draft: MvuDataset,
    context: StateScopeContext,
    stateValuesBefore: Readonly<Record<string, number>>,
    baseRecords: readonly DataChangeRecord[],
    occurredAt: number,
    messageId: string | null,
    variantId: string | null
  ): Promise<DataChangeRecord[]> {
    const baseDeltas = baseRecords.map((record) => ({
      fieldId: record.fieldId,
      delta: record.delta,
    }));
    const linkResult = evaluateLinkRules({
      rules: applicableLinkRules(draft, context),
      stateValues: stateValuesBefore,
      baseDeltas,
      triggerFieldIds: baseDeltas.map((change) => change.fieldId),
    });
    if (linkResult.selfLoopRuleIds.length > 0 || linkResult.cycleRuleIds.length > 0 ||
      linkResult.depthLimitedRuleIds.length > 0) {
      throw new Error("MVU_LINK_EVALUATION_REJECTED");
    }

    const records: DataChangeRecord[] = [];
    for (const change of linkResult.changes) {
      if (change.triggeredRuleIds.length === 0) continue;
      const linkedDelta = change.finalDelta - change.baseDelta;
      if (linkedDelta === 0) continue;
      const field = requireApplicableField(draft, context, change.fieldId);
      const result = await applyMvuCommand(
        draft,
        this.hooks,
        context,
        buildDeltaCommand(field.id, linkedDelta),
        {
          reason: "联动规则结算",
          source: "rule",
          requestedDelta: linkedDelta,
          ruleIds: uniqueStrings(change.triggeredRuleIds),
          temporaryEffectIds: [],
          confidence: null,
          messageId,
          variantId,
          occurredAt,
        }
      );
      if (result.record !== undefined) records.push(result.record);
    }
    return records;
  }

  async getRules(): Promise<DataLinkRule[]> {
    return (await this.getDataset()).rules;
  }

  async getAutoRules(): Promise<DataAutoRule[]> {
    return (await this.getDataset()).autoRules;
  }

  async getFields(): Promise<DataField[]> {
    return (await this.getDataset()).fields;
  }

  async getRecords(): Promise<DataChangeRecord[]> {
    return (await this.getDataset()).records;
  }

  async clearRecords(): Promise<void> {
    await this.mutate((draft) => {
      draft.records = [];
    });
  }

  async getRecentMessageFacts(
    context: StateScopeContext,
    limit: number = 20
  ): Promise<MessageFact[]> {
    if (!Number.isInteger(limit) || limit <= 0 || limit > 20) {
      throw new Error("MVU_MESSAGE_FACT_LIMIT_INVALID");
    }
    const dataset = await this.getDataset();
    const facts = dataset.messageFacts[automationScopeKey(context)] ?? [];
    return klona(facts.slice(-limit));
  }

  async hasProcessedMessage(identity: PersistedMessageIdentity): Promise<boolean> {
    if (typeof identity.messageId !== "string" || identity.messageId.length === 0) {
      throw new Error("MVU_MESSAGE_ID_EMPTY");
    }
    if (identity.variantId !== null &&
      (typeof identity.variantId !== "string" || identity.variantId.length === 0)) {
      throw new Error("MVU_MESSAGE_VARIANT_INVALID");
    }
    validateScopeContext(identity.context);
    return (await this.getDataset()).processedMessageIds.includes(processedMessageKey(identity));
  }
}

interface V3ResolvedRuleTarget {
  actorId: string | null;
  scopeKey: string;
}

function stateValuesForV3Context(
  dataset: MvuDatasetV3,
  context: StateScopeContext,
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const field of dataset.fields) {
    if (!field.enabled || !fieldAppliesToContext(field, context)) continue;
    const key = scopeKey(field.scope, context);
    if (key === null) continue;
    values[field.id] = dataset.stateValues[key]?.[field.id] ?? field.initialValue;
  }
  return values;
}

function resolveRuleActionTargets(
  field: DataField,
  selector: RuleTargetSelector,
  triggerActorId: string | null,
): V3ResolvedRuleTarget[] {
  if (selector.kind === "trigger_actor") {
    if (triggerActorId === null || field.scope !== "character" || !field.bindingIds.includes(triggerActorId)) return [];
    return [{ actorId: triggerActorId, scopeKey: `character:${triggerActorId}` }];
  }
  if (selector.kind === "selected") {
    if (field.scope !== "character") return [];
    return selector.actorIds
      .filter((actorId) => field.bindingIds.includes(actorId))
      .map((actorId) => ({ actorId, scopeKey: `character:${actorId}` }));
  }
  if (field.scope === "global") return [{ actorId: null, scopeKey: "global" }];
  return field.bindingIds.map((bindingId) => ({
    actorId: field.scope === "character" ? bindingId : null,
    scopeKey: `${field.scope}:${bindingId}`,
  }));
}

function applyV3RuleChange(input: {
  draft: MvuDatasetV3;
  field: DataField;
  target: V3ResolvedRuleTarget;
  sourceDelta: number;
  activeEffects: MvuDatasetV3["activeEffects"];
  ruleId: string;
  ruleName: string;
  input: PersistedMessageV3Input;
  recordId: string;
}): DataChangeRecord | null {
  const before = input.draft.stateValues[input.target.scopeKey]?.[input.field.id] ?? input.field.initialValue;
  const applied = applyActiveEffects({
    field: input.field,
    actorId: input.target.actorId,
    scopeKey: input.target.scopeKey,
    source: "rule",
    sourceDelta: input.sourceDelta,
    currentValue: before,
    activeEffects: input.activeEffects,
    effectGroups: input.draft.effectGroups,
    occurredAt: new Date(input.input.occurredAt).toISOString(),
  });
  if (applied.effectiveDelta === 0) return null;
  input.draft.stateValues[input.target.scopeKey] = input.draft.stateValues[input.target.scopeKey] ?? {};
  input.draft.stateValues[input.target.scopeKey][input.field.id] = applied.nextValue;
  return v3RuleRecord({
    field: input.field,
    scopeKey: input.target.scopeKey,
    actorId: input.target.actorId,
    before,
    after: applied.nextValue,
    requestedDelta: input.sourceDelta,
    effectiveRequestedDelta: applied.effectiveDelta,
    effectIds: applied.effectIds,
    reason: applied.reasons.length === 0
      ? `规则触发：${input.ruleName}`
      : `规则触发：${input.ruleName}；效果：${applied.reasons.map((reason) => reason.text).join("、")}`,
    ruleId: input.ruleId,
    input: input.input,
    recordId: input.recordId,
  });
}

function applyV3ImmediateChange(input: {
  draft: MvuDatasetV3;
  field: DataField;
  scopeKey: string;
  actorId: string | null;
  delta: number;
  effectId: string | null;
  ruleId: string;
  ruleName: string;
  input: PersistedMessageV3Input;
  recordId: string;
}): DataChangeRecord | null {
  if (input.delta === 0) return null;
  const before = input.draft.stateValues[input.scopeKey]?.[input.field.id] ?? input.field.initialValue;
  const after = before + input.delta;
  input.draft.stateValues[input.scopeKey] = input.draft.stateValues[input.scopeKey] ?? {};
  input.draft.stateValues[input.scopeKey][input.field.id] = after;
  return v3RuleRecord({
    field: input.field,
    scopeKey: input.scopeKey,
    actorId: input.actorId,
    before,
    after,
    requestedDelta: input.delta,
    effectiveRequestedDelta: input.delta,
    effectIds: input.effectId === null ? [] : [input.effectId],
    reason: `规则触发：${input.ruleName}；激活效果组`,
    ruleId: input.ruleId,
    input: input.input,
    recordId: input.recordId,
  });
}

function v3RuleRecord(input: {
  field: DataField;
  scopeKey: string;
  actorId: string | null;
  before: number;
  after: number;
  requestedDelta: number;
  effectiveRequestedDelta: number;
  effectIds: string[];
  reason: string;
  ruleId: string;
  input: PersistedMessageV3Input;
  recordId: string;
}): DataChangeRecord {
  return {
    id: input.recordId,
    scope: input.field.scope,
    scopeKey: input.scopeKey,
    fieldId: input.field.id,
    fieldName: input.field.name,
    actorId: input.actorId,
    actorName: v3ActorName(input.input, input.actorId),
    chatId: input.input.context.chatId,
    groupId: input.input.context.groupId,
    before: input.before,
    after: input.after,
    requestedDelta: input.requestedDelta,
    effectiveRequestedDelta: input.effectiveRequestedDelta,
    delta: input.after - input.before,
    stageBefore: deriveStage(input.field, input.before).id,
    stageAfter: deriveStage(input.field, input.after).id,
    reason: input.reason,
    source: "rule",
    ruleIds: [input.ruleId],
    effectIds: input.effectIds,
    confidence: null,
    messageId: input.input.messageId,
    variantId: input.input.variantId,
    occurredAt: input.input.occurredAt,
  };
}

function v3ActorName(input: PersistedMessageV3Input, actorId: string | null): string {
  if (actorId === null) return input.context.actorName;
  if (actorId === input.context.actorId) return input.context.actorName;
  return input.actorNamesById?.[actorId] ?? actorId;
}

function flattenV3StateValues(dataset: MvuDatasetV3): Record<string, number> {
  const values: Record<string, number> = {};
  for (const [key, state] of Object.entries(dataset.stateValues)) {
    for (const [fieldId, value] of Object.entries(state)) values[`${key}\u0000${fieldId}`] = value;
  }
  return values;
}

function takeActivationTarget(
  targets: readonly MvuDatasetV3["activeEffects"][number]["resolvedTargets"][number][],
  fieldId: string,
  actorId: string | null,
  useCount: Map<string, number>,
): MvuDatasetV3["activeEffects"][number]["resolvedTargets"][number] | undefined {
  const key = `${fieldId}\u0000${actorId ?? ""}`;
  const matching = targets.filter((target) => target.fieldId === fieldId && target.actorId === actorId);
  const index = useCount.get(key) ?? 0;
  useCount.set(key, index + 1);
  return matching[index];
}

function v3RecordId(messageKey: string, sequence: number): string {
  return `record_v3_${encodeURIComponent(messageKey)}_${sequence}`;
}

function v3EffectInstanceId(messageKey: string, ruleId: string, actionIndex: number): string {
  return `active_v3_${stableV3IdPart(messageKey)}_${stableV3IdPart(ruleId)}_${actionIndex}`;
}

function stableV3IdPart(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${value.replace(/[^A-Za-z0-9_]/g, "_")}_${(hash >>> 0).toString(16)}`;
}

function requireField(dataset: MvuDataset, fieldId: string): DataField {
  const field = dataset.fields.find((candidate) => candidate.id === fieldId);
  if (field === undefined) throw new Error(`MVU_FIELD_NOT_FOUND:${fieldId}`);
  return field;
}

function remapFieldRange(
  dataset: MvuDataset,
  field: DataField,
  nextMinimum: number,
  nextMaximum: number
): void {
  if (!Number.isFinite(nextMinimum) || !Number.isFinite(nextMaximum) ||
    nextMinimum >= nextMaximum) {
    throw new Error(`MVU_FIELD_RANGE_INVALID:${field.id}`);
  }

  const previousMinimum = field.minimum;
  const previousMaximum = field.maximum;
  const previousSpan = previousMaximum - previousMinimum;
  const nextSpan = nextMaximum - nextMinimum;
  const scale = nextSpan / previousSpan;
  if (!Number.isFinite(previousSpan) || previousSpan <= 0 ||
    !Number.isFinite(nextSpan) || nextSpan <= 0 ||
    !Number.isFinite(scale) || scale <= 0) {
    throw new Error(`MVU_FIELD_RANGE_SCALE_INVALID:${field.id}`);
  }

  const mapPosition = (value: number, label: string): number => {
    let mapped: number;
    if (value === previousMinimum) mapped = nextMinimum;
    else if (value === previousMaximum) mapped = nextMaximum;
    else mapped = nextMinimum + ((value - previousMinimum) / previousSpan) * nextSpan;
    if (!Number.isFinite(mapped)) {
      throw new Error(`MVU_FIELD_RANGE_POSITION_OVERFLOW:${field.id}:${label}`);
    }
    return mapped;
  };
  const mapDelta = (value: number, label: string): number => {
    const mapped = value * scale;
    if (!Number.isFinite(mapped)) {
      throw new Error(`MVU_FIELD_RANGE_DELTA_OVERFLOW:${field.id}:${label}`);
    }
    return mapped;
  };

  field.minimum = nextMinimum;
  field.maximum = nextMaximum;
  field.initialValue = mapPosition(field.initialValue, "initial");
  field.step = mapDelta(field.step, "step");
  field.ai.maxDelta = mapDelta(field.ai.maxDelta, "ai_max_delta");
  field.naturalChange.amount = mapDelta(field.naturalChange.amount, "natural_amount");
  field.perTurnChange.amount = mapDelta(field.perTurnChange.amount, "per_turn_amount");
  for (const stage of field.stages) {
    stage.threshold = mapPosition(stage.threshold, `stage_${stage.id}`);
  }

  for (const [scope, values] of Object.entries(dataset.stateValues)) {
    const value = values[field.id];
    if (value !== undefined) values[field.id] = mapPosition(value, `state_${scope}`);
  }
  for (const record of dataset.records) {
    if (record.fieldId !== field.id) continue;
    record.before = mapPosition(record.before, `record_${record.id}_before`);
    record.after = mapPosition(record.after, `record_${record.id}_after`);
    record.requestedDelta = mapDelta(record.requestedDelta, `record_${record.id}_requested`);
    record.effectiveRequestedDelta = mapDelta(
      record.effectiveRequestedDelta,
      `record_${record.id}_effective`
    );
    record.delta = mapDelta(record.delta, `record_${record.id}_delta`);
  }

  for (const rule of dataset.rules) {
    if (rule.sourceFieldId === field.id) {
      rule.sourceThreshold = mapPosition(rule.sourceThreshold, `link_${rule.id}_threshold`);
    }
    if (rule.targetFieldId === field.id && rule.effect.kind === "delta") {
      rule.effect.value = mapDelta(rule.effect.value, `link_${rule.id}_delta`);
    }
  }
  for (const rule of dataset.autoRules) {
    if (rule.condition.kind === "stateThreshold" && rule.condition.fieldId === field.id) {
      rule.condition.threshold = mapPosition(
        rule.condition.threshold,
        `auto_${rule.id}_threshold`
      );
    }
    for (const effect of rule.effects) {
      if (effect.fieldId === field.id) {
        effect.delta = mapDelta(effect.delta, `auto_${rule.id}_delta`);
      }
    }
  }
  for (const effect of dataset.temporaryEffects) {
    if (effect.targets.some((target) => target.fieldId === field.id) && effect.mode === "additive") {
      effect.value = mapDelta(effect.value, `temporary_${effect.id}_delta`);
    }
  }
}

function requireApplicableField(
  dataset: MvuDataset,
  context: StateScopeContext,
  fieldId: string
): DataField {
  const field = requireField(dataset, fieldId);
  if (!fieldAppliesToContext(field, context)) throw new Error(`MVU_FIELD_NOT_BOUND:${fieldId}`);
  return field;
}

function removeFieldFromRuntimeMaps(dataset: MvuDataset, fieldId: string): void {
  for (const state of Object.values(dataset.stateValues)) delete state[fieldId];
  for (const settled of Object.values(dataset.lastSettled)) delete settled[fieldId];
  for (const counters of Object.values(dataset.turnCounters)) delete counters[fieldId];
}

function cleanRuntimeForConfiguration(dataset: MvuDataset): void {
  const fieldsById = new Map(dataset.fields.map((field) => [field.id, field]));
  for (const state of Object.values(dataset.stateValues)) {
    for (const fieldId of Object.keys(state)) {
      if (!fieldsById.has(fieldId)) delete state[fieldId];
    }
  }
  for (const settled of Object.values(dataset.lastSettled)) {
    for (const fieldId of Object.keys(settled)) {
      if (!fieldsById.has(fieldId)) delete settled[fieldId];
    }
  }
  for (const counters of Object.values(dataset.turnCounters)) {
    for (const fieldId of Object.keys(counters)) {
      if (!fieldsById.has(fieldId)) delete counters[fieldId];
    }
  }
  for (const [key, state] of Object.entries(dataset.stateValues)) {
    for (const [fieldId, value] of Object.entries(state)) {
      const field = fieldsById.get(fieldId);
      if (field === undefined || !runtimeKeyAppliesToField(key, field) ||
        value < field.minimum || value > field.maximum) {
        delete state[fieldId];
      }
    }
  }
  for (const [key, settled] of Object.entries(dataset.lastSettled)) {
    for (const fieldId of Object.keys(settled)) {
      const field = fieldsById.get(fieldId);
      if (field === undefined || !runtimeKeyAppliesToField(key, field)) delete settled[fieldId];
    }
  }
  for (const [key, counters] of Object.entries(dataset.turnCounters)) {
    for (const fieldId of Object.keys(counters)) {
      const field = fieldsById.get(fieldId);
      if (field === undefined || !runtimeKeyAppliesToField(key, field)) delete counters[fieldId];
    }
  }
  const ruleIds = new Set(dataset.autoRules.map((rule) => rule.id));
  for (const triggers of Object.values(dataset.ruleLastTriggered)) {
    for (const ruleId of Object.keys(triggers)) if (!ruleIds.has(ruleId)) delete triggers[ruleId];
  }
  dataset.temporaryEffects = dataset.temporaryEffects
    .map((effect) => ({
      ...effect,
      targets: effect.targets.filter((target) => fieldsById.has(target.fieldId)),
    }))
    .filter((effect) => effect.targets.length > 0);
}

function runtimeKeyAppliesToField(key: string, field: DataField): boolean {
  if (field.scope === "global") return key === "global";
  const prefix = `${field.scope}:`;
  if (!key.startsWith(prefix)) return false;
  return field.bindingIds.includes(key.slice(prefix.length));
}

function temporaryEffectTargetAppliesToField(
  target: DataTemporaryEffectTarget,
  field: DataField
): boolean {
  if (target.fieldId !== field.id || target.scope !== field.scope) return false;
  if (field.scope === "global") return target.scopeKey === "global";
  const prefix = `${field.scope}:`;
  return target.scopeKey.startsWith(prefix) &&
    field.bindingIds.includes(target.scopeKey.slice(prefix.length));
}

function reconcileTemporaryEffectsForField(
  effects: readonly DataTemporaryEffect[],
  field: DataField
): DataTemporaryEffect[] {
  return effects
    .map((effect) => ({
      ...effect,
      targets: effect.targets.filter((target) =>
        target.fieldId !== field.id || temporaryEffectTargetAppliesToField(target, field)
      ),
    }))
    .filter((effect) => effect.targets.length > 0);
}

function removeFieldFromTemporaryEffects(
  effects: readonly DataTemporaryEffect[],
  fieldId: string
): DataTemporaryEffect[] {
  return effects
    .map((effect) => ({
      ...effect,
      targets: effect.targets.filter((target) => target.fieldId !== fieldId),
    }))
    .filter((effect) => effect.targets.length > 0);
}

function reconcileAutoRuleEffectImports(dataset: MvuDataset): void {
  const effectsById = new Map(dataset.temporaryEffects.map((effect) => [effect.id, effect]));
  for (const rule of dataset.autoRules) {
    for (const result of rule.effects) {
      result.temporaryEffectIds = result.temporaryEffectIds.filter((effectId) =>
        effectsById.get(effectId)?.targets.some((target) => target.fieldId === result.fieldId) === true
      );
    }
  }
}

function counterValue(counter: TurnCounter, field: DataField): number {
  switch (field.perTurnChange.countMode) {
    case "user":
      return counter.userMessages;
    case "character":
      return counter.characterMessages;
    case "both":
      return Math.min(counter.userMessages, counter.characterMessages);
  }
}

function collectPerTurnDeltas(
  dataset: MvuDataset,
  input: PersistedMessageInput
): Map<string, PendingFieldChange> {
  const pending = new Map<string, PendingFieldChange>();
  for (const field of dataset.fields) {
    if (!fieldAppliesToContext(field, input.context) || !field.perTurnChange.enabled) continue;
    const key = scopeKey(field.scope, input.context);
    dataset.turnCounters[key] = dataset.turnCounters[key] ?? {};
    const counter = dataset.turnCounters[key][field.id] ?? {
      userMessages: 0,
      characterMessages: 0,
    };
    const before = counterValue(counter, field);
    if (input.role === "user") counter.userMessages += 1;
    else counter.characterMessages += 1;
    dataset.turnCounters[key][field.id] = counter;
    const after = counterValue(counter, field);
    const units = Math.floor(after / field.perTurnChange.intervalTurns) -
      Math.floor(before / field.perTurnChange.intervalTurns);
    if (units > 0) addPendingDelta(
      pending,
      field.id,
      units * field.perTurnChange.amount,
      true,
      null,
      [],
      null,
      null
    );
  }
  return pending;
}

function addPendingDelta(
  pending: Map<string, PendingFieldChange>,
  fieldId: string,
  delta: number,
  perTurn: boolean,
  autoRuleId: string | null,
  temporaryEffectIds: readonly string[],
  autoRuleReason: string | null,
  autoRuleConfidence: number | null
): void {
  if (!Number.isFinite(delta)) throw new Error(`MVU_PENDING_DELTA_INVALID:${fieldId}`);
  const current = pending.get(fieldId) ?? {
    delta: 0,
    perTurn: false,
    autoRuleIds: [],
    autoRuleReasons: [],
    temporaryEffectIds: [],
    aiReason: null,
    aiConfidence: null,
  };
  current.delta += delta;
  current.perTurn = current.perTurn || perTurn;
  if (autoRuleId !== null && !current.autoRuleIds.includes(autoRuleId)) {
    current.autoRuleIds.push(autoRuleId);
  }
  for (const effectId of temporaryEffectIds) {
    if (!current.temporaryEffectIds.includes(effectId)) current.temporaryEffectIds.push(effectId);
  }
  if (autoRuleReason !== null && !current.autoRuleReasons.includes(autoRuleReason)) {
    current.autoRuleReasons.push(autoRuleReason);
  }
  if (autoRuleConfidence !== null) {
    current.aiConfidence = current.aiConfidence === null
      ? autoRuleConfidence
      : Math.max(current.aiConfidence, autoRuleConfidence);
  }
  if (!Number.isFinite(current.delta)) throw new Error(`MVU_PENDING_DELTA_OVERFLOW:${fieldId}`);
  pending.set(fieldId, current);
}

function collectAiDeltas(
  dataset: MvuDataset,
  context: StateScopeContext,
  changes: readonly PersistedAiChange[],
  pending: Map<string, PendingFieldChange>
): void {
  for (const change of changes) {
    const field = requireApplicableField(dataset, context, change.fieldId);
    const current = pending.get(field.id) ?? {
      delta: 0,
      perTurn: false,
      autoRuleIds: [],
      autoRuleReasons: [],
      temporaryEffectIds: [],
      aiReason: null,
      aiConfidence: null,
    };
    current.delta += change.delta;
    if (!Number.isFinite(current.delta)) throw new Error(`MVU_PENDING_DELTA_OVERFLOW:${field.id}`);
    current.aiReason = change.reason;
    current.aiConfidence = change.confidence;
    pending.set(field.id, current);
  }
}

function validateAiChangesForDataset(
  dataset: MvuDataset,
  context: StateScopeContext,
  changes: readonly PersistedAiChange[]
): void {
  if (changes.length === 0) return;
  if (!dataset.settings.aiEnabled) throw new Error("MVU_AI_DISABLED");
  const seenFields = new Set<string>();
  for (const change of changes) {
    if (seenFields.has(change.fieldId)) {
      throw new Error(`MVU_AI_CHANGE_DUPLICATE_FIELD:${change.fieldId}`);
    }
    seenFields.add(change.fieldId);
    const field = requireApplicableField(dataset, context, change.fieldId);
    if (!field.ai.enabled) throw new Error(`MVU_FIELD_AI_DISABLED:${field.id}`);
    if (change.confidence < field.ai.minConfidence) {
      throw new Error(`MVU_AI_CONFIDENCE_TOO_LOW:${field.id}`);
    }
    if (Math.abs(change.delta) > field.ai.maxDelta) {
      throw new Error(`MVU_AI_DELTA_EXCEEDED:${field.id}`);
    }
  }
}

function validateAiRuleJudgementsForDataset(
  dataset: MvuDataset,
  judgements: readonly AiRuleJudgement[]
): void {
  const seenRuleIds = new Set<string>();
  for (const judgement of judgements) {
    if (seenRuleIds.has(judgement.ruleId)) {
      throw new Error(`MVU_AI_RULE_JUDGEMENT_DUPLICATE:${judgement.ruleId}`);
    }
    seenRuleIds.add(judgement.ruleId);
    const rule = dataset.autoRules.find((candidate) => candidate.id === judgement.ruleId);
    if (rule === undefined || rule.condition.kind !== "aiJudgement") {
      throw new Error(`MVU_AI_RULE_JUDGEMENT_NOT_ALLOWED:${judgement.ruleId}`);
    }
  }
}

function stateValuesForContext(
  dataset: MvuDataset,
  context: StateScopeContext
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const field of dataset.fields) {
    if (fieldAppliesToContext(field, context)) {
      values[field.id] = stateValueForField(dataset, field, context);
    }
  }
  return values;
}

function applicableAutoRules(dataset: MvuDataset, context: StateScopeContext): DataAutoRule[] {
  return dataset.autoRules.filter((rule) => {
    const effectsApply = rule.effects.every((effect) => {
      const field = dataset.fields.find((candidate) => candidate.id === effect.fieldId);
      return field !== undefined && fieldAppliesToContext(field, context);
    });
    if (!effectsApply) return false;
    const condition = rule.condition;
    if (condition.kind !== "stateThreshold") return true;
    const field = dataset.fields.find((candidate) => candidate.id === condition.fieldId);
    return field !== undefined && fieldAppliesToContext(field, context);
  });
}

function applicableLinkRules(dataset: MvuDataset, context: StateScopeContext): DataLinkRule[] {
  return dataset.rules.filter((rule) => {
    const source = dataset.fields.find((field) => field.id === rule.sourceFieldId);
    const target = dataset.fields.find((field) => field.id === rule.targetFieldId);
    return source !== undefined && target !== undefined &&
      fieldAppliesToContext(source, context) && fieldAppliesToContext(target, context);
  });
}

function automationFacts(
  input: PersistedMessageInput,
  stateValues: Readonly<Record<string, number>>,
  aiRuleJudgements: readonly AiRuleJudgement[]
): AutomationMessageFacts {
  return {
    occurredAt: input.occurredAt,
    stateValues,
    recentPositiveCount: input.signals.recentPositiveCount === null
      ? undefined
      : input.signals.recentPositiveCount,
    userCareDetected: input.signals.userCareDetected === null
      ? undefined
      : input.signals.userCareDetected,
    lastInteractionAt: input.signals.lastInteractionAt === null
      ? undefined
      : input.signals.lastInteractionAt,
    messageCountInLast24Hours: input.signals.messageCountInLast24Hours === null
      ? undefined
      : input.signals.messageCountInLast24Hours,
    specialDayDetected: input.signals.specialDayDetected === null
      ? undefined
      : input.signals.specialDayDetected,
    aiRuleJudgements: Object.fromEntries(aiRuleJudgements.map((judgement) => [
      judgement.ruleId,
      judgement,
    ])),
  };
}

function messageFact(input: PersistedMessageInput): MessageFact {
  return {
    messageId: input.messageId,
    variantId: input.variantId,
    content: input.content.slice(0, 2_000),
    chatId: input.context.chatId,
    actorId: input.context.actorId,
    groupId: input.context.groupId,
    role: input.role,
    occurredAt: input.occurredAt,
    ...input.signals,
  };
}

function validatePersistedMessageInput(input: PersistedMessageInput): void {
  if (typeof input.messageId !== "string" || input.messageId.length === 0) {
    throw new Error("MVU_MESSAGE_ID_EMPTY");
  }
  if (input.variantId !== null &&
    (typeof input.variantId !== "string" || input.variantId.length === 0)) {
    throw new Error("MVU_MESSAGE_VARIANT_INVALID");
  }
  if (typeof input.content !== "string") throw new Error("MVU_MESSAGE_CONTENT_INVALID");
  if (!Number.isFinite(input.occurredAt)) throw new Error("MVU_MESSAGE_TIME_INVALID");
  validateScopeContext(input.context);
  validateAiChangeList(input.aiChanges);
  validateAiRuleJudgementList(input.aiRuleJudgements);
  const numericSignals = [
    input.signals.recentPositiveCount,
    input.signals.lastInteractionAt,
    input.signals.messageCountInLast24Hours,
  ];
  if (numericSignals.some((value) => value !== null && !Number.isFinite(value))) {
    throw new Error("MVU_MESSAGE_SIGNALS_INVALID");
  }
  if ((input.signals.userCareDetected !== null &&
    typeof input.signals.userCareDetected !== "boolean") ||
    (input.signals.specialDayDetected !== null &&
    typeof input.signals.specialDayDetected !== "boolean")) {
    throw new Error("MVU_MESSAGE_SIGNALS_INVALID");
  }
}

function validateAiJudgementInput(input: ApplyAiJudgementInput): void {
  if (!Number.isFinite(input.occurredAt)) throw new Error("MVU_AI_JUDGEMENT_TIME_INVALID");
  validateScopeContext(input.context);
  validateAiChangeList(input.changes);
}

function validateAiChangeList(changes: readonly PersistedAiChange[]): void {
  if (!Array.isArray(changes)) throw new Error("MVU_AI_CHANGES_INVALID");
  for (const change of changes) {
    if (typeof change.fieldId !== "string" || typeof change.reason !== "string" ||
      change.fieldId.length === 0 || change.reason.trim().length === 0 ||
      !Number.isFinite(change.delta) || !Number.isFinite(change.confidence) ||
      change.confidence < 0 || change.confidence > 1) {
      throw new Error("MVU_AI_CHANGE_INVALID");
    }
  }
}

function validateAiRuleJudgementList(judgements: readonly AiRuleJudgement[]): void {
  if (!Array.isArray(judgements)) throw new Error("MVU_AI_RULE_JUDGEMENTS_INVALID");
  for (const judgement of judgements) {
    if (typeof judgement.ruleId !== "string" || judgement.ruleId.length === 0 ||
      typeof judgement.matched !== "boolean" ||
      !Number.isFinite(judgement.confidence) || judgement.confidence < 0 ||
      judgement.confidence > 1 || typeof judgement.reason !== "string" ||
      judgement.reason.trim().length === 0) {
      throw new Error("MVU_AI_RULE_JUDGEMENT_INVALID");
    }
  }
}

function validateScopeContext(context: StateScopeContext): void {
  if (typeof context.actorName !== "string") throw new Error("MVU_CONTEXT_ACTOR_NAME_INVALID");
  const identities = [context.chatId, context.actorId, context.groupId];
  if (identities.some((identity) => identity !== null &&
    (typeof identity !== "string" || identity.length === 0))) {
    throw new Error("MVU_CONTEXT_ID_INVALID");
  }
}

/**
 * A message id is only stable inside one chat and one persisted variant. Tagged
 * components make the null/original variant distinct from every real host id.
 */
function processedMessageKey(input: PersistedMessageIdentity): string {
  const chat = input.context.chatId === null
    ? "null"
    : `value:${encodeURIComponent(input.context.chatId)}`;
  const variant = input.variantId === null
    ? "original:null"
    : `value:${encodeURIComponent(input.variantId)}`;
  return `chat:${chat}|message:value:${encodeURIComponent(input.messageId)}|variant:${variant}`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function expireTemporaryEffects(dataset: MvuDataset, occurredAt: number): void {
  for (const effect of dataset.temporaryEffects) {
    if (effect.enabled && effect.expiresAt !== null && effect.expiresAt <= occurredAt) {
      effect.enabled = false;
    }
  }
}

function effectMatchesContext(effect: DataTemporaryEffect, context: StateScopeContext): boolean {
  return effect.targets.some((target) => temporaryEffectTargetMatchesContext(target, context));
}

function consumeTemporaryEffectTurns(dataset: MvuDataset, context: StateScopeContext): void {
  for (const effect of dataset.temporaryEffects) {
    if (!effect.enabled || effect.remainingTurns === null || !effectMatchesContext(effect, context)) continue;
    effect.remainingTurns -= 1;
    if (effect.remainingTurns === 0) effect.enabled = false;
  }
}

export type { DataActor };
