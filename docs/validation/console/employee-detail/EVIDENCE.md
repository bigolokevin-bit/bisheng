# EMP-03 员工详情 验收证据（L4 控制台 UI）

状态：in-progress（判定归 L6）。证据采集时间：2026-11-16（北京时间）。

## 0. 口径与 provenance（G13）

- 实现态：fork `bigolokevin-bit/bisheng` worktree `bisheng-chat-panel`，分支 `lane/L4-w1-w2-ui`，tip `5c684397bb85e926d8f675cf98af6d4537c87f30`；本片提交链 `7117118`（页面+v2Data）→ `e903dc6`（APR-01 页面 WIP，10 分钟卡代提交）→ `a1f03cb`（APR tests）→ `b8fa351`（EMP 路由接线+列表详情链接）→ `5c68439`（ed.* 三语 locale）。
- **本批全部证据来自本地 dev 5399（VITE_AGENT_CONSOLE_V2=1，vite.w1dev.config.mts 代理 `/agent-api`→真实 BFF 8092），opsadmin 真实登录态；非 8182 served entry。8182 对账与部署归 L7，本卡未动部署。**
- 探针原文全文见本目录 `readout.txt`（l4wd-evid.out 段）；截图为本目录两张 png。

## 1. C0 交付面（DOM 原文，emp_86A81CE8FF6F42E187BCF2B540）

- 横幅（agent-v2-ed-banner）：`A AgentOS 产品助理 产品助理（数字员工 · Pilot） 在岗 负责人 human:1 · 配置修订 2 · 最后更新 11-15 12:21`
- 横向字段行（agent-v2-ed-fields）：`岗位 产品助理（数字员工 · Pilot） 版本 v3 生效时间 11-15 11:27 工位 1 月度预算 USD 10.00 / 本月 知识范围 product_assistant`
- 4 KPI（agent-v2-ed-kpi-*，DOM 原文）：
  - `agent-v2-ed-kpi-runs=13 运行`（附 `agent-v2-ed-kpi-runs-spark` spark 元素，数据=R6 真实桶）
  - `agent-v2-ed-kpi-success=100% 成功率 分母为终态运行（成功+失败）`
  - `agent-v2-ed-kpi-cost=USD 0.12 本月成本 口径：成本账本`
  - `agent-v2-ed-kpi-pending=0 待处理`
- 5 Tab（agent-v2-ed-tab-*）：概览[aria-selected=true]/对话/任务/运行/审计。
- 概览 Tab：版本链 3 行（agent-v2-ed-version-row ×3）+当前版 pill ×1：`v3 当前 11-15 11:27 → 至今 — / v2 11-14 19:30 → 11-15 11:27 P0-7 解阻：新增 send 职权 / v1 11-14 06:15 → 11-14 19:30 —`，脚注`版本链仅来自 employee-versions 端点真实记录`（不拼假链）。爆炸半径 3 grant 行 + `快照 snap_b26e0cfb… · 解析于 11-16 07:38`；预算小节 `日 token 额度 100000 · 月度成本上限 USD 10.00 · 单次上限 USD 0.50 / 本月实际 USD 0.12（成本账本）`；工位 1 行 `ws_8D65… app · feishu · active`；生命周期 `在岗`。
- 对话 Tab（只读，原文）：`对话面板归 P1-8，本页只读`。**偏差声明**：页面未提供「在 Bisheng 中打开」跳转——当前无员工↔应用真实绑定能力，按「不伪造对话/不假跳转」交付；本页无任何写控件。
- 泄漏扫描（EMP_DOM1.leaks）：rawKey=false、mustache=false、undefined=false、「待接入」=false、机器码正则 `/[a-z]+\.[a-z_]+/` 在 error/text 节点命中=[]。
- 404 腿（emp_definitely_missing_404）：`员工不存在或无权访问 返回员工列表`（与跨租户同体文案，未暴露 employee.not_found 机器码）。
- URL/交互腿：点「运行」Tab→`?tab=runs`（EMP_URL1）；刷新后激活 Tab 仍为 `agent-v2-ed-tab-runs`（EMP_RELOADSEL）；history.back()→无参 URL 复原（EMP_BACK）。C2 Tab 可分享/刷新/回退 实测通过。

## 2. 端点原文码表（页面同源 fetch，§2 口径）

| 端点 | 状态 | 关键原文 |
|---|---|---|
| E2 /api/employee?id= | 200 | name=AgentOS 产品助理, lifecycleState=active, currentVersionId=empv_7369…, ownerUserId="1", revision 在 body |
| E5 /api/effective-config?id=&at= | 200 | {employee,version,grants[…],resolvedAt,snapshotRef} |
| E15 /api/employee-versions?id=&limit=20 | 200 | items[0]=v3 empv_7369…（3 条真实版本，无拼造） |
| R6 /api/run-stats?employeeId=&bucket=day(7d) | 200 | 桶 {runs:13,succeeded:12,failed:0,costUsd:0.121198,upstreamRuns:12} |
| P9 /api/budget-usage?…period=2026-11 | 200 | costUsd=0.121198, missingEmployeeIds=[] |
| AP8 /api/approval-stats?assignee=human:1 | 200 | {pending:0,dueSoon:0} |
| R5 /api/runs?employeeId=&limit=5 | 200 | items 含 runId/employeeVersionNo/policySnapshotRef/upstreamRunId 等 |
| （fetch credentials:omit）| **401** | 未鉴权路径实测返回码 401 |

## 3. 运行 Tab 现状与缺口（如实）

- 面板原文（EMP_RUNSPANEL）：行=`runId · status · v{n}`（如 `rn_01M7D7421P5PA27TEXMT9YVDZ8 running · v1`…7+ 行真实数据）。
- **缺口声明**：`RUN-TAB-DATA.md`（main 84198fd）要求的 duration（endedAt−startedAt 派生）、trigger 保守标签、summary 行内懒展开（R3）、cursor「加载更多」（且永不显示 total）**未实施**，归下一片；相关字段（startedAt/endedAt/upstreamRunId/channelEventId/costUsd/nextCursor）已在上表 R5 原文中可见，页面当前不展示它们（非造假，是未渲染）。

## 4. 权限腿与 NOT MEASURED

- 在线：credentials:omit fetch=401（接口层实测）；E2 未知/跨租户 id=同体 404 文案（页面级实测）。
- **NOT MEASURED（在线）**：401 会话过期页面态、viewer 403 部门管理员负例（本机仅 opsadmin 单管理员会话）。替代证据=单测：`OverviewErrors.test.tsx`（401/500 错误态与重试）、`test_bff_authz`（BFF 403 语义）、`ApprovalsList.test.tsx`（a1f03cb，含 403 testid 路径）。

## 5. 截图与回归

- `emp03-1440x900-dark.png` 209893B，sips 1440×1174（fullPage 深色，只加高不加宽）；`emp03-375x812-dark.png` 142731B，sips 375×1662（fullPage）。CDP Emulation.setDeviceMetricsOverride 真视口。
- 回归腿：REG_OV（/agent 总览）`blocks=5 kpis=8`——口径注：`ov-block-*` 前缀仅 5 块（header/kpis/cost/anomaly/activity），queue/trend/heat 用非 block- testid；8 区块全量 id 已在 overview/EVIDENCE.md 片5 证明，属读数口径差异非回归破坏。REG_LIST（/agent/employees）`rows=2 detailLinks=2`（EMP-03 接线生效，EMP-01 列表正常）。

## 6. 门禁与边界

- 本片=纯证据零代码改动；实现片门禁时点：e903dc6/a1f03cb `lint exit 0`、`test -- src/pages/AgentConsoleV2` 10 files/114 passed、`git diff --check` 0。
- 不判 PASS（归 L6）；不改 BFF/契约；不部署（8182 entry 换构建归 L7）；全程零口令回显。
