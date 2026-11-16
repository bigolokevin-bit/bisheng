# APR-02 审批详情 验收证据（L4 控制台 UI · 车道 B）

状态：in-progress（判定归 L6）。证据采集时间：2026-11-16（北京时间）。

## 0. 口径与 provenance（G13）

- 实现态：fork `bigolokevin-bit/bisheng` worktree `bisheng-chat-panel`，分支 `lane/L4-w1-w2-ui`，开工 tip `bb7fe19`（车道 A EMP-03 运行 Tab）。
- 本片提交链：代码一笔（`ApprovalDetailPage.tsx` + `ApprovalDetail.test.tsx`）→ locale 一笔（三语 `agentConsole.v2.aprd.*`，40 键）→ 证据一笔（本目录）。
- **本批全部证据来自本地 dev 5399（`VITE_AGENT_CONSOLE_V2=1`，`vite.w1dev.config.mts` 代理 `/agent-api`→真实 BFF 8092→domain 8101），opsadmin 真实登录态；非 8182 served entry。8182 对账与部署归 L7，本卡未动部署、未动 BFF/契约。**
- 唯一数据源：`GET /agent-api/api/approval?id=`（AP3，只读）。**零写操作：探针与页面均未发出任何 POST**（单测断言 fetch 调用 method 全为 GET）。
- 探针原文全文见本目录 `readout.txt`（§1–§3），门禁与运行时读数在 §4。

## 1. AP3 真实样本读数（每 changeKind 一条，readout §3 原文）

| approvalId | status | changeKind | risk | remainingSeconds / ttl / expiresAt | decisions[] | `detail` |
|---|---|---|---|---|---|---|
| `ap_0A8BC8A6F02C457FA781D89417` | expired | employee_version_create | medium | 0 / 86400 / 2026-11-14T00:49:32.112Z | `[]`（空态腿） | **键不存在**（hasDetail=false） |
| `ap_449D1CA7D18847668C06C822CA` | expired | employee_version_create | medium | 0 / 86400 / …110Z | 1 条 `{userId:"human:1",verdict:"approve",comment:"…",decidedAt:"2026-11-13T00:51:43.106Z"}` | **键不存在** |
| `ap_AEEC078E0C824E749513AFEC9A` | consumed | employee_version_create | medium | 0 / 86400 / …533Z | 1 条 approve + 顶层 `consumedAt=2026-11-15T04:21:52.961Z` | **键不存在** |
| `ap_8CC7AB670AF84BBDBB955EBDD3` | consumed | employee_version_create | high | 0 / 86400 | 1 条 approve | **键不存在** |
| `ap_C4D72B02F79249C285E29C75A5` | consumed | employee_version_create | high | 0 / 86400 | 1 条 approve | **键不存在** |
| `ap_84BFBFF56BE3444BAB1D4A37D8` | consumed | message_send | high | 0 / 86400 | 1 条 approve | **键不存在**（契约本就只给摘要） |
| `ap_7D484B3FFBE048ECB7B96F92C9` | consumed | grant_escalation | medium | 0 / 86400 | 1 条 approve | **键不存在**（契约未定义投影） |

顶层键集（7 条一致）：`approvalId, tenantId, type, action, status, riskLevel, binding, argsDigest, requestedBy, reasonText, approvers, requiredApprovals, decisions, policyDecisionId, expiresAt, remainingSeconds, ttlSeconds, createdAt`（终态另有 `verdict/decidedAt/consumedAt`）。`onBehalfOf`/`supersededBy` 在本地数据集内全部缺席 → 页面按「present-only」渲染为 `—`，不补算。
`binding` 真实含 `subjectType/subjectId/changeKind/targetHash`（部分含 `effectiveFrom/runId/messageDigest`）→ targetHash 只在服务端给出时上屏。

## 2. 访问态与异常腿（readout §1/§2 原文）

- 未知 id：`GET /api/approval?id=apr_does_not_exist_zzz` → **404 `{"code":"approval.not_found","message":"approval not found"}`**（与跨租户同体，页面文案「未找到或无权查看」，机器码不上屏）。
- 空 id：→ **400 `{"code":"console.missing_param","message":"id is required"}`**（页面走 blockUnavailable+HTTP 状态习语，不外泄 code）。
- 未鉴权：同一 URL 无 cookie（curl，5399 代理与 8092 直连各一次）→ **401 `{"code":"console.unauthenticated","message":"identity check failed"}`**，页面文案「登录已失效，请重新登录」。
- AP4 侧口径（供路由集成参考，非本页数据源）：`status=pending|expired|consumed|…` 200；`status=history` **400 request.invalid_query**；pending 队列本机 **0 条**（consumed 5 条、expired 2 条）。

## 3. C3 真实数据与 CR-043 重启状态（卡片 §7 要求说明）

- 登录=真实 opsadmin 会话；审批单=域内真实行（7 条逐字段读数见 readout §3）。
- **`detail` 在真实响应中一条都不存在。** 根因已核实：CR-043 提交 `86e9ff6`（`services/domain/approval_detail.py`）时间 2026-11-16 07:32:17 +0800，而运行中的 domain 进程 PID 64482 启动于 **Sun Nov 15 21:07:02 2026**（早于 CR-043），即 8101 未重启加载投影。按卡片 §7：页面只显示「不可得」，不阻断、不前端补算、不造 0。**本片不重启任何服务**（8182/BFF/部署/8092/8101 不在车道 B 所有权内）。
- 因此 `employee_version_create` 的 changeDetail 六键差异与 versions 表 **在线 NOT MEASURED**；替代证据=单测夹具（按 `services/domain/approval_detail.py` 的 `build_detail` 真实形状构造）：`ApprovalDetail.test.tsx` → 「employee_version_create renders the changeDetail diff rows and versions」。

## 4. C0–C6 逐项现状

- C0：文档项不阻断；AP3 字段缺口（detail 未生效）已在本页 §3 与 `readout.txt` 留证。
- C1 四档+深色：**在线未测**——路由 `/agent/approvals/:id` 尚未接线（`routes/index.tsx` 只有 `agent/approvals`），协调者禁止本片触碰 `routes/index.tsx`/`shellPages.tsx`。截图与 375 溢出腿待集成后补拍（见 §6）。样式全部内联/页内，未新增全局 CSS；pill 复用既有 `.a2-pill`/`.a2-pill-dot` 类名。
- C2：元数据/明细/历史/操作禁用/404/URL 直达/重试 = 单测覆盖（14 例全绿，`vi.stubGlobal fetch` 按 URL 路由，`useParams` 取 id，刷新即重新 AP3）。
- C3：真实登录+真实审批单（§1/§3）；pending 队列本机 0 条 → 倒计时真机 >0 腿 **NOT MEASURED**，页面空/终态按诚实读数呈现。
- C4：401（未鉴权 curl 实测）+ 404（实测同体文案）；**403 在线负例 NOT MEASURED**（本机仅 opsadmin 单账号，无第二角色），替代证据=单测 403 分支断言（`agent-v2-aprd-forbidden`）。
- C5：登录→审批列表→详情→返回 的在线走通 **待路由集成**（列表行当前不可点，APR-01 已 PASS 态不改）；页面返回入口为 `NavLink to="/agent/approvals"`，单测断言 href。
- C6：分支/证据/哈希/门禁记录=本文件 + `readout.txt` §4 + 提交链。

## 5. 门禁（readout §4 原文）

- `corepack pnpm@9.15.9 -C src/frontend/platform lint`：**exit 1**，3 条报错全部位于 `src/pages/AgentConsoleV2/RunsListPage.tsx`（车道 A 未跟踪 WIP，本片所有权禁碰，按纪律只记录不动）。对本片两个文件单独 eslint：**exit 0**。
- `corepack pnpm@9.15.9 -C src/frontend/platform test -- src/pages/AgentConsoleV2`：**13 files / 149 tests 全绿**（开工基线 12 files / 133 tests；车道 A 并发提交带来数字漂移，判据=无失败，本片新增 `ApprovalDetail.test.tsx` 14 例）。
- `git diff --check`：exit 0。
- 附测（非本片门禁）：`typecheck` 全仓 14 条 strict 报错，**本片两文件命中 0 条**（既有报错在 agent.ts/agentConsoleRead/OverviewPage/EmployeeDetailPage 等）。

## 6. 缺口清单（移交协调者 / L6）

1. 截图 `apr02-1440x900-dark.png`、`apr02-375x812-dark.png` + 空态图 + 404 图：待协调者接入 `/agent/approvals/:id` 后由本片同 sessionID 补拍（CDP 真视口 + sips 实测），EVIDENCE 以纯追加方式补写。
2. changeDetail 差异行在线证据：待 domain 8101 重启加载 CR-043（`86e9ff6`）后复采；在此之前页面诚实显示「不可得」。
3. 403 与第二账号权限负例、pending>0 的倒计时真机腿：需第二角色会话或新的待办审批单。
4. `employee_owner_transfer` 在本地数据集内无真实样本（AP4 全状态枚举未见）→ 该分支只有单测证据。
5. 复制 ID 按钮的真实 clipboard 写入：依赖 served 页面（路由未接）→ 在线未测；无 clipboard API 时降级为「复制失败」提示，完整值始终在 `title` 且 id 文本 `user-select:all` 可选手动复制。
