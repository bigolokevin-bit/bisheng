/**
 * Console v2 W1 shell (P0-15 parity spec §2): left rail with 8 L1 entries,
 * topbar (breadcrumb / search pill / env chip / theme / account), nested
 * <Outlet> routing, per-page error boundary and route skeletons.
 *
 * Honest-data rules carried from the parity spec:
 * - no fake usernames: the account control renders the real userContext value
 *   or an explicit "not signed in" copy;
 * - the env chip is a deployment label ("local pilot"), never a computed lie;
 * - the search pill is a focusable placeholder only — there is no global
 *   search endpoint yet, so it never pretends to search;
 * - un-built sections render title + scope note + explicit pending state,
 *   never zeros or fake curves.
 *
 * Theming reuses the existing token blocks: dark default, localStorage
 * 'agentConsole.v2.theme' (same key as the v2 page, zero layout shift, the
 * first frame is painted with the stored theme — no flash).
 */
import { Component, Suspense, useContext, useEffect, useMemo, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { userContext } from '@/contexts/userContext';
import { createHttpAgentConsoleApi, type AgentConsoleApi } from '@/controllers/API/agent';
import {
  createHttpAgentConsoleHermesApi,
  type AgentConsoleHermesApi,
} from '@/controllers/API/agentConsoleHermes';
import {
  createHttpAgentConsoleRunsApi,
  type AgentConsoleRunsApi,
} from '@/controllers/API/agentConsoleRuns';
import {
  createHttpAgentConsoleTrendsApi,
  type AgentConsoleTrendsApi,
} from '@/controllers/API/agentConsoleTrends';

import './consoleShell.css';

const THEME_KEY = 'agentConsole.v2.theme';
const NAV_KEY = 'agentConsole.v2.navCollapsed';

function initialTheme(): 'dark' | 'light' {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    /* storage unavailable */
  }
  return 'dark';
}

function initialCollapsed(): boolean {
  try {
    return window.localStorage.getItem(NAV_KEY) === '1';
  } catch {
    return false;
  }
}

/** Rail entries in spec §2.1 order. `path` is relative to /agent. */
export const L1_ENTRIES: ReadonlyArray<{
  path: string;
  key: string;
  glyph: string;
  group: 'gOverview' | 'gStaff' | 'gOps' | 'gGov';
}> = [
  { path: '', key: 'navOverview', glyph: '◎', group: 'gOverview' },
  { path: 'employees', key: 'navEmployees', glyph: '■', group: 'gStaff' },
  { path: 'approvals', key: 'navApprovals', glyph: '◆', group: 'gOps' },
  { path: 'tasks', key: 'navTasks', glyph: '≡', group: 'gOps' },
  { path: 'runs', key: 'navRuns', glyph: '▶', group: 'gOps' },
  { path: 'metrics', key: 'navMetrics', glyph: '▦', group: 'gOps' },
  { path: 'audit', key: 'navAudit', glyph: '☰', group: 'gGov' },
  { path: 'settings', key: 'navSettings', glyph: '⚙', group: 'gGov' },
];

export interface ShellApis {
  consoleApi: AgentConsoleApi;
  runsApi: AgentConsoleRunsApi;
  hermesApi: AgentConsoleHermesApi;
  trendsApi: AgentConsoleTrendsApi;
}

interface BoundaryProps {
  children: ReactNode;
  failedCopy?: string;
  failedHint?: string;
  retryCopy?: string;
}
interface BoundaryState {
  failed: boolean;
}

/** Route-level error boundary: the shell never goes blank (spec §2 item 5). */
export class ShellBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the message in the console for triage; the UI stays honest.
    console.error('[agent-shell] page crashed', error, info);
  }

  private reset = () => this.setState({ failed: false });

  override render() {
    if (this.state.failed) {
      return (
        <div className="a2-card" role="alert" data-testid="agent-v2-page-error">
          <p className="a2-h2">{this.props.failedCopy ?? 'agentConsole.v2.shellPageError'}</p>
          <p className="a2-meta">
            {(this.props as { failedHint?: string }).failedHint ??
              'agentConsole.v2.shellPageErrorHint'}
          </p>
          <button type="button" className="a2-btn" onClick={this.reset}>
            {(this.props as { retryCopy?: string }).retryCopy ?? 'agentConsole.v2.retry'}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function AgentConsoleShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const [theme, setTheme] = useState<'dark' | 'light'>(initialTheme);
  const [collapsed, setCollapsed] = useState<boolean>(initialCollapsed);

  const apis = useMemo<ShellApis>(
    () => ({
      consoleApi: createHttpAgentConsoleApi(),
      runsApi: createHttpAgentConsoleRunsApi(),
      hermesApi: createHttpAgentConsoleHermesApi(),
      trendsApi: createHttpAgentConsoleTrendsApi(),
    }),
    [],
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(NAV_KEY, collapsed ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }, [collapsed]);

  const seg = location.pathname.split('/').filter(Boolean);
  const child = seg[1] ?? '';
  const activeKey = L1_ENTRIES.find((e) => e.path === child)?.key ?? 'navOverview';

  const user = useContext(userContext)?.user;
  const accountLabel = user?.user_name
    ? String(user.user_name)
    : t('agentConsole.v2.shellAccountAnonymous');

  return (
    <div className="agent-app" data-theme={theme} data-testid="agent-console-shell">
      <div className="a2-ambient" aria-hidden="true" />
      <div className={`a2s-frame${collapsed ? ' is-collapsed' : ''}`}>
        <nav className="a2s-rail" aria-label={t('agentConsole.v2.title')}>
          <div className="a2s-rail-head">
            <span className="a2s-logo a2-mono" aria-hidden="true">
              S
            </span>
            <button
              type="button"
              className="a2s-btn a2s-collapse"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={t('agentConsole.v2.shellCollapseNav')}
            >
              ‹
            </button>
          </div>
          <div className="a2s-groups">
            {(['gOverview', 'gStaff', 'gOps', 'gGov'] as const).map((g) => (
              <div className="a2s-group" key={g}>
                <span className="a2s-group-label">{t(`agentConsole.v2.shell.${g}`)}</span>
                {L1_ENTRIES.filter((e) => e.group === g).map((e) => (
                  <NavLink
                    key={e.path || 'index'}
                    end={e.path === ''}
                    to={e.path === '' ? '/agent' : `/agent/${e.path}`}
                    className={({ isActive }) => `a2s-nav${isActive ? ' is-active' : ''}`}
                    title={t(`agentConsole.v2.${e.key}`)}
                    aria-label={t(`agentConsole.v2.${e.key}`)}
                  >
                    <span className="a2s-glyph" aria-hidden="true">
                      {e.glyph}
                    </span>
                    <span className="a2s-nav-label">{t(`agentConsole.v2.${e.key}`)}</span>
                  </NavLink>
                ))}
              </div>
            ))}
          </div>
        </nav>
        <div className="a2s-main">
          <header className="a2s-topbar">
            <nav className="a2s-crumb" aria-label="breadcrumb">
              <span className="a2s-crumb-root">{t('agentConsole.v2.title')}</span>
              <span className="a2s-crumb-sep" aria-hidden="true">
                /
              </span>
              <span className="a2s-crumb-current">{t(`agentConsole.v2.${activeKey}`)}</span>
            </nav>
            <label className="a2s-search">
              <input
                type="text"
                className="a2s-search-input"
                placeholder={t('agentConsole.v2.shellSearchPlaceholder')}
                onKeyDown={(ev) => {
                  if (ev.key === 'Escape') (ev.target as HTMLInputElement).blur();
                }}
              />
              <span className="a2s-search-kbd a2-mono" aria-hidden="true">
                ⌘K
              </span>
            </label>
            <span className="a2-pill is-accent" data-testid="agent-v2-env-chip">
              {t('agentConsole.v2.envPilot')}
            </span>
            <button
              type="button"
              className="a2-btn"
              onClick={() => setTheme((v) => (v === 'dark' ? 'light' : 'dark'))}
              aria-label={t('agentConsole.v2.themeToggle')}
            >
              {theme === 'dark'
                ? t('agentConsole.v2.themeDark')
                : t('agentConsole.v2.themeLight')}
            </button>
            <span
              className="a2s-account"
              data-testid="agent-v2-account"
              title={accountLabel}
            >
              {accountLabel.slice(0, 12)}
            </span>
          </header>
          <ShellBoundary
            failedCopy={t('agentConsole.v2.shellPageError')}
            failedHint={t('agentConsole.v2.shellPageErrorHint')}
            retryCopy={t('agentConsole.v2.retry')}
          >
            <Suspense
              fallback={
                <div
                  className="a2s-skeleton"
                  data-testid="agent-v2-route-skeleton"
                  aria-hidden="true"
                >
                  <span className="a2s-sk-row" />
                  <span className="a2s-sk-row is-short" />
                  <span className="a2s-sk-row" />
                </div>
              }
            >
              <Outlet context={apis} />
            </Suspense>
          </ShellBoundary>
        </div>
      </div>
    </div>
  );
}

/** Pages read the shared shell APIs through this typed helper. */
export function useShellApis(): ShellApis {
  return useOutletContext<ShellApis>();
}
