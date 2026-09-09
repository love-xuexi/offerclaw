# OfferClaw 优化路线图

目标：让更多人愿意用、愿意 star。本文只讲"为什么做"和"改哪里"，不含实现代码。

结论先说：**卡住的不是工程质量，是三道漏斗墙。** `src/` 里 0 个 TODO/FIXME、0 处 `console.log`、0 段注释掉的死代码，约 1500 行原生 JS 配 5 个 Node 测试脚本（114 项断言全绿）。问题全在代码之外。

## 诊断：三道墙

### 第一道：访客不知道它长什么样

拦住 100% 的 GitHub 访客。

- 整个仓库除 3 个图标外**零张图片**，README 没有截图、没有 GIF、没有 badge。
- `icons/icon128.png` 只有 431 字节——`scripts/gen-icons.mjs` 用 7 行手写 PNG 编码器生成的直角纯色方块，跟"爪"和"O"都无关。里面那个 `round` 变量本想做圆角，但白色区域永远碰不到边框，是无效代码。
- **0 个 git tag、0 个 Release**，装扩展必须先会 git clone。

### 第二道：装上了跑不起来

拦住大部分尝试安装的人。

- 没有 `onInstalled` 钩子，装完什么都不发生；唯一进选项页的入口藏在 popup 工具栏里。
- 面板却会在 BOSS 首页、登录页**无条件弹出**：`extractJob()` 的标题兜底是 `document.title`、描述兜底是页面最长文本块，所以首页上会把网页标题当"岗位标题"、把一段无关正文当 JD 显示。
- 点「开始匹配」得到"请先在选项页配置 API Key、Base URL 和模型"——但面板里没有跳过去的按钮（content script 不能直接调 `openOptionsPage`），而且文案误导：默认配置已预填 baseUrl 和 model，实际只缺 Key。
- 跑起来要六步：开发者模式加载 → 注册服务商充值建 Key → 选项页填 → 授权域名弹窗（拒绝连保存都做不到）→ 导入简历 → 测试连接（会真的计费）。**没有任何免费或降级路径**，缺 Key 时是硬失败而不是退化。

### 第三道：跑起来了也只对一类人有用

拦住绝大多数非 AI 方向的求职者。

`src/background/prompts.js` 把 IT/AI 写成了内置世界观：评估维度是 SFT/DPO/GRPO/RLHF、RAG、Agent、多模态；资历口径是 CCF/ACL/NeurIPS/Kaggle；工程栈是 PyTorch/vLLM/DeepSpeed/ms-swift/verl。

最要命的是 `prompts.js:29`——50-74（consider）这一档的字面定义是"同属 AI/软件大类"。护士投护士岗永远不满足这个描述，模型只能落到 25-49，或者整体忽略锚点自由发挥；两种结果都让分数失去共同标尺，同一批岗位不可横向比较。

`prompts.js:36` 的简历摘要槽位同样只有"技术栈｜论文竞赛"，没有证书资质、业绩量化、作品集。而**批量扫描的唯一简历输入就是这份摘要**，非技术岗的关键信息（执业证、CPA、GMV 与回款、作品集链接）在压缩阶段就丢了，之后每一条分数都建立在残缺输入上，用户还察觉不到。

## P0 ✅ 已完成：文档不实与用户可见缺陷

四处文档不实：`AGENTS.md` 里重复粘贴的 BOSS/51job 段落、缺失的 51job 站点名、`DESIGN.md` §0 的作者个人画像（改成中性画像）、以及把 `generic` 兜底提取器当作已交付能力的表述（改成如实说明它当前不可达，指向 P4）。

五个用户可见缺陷：

- **批量扫描吞掉真实错误**：`panel.js` 拿到 `{ok:false}` 后从不读 `response.error`，后台那句精确的"请先配置 API Key"退化成笼统的"岗位匹配失败"。现在错误（含 `scoreJobs` 按索引回传的 `errors`）会显示在进度行里。
- **`done` 按批长度累加而非成功数**，20 个全失败仍报"已完成匹配 20 / 20"。现在只统计真正拿到分数的岗位，有失败时显示"已匹配 M / N，K 个失败：<原因>"。
- **导出 CSV 用全量而非当前筛选**，与界面显示不一致。同时让 `toCSV` 在空结果时也输出表头，避免筛出 0 条时导出一个空文件。
- **`safeUrl("")` 会解析成当前页地址**（`new URL("", base)` 的行为），没有 url 的岗位会被渲染成指向本页的链接。空值现在直接返回空串。这个是补 `test-util.mjs` 时才发现的。
- **popup 空态一句话覆盖三种情况**（没配 Key / 没有记录 / 筛选无结果），现在按情况分流。
- **options provider 切换不清空空预设**：mimo 和 custom 的预设是空串，从别家切过去时旧 Base URL 会留着，用户以为切换成功、实际把新 Key 发往上一家的端点。现在一律按预设覆盖。

新增 `scripts/test-util.mjs`（23 项）锁住 CSV 与 `safeUrl` 行为。content script 与 popup 的 DOM 层本项目不做 Node 测试，需在 `chrome://extensions` 重新加载后人工验证。

## P1 ✅ 已完成：门面与分发

- **图标重做**：`scripts/gen-icons.mjs` 改成 4× 超采样抗锯齿 + 真 alpha + 圆角，图形是靛蓝圆角方块 + 三道白色爪痕。原来那个 431 字节的直角纯色方块里白色区域辨识不出，想做圆角的 `round` 变量还是死代码。16px 单独放宽笔画间距，否则三道会粘成一团。
- **三张截图**：`docs/images/score.png`（详情页打分卡）、`scan.png`（列表页扫描 + 卡片角标 + 排名列表）、`board.png`（投递看板）。都在真实登录的 Edge 里实拍，裁掉浏览器边框与输入法悬浮条，站点顶栏的用户名已模糊。
- **README 重排**：加了 tagline、4 枚 badge、截图、支持站点对比表、FAQ（费用 / 封号 / 51job 为什么只有粗分 / BOSS 薪资为什么留空 / 数据发去哪 / 分数可信度 / 与 Simplify 的区别）；安装步骤补上"先下载代码"和"需自备 API Key"这个硬前提；隐私说明收进 `<details>`；并说明支持 Chrome / Edge 等 Chromium 浏览器。
- **`scripts/pack.mjs`**：零依赖自己写 ZIP，产出 `dist/offerclaw-v<version>.zip`，只含运行时文件，`.md` 全排除但保留 `src/vendor/pdfjs/LICENSE`。
- **仓库门面**：`CONTRIBUTING.md`（重点写"怎么加一个招聘站适配器"）、`SECURITY.md`、`.github/` 的 Bug 与站点适配 issue 模板 + PR 模板、`.editorconfig`，以及 CI workflow（跑全部 6 个测试脚本 + 打包，换来 tests badge）。
- **HTML/CSS 反压缩**：5 个单行文件展开（panel.css 291 行、popup.css 116、options.css 75、popup.html 32、options.html 57）。用的是纯插入变换 + "非空白字符完全一致"校验，断行只选"加空白不改变渲染"的位置，并在浏览器里确认了渲染。

顺带修掉的 4 个提取 bug（拍截图时撞出来的，都在 Edge 里验证过前后差异）：BOSS 详情页公司名取到侧栏轮播的推荐公司、城市取到整段办公地址、列表卡片薪资跨卡串味成"面议"、`li` 启发式把技能标签当岗位卡片。细节记在 `AGENTS.md` 的「BOSS 直聘的三条实测坑」。

**还差最后一步**：`v0.1.0` 的 tag 与 GitHub Release 需要手动建（这台机器没装 `gh`），zip 已在 `dist/`。

## P2 ✅ 已完成（v0.2.0）：上手闭环

- **`onInstalled` 打开选项页**：安装/更新后自动进入配置页，"装完什么都不发生"补上了。
- **`getUiConfig()` 增加 `hasApiKey` 布尔位**：只回传布尔不回传 Key，面板初始化时先问一次配置，未配置直接显示引导横幅，不用等用户撞错误。
- **新增 `OPEN_OPTIONS` 消息**（进 `PAGE_ALLOWED`）：面板横幅与错误提示里的「打开选项页」按钮可直达配置，`test-messaging.mjs` 已锁死外部扩展发这条消息仍然无效。
- **错误按类型分流**：未配置 → 配置按钮；401 → 改 Key 按钮；429 → 降低扫描并发按钮（401/429 优先于"API Key"字样判断，避免服务商原始报错文案干扰分类）。
- **面板可控**：真正的关闭按钮（会话级，SPA 内换页不再出现，刷新恢复）、折叠状态与拖动位置按站存 localStorage、折叠按钮 −/+ 随状态切换。
- **非岗位页面静默**：识别不到岗位标题时收起为只有标题栏的静默胶囊，不再把首页/登录页的页面噪音渲染成"岗位"。

## P3 ✅ 已完成（v0.2.0）：去行业化

- **`DOMAIN_PROFILES` 领域表**：AI/软件（沿用原有维度清单，精度不降）、产品运营、金融财会、设计、医疗、销售、制造、教育、HR，共九个领域 + 通用兜底。每项一段领域侧写（能力维度 + 资历口径 + 常见硬门槛），按选项页「目标领域」下拉选择。
- **`SCORE_ANCHORS` 领域无关化**："技术栈"→"关键能力/核心方法"，"同属 AI/软件大类"→"同一个职能大类但核心方法不同"。测试断言改为"ai 领域含 GRPO/RAG/vLLM、medical 领域不含且含执业资质"。
- **简历摘要模板补槽位**：证书与执业资质、业绩与量化成果、作品集、语言能力，限长 350→400 字。
- **画像字段补齐**：领域、教育背景、证书资质、期望薪资下限；`jobType` 扩到七值（日常/暑期实习、校招、社招、兼职、转行、国企），转行与国企各有专门的硬门槛提示（转行不按原领域年限封顶）。
- **表单去 AI 味**：技能栏 placeholder 从"PyTorch，LangChain，DPO/GRPO，vLLM"改成"SQL，Python，Figma，CPA 已过 3 科（按你的行业填写）"。

## P4 ✅ 已完成（v0.2.0）：任意页面

- **`manifest` 加回 `activeTab` + `scripting`**（这次真的在用）：popup 加「在本页启用」按钮，点开 popup 的那次用户交互授权当前页，`chrome.scripting.executeScript` 注入面板五件套 + CSS。不点完全不碰非招聘站页面。
- **generic 提取器强化**：优先解析 JSON-LD 的 `JobPosting` 结构化数据（`<script type="application/ld+json">`），比猜选择器可靠；ATS 风格选择器组兜底。
- **新增 Greenhouse / Lever 适配器**：域名稳定、服务端渲染、JSON-LD 齐全，进 manifest 静态注入与选项页开关。
- **LinkedIn 两个洞**：薪资正则补美元格式（`$120,000/yr`、`$150k`、`$50 - $70 per hour`；中文薪资单位去空格、英文保空格）；打招呼语对 linkedin 岗位默认英文、其余中文，用户 hint 可覆盖。
- **隐私叙事同步**：README / DESIGN / PRIVACY.md 全部改为"六个站自动 + 其他页面按点击授权"。

## P5 ✅ 已完成（v0.2.0）：分发与增长

- **站点配置表**：`extractors.js` 的 if 链收进 `SITES` 表（域名正则 + 详情/列表选择器 + `deepScan` 策略 fetch/click/""），`panel.js` 改读 `api.deepScanStrategy()`。加站 = 加一条表目 + manifest matches + 选项页 checkbox（+ `FULL_JD_SITES`）。
- **看板留存功能**：关键词搜索、按分数/时间排序（无分记录沉底）、无分记录「重新打分」（popup 现在会发 `SCORE_JOB`）、删除二次确认（先变"确认删除？"再点才删）、扫描排名「全部保存到看板」。
- **商店准备**：`docs/PRIVACY.md`（隐私政策 URL 可直接指向 GitHub 上的这个文件或 Pages）、`homepage_url`、短描述从 20 字符扩到含六个站点关键词、版本号 0.2.0。剩余：开发者账号 $5 注册、上传 zip（`scripts/pack.mjs` 产出）、`optional_host_permissions` 的 justification（文案已备好在 PRIVACY.md 权限说明一节）。

## P6 ✅ 已完成（v0.1.0）：国内站点扩展

- **新增三个静态适配站**：智联招聘、牛客网、应届生求职网。站点 key 分别为 `zhaopin` / `nowcoder` / `yingjiesheng`，manifest 静态注入，选项页提供独立开关。
- **扫描策略**：智联与牛客使用 `deepScan: "fetch"`，批量扫描时抓同源详情页补全完整 JD；应届生保持 `deepScan: ""`，只读当前页卡片摘要，避免触发滑动验证。
- **应届生与 51job 的关系**：`q.yingjiesheng.com` 保持独立站点 key；岗位详情跳转到 `jobs.51job.com` 时由现有 `job51` 适配器处理。
- **新增 `scripts/test-sites.mjs`**：锁定域名识别、deepScan 策略、manifest host/matches、选项开关与批量 JD 限长（智联/牛客 2200 字，应届生 800 字）。

## 明确不做

- **自动投递 / 自动填表 / 群发**：合规红线，也是商店审核的高风险项。继续保持，但要在文案里讲清这是有意为之而不是没做完。
- **英文 README 与 UI i18n**：保持纯中文，聚焦国内求职者。代价是 GitHub 全球读者的 star 触达面窄一截，以及 LinkedIn 场景下是中文面板叠在英文页面上。将来想做的话，前提是先把散落在 7 个文件里的硬编码文案集中到一个常量模块，否则会全量返工。
- **云端同步 / 多设备**：`chrome.storage.local` 换 `sync` 有 100KB 配额限制，简历全文放不进去。更实际的替代是画像与配置的导入导出（现在只能导出岗位 CSV）。

## 顺序理由

P0（已完成）是公开仓库里的事实性错误和一眼可见的缺陷，成本最低、不修最尴尬。

P1 决定有多少人会 star——它不改任何功能，但没有它，后面所有功能改进都没人看见。

P2 决定装了的人里有多少能跑到第一次成功打分。

P3 天花板最高（可用人群从"AI 求职者"扩到所有求职者），但排在 P1/P2 之后：在没人装的时候扩大适用人群没有意义。

P4/P5 是把天花板继续往上抬。

**当前状态（v0.1.0）：P0–P6 全部完成。** 剩余的非代码事项：GitHub Release（v0.1.0 tag + `dist/offerclaw-v0.1.0.zip`）、Chrome Web Store 上架（开发者账号、截图已备好、justification 文案在 `docs/PRIVACY.md`）、开源前清理 git 历史中的敏感残留。后续方向（未排期）：猎聘 / 拉勾适配、多简历版本、画像导入导出。




