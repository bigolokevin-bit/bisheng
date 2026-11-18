/* RUN-02 detail kit: contract vocabulary maps, pure formatters and the copy
 * control shared by runDetail.css's a2r-* vocabulary. Split from the page so
 * RunDetailPage.tsx stays within its line budget — same idiom as
 * approvalDetailKit.tsx, no new colors, tokens only.
 *
 * Discipline: labels come from the frozen AGENTRUN vocabulary (status /
 * eventType / reasonCode). Unknown values are surfaced raw + an explicit
 * 「未收录」 note — never machine-translated, never guessed. Numbers are never
 * re-rounded (costUsd 0.009875 must stay 0.009875); a missing duration is
 * never invented.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { RunStatus } from '@/controllers/API/agentConsoleRuns';
import { fmtPct } from './v2Data';

/* ---------- contract vocabulary ---------- */

/** Terminal run statuses (AGENTRUN §2). Interrupted is terminal. */
export const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

/** Statuses that keep the 2s poll alive. */
export const LIVE_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>(['pending', 'running']);

/** Frozen run-status labels, already present in all three locales. */
export const RUN_STATUS_KEYS: Record<RunStatus, string> = {
  pending: 'agentConsole.v2.run02.pendingLabel',
  running: 'agentConsole.runs.status.running',
  completed: 'agentConsole.runs.status.completed',
  failed: 'agentConsole.runs.status.failed',
  cancelled: 'agentConsole.runs.status.cancelled',
  interrupted: 'agentConsole.runs.status.interrupted',
};

/** One-line semantic note under the status field (target §1.5 #1). */
export const STATUS_NOTE_KEYS: Record<RunStatus, string> = {
  pending: 'agentConsole.v2.run02.statusNote.pending',
  running: 'agentConsole.v2.run02.statusNote.running',
  completed: 'agentConsole.v2.run02.statusNote.completed',
  failed: 'agentConsole.v2.run02.statusNote.failed',
  cancelled: 'agentConsole.v2.run02.statusNote.cancelled',
  interrupted: 'agentConsole.v2.run02.statusNote.interrupted',
};

/** Contract reason codes only (AGENTRUN). Unknown → raw + 未收录, no guessing. */
export const REASON_KEYS: Record<string, string> = {
  'run.budget_exhausted': 'agentConsole.v2.run02.reason.budgetExhausted',
  'run.stopped_by_user': 'agentConsole.v2.run02.reason.stoppedByUser',
  'run.upstream_unavailable': 'agentConsole.v2.run02.reason.upstreamUnavailable',
  'run.upstream_completed': 'agentConsole.v2.run02.reason.upstreamCompleted',
};

/** Frozen eventType vocabulary (AGENTRUN §1.2). */
export const EVENT_LABEL_KEYS: Record<string, string> = {
  message: 'agentConsole.v2.run02.ev.message',
  token: 'agentConsole.v2.run02.ev.token',
  tool_call: 'agentConsole.v2.run02.ev.toolCall',
  tool_result: 'agentConsole.v2.run02.ev.toolResult',
  approval_requested: 'agentConsole.v2.run02.ev.approvalRequested',
  approval_responded: 'agentConsole.v2.run02.ev.approvalResponded',
  completed: 'agentConsole.v2.run02.ev.completed',
  failed: 'agentConsole.v2.run02.ev.failed',
  interrupted: 'agentConsole.v2.run02.ev.interrupted',
  cancelled: 'agentConsole.v2.run02.ev.cancelled',
};

/** Pill tone class for a run status (RUN-01 §2.1, same contract). */
export function statusTone(status: string): '' | 'ok' | 'wr' | 'dg' {
  if (status === 'completed') return 'ok';
  if (status === 'pending' || status === 'running') return 'wr';
  if (status === 'failed' || status === 'cancelled' || status === 'interrupted') return 'dg';
  return '';
}

/* ---------- pure formatters ---------- */

const SHANGHAI_MOMENT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const SHANGHAI_STAMP = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const SHANGHAI_CLOCK = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function partsOf(fmt: Intl.DateTimeFormat, ms: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ms))) out[p.type] = p.value;
  return out;
}

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Asia/Shanghai MM-DD HH:mm (same convention as RUN-01 / TSK-01). */
export function fmtMoment(iso: string | null | undefined): string {
  const ms = parseMs(iso);
  if (ms === null) return '—';
  const p = partsOf(SHANGHAI_MOMENT, ms);
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** Asia/Shanghai HH:mm:ss (meta row freshness). */
export function fmtClock(iso: string | number | null | undefined): string {
  const ms = typeof iso === 'number' ? iso : parseMs(iso);
  if (ms === null || !Number.isFinite(ms)) return '—';
  const p = partsOf(SHANGHAI_CLOCK, ms);
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** Asia/Shanghai HH:mm:ss.SSS (event detail occurred time). */
/** PRD L5 canonical wall clock: Asia/Shanghai YYYY-MM-DD HH:mm (minute precision). */
export function fmtMinuteFull(iso: string | null | undefined): string {
  const ms = parseMs(iso);
  if (ms === null) return '—';
  const d = new Date(ms + 480 * 60_000);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function fmtStamp(iso: string | null | undefined): string {
  const ms = parseMs(iso);
  if (ms === null) return '—';
  const p = partsOf(SHANGHAI_STAMP, ms);
  const millis = String(Math.abs(ms % 1000)).padStart(3, '0');
  return `${p.hour}:${p.minute}:${p.second}.${millis}`;
}

/** Full ISO for tooltips; never used as the visible value. */
export function fullIso(iso: string | null | undefined): string | undefined {
  const ms = parseMs(iso);
  return ms === null ? undefined : new Date(ms).toISOString();
}

/** runId: prefix + ULID first4 … last4 (spec §5.1); full value in title. */
export function shortRunId(id: string): string {
  if (!id) return '—';
  if (id.startsWith('rn_') && id.length > 11) return `${id.slice(0, 7)}…${id.slice(-4)}`;
  if (id.length <= 9) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

/** upstreamRunId: upstream shape `run_<hex>` → first8 … last6. */
export function shortUpstream(id: string): string {
  if (!id) return '—';
  if (id.startsWith('run_') && id.length > 14) return `${id.slice(0, 8)}…${id.slice(-6)}`;
  return shortRunId(id);
}

/** channelEventId / taskId / pss ref: prefix + … + last4 (target §1.4/§1.7). */
export function shortRef(id: string): string {
  if (!id) return '—';
  if (id.length <= 10) return id;
  const head = id.startsWith('tk_') || id.startsWith('pss_') ? 7 : 6;
  return `${id.slice(0, head)}…${id.slice(-4)}`;
}

/** Compact duration: 38s / 4m32s / 1h02m; sub-second keeps one decimal. */
export function fmtDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  if (m < 60) return `${m}m${String(total % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

/** Edges must both exist: no fabricated duration (spec §1.5 #4). */
export function durationMs(
  startedAt: string | null | undefined,
  endedAt: string | null | undefined,
): number | null {
  const a = parseMs(startedAt);
  const b = parseMs(endedAt);
  if (a === null || b === null) return null;
  const diff = b - a;
  return diff >= 0 ? diff : null;
}

/** Event gap column: never fills a missing predecessor with 0. */
export function fmtGap(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  return `+${(ms / 1000).toFixed(1)}s`;
}

/** Raw upstream figure, never re-rounded (0.009875 must not become 0.00). */
export function fmtCost(costUsd: number | null | undefined): string {
  return typeof costUsd === 'number' && Number.isFinite(costUsd) ? `USD ${String(costUsd)}` : '—';
}

export function fmtCap(cap: number | null | undefined): string {
  return typeof cap === 'number' && Number.isFinite(cap) ? String(cap) : '—';
}

/** Ratio only when both sides exist and the cap is non-zero (S1: whole %). */
export function fmtRatio(
  costUsd: number | null | undefined,
  budgetCapUsd: number | null | undefined,
): string | null {
  if (typeof costUsd !== 'number' || !Number.isFinite(costUsd)) return null;
  if (typeof budgetCapUsd !== 'number' || !Number.isFinite(budgetCapUsd) || budgetCapUsd <= 0) {
    return null;
  }
  return fmtPct(costUsd / budgetCapUsd);
}

/** Pull lag of one event (pulledAt − occurredAt); null when unparsable. */
export function eventLagMs(event: { occurredAt: string; pulledAt: string }): number | null {
  const a = parseMs(event.occurredAt);
  const b = parseMs(event.pulledAt);
  if (a === null || b === null) return null;
  return b - a;
}

/** One event's original payload text (never rewritten, never re-masked). */
export function payloadText(event: {
  payload: Record<string, unknown> | null;
  rawPayload?: string;
}): string {
  if (event.payload !== null) return JSON.stringify(event.payload, null, 2);
  return event.rawPayload === undefined || event.rawPayload === '' ? 'null' : event.rawPayload;
}

/* ---------- small presentational primitives ---------- */

/** Copy control with a 1.2s 「已复制」 tooltip; copies the FULL value. */
export function CopyText({
  value,
  label,
  aria,
  testId,
  className = 'b xs gh',
  icon,
}: {
  value: string;
  label: string;
  aria: string;
  testId?: string;
  className?: string;
  /** Optional leading glyph (TSK-02 copy-link button). */
  icon?: ReactNode;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied('copied');
    } catch {
      setCopied('failed');
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied('idle'), 1200);
  }, [value]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <span className={`a2r-cp${copied === 'copied' ? ' copied' : ''}`} title={value}>
      <button
        type="button"
        className={className}
        aria-label={aria}
        data-testid={testId}
        onClick={() => void copy()}
      >
        {icon}
        {label}
      </button>
      <span className="a2r-tp" role="status">
        {copied === 'copied'
          ? t('agentConsole.v2.run02.copied')
          : copied === 'failed'
            ? t('agentConsole.v2.run02.copyFailed')
            : ''}
      </span>
    </span>
  );
}

/** HFieldRow cell: micro label + mono/sans value + one caliber note line. */
export function Field({
  label,
  note,
  sans,
  wide,
  testId,
  title,
  children,
}: {
  label: ReactNode;
  note?: ReactNode;
  sans?: boolean;
  wide?: boolean;
  testId?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`a2r-hf${wide ? ' wide' : ''}`} data-testid={testId} title={title}>
      <div className="a2r-fl micro">{label}</div>
      <div className={`a2r-fv${sans ? ' t' : ''}`}>{children}</div>
      {note ? <div className="a2r-fn">{note}</div> : null}
    </div>
  );
}

/** Card shell: header (title + mono count + note), optional footer. */
export function Panel({
  title,
  count,
  note,
  foot,
  testId,
  children,
}: {
  title: string;
  count?: ReactNode;
  note?: ReactNode;
  foot?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div className="card a2r-panel" data-testid={testId}>
      <div className="a2r-ch">
        <span className="a2r-cht">{title}</span>
        {count ? <span className="a2r-chc mono">{count}</span> : null}
        <span className="a2r-sp" />
        {note ? <span className="a2r-chn">{note}</span> : null}
      </div>
      <div className="rule" />
      {children}
      {foot ? (
        <>
          <div className="rule" />
          <div className="a2r-cf">{foot}</div>
        </>
      ) : null}
    </div>
  );
}