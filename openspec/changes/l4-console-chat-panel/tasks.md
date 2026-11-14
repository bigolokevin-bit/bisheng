# Tasks: l4-console-chat-panel

## 1. Ground and change
- [ ] 1.1 worktree lane/L4-console-chat-panel@af4247a created, install --frozen-lockfile exit 0, no same-capability branch found (done at open; recheck)
- [ ] 1.2 this change (four files + evidence skeleton) committed with explicit paths, pushed `push -u`, ls-remote == HEAD recorded in evidence

## 2. Adapter
- [ ] 2.1 `agent.ts`: ChatRequest/ChatRunResult/RunEvent types + optional `sendChat`/`listRunEvents` on AgentConsoleApi; HTTP adapter POST with `X-Console-Write: 1` + JSON headers, GET run-events with runId/sinceSeq/limit; stub adapter deterministic scripted echo; error envelope parser accepts {code,message}/{error}/detail shapes
- [ ] 2.2 no new npm deps; existing exports unchanged; `git diff` touches only agent.ts among shared files

## 3. Panel
- [ ] 3.1 `ChatTab.tsx`: list/composer/runId chip/failure states/retry-same-key; polling R3 sinceSeq until terminal, cleanup on unmount; i18n-only copy
- [ ] 3.2 wire as fifth tab in `AgentPage/index.tsx` (overview/chat/tasks/runs/audit); iframe fallback entry gated on workstation bindingType=app + externalRef
- [ ] 3.3 locales en-US/ja/zh-Hans bs.json: append `agentConsole.chat.*` keys (existing keys untouched)

## 4. Tests
- [ ] 4.1 new Vitest file (stub api): optimistic row + runId rendering; reply text from message events; completed-without-message empty-reply notice; 401/403/5xx honest copy; retry reuses chatRequestKey; iframe entry shown/hidden by workstation fixture
- [ ] 4.2 existing tests unchanged (diff shows zero edits to prior test files)

## 5. Gates (each logged, exit taken directly)
- [ ] 5.1 platform lint exit 0
- [ ] 5.2 targeted vitest on AgentPage/chat files exit 0
- [ ] 5.3 full platform test: failures 43 / files 18 / new-failures 0 vs frozen baseline (passes may only grow from 1711)
- [ ] 5.4 `pnpm -C src/frontend build:platform` exit 0
- [ ] 5.5 `git diff --check` clean; staged secret grep zero hits
- [ ] 5.6 openspec validate --strict exit 0 for this change

## 6. Acceptance (real login)
- [ ] 6.1 probe live BFF 8092 for POST /api/employee-chat behavior (401-with-code = route present); if route absent (old process) -> BLOCKED report with exact restart command and missing credentials, do NOT restart production, do NOT fake
- [ ] 6.2 with a real signed-in session: send one message, record runId, assistant reply via R3 events, screenshots; plus P0-14 three metric panels eyeballed in the same session (degraded/not-priced/unattributed wording)
- [ ] 6.3 push feat commit, ls-remote == HEAD, report

## Boundaries (not tasks)
- No edits to seakoi-agent-os apps/console, services/**, contracts, specs, generated files, ops.
- No changes to existing locale keys, existing tests, route/menu registration.
- Bisheng Assistant/iframe is never the employee conversation backend.
