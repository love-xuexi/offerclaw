const PROFILE_KEY = "offerclaw_profile";
const CONFIG_KEY = "offerclaw_config";
const JOBS_KEY = "offerclaw_jobs";
// 简历摘要单独存：选项页保存画像时只提交自己那几个字段，放进 profile 会被覆盖掉
const RESUME_SUMMARY_KEY = "offerclaw_resume_summary";
export const DEFAULT_PROFILE = {
  resumeText: "", targetRoles: "", skills: "", preferredCities: "",
  domain: "generic", education: "", certificates: "", expectedSalary: "",
  jobType: "intern", extraNotes: ""
};
export const DEFAULT_CONFIG = {
  provider: "siliconflow", protocol: "openai", baseUrl: "https://api.siliconflow.cn/v1",
  apiKey: "", model: "deepseek-ai/DeepSeek-V4-Flash", temperature: 0.3, maxScanConcurrency: 5, scanTopN: 20, requestTimeoutMs: 90000
};
const read = (key, fallback) => chrome.storage.local.get(key).then((v) => ({ ...fallback, ...(v[key] || {}) }));
export const getProfile = () => read(PROFILE_KEY, DEFAULT_PROFILE);
export const setProfile = (profile) => chrome.storage.local.set({ [PROFILE_KEY]: { ...DEFAULT_PROFILE, ...profile } });
export const getConfig = () => read(CONFIG_KEY, DEFAULT_CONFIG);
// content script 只拿得到这几个非敏感字段：API Key 与简历全文绝不能进页面上下文（DESIGN.md §7）。
// hasApiKey 只回传布尔——面板要知道"是否已配置"来显示引导横幅，但绝不能拿到 Key 本身。
export async function getUiConfig() {
  const { enabledSites, maxScanConcurrency, scanTopN, apiKey } = await getConfig();
  return { enabledSites, maxScanConcurrency, scanTopN, hasApiKey: Boolean(apiKey) };
}
export const setConfig = (config) => chrome.storage.local.set({ [CONFIG_KEY]: { ...DEFAULT_CONFIG, ...config } });
export async function getJobs() { return (await chrome.storage.local.get(JOBS_KEY))[JOBS_KEY] || []; }
export async function getResumeSummary() { return (await chrome.storage.local.get(RESUME_SUMMARY_KEY))[RESUME_SUMMARY_KEY] || null; }
export const setResumeSummary = (value) => chrome.storage.local.set({ [RESUME_SUMMARY_KEY]: value });
export async function saveJob(job) {
  const jobs = await getJobs();
  const now = new Date().toISOString();
  const old = jobs.find((item) => item.url === job.url);
  const terminal = old?.status === "applied" || old?.status === "rejected";
  const next = { ...(old || {}), ...job, id: old?.id || job.id, updatedAt: now,
    ...(terminal ? { status: old.status, ...(old.appliedAt ? { appliedAt: old.appliedAt } : {}) } : {}) };
  await chrome.storage.local.set({ [JOBS_KEY]: old ? jobs.map((item) => item.url === job.url ? next : item) : [next, ...jobs] });
  return next;
}
export async function deleteJob(id) {
  await chrome.storage.local.set({ [JOBS_KEY]: (await getJobs()).filter((job) => job.id !== id) });
}
export async function setJobStatus(id, status) {
  const jobs = await getJobs();
  const now = new Date().toISOString();
  const next = jobs.map((job) => job.id === id ? { ...job, status, updatedAt: now,
    ...(status === "applied" && !job.appliedAt ? { appliedAt: now } : {}) } : job);
  await chrome.storage.local.set({ [JOBS_KEY]: next });
  return next.find((job) => job.id === id);
}
