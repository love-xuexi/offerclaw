// 打分编排测试：node scripts/test-scoring.mjs
// mock chrome.storage.local + fetch，验证批量用简历摘要（哈希缓存/失败降级）、单岗位用全量简历
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (label, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`); if (!cond) failed++; };

const RESUME = "张三 某大学硕士 LLM Post-training。" + "项目细节与量化成果描述。".repeat(120); // >1200 字，触发摘要
const store = {};
globalThis.chrome = {
  storage: { local: {
    get: async (key) => (key in store ? { [key]: store[key] } : {}),
    set: async (obj) => { Object.assign(store, obj); }
  } }
};
store.offerclaw_profile = { resumeText: RESUME, targetRoles: "Agent 开发", skills: "GRPO", preferredCities: "上海", jobType: "campus", extraNotes: "" };
store.offerclaw_config = { protocol: "openai", baseUrl: "https://api.test/v1", apiKey: "sk-test", model: "m", temperature: 0.3, requestTimeoutMs: 5000 };

let calls = [];
const reply = (content) => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }] }) });
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  const system = body.messages.find((m) => m.role === "system")?.content || "";
  const user = body.messages.find((m) => m.role === "user")?.content || "";
  const kind = system.includes("简历信息压缩助手") ? "summary" : system.includes("逐一判断") ? "batch" : "single";
  calls.push({ kind, user });
  if (kind === "summary") return reply("学历：某大学硕士｜方向：LLM Post-training｜技术栈：GRPO");
  if (kind === "batch") return reply(JSON.stringify({ results: [{ i: 0, score: 82, verdict: "recommend", matched: ["方向对口"], missing: [] }] }));
  return reply(JSON.stringify({ score: 88, verdict: "recommend", matched: ["ACL"], missing: [], reasons: "契合", advice: "建议强调对齐经验" }));
};

const { scoreJob, scoreJobs } = await import(pathToFileURL(path.join(repo, "src/background/scoring.js")));
const jobs = [{ site: "zhipin", title: "大模型算法", company: "X", description: "负责 RLHF/DPO 对齐" }];

// 1) 首次批量：先生成摘要，再用摘要打分
let res = await scoreJobs(jobs);
check("批量打分成功", res.ok && res.results[0]?.score === 82);
check("首次批量会生成简历摘要", calls.filter((c) => c.kind === "summary").length === 1);
const firstBatch = calls.find((c) => c.kind === "batch");
check("批量请求带摘要而非全文", firstBatch.user.includes("学历：某大学硕士") && !firstBatch.user.includes("项目细节与量化成果描述。项目细节"));
check("摘要已落盘缓存", !!store.offerclaw_resume_summary?.text && !!store.offerclaw_resume_summary?.hash);

// 2) 再次批量：命中缓存，不再调用摘要
calls = [];
await scoreJobs(jobs);
check("简历未改时复用缓存摘要", calls.filter((c) => c.kind === "summary").length === 0);
check("仍然带摘要内容", calls.find((c) => c.kind === "batch").user.includes("学历：某大学硕士"));

// 3) 简历变更 → 哈希变化 → 重新生成摘要
calls = [];
store.offerclaw_profile = { ...store.offerclaw_profile, resumeText: RESUME + "新增一段实习经历。".repeat(30) };
await scoreJobs(jobs);
check("简历变更后重新生成摘要", calls.filter((c) => c.kind === "summary").length === 1);

// 4) 单岗位匹配用全量简历，且不触发摘要
calls = [];
const single = await scoreJob(jobs[0]);
check("单岗位打分成功", single.ok && single.result.score === 88);
check("单岗位透传 advice", single.result.advice === "建议强调对齐经验");
check("单岗位不生成摘要", calls.filter((c) => c.kind === "summary").length === 0);
check("单岗位带简历全文", calls[0].user.includes("项目细节与量化成果描述。项目细节"));
check("单岗位画像用中文求职类型", calls[0].user.includes("求职类型：校园招聘（应届）"));

// 5) 摘要接口失败时降级为截断全文，不阻断批量
calls = [];
delete store.offerclaw_resume_summary;
const okFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  const system = body.messages.find((m) => m.role === "system")?.content || "";
  if (system.includes("简历信息压缩助手")) return { ok: false, status: 500, text: async () => "boom" };
  return okFetch(url, opts);
};
res = await scoreJobs(jobs);
check("摘要失败仍能完成批量打分", res.ok && res.results[0]?.score === 82);
const degraded = calls.find((c) => c.kind === "batch");
check("降级为截断简历（约 1200 字）", degraded.user.includes("张三 某大学硕士") && !degraded.user.includes("学历：某大学硕士"));
check("摘要失败不写入缓存", !store.offerclaw_resume_summary);

// 6) 模型给非整数分数或与分数矛盾的 verdict 时一律按分数重算（面板配色用同一套阈值）
globalThis.fetch = async () => reply(JSON.stringify({ score: 82.6, verdict: "skip", matched: [], missing: [], reasons: "r" }));
const repaired = await scoreJob(jobs[0]);
check("分数取整", repaired.ok && repaired.result.score === 83, String(repaired.result?.score));
check("verdict 按分数重算为 recommend", repaired.result.verdict === "recommend");
globalThis.fetch = async () => reply(JSON.stringify({ score: 30, verdict: "recommend", matched: [], missing: [] }));
check("低分不会被标成 recommend", (await scoreJob(jobs[0])).result.verdict === "skip");

console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
