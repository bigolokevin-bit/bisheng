# OV-01 `/agent` 总览 — 元素核销表

- 设计源：`docs/product/console-v3/PRD-v0.3.md` §5.1（治理 main `c93cc3f`）
- 实现代次：fork `lane/L4-page-skills` @ `5a0b092`（本表随本轮修单提交）
- 写域：`src/frontend/platform/src/pages/AgentConsoleV2/overview*`、`OverviewPage.tsx`、`OverviewBlocks.tsx`、`OverviewAdditions.tsx`、own tests/CSS
- 口径：只读页；金额 USD；时间北京时间到分；空值 `—`；0/—/暂无 三态不混用

## 七态口径

| 代号 | 含义 |
|---|---|
| 加载 | 骨架/`…`，刷新按钮 `disabled + aria-busy` |
| 正常 | 真实端点数据，缺失字段 `—` |
| 空 | 该块专属人话文案 + 下一步入口；不用「暂无数据」 |
| 错 | 人话原因 + 可复制请求号 + 重试；403/404 保留请求号但不重试 |
| 401 | 页面顶部会话过期横幅，块内不重复报错 |
| 403 | 与 404 同体，避免泄露对象是否存在 |
| 404 | 入口卡整卡隐藏；详情对象走路由级 404 |

## 核销

| elementId | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态 |
|---|---|---|---|---|---|---|---|
| OV-KPI-01 在岗员工 | `employee-stats`（active） | 齐 | 只读 | `/agent/employees?lifecycle=active&src=ov` | `ov.kpiOnDuty` / `kpiOnDutyFoot` | `OverviewRedo.test.tsx` | 已核销 |
| OV-KPI-02 今日运行 | `run-stats` 北京日历日 `[00:00+08, now]`，`bucket=day` | 齐 | 只读 | `/agent/runs?src=ov` | `mtx.runs` / `trendSucceeded` / `trendFailed` | `OverviewRedo` / `OverviewV03` | 已核销·口径修正 |
| OV-KPI-03 待我审批 | `approval-stats`（`human:<uid>`） | 0→「暂无待办审批」，不显红 0 | 只读 | `/agent/approvals?status=pending&src=ov` | `emptyApprovals` / `kpiPending` | `OverviewRedo` | 已核销 |
| OV-KPI-04 成本·今天 | `budget-usage` `periodKind=day`，`period=北京 YYYY-MM-DD` | 无日账目→`—`；上游只回 month→`—`+口径注，不显月额 | 只读 | `/agent/metrics?src=ov` | `met.costTitle`+`dsh.range.today` / `run02.costNone` / `ov.costCaliber` | `OverviewV03` | 已核销·口径修正 |
| OV-CHART-01 近 7 日趋势 | `run-stats`（期间段，日桶） | 空轴→`/agent/runs` | 只读 | `/agent/runs` | `ov.trendEmptyWindow` / `trendGoRuns` | `OverviewRedo` | 已核销 |
| OV-LIST-01 最近运行 | `/api/runs?since=7d&limit=5` | 空→运行列表；行可达详情 | 只读 | `/agent/runs/:runId` | `emp.colLastRun` / `runsEmpty` | `OverviewV03` | 已核销 |
| OV-LIST-02 待审批队列 | `/api/approvals?status=pending&limit=5` | 空→审批列表；行可达详情 | 只读 | `/agent/approvals/:id` | `ov.queueEmpty` / `queueGoApprovals` | `OverviewRedo` | 已核销 |
| OV-LIST-03 风险清单 | `runs7`+`approvals`+`budget` 派生 | 无命中→运行列表 | 只读 | `/agent/runs` | `ov.anomalyEmpty` / `anomalyViewRuns` | `OverviewRedo` | 已核销 |
| OV-LIST-04 最近活动 | `/api/audit`（24h 切片） | 空→审计；动作本地化，不显蛇形键 | 只读 | `/agent/audit` | `ov.activityEmpty` / `eventUnknown` | `OverviewRedo` | 已核销 |
| OV-CARD-01 员工矩阵入口卡 | `/api/matrix?limit=50` | 404 整卡隐藏 | 只读 | `/agent/matrix` | `mtx.title` / `mtx.loaded` | `OverviewV03` | 已核销 |
| OV-CARD-02 协作链入口卡 | `/api/delegations` | 404 整卡隐藏 | 只读 | `/agent/collab` | `collab.title` / `collab.state.empty.title` | `OverviewV03` | 已核销 |
| OV-CARD-03 预算与配额 | `budget-usage` + 员工预算 | 空→指标页 | 只读 | `/agent/metrics` | `ov.costBudgetTitle` / `quotaNoLimit` | `OverviewRedo` | 已核销 |
| OV-ACT-01 刷新 | `action:refetch` | 加载时禁用 + `aria-busy` + 旋钮 | 只读 | 无（原地） | `ov.refresh` | `OverviewV03` | 已核销 |
| OV-ACT-02 期间/周数/焦点 | URL `?range=&weeks=&focus=` | 刷新/分享/回退复原 | 只读 | 无（原地） | `ov.range` / `ov.rangeTitle` | `OverviewRedo` | 已核销 |

## 计数

- 元素总数：**14**
- 已核销：**14**（其中 2 项为本轮口径修正）
- 核销率：**100%**
- 死控件：**0**（所有卡片/行/按钮均有 `route` 或 `action`）
- 假 0 / 假曲线：**0**（无源用 `KpiDots`；无账目显 `—`）

## 未验 / 边界

1. 线上 200 未验：本环境探针仅 401；数据形状以既有契约 + 测试桩为准。
2. 375 像素未截图：本轮以 `overview.css` 规则 + jsdom 断言修复 KPI 裁切（≤420px 仍为 2×2，值可缩可换行，不丢列）。
3. 已删对象深链 404 未新增 E2E；路由级 `*` 已存在，详情页回访未覆盖。
4. `period=YYYY-MM-DD` 日格式取自 BFF 源码/测试，未对真实上游回放。