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
