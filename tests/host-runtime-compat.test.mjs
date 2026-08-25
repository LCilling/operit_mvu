import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");

async function loadCompatibilityModule() {
  const file = path.join(root, "src", "host-compat.ts");
  const source = await readFile(file, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function (exports, module) { ${compiled}\n})(exports, module);`, {
    module,
    exports: module.exports,
    Error,
    Object,
  });
  return module.exports;
}

function compatibleHost() {
  return {
    toolPkg: {
      getConfigDir() {},
      readResource() {},
      ipc: { on() {}, call() {} },
      chatContext: { snapshot() {} },
      systemModel: { probe() {}, complete() {} },
    },
    tools: { Files: { replaceAtomically() {} } },
  };
}

test("documented Operit host surface passes the startup compatibility check", async () => {
  const { assertOperitHostCompatibility } = await loadCompatibilityModule();
  const host = compatibleHost();
  assert.doesNotThrow(() => assertOperitHostCompatibility(host.toolPkg, host.tools));
});

test("each required official or documented extension produces one readable incompatibility error", async () => {
  const { assertOperitHostCompatibility } = await loadCompatibilityModule();
  const cases = [
    ["ToolPkg.getConfigDir", (host) => { delete host.toolPkg.getConfigDir; }],
    ["ToolPkg.readResource", (host) => { delete host.toolPkg.readResource; }],
    ["ToolPkg.ipc.on", (host) => { delete host.toolPkg.ipc.on; }],
    ["ToolPkg.ipc.call", (host) => { delete host.toolPkg.ipc.call; }],
    ["ToolPkg.chatContext.snapshot", (host) => { delete host.toolPkg.chatContext.snapshot; }],
    ["ToolPkg.systemModel.probe", (host) => { delete host.toolPkg.systemModel.probe; }],
    ["ToolPkg.systemModel.complete", (host) => { delete host.toolPkg.systemModel.complete; }],
    ["Tools.Files.replaceAtomically", (host) => { delete host.tools.Files.replaceAtomically; }],
  ];

  for (const [capability, remove] of cases) {
    const host = compatibleHost();
    remove(host);
    assert.throws(
      () => assertOperitHostCompatibility(host.toolPkg, host.tools),
      (error) => error instanceof Error &&
        error.message.startsWith("MVU_HOST_INCOMPATIBLE:") &&
        error.message.includes(capability) &&
        error.message.includes("请更新 OperitAI"),
      capability,
    );
  }
});

test("startup compatibility reports all missing extensions in a bounded deterministic order", async () => {
  const { assertOperitHostCompatibility } = await loadCompatibilityModule();
  assert.throws(
    () => assertOperitHostCompatibility({}, {}),
    (error) => error instanceof Error && error.message ===
      "MVU_HOST_INCOMPATIBLE:当前 OperitAI 缺少 MVU 必需接口：ToolPkg.getConfigDir、ToolPkg.readResource、ToolPkg.ipc.on、ToolPkg.ipc.call、ToolPkg.chatContext.snapshot、ToolPkg.systemModel.probe、ToolPkg.systemModel.complete、Tools.Files.replaceAtomically。请更新 OperitAI 后重新启用插件。",
  );
});

test("registerToolPkg checks compatibility before installing IPC or publishing routes", async () => {
  const source = await readFile(path.join(root, "src", "main.ts"), "utf8");
  assert.match(source, /import\s*\{\s*assertOperitHostCompatibility\s*\}\s*from\s*["']\.\/host-compat["']/);
  const body = source.match(/export function registerToolPkg\(\): boolean \{([\s\S]*?)\n\}/)?.[1] ?? "";
  const guard = body.indexOf("assertOperitHostCompatibility(ToolPkg, Tools)");
  const ipc = body.indexOf("ensureIpcInstalled()");
  const route = body.indexOf("ToolPkg.registerUiRoute(");
  assert.ok(guard >= 0 && guard < ipc && guard < route, "host guard must run before side effects");
});
