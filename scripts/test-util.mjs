// 通用工具测试：node scripts/test-util.mjs
// util.js 是 content script / popup 共用的普通脚本（非 ESM），这里补一个 location stub 后直接 import。
// 覆盖两个会影响用户可见结果的点：CSV 导出（空结果也要有表头）、safeUrl（挡掉伪协议链接）。
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (label, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`); if (!cond) failed++; };

globalThis.location = { href: "https://www.zhipin.com/job_detail/abc.html" };
await import(pathToFileURL(path.join(repo, "src/common/util.js")));
const { toCSV, safeUrl, truncate, verdictLabel, scoreColor, shouldRetryJob } = globalThis.OfferClaw;

// --- toCSV ---
const header = "title,company,salary,score,verdict,status,url,updatedAt,appliedAt";
check("空结果也输出表头", toCSV([]) === header, JSON.stringify(toCSV([])));

const rows = toCSV([{ title: '算法"实习"', company: "A,B 公司", salary: "", score: 83, verdict: "recommend", status: "saved", url: "https://x/1", updatedAt: "2026-01-01", appliedAt: null }]);
const lines = rows.split("\r\n");
check("表头列顺序固定", lines[0] === header, lines[0]);
check("行数 = 表头 + 数据", lines.length === 2, String(lines.length));
check("双引号转义成两个", lines[1].includes('"算法""实习"""'), lines[1]);
check("含逗号的字段被引号包住", lines[1].includes('"A,B 公司"'), lines[1]);
check("null 导成空字符串而非 null", lines[1].endsWith('""'), lines[1]);
check("用 CRLF 换行（Excel 兼容）", rows.includes("\r\n") && !rows.replace(/\r\n/g, "").includes("\n"));

// --- safeUrl ---
for (const [input, expected, label] of [
  ["https://www.zhipin.com/job_detail/1.html", "https://www.zhipin.com/job_detail/1.html", "https 放行"],
  ["http://jobs.51job.com/all/1.html", "http://jobs.51job.com/all/1.html", "http 放行"],
  ["/intern/inn_abc", "https://www.zhipin.com/intern/inn_abc", "相对路径按当前页解析"],
  ["javascript:alert(1)", "", "javascript: 拦掉"],
  ["JavaScript:alert(1)", "", "大小写混写的 javascript: 也拦掉"],
  ["data:text/html,<script>x</script>", "", "data: 拦掉"],
  ["blob:https://evil/x", "", "blob: 拦掉"],
  ["chrome-extension://abc/popup.html", "", "扩展页地址拦掉"],
  ["", "", "空值返回空（否则会解析成当前页地址）"],
  [null, "", "null 返回空"],
  ["   ", "", "纯空白返回空"]
]) check(`safeUrl ${label}`, safeUrl(input) === expected, `${JSON.stringify(input)} -> ${JSON.stringify(safeUrl(input))}`);
// 非法串按相对路径解析，逃不出当前站点
check("safeUrl 非法串仍留在当前站点内", safeUrl("不是网址").startsWith("https://www.zhipin.com/"), safeUrl("不是网址"));

// --- SPA 初始化重试 ---
check("未识别岗位时允许重试", shouldRetryJob({ title: "" }, 0) === true);
check("未识别到岗位占位也允许重试", shouldRetryJob({ title: "未识别到岗位" }, 0) === true);
check("已识别岗位不重试", shouldRetryJob({ title: "AI 算法工程师" }, 0) === false);
check("超过重试上限后停止", shouldRetryJob({ title: "" }, 5) === false);

// --- 其余小工具 ---
check("truncate 超长加省略号", truncate("abcdef", 4) === "abc…", truncate("abcdef", 4));
check("truncate 不足不动", truncate("abc", 10) === "abc");
check("verdictLabel 未知值兜底", verdictLabel("unknown") === "未评分" && verdictLabel("recommend") === "推荐");
check("scoreColor 按 75/50 分档", scoreColor(75) === "#16a34a" && scoreColor(74) === "#d97706" && scoreColor(49) === "#dc2626");

console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
