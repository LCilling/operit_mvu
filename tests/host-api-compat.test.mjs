import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const rootDirectory = path.resolve(import.meta.dirname, "..");

async function read(relativePath) {
  return readFile(path.join(rootDirectory, relativePath), "utf8");
}

async function loadWebContainerHarness() {
  const source = await read("src/ui/web_container/index.ui.ts");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;

  const evaluatedScripts = [];
  const controller = {
    addJavascriptInterface(_name, methods) {
      this.methods = methods;
    },
    evaluateJavascript(script) {
      evaluatedScripts.push(script);
      return Promise.resolve(null);
    },
  };
  const snapshotCalls = [];
  const ipcModule = {
    MVU_REQUEST_PARSERS: {
      snapshot(value) {
        return value;
      },
    },
    mvuIpcClient: {
      async snapshot(request) {
        snapshotCalls.push(request);
        return { ok: true };
      },
    },
  };
  const module = { exports: {} };
  const context = {
    console: { error() {}, log() {}, warn() {} },
    module,
    exports: module.exports,
    require(specifier) {
      if (specifier === "../../shared/ipc.js") return ipcModule;
      throw new Error(`Unexpected require: ${specifier}`);
    },
    ToolPkg: {},
  };
  vm.runInNewContext(`(function (exports, require, module) { ${compiled}\n})(exports, require, module);`, context);

  const refs = new Map();
  const screenContext = {
    createWebViewController() {
      return controller;
    },
    useRef(key, initialValue) {
      if (!refs.has(key)) refs.set(key, { current: initialValue });
      return refs.get(key);
    },
    useState(_key, initialValue) {
      return [initialValue, () => {}];
    },
    reportError() {},
    UI: {
      Box(properties, child) {
        return { properties, child };
      },
      Text(properties) {
        return properties;
      },
      WebView(properties) {
        return properties;
      },
    },
  };
  module.exports.default(screenContext);
  return { call: controller.methods.call, evaluatedScripts, snapshotCalls };
}

async function flushAsyncCallbacks() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("manifest uses only the documented standard project keys", async () => {
  const manifest = JSON.parse(await read("manifest.json"));
  assert.deepEqual(Object.keys(manifest).sort(), [
    "description",
    "display_name",
    "enabled_by_default",
    "main",
    "resources",
    "schema_version",
    "subpackages",
    "toolpkg_id",
    "version",
    "workflow_templates",
    "workspace_templates",
  ]);
  assert.equal("host_requirements" in manifest, false);
});

test("Compose WebView callback has the official variadic type", async () => {
  const declaration = await read("types/compose-dsl.d.ts");
  assert.match(
    declaration,
    /ComposeWebViewJavascriptInterfaceMethod\s*=\s*\(\s*\.\.\.args:\s*unknown\[\]\s*\)/,
  );
});

test("WebView bridge accepts both array-payload and variadic host callbacks", async () => {
  const arrayHarness = await loadWebContainerHarness();
  arrayHarness.call(["snapshot", "{\"page\":\"status\"}", 7]);
  await flushAsyncCallbacks();
  assert.equal(JSON.stringify(arrayHarness.snapshotCalls), '[{"page":"status"}]');
  assert.match(arrayHarness.evaluatedScripts.at(-1), /__mvuResolve\(7,/);

  const variadicHarness = await loadWebContainerHarness();
  variadicHarness.call("snapshot", "{\"page\":\"rules\"}", 8);
  await flushAsyncCallbacks();
  assert.equal(JSON.stringify(variadicHarness.snapshotCalls), '[{"page":"rules"}]');
  assert.match(variadicHarness.evaluatedScripts.at(-1), /__mvuResolve\(8,/);
});

test("WebView bridge extracts rejection callback IDs from both callback shapes", async () => {
  const arrayHarness = await loadWebContainerHarness();
  arrayHarness.call(["snapshot", "{", 17]);
  await flushAsyncCallbacks();
  assert.match(arrayHarness.evaluatedScripts.at(-1), /__mvuReject\(17,/);

  const variadicHarness = await loadWebContainerHarness();
  variadicHarness.call("snapshot", "{", 18);
  await flushAsyncCallbacks();
  assert.match(variadicHarness.evaluatedScripts.at(-1), /__mvuReject\(18,/);
});

test("plugin host overlay does not expose localModels", async () => {
  const declaration = await read("types/toolpkg.d.ts");
  const source = ts.createSourceFile("toolpkg.d.ts", declaration, ts.ScriptTarget.Latest, true);
  const forbiddenDeclarations = [];
  function visit(node) {
    if (
      (ts.isInterfaceDeclaration(node) || ts.isPropertySignature(node))
      && node.name?.getText(source) === "LocalModelApi"
    ) {
      forbiddenDeclarations.push(node.name.getText(source));
    }
    if (ts.isPropertySignature(node) && node.name?.getText(source) === "localModels") {
      forbiddenDeclarations.push(node.name.getText(source));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.deepEqual(forbiddenDeclarations, []);
  assert.match(declaration, /chatContext:\s*ChatContextApi/);
  assert.match(declaration, /systemModel:\s*SystemModelApi/);
});

test("AST host audit allows extension 8 and rejects undocumented APIs", async (t) => {
  const { auditHostApiCompatibility } = await import("../scripts/audit-host-api-compat.mjs");
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "operit-mvu-host-audit-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  await mkdir(path.join(fixtureRoot, "src"), { recursive: true });
  await writeFile(
    path.join(fixtureRoot, "manifest.json"),
    JSON.stringify({ schema_version: 1, toolpkg_id: "fixture", version: "1", main: "dist/main.js" }),
  );
  await writeFile(
    path.join(fixtureRoot, "src", "allowed.ts"),
    [
      "Tools.Files.replaceAtomically(source, destination);",
      "ToolPkg.chatContext.snapshot();",
      "ToolPkg.systemModel.probe();",
      "const ignored = 'ToolPkg.localModels and host_requirements';",
    ].join("\n"),
  );
  let result = await auditHostApiCompatibility({ rootDirectory: fixtureRoot, includeDist: false });
  assert.deepEqual(result.violations, []);
  assert.ok(result.dependencies.includes("Tools.Files.replaceAtomically"));

  await writeFile(
    path.join(fixtureRoot, "src", "forbidden.ts"),
    [
      "ToolPkg.localModels.list();",
      "ToolPkg.systemModel.prepareDispatch({});",
      "ToolPkg.chatContext.history();",
    ].join("\n"),
  );
  await writeFile(
    path.join(fixtureRoot, "manifest.json"),
    JSON.stringify({
      schema_version: 1,
      toolpkg_id: "fixture",
      version: "1",
      main: "dist/main.js",
      host_requirements: {},
    }),
  );
  result = await auditHostApiCompatibility({ rootDirectory: fixtureRoot, includeDist: false });
  assert.ok(result.violations.some((item) => item.symbol === "ToolPkg.localModels"));
  assert.ok(result.violations.some((item) => item.symbol === "ToolPkg.systemModel.prepareDispatch"));
  assert.ok(result.violations.some((item) => item.symbol === "ToolPkg.chatContext.history"));
  assert.ok(result.violations.some((item) => item.symbol === "manifest.host_requirements"));
});

test("repository production host surface matches official APIs plus extensions 1-8", async () => {
  const { auditHostApiCompatibility } = await import("../scripts/audit-host-api-compat.mjs");
  const result = await auditHostApiCompatibility({ rootDirectory, includeDist: false });
  assert.deepEqual(result.violations, []);
  assert.equal(result.baseline, "Operit official public surface + OPERITAI_CHANGES #1-#8");
});
