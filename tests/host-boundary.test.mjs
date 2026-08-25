import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  MVU_IPC,
  MVU_IPC_TARGET_CONTEXT_KEY,
  MVU_TOOLPKG_ID,
  mvuIpcClient,
} from "../dist/shared/ipc.js";

const ROOT = new URL("../", import.meta.url);
test("root manifest avoids private host capability keys", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(Object.hasOwn(manifest, "host_requirements"), false);
});

test("the package audit enforces the standard Operit manifest contract", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(packageJson.scripts.audit, /audit-manifest\.mjs/);
  const result = spawnSync(process.execPath, ["scripts/audit-manifest.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /standard Operit manifest contract: PASS/);
});

test("every UI IPC operation targets the package's exact persistent main runtime", async (t) => {
  const previous = globalThis.ToolPkg;
  t.after(() => {
    if (previous === undefined) delete globalThis.ToolPkg;
    else globalThis.ToolPkg = previous;
  });
  const calls = [];
  globalThis.ToolPkg = {
    ipc: {
      async call(...args) {
        calls.push(args);
        return {};
      },
    },
  };

  for (const [operation, invoke] of Object.entries(mvuIpcClient)) {
    await invoke({ operation });
  }

  assert.equal(MVU_TOOLPKG_ID, "com.lcilling.operit_mvu");
  assert.equal(MVU_IPC_TARGET_CONTEXT_KEY, "toolpkg_main:com.lcilling.operit_mvu");
  assert.deepEqual(calls.map(([channel]) => channel).sort(), Object.values(MVU_IPC).sort());
  assert.equal(calls.every(([, , target]) => JSON.stringify(target) === JSON.stringify({
      targetRuntime: "main",
      targetContextKey: "toolpkg_main:com.lcilling.operit_mvu",
    })), true);
});

test("fresh durable invalidations return before main runtime or store access", async (t) => {
  const previousIcons = globalThis.Icons;
  const previousToolPkg = globalThis.ToolPkg;
  t.after(() => {
    if (previousIcons === undefined) delete globalThis.Icons;
    else globalThis.Icons = previousIcons;
    if (previousToolPkg === undefined) delete globalThis.ToolPkg;
    else globalThis.ToolPkg = previousToolPkg;
  });
  const accesses = [];
  globalThis.Icons = { Favorite: "favorite" };
  globalThis.ToolPkg = new Proxy({}, {
    get(_target, property) {
      accesses.push(String(property));
      throw new Error(`UNEXPECTED_TOOLPKG_ACCESS:${String(property)}`);
    },
  });
  const main = await import(`../dist/main.js?invalidation-boundary=${Date.now()}`);

  for (const eventName of ["chat_deleted", "chat_history_reset"]) {
    assert.equal(await main.onChatMessagePersisted({
      eventName,
      eventPayload: { chatId: "chat_main" },
    }), null);
  }
  assert.deepEqual(accesses, []);
});
