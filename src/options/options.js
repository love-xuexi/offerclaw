const $ = (s) => document.querySelector(s);
const form = $("#form");
let config;
// 服务商预设：选某项即填入对应 Base URL/模型/协议；Anthropic 走独立协议，其余 OpenAI 兼容
const PROVIDERS = {
  siliconflow: { protocol: "openai", baseUrl: "https://api.siliconflow.cn/v1", model: "deepseek-ai/DeepSeek-V4-Flash" },
  zhipu: { protocol: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.6" },
  bailian: { protocol: "openai", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  qwen: { protocol: "openai", baseUrl: "https://chat.qwen.ai/api/v1", model: "qwen3-235b-a22b" },
  minimax: { protocol: "openai", baseUrl: "https://api.minimaxi.com/v1", model: "MiniMax-M2" },
  deepseek: { protocol: "openai", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  mimo: { protocol: "openai", baseUrl: "", model: "" },
  openai: { protocol: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1" },
  anthropic: { protocol: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-5" },
  custom: { protocol: "openai", baseUrl: "", model: "" }
};
const send = async (message) => {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, error: "后台无响应，请在扩展页点击刷新后重试：" + (error?.message || "") };
  }
};
const fields = (names, source) => Object.fromEntries(names.map((name) => [name, source[name] ?? ""]));
const setMessage = (text) => { $("#message").textContent = text; };
// 空输入框的 Number("") 是 0，直接落库会把温度悄悄变成 0；同时把并发/上限夹回文档里写明的范围
const clampNumber = (value, fallback, min, max) => {
  const n = String(value ?? "").trim() === "" ? NaN : Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};
const readForm = () => {
  const data = Object.fromEntries(new FormData(form));
  return {
    profile: fields(["resumeText", "targetRoles", "skills", "preferredCities", "domain", "education", "certificates", "expectedSalary", "jobType", "extraNotes"], data),
    config: {
      ...config,
      ...fields(["provider", "baseUrl", "apiKey", "model"], data),
      protocol: (PROVIDERS[data.provider] || PROVIDERS.custom).protocol,
      temperature: clampNumber(data.temperature, 0.3, 0, 2),
      maxScanConcurrency: clampNumber(data.maxScanConcurrency, 5, 1, 10),
      scanTopN: clampNumber(data.scanTopN, 20, 1, 100),
      enabledSites: {
        zhipin: form.zhipin.checked,
        shixiseng: form.shixiseng.checked,
        job51: form.job51.checked,
        zhaopin: form.zhaopin.checked,
        nowcoder: form.nowcoder.checked,
        yingjiesheng: form.yingjiesheng.checked,
        linkedin: form.linkedin.checked,
        greenhouse: form.greenhouse.checked,
        lever: form.lever.checked
      }
    }
  };
};
// API Key 会随请求头发出去，明文 http 只放给本机自建服务（Ollama / LM Studio 之类）
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const ensureOriginPermission = async (baseUrl) => {
  let url;
  try { url = new URL(String(baseUrl || "")); } catch (_) { return { ok: false, error: "Base URL 格式不正确，请填写完整地址（含 https://）" }; }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    return { ok: false, error: "Base URL 必须用 https（仅 localhost / 127.0.0.1 允许 http），否则 API Key 会明文发送" };
  }
  // 匹配模式里不能带端口（`http://localhost:11434/*` 会被判成非法 origin），按主机名申请即可覆盖所有端口
  const pattern = `${url.protocol}//${url.hostname}/*`;
  // 不先 contains 再 request：中间多一次 await 可能丢掉用户手势，而 request 在已授权时会直接返回 true 且不弹窗
  let ok = false;
  try { ok = await chrome.permissions.request({ origins: [pattern] }); }
  catch (error) { return { ok: false, error: `申请域名权限失败（${pattern}）：${error?.message || "请在点击按钮后立即确认授权弹窗"}` }; }
  if (!ok) return { ok: false, error: `需要访问 LLM 接口域名（${pattern}）的权限，用户拒绝后无法进行保存或测试连接` };
  return { ok: true };
};
async function load() {
  const [p, c] = await Promise.all([send({ type: "GET_PROFILE" }), send({ type: "GET_CONFIG" })]);
  config = c.config || {};
  const data = { ...(p.profile || {}), ...config };
  for (const el of form.elements) if (el.name) { if (el.type === "checkbox") el.checked = data.enabledSites?.[el.name] !== false; else el.value = data[el.name] ?? ""; }
  if (!PROVIDERS[form.provider.value]) form.provider.value = "custom";
}
form.provider.addEventListener("change", () => {
  const preset = PROVIDERS[form.provider.value] || PROVIDERS.custom;
  // 空预设（mimo/custom 没有公认端点）必须清空：保留上一家的 Base URL 会让用户以为切换成功，实际把新 Key 发到旧端点
  form.baseUrl.value = preset.baseUrl;
  form.model.value = preset.model;
});
const persistCurrentForm = async () => {
  const { profile, config: nextConfig } = readForm();
  await send({ type: "SET_PROFILE", profile });
  await send({ type: "SET_CONFIG", config: nextConfig });
  config = nextConfig;
  return { profile, config: nextConfig };
};
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("正在请求权限…");
  const { config: nextConfig } = readForm();
  const permission = await ensureOriginPermission(nextConfig.baseUrl);
  if (!permission.ok) { setMessage(permission.error); return; }
  await persistCurrentForm();
  setMessage("已保存");
  setTimeout(() => setMessage(""), 2000);
});
$("#test").addEventListener("click", async () => {
  setMessage("正在请求权限…");
  const { config: nextConfig } = readForm();
  const permission = await ensureOriginPermission(nextConfig.baseUrl);
  if (!permission.ok) { setMessage(permission.error); return; }
  setMessage("正在保存并测试…");
  await persistCurrentForm();
  const response = await send({ type: "SCORE_JOB", job: { title: "连接测试", company: "", description: "请仅返回有效评分。" } });
  setMessage(response.ok ? "连接成功" : response.error);
});
$("#resumeFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  setMessage(`正在解析「${file.name}」…`);
  try {
    const text = await OfferClaw.parseResumeFile(file);
    form.resumeText.value = text;
    setMessage(`已导入「${file.name}」（${text.length} 字），请核对后点击保存`);
  } catch (error) {
    setMessage("导入失败：" + (error?.message || "未知错误"));
  }
});
load();
