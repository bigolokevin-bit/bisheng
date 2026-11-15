# Console v2 Parity Audit — 2026-11-15

- 基线：fork `bigolokevin-bit/bisheng`，分支 `lane/L4-console-v2-parity` @ `373d8f7`。
- 设计源（SSOT）：主仓 `docs/product/design/console-v2/mockup-v2-light.html` / `mockup-v2-dark.html`（ADR-0012）。**fork 内无该设计源副本**（`docs/design/console-v2/`、`docs/product/design/console-v2/` 均不存在）——缺口 G-0：请 L0 把两份 mockup 同步进 fork（本车道不越写域复制）。
- 现实现（代码实况，非部署截图）：`src/frontend/platform/src/pages/AgentConsoleV2/AgentConsoleV2Page.tsx`（sections: list / detail / appr / runs / metrics，rail 4 键）、`TrendsCostsSection.tsx`、`RunsSection.tsx` + `runTrace.ts`、`HermesMetricsSection.tsx`、`flag.ts`（V2=build-time flag）；旧壳 `src/pages/AgentPage/`（index + Overview/Tasks/Runs/Audit/Chat 五 Tab + AgentListPage + StatusChip/BudgetNote）。
- 部署实况（8182，entry `index-ZWyz97xC.js`，用户实测+本车道 s11 取证一致）：列表=3 KPI（本页在岗/我的待办/趋势待接入）+ 四列表格；详情=身份/当前版本(`版本数据待接入`)/爆炸半径(`undefined(types=["chat"]) · send`)/预算(`预算用量数据待接入`)+iframe 应用对话；无版本链、无四 Tab、无右侧常驻对话。
- P0-13/P0-14 的 PASS 只覆盖窄功能（chat 收发链 + metrics 三面降级诚实），不代表产品完成。

## 逐屏对照总表

| 屏 | mockup 有 | 现在（部署态） | 缺口 | 数据来源（全部为已证 200 的 BFF 读路由） |
|---|---|---|---|---|
| 列表 | 4 KPI（今日运行/今日成本/成功率/成本配额 USD 412.50·800）；全局搜索+⌘K；表头 员工/岗位版本/工位/知识/近 7 天运行/待办/本月成本/负责人/生命周期/操作；分页（of 200）；生命周期待含 在岗/已暂停/离职中/入职中/草稿 | 3 KPI 且第 3=「趋势」占位待接入；搜索框+查询按钮；表头 名称/编号/状态/负责人 | KPI 缺 3 项+配额；列缺 岗位版本/工位/知识/近7天运行/待办/本月成本/操作；无分页游标 UI；生命周期枚举展示不全 | KPI：`/api/run-stats`、`/api/budget-usage`、`/api/employee-stats`、`/api/approval-stats`；行数据：E11 `/api/employees`（keyword/lifecycleState 筛选已有）+ E5（岗位版本/知识计数）+ E10（工位）+ R5/run-activity（近7天）+ AP4 count（待办）；分页=E11 cursor/nextCursor |
| 详情·横幅+字段 | 身份横幅（头像/姓名/岗位/生命周期 chip/负责人）+ 横向字段行 + 岗位版本链 v1/v2/v3（含生效时间）+ 爆炸半径真实 grants 形状 + 配额（USD 与 token 820K/1.2M、红档提示） | 身份/当前版本(v2+待接入)/爆炸半径 undefined/预算待接入 4 卡 | 版本链无 UI；爆炸半径渲染 bug（`undefined(types=["chat"])`）；版本/预算已接 API 但显示「待接入」=前端未接线（数据源 E4/budget-usage 均可用）；红档/估算/上游实测口径未呈现 | 版本链=`/api/employee-versions`（E4）；爆炸半径=E5 `grants[]`（scopeType/resourceSelector/actions/source/expiresAt）+ responsePolicy/memoryScope；配额=`/api/budget-usage`（P9，含未计价/混合口径）；状态= E2 |
| 详情·四 Tab + 右侧常驻对话 | Tab：概览/任务/运行/审计（或 mockup 同名组）；右侧常驻对话「输入消息，⌘↵ 发送…」，Trace 节点串（意图识别/知识检索 命中 2 项/生成草案/系统写入） | 无 Tab；iframe「应用对话」（active app 工位才显示） | 四 Tab 未挂 V2 详情（组件在旧壳 AgentPage 已有全套）；ChatTab 未做成右侧常驻；iframe 只保留「在 Bisheng 中打开」降级（ADR-0013 口径） | 任务=T5 `/api/tasks?assignee=employee:<id>`；运行=R5 `/api/runs?employeeId=`；审计=A3 `/api/audit?runId|taskId=`；对话=`POST /api/employee-chat`+R3 轮询（DB-1 容错已修）；知识检索引用=V3 前无来源→必须显式空态，不得编造 |
| 审批 | 列表+详情；职权升级样例（ap_7f3e…c81d、批准后 7 天后自动收回、需人工、风险注记「岗位上无对应 grant 记录…」「可触达未脱敏字段，需补一次字段级授权」） | 表格 编号/动作/风险 + 空态「暂无待办审批」 | 详情面板无；「职权升级」语义（自动收回倒计时/风险注记）无字段级 UI；单次消费状态不可见 | 列表=AP4 `/api/approvals?assignee=&status=pending`；详情=`/api/approval`（单条代理已有）；决策写=AP2 已归档先例（VITE_AGENT_APPROVAL_WRITE 模式，见 archive/L4-console-wsbind 分支记录）；收回时效/风险注记=tasks.md 记录契约字段，缺字段则空态 |
| 运行 Trace | 运行列表+时间线节点序列（收到消息→意图识别→知识检索→生成回复草案→写入），成功/失败/p95、耗时样本 | runs section 已有：状态/员工筛选、近 7 天窗口、耗时/成本(上游实测/估算)、事件流（序号/事件/时间/数据）+ 工具配对（evSteps/等待结果/无对应调用/重复调用/终态后事件） | 大体最接近 mockup；缺 mockup 的横向时间线可视化（现为表格）；知识引用节点=V3 前空态 | R5 `/api/runs` + R3 `/api/run-events`（DB-1 容错后可靠）；配对逻辑 `runTrace.ts` 已有 |
| 运行指标（metrics） | 健康/用量/热力三块+降级文案 | 已 PASS（S11 V7；hermes-summary/usage 200，P0-14 判据全中） | 与 mockup 版式对齐即可，功能不缺 | `/api/hermes-summary`、`/api/hermes-usage`、`/api/run-activity` |

## mockup 下限清单（每屏验收线，缺一不判 PASS）

- 列表：4 KPI 真实值（成本 KPI 必须带 口径=按 token 折算/上游实测/未计价 三态之一）；搜索+生命周期筛选生效；表头 10 列全（知识列无来源时显示显式空态而非删除列）；分页可用或明示总数限制。
- 详情：横幅含 生命周期 chip+负责人；版本链 ≥v1/v2 且当前版本高亮、无「待接入」字样；爆炸半径列出真实 grant（scopeType·resourceSelector·actions，过期显示 expiresAt），禁止出现 `undefined`；配额 USD+token 双值+红档提示（无数据=显式「无成本记录」）。
- 四 Tab+对话：Tab 切换不发多余请求（懒挂载）；对话右侧常驻、⌘↵ 发送、runId chip、失败可重试同幂等键；Trace 节点仅渲染真实事件，知识检索无来源时=空态。
- 审批：详情含 风险注记 + 自动收回倒计时（缺字段=空态）；批准/拒绝按 S10b-6 开关模式，默认只读。
- Trace：横向时间线（或等价可视化）+ 事件表可展开。
- 通用：1440×900 无横向溢出；375 单列不溢出；所有空态用既定 zh/en/ja 三语键；每屏验收=mockup 并排截图 + 内容清单 + 真实登录路径。

## 逐屏施工顺序（每拍一屏，均为 fork 前端 + 三语 locale，不碰 BFF/契约）

1. **详情·横幅/版本链/爆炸半径/配额接线**（最小风险、消掉全部「待接入/undefined」）：`/api/employee-versions` + E5 grants 真实形状 + `/api/budget-usage`；爆炸半径 undefined 是渲染取值 bug 优先修。
2. **详情·四 Tab**：把旧壳 `AgentTasksTab/AgentRunsTab/AgentAuditTab` + 概览内容重组进 V2 detail（props 已兼容 `api/employeeId`）。
3. **详情·右侧常驻对话**：`ChatTab` 移入右侧栏；iframe 段降级为「在 Bisheng 中打开」按钮（保留既有测试断言或按新 UI 重写本车道自产测试；既有 `agentConsoleV2.test.tsx` 若断言 iframe 位置需评估——禁改既有测试时按 @1635@ 先例报备）。
4. **列表·KPI/筛选/列/分页**：`employee-stats/run-stats/approval-stats/budget-usage` 接 4 KPI；E11 cursor 分页 UI；列扩展（行级聚合请求需限流：每页 ≤20 行，用 run-activity 批量口径替代逐行 R5）。
5. **审批屏**：详情抽屉 + 风险注记/收回倒计时；写路径沿用 S10b-6 开关模式。
6. **运行 Trace 可视化**：时间线组件（不引新依赖，复用现有 svg/趋势画法）+ 事件表。

每拍门禁：`corepack pnpm@9.15.9 -C src/frontend/platform lint`、targeted vitest、全量（43 failed/18 files 冻结基线新增 0）、`pnpm -C src/frontend build:platform`、`VITE_AGENT_CONSOLE_V2=1` 部署构建 + lan stop/start + rsync pin build 闭环、1440/375 真实登录截图、evidence 双笔（fix/evidence）SSH push。

## 组件复用表

| 目标位 | 现成组件 | 动作 |
|---|---|---|
| 右侧常驻对话 | `AgentPage/ChatTab.tsx`（DB-1 容错版 f6ee26c） | 移入 V2 detail 右栏 |
| 任务/运行/审计 Tab | `AgentTasksTab/AgentRunsTab/AgentAuditTab` | 挂 V2 detail Tabs |
| 趋势与成本 | `AgentConsoleV2/TrendsCostsSection.tsx` | 已在位，补 KPI 口径 |
| 指标三块 | `HermesMetricsSection.tsx` | 已在位（PASS） |
| 运行列表+事件 | `RunsSection.tsx` + `runTrace.ts` | 加时间线视图 |
| 生命周期 chip | `StatusChip.tsx` | 复用到横幅/列表列 |
| 数据层 | `controllers/API/agent.ts`（E2/E5/E10/E11/T5/R5/A3/chat/run-events 全已接）+ `agentConsoleHermes.ts` | 增 employee-versions/budget-usage/stats 四函数即可 |
| 搜索 | 现 input | mockup ⌘K 全局=新组件（低优先，不阻塞验收） |

## 已知 bug / 假空态清单（施工时一并清）

- 爆炸半径 `undefined(types=["chat"]) · send`：渲染取 grant 字段名与 E5 实际形状不符。
- `版本数据待接入`/`预算用量数据待接入`：数据源可用（E4/budget-usage），纯前端未接线——注意 mockup 文件自身也含 2 处「待接入」为评审标注，不构成豁免。
- `P95 时长: 样本不足`：诚实态，保留。
- 趋势 KPI 空位（emptyTrend）：接 run-stats 后消失。

## 声明

- 本拍仅审计：**未改任何产品 UI/代码**；除本文档外零文件变更。
- 未合并、未 build、未动 8182/Caddy/BFF/runtime。
- 发现假数据风险：未发现现网读数为假（全部为诚实空态/降级）；「待接入」两处为未接线空态，按卡口径列为缺口而非缺陷掩盖。
