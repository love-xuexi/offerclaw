import { getConfig, getProfile, getResumeSummary, setResumeSummary } from "./storage.js";
import { chatCompletion } from "./llm.js";
import { buildBatchScorePrompt, buildGreetingPrompt, buildResumeSummaryPrompt, buildScorePrompt } from "./prompts.js";
const SUMMARY_MIN_LENGTH = 1200;
function configError(config) {
  return !config.apiKey || !config.baseUrl || !config.model ? "请先在选项页配置 API Key、Base URL 和模型" : "";
}
function hashText(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${text.length}-${hash.toString(36)}`;
}
// 批量打分把简历换成摘要：一次扫描会分多批请求，每批都带简历全文既贵又容易超上下文。
// 摘要按简历内容哈希缓存，简历没改就不再重复生成；生成失败时退化为截断的简历全文，不阻断扫描。
async function batchResumeText(profile, config) {
  const resume = String(profile.resumeText || "");
  if (resume.length <= SUMMARY_MIN_LENGTH) return resume;
  const hash = hashText(resume);
  const cached = await getResumeSummary();
  if (cached?.hash === hash && cached.text) return cached.text;
  const prompt = buildResumeSummaryPrompt(resume);
  const response = await chatCompletion({ ...config, timeoutMs: config.requestTimeoutMs, messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }] });
  const text = response.ok ? String(response.content || "").trim() : "";
  if (!text) return resume.slice(0, SUMMARY_MIN_LENGTH);
  await setResumeSummary({ hash, text, updatedAt: new Date().toISOString() });
  return text;
}
function parseJson(content) {
  try { return JSON.parse(content); } catch (_) {
    const match = String(content || "").match(/\{[\s\S]*\}/);
    try { return match ? JSON.parse(match[0]) : null; } catch (__) { return null; }
  }
}
function normalizeResult(value) {
  if (!value || !Number.isFinite(Number(value.score))) return null;
  const score = Math.round(Math.max(0, Math.min(100, Number(value.score))));
  // 模型偶尔给出与分数矛盾的 verdict（如 30 分标 recommend），一律按分数重算，保证与面板配色阈值一致
  const verdict = score >= 75 ? "recommend" : score >= 50 ? "consider" : "skip";
  return { score, verdict, matched: Array.isArray(value.matched) ? value.matched.slice(0, 12) : [], missing: Array.isArray(value.missing) ? value.missing.slice(0, 12) : [], reasons: String(value.reasons || ""), advice: String(value.advice || "").slice(0, 200) };
}
export async function scoreJob(job) {
  const [profile, config] = await Promise.all([getProfile(), getConfig()]);
  const error = configError(config);
  if (error) return { ok: false, error };
  const prompt = buildScorePrompt(profile, job);
  const response = await chatCompletion({ ...config, timeoutMs: config.requestTimeoutMs, messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }], response_format: { type: "json_object" } });
  if (!response.ok) return response;
  const result = normalizeResult(parseJson(response.content));
  return result ? { ok: true, result } : { ok: false, error: "模型返回的匹配结果不是有效 JSON" };
}
export async function scoreJobs(jobs) {
  if (!jobs.length) return { ok: true, results: [] };
  const [profile, config] = await Promise.all([getProfile(), getConfig()]);
  const error = configError(config);
  if (error) return { ok: false, error };
  const prompt = buildBatchScorePrompt({ ...profile, resumeText: await batchResumeText(profile, config) }, jobs);
  const response = await chatCompletion({ ...config, timeoutMs: config.requestTimeoutMs, messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }], response_format: { type: "json_object" } });
  if (!response.ok) return response;
  const parsed = parseJson(response.content);
  const results = Array(jobs.length).fill(null);
  if (Array.isArray(parsed?.results)) for (const item of parsed.results) {
    const index = Number(item?.i);
    if (Number.isInteger(index) && index >= 0 && index < jobs.length && !results[index]) results[index] = normalizeResult(item);
  }
  const errors = {};
  // 批量结果有缺项时逐个补打分，必须串行：面板本来就并发跑多个 worker，
  // 一旦这里再对整批缺项 Promise.all，瞬时并发能到几十个 LLM 请求，直接被服务商限流。
  for (let index = 0; index < results.length; index++) {
    if (results[index]) continue;
    const fallback = await scoreJob(jobs[index]);
    if (fallback.ok) results[index] = fallback.result;
    else errors[index] = fallback.error;
  }
  return { ok: true, results, ...(Object.keys(errors).length ? { errors } : {}) };
}
export async function generateGreeting(job, hint = "") {
  const [profile, config] = await Promise.all([getProfile(), getConfig()]);
  const error = configError(config);
  if (error) return { ok: false, error };
  const prompt = buildGreetingPrompt(profile, job, hint);
  const response = await chatCompletion({ ...config, timeoutMs: config.requestTimeoutMs, messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }] });
  return response.ok ? { ok: true, text: response.content.trim() } : response;
}
