/**
 * core/function-schema.ts
 *
 * 从 MagVarUpdate 上游 `src/function/function_call.ts` 移植的纯 schema / 提取辅助部分。
 * 仅保留结构化契约（JSON Patch 各操作 schema 与响应 schema），不包含上游的
 * SillyTavern 工具注册、额外模型请求与聊天写入（Phase 6 接入 AI Judge 时再加宿主调用）。
 */

/** JSON Patch 响应 schema（draft-04 JSON Schema，供 Phase 6 AI 结构化输出校验）。 */
export const MVU_JSON_PATCH_RESPONSE_SCHEMA = Object.freeze({
  name: "mvu_json_patch",
  description: "MVU JsonPatch dialect response. Return analysis plus json_patch operations only.",
  strict: false,
  value: {
    type: "object",
    additionalProperties: false,
    properties: {
      analysis: {
        type: "string",
        description:
          "Write in ENGLISH. Compactly summarize the variable update decision without revealing variable contents.",
      },
      json_patch: {
        type: "array",
        description:
          "MVU JsonPatch dialect operations. Use replace, delta, insert/add, remove, or move with JSON Pointer paths.",
        items: {
          anyOf: [
            {
              type: "object",
              additionalProperties: false,
              properties: {
                op: { type: "string", enum: ["replace"] },
                path: { type: "string" },
                value: { type: "object" },
              },
              required: ["op", "path", "value"],
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                op: { type: "string", enum: ["delta"] },
                path: { type: "string" },
                value: { type: "number" },
              },
              required: ["op", "path", "value"],
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                op: { type: "string", enum: ["insert", "add"] },
                path: { type: "string" },
                value: { type: "object" },
              },
              required: ["op", "path", "value"],
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                op: { type: "string", enum: ["remove"] },
                path: { type: "string" },
              },
              required: ["op", "path"],
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                op: { type: "string", enum: ["move"] },
                from: { type: "string" },
                path: { type: "string" },
              },
              required: ["op", "from", "path"],
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                op: { type: "string", enum: ["move"] },
                from: { type: "string" },
                to: { type: "string" },
              },
              required: ["op", "from", "to"],
            },
          ],
        },
      },
    },
    required: ["analysis", "json_patch"],
  },
});
