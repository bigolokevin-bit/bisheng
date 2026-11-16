# L6-REVIEW — OV-01（lane/L6-ov01-r1）

## R1 — C2–C6 复跑（pre-deploy，dev 5399 + BFF 8092）— 2026-11-16 13:4x–14:0x +0800

> 评审对象：fork `lane/L6-ov01-r1` @ `6148b2b`（树 = `8f5a6bf` 全区块 build2；C1 整页构图 PASS = 仅视觉门，非最终 PASS，Kevin 13:45 明确）。
> 清单：`L6-RERUN-CHECKLIST.md` §2–§6（main `7c0a759`）。环境：dev 5399 = vite @6148b2b 检出（`/Users/kevin_studio/Projects/forks/bisheng-chat-panel`，rev-parse 现查一致）、`/agent` 200、`/agent-api`→8092（python pid 33475）。
> **8182 served entry：`PENDING(deploy)`**——本轮不部署、不预填、不预勾；部署后另拍 C5 冒烟。

### 判定总表（每项 PASS / FAIL / NOT MEASURED；OBSERVATION 附注）

| 项 | 判定 | 证据 |
|---|---|---|
| C2 元素真实动作/下钻/28d 默认/URL 五步复原/weeks 切换/空态可达 | **NOT MEASURED**（浏览器交互腿未跑：lane 无 playwright/puppeteer，ego-browser 探针未及窗内；≤1 拍纪律） | OBSERVATION（非 L6 实测，不作判）：代码 `OverviewPage.tsx:73` `DEFAULT_RANGE='28d'`、`:171/173/175` range/weeks/focus 读参、`:534/827` updateParam；L4 readout-build2.txt `range28pressed:true`（12:2x 同代码代） |
| C3 数据真实（三方并列） | **PASS**（附 OBSERVATION） | 见下方三方表；无 fixture（全真实 BFF 响应原文）、无假 0、无「待接入」上屏证据（数据侧）、`fmtUsd` null→`—`（代码 OverviewBlocks） |
| C4 viewer01 403 | **PASS** | viewer01 RSA 登录（user_id=2）后 dev 5399 五端点全 403 `{"code":"console.forbidden","message":"console entry not authorized for this account"}`：employee-stats/approval-stats/run-stats/run-activity/budget-usage；`/agent` HTML=200 SPA 壳（只记现象不判） |
| C4 未登录 401 | **PASS** | 无 cookie：employee-stats、run-stats → 401 `{"code":"console.unauthenticated","message":"identity check failed"}` |
| C4 admin 允许 | **PASS** | opsadmin（user_id=1）全腿 200（下表） |
| C4 404（未知 id 代测跨租户口径） | **PASS**（口径注明：现网无第二租户样本） | admin 下 `/api/approval?id=ap_000…`→404 `approval.not_found`；`/api/employee?id=emp_000…`→404 `employee.not_found`（与 r2 viewer 轮 403 遮蔽对照） |
| C4-P2 GAP-OV-19（删 is_child_admin 直通） | **FAIL** | `origin/main:apps/console/server.py:552` 仍 `return data.get("is_child_admin") is True or …`；且 `apps/console/tests/test_bff_authz.py:125 test_child_admin_flag_without_menus_is_allowed` 断言放行=与参谋拍板②相反。BFF 域修复，归 L2/L0；页面层无绕过（不放行逻辑核过 OverviewPage 无本地鉴权） |
| C5 登录→总览→下钻→刷新、零 console error | **NOT MEASURED**（浏览器腿同上，缺因：lane 无 playwright；ego-browser 一拍未成） | 子腿 MEASURED：全新 opsadmin RSA 登录成功（LOGIN-OK，零回显）、`/agent` dev HTML 200、API 无 ≥400（admin 腿全 200，未登录腿 401=预期门）；下钻 href 代码级 OBSERVATION（`NavLink` to=…&src=ov 在位） |
| C6 scoped eslint | **NOT MEASURED** | fork 主检出 node_modules 无 eslint bin（`.bin/eslint` 不存在，`npx --no-install` exit 127；bisheng-ov01-build 亦无）——工具缺失，非代码缺陷 |
| C6 targeted vitest / 全量基线新增失败 0 | **PASS** | `vitest run src/pages/AgentConsoleV2` @6148b2b（worktree+主检出 node_modules 软链）= **12 files / 134 passed, exit 0**（日志 `$T/c6-rerun.log`）；EMP-01/EMP-03/APR-01 相关套件全在其中，回归不破=测试面 |
| C6 build/diff-check | **PASS（diff-check）/ OBSERVATION（build）** | `git diff --cached --check` 0（本笔）；6148b2b=docs-only（5 证据文件，代码树=8f5a6bf）；dev 腿跑通即 vite 编译通过旁证，正式 build 对账归部署拍（G-5 未满足：`PENDING(deploy)`） |
| G-4/G-5 served 8182 pair/entry | **BLOCKED(not-deployed)** | 8182 仍 EMP-03 `75440dd`/entry `BMUzMMBj`（C1 审计件 §8182 现查 + 本轮未动）；不得伪装 PASS/FAIL |

### C3 三方并列（checklist §3 硬要求）

| 腿 | runs（近 7 天滚动，不带 employeeId） | succeeded | failed | 运行中/未知 | 证据 |
|---|---|---|---|---|---|
| R6 bucketSum `GET /agent-api/api/run-stats?bucket=day&from=now-7d&to=now` | **14** | 13 | 0 | unknownRuns=0（桶面）；nbuckets=2（11-12:1, 11-14:13） | admin 腿原文 `$T/rerun-admin.out`、`$T/extra_legs.out` |
| runs 列表 `GET /api/runs?since=now-7d&limit=100` | **14**（completed 13 + running 1） | — | — | running=1 | `RUNS-SINCE7D n=14 {'completed':13,'running':1}` |
| 屏显（KPI-3/趋势摘要） | **14**（readout-build2.txt `KPI runs7d:14`、TREND 摘要 `14·13·0·1条运行中/未知·100.0%`，13:30 同树批次） | 13 | 0 | 1 | L4 DOM 读数（fork `6148b2b:docs/.../shots/readout-build2.txt`）；OBSERVATION：屏显腿为 L4 同批证据，L6 浏览器独立复测归部署拍 |

其余数字腿（admin，8092 经 5399 代理，均真实响应原文）：employee-stats `{total:2, active:2}`（在岗 2 ✓）；approval-stats `{pending:0,dueSoon:0}`（✓，assignee=human:opsadmin 与 human:1 同）；budget-usage 2026-11 ΣcostUsd=**0.132696**→USD 0.13 ✓（OBSERVATION：P9 `enrichment.effectiveBudget.monthlyCostUsd=[None,None]`，屏显上限 20.00 来自 effective-config 腿——配额分母源与 P9 不同端点，口径交参谋确认是否 PRD CB03「limit=null→未接入」分支被 effective-config 满足）；run-activity weeks=4 `max=4, 7 cells`（OBSERVATION：基线卡写「峰值 8」，现网漂移 4；L4 readout 已声明「按既有豁免不硬编码 8」，一致）；audit 24h `events=[]`、tasks dueBefore `items=[]`（诚实空）；runs 无过滤→400 `request.missing_filter`（缺过滤上游 400 原样）。

### 前轮偏差闭环注

R2 轮（main `3d9e547`）观察①「succeeded=13 vs 列表 completed=12+running=1=13 vs 卡称 14，差 1」——本轮窗口对齐（R6 7d 与 runs?since 7d 同窗）后两腿同为 14，差值消除；当时偏差归因=窗口/过滤不同步（11-09~11-16 窗含 11-09 边界样本漂移），非数据矛盾。

### 命令复跑

- `$T/rerun_legs.py`（MODE=admin/viewer，口令仅 env，输出 `$T/rerun-admin.out`，零回显）；`$T/extra_legs.sh`（Bearer 文件传递，用后即删，不落证据值）。
- vitest/eslint：`cd wt-ovl6/src/frontend/platform && node_modules/.bin/vitest run src/pages/AgentConsoleV2`（node_modules=主检出软链；车道禁 install 先例）。
- T=`/private/var/folders/2b/bnpsyz450pn98w375q_803yw0000gn/T/opencode`。

### 本轮整页结论（判词）

**OV-01 整页不 PASS。** 阻断/未测面：C2 交互腿 NOT MEASURED、C5 E2E 腿 NOT MEASURED（均因浏览器工具缺位，非页面缺陷证据）、**C4-P2 GAP-OV-19 FAIL（BFF is_child_admin 直通未删，须 L2 修复后 C4 复跑）**。数据真实（C3）与权限负例（C4 三腿）、C6 测试面 PASS。下一步顺序建议：① L2 收紧 BFF+修 test_bff_authz 断言方向；② 部署 8182（新 entry 现查）；③ L6 带浏览器腿（playwright 可用环境或 L7 pair 工具）复跑 C2/C5；④ 之后才可判整页 PASS。

回报判词时间：本笔 push 即判词生效（14:0x +0800）。
