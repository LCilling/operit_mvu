import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, "..");
const manifest = JSON.parse(await readFile(path.join(rootDirectory, "manifest.json"), "utf8"));
const packageJson = JSON.parse(await readFile(path.join(rootDirectory, "package.json"), "utf8"));

const requiredCapabilities = [
  "chat.actor_identity",
  "chat.history.immutable",
  "chat.invalidation.durable",
  "files.atomic_replace",
  "ipc.owner_isolation",
  "model.system.structured",
  "runtime.bounded_async",
];

assert.equal(manifest.schema_version, 1, "manifest schema_version must remain 1");
assert.equal(manifest.version, packageJson.version, "manifest and package versions must match");
assert.deepEqual(manifest.host_requirements, {
  api: "operit-toolpkg-host",
  api_version: 3,
  capabilities: requiredCapabilities,
});
assert.deepEqual(
  manifest.host_requirements.capabilities,
  [...new Set(manifest.host_requirements.capabilities)].sort(),
  "host capabilities must be unique and lexically sorted",
);

console.log(JSON.stringify({
  api: manifest.host_requirements.api,
  apiVersion: manifest.host_requirements.api_version,
  capabilities: manifest.host_requirements.capabilities.length,
  result: "manifest host contract: PASS",
}, null, 2));
