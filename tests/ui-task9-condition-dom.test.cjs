const assert = require("node:assert/strict");
const http = require("node:http");
const { existsSync } = require("node:fs");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const { chromium } = require("playwright-core");

const root = path.resolve(__dirname, "..");
const builtScriptOrder = [
  "runtime.js",
  "components.js",
  "pages-status.js",
  "pages-config.js",
  "pages-rules.js",
  "pages-advanced.js",
  "app.js",
];

async function waitFor(predicate, message, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

function parseBuiltArtifact(html) {
  const scriptPattern = /<script\b(?<attributes>[^>]*)>(?<source>[\s\S]*?)<\/script>/gi;
  const scripts = Array.from(html.matchAll(scriptPattern), (match) => {
    const sourceMatch = match.groups.attributes.match(/\bdata-source=(['"])(?<name>[^'"]+)\1/i);
    return { name: sourceMatch?.groups.name || "", source: match.groups.source };
  });
  assert.deepEqual(scripts.map((script) => script.name), builtScriptOrder);
  return { markup: html.replace(scriptPattern, ""), scripts };
}

async function createApp(route) {
  const html = await readFile(path.join(root, "dist", "app.html"), "utf8");
  const artifact = parseBuiltArtifact(html);
  const { Window } = await import("happy-dom");
  const window = new Window({ url: `https://mvu.local/app.html?demo=1&route=${route}` });
  window.document.open();
  window.document.write(artifact.markup);
  window.document.close();
  window.matchMedia ||= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  for (const script of artifact.scripts) {
    window.eval(`${script.source}\n//# sourceURL=dist/app.html?data-source=${script.name}`);
  }
  await waitFor(
    () => window.document.querySelector(".app-screen") && !window.document.querySelector(".boot-state"),
    `app did not boot route ${route}`,
  );
  return window;
}

function click(window, selector) {
  const element = window.document.querySelector(selector);
  assert.ok(element, `missing click target ${selector}`);
  element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  return element;
}

function input(window, selector, value) {
  const element = window.document.querySelector(selector);
  assert.ok(element, `missing input ${selector}`);
  element.value = value;
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
  return element;
}

function change(window, selector, value) {
  const element = window.document.querySelector(selector);
  assert.ok(element, `missing change control ${selector}`);
  element.value = value;
  element.dispatchEvent(new window.Event("change", { bubbles: true }));
  return element;
}

function submit(window, selector = '[data-form="condition-editor"]') {
  const form = window.document.querySelector(selector);
  assert.ok(form, `missing submit form ${selector}`);
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  return form;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function resolveChromiumExecutable() {
  const candidates = [process.env.TASK9_CHROME_PATH];
  if (process.platform === "win32") {
    candidates.push(
      path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
    );
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
  } else {
    candidates.push("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge");
  }
  try { candidates.push(chromium.executablePath()); } catch (_error) { /* playwright-core relies on an installed browser */ }
  const executable = candidates.find((candidate) => typeof candidate === "string" && candidate && existsSync(candidate));
  if (!executable) throw new Error("TASK9_CHROMIUM_NOT_FOUND: set TASK9_CHROME_PATH to Chrome or Edge");
  return executable;
}

function startStaticServer() {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      const requested = url.pathname === "/" ? "/dist/app.html" : decodeURIComponent(url.pathname);
      const fileName = path.resolve(root, "." + requested);
      if (!fileName.startsWith(root + path.sep)) throw new Error("outside root");
      const body = await readFile(fileName);
      const type = ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2" })[path.extname(fileName)] || "application/octet-stream";
      response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      response.end(body);
    } catch (_error) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

test("condition library renders exact 10-row paging with row-level view toggle and more actions", async (t) => {
  const window = await createApp("condition-library");
  t.after(() => window.close());
  const { document } = window;

  assert.equal(document.querySelectorAll("[data-condition-row]").length, 10);
  assert.match(document.querySelector(".list-meta").textContent, /显示 1–10 \/ 共 24 个条件/);
  const row = document.querySelector("[data-condition-row]");
  assert.ok(row.querySelector("[data-open-entity='condition']"), "whole row must open the condition");
  assert.ok(row.querySelector("[data-action='toggle-condition']"), "row needs an explicit toggle");
  assert.ok(row.querySelector("[data-condition-more]"), "row needs explicit more actions");
  assert.match(row.textContent, /引用|未引用/);
  assert.ok(row.querySelector("[data-condition-expression-summary]"));
  assert.ok(document.querySelector("[data-new-entity='condition']"), "new condition action must stay visible");
});

test("condition serializer preserves every production predicate token and exact payload keys", async (t) => {
  const window = await createApp("condition-editor");
  t.after(() => window.close());
  const serialize = window.MvuUi.conditionEditor?.serializeExpression;
  assert.equal(typeof serialize, "function", "condition serializer must be exposed for contract tests");

  const raw = {
    kind: "and",
    children: [
      { kind: "predicate", predicate: { kind: "recent_positive", count: "2" } },
      { kind: "predicate", predicate: { kind: "long_inactive", hours: "24" } },
      { kind: "predicate", predicate: { kind: "user_care" } },
      { kind: "predicate", predicate: { kind: "special_day" } },
      { kind: "predicate", predicate: { kind: "high_frequency", messages: "8", windowHours: "6", bucketHours: "1" } },
      { kind: "predicate", predicate: { kind: "field_comparison", fieldId: "affinity", operator: ">=", value: "42" } },
      { kind: "predicate", predicate: { kind: "message_count", count: "5", windowHours: "2", sender: "user" } },
      { kind: "predicate", predicate: { kind: "keywords", includeAny: ["关心"], includeAll: ["真诚"], exclude: ["讽刺"], windowHours: "3", caseSensitive: true } },
      { kind: "predicate", predicate: { kind: "sender", senders: ["user", "character"] } },
      { kind: "predicate", predicate: { kind: "actor", actorIds: ["operit", "bob"] } },
      { kind: "predicate", predicate: { kind: "group", groupIds: ["group-a"] } },
      { kind: "predicate", predicate: { kind: "concrete_date", dates: ["2026-08-26"] } },
      { kind: "predicate", predicate: { kind: "repeating_date", month: "8", day: "26" } },
      { kind: "predicate", predicate: { kind: "ai_semantic", id: "ai_custom_1", triggerType: "自定义信任事件", requirement: "观察到主动托付。", minimumConfidence: "0.83" } },
    ],
  };
  const expected = plain(raw);
  for (const node of expected.children) {
    for (const key of ["count", "hours", "messages", "windowHours", "bucketHours", "value", "month", "day", "minimumConfidence"]) {
      if (Object.hasOwn(node.predicate, key)) node.predicate[key] = Number(node.predicate[key]);
    }
  }
  assert.deepEqual(plain(serialize(raw)), expected);
});

test("referenced condition delete is blocked with readable affected rules and guidance", async (t) => {
  const window = await createApp("condition-library");
  t.after(() => window.close());
  const { document } = window;

  input(window, "[data-list-search-route='condition-library']", "主动关心");
  await waitFor(() => document.querySelector("[data-condition-row='condition-1']"), "referenced condition search did not finish");
  click(window, "[data-condition-row='condition-1'] [data-action='delete-condition']");
  await waitFor(() => document.querySelector(".condition-reference-dialog"), "reference dialog did not open");

  const dialog = document.querySelector(".condition-reference-dialog");
  assert.match(dialog.textContent, /关心回应/);
  assert.match(dialog.textContent, /先替换条件|停用相关规则/);
  assert.equal(dialog.querySelector("[data-action='confirm-condition-delete']"), null);
  assert.equal(window.MvuUi.state.demoLastRequests.deleteCondition, undefined);
});

test("custom AI condition creates through the real form with exact production-shaped payload", async (t) => {
  const window = await createApp("condition-editor");
  t.after(() => window.close());
  const { document } = window;

  input(window, '[name="conditionName"]', "托付信任");
  input(window, '[name="conditionDescription"]', "识别主动托付的重要事件");
  click(window, '[data-action="add-condition-predicate"][data-condition-path=""]');
  change(window, '[data-condition-predicate-kind][data-condition-path="0"]', "ai_semantic");
  input(window, '[data-condition-prop="triggerType"][data-condition-path="0"]', "自定义信任事件");
  input(window, '[data-condition-prop="requirement"][data-condition-path="0"]', "观察到主动托付重要决定。");
  input(window, '[data-condition-prop="minimumConfidence"][data-condition-path="0"]', "0.86");
  const stableId = document.querySelector('[data-condition-ai-id][data-condition-path="0"]').textContent.trim();
  assert.match(stableId, /^[A-Za-z][A-Za-z0-9_]*$/);

  submit(window);
  await waitFor(() => window.MvuUi.state.route === "condition-library", "created AI condition did not return to library");
  assert.deepEqual(plain(window.MvuUi.state.demoLastRequests.createCondition), {
    expectedRevision: 7,
    condition: {
      name: "托付信任",
      description: "识别主动托付的重要事件",
      enabled: true,
      expression: {
        kind: "and",
        children: [{
          kind: "predicate",
          predicate: {
            kind: "ai_semantic",
            id: stableId,
            triggerType: "自定义信任事件",
            requirement: "观察到主动托付重要决定。",
            minimumConfidence: 0.86,
          },
        }],
      },
    },
  });
});

test("deep existing expression loads without loss and direct group add change remove controls save exact tree", async (t) => {
  const window = await createApp("condition-library");
  t.after(() => window.close());
  const deepExpression = {
    kind: "and",
    children: [
      { kind: "predicate", predicate: { kind: "field_comparison", fieldId: "affinity", operator: ">=", value: 30 } },
      {
        kind: "or",
        children: [
          { kind: "not", child: { kind: "predicate", predicate: { kind: "ai_semantic", id: "ai_existing_stable", triggerType: "关系事件", requirement: "关系明显靠近。", minimumConfidence: 0.7 } } },
          { kind: "predicate", predicate: { kind: "keywords", includeAny: ["相信"], includeAll: [], exclude: ["不信"], caseSensitive: false } },
        ],
      },
    ],
  };
  const source = window.MvuUi.state.demoStore.conditions.find((condition) => condition.id === "condition-1");
  source.expression = plain(deepExpression);
  window.MvuUi.state.entities.clear();
  window.MvuUi.state.selectedEntityId = "condition-1";
  window.MvuUi.resetConditionEditorDraft?.();
  await window.MvuUi.navigate("condition-editor");

  assert.deepEqual(plain(window.MvuUi.state.conditionEditorDraft.expression), deepExpression);
  assert.equal(window.document.querySelector('[data-condition-ai-id][data-condition-path="1.0.0"]').textContent.trim(), "ai_existing_stable");
  assert.match(window.document.querySelector("[data-condition-shared-refs]").textContent, /关心回应/);
  click(window, '[data-action="add-condition-predicate"][data-condition-path="1"]');
  change(window, '[data-condition-predicate-kind][data-condition-path="1.2"]', "user_care");
  click(window, '[data-action="change-condition-group"][data-condition-path="1"]');
  click(window, '[data-action="remove-condition-node"][data-condition-path="0"]');
  submit(window);
  await waitFor(() => window.MvuUi.state.route === "condition-library", "deep condition update did not finish");

  assert.deepEqual(plain(window.MvuUi.state.demoLastRequests.updateCondition.patch.expression), {
    kind: "and",
    children: [{
      kind: "and",
      children: [
        { kind: "not", child: { kind: "predicate", predicate: { kind: "ai_semantic", id: "ai_existing_stable", triggerType: "关系事件", requirement: "关系明显靠近。", minimumConfidence: 0.7 } } },
        { kind: "predicate", predicate: { kind: "keywords", includeAny: ["相信"], includeAll: [], exclude: ["不信"], caseSensitive: false } },
        { kind: "predicate", predicate: { kind: "user_care" } },
      ],
    }],
  });
});

test("condition copy toggle and zero-reference confirmed delete use exact current revisions", async (t) => {
  const window = await createApp("condition-library");
  t.after(() => window.close());
  const { document } = window;

  input(window, "[data-list-search-route='condition-library']", "演示条件 20");
  await waitFor(() => document.querySelector("[data-condition-row='demo-condition-20']"), "zero-reference condition search did not finish");
  click(window, "[data-condition-row='demo-condition-20'] [data-action='toggle-condition']");
  await waitFor(() => window.MvuUi.state.demoLastRequests.toggleCondition, "condition toggle did not call native");
  assert.deepEqual(plain(window.MvuUi.state.demoLastRequests.toggleCondition), {
    id: "demo-condition-20", enabled: false, expectedRevision: 7,
  });

  click(window, "[data-condition-row='demo-condition-20'] [data-action='copy-condition']");
  await waitFor(() => window.MvuUi.state.demoLastRequests.copyCondition, "condition copy did not call native");
  assert.deepEqual(plain(window.MvuUi.state.demoLastRequests.copyCondition), {
    id: "demo-condition-20", expectedRevision: 8,
  });

  click(window, "[data-condition-row='demo-condition-20'] [data-action='delete-condition']");
  await waitFor(() => document.querySelector("[data-action='confirm-condition-delete']"), "zero-reference delete did not request explicit confirmation");
  click(window, "[data-action='confirm-condition-delete']");
  await waitFor(() => window.MvuUi.state.demoLastRequests.deleteCondition, "condition delete did not call native");
  assert.deepEqual(plain(window.MvuUi.state.demoLastRequests.deleteCondition), {
    id: "demo-condition-20", expectedRevision: 9,
  });
});

test("field actor and group pickers are searchable bounded and keep readable selections through validation rerenders", async (t) => {
  const window = await createApp("condition-editor");
  t.after(() => window.close());
  const { document } = window;
  input(window, '[name="conditionName"]', "组合选择器");

  click(window, '[data-action="add-condition-predicate"][data-condition-path=""]');
  change(window, '[data-condition-predicate-kind][data-condition-path="0"]', "field_comparison");
  click(window, '[data-condition-picker="field"][data-condition-path="0"]');
  await waitFor(() => window.MvuUi.state.entityPicker?.orderIds.length > 0, "field picker did not load");
  input(window, "[data-picker-search]", "游标字段 096");
  await waitFor(() => document.querySelector('[data-picker-id="picker-field-096"]'), "field picker search did not find tail item");
  assert.ok(document.querySelectorAll(".picker-result").length <= 24);
  click(window, '[data-picker-id="picker-field-096"]');

  click(window, '[data-action="add-condition-predicate"][data-condition-path=""]');
  change(window, '[data-condition-predicate-kind][data-condition-path="1"]', "actor");
  click(window, '[data-condition-picker="actor"][data-condition-path="1"]');
  await waitFor(() => window.MvuUi.state.entityPicker?.orderIds.length > 0, "actor picker did not load");
  input(window, "[data-picker-search]", "游标角色 096");
  await waitFor(() => document.querySelector('[data-picker-id="picker-actor-096"]'), "actor picker search did not find tail item");
  click(window, '[data-picker-id="picker-actor-096"]');
  click(window, '[data-action="confirm-entity-picker"]');

  click(window, '[data-action="add-condition-predicate"][data-condition-path=""]');
  change(window, '[data-condition-predicate-kind][data-condition-path="2"]', "group");
  click(window, '[data-condition-picker="group"][data-condition-path="2"]');
  await waitFor(() => window.MvuUi.state.entityPicker?.orderIds.length > 0, "group picker did not load");
  input(window, "[data-picker-search]", "游标群组 096");
  await waitFor(() => document.querySelector('[data-picker-id="picker-group-096"]'), "group picker search did not find tail item");
  click(window, '[data-picker-id="picker-group-096"]');
  click(window, '[data-action="confirm-entity-picker"]');

  input(window, '[name="conditionName"]', "   ");
  submit(window);
  await waitFor(() => /请输入条件名称/.test(document.querySelector("[data-condition-editor-error]").textContent), "validation error did not render");
  assert.match(document.querySelector('[data-condition-picker="field"]').textContent, /游标字段 096.*picker-field-096/s);
  assert.match(document.querySelector('[data-condition-picker="actor"]').textContent, /游标角色 096.*picker-actor-096/s);
  assert.match(document.querySelector('[data-condition-picker="group"]').textContent, /游标群组 096.*picker-group-096/s);
  assert.deepEqual(plain(window.MvuUi.state.conditionEditorDraft.expression.children.map((node) => node.predicate)), [
    { kind: "field_comparison", fieldId: "picker-field-096", operator: ">=", value: 0 },
    { kind: "actor", actorIds: ["picker-actor-096"] },
    { kind: "group", groupIds: ["picker-group-096"] },
  ]);
});

test("condition save failure preserves draft and duplicate submit cannot repeat a committed mutation after refresh failure", async (t) => {
  const window = await createApp("condition-editor");
  t.after(() => window.close());
  const { document } = window;
  input(window, '[name="conditionName"]', "只创建一次");
  click(window, '[data-action="add-condition-predicate"][data-condition-path=""]');
  change(window, '[data-condition-predicate-kind][data-condition-path="0"]', "user_care");

  window.MvuUi.state.demoNextFailureMethod = "createCondition";
  submit(window);
  await waitFor(() => /demo host failure: createCondition/.test(document.querySelector("[data-condition-editor-error]").textContent), "save failure did not stay inline");
  assert.equal(document.querySelector('[name="conditionName"]').value, "只创建一次");

  const originalCall = window.MvuUi.native.call.bind(window.MvuUi.native);
  let releaseMutation;
  const mutationGate = new Promise((resolve) => { releaseMutation = resolve; });
  let createCalls = 0;
  let failRefresh = true;
  window.MvuUi.native.call = async function (method, params) {
    if (method === "createCondition") {
      createCalls += 1;
      await mutationGate;
      return originalCall(method, params);
    }
    if (method === "snapshot" && createCalls > 0 && failRefresh) {
      failRefresh = false;
      throw new Error("demo refresh unavailable");
    }
    return originalCall(method, params);
  };
  submit(window);
  submit(window);
  await waitFor(() => createCalls === 1, "condition mutation did not start exactly once");
  assert.equal(document.querySelector('[data-form="condition-editor"] button[type="submit"]').disabled, true);
  releaseMutation();
  await waitFor(() => /已经保存.*刷新失败/.test(document.querySelector("[data-condition-editor-error]").textContent), "committed mutation was reported as an ordinary failure");
  assert.equal(document.querySelector('[data-form="condition-editor"] button[type="submit"]'), null);
  submit(window);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(createCalls, 1, "committed condition mutation was retried");
  click(window, '[data-action="reload-condition-after-save"]');
  await waitFor(() => window.MvuUi.state.route === "condition-library", "committed refresh recovery did not return to list");
});

test("stale condition save reloads the latest revision while preserving the draft for explicit retry", async (t) => {
  const window = await createApp("condition-editor");
  t.after(() => window.close());
  const { document } = window;
  input(window, '[name="conditionName"]', "修订冲突草稿");
  click(window, '[data-action="add-condition-predicate"][data-condition-path=""]');
  change(window, '[data-condition-predicate-kind][data-condition-path="0"]', "special_day");
  window.MvuUi.state.demoStore.revision += 1;

  submit(window);
  await waitFor(() => /最新修订/.test(document.querySelector("[data-condition-editor-error]").textContent), "stale revision guidance did not render");
  assert.equal(document.querySelector('[name="conditionName"]').value, "修订冲突草稿");
  assert.equal(window.MvuUi.state.snapshot.revision, 8, "latest authoritative revision was not reloaded");
  submit(window);
  await waitFor(() => window.MvuUi.state.route === "condition-library", "stale save retry did not recover");
  assert.equal(window.MvuUi.state.demoLastRequests.createCondition.expectedRevision, 8);
});

test("many referenced rules stay in a searchable paged delete dialog and remain blocked", async (t) => {
  const window = await createApp("condition-library");
  t.after(() => window.close());
  const { document } = window;
  const template = plain(window.MvuUi.state.demoStore.rules[0]);
  for (let index = 2; index <= 23; index += 1) {
    window.MvuUi.state.demoStore.rules.push({ ...template, id: `rule-ref-${index}`, name: `受影响规则 ${String(index).padStart(2, "0")}`, conditionId: "condition-1" });
  }
  input(window, "[data-list-search-route='condition-library']", "主动关心");
  await waitFor(() => document.querySelector("[data-condition-row='condition-1']"), "referenced condition search did not finish");
  click(window, "[data-condition-row='condition-1'] [data-action='delete-condition']");
  await waitFor(() => document.querySelector(".condition-reference-dialog [data-reference-page='next']"), "paged reference controls did not render");
  assert.equal(document.querySelectorAll(".condition-reference-list li").length, 10);
  assert.match(document.querySelector("[data-condition-reference-meta]").textContent, /显示 1–10 \/ 共 23 条/);
  input(window, "[data-condition-reference-search]", "规则 09");
  assert.equal(document.querySelectorAll(".condition-reference-list li").length, 1);
  assert.match(document.querySelector(".condition-reference-list").textContent, /受影响规则 09/);
  input(window, "[data-condition-reference-search]", "");
  click(window, "[data-reference-page='next']");
  await waitFor(() => /显示 11–20/.test(document.querySelector("[data-condition-reference-meta]").textContent), "reference next page did not load");
  assert.equal(document.querySelector("[data-action='confirm-condition-delete']"), null);
});

test("demo condition mutations reject unknown keys invalid references and referenced deletes without changing revision", async (t) => {
  const window = await createApp("condition-library");
  t.after(() => window.close());
  const startRevision = window.MvuUi.state.demoStore.revision;
  await assert.rejects(window.MvuUi.native.call("createCondition", {
    expectedRevision: startRevision,
    condition: { name: "越界", description: "", enabled: true, expression: { kind: "predicate", predicate: { kind: "user_care" } }, rogue: true },
  }), /INVALID/);
  await assert.rejects(window.MvuUi.native.call("createCondition", {
    expectedRevision: startRevision,
    condition: { name: "失效字段", description: "", enabled: true, expression: { kind: "predicate", predicate: { kind: "field_comparison", fieldId: "missing-field", operator: ">=", value: 1 } } },
  }), /FIELD_NOT_FOUND/);
  await assert.rejects(window.MvuUi.native.call("deleteCondition", {
    expectedRevision: startRevision, id: "condition-1",
  }), /REFERENCED/);
  assert.equal(window.MvuUi.state.demoStore.revision, startRevision);
});

test("existing custom AI predicate keeps its stable id while editing and can be removed without expression loss", async (t) => {
  const window = await createApp("condition-library");
  t.after(() => window.close());
  const { document } = window;
  const source = window.MvuUi.state.demoStore.conditions.find((condition) => condition.id === "demo-condition-20");
  source.expression = {
    kind: "and",
    children: [
      { kind: "predicate", predicate: { kind: "ai_semantic", id: "ai_keep_me", triggerType: "旧自定义类型", requirement: "旧要求", minimumConfidence: 0.55 } },
      { kind: "predicate", predicate: { kind: "user_care" } },
    ],
  };
  window.MvuUi.state.entities.clear();
  window.MvuUi.state.selectedEntityId = source.id;
  window.MvuUi.resetConditionEditorDraft();
  await window.MvuUi.navigate("condition-editor");

  assert.equal(document.querySelector('[data-condition-ai-id][data-condition-path="0"]').textContent.trim(), "ai_keep_me");
  input(window, '[data-condition-prop="triggerType"][data-condition-path="0"]', "新的自定义类型");
  input(window, '[data-condition-prop="requirement"][data-condition-path="0"]', "新的可读触发要求");
  input(window, '[data-condition-prop="minimumConfidence"][data-condition-path="0"]', "0.91");
  submit(window);
  await waitFor(() => window.MvuUi.state.route === "condition-library", "AI predicate edit did not save");
  assert.deepEqual(plain(window.MvuUi.state.demoLastRequests.updateCondition.patch.expression.children[0].predicate), {
    kind: "ai_semantic", id: "ai_keep_me", triggerType: "新的自定义类型", requirement: "新的可读触发要求", minimumConfidence: 0.91,
  });

  window.MvuUi.state.selectedEntityId = source.id;
  window.MvuUi.resetConditionEditorDraft();
  await window.MvuUi.navigate("condition-editor");
  click(window, '[data-action="remove-condition-node"][data-condition-path="0"]');
  submit(window);
  await waitFor(() => window.MvuUi.state.route === "condition-library", "AI predicate removal did not save");
  assert.deepEqual(plain(window.MvuUi.state.demoLastRequests.updateCondition.patch.expression), {
    kind: "and", children: [{ kind: "predicate", predicate: { kind: "user_care" } }],
  });
});

test("committed list mutation shows refresh-only recovery and cannot be accidentally repeated", async (t) => {
  const window = await createApp("condition-library");
  t.after(() => window.close());
  const { document } = window;
  input(window, "[data-list-search-route='condition-library']", "演示条件 20");
  await waitFor(() => document.querySelector("[data-condition-row='demo-condition-20']"), "condition search did not finish");

  const originalCall = window.MvuUi.native.call.bind(window.MvuUi.native);
  let toggleCalls = 0;
  let failRefresh = true;
  window.MvuUi.native.call = async function (method, params) {
    if (method === "toggleCondition") toggleCalls += 1;
    const result = await originalCall(method, params);
    if (method === "snapshot" && toggleCalls && failRefresh) {
      failRefresh = false;
      throw new Error("list refresh unavailable");
    }
    return result;
  };
  click(window, "[data-condition-row='demo-condition-20'] [data-action='toggle-condition']");
  await waitFor(() => document.querySelector("[data-condition-list-recovery]"), "committed list refresh failure did not render recovery");
  assert.match(document.querySelector("[data-condition-list-recovery]").textContent, /已经提交|只重新载入/);
  assert.equal(document.querySelector("[data-condition-row='demo-condition-20'] [data-action='toggle-condition']").disabled, true);
  click(window, "[data-condition-row='demo-condition-20'] [data-action='toggle-condition']");
  assert.equal(toggleCalls, 1, "committed toggle was repeated before authoritative refresh");
  click(window, '[data-action="reload-condition-library"]');
  await waitFor(() => !document.querySelector("[data-condition-list-recovery]"), "condition list recovery did not clear");
  assert.equal(window.MvuUi.state.snapshot.revision, 8);
});

test("condition editor CSS stays compact and overflow-safe at 320px and reduced motion", async () => {
  const styles = await readFile(path.join(root, "static", "app_ui", "styles.css"), "utf8");
  assert.match(styles, /\.condition-editor\s*\{[^}]*min-width:\s*0;[^}]*overflow-x:\s*hidden;/s);
  assert.match(styles, /\.condition-node-card\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*transition:[^}]*(?:180|200|220)ms/s);
  assert.match(styles, /\.condition-children\s*\{[^}]*min-width:\s*0;[^}]*display:\s*grid;[^}]*gap:\s*(?:6|8|10|12)px;/s);
  assert.match(styles, /@media\s*\(max-width:\s*350px\)[\s\S]*?\.condition-row-main[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+22px;/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.condition-node-card[\s\S]*?(?:animation|transition):\s*none\s*!important;/);
  assert.doesNotMatch(styles, /\.condition-(?:editor|node-card|predicate-fields)[^{]*\{[^}]*font-size:\s*(?:[0-9]|10)px/s);
});

test("every production predicate is exposed as a real editable DOM card, not only a serializer token", async (t) => {
  const window = await createApp("condition-editor");
  t.after(() => window.close());
  Object.defineProperty(window.document, "startViewTransition", { configurable: true, value: undefined });
  const { document } = window;
  const vocabulary = {
    recent_positive: ['[data-condition-prop="count"]'],
    long_inactive: ['[data-condition-prop="hours"]'],
    user_care: [".predicate-note"],
    special_day: [".predicate-note"],
    high_frequency: ['[data-condition-prop="messages"]', '[data-condition-prop="windowHours"]', '[data-condition-prop="bucketHours"]'],
    field_comparison: ['[data-condition-picker="field"]', '[data-condition-prop="operator"]', '[data-condition-prop="value"]'],
    message_count: ['[data-condition-prop="count"]', '[data-condition-prop="windowHours"]', '[data-condition-prop="sender"]'],
    keywords: ['[data-condition-prop="includeAny"]', '[data-condition-prop="includeAll"]', '[data-condition-prop="exclude"]', '[data-condition-prop="windowHours"]', '[data-condition-prop="caseSensitive"]'],
    sender: ['[data-condition-sender="user"]', '[data-condition-sender="character"]'],
    actor: ['[data-condition-picker="actor"]'],
    group: ['[data-condition-picker="group"]'],
    concrete_date: ['[data-condition-prop="dates"]'],
    repeating_date: ['[data-condition-prop="month"]', '[data-condition-prop="day"]'],
    ai_semantic: ['[data-condition-ai-id]', '[data-condition-prop="triggerType"]', '[data-condition-prop="requirement"]', '[data-condition-prop="minimumConfidence"]'],
  };
  click(window, '[data-action="add-condition-predicate"][data-condition-path=""]');
  assert.deepEqual(Array.from(document.querySelectorAll("[data-condition-predicate-kind] option"), (option) => option.value), Object.keys(vocabulary));
  for (const [kind, selectors] of Object.entries(vocabulary)) {
    if (kind !== "recent_positive") change(window, '[data-condition-predicate-kind][data-condition-path="0"]', kind);
    assert.equal(window.MvuUi.state.conditionEditorDraft.expression.children[0].predicate.kind, kind);
    window.MvuUi.render();
    assert.ok(document.querySelector(`[data-condition-predicate-kind][data-condition-path="0"] option[value="${kind}"][selected]`));
    for (const selector of selectors) assert.ok(document.querySelector(`[data-condition-node][data-condition-path="0"] ${selector}`), `${kind} is missing ${selector}`);
  }
});

test("real Chromium has no horizontal overflow at 320px and 130% text with a depth-12 AI editor", async (t) => {
  const server = await startStaticServer();
  const address = server.address();
  const browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutable() });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const origin = `http://127.0.0.1:${address.port}`;
  const evidence = [];
  for (const scale of [100, 130]) {
    const page = await browser.newPage({ viewport: { width: 320, height: 1000 } });
    const file = scale === 130 ? "/tests/fixtures/ui-text-scale.html" : "/dist/app.html";
    await page.goto(`${origin}${file}?demo=1&route=condition-editor`, { waitUntil: "networkidle" });
    if (scale === 130) await page.waitForFunction(() => document.documentElement.dataset.fontScaleReady === "130");
    await page.locator(".condition-tree").waitFor();
    await page.evaluate(async () => {
      let expression = { kind: "predicate", predicate: { kind: "ai_semantic", id: "ai_depth_pressure", triggerType: "自定义关系转折", requirement: "在紧凑视图中仍完整显示触发要求和最低置信度。", minimumConfidence: 0.88 } };
      for (let depth = 0; depth < 12; depth += 1) expression = { kind: "not", child: expression };
      window.MvuUi.state.conditionEditorDraft.expression = expression;
      await window.MvuUi.navigate("condition-editor", { force: true, replace: true });
    });
    await page.waitForFunction(() => document.querySelectorAll("[data-condition-node]").length === 13);
    const metrics = await page.evaluate(() => {
      const editor = document.querySelector(".condition-editor");
      const tree = document.querySelector(".condition-tree");
      const cards = Array.from(document.querySelectorAll("[data-condition-node]"));
      const rectOverflow = cards.filter((card) => {
        const rect = card.getBoundingClientRect();
        return rect.left < -0.5 || rect.right > innerWidth + 0.5;
      }).length;
      const bodyStyle = getComputedStyle(document.body);
      return {
        viewport: innerWidth,
        bodyFontSize: parseFloat(bodyStyle.fontSize),
        bodyLineHeight: parseFloat(bodyStyle.lineHeight),
        bodyFontFamily: bodyStyle.fontFamily,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        appOverflow: document.getElementById("appRoot").scrollWidth - document.getElementById("appRoot").clientWidth,
        editorOverflow: editor.scrollWidth - editor.clientWidth,
        treeOverflow: tree.scrollWidth - tree.clientWidth,
        rectOverflow,
        nodeCount: cards.length,
        aiControls: document.querySelectorAll(".ai-predicate-fields input, .ai-predicate-fields textarea").length,
      };
    });
    const factor = scale / 100;
    assert.ok(Math.abs(metrics.bodyFontSize - 14 * factor) < 0.08, JSON.stringify(metrics));
    assert.ok(Math.abs(metrics.bodyLineHeight - 21 * factor) < 0.08, JSON.stringify(metrics));
    assert.match(metrics.bodyFontFamily, /Roboto.*Noto Sans SC.*system-ui.*sans-serif/);
    assert.ok(metrics.documentOverflow <= 0 && metrics.appOverflow <= 0 && metrics.editorOverflow <= 0 && metrics.treeOverflow <= 0, JSON.stringify(metrics));
    assert.equal(metrics.rectOverflow, 0, JSON.stringify(metrics));
    assert.equal(metrics.nodeCount, 13);
    assert.equal(metrics.aiControls, 3);
    evidence.push({ scale, ...metrics });
    await page.close();
  }
  t.diagnostic(`320px condition editor pressure evidence: ${JSON.stringify(evidence)}`);
});
