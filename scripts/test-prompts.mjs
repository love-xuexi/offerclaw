// 提示词内容测试：node scripts/test-prompts.mjs
// 验证领域化（选 ai 时含 AI 维度、选其他领域时不含）、领域无关锚点、分站点 JD 限长、
// 批量去 reasons、摘要含证书/业绩槽位、matched 注入、jobType 中文化
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { buildScorePrompt, buildBatchScorePrompt, buildGreetingPrompt, buildResumeSummaryPrompt } =
  await import(pathToFileURL(path.join(repo, "src/background/prompts.js")));
const aiProfile = { domain: "ai", resumeText: "张三，某大学硕士", targetRoles: "Agent 开发,RAG 算法", skills: "PyTorch,GRPO", preferredCities: "上海", jobType: "intern", extraNotes: "避免外包" };
const nurseProfile = { domain: "medical", resumeText: "李四，护理学本科，持有护士执业资格证", targetRoles: "ICU 护士", skills: "重症监护,静疗", preferredCities: "北京", jobType: "social", extraNotes: "接受夜班", certificates: "护士执业资格证", education: "护理学本科" };
const job = { site: "zhipin", title: "大模型算法", company: "X", location: "上海", salary: "20-30K", description: "负责 RLHF/DPO 对齐" };
let failed = 0;
const check = (label, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`); if (!cond) failed++; };
const has = (s, sub) => String(s || "").includes(sub);

// 1) AI 领域：原有 AI 维度清单原样保留，精度不降
const aiScore = buildScorePrompt(aiProfile, job);
check("ai 领域含大模型方向侧写", has(aiScore.system, "大模型算法与应用"));
check("ai 领域含 GRPO/RAG/vLLM 等栈", has(aiScore.system, "GRPO") && has(aiScore.system, "RAG") && has(aiScore.system, "vLLM"));
check("ai 领域含顶会 ACL", has(aiScore.system, "ACL"));
check("ai 领域标注目标领域", has(aiScore.user, "目标领域：AI / 软件 / 互联网"));

// 2) 医疗领域：含执业资质等硬门槛维度，且不再出现 AI 专属栈
const medScore = buildScorePrompt(nurseProfile, { ...job, title: "ICU 护士", description: "要求持有护士执业资格证，能接受夜班" });
check("medical 领域含执业资质硬门槛", has(medScore.system, "执业资质"));
check("medical 领域不含 AI 专属维度", !has(medScore.system, "GRPO") && !has(medScore.system, "vLLM") && !has(medScore.system, "NeurIPS"));
check("medical 领域标注目标领域", has(medScore.user, "目标领域：医疗 / 护理 / 生物"));
check("medical 领域画像带证书字段", has(medScore.user, "证书资质：护士执业资格证"));
check("未指定领域回退通用侧写", has(buildScorePrompt({ ...aiProfile, domain: "" }, job).system, "通用职业能力"));

// 3) 锚点领域无关：任何领域共用同一把分数标尺
for (const [label, profile] of [["ai", aiProfile], ["medical", nurseProfile], ["未指定", { ...aiProfile, domain: "" }]]) {
  const prompt = buildScorePrompt(profile, job);
  check(`${label} 领域含全部锚点档位`, ["90-100", "75-89", "50-74", "25-49", "0-24"].every((a) => has(prompt.system, a)));
  check(`${label} 领域锚点不含 AI 专属措辞`, !has(prompt.system, "同属 AI/软件大类") && !has(prompt.system, "技术栈不同"));
}
check("锚点用领域无关的职能大类表述", has(aiScore.system, "同一个职能大类"));
check("锚点硬门槛不满足封顶 24", has(aiScore.system, "不得高于 24"));
check("锚点硬门槛随求职类型变化", has(aiScore.system, "硬门槛随求职类型变化"));
check("锚点含转行口径", has(aiScore.system, "转行求职按可迁移性评估"));
check("转行求职有专门提示", has(buildScorePrompt({ ...aiProfile, jobType: "career" }, job).system, "转行求职"));
check("国企求职有专门提示", has(buildScorePrompt({ ...aiProfile, jobType: "soe" }, job).system, "国企/事业单位"));

// 4) score 提示词通用约定
for (const field of ["score", "verdict", "matched", "missing", "reasons", "advice"]) check(`score schema 含 ${field}`, has(aiScore.system, `"${field}"`));
check("score advice 有字数上限", has(aiScore.system, "≤120 字"));
check("score 禁止 JSON 外文字", has(aiScore.system, "不要任何 JSON 之外的文字"));
check("score 画像用中文求职类型", has(aiScore.user, "求职类型：日常实习") && !has(aiScore.user, '"jobType"'));
check("score 用全量简历", has(aiScore.user, "张三，某大学硕士"));
check("score 画像带新槽位", has(buildScorePrompt({ ...aiProfile, education: "某大学硕士 2026 届", certificates: "CET-6", expectedSalary: "5000/月" }, job).user, "教育背景") && has(buildScorePrompt({ ...aiProfile, education: "某大学硕士 2026 届", certificates: "CET-6", expectedSalary: "5000/月" }, job).user, "期望薪资下限：5000/月"));

// 5) 分站点 JD 限长：有完整 JD 的站点放宽到 2200，摘要站点仍是 800
const longDesc = "岗位职责：" + "细节".repeat(1200);
const zhipinBatch = buildBatchScorePrompt(aiProfile, [{ ...job, site: "zhipin", description: longDesc }]);
const job51Batch = buildBatchScorePrompt(aiProfile, [{ ...job, site: "job51", description: longDesc }]);
const descLen = (text) => (text.match(/"description": "([\s\S]*?)"\n/) || ["", ""])[1].length;
check("批量对 BOSS 放宽到 2200 字", descLen(zhipinBatch.user) > 2000 && descLen(zhipinBatch.user) <= 2200, `${descLen(zhipinBatch.user)} 字`);
check("批量对 51job 仍限 800 字", descLen(job51Batch.user) <= 800, `${descLen(job51Batch.user)} 字`);
// 北森/Moka/飞书三家的批量扫描能读到完整 JD，与智联/牛客同一档限长
for (const site of ["zhiye", "moka", "feishu"]) {
  const batch = buildBatchScorePrompt(aiProfile, [{ ...job, site, description: longDesc }]);
  check(`批量对 ${site} 放宽到 2200 字`, descLen(batch.user) > 2000 && descLen(batch.user) <= 2200, `${descLen(batch.user)} 字`);
}
check("单岗位限 4000 字", (() => { const m = buildScorePrompt(aiProfile, { ...job, description: "x".repeat(9000) }).user.match(/"description": "([\s\S]*?)"\n/); return m && m[1].length <= 4000; })());

// 6) 批量提示词
const batch = buildBatchScorePrompt(aiProfile, [job, { ...job, title: "RAG 工程师" }]);
check("batch 覆盖实习/校招/社招", has(batch.system, "实习") && has(batch.system, "校招") && has(batch.system, "社招"));
check("batch 说明简历是摘要不扣分", has(batch.system, "压缩摘要") && has(batch.system, "不要因为摘要简短而扣分"));
check("batch 说明摘要岗位不扣分", has(batch.system, "不要因为信息缺失而扣分"));
check("batch 要求拉开分差", has(batch.system, "拉开差距"));
check("batch 含评分锚点", has(batch.system, "评分锚点"));
check("batch 去除 reasons/advice", has(batch.system, "不要输出 reasons 与 advice"));
check("batch schema 不含 reasons", !/"reasons"/.test(batch.system));
check("batch schema 含 results", has(batch.system, '"results"'));
check("batch user 含两个岗位编号", has(batch.user, "0.") && has(batch.user, "1."));
check("batch 领域侧写按画像切换", has(buildBatchScorePrompt(nurseProfile, [job]).system, "执业资质") && !has(buildBatchScorePrompt(nurseProfile, [job]).system, "GRPO"));

// 7) 简历摘要：非技术岗的关键信号在压缩阶段就要保住
const summary = buildResumeSummaryPrompt("很长的简历".repeat(500));
check("摘要 prompt 限 400 字", has(summary.system, "400 字"));
check("摘要含证书槽位", has(summary.system, "证书与执业资质"));
check("摘要含量化业绩槽位", has(summary.system, "业绩与量化成果"));
check("摘要含作品集槽位", has(summary.system, "作品集"));
check("摘要含语言能力槽位", has(summary.system, "语言能力"));
check("摘要含传统技术槽位", has(summary.system, "核心技能与工具") && has(summary.system, "论文/竞赛"));
check("摘要 prompt 不编造", has(summary.system, "不编造"));
check("摘要 prompt 说明候选人来自任何行业", has(summary.system, "任何行业"));
check("摘要输入截到 8000 字", summary.user.length <= 8100, `${summary.user.length} 字`);

// 8) 打招呼语
const greetNoMatch = buildGreetingPrompt(aiProfile, job, "");
const greet = buildGreetingPrompt(aiProfile, { ...job, matched: ["ACL 论文", "GRPO 对齐经验"] }, "幽默一点");
check("greeting 注入已识别匹配点", has(greet.user, "已识别的匹配点：ACL 论文；GRPO 对齐经验"));
check("greeting 无匹配点时不注入", !has(greetNoMatch.user, "已识别的匹配点"));
check("greeting 含用户额外要求", has(greet.user, "幽默一点"));
check("greeting 不编造", has(greet.system, "不编造"));
check("greeting 字数约束", has(greet.system, "60-90 字"));
check("greeting 中文平台不再写死单一平台", has(greet.system, "BOSS 直聘、实习僧"));

// 9) LinkedIn 站点默认英文招呼，其他站默认中文
const linkedinGreet = buildGreetingPrompt(aiProfile, { ...job, site: "linkedin" }, "");
check("linkedin 岗位默认英文招呼", /first person|LinkedIn/.test(linkedinGreet.system) && !has(linkedinGreet.system, "中文打招呼语"));
check("非 linkedin 岗位保持中文招呼", has(greet.system, "中文打招呼语"));
check("带 hint 的提示词声明语言要求可覆盖", has(buildGreetingPrompt(aiProfile, { ...job, site: "linkedin" }, "用中文").user, "包括语言要求"));

console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
