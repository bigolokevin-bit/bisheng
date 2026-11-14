# P0-13 Route A: employee chat panel in the product console (lane L4, fork BiSheng)

## Why

ADR-0013 Route A fixes the main conversation path: the employee detail page owns a
first-party chat panel; the Bisheng iframe is only a fallback entry. The BFF side is
already merged into seakoi-agent-os main (575bf74, change l4-console-chat-route-a):
`POST /api/employee-chat` performs E5 -> P5 -> R1 server-side, returns `runId` and the
first status, and never leaks the internal token to the browser. Read proxies for R3
(`GET /api/run-events?runId&sinceSeq&limit`) and R5 (`GET /api/runs`) also exist.
The product console (this fork) still has no chat surface, so P0-13 cannot be accepted.

## What Changes

- New `ChatTab` in `AgentPage` detail view (fifth tab: overview / chat / tasks / runs /
  audit): message list, input + send, per-message `runId` badge, honest failure states.
  - Send calls `POST /agent-api/api/employee-chat` with `{employeeId, text, chatRequestKey}`
    plus `X-Console-Write: 1` and `Content-Type: application/json` (same-origin browser
    request; the BFF identity gate resolves tenant/actor from the Bisheng session).
  - `chatRequestKey` is a client-generated UUID per user message, stable across retries
    of that message (idempotency: retry cannot create a second run).
  - Assistant replies are read by polling R3 `GET /agent-api/api/run-events?runId=...`
    incrementally (sinceSeq cursor, interval ~1.5 s) until a terminal event
    (completed / failed / cancelled / interrupted, with reasonCode for failures).
  - R2 single-run detail is not proxied by the BFF; run status is derived from R3
    events, optionally cross-checked with R5 `GET /api/runs?employeeId=` (deviation D-1).
- New adapter methods in `src/controllers/API/agent.ts` (both HTTP and stub variants):
  `sendChat(input)` and `listRunEvents(runId, sinceSeq, limit)`. No new npm deps; no
  direct Hermes/AGENTRUN calls; no internal token handling in the browser.
- Iframe fallback only: when the employee has a workstation binding of type app
  (`bindingType=app`, `externalRef` present), show a secondary entry
  "Open in Bisheng" linking `/workspace/chat/assistant/auth/{appId}`. It is not the
  primary conversation backend (ADR-0013 M2). Hidden otherwise.
- New locale keys `agentConsole.chat.*` in en-US / ja / zh-Hans bs.json (append-only;
  existing keys untouched).
- New Vitest file for the chat panel (existing tests unchanged): send flow with stub
  api asserting optimistic user row, runId rendering, reply from terminal events,
  failure-state copy for 401/403/5xx, stable chatRequestKey on retry, no token strings.

## Not changing

- seakoi-agent-os `apps/console/**`, `services/**`, contracts, specs, generated files,
  ops (BFF is consumed as-is).
- Existing Bisheng auth/permission model, packages/ui, route/menu registration
  (`/agent` entry already merged), other tabs' behavior, existing tests and configs.
- No new UI dependencies; reuse @bisheng/ui / shadcn primitives and existing tokens.
