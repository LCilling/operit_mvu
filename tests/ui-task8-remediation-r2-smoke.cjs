const assert = require("node:assert/strict");
const http = require("node:http");
const { existsSync } = require("node:fs");
const { mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright-core");

const root = path.resolve(__dirname, "..");
const evidenceDirectory = path.join(root, "artifacts", "task-8-remediation-r2");
const executablePath = resolveChromiumExecutable();

function resolveChromiumExecutable() {
  const candidates = [process.env.TASK8_CHROME_PATH];
  if (process.platform === "win32") {
    candidates.push(
      path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
    );
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    );
  } else {
    candidates.push("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge");
  }
  try {
    candidates.push(chromium.executablePath());
  } catch (_error) {
    // playwright-core intentionally relies on a discovered installed browser.
  }
  const found = candidates.find((candidate) => typeof candidate === "string" && candidate.length > 0 && existsSync(candidate));
  if (!found) throw new Error("TASK8_CHROMIUM_NOT_FOUND: set TASK8_CHROME_PATH to a Chromium executable");
  return found;
}

function contentType(fileName) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".woff2": "font/woff2",
  })[path.extname(fileName)] || "application/octet-stream";
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

function caseUrl(origin, scale, route, extra = {}) {
  const file = scale === 130 ? "/tests/fixtures/ui-text-scale.html" : "/dist/app.html";
  const params = new URLSearchParams({ demo: "1", route, ...extra });
  return `${origin}${file}?${params}`;
}

function near(actual, expected, tolerance = 0.06) {
  assert.ok(Math.abs(actual - expected) < tolerance, `expected ${actual} near ${expected}`);
}

function assertAndroidFamily(metric) {
  assert.match(metric.family, /Roboto.*Noto Sans SC.*system-ui.*sans-serif/);
  assert.doesNotMatch(metric.family, /Segoe UI/);
}

function assertVisibleMetric(metric, name) {
  assert.equal(metric.offscreen, false, `${name} is off-screen`);
  assert.equal(metric.clipped, false, `${name} is clipped: ${JSON.stringify(metric)}`);
  assertAndroidFamily(metric);
}

async function typographyMetric(page, selector) {
  return page.$eval(selector, (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      family: style.fontFamily,
      size: parseFloat(style.fontSize),
      lineHeight: parseFloat(style.lineHeight),
      width: rect.width,
      height: rect.height,
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
      offscreen: rect.left < -0.5 || rect.right > innerWidth + 0.5,
      clipped: (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1) ||
        (element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 1),
    };
  });
}

async function runCase(browser, origin, width, scale) {
  const page = await browser.newPage({ viewport: { width, height: scale === 130 ? 1000 : 900 } });
  const suffix = `${width}-${scale}`;
  try {
    await page.goto(caseUrl(origin, scale, "field-detail", { field: "affinity" }), { waitUntil: "networkidle" });
    if (scale === 130) await page.waitForFunction(() => document.documentElement.dataset.fontScaleReady === "130");
    await page.locator(".stage-marker").first().waitFor();
    const detail = {
      body: await typographyMetric(page, "body"),
      title: await typographyMetric(page, ".top-app-bar h1"),
      stage: await typographyMetric(page, ".stage-marker"),
      trend: await typographyMetric(page, ".trend-range"),
      overflow: await page.evaluate(() => ({
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        app: document.getElementById("appRoot").scrollWidth - document.getElementById("appRoot").clientWidth,
      })),
    };
    const factor = scale / 100;
    near(detail.body.size, 14 * factor);
    near(detail.body.lineHeight, 21 * factor);
    near(detail.title.size, 21 * factor);
    near(detail.title.lineHeight, 28 * factor);
    near(detail.stage.size, 11 * factor);
    near(detail.trend.size, 11 * factor);
    for (const [name, metric] of Object.entries({ title: detail.title, stage: detail.stage, trend: detail.trend })) {
      assertVisibleMetric(metric, `${suffix} ${name}`);
    }
    assertAndroidFamily(detail.body);
    assert.ok(detail.overflow.document <= 0 && detail.overflow.app <= 0);
    if ((width === 320 && scale === 130) || (width === 430 && scale === 100)) {
      await page.screenshot({ path: path.join(evidenceDirectory, `detail-${suffix}.png`), fullPage: false });
    }

    await page.evaluate(() => window.MvuUi.navigate("config-fields"));
    await page.locator('[data-list-search-route="config-fields"]').waitFor();
    const management = {
      search: await typographyMetric(page, '[data-list-search-route="config-fields"]'),
      filter: await typographyMetric(page, '[data-list-filter-route="config-fields"]'),
      pagination: await typographyMetric(page, ".pagination > span"),
      countPage1: await page.locator('[data-management-region="config-fields"] .list-meta').innerText(),
    };
    await page.evaluate(() => document.querySelector('[data-page-direction="next"][data-page-route="config-fields"]').click());
    await page.waitForFunction(() => window.MvuUi.state.listViews.fields.page === 2);
    management.countPage2 = await page.locator('[data-management-region="config-fields"] .list-meta').innerText();
    for (const [name, metric] of Object.entries({ search: management.search, filter: management.filter, pagination: management.pagination })) {
      assertVisibleMetric(metric, `${suffix} ${name}`);
    }
    near(management.search.size, 14 * factor);
    near(management.filter.size, 14 * factor);
    near(management.pagination.size, 12 * factor);
    assert.equal(management.countPage1, "已显示 5 个字段 / 匹配 13 个字段 / 共 13 个字段");
    assert.equal(management.countPage2, "已显示 5 个字段 / 匹配 13 个字段 / 共 13 个字段");

    await page.evaluate(() => window.MvuUi.navigate("rule-editor"));
    await page.locator('[data-picker-key="rule-result-field"]').click();
    const dialog = page.getByRole("dialog", { name: "选择字段" });
    await dialog.waitFor({ state: "visible" });
    const initialCursor = await page.evaluate(() => window.MvuUi.state.entityPicker.nextCursor);
    assert.match(initialCursor, /^demo_c1_[0-9a-z]+$/);
    assert.doesNotMatch(initialCursor, /:\d+$/);
    await page.evaluate(() => window.MvuUi.fetchNextEntityPickerPage());
    await page.evaluate(() => {
      const results = document.querySelector("[data-picker-results]");
      results.scrollTop = Math.min(1120, results.scrollHeight - results.clientHeight - 100);
      results.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await page.waitForTimeout(50);
    const picker = {
      search: await typographyMetric(page, "[data-picker-search]"),
      filter: await typographyMetric(page, "[data-picker-filter]"),
      state: await page.evaluate(() => ({
        retained: window.MvuUi.state.entityPicker.orderIds.length,
        rendered: document.querySelectorAll("[data-picker-results] .picker-result").length,
        hasBeforeSpacer: Boolean(document.querySelector('[data-picker-spacer="before"]')),
        resultsOverflow: document.querySelector("[data-picker-results]").scrollWidth -
          document.querySelector("[data-picker-results]").clientWidth,
        roots: document.querySelectorAll(".bottom-nav [data-route]").length,
        hasLoadMore: document.body.textContent.includes("加载更多"),
      })),
    };
    assertVisibleMetric(picker.search, `${suffix} picker search`);
    assertVisibleMetric(picker.filter, `${suffix} picker filter`);
    near(picker.search.size, 14 * factor);
    near(picker.filter.size, 14 * factor);
    assert.equal(picker.state.retained, 60);
    assert.ok(picker.state.rendered > 0 && picker.state.rendered <= 24);
    assert.equal(picker.state.hasBeforeSpacer, true);
    assert.ok(picker.state.resultsOverflow <= 0);
    assert.equal(picker.state.roots, 4);
    assert.equal(picker.state.hasLoadMore, false);
    const screenshot = path.join(evidenceDirectory, `picker-${suffix}.png`);
    await page.screenshot({ path: screenshot, fullPage: false });

    return { width, scale, detail, management, picker, initialCursor, screenshot };
  } finally {
    await page.close();
  }
}

async function main() {
  await mkdir(evidenceDirectory, { recursive: true });
  const server = await startServer();
  const address = server.address();
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const origin = `http://127.0.0.1:${address.port}`;
    const results = [];
    for (const width of [320, 360, 393, 430]) {
      for (const scale of [100, 130]) results.push(await runCase(browser, origin, width, scale));
    }
    assert.equal(results.length, 8);
    await writeFile(path.join(evidenceDirectory, "result.json"), JSON.stringify({
      executablePath,
      matrix: results,
    }, null, 2) + "\n", "utf8");
    process.stdout.write(`task 8 remediation r2 smoke: PASS (${results.length}/8)\n`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
