/* OV-01 slice 1: overview header + 4 KPI cards, real BFF aggregates only.
 * Every number comes from a service endpoint (E14 / AP8 / R6 / P9 batch);
 * nothing is aggregated over paginated rows in the client. The remaining
 * cost / quota / activity blocks render from real endpoints (slice 3) —
 * no fake charts, no fixtures in bundle, no placeholder copy on screen.
 * When an endpoint 4xx/5xx or has no data the KPI shows an explicit reason
 * instead of a fabricated value ("no trend data" rather than "+2%"). */
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';

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
  type ActivityBody,
  type ApiRes,
  type ApprovalStats,
  type BudgetBody,
  type EmployeeRow,
  type EmployeeStats,
  type RunStatsBody,
} from './v2Data';

import { ActivityBlock, CostBlock, QuotaBlock } from './OverviewBlocks';

const COST_ID_LIMIT = 100;

interface KpiState<T> {
  loading: boolean;
  ok: boolean;
  status: number;
  code?: string;
  data?: T;
}

const pendingKpi = { loading: true, ok: false, status: 0 };

function trendText(
  t: (k: string) => string,
  current: RunStatsBody | undefined,
  previous: RunStatsBody | undefined,
  ok: boolean
): string {
  // Honest trend: only when both rolling 7-day windows are present and the
  // previous window has a non-zero baseline. Otherwise state it explicitly.
  if (!ok || !current || !previous) return t('agentConsole.v2.ov.noTrend');
  const cur = bucketSum(current.buckets);
  const prev = bucketSum(previous.buckets);
  if (prev.runs <= 0) return t('agentConsole.v2.ov.noTrend');
  return `${t('agentConsole.v2.ov.trendVsPrev')} ${fmtRatio(
    (cur.runs - prev.runs) / prev.runs
  )}`;
}

// OV-01 slice 2: pending queue rows render whatever safe string fields the
// real API returns (shapes were read live, never fabricated). Missing fields
// fall back to the em dash, never to a guessed value.
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

function firstString(item: QueueItem, keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}

function queueLabel(item: QueueItem): string {
  return (
    firstString(item, [
      'title',
      'name',
      'action',
      'resource',
      'approvalId',
      'taskId',
      'runId',
      'employeeId',
    ]) ?? '—'
  );
}

function queueStatus(item: QueueItem): string {
  return firstString(item, ['status', 'lifecycleState', 'outcome']) ?? '—';
}

function listKpi(res: ApiRes<QueueBody> | null): KpiState<QueueBody> {
  if (res === null) {
    return { loading: false, ok: false, status: 0, code: 'agent-console.no-uid' };
  }
  return { loading: false, ok: res.ok, status: res.status, code: res.code, data: res.data };
}

function QueueSection({
  titleKey,
  state,
  to,
}: {
  titleKey: string;
  state: KpiState<QueueBody>;
  to: string;
}) {
  const { t } = useTranslation();
  const items = state.ok ? (state.data?.items ?? []) : [];
  return (
    <div className="a2-card-item" data-testid={`agent-v2-ov-queue-${titleKey}`}>
      <div className="a2-card-head">
        <span className="a2-meta">{t(`agentConsole.v2.ov.${titleKey}`)}</span>
        <NavLink className="a2-micro" to={to}>
          {t('agentConsole.v2.ov.viewAll')}
        </NavLink>
      </div>
      {state.loading ? (
        <p className="a2-meta">…</p>
      ) : !state.ok ? (
        <p className="a2-meta" data-testid={`agent-v2-ov-queue-${titleKey}-empty`}>
          {state.code === 'agent-console.no-uid'
            ? t('agentConsole.v2.ov.queueNoUid')
            : t('agentConsole.v2.ov.queueUnavailable')}
        </p>
      ) : items.length === 0 ? (
        <p className="a2-meta" data-testid={`agent-v2-ov-queue-${titleKey}-empty`}>
          {t('agentConsole.v2.ov.queueEmpty')}
        </p>
      ) : (
        items.map((item, index) => (
          <p className="a2-card-sub" key={`${titleKey}-${index}`}>
            <span>{queueLabel(item)}</span>
            {' · '}
            <span className="a2-mono">{queueStatus(item)}</span>
          </p>
        ))
      )}
    </div>
  );
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
      const window7 = dayWindow(7);
      const windowPrev = {
        from: dayWindow(14).from,
        to: window7.from,
      };
      const window24 = {
        from: new Date(Date.now() - 86400000).toISOString(),
        to: new Date().toISOString(),
      };
      const [s, a, r, rp, ids, qa, qt, qr, h, ar, au] = await Promise.all([
        fetchEmployeeStats(fetch),
        uid ? fetchApprovalStats(fetch, `human:${uid}`) : Promise.resolve(null),
        fetchRunStats(fetch, { ...window7, bucket: 'day' }),
        fetchRunStats(fetch, { ...windowPrev, bucket: 'day' }),
        fetchEmployeesPage(fetch, { limit: COST_ID_LIMIT, expand: 'version' }),
        uid
          ? fetch<QueueBody>('/api/approvals', {
              assignee: `human:${uid}`,
              status: 'pending',
              limit: 5,
            })
          : Promise.resolve(null),
        uid
          ? fetch<QueueBody>('/api/tasks', { assignee: `human:${uid}`, limit: 5 })
          : Promise.resolve(null),
        // Runs list requires a server-side filter (request.missing_filter);
        // reuse the 24h window so the queue shows recent activity honestly.
        fetch<QueueBody>('/api/runs', { since: window24.from, limit: 5 }),
        fetchActivity(fetch, { weeks: 4, tz: 'Asia/Shanghai' }),
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
  }, [fetch, token, uid]);

  const authExpired = [stats, approvals, runs, cost].some(
    (k) => k.status === 401 || k.code === 'console.unauthenticated'
  );
  const runSums = bucketSum(runs.data?.buckets);
  const trendBars = useMemo(() => {
    if (!runs.ok || !runs.data) return null;
    const byDay = new Map<string, number>();
    for (const bucket of runs.data.buckets ?? []) {
      byDay.set(isoDay(bucket.bucketStart), bucket.runs);
    }
    const days: { day: string; runs: number }[] = [];
    const now = Date.now();
    for (let i = 6; i >= 0; i -= 1) {
      const day = isoDay(new Date(now - i * 86400000).toISOString());
      days.push({ day, runs: byDay.get(day) ?? 0 });
    }
    return days;
  }, [runs]);
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
        <p className="a2-meta">
          {t('agentConsole.v2.ov.periodNote')}
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
          <span className="a2-meta">{t('agentConsole.v2.ov.kpiWeekRuns')}</span>
          {runs.loading ? (
            <span className="a2-kpi-num">…</span>
          ) : runs.ok ? (
            <>
              <span className="a2-kpi-num">{runSums.runs}</span>
              <span className="a2-meta">{trendText(t, runs.data, runsPrev, runsPrevOk)}</span>
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
                    <span className="a2-micro">
                      {b.runs > 0 ? b.runs : t('agentConsole.v2.ov.noRuns')}
                    </span>
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
          <h2 className="a2-h2">{t('agentConsole.v2.ov.heatTitle')}</h2>
          {heatGrid === null ? (
            <p className="a2-meta" data-testid="agent-v2-ov-heat-empty">
              {t('agentConsole.v2.ov.heatEmpty')}
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
                  {t('agentConsole.v2.ov.heatEmpty')}
                </p>
              ) : null}
              <p className="a2-micro" data-testid="agent-v2-ov-heat-foot">
                {t('agentConsole.v2.ov.heatCaliber')}
              </p>
            </>
          )}
        </div>

        <CostBlock state={cost} />
        <QuotaBlock cost={cost} rows={quotaRows} />
        <ActivityBlock runs={activityRuns} audit={activityAudit} />
      </div>
    </div>
  );
}
