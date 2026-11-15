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

## OV-01 片4（修复A·结构/数据口径）：G1/G2/G3/G9/G11/G14

- 卡：L6 首轮 FAIL（主仓 `docs/validation/console/overview/L6-REVIEW.md`，main 327a924/b30bddf）后 L0 裁定 ACCEPTANCE §7；本片只做结构+数据语义六项，视觉/证据缺口（G4/G5/G6 趋势 P95·图例·轴标、截图命名口径等）另片。分支 `lane/L4-w1-w2-ui` 自 `f68d8ac` 续，交付链：`cf52383`（页面代码）→`c69df35`（三语 i18n 键）→`fe5957f`（90d 窗口诚实性修复）。按用户增量指令改为每块 commit 后即 push；远端==`fe5957f`（docs 笔随后）。
- **G1 异常/告警区块**（新增，第 8 区块，永不整块省略）：`AnomalyBlock`（OverviewBlocks.tsx，named export）真实派生——`run-stats` 日桶失败合计 + `approval-stats.dueSoon`，无任何前端造数。当前双 0 → DOM 空态原文：`异常/告警 暂无需要处理的异常 已扫描：近 7 天运行失败、待审批逾期`（testid `agent-v2-ov-anomaly-empty/-scan`；range 变化时扫描天数跟随：28d/90d 实测文案为「近 28/90 天」）。有值分支列计数+下钻链接（/agent/runs、/agent/approvals），源不可用显示原因行（no-uid→`queueNoUid`，其余→`anomalyUnavailable`）。
- **G11 成本/配额合并**：`CostBlock`+`QuotaBlock` 合并为 `CostBudgetBlock`（区块标题「本月成本与预算」，子标题「预算配额」），独立 `agent-v2-ov-block-quota` 已删除；DOM 原文：`本月成本与预算 USD 0.13 口径：成本账本 预算配额 AgentOS 产品助理 1.2% USD 0.12 / USD 10.00 · 0.1% USD 0.01 / USD 10.00`（分母仍为版本预算真实 monthlyCostUsd=10.00）。页面 `blockTotal=8`（quota 亡、anomaly 现）。
- **G14**：队列标题 zh-Hans `queueTitle` 改「待处理队列」（en Pending Queue / ja 未処理キュー 已符合口径，未动）；DOM `queueHead=待处理队列`。
- **G3 队列口径**（三条腿全部只列可处理项，空段诚实空态）：审批 `approvals?assignee=human:1&status=pending&limit=5` = **200 n=0**；任务 `tasks?assignee=human:1&dueBefore=<now>&limit=5` = **200 n=0**（超期口径）；运行 `runs?status=failed&since=<now-24h>&limit=5` = **200 n=0**（异常运行口径）。三段上屏均为「暂无数据」空态（合法：现网确无可处理项），无造数、无前端过滤冒充。
- **G2 KPI spark 与假空态修正**：运行卡=run-stats 7 日桶 `runs` 序列、成本卡=同日桶 `costUsd` 序列（`sparkPoints`/本地 `costSparkPoints`，同源同窗）；在岗/待审批无可信序列不画（允许）。实测 `sparkRuns=true sparkCost=true`；运行卡文案 `近 7 天运行 14 其中失败 0 次`——**buckets 非空时不再显示「无趋势数据」**（`runsKpiNoTrendShown=false`）。`trendText` 重写：仅当前窗无桶/全零才显 `noTrend`；对照窗不可用或零基线时省略趋势行（不放假对比）。
- **90d 窗口钳位与诚实性（fe5957f）**：BFF run-stats 日桶跨度上限实测 ≤90 天（`span=91 → 400 run.stats_range_too_large`，探针对照原文：clamped win(89)=200 {runs:14,failed:0,cost:0.1311} / naive win(90)=400，页面从不发 naive 请求）。页面 `statDays=min(range,89)`，对照窗取非退化 `[2x,1x)` 块。修复后 `?range=90d` 实测：KPI `近 90 天运行 14 其中失败 0 次`（无「无趋势数据」）、trendBars=90、spark 存在、无 400 报错面。
- **G9 URL 状态**（`useSearchParams` 读写，刷新/分享/后退可复原）：页头新增统计窗口分段控件（testid `agent-v2-ov-range-{7d,28d,90d}`，aria-pressed 反映当前值），热力卡新增周数 select（`agent-v2-ov-weeks`，1..12，默认 4 不写参数）。实测五步：S0 默认 `search=''`；S1 点 28d→`?range=28d`、trendBars=28、KPI「近 28 天运行 14」；S2 `history.back()`→全部复原默认；S3 分享 URL `?range=28d&weeks=6&focus=heat`→pressed 28d、weeks select=6、`scrollY=762` heat 块滚入视口；S4 reload 持久化同 S3；S5 `?range=90d` 如上。range 同时驱动趋势柱数、KPI 窗口文案、异常扫描口径；weeks 驱动 `run-activity?weeks=`（注：BFF 返回恒 7×24 聚合 cells，周数不改格数，属数据侧口径）。
- 端点原文与 DOM 全值见 `readout.txt` 末两段（`l4wa-shots.out` 最终态复拍 / `l4wa-g9b.out` G9 复验）；回归面不变：kpiCount=4、placeholderCount=0、leaks 五项全 false、375 mobile `sw==cw==375`（overflow 仅底部 rail 横滚区，G8 口径允许）。
- 截图（深色，CDP `Emulation.setDeviceMetricsOverride` 真视口 + sips 回读）：`ov01-fixA-1440x900.png` 161083B 1440×900；`ov01-fixA-375x812.png` 73132B 375×812。**G13 声明：本批截图与全部探针均取自本地 dev 5399（vite 代理 /agent-api→BFF 8092，opsadmin 真实登录态），非 8182 served entry；8182 对账与重新部署归 L7。** 取证期间 opsadmin 会话曾被登出，已按授权登录法自愈（口令零回显），登录成功后续拍。
- 门禁：platform lint exit 0；`test -- src/pages/AgentConsoleV2` Test Files 9 passed (9)、Tests 112 passed (112) 不回退；`git diff --check` exit 0。
- 越界说明：G12（同名员工显示层区分）**不在本片六项内**，本拍未做，归视觉/证据片；页面存在两条同名「AgentOS 产品助理」配额行属实，留待后片。
- 边界声明：本片未动 BFF/契约/8182/Caddy/受管服务；不判 PASS（判定归 L6）。
