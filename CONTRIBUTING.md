# 贡献指南

欢迎提 issue 和 PR。代码、注释、UI 文案和提交说明都用中文（commit subject 用英文亦可，跟现有历史一致）。参与前请先阅读 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 本地运行

没有构建步骤，也不需要 `npm install`：

1. 克隆仓库。
2. Chrome 打开 `chrome://extensions`，开启右上角「开发者模式」。
3. 点「加载已解压的扩展程序」，选择仓库根目录。
4. 改完代码回到 `chrome://extensions` 点扩展卡片上的刷新按钮。改 background（service worker）后必须刷新；改 content script 后还要刷新所在的招聘站页面。

要跑起来需要你自己的 LLM API Key（硅基流动、DeepSeek、OpenAI、Anthropic 等，见 README）。

## 测试

用 Node 直接跑，全部 mock 掉 `chrome.*` 与 `fetch`，不需要真的 Key：

```bash
node scripts/test-messaging.mjs      # 消息路由与权限边界
node scripts/test-prompts.mjs        # 提示词内容断言
node scripts/test-scoring.mjs        # 打分编排（简历摘要缓存、结果归一化）
node scripts/test-llm.mjs            # openai / anthropic 两协议与错误映射
node scripts/test-util.mjs           # CSV 导出与链接协议校验
node scripts/test-resume-parse.mjs [简历.pdf]
```

改 `src/background/` 下任何文件都请把相关脚本跑一遍。**content script 与 popup/options 的 DOM 层没有自动化测试**（本项目不引入 jsdom），改 `panel.js`／`popup.js`／`options.html` 后请在真实招聘站上人工验证，并在 PR 里说明你验证了哪些页面。

## 加一个招聘站适配器

这是最欢迎的贡献类型。v0.2 起站点配置集中在 `src/content/extractors.js` 的 `SITES` 表，加站基本是加一条数据：

1. `SITES` 表加一个条目：`domain`（域名正则）、`title`/`company`/`description`（详情页选择器数组，`first()` 按顺序取第一个有文字的，`largest()` 是类名失配兜底）、`cards`（列表卡片选择器）、`deepScan`（深度抓取策略：`"fetch"` 抓同源详情页 / `"click"` 点卡片读同页详情面板 / `""` 不深度抓取）。可选钩子：`cardLink`（卡片里岗位链接的选择器）、`cardUrl(el)`（从埋点等属性拼岗位 URL 的函数）、`cardCompany`（列表卡片内精确公司名选择器）、`companyFrom()`（特殊的公司名来源，如 BOSS 从 `document.title` 取）、`cardExtra`（额外卡片启发式）。
2. `src/background/prompts.js` 的 `FULL_JD_SITES`：只有扫描时能读到完整 JD 的站点才加进去（决定批量打分的 JD 限长）。
3. `manifest.json` 的 `host_permissions` 与 `content_scripts.matches`。
4. `src/options/options.html` 与 `options.js` 的站点开关 checkbox。
5. 运行 `node scripts/test-sites.mjs`，确认域名识别、manifest 注入、选项开关与批量 JD 限长都被测试覆盖。

打不开选择器的站点也可以考虑不做完整适配——generic 分支（JSON-LD `JobPosting` + ATS 选择器）已经覆盖了很多海外 ATS 页面，用户可在看板点「在本页启用」按次注入；只有在需要静态注入、列表扫描或特殊字段提取（如 51job 的埋点 URL）时才值得加表条目。

请在 PR 里附上你实际测过的页面类型（详情页／列表页）和截图。

两条硬约束：

- **不要为了拿数据去绕反爬。** 51job 详情页受 WAF 保护，程序化访问会弹滑动验证，所以我们明确不做它的深度抓取（见 `AGENTS.md`）。遇到验证码、需要伪造请求头或高频轮询才能拿到的数据，就不做。
- **不做自动投递、自动填表、群发。** 这是产品红线，也是应用商店审核的高风险项。

## 提交 PR 前

- 读一遍 `AGENTS.md` 的「安全红线」，特别是：API Key 与简历全文不能进页面上下文、页面来的 URL 写进 `href` 前要过 `OfferClaw.safeUrl()`、新增消息类型默认不进 `PAGE_ALLOWED` 白名单。
- 架构约定见 `DESIGN.md`；后续路线见 `docs/ROADMAP.md`。
- 保持改动聚焦，别顺手重排无关代码的格式。
