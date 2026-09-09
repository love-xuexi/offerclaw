// 简历文件解析（仅选项页使用）：PDF 走本地 vendor pdf.js，.docx 用原生 ZIP 解析 + DecompressionStream 提取正文。
// MV3 禁止远程代码，pdf.js 必须打包在 src/vendor/pdfjs/；.doc 没有轻量解析方案，提示用户另存。
(function (root) {
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const PDF_LIB = "src/vendor/pdfjs/pdf.min.mjs";
  const PDF_WORKER = "src/vendor/pdfjs/pdf.worker.min.mjs";
  const PDF_CMAPS = "src/vendor/pdfjs/cmaps/";

  async function parsePdf(file) {
    const pdfjs = await import(chrome.runtime.getURL(PDF_LIB));
    pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(PDF_WORKER);
    // 中文简历多用 CID 字体，必须提供 cMaps 才能正确提取文字
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      cMapUrl: chrome.runtime.getURL(PDF_CMAPS),
      cMapPacked: true
    });
    const doc = await loadingTask.promise;
    try {
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const { items } = await (await doc.getPage(i)).getTextContent();
        pages.push(items.map((item) => item.hasEOL ? item.str + "\n" : item.str).join(""));
      }
      return pages.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    } finally { await loadingTask.destroy(); }
  }

  async function inflateRaw(data) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // .docx 即 ZIP 包：解析中央目录定位 word/document.xml，解压得到正文 XML
  async function readDocxXml(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("不是有效的 .docx 文件（缺少 ZIP 目录）");
    const decoder = new TextDecoder();
    let p = view.getUint32(eocd + 16, true);
    for (let n = 0, count = view.getUint16(eocd + 10, true); n < count; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) break;
      const method = view.getUint16(p + 10, true);
      const compressedSize = view.getUint32(p + 20, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const headerOffset = view.getUint32(p + 42, true);
      const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (name !== "word/document.xml") continue;
      if (method !== 0 && method !== 8) throw new Error(`不支持的 .docx 压缩方式：${method}`);
      const dataStart = headerOffset + 30 + view.getUint16(headerOffset + 26, true) + view.getUint16(headerOffset + 28, true);
      const data = bytes.subarray(dataStart, dataStart + compressedSize);
      return decoder.decode(method === 8 ? await inflateRaw(data) : data);
    }
    throw new Error(".docx 中缺少正文（word/document.xml），文件可能已损坏");
  }

  function decodeEntities(text) {
    return text
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  }

  function docxXmlToText(xml) {
    return decodeEntities(xml
      .replace(/>\s+</g, "><")
      .replace(/<w:tab\b[^>]*\/?>/g, "\t")
      .replace(/<w:br\b[^>]*\/?>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, ""))
      .split("\n").map((line) => line.replace(/\s+$/, "")).join("\n")
      .replace(/\n{3,}/g, "\n\n").trim();
  }

  async function parseDocx(file) {
    return docxXmlToText(await readDocxXml(new Uint8Array(await file.arrayBuffer())));
  }

  async function parseResumeFile(file) {
    if (file.size > MAX_FILE_BYTES) throw new Error("文件超过 20MB，请压缩后重试");
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".pdf")) return parsePdf(file);
    if (lower.endsWith(".docx")) return parseDocx(file);
    if (lower.endsWith(".doc")) throw new Error("暂不支持旧版 .doc，请在 Word 中另存为 .docx 或导出 PDF");
    throw new Error("仅支持 PDF 和 Word（.docx）文件");
  }

  root.OfferClaw = root.OfferClaw || {};
  root.OfferClaw.parseResumeFile = parseResumeFile;
})(globalThis);
