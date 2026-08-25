const assert = require("node:assert/strict");
const http = require("node:http");
const { mkdir, readFile, writeFile } = require("node:fs/promises");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const artifactDirectory = path.join(root, "artifacts", "task-8-browser-smoke");
const executablePath = process.env.TASK8_CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const demoControls = "demo=1&demoPickerSlowSearch=" + encodeURIComponent("游标字段 001") +
  "&demoPickerSlowMs=320&demoPickerFailSearch=" + encodeURIComponent("故障");

function contentType(fileName) {
  return ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".png": "image/png", ".woff2": "font/woff2" })[path.extname(fileName)] || "application/octet-stream";
}

function startServer() {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      const requested = url.pathname === "/" ? "/dist/app.html" : decodeURIComponent(url.pathname);
      const fileName = path.resolve(root, "." + requested);
      if (!fileName.startsWith(root + path.sep)) throw new Error("outside root");
      const body = await readFile(fileName);
      response.writeHead(200, { "content-type": contentType(fileName), "cache-control": "no-store" });
      response.end(body);
    } catch (_error) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function routeUrl(origin, route, scaled = false) {
  const file = scaled ? "/tests/fixtures/ui-text-scale.html" : "/dist/app.html";
  return `${origin}${file}?${demoControls}&route=${route}`;
}

async function openPicker(page, pickerKey, title) {
  const opener = page.locator(`[data-picker-key="${pickerKey}"]`);
  await opener.click();
  const dialog = page.getByRole("dialog", { name: title });
  await dialog.waitFor({ state: "visible" });
  await page.waitForTimeout(230);
  return dialog;
}

async function assertLogicalOpenerFocus(page, pickerKey) {
  await page.waitForFunction((key) => document.activeElement && document.activeElement.dataset.pickerKey === key, pickerKey);
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.dataset.pickerKey), pickerKey);
}

async function closePath(page, pickerKey, action) {
  const dialog = await openPicker(page, pickerKey, "选择角色");
  await action(dialog);
  await dialog.waitFor({ state: "hidden" });
  await assertLogicalOpenerFocus(page, pickerKey);
}

async function main() {
  assert.equal(existsSync(executablePath), true, `Chrome not found: ${executablePath}`);
  await mkdir(artifactDirectory, { recursive: true });
  const server = await startServer();
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  const matrix = [];
  const screenshots = [];
  const focusPaths = [];
  try {
    await page.goto(routeUrl(origin, "natural-settings"), { waitUntil: "networkidle" });
    let fieldDialog = await openPicker(page, "change-natural-field", "选择字段");
    const fieldSearch = fieldDialog.getByRole("searchbox", { name: "搜索选择字段" });
    assert.equal(await fieldSearch.evaluate((element) => document.activeElement === element), true, "field search must receive focus");
    assert.equal(await fieldDialog.locator(".picker-result").count(), 30);
    assert.equal(await page.evaluate(() => window.MvuUi.state.entityPicker.totalCount), 96);

    await fieldDialog.locator("[data-picker-results]").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelectorAll(".entity-picker .picker-result").length === 60);
    assert.equal(await fieldDialog.locator(".picker-result").count(), 60, "near-boundary scroll must fetch the next cursor");
    await fieldDialog.locator("[data-picker-results]").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await page.waitForFunction(() => window.MvuUi.state.entityPicker && window.MvuUi.state.entityPicker.nextCursor === "demo:90");
    assert.equal(await fieldDialog.locator(".picker-result").count(), 60, "cursor appends must keep the result DOM bounded");

    await fieldSearch.fill("游标字段 001");
    await page.waitForTimeout(190);
    await fieldDialog.getByRole("searchbox", { name: "搜索选择字段" }).fill("游标字段 002");
    await page.waitForTimeout(380);
    assert.equal(await fieldDialog.getByText("游标字段 002", { exact: true }).count(), 1);
    assert.equal(await fieldDialog.getByText("游标字段 001", { exact: true }).count(), 0, "stale response must not replace the latest search");
    const searchScreenshot = path.join(artifactDirectory, "picker-search-stale-393.png");
    await page.screenshot({ path: searchScreenshot });
    screenshots.push(searchScreenshot);
    await fieldDialog.getByRole("option", { name: /游标字段 002/ }).click();
    await fieldDialog.waitFor({ state: "hidden" });
    await assertLogicalOpenerFocus(page, "change-natural-field");
    focusPaths.push("single-commit");

    await page.goto(routeUrl(origin, "rule-editor"), { waitUntil: "networkidle" });
    await closePath(page, "rule-trigger-actors", (dialog) => dialog.getByRole("button", { name: "关闭选择框" }).click());
    focusPaths.push("close");
    await closePath(page, "rule-trigger-actors", (dialog) => dialog.getByRole("searchbox", { name: "搜索选择角色" }).press("Escape"));
    focusPaths.push("escape");
    await closePath(page, "rule-trigger-actors", (dialog) => dialog.getByRole("button", { name: "取消" }).click());
    focusPaths.push("cancel");

    let actorDialog = await openPicker(page, "rule-trigger-actors", "选择角色");
    await actorDialog.getByRole("option", { name: /游标角色 001/ }).click();
    actorDialog = page.getByRole("dialog", { name: "选择角色" });
    assert.equal(await actorDialog.evaluate((element) => element.getAnimations().filter((animation) => animation.playState === "running").length), 0,
      "selection rerenders must not replay the picker entrance animation");
    await actorDialog.getByRole("option", { name: /游标角色 002/ }).click();
    await actorDialog.getByRole("searchbox", { name: "搜索选择角色" }).fill("故障");
    await page.waitForTimeout(230);
    assert.match(await actorDialog.locator(".picker-error").innerText(), /已保留所选项/);
    assert.equal(await actorDialog.locator(".picker-pinned-item").count(), 2, "failed search must preserve pinned selections");
    assert.deepEqual(await page.evaluate(() => Array.from(window.MvuUi.state.entityPicker.selectedIds)),
      ["picker-actor-001", "picker-actor-002"]);

    await page.evaluate(() => {
      const picker = window.MvuUi.state.entityPicker;
      picker.items.forEach((item) => {
        picker.selectedIds.add(item.characterId);
        picker.selectedItems.set(item.characterId, item);
      });
      window.MvuUi.render();
    });
    actorDialog = page.getByRole("dialog", { name: "选择角色" });
    assert.equal(await actorDialog.locator(".picker-pinned-item").count(), 12);
    assert.equal(await actorDialog.locator(".picker-pinned-overflow").innerText(), "另 18 项");
    assert.equal(await page.evaluate(() => window.MvuUi.state.entityPicker.selectedIds.size), 30);
    const pinnedScreenshot = path.join(artifactDirectory, "picker-pinned-window-393.png");
    await page.screenshot({ path: pinnedScreenshot });
    screenshots.push(pinnedScreenshot);
    await actorDialog.getByRole("button", { name: "确认选择（30）" }).click();
    await actorDialog.waitFor({ state: "hidden" });
    await assertLogicalOpenerFocus(page, "rule-trigger-actors");
    focusPaths.push("multi-confirm");

    const listCases = [
      ["config-fields", "本页 1–5 / 共 13 个字段", "搜索字段", "演示字段", "本页 1–5 · 匹配 12 / 共 13 个字段"],
      ["rule-library", "本页 1–5 / 共 13 条规则", "搜索规则设置", "演示规则", "本页 1–5 · 匹配 12 / 共 13 条规则"],
      ["condition-library", "本页 1–10 / 共 24 个条件", "搜索条件库", "演示条件", "本页 1–10 · 匹配 23 / 共 24 个条件"],
      ["effect-library", "本页 1–10 / 共 24 个效果组", "搜索临时效果", "演示效果", "本页 1–10 · 匹配 23 / 共 24 个效果组"],
    ];
    for (const [route, unfiltered, searchName, search, filtered] of listCases) {
      await page.goto(routeUrl(origin, route), { waitUntil: "networkidle" });
      assert.equal((await page.locator(".list-meta").innerText()).trim(), unfiltered);
      await page.getByRole("searchbox", { name: searchName }).fill(search);
      await page.waitForFunction((copy) => document.querySelector(".list-meta")?.textContent.trim() === copy, filtered);
      assert.equal((await page.locator(".list-meta").innerText()).trim(), filtered);
    }
    await page.goto(routeUrl(origin, "records"), { waitUntil: "networkidle" });
    assert.equal((await page.locator(".list-meta").innerText()).trim(), "本页 1–10 / 共 24 条记录");
    await page.evaluate(async () => {
      await window.MvuUi.updateListView("records", { filters: { fieldId: "demo-field-01" } });
      window.MvuUi.render({ resetScroll: true });
    });
    assert.equal((await page.locator(".list-meta").innerText()).trim(), "本页 1–10 · 匹配 20 / 共 24 条记录");
    const listScreenshot = path.join(artifactDirectory, "paged-lists-filtered-430.png");
    await page.setViewportSize({ width: 430, height: 852 });
    await page.screenshot({ path: listScreenshot });
    screenshots.push(listScreenshot);

    for (const width of [320, 360, 393, 430]) {
      for (const scale of [100, 130]) {
        await page.setViewportSize({ width, height: 852 });
        await page.goto(routeUrl(origin, "rule-editor", scale === 130), { waitUntil: "networkidle" });
        if (scale === 130) await page.waitForFunction(() => document.documentElement.dataset.fontScaleReady === "130");
        const dialog = await openPicker(page, "rule-trigger-actors", "选择角色");
        const metrics = await page.evaluate(() => {
          const app = document.querySelector(".app-screen");
          const picker = document.querySelector(".entity-picker");
          const footer = picker.querySelector(":scope > footer");
          const rect = picker.getBoundingClientRect();
          const footerRect = footer.getBoundingClientRect();
          return {
            bodyFont: Number.parseFloat(getComputedStyle(document.body).fontSize),
            documentOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
            appOverflow: Math.max(0, app.scrollWidth - app.clientWidth),
            pickerOverflow: Math.max(0, picker.scrollWidth - picker.clientWidth),
            pickerLeft: rect.left,
            pickerRight: rect.right,
            pickerBottom: rect.bottom,
            footerTop: footerRect.top,
            footerBottom: footerRect.bottom,
            footerHeight: footerRect.height,
            viewportWidth: innerWidth,
            viewportHeight: innerHeight,
            navRoots: document.querySelectorAll(".bottom-nav > button").length,
            visibleResults: document.querySelectorAll(".entity-picker .picker-result").length,
          };
        });
        assert.equal(metrics.documentOverflow, 0);
        assert.equal(metrics.appOverflow, 0);
        assert.equal(metrics.pickerOverflow, 0);
        assert.equal(metrics.navRoots, 4);
        assert.equal(metrics.visibleResults, 30);
        const caseLabel = `${width}px/${scale}% ${JSON.stringify(metrics)}`;
        assert.ok(metrics.pickerLeft >= 0 && metrics.pickerRight <= metrics.viewportWidth + 0.1, caseLabel);
        assert.ok(metrics.pickerBottom <= metrics.viewportHeight + 0.1, caseLabel);
        assert.ok(metrics.footerTop >= 0 && metrics.footerBottom <= metrics.pickerBottom + 0.1, caseLabel);
        assert.ok(metrics.footerHeight <= 90, caseLabel);
        assert.ok(Math.abs(metrics.bodyFont - (scale === 130 ? 18.2 : 14)) < 0.05);
        matrix.push({ width, scale, ...metrics });
        const matrixScreenshot = path.join(artifactDirectory, `picker-${width}-${scale}.png`);
        await page.screenshot({ path: matrixScreenshot });
        screenshots.push(matrixScreenshot);
        await dialog.getByRole("button", { name: "取消" }).click();
      }
    }
    const result = { result: "PASS", listCases: 5, focusPaths, matrix, screenshots };
    await writeFile(path.join(artifactDirectory, "result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
