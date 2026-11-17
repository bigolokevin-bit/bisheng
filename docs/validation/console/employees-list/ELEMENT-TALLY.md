# EMP-01 / EMP-03 元素核销表（S3-W2 · 夜班 W1）

- 设计源：`docs/product/console-v3/PRD-v0.3.md` §5.3（EMP-01）与 §2.1 EMP-03
- 实现：`src/frontend/platform/src/pages/AgentConsoleV2/EmployeesListPage.tsx`、`EmployeeDetailPage.tsx`、`employeesShared.ts`、`employeesList.css`
- 数据源：`/agent-api/api/employees`、`/api/employee`、`/api/employee-versions`、`/api/budget-usage`（BFF）
- 七态口径：加载 / 正常 / 真空 / 筛选空 / 上游错 / 401 / 403 / 404 —— 逐元素只标注该元素实际承担的态，不承担记 `—`
- 验收腿：均来自 `src/pages/AgentConsoleV2/__tests__/agentConsoleV2Employees.test.tsx`、`EmployeesListErrors.test.tsx`（stub fetch，非真实浏览器）

| elementId | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态 |
|---|---|---|---|---|---|---|---|
| EMP-FILTER-01 | `/api/employees?keyword=` | 正常/筛选空/加载/错 | 读 | action:filter（300ms 防抖，URL 持久） | `v2.search`、`v2.emp01.clearFilters`、`v2.emp01.noMatch` | 关键字防抖重取、无匹配清筛选 | 已核销 |
| EMP-FILTER-02 | `/api/employees?lifecycleState=` | 正常/加载/错 | 读 | action:filter（默认在岗；URL 持久） | `lifecycle.active`、`lifecycle.paused`、`v2.emp.filterAll` | 默认 active、切 paused、全部省略参数 | 已核销（文案偏差：PRD「停用」= 现有 `lifecycle.paused`「已暂停」） |
| EMP-TABLE-01 | `/api/employees?expand=version,workstations,knowledge,pending` | 正常/真空/筛选空/加载/错/401/403 | 读 | 行姓名 → `/agent/employees/:id` | `v2.colName`、`v2.emp01.shortCode`、`v2.colStatus`、`v2.emp.colWorkstation`、`v2.mtx.skills`、`v2.mtx.runs`、`v2.mtx.budgetMonthly` | 六列固定顺序、真实姓名、短码、预算三态、今日运行窗口 | 已核销（技能数列因 E11 无 `skillCount` 恒为 —） |
| EMP-TABLE-02 | 行 `id` | 正常 | 读 | title 属性（不屏显） | `v2.id.employeeRef` | 屏显仅 `员工 · 8位大写`，无裸 `emp_` | 已核销 |
| EMP-ROW-01 | 行 `employeeId` | 正常 | 会话权限（无来源） | `/agent/chat?employeeId=:id` | `chat.dialogue` | 行内对话 href 断言（`agent-v2-emp-chat-*`）；无权限位时不隐藏 | 已核销（依赖共享文件未改：`userContext` 无会话权限位） |
| EMP-ACT-01 | — | 正常 | 新建 grant（无来源） | `/agent/employees/new` | `v2.emp.createEntry` | 页头主按钮 href 断言（`agent-v2-employees-create`）；无 grant 来源时不隐藏 | 已核销（依赖共享文件未改：无 grant 来源） |
| EMP-PAGE-01 | `nextCursor` | 正常/加载/错 | 读 | action:next（追加，无更多按钮消失） | `v2.mtx.loaded`、`v2.emp.nextPage` | 游标下一页、追加、末页按钮消失、失败重试 | 已核销 |
| EMP-EMPTY-01 | 同上 | 真空 | 读 | `/agent/employees/new` | `v2.emp.emptyEmployees`、`v2.emp.createEntry` | 真空与筛选空分离 | 已核销 |
| EMP-ERR-01 | 同上 | 401/403/5xx/网络 | 读 | 重试 / 重新登录 | `v2.emp.authExpired`、`v2.emp.noPermission`、`v2.ed.readFailedTitle`、`v2.retry` | 401、403 无重试、500 重试、网络态 | 已核销 |
| EMP-DETAIL-01 | `/api/employee` | 正常/加载/401/403/404/5xx | 读 | — | `v2.ed.bannerOwner`、`v2.ed.fieldRole` 等 | 身份横幅、404 同体、5xx 独立卡 | 已核销 |
| EMP-DETAIL-02 | `ownerUserId` | 正常 | 读 | — | `v2.emp01.unassigned` | 占位 owner 屏显「未指派」，不发 approval-stats | 已核销 |
| EMP-DETAIL-03 | `/api/employee-versions` | 正常/空 | 读 | — | `v2.ed.chainTitle`、`v2.ed.fieldEffective` | 版本链与生效时间北京时间到分（`YYYY-MM-DD HH:mm`） | 已核销 |
| EMP-DETAIL-04 | `currentVersion.budget` + `/api/budget-usage` | 正常/未配置/缺失/错 | 读 | — | `v2.ed.budgetNone`、`v2.ed.budgetUnset`、`budgetActual` | 已配置 `$` / 未配置 / 缺失 — 三态 | 已核销 |
| EMP-DETAIL-05 | 会话入口 | 正常 | 会话权限（无来源） | `/agent/chat?employeeId=:id` | `v2.navChat` | 详情对话链接 href | 已核销（权限隐藏同 EMP-ROW-01） |
| EMP-DETAIL-06 | 写端点（未接） | 正常（仅公示） | 写 grant + 审计 | — | 固定说明 | 详情危险区只公示「停用/改预算需写权限并记入审计」，零按钮（`agent-v2-ed-danger-readonly`） | 已核销（仅公示，零写入口） |
| EMP-DETAIL-07 | `/api/employee` | 404 | 读 | 返回列表 | `v2.ed.notFound`、`v2.ed.back` | 深链已删对象整页 404，无静默回落 | 已核销 |

## 汇总

- 元素数：16
- 已核销：16（含 2 项「依赖共享文件未改」：EMP-ROW-01 会话权限位、EMP-ACT-01 新建 grant 来源；1 项「仅公示」：EMP-DETAIL-06）
- 待实现：0
- 需共享文件：0（2 项权限来源未改，已在对应行标注）
- 核销率：16 / 16 = **100%**
- 死控件数：**0**（所有可点元素均有真实路由或 action；停用/改预算未渲染为灰色按钮）
## Q2 诚实性复验（2026-11-17 夜）

| 检查 | 结果 | 证据 |
|---|---|---|
| 预算三态：已配置 / 未配置 / 缺失 → — | 通过 | `$1,200.00`；`{}` → 「本版本未配置预算」；无对象 → —（列表与详情） |
| 负责人 `pilot_owner_placeholder` 显「未指派」 | 通过 | 列表行与详情徽标均显「未指派」，原始占位串不在 body 文本中 |
| 裸 emp id 不上屏 | 通过 | 可见文本仅「员工 · AB12CD34」；原始 `emp_AB12CD34` 只在 `title` |
| 时间北京时间到分 / 金额 USD | 通过 | `YYYY-MM-DD HH:mm`、`$12.50`，无 `USD` 后缀 |
| 缺失字段 — | 通过 | 技能数无来源、预算缺失均显 — |

元素数：16　已核销：16　部分：0　待实现：0　需共享文件：0（2 项依赖共享文件未改）　核销率：100%　死控件数：0
