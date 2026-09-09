(function (root) {
  const api = root.OfferClaw = root.OfferClaw || {};
  api.uuid = function () {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "oc-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  };
  api.scoreColor = function (score) {
    return score >= 75 ? "#16a34a" : score >= 50 ? "#d97706" : "#dc2626";
  };
  api.verdictLabel = function (value) {
    return ({ recommend: "推荐", consider: "考虑", skip: "暂不推荐" })[value] || "未评分";
  };
  api.truncate = function (value, length) {
    const text = String(value || "");
    return text.length > length ? text.slice(0, length - 1) + "…" : text;
  };
  api.formatDate = function (value) {
    if (!value) return "-";
    try { return new Date(value).toLocaleString("zh-CN"); } catch (_) { return "-"; }
  };
  api.toCSV = function (rows) {
    const keys = ["title", "company", "salary", "score", "verdict", "status", "url", "updatedAt", "appliedAt"];
    const quote = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    // 空结果也保留表头：筛选后可能一条都不剩，导出个空文件用户会以为坏了
    return [keys.join(","), ...rows.map((row) => keys.map((key) => quote(row[key])).join(","))].join("\r\n");
  };
  // 岗位链接是从页面 DOM 里读出来的，可能是 javascript:/data: 之类的伪协议，写进 href 前只放行 http(s)
  // SPA 内容可能晚于 document_idle 渲染：未识别到岗位时允许 content.js 做有界重试。
  api.shouldRetryJob = function (job, retries = 0, maxRetries = 5) {
    const title = String(job?.title || "").trim();
    return (!title || title === "未识别到岗位") && retries < maxRetries;
  };
  api.safeUrl = function (value) {
    // 空值必须直接返回空：new URL("", location.href) 会解析成当前页地址，那样没有 url 的岗位会被渲染成指向本页的链接
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      const url = new URL(raw, location.href);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
    } catch (_) { return ""; }
  };
})(globalThis);
