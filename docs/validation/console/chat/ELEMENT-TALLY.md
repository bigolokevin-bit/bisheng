# CHAT · 元素核销表（/agent/chat）

- 设计源：`docs/product/console-v3/PRD-v0.3.md` §5.2（CHAT）
- 页面：`/agent/chat`，壳层 `AgentConsoleShell`，数据经 BFF `/agent-api/api/console-sessions*`
- 车道：l4p2 · 夜班 W1 · 2026-11-17
- 核销对象：生产构建 `build-night1`（entry `assets/js/index-iGaMyqfa.js`）

## 核销表

| elementId | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态 |
|---|---|---|---|---|---|---|---|
| CHAT-SESS-01 | GET `/api/console-sessions`（items: sessionId/title/employeeId/updatedAt） | 加载骨架 / 正常 / 列表空 / 401 / 403≡404 / 5xx / 超时或断网 | 401 整页；403/404 同体 | 点条目切换，写入 `?session=` | `chat01.listTitle`、`listEmptyTitle`、`listEmptyHint` | 组件测试：列表渲染、空态、403≡404、502、超时 | 已实现 |
| CHAT-SESS-02 | —（PRD 期望 POST 后取 id） | — | 写权限未接入 | `action:newSession` | — | 无 | 待实现（BFF 无建会话端点契约，见回执） |
| CHAT-THREAD-01 | GET `/api/console-sessions/<id>`（messages: role/at/text） | 加载 / 正常 / 会话空 / 403≡404 / 5xx / 超时 / 深链失效 | 403/404 同体 | 无 | `chat01.msgEmpty`、`msgEmptyHint`、`deniedThreadTitle`、`sessionMissing` | 气泡仅经 React children 渲染；北京时间 `fmtChatTime`；无内容显「暂无内容」 | 已实现 |
| CHAT-THREAD-02 | 消息 `citations[]` | 无引用不显示来源区 | — | 来源 → P5 原文抽屉 | — | 无 | 待实现（当前 BFF 详情契约无 citations 键） |
| CHAT-THREAD-03 | 单条消息 `error` | 失败气泡「未送达 · 请求号」+ 重试 | — | `action:retry(messageId)` | — | 无 | 待实现（现为输入条级失败块，非消息级） |
| CHAT-INPUT-01 | — | 无会话禁用并提示先选 / 发送中禁用 / 正常 | — | Enter 发送、Shift+Enter 换行 | `chat01.placeholder`、`inputAria`、`composerHint` | 输入法组合态不误发；失败保留草稿 | 已实现 |
| CHAT-INPUT-02 | POST `/api/console-sessions/<id>/messages` `{requestId, content}` | 发送中 spinner / 失败保留草稿 / 502 人话 / 超时 / 断网 / 403≡404 | 会话不可读时禁用 | `action:send`，同一次提交重试复用 requestId | `chat01.send`、`sending`、`sendFailTitle`、`sendFailKeep`、`retrySend` | 上游失败不落假气泡；502 显示请求号 | 已实现 |
| CHAT-HEAD-01 | 会话详情 title、（model 无来源） | title 空 → 「未命名会话」 | — | 无 | `chat01.untitled` | 无裸 `ses_` id 上屏；model 字段缺契约 | 部分（model 待实现） |
| CHAT-HEAD-02 | — | 仅 ≤900px 显示 | — | `action:backToList` | `chat01.backToList` | 375 断点显示，宽屏隐藏 | 已实现（W1 新增） |
| CHAT-STATE-01 | — | 首屏加载 ≤10s，超时转错误 | — | 重试 | `chat01.loading` | 骨架不被误判为空 | 已实现 |
| CHAT-STATE-02 | — | 401 / 403 / 404 | 整页替换 | 重试、返回列表 | `deniedTitle`、`deniedBody`、`auth.expired` | 403 与 404 文案完全一致 | 已实现 |
| CHAT-STATE-03 | — | 5xx / 508 / 超时 / 断网 | — | 重试 | `readFail`、`unavailableTitle`、`readFailHint`、`unavailableHint` | 显示一个状态码 + 请求号 | 已实现 |
| CHAT-EMPTY-01 | — | 列表空 | — | 「去员工页」→ `/agent/employees` | `listEmptyTitle`、`listEmptyHint`、`listEmptyGo` | 空态不复用错误态 | 已实现 |
| CHAT-EMPTY-02 | — | 未选会话 | — | 点左侧条目 | `selectHint`、`threadHint` | 宽屏提示选会话 | 已实现 |
| CHAT-EMPTY-03 | — | 会话内 0 条消息 | — | 输入条发送 | `msgEmpty`、`msgEmptyHint` | 不显示演示回声 | 已实现 |
| CHAT-EMPTY-04 | — | 深链会话不存在 | — | 返回列表 | `sessionMissingTitle`、`sessionMissing` | 不静默回落到最新会话 | 已实现 |

## 空态代次

| 代次 | 触发 | 呈现 | testid | 判定 |
|---|---|---|---|---|
| E1 列表空 | 接口 200 且 items 为空 | 左栏空态 + 去员工页入口 | `agent-v2-chat-list-empty` | 与错误态分离 |
| E2 未选会话 | 有会话但未选中 | 右栏选择提示 | `agent-v2-chat-idle` | 不自动选中避免误读 |
| E3 会话空 | 详情 200 且 messages 为空 | 居中「暂无消息」+ 首条提示 | `agent-v2-chat-messages-empty` | 无演示回声 |
| E4 深链失效 | `?session=` 不在列表 | 会话不存在 + 返回列表 | `agent-v2-chat-thread-missing` | 不静默回落 |
| E5 窄屏返回 | ≤900px | 线程头显示「返回会话列表」 | `agent-v2-chat-back` | 宽屏隐藏 |

## 375 实拍结论（2026-11-17 22:11）

- 环境：生产构建 `build-night1`，`vite preview` 4179，headless Chrome `--window-size=375,812`。
- 实拍结果：`/agent/chat` 在无登录会话时被重定向到登录页，未进入直聊页；登录页自身存在右侧横向溢出（非本页，属全局登录页问题）。
- 结论：**直聊页 375 布局未取得登录态实拍**，本表不据此判通过；仅以组件测试与 CSS 断点（≤900px 上下排、≤767px 输入条粘底、`.cchat-back` 显示）为据。已列入未测项，需真实会话补拍。

元素数：16　已核销：12　部分：1　待实现：3　核销率：75.0%　死控件数：0
## Q2 空态诚实性复验（2026-11-17 夜）

| 检查 | 结果 | 证据 |
|---|---|---|
| 0 会话空态不暗示历史 | 通过 | 仅「还没有会话」+「与数字员工开始对话后，会话会出现在这里。」；无「历史」字样，会话行数 0 |
| 空态不重复 | 通过 | 列表卡说一次，右栏只显选择提示 |
| 未选会话时输入禁用 | 通过 | 输入框与发送按钮均 disabled |
| 空态给出下一步 | 通过 | 「去员工页」→ `/agent/employees` |

元素数：16　已核销：12　部分：1　待实现：3　核销率：75.0%　死控件数：0
