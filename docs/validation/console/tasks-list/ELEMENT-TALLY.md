# TASKS 任务列表 — 元素核销表（L4p4 Q2）

页：`/agent/tasks`　组件：`TasksListPage.tsx`，详情 `TaskDetailPage.tsx`。
口径：READ-PORT-MATRIX —— 缺数据为 null/缺键，前端显 `—`；不得把缺键写成 0 / 正常。

| elementId | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态 |
|---|---|---|---|---|---|---|---|
| tasks.page.head | 静态 | 常态 | 只读 | — | `tasks.*` | 截图 | 已核销 |
| tasks.filters | 查询参数 | 常态 | 只读 | 本页 | `tasks.filter*` | 交互断言 | 已核销 |
| tasks.row | `GET /agent-api/api/tasks` | 加载/空/错误/403 | 只读 | — | — | 单测 | 已核销 |
| tasks.cell.title | 域 | 缺→— | 只读 | 详情 | `tasks.title` | 单测 | 已核销 |
| tasks.cell.status | 域枚举 | 未知→「未知」药丸 | 只读 | — | `tasks.status*` | 单测 | 已核销 |
| tasks.cell.assignee | 身份模块 | 缺→— | 只读 | 员工详情 | `id.*` | 单测 | 已核销 |
| tasks.cell.assigneeRole | 域 | 缺→— | 只读 | — | `tasks.role*` | 单测 | 已核销 |
| tasks.cell.priority | 域枚举 | 缺→— | 只读 | — | `tasks.pri*` | 单测 | 已核销 |
| tasks.cell.due | 域 | 缺→—；北京时间到分 | 只读 | — | `tasks.due` | 单测时区 | 已核销 |
| tasks.cell.progress | 域 | 无进度→—（不写 0%） | 只读 | — | `tasks.progress` | 单测 | 已核销 |
| tasks.cell.updated | 域 | 缺→—；北京时间到分 | 只读 | — | `tasks.updated` | 单测 | 已核销 |
| tasks.cell.source | 域 | 未知→原值 | 只读 | — | `tasks.source*` | 单测 | 已核销 |
| tasks.row.runLink | `runId` | 仅真值渲染 | 只读 | `/agent/runs/:id` | `tasks.runLink` | 单测缺值无链接 | 已核销 |
| tasks.row.expand | 域 | 展开/收起 | 只读 | — | `tasks.expand` | 交互断言 | 已核销 |
| tasks.row.detail | 静态 | 常态 | 只读 | `/agent/tasks/:id` | `tasks.detail` | 链接断言 | 已核销 |
| tasks.state.loading | — | 骨架 | 只读 | — | `common.loading` | 单测 | 已核销 |
| tasks.state.empty | API | 空 + 下一步 | 只读 | — | `tasks.empty*` | 单测 | 已核销 |
| tasks.state.error | API | 错误 + 请求号 + 重试 | 只读 | — | `tasks.error*` | 单测 | 已核销 |
| tasks.state.forbidden | 403 | 整页替换 + 重试 | 只读 | — | `tasks.forbidden*` | 单测 | 已核销 |
| tasks.write.none | — | 零写入口 | 只读 | — | — | 文案扫描 | 已核销 |
| td.page.head | 静态 | 常态 | 只读 | 返回列表 | `tsk.*` | 截图 | 已核销 |
| td.f.desc | 域 | 缺→— | 只读 | — | `tsk.desc` | 单测 | 已核销 |
| td.f.channel | 域 | 缺→— | 只读 | — | `tsk.channel` | 单测 | 已核销 |
| td.anomaly | 域 | 缺键→不渲染块 | 只读 | — | `tsk.anomaly*` | 单测 | 已核销 |
| td.overdue | 域 | 无截止→不渲染 | 只读 | — | `tsk.overdue` | 单测 | 已核销 |
| td.progress | 域 | 无进度→— | 只读 | — | `tsk.progress` | 单测 | 已核销 |
| td.audit | 关联 | 仅真值渲染 | 只读 | `/agent/audit` | `tsk.auditLink` | 单测缺值无链接 | 已核销 |
| td.state.forbidden | 403 | 整页替换 + 重试 | 只读 | — | `tsk.forbidden*` | 单测 | 已核销 |
| td.write.none | — | 零写入口 | 只读 | — | — | 文案扫描 | 已核销 |

## 本轮（Q2）结论

扫描 `TasksListPage.tsx` / `TaskDetailPage.tsx`：唯一的 `?? 0` 是 `listRes?.status ?? 0`（HTTP 状态码文案，非数据值）；无成本/比率路径；无「正常 / 健康 / 无风险」正向断言。**三类缺陷均未发现，记为已核销无缺陷。**

## 合计

元素 29 / 已核销 29 / 核销率 100% / 死控件 0。
## 2026-11-17 Q2 复核（基座 3c61494）

- 假 0：唯一 `?? 0` 是 `listRes?.status ?? 0`（HTTP 状态码文案，非数据值）；无成本/比率路径。
- 身份：负责人与创建人均经 `actorView` → identity 模块（`employeeLabelById` / `humanLabel`），无裸 `emp_…` / `human:1`；未指派显「未指派」。
- 工程语言：ISO 串仅用于窗口参数与新鲜度戳（上屏经 `formatMoment`），无裸 JSON 字段名、`undefined`、`NaN`。
- 四态：加载/正常/空/错齐；错误与 403 屏均带 `ReqId`（`agent-v2-tsk-error-reqid` / `-banner-reqid`，详情 `-error`/`-forbidden`），403/404 同体仅状态码不同。
- 结论：本轮未发现需改代码的缺陷，如实记为「已核销无缺陷」。
