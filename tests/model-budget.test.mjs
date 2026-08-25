import assert from "node:assert/strict";
import test from "node:test";

import {
  MODEL_FIELD_LIMIT,
  buildStateSectionBlock,
  buildScopedStateSectionProjection,
  selectModelFields,
  visibleFieldsForContext,
} from "../dist/mvu/app/state-prompt.js";
import { HostSystemModelApi } from "../dist/mvu/app/system-model.js";
import { MvuService } from "../dist/mvu/app/service.js";
import { createRuntime } from "../dist/mvu/app/index.js";
import { createEmptyRecordManifest, SegmentedRecordStore } from "../dist/mvu/app/record-store.js";
import { FileMvuStore } from "../dist/mvu/app/store.js";
import { V3MvuStore } from "../dist/mvu/app/store-v3.js";
import { installMvuIpc } from "../dist/shared/ipc.js";
import { createFakeMvuFileApi, legacyDatasetFixture } from "./helpers.mjs";

const CONTEXT = { chatId: "chat-main", actorId: "actor-t", groupId: "group-main", actorName: "T" };
const PRODUCTION_CONFIG_DIR = "/model-budget-production";
const PRODUCTION_V2_PATH = `${PRODUCTION_CONFIG_DIR}/operit_mvu.dataset.v2.json`;
const PRODUCTION_V3_PATH = `${PRODUCTION_CONFIG_DIR}/operit_mvu.dataset.v3.json`;

function installPersistedMessageHost(t, files, hostSnapshot, modelCalls) {
  const previous = {
    hasToolPkg: Object.prototype.hasOwnProperty.call(globalThis, "ToolPkg"),
    toolPkg: globalThis.ToolPkg,
    hasTools: Object.prototype.hasOwnProperty.call(globalThis, "Tools"),
    tools: globalThis.Tools,
  };
  t.after(() => {
    if (previous.hasToolPkg) globalThis.ToolPkg = previous.toolPkg;
    else delete globalThis.ToolPkg;
    if (previous.hasTools) globalThis.Tools = previous.tools;
    else delete globalThis.Tools;
  });

  const successful = () => ({ successful: true, details: "" });
  globalThis.Tools = { Files: {
    async exists(path) { return { exists: await files.exists(path) }; },
    async read(path) { return { content: await files.readText(path) }; },
    async readPart(path, startLine, endLine) {
      return { content: await files.readTextPart(path, startLine, endLine) };
    },
    async write(path, content, append = false) {
      if (append) await files.appendText(path, content);
      else await files.writeText(path, content);
      return successful();
    },
    async move(source, destination) {
      await files.move(source, destination);
      return successful();
    },
    async replaceAtomically(source, destination) {
      await files.replaceAtomically(source, destination);
      return successful();
    },
    async deleteFile(path) {
      await files.deleteFile(path);
      return successful();
    },
    async mkdir(path) {
      await files.mkdir(path);
      return successful();
    },
  } };
  globalThis.ToolPkg = {
    getConfigDir() { return PRODUCTION_CONFIG_DIR; },
    chatContext: {
      async snapshot() { return structuredClone(hostSnapshot); },
    },
    ipc: {
      on() { return () => {}; },
      async call() { throw new Error("UNEXPECTED_IPC_CALL"); },
    },
    systemModel: {
      async probe() { return { available: true, provider: "test", model: "test" }; },
      async complete(request) {
        modelCalls.push(structuredClone(request));
        if (request.jsonSchema.name === "mvu_rule_judgement") {
          const line = request.systemPrompt.split("\n").find((item) => item.startsWith("候选规则："));
          const candidates = JSON.parse(line.slice("候选规则：".length));
          return { text: JSON.stringify({ matches: candidates.map((candidate) => ({
            ruleId: candidate.ruleId,
            matched: false,
            confidence: 0.9,
            reason: "not matched",
          })) }) };
        }
        if (request.jsonSchema.name === "mvu_state_judgement") {
          return { text: JSON.stringify({ changes: [] }) };
        }
        throw new Error(`UNEXPECTED_MODEL_SCHEMA:${request.jsonSchema.name}`);
      },
    },
  };
}

function field(id, order, overrides = {}) {
  return {
    id,
    name: id,
    description: `${id} description`,
    minimum: 0,
    maximum: 100,
    step: 1,
    initialValue: 20,
    icon: "favorite",
    themeColor: "#ff4f87",
    enabled: true,
    scope: "character",
    modelVisibility: "full",
    ai: { enabled: true, minConfidence: 0.7, maxDelta: 10, prompt: "judge carefully" },
    stages: [
      { id: "low", name: "低", description: "低阶段", threshold: 0 },
      { id: "high", name: "高", description: "高阶段", threshold: 50 },
    ],
    bindingIds: ["actor-t"],
    naturalChange: { enabled: false, unitMs: 3_600_000, amount: 0 },
    perTurnChange: { enabled: false, intervalTurns: 1, amount: 0, countMode: "both" },
    order,
    ...overrides,
  };
}

function condition(id, expression, overrides = {}) {
  return {
    id,
    name: id,
    description: "",
    enabled: true,
    expression,
    createdAt: "2036-01-01T00:00:00.000Z",
    updatedAt: "2036-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function rule(id, conditionId, actions, overrides = {}) {
  return {
    id,
    name: id,
    description: "",
    enabled: true,
    triggerActorSelector: { kind: "current_actor" },
    conditionId,
    actions,
    cooldownHours: 0,
    executionOrder: 0,
    createdAt: "2036-01-01T00:00:00.000Z",
    updatedAt: "2036-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function effectGroup(id, fieldIds, overrides = {}) {
  return {
    id,
    name: id,
    description: "",
    enabled: true,
    fieldEffects: fieldIds.map((fieldId, index) => ({
      id: `${id}-${index}`,
      fieldId,
      actorSelector: { kind: "trigger_actor" },
      operations: [{ kind: "immediate_delta", value: 1 }],
    })),
    defaultReason: { mode: "template", template: "rule", text: "规则触发" },
    createdAt: "2036-01-01T00:00:00.000Z",
    updatedAt: "2036-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function aiAutoRule(id, order, overrides = {}) {
  return {
    id,
    name: id,
    description: "",
    enabled: true,
    condition: { kind: "aiJudgement", triggerType: "event", requirement: "test", minimumConfidence: 0.7 },
    effects: [{ fieldId: "field_affinity", delta: 1, temporaryEffectIds: [] }],
    cooldownMs: 0,
    order,
    ...overrides,
  };
}

function dataset(fields, overrides = {}) {
  return {
    formatVersion: 3,
    createdAt: "2036-01-01T00:00:00.000Z",
    revision: 1,
    settings: { aiEnabled: true },
    fields,
    pendingBootstrapFieldIds: [],
    linkRules: [],
    conditions: [],
    rules: [],
    effectGroups: [],
    activeEffects: [],
    stateValues: {},
    recordManifest: { segments: [], recordCount: 0, nextSegmentIndex: 1 },
    lastSettled: {},
    turnCounters: {},
    processedMessageIds: [],
    ruleLastTriggered: {},
    messageFacts: {},
    hourlyMessageBuckets: {},
    ...overrides,
  };
}

function legacyDataset(fields, overrides = {}) {
  return {
    formatVersion: 2,
    createdAt: 2_000_000_000_000,
    revision: 1,
    settings: { aiEnabled: true },
    fields,
    pendingBootstrapFieldIds: [],
    rules: [],
    autoRules: [],
    temporaryEffects: [],
    stateValues: {},
    records: [],
    lastSettled: {},
    turnCounters: {},
    processedMessageIds: [],
    ruleLastTriggered: {},
    messageFacts: {},
    ...overrides,
  };
}

function ids(selection) {
  return selection.fields.map((item) => item.id);
}

test("uses every eligible field below the limit and reports bounded budget statistics", () => {
  const input = dataset(Array.from({ length: 12 }, (_, index) => field(`field-${index}`, index)));

  const selected = selectModelFields(input, CONTEXT);

  assert.equal(MODEL_FIELD_LIMIT, 40);
  assert.equal(selected.fields.length, 12);
  assert.deepEqual(selected.stats, {
    used: 12,
    total: 12,
    limit: 40,
    referencedIncluded: 0,
    referencedTotal: 0,
    overflow: false,
    diagnostics: [],
  });
});

test("service preserves all projectFields for runtime/UI while model projection stays bounded", async () => {
  const source = legacyDataset(Array.from({ length: 44 }, (_, index) => field(`service-${index}`, index)));
  const store = {
    async read() { return { revision: source.revision, dataset: structuredClone(source) }; },
    async transact() { throw new Error("unexpected mutation"); },
  };
  const service = new MvuService(store, {});
  const runtime = createRuntime({ store, initialActors: [] });

  const detailed = await service.projectModelFields(CONTEXT);
  const compatible = await service.projectFields(CONTEXT);
  const snapshot = await runtime.snapshot(CONTEXT);
  const modelData = await runtime.buildMvuData(CONTEXT);

  assert.equal(detailed.fields.length, 40);
  assert.deepEqual(detailed.budget, {
    used: 40,
    total: 44,
    limit: 40,
    referencedIncluded: 0,
    referencedTotal: 0,
    overflow: true,
    diagnostics: [],
  });
  assert.equal(compatible.length, 44);
  assert.deepEqual(compatible.map((item) => item.definition.id), source.fields.map((item) => item.id));
  assert.equal(snapshot.fields.length, 44);
  assert.equal(Object.keys(modelData.stat_data.states).length, 40);
  assert.equal(visibleFieldsForContext(source, CONTEXT).length, 44);
});

test("caps ordinary fields at 40 and is deterministic for identical and reordered input", () => {
  const fields = Array.from({ length: 55 }, (_, index) => field(`field-${String(index).padStart(2, "0")}`, index));
  const first = selectModelFields(dataset(fields), CONTEXT);
  const retry = selectModelFields(dataset([...fields].reverse()), CONTEXT);

  assert.equal(first.fields.length, 40);
  assert.deepEqual(ids(first), ids(retry));
  assert.deepEqual(ids(first), fields.slice(0, 40).map((item) => item.id));
  assert.equal(first.stats.total, 55);
  assert.equal(first.stats.overflow, true);
});

test("retains recursively and indirectly referenced fields including hidden direct references", () => {
  const fields = Array.from({ length: 45 }, (_, index) => field(`ordinary-${index}`, index));
  fields.push(field("hidden-condition", 100, { modelVisibility: "hidden" }));
  fields.push(field("hidden-action", 101, { modelVisibility: "hidden" }));
  fields.push(field("hidden-effect", 102, { modelVisibility: "hidden" }));
  const input = dataset(fields, {
    conditions: [condition("condition-main", {
      kind: "and",
      children: [
        { kind: "predicate", predicate: { kind: "sender", senders: ["user"] } },
        { kind: "not", child: { kind: "predicate", predicate: {
          kind: "field_comparison", fieldId: "hidden-condition", operator: ">=", value: 1,
        } } },
      ],
    })],
    effectGroups: [effectGroup("effect-main", ["hidden-effect"])],
    rules: [rule("rule-main", "condition-main", [
      { kind: "change_field", fieldId: "hidden-action", target: { kind: "trigger_actor" }, delta: 1, effectGroupIds: ["effect-main"] },
      { kind: "activate_effect_group", effectGroupId: "effect-main" },
    ])],
  });

  const selected = selectModelFields(input, CONTEXT);

  assert.equal(selected.fields.length, 40);
  assert.equal(selected.stats.referencedTotal, 3);
  assert.equal(selected.stats.referencedIncluded, 3);
  assert.equal(selected.stats.total, 48);
  assert.ok(ids(selected).includes("hidden-condition"));
  assert.ok(ids(selected).includes("hidden-action"));
  assert.ok(ids(selected).includes("hidden-effect"));
});

test("excludes disabled fields even when referenced and diagnoses missing or unreachable references", () => {
  const fields = [
    field("enabled", 0),
    field("disabled", 1, { enabled: false }),
    field("unreachable", 2, { modelVisibility: "hidden" }),
  ];
  const input = dataset(fields, {
    conditions: [
      condition("condition-main", { kind: "predicate", predicate: {
        kind: "field_comparison", fieldId: "disabled", operator: ">", value: 1,
      } }),
      condition("condition-disabled", { kind: "predicate", predicate: {
        kind: "field_comparison", fieldId: "unreachable", operator: ">", value: 1,
      } }, { enabled: false }),
    ],
    rules: [
      rule("rule-main", "condition-main", [
        { kind: "change_field", fieldId: "missing-field", target: { kind: "trigger_actor" }, delta: 1, effectGroupIds: ["missing-effect"] },
      ]),
      rule("rule-disabled-condition", "condition-disabled", [
        { kind: "change_field", fieldId: "unreachable", target: { kind: "trigger_actor" }, delta: 1, effectGroupIds: [] },
      ]),
      rule("rule-missing-condition", "missing-condition", []),
      rule("rule-disabled", "condition-main", [], { enabled: false }),
    ],
  });

  const selected = selectModelFields(input, CONTEXT);

  assert.deepEqual(ids(selected), ["enabled"]);
  assert.equal(selected.stats.referencedTotal, 0);
  assert.ok(selected.stats.diagnostics.includes("MVU_MODEL_REFERENCE_FIELD_DISABLED:disabled"));
  assert.ok(selected.stats.diagnostics.includes("MVU_MODEL_REFERENCE_FIELD_MISSING:missing-field"));
  assert.ok(selected.stats.diagnostics.includes("MVU_MODEL_REFERENCE_EFFECT_GROUP_MISSING:missing-effect"));
  assert.ok(selected.stats.diagnostics.includes("MVU_MODEL_REFERENCE_CONDITION_DISABLED:condition-disabled"));
  assert.ok(selected.stats.diagnostics.includes("MVU_MODEL_REFERENCE_CONDITION_MISSING:missing-condition"));
  assert.equal(selected.stats.diagnostics.some((item) => item.includes("rule-disabled")), false);
});

test("uses visibility, recent change, order and stable id as deterministic tie-breakers", () => {
  const input = dataset([
    field("stage", 0, { modelVisibility: "stage_only" }),
    field("old", 4),
    field("recent-b", 2),
    field("recent-a", 2),
  ]);
  const selected = selectModelFields(input, CONTEXT, {
    maxFields: 3,
    recentChanges: [
      { fieldId: "recent-a", scopeKey: "character:actor-t", occurredAt: 20 },
      { fieldId: "recent-b", scopeKey: "character:actor-t", occurredAt: 20 },
      { fieldId: "old", scopeKey: "character:actor-t", occurredAt: 10 },
    ],
  });

  assert.deepEqual(ids(selected), ["recent-a", "recent-b", "old"]);
});

test("recent ordering is exact to field and scope and never leaks another actor", () => {
  const input = dataset([
    field("same-field", 0),
    field("actor-peer", 1),
    field("chat-state", 2, { scope: "chat", bindingIds: ["chat-main"] }),
    field("group-state", 3, { scope: "group", bindingIds: ["group-main"] }),
    field("global-state", 4, { scope: "global", bindingIds: [] }),
  ]);
  const selected = selectModelFields(input, CONTEXT, {
    maxFields: 4,
    recentChanges: [
      { fieldId: "same-field", scopeKey: "character:actor-u", occurredAt: 10_000 },
      { fieldId: "same-field", scopeKey: "character:actor-t", occurredAt: 10 },
      { fieldId: "actor-peer", scopeKey: "character:actor-t", occurredAt: 20 },
      { fieldId: "chat-state", scopeKey: "chat:chat-main", occurredAt: 30 },
      { fieldId: "group-state", scopeKey: "group:group-main", occurredAt: 40 },
      { fieldId: "global-state", scopeKey: "global", occurredAt: 50 },
    ],
  });

  assert.deepEqual(ids(selected), ["global-state", "group-state", "chat-state", "actor-peer"]);
  assert.equal(ids(selected).includes("same-field"), false);
});

test("rule reachability matches event actor current actor group and cooldown semantics", () => {
  const hidden = field("hidden-rule-field", 100, { modelVisibility: "hidden" });
  const input = dataset([field("ordinary", 0), hidden], {
    conditions: [condition("condition-rule", {
      kind: "predicate", predicate: { kind: "sender", senders: ["user"] },
    })],
    rules: [rule("rule-current", "condition-rule", [{
      kind: "change_field", fieldId: hidden.id, target: { kind: "trigger_actor" }, delta: 1, effectGroupIds: [],
    }], { cooldownHours: 2 })],
  });

  const wrongActor = selectModelFields(input, CONTEXT, {
    eventActorId: "actor-u",
    currentActorId: "actor-t",
    occurredAt: 20_000,
    lastTriggeredAtByRuleId: {},
  });
  const coolingDown = selectModelFields(input, CONTEXT, {
    eventActorId: "actor-t",
    currentActorId: "actor-t",
    occurredAt: 20_000,
    lastTriggeredAtByRuleId: { "rule-current": 19_000 },
  });
  const reachable = selectModelFields(input, CONTEXT, {
    eventActorId: "actor-t",
    currentActorId: "actor-t",
    occurredAt: 20_000,
    lastTriggeredAtByRuleId: { "rule-current": -8_000_000 },
  });

  assert.deepEqual(ids(wrongActor), ["ordinary"]);
  assert.deepEqual(ids(coolingDown), ["ordinary"]);
  assert.deepEqual(ids(reachable), ["hidden-rule-field", "ordinary"]);
});

test("group prompt budgets final field-scope entries rather than field definitions", () => {
  const members = Array.from({ length: 20 }, (_, index) => ({
    chatId: "chat-main",
    actorId: `actor-${String(index).padStart(2, "0")}`,
    groupId: "group-main",
    actorName: `Actor ${index}`,
  }));
  const bindings = members.map((member) => member.actorId);
  const fields = Array.from({ length: 40 }, (_, index) => field(`group-field-${String(index).padStart(2, "0")}`, index, {
    bindingIds: bindings,
  }));
  const input = dataset(fields);

  const first = buildScopedStateSectionProjection(input, {
    chatId: "chat-main", actorId: null, groupId: "group-main", actorName: "Group",
  }, members);
  const retry = buildScopedStateSectionProjection(input, {
    chatId: "chat-main", actorId: null, groupId: "group-main", actorName: "Group",
  }, [...members].reverse());

  assert.equal(first.budget.used, 40);
  assert.equal(first.budget.total, 800);
  assert.equal(first.section.split("\n").filter((line) => line.startsWith("- ")).length, 40);
  assert.equal(first.section, retry.section);
  assert.deepEqual(first.budget, retry.budget);
});

test("record store finds latest exact-scope changes despite 500 newer unrelated records", async () => {
  const files = createFakeMvuFileApi();
  const records = new SegmentedRecordStore({ getConfigDir: () => "/budget", files });
  const change = (id, fieldId, scopeKey, occurredAt) => ({
    id, scope: scopeKey.startsWith("character:") ? "character" : scopeKey.startsWith("chat:") ? "chat" :
      scopeKey.startsWith("group:") ? "group" : "global",
    scopeKey, fieldId, fieldName: fieldId, actorId: scopeKey.startsWith("character:") ? scopeKey.slice(10) : null,
    actorName: "", chatId: "chat-main", groupId: "group-main", before: 0, after: 1,
    requestedDelta: 1, effectiveRequestedDelta: 1, delta: 1, stageBefore: "low", stageAfter: "low",
    reason: "test", source: "manual", ruleIds: [], effectIds: [], confidence: null,
    messageId: id, variantId: null, occurredAt,
  });
  const source = [
    change("target-t", "same-field", "character:actor-t", 10),
    change("target-chat", "chat-state", "chat:chat-main", 11),
    change("target-group", "group-state", "group:group-main", 12),
    change("target-global", "global-state", "global", 13),
    ...Array.from({ length: 500 }, (_, index) =>
      change(`noise-${index}`, "same-field", "character:actor-u", 1_000 + index)),
  ];
  const staged = await records.stageAppend(createEmptyRecordManifest(), source, 1);

  const latest = await records.queryLatestFieldChanges(staged.manifest, [
    { fieldId: "same-field", scopeKey: "character:actor-t" },
    { fieldId: "chat-state", scopeKey: "chat:chat-main" },
    { fieldId: "group-state", scopeKey: "group:group-main" },
    { fieldId: "global-state", scopeKey: "global" },
  ]);

  assert.deepEqual(latest, [
    { fieldId: "same-field", scopeKey: "character:actor-t", occurredAt: 10 },
    { fieldId: "chat-state", scopeKey: "chat:chat-main", occurredAt: 11 },
    { fieldId: "group-state", scopeKey: "group:group-main", occurredAt: 12 },
    { fieldId: "global-state", scopeKey: "global", occurredAt: 13 },
  ]);
});

test("runtime v3 prompt and model data use authoritative references instead of compatibility projection", async () => {
  const fields = [
    field("ordinary_field", 0),
    field("hidden_enabled_ref", 1, { modelVisibility: "hidden" }),
    field("hidden_disabled_ref", 2, { modelVisibility: "hidden" }),
  ];
  const legacy = legacyDataset(fields);
  const files = createFakeMvuFileApi();
  const legacyStore = new FileMvuStore({
    getConfigDir: () => "/authority",
    files,
    createInitialDataset: () => structuredClone(legacy),
  });
  const store = new V3MvuStore({
    getConfigDir: () => "/authority",
    files,
    legacyStore,
    createInitialDataset: () => structuredClone(legacy),
    now: () => Date.parse("2036-01-01T00:00:00.000Z"),
  });
  await store.initialize();
  const before = await store.readV3();
  const next = structuredClone(before.dataset);
  next.conditions = [
    condition("condition_enabled_ref", { kind: "and", children: [
      { kind: "predicate", predicate: { kind: "sender", senders: ["user"] } },
      { kind: "predicate", predicate: { kind: "field_comparison", fieldId: "hidden_enabled_ref", operator: ">=", value: 0 } },
    ] }),
    condition("condition_disabled_ref", { kind: "predicate", predicate: {
      kind: "field_comparison", fieldId: "hidden_disabled_ref", operator: ">=", value: 0,
    } }, { enabled: false }),
  ];
  next.rules = [
    rule("rule_enabled_ref", "condition_enabled_ref", [{
      kind: "change_field", fieldId: "ordinary_field", target: { kind: "trigger_actor" }, delta: 1, effectGroupIds: [],
    }]),
    rule("rule_disabled_ref", "condition_disabled_ref", [{
      kind: "change_field", fieldId: "ordinary_field", target: { kind: "trigger_actor" }, delta: 1, effectGroupIds: [],
    }]),
  ];
  await store.transactV3(before.revision, next, []);
  const runtime = createRuntime({ store });

  const section = await runtime.buildStateSection(CONTEXT);
  const modelData = await runtime.buildMvuData(CONTEXT);

  assert.match(section, /hidden_enabled_ref/);
  assert.doesNotMatch(section, /hidden_disabled_ref/);
  assert.ok(Object.hasOwn(modelData.stat_data.states, "hidden_enabled_ref"));
  assert.equal(Object.hasOwn(modelData.stat_data.states, "hidden_disabled_ref"), false);
});

test("returns deterministic overflow diagnostics when valid references exceed the hard limit", () => {
  const fields = Array.from({ length: 45 }, (_, index) => field(`ref-${String(index).padStart(2, "0")}`, index));
  const expression = {
    kind: "and",
    children: fields.map((item) => ({ kind: "predicate", predicate: {
      kind: "field_comparison", fieldId: item.id, operator: ">=", value: 0,
    } })),
  };
  const input = dataset(fields, {
    conditions: [condition("condition-overflow", expression)],
    rules: [rule("rule-overflow", "condition-overflow", [])],
  });

  const selected = selectModelFields(input, CONTEXT);

  assert.equal(selected.fields.length, 40);
  assert.equal(selected.stats.referencedTotal, 45);
  assert.equal(selected.stats.referencedIncluded, 40);
  assert.equal(selected.stats.overflow, true);
  assert.ok(selected.stats.diagnostics.includes("MVU_MODEL_REFERENCED_FIELDS_OVERFLOW:45:40"));
  assert.deepEqual(ids(selected), fields.slice(0, 40).map((item) => item.id));
});

test("counts only fields applicable to character, group, chat and global contexts", () => {
  const input = dataset([
    field("character-hit", 0),
    field("character-miss", 1, { bindingIds: ["actor-u"] }),
    field("group-hit", 2, { scope: "group", bindingIds: ["group-main"] }),
    field("group-miss", 3, { scope: "group", bindingIds: ["group-other"] }),
    field("chat-hit", 4, { scope: "chat", bindingIds: ["chat-main"] }),
    field("chat-miss", 5, { scope: "chat", bindingIds: ["chat-other"] }),
    field("global", 6, { scope: "global", bindingIds: [] }),
  ]);

  const selected = selectModelFields(input, CONTEXT);

  assert.deepEqual(ids(selected), ["character-hit", "group-hit", "chat-hit", "global"]);
  assert.equal(selected.stats.total, 4);
});

test("stage_only projection exposes the stage but not its numeric value", () => {
  const stage = field("stage-only", 0, { modelVisibility: "stage_only" });
  const input = dataset([stage], {
    stateValues: { "character:actor-t": { "stage-only": 73 } },
  });

  const block = buildStateSectionBlock(input, CONTEXT, [stage]);

  assert.match(block, /阶段「高」/);
  assert.doesNotMatch(block, /73/);
});

test("runtime model data preserves stage_only semantics without serializing its numeric value", async () => {
  const stage = field("stage-only-runtime", 0, { modelVisibility: "stage_only" });
  const source = legacyDataset([stage], {
    stateValues: { "character:actor-t": { "stage-only-runtime": 73 } },
  });
  const store = {
    async read() { return { revision: source.revision, dataset: structuredClone(source) }; },
    async transact() { throw new Error("unexpected mutation"); },
  };

  const modelData = await createRuntime({ store, initialActors: [] }).buildMvuData(CONTEXT);
  const state = modelData.stat_data.states["stage-only-runtime"];

  assert.doesNotMatch(JSON.stringify(state), /73/);
  assert.match(JSON.stringify(state), /高/);
});

test("manual judgeState IPC uses the bounded model projection for more than 40 runtime fields", async (t) => {
  const previousToolPkg = globalThis.ToolPkg;
  const handlers = {};
  globalThis.ToolPkg = {
    ipc: {
      on(channel, handler) {
        handlers[channel] = handler;
        return () => { delete handlers[channel]; };
      },
    },
  };
  t.after(() => {
    if (previousToolPkg === undefined) delete globalThis.ToolPkg;
    else globalThis.ToolPkg = previousToolPkg;
  });

  const definitions = Array.from({ length: 44 }, (_, index) =>
    field(`manual-ipc-${String(index).padStart(2, "0")}`, index));
  const projections = definitions.map((definition) => ({
    definition,
    bound: true,
    scopeKey: "character:actor-t",
    currentValue: 20,
    currentStage: definition.stages[0],
  }));
  let compatibleCalls = 0;
  let modelCalls = 0;
  const runtime = {
    service: {
      async projectFields() {
        compatibleCalls += 1;
        return projections;
      },
      async projectModelFields() {
        modelCalls += 1;
        return {
          fields: projections.slice(0, 40),
          budget: {
            used: 40, total: 44, limit: 40,
            referencedIncluded: 0, referencedTotal: 0, overflow: true, diagnostics: [],
          },
        };
      },
    },
    async getRecentMessageFacts() { return []; },
    async applyAiJudgement() { throw new Error("unexpected commit"); },
  };
  const uninstall = installMvuIpc(runtime, {
    async snapshot() { throw new Error("unexpected snapshot"); },
    systemModel: {
      async judgeState(request) {
        if (request.fields.length > 40) {
          throw new Error(`MANUAL_JUDGE_RECEIVED_UNBOUNDED_FIELDS:${request.fields.length}`);
        }
        return { available: true, changes: [], raw: '{"changes":[]}' };
      },
    },
    queries: {},
  });
  t.after(uninstall);

  const response = await handlers["operit_mvu:judge_state"]({
    scopeContext: CONTEXT,
    message: "manual bounded judgement",
    commit: false,
  });

  assert.equal(response.available, true);
  assert.equal(response.applied, false);
  assert.equal(compatibleCalls, 0);
  assert.equal(modelCalls, 1);
});

test("judgeRules deterministically selects twenty rules in one call and returns an overflow diagnostic", async () => {
  const completions = [];
  const api = new HostSystemModelApi({
    async probe() { return { available: true }; },
    async complete(request) {
      completions.push(request);
      const line = request.systemPrompt.split("\n").find((item) => item.startsWith("候选规则："));
      const candidates = JSON.parse(line.slice("候选规则：".length));
      return { text: JSON.stringify({ matches: candidates.map((candidate) => ({
        ruleId: candidate.ruleId,
        matched: false,
        confidence: 0.9,
        reason: "not matched",
      })) }) };
    },
  });
  const rules = Array.from({ length: 21 }, (_, index) =>
    aiAutoRule(`rule_${String(20 - index).padStart(2, "0")}`, index % 3));
  const expected = [...rules]
    .sort((left, right) => left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .slice(0, 20)
    .map((rule) => rule.id);

  const result = await api.judgeRules({
    context: CONTEXT,
    rules,
    fields: [],
    recentFacts: [],
    message: { role: "user", actorId: "actor-t", actorName: "T", content: "trigger" },
  });

  assert.equal(completions.length, 1);
  const contractLine = completions[0].systemPrompt.split("\n")
    .find((line) => line.startsWith("候选规则："));
  assert.deepEqual(JSON.parse(contractLine.slice("候选规则：".length)).map((item) => item.ruleId), expected);
  assert.deepEqual(result.judgements.map((item) => item.ruleId), expected);
  assert.deepEqual(result.diagnostics, ["MVU_AI_RULES_OVERFLOW:21:20"]);
});

test("production v2 event with twenty-one AI rules still judges state and persists after one rule call", async (t) => {
  const legacy = legacyDatasetFixture();
  legacy.fields[0].ai = { enabled: true, minConfidence: 0.7, maxDelta: 10, prompt: "judge" };
  legacy.autoRules = Array.from({ length: 21 }, (_, index) =>
    aiAutoRule(`production_rule_${String(20 - index).padStart(2, "0")}`, index % 3));
  legacy.temporaryEffects = [];
  const files = createFakeMvuFileApi({ [PRODUCTION_V2_PATH]: JSON.stringify(legacy, null, 2) });
  files.failNext("replaceAtomically", ({ destination }) => destination === PRODUCTION_V3_PATH);
  const actor = { characterCardId: "actor_t", name: "T", avatarUri: null };
  const hostSnapshot = {
    chatId: "chat_main",
    activePrompt: { type: "character_card", id: "actor_t", name: "T" },
    activeCharacter: actor,
    activeGroup: null,
    characters: [actor],
    groups: [],
    members: [],
    currentCharacter: actor,
  };
  const modelCalls = [];
  const warnings = [];
  const previousWarn = console.warn;
  console.warn = (...items) => { warnings.push(items.map(String).join(" ")); };
  t.after(() => { console.warn = previousWarn; });
  installPersistedMessageHost(t, files, hostSnapshot, modelCalls);
  const main = await import(`../dist/main.js?v2-rule-overflow=${Date.now()}`);
  assert.deepEqual(await main.onApplicationCreate(), { ok: true });
  assert.equal(files.snapshot()[PRODUCTION_V3_PATH], undefined, "fixture must remain in v2 compatibility mode");
  assert.equal(JSON.parse(files.snapshot()[PRODUCTION_V2_PATH]).autoRules.length, 21);

  assert.equal(await main.onChatMessagePersisted({
    eventName: "message_persisted",
    eventPayload: {
      chatId: "chat_main",
      messageId: "message_rule_overflow",
      variantId: null,
      actorCharacterCardId: "actor_t",
      characterGroupId: null,
      actorName: "T",
      isComplete: true,
      timestamp: 2_000_000_000_000,
      sender: "ai",
      content: "A production v2 overflow event",
    },
  }), null);

  const ruleCalls = modelCalls.filter((call) => call.jsonSchema.name === "mvu_rule_judgement");
  const stateCalls = modelCalls.filter((call) => call.jsonSchema.name === "mvu_state_judgement");
  const persisted = JSON.parse(files.snapshot()[PRODUCTION_V2_PATH]);
  assert.equal(ruleCalls.length, 1, JSON.stringify(modelCalls.map((call) => call.jsonSchema.name)));
  assert.equal(stateCalls.length, 1);
  assert.equal(JSON.parse(ruleCalls[0].systemPrompt.split("\n")
    .find((line) => line.startsWith("候选规则：")).slice("候选规则：".length)).length, 20);
  assert.equal(warnings.some((warning) => warning.includes("MVU_AI_RULES_OVERFLOW:21:20")), true);
  assert.equal(persisted.processedMessageIds.length, 1);
  assert.equal(Object.values(persisted.messageFacts).flat().length, 1);
});

test("sends bounded role and actor metadata for the current message with one completion", async () => {
  const completions = [];
  let probeCount = 0;
  const api = new HostSystemModelApi({
    async probe() { probeCount += 1; return { available: true }; },
    async complete(request) {
      completions.push(request);
      return { text: '{"changes":[]}' };
    },
  });
  const definition = field("affinity", 0);
  const projection = {
    definition,
    bound: true,
    scopeKey: "character:actor-t",
    currentValue: 20,
    currentStage: definition.stages[0],
  };

  await api.judgeState({
    context: CONTEXT,
    fields: [projection],
    recentFacts: [],
    message: { role: "character", actorId: "actor-t", actorName: "T", content: "hello" },
  });

  assert.equal(probeCount, 1);
  assert.equal(completions.length, 1);
  const currentLine = completions[0].userPrompt.split("\n").find((line) => line.startsWith("本次消息："));
  assert.deepEqual(JSON.parse(currentLine.slice("本次消息：".length)), {
    role: "character",
    actorId: "actor-t",
    actorName: "T",
    chatId: "chat-main",
    groupId: "group-main",
    content: "hello",
  });
  assert.equal(completions[0].jsonSchema.name, "mvu_state_judgement");
});

test("bounds every model DTO and gives condition judgement the trusted chat and group context", async () => {
  const completions = [];
  const api = new HostSystemModelApi({
    async probe() { return { available: true }; },
    async complete(request) {
      completions.push(request);
      if (request.jsonSchema.name === "mvu_condition_judgement") {
        return { text: '{"judgements":[{"predicateId":"predicate-long","matched":false,"confidence":0.2}]}' };
      }
      if (request.jsonSchema.name === "mvu_rule_judgement") {
        return { text: '{"matches":[{"ruleId":"rule-long","matched":false,"confidence":0.2,"reason":"no"}]}' };
      }
      return { text: '{"changes":[]}' };
    },
  });
  const long = "界".repeat(20_000);
  const definitions = Array.from({ length: 40 }, (_, index) => field(`bounded-${index}`, index, {
    name: long,
    description: long,
    ai: { enabled: true, minConfidence: 0.7, maxDelta: 10, prompt: long },
    stages: [{ id: "low", name: long, description: long, threshold: 0 }],
  }));
  const projections = definitions.map((definition) => ({
    definition, bound: true, scopeKey: "character:actor-t", currentValue: 20, currentStage: definition.stages[0],
  }));
  const message = { role: "user", actorId: "spoofed-actor", actorName: "spoofed name", content: long };

  await api.judgeState({ context: { ...CONTEXT, actorName: long }, fields: projections, recentFacts: [], message });
  await api.judgeRules({
    context: { ...CONTEXT, actorName: long },
    fields: projections,
    recentFacts: [],
    message,
    rules: [{
      id: "rule-long", name: long, description: long, enabled: true,
      condition: { kind: "aiJudgement", triggerType: long, requirement: long, minimumConfidence: 0.7 },
      effects: [], cooldownMs: 0, order: 0,
    }],
  });
  await api.judgeConditions({
    context: CONTEXT,
    predicates: [{ id: "predicate-long", triggerType: long, requirement: long, minimumConfidence: 0.7 }],
    message,
  });

  assert.equal(completions.length, 3);
  assert.equal(completions.every((request) => request.systemPrompt.length <= 65_536), true);
  assert.equal(completions.every((request) => request.userPrompt.length <= 65_536), true);
  assert.equal(completions.every((request) =>
    Buffer.byteLength(request.systemPrompt, "utf8") + Buffer.byteLength(request.userPrompt, "utf8") <= 65_536), true);
  const conditionMessage = JSON.parse(completions.find((request) =>
    request.jsonSchema.name === "mvu_condition_judgement").userPrompt);
  assert.equal(conditionMessage.role, "user");
  assert.equal(conditionMessage.actorId, "actor-t");
  assert.equal(conditionMessage.chatId, "chat-main");
  assert.equal(conditionMessage.groupId, "group-main");
  assert.ok(conditionMessage.actorName.length <= 128);
  assert.ok(conditionMessage.content.length <= 8_192);
  const stateMessageLine = completions.find((request) =>
    request.jsonSchema.name === "mvu_state_judgement").userPrompt.split("\n")
    .find((line) => line.startsWith("本次消息："));
  const stateMessage = JSON.parse(stateMessageLine.slice("本次消息：".length));
  assert.equal(stateMessage.actorId, "actor-t");
  assert.equal(stateMessage.actorName.length <= 128, true);
});

test("stage_only state and rule model contracts never expose the numeric value", async () => {
  const completions = [];
  const api = new HostSystemModelApi({
    async probe() { return { available: true }; },
    async complete(request) {
      completions.push(request);
      return request.jsonSchema.name === "mvu_state_judgement"
        ? { text: '{"changes":[]}' }
        : { text: '{"matches":[{"ruleId":"rule-ai","matched":false,"confidence":0.8,"reason":"not met"}]}' };
    },
  });
  const definition = field("secret-value", 0, { modelVisibility: "stage_only" });
  const projection = {
    definition,
    bound: true,
    scopeKey: "character:actor-t",
    currentValue: 73,
    currentStage: definition.stages[1],
  };
  const message = { role: "user", actorId: "actor-t", actorName: "T", content: "hello" };

  await api.judgeState({ context: CONTEXT, fields: [projection], recentFacts: [], message });
  await api.judgeRules({
    context: CONTEXT,
    fields: [projection],
    recentFacts: [],
    message,
    rules: [{
      id: "rule-ai", name: "rule-ai", description: "", enabled: true,
      condition: { kind: "aiJudgement", triggerType: "event", requirement: "test", minimumConfidence: 0.7 },
      effects: [], cooldownMs: 0, order: 0,
    }],
  });

  assert.equal(completions.length, 2);
  for (const completion of completions) {
    assert.doesNotMatch(completion.systemPrompt, /"currentValue":73|"value":73/);
    assert.match(completion.systemPrompt, /"currentStage":"高"|"stage":"高"/);
  }
});
