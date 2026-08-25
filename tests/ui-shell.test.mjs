import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const runtimeSource = await readFile(new URL("../static/app_ui/runtime.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../static/app_ui/app.js", import.meta.url), "utf8");

function page(items) {
  return { items, loadedCount: items.length, totalCount: items.length, hasMore: false, nextCursor: null };
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

function createHarness() {
  class FakeElement {
    constructor() {
      this.listeners = new Map();
      this.classList = { add() {}, remove() {}, contains() { return false; } };
      this.style = { setProperty() {}, removeProperty() {} };
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
      location: { href: "https://mvu.local/app.html?route=field-detail&field=field_a", search: "?route=field-detail&field=field_a" },
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
