# EMP-03 员工详情 · 元素核销表（Q2 骨架）

- 设计源：PRD v0.3 §5 **没有 EMP-03 元素表**；本骨架收录既有 `docs/validation/console/employees-list/ELEMENT-TALLY.md` 已定义的 `EMP-DETAIL-01..07`，**不造新 ID**。设计源补号后再扩。
- 实现：`src/frontend/platform/src/pages/AgentConsoleV2/EmployeeDetailPage.tsx`。
- 数据源：E2 员工、E5 生效配置、E10 工位、E15 版本、R6 运行统计、P9 预算、AP8 审批统计、T5 任务、R5 运行、A3 审计。
- 七态口径：正常 / 空 / 错 / 加载 / 401 / 403+404 同体 / 5xx。空值 `—`，不写假 0。
- 本轮诚实化：错误去 HTTP 码改人话 + 请求编号 + 重试；修订号缺失显 `—`；工位数缺失不显 0；预算按配置/未配置/缺失三态，0 是真实 0；生效时间北京时间到分；负责人占位符显「未指派」；任务/运行/审计枚举中文化；授权与工位短码 + title 原值；运行/审计行有真实详情路由；危险区仅公示、零按钮。
- 技能数：E11 员工详情契约无 `skillCount`；列表列仅在行确实携带时显示，缺失显 `—`（EMP-TABLE-01 已核销），详情不新造技能行、不把缺失写成 0。

| elementId | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态 |
|---|---|---|---|---|---|---|---|
| EMP-DETAIL-01 | `/api/employee` | 正常/加载/401/403/404/5xx | 读 | — | `v2.ed.bannerOwner`、`v2.ed.fieldRole` | 身份横幅、404 同体、5xx 独立卡；本轮 5xx 去 HTTP 码 + 请求编号 | 已核销 |
| EMP-DETAIL-02 | `ownerUserId` | 正常 | 读 | — | `v2.emp01.unassigned` | 占位 owner 屏显「未指派」，不发 approval-stats | 已核销 |
| EMP-DETAIL-03 | `/api/employee-versions` | 正常/空 | 读 | — | `v2.ed.chainTitle`、`v2.ed.fieldEffective` | 版本链与生效时间北京时间到分；修订号缺失 — | 已核销 |
| EMP-DETAIL-04 | `currentVersion.budget` + `/api/budget-usage` | 正常/未配置/缺失/错 | 读 | — | `v2.ed.budgetNone`、`v2.ed.budgetUnset`、`budgetActual` | 已配置 `$ / 月` / 0→未配置 / 缺失 — 三态 | 已核销 |
| EMP-DETAIL-05 | 会话入口 | 正常 | 会话权限（无来源） | `/agent/chat?employeeId=:id` | `v2.navChat` | 详情对话链接 href | 已核销 |
| EMP-DETAIL-06 | 写端点（未接） | 正常（仅公示） | 写 grant + 审计 | — | 固定说明 | 危险区只公示「停用/改预算需写权限并记入审计」，零按钮（`agent-v2-ed-danger-readonly`） | 已核销（仅公示，零写入口） |
| EMP-DETAIL-07 | `/api/employee` | 404 | 读 | 返回列表 | `v2.ed.notFound`、`v2.ed.back` | 深链已删对象整页 404，无静默回落 | 已核销 |

## 汇总

- 元素数：7（既有 EMP-DETAIL 定义，非 PRD §5 行）
- 已核销：7（含 1 项「仅公示」：EMP-DETAIL-06）
- 待实现：0
- 需共享文件：0
- 未核销：0
- 核销率：7 / 7 = **100%**
- 死控件：0
