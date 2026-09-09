# 开源前检查清单

> 最后检查：2026-09-09

## 已完成

- [x] MIT License
- [x] README 项目说明、安装、配置、FAQ、隐私与安全说明
- [x] CONTRIBUTING 贡献指南
- [x] SECURITY 安全披露流程
- [x] CODE_OF_CONDUCT 行为准则
- [x] SUPPORT 支持与反馈入口
- [x] docs/PRIVACY 隐私政策
- [x] GitHub Issue 模板与 PR 模板
- [x] CI 自动测试与打包
- [x] tag 触发的 GitHub Release 工作流
- [x] 版本号与 CHANGELOG
- [x] 无真实 API Key、简历、姓名、本机路径或代理地址进入公开文件
- [x] Git 历史已重置为单个初始提交，旧历史不再保留`n- [x] 内部分析文档已加入 `.gitignore`，不会出现在公开仓库
- [x] 打包产物 `dist/offerclaw-v0.1.0.zip` 可生成
- [x] 全量测试通过

## 你还需要手动完成

- [ ] 在 GitHub 仓库设置中确认仓库仍为 private
- [ ] 检查 GitHub 仓库描述、Topics、主页链接
- [x] 远端仅保留 `main` 分支，无旧 tag
- [ ] 手动把仓库改为 Public
- [ ] 创建 `v0.1.0` GitHub Release
- [ ] 在 Release 中上传 `dist/offerclaw-v0.1.0.zip`
- [ ] 如需上架 Chrome Web Store，按 `docs/PRIVACY.md` 准备权限说明

## 建议的公开前最后检查

1. 在 GitHub 网页上浏览仓库，确认没有意外文件。
2. 在本地执行一次全量测试：
   ```powershell
   node scripts/test-sites.mjs
   node scripts/test-messaging.mjs
   node scripts/test-prompts.mjs
   node scripts/test-scoring.mjs
   node scripts/test-llm.mjs
   node scripts/test-util.mjs
   node scripts/test-resume-parse.mjs
   node scripts/pack.mjs
   ```
3. 确认 `dist/offerclaw-v0.1.0.zip` 存在且可安装。
