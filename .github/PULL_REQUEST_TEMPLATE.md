## 改了什么

<!-- 一两句说清动机和结果。关联 issue 请写 Closes #123 -->

## 怎么验证的

- [ ] 跑过相关的 `scripts/test-*.mjs`（贴一下输出的最后一行）
- [ ] 在 `chrome://extensions` 重新加载扩展后人工验证过

改到 content script / popup / 选项页的话，写清你实测了哪些页面：

<!-- 例如：BOSS 详情页 + 列表页扫描 20 条；实习僧列表页；选项页保存与测试连接 -->

## 自查

- [ ] 没有把 API Key、简历全文、本机路径或真实个人信息写进代码、测试或截图
- [ ] 新增的消息类型没有默认放进 `PAGE_ALLOWED` 白名单（`src/background/service-worker.js`）
- [ ] 从页面 DOM 读来的 URL 在写进 `href` 前过了 `OfferClaw.safeUrl()`
- [ ] 没有引入第三方依赖或构建步骤
- [ ] 没有加入自动投递 / 自动填表 / 绕反爬相关的能力
