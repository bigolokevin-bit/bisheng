# S11 (P0-9) V1–V8 evidence readout — console side only

Card: 总控 @1707@ (2026-11-15). Scope: only what is verifiable from the
console / services over the BFF read API with a real logged-in session on
http://127.0.0.1:8182 (Caddy → BFF 8092 → domain 8101 / runtime 8103).
No Feishu messages were sent, no policy/budget/ledger writes, no main-repo
changes, no service restarts.

Freshness: 8182 served entry == worktree build entry == `index-ZWyz97xC.js`
(MATCH, verified 2026-11-14T19:22:44Z; branch HEAD at capture time =
`d96c0f5`, DB-1 fix `f6ee26c` included).

## Verdict table

| # | Item | Verdict | One-line basis |
|---|------|---------|----------------|
| V1 | Feishu group @-mention intake | BLOCKED | Outbound Feishu group message requires explicit user approval; forbidden by this card. Never attempted. |
| V2 | Department-scoped differences (ReBAC) | BLOCKED | Needs real ReBAC policy enforcement; dev OpenFGA is up-unhealthy and not wired as a policy source. Not bypassed. |
| V3 | Knowledge-source citations | BLOCKED | No Bisheng KB retrieval engine wired; runs carry no retrieval sources. Reported empty, truthfully. |
| V4 | Chat-created task visible in Tasks tab | NOT MEASURED (data-empty) | T5 read API works (200, `assignee=human:1` → items=0); no real task row exists to prove chat→TASK→tab end-to-end. `status=pending` → 400 `request.invalid_query "unknown status filter 'pending'"` (enum contract, recorded as-is). |
| V5 | kill -9 interrupted-run resume | NOT MEASURED | Mechanism exists in runtime; no real kill -9 reproduction performed this round. |
| V6 | Sensitive-action approval (AP1–AP7) | SERVICE-LAYER PASS / LIVE BLOCKED (BW-13) | AP4 query 200 (assignee=human:1&status=pending → items=0, approvals section shows honest empty state). Historical consume-path evidence: main-repo S10b-6 archived rounds (b6d4a7e chain) and console-readout audit records. Worker-driven live approval consumption still BLOCKED by BW-13 — stated, not simulated. |
| V7 | Admin console single-screen | PASS | Real session detail view renders full surface; Network all 200 (below); approvals section reachable with honest empty state. Gaps labelled where UI shows “待接入”. |
| V8 | Trace by run_id | PASS | One real run traced: run row + events + audit + cost, all 200 (below). Retrieval/knowledge sources empty per V3. |

## V7 detail (s11v7-a round, `s11v7-a-readout.txt`)

Entry path: login session persisted in profile → `http://127.0.0.1:8182/agent`
→ row-end `BUTTON[详情]` (y=385) for `emp_86A81CE8FF6F42E187BCF2B540`.

Detail surface text (verbatim excerpt, `s11-v7-detail.png` 141924 B):
`返回 / AgentOS 产品助理 / 查看运行 / 身份 … 在岗 / 当前版本 v2 / 版本数据待接入 /
爆炸半径（生效授权） undefined(types=["chat"]) · send / 预算用量数据待接入 /
趋势与成本 近 7 天运行趋势 P95 时长: 样本不足 / 7×24 活动热力（近 4 周） /
本月成本 0.12 / 聊天（agent-v2-chatpanel） / 应用对话 feishu 2139… /
在 Bisheng 中打开`

Network codes captured through the live session (page.fetch with cookies):

| Route (BFF) | Meaning | Status |
|---|---|---|
| /api/employee?id=emp_86A8… | E2 profile | 200 |
| /api/effective-config?id=emp_86A8… | E5 grants/version | 200 |
| /api/workstations?id=emp_86A8… | E10 workstations | 200 |
| /api/runs?employeeId=…&limit=10 | R5 recent runs | 200 |
| /api/approvals?assignee=human:1&status=pending | AP4 todo approvals | 200 (items=0) |
| /api/tasks?assignee=human:1 | T5 tasks | 200 (items=0) |
| /api/audit?runId=rn_01M7DQ28… | A3 audit | 200 |
| /api/run-events?runId=rn_01M7DQ28… | R3 events | 200 |
| /api/employees?limit=10 | E11 list | 200 |

Honest gaps labelled in UI (recorded, not passed off): 版本数据待接入,
预算用量数据待接入, P95 样本不足, 爆炸半径 shows raw `undefined(types=["chat"]) · send`.

Approvals section: rail ◆ (y=140) → `审批 / 暂无待办审批` (`s11-v7-approvals.png` 74433 B).

## V8 chain (s11v7-b/c rounds, `s11v7-b-readout.txt`, `s11v7-c-readout.txt`)

Subject run: `rn_01M7DQ282W7C197TCRXHGVNG5B` (produced by the DB-1
verification send, this round's real run — not a historical stand-in).

- Run row (R5 limit=50, 200, items=13):
  `status=completed v=2 snap=snap_2ac59a3c05e76a767cbceab8b1cdd7e6 budgetCap=10 costUsd=0.009913 created=2026-11-14T19:03:06.593Z`
- Events (R3, 200): COUNT=6, types={message:5, completed:1}; completed payload
  `output="P0-13 DB-1 复跑：请回复本句" reasonCode=run.upstream_completed interrupted=false run_id=run_41d232d5d6a645c89eec7d7a90307897`.
- Audit (A3, 200): COUNT=2; first event
  `ev_D58FFA020C41485FB69C363FDD sourceSystem=policy action=budget.ledger_entry_applied resource=employee:emp_86A8… outcome=success responsibleHumanId=1 tenantId=t_seakoi_pilot occurredAt=2026-11-14T19:03:09.144Z`.
- Retrieval/knowledge sources: none carried (V3 not implemented) — recorded as
  an empty field, not as “no citations needed”.

## Commands

All probes ran through the live browser session (no token handling in shell):
`ego-browser nodejs` heredoc carrier, `taskSpace('l4cp-e2e10')`,
`page.fetch('/agent-api/...')`; raw stdout archived in
`s11v7-a-readout.txt` / `s11v7-b-readout.txt` / `s11v7-c-readout.txt`.

## False-data check

No fabricated reads found. Empty states (T5/AP4 items=0) and contract 400
(status=pending) are recorded exactly as returned.
