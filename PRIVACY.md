# 隐私说明

ChatGPT Route Inspector 现在仅提供 Tampermonkey 用户脚本版本。

## 脚本读取什么

脚本只在 `chatgpt.com` 和 `chat.openai.com` 页面运行。它在页面上下文中观察 ChatGPT 自身已经发起的相关 `fetch` 请求，并从请求/响应中提取模型路由相关字段，例如：

- 请求中的模型标识；
- `server_ste_metadata.model_slug`；
- `resolved_model_slug`；
- `assistant.metadata.model_slug`（仅作为模型标签）。

与路由检测无关的请求会原样转发，不做解析。

## 不保存什么

当前油猴版只维护页面会话中的最新读取结果，不使用本地数据库保存历史记录，也不会主动上传数据。

脚本不会主动保存或上传：

- 提示词和回答正文；
- Cookie、登录凭据或认证信息；
- 附件内容；
- 完整 HAR；
- 未筛选的网络流量。

## 网络访问

脚本本身不向第三方服务发送检测数据。`@grant none` 表示它不使用 Tampermonkey 的特权网络 API；它只是观察并转发 ChatGPT 页面自身的网络请求。

Tampermonkey 对脚本更新的检查由脚本管理器根据 `@updateURL` / `@downloadURL` 完成，当前地址指向本仓库的 Raw `.user.js` 文件。

## 限制

ChatGPT 的网页接口和内部字段不是公开稳定 API，字段语义可能变化。本工具只能展示页面实际暴露出的信息，不能访问 OpenAI 内部调度、计费、额度或账号风控系统。

本项目是独立的非官方工具，与 OpenAI 不存在隶属、授权或背书关系。
