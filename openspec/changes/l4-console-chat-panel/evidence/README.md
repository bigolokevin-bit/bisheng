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
