/* eslint-disable no-restricted-syntax -- read-only matrix page, no write entry points by design */
/**
 * MATRIX-01 — read-only employee matrix (/agent/matrix).
 *
 * One screen for every real employee: position version / lifecycle / skill
 * count / budget / today's runs / risk. Clicking a person navigates to the
 * existing detail page (/agent/employees/:id). Data source: BFF
 * GET /agent-api/api/matrix (upstream /v1/matrix/employees). The upstream is
 * not deployed yet — the page renders loading / error / empty / normal and
 * never fabricates rows (L0 card 2026-11-17: 缺接口就四态，不造假数据).
 *
 * Zero engineering language on screen: HTTP status only ever appears as an
 * interpolation argument inside a human sentence (same G15 stance as APR-01);
 * no field names, no error codes, no UTC stamps (fmtTime is Asia/Shanghai).
 * Money goes through fmtUsd only — never CNY glyphs.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from './OverviewBlocks';
import { ReqId } from './listkit/ReqId';
import { avatarChar } from './identity';
import { makeFetcher, fmtUsd, type ApiRes, type Fetcher } from './v2Data';
import {
  LIFECYCLE_KEY,
  LIFECYCLE_TONE,
  normalizeRow,
  riskSignalCount,
  versionShort,
  type MatrixEmployeeRow,
  type MatrixListBody,
} from './matrix';

export default function MatrixPage() {
  const { t } = useTranslation();
  const fetchApi: Fetcher = useMemo(() => makeFetcher(), []);
  const [res, setRes] = useState<ApiRes<MatrixListBody> | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [q, setQ] = useState('');
  const [lcFilter, setLcFilter] = useState('');
  const [sortBy, setSortBy] = useState<'default' | 'name' | 'lifecycle'>('default');

  /* Deep link ?focus=<employeeId>: mark and bring the matching card into view.
   * The URL is never rewritten and an unknown/malformed value just matches
   * nothing — it must never turn into an error screen (MATRIX-R3 ⑤). */
  const focusId = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return (new URLSearchParams(window.location.search).get('focus') ?? '').trim();
  }, []);

  useEffect(() => {
    if (!focusId) return;
    const el = document.querySelector<HTMLElement>(
      '[data-testid="agent-v2-mtx-row"][data-focus="true"]',
    );
    el?.scrollIntoView?.({ block: 'center' });
    el?.focus?.({ preventScroll: true });
  }, [focusId, nonce]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const params: Record<string, unknown> = { limit: 50 };
    const stateParam =
      typeof window === 'undefined'
        ? ''
        : (new URLSearchParams(window.location.search).get('state') ?? '').trim();
    if (stateParam) params.state = stateParam;
    fetchApi<MatrixListBody>('/api/matrix', params).then((r) => {
      if (!alive) return;
      setRes(r);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [fetchApi, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  const rows: MatrixEmployeeRow[] =
    res && res.ok && Array.isArray(res.data?.items)
      ? (res.data!.items as unknown[]).map(normalizeRow).filter((r) => r.employeeId !== '')
      : [];

  const isTimeout = res != null && !res.ok && res.status === 0 && res.code === 'console.timeout';
  const isQueryError = res != null && !res.ok && res.status === 401;
  const isForbidden =
    res != null && !res.ok && (res.status === 403 || res.code === 'console.forbidden');

  /* Same-name cards carry a short code so two people never look identical.
     Declared before the early returns: a hook after them changes the call
     order between renders and crashes the page (React invalid hook call). */
  const nameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = (row.name ?? '').trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [rows]);

  /* ---- loading ---- */
  if (loading) {
    return (
      <div className="a2s-page" data-testid="agent-v2-mtx-page">
        <h1 className="a2-h1">{t('agentConsole.v2.mtx.title')}</h1>
        <p className="a2-meta">{t('agentConsole.v2.mtx.desc')}</p>
        <div className="a2s-skeleton" data-testid="agent-v2-mtx-loading" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <span className="a2s-sk-row" key={i} />
          ))}
        </div>
      </div>
    );
  }

  /* ---- forbidden: whole-page replacement, no matrix data at all (STATE-03) ---- */
  if (isForbidden) {
    return (
      <div className="a2s-page" data-testid="agent-v2-mtx-page">
        <div className="a2-card" data-testid="agent-v2-mtx-forbidden">
          <p className="a2-h2">
            <Icon name="alert" size={16} />
            {t('agentConsole.v2.mtx.forbiddenTitle')}
          </p>
          <p className="a2-card-sub">{t('agentConsole.v2.mtx.forbiddenHint')}</p>
          <span style={{ display: 'block' }}>
            <ReqId requestId={res?.requestId} testId="agent-v2-mtx-forbidden-reqid" />
          </span>
          <p style={{ marginTop: 12 }}>
            <NavLink className="a2-link" to="/agent" data-testid="agent-v2-mtx-forbidden-back">
              {t('agentConsole.v2.mtx.forbiddenBack')}
            </NavLink>
          </p>
        </div>
      </div>
    );
  }

  /* ---- unauthorized (session expired) ---- */
  if (isQueryError) {
    return (
      <div className="a2s-page" data-testid="agent-v2-mtx-page">
        <div className="a2-card" data-testid="agent-v2-mtx-error">
          <p className="a2-h2">
            <Icon name="alert" size={16} />
            {t('agentConsole.auth.expired')}
          </p>
          <p className="a2-card-sub">{t('agentConsole.v2.mtx.errKeep')}</p>
          <span style={{ display: 'block' }}>
            <ReqId requestId={res?.requestId} testId="agent-v2-mtx-error-reqid" />
          </span>
          <button type="button" className="a2-btn" data-testid="agent-v2-mtx-retry" onClick={retry}>
            {t('agentConsole.v2.retry')}
          </button>
        </div>
      </div>
    );
  }

  /* ---- request failed (degraded, honest) ---- */
  if (res != null && !res.ok) {
    const code = res.status ?? 0;
    return (
      <div className="a2s-page" data-testid="agent-v2-mtx-page">
        <h1 className="a2-h1">{t('agentConsole.v2.mtx.title')}</h1>
        <p className="a2-meta">{t('agentConsole.v2.mtx.desc')}</p>
        <div className="a2-card" data-testid="agent-v2-mtx-error">
          <p className="a2-h2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="alert" size={16} />
            {isTimeout ? t('agentConsole.v2.mtx.errTimeout') : t('agentConsole.v2.mtx.errHttp', { code })}
          </p>
          <p className="a2-card-sub">{t('agentConsole.v2.mtx.errKeep')}</p>
          <span style={{ display: 'block' }}>
            <ReqId requestId={res.requestId} testId="agent-v2-mtx-error-reqid" />
          </span>
          <button type="button" className="a2-btn" data-testid="agent-v2-mtx-retry" onClick={retry}>
            {t('agentConsole.v2.retry')}
          </button>
        </div>
      </div>
    );
  }

  /* ---- empty ---- */
  if (rows.length === 0) {
    return (
      <div className="a2s-page" data-testid="agent-v2-mtx-page">
        <h1 className="a2-h1">{t('agentConsole.v2.mtx.title')}</h1>
        <p className="a2-meta">{t('agentConsole.v2.mtx.desc')}</p>
        <div className="a2-card" data-testid="agent-v2-mtx-empty">
          <p className="a2-h2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="inbox" size={16} />
            {t('agentConsole.v2.mtx.emptyTitle')}
          </p>
          <p className="a2-card-sub">{t('agentConsole.v2.mtx.emptyHint')}</p>
        </div>
      </div>
    );
  }

  /* ---- normal ---- */
  return (
    <div className="a2s-page" data-testid="agent-v2-mtx-page">
      <h1 className="a2-h1">{t('agentConsole.v2.mtx.title')}</h1>
      <p className="a2-meta">{t('agentConsole.v2.mtx.desc')}</p>
      <p className="a2-meta" data-testid="agent-v2-mtx-count">
        {t('agentConsole.v2.mtx.loaded', { count: rows.length })}
      </p>
      <div className="a2-fbar" data-testid="agent-v2-mtx-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <input
          className="a2-input"
          type="search"
          data-testid="agent-v2-mtx-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('agentConsole.v2.mtx.searchPh')}
          aria-label={t('agentConsole.v2.mtx.searchPh')}
        />
        <select
          className="a2-input"
          data-testid="agent-v2-mtx-lc"
          value={lcFilter}
          onChange={(e) => setLcFilter(e.target.value)}
          aria-label={t('agentConsole.v2.mtx.lcAll')}
        >
          <option value="">{t('agentConsole.v2.mtx.lcAll')}</option>
          {Object.entries(LIFECYCLE_KEY).map(([value, key]) => (
            <option value={value} key={value}>
              {t(key)}
            </option>
          ))}
        </select>
        <select
          className="a2-input"
          data-testid="agent-v2-mtx-sort"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'default' | 'name' | 'lifecycle')}
          aria-label={t('agentConsole.v2.mtx.sortBy')}
        >
          <option value="default">{t('agentConsole.v2.mtx.sortDefault')}</option>
          <option value="name">{t('agentConsole.v2.mtx.sortName')}</option>
          <option value="lifecycle">{t('agentConsole.v2.mtx.sortLifecycle')}</option>
        </select>
      </div>
      <p className="a2-meta" data-testid="agent-v2-mtx-summary">
        {t('agentConsole.v2.mtx.sumTotal', { n: rows.length })} ·{' '}
        {t('agentConsole.v2.mtx.sumActive', {
          n: rows.filter((r) => (r.lifecycle ?? '').toLowerCase() === 'active').length,
        })}{' '}
        · {t('agentConsole.v2.mtx.sumRisk', { n: rows.filter((r) => riskSignalCount(r.risk) > 0).length })} ·{' '}
        {t('agentConsole.v2.mtx.sumUnset', { n: rows.filter((r) => r.budget == null).length })} ·{' '}
        <span data-testid="agent-v2-mtx-sum-skills">
          {t('agentConsole.v2.mtx.sumSkills', {
            n: rows.some((r) => typeof r.skillCount === 'number')
              ? String(
                  rows.reduce(
                    (s, r) => s + (typeof r.skillCount === 'number' ? r.skillCount : 0),
                    0,
                  ),
                )
              : '—',
          })}
        </span>{' '}
        ·{' '}
        <span data-testid="agent-v2-mtx-sum-runs">
          {t('agentConsole.v2.mtx.sumRuns', {
            n: rows.some((r) => typeof r.todayRuns?.total === 'number')
              ? String(
                  rows.reduce(
                    (s, r) =>
                      s + (typeof r.todayRuns?.total === 'number' ? r.todayRuns!.total! : 0),
                    0,
                  ),
                )
              : '—',
          })}
        </span>
      </p>
      {res.data?.nextCursor ? (
        <p className="a2-meta" data-testid="agent-v2-mtx-truncated">
          {t('agentConsole.v2.mtx.truncated', { n: rows.length })}
        </p>
      ) : null}
      <div className="a2-grid2" data-testid="agent-v2-mtx-rows">
        {rows
          .filter((r) => !lcFilter || (r.lifecycle ?? '').toLowerCase() === lcFilter)
          .filter((r) => {
            const needle = q.trim().toLowerCase();
            if (!needle) return true;
            return [r.name ?? '', r.employeeId, r.versionRef ?? ''].some((v) =>
              v.toLowerCase().includes(needle),
            );
          })
          .slice()
          .sort((a, b) => {
            if (sortBy === 'name') return (a.name ?? '').localeCompare(b.name ?? '');
            if (sortBy === 'lifecycle') return (a.lifecycle ?? '').localeCompare(b.lifecycle ?? '');
            return 0;
          })
          .map((r) => {
          const lc = r.lifecycle ?? '';
          const lcKey = LIFECYCLE_KEY[lc];
          const tone = LIFECYCLE_TONE[lc] ?? 'neutral';
          const toneCls =
            tone === 'ok' ? ' is-ok' : tone === 'warn' ? ' is-warn' : tone === 'danger' ? ' is-danger' : '';
          const ch = avatarChar(r.name);
          const runs = r.todayRuns;
          const riskN = riskSignalCount(r.risk);
          const focused = focusId !== '' && r.employeeId === focusId;
          const nameKey = (r.name ?? '').trim();
          const duplicated = nameKey !== '' && (nameCounts.get(nameKey) ?? 0) > 1;
          const disambig = duplicated ? versionShort(r.versionRef) || r.employeeId.slice(-8) : '';
          return (
            <div
              className="a2-card"
              data-testid="agent-v2-mtx-row"
              data-focus={focused ? 'true' : undefined}
              id={`mtx-row-${r.employeeId}`}
              tabIndex={focused ? -1 : undefined}
              style={focused ? { outline: '2px solid var(--accent-border, #8a8f98)', outlineOffset: 2 } : undefined}
              key={r.employeeId}
            >
              <p style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="a2-who-avatar" aria-hidden="true" data-testid="agent-v2-mtx-ava">
                  {ch ?? <Icon name="inbox" size={12} />}
                </span>
                <NavLink
                  className="a2-h2"
                  style={{ fontWeight: 600 }}
                  to={`/agent/employees/${encodeURIComponent(r.employeeId)}`}
                  data-testid="agent-v2-mtx-link"
                  title={r.employeeId}
                >
                  {r.name && !ch ? r.name : ch ? r.name : t('agentConsole.v2.mtx.unnamed')}
                </NavLink>
                {disambig ? (
                  <span
                    className="a2-mono"
                    data-testid="agent-v2-mtx-disambig"
                    title={r.versionRef ?? r.employeeId}
                  >
                    {disambig}
                  </span>
                ) : null}
                <span className="a2-sp" />
                {lcKey ? (
                  <span className={`a2-pill${toneCls}`} data-testid="agent-v2-mtx-status">
                    {t(lcKey)}
                  </span>
                ) : lc ? (
                  <span className="a2-pill is-warn" data-testid="agent-v2-mtx-status" title={lc}>
                    <span className="a2-mono">{lc}</span>
                  </span>
                ) : (
                  <span className="a2-pill" data-testid="agent-v2-mtx-status">
                    —
                  </span>
                )}
              </p>
              <p className="a2-meta" data-testid="agent-v2-mtx-version">
                {t('agentConsole.v2.mtx.version')}{' '}
                {r.versionRef ? (
                  <span className="a2-mono" title={r.versionRef}>
                    {versionShort(r.versionRef)}
                  </span>
                ) : (
                  <span className="a2-mono">—</span>
                )}
              </p>
              <p className="a2-meta" data-testid="agent-v2-mtx-skills">
                {t('agentConsole.v2.mtx.skills')}{' '}
                <span className="a2-mono">{r.skillCount != null ? r.skillCount : '—'}</span>
              </p>
              <p className="a2-meta" data-testid="agent-v2-mtx-budget" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                <span>
                  {t('agentConsole.v2.mtx.budgetMonthly')}{' '}
                  <span className="a2-mono" data-testid="agent-v2-mtx-budget-monthly">
                    {r.budget?.monthlyCostUsd != null ? fmtUsd(r.budget.monthlyCostUsd) : '—'}
                  </span>
                </span>
                <span>
                  {t('agentConsole.v2.mtx.budgetDaily')}{' '}
                  <span className="a2-mono" data-testid="agent-v2-mtx-budget-daily">
                    {r.budget?.dailyTokens != null ? String(r.budget.dailyTokens) : '—'}
                  </span>
                </span>
                <span>
                  {t('agentConsole.v2.mtx.budgetPerRun')}{' '}
                  <span className="a2-mono" data-testid="agent-v2-mtx-budget-perrun">
                    {r.budget?.perRunMaxUsd != null ? fmtUsd(r.budget.perRunMaxUsd) : '—'}
                  </span>
                </span>
                {r.budget != null &&
                (r.budget.dailyTokens == null ||
                  r.budget.monthlyCostUsd == null ||
                  r.budget.perRunMaxUsd == null) ? (
                  <span className="a2-mono" data-testid="agent-v2-mtx-budget-partial">
                    {t('agentConsole.v2.mtx.budgetUnset')}
                  </span>
                ) : null}
              </p>
              <p className="a2-meta" data-testid="agent-v2-mtx-runs">
                {t('agentConsole.v2.mtx.runs')}{' '}
                <span className="a2-mono">
                  {runs == null || runs.total == null
                    ? '—'
                    : runs.total === 0
                      ? t('agentConsole.v2.mtx.runsNone')
                      : t('agentConsole.v2.mtx.runsDetail', {
                          total: runs.total,
                          ok: runs.succeeded ?? '—',
                          fail: runs.failed ?? '—',
                        })}
                </span>
              </p>
              <p className="a2-meta" data-testid="agent-v2-mtx-risk">
                {t('agentConsole.v2.mtx.risk')}{' '}
                {r.risk == null ? (
                  <span className="a2-mono">—</span>
                ) : riskN === 0 ? (
                  <span>{t('agentConsole.v2.mtx.noRisk')}</span>
                ) : (
                  <span className="a2-warn" style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
                    {(r.risk?.blockedApprovals ?? 0) > 0 && (
                      <span data-testid="agent-v2-mtx-risk-blocked">
                        {t('agentConsole.v2.mtx.riskBlocked', { n: r.risk!.blockedApprovals })}
                      </span>
                    )}
                    {(r.risk?.failedRuns ?? 0) > 0 && (
                      <span data-testid="agent-v2-mtx-risk-failed">
                        {t('agentConsole.v2.mtx.riskFailed', { n: r.risk!.failedRuns })}
                      </span>
                    )}
                    {r.risk?.budgetOver === true && (
                      <span data-testid="agent-v2-mtx-risk-over">{t('agentConsole.v2.mtx.riskOverBudget')}</span>
                    )}
                  </span>
                )}
              </p>
              <p className="a2-meta" data-testid="agent-v2-mtx-jumps" style={{ display: 'flex', gap: 12 }}>
                <NavLink
                  to={`/agent/runs?employee=${encodeURIComponent(r.employeeId)}`}
                  data-testid="agent-v2-mtx-jump-runs"
                  style={{ textDecoration: 'underline' }}
                >
                  {t('agentConsole.v2.mtx.linkRuns')}
                </NavLink>
                <NavLink
                  to={`/agent/audit?employee=${encodeURIComponent(r.employeeId)}`}
                  data-testid="agent-v2-mtx-jump-audit"
                  style={{ textDecoration: 'underline' }}
                >
                  {t('agentConsole.v2.mtx.linkAudit')}
                </NavLink>
              </p>
            </div>
          );
        })}
      </div>
      <p className="a2-meta" data-testid="agent-v2-mtx-foot">
        {t('agentConsole.v2.mtx.foot')}
      </p>
    </div>
  );
}
