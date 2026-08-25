import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const uiFiles = [
  "runtime.js", "components.js", "pages-status.js", "pages-config.js",
  "pages-rules.js", "pages-advanced.js", "app.js",
];
const sources = Object.fromEntries(await Promise.all(uiFiles.map(async (file) => [
  file,
  await readFile(path.join(root, "static", "app_ui", file), "utf8"),
])));
const appSource = sources["app.js"];
const runtimeSource = sources["runtime.js"];
const componentSource = sources["components.js"];
const statusSource = sources["pages-status.js"];
const configSource = sources["pages-config.js"];
const ruleSource = sources["pages-rules.js"];
const advancedSource = sources["pages-advanced.js"];
const allUi = uiFiles.map((file) => sources[file]).join("\n");
const styleSource = await readFile(path.join(root, "static/app_ui/styles.css"), "utf8");
const indexSource = await readFile(path.join(root, "static/app_ui/index.html"), "utf8");
const bridgeSource = await readFile(path.join(root, "src/ui/web_container/index.ui.ts"), "utf8");
const modelSource = await readFile(path.join(root, "src/mvu/app/model.ts"), "utf8");
const effectBridgeSource = await readFile(path.join(root, "src/mvu/app/mvu-bridge.ts"), "utf8");
const validationSource = await readFile(path.join(root, "src/mvu/app/validation.ts"), "utf8");

function captures(source, pattern) {
  return new Set(Array.from(source.matchAll(pattern), (match) => match[1]));
}

const bridgeMethods = captures(bridgeSource, /case "([A-Za-z][A-Za-z0-9]+)"/g);
const literalNativeMethods = captures(allUi, /(?:native\.call|callNative)\("([A-Za-z][A-Za-z0-9]+)"/g);
const missingLiteralBridgeMethods = [...literalNativeMethods].filter((method) => !bridgeMethods.has(method));
assert.deepEqual(missingLiteralBridgeMethods, [], `Native methods without bridge cases: ${missingLiteralBridgeMethods.join(", ")}`);

const requiredV3BridgeMethods = [
  "snapshot", "queryFields", "queryActors", "queryGroups", "queryRules", "queryConditions",
  "queryEffectGroups", "queryRecords", "getEntityById",
  "createCondition", "updateCondition", "copyCondition", "toggleCondition", "deleteCondition", "getConditionReferences",
  "createEffectGroup", "updateEffectGroup", "copyEffectGroup", "toggleEffectGroup", "deleteEffectGroup", "getEffectGroupReferences",
  "createRule", "updateRule", "copyRule", "toggleRule", "deleteRule", "getRuleReferences",
];
assert.deepEqual(requiredV3BridgeMethods.filter((method) => !bridgeMethods.has(method)), [], "NativeMvu v3 bridge is incomplete");

assert.match(componentSource, /aria-label="打开菜单"/, "Menu navigation needs an accessible name");
assert.match(componentSource, /class="icon-button back-button"[^>]*aria-label="返回"/, "Back navigation needs an accessible name");
assert.match(componentSource, /aria-current="page"/, "Bottom navigation must expose the current root");
assert.match(componentSource, /role="tab" aria-selected=/, "Segmented controls must expose selected state");
assert.match(componentSource, /data-select-actor=/, "Role selection must use native buttons");
assert.match(componentSource, /data-select-group=/, "Group selection must use native buttons");
assert.match(statusSource, /groupMode[\s\S]*?groupSelector[\s\S]*?actorSelector/, "Group status must replace rather than stack the role row");

assert.match(configSource, /data-range-card=/, "Field settings must render inline range cards");
assert.match(configSource, /data-range-number="minimum"[\s\S]*?data-range-number="maximum"/, "Range cards need lower and upper inputs");
assert.match(appSource, /action === "save-field-range"/, "Inline range saving needs a handler");
assert.match(appSource, /patch:\s*\{\s*minimum,\s*maximum\s*\}/, "Range saving must persist both bounds atomically");
assert.match(configSource, /保存后按相对位置同步当前值、阶段与关联规则/, "Range UI must explain proportional synchronization");

assert.match(ruleSource, /触发后改变的字段内容[\s\S]*?应用临时效果/, "Rule results must expose explicit effect imports");
assert.match(ruleSource, /效果是结果，不包含触发条件/, "Rule effects must remain separate from conditions");
assert.match(ruleSource, /默认模板[\s\S]*?自定义原因[\s\S]*?原因预览/, "Effect reasons need visible template/custom modes and preview");
assert.match(ruleSource, /情绪变化[\s\S]*?行为意图[\s\S]*?关系事件[\s\S]*?场景事件[\s\S]*?自定义类型/, "AI conditions need visual trigger types");
assert.match(ruleSource, /所有绑定角色[\s\S]*?触发角色[\s\S]*?指定角色/, "Field-first effects need actor targeting");
assert.match(ruleSource, /立即增减[\s\S]*?固定修正[\s\S]*?正向倍率[\s\S]*?负向倍率[\s\S]*?通用倍率/, "Field effects need all calculation types");

assert.match(modelSource, /interface DataTemporaryEffect[\s\S]*?targets:\s*DataTemporaryEffectTarget\[\][\s\S]*?reasonMode:/,
  "Legacy backend compatibility must retain multi-target effects and reasons");
assert.match(effectBridgeSource, /selectedEffectIds[\s\S]*?effect\.targets\.some/,
  "Legacy effect application must honor explicit result imports");
assert.match(validationSource, /function normalizeLegacyTemporaryEffect[\s\S]*?targets:\s*\[\{ fieldId: targetFieldId, scope, scopeKey \}\]/,
  "Published single-target effects must migrate without loss");

assert.match(advancedSource, /页面外观[\s\S]*?导入与导出/, "Advanced must own appearance and import/export");
assert.doesNotMatch(advancedSource, /模型可见性|状态设置|data-field-id/, "Advanced may not own field status configuration");
assert.match(indexSource, /id="backgroundPicker"[^>]*aria-label="选择背景图片"[^>]*tabindex="-1"/, "Background input needs a name and no tab stop");
assert.match(indexSource, /id="datasetImportPicker"[^>]*aria-label="选择数据集文件"[^>]*tabindex="-1"/, "Import input needs a name and no tab stop");

assert.match(runtimeSource, /document\.startViewTransition/, "Transitions must progressively use the View Transition API");
assert.match(styleSource, /::view-transition-old\(segmented-selection\)[\s\S]*?::view-transition-new\(segmented-selection\)/,
  "Segmented controls need outgoing and incoming motion");
assert.match(styleSource, /\.segmented-control button\s*\{[\s\S]*?min-height:\s*38px;[\s\S]*?font-size:\s*var\(--type-body\);/,
  "Segmented controls must reduce height without reducing body text");
assert.match(styleSource, /\.back-button\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/,
  "Back targets must remain at least 44px");

console.log(JSON.stringify({
  modules: uiFiles.length,
  bridgeMethods: bridgeMethods.size,
  nativeMethods: literalNativeMethods.size,
  result: "PASS",
}, null, 2));
