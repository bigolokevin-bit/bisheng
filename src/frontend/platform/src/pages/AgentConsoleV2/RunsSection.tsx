/**
 * L4 console v2-4 (l4-console-v2-trace): the 「运行与追踪」 section.
 *
 * R5 run list (filter bar + run cards) with an expandable R3 event timeline
 * per run. Every block degrades independently (same Box<T> discipline as
 * TrendsCostsSection): list loading/ok/error+retry, per-run event stream
 * loading/ok/error+retry.
 *
 * Honest-data rules (design.md 数据面事实 + §3):
 * - Every R5 request carries `since` (a 6-day local-day ISO start, same
 *   buildWindow idiom as P0-5) plus a fixed `limit` of 50: an unconditional
 *   query is rejected upstream with 400 request.missing_filter, so it is
 *   never sent.
 * - Values render verbatim from the capture: runId is truncated visually
 *   only (title carries the full value), `costUsd` is shown as the raw
 *   upstream figure (never re-rounded to 0.00), durations are only computed
 *   when `endedAt` exists — a running/unfinished run shows 「—」 instead of a
 *   fabricated number, and an unknown `costStatus` shows 「—」 rather than a
 *   pill.
 * - Unknown enum values are logged loudly and rendered raw (never guessed),
 *   mirroring the lifecycle-state guardrail on the detail page.
 * - The event timeline is the pure `buildRunTrace` port of the runtime's
 *   trace.py: ascending seq, call→result pairing badges (pending/settled/
 *   orphan-result/duplicate-call) and post-terminal events kept as facts.
 * - Pagination never duplicates and never loses a row: 「加载更多」 requests
 *   `sinceSeq = nextSeq` (exclusive lower bound, verified live) and merges
 *   pages by seq.
 * Layout uses fr / minmax(0,1fr) tracks with ellipsis and wrapping only, so
 * 375px stays free of horizontal overflow.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { AgentConsoleApi, EmployeeSummary } from '@/controllers/API/agent';
import {
  type AgentConsoleRunsApi,
  type Run,
  type RunEvent,
  type RunStatus,
} from '@/controllers/API/agentConsoleRuns';

import { buildWindow } from './TrendsCostsSection';
import { buildRunTrace, type RunStep, type TraceEvent } from './runTrace';

type Box<T> = { phase: 'loading' } | { phase: 'ok'; value: T } | { phase: 'error' };

/** One run's accumulated event stream (merged R3 pages). */
interface EventsPage {
  items: RunEvent[];
  nextSeq: number | null;
  hasMore: boolean;
}

const boxLoading = { phase: 'loading' } as const;
const boxError = { phase: 'error' } as const;

/** R5 page size — fixed 50 (upstream max is 100; design.md 风险与裁定). */
const RUNS_LIMIT = 50;
/** R3 page size; 「加载更多」 walks `nextSeq` while `hasMore` stays true. */
const EVENT_LIMIT = 50;
/** E11 page size for employee-name lookup (contract max 200). */
const EMPLOYEES_LIMIT = 200;

/** RunStatus contract enum, in filter order (agentrun_models.py). */
const RUN_STATUSES: RunStatus[] = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
];

/** Reuses the frozen run-status keys already present in all three locales. */
const RUN_STATUS_LABEL_KEYS: Record<RunStatus, string> = {
  pending: 'agentConsole.runs.status.pending',
  running: 'agentConsole.runs.status.running',
  completed: 'agentConsole.runs.status.completed',
  failed: 'agentConsole.runs.status.failed',
  cancelled: 'agentConsole.runs.status.cancelled',
  interrupted: 'agentConsole.runs.status.interrupted',
};

/** Pill tone per design.md §3 (completed ok, pending/running warn, else danger). */
function statusPillClass(status: string): string {
  if (status === 'completed') return 'is-ok';
  if (status === 'pending' || status === 'running') return 'is-warn';
  if (status === 'failed' || status === 'cancelled' || status === 'interrupted') return 'is-danger';
  return '';
}

const COST_STATUS_KEYS: Record<string, { cls: string; key: string }> = {
  upstream: { cls: 'is-ok', key: 'agentConsole.v2.runsCostUpstream' },
  estimated: { cls: 'is-warn', key: 'agentConsole.v2.runsCostEstimated' },
};

const BADGE_KEYS: Record<string, { cls: string; key: string }> = {
  pending: { cls: 'is-warn', key: 'agentConsole.v2.evPending' },
  settled: { cls: 'is-ok', key: 'agentConsole.v2.evSettled' },
  'orphan-result': { cls: 'is-danger', key: 'agentConsole.v2.evOrphanResult' },
  'duplicate-call': { cls: 'is-danger', key: 'agentConsole.v2.evDuplicateCall' },
  postTerminal: { cls: 'is-warn', key: 'agentConsole.v2.evPostTerminal' },
};

/** §5.1 mono id: 前4…后4, the full value stays in the title attribute. */
function shortRunId(id: string): string {
  if (id.length <= 9) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

/** §5.2 idiom, verbatim from the v2 row cards: `String(x).slice(0,16).replace('T',' ')`. */
function formatMoment(iso: string | null | undefined): string {
  if (!iso) return '—';
  return String(iso).slice(0, 16).replace('T', ' ');
}

/** endedAt − startedAt, human-compact. No end ⇒ 「—」, never a fake duration. */
function formatDuration(startedAt?: string | null, endedAt?: string | null): string {
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
function formatCost(costUsd?: number | null): string {
  return typeof costUsd === 'number' && Number.isFinite(costUsd) ? String(costUsd) : '—';
}

/**
 * Localized label for a contract status. The six-value enum is the contract
 * (agentrun_models.py); anything else is an upstream bug — log it loudly,
 * then degrade to the raw value (never guess a label), same guardrail as the
 * employee lifecycle pill.
 */
function runStatusLabel(t: TFunction, status: string): string {
  const key = RUN_STATUS_LABEL_KEYS[status as RunStatus];
  if (key === undefined) {
    console.error('[AgentConsoleV2] unknown run status:', status);
    return status;
  }
  return t(key);
}

/** Merge R3 pages by seq: ascending, deduped, nothing dropped. */
function mergeBySeq(prev: RunEvent[], added: RunEvent[]): RunEvent[] {
  const bySeq = new Map<number, RunEvent>();
  for (const e of prev) bySeq.set(e.seq, e);
  for (const e of added) {
    // A re-sent seq is the same stream fact; keep the copy already rendered.
    if (!bySeq.has(e.seq)) bySeq.set(e.seq, e);
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

function payloadText(ev: TraceEvent): string {
  if (!ev.parsed) return ev.rawPayload ?? '';
  return JSON.stringify(ev.payload, null, 2);
}

export interface RunsSectionProps {
  /** R5/R3 read-only adapter (injectable for tests, HTTP fallback on the page). */
  api: AgentConsoleRunsApi;
  /** E11 only: employee names for the cards and the filter select. */
  consoleApi: AgentConsoleApi;
  /** Set when entering from an employee's 「查看运行」 action. */
  initialEmployeeId?: string | null;
}

export function RunsSection({ api, consoleApi, initialEmployeeId }: RunsSectionProps) {
  const { t } = useTranslation();

  const [runs, setRuns] = useState<Box<Run[]>>(boxLoading);
  const [employees, setEmployees] = useState<Box<EmployeeSummary[]>>(boxLoading);
  const [timelines, setTimelines] = useState<Record<string, Box<EventsPage>>>({});
  const [openRun, setOpenRun] = useState<Record<string, boolean>>({});
  const [fetchingMore, setFetchingMore] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<string>('');
  const [employeeId, setEmployeeId] = useState<string>(initialEmployeeId ?? '');
  const [retryNonce, setRetryNonce] = useState(0);

  // Live guard for the imperative (click-driven) event requests.
  const liveRef = useRef(true);
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  // Fixed 「近 7 天」 window: the local start of the day 6 days ago, as an ISO
  // instant (same buildWindow idiom as P0-5 — a bare YYYY-MM-DD was parsed as
  // local midnight upstream and dropped today's runs).
  const since = useMemo(() => buildWindow().from, []);

  useEffect(() => {
    let live = true;
    setRuns(boxLoading);
    // Filters changed: cached timelines belong to the previous query, drop
    // them along with the expanded state so nothing stale is rendered.
    setOpenRun({});
    setTimelines({});
    setFetchingMore({});
    api
      .listRuns({
        employeeId: employeeId || undefined,
        status: status || undefined,
        since,
        limit: RUNS_LIMIT,
      })
      .then((res) => {
        if (!live) return;
        setRuns(
          res.ok && res.data && Array.isArray(res.data.items)
            ? { phase: 'ok', value: res.data.items }
            : boxError,
        );
      })
      .catch(() => {
        if (live) setRuns(boxError);
      });
    return () => {
      live = false;
    };
  }, [api, employeeId, status, since, retryNonce]);

  useEffect(() => {
    let live = true;
    setEmployees(boxLoading);
    consoleApi
      .listEmployees({ limit: EMPLOYEES_LIMIT })
      .then((res) => {
        if (!live) return;
        setEmployees(
          res && Array.isArray(res.items) ? { phase: 'ok', value: res.items } : boxError,
        );
      })
      .catch(() => {
        // Names are cosmetic: degrade to the raw employeeId (a real value).
        if (live) setEmployees(boxError);
      });
    return () => {
      live = false;
    };
  }, [consoleApi]);

  const names = useMemo(() => {
    const map = new Map<string, string>();
    if (employees.phase === 'ok') {
      for (const e of employees.value) map.set(e.employeeId, e.name);
    }
    return map;
  }, [employees]);

  const setBox = useCallback((runId: string, box: Box<EventsPage>) => {
    if (!liveRef.current) return;
    setTimelines((prev) => ({ ...prev, [runId]: box }));
  }, []);

  const loadEvents = useCallback(
    (runId: string) => {
      setBox(runId, boxLoading);
      api
        .listEvents({ runId, limit: EVENT_LIMIT })
        .then((res) => {
          const data = res.ok ? res.data : null;
          if (!data || !Array.isArray(data.items)) {
            setBox(runId, boxError);
            return;
          }
          setBox(runId, {
            phase: 'ok',
            value: { items: data.items, nextSeq: data.nextSeq ?? null, hasMore: data.hasMore === true },
          });
        })
        .catch(() => setBox(runId, boxError));
    },
    [api, setBox],
  );

  const loadMore = useCallback(
    (runId: string, nextSeq: number) => {
      setFetchingMore((prev) => ({ ...prev, [runId]: true }));
      api
        .listEvents({ runId, sinceSeq: nextSeq, limit: EVENT_LIMIT })
        .then((res) => {
          const data = res.ok ? res.data : null;
          if (liveRef.current && data && Array.isArray(data.items)) {
            setTimelines((prev) => {
              const cur = prev[runId];
              if (!cur || cur.phase !== 'ok') return prev;
              return {
                ...prev,
                [runId]: {
                  phase: 'ok',
                  value: {
                    items: mergeBySeq(cur.value.items, data.items),
                    nextSeq: data.nextSeq ?? cur.value.nextSeq,
                    hasMore: data.hasMore === true,
                  },
                },
              };
            });
          }
          // A failed "load more" keeps what is already on screen and leaves
          // the same button in place, so clicking it again is the retry.
          if (liveRef.current) setFetchingMore((prev) => ({ ...prev, [runId]: false }));
        })
        .catch(() => {
          if (liveRef.current) setFetchingMore((prev) => ({ ...prev, [runId]: false }));
        });
    },
    [api],
  );

  const toggleRun = useCallback(
    (run: Run) => {
      const willOpen = !openRun[run.runId];
      setOpenRun((prev) => ({ ...prev, [run.runId]: willOpen }));
      if (willOpen && !timelines[run.runId]) {
        if (run.lastEventSeq === 0) {
          // The run row itself states there are no events — no request needed,
          // and none is fabricated.
          setBox(run.runId, { phase: 'ok', value: { items: [], nextSeq: null, hasMore: false } });
        } else {
          loadEvents(run.runId);
        }
      }
    },
    [loadEvents, openRun, setBox, timelines],
  );

  return (
    <div className="a2-card" data-testid="agent-v2-runs">
      <h2 className="a2-h2">{t('agentConsole.v2.runsTitle')}</h2>

      <div className="a2-toolbar a2-run-toolbar" data-testid="agent-v2-runs-toolbar">
        <div className="a2-run-filter">
          <span className="a2-micro">{t('agentConsole.v2.runsFilterStatus')}</span>
          <div
            className="a2-run-seg"
            role="group"
            aria-label={t('agentConsole.v2.runsFilterStatus')}
            data-testid="agent-v2-runs-filter-status"
          >
            <button
              type="button"
              className="a2-btn a2-run-seg-btn"
              aria-pressed={status === ''}
              data-testid="agent-v2-runs-status-all"
              onClick={() => setStatus('')}
            >
              {t('agentConsole.v2.runsFilterAll')}
            </button>
            {RUN_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className="a2-btn a2-run-seg-btn"
                aria-pressed={status === s}
                data-testid={`agent-v2-runs-status-${s}`}
                onClick={() => setStatus(s)}
              >
                {t(RUN_STATUS_LABEL_KEYS[s])}
              </button>
            ))}
          </div>
        </div>

        <label className="a2-run-filter">
          <span className="a2-micro">{t('agentConsole.v2.runsFilterEmployee')}</span>
          <select
            className="a2-run-select"
            aria-label={t('agentConsole.v2.runsFilterEmployee')}
            data-testid="agent-v2-runs-filter-employee"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">{t('agentConsole.v2.runsFilterAll')}</option>
            {employees.phase === 'ok'
              ? employees.value.map((e) => (
                  <option key={e.employeeId} value={e.employeeId}>
                    {e.name}
                  </option>
                ))
              : null}
          </select>
        </label>

        <span className="a2-meta a2-run-window" data-testid="agent-v2-runs-window">
          {t('agentConsole.v2.runsWindow')}
        </span>
      </div>

      {runs.phase === 'loading' ? (
        <p className="a2-meta" data-testid="agent-v2-runs-loading">
          {t('agentConsole.v2.loading')}
        </p>
      ) : null}

      {runs.phase === 'error' ? (
        <div className="a2-run-block" data-testid="agent-v2-runs-error">
          <p className="a2-meta">{t('agentConsole.v2.runsError')}</p>
          <button
            type="button"
            className="a2-btn"
            data-testid="agent-v2-runs-retry"
            onClick={() => setRetryNonce((n) => n + 1)}
          >
            {t('agentConsole.v2.runsRetry')}
          </button>
        </div>
      ) : null}

      {runs.phase === 'ok' && runs.value.length === 0 ? (
        <p className="a2-meta" data-testid="agent-v2-runs-empty">
          {t('agentConsole.v2.runsEmpty')}
        </p>
      ) : null}

      {runs.phase === 'ok' && runs.value.length > 0 ? (
        <div className="a2-runs-list">
          {runs.value.map((run) => {
            const statusLabel = runStatusLabel(t, run.status);
            const cost = COST_STATUS_KEYS[run.costStatus ?? ''];
            return (
              <div className="a2-run-card" key={run.runId} data-testid="agent-v2-runs-card">
                <div className="a2-run-head">
                  <span
                    className={`a2-pill ${statusPillClass(run.status)}`}
                    data-testid="agent-v2-runs-status"
                  >
                    {statusLabel}
                  </span>
                  <span
                    className="a2-run-id a2-mono"
                    title={run.runId}
                    data-testid="agent-v2-runs-id"
                  >
                    {shortRunId(run.runId)}
                  </span>
                  <span className="a2-run-name" data-testid="agent-v2-runs-employee">
                    {names.get(run.employeeId) ?? run.employeeId}
                  </span>
                  <span
                    className="a2-run-time a2-mono"
                    title={run.startedAt}
                    data-testid="agent-v2-runs-time"
                  >
                    {formatMoment(run.startedAt)}
                  </span>
                  <button
                    type="button"
                    className="a2-btn a2-run-toggle"
                    aria-expanded={openRun[run.runId] === true}
                    data-testid="agent-v2-runs-toggle"
                    onClick={() => toggleRun(run)}
                  >
                    {t(openRun[run.runId] ? 'agentConsole.runs.collapse' : 'agentConsole.runs.expand')}
                  </button>
                </div>

                <div className="a2-run-meta">
                  <span className="a2-micro">{t('agentConsole.v2.runsDuration')}</span>
                  <span className="a2-run-value a2-mono" data-testid="agent-v2-runs-duration">
                    {formatDuration(run.startedAt, run.endedAt)}
                  </span>
                  <span className="a2-micro">{t('agentConsole.v2.runsCost')}</span>
                  <span className="a2-run-value a2-mono" data-testid="agent-v2-runs-cost">
                    {formatCost(run.costUsd)}
                  </span>
                  {cost ? (
                    <span className={`a2-pill ${cost.cls}`} data-testid="agent-v2-runs-cost-status">
                      {t(cost.key)}
                    </span>
                  ) : (
                    <span className="a2-run-value" data-testid="agent-v2-runs-cost-status">
                      {'—'}
                    </span>
                  )}
                </div>

                {openRun[run.runId] ? (
                  <RunTimeline
                    run={run}
                    box={timelines[run.runId]}
                    fetchingMore={fetchingMore[run.runId] === true}
                    onLoadMore={loadMore}
                    onRetry={loadEvents}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

interface RunTimelineProps {
  run: Run;
  box: Box<EventsPage> | undefined;
  fetchingMore: boolean;
  onLoadMore: (runId: string, nextSeq: number) => void;
  onRetry: (runId: string) => void;
}

/** One run's R3 stream: step-pairing summary + ascending event rows. */
function RunTimeline({ run, box, fetchingMore, onLoadMore, onRetry }: RunTimelineProps) {
  const { t } = useTranslation();

  if (!box || box.phase === 'loading') {
    return (
      <div className="a2-run-timeline" data-testid="agent-v2-ev-loading-block">
        <p className="a2-meta" data-testid="agent-v2-ev-loading">
          {t('agentConsole.v2.loading')}
        </p>
      </div>
    );
  }

  if (box.phase === 'error') {
    return (
      <div className="a2-run-timeline" data-testid="agent-v2-ev-error-block">
        <p className="a2-meta" data-testid="agent-v2-ev-error">
          {t('agentConsole.v2.evError')}
        </p>
        <button type="button" className="a2-btn" data-testid="agent-v2-ev-retry" onClick={() => onRetry(run.runId)}>
          {t('agentConsole.v2.runsRetry')}
        </button>
      </div>
    );
  }

  const { items, nextSeq, hasMore } = box.value;
  if (items.length === 0) {
    return (
      <div className="a2-run-timeline" data-testid="agent-v2-ev-empty-block">
        <p className="a2-meta" data-testid="agent-v2-ev-empty">
          {t('agentConsole.v2.evEmpty')}
        </p>
      </div>
    );
  }

  const trace = buildRunTrace(items);
  const badge = (kind: keyof typeof BADGE_KEYS, testid: string) => {
    const b = BADGE_KEYS[kind];
    return (
      <span className={`a2-pill ${b.cls}`} data-testid={testid}>
        {t(b.key)}
      </span>
    );
  };

  return (
    <div className="a2-run-timeline" data-testid="agent-v2-ev-timeline">
      {trace.steps.length > 0 ? (
        <div className="a2-ev-steps" data-testid="agent-v2-ev-steps">
          <div className="a2-micro">{t('agentConsole.v2.evSteps')}</div>
          {trace.steps.map((step: RunStep) => (
            <div
              className="a2-ev-step"
              key={`${step.stepSeq}\u0000${step.toolName}\u0000${step.callEvent.seq}`}
              data-testid="agent-v2-ev-step"
            >
              <span className="a2-ev-num a2-mono">{step.stepSeq}</span>
              <span className="a2-ev-tool">{step.toolName}</span>
              {badge(step.state, 'agent-v2-ev-step-state')}
              {step.anomaly ? badge(step.anomaly, 'agent-v2-ev-step-anomaly') : null}
              <span className="a2-ev-call a2-mono" title={step.callEvent.occurredAt}>
                #{step.callEvent.seq}
              </span>
              <span className="a2-ev-result a2-mono">
                {step.resultSeq === null ? '—' : `#${step.resultSeq}`}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="a2-ev-head a2-micro">
        <span>{t('agentConsole.v2.evSeq')}</span>
        <span>{t('agentConsole.v2.evType')}</span>
        <span>{t('agentConsole.v2.evTime')}</span>
      </div>

      {trace.events.map((ev: TraceEvent) => (
        <div className="a2-ev-row" key={ev.seq} data-testid="agent-v2-ev-row">
          <div className="a2-ev-line">
            <span className="a2-ev-num a2-mono" data-testid="agent-v2-ev-seq">
              {ev.seq}
            </span>
            <span className="a2-ev-type a2-mono" data-testid="agent-v2-ev-type">
              {ev.eventType}
            </span>
            <span className="a2-ev-time a2-mono" data-testid="agent-v2-ev-time">
              {formatMoment(ev.occurredAt)}
            </span>
            {ev.anomaly ? badge(ev.anomaly, 'agent-v2-ev-anomaly') : null}
            {ev.postTerminal ? badge('postTerminal', 'agent-v2-ev-post-terminal') : null}
          </div>
          <details className="a2-ev-payload" data-testid="agent-v2-ev-payload">
            <summary className="a2-micro">{t('agentConsole.v2.evPayload')}</summary>
            <pre className="a2-ev-json a2-mono">{payloadText(ev)}</pre>
          </details>
        </div>
      ))}

      {hasMore ? (
        <button
          type="button"
          className="a2-btn a2-ev-more"
          data-testid="agent-v2-ev-load-more"
          disabled={fetchingMore}
          onClick={() => nextSeq !== null && onLoadMore(run.runId, nextSeq)}
        >
          {t('agentConsole.v2.runsLoadMore')}
        </button>
      ) : null}
    </div>
  );
}
