/**
 * EMP-01 employee list, rebuilt for the S3 console PRD v0.3.
 *
 * Only the six columns the PRD names: name, short code, role, skill count,
 * today's runs and budget. Every value is traceable to a service response —
 * a missing value renders '—', never a zero, never a fabricated curve. The
 * page is read-only apart from the create entry and the row-level chat link.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { ReqId } from './listkit/ReqId';
import { HelpTip } from './HelpTip';
import { avatarChar, duplicateNames, employeeDisplayName } from './identity';
import {
  budgetView,
  employeeShortCode,
  fmtMoney,
  isUnassignedOwner,
  ownerSlotLabel,
  parseStatusKey,
  rowSkillCount,
  todayBeijingWindow,
  type StatusKey,
} from './employeesShared';
import {
  bucketSum,
  fetchEmployeesPage,
  fetchRunStats,
  makeFetcher,
  mapLimit,
  type ApiRes,
  type EmployeeListBody,
  type EmployeeRow,
} from './v2Data';

import './employeesList.css';

const EXPAND = 'version,workstations,knowledge,pending';
const PAGE_LIMIT = 20;
const RUN_CAP = 4;

type RowRuns =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ok'; total: number; ok: number; fail: number };

const LIFECYCLE_KEYS = new Set([
  'draft',
  'onboarding',
  'active',
  'paused',
  'offboarding',
  'suspended',
  'archived',
]);

function lifecycleKey(state: string): string {
  return LIFECYCLE_KEYS.has(state) ? `agentConsole.lifecycle.${state}` : 'agentConsole.v2.id.none';
}

function isAuthFailure(res: ApiRes<unknown>): boolean {
  return res.status === 401 || res.code === 'console.unauthenticated';
}

function isForbidden(res: ApiRes<unknown>): boolean {
  return res.status === 403 || res.code === 'console.forbidden';
}

export function EmployeesListPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const fetchApi = useMemo(() => makeFetcher(), []);

  const rawStatus = params.get('lifecycleState');
  const status: StatusKey = parseStatusKey(rawStatus === 'all' ? 'all' : rawStatus);
  const keyword = params.get('keyword') ?? '';

  const [draft, setDraft] = useState(keyword);
  const [items, setItems] = useState<EmployeeRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [result, setResult] = useState<ApiRes<EmployeeListBody> | null>(null);
  const [nonce, setNonce] = useState(0);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState<ApiRes<EmployeeListBody> | null>(null);
  const [runs, setRuns] = useState<Record<string, RowRuns>>({});

  const genRef = useRef(0);
  const requestedRuns = useRef<Set<string>>(new Set());
  const dups = useMemo(
    () => duplicateNames(items.map((row) => ({ id: row.employeeId, name: row.name }))),
    [items]
  );

  // Keyword commits after a short pause; the URL stays the single source of
  // truth so going to a detail page and back keeps the filter.
  useEffect(() => {
    const trimmed = draft.trim();
    if (trimmed === keyword) return undefined;
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(params);
      if (trimmed) next.set('keyword', trimmed);
      else next.delete('keyword');
      setParams(next, { replace: true });
    }, 300);
    return () => window.clearTimeout(timer);
    // params is intentionally read at commit time only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, keyword]);

  useEffect(() => {
    const gen = genRef.current + 1;
    genRef.current = gen;
    setResult(null);
    setMoreError(null);
    void fetchEmployeesPage(fetchApi, {
      keyword: keyword || undefined,
      lifecycleState: status === 'all' ? undefined : status,
      limit: PAGE_LIMIT,
      expand: EXPAND,
    }).then((res) => {
      if (genRef.current !== gen) return;
      setResult(res);
      if (res.ok) {
        setItems(res.data?.items ?? []);
        setNextCursor(res.data?.nextCursor ?? null);
      } else {
        setItems([]);
        setNextCursor(null);
      }
    });
  }, [fetchApi, keyword, status, nonce]);

  // Today's runs per visible row: the list response has no run counter, so the
  // page reads the same 7-day stats endpoint the matrix uses, capped at four
  // rows in flight and cached per employee for the session.
  useEffect(() => {
    const pending = items.filter((row) => !requestedRuns.current.has(row.employeeId));
    if (pending.length === 0) return undefined;
    let cancelled = false;
    pending.forEach((row) => requestedRuns.current.add(row.employeeId));
    setRuns((prev) => {
      const next = { ...prev };
      pending.forEach((row) => {
        next[row.employeeId] = { state: 'loading' };
      });
      return next;
    });
    const win = todayBeijingWindow();
    void mapLimit(pending, RUN_CAP, async (row) => {
      const res = await fetchRunStats(fetchApi, {
        from: win.from,
        to: win.to,
        bucket: 'day',
        employeeId: row.employeeId,
      });
      if (cancelled) return;
      if (!res.ok) {
        setRuns((prev) => ({ ...prev, [row.employeeId]: { state: 'failed' } }));
        return;
      }
      const sum = bucketSum(res.data?.buckets);
      setRuns((prev) => ({
        ...prev,
        [row.employeeId]: { state: 'ok', total: sum.runs, ok: sum.succeeded, fail: sum.failed },
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [items, fetchApi]);

  const patchStatus = (next: StatusKey) => {
    const search = new URLSearchParams(params);
    if (next === 'active') search.delete('lifecycleState');
    else search.set('lifecycleState', next);
    setParams(search, { replace: true });
  };

  const clearFilters = () => {
    setDraft('');
    const search = new URLSearchParams(params);
    search.delete('keyword');
    search.delete('lifecycleState');
    setParams(search, { replace: true });
  };

  const loadMore = async () => {
    if (!nextCursor || moreLoading) return;
    const gen = genRef.current;
    setMoreLoading(true);
    setMoreError(null);
    const res = await fetchEmployeesPage(fetchApi, {
      keyword: keyword || undefined,
      lifecycleState: status === 'all' ? undefined : status,
      limit: PAGE_LIMIT,
      cursor: nextCursor,
      expand: EXPAND,
    });
    if (genRef.current !== gen) {
      setMoreLoading(false);
      return;
    }
    if (!res.ok) {
      setMoreError(res);
      setMoreLoading(false);
      return;
    }
    setItems((prev) => [...prev, ...(res.data?.items ?? [])]);
    setNextCursor(res.data?.nextCursor ?? null);
    setMoreLoading(false);
  };

  const statusLabel = (key: StatusKey): string => {
    if (key === 'all') return t('agentConsole.v2.emp.filterAll');
    return t(key === 'active' ? 'agentConsole.lifecycle.active' : 'agentConsole.lifecycle.paused');
  };

  const filtered = keyword !== '' || status !== 'active';
  const showSkeleton = result === null;
  const listError = result !== null && !result.ok ? result : null;
  const filterSummary = [
    keyword ? `「${keyword}」` : '',
    status !== 'active' ? statusLabel(status) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const runsCell = (row: EmployeeRow) => {
    const stat = runs[row.employeeId];
    if (!stat || stat.state === 'loading') {
      return (
        <span className="emp-muted" aria-busy="true" data-testid={`agent-v2-emp-runs-${row.employeeId}`}>
          —
        </span>
      );
    }
    if (stat.state === 'failed') {
      return (
        <span
          className="emp-muted"
          title={t('agentConsole.v2.ov.blockUnavailable', { block: t('agentConsole.v2.navEmployees'), code: moreError.status })}
          data-testid={`agent-v2-emp-runs-${row.employeeId}`}
        >
          —
        </span>
      );
    }
    return (
      <span data-testid={`agent-v2-emp-runs-${row.employeeId}`}>
        {t('agentConsole.v2.mtx.runsDetail', { total: stat.total, ok: stat.ok, fail: stat.fail })}
      </span>
    );
  };

  const budgetCell = (row: EmployeeRow) => {
    const view = budgetView(row.enrichment?.effectiveBudget);
    if (view.kind === 'missing') {
      return <span className="emp-muted" data-testid={`agent-v2-emp-budget-${row.employeeId}`}>—</span>;
    }
    if (view.kind === 'unset') {
      return (
        <span className="emp-muted" data-testid={`agent-v2-emp-budget-${row.employeeId}`}>
          {t('agentConsole.v2.mtx.budgetUnset')}
        </span>
      );
    }
    return (
      <span className="emp-mono" data-testid={`agent-v2-emp-budget-${row.employeeId}`}>
        {fmtMoney(view.monthlyUsd)}
      </span>
    );
  };

  return (
    <div className="a2s-page" data-testid="agent-v2-employees-page">
      <header className="emp-head">
        <div>
          <h1 className="a2-h1">{t('agentConsole.v2.navEmployees')}</h1>
          <p className="a2-meta">{t('agentConsole.v2.mtx.desc')}</p>
        </div>
        <Link className="a2-btn is-primary" to="/agent/employees/new" data-testid="agent-v2-employees-create">
          {t('agentConsole.v2.emp.createEntry')}
        </Link>
      </header>

      <div className="a2-card emp-toolbar">
        <div className="emp-tabs" role="group" aria-label={t('agentConsole.v2.colStatus')}>
          {(['active', 'paused', 'all'] as StatusKey[]).map((key) => (
            <button
              key={key}
              type="button"
              className={['a2-btn', 'emp-tab', status === key ? 'is-on' : ''].join(' ').trim()}
              aria-pressed={status === key}
              onClick={() => patchStatus(key)}
              data-testid={`agent-v2-emp-status-${key}`}
            >
              {statusLabel(key)}
            </button>
          ))}
        </div>
        <div className="emp-search">
          <input
            className="a2-search"
            type="search"
            value={draft}
            placeholder={t('agentConsole.v2.search')}
            aria-label={t('agentConsole.v2.search')}
            onChange={(event) => setDraft(event.target.value)}
            data-testid="agent-v2-emp-search"
          />
          {filtered ? (
            <button
              type="button"
              className="a2-btn"
              onClick={clearFilters}
              data-testid="agent-v2-emp-clear"
            >
              {t('agentConsole.v2.emp01.clearFilters')}
            </button>
          ) : null}
        </div>
      </div>

      {showSkeleton ? (
        <div className="a2-card a2s-skeleton" data-testid="agent-v2-employees-loading">
          {Array.from({ length: 6 }).map((_, index) => (
            <div className="a2s-sk-row" key={index} />
          ))}
        </div>
      ) : null}

      {listError ? (
        isAuthFailure(listError) ? (
          <div className="a2-card emp-state" data-testid="agent-v2-employees-auth">
            <h2 className="a2-h2">{t('agentConsole.v2.emp.authExpired')}</h2>
            <p className="a2-meta">{t('agentConsole.v2.emp.authHint')}</p>
          </div>
        ) : isForbidden(listError) ? (
          <div className="a2-card emp-state" data-testid="agent-v2-employees-403">
            <h2 className="a2-h2">{t('agentConsole.v2.emp.noPermission')}</h2>
            <p className="a2-meta">{t('agentConsole.v2.emp.forbiddenHint')}</p>
            <ReqId requestId={listError.requestId} testId="agent-v2-employees-403-rid" />
          </div>
        ) : (
          <div className="a2-card emp-state" data-testid="agent-v2-employees-error">
            <h2 className="a2-h2">{t('agentConsole.v2.ed.readFailedTitle')}</h2>
            <p className="a2-meta">
              {listError.status === 0
                ? t('agentConsole.v2.ed.readFailedDesc')
                : t('agentConsole.v2.ov.blockUnavailable', {
                    block: t('agentConsole.v2.navEmployees'),
                    code: listError.status,
                  })}
            </p>
            <ReqId requestId={listError.requestId} testId="agent-v2-employees-error-rid" />
            <button
              type="button"
              className="a2-btn"
              onClick={() => setNonce((value) => value + 1)}
              data-testid="agent-v2-employees-retry"
            >
              {t('agentConsole.v2.mtx.retry')}
            </button>
          </div>
        )
      ) : null}

      {result?.ok && items.length === 0 ? (
        filtered ? (
          <div className="a2-card emp-state" data-testid="agent-v2-employees-nomatch">
            <h2 className="a2-h2">{t('agentConsole.v2.emp01.noMatch')}</h2>
            <p className="a2-meta">{t('agentConsole.v2.tsk.filterSummary', { filters: filterSummary })}</p>
            <button type="button" className="a2-btn" onClick={clearFilters} data-testid="agent-v2-emp-nomatch-clear">
              {t('agentConsole.v2.emp01.clearFilters')}
            </button>
          </div>
        ) : (
          <div className="a2-card emp-state" data-testid="agent-v2-employees-empty">
            <h2 className="a2-h2">{t('agentConsole.v2.emp.emptyEmployees')}</h2>
            <Link className="a2-btn" to="/agent/employees/new">
              {t('agentConsole.v2.emp.createEntry')}
            </Link>
          </div>
        )
      ) : null}

      {result?.ok && items.length > 0 ? (
        <div className="a2-card emp-table-card">
          <div className="emp-table" role="table" data-testid="agent-v2-emp-table">
            <div className="emp-tr emp-th" role="row">
              <span role="columnheader">{t('agentConsole.v2.colName')}</span>
              <span role="columnheader">{t('agentConsole.v2.emp01.shortCode')}</span>
              <span role="columnheader">{t('agentConsole.v2.ed.fieldRole')}</span>
              <span role="columnheader">{t('agentConsole.v2.mtx.skills')}</span>
              <span role="columnheader">{t('agentConsole.v2.mtx.runs')}</span>
              <span role="columnheader">{t('agentConsole.v2.mtx.budgetMonthly')}</span>
              <span role="columnheader">{t('agentConsole.v2.colAction')}</span>
            </div>
            {items.map((row) => {
              const short = employeeShortCode(row.employeeId);
              const owner = ownerSlotLabel(row.ownerUserId, t);
              const char = avatarChar(row.name);
              return (
                <div className="emp-tr" role="row" key={row.employeeId} data-testid={`agent-v2-emp-row-${row.employeeId}`}>
                  <span className="emp-name-cell" role="cell" data-label={t('agentConsole.v2.colName')}>
                    {char ? <span className="emp-avatar" aria-hidden="true">{char}</span> : null}
                    <span className="emp-name-lines">
                      <Link
                        className="emp-name-link"
                        to={`/agent/employees/${encodeURIComponent(row.employeeId)}`}
                        data-testid={`agent-v2-emp-name-${row.employeeId}`}
                      >
                        {employeeDisplayName({ id: row.employeeId, name: row.name }, dups, t)}
                      </Link>
                      <span className={`a2-pill emp-pill is-${row.lifecycleState}`}>
                        {t(lifecycleKey(row.lifecycleState))}
                      </span>
                    </span>
                  </span>
                  <span className="emp-mono" role="cell" data-label={t('agentConsole.v2.emp01.shortCode')} data-testid={`agent-v2-emp-code-${row.employeeId}`} title={row.employeeId}>
                    {short ? t('agentConsole.v2.id.employeeRef', { tail: short }) : '—'}
                  </span>
                  <span role="cell" data-label={t('agentConsole.v2.ed.fieldRole')}>
                    <span className="emp-role">{row.title || '—'}</span>
                    <span className="emp-sub" data-testid={`agent-v2-emp-owner-${row.employeeId}`}>
                      {t('agentConsole.v2.ed.bannerOwner')}：{owner}
                      {!isUnassignedOwner(row.ownerUserId) ? (
                        <HelpTip term="humanPrefix" testId={`agent-v2-emp-help-owner-${row.employeeId}`} />
                      ) : null}
                    </span>
                  </span>
                  <span role="cell" data-label={t('agentConsole.v2.mtx.skills')} data-testid={`agent-v2-emp-skills-${row.employeeId}`}>
                    {rowSkillCount(row) ?? '—'}
                  </span>
                  <span role="cell" data-label={t('agentConsole.v2.mtx.runs')}>{runsCell(row)}</span>
                  <span role="cell" data-label={t('agentConsole.v2.mtx.budgetMonthly')}>{budgetCell(row)}</span>
                  <span role="cell" data-label={t('agentConsole.v2.colAction')}>
                    <Link
                      className="a2-btn emp-row-action"
                      to={`/agent/chat?employeeId=${encodeURIComponent(row.employeeId)}`}
                      data-testid={`agent-v2-emp-chat-${row.employeeId}`}
                    >
                      {t('chat.dialogue')}
                    </Link>
                  </span>
                </div>
              );
            })}
          </div>
          <footer className="emp-foot">
            <span className="a2-meta" data-testid="agent-v2-emp-loaded">
              {t('agentConsole.v2.mtx.loaded', { count: items.length })}
            </span>
            {moreError ? (
              <span className="emp-more-error" role="alert">
                <span className="a2-meta">
                  {moreError.status === 0
                    ? t('agentConsole.v2.ed.readFailedDesc')
                    : t('agentConsole.v2.ov.blockUnavailable', {
                        block: t('agentConsole.v2.navEmployees'),
                        code: moreError.status,
                      })}
                </span>
                <ReqId requestId={moreError.requestId} />
                <button type="button" className="a2-btn" onClick={loadMore} data-testid="agent-v2-emp-next-retry">
                  {t('agentConsole.v2.mtx.retry')}
                </button>
              </span>
            ) : null}
            {nextCursor ? (
              <button
                type="button"
                className="a2-btn"
                disabled={moreLoading}
                onClick={loadMore}
                data-testid="agent-v2-emp-next"
              >
                {moreLoading ? t('agentConsole.v2.loading') : t('agentConsole.v2.emp.nextPage')}
              </button>
            ) : null}
          </footer>
        </div>
      ) : null}
    </div>
  );
}