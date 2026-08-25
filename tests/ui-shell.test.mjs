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
    if (method === "exportDataset") return { fileName: "mvu.json", savedPath: "/sdcard/Download/Operit/exports/mvu.json" };
    return null;
  };
  vm.runInContext(appSource, context, { filename: "app.js" });
  await new Promise((resolve) => setImmediate(resolve));

  await ui.importDatasetText('{"formatVersion":3}');
  const exported = await ui.exportDataset();

  const imported = calls.find(([method]) => method === "importDataset");
  assert.equal(imported[0], "importDataset");
  assert.equal(imported[1].json, '{"formatVersion":3}');
  assert.equal(exported.fileName, "mvu.json");
  assert.equal(exported.savedPath, "/sdcard/Download/Operit/exports/mvu.json");
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
  const { context, ui } = createHarness();
  context.window.location.href = "https://mvu.local/app.html?route=status";
  context.window.location.search = "?route=status";
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
  assert.deepEqual(Array.from(members.items, (member) => member.characterId), ["bob"]);
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
  assert.match(stylesSource, /\.stage-map\s*\{[^}]*margin:\s*24px 7px 0;/);
  assert.match(stylesSource, /\.stage-marker\[data-stage-lane="1"\]\s+\.stage-name\s*\{[^}]*translateY\(-24px\)/);
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
  assert.match(rulesSource, /effectReasonMode/);
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

  const fields = await ui.native.call("queryFields", { page: 2, search: "演示字段" });
  const rules = await ui.native.call("queryRules", { page: 2, search: "演示规则" });
  const conditions = await ui.native.call("queryConditions", { page: 2, search: "演示条件" });
  const effects = await ui.native.call("queryEffectGroups", { page: 2, search: "演示效果" });
  const records = await ui.native.call("queryRecords", { page: 2 });

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
  assert.deepEqual(ui.state.entityPicker.items.map((item) => item.characterId), ["new"]);
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
  assert.equal(ui.state.entityPicker.items.length, 60);
  assert.deepEqual(Array.from(ui.state.entityPicker.selectedIds), ["actor_0", "actor_1"]);

  ui.searchEntityPicker("失败");
  await wait(190);
  await wait(0);
  assert.match(ui.state.entityPicker.error, /重试/);
  assert.equal(ui.state.entityPicker.search, "失败");
  assert.deepEqual(Array.from(ui.state.entityPicker.selectedIds), ["actor_0", "actor_1"]);
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

test("management count copy distinguishes unfiltered totals from authoritative filtered totals", () => {
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

  assert.match(ui.pages.fields(), /本页 1–5 \/ 共 51 个字段/);
  assert.match(ui.pages.ruleLibrary(), /本页 1–5 \/ 共 52 条规则/);
  assert.match(ui.pages.conditionLibrary(), /本页 1–10 \/ 共 53 个条件/);
  assert.match(ui.pages.effectLibrary(), /本页 1–10 \/ 共 54 个效果组/);
  assert.match(ui.pages.records(), /本页 1–10 \/ 共 55 条记录/);

  Object.values(ui.state.listViews).forEach((view) => { view.search = "筛选"; });
  Object.assign(ui.state.pages, {
    fields: { items: [], loadedCount: 5, totalCount: 7, hasMore: true, nextCursor: null },
    rules: { items: [], loadedCount: 5, totalCount: 8, hasMore: true, nextCursor: null },
    conditions: { items: [], loadedCount: 10, totalCount: 19, hasMore: true, nextCursor: null },
    effectGroups: { items: [], loadedCount: 10, totalCount: 20, hasMore: true, nextCursor: null },
    records: { items: [], loadedCount: 10, totalCount: 21, hasMore: true, nextCursor: null },
  });

  assert.match(ui.pages.fields(), /本页 1–5 · 匹配 7 \/ 共 51 个字段/);
  assert.match(ui.pages.ruleLibrary(), /本页 1–5 · 匹配 8 \/ 共 52 条规则/);
  assert.match(ui.pages.conditionLibrary(), /本页 1–10 · 匹配 19 \/ 共 53 个条件/);
  assert.match(ui.pages.effectLibrary(), /本页 1–10 · 匹配 20 \/ 共 54 个效果组/);
  assert.match(ui.pages.records(), /本页 1–10 · 匹配 21 \/ 共 55 条记录/);
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
