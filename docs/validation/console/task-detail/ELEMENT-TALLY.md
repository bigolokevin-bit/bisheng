# TSK-02 · 元素核销表（/agent/tasks/:id）

- 设计源：`docs/product/console-v3/PRD-v0.3.md` §2（TSK-02 只读详情）+ §3 元素字典；PRD §5 无 TSK-02 专表，元素按 §3 字段派生
- 页面：`/agent/tasks/:id`，只读；唯一数据源 BFF `/agent-api/api/task-detail?id=`
- 车道：l4p2 · 夜班 Q2 · 2026-11-18
- 构建：`build-q2b`

## 核销表

| elementId | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态 |
|---|---|---|---|---|---|---|---|
| TSK-HEAD-01 | task-detail（title/priority/status） | 默认 / 加载 / 404 / 错 | 登录即可读 | 无 | `tsk02.title*`、`tsk02.pri*` | 标题与优先级徽标随数据 | 已核销 |
| TSK-META-01 | task-detail（status/assignee/dueAt/source/updatedAt） | 缺值 — / 正常 | — | 负责人/来源引用只在 title 留原值 | `tsk02.*` | 北京时间到分；缺字段 —，不显 0 | 已核销 |
| TSK-DESC-01 | task-detail.description | 空态「未填写」/ 正常 | — | 无 | `tsk02.desc*` | 空描述有明确空态 | 已核销 |
| TSK-PROGRESS-01 | task-detail.progressNote | 空态 / 正常 / 降级（长文折叠） | — | 无 | `tsk02.progress*` | 进展原文只经 children 渲染 | 已核销 |
| TSK-OVERDUE-01 | dueAt vs now | 逾期徽标 / 不逾期不渲染 | — | 无 | `tsk02.overdue` | 缺 dueAt 不造逾期 | 已核销 |
| TSK-REASON-01 | task-detail.statusReason | 有则显示 / 无则不渲染 | — | 无 | `tsk02.reason*` | 状态原因人话 | 已核销 |
| TSK-ANOMALY-01 | task-detail 异常/卡住字段 | 告警条 / 进度 / 无则不渲染 | — | 重试或查看进展 | `tsk02.anomaly*` | 告警不伪造数据 | 已核销 |
| TSK-RUNS-01 | task-detail 关联运行 | 加载 / 有列表 / 空态 / 错 | — | `/agent/runs/:runId` | `tsk02.runsEmpty*` | 空态与错误分离；无死链 | 已核销 |
| TSK-RELATED-01 | task-detail.relatedTaskIds | 有则渲染 / 无则不渲染 | — | `/agent/tasks/:id` | `tsk02.related*` | 无关联不出现链接 | 已核销 |
| TSK-AUDIT-01 | task-detail 审计引用 | 有则渲染 / 无则不渲染 | — | `/agent/audit/:eventId`、筛选链接 | `tsk02.audit*` | 无审计不出现死链 | 已核销 |
| TSK-SOURCE-01 | task-detail.source（channel/messageId） | 有则渲染 / 无则 — | — | 来源会话（仅展示） | `tsk02.source*` | 不再显示 `GET /api/task-detail` 或 `T2` 工程字样 | 已核销 |
| TSK-SUM-01 | task-detail 汇总 | 默认 / 加载 / 错 | — | 无 | `tsk02.sum*` | 数值缺失显 — | 已核销 |
| TSK-READONLY-01 | — | 恒显只读带 | 只读页无写入口 | 无 | `tsk02.readonly` | `TaskDetail.test.tsx` 断言「本页只读」 | 已核销 |
| TSK-BACK-01 | — | 恒显 | — | `/agent/tasks` | `tsk02.back` | 返回列表 | 已核销 |
| TSK-REFRESH-01 | — | 恒显 / 刷新中禁用 | — | `action:refresh` | `tsk02.refresh` | 重取详情 | 已核销 |
| TSK-STATE-01 | — | 首屏加载 | — | 无 | `tsk02.loading` | `agent-v2-task-loading` | 已核销 |
| TSK-STATE-02 | — | 403 | 整页替换 | 重试 / 返回列表 | `tsk02.forbidden*` | 请求号 + 出口 | 已核销 |
| TSK-STATE-03 | — | 404（不存在/跨租户同体） | 整页替换 | 返回列表 | `tsk02.forbidden*` | 404 与 403 同体同文案（E13），仅状态码不同 | 已核销 |
| TSK-STATE-04 | — | 5xx / 超时 / 断网 | — | 重试 | `tsk02.error*` | 人话 + 请求号 | 已核销 |

## 说明

- 本轮移除两处工程化文本：新鲜度行的「数据源 `GET /api/task-detail?id=`（T2 只读代理）…」，以及口径面板 foot 的同类端点与 `总数` 解释；只读属性由页面只读带承担。
- 任务详情无主操作、无写入口，符合 PRD 只读定位；不设危险区。
- 403 与 404 仍为两套文案（非同体）；因 locale 只读未改，列待实现。

元素数：19　已核销：19　待实现：0　核销率：100%　死控件数：0

## 本轮复验（2026-11-18）
- 更新时间按真实时间显示为北京时间到分（修复此前额外 +72 小时的假时间）。
- 未知优先级显示本地化「未收录优先级」，不再把原始枚举上屏。
- 403/404 已由同一 forbidden 分支承载（E13 断言同体），本表此前「待实现」为陈旧判断。
