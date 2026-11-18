# EMP-03 员工详情 · 元素核销表（Q2 冲刺）

- 设计源：PRD v0.3 §5 **没有 EMP-03 元素表**；M2-PRD-DEEP 只引用「EMP-03 详情骨架」，deep/02 §1.5–1.12 给出页面区块。本表 **01–07** 沿用 `employees-list/ELEMENT-TALLY.md` 已定义的 `EMP-DETAIL-01..07`；**08–17 是本轮按 deep/02 区块补的临时段号**，不是 PRD 原始编号，设计源补号后统一替换。
- 实现：`src/frontend/platform/src/pages/AgentConsoleV2/EmployeeDetailPage.tsx`、`employeesShared.ts`、`employeeDetail.css`。
- 数据源：E2 员工、E5 生效配置、E10 工位、E15 版本、R6 运行统计、P9 预算、AP8 审批统计、T5 任务、R5 运行、A3 审计。
- 七态口径：加载 / 正常 / 空 / 错 / 401 / 403+404 同体 / 5xx+网络。空值 `—`，0 不冒充真实额度。
- 本轮关键修正：403/404 同体中性；R5 带 `since` 窗口（原先无过滤会被 BFF 拒绝）；A3 改用 `actorId=employee:<id>`（原 `employeeId` 非契约参数）；预算 0 按 POLICY 视为「不设上限」→ 未配置，不再显示 `$0.00`；单键缺失显 `—`；工位/授权原值仅进 title；任务行补真实详情路由。

| elementId | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态 |
|---|---|---|---|---|---|---|---|
| EMP-DETAIL-01 | `/api/employee` | 正常/加载/401/403/404/5xx | 读 | — | `v2.ed.bannerOwner`、`v2.ed.fieldRole` | 身份横幅、404 同体、5xx 独立卡；5xx 无人话外的 HTTP 码 | 已核销 |
| EMP-DETAIL-02 | `ownerUserId` | 正常 | 读 | — | `v2.emp01.unassigned` | 占位 owner 显「未指派」，不发 approval-stats | 已核销 |
| EMP-DETAIL-03 | `/api/employee-versions` | 正常/空/加载/错 | 读 | — | `v2.ed.chainTitle`、`v2.ed.fieldEffective` | 版本链只用 E15；生效时间北京时间到分；空态独立 | 已核销 |
| EMP-DETAIL-04 | `currentVersion.budget` + `/api/budget-usage` | 正常/未配置/缺失/错 | 读 | — | `v2.ed.budgetMonthly`、`budgetPerRun`、`budgetNone`、`budgetActual` | 三键同屏；0=不设上限→未配置；单键缺失 `—`；账本缺失 `—` | 已核销 |
| EMP-DETAIL-05 | 会话入口 | 正常 | 会话权限（无来源） | `/agent/chat?employeeId=:id` | `v2.navChat` | 详情对话链接 href；无权限位时不额外伪造门控 | 已核销 |
| EMP-DETAIL-06 | 写端点（未接） | 正常（仅公示） | 写 grant + 审计 | — | 固定说明 | 危险区只公示，零按钮（`agent-v2-ed-danger-readonly`） | 已核销（仅公示） |
| EMP-DETAIL-07 | `/api/employee` | 404 | 读 | `/agent/employees` | `v2.ed.notFound`、`v2.ed.back` | 深链已删对象整页 404，不静默回落 | 已核销 |
| EMP-DETAIL-08 | R6 + P9 + AP8 | 正常/空/加载/错 | 读 | — | `v2.ed.kpi_*`、`ov.kpiWeekRuns`、`ov.range7d` | 四 KPI 读数；无数据 `—`；窗口标注（运行/成功=近 7 天，成本=本月） | 已核销（读数；M1 无下钻） |
| EMP-DETAIL-09 | E5 `grants[]` | 正常/空/加载/错 | 读 | — | `v2.ed.blastTitle`、`blastEmpty`、`blastExpires` | 授权列表短码 + 到期；scope/actions/source 仅进 title；无回收写入口 | 已核销（只读列表） |
| EMP-DETAIL-10 | E10 `/api/workstations` | 正常/空/加载/错 | 读 | — | `v2.ed.stationsTitle`、`stationsEmpty` | 工位短码 + 已知渠道；binding/status 仅进 title；无绑定写入口 | 已核销（只读） |
| EMP-DETAIL-11 | E2 生命周期 | 正常 | 读 | — | `v2.ed.lifecycle.*`、`bannerCreated`、`bannerUpdated` | 六态中文；创建/更新时间北京时间到分；原值进 title | 已核销 |
| EMP-DETAIL-12 | T5 `/api/tasks` | 正常/空/加载/错 | 读 | `/agent/tasks/:id` | `v2.ed.tasksTitle`、`tasksEmpty`、`tsk.statusLabel.*` | 员工维度任务；状态中文；行有真实详情链接 | 已核销（字段子集） |
| EMP-DETAIL-13 | R5 `/api/runs` | 正常/空/加载/错 | 读 | `/agent/runs/:id` | `v2.ed.runsTitle`、`runsEmpty`、`runs.status.*` | 带 `since` 的 30 天窗口；状态中文；行有运行详情 | 已核销（字段子集） |
| EMP-DETAIL-14 | A3 `/api/audit` | 正常/空/加载/错 | 读 | `/agent/audit/:eventId` | `v2.ed.auditTitle`、`auditEmpty`、`auditWindow` | `actorId=employee:<id>` + 30 天窗口；事件动作人话；行有审计详情 | 已核销（默认过滤） |
| EMP-DETAIL-15 | `?tab=` | 正常 | 读 | 五 Tab 深链 | `v2.ed.tab_*` | 刷新/深链保持当前 Tab；切换不重复取数 | 已核销 |
| EMP-DETAIL-16 | 全页状态 | 401/403/404/5xx/网络 | 读 | 重试 / 返回列表 | `v2.ed.unauthorized`、`notFound`、`errorQuery`、`v2.retry` | 401 单独；403/404 同体中性；5xx/网络人话+请求编号+重试 | 已核销 |
| EMP-DETAIL-17 | 全量重取 | 正常/加载 | 读 | `action:refresh` | `v2.ed.updated`、`v2.ov.refresh` | 刷新按钮重取 E2+9 路；更新时间到分 | 已核销 |

## 汇总

- 元素数：17（01–07 既有行；08–17 本轮按 deep/02 区块补的临时段号）
- 已核销：17（其中 08/09/10/12/13/14 为只读/字段子集范围，已在本行注明）
- 待实现：0（本表范围）；需共享文件：0；死控件：0
- 核销率：17 / 17 = **100%**（按本表元素定义）
- 设计源缺口：PRD §5 无 EMP-03 表；08–17 待设计源统一编号，不是伪造 PRD 号。

## 本表未纳入（有端点/写权限才做）

- 职权关系图与 grant 详情抽屉（E5 只有 grants 数组；关系图需 2-hop 聚合）。
- 工位绑定/解绑、生命周期迁移、版本发布/恢复、预算调整（写端点未接 BFF，M1 只读）。
- 对话面板内嵌消息流（仅保留跳转 `/agent/chat?employeeId=`）。
- 审计快捷过滤 chips、任务状态筛选、运行 trace drawer（列表级详情路由已提供）。
