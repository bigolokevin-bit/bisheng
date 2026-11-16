/* APR-01 approvals pending list (W4 card).
 * Owned by the APR-01 page lane: /agent/approvals queue, count badge (AP8),
 * 待办/已决 tabs, batch selection with DISABLED decide buttons (no AP2
 * wiring this wave), URL state (?status, ?focus, ?cursor, ?limit).
 * Data plane ONLY: AP4 /api/approvals?status=pending&limit=&cursor= and
 * AP8 /api/approval-stats?assignee=&dueWithinSeconds=86400 via the
 * same-origin /agent-api fetch — the dueSoon figure on screen is the SERVER
 * count for exactly 24h, never a client derivation (L6 F-2).
 * Verified live (l4wae-probe, 2026-11-16): AP4 REQUIRES a canonical assignee
 * (400 request.invalid_query without it — this BFF build does not inject it,
 * so the page passes the CURRENT user's own `human:<user_id>` from
 * userContext; other users' assignees are never queried) and it rejects
 * status=history (400 "status is invalid"), so the 已决 tab stays disabled
 * with an explicit honest reason instead of a fake fetch. confirm-type rows
 * never render in the pending queue even if a page carries one.
 * Error copy is localized with the HTTP status as the only interpolation
 * param — machine codes (request.missing_filter, …) never reach the screen.
 * Row ids link to the APR-02 read-only detail (/agent/approvals/:id); the rest
 * of the row stays non-interactive (no batch decide this wave). */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { userContext } from '@/contexts/userContext';
import type { Approval } from '@/controllers/API/agentConsoleApprovals';

import {
  fmtId,
  fmtTime,
  makeFetcher,
  type ApiRes,
  type ApprovalStats,
  type Fetcher,
} from './v2Data';

// AP4 list body — keyset page; nextCursor only when more rows exist
// (shape verified live + against services/domain approvals.list_approvals).
interface ApprovalListBody {
  items: Approval[];
  nextCursor?: string;
}

const PAGE_LIMIT = 20;

// server status snake_case → locale status key camelCase (same vocabulary
// the V1 approvals page uses; kept local so this page owns its glue)
const STATUS_KEYS: Record<string, string> = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  revise_requested: 'reviseRequested',
  expired: 'expired',
  cancelled: 'cancelled',
  consumed: 'consumed',
  superseded: 'superseded',
};

function statusKey(status: string): string {
  return STATUS_KEYS[status] ?? status;
}

// 'history' is a PAGE tab state, not an AP4 status (AP4 rejects it); the
// history view renders an honest disabled note and never fetches.
type TabState = 'pending' | 'history';

function fetchApprovalsPage(
  fetchApi: Fetcher,
  args: { assignee: string; limit: number; cursor?: string }
): Promise<ApiRes<ApprovalListBody>> {
  return fetchApi<ApprovalListBody>('/api/approvals', {
    assignee: args.assignee,
    status: 'pending',
    limit: args.limit,
    cursor: args.cursor,
  });
}

// L6 F-2 fix: AP8 is requested with the contract's dueWithinSeconds=86400 so
// the dueSoon figure on screen is the SERVER's own 24 h count — no client
// estimation anywhere (ACCEPTANCE §2 AP8 ?assignee=&dueWithinSeconds=).
function fetchApprovalStatsDue(
  fetchApi: Fetcher,
  assignee: string
): Promise<ApiRes<ApprovalStats>> {
  return fetchApi<ApprovalStats>('/api/approval-stats', {
    assignee,
    dueWithinSeconds: 86400,
  });
}

// DESIGN-SYSTEM risk tones for the dot+text pill (L6 F-3): one accent per
// level, neutral fallback for unknown enums.
function riskTone(riskLevel: string): string {
  if (riskLevel === 'high') return 'is-danger';
  if (riskLevel === 'medium') return 'is-warn';
  return 'is-accent';
}

/** Fallback derivation when a payload omits remainingSeconds (older rows):
 *  whole seconds from the absolute expiresAt. null → em-dash, never fake. */
function remainingFrom(expiresAt: string | null | undefined, now: number): number | null {
  if (!expiresAt) return null;
  const target = Date.parse(expiresAt);
  if (Number.isNaN(target)) return null;
  return Math.max(0, Math.floor((target - now) / 1000));
}

/** L6 F-1 fix: the contract's items[].remainingSeconds is the AUTHORITATIVE
 *  countdown (deep 03 E24). The 1 s tick only interpolates the label between
 *  fetches; client clock math never decides an expired state. expiresAt is
 *  kept for display (tooltip) only. */
function remainingSecondsOf(r: Approval, receivedAt: number, now: number): number | null {
  if (typeof r.remainingSeconds === 'number' && Number.isFinite(r.remainingSeconds)) {
    const elapsed = Math.max(0, Math.floor((now - receivedAt) / 1000));
    return Math.max(0, r.remainingSeconds - elapsed);
  }
  return remainingFrom(r.expiresAt, now);
}

export function ApprovalsListPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const listUrl = `${location.pathname}${location.search}`;
  const fetchApi: Fetcher = useMemo(() => makeFetcher(), []);
  const ctx = useContext(userContext) as { user?: { user_id?: number | string } } | null;
  const uid = String(ctx?.user?.user_id ?? '');
  const assignee = uid ? `human:${uid}` : '';

  const rawStatus = searchParams.get('status');
  const tab: TabState = rawStatus === 'history' ? 'history' : 'pending';
  const focus = searchParams.get('focus') ?? '';
  const cursor = searchParams.get('cursor') ?? '';
  const rawLimit = Number.parseInt(searchParams.get('limit') ?? '', 10);
  const pageLimit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), 100)
    : PAGE_LIMIT;

  const [reloadToken, setReloadToken] = useState(0);
  const [listRes, setListRes] = useState<ApiRes<ApprovalListBody> | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [statsRes, setStatsRes] = useState<ApiRes<ApprovalStats> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // display tick only: labels interpolate the server's remainingSeconds from
  // the moment the page payload was received (L6 F-1); no client expiry state
  const [now, setNow] = useState(() => Date.now());
  const [listReceivedAt, setListReceivedAt] = useState(() => Date.now());
  const pagesRef = useRef<string[]>(['']);

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

  const handleTab = (next: TabState) => {
    pagesRef.current = [''];
    patchParams({ status: next === 'pending' ? null : next, cursor: null });
  };

  const handleRetry = () => setReloadToken((n) => n + 1);

  // ---- AP4 queue fetch (pending only; the history view never fetches) ----
  useEffect(() => {
    if (tab !== 'pending') return undefined;
    if (!assignee) {
      setListLoading(false);
      return undefined;
    }
    let alive = true;
    setListLoading(true);
    fetchApprovalsPage(fetchApi, { assignee, limit: pageLimit, cursor: cursor || undefined }).then(
      (res) => {
        if (alive) {
          setListRes(res);
          if (res.ok) setListReceivedAt(Date.now());
          setListLoading(false);
        }
      }
    );
    return () => {
      alive = false;
    };
  }, [fetchApi, assignee, tab, cursor, pageLimit, reloadToken]);

  // ---- AP8 count badge (failure hides the badge — never a fake 0) ----
  useEffect(() => {
    if (!assignee) return undefined;
    let alive = true;
    fetchApprovalStatsDue(fetchApi, assignee).then((res) => {
      if (alive) setStatsRes(res);
    });
    return () => {
      alive = false;
    };
  }, [fetchApi, assignee, reloadToken]);

  // selection resets when the queried page/tab/identity changes
  useEffect(() => {
    setSelected(new Set());
  }, [tab, cursor, pageLimit, assignee]);

  // ---- countdown tick only while the pending tab is open ----
  useEffect(() => {
    if (tab !== 'pending') return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [tab]);

  // ---- ?focus sync: scroll + highlight the row named in the URL ----
  useEffect(() => {
    if (!focus || tab !== 'pending') return;
    const el = document.querySelector(`[data-approval-id="${focus}"]`);
    if (el) el.scrollIntoView({ block: 'center' });
  }, [focus, tab, listRes]);

  // Server contract: business_action only — the client filters defensively
  // so a confirm-type row can NEVER render in the pending queue (card §1.2).
  const rows = useMemo(() => {
    if (!listRes?.ok) return [];
    return (listRes.data?.items ?? []).filter((r) => r.type !== 'confirm');
  }, [listRes]);
  const rowIds = useMemo(() => rows.map((r) => r.approvalId), [rows]);
  const allSelected = rows.length > 0 && rowIds.every((id) => selected.has(id));

  const handleToggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) rowIds.forEach((id) => next.delete(id));
      else rowIds.forEach((id) => next.add(id));
      return next;
    });
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

  // ---- top-level states (same idiom as EmployeesListPage) ----
  const noIdentity = !assignee;
  const isAuth =
    listRes && !listRes.ok && (listRes.code === 'console.unauthenticated' || listRes.status === 401);
  const isForbidden =
    listRes && !listRes.ok && (listRes.code === 'console.forbidden' || listRes.status === 403);
  const isError = listRes && !listRes.ok && !isAuth && !isForbidden;
  const countShown = statsRes?.ok ? statsRes.data?.pending ?? null : null;
  const dueSoonShown = statsRes?.ok ? statsRes.data?.dueSoon ?? 0 : 0;

  return (
    <div className="a2s-page" data-testid="agent-v2-approvals-list">
      <div className="a2-card-head">
        <div>
          <h1 className="a2-h1">{t('agentConsole.v2.navApprovals')}</h1>
          <p className="a2-meta">{t('agentConsole.v2.apr.desc')}</p>
        </div>
      </div>

      {/* ---------- tabs: 待办 live, 已决 disabled with honest reason ---------- */}
      <div className="a2-chips" data-testid="agent-v2-approvals-tabs">
        <button
          type="button"
          className={`a2-pill${tab === 'pending' ? ' active' : ''}`}
          data-testid="agent-v2-approvals-tab-pending"
          aria-pressed={tab === 'pending'}
          onClick={() => handleTab('pending')}
        >
          {t('agentConsole.v2.apr.tabPending')}
          {countShown !== null && (
            <span data-testid="agent-v2-approvals-count" style={{ marginLeft: 6 }}>
              {countShown}
            </span>
          )}
        </button>
        <button
          type="button"
          className="a2-pill"
          data-testid="agent-v2-approvals-tab-history"
          aria-pressed={tab === 'history'}
          disabled
          title={t('agentConsole.v2.apr.historyDisabledNote')}
        >
          {t('agentConsole.v2.apr.tabHistory')}
        </button>
      </div>
      <p className="a2-micro" data-testid="agent-v2-approvals-history-note">
        {t('agentConsole.v2.apr.historyDisabledNote')}
      </p>

      {tab === 'history' ? (
        /* Deep link ?status=history: explicit honest state; the queue
           endpoint cannot serve decided items (verified 400), so nothing
           is fetched and nothing is faked. Back/refresh-safe via URL. */
        <div className="a2-card" data-testid="agent-v2-approvals-history">
          <p className="a2-h2">{t('agentConsole.v2.apr.tabHistory')}</p>
          <p className="a2-card-sub" data-testid="agent-v2-approvals-history-reason">
            {t('agentConsole.v2.apr.historyDisabledNote')}
          </p>
          <button
            type="button"
            className="a2-btn"
            data-testid="agent-v2-approvals-back-pending"
            onClick={() => handleTab('pending')}
          >
            {t('agentConsole.v2.apr.tabPending')}
          </button>
        </div>
      ) : noIdentity ? (
        <div className="a2-card" data-testid="agent-v2-approvals-no-identity">
          <p className="a2-h2">{t('agentConsole.approvals.identityUnavailable')}</p>
          <p className="a2-card-sub">{t('agentConsole.approvals.identityUnavailableHint')}</p>
        </div>
      ) : isAuth ? (
        <div className="a2-card" data-testid="agent-v2-approvals-auth">
          <p className="a2-h2">{t('agentConsole.auth.expired')}</p>
        </div>
      ) : isForbidden ? (
        /* non-admin deep link → explicit 403 state, never a blank page */
        <div className="a2-card" data-testid="agent-v2-approvals-403">
          <p className="a2-h2">{t('agentConsole.v2.apr.forbidden')}</p>
          <p className="a2-card-sub">{t('agentConsole.v2.apr.forbiddenHint')}</p>
        </div>
      ) : isError ? (
        <div className="a2-card" data-testid="agent-v2-approvals-error">
          <p className="a2-meta" data-testid="agent-v2-approvals-queue-error">
            {t('agentConsole.v2.ov.blockUnavailable', {
              block: t('agentConsole.v2.apr.blockQueue'),
              code: listRes?.status ?? 0,
            })}
          </p>
          <button
            type="button"
            className="a2-btn"
            data-testid="agent-v2-approvals-retry-queue"
            onClick={handleRetry}
          >
            {t('agentConsole.v2.ov.retry')}
          </button>
        </div>
      ) : listLoading && !listRes ? (
        <div className="a2s-skeleton" data-testid="agent-v2-approvals-loading" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <span className="a2s-sk-row" key={i} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="a2-card" data-testid="agent-v2-approvals-empty">
          <p className="a2-h2">{t('agentConsole.v2.emptyApprovals')}</p>
          <p className="a2-card-sub">{t('agentConsole.approvals.emptyHint')}</p>
        </div>
      ) : (
        <>
          {/* ---------- batch toolbar: selection works, decide DISABLED ---------- */}
          <div className="a2-card" data-testid="agent-v2-approvals-batch">
            <div className="a2-card-head">
              <span className="a2-meta" data-testid="agent-v2-approvals-selected-count">
                {t('agentConsole.v2.apr.selectedCount', { count: selected.size })}
              </span>
              <div className="a2-card-actions">
                <button
                  type="button"
                  className="a2-btn"
                  data-testid="agent-v2-approvals-decide-approve"
                  disabled
                  title={t('agentConsole.v2.apr.batchNote')}
                >
                  {t('agentConsole.approvals.verdict.approve')}
                </button>
                <button
                  type="button"
                  className="a2-btn"
                  data-testid="agent-v2-approvals-decide-reject"
                  disabled
                  title={t('agentConsole.v2.apr.batchNote')}
                >
                  {t('agentConsole.approvals.verdict.reject')}
                </button>
              </div>
            </div>
            <p className="a2-micro" data-testid="agent-v2-approvals-batch-note">
              {t('agentConsole.v2.apr.batchNote')}
            </p>
          </div>

          {/* ---------- queue table (id links to APR-02 detail) ---------- */}
          <div className="a2-card">
            <div className="a2-table-scroll">
              <table className="a2-table" data-testid="agent-v2-approvals-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        className="a2-check"
                        data-testid="agent-v2-approvals-select-all"
                        checked={allSelected}
                        aria-label={t('agentConsole.v2.apr.selectAll')}
                        onChange={handleToggleAll}
                      />
                    </th>
                    <th className="r">{t('agentConsole.approvals.colId')}</th>
                    <th>{t('agentConsole.approvals.colAction')}</th>
                    <th className="r">{t('agentConsole.v2.apr.colEmployee')}</th>
                    <th>{t('agentConsole.approvals.colRisk')}</th>
                    <th className="r">{t('agentConsole.approvals.createdAt')}</th>
                    <th className="r">{t('agentConsole.v2.apr.colDue')}</th>
                    <th>{t('agentConsole.approvals.colStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const remaining = remainingSecondsOf(r, listReceivedAt, now);
                    const isFocus = focus !== '' && r.approvalId === focus;
                    const employee = r.onBehalfOf ?? r.requestedBy;
                    return (
                      <tr
                        key={r.approvalId}
                        data-testid="agent-v2-approval-row"
                        data-approval-id={r.approvalId}
                        data-focus={isFocus ? 'true' : undefined}
                        style={
                          isFocus
                            ? {
                                background: 'var(--accent-soft, rgba(76, 110, 245, 0.12))',
                                boxShadow: 'inset 3px 0 0 hsl(var(--accent, 227 72% 56%))',
                              }
                            : undefined
                        }
                      >
                        <td>
                          <input
                            type="checkbox"
                            className="a2-check"
                            data-testid="agent-v2-approval-check"
                            checked={selected.has(r.approvalId)}
                            aria-label={r.approvalId}
                            onChange={() => handleToggle(r.approvalId)}
                          />
                        </td>
                        <td className="a2-mono a2-cell-nowrap r" title={r.approvalId}>
                          {/* APR-02: the id opens the read-only detail; the list URL
                              (filters/cursor) stays in history so 「返回」 restores it. */}
                          <NavLink
                            className="a2d-link"
                            to={`/agent/approvals/${r.approvalId}`}
                            state={{ from: listUrl }}
                            data-testid="agent-v2-approval-detail-link"
                          >
                            {fmtId(r.approvalId)}
                          </NavLink>
                        </td>
                        <td>
                          {r.action}
                          <span className="a2-micro">
                            {' · '}
                            {r.binding?.changeKind ?? '—'}
                          </span>
                        </td>
                        <td className="a2-cell-nowrap r" title={employee?.id}>
                          {employee?.id ?? '—'}
                        </td>
                        <td className="a2-cell-nowrap" data-testid="agent-v2-approval-risk">
                          <span className={`a2-pill ${riskTone(r.riskLevel)}`}>
                            <span className="a2-pill-dot" aria-hidden />
                            {t(`agentConsole.approvals.risk.${r.riskLevel}`, r.riskLevel)}
                          </span>
                        </td>
                        <td className="a2-mono a2-cell-nowrap r">{fmtTime(r.createdAt)}</td>
                        <td
                          className="a2-mono a2-cell-nowrap r"
                          data-testid="agent-v2-approval-countdown"
                          title={r.expiresAt ? fmtTime(r.expiresAt) : undefined}
                        >
                          {remaining === null
                            ? '—'
                            : t('agentConsole.approvals.remaining', { seconds: remaining })}
                        </td>
                        <td className="a2-cell-nowrap">
                          {t(`agentConsole.approvals.status.${statusKey(r.status)}`, r.status)}
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
                data-testid="agent-v2-approvals-prev-page"
                onClick={handlePrevPage}
                disabled={pagesRef.current.length <= 1}
              >
                {t('agentConsole.v2.apr.prevPage')}
              </button>
              <span className="a2-meta" data-testid="agent-v2-approvals-page-info">
                {t('agentConsole.v2.apr.pageInfo', { page: pagesRef.current.length, count: rows.length })}
              </span>
              <span className="a2-micro" data-testid="agent-v2-approvals-due-soon">
                {dueSoonShown > 0 ? t('agentConsole.v2.ov.noteDueSoon', { count: dueSoonShown }) : ''}
              </span>
              <button
                type="button"
                className="a2-btn"
                data-testid="agent-v2-approvals-next-page"
                onClick={handleNextPage}
                disabled={!listRes?.data?.nextCursor}
              >
                {t('agentConsole.v2.apr.nextPage')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
