/**
 * MET-01 `/agent/metrics` — the read-only metrics projection page, built
 * against met01-target.html + MET01-TARGET-SPEC.md (C1 visual baseline).
 *
 * Three blocks in fixed order: A 运行健康 (hermes-summary, one request /
 * three sources) → B 模型与工具用量 (hermes-usage?days=7|30) → C 活动热力
 * (run-activity?weeks=4&tz=Asia/Shanghai, R7). Read-only: zero write
 * affordances, zero totals, thresholds are frozen constants (no buttons).
 * Export is the single front-end read-only action (CSV of the CURRENT
 * on-screen aggregates, never persisted).
 *
 * Honest-data rules (the five iron rules are on screen in the caliber
 * panel): degraded sources never 0-fill; money only from the tenant cost
 * ledger (null → 「未计价」, never 0.00); tokens and money are never
 * combined; aggregates only from server buckets/cells; instance-level and
 * tenant-level calibers each carry their badge.
 *
 * Error triage is by CODE, never by text (SPEC §2): 401
 * console.unauthenticated → login with a return handoff (no page drawn);
 * 401 request.invalid_token → in-card server-credential copy; 403
 * console.forbidden → whole-page card without skeletons; 404 → 「还没有
 * 接通」 inside the card; 422 → params rejected, never auto-rewritten.
 * Machine codes stay in title/⋯ notes, never on the main screen.
 *
 * Theme comes from the shell (localStorage 'agentConsole.v2.theme'); this
 * page never touches the reference screen's met01-theme key.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useSearchParams } from 'react-router-dom';

import type {
  HermesCostStatus,
  HermesSource,
  HermesSummary,
  HermesUsage,
} from '@/controllers/API/agentConsoleHermes';

import { HelpTip } from './HelpTip';
import { employeeLabelById } from './identity';
import { MetIcon } from './metIcons';
import { HeatGrid, HeatSideStats, HEAT_DAY_KEYS } from './MetricsHeat';
import {
  a0Verdict,
  allSourcesDegraded,
  beijingDayIso,
  beijingDayStartIso,
  buildHeat,
  buildMetricsCsv,
  cellSinceIso,
  errorFamily,
  exportFileName,
  fmtBeijing,
  fmtBeijingHm,
  fmtCompact,
  fmtInt,
  fmtLoad,
  fmtP95,
  fmtPercent,
  fmtUptime,
  fmtUsd2,
  heartbeatStale,
  MET_THRESHOLDS,
  percentTone,
  p95Tone,
  reasonKey,
  type HeatModel,
} from './met01';
import {
  fetchActivity,
  fetchEmployeesPage,
  fetchHermesSummary,
  fetchHermesUsage,
  fmtId,
  makeFetcher,
  type ActivityBody,
  type ApiRes,
  type EmployeeRow,
  type Fetcher,
} from './v2Data';

// ---------------------------------------------------------------- state

type Box<T> =
  | { phase: 'loading' }
  | { phase: 'ok'; value: T; res: ApiRes<T> }
  | { phase: 'error'; res: ApiRes<T> };

const LOADING = { phase: 'loading' } as const;

interface FetchTimes {
  summary: string | null;
  usage: string | null;
  heat: string | null;
  employees: string | null;
}

const NO_TIMES: FetchTimes = { summary: null, usage: null, heat: null, employees: null };

const AUTO_OPTIONS = ['off', '15', '30', '60'] as const;
type AutoOption = (typeof AUTO_OPTIONS)[number];

const COST_PILL: Record<HermesCostStatus, { key: string; cls: string }> = {
  upstream: { key: 'agentConsole.v2.met.costUpstream', cls: 'ok' },
  estimated: { key: 'agentConsole.v2.met.costEstimated', cls: 'nt dash' },
  mixed: { key: 'agentConsole.v2.met.costMixed', cls: 'wr' },
  unknown: { key: 'agentConsole.v2.met.costUnknown', cls: 'nt dash' },
};

const SOURCE_NAMES = [
  { field: 'gateway_health', key: 'agentConsole.v2.met.srcGateway', stripKey: 'agentConsole.v2.met.stripGateway' },
  { field: 'dashboard_system', key: 'agentConsole.v2.met.srcSystem', stripKey: 'agentConsole.v2.met.stripSystem' },
  { field: 'dashboard_sessions_stats', key: 'agentConsole.v2.met.srcSessions', stripKey: 'agentConsole.v2.met.stripSessions' },
] as const;

const STACK_COLORS = ['var(--ov-chart-a)', 'var(--ov-chart-line)', 'var(--ov-chart-b)', 'var(--neutral-pill-bg)'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Cross-app login return handoff (utils/loginReturnTo contract): store
 *  where we were, then go to login; login consumes it after success. */
function gotoLoginWithReturn(): void {
  try {
    window.localStorage.setItem('LOGIN_PATHNAME', window.location.href);
    window.localStorage.setItem('LOGIN_PATHNAME_AT', String(Date.now()));
  } catch {
    /* storage disabled — login still works, just without the return */
  }
  window.location.assign('/');
}

// ---------------------------------------------------------------- small pieces

function OpsButton({ title, label }: { title: string; label: string }) {
  return (
    <button type="button" className="met-ops" aria-label={label} title={title}>
      <MetIcon name="dots" size={14} />
    </button>
  );
}

function Pill({ cls, dot, children, testid }: { cls: string; dot?: boolean; children: ReactNode; testid?: string }) {
  return (
    <span className={`ov-pill ${cls}`} data-testid={testid}>
      {dot ? <span className="dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

function SourcePill({ src, t, testid }: { src?: HermesSource; t: ReturnType<typeof useTranslation>['t']; testid?: string }) {
  if (src?.state === 'ok') {
    return (
      <Pill cls="ok xs" dot testid={testid}>
        {t('agentConsole.v2.met.srcOk')}
      </Pill>
    );
  }
  return (
    <Pill cls="wr xs" dot testid={testid}>
      {t('agentConsole.v2.met.srcDegraded')}
    </Pill>
  );
}

/** Per-source honest degradation block: 「暂不可用」 + human reason, never 0. */
function DegBlock({ name, reason, t, testid }: { name: string; reason?: string; t: ReturnType<typeof useTranslation>['t']; testid?: string }) {
  const reasonCopy = t(reasonKey(reason));
  return (
    <div className="met-deg" data-testid={testid}>
      <div className="t">{t('agentConsole.v2.met.unavailable')}</div>
      <div className="s">{t('agentConsole.v2.met.degBody', { reason: reasonCopy, name })}</div>
      <div className="tech" title={reason ?? ''}>
        {t('agentConsole.v2.met.degReasonLine', { reason: reasonCopy })}
      </div>
    </div>
  );
}

function SkelBars({ widths }: { widths: string[] }) {
  return (
    <div className="ov-card met-skel-card" aria-hidden="true">
      <div className="met-bar h" />
      {widths.map((w, i) => (
        <div key={i} className="met-bar" style={{ width: w }} />
      ))}
    </div>
  );
}

/** Error stage for a whole block (A full degradation / request failures). */
function BlockError({
  res,
  title,
  body,
  onRetry,
  t,
  testid,
}: {
  res: ApiRes<unknown> | null;
  title: string;
  body: string;
  onRetry: () => void;
  t: ReturnType<typeof useTranslation>['t'];
  testid: string;
}) {
  return (
    <div className="ov-card met-stage" data-testid={testid} role="alert">
      <span className="ic">
        <MetIcon name="alert" size={20} />
      </span>
      <div className="t">{title}</div>
      <div className="s">{body}</div>
      <div className="acts2">
        <button type="button" className="met-b out" onClick={onRetry} data-testid={`${testid}-retry`}>
          <MetIcon name="refresh" size={16} />
          {t('agentConsole.v2.retry')}
        </button>
      </div>
      {/* S4: the request line is always present — id or 「未提供」. */}
      <div className="req">
        {t('agentConsole.v2.met.requestId')}{' '}
        {res?.requestId ? (
          <span className="a2-mono">{res.requestId}</span>
        ) : (
          t('agentConsole.v2.id.requestIdAbsent')
        )}
      </div>
    </div>
  );
}

/** Family-specific copy for a failed request (codes never reach screen). */
function familyCopy(
  res: ApiRes<unknown>,
  t: ReturnType<typeof useTranslation>['t']
): { title: string; body: string } {
  const family = errorFamily(res.status, res.code);
  switch (family) {
    case 'upstreamToken':
      return {
        title: t('agentConsole.v2.met.errUpstreamTokenTitle'),
        body: t('agentConsole.v2.met.errUpstreamTokenBody'),
      };
    case 'internalOnly':
      return {
        title: t('agentConsole.v2.met.errUpstreamTokenTitle'),
        body: t('agentConsole.v2.met.errInternalOnlyBody'),
      };
    case 'unconfigured':
      return {
        title: t('agentConsole.v2.met.errUnconfiguredTitle'),
        body: t('agentConsole.v2.met.errUnconfiguredBody'),
      };
    case 'upstreamUnavailable':
      return {
        title: t('agentConsole.v2.met.errUpstreamUnavailableTitle'),
        body: t('agentConsole.v2.met.errUpstreamUnavailableBody'),
      };
    case 'invalidQuery':
      return {
        title: t('agentConsole.v2.met.errInvalidQueryTitle'),
        body: t('agentConsole.v2.met.errInvalidQueryBody'),
      };
    case 'notFound':
      return {
        title: t('agentConsole.v2.met.errNotFoundTitle'),
        body: t('agentConsole.v2.met.errNotFoundBody'),
      };
    default:
      if (!res.status) {
        return {
          title: t('agentConsole.v2.met.errNetwork'),
          body: t('agentConsole.v2.met.errNetworkBody'),
        };
      }
      return {
        title: t('agentConsole.v2.met.errGenericTitle', { status: res.status }),
        body: t('agentConsole.v2.met.errGenericBody', { status: res.status }),
      };
  }
}

// ---------------------------------------------------------------- page

export interface MetricsPageProps {
  /** Injectable for tests; defaults to the same-origin BFF fetcher. */
  fetcher?: Fetcher;
}

export function MetricsPage({ fetcher: fetcherProp }: MetricsPageProps) {
  const { t } = useTranslation();
  const fetcher = useMemo(() => fetcherProp ?? makeFetcher(), [fetcherProp]);

  const [searchParams, setSearchParams] = useSearchParams();
  const winRaw = searchParams.get('win');
  const days: 7 | 30 = winRaw === '30' ? 30 : 7;
  const winFallback = winRaw !== null && winRaw !== '7' && winRaw !== '30';
  const empMode = searchParams.get('emp') !== null;
  const empId = searchParams.get('emp') ?? '';

  const [summary, setSummary] = useState<Box<HermesSummary>>(LOADING);
  const [usage, setUsage] = useState<Box<HermesUsage>>(LOADING);
  const [usageUpdating, setUsageUpdating] = useState(false);
  const [heat, setHeat] = useState<Box<ActivityBody>>(LOADING);
  const [empHeat, setEmpHeat] = useState<Box<ActivityBody> | null>(null);
  const [employees, setEmployees] = useState<EmployeeRow[] | null>(null);
  const [times, setTimes] = useState<FetchTimes>(NO_TIMES);
  const [token, setToken] = useState(0);
  const [auto, setAuto] = useState<AutoOption>('30');
  const [backoff, setBackoff] = useState(0);
  const [calibOpen, setCalibOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [loginSent, setLoginSent] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const inFlight = useRef(0);
  const summarySeq = useRef(0);
  const usageSeq = useRef(0);
  const heatSeq = useRef(0);
  const empSeq = useRef(0);
  const daysRef = useRef(days);
  daysRef.current = days;
  const usagePhase = useRef(usage.phase);
  usagePhase.current = usage.phase;
  const toastTimer = useRef<number | undefined>(undefined);
  const firstDays = useRef(true);

  const bump = useCallback(() => {
    inFlight.current += 1;
    setBusy(true);
  }, []);
  const drop = useCallback(() => {
    inFlight.current = Math.max(0, inFlight.current - 1);
    if (inFlight.current === 0) setBusy(false);
  }, []);

  const say = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // ---- loaders (independent failure isolation, seq guards against races) ----

  const loadSummary = useCallback(
    async (keepOld = false) => {
      const seq = ++summarySeq.current;
      if (!keepOld) setSummary(LOADING);
      bump();
      const res = await fetchHermesSummary(fetcher);
      drop();
      if (seq !== summarySeq.current) return;
      if (res.ok && res.data) {
        setSummary({ phase: 'ok', value: res.data, res });
        setTimes((f) => ({ ...f, summary: new Date().toISOString() }));
        setBackoff(allSourcesDegraded(res.data) ? 2 : res.data.sources && Object.values(res.data.sources).some((s) => s?.state === 'degraded') ? 1 : 0);
      } else {
        setSummary({ phase: 'error', res });
        setBackoff((b) => Math.min(2, b + 1));
      }
      setNow(new Date());
    },
    [fetcher, bump, drop]
  );

  const loadUsage = useCallback(
    async (wantDays: 7 | 30, keepOld: boolean) => {
      const seq = ++usageSeq.current;
      if (keepOld && usagePhase.current === 'ok') setUsageUpdating(true);
      else setUsage(LOADING);
      bump();
      const res = await fetchHermesUsage(fetcher, wantDays);
      drop();
      if (seq !== usageSeq.current) return;
      setUsageUpdating(false);
      if (res.ok && res.data) {
        setUsage({ phase: 'ok', value: res.data, res });
        setTimes((f) => ({ ...f, usage: new Date().toISOString() }));
      } else {
        setUsage({ phase: 'error', res });
      }
      setNow(new Date());
    },
    [fetcher, bump, drop]
  );

  const loadHeat = useCallback(async () => {
    const seq = ++heatSeq.current;
    setHeat(LOADING);
    bump();
    const res = await fetchActivity(fetcher, { weeks: 4, tz: 'Asia/Shanghai' });
    drop();
    if (seq !== heatSeq.current) return;
    if (res.ok && res.data && Array.isArray(res.data.cells)) {
      setHeat({ phase: 'ok', value: res.data, res });
      setTimes((f) => ({ ...f, heat: new Date().toISOString() }));
    } else {
      setHeat({ phase: 'error', res });
    }
    setNow(new Date());
  }, [fetcher, bump, drop]);

  const loadEmployees = useCallback(async () => {
    bump();
    const res = await fetchEmployeesPage(fetcher, { limit: 100 });
    drop();
    if (res.ok && res.data && Array.isArray(res.data.items)) {
      setEmployees(res.data.items);
      setTimes((f) => ({ ...f, employees: new Date().toISOString() }));
    } else {
      // Cosmetic only: unresolved names fall back to truncated ids.
      setEmployees(null);
    }
  }, [fetcher, bump, drop]);

  const loadEmpHeat = useCallback(
    async (employeeId: string) => {
      const seq = ++empSeq.current;
      setEmpHeat(LOADING);
      bump();
      const res = await fetchActivity(fetcher, { weeks: 4, tz: 'Asia/Shanghai', employeeId });
      drop();
      if (seq !== empSeq.current) return;
      if (res.ok && res.data && Array.isArray(res.data.cells)) {
        setEmpHeat({ phase: 'ok', value: res.data, res });
      } else {
        setEmpHeat({ phase: 'error', res });
      }
    },
    [fetcher, bump, drop]
  );

  // ---- initial load + manual refresh (parallel, per-card loading) ----
  useEffect(() => {
    void loadSummary();
    void loadUsage(daysRef.current, false);
    void loadHeat();
    void loadEmployees();
  }, [token, loadSummary, loadUsage, loadHeat, loadEmployees]);

  // ---- window toggle: keep the previous values + 「更新中」, never clear ----
  useEffect(() => {
    if (firstDays.current) {
      firstDays.current = false;
      return;
    }
    void loadUsage(days, true);
  }, [days, loadUsage]);

  // ---- employee comparison grid ----
  useEffect(() => {
    if (empMode && empId) void loadEmpHeat(empId);
    else setEmpHeat(null);
  }, [empMode, empId, loadEmpHeat]);

  // ---- 401 console.unauthenticated → login with return; never a page ----
  useEffect(() => {
    if (loginSent) return;
    const boxes = [summary, usage, heat];
    const needsLogin = boxes.some(
      (b) => b.phase === 'error' && errorFamily(b.res.status, b.res.code) === 'login'
    );
    if (needsLogin) {
      setLoginSent(true);
      gotoLoginWithReturn();
    }
  }, [summary, usage, heat, loginSent]);

  // ---- auto refresh: A only, visibility pause, degraded backoff ×2×4 ----
  useEffect(() => {
    if (auto === 'off') return undefined;
    const base = Number(auto);
    const interval = Math.min(120, Math.max(15, base * 2 ** backoff)) * 1000;
    let timer: number | undefined;
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (!document.hidden) void loadSummary(true);
        schedule();
      }, interval);
    };
    const onVis = () => {
      window.clearTimeout(timer);
      if (!document.hidden) schedule();
    };
    schedule();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [auto, backoff, loadSummary]);

  // ---- minute tick: heartbeat staleness / focus column stay honest ----
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(id);
  }, []);

  // ---- URL helpers ----
  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (value === null) next.delete(key);
      else next.set(key, value);
      setSearchParams(next);
    },
    [searchParams, setSearchParams]
  );

  const refresh = useCallback(() => {
    if (busy) return;
    setToken((x) => x + 1);
  }, [busy]);

  // ---- derived data ----
  const empNames = useMemo(() => {
    const map = new Map<string, string>();
    (employees ?? []).forEach((e) => {
      if (e.employeeId && e.name) map.set(e.employeeId, e.name);
    });
    return map;
  }, [employees]);

  const platModel: HeatModel | null = useMemo(() => {
    if (heat.phase !== 'ok') return null;
    return buildHeat(heat.value.cells, heat.value.max);
  }, [heat]);

  const empModel: HeatModel | null = useMemo(() => {
    if (!empMode || !empId || !empHeat || empHeat.phase !== 'ok') return null;
    return buildHeat(empHeat.value.cells, empHeat.value.max);
  }, [empMode, empId, empHeat]);

  // Comparison mode shares ONE color-scale denominator = max(both grids).
  const sharedMax = empMode ? Math.max(platModel?.max ?? 0, empModel?.max ?? 0) : platModel?.max ?? 0;
  const platScaled = platModel && sharedMax !== platModel.max ? { ...platModel, max: sharedMax } : platModel;
  const empScaled = empModel && sharedMax !== empModel.max ? { ...empModel, max: sharedMax } : empModel;

  const summaryOk = summary.phase === 'ok' ? summary.value : null;
  const verdict = a0Verdict(summaryOk);
  const degradedSources = useMemo(() => {
    if (!summaryOk?.sources) return [];
    return SOURCE_NAMES.filter((s) => summaryOk.sources?.[s.field]?.state === 'degraded');
  }, [summaryOk]);
  const allDegraded = summaryOk ? allSourcesDegraded(summaryOk) : false;

  const forbiddenRes = useMemo(() => {
    for (const b of [summary, usage, heat]) {
      if (b.phase === 'error' && errorFamily(b.res.status, b.res.code) === 'forbidden') return b.res;
    }
    return null;
  }, [summary, usage, heat]);

  // ---- export (front-end CSV of the current screen; C loading disables) ----
  const exportCsv = useCallback(() => {
    if (heat.phase === 'loading') return;
    try {
      const csv = buildMetricsCsv({
        summary: summary.phase === 'ok' ? summary.value : null,
        usage: usage.phase === 'ok' ? usage.value : null,
        heat: platModel,
        days,
        fetched: { summary: times.summary, usage: times.usage, heat: times.heat },
      });
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = exportFileName(now);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      const blocks = [summary.phase === 'ok', usage.phase === 'ok', heat.phase === 'ok'].filter(Boolean).length;
      say(t('agentConsole.v2.met.exportDone', { count: blocks }));
    } catch {
      say(t('agentConsole.v2.met.exportBlocked'));
    }
  }, [heat.phase, summary, usage, platModel, days, times, now, say, t]);

  // ---- A2 drill-downs ----
  const runsTodayHref = `/agent/runs?since=${encodeURIComponent(beijingDayStartIso(now))}`;
  const scrollToB = useCallback(() => {
    const el = document.querySelector('[data-testid="agent-v2-met-block-b"]');
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  if (loginSent) return null;

  // ================================================================ 403
  if (forbiddenRes) {
    return (
      <div className="a2s-page met-page" data-testid="agent-v2-page-metrics">
        <div className="ov-card met-stage" data-testid="agent-v2-met-forbidden" role="alert">
          <span className="ic">
            <MetIcon name="lock" size={20} />
          </span>
          <div className="t">{t('agentConsole.v2.met.forbiddenTitle')}</div>
          <div className="s">
            {t('agentConsole.v2.met.forbiddenBodyPre')}
            <span className="a2-mono">HTTP 403</span>
            {t('agentConsole.v2.met.forbiddenBodyPost')}
          </div>
          <div className="acts2">
            <NavLink className="met-b out" to="/agent/employees" data-testid="agent-v2-met-forbidden-back">
              {t('agentConsole.v2.met.backEmployees')}
            </NavLink>
          </div>
        </div>
        <PageFooter t={t} winFallback={false} />
      </div>
    );
  }

  const heatLoading = heat.phase === 'loading';
  const summaryError = summary.phase === 'error' ? summary.res : null;
  const aErrorFamily = summaryError ? errorFamily(summaryError.status, summaryError.code) : null;
  const showAError = summary.phase === 'error' || allDegraded;

  // A full-degradation reason line: request failure → family copy; ok body
  // with every source degraded → the shared human reason.
  const aErrorReason = summaryError
    ? summaryError.status === 0
      ? t('agentConsole.v2.met.errNetwork')
      : t('agentConsole.v2.met.errHttp', { status: summaryError.status })
    : t(reasonKey(degradedSources[0] ? summaryOk?.sources?.[degradedSources[0].field]?.reason : undefined));

  const stripSources = summaryError ? SOURCE_NAMES.map((s) => s.stripKey) : degradedSources.map((s) => s.stripKey);
  const stripReason = summaryError
    ? aErrorReason
    : t(reasonKey(degradedSources[0] ? summaryOk?.sources?.[degradedSources[0].field]?.reason : undefined));
  const showStrip = stripSources.length > 0 && (summary.phase === 'ok' || summary.phase === 'error');

  const usageSrc = usage.phase === 'ok' ? usage.value.sources?.dashboard_usage : undefined;
  const usageDegraded = usage.phase === 'ok' && usageSrc?.state !== 'ok';
  const hasFallback = Boolean(usageSrc?.fallback_source);

  return (
    <div className="a2s-page met-page" data-testid="agent-v2-page-metrics">
      {/* ================= P0 page head ================= */}
      <div className="met-phead">
        <div>
          <h1 className="a2-h1">{t('agentConsole.v2.navMetrics')}</h1>
          <p className="met-sub">{t('agentConsole.v2.met.sub')}</p>
        </div>
        <div className="sp" />
        <div className="met-acts">
          <button
            type="button"
            className="met-b gh sm"
            aria-expanded={calibOpen}
            aria-controls="met-calib-panel"
            onClick={() => setCalibOpen((v) => !v)}
            data-testid="agent-v2-met-calib-btn"
          >
            <MetIcon name="help" size={14} />
            {t('agentConsole.v2.met.calib')}
          </button>
          <div className="ov-seg sm" role="group" aria-label={t('agentConsole.v2.met.autoRefresh')}>
            {AUTO_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                aria-pressed={auto === opt}
                onClick={() => setAuto(opt)}
                data-testid={`agent-v2-met-auto-${opt}`}
              >
                {opt === 'off' ? t('agentConsole.v2.met.autoOff') : `${opt}s`}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="met-b out sm"
            onClick={refresh}
            disabled={busy}
            data-testid="agent-v2-met-refresh"
          >
            <MetIcon name="refresh" size={14} className={busy ? 'met-spin' : ''} />
            {t('agentConsole.v2.met.refresh')}
          </button>
          <button
            type="button"
            className="met-b out sm"
            onClick={exportCsv}
            disabled={heatLoading}
            title={heatLoading ? t('agentConsole.v2.met.exportDisabledTitle') : t('agentConsole.v2.met.exportTitle')}
            data-testid="agent-v2-met-export"
          >
            <MetIcon name="dl" size={14} />
            {t('agentConsole.v2.met.export')}
          </button>
        </div>
      </div>
      <div className="met-fresh">
        <MetIcon name="clock" size={13} />
        <span>
          {t('agentConsole.v2.met.updatedAt')} <span className="a2-mono">{fmtBeijing(times.summary ?? times.heat, now)}</span>
        </span>
        <span className="faint">·</span>
        <span>
          {t('agentConsole.v2.met.readonlyNote')}
          {/* P1 batch2: skeleton/「—」 above is a pending KPI, not a zero. */}
          <HelpTip term="pendingKpi" testId="agent-v2-met-help-pendingkpi" className="met-fresh-help" />
        </span>
      </div>

      {/* ================= caliber panel (five iron rules, default open) ================= */}
      {calibOpen ? (
        <div className="met-calib" id="met-calib-panel" data-testid="agent-v2-met-calib">
          <div className="ct">
            <MetIcon name="help" size={14} />
            {t('agentConsole.v2.met.calibTitle')}
          </div>
          <ol>
            {([1, 2, 3, 4, 5] as const).map((i) => (
              <li key={i}>
                <b>{t(`agentConsole.v2.met.rule${i}t`)}</b>
                {t(`agentConsole.v2.met.rule${i}d`)}
                {/* P1 batch2: rule 4 is exactly "only sum server buckets" — the
                    place a reader meets bucketSum and needs it explained. */}
                {i === 4 ? (
                  <HelpTip term="bucketSum" testId="agent-v2-met-help-bucketsum" className="met-calib-help" />
                ) : null}
              </li>
            ))}
          </ol>
          <div className="cm">
            <span>
              {t('agentConsole.v2.met.calibFetch')}{' '}
              <span className="a2-mono">
                summary {fmtBeijingHm(times.summary)} · usage {fmtBeijingHm(times.usage)} · run-activity {fmtBeijingHm(times.heat)} · employees {fmtBeijingHm(times.employees)}
              </span>
            </span>
            <span>
              {t('agentConsole.v2.met.calibHeatRule')} <span className="a2-mono">{t('agentConsole.v2.met.calibHeatFormula')}</span>
            </span>
            <span>{t('agentConsole.v2.met.calibThresholds')}</span>
            <span>{t('agentConsole.v2.met.tzNote')}</span>
            {summaryOk ? (
              <span className="met-calib-states">
                {t('agentConsole.v2.met.calibStates')}
                {SOURCE_NAMES.map((s) => (
                  <SourcePill key={s.field} src={summaryOk.sources?.[s.field]} t={t} />
                ))}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ================= single degradation strip (never stacked) ================= */}
      {showStrip ? (
        <div className="met-degstrip" data-testid="agent-v2-met-degstrip" role="status">
          <MetIcon name="alert" size={14} />
          {t('agentConsole.v2.met.strip', {
            count: stripSources.length,
            names: stripSources.map((k) => t(k)).join('、'),
            reason: stripReason,
          })}
        </div>
      ) : null}

      {/* ================= A0 overall status strip ================= */}
      {summary.phase !== 'loading' ? (
        <div className="met-a0" title={t('agentConsole.v2.met.a0Title')} data-testid="agent-v2-met-a0">
          <span className={`st ${summary.phase === 'error' ? 'dg' : verdict.level}`} data-testid="agent-v2-met-a0-level">
            <span className="dot" aria-hidden="true" />
            {summary.phase === 'error'
              ? t('agentConsole.v2.met.a0Dg')
              : t(`agentConsole.v2.met.a0${verdict.level === 'ok' ? 'Ok' : verdict.level === 'wr' ? 'Wr' : verdict.level === 'dg' ? 'Dg' : 'Nt'}`)}
            {verdict.configIncomplete && summary.phase === 'ok' ? ` · ${t('agentConsole.v2.met.a0Config')}` : ''}
          </span>
          <span className="srcs">
            {SOURCE_NAMES.map((s) => {
              const src = summaryOk?.sources?.[s.field];
              const ok = summary.phase === 'ok' && src?.state === 'ok';
              return (
                <Pill key={s.field} cls={`${ok ? 'ok' : 'wr'} xs`} dot>
                  {t(s.key)} {ok ? t('agentConsole.v2.met.srcOk') : t('agentConsole.v2.met.srcDegraded')}
                </Pill>
              );
            })}
          </span>
          <span className="sp" />
          <span className="up">
            {t('agentConsole.v2.met.lastUpdate')} <span className="a2-mono">{fmtBeijingHm(times.summary)}</span>
          </span>
        </div>
      ) : null}

      {/* ================= A: 运行健康 ================= */}
      {summary.phase === 'loading' ? (
        <div className="met-skel" role="status" aria-label={t('agentConsole.v2.loading')} data-testid="agent-v2-met-skel-a">
          <div className="met-agrid">
            <SkelBars widths={['100%', '100%', '70%']} />
            <SkelBars widths={['100%', '100%', '70%']} />
            <SkelBars widths={['100%', '100%', '70%']} />
            <SkelBars widths={['100%', '60%']} />
            <SkelBars widths={['100%', '60%']} />
          </div>
        </div>
      ) : showAError ? (
        aErrorFamily === 'upstreamToken' || aErrorFamily === 'internalOnly' || aErrorFamily === 'unconfigured' ? (
          <BlockError
            res={summaryError}
            title={familyCopy(summaryError as ApiRes<unknown>, t).title}
            body={familyCopy(summaryError as ApiRes<unknown>, t).body}
            onRetry={refresh}
            t={t}
            testid="agent-v2-met-a-error"
          />
        ) : (
          <BlockError
            res={summaryError}
            title={t('agentConsole.v2.met.aErrorTitle')}
            body={t('agentConsole.v2.met.aErrorBody', { reason: aErrorReason })}
            onRetry={refresh}
            t={t}
            testid="agent-v2-met-a-error"
          />
        )
      ) : summaryOk ? (
        <div className="met-agrid" data-testid="agent-v2-met-agrid">
          <GatewayCard s={summaryOk} t={t} now={now} updatedAt={times.summary} />
          <TodayCard s={summaryOk} t={t} now={now} updatedAt={times.summary} runsHref={runsTodayHref} onTokens={scrollToB} />
          <SystemCard s={summaryOk} t={t} updatedAt={times.summary} />
          <SessionsCard s={summaryOk} t={t} updatedAt={times.summary} highlight={highlight} setHighlight={setHighlight} />
          <GapCard t={t} />
        </div>
      ) : null}

      {/* ================= B: 模型与工具用量 ================= */}
      {usage.phase === 'loading' ? (
        <div className="met-skel" role="status" aria-label={t('agentConsole.v2.loading')} data-testid="agent-v2-met-skel-b">
          <div className="ov-card met-skel-card">
            <div className="met-bar h" style={{ width: '220px' }} />
            <div className="met-mgrid" style={{ padding: 0 }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="met-mcard">
                  <div className="met-bar" style={{ width: '50%' }} />
                  <div className="met-bar" style={{ height: '28px', width: '70%' }} />
                </div>
              ))}
            </div>
            <div className="met-bar" />
            <div className="met-bar" />
            <div className="met-bar" style={{ width: '80%' }} />
          </div>
        </div>
      ) : usage.phase === 'error' ? (
        <BlockError
          res={usage.res}
          title={familyCopy(usage.res, t).title}
          body={familyCopy(usage.res, t).body}
          onRetry={refresh}
          t={t}
          testid="agent-v2-met-b-error"
        />
      ) : (
        <UsageBlock
          u={usage.value}
          t={t}
          days={days}
          updating={usageUpdating}
          degraded={usageDegraded}
          hasFallback={hasFallback}
          fallbackSource={usageSrc?.fallback_source}
          updatedAt={times.usage}
          empNames={empNames}
          onDays={(d) => setParam('win', String(d))}
        />
      )}

      {/* ================= C: 活动热力 ================= */}
      <div className="ov-card" data-testid="agent-v2-met-block-c" id="met-block-c">
        <div className="ov-card-hd">
          <span className="t">{t('agentConsole.v2.met.cTitle')}</span>
          <span className="c">
            {t('agentConsole.v2.met.cChip', { time: fmtBeijing(times.heat ?? now.toISOString(), now) })}
          </span>
          <div className="ov-seg sm" role="group" aria-label={t('agentConsole.v2.met.cDimAria')}>
            <button type="button" aria-pressed={!empMode} onClick={() => setParam('emp', null)} data-testid="agent-v2-met-dim-runs">
              {t('agentConsole.v2.met.dimRuns')}
            </button>
            <button type="button" aria-pressed={false} disabled title={t('agentConsole.v2.met.dimMessagesTip')} data-testid="agent-v2-met-dim-messages">
              {t('agentConsole.v2.met.dimMessages')}
            </button>
            <button
              type="button"
              aria-pressed={empMode}
              title={t('agentConsole.v2.met.dimEmpTip')}
              onClick={() => setParam('emp', empMode ? null : '')}
              data-testid="agent-v2-met-dim-emp"
            >
              {t('agentConsole.v2.met.dimEmp')}
            </button>
          </div>
          <div className="sp" />
          <span className="hd-note">
            {t('agentConsole.v2.met.updatedAt')} <span className="a2-mono">{fmtBeijingHm(times.heat)}</span>
          </span>
          <OpsButton title={t('agentConsole.v2.met.cOpsTitle')} label={t('agentConsole.v2.met.opsAria', { card: t('agentConsole.v2.met.cTitle') })} />
        </div>

        {empMode ? (
          <div className="met-empbar">
            <label className="met-emp-select">
              <span className="a2-micro">{t('agentConsole.v2.met.empSelect')}</span>
              <select
                value={empId}
                onChange={(ev) => setParam('emp', ev.target.value)}
                data-testid="agent-v2-met-emp-select"
                aria-label={t('agentConsole.v2.met.empSelect')}
              >
                <option value="">{t('agentConsole.v2.met.empSelectPlaceholder')}</option>
                {(employees ?? []).map((e) => (
                  <option key={e.employeeId} value={e.employeeId}>
                    {e.name || employeeLabelById(e.employeeId, undefined, t)}
                  </option>
                ))}
              </select>
            </label>
            {empId && empScaled ? <span className="hd-note">{t('agentConsole.v2.met.empSameScale')}</span> : null}
          </div>
        ) : null}

        {heat.phase === 'loading' ? (
          <div className="met-skel" role="status" aria-label={t('agentConsole.v2.loading')} data-testid="agent-v2-met-skel-c">
            <div className="met-skel-card" style={{ border: 0 }}>
              <div className="met-bar h" style={{ width: '260px' }} />
              <div className="met-bar" style={{ height: '180px' }} />
              <div className="met-bar" style={{ width: '60%' }} />
            </div>
          </div>
        ) : heat.phase === 'error' ? (
          errorFamily(heat.res.status, heat.res.code) === 'notFound' ? (
            <div className="met-deg center" data-testid="agent-v2-met-heat-404">
              <div className="t plain">{t('agentConsole.v2.met.errNotFoundTitle')}</div>
              <div className="s">{t('agentConsole.v2.met.errNotFoundBody')}</div>
              <div className="tech">
                {t('agentConsole.v2.met.requestId')}{' '}
                {heat.res.requestId ? (
                  <span className="a2-mono">{heat.res.requestId}</span>
                ) : (
                  /* S4: explicit 「未提供」, never a silent omission */
                  t('agentConsole.v2.id.requestIdAbsent')
                )}
                {' · '}
                {t('agentConsole.v2.met.heat404Tech')}
              </div>
            </div>
          ) : (
            <BlockError
              res={heat.res}
              title={familyCopy(heat.res, t).title}
              body={familyCopy(heat.res, t).body}
              onRetry={refresh}
              t={t}
              testid="agent-v2-met-heat-error"
            />
          )
        ) : platScaled && platScaled.max > 0 ? (
          <>
            <div className={`met-heat${empMode && empId ? ' dual' : ''}`}>
              <div className="met-dual-grids">
              <HeatGrid
                model={platScaled}
                t={t}
                now={now}
                testid="agent-v2-met-heat-grid"
                hrefFor={(dow, hour) =>
                  `/agent/runs?since=${encodeURIComponent(cellSinceIso(dow, hour, now))}&from=metrics`
                }
                ariaLabel={t('agentConsole.v2.met.heatAria', {
                  total: fmtInt(platScaled.total),
                  peak: platScaled.peak
                    ? t('agentConsole.v2.met.heatAriaPeak', {
                        day: t(HEAT_DAY_KEYS[platScaled.peak.dow - 1]),
                        hour: pad2(platScaled.peak.hour),
                        count: platScaled.peak.count,
                      })
                    : '',
                })}
              />
              {empMode && empId ? (
                empHeat?.phase === 'loading' ? (
                  <div className="met-emp-loading a2-meta" role="status">
                    {t('agentConsole.v2.loading')}
                  </div>
                ) : empScaled && empScaled.max > 0 ? (
                  <HeatGrid
                    model={empScaled}
                    t={t}
                    now={now}
                    testid="agent-v2-met-heat-grid-emp"
                    hrefFor={(dow, hour) =>
                      `/agent/runs?since=${encodeURIComponent(cellSinceIso(dow, hour, now))}&from=metrics&employeeId=${encodeURIComponent(empId)}`
                    }
                    ariaLabel={t('agentConsole.v2.met.heatAriaEmp', {
                      name: empNames.get(empId) ?? employeeLabelById(empId, empNames, t),
                      total: fmtInt(empScaled.total),
                    })}
                  />
                ) : (
                  <div className="met-deg center" data-testid="agent-v2-met-heat-emp-empty">
                    <div className="t plain">
                      {empHeat?.phase === 'error'
                        ? familyCopy(empHeat.res, t).title
                        : t('agentConsole.v2.met.empEmpty')}
                    </div>
                    {empHeat?.phase === 'error' ? (
                      <div className="s">{familyCopy(empHeat.res, t).body}</div>
                    ) : null}
                  </div>
                )
              ) : null}
              </div>
              <HeatSideStats model={platScaled} t={t} now={now} />
            </div>
            <div className="ov-rule" />
            <div className="met-hfoot">
              <span className="met-hscale">
                {t('agentConsole.v2.met.heatLegendLow')}
                {[0, 1, 2, 3, 4, 5].map((l) => (
                  <i key={l} className={`met-hc${l > 0 ? ` l${l}` : ''}`} aria-hidden="true" />
                ))}
                {t('agentConsole.v2.met.heatLegendHigh')}
              </span>
              <span className="met-hscale">{t('agentConsole.v2.met.heatLegendNote')}</span>
            </div>
            <div className="met-hsum" data-testid="agent-v2-met-heat-summary">
              {t('agentConsole.v2.met.heatSummary', {
                day: platScaled.peak ? t(HEAT_DAY_KEYS[platScaled.peak.dow - 1]) : '—',
                hour: platScaled.peak ? pad2(platScaled.peak.hour) : '—',
                peakCount: platScaled.peak ? fmtInt(platScaled.peak.count) : '0',
                night: platScaled.nightAvg !== null ? platScaled.nightAvg.toFixed(1) : '0.0',
                total: fmtInt(platScaled.total),
              })}
            </div>
          </>
        ) : (
          <div className="met-empty" data-testid="agent-v2-met-heat-empty">
            <span className="ic">
              <MetIcon name="inbox" size={20} />
            </span>
            <div className="t">{t('agentConsole.v2.met.heatEmptyTitle')}</div>
            <div className="s">{t('agentConsole.v2.met.heatEmptyBody')}</div>
            <NavLink className="met-b out" to="/agent/runs" data-testid="agent-v2-met-heat-empty-runs">
              {t('agentConsole.v2.met.goRuns')}
            </NavLink>
          </div>
        )}
      </div>

      {/* ================= loading footnote + footer ================= */}
      {summary.phase === 'loading' || usage.phase === 'loading' || heatLoading ? (
        <p className="hd-note met-loading-note" data-testid="agent-v2-met-loading-note">
          {t('agentConsole.v2.met.loadingNote')}
        </p>
      ) : null}
      <PageFooter t={t} winFallback={winFallback} />
      {toast ? (
        <div className="met-toast" role="status" data-testid="agent-v2-met-toast">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- footer

function PageFooter({ t, winFallback }: { t: ReturnType<typeof useTranslation>['t']; winFallback: boolean }) {
  return (
    <div className="met-pfoot" data-testid="agent-v2-met-footer">
      <span>{t('agentConsole.v2.met.footRule3')}</span>
      <span className="sp" />
      <span>
        {t('agentConsole.v2.met.footCaliber')}
        {/* P1 batch2: the footer line IS the caliber statement — explain the word. */}
        <HelpTip term="caliber" testId="agent-v2-met-help-caliber" className="met-pfoot-help" />
      </span>
      <span className="sp" />
      {winFallback ? <span data-testid="agent-v2-met-win-fallback">{t('agentConsole.v2.met.winFallback')}</span> : null}
      {/* S3: the ⌘K search hint pointed at the removed dead global search. */}
    </div>
  );
}

// ---------------------------------------------------------------- A cards

interface CardProps {
  s: HermesSummary;
  t: ReturnType<typeof useTranslation>['t'];
  updatedAt: string | null;
}

function CardHead({
  title,
  pill,
  updatedAt,
  opsTitle,
  t,
}: {
  title: string;
  pill?: ReactNode;
  updatedAt: string | null;
  opsTitle: string;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <div className="ov-card-hd">
      <span className="t">{title}</span>
      {pill}
      <div className="sp" />
      <span className="hd-note">
        {t('agentConsole.v2.met.updatedAt')} <span className="a2-mono">{fmtBeijingHm(updatedAt)}</span>
      </span>
      <OpsButton title={opsTitle} label={t('agentConsole.v2.met.opsAria', { card: title })} />
    </div>
  );
}

function GatewayCard({ s, t, now, updatedAt }: CardProps & { now: Date }) {
  const src = s.sources?.gateway_health;
  const degraded = src?.state !== 'ok';
  const gw = s.gateway;
  const status = gw?.status;
  const statusPill =
    status === 'ok' ? (
      <Pill cls="ok xs" dot>{t('agentConsole.v2.met.gwOk')}</Pill>
    ) : status === 'degraded' ? (
      <Pill cls="wr xs" dot>{t('agentConsole.v2.met.gwDegraded')}</Pill>
    ) : status === 'down' ? (
      <Pill cls="dg xs" dot>{t('agentConsole.v2.met.gwDown')}</Pill>
    ) : (
      <Pill cls="nt xs" dot>{t('agentConsole.v2.met.gwUnknown')}</Pill>
    );
  const stage = gw?.gateway_state;
  const stageNode =
    stage === 'running' ? (
      <span className="v ok sans">{t('agentConsole.v2.met.gwRunning')}</span>
    ) : stage === 'draining' ? (
      <span className="v wr sans">{t('agentConsole.v2.met.gwDraining')}</span>
    ) : stage === 'stopped' ? (
      <span className="v dg sans">{t('agentConsole.v2.met.gwStopped')}</span>
    ) : (
      <span className="v">{stage ?? '—'}</span>
    );
  const version = gw?.version;
  const versionText = !version || version === 'unknown' ? t('agentConsole.v2.met.gwVersionUnknown') : version;
  const active = gw?.active_agents;
  const stale = heartbeatStale(gw?.updated_at, now);
  const platforms = Object.entries(gw?.platforms ?? {});
  return (
    <div className="ov-card" data-testid="agent-v2-met-a1">
      <CardHead
        title={t('agentConsole.v2.met.a1Title')}
        pill={degraded ? <Pill cls="wr xs" dot>{t('agentConsole.v2.met.srcDegraded')}</Pill> : <Pill cls="ok xs" dot>{t('agentConsole.v2.met.a1Live')}</Pill>}
        updatedAt={updatedAt}
        opsTitle={t('agentConsole.v2.met.a1OpsTitle')}
        t={t}
      />
      {degraded ? (
        <DegBlock name={t('agentConsole.v2.met.stripGateway')} reason={src?.reason} t={t} testid="agent-v2-met-a1-deg" />
      ) : (
        <>
          <div className="met-kv">
            <div className="row">
              <span className="k">{t('agentConsole.v2.met.a1Status')}</span>
              {statusPill}
            </div>
            <div className="row">
              <span className="k">{t('agentConsole.v2.met.a1Stage')}</span>
              {stageNode}
            </div>
            <div className="row">
              <span className="k">{t('agentConsole.v2.met.a1Version')}</span>
              <span className="v">{versionText}</span>
            </div>
            <div className="row">
              <span className="k" title={t('agentConsole.v2.met.a1ActiveTip')}>
                {t('agentConsole.v2.met.a1Active')}
              </span>
              <span className={`v${typeof active === 'number' && active >= 1 ? ' ac' : ''}`} data-testid="agent-v2-met-a1-active">
                {active === null || active === undefined ? t('agentConsole.v2.met.unavailable') : fmtInt(active)}
              </span>
            </div>
            <div className="row">
              <span className="k">{t('agentConsole.v2.met.a1Busy')}</span>
              {gw?.gateway_busy === true ? (
                <Pill cls="wr xs">{t('agentConsole.v2.met.busyTrue')}</Pill>
              ) : gw?.gateway_busy === false ? (
                <Pill cls="nt xs">{t('agentConsole.v2.met.busyFalse')}</Pill>
              ) : (
                <span className="v">—</span>
              )}
            </div>
            <div className="row">
              <span className="k">{t('agentConsole.v2.met.a1Drainable')}</span>
              {gw?.gateway_drainable === true ? (
                <span className="v ok sans">{t('agentConsole.v2.met.drainTrue')}</span>
              ) : gw?.gateway_drainable === false ? (
                <span className="v nt sans">{t('agentConsole.v2.met.drainFalse')}</span>
              ) : (
                <span className="v">—</span>
              )}
            </div>
            <div className="row">
              <span className="k">{t('agentConsole.v2.met.a1Updated')}</span>
              <span className={`v${stale ? ' wr' : ''}`} title={gw?.updated_at ?? ''}>
                {fmtBeijing(gw?.updated_at, now)}
                {stale ? ` · ${t('agentConsole.v2.met.a1HeartbeatStale')}` : ''}
              </span>
            </div>
          </div>
          {platforms.length > 0 ? (
            <div className="met-kv" style={{ paddingTop: 0 }}>
              <table className="met-mini" aria-label={t('agentConsole.v2.met.a1Platforms')}>
                <tbody>
                  {platforms.map(([name, p]) => (
                    <tr key={name}>
                      <td className="pn">{name}</td>
                      <td>
                        {p?.state === 'connected' ? (
                          <Pill cls="ok xs" dot>{t('agentConsole.v2.met.platformConnected')}</Pill>
                        ) : p?.state ? (
                          <Pill cls="wr xs" dot>{p.state}</Pill>
                        ) : (
                          <span className="v">—</span>
                        )}{' '}
                        {p?.needs_attention === true ? (
                          <Pill cls="dg xs" dot testid="agent-v2-met-a1-attention">
                            <span title={t('agentConsole.v2.met.platformAttentionTip')}>{t('agentConsole.v2.met.platformAttention')}</span>
                          </Pill>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="met-card-ft">{t('agentConsole.v2.met.a1Foot')}</div>
        </>
      )}
    </div>
  );
}

function TodayCard({
  s,
  t,
  now,
  updatedAt,
  runsHref,
  onTokens,
}: CardProps & { now: Date; runsHref: string; onTokens: () => void }) {
  const src = s.sources?.gateway_health;
  const degraded = src?.state !== 'ok';
  const today = s.gateway?.metrics_today;
  const p95 = today?.latency_p95_ms;
  const tone = p95Tone(p95);
  const dayDiff = typeof today?.day === 'string' && today.day !== '' && today.day !== beijingDayIso(now);
  return (
    <div className="ov-card" data-testid="agent-v2-met-a2">
      <CardHead
        title={t('agentConsole.v2.met.a2Title')}
        pill={<Pill cls="nt xs">{t('agentConsole.v2.met.instancePill')}</Pill>}
        updatedAt={updatedAt}
        opsTitle={t('agentConsole.v2.met.a2OpsTitle')}
        t={t}
      />
      {degraded ? (
        <DegBlock name={t('agentConsole.v2.met.a2Title')} reason={src?.reason} t={t} testid="agent-v2-met-a2-deg" />
      ) : (
        <>
          <div className="met-mgrid two">
            <div className="met-mcard">
              <div className="lr">
                <span className="a2-micro">{t('agentConsole.v2.met.a2Requests')}</span>
                <span className="sp" />
                <NavLink className="ov-lnk" to={runsHref} title={t('agentConsole.v2.met.a2ReqLinkTitle')} aria-label={t('agentConsole.v2.met.a2ReqLinkTitle')}>
                  <MetIcon name="chevR" size={13} />
                </NavLink>
              </div>
              <NavLink className="v" to={runsHref} title={t('agentConsole.v2.met.a2ReqLinkTitle')} data-testid="agent-v2-met-a2-requests">
                {fmtInt(today?.requests)}
              </NavLink>
              <div className="fn">{t('agentConsole.v2.met.a2ReqFn')}</div>
            </div>
            <div className="met-mcard">
              <div className="lr">
                <span className="a2-micro">{t('agentConsole.v2.met.a2Messages')}</span>
                <span className="sp" />
                <NavLink className="ov-lnk" to={runsHref} title={t('agentConsole.v2.met.a2MsgLinkTitle')} aria-label={t('agentConsole.v2.met.a2MsgLinkTitle')}>
                  <MetIcon name="chevR" size={13} />
                </NavLink>
              </div>
              <NavLink className="v" to={runsHref} title={t('agentConsole.v2.met.a2MsgLinkTitle')} data-testid="agent-v2-met-a2-messages">
                {fmtInt(today?.messages)}
              </NavLink>
              <div className="fn">{t('agentConsole.v2.met.a2MsgFn')}</div>
            </div>
            <div className="met-mcard">
              <div className="lr">
                <span className="a2-micro">{t('agentConsole.v2.met.a2Tokens')}</span>
                <span className="sp" />
                <button type="button" className="ov-lnk met-linkbtn" onClick={onTokens} title={t('agentConsole.v2.met.a2TokLinkTitle')} aria-label={t('agentConsole.v2.met.a2TokLinkTitle')}>
                  <MetIcon name="chevR" size={13} />
                </button>
              </div>
              <button
                type="button"
                className="v met-linkbtn"
                onClick={onTokens}
                title={today?.tokens != null ? t('agentConsole.v2.met.exactValue', { value: fmtInt(today.tokens) }) : undefined}
                data-testid="agent-v2-met-a2-tokens"
              >
                {fmtCompact(today?.tokens)}
              </button>
              <div className="fn">{t('agentConsole.v2.met.a2TokFn')}</div>
            </div>
            <div className="met-mcard">
              <div className="lr">
                <span className="a2-micro">{t('agentConsole.v2.met.a2P95')}</span>
              </div>
              <span className={`v${tone ? ` ${tone}` : ''}`} title={t('agentConsole.v2.met.a2P95Tip')} data-testid="agent-v2-met-a2-p95">
                {fmtP95(p95)}
              </span>
              <div className="fn">{t('agentConsole.v2.met.a2P95Fn')}</div>
            </div>
          </div>
          <div className="met-kv" style={{ paddingTop: 0 }}>
            <div className="row">
              <span className="k">{t('agentConsole.v2.met.a2Day')}</span>
              <span className="v" data-testid="agent-v2-met-a2-day">
                {today?.day ?? '—'} <span className="faint sans">{t('agentConsole.v2.met.a2DayNote')}</span>
                {dayDiff ? <span className="nt-tag">{t('agentConsole.v2.met.a2DayDiff')}</span> : null}
              </span>
            </div>
          </div>
          <div className="met-card-ft">{t('agentConsole.v2.met.a2Foot')}</div>
        </>
      )}
    </div>
  );
}

function SystemCard({ s, t, updatedAt }: CardProps) {
  const src = s.sources?.dashboard_system;
  const degraded = src?.state !== 'ok';
  const sys = s.system;
  const cpu = sys?.cpu_percent;
  const mem = sys?.memory?.percent;
  const disk = sys?.disk?.percent;
  const cores = sys?.cpu_count;
  const load = Array.isArray(sys?.load_avg) ? sys.load_avg : null;
  const threads = sys?.process?.num_threads;
  const psutilMissing = sys?.psutil === false || sys?.psutil === null || sys?.psutil === undefined;
  const loadTone = (v: number | undefined): string => {
    if (v === undefined || !Number.isFinite(v) || !cores) return '';
    if (v > cores * MET_THRESHOLDS.loadDangerFactor) return 'dg';
    if (v > cores * MET_THRESHOLDS.loadWarnFactor) return 'wr';
    return '';
  };
  const memAbs = sys?.memory;
  const diskAbs = sys?.disk;
  return (
    <div className="ov-card" data-testid="agent-v2-met-a3">
      <CardHead
        title={t('agentConsole.v2.met.a3Title')}
        pill={<Pill cls="nt xs">{t('agentConsole.v2.met.instancePill')}</Pill>}
        updatedAt={updatedAt}
        opsTitle={t('agentConsole.v2.met.a3OpsTitle')}
        t={t}
      />
      {degraded ? (
        <DegBlock name={t('agentConsole.v2.met.stripSystem')} reason={src?.reason} t={t} testid="agent-v2-met-a3-deg" />
      ) : (
        <>
          <div className="met-kv">
            <div className="met-mrow">
              <div className="t">
                <span className="k">{t('agentConsole.v2.met.a3Cpu')}</span>
                <span className={`v ${percentTone(cpu, MET_THRESHOLDS.cpuMem)}`}>{fmtPercent(cpu)}</span>
              </div>
              <div className="met-meter">
                <i className={percentTone(cpu, MET_THRESHOLDS.cpuMem)} style={{ width: `${Math.min(100, Math.max(0, cpu ?? 0))}%` }} />
              </div>
              <div className="fn">
                {cores != null ? t('agentConsole.v2.met.a3Cores', { count: cores }) : ''}
                {load && load.length > 0 ? (
                  <span className={loadTone(load[0]) ? `met-load ${loadTone(load[0])}` : 'met-load'}>
                    {' · '}
                    {t('agentConsole.v2.met.a3Load', {
                      values: load.slice(0, 3).map((v) => fmtLoad(v)).join(' / '),
                    })}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="met-mrow">
              <div className="t">
                <span className="k">{t('agentConsole.v2.met.a3Memory')}</span>
                <span className={`v ${percentTone(mem, MET_THRESHOLDS.cpuMem)}`}>{fmtPercent(mem)}</span>
              </div>
              <div className="met-meter">
                <i className={percentTone(mem, MET_THRESHOLDS.cpuMem)} style={{ width: `${Math.min(100, Math.max(0, mem ?? 0))}%` }} />
              </div>
              <div
                className="fn"
                title={
                  memAbs
                    ? t('agentConsole.v2.met.a3AbsTip', {
                        values: `total ${memAbs.total ?? '—'} · used ${memAbs.used ?? '—'} · available ${memAbs.available ?? '—'}`,
                      })
                    : undefined
                }
              >
                {t('agentConsole.v2.met.a3AbsFn')}
              </div>
            </div>
            <div className="met-mrow">
              <div className="t">
                <span className="k">{t('agentConsole.v2.met.a3Disk')}</span>
                <span className={`v ${percentTone(disk, MET_THRESHOLDS.disk)}`} data-testid="agent-v2-met-a3-disk">
                  {fmtPercent(disk)}
                </span>
              </div>
              <div className="met-meter">
                <i className={percentTone(disk, MET_THRESHOLDS.disk)} style={{ width: `${Math.min(100, Math.max(0, disk ?? 0))}%` }} />
              </div>
              <div
                className="fn"
                title={
                  diskAbs
                    ? t('agentConsole.v2.met.a3AbsTip', {
                        values: `total ${diskAbs.total ?? '—'} · used ${diskAbs.used ?? '—'} · free ${diskAbs.free ?? '—'}`,
                      })
                    : undefined
                }
              >
                {t('agentConsole.v2.met.a3DiskFn')}
              </div>
            </div>
            <div className="met-mrow">
              <div className="t">
                <span className="k">{t('agentConsole.v2.met.a3Threads')}</span>
                <span className={`v${typeof threads === 'number' && threads > MET_THRESHOLDS.threads ? ' wr' : ''}`}>
                  {fmtInt(threads)}
                </span>
              </div>
              <div className="fn" title={sys?.process?.rss != null ? t('agentConsole.v2.met.a3RssTip', { value: String(sys.process.rss) }) : undefined}>
                {t('agentConsole.v2.met.a3ThreadFn', { uptime: fmtUptime(sys?.uptime_seconds) })}
              </div>
            </div>
          </div>
          {psutilMissing ? (
            <div className="met-card-ft wr" data-testid="agent-v2-met-a3-psutil">
              {t('agentConsole.v2.met.a3PsutilMissing')}
            </div>
          ) : null}
          <div className="met-card-ft">{t('agentConsole.v2.met.a3Foot')}</div>
        </>
      )}
    </div>
  );
}

function SessionsCard({
  s,
  t,
  updatedAt,
  highlight,
  setHighlight,
}: CardProps & { highlight: string | null; setHighlight: (v: string | null) => void }) {
  const src = s.sources?.dashboard_sessions_stats;
  const degraded = src?.state !== 'ok';
  const ses = s.sessions_stats;
  const bySource = ses?.by_source ?? {};
  const entries = Object.entries(bySource).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((acc, [, n]) => acc + (Number.isFinite(n) ? n : 0), 0);
  const top = entries.slice(0, 3);
  const rest = entries.slice(3);
  const restSum = rest.reduce((acc, [, n]) => acc + (Number.isFinite(n) ? n : 0), 0);
  const segments =
    rest.length > 0
      ? [...top.map(([name, n]) => ({ name, n })), { name: t('agentConsole.v2.met.a4Other'), n: restSum }]
      : top.map(([name, n]) => ({ name, n }));
  // S5: integer shares; a non-zero slice never prints 0%.
  const pct = (n: number) =>
    total > 0 && n > 0 ? String(Math.max(1, Math.round((n / total) * 100))) : '0';
  return (
    <div className="ov-card" data-testid="agent-v2-met-a4">
      <CardHead
        title={t('agentConsole.v2.met.a4Title')}
        pill={<Pill cls="nt xs">{t('agentConsole.v2.met.instancePill')}</Pill>}
        updatedAt={updatedAt}
        opsTitle={t('agentConsole.v2.met.a4OpsTitle')}
        t={t}
      />
      {degraded ? (
        <DegBlock name={t('agentConsole.v2.met.stripSessions')} reason={src?.reason} t={t} testid="agent-v2-met-a4-deg" />
      ) : (
        <>
          <div className="met-kv">
            <div className="row">
              <span className="k">{t('agentConsole.v2.met.a4Total')}</span>
              <span className="v">{fmtInt(ses?.total)}</span>
            </div>
            <div className="row">
              <span className="k">{t('agentConsole.v2.met.a4Active')}</span>
              <span className="v">
                {fmtInt(ses?.active_store)} <span className="faint">{t('agentConsole.v2.met.a4ActiveOf', { total: fmtInt(ses?.total) })}</span>
              </span>
            </div>
            <div className="row">
              <span className="k">{t('agentConsole.v2.met.a4Archived')}</span>
              <span className="v muted">{fmtInt(ses?.archived)}</span>
            </div>
            <div className="row">
              <span className="k">{t('agentConsole.v2.met.a4Messages')}</span>
              <span className="v">{fmtInt(ses?.messages)}</span>
            </div>
          </div>
          <div className="met-subhd">
            <span className="a2-micro">{t('agentConsole.v2.met.a4BySource')}</span>
            <span className="sp" />
            <span className="hd-note">{t('agentConsole.v2.met.a4NoDrill')}</span>
          </div>
          {segments.length === 0 ? (
            <p className="met-empty-line" data-testid="agent-v2-met-a4-source-empty">
              {t('agentConsole.v2.met.a4Empty')}
            </p>
          ) : (
            <>
              <div
                className="met-stack"
                role="img"
                aria-label={t('agentConsole.v2.met.a4StackAria', {
                  parts: segments.map((seg) => `${seg.name} ${pct(seg.n)}%`).join('、'),
                })}
              >
                {segments.map((seg, i) => (
                  <i
                    key={seg.name}
                    style={{
                      width: `${total > 0 ? (seg.n / total) * 100 : 0}%`,
                      background: STACK_COLORS[i] ?? STACK_COLORS[3],
                      opacity: highlight && highlight !== seg.name ? 0.4 : 1,
                    }}
                  />
                ))}
              </div>
              <div className="met-slegend">
                {segments.map((seg, i) => (
                  <button
                    type="button"
                    key={seg.name}
                    className="lr"
                    onClick={() => setHighlight(highlight === seg.name ? null : seg.name)}
                    title={t('agentConsole.v2.met.a4LegendTip')}
                    data-testid="agent-v2-met-a4-legend"
                  >
                    <i style={{ background: STACK_COLORS[i] ?? STACK_COLORS[3] }} aria-hidden="true" />
                    <span className="nm">{seg.name}</span>
                    {total > 0 && seg.n / total >= 0.8 ? <span className="note">{t('agentConsole.v2.met.a4Concentrated')}</span> : null}
                    <span className="sp" />
                    <span className="n">{fmtInt(seg.n)}</span>
                    <span className="pc">{pct(seg.n)}%</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function GapCard({ t }: { t: ReturnType<typeof useTranslation>['t'] }) {
  return (
    <div className="ov-card" data-testid="agent-v2-met-a5">
      <div className="ov-card-hd">
        <span className="t">{t('agentConsole.v2.met.a5Title')}</span>
        <div className="sp" />
        <OpsButton title={t('agentConsole.v2.met.a5OpsTitle')} label={t('agentConsole.v2.met.opsAria', { card: t('agentConsole.v2.met.a5Title') })} />
      </div>
      <div className="met-empty sm">
        <span className="ic">
          <MetIcon name="server" size={20} />
        </span>
        <div className="t">{t('agentConsole.v2.met.a5GapTitle')}</div>
        <div className="s">{t('agentConsole.v2.met.a5GapBody')}</div>
        <NavLink className="ov-lnk" to="/agent/settings" data-testid="agent-v2-met-a5-link">
          {t('agentConsole.v2.met.a5Link')} <MetIcon name="chevR" size={13} />
        </NavLink>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- B block

function UsageBlock({
  u,
  t,
  days,
  updating,
  degraded,
  hasFallback,
  fallbackSource,
  updatedAt,
  empNames,
  onDays,
}: {
  u: HermesUsage;
  t: ReturnType<typeof useTranslation>['t'];
  days: 7 | 30;
  updating: boolean;
  degraded: boolean;
  hasFallback: boolean;
  fallbackSource?: string;
  updatedAt: string | null;
  empNames: Map<string, string>;
  onDays: (d: 7 | 30) => void;
}) {
  const [sortKey, setSortKey] = useState<'in' | 'out' | 'total'>('total');
  const [sortDir, setSortDir] = useState<-1 | 1>(-1);

  const tokens = u.tokens;
  const tokenValues = [tokens?.total_input, tokens?.total_output, tokens?.total_cache_read, tokens?.total_reasoning];
  const tokensEmpty = !degraded && tokenValues.every((v) => v === 0);
  const tokenKeys = ['tokIn', 'tokOut', 'tokCache', 'tokReason'] as const;
  const tokenFns = [
    t('agentConsole.v2.met.tokFn', { days }),
    t('agentConsole.v2.met.tokFn', { days }),
    t('agentConsole.v2.met.tokCacheFn'),
    t('agentConsole.v2.met.tokReasonFn'),
  ];

  const models = Array.isArray(u.by_model) ? u.by_model.filter((m) => m && typeof m.model === 'string' && m.model !== '') : null;
  const rows = useMemo(() => {
    if (!models) return [];
    const withTotal = models.map((m) => ({
      model: m.model as string,
      input: m.input_tokens,
      output: m.output_tokens,
      total: (m.input_tokens ?? 0) + (m.output_tokens ?? 0),
    }));
    const denom = withTotal.reduce((acc, r) => acc + r.total, 0);
    const sorted = [...withTotal].sort((a, b) => {
      const av = sortKey === 'in' ? (a.input ?? 0) : sortKey === 'out' ? (a.output ?? 0) : a.total;
      const bv = sortKey === 'in' ? (b.input ?? 0) : sortKey === 'out' ? (b.output ?? 0) : b.total;
      return (av - bv) * sortDir;
    });
    return sorted.map((r) => ({ ...r, share: denom > 0 ? (r.total / denom) * 100 : null }));
  }, [models, sortKey, sortDir]);

  const toggleSort = (key: 'in' | 'out' | 'total') => {
    if (key === sortKey) setSortDir((d) => (d === -1 ? 1 : -1));
    else {
      setSortKey(key);
      setSortDir(-1);
    }
  };
  const ariaSort = (key: 'in' | 'out' | 'total'): 'ascending' | 'descending' | undefined =>
    key === sortKey ? (sortDir === -1 ? 'descending' : 'ascending') : undefined;

  const cost = u.cost;
  const costStatus: HermesCostStatus = cost?.cost_status ?? 'unknown';
  const priced = cost && cost.cost_usd !== null && cost.cost_usd !== undefined && costStatus !== 'unknown';
  const costPill = COST_PILL[costStatus] ?? COST_PILL.unknown;
  const attr = u.attribution;
  const attrDegraded = attr?.state !== 'ok';
  const unattr = attr?.unattributed;
  const unattrTokens = unattr?.tokens;
  const [tokOpen, setTokOpen] = useState(false);

  const thSort = (key: 'in' | 'out' | 'total', label: string, title: string) => (
    <th scope="col" className="r" aria-sort={ariaSort(key)}>
      <button type="button" onClick={() => toggleSort(key)} title={title} data-testid={`agent-v2-met-sort-${key}`}>
        {label} <MetIcon name="chevD" size={13} />
      </button>
    </th>
  );

  return (
    <div className="ov-card" data-testid="agent-v2-met-block-b" id="met-block-b">
      <div className="ov-card-hd">
        <span className="t">{t('agentConsole.v2.met.bTitle')}</span>
        <div className="ov-seg sm" role="group" aria-label={t('agentConsole.v2.met.bWinAria')}>
          <button
            type="button"
            aria-pressed={days === 7}
            disabled={updating && days !== 7}
            onClick={() => onDays(7)}
            data-testid="agent-v2-met-win-7"
          >
            {t('agentConsole.v2.met.win7')}
          </button>
          <button
            type="button"
            aria-pressed={days === 30}
            disabled={updating && days !== 30}
            onClick={() => onDays(30)}
            data-testid="agent-v2-met-win-30"
          >
            {t('agentConsole.v2.met.win30')}
          </button>
        </div>
        <div className="sp" />
        <span className="hd-note">
          {t('agentConsole.v2.met.updatedAt')} <span className="a2-mono">{fmtBeijingHm(updatedAt)}</span> · {t('agentConsole.v2.met.bHdNote')}
          {updating ? <span className="met-updating" data-testid="agent-v2-met-updating"> · {t('agentConsole.v2.met.updating')}</span> : null}
        </span>
        <OpsButton title={t('agentConsole.v2.met.bOpsTitle', { days })} label={t('agentConsole.v2.met.opsAria', { card: t('agentConsole.v2.met.bTitle') })} />
      </div>

      {/* token four cards — no sparkline (no history endpoint, M-GAP-04) */}
      <div className="met-mgrid" data-testid="agent-v2-met-tokens">
        {tokenKeys.map((key, i) => {
          const v = tokenValues[i];
          const showValue = !degraded || hasFallback;
          return (
            <div key={key} className="met-mcard">
              <div className="lr">
                <span className="a2-micro">{t(`agentConsole.v2.met.${key}`)}</span>
                <span className="sp" />
                <Pill cls="nt xs">{t('agentConsole.v2.met.instancePill')}</Pill>
              </div>
              {!showValue ? (
                <span className="v na" data-testid={`agent-v2-met-${key}`}>{t('agentConsole.v2.met.unavailable')}</span>
              ) : tokensEmpty ? (
                <span className="v na" data-testid={`agent-v2-met-${key}`}>{t('agentConsole.v2.met.tokEmpty', { days })}</span>
              ) : v === null || v === undefined ? (
                <span className="v na" data-testid={`agent-v2-met-${key}`}>{t('agentConsole.v2.met.unavailable')}</span>
              ) : (
                <span className="v" title={t('agentConsole.v2.met.exactValue', { value: fmtInt(v) })} data-testid={`agent-v2-met-${key}`}>
                  {fmtCompact(v)}
                </span>
              )}
              <div className="fn">{tokenFns[i]}</div>
            </div>
          );
        })}
      </div>
      <div className="hd-note met-btok-note">
        {t('agentConsole.v2.met.bTokNote', { days })}
        {degraded && hasFallback ? (
          <>
            {' · '}
            <span className="wr" data-testid="agent-v2-met-fallback" title={fallbackSource ?? ''}>
              {t('agentConsole.v2.met.fallbackPill')}
            </span>
            {' · '}
            {t('agentConsole.v2.met.fallbackNote')}
          </>
        ) : null}
      </div>

      <div className="met-bcols">
        {/* model table */}
        <div className="met-panel clip">
          <div className="met-subhd">
            <span className="t">{t('agentConsole.v2.met.modelTable')}</span>
            <Pill cls="nt xs">{t('agentConsole.v2.met.instancePill')}</Pill>
            <span className="sp" />
            <span className="hd-note">{t('agentConsole.v2.met.modelSortNote')}</span>
          </div>
          {models === null ? (
            <DegBlock name={t('agentConsole.v2.met.modelTable')} reason={u.sources?.dashboard_usage?.reason} t={t} testid="agent-v2-met-models-deg" />
          ) : rows.length === 0 ? (
            <div className="met-empty sm" data-testid="agent-v2-met-models-empty">
              <span className="ic">
                <MetIcon name="inbox" size={20} />
              </span>
              <div className="t">{t('agentConsole.v2.met.modelEmptyTitle', { days })}</div>
              <div className="s">{t('agentConsole.v2.met.modelEmptyBody')}</div>
            </div>
          ) : (
            <div className="met-tblwrap" data-testid="agent-v2-met-models">
              <table className="met-tbl" aria-label={t('agentConsole.v2.met.modelTableAria')}>
                <thead>
                  <tr>
                    <th scope="col">{t('agentConsole.v2.met.colModel')}</th>
                    {thSort('in', t('agentConsole.v2.met.colIn'), t('agentConsole.v2.met.sortInTitle'))}
                    {thSort('out', t('agentConsole.v2.met.colOut'), t('agentConsole.v2.met.sortOutTitle'))}
                    {thSort('total', t('agentConsole.v2.met.colShare'), t('agentConsole.v2.met.sortTotalTitle'))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.model}>
                      <td className="mono">{r.model}</td>
                      <td className="num">{fmtInt(r.input)}</td>
                      <td className="num">{fmtInt(r.output)}</td>
                      <td className="num">
                        <span className="met-share">
                          <span className="p">{fmtPercent(r.share)}</span>
                          <span className="bar">
                            <i style={{ width: `${r.share ?? 0}%` }} />
                          </span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="met-card-ft">{t('agentConsole.v2.met.modelFoot')}</div>
        </div>

        <div className="met-bcol">
          {/* cost subcard — tenant ledger, independent of dashboard degradation */}
          <div className="met-panel" data-testid="agent-v2-met-cost">
            <div className="met-subhd">
              <span className="t">{t('agentConsole.v2.met.costTitle')}</span>
              <Pill cls="ok xs">{t('agentConsole.v2.met.tenantPill')}</Pill>
              <span className="sp" />
              <span className="hd-note">{t('agentConsole.v2.met.costSource')}</span>
            </div>
            {priced ? (
              <div className="met-bigv">
                <span className="v" data-testid="agent-v2-met-cost-value">
                  <span className="u">USD</span>
                  {fmtUsd2(cost.cost_usd)}
                </span>
                <Pill cls={`${costPill.cls} xs`} dot={costStatus === 'upstream' || costStatus === 'mixed'} testid="agent-v2-met-cost-pill">
                  {t(costPill.key)}
                </Pill>
                <span className="hd-note">{t('agentConsole.v2.met.costRows', { count: cost.rows })}</span>
              </div>
            ) : (
              <div className="met-bigv" data-testid="agent-v2-met-cost-notpriced">
                <Pill cls="nt dash">{t('agentConsole.v2.met.costUnknown')}</Pill>
                <span className="hd-note">
                  {cost?.rows === 0 ? t('agentConsole.v2.met.costZeroRows') : t('agentConsole.v2.met.costRows', { count: cost?.rows ?? 0 })}
                </span>
              </div>
            )}
            {cost?.per_employee && cost.per_employee.length > 0 ? (
              <div className="met-kv" style={{ paddingTop: 0 }}>
                <table className="met-mini" aria-label={t('agentConsole.v2.met.costEmpAria')}>
                  <tbody>
                    {cost.per_employee.map((row) => {
                      const name = empNames.get(row.employee_id);
                      const rowPill = COST_PILL[row.cost_status] ?? COST_PILL.unknown;
                      const rowPriced = row.cost_status !== 'unknown' && row.cost_usd !== null && row.cost_usd !== undefined;
                      return (
                        <tr key={row.employee_id} data-testid="agent-v2-met-cost-emp-row">
                          <td>
                            <NavLink
                              className="ov-lnk"
                              to={`/agent/employees/${encodeURIComponent(row.employee_id)}?tab=runs`}
                              title={t('agentConsole.v2.met.costEmpLinkTitle')}
                            >
                              {name ? (
                                <>
                                  {name} <span className="a2-mono faint met-emp-tail">…{row.employee_id.slice(-6)}</span>
                                </>
                              ) : (
                                <>
                                  {/* S2: 「员工 · 短码」 — no bare `emp_` id text */}
                                  {employeeLabelById(row.employee_id, empNames, t)}{' '}
                                  <span className="met-notfound-note">{t('agentConsole.v2.met.costEmpNotFound')}</span>
                                </>
                              )}
                            </NavLink>
                          </td>
                          <td className="mono">{rowPriced ? `USD ${fmtUsd2(row.cost_usd)}` : t('agentConsole.v2.met.costUnknown')}</td>
                          <td>
                            <Pill cls={`${rowPill.cls} xs`}>{t(rowPill.key)}</Pill>
                          </td>
                          <td className="mono faint">{t('agentConsole.v2.met.costRowUnit', { count: row.rows })}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
            <div className="met-card-ft">{t('agentConsole.v2.met.costFoot')}</div>
          </div>

          {/* attribution subcard — last 200 sessions, never guessed */}
          <div className="met-panel" data-testid="agent-v2-met-attr">
            <div className="met-subhd">
              <span className="t">{t('agentConsole.v2.met.attrTitle')}</span>
              <Pill cls="ok xs">{t('agentConsole.v2.met.tenantPill')}</Pill>
              <span className="sp" />
              {attrDegraded ? (
                <Pill cls="wr xs" dot testid="agent-v2-met-attr-pill">
                  {t('agentConsole.v2.met.attrDeg')}
                </Pill>
              ) : (
                <Pill cls="ok xs" dot testid="agent-v2-met-attr-pill">
                  {t('agentConsole.v2.met.attrOk')}
                </Pill>
              )}
            </div>
            {attrDegraded ? (
              <DegBlock name={t('agentConsole.v2.met.attrTitle')} reason={attr?.reason} t={t} testid="agent-v2-met-attr-deg" />
            ) : attr?.mapped_sessions === 0 ? (
              <div className="met-empty sm" data-testid="agent-v2-met-attr-empty">
                <div className="t">{t('agentConsole.v2.met.attrEmptyTitle')}</div>
                <div className="s">{t('agentConsole.v2.met.attrEmptyBody')}</div>
              </div>
            ) : (
              <div className="met-kv">
                <div className="row">
                  <span className="k">{t('agentConsole.v2.met.attrMapped')}</span>
                  <span className="v" data-testid="agent-v2-met-attr-mapped">
                    {attr?.mapped_sessions === null || attr?.mapped_sessions === undefined
                      ? t('agentConsole.v2.met.unavailable')
                      : fmtInt(attr.mapped_sessions)}
                  </span>
                </div>
                <div className="row">
                  <span className="k">{t('agentConsole.v2.met.attrUnattrSessions')}</span>
                  <span className={`v${typeof unattr?.sessions === 'number' && unattr.sessions > 0 ? ' wr' : ''}`} data-testid="agent-v2-met-attr-unattr">
                    {fmtInt(unattr?.sessions)}
                  </span>
                </div>
                {unattrTokens ? (
                  <div className="row">
                    <span className="k">{t('agentConsole.v2.met.attrUnattrTokens')}</span>
                    <button
                      type="button"
                      className="v met-linkbtn met-attr-tok"
                      onClick={() => setTokOpen((v) => !v)}
                      aria-expanded={tokOpen}
                      title={t('agentConsole.v2.met.attrTokTip', {
                        in: fmtInt(unattrTokens.total_input),
                        out: fmtInt(unattrTokens.total_output),
                        cache: fmtInt(unattrTokens.total_cache_read),
                        reason: fmtInt(unattrTokens.total_reasoning),
                      })}
                      data-testid="agent-v2-met-attr-tokens"
                    >
                      {fmtInt(unattrTokens.total_input)} / {fmtInt(unattrTokens.total_output)} / {fmtInt(unattrTokens.total_cache_read)} / {fmtInt(unattrTokens.total_reasoning)}
                    </button>
                  </div>
                ) : null}
                {tokOpen && unattrTokens ? (
                  <div className="met-attr-detail a2-mono" data-testid="agent-v2-met-attr-tokens-detail">
                    {t('agentConsole.v2.met.attrTokTip', {
                      in: fmtInt(unattrTokens.total_input),
                      out: fmtInt(unattrTokens.total_output),
                      cache: fmtInt(unattrTokens.total_cache_read),
                      reason: fmtInt(unattrTokens.total_reasoning),
                    })}
                  </div>
                ) : null}
                {unattr?.note || attr?.note ? (
                  <div className="met-attr-note">{unattr?.note ?? attr?.note}</div>
                ) : null}
              </div>
            )}
            <div className="met-card-ft">{t('agentConsole.v2.met.attrFoot')}</div>
          </div>
        </div>
      </div>

      {/* declared gap: no tool/skill metering — a note, never an empty table */}
      <div className="met-toolnote" data-testid="agent-v2-met-toolnote">
        {t('agentConsole.v2.met.toolNote')}
      </div>
    </div>
  );
}