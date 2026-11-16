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

## APR-02 接线后截图腿（WB65 follow-up，2026-11-16 09:30）

G13 口径：**dev 5399 = 过程预览**（Vite HMR 载工作树，含协调者未提交的路由接线笔：
routes `approvals/:id` + shellPages `ApprovalDetailScreen` + ApprovalsListPage 行内 NavLink——
接线哈希 e58e4d8/f41e0f8 不在 origin 历史对象内，实际以工作树形态存在，本腿只读未动）。
**served 8182 = 未测量**：现 entry 仍为 `index-BMUzMMBj.js`（75440dd 时代旧产物，未含接线），
待 L7 部署后补拍；本片不部署不重启。

### 截图四件（CDP setDeviceMetricsOverride 真视口，非 fullPage 单屏；sips 实测）
| 文件 | 实测 | 内容 |
|---|---|---|
| apr02-1440x900-dark.png | 1440×900, 211024B | 真实单 ap_0A8BC8A6F02C457FA781D89417 详情（dark） |
| apr02-375x812-dark.png | 375×812, 82730B | 同页 375 视口：scrollWidth=375=clientWidth **无横向溢出** |
| apr02-empty-1440x900-dark.png | 1440×900, 120561B | 空 id 腿（实测为路由回落，见下） |
| apr02-404-1440x900-dark.png | 1440×900, 105750B | 未知 id `apr_does_not_exist_zzz` 404 同体文案 |

### 链路声明（列表→详情）
真实数据 pending=0：列表页 DOM rows=0、empty=「暂无待办审批」、已决 tab disabled=true
（title=「已决列表本波未提供」）。故**无法从列表真实点击行**；行链接接线代码存在于工作树
ApprovalsListPage diff（id 单元格 NavLink → /agent/approvals/:id），本腿以**直达 URL**
进入详情并全量渲染成功（agent-v2-aprd 存在、无错误卡）。点击腿待 pending>0 数据后补。

### 详情 DOM 读数原文（真实 expired 单，ap_0A8…9417）
- heading=审批详情；id=ap_0A8…9417（截断，完整值在 title）；kind=变更类型 employee_version_create
- 状态 pill=已过期；风险 pill=中风险；类型 pill=类型 business_action
- 元数据区=「申请信息 申请人 system:l7-append 代理人 — 审批人 human:1 (owner) 需要审批人数 1
  有效期 86400 秒 剩余时间 剩余 0 秒 策略决定 ID s10b6-append-t2-pol 参数摘要
  th_6b48663e2196d9704787d8d98193475c 创建时间 11-13 08:49 …申请理由（原文透传）」
- 倒计时上屏值=**「剩余 0 秒」**（expired 行 remainingSeconds=0，服务端原值；expiresAt 仅 title）
- changeKind 分支=**diff-head**（非「不可得」）：09:30 实测 AP3 已返回 detail 投影
  （起始版本 empv_9791100658C84EDDB419EDEE1E → 目标版本号 2；新增/移除授权 —；生效时间 11-13 09:00；
  取值来源 resource+versions；版本表 v2 当前 / v1 已取代）。与本目录早前 08:57 探针
  （hasDetail=false）不一致=8101 已在此间重启加载 CR-043（86e9ff6，重启归 L7/运维，本片只转述）。
  「不可得（未返回 changeDetail）」预期文案在实际数据里未出现；页面按卡显真实差异。
- 决策历史=「暂无决策记录」（该单 decisions 空数组，空态正确；非「暂无决策」字面——复用既有键
  agentConsole.approvals.decisionsEmpty，与卡 §3 措辞差一「记录」字，如实记）
- 操作区三按钮 disabled 布尔实测：approve=true reject=true revise=true，
  title 全=「M1 只读，写路径归后续波」；无任何 AP2 请求发出（页面代码只读 GET）。
- 无 undefined/{{/待接入 上屏：实测 false。

### 空/404/机器码扫描
- **空 id 腿路由回落**：/agent/approvals/ 在 react-router v6 匹配到 `approvals`（列表页）而非
  详情空态卡——`:id` 要求非空段。断言结果：详情错误区=不存在（渲染列表），返回列表链接=存在。
  接线观察转报协调者（若需详情自身承接空 id，是集成拍的决定，本片未动代码）。
- 404 腿：卡文案「未找到或无权查看／审批单不存在，或不属于当前租户。」+返回按钮存在；
  错误态机器码扫描=0 命中。
- **数据内容注意**：全页文本正则扫出 1 处 `approval.denied`——位于**申请理由 reasonText 原文内**
  （S10b-6 追加拍的审计文本），属契约字段透传（卡要求显示 reasonText），非页面泄漏错误码；
  若验收认为需过滤业务文本内点号串，需协调者拍板（本片不改代码不脱敏）。
- 1440×900 下 documentElement.scrollWidth=1380 > clientWidth=1371（约 9px，疑似滚动条/表内边距
  伪差，375 无溢出）；截图为视口顶部单屏，下部区块以 DOM 读数留证。

### 结论（不判 PASS）
在线四图+DOM 读数齐；detail 投影真实在线；链路=直达 URL（点击腿待 pending 数据）；
served 腿待 L7 部署 e58e4d8 代产物；空 id 路由回落与 1440 下 9px scrollWidth 差待协调者裁量。
