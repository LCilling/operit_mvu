/**
 * build-web.mjs — 把 MVU 前端静态资源内联成单文件 app.html
 *
 * 读取 static/app_ui 的模块化 UI，按运行时依赖顺序内联样式、脚本、角色素材与
 * Material Symbols 字体，输出可由 ToolPkg.readResource() 独立释放的 app.html。
 *
 * 用法：node examples/operit_mvu/scripts/build-web.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const src = path.join(rootDir, "static", "app_ui");
const dist = path.join(rootDir, "dist");
const outFile = path.join(dist, "app.html");
const scriptOrder = [
  "runtime.js",
  "components.js",
  "pages-status.js",
  "pages-config.js",
  "pages-rules.js",
  "pages-advanced.js",
  "app.js",
];

function read(p) { return fs.readFileSync(p, "utf8"); }
function write(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, "utf8"); }

function dataUri(relativePath, mimeType) {
  const data = fs.readFileSync(path.join(src, ...relativePath.split("/")));
  return `data:${mimeType};base64,${data.toString("base64")}`;
}

function inlineAssetReferences(source) {
  const assets = [
    ["./assets/character-state-theme.png", "assets/character-state-theme.png", "image/png"],
    ["./assets/avatars/ayane.png", "assets/avatars/ayane.png", "image/png"],
    ["./assets/avatars/ailin.png", "assets/avatars/ailin.png", "image/png"],
    ["./assets/avatars/noah.png", "assets/avatars/noah.png", "image/png"],
    ["./assets/avatars/kalian.png", "assets/avatars/kalian.png", "image/png"],
    ["./assets/avatars/xiaoye.png", "assets/avatars/xiaoye.png", "image/png"],
    ["./assets/fonts/material-symbols-rounded.woff2", "assets/fonts/material-symbols-rounded.woff2", "font/woff2"],
  ];
  let output = source;
  for (const [reference, relativePath, mimeType] of assets) {
    output = output.replaceAll(reference, dataUri(relativePath, mimeType));
  }
  return output;
}

function main() {
  const html = read(path.join(src, "index.html"));
  const css = inlineAssetReferences(read(path.join(src, "styles.css")));
  // 内联 <link rel="stylesheet" href="styles.css">
  let out = html.replace(
    /<link rel="stylesheet" href="styles\.css" \/>/,
    () => `<style>\n${css}\n</style>`
  );
  for (const scriptName of scriptOrder) {
    const js = inlineAssetReferences(read(path.join(src, scriptName)));
    const escaped = scriptName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(
      new RegExp(`<script src="${escaped}"><\\/script>`),
      () => `<script data-source="${scriptName}">\n${js}\n</script>`
    );
  }
  if (out.includes("./assets/")) {
    throw new Error("app.html still contains an external asset reference");
  }
  if (/<(?:script|link)\b[^>]+(?:src|href)=/.test(out)) {
    throw new Error("app.html still contains an external script or stylesheet reference");
  }
  write(outFile, out);
  console.log(`Wrote ${path.relative(rootDir, outFile).replace(/\\/g, "/")} (${out.length} bytes)`);
}

main();
