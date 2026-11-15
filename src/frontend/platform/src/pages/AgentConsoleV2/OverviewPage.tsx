/* OV-01 slice 1: overview header + 4 KPI cards, real BFF aggregates only.
 * Every number comes from a service endpoint (E14 / AP8 / R6 / P9 batch);
 * nothing is aggregated over paginated rows in the client. The remaining
 * overview blocks (trend, quota, activity heatmap, table) stay honest text
 * placeholders until their waves — no fake charts, no fixtures in bundle.
 * When an endpoint 4xx/5xx or has no data the KPI shows an explicit reason
 * instead of a fabricated value ("no trend data" rather than "+2%"). */
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { userContext } from '@/contexts/userContext';

import {
  bucketSum,
  dayWindow,
  fetchApprovalStats,
  fetchBudgetMonth,
  fetchEmployeeStats,
  fetchEmployeesPage,
  fetchRunStats,
  fmtRatio,
  fmtTime,
  fmtUsd,
  makeFetcher,
  monthPeriod,
  type ApprovalStats,
  type BudgetBody,
  type EmployeeStats,
  type RunStatsBody,
} from './v2Data';

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

  const refresh = useCallback(() => setToken((x) => x + 1), []);

  useEffect(() => {
    let alive = true;
    setStats(pendingKpi);
    setApprovals(pendingKpi);
    setRuns(pendingKpi);
    setCost(pendingKpi);
    void (async () => {
      const window7 = dayWindow(7);
      const windowPrev = {
        from: dayWindow(14).from,
        to: window7.from,
      };
      const [s, a, r, rp, ids] = await Promise.all([
        fetchEmployeeStats(fetch),
        uid ? fetchApprovalStats(fetch, `human:${uid}`) : Promise.resolve(null),
        fetchRunStats(fetch, { ...window7, bucket: 'day' }),
        fetchRunStats(fetch, { ...windowPrev, bucket: 'day' }),
        fetchEmployeesPage(fetch, { limit: COST_ID_LIMIT }),
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

  return (
    <div className="a2s-page" data-testid="agent-v2-ov-page">
      <div className="a2-card" style={{ marginBottom: 12 }}>
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

      <div className="a2-kpis" style={{ marginBottom: 12 }}>
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
        {[
          'trendTitle',
          'quotaTitle',
          'heatTitle',
          'tableTitle',
        ].map((key) => (
          <div className="a2-card" key={key}>
            <h2 className="a2-h2">{t(`agentConsole.v2.ov.${key}`)}</h2>
            <p className="a2-card-sub" data-testid={`agent-v2-ov-${key}-placeholder`}>
              {t('agentConsole.v2.ov.placeholderNote')}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
