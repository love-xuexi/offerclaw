// 打包成可上传/可分发的 zip：node scripts/pack.mjs
// 产物 dist/offerclaw-v<version>.zip，只含运行时需要的文件——文档、测试脚本、开发笔记不进包。
// 零依赖：ZIP 用 node:zlib 的 deflateRaw 自己写（跟 src/options/parse-resume.js 读 .docx 是同一套格式）。
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["manifest.json", "LICENSE", "icons", "src"];
// vendor 的 LICENSE 必须留着（pdf.js 是 Apache-2.0，再分发要带许可）；其余 .md 都是开发文档
const keep = (rel) => !rel.endsWith(".md");

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function walk(rel) {
  const abs = path.join(repo, rel);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return keep(rel) ? [rel] : [];
  return fs.readdirSync(abs).flatMap((name) => walk(`${rel}/${name}`));
}

// DOS 时间戳：固定成 1980-01-01，让同样的输入产出同样的 zip
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;

function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // bit 11：文件名是 UTF-8
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    locals.push(local, deflated);

    const entry = Buffer.alloc(46 + nameBuf.length);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(deflated.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(offset, 42);
    nameBuf.copy(entry, 46);
    central.push(entry);
    offset += local.length + deflated.length;
  }
  const dir = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, eocd]);
}

const version = JSON.parse(fs.readFileSync(path.join(repo, "manifest.json"), "utf8")).version;
const names = ROOTS.flatMap(walk).sort();
const entries = names.map((name) => ({ name, data: fs.readFileSync(path.join(repo, name)) }));
const outDir = path.join(repo, "dist");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `offerclaw-v${version}.zip`);
fs.writeFileSync(outFile, zip(entries));
console.log(`${outFile}\n${entries.length} 个文件，${(fs.statSync(outFile).size / 1024).toFixed(0)} KB`);
