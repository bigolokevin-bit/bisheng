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
