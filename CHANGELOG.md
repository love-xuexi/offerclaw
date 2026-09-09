# Changelog

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
