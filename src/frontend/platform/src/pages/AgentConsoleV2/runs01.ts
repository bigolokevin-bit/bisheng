/**
 * RUN-01 pure helpers (the page body lives in ./RunsSection.tsx).
 *
 * Everything here is data-shaping only — no hooks, no DOM writes — so the
 * honesty rules are unit-testable without rendering:
 * - URL query: `employeeId / status / since(window) / limit / cursor`; the
 *   window control is the SAME parameter the request carries (QA R2 ⑤: a
 *   deep link must move the request, not just the highlight).
 * - Readable identities: an employee cell is a name, 「员工 · <8 位短码>」 or
 *   「未指派」 — never `emp_…`, `empv_…`, `employee:…` or `human:…` (the raw
 *   value stays in the cell's title for support).
 * - Source column: bound to the fields the wire actually carries
 *   (`source` / `triggerType` / `trigger` / `sourceSystem`, read off the
 *   unmodified upstream body), known values mapped to the shared Chinese
 *   words, unlisted values kept verbatim, identity-shaped values run through
 *   the identity module, and 「—」 only when nothing is there. No `?? 0`
 *   anywhere: a missing value is never a zero.
 * - Costs/durations/times: raw upstream figures only (0.009875 never becomes
 *   0.00; no endedAt ⇒ no invented duration).
 */
import type { Run, RunStatus } from '@/controllers/API/agentConsoleRuns';

import { sourceWord, wireText } from './aud01';
import {
  bareId,
  humanRefLabel,
  idPrefix,
  isPlaceholderIdentity,
} from './identity';
import type { LkColumn } from './listkit';

/** Structural translate fn (same caliber as ./identity + ./aud01): lets the pure
 *  helpers be tested with a dictionary lookup instead of a live i18next. */
export type TFn = (key: string, options?: Record<string, unknown>) => string;

/** RunStatus contract enum, in filter order (agentrun_models.py). */
export const RUN_STATUSES: RunStatus[] = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
];

/** Frozen run-status labels, already present in all three locales. */
export const RUN_STATUS_LABEL_KEYS: Record<RunStatus, string> = {
  pending: 'agentConsole.runs.status.pending',
  running: 'agentConsole.runs.status.running',
  completed: 'agentConsole.runs.status.completed',
  failed: 'agentConsole.runs.status.failed',
  cancelled: 'agentConsole.runs.status.cancelled',
  interrupted: 'agentConsole.runs.status.interrupted',
};

/** Copy namespace of this page (all keys live in bs.json). */
export const RUNS_NS = 'agentConsole.v2.runs01';

/** Chip tone classes (target §1.3): dot keeps the semantic color when选中. */
export const STATUS_CHIP_TONE: Record<RunStatus, string> = {
  pending: 's-pend',
  running: 's-run',
  completed: 's-done',
  failed: 's-fail',
  cancelled: 's-cancel',
  interrupted: 's-int',
};

/** Pill tone (spec §2.1, same mapping as the frozen RunsSection). */
export function statusPillClass(status: string): string {
  if (status === 'completed') return 'ok';
  if (status === 'pending' || status === 'running') return 'wr';
  if (status === 'failed' || status === 'cancelled' || status === 'interrupted') return 'dg';
  return '';
}

export const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

/** since windows: the URL carries the relative key; requests carry the ISO
 *  start computed at send time (spec §1.3: 24h/7d/30d 换算 ISO 起点). */
export const SINCE_WINDOWS = [
  { value: '24h', hours: 24, labelKey: `${RUNS_NS}.since24h`, windowKey: `${RUNS_NS}.window24h` },
  { value: '7d', hours: 24 * 7, labelKey: `${RUNS_NS}.since7d`, windowKey: `${RUNS_NS}.window7d` },
  { value: '30d', hours: 24 * 30, labelKey: `${RUNS_NS}.since30d`, windowKey: `${RUNS_NS}.window30d` },
] as const;
export type SinceValue = (typeof SINCE_WINDOWS)[number]['value'];

export const LIMITS = [20, 50, 100];
export const DEFAULT_LIMIT = 20;
export const DEFAULT_SINCE: SinceValue = '7d';
/** E11 candidate page size (spec §1.3: employee directory, first 100). */
export const EMPLOYEES_LIMIT = 100;

export function sinceIso(window: SinceValue, nowMs: number = Date.now()): string {
  const hours = SINCE_WINDOWS.find((w) => w.value === window)?.hours ?? 24 * 7;
  return new Date(nowMs - hours * 3600_000).toISOString();
}

/** The window's readable range («近 30 天»), used wherever a number would
 *  otherwise float without its basis. */
export function windowLabel(since: SinceValue, t: TFn): string {
  return t(SINCE_WINDOWS.find((w) => w.value === since)?.windowKey ?? SINCE_WINDOWS[1].windowKey);
}

// ---------- URL query (spec §2.4 + QA R2 ⑤: `window` is the same control) ----------

export interface RunsQuery {
  employeeId: string;
  status: string;
  since: SinceValue;
  limit: number;
  cursor: string | null;
}

/**
 * Parse the list query. `window` is accepted as an alias of `since` (the deep
 * link QA probed); it drives the SAME request parameter, so a shared URL
 * cannot silently show 「近 30 天」 while asking for 7 days.
 */
export function readRunsQuery(
  search: string,
  initialEmployeeId?: string | null,
): RunsQuery {
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(search ?? '');
  } catch {
    p = new URLSearchParams();
  }
  const since = p.get('since') || p.get('window');
  const limit = Number(p.get('limit'));
  const status = p.get('status') ?? '';
  return {
    employeeId: initialEmployeeId || p.get('employeeId') || '',
    status: (RUN_STATUSES as string[]).includes(status) ? status : '',
    since: SINCE_WINDOWS.some((w) => w.value === since) ? (since as SinceValue) : DEFAULT_SINCE,
    limit: LIMITS.includes(limit) ? limit : DEFAULT_LIMIT,
    cursor: p.get('cursor') || null,
  };
}

/** Serialize back onto the current query: our five keys win, the `window`
 *  alias is folded into `since`, foreign markers (?src=ov …) stay untouched. */
export function runsQueryToSearch(q: RunsQuery, baseSearch: string): string {
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(baseSearch ?? '');
  } catch {
    p = new URLSearchParams();
  }
  if (q.employeeId) p.set('employeeId', q.employeeId);
  else p.delete('employeeId');
  if (q.status) p.set('status', q.status);
  else p.delete('status');
  p.set('since', q.since);
  p.delete('window');
  p.set('limit', String(q.limit));
  if (q.cursor) p.set('cursor', q.cursor);
  else p.delete('cursor');
  return p.toString();
}

// ---------- formatting (field names are law; no fabricated values) ----------

/** runId: prefix + ULID first4 … last4 (spec §5.1); full value in title/copy. */
export function shortRunId(id: string): string {
  if (id.startsWith('rn_') && id.length > 11) return `${id.slice(0, 7)}…${id.slice(-4)}`;
  if (id.length <= 9) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

/** channelEventId: first6 … last4 (target §1.4 column 6). */
export function shortEventId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

const SHANGHAI_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Asia/Shanghai MM-DD HH:mm (current-year convention, same as TSK/OV). */
export function formatMoment(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const parts: Record<string, string> = {};
  for (const p of SHANGHAI_PARTS.formatToParts(new Date(ms))) parts[p.type] = p.value;
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** endedAt − startedAt, human-compact. No end ⇒ —, never a fake duration. */
export function formatDuration(startedAt?: string | null, endedAt?: string | null): string {
  if (!startedAt || !endedAt) return '—';
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

/** Raw upstream figure, never re-rounded (0.009875 must not render as 0.00). */
export function formatCost(costUsd?: number | null): string {
  return typeof costUsd === 'number' && Number.isFinite(costUsd) ? String(costUsd) : '—';
}

export function runStatusLabel(t: TFn, status: string): string {
  const key = RUN_STATUS_LABEL_KEYS[status as RunStatus];
  if (key === undefined) {
    console.error('[AgentConsoleV2] unknown run status:', status);
    return status;
  }
  return t(key);
}

// ---------- readable identities (QA R2 ②: no bare ids anywhere) ----------

/** Short-code length on screen (令面口径: 「员工 · <8 位短码>」). */
export const EMPLOYEE_CODE_LEN = 8;

/**
 * Distinguisher for an unnamed employee: the seed prefix (`emp_` / `empv_`)
 * and any `employee:` / `human:` type prefix are stripped, then the last 8
 * characters stay. The result never contains the raw prefix, so it cannot
 * re-leak the shape the gate forbids.
 */
export function shortEmployeeCode(raw: string | null | undefined): string {
  const bare = bareId((raw ?? '').trim()).replace(/^empv?_/i, '').trim();
  const chars = Array.from(bare);
  if (!chars.length) return '';
  return chars.slice(-EMPLOYEE_CODE_LEN).join('');
}

/**
 * Employee/owner cell: directory name → 「员工 · <8 位短码>」 → 「未指派」.
 * A `human:` ref resolves through the human-actor helper (「用户 #…」) instead
 * of an employee word. The raw value never reaches the text node.
 */
export function runEmployeeLabel(
  raw: string | null | undefined,
  names: Map<string, string> | undefined,
  t: TFn,
): string {
  const v = (raw ?? '').trim();
  if (!v || isPlaceholderIdentity(bareId(v))) return t(`${RUNS_NS}.employeeNone`);
  const name = names?.get(v)?.trim() || names?.get(bareId(v))?.trim();
  if (name) return name;
  if (idPrefix(v) === 'human') return humanRefLabel(v, t);
  const code = shortEmployeeCode(v);
  return code ? t('agentConsole.v2.id.employeeRef', { tail: code }) : t('agentConsole.v2.id.employee');
}

/** Cell title: the full raw ref, or the honest reason there is none. */
export function runEmployeeTitle(raw: string | null | undefined, t: TFn): string {
  const v = (raw ?? '').trim();
  return v ? v : t(`${RUNS_NS}.employeeNoneTitle`);
}

/** Filter chip: 「员工：小鲤」 when the directory knows the name; an unresolved
 *  ref keeps its own readable form (never the doubled 「员工：员工 · …」). */
export function runEmployeeChipLabel(
  raw: string,
  names: Map<string, string> | undefined,
  t: TFn,
): string {
  if (!raw) return t(`${RUNS_NS}.filterEmployee`);
  const label = runEmployeeLabel(raw, names, t);
  return names?.get(raw)?.trim() ? t(`${RUNS_NS}.filterEmployeeValue`, { name: label }) : label;
}

// ---------- source column (QA R2 D5: 14/14 rows were 「—」) ----------

/**
 * Optional wire extras the typed R5 row does not declare. The console BFF
 * forwards upstream bodies unmodified, so a source marker can arrive under
 * any of these names; all four are read as strings through `wireText` and the
 * first non-empty one wins.
 */
const SOURCE_FIELDS = ['source', 'triggerType', 'trigger', 'sourceSystem'] as const;
type RunWireExtras = Partial<Record<(typeof SOURCE_FIELDS)[number], unknown>>;
export type RunWithSource = Run & RunWireExtras;

/** Run-specific trigger words (the audit set is not enough for triggers). */
const RUN_SOURCE_LABEL_KEYS: Record<string, string> = {
  schedule: `${RUNS_NS}.srcSchedule`,
  scheduled: `${RUNS_NS}.srcSchedule`,
  cron: `${RUNS_NS}.srcSchedule`,
  timer: `${RUNS_NS}.srcSchedule`,
  manual: `${RUNS_NS}.srcManual`,
  api: `${RUNS_NS}.srcApi`,
  openapi: `${RUNS_NS}.srcApi`,
  task: `${RUNS_NS}.srcTask`,
  message: `${RUNS_NS}.srcMessage`,
  im: `${RUNS_NS}.srcMessage`,
  chat: `${RUNS_NS}.srcMessage`,
  webhook: `${RUNS_NS}.srcWebhook`,
  callback: `${RUNS_NS}.srcWebhook`,
};

/** The first source-ish field the record actually carries ('' when none). */
export function rawSourceField(run: Run): string {
  const wire = run as RunWithSource;
  for (const field of SOURCE_FIELDS) {
    const value = wireText(wire[field]).trim();
    if (value) return value;
  }
  return '';
}

export interface RunSourceView {
  /** Visible text — never a raw field name, never a bare identity. */
  display: string;
  /** Full raw value / the honest reason for the dash. */
  title: string;
  /** mono = an id reference, word = a labeled source system. */
  tone: 'word' | 'mono';
  /** listkit icon for the cell. */
  icon: 'msg' | 'link';
}

/**
 * Source cell resolution order: the record's own source marker (mapped to the
 * shared words, unlisted values verbatim) → the channel message reference →
 * 「—」. A marker that is really an identity ref (`emp_…`, `employee:…`,
 * `human:…`) reads as that identity instead of being printed raw.
 */
export function resolveRunSource(run: Run, t: TFn): RunSourceView {
  const raw = rawSourceField(run);
  if (raw) {
    const word = labelRunSource(raw, t);
    const title = t(`${RUNS_NS}.sourceRaw`, { raw });
    return { display: word, title, tone: 'word', icon: 'link' };
  }
  const eventId = wireText(run.channelEventId).trim();
  if (eventId) {
    return {
      display: shortEventId(eventId),
      title: t(`${RUNS_NS}.sourceChannelRef`, { id: eventId }),
      tone: 'mono',
      icon: 'msg',
    };
  }
  return { display: '—', title: t(`${RUNS_NS}.sourceAbsent`), tone: 'mono', icon: 'msg' };
}

/**
 * Source marker → on-screen word: run trigger words, then the shared audit
 * words (case-insensitive), then — for an identity-shaped marker — that
 * identity in its readable form, then the value verbatim (未收录不机翻: an
 * unlisted marker never gets an invented Chinese name, and the no-bare-ref
 * rule wins over the verbatim rule).
 */
function labelRunSource(raw: string, t: TFn): string {
  const runsKey = RUN_SOURCE_LABEL_KEYS[raw.trim().toLowerCase()];
  if (runsKey) return t(runsKey);
  const word = sourceWord(raw, t);
  if (word !== raw) return word;
  const prefix = idPrefix(raw).toLowerCase();
  if (prefix === 'human' || prefix === 'employee' || /^empv?_/i.test(raw)) {
    return runEmployeeLabel(raw, undefined, t);
  }
  return raw;
}

// ---------- columns (10 columns, fixed order, AC §3; widths target §4.1) ----------

export function buildColumns(t: TFn): LkColumn[] {
  return [
    { key: 'run', label: t(`${RUNS_NS}.colRun`) },
    { key: 'employee', label: t(`${RUNS_NS}.colEmployee`), width: 112 },
    { key: 'status', label: t(`${RUNS_NS}.colStatus`), width: 96 },
    { key: 'duration', label: t(`${RUNS_NS}.colDuration`), width: 80, align: 'right' },
    { key: 'cost', label: t(`${RUNS_NS}.colCost`), width: 148, align: 'right' },
    { key: 'source', label: t(`${RUNS_NS}.colSource`), width: 128 },
    { key: 'version', label: t(`${RUNS_NS}.colVersion`), width: 60, align: 'right' },
    { key: 'start', label: t(`${RUNS_NS}.colStart`), width: 110, align: 'right' },
    { key: 'end', label: t(`${RUNS_NS}.colEnd`), width: 110, align: 'right' },
    { key: 'action', label: t(`${RUNS_NS}.colAction`), width: 72 },
  ];
}

/** Row-card labels (≤767 CSS prints them from `data-l`). */
export function columnLabelMap(t: TFn): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of buildColumns(t)) out[c.key] = String(c.label);
  return out;
}

// ---------- state screens (QA R2 ④/⑥: human copy + request id + retry) -----

/**
 * One error/forbidden screen shape. Both bodies are pure localized copy: the
 * response body, the upstream machine code and the bare HTTP status never
 * reach the screen (support works from the request id). 403 and 404 return
 * the SAME view, so the screen cannot reveal whether a record exists.
 */
export interface RunsStageView {
  icon: 'alert' | 'lock';
  title: string;
  desc: string;
  retryLabel: string;
  testId: string;
  retryTestId: string;
  reqIdTestId: string;
  /** Extra escape hatch for the plain failure screen only. */
  backLabel: string | null;
}

export function runsErrorView(t: TFn, httpStatus: number): RunsStageView {
  // The status is only an internal branch (which sentence is true); the code
  // itself is never printed. 0 = network failure or the 10s watchdog.
  const desc =
    httpStatus === 400
      ? t(`${RUNS_NS}.errorFilter`)
      : httpStatus === 0
        ? t(`${RUNS_NS}.errorDescNetwork`)
        : t(`${RUNS_NS}.errorGeneric`);
  return {
    icon: 'alert',
    title: t(`${RUNS_NS}.errorTitle`),
    desc,
    retryLabel: t(`${RUNS_NS}.reload`),
    testId: 'agent-v2-runs-error',
    retryTestId: 'agent-v2-runs-retry',
    reqIdTestId: 'agent-v2-runs-error-reqid',
    backLabel: t(`${RUNS_NS}.backOverview`),
  };
}

export function runsForbiddenView(t: TFn): RunsStageView {
  return {
    icon: 'lock',
    title: t(`${RUNS_NS}.forbiddenTitle`),
    desc: t(`${RUNS_NS}.forbiddenDesc`),
    retryLabel: t(`${RUNS_NS}.forbiddenRetry`),
    testId: 'agent-v2-runs-forbidden',
    retryTestId: 'agent-v2-runs-forbidden-retry',
    reqIdTestId: 'agent-v2-runs-forbidden-reqid',
    backLabel: null,
  };
}
