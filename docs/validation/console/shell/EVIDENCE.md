# W1 Shell Closeout Evidence (lane/L4-w1-w2-ui, commit 134d174)

- Method: local Vite dev preview on http://127.0.0.1:5399 built from this worktree with `VITE_AGENT_CONSOLE_V2=1` (config `src/frontend/platform/vite.w1dev.config.mts`, proxy `/agent-api -> 127.0.0.1:8092`). 8182 untouched; final served-entry reconciliation belongs to L0/L7.
- Capture: ego-browser via CDP `Emulation.setDeviceMetricsOverride` at 1440x900 and 375x812. Raw per-route DOM readout: `dom-readout.json`.

## 8/8 L1 routes reachable (all: shell=true, nav=8, v1 `.agent-page` count=0, legacy shell testid absent)

| route | active rail label | groups | sw==cw |
|---|---|---|---|
| /agent | 总览 | 概览/数字员工/运行/治理 | 1440=1440, 375=375 |
| /agent/employees | 数字员工 | same 4 groups | 1440=1440, 375=375 |
| /agent/approvals | 审批 | same | 1440=1440 |
| /agent/tasks | 任务 | same | 1440=1440 |
| /agent/runs | 运行 | same | 1440=1440 |
| /agent/metrics | 运行指标 | same | 1440=1440 |
| /agent/audit | 审计 | same | 1440=1440 |
| /agent/settings | 设置 | same | 1440=1440 |

- Unknown route `/agent/zzz-not-real` -> `agent-v2-404` testid present, shell intact.
- Theme persistence: dark -> click toggle -> data-theme=light + localStorage `agentConsole.v2.theme`="light" -> reload -> still light. No layout shift (tokens only).
- Topbar intact on every route: env chip `本地试点` (agent-v2-env-chip) + account (agent-v2-account) present.
- Error boundary: no regression; covered by unit tests (agentConsoleV2Shell.test.tsx: throw -> agent-v2-page-error + retry recovers). Targeted gate: 8 files / 102 tests passed; full platform suite 43 failed | 1737 passed (1780) = frozen baseline 43/18, new failures 0; lint exit 0; build + V2 build exit 0 (see 134d174 gate record).

## Screenshots

- `w1-shell-1440-dark.png` — /agent/employees, 1440x900, dark
- `w1-shell-1440-light.png` — same view, light (post-toggle, persistence proof)
- `w1-shell-375-dark.png` — /agent/employees, 375x812, dark, rail collapsed to bottom bar, scrollWidth==clientWidth

## Gaps (unchanged, for L0)

- W2 employees list page not started (per card: paused).
- Served entry on 8182 still old build; L0/L7 deploy reconciliation pending (this lane does not touch Caddy/8182).
