// 简历解析测试：node scripts/test-resume-parse.mjs [简历.pdf]
// - .docx：脚本内手工构造最小合法 docx（ZIP deflate + 中央目录）验证解析；
// - .pdf：需自备一份 PDF（命令行参数或 OFFERCLAW_TEST_PDF 环境变量），未提供则跳过该项。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pdfPath = process.argv[2] || process.env.OFFERCLAW_TEST_PDF || "";

// shim：让 parse-resume.js 里的 chrome.runtime.getURL 指向本地文件。
// PDF 的 modern 构建要求 Promise.try（Node 24+/Chrome 128+），Node 下回退 legacy 构建；
// 找不到 legacy 时跳过 PDF 项（扩展内的 modern 构建以浏览器端到端测试为准）。
const legacyCandidates = [
  process.env.OFFERCLAW_PDFJS_LEGACY,
  path.join(repo, "node_modules/pdfjs-dist/legacy/build/pdf.min.mjs"),
  path.join(os.tmpdir(), "pdfjs-tmp/legacy/pdf.min.mjs")
].filter(Boolean);
const hasLegacyPdfjs = legacyCandidates.some((c) => fs.existsSync(c));
const pdfLibUrl = (p) => {
  if (p === "src/vendor/pdfjs/pdf.min.mjs") {
    const legacy = legacyCandidates.find((c) => fs.existsSync(c));
    if (legacy) return pathToFileURL(legacy).href;
    console.error("[warn] 找不到 legacy pdf.js（" + legacyCandidates.join(" | ") + "），跳过 PDF 测试");
    return "data:text/javascript,export {}";
  }
  // Node 下 pdf.js 用 fs 读 cMaps，需要文件系统路径而非 file:// URL
  if (p === "src/vendor/pdfjs/cmaps/") return path.join(repo, "src/vendor/pdfjs/cmaps").replace(/\\/g, "/") + "/";
  return "file:///" + path.join(repo, p).replace(/\\/g, "/");
};
globalThis.chrome = { runtime: { getURL: pdfLibUrl } };
await import(pathToFileURL(path.join(repo, "src/options/parse-resume.js")));
const { parseResumeFile } = globalThis.OfferClaw;
let failed = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failed++;
};

// --- 构造最小 .docx ---
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zipDeflate(name, content) {
  const nameBuf = Buffer.from(name);
  const raw = Buffer.from(content, "utf8");
  const data = zlib.deflateRawSync(raw);
  const crc = crc32(raw);
  const local = Buffer.alloc(30 + nameBuf.length + data.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
  local.writeUInt16LE(8, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
  nameBuf.copy(local, 30); data.copy(local, 30 + nameBuf.length);
  const central = Buffer.alloc(46 + nameBuf.length);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0, 14);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBuf.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42); nameBuf.copy(central, 46);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12); eocd.writeUInt32LE(local.length, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([local, central, eocd]);
}
const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:rPr><w:b/></w:r><w:t>张三</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>求职意向：</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>LLM Agent 开发实习</w:t></w:r></w:p>
<w:p><w:r><w:t>技能：A &amp; B，掌握 RAG &lt;检索增强&gt; 技术栈</w:t></w:r></w:p>
<w:p><w:r><w:t>第一行</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>第二行</w:t></w:r></w:p>
</w:body></w:document>`;

// --- .docx 解析 ---
console.error("[stage] docx 开始");
const docxBuffer = zipDeflate("word/document.xml", documentXml);
const docxFile = new File([docxBuffer], "测试简历.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
const docxText = await parseResumeFile(docxFile);
console.log("--- docx 提取结果 ---\n" + docxText + "\n");
check("docx 含中文姓名", docxText.includes("张三"));
check("docx 段落换行", docxText.includes("张三\n求职意向"));
check("docx 制表符", docxText.includes("求职意向：\tLLM Agent 开发实习"));
check("docx XML 实体解码", docxText.includes("A & B，掌握 RAG <检索增强> 技术栈"));
check("docx 软换行", docxText.includes("第一行\n第二行"));

// --- 错误处理 ---
for (const [name, content, expected] of [
  ["旧版.doc", Buffer.from("legacy"), "暂不支持旧版 .doc"],
  ["未知.txt", Buffer.from("text"), "仅支持 PDF"]
]) {
  try { await parseResumeFile(new File([content], name)); check(`拒绝 ${name}`, false, "未抛出错误"); }
  catch (error) { check(`拒绝 ${name}`, String(error.message).includes(expected), error.message); }
}

// --- 真实 PDF ---
console.error("[stage] pdf 开始");
if (!hasLegacyPdfjs) {
  console.log("SKIP PDF（Node 下需要 legacy 构建 pdf.js，扩展内以浏览器端到端测试为准）");
} else if (pdfPath && fs.existsSync(pdfPath)) {
  const pdfBuffer = new Uint8Array(fs.readFileSync(pdfPath));
  const pdfFile = new File([pdfBuffer], path.basename(pdfPath), { type: "application/pdf" });
  const pdfText = await parseResumeFile(pdfFile);
  console.log("--- PDF 提取结果（前 60 行）---\n" + pdfText.split("\n").slice(0, 60).join("\n") + "\n");
  check("PDF 提取到实质内容", pdfText.length > 100, `${pdfText.length} 字`);
} else {
  console.log(`跳过 PDF 测试：${pdfPath ? `找不到 ${pdfPath}` : "未提供 PDF 路径（node scripts/test-resume-parse.mjs <简历.pdf> 或设 OFFERCLAW_TEST_PDF）"}`);
}
console.error("[stage] 完成");

process.exit(failed ? 1 : 0);
