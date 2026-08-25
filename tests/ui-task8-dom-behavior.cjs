const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

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

function builtScriptBlock(html, sourceName) {
  const escaped = sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<script\\s+data-source="${escaped}"[^>]*>[\\s\\S]*?<\\/script>`, "i"));
  assert.ok(match, `missing built script fixture ${sourceName}`);
  return match[0];
}

async function waitFor(predicate, message, timeoutMs = 2_000) {
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
  const actualOrder = scripts.map((script) => script.name);
  if (actualOrder.length !== builtScriptOrder.length ||
      actualOrder.some((name, index) => name !== builtScriptOrder[index])) {
    throw new Error(`MVU_BUILT_SCRIPT_ORDER_INVALID:${actualOrder.join(",")}`);
  }
  return {
    markup: html.replace(scriptPattern, ""),
    scripts,
  };
}

async function createApp(route, options = {}) {
  const html = options.builtHtml || await readFile(path.join(root, "dist", "app.html"), "utf8");
  const artifact = parseBuiltArtifact(html);
  const { Window } = await import("happy-dom");
  const window = new Window({ url: `https://mvu.local/app.html?demo=1&route=${route}` });
  window.document.open();
  window.document.write(artifact.markup);
  window.document.close();
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  }
  for (const script of artifact.scripts) {
    window.eval(`${script.source}\n//# sourceURL=dist/app.html?data-source=${script.name}`);
  }
  await waitFor(
    () => window.document.querySelector(".app-screen") && !window.document.querySelector(".boot-state"),
    `app did not boot route ${route}`,
  );
  return window;
}

test("DOM gate rejects built artifact script omission and order mutations", async () => {
  const html = await readFile(path.join(root, "dist", "app.html"), "utf8");
  const runtime = builtScriptBlock(html, "runtime.js");
  const components = builtScriptBlock(html, "components.js");
  const omitted = html.replace(components, "");
  const reordered = html
    .replace(runtime, "<!-- task8-runtime-slot -->")
    .replace(components, runtime)
    .replace("<!-- task8-runtime-slot -->", components);

  await assert.rejects(
    createApp("status", { builtHtml: omitted }).then((window) => { window.close(); }),
    /MVU_BUILT_SCRIPT_ORDER_INVALID/,
  );
  await assert.rejects(
    createApp("status", { builtHtml: reordered }).then((window) => { window.close(); }),
    /MVU_BUILT_SCRIPT_ORDER_INVALID/,
  );
});

test("next-page DOM patch preserves the live scroll container and logical pagination focus", async (t) => {
  const window = await createApp("config-fields");
  t.after(() => window.close());
  const { document } = window;
  const scroll = document.querySelector(".screen-scroll");
  const next = document.querySelector('[data-page-route="config-fields"][data-page-direction="next"]');
  assert.ok(scroll);
  assert.ok(next);
  assert.equal(document.querySelector(".list-meta").textContent.trim(),
    "已显示 5 个字段 / 匹配 13 个字段 / 共 13 个字段");

  scroll.scrollTop = 137;
  next.focus();
  next.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await waitFor(
    () => window.MvuUi.state.listViews.fields.page === 2,
    "next-page request did not settle",
  );
  await waitFor(
    () => /第 2 页/.test(document.querySelector(".pagination")?.textContent || ""),
    "next-page DOM patch did not render",
    5_000,
  );

  const restored = document.querySelector('[data-page-route="config-fields"][data-page-direction="next"]');
  assert.equal(document.querySelector(".screen-scroll"), scroll);
  assert.equal(document.activeElement, restored);
  assert.equal(scroll.scrollTop, 137);
  assert.equal(document.querySelector(".list-meta").textContent.trim(),
    "已显示 5 个字段 / 匹配 13 个字段 / 共 13 个字段");
});

test("group status finder exposes only all authoritative members and restores its live opener after selection", async (t) => {
  const window = await createApp("status");
  t.after(() => window.close());
  const { document } = window;
  const finder = document.querySelector('[data-picker-key="status-actor-finder"]');
  assert.ok(finder);
  assert.equal(finder.textContent.includes("查找角色（共 50）"), true);

  finder.focus();
  finder.click();
  await waitFor(
    () => window.MvuUi.state.entityPicker?.orderIds.length === 30,
    "status actor picker first page did not load",
  );
  const picker = window.MvuUi.state.entityPicker;
  assert.equal(picker.totalCount, 50);
  assert.equal(picker.allTotalCount, 50);
  assert.equal(picker.orderIds.length, 30);
  assert.equal(picker.itemById.has("picker-actor-002"), false);
  const groupFilter = document.querySelector('[data-picker-filter="groupId"]');
  assert.equal(groupFilter.disabled, true);
  await assert.rejects(
    window.MvuUi.updateEntityPickerFilter("groupId", "", "string"),
    /MVU_PICKER_FILTER_LOCKED/,
  );

  const results = document.querySelector("[data-picker-results]");
  Object.defineProperty(results, "clientHeight", { configurable: true, value: 280 });
  results.scrollTop = 35 * 56;
  results.dispatchEvent(new window.Event("scroll", { bubbles: true }));
  await waitFor(() => window.MvuUi.state.entityPicker?.orderIds.length === 50, "tail group members did not load");
  results.scrollTop = 35 * 56;
  results.dispatchEvent(new window.Event("scroll", { bubbles: true }));
  await waitFor(
    () => document.querySelector('[data-picker-id="picker-actor-077"]'),
    "member beyond the compact first 30 was not rendered",
  );
  assert.ok(document.querySelectorAll("[data-picker-results] .picker-result").length <= 24);
  document.querySelector('[data-picker-id="picker-actor-077"]').click();

  await waitFor(
    () => window.MvuUi.state.snapshot.activeContext.actorId === "picker-actor-077" &&
      !document.querySelector(".entity-picker"),
    "status context selection did not settle",
  );
  const restored = document.querySelector('[data-picker-key="status-actor-finder"]');
  await waitFor(() => document.activeElement === restored, "logical status opener focus was not restored");
  assert.equal(window.MvuUi.state.snapshot.activeContext.groupId, "group-a");
  assert.equal(restored.textContent.includes("查找角色（共 50）"), true);
});

test("picker cache cap pauses only auto-fetch and keeps retained DOM without a destructive retry", async (t) => {
  const window = await createApp("rule-editor");
  t.after(() => window.close());
  const { document } = window;
  const actorKind = document.querySelector('[name="ruleActorKind"]');
  actorKind.value = "selected";
  actorKind.dispatchEvent(new window.Event("change", { bubbles: true }));
  document.querySelector('[data-picker-key="rule-trigger-selected"]').click();
  await waitFor(() => window.MvuUi.state.entityPicker?.orderIds.length === 30, "actor picker first page did not load");
  const picker = window.MvuUi.state.entityPicker;
  picker.retainedPageLimit = 1;
  const retainedIds = [...picker.orderIds];
  const results = document.querySelector("[data-picker-results]");
  Object.defineProperty(results, "clientHeight", { configurable: true, value: 280 });
  results.scrollTop = 10_000;
  results.dispatchEvent(new window.Event("scroll", { bubbles: true }));
  await waitFor(() => picker.autoFetchBlocked, "cache limit did not pause auto-fetch");

  assert.equal(Array.from(picker.orderIds).join("\n"), retainedIds.join("\n"));
  assert.equal(picker.selectedIds.size, 0);
  assert.match(document.querySelector("[data-picker-results]").textContent, /缩小搜索范围/);
  assert.equal(document.querySelector('[data-action="retry-entity-picker"]'), null);
  assert.ok(document.querySelectorAll("[data-picker-results] .picker-result").length <= 24);
});
