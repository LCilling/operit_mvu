/** Strict adapter for Operit's one-shot system-model completion API. */
import type {
  AiRuleJudgement,
  DataAutoRule,
  MessageFact,
  StateScopeContext,
} from "./model";
import type {
  FieldStateProjection,
  PersistedAiChange,
} from "./service";
import type { AiSemanticPredicate } from "./model-v3";
import { MODEL_FIELD_LIMIT } from "./state-prompt";

const MODEL_PROMPT_MAX_BYTES = 65_536;
const MODEL_MESSAGE_CONTENT_MAX_LENGTH = 4_096;
const MODEL_FACT_CONTENT_MAX_LENGTH = 512;
const MODEL_ID_MAX_LENGTH = 256;
const MODEL_NAME_MAX_LENGTH = 128;
const MODEL_FIELD_NAME_MAX_LENGTH = 32;
const MODEL_FIELD_DESCRIPTION_MAX_LENGTH = 48;
const MODEL_STAGE_NAME_MAX_LENGTH = 32;
const MODEL_STAGE_DESCRIPTION_MAX_LENGTH = 48;
const MODEL_FIELD_INSTRUCTION_MAX_LENGTH = 64;
const MODEL_RULE_NAME_MAX_LENGTH = 32;
const MODEL_TRIGGER_TYPE_MAX_LENGTH = 64;
const MODEL_REQUIREMENT_MAX_LENGTH = 128;
const MODEL_RULE_LIMIT = 20;
const MODEL_CONDITION_LIMIT = 40;

export interface BackgroundModelProbeResult {
  available: boolean;
  provider?: string;
  model?: string;
  reason?: string;
}

export interface StateJudgementRequest {
  context: StateScopeContext;
  fields: readonly FieldStateProjection[];
  recentFacts: readonly MessageFact[];
  /** Structured v3 callers preserve sender identity; strings remain accepted for v2 compatibility. */
  message: string | RoleAwareConditionMessage;
}

export interface StateJudgementResult {
  available: boolean;
  changes: PersistedAiChange[];
  raw: string;
}

export interface RuleJudgementRequest {
  context: StateScopeContext;
  rules: readonly DataAutoRule[];
  fields: readonly FieldStateProjection[];
  recentFacts: readonly MessageFact[];
  /** Structured v3 callers preserve sender identity; strings remain accepted for v2 compatibility. */
  message: string | RoleAwareConditionMessage;
}

export interface RuleJudgementResult {
  available: boolean;
  judgements: AiRuleJudgement[];
  raw: string;
  diagnostics: string[];
}

export interface RoleAwareConditionMessage {
  role: MessageFact["role"];
  actorId: string | null;
  actorName: string;
  content: string;
}

export interface ConditionJudgementRequest {
  /** Trusted production scope; omitted only by the v2 compatibility API. */
  context?: StateScopeContext;
  predicates: readonly AiSemanticPredicate[];
  message: RoleAwareConditionMessage;
}

export interface ConditionJudgement {
  predicateId: string;
  matched: boolean;
  confidence: number;
}

export interface ConditionJudgementResult {
  available: boolean;
  judgements: ConditionJudgement[];
  raw: string;
}

export interface SystemModelApi {
  probe(): Promise<BackgroundModelProbeResult>;
  judgeState(request: StateJudgementRequest): Promise<StateJudgementResult>;
  judgeRules(request: RuleJudgementRequest): Promise<RuleJudgementResult>;
  judgeConditions(request: ConditionJudgementRequest): Promise<ConditionJudgementResult>;
}

type SystemModelHostApi = Pick<ToolPkg.SystemModelApi, "probe" | "complete">;

interface StrictJudgementDocument {
  changes: PersistedAiChange[];
}

interface StrictRuleJudgementDocument {
  matches: AiRuleJudgement[];
}

interface StrictConditionJudgementDocument {
  judgements: ConditionJudgement[];
}

const STATE_JUDGEMENT_JSON_SCHEMA: ToolPkg.SystemModelJsonSchema = {
  name: "mvu_state_judgement",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["changes"],
    properties: {
      changes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fieldId", "delta", "reason", "confidence"],
          properties: {
            fieldId: { type: "string" },
            delta: { type: "number" },
            reason: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
    },
  },
};

const RULE_JUDGEMENT_JSON_SCHEMA: ToolPkg.SystemModelJsonSchema = {
  name: "mvu_rule_judgement",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["matches"],
    properties: {
      matches: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ruleId", "matched", "confidence", "reason"],
          properties: {
            ruleId: { type: "string" },
            matched: { type: "boolean" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            reason: { type: "string" },
          },
        },
      },
    },
  },
};

const CONDITION_JUDGEMENT_JSON_SCHEMA: ToolPkg.SystemModelJsonSchema = {
  name: "mvu_condition_judgement",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["judgements"],
    properties: {
      judgements: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["predicateId", "matched", "confidence"],
          properties: {
            predicateId: { type: "string" },
            matched: { type: "boolean" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
    },
  },
};

/**
 * Uses only the host's isolated completion path. Model text is accepted only
 * when the entire response is the documented JSON object; prose, code fences,
 * command syntax, and partially recoverable output are rejected.
 */
export class HostSystemModelApi implements SystemModelApi {
  constructor(private readonly host: SystemModelHostApi) {}

  async probe(): Promise<BackgroundModelProbeResult> {
    try {
      return await this.host.probe();
    } catch (error) {
      console.error("MVU system model probe failed", error);
      throw error;
    }
  }

  async judgeState(request: StateJudgementRequest): Promise<StateJudgementResult> {
    const message = normalizeCurrentMessage(request.context, request.message);
    if (message.content.length === 0) throw new Error("MVU_AI_MESSAGE_EMPTY");
    const eligibleFields = request.fields.filter((projection) =>
      projection.bound &&
      projection.currentValue !== null &&
      projection.currentStage !== null &&
      projection.definition.enabled &&
      projection.definition.ai.enabled
    ).slice(0, MODEL_FIELD_LIMIT);
    if (eligibleFields.length === 0) throw new Error("MVU_AI_NO_ELIGIBLE_FIELDS");

    const capability = await this.probe();
    if (!capability.available) {
      return { available: false, changes: [], raw: "" };
    }

    try {
      const systemPrompt = buildJudgementSystemPrompt(request.context, eligibleFields);
      const userPrompt = buildJudgementUserPrompt(request.recentFacts, message);
      requireBoundedPrompts(systemPrompt, userPrompt);
      const completion = await this.host.complete({
        systemPrompt,
        userPrompt,
        // Reasoning-capable local models can expose private reasoning separately while the
        // provider constrains the public content to this schema. Without this request, some
        // models prepend <think> text and correctly fail the strict whole-response parser.
        jsonSchema: STATE_JUDGEMENT_JSON_SCHEMA,
      });
      const document = parseStrictJudgement(completion.text);
      assertJudgementTargets(document.changes, eligibleFields);
      return {
        available: true,
        changes: document.changes,
        raw: completion.text,
      };
    } catch (error) {
      console.error("MVU system model judgement failed", error);
      throw error;
    }
  }

  async judgeRules(request: RuleJudgementRequest): Promise<RuleJudgementResult> {
    const message = normalizeCurrentMessage(request.context, request.message);
    if (message.content.length === 0) throw new Error("MVU_AI_RULE_MESSAGE_EMPTY");
    const eligibleRules = request.rules.filter((rule) =>
      rule.enabled && rule.condition.kind === "aiJudgement"
    );
    if (eligibleRules.length === 0) throw new Error("MVU_AI_RULES_EMPTY");
    const rules = [...eligibleRules]
      .sort((left, right) => {
        const orderDifference = left.order - right.order;
        if (orderDifference !== 0) return orderDifference;
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
      })
      .slice(0, MODEL_RULE_LIMIT);
    const diagnostics = eligibleRules.length > MODEL_RULE_LIMIT
      ? [`MVU_AI_RULES_OVERFLOW:${eligibleRules.length}:${rules.length}`]
      : [];

    const capability = await this.probe();
    if (!capability.available) return { available: false, judgements: [], raw: "", diagnostics };

    try {
      const systemPrompt = buildRuleJudgementSystemPrompt(
        request.context,
        rules,
        request.fields.slice(0, MODEL_FIELD_LIMIT),
      );
      const userPrompt = buildJudgementUserPrompt(request.recentFacts, message);
      requireBoundedPrompts(systemPrompt, userPrompt);
      const completion = await this.host.complete({
        systemPrompt,
        userPrompt,
        jsonSchema: RULE_JUDGEMENT_JSON_SCHEMA,
      });
      const document = parseStrictRuleJudgement(completion.text);
      assertRuleJudgementTargets(document.matches, rules);
      return {
        available: true,
        judgements: document.matches,
        raw: completion.text,
        diagnostics,
      };
    } catch (error) {
      console.error("MVU system model rule judgement failed", error);
      throw error;
    }
  }

  async judgeConditions(request: ConditionJudgementRequest): Promise<ConditionJudgementResult> {
    if (request.predicates.length === 0) throw new Error("MVU_AI_CONDITIONS_EMPTY");
    if (request.predicates.length > MODEL_CONDITION_LIMIT) {
      throw new Error("MVU_AI_CONDITION_LIMIT_EXCEEDED");
    }
    if (request.message.content.trim().length === 0) throw new Error("MVU_AI_CONDITION_MESSAGE_EMPTY");
    const predicateIds = request.predicates.map((predicate) => predicate.id);
    if (new Set(predicateIds).size !== predicateIds.length) {
      throw new Error("MVU_AI_CONDITION_PREDICATE_DUPLICATE");
    }
    const capability = await this.probe();
    if (!capability.available) return { available: false, judgements: [], raw: "" };

    try {
      const systemPrompt = buildConditionJudgementSystemPrompt(request.predicates, request.context);
      const userPrompt = JSON.stringify(normalizeConditionMessage(request.message, request.context));
      requireBoundedPrompts(systemPrompt, userPrompt);
      const completion = await this.host.complete({
        systemPrompt,
        userPrompt,
        jsonSchema: CONDITION_JUDGEMENT_JSON_SCHEMA,
      });
      const document = parseStrictConditionJudgement(completion.text);
      assertConditionJudgementTargets(document.judgements, request.predicates);
      return { available: true, judgements: document.judgements, raw: completion.text };
    } catch (error) {
      console.error("MVU system model condition judgement failed", error);
      throw error;
    }
  }
}

function buildConditionJudgementSystemPrompt(
  predicates: readonly AiSemanticPredicate[],
  context: StateScopeContext | undefined,
): string {
  const contract = predicates.map((predicate) => ({
    id: requireBoundedIdentifier(predicate.id),
    triggerType: boundedModelText(predicate.triggerType, MODEL_TRIGGER_TYPE_MAX_LENGTH),
    requirement: boundedModelText(predicate.requirement, MODEL_REQUIREMENT_MAX_LENGTH),
    minimumConfidence: predicate.minimumConfidence,
  }));
  return [
    "你是规则条件判断器，只根据给定的单条角色感知消息判断每个语义条件。",
    "只输出一个 JSON 对象，禁止 Markdown、代码围栏、解释或字段修改命令。",
    'JSON 必须严格符合：{"judgements":[{"predicateId":"条件ID","matched":true或false,"confidence":0到1数字}]}。',
    "每个候选条件必须恰好返回一次，不得添加、遗漏或改写 predicateId。",
    ...(context === undefined ? [] : [`上下文：${JSON.stringify(boundedScopeContext(context))}`]),
    `候选条件：${JSON.stringify(contract)}`,
  ].join("\n");
}

function buildJudgementSystemPrompt(
  context: StateScopeContext,
  fields: readonly FieldStateProjection[]
): string {
  const fieldContract = fields.map((projection) => {
    const field = projection.definition;
    const currentStage = projection.currentStage;
    if (projection.currentValue === null || currentStage === null) {
      throw new Error(`MVU_AI_FIELD_PROJECTION_INCOMPLETE:${field.id}`);
    }
    return {
      fieldId: requireBoundedIdentifier(field.id),
      name: boundedModelText(field.name, MODEL_FIELD_NAME_MAX_LENGTH),
      description: boundedModelText(field.description, MODEL_FIELD_DESCRIPTION_MAX_LENGTH),
      currentStage: boundedModelText(currentStage.name, MODEL_STAGE_NAME_MAX_LENGTH),
      currentStageDescription: boundedModelText(
        currentStage.description,
        MODEL_STAGE_DESCRIPTION_MAX_LENGTH,
      ),
      ...(field.modelVisibility === "stage_only" ? {} : {
        currentValue: projection.currentValue,
        minimum: field.minimum,
        maximum: field.maximum,
      }),
      maxAbsoluteDelta: field.ai.maxDelta,
      minimumConfidence: field.ai.minConfidence,
      fieldInstruction: boundedModelText(field.ai.prompt, MODEL_FIELD_INSTRUCTION_MAX_LENGTH),
    };
  });
  return [
    "你是动态状态判断器，只根据给定消息事实评估字段数值变化。",
    "只输出一个 JSON 对象，禁止 Markdown、代码围栏、解释或命令文本。",
    'JSON 必须严格符合：{"changes":[{"fieldId":"字段ID","delta":数字,"reason":"简短事实理由","confidence":0到1数字}]}。',
    "没有可靠变化时输出 {\"changes\":[]}。每个字段最多出现一次，不得输出未列出的字段。",
    `上下文：${JSON.stringify(boundedScopeContext(context))}`,
    `可判断字段：${JSON.stringify(fieldContract)}`,
  ].join("\n");
}

function buildJudgementUserPrompt(
  recentFacts: readonly MessageFact[],
  message: NormalizedModelMessage,
): string {
  const facts = recentFacts.slice(-20).map((fact) => ({
    role: fact.role,
    actorId: boundedModelText(fact.actorId ?? "", MODEL_ID_MAX_LENGTH) || null,
    chatId: boundedModelText(fact.chatId ?? "", MODEL_ID_MAX_LENGTH) || null,
    groupId: boundedModelText(fact.groupId ?? "", MODEL_ID_MAX_LENGTH) || null,
    content: boundedModelText(fact.content, MODEL_FACT_CONTENT_MAX_LENGTH),
    occurredAt: fact.occurredAt,
  }));
  return [
    `最近已持久化消息：${JSON.stringify(facts)}`,
    `本次消息：${JSON.stringify(message)}`,
  ].join("\n");
}

function buildRuleJudgementSystemPrompt(
  context: StateScopeContext,
  rules: readonly DataAutoRule[],
  fields: readonly FieldStateProjection[]
): string {
  const fieldStates = fields
    .filter((projection) => projection.bound && projection.currentValue !== null)
    .map((projection) => ({
      fieldId: requireBoundedIdentifier(projection.definition.id),
      name: boundedModelText(projection.definition.name, MODEL_FIELD_NAME_MAX_LENGTH),
      stage: projection.currentStage === null
        ? null
        : boundedModelText(projection.currentStage.name, MODEL_STAGE_NAME_MAX_LENGTH),
      ...(projection.definition.modelVisibility === "stage_only"
        ? {}
        : { value: projection.currentValue }),
    }));
  const ruleContract = rules.map((rule) => {
    if (rule.condition.kind !== "aiJudgement") {
      throw new Error(`MVU_AI_RULE_CONDITION_INVALID:${rule.id}`);
    }
    return {
      ruleId: requireBoundedIdentifier(rule.id),
      name: boundedModelText(rule.name, MODEL_RULE_NAME_MAX_LENGTH),
      triggerType: boundedModelText(rule.condition.triggerType, MODEL_TRIGGER_TYPE_MAX_LENGTH),
      requirement: boundedModelText(rule.condition.requirement, MODEL_REQUIREMENT_MAX_LENGTH),
      minimumConfidence: rule.condition.minimumConfidence,
    };
  });
  return [
    "你是自动规则触发判断器，只判断给定规则是否满足，不修改任何字段。",
    "触发类型只是判断类别，触发要求是必须满足的事实；不得自行放宽要求。",
    "只输出一个 JSON 对象，禁止 Markdown、代码围栏、解释或字段修改命令。",
    'JSON 必须严格符合：{"matches":[{"ruleId":"规则ID","matched":true或false,"confidence":0到1数字,"reason":"简短事实理由"}]}。',
    "每个候选规则必须恰好返回一次；未满足时 matched 为 false。不得输出未列出的规则。",
    `上下文：${JSON.stringify(boundedScopeContext(context))}`,
    `当前状态：${JSON.stringify(fieldStates)}`,
    `候选规则：${JSON.stringify(ruleContract)}`,
  ].join("\n");
}

interface NormalizedModelMessage {
  role: MessageFact["role"] | "unknown";
  actorId: string | null;
  actorName: string;
  chatId: string | null;
  groupId: string | null;
  content: string;
}

function normalizeCurrentMessage(
  context: StateScopeContext,
  message: string | RoleAwareConditionMessage,
): NormalizedModelMessage {
  const structured = typeof message === "string" ? null : message;
  return {
    role: structured?.role ?? "unknown",
    actorId: boundedNullableText(context.actorId, MODEL_ID_MAX_LENGTH),
    actorName: boundedModelText(context.actorName, MODEL_NAME_MAX_LENGTH),
    chatId: boundedNullableText(context.chatId, MODEL_ID_MAX_LENGTH),
    groupId: boundedNullableText(context.groupId, MODEL_ID_MAX_LENGTH),
    content: boundedModelText(
      typeof message === "string" ? message : message.content,
      MODEL_MESSAGE_CONTENT_MAX_LENGTH,
    ).trim(),
  };
}

function normalizeConditionMessage(
  message: RoleAwareConditionMessage,
  context: StateScopeContext | undefined,
): RoleAwareConditionMessage & { chatId?: string | null; groupId?: string | null } {
  return {
    role: message.role,
    actorId: boundedNullableText(context?.actorId ?? message.actorId, MODEL_ID_MAX_LENGTH),
    actorName: boundedModelText(context?.actorName ?? message.actorName, MODEL_NAME_MAX_LENGTH),
    ...(context === undefined ? {} : {
      chatId: boundedNullableText(context.chatId, MODEL_ID_MAX_LENGTH),
      groupId: boundedNullableText(context.groupId, MODEL_ID_MAX_LENGTH),
    }),
    content: boundedModelText(message.content, MODEL_MESSAGE_CONTENT_MAX_LENGTH).trim(),
  };
}

function boundedScopeContext(context: StateScopeContext): StateScopeContext {
  return {
    chatId: boundedNullableText(context.chatId, MODEL_ID_MAX_LENGTH),
    actorId: boundedNullableText(context.actorId, MODEL_ID_MAX_LENGTH),
    groupId: boundedNullableText(context.groupId, MODEL_ID_MAX_LENGTH),
    actorName: boundedModelText(context.actorName, MODEL_NAME_MAX_LENGTH),
  };
}

function boundedNullableText(value: string | null, maximum: number): string | null {
  if (value === null) return null;
  return boundedModelText(value, maximum) || null;
}

function boundedModelText(value: string, maximum: number): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ");
  const characters = Array.from(normalized);
  return characters.length <= maximum ? normalized : characters.slice(0, maximum).join("");
}

function requireBoundedIdentifier(value: string): string {
  if (Array.from(value).length > MODEL_ID_MAX_LENGTH) throw new Error("MVU_AI_IDENTIFIER_TOO_LONG");
  return value;
}

function requireBoundedPrompts(systemPrompt: string, userPrompt: string): void {
  const systemBytes = utf8ByteLength(systemPrompt);
  const userBytes = utf8ByteLength(userPrompt);
  if (systemBytes > MODEL_PROMPT_MAX_BYTES) {
    throw new Error("MVU_AI_SYSTEM_PROMPT_LIMIT_EXCEEDED");
  }
  if (userBytes > MODEL_PROMPT_MAX_BYTES) {
    throw new Error("MVU_AI_USER_PROMPT_LIMIT_EXCEEDED");
  }
  if (systemBytes + userBytes > MODEL_PROMPT_MAX_BYTES) {
    throw new Error("MVU_AI_TOTAL_PROMPT_LIMIT_EXCEEDED");
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) bytes += 1;
    else if (codeUnit <= 0x7ff) bytes += 2;
    else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function parseStrictJudgement(raw: string): StrictJudgementDocument {
  const text = raw.trim();
  if (text.length === 0) throw new Error("MVU_AI_RESPONSE_EMPTY");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.error("MVU system model returned invalid JSON", error);
    throw new Error("MVU_AI_RESPONSE_JSON_INVALID");
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, ["changes"]) || !Array.isArray(parsed.changes)) {
    throw new Error("MVU_AI_RESPONSE_SHAPE_INVALID");
  }
  const changes: PersistedAiChange[] = parsed.changes.map((change, index) => {
    if (!isRecord(change) ||
      !hasExactKeys(change, ["fieldId", "delta", "reason", "confidence"]) ||
      typeof change.fieldId !== "string" || change.fieldId.length === 0 ||
      typeof change.delta !== "number" || !Number.isFinite(change.delta) ||
      typeof change.reason !== "string" || change.reason.trim().length === 0 ||
      typeof change.confidence !== "number" || !Number.isFinite(change.confidence) ||
      change.confidence < 0 || change.confidence > 1) {
      throw new Error(`MVU_AI_RESPONSE_CHANGE_INVALID:${index}`);
    }
    return {
      fieldId: change.fieldId,
      delta: change.delta,
      reason: change.reason.trim(),
      confidence: change.confidence,
    };
  });
  const fieldIds = changes.map((change) => change.fieldId);
  if (new Set(fieldIds).size !== fieldIds.length) {
    throw new Error("MVU_AI_RESPONSE_DUPLICATE_FIELD");
  }
  return { changes };
}

function parseStrictRuleJudgement(raw: string): StrictRuleJudgementDocument {
  const text = raw.trim();
  if (text.length === 0) throw new Error("MVU_AI_RULE_RESPONSE_EMPTY");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.error("MVU system model returned invalid rule JSON", error);
    throw new Error("MVU_AI_RULE_RESPONSE_JSON_INVALID");
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, ["matches"]) || !Array.isArray(parsed.matches)) {
    throw new Error("MVU_AI_RULE_RESPONSE_SHAPE_INVALID");
  }
  const matches: AiRuleJudgement[] = parsed.matches.map((match, index) => {
    if (!isRecord(match) ||
      !hasExactKeys(match, ["ruleId", "matched", "confidence", "reason"]) ||
      typeof match.ruleId !== "string" || match.ruleId.length === 0 ||
      typeof match.matched !== "boolean" ||
      typeof match.confidence !== "number" || !Number.isFinite(match.confidence) ||
      match.confidence < 0 || match.confidence > 1 ||
      typeof match.reason !== "string" || match.reason.trim().length === 0) {
      throw new Error(`MVU_AI_RULE_RESPONSE_MATCH_INVALID:${index}`);
    }
    return {
      ruleId: match.ruleId,
      matched: match.matched,
      confidence: match.confidence,
      reason: match.reason.trim(),
    };
  });
  if (new Set(matches.map((match) => match.ruleId)).size !== matches.length) {
    throw new Error("MVU_AI_RULE_RESPONSE_DUPLICATE_RULE");
  }
  return { matches };
}

function parseStrictConditionJudgement(raw: string): StrictConditionJudgementDocument {
  const text = raw.trim();
  if (text.length === 0) throw new Error("MVU_AI_CONDITION_RESPONSE_EMPTY");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.error("MVU system model returned invalid condition JSON", error);
    throw new Error("MVU_AI_CONDITION_RESPONSE_JSON_INVALID");
  }
  if (!isRecord(parsed) || !hasExactKeys(parsed, ["judgements"]) || !Array.isArray(parsed.judgements)) {
    throw new Error("MVU_AI_CONDITION_RESPONSE_SHAPE_INVALID");
  }
  const judgements = parsed.judgements.map((judgement, index): ConditionJudgement => {
    if (!isRecord(judgement) ||
      !hasExactKeys(judgement, ["predicateId", "matched", "confidence"]) ||
      typeof judgement.predicateId !== "string" || judgement.predicateId.length === 0 ||
      typeof judgement.matched !== "boolean" ||
      typeof judgement.confidence !== "number" || !Number.isFinite(judgement.confidence) ||
      judgement.confidence < 0 || judgement.confidence > 1) {
      throw new Error(`MVU_AI_CONDITION_RESPONSE_JUDGEMENT_INVALID:${index}`);
    }
    return {
      predicateId: judgement.predicateId,
      matched: judgement.matched,
      confidence: judgement.confidence,
    };
  });
  if (new Set(judgements.map((judgement) => judgement.predicateId)).size !== judgements.length) {
    throw new Error("MVU_AI_CONDITION_RESPONSE_DUPLICATE_PREDICATE");
  }
  return { judgements };
}

function assertJudgementTargets(
  changes: readonly PersistedAiChange[],
  fields: readonly FieldStateProjection[]
): void {
  const fieldsById = new Map(fields.map((projection) => [projection.definition.id, projection]));
  for (const change of changes) {
    const projection = fieldsById.get(change.fieldId);
    if (projection === undefined) throw new Error(`MVU_AI_RESPONSE_FIELD_NOT_ALLOWED:${change.fieldId}`);
    const field = projection.definition;
    if (change.confidence < field.ai.minConfidence) {
      throw new Error(`MVU_AI_CONFIDENCE_TOO_LOW:${field.id}`);
    }
    if (Math.abs(change.delta) > field.ai.maxDelta) {
      throw new Error(`MVU_AI_DELTA_EXCEEDED:${field.id}`);
    }
  }
}

function assertRuleJudgementTargets(
  judgements: readonly AiRuleJudgement[],
  rules: readonly DataAutoRule[]
): void {
  const ruleIds = new Set(rules.map((rule) => rule.id));
  if (judgements.length !== rules.length) throw new Error("MVU_AI_RULE_RESPONSE_INCOMPLETE");
  for (const judgement of judgements) {
    if (!ruleIds.has(judgement.ruleId)) {
      throw new Error(`MVU_AI_RULE_RESPONSE_RULE_NOT_ALLOWED:${judgement.ruleId}`);
    }
  }
}

function assertConditionJudgementTargets(
  judgements: readonly ConditionJudgement[],
  predicates: readonly AiSemanticPredicate[],
): void {
  const predicateIds = new Set(predicates.map((predicate) => predicate.id));
  if (judgements.length !== predicates.length) throw new Error("MVU_AI_CONDITION_RESPONSE_INCOMPLETE");
  for (const judgement of judgements) {
    if (!predicateIds.has(judgement.predicateId)) {
      throw new Error(`MVU_AI_CONDITION_RESPONSE_PREDICATE_NOT_ALLOWED:${judgement.predicateId}`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index]);
}
