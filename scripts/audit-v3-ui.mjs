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
