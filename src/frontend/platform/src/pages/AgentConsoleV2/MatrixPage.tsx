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
  isBudgetConfigured,
  normalizeRow,
  riskSignalCount,
  type MatrixEmployeeRow,
  type MatrixListBody,
} from './matrix';

export default function MatrixPage() {
  const { t } = useTranslation();
  const fetchApi: Fetcher = useMemo(() => makeFetcher(), []);
  const [res, setRes] = useState<ApiRes<MatrixListBody> | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchApi<MatrixListBody>('/api/matrix', { limit: 50 }).then((r) => {
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
      <div className="a2-grid2" data-testid="agent-v2-mtx-rows">
        {rows.map((r) => {
          const lc = r.lifecycle ?? '';
          const lcKey = LIFECYCLE_KEY[lc];
          const tone = LIFECYCLE_TONE[lc] ?? 'neutral';
          const toneCls =
            tone === 'ok' ? ' is-ok' : tone === 'warn' ? ' is-warn' : tone === 'danger' ? ' is-danger' : '';
          const ch = avatarChar(r.name);
          const configured = isBudgetConfigured(r.budget);
          const runs = r.todayRuns;
          const riskN = riskSignalCount(r.risk);
          return (
            <div className="a2-card" data-testid="agent-v2-mtx-row" key={r.employeeId}>
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
                {r.versionRef ? (
                  <>
                    {t('agentConsole.v2.mtx.version')} <span className="a2-mono">{r.versionRef}</span>
                  </>
                ) : (
                  <>
                    {t('agentConsole.v2.mtx.version')} —
                  </>
                )}
              </p>
              <p className="a2-meta" data-testid="agent-v2-mtx-skills">
                {t('agentConsole.v2.mtx.skills')}{' '}
                <span className="a2-mono">{r.skillCount != null ? r.skillCount : '—'}</span>
              </p>
              <p className="a2-meta" data-testid="agent-v2-mtx-budget">
                {t('agentConsole.v2.mtx.budgetMonthly')}{' '}
                {r.budget == null ? (
                  <span className="a2-mono">—</span>
                ) : configured ? (
                  r.budget.monthlyCostUsd != null ? (
                    <span className="a2-mono">{fmtUsd(r.budget.monthlyCostUsd)}</span>
                  ) : (
                    /* configured budget but this field unset → 未配置, never USD 0.00 (a57232b stance) */
                    t('agentConsole.v2.mtx.budgetUnset')
                  )
                ) : (
                  t('agentConsole.v2.mtx.budgetUnset')
                )}
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
