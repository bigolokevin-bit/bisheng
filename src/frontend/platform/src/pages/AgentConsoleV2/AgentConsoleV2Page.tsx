/**
 * Console v2 P1 surface (l4-console-v2): own shell (rail + topbar), employee
 * list on real E11 data, employee detail on real E2/E5 data with grants
 * blast radius, and the approval queue on real AP4/AP3 data.
 *
 * Honest-data rules (S10b-v2 card + CR-031):
 * - Trend/heat/aggregate KPI numbers that no read model can compute yet are
 *   rendered as explicit "pending data source" placeholders — never mocked.
 * - The historical version chain has no GET endpoint in the contract (E4 is
 *   write-only), so the detail shows the CURRENT version from E5 plus a
 *   pending-chain note; no fake chain is drawn.
 * - No chat panel exists in P1, so no message input can ever appear for an
 *   unbound application.
 * - snapshotRef (internal BFF binding id) is never rendered.
 *
 * Theming: two isomorphic token blocks (dark default), user toggle persisted
 * in localStorage, prefers-color-scheme only as the initial value, and the
 * theme switch produces zero layout shift (colors only).
 */
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { userContext } from '@/contexts/userContext';
import {
  createHttpAgentConsoleApi,
  type AgentConsoleApi,
  type EffectiveConfig,
  type EmployeeDetail,
  type EmployeeSummary,
} from '@/controllers/API/agent';
import {
  createHttpAgentApprovalsApi,
  type AgentApprovalsApi,
  type Approval,
} from '@/controllers/API/agentConsoleApprovals';
import { ApprovalDetail } from '@/pages/AgentApprovalsPage/ApprovalDetail';

import './agentConsoleV2.css';

type Section = 'list' | 'detail' | 'appr';
type Box<T> = { phase: 'loading' } | { phase: 'ok'; value: T } | { phase: 'error' };

const THEME_KEY = 'agentConsole.v2.theme';

function initialTheme(): 'dark' | 'light' {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    if (typeof window.matchMedia === 'function') {
      const light = window.matchMedia('(prefers-color-scheme: light)');
      if (light.matches) return 'light';
    }
  } catch {
    /* storage or media query unavailable: deterministic fallback below */
  }
  return 'dark';
}

const boxLoading = { phase: 'loading' } as const;

export interface AgentConsoleV2Props {
  /** ADR-0012: /agent/approvals deep link opens the approvals section. */
  initialSection?: Section;
  consoleApi?: AgentConsoleApi;
  approvalsApi?: AgentApprovalsApi;
}

export function AgentConsoleV2Page({ consoleApi, approvalsApi, initialSection }: AgentConsoleV2Props = {}) {
  const { t } = useTranslation();
  const { user } = useContext(userContext);
  const api = useMemo(() => consoleApi ?? createHttpAgentConsoleApi(), [consoleApi]);
  const approvals = useMemo(() => approvalsApi ?? createHttpAgentApprovalsApi(), [approvalsApi]);
  const uid = String(user?.user_id ?? '');
  const humanId = uid ? `human:${uid}` : '';

  const [theme, setTheme] = useState<'dark' | 'light'>(initialTheme);
  const [section, setSection] = useState<Section>(initialSection ?? 'list');
  const [keyword, setKeyword] = useState('');
  const [list, setList] = useState<Box<EmployeeSummary[]>>(boxLoading);
  const [pendingCount, setPendingCount] = useState<Box<number>>(boxLoading);
  const [selected, setSelected] = useState<EmployeeSummary | null>(null);
  const [detail, setDetail] = useState<Box<EmployeeDetail | null>>(boxLoading);
  const [config, setConfig] = useState<Box<EffectiveConfig | null>>(boxLoading);
  const [apprRows, setApprRows] = useState<Box<Approval[]>>(boxLoading);
  const [apprSelected, setApprSelected] = useState<Approval | null>(null);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch {
        /* persistence is best-effort; the toggle itself still works */
      }
      return next;
    });
  };

  const loadList = useCallback(
    (kw: string) => {
      setList(boxLoading);
      api
        .listEmployees({ keyword: kw || undefined, limit: 20 })
        .then((res) => setList({ phase: 'ok', value: res.items }))
        .catch(() => setList({ phase: 'error' }));
    },
    [api],
  );

  useEffect(() => {
    loadList('');
    if (humanId) {
      api
        .countPendingApprovals(humanId)
        .then((res) =>
          setPendingCount(res.ok && res.data ? { phase: 'ok', value: res.data.count } : { phase: 'error' }),
        )
        .catch(() => setPendingCount({ phase: 'error' }));
    }
  }, [api, humanId, loadList]);

  const openDetail = (row: EmployeeSummary) => {
    setSelected(row);
    setSection('detail');
    setApprSelected(null);
    setDetail(boxLoading);
    setConfig(boxLoading);
    api
      .getEmployee(row.employeeId)
      .then((res) => setDetail(res.ok && res.data ? { phase: 'ok', value: res.data } : { phase: 'ok', value: null }))
      .catch(() => setDetail({ phase: 'error' }));
    api
      .getEffectiveConfig(row.employeeId)
      .then((res) => setConfig(res.ok && res.data ? { phase: 'ok', value: res.data } : { phase: 'ok', value: null }))
      .catch(() => setConfig({ phase: 'error' }));
  };

  const openApprovals = () => {
    setSection('appr');
    setApprSelected(null);
    if (!humanId) {
      setApprRows({ phase: 'error' });
      return;
    }
    setApprRows(boxLoading);
    approvals
      .listApprovals({ assignee: humanId, status: 'pending', limit: 20 })
      .then((res) => setApprRows({ phase: 'ok', value: res.items }))
      .catch(() => setApprRows({ phase: 'error' }));
  };

  const onDuty = list.phase === 'ok' ? list.value.filter((e) => e.lifecycleState === 'active').length : null;

  const statePill = (state: string) => {
    const cls =
      state === 'active' ? 'is-ok' : state === 'paused' || state === 'suspended' ? 'is-warn' : state === 'archived' || state === 'offboarding' ? 'is-danger' : '';
    return <span className={`a2-pill ${cls}`}>{t(`agentConsole.states.${state}`, state)}</span>;
  };

  return (
    <div className="agent-app" data-theme={theme} data-testid="agent-console-v2">
      <div className="a2-ambient" aria-hidden="true" />
      <div className="a2-shell">
        <nav className="a2-rail" aria-label={t('agentConsole.v2.title')}>
          <div className="a2-rail-logo a2-mono" aria-hidden="true">S</div>
          <button
            type="button"
            className={`a2-rail-btn${section === 'list' || section === 'detail' ? ' is-active' : ''}`}
            title={t('agentConsole.v2.navEmployees')}
            aria-label={t('agentConsole.v2.navEmployees')}
            onClick={() => {
              setSection('list');
              setSelected(null);
            }}
          >
            ■
          </button>
          <button
            type="button"
            className={`a2-rail-btn${section === 'appr' ? ' is-active' : ''}`}
            title={t('agentConsole.v2.navApprovals')}
            aria-label={t('agentConsole.v2.navApprovals')}
            onClick={openApprovals}
          >
            ◆
            {pendingCount.phase === 'ok' && pendingCount.value > 0 ? <span className="a2-badge" aria-hidden="true" /> : null}
          </button>
        </nav>
        <div className="a2-main">
          <header className="a2-topbar">
            <span className="a2-title">{t('agentConsole.v2.title')}</span>
            <button type="button" className="a2-btn" onClick={toggleTheme} aria-label={t('agentConsole.v2.themeToggle')}>
              {theme === 'dark' ? t('agentConsole.v2.themeDark') : t('agentConsole.v2.themeLight')}
            </button>
          </header>
          <div className="a2-body">
            {section === 'list' ? (
              <>
                <h1 className="a2-h1">{t('agentConsole.v2.navEmployees')}</h1>
                <div className="a2-kpis">
                  <div className="a2-kpi">
                    <div className="a2-micro">{t('agentConsole.v2.kpiOnDutyPage')}</div>
                    <div className="a2-kpi-num">{onDuty ?? '—'}</div>
                  </div>
                  <div className="a2-kpi">
                    <div className="a2-micro">{t('agentConsole.v2.kpiPendingMine')}</div>
                    <div className="a2-kpi-num">
                      {pendingCount.phase === 'ok' ? pendingCount.value : pendingCount.phase === 'error' ? '—' : '…'}
                    </div>
                  </div>
                  <div className="a2-kpi">
                    <div className="a2-micro">{t('agentConsole.v2.emptyTrend')}</div>
                    <div className="a2-pending" data-testid="agent-v2-trend-pending">{t('agentConsole.v2.emptyTrend')}</div>
                  </div>
                </div>
                <div className="a2-card">
                  <div className="a2-toolbar">
                    <input
                      className="a2-search"
                      value={keyword}
                      aria-label={t('agentConsole.v2.search')}
                      placeholder={t('agentConsole.v2.search')}
                      onChange={(e) => setKeyword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') loadList(keyword.trim());
                      }}
                    />
                    <button type="button" className="a2-btn is-primary" onClick={() => loadList(keyword.trim())}>
                      {t('agentConsole.v2.query')}
                    </button>
                  </div>
                  {list.phase === 'loading' ? (
                    <p className="a2-meta" data-testid="agent-v2-loading">{t('agentConsole.v2.loading')}</p>
                  ) : list.phase === 'error' ? (
                    <p className="a2-meta" data-testid="agent-v2-list-error">{t('agentConsole.v2.errorQuery')}</p>
                  ) : list.value.length === 0 ? (
                    <p className="a2-meta" data-testid="agent-v2-list-empty">{t('agentConsole.v2.emptyList')}</p>
                  ) : (
                    <table className="a2-table">
                      <thead>
                        <tr>
                          <th>{t('agentConsole.v2.colName')}</th>
                          <th>{t('agentConsole.v2.colId')}</th>
                          <th>{t('agentConsole.v2.colStatus')}</th>
                          <th>{t('agentConsole.v2.colOwner')}</th>
                          <th aria-label={t('agentConsole.v2.detail')} />
                        </tr>
                      </thead>
                      <tbody>
                        {list.value.map((e) => (
                          <tr key={e.employeeId} data-testid="agent-v2-row">
                            <td>{e.name}</td>
                            <td className="a2-mono">{e.employeeId}</td>
                            <td>{statePill(e.lifecycleState)}</td>
                            <td className="a2-mono">{e.ownerUserId}</td>
                            <td>
                              <button type="button" className="a2-btn" onClick={() => openDetail(e)}>
                                {t('agentConsole.v2.detail')}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            ) : null}

            {section === 'detail' && selected ? (
              <>
                <div className="a2-toolbar">
                  <button type="button" className="a2-btn" onClick={() => setSection('list')}>
                    {t('agentConsole.v2.back')}
                  </button>
                  <h1 className="a2-h1">{selected.name}</h1>
                </div>
                <div className="a2-grid2">
                  <div className="a2-card" data-testid="agent-v2-identity">
                    <h2 className="a2-h2">{t('agentConsole.v2.identityPanel')}</h2>
                    {detail.phase === 'loading' ? <p className="a2-meta">{t('agentConsole.v2.loading')}</p> : null}
                    {detail.phase === 'error' ? <p className="a2-meta">{t('agentConsole.v2.errorQuery')}</p> : null}
                    {detail.phase === 'ok' && detail.value ? (
                      <>
                        <p>{detail.value.name}</p>
                        <p className="a2-meta a2-mono">{detail.value.id}</p>
                        <p>{detail.value.title}</p>
                        <p>{statePill(detail.value.lifecycleState)}</p>
                      </>
                    ) : null}
                  </div>
                  <div className="a2-card" data-testid="agent-v2-version">
                    <h2 className="a2-h2">{t('agentConsole.v2.versionPanel')}</h2>
                    {config.phase === 'loading' ? <p className="a2-meta">{t('agentConsole.v2.loading')}</p> : null}
                    {config.phase === 'error' ? <p className="a2-meta">{t('agentConsole.v2.errorQuery')}</p> : null}
                    {config.phase === 'ok' && config.value?.version ? (
                      <p>
                        <span className="a2-pill is-accent a2-mono">v{config.value.version.versionNo}</span>
                      </p>
                    ) : null}
                    <div className="a2-pending" data-testid="agent-v2-chain-pending">
                      {t('agentConsole.v2.emptyChain')}
                    </div>
                  </div>
                  <div className="a2-card" data-testid="agent-v2-blast">
                    <h2 className="a2-h2">{t('agentConsole.v2.grantsBlast')}</h2>
                    {config.phase === 'ok' && config.value ? (
                      config.value.grants.length === 0 ? (
                        <p className="a2-meta">{t('agentConsole.v2.emptyGrants')}</p>
                      ) : (
                        <div className="a2-chips">
                          {config.value.grants.map((g) => (
                            <span key={g.id} className="a2-pill a2-mono" title={`${g.scopeType}:${g.resourceSelector}`}>
                              {g.resourceSelector} · {g.actions.join(',')}
                            </span>
                          ))}
                        </div>
                      )
                    ) : (
                      <p className="a2-meta">{config.phase === 'loading'
                        ? t('agentConsole.v2.loading')
                        : config.phase === 'error'
                          ? t('agentConsole.v2.errorQuery')
                          : ''}</p>
                    )}
                  </div>
                  <div className="a2-card" data-testid="agent-v2-quota">
                    <h2 className="a2-h2">{t('agentConsole.v2.quotaPanel')}</h2>
                    <div className="a2-pending">{t('agentConsole.v2.emptyBudget')}</div>
                  </div>
                </div>
              </>
            ) : null}

            {section === 'appr' ? (
              <>
                <h1 className="a2-h1">{t('agentConsole.v2.navApprovals')}</h1>
                <div className="a2-card">
                  {apprRows.phase === 'loading' ? <p className="a2-meta">{t('agentConsole.v2.loading')}</p> : null}
                  {apprRows.phase === 'error' ? <p className="a2-meta" data-testid="agent-v2-appr-error">{t('agentConsole.v2.errorQuery')}</p> : null}
                  {apprRows.phase === 'ok' && apprRows.value.length === 0 ? (
                    <p className="a2-meta" data-testid="agent-v2-appr-empty">{t('agentConsole.v2.emptyApprovals')}</p>
                  ) : null}
                  {apprRows.phase === 'ok' && apprRows.value.length > 0 ? (
                    <table className="a2-table">
                      <thead>
                        <tr>
                          <th>{t('agentConsole.v2.colApproval')}</th>
                          <th>{t('agentConsole.v2.colAction')}</th>
                          <th>{t('agentConsole.v2.colRisk')}</th>
                          <th aria-label={t('agentConsole.v2.detail')} />
                        </tr>
                      </thead>
                      <tbody>
                        {apprRows.value.map((a) => (
                          <tr key={a.approvalId} data-testid="agent-v2-appr-row">
                            <td className="a2-mono">{a.approvalId}</td>
                            <td>{a.action}</td>
                            <td>
                              <span className={`a2-pill${a.riskLevel === 'high' ? ' is-danger' : a.riskLevel === 'medium' ? ' is-warn' : ''}`}>
                                {a.riskLevel}
                              </span>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="a2-btn"
                                onClick={() => setApprSelected(apprSelected?.approvalId === a.approvalId ? null : a)}
                              >
                                {t('agentConsole.v2.detail')}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </div>
                {apprSelected ? (
                  <div className="a2-card" data-testid="agent-v2-approval-detail">
                    <ApprovalDetail api={approvals} approval={apprSelected} currentHumanId={humanId || undefined} />
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
