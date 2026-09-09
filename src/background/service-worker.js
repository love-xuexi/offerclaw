import { MESSAGES } from "./common.js";
import { getConfig, setConfig, getUiConfig, getProfile, setProfile, saveJob, getJobs, deleteJob, setJobStatus } from "./storage.js";
import { scoreJob, scoreJobs, generateGreeting } from "./scoring.js";
// 页面里的 content script 只允许发这几类消息：API Key 与简历全文不能经 GET_CONFIG/GET_PROFILE 落进页面上下文（DESIGN.md §7）。
// OPEN_OPTIONS 只是请求打开本扩展自己的选项页，无数据回传，进白名单是安全的。
const PAGE_ALLOWED = new Set([MESSAGES.GET_UI_CONFIG, MESSAGES.OPEN_OPTIONS, MESSAGES.SCORE_JOB, MESSAGES.SCORE_JOBS, MESSAGES.GENERATE_GREETING, MESSAGES.SAVE_JOB]);
// 判定“来自本扩展自己的页面”只能看 origin：选项页是在标签页里打开的，sender.tab 同样有值，用它区分会把选项页一起挡掉
const isExtensionPage = (sender) => {
  const own = `chrome-extension://${chrome.runtime.id}`;
  return sender.origin === own || String(sender.url || "").startsWith(`${own}/`);
};
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 没声明 externally_connectable 时，其他已安装的扩展仍能往这里发消息，必须先按发送方身份拒绝
  if (sender.id !== chrome.runtime.id) return false;
  if (!isExtensionPage(sender) && !PAGE_ALLOWED.has(message?.type)) { sendResponse({ ok: false, error: "该操作不允许从页面发起" }); return false; }
  (async () => {
    try {
      switch (message?.type) {
        case MESSAGES.PING: sendResponse({ ok: true }); break;
        case MESSAGES.GET_CONFIG: sendResponse({ ok: true, config: await getConfig() }); break;
        case MESSAGES.GET_UI_CONFIG: sendResponse({ ok: true, config: await getUiConfig() }); break;
        case MESSAGES.OPEN_OPTIONS:
          // 面板里没有进入选项页的入口（content script 不能直接调 openOptionsPage），必须经这里转发
          await chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
          break;
        case MESSAGES.SET_CONFIG: await setConfig(message.config); sendResponse({ ok: true }); break;
        case MESSAGES.GET_PROFILE: sendResponse({ ok: true, profile: await getProfile() }); break;
        case MESSAGES.SET_PROFILE: await setProfile(message.profile); sendResponse({ ok: true }); break;
        case MESSAGES.SCORE_JOB: sendResponse(await scoreJob(message.job)); break;
        case MESSAGES.SCORE_JOBS: sendResponse(await scoreJobs(message.jobs || [])); break;
        case MESSAGES.GENERATE_GREETING: sendResponse(await generateGreeting(message.job, message.hint || "")); break;
        case MESSAGES.SAVE_JOB: sendResponse({ ok: true, job: await saveJob(message.job) }); break;
        case MESSAGES.GET_JOBS: sendResponse({ ok: true, jobs: await getJobs() }); break;
        case MESSAGES.DELETE_JOB: await deleteJob(message.id); sendResponse({ ok: true }); break;
        case MESSAGES.SET_JOB_STATUS: sendResponse({ ok: true, job: await setJobStatus(message.id, message.status) }); break;
        default: sendResponse({ ok: false, error: "未知消息类型" });
      }
    } catch (error) { sendResponse({ ok: false, error: error.message || "操作失败" }); }
  })();
  return true;
});
// 装完后什么都不发生是扩展被弃用的第一原因：打开选项页引导配置（新装与更新都开，更新后的表单有新字段要填）
chrome.runtime.onInstalled.addListener(() => { chrome.runtime.openOptionsPage(); });
