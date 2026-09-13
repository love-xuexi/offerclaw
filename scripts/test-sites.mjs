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
  ["yingjiesheng", "https://q.yingjiesheng.com/jobs/search/%E5%9B%BD%E4%BC%81?funcCode=A0JQ"],
  ["zhiye", "https://iflytek.zhiye.com/campus/jobs?shareId=e3f84f20-7882-4e20-bb90-1dbc83123f44"],
  ["moka", "https://app.mokahr.com/campus_apply/qianli1/147197?recommendCode=DSchpM5j#/jobs"],
  ["feishu", "https://nio.jobs.feishu.cn/campus/position/7683735115122510134/detail"]
];

for (const [key, url] of domains) {
  check(`${key} 域名识别`, api.detectSite(url) === key, api.detectSite(url));
}
check("牛客批量扫描抓详情页", api.deepScanStrategy("nowcoder") === "fetch");
check("智联批量扫描抓详情页", api.deepScanStrategy("zhaopin") === "fetch");
check("应届生不深度抓取", api.deepScanStrategy("yingjiesheng") === "");
check("北森完整 JD 在卡片合并阶段拿，不逐岗深扫", api.deepScanStrategy("zhiye") === "");
check("Moka 经典模板走同页 hash 跳转策略", api.deepScanStrategy("moka") === "navigate");
check("飞书批量扫描抓同源 JSON", api.deepScanStrategy("feishu") === "fetch");


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

const zhiyeBlock = extractorSource.match(/zhiye: \{[\s\S]*?\n    \},/)?.[0] || "";
check("北森列表卡片使用 STListItem 根节点", zhiyeBlock.includes("[class*='STListItem']"));
check("北森卡片标题使用 STJobTitle（新版模板）", zhiyeBlock.includes("[class*='STJobTitle']"));
check("北森详情标题用 STJobName，避免列表卡拼成假岗位", zhiyeBlock.includes("title: [\"[class*='STJobName']\""));
check("北森详情页读取 STJobDuty JD 容器", zhiyeBlock.includes("[class*='STJobDuty']"));
check("北森列表接口按标题合并完整 JD", zhiyeBlock.includes("listJobs") && zhiyeBlock.includes("GetJobAdPageList"));
check("北森列表接口只发同源带凭证请求", zhiyeBlock.includes("location.origin") && zhiyeBlock.includes('credentials: "include"'));
check("北森兼容企业定制模板卡片", zhiyeBlock.includes('".job-list .item"'));
check("北森卡片标题/描述兼容两套模板", zhiyeBlock.includes('cardTitle: ["[class*=\'STJobTitle\']", ".t"]') && zhiyeBlock.includes('cardDescription: [".con"]'));
check("北森定制模板从招聘单位行取公司名", zhiyeBlock.includes("招聘单位："));

const mokaBlock = extractorSource.match(/moka: \{[\s\S]*?\n    \},/)?.[0] || "";
check("Moka 列表以 #/job 链接为卡片", mokaBlock.includes("cards: [\"a[href*='#/job/']\"]"));
check("Moka 新版模板卡片读 job-description 全文", mokaBlock.includes("cardDescription"));
check("Moka 经典模板卡片没 JD，走 navigate 同页跳转", mokaBlock.includes('deepScan: "navigate"'));
check("Moka 详情页读取 apply__content 作用域", mokaBlock.includes(".apply__content"));

const feishuBlock = extractorSource.match(/feishu: \{[\s\S]*?\n    \},/)?.[0] || "";
check("飞书列表以职位链接为卡片（positionItem 会命中卡片内部元素）", feishuBlock.includes("cards: [\"a[href*='/position/']\"]"));
check("飞书深扫走岗位 JSON API 而非解析详情 HTML", feishuBlock.includes("fetchDetail") && feishuBlock.includes("/api/v1/job/posts/"));
check("飞书详情页读取 jobDetail 容器", feishuBlock.includes('".jobDetail"'));
check("飞书域名限定 jobs 子域，不吞其它飞书页面", feishuBlock.includes("domain: /jobs\\.feishu\\.cn/"));
const manifest = JSON.parse(fs.readFileSync(path.join(repo, "manifest.json"), "utf8"));
const expectedPatterns = [
  "*://*.zhaopin.com/*",
  "*://*.nowcoder.com/*",
  "*://*.yingjiesheng.com/*",
  "*://*.zhiye.com/*",
  "*://*.mokahr.com/*",
  "*://*.jobs.feishu.cn/*"
];
for (const pattern of expectedPatterns) {
  check(`manifest host 权限包含 ${pattern}`, manifest.host_permissions.includes(pattern));
  check(`manifest 静态注入包含 ${pattern}`, manifest.content_scripts[0].matches.includes(pattern));
}

const contentSource = fs.readFileSync(path.join(repo, "src/content/content.js"), "utf8");
check("content script 对未识别岗位做有界重试", contentSource.includes("api.shouldRetryJob") && contentSource.includes("setTimeout(init, 1000)"));

const optionsHtml = fs.readFileSync(path.join(repo, "src/options/options.html"), "utf8");
for (const key of ["zhaopin", "nowcoder", "yingjiesheng", "zhiye", "moka", "feishu"]) {
  check(`选项页包含 ${key} 开关`, optionsHtml.includes(`name="${key}"`));
}

const optionsJs = fs.readFileSync(path.join(repo, "src/options/options.js"), "utf8");
for (const key of ["zhaopin", "nowcoder", "yingjiesheng", "zhiye", "moka", "feishu"]) {
  check(`options.js 保存 ${key} 开关`, optionsJs.includes(`${key}: form.${key}.checked`));
}

const { buildBatchScorePrompt } = await import(pathToFileURL(path.join(repo, "src/background/prompts.js")));
const profile = { domain: "ai", resumeText: "张三，硕士", targetRoles: "Agent", skills: "PyTorch", jobType: "intern" };
for (const key of ["zhaopin", "nowcoder", "zhiye", "moka", "feishu"]) {
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
