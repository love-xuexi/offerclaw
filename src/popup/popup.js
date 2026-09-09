const send = (type, payload = {}) => chrome.runtime.sendMessage({ type, ...payload });
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
let jobs = [];
let hasApiKey = true;

const jobTitle = (job) => {
  const href = OfferClaw.safeUrl(job.url);
  return href
    ? `<a class="job-title" href="${esc(href)}" target="_blank" rel="noopener">${esc(OfferClaw.truncate(job.title, 42))}</a>`
    : `<div class="job-title">${esc(OfferClaw.truncate(job.title, 42))}</div>`;
};

const filtered = () => {
  const filter = document.querySelector("#filter").value;
  const sort = document.querySelector("#sort").value;
  const keyword = document.querySelector("#search").value.trim().toLowerCase();
  const rows = jobs.filter((job) => {
    if (filter && job.status !== filter) return false;
    if (!keyword) return true;
    return `${job.title} ${job.company}`.toLowerCase().includes(keyword);
  });
  // 按时间倒序是默认（最新在最上，与存储顺序一致）；按分数把无分记录沉底
  if (sort === "score") rows.sort((a, b) => (Number(b.score) || -1) - (Number(a.score) || -1));
  return rows;
};

// 空态分四种：没配 Key、一条记录都没有、当前筛选下没有、搜索词没命中——共用一句会让人以为记录被清空了
const emptyMessage = () => {
  if (!hasApiKey) return "还没有配置 API Key。点上方「打开选项页」填好 Key 和简历，再回招聘站开始匹配。";
  if (jobs.length) {
    const keyword = document.querySelector("#search").value.trim();
    return keyword ? `没有匹配「${keyword}」的岗位，换个关键词试试。` : "当前筛选下没有岗位，换个状态看看。";
  }
  return "还没有岗位记录。在支持的招聘站岗位详情页点「开始匹配」，或在列表页点「扫描本页岗位」，再点「保存」入库。";
};

async function render() {
  const list = document.querySelector("#list");
  const visible = filtered();
  const recommended = jobs.filter((job) => job.verdict === "recommend").length;
  const applied = jobs.filter((job) => job.status === "applied").length;
  document.querySelector("#stats").textContent = `已扫描 ${jobs.length} · 推荐 ${recommended} · 已保存 ${jobs.filter((j) => j.status === "saved").length} · 已投 ${applied}`;
  list.innerHTML = visible.length ? visible.map((job) => `<article class="job" data-job-id="${esc(job.id)}">
    <span class="score">${esc(job.score ?? "-")}分</span>
    ${jobTitle(job)}
    <div class="muted">${esc(job.company || "未知公司")} · ${esc(job.salary || "薪资待确认")} · ${esc(OfferClaw.verdictLabel(job.verdict))}</div>
    <div class="job-actions">
      <select data-status="${esc(job.id)}"><option value="scored">已评分</option><option value="saved">已保存</option><option value="applied">已投递</option><option value="rejected">已拒绝</option></select>
      ${job.status === "applied" ? `<span class="applied-at">已投 ${esc(OfferClaw.formatDate(job.appliedAt))}</span>` : `<button data-apply="${esc(job.id)}">标记已投</button>`}
      <button data-greet="${esc(job.id)}">打招呼</button>
      ${Number.isFinite(Number(job.score)) ? "" : `<button data-rescore="${esc(job.id)}">重新打分</button>`}
      ${OfferClaw.safeUrl(job.url) ? `<a href="${esc(OfferClaw.safeUrl(job.url))}" target="_blank" rel="noopener">打开原页面</a>` : ""}
      <button data-delete="${esc(job.id)}">删除</button>
    </div>
    <div class="greeting"></div>
  </article>`).join("") : `<div class="empty">${emptyMessage()}</div>`;
  visible.forEach((job) => {
    const select = list.querySelector(`[data-status="${CSS.escape(String(job.id))}"]`);
    if (select) select.value = job.status || "scored";
  });
}

async function load() {
  const [jobsResponse, configResponse] = await Promise.all([send("GET_JOBS"), send("GET_CONFIG")]);
  jobs = jobsResponse.jobs || [];
  // 只留一个布尔，不把 Key 本身留在内存里
  hasApiKey = Boolean(configResponse?.config?.apiKey);
  render();
}

document.querySelector("#filter").addEventListener("change", render);
document.querySelector("#sort").addEventListener("change", render);
document.querySelector("#search").addEventListener("input", render);
document.querySelector("#options").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.querySelector("#export").addEventListener("click", () => {
  // 导出当前筛选与排序结果，跟界面看到的一致；导全量会让人以为筛选没生效
  const blob = new Blob(["\ufeff" + OfferClaw.toCSV(filtered())], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob); link.download = "offerclaw-jobs.csv"; link.click(); URL.revokeObjectURL(link.href);
});
// 非招聘站点按点击注入（P4）：activeTab 只在用户点开本 popup 的这次交互里授权当前页，
// 用户不点就完全不碰任何其他站点。四个已适配站点之外才需要这个入口。
document.querySelector("#runHere").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const note = document.querySelector("#runHereNote");
  button.disabled = true;
  const original = button.textContent;
  button.textContent = "注入中…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/.test(tab.url || "")) throw new Error("当前页不是可注入的网页（浏览器内部页面不支持）");
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["src/content/panel.css"] });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/common/messages.js", "src/common/util.js", "src/content/extractors.js", "src/content/panel.js", "src/content/content.js"]
    });
    note.textContent = "已在当前页启用。回到该页面即可使用面板（刷新后失效，需再次注入）。";
    window.close();
  } catch (error) {
    note.textContent = "注入失败：" + (error?.message || "未知错误");
    button.disabled = false;
    button.textContent = original;
  }
});
document.querySelector("#list").addEventListener("click", async (event) => {
  const greet = event.target.closest("[data-greet]");
  if (greet) {
    if (greet.disabled) return;
    const job = jobs.find((item) => String(item.id) === String(greet.dataset.greet));
    const card = greet.closest(".job");
    if (!job || !card) return;
    greet.disabled = true; greet.textContent = "生成中…";
    try {
      const response = await send("GENERATE_GREETING", { job, hint: document.querySelector("#hint").value.trim() });
      card.querySelector(".greeting").innerHTML = response.ok
        ? `<div class="inline-greeting"><textarea>${esc(response.text)}</textarea><button data-copy>复制</button></div>`
        : `<p class="error">${esc(response.error)}</p>`;
    } catch (error) { card.querySelector(".greeting").innerHTML = `<p class="error">${esc(error.message || "生成失败，请重试")}</p>`; }
    finally { greet.disabled = false; greet.textContent = "打招呼"; }
    return;
  }
  const copy = event.target.closest("[data-copy]");
  if (copy) {
    if (copy.disabled) return;
    copy.disabled = true; copy.textContent = "复制中…";
    try { await navigator.clipboard.writeText(copy.closest(".inline-greeting").querySelector("textarea").value); copy.textContent = "已复制"; }
    catch (_) { copy.textContent = "复制失败"; }
    finally { setTimeout(() => { if (copy.isConnected) { copy.disabled = false; copy.textContent = "复制"; } }, 1200); }
    return;
  }
  const apply = event.target.closest("[data-apply]");
  if (apply) { apply.disabled = true; await send("SET_JOB_STATUS", { id: apply.dataset.apply, status: "applied" }); await load(); return; }
  const rescore = event.target.closest("[data-rescore]");
  if (rescore) {
    const job = jobs.find((item) => String(item.id) === String(rescore.dataset.rescore));
    if (!job || rescore.disabled) return;
    rescore.disabled = true; rescore.textContent = "打分中…";
    try {
      const response = await send("SCORE_JOB", { job });
      if (response.ok) { await load(); return; }
      rescore.closest(".job").querySelector(".greeting").innerHTML = `<p class="error">${esc(response.error)}</p>`;
    } catch (error) { rescore.closest(".job").querySelector(".greeting").innerHTML = `<p class="error">${esc(error.message || "打分失败，请重试")}</p>`; }
    finally { rescore.disabled = false; rescore.textContent = "重新打分"; }
    return;
  }
  const remove = event.target.closest("[data-delete]");
  // 删除无撤销，二次确认防手滑
  if (remove) {
    if (remove.dataset.confirm !== "yes") { remove.dataset.confirm = "yes"; remove.textContent = "确认删除？"; return; }
    await send("DELETE_JOB", { id: remove.dataset.delete });
    await load();
  }
});
document.querySelector("#list").addEventListener("change", async (event) => {
  if (event.target.dataset.status) { await send("SET_JOB_STATUS", { id: event.target.dataset.status, status: event.target.value }); await load(); }
});
load();
