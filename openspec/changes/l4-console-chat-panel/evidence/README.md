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
