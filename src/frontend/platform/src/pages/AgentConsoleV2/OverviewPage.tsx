/* OV-01 redo: the /agent overview rebuilt against ov01-target.html +
 * OV01-TARGET-SPEC.md. Structure = page header (period chips + freshness),
 * 4 KPI cards with real spark slots (dots + 「无趋势源」 where no series
 * exists — never a fake curve), pending queue (three sources, actionable
 * rows only), 28-day stacked trend with legend/summary/P95 honesty/event
 * markers/today's partial-day frame, real 7×24 heat with hour axis, focus
 * row and current cell, merged cost & budget with the 30-cell quota grid,
 * anomalies derived from real aggregates, and an audit activity table with
 * localized names + mono raw values. Review annotations (参考屏 bar, dashed
 * demo row) are gone. Every number traces to an endpoint (E14/AP8/R6/P9/
 * R7/audit); nothing is aggregated client-side from paginated rows
 * (PARITY §3), and errors keep old values with an explicit reason instead
 * of a fabricated value. Page state survives refresh/share/back via
 * ?range=7d|28d|90d&weeks=1..12&focus=<block>. */
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useSearchParams } from 'react-router-dom';

import { userContext } from '@/contexts/userContext';

import {
  bucketSum,
  dayWindow,
  fetchActivity,
  fetchApprovalStats,
  fetchBudgetMonth,
  fetchEmployeeStats,
  fetchEmployeesPage,
  fetchRunStats,
  fmtUsd,
  isoDay,
  makeFetcher,
  monthPeriod,
  sparkPoints,
  type ActivityBody,
  type ApiRes,
  type ApprovalStats,
  type BudgetBody,
  type EmployeeRow,
  type EmployeeStats,
  type RunBucket,
  type RunStatsBody,
} from './v2Data';

import {
  ActivityBlock,
  AnomalyBlock,
  CostBudgetBlock,
  Icon,
  KpiDots,
  KpiSpark,
  QueueBlock,
  UsdValue,
  useElementWidth,
  type BlockState,
  type OverviewAuditBody,
  type OverviewQueueBody,
} from './OverviewBlocks';

const COST_ID_LIMIT = 100;

const pendingKpi = { loading: true, ok: false, status: 0 };

// fix A (G9): page state that must survive refresh / share / back lives in
// the URL: ?range=7d|28d|90d&weeks=1..12&focus=<block>. The SPEC pins the
// default window to 28 days (§2).
const RANGE_KEYS = ['7d', '28d', '90d'];
const RANGE_DAYS: Record<string, number> = { '7d': 7, '28d': 28, '90d': 90 };
/* KPI-3 is a fixed rolling 7-day card regardless of the trend period
 * (C1 audit item 5 + SPEC §3); the period chip only drives the trend card
 * and the delta footnote. SPEC §2 pins the DEFAULT period to 28 days. */
const KPI_RUN_DAYS = 7;
const DEFAULT_RANGE = '28d';
const FOCUS_TESTID: Record<string, string> = {
  header: 'agent-v2-ov-block-header',
  kpis: 'agent-v2-ov-block-kpis',
  queue: 'agent-v2-ov-queue',
  trend: 'agent-v2-ov-trend',
  heat: 'agent-v2-ov-heat',
  cost: 'agent-v2-ov-block-cost',
  anomaly: 'agent-v2-ov-block-anomaly',
  activity: 'agent-v2-ov-block-activity',
};
// fix B (G5): dow 1 = Monday in the R7 payload; row labels reuse the
// established weekday keys (same pattern as TrendsCostsSection DAY_ORDER).
const HEAT_DAY_KEYS = [
  'agentConsole.v2.dayMon',
  'agentConsole.v2.dayTue',
  'agentConsole.v2.dayWed',
  'agentConsole.v2.dayThu',
  'agentConsole.v2.dayFri',
  'agentConsole.v2.daySat',
  'agentConsole.v2.daySun',
] as const;
const HEAT_WEEK_OPTIONS = [4, 8, 12];
const AUDIT_WINDOW_LIMIT = 100;

interface QueueBody extends OverviewQueueBody {
  [key: string]: unknown;
}

function listKpi(res: ApiRes<QueueBody> | null): BlockState<QueueBody> {
  if (res === null) {
    return { loading: false, ok: false, status: 0, code: 'agent-console.no-uid' };
  }
  return { loading: false, ok: res.ok, status: res.status, code: res.code, data: res.data };
}

/* Beijing-time "now" pieces for heat focus row / current cell / quota today. */
function beijingNow(now = new Date()): { dow: number; hour: number; day: number } {
  const d = new Date(now.getTime() + 480 * 60000);
  const jsDay = d.getUTCDay(); // 0=Sun
  return {
    dow: jsDay === 0 ? 7 : jsDay, // 1=Mon … 7=Sun, matches R7 cells
    hour: d.getUTCHours(),
    day: d.getUTCDate(),
  };
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1 + 1, 0)).getUTCDate();
}

/* cumulative daily series from buckets (cost KPI spark mirrors target). */
function cumulativeSeries(daily: number[] | null): number[] | null {
  if (!daily) return null;
  let acc = 0;
  return daily.map((v) => (acc += v));
}

interface TrendDay {
  day: string; // YYYY-MM-DD (Beijing day the UTC bucket belongs to)
  ok: number;
  run: number;
  fail: number;
  cost: number | null;
  p95: number | null;
}

export function OverviewPage() {
  const { t } = useTranslation();
  const user = useContext(userContext)?.user;
  const uid = String(user?.user_id ?? '');
  const fetcher = useMemo(() => makeFetcher(), []);
  const [token, setToken] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  /* F-1: per-block last-success timestamps (failures keep the old time). */
  const [blockTimes, setBlockTimes] = useState<{ approvals: string | null; runs: string | null; heat: string | null }>({
    approvals: null,
    runs: null,
    heat: null,
  });
  /* H-4: minute tick so the >5min stale bar can appear without a fetch. */
  const [nowTick, setNowTick] = useState(0);
  const [stats, setStats] = useState<BlockState<EmployeeStats>>(pendingKpi);
  const [approvals, setApprovals] = useState<BlockState<ApprovalStats>>(pendingKpi);
  const [runs, setRuns] = useState<BlockState<RunStatsBody>>(pendingKpi);
  const [runs7, setRuns7] = useState<BlockState<RunStatsBody>>(pendingKpi);
  const [runsPrev, setRunsPrev] = useState<BlockState<RunStatsBody>>(pendingKpi);
  const [cost, setCost] = useState<BlockState<BudgetBody>>(pendingKpi);
  const [queueApprovals, setQueueApprovals] = useState<BlockState<QueueBody>>(pendingKpi);
  const [queueTasks, setQueueTasks] = useState<BlockState<QueueBody>>(pendingKpi);
  const [queueRuns, setQueueRuns] = useState<BlockState<QueueBody>>(pendingKpi);
  const [heat, setHeat] = useState<BlockState<ActivityBody>>(pendingKpi);
  const [quotaRows, setQuotaRows] = useState<EmployeeRow[]>([]);
  const [audit, setAudit] = useState<BlockState<OverviewAuditBody>>(pendingKpi);

  const refresh = useCallback(() => setToken((x) => x + 1), []);

  const [searchParams, setSearchParams] = useSearchParams();
  const rangeKey = RANGE_KEYS.find((k) => k === searchParams.get('range')) ?? DEFAULT_RANGE;
  const rangeDays = RANGE_DAYS[rangeKey];
  const weeksRaw = Number.parseInt(searchParams.get('weeks') ?? '', 10);
  const heatWeeks = HEAT_WEEK_OPTIONS.includes(weeksRaw) ? weeksRaw : 4;
  const focus = searchParams.get('focus');
  /* C2-F7: the URL is the page-state source; when any filter departs from
   * the default (range≠28d, weeks≠4, focus set) the header shows an
   * accessible 清除条件 control that strips the params in-place (router
   * state only — never a full reload). */
  const filtersActive =
    (searchParams.get('range') !== null && searchParams.get('range') !== DEFAULT_RANGE) ||
    (searchParams.get('weeks') !== null && searchParams.get('weeks') !== '4') ||
    (focus !== null && focus !== '');
  const clearFilters = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('range');
    next.delete('weeks');
    next.delete('focus');
    setSearchParams(next);
  }, [searchParams, setSearchParams]);
  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (value === null) next.delete(key);
      else next.set(key, value);
      setSearchParams(next);
    },
    [searchParams, setSearchParams]
  );

  // fix A (G9): ?focus=<block> scrolls the matching block into view; re-run
  // when fresh data lands so a shared link works before first paint too.
  // C2-F7: the focused block additionally keeps a persistent visible ring
  // (outline-only, zero layout shift) that survives refresh / direct links.
  useEffect(() => {
    document.querySelectorAll('.ov-focus-ring').forEach((el) => el.classList.remove('ov-focus-ring'));
    if (!focus) return;
    const testId = FOCUS_TESTID[focus];
    if (!testId) return;
    const el = document.querySelector(`[data-testid="${testId}"]`);
    if (el) {
      el.classList.add('ov-focus-ring');
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    }
  }, [focus, updatedAt]);

  useEffect(() => {
    let alive = true;
    setStats(pendingKpi);
    setApprovals(pendingKpi);
    setRuns(pendingKpi);
    setRuns7(pendingKpi);
    setRunsPrev(pendingKpi);
    setCost(pendingKpi);
    setQueueApprovals(pendingKpi);
    setQueueTasks(pendingKpi);
    setQueueRuns(pendingKpi);
    setHeat(pendingKpi);
    setQuotaRows([]);
    setAudit(pendingKpi);
    void (async () => {
      // The BFF caps day-bucket run-stats at a 90-day span and the UTC
      // floor in dayWindow() adds up to a day, so clamp the requested
      // window to 89 days: 90d then measures a <=90-day span instead of
      // 400 run.stats_range_too_large. The comparison window spans the
      // PREVIOUS statDays block ([2x floor, 1x floor]), keeping its own
      // span <=90 days and non-degenerate at the 90d clamp.
      const statDays = Math.min(rangeDays, 89);
      const windowCur = dayWindow(statDays);
      // KPI-3 + AL-5 use a FIXED rolling 7-day window (C1 audit item 5):
      // the 28-day period chip only drives the trend card.
      const window7 = dayWindow(KPI_RUN_DAYS);
      const window7Prev = { from: dayWindow(KPI_RUN_DAYS * 2).from, to: window7.from };
      const window24 = {
        from: new Date(Date.now() - 86400000).toISOString(),
        to: new Date().toISOString(),
      };
      const [s, a, r, r7, rp, ids, qa, qt, qr, h, au] = await Promise.all([
        fetchEmployeeStats(fetcher),
        uid ? fetchApprovalStats(fetcher, `human:${uid}`) : Promise.resolve(null),
        fetchRunStats(fetcher, { ...windowCur, bucket: 'day' }),
        // all-platform day buckets, NO employeeId filter (audit item 5:
        // the overview total must be completed 13 + running 1 = 14)
        fetchRunStats(fetcher, { ...window7, bucket: 'day' }),
        fetchRunStats(fetcher, { ...window7Prev, bucket: 'day' }),
        fetchEmployeesPage(fetcher, { limit: COST_ID_LIMIT, expand: 'version' }),
        uid
          ? fetcher<QueueBody>('/api/approvals', {
              assignee: `human:${uid}`,
              status: 'pending',
              limit: 5,
            })
          : Promise.resolve(null),
        // fix A (G3) + MUST 3: dueBefore alone is NOT "overdue" — the
        // contract does not say the filter excludes finished tasks, so the
        // query keeps assignee+dueBefore server-side and the row set drops
        // terminal states at render (QueueBlock.actionable).
        uid
          ? fetcher<QueueBody>('/api/tasks', {
              assignee: `human:${uid}`,
              dueBefore: window24.to,
              limit: 5,
            })
          : Promise.resolve(null),
        // fix A (G3): abnormal runs only — status=failed inside the rolling
        // 24h window (server-side filter, never client-side pseudo-filtering).
        fetcher<QueueBody>('/api/runs', { status: 'failed', since: window24.from, limit: 5 }),
        fetchActivity(fetcher, { weeks: heatWeeks, tz: 'Asia/Shanghai' }),
        // OV-01 redo: one audit fetch over the visible window feeds BOTH the
        // trend event markers and the 24h activity slice (display-side only).
        fetcher<OverviewAuditBody>('/api/audit', {
          from: windowCur.from,
          to: windowCur.to,
          limit: AUDIT_WINDOW_LIMIT,
        }),
      ]);
      if (!alive) return;
      setStats({ loading: false, ok: s.ok, status: s.status, code: s.code, data: s.data });
      setApprovals(
        a === null
          ? { loading: false, ok: false, status: 0, code: 'agent-console.no-uid' }
          : { loading: false, ok: a.ok, status: a.status, code: a.code, data: a.data }
      );
      setRuns({ loading: false, ok: r.ok, status: r.status, code: r.code, data: r.data });
      setRuns7({ loading: false, ok: r7.ok, status: r7.status, code: r7.code, data: r7.data });
      setRunsPrev({ loading: false, ok: rp.ok, status: rp.status, code: rp.code, data: rp.data });
      setQueueApprovals(listKpi(qa));
      setQueueTasks(listKpi(qt));
      setQueueRuns(listKpi(qr));
      setHeat({ loading: false, ok: h.ok, status: h.status, code: h.code, data: h.data });
      setQuotaRows(ids.data?.items ?? []);
      setAudit({ loading: false, ok: au.ok, status: au.status, code: au.code, data: au.data });
      const nowIso = new Date().toISOString();
      setBlockTimes((prev) => ({
        approvals: a !== null && a.ok ? nowIso : prev.approvals,
        runs: r.ok && r7.ok ? nowIso : prev.runs,
        heat: h.ok ? nowIso : prev.heat,
      }));
      // P9 requires an explicit employeeId list (BFF contract): resolve ids
      // from E11 first, then one batched month query. No silent "0.00".
      const empIds = (ids.data?.items ?? []).map((e) => e.employeeId);
      if (!ids.ok) {
        setCost({ loading: false, ok: false, status: ids.status, code: ids.code });
      } else if (empIds.length === 0) {
        setCost({ loading: false, ok: false, status: 0, code: 'agent-console.no-employees' });
      } else {
        const b = await fetchBudgetMonth(fetcher, empIds, monthPeriod());
        if (!alive) return;
        setCost({ loading: false, ok: b.ok, status: b.status, code: b.code, data: b.data });
      }
      if (alive) setUpdatedAt(new Date().toISOString());
    })();
    return () => {
      alive = false;
    };
  }, [fetcher, token, uid, rangeDays, heatWeeks]);

  // H-4: re-render every minute so the stale bar can appear without a fetch.
  useEffect(() => {
    const id = window.setInterval(() => setNowTick((v) => v + 1), 60000);
    return () => window.clearInterval(id);
  }, []);

  // H-3 / F-2: ⌘⇧R (or Ctrl+Shift+R) refreshes every block once.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && ev.key.toLowerCase() === 'r') {
        ev.preventDefault();
        refresh();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [refresh]);

  const stale =
    updatedAt !== null && Date.now() - new Date(updatedAt).getTime() > 5 * 60000 && nowTick >= 0;

  /* ---------------- derived, real-data-only ---------------- */

  const authExpired = [stats, approvals, runs, cost].some(
    (k) => k.status === 401 || k.code === 'console.unauthenticated'
  );
  const runSums = bucketSum(runs.data?.buckets);
  const run7Sums = bucketSum(runs7.data?.buckets);
  /* MUST 2: 14 = 13 succeeded + 0 failed + 1 running/unknown — the residual
   * is always spelled out; buckets may also carry unknownRuns directly.
   * KPI-3 / heat rollup / AL-5 read the FIXED 7-day window (C1 item 5). */
  const unknownRuns = useMemo(() => {
    if (!runs7.ok) return 0;
    const direct = (runs7.data?.buckets ?? []).reduce(
      (acc, b) => acc + (typeof b.unknownRuns === 'number' ? b.unknownRuns : 0),
      0
    );
    const sums = bucketSum(runs7.data?.buckets);
    const residual = Math.max(sums.runs - sums.succeeded - sums.failed, 0);
    return Math.max(direct, residual);
  }, [runs7]);
  const unknownTrend = useMemo(() => {
    if (!runs.ok) return 0;
    const direct = (runs.data?.buckets ?? []).reduce(
      (acc, b) => acc + (typeof b.unknownRuns === 'number' ? b.unknownRuns : 0),
      0
    );
    const residual = Math.max(runSums.runs - runSums.succeeded - runSums.failed, 0);
    return Math.max(direct, residual);
  }, [runs, runSums]);
  /* KPI-3 spark: REAL day buckets of the 7-day window (area, not flat). */
  const runsSpark = sparkPoints(runs7.data?.buckets, KPI_RUN_DAYS);
  const costDaily = useMemo(() => {
    if (!runs7.data?.buckets) return null;
    const byDay = new Map<string, number>();
    for (const b of runs7.data.buckets) {
      if (typeof b.costUsd === 'number' && Number.isFinite(b.costUsd)) {
        const day = isoDay(b.bucketStart);
        byDay.set(day, (byDay.get(day) ?? 0) + b.costUsd);
      }
    }
    if (byDay.size === 0) return null;
    const out: number[] = [];
    const now = Date.now();
    for (let i = KPI_RUN_DAYS - 1; i >= 0; i -= 1) {
      out.push(byDay.get(isoDay(new Date(now - i * 86400000).toISOString())) ?? 0);
    }
    return out;
  }, [runs7]);
  const costSpark = cumulativeSeries(costDaily);

  const bj = beijingNow();
  const monthNow = (() => {
    const d = new Date(new Date().getTime() + 480 * 60000);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth(),
      label: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      days: daysInMonth(d.getUTCFullYear(), d.getUTCMonth()),
    };
  })();

  const dayCosts = useMemo(() => {
    const out = new Map<number, number>();
    for (const b of runs.data?.buckets ?? []) {
      if (typeof b.costUsd === 'number' && Number.isFinite(b.costUsd)) {
        const day = isoDay(b.bucketStart);
        if (day.startsWith(monthNow.label)) {
          const n = Number(day.slice(8, 10));
          out.set(n, (out.get(n) ?? 0) + b.costUsd);
        }
      }
    }
    return out;
  }, [runs, monthNow]);

  const prevSums = runsPrev.ok ? bucketSum(runsPrev.data?.buckets) : null;
  const deltaRuns = prevSums ? run7Sums.runs - prevSums.runs : null;

  /* trend bars: R6 returns only non-empty buckets — missing days stay empty,
   * never back-filled with zeros (§2.4). */
  const trendBars: TrendDay[] | null = useMemo(() => {
    if (!runs.ok || !runs.data) return null;
    const byDay = new Map<string, RunBucket>();
    for (const bucket of runs.data.buckets ?? []) {
      byDay.set(isoDay(bucket.bucketStart), bucket);
    }
    const days: TrendDay[] = [];
    const now = Date.now();
    for (let i = rangeDays - 1; i >= 0; i -= 1) {
      const day = isoDay(new Date(now - i * 86400000).toISOString());
      const b = byDay.get(day);
      const okCount = b?.succeeded ?? 0;
      const fail = b?.failed ?? 0;
      const run = b ? Math.max((b.runs ?? 0) - okCount - fail, 0) : 0;
      days.push({
        day,
        ok: okCount,
        run,
        fail,
        cost: typeof b?.costUsd === 'number' ? b.costUsd : null,
        // fix B (G4): missing key = sample <20 = break in the line, never 0.
        p95: typeof b?.p95DurationMs === 'number' ? b.p95DurationMs : null,
      });
    }
    return days;
  }, [runs, rangeDays]);

  const p95HasSample = trendBars ? trendBars.some((d) => d.p95 !== null) : false;

  /* event markers per day from the audited window (real events only) */
  const eventsByDay = useMemo(() => {
    const out = new Map<string, string>();
    if (!audit.ok) return out;
    const acc = new Map<string, Map<string, number>>();
    for (const ev of audit.data?.events ?? []) {
      const time = typeof ev.occurredAt === 'string' ? ev.occurredAt : null;
      const action = typeof ev.action === 'string' ? ev.action : null;
      if (!time || !action) continue;
      const day = isoDay(time);
      if (!acc.has(day)) acc.set(day, new Map());
      const m = acc.get(day) as Map<string, number>;
      m.set(action, (m.get(action) ?? 0) + 1);
    }
    /* C1 item 6/10: marker labels are localized names (never raw snake_case
     * on the canvas); unknown actions fall back to the generic audit copy. */
    const zhName = (a: string) => {
      const key = `agentConsole.v2.ov.actions.${a.replace(/\./g, '_')}`;
      const name = t(key);
      return name === key ? t('agentConsole.v2.ov.eventUnknown') : name;
    };
    for (const [day, m] of acc) {
      const names = Array.from(new Set(Array.from(m.keys()).map(zhName))).slice(0, 2);
      out.set(day, names.join(' · '));
    }
    return out;
  }, [audit, t]);

  const heatGrid = useMemo(() => {
    if (!heat.ok || !heat.data) return null;
    const counts = new Map<string, number>();
    for (const cell of heat.data.cells ?? []) {
      counts.set(`${cell.dow}:${cell.hour}`, cell.count);
    }
    const max = Math.max(heat.data.max ?? 0, ...Array.from(counts.values()), 1);
    const rows: { dow: number; hour: number; count: number }[] = [];
    let total = 0;
    let nightTotal = 0;
    let peak: { dow: number; hour: number; count: number } | null = null;
    for (let dow = 1; dow <= 7; dow += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        const count = counts.get(`${dow}:${hour}`) ?? 0;
        total += count;
        if (hour <= 6) nightTotal += count;
        if (!peak || count > peak.count) peak = { dow, hour, count };
        rows.push({ dow, hour, count });
      }
    }
    return { rows, total, max, peak: peak && peak.count > 0 ? peak : null, nightTotal };
  }, [heat]);

  const terminalForRate = runSums.succeeded + runSums.failed;
  const successRate = runs.ok && terminalForRate > 0 ? ((runSums.succeeded / terminalForRate) * 100).toFixed(1) : null;
  const windowLabel = t(`agentConsole.v2.ov.range${rangeKey}`);
  const rangeShort = RANGE_DAYS[rangeKey] <= 28 ? '7' : String(rangeDays);

  const budgetOverCount = useMemo(() => {
    let over = 0;
    let withDenom = 0;
    const costOf = new Map<string, number | null | undefined>();
    for (const item of cost.data?.items ?? []) costOf.set(item.employeeId, item.costUsd);
    for (const row of quotaRows) {
      const denom = row.enrichment?.effectiveBudget?.monthlyCostUsd;
      const value = costOf.get(row.employeeId);
      if (typeof denom === 'number' && denom > 0 && typeof value === 'number') {
        withDenom += 1;
        if (value / denom >= 0.85) over += 1;
      }
    }
    return withDenom === 0 ? null : over;
  }, [cost, quotaRows]);
  const budgetEmpCount = quotaRows.length;

  return (
    <div className="a2s-page ov-page" data-testid="agent-v2-ov-page">
      {stale ? (
        <div className="ov-stale" data-testid="agent-v2-ov-stale" role="status">
          {t('agentConsole.v2.ov.staleBar')}
        </div>
      ) : null}
      {/* ① page head — no write buttons (OV-02…05) */}
      <div data-testid="agent-v2-ov-block-header">
        <div className="ov-phead">
          <div>
            <h1 className="a2-h1">{t('agentConsole.v2.ov.title')}</h1>
            <p className="ov-sub">{t('agentConsole.v2.ov.ovSubtitle')}</p>
          </div>
          <span className="sp" />
          <div className="ov-seg" role="group" aria-label={t('agentConsole.v2.ov.rangeTitle')} data-testid="agent-v2-ov-range">
            {RANGE_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                data-testid={`agent-v2-ov-range-${k}`}
                aria-pressed={k === rangeKey}
                onClick={() => updateParam('range', k === DEFAULT_RANGE ? null : k)}
              >
                {t(`agentConsole.v2.ov.range${k}`)}
              </button>
            ))}
          </div>
          {filtersActive ? (
            <button
              type="button"
              className="a2-btn ov-clear-filters"
              data-testid="agent-v2-ov-clear-filters"
              onClick={clearFilters}
            >
              {t('agentConsole.v2.ov.clearFilters')}
            </button>
          ) : null}
          <button type="button" className="a2-btn ov-refresh" data-testid="agent-v2-ov-refresh" onClick={refresh}>
            <Icon name="refresh" size={16} />
            {t('agentConsole.v2.ov.refresh')}
          </button>
        </div>
        <div className="ov-fresh">
          <Icon name="clock" size={13} />
          {updatedAt ? (
            <span data-testid="agent-v2-ov-updated">
              {t('agentConsole.v2.ov.updatedLine', { time: fmtTimeShort(updatedAt) })}
            </span>
          ) : (
            <span>…</span>
          )}
          <span className="faint">·</span>
          <span>
            {t('agentConsole.v2.ov.windowNote', { short: rangeShort, long: String(rangeDays) })}
          </span>
        </div>
        {authExpired ? (
          <p className="a2-meta" data-testid="agent-v2-ov-auth-expired">
            {t('agentConsole.v2.ov.sessionExpired')}
          </p>
        ) : null}
      </div>

      {/* ② 4 KPI cards — every card keeps spark + delta slots (V2.1) */}
      <div className="ov-kpis" data-testid="agent-v2-ov-block-kpis">
        {/* 在岗员工 */}
        <div className="ov-card ov-kpi" data-testid="agent-v2-ov-kpi-onduty">
          <NavLink className="ov-kpi-link" to="/agent/employees?lifecycle=active&src=ov" aria-label={`${t('agentConsole.v2.ov.kpiOnDuty')} →`} />
          <span className="a2-micro">{t('agentConsole.v2.ov.kpiOnDuty')}</span>
          <div className="ov-kr">
            {stats.loading ? (
              <span className="ov-v">…</span>
            ) : stats.ok ? (
              <>
                <span className="ov-v">{stats.data?.byLifecycle?.active ?? '—'}</span>
                <KpiDots testId="agent-v2-ov-kpi-onduty-dots" />
              </>
            ) : null}
          </div>
          {stats.ok ? (
            <span className="ov-kn">
              <span className="ov-dtl flat">—</span>
              {t('agentConsole.v2.ov.kpiNoTrend')} ·{' '}
              {t('agentConsole.v2.ov.kpiOnDutyFoot', { total: stats.data?.total ?? 0 })}
            </span>
          ) : stats.loading ? null : (
            <span className="ov-kn">
              <span className="a2-meta" data-testid="agent-v2-ov-kpi-onduty-error">
                {t('agentConsole.v2.ov.blockUnavailable', {
                  block: t('agentConsole.v2.ov.kpiOnDuty'),
                  code: stats.status,
                })}
              </span>
              <button type="button" className="a2-btn ov-xs" data-testid="agent-v2-ov-retry-kpi-onduty" onClick={refresh}>
                {t('agentConsole.v2.ov.retry')}
              </button>
            </span>
          )}
        </div>

        {/* 待我审批 */}
        <div className="ov-card ov-kpi" data-testid="agent-v2-ov-kpi-pending">
          <NavLink className="ov-kpi-link" to="/agent/approvals?status=pending&src=ov" aria-label={`${t('agentConsole.v2.ov.kpiPending')} →`} />
          <span className="a2-micro">{t('agentConsole.v2.ov.kpiPending')}</span>
          <div className="ov-kr">
            {approvals.loading ? (
              <span className="ov-v">…</span>
            ) : approvals.ok ? (
              <>
                <span className="ov-v">{approvals.data?.pending ?? '—'}</span>
                <KpiDots testId="agent-v2-ov-kpi-pending-dots" />
              </>
            ) : null}
          </div>
          {approvals.ok ? (
            <span className="ov-kn">
              <span className="ov-dtl flat">—</span>
              {t('agentConsole.v2.ov.kpiNoTrend')} ·{' '}
              {(approvals.data?.dueSoon ?? 0) > 0
                ? t('agentConsole.v2.ov.noteDueSoon', { count: approvals.data?.dueSoon ?? 0 })
                : t('agentConsole.v2.ov.kpiNoDueToday')}
            </span>
          ) : approvals.loading ? null : (
            <span className="ov-kn">
              <span className="a2-meta" data-testid="agent-v2-ov-kpi-pending-error">
                {approvals.code === 'agent-console.no-uid'
                  ? t('agentConsole.v2.ov.noteNoUid')
                  : t('agentConsole.v2.ov.blockUnavailable', {
                      block: t('agentConsole.v2.ov.kpiPending'),
                      code: approvals.status,
                    })}
              </span>
              <button type="button" className="a2-btn ov-xs" data-testid="agent-v2-ov-retry-kpi-pending" onClick={refresh}>
                {t('agentConsole.v2.ov.retry')}
              </button>
            </span>
          )}
        </div>

        {/* 近 7 天运行（固定 7 天窗口，不随期间段变化 — C1 item 5） */}
        <div className="ov-card ov-kpi" data-testid="agent-v2-ov-kpi-runs">
          <NavLink className="ov-kpi-link" to="/agent/runs?src=ov" aria-label={`${t('agentConsole.v2.ov.kpiWeekRuns')} →`} />
          <span className="a2-micro">{t('agentConsole.v2.ov.kpiWeekRuns')}</span>
          <div className="ov-kr">
            {runs7.loading ? (
              <span className="ov-v">…</span>
            ) : runs7.ok ? (
              <>
                <span className="ov-v" data-testid="agent-v2-ov-kpi-runs-value">{run7Sums.runs}</span>
                {runsSpark ? (
                  <KpiSpark points={runsSpark} testId="agent-v2-ov-kpi-runs-spark" />
                ) : (
                  <KpiDots testId="agent-v2-ov-kpi-runs-dots" />
                )}
              </>
            ) : null}
          </div>
          {runs7.ok ? (
            <span className="ov-kn">
              {deltaRuns != null && deltaRuns !== 0 ? (
                <span className={`ov-dtl ${deltaRuns > 0 ? 'up' : 'dwn'}`}>
                  {deltaRuns > 0 ? <Icon name="trend" size={13} /> : null}
                  {deltaRuns > 0 ? `+${deltaRuns}` : deltaRuns}
                </span>
              ) : (
                <span className="ov-dtl flat">—</span>
              )}
              {prevSums
                ? t('agentConsole.v2.ov.trendVsPrevCount', { days: KPI_RUN_DAYS, prev: prevSums.runs })
                : t('agentConsole.v2.ov.kpiNoTrend')}
              {' · '}
              {t('agentConsole.v2.trendSucceeded')} {run7Sums.succeeded} · {t('agentConsole.v2.trendFailed')}{' '}
              {run7Sums.failed}
              {unknownRuns > 0 ? (
                <>
                  {' · '}
                  <em data-testid="agent-v2-ov-kpi-runs-unknown">
                    {t('agentConsole.v2.ov.runsUnknown', { count: unknownRuns })}
                  </em>
                </>
              ) : null}
            </span>
          ) : runs7.loading ? null : (
            <span className="ov-kn">
              <span className="a2-meta" data-testid="agent-v2-ov-kpi-runs-error">
                {t('agentConsole.v2.ov.blockUnavailable', {
                  block: t('agentConsole.v2.ov.kpiWeekRuns'),
                  code: runs7.status,
                })}
              </span>
              <button type="button" className="a2-btn ov-xs" data-testid="agent-v2-ov-retry-kpi-runs" onClick={refresh}>
                {t('agentConsole.v2.ov.retry')}
              </button>
            </span>
          )}
        </div>

        {/* 本月成本 */}
        <div className="ov-card ov-kpi" data-testid="agent-v2-ov-kpi-cost">
          <a className="ov-kpi-link" href="#ov-cost" aria-label={`${t('agentConsole.v2.ov.kpiMonthCost')} →`} />
          <span className="a2-micro">{t('agentConsole.v2.ov.kpiMonthCost')}</span>
          <div className="ov-kr">
            {cost.loading ? (
              <span className="ov-v">…</span>
            ) : cost.ok ? (
              <>
                <UsdValue
                  value={sumItems(cost.data?.items)}
                  big
                />
                {costSpark ? (
                  <KpiSpark points={costSpark} testId="agent-v2-ov-kpi-cost-spark" />
                ) : (
                  <KpiDots testId="agent-v2-ov-kpi-cost-dots" />
                )}
              </>
            ) : null}
          </div>
          {cost.ok ? (
            <>
              {quotaLimit(quotaRows) != null ? (
                <QuotaSegmentsThin
                  dayCosts={dayCosts}
                  monthDays={monthNow.days}
                  today={bj.day}
                  limit={quotaLimit(quotaRows) as number}
                />
              ) : null}
              <span className="ov-kn">
                <span className="ov-dtl flat">—</span>
                {quotaLimit(quotaRows) != null
                  ? t('agentConsole.v2.ov.quotaPctFoot', {
                      pct:
                        sumItems(cost.data?.items) != null
                          ? `${((sumItems(cost.data?.items) as number) / (quotaLimit(quotaRows) as number) * 100).toFixed(1)}%`
                          : '—',
                      used: fmtUsd(sumItems(cost.data?.items)),
                      // target wording: 「USD 0.13 / 20.00」— the limit carries
                      // no second USD prefix.
                      limit: (quotaLimit(quotaRows) as number).toFixed(2),
                    })
                  : t('agentConsole.v2.ov.noteLedger')}
              </span>
            </>
          ) : cost.loading ? null : (
            <span className="ov-kn">
              <span className="a2-meta" data-testid="agent-v2-ov-kpi-cost-error">
                {cost.code === 'agent-console.no-employees'
                  ? t('agentConsole.v2.ov.noteNoEmployees')
                  : t('agentConsole.v2.ov.blockUnavailable', {
                      block: t('agentConsole.v2.ov.kpiMonthCost'),
                      code: cost.status,
                    })}
              </span>
              <button type="button" className="a2-btn ov-xs" data-testid="agent-v2-ov-retry-kpi-cost" onClick={refresh}>
                {t('agentConsole.v2.ov.retry')}
              </button>
            </span>
          )}
        </div>
      </div>

      {/* ③ queue + ④ trend */}
      <div className="ov-row">
        <div className="ov-c5">
          <QueueBlock
            sources={[
              {
                id: 'approvals',
                icon: 'clip',
                title: t('agentConsole.v2.ov.queueApprovals'),
                unitKey: 'queueUnitOrders',
                hintKey: 'queueHintApprovals',
                goKey: 'queueGoApprovals',
                to: '/agent/approvals',
                state: queueApprovals,
                truthCount: approvals.ok ? (approvals.data?.pending ?? null) : null,
              },
              {
                id: 'runs',
                icon: 'act',
                title: t('agentConsole.v2.ov.queueAbnormalRuns'),
                unitKey: 'queueUnitRuns',
                hintKey: 'queueHintRuns',
                goKey: 'queueGoRuns',
                to: '/agent/runs',
                state: queueRuns,
              },
              {
                id: 'tasks',
                icon: 'clock',
                title: t('agentConsole.v2.ov.queueOverdueTasks'),
                unitKey: 'queueUnitTasks',
                hintKey: 'queueHintTasks',
                goKey: 'queueGoTasks',
                to: '/agent/tasks',
                state: queueTasks,
              },
            ]}
            onRetry={refresh}
          />
        </div>
        <div className="ov-c7">
          <TrendCard
            runs={runs}
            bars={trendBars}
            rangeDays={rangeDays}
            windowLabel={windowLabel}
            sums={runSums}
            unknown={unknownTrend}
            successRate={successRate}
            p95HasSample={p95HasSample}
            events={eventsByDay}
            todayDay={isoDay(new Date().toISOString())}
            onRetry={refresh}
          />
        </div>
      </div>

      {/* ⑤ 7×24 heat */}
      <HeatCard
        heat={heat}
        grid={heatGrid}
        weeks={heatWeeks}
        onWeeks={(w) => updateParam('weeks', w === 4 ? null : String(w))}
        onRetry={refresh}
        focusDow={bj.dow}
        focusHour={bj.hour}
        unknown={unknownRuns}
        sums={run7Sums}
      />

      {/* ⑥ cost + ⑦ anomaly */}
      <div className="ov-row">
        <div className="ov-c7">
          <CostBudgetBlock
            cost={cost}
            rows={quotaRows}
            dayCosts={dayCosts}
            monthLabel={monthNow.label}
            monthDays={monthNow.days}
            todayDay={bj.day}
            unknownRuns={unknownRuns}
            onRetry={refresh}
          />
        </div>
        <div className="ov-c5">
          <AnomalyBlock
            runs={runs7}
            approvals={approvals}
            windowLabel={windowLabel}
            unknownRuns={unknownRuns}
            budgetOverCount={budgetOverCount}
            budgetEmpCount={budgetEmpCount}
            scannedAt={updatedAt}
            onRetry={refresh}
          />
        </div>
      </div>

      {/* ⑧ recent activity */}
      <ActivityBlock audit={audit} onRetry={refresh} />

      {/* footer (OV-F0…F2) */}
      <div className="ov-pfoot">
        <span data-testid="agent-v2-ov-footer-fresh">
          {t('agentConsole.v2.ov.footerFreshness', {
            approvals: blockTimes.approvals ? fmtTimeShort(blockTimes.approvals) : '—',
            runs: blockTimes.runs ? fmtTimeShort(blockTimes.runs) : '—',
            cost: costAt(cost) ? fmtTimeShort(costAt(cost)) : '—',
            heat: blockTimes.heat ? fmtTimeShort(blockTimes.heat) : '—',
          })}
        </span>
        <span className="sp" />
        <span>{t('agentConsole.v2.ov.footerCaliber')}</span>
        <span className="sp" />
        <span data-testid="agent-v2-ov-footer-keys">
          {/* S3: the ⌘K search hint left with the dead global-search pill. */}
          <kbd>⌘⇧R</kbd> {t('agentConsole.v2.ov.refresh')}
        </span>
      </div>
    </div>
  );
}

/* ---------------- helpers ---------------- */

function sumItems(items: BudgetBody['items'] | undefined): number | null {
  let sum: number | null = null;
  for (const item of items ?? []) {
    if (typeof item.costUsd === 'number' && Number.isFinite(item.costUsd)) sum = (sum ?? 0) + item.costUsd;
  }
  return sum;
}

function quotaLimit(rows: EmployeeRow[]): number | null {
  let acc = 0;
  let seen = false;
  for (const row of rows) {
    const d = row.enrichment?.effectiveBudget?.monthlyCostUsd;
    if (typeof d === 'number' && d > 0) {
      acc += d;
      seen = true;
    }
  }
  return seen ? acc : null;
}

function costAt(cost: BlockState<BudgetBody>): string | null {
  if (!cost.ok) return null;
  let latest: string | null = null;
  for (const item of cost.data?.items ?? []) {
    if (typeof item.updatedAt === 'string' && (!latest || item.updatedAt > latest)) latest = item.updatedAt;
  }
  return latest;
}

function fmtTimeShort(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(new Date(iso).getTime() + 480 * 60000);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(
    d.getUTCHours()
  ).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/* thin quota for the cost KPI card (same segments, compact) */
function QuotaSegmentsThin({
  dayCosts,
  monthDays,
  today,
  limit,
}: {
  dayCosts: Map<number, number>;
  monthDays: number;
  today: number;
  limit: number;
}) {
  const { t } = useTranslation();
  const daily = limit / monthDays;
  return (
    <div className="ov-seg30 is-thin" data-testid="agent-v2-ov-kpi-cost-quota" role="img" aria-label={t('agentConsole.v2.ov.quotaPctFoot', { pct: '—', used: '—', limit: fmtUsd(limit) })}>
      {Array.from({ length: monthDays }, (_, i) => {
        const day = i + 1;
        const cost = dayCosts.get(day) ?? 0;
        const pct = cost > 0 ? (cost / daily) * 100 : 0;
        const cls = cost > 0 ? (pct <= 60 ? 'is-a' : pct <= 85 ? 'is-b' : 'is-c') : '';
        const label = String(day).padStart(2, '0');
        const title =
          cost > 0
            ? t('agentConsole.v2.ov.quotaCellFoot', { day: label, cost: fmtUsd(cost), daily: fmtUsd(daily), pct: `${Math.round(pct)}%` })
            : day > today
              ? t('agentConsole.v2.ov.quotaCellFuture', { day: label })
              : t('agentConsole.v2.ov.quotaCellIdle', { day: label });
        return <i key={day} className={cls} title={title} />;
      })}
    </div>
  );
}

/* ---------------- trend card (OV-20…26) ---------------- */

// JS getDay() order (0=Sun) → i18n weekday keys.
const DAY_KEYS_JS = [
  'agentConsole.v2.daySun',
  'agentConsole.v2.dayMon',
  'agentConsole.v2.dayTue',
  'agentConsole.v2.dayWed',
  'agentConsole.v2.dayThu',
  'agentConsole.v2.dayFri',
  'agentConsole.v2.daySat',
];

function TrendCard({
  runs,
  bars,
  rangeDays,
  windowLabel,
  sums,
  unknown,
  successRate,
  p95HasSample,
  events,
  todayDay,
  onRetry,
}: {
  runs: BlockState<RunStatsBody>;
  bars: TrendDay[] | null;
  rangeDays: number;
  windowLabel: string;
  sums: { runs: number; succeeded: number; failed: number };
  unknown: number;
  successRate: string | null;
  p95HasSample: boolean;
  events: Map<string, string>;
  todayDay: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const [boxRef, measured] = useElementWidth<HTMLDivElement>();
  const [tip, setTip] = useState<{ i: number; left: number } | null>(null);
  /* C1 item 1: the svg is drawn ONLY at the measured container width — no
   * 900px intrinsic fallback that widens the document at 1440/375. */
  const W = measured;
  const H = 224;
  const pl = 34;
  const pr = 12;
  const pt = 24;
  const pb = 22;
  const iw = Math.max(W - pl - pr, 60);
  const ih = H - pt - pb;
  const slot = iw / Math.max(rangeDays, 1);
  const bw = Math.min(16, Math.max(slot - 6, 3));
  const maxTot = Math.max(5, Math.ceil(Math.max(1, ...(bars ?? []).map((d) => d.ok + d.run + d.fail)) / 5) * 5);

  let chart: React.ReactNode = null;
  if (bars && W > 0) {
    const parts: React.ReactNode[] = [];
    const eventLabels: { x1: number; x2: number; y: number }[] = [];
    for (let k = 0; k <= 3; k += 1) {
      const y = pt + (ih * k) / 3;
      parts.push(<line key={`g${k}`} x1={pl} x2={W - pr} y1={y} y2={y + 0.5} className="ov-grid" />);
      parts.push(
        <text key={`l${k}`} x={pl - 8} y={y + 3.5} textAnchor="end" className="ov-svg-lbl">
          {Math.round(maxTot * (1 - k / 3))}
        </text>
      );
    }
    bars.forEach((d, i) => {
      const cx = pl + slot * i + slot / 2;
      let y = pt + ih;
      const segs: [number, number, string][] = [
        [d.ok, 1, 'var(--ov-chart-a)'],
        [d.run, 2, 'var(--ov-chart-b)'],
        [d.fail, 3, 'var(--ov-chart-c)'],
      ];
      for (const [v, key, fill] of segs) {
        if (!v) continue;
        const hh = Math.max(1.5, (ih * v) / maxTot);
        y -= hh;
        parts.push(
          <rect key={`b${i}-${key}`} x={cx - bw / 2} y={y} width={bw} height={hh} rx={2} fill={fill} />
        );
      }
      if (i % 4 === 0 || i === bars.length - 1) {
        parts.push(
          <text key={`x${i}`} x={cx} y={H - 6} textAnchor="middle" className="ov-svg-lbl">
            {d.day.slice(5)}
          </text>
        );
      }
      if (d.day === todayDay) {
        parts.push(
          <rect
            key={`td${i}`}
            x={cx - bw / 2 - 2}
            y={pt - 4}
            width={bw + 4}
            height={ih + 4}
            fill="none"
            stroke="var(--border)"
            strokeDasharray="2 3"
            data-testid="agent-v2-ov-trend-today-frame"
            rx={4}
          />
        );
      }
      const ev = events.get(d.day);
      if (ev) {
        /* C1 item 6 + r2 P1: anchor INSIDE the canvas (flip at the right
         * edge, centre-clamp as fallback) AND stagger vertically — adjacent
         * event days previously drew overlapping labels into gibberish.
         * Each label keeps its own dashed line; labels step down one tier
         * (12px) whenever the x-range collides with an already-placed label. */
        const est = ev.length * 10.5 + 10;
        const minX = pl + 4;
        const maxX = W - pr - 4;
        let tx = cx + 5;
        let anchor: 'start' | 'end' | 'middle' = 'start';
        if (tx + est > maxX) {
          tx = cx - 5;
          anchor = 'end';
        }
        if (anchor === 'end' && tx - est < minX) {
          tx = (minX + maxX) / 2;
          anchor = 'middle';
        }
        const boxOf = (x: number, a: 'start' | 'end' | 'middle') =>
          a === 'start' ? [x - 4, x + est] : a === 'end' ? [x - est, x + 4] : [x - est / 2, x + est / 2];
        let [x1, x2] = boxOf(tx, anchor);
        x1 = Math.max(minX, x1);
        x2 = Math.min(maxX, x2);
        let ly = pt - 11;
        for (let tier = 0; tier < 3; tier += 1) {
          const hit = eventLabels.some((b) => b.y === ly && b.x1 < x2 && b.x2 > x1);
          if (!hit) break;
          ly += 12;
        }
        eventLabels.push({ x1, x2, y: ly });
        parts.push(
          <g key={`ev${i}`}>
            <line x1={cx} x2={cx} y1={pt - 8} y2={pt + ih} stroke="var(--ov-chart-marker)" strokeDasharray="3 4" />
            <circle cx={cx} cy={pt - 8} r={2} fill="var(--ov-chart-marker)" />
            <text x={tx} y={ly} textAnchor={anchor} className="ov-svg-lbl">
              {ev}
            </text>
          </g>
        );
      }
    });
    bars.forEach((d, i) => {
      parts.push(
        <rect
          key={`hit${i}`}
          x={pl + slot * i}
          y={pt}
          width={slot}
          height={ih}
          fill="transparent"
          style={{ cursor: 'crosshair' }}
          onMouseEnter={() => setTip({ i, left: pl + slot * i + slot / 2 })}
          onMouseLeave={() => setTip(null)}
        />
      );
    });
    chart = (
      <>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', maxWidth: '100%' }} role="img" aria-label={t('agentConsole.v2.ov.trendTitle') + ` ${windowLabel}`}>
          {parts}
        </svg>
        {tip && bars[tip.i] ? (
          <div className="ov-tip on" style={{ left: Math.min(Math.max(tip.left - 88, 0), W - 176), top: pt + 20 }}>
            <div className="tt a2-mono">
              {bars[tip.i].day.slice(5)}{' '}
              {t(DAY_KEYS_JS[new Date(bars[tip.i].day + 'T00:00:00Z').getUTCDay()])}
              {bars[tip.i].day === todayDay ? ' · ' + t('agentConsole.v2.ov.trendTodayFrame') : ''}
            </div>
            <div className="tr">
              <i style={{ background: 'var(--ov-chart-a)' }} />
              {t('agentConsole.v2.trendSucceeded')}
              <b>{bars[tip.i].ok}</b>
            </div>
            <div className="tr">
              <i style={{ background: 'var(--ov-chart-b)' }} />
              {t('agentConsole.v2.ov.trendLegendUnknown')}
              <b>{bars[tip.i].run}</b>
            </div>
            <div className="tr">
              <i style={{ background: 'var(--ov-chart-c)' }} />
              {t('agentConsole.v2.trendFailed')}
              <b>{bars[tip.i].fail}</b>
            </div>
            <div className="tr muted">
              P95
              <b>{bars[tip.i].p95 != null ? `${(bars[tip.i].p95 as number) / 1000}s` : t('agentConsole.v2.ov.p95Insufficient')}</b>
            </div>
            <div className="tr muted">
              {t('agentConsole.v2.ov.colCost')}
              <b>{bars[tip.i].cost != null ? fmtUsd(bars[tip.i].cost) : '—'}</b>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="ov-card" data-testid="agent-v2-ov-trend">
      <div className="ov-card-hd">
        <span className="t">{t('agentConsole.v2.ov.trendTitle')}</span>
        <span className="c">{windowLabel}</span>
        <span className="sp" />
        <span className="ov-clegend">
          <span>
            <i style={{ background: 'var(--ov-chart-a)' }} />
            {t('agentConsole.v2.trendSucceeded')}
          </span>
          <span>
            <i style={{ background: 'var(--ov-chart-b)' }} />
            {t('agentConsole.v2.ov.trendLegendUnknown')}
          </span>
          <span>
            <i style={{ background: 'var(--ov-chart-c)' }} />
            {t('agentConsole.v2.trendFailed')}
          </span>
          <span className={p95HasSample ? '' : 'off'} data-testid="agent-v2-ov-trend-legend-p95">
            <i className="lb" />
            {t('agentConsole.v2.trendP95')}
            {p95HasSample ? '' : `（${t('agentConsole.v2.ov.p95Insufficient')}，${t('agentConsole.v2.ov.p95NotDrawn')}）`}
          </span>
          <span>
            <i className="mk" />
            {t('agentConsole.v2.ov.trendLegendEvent')}
          </span>
        </span>
      </div>
      {runs.loading ? (
        <div className="ov-scan">…</div>
      ) : !runs.ok ? (
        <div className="ov-buds">
          <p className="a2-meta" data-testid="agent-v2-ov-trend-error">
            {t('agentConsole.v2.ov.blockUnavailable', {
              block: t('agentConsole.v2.ov.trendTitle'),
              code: runs.status,
            })}
          </p>
          <button type="button" className="a2-btn" data-testid="agent-v2-ov-retry-trend" onClick={onRetry}>
            {t('agentConsole.v2.ov.retry')}
          </button>
        </div>
      ) : bars === null || sums.runs === 0 ? (
        <div className="ov-buds">
          <p className="a2-meta" data-testid="agent-v2-ov-trend-empty">
            {t('agentConsole.v2.ov.trendEmptyWindow')}
          </p>
          <NavLink className="ov-lnk" to="/agent/runs">
            {t('agentConsole.v2.ov.trendGoRuns')}
            <Icon name="arrow" size={13} />
          </NavLink>
        </div>
      ) : (
        <>
          <div className="ov-tsum" data-testid="agent-v2-ov-trend-summary">
            <b>{sums.runs}</b>
            <i>{t('agentConsole.v2.ov.trendSumTimes')}</i>
            <b>{sums.succeeded}</b>
            <i>{t('agentConsole.v2.trendSucceeded')}</i>
            <b>{sums.failed}</b>
            <i>{t('agentConsole.v2.trendFailed')}</i>
            {unknown > 0 ? (
              <b className="wr">{t('agentConsole.v2.ov.runsUnknown', { count: unknown })}</b>
            ) : null}
            <i>{t('agentConsole.v2.ov.trendSumUnknown')}</i>
            <b>{successRate != null ? `${successRate}%` : '—'}</b>
            <i>{t('agentConsole.v2.ov.trendSumRate')}</i>
            <b>—</b>
            <i>{t('agentConsole.v2.ov.trendSumP95')}</i>
          </div>
          <div className="ov-cbox" ref={boxRef} data-testid="agent-v2-ov-trend-bars">{chart}</div>
          <div className="ov-rule" />
          <div className="ov-rfoot">
            <span className="lg" data-testid="agent-v2-ov-trend-foot">
              {t('agentConsole.v2.ov.trendFoot', { succeeded: sums.succeeded, failed: sums.failed })}
              {unknown > 0
                ? ` · ${t('agentConsole.v2.ov.trendFootUnknown', { count: unknown, total: sums.runs })}`
                : ''}
              {` · ${t('agentConsole.v2.ov.utcBucketNote')}`}
            </span>
            <span className="sp" />
            <span className="lg">{t('agentConsole.v2.ov.trendTodayFrame')}</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- heat card (OV-40…48): real 7×24 ---------------- */

function HeatCard({
  heat,
  grid,
  weeks,
  onWeeks,
  onRetry,
  focusDow,
  focusHour,
  unknown,
  sums,
}: {
  heat: BlockState<ActivityBody>;
  grid: {
    rows: { dow: number; hour: number; count: number }[];
    total: number;
    max: number;
    peak: { dow: number; hour: number; count: number } | null;
    nightTotal: number;
  } | null;
  weeks: number;
  onWeeks: (w: number) => void;
  onRetry: () => void;
  focusDow: number;
  focusHour: number;
  unknown: number;
  sums: { runs: number; succeeded: number; failed: number };
}) {
  const { t } = useTranslation();
  /* C1 item 7: ABSOLUTE count → tier mapping (same curve as the target),
   * so 1→l1, 5→l2, 8→l3 always colour identically against real buckets;
   * a max-proportional scale used to recolour the same 8-count differently. */
  const level = (count: number) => {
    if (count <= 0) return '';
    if (count <= 2) return 'l1';
    if (count <= 5) return 'l2';
    if (count <= 9) return 'l3';
    if (count <= 14) return 'l4';
    return 'l5';
  };
  /* Contradiction fix: the number and the note now come from the SAME
   * nightTotal — 0 renders 「0 次/时 + 窗口内没有夜间运行」, never 0.4 vs 无. */
  const nightZero = !grid || grid.nightTotal === 0;
  const nightAvg = nightZero ? '0' : (grid.nightTotal / (7 * weeks)).toFixed(1);
  const peakRowTotal = grid?.peak
    ? grid.rows.filter((r) => r.dow === grid.peak?.dow).reduce((acc, r) => acc + r.count, 0)
    : 0;
  return (
    <div className="ov-card ov-c12" data-testid="agent-v2-ov-heat">
      <div className="ov-card-hd">
        <span className="t">{t('agentConsole.v2.ov.heatTitle')}</span>
        <span className="c">{t('agentConsole.v2.ov.weeksOption', { count: weeks })}</span>
        <span className="sp" />
        <span className="hd-note">
          {heat.data?.from && heat.data?.to
            ? t('agentConsole.v2.ov.heatCaliberLine', {
                from: fmtTimeShort(heat.data.from),
                to: fmtTimeShort(heat.data.to),
              })
            : t('agentConsole.v2.ov.heatCaliber')}
        </span>
        <span className="ov-seg sm" role="group" aria-label={t('agentConsole.v2.ov.weeksLabel')} data-testid="agent-v2-ov-weeks">
          {HEAT_WEEK_OPTIONS.map((w) => (
            <button
              key={w}
              type="button"
              data-testid={`agent-v2-ov-weeks-${w}`}
              aria-pressed={w === weeks}
              onClick={() => onWeeks(w)}
            >
              {t('agentConsole.v2.ov.weeksOption', { count: w })}
            </button>
          ))}
        </span>
      </div>
      {heat.loading ? (
        <div className="ov-scan">…</div>
      ) : !heat.ok ? (
        <div className="ov-buds">
          <p className="a2-meta" data-testid="agent-v2-ov-heat-error">
            {t('agentConsole.v2.ov.blockUnavailable', {
              block: t('agentConsole.v2.ov.heatTitle'),
              code: heat.status,
            })}
          </p>
          <button type="button" className="a2-btn" data-testid="agent-v2-ov-retry-heat" onClick={onRetry}>
            {t('agentConsole.v2.ov.retry')}
          </button>
        </div>
      ) : grid === null ? (
        <p className="ov-empty-line" data-testid="agent-v2-ov-heat-empty">
          {t('agentConsole.v2.ov.heatEmpty', { count: weeks })}
        </p>
      ) : (
        <>
          <div className="ov-hwrap">
            <div className="ov-heat">
              <div className="ov-heat-g" data-testid="agent-v2-ov-heat-grid" role="img" aria-label={t('agentConsole.v2.ov.heatTotalLabel', { weeks }) + ` ${grid.total}`}>
                <div className="ov-hrow ov-hax">
                  <span className="ov-hl" />
                  <span className="ov-hcs">
                    {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
                      <i key={h} style={{ gridColumn: `${h + 1} / span 3` }}>
                        {String(h).padStart(2, '0')}
                      </i>
                    ))}
                  </span>
                </div>
                {HEAT_DAY_KEYS.map((dayKey, dayIdx) => {
                  const dow = dayIdx + 1;
                  const isNow = dow === focusDow;
                  return (
                    <div key={dayKey} className={`ov-hrow${isNow ? ' now' : ''}`}>
                      <span className="ov-hl" data-testid="agent-v2-ov-heat-row-label">
                        {t(dayKey)}
                      </span>
                      <span className="ov-hcs">
                        {Array.from({ length: 24 }, (_, hour) => {
                          const cell = grid.rows[dayIdx * 24 + hour];
                          const cls = level(cell.count);
                          const now = isNow && hour === focusHour;
                          return (
                            <span
                              key={hour}
                              data-testid={now ? 'agent-v2-ov-current-cell' : 'agent-v2-ov-heat-cell'}
                              className={`ov-hc${cls ? ` ${cls}` : ''}${now ? ' nw' : ''}`}
                              title={`${t(dayKey)} ${String(hour).padStart(2, '0')}:00 · ${
                                cell.count > 0
                                  ? t('agentConsole.v2.ov.heatCellCount', { weeks, count: cell.count })
                                  : t('agentConsole.v2.ov.heatCellNone')
                              }`}
                            />
                          );
                        })}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="ov-heat-side">
                <div className="ov-hs">
                  <div className="l">
                    <span className="a2-micro">{t('agentConsole.v2.ov.heatPeak')}</span>
                    <span className="sp" />
                    <b>{grid.peak ? grid.peak.count : 0}</b>
                    <span className="u">{t('agentConsole.v2.ov.heatUnit')}</span>
                  </div>
                  <div className="d">
                    {grid.peak
                      ? `${t(HEAT_DAY_KEYS[grid.peak.dow - 1])} ${String(grid.peak.hour).padStart(2, '0')}:00–${String(grid.peak.hour).padStart(2, '0')}:59 · ${t('agentConsole.v2.ov.heatRowTotal', { count: peakRowTotal })}`
                      : t('agentConsole.v2.ov.heatPeakNone')}
                  </div>
                </div>
                <div className="ov-hs">
                  <div className="l">
                    <span className="a2-micro">{t('agentConsole.v2.ov.heatNight')}</span>
                    <span className="sp" />
                    <b>{nightAvg}</b>
                    <span className="u">{t('agentConsole.v2.ov.heatUnit')}</span>
                  </div>
                  <div className="d" data-testid="agent-v2-ov-heat-night-note">
                    {nightZero
                      ? t('agentConsole.v2.ov.heatNightNone')
                      : t('agentConsole.v2.ov.heatNightDesc')}
                  </div>
                </div>
                <div className="ov-hs">
                  <div className="l">
                    <span className="a2-micro">{t('agentConsole.v2.ov.heatTotalLabel', { weeks })}</span>
                    <span className="sp" />
                    <b>{grid.total}</b>
                  </div>
                  <div className="d">
                    {t('agentConsole.v2.trendSucceeded')} {sums.succeeded} · {t('agentConsole.v2.trendFailed')} {sums.failed}
                    {unknown > 0 ? ` · ${t('agentConsole.v2.ov.runsUnknown', { count: unknown })}` : ''} ·{' '}
                    {t('agentConsole.v2.ov.heatFocus', { day: t(HEAT_DAY_KEYS[focusDow - 1]) })}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="ov-rule" />
          <div className="ov-hfoot">
            <span className="ov-hscale">
              {t('agentConsole.v2.ov.heatTierLess')}
              {['l0', 'l1', 'l2', 'l3', 'l4', 'l5'].map((lv, i) => (
                <i key={lv} data-testid={`agent-v2-ov-heat-tier-${i + 1}`} className={`ov-hc${lv === 'l0' ? '' : ` ${lv}`}`} />
              ))}
              {t('agentConsole.v2.ov.heatTierMore')}
            </span>
            <span className="lg" data-testid="agent-v2-ov-heat-foot">{t('agentConsole.v2.ov.heatCountOnly')}</span>
          </div>
          {grid.total === 0 ? (
            <p className="ov-empty-line" data-testid="agent-v2-ov-heat-empty">
              {t('agentConsole.v2.ov.heatEmpty', { count: weeks })}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
