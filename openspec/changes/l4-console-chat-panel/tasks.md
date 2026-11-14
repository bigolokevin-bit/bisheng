# Tasks: l4-console-chat-panel

## 1. Ground and change
- [x] 1.1 worktree lane/L4-console-chat-panel@af4247a created, install --frozen-lockfile exit 0, no same-capability branch found (done at open; recheck)
- [x] 1.2 this change (four files + evidence skeleton) committed with explicit paths, pushed `push -u`, ls-remote == HEAD recorded in evidence

## 2. Adapter
- [x] 2.1 `agent.ts`: ChatRequest/ChatRunResult/RunEvent types + optional `sendChat`/`listRunEvents` on AgentConsoleApi; HTTP adapter POST with `X-Console-Write: 1` + JSON headers, GET run-events with runId/sinceSeq/limit; stub adapter deterministic scripted echo; error envelope parser accepts {code,message}/{error}/detail shapes
- [x] 2.2 no new npm deps; existing exports unchanged; `git diff` touches only agent.ts among shared files

## 3. Panel
- [x] 3.1 `ChatTab.tsx`: list/composer/runId chip/failure states/retry-same-key; polling R3 sinceSeq until terminal, cleanup on unmount; i18n-only copy
- [x] 3.2 wire as fifth tab in `AgentPage/index.tsx` (overview/chat/tasks/runs/audit); iframe fallback entry gated on workstation bindingType=app + externalRef; additionally mounted as the primary chat card (agent-v2-chatpanel) in the V2 detail shell (commit daa716e), app iframe kept as open-in-Bisheng fallback only
- [x] 3.3 locales en-US/ja/zh-Hans bs.json: append `agentConsole.chat.*` keys (existing keys untouched)

## 4. Tests
- [x] 4.1 new Vitest file (stub api): optimistic row + runId rendering; reply text from message events; completed-without-message empty-reply notice; 401/403/5xx honest copy; retry reuses chatRequestKey; iframe entry shown/hidden by workstation fixture
- [x] 4.2 existing tests unchanged (diff shows zero edits to prior test files)

## 5. Gates (all reruns captured on disk with direct exits)
- [x] 5.1 platform lint exit 0
- [x] 5.2 targeted vitest on AgentPage/chat files exit 0 (9 files / 140 passed on daa716e)
- [x] 5.3 full platform test: failures 43 / files 18 / new-failures 0 vs frozen baseline (passed 1725 / 1768 on daa716e, only grew)
- [x] 5.4 `pnpm -C src/frontend build:platform` exit 0 (and VITE_AGENT_CONSOLE_V2=1 build exit 0)
- [x] 5.5 `git diff --check` clean; staged secret grep zero hits
- [x] 5.6 openspec validate --strict exit 0 for this change

## 6. Acceptance
- [x] 6.1 probe live BFF 8092 for POST /api/employee-chat behavior — CORRECTED CRITERION: an unauthenticated 401 does NOT prove the route (auth precedes route lookup). Authenticated POST returns 405 console.read_only: the live 8092 build lacks CONSOLE_CHAT_WRITE_ENABLED, so the route is not registered. Reported as BLOCKED item for L7 (one env + BFF restart); production services are not restarted from this lane.
- [x] 6.2 PARTIAL: real login OK (opsadmin via ego-browser, no password guessing); V2 shell live; real E11 row shown (Koi Claw emp_1_1794469037 v8); agent-v2-chatpanel mounted; the actual send is BLOCKED by 6.1 (no runId yet). P0-14 metrics eyeball = NOT MEASURED (probe reached the rail and honest copy in the snapshot, but the screenshot did not persist on disk in that run).
- [x] 6.3 feat commits pushed: e465c44 (chat panel) + daa716e (V2 mount), ls-remote == HEAD, reported. Remaining after L7 enables the flag: resend verification only, zero code changes.
