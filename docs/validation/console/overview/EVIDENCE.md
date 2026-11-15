# OV-01 总览页 验收证据（L4 控制台 UI）

状态：in-progress（L0 卡 @2405@ 降级分片·第 1 片交付；不判 PASS，判定归 L6/L0）。

## 片 1（2026-11-16 02:09，卡 @2405@）：页头 + 4 KPI，真实 BFF；其余 4 区块诚实占位

范围：`/agent`（V2 壳 index 路由）→ `OverviewPage.tsx`（新建）经 `shellPages.OverviewPage` 接线，routes 未动。
取证环境：本地 dev 5399（`VITE_AGENT_CONSOLE_V2=1`，vite.w1dev.config.mts 代理 `/agent-api`→BFF 8092，真实数据）；
opsadmin 真实登录 8182（CAPTCHA_LEN=4，口令零回显）；CDP `Emulation.setDeviceMetricsOverride` 设真视口，sips 回读像素。
过程预览口径：served entry（8182 仍为 EMP 轮 `index-_oTHR00v.js`，未含 OV-01 改动）对账与部署归 L7，本拍不动部署。

### 交付物
- 页头：标题「控制台总览」+ 刷新按钮（`agent-v2-ov-refresh`）+ 统计口径注 + 数据时间（`agent-v2-ov-updated`=「数据时间 11-16 02:09」）。
- 4 KPI（DOM 原文，`agent-v2-ov-kpi-*` 共 4 卡）：
  - 在岗员工 = `2`（注「共 2 名在册」）— E14 `employee-stats` 200 `{"total":2,"byLifecycle":{...,"active":2,...}}`
  - 待审批 = `0` — AP8 `approval-stats?assignee=human:1` 200 `{"pending":0,"dueSoon":0}`（uid 取 userContext `user.user_id`=1）
  - 近 7 天运行 = `14`，趋势位显示「无趋势数据」，注「其中失败 0 次」— R6 `run-stats?from=…&to=…&bucket=day` 200（11-12 runs1 + 11-14 runs13）
  - 本月成本 = `USD 0.13`，注「口径：成本账本」— E11 `employees?limit=100` 200 n=2 → P9 `budget-usage` 批量 200（0.121198 + 0.01…）
- 占位 4 区块（趋势/配额/热力/员工概览）：标题 + 「本块施工于后续波」（`agent-v2-ov-<key>-placeholder`），不画假图。

### 泄漏与布局判据
- 1440×900（sips 实测）与 375×812（sips 实测）双视口：`leakRaw=false`、`leakUndefined=false`、`leakMustache=false`、`leakFakeZero=false`、`leakPending(待接入)=false`；nav=8；sw==cw（1440 档 1380/1380=已知平台滚动条视口伪差，L0 板报在盯；375 档 375/375 精确）。
- 截图（同目录入库）：`ov01-kpi-1440x900.png`（76141B）、`ov01-kpi-375x812.png`（52484B）；原始 DOM/API 读回全文见 `readout.txt`。

### 偏差与实况
1. 卡面 `budget-usage?periodKind=month`（不带 employeeId/period）实测 400：`{"code":"console.missing_param","message":"employeeId is required"}`——BFF required=(employeeId,period)。实现按合规路径：E11 取员工 ids（limit 100 单请求）→ P9 批量 month 查询求和（服务聚合，无前端逐行 N+1）。两形态证据原文均在 readout。
2. 趋势口径=滚动近 7 天 vs 前 7 天两窗；前窗无有效基数时显示「无趋势数据」，不作假 +2%（本片实况：前窗 runs=0 → 无趋势数据）。
3. uid 来源=userContext `user.user_id`；若未来拿不到 uid，待审批卡显示空态原因「无法识别当前用户，暂无待审批数据」（代码路径存在，本拍未触发）。
4. KPI 数 4 按 `agent-v2-ov-kpi-{onduty,pending,runs,cost}` 精确判（DOM 读回四卡全有文本）。
5. 门禁：platform lint exit 0；`test -- src/pages/AgentConsoleV2` 9 files / 112 passed 不回退基线。

### 仍缺（后续片）
- 趋势/配额/热力/员工概览四块为诚实占位；`?expand=stats,cost,owner` 维度不被服务端接受（合法维度=version,workstations,knowledge,pending），成本/统计类扩展列需按已验批量端点接入。

## 片 2（2026-11-16 02:36，卡 @2471@）：待处理队列 + 近 7 天趋势 + 7×24 热力（真实 BFF）

范围：`/agent` 总览页新增三块——`agent-v2-ov-queue`（审批/任务/运行三段，各 Top 5 + 「查看全部」链接 /agent/approvals|tasks|runs）、`agent-v2-ov-trend`（7 根柱）、`agent-v2-ov-heat`（7×24=168 格）。配额、员工概览仍为诚实占位（片 1 口径不变）。页头/4 KPI 未改动。
取证环境：同片 1——本地 dev 5399（V2=1，代理 `/agent-api`→BFF 8092 真实数据）；opsadmin 真实登录 8182（CAPTCHA_LEN=4，口令零回显）；CDP 真视口截图，sips 回读 1440×900 / 375×812。

### DOM 读数（原文见 readout.txt 片 2 段）
- 队列三段（1440 与 375 一致）：审批 rows=0 空态「暂无数据」；任务 rows=0 空态「暂无数据」；运行 空态「队列暂不可用」。
- 趋势：`trend-bar` ×7，无 trend-empty，脚注「成功 13 · 失败 0」（R6 滚动 7 天服务聚合 11-12 runs1 + 11-14 runs13/succ12 系，柱高按真实 runs）。
- 热力：`heat-cell` ×168，grid 在位，脚注「颜色仅反映运行次数（时区 Asia/Shanghai）」，仅按 count 着色、未画失败维度；R7 `run-activity?weeks=4&tz=Asia/Shanghai` 有真实 cells（max=4 稀疏分布），非全灰。
- 泄漏判据（双视口）：raw i18n key / undefined / `{{` / 「待接入」/ NaN 全 false。
- 溢出：375 档 scrollW==clientW==375 无横向溢出；1440 档覆盖后 scrollW=1440==innerW、clientW=1425（差值=经典滚动条伪差，非横向溢出，片 1 同项口径）。

### 端点状态码（浏览器内 fetch 原文）
- `approvals?assignee=human%3A1&status=pending&limit=5` = 200 `{"items":[]}` → 空态「暂无数据」（真实空，非造假）。
- `tasks?assignee=human%3A1&limit=5` = 200 `{"items":[]}` → 空态「暂无数据」。
- `runs?limit=5`（卡面「/api/runs 全量」措辞）= **400** `{"code":"request.missing_filter","message":"at least one of employeeId/status/since is required"}`——BFF 运行列表强制过滤，无过滤全量列表不存在该口径；运行段按实况显示「队列暂不可用」空态+原因，不造数据、不私加过滤冒充全量。
- 探索项：`runs?limit=5&status=succeeded` = 422 `unknown status 'succeeded'`（合法枚举另议，本片不加过滤分支，仅记实况）。

### 截图（同目录入库）
- `ov01-slice2-1440x900.png`（79130B，sips 1440×900）
- `ov01-slice2-375x812.png`（54551B，sips 375×812）

### 门禁（实现轮全量 + 本收口轮复跑）
- 实现轮：lint 0；全量冻结 43 failed/18 files 新增 0；双 build 0（数字承 W2/EMP 轮基线）。
- 收口轮复跑（commit 前实测）：platform lint exit 0；`test -- src/pages/AgentConsoleV2` Test Files 9 passed (9)、Tests 112 passed (112) 不回退基线。

### 状态
- OV-01 片 2 三块交付完成；配额/员工概览两块与「运行队列可用过滤口径」为后续波缺口。不判 PASS（归 L6）。

## OV-01 片3：本月成本 / 预算配额 / 最近活动（占位清零）

- 交付：`OverviewPage.tsx` 拆出 `OverviewBlocks.tsx`（CostBlock / QuotaBlock / ActivityBlock，named exports，全 t('agentConsole.v2.ov.*') 三语）。原 `quotaTitle` / `tableTitle` 两个占位块已替换；页面占位扫描 `placeholderCount=0`（`placeholderNote` / `tableTitle` locale 键留存但不再被页面引用）。
- 数据来源（真实 BFF，经 dev 5399 代理 /agent-api→8092）：
  - `GET /api/employees?limit=100&expand=version` = 200；首行 enrichment `{currentVersionNo:3, effectiveFrom 2026-11-15T03:27:58.000Z, effectiveBudget:{dailyTokens:100000, monthlyCostUsd:10, perRunMaxUsd:0.5}}`（域侧校验：`stats/cost/owner` 维度非法，成本口径改由 P9+budget 组合承担）。
  - `GET /api/budget-usage?employeeId=…&period=<YYYY-MM>&periodKind=month` = 200：emp_86A81CE8… costUsd 0.12119800000000001、emp_0166858D… costUsd 0.011498、missing=[] → 合计 USD 0.13（cost_ledger 口径注上屏）。
  - `GET /api/runs?since=<now-24h>&limit=8` = 200，n=2（首条 rn_01M7DQ282W7C197TCRXHGVNG5B completed）。
  - `GET /api/audit?from=<now-24h>&to=<now>&limit=8` = 200，n=8（首条 employee.version.created；from/to 过滤合法满足 A3 `require_any`）。
- DOM 读回（opsadmin 真实登录态）：
  - 1440×900：blockTotal=8、kpiCount=4；`本月成本 USD 0.13 口径：成本账本`；`预算配额 AgentOS 产品助理 1.2% USD 0.12 / USD 10.00 · AgentOS 产品助理 0.1% USD 0.01 / USD 10.00`；`最近活动` 表 10 行（审计×8 + 运行×2 按时间倒序合并，含 rn_01M7DRBJ3…/rn_01M7DQ282…）；activityRows=10；leaks（raw key / undefined / {{ / 待接入 / 0.00）全 false；sw=1440 cw=1425 overflow=[]（15px=桌面仿真滚动条伪差已知口径）。
  - 375×812（mobile 仿真口径）：blockTotal=8、kpiCount=4、activityRows=10、placeholder 0、leaks 全 false、**sw=cw=375**；overflow 元素 6 项全部是底部横滚 rail 自身（a2s-groups/a2s-group/a2s-nav/a2s-glyph/a2s-nav-label）=W1 已知设计行为（rail 横向滚动，非页面级溢出）。
- 截图（CDP Emulation.setDeviceMetricsOverride 真视口，sips 实测）：`ov01-final-1440x900.png` 157599B 1440×900；`ov01-final-375x812.png` 72791B 375×812；原始探针输出在 `readout.txt` 末段。
- 门禁：platform lint exit 0；`test -- src/pages/AgentConsoleV2` Test Files 9 passed (9)、Tests 112 passed (112) 不回退。
- 边界声明：本拍不动 8182/Caddy/BFF/受管服务；dev 5399 仅过程预览（起后已停）；served entry 对账归 L7；本节只交证据与实现，**不判 PASS**。

### 片3 修复子项：运行队列 400 request.missing_filter 关闭（L0 卡 2533）

- 缺陷：L7 部署 `2c34afb` 后 8182 出现 1 条 failed resource：`GET /agent-api/api/runs?limit=5` → 400 `request.missing_filter`。根因=`OverviewPage.tsx` 队列运行段只传 `limit`，未传 BFF 白名单过滤参数。
- 修复：该请求改为 `fetch<QueueBody>('/api/runs', { since: window24.from, limit: 5 })`（复用现有 24h 窗口 `window24`，不加新 helper、不加新端点；单文件 +3/−1，带英文注释）。
- 复跑证据（本地 dev 5399 代理真实 BFF 8092，opsadmin 登录态，2026-11-16 03:06 复拍）：
  - `runsNew`（`/api/runs?since=<now-24h>&limit=5`）= **200**，n=1，首条 `rn_01M7DRBJ3MYENKP532MDNCE0VW · completed`（createdAt 2026-11-14T19:25:40.345Z，在 24h 窗内）。
  - 页面队列运行段显示真实行（DOM `queueRunsRows=1`，文本 `运行 查看全部 rn_01M7DRBJ3MYENKP532MDNCE0VW · completed`），不再是空态；`queueRunsEmptyMark=false`。
  - 对照 `runsOld`（裸 `?limit=5`）直连仍 400 `request.missing_filter`——仅作 BFF 守卫行为对照，页面自身已不再发该请求 ⇒ 预期 L7 重新部署后 **failed resource=0**。
  - 回归面不变：blockTotal=8、kpiCount=4（在岗 2 / 待审批 0 / 近 7 天运行 14 无趋势数据 其中失败 0 次 / 本月成本 USD 0.13 口径：成本账本）、quota 两条 1.2%/0.1%、activityRows=9（11-14 19:25Z 一条运行行滚出 24h 窗属正常时间语义）、placeholderCount=0、leaks 全 false；375 mobile 口径 sw==cw==375、overflow 仍仅 rail 横滚区。
  - 截图覆盖同名重拍：`ov01-final-1440x900.png` 160968B 1440×900；`ov01-final-375x812.png` 75729B 375×812（字节数较片3 首拍变化=队列段空态→真实行的视觉证据）；探针原文见 `readout.txt` 末段 `l4x5-shots2.out`。
  - 门禁复跑：platform lint exit 0；`test -- src/pages/AgentConsoleV2` Test Files 9 passed (9)、Tests 112 passed (112) 不回退。
