/** Strict adapter for Operit's one-shot system-model completion API. */
import type { MessageFact, StateScopeContext } from "./model";
import type {
  FieldStateProjection,
  PersistedAiChange,
} from "./service";

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
  message: string;
}

export interface StateJudgementResult {
  available: boolean;
  changes: PersistedAiChange[];
  raw: string;
}

export interface SystemModelApi {
  probe(): Promise<BackgroundModelProbeResult>;
  judgeState(request: StateJudgementRequest): Promise<StateJudgementResult>;
}

type SystemModelHostApi = Pick<ToolPkg.SystemModelApi, "probe" | "complete">;

interface StrictJudgementDocument {
  changes: PersistedAiChange[];
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
    const message = request.message.trim();
    if (message.length === 0) throw new Error("MVU_AI_MESSAGE_EMPTY");
    const eligibleFields = request.fields.filter((projection) =>
      projection.bound &&
      projection.currentValue !== null &&
      projection.currentStage !== null &&
      projection.definition.enabled &&
      projection.definition.ai.enabled
    );
    if (eligibleFields.length === 0) throw new Error("MVU_AI_NO_ELIGIBLE_FIELDS");

    const capability = await this.probe();
    if (!capability.available) {
      return { available: false, changes: [], raw: "" };
    }

    try {
      const completion = await this.host.complete({
        systemPrompt: buildJudgementSystemPrompt(request.context, eligibleFields),
        userPrompt: buildJudgementUserPrompt(request.recentFacts, message),
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
      fieldId: field.id,
      name: field.name,
      description: field.description,
      currentValue: projection.currentValue,
      currentStage: currentStage.name,
      minimum: field.minimum,
      maximum: field.maximum,
      maxAbsoluteDelta: field.ai.maxDelta,
      minimumConfidence: field.ai.minConfidence,
      fieldInstruction: field.ai.prompt,
    };
  });
  return [
    "你是动态状态判断器，只根据给定消息事实评估字段数值变化。",
    "只输出一个 JSON 对象，禁止 Markdown、代码围栏、解释或命令文本。",
    'JSON 必须严格符合：{"changes":[{"fieldId":"字段ID","delta":数字,"reason":"简短事实理由","confidence":0到1数字}]}。',
    "没有可靠变化时输出 {\"changes\":[]}。每个字段最多出现一次，不得输出未列出的字段。",
    `上下文：${JSON.stringify(context)}`,
    `可判断字段：${JSON.stringify(fieldContract)}`,
  ].join("\n");
}

function buildJudgementUserPrompt(
  recentFacts: readonly MessageFact[],
  message: string
): string {
  const facts = recentFacts.slice(-20).map((fact) => ({
    role: fact.role,
    content: fact.content,
    occurredAt: fact.occurredAt,
  }));
  return [
    `最近已持久化消息：${JSON.stringify(facts)}`,
    `本次消息：${JSON.stringify(message)}`,
  ].join("\n");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index]);
}
