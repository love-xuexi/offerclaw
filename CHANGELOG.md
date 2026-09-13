# Changelog

## [0.2.0] - 2026-09-13

### Added

- 接入企业校招官网最常用的三大 ATS（秋招主战场），列表页批量扫描均可读到**完整 JD**：
  - 北森 `xxx.zhiye.com`（科大讯飞、合合信息等）：扫描时用站点自己的列表接口（同源 + 用户会话）按"卡片标题 === JobAdName"合并完整 JD（职责+要求）与岗位链接。
  - Moka `app.mokahr.com`（千里科技、飞步科技等）：新版模板（`/campus_apply/`）卡片自带完整 JD；经典模板（`/campus-recruitment/`）自动逐岗打开详情页读取后返回（新增 `"navigate"` 深扫策略）。
  - 飞书招聘 `xxx.jobs.feishu.cn`（蔚来等）：详情页纯前端渲染，扫描时并发抓同源岗位 JSON 接口（实测无需签名）补全 JD。
- 站点适配钩子扩展：`cardTitle` / `cardDescription`、卡片自链接形态的 `cardUrl`、`listJobs()` 列表接口预取合并、`fetchDetail()` 单岗位 JSON 补全、`descriptionFrom()` 精确拼取正文、`openJdSelectors`。
- 批量扫描结果按岗位 URL 去重，同一岗位保留 JD 更长的一条（Moka 同卡内外双链接依赖此行为）。
- 北森/Moka/飞书的批量 JD 限长与其它完整 JD 站点一致放宽到 2200 字。

## [0.1.0] - 2026-09-09

首个公开版本。

### Added

- Chrome MV3 扩展基础能力：岗位详情匹配、列表页批量扫描、打招呼语生成、投递看板、CSV 导出。
- 支持 BOSS 直聘、实习僧、51job、智联招聘、牛客网、应届生求职网、LinkedIn、Greenhouse、Lever。
- 支持任意页面按次注入，优先读取 schema.org `JobPosting` 结构化数据。
- 个人画像与 LLM 配置保存在本机，不使用遥测或云端同步。
- 支持 OpenAI 兼容接口与 Anthropic Messages API。
- PDF / DOCX 简历导入。
- 领域化评分提示词、领域无关评分锚点与多领域画像。
- 智联与牛客列表页扫描会抓取同源详情页补全完整 JD。
- Content script 对晚渲染的 SPA 岗位信息做有界重试。
- 开源文档与 GitHub 工作流：测试、打包、Release、Issue 模板。
