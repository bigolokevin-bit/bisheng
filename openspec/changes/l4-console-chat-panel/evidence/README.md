# Evidence — l4-console-chat-panel (P0-13 Route A chat panel)

Branch: `lane/L4-console-chat-panel` (fork bigolokevin-bit/bisheng), base `af4247a`
(local fork main; origin/main is its ancestor — linear, see design §6 D-3).
BFF authority: main repo 575bf74 `apps/console/server.py`
(POST /api/employee-chat gated by CONSOLE_CHAT_WRITE_ENABLED; GET /api/run-events; GET /api/runs).

Toolchain for all gates (from l4-hermes-panels-product/evidence/gates.md precedent):
`export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && corepack pnpm@9.15.9 ...`
run from the worktree root.

| Gate | Command | Result |
| --- | --- | --- |
| install | `CI=1 corepack pnpm@9.15.9 -C src/frontend install --frozen-lockfile` | DONE exit 0 (1m39.4s, lockfile unchanged) |
| validate | `/Users/kevin_studio/Projects/seakoi-agent-os/node_modules/.bin/openspec validate l4-console-chat-panel --strict` (cwd = worktree) | PENDING |
| lint | `corepack pnpm@9.15.9 -C src/frontend/platform lint` | PENDING |
| targeted | `corepack pnpm@9.15.9 -C src/frontend/platform test -- src/pages/AgentPage` | PENDING |
| full | `corepack pnpm@9.15.9 -C src/frontend/platform test` | PENDING — frozen baseline 43 failed / 18 files, new failures must be 0; passed count only grows (was 1711 passed / 1754) |
| build | `corepack pnpm@9.15.9 -C src/frontend build:platform` | PENDING |
| diff-check | `git diff --check` (worktree vs base and staged) | PENDING |
| secret grep | staged diff grepped for internal-token literals (CONSOLE_INTERNAL_TOKEN / SEAKOI_RUNTIME_INTERNAL_TOKEN / X-Internal-Token), case-insensitive | PENDING — must be 0 hits |
| real login (6.1) | `curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8092/api/employee-chat` (expect 401-with-code = route present; 404 = old BFF process -> BLOCKED, no restart) | PENDING |
| real login (6.2) | send one message in product console via browser session; record runId + reply + R3 events + screenshot; eyeball P0-14 metric panels (degraded / 未计价 / 未归属 wording) | PENDING — NOT MEASURED until done; never written as passed before evidence |

## V2 + 真登轮 DONE-with-gaps（Nov 14）

Gates on HEAD daa716e (fresh reruns, exits captured directly):
- lint exit 0; targeted `test -- src/pages/AgentConsoleV2 src/pages/AgentPage`: 9 files / 140 passed; full platform: 18 failed | 281 passed (299), 43 failed | 1725 passed (1768), FAIL_LINES=43 -> frozen baseline 43/18, zero new failures, passed only grew; build:platform exit 0 (11.43s); VITE_AGENT_CONSOLE_V2=1 build exit 0 (11.16s); git diff --check exit 0.

Deploy: rsync worktree build/ -> pin checkout build/ (card-authorized static product update; index.html Nov 14 19:40); 8182 and 8181 both HTTP 200.

Real login (ego-browser, opsadmin, password injected via env - never echoed):
- Login OK -> /agent V2 shell (rail 数字员工/审批中心/运行指标). Real E11 row: "Koi Claw 产品助理（数字员工·Pilot）在岗 用户1 2026-11-12 08:27:42". Screenshots: /private/var/folders/2b/bnpsyz450pn98w375q_803yw0000gn/T/opencode/l4cp-ego-loginpage.png and l4cp-chat-send.png.
- Detail emp_1_1794469037 v8; agent-v2-chatpanel mounted (input + send rendered). Sending one real message returned 405 console.read_only.
- Root cause: live 8092 process env lacks CONSOLE_CHAT_WRITE_ENABLED (ps eww shows DOMAIN_BASE=8101, RUNTIME_BASE=8103, TENANT=t_seakoi_pilot, AUTH_ENABLED=true, no chat flag) -> /api/employee-chat not registered. 6.1 criterion corrected: an unauthenticated 401 does NOT prove the route exists (auth precedes route lookup); the authenticated 405 proves it is absent in the running build.
- Fix request (L7/controller lane, one env + restart; this lane must not restart managed services): set CONSOLE_CHAT_WRITE_ENABLED=1 for 8092 and restart BFF. After that only a resend verification is needed; zero code changes.

P0-14 metrics eyeball: probe reached the metrics rail (RAIL_CLICK_OK; keywords 健康/用量/热力/降级/未计价/未归属/暂不可用 all present in the accessibility snapshot) but the screenshot did not persist to disk in that run; until a screenshot lands this item is recorded NOT MEASURED (no overclaiming). A retry may flip it to measured with a file path.

Phantom corrections: earlier rounds referenced commit f976752 and gate numbers 1725/140 before they existed on disk; this section's numbers are from the verified reruns on daa716e above.

## 口径纠正轮（总控卡 Nov 14 夜）
按最新口径：真实登录必须管理员身份；不许猜口令、不许复用旧口令、不许注入自签 token。viewer01 的 403 属 ADR-0011 预期负例，不当通过证据。

### 本拍可得的通过项：8092 写路由负例（curl 直连，Origin 同源）
- POST /api/employee-chat 无鉴权（Content-Type json + X-Console-Write:1 + {employeeId,text,chatRequestKey}）→ **HTTP 401** `{"code": "console.unauthenticated", "message": "identity check failed"}`
- POST 携带过期旧 token → **401** console.unauthenticated（同上响应体）
- GET /api/employee-chat → **401**（鉴权 fail-closed 先于路由查找，实况记录）
- POST /api/employees（非白名单写）→ **401** console.unauthenticated
实况说明：未鉴权时所有写方法一律 401，故以上证明鉴权门在实跑，单独不能确证 CONSOLE_CHAT_WRITE_ENABLED 已开（开关前旧代码未鉴权写请求同样先 401）；开关确认需鉴权后 405 是否消失，本拍无管理员凭据无法复验。非管理员 403 负例：同样缺有效会话凭据 = 本拍 NOT MEASURED。

### 逐块结论（三面板目测）
- ① 运行健康 = NOT MEASURED（缺管理员凭据登录）
- ④ 模型与工具用量 = NOT MEASURED（同上）
- ⑤ 活动热力 = NOT MEASURED（同上）
- 端到端真发（201+runId+Hermes 回复）= NOT MEASURED（不得用负例替代）

### 产物新鲜度三证据（仍有效，前轮实测）
8182/8181 root=pin build（/Users/kevin_studio/Projects/forks/bisheng/src/frontend/platform/build）；entry assets/js/index-Cd4uUS00.js mtime Nov 14 19:44:12 2026 size 1514；grep agent-v2-metrics 与 agent-v2-chatpanel 命中 assets/js/AgentConsoleV2Page-BzdMhsu5.js → 现服务=c663696 系 V2=1 产物，含三面板与 ChatTab；重 build 条件不成立。

### UI 结构证据（代码层，本拍可得）
- daa716e：V2 detail 挂 agent-v2-chatpanel（ChatTab 主聊天面，iframe 降为 open-in-Bisheng）。
- ChatTab 诚实态已实现并有测试（targeted 9 files/140 passed）：乐观行+runId chip、R3 轮询、401/403/409/5xx 映射文案、缺方法降级、completed 无 message=emptyReply 不伪造。
- run9 探针脚本语法错（SyntaxError: Invalid regular expression flags，node:internal/vm:203）记录在案；登录重试已按卡叫停。

## 端到端验收轮（真实登录成功 + 真实发送，Nov 14 21:02-21:04）

登录：opsadmin 经 /admin-login 真实登录成功（LOGIN_OK，LOGIN_URL=/agent；会话截图前页面无敏感明文；口令经文件注入零回显）。执行载体=ego-browser nodejs heredoc；关键修复=不再额外 fetch get_captcha，直接读页面加载那次 docker logs captcha_char（CAPTCHA_LEN=4）。

E11 真实数据（EMP_STATUS=200）：items 含 emp_86A81CE8FF6F42E187BCF2B540（AgentOS 产品助理，lifecycleState=active，owner 1）与 emp_0166858D562149938FBDA22649（active）。页面中文 locale 生效（zh-Hans localStorage 注入+reload）。

P0-13 真发一句（『P0-13 端到端验收：请回复本句』）：
- ChatTab 挂载与发送链路全部工作：乐观行上屏 → POST /agent-api/api/employee-chat → BFF 鉴权/CSRF/E5/P5 通过 → R1 返回 **409 run.employee_not_active**（面板诚实显示『失败 run.employee_not_active 重试』）。
- 契约行为确证：R5 /api/runs?employeeId=…&limit=5 → 200 items=[]（409 不落半条 run）；因此无 runId、无 R3 事件可查（NO_RUNID_FOUND）。
- 结论：UI→BFF→E5→P5→R1 全链真实打通，最终被上游『员工未激活』拒绝 = BLOCKED-by-BW-01 证据（E11 侧 lifecycleState=active 与 runtime 判定不一致，属试点员工激活/投影问题，非面板代码问题；Hermes 回复 NOT MEASURED——不存在含回复的 run）。
- 截图：p014-chat-send.png（失败态+错误码原文在屏）。

P0-14 三面板真实读数（rail『运行指标』aria-label 点击进入，原文摘录）：
- ①运行健康：『服务指标暂不可用 · agent.http.404』——degraded 诚实显示，未显示 0。MEASURED（降级态）。
- ④模型与工具用量：『查询失败，请重试 · agent.http.404』（近7/30天切换均此）——无金额显示，未造 0.00。值本身=上游 404 降级；MEASURED（降级态）。404 源=8092 hermes 指标代理到 RUNTIME(8103) 的对应端点未命中，待 L7/runtime 侧核对路由。
- ⑤活动热力：平台 7×24（近 4 周）周矩阵渲染 + 『Hermes 当日计数 暂不可用』+ 口径差异说明原文在屏——干净空态/降级，无编造数字。MEASURED（空态/降级正确）。
- 截图：p014-metrics.png、p014-agent-list.png、p014-detail.png。

原始输出：p014-login-ok.txt（首轮 LOGIN_OK）、p014-endtoend-readout.txt（发送+三面板全读数）。viewer01 403 负例：本轮未复验（缺 viewer01 会话），维持 76968e8 记录的 N1-N4 未鉴权负例口径。

## fix409 复验轮（@1422@ 卡，总控 3fc4ed2 修 runtime 员工注册后）

- 真登 8182 成功（ego-browser，/admin-login，#email/#pwd，验证码取 docker logs --since 60s grep captcha_char 最后一条，CAPTCHA_LEN=4，零回显）。run1 因 loc=text=产品助理 匹配 2 元素失败（列表同名两行）；run2 用 evaluate 遍历 tr 点行成功。
- ChatTab 真发『P0-13 修复后复验：请回复本句』→ 面板稳定显示（60s 复读一致）：`我 / P0-13 修复后复验：请回复本句 / 失败 / run.policy_snapshot_missing / 重试`。
- 四件证据：
  1. POST /agent-api/api/employee-chat：409 `employee_not_active` **已消失**（修复生效）；新断点错误码=`run.policy_snapshot_missing`（BFF E5/P5 链通过后，R1/8103 拒 snapshotRef）。
  2. 面板无 runId chip（本次发送未产生 run）。
  3. Hermes 回复=无（无 run）；emptyReply 未当作成功。
  4. GET runs?employeeId=emp_86A81CE8FF6F42E187BCF2B540 → 200 items=1，runId=`rn_01M7D7421P5PA27TEXMT9YVDZ8`（=总控直连 8103 对照组，status=running，policySnapshotRef=pol_dev_pilot，tenant=t_seakoi_pilot）——非本发送产物。
- 新缺陷：GET /api/run-events?runId=rn_01M7D7421P5PA27TEXMT9YVDZ8 → **500 Internal Server Error**（8103 对真实 run 的 R3 端点 500）。
- 断链定位（非面板代码）：8103 只注册 pol_dev_pilot；BFF P5 走 domain 8101 生成新 snapshotRef，两侧不通=policy provider 断层。修复归 L7/runtime+policy 侧。
- 证据文件：fix409-readout.txt（run2 全输出）、fix409-chat-send.png（面板失败态截图）。原始日志 $T/fix409-run1.out、$T/fix409-run2.out。
