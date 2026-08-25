import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedVersion = "3.0.0";
const artifactName = `operit_mvu-${expectedVersion}.toolpkg`;

async function text(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

const [packageText, manifestText, readme, api, port, hostRequirements, hostChanges] =
  await Promise.all([
    text("package.json"),
    text("manifest.json"),
    text("README.md"),
    text("docs/MVU_API.md"),
    text("docs/MVU_PORT.md"),
    text("docs/HOST_INTERFACE_REQUIREMENTS.md"),
    text("docs/OPERITAI_CHANGES.md"),
  ]);

const packageJson = JSON.parse(packageText);
const manifest = JSON.parse(manifestText);
assert.equal(packageJson.version, expectedVersion, "package.json version must be 3.0.0");
assert.equal(manifest.version, expectedVersion, "manifest.json version must be 3.0.0");
assert.equal(manifest.main, "dist/main.js", "manifest main must remain dist/main.js");
assert.deepEqual(manifest.resources, [{ key: "app_html", path: "app.html", mime: "text/html" }]);
assert.equal(Object.hasOwn(manifest, "host_requirements"), false,
  "release manifest may contain only the official Operit manifest contract");

for (const [name, source] of Object.entries({
  "README.md": readme,
  "docs/MVU_API.md": api,
  "docs/MVU_PORT.md": port,
  "docs/HOST_INTERFACE_REQUIREMENTS.md": hostRequirements,
  "docs/OPERITAI_CHANGES.md": hostChanges,
})) {
  assert.match(source, /3\.0\.0|formatVersion:\s*3|formatVersion`?\s*3|v3/i,
    `${name} must describe the v3 release or data contract`);
  assert.doesNotMatch(source, /operit_mvu-2\.0\.1\.toolpkg|当前 v2\.0\.1/,
    `${name} contains a stale 2.0.1 release reference`);
}

assert.match(readme, /条件库/, "README must document the condition library");
assert.match(readme, /触发角色|角色绑定/, "README must document actor-bound rules");
assert.match(readme, /效果组/, "README must document reusable effect groups");
assert.match(readme, /每页\s*5|5\s*条/, "README must document bounded five-row management pages");
assert.match(readme, /搜索/, "README must document searchable large selectors");
assert.match(readme, /v2[\s\S]{0,80}迁移|迁移[\s\S]{0,80}v2/i,
  "README must document v2 migration");
assert.match(readme, /完整备份|全量备份/, "README must document full backup and recovery");

const artifactPath = path.join(root, "release", artifactName);
const archive = await readFile(artifactPath);
const entries = readCentralDirectoryEntries(archive);
assert.ok(entries.length > 0, "release archive must contain entries");
assert.equal(new Set(entries).size, entries.length, "release archive cannot contain duplicate paths");
assert.equal(entries.filter((entry) => entry === "app.html").length, 1,
  "release archive must contain exactly one root app.html");
assert.equal(entries.includes("dist/app.html"), false, "dist/app.html must not duplicate root app.html");
assert.ok(entries.includes("manifest.json"), "release archive is missing manifest.json");
assert.ok(entries.includes("dist/main.js"), "release archive is missing dist/main.js");
assert.equal(entries.some((entry) => /(^|\/)(?:tests?|qa|artifacts?|\.superpowers)(\/|$)/i.test(entry)), false,
  "release archive contains tests, QA evidence, artifacts, or internal reports");
assert.equal(entries.some((entry) => /(?:^|\/)(?:node_modules|\.git)(?:\/|$)/.test(entry)), false,
  "release archive contains development dependencies or Git metadata");

console.log(JSON.stringify({
  result: "v3 package audit: PASS",
  version: expectedVersion,
  artifact: artifactName,
  entries: entries.length,
}, null, 2));

function readCentralDirectoryEntries(buffer) {
  const endSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const minimumEndOffset = Math.max(0, buffer.length - 65_557);
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= minimumEndOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === endSignature) {
      endOffset = offset;
      break;
    }
  }
  assert.notEqual(endOffset, -1, "release artifact is not a complete ZIP archive");
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  assert.ok(centralOffset + centralSize <= endOffset, "ZIP central directory is out of bounds");
  const entries = [];
  let offset = centralOffset;
  while (offset < centralOffset + centralSize) {
    assert.equal(buffer.readUInt32LE(offset), centralSignature, "invalid ZIP central directory entry");
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    assert.ok(name.length > 0 && !name.startsWith("/") && !name.includes("\\") &&
      !name.split("/").includes(".."), `unsafe release archive path: ${name}`);
    entries.push(name);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(entries.length, entryCount, "ZIP central directory entry count mismatch");
  return entries;
}
