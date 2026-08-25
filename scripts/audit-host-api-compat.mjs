import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const HOST_API_BASELINE = "Operit official public surface + OPERITAI_CHANGES #1-#8";

const ALLOWED_HOST_SYMBOLS = new Set([
  "Icons.Favorite",
  "ToolPkg.ChatContextGroupSnapshot",
  "ToolPkg.ChatContextCharacterSnapshot",
  "ToolPkg.ChatContextMemberSnapshot",
  "ToolPkg.ChatContextSnapshot",
  "ToolPkg.ChatMessageEventPayload",
  "ToolPkg.ChatMessageHookEvent",
  "ToolPkg.IpcCallOptions",
  "ToolPkg.PromptHookObjectResult",
  "ToolPkg.SystemModelApi",
  "ToolPkg.SystemModelCompletionRequest",
  "ToolPkg.SystemModelCompletionResult",
  "ToolPkg.SystemModelJsonSchema",
  "ToolPkg.SystemModelProbeResult",
  "ToolPkg.SystemPromptComposeHookEvent",
  "ToolPkg.chatContext",
  "ToolPkg.chatContext.snapshot",
  "ToolPkg.getConfigDir",
  "ToolPkg.ipc",
  "ToolPkg.ipc.call",
  "ToolPkg.ipc.off",
  "ToolPkg.ipc.on",
  "ToolPkg.readResource",
  "ToolPkg.registerAppLifecycleHook",
  "ToolPkg.registerChatMessageHook",
  "ToolPkg.registerNavigationEntry",
  "ToolPkg.registerSystemPromptComposeHook",
  "ToolPkg.registerUiRoute",
  "ToolPkg.systemModel",
  "ToolPkg.systemModel.complete",
  "ToolPkg.systemModel.probe",
  "Tools.Files.deleteFile",
  "Tools.Files.exists",
  "Tools.Files.mkdir",
  "Tools.Files.move",
  "Tools.Files.read",
  "Tools.Files.readPart",
  "Tools.Files.replaceAtomically",
  "Tools.Files.write",
]);

const FORBIDDEN_DECLARATION_NAMES = new Set([
  "dispatchToken",
  "localModels",
  "maxOutputChars",
  "prepareDispatch",
  "structuredOutput",
]);

const SOURCE_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs"]);

function normalPath(value) {
  return value.split(path.sep).join("/");
}

function locationFor(sourceFile, node, rootDirectory) {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    file: normalPath(path.relative(rootDirectory, sourceFile.fileName)),
    line: start.line + 1,
    column: start.character + 1,
  };
}

function memberName(node, sourceFile) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return node.getText(sourceFile);
}

function expressionChain(node, sourceFile) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    const prefix = expressionChain(node.expression, sourceFile);
    return prefix === null ? null : `${prefix}.${node.name.text}`;
  }
  if (ts.isElementAccessExpression(node)) {
    const prefix = expressionChain(node.expression, sourceFile);
    if (prefix === null) return null;
    if (ts.isStringLiteral(node.argumentExpression)) {
      return `${prefix}.${node.argumentExpression.text}`;
    }
    return `${prefix}.[dynamic]`;
  }
  return null;
}

function qualifiedNameChain(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (!ts.isQualifiedName(node)) return null;
  const prefix = qualifiedNameChain(node.left);
  return prefix === null ? null : `${prefix}.${node.right.text}`;
}

function isNestedMember(node) {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent))
    && parent.expression === node
  );
}

function isNestedQualifiedName(node) {
  return ts.isQualifiedName(node.parent) && node.parent.left === node;
}

function isHostRooted(symbol) {
  return symbol === "ToolPkg"
    || symbol.startsWith("ToolPkg.")
    || symbol === "Tools.Files"
    || symbol.startsWith("Tools.Files.")
    || symbol === "Icons"
    || symbol.startsWith("Icons.");
}

function canonicalForbiddenSymbol(symbol) {
  for (const forbidden of [
    "ToolPkg.localModels",
    "ToolPkg.systemModel.prepareDispatch",
    "ToolPkg.chatContext.history",
    "ToolPkg.chatContext.exists",
  ]) {
    if (symbol === forbidden || symbol.startsWith(`${forbidden}.`)) return forbidden;
  }
  return null;
}

function pushViolation(violations, sourceFile, node, rootDirectory, symbol, message) {
  violations.push({
    ...locationFor(sourceFile, node, rootDirectory),
    symbol,
    message,
  });
}

function auditSourceFile(filePath, sourceText, rootDirectory) {
  const extension = path.extname(filePath).toLowerCase();
  const scriptKind = extension === ".ts" || filePath.endsWith(".d.ts")
    ? ts.ScriptKind.TS
    : ts.ScriptKind.JS;
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const violations = [];
  const dependencies = new Set();

  function auditSymbol(node, symbol) {
    if (!isHostRooted(symbol) || symbol === "ToolPkg" || symbol === "Tools.Files" || symbol === "Icons") {
      return;
    }
    const forbiddenSymbol = canonicalForbiddenSymbol(symbol);
    const auditedSymbol = forbiddenSymbol ?? symbol;
    dependencies.add(auditedSymbol);
    if (forbiddenSymbol !== null || !ALLOWED_HOST_SYMBOLS.has(symbol)) {
      pushViolation(
        violations,
        sourceFile,
        node,
        rootDirectory,
        auditedSymbol,
        `Host API is outside ${HOST_API_BASELINE}`,
      );
    }
  }

  function visit(node) {
    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      && !isNestedMember(node)
    ) {
      const symbol = expressionChain(node, sourceFile);
      if (symbol !== null) auditSymbol(node, symbol);
    }
    if (
      ts.isQualifiedName(node)
      && !isNestedQualifiedName(node)
      && normalPath(filePath).endsWith("/types/toolpkg.d.ts") === false
    ) {
      const symbol = qualifiedNameChain(node);
      if (symbol !== null) auditSymbol(node, symbol);
    }

    if (
      (ts.isPropertySignature(node)
        || ts.isMethodSignature(node)
        || ts.isPropertyDeclaration(node)
        || ts.isMethodDeclaration(node)
        || ts.isPropertyAssignment(node)
        || ts.isShorthandPropertyAssignment(node))
      && node.name !== undefined
    ) {
      const name = memberName(node.name, sourceFile);
      if (FORBIDDEN_DECLARATION_NAMES.has(name)) {
        pushViolation(
          violations,
          sourceFile,
          node.name,
          rootDirectory,
          name,
          "Forbidden host overlay member is declared",
        );
      }
    }
    if (
      (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))
      && /^LocalModel/.test(node.name.text)
    ) {
      pushViolation(
        violations,
        sourceFile,
        node.name,
        rootDirectory,
        node.name.text,
        "ToolPkg.localModels overlay types are forbidden",
      );
    }
    if (ts.isInterfaceDeclaration(node) && node.name.text === "ChatContextApi") {
      for (const member of node.members) {
        if (member.name === undefined) continue;
        const name = memberName(member.name, sourceFile);
        if (name === "history" || name === "exists") {
          pushViolation(
            violations,
            sourceFile,
            member.name,
            rootDirectory,
            `ToolPkg.chatContext.${name}`,
            "Undocumented chatContext method is declared",
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { violations, dependencies };
}

async function collectSourceFiles(directory) {
  const output = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return output;
    throw error;
  }
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...await collectSourceFiles(absolutePath));
    } else if (entry.isFile() && (SOURCE_EXTENSIONS.has(path.extname(entry.name)) || entry.name.endsWith(".d.ts"))) {
      output.push(absolutePath);
    }
  }
  return output;
}

async function auditManifest(rootDirectory) {
  const manifestPath = path.join(rootDirectory, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  if (!("host_requirements" in manifest)) return [];
  return [{
    file: "manifest.json",
    line: 1,
    column: 1,
    symbol: "manifest.host_requirements",
    message: "Private host capability manifests are not part of the Operit public manifest contract",
  }];
}

export async function auditHostApiCompatibility({ rootDirectory, includeDist = true }) {
  const resolvedRoot = path.resolve(rootDirectory);
  const scanRoots = ["src", "static", "types"].map((directory) => path.join(resolvedRoot, directory));
  if (includeDist) scanRoots.push(path.join(resolvedRoot, "dist", "main.js"));

  const files = [];
  for (const scanRoot of scanRoots) {
    if (path.extname(scanRoot)) {
      try {
        await readFile(scanRoot, "utf8");
        files.push(scanRoot);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    } else {
      files.push(...await collectSourceFiles(scanRoot));
    }
  }

  const violations = await auditManifest(resolvedRoot);
  const dependencies = new Set();
  for (const filePath of files) {
    const result = auditSourceFile(filePath, await readFile(filePath, "utf8"), resolvedRoot);
    violations.push(...result.violations);
    for (const dependency of result.dependencies) dependencies.add(dependency);
  }
  violations.sort((left, right) =>
    left.file.localeCompare(right.file)
    || left.line - right.line
    || left.column - right.column
    || left.symbol.localeCompare(right.symbol));

  return {
    baseline: HOST_API_BASELINE,
    filesScanned: files.length + 1,
    distScanned: files.some((filePath) => normalPath(filePath).endsWith("/dist/main.js")),
    dependencies: [...dependencies].sort(),
    violations,
  };
}

async function main() {
  const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = await auditHostApiCompatibility({ rootDirectory, includeDist: true });
  console.log(JSON.stringify(result, null, 2));
  if (result.violations.length > 0) process.exitCode = 1;
}

const invokedPath = process.argv[1] === undefined ? null : path.resolve(process.argv[1]);
if (invokedPath !== null && invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
