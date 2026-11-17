/* RUN-02 `/agent/runs/:runId` — read-only run detail, rebuilt against the
 * frozen C1 baseline run02-target.html + RUN02-TARGET-SPEC.md.
 *
 * Shape (spec §1): back row → page head (status pill + h1 + mono runId) →
 * meta row (freshness · poll state · lastEventSeq · source + read-only
 * caliber) → conditional alert bar → summary card (HFieldRow 8 fields +
 * wide governance ids) → split(1fr+380): trace card | 关联对象 / 状态与终态 /
 * 口径与来源 → footer.
 *
 * Honest-data rules (SPEC §2 + M2-PRD-DEEP §3/§13):
 * - R2 GET /api/run-detail is the header; R3 GET /api/run-events the stream;
 *   E11 names the employee (a failed lookup degrades to 「员工 · 短码」 — S2,
 *   the raw `emp_` id lives in the cell title only).
 * - lastEventSeq === 0 → NO R3 request at all (the empty state is the head).
 * - Trace layering is the pure runTrace.ts derivation, not a span tree: the
 *   nine shapes (待结果/已配对/重复调用/孤立结果/坏载荷/终态后/缺工具名/
 *   stepSeq 回落/审批 flow) are labeled, never swallowed; a seq beyond
 *   terminalSeq keeps its fact and settles nothing (the negative case).
 * - Durations only from endedAt − startedAt; a live run shows a local timer
 *   explicitly marked non-upstream; a missing edge is —, never a number.
 * - Cost is verbatim (0.009875 never becomes 0.00); `unknown` prints the
 *   literal word; the ratio only exists when cost and cap both do.
 * - tenantId is NEVER rendered; policySnapshotRef/upstreamRunId are copy-only
 *   (P6 has no BFF route); 关联任务 stays disabled with a reason until TSK-02.
 * - Zero write entries: no abort/rerun/resume/trigger/export anywhere — the
 *   DOM has no such control, not even disabled ones.
 * - Five states: loading skeleton, 400/5xx error stage, 403/404 forbidden
 *   (same body, code only), no-event card, normal. 401 → login.
 * - Polling: 2s while pending/running, hidden pauses, visible catches up,
 *   exponential backoff with a 3-failure alert, abort-on-unmount epoch guards
 *   discard late responses, terminal event or terminal head stops the poll.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  AuthError,
  createHttpAgentConsoleApi,
  type AgentConsoleApi,
  type EmployeeSummary,
} from '@/controllers/API/agent';
import {
  createHttpAgentConsoleRunsApi,
  type AgentConsoleRunsApi,
  type Run,
  type RunEvent,
  type RunEventList,
  type RunStatus,
} from '@/controllers/API/agentConsoleRuns';

import { CopyId, LkIcon, ReqId, StageCard } from './listkit';
import { FETCH_TIMEOUT_MS as HEAD_TIMEOUT_MS } from './v2Data';
import { avatarChar, employeeLabelById } from './identity';
import { useConsoleCrumbTail } from './Shell';
import { buildRunTrace, TERMINAL_TRACE_EVENT_TYPES, type RunStep, type TraceEvent } from './runTrace';
import {
  CopyText,
  EVENT_LABEL_KEYS,
  Field,
  LIVE_STATUSES,
  Panel,
  REASON_KEYS,
  RUN_STATUS_KEYS,
  STATUS_NOTE_KEYS,
  TERMINAL_STATUSES,
  durationMs,
  eventLagMs,
  fmtCap,
  fmtClock,
  fmtCost,
  fmtDuration,
  fmtGap,
  fmtMoment,
  fmtRatio,
  fmtMinuteFull,
  fullIso,
  payloadText,
  shortRef,
  shortRunId,
  shortUpstream,
  statusTone,
} from './runDetailKit';

import './runDetail.css';

/** Poll cadence for pending/running runs (spec §7). */
const POLL_MS = 2000;
/** Bounded backoff after n consecutive failures: 2→4→8→15→30s. */
const BACKOFF_SEC = [2, 4, 8, 15, 30];
/** R3 page size (BFF default 200, max 1000). */
const EVENTS_LIMIT = 200;
/** A pull lag above this is surfaced, never hidden (AGENTRUN §5.8). */
const STALE_LAG_MS = 30_000;

function backoffSec(failures: number): number {
  return BACKOFF_SEC[Math.min(Math.max(failures - 1, 0), BACKOFF_SEC.length - 1)];
}

type HeadView =
  | { kind: 'loading' }
  | { kind: 'ready'; run: Run; pulledAt: number }
  /* S4.5: error/forbidden carry the gateway request id when the BFF echoed
     one — the error screen prints it instead of 「未提供」. */
  | { kind: 'error'; status: number; rid?: string }
  | { kind: 'forbidden'; status: number; rid?: string };

type EventsView =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; items: RunEvent[]; hasMore: boolean }
  | { kind: 'error'; status: number };

export interface RunDetailPageProps {
  /** R2/R3 read-only adapter (injectable for tests, HTTP fallback on the page). */
  api?: AgentConsoleRunsApi;
  /** E11 only: employee names for the header and the summary field. */
  consoleApi?: AgentConsoleApi;
  /** Route param override (tests); defaults to `:runId`. */
  runIdOverride?: string;
}

export function RunDetailPage({ api, consoleApi, runIdOverride }: RunDetailPageProps = {}) {
  const { t } = useTranslation();
  const params = useParams();
  const navigate = useNavigate();
  const runId = runIdOverride ?? params.runId ?? '';
  const runs = useMemo(() => api ?? createHttpAgentConsoleRunsApi(), [api]);
  const employees = useMemo(() => consoleApi ?? createHttpAgentConsoleApi(), [consoleApi]);
  useConsoleCrumbTail(t('agentConsole.v2.run02.title'));

  const [head, setHead] = useState<HeadView>(() =>
    runId ? { kind: 'loading' } : { kind: 'error', status: 400 },
  );
  const [events, setEvents] = useState<EventsView>({ kind: 'idle' });
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [reloadToken, setReloadToken] = useState(0);
  const [failures, setFailures] = useState(0);
  const [failChannel, setFailChannel] = useState<'head' | 'events'>('events');
  const [docHidden, setDocHidden] = useState(false);
  const [pulse, setPulse] = useState(0);
  const [terminalSeen, setTerminalSeen] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const headEpoch = useRef(0);
  const eventsEpoch = useRef(0);
  const pollGuard = useRef(false);
  const cursorRef = useRef<number | null>(null);
  const lastSeqRef = useRef(0);
  const eventsStartedRef = useRef(false);
  const terminalHeadRef = useRef(false);
  const liveRef = useRef(false);

  const onAuth = useCallback(() => {
    window.location.assign('/');
  }, []);

  /* ---------- E11 employee names (cosmetic; failure degrades to raw id) ---------- */
  useEffect(() => {
    let live = true;
    employees
      .listEmployees({ limit: 100 })
      .then((res) => {
        if (!live || !res || !Array.isArray(res.items)) return;
        const map = new Map<string, string>();
        for (const e of res.items as EmployeeSummary[]) {
          if (e.employeeId && e.name) map.set(e.employeeId, e.name);
        }
        setNames(map);
      })
      .catch(() => {
        /* names degrade to the raw employeeId — never a fabricated name */
      });
    return () => {
      live = false;
    };
  }, [employees]);

  /* ---------- R2 head (initial load + full-page retry) ---------- */
  useEffect(() => {
    if (!runId) return undefined;
    const epoch = ++headEpoch.current;
    let live = true;
    eventsStartedRef.current = false;
    cursorRef.current = null;
    lastSeqRef.current = 0;
    terminalHeadRef.current = false;
    setEvents({ kind: 'idle' });
    setTerminalSeen(false);
    setFailures(0);
    setMoreError(false);
    setHead({ kind: 'loading' });
    /* S4: 10s cap on the R2 head — the error stage (with retry) replaces the
     * skeleton on expiry; a late answer still lands and wins. */
    const watchdog = window.setTimeout(() => {
      if (live && epoch === headEpoch.current) setHead({ kind: 'error', status: 0 });
    }, HEAD_TIMEOUT_MS);
    runs
      .getRunDetail({ id: runId })
      .then((res) => {
        window.clearTimeout(watchdog);
        if (!live || epoch !== headEpoch.current) return;
        if (res.ok && res.data) {
          setHead({ kind: 'ready', run: res.data, pulledAt: Date.now() });
        } else if (res.status === 403 || res.status === 404) {
          setHead({ kind: 'forbidden', status: res.status, rid: res.requestId });
        } else {
          setHead({ kind: 'error', status: res.status, rid: res.requestId });
        }
      })
      .catch((err: unknown) => {
        window.clearTimeout(watchdog);
        if (!live || epoch !== headEpoch.current) return;
        if (err instanceof AuthError) {
          onAuth();
          return;
        }
        setHead({ kind: 'error', status: 0, rid: (err as { requestId?: string }).requestId });
      });
    return () => {
      live = false;
      window.clearTimeout(watchdog);
    };
  }, [runs, runId, reloadToken, onAuth]);

  /* ---------- R3 initial page (only when the head says seq > 0) ---------- */
  const applyPage = useCallback((page: RunEventList) => {
    setEvents((prev) => {
      const base = prev.kind === 'ready' ? prev.items : [];
      const map = new Map<number, RunEvent>();
      for (const e of base) map.set(e.seq, e);
      for (const e of page.items) map.set(e.seq, e);
      const items = [...map.values()].sort((a, b) => a.seq - b.seq);
      const maxSeq = items.length > 0 ? items[items.length - 1].seq : 0;
      cursorRef.current = page.nextSeq ?? (maxSeq > 0 ? maxSeq : cursorRef.current);
      return { kind: 'ready', items, hasMore: page.hasMore };
    });
    if (page.items.some((e) => TERMINAL_TRACE_EVENT_TYPES.has(e.eventType))) {
      setTerminalSeen(true);
    }
  }, []);

  const fetchEvents = useCallback(
    async (mode: 'initial' | 'poll' | 'more'): Promise<boolean> => {
      if (!runId) return false;
      const epoch = ++eventsEpoch.current;
      if (mode === 'initial') {
        eventsStartedRef.current = true;
        setEvents({ kind: 'loading' });
      }
      if (mode === 'more') {
        setMoreBusy(true);
        setMoreError(false);
      }
      /* S4: same 10s cap as the head — an expired initial flips to the
       * honest events error strip; a late page still wins (dedup by seq). */
      const slow = window.setTimeout(() => {
        if (epoch !== eventsEpoch.current) return;
        if (mode === 'initial') setEvents({ kind: 'error', status: 0 });
        else if (mode === 'more') {
          setMoreError(true);
          setMoreBusy(false);
        }
      }, HEAD_TIMEOUT_MS);
      try {
        const res = await runs.listEvents({
          runId,
          sinceSeq: mode === 'initial' ? undefined : (cursorRef.current ?? undefined),
          limit: EVENTS_LIMIT,
        });
        // A late initial/more response from a previous id or an aborted view
        // is discarded instead of overwriting newer state (spec §7 取消).
        if (mode !== 'more' && epoch !== eventsEpoch.current) return false;
        if (res.ok && res.data) {
          applyPage(res.data);
          return true;
        }
        if (res.status === 401) {
          onAuth();
          return false;
        }
        if (mode === 'initial') setEvents({ kind: 'error', status: res.status });
        else if (mode === 'more') setMoreError(true);
        return false;
      } catch (err: unknown) {
        if (err instanceof AuthError) onAuth();
        if (mode === 'initial') setEvents({ kind: 'error', status: 0 });
        else if (mode === 'more') setMoreError(true);
        return false;
      } finally {
        window.clearTimeout(slow);
        if (mode === 'more') setMoreBusy(false);
      }
    },
    [runs, runId, applyPage, onAuth],
  );

  useEffect(() => {
    if (head.kind !== 'ready') return;
    lastSeqRef.current = head.run.lastEventSeq;
    if (head.run.lastEventSeq <= 0) {
      setEvents({ kind: 'idle' });
      return;
    }
    if (eventsStartedRef.current) return;
    void fetchEvents('initial');
  }, [head, fetchEvents]);

  /* ---------- R2 poll cycle (silent: never blanks a loaded page) ---------- */
  const pollCycle = useCallback(async (): Promise<{ headOk: boolean; evOk: boolean }> => {
    if (!runId || pollGuard.current) return { headOk: true, evOk: true };
    pollGuard.current = true;
    let headOk = true;
    let evOk = true;
    const epoch = ++headEpoch.current;
    try {
      const res = await runs.getRunDetail({ id: runId });
      if (epoch === headEpoch.current) {
        if (res.ok && res.data) {
          setHead({ kind: 'ready', run: res.data, pulledAt: Date.now() });
        } else if (res.status === 403 || res.status === 404) {
          setHead({ kind: 'forbidden', status: res.status });
          headOk = false;
        } else {
          headOk = false;
        }
      }
    } catch (err: unknown) {
      if (err instanceof AuthError) onAuth();
      headOk = false;
    }
    if (lastSeqRef.current > 0) {
      evOk = await fetchEvents('poll');
    }
    pollGuard.current = false;
    return { headOk, evOk };
  }, [runs, runId, fetchEvents, onAuth]);

  const headRun = head.kind === 'ready' ? head.run : null;
  const liveRun =
    headRun !== null && LIVE_STATUSES.has(headRun.status as RunStatus) && !terminalSeen;

  useEffect(() => {
    liveRef.current = liveRun;
  }, [liveRun]);

  /* 2s cadence with backoff; hidden tab pauses, visible catches up. */
  useEffect(() => {
    if (!liveRun || docHidden) return undefined;
    const delay = failures === 0 ? POLL_MS : backoffSec(failures) * 1000;
    const id = window.setTimeout(() => {
      void (async () => {
        const result = await pollCycle();
        const ok = result.headOk && result.evOk;
        setFailures((n) => (ok ? 0 : n + 1));
        if (!ok) setFailChannel(result.evOk ? 'head' : 'events');
        setPulse((p) => p + 1);
      })();
    }, delay);
    return () => window.clearTimeout(id);
  }, [liveRun, docHidden, failures, pulse, pollCycle]);

  useEffect(() => {
    const onVisibility = () => {
      const hidden = typeof document !== 'undefined' && document.hidden;
      setDocHidden(hidden);
      if (hidden || !liveRef.current) return;
      // Visible again: one immediate catch-up pull, then the cadence resumes.
      void (async () => {
        const result = await pollCycle();
        const ok = result.headOk && result.evOk;
        setFailures((n) => (ok ? 0 : n + 1));
        if (!ok) setFailChannel(result.evOk ? 'head' : 'events');
        setPulse((p) => p + 1);
      })();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [pollCycle]);

  /* Terminal event arrived: exactly one head refresh, then the poll stops. */
  useEffect(() => {
    if (!terminalSeen || terminalHeadRef.current || !runId) return;
    terminalHeadRef.current = true;
    runs
      .getRunDetail({ id: runId })
      .then((res) => {
        if (res.ok && res.data) setHead({ kind: 'ready', run: res.data, pulledAt: Date.now() });
      })
      .catch(() => {
        /* the event stream already gave us the terminal fact */
      });
  }, [terminalSeen, runId, runs]);

  /* Local timer for a live run (labelled non-upstream in the field note). */
  useEffect(() => {
    if (!liveRun) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [liveRun]);

  const refreshAll = useCallback(() => {
    if (!runId) return;
    setFailures(0);
    setFailChannel('events');
    const epoch = ++headEpoch.current;
    runs
      .getRunDetail({ id: runId })
      .then((res) => {
        if (epoch !== headEpoch.current) return;
        if (res.ok && res.data) {
          setHead({ kind: 'ready', run: res.data, pulledAt: Date.now() });
          if (!eventsStartedRef.current && res.data.lastEventSeq > 0) {
            void fetchEvents('initial');
          } else if (eventsStartedRef.current) {
            void fetchEvents('poll');
          }
        } else if (res.status === 403 || res.status === 404) {
          setHead({ kind: 'forbidden', status: res.status });
        }
      })
      .catch(() => {
        /* keep the last good head; the alert bar carries the stale note */
      });
  }, [runs, runId, fetchEvents]);

  const retryPolling = useCallback(() => {
    setFailures(0);
    void (async () => {
      const result = await pollCycle();
      if (!result.headOk || !result.evOk) setFailChannel(result.evOk ? 'head' : 'events');
      setPulse((p) => p + 1);
    })();
  }, [pollCycle]);

  const goBack = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) navigate(-1);
    else navigate('/agent/runs');
  }, [navigate]);

  const trace = useMemo(
    () => buildRunTrace(events.kind === 'ready' ? events.items : []),
    [events],
  );
  const rows = useMemo(() => buildRows(trace.events, trace.steps), [trace]);

  const latestEvent = events.kind === 'ready' && events.items.length > 0
    ? events.items[events.items.length - 1]
    : null;
  const latestLag = latestEvent ? eventLagMs(latestEvent) : null;
  const pollLost = liveRun && failures >= 3;
  const staleAlert = liveRun && !pollLost && latestLag !== null && latestLag > STALE_LAG_MS;

  /* ---------- state screens ---------- */

  if (head.kind === 'loading') {
    return <LoadingScreen note={t('agentConsole.v2.run02.loadingNote')} aria={t('agentConsole.v2.run02.loadingAria')} />;
  }

  if (head.kind === 'forbidden') {
    return (
      <div className="a2s-page">
        <div className="lk a2r" data-testid="agent-v2-run-detail">
          <StageCard
            icon="lock"
            title={t('agentConsole.v2.run02.forbiddenTitle')}
            desc={
              <>{t('agentConsole.v2.run02.forbiddenDescPre').replace(/（$/, '')}。{t('agentConsole.v2.run02.forbiddenDescPost').replace(/^）。/, '')}</>
            }
            testId="agent-v2-rd-forbidden"
          >
            <button
              type="button"
              className="b out"
              data-testid="agent-v2-rd-forbidden-retry"
              onClick={() => setReloadToken((n) => n + 1)}
            >
              <LkIcon name="refresh" size={16} />
              {t('agentConsole.v2.run02.forbiddenRetry')}
            </button>
            <Link className="lnk" to="/agent/runs" data-testid="agent-v2-rd-forbidden-back">
              {t('agentConsole.v2.run02.backToList')}
            </Link>
            {/* S4: this route exposes no request id — an explicit 「未提供」. */}
            <ReqId requestId={head.rid} testId="agent-v2-rd-forbidden-reqid" />
          </StageCard>
        </div>
      </div>
    );
  }

  if (head.kind === 'error') {
    const is400 = head.status === 400;
    const desc = is400 ? (
      <>{t('agentConsole.v2.run02.errorDesc400Pre').replace(/（$/, '')}。{t('agentConsole.v2.run02.errorDesc400Post').replace(/^）。/, '')}</>
    ) : (
      <>
        {head.status <= 0 ? `${t('agentConsole.v2.run02.errorNetworkCode')}。` : ''}
        {t('agentConsole.v2.run02.errorDescPost').replace(/^）。/, '')}
      </>
    );
    return (
      <div className="a2s-page">
        <div className="lk a2r" data-testid="agent-v2-run-detail">
          <StageCard
            icon="alert"
            title={t('agentConsole.v2.run02.errorTitle')}
            desc={desc}
            testId="agent-v2-rd-error"
          >
            {is400 ? (
              <Link className="b out" to="/agent/runs" data-testid="agent-v2-rd-error-back">
                {t('agentConsole.v2.run02.backToList')}
              </Link>
            ) : (
              <>
                <button
                  type="button"
                  className="b out"
                  data-testid="agent-v2-rd-error-retry"
                  onClick={() => setReloadToken((n) => n + 1)}
                >
                  <LkIcon name="refresh" size={16} />
                  {t('agentConsole.v2.run02.reload')}
                </button>
                <Link className="lnk" to="/agent/runs">
                  {t('agentConsole.v2.run02.backToListFirst')}
                </Link>
              </>
            )}
            <ReqId requestId={head.rid} testId="agent-v2-rd-error-reqid" />
          </StageCard>
        </div>
      </div>
    );
  }

  /* ---------- normal (head ready) ---------- */

  const run = head.run;
  const tone = statusTone(run.status);
  const statusKey = RUN_STATUS_KEYS[run.status as RunStatus];
  const statusLabel = statusKey ? t(statusKey) : run.status;
  if (!statusKey) console.error('[RUN-02] unknown run status:', run.status);
  const interrupted = run.status === 'interrupted';

  const duration = durationMs(run.startedAt, run.endedAt);
  const elapsedLive =
    duration === null && run.startedAt && liveRun
      ? Math.max(0, now - (Date.parse(run.startedAt) || now))
      : null;
  const versionNo = run.employeeVersionNo;
  const costUsd = run.costUsd;
  const costStatus = run.costStatus ?? null;
  const costMissing = costUsd === undefined || costUsd === null;
  const ratio = fmtRatio(costUsd, run.budgetCapUsd);
  const employeeName = names.get(run.employeeId);
  // S2: unresolved employee → 「员工 · 短码」, never a bare `emp_` id.
  const displayName = employeeLabelById(run.employeeId, names, t);
  const avaChar = avatarChar(employeeName);
  const attemptLabel =
    run.attemptNo === 1
      ? t('agentConsole.v2.run02.relAttemptFirst')
      : t('agentConsole.v2.run02.relAttemptValue', { n: run.attemptNo });

  const eventsCount = events.kind === 'ready' ? events.items.length : 0;
  const hasMore = events.kind === 'ready' && events.hasMore;
  const noEvents = events.kind === 'idle' || (events.kind === 'ready' && events.items.length === 0);

  return (
    <div className="a2s-page">
      <div className="lk a2r" data-testid="agent-v2-run-detail">
        <div className="a2r-backrow">
          <button
            type="button"
            className="b gh sm"
            data-testid="agent-v2-rd-back"
            aria-label={t('agentConsole.v2.run02.backToList')}
            onClick={goBack}
          >
            <LkIcon name="chevL" size={14} />
            {t('agentConsole.v2.run02.backToList')}
          </button>
        </div>

        <div className="phead">
          <div className="a2r-headmain">
            <h1 className="h1">
              <span
                className={`pill${tone ? ` ${tone}` : ''}`}
                title={statusKey ? t(STATUS_NOTE_KEYS[run.status as RunStatus]) : undefined}
                data-testid="agent-v2-rd-status"
              >
                <span className="dot" aria-hidden="true" />
                {statusLabel}
              </span>
              {t('agentConsole.v2.run02.title')}
            </h1>
            <div className="a2r-idline">
              <CopyId
                value={run.runId}
                display={shortRunId(run.runId)}
                ariaLabel={t('agentConsole.v2.run02.copyRunId')}
                copiedLabel={t('agentConsole.v2.run02.copied')}
                testId="agent-v2-rd-id"
              />
              <span className="micro">{t('agentConsole.v2.run02.runIdLabel')}</span>
            </div>
          </div>
          <span className="a2r-sp" aria-hidden="true" />
          <div className="a2r-acts">
            <button
              type="button"
              className="b gh"
              title={t('agentConsole.v2.run02.refreshTitle')}
              data-testid="agent-v2-rd-refresh"
              onClick={refreshAll}
            >
              <LkIcon name="refresh" size={16} />
              {t('agentConsole.v2.run02.refresh')}
            </button>
            <CopyText
              value={typeof window !== 'undefined' ? window.location.href : ''}
              label={t('agentConsole.v2.run02.copyLink')}
              aria={t('agentConsole.v2.run02.copyLinkTitle')}
              testId="agent-v2-rd-copy-link"
              className="b out"
            />
          </div>
        </div>

        <div className="fresh" data-testid="agent-v2-rd-fresh">
          <LkIcon name="clock" size={13} />
          <span aria-live="polite">
            {t('agentConsole.v2.run02.updated')}{' '}
            <span className="mono">{fmtClock(head.pulledAt)}</span>
          </span>
          <span className="faint" aria-hidden="true">
            ·
          </span>
          <span
            className={pollLost ? 'a2r-poll is-warn' : 'a2r-poll'}
            data-testid="agent-v2-rd-poll"
          >
            {pollLost
              ? t('agentConsole.v2.run02.pollRetrying', {
                  n: failures,
                  s: backoffSec(failures),
                })
              : liveRun
                ? t(
                    run.status === 'pending'
                      ? 'agentConsole.v2.run02.pollPending'
                      : 'agentConsole.v2.run02.pollRunning',
                  )
                : t('agentConsole.v2.run02.pollEnded')}
          </span>
          <span className="faint" aria-hidden="true">
            ·
          </span>
          <span>
            {t('agentConsole.v2.run02.seqRecorded')}{' '}
            <span className="mono" data-testid="agent-v2-rd-seq">
              {run.lastEventSeq}
            </span>
          </span>
          <span className="faint" aria-hidden="true">
            ·
          </span>
          <span>{t('agentConsole.v2.run02.sourceReadonly')}</span>
        </div>

        {pollLost ? (
          <div className="a2r-alert" role="status" aria-live="polite" data-testid="agent-v2-rd-alert">
            <LkIcon name="alert" size={18} />
            <span className="a2r-atx">
              {t(
                failChannel === 'head'
                  ? 'agentConsole.v2.run02.alertHead'
                  : 'agentConsole.v2.run02.alertEvents',
              )}
            </span>
            <span className="a2r-sp" />
            <button
              type="button"
              className="b sm out"
              data-testid="agent-v2-rd-alert-retry"
              onClick={retryPolling}
            >
              <LkIcon name="refresh" size={16} />
              {t('agentConsole.v2.run02.retryNow')}
            </button>
          </div>
        ) : null}

        {staleAlert ? (
          <div className="a2r-alert" role="status" aria-live="polite" data-testid="agent-v2-rd-stale">
            <LkIcon name="alert" size={18} />
            <span className="a2r-atx">
              {t('agentConsole.v2.run02.alertStale', {
                n: Math.round((latestLag ?? 0) / 1000),
                t: fmtClock(latestEvent?.pulledAt ?? null),
              })}
            </span>
            <span className="a2r-sp" />
            <button type="button" className="b sm out" onClick={retryPolling}>
              <LkIcon name="refresh" size={16} />
              {t('agentConsole.v2.run02.retryNow')}
            </button>
          </div>
        ) : null}

        <div className="card a2r-panel" data-testid="agent-v2-rd-summary">
          <div className="a2r-ch">
            <span className="a2r-cht">{t('agentConsole.v2.run02.summaryTitle')}</span>
            <span className="a2r-chc mono">R2</span>
            <span className="a2r-sp" />
            <span className="a2r-chn">{t('agentConsole.v2.run02.summaryNote')}</span>
          </div>
          <div className="a2r-hfs">
            <Field
              label={t('agentConsole.v2.run02.fStatus')}
              sans
              note={statusKey ? t(STATUS_NOTE_KEYS[run.status as RunStatus]) : undefined}
              testId="agent-v2-rd-f-status"
            >
              <span className={`pill${tone ? ` ${tone}` : ''}`}>
                <span className="dot" aria-hidden="true" />
                {statusLabel}
              </span>
            </Field>

            <Field
              label={t('agentConsole.v2.run02.fEmployee')}
              sans
              note={
                run.employeeId ? (
                  <Link
                    className="lnk"
                    to={`/agent/employees/${encodeURIComponent(run.employeeId)}`}
                    title={run.employeeId}
                  >
                    {t('agentConsole.v2.run02.employeeLink')}
                    <LkIcon name="chevR" size={13} />
                  </Link>
                ) : undefined
              }
              testId="agent-v2-rd-f-employee"
            >
              <span className="who" title={run.employeeId}>
                <span className="ava" aria-hidden="true">
                  {avaChar ?? <LkIcon name="users" size={12} />}
                </span>
                <span className="nm">{displayName}</span>
              </span>
            </Field>

            <Field
              label={t('agentConsole.v2.run02.fVersion')}
              note={t('agentConsole.v2.run02.versionNote')}
              testId="agent-v2-rd-f-version"
            >
              {versionNo === undefined || versionNo === null ? '—' : String(versionNo)}
            </Field>

            <Field
              label={t('agentConsole.v2.run02.fDuration')}
              note={
                duration !== null
                  ? t('agentConsole.v2.run02.durationRange', {
                      a: fmtClock(run.startedAt),
                      b: fmtClock(run.endedAt),
                    })
                  : elapsedLive !== null
                    ? t('agentConsole.v2.run02.durationLocalNote')
                    : !run.startedAt
                      ? t('agentConsole.v2.run02.notStarted')
                      : t('agentConsole.v2.run02.notEnded')
              }
              testId="agent-v2-rd-f-duration"
            >
              {duration !== null ? (
                fmtDuration(duration)
              ) : elapsedLive !== null ? (
                <>
                  {t('agentConsole.v2.run02.runningTimer')}{' '}
                  <span className="a2r-u">{fmtDuration(elapsedLive)}</span>
                </>
              ) : (
                <span className="faint">—</span>
              )}
            </Field>

            <Field
              label={t('agentConsole.v2.run02.fCost')}
              note={
                costStatus === 'unknown'
                  ? t('agentConsole.v2.run02.costNoteUnknown')
                  : costMissing
                    ? t('agentConsole.v2.run02.costNone')
                    : costStatus === 'estimated'
                      ? t('agentConsole.v2.run02.costNoteEstimated')
                      : costStatus === 'mixed'
                        ? t('agentConsole.v2.run02.costNoteMixed')
                        : costStatus === 'upstream'
                          ? t('agentConsole.v2.run02.costNoteUpstream')
                          : t('agentConsole.v2.run02.costNoteNoStatus')
              }
              testId="agent-v2-rd-f-cost"
            >
              {costStatus === 'unknown' ? (
                <span className="a2r-unk" title={t('agentConsole.v2.run02.costNoteUnknown')}>
                  —
                </span>
              ) : costMissing ? (
                <span className="faint">—</span>
              ) : (
                <>
                  {fmtCost(costUsd)}
                  {costStatus === 'upstream' ? (
                    <span className="pill ok xs" data-testid="agent-v2-rd-cost-status">
                      <span className="dot" aria-hidden="true" />
                      {t('agentConsole.v2.run02.costPillUpstream')}
                    </span>
                  ) : costStatus === 'estimated' || costStatus === 'mixed' ? (
                    <span className="pill est xs" data-testid="agent-v2-rd-cost-status">
                      <span className="dash" aria-hidden="true">
                        –
                      </span>
                      {t(
                        costStatus === 'mixed'
                          ? 'agentConsole.v2.run02.costPillMixed'
                          : 'agentConsole.v2.run02.costPillEstimated',
                      )}
                    </span>
                  ) : null}
                </>
              )}
            </Field>

            <Field
              label={t('agentConsole.v2.run02.fCap')}
              note={
                ratio !== null
                  ? t('agentConsole.v2.run02.capNoteRatio', { pct: ratio })
                  : typeof run.budgetCapUsd === 'number'
                    ? t('agentConsole.v2.run02.capNoteNoRatio')
                    : t('agentConsole.v2.run02.capNone')
              }
              testId="agent-v2-rd-f-cap"
            >
              {typeof run.budgetCapUsd === 'number' ? (
                fmtCap(run.budgetCapUsd)
              ) : (
                <span className="faint">—</span>
              )}
            </Field>

            <Field
              label={t('agentConsole.v2.run02.fStart')}
              note={t('agentConsole.v2.run02.startNote')}
              title={fullIso(run.startedAt)}
              testId="agent-v2-rd-f-start"
            >
              {run.startedAt ? fmtMoment(run.startedAt) : <span className="faint">—</span>}
            </Field>

            <Field
              label={t('agentConsole.v2.run02.fEnd')}
              note={run.endedAt ? t('agentConsole.v2.run02.endNote') : t('agentConsole.v2.run02.notEnded')}
              title={fullIso(run.endedAt)}
              testId="agent-v2-rd-f-end"
            >
              {run.endedAt ? fmtMoment(run.endedAt) : <span className="faint">—</span>}
            </Field>

            <div className="a2r-hf wide" data-testid="agent-v2-rd-gov">
              <div className="a2r-fl micro">{t('agentConsole.v2.run02.govTitle')}</div>
              <div className="a2r-grows">
                <div className="a2r-grow">
                  <span className="a2r-gk">{t('agentConsole.v2.run02.govRunId')}</span>
                  <CopyId
                    value={run.runId}
                    display={shortRunId(run.runId)}
                    ariaLabel={t('agentConsole.v2.run02.copyRunId')}
                    copiedLabel={t('agentConsole.v2.run02.copied')}
                    testId="agent-v2-rd-gov-runid"
                  />
                  <span className="a2r-sp" />
                  <span className="a2r-chn">{t('agentConsole.v2.run02.govRunIdNote')}</span>
                </div>
                <div className="a2r-grow">
                  <span className="a2r-gk">{t('agentConsole.v2.run02.govUpstream')}</span>
                  {run.upstreamRunId ? (
                    <CopyId
                      value={run.upstreamRunId}
                      display={shortUpstream(run.upstreamRunId)}
                      ariaLabel={t('agentConsole.v2.run02.copyUpstream')}
                      copiedLabel={t('agentConsole.v2.run02.copied')}
                      testId="agent-v2-rd-gov-upstream"
                    />
                  ) : (
                    <span className="faint mono">—</span>
                  )}
                  <span className="a2r-sp" />
                  <span className="a2r-chn">{t('agentConsole.v2.run02.govUpstreamNote')}</span>
                </div>
                <div className="a2r-grow">
                  <span className="a2r-gk">{t('agentConsole.v2.run02.govSnapshot')}</span>
                  {run.policySnapshotRef ? (
                    <CopyId
                      value={run.policySnapshotRef}
                      display={shortRef(run.policySnapshotRef)}
                      ariaLabel={t('agentConsole.v2.run02.copySnapshot')}
                      copiedLabel={t('agentConsole.v2.run02.copied')}
                      testId="agent-v2-rd-gov-snapshot"
                    />
                  ) : (
                    <span className="faint mono">—</span>
                  )}
                  <span className="a2r-sp" />
                  <span className="a2r-chn">{t('agentConsole.v2.run02.govSnapshotNote')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="a2r-split">
          <div className="a2r-stack">
            <Panel
              title={t('agentConsole.v2.run02.traceTitle')}
              count={
                events.kind === 'ready'
                  ? t('agentConsole.v2.run02.traceCount', {
                      n: eventsCount,
                      m: trace.steps.length,
                    })
                  : undefined
              }
              note={t('agentConsole.v2.run02.traceHeadNote')}
              foot={
                noEvents
                  ? null
                  : (
                    <>
                      <div className="a2r-legend">
                        <span className="a2r-lg">
                          <LkIcon name="check" size={13} />
                          {t('agentConsole.v2.run02.legendPaired')}
                        </span>
                        <span className="a2r-lg">
                          <LkIcon name="clock" size={13} />
                          {t('agentConsole.v2.run02.legendPending')}
                        </span>
                        <span className="a2r-lg">
                          <LkIcon name="alert" size={13} />
                          {t('agentConsole.v2.run02.legendAnomaly')}
                        </span>
                        <span className="a2r-sp" />
                        <span className="a2r-lg">{t('agentConsole.v2.run02.legendGap')}</span>
                      </div>
                      <div className="rule" />
                      <div className="a2r-cf mono-note">{t('agentConsole.v2.run02.traceFoot')}</div>
                    </>
                  )
              }
              testId="agent-v2-rd-trace"
            >
              {events.kind === 'loading' ? (
                <div className="a2r-skrows" aria-hidden="true">
                  {[62, 48, 70, 54, 66, 44].map((w, i) => (
                    <div className="a2r-skrow" key={i}>
                      <span className="a2r-sk" style={{ width: 6, height: 6 }} />
                      <span className={`a2r-sk w${w}`} />
                      <span className="a2r-sp" />
                      <span className="a2r-sk" style={{ width: 110 }} />
                    </div>
                  ))}
                </div>
              ) : events.kind === 'error' ? (
                <div className="a2r-inerr" data-testid="agent-v2-rd-events-error">
                  <span className="a2r-ic" aria-hidden="true">
                    <LkIcon name="alert" size={20} />
                  </span>
                  <div className="a2r-it">{t('agentConsole.v2.run02.eventsErrorTitle')}</div>
                  <div className="a2r-is">{t('agentConsole.v2.run02.eventsErrorDesc')}</div>
                  <button
                    type="button"
                    className="b out"
                    data-testid="agent-v2-rd-events-retry"
                    onClick={() => void fetchEvents('initial')}
                  >
                    <LkIcon name="refresh" size={16} />
                    {t('agentConsole.v2.run02.refetch')}
                  </button>
                </div>
              ) : noEvents ? (
                <div className="a2r-empty" data-testid="agent-v2-rd-empty">
                  <span className="a2r-ic" aria-hidden="true">
                    <LkIcon name="inbox" size={20} />
                  </span>
                  <div className="a2r-it">{t('agentConsole.v2.run02.emptyTitle')}</div>
                  <div className="a2r-is">{t('agentConsole.v2.run02.emptyDesc')}</div>
                  <button
                    type="button"
                    className="b out"
                    data-testid="agent-v2-rd-empty-retry"
                    onClick={refreshAll}
                  >
                    <LkIcon name="refresh" size={16} />
                    {t('agentConsole.v2.run02.refetch')}
                  </button>
                </div>
              ) : (
                <>
                  <div className="a2r-trlist">
                    {rows.map((row) =>
                      row.step ? (
                        <StepRowView key={row.key} step={row.step} gapMs={row.gapMs} t={t} />
                      ) : row.event ? (
                        <EventRowView key={row.key} event={row.event} gapMs={row.gapMs} t={t} />
                      ) : null,
                    )}
                  </div>
                  {hasMore ? (
                    <div className="a2r-more">
                      {moreError ? (
                        <span className="a2r-moreerr" role="status">
                          {t('agentConsole.v2.run02.moreError')}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="b out"
                        data-testid="agent-v2-rd-more"
                        disabled={moreBusy}
                        aria-busy={moreBusy}
                        onClick={() => void fetchEvents('more')}
                      >
                        <LkIcon name="chevD" size={16} />
                        {moreBusy
                          ? t('agentConsole.v2.run02.moreLoading')
                          : moreError
                            ? t('agentConsole.v2.run02.moreRetry')
                            : t('agentConsole.v2.run02.more')}
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </Panel>
          </div>

          <div className="a2r-stack">
            <Panel
              title={t('agentConsole.v2.run02.relTitle')}
              foot={t('agentConsole.v2.run02.relFoot')}
              testId="agent-v2-rd-rel"
            >
              <div className="a2r-rows">
                <KVRow k={t('agentConsole.v2.run02.relSource')}>
                  {run.channelEventId ? (
                    <>
                      <LkIcon name="msg" size={13} />
                      <CopyId
                        value={run.channelEventId}
                        display={shortRef(run.channelEventId)}
                        ariaLabel={t('agentConsole.v2.run02.copySource')}
                        copiedLabel={t('agentConsole.v2.run02.copied')}
                        testId="agent-v2-rd-source"
                      />
                    </>
                  ) : (
                    <span
                      className="faint mono"
                      title={t('agentConsole.v2.run02.relSourceNoneTitle')}
                      data-testid="agent-v2-rd-source"
                    >
                      —
                    </span>
                  )}
                </KVRow>
                <KVRow k={t('agentConsole.v2.run02.relTask')}>
                  {run.taskId ? (
                    <>
                      <CopyId
                        value={run.taskId}
                        display={shortRef(run.taskId)}
                        ariaLabel={t('agentConsole.v2.run02.copyTask')}
                        copiedLabel={t('agentConsole.v2.run02.copied')}
                        testId="agent-v2-rd-task"
                      />
                      {/* S3: TSK-02 is live — real navigation, no dead shell. */}
                      <a
                        className="b xs out"
                        href={`/agent/tasks/${encodeURIComponent(run.taskId)}`}
                        data-testid="agent-v2-rd-task-view"
                      >
                        {t('agentConsole.v2.run02.relTaskView')}
                      </a>
                    </>
                  ) : (
                    <span className="faint mono" data-testid="agent-v2-rd-task">
                      —
                    </span>
                  )}
                </KVRow>
                {run.previousRunId ? (
                  <KVRow k={t('agentConsole.v2.run02.relPrev')}>
                    <CopyId
                      value={run.previousRunId}
                      display={shortRunId(run.previousRunId)}
                      ariaLabel={t('agentConsole.v2.run02.copyPrev')}
                      copiedLabel={t('agentConsole.v2.run02.copied')}
                      testId="agent-v2-rd-prev-id"
                    />
                    <Link
                      className="lnk"
                      to={`/agent/runs/${encodeURIComponent(run.previousRunId)}`}
                      data-testid="agent-v2-rd-prev"
                    >
                      {t('agentConsole.v2.run02.relPrevView')}
                      <LkIcon name="chevR" size={13} />
                    </Link>
                  </KVRow>
                ) : null}
                <KVRow k={t('agentConsole.v2.run02.relAttempt')}>
                  <span className="mono">{attemptLabel}</span>
                  <span className="a2r-chn">{t('agentConsole.v2.run02.relAttemptNote')}</span>
                </KVRow>
                <KVRow k={t('agentConsole.v2.run02.relAudit')}>
                  <Link
                    className="lnk"
                    to={`/agent/audit?runId=${encodeURIComponent(run.runId)}`}
                    data-testid="agent-v2-rd-audit"
                  >
                    {t('agentConsole.v2.run02.relAuditLink')}
                    <LkIcon name="chevR" size={13} />
                  </Link>
                </KVRow>
                <KVRow k={t('agentConsole.v2.run02.relTimes')}>
                  <span className="mono" title={fullIso(run.createdAt)}>
                    {fmtClock(run.createdAt)} {t('agentConsole.v2.run02.relCreated')}
                  </span>
                  <span className="a2r-chn" aria-hidden="true">
                    ·
                  </span>
                  <span className="mono" title={fullIso(run.updatedAt)}>
                    {fmtClock(run.updatedAt)} {t('agentConsole.v2.run02.relUpdated')}
                  </span>
                </KVRow>
              </div>
            </Panel>

            <Panel
              title={t('agentConsole.v2.run02.smTitle')}
              note={t('agentConsole.v2.run02.smReadonly')}
              foot={t('agentConsole.v2.run02.smFoot')}
              testId="agent-v2-rd-sm"
            >
              <StateMachine status={run.status} label={statusLabel} t={t} />
              <div className="rule" />
              <div className="a2r-rows">
                {run.reasonCode ? (
                  <KVRow k={t('agentConsole.v2.run02.reasonLabel')}>
                    <span data-testid="agent-v2-rd-reason">
                      {REASON_KEYS[run.reasonCode]
                        ? t(REASON_KEYS[run.reasonCode])
                        : t('agentConsole.v2.run02.reasonUnknown')}
                    </span>
                  </KVRow>
                ) : null}
                <KVRow k={t('agentConsole.v2.run02.interruptLabel')}>
                  <span
                    className="a2r-wrap"
                    data-testid="agent-v2-rd-interrupt"
                    data-interrupted={interrupted ? 'true' : 'false'}
                  >
                    {t('agentConsole.v2.run02.interruptNote')}
                  </span>
                </KVRow>
              </div>
            </Panel>

            <Panel
              title={t('agentConsole.v2.run02.calTitle')}
              foot={t('agentConsole.v2.run02.calFoot', {
                cost: costMissing ? '—' : fmtCost(costUsd),
                cap: typeof run.budgetCapUsd === 'number' ? fmtCap(run.budgetCapUsd) : '—',
                ratio: ratio ?? '—',
              })}
              testId="agent-v2-rd-caliber"
            >
              <div className="a2r-rows">
                <KVRow
                  k={
                    <span className="pill ok xs">
                      <span className="dot" aria-hidden="true" />
                      {t('agentConsole.v2.run02.calUpstream')}
                    </span>
                  }
                >
                  <span className="a2r-wrap">{t('agentConsole.v2.run02.calUpstreamDesc')}</span>
                </KVRow>
                <KVRow
                  k={
                    <span className="pill est xs">
                      <span className="dash" aria-hidden="true">
                        –
                      </span>
                      {t('agentConsole.v2.run02.calEstimated')}
                    </span>
                  }
                >
                  <span className="a2r-wrap">{t('agentConsole.v2.run02.calEstimatedDesc')}</span>
                </KVRow>
                <KVRow k={<span className="mono a2r-raw">—</span>}>
                  <span className="a2r-wrap">{t('agentConsole.v2.run02.calUnknownDesc')}</span>
                </KVRow>
              </div>
            </Panel>
          </div>
        </div>

        <div className="pfoot">
          <span>{t('agentConsole.v2.run02.footSource')}</span>
          <span className="sp" aria-hidden="true" />
          <span>{t('agentConsole.v2.run02.footCaliber')}</span>
          <span className="sp" aria-hidden="true" />
          <span>{t('agentConsole.v2.run02.footReadonly')}</span>
        </div>
      </div>
    </div>
  );
}

/* ================= trace row models ================= */

interface TraceRowModel {
  key: string;
  anchorSeq: number;
  gapMs: number | null;
  step?: RunStep;
  event?: TraceEvent;
}

function buildRows(events: TraceEvent[], steps: RunStep[]): TraceRowModel[] {
  const bySeq = new Map<number, TraceEvent>();
  for (const e of events) bySeq.set(e.seq, e);
  const sortedSeqs = events.map((e) => e.seq);

  const gapAt = (anchorSeq: number): number | null => {
    const anchor = bySeq.get(anchorSeq);
    if (!anchor) return null;
    const idx = sortedSeqs.indexOf(anchorSeq);
    if (idx <= 0) return null;
    const prev = bySeq.get(sortedSeqs[idx - 1]);
    if (!prev) return null;
    const a = Date.parse(prev.occurredAt);
    const b = Date.parse(anchor.occurredAt);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
    return b - a;
  };

  const rendered = new Set<number>();
  const rows: TraceRowModel[] = [];
  for (const step of steps) {
    rendered.add(step.callEvent.seq);
    if (step.resultEvent) rendered.add(step.resultEvent.seq);
    const anchorSeq = step.resultSeq ?? step.callEvent.seq;
    rows.push({ key: `step:${step.callEvent.seq}`, anchorSeq, gapMs: gapAt(anchorSeq), step });
  }
  for (const event of events) {
    if (rendered.has(event.seq)) continue;
    rows.push({ key: `ev:${event.seq}`, anchorSeq: event.seq, gapMs: gapAt(event.seq), event });
  }
  rows.sort((a, b) => a.anchorSeq - b.anchorSeq);
  return rows;
}

/* ================= trace row views ================= */

interface RowIcons {
  icon: string;
  tone: '' | 'ok' | 'wr' | 'dg' | 'ac';
  pill?: { cls: string; text: string };
}

function eventShape(event: TraceEvent, t: TFunction): RowIcons {
  if (event.postTerminal) {
    return {
      icon: 'tool',
      tone: 'wr',
      pill: { cls: 'wr', text: t('agentConsole.v2.run02.postTerminal') },
    };
  }
  if (!event.parsed) {
    return {
      icon: 'tool',
      tone: 'dg',
      pill: { cls: 'dg', text: t('agentConsole.v2.run02.badPayload') },
    };
  }
  if (event.anomaly === 'orphan-result') {
    return {
      icon: 'tool',
      tone: 'dg',
      pill: { cls: 'dg', text: t('agentConsole.v2.run02.anomalyOrphan') },
    };
  }
  if (TERMINAL_TRACE_EVENT_TYPES.has(event.eventType)) {
    const ok = event.eventType === 'completed';
    return {
      icon: ok ? 'check' : 'alert',
      tone: ok ? 'ok' : 'dg',
      pill: { cls: ok ? 'ok' : 'dg', text: t('agentConsole.v2.run02.terminal') },
    };
  }
  if (event.eventType.startsWith('approval_')) {
    return {
      icon: 'clip',
      tone: 'ac',
      pill: { cls: 'ac', text: t('agentConsole.v2.run02.flowEvent') },
    };
  }
  const toolLike = event.eventType === 'tool_call' || event.eventType === 'tool_result';
  const toolName = event.payload ? String(event.payload.toolName ?? '') : '';
  if (toolLike && toolName === '') {
    return {
      icon: 'tool',
      tone: 'wr',
      pill: { cls: 'wr', text: t('agentConsole.v2.run02.missingTool') },
    };
  }
  if (!EVENT_LABEL_KEYS[event.eventType]) {
    return {
      icon: toolLike ? 'tool' : 'msg',
      tone: 'wr',
      pill: { cls: 'nt', text: t('agentConsole.v2.run02.unknownEvent') },
    };
  }
  return {
    icon: toolLike ? 'tool' : 'msg',
    tone: '',
  };
}

function lagOf(event: TraceEvent): number | null {
  const lag = eventLagMs(event);
  return lag !== null && lag > STALE_LAG_MS ? lag : null;
}

function StepRowView({ step, gapMs, t }: { step: RunStep; gapMs: number | null; t: TFunction }) {
  const duplicate = step.anomaly === 'duplicate-call';
  const rawStepSeq = step.callEvent.payload ? step.callEvent.payload.stepSeq : undefined;
  const fellBack = !(Number.isInteger(rawStepSeq) && rawStepSeq !== 0);
  const settled = step.state === 'settled';
  const state: 'settled' | 'duplicate' | 'pending' = duplicate
    ? 'duplicate'
    : settled
      ? 'settled'
      : 'pending';
  const tone = duplicate ? 'dg' : settled ? 'ok' : 'wr';
  const pairText = duplicate
    ? t('agentConsole.v2.run02.anomalyDuplicate')
    : settled
      ? t('agentConsole.v2.run02.pairSettled')
      : t('agentConsole.v2.run02.pairPending');
  const gap = fmtGap(gapMs);
  const callLag = lagOf(step.callEvent);

  const verdict = duplicate
    ? t('agentConsole.v2.run02.belongDup')
    : settled
      ? t('agentConsole.v2.run02.belongStepSettled')
      : t('agentConsole.v2.run02.belongStepPending');

  return (
    <details className="a2r-node" data-testid="agent-v2-rd-row" data-kind="step" data-state={state}>
      <summary className="a2r-row">
        <span className="a2r-chev" aria-hidden="true">
          <LkIcon name="chevR" size={14} />
        </span>
        <span className={`a2r-sd ${tone}`} aria-hidden="true" />
        <LkIcon name="tool" size={14} />
        <span className="a2r-nm mono">{step.toolName}</span>
        <span className={`pill ${tone} xs`} data-testid="agent-v2-rd-pair">
          <span className="dot" aria-hidden="true" />
          {pairText}
        </span>
        {callLag !== null ? (
          <span className="pill wr xs" title={t('agentConsole.v2.run02.lagTitle')}>
            <span className="dot" aria-hidden="true" />
            {t('agentConsole.v2.run02.lagPill', { s: (callLag / 1000).toFixed(1) })}
          </span>
        ) : null}
        <span className="a2r-sp" />
        <span className="a2r-sq mono">
          {t('agentConsole.v2.run02.seqCallResult', {
            a: step.callEvent.seq,
            b: step.resultSeq ?? '—',
          })}
        </span>
        {gap ? (
          <span className="a2r-gap mono" title={t('agentConsole.v2.run02.gapTitle')}>
            {gap}
          </span>
        ) : null}
      </summary>
      <div className="a2r-dtl">
        <KV k={t('agentConsole.v2.run02.kvTool')} v={step.toolName} mono />
        <KV k={t('agentConsole.v2.run02.kvStepSeq')} v={String(step.stepSeq)} mono />
        <KV
          k={t('agentConsole.v2.run02.kvCall')}
          v={`seq ${step.callEvent.seq} · ${fmtMinuteFull(step.callEvent.occurredAt)}`}
          mono
        />
        <KV
          k={t('agentConsole.v2.run02.kvResult')}
          v={
            step.resultEvent
              ? `seq ${step.resultEvent.seq} · ${fmtMinuteFull(step.resultEvent.occurredAt)}`
              : '—'
          }
          mono
        />
        <KV
          k={t('agentConsole.v2.run02.kvGapCaliber')}
          v={
            gap
              ? t('agentConsole.v2.run02.gapCaliber', { s: (gapMs ?? 0) / 1000 })
              : t('agentConsole.v2.run02.gapNone')
          }
          sans
        />
        <KV k={t('agentConsole.v2.run02.kvStepCost')} v={t('agentConsole.v2.run02.stepCostNone')} sans />
        <KV k={t('agentConsole.v2.run02.kvVerdict')} v={verdict} sans />
        {duplicate ? <KV k={t('agentConsole.v2.run02.kvKeep')} v={t('agentConsole.v2.run02.keepEarly')} sans /> : null}
        {fellBack ? (
          <KV
            k={t('agentConsole.v2.run02.kvStepFallback')}
            v={t('agentConsole.v2.run02.stepFallback', {
              raw: rawStepSeq === undefined ? '—' : String(rawStepSeq),
              seq: step.callEvent.seq,
            })}
            sans
          />
        ) : null}
        <PayloadBlock
          label={t('agentConsole.v2.run02.payloadCall', { n: step.callEvent.seq })}
          event={step.callEvent}
        />
        {step.resultEvent ? (
          <PayloadBlock
            label={t('agentConsole.v2.run02.payloadResult', { n: step.resultEvent.seq })}
            event={step.resultEvent}
          />
        ) : null}
        <p className="a2r-hint">{t('agentConsole.v2.run02.riskNote')}</p>
      </div>
    </details>
  );
}

function EventRowView({ event, gapMs, t }: { event: TraceEvent; gapMs: number | null; t: TFunction }) {
  const shape = eventShape(event, t);
  const gap = fmtGap(gapMs);
  const lag = lagOf(event);
  const label = EVENT_LABEL_KEYS[event.eventType]
    ? t(EVENT_LABEL_KEYS[event.eventType])
    : event.eventType;
  const toolName = event.payload ? String(event.payload.toolName ?? '') : '';
  const name = toolName !== '' ? toolName : label;

  const verdict = event.postTerminal
    ? t('agentConsole.v2.run02.belongPostTerminal')
    : !event.parsed
      ? t('agentConsole.v2.run02.belongBad')
      : event.anomaly === 'orphan-result'
        ? t('agentConsole.v2.run02.belongOrphan')
        : TERMINAL_TRACE_EVENT_TYPES.has(event.eventType)
          ? t('agentConsole.v2.run02.belongTerminal')
          : event.eventType.startsWith('approval_')
            ? t('agentConsole.v2.run02.belongApproval')
            : (event.eventType === 'tool_call' || event.eventType === 'tool_result') && toolName === ''
              ? t('agentConsole.v2.run02.belongMissingTool')
              : EVENT_LABEL_KEYS[event.eventType]
                ? t('agentConsole.v2.run02.belongFlow')
                : t('agentConsole.v2.run02.belongUnknown');

  return (
    <details className="a2r-node" data-testid="agent-v2-rd-row" data-kind="event">
      <summary className="a2r-row">
        <span className="a2r-chev" aria-hidden="true">
          <LkIcon name="chevR" size={14} />
        </span>
        <span className={`a2r-sd ${shape.tone === 'ac' ? 'ac' : shape.tone}`} aria-hidden="true" />
        <LkIcon name={shape.icon} size={14} />
        <span className={`a2r-nm${toolName ? ' mono' : ' a2r-et'}`}>{name}</span>
        {shape.pill ? (
          <span className={`pill ${shape.pill.cls} xs`} data-testid="agent-v2-rd-badge">
            <span className="dot" aria-hidden="true" />
            {shape.pill.text}
          </span>
        ) : null}
        {lag !== null ? (
          <span className="pill wr xs" title={t('agentConsole.v2.run02.lagTitle')}>
            <span className="dot" aria-hidden="true" />
            {t('agentConsole.v2.run02.lagPill', { s: (lag / 1000).toFixed(1) })}
          </span>
        ) : null}
        <span className="a2r-sp" />
        <span className="a2r-sq mono">
          {event.anomaly === 'orphan-result'
            ? t('agentConsole.v2.run02.seqResultOnly', { a: event.seq })
            : t('agentConsole.v2.run02.seqOnly', { n: event.seq })}
        </span>
        {gap ? (
          <span className="a2r-gap mono" title={t('agentConsole.v2.run02.gapTitle')}>
            {gap}
          </span>
        ) : null}
      </summary>
      <div className="a2r-dtl">
        <KV
          k={t('agentConsole.v2.run02.kvType')}
          v={
            <>
              {EVENT_LABEL_KEYS[event.eventType] ? label : event.eventType}{' '}
              <span className="mono a2r-raw">{event.eventType}</span>
              {EVENT_LABEL_KEYS[event.eventType] ? null : (
                <span className="a2r-raw"> · {t('agentConsole.v2.run02.unknownEvent')}</span>
              )}
            </>
          }
          sans
        />
        <KV k={t('agentConsole.v2.run02.kvOccurred')} v={fmtMinuteFull(event.occurredAt)} mono title={fullIso(event.occurredAt)} />
        <KV k={t('agentConsole.v2.run02.kvPulled')} v={fmtMinuteFull(event.pulledAt)} mono title={fullIso(event.pulledAt)} />
        <KV
          k={t('agentConsole.v2.run02.kvLag')}
          v={
            eventLagMs(event) === null
              ? '—'
              : `${((eventLagMs(event) ?? 0) / 1000).toFixed(1)}s`
          }
          mono
        />
        <KV k={t('agentConsole.v2.run02.kvBelong')} v={verdict} sans />
        {event.stepSeq !== undefined ? (
          <KV k={t('agentConsole.v2.run02.kvStepSeq')} v={String(event.stepSeq)} mono />
        ) : null}
        {TERMINAL_TRACE_EVENT_TYPES.has(event.eventType) ? (
          <KV k={t('agentConsole.v2.run02.kvTerminalSeq')} v={`terminalSeq = ${event.seq}`} mono />
        ) : null}
        {event.eventType.startsWith('approval_') ? (
          <KV k={t('agentConsole.v2.run02.kvApprovalLink')} v={t('agentConsole.v2.run02.approvalNoLink')} sans />
        ) : null}
        <PayloadBlock label={t('agentConsole.v2.run02.payloadRaw')} event={event} />
      </div>
    </details>
  );
}

function PayloadBlock({ label, event }: { label: string; event: TraceEvent }) {
  const { t } = useTranslation();
  const text = payloadText(event);
  return (
    <div className="a2r-pay">
      <div className="a2r-payh">
        <span>{label}</span>
        <span className="a2r-sp" />
        <CopyText
          value={text}
          label={t('agentConsole.v2.run02.copyJson')}
          aria={t('agentConsole.v2.run02.copyJsonAria')}
          testId="agent-v2-rd-copy-json"
        />
      </div>
      <pre className="a2r-json">{text}</pre>
    </div>
  );
}

function KV({
  k,
  v,
  mono,
  sans,
  title,
}: {
  k: ReactNode;
  v: ReactNode;
  mono?: boolean;
  sans?: boolean;
  title?: string;
}) {
  return (
    <div className="a2r-kv">
      <span className="a2r-kkv">{k}</span>
      <span className={`a2r-kvv${mono ? ' mono' : ''}${sans ? ' sans' : ''}`} title={title}>
        {v}
      </span>
    </div>
  );
}

function KVRow({ k, children }: { k: ReactNode; children: ReactNode }) {
  return (
    <div className="a2r-row2">
      <span className="a2r-k2">{k}</span>
      <span className="a2r-v2">{children}</span>
    </div>
  );
}

function StateMachine({
  status,
  label,
  t,
}: {
  status: string;
  label: string;
  t: TFunction;
}) {
  const terminal = TERMINAL_STATUSES.has(status as RunStatus);
  const running = status === 'running';
  const pending = status === 'pending';
  const nodes: Array<{ key: string; text: string; cls: string; marker: ReactNode }> = [
    {
      key: 'pending',
      text: t(RUN_STATUS_KEYS.pending),
      cls: pending ? 'cur' : running || terminal ? 'done' : '',
      marker: pending ? '1' : running || terminal ? <LkIcon name="check" size={13} /> : '',
    },
    {
      key: 'running',
      text: t(RUN_STATUS_KEYS.running),
      cls: running ? 'cur' : terminal ? 'done' : '',
      marker: running ? '2' : terminal ? <LkIcon name="check" size={13} /> : '',
    },
  ];
  if (terminal) {
    nodes.push({ key: 'terminal', text: label, cls: 'cur', marker: '3' });
  }

  return (
    <div data-testid="agent-v2-rd-sm-nodes">
      <div
        className="a2r-sm"
        role="img"
        aria-label={t('agentConsole.v2.run02.smAria', { s: label })}
      >
        {nodes.map((node, index) => (
          <Fragment key={node.key}>
            {index > 0 ? (
              <span className={`a2r-sma${running || terminal ? ' ac' : ''}`} aria-hidden="true" />
            ) : null}
            <span className={`a2r-smn${node.cls ? ` ${node.cls}` : ''}`}>
              <span className="a2r-smc">{node.marker}</span>
              <span className="a2r-sml">{node.text}</span>
            </span>
          </Fragment>
        ))}
      </div>
      <div className="a2r-smterms">
        {(['completed', 'failed', 'cancelled', 'interrupted'] as RunStatus[]).map((s) => {
          const on = status === s;
          return (
            <div className={`a2r-smterm${on ? ' on' : ''}`} key={s}>
              <span className="a2r-smc2" aria-hidden="true">
                {on ? <LkIcon name="check" size={13} /> : null}
              </span>
              {on
                ? t('agentConsole.v2.run02.smCurrentTerminal', { s: t(RUN_STATUS_KEYS[s]) })
                : t(RUN_STATUS_KEYS[s])}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LoadingScreen({ note, aria }: { note: string; aria: string }) {
  return (
    <div className="a2s-page">
      <div className="lk a2r" data-testid="agent-v2-rd-loading" role="status" aria-label={aria}>
        <div className="a2r-backrow">
          <span className="a2r-sk" style={{ width: 120, height: 32 }} />
        </div>
        <div className="phead">
          <div className="a2r-headmain">
            <span className="a2r-sk" style={{ width: 220, height: 30 }} />
            <span className="a2r-sk" style={{ width: 180, height: 12 }} />
          </div>
          <span className="a2r-sp" />
          <span className="a2r-sk" style={{ width: 190, height: 32 }} />
        </div>
        <div className="card a2r-panel">
          <div className="a2r-ch">
            <span className="a2r-sk" style={{ width: 96, height: 14 }} />
            <span className="a2r-sp" />
            <span className="a2r-sk" style={{ width: 200, height: 12 }} />
          </div>
          <div className="a2r-hfs">
            {[56, 52, 48, 64, 72, 44, 80, 80].map((w, i) => (
              <div className="a2r-hf" key={i} aria-hidden="true">
                <span className="a2r-sk" style={{ width: w, height: 12 }} />
                <span className="a2r-sk" style={{ width: w + 24, height: 16, marginTop: 10 }} />
              </div>
            ))}
          </div>
        </div>
        <div className="a2r-split">
          <div className="card a2r-panel">
            <div className="a2r-ch">
              <span className="a2r-sk" style={{ width: 88, height: 14 }} />
              <span className="a2r-sp" />
              <span className="a2r-sk" style={{ width: 160, height: 12 }} />
            </div>
            <div className="a2r-skrows">
              {[180, 150, 200, 164, 188, 140].map((w, i) => (
                <div className="a2r-skrow" key={i} aria-hidden="true">
                  <span className="a2r-sk" style={{ width: 6, height: 6 }} />
                  <span className="a2r-sk" style={{ width: w }} />
                  <span className="a2r-sp" />
                  <span className="a2r-sk" style={{ width: 110 }} />
                </div>
              ))}
            </div>
          </div>
          <div className="card a2r-panel a2r-skcard">
            <span className="a2r-sk" style={{ width: 96, height: 14 }} />
            <span className="a2r-sk" style={{ width: '100%', height: 12 }} />
            <span className="a2r-sk" style={{ width: '80%', height: 12 }} />
            <span className="a2r-sk" style={{ width: '90%', height: 12 }} />
            <span className="a2r-sk" style={{ width: '70%', height: 12 }} />
          </div>
        </div>
        <p className="a2r-skn">{note}</p>
      </div>
    </div>
  );
}