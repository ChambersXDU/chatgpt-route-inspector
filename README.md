<div align="center">

# ChatGPT Route Inspector

一个只回答一件事的小工具：**我这条 ChatGPT 对话现在实际被路由到了什么模型？**

</div>

## 它怎么工作

不需要手动选择“实时模式”或“重载模式”。

- **刷新已有对话**：自动读取当前已加载回答中的模型路由信息。
- **发送新消息**：立即切换到这条新消息，并在响应到达后自动更新实际路由模型。
- **不猜模型**：只读取 ChatGPT 网页请求、响应或回答记录里已经存在的模型字段，不根据回答速度、写作风格、内容质量或模型自述做推断。

本项目提供两种安装方式：Chromium 扩展版和 Tampermonkey 油猴版。两者可以按个人习惯任选其一。

## 安装方式一：Tampermonkey 油猴版

如果你更喜欢轻量的用户脚本，这是最直接的安装方式。

### 直接安装

1. 先安装 Tampermonkey。
2. 打开下面这个 `.user.js` 文件的 Raw 地址：

   https://raw.githubusercontent.com/ChambersXDU/chatgpt-route-inspector/main/userscript/chatgpt-route-inspector.user.js

3. Tampermonkey 会打开安装页面，确认安装即可。
4. 刷新 `chatgpt.com`。

脚本会在页面右下角显示一个很小的“路由模型”胶囊。点击后可展开查看当前模型、触发方式、路由字段来源和请求模型。

油猴版本：

- 固定中文界面；
- 没有手动模式切换；
- 刷新已有对话时自动显示重载捕获结果；
- 发送新消息后自动切换到新消息结果；
- 默认不保存聊天正文；
- 使用 `@sandbox raw` 在页面上下文运行，以便观察 ChatGPT 自身的网络请求；
- 只匹配 `https://chatgpt.com/*` 和 `https://chat.openai.com/*`。

脚本源码就在仓库中：[`userscript/chatgpt-route-inspector.user.js`](userscript/chatgpt-route-inspector.user.js)。

## 安装方式二：Chrome / Edge 扩展版

### 从 GitHub Actions 下载安装包

仓库的 **Install Packages** 工作流会在 `main` 更新时自动生成安装文件。

1. 打开仓库的 Actions 页面。
2. 选择 **Install Packages**。
3. 打开最新一次绿色运行。
4. 下载 `chatgpt-route-inspector-installers-...` artifact。
5. 解压 artifact，里面会有：
   - `chatgpt-route-inspector-<version>.zip`：Chromium 扩展安装包；
   - `chatgpt-route-inspector-<version>.user.js`：Tampermonkey 安装脚本；
   - `SHA256SUMS.txt`：两份安装文件的 SHA-256 校验值。
6. 再解压扩展 zip。
7. 打开 `chrome://extensions/` 或 `edge://extensions/`。
8. 开启“开发者模式”。
9. 点击“加载已解压的扩展程序”，选择刚才解压出来的扩展目录。

### GitHub Release

当仓库推送 `v*` tag 时，安装包工作流会自动把扩展 zip、油猴脚本和 `SHA256SUMS.txt` 挂到对应 GitHub Release 上。

### 从源码构建

需要 Node.js 20 或更高版本：

```bash
npm ci
npm run build
```

构建后的扩展位于 `dist/extension`。

如果需要同时生成可分发安装包：

```bash
npm run package
```

产物位于 `release/`。

## 扩展版界面

浏览器扩展 Popup 保持很简单：

- 当前路由模型；
- 触发方式与更新时间；
- 可折叠的高级信息；
- 一个“设置”入口。

页面浮窗默认关闭。诊断台、记录上限、导出请求 ID、清空本地记录等次要功能都放在设置里。

## 检测依据

优先使用显式的响应路由字段：

- `resolved_model_slug`
- `server_ste_metadata.model_slug`

如果没有显式路由字段，才会退回回答记录中的模型标签，例如：

- `assistant.metadata.model_slug`

如果这些证据互相冲突，界面会明确显示“路由字段冲突”，而不是擅自挑一个结果。

## 隐私

工具只观察模型路由相关字段，不需要保存或上传提示词和回答正文。

扩展版的检测记录保存在当前浏览器本机；油猴版当前只维护页面会话中的最新读取结果。

本项目不会主动上传：

- 提示词或回答正文；
- Cookie、登录凭据或认证信息；
- 附件内容；
- 完整 HAR 或未筛选网络流量。

完整说明见 [`PRIVACY.md`](PRIVACY.md)。

## CI 与测试

主 CI 会执行：

```bash
npm ci
npm run typecheck
npm run lint
node --check userscript/chatgpt-route-inspector.user.js
npm run test:unit
npm run test:integration
npm run build
```

随后会在 Chromium 中执行扩展版和油猴版的浏览器冒烟测试。

油猴版浏览器测试会实际模拟：

1. 重新加载已有对话并读取 `GPT 5.5`；
2. 发送一条新消息；
3. 自动进入“正在获取”；
4. 新响应到达后更新为 `GPT 5.6 Pro`。

独立的 **Install Packages** CI 还会实际生成并验证扩展 zip、`.user.js` 和 SHA-256 校验文件。

## 开发

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run package
```

## 兼容性与限制

- 扩展版面向 Chrome / Edge 等 Manifest V3 Chromium 浏览器。
- 油猴版面向支持现代 UserScript API、可使用页面上下文注入的 Tampermonkey。
- ChatGPT 网页接口或字段结构发生变化后，解析逻辑可能需要同步更新。
- 工具只能展示网页实际暴露出来的模型字段，不代表可以访问 OpenAI 内部调度、计费或账号风控系统。

## 免责声明

本项目是独立的非官方工具，与 OpenAI 不存在隶属、授权或背书关系。ChatGPT、OpenAI 及相关标识是其各自权利人的商标。
