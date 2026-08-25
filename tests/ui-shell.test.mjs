import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { stat, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const runtimeSource = await readFile(new URL("../static/app_ui/runtime.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../static/app_ui/app.js", import.meta.url), "utf8");
const componentsSource = await readFile(new URL("../static/app_ui/components.js", import.meta.url), "utf8");
const configSource = await readFile(new URL("../static/app_ui/pages-config.js", import.meta.url), "utf8");
const rulesSource = await readFile(new URL("../static/app_ui/pages-rules.js", import.meta.url), "utf8");
const statusSource = await readFile(new URL("../static/app_ui/pages-status.js", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../static/app_ui/styles.css", import.meta.url), "utf8");

function page(items) {
  return { items, loadedCount: items.length, totalCount: items.length, hasMore: false, nextCursor: null };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function fieldSummary(id = "field_a", currentValue = 4) {
  return {
    id, name: "亲密度", description: "关系", enabled: true, scope: "character", order: 0,
    range: { minimum: 0, maximum: 100, step: 1 },
    theme: { icon: "favorite", color: "#ff4f88" },
    current: {
      value: currentValue,
      stage: { id: "warm", name: "熟悉", threshold: 20 },
      scopeKey: "character:actor_a", actorId: "actor_a", groupId: null, chatId: "chat_a",
    },
    truncated: false,
  };
}

function validFieldEntity(overrides = {}) {
  return {
    id: "field_a", name: "亲密度", description: "关系", minimum: 0, maximum: 100,
    step: 1, initialValue: 10, icon: "favorite", themeColor: "#ff4f88", enabled: true,
    scope: "character", modelVisibility: "full", bindingIds: ["actor_a"], order: 0,
    stages: [{ id: "low", name: "陌生", description: "尚不熟悉", threshold: 0 }],
    ai: { enabled: true, minConfidence: 0.7, maxDelta: 5, prompt: "" },
    naturalChange: { enabled: false, unitMs: 86_400_000, amount: 0 },
    perTurnChange: { enabled: false, intervalTurns: 1, amount: 0, countMode: "both" },
    currentValue: 4,
    currentStage: { id: "low", name: "陌生", description: "尚不熟悉", threshold: 0 },
    bindingDisplay: "角色甲",
    scopeKey: "character:actor_a",
    ...overrides,
  };
}

function validRuleEntity(overrides = {}) {
  return {
    id: "rule_a", name: "规则", description: "说明", enabled: true,
    triggerActorSelector: { kind: "current_actor" }, conditionId: "condition_a",
    actions: [{ kind: "change_field", fieldId: "field_a", target: { kind: "trigger_actor" }, delta: 1, effectGroupIds: [] }],
    cooldownHours: 0, executionOrder: 0,
    createdAt: "2033-01-01T00:00:00.000Z", updatedAt: "2033-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function validConditionEntity(overrides = {}) {
  return {
    id: "condition_a", name: "条件", description: "说明", enabled: true,
    expression: { kind: "predicate", predicate: { kind: "user_care" } },
    createdAt: "2033-01-01T00:00:00.000Z", updatedAt: "2033-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function validEffectEntity(overrides = {}) {
  return {
    id: "effect_a", name: "效果", description: "说明", enabled: true,
    fieldEffects: [{
      id: "field_effect_a", fieldId: "field_a", actorSelector: { kind: "trigger_actor" },
      operations: [{ kind: "immediate_delta", value: 1 }],
    }],
    defaultReason: { mode: "template", template: "general", text: "" },
    createdAt: "2033-01-01T00:00:00.000Z", updatedAt: "2033-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function validSnapshot(overrides = {}) {
  const pages = {
    fields: page([fieldSummary()]),
    rules: page([{ id: "rule_a", name: "规则", description: "说明", enabled: true, conditionId: "condition_a", actionCount: 1, executionOrder: 0, updatedAt: "2033-01-01T00:00:00.000Z", truncated: false }]),
    conditions: page([{ id: "condition_a", name: "条件", description: "说明", enabled: true, rootKind: "predicate", updatedAt: "2033-01-01T00:00:00.000Z", truncated: false }]),
    effectGroups: page([{ id: "effect_a", name: "效果", description: "说明", enabled: true, fieldCount: 1, updatedAt: "2033-01-01T00:00:00.000Z", truncated: false }]),
    records: page([{ id: "record_a", fieldId: "field_a", fieldName: "亲密度", actorId: "actor_a", actorName: "角色甲", groupId: null, before: 3, after: 4, delta: 1, reason: "互动", source: "manual", occurredAt: 2_000_000_000_000, truncated: false }]),
  };
  return {
    revision: 1,
    snapshotTruncated: false,
    activeContext: { chatId: "chat_a", actorId: "actor_a", groupId: null, actorName: "角色甲", truncated: false },
    settings: { aiEnabled: true },
    migrationStatus: { mode: "v3", source: "existing", truncated: false },
    modelBudget: { used: 1, total: 1, limit: 40, referencedIncluded: 0, referencedTotal: 0, overflow: false, diagnostics: [] },
    counts: { fields: 1, actors: 2, groups: 1, rules: 1, conditions: 1, effectGroups: 1, records: 1 },
    selected: {
      actor: { characterId: "actor_a", name: "角色甲", avatarUri: null, avatarUriUnavailable: false, enabled: true, truncated: false },
      group: null,
    },
    contextLabels: { groupName: null, chatName: "角色甲的会话", truncated: false },
    returnedCount: { fields: 1, rules: 1, conditions: 1, effectGroups: 1, records: 1 },
    pages,
    ...overrides,
  };
}

function createHarness(search = "?route=field-detail&field=field_a") {
  class FakeElement {
    constructor() {
      this.listeners = new Map();
      this.classList = { add() {}, remove() {}, contains() { return false; } };
      this.style = { setProperty() {}, removeProperty() {} };
      this.dataset = {};
      this.files = [];
      this.innerHTML = "";
      this.textContent = "";
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    hasAttribute() { return false; }
    toggleAttribute() {}
    click() {}
    closest() { return null; }
    focus() { context.document.activeElement = this; }
  }
  const elements = new Map(["appRoot", "backgroundPicker", "datasetImportPicker", "toast"].map((id) => [id, new FakeElement()]));
  const historyCalls = [];
  const listeners = new Map();
  const context = {
    console,
    URL,
    URLSearchParams,
    Intl,
    Date,
    Error,
    Map,
    Set,
    Promise,
    Element: FakeElement,
    FileReader: class {},
    Image: class {},
    window: {
      location: { href: `https://mvu.local/app.html${search}`, search },
      history: {
        length: 7,
        pushState(state, _title, url) { historyCalls.push(["push", state.route]); this.state = state; context.window.location.href = String(url); context.window.location.search = new URL(String(url)).search; },
        replaceState(state, _title, url) { historyCalls.push(["replace", state.route]); this.state = state; context.window.location.href = String(url); context.window.location.search = new URL(String(url)).search; },
        back() { historyCalls.push(["browser-back"]); },
        state: null,
      },
      localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
      matchMedia() { return { matches: false }; },
      addEventListener(type, listener) { listeners.set(type, listener); },
      setTimeout,
      clearTimeout,
    },
    document: {
      getElementById(id) { return elements.get(id); },
      documentElement: new FakeElement(),
      activeElement: null,
      querySelectorAll() { return []; },
      createElement() { throw new Error("unexpected browser download"); },
      startViewTransition(update) { update(); },
    },
  };
  context.window.window = context.window;
  context.window.document = context.document;
  vm.createContext(context);
  vm.runInContext(runtimeSource, context, { filename: "runtime.js" });
  const ui = context.window.MvuUi;
  ui.components = {
    shell() { return ""; },
    recoveryState() { return ""; },
  };
  ui.pages = { fieldDetail() { return ""; }, status() { return ""; } };
  return { context, ui, elements, historyCalls, listeners };
}

test("import and export honor the native JSON/path contracts", async () => {
  const { context, ui } = createHarness();
  const calls = [];
  ui.native.call = async (method, payload) => {
    calls.push([method, payload]);
    if (method === "snapshot") return validSnapshot();
    if (method === "queryActors") return page([]);
    if (method === "queryGroups") return page([]);
    if (method === "previewDatasetImport") return {
      valid: true, kind: "full_v3", sourceFormatVersion: 3, schemaVersion: 1,
      exportedAt: "2033-05-18T03:33:20.000Z", sourceRevision: 1, previewRevision: 1, expectedRevision: 1,
      summary: { fieldCount: 1, conditionCount: 1, ruleCount: 1, effectGroupCount: 1, activeEffectCount: 0, recordCount: 1 },
      migrationWarnings: { items: [], totalCount: 0, truncated: false },
      replacementWarning: "导入会替换全部当前 MVU 数据。", confirmationValue: "REPLACE_ALL_MVU_DATA",
    };
    if (method === "exportDataset") return {
      fileName: "mvu.json", savedPath: "/sdcard/Download/Operit/exports/mvu.json",
      summary: { sourceRevision: 1, fieldCount: 1, conditionCount: 1, ruleCount: 1, effectGroupCount: 1,
        activeEffectCount: 0, recordCount: 1, byteCount: 1024 },
    };
    return null;
  };
  vm.runInContext(appSource, context, { filename: "app.js" });
  await new Promise((resolve) => setImmediate(resolve));

  await ui.importDatasetText('{"formatVersion":3}');
  const exported = await ui.exportDataset();

  const imported = calls.find(([method]) => method === "previewDatasetImport");
  assert.equal(imported[0], "previewDatasetImport");
  assert.equal(imported[1].json, '{"formatVersion":3}');
  assert.equal(exported.fileName, "mvu.json");
  assert.equal(exported.savedPath, "/sdcard/Download/Operit/exports/mvu.json");
});

test("a superseded snapshot response cannot overwrite the latest context", async () => {
  const { ui } = createHarness("?route=status");
  const first = deferred();
  const second = deferred();
  ui.native.call = async (method, payload) => {
    assert.equal(method, "snapshot");
    return payload.actorId === "actor_a" ? first.promise : second.promise;
  };
  const actorA = validSnapshot({
    activeContext: { chatId: "chat_a", actorId: "actor_a", groupId: null, actorName: "角色甲", truncated: false },
  });
  const actorB = validSnapshot({
    activeContext: { chatId: "chat_a", actorId: "actor_b", groupId: null, actorName: "角色乙", truncated: false },
    selected: {
      actor: { characterId: "actor_b", name: "角色乙", avatarUri: null, avatarUriUnavailable: false, enabled: true, truncated: false },
      group: null,
    },
    contextLabels: { groupName: null, chatName: "角色乙的会话", truncated: false },
  });

  const older = ui.loadSnapshot({ actorId: "actor_a" });
  const latest = ui.loadSnapshot({ actorId: "actor_b" });
  second.resolve(actorB);
  await latest;
  first.resolve(actorA);

  await assert.rejects(older, /MVU_SNAPSHOT_REQUEST_SUPERSEDED/);
  assert.equal(ui.state.snapshot.activeContext.actorId, "actor_b");
});

test("an old field response cannot repopulate the cache after context changes", async () => {
  const { ui } = createHarness("?route=status");
  const fieldReply = deferred();
  ui.state.snapshot = validSnapshot();
  ui.native.call = async (method) => {
    if (method === "getEntityById") return fieldReply.promise;
    if (method === "snapshot") {
      return validSnapshot({
        activeContext: { chatId: "chat_a", actorId: "actor_b", groupId: null, actorName: "角色乙", truncated: false },
        selected: {
          actor: { characterId: "actor_b", name: "角色乙", avatarUri: null, avatarUriUnavailable: false, enabled: true, truncated: false },
          group: null,
        },
        contextLabels: { groupName: null, chatName: "角色乙的会话", truncated: false },
      });
    }
    throw new Error(`unexpected method ${method}`);
  };

  const pendingField = ui.getEntity("field", "field_a");
  await new Promise((resolve) => setImmediate(resolve));
  await ui.loadSnapshot({ actorId: "actor_b" });
  fieldReply.resolve(validFieldEntity({ currentValue: 4, scopeKey: "character:actor_a" }));

  await assert.rejects(pendingField, /MVU_ENTITY_CACHE_SUPERSEDED/);
  assert.equal(ui.state.entities.has("field:field_a"), false);
});

test("an old non-field response cannot repopulate a cache cleared by a revision refresh", async () => {
  const { ui } = createHarness("?route=status");
  const conditionReply = deferred();
  ui.state.snapshot = validSnapshot();
  ui.native.call = async (method) => {
    if (method === "getEntityById") return conditionReply.promise;
    if (method === "snapshot") return validSnapshot({ revision: 2 });
    throw new Error(`unexpected method ${method}`);
  };

  const pendingCondition = ui.getEntity("condition", "condition_a");
  await new Promise((resolve) => setImmediate(resolve));
  await ui.loadSnapshot();
  conditionReply.resolve(validConditionEntity());

  await assert.rejects(pendingCondition, /MVU_ENTITY_CACHE_SUPERSEDED/);
  assert.equal(ui.state.entities.has("condition:condition_a"), false);
});

test("a post-refresh entity lookup never deduplicates onto the pre-refresh native request", async () => {
  const { ui } = createHarness("?route=status");
  const staleReply = deferred();
  const freshEntity = validConditionEntity({ name: "刷新后的条件" });
  let entityCalls = 0;
  ui.state.snapshot = validSnapshot();
  ui.native.call = async (method) => {
    if (method === "getEntityById") {
      entityCalls += 1;
      return entityCalls === 1 ? staleReply.promise : freshEntity;
    }
    if (method === "snapshot") return validSnapshot({ revision: 2 });
    throw new Error(`unexpected method ${method}`);
  };

  const staleLookup = ui.getEntity("condition", "condition_a");
  await new Promise((resolve) => setImmediate(resolve));
  await ui.loadSnapshot();
  const freshLookup = ui.getEntity("condition", "condition_a");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(entityCalls, 2);
  assert.equal((await freshLookup).name, "刷新后的条件");
  staleReply.resolve(validConditionEntity({ name: "刷新前的条件" }));
  await assert.rejects(staleLookup, /MVU_ENTITY_CACHE_SUPERSEDED/);
  assert.equal(ui.state.entities.get("condition:condition_a").name, "刷新后的条件");
});

test("group mode immediately loads a group projection and group-member directory", async () => {
  const { context, ui } = createHarness();
  const requests = [];
  const groupSnapshot = validSnapshot({
    activeContext: { chatId: "chat_a", actorId: null, groupId: "group_b", actorName: "群组乙", truncated: false },
    selected: { actor: null, group: { characterGroupId: "group_b", name: "群组乙", avatarUri: null, avatarUriUnavailable: false, truncated: false } },
    contextLabels: { groupName: "群组乙", chatName: "群组乙的会话", truncated: false },
    pages: { ...validSnapshot().pages, fields: page([fieldSummary("group_field", 88)]) },
  });
  ui.native.call = async (method, payload) => {
    requests.push([method, payload]);
    if (method === "snapshot") return payload.groupId ? groupSnapshot : validSnapshot();
    if (method === "queryGroups") return page([{ characterGroupId: "group_b", name: "群组乙", avatarUri: null }]);
    if (method === "queryActors") return page([{ characterId: "member_b", name: "成员乙", enabled: true }]);
    return null;
  };
  vm.runInContext(appSource, context, { filename: "app.js" });
  await new Promise((resolve) => setImmediate(resolve));

  await ui.switchStatusMode("group");

  const groupRequest = requests.filter(([method]) => method === "snapshot").at(-1);
  assert.equal(groupRequest[0], "snapshot");
  assert.equal(groupRequest[1].groupId, "group_b");
  assert.equal(ui.state.snapshot.pages.fields.items[0].id, "group_field");
  assert.deepEqual(ui.state.directory.actors.map((actor) => actor.characterId), ["member_b"]);
});

test("initial group chat character mode scopes the actor directory to the active group", async () => {
  const { context, ui } = createHarness("?route=status");
  const requests = [];
  const initial = validSnapshot({
    activeContext: { chatId: "chat_a", actorId: "actor_a", groupId: "group_b", actorName: "角色甲", truncated: false },
    selected: {
      actor: { characterId: "actor_a", name: "角色甲", avatarUri: null, avatarUriUnavailable: false, enabled: true, truncated: false },
      group: { characterGroupId: "group_b", name: "群组乙", avatarUri: null, avatarUriUnavailable: false, truncated: false },
    },
    contextLabels: { groupName: "群组乙", chatName: "群组乙会话", truncated: false },
  });
  ui.native.call = async (method, payload) => {
    requests.push([method, payload]);
    if (method === "snapshot") return initial;
    if (method === "queryActors") return page([{ characterId: "actor_a", name: "角色甲", enabled: true }]);
    if (method === "queryGroups") return page([{ characterGroupId: "group_b", name: "群组乙" }]);
    return page([]);
  };

  vm.runInContext(appSource, context, { filename: "app.js" });
  await new Promise((resolve) => setImmediate(resolve));

  const actorRequest = requests.find(([method]) => method === "queryActors");
  assert.deepEqual({ ...actorRequest[1].filters }, { groupId: "group_b" });
});

test("initial character mode projects a group chat onto its first current member", async () => {
  const { context, ui } = createHarness("?route=status");
  const requests = [];
  const groupSnapshot = validSnapshot({
    activeContext: { chatId: "chat_a", actorId: null, groupId: "group_b", actorName: "群组乙", truncated: false },
    selected: { actor: null, group: { characterGroupId: "group_b", name: "群组乙", avatarUri: null, avatarUriUnavailable: false, truncated: false } },
    contextLabels: { groupName: "群组乙", chatName: "群组乙会话", truncated: false },
    pages: { ...validSnapshot().pages, fields: page([]) },
  });
  const actorSnapshot = validSnapshot({
    activeContext: { chatId: "chat_a", actorId: "member_b", groupId: "group_b", actorName: "成员乙", truncated: false },
    selected: {
      actor: { characterId: "member_b", name: "成员乙", avatarUri: null, avatarUriUnavailable: false, enabled: true, truncated: false },
      group: { characterGroupId: "group_b", name: "群组乙", avatarUri: null, avatarUriUnavailable: false, truncated: false },
    },
    contextLabels: { groupName: "群组乙", chatName: "成员乙会话", truncated: false },
  });
  ui.native.call = async (method, payload) => {
    requests.push([method, payload]);
    if (method === "snapshot") return payload.actorId === "member_b" ? actorSnapshot : groupSnapshot;
    if (method === "queryActors") return page([{ characterId: "member_b", name: "成员乙", avatarUri: null, enabled: true }]);
    if (method === "queryGroups") return page([{ characterGroupId: "group_b", name: "群组乙", avatarUri: null }]);
    return page([]);
  };

  vm.runInContext(appSource, context, { filename: "app.js" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const finalSnapshotRequest = requests.filter(([method]) => method === "snapshot").at(-1);
  assert.equal(finalSnapshotRequest[1].actorId, "member_b");
  assert.equal(ui.state.snapshot.activeContext.actorId, "member_b");
  assert.equal(ui.state.lastActorId, "member_b");
});

test("field detail and field management send the selected UI projection context", async () => {
  const { context, ui } = createHarness("?route=field-detail&field=field_a");
  const requests = [];
  const groupSnapshot = validSnapshot({
    activeContext: { chatId: "chat_a", actorId: null, groupId: "group_b", actorName: "群组乙", truncated: false },
    selected: { actor: null, group: { characterGroupId: "group_b", name: "群组乙", avatarUri: null, avatarUriUnavailable: false, truncated: false } },
    contextLabels: { groupName: "群组乙", chatName: "群组乙会话", truncated: false },
    pages: { ...validSnapshot().pages, fields: page([]) },
  });
  const actorSnapshot = validSnapshot({
    activeContext: { chatId: "chat_a", actorId: "member_b", groupId: "group_b", actorName: "成员乙", truncated: false },
    selected: {
      actor: { characterId: "member_b", name: "成员乙", avatarUri: null, avatarUriUnavailable: false, enabled: true, truncated: false },
      group: { characterGroupId: "group_b", name: "群组乙", avatarUri: null, avatarUriUnavailable: false, truncated: false },
    },
    contextLabels: { groupName: "群组乙", chatName: "成员乙会话", truncated: false },
  });
  ui.native.call = async (method, payload) => {
    requests.push([method, payload]);
    if (method === "snapshot") return payload.actorId === "member_b" ? actorSnapshot : groupSnapshot;
    if (method === "queryActors") return page([{ characterId: "member_b", name: "成员乙", avatarUri: null, enabled: true }]);
    if (method === "queryGroups") return page([{ characterGroupId: "group_b", name: "群组乙", avatarUri: null }]);
    if (method === "getEntityById") {
      if (payload.scopeContext?.actorId !== "member_b") {
        return validFieldEntity({
          bindingIds: ["member_b"], currentValue: null, currentStage: null,
          bindingDisplay: "成员乙", scopeKey: null,
        });
      }
      return validFieldEntity({
        bindingIds: ["member_b"], currentValue: 42,
        currentStage: { id: "low", name: "陌生", description: "尚不熟悉", threshold: 0 },
        bindingDisplay: "成员乙", scopeKey: "character:member_b",
      });
    }
    if (method === "queryRecords") return page([]);
    if (method === "queryFields") return page([validFieldEntity({
      bindingIds: ["member_b"], currentValue: 42, scopeKey: "character:member_b",
    })]);
    return page([]);
  };

  vm.runInContext(appSource, context, { filename: "app.js" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(ui.state.routeError, null);
  const fieldDetailRequest = requests.filter(([method]) => method === "getEntityById").at(-1);
  assert.deepEqual({ ...fieldDetailRequest[1].scopeContext }, {
    chatId: "chat_a", actorId: "member_b", groupId: "group_b", actorName: "成员乙",
  });

  await ui.navigate("config-fields", { force: true });
  const fieldListRequest = requests.filter(([method]) => method === "queryFields").at(-1);
  assert.deepEqual({ ...fieldListRequest[1].scopeContext }, {
    chatId: "chat_a", actorId: "member_b", groupId: "group_b", actorName: "成员乙",
  });
});

test("field detail finds a bound group member beyond the first directory page", async () => {
  const { context, ui } = createHarness("?route=field-detail&field=field_a");
  const requests = [];
  const groupSnapshot = validSnapshot({
    activeContext: { chatId: "chat_a", actorId: null, groupId: "group_b", actorName: "群组乙", truncated: false },
    selected: { actor: null, group: { characterGroupId: "group_b", name: "群组乙", avatarUri: null, avatarUriUnavailable: false, truncated: false } },
    contextLabels: { groupName: "群组乙", chatName: "群组乙会话", truncated: false },
    pages: { ...validSnapshot().pages, fields: page([]) },
  });
  const tailSnapshot = validSnapshot({
    activeContext: { chatId: "chat_a", actorId: "member_031", groupId: "group_b", actorName: "成员 031", truncated: false },
    selected: {
      actor: { characterId: "member_031", name: "成员 031", avatarUri: null, avatarUriUnavailable: false, enabled: true, truncated: false },
      group: { characterGroupId: "group_b", name: "群组乙", avatarUri: null, avatarUriUnavailable: false, truncated: false },
    },
    contextLabels: { groupName: "群组乙", chatName: "成员 031 会话", truncated: false },
  });
  ui.native.call = async (method, payload) => {
    requests.push([method, payload]);
    if (method === "snapshot") return payload.actorId === "member_031" ? tailSnapshot : groupSnapshot;
    if (method === "queryActors") {
      if (payload.filters?.fieldId === "field_a") {
        return page([{ characterId: "member_031", name: "成员 031", enabled: true }]);
      }
      return page(Array.from({ length: 30 }, (_value, index) => ({
        characterId: `member_${String(index).padStart(3, "0")}`,
        name: `成员 ${String(index).padStart(3, "0")}`,
        enabled: true,
      })));
    }
    if (method === "queryGroups") return page([{ characterGroupId: "group_b", name: "群组乙" }]);
    if (method === "getEntityById") {
      if (payload.scopeContext?.actorId === "member_031") {
        return validFieldEntity({ bindingIds: ["member_031"], currentValue: 42, scopeKey: "character:member_031" });
      }
      return validFieldEntity({ bindingIds: ["member_031"], currentValue: null, currentStage: null, scopeKey: null });
    }
    if (method === "queryRecords") return page([]);
    return page([]);
  };

  vm.runInContext(appSource, context, { filename: "app.js" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const filtered = requests.find(([method, payload]) =>
    method === "queryActors" && payload.filters?.fieldId === "field_a");
  assert.deepEqual({ ...filtered[1].filters }, { groupId: "group_b", fieldId: "field_a" });
  assert.equal(ui.state.snapshot.activeContext.actorId, "member_031");
  assert.equal(ui.state.routeError, null);
});

test("group to character with no valid history selects the first current-group member before rendering", async () => {
  const { context, ui } = createHarness();
  context.window.location.href = "https://mvu.local/app.html?route=status";
  context.window.location.search = "?route=status";
  const requests = [];
  const groupSnapshot = validSnapshot({
    activeContext: { chatId: "chat_a", actorId: null, groupId: "group_b", actorName: "群组乙", truncated: false },
    selected: { actor: null, group: { characterGroupId: "group_b", name: "群组乙", avatarUri: null, avatarUriUnavailable: false, truncated: false } },
    contextLabels: { groupName: "群组乙", chatName: "群组乙会话", truncated: false },
    pages: { ...validSnapshot().pages, fields: page([fieldSummary("group_field", 88)]) },
  });
  const actorSnapshot = validSnapshot({
    activeContext: { chatId: "chat_a", actorId: "member_b", groupId: "group_b", actorName: "成员乙", truncated: false },
    selected: {
      actor: { characterId: "member_b", name: "成员乙", avatarUri: null, avatarUriUnavailable: false, enabled: true, truncated: false },
      group: { characterGroupId: "group_b", name: "群组乙", avatarUri: null, avatarUriUnavailable: false, truncated: false },
    },
    contextLabels: { groupName: "群组乙", chatName: "成员乙会话", truncated: false },
    pages: { ...validSnapshot().pages, fields: page([fieldSummary("actor_field", 33)]) },
  });
  ui.native.call = async (method, payload) => {
    requests.push([method, payload]);
    if (method === "snapshot") return payload.actorId === "member_b" ? actorSnapshot : groupSnapshot;
    if (method === "queryActors") return page([{ characterId: "member_b", name: "成员乙", enabled: true }]);
    if (method === "queryGroups") return page([{ characterGroupId: "group_b", name: "群组乙" }]);
    return page([]);
  };
  vm.runInContext(appSource, context, { filename: "app.js" });
  await new Promise((resolve) => setImmediate(resolve));
  ui.state.lastActorId = "actor_from_another_group";

  await ui.switchStatusMode("character");

  const finalSnapshotRequest = requests.filter(([method]) => method === "snapshot").at(-1);
  assert.equal(finalSnapshotRequest[1].groupId, "group_b");
  assert.equal(finalSnapshotRequest[1].actorId, "member_b");
  assert.equal(ui.state.statusMode, "character");
  assert.equal(ui.state.snapshot.pages.fields.items[0].id, "actor_field");
  assert.notEqual(ui.state.snapshot.pages.fields.items[0].id, "group_field");
});

test("direct child back uses its owning root and never browser history", async () => {
  const { context, ui, historyCalls } = createHarness();
  ui.native.call = async (method) => method === "snapshot" ? validSnapshot() : page([]);
  vm.runInContext(appSource, context, { filename: "app.js" });
  await new Promise((resolve) => setImmediate(resolve));

  await ui.goBack();

  assert.equal(ui.state.route, "status");
  assert.deepEqual(historyCalls.filter(([kind]) => kind === "browser-back"), []);
});

test("snapshot and query validation rejects malformed items for every DTO kind", () => {
  const { ui } = createHarness();
  const cases = [
    ["rules", { ...validSnapshot().pages.rules.items[0], actionCount: "1" }],
    ["conditions", { ...validSnapshot().pages.conditions.items[0], rootKind: "unknown" }],
    ["effectGroups", { ...validSnapshot().pages.effectGroups.items[0], fieldCount: -1 }],
    ["records", { ...validSnapshot().pages.records.items[0], occurredAt: "today" }],
  ];
  for (const [kind, malformed] of cases) {
    const snapshot = validSnapshot();
    snapshot.pages[kind] = page([malformed]);
    assert.throws(() => ui.validateCompactSnapshot(snapshot), /INVALID/, kind);
  }
  assert.throws(() => ui.validateQueryResponse(page([{ characterId: 7 }]), "actors"), /INVALID/);
  assert.throws(() => ui.validateQueryResponse(page([{ characterGroupId: 7 }]), "groups"), /INVALID/);
});

test("deep DTO validation rejects malformed nested entities and required record fields", () => {
  const { ui } = createHarness();
  const malformed = [
    ["fields", validFieldEntity({ stages: [null] })],
    ["rules", validRuleEntity({ actions: [null] })],
    ["conditions", validConditionEntity({ expression: {} })],
    ["effectGroups", validEffectEntity({ fieldEffects: [null] })],
    ["records", { ...validSnapshot().pages.records.items[0], actorName: undefined }],
    ["actors", { characterId: "actor_a", name: "角色甲" }],
    ["groups", { characterGroupId: "group_a", name: 7 }],
  ];
  for (const [kind, entity] of malformed) {
    assert.throws(() => ui.validateQueryResponse(page([entity]), kind), /INVALID/, kind);
  }

  let expression = { kind: "predicate", predicate: { kind: "user_care" } };
  for (let index = 0; index < 14; index += 1) expression = { kind: "not", child: expression };
  assert.throws(() => ui.validateQueryResponse(page([validConditionEntity({ expression })]), "conditions"), /DEPTH|INVALID/);
});

test("getEntity validates the requested kind and malformed route entities enter recovery", async () => {
  const { ui } = createHarness();
  ui.native.call = async (method, payload) => {
    if (method !== "getEntityById") return page([]);
    if (payload.entityType === "field") return validRuleEntity({ id: payload.id });
    return validRuleEntity({ id: payload.id, actions: [null] });
  };

  await assert.rejects(ui.getEntity("field", "field_a"), /FIELD|ENTITY.*INVALID/);
  ui.state.selectedEntityId = "rule_a";
  await ui.loadRouteData("rule-editor");
  assert.equal(ui.state.routeError.title, "页面数据有误");
  assert.equal(ui.state.entities.has("rule:rule_a"), false);
});

test("malformed nested NativeMvu payloads fail closed into route recovery", async () => {
  const entityCases = [
    ["field-editor", "field", validFieldEntity({ stages: [null] })],
    ["rule-editor", "rule", validRuleEntity({ actions: [null] })],
    ["condition-editor", "condition", validConditionEntity({ expression: {} })],
    ["effect-editor", "effectGroup", validEffectEntity({ fieldEffects: [null] })],
  ];
  for (const [route, entityType, malformed] of entityCases) {
    const { ui } = createHarness();
    ui.state.selectedEntityId = malformed.id;
    ui.native.call = async (method, payload) => {
      if (method === "getEntityById") {
        assert.equal(payload.entityType, entityType);
        return malformed;
      }
      return page([]);
    };
    await ui.loadRouteData(route);
    assert.equal(ui.state.routeError.title, "页面数据有误", route);
    assert.equal(ui.state.entities.has(entityType + ":" + malformed.id), false, route);
  }

  const { ui } = createHarness();
  ui.state.snapshot = validSnapshot();
  ui.state.selectedFieldId = "field_a";
  ui.native.call = async (method) => {
    if (method === "getEntityById") return validFieldEntity();
    if (method === "queryRecords") {
      return page([{ ...validSnapshot().pages.records.items[0], actorName: undefined }]);
    }
    return page([]);
  };
  await ui.loadRouteData("field-detail");
  assert.equal(ui.state.routeError.title, "页面数据有误");
  assert.equal(ui.state.detailRecords, null);

  for (const malformedKind of ["actors", "groups"]) {
    const directoryHarness = createHarness();
    directoryHarness.ui.state.snapshot = validSnapshot();
    directoryHarness.ui.native.call = async (method) => {
      if (method === "queryActors") {
        return malformedKind === "actors"
          ? page([{ characterId: "actor_a", name: "角色甲" }])
          : page([{ characterId: "actor_a", name: "角色甲", enabled: true }]);
      }
      if (method === "queryGroups") {
        return malformedKind === "groups"
          ? page([{ characterGroupId: "group_a", name: 7 }])
          : page([{ characterGroupId: "group_a", name: "群组甲" }]);
      }
      return page([]);
    };
    await directoryHarness.ui.loadRouteData("status");
    assert.equal(directoryHarness.ui.state.routeError.title, "页面数据有误", malformedKind);
    assert.equal(directoryHarness.ui.state.directory.actors.length, 0, malformedKind);
    assert.equal(directoryHarness.ui.state.directory.groups.length, 0, malformedKind);
  }
});

test("demo snapshot obeys the same validated DTO contracts as the host", async () => {
  const { ui } = createHarness();
  ui.state.demo = true;

  const snapshot = await ui.native.call("snapshot", {});

  assert.doesNotThrow(() => ui.validateCompactSnapshot(snapshot));
});

test("demo snapshot and actor directory honor requested actor and group projection", async () => {
  const { ui } = createHarness();
  ui.state.demo = true;

  const actor = await ui.native.call("snapshot", { groupId: "group-a", actorId: "operit" });
  const otherActor = await ui.native.call("snapshot", { groupId: "group-a", actorId: "bob" });
  const group = await ui.native.call("snapshot", { groupId: "group-b" });
  const members = await ui.native.call("queryActors", { filters: { groupId: "group-b" } });

  assert.equal(actor.activeContext.actorId, "operit");
  assert.equal(otherActor.activeContext.actorId, "bob");
  assert.equal(group.activeContext.actorId, null);
  assert.equal(group.activeContext.groupId, "group-b");
  assert.notEqual(actor.pages.fields.items[0].current.value, otherActor.pages.fields.items[0].current.value);
  assert.notEqual(otherActor.pages.fields.items[0].current.value, group.pages.fields.items[0].current.value);
  assert.equal(members.totalCount, 49);
  assert.equal(members.loadedCount, 30);
  assert.equal(members.items[0].characterId, "bob");
  assert.equal(members.items.some((member) => member.characterId === "picker-actor-058"), true);
  assert.equal(members.items.some((member) => member.characterId === "picker-actor-001"), false);
});

test("demo context and detail lookup accept picker actors and groups beyond the compact directory", async () => {
  const { ui } = createHarness("?demo=1");
  ui.state.demo = true;

  const actor = await ui.native.call("snapshot", { groupId: "group-a", actorId: "picker-actor-043" });
  const group = await ui.native.call("snapshot", { groupId: "picker-group-044" });
  const actorDetail = await ui.native.call("getEntityById", { entityType: "actor", id: "picker-actor-043" });
  const groupDetail = await ui.native.call("getEntityById", { entityType: "group", id: "picker-group-044" });

  assert.equal(actor.activeContext.actorId, "picker-actor-043");
  assert.equal(actor.selected.actor.name, "游标角色 043");
  assert.equal(group.activeContext.groupId, "picker-group-044");
  assert.equal(group.selected.group.name, "游标群组 044");
  assert.equal(actorDetail.characterId, "picker-actor-043");
  assert.equal(groupDetail.characterGroupId, "picker-group-044");
});

test("demo group actor directory and status picker share the complete authoritative member set", async () => {
  const { ui } = createHarness("?demo=1");
  ui.state.demo = true;

  const directory = await ui.native.call("queryActors", { filters: { groupId: "group-a" } });
  const picker = await ui.native.call("queryActors", { filters: { groupId: "group-a" } });
  const tail = await ui.native.call("queryActors", {
    filters: { groupId: "group-a" },
    cursor: picker.nextCursor,
  });
  const ids = [...picker.items, ...tail.items].map((actor) => actor.characterId);

  assert.equal(directory.totalCount, 50);
  assert.equal(directory.loadedCount, 30);
  assert.equal(picker.totalCount, 50);
  assert.equal(ids.includes("picker-actor-077"), true);
  assert.equal(ids.includes("picker-actor-002"), false);
});

test("demo group directory and picker share one authoritative high-cardinality member set", async () => {
  const { ui } = createHarness();
  ui.state.demo = true;
  await ui.loadSnapshot({ groupId: "group-a", actorId: "operit" });
  await ui.loadDirectory("group-a");

  assert.equal(ui.state.directory.actorTotal, 50);
  assert.equal(ui.state.directory.actors.length, 30);
  await ui.openEntityPicker({
    entity: "actors",
    mode: "single",
    filters: { groupId: "group-a" },
    lockedFilterKeys: ["groupId"],
  });
  assert.equal(ui.state.entityPicker.totalCount, 50);
  await ui.fetchNextEntityPickerPage();
  assert.equal(ui.state.entityPicker.orderIds.length, 50);
  assert.equal(ui.state.entityPicker.itemById.has("picker-actor-061"), true);
  assert.equal(ui.state.entityPicker.itemById.has("picker-actor-002"), false);
});

test("range validation disables unchanged input and previews proportional mapping", async () => {
  const { context, ui } = createHarness();
  ui.native.call = async (method) => method === "snapshot" ? validSnapshot() : page([]);
  vm.runInContext(appSource, context, { filename: "app.js" });
  await new Promise((resolve) => setImmediate(resolve));
  const field = {
    minimum: 0, maximum: 100, step: 1, initialValue: 10,
    stages: [{ threshold: 0 }, { threshold: 20 }, { threshold: 50 }, { threshold: 80 }],
  };

  assert.deepEqual({ ...ui.validateFieldRangeDraft(field, { minimum: 0, maximum: 100 }, 48) }, {
    changed: false, error: "", previewValue: 48, mappedStep: 1,
  });
  assert.deepEqual({ ...ui.validateFieldRangeDraft(field, { minimum: -100, maximum: 100 }, 48) }, {
    changed: true, error: "", previewValue: -4, mappedStep: 2,
  });
  assert.match(ui.validateFieldRangeDraft(field, { minimum: 1e15, maximum: 1e15 + 1 }, 48).error, /精度|跨度/);
});

test("empty and whitespace range inputs are invalid before numeric coercion", async () => {
  const { context, ui, elements } = createHarness();
  ui.native.call = async (method) => method === "snapshot" ? validSnapshot() : page([]);
  vm.runInContext(appSource, context, { filename: "app.js" });
  await new Promise((resolve) => setImmediate(resolve));
  const field = validFieldEntity();

  for (const minimum of ["", "   ", "\t\n"]) {
    const result = ui.validateFieldRangeDraft(field, { minimum, maximum: "100" }, 48);
    assert.match(result.error, /有效|上下限/);
    assert.equal(result.previewValue, null);
  }

  ui.state.entities.set("field:field_a", field);
  ui.state.snapshot = validSnapshot();
  const card = new context.Element();
  card.dataset = { rangeCard: "field_a" };
  const minimumInput = { value: "   " };
  const maximumInput = { value: "100" };
  const errorNode = { textContent: "" };
  const saveButton = { disabled: false };
  const previewNode = { textContent: "" };
  card.querySelector = (selector) => ({
    '[data-range-number="minimum"]': minimumInput,
    '[data-range-number="maximum"]': maximumInput,
    "[data-range-error]": errorNode,
    '[data-action="save-field-range"]': saveButton,
    "[data-range-preview]": previewNode,
  })[selector] || null;
  const input = new context.Element();
  input.closest = (selector) => selector === "[data-range-number]" ? input :
    selector === "[data-range-card]" ? card : null;
  elements.get("appRoot").listeners.get("input")({ target: input });

  assert.match(errorNode.textContent, /有效|上下限/);
  assert.equal(saveButton.disabled, true);
  assert.equal(previewNode.textContent, "换算后 —");
});

test("reduced motion removes spatial motion without blanket 0.01ms overrides", () => {
  const start = stylesSource.search(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.ok(start >= 0);
  const reduced = stylesSource.slice(start);
  assert.doesNotMatch(reduced, /\*,\s*\*::before|\*::after/);
  assert.doesNotMatch(reduced, /0\.01ms/);
  assert.match(reduced, /::view-transition-(?:group|old|new)[^{]*\{[^}]*animation:\s*none/);
  assert.match(reduced, /\.drawer[^}]*\{[^}]*animation:\s*none/);
  assert.match(runtimeSource, /prefers-reduced-motion:\s*reduce[\s\S]*?update\(\)/);
});

test("text typography stays on the Android default stack and custom fonts remain icon-only", () => {
  const textStack = 'Roboto, "Noto Sans SC", system-ui, sans-serif';
  const fontFaces = Array.from(stylesSource.matchAll(/@font-face\s*\{[^}]*\}/g), (match) => match[0]);
  assert.equal(fontFaces.length, 1);
  assert.match(fontFaces[0], /font-family:\s*"Material Symbols Rounded"/);
  assert.doesNotMatch(stylesSource, /@import\s+url\([^)]*(?:font|google)/i);

  const familyValues = Array.from(stylesSource.matchAll(/font-family:\s*([^;]+);/g), (match) => match[1].trim());
  assert.deepEqual(familyValues, ["\"Material Symbols Rounded\"", textStack, "\"Material Symbols Rounded\""]);
  const bodyBlock = stylesSource.match(/\nbody\s*\{([^}]*)\}/)[1];
  assert.match(bodyBlock, /font-size:\s*var\(--type-body\)/);
  assert.match(bodyBlock, /line-height:\s*1\.5/);
  assert.doesNotMatch(bodyBlock, /Segoe UI|-apple-system/);
  assert.match(stylesSource, /button, input, textarea, select\s*\{[^}]*font:\s*inherit/);
});

test("build reports the actual UTF-8 byte length", async () => {
  const root = new URL("..", import.meta.url);
  const { stdout } = await execFileAsync(process.execPath, ["scripts/build-web.mjs"], { cwd: root });
  const match = stdout.match(/\((\d+) bytes\)/);
  assert.ok(match, stdout);
  const output = await stat(new URL("../dist/app.html", import.meta.url));
  assert.equal(Number(match[1]), output.size);
});

test("stage names dots and thresholds share exact normalized positions for arbitrary counts", () => {
  const { context, ui } = createHarness();
  vm.runInContext(componentsSource, context, { filename: "components.js" });
  const field = {
    minimum: 0, maximum: 100, themeColor: "#7058d8",
    stages: [
      { id: "low", name: "低", threshold: 0 },
      { id: "mid", name: "中", threshold: 10 },
      { id: "high", name: "高", threshold: 90 },
    ],
  };

  const html = ui.components.stageStrip(field, 12, ui.components.stagePalette(field));

  assert.match(html, /class="stage-marker edge-start" style="--stage-position:0%/);
  assert.match(html, /class="stage-marker active" style="--stage-position:10%/);
  assert.match(html, /class="stage-marker edge-end" style="--stage-position:90%/);
  assert.doesNotMatch(stylesSource, /\.stage-marker\.edge-(?:start|end)[^{]*\{[^}]*transform:/);
  assert.match(stylesSource, /\.stage-map\s*\{[^}]*margin:\s*calc\(24px \+ var\(--stage-extra-height, 0px\)\) 7px 0;/);
  assert.match(stylesSource, /\.stage-marker\s+\.stage-name\s*\{[^}]*--stage-lane-offset/);
  assert.deepEqual(Array.from(html.matchAll(/data-stage-lane="(\d)"/g), (match) => match[1]), ["0", "1", "0"]);

  const balanced = ui.components.stageStrip({
    ...field,
    stages: [
      { id: "a", name: "陌生", threshold: 0 },
      { id: "b", name: "熟悉", threshold: 20 },
      { id: "c", name: "亲密", threshold: 50 },
      { id: "d", name: "依赖", threshold: 80 },
    ],
  }, 48, ["#8a8fe0", "#5b91ff", "#d45fe2", "#ff4f88"]);
  assert.deepEqual(Array.from(balanced.matchAll(/data-stage-lane="(\d)"/g), (match) => match[1]), ["0", "0", "0", "0"],
    "well-spaced stage labels should share one visual baseline");
  context.window.innerWidth = 393;
  context.document.body = {};
  context.window.getComputedStyle = () => ({ fontSize: "18.2px" });
  const scaled = ui.components.stageStrip({
    ...field,
    stages: [
      { id: "scaled-a", name: "第一阶段", threshold: 20 },
      { id: "scaled-b", name: "第二阶段", threshold: 36 },
    ],
  }, 24, ["#8a8fe0", "#5b91ff"]);
  assert.deepEqual(Array.from(scaled.matchAll(/data-stage-lane="(\d)"/g), (match) => match[1]), ["0", "1"],
    "130% text scale must widen collision estimates before assigning lanes");
  const dense = ui.components.stageStrip({
    ...field,
    stages: [
      { id: "dense-a", name: "第一阶段", threshold: 0 },
      { id: "dense-b", name: "第二阶段", threshold: 4 },
      { id: "dense-c", name: "第三阶段", threshold: 8 },
    ],
  }, 4, ["#8a8fe0", "#5b91ff", "#d45fe2"]);
  assert.deepEqual(Array.from(dense.matchAll(/data-stage-lane="(\d)"/g), (match) => match[1]), ["0", "1", "2"],
    "three dense stages must receive three independent text lanes");
  assert.match(dense, /--stage-extra-height:36px/);
  assert.match(stylesSource, /\.stage-marker\s+\.stage-threshold\s*\{[^}]*translateY\(var\(--stage-lane-offset(?:,\s*0px)?\)\)/,
    "threshold labels must move with the collision lane as well as stage names");
  assert.match(stylesSource, /\.field-detail-stack\s*\{[^}]*gap:\s*16px;/,
    "stage and trend cards should use the same primary spacing rhythm as the rest of the detail page");
});

test("field detail requests bounded records for its field and exact scope", async () => {
  const { ui } = createHarness();
  const calls = [];
  ui.state.snapshot = validSnapshot();
  ui.state.selectedFieldId = "field_a";
  ui.native.call = async (method, payload) => {
    calls.push([method, payload]);
    if (method === "getEntityById") return validFieldEntity();
    if (method === "queryRecords") return page([]);
    return page([]);
  };

  await ui.loadRouteData("field-detail");

  const request = calls.find(([method]) => method === "queryRecords")[1];
  assert.equal(request.page, 1);
  assert.equal(request.filters.fieldId, "field_a");
  assert.equal(request.filters.scopeKey, "character:actor_a");
});

test("segmented tabs have unique transitions, owned panels, and roving tabindex", () => {
  const { context, ui } = createHarness();
  vm.runInContext(componentsSource, context, { filename: "components.js" });

  const status = ui.components.segmented([{ id: "character", label: "角色" }, { id: "group", label: "群组" }], "character", "data-mode", "状态范围");
  const reason = ui.components.segmented([{ id: "template", label: "模板" }, { id: "custom", label: "自定义" }], "custom", "data-reason", "原因模式");

  assert.match(status, /aria-controls="segment-panel-status-scope"/);
  assert.match(status, /tabindex="0"[^>]*data-mode="character"/);
  assert.match(status, /tabindex="-1"[^>]*data-mode="group"/);
  assert.match(status, /--segment-transition:segment-status-scope/);
  assert.match(reason, /--segment-transition:segment-reason-mode/);
  assert.doesNotMatch(status + reason, /view-transition-name:segmented-selection/);
});

test("segmented keyboard activation restores focus and reason tabs switch content", () => {
  assert.match(appSource, /pendingSegmentFocusId\s*=\s*nextTab\.id/);
  assert.match(appSource, /getElementById\(pendingSegmentFocusId\)/);
  assert.match(appSource, /data-reason-mode/);
  assert.match(rulesSource, /draft\.reason\.mode/);
  assert.match(rulesSource, /自定义原因内容/);
});

test("avatar rendering rejects executable URI schemes", () => {
  const { context, ui } = createHarness();
  vm.runInContext(componentsSource, context, { filename: "components.js" });

  const unsafe = ui.components.actorSelector([{ characterId: "a", name: "甲", enabled: true, avatarUri: "javascript:alert(1)" }], "a");
  const safe = ui.components.actorSelector([{ characterId: "b", name: "乙", enabled: true, avatarUri: "content://avatars/b" }], "b");

  assert.doesNotMatch(unsafe, /<img/);
  assert.match(safe, /<img src="content:\/\/avatars\/b"/);
});

test("demo management queries enforce 5/5/10/10/10 pages with real search and totals", async () => {
  const { ui } = createHarness();
  ui.state.demo = true;

  const fields = await ui.query("queryFields", { page: 2, search: "演示字段" });
  const rules = await ui.query("queryRules", { page: 2, search: "演示规则" });
  const conditions = await ui.query("queryConditions", { page: 2, search: "演示条件" });
  const effects = await ui.query("queryEffectGroups", { page: 2, search: "演示效果" });
  const records = await ui.query("queryRecords", { page: 2 });

  assert.deepEqual(
    [fields.loadedCount, rules.loadedCount, conditions.loadedCount, effects.loadedCount, records.loadedCount],
    [5, 5, 10, 10, 10],
  );
  assert.deepEqual(
    [fields.totalCount, rules.totalCount, conditions.totalCount, effects.totalCount, records.totalCount],
    [12, 12, 23, 23, 24],
  );
  assert.equal(Array.from(fields.items, (field) => field.name).join("|"),
    "演示字段 06|演示字段 07|演示字段 08|演示字段 09|演示字段 10");
  assert.equal(fields.hasMore, true);
  assert.equal(records.hasMore, true);

  const tails = await Promise.all([
    ui.query("queryFields", { page: 3, search: "演示字段" }),
    ui.query("queryRules", { page: 3, search: "演示规则" }),
    ui.query("queryConditions", { page: 3, search: "演示条件" }),
    ui.query("queryEffectGroups", { page: 3, search: "演示效果" }),
    ui.query("queryRecords", { page: 3 }),
  ]);
  assert.deepEqual(Array.from(tails, (tail) => tail.loadedCount), [2, 2, 3, 3, 4]);
  assert.deepEqual(Array.from(tails, (tail) => tail.hasMore), [false, false, false, false, false]);
  assert.equal(tails.every((tail) => tail.nextCursor === null), true);
  assert.equal(tails[0].items[0].currentValue, 52);
  assert.equal(tails[0].items[0].bindingDisplay, "Operit");
});

test("management route loading sends page search filter and sort to the owning query", async () => {
  const { ui } = createHarness();
  const requests = [];
  ui.state.snapshot = validSnapshot();
  ui.state.pages = { ...ui.state.snapshot.pages };
  ui.state.listViews.rules = {
    page: 3,
    search: "关心",
    filters: { enabled: true },
    sort: { key: "updatedAt", direction: "desc" },
  };
  ui.native.call = async (method, request) => {
    requests.push([method, request]);
    return page([]);
  };

  await ui.loadRouteData("rule-library");

  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [["queryRules", {
    page: 3,
    search: "关心",
    filters: { enabled: true },
    sort: { key: "updatedAt", direction: "desc" },
  }]]);
});

test("field page two renders its projected value and detail lookup does not depend on snapshot page one", async () => {
  const { context, ui } = createHarness();
  vm.runInContext(componentsSource, context, { filename: "components.js" });
  vm.runInContext(configSource, context, { filename: "pages-config.js" });
  vm.runInContext(statusSource, context, { filename: "pages-status.js" });
  ui.state.snapshot = validSnapshot({ counts: { ...validSnapshot().counts, fields: 12 } });
  ui.state.pages = { ...ui.state.snapshot.pages };
  ui.state.listViews.fields.page = 2;
  const projected = validFieldEntity({
    id: "field_page_2",
    name: "第二页真实字段",
    initialValue: 10,
    currentValue: 77,
    currentStage: { id: "close", name: "亲密", description: "真实阶段", threshold: 70 },
    bindingDisplay: "角色乙",
    scopeKey: "character:actor_b",
    bindingIds: ["actor_b"],
    order: 5,
  });
  const requests = [];
  ui.native.call = async (method, request) => {
    requests.push([method, request]);
    if (method === "queryFields") return { items: [projected], loadedCount: 1, totalCount: 12, hasMore: true, nextCursor: null };
    if (method === "getEntityById") return projected;
    if (method === "queryRecords") return page([]);
    throw new Error(`unexpected ${method}`);
  };

  await ui.loadRouteData("config-fields");
  const pageTwoHtml = ui.pages.fields();
  assert.equal(pageTwoHtml.includes("第二页真实字段"), true);
  assert.equal(pageTwoHtml.includes("当前值</dt><dd>77"), true);
  assert.equal(pageTwoHtml.includes("角色乙"), true);

  ui.state.selectedFieldId = "field_page_2";
  await ui.loadRouteData("field-detail");
  const detailHtml = ui.pages.fieldDetail();
  assert.equal(detailHtml.includes("<strong>77</strong>"), true);
  const recordRequest = requests.find(([method]) => method === "queryRecords")[1];
  assert.deepEqual(JSON.parse(JSON.stringify(recordRequest.filters)), {
    fieldId: "field_page_2",
    scopeKey: "character:actor_b",
  });
});

test("query validation rejects method oversize and cursor misuse and blocks automatic retry loops", async () => {
  const { ui } = createHarness();
  const actor = (index) => ({ characterId: `actor_${index}`, name: `角色 ${index}`, avatarUri: null, enabled: true });
  const ceilings = [
    ["queryFields", 5, () => validFieldEntity()],
    ["queryActors", 30, actor],
    ["queryGroups", 30, (index) => ({ characterGroupId: `group_${index}`, name: `群组 ${index}`, avatarUri: null })],
    ["queryRules", 5, () => validRuleEntity()],
    ["queryConditions", 10, () => validConditionEntity()],
    ["queryEffectGroups", 10, () => validEffectEntity()],
    ["queryRecords", 10, (index) => ({ ...validSnapshot().pages.records.items[0], id: `record_${index}` })],
  ];
  ceilings.forEach(([method, ceiling, factory]) => {
    assert.throws(() => ui.validateQueryResponse({
      items: Array.from({ length: ceiling + 1 }, (_value, index) => factory(index)),
      loadedCount: ceiling + 1,
      totalCount: ceiling + 1,
      hasMore: false,
      nextCursor: null,
    }, method, method === "queryActors" || method === "queryGroups" ? {} : { page: 1 }), /MVU_QUERY_RESPONSE_INVALID/, method);
  });
  assert.throws(() => ui.validateQueryResponse({
    items: Array.from({ length: 31 }, (_value, index) => actor(index)),
    loadedCount: 31,
    totalCount: 31,
    hasMore: false,
    nextCursor: null,
  }, "queryActors", {}), /MVU_QUERY_RESPONSE_INVALID/);
  assert.throws(() => ui.validateQueryResponse({
    items: [actor(1)], loadedCount: 1, totalCount: 1, hasMore: false, nextCursor: "cursor_after_end",
  }, "queryActors", {}), /MVU_QUERY_RESPONSE_INVALID/);
  assert.throws(() => ui.validateQueryResponse({
    items: [actor(1)], loadedCount: 1, totalCount: 2, hasMore: false, nextCursor: null,
  }, "queryActors", {}, { loadedCount: 0, seenCursors: new Set() }), /MVU_QUERY_RESPONSE_INVALID/);
  assert.throws(() => ui.validateQueryResponse({
    items: [actor(1)], loadedCount: 1, totalCount: 4, hasMore: true, nextCursor: "cursor_2",
  }, "queryActors", { cursor: "cursor_1" }, {
    loadedCount: 1, expectedTotal: 3, seenCursors: new Set(["cursor_1"]),
  }), /MVU_QUERY_RESPONSE_INVALID/);
  let calls = 0;
  ui.native.call = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        items: Array.from({ length: 30 }, (_value, index) => actor(index)),
        loadedCount: 30,
        totalCount: 90,
        hasMore: true,
        nextCursor: "cursor_1",
      };
    }
    return {
      items: Array.from({ length: 30 }, (_value, index) => actor(index + 30)),
      loadedCount: 30,
      totalCount: 90,
      hasMore: true,
      nextCursor: "cursor_1",
    };
  };

  await ui.openEntityPicker({ entity: "actors", mode: "multiple" });
  await ui.fetchNextEntityPickerPage();
  assert.match(ui.state.entityPicker.error, /重试/);
  assert.equal(ui.state.entityPicker.autoFetchBlocked, true);
  assert.equal(await ui.fetchNextEntityPickerPage(), false);
  assert.equal(calls, 2);
});

test("query validation accepts safe huge totals and rejects negative or unsafe totals", () => {
  const { ui } = createHarness();
  const actorItems = Array.from({ length: 30 }, (_value, index) => ({
    characterId: `actor_${index}`,
    name: `角色 ${index}`,
    avatarUri: null,
    enabled: true,
  }));
  const recordItems = Array.from({ length: 10 }, (_value, index) => ({
    ...validSnapshot().pages.records.items[0],
    id: `record_${index}`,
  }));

  assert.doesNotThrow(() => ui.validateQueryResponse({
    items: actorItems, loadedCount: 30, totalCount: 100_000, hasMore: true, nextCursor: "actor_tail",
  }, "queryActors", {}));
  assert.doesNotThrow(() => ui.validateQueryResponse({
    items: recordItems, loadedCount: 10, totalCount: 100_000, hasMore: true, nextCursor: null,
  }, "queryRecords", { page: 1 }));
  assert.doesNotThrow(() => ui.validateQueryResponse({
    items: recordItems, loadedCount: 10, totalCount: Number.MAX_SAFE_INTEGER, hasMore: true, nextCursor: null,
  }, "queryRecords", { page: 1 }));
  for (const totalCount of [-1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => ui.validateQueryResponse({
      items: [], loadedCount: 0, totalCount, hasMore: false, nextCursor: null,
    }, "queryRecords", { page: 1 }), /MVU_QUERY_RESPONSE_INVALID/);
  }
});

test("picker discards stale search responses and keeps the latest query results", async () => {
  const { ui } = createHarness();
  const oldResponse = deferred();
  const newResponse = deferred();
  ui.native.call = async (_method, request) => {
    if (request.search === "旧") return oldResponse.promise;
    if (request.search === "新") return newResponse.promise;
    return page([]);
  };

  await ui.openEntityPicker({ entity: "actors", mode: "single", title: "选择角色" });
  ui.searchEntityPicker("旧");
  await wait(190);
  ui.searchEntityPicker("新");
  await wait(190);
  newResponse.resolve(page([{ characterId: "new", name: "新角色", avatarUri: null, enabled: true }]));
  await wait(0);
  oldResponse.resolve(page([{ characterId: "old", name: "旧角色", avatarUri: null, enabled: true }]));
  await wait(0);

  assert.equal(ui.state.entityPicker.search, "新");
  assert.deepEqual(Array.from(ui.state.entityPicker.items, (item) => item.characterId), ["new"]);
});

test("picker auto-cursor stays bounded and preserves multi-selection through failure", async () => {
  const { ui } = createHarness();
  let batch = 0;
  ui.native.call = async (_method, request) => {
    if (request.search === "失败") throw new Error("offline");
    const start = batch * 30;
    batch += 1;
    return {
      items: Array.from({ length: 30 }, (_value, index) => ({
        characterId: `actor_${start + index}`,
        name: `角色 ${start + index}`,
        avatarUri: null,
        enabled: true,
      })),
      loadedCount: 30,
      totalCount: 90,
      hasMore: batch < 3,
      nextCursor: batch < 3 ? `cursor_${batch}` : null,
    };
  };

  await ui.openEntityPicker({ entity: "actors", mode: "multiple", selectedIds: ["actor_0"] });
  ui.toggleEntityPickerSelection("actor_1");
  await ui.fetchNextEntityPickerPage();
  await ui.fetchNextEntityPickerPage();
  assert.equal(ui.state.entityPicker.items.length, 90);
  assert.deepEqual(Array.from(ui.state.entityPicker.selectedIds), ["actor_0", "actor_1"]);

  ui.searchEntityPicker("失败");
  await wait(190);
  await wait(0);
  assert.match(ui.state.entityPicker.error, /重试/);
  assert.equal(ui.state.entityPicker.search, "失败");
  assert.deepEqual(Array.from(ui.state.entityPicker.selectedIds), ["actor_0", "actor_1"]);
});

test("picker virtual window retains deduped cursor pages, excludes pins, and back-scrolls to the first page", async () => {
  const { context, ui } = createHarness();
  vm.runInContext(componentsSource, context, { filename: "components.js" });
  let batch = 0;
  ui.native.call = async () => {
    const starts = [0, 29, 59];
    const start = starts[batch];
    batch += 1;
    return {
      items: Array.from({ length: 30 }, (_value, index) => ({
        characterId: `actor_${start + index}`,
        name: `角色 ${start + index}`,
        avatarUri: null,
        enabled: true,
      })),
      loadedCount: 30,
      totalCount: 89,
      hasMore: batch < 3,
      nextCursor: batch < 3 ? `cursor_${batch}` : null,
    };
  };

  await ui.openEntityPicker({ entity: "actors", mode: "multiple", selectedIds: ["actor_0"] });
  await ui.fetchNextEntityPickerPage();
  await ui.fetchNextEntityPickerPage();

  assert.equal(ui.state.entityPicker.orderIds.length, 89);
  assert.equal(ui.state.entityPicker.itemById.size, 89);
  assert.equal(ui.state.entityPicker.orderIds.filter((id) => id === "actor_29").length, 1);

  ui.updateEntityPickerViewport(60 * 56, 280);
  const deepHtml = ui.components.renderEntityPicker(ui.state.entityPicker);
  assert.ok((deepHtml.match(/class="picker-result /g) || []).length <= 18);
  assert.match(deepHtml, /data-picker-spacer="before"/);
  assert.match(deepHtml, /data-picker-id="actor_60"/);
  assert.doesNotMatch(deepHtml, /class="picker-result [^"]*"[^>]*data-picker-id="actor_0"/);

  ui.updateEntityPickerViewport(0, 280);
  const firstHtml = ui.components.renderEntityPicker(ui.state.entityPicker);
  assert.match(firstHtml, /data-picker-id="actor_1"/);
  assert.doesNotMatch(firstHtml, /data-picker-id="actor_60"/);
});

test("picker accepts huge first pages and huge narrowed-search totals", async () => {
  const { ui } = createHarness();
  let calls = 0;
  ui.native.call = async (_method, request) => {
    calls += 1;
    return {
      items: Array.from({ length: 30 }, (_value, index) => ({
        characterId: `${request.search || "all"}_actor_${index}`,
        name: `角色 ${index}`,
        avatarUri: null,
        enabled: true,
      })),
      loadedCount: 30,
      totalCount: request.search ? 3_841 : 100_000,
      hasMore: true,
      nextCursor: "cursor_1",
    };
  };

  await ui.openEntityPicker({ entity: "actors", mode: "multiple" });

  assert.equal(ui.state.entityPicker.totalCount, 100_000);
  assert.equal(ui.state.entityPicker.orderIds.length, 30);
  assert.equal(ui.state.entityPicker.error, "");

  ui.searchEntityPicker("窄搜索");
  await wait(190);
  await wait(0);

  assert.equal(ui.state.entityPicker.totalCount, 3_841);
  assert.equal(ui.state.entityPicker.orderIds.length, 30);
  assert.equal(ui.state.entityPicker.error, "");
  assert.equal(calls, 2);
});

test("picker pauses before its retained-page cap without discarding rows or offering a destructive retry", async () => {
  const { context, ui } = createHarness();
  vm.runInContext(componentsSource, context, { filename: "components.js" });
  let calls = 0;
  ui.native.call = async () => {
    calls += 1;
    const start = (calls - 1) * 30;
    return {
      items: Array.from({ length: 30 }, (_value, index) => ({
        characterId: `actor_${start + index}`,
        name: `角色 ${start + index}`,
        avatarUri: null,
        enabled: true,
      })),
      loadedCount: 30,
      totalCount: 100_000,
      hasMore: true,
      nextCursor: `cursor_${calls}`,
    };
  };

  await ui.openEntityPicker({ entity: "actors", mode: "multiple", selectedIds: ["pinned_actor"] });
  ui.state.entityPicker.retainedPageLimit = 1;
  const fetched = await ui.fetchNextEntityPickerPage();

  assert.equal(fetched, false);
  assert.equal(calls, 1);
  assert.equal(ui.state.entityPicker.orderIds.length, 30);
  assert.equal(ui.state.entityPicker.selectedIds.has("pinned_actor"), true);
  assert.equal(ui.state.entityPicker.autoFetchBlocked, true);
  assert.match(ui.state.entityPicker.error, /缩小搜索范围/);
  assert.equal(await ui.fetchNextEntityPickerPage(), false);
  const html = ui.components.renderEntityPicker(ui.state.entityPicker);
  assert.match(html, /缩小搜索范围/);
  assert.doesNotMatch(html, /data-action="retry-entity-picker"/);
});

test("single picker commits immediately while multiple picker waits for confirmation", async () => {
  const { ui } = createHarness();
  ui.native.call = async () => page([
    { characterGroupId: "group_a", name: "群组甲", avatarUri: null },
  ]);
  const commits = [];

  await ui.openEntityPicker({ entity: "groups", mode: "single", onCommit(ids) { commits.push(ids); } });
  ui.toggleEntityPickerSelection("group_a");
  assert.deepEqual(commits.map((ids) => Array.from(ids)), [["group_a"]]);
  assert.equal(ui.state.entityPicker, null);

  await ui.openEntityPicker({ entity: "groups", mode: "multiple", onCommit(ids) { commits.push(ids); } });
  ui.toggleEntityPickerSelection("group_a");
  assert.equal(commits.length, 1);
  ui.confirmEntityPicker();
  assert.deepEqual(commits.map((ids) => Array.from(ids)), [["group_a"], ["group_a"]]);
  assert.equal(ui.state.entityPicker, null);
});

test("picker close resolves the logical opener after the shell rerenders", async () => {
  const { context, ui } = createHarness();
  const staleOpener = {
    dataset: { action: "open-actor-picker", pickerKey: "rule-trigger-actors" },
    focus() { context.document.activeElement = this; },
  };
  const stableOpener = {
    dataset: { action: "open-actor-picker", pickerKey: "rule-trigger-actors" },
    focus() { context.document.activeElement = this; },
  };
  const body = { dataset: {}, focus() { context.document.activeElement = this; } };
  context.document.activeElement = body;
  context.document.querySelectorAll = () => [stableOpener];
  ui.render = () => { context.document.activeElement = body; };
  ui.native.call = async () => page([]);

  await ui.openEntityPicker({ entity: "actors", mode: "multiple", title: "选择角色", opener: staleOpener });
  ui.closeEntityPicker();
  await Promise.resolve();

  assert.equal(context.document.activeElement, stableOpener);
  assert.notEqual(context.document.activeElement, staleOpener);
  assert.notEqual(context.document.activeElement, body);
});

test("single commit restores its logical opener again after an asynchronous context rerender", async () => {
  const { context, ui } = createHarness();
  const commitGate = deferred();
  const staleOpener = {
    dataset: { action: "open-status-actor-picker", pickerKey: "status-actor-finder" },
    focus() { context.document.activeElement = this; },
  };
  const stableOpener = {
    dataset: { action: "open-status-actor-picker", pickerKey: "status-actor-finder" },
    focus() { context.document.activeElement = this; },
  };
  const body = { dataset: {}, focus() { context.document.activeElement = this; } };
  context.document.activeElement = body;
  context.document.querySelectorAll = () => [stableOpener];
  ui.render = () => { context.document.activeElement = body; };
  ui.native.call = async () => page([{ characterId: "actor_44", name: "角色 44", avatarUri: null, enabled: true }]);

  await ui.openEntityPicker({
    entity: "actors",
    mode: "single",
    opener: staleOpener,
    async onCommit() {
      await commitGate.promise;
      ui.render();
    },
  });
  ui.toggleEntityPickerSelection("actor_44");
  await Promise.resolve();
  assert.equal(context.document.activeElement, stableOpener);
  commitGate.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(context.document.activeElement, stableOpener);
});

test("management pagination patch preserves logical focus and screen scroll", async () => {
  const { context, ui, elements } = createHarness("?route=config-fields");
  ui.native.call = async (method) => {
    if (method === "snapshot") return validSnapshot();
    if (method === "queryFields" || method === "queryActors" || method === "queryGroups") return page([]);
    return page([]);
  };
  vm.runInContext(appSource, context, { filename: "app.js" });
  await new Promise((resolve) => setImmediate(resolve));

  const appRoot = elements.get("appRoot");
  const screenScroll = new context.Element();
  screenScroll.scrollTop = 137;
  const currentRegion = new context.Element();
  const oldNext = new context.Element();
  oldNext.dataset = { pageRoute: "config-fields", pageDirection: "next", page: "2" };
  const newNext = new context.Element();
  newNext.dataset = { pageRoute: "config-fields", pageDirection: "next", page: "3" };
  const body = new context.Element();
  Object.defineProperty(currentRegion, "innerHTML", {
    configurable: true,
    set(value) {
      this.renderedHtml = value;
      screenScroll.scrollTop = 0;
      context.document.activeElement = body;
    },
  });
  currentRegion.querySelectorAll = (selector) => selector === "[data-page-route]" ? [newNext] : [];
  appRoot.querySelector = (selector) => ({
    ".screen-scroll": screenScroll,
    '[data-management-region="config-fields"]': currentRegion,
  })[selector] || null;
  appRoot.querySelectorAll = (selector) => selector === "[data-page-route]" ? [newNext] : [];
  context.document.createElement = () => ({
    set innerHTML(value) { this.renderedHtml = value; },
    content: { querySelector() { return new context.Element(); } },
  });
  ui.pages.fields = () => '<div data-management-region="config-fields">新页</div>';
  context.document.activeElement = oldNext;

  ui.patchManagementList("config-fields");

  assert.equal(context.document.activeElement, newNext);
  assert.equal(screenScroll.scrollTop, 137);
});

test("management pagination moves focus to the remaining page control when next becomes disabled", async () => {
  const { context, ui, elements } = createHarness("?route=config-fields");
  ui.native.call = async (method) => {
    if (method === "snapshot") return validSnapshot();
    return page([]);
  };
  vm.runInContext(appSource, context, { filename: "app.js" });
  await new Promise((resolve) => setImmediate(resolve));

  const appRoot = elements.get("appRoot");
  const currentRegion = new context.Element();
  const oldNext = new context.Element();
  oldNext.dataset = { pageRoute: "config-fields", pageDirection: "next", page: "3" };
  const disabledNext = new context.Element();
  disabledNext.dataset = { pageRoute: "config-fields", pageDirection: "next", page: "4" };
  disabledNext.disabled = true;
  disabledNext.focus = () => {};
  const previous = new context.Element();
  previous.dataset = { pageRoute: "config-fields", pageDirection: "previous", page: "2" };
  Object.defineProperty(currentRegion, "innerHTML", { configurable: true, set() {} });
  appRoot.querySelector = (selector) => selector === '[data-management-region="config-fields"]' ? currentRegion : null;
  appRoot.querySelectorAll = (selector) => selector === "[data-page-route]" ? [previous, disabledNext] : [];
  context.document.createElement = () => ({
    set innerHTML(value) { this.renderedHtml = value; },
    content: { querySelector() { return new context.Element(); } },
  });
  ui.pages.fields = () => '<div data-management-region="config-fields">最后一页</div>';
  context.document.activeElement = oldNext;

  ui.patchManagementList("config-fields");

  assert.equal(context.document.activeElement, previous);
});

test("status context commit waits for its deferred view-transition rerender", async () => {
  const { context, ui, elements } = createHarness("?route=status");
  ui.native.call = async (method, payload) => {
    if (method === "snapshot") return validSnapshot({
      activeContext: {
        chatId: "chat_a",
        actorId: payload.actorId || "actor_a",
        groupId: "group_0",
        actorName: payload.actorId ? "成员 44" : "角色甲",
        truncated: false,
      },
    });
    if (method === "queryActors" || method === "queryGroups") return page([]);
    return page([]);
  };
  vm.runInContext(appSource, context, { filename: "app.js" });
  await new Promise((resolve) => setImmediate(resolve));
  let pickerConfig = null;
  ui.openEntityPicker = async (config) => { pickerConfig = config; };
  const opener = new context.Element();
  opener.dataset = { action: "open-status-actor-picker", pickerKey: "status-actor-finder" };
  opener.closest = (selector) => selector === "[data-action]" ? opener : null;
  elements.get("appRoot").listeners.get("click")({ target: opener });
  await new Promise((resolve) => setImmediate(resolve));

  const releaseTransition = deferred();
  let updateApplied = false;
  context.document.startViewTransition = (update) => ({
    updateCallbackDone: releaseTransition.promise.then(() => {
      update();
      updateApplied = true;
    }),
  });
  let commitSettled = false;
  const commit = pickerConfig.onCommit(["member_44"], [{ characterId: "member_44", name: "成员 44", enabled: true }])
    .then(() => { commitSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(commitSettled, false);
  assert.equal(updateApplied, false);
  releaseTransition.resolve();
  await commit;
  assert.equal(updateApplied, true);
});

test("management count copy is exact and distinguishes matched totals from authoritative all totals", () => {
  const { context, ui } = createHarness();
  vm.runInContext(componentsSource, context, { filename: "components.js" });
  vm.runInContext(configSource, context, { filename: "pages-config.js" });
  vm.runInContext(rulesSource, context, { filename: "pages-rules.js" });
  vm.runInContext(statusSource, context, { filename: "pages-status.js" });
  ui.state.snapshot = validSnapshot({
    counts: { fields: 51, actors: 2, groups: 1, rules: 52, conditions: 53, effectGroups: 54, records: 55 },
  });
  ui.state.pages = {
    fields: { items: [], loadedCount: 5, totalCount: 51, hasMore: true, nextCursor: null },
    rules: { items: [], loadedCount: 5, totalCount: 52, hasMore: true, nextCursor: null },
    conditions: { items: [], loadedCount: 10, totalCount: 53, hasMore: true, nextCursor: null },
    effectGroups: { items: [], loadedCount: 10, totalCount: 54, hasMore: true, nextCursor: null },
    records: { items: [], loadedCount: 10, totalCount: 55, hasMore: true, nextCursor: null },
  };

  assert.equal(ui.components.listMeta(ui.state.pages.fields, "个字段", 1, 5, 51, false),
    '<p class="list-meta" aria-live="polite">已显示 5 个字段 / 匹配 51 个字段 / 共 51 个字段</p>');
  assert.equal(ui.components.listMeta(ui.state.pages.rules, "条规则", 1, 5, 52, false),
    '<p class="list-meta" aria-live="polite">已显示 5 条规则 / 匹配 52 条规则 / 共 52 条规则</p>');
  assert.equal(ui.components.listMeta(ui.state.pages.conditions, "个条件", 1, 10, 53, false),
    '<p class="list-meta" aria-live="polite">已显示 10 个条件 / 匹配 53 个条件 / 共 53 个条件</p>');
  assert.equal(ui.components.listMeta(ui.state.pages.effectGroups, "个效果组", 1, 10, 54, false),
    '<p class="list-meta" aria-live="polite">已显示 10 个效果组 / 匹配 54 个效果组 / 共 54 个效果组</p>');
  assert.equal(ui.components.listMeta(ui.state.pages.records, "条记录", 1, 10, 55, false),
    '<p class="list-meta" aria-live="polite">已显示 10 条记录 / 匹配 55 条记录 / 共 55 条记录</p>');

  Object.values(ui.state.listViews).forEach((view) => { view.search = "筛选"; });
  Object.assign(ui.state.pages, {
    fields: { items: [], loadedCount: 5, totalCount: 7, hasMore: true, nextCursor: null },
    rules: { items: [], loadedCount: 5, totalCount: 8, hasMore: true, nextCursor: null },
    conditions: { items: [], loadedCount: 10, totalCount: 19, hasMore: true, nextCursor: null },
    effectGroups: { items: [], loadedCount: 10, totalCount: 20, hasMore: true, nextCursor: null },
    records: { items: [], loadedCount: 10, totalCount: 21, hasMore: true, nextCursor: null },
  });

  assert.equal(ui.components.listMeta(ui.state.pages.fields, "个字段", 1, 5, 51, true),
    '<p class="list-meta" aria-live="polite">已显示 5 个字段 / 匹配 7 个字段 / 共 51 个字段</p>');
  assert.equal(ui.components.listMeta(ui.state.pages.rules, "条规则", 1, 5, 52, true),
    '<p class="list-meta" aria-live="polite">已显示 5 条规则 / 匹配 8 条规则 / 共 52 条规则</p>');
  assert.equal(ui.components.listMeta(ui.state.pages.conditions, "个条件", 1, 10, 53, true),
    '<p class="list-meta" aria-live="polite">已显示 10 个条件 / 匹配 19 个条件 / 共 53 个条件</p>');
  assert.equal(ui.components.listMeta(ui.state.pages.effectGroups, "个效果组", 1, 10, 54, true),
    '<p class="list-meta" aria-live="polite">已显示 10 个效果组 / 匹配 20 个效果组 / 共 54 个效果组</p>');
  assert.equal(ui.components.listMeta(ui.state.pages.records, "条记录", 1, 10, 55, true),
    '<p class="list-meta" aria-live="polite">已显示 10 条记录 / 匹配 21 条记录 / 共 55 条记录</p>');
});

test("status directories expose full role and group picker entries and field picker renders server filters", () => {
  const { context, ui } = createHarness();
  vm.runInContext(componentsSource, context, { filename: "components.js" });
  vm.runInContext(configSource, context, { filename: "pages-config.js" });
  vm.runInContext(statusSource, context, { filename: "pages-status.js" });
  ui.state.snapshot = validSnapshot({
    counts: { ...validSnapshot().counts, actors: 96, groups: 72 },
    activeContext: { chatId: "chat_a", actorId: "actor_0", groupId: "group_0", actorName: "角色 0", truncated: false },
  });
  ui.state.directory.actors = Array.from({ length: 30 }, (_value, index) => ({
    characterId: `actor_${index}`, name: `角色 ${index}`, avatarUri: null, enabled: true,
  }));
  ui.state.directory.actorTotal = 45;
  ui.state.directory.groups = Array.from({ length: 30 }, (_value, index) => ({
    characterGroupId: `group_${index}`, name: `群组 ${index}`, avatarUri: null,
  }));
  ui.state.directory.groupTotal = 72;

  const statusHtml = ui.pages.status();
  assert.equal(statusHtml.includes("查找角色（共 45）"), true);
  assert.equal(statusHtml.includes("data-action=\"open-status-actor-picker\""), true);
  ui.state.statusMode = "group";
  const groupHtml = ui.pages.status();
  assert.equal(groupHtml.includes("查找群组（共 72）"), true);
  assert.equal(groupHtml.includes("data-action=\"open-status-group-picker\""), true);

  const pickerHtml = ui.components.renderEntityPicker({
    entity: "fields",
    definition: { idKey: "id" },
    title: "选择字段",
    mode: "single",
    search: "",
    filters: {},
    items: [],
    orderIds: [],
    itemById: new Map(),
    selectedIds: new Set(),
    selectedItems: new Map(),
    totalCount: 0,
    allTotalCount: 12,
    loading: false,
    error: "",
    virtualWindow: { start: 0, end: 0, rowHeight: 56 },
  });
  assert.equal(pickerHtml.includes("aria-label=\"筛选字段作用域\""), true);
  assert.equal(pickerHtml.includes("aria-label=\"筛选字段类型\""), true);
  assert.equal(pickerHtml.includes("aria-label=\"筛选启用状态\""), true);
  assert.equal(pickerHtml.includes("已显示 0 / 匹配 0 / 共 12"), true);
});

test("status finder opens a single server-backed picker and commits an actor beyond the compact directory", async () => {
  const { context, ui, elements } = createHarness();
  context.window.location.href = "https://mvu.local/app.html?route=status";
  context.window.location.search = "?route=status";
  const requests = [];
  ui.native.call = async (method, payload) => {
    requests.push([method, payload]);
    if (method === "snapshot") return validSnapshot({
      activeContext: { chatId: "chat_a", actorId: payload.actorId || "actor_a", groupId: "group_0",
        actorName: payload.actorId ? "角色 44" : "角色甲", truncated: false },
    });
    if (method === "queryActors" || method === "queryGroups") return page([]);
    return page([]);
  };
  vm.runInContext(appSource, context, { filename: "app.js" });
  await new Promise((resolve) => setImmediate(resolve));
  let pickerConfig = null;
  ui.openEntityPicker = async (config) => { pickerConfig = config; };
  const opener = new context.Element();
  opener.dataset = { action: "open-status-actor-picker", pickerKey: "status-actor-finder" };
  opener.closest = (selector) => selector === "[data-action]" ? opener : null;

  elements.get("appRoot").listeners.get("click")({ target: opener });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(pickerConfig.entity, "actors");
  assert.equal(pickerConfig.mode, "single");
  assert.deepEqual(JSON.parse(JSON.stringify(pickerConfig.filters)), { groupId: "group_0" });
  assert.deepEqual(Array.from(pickerConfig.lockedFilterKeys), ["groupId"]);
  await pickerConfig.onCommit(["actor_44"], [{ characterId: "actor_44", name: "角色 44", enabled: true }]);
  assert.equal(requests.some(([method, payload]) => method === "snapshot" &&
    payload.groupId === "group_0" && payload.actorId === "actor_44"), true);
});

test("locked group actor picker reaches tail members and cannot broaden to outsiders", async () => {
  const { ui } = createHarness();
  const members = Array.from({ length: 45 }, (_value, index) => ({
    characterId: `member_${String(index).padStart(2, "0")}`,
    name: `成员 ${index}`,
    avatarUri: null,
    enabled: true,
  }));
  const outsider = { characterId: "outsider", name: "外部角色", avatarUri: null, enabled: true };
  const requests = [];
  ui.native.call = async (method, request) => {
    assert.equal(method, "queryActors");
    requests.push(request);
    if (request.filters?.groupId !== "group_0") {
      return { items: [outsider], loadedCount: 1, totalCount: 1, hasMore: false, nextCursor: null };
    }
    if (request.cursor) {
      return { items: members.slice(30), loadedCount: 15, totalCount: 45, hasMore: false, nextCursor: null };
    }
    return { items: members.slice(0, 30), loadedCount: 30, totalCount: 45, hasMore: true, nextCursor: "member_tail" };
  };

  await ui.openEntityPicker({
    entity: "actors",
    mode: "single",
    filters: { groupId: "group_0" },
    lockedFilterKeys: ["groupId"],
  });
  await ui.fetchNextEntityPickerPage();

  assert.equal(ui.state.entityPicker.orderIds.length, 45);
  assert.equal(ui.state.entityPicker.itemById.has("member_44"), true);
  assert.equal(ui.state.entityPicker.itemById.has("outsider"), false);
  await assert.rejects(
    ui.updateEntityPickerFilter("groupId", "", "string"),
    /MVU_PICKER_FILTER_LOCKED/,
  );
  assert.equal(requests.every((request) => request.filters?.groupId === "group_0"), true);
});

test("management and picker filter controls send typed filters to their server queries", async () => {
  const { context, ui, elements } = createHarness();
  context.window.location.href = "https://mvu.local/app.html?route=config-fields";
  context.window.location.search = "?route=config-fields";
  const requests = [];
  ui.native.call = async (method, payload) => {
    requests.push([method, payload]);
    if (method === "snapshot") return validSnapshot();
    if (method === "queryFields" || method === "queryActors" || method === "queryGroups") return page([]);
    return page([]);
  };
  vm.runInContext(appSource, context, { filename: "app.js" });
  await new Promise((resolve) => setImmediate(resolve));
  const select = new context.Element();
  select.value = "false";
  select.dataset = { listFilterRoute: "config-fields", listFilterKey: "enabled", filterValueType: "boolean" };
  select.closest = (selector) => selector === "[data-list-filter-route]" ? select : null;

  const changeListener = elements.get("appRoot").listeners.get("change");
  assert.equal(typeof changeListener, "function");
  changeListener({ target: select });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.some(([method, payload]) => method === "queryFields" && payload.filters?.enabled === false), true);

  await ui.openEntityPicker({ entity: "fields", mode: "single" });
  await ui.updateEntityPickerFilter("type", "stage_only", "string");
  const pickerRequest = requests.filter(([method]) => method === "queryFields").at(-1)[1];
  assert.equal(pickerRequest.filters.type, "stage_only");
  assert.equal(pickerRequest.filters.mode, "picker");
});

test("demo picker data is high-cardinality and controllable without changing management fixtures", async () => {
  const { ui } = createHarness("?demo=1&demoPickerSlowSearch=旧&demoPickerSlowMs=40&demoPickerFailSearch=失败");
  ui.state.demo = true;

  const managementFields = await ui.native.call("queryFields", { page: 1 });
  assert.equal(managementFields.totalCount, 13);

  await ui.openEntityPicker({ entity: "fields", mode: "multiple", title: "选择字段" });
  assert.equal(ui.state.entityPicker.items.length, 30);
  assert.ok(ui.state.entityPicker.totalCount >= 90);
  assert.equal(ui.state.entityPicker.hasMore, true);

  const startedAt = Date.now();
  await ui.native.call("queryFields", { search: "旧", filters: { mode: "picker" } });
  assert.ok(Date.now() - startedAt >= 30);
  await assert.rejects(
    ui.native.call("queryFields", { search: "失败", filters: { mode: "picker" } }),
    /demo picker failure/i,
  );
});

test("demo picker cursors are opaque query-bound one-shot tokens with oversize and bad-cursor faults", async () => {
  const { ui } = createHarness("?demo=1&demoPickerOversizeSearch=超大&demoPickerBadCursorSearch=坏游标");
  ui.state.demo = true;

  const first = await ui.native.call("queryFields", { search: "游标", filters: { mode: "picker", scope: "character" } });
  assert.match(first.nextCursor, /^demo_c1_/);
  assert.doesNotMatch(first.nextCursor, /:\d+$/);
  await assert.rejects(
    ui.native.call("queryFields", { search: "别的查询", filters: { mode: "picker", scope: "character" }, cursor: first.nextCursor }),
    /cursor/i,
  );

  const reusable = await ui.native.call("queryFields", { search: "游标", filters: { mode: "picker" } });
  await ui.native.call("queryFields", { search: "游标", filters: { mode: "picker" }, cursor: reusable.nextCursor });
  await assert.rejects(
    ui.native.call("queryFields", { search: "游标", filters: { mode: "picker" }, cursor: reusable.nextCursor }),
    /cursor/i,
  );

  const oversized = await ui.native.call("queryFields", { search: "超大", filters: { mode: "picker" } });
  assert.throws(
    () => ui.validateQueryResponse(oversized, "queryFields", { search: "超大", filters: { mode: "picker" } }),
    /MVU_QUERY_RESPONSE_INVALID/,
  );

  const broken = await ui.native.call("queryFields", { search: "坏游标", filters: { mode: "picker" } });
  await assert.rejects(
    ui.native.call("queryFields", { search: "坏游标", filters: { mode: "picker" }, cursor: broken.nextCursor }),
    /cursor/i,
  );
});

test("picker rendering bounds pinned DOM while preserving every selected ID", () => {
  const { context, ui } = createHarness();
  vm.runInContext(componentsSource, context, { filename: "components.js" });
  const selectedIds = new Set(Array.from({ length: 100 }, (_value, index) => `actor_${index}`));
  const selectedItems = new Map(Array.from(selectedIds, (id, index) => [id, {
    characterId: id,
    name: `角色 ${index}`,
    avatarUri: null,
    enabled: true,
  }]));

  const html = ui.components.renderEntityPicker({
    entity: "actors",
    definition: { idKey: "characterId" },
    title: "选择角色",
    mode: "multiple",
    search: "",
    items: [],
    selectedIds,
    selectedItems,
    totalCount: 0,
    loading: false,
    error: "",
  });

  const renderedPins = (html.match(/class="picker-pinned-item"/g) || []).length;
  const hiddenMatch = html.match(/另 (\d+) 项/);
  assert.ok(renderedPins > 0 && renderedPins <= 20);
  assert.equal(Number(hiddenMatch[1]), 100 - renderedPins);
  assert.match(html, /aria-label="另 \d+ 项已选择"/);
  assert.equal(selectedIds.size, 100);
});
