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

## P0-13 复验二（fix409-round2，Nov 15 00:04-00:12 本地时间）：BLOCKED — identity 隧道故障，未达发送

- 两次真实会话尝试（浏览器已登录 opsadmin，URL_NOW=/agent 无踢出）：
  - run3：E11/面板请求全部 502 `{"code":"console.upstream_unavailable","message":"identity service is not reachable"}`；面板 NO_PANEL、R5=502 同信封。截图 fix409-chat-round3.png。原始日志 fix409-round2-run3.txt / run4.txt。
  - run4（间隔数分钟后重试一次）：同一 502 信封，未发送任何消息（0 条员工消息发出）。
- 根因证据（非本车道代码）：`lsof -nP -iTCP:7860 -sTCP:LISTEN` = **ssh PID 80386**（lima/docker 端口转发隧道），BFF(8092) 的 user/info 回调经该隧道间歇拒连→URLError→502；直连 curl 7860 平时 401/200 可达。8092 无鉴权路径 401 console.unauthenticated 正常（fail-closed 无异常）。bisheng-openfga 43 分钟前重启（unhealthy），隧道劣化疑似同窗口运维副作用。
- 结论：8103 修复（real-p6）本身与本链无冲突——上一轮（fix409-run2，昨夜）同脚本 E11=200/R5=200 全通，仅 policy 断点；本轮是 **identity 回调隧道故障**，属 L7/ops 通道，受『不重启共享服务』红线约束未处置。待隧道恢复后重跑同一条链即可（零代码改动）。
- 本轮未产生新 run、未触碰 emptyReply、未改任何代码。

## P0-13 round-3 re-run (post 7860 tunnel recovery) - transient 502, not reproducible

- 2026-11-15 00:07:55 +0800 pre-check: direct /api/v1/user/info x3 = 401 (reachable); 8092 unauthenticated = 401.
- 00:08:42Z ego-browser same-session run5: browser-initiated E11 GET via 8182 -> 8092 returned 502 console.upstream_unavailable (identity service is not reachable) -> script stopped by design (single-shot rule), no send attempted. Log: fix409-round3-run5.txt.
- 00:09:05 +0800 immediate differential probe: direct 7860 x5 = 401 all; through-8092 authenticated-path probe (bogus Bearer POST /api/employee-chat) x5 = 401 console.unauthenticated all; BFF log lines [bff] chat req=... result=console.unauthenticated status=401 prove the identity callback was reachable right after the 502.
- Reading: BFF->7860 callback over the lima/ssh 80386 tunnel is intermittently failing (this is the 3rd observed occurrence: fix409-round2 run3/run4 502 x2, now run5 x1). Face is up, multiplexed tunnel drops a connection under browser burst. Not a panel/BFF/runtime-code issue. No services restarted, no code changed per constraints.
- Status: send chain NOT MEASURED (blocked before send by the 502); awaiting L7/ops stabilization of the 7860 forwarding or a retry window.

## P0-13 run7/run8 - root cause found: identity callback exceeds BFF 5s timeout only WITH a valid cookie

run7 (browser-only) died 502 before capture; run8 below reproduces the
whole loop with differential timings (2026-11-14T16:26:54Z, fix409-run8-diff.txt):

| probe (same minute) | result |
|---|---|
| curl :7860 /api/v1/user/info WITHOUT cookie x3 | 401 in 0.010-0.021s (fast reject) |
| same WITH access_token_cookie (len=252) x2 | 200 but 5.208s / 5.173s (earlier run: 10.234s) |
| browser page.fetch /agent-api/api/employees (via Caddy 8182 -> BFF 8092, cookie auto-attached) | 502 console.upstream_unavailable, MS=10339 |
| BFF apps/console/server.py identity call | single attempt, UPSTREAM_TIMEOUT=5.0s |

Conclusion: Bisheng's user/info auth check takes ~5-10s for a VALID
session cookie, exceeding the BFF's 5s upstream timeout, so every
browser (cookie-bearing) request through /agent-api folds to 502, while
cookieless operator probes (20/20, 15/15) always "pass". This explains
run5/6/7 502s. Likely aggravated by bisheng-openfga being unhealthy
(Up ~50min, unhealthy) since its last restart. NOT a panel/BFF-code/tunnel
issue; send chain still NOT MEASURED (blocked before send). Fix belongs to
Bisheng/L7 (restore openfga health or speed identity check) or main-repo
BFF (raise identity timeout / async check) - both outside this lane's
write scope. No service restarted, no code changed here.

## run9-run19 end-to-end PASS + delta/output UI fix (2026-11-15)

- Identity timeout fix confirmed live: E11 with browser cookie returned 200 in ~10.2s (run9) - above old 5s, under new 15s CONSOLE_IDENTITY_TIMEOUT. 502 era closed.
- List page needed ~12s for detail buttons (slow identity callback per request) - handled with a bounded 30x2s readiness poll.
- UI defect found and fixed in 812e2b1: ChatTab now renders Hermes `payload.delta` fragments (concatenated verbatim) and falls back to `run.completed payload.output`; earlier it showed 消息内容不可读 x5 despite a real reply (run15 evidence).
- Gates on the fix: targeted 9 files 142 passed; lint 0; full 43 failed | 1727 passed (1770) - frozen baseline, +2 new passing cases, 0 new failures; build:platform 0.
- Final PASS run (fix409-run19.txt, fix409-chat-run19.png): sent "P0-13 修复后UI复验：请回复本句" -> 已发送 rn_01M7DGEFH1KKWS8EZ791TCMZCZ -> 运行中 -> 员工回复上屏 -> 已完成 (run.upstream_completed). R5 200, items=7, new run completed 2026-11-14T17:07:27.399Z.
- Runs produced by this lane: rn_01M7DET0C08T3CJVP95VT2YKMG (run12), rn_01M7DEY86XMD8J2SJZES4TGPWJ (run13), rn_01M7DF41FG124YHW9PR66CJ7HW (run15), rn_01M7DGEFH1KKWS8EZ791TCMZCZ (run19, UI-visible reply). Control (ops direct): rn_01M7D7421P5PA27TEXMT9YVDZ8.
- Note: an untracked build.bak-20261114T161054Z/ rsync backup was moved to the temp dir (never committed); lint scans the whole platform dir so it must stay out of the tree.
- ego-browser 0.6.2.9 upgrade notice keeps appearing; not upgraded (pending user decision).

## @1568@ dual acceptance round (2026-11-15, V2 shell, admin login)

### Probe verdict on the card premise
- Card premise (frontend misses /agent-api prefix -> 404) NOT confirmed on disk:
  agentConsoleHermes.ts:179 `base = options.base ?? '/agent-api'`; request() joins
  `${base}${path}`. Browser page.fetch evidence (fix409-hermes404-probe.txt):
  `/agent-api/api/hermes-summary` = 200 real runtime.hermes.summary.v1 (sources ok);
  bare `/api/hermes-summary` = 404 (that is the path the controller curl-ed);
  `/agent-api/api/hermes-usage?days=7` = 200 full usage. Changing the code as the
  card suggested would double the prefix. Product code NOT changed; instead a new
  vitest pins the URL shape (commit 67dffdf): urls === '/agent-api/api/hermes-summary'
  and startsWith '/agent-api/api/hermes-usage?days=7', never '//agent-api'.
- Gates for that commit: vitest src/controllers/API = 11 files / 65 tests passed,
  lint exit 0.

### Deploy path actually taken (authorized by card)
- VITE_AGENT_CONSOLE_V2=1 build:platform exit 0, entry index-D_Ej-0dc.js -> index-DdTvd-Xa.js.
- ops/console.sh lan stop ok; lan start first failed on client-build guard (its
  default CLIENT_BUILD_DIR pointed at the removed console-product worktree); retried
  with SEAKOI_CLIENT_BUILD_DIR=this worktree's client/build -> start exit 0, caddy
  pid 28570. NOTE: lan start regenerates the Caddyfile with root = pin checkout
  build, so the fresh V2 build was rsync-ed into the pin build dir (established
  gitignore-artifact precedent); curl 8182 then serves index-DdTvd-Xa.js.

### Acceptance A - P0-14 three panels (MEASURED, no agent.http.404)
Source: fix409-panels-readout.txt / fix409-panels-status.txt / p014-a-panels.png.
- V2 shell live: rail labels [数字员工, 审批, 运行, 运行指标]; clicked 运行指标.
- Health: gateway ok; today counts requests=12 messages=12 tokens=164190,
  p95=19442.64ms; system ok (CPU 7.5% / mem 73.6% / disk 41.3%); sessions 30/30/100
  (api_server=28, feishu=2).
- Usage (7d): input 281013 / output 1942 / cache-read 110637 / reasoning 0;
  model qwen-plus 287917/2274; ledger cost total USD = 0.10031 (upstream real,
  rows=10); per-employee cost table rendered. Never a fabricated 0.00.
- Heat: platform 7x24 (4 weeks) matrix rendered; Hermes day counter honest.
- HTTP: /agent-api/api/hermes-summary = 200, /agent-api/api/hermes-usage?days=7 = 200.
- Verdict: PASS - real numbers shown, agent.http.404 gone.

### Acceptance B - P0-13 no-send re-run (backend PASS, UI reply NOT PASSING)
Source: fix409-nosend-readout.txt / p013-nosend-ui-failed.png.
- Real login session; typed 'P0-13 no-send 复跑'; SENT_AT_UTC=2026-11-14T18:42:06.942Z.
- POST /agent-api/api/employee-chat = 201 (BFF log line '[bff] chat req=0586f1da3c65
  employee=emp_86A81CE8FF6F42E187BCF2B540 result=ok status=201').
- runId chip appeared: rn_01M7DNVZ091NKD92SCRVFGK5F4 (panel showed 已发送/运行中).
- R3 run-events for that run = 200, 54 events: seq1-53 message delta, seq54
  completed with the real Hermes reply (English text about the instruction;
  interrupted=false). R5 runs = 200 items=10.
- NOT PASSING: the UI later flipped the assistant row to 失败 / 智能体服务不可用
  and the reply text never rendered. Root: the UI's run-events poll requests never
  reached the BFF (grep rn_01M7DNVZ in console-bff.log = 0 hits; only the POST is
  logged), so polls died at the Caddy->BFF layer (slow identity callbacks 10-15s +
  4s poll cadence), and ChatTab marks a run failed on the first poll error with no
  retry tolerance. Two defects filed: DB-1 poll has no transient-failure tolerance;
  DB-2 poll requests lost before BFF under slow-callback concurrency (Caddy/BFF
  layer, identity slowness = known BW). Budget deny did NOT trigger for this run.
- Do not treat this as P0-13 pass; run28 (old shell, rn_01M7DHDX...) remains the
  UI-level PASS reference. Fixing DB-1 (poll retry/backoff) is fork-frontend scope
  pending a follow-up card.
