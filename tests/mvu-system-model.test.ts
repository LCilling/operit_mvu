import assert from "node:assert/strict";
import test from "node:test";

import type { DataField, MessageFact, StateScopeContext } from "../src/mvu/app/model";
import type { FieldStateProjection } from "../src/mvu/app/service";
import { HostSystemModelApi } from "../src/mvu/app/system-model";

const CONTEXT: StateScopeContext = {
  chatId: "chat_a",
  actorId: "actor_a",
  groupId: null,
  actorName: "角色甲",
};

function projection(): FieldStateProjection {
  const field: DataField = {
    id: "field_affinity",
    name: "亲密度",
    description: "关系亲近程度",
    minimum: 0,
    maximum: 100,
    step: 1,
    initialValue: 30,
    icon: "favorite",
    themeColor: "#FF4F88",
    enabled: true,
    scope: "character",
    modelVisibility: "full",
    ai: { enabled: true, minConfidence: 0.8, maxDelta: 5, prompt: "只依据明确互动" },
    stages: [{ id: "stage_base", name: "熟悉", description: "已经熟悉", threshold: 0 }],
    bindingIds: ["actor_a"],
    naturalChange: { enabled: false, unitMs: 3_600_000, amount: 0 },
    perTurnChange: { enabled: false, intervalTurns: 1, amount: 0, countMode: "both" },
    order: 1,
  };
  return {
    definition: field,
    bound: true,
    scopeKey: "character:actor_a",
    currentValue: 30,
    currentStage: field.stages[0],
  };
}

function request() {
  const recentFacts: MessageFact[] = [];
  return {
    context: CONTEXT,
    fields: [projection()],
    recentFacts,
    message: "谢谢你一直陪着我",
  };
}

test("system model accepts only the exact judgement JSON contract", async () => {
  const completionRequests: ToolPkg.SystemModelCompletionRequest[] = [];
  const api = new HostSystemModelApi({
    async probe() {
      return { available: true, provider: "provider", model: "model" };
    },
    async complete(input) {
      completionRequests.push(input);
      return {
        text: '{"changes":[{"fieldId":"field_affinity","delta":3,"reason":"明确表达感谢","confidence":0.9}]}',
        providerModel: "provider:model",
      };
    },
  });

  const result = await api.judgeState(request());
  assert.equal(result.available, true);
  assert.deepEqual(result.changes, [{
    fieldId: "field_affinity",
    delta: 3,
    reason: "明确表达感谢",
    confidence: 0.9,
  }]);
  assert.equal(completionRequests.length, 1);
  assert.match(completionRequests[0].systemPrompt, /field_affinity/);
  assert.match(completionRequests[0].userPrompt, /谢谢你一直陪着我/);
  assert.equal(completionRequests[0].jsonSchema?.name, "mvu_state_judgement");
  assert.deepEqual(completionRequests[0].jsonSchema?.schema.required, ["changes"]);
});

test("system model reports explicit host unavailability without requesting completion", async () => {
  let completed = false;
  const api = new HostSystemModelApi({
    async probe() {
      return { available: false, reason: "未配置模型" };
    },
    async complete() {
      completed = true;
      return { text: "", providerModel: "" };
    },
  });
  assert.deepEqual(await api.judgeState(request()), {
    available: false,
    changes: [],
    raw: "",
  });
  assert.equal(completed, false);
});

test("system model rejects prose recovery, unexpected keys, fields, confidence, and delta", async () => {
  const invalidOutputs = [
    '```json\n{"changes":[]}\n```',
    '{"changes":[],"note":"extra"}',
    '{"changes":[{"fieldId":"missing","delta":1,"reason":"未知","confidence":0.9}]}',
    '{"changes":[{"fieldId":"field_affinity","delta":1,"reason":"置信度低","confidence":0.7}]}',
    '{"changes":[{"fieldId":"field_affinity","delta":6,"reason":"越界","confidence":0.9}]}',
  ];
  for (const output of invalidOutputs) {
    const api = new HostSystemModelApi({
      async probe() {
        return { available: true };
      },
      async complete() {
        return { text: output, providerModel: "provider:model" };
      },
    });
    await assert.rejects(() => api.judgeState(request()));
  }
});
