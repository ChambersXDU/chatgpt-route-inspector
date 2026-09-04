<div align="center">

# ChatGPT Route Inspector

**只保留 Tampermonkey 油猴版。**

它只回答一件事：**这条 ChatGPT 消息，服务器报告实际路由到了什么模型？**

</div>

## 安装

先安装 Tampermonkey，然后打开下面的 Raw 地址：

https://raw.githubusercontent.com/ChambersXDU/chatgpt-route-inspector/main/userscript/chatgpt-route-inspector.user.js

Tampermonkey 会直接进入安装/更新页面。安装后刷新 `chatgpt.com` 即可。

当前仓库不再提供或维护 Chromium 扩展版、Manifest、Popup、设置页或 Chrome/Edge 安装包。

## 怎么看结果

脚本在页面右下角显示一个很小的“路由模型”胶囊。点击后可以看到：

- **当前实际路由**；
- **请求模型**；
- **模型标签**；
- **路由来源**；
- 请求模型与服务器路由是否不一致。

界面固定中文，不提供手动“实时/重载”模式切换。

## 当前判定规则

新消息优先读取显式服务端路由证据：

1. `server_ste_metadata.model_slug`
2. `resolved_model_slug`

如果两种显式路由证据同时存在且值不同，才显示“路由字段冲突”。

`assistant.metadata.model_slug` 现在只当作**模型标签**展示，不再参与实际路由冲突判定。也就是说，如果请求是 `gpt-5-6-thinking`、模型标签仍是 `gpt-5-6-thinking`，但流尾 `server_ste_metadata.model_slug` 是 `gpt-5-5-mini`，脚本会直接显示实际路由 `GPT 5.5 mini`，并提示“请求模型与服务器路由不一致”。

这套规则是为了适配近期 ChatGPT 网页返回结构的变化；它只读取网页已有字段，不根据回答速度、写作风格、内容质量或模型自述猜测模型。

## 刷新旧对话

刷新已有对话时，如果 conversation record 里仍然带有 `resolved_model_slug` 或嵌套的服务器路由字段，脚本会显示它。

如果旧消息只剩 `assistant.metadata.model_slug` 这种模型标签，而没有可验证的显式路由字段，脚本会显示 **“未验证”**，而不是把标签冒充成实际路由。

发送一条新消息后，会自动切换到这条消息的实时路由结果。

## 为什么只留油猴版

这个项目本质上只是一个页面内的实时观察器。保留完整浏览器扩展意味着还要维护 Manifest V3、background/content script、Popup、设置页、扩展打包、权限和另一套浏览器测试，但对核心功能没有必要。

如果以后 ChatGPT 把关键路由信息迁移到 WebSocket-only，我们会直接给油猴脚本增加对应捕获，而不是重新维护一套扩展。

## 打包 CI

`Userscript Package` 工作流会在 `main` 更新时生成：

- `chatgpt-route-inspector-<userscript-version>.user.js`
- `SHA256SUMS.txt`

产物会作为 GitHub Actions artifact 保存 30 天。推送 `v*` tag 时，这两个文件也会自动发布到对应 GitHub Release。

## 本地验证

需要 Node.js 20+：

```bash
npm ci
npm run typecheck
npm run lint
node --check userscript/chatgpt-route-inspector.user.js
npm run test:unit
npm run test:e2e
npm run package
```

主 CI 会另外安装 Chromium，并用 Playwright 验证油猴脚本的真实页面流程，包括：

- ChatGPT 再包装 `window.fetch` 时不会发生递归栈溢出；
- 刷新已有对话后读取路由；
- 新消息自动覆盖旧结果；
- `GPT 5.6 Thinking` 请求遇到流尾 `server_ste_metadata = GPT 5.5 mini` 时正确显示 mini 和路由不一致提示。

## 隐私

油猴版只维护当前页面会话中的最新读取结果，不保存聊天正文，也不会把检测数据上传到第三方服务。详见 [`PRIVACY.md`](PRIVACY.md)。

## 兼容性与限制

- 面向支持现代 UserScript API 和页面上下文注入的 Tampermonkey；
- 当前使用 `@sandbox raw`、`@grant none`、`document-start`；
- 只匹配 `https://chatgpt.com/*` 和 `https://chat.openai.com/*`；
- ChatGPT 网页接口或字段结构变化后，脚本可能需要同步更新；
- 本工具只能报告网页暴露的字段，无法解释为什么服务端选择某个模型。

本项目是独立的非官方工具，与 OpenAI 不存在隶属、授权或背书关系。
