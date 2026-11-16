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

## R1b — C2/C5 浏览器腿（ego-browser，2026-11-16 14:0x–14:2x +0800）

方法：`/Users/kevin_studio/.local/bin/ego-browser nodejs`（taskSpace l6-ov-r1b，复用 ego 现役登录态，零新口令、零共享 cookie 清除）；dev 5399 + BFF 8092；1440×900 dsf2；DOM 断言脚本 $T/r1b-ego.js / r1b-ego2.js；console error 钩子=console.error+window.error+unhandledrejection 全流采样；截图 $T/r1b-c5-final-1440.png。

| 项 | 判据 | 判定 | 证据 |
|---|---|---|---|
| C2-F 默认档 | 默认 28d | **PASS** | ov-range-28d aria-pressed=true、URL 无 range、range28pressed 一致 |
| C2-F range 切换 | 7/28/90 URL+数据+时间刷新 | **PASS** | ?range=7d → updated『更新于 11-16 13:55（本页最晚成功响应）』、runs KPI=14（基线）；?range=90d；28d 复原 true |
| C2-F 下钻 href | KPI/区块链接 | **PASS** | /agent/employees?lifecycle=active&src=ov、/agent/approvals?status=pending&src=ov、/agent/audit ×3、去审批中心/运行中心/任务板（队列空态 CTA） |
| C2-F weeks 切换 | 4/8/12 | **PASS（修正 R1）** | 控件=BUTTON aria-pressed（4周 true）；点『12 周』→ URL ?weeks=12；R1『weeksLinks=[]』系我只查 <a href> 的探测映射错误，非页面缺陷 |
| C2-F7 focus/复原 | ?range=&weeks=&focus= 五步复原 | **FAIL** | 三参数解析生效（URL 保持+heat 列变化+scrollIntoView @194），但页内无『清除条件』控件（button/a 文本 清除|clear|×|✕ 全枚举=0），focus=cost 无持久可见高亮态（cost 卡片 className 无 focus 标记）→ 用户无法一步复原；owner=L4 |
| C2 空态诚实 | 各队列/活动空态 | **PASS** | 『今天没有到期单』『这里会出现：待你审批…』×3 队列、异常『0 条…这里会出现：失败、中断…』、活动『近 24 小时暂无运行或审计记录』、M2『组织级待办未接入』注记在位——非光杆『暂无数据』 |
| C5-E 登录→列表→详情→返回→刷新 | E2E 链路 | **MEASURED PASS** | 现役会话登录态 200（approval-stats）；总览→在岗 KPI→/agent/employees（items=2 列表）→emp_86A8 详情→history.back→列表；总览重载 updated 时间刷新（13:55 腿）。程序偏差注：back 后 reload 落在列表页；总览 reload 腿已由 range 切换步覆盖 |
| C5 console errors | 零 | **PASS** | 全流 __errs=[]（两脚本独立采样均 0） |

## R2 — C4-P2 GAP-OV-19 修复轮 + C6 eslint 复测（14:2x +0800）

- **C4-P2 判定：PASS（代码 + 单测矩阵代证）+ OBSERVATION(no child_admin account)**。fixer 交付 `lane/L7-ov01-bff-authz` @ `9f509136629e3e8ed2d8afb570c906957ba0d621`（基点 ed2bab9，L0 提供，本轮 fetch 亲验）：`_identity_granted` 现仅 `return data.get("is_global_super") is True`，`is_child_admin` 直通已删；注释明确『子租户管理员一律凭 web_menu 授权，默认 403』。test 反向 `test_child_admin_flag_without_menus_is_denied` + 新增 `test_child_admin_with_granted_menu_is_allowed`（菜单为授权源）+ 矩阵断言 `g({is_child_admin:True}) is False` / `g({is_child_admin:True, web_menu:["agent"]}) is True`。L0 独立跑 `apps/console/tests/test_bff_authz.py` = **15 passed**。在线无 child_admin 账号，页面层 403 腿待部署拍（checklist §4 允许单测代证，非阻断 NM）。未合并、未部署（遵卡）。
- C4 viewer01/未登录/admin/404 三负例沿用 R1 PASS。
- **C6 scoped eslint：PASS（exit 0）**——修正 R1『NM』。可复现命令：`ln -sfn $F/src/frontend/node_modules $T/wt-ovl6/src/frontend/node_modules` 后，于 src/frontend/platform 执行
  `../../node_modules/.bin/eslint --suppressions-location eslint-suppressions.json src/pages/AgentConsoleV2/{OverviewPage.tsx,OverviewBlocks.tsx,__tests__/OverviewRedo.test.tsx}` → **rc=0**。
  教训（坑位记录）：临时目录 npx 拼装（react-hooks@6）会引入仓库未钉规则（set-state-in-effect/purity）产生 2 个假阳性；必须用 pnpm store 钉版 eslint@9.39.5 + eslint-plugin-react-hooks@5.2.0（require.resolve 实证），且 config import 解析自 wt 内新增的 src/frontend/node_modules 软链。$T/wt-ovl6/src/frontend/node_modules 为 untracked 环境软链，非交付物。

## R1b/R2 后整页状态（供 r3 终局）

已收口：C3 三方 PASS、C4 全腿 PASS（P2 代证）、C5 浏览器腿 MEASURED PASS、C6 全 PASS（vitest 134/134 + scoped eslint rc=0 + diff-check 0）。
仍开放：① **C2-F7 FAIL**（focus 持久高亮与页内清除控件，owner=L4，代码位 OverviewPage.tsx:190-197）；② C1 视觉门已 PASS（369c2fa 审计件）；③ C5-E1 8182 冒烟 PENDING(deploy)。
整页判定：仍不 PASS——唯余 C2-F7 一项实现级 FAIL；其修复后 + 部署 8182 补 C5-E1 即可宣告整页 PASS。预计 r3 终局判词=L4 修复 C2-F7 并 push 后 10 分钟内（range/weeks/focus 三参 URL 与数据腿已全绿，修复面小）。

## R2b — C4-P2 独立矩阵重跑（L6 亲验，14:2x +0800）

按卡要求不引用修复方 15/15，独立重跑：worktree @9f50913（`git worktree add --detach $T/wt-bffr2 9f50913`）执行
`uv run --with pytest --with httpx pytest apps/console/tests/test_bff_authz.py -v`
→ **rc=0，15 passed in 1.03s**（原文 $T/bffr2-pytest.out）。关键用例亲验：`test_child_admin_flag_without_menus_is_denied` PASSED、`test_child_admin_with_granted_menu_is_allowed` PASSED、`test_identity_granted_matrix` PASSED。
**C4-P2 判定升级为 L6 独立 PASS**（代码 diff 亲读 + 矩阵亲跑），OBSERVATION(no child_admin account，在线腿待部署拍) 维持。四硬门收口：C2=PASS 除 C2-F7 FAIL；C5=MEASURED PASS；C4-P2=PASS(独立)；eslint=PASS(rc=0 钉版)。整页仍不 PASS，唯一实现级阻断=**C2-F7**（focus 持久高亮+页内清除控件，OverviewPage.tsx:190-197，owner=L4）；部署腿=C5-E1 PENDING(deploy)。r3 终局=L4 修 C2-F7 push 后 ≤10 分钟给。

## R3 终局复跑（C2-F7 修复 36f2b42 / dev 5401 + BFF 8092）— 2026-11-16 14:2x

被测源：lane/L4-ov01-c2f7 @ 36f2b422f4bf9e1ffc208ce56ddb6cf8a791c324（基点 6148b2b；改动 6 文件 OverviewPage.tsx/css/三语 bs.json/OverviewRedo.test，与卡面一致）。8182 未部署（PENDING(deploy) 维持）；5399 现查仍服务主检出 6148b2b（无修复代码），故本拍在 lane worktree 检出 36f2b42 并以同构 dev 配置（代理 /agent-api→8092）起自有 vite 5401 作为被测源，VITE_AGENT_CONSOLE_V2=1 开 V2 壳；证据文件 $T=…/T/opencode：r3-vite-5401.log、r3-ego.out/r3-ego2.out/r3-ego3.out/r3-ego5.out/r3-ego7.out、r3-vitest.out、r3-eslint.out、r3-bff-authz.out。

### 判词（四项，五值制）

| 项 | 判定 | 实测证据（ego 现役 opsadmin 会话，零回显） |
|---|---|---|
| C2-F7 五步复原 | **PASS** | S1 默认无控件（clearBtn=false, p28/w4 pressed=true, search=''）→ S2 ?range=7d 控件出现（clearBtn=true, p7=true/p28=false）→ S3 点清除 search='' p28=true 控件消失 → S3b 清除后刷新仍默认（search=''）→ S4 ?weeks=12 脏→清除 w4=true。focus 腿：S5 ?focus=cost 直达 block-cost ring（costRing=true, outline solid 2px, ringCount=1）→ 刷新仍持久 → 数据回填（updated 在位）后仍持久；S6 ?focus=cost&range=7d 清除后 ringCount=0 且参数全清 |
| C2 其余不回归 | **PASS** | S7 点击 7天按钮→search=?range=7d+p7 pressed+p28 false+updated 在位；KPI/导航 href 8 条完好（/agent/employees、/agent/approvals、/agent/tasks、/agent/runs、/agent/metrics、/agent/audit、/agent/settings、/agent/employees?lifecycle=active&src=ov） |
| C5 真实 E2E | **PASS（MEASURED）** | 总览 /agent ov-page+updated ✓；approval-stats in-page fetch=200 ✓；/agent/employees rows=2 ✓→详情 /agent/employees/emp_86A81CE8FF6F42E187BCF2B540（agent-v2-employee-detail 根节点）✓→回退 rows=2 ✓→刷新 rows=2 ✓；console error 全程 0（r3-ego7.out L1-L5） |
| C4-P2 GAP-OV-19 矩阵 | **PASS** | 主仓 detached worktree @9f50913：uv run --with pytest --with httpx pytest apps/console/tests/test_bff_authz.py -q → 15 passed rc=0（r3-bff-authz.out） |
| C6 门禁 | **PASS** | targeted vitest（树=36f2b42）12 files/137 passed rc=0（含 OverviewRedo 新增 3 用例：默认隐藏控件/focus ring 持久/清除复原）；钉版 eslint（fork src/frontend 层）对 OverviewPage.tsx+OverviewBlocks.tsx+OverviewRedo.test.tsx rc=0；git show --check 36f2b42 rc=0 |

### 观察项（不阻断）

- OBS-1 back 语义：清除后浏览器返回会恢复 ?range=7d（页状态与 URL 一致重放，标准 SPA URL-driven 行为；卡面「回退仍默认」若作强判据需参谋定口径——本拍按『状态恒随 URL』判 PASS）。
- OBS-2 清除按钮在 focus=cost 视口滚动态下需先回顶部才命中（ring 滚动目标卡所致，非缺陷）。
- OBS-3 5401 为评审自起 dev 源（同 8092 代理、同 5399 配置族），部署轮以 8182 served 为准重验。

### 整页口径

**C2–C6 pre-deploy PASS，部署后仅补 C5 冒烟（8182 served entry 对账 + 登录→总览→列表→详情腿在 8182 重放）。** C1 视觉门已由 R3 审计件 PASS（main 369c2fa）。本轮未改代码/BFF/契约，未部署 8182，未合并 main。

## R4 部署后终局（8182 served）— 2026-11-16 14:3x — C5-E1 FAIL(部署门未满足)

卡基线对账：/agent/ 引用 assets/js/index-BFU-ZETxXUQ6.js，served sha256=cbc34f89…ef7c8==卡（200 text/javascript，1514B）；旧 entry BMUzMMBj/4d_yEKwU/DOA918V3 全 404。表面上 served 同一性 PASS。

**但 8182 现服务的是未启用 console-v2 的 Bisheng 构建，OV-01 未上屏：**
- 该 entry 的引导代码 `import("./TenantSelect-*.js")`（Bisheng 主前端入口，非 V2 壳）。
- ego 实测（r4-mini/r4-probe2，opsadmin cookie 有效）：/agent/ 渲染 Bisheng 旧壳（title=BISHENG，导航=看板/构建/知识/…/数字员工控制台，无任何 agent-v2-* testid）；/agent/employees 与 /agent/employees/emp_86A8… → 重定向 /404；/agent/approvals → 停留但无 V2 渲染。
- 产物旁证：懒 chunk shellPages-DY61EQ2r.js 内含 agent-v2-ov-page/agent-v2-ov-clear-filters/ov-focus-ring（OV-01 修复代码在此构建里），但路由门未开——典型症状=构建缺 VITE_AGENT_CONSOLE_V2=1（5399 的 .env 有此 flag；先例『评审自起 vite 必须带 VITE_AGENT_CONSOLE_V2=1』同源）。

判定（五值）：
- 部署同一性（entry/sha/旧产物404）：PASS
- C5-E1 8182 登录→总览→列表→详情→返回→刷新：**FAIL（部署门未满足：/agent 不落 V2，链路起点即不可达）**——非页面代码缺陷，代码腿在 pre-deploy 5401/5399 已 PASS（R3 节）
- C2-F7 served 重放：NOT MEASURED（V2 未上屏）
- C4 复核：admin 会话存在（Bisheng 导航显 opsadmin）但 V2 入口 404 无从复核页面腿；API 腿沿用 18cfa0b/a1833d1 先例（admin 200/viewer 403，BFF pid 65008 重启后未重测）= NOT MEASURED(本轮)
- console error：不适用（V2 未加载）

整页最终判定：**OV-01 不 PASS（阻断项=8182 部署构建未启用 console-v2；修复 owner=L7/部署：以 VITE_AGENT_CONSOLE_V2=1 重新构建并 lan stop/start，或指向 bisheng-ov01-build 的正确 dist）**。修复重部署后仅需补 C5-E1 冒烟 + C2-F7 served 重放（各 5 分钟），pre-deploy 证据链完整。不计 4/15。

证据：$T/r4-ego.out、r4-mini.mjs/r4-probe2.mjs（ego，opsadmin 现役 cookie，零回显）、r4-entry.js、r4-tenant.js、r4-shell.js（chunk 计数见正文）。
