# OfferClaw — 设计文档 (v0.1.0)

> 一个专注「找工作」的 AI 助手浏览器插件（对标 OpenClaw / Simplify / JobRight，但聚焦求职）。
> 帮用户在浏览岗位时自动判断「这个岗位值不值得投」，并辅助投递（生成打招呼语 / 求职信、记录投递）。

## 0. 目标用户与场景

主用户画像：
- 在校生 / 应届生 / 有经验的社招求职者，需要在多个招聘站之间反复比对岗位。
- 目标：把精力集中在真正对口的岗位上，而不是靠海投碰运气。
- 痛点：手动搜岗位 + 逐个读 JD 判断是否合适太累；投出去反馈少，不知道差距在哪。

> v0.2 起评分提示词按选项页的「目标领域」选择领域侧写（`DOMAIN_PROFILES`，AI/软件沿用原有维度，另有产品运营、金融财会、设计、医疗、销售、制造、教育、HR 等八个领域 + 通用兜底），评分锚点措辞领域无关，任何行业共用同一把分数标尺。

核心场景：
1. 用户在招聘网站浏览岗位详情页 → OfferClaw 自动抓取 JD，结合用户简历/画像，用 LLM 打「匹配度分数 + 投/不投建议 + 理由」，显示在页面右侧悬浮面板。
2. 在岗位**列表/搜索结果页** → 一键批量扫描，给每条岗位打分并高亮高匹配项。
3. 决定投递时 → 一键生成**定制打招呼语 / 求职信**（结合 JD 与简历亮点），并把岗位记录进「投递看板」。
4. 用户在 popup 看板里查看已扫描/已投岗位、统计、导出 CSV。

## 1. 技术选型

- **Chrome Manifest V3 扩展**，纯原生 JS（无构建步骤），便于本地 `加载已解压的扩展程序` 直接使用、易交付。
- LLM：经 `llm.js` 按 `protocol` 字段分发，支持 OpenAI 兼容接口（默认硅基流动，另含智谱/百炼/通义/MiniMax/DeepSeek/小米 MiMo/OpenAI 等）与 Anthropic Messages API（独立协议，端点 `/v1/messages`、`x-api-key`+`anthropic-version`、`system` 顶层、`max_tokens` 必填、无 `response_format` 靠提示词+正则兜底）。服务商预设与协议在 `src/options/options.js` 的 `PROVIDERS` 表，改预设要同步改这里。API Key 存 `chrome.storage.local`，仅在 background service worker 中使用（不进页面上下文）。
- 存储：`chrome.storage.local`（画像、配置、岗位记录）。
- 目标站点适配器：站点配置表在 `src/content/extractors.js` 的 `SITES`（域名正则 + 详情页/列表选择器 + 深度抓取策略），当前覆盖 BOSS 直聘 `zhipin.com`、实习僧 `shixiseng.com`、51job 前程无忧 `51job.com`、智联招聘 `zhaopin.com`、牛客网 `nowcoder.com`、应届生求职网 `yingjiesheng.com`、北森 ATS `zhiye.com`、Moka ATS `mokahr.com`、飞书招聘 `jobs.feishu.cn`、LinkedIn `linkedin.com`、Greenhouse `greenhouse.io`、Lever `lever.co`。**加一个站 = `SITES` 表加一个条目 + manifest 的 matches + 选项页 checkbox**（列表公司名需要精确子选择器时可加 `cardCompany`）（能读到完整 JD 的还要进 `prompts.js` 的 `FULL_JD_SITES`）。`generic` 分支用于企业官网等任意页面：优先解析 schema.org 的 `JobPosting` JSON-LD 结构化数据，配 ATS 风格选择器兜底；manifest 只静态注入表内站点，`generic` 需要**用户在看板点「在本页启用」**经 `chrome.scripting.executeScript` 按次注入（`activeTab` 授权，见 P4 一节）。

## 2. 目录结构

```
offerclaw/
  manifest.json
  README.md
  DESIGN.md
  LICENSE                # 项目 MIT；第三方组件许可见各自目录
  icons/ icon16.png icon48.png icon128.png
  src/
    common/
      messages.js      # 消息类型常量 (导出到 window / self)
      util.js          # 通用工具（分数->颜色、截断、日期、csv、uuid）
    background/
      service-worker.js# 消息路由 + 生命周期
      storage.js       # profile/config/jobs 读写封装
      llm.js           # OpenAI 兼容 chat 客户端（fetch, 超时, 错误规整）
      prompts.js       # 匹配打分 & 打招呼语 prompt 模板
      scoring.js       # 编排：取 profile+config -> 调 llm -> 解析 JSON 结果
    content/
      content.js       # 入口：识别站点、注入面板、监听 URL 变化
      extractors.js     # 站点适配器 + 通用提取器，输出统一 Job 结构
      panel.js         # 悬浮面板 UI（打分、理由、生成打招呼、保存）
      panel.css
    options/
      options.html/js/css  # 简历/画像 + LLM 配置 + 站点开关
      parse-resume.js      # 简历文件解析：PDF 走 vendor pdf.js，.docx 用原生 ZIP + DecompressionStream
    vendor/pdfjs/          # 本地打包 pdf.js（MV3 禁止远程代码）+ cmaps/（中文 CID 字体必需）
    popup/
      popup.html/js/css    # 投递看板：列表/筛选/统计/导出/打开选项页
```

## 3. 数据模型

```js
// Profile（用户画像/简历）
{
  resumeText: string,          // 简历全文（纯文本，粘贴或从 PDF/Word 文件导入）
  domain: string,              // 目标领域：ai/product/finance/design/medical/sales/manufacturing/education/hr/generic
  targetRoles: string,         // 目标岗位关键词，逗号分隔
  skills: string,              // 技能与专长关键词
  education: string,           // 教育背景（学校/专业/届）
  certificates: string,        // 证书与执业资质
  preferredCities: string,     // 期望城市
  expectedSalary: string,      // 期望薪资下限（可空）
  jobType: "intern"|"summer"|"campus"|"social"|"parttime"|"career"|"soe",
  extraNotes: string,          // 额外偏好（可实习时长、出差轮班意愿、公司性质偏好等）
}

// Config（LLM 配置）
{ provider, baseUrl, apiKey, model, temperature, maxScanConcurrency, scanTopN, requestTimeoutMs, enabledSites }

// Job（抓取 + 打分结果）
{
  id,                 // uuid
  site,               // "zhipin"|"shixiseng"|"job51"|"zhaopin"|"nowcoder"|"yingjiesheng"|"zhiye"|"moka"|"feishu"|"linkedin"|"greenhouse"|"lever"|"generic"
  url, title, company, location, salary,
  description,        // JD 正文
  extractedAt,        // ISO
  score,              // 0-100 (null=未打分)
  verdict,            // "recommend"|"consider"|"skip"
  matched: string[],  // 命中的匹配点
  missing: string[],  // 缺失/风险点
  reasons: string,    // 一句话结论/理由
  advice: string,     // 详情页匹配给出的求职建议（批量扫描模式下为空）
  status,             // "scored"|"saved"|"applied"|"rejected"
  greeting,           // 生成的打招呼语/求职信（可空）
  updatedAt,
}
```

## 4. 消息协议（content/popup/options -> background）

```
PING
GET_CONFIG / SET_CONFIG          # 含 apiKey，仅扩展页（popup/options）可调
GET_UI_CONFIG                    # 脱敏视图：{ enabledSites, maxScanConcurrency, scanTopN, hasApiKey }，给 content script
OPEN_OPTIONS                      # 请求打开选项页（无数据回传，页面可调）
GET_PROFILE / SET_PROFILE        # 含简历全文，仅扩展页可调
SCORE_JOB { job }            -> { ok, result:{score,verdict,matched,missing,reasons,advice} } | { ok:false, error }
SCORE_JOBS { jobs }          -> { ok, results:[result|null], errors? }
GENERATE_GREETING { job, hint } -> { ok, text }
SAVE_JOB { job }             -> { ok, job }
GET_JOBS / DELETE_JOB { id } / SET_JOB_STATUS { id, status }
```

background 用 `chrome.runtime.onMessage`，异步返回 `return true`。

**权限边界**（`service-worker.js`）：
1. `sender.id !== chrome.runtime.id` 直接丢弃——MV3 下未声明 `externally_connectable` 时，其他已安装的扩展仍能向本扩展发消息，否则它们可以直接 `GET_CONFIG` 取走 API Key、或 `SET_CONFIG` 把 Base URL 改到自己的服务器。
2. 不是本扩展自己页面发来的消息（即页面里的 content script）只放行白名单 `PAGE_ALLOWED = { GET_UI_CONFIG, OPEN_OPTIONS, SCORE_JOB, SCORE_JOBS, GENERATE_GREETING, SAVE_JOB }`，其余返回 `{ ok:false }`。悬浮面板跑在招聘站的渲染进程里，API Key 和简历全文不能经消息回传到那里。判定特权来源只能看 `sender.origin` / `sender.url` 是否为 `chrome-extension://<own id>`——**不能用 `sender.tab` 判断**，选项页也是在标签页里打开的，同样带 `sender.tab`。
3. 新增消息类型默认不进白名单；页面确实需要新配置项时，扩到 `getUiConfig()` 的脱敏视图里（`hasApiKey` 只回布尔不回 Key）。

## 5. LLM 交互

### 匹配打分（返回严格 JSON）
System：你是资深技术招聘顾问 + 求职教练，服务对象是求职者。基于其简历/画像与岗位 JD，判断契合度。要企业级视角、不吹捧、指出真实差距。
User：注入 profile 各字段 + Job(title/company/location/salary/description)。
要求仅输出 JSON：
```json
{"score": 0-100, "verdict": "recommend|consider|skip",
 "matched": ["..."], "missing": ["..."], "reasons": "一句话结论", "advice": "1-2 句给候选人的求职建议"}
```
解析：优先 `response_format={type:"json_object"}`（Anthropic 不支持，靠提示词 + 正则兜底抠出首个 `{...}`）。详情页结果含 `advice` 求职建议；批量扫描为提速不要求 `reasons`/`advice`。

两条链路的输入不同：**单岗位**用简历全文 + JD（限 4000 字）；**批量**用简历摘要（超 1200 字的简历先由 LLM 压成 ≤350 字结构化摘要，按内容哈希缓存，失败降级为截断全文）+ JD（能读到完整 JD 的 zhipin/shixiseng/nowcoder/zhaopin/zhiye/moka/feishu 限 2200 字，只有卡片摘要的 51job/yingjiesheng 限 800 字）。两条链路共用一套评分锚点（90-100/75-89/50-74/25-49/0-24，硬门槛不满足封顶 24，硬门槛按实习/校招/社招分别判断），避免分数扎堆。打招呼语在已打分的岗位上会注入 `matched` 命中点，保证文案与面板展示一致。

### 打招呼语 / 求职信
基于 JD + 简历亮点，生成 120-200 字中文打招呼语（Boss直聘风格）或可选求职信；真实、突出匹配点、给出一个可追问的项目亮点；不编造经历。

## 6. UI 行为

- **悬浮面板**：注入到页面右侧，可折叠、可拖拽到任意位置（拖标题栏或顶部岗位信息区，仅标题栏需留在屏幕内）、可关闭（会话级，刷新恢复）；折叠与位置按站存 localStorage。进入岗位详情页自动抓取并显示「抓取到的岗位信息 + [开始匹配] 按钮」；未配置 API Key 时显示引导横幅（经 `OPEN_OPTIONS` 消息可直达选项页）；错误按类型分流（未配置 / 401 / 429 各配一个下一步按钮）；首页/登录页等识别不到岗位的页面收起为静默胶囊。点击后调用 SCORE_JOB，展示分数环（颜色：≥75 绿 recommend / 50-74 黄 consider / <50 红 skip）、matched/missing 标签、reasons，及 [生成打招呼语] [保存到看板] 按钮。
- **列表页批量扫描**：面板提供 [扫描本页岗位]，提取列表项（SITES 表给出 cards 选择器）→ 逐个（限流）打分 → 在列表项上打角标高亮，面板内出分数排名列表（每行含 [打招呼] [保存]，顶部含 [全部保存到看板]）。**扫描不会自动写入看板**，入库只能由用户点 [保存] / [全部保存] 触发。深度抓取策略在 SITES 表的 `deepScan` 字段：实习僧、智联、牛客、飞书是 `fetch`——按 `maxScanConcurrency` 并发抓取同源详情页（`api.fetchJobDetail`，同源校验、`credentials:"include"`、失败回退卡片文字；飞书详情页纯前端渲染，fetch HTML 是空壳，配 `fetchDetail` 钩子改抓同源岗位 JSON API）；BOSS 直聘是 `click`——`/web/geek/jobs` 列表页点卡片在同页右侧详情面板渲染完整 JD，逐个 `card.click()` 轮询 `api.readOpenJd()`（类名优先，「职位描述」标题锚定兜底，单条超时回退卡片摘要，先点最后一张挪开初始选中）；Moka 是 `navigate`——经典模板卡片没 JD 且详情是同页 hash 路由（点开后列表卸载），逐岗 `location.hash` 跳详情、`readOpenJd` 读 JD、`history.back()` 回列表，卡片已自带全文（新版模板）的岗位直接跳过；北森是 `""`——卡片阶段就由 `listJobs` 钩子拉站点自己的列表接口（同源 + 用户会话）按"卡片标题 === JobAdName"合并完整 JD 与岗位链接（北森卡片内没有链接，`extractJobList` 会丢弃无链接卡片；卡片与标题选择器同时覆盖新版模板 STListItem 与企业定制模板如中核 `/custom/campus` 的 `.job-list .item`，定制模板完整 JD 折叠在卡片 `.con` 里、公司名在「招聘单位：」行）；51job、应届生都是 `""`——不批量请求详情页，按卡片文字打粗分；51job 的岗位链接由埋点属性里的 `jobId` 拼 `https://jobs.51job.com/all/<jobId>.html`，应届生详情页标题/公司/JD 分别读取 `.detail-title-left-top .job`、`.detail-content-compnav-center`、`.jobinfo`；直接访问可能遇到阿里云滑动验证，扩展不绕过。Greenhouse/Lever 也不深度抓取（列表项自带完整 JD 或 JSON-LD）。扫描结果按岗位 URL 去重（同一岗位只留 JD 更长的一条；Moka 同卡内外双链接依赖此行为）。
- **SPA 路由**：监听 `popstate` + 每秒轮询 `location.href`，URL 变了就重新抓取。不用 `history.pushState` 打补丁（content script 在隔离世界，页面自己调 pushState 不会触发补丁），也不用全文档 MutationObserver（招聘站 DOM 持续变动，回调会被打满）。初始未识别到岗位时最多重试 5 次，每次 1 秒，处理 SPA 内容晚于 `document_idle` 渲染的情况。
- **popup 看板**：统计（已扫描/推荐/已投）、关键词搜索、按时间/分数排序、列表（分数、标题、公司、状态、重新打分（对无分记录）、打开原页、删除（二次确认））、筛选（状态）、导出 CSV（随当前筛选与排序）、[在本页启用]（向任意非适配站点按次注入面板，activeTab 授权）、入口到 options。
- **options**：三块——个人画像（领域下拉 + 简历导入 + 目标岗位/技能/教育/证书/城市/薪资/求职类型）、LLM 配置（含「测试连接」）、站点开关（十二个适配站）。
- **首次运行**：`chrome.runtime.onInstalled` 自动打开选项页引导配置。

## 7. 隐私与安全

- **数据只在本机**：API Key、画像、岗位记录都在 `chrome.storage.local`，无云端同步、无遥测。
- **Key 与简历不进页面上下文**：只有 background service worker 读 `getConfig()` / `getProfile()`；content script 拿到的是 `getUiConfig()` 的脱敏视图（见 §4 权限边界）。回传给 UI 的错误串同样算 DOM，`llm.js` 的 `redactKey()` 先抹掉密钥本身与形似密钥的串再拼进 error。
- **只信本扩展的消息**：按 `sender.id` 拒绝外部扩展，按 `sender.tab` 收紧页面可用的消息类型。
- **传输层**：Base URL 只允许 `https`，仅 `localhost` / `127.0.0.1` 放行 `http`（本机自建模型服务）；`optional_host_permissions` 收窄到 `https://*/*` + 这两个本机地址，且只在用户保存 LLM Base URL 时按单域名申请。固定 `permissions` 是 `storage` + `activeTab` + `scripting`——`activeTab` 只在用户主动点击（打开 popup / 点「在本页启用」）时授权当前页，扩展从不自动接触十二个适配站之外的页面。
- **页面来的 URL 视为不可信**：写进 `href` 前过 `OfferClaw.safeUrl()`（只放行 http/https）；带 cookie 的详情页抓取（`fetchJobDetail`）只允许同源目标。
- **JD 是不可信输入**：JD 会拼进提示词，存在提示词注入影响评分的可能；它只影响评分质量，不参与控制流判断，分数仅供参考。
- **不自动投递**：「投递」是用户手动动作，插件只做辅助（生成文案 + 记录），不做自动填表或群投，避免违反平台规则。
- 所有 LLM 请求由用户自带 Key 直连其配置的服务商。

## 8. MVP 范围 / 非目标

MVP 做：单岗位抓取+打分+打招呼语+保存、popup 看板（搜索/排序/重新打分/导出）、options 配置（领域下拉 + 七种求职类型）、zhipin/shixiseng/job51/zhaopin/nowcoder/yingjiesheng/linkedin/greenhouse/lever 提取、列表页批量扫描（SITES 表驱动深度抓取策略）、简历文件导入（PDF/Word .docx）、任意页面按点击注入（generic + JSON-LD JobPosting）。
非目标（后续）：自动填表投递、简历自动改写/ATS 优化、多简历版本、云端同步、自动定时抓取。
