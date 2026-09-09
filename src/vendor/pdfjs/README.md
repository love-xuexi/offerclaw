# PDF.js（vendored）

MV3 禁止加载远程代码，简历 PDF 解析所需的 pdf.js 必须随扩展打包，因此这里保留一份构建产物。

- 上游：https://github.com/mozilla/pdf.js
- 版本：6.3.289（`pdfjsVersion` 常量，见 `pdf.min.mjs`）
- 许可：Apache License 2.0，Copyright Mozilla Foundation（全文见同目录 `LICENSE`）
- 文件：
  - `pdf.min.mjs` / `pdf.worker.min.mjs`：官方 `pdfjs-dist` 的 modern 构建
  - `cmaps/`：CID 字体映射表。中文简历多用 CID 字体，`getDocument` 必须传 `cMapUrl` 指向本目录，否则提取出的中文会乱码或缺字

升级方式：从 `pdfjs-dist` 对应版本复制 `build/pdf.min.mjs`、`build/pdf.worker.min.mjs` 和 `cmaps/`，并同步更新本文件里的版本号。这些文件未经修改，不要在此目录内直接改代码。
