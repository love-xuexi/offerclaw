// LLM 协议分发测试：node scripts/test-llm.mjs
// mock 全局 fetch，验证 openai / anthropic 两协议分支的 URL、headers、请求体、响应解析与错误映射
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import path from "node:path";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chatCompletion } = await import(pathToFileURL(path.join(repo, "src/background/llm.js")));

let failed = 0;
const check = (label, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`); if (!cond) failed++; };

let lastCall = null;
function mockFetch(status, body) {
  globalThis.fetch = async (url, opts) => {
    lastCall = { url: String(url), opts };
    return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
  };
}
const messages = [{ role: "system", content: "你是顾问" }, { role: "user", content: "评这个岗位" }];

// 1) OpenAI 协议 - 硅基流动：URL、Bearer、response_format、enable_thinking
mockFetch(200, { choices: [{ message: { content: '{"score":80}' } }] });
await chatCompletion({ protocol: "openai", baseUrl: "https://api.siliconflow.cn/v1", apiKey: "sk-test", model: "deepseek-ai/DeepSeek-V4-Flash", messages, temperature: 0.3, response_format: { type: "json_object" }, timeoutMs: 5000 });
check("openai URL=/chat/completions", lastCall.url.endsWith("/chat/completions"), lastCall.url);
check("openai Bearer 头", lastCall.opts.headers.Authorization === "Bearer sk-test");
const oBody = JSON.parse(lastCall.opts.body);
check("openai body 含 response_format", JSON.stringify(oBody.response_format) === JSON.stringify({ type: "json_object" }));
check("openai 硅基流动关思维链", oBody.enable_thinking === false);
check("openai body 含 model/messages/temperature", oBody.model && Array.isArray(oBody.messages) && oBody.temperature === 0.3);

// 2) OpenAI 协议 - 非硅基流动（DeepSeek）：不发 enable_thinking
mockFetch(200, { choices: [{ message: { content: "ok" } }] });
await chatCompletion({ protocol: "openai", baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-d", model: "deepseek-chat", messages, response_format: { type: "json_object" }, timeoutMs: 5000 });
const dBody = JSON.parse(lastCall.opts.body);
check("openai 非硅基流动不发 enable_thinking", !("enable_thinking" in dBody));
mockFetch(200, { choices: [{ message: { content: "hello-world" } }] });
const res2 = await chatCompletion({ protocol: "openai", baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-d", model: "deepseek-chat", messages, response_format: { type: "json_object" }, timeoutMs: 5000 });
check("openai 响应解析 content", res2.ok && res2.content === "hello-world");

// 3) Anthropic 协议：URL、headers、system 提顶层、max_tokens、无 response_format
mockFetch(200, { content: [{ type: "text", text: '{"score":90}' }] });
const resA = await chatCompletion({ protocol: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "sk-ant", model: "claude-sonnet-4-5", messages, temperature: 0.3, response_format: { type: "json_object" }, timeoutMs: 5000 });
check("anthropic ok", resA.ok && resA.content === '{"score":90}');
check("anthropic URL=/v1/messages", lastCall.url.endsWith("/v1/messages"), lastCall.url);
const h = lastCall.opts.headers;
check("anthropic x-api-key 头", h["x-api-key"] === "sk-ant");
check("anthropic-version 头", h["anthropic-version"] === "2023-06-01");
check("anthropic 浏览器直连头", h["anthropic-dangerous-direct-browser-access"] === "true");
check("anthropic 无 Bearer", !h.Authorization);
const aBody = JSON.parse(lastCall.opts.body);
check("anthropic system 在顶层", typeof aBody.system === "string" && aBody.system === "你是顾问");
check("anthropic messages 不含 system", aBody.messages.every((m) => m.role !== "system"));
check("anthropic max_tokens 必填", aBody.max_tokens === 4096);
check("anthropic 无 response_format", !("response_format" in aBody));
check("anthropic model 正确", aBody.model === "claude-sonnet-4-5");

// 4) 401 / 429 错误映射
mockFetch(401, '{"error":"invalid"}');
const r401 = await chatCompletion({ protocol: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "x", model: "gpt-4.1", messages, timeoutMs: 5000 });
check("401 映射中文", !r401.ok && r401.error.includes("API Key 无效或未授权"));
mockFetch(429, '{"error":"rate"}');
const r429 = await chatCompletion({ protocol: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "x", model: "claude-sonnet-4-5", messages, timeoutMs: 5000 });
check("429 映射中文", !r429.ok && r429.error.includes("请求过于频繁"));

// 5) 超时：fetch 抛 AbortError
globalThis.fetch = async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; };
const rTimeout = await chatCompletion({ protocol: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "x", model: "gpt-4.1", messages, timeoutMs: 50 });
check("超时映射中文", !rTimeout.ok && rTimeout.error.includes("请求超时"));

// 6) 其他状态码会把服务商报错原文带回 UI，密钥必须先被抹掉（错误串最终会进页面 DOM）
const KEY = "sk-abcdefghijklmnop1234567890";
mockFetch(400, `{"error":"bad request for ${KEY}"}`);
const r400 = await chatCompletion({ protocol: "openai", baseUrl: "https://api.openai.com/v1", apiKey: KEY, model: "gpt-4.1", messages, timeoutMs: 5000 });
check("报错原文不含 API Key", !r400.ok && !r400.error.includes(KEY), r400.error);
check("报错仍保留状态码与上下文", r400.error.includes("400") && r400.error.includes("bad request"));

console.log(failed ? `\n${failed} 项失败` : "\n全部通过");
process.exit(failed ? 1 : 0);
