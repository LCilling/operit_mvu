const REQUIRED_OPERIT_HOST_FUNCTIONS = [
  ["ToolPkg.getConfigDir", ["getConfigDir"]],
  ["ToolPkg.readResource", ["readResource"]],
  ["ToolPkg.ipc.on", ["ipc", "on"]],
  ["ToolPkg.ipc.call", ["ipc", "call"]],
  ["ToolPkg.chatContext.snapshot", ["chatContext", "snapshot"]],
  ["ToolPkg.systemModel.probe", ["systemModel", "probe"]],
  ["ToolPkg.systemModel.complete", ["systemModel", "complete"]],
] as const;

/**
 * Fails before the plugin installs IPC or publishes a route when the current
 * Operit host cannot satisfy the official API plus documented MVU extensions.
 */
export function assertOperitHostCompatibility(
  toolPkg: unknown,
  tools: unknown,
): void {
  const missing: string[] = [];
  for (const [label, path] of REQUIRED_OPERIT_HOST_FUNCTIONS) {
    if (!hasFunction(toolPkg, path)) missing.push(label);
  }
  if (!hasFunction(tools, ["Files", "replaceAtomically"])) {
    missing.push("Tools.Files.replaceAtomically");
  }
  if (missing.length === 0) return;
  throw new Error(
    `MVU_HOST_INCOMPATIBLE:当前 OperitAI 缺少 MVU 必需接口：${missing.join("、")}。请更新 OperitAI 后重新启用插件。`,
  );
}

function hasFunction(root: unknown, path: readonly string[]): boolean {
  let current = root;
  for (const segment of path) {
    if ((typeof current !== "object" && typeof current !== "function") || current === null) {
      return false;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "function";
}
