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
