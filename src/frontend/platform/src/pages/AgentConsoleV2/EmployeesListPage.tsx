// W2 employees list (parity spec §4, EMP-01 page card).
// Every cross-employee aggregate comes from a service endpoint (E14 stats /
// AP8 approval-stats / R6 run-stats / P9 budget-usage / R7 run-activity).
// The client never reduces one page of rows into a fleet-wide number.
// Missing data renders as an em-dash or an explicit honest note — no fake
// zeroes, no fake curves, no internal keys leaking as labels.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { EmployeesHeatPanel } from './EmployeesHeatPanel';
import {
  dayWindow,
  fetchActivity,
  fetchApprovalStats,
  fetchBudgetMonth,
  fetchEmployeesPage,
  fetchEmployeeStats,
  fetchRunStats,
  fetchWorkstations,
  fmtId,
  fmtRatio,
  fmtTime,
  fmtUsd,
  bucketSum,
  makeFetcher,
  mapLimit,
  monthPeriod,
  summarizeStations,
  LIFECYCLE_ORDER,
  type ActivityBody,
  type ApiRes,
  type ApprovalStats,
  type BudgetBody,
  type EmployeeRow,
  type EmployeeStats,
  type RunStatsBody,
  type StationSummary,
  type Fetcher,
} from './v2Data';

// Real expansion dimensions supported by the domain service (B3). The
// work-order wording `stats,cost,owner` is not a valid dimension set and
// would be rejected upstream with 400 request.invalid_query.
const EXPAND = 'version,workstations,knowledge,pending';
const PAGE_LIMIT = 20;
const ROW_CAP = 4; // bounded per-row fan-out: never N+1 against a fleet

interface RowEnrich {
  stations?: StationSummary;
  stationsFailed?: boolean;
  runs?: RunStatsBody | null;
  runsFailed?: boolean;
}

interface KpiState {
  stats?: ApiRes<EmployeeStats>;
  approvals?: ApiRes<ApprovalStats>;
  anomalyNow?: ApiRes<RunStatsBody>;
  anomalyPrev?: ApiRes<RunStatsBody>;
  costNow?: ApiRes<BudgetBody>;
  costPrev?: ApiRes<BudgetBody>;
}

function isoShift(baseIso: string, days: number): string {
  return new Date(new Date(baseIso).getTime() - days * 86400000).toISOString();
}

function sumCost(body: BudgetBody | null | undefined, ids: string[]): { total: number | null; covered: number } {
  const items = body?.items ?? [];
  let total: number | null = null;
  let covered = 0;
  ids.forEach((id) => {
    const row = items.find((i) => i.employeeId === id);
    if (row && typeof row.costUsd === 'number' && Number.isFinite(row.costUsd)) {
      total = (total ?? 0) + row.costUsd;
      covered += 1;
    }
  });
  return { total, covered };
}

export function EmployeesListPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetchApi: Fetcher = useMemo(() => makeFetcher(), []);

  const keyword = searchParams.get('keyword') ?? '';
  const lifecycleState = searchParams.get('lifecycleState') ?? '';
  const cursor = searchParams.get('cursor') ?? '';
  const view = searchParams.get('view') ?? 'table';

  const [draftKeyword, setDraftKeyword] = useState(keyword);
  const [reloadToken, setReloadToken] = useState(0);
  const [listRes, setListRes] = useState<ApiRes<{ items: EmployeeRow[]; nextCursor?: string }> | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [kpi, setKpi] = useState<KpiState>({});
  const [heat, setHeat] = useState<{ body?: ActivityBody; failed?: boolean }>({});
  const [heatEmployeeId, setHeatEmployeeId] = useState('');
  const [rowEnrich, setRowEnrich] = useState<Record<string, RowEnrich>>({});
  const [copiedId, setCopiedId] = useState('');
  const pagesRef = useRef<string[]>(['']);
  const debounceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setDraftKeyword(keyword);
  }, [keyword]);

  const patchParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams);
      Object.entries(patch).forEach(([k, v]) => {
        if (v === null || v === '') next.delete(k);
        else next.set(k, v);
      });
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const commitKeyword = useCallback(
    (value: string) => {
      pagesRef.current = [''];
      patchParams({ keyword: value, cursor: null });
    },
    [patchParams],
  );

  const handleKeywordChange = (value: string) => {
    setDraftKeyword(value);
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => commitKeyword(value.trim()), 300);
  };

  const handleLifecycleTab = (state: string) => {
    pagesRef.current = [''];
    patchParams({ lifecycleState: state, cursor: null });
  };

  const handleView = (next: string) => {
    patchParams({ view: next === 'table' ? null : next });
  };

  const handleNextPage = () => {
    const nc = listRes?.data?.nextCursor;
    if (!nc) return;
    pagesRef.current.push(nc);
    patchParams({ cursor: nc });
  };

  const handlePrevPage = () => {
    if (pagesRef.current.length <= 1) return;
    pagesRef.current.pop();
    const prev = pagesRef.current[pagesRef.current.length - 1] ?? '';
    patchParams({ cursor: prev || null });
  };

  const handleRetry = () => {
    setReloadToken((n) => n + 1);
  };

  // ---- employee page request (E11 with batched enrichment) ----
  useEffect(() => {
    let alive = true;
    setListLoading(true);
    fetchEmployeesPage(fetchApi, {
      keyword: keyword || undefined,
      lifecycleState: lifecycleState || undefined,
      limit: PAGE_LIMIT,
      cursor: cursor || undefined,
      expand: EXPAND,
    }).then((res) => {
      if (alive) {
        setListRes(res);
        setListLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [fetchApi, keyword, lifecycleState, cursor, reloadToken]);

  // ---- KPI aggregates: E14 + AP8 + R6 two rolling windows + P9 months ----
  useEffect(() => {
    let alive = true;
    const win = dayWindow(7);
    const prevWin = { from: isoShift(win.from, 7), to: win.from };
    Promise.all([
      fetchEmployeeStats(fetchApi),
      fetchApprovalStats(fetchApi, 'human:1'),
      fetchRunStats(fetchApi, { from: win.from, to: win.to }),
      fetchRunStats(fetchApi, { from: prevWin.from, to: prevWin.to }),
    ]).then(([stats, approvals, anomalyNow, anomalyPrev]) => {
      if (alive) setKpi((k) => ({ ...k, stats, approvals, anomalyNow, anomalyPrev }));
    });
    return () => {
      alive = false;
    };
  }, [fetchApi, reloadToken]);

  // Keep `rows` referentially stable per listRes so downstream memos are sound.
  const rows = useMemo(
    () => (listRes?.ok ? listRes.data?.items ?? [] : []),
    [listRes],
  );
  const rowIds = useMemo(() => rows.map((r) => r.employeeId), [rows]);
  const rowIdsKey = rowIds.join(',');

  // ---- month cost KPI once ids are known (P9 batched, never per row) ----
  useEffect(() => {
    if (!rowIdsKey) return;
    let alive = true;
    const ids = rowIdsKey.split(',');
    const now = monthPeriod();
    const prev = (() => {
      const [y, m] = now.split('-').map(Number);
      const d = new Date(Date.UTC(m === 1 ? y - 1 : y, m === 1 ? 11 : m - 2, 1));
      return monthPeriod(d);
    })();
    Promise.all([fetchBudgetMonth(fetchApi, ids, now), fetchBudgetMonth(fetchApi, ids, prev)]).then(
      ([costNow, costPrev]) => {
        if (alive) setKpi((k) => ({ ...k, costNow, costPrev }));
      }
    );
    return () => {
      alive = false;
    };
  }, [fetchApi, rowIdsKey, reloadToken]);

  // ---- R7 heatmap, platform or single employee ----
  useEffect(() => {
    let alive = true;
    fetchActivity(fetchApi, { weeks: 1, tz: 'Asia/Shanghai', employeeId: heatEmployeeId || undefined }).then(
      (res) => {
        if (alive) setHeat(res.ok ? { body: res.data ?? undefined } : { failed: true });
      }
    );
    return () => {
      alive = false;
    };
  }, [fetchApi, heatEmployeeId, reloadToken]);

  // ---- per-row bounded columns: E10 station detail + R6 rolling 7d ----
  useEffect(() => {
    if (!rowIdsKey) {
      setRowEnrich({});
      return;
    }
    let alive = true;
    const ids = rowIdsKey.split(',');
    const win = dayWindow(7);
    mapLimit(ids, ROW_CAP, async (id) => {
      const [ws, rs] = await Promise.all([
        fetchWorkstations(fetchApi, id),
        fetchRunStats(fetchApi, { from: win.from, to: win.to, employeeId: id }),
      ]);
      const enrich: RowEnrich = {};
      if (ws.ok && ws.data) enrich.stations = summarizeStations(ws.data.items);
      else enrich.stationsFailed = true;
      if (rs.ok) enrich.runs = rs.data ?? null;
      else enrich.runsFailed = true;
      return [id, enrich] as const;
    }).then((pairs) => {
      if (alive) setRowEnrich(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
  }, [fetchApi, rowIdsKey, reloadToken]);

  const handleCopyId = (id: string) => {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(id).then(() => {
        setCopiedId(id);
        window.setTimeout(() => setCopiedId((c) => (c === id ? '' : c)), 2000);
      });
    }
  };

  // ---------- derived KPI values (service aggregates only) ----------
  const statsData = kpi.stats?.ok ? kpi.stats.data : undefined;
  const anomalyNowSum = kpi.anomalyNow?.ok ? bucketSum(kpi.anomalyNow.data?.buckets) : null;
  const anomalyPrevSum = kpi.anomalyPrev?.ok ? bucketSum(kpi.anomalyPrev.data?.buckets) : null;
  const costNowSum = kpi.costNow?.ok ? sumCost(kpi.costNow.data, rowIds) : null;
  const costPrevSum = kpi.costPrev?.ok ? sumCost(kpi.costPrev.data, rowIds) : null;
  const costIds = kpi.costNow?.data?.items?.length ?? 0;

  const costTrend =
    costNowSum && costPrevSum && costPrevSum.total !== null && costPrevSum.total > 0 && costNowSum.total !== null
      ? costNowSum.total / costPrevSum.total - 1
      : null;
  const anomalyTrend =
    anomalyNowSum && anomalyPrevSum && anomalyPrevSum.runs > 0 && anomalyNowSum.runs !== null
      ? anomalyNowSum.runs / anomalyPrevSum.runs - 1
      : null;

  // ---------- top-level states ----------
  const isAuth = listRes && !listRes.ok && (listRes.code === 'console.unauthenticated' || listRes.status === 401);
  const isForbidden =
    listRes && !listRes.ok && (listRes.code === 'console.forbidden' || listRes.status === 403);
  const isError = listRes && !listRes.ok && !isAuth && !isForbidden;

  return (
    <div className="a2s-page" data-testid="agent-v2-employees-page">
      <div className="a2-card-head">
        <div>
          <h1 className="a2-h1">{t('agentConsole.v2.navEmployees')}</h1>
          <p className="a2-meta">{t('agentConsole.v2.shell.employeesDesc')}</p>
        </div>
        <div className="a2-card-actions">
          <button
            type="button"
            className="a2-btn"
            data-testid="agent-v2-employees-create"
            disabled
            title={t('agentConsole.v2.emp.createDisabledNote')}
          >
            {t('agentConsole.v2.emp.createEntry')}
          </button>
        </div>
      </div>
      <p className="a2-meta" data-testid="agent-v2-employees-create-note">
        {t('agentConsole.v2.emp.createDisabledNote')}
      </p>

      {/* ---------- four KPI cards, service aggregates ---------- */}
      <div className="a2-kpis" data-testid="agent-v2-employees-kpis">
        <div className="a2-kpi">
          <span className="a2-meta">{t('agentConsole.v2.emp.kpiOnDuty')}</span>
          {kpi.stats && !kpi.stats.ok ? (
            <span className="a2-meta" data-testid="agent-v2-kpi-onduty-error">
              {t('agentConsole.v2.errorQuery')} {kpi.stats.code ?? ''} {kpi.stats.requestId ? `req ${kpi.stats.requestId}` : ''}
            </span>
          ) : (
            <>
              <span className="a2-kpi-num" data-testid="agent-v2-kpi-onduty">
                {statsData ? statsData.byLifecycle.active : '—'}
              </span>
              <span className="a2-meta">
                {statsData ? t('agentConsole.v2.emp.kpiNoteTotal', { count: statsData.total }) : ''}
              </span>
            </>
          )}
        </div>
        <div className="a2-kpi">
          <span className="a2-meta">{t('agentConsole.v2.emp.kpiPending')}</span>
          {kpi.approvals && !kpi.approvals.ok ? (
            <span className="a2-meta" data-testid="agent-v2-kpi-pending-error">
              {t('agentConsole.v2.errorQuery')} {kpi.approvals.code ?? ''}
            </span>
          ) : (
            <>
              <span className="a2-kpi-num" data-testid="agent-v2-kpi-pending">
                {kpi.approvals?.ok ? kpi.approvals.data?.pending ?? '—' : '—'}
              </span>
              <span className="a2-meta">
                {(kpi.approvals?.data?.dueSoon ?? 0) > 0
                  ? t('agentConsole.v2.emp.kpiDueSoonNote', { count: kpi.approvals?.data?.dueSoon ?? 0 })
                  : ''}
              </span>
            </>
          )}
        </div>
        <div className="a2-kpi">
          <span className="a2-meta">{t('agentConsole.v2.emp.kpiCost')}</span>
          {kpi.costNow && !kpi.costNow.ok ? (
            <span className="a2-meta" data-testid="agent-v2-kpi-cost-error">
              {t('agentConsole.v2.errorQuery')} {kpi.costNow.code ?? ''}
            </span>
          ) : (
            <>
              <span className="a2-kpi-num" data-testid="agent-v2-kpi-cost">
                {costNowSum ? fmtUsd(costNowSum.total) : '—'}
              </span>
              <span className="a2-meta">
                {costTrend !== null ? fmtRatio(costTrend) : t('agentConsole.v2.emp.kpiTrendUnavailable')}
              </span>
              <span className="a2-meta" data-testid="agent-v2-kpi-cost-caliber">
                {t('agentConsole.v2.emp.kpiCaliberLedger')} · {costIds}
              </span>
            </>
          )}
        </div>
        <div className="a2-kpi">
          <span className="a2-meta">{t('agentConsole.v2.emp.kpiAnomaly')}</span>
          {kpi.anomalyNow && !kpi.anomalyNow.ok ? (
            <span className="a2-meta" data-testid="agent-v2-kpi-anomaly-error">
              {t('agentConsole.v2.errorQuery')} {kpi.anomalyNow.code ?? ''}
            </span>
          ) : (
            <>
              <span className="a2-kpi-num" data-testid="agent-v2-kpi-anomaly">
                {anomalyNowSum ? anomalyNowSum.failed : '—'}
              </span>
              <span className="a2-meta">
                {anomalyTrend !== null ? fmtRatio(anomalyTrend) : t('agentConsole.v2.emp.kpiTrendUnavailable')}
              </span>
              <span className="a2-meta">{t('agentConsole.v2.emp.anomalyWindowNote')}</span>
            </>
          )}
        </div>
      </div>

      <EmployeesHeatPanel
        heat={heat}
        body={rows}
        heatEmployeeId={heatEmployeeId}
        onEmployeeChange={setHeatEmployeeId}
      />

      {/* ---------- filters ---------- */}
      <div className="a2-card" data-testid="agent-v2-employees-filters">
        <div className="a2-chips">
          <button
            type="button"
            className={`a2-pill${lifecycleState === '' ? ' active' : ''}`}
            onClick={() => handleLifecycleTab('')}
          >
            {t('agentConsole.v2.emp.filterAll')} {statsData ? statsData.total : ''}
          </button>
          {LIFECYCLE_ORDER.map((state) => (
            <button
              key={state}
              type="button"
              className={`a2-pill${lifecycleState === state ? ' active' : ''}`}
              data-testid={`agent-v2-filter-${state}`}
              onClick={() => handleLifecycleTab(state)}
            >
              {t(`agentConsole.lifecycle.${state}`)} {statsData ? statsData.byLifecycle[state] ?? 0 : ''}
            </button>
          ))}
        </div>
        <div className="a2-card-head">
          <input
            className="a2-input"
            value={draftKeyword}
            placeholder={t('agentConsole.v2.search')}
            data-testid="agent-v2-employees-search"
            onChange={(e) => handleKeywordChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitKeyword(draftKeyword.trim());
            }}
          />
          <button type="button" className="a2-btn" onClick={() => commitKeyword(draftKeyword.trim())}>
            {t('agentConsole.v2.query')}
          </button>
        </div>
        <div className="a2-chips" data-testid="agent-v2-employees-disabled-filters">
          <select className="a2-input" disabled aria-label={t('agentConsole.v2.emp.filterDept')}>
            <option>{t('agentConsole.v2.emp.filterDept')}</option>
          </select>
          <select className="a2-input" disabled aria-label={t('agentConsole.v2.emp.filterOwner')}>
            <option>{t('agentConsole.v2.emp.filterOwner')}</option>
          </select>
          <select className="a2-input" disabled aria-label={t('agentConsole.v2.emp.filterSeat')}>
            <option>{t('agentConsole.v2.emp.filterSeat')}</option>
          </select>
          <select className="a2-input" disabled aria-label={t('agentConsole.v2.emp.filterKnowledge')}>
            <option>{t('agentConsole.v2.emp.filterKnowledge')}</option>
          </select>
        </div>
        <p className="a2-meta" data-testid="agent-v2-filter-unavailable-note">
          {t('agentConsole.v2.emp.filterUnavailableNote')}
        </p>
        <div className="a2-chips">
          <button
            type="button"
            className={`a2-pill${view === 'table' ? ' active' : ''}`}
            onClick={() => handleView('table')}
          >
            {t('agentConsole.v2.emp.viewTable')}
          </button>
          <button
            type="button"
            className={`a2-pill${view === 'chat' ? ' active' : ''}`}
            onClick={() => handleView('chat')}
          >
            {t('agentConsole.v2.emp.viewChat')}
          </button>
        </div>
      </div>

      {/* ---------- main content by state ---------- */}
      {isAuth ? (
        <div className="a2-card" data-testid="agent-v2-employees-auth">
          <p className="a2-h2">{t('agentConsole.v2.emp.authExpired')}</p>
          <p className="a2-card-sub">{listRes?.code ?? ''}</p>
        </div>
      ) : isForbidden ? (
        <div className="a2-card" data-testid="agent-v2-employees-403">
          <p className="a2-h2">{t('agentConsole.v2.emp.noPermission')}</p>
          <p className="a2-card-sub">{listRes?.code ?? ''}</p>
        </div>
      ) : isError ? (
        <div className="a2-card" data-testid="agent-v2-employees-error">
          <p className="a2-h2">{t('agentConsole.v2.errorQuery')}</p>
          <p className="a2-card-sub">
            {listRes?.code ?? ''} {listRes?.requestId ? `req ${listRes.requestId}` : ''}
          </p>
          <button type="button" className="a2-btn" onClick={handleRetry}>
            {t('agentConsole.v2.retry')}
          </button>
        </div>
      ) : listLoading && !listRes ? (
        <div className="a2s-skeleton" data-testid="agent-v2-employees-loading" aria-hidden>
          {Array.from({ length: 10 }, (_, i) => (
            <span className="a2s-sk-row" key={i} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="a2-card" data-testid="agent-v2-employees-empty">
          <p className="a2-h2">{t('agentConsole.v2.emp.emptyEmployees')}</p>
          <p className="a2-card-sub">{t('agentConsole.v2.emp.filterUnavailableNote')}</p>
        </div>
      ) : view === 'chat' ? (
        <div className="a2-card" data-testid="agent-v2-employees-chatview">
          <p className="a2-card-sub">{t('agentConsole.v2.emp.chatViewEmptyNote')}</p>
        </div>
      ) : (
        <div className="a2-card">
          <table className="a2-body" data-testid="agent-v2-employees-table">
            <thead>
              <tr>
                <th>{t('agentConsole.v2.colName')}</th>
                <th>{t('agentConsole.v2.emp.colVersion')}</th>
                <th>{t('agentConsole.v2.colStatus')}</th>
                <th>{t('agentConsole.v2.colOwner')}</th>
                <th>{t('agentConsole.v2.emp.colWorkstation')}</th>
                <th>{t('agentConsole.v2.emp.colPending')}</th>
                <th>{t('agentConsole.v2.emp.colLastRun')}</th>
                <th>{t('agentConsole.v2.emp.colSuccessRate')}</th>
                <th>{t('agentConsole.v2.emp.colMonthCost')}</th>
                <th>{t('agentConsole.v2.colAction')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const en = rowEnrich[r.employeeId];
                const runs7 = en?.runs && en.runs !== null ? bucketSum(en.runs.buckets) : null;
                const lastBucket = en?.runs?.buckets?.length
                  ? en.runs.buckets[en.runs.buckets.length - 1]
                  : undefined;
                const monthCost = (kpi.costNow?.data?.items ?? []).find(
                  (i) => i.employeeId === r.employeeId
                );
                const quota = r.enrichment?.effectiveBudget?.monthlyCostUsd;
                const ratio =
                  typeof monthCost?.costUsd === 'number' && typeof quota === 'number' && quota > 0
                    ? monthCost.costUsd / quota
                    : null;
                return (
                  <tr key={r.employeeId} data-testid="agent-v2-employee-row">
                    <td>
                      <div className="a2-card-head">
                        <span className="a2-pill" aria-hidden>
                          {(r.name ?? '?').slice(0, 1)}
                        </span>
                        <span>
                          {r.name ?? '—'}
                          <span className="a2-meta">{r.title ? ` · ${r.title}` : ''}</span>
                        </span>
                      </div>
                    </td>
                    <td data-testid="agent-v2-col-version">
                      {r.enrichment?.currentVersionNo !== undefined ? (
                        <>
                          v{r.enrichment.currentVersionNo}
                          <span className="a2-meta">{fmtTime(r.enrichment.effectiveFrom)}</span>
                        </>
                      ) : (
                        <>
                          —<span className="a2-meta">{t('agentConsole.v2.emp.versionUnavailableNote')}</span>
                        </>
                      )}
                    </td>
                    <td data-testid="agent-v2-col-status">
                      {t(`agentConsole.lifecycle.${r.lifecycleState}`, r.lifecycleState)}
                    </td>
                    <td className="a2-mono">{fmtId(r.ownerUserId)}</td>
                    <td data-testid="agent-v2-col-workstation">
                      {en?.stations
                        ? `${en.stations.groups} · ${en.stations.dms} · ${en.stations.crons}`
                        : r.enrichment?.workstationCount !== undefined
                          ? r.enrichment.workstationCount
                          : en?.stationsFailed
                            ? '—'
                            : '…'}
                    </td>
                    <td data-testid="agent-v2-col-pending">
                      {r.enrichment?.pendingApprovalCount ?? (en ? '—' : '…')}
                    </td>
                    <td data-testid="agent-v2-col-lastrun">
                      {runs7 && runs7.runs > 0 ? (
                        <>
                          {/* Separator keeps count and timestamp readable as two values. */}
                          {runs7.runs}
                          {' · '}
                          <span className="a2-meta">{fmtTime(lastBucket?.bucketStart)}</span>
                        </>
                      ) : en
                        ? en.runsFailed
                          ? '—'
                          : t('agentConsole.v2.trendEmpty')
                        : '…'}
                    </td>
                    <td data-testid="agent-v2-col-success">
                      {runs7 && runs7.runs > 0 ? fmtRatio(runs7.succeeded / runs7.runs) : '—'}
                    </td>
                    <td data-testid="agent-v2-col-cost">
                      {kpi.costNow && !kpi.costNow.ok
                        ? '—'
                        : typeof monthCost?.costUsd === 'number'
                          ? fmtUsd(monthCost.costUsd)
                          : '—'}
                      {ratio !== null && (
                        <span
                          className={`a2-pill${ratio >= 0.85 ? ' a2-danger' : ratio >= 0.6 ? ' a2-warn' : ''}`}
                          data-testid="agent-v2-col-cost-ratio"
                        >
                          {fmtRatio(ratio)}
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="a2-card-actions">
                        <button
                          type="button"
                          className="a2-btn"
                          onClick={() => handleCopyId(r.employeeId)}
                          data-testid="agent-v2-copy-id"
                        >
                          {t('agentConsole.v2.emp.copyId')}
                        </button>
                        <button type="button" className="a2-btn" disabled title={t('agentConsole.v2.emp.detailPending')}>
                          {t('agentConsole.v2.detail')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="a2-card-head">
            <button
              type="button"
              className="a2-btn"
              onClick={handlePrevPage}
              disabled={pagesRef.current.length <= 1}
            >
              {t('agentConsole.v2.emp.prevPage')}
            </button>
            <span className="a2-meta" data-testid="agent-v2-page-info">
              {t('agentConsole.v2.emp.pageInfo', { page: pagesRef.current.length, count: rows.length })}
            </span>
            <button
              type="button"
              className="a2-btn"
              onClick={handleNextPage}
              disabled={!listRes?.data?.nextCursor}
              data-testid="agent-v2-next-page"
            >
              {t('agentConsole.v2.emp.nextPage')}
            </button>
          </div>
        </div>
      )}
      <span aria-live="polite" data-testid="agent-v2-copy-toast">
        {copiedId ? t('agentConsole.v2.emp.copiedToast') : ''}
      </span>
    </div>
  );
}
