(function (root) {
  const api = root.OfferClaw;
  const send = (type, payload = {}) => chrome.runtime.sendMessage({ type, ...payload });
  let panel, currentJob, uiConfig = {}, listPageKey = "";
  const busy = new Set();
  const scored = new Map();
  const rankedJobs = new Map();
  const loadingLabels = { score: "匹配中…", scan: "扫描中…", greet: "生成中…", save: "保存中…" };
  const plainJob = (job) => {
    if (!job) return job;
    const { el, ...rest } = job;
    return { ...rest };
  };
  const jobKey = (job) => job.site === "shixiseng" ? job.url : `${job.url}|${job.title}|${job.company}`;
  const esc = (v) => String(v || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const getHint = () => panel?.querySelector(".oc-hint")?.value.trim() || "";
  const progressTimer = (node, getText) => {
    const started = Date.now();
    const update = () => { node.textContent = getText(Math.floor((Date.now() - started) / 1000)); };
    update();
    const timer = setInterval(update, 1000);
    return { update, stop: () => clearInterval(timer) };
  };
  // ---- 面板状态持久化：折叠/拖动位置写进页面的 localStorage。页面脚本读得到这个 key，
  // 所以只放位置与开关这类非敏感数据，绝不放岗位/简历/密钥内容。
  const STATE_KEY = "offerclaw_panel_state";
  // 关闭是会话级的：SPA 内换页不再出现，刷新后回到默认（否则用户找不到把它唤回的入口）
  let closed = false;
  const panelState = { load() { try { return JSON.parse(localStorage.getItem(STATE_KEY)) || {}; } catch (_) { return {}; } } };
  const persistState = (patch) => {
    try {
      const next = { ...panelState.load(), ...patch };
      localStorage.setItem(STATE_KEY, JSON.stringify(next));
      // 页面脚本读得到 localStorage，这里只放位置与开关，绝不放岗位/简历/密钥数据
    } catch (_) { /* 隐私模式等场景下写入失败就退回会话内行为 */ }
  };
  const applyToggle = () => {
    const button = panel?.querySelector("[data-action='toggle']");
    if (button) button.textContent = panel.classList.contains("oc-collapsed") ? "+" : "−";
  };
  const clampPosition = (left, top, width) => ({
    left: Math.min(Math.max(left, 80 - width), window.innerWidth - 80),
    top: Math.min(Math.max(top, 0), window.innerHeight - 44)
  });
  const applyPosition = (left, top) => {
    const { left: x, top: y } = clampPosition(left, top, panel.offsetWidth);
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
    panel.style.right = "auto";
    return { left: x, top: y };
  };
  const showBanner = () => {
    // 只在后台明确回答"未配置"时显示；hasApiKey 未知（后台无响应）时显示横幅会把已配置的用户骗去改配置
    if (!panel || !configKnown || uiConfig.hasApiKey) return;
    panel.querySelector(".oc-banner")?.remove();
    panel.querySelector(".oc-body").insertAdjacentHTML("afterbegin",
      `<div class="oc-banner">还没有配置 API Key，打分与打招呼语都不可用。<button class="oc-primary" data-action="open-options">打开选项页配置</button></div>`);
  };
  // 初始化时先问一次配置，未配置就立刻出引导横幅，而不是等用户点匹配撞上错误。
  // 查询失败（后台休眠/竞态）时绝不能显示横幅：hasApiKey 未知的"假未配置"会误导用户去改配置。
  let configKnown = false;
  const refreshUiConfig = async () => {
    try {
      const response = await send("GET_UI_CONFIG");
      uiConfig = response?.config || {};
      configKnown = true;
    } catch (_) { /* 后台不可达时保持未知，不显示横幅 */ }
    if (configKnown) showBanner();
  };
  const renderJob = () => {
    if (!panel || !currentJob) return;
    const oldHint = panel.querySelector(".oc-hint")?.value || "";
    panel.querySelector(".oc-banner")?.remove();
    panel.querySelector(".oc-body").innerHTML = `<div class="oc-fixed"><div class="oc-job-title">${esc(currentJob.title)}</div><div class="oc-meta">${esc(currentJob.company)} ${esc(currentJob.location)} ${esc(currentJob.salary)}</div><p class="oc-description">${esc(api.truncate(currentJob.description, 420))}</p><input class="oc-hint" placeholder="给打招呼语加要求：如 幽默一点 / 我经历不太匹配请生成合适的招呼" value="${esc(oldHint)}"><div class="oc-actions"><button class="oc-primary" data-action="score">开始匹配</button><button class="oc-secondary" data-action="scan">扫描本页岗位</button></div></div><div class="oc-result"></div>`;
    showBanner();
  };
  // 未识别到岗位时 body 也要渲染内容：静默胶囊只是把面板收成标题栏，
  // 用户展开后必须能拿到「扫描本页岗位」入口——否则列表页上胶囊展开是空白，扩展看起来就是坏的
  const renderEmpty = () => {
    if (!panel) return;
    const oldHint = panel.querySelector(".oc-hint")?.value || "";
    panel.querySelector(".oc-banner")?.remove();
    panel.querySelector(".oc-body").innerHTML = `<div class="oc-fixed"><div class="oc-job-title">暂未识别到岗位详情</div><p class="oc-description">进入岗位详情页后会自动显示岗位信息；在岗位列表页可点击下方按钮批量扫描。</p><input class="oc-hint" placeholder="给打招呼语加要求：如 幽默一点 / 我经历不太匹配请生成合适的招呼" value="${esc(oldHint)}"><div class="oc-actions"><button class="oc-secondary" data-action="scan">扫描本页岗位</button></div></div><div class="oc-result"></div>`;
    showBanner();
  };
  // 后台回传的错误串分成几类，各自给用户一个能点的下一步，而不是一律"请重试"。
  // 先判 401/429：服务商原始报错里也可能出现"API Key"字样，鉴权与限流要有优先级。
  const errorBanner = (errorText) => {
    const text = String(errorText || "");
    let action = "";
    if (/\b401\b/.test(text)) action = `<button class="oc-primary" data-action="open-options">去检查 API Key</button>`;
    else if (/\b429\b/.test(text)) action = `<button class="oc-secondary" data-action="open-options">降低扫描并发</button>`;
    else if (/API Key|未配置/.test(text)) action = `<button class="oc-primary" data-action="open-options">打开选项页配置</button>`;
    return `<div class="oc-error">${esc(text)}</div>${action ? `<div class="oc-error-actions">${action}</div>` : ""}`;
  };
  const showError = (errorText) => {
    panel.querySelector(".oc-result")?.insertAdjacentHTML("beforeend", errorBanner(errorText));
  };
  const showResult = (result) => {
    const color = api.scoreColor(result.score);
    panel.querySelector(".oc-result").innerHTML = `<div class="oc-score" style="--score-color:${color}"><b>${result.score}</b><span>${esc(api.verdictLabel(result.verdict))}</span></div><div class="oc-chips">${(result.matched || []).map((x) => `<span class="oc-chip good">${esc(x)}</span>`).join("")}${(result.missing || []).map((x) => `<span class="oc-chip bad">${esc(x)}</span>`).join("")}</div><p>${esc(result.reasons)}</p>${result.advice ? `<div class="oc-advice"><b>建议</b>${esc(result.advice)}</div>` : ""}<button class="oc-secondary" data-action="greet">生成打招呼语</button><button class="oc-secondary" data-action="save">保存到看板</button>`;
  };
  const renderRanked = (note = "") => {
    const result = panel.querySelector(".oc-result");
    const ranked = [...scored.values()].filter((job) => Number.isFinite(job.score)).sort((a, b) => b.score - a.score);
    rankedJobs.clear();
    ranked.forEach((job) => rankedJobs.set(String(job.id), job));
    const rows = ranked.map((job) => {
      const href = api.safeUrl(job.url);
      const main = `<span class="oc-rank-main"><strong>${esc(job.title)}</strong><small class="oc-rank-company">${esc(job.company)}</small><small class="oc-rank-salary">${esc(job.salary || "薪资待确认")}</small></span>`;
      const link = href ? `<a class="oc-rank-link" href="${esc(href)}" target="_blank" rel="noopener">${main}</a>` : `<span class="oc-rank-link">${main}</span>`;
      return `<div class="oc-rank-item">${link}<span class="oc-rank-score" style="background:${api.scoreColor(job.score)}">${job.score}分 · ${esc(api.verdictLabel(job.verdict))}</span><button class="oc-secondary oc-rank-greet" data-greet-id="${esc(job.id)}">打招呼</button><button class="oc-secondary oc-rank-greet" data-save-id="${esc(job.id)}">保存</button><div class="oc-rank-greeting"></div></div>`;
    }).join("");
    // 排名结果只活在内存里，换 URL 就清空；批量入库一次保存整页扫描结果（入库仍是显式动作，不自动写看板）
    const bulkBar = ranked.length ? `<div class="oc-rank-bulk"><span>${ranked.length} 条结果</span><button class="oc-secondary" data-action="save-all">全部保存到看板</button></div>` : "";
    if (note) {
      result.querySelectorAll(".oc-progress:not([data-scan-status])").forEach((node) => node.remove());
      const status = result.querySelector("[data-scan-status]");
      if (status) status.textContent = note;
      else result.insertAdjacentHTML("afterbegin", `<p class="oc-progress">${esc(note)}</p>`);
    }
    // 旧的批量操作条必须先移除：list.outerHTML 只替换列表本身，不移除的话
    // 每渲染一次就多叠一条"全部保存到看板"（6/12/18/20 条结果一路堆下去）
    result.querySelector(".oc-rank-bulk")?.remove();
    const list = result.querySelector(".oc-rank-list");
    if (rows) {
      result.querySelector(".oc-error")?.remove();
      const markup = `${bulkBar}<div class="oc-rank-list">${rows}</div>`;
      if (list) list.outerHTML = markup;
      else result.insertAdjacentHTML("beforeend", markup);
    } else if (!result.querySelector(".oc-error") && !result.querySelector("[data-scan-status]")) {
      result.insertAdjacentHTML("beforeend", "<p class=\"oc-error\">岗位匹配失败，请检查选项页配置和网络连接。</p>");
    }
  };
  // 点开卡片后等右侧详情面板换成新岗位的 JD；超时就保留卡片摘要，不阻断整批
  const waitForNewJd = async (previous, timeoutMs = 3000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const jd = api.readOpenJd();
      if (jd.length >= 60 && jd !== previous) return jd;
    }
    return "";
  };
  // navigate 深扫：跳到岗位详情（仅限同文档 hash 路由，如 Moka），等 JD 渲染出来读一段，再回到列表。
  // 目标不是 hash 路由或跳转失败时返回空串，回退卡片摘要
  const navigateForJd = async (job, { listHash, previous }) => {
    let target;
    try { target = new URL(job.url, location.href); } catch (_) { return ""; }
    if (target.origin !== location.origin || !target.hash) return "";
    location.hash = target.hash;
    // 等 SPA 真正切到详情路由（列表卸载）再读，过渡期里读到的可能是列表卡片上的文字
    const navDeadline = Date.now() + 4000;
    while (Date.now() < navDeadline && location.hash !== target.hash) await new Promise((resolve) => setTimeout(resolve, 100));
    if (location.hash !== target.hash) return "";
    await new Promise((resolve) => setTimeout(resolve, 300));
    const jd = await waitForNewJd(previous, 6000);
    history.back();
    const backDeadline = Date.now() + 5000;
    while (Date.now() < backDeadline && (location.hash !== listHash || !api.listHasCards())) await new Promise((resolve) => setTimeout(resolve, 200));
    // 兜底：路由没回到列表（用户中途点过别的）就强制跳回，别把用户晾在详情页
    if (location.hash !== listHash && listHash) { try { location.hash = listHash; } catch (_) { /* ignore */ } }
    return jd;
  };
  const resetListCacheIfNeeded = () => {
    const key = `${location.pathname}${location.search}`;
    if (key !== listPageKey) { listPageKey = key; scored.clear(); rankedJobs.clear(); }
  };
  async function score() {
    const result = panel.querySelector(".oc-result");
    // 列表页/首页上 extractJob 抓不到岗位，description 会是空的；这时打分只会白花一次 LLM 调用
    if (!currentJob?.description) {
      result.innerHTML = "<p>本页没有识别到岗位详情。请在岗位详情页用「开始匹配」，或在列表页点「扫描本页岗位」。</p>";
      return;
    }
    result.innerHTML = '<p class="oc-progress"></p>';
    const progress = progressTimer(result.querySelector(".oc-progress"), (seconds) => `正在匹配…（已 ${seconds}s）`);
    let response;
    try { response = await send("SCORE_JOB", { job: plainJob(currentJob) }); } catch (_) { response = { ok: false, error: "匹配请求失败，请重试" }; } finally { progress.stop(); }
    if (response.ok) { currentJob = { ...currentJob, ...response.result }; showResult(response.result); } else { result.innerHTML = errorBanner(response.error); }
  }
  async function scan() {
    resetListCacheIfNeeded();
    const result = panel.querySelector(".oc-result");
    const candidates = await api.extractJobList();
    if (!candidates.length) { result.innerHTML = "<p>本页未识别到岗位列表，请在岗位列表页使用，或用“开始匹配”匹配当前岗位。</p>"; return; }
    const configResponse = await send("GET_UI_CONFIG");
    uiConfig = configResponse?.config || {};
    const limit = Math.max(1, Number(uiConfig.maxScanConcurrency) || 5);
    const topN = Math.max(1, Number(uiConfig.scanTopN) || 20);
    candidates.forEach((job) => {
      const cached = scored.get(jobKey(job));
      if (cached) { cached.el = job.el; if (Number.isFinite(cached.score)) { job.el?.setAttribute("data-offerclaw-score", cached.score); job.el?.classList.add("offerclaw-matched"); } }
    });
    const unscored = candidates.filter((job) => !scored.has(jobKey(job)));
    const toScore = unscored.slice(0, topN);
    if (!toScore.length) {
      renderRanked(`本页已全部匹配（${scored.size} 个），向下滚动加载更多岗位后再点扫描可继续`);
      return;
    }
    // 列表卡片只有摘要，先补全 JD 再打分：策略在 extractors 的 SITES 表里——"fetch" 并发抓详情页、"click" 逐个点开卡片读同页右侧详情面板
    const strategy = api.deepScanStrategy(api.detectSite());
    if (strategy) {
      result.querySelectorAll("[data-scan-status]").forEach((node) => node.remove());
      const fetchStatus = document.createElement("p");
      fetchStatus.className = "oc-progress";
      fetchStatus.dataset.scanStatus = "true";
      result.prepend(fetchStatus);
      let fetchedDone = 0;
      const progress = progressTimer(fetchStatus, (seconds) => `正在读取岗位详情 ${fetchedDone} / ${toScore.length} …（已 ${seconds}s）`);
      if (strategy === "fetch") {
        let fi = 0;
        const fetchWorker = async () => {
          while (fi < toScore.length) {
            const idx = fi++;
            toScore[idx] = { ...toScore[idx], ...(await api.fetchJobDetail(toScore[idx])) };
            fetchedDone++; progress.update();
          }
        };
        await Promise.all(Array.from({ length: Math.min(limit, toScore.length) }, fetchWorker));
      } else if (strategy === "navigate") {
        // Moka 经典模板：卡片没 JD，详情是同页 hash 路由且点开后列表卸载——逐岗跳详情读完再回列表。
        // 新版模板卡片已自带完整 JD（≥80 字），直接跳过，页面不动
        const listHash = location.hash;
        let lastNavJd = "";
        for (let i = 0; i < toScore.length; i++) {
          const job = toScore[i];
          if ((job.description || "").length >= 80) { fetchedDone++; progress.update(); continue; }
          const jd = await navigateForJd(job, { listHash, previous: lastNavJd });
          if (jd) { toScore[i] = { ...job, description: jd }; lastNavJd = jd; }
          fetchedDone++; progress.update();
        }
        // 跳转过程中列表被重渲染过：重新认领卡片元素，匹配角标才能标到可见的卡片上
        const refreshed = await api.extractJobList();
        for (const job of toScore) {
          const match = refreshed.find((item) => jobKey(item) === jobKey(job));
          if (match) job.el = match.el;
        }
      } else {
        // 面板初始就停在某张卡片上，先点最后一张让它挪开，这样后续每次点击都能靠“JD 变化”确认读到的是当前卡片
        const openCard = (card) => { if (!card) return false; card.scrollIntoView?.({ block: "center" }); try { card.click(); return true; } catch (_) { return false; } };
        if (toScore.length > 1 && openCard(toScore[toScore.length - 1].el)) await waitForNewJd(api.readOpenJd());
        let lastJd = api.readOpenJd();
        for (let i = 0; i < toScore.length; i++) {
          if (openCard(toScore[i].el)) {
            const jd = await waitForNewJd(lastJd);
            if (jd) { toScore[i] = { ...toScore[i], description: jd }; lastJd = jd; }
          }
          fetchedDone++; progress.update();
        }
      }
      progress.stop();
    }
    const previousList = result.querySelector(".oc-rank-list");
    if (previousList) renderRanked();
    else result.innerHTML = "";
    result.querySelectorAll("[data-scan-status]").forEach((node) => node.remove());
    let done = 0;
    let failedCount = 0;
    let lastError = "";
    const chunks = [];
    for (let i = 0; i < toScore.length; i += 6) chunks.push(toScore.slice(i, i + 6));
    const status = document.createElement("p");
    status.className = "oc-progress";
    status.dataset.scanStatus = "true";
    result.prepend(status);
    const progress = progressTimer(status, (seconds) => `正在匹配 ${done} / ${toScore.length} …（已 ${seconds}s）`);
    let next = 0;
    const worker = async () => {
      while (next < chunks.length) {
        const chunk = chunks[next++];
        let response;
        try { response = await send("SCORE_JOBS", { jobs: chunk.map(plainJob) }); } catch (error) { response = { ok: false, error: error?.message || "匹配请求失败，请重试" }; }
        if (response.ok && Array.isArray(response.results)) {
          chunk.forEach((job, index) => {
            const match = response.results[index];
            if (!match || !Number.isFinite(match.score)) { failedCount++; return; }
            const cached = { ...plainJob(job), ...match, el: job.el };
            scored.set(jobKey(job), cached);
            job.el?.setAttribute("data-offerclaw-score", match.score);
            job.el?.classList.add("offerclaw-matched");
            done++;
          });
          // scoreJobs 对拿不到分的岗位会逐个补打分，失败原因按索引放在 errors 里
          lastError = Object.values(response.errors || {})[0] || lastError;
        } else {
          failedCount += chunk.length;
          lastError = response.error || lastError;
        }
        renderRanked();
        progress.update();
      }
    };
    try { await Promise.all(Array.from({ length: Math.min(limit, chunks.length) }, worker)); } finally { progress.stop(); }
    // done 只统计真正拿到分数的岗位：按批长度累加会在全部失败时也报“已完成”，把后台的真实错误藏起来
    if (failedCount) {
      status.textContent = `已匹配 ${done} / ${toScore.length}，${failedCount} 个失败`;
      showError(lastError || "岗位匹配失败，请检查选项页配置和网络连接。");
    } else {
      status.textContent = `已完成匹配 ${done} / ${toScore.length}`;
    }
    renderRanked();
  }
  api.initPanel = (job) => {
    currentJob = job;
    const saved = panelState.load();
    panel = document.createElement("aside");
    panel.id = "offerclaw-root";
    panel.innerHTML = `<div class="oc-header" title="按住可拖动到任意位置"><strong><span aria-hidden="true">⠿ </span>OfferClaw</strong><span class="oc-header-buttons"><button data-action="toggle" title="折叠/展开">−</button><button data-action="close" title="关闭面板（下次进入岗位页会再次出现）">×</button></span></div><div class="oc-body"></div>`;
    document.documentElement.appendChild(panel);
    if (saved.collapsed) panel.classList.add("oc-collapsed");
    applyToggle();
    if (Number.isFinite(saved.left) && Number.isFinite(saved.top)) applyPosition(saved.left, saved.top);
    // 列表页/首页上第一次渲染也要走静默胶囊，不能先闪一个"未识别到岗位"的整面板再等 updatePanelJob 收
    setSilent(isSilentJob(job));
    if (!isSilentJob(job)) renderJob();
    refreshUiConfig();
    // 标题栏和顶部岗位信息区可拖拽；描述/结果区排除，保留文字选择和滚动
    panel.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || event.target.closest("button, input, textarea, select, a, .oc-description, .oc-result")) return;
      event.preventDefault();
      const rect = panel.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = "auto";
      const move = (moveEvent) => {
        // 任意位置可停，仅保证标题栏留在可视区内，面板不会被整个拖出屏幕
        applyPosition(moveEvent.clientX - offsetX, moveEvent.clientY - offsetY);
      };
      const stop = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", stop);
        persistState({ left: parseFloat(panel.style.left || "0"), top: parseFloat(panel.style.top || "0") });
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", stop);
    });
    panel.addEventListener("click", async (event) => {
      const copyButton = event.target.closest("[data-copy],[data-copy-id]");
      if (copyButton) {
        const copyKey = `copy:${copyButton.dataset.copyId || "main"}`;
        if (busy.has(copyKey)) return;
        busy.add(copyKey); copyButton.disabled = true; copyButton.textContent = "复制中…";
        try {
          const area = copyButton.closest(".oc-inline-greeting")?.querySelector("textarea") || panel.querySelector(".oc-greeting");
          await navigator.clipboard.writeText(area.value);
          copyButton.textContent = "已复制";
        } catch (_) { copyButton.textContent = "复制失败"; }
        finally { busy.delete(copyKey); copyButton.disabled = false; setTimeout(() => { if (copyButton.isConnected) copyButton.textContent = "复制"; }, 1200); }
        return;
      }
      const rankGreet = event.target.closest("[data-greet-id]");
      if (rankGreet) {
        const id = String(rankGreet.dataset.greetId);
        const busyKey = `greet:${id}`;
        if (busy.has(busyKey)) return;
        const job = rankedJobs.get(id);
        const rankRow = rankGreet.closest(".oc-rank-item");
        if (!job || !rankRow) return;
        busy.add(busyKey); rankGreet.disabled = true; rankGreet.textContent = "生成中…";
        try {
          const response = await send("GENERATE_GREETING", { job: plainJob(job), hint: getHint() });
          const target = rankRow.querySelector(".oc-rank-greeting");
          target.innerHTML = response.ok ? `<div class="oc-inline-greeting"><textarea>${esc(response.text)}</textarea><button class="oc-secondary" data-copy-id="${esc(id)}">复制</button></div>` : errorBanner(response.error);
        } catch (error) { if (rankRow.isConnected) rankRow.querySelector(".oc-rank-greeting").innerHTML = errorBanner(error.message || "生成失败，请重试"); }
        finally { busy.delete(busyKey); rankGreet.disabled = false; rankGreet.textContent = "打招呼"; }
        return;
      }
      const rankSave = event.target.closest("[data-save-id]");
      if (rankSave) {
        const id = String(rankSave.dataset.saveId);
        const busyKey = `save:${id}`;
        if (busy.has(busyKey)) return;
        const job = rankedJobs.get(id);
        if (!job) return;
        busy.add(busyKey); rankSave.disabled = true; rankSave.textContent = "保存中…";
        try {
          const response = await send("SAVE_JOB", { job: { ...plainJob(job), status: "saved" } });
          if (response.ok) { rankSave.textContent = "已保存"; return; }
          rankSave.textContent = "保存失败";
        } catch (_) { rankSave.textContent = "保存失败"; }
        finally { busy.delete(busyKey); if (rankSave.textContent !== "已保存") { rankSave.disabled = false; setTimeout(() => { if (rankSave.isConnected && rankSave.textContent === "保存失败") rankSave.textContent = "保存"; }, 1500); } }
        return;
      }
      const button = event.target.closest("button[data-action]");
      const action = button?.dataset.action;
      if (!action) return;
      if (action === "close") {
        // "赶不走它"是扩展被卸载的常见原因；关闭后本站会话内不再出现，刷新/换页后回到默认
        panel.remove();
        panel = null;
        closed = true;
        persistState({ collapsed: false });
        return;
      }
      if (action === "toggle") {
        // 静默胶囊上的 − 直接展开：此时 body 已被 CSS 隐藏，再走 oc-collapsed 切换会让用户连点两次才展开，
        // 第一次看似"没反应"。非静默时才是普通的折叠/展开。
        if (panel.classList.contains("oc-silent") && !panel.classList.contains("oc-collapsed")) {
          panel.classList.remove("oc-silent");
          const body = panel.querySelector(".oc-body");
          if (body) {
            body.style.display = "";
            // 兜底：body 为空（旧版本残留 DOM、异常中断）时按当前岗位重渲染，展开绝不能是空白
            if (!body.querySelector(".oc-result")) { if (isSilentJob(currentJob)) renderEmpty(); else renderJob(); }
          }
          showBanner();
          applyToggle();
          persistState({ collapsed: false });
          return;
        }
        const collapsed = panel.classList.toggle("oc-collapsed");
        // 静默胶囊展开时必须同时清掉 oc-silent 与内联 display，否则 body 仍被隐藏、面板看似展开却空白
        if (!collapsed && panel.classList.contains("oc-silent")) {
          panel.classList.remove("oc-silent");
          const body = panel.querySelector(".oc-body");
          if (body) body.style.display = "";
          showBanner();
        }
        applyToggle();
        persistState({ collapsed });
        return;
      }
      if (action === "open-options") {
        try { await send("OPEN_OPTIONS"); } catch (_) { /* 后台不可达时按钮无效果，让用户从工具栏图标进入 */ }
        return;
      }
      if (busy.has(action)) return;
      busy.add(action);
      const originalLabel = button.textContent;
      button.disabled = true; button.textContent = loadingLabels[action] || originalLabel;
      let keepDisabled = false;
      try {
        if (action === "score") await score();
        if (action === "scan") await scan();
        if (action === "greet") {
          const response = await send("GENERATE_GREETING", { job: plainJob(currentJob), hint: getHint() });
          const area = panel.querySelector(".oc-result");
          if (response.ok) area.insertAdjacentHTML("beforeend", `<div class="oc-inline-greeting"><textarea class="oc-greeting">${esc(response.text)}</textarea><button data-copy class="oc-secondary">复制</button></div>`);
          else showError(response.error);
        }
        if (action === "save") {
          const response = await send("SAVE_JOB", { job: { ...plainJob(currentJob), status: "saved" } });
          if (response.ok) { button.textContent = "已保存"; keepDisabled = true; } else showError(response.error);
        }
        if (action === "save-all") {
          // 逐条串行：SAVE_JOB 要按 url 去重合并，并发写会互相覆盖
          let saved = 0;
          for (const job of rankedJobs.values()) {
            const response = await send("SAVE_JOB", { job: { ...plainJob(job), status: "saved" } });
            if (response.ok) saved++;
          }
          button.textContent = `已保存 ${saved} 条`;
          keepDisabled = true;
        }
      } catch (error) { panel.querySelector(".oc-result").innerHTML = errorBanner(error.message || "操作失败，请重试"); }
      finally { if (!keepDisabled) { button.disabled = false; button.textContent = originalLabel; } busy.delete(action); }
    });
  };
  api.isPanelClosed = () => closed;
  // 未识别到岗位时收成一个只有标题栏的胶囊：首页/登录页/尚未点开卡片的列表页上"看似抓到了岗位"
  // 的全是噪音，整面板渲染只会误导；胶囊仍可展开（− 按钮或拖动），避免用户以为扩展坏了。
  const isSilentJob = (job) => !job?.title || job.title === "未识别到岗位";
  const setSilent = (silent) => {
    if (!panel) return;
    panel.classList.toggle("oc-silent", Boolean(silent));
    const body = panel.querySelector(".oc-body");
    if (body) body.style.display = silent ? "none" : "";
    if (!silent) showBanner();
  };
  api.updatePanelJob = (job) => {
    currentJob = job;
    if (!panel) return;
    const silent = isSilentJob(job);
    setSilent(silent);
    // 静默时同样刷新 body：胶囊展开后要能看到扫描入口，且换页后旧内容不能残留
    if (silent) { renderEmpty(); return; }
    renderJob();
    showBanner();
  };
})(globalThis);
