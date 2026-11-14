# Design: l4-console-chat-panel

## 1. Data path (fixed by ADR-0013 / Route A, BFF already merged)

```
ChatTab --POST /agent-api/api/employee-chat--> BFF (identity gate: Bisheng session
cookie/token -> tenant+actor; CSRF trio; body strict {employeeId,text,chatRequestKey})
   --E5 effective-config--> --P5 policy snapshot (Idempotency-Key snapshot:<key>)-->
   --R1 POST {RUNTIME}/v1/runs (Idempotency-Key <key>)--> 201 {runId,status}
ChatTab --GET /agent-api/api/run-events?runId&sinceSeq&limit (R3)--> poll until terminal
```

- Browser never sees `X-Internal-Token`; never calls Hermes/AGENTRUN directly.
- `chatRequestKey`: `crypto.randomUUID()` per user message; stored on the optimistic row
  and reused verbatim when the user retries that failed message (same key + same body =>
  same run by upstream idempotency; no half-conversation).
- HTTP status/code mapping (BFF envelope `{code,message}`, runtime envelope
  `{error:{code,message,details}}`, FastAPI `{detail}` — the parser accepts all three):
  - 401 console.unauthenticated -> "session expired, sign in again" (no resend loop spam)
  - 403 console.forbidden / console.csrf_origin -> "not permitted from this context"
  - 400 console.missing_param / request.invalid_body / console.csrf_write_header ->
    "request rejected"
  - 409 run.employee_not_active / request.idempotency_conflict -> surfaced with code text
  - 5xx / console.upstream_unavailable / run.upstream_unavailable ->
    "agent service unavailable" (row marked failed, retry allowed with same key)

## 2. Reply rendering (R3)

Events are `RunEvent {seq, eventType, payload, occurredAt}` (contract vocabulary:
started / message / completed / failed / cancelled / interrupted; reasonCode on failure).
- Accumulate text from `message`-type events: `payload.text ?? payload.content` — if a
  message event carries no parseable text, render its redacted type name and log a
  console warning (deviation D-2: exact Hermes payload field to be confirmed only in a
  real-login round; stub tests pin the contract shape we assert).
- Terminal event ends polling and sets row status; `completed` without any message event
  renders an empty-reply notice (never fabricates text).
- Polling: sequential, `sinceSeq` cursor, 1.5 s interval, max ~120 polls then soft-stop
  with "still running, refresh later" note. Cleanup on unmount/tab switch.
- R2 is not proxied (deviation D-1): status derives from events; optional cross-check
  uses R5 list filtered by employeeId and matched runId.

## 3. UI

- Fifth tab in `AgentPage` detail: `overview / chat / tasks / runs / audit`
  (chat right after overview so the primary conversation surface is one click away).
- Layout: message list (scrollable, max-h within panel), each row = role label + text +
  meta line (`runId` chip + status chip on assistant rows; retry button on failed rows);
  sticky composer at bottom: TextArea + Send (disabled while a send for that draft is in
  flight; Enter=send, Shift+Enter=newline). Loading uses LoadingIcon; empty state via
  StateView, reusing existing classes/tokens only (no new visual system).
- i18n: all copy via `t('agentConsole.chat.*')`, three locales appended in the same
  commit; no hardcoded CJK in source (fork P0 rule).
- Iframe fallback: below the composer, a secondary text button "Open in Bisheng" shown
  only when `getWorkstations` returns an item with `bindingType === 'app'` and a non-empty
  `externalRef`; href `/workspace/chat/assistant/auth/${externalRef}` target=_blank rel=
  noreferrer. It is an entry, never embedded as the conversation backend.

## 4. Adapter (agent.ts)

- `ChatRequest {employeeId, text, chatRequestKey}`; `ChatRunResult {runId, status}`;
  `RunEventItem {seq, eventType, payload, occurredAt}`; `RunEventList {events?/items?}`
  normalized to `{items}` client-side (accept both envelope keys; stub uses items).
- `AgentConsoleApi` gains optional `sendChat?(input): Promise<ApiResult<ChatRunResult>>`
  and `listRunEvents?(runId, sinceSeq, limit): Promise<ApiResult<...>>` so existing
  stubs/tests keep compiling; ChatTab degrades to "chat not wired" state when absent.
- HTTP adapter: same fetch headers as existing reads (Bearer `ws_token`, Accept) plus,
  for the POST only: `Content-Type: application/json`, `X-Console-Write: 1`. Same-origin
  relative URL `/agent-api/...` (Caddy strips prefix to the BFF).
- Stub adapter: deterministic scripted echo (echo of last user text with prefix "stub:"),
  used only by tests/preview, clearly not production data.

## 5. Honesty rules

- Nothing is marked passed unless measured. Real-login acceptance (runId + Hermes reply +
  R3 evidence) is a gate item; if 8092 lacks the route (old process) or credentials are
  missing -> BLOCKED with exact commands/needs, NOT silently substituted by stubs.
- No NOT MEASURED -> "already works" rewriting.

## 6. Deviations

- D-1: BFF has no R2 single-run proxy; status via R3 (+optional R5 match). Semantics
  sufficient for acceptance; if 参謀 wants strict R2, a BFF read route addition is a
  separate main-repo change.
- D-2: message-event payload text field names pinned to `text|content` fallback until a
  real Hermes run confirms; UI shows a redacted fallback, never fabricates.
- D-3: base point = local fork main af4247a which is AHEAD of origin/main (b82fd9a)
  linearly; card required containing af4247a, satisfied.
- D-4: chat tab order (overview/chat/tasks/runs/audit) is a design choice; card did not
  mandate one.
