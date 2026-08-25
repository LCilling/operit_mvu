/**
 * Impeccable / Operate constraints for the MVU mobile WebView:
 * - Preserve docs/DESIGN.md's restrained purple-blue, 14px body type, 12/14/16/20px radius scale.
 * - Exactly four stable roots; root headers use menu, child headers use one unframed 44px back target.
 * - The screen is a normal-flow grid: header, scroll region, contextual actions, navigation.
 * - Segmented controls stay compact without shrinking text and animate in 180–220ms unless motion is reduced.
 * - Compact Task 6 snapshots and bounded queries are the only collection boundary; malformed data is recoverable.
 * - Status detail cards keep a uniform 12px rhythm; stage and trend share one field range and stage palette.
 * - Familiar controls, readable errors, keyboard focus, empty/loading states, and 44px touch targets outrank decoration.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const uiDirectory = path.join(root, "static", "app_ui");
const moduleNames = [
  "runtime.js",
  "components.js",
  "pages-status.js",
  "pages-config.js",
  "pages-rules.js",
  "pages-advanced.js",
  "app.js",
];

async function optional(relativePath) {
  try {
    return await readFile(path.join(root, relativePath), "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return "";
    throw error;
  }
}

const files = Object.fromEntries(await Promise.all(moduleNames.map(async (name) => [
  name,
  await optional(path.join("static", "app_ui", name)),
])));
const styles = await optional(path.join("static", "app_ui", "styles.css"));
const index = await optional(path.join("static", "app_ui", "index.html"));
const build = await optional(path.join("scripts", "build-web.mjs"));
const container = await optional(path.join("src", "ui", "web_container", "index.ui.ts"));
const textScaleFixture = await optional(path.join("tests", "fixtures", "ui-text-scale.html"));
const malformedNativeFixture = await optional(path.join("tests", "fixtures", "ui-native-malformed.html"));
const allUi = moduleNames.map((name) => files[name]).join("\n");
const violations = [];

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) violations.push(message);
}

function rejectMatch(source, pattern, message) {
  if (pattern.test(source)) violations.push(message);
}

for (const name of moduleNames) {
  if (files[name].length === 0) violations.push(`missing UI module: ${name}`);
}

requireMatch(files["runtime.js"], /window\.MvuUi\s*=\s*\{[\s\S]*?state[\s\S]*?native[\s\S]*?components:\s*\{\}[\s\S]*?pages:\s*\{\}/,
  "runtime must expose one window.MvuUi namespace");
rejectMatch(files["components.js"], /class="app-screen"\s+data-route=/,
  "screen containers must not reuse the delegated data-route action attribute");
requireMatch(files["components.js"], /const\s+BOTTOM_ROOTS\s*=\s*\[[\s\S]*?label:\s*"状态"[\s\S]*?label:\s*"配置"[\s\S]*?label:\s*"规则"[\s\S]*?label:\s*"高级"[\s\S]*?\];/,
  "bottom navigation must define exactly 状态/配置/规则/高级");
rejectMatch(files["components.js"], /label:\s*"(?:字段|效果|记录|外观)"/,
  "bottom roots may not expose legacy field/effect/record/appearance items");
requireMatch(files["runtime.js"], /root:\s*true[\s\S]*?header:\s*"menu"/,
  "root route metadata must use menu headers");
requireMatch(files["runtime.js"], /root:\s*false[\s\S]*?header:\s*"back"[\s\S]*?owner:/,
  "child route metadata must use back headers and retain an owning root");
requireMatch(files["components.js"], /class="icon-button back-button"[\s\S]*?data-action="go-back"/,
  "child top bars need a dedicated back action");
requireMatch(styles, /\.back-button\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;[\s\S]*?background:\s*transparent;/,
  "back arrow must be a 44px unframed touch target");
rejectMatch(files["components.js"], /drawer[\s\S]{0,1200}(?:更换背景|恢复默认背景|<p>外观<\/p>)/,
  "drawer must not contain a separate appearance group");

requireMatch(styles, /\.app-screen\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto\s+auto;/,
  "app-screen must use auto minmax(0,1fr) auto auto rows");
for (const selector of ["bottom-nav", "bottom-action"]) {
  const block = styles.match(new RegExp(`\\.${selector}\\s*\\{([\\s\\S]*?)\\}`));
  if (!block) violations.push(`missing .${selector} style`);
  else if (/position:\s*(?:absolute|fixed)/.test(block[1])) violations.push(`.${selector} must stay in normal flow`);
}
requireMatch(styles, /\.segmented-control\s*\{[\s\S]*?min-height:\s*44px;/,
  "segmented controls must use the compact 44px container");
rejectMatch(styles, /\.segmented-control\.static\s+button\s*\{[\s\S]*?font-size:/,
  "segmented variants must not reduce the shared body font size");
requireMatch(styles, /(?:180|200|220)ms/, "segmented/content motion must use a 180–220ms duration");
requireMatch(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
  "reduced-motion support is required");
rejectMatch(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\*,\s*\*::before|0\.01ms/,
  "reduced motion must use targeted immediate states, not blanket 0.01ms overrides");
requireMatch(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?::view-transition-(?:group|old|new)[\s\S]*?animation:\s*none/,
  "reduced motion must disable spatial view-transition animation");
requireMatch(allUi, /document\.startViewTransition/,
  "segmented and route content changes must use progressive view transitions");
requireMatch(files["components.js"], /aria-controls=/,
  "segmented tabs must own a labelled panel");
requireMatch(files["components.js"], /tabindex=/,
  "segmented tabs must use roving keyboard focus");
rejectMatch(styles, /view-transition-name:\s*segmented-selection/,
  "segmented controls must not share one transition identity");
rejectMatch(index, /maximum-scale|user-scalable=no/,
  "viewport must allow platform text and page zoom");
rejectMatch(container, /textZoom:\s*100/,
  "WebView must not override the host text scale");
requireMatch(files["app.js"], /Escape[\s\S]*?Tab/,
  "drawer must support Escape and trapped Tab focus");
requireMatch(files["app.js"], /pendingSegmentFocusId\s*=\s*nextTab\.id/,
  "roving tabs must retain the selected tab identity");
requireMatch(files["app.js"], /getElementById\(pendingSegmentFocusId\)/,
  "roving tabs must restore focus after asynchronous rendering");
requireMatch(files["app.js"], /data-reason-mode[\s\S]*?effectReasonMode/,
  "reason tabs must switch their owned content panel");
requireMatch(files["components.js"], /content:[\\/]\/[\s\S]*?https\?:[\\/]\//,
  "avatar URIs must use an explicit safe-scheme allowlist");
rejectMatch(files["app.js"], /assets\/character-state-theme\.png/,
  "default background must be inlined once through CSS only");

requireMatch(files["runtime.js"], /validateCompactSnapshot/,
  "runtime must validate MvuPageSnapshot");
requireMatch(files["runtime.js"], /snapshot\.pages\.fields[\s\S]*?snapshot\.pages\.records/,
  "runtime must consume compact snapshot page projections");
rejectMatch(files["runtime.js"], /snapshot\.(?:fields|records|actors|groups|selectableActorIds)\b/,
  "runtime must not require legacy unbounded snapshot arrays");
requireMatch(allUi, /数据无法载入[\s\S]*?重新加载|页面数据有误[\s\S]*?重试/,
  "malformed snapshots and queries need readable recovery actions");
requireMatch(files["runtime.js"], /validateQueryResponse/,
  "bounded query responses must be validated before rendering");
requireMatch(files["runtime.js"], /openEntityPicker[\s\S]*?searchEntityPicker[\s\S]*?fetchNextEntityPickerPage/,
  "runtime must export one searchable cursor picker contract");
requireMatch(files["runtime.js"], /PICKER_SEARCH_DEBOUNCE_MS\s*=\s*180/,
  "picker search must use the exact 180ms debounce");
requireMatch(files["runtime.js"], /requestToken[\s\S]*?token\s*!==[\s\S]*?requestToken/,
  "picker must discard stale async responses by request token");
requireMatch(files["components.js"], /role="dialog"[\s\S]*?data-picker-search[\s\S]*?data-picker-results/,
  "picker must render as a searchable dialog with a bounded result region");
requireMatch(files["components.js"], /picker-pinned[\s\S]*?已选择/,
  "picker must keep selected entities visibly pinned");
requireMatch(files["components.js"], /selectedIdList\.slice\(0,\s*pinnedLimit\)[\s\S]*?aria-label="另 [\s\S]*?项已选择/,
  "picker must bound pinned DOM and expose an accessible hidden-selection summary");
requireMatch(files["app.js"], /openEntityPicker\([\s\S]*?opener:\s*element/,
  "picker must retain its logical opener instead of relying on transient document focus");
requireMatch(files["runtime.js"], /restoreFocusDescriptor[\s\S]*?querySelectorAll\("\[data-action\]"\)[\s\S]*?candidate\.dataset\.pickerKey/,
  "picker close must resolve the stable logical opener after shell rerender");
requireMatch(files["app.js"], /open-field-picker[\s\S]*?ui\.openEntityPicker/,
  "field selector actions must call the shared entity picker");
requireMatch(files["app.js"], /open-actor-picker[\s\S]*?ui\.openEntityPicker/,
  "actor selector actions must call the shared entity picker");
requireMatch(files["app.js"], /open-condition-picker[\s\S]*?ui\.openEntityPicker/,
  "condition selector actions must call the shared entity picker");
requireMatch(files["app.js"], /open-effect-picker[\s\S]*?ui\.openEntityPicker/,
  "effect selector actions must call the shared entity picker");
requireMatch(files["app.js"], /data-picker-results[\s\S]*?fetchNextEntityPickerPage/,
  "picker must auto-fetch its cursor near the scroll boundary");
requireMatch(files["app.js"], /entityPicker[\s\S]*?Escape[\s\S]*?Tab/,
  "picker must support Escape and trapped keyboard focus");
rejectMatch(allUi, /加载更多/,
  "large lists and pickers must not expose load-more copy or actions");
requireMatch(files["pages-config.js"] + files["pages-rules.js"] + files["pages-status.js"],
  /snapshot\.counts\.fields[\s\S]*?snapshot\.counts\[pageCountKey\(route\)\][\s\S]*?snapshot\.counts\.records/,
  "field, rule, condition, effect and record counts must source all totals from the compact snapshot");
requireMatch(files["runtime.js"], /demoPickerSlowSearch[\s\S]*?demoPickerFailSearch[\s\S]*?length:\s*96[\s\S]*?pickerFields/,
  "browser demo must expose deterministic high-cardinality picker delay and failure controls");
requireMatch(files["runtime.js"], /"config-fields":\s*\{[\s\S]*?method:\s*"queryFields"[\s\S]*?pageSize:\s*5/,
  "field management must use the server-owned five-row policy");
requireMatch(files["runtime.js"], /"rule-library":\s*\{[\s\S]*?method:\s*"queryRules"[\s\S]*?pageSize:\s*5/,
  "rule management must use the server-owned five-row policy");
requireMatch(files["runtime.js"], /"condition-library":\s*\{[\s\S]*?method:\s*"queryConditions"[\s\S]*?pageSize:\s*10/,
  "condition management must use the server-owned ten-row policy");
requireMatch(files["runtime.js"], /"effect-library":\s*\{[\s\S]*?method:\s*"queryEffectGroups"[\s\S]*?pageSize:\s*10/,
  "effect management must use the server-owned ten-row policy");
requireMatch(files["runtime.js"], /records:\s*\{[\s\S]*?method:\s*"queryRecords"[\s\S]*?pageSize:\s*10/,
  "records must use the server-owned ten-row policy");
requireMatch(files["pages-config.js"], /management-summary[\s\S]*?当前值[\s\S]*?数值范围[\s\S]*?>查看<[\s\S]*?>修改</,
  "compact field rows must show scope, binding, value/range, status, view and edit actions");
requireMatch(files["pages-config.js"], /open-field-template-import[\s\S]*?open-field-template-export[\s\S]*?field-template-dialog/,
  "field-template import/export must be integrated into the five-row field management flow");
requireMatch(files["pages-config.js"], /基础信息[\s\S]*?作用范围[\s\S]*?字段外观[\s\S]*?详细配置/,
  "field editor sections must share the established section-heading hierarchy");
requireMatch(files["pages-config.js"], /scopeButton\("chat"[\s\S]*?bindCurrentChat[\s\S]*?高级绑定设置/,
  "conversation scope must default to readable current-chat binding with collapsed advanced controls");
requireMatch(files["app.js"], /saveFieldEditor[\s\S]*?addField[\s\S]*?updateField[\s\S]*?loadSnapshot[\s\S]*?config-fields/,
  "field create/update must save through native IPC and reload the authoritative five-row list");
requireMatch(files["app.js"], /saveFieldEditor[\s\S]*?draft\.submitting[\s\S]*?draft\.mutationCommitted[\s\S]*?finishCommittedFieldSave[\s\S]*?reloadFieldListAfterSave/,
  "field save must lock duplicate submissions and separate committed mutations from refresh recovery");
requireMatch(files["app.js"], /previewFieldTemplateImport[\s\S]*?previewRevision[\s\S]*?importFieldTemplate/,
  "field-template import must retain preview revision through preview and atomic commit");
requireMatch(files["pages-config.js"], /all_on[\s\S]*?全部启用[\s\S]*?all_off[\s\S]*?全部停用[\s\S]*?file_suggestion[\s\S]*?采用文件建议/,
  "field-template mapping must expose per-field bulk enable controls");
requireMatch(files["pages-config.js"], /不会按源 ID 静默覆盖/,
  "field-template export must explain that source IDs are only mapping suggestions");
requireMatch(files["app.js"], /refreshFieldTemplatePreview[\s\S]*?loadFieldTemplatePreview\(flow,\s*true\)[\s\S]*?STALE_REVISION/,
  "stale field-template imports must visibly re-preview the same file before retry");
requireMatch(files["app.js"], /retainedImportMappings[\s\S]*?ui\.getEntity[\s\S]*?droppedMappingCount[\s\S]*?mapping_removed/,
  "stale field-template refresh must revalidate local mapping existence and report removals");
requireMatch(files["app.js"], /assignedElsewhere[\s\S]*?validateUniqueImportMappings[\s\S]*?被重复映射/,
  "field-template mappings must prevent and centrally reject duplicate local targets per field");
requireMatch(files["pages-config.js"], /TEMPLATE_PAGE_SIZE\s*=\s*5[\s\S]*?data-template-search[\s\S]*?data-template-count[\s\S]*?显示 [\s\S]*?共 /,
  "every high-cardinality template view must use searchable five-row windows with explicit counts");
requireMatch(files["pages-config.js"], /高级绑定设置[\s\S]*?chatBindingSearch[\s\S]*?data-chat-binding-count[\s\S]*?manualChatBindingId/,
  "conversation advanced binding management must remain bounded searchable and manually addressable");
requireMatch(files["app.js"], /bindCurrentChat[\s\S]*?bindingIds\.push\(chatId\)[\s\S]*?bindingIds\.filter[\s\S]*?id !== chatId/,
  "current-conversation toggle must add or remove only the active chat binding");
requireMatch(files["pages-config.js"], /data-repair-categories/,
  "field-template preview and result must render categorized repair work");
requireMatch(files["app.js"], /规则[\s\S]*?条件[\s\S]*?状态联动[\s\S]*?临时效果[\s\S]*?其他无效引用/,
  "field-template preview and result must expose categorized repair work");
requireMatch(files["runtime.js"], /if\s*\(method === "addField"\)[\s\S]*?if\s*\(method === "updateField"\)/,
  "demo native must implement real field create/update responses");
requireMatch(files["runtime.js"], /if\s*\(method === "exportFieldTemplate"\)[\s\S]*?if\s*\(method === "previewFieldTemplateImport"\)[\s\S]*?if\s*\(method === "importFieldTemplate"\)/,
  "demo native must implement field CRUD and real field-template preview/export/import responses");
requireMatch(files["runtime.js"], /demoImportFieldTemplate[\s\S]*?draftValues[\s\S]*?state\.demoStore\.stateValues[\s\S]*?demoResolveTemplateTargets[\s\S]*?template_value[\s\S]*?keep_existing[\s\S]*?field_initial/,
  "demo field-template import must atomically persist all exact value policies");
requireMatch(index, /id="fieldTemplateImportPicker"[^>]*type="file"[^>]*application\/json/,
  "field-template import needs its own JSON file input");
requireMatch(files["app.js"], /fieldTemplateImportPicker\.value\s*=\s*""/,
  "field-template file input must reset so the same file can be selected again");
requireMatch(styles, /\.field-template-dialog[\s\S]*?max-width:[\s\S]*?overflow-x:\s*hidden/,
  "field-template dialog must remain bounded without horizontal overflow on narrow WebViews");
requireMatch(files["pages-config.js"], /field-template-dialog[^\n]*role="dialog"[^\n]*aria-modal="true"/,
  "field-template flow must expose modal dialog semantics");
requireMatch(files["app.js"], /fieldTemplateFlow[\s\S]*?event\.key === "Escape"[\s\S]*?event\.key === "Tab"[\s\S]*?trapFocus/,
  "field-template dialog must close on Escape and trap keyboard focus");
requireMatch(files["app.js"], /field-template-layer[\s\S]*?restoreFocusDescriptor[\s\S]*?focusFieldTemplateOpener/,
  "field-template overlay clicks must stay inside and closing must restore its logical opener");
requireMatch(styles, /\.template-step[\s\S]*?transition:[\s\S]*?(?:180|200|220)ms/,
  "field-template step changes need a short purposeful transition");
requireMatch(files["runtime.js"], /validateEffectReasonConfig\(effect\.defaultReason,\s*16384\)[\s\S]*?keys\.length !== 3[\s\S]*?reason\.text\.length > textLimit/,
  "complete effect-group response DTOs must fail closed while accepting the legacy persisted reason boundary");
requireMatch(files["runtime.js"], /validateNativeMutationRequest[\s\S]*?createEffectGroup[\s\S]*?updateEffectGroup[\s\S]*?validateEffectReasonConfig\([^\n]*512\)/,
  "effect-group create and update requests must retain the 512-character editor boundary");
requireMatch(files["app.js"] + files["pages-config.js"], /loading:\s*true[\s\S]*?flow\.loading\s*=\s*false[\s\S]*?flow\.loading\s*\?\s*"progress_activity"\s*:\s*"error"/,
  "field-template loading state must stay separate from inline error state");
requireMatch(files["pages-rules.js"], /rule-summary[\s\S]*?触发角色[\s\S]*?触发条件[\s\S]*?触发结果[\s\S]*?>查看<[\s\S]*?>修改</,
  "compact rule rows must show actor, condition and action summaries with view/edit actions");
requireMatch(files["runtime.js"], /validateConditionExpression[\s\S]*?depth\s*>\s*12/,
  "condition DTO validation must recurse with a hard depth bound");
requireMatch(files["runtime.js"], /loadDirectory\(state\.snapshot\s*&&\s*state\.snapshot\.activeContext\.groupId\)/,
  "initial actor directory must use the active group context");
requireMatch(files["runtime.js"], /previousRevision[\s\S]*?state\.entities\.clear\(\)/,
  "snapshot revision changes must invalidate cached full entities");
requireMatch(files["app.js"], /BACKGROUND_MAX_EDGE\s*=\s*1600[\s\S]*?toDataURL\("image\/jpeg",\s*0\.88\)/,
  "custom backgrounds must retain the bounded 1600px JPEG 0.88 pipeline");
requireMatch(files["app.js"], /data-stop-close[\s\S]*?drawer-layer/,
  "drawer content clicks must not bubble into the overlay close action");
requireMatch(files["app.js"], /data-new-entity[\s\S]*?rule-editor[\s\S]*?condition-editor[\s\S]*?effect-editor/,
  "new rule, condition, and effect actions must open their owning child editor");

requireMatch(files["pages-status.js"], /角色状态[\s\S]*?群组状态/,
  "status root must expose character and group modes");
requireMatch(allUi, /group-selector[\s\S]*?data-select-group/,
  "group mode must expose a horizontal group selector");
requireMatch(files["pages-status.js"], /groupMode\s*\?[\s\S]*?renderGroupSelector[\s\S]*?:[\s\S]*?renderActorSelector/,
  "group mode must not render the role row");
requireMatch(files["pages-status.js"], /trendModel\([\s\S]*?minimum:[\s\S]*?maximum:[\s\S]*?thresholds:[\s\S]*?colors:/,
  "trend canvas must receive field min/max and stage thresholds/colors");
requireMatch(files["components.js"], /function\s+trendY\([\s\S]*?value\s*-\s*minimum[\s\S]*?maximum\s*-\s*minimum/,
  "trend Y positions must use the exact field range");
rejectMatch(files["components.js"], /Math\.(?:min|max)\s*\(\s*\.\.\.?(?:samples|values|points)/,
  "trend rendering must not autoscale from recent samples");
requireMatch(styles, /\.field-detail-stack\s*\{[\s\S]*?display:\s*grid;[\s\S]*?gap:\s*12px;/,
  "field detail cards must share one 12px stack gap");
rejectMatch(styles, /\.field-detail-stack[\s\S]{0,1000}margin-(?:top|bottom):\s*-/,
  "field detail stack may not collapse card seams with negative margins");
rejectMatch(styles, /\.stage-marker\.edge-(?:start|end)[^{]*\{[^}]*transform:/,
  "stage collision handling must not move the shared normalized marker anchor");
requireMatch(textScaleFixture, /Number\(value\)\s*\*\s*1\.3/,
  "browser audit fixture must exercise a real 130% text-only scale");
requireMatch(malformedNativeFixture, /window\.NativeMvu[\s\S]*?record_bad[\s\S]*?坏记录缺少 actorName/,
  "browser audit needs a malformed NativeMvu recovery fixture");
requireMatch(files["app.js"], /trim\(\)\.length\s*===\s*0[\s\S]*?Number\.NaN/,
  "range validation must reject whitespace before numeric conversion");

const expectedOrder = moduleNames.map((name) => `<script src="${name}"></script>`);
let previousIndex = -1;
for (const tag of expectedOrder) {
  const found = index.indexOf(tag);
  if (found < 0) violations.push(`index missing ${tag}`);
  if (found >= 0 && found <= previousIndex) violations.push("UI module script order is invalid");
  previousIndex = Math.max(previousIndex, found);
}
requireMatch(build, /runtime\.js[\s\S]*?components\.js[\s\S]*?pages-status\.js[\s\S]*?pages-config\.js[\s\S]*?pages-rules\.js[\s\S]*?pages-advanced\.js[\s\S]*?app\.js/,
  "build must inline UI modules in dependency order");
requireMatch(build, /Buffer\.byteLength\(out,\s*"utf8"\)/,
  "build output must report actual UTF-8 bytes");

if (violations.length > 0) {
  assert.fail(`MVU v3 UI audit failed (${violations.length}):\n- ${violations.join("\n- ")}`);
}

console.log(JSON.stringify({ modules: moduleNames.length, roots: 4, result: "PASS" }, null, 2));
