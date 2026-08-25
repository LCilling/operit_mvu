const assert = require("node:assert/strict");
const http = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const executablePath = process.env.TASK8_CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function contentType(fileName) {
  return ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".woff2": "font/woff2" })[path.extname(fileName)] || "application/octet-stream";
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

async function main() {
  const server = await startServer();
  const address = server.address();
  const browser = await chromium.launch({ headless: true, executablePath });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  try {
    const origin = `http://127.0.0.1:${address.port}`;
    const params = new URLSearchParams({
      demo: "1",
      route: "rule-editor",
      demoPickerSlowSearch: "游标",
      demoPickerSlowMs: "500",
    });
    await page.goto(`${origin}/dist/app.html?${params}`, { waitUntil: "networkidle" });
    await page.locator('[data-picker-key="rule-result-field"]').click();
    const dialog = page.getByRole("dialog", { name: "选择字段" });
    await dialog.waitFor({ state: "visible" });
    const search = dialog.locator("[data-picker-search]");
    await search.fill("游标");
    await page.waitForTimeout(230);
    await page.evaluate(() => {
      const input = document.querySelector("[data-picker-search]");
      const results = document.querySelector("[data-picker-results]");
      input.focus();
      input.setSelectionRange(1, 2);
      results.scrollTop = 280;
      window.__task8PickerInput = input;
      window.__task8PickerResults = results;
    });
    await page.waitForTimeout(550);
    assert.deepEqual(await page.evaluate(() => {
      const input = document.querySelector("[data-picker-search]");
      const results = document.querySelector("[data-picker-results]");
      return {
        sameInput: input === window.__task8PickerInput,
        sameResults: results === window.__task8PickerResults,
        focused: document.activeElement === input,
        selection: [input.selectionStart, input.selectionEnd],
        scrollTop: results.scrollTop,
      };
    }), { sameInput: true, sameResults: true, focused: true, selection: [1, 2], scrollTop: 280 });

    const cursorState = await page.evaluate(() => {
      const results = document.querySelector("[data-picker-results]");
      results.scrollTop = results.scrollHeight - results.clientHeight - 1;
      results.dispatchEvent(new Event("scroll", { bubbles: true }));
      const option = Array.from(results.querySelectorAll(".picker-result")).at(-1);
      option.focus();
      window.__task8CursorResults = results;
      window.__task8CursorOptionId = option.dataset.pickerId;
      window.__task8CursorScrollTop = results.scrollTop;
      return { optionId: option.dataset.pickerId, scrollTop: results.scrollTop };
    });
    await page.waitForTimeout(550);
    const cursorResult = await page.evaluate(() => {
      const results = document.querySelector("[data-picker-results]");
      return {
        sameResults: results === window.__task8CursorResults,
        focusedId: document.activeElement && document.activeElement.dataset.pickerId,
        scrollTop: results.scrollTop,
        retained: window.MvuUi.state.entityPicker.orderIds.length,
        rendered: results.querySelectorAll(".picker-result").length,
      };
    });
    assert.deepEqual({ ...cursorResult, rendered: undefined }, {
      sameResults: true, focusedId: cursorState.optionId, scrollTop: cursorState.scrollTop, retained: 60, rendered: undefined,
    });
    assert.ok(cursorResult.rendered > 0 && cursorResult.rendered <= 24);

    await page.evaluate(() => window.MvuUi.closeEntityPicker());
    await page.evaluate(() => {
      const original = window.MvuUi.native.call.bind(window.MvuUi.native);
      window.MvuUi.native.call = async (method, request) => {
        if (method === "queryActors" && request.cursor) await new Promise((resolve) => setTimeout(resolve, 400));
        return original(method, request);
      };
    });
    await page.locator('[data-picker-key="rule-trigger-actors"]').click();
    const actorDialog = page.getByRole("dialog", { name: "选择角色" });
    await actorDialog.waitFor({ state: "visible" });
    const firstActor = actorDialog.locator(".picker-result").first();
    const firstActorId = await firstActor.getAttribute("data-picker-id");
    await firstActor.focus();
    await firstActor.click();
    assert.deepEqual(await page.evaluate((id) => ({
      focusedId: document.activeElement && document.activeElement.dataset.pickerId,
      pinned: Boolean(document.activeElement && document.activeElement.closest(".picker-pinned")),
      selected: window.MvuUi.state.entityPicker.selectedIds.has(id),
      normalDuplicate: Boolean(document.querySelector(`[data-picker-results] [data-picker-id="${id}"]`)),
    }), firstActorId), { focusedId: firstActorId, pinned: true, selected: true, normalDuplicate: false });

    const actorCursorState = await page.evaluate(() => {
      const results = document.querySelector("[data-picker-results]");
      results.scrollTop = results.scrollHeight - results.clientHeight - 1;
      results.dispatchEvent(new Event("scroll", { bubbles: true }));
      const option = Array.from(results.querySelectorAll(".picker-result")).at(-1);
      option.focus();
      return { optionId: option.dataset.pickerId, scrollTop: results.scrollTop };
    });
    await page.waitForTimeout(450);
    const actorCursorResult = await page.evaluate(() => {
      const results = document.querySelector("[data-picker-results]");
      return {
        focusedId: document.activeElement && document.activeElement.dataset.pickerId,
        scrollTop: results.scrollTop,
        retained: window.MvuUi.state.entityPicker.orderIds.length,
        rendered: results.querySelectorAll(".picker-result").length,
      };
    });
    assert.deepEqual({ ...actorCursorResult, rendered: undefined }, {
      focusedId: actorCursorState.optionId, scrollTop: actorCursorState.scrollTop, retained: 60, rendered: undefined,
    });
    assert.ok(actorCursorResult.rendered > 0 && actorCursorResult.rendered <= 24);

    await page.evaluate(() => {
      const original = window.MvuUi.native.call.bind(window.MvuUi.native);
      window.MvuUi.native.call = async (method, request) => {
        if (method === "queryFields" && request.search === "演示") {
          await new Promise((resolve) => setTimeout(resolve, 450));
        }
        return original(method, request);
      };
    });
    await page.evaluate(() => window.MvuUi.closeEntityPicker());
    await page.evaluate(() => window.MvuUi.navigate("config-fields"));
    await page.locator('[data-list-search-route="config-fields"]').waitFor();
    const listSearch = page.locator('[data-list-search-route="config-fields"]');
    await listSearch.fill("演示");
    await page.waitForTimeout(220);
    await page.evaluate(() => {
      const input = document.querySelector('[data-list-search-route="config-fields"]');
      const scroll = document.querySelector(".screen-scroll");
      input.focus();
      input.setSelectionRange(1, 2);
      scroll.scrollTop = 37;
      window.__task8ListInput = input;
      window.__task8ScreenScroll = scroll;
    });
    await page.waitForTimeout(500);
    assert.deepEqual(await page.evaluate(() => {
      const input = document.querySelector('[data-list-search-route="config-fields"]');
      const scroll = document.querySelector(".screen-scroll");
      return {
        sameInput: input === window.__task8ListInput,
        sameScroll: scroll === window.__task8ScreenScroll,
        focused: document.activeElement === input,
        selection: [input.selectionStart, input.selectionEnd],
        scrollTop: scroll.scrollTop,
      };
    }), { sameInput: true, sameScroll: true, focused: true, selection: [1, 2], scrollTop: 37 });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().then(() => process.stdout.write("task 8 DOM behavior: PASS\n")).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
