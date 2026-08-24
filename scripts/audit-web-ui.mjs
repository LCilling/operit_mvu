import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const mvuRoot = path.resolve(scriptDirectory, "..");
const appSource = await readFile(path.join(mvuRoot, "static/app_ui/app.js"), "utf8");
const styleSource = await readFile(path.join(mvuRoot, "static/app_ui/styles.css"), "utf8");
const indexSource = await readFile(path.join(mvuRoot, "static/app_ui/index.html"), "utf8");
const bridgeSource = await readFile(path.join(mvuRoot, "src/ui/web_container/index.ui.ts"), "utf8");
const modelSource = await readFile(path.join(mvuRoot, "src/mvu/app/model.ts"), "utf8");
const effectBridgeSource = await readFile(path.join(mvuRoot, "src/mvu/app/mvu-bridge.ts"), "utf8");
const validationSource = await readFile(path.join(mvuRoot, "src/mvu/app/validation.ts"), "utf8");

function captures(source, pattern) {
  return new Set(Array.from(source.matchAll(pattern), (match) => match[1]));
}

function objectBody(source, declaration, nextDeclaration) {
  const start = source.indexOf(declaration);
  const end = source.indexOf(nextDeclaration, start);
  assert.notEqual(start, -1, `${declaration} missing`);
  assert.notEqual(end, -1, `${nextDeclaration} missing`);
  return source.slice(start, end);
}

const staticActions = captures(appSource, /data-action="([a-z][a-z-]+)"/g);
const configuredActions = captures(appSource, /\baction:\s*"([a-z][a-z-]+)"/g);
const handledActions = captures(appSource, /action === "([a-z][a-z-]+)"/g);
const declaredActions = new Set([...staticActions, ...configuredActions]);
const missingActionHandlers = [...declaredActions].filter((action) => !handledActions.has(action));
assert.deepEqual(missingActionHandlers, [], `UI actions without handlers: ${missingActionHandlers.join(", ")}`);

const uiNativeMethods = captures(appSource, /callNative\("([A-Za-z][A-Za-z0-9]+)"/g);
const bridgeMethods = captures(bridgeSource, /case "([A-Za-z][A-Za-z0-9]+)"/g);
const missingBridgeMethods = [...uiNativeMethods].filter((method) => !bridgeMethods.has(method));
assert.deepEqual(missingBridgeMethods, [], `Native methods without bridge cases: ${missingBridgeMethods.join(", ")}`);

const screenMetaBody = objectBody(appSource, "const SCREEN_META = {", "const SCREEN_IDS");
const rendererBody = objectBody(appSource, "const renderers = {", "function render(");
const screenIds = captures(screenMetaBody, /^\s{2}([A-Za-z][A-Za-z0-9]*):/gm);
const rendererIds = captures(rendererBody, /^\s{2}([A-Za-z][A-Za-z0-9]*):/gm);
assert.deepEqual([...rendererIds].sort(), [...screenIds].sort(), "Screen metadata and renderers differ");

assert.match(appSource, /<button type="button" class="role-chip [\s\S]*?data-select-actor=/,
  "Role switching must use native buttons");
assert.doesNotMatch(appSource, /role="listitem"[^>]*data-select-actor=/,
  "Role buttons must retain their button accessibility role");
assert.match(appSource, /data-action="go-back" data-back-screen=/,
  "Top-bar back actions must use browser history");
assert.match(appSource, /class="icon-button back-button"/,
  "Back navigation must have a dedicated unframed visual style");
assert.match(styleSource, /button\.icon-button\.back-button,[\s\S]*?background:\s*transparent;/,
  "Back navigation must render without a button-colored background");
assert.match(appSource, /if \(appState\.screen === screenId\)/,
  "Repeated navigation to the current screen must not add history entries");
assert.match(appSource, /const actorChanged =[\s\S]*?if \(actorChanged\) \{/,
  "Role changes must invalidate field drafts from the previous actor context");
assert.match(appSource, /if \(context\.groupId === null\) return \{\};[\s\S]*?groupId: context\.groupId, actorId:/,
  "Group snapshot refreshes must preserve the selected group and optional member");
assert.match(appSource, /isStaleActorSelectionError[\s\S]*?isStaleGroupSelectionError[\s\S]*?callNative\("snapshot", \{\}\)/,
  "Stale group or member requests must recover against the active host context");
assert.match(appSource, /previousScrollTop[\s\S]*?nextScroll\.scrollTop/,
  "In-page rerenders must preserve long-form scroll position");
assert.match(appSource, /aria-current="page"/, "Bottom navigation must expose the current page");
assert.match(appSource, /"data-home-scope"/,
  "Group chats must expose explicit character and group state modes");
assert.match(appSource, /homeScope === "group"[\s\S]*?reloadSnapshot\(\{ groupId: context\.groupId \}\)/,
  "Group-state mode must preserve the selected group without an actor override");
assert.match(appSource, /const roleStrip = groupMode \|\| actors\.length === 0[\s\S]*?\? ""/,
  "Group-state mode must hide the character selector");
assert.match(appSource, /const groupStrip = !groupMode[\s\S]*?data-select-group=/,
  "Group-state mode must expose every host group as a selectable control");
assert.match(appSource, /\{ id: "fields", icon: "settings", label: "字段" \},[\s\S]*?\{ id: "rules"[\s\S]*?\{ id: "effects"/,
  "Independent field, rule, and effect destinations must have separate bottom navigation entries");
assert.match(appSource, /function renderRules\(\)[\s\S]*?title: "规则设置",[\s\S]*?top: \{ menu: true \}/,
  "Rule management must render as a top-level menu destination");
assert.match(appSource, /function renderEffects\(\)[\s\S]*?title: "临时效果",[\s\S]*?menu: true/,
  "Temporary-effect management must render as a top-level menu destination");
assert.match(appSource, /role="tab" aria-selected=/, "Segmented tabs must expose selected state");
assert.match(appSource, /data-range-card=/,
  "Field settings must render inline range cards");
assert.match(appSource, /data-range-number="minimum"[\s\S]*?data-range-number="maximum"/,
  "Every inline range card must expose lower and upper bound inputs");
assert.match(appSource, /action === "save-field-range"/,
  "Inline range saving must have a UI action handler");
assert.match(appSource, /patch: \{ minimum: draft\.minimum, maximum: draft\.maximum \}/,
  "Inline range saving must persist both bounds atomically");
assert.match(appSource, /<canvas class="trend-canvas" role="img"/, "Trend canvases need image semantics");
assert.match(styleSource, /\.switch\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/,
  "Switch touch targets must be at least 44 by 44 pixels");
assert.match(styleSource, /\.segmented-tabs\s*\{[\s\S]*?padding:\s*2px;/,
  "Segmented controls must use the compact container rhythm");
assert.match(styleSource, /\.segmented-tabs button\s*\{[\s\S]*?min-height:\s*38px;[\s\S]*?font-size:\s*var\(--type-body\);/,
  "Segmented controls must reduce height without reducing text size");
assert.match(styleSource, /\.segmented-tabs \+ \.selected-field-banner\s*\{[\s\S]*?margin-top:\s*10px;/,
  "Change-setting tabs must not overlap the selected-field banner");
assert.match(appSource, /function transitionRender\([\s\S]*?document\.startViewTransition/,
  "Segmented state changes must use progressive view transitions");
assert.match(styleSource, /::view-transition-old\(segmented-selection\)[\s\S]*?::view-transition-new\(segmented-selection\)/,
  "Segmented selections must define smooth outgoing and incoming motion");

const editBody = objectBody(appSource, "function renderEdit()", "function stagePosition(");
assert.match(editBody, /editorSection\("基础信息"[\s\S]*?editorSection\("作用范围"[\s\S]*?editorSection\("字段外观"[\s\S]*?editorSection\("详细配置"/,
  "Field editing sections must share one heading hierarchy");
assert.match(editBody, /configTile\("format_list_numbered"[\s\S]*?configTile\("schedule"[\s\S]*?configTile\("magic_button"[\s\S]*?configTile\("dashboard_customize"/,
  "Detailed field configuration must use four aligned visual tiles");
const bindingBody = objectBody(appSource, "function contextBindingPicker(draft)", "function renderEdit()");
assert.match(bindingBody, /snapshot\.groups[\s\S]*?group\.name[\s\S]*?contextLabels\.chatName/,
  "Group and chat bindings must display host-readable names");
assert.match(bindingBody, /<details class="binding-advanced">[\s\S]*?创建模板或管理多个会话时使用/,
  "Multi-chat binding controls must remain progressively disclosed");
assert.match(appSource, /if \(fieldDraft\.scope !== nextScope\)[\s\S]*?fieldDraft\.bindingIds = bindingId === null \? \[\] : \[bindingId\]/,
  "Selecting a scoped field must automatically bind the active host context");

const effectBody = objectBody(appSource, "function renderEffect()", "function renderModelProbe()");
assert.match(effectBody, /aria-label="目标字段与作用对象，可多选"[\s\S]*?data-effect-target-scope-key/,
  "Temporary effects must expose an explicit multi-target and scope picker");
assert.doesNotMatch(effectBody, /触发来源|data-effect-trigger-source/,
  "Temporary effects must describe results without owning trigger conditions");
assert.match(effectBody, /默认模板[\s\S]*?自定义原因[\s\S]*?data-effect-reason-template/,
  "Temporary-effect reasons must support visible templates and custom input");
assert.match(modelSource, /interface DataTemporaryEffect[\s\S]*?targets:\s*DataTemporaryEffectTarget\[\][\s\S]*?reasonMode:/,
  "The backend temporary-effect contract must support targets and reasons");
assert.doesNotMatch(modelSource, /TemporaryEffectTriggerSource|triggerSources:/,
  "Temporary effects must not persist trigger conditions");
assert.match(effectBridgeSource, /selectedEffectIds[\s\S]*?effect\.targets\.some/,
  "Backend effect application must honor explicit result imports and target context");
assert.match(validationSource, /function normalizeLegacyTemporaryEffect[\s\S]*?targets:\s*\[\{ fieldId: targetFieldId, scope, scopeKey \}\]/,
  "Published single-target effects must migrate to the multi-target contract");

const ruleBody = objectBody(appSource, "function renderRule()", "function recordFilterSelect(");
assert.match(ruleBody, /触发后改变的字段内容[\s\S]*?autoEffectRow/,
  "Rule results must render structured field changes");
assert.match(appSource, /function temporaryEffectImportChoices[\s\S]*?data-auto-effect-import-id=/,
  "Rule field changes must expose explicit temporary-effect imports");
assert.match(appSource, /aiJudgement[\s\S]*?AI_TRIGGER_PRESETS[\s\S]*?data-ai-trigger-preset/,
  "Rules must expose visual AI trigger types and requirements");
const drawerBody = objectBody(appSource, "function renderOverlay()", "function applyBackgroundPreference(");
assert.doesNotMatch(drawerBody, /<p>外观<\/p>|更换背景照片|恢复默认背景/,
  "Drawer appearance shortcuts must be consolidated into advanced options");

const advancedBody = objectBody(appSource, "function renderAdvanced()", "function autoConditionSummary(");
assert.match(advancedBody, /页面外观[\s\S]*?导入与导出/,
  "Advanced options must contain appearance and import/export");
assert.doesNotMatch(advancedBody, /modelVisibility|模型可见性|状态设置|field-id/,
  "Advanced options must not contain field state or model visibility controls");
assert.match(indexSource, /id="backgroundPicker"[^>]*aria-label="选择背景图片"[^>]*tabindex="-1"/,
  "Background file input needs an accessible name and no tab stop");
assert.match(indexSource, /id="datasetImportPicker"[^>]*aria-label="选择数据集文件"[^>]*tabindex="-1"/,
  "Dataset file input needs an accessible name and no tab stop");

console.log(JSON.stringify({
  screens: screenIds.size,
  declaredActions: declaredActions.size,
  handledActions: handledActions.size,
  nativeMethods: uiNativeMethods.size,
  result: "PASS"
}, null, 2));
