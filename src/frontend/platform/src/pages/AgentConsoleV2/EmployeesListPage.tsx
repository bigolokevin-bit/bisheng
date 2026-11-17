// W2 employees list (parity spec §4, EMP-01 page card).
// Every cross-employee aggregate comes from a service endpoint (E14 stats /
// AP8 approval-stats / R6 run-stats / P9 budget-usage / R7 run-activity).
// The client never reduces one page of rows into a fleet-wide number.
// Missing data renders as an em-dash or an explicit honest note — no fake
// zeroes, no fake curves, no internal keys leaking as labels.
// EMP-01 r5 (G15, same idiom as OV-01 blockUnavailable): error copy is fully
// localized; the HTTP status is only an interpolation parameter and the
// internal machine code (console.forbidden / run.invalid_query /
// budget.range_too_large / agent.http.*) never reaches the screen. The
// requestId is offered through an explicit "copy diagnostics" control and is
// never inlined in body text.
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { userContext } from '@/contexts/userContext';
import { EmployeesHeatPanel } from './EmployeesHeatPanel';
import { HelpTip } from './HelpTip';
import { LkIcon } from './listkit/icons';
import {
  avatarChar,
  duplicateNames,
  employeeDisplayName,
  ownerDisplayLabel,
} from './identity';
import {
  dayWindow,
  fetchActivity,
  fetchApprovalStats,
  fetchBudgetMonth,
  fetchEmployeesPage,
  fetchEmployeeStats,
  fetchRunStats,
  fetchWorkstations,
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

// EMP-01 C2: in-page sorting. E11 has no server-side sort, so the order is
// applied to the currently loaded page only and recorded in the URL (?sort=
// col:asc|desc). Scope is stated in EVIDENCE.md; no cross-page promise.
type SortCol =
  | 'name'
  | 'version'
  | 'status'
  | 'owner'
  | 'workstation'
  | 'pending'
  | 'lastRun'
  | 'success'
  | 'cost';

const SORT_COLS: SortCol[] = [
  'name',
  'version',
  'status',
  'owner',
  'workstation',
  'pending',
  'lastRun',
  'success',
  'cost',
];

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

// G15: copies ONLY the request id (safe diagnostic handle). Never the token,
// never the response body, never the internal machine code.
function DiagCopyButton({ requestId, testId }: { requestId?: string; testId: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  if (!requestId) return null;
  const handleCopy = () => {
    if (!navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(requestId).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button type="button" className="a2-btn" data-testid={testId} onClick={handleCopy}>
      {copied ? t('agentConsole.v2.emp.copiedToast') : t('agentConsole.v2.emp.copyDiag')}
    </button>
  );
}

// P0-1 (observer pixel audit): the KPI failure line used to print the HTTP
// status ("…暂时取不到（HTTP 500）"), so one error state read as three
// different things (dark: code on screen, light/375: bare "—"). It now keeps
// the SAME shape as the healthy KPI — value line "—" + one reason line — and
// the HTTP status / internal code never reach the DOM. Only the requestId
// stays reachable, behind the copy-diagnostics control.
function KpiBlockError({
  res,
  reason,
  testIdBase,
}: {
  res: ApiRes<unknown>;
  reason: string;
  testIdBase: string;
}) {
  return (
    <>
      <span className="a2-kpi-num" data-testid={testIdBase}>
        —
      </span>
      <span className="a2-meta" data-testid={`${testIdBase}-error`}>
        {reason}
      </span>
      <DiagCopyButton requestId={res.requestId} testId={`${testIdBase}-diag`} />
    </>
  );
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

/* P0-2 (observer pixel audit) → S2: the FULL ref (`human:<uid>`) is kept in
   the cell title for debugging, but the printed text is the readable identity
   (ownerDisplayLabel below): 「用户 #1」/「未知」, never the raw prefix. */
function ownerRef(ownerUserId?: string | null): string {
  if (!ownerUserId) return '';
  return ownerUserId.includes(':') ? ownerUserId : `human:${ownerUserId}`;
}

export function EmployeesListPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetchApi: Fetcher = useMemo(() => makeFetcher(), []);

  const keyword = searchParams.get('keyword') ?? '';
  const lifecycleState = searchParams.get('lifecycleState') ?? '';
  const cursor = searchParams.get('cursor') ?? '';
  const view = searchParams.get('view') ?? 'table';
  const sortParam = searchParams.get('sort') ?? '';
  const rawLimit = Number.parseInt(searchParams.get('limit') ?? '', 10);
  const pageLimit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), 50)
    : PAGE_LIMIT;

  const [draftKeyword, setDraftKeyword] = useState(keyword);
  const [reloadToken, setReloadToken] = useState(0);
  const [listRes, setListRes] = useState<ApiRes<{ items: EmployeeRow[]; nextCursor?: string }> | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [kpi, setKpi] = useState<KpiState>({});
  const [heat, setHeat] = useState<{ body?: ActivityBody; failed?: boolean }>({});
  const [heatEmployeeId, setHeatEmployeeId] = useState('');
  const [rowEnrich, setRowEnrich] = useState<Record<string, RowEnrich>>({});
  const [copiedId, setCopiedId] = useState('');
  const [tableOverflows, setTableOverflows] = useState(false);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
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

  const handleSort = (col: SortCol) => {
    pagesRef.current = [''];
    if (!sortCol || sortCol !== col) patchParams({ sort: `${col}:asc`, cursor: null });
    else if (sortDir === 'asc') patchParams({ sort: `${col}:desc`, cursor: null });
    else patchParams({ sort: null, cursor: null });
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
      limit: pageLimit,
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
  }, [fetchApi, keyword, lifecycleState, cursor, pageLimit, reloadToken]);

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
  /* S2: same-name distinguishers + the operator's own identity (session only,
     no new endpoint) for the readable owner cell. */
  const dups = useMemo(
    () => duplicateNames(rows.map((r) => ({ id: r.employeeId, name: r.name }))),
    [rows],
  );
  const ctx = useContext(userContext) as
    | { user?: { user_id?: number | string; user_name?: string; name?: string; username?: string } }
    | null;
  const currentUid =
    ctx?.user?.user_id === undefined || ctx?.user?.user_id === null
      ? ''
      : String(ctx.user.user_id);
  const currentName = String(ctx?.user?.user_name || ctx?.user?.name || ctx?.user?.username || '');
  const rowIds = useMemo(() => rows.map((r) => r.employeeId), [rows]);
  const rowIdsKey = rowIds.join(',');

  // ---- EMP-01 C2: in-page sort over the loaded rows only ----
  const sortMatch = /^([A-Za-z]+):(asc|desc)$/.exec(sortParam);
  const sortCol: SortCol | null =
    sortMatch && SORT_COLS.indexOf(sortMatch[1] as SortCol) >= 0
      ? (sortMatch[1] as SortCol)
      : null;
  const sortDir: 'asc' | 'desc' = sortMatch?.[2] === 'desc' ? 'desc' : 'asc';

  const sortValue = useCallback(
    (r: EmployeeRow): number | string | null => {
      if (!sortCol) return null;
      const en = rowEnrich[r.employeeId];
      const runs7 = en?.runs ? bucketSum(en.runs.buckets) : null;
      const costRow = (kpi.costNow?.data?.items ?? []).find(
        (i) => i.employeeId === r.employeeId
      );
      switch (sortCol) {
        case 'name':
          return r.name ?? null;
        case 'version':
          return r.enrichment?.currentVersionNo ?? null;
        case 'status':
          return r.lifecycleState ?? null;
        case 'owner':
          return r.ownerUserId ?? null;
        case 'workstation':
          return en?.stations?.total ?? r.enrichment?.workstationCount ?? null;
        case 'pending':
          return r.enrichment?.pendingApprovalCount ?? null;
        case 'lastRun':
          return runs7 && runs7.runs > 0 ? runs7.runs : null;
        case 'success':
          return runs7 && runs7.runs > 0 ? runs7.succeeded / runs7.runs : null;
        case 'cost':
          return typeof costRow?.costUsd === 'number' ? costRow.costUsd : null;
        default:
          return null;
      }
    },
    [sortCol, rowEnrich, kpi.costNow]
  );

  const displayRows = useMemo(() => {
    if (!sortCol) return rows;
    return [...rows].sort((a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      // Rows missing the sort value always sink to the bottom, either direction.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortCol, sortDir, sortValue]);

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

  /* P1-3: the phone-width table scrolls inside its card; say so ONLY while the
     wrapper actually overflows (measured), so 1440 — where the table fits —
     never shows a hint that contradicts reality. */
  useEffect(() => {
    const measure = () => {
      const el = tableScrollRef.current;
      setTableOverflows(!!el && el.scrollWidth > el.clientWidth);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [displayRows, view, listLoading, listRes]);

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
            <KpiBlockError
              res={kpi.stats}
              reason={t('agentConsole.v2.metricsUnavailable')}
              testIdBase="agent-v2-kpi-onduty"
            />
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
            <KpiBlockError
              res={kpi.approvals}
              reason={t('agentConsole.overview.pendingUnavailable')}
              testIdBase="agent-v2-kpi-pending"
            />
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
            <KpiBlockError
              res={kpi.costNow}
              reason={t('agentConsole.v2.emp.kpiCostUnavailable')}
              testIdBase="agent-v2-kpi-cost"
            />
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
            <KpiBlockError
              res={kpi.anomalyNow}
              reason={t('agentConsole.v2.ov.anomalyUnavailable')}
              testIdBase="agent-v2-kpi-anomaly"
            />
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
          <p className="a2-card-sub">{t('agentConsole.v2.emp.authHint')}</p>
          <div className="a2-card-actions">
            <button
              type="button"
              className="a2-btn"
              data-testid="agent-v2-employees-retry"
              onClick={handleRetry}
            >
              {t('agentConsole.v2.retry')}
            </button>
            <DiagCopyButton requestId={listRes?.requestId} testId="agent-v2-employees-diag" />
          </div>
        </div>
      ) : isForbidden ? (
        <div className="a2-card" data-testid="agent-v2-employees-403">
          <p className="a2-h2">{t('agentConsole.v2.emp.noPermission')}</p>
          <p className="a2-card-sub">{t('agentConsole.v2.emp.forbiddenHint')}</p>
          <div className="a2-card-actions">
            <button
              type="button"
              className="a2-btn"
              data-testid="agent-v2-employees-retry"
              onClick={handleRetry}
            >
              {t('agentConsole.v2.retry')}
            </button>
            <DiagCopyButton requestId={listRes?.requestId} testId="agent-v2-employees-diag" />
          </div>
        </div>
      ) : isError ? (
        <div className="a2-card" data-testid="agent-v2-employees-error">
          <p className="a2-h2">{t('agentConsole.v2.errorQuery')}</p>
          {/* G15: localized line with the HTTP status as an interpolation
              parameter only — the internal code is never rendered. */}
          <p className="a2-card-sub" data-testid="agent-v2-employees-error-detail">
            {t('agentConsole.v2.ov.blockUnavailable', {
              block: t('agentConsole.v2.navEmployees'),
              code: listRes?.status ?? '',
            })}
          </p>
          <div className="a2-card-actions">
            <button
              type="button"
              className="a2-btn"
              data-testid="agent-v2-employees-retry"
              onClick={handleRetry}
            >
              {t('agentConsole.v2.retry')}
            </button>
            <DiagCopyButton requestId={listRes?.requestId} testId="agent-v2-employees-diag" />
          </div>
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
          <div
            className="a2-table-scroll"
            ref={tableScrollRef}
            data-testid="agent-v2-employees-table-scroll"
          >
          <table className="a2-table" data-testid="agent-v2-employees-table">
            <thead>
              <tr>
                <th aria-sort={sortCol === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button
                    type="button"
                    className="a2-th-btn"
                    data-testid="agent-v2-sort-name"
                    onClick={() => handleSort('name')}
                  >
                    {t('agentConsole.v2.colName')}
                    <span aria-hidden>
                      {sortCol === 'name' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
                <th
                  className="r"
                  aria-sort={sortCol === 'version' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    className="a2-th-btn"
                    data-testid="agent-v2-sort-version"
                    onClick={() => handleSort('version')}
                  >
                    {t('agentConsole.v2.emp.colVersion')}
                    <span aria-hidden>
                      {sortCol === 'version' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
                <th aria-sort={sortCol === 'status' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button
                    type="button"
                    className="a2-th-btn"
                    data-testid="agent-v2-sort-status"
                    onClick={() => handleSort('status')}
                  >
                    {t('agentConsole.v2.colStatus')}
                    <span aria-hidden>
                      {sortCol === 'status' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
                <th
                  className="r"
                  aria-sort={sortCol === 'owner' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <span className="a2-th-help">
                    <button
                      type="button"
                      className="a2-th-btn"
                      data-testid="agent-v2-sort-owner"
                      onClick={() => handleSort('owner')}
                    >
                      {t('agentConsole.v2.colOwner')}
                      <span aria-hidden>
                        {sortCol === 'owner' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                      </span>
                    </button>
                    {/* P1 batch2 → S2: the owner tooltip keeps the full
                        `human:<id>` ref — say what the prefix is. */}
                    <HelpTip term="humanPrefix" testId="agent-v2-emp-help-owner" />
                  </span>
                </th>
                <th
                  className="r"
                  aria-sort={sortCol === 'workstation' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    className="a2-th-btn"
                    data-testid="agent-v2-sort-workstation"
                    onClick={() => handleSort('workstation')}
                  >
                    {t('agentConsole.v2.emp.colWorkstation')}
                    <span aria-hidden>
                      {sortCol === 'workstation' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
                <th
                  className="r"
                  aria-sort={sortCol === 'pending' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    className="a2-th-btn"
                    data-testid="agent-v2-sort-pending"
                    onClick={() => handleSort('pending')}
                  >
                    {t('agentConsole.v2.emp.colPending')}
                    <span aria-hidden>
                      {sortCol === 'pending' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
                <th
                  className="r"
                  aria-sort={sortCol === 'lastRun' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    className="a2-th-btn"
                    data-testid="agent-v2-sort-lastRun"
                    onClick={() => handleSort('lastRun')}
                  >
                    {t('agentConsole.v2.emp.colLastRun')}
                    <span aria-hidden>
                      {sortCol === 'lastRun' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
                <th
                  className="r"
                  aria-sort={sortCol === 'success' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    className="a2-th-btn"
                    data-testid="agent-v2-sort-success"
                    onClick={() => handleSort('success')}
                  >
                    {t('agentConsole.v2.emp.colSuccessRate')}
                    <span aria-hidden>
                      {sortCol === 'success' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
                <th
                  className="r"
                  aria-sort={sortCol === 'cost' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    className="a2-th-btn"
                    data-testid="agent-v2-sort-cost"
                    onClick={() => handleSort('cost')}
                  >
                    {t('agentConsole.v2.emp.colMonthCost')}
                    <span aria-hidden>
                      {sortCol === 'cost' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
                <th>{t('agentConsole.v2.colAction')}</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((r) => {
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
                /* S2 display identities: readable name (duplicates get the id
                   tail), 「未命名」 when empty; owner never prints `human:`. */
                const shownName = employeeDisplayName(
                  { id: r.employeeId, name: r.name },
                  dups,
                  t,
                );
                const nameAva = avatarChar(shownName);
                const ownerShown = ownerDisplayLabel(r.ownerUserId, t, {
                  currentUid,
                  currentName: currentName || undefined,
                });
                const ownerRaw = ownerRef(r.ownerUserId);
                const ownerTitle =
                  ownerRaw && ownerShown !== t('agentConsole.v2.id.unknown') ? ownerRaw : undefined;
                return (
                  <tr key={r.employeeId} data-testid="agent-v2-employee-row">
                    <td className="a2-col-name" data-testid="agent-v2-col-name">
                      <div className="a2-card-head">
                        <span className="a2-pill" aria-hidden>
                          {nameAva ?? <LkIcon name="user" size={12} />}
                        </span>
                        <span className="a2-name-cell">
                          <span title={r.name || undefined}>{shownName}</span>
                          <span className="a2-meta" title={r.title ?? undefined}>
                            {r.title ? ` · ${r.title}` : ''}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="r" data-testid="agent-v2-col-version">
                      {r.enrichment?.currentVersionNo !== undefined ? (
                        <>
                          v{r.enrichment.currentVersionNo}
                          {" · "}
                          <span className="a2-meta">{fmtTime(r.enrichment.effectiveFrom)}</span>
                        </>
                      ) : (
                        <>
                          —<span className="a2-meta">{t('agentConsole.v2.emp.versionUnavailableNote')}</span>
                        </>
                      )}
                    </td>
                    <td className="a2-cell-nowrap" data-testid="agent-v2-col-status">
                      {t(`agentConsole.lifecycle.${r.lifecycleState}`, r.lifecycleState)}
                    </td>
                    <td
                      className="a2-cell-nowrap r"
                      title={ownerTitle}
                      data-testid="agent-v2-col-owner"
                    >
                      {ownerShown}
                    </td>
                    <td data-testid="agent-v2-col-workstation" className="a2-cell-nowrap r">
                      {en?.stations
                        ? `${en.stations.groups} · ${en.stations.dms} · ${en.stations.crons}`
                        : r.enrichment?.workstationCount !== undefined
                          ? r.enrichment.workstationCount
                          : en?.stationsFailed
                            ? '—'
                            : '…'}
                    </td>
                    <td className="r" data-testid="agent-v2-col-pending">
                      {r.enrichment?.pendingApprovalCount ?? (en ? '—' : '…')}
                    </td>
                    <td className="r" data-testid="agent-v2-col-lastrun">
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
                    <td className="r" data-testid="agent-v2-col-success">
                      {runs7 && runs7.runs > 0 ? fmtRatio(runs7.succeeded / runs7.runs) : '—'}
                    </td>
                    <td className="r" data-testid="agent-v2-col-cost">
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
                        {/* EMP-03: detail route is live — link instead of disabled stub. */}
                        <NavLink
                          className="a2-btn"
                          to={`/agent/employees/${r.employeeId}`}
                          data-testid="agent-v2-employee-detail-link"
                        >
                          {t('agentConsole.v2.detail')}
                        </NavLink>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
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
          {/* P1-3: conditional, measurement-backed — hidden when the table fits */}
          {tableOverflows && (
            <p className="a2-scroll-hint" data-testid="agent-v2-employees-scroll-hint">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <polyline points="18 8 22 12 18 16" />
                <polyline points="6 8 2 12 6 16" />
                <line x1="2" x2="22" y1="12" y2="12" />
              </svg>
              {t('agentConsole.v2.tableScrollHint')}
            </p>
          )}
        </div>
      )}
      <span aria-live="polite" data-testid="agent-v2-copy-toast">
        {copiedId ? t('agentConsole.v2.emp.copiedToast') : ''}
      </span>
    </div>
  );
}
