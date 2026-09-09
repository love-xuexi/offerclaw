import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (label, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
  if (!cond) failed++;
};

await import(pathToFileURL(path.join(repo, "src/content/extractors.js")));
const api = globalThis.OfferClaw;

const domains = [
  ["zhaopin", "https://xiaoyuan.zhaopin.com/search/index?refcode=4485&city=636&cateType=major"],
  ["nowcoder", "https://www.nowcoder.com/jobs/school/jobs?careerJob=11006&city=%E4%B8%8A%E6%B5%B7"],
  ["yingjiesheng", "https://q.yingjiesheng.com/jobs/search/%E5%9B%BD%E4%BC%81?funcCode=A0JQ"]
];

for (const [key, url] of domains) {
  check(`${key} 域名识别`, api.detectSite(url) === key, api.detectSite(url));
}
check("牛客批量扫描抓详情页", api.deepScanStrategy("nowcoder") === "fetch");
check("智联批量扫描抓详情页", api.deepScanStrategy("zhaopin") === "fetch");
check("应届生不深度抓取", api.deepScanStrategy("yingjiesheng") === "");


const extractorSource = fs.readFileSync(path.join(repo, "src/content/extractors.js"), "utf8");
const nowcoderBlock = extractorSource.match(/nowcoder: \{[\s\S]*?\n    \},/)?.[0] || "";
check("牛客详情页标题优先 h1，避免推荐位干扰", nowcoderBlock.includes('title: ["h1",'));
check("牛客详情页读取完整 JD 容器", nowcoderBlock.includes('".job-detail-word"') && nowcoderBlock.includes('".job-detail-infos"'));

const zhaopinBlock = extractorSource.match(/zhaopin: \{[\s\S]*?\n    \},/)?.[0] || "";
check("智联列表卡片使用 position-card 根节点", zhaopinBlock.includes('cards: [".position-card"'));
check("智联从埋点 jdno 拼岗位 URL", zhaopinBlock.includes("data-sensors-exposure-option") && zhaopinBlock.includes("jdno"));
check("智联详情页标题优先 h1", zhaopinBlock.includes('title: ["h1",'));
check("智联详情页公司使用 company-info__name", zhaopinBlock.includes('".company-info__name"'));
check("智联列表公司使用精确 cardCompany 选择器", zhaopinBlock.includes('cardCompany: ".position-card__company__name"'));

const yingjieshengBlock = extractorSource.match(/yingjiesheng: \{[\s\S]*?\n    \},/)?.[0] || "";
check("应届生列表以 jobdetail 链接为卡片", yingjieshengBlock.includes('cards: ["a[href*=\'/jobdetail/\']"]'));
check("应届生卡片 URL 直接取链接 href", yingjieshengBlock.includes('cardUrl: (el) => el.href'));
check("应届生详情页遇到验证不绕过", yingjieshengBlock.includes('滑动验证') && yingjieshengBlock.includes('不绕过'));
check("应届生详情页标题使用 detail-title job", yingjieshengBlock.includes('".detail-title-left-top .job"'));
check("应届生详情页公司使用 compnav-center", yingjieshengBlock.includes('".detail-content-compnav-center"'));
check("应届生详情页读取 jobinfo JD", yingjieshengBlock.includes('".jobinfo"'));
check("智联详情页读取 job-info__desc", zhaopinBlock.includes('".job-info__desc"'));
const manifest = JSON.parse(fs.readFileSync(path.join(repo, "manifest.json"), "utf8"));
const expectedPatterns = [
  "*://*.zhaopin.com/*",
  "*://*.nowcoder.com/*",
  "*://*.yingjiesheng.com/*"
];
for (const pattern of expectedPatterns) {
  check(`manifest host 权限包含 ${pattern}`, manifest.host_permissions.includes(pattern));
  check(`manifest 静态注入包含 ${pattern}`, manifest.content_scripts[0].matches.includes(pattern));
}

const contentSource = fs.readFileSync(path.join(repo, "src/content/content.js"), "utf8");
check("content script 对未识别岗位做有界重试", contentSource.includes("api.shouldRetryJob") && contentSource.includes("setTimeout(init, 1000)"));

const optionsHtml = fs.readFileSync(path.join(repo, "src/options/options.html"), "utf8");
for (const key of ["zhaopin", "nowcoder", "yingjiesheng"]) {
  check(`选项页包含 ${key} 开关`, optionsHtml.includes(`name="${key}"`));
}

const optionsJs = fs.readFileSync(path.join(repo, "src/options/options.js"), "utf8");
for (const key of ["zhaopin", "nowcoder", "yingjiesheng"]) {
  check(`options.js 保存 ${key} 开关`, optionsJs.includes(`${key}: form.${key}.checked`));
}

const { buildBatchScorePrompt } = await import(pathToFileURL(path.join(repo, "src/background/prompts.js")));
const profile = { domain: "ai", resumeText: "张三，硕士", targetRoles: "Agent", skills: "PyTorch", jobType: "intern" };
for (const key of ["zhaopin", "nowcoder"]) {
  const prompt = buildBatchScorePrompt(profile, [{ site: key, title: "岗位", company: "公司", description: "x".repeat(3000) }]);
  const descLength = (prompt.user.match(/"description": "([\s\S]*?)"\n/) || ["", ""])[1].length;
  check(`${key} 批量 JD 放宽到 2200 字`, descLength > 800 && descLength <= 2200, `${descLength} 字`);
}
{
  const key = "yingjiesheng";
  const prompt = buildBatchScorePrompt(profile, [{ site: key, title: "岗位", company: "公司", description: "x".repeat(3000) }]);
  const descLength = (prompt.user.match(/"description": "([\s\S]*?)"\n/) || ["", ""])[1].length;
  check(`${key} 批量 JD 仍限 800 字`, descLength <= 800, `${descLength} 字`);
}

console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
