# 使用 Chrome 手工查看 ChatGPT 路由

这套步骤用于和扩展结果交叉核验。不要用“回答很快”“答案较短”或让模型自报型号作为证据。

## 抓本轮请求

1. 打开 ChatGPT，按 `F12` 或 `Ctrl + Shift + I`。
2. 进入 **Network**，勾选 **Preserve log**，点一次清空。
3. 在过滤框输入 `conversation`。
4. 回到页面，选择目标模型并发送一条普通消息。
5. 找到 `POST /backend-api/f/conversation`。如果同名请求很多，按开始时间和 Method 判断本轮。

在 **Payload** 中搜索：

```text
"model"
"thinking_effort"
"conversation_id"
"conversation_mode"
```

`model` 是 requested model。记录原值，不要拿响应中的 `default_model_slug` 反推请求模型。

## 查本轮响应路由（对应“实时请求”）

打开同一请求的 **Response** 或 **EventStream**，搜索：

```text
resolved_model_slug
default_model_slug
server_ste_metadata
model_slug
request_id
plan_type
fast_convo
```

重点对照：

```text
请求：model = gpt-…-pro
响应：resolved_model_slug = gpt-…-mini
响应：server_ste_metadata.model_slug = gpt-…-mini
```

这里要分层：`resolved_model_slug` 与 `server_ste_metadata.model_slug` 是实际路由证据；assistant 消息自己的 `metadata.model_slug` 是模型标签。出现“标签 Pro、resolved Instant”时，实际响应路由应显示 Instant，而不是报告字段冲突。

### 如果 POST 响应只有 handoff

当前 ChatGPT 可能让这个 POST 的 EventStream 只包含下面几类控制事件，而不包含回答或模型字段：

```text
resume_conversation_token
stream_handoff
resume_sse_endpoint
subscribe_ws_topic
```

这种情况下不要据此判定“没有路由字段”，真实回答可能已经转到 WebSocket：

1. 保持 **Preserve log** 开启，切换 Network 上方的 **Socket**（部分 Chrome 版本显示为 **WS**）过滤器。
2. 选择发送消息前后一直保持连接、并在回答期间持续收到 frame 的 WebSocket。
3. 打开该连接的 **Messages**，查看与本轮时间对应的文本 frame。
4. frame 外层通常是 JSON 数组；展开第一个元素的：

```text
[0].payload.payload.encoded_item
```

5. `encoded_item` 是一段普通 SSE 文本。在其中搜索：

```text
resolved_model_slug
server_ste_metadata
model_slug
request_id
conversation_id
```

手工判断时必须先确认 frame 属于本轮会话/消息。扩展会自动用 POST 的 `conversation_id`、`messages[0].id` 和 `parent_message_id` 与 WebSocket 消息 ID 配对；没有可靠匹配的 frame 会被忽略，不会按“最近一条请求”猜测归属。

## 重新加载会话复查（对应“会话重载”）

1. 保持目标会话页打开。
2. 切到扩展的“会话重载”，刷新当前会话页。
3. 打开 DevTools 的 **Elements**，按 `Ctrl + F` 搜索：

```text
data-message-model-slug
```

4. 找到同时带有下面两个属性的已完成回答节点：

```text
data-message-author-role="assistant"
data-message-model-slug="gpt-…"
```

也可以在 **Console** 运行下面这段只读查询，列出页面内所有已完成 assistant 回答保存的模型标签，不读取回答正文：

```js
[...document.querySelectorAll('[data-message-author-role="assistant"][data-message-model-slug]')]
  .map((element, index) => ({
    index: index + 1,
    messageId: element.getAttribute('data-message-id'),
    model: element.getAttribute('data-message-model-slug')
  }))
```

`data-message-model-slug` 与 assistant `metadata.model_slug` 属于同一“模型标签”层，不能单独证明实际路由。若刷新时出现 `GET /backend-api/conversation/{conversation_id}`，应在其 Response 中另找 `resolved_model_slug` 或 `server_ste_metadata.model_slug`。当前结构里 `resolved_model_slug` 可能位于 user message 的 metadata，而其子 assistant message 保存 `model_slug` 标签；这仍应读作“实际路由字段 + assistant 模型标签”，不应把 user 的 `model_slug` 当成 assistant 标签。

重载复查通常没有原始 POST 请求体中的 requested `model`。如果又只有 DOM 标签，那么请求模型和实际路由都未知；除非能对应到原始 POST 或实际路由字段，否则不要补造任何一侧。

扩展里的“会话重载”开关优先解析本次刷新产生的会话 JSON；网络记录尚未捕获时，DOM 标签扫描可先提供标签级兜底，网络记录随后到达时当前结果以网络证据为准。会话 JSON 存在 `current_node` 时，扩展只读取它所在的活动回答分支。同标签页切换会话后，记录按 URL 中的会话 ID 隔离。Network 中即使还能看到 `resolved_model_slug`，也可能是开启 **Preserve log** 后保留的先前实时 POST 响应；重载模式有意不把实时请求记录混进来。

## 查看 PoW difficulty

1. 在 Network 过滤框输入 `chat-requirements`。
2. 发送消息前后，找到以下任一请求；优先检查带 `/prepare` 的当前链路，不要选择 `/finalize`：

```text
POST /backend-api/sentinel/chat-requirements/prepare
POST /backend-anon/sentinel/chat-requirements/prepare
POST /backend-api/sentinel/chat-requirements
POST /backend-anon/sentinel/chat-requirements
```

3. 在 Response 中搜索：

```text
proofofwork
difficulty
```

部分前端版本可能使用 `proof_of_work` 或 `pow`，也可能把结果包在 `chat_requirements` 或 `requirements` 对象中。真正要显示的是 PoW 对象内的 `difficulty` 字符串，例如 `063556`。

扩展原样保留这个十六进制字符串，并使用任意精度整数换算十进制。换算时可去掉可选的 `0x` 前缀；前导零不会改变数值，不需要从原始显示中删除。Chrome Console 可用下面的只读表达式交叉核验：

```js
BigInt(`0x${'063556'.replace(/^0x/i, '')}`).toString(10)
// "406870"
```

扩展不会读取或保存同一响应中的 seed、设备指纹、nonce、proof token、requirements token 或 Turnstile 数据，也不会自行求解 PoW。PoW 的数值与位数建议不参与路由正常、错配或冲突判定。

## 控制页面浮窗

- 完整浮窗右上角的横线按钮会切换为极简模式；极简模式显示请求模型、响应路由和 PoW。
- 完整浮窗右上角的方点按钮会切换为迷你模式；迷你模式只显示响应路由和 PoW 十进制值。
- 点击极简浮窗可恢复完整浮窗。
- 在迷你浮窗中，点击左侧窄边区域可将其收纳到窗口右侧；点击其余内容区域可恢复完整浮窗。
- 点击收纳后保留在窗口右侧的窄边条，可恢复迷你浮窗。
- 完整浮窗中的“隐藏浮窗”会将浮窗节点彻底移除，不留下缩小挂边。
- 点击 Chrome 工具栏中的扩展图标，在 Popup 里用“显示浮窗 / 隐藏浮窗”成对按钮控制。
- 隐藏后必须从 Popup 点“显示浮窗”才能恢复，并直接恢复为完整态。

## 判断规则

- 实际路由字段存在且值一致：显示这个精确值，不附加百分比。
- requested 与实际路由都有：相同为正常，不同为错配。
- 只有重载 DOM 的 `data-message-model-slug`：显示“仅取得模型标签 / 未取得实际路由”。
- 模型标签与实际路由不同：同时展示两者，以实际路由字段作为 route，不叫字段冲突。
- `resolved_model_slug` 与 `server_ste_metadata.model_slug` 互相矛盾：显示“实际路由字段冲突”。
- 实际路由字段缺失：路由显示“未取得”。
- `default_model_slug`、回答速度、风格、模型自述和单独的 UI 选择器截图不参与判断。

## HAR 安全提醒

HAR 可能包含聊天正文、请求体、Cookie、Authorization、会话 ID 和其他个人数据。不要把原始 HAR 发到公开论坛或 GitHub。优先使用本扩展导出的脱敏 JSON/Markdown；若 Support 明确要求 HAR，只通过其私有工单渠道提交，并在提交前检查敏感字段。
