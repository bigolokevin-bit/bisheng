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
  if (!ok || !current || buckets.length === 0 || bucketSum(buckets).runs <= 0) {
    return t('agentConsole.v2.ov.noTrend');
  }
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
      const windowCur = dayWindow(rangeDays);
      const windowPrev = {
        from: dayWindow(rangeDays * 2).from,
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
    const byDay = new Map<string, number>();
    for (const bucket of runs.data.buckets ?? []) {
      byDay.set(isoDay(bucket.bucketStart), bucket.runs);
    }
    const days: { day: string; runs: number }[] = [];
    const now = Date.now();
    for (let i = rangeDays - 1; i >= 0; i -= 1) {
      const day = isoDay(new Date(now - i * 86400000).toISOString());
      days.push({ day, runs: byDay.get(day) ?? 0 });
    }
    return days;
  }, [runs, rangeDays]);
  const trendMax = trendBars ? Math.max(...trendBars.map((b) => b.runs), 1) : 1;
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
            </>
          ) : (
            <span className="a2-meta" data-testid="agent-v2-ov-kpi-onduty-error">
              {stats.code ?? `http-${stats.status}`}
            </span>
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
            </>
          ) : (
            <span className="a2-meta" data-testid="agent-v2-ov-kpi-pending-error">
              {approvals.code === 'agent-console.no-uid'
                ? t('agentConsole.v2.ov.noteNoUid')
                : (approvals.code ?? `http-${approvals.status}`)}
            </span>
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
            <span className="a2-meta" data-testid="agent-v2-ov-kpi-runs-error">
              {runs.code ?? `http-${runs.status}`}
            </span>
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
            <span className="a2-meta" data-testid="agent-v2-ov-kpi-cost-error">
              {cost.code === 'agent-console.no-employees'
                ? t('agentConsole.v2.ov.noteNoEmployees')
                : (cost.code ?? `http-${cost.status}`)}
            </span>
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
          />
          <QueueSection titleKey="queueTasks" state={queueTasks} to="/agent/tasks" />
          <QueueSection titleKey="queueRuns" state={queueRuns} to="/agent/runs" />
        </div>

        <div className="a2-card" data-testid="agent-v2-ov-trend">
          <h2 className="a2-h2">{t('agentConsole.v2.ov.trendTitle')}</h2>
          {trendBars === null ? (
            <p className="a2-meta" data-testid="agent-v2-ov-trend-empty">
              {t('agentConsole.v2.ov.noTrend')}
            </p>
          ) : (
            <>
              <div
                className="a2-trend-bars"
                data-testid="agent-v2-ov-trend-bars"
                style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 88 }}
              >
                {trendBars.map((b) => (
                  <div
                    key={b.day}
                    data-testid="agent-v2-ov-trend-bar"
                    title={`${b.day} · ${b.runs}`}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'flex-end',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <div
                      style={{
                        width: '100%',
                        height: b.runs > 0 ? Math.round((b.runs / trendMax) * 56) : 0,
                        background: 'hsl(var(--accent))',
                        borderRadius: 2,
                      }}
                    />
                    {b.runs > 0 ? <span className="a2-micro">{b.runs}</span> : null}
                  </div>
                ))}
              </div>
              <p className="a2-meta" data-testid="agent-v2-ov-trend-foot">
                {t('agentConsole.v2.ov.trendFoot', {
                  succeeded: runSums.succeeded,
                  failed: runSums.failed,
                })}
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
          {heatGrid === null ? (
            <p className="a2-meta" data-testid="agent-v2-ov-heat-empty">
              {t('agentConsole.v2.ov.heatEmpty', { count: heatWeeks })}
            </p>
          ) : (
            <>
              <div
                className="a2-heat-cells"
                data-testid="agent-v2-ov-heat-grid"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(24, 1fr)', gap: 2 }}
              >
                {heatGrid.rows.map((c) => (
                  <div
                    key={`${c.dow}-${c.hour}`}
                    data-testid="agent-v2-ov-heat-cell"
                    className="a2-heat-cell"
                    title={`dow ${c.dow} · ${c.hour}:00 · ${c.count}`}
                    style={{
                      aspectRatio: '1',
                      borderRadius: 2,
                      background:
                        c.count > 0 ? 'hsl(var(--accent))' : 'rgba(128, 128, 128, 0.15)',
                      opacity: c.count > 0 ? 0.2 + 0.8 * (c.count / c.max) : 1,
                    }}
                  />
                ))}
              </div>
              {heatGrid.total === 0 ? (
                <p className="a2-meta" data-testid="agent-v2-ov-heat-empty">
                  {t('agentConsole.v2.ov.heatEmpty', { count: heatWeeks })}
                </p>
              ) : null}
              <p className="a2-micro" data-testid="agent-v2-ov-heat-foot">
                {t('agentConsole.v2.ov.heatCaliber')}
              </p>
            </>
          )}
        </div>

        <CostBudgetBlock cost={cost} rows={quotaRows} />
        <AnomalyBlock runs={runs} approvals={approvals} days={rangeDays} />
        <ActivityBlock runs={activityRuns} audit={activityAudit} />
      </div>
    </div>
  );
}
