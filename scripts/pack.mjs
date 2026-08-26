/**
 * MVU ToolPkg 打包脚本（版本取自 manifest.json）。
 *
 * 生成 release/operit_mvu-{version}.toolpkg（标准 ZIP，版本取自 manifest.json）。
 * 条目布局：dist/**（不重复收录 app.html）、根 app.html、manifest.json、README.md、LICENSE、
 * docs/THIRD_PARTY_NOTICES.md、third_party/**。设计、测试、实施计划和宿主开发文档只保留在源码仓库。
 * 所有条目使用正斜杠路径；manifest 保持 UTF-8 无 BOM。
 * 注意：manifest.resources.app_html 指向根目录 app.html；dist/app.html 仅作为打包源，不重复入包。
 *
 * 用法：在 examples/operit_mvu 目录执行
 *   node scripts/pack.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "manifest.json"), "utf8"));
const version = String(manifest.version);
const outputPath = path.resolve(rootDir, "release", `operit_mvu-${version}.toolpkg`);
// 发布包只能包含生产内容；在收集阶段拒绝测试与 QA 文件，避免未来新增文档时误入归档。
const forbiddenReleasePathPattern = /(^|[\/._-])(tests?|qa|preview|harness)(?=[\/._-]|$)/i;

/** 收集要打包的条目：{ source(相对 rootDir 的规范路径), name(包内正斜杠路径) }。 */
function collectEntries() {
  const entries = [];
  const add = (relative) => {
    // app.html is published once at the archive root because manifest.resources
    // addresses that exact path. Keeping dist/app.html as a second ZIP entry doubles
    // the largest payload and makes on-device installation needlessly expensive.
    if (relative === "dist/app.html") return;
    const abs = path.join(rootDir, ...relative.split("/"));
    if (!fs.existsSync(abs)) {
      throw new Error(`Missing package source: ${abs}`);
    }
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      if (forbiddenReleasePathPattern.test(relative)) {
        throw new Error(`Forbidden non-production package entry: ${relative}`);
      }
      entries.push({ source: relative, name: relative });
    } else if (stat.isDirectory()) {
      const children = fs.readdirSync(abs, { withFileTypes: true });
      for (const child of children) {
        add(`${relative}/${child.name}`);
      }
    } else {
      throw new Error(`Unsupported entry: ${relative}`);
    }
  };
  add("manifest.json");
  add("README.md");
  add("LICENSE");
  add("dist");
  // 根目录 app.html（资源 resource.path=app.html，与 desire 资源同层布局）
  entries.push({ source: "dist/app.html", name: "app.html" });
  add("docs/THIRD_PARTY_NOTICES.md");
  add("third_party");
  return entries;
}

// ---- 标准 ZIP（stored，无压缩）、CRC32 序列化 ----
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let value = i;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[i] = value >>> 0;
}
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const u16 = (value) => Buffer.from([value & 0xff, (value >>> 8) & 0xff]);
const u32 = (value) => Buffer.from([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);

function localFileHeader(fileName, data) {
  const name = Buffer.from(fileName, "utf8");
  const checksum = crc32(data);
  return Buffer.concat([
    u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
    u32(checksum), u32(data.length), u32(data.length), u16(name.length), u16(0), name,
  ]);
}
function centralDirectoryHeader(fileName, data, localHeaderOffset) {
  const name = Buffer.from(fileName, "utf8");
  const checksum = crc32(data);
  return Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
    u32(checksum), u32(data.length), u32(data.length), u16(name.length), u16(0),
    u16(0), u16(0), u16(0), u32(0), u32(localHeaderOffset), name,
  ]);
}
function endCentralDirectory(entryCount, centralDirectorySize, centralDirectoryOffset) {
  return Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entryCount), u16(entryCount),
    u32(centralDirectorySize), u32(centralDirectoryOffset), u16(0),
  ]);
}

function build() {
  const records = [];
  const localParts = [];
  let offset = 0;
  for (const entry of collectEntries()) {
    const data = fs.readFileSync(path.join(rootDir, ...entry.source.split("/")));
    const header = localFileHeader(entry.name, data);
    records.push({ entryName: entry.name, data, offset });
    localParts.push(header, data);
    offset += header.length + data.length;
  }
  records.sort((a, b) => a.entryName.localeCompare(b.entryName));
  const centralParts = records.map((record) => centralDirectoryHeader(record.entryName, record.data, record.offset));
  const centralDirectory = Buffer.concat(centralParts);
  const end = endCentralDirectory(records.length, centralDirectory.length, offset);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.concat([...localParts, centralDirectory, end]));
  console.log(`Packed ${path.relative(rootDir, outputPath).replace(/\\/g, "/")} (${records.length} entries, ${offset} bytes data)`);
}

build();
