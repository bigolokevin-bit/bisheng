/**
 * Console v2 P1 surface (l4-console-v2): own shell (rail + topbar), employee
 * list on real E11 data, employee detail on real E2/E5 data with grants
 * blast radius, the approval queue on real AP4/AP3 data, and the read-only
 * runs & trace surface on real R5/R3 data (P0-6 v2-4).
 *
 * Honest-data rules (S10b-v2 card + CR-031):
 * - Trend/heat/aggregate KPI numbers that no read model can compute yet are
 *   rendered as explicit "pending data source" placeholders — never mocked.
 * - The historical version chain has no GET endpoint in the contract (E4 is
 *   write-only), so the detail shows the CURRENT version from E5 plus a
 *   pending-chain note; no fake chain is drawn.
 * - The app-chat panel (S10b-v2-2) is read-only and appears only for an
 *   ACTIVE app workstation binding; unbound employees see guidance, never
 *   an input, and no message UI is ever faked here.
 * - snapshotRef (internal BFF binding id) is never rendered.
 *
 * Theming: two isomorphic token blocks (dark default), user toggle persisted
 * in localStorage, prefers-color-scheme only as the initial value, and the
 * theme switch produces zero layout shift (colors only).
 */

const NARROW_QUERY = '(max-width: 767px)';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { userContext } from '@/contexts/userContext';
import {
  createHttpAgentConsoleApi,
  type AgentConsoleApi,
  type EffectiveConfig,
  type EmployeeDetail,
  type EmployeeSummary,
  type Workstation,
} from '@/controllers/API/agent';
import {
  createHttpAgentApprovalsApi,
  type AgentApprovalsApi,
  type Approval,
} from '@/controllers/API/agentConsoleApprovals';
import {
  createHttpAgentConsoleRunsApi,
  type AgentConsoleRunsApi,
} from '@/controllers/API/agentConsoleRuns';
import {
  createHttpAgentConsoleTrendsApi,
  type AgentConsoleTrendsApi,
} from '@/controllers/API/agentConsoleTrends';
import { ApprovalDetail } from '@/pages/AgentApprovalsPage/ApprovalDetail';

import { RunsSection } from './RunsSection';
import { TrendsCostsSection } from './TrendsCostsSection';

import './agentConsoleV2.css';

type Section = 'list' | 'detail' | 'appr' | 'runs';
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
  /** P0-5 v2-3: R6/R7/P9 read-only trends & costs adapter. */
  trendsApi?: AgentConsoleTrendsApi;
  /** P0-6 v2-4: R5/R3 read-only runs & trace adapter. */
  runsApi?: AgentConsoleRunsApi;
}

export function AgentConsoleV2Page({ consoleApi, approvalsApi, trendsApi, runsApi, initialSection }: AgentConsoleV2Props = {}) {
  const { t } = useTranslation();
  const { user } = useContext(userContext);
  const api = useMemo(() => consoleApi ?? createHttpAgentConsoleApi(), [consoleApi]);
  const approvals = useMemo(() => approvalsApi ?? createHttpAgentApprovalsApi(), [approvalsApi]);
  const trends = useMemo(() => trendsApi ?? createHttpAgentConsoleTrendsApi(), [trendsApi]);
  const runs = useMemo(() => runsApi ?? createHttpAgentConsoleRunsApi(), [runsApi]);
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
  // E10 workstations feed the read-only app-chat panel (S10b-v2-2). Unlike
  // detail/config, a failed read must surface as an error here: degrading to
  // "unbound" would be indistinguishable from a genuinely unbound employee.
  const [stations, setStations] = useState<Box<Workstation[]>>(boxLoading);
  const [frameState, setFrameState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [apprRows, setApprRows] = useState<Box<Approval[]>>(boxLoading);
  const [apprSelected, setApprSelected] = useState<Approval | null>(null);
  // P0-6 v2-4: employee preset carried into the runs section from a detail
  // page (null = all employees). RunsSection remounts when it changes.
  const [runsEmployeeId, setRunsEmployeeId] = useState<string | null>(null);

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

  // Deep-link entry (/agent/approvals): load the queue on mount as well,
  // not only when the rail button is clicked.
  useEffect(() => {
    if (initialSection === 'appr' && humanId && apprRows.phase === 'loading') {
      openApprovals();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSection, humanId]);

  const openDetail = (row: EmployeeSummary) => {
    setSelected(row);
    setSection('detail');
    setApprSelected(null);
    setDetail(boxLoading);
    setConfig(boxLoading);
    setStations(boxLoading);
    setFrameState('loading');
    api
      .getWorkstations(row.employeeId)
      .then((res) =>
        res.ok && res.data ? setStations({ phase: 'ok', value: res.data.items }) : setStations({ phase: 'error' }),
      )
      .catch(() => setStations({ phase: 'error' }));
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

  // P0-6 v2-4: read-only runs surface. Entering from an employee detail
  // pre-filters R5 by that employee; the rail entry keeps it unfiltered
  // (the section still always sends the 7-day `since`).
  const openRuns = (presetEmployeeId: string | null) => {
    setRunsEmployeeId(presetEmployeeId);
    setSection('runs');
    setApprSelected(null);
  };

  const onDuty = list.phase === 'ok' ? list.value.filter((e) => e.lifecycleState === 'active').length : null;

  const selectorText = (s: string | { type: string; [k: string]: unknown }): string => {
    if (typeof s === 'string') return s;
    if (s && typeof s === 'object') {
      const { type, ...rest } = s as { type: string; [k: string]: unknown };
      const parts = Object.entries(rest)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
      return parts.length ? `${type}(${parts.join(',')})` : String(type ?? 'grant');
    }
    return String(s);
  };

  // Mobile rework (S10b-v2 acceptance): below 768px the list and approvals
  // panels render single-column cards instead of wide tables. jsdom without a
  // matchMedia stub stays wide, so existing table tests are unaffected.
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(NARROW_QUERY).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = (ev: MediaQueryListEvent) => setNarrow(ev.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const STATE_LABEL_KEYS: Record<string, string> = {
    draft: 'agentConsole.states.draft',
    onboarding: 'agentConsole.states.onboarding',
    active: 'agentConsole.states.active',
    paused: 'agentConsole.states.paused',
    offboarding: 'agentConsole.states.offboarding',
    archived: 'agentConsole.states.archived',
  };

  const statePill = (state: string) => {
    const cls =
      state === 'active' ? 'is-ok' : state === 'paused' || state === 'suspended' ? 'is-warn' : state === 'archived' || state === 'offboarding' ? 'is-danger' : '';
    const key = STATE_LABEL_KEYS[state];
    if (key === undefined) {
      // The contract defines exactly six lifecycle states. Anything else is an
      // upstream bug: log it loudly, then degrade to the raw value.
      console.error('[AgentConsoleV2] unknown employee lifecycle state:', state);
      return <span className={`a2-pill ${cls}`}>{state}</span>;
    }
    return <span className={`a2-pill ${cls}`}>{t(key)}</span>;
  };

  // Read-only app-chat (S10b-v2-2): only an ACTIVE app binding unlocks the
  // panel. dm/group bindings and pending/suspended app rows must not render
  // any chat surface — the client route exists solely for app workstations.
  const chatBinding =
    stations.phase === 'ok' ? stations.value.find((w) => w.bindingType === 'app' && w.status === 'active') ?? null : null;
  const chatSrc = chatBinding ? `/workspace/chat/assistant/auth/${encodeURIComponent(chatBinding.externalRef)}` : '';

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
          {/* P0-6 v2-4: ▶ matches the ■/◆ glyph idiom of the rail. */}
          <button
            type="button"
            className={`a2-rail-btn${section === 'runs' ? ' is-active' : ''}`}
            title={t('agentConsole.v2.navRuns')}
            aria-label={t('agentConsole.v2.navRuns')}
            onClick={() => openRuns(null)}
          >
            ▶
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
                    <div className="a2-micro">{t('agentConsole.v2.kpiTrend')}</div>
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
                  ) : narrow ? (
                    <div className="a2-cards">
                      {list.value.map((e) => (
                        <div key={e.employeeId} className="a2-card a2-card-item" data-testid="agent-v2-card">
                          <div className="a2-card-head">
                            <span>{e.name}</span>
                            {statePill(e.lifecycleState)}
                          </div>
                          <div className="a2-card-sub a2-mono">{e.employeeId}</div>
                          <div className="a2-card-sub">{e.ownerUserId}</div>
                          <div className="a2-card-sub a2-mono">{String(e.updatedAt).slice(0, 16).replace("T", " ")}</div>
                          <div className="a2-card-actions">
                            <button type="button" className="a2-btn" onClick={() => openDetail(e)}>
                              {t('agentConsole.v2.detail')}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
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
                  {/* P0-6 v2-4: read-only entry into the runs surface,
                      pre-filtered by this employee. */}
                  <button
                    type="button"
                    className="a2-btn"
                    data-testid="agent-v2-runs-view"
                    onClick={() => openRuns(selected.employeeId)}
                  >
                    {t('agentConsole.v2.runsView')}
                  </button>
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
                            <span key={g.id} className="a2-pill a2-mono" title={`${g.scopeType}:${selectorText(g.resourceSelector)}`}>
                              {selectorText(g.resourceSelector)} · {g.actions.join(',')}
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
                {/* P0-5 v2-3: real R6/R7/P9 data replaces the pending-only
                    story once these routes land; blocks degrade per-block. */}
                <TrendsCostsSection employeeId={selected.employeeId} api={trends} />
                <div className="a2-card a2-chat-card" data-testid="agent-v2-chat">
                  <h2 className="a2-h2">{t('agentConsole.v2.chatTitle')}</h2>
                  {stations.phase === 'loading' ? <p className="a2-meta">{t('agentConsole.v2.loading')}</p> : null}
                  {stations.phase === 'error' ? (
                    <p className="a2-meta" data-testid="agent-v2-chat-error">{t('agentConsole.v2.errorQuery')}</p>
                  ) : null}
                  {stations.phase === 'ok' && !chatBinding ? (
                    <div className="a2-pending" data-testid="agent-v2-chat-unbound">{t('agentConsole.v2.chatUnbound')}</div>
                  ) : null}
                  {chatBinding ? (
                    <>
                      <p className="a2-meta a2-chat-bind" data-testid="agent-v2-chat-binding">
                        <span className="a2-pill is-ok">{chatBinding.channel}</span>{' '}
                        <span className="a2-mono" title={chatBinding.id}>{chatBinding.externalRef}</span>
                      </p>
                      <p className="a2-meta">
                        <a
                          className="a2-chat-open"
                          data-testid="agent-v2-chat-open"
                          href={chatSrc}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t('agentConsole.v2.chatOpenExternal')}
                        </a>
                      </p>
                      {frameState === 'error' ? (
                        <p className="a2-meta" data-testid="agent-v2-chat-frame-error">{t('agentConsole.v2.chatFrameError')}</p>
                      ) : (
                        <>
                          {frameState === 'loading' ? (
                            <p className="a2-meta" data-testid="agent-v2-chat-frame-loading">{t('agentConsole.v2.loading')}</p>
                          ) : null}
                          <iframe
                            className="a2-chat-frame"
                            data-testid="agent-v2-chat-iframe"
                            title={t('agentConsole.v2.chatTitle')}
                            src={chatSrc}
                            onLoad={() => setFrameState('loaded')}
                            onError={() => setFrameState('error')}
                          />
                        </>
                      )}
                    </>
                  ) : null}
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
                    narrow ? (
                      <div className="a2-cards">
                        {apprRows.value.map((a) => (
                          <div key={a.approvalId} className="a2-card a2-card-item" data-testid="agent-v2-appr-card">
                            <div className="a2-card-head">
                              <span className="a2-mono">{a.approvalId}</span>
                              <span className={`a2-pill${a.riskLevel === 'high' ? ' is-danger' : a.riskLevel === 'medium' ? ' is-warn' : ''}`}>
                                {a.riskLevel}
                              </span>
                            </div>
                            <div className="a2-card-sub">{a.action}</div>
                            <div className="a2-card-actions">
                              <button
                                type="button"
                                className="a2-btn"
                                onClick={() => setApprSelected(apprSelected?.approvalId === a.approvalId ? null : a)}
                              >
                                {t('agentConsole.v2.detail')}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
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
                    )
                  ) : null}
                </div>
                {apprSelected ? (
                  <div className="a2-card" data-testid="agent-v2-approval-detail">
                    <ApprovalDetail api={approvals} approval={apprSelected} currentHumanId={humanId || undefined} />
                  </div>
                ) : null}
              </>
            ) : null}

            {section === 'runs' ? (
              <>
                <h1 className="a2-h1">{t('agentConsole.v2.navRuns')}</h1>
                {/* key on the preset: entering from a different employee must
                    remount with that employee pre-selected. */}
                <RunsSection
                  key={`runs:${runsEmployeeId ?? ''}`}
                  api={runs}
                  consoleApi={api}
                  initialEmployeeId={runsEmployeeId}
                />
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
