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
const confirmationValue = "REPLACE_ALL_MVU_DATA";
const previewFixture = {
  valid: true,
  kind: "full_v3",
  sourceFormatVersion: 3,
  schemaVersion: 1,
  exportedAt: "2033-05-18T03:33:20.000Z",
  sourceRevision: 22,
  previewRevision: 7,
  expectedRevision: 7,
  summary: {
    fieldCount: 12,
    conditionCount: 5,
    ruleCount: 6,
    effectGroupCount: 4,
    activeEffectCount: 3,
    recordCount: 321,
  },
  migrationWarnings: { items: ["旧条件已迁移"], totalCount: 3, truncated: true },
  replacementWarning: "导入会替换全部当前 MVU 数据。",
  confirmationValue,
};

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

async function createApp(route = "advanced") {
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

function setChecked(window, selector, checked) {
  const element = window.document.querySelector(selector);
  assert.ok(element, `missing checkbox ${selector}`);
  element.checked = checked;
  element.dispatchEvent(new window.Event("change", { bubbles: true }));
  return element;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("advanced root keeps appearance and import/export primary while exposing compact budget and collapsed maintenance", async (t) => {
  const window = await createApp();
  t.after(() => window.close());
  const { document } = window;
  const primary = Array.from(document.querySelectorAll(".advanced-page > [data-advanced-primary]"));
  assert.equal(primary.length, 2);
  assert.match(primary[0].textContent, /页面外观.*更换背景照片.*恢复默认背景/s);
  assert.match(primary[1].textContent, /导入与导出.*完整备份/s);
  assert.equal(document.querySelector(".advanced-page > .maintenance").open, false);
  assert.match(document.querySelector("[data-model-budget-summary]").textContent, /本轮使用 4 \/ 共 12 个字段/);
  assert.doesNotMatch(primary.map((item) => item.textContent).join(" "), /状态总览|字段状态/);
  assert.equal(primary.some((item) => item.querySelector('[data-route="status"], [data-route="records"]')), false);
  const bodyFont = window.getComputedStyle(document.body);
  assert.match(bodyFont.fontFamily, /Roboto.*Noto Sans SC.*system-ui/);
  assert.ok(parseFloat(bodyFont.fontSize) >= 14);
});

test("runtime rejects malformed or internally inconsistent model-budget snapshots", async (t) => {
  const window = await createApp();
  t.after(() => window.close());
  const valid = plain(window.MvuUi.state.snapshot);
  assert.doesNotThrow(() => window.MvuUi.validateCompactSnapshot(valid));
  const invalidBudgets = [
    { ...valid.modelBudget, used: -1 },
    { ...valid.modelBudget, used: valid.modelBudget.limit + 1 },
    { ...valid.modelBudget, referencedIncluded: 4, referencedTotal: 3 },
    { ...valid.modelBudget, overflow: "false" },
    { ...valid.modelBudget, diagnostics: ["x".repeat(513)] },
    { ...valid.modelBudget, diagnostics: Array.from({ length: 33 }, () => "bounded") },
  ];
  for (const modelBudget of invalidBudgets) {
    assert.throws(
      () => window.MvuUi.validateCompactSnapshot({ ...valid, modelBudget }),
      /MVU_MODEL_BUDGET_INVALID/,
    );
  }
});

test("full backup export locks duplicate clicks and renders the authoritative saved result", async (t) => {
  const window = await createApp();
  t.after(() => window.close());
  const originalCall = window.MvuUi.native.call.bind(window.MvuUi.native);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let exportCalls = 0;
  window.MvuUi.native.call = async (method, params) => {
    if (method !== "exportDataset") return originalCall(method, params);
    exportCalls += 1;
    await gate;
    return {
      fileName: "operit-mvu-full-backup-v3-schema1-20330518-033320000Z-r7-0123456789ab.json",
      savedPath: "/sdcard/Download/Operit/exports/operit-mvu-full-backup-v3-schema1-20330518-033320000Z-r7-0123456789ab.json",
      summary: {
        sourceRevision: 7,
        fieldCount: 12,
        conditionCount: 5,
        ruleCount: 6,
        effectGroupCount: 4,
        activeEffectCount: 3,
        recordCount: 321,
        byteCount: 2048,
      },
    };
  };
  const exportButton = '[data-action="export-dataset"]';
  click(window, exportButton);
  click(window, exportButton);
  await waitFor(() => exportCalls > 0, "export did not start");
  assert.equal(exportCalls, 1);
  assert.equal(window.document.querySelector(exportButton).disabled, true);
  release();
  await waitFor(() => window.document.querySelector("[data-export-result]"), "export result missing");
  const text = window.document.querySelector("[data-export-result]").textContent;
  assert.match(text, /r7.*2 KB.*字段12.*条件5.*规则6.*效果组4.*活跃效果3.*记录321/s);
  assert.match(text, /\/sdcard\/Download\/Operit\/exports/);
});

test("export and file-read failures stay visible and retryable while file cancellation is a no-op", async (t) => {
  const window = await createApp();
  t.after(() => window.close());
  const originalCall = window.MvuUi.native.call.bind(window.MvuUi.native);
  let attempts = 0;
  window.MvuUi.native.call = async (method, params) => {
    if (method !== "exportDataset") return originalCall(method, params);
    attempts += 1;
    if (attempts === 1) throw new Error("storage unavailable");
    return {
      fileName: "operit-mvu-full-backup-v3-schema1-20330518-033320000Z-r7-0123456789ab.json",
      savedPath: "/sdcard/Download/Operit/exports/retry.json",
      summary: { sourceRevision: 7, fieldCount: 1, conditionCount: 2, ruleCount: 3, effectGroupCount: 4, activeEffectCount: 5, recordCount: 6, byteCount: 1024 },
    };
  };
  click(window, '[data-action="export-dataset"]');
  await waitFor(() => /storage unavailable/.test(window.document.querySelector("[data-export-error]")?.textContent || ""), "export error missing");
  click(window, '[data-action="retry-export-dataset"]');
  await waitFor(() => window.document.querySelector("[data-export-result]"), "export retry did not recover");
  assert.equal(attempts, 2);

  const picker = window.document.getElementById("datasetImportPicker");
  Object.defineProperty(picker, "files", { configurable: true, value: [] });
  picker.dispatchEvent(new window.Event("change"));
  assert.equal(window.MvuUi.state.advancedDialog, null);

  window.FileReader = class {
    readAsText() { this.error = new Error("read denied"); this.onerror(); }
  };
  Object.defineProperty(picker, "files", { configurable: true, value: [{ name: "broken.json" }] });
  picker.dispatchEvent(new window.Event("change"));
  await waitFor(() => /无法读取.*broken\.json/.test(window.document.querySelector("[data-dataset-import-error]")?.textContent || ""), "file read error missing");
});

test("dataset import previews through the service then requires explicit replacement confirmation", async (t) => {
  const window = await createApp();
  t.after(() => window.close());
  const originalCall = window.MvuUi.native.call.bind(window.MvuUi.native);
  const calls = [];
  let releaseImport;
  const importGate = new Promise((resolve) => { releaseImport = resolve; });
  window.MvuUi.native.call = async (method, params) => {
    if (method === "previewDatasetImport") {
      calls.push([method, plain(params)]);
      return plain(previewFixture);
    }
    if (method === "importDataset") {
      calls.push([method, plain(params)]);
      await importGate;
      window.MvuUi.state.demoStore.revision += 1;
      return { revision: 8, kind: "full_v3", sourceFormatVersion: 3, sourceRevision: 22, recordCount: 321,
        migrationWarnings: { items: ["旧条件已迁移"], totalCount: 3, truncated: true } };
    }
    return originalCall(method, params);
  };
  const opener = window.document.querySelector('[data-action="choose-dataset-import"]');
  await window.MvuUi.previewDatasetImportText("not parsed by the frontend", "complete-backup.json", opener);
  await waitFor(() => window.document.querySelector("[data-dataset-import-preview]"), "preview dialog missing");
  const previewText = window.document.querySelector("[data-dataset-import-preview]").textContent;
  assert.match(previewText, /完整 v3 备份.*来源修订 22.*字段12.*条件5.*规则6.*效果组4.*活跃效果3.*记录321/s);
  assert.match(previewText, /迁移警告.*已显示 1.*共 3.*已截断/s);
  assert.match(previewText, /替换全部当前 MVU 数据/);
  assert.equal(window.document.querySelector('[data-action="commit-dataset-import"]').disabled, true);
  setChecked(window, "[data-confirm-dataset-replacement]", true);
  click(window, '[data-action="commit-dataset-import"]');
  click(window, '[data-action="commit-dataset-import"]');
  await waitFor(() => calls.filter(([method]) => method === "importDataset").length === 1, "import did not start");
  assert.equal(window.document.querySelector('[data-action="commit-dataset-import"]').disabled, true);
  releaseImport();
  await waitFor(() => window.document.querySelector("[data-dataset-import-result]"), "import result missing");
  assert.deepEqual(calls, [
    ["previewDatasetImport", { json: "not parsed by the frontend" }],
    ["importDataset", { json: "not parsed by the frontend", expectedRevision: 7, confirmation: confirmationValue }],
  ]);
  assert.match(window.document.querySelector("[data-dataset-import-result]").textContent, /新修订 8.*记录 321/s);
  assert.equal(window.MvuUi.state.snapshot.revision, 8);
});

test("stale import preserves the file and preview but requires a deliberate re-preview", async (t) => {
  const window = await createApp();
  t.after(() => window.close());
  const originalCall = window.MvuUi.native.call.bind(window.MvuUi.native);
  let previewCalls = 0;
  let importCalls = 0;
  window.MvuUi.native.call = async (method, params) => {
    if (method === "previewDatasetImport") {
      previewCalls += 1;
      return { ...plain(previewFixture), previewRevision: window.MvuUi.state.demoStore.revision,
        expectedRevision: window.MvuUi.state.demoStore.revision };
    }
    if (method === "importDataset") {
      importCalls += 1;
      if (params.expectedRevision !== window.MvuUi.state.demoStore.revision) throw new Error("MVU_STALE_REVISION");
      throw new Error("unexpected success");
    }
    return originalCall(method, params);
  };
  const opener = window.document.querySelector('[data-action="choose-dataset-import"]');
  await window.MvuUi.previewDatasetImportText("same-file", "stale-backup.json", opener);
  window.MvuUi.state.demoStore.revision += 1;
  setChecked(window, "[data-confirm-dataset-replacement]", true);
  click(window, '[data-action="commit-dataset-import"]');
  await waitFor(() => /数据已变化.*重新预览/.test(window.document.querySelector("[data-dataset-import-error]")?.textContent || ""), "stale guidance missing");
  assert.equal(importCalls, 1);
  assert.match(window.document.querySelector("[data-dataset-import-file]").textContent, /stale-backup\.json/);
  click(window, '[data-action="repreview-dataset-import"]');
  await waitFor(() => previewCalls === 2 && window.MvuUi.state.advancedDialog.preview.expectedRevision === 8, "explicit re-preview did not refresh revision");
  assert.equal(importCalls, 1, "stale import was replayed automatically");
  assert.equal(window.MvuUi.state.advancedDialog.preview.expectedRevision, 8);
});

test("invalid and oversized backup previews remain in the dialog with actionable errors", async (t) => {
  const window = await createApp();
  t.after(() => window.close());
  const originalCall = window.MvuUi.native.call.bind(window.MvuUi.native);
  let attempt = 0;
  window.MvuUi.native.call = async (method, params) => {
    if (method !== "previewDatasetImport") return originalCall(method, params);
    attempt += 1;
    if (attempt === 1) throw new Error("MVU_FULL_BACKUP_UNKNOWN_VERSION");
    throw new Error("MVU_FULL_BACKUP_MAX_BYTES_EXCEEDED");
  };
  const opener = window.document.querySelector('[data-action="choose-dataset-import"]');
  await window.MvuUi.previewDatasetImportText("bad", "unknown.json", opener);
  assert.match(window.document.querySelector("[data-dataset-import-error]").textContent, /版本.*不支持|未知版本/);
  click(window, '[data-action="repreview-dataset-import"]');
  await waitFor(() => /过大|大小上限/.test(window.document.querySelector("[data-dataset-import-error]")?.textContent || ""), "oversize guidance missing");
  assert.ok(window.document.querySelector('[data-action="repreview-dataset-import"]'));
});

test("default conditions preview missing existing and conflict entries before one revisioned restore", async (t) => {
  const window = await createApp();
  t.after(() => window.close());
  const originalCall = window.MvuUi.native.call.bind(window.MvuUi.native);
  let restoreRequest = null;
  window.MvuUi.native.call = async (method, params) => {
    if (method === "previewDefaultConditions") return {
      expectedRevision: 7,
      totalCount: 5,
      defaultSelectedMissingIds: ["condition_auto_positive", "condition_auto_special"],
      items: [
        { id: "condition_auto_positive", name: "连续积极互动", description: "最近对话持续积极互动。", status: "missing", currentName: null },
        { id: "condition_auto_inactive", name: "长时间未交流", description: "超过一天没有交流。", status: "existing", currentName: "长时间未交流" },
        { id: "condition_auto_care", name: "主动关心", description: "用户主动关心角色。", status: "conflict", currentName: "自定义关心" },
        { id: "condition_auto_special", name: "特别的日子", description: "角色的重要纪念日。", status: "missing", currentName: null },
        { id: "condition_auto_high_frequency", name: "高频互动", description: "一天内产生大量消息。", status: "existing", currentName: "高频互动" },
      ],
    };
    if (method === "restoreDefaultConditions") {
      restoreRequest = plain(params);
      window.MvuUi.state.demoStore.revision += 1;
      return { revision: 8, addedCount: 2, replacedCount: 1, unchangedCount: 2 };
    }
    return originalCall(method, params);
  };
  click(window, '[data-action="preview-default-conditions"]');
  await waitFor(() => window.document.querySelector("[data-default-condition-preview]"), "default-condition preview missing");
  assert.equal(window.document.querySelector('[data-default-condition-id="condition_auto_positive"] input').checked, true);
  assert.equal(window.document.querySelector('[data-default-condition-id="condition_auto_inactive"] input'), null);
  assert.equal(window.document.querySelector('[data-default-condition-id="condition_auto_care"] input').checked, false);
  setChecked(window, '[data-default-condition-id="condition_auto_care"] input', true);
  click(window, '[data-action="commit-default-conditions"]');
  await waitFor(() => window.document.querySelector("[data-default-condition-result]"), "default-condition restore result missing");
  assert.deepEqual(restoreRequest, {
    expectedRevision: 7,
    selectedMissingIds: ["condition_auto_positive", "condition_auto_special"],
    replaceConflictIds: ["condition_auto_care"],
  });
  assert.match(window.document.querySelector("[data-default-condition-result]").textContent, /新增 2.*替换 1.*保持 2/s);
});

test("maintenance explains compatibility failures and links diagnostics to condition and rule libraries", async (t) => {
  const window = await createApp();
  t.after(() => window.close());
  window.MvuUi.state.snapshot.migrationStatus = {
    mode: "v2_compat",
    error: { code: "MVU_MIGRATION_FAILED", message: "旧数据校验失败" },
    truncated: false,
  };
  window.MvuUi.state.snapshot.snapshotTruncated = true;
  window.MvuUi.render();
  const details = window.document.querySelector(".maintenance");
  details.open = true;
  assert.match(details.textContent, /v2 兼容模式/);
  assert.match(details.textContent, /旧数据校验失败/);
  assert.match(details.textContent, /快照已精简/);
  assert.ok(details.querySelector('[data-action="retry"]'));
  assert.match(details.querySelector('[data-action="retry"]').textContent, /重新加载以重试/);
  assert.ok(details.querySelector('[data-route="condition-library"]'));
  assert.ok(details.querySelector('[data-route="rule-library"]'));
  assert.equal(details.querySelector('[data-action="repair-all-references"]'), null);
});

test("advanced dialogs protect inside clicks, close on Escape, and restore opener focus", async (t) => {
  const window = await createApp();
  t.after(() => window.close());
  const originalCall = window.MvuUi.native.call.bind(window.MvuUi.native);
  window.MvuUi.native.call = (method, params) => method === "previewDatasetImport"
    ? Promise.resolve(plain(previewFixture))
    : originalCall(method, params);
  const opener = window.document.querySelector('[data-action="choose-dataset-import"]');
  opener.focus();
  await window.MvuUi.previewDatasetImportText("focus", "focus.json", opener);
  const dialog = window.document.querySelector(".advanced-dialog");
  assert.ok(dialog);
  click(window, ".advanced-dialog");
  assert.ok(window.document.querySelector(".advanced-dialog"), "inside click closed dialog");
  dialog.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  window.document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await waitFor(() => !window.document.querySelector(".advanced-dialog"), "Escape did not close dialog");
  assert.equal(window.document.activeElement, window.document.querySelector('[data-action="choose-dataset-import"]'));
});

function resolveChromiumExecutable() {
  const candidates = [process.env.TASK10_CHROME_PATH];
  if (process.platform === "win32") {
    candidates.push(
      path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
    );
  }
  try { candidates.push(chromium.executablePath()); } catch (_error) { /* resolved below */ }
  const executable = candidates.find((candidate) => typeof candidate === "string" && candidate && existsSync(candidate));
  if (!executable) throw new Error("TASK10_CHROMIUM_NOT_FOUND: set TASK10_CHROME_PATH to Chrome or Edge");
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

test("real Chromium keeps advanced page and backup dialog overflow-safe at 320px and 130 percent text", async (t) => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutable() });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  for (const scale of [100, 130]) {
    const page = await browser.newPage({ viewport: { width: 320, height: 1000 } });
    const file = scale === 130 ? "/tests/fixtures/ui-text-scale.html" : "/dist/app.html";
    await page.goto(`${origin}${file}?demo=1&route=advanced`, { waitUntil: "networkidle" });
    if (scale === 130) await page.waitForFunction(() => document.documentElement.dataset.fontScaleReady === "130");
    await page.locator(".advanced-page").waitFor();
    await page.evaluate(async () => {
      const opener = document.querySelector('[data-action="choose-dataset-import"]');
      await window.MvuUi.previewDatasetImportText("visual", "a-very-long-complete-backup-file-name-for-overflow-testing.json", opener);
    });
    await page.locator(".advanced-dialog").waitFor();
    const metrics = await page.evaluate(() => {
      const dialog = document.querySelector(".advanced-dialog");
      const interactiveOverflow = Array.from(document.querySelectorAll("button, input, [role='dialog']")).filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -0.5 || rect.right > innerWidth + 0.5;
      }).length;
      const style = getComputedStyle(document.body);
      return {
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        appOverflow: document.getElementById("appRoot").scrollWidth - document.getElementById("appRoot").clientWidth,
        dialogOverflow: dialog.scrollWidth - dialog.clientWidth,
        interactiveOverflow,
        fontSize: parseFloat(style.fontSize),
        lineHeight: parseFloat(style.lineHeight),
        fontFamily: style.fontFamily,
      };
    });
    assert.ok(metrics.documentOverflow <= 1, JSON.stringify(metrics));
    assert.ok(metrics.appOverflow <= 1, JSON.stringify(metrics));
    assert.ok(metrics.dialogOverflow <= 1, JSON.stringify(metrics));
    assert.equal(metrics.interactiveOverflow, 0, JSON.stringify(metrics));
    assert.ok(metrics.fontSize >= (scale === 130 ? 18 : 14), JSON.stringify(metrics));
    assert.ok(metrics.lineHeight >= (scale === 130 ? 27 : 21), JSON.stringify(metrics));
    assert.match(metrics.fontFamily, /Roboto.*Noto Sans SC.*system-ui/);
    await page.close();
  }
});
