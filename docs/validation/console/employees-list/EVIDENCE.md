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
