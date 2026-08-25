import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, "..");
const manifest = JSON.parse(await readFile(path.join(rootDirectory, "manifest.json"), "utf8"));
const packageJson = JSON.parse(await readFile(path.join(rootDirectory, "package.json"), "utf8"));

const standardProjectKeys = [
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
];

assert.equal(manifest.schema_version, 1, "manifest schema_version must remain 1");
assert.equal(manifest.version, packageJson.version, "manifest and package versions must match");
assert.deepEqual(
  Object.keys(manifest).sort(),
  standardProjectKeys,
  "manifest must use only Operit's standard keys for this project",
);
assert.equal(manifest.toolpkg_id, "com.lcilling.operit_mvu");
assert.equal(manifest.main, "dist/main.js");
assert.equal(typeof manifest.enabled_by_default, "boolean");
assert.ok(Array.isArray(manifest.subpackages));
assert.ok(Array.isArray(manifest.resources));
assert.ok(Array.isArray(manifest.workflow_templates));
assert.ok(Array.isArray(manifest.workspace_templates));
assert.deepEqual(manifest.resources, [
  { key: "app_html", path: "app.html", mime: "text/html" },
]);
for (const key of ["display_name", "description"]) {
  assert.equal(typeof manifest[key]?.zh, "string", `${key}.zh must be present`);
  assert.equal(typeof manifest[key]?.en, "string", `${key}.en must be present`);
  assert.equal(typeof manifest[key]?.default, "string", `${key}.default must be present`);
}

console.log(JSON.stringify({
  keys: standardProjectKeys.length,
  result: "standard Operit manifest contract: PASS",
}, null, 2));
