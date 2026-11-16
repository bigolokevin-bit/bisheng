/* RUN-01 runs list page (card docs/validation/console/runs-list/ACCEPTANCE.md).
 * /agent/runs — 10 fixed columns, filters in URL query, cursor pagination with
 * an anti-replay guard, four states (loading/empty/error/auth).
 * Data plane ONLY: GET /api/employees?limit=100 (dropdown), GET /api/runs
 * (R5: employeeId|status|since|limit|cursor), lazy single-row GET
 * /api/run-detail?id= (R2) to fill detail keys the list row omits, all through
 * the same-origin /agent-api dev-proxy fetcher (makeFetcher from ./v2Data).
 * Honesty rules from the card, enforced in code:
 * - The BFF requires at least one filter (employeeId|status|since); a bare
 *   request 400s with request.missing_filter upstream. With no filter present
 *   the page shows a guidance line and NEVER fires a bare /api/runs request,
 *   and NEVER client-side-filters an unrequested fetch-all.
 * - An upstream 400/5xx is surfaced as localized copy with the HTTP status
 *   ONLY — machine codes (request.missing_filter, run.stats_range_too_large,
 *   …) never reach the screen (G15).
 * - costUsd missing with costStatus=unknown renders the literal 'unknown';
 *   any other missing money renders '—'. Never a fabricated 0.
 * - 来源 uses conservative labels derived ONLY from key presence on the row
 *   (channelEventId/taskId/previousRunId/upstreamRunId); nothing else is
 *   invented (no 手动/定时). reasonCode stays off-screen.
 * - Invalid/expired cursors are NOT 4xx: the upstream SILENTLY returns 200
 *   with the FIRST page again (measured main 6862bae lane note). So load-more
 *   tracks the runId set seen this session; an overlapping page stops the
 *   load, shows rl.cursorStale, and fires no further requests until a manual
 *   retry resets to the first page. No total count is ever shown.
 * - No free-text search, no source filter control enabled (upstream lacks the
 *   parameter — the control is rendered DISABLED with a visible reason).
 * RUN-02 (detail page) is not built: the 查看 button is DISABLED with a
 * title explaining why. When the orchestrator wires this page, shellPages
 * RunsPage should render <RunsListPage /> — the root div carries the
 * data-testid="agent-v2-page-runs" wrapper expectation. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { fmtId, fmtTime, makeFetcher, type ApiRes, type Fetcher } from './v2Data';

// ---------- shapes (measured against the live BFF 2026-11-16, RUN-TAB-DATA §4) ----

// One R5 list row = the generated `Run` model, 20 keys; R2 run-detail returns
// the SAME key set (no summary). costUsd is OMITTED (not 0) when
// costStatus='unknown'; endedAt is null until the run finishes. Declared
// locally because v2Data.ts is owned by another lane (read-only import there).
interface RunRow {
  runId: string;
  employeeId?: string;
  employeeVersionNo?: number;
  upstreamRunId?: string | null;
  channelEventId?: string | null;
  taskId?: string | null;
  previousRunId?: string | null;
  status?: string;
  reasonCode?: string | null; // never rendered raw (machine-code shape, G15)
  costUsd?: number;
  costStatus?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
}

interface RunsListBody {
  items: RunRow[];
  // keyset (created_at,id) DESC; present only when a next page exists.
  nextCursor?: string | null;
}

// R3 event row (measured live in the RUN-TAB-DATA / v2-4 captures): the list
// body omits `summary`; payload.output exists only on terminal output
// events — absence renders 不可得, never a fabricated line.
interface RunEventRow {
  seq?: number;
  eventType?: string;
  payload?: Record<string, unknown>;
}
interface RunEventsBody {
  items?: RunEventRow[];
}

// reasonCode is machine-shaped (run.upstream_completed): ONLY ever surfaced
// through this conservative map, with 不可得 as the honest fallback — the
// raw code never reaches the screen (G15).
const REASON_LABEL_KEYS: Record<string, string> = {
  'run.upstream_completed': 'agentConsole.v2.rl.reasonUpstream',
  'run.cancelled_by_operator': 'agentConsole.v2.rl.reasonCancelled',
  'run.budget_exceeded': 'agentConsole.v2.rl.reasonBudget',
  'run.failed': 'agentConsole.v2.rl.reasonFailed',
};

// E11 rows are consumed only for the employee dropdown (id → name).
interface EmployeeOption {
  employeeId: string;
  name?: string;
}
interface EmployeesBody {
  items: EmployeeOption[];
}

// ---------- pure display helpers ----------

const SINCE_MS: Record<string, number> = {
  '24h': 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
  '30d': 30 * 24 * 3600_000,
};
const SINCE_KEYS = ['24h', '7d', '30d'] as const;
const STATUS_VALUES = ['completed', 'running', 'failed'] as const;
const PAGE_LIMIT = 20;

function sinceIso(key: string): string | undefined {
  const ms = SINCE_MS[key];
  if (!ms) return undefined;
  return new Date(Date.now() - ms).toISOString();
}

/** endedAt − startedAt, human-compact; unfinished runs render '—' — a running
 *  row NEVER gets a fabricated duration (card §3). */
function fmtDuration(startedAt?: string | null, endedAt?: string | null): string {
  if (!startedAt || !endedAt) return '—';
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

/** Raw upstream figure, never re-rounded; missing money is NEVER a 0:
 *  costStatus=unknown → literal 'unknown', any other absence → '—'. */
function fmtCost(row: RunRow): string {
  if (typeof row.costUsd === 'number' && Number.isFinite(row.costUsd)) return String(row.costUsd);
  if (row.costStatus === 'unknown') return 'unknown';
  return '—';
}

export function RunsListPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetchApi: Fetcher = useMemo(() => makeFetcher(), []);

  // ---------- URL state (survives refresh / share / back) ----------
  const employeeId = searchParams.get('employee') ?? '';
  const status = searchParams.get('status') ?? '';
  const sinceKey = searchParams.get('since') ?? '';
  const rawLimit = Number.parseInt(searchParams.get('limit') ?? '', 10);
  const pageLimit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), 100)
    : PAGE_LIMIT;
  const hasFilter = employeeId !== '' || status !== '' || sinceKey !== '';

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

  const [reloadToken, setReloadToken] = useState(0);
  const handleRetry = () => setReloadToken((n) => n + 1);

  // ---------- employees dropdown (E11, no filter requirement) ----------
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  useEffect(() => {
    let alive = true;
    fetchApi<EmployeesBody>('/api/employees', { limit: 100 }).then((res) => {
      if (alive && res.ok) setEmployees(res.data?.items ?? []);
    });
    return () => {
      alive = false;
    };
  }, [fetchApi]);
  const employeeName = useCallback(
    (id?: string) => {
      if (!id) return '—';
      const hit = employees.find((e) => e.employeeId === id);
      return hit?.name || fmtId(id);
    },
    [employees],
  );

  // ---------- runs list (first page + accumulated cursor pages) ----------
  const [listRes, setListRes] = useState<ApiRes<RunsListBody> | null>(null);
  const [rows, setRows] = useState<RunRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  // cursor anti-replay guard (mandate 2): silently-duplicated first page is
  // detected by runId overlap against everything already shown this session.
  const seenRunIds = useRef<Set<string>>(new Set());
  const [cursorStale, setCursorStale] = useState(false);
  const [moreErrorStatus, setMoreErrorStatus] = useState<number | null>(null);

  // lazy run-detail patches for rows whose list payload omits detail keys;
  // patchedRef keeps the promise single-flight per run (no refetch storms
  // when 加载更多 grows the row set).
  const [detailPatch, setDetailPatch] = useState<Record<string, RunRow>>({});
  const patchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!hasFilter) {
      setListRes(null);
      setRows([]);
      setNextCursor(null);
      setCursorStale(false);
      setMoreErrorStatus(null);
      setLoading(false);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    setCursorStale(false);
    setMoreErrorStatus(null);
    seenRunIds.current = new Set();
    fetchApi<RunsListBody>('/api/runs', {
      employeeId: employeeId || undefined,
      status: status || undefined,
      since: sinceIso(sinceKey),
      limit: pageLimit,
    }).then((res) => {
      if (!alive) return;
      setListRes(res);
      setLoading(false);
      const items = res.ok ? res.data?.items ?? [] : [];
      seenRunIds.current = new Set(items.map((r) => r.runId));
      setRows(items);
      setNextCursor(res.ok ? res.data?.nextCursor ?? null : null);
    });
    return () => {
      alive = false;
    };
  }, [fetchApi, hasFilter, employeeId, status, sinceKey, pageLimit, reloadToken]);

  const handleLoadMore = () => {
    if (!nextCursor || cursorStale || moreLoading) return;
    setMoreLoading(true);
    fetchApi<RunsListBody>('/api/runs', {
      employeeId: employeeId || undefined,
      status: status || undefined,
      since: sinceIso(sinceKey),
      limit: pageLimit,
      cursor: nextCursor,
    }).then((res) => {
      setMoreLoading(false);
      if (!res.ok) {
        setMoreErrorStatus(res.status);
        return;
      }
      const items = res.data?.items ?? [];
      // Anti-replay: the upstream returns HTTP 200 + the FIRST page again for
      // invalid/expired cursors. Any runId overlap with pages already shown
      // means the cursor went stale: STOP loading (no append, no further
      // requests) until a manual retry resets the sequence.
      if (items.some((r) => seenRunIds.current.has(r.runId))) {
        setCursorStale(true);
        setNextCursor(null);
        return;
      }
      items.forEach((r) => seenRunIds.current.add(r.runId));
      setRows((prev) => [...prev, ...items]);
      setNextCursor(res.data?.nextCursor ?? null);
    });
  };

  // ---------- lazy per-row run-detail merge (R2, same 20-key model) ----------
  const rowKey = rows.map((r) => r.runId).join(',');
  useEffect(() => {
    if (!rowKey) {
      setDetailPatch({});
      return undefined;
    }
    const missing = rows.filter(
      (r) => r.costStatus === undefined || r.employeeVersionNo === undefined
    );
    if (missing.length === 0) return undefined;
    let alive = true;
    Promise.all(
      missing.map((r) => fetchApi<RunRow>('/api/run-detail', { id: r.runId }))
    ).then((resList) => {
      if (!alive) return;
      const patches: Record<string, RunRow> = {};
      resList.forEach((res, i) => {
        if (res.ok && res.data) patches[missing[i].runId] = res.data;
      });
      setDetailPatch(patches);
    });
    return () => {
      alive = false;
    };
    // rows identity changes on every append; key on ids only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchApi, rowKey]);

  const mergedRows = useMemo(
    () => rows.map((r) => (detailPatch[r.runId] ? { ...r, ...detailPatch[r.runId] } : r)),
    [rows, detailPatch]
  );

  // ---------- copied-id affordance (same idiom as EmployeesListPage) ----------
  const [copiedId, setCopiedId] = useState('');
  const handleCopyId = (id: string) => {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(id).then(() => {
        setCopiedId(id);
        window.setTimeout(() => setCopiedId((c) => (c === id ? '' : c)), 2000);
      });
    }
  };

  // ---------- top-level states (same ladder as EmployeesListPage) ----------
  const isAuth = listRes !== null && !listRes.ok && listRes.status === 401;
  const isForbidden = listRes !== null && !listRes.ok && listRes.status === 403;
  const isNotFound = listRes !== null && !listRes.ok && listRes.status === 404;
  const isError =
    listRes !== null && !listRes.ok && !isAuth && !isForbidden && !isNotFound;

  return (
    <div className="a2s-page" data-testid="agent-v2-page-runs">
      <div className="a2-card-head">
        <div>
          <h1 className="a2-h1">{t('agentConsole.v2.navRuns')}</h1>
          <p className="a2-meta">{t('agentConsole.v2.rl.desc')}</p>
        </div>
      </div>

      {/* ---------- filters: all in URL query; NO free-text search ---------- */}
      <div className="a2-card" data-testid="agent-v2-rl-filters">
        <div className="a2-card-head">
          <label className="a2-meta" htmlFor="rl-employee">
            {t('agentConsole.v2.rl.filterEmployee')}
          </label>
          <select
            id="rl-employee"
            className="a2-input"
            data-testid="agent-v2-rl-filter-employee"
            value={employeeId}
            onChange={(e) => patchParams({ employee: e.target.value || null })}
          >
            <option value="">{t('agentConsole.v2.rl.all')}</option>
            {employees
              .filter((emp) => emp.employeeId !== '')
              .map((emp) => (
                <option key={emp.employeeId} value={emp.employeeId}>
                  {emp.name || emp.employeeId}
                </option>
              ))}
          </select>
          <label className="a2-meta" htmlFor="rl-status">
            {t('agentConsole.v2.rl.filterStatus')}
          </label>
          <select
            id="rl-status"
            className="a2-input"
            data-testid="agent-v2-rl-filter-status"
            value={status}
            onChange={(e) => patchParams({ status: e.target.value || null })}
          >
            <option value="">{t('agentConsole.v2.rl.all')}</option>
            {STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {t(`agentConsole.runs.status.${s}`, s)}
              </option>
            ))}
          </select>
          <label className="a2-meta" htmlFor="rl-since">
            {t('agentConsole.v2.rl.filterSince')}
          </label>
          <select
            id="rl-since"
            className="a2-input"
            data-testid="agent-v2-rl-filter-since"
            value={sinceKey}
            onChange={(e) => patchParams({ since: e.target.value || null })}
          >
            <option value="">{t('agentConsole.v2.rl.all')}</option>
            {SINCE_KEYS.map((k) => (
              <option key={k} value={k}>
                {t(`agentConsole.v2.rl.since${k}`)}
              </option>
            ))}
          </select>
          <label className="a2-meta" htmlFor="rl-limit">
            {t('agentConsole.v2.rl.filterLimit')}
          </label>
          <select
            id="rl-limit"
            className="a2-input"
            data-testid="agent-v2-rl-filter-limit"
            value={String(pageLimit)}
            onChange={(e) => patchParams({ limit: e.target.value })}
          >
            {[20, 50, 100].map((n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
          </select>
          {/* source filter: DISABLED — upstream has no source parameter */}
          <select className="a2-input" disabled data-testid="agent-v2-rl-filter-source" aria-label={t('agentConsole.v2.rl.filterSource')}>
            <option>{t('agentConsole.v2.rl.filterSource')}</option>
          </select>
        </div>
        <p className="a2-micro" data-testid="agent-v2-rl-source-note">
          {t('agentConsole.v2.rl.sourceFilterNote')}
        </p>
      </div>

      {isAuth ? (
        <div className="a2-card" data-testid="agent-v2-rl-auth">
          <p className="a2-h2">{t('agentConsole.auth.expired')}</p>
        </div>
      ) : isForbidden ? (
        <div className="a2-card" data-testid="agent-v2-rl-403">
          <p className="a2-h2">{t('agentConsole.v2.rl.forbidden')}</p>
          <p className="a2-card-sub">{t('agentConsole.v2.rl.forbiddenHint')}</p>
        </div>
      ) : isNotFound ? (
        <div className="a2-card" data-testid="agent-v2-rl-404">
          <p className="a2-h2">{t('agentConsole.v2.rl.notFound')}</p>
        </div>
      ) : isError ? (
        /* localized copy + HTTP status only — no upstream machine codes (G15) */
        <div className="a2-card" data-testid="agent-v2-rl-error-card">
          <p className="a2-meta" data-testid="agent-v2-rl-error">
            {t('agentConsole.v2.ov.blockUnavailable', {
              block: t('agentConsole.v2.rl.blockList'),
              code: listRes?.status ?? 0,
            })}
          </p>
          <button
            type="button"
            className="a2-btn"
            data-testid="agent-v2-rl-retry"
            onClick={handleRetry}
          >
            {t('agentConsole.v2.ov.retry')}
          </button>
        </div>
      ) : loading && rows.length === 0 ? (
        <div className="a2s-skeleton" data-testid="agent-v2-rl-loading" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <span className="a2s-sk-row" key={i} />
          ))}
        </div>
      ) : !hasFilter ? (
        /* first load, no filters: guidance — a bare /api/runs is NEVER sent */
        <div className="a2-card" data-testid="agent-v2-rl-guidance">
          <p className="a2-card-sub">{t('agentConsole.v2.rl.needFilter')}</p>
        </div>
      ) : mergedRows.length === 0 ? (
        <div className="a2-card" data-testid="agent-v2-rl-empty">
          <p className="a2-h2">{t('agentConsole.v2.rl.empty')}</p>
        </div>
      ) : (
        <>
          <div className="a2-card">
            <div className="a2-table-scroll">
              <table className="a2-table" data-testid="agent-v2-rl-table">
                <thead>
                  <tr data-testid="agent-v2-rl-columns">
                    <th>{t('agentConsole.v2.rl.colRun')}</th>
                    <th>{t('agentConsole.v2.rl.colEmployee')}</th>
                    <th>{t('agentConsole.v2.rl.colStatus')}</th>
                    <th>{t('agentConsole.v2.rl.colDuration')}</th>
                    <th>{t('agentConsole.v2.rl.colCost')}</th>
                    <th>{t('agentConsole.v2.rl.colSource')}</th>
                    <th>{t('agentConsole.v2.rl.colVersion')}</th>
                    <th>{t('agentConsole.v2.rl.colStart')}</th>
                    <th>{t('agentConsole.v2.rl.colEnd')}</th>
                    <th>{t('agentConsole.v2.rl.colAction')}</th>
                  </tr>
                </thead>
                <tbody>
                  {mergedRows.map((r) => {
                    // 来源: conservative labels from key presence ONLY.
                    const sourceLabel = r.channelEventId
                      ? t('agentConsole.v2.rl.sourceChannel')
                      : r.taskId
                        ? t('agentConsole.v2.rl.sourceTask')
                        : r.previousRunId || r.upstreamRunId
                          ? t('agentConsole.v2.rl.sourceUpstream')
                          : t('agentConsole.v2.rl.sourceUnknown');
                    return (
                      <tr key={r.runId} data-run-id={r.runId} data-testid="agent-v2-rl-row">
                        <td className="a2-cell-nowrap">
                          <span className="a2-mono" title={r.runId}>
                            {fmtId(r.runId)}
                          </span>
                          <button
                            type="button"
                            className="a2-btn"
                            data-testid="agent-v2-rl-copy"
                            aria-label={t('agentConsole.v2.emp.copyId')}
                            onClick={() => handleCopyId(r.runId)}
                          >
                            {t('agentConsole.v2.emp.copyId')}
                          </button>
                        </td>
                        <td className="a2-cell-nowrap">{employeeName(r.employeeId)}</td>
                        <td className="a2-cell-nowrap" data-testid="agent-v2-rl-status">
                          {t(`agentConsole.runs.status.${r.status}`, r.status ?? '—')}
                        </td>
                        <td className="a2-cell-nowrap" data-testid="agent-v2-rl-duration">
                          {fmtDuration(r.startedAt, r.endedAt)}
                        </td>
                        <td className="a2-cell-nowrap" data-testid="agent-v2-rl-cost">
                          {fmtCost(r)}
                        </td>
                        <td className="a2-cell-nowrap" data-testid="agent-v2-rl-source">
                          {sourceLabel}
                        </td>
                        <td className="a2-cell-nowrap" data-testid="agent-v2-rl-version">
                          {typeof r.employeeVersionNo === 'number' ? r.employeeVersionNo : '—'}
                        </td>
                        <td className="a2-cell-nowrap">{fmtTime(r.startedAt)}</td>
                        <td className="a2-cell-nowrap">{fmtTime(r.endedAt)}</td>
                        <td className="a2-cell-nowrap">
                          {/* RUN-02 detail page is not built — honest disabled */}
                          <button
                            type="button"
                            className="a2-btn"
                            data-testid="agent-v2-rl-view"
                            disabled
                            title={t('agentConsole.v2.rl.viewDisabledNote')}
                          >
                            {t('agentConsole.v2.rl.view')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* cursor pagination: 加载更多 only, never a total count */}
            <div className="a2-card-head">
              {cursorStale ? (
                <p className="a2-meta" data-testid="agent-v2-rl-cursor-stale" role="status">
                  {t('agentConsole.v2.rl.cursorStale')}
                </p>
              ) : null}
              {moreErrorStatus !== null ? (
                <p className="a2-meta" data-testid="agent-v2-rl-more-error">
                  {t('agentConsole.v2.ov.blockUnavailable', {
                    block: t('agentConsole.v2.rl.blockList'),
                    code: moreErrorStatus,
                  })}
                </p>
              ) : null}
              <button
                type="button"
                className="a2-btn"
                data-testid="agent-v2-rl-load-more"
                onClick={handleLoadMore}
                disabled={!nextCursor || cursorStale || moreLoading}
              >
                {t('agentConsole.v2.runsLoadMore')}
              </button>
              <button
                type="button"
                className="a2-btn"
                data-testid="agent-v2-rl-retry"
                onClick={handleRetry}
              >
                {t('agentConsole.v2.ov.retry')}
              </button>
            </div>
          </div>
          <span aria-live="polite" data-testid="agent-v2-rl-copy-toast">
            {copiedId ? t('agentConsole.v2.rl.copied') : ''}
          </span>
        </>
      )}
    </div>
  );
}
