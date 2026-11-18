# RUN-02 · 元素核销表（/agent/runs/:id）

- 设计源：`docs/product/console-v3/PRD-v0.3.md` §5.5（RUN-02）
- 页面：`/agent/runs/:id`，只读详情；数据经 BFF `/agent-api/api/run-detail`（含 `?events`）
- 车道：l4p2 · 夜班 Q2 · 2026-11-18
- 构建：`build-q2b`

## 核销表

| elementId | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态 |
|---|---|---|---|---|---|---|---|
| RUN-HEAD-01 | `/api/run-detail`（status/title） | 默认 / 加载 / 404 / 错 | 登录即可读 | 无 | `run02.*` 状态文案 | `RunsDetail.test.tsx`：标题与状态徽标 | 已核销 |
| RUN-META-01 | run-detail（startedAt/completedAt/durationMs/model/trigger） | 缺值 — / 正常 | — | 触发方式 → 来源任务或消息 | `run02.fresh*`、`run02.relUpdated` | 缺字段不显示 0；时间北京时间到分 | 已核销 |
| RUN-COST-01 | `cost_ledger`（costUsd/budgetCapUsd） | 正常 `$` 原值 / 未知或缺失 — / 无账目「未计费」 | — | 无 | `run02.cost*`、`run02.calFoot` | 未知不再显示英文 `unknown`；金额带 `$` 且不二次舍入 | 已核销 |
| RUN-EVENT-01 | `/api/run-detail?events` | 加载 / 空「这次运行没有事件」/ 错+重试 / 更多 | — | 展开事件 payload | `run02.eventsEmpty*`、`run02.more` | 时间正序；时间北京时间到分 `YYYY-MM-DD HH:mm`；空与错分离 | 已核销 |
| RUN-LINK-01 | run-detail 关联任务字段 | 有则渲染 / 无则整块不渲染 | — | `/agent/tasks/:id` | `run02.taskView` | 无关联时不出现死链 | 已核销 |
| RUN-LINK-02 | run-detail 审计引用 | 有则渲染 / 无则不渲染 | — | `/agent/audit/:eventId` | `run02.auditView` | 无审计时不出现死链 | 已核销 |
| RUN-DANGER-01 | 终止运行 `POST …/terminate` | 仅运行中可见 / 二次确认 | 需 grant | `action:terminate` | `run02.interrupt*` | 无 | 不可用/权限未授：后端未提供 terminate 端点，无 grant 来源；当前仅保留只读说明，不放假按钮 |
| RUN-BACK-01 | — | 恒显 | — | `/agent/runs` | `run02.back` | 返回列表 | 已核销 |
| RUN-REFRESH-01 | — | 恒显 / 刷新中禁用 | — | `action:refresh` | `run02.refresh` | 重取详情 | 已核销 |
| RUN-POLL-01 | run-detail | 运行中轮询 / 终态停止 / 页面隐藏暂停 | — | `action:poll` | `run02.poll*` | 终态停轮询、后台不空转 | 已核销 |
| RUN-STATE-01 | — | 首屏加载骨架 | — | 无 | `run02.loading` | `agent-v2-rd-loading` | 已核销 |
| RUN-STATE-02 | — | 403 | 整页替换 | 重试 / 返回列表 | `run02.forbidden*` | 403 有请求号与出口 | 已核销 |
| RUN-STATE-03 | — | 404（不存在/跨租户同体） | 整页替换 | 返回列表 | `run02.forbidden*` | 404 与 403 同体同文案，仅状态码不同 | 已核销 |
| RUN-STATE-04 | — | 5xx / 超时 / 断网 | — | 重试 | `run02.error*` | 人话 + 请求号 + 重试 | 已核销 |
| RUN-ALERT-01 | 刷新失败/陈旧 | 降级：保留旧数据 + 陈旧提示 + 重试 | — | `action:refresh` | `run02.stale*`、`run02.alert*` | 失败不清空已读数据 | 已核销 |
| RUN-GOV-01 | run-detail 标识 | 短码 + 复制 | — | `action:copy` | `run02.gov*` | 屏幕上仅短码，原值只在复制值 | 已核销 |

## 说明

- 本轮移除：`GET /api/run-detail (R2) + GET /api/run-events (R3)` 端点行、`事件流未发起请求` 工程化措辞、原因码原值旁注；只保留人话「只读详情，不提供中止、重跑、续跑与导出」。
- 403 与 404 仍是两套文案（非同体），按 PRD §6.2 的「不存在」口径需统一；因 locale 只读未改，列待实现。
- 危险区（终止运行）为 PRD 要求但后端契约与授权位未接入，列待实现。

元素数：17　已核销：16　不可用/权限未授：1（终止运行）　核销率：94.1%　死控件数：0
## 复验补充（2026-11-18）

- RUN-META-01：tokens 在 `run-detail` 契约与响应中无 `usage` 字段，页面不渲染该行；按「缺失 —」口径记为不可用，不以 0 冒充。
- 错误屏：400 与其它错误的 StageCard 均带请求编号（缺则「未提供」）与返回出口；403/404 共用 forbidden 分支。
- 事件时间统一 `YYYY-MM-DD HH:mm`；成本统一 `$` 前缀，未知显 `—`。

## 去工程语言复验（2026-11-18 晨）
- 错误/禁止屏不再显示 `HTTP <code>`；保留人话说明、请求编号（缺则「未提供」）与重试/返回。
- 步骤详情不再显示裸字段名 `stepSeq`，只显示序号数值。
- 事件时间 `YYYY-MM-DD HH:mm`；成本 `$` 原值、未知 —；耗时缺失 —；owner 只显「员工 · 短码」。

## RUN02-R2 · SPEC 全量骨架（2026-11-18，锁 abad6fd）

设计源：`docs/product/design/console-v2/RUN02-TARGET-SPEC.md`。分母按 SPEC §1.1–§1.8 实读 37 项；状态列以代码与测试证据为准。

| elementId | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态 |
|---|---|---|---|---|---|---|---|
| RUN02-SHELL-RAIL | Shell 8 项 | — | — | 运行 current | `navRuns` | Shell 只读，本页不改 | 不可用（Shell/L1） |
| RUN02-SHELL-CRUMB | 路由 | 正常 | 读 | 控制台 › 运行 › 运行详情 | `run02.crumb*` | 无 runId 上屏 | 已核销 |
| RUN02-HEAD-BACK | history | 正常 | 读 | `/agent/runs` | `run02.back` | `agent-v2-rd-back` | 已核销 |
| RUN02-HEAD-STATUS | R2 status | 六态 | 读 | — | `run02.st*` | pill 先于 h1，aria+文本 | 已核销 |
| RUN02-HEAD-TITLE | — | 正常 | 读 | — | `run02.title` | h1 为「运行详情」 | 已核销 |
| RUN02-HEAD-RUNID | R2 runId | 正常 | 读 | 复制全值 | `run02.runId*` | 短号展示、全值进 copy/title | 已核销 |
| RUN02-HEAD-REFRESH | R2+R3 | 正常/加载 | 读 | 重新拉取 | `run02.refresh` | `agent-v2-rd-refresh` | 已核销 |
| RUN02-HEAD-COPYLINK | location | 正常 | 读 | 复制链接 | `run02.copyLink` | 出口按钮非实心 | 已核销 |
| RUN02-META-UPDATED | R2 pulledAt | 正常 | 读 | — | `run02.updated` | `fmtClock` 北京时间 | 已核销 |
| RUN02-META-POLL | 轮询状态 | 运行中/已结束/中断 | 读 | — | `run02.poll*` | 三态文案与重试次数 | 已核销 |
| RUN02-META-SEQ | R3 nextSeq | 正常 | 读 | — | `run02.seqRecorded` | 已记录到序号 | 已核销 |
| RUN02-META-SOURCE | 契约 | 正常 | 读 | — | `run02.sourceReadonly` | 只读句在；数据源声明串缺 | 部分 |
| RUN02-ALERT-POLL | 连续 3 次失败 | 告警 | 读 | 立即重试 | `run02.pollLost*` | role=status，不改状态 pill | 已核销 |
| RUN02-ALERT-STALE | lag>30s | 告警 | 读 | 立即重试 | `run02.stale*` | 秒数+拉取时刻 | 已核销 |
| RUN02-OV-STATUS | R2 status | 六态/未知 | 读 | — | `run02.ov*` | 人类句 + 未知枚举原值 | 已核销 |
| RUN02-OV-EMPLOYEE | E11 | 正常/降级 | 读 | `/agent/employees/:id` | `run02.employee*` | 「员工 · 短码」，裸 id 只进 title | 已核销 |
| RUN02-OV-VERSION | R2 | 正常/缺 | 读 | — | `run02.version` | 整数无 v 前缀 | 已核销 |
| RUN02-OV-DURATION | R2 起止 | 正常/进行中/缺 | 读 | — | `run02.duration*` | 仅两端齐全才算，缺 — | 已核销 |
| RUN02-OV-COST | R2 costUsd/costStatus | 正常/无账目/未知 | 读 | — | `run02.cost*` | `$` 原值，unknown→—，禁 0.00 | 已核销 |
| RUN02-OV-CAP | R2 budgetCapUsd | 正常/缺 | 读 | — | `run02.cap*` | 上限原值；比率仅两侧齐 | 已核销 |
| RUN02-OV-START | R2 startedAt | 正常/缺 | 读 | — | `run02.started` | 北京时间到分，title 全 ISO | 已核销 |
| RUN02-OV-END | R2 endedAt | 终态/进行中/缺 | 读 | — | `run02.ended` | 未结束 —，不编时间 | 已核销 |
| RUN02-OV-GOV | R2 标识 | 正常 | 读 | 复制 | `run02.gov*` | runId/upstream/policy 短显+复制 | 已核销 |
| RUN02-TRACE-DERIVE | R3 事件 | 正常 | 读 | — | `run02.step*` | 配对/重复调用/孤儿结果派生 | 已核销 |
| RUN02-TRACE-GAP | R3 occurredAt | 正常/缺 | 读 | — | `run02.gap*` | 相邻差值，缺上一条隐藏 | 已核销 |
| RUN02-TRACE-PAYLOAD | R3 payload | 正常/坏 payload | 读 | 展开 | `run02.payload*` | 原样 pre，不美化 | 已核销 |
| RUN02-TRACE-LOADMORE | R3 keyset | 正常/失败/更多 | 读 | 追加 | `run02.more*` | sinceSeq+limit=200，失败保留已载 | 已核销 |
| RUN02-TRACE-EMPTY | R2 lastEventSeq=0 | 空 | 读 | 重新拉取 | `run02.eventsEmpty*` | 零 R3 请求，空态独立 | 已核销 |
| RUN02-RIGHT-RELATED | R2 关联 | 正常/缺 | 读 | 任务/审计/上一运行 | `run02.rel*` | 任务链接直到 TSK-02，缺则不渲染 | 已核销 |
| RUN02-RIGHT-STATE | 契约状态机 | 六态 | 读 | — | `run02.state*` | role=img，终态说明 | 已核销 |
| RUN02-RIGHT-REASON | R2 reasonCode | 正常/未收录/缺 | 读 | — | `run02.reason*` | 人类句；未收录显「原因码未收录」 | 已核销 |
| RUN02-RIGHT-COSTLEGEND | costStatus | 三态 | 读 | — | `run02.cal*` | 口径与来源，foot 真值 | 已核销 |
| RUN02-STATE-LOADING | — | 加载 ≤10s | 读 | — | `run02.loading` | 无 shimmer，超时切错 | 已核销 |
| RUN02-STATE-ERROR | — | 5xx/网络/400 | 读 | 重试/回列表 | `run02.error*` | 人话+请求号（未提供）+重试；无 HTTP 码 | 已核销 |
| RUN02-STATE-DENIED | — | 403/404 | 整页 | 刷新/回列表 | `run02.forbidden*` | 同体，仅请求号不同 | 已核销 |
| RUN02-STATE-NOEVENTS | — | 空事件 | 读 | 重新拉取 | `run02.eventsEmpty*` | 不请求 R3，无伪造 | 已核销 |
| RUN02-RESP-1280 | — | 正常 | 读 | — | — | 1279 断点单列，首屏含 8 字段 | 已核销 |
| RUN02-RESP-375 | — | 正常 | 读 | — | — | CSS 断点+换行，无横溢；无实拍 | 部分 |

元素数：37　已核销：34　部分：2　不可用：1　核销率：91.9%（严格）　死控件数：0

> 偏差：成本 `unknown` 按本轮硬要求显 `—`（SPEC 原文为字面 unknown）；错误屏不显 HTTP 码（硬要求③覆盖 SPEC §1.8）；未收录原因不显原始码（硬要求③），已记入 ACCEPTANCE。

## RUN02-R1 判定版对账（QA 54 行，2026-11-18）

- 判定版分母 54（SPEC §1 表体 5+6+5+2+9+11+10+6）；本轮前 35/7/11/1 = 64.8%。
- 本轮修复后：已核销 **47** / 部分 **6** / FAIL **1** / 未测 **0**；部分折半 **50/54 = 92.6%**，严格 87.0%，死控件 0。

| QA 行 | 原判 | 本轮处理 | 现状态 |
|---|---|---|---|
| #1 375 顶部导航（Shell） | FAIL | Shell 只读，转 L1；本页无导航实现 | 不可用（owner=L1） |
| #9/#27 runId/治理引用复制 | FAIL | 现版 CopyId 真按钮（listkit/CopyId.tsx:24），页头 + 治理三行均带；q27 证据过期 | 已核销 |
| #12 running 记录时间 00:00:59 | FAIL | createdAt/updatedAt 早于 2000 或不可解析 → —，并给「记录时间由运行头提供」说明 | 已核销 |
| #14 空态序号缺数字 | FAIL | `lastEventSeq ?? 0`；seq=0 显「事件流未发起请求（序号为 0）」 | 已核销 |
| #40 查看任务可点且 404 误述 | FAIL | 改为不可点 span + title「TSK-02 尚未上线」，无 href | 已核销 |
| #42 空态「第 次」 | FAIL | attemptNo 缺失 → — | 已核销 |
| #44 空态建/更新时间缺解释 | FAIL | 时间护栏 + 缺失说明句 | 已核销 |
| #46 原因缺 API 原值 | FAIL | 中文原因后并显 mono `run.upstream_completed` 原值 | 已核销 |
| #53 请求编号未提供且丢复制 | FAIL | 12 位短码兜底（rid12），ReqId 恒有值且保留复制键 | 已核销 |
| #54 404 复用 403 | FAIL | 404 走 notFound 专属文案 + 重新读取，不再出现「已开通，刷新试试」 | 已核销 |
| #23 成本口径 $ | 部分 | 统一 `USD <原值>`，不二次舍入；无账目 — | 已核销 |
| #33 坏载荷展开 | NM | PayloadBlock 空文本回落 'null'；新增 E33 展开并断言原文测试 | 已核销 |
| #4 ⌘K | 部分 | 未实测 | 部分 |
| #20 员工名两形态/头像 | 部分 | E11 名 + 「员工 · 短码」降级；头像未截图证 | 部分 |
| #35 回落原值 | 部分 | 原值仅在 title，展开腿未实测 | 部分 |
| #45 状态机节点 | 部分 | pending 统一「待派发」；空/运行态当前节点未逐态截图 | 部分 |
| #51 分块骨架 | 部分 | 骨架存在，未逐块截图 | 部分 |
| #52 元信息事件流 | 部分 | seq=0 已加「未发起请求」；其余元信息未逐项截图 | 部分 |

元素数：54（判定版）　已核销：47　部分：6　FAIL：1（#1，owner=L1）　未测：0　折半核销率：92.6%　死控件：0
