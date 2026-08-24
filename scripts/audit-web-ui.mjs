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
assert.match(appSource, /if \(appState\.screen === screenId\)/,
  "Repeated navigation to the current screen must not add history entries");
assert.match(appSource, /const actorChanged =[\s\S]*?if \(actorChanged\) \{/,
  "Role changes must invalidate field drafts from the previous actor context");
assert.match(appSource, /previousScrollTop[\s\S]*?nextScroll\.scrollTop/,
  "In-page rerenders must preserve long-form scroll position");
assert.match(appSource, /aria-current="page"/, "Bottom navigation must expose the current page");
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
