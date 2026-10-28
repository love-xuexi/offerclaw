const normalizeUrl = (baseUrl) => String(baseUrl || "").replace(/\/+$/, "");
// 服务商的报错原文会一路显示到页面面板里；先抹掉密钥本身和形似密钥的串，避免 Key 落进 DOM（DESIGN.md §7）
const redactKey = (text, apiKey) => {
  const safe = apiKey && String(apiKey).length >= 8 ? String(text).split(String(apiKey)).join("***") : String(text);
  return safe.replace(/\b(?:sk|api[-_]?key|token)[-_][A-Za-z0-9]{12,}/gi, "***");
};
// 推理强度参数适配：兼容 Gemini、DeepSeek、MiMo、GLM（智谱）、OpenAI 及 SiliconFlow
function buildOpenAiReasoningParams(reasoningEffort) {
  if (!reasoningEffort || reasoningEffort === "default") return {};
  if (reasoningEffort === "off") {
    return {
      enable_thinking: false,
      thinking: { type: "disabled" },
      thinking_budget: 0
    };
  }
  const effortMap = { low: "low", medium: "medium", high: "high", max: "high" };
  const effort = effortMap[reasoningEffort] || "medium";
  return {
    enable_thinking: true,
    reasoning_effort: effort,
    thinking: { type: "enabled" }
  };
}

function openaiBody({ model, messages, temperature, response_format, reasoningEffort }) {
  const reasoningParams = buildOpenAiReasoningParams(reasoningEffort);
  return JSON.stringify({
    model,
    messages,
    temperature,
    ...(response_format ? { response_format } : {}),
    ...reasoningParams
  });
}
// Anthropic 不是 OpenAI 协议：system 是顶层参数、max_tokens 必填、无 response_format（靠提示词 + 正则兜底解析）
function anthropicBody({ model, messages, temperature, max_tokens = 4096, reasoningEffort }) {
  let system = "";
  const chat = [];
  for (const m of messages) {
    if (m.role === "system") system += (system ? "\n\n" : "") + m.content;
    else chat.push({ role: m.role, content: String(m.content) });
  }
  let thinking;
  if (reasoningEffort === "off") {
    thinking = { type: "disabled" };
  } else if (["low", "medium", "high", "max"].includes(reasoningEffort)) {
    const budgetMap = { low: 1024, medium: 2048, high: 4096, max: 8192 };
    thinking = { type: "enabled", budget_tokens: budgetMap[reasoningEffort] || 2048 };
  }
  return JSON.stringify({
    model,
    max_tokens,
    ...(system ? { system } : {}),
    messages: chat,
    ...(temperature != null ? { temperature } : {}),
    ...(thinking ? { thinking } : {})
  });
}
export async function chatCompletion({ protocol = "openai", baseUrl, apiKey, model, messages, temperature, response_format, reasoningEffort = "off", timeoutMs = 90000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const base = normalizeUrl(baseUrl);
  try {
    let url, headers, body;
    if (protocol === "anthropic") {
      url = base + "/v1/messages";
      headers = { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" };
      body = anthropicBody({ model, messages, temperature, reasoningEffort });
    } else {
      url = base + "/chat/completions";
      headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
      body = openaiBody({ model, messages, temperature, response_format, reasoningEffort });
    }
    const response = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      let message = redactKey(text, apiKey).slice(0, 180);
      if (response.status === 401) message = "API Key 无效或未授权";
      else if (response.status === 429) message = "请求过于频繁，请稍后重试";
      return { ok: false, error: `LLM 请求失败（${response.status}）：${message}` };
    }
    try {
      const data = JSON.parse(text);
      const content = protocol === "anthropic" ? (data.content?.[0]?.text || "") : (data.choices?.[0]?.message?.content || "");
      return { ok: true, content };
    } catch (_) { return { ok: false, error: "LLM 返回格式无法解析" }; }
  } catch (error) {
    return { ok: false, error: error.name === "AbortError" ? `LLM 请求超时（${Math.round(timeoutMs / 1000)} 秒）` : "网络连接失败，请检查 Base URL 和网络" };
  } finally { clearTimeout(timer); }
}
