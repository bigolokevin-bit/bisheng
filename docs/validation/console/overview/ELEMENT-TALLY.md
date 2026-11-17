# OV-01 `/agent` 总览 — 元素核销表

- 设计源：`docs/product/console-v3/PRD-v0.3.md` §5.1（治理 main `c93cc3f`）
- 实现代次：fork `lane/L4-page-skills` @ `7ed7fcc` + Q2 修单 commit（本表随修单提交）
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
| OV-KPI-01 在岗员工 | `employee-stats`（active；total 六态恒全键） | 齐；total 缺省→`—`，不写「共 0 名在册」 | 只读 | `/agent/employees?lifecycle=active&src=ov` | `ov.kpiOnDuty` / `ov.noteTotal` | `OverviewRedo` / `OverviewHonesty` | 已核销·Q2 复核 |
| OV-KPI-02 今日运行 | `run-stats` 北京日历日 `[00:00+08, now]`，`bucket=day`；只读 `totals` | 齐；`totals` 缺→`—`，前端不加桶；成功/失败取 `totals` 纯 `failed` | 只读 | `/agent/runs?src=ov` | `mtx.runs` / `trendSucceeded` / `trendFailed` | `OverviewRedo` / `OverviewV03` / `OverviewHonesty` | 已核销·Q2 复核 |
| OV-KPI-03 待我审批 | `approval-stats`（`human:<uid>`；组织级聚合缺口 G-3，只能按审批人） | 0→「暂无待办审批」；`dueSoon` 缺→`—`，不写「今天没有到期单」 | 只读 | `/agent/approvals?status=pending&src=ov` | `emptyApprovals` / `kpiPending` | `OverviewRedo` / `OverviewHonesty` | 已核销·Q2 复核 |
| OV-KPI-04 成本·今天 | `budget-usage` `periodKind=day`，`period=北京 YYYY-MM-DD`；P9 逐员工行 | 无日账目→`—`；`missingEmployeeIds`/无价行/超 100 人→`—`+「其中 N 名员工无账本返回」，不显部分和；上游只回 month→`—`+口径注 | 只读 | `/agent/metrics?src=ov` | `met.costTitle`+`dsh.range.today` / `run02.costNone` / `ov.costMissing` / `ov.costCaliber` | `OverviewV03` / `OverviewHonesty` | 已核销·Q2 复核 |
| OV-CHART-01 近 7 日趋势 | `run-stats`（期间段，日桶；汇总只读 `totals`） | 空轴→`/agent/runs`；`totals` 缺→汇总/成功率 `—`，不拿桶和冒充 | 只读 | `/agent/runs` | `ov.trendEmptyWindow` / `trendGoRuns` | `OverviewRedo` / `OverviewHonesty` | 已核销·Q2 复核 |
| OV-LIST-01 最近运行 | `/api/runs?since=7d&limit=5` | 空→运行列表；行可达详情 | 只读 | `/agent/runs/:runId` | `emp.colLastRun` / `runsEmpty` | `OverviewV03` | 已核销 |
| OV-LIST-02 待审批队列 | `/api/approvals?status=pending&limit=5` | 空→审批列表；行可达详情 | 只读 | `/agent/approvals/:id` | `ov.queueEmpty` / `queueGoApprovals` | `OverviewRedo` | 已核销 |
| OV-LIST-03 风险清单 | `runs7`+`approvals`+`budget` 派生；失败取 `totals.failed` | 无命中→运行列表；预算未评估→「预算上限未知，未评估」；数据缺→`—`，不写「0 条/无风险」 | 只读 | `/agent/runs` | `ov.anomalyEmpty` / `anomalyViewRuns` / `anomalyBudgetNA` | `OverviewRedo` / `OverviewHonesty` | 已核销·Q2 复核 |
| OV-LIST-04 最近活动 | `/api/audit`（24h 切片） | 空→审计；动作本地化，不显蛇形键 | 只读 | `/agent/audit` | `ov.activityEmpty` / `eventUnknown` | `OverviewRedo` | 已核销 |
| OV-CARD-01 员工矩阵入口卡 | `/api/matrix?limit=50` | 404 整卡隐藏 | 只读 | `/agent/matrix` | `mtx.title` / `mtx.loaded` | `OverviewV03` | 已核销 |
| OV-CARD-02 协作链入口卡 | `/api/delegations` | 404 整卡隐藏 | 只读 | `/agent/collab` | `collab.title` / `collab.state.empty.title` | `OverviewV03` | 已核销 |
| OV-CARD-03 预算与配额 | `budget-usage` + 员工预算（G-4：无组织级聚合） | 空→指标页；逐员工成本不完整→总额 `—`；非全员有月预算→不拼「月预算总和」，配额条省略 | 只读 | `/agent/metrics` | `ov.costBudgetTitle` / `quotaNoLimit` / `ov.costMissing` | `OverviewRedo` / `OverviewHonesty` | 已核销·Q2 复核 |
| OV-ACT-01 刷新 | `action:refetch` | 加载时禁用 + `aria-busy` + 旋钮 | 只读 | 无（原地） | `ov.refresh` | `OverviewV03` | 已核销 |
| OV-ACT-02 期间/周数/焦点 | URL `?range=&weeks=&focus=` | 刷新/分享/回退复原 | 只读 | 无（原地） | `ov.range` / `ov.rangeTitle` | `OverviewRedo` | 已核销 |

## 计数

- 元素总数：**14**
- 已核销：**14**（其中 2 项为本轮口径修正）
- 核销率：**100%**
- 死控件：**0**（所有卡片/行/按钮均有 `route` 或 `action`）
- 假 0 / 假曲线：**0**（无源用 `KpiDots`；无账目显 `—`；Q2 修掉 KPI 桶和、部分账本和、missing total/dueSoon 的正向断言）

## Q2 诚实性复核（READ-PORT-MATRIX @ 77ffccc）

对照 `services/domain/READ-PORT-MATRIX.md` 本页相关行，逐条修正：

1. **R6 totals 权威**（矩阵 §1 R6：totals/successRate 服务端算，前端禁自加桶）：KPI-02、趋势汇总、成功率、unknown、异常块改为只读 `totals`；`totals` 缺省一律 `—`，不再用 `bucketSum` 顶替。`RunStatsTotals` 类型补进 `v2Data.ts`。
2. **P9 部分账本**（G-4 + «缺行只进 missingEmployeeIds 不造零»）：`missingEmployeeIds` 非空、行无 `costUsd`、或员工页截断（`nextCursor`/total>100）时，KPI 与成本块总额显 `—` + `ov.costMissing`；不显示部分和，也不把剩余额度写成满额。
3. **员工统计总数字段**：`total` 缺省不再落 `?? 0`，改 `ov.noteTotal` 或 `—`；删掉「无入职中」这一无数据支撑的正向断言。
4. **AP8 dueSoon**：缺省不再写「今天没有到期单」，改 `—`；待审批 0 仍按真实 0 显示「暂无待办审批」。
5. **月预算聚合**：非全员配置 `monthlyCostUsd` 时不求和成「月预算」，配额条与占比省略（G-4 无组织级聚合）；逐员工条仍显示各自账本值/上限。
6. **入口卡 body 缺 `items`**：不再当 0 条渲染空态，转「查询失败 + 请求号 + 重试」；矩阵风险数仅在每行都有 `risk` 时显示，避免把未知当无风险。
7. **趋势桶 failed 语义**：域桶级 `failed` 为 failed+cancelled+interrupted 三态混并（契约 CR-031）；KPI/汇总取 `totals` 纯 failed，趋势单日柱仍按桶并列，未拆三态 —— 已在验收腿记录，属域形状限制，非本页假 0。
8. 复验：`OverviewHonesty.test.tsx` 5 例（totals 缺、缺账本、dueSoon/total 缺、部分预算、matrix 无 items）；全套 40 文件 / 681 例通过（基线 676 不降）。

## 未验 / 边界

1. 线上 200 未验：本环境探针仅 401；数据形状以既有契约 + 测试桩为准。
2. 375 像素未截图：本轮以 `overview.css` 规则 + jsdom 断言修复 KPI 裁切（≤420px 仍为 2×2，值可缩可换行，不丢列）。
3. 已删对象深链 404 未新增 E2E；路由级 `*` 已存在，详情页回访未覆盖。
4. `period=YYYY-MM-DD` 日格式取自 BFF 源码/测试，未对真实上游回放。