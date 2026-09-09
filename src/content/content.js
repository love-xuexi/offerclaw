(function () {
  const api = globalThis.OfferClaw;
  let lastUrl = location.href;
  const enabled = async () => {
    const response = await chrome.runtime.sendMessage({ type: "GET_UI_CONFIG" });
    const sites = response?.config?.enabledSites;
    return !sites || sites[api.detectSite()] !== false;
  };
  let initRetries = 0;
  const init = async () => {
    if (!(await enabled())) return;
    const job = api.extractJob();
    // 用户点了「×」之后本页签内不再唤回面板（刷新后恢复）；updatePanelJob 自己会切静默态
    const existing = document.querySelector("#offerclaw-root");
    if (existing) api.updatePanelJob(job);
    else if (!api.isPanelClosed?.()) api.initPanel(job);
    // SPA 内容可能晚于 document_idle 渲染；未识别到岗位时做有界重试，避免面板永远停在静默态。
    if (api.shouldRetryJob?.(job, initRetries)) {
      initRetries++;
      setTimeout(init, 1000);
    }
  };
  // 招聘站基本都是 SPA。页面里调 history.pushState 不会传到 content script 所在的隔离世界（两边各有一份
  // history 包装对象），而全文档 MutationObserver 在这些页面上会被持续触发、debounce 可能永远等不到静默，
  // 所以只监听 popstate 并轮询 URL。
  const navigate = () => { if (location.href !== lastUrl) { lastUrl = location.href; initRetries = 0; init(); } };
  addEventListener("popstate", navigate);
  setInterval(navigate, 1000);
  init();
})();
