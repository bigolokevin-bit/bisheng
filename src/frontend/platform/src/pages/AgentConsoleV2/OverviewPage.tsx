/* OV-01 slice 1-3 + fix A: overview header, 4 KPI cards, pending queue,
 * trend, heat, cost/budget (merged), anomalies and activity — real BFF
 * aggregates only. Every number comes from a service endpoint
 * (E14 / AP8 / R6 / P9 batch); nothing is aggregated over paginated rows in
 * the client. No fake charts, no fixtures in bundle, no placeholder copy on
 * screen. KPI sparklines and the trend block share the SAME R6 buckets.
 * Page state survives refresh/share/back via the URL:
 * ?range=7d|28d|90d&weeks=1..12&focus=<block>.
 * When an endpoint 4xx/5xx or has no data the UI shows an explicit reason
 * instead of a fabricated value. */
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

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
  fmtRatio,
  fmtTime,
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
  KpiSpark,
  QueueSection,
} from './OverviewBlocks';

const COST_ID_LIMIT = 100;

interface KpiState<T> {
  loading: boolean;
  ok: boolean;
  status: number;
  code?: string;
  data?: T;
}

const pendingKpi = { loading: true, ok: false, status: 0 };

// fix A (G2): "no trend data" appears ONLY when the buckets are empty or
// all-zero; with real buckets the comparison line is shown when a non-zero
// previous window exists, and omitted (never faked) otherwise.
function trendText(
  t: (k: string, o?: Record<string, unknown>) => string,
  current: RunStatsBody | undefined,
  previous: RunStatsBody | undefined,
  ok: boolean,
  days: number
): string | null {
  const buckets = current?.buckets ?? [];
  // fix A (G2): "no trend data" is shown ONLY when the current window's
  // own buckets are empty/all-zero. If the comparison fetch failed or has
  // no runs, the delta line is silently omitted — never a fake empty state
  // while the spark's source (current buckets) clearly has data.
  if (!current || buckets.length === 0 || bucketSum(buckets).runs <= 0) {
    return t('agentConsole.v2.ov.noTrend');
  }
  if (!ok) return null;
  const prev = bucketSum(previous?.buckets);
  if (prev.runs <= 0) return null;
  const cur = bucketSum(buckets);
  return `${t('agentConsole.v2.ov.trendVsPrev', { days })} ${fmtRatio(
    (cur.runs - prev.runs) / prev.runs
  )}`;
}

// fix A (G2): cost spark mirrors sparkPoints but reads costUsd; a window
// without any monetary bucket yields null and the card draws nothing.
function costSparkPoints(buckets: RunBucket[] | null | undefined, days: number): number[] | null {
  if (!buckets || buckets.length === 0) return null;
  const byDay = new Map<string, number>();
  for (const b of buckets) {
    if (typeof b.costUsd === 'number' && Number.isFinite(b.costUsd)) {
      const day = isoDay(b.bucketStart);
      byDay.set(day, (byDay.get(day) ?? 0) + b.costUsd);
    }
  }
  const out: number[] = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push(byDay.get(isoDay(new Date(now - i * 86400000).toISOString())) ?? 0);
  }
  return out.some((v) => v > 0) ? out : null;
}

// fix A (G9): page state that must survive refresh / share / back lives in
// the URL: ?range=7d|28d|90d&weeks=1..12&focus=<block>.
const RANGE_KEYS = ['7d', '28d', '90d'];
const RANGE_DAYS: Record<string, number> = { '7d': 7, '28d': 28, '90d': 90 };
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

// OV-01 slice 2: queue row shapes were read live, never fabricated; the
// rendering component now lives in OverviewBlocks (fix A size budget).
interface QueueItem {
  [key: string]: unknown;
}

interface QueueBody {
  items: QueueItem[];
  nextCursor?: string;
}

interface AuditBody {
  events: QueueItem[];
}

function listKpi(res: ApiRes<QueueBody> | null): KpiState<QueueBody> {
  if (res === null) {
    return { loading: false, ok: false, status: 0, code: 'agent-console.no-uid' };
  }
  return { loading: false, ok: res.ok, status: res.status, code: res.code, data: res.data };
}

export function OverviewPage() {
  const { t } = useTranslation();
  const user = useContext(userContext)?.user;
  const uid = String(user?.user_id ?? '');
  const fetch = useMemo(() => makeFetcher(), []);
  const [token, setToken] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [stats, setStats] = useState<KpiState<EmployeeStats>>(pendingKpi);
  const [approvals, setApprovals] = useState<KpiState<ApprovalStats>>(pendingKpi);
  const [runs, setRuns] = useState<KpiState<RunStatsBody>>(pendingKpi);
  const [runsPrevOk, setRunsPrevOk] = useState(false);
  const [runsPrev, setRunsPrev] = useState<RunStatsBody | undefined>();
  const [cost, setCost] = useState<KpiState<BudgetBody>>(pendingKpi);
  const [queueApprovals, setQueueApprovals] = useState<KpiState<QueueBody>>(pendingKpi);
  const [queueTasks, setQueueTasks] = useState<KpiState<QueueBody>>(pendingKpi);
  const [queueRuns, setQueueRuns] = useState<KpiState<QueueBody>>(pendingKpi);
  const [heat, setHeat] = useState<KpiState<ActivityBody>>(pendingKpi);
  const [quotaRows, setQuotaRows] = useState<EmployeeRow[]>([]);
  const [activityRuns, setActivityRuns] = useState<KpiState<QueueBody>>(pendingKpi);
  const [activityAudit, setActivityAudit] = useState<KpiState<AuditBody>>(pendingKpi);

  const refresh = useCallback(() => setToken((x) => x + 1), []);

  const [searchParams, setSearchParams] = useSearchParams();
  const rangeKey = RANGE_KEYS.find((k) => k === searchParams.get('range')) ?? '7d';
  const rangeDays = RANGE_DAYS[rangeKey];
  const weeksRaw = Number.parseInt(searchParams.get('weeks') ?? '', 10);
  const heatWeeks = Number.isFinite(weeksRaw) ? Math.min(12, Math.max(1, weeksRaw)) : 4;
  const focus = searchParams.get('focus');
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
  useEffect(() => {
    if (!focus) return;
    const testId = FOCUS_TESTID[focus];
    if (!testId) return;
    const el = document.querySelector(`[data-testid="${testId}"]`);
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focus, updatedAt]);

  useEffect(() => {
    let alive = true;
    setStats(pendingKpi);
    setApprovals(pendingKpi);
    setRuns(pendingKpi);
    setCost(pendingKpi);
    setQueueApprovals(pendingKpi);
    setQueueTasks(pendingKpi);
    setQueueRuns(pendingKpi);
    setHeat(pendingKpi);
    setQuotaRows([]);
    setActivityRuns(pendingKpi);
    setActivityAudit(pendingKpi);
    void (async () => {
      // The BFF caps day-bucket run-stats at a 90-day span and the UTC
      // floor in dayWindow() adds up to a day, so clamp the requested
      // window to 89 days: 90d then measures a <=90-day span instead of
      // 400 run.stats_range_too_large. The comparison window spans the
      // PREVIOUS statDays block ([2x floor, 1x floor]), keeping its own
      // span <=90 days and non-degenerate at the 90d clamp.
      const statDays = Math.min(rangeDays, 89);
      const windowCur = dayWindow(statDays);
      const windowPrev = {
        from: dayWindow(statDays * 2).from,
        to: windowCur.from,
      };
      const window24 = {
        from: new Date(Date.now() - 86400000).toISOString(),
        to: new Date().toISOString(),
      };
      const [s, a, r, rp, ids, qa, qt, qr, h, ar, au] = await Promise.all([
        fetchEmployeeStats(fetch),
        uid ? fetchApprovalStats(fetch, `human:${uid}`) : Promise.resolve(null),
        fetchRunStats(fetch, { ...windowCur, bucket: 'day' }),
        fetchRunStats(fetch, { ...windowPrev, bucket: 'day' }),
        fetchEmployeesPage(fetch, { limit: COST_ID_LIMIT, expand: 'version' }),
        uid
          ? fetch<QueueBody>('/api/approvals', {
              assignee: `human:${uid}`,
              status: 'pending',
              limit: 5,
            })
          : Promise.resolve(null),
        // fix A (G3): the queue shows ONLY actionable items — overdue tasks
        // (dueBefore=now). If the BFF rejects the filter the leg shows the
        // reason instead of an unfiltered list.
        uid
          ? fetch<QueueBody>('/api/tasks', {
              assignee: `human:${uid}`,
              dueBefore: window24.to,
              limit: 5,
            })
          : Promise.resolve(null),
        // fix A (G3): abnormal runs only — status=failed inside the rolling
        // 24h window (server-side filter, never client-side pseudo-filtering).
        fetch<QueueBody>('/api/runs', { status: 'failed', since: window24.from, limit: 5 }),
        fetchActivity(fetch, { weeks: heatWeeks, tz: 'Asia/Shanghai' }),
        fetch<QueueBody>('/api/runs', { since: window24.from, limit: 8 }),
        fetch<AuditBody>('/api/audit', {
          from: window24.from,
          to: window24.to,
          limit: 8,
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
      setRunsPrevOk(rp.ok);
      setRunsPrev(rp.data);
      setQueueApprovals(listKpi(qa));
      setQueueTasks(listKpi(qt));
      setQueueRuns(listKpi(qr));
      setHeat({ loading: false, ok: h.ok, status: h.status, code: h.code, data: h.data });
      setQuotaRows(ids.data?.items ?? []);
      setActivityRuns({ loading: false, ok: ar.ok, status: ar.status, code: ar.code, data: ar.data });
      setActivityAudit({ loading: false, ok: au.ok, status: au.status, code: au.code, data: au.data });
      // P9 requires an explicit employeeId list (BFF contract): resolve ids
      // from E11 first, then one batched month query. No silent "0.00".
      const empIds = (ids.data?.items ?? []).map((e) => e.employeeId);
      if (!ids.ok) {
        setCost({ loading: false, ok: false, status: ids.status, code: ids.code });
      } else if (empIds.length === 0) {
        setCost({ loading: false, ok: false, status: 0, code: 'agent-console.no-employees' });
      } else {
        const b = await fetchBudgetMonth(fetch, empIds, monthPeriod());
        if (!alive) return;
        setCost({ loading: false, ok: b.ok, status: b.status, code: b.code, data: b.data });
      }
      if (alive) setUpdatedAt(new Date().toISOString());
    })();
    return () => {
      alive = false;
    };
  }, [fetch, token, uid, rangeDays, heatWeeks]);

  const authExpired = [stats, approvals, runs, cost].some(
    (k) => k.status === 401 || k.code === 'console.unauthenticated'
  );
  const runSums = bucketSum(runs.data?.buckets);
  const runsSpark = sparkPoints(runs.data?.buckets, rangeDays);
  const costSpark = costSparkPoints(runs.data?.buckets, rangeDays);
  const windowLabel = t(`agentConsole.v2.ov.range${rangeKey}`);
  const trendLine = trendText(t, runs.data, runsPrev, runsPrevOk, rangeDays);
  const trendBars = useMemo(() => {
    if (!runs.ok || !runs.data) return null;
    const byDay = new Map<string, RunBucket>();
    for (const bucket of runs.data.buckets ?? []) {
      byDay.set(isoDay(bucket.bucketStart), bucket);
    }
    const days: {
      day: string;
      runs: number;
      succeeded: number;
      failed: number;
      p95: number | null;
    }[] = [];
    const now = Date.now();
    for (let i = rangeDays - 1; i >= 0; i -= 1) {
      const day = isoDay(new Date(now - i * 86400000).toISOString());
      const b = byDay.get(day);
      days.push({
        day,
        runs: b?.runs ?? 0,
        succeeded: b?.succeeded ?? 0,
        failed: b?.failed ?? 0,
        // fix B (G4): missing key = sample <20 = break in the line, never 0.
        p95: typeof b?.p95DurationMs === 'number' ? b.p95DurationMs : null,
      });
    }
    return days;
  }, [runs, rangeDays]);
  const trendMax = trendBars
    ? Math.max(...trendBars.map((b) => b.succeeded + b.failed), 1)
    : 1;
  const trendP95Ok = trendBars ? trendBars.some((b) => b.p95 !== null) : false;
  const heatGrid = useMemo(() => {
    if (!heat.ok || !heat.data) return null;
    const counts = new Map<string, number>();
    for (const cell of heat.data.cells ?? []) {
      counts.set(`${cell.dow}:${cell.hour}`, cell.count);
    }
    const max = Math.max(heat.data.max ?? 0, ...Array.from(counts.values()), 1);
    const rows: { dow: number; hour: number; count: number; max: number }[] = [];
    let total = 0;
    for (let dow = 1; dow <= 7; dow += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        const count = counts.get(`${dow}:${hour}`) ?? 0;
        total += count;
        rows.push({ dow, hour, count, max });
      }
    }
    return { rows, total };
  }, [heat]);

  return (
    <div className="a2s-page" data-testid="agent-v2-ov-page">
      <div className="a2-card" data-testid="agent-v2-ov-block-header" style={{ marginBottom: 12 }}>
        <div className="a2-card-head">
          <h1 className="a2-h1">{t('agentConsole.v2.ov.title')}</h1>
          <button
            type="button"
            className="a2-btn"
            data-testid="agent-v2-ov-refresh"
            onClick={refresh}
          >
            {t('agentConsole.v2.ov.refresh')}
          </button>
        </div>
        <div
          role="group"
          aria-label={t('agentConsole.v2.ov.rangeTitle')}
          data-testid="agent-v2-ov-range"
          style={{ display: 'flex', gap: 6, marginTop: 8 }}
        >
          {RANGE_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              className="a2-btn"
              data-testid={`agent-v2-ov-range-${k}`}
              aria-pressed={k === rangeKey}
              onClick={() => updateParam('range', k === rangeKey ? null : k)}
            >
              {t(`agentConsole.v2.ov.range${k}`)}
            </button>
          ))}
        </div>
        <p className="a2-meta">
          {t('agentConsole.v2.ov.periodNote', { window: windowLabel })}
          {updatedAt ? (
            <>
              {' · '}
              <span data-testid="agent-v2-ov-updated">
                {t('agentConsole.v2.ov.dataAt')} {fmtTime(updatedAt)}
              </span>
            </>
          ) : null}
        </p>
        {authExpired ? (
          <p className="a2-meta" data-testid="agent-v2-ov-auth-expired">
            {t('agentConsole.v2.ov.sessionExpired')}
          </p>
        ) : null}
      </div>

      <div className="a2-kpis" data-testid="agent-v2-ov-block-kpis" style={{ marginBottom: 12 }}>
        <div className="a2-kpi" data-testid="agent-v2-ov-kpi-onduty">
          <span className="a2-meta">{t('agentConsole.v2.ov.kpiOnDuty')}</span>
          {stats.loading ? (
            <span className="a2-kpi-num">…</span>
          ) : stats.ok ? (
            <>
              <span className="a2-kpi-num">
                {stats.data?.byLifecycle?.active ?? '—'}
              </span>
              <span className="a2-meta">
                {t('agentConsole.v2.ov.noteTotal', {
                  count: stats.data?.total ?? 0,
                })}
              </span>
              {/* fix B (N1): no trusted trend series exists for this card */}
              <span className="a2-micro" data-testid="agent-v2-ov-kpi-onduty-nospark">
                {t('agentConsole.v2.ov.kpiNoSpark')}
              </span>
            </>
          ) : (
            <>
              {/* fix B (G15): never surface raw BFF codes; localize with HTTP status */}
              <span className="a2-meta" data-testid="agent-v2-ov-kpi-onduty-error">
                {t('agentConsole.v2.ov.blockUnavailable', {
                  block: t('agentConsole.v2.ov.kpiOnDuty'),
                  code: stats.status,
                })}
              </span>
              {/* fix B (G10): block-level retry; refresh re-runs the full silent load */}
              <button
                type="button"
                className="a2-btn"
                data-testid="agent-v2-ov-retry-kpi-onduty"
                onClick={refresh}
              >
                {t('agentConsole.v2.ov.retry')}
              </button>
            </>
          )}
        </div>

        <div className="a2-kpi" data-testid="agent-v2-ov-kpi-pending">
          <span className="a2-meta">{t('agentConsole.v2.ov.kpiPending')}</span>
          {approvals.loading ? (
            <span className="a2-kpi-num">…</span>
          ) : approvals.ok ? (
            <>
              <span className="a2-kpi-num">{approvals.data?.pending ?? '—'}</span>
              {(approvals.data?.dueSoon ?? 0) > 0 ? (
                <span className="a2-meta">
                  {t('agentConsole.v2.ov.noteDueSoon', {
                    count: approvals.data?.dueSoon ?? 0,
                  })}
                </span>
              ) : null}
              {/* fix B (N1): no trusted trend series exists for this card */}
              <span className="a2-micro" data-testid="agent-v2-ov-kpi-pending-nospark">
                {t('agentConsole.v2.ov.kpiNoSpark')}
              </span>
            </>
          ) : (
            <>
              <span className="a2-meta" data-testid="agent-v2-ov-kpi-pending-error">
                {approvals.code === 'agent-console.no-uid'
                  ? t('agentConsole.v2.ov.noteNoUid')
                  : t('agentConsole.v2.ov.blockUnavailable', {
                      block: t('agentConsole.v2.ov.kpiPending'),
                      code: approvals.status,
                    })}
              </span>
              <button
                type="button"
                className="a2-btn"
                data-testid="agent-v2-ov-retry-kpi-pending"
                onClick={refresh}
              >
                {t('agentConsole.v2.ov.retry')}
              </button>
            </>
          )}
        </div>

        <div className="a2-kpi" data-testid="agent-v2-ov-kpi-runs">
          <span className="a2-meta">
            {t('agentConsole.v2.ov.kpiWeekRuns', { window: windowLabel })}
          </span>
          {runs.loading ? (
            <span className="a2-kpi-num">…</span>
          ) : runs.ok ? (
            <>
              <span className="a2-kpi-num">{runSums.runs}</span>
              {runsSpark ? (
                <KpiSpark points={runsSpark} testId="agent-v2-ov-kpi-runs-spark" />
              ) : null}
              {trendLine ? <span className="a2-meta">{trendLine}</span> : null}
              <span className="a2-meta">
                {t('agentConsole.v2.ov.noteFailedRuns', { count: runSums.failed })}
              </span>
            </>
          ) : (
            <>
              <span className="a2-meta" data-testid="agent-v2-ov-kpi-runs-error">
                {t('agentConsole.v2.ov.blockUnavailable', {
                  block: t('agentConsole.v2.ov.kpiWeekRuns', { window: windowLabel }),
                  code: runs.status,
                })}
              </span>
              <button
                type="button"
                className="a2-btn"
                data-testid="agent-v2-ov-retry-kpi-runs"
                onClick={refresh}
              >
                {t('agentConsole.v2.ov.retry')}
              </button>
            </>
          )}
        </div>

        <div className="a2-kpi" data-testid="agent-v2-ov-kpi-cost">
          <span className="a2-meta">{t('agentConsole.v2.ov.kpiMonthCost')}</span>
          {cost.loading ? (
            <span className="a2-kpi-num">…</span>
          ) : cost.ok ? (
            <>
              <span className="a2-kpi-num">
                {fmtUsd(
                  (cost.data?.items ?? []).reduce(
                    (acc, item) => acc + (typeof item.costUsd === 'number' ? item.costUsd : 0),
                    0
                  )
                )}
              </span>
              {costSpark ? (
                <KpiSpark points={costSpark} testId="agent-v2-ov-kpi-cost-spark" />
              ) : null}
              <span className="a2-meta">{t('agentConsole.v2.ov.noteLedger')}</span>
            </>
          ) : (
            <>
              <span className="a2-meta" data-testid="agent-v2-ov-kpi-cost-error">
                {cost.code === 'agent-console.no-employees'
                  ? t('agentConsole.v2.ov.noteNoEmployees')
                  : t('agentConsole.v2.ov.blockUnavailable', {
                      block: t('agentConsole.v2.ov.kpiMonthCost'),
                      code: cost.status,
                    })}
              </span>
              <button
                type="button"
                className="a2-btn"
                data-testid="agent-v2-ov-retry-kpi-cost"
                onClick={refresh}
              >
                {t('agentConsole.v2.ov.retry')}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="a2-cards">
        <div className="a2-card" data-testid="agent-v2-ov-queue">
          <h2 className="a2-h2">{t('agentConsole.v2.ov.queueTitle')}</h2>
          <QueueSection
            titleKey="queueApprovals"
            state={queueApprovals}
            to="/agent/approvals"
            onRetry={refresh}
          />
          <QueueSection
            titleKey="queueTasks"
            state={queueTasks}
            to="/agent/tasks"
            onRetry={refresh}
          />
          <QueueSection
            titleKey="queueRuns"
            state={queueRuns}
            to="/agent/runs"
            onRetry={refresh}
          />
        </div>

        <div className="a2-card" data-testid="agent-v2-ov-trend">
          <h2 className="a2-h2">{t('agentConsole.v2.ov.trendTitle')}</h2>
          {runs.loading ? (
            <p className="a2-meta">…</p>
          ) : !runs.ok ? (
            /* fix B (G10): error state distinct from empty, with retry entry */
            <>
              <p className="a2-meta" data-testid="agent-v2-ov-trend-error">
                {t('agentConsole.v2.ov.blockUnavailable', {
                  block: t('agentConsole.v2.ov.trendTitle'),
                  code: runs.status,
                })}
              </p>
              <button
                type="button"
                className="a2-btn"
                data-testid="agent-v2-ov-retry-trend"
                onClick={refresh}
              >
                {t('agentConsole.v2.ov.retry')}
              </button>
            </>
          ) : trendBars === null ? (
            <p className="a2-meta" data-testid="agent-v2-ov-trend-empty">
              {t('agentConsole.v2.ov.noTrend')}
            </p>
          ) : (
            <>
              {/* fix B (G4): legend per deep OV-23 — P95 item is greyed with
                  the reason when no bucket returned a sample; no fake line. */}
              <div
                className="a2-trend-legend"
                data-testid="agent-v2-ov-trend-legend"
                style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}
              >
                <span
                  className="a2-micro"
                  data-testid="agent-v2-ov-trend-legend-success"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <i
                    aria-hidden
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: 'hsl(var(--accent))',
                      display: 'inline-block',
                    }}
                  />
                  {t('agentConsole.v2.trendSucceeded')}
                </span>
                <span
                  className="a2-micro"
                  data-testid="agent-v2-ov-trend-legend-failed"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <i
                    aria-hidden
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: 'hsl(var(--danger))',
                      display: 'inline-block',
                    }}
                  />
                  {t('agentConsole.v2.trendFailed')}
                </span>
                <span
                  className="a2-micro"
                  data-testid="agent-v2-ov-trend-legend-p95"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    opacity: trendP95Ok ? 1 : 0.45,
                  }}
                >
                  <i
                    aria-hidden
                    style={{
                      width: 10,
                      height: 2,
                      background: 'hsl(var(--warning))',
                      display: 'inline-block',
                    }}
                  />
                  {t('agentConsole.v2.trendP95')}
                  {trendP95Ok ? null : ` · ${t('agentConsole.v2.ov.p95Insufficient')}`}
                </span>
              </div>
              {trendP95Ok
                ? (() => {
                    // P95 polyline (deep OV-22): only buckets that returned a
                    // sample draw points; a missing key breaks the line.
                    const p95Vals = trendBars
                      .filter((b) => b.p95 !== null)
                      .map((b) => b.p95 as number);
                    const maxP = Math.max(...p95Vals, 1);
                    const n = trendBars.length;
                    const segs: string[][] = [];
                    let cur: string[] = [];
                    trendBars.forEach((b, i) => {
                      if (b.p95 === null) {
                        if (cur.length) segs.push(cur);
                        cur = [];
                        return;
                      }
                      const x = n > 1 ? (i / (n - 1)) * 100 : 50;
                      const y = 18 - (b.p95 / maxP) * 16;
                      cur.push(`${x.toFixed(1)},${y.toFixed(1)}`);
                    });
                    if (cur.length) segs.push(cur);
                    return (
                      <svg
                        data-testid="agent-v2-ov-trend-p95"
                        viewBox="0 0 100 20"
                        preserveAspectRatio="none"
                        style={{ width: '100%', height: 20, display: 'block', marginTop: 6 }}
                        aria-hidden
                      >
                        {segs.map((s, si) => (
                          <polyline
                            key={si}
                            points={s.join(' ')}
                            fill="none"
                            stroke="hsl(var(--warning))"
                            strokeWidth={0.8}
                            vectorEffect="non-scaling-stroke"
                          />
                        ))}
                      </svg>
                    );
                  })()
                : null}
              <div
                className="a2-trend-bars"
                data-testid="agent-v2-ov-trend-bars"
                style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 100, marginTop: 6 }}
              >
                {trendBars.map((b, i) => {
                  const total = b.succeeded + b.failed;
                  const hPct = trendMax > 0 ? (total / trendMax) * 100 : 0;
                  const okPct = total > 0 ? (b.succeeded / total) * 100 : 0;
                  const tick =
                    i === 0 ||
                    i === trendBars.length - 1 ||
                    i === Math.floor((trendBars.length - 1) / 2);
                  const p95Str =
                    b.p95 === null
                      ? t('agentConsole.v2.ov.p95Insufficient')
                      : `${(b.p95 / 1000).toFixed(1)}s`;
                  return (
                    <div
                      key={b.day}
                      data-testid="agent-v2-ov-trend-bar"
                      title={t('agentConsole.v2.ov.trendTooltip', {
                        day: b.day,
                        succeeded: b.succeeded,
                        failed: b.failed,
                        p95: p95Str,
                      })}
                      style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'flex-end',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      {b.runs > 0 ? <span className="a2-micro">{b.runs}</span> : null}
                      <div
                        style={{
                          width: '100%',
                          height: 56,
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'flex-end',
                        }}
                      >
                        <div
                          style={{
                            width: '100%',
                            height: `${hPct}%`,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'flex-end',
                            borderRadius: 2,
                            overflow: 'hidden',
                          }}
                        >
                          {b.failed > 0 ? (
                            <div
                              style={{
                                width: '100%',
                                height: `${100 - okPct}%`,
                                background: 'hsl(var(--danger))',
                              }}
                            />
                          ) : null}
                          {b.succeeded > 0 ? (
                            <div
                              style={{
                                width: '100%',
                                height: `${okPct}%`,
                                background: 'hsl(var(--accent))',
                              }}
                            />
                          ) : null}
                        </div>
                      </div>
                      {/* fix B (G4): x-axis date ticks — first / middle / last
                          visible, the rest keep layout height but stay hidden. */}
                      <span
                        className="a2-micro"
                        data-testid="agent-v2-ov-trend-tick"
                        style={{ visibility: tick ? 'visible' : 'hidden' }}
                      >
                        {b.day.slice(5)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="a2-meta" data-testid="agent-v2-ov-trend-foot">
                {t('agentConsole.v2.ov.trendFoot', {
                  succeeded: runSums.succeeded,
                  failed: runSums.failed,
                })}
                {` · ${t('agentConsole.v2.ov.utcBucketNote')}`}
              </p>
            </>
          )}
        </div>

        <div className="a2-card" data-testid="agent-v2-ov-heat">
          <div className="a2-card-head">
            <h2 className="a2-h2">{t('agentConsole.v2.ov.heatTitle')}</h2>
            <select
              className="a2-btn"
              data-testid="agent-v2-ov-weeks"
              aria-label={t('agentConsole.v2.ov.weeksLabel')}
              value={String(heatWeeks)}
              onChange={(e) =>
                updateParam('weeks', e.target.value === '4' ? null : e.target.value)
              }
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((w) => (
                <option key={w} value={String(w)}>
                  {t('agentConsole.v2.ov.weeksOption', { count: w })}
                </option>
              ))}
            </select>
          </div>
          {heat.loading ? (
            <p className="a2-meta">…</p>
          ) : !heat.ok ? (
            /* fix B (G10): error state distinct from empty, with retry entry */
            <>
              <p className="a2-meta" data-testid="agent-v2-ov-heat-error">
                {t('agentConsole.v2.ov.blockUnavailable', {
                  block: t('agentConsole.v2.ov.heatTitle'),
                  code: heat.status,
                })}
              </p>
              <button
                type="button"
                className="a2-btn"
                data-testid="agent-v2-ov-retry-heat"
                onClick={refresh}
              >
                {t('agentConsole.v2.ov.retry')}
              </button>
            </>
          ) : heatGrid === null ? (
            <p className="a2-meta" data-testid="agent-v2-ov-heat-empty">
              {t('agentConsole.v2.ov.heatEmpty', { count: heatWeeks })}
            </p>
          ) : (
            <>
              {/* fix B (G5): weekday row labels + human-readable tooltips +
                  tier legend, same grid language as the EMP-01 heat panel. */}
              <div className="a2-heat" data-testid="agent-v2-ov-heat-grid">
                {HEAT_DAY_KEYS.map((dayKey, dayIdx) => (
                  <div key={dayKey} className="a2-heat-row">
                    <span className="a2-heat-day" data-testid="agent-v2-ov-heat-row-label">
                      {t(dayKey)}
                    </span>
                    <div className="a2-heat-cells">
                      {Array.from({ length: 24 }, (_, hour) => {
                        const c = heatGrid.rows[dayIdx * 24 + hour];
                        const level =
                          c.count > 0
                            ? Math.min(4, Math.max(1, Math.ceil((c.count / c.max) * 4)))
                            : 0;
                        return (
                          <span
                            key={`${dayIdx}-${hour}`}
                            data-testid="agent-v2-ov-heat-cell"
                            className={`a2-heat-cell is-l${level}`}
                            title={`${t(dayKey)} ${String(hour).padStart(2, '0')}:00 · ${
                              c.count > 0
                                ? t('agentConsole.v2.ov.heatCellCount', { count: c.count })
                                : t('agentConsole.v2.ov.heatCellNone')
                            }`}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div
                className="a2-trend-legend"
                data-testid="agent-v2-ov-heat-legend"
                style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}
              >
                <span className="a2-micro">{t('agentConsole.v2.ov.heatTierLess')}</span>
                {[1, 2, 3, 4].map((lv) => (
                  <i
                    key={lv}
                    aria-hidden
                    data-testid={`agent-v2-ov-heat-tier-${lv}`}
                    className={`a2-heat-cell is-l${lv}`}
                    style={{ width: 8, height: 8, borderRadius: 2, display: 'inline-block' }}
                  />
                ))}
                <span className="a2-micro">{t('agentConsole.v2.ov.heatTierMore')}</span>
                <span className="a2-micro">{t('agentConsole.v2.ov.heatCellHour')}</span>
              </div>
              {heatGrid.total === 0 ? (
                <p className="a2-meta" data-testid="agent-v2-ov-heat-empty">
                  {t('agentConsole.v2.ov.heatEmpty', { count: heatWeeks })}
                </p>
              ) : null}
              <p className="a2-micro" data-testid="agent-v2-ov-heat-foot">
                {t('agentConsole.v2.ov.heatCaliber')}
                {heat.data?.from && heat.data?.to
                  ? ` · ${fmtTime(heat.data.from)} → ${fmtTime(heat.data.to)}`
                  : null}
              </p>
            </>
          )}
        </div>

        <CostBudgetBlock cost={cost} rows={quotaRows} onRetry={refresh} />
        <AnomalyBlock
          runs={runs}
          approvals={approvals}
          days={rangeDays}
          onRetry={refresh}
        />
        <ActivityBlock runs={activityRuns} audit={activityAudit} onRetry={refresh} />
      </div>
    </div>
  );
}
