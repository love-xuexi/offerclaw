// 消息路由与权限边界测试：node scripts/test-messaging.mjs
// mock chrome.runtime/onMessage + storage.local，验证：
// 1) 其他扩展发来的消息被直接拒掉（未声明 externally_connectable 时它们仍能发消息进来）；
// 2) 页面里的 content script 拿不到 API Key 与简历全文——GET_CONFIG / GET_PROFILE 只允许扩展页调用。
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (label, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`); if (!cond) failed++; };

const EXT_ID = "offerclaw-test-extension-id";
const SECRET_KEY = "sk-secret-do-not-leak";
const SECRET_RESUME = "简历全文机密内容";
const store = {
  offerclaw_config: { protocol: "openai", baseUrl: "https://api.test/v1", apiKey: SECRET_KEY, model: "m", enabledSites: { zhipin: false }, maxScanConcurrency: 3, scanTopN: 7 },
  offerclaw_profile: { resumeText: SECRET_RESUME, targetRoles: "Agent 开发" }
};
let listener;
let openedOptions = 0;
globalThis.chrome = {
  runtime: {
    id: EXT_ID,
    onMessage: { addListener: (fn) => { listener = fn; } },
    onInstalled: { addListener: (fn) => { installedListener = fn; } },
    openOptionsPage: async () => { openedOptions++; }
  },
  storage: { local: {
    get: async (key) => (key in store ? { [key]: store[key] } : {}),
    set: async (obj) => { Object.assign(store, obj); }
  } }
};
let installedListener;

await import(pathToFileURL(path.join(repo, "src/background/service-worker.js")));
check("service worker 注册了消息监听", typeof listener === "function");
check("service worker 注册了 onInstalled 钩子", typeof installedListener === "function");
await installedListener();
check("onInstalled 打开选项页引导配置", openedOptions === 1);

// 发一条消息并拿 sendResponse 的结果；一直没回响应就解析为 undefined
const call = (message, sender) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve(undefined), 300);
  listener(message, sender, (value) => { clearTimeout(timer); resolve(value); });
});
const page = { id: EXT_ID, tab: { id: 1 }, origin: "https://www.zhipin.com", url: "https://www.zhipin.com/job_detail/abc.html" };
// 选项页是在标签页里打开的：sender.tab 有值，但 origin 是本扩展，必须仍算特权来源
const optionsPage = { id: EXT_ID, tab: { id: 2 }, origin: `chrome-extension://${EXT_ID}`, url: `chrome-extension://${EXT_ID}/src/options/options.html` };
const popup = { id: EXT_ID, origin: `chrome-extension://${EXT_ID}`, url: `chrome-extension://${EXT_ID}/src/popup/popup.html` };
const other = { id: "some-other-extension", origin: "chrome-extension://some-other-extension", url: "chrome-extension://some-other-extension/evil.html" };

// 1) 其他扩展：一律无响应
check("其他扩展的 GET_CONFIG 无响应", (await call({ type: "GET_CONFIG" }, other)) === undefined);
check("其他扩展的 SET_CONFIG 无响应", (await call({ type: "SET_CONFIG", config: { apiKey: "hacked" } }, other)) === undefined);
check("其他扩展改不动配置", store.offerclaw_config.apiKey === SECRET_KEY);

// 2) 页面里的 content script：拿不到密钥与简历
for (const type of ["GET_CONFIG", "GET_PROFILE", "SET_CONFIG", "SET_PROFILE", "GET_JOBS", "DELETE_JOB", "SET_JOB_STATUS", "PING"]) {
  const response = await call({ type, config: { apiKey: "hacked" }, profile: { resumeText: "覆盖" } }, page);
  check(`页面调 ${type} 被拒`, response?.ok === false, response?.error || "无响应");
}
check("页面改不动配置", store.offerclaw_config.apiKey === SECRET_KEY);
check("页面改不动画像", store.offerclaw_profile.resumeText === SECRET_RESUME);

// 3) 页面只能拿到脱敏后的 UI 配置
const ui = await call({ type: "GET_UI_CONFIG" }, page);
const uiJson = JSON.stringify(ui);
check("页面可读 GET_UI_CONFIG", ui?.ok === true);
check("UI 配置不含 API Key", !uiJson.includes(SECRET_KEY) && !("apiKey" in (ui?.config || {})));
check("UI 配置不含 baseUrl/model", !("baseUrl" in (ui?.config || {})) && !("model" in (ui?.config || {})));
check("UI 配置带扫描参数", ui?.config?.maxScanConcurrency === 3 && ui?.config?.scanTopN === 7);
check("UI 配置带站点开关", ui?.config?.enabledSites?.zhipin === false);
check("UI 配置只回传是否已配 Key 的布尔", ui?.config?.hasApiKey === true && typeof ui?.config?.hasApiKey === "boolean");

// 3b) 面板可以请求打开选项页（无数据回传），其他扩展发同名消息仍然无效
const openResp = await call({ type: "OPEN_OPTIONS" }, page);
check("页面可请求打开选项页", openResp?.ok === true && openedOptions === 2);
check("外部扩展发 OPEN_OPTIONS 无响应", (await call({ type: "OPEN_OPTIONS" }, other)) === undefined && openedOptions === 2);

// 4) 扩展页（选项页在标签页里、popup 不在）都能读写完整配置与画像
const full = await call({ type: "GET_CONFIG" }, optionsPage);
check("选项页可读完整配置（虽然它也带 sender.tab）", full?.ok === true && full.config.apiKey === SECRET_KEY);
const profile = await call({ type: "GET_PROFILE" }, optionsPage);
check("选项页可读简历全文", profile?.ok === true && profile.profile.resumeText === SECRET_RESUME);
const jobsFromPopup = await call({ type: "GET_JOBS" }, popup);
check("popup 可读看板", jobsFromPopup?.ok === true && Array.isArray(jobsFromPopup.jobs));
await call({ type: "SET_PROFILE", profile: { resumeText: "选项页改的简历" } }, optionsPage);
check("选项页可写画像", store.offerclaw_profile.resumeText === "选项页改的简历");

// 5) 页面仍能走打分/保存链路（这些才是面板需要的）
const saved = await call({ type: "SAVE_JOB", job: { id: "j1", url: "https://www.zhipin.com/job_detail/abc.html", title: "算法实习" } }, page);
check("页面可保存岗位", saved?.ok === true && saved.job.title === "算法实习");

console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
