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
  for (const script of artifact.scripts) window.eval(`${script.source}\n//# sourceURL=dist/app.html?data-source=${script.name}`);
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

function setChecked(window, selector, checked) {
  const element = window.document.querySelector(selector);
  assert.ok(element, `missing checkbox ${selector}`);
  element.checked = checked;
  element.dispatchEvent(new window.Event("change", { bubbles: true }));
  return element;
}

function submit(window, selector) {
  const form = window.document.querySelector(selector);
  assert.ok(form, `missing submit form ${selector}`);
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

async function choosePicker(window, openerSelector, search, multiple = false) {
  click(window, openerSelector);
  await waitFor(() => window.document.querySelector(".entity-picker [data-picker-search]"), "picker did not open");
  input(window, ".entity-picker [data-picker-search]", search);
  await waitFor(() => {
    const row = window.document.querySelector(".entity-picker [data-picker-id]");
    return row && row.textContent.includes(search);
  }, `picker did not return ${search}`);
  const row = window.document.querySelector(".entity-picker [data-picker-id]");
  const id = row.dataset.pickerId;
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  if (multiple) click(window, '[data-action="confirm-entity-picker"]');
  await waitFor(() => !window.document.querySelector(".entity-picker"), "picker did not close");
  return id;
}

function resolveChromiumExecutable() {
  const candidates = [process.env.TASK9_CHROME_PATH];
  if (process.platform === "win32") {
    candidates.push(
      path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
    );
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  } else {
    candidates.push("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/microsoft-edge");
  }
  try { candidates.push(chromium.executablePath()); } catch (_error) { /* installed browser is resolved below */ }
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
      const type = ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" })[path.extname(fileName)] || "application/octet-stream";
      response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      response.end(body);
    } catch (_error) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

test("rule library uses exact five-row production paging with search statistics and real row actions", async (t) => {
  const window = await createApp("rule-library");
  t.after(() => window.close());
  const { document } = window;
  assert.equal(document.querySelectorAll("[data-rule-row]").length, 5);
  assert.match(document.querySelector(".list-meta").textContent, /显示 1–5 \/ 共 13 条规则/);
  const row = document.querySelector("[data-rule-row]");
  assert.ok(row.querySelector("[data-open-entity='rule']"), "whole rule row must open editor");
  assert.ok(row.querySelector("[data-action='toggle-rule']"));
  assert.ok(row.querySelector("[data-action='copy-rule']"));
  assert.ok(row.querySelector("[data-action='delete-rule']"));
  input(window, "[data-list-search-route='rule-library']", "演示规则 12");
  await waitFor(() => document.querySelectorAll("[data-rule-row]").length === 1, "rule search did not narrow results");
  assert.match(document.querySelector(".list-meta").textContent, /显示 1–1 \/ 匹配 1 \/ 共 13 条规则/);
  assert.match(document.querySelector("[data-rule-row]").textContent, /演示规则 12/);
});

test("effect library uses exact ten-row production paging with search statistics and visible creation", async (t) => {
  const window = await createApp("effect-library");
  t.after(() => window.close());
  const { document } = window;
  assert.equal(document.querySelectorAll("[data-effect-row]").length, 10);
  assert.match(document.querySelector(".list-meta").textContent, /显示 1–10 \/ 共 24 个效果组/);
  assert.ok(document.querySelector("[data-new-entity='effectGroup']"));
  const row = document.querySelector("[data-effect-row]");
  assert.ok(row.querySelector("[data-open-entity='effectGroup']"));
  assert.ok(row.querySelector("[data-action='toggle-effect-group']"));
  assert.ok(row.querySelector("[data-action='copy-effect-group']"));
  assert.ok(row.querySelector("[data-action='delete-effect-group']"));
  input(window, "[data-list-search-route='effect-library']", "演示效果 23");
  await waitFor(() => document.querySelectorAll("[data-effect-row]").length === 1, "effect search did not narrow results");
  assert.match(document.querySelector(".list-meta").textContent, /显示 1–1 \/ 匹配 1 \/ 共 24 个效果组/);
});

test("rule list toggle copy and unreferenced delete send revisioned mutations then refresh authoritative data", async (t) => {
  const window = await createApp("rule-library");
  t.after(() => window.close());
  const { document } = window;
  click(window, "[data-rule-row='demo-rule-01'] [data-action='toggle-rule']");
  await waitFor(() => window.MvuUi.state.demoLastRequests.toggleRule, "toggleRule was not called");
  assert.deepEqual(plain(window.MvuUi.state.demoLastRequests.toggleRule), { id: "demo-rule-01", enabled: true, expectedRevision: 7 });
  await waitFor(() => window.MvuUi.state.snapshot.revision === 8, "toggle did not refresh revision");
  click(window, "[data-rule-row='demo-rule-01'] [data-action='copy-rule']");
  await waitFor(() => window.MvuUi.state.demoLastRequests.copyRule, "copyRule was not called");
  assert.equal(window.MvuUi.state.demoLastRequests.copyRule.expectedRevision, 8);
  await waitFor(() => window.MvuUi.state.snapshot.revision === 9, "copy did not refresh revision");
  click(window, "[data-rule-row='demo-rule-01'] [data-action='delete-rule']");
  await waitFor(() => document.querySelector("[data-management-delete-dialog='rule']"), "delete reference check did not open");
  click(window, "[data-action='confirm-management-delete']");
  await waitFor(() => window.MvuUi.state.demoLastRequests.deleteRule, "deleteRule was not called");
  assert.equal(window.MvuUi.state.demoLastRequests.deleteRule.expectedRevision, 9);
  await waitFor(() => window.MvuUi.state.snapshot.revision === 10, "delete did not refresh revision");
});

test("referenced effect group deletion is blocked and names the affected rule", async (t) => {
  const window = await createApp("effect-library");
  t.after(() => window.close());
  click(window, "[data-effect-row='effect-1'] [data-action='delete-effect-group']");
  await waitFor(() => window.document.querySelector("[data-management-delete-dialog='effectGroup']"), "effect reference dialog did not open");
  const dialog = window.document.querySelector("[data-management-delete-dialog='effectGroup']");
  assert.match(dialog.textContent, /关心回应/);
  assert.match(dialog.textContent, /先从规则中移除|仍被引用/);
  assert.equal(dialog.querySelector("[data-action='confirm-management-delete']"), null);
  assert.equal(window.MvuUi.state.demoLastRequests.deleteEffectGroup, undefined);
});

test("rule editor exposes ordered sections and keeps trigger actor condition and result semantics separate", async (t) => {
  const window = await createApp("rule-editor");
  t.after(() => window.close());
  const form = window.document.querySelector('[data-form="rule-editor"]');
  assert.ok(form);
  const headings = Array.from(form.querySelectorAll(".editor-section h2"), (heading) => heading.textContent.trim());
  assert.deepEqual(headings.slice(0, 4), ["基础信息", "触发角色绑定", "条件", "触发后改变的字段内容"]);
  assert.ok(form.querySelector('[name="ruleActorKind"] option[value="any"]'));
  assert.ok(form.querySelector('[name="ruleActorKind"] option[value="current_actor"]'));
  assert.ok(form.querySelector('[name="ruleActorKind"] option[value="selected"]'));
  assert.ok(form.querySelector('[name="ruleActorKind"] option[value="group"]'));
  assert.ok(form.querySelector("[data-rule-condition-picker]"));
  assert.equal(form.querySelector(".result-section [data-condition-predicate-kind]"), null, "trigger conditions must never be mixed into results");
});

test("rule editor saves searchable actor condition field and multiple effect results with exact production payload", async (t) => {
  const window = await createApp("rule-editor");
  t.after(() => window.close());
  Object.defineProperty(window.document, "startViewTransition", { configurable: true, value: undefined });
  input(window, '[name="ruleName"]', "T 角色事件规则");
  input(window, '[name="ruleDescription"]', "T 触发 B 后只改变 T 的 A 欲望");
  change(window, '[name="ruleActorKind"]', "selected");
  const actorId = await choosePicker(window, "[data-rule-trigger-picker]", "游标角色 001", true);
  const conditionId = await choosePicker(window, "[data-rule-condition-picker]", "游标条件 001");
  click(window, '[data-action="add-rule-change"]');
  const fieldId = await choosePicker(window, '[data-rule-change-field][data-action-index="0"]', "游标字段 001");
  change(window, '[data-rule-target-kind][data-action-index="0"]', "trigger_actor");
  input(window, '[data-rule-delta][data-action-index="0"]', "-30");
  const effectId = await choosePicker(window, '[data-rule-change-effects][data-action-index="0"]', "游标效果 001", true);
  click(window, '[data-action="add-rule-effect-activation"]');
  await choosePicker(window, '[data-rule-activation-effect][data-action-index="1"]', "游标效果 002");
  input(window, '[name="ruleCooldownHours"]', "1.5");
  input(window, '[name="ruleExecutionOrder"]', "4");
  submit(window, '[data-form="rule-editor"]');
  await waitFor(() => window.MvuUi.state.demoLastRequests.createRule, "createRule was not called");
  assert.deepEqual(plain(window.MvuUi.state.demoLastRequests.createRule), {
    expectedRevision: 7,
    rule: {
      name: "T 角色事件规则",
      description: "T 触发 B 后只改变 T 的 A 欲望",
      enabled: true,
      triggerActorSelector: { kind: "selected", actorIds: [actorId] },
      conditionId,
      actions: [
        { kind: "change_field", fieldId, target: { kind: "trigger_actor" }, delta: -30, effectGroupIds: [effectId] },
        { kind: "activate_effect_group", effectGroupId: "picker-effect-002" },
      ],
      cooldownHours: 1.5,
      executionOrder: 4,
    },
  });
  await waitFor(() => window.MvuUi.state.route === "rule-library", "rule editor did not return to library after authoritative refresh");
});

test("existing rule condition can be opened and a missing condition reference has a searchable repair action", async (t) => {
  const window = await createApp("rule-library");
  t.after(() => window.close());
  click(window, "[data-rule-row='rule-1'] [data-open-entity='rule']");
  await waitFor(() => window.MvuUi.state.route === "rule-editor" && window.document.querySelector("[data-rule-condition-summary]"), "rule editor did not open");
  assert.match(window.document.querySelector("[data-rule-condition-summary]").textContent, /主动关心/);
  assert.ok(window.document.querySelector("[data-action='edit-rule-condition']"));
  window.MvuUi.state.ruleEditorDraft.conditionId = "missing-condition";
  window.MvuUi.state.ruleEditorDraft.condition = null;
  window.MvuUi.state.ruleEditorDraft.conditionMissing = true;
  window.MvuUi.render();
  const repair = window.document.querySelector("[data-rule-condition-repair]");
  assert.ok(repair);
  assert.match(repair.textContent, /条件引用已失效|重新选择/);
  click(window, "[data-rule-condition-picker]");
  await waitFor(() => window.document.querySelector(".entity-picker [data-picker-search]"), "repair picker did not open");
});

test("effect editor is field-first and saves the T/A/B trigger-actor semantics with two operations", async (t) => {
  const window = await createApp("effect-editor");
  t.after(() => window.close());
  Object.defineProperty(window.document, "startViewTransition", { configurable: true, value: undefined });
  input(window, '[name="effectName"]', "T 的 A 欲望响应");
  input(window, '[name="effectDescription"]', "T 触发 B 后，仅 T 的 A 欲望变化");
  click(window, '[data-action="add-field-effect"]');
  const fieldId = await choosePicker(window, '[data-effect-field-picker][data-field-effect-index="0"]', "游标字段 001");
  change(window, '[data-effect-actor-kind][data-field-effect-index="0"]', "trigger_actor");
  change(window, '[data-effect-operation-kind][data-field-effect-index="0"][data-operation-index="0"]', "immediate_delta");
  input(window, '[data-effect-operation-value][data-field-effect-index="0"][data-operation-index="0"]', "-30");
  click(window, '[data-action="add-effect-operation"][data-field-effect-index="0"]');
  change(window, '[data-effect-operation-kind][data-field-effect-index="0"][data-operation-index="1"]', "all_multiplier");
  input(window, '[data-effect-operation-value][data-field-effect-index="0"][data-operation-index="1"]', "0.5");
  setChecked(window, '[data-effect-operation-source="manual"][data-field-effect-index="0"][data-operation-index="1"]', false);
  setChecked(window, '[data-effect-operation-source="rule"][data-field-effect-index="0"][data-operation-index="1"]', true);
  click(window, '[data-reason-mode="template"]');
  change(window, '[name="effectReasonTemplate"]', "rule");
  change(window, '[name="effectDurationMode"]', "turns");
  input(window, '[name="effectRemainingTurns"]', "3");
  submit(window, '[data-form="effect-editor"]');
  await waitFor(() => window.MvuUi.state.demoLastRequests.createEffectGroup, "createEffectGroup was not called");
  const request = plain(window.MvuUi.state.demoLastRequests.createEffectGroup);
  assert.equal(request.expectedRevision, 7);
  assert.deepEqual(request.effectGroup, {
    name: "T 的 A 欲望响应",
    description: "T 触发 B 后，仅 T 的 A 欲望变化",
    enabled: true,
    fieldEffects: [{
      id: request.effectGroup.fieldEffects[0].id,
      fieldId,
      actorSelector: { kind: "trigger_actor" },
      operations: [
        { kind: "immediate_delta", value: -30 },
        { kind: "all_multiplier", value: 0.5, sources: ["rule"] },
      ],
    }],
    defaultReason: { mode: "template", template: "rule", text: "" },
    defaultDuration: { expiresAt: null, remainingTurns: 3 },
  });
  await waitFor(() => window.MvuUi.state.route === "effect-library", "effect editor did not refresh library");
});

test("effect reason stays visible with six templates variables preview 512 limit and legacy read compatibility", async (t) => {
  const window = await createApp("effect-editor");
  t.after(() => window.close());
  const { document } = window;
  assert.deepEqual(
    Array.from(document.querySelectorAll('[name="effectReasonTemplate"] option'), (option) => option.value),
    ["general", "rule", "natural", "per_turn", "ai", "manual"],
  );
  assert.match(document.querySelector("[data-effect-reason-variables]").textContent, /效果组名称|字段名称|触发角色/);
  assert.ok(document.querySelector("[data-effect-reason-preview]"));
  click(window, '[data-reason-mode="custom"]');
  const reason = document.querySelector('[name="effectReasonText"]');
  assert.equal(reason.maxLength, 512);
  input(window, '[name="effectReasonText"]', "{触发角色} 因 {效果组名称} 改变 {字段名称}");
  assert.match(document.querySelector("[data-effect-reason-preview]").textContent, /触发角色|效果组|字段/);

  const existing = plain(window.MvuUi.state.demoStore.effectGroups[0]);
  existing.id = "legacy-long-reason";
  existing.defaultReason = { mode: "custom", template: "general", text: "旧".repeat(600) };
  window.MvuUi.state.demoStore.effectGroups.push(existing);
  window.MvuUi.state.entities.delete("effectGroup:legacy-long-reason");
  window.MvuUi.state.selectedEntityId = "legacy-long-reason";
  window.MvuUi.resetEffectEditorDraft();
  await window.MvuUi.navigate("effect-editor", { force: true });
  assert.equal(window.MvuUi.state.effectEditorDraft.reason.text.length, 600, "legacy reason must load without truncation");
  assert.match(window.document.querySelector("[data-effect-reason-legacy-warning]").textContent, /旧版|512/);
  submit(window, '[data-form="effect-editor"]');
  assert.match(window.document.querySelector("[data-effect-editor-error]").textContent, /512/);
  assert.equal(window.MvuUi.state.demoLastRequests.updateEffectGroup, undefined);
});

test("group and global fields honestly disable ineffective actor targeting", async (t) => {
  const window = await createApp("effect-editor");
  t.after(() => window.close());
  click(window, '[data-action="add-field-effect"]');
  await choosePicker(window, '[data-effect-field-picker][data-field-effect-index="0"]', "共享群组值");
  const groupSelector = window.document.querySelector('[data-effect-actor-kind][data-field-effect-index="0"]');
  assert.equal(groupSelector.value, "all_bound");
  assert.equal(groupSelector.disabled, true);
  assert.match(groupSelector.closest("[data-effect-actor-scope]").textContent, /群组字段|按绑定群组/);
  click(window, '[data-effect-field-picker][data-field-effect-index="0"]');
  await waitFor(() => window.document.querySelector(".entity-picker [data-picker-search]"));
  input(window, ".entity-picker [data-picker-search]", "全局共享值");
  await waitFor(() => window.document.querySelector(".entity-picker .picker-result")?.textContent.includes("全局共享值"));
  click(window, ".entity-picker .picker-result");
  const globalSelector = window.document.querySelector('[data-effect-actor-kind][data-field-effect-index="0"]');
  assert.equal(globalSelector.value, "all_bound");
  assert.equal(globalSelector.disabled, true);
  assert.match(globalSelector.closest("[data-effect-actor-scope]").textContent, /全局字段|共享值/);
});

test("rule and effect editors expose stable add remove and reorder controls without inline full datasets", async (t) => {
  const window = await createApp("rule-editor");
  t.after(() => window.close());
  click(window, '[data-action="add-rule-change"]');
  click(window, '[data-action="add-rule-change"]');
  assert.equal(window.document.querySelectorAll("[data-rule-change-card]").length, 2);
  assert.ok(window.document.querySelector('[data-action="move-rule-action-up"][data-action-index="1"]'));
  assert.ok(window.document.querySelector('[data-action="remove-rule-action"][data-action-index="0"]'));
  assert.equal(window.document.querySelectorAll("[data-rule-change-card] option[data-field-id]").length, 0, "fields must not be rendered inline");
  click(window, '[data-action="move-rule-action-up"][data-action-index="1"]');
  assert.equal(window.MvuUi.state.ruleEditorDraft.actions[0].clientId, window.document.querySelector("[data-rule-change-card]").dataset.actionClientId);

  window.MvuUi.state.selectedEntityId = "";
  await window.MvuUi.navigate("effect-editor");
  click(window, '[data-action="add-field-effect"]');
  click(window, '[data-action="add-field-effect"]');
  assert.equal(window.document.querySelectorAll("[data-field-effect-card]").length, 2);
  assert.ok(window.document.querySelector('[data-action="move-field-effect-up"][data-field-effect-index="1"]'));
  assert.equal(window.document.querySelectorAll("[data-field-effect-card] option[data-field-id]").length, 0);
});

test("real Chromium keeps rule and effect editors and opened pickers overflow-safe at 320px and 130 percent text", async (t) => {
  const server = await startStaticServer();
  const address = server.address();
  const browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutable() });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const origin = `http://127.0.0.1:${address.port}`;
  const evidence = [];
  for (const route of ["rule-editor", "effect-editor"]) {
    for (const scale of [100, 130]) {
      const page = await browser.newPage({ viewport: { width: 320, height: 1000 } });
      const file = scale === 130 ? "/tests/fixtures/ui-text-scale.html" : "/dist/app.html";
      await page.goto(`${origin}${file}?demo=1&route=${route}`, { waitUntil: "networkidle" });
      if (scale === 130) await page.waitForFunction(() => document.documentElement.dataset.fontScaleReady === "130");
      await page.locator(`[data-form="${route}"]`).waitFor();
      if (route === "rule-editor") {
        await page.locator('[data-action="add-rule-change"]').click();
        await page.locator('[data-rule-change-field]').click();
      } else {
        await page.locator('[data-action="add-field-effect"]').click();
        await page.locator('[data-effect-field-picker]').click();
      }
      await page.locator(".entity-picker [data-picker-search]").waitFor();
      const pickerMetrics = await page.evaluate(() => {
        const picker = document.querySelector(".entity-picker");
        const interactiveOverflow = Array.from(picker.querySelectorAll("button, input, select, textarea")).filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < -0.5 || rect.right > innerWidth + 0.5;
        }).length;
        return { pickerOverflow: picker.scrollWidth - picker.clientWidth, interactiveOverflow };
      });
      await page.locator('.entity-picker [data-action="close-entity-picker"]').first().click();
      await page.locator(".editor-submit").scrollIntoViewIfNeeded();
      const metrics = await page.evaluate(() => {
        const editor = document.querySelector(".rule-editor, .effect-editor");
        const bottomNav = document.querySelector(".bottom-nav");
        const submit = document.querySelector(".editor-submit");
        const bodyStyle = getComputedStyle(document.body);
        const interactiveOverflow = Array.from(document.querySelectorAll("button, input, select, textarea, [role='dialog']")).filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < -0.5 || rect.right > innerWidth + 0.5;
        }).length;
        return {
          route: location.search,
          viewport: innerWidth,
          bodyFontSize: parseFloat(bodyStyle.fontSize),
          bodyLineHeight: parseFloat(bodyStyle.lineHeight),
          bodyFontFamily: bodyStyle.fontFamily,
          documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          appOverflow: document.getElementById("appRoot").scrollWidth - document.getElementById("appRoot").clientWidth,
          editorOverflow: editor.scrollWidth - editor.clientWidth,
          interactiveOverflow,
          submitBottom: submit.getBoundingClientRect().bottom,
          navTop: bottomNav.getBoundingClientRect().top,
        };
      });
      const factor = scale / 100;
      assert.ok(Math.abs(metrics.bodyFontSize - 14 * factor) < 0.08, JSON.stringify(metrics));
      assert.ok(Math.abs(metrics.bodyLineHeight - 21 * factor) < 0.08, JSON.stringify(metrics));
      assert.match(metrics.bodyFontFamily, /Roboto.*Noto Sans SC.*system-ui.*sans-serif/);
      assert.ok(metrics.documentOverflow <= 0 && metrics.appOverflow <= 0 && metrics.editorOverflow <= 0 && pickerMetrics.pickerOverflow <= 0, JSON.stringify({ metrics, pickerMetrics }));
      assert.equal(pickerMetrics.interactiveOverflow, 0, JSON.stringify(pickerMetrics));
      assert.equal(metrics.interactiveOverflow, 0, JSON.stringify(metrics));
      assert.ok(metrics.submitBottom <= metrics.navTop + 0.5, JSON.stringify(metrics));
      evidence.push({ route, scale, ...metrics, ...pickerMetrics });
      await page.close();
    }
  }
  t.diagnostic(`320px rule/effect evidence: ${JSON.stringify(evidence)}`);
});
