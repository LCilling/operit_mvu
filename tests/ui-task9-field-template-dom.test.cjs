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

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("field editor auto-binds the readable current conversation and preserves draft through actor picker rerenders", async (t) => {
  const window = await createApp("field-editor");
  t.after(() => window.close());
  const { document } = window;

  input(window, '[name="name"]', "长期信任");
  input(window, '[name="minimum"]', "-20");
  input(window, '[name="maximum"]', "120");
  click(window, '[data-scope="chat"]');

  assert.equal(window.MvuUi.state.fieldEditorDraft.scope, "chat");
  assert.deepEqual(Array.from(window.MvuUi.state.fieldEditorDraft.bindingIds), ["chat-a"]);
  assert.match(document.querySelector("[data-chat-binding]").textContent, /Operit 的会话/);
  assert.equal(document.querySelector('[name="bindCurrentChat"]').checked, true);

  const bind = document.querySelector('[name="bindCurrentChat"]');
  bind.checked = false;
  bind.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.deepEqual(Array.from(window.MvuUi.state.fieldEditorDraft.bindingIds), []);

  click(window, '[data-scope="character"]');
  click(window, '[data-picker-key="field-scope-character"]');
  await waitFor(() => window.MvuUi.state.entityPicker?.orderIds.length > 0, "actor picker did not load");
  click(window, '[data-picker-id="picker-actor-001"]');
  click(window, '[data-action="confirm-entity-picker"]');
  await waitFor(() => !document.querySelector(".entity-picker"), "actor picker did not close");

  assert.equal(document.querySelector('[name="name"]').value, "长期信任");
  assert.equal(document.querySelector('[name="minimum"]').value, "-20");
  assert.equal(document.querySelector('[name="maximum"]').value, "120");
  assert.deepEqual(Array.from(window.MvuUi.state.fieldEditorDraft.bindingIds), ["picker-actor-001"]);
  assert.match(document.querySelector("[data-field-binding-summary]").textContent, /游标角色 001/);
  assert.match(document.querySelector("[data-field-binding-summary]").textContent, /picker-actor-001/);
});

test("field form saves a complete addField payload then reloads the authoritative list", async (t) => {
  const window = await createApp("field-editor");
  t.after(() => window.close());
  input(window, '[name="name"]', "专注度");
  input(window, '[name="description"]', "当前任务的投入程度");
  input(window, '[name="minimum"]', "0");
  input(window, '[name="maximum"]', "200");
  input(window, '[name="step"]', "5");
  input(window, '[name="initialValue"]', "50");
  input(window, '[data-stage-threshold="0"]', "0");
  input(window, '[data-stage-name="0"]', "平稳");

  const form = window.document.querySelector('[data-form="field-editor"]');
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(
    () => window.MvuUi.state.route === "config-fields" && /专注度/.test(window.document.body.textContent),
    "saved field was not reloaded into the field list",
  );

  const request = window.MvuUi.state.demoLastRequests.addField;
  assert.equal(request.field.name, "专注度");
  assert.deepEqual(
    plain({
      minimum: request.field.minimum,
      maximum: request.field.maximum,
      step: request.field.step,
      initialValue: request.field.initialValue,
      stages: request.field.stages.map((stage) => [stage.name, stage.threshold]),
    }),
    { minimum: 0, maximum: 200, step: 5, initialValue: 50, stages: [["平稳", 0]] },
  );
  assert.equal(window.MvuUi.state.snapshot.revision, 8);
});

test("field add and update host failures stay inline, preserve edits, and recover after correction", async (t) => {
  const window = await createApp("field-editor");
  t.after(() => window.close());
  const { document } = window;
  input(window, '[name="name"]', "失败后保留");
  input(window, '[name="maximum"]', "180");

  window.MvuUi.state.demoNextFailureMethod = "addField";
  document.querySelector('[data-form="field-editor"]').dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => /demo host failure: addField/.test(document.querySelector("[data-field-editor-error]")?.textContent || ""), "addField inline error missing");
  assert.equal(window.MvuUi.state.route, "field-editor");
  assert.equal(document.querySelector('[name="maximum"]').value, "180");

  input(window, '[name="name"]', "修正后字段");
  document.querySelector('[data-form="field-editor"]').dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => window.MvuUi.state.route === "config-fields" && /修正后字段/.test(document.body.textContent), "addField retry did not recover");

  click(window, '[data-action="edit-field"]');
  await waitFor(() => window.MvuUi.state.route === "field-editor" && document.querySelector('[name="description"]'), "saved field editor did not reopen");
  input(window, '[name="description"]', "更新失败后仍保留");
  window.MvuUi.state.demoNextFailureMethod = "updateField";
  document.querySelector('[data-form="field-editor"]').dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => /demo host failure: updateField/.test(document.querySelector("[data-field-editor-error]")?.textContent || ""), "updateField inline error missing");
  assert.equal(document.querySelector('[name="description"]').value, "更新失败后仍保留");

  document.querySelector('[data-form="field-editor"]').dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await waitFor(() => window.MvuUi.state.route === "config-fields", "updateField retry did not recover");
  assert.equal(window.MvuUi.state.demoLastRequests.updateField.patch.description, "更新失败后仍保留");
});

test("export flow selects fields and bounded targets through searchable pickers and emits the explicit target matrix", async (t) => {
  const window = await createApp("config-fields");
  t.after(() => window.close());
  const { document } = window;

  click(window, '[data-action="open-field-template-export"]');
  assert.ok(document.querySelector('[role="dialog"][aria-label="导出字段"]'));
  assert.match(document.querySelector(".template-callout").textContent, /建议.*不会按源 ID 静默覆盖/s);
  click(window, '[data-action="choose-template-export-fields"]');
  await waitFor(() => window.MvuUi.state.entityPicker?.orderIds.length > 0, "field export picker did not load");
  click(window, '[data-picker-id="picker-field-001"]');
  click(window, '[data-action="confirm-entity-picker"]');
  await waitFor(() => document.querySelector('[data-template-export-field="picker-field-001"]'), "selected export field did not render");

  click(window, '[data-action="choose-template-export-targets"]');
  await waitFor(() => window.MvuUi.state.entityPicker?.entity === "actors" && window.MvuUi.state.entityPicker.orderIds.length > 0, "actor export picker did not load");
  click(window, '[data-picker-id="picker-actor-001"]');
  click(window, '[data-picker-id="picker-actor-002"]');
  click(window, '[data-action="confirm-entity-picker"]');
  await waitFor(() => document.querySelectorAll("[data-template-export-target-id]").length === 2, "target matrix did not render");

  const carry = document.querySelector('[data-template-export-target-id="picker-actor-001"] [data-export-include-value]');
  carry.checked = true;
  carry.dispatchEvent(new window.Event("change", { bubbles: true }));
  click(window, '[data-action="commit-field-template-export"]');
  await waitFor(() => window.MvuUi.state.fieldTemplateFlow?.result, "export did not complete");

  assert.deepEqual(plain(window.MvuUi.state.demoLastRequests.exportFieldTemplate), {
    fieldIds: ["picker-field-001"],
    targetSelections: [{
      fieldId: "picker-field-001",
      targets: [
        { targetId: "picker-actor-001", enabled: true, includeValue: true },
        { targetId: "picker-actor-002", enabled: true, includeValue: false },
      ],
    }],
  });
  assert.match(document.getElementById("toast").textContent, /download.*\.json/i);
});

test("import flow keeps preview revision through content, conflict, and searchable mapping steps", async (t) => {
  const window = await createApp("config-fields");
  t.after(() => window.close());
  await window.MvuUi.native.call("exportFieldTemplate", {
    fieldIds: ["picker-field-001"],
    targetSelections: [{
      fieldId: "picker-field-001",
      targets: [{ targetId: "picker-actor-001", enabled: true, includeValue: true }],
    }],
  });

  await window.MvuUi.importFieldTemplateText(window.MvuUi.state.demoLastFieldTemplateJson, "fixture.json");
  await waitFor(() => window.document.querySelector('[data-template-import-step="content"]'), "content preview missing");
  const previewRevision = window.MvuUi.state.fieldTemplateFlow.previewRevision;
  assert.equal(previewRevision, window.MvuUi.state.snapshot.revision);
  assert.match(window.document.querySelector('[data-template-import-step="content"]').textContent, /依赖/);

  click(window, '[data-action="next-field-template-import"]');
  assert.ok(window.document.querySelector('[data-template-import-step="conflict"]'));
  const strategy = window.document.querySelector('[data-import-strategy="picker-field-001"]');
  assert.equal(strategy.value, "create_copy");
  strategy.value = "replace";
  strategy.dispatchEvent(new window.Event("change", { bubbles: true }));

  click(window, '[data-action="next-field-template-import"]');
  assert.ok(window.document.querySelector('[data-template-import-step="mapping"]'));
  click(window, '[data-action="choose-template-import-targets"]');
  await waitFor(() => window.MvuUi.state.entityPicker?.entity === "actors" && window.MvuUi.state.entityPicker.orderIds.length > 0, "mapping picker did not load");
  click(window, '[data-picker-id="picker-actor-002"]');
  click(window, '[data-action="confirm-entity-picker"]');
  await waitFor(() => window.document.querySelector('[data-template-import-target-id="picker-actor-002"]'), "mapped target missing");
  const policy = window.document.querySelector('[data-template-import-target-id="picker-actor-002"] [data-import-value-policy]');
  policy.value = "template_value";
  policy.dispatchEvent(new window.Event("change", { bubbles: true }));

  click(window, '[data-action="commit-field-template-import"]');
  await waitFor(() => window.MvuUi.state.fieldTemplateFlow?.result, "import did not complete");
  const request = window.MvuUi.state.demoLastRequests.importFieldTemplate;
  assert.equal(request.expectedRevision, previewRevision);
  assert.equal(window.MvuUi.state.fieldTemplateFlow.previewRevision, previewRevision);
  assert.deepEqual(plain(request.decisions.fields), [{
    sourceFieldId: "picker-field-001",
    strategy: "replace",
    mappings: [{
      sourceTargetId: "picker-actor-001",
      targets: [
        { targetId: "picker-actor-001", enabled: true, valuePolicy: "template_value" },
        { targetId: "picker-actor-002", enabled: true, valuePolicy: "template_value" },
      ],
    }],
  }]);
  assert.match(window.document.querySelector("[data-template-import-result]").textContent, /已替换 1.*跳过 0.*需修复 0/s);
});

test("import mapping offers per-field enable-all, disable-all, and file-suggestion controls", async (t) => {
  const window = await createApp("config-fields");
  t.after(() => window.close());
  await window.MvuUi.native.call("exportFieldTemplate", {
    fieldIds: ["picker-field-001"],
    targetSelections: [{
      fieldId: "picker-field-001",
      targets: [{ targetId: "picker-actor-001", enabled: true, includeValue: false }],
    }],
  });
  await window.MvuUi.importFieldTemplateText(window.MvuUi.state.demoLastFieldTemplateJson, "disabled-suggestion.json");
  click(window, '[data-action="next-field-template-import"]');
  click(window, '[data-action="next-field-template-import"]');
  const selector = '[data-template-import-target-id="picker-actor-001"] [data-import-target-enabled]';
  assert.equal(window.document.querySelector(selector).checked, true, "file enabled suggestion was not applied");

  click(window, '[data-action="set-import-field-enabled"][data-import-batch-mode="all_off"]');
  assert.equal(window.document.querySelector(selector).checked, false);
  click(window, '[data-action="set-import-field-enabled"][data-import-batch-mode="file_suggestion"]');
  assert.equal(window.document.querySelector(selector).checked, true);
  click(window, '[data-action="set-import-field-enabled"][data-import-batch-mode="all_on"]');
  assert.equal(window.document.querySelector(selector).checked, true);
  assert.match(window.document.querySelector("[data-import-field-batch]").textContent, /全部启用.*全部停用.*采用文件建议/s);
});

test("stale field-template import visibly re-previews the same file and preserves compatible decisions", async (t) => {
  const window = await createApp("config-fields");
  t.after(() => window.close());
  await window.MvuUi.native.call("exportFieldTemplate", {
    fieldIds: ["picker-field-001"],
    targetSelections: [{
      fieldId: "picker-field-001",
      targets: [{ targetId: "picker-actor-001", enabled: true, includeValue: true }],
    }],
  });
  await window.MvuUi.importFieldTemplateText(window.MvuUi.state.demoLastFieldTemplateJson, "stale-fixture.json");
  click(window, '[data-action="next-field-template-import"]');
  const strategy = window.document.querySelector('[data-import-strategy="picker-field-001"]');
  strategy.value = "replace";
  strategy.dispatchEvent(new window.Event("change", { bubbles: true }));
  click(window, '[data-action="next-field-template-import"]');
  click(window, '[data-action="choose-template-import-targets"]');
  await waitFor(() => window.MvuUi.state.entityPicker?.entity === "actors" && window.MvuUi.state.entityPicker.orderIds.length > 0, "mapping picker missing");
  click(window, '[data-picker-id="picker-actor-002"]');
  click(window, '[data-action="confirm-entity-picker"]');
  await waitFor(() => window.document.querySelector('[data-template-import-target-id="picker-actor-002"]'), "extra mapping missing");

  const staleRevision = window.MvuUi.state.fieldTemplateFlow.previewRevision;
  window.MvuUi.state.demoStore.revision += 1;
  click(window, '[data-action="commit-field-template-import"]');
  await waitFor(() => window.document.querySelector('[data-action="refresh-field-template-preview"]'), "stale recovery action missing");
  assert.match(window.document.querySelector("[data-field-template-error]").textContent, /数据已变化|重新预览/);

  click(window, '[data-action="refresh-field-template-preview"]');
  await waitFor(() => window.MvuUi.state.fieldTemplateFlow.previewRevision > staleRevision && !window.MvuUi.state.fieldTemplateFlow.refreshing, "same-file preview did not refresh revision");
  const refreshed = window.MvuUi.state.fieldTemplateFlow;
  assert.equal(refreshed.step, 3);
  assert.equal(refreshed.strategies["picker-field-001"], "replace");
  assert.ok(refreshed.importMappings["picker-field-001\u0000picker-actor-001"].some((target) => target.targetId === "picker-actor-002"));

  click(window, '[data-action="commit-field-template-import"]');
  await waitFor(() => window.MvuUi.state.fieldTemplateFlow?.result, "import after refreshed preview did not recover");
  assert.equal(window.MvuUi.state.demoLastRequests.importFieldTemplate.expectedRevision, staleRevision + 1);
});

test("repair summary deduplicates overlapping references and names every repair category", async (t) => {
  const window = await createApp("config-fields");
  t.after(() => window.close());
  await window.MvuUi.native.call("exportFieldTemplate", {
    fieldIds: ["picker-field-001"],
    targetSelections: [{ fieldId: "picker-field-001", targets: [] }],
  });
  const nativeCall = window.MvuUi.native.call.bind(window.MvuUi.native);
  window.MvuUi.native.call = async (method, params) => {
    const result = await nativeCall(method, params);
    if (method !== "previewFieldTemplateImport") return result;
    result.omittedDependencies = [{
      fieldId: "picker-field-001",
      totalCount: 4,
      truncated: false,
      items: [
        { kind: "rule", sourceId: "rule-a", readableName: "规则 A" },
        { kind: "condition", sourceId: "condition-a", readableName: "条件 A" },
        { kind: "link_rule", sourceId: "link-a", readableName: "联动 A" },
        { kind: "effect_group", sourceId: "effect-a", readableName: "效果 A" },
      ],
    }];
    result.invalidReferences = [
      "OMITTED_DEPENDENCY:picker-field-001:rule:rule-a",
      "BROKEN_REFERENCE:picker-field-001:ghost-a",
      "BROKEN_REFERENCE:picker-field-001:ghost-a",
    ];
    return result;
  };

  await window.MvuUi.importFieldTemplateText(window.MvuUi.state.demoLastFieldTemplateJson, "repair-fixture.json");
  await waitFor(() => window.document.querySelector("[data-repair-categories]"), "repair categories missing from preview");
  const previewText = window.document.querySelector("[data-repair-categories]").textContent;
  assert.match(previewText, /规则\s*1/);
  assert.match(previewText, /条件\s*1/);
  assert.match(previewText, /状态联动\s*1/);
  assert.match(previewText, /临时效果\s*1/);
  assert.match(previewText, /其他无效引用\s*1/);
  assert.equal(window.MvuUi.state.fieldTemplateFlow.repairCount, 5);

  click(window, '[data-action="next-field-template-import"]');
  click(window, '[data-action="next-field-template-import"]');
  click(window, '[data-action="commit-field-template-import"]');
  await waitFor(() => window.MvuUi.state.fieldTemplateFlow?.result, "repair fixture import did not complete");
  const resultText = window.document.querySelector("[data-template-import-result]").textContent;
  assert.match(resultText, /需修复 5/);
  assert.match(resultText, /规则\s*1.*条件\s*1.*状态联动\s*1.*临时效果\s*1.*其他无效引用\s*1/s);
});

test("field-template host errors stay inline and recover on retry", async (t) => {
  const window = await createApp("config-fields");
  t.after(() => window.close());

  click(window, '[data-action="open-field-template-export"]');
  click(window, '[data-action="choose-template-export-fields"]');
  await waitFor(() => window.MvuUi.state.entityPicker?.orderIds.length > 0, "field picker did not load");
  click(window, '[data-picker-id="picker-field-001"]');
  click(window, '[data-action="confirm-entity-picker"]');
  window.MvuUi.state.demoNextFailureMethod = "exportFieldTemplate";
  click(window, '[data-action="commit-field-template-export"]');
  await waitFor(() => /失败/.test(window.document.querySelector("[data-field-template-error]")?.textContent || ""), "inline export error missing");
  assert.ok(window.document.querySelector('[data-action="commit-field-template-export"]'));
  click(window, '[data-action="commit-field-template-export"]');
  await waitFor(() => window.MvuUi.state.fieldTemplateFlow?.result, "export retry did not recover");
});

test("invalid import files remain inside the configuration dialog with a recoverable inline error", async (t) => {
  const window = await createApp("config-fields");
  t.after(() => window.close());

  await window.MvuUi.importFieldTemplateText("{not-json", "broken.json");
  await waitFor(
    () => /无法预览模板/.test(window.document.querySelector("[data-field-template-error]")?.textContent || ""),
    "invalid import did not expose an inline error",
  );
  assert.equal(window.document.querySelector(".recovery-state"), null);
  assert.ok(window.document.querySelector('[role="dialog"][aria-label="导入字段"]'));
  assert.ok(window.document.querySelector('[data-action="close-field-template-flow"]'));
});

test("field-template dialog keeps overlay clicks inside and Escape restores each logical opener", async (t) => {
  const window = await createApp("config-fields");
  t.after(() => window.close());
  const { document } = window;

  const exportOpener = document.querySelector('[data-action="open-field-template-export"]');
  exportOpener.focus();
  exportOpener.click();
  await waitFor(() => document.querySelector('.field-template-dialog[aria-modal="true"]'), "export dialog missing");
  document.querySelector(".template-callout").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.ok(document.querySelector(".field-template-dialog"), "internal overlay click closed the dialog");
  document.querySelector(".field-template-dialog").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await waitFor(() => !document.querySelector(".field-template-dialog"), "Escape did not close export dialog");
  assert.equal(document.activeElement, document.querySelector('[data-action="open-field-template-export"]'));

  await window.MvuUi.native.call("exportFieldTemplate", {
    fieldIds: ["picker-field-001"],
    targetSelections: [{ fieldId: "picker-field-001", targets: [] }],
  });
  const importOpener = document.querySelector('[data-action="open-field-template-import"]');
  importOpener.focus();
  importOpener.click();
  await window.MvuUi.importFieldTemplateText(window.MvuUi.state.demoLastFieldTemplateJson, "fixture.json");
  await waitFor(() => document.querySelector('.field-template-dialog[aria-label="导入字段"]'), "import dialog missing");
  document.querySelector(".field-template-dialog").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await waitFor(() => !document.querySelector(".field-template-dialog"), "Escape did not close import dialog");
  assert.equal(document.activeElement, document.querySelector('[data-action="open-field-template-import"]'));
});

test("complete effect-group DTOs require an exact bounded defaultReason and demo entities provide it", async (t) => {
  const window = await createApp("effect-library");
  t.after(() => window.close());
  const full = await window.MvuUi.native.call("getEntityById", { entityType: "effectGroup", id: "effect-1" });
  assert.deepEqual(plain(full.defaultReason), { mode: "template", template: "general", text: "" });
  const response = (entity) => ({ items: [entity], loadedCount: 1, totalCount: 1, hasMore: false, nextCursor: null });
  const validate = (entity) => window.MvuUi.validateQueryResponse(response(entity), "effectGroups", { page: 1 });
  assert.doesNotThrow(() => validate(full));

  const missing = plain(full);
  delete missing.defaultReason;
  assert.throws(() => validate(missing), /MVU_EFFECT_REASON_CONFIG_INVALID/);
  const unknown = plain(full);
  unknown.defaultReason.extra = true;
  assert.throws(() => validate(unknown), /MVU_EFFECT_REASON_CONFIG_INVALID/);
  const blankCustom = plain(full);
  blankCustom.defaultReason = { mode: "custom", template: "relationship", text: "   " };
  assert.throws(() => validate(blankCustom), /MVU_EFFECT_REASON_CONFIG_INVALID/);
  const oversized = plain(full);
  oversized.defaultReason = { mode: "template", template: "positive", text: "字".repeat(513) };
  assert.throws(() => validate(oversized), /MVU_EFFECT_REASON_CONFIG_INVALID/);
  const bounded = plain(full);
  bounded.defaultReason = { mode: "custom", template: "environment", text: "字".repeat(512) };
  assert.doesNotThrow(() => validate(bounded));
});
