const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const appScripts = [
  "static/app_ui/runtime.js",
  "static/app_ui/components.js",
  "static/app_ui/pages-status.js",
  "static/app_ui/pages-config.js",
  "static/app_ui/pages-rules.js",
  "static/app_ui/pages-advanced.js",
  "static/app_ui/app.js",
];

async function waitFor(predicate, message, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

async function createApp(route) {
  const { Window } = await import("happy-dom");
  const window = new Window({ url: `https://mvu.local/app.html?demo=1&route=${route}` });
  window.document.body.innerHTML = [
    '<main id="appRoot"></main>',
    '<input id="backgroundPicker" type="file">',
    '<input id="datasetImportPicker" type="file">',
    '<div id="toast"></div>',
  ].join("");
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  }
  for (const relativePath of appScripts) {
    const source = await readFile(path.join(root, relativePath), "utf8");
    window.eval(`${source}\n//# sourceURL=${relativePath.replaceAll("\\", "/")}`);
  }
  await waitFor(
    () => window.document.querySelector(".app-screen") && !window.document.querySelector(".boot-state"),
    `app did not boot route ${route}`,
  );
  return window;
}

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
  document.querySelector('[data-picker-key="rule-trigger-actors"]').click();
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
