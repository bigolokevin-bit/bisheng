# APR-01 审批待办列表 验收证据（L4 控制台 UI）

状态：in-progress（实现交付完毕；**不判 PASS**，判定归 L6/L0）。

- 验收卡：`docs/validation/console/approvals-list/ACCEPTANCE.md`（主仓 commit `d3df9e7`，fork 侧以本文件对应）。
- 页面：`/agent/approvals` → `src/frontend/platform/src/pages/AgentConsoleV2/ApprovalsListPage.tsx`（经 `shellPages.ApprovalsPage` 接线，routes/shellPages 未由本 lane 改动）。
- 取证环境（G13 声明）：本地 dev **5399**（`vite.w1dev.config.mts` 代理 `/agent-api` → 真实 BFF **8092**，opsadmin 真实登录态，会话 cookie host-scoped）；CDP `Emulation.setDeviceMetricsOverride` 真视口 + `sips` 回读。**非 8182 served entry**；8182 换产物部署与 entry 对账归 L7，本拍不动部署。

## 1. 交付物与卡面对应

| 卡 §1 | 实现 | 证据 |
|---|---|---|
| 1 页头+tabs | 标题「审批」+ 待办/已决 tab；**已决禁用**（原因见 §3 实况：AP4 拒绝 `status=history`），禁用原因同时以 tooltip 与 tab 下方可见文案呈现 | LIVE_1440 读数 `tabHistoryDisabled=true`、`historyNote=「已决列表本波未提供：当前数据源只支持待办队列查询，已决记录将在后续波次接入。」` |
| 2 队列行 | id（截断可辨识，title 全量）、动作/变更类型、员工（onBehalfOf 优先，回落申请人）、风险、创建时间+到期倒计时、状态；**confirm 类型不进待办**（域侧 business_action only + 前端防御过滤） | ROWS_1440_FOCUS 读数：rowCount=2，注入的 confirm 单 `…CC03` 不渲染；row1Text 含 `appr_9…AAA1 / grant_escalation · permission / human:7 / 高风险 / 11-16 06:41 / 剩余 5395 秒 / 待处理` |
| 3 计数 | AP8 `approval-stats?assignee=human:1`；失败隐藏徽标，不显示假 0 | ROWS_* `badge="3"`（注入 AP8）；INJ_403/单测「hides the badge when AP8 fails」：AP8 500 时 tab 文本精确为「待办」，无计数节点 |
| 4 批量选择 | 行复选框 + 表头全选本页 + 已选计数；**批量批准/驳回按钮 disabled**，原因可见（无 AP2 写接线，本波不做） | ROWS_1440_SELECTED：`decideApproveDisabled=true, decideRejectDisabled=true, selectedCount=「已选 2 项」`；batchNote 可见 |
| 5 空/错/加载 | 空态「暂无待办审批」+说明；块级错误+重试（`agent-v2-approvals-retry-queue`）；骨架加载 | LIVE_* `emptyState=「暂无待办审批 当前账号没有需要处理的审批」`（实况 items=[] 真值）；错误/重试见单测 G15 用例 |
| 6 URL | `?status=pending|history`、`?focus=<approvalId>`、`?cursor=`、`?limit=` 回退/刷新安全 | URL_HISTORY/URL_BACK/URL_FOCUS_RELOAD 读数（focus 行高亮 `data-focus="true"` + `focusHasStyle=true`；history.back() 恢复 pending；刷新保持状态） |
| 7 权限 | 403 明确页（非空白）；401 会话失效文案；无 uid 时不发起无过滤查询 | INJ_403_FIX `state403=「无权查看审批队列 当前账号没有控制台审批权限，请联系管理员开通。」`；单测 no-identity 用例断言零 AP4 请求 |

行不可点击（无详情页，APR-02 单独验收）；无伪造详情/计数/倒计时。

## 2. 端点实况（浏览器内 fetch 原文，`readout.txt` 前两段）

| 请求 | 状态 | 响应 |
|---|---|---|
| `/api/approvals?status=pending&limit=5`（无 assignee） | **400** | `{"code":"request.invalid_query","message":"assignee is required"}` |
| `/api/approvals?status=pending&limit=5&assignee=human:1` | 200 | `{"items":[]}`（实况真零，无 nextCursor 键） |
| `/api/approvals?status=history&limit=5&assignee=human:1` | **400** | `{"code":"request.invalid_query","message":"status is invalid"}` |
| `/api/approvals?…&employeeId=x` | 200 | employeeId 被 BFF passthrough 名单丢弃（名单=assignee,status,limit,cursor）→ 不提供员工筛选（卡 §2 口径） |
| `/api/approval-stats?assignee=human:1` | 200 | `{"pending":0,"dueSoon":0}` |

行形状按域侧 `approval_public` 契约建模（`requestedBy/onBehalfOf{type,id}`、`action`、`binding.changeKind`、`riskLevel`、`expiresAt/remainingSeconds`、`status`、`createdAt`），类型复用 `@/controllers/API/agentConsoleApprovals` 的 `Approval`。

## 3. 实况偏差与处置（诚实记录）

1. **卡 §2 称「assignee 由 BFF 身份注入」与本 build 实况不符**：AP4/AP8 均要求显式 canonical `assignee`（400 实测，域侧 `human:<1-20位>` 正则校验）。处置：页面从 `userContext.user.user_id` 取**当前用户自己**的 `human:<id>` 传入（与 OverviewPage 既有口径一致），绝不查询他人 assignee；无 uid 时不请求、显示身份不可用态。此为 L0 已知口径（任务书明示），非前端伪造。
2. **`status=history` 被服务拒绝**（合法枚举=pending/approved/rejected/revise_requested/expired/cancelled/consumed/superseded，无「已决」聚合口径）。处置：已决 tab **禁用 + 可见原因**（卡 §1.1 允许「本波不做需明确禁用原因」）；`?status=history` 深链渲染诚实说明面板，**不发起注定失败的请求**（URL 回退/刷新安全）。
3. **实况队列为空**（opsadmin human:1 pending=0，真值）。行渲染/徽标 3/全选/焦点高亮等交互证据采用 `Page.addScriptToEvaluateOnNewDocument` 包装 fetch 的**契约形状注入**复测（脚本 `l4wae-shot2.sh`，方法承 OV-01 片5/6 注入先例；注入体字段与 §2 契约逐一对齐）。注入桩的 `expiresAt` 按请求时刻重算，故翻页后倒计时读数回升（5395→5398）属桩效应，非页面造假——页面只从绝对 `expiresAt` 推导剩余秒。
4. 徽标初版误用 `.a2-badge`（8px 绝对定位红点样式）致计数不可见；`f68db4d` 修为行内文本计数（截图复证可见「待办 0 / 待办 3」）。
5. 取证期间为释放 ego 页预算，清理脚本按标签 p2–p8 关闭遗留页，其中 **p2/p3 为 EMP-03 会话页（/agent/employees）被误关**（其脚本可自重建，p1 未动）；后续本 lane 全部复用固定页 `p9`。

## 4. DOM 读数摘要（全文 `readout.txt`）

- 实况（5399→8092 真实数据，深色）：`pageTestid=true`、`rowCount=0`、`tabPending="待办 0"`（AP8 真值 0）、`badge="0"`、`tabHistoryDisabled=true`、空态文案如上、`historyNote` 可见、leaks（rawKey/undefined/`{{`/待接入/单花括号/NaN）全 false、`machineCodeMatches=[]`、`machineCodeOnErrorEls=[]`、`capturedErrors=[]`、overflow：1440/1280/768 档 `scrollW==innerW`，375 档 375/375。
- 注入复测：`rowCount=2`（confirm 排除）、`badge="3"`、`dueSoon="1 单将在 24 小时内到期"`、`focusRowAttr="true"`+`focusHasStyle=true`、全选后 `selectedCount="已选 2 项"`、翻页 `pageInfo="第 2 页 · 本页 2 条"` 且 URL 带 cursor、back 恢复、375 档页面级无溢出（表格自带横向滚动容器）。
- 403 注入：`state403` 文案如上，页面非空白；AP8 未注入故徽标显示真实 0（同源真实值，非假 0）。

## 5. 截图（同目录入库；sips 回读）

| 文件 | 字节 | sips |
|---|---|---|
| apr01-1440x900-dark.png | 120561 | 1440×900 |
| apr01-375x812-dark.png | 56032 | 375×812 |
| apr01-1280x800-dark.png | 106463 | 1280×800 |
| apr01-768x1024-dark.png | 89636 | 768×1024 |
| apr01-1440x900-light.png | 52681 | 1440×900 |
| apr01-403.png | 123906 | 1440×900（视口，非 fullPage） |
| apr01-injected-1440x900-dark.png | 154097 | 1440×900（契约形状注入复测） |
| apr01-injected-375x812-dark.png | 73999 | 375×812（同上） |

## 6. 门禁

- platform `lint` exit **0**（含本 lane 文件独立 eslint 0）。
- `test -- src/pages/AgentConsoleV2`：**11 files / 125 tests passed**（基线 10/114 无回退 + 本卡新增 `__tests__/ApprovalsList.test.tsx` 11 例：AP4 参数、confirm 排除、AP8 徽标/失败隐藏、G15 错误本地化+重试恢复、403、空态、批量选择+禁用决策、focus 高亮、history 不请求、无身份零查询）。
- `git diff --cached --check` 各提交均 0；bs.json 三文件独立 i18n 提交纯增量（+17/文件，删除侧 0），zh/en/ja apr.* 键集 parity 校验通过，插值全部双花括号。

## 7. NOT MEASURED / 边界

- **viewer 403 在线负例：NOT MEASURED**（无第二账号）。引用主仓 `apps/console/tests/test_bff_authz.py`（`test_plain_user_without_menus_or_flags_is_403`、`test_grant_applies_to_every_agent_api_route` 覆盖 `/api/approvals` 路径、`test_unauthenticated_stays_401_not_403`）；页面侧 403/401 分支由单测 + 本拍注入截图证明渲染。
- 已决列表数据源能力缺失（§3.2）如卡 §6 属「AP4 缺能力」类，处置口径=禁用+原因，是否拆给 L7/L1 归 L0。
- 本卡不实现 AP2 决策写路径、不实现详情（APR-02）；未动 BFF/契约/主仓/8182 部署。
- 交付 commit（fork `lane/L4-w1-w2-ui`）：`e903dc6`（页面+locale，编排器按 10 分钟规则代提交）、`a1f03cb`（测试）、`f68db4d`（徽标可见性/原因可见性修复）；本证据目录随下一提交。
