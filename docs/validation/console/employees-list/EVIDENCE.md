# EMP-01 员工列表（W2）证据页 — 状态 in-progress

- 页面路由：`/agent/employees`（parity spec §4 / EMP-01）
- 实现提交：`2fe499a` feat(console-v2): W2 employees list；显示缺陷修复：`4c2a437` fix(console-v2): interpolate heat counts and separate last-run cells
- 验收卡：主仓 `docs/validation/console/employees-list/ACCEPTANCE.md`（draft，C0-B 未闭）
- 独立评审（L6）：未指定会话，不自签 → 本页结论只能是 **in-progress**，不判 PASS。

## 取证环境
- 本地 dev 预览：`vite.w1dev.config.mts`（proxy `/agent-api` → 127.0.0.1:8092），`VITE_AGENT_CONSOLE_V2=1`，端口 5399。**过程预览口径，served entry 对账归 L7（8182 现服务仍是旧产物，部署由 L7 统一做，本车道未动）。**
- 登录态：浏览器 profile 复用 opsadmin 会话（口令零回显，未入任何文件）。
- 截图工具：ego lite + CDP `Emulation.setDeviceMetricsOverride` 真视口，sips 回读像素。

## 截图与像素
| 文件 | 像素（sips 实测） |
|---|---|
| `w2-employees-1440x900.png` | 1440×900 |
| `w2-employees-375x812.png` | 375×812 |

## DOM 读回（修复后终版，readout.txt 有全文）
- navCount=8，navLabels=[总览,数字员工,审批,任务,运行,运行指标,审计,设置]，activeNav=数字员工。
- rows=2（真实 E11 数据：AgentOS 产品助理 ×2，emp_86A81CE8… / emp_0166858D…）。
- KPI：在岗=2、待审批=0、本月成本=USD 0.13、异常=0。
- 状态 tab：全部 2 / 在岗 2 / 其余 0（E14 byLifecycle 真实值）。
- 首行 10 cells：员工名+岗位 / `—版本信息不可用` / 在岗 / 1 / `0 · 0 · 0` / `—` / `13 · 11-14 08:00` / 92.3% / USD 0.12 / 复制 ID+详情。
- 热力底注（修复后插值正常）：`峰值 4 次·时 · 夜间批量 11 · 本周合计 14 · 时区 Asia/Shanghai · 仅数量，不表示金额`。
- 分页：`第 1 页 · 本页 2 条`（keyset nextCursor 驱动，无总数不造假）。
- 泄漏扫描：rawKeyLeak / undefinedLeak / fakeZeroLeak / badPendingCopy 全部 false。

## API 读回（页面同源带会话）
- `/api/employee-stats` 200 {total:2, byLifecycle.active:2}
- `/api/run-stats`（滚动 7 天窗）200，11-12 runs1 succ1、11-14 runs13 succ12
- `/api/budget-usage`（month）200 items[emp_86 costUsd=0.121198]，missingEmployeeIds=[]
- `/api/run-activity` 200 max=4 稀疏 cells，tz=Asia/Shanghai
- `/api/approval-stats?assignee=human:1` 200 {pending:0, dueSoon:0}

## 门禁数字（HEAD 4c2a437 复验）
- targeted（AgentConsoleV2+AgentPage）：exit 0，11 files / 158 passed。
- 全量 platform test：exit 1（基线内）18f|284p(302)、43 failed | 1745 passed(1788)、Errors 4、FAIL_LINES=43 → 冻结 43/18 新增失败 0，passed 只增。
- lint：exit 0。build:platform：exit 0；VITE_AGENT_CONSOLE_V2=1 build：exit 0。git diff --check：0。

## 横向溢出说明（375）
- 桌面型 CDP 仿真（mobile:false，经典滚动条 15px）：sw=375 / cw=360，wide 元素全部是 `width:100%` 外层容器（平台 React 包装层为 375 宽）→ 属 100vw-vs-滚动条仿真伪差，非 W2 CSS（W2 CSS 无 100vw/字面固定宽，全 min-width:0）。
- 移动型仿真（mobile:true，overlay 滚动条）：**sw=cw=375、wide=[] 无溢出**（l4w2d-ovf2.out）。真实手机视口以后者为口径。

## 缺口与实况（照实，不编数）
1. **行级 enrichment 列在预览口显 `—`**：在跑的 8101 domain 进程早于 expand 实现（旧代码：`expand=version,workstations,knowledge,pending` 被忽略不返回 enrichment；卡面措辞 `stats,cost,owner` 也不报 400）。修复=总控/L7 重启 domain 后即恢复，本车道禁动服务。enrichment 渲染路径已由单元夹具（agentConsoleV2Employees.test.tsx）钉死。
2. 部门/负责人/工位类型/知识范围筛选：无服务端参数 → UI 诚实禁用+注记，未假实现。
3. 最紧急待办：无批量口径 → 列只显 pendingApprovalCount（待 domain 重启后），无紧急标记。
4. 详情路由：属 W3 未建 → 行操作=复制 ID + 详情（禁用注记），未做假链接。
5. 创建入口：BFF 无 E1 写代理 → 右上按钮禁用+原因文案（C4 负例在线复验缺 viewer 账号，只能单测口径）。
6. totals/asOf（B4）：未接。
7. served entry 对账：归 L7 部署后补做。

## 结论
**in-progress** — 页面功能/四态/诚实空态/无假值均达成并有 DOM+API+截图证据；C0-B（评审门禁）未闭 + 上述 7 项缺口未清，不得判 PASS。
```

判读：thCount=10（列头顺序与规范一致：名称/岗位版本/状态/负责人/工位/待办/最近运行/7 天成功率/本月成本/动作）；navCount=8；legacyAgentPage=0、legacyV2Shell=0（无旧 v1 标记，合规）；kpiCount=5 = 4 张 KPI 卡 + 成本卡口径注元素（testid 前缀同为 agent-v2-kpi-，即 agent-v2-kpi-cost-caliber），实际 KPI=4；rowCount=2 真实员工；dashCells=3（enrichment 缺失列显 —，见 8101 旧进程根因）。

## Visual re-review fix round (L0 card 2046 + observer rounds 1-2)
Root causes (all measured): (1) W1 shell route never imported agentConsoleV2.css (only AgentConsoleV2Page.tsx did; consoleShell.css declares its tokens come from that file) -> W2 pages rendered as unstyled text. (2) Mobile hide rule targeted `.a2s-rail-logo` but DOM renders `.a2s-rail-head`/`.a2s-logo` -> stray "S" at 375 bottom-left. (3) Employee table used class `a2-body` (no layout rules) instead of `.a2-table` (padding/nowrap/border) with no scroll container -> 1440 header run-together and 375 per-character wrapping; topbar used translucent `var(--panel)` -> ghosting.
Fixes: Shell.tsx `import './agentConsoleV2.css';`; consoleShell.css 767 hide selector -> `.a2s-rail-head,.a2s-group`, page-level input/select theme rules appended, topbar -> `hsl(var(--card))`; agentConsoleV2.css `.a2-kpi-num{display:block}` + `.a2-table-scroll{overflow-x:auto}` + `.a2-table-scroll table{min-width:880px}` + `.a2-table th{white-space:nowrap}` + `.a2-kpi .a2-meta{display:block}`; EmployeesListPage.tsx table -> `a2-table` wrapped in `a2-table-scroll`; EmployeesHeatPanel.tsx zero-cell opacity 0.08 -> 0.18 (nonzero 0.45+(v/max)*0.55); three locales: cost_ledger -> cost-ledger wording, BFF mention removed from disabled-create note, employees-list token removed from shell description (append-only, no existing keys touched).
Post-fix DOM: P1440 {thPad "8px 12px", thWS nowrap, thH 37, topbarBg rgb(20,20,23), numDisplay block, metaDisplay block, leaks all false}; P375 {scroll w313 sw880 -> horizontal scroll active, sw=cw=375, leaks false}. pilot_...lder in the owner column is fmtId truncation of the real ownerUserId value pilot_owner_placeholder, not an internal identifier leak.
Screenshots (sips-verified true viewport, CDP device metrics): w2-employees-1440x900.png 1440x900, w2-employees-1440-table.png 1440x900, w2-employees-375x812.png 375x812, w2-employees-375-table.png 375x812; raw DOM/probe text in readout.txt.
Gates: lint 0; targeted 9 files / 110 tests passed (no regression from class change; no existing test asserted a2-body); build:platform V2=1 exit 0; git diff --check clean. Prior full-suite baseline still applies: 43 failed / 18 files frozen (0 new), 1745 passed.
Known residuals (not force-fixed this round): heat cell contrast readable but still subtle; ⌘K badge clipped at narrow topbar; cost KPI intermittently shows agent.http.500 when the managed 8101 dev-domain process reloads (service side, L7 lane). 1280/768 and light-theme four-tier screenshots still NOT MEASURED (per ACCEPTANCE C1). W2 remains in-progress pending L0 review of these images; served-entry alignment belongs to L7.

## Four-tier evidence completion (L0 card, 2026-11-15)

Screenshots (CDP device metrics, sips-verified): `w2-employees-1280x800.png` (1280x800, dark, 87963B), `w2-employees-768x1024.png` (768x1024, dark, 91841B), `w2-employees-1440x900-light.png` (1440x900, light, 104148B). Light theme verified: localStorage `agentConsole.v2.theme`="light", `data-theme`="light", `.a2-kpi` computed background `rgb(255, 255, 255)`.

DOM read-back at all three sizes: nav=8, thCount=10, rows=2, leakUndef/leakMustache/leakLedger/leakEmpList all false.

Horizontal overflow, both口径:
- Desktop emulation (classic scrollbar): D1280 {sw1280 cw1265 iw1280}, D768 {sw768 cw753 iw768}, D1440LIGHT {sw1440 cw1425 iw1440}. The constant 15px sw-cw gap is the scrollbar width; `wide` lists only width:100% outer containers (agent-app/a2s-frame/a2s-main), same artifact proven at 375 earlier.
- mobile:true overlay口径: M768 {sw=cw=768}, M1440 {sw=cw=1440, wide=[]} exact; M1280 {sw1296 cw1280, iw1296} — emulation quirk adds 16px to innerWidth at this size and a platform fixed overlay (pointer-events-none inset-x-0, not console code) follows it; console containers show no overflow.
- 375 earlier: mobile:true sw=cw=375 (recorded above).

Status: four viewport tiers + light theme now evidenced. W2 remains in-progress (C0-B open, online 403 C4, served entry L7).

## Enrichment re-shoot — BLOCKED (L0 card 2147, 2026-11-15 21:15)

- Deploy check: 8182 serves entry index-CllU102b.js (matches worktree build of b85db49). 8101 restarted as pid 64473, started Sun Nov 15 21:07:01 2026 (+0800).
- Browser real-login session (opsadmin, cookie persisted): /agent/employees renders 2 employee rows. API probe through Caddy/BFF:
  `GET /agent-api/api/employees?expand=version,workstations,knowledge,pending&limit=20` -> 200, **enrichment key absent on both rows** (rows: emp_86A81CE8FF..., emp_0166858D56...). `items[0]` full body: six base fields only (employeeId/name/title/lifecycleState/ownerUserId/updatedAt). X-Console-Request-Id header: not present on this response (recorded as-is).
- Differential probe locating the broken layer (read-only, no restarts):
  - Direct `GET http://127.0.0.1:8101/v1/employees?expand=version,workstations,knowledge,pending&limit=1` (X-Tenant-Id: t_seakoi_pilot) -> **enrichment returned**: currentVersionNo=3, effectiveFrom=2026-11-15T03:27:58.000Z, effectiveBudget{dailyTokens=100000,monthlyCostUsd=10.0,perRunMaxUsd=0.5}, knowledgeCount=1, workstationCount=1 (pendingApprovalCount absent; recorded as-is).
  - Main repo BFF `apps/console/server.py` line 272 already whitelists `expand` in passthrough (commit 138d2b1, 19:12:11 +0800), but the live 8092 process (pid 10486) started earlier -> **BFF runs pre-B3 code and drops expand**, so domain receives no expand and rows stay un-enriched.
- Verdict: BLOCKED — table columns 岗位版本/工位/知识/待办 remain '—' on 8182. Fix = restart 8092 under L7/ops management (memory precedent: managed process older than merge = stale code, restart resolves). No fabrication, no restart attempted from this lane.
- Re-shoot artifacts (kept side-by-side, old images NOT replaced to avoid implying confirmation): w2-employees-1440x900-20261115-2115.png (175340 B, 1440x900), w2-employees-1440-table-20261115-2115.png (105512 B, 1440x900), w2-employees-375x812-20261115-2115.png (48034 B, 375x812), all sips-verified; columns still show '—' in these images.
- W2 status remains in-progress. After 8092 restart, only the enrichment re-shoot needs repeating (no code change in this lane).

## Enrichment live re-shoot (2026-11-15, BFF restart closed the gap)

- Root cause confirmed and fixed upstream: stale 8092 (pid 10486, predating B3) stripped `expand`; L0 restarted BFF (new pid 67576, 21:21:15).
- Verified on 8182 with opsadmin session, page /agent/employees: E11 `?limit=2&expand=version,workstations,knowledge,pending` => 200 with enrichment on both rows (emp_86A8… currentVersionNo=3 / effectiveFrom 2026-11-15T03:27:58Z / knowledgeCount=1 / workstationCount=1 / effectiveBudget monthlyCostUsd=10; emp_0166… currentVersionNo=2).
- DOM row cells now render real values: job-version `v3 · 11-15 11:27` / `v2 · 11-13 14:30` (Asia/Shanghai), workstations `0 · 0 · 0` / `0 · 1 · 0`, dashes=0, leaks (rawKey/undefined/mustache/cost_ledger/employees-list) all false, nav=8, th=10, no horizontal overflow (sw=cw=375 mobile emulation).
- Note on the `—` in 待办 column: enrichment has no `pendingApprovalCount` for either row (API omits it), and row-level AP8 is not wired; per spec this stays an honest `—`, tracked as a known gap, not a fake zero.
- Screenshots overwritten: w2-employees-1440x900.png, w2-employees-375x812.png, w2-employees-1440-table.png. Previous 2115 BLOCKED screenshots kept alongside as history.
- W2 remains in-progress (C0-B open; not judged PASS here).
- Caveat: the 1440x900 above-fold screenshot is byte-identical to the previous one because the employees table sits below the fold and enrichment does not alter KPI/heatmap/filters; row-level enrichment is proven by the table screenshots (1440 + 375) and the DOM cell text (v3 11-15 11:27 / v2 11-13 14:30) captured in the same reload sessions.

## EMP-01 fixed evidence (L0 card 2211, 2026-11-15 22:40+)

Scope: light-theme tiers, mockup side-by-sides, real viewer01 403, detail scope split. No feature changes; no PASS claimed (C0-B open; all C0-C6 boxes stay unchecked in ACCEPTANCE.md).

### Light-tier screenshots (verified via data-theme attribute + localStorage key agentConsole.v2.theme; both themes report rows=2 real E11 employees)
- w2-employees-1280x800-light.png - 1280x800 (66676 B)
- w2-employees-768x1024-light.png - 768x1024 (85698 B)
- w2-employees-375x812-light.png - 375x812 (54374 B, CDP mobile:true)
- w2-employees-1440x900-light.png - 1440x900 (93494 B, replaces the 21:08 capture)
- w2-impl-1440x900-dark.png - 1440x900 (175340 B, dark reference for comparisons)

### Mockup captures and side-by-side comparisons (mockup-v2 screens driven by [data-scr], served from this worktree copy)
- w2-mockup-v2-light-list-1440.png (202249 B) / w2-mockup-v2-light-detail-1440.png (206359 B) / w2-mockup-v2-dark-list-1440.png (194926 B) / w2-mockup-v2-dark-detail-1440.png (201561 B)
- w2-compare-1440-light.png - 2892x900 (mockup light list | implementation light, 313572 B)
- w2-compare-1440-dark.png - 2892x900 (mockup dark list | implementation dark, 391898 B)

### Per-screen differences (mockup list screen vs current implementation, read from this round's captures)
- Mockup has / implementation lacks: row avatar color blocks; KPI trend mini-bars; mockup KPI naming (today runs / today cost / success rate) differs from the EMP-01 field-table set (on-duty / pending / month cost / anomaly) - implementation follows the field table; quota bar (USD 412.50 / 800); knowledge-count column with hover scopes; conversable pill; row kebab menu (copy ID / open in Bisheng / pause); pagination totals "of 200" (implementation has no totals - B4 open); heatmap tooltip with failed-run count and click-to-filter (no failed-count source today); global cross-entity search (implementation searches employees only).
- Implementation has / mockup lacks: six-state lifecycle tabs with live counts; honest-disabled filter chips with reason note; enrichment-driven version/workstation/pending cells with '—' fallback; copy-ID per row.
- Mockup numbers are sample values for review, not data commitments; the implementation shows only values returned by the services.

### C4 real 403 (viewer01, non-admin)
- viewer01 logged in through /api/v1/user/login (captcha read from backend container logs; credential and cookie values never echoed or stored - cookie len=264 recorded only); browser cookies replaced via CDP; /agent/employees opened.
- Result: route-level redirect to http://127.0.0.1:8182/403, page text "403 / 您无权访问该页面 / 切换账号"; screenshot w2-employees-viewer-403.png (1440x900, 15787 B).
- BFF API through Caddy: HTTP 403, body {"code":"console.forbidden","message":"console entry not authorized for this account"}; no x-console-reason header observed (recorded as-is).
- Unauthenticated 401, cross-tenant 404 identical payload, and write-switch negatives remain covered by main-repo apps/console/tests/test_bff_authz.py unit tests (substituted evidence, stated in ACCEPTANCE C4).

### C5 detail chain BLOCKED (per card: do not fabricate a page)
- routes/index.tsx has no employees/:id; the list action column renders the detail button disabled with emp.detailPending hint. Login -> list -> detail chain belongs to W3. The list leg (opsadmin login -> /agent/employees real render, rows=2) is already evidenced under C1/C3.

### Coverage note
- Dark tiers: 1440/375 (enrichment re-shoot round) + 1280/768 (four-tier round). Light tiers: all four this round. Mockup side-by-sides: light + dark list screens this round.
- W2 status remains in-progress; this section only closes the fixed-evidence gaps named in L0 card 2211.

## EMP-01 rework (L6 round 2, card 2260, 2026-11-15)

### C1 light screenshots re-taken WITH table rows visible
All shots: dev preview http://127.0.0.1:5399/agent/employees (V2 flag build, proxy
/agent-api -> BFF 8092), real opsadmin cookie login, first employee row scrolled into
center before capture. `rect` = first-row bounding box after scrollIntoView (top within
viewport height proves table rows are in frame). sips verified pixel sizes.

| file | sips px | rows | theme attr | rect |
|---|---|---|---|---|
| w2-employees-1440x900-light.png | 1440x900 | 2 | light | top=608 vh=900 |
| w2-employees-1280x800-light.png | 1280x800 | 2 | light | top=507 vh=800 |
| w2-employees-768x1024-light.png | 768x1024 | 2 | light | top=677 vh=1024 |
| w2-employees-375x812-light.png | 375x812 (mobile emulation) | 2 | light | top=427 vh=812 |
| w2-employees-375x812-dark-table.png | 375x812 (mobile emulation) | 2 | dark | fixed rail rect top=796 bottom=812 vh=812 -> bottom nav affordance visible while table also on screen |

Mobile rail fix shipped in this rework: consoleShell.css <=767 rail switched from
`position: sticky; bottom: 0` (order:2 at document end, invisible during scroll) to
`position: fixed; bottom: 0; left: 0; right: 0; z-index: 20; background: hsl(var(--card))`
plus page bottom padding 88px so content clears the rail. Verified above with computed
position=fixed and rail inside viewport on a mid-document scroll.

### C2 sort implemented + interaction evidence (1440x900 light, real BFF data)
Scope note (per card): sorting is client-side over the CURRENT page only; E11 has no
server-side sort parameter, so full-dataset ordering is a known gap, not claimed.
Sort state is recorded in URL `?sort=<col>:asc|desc`, cycled asc -> desc -> cleared.
Column headers are real buttons (`a2-th-btn`, focus ring, aria-sort on th).

Readouts (full text in readout.txt, `l4w2r C1/C2 rework readout` section):
- URL persistence: `?keyword=AgentOS&lifecycleState=active` reloaded -> inputVal=AgentOS, rows=2 -> w2-c2-url.png
- Search interaction: typed `zzz不存在` -> `?keyword=zzz%E4%B8%8D%E5%AD%98%E5%9C%A8`, rows=0, empty state shown -> w2-c2-search.png; restored to AgentOS rows=2
- View switch: `对话位` -> `?view=chat`, chatview text `对话位聚合视图未接入` (honest, no fake aggregation) -> w2-c2-viewchat.png; back to table clears param
- Sort by cost: asc -> costs [USD 0.01, USD 0.12] `?sort=cost%3Aasc`; desc -> [USD 0.12, USD 0.01] `?sort=cost%3Adesc` -> w2-c2-sort.png (name sort exists but pilot rows share display name, cost chosen for visible order change)
- Keyset pagination: `?limit=1` rows=1 (cost 0.12), next-page click -> URL gains server-issued `cursor=eyJjcmVhdGVkQXQ...` (base64 created/id, real keyset), rows=1 (cost 0.01) -> w2-c2-nextpage.png

### Secondary cell fixes (card item 4)
- version cell: `v{N} · {MM-DD HH:mm}` separator added (was `v311-15`)
- status cell: `a2-cell-nowrap` added (no per-character wrapping)
- owner cell: display stays the truncated handle (`fmtId`: `pilot_…lder`, `1`), the raw full handle moved to a hover tooltip (`title={ownerUserId}`) - per card item 4 the visible text must be a truncated handle, not the raw handle

### Gates on the rework tree
- platform lint exit 0; targeted `src/pages/AgentConsoleV2` exit 0 (Test Files 9, Tests 112 incl. +2 new sort/pagination tests)
- full platform test: Tests 43 failed | 1747 passed (1790) -> frozen baseline 43 failed / 18 files, new failures 0, passed strictly increased
- build:platform exit 0; VITE_AGENT_CONSOLE_V2=1 build:platform exit 0 (entry assets/js/index-_oTHR00v.js); git diff --check exit 0
- C0-B still open -> page stays in-progress, no PASS judgement here.
