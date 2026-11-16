/**
 * Console v2 shell rebuilt against ov01-target.html §1 (OV-01 C1 fix):
 * 72px SVG icon rail (Lucide-style 1.5px stroke, currentColor, never a
 * Unicode glyph), spacer-pinned 设置 + avatar at the bottom so there is no
 * "black hole" below the nav; topbar = breadcrumb with chevron, search pill
 * (搜索员工、审批、run id + ⌘K kbd), neutral env chip with a success dot
 * (no purple), icon-only theme toggle, user area = avatar + name + chevron.
 * ≤767 the rail becomes a sticky top horizontal-scroll strip with the
 * 「可左右滑动」 hint and the active entry auto-scrolled into view — it is
 * never a floating band in the middle of the page.
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
import { Component, Suspense, useContext, useEffect, useMemo, useRef, useState } from 'react';
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

// consoleShell.css only defines the shell chrome and explicitly relies on
// agentConsoleV2.css for the .agent-app design tokens and every .a2-* card /
// table / KPI rule; without this import the W1 shell pages rendered as
// unstyled text (L0 visual re-review 2026-11-15).
import './agentConsoleV2.css';
import './consoleShell.css';

const THEME_KEY = 'agentConsole.v2.theme';

function initialTheme(): 'dark' | 'light' {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    /* storage unavailable */
  }
  return 'dark';
}

/* Inline SVG symbol set (Lucide-style, 24×24, 1.5px stroke, currentColor).
 * The target rail forbids Unicode/emoji glyphs (C1 audit item 2). */
const RAIL_ICONS: Record<string, ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  clip: (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="m9 14 2 2 4-4" />
    </>
  ),
  list: (
    <>
      <rect x="3" y="5" width="6" height="6" rx="1" />
      <path d="M13 8h8" />
      <path d="M13 16h8" />
      <rect x="3" y="13" width="6" height="6" rx="1" />
    </>
  ),
  act: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  trend: (
    <>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </>
  ),
  hist: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </>
  ),
  cfg: (
    <>
      <line x1="4" x2="4" y1="21" y2="14" />
      <line x1="4" x2="4" y1="10" y2="3" />
      <line x1="12" x2="12" y1="21" y2="12" />
      <line x1="12" x2="12" y1="8" y2="3" />
      <line x1="20" x2="20" y1="21" y2="16" />
      <line x1="20" x2="20" y1="12" y2="3" />
      <line x1="2" x2="6" y1="14" y2="14" />
      <line x1="10" x2="14" y1="8" y2="8" />
      <line x1="18" x2="22" y1="16" y2="16" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  chevR: <path d="m9 18 6-6-6-6" />,
  chevD: <path d="m6 9 6 6 6-6" />,
  chevScroll: <path d="m6 9 6 6 6-6" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </>
  ),
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
};

function RailIcon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      className="a2s-i"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {RAIL_ICONS[name] ?? null}
    </svg>
  );
}

/** Rail entries in target §1 order. `path` is relative to /agent. The
 *  settings entry is pinned at the rail bottom (spacer above it), never in
 *  the scrollable middle. */
export const L1_ENTRIES: ReadonlyArray<{
  path: string;
  key: string;
  icon: string;
  bottom?: boolean;
}> = [
  { path: '', key: 'navOverview', icon: 'grid' },
  { path: 'employees', key: 'navEmployees', icon: 'users' },
  { path: 'approvals', key: 'navApprovals', icon: 'clip' },
  { path: 'tasks', key: 'navTasks', icon: 'list' },
  { path: 'runs', key: 'navRuns', icon: 'act' },
  { path: 'metrics', key: 'navMetrics', icon: 'trend' },
  { path: 'audit', key: 'navAudit', icon: 'hist' },
  { path: 'settings', key: 'navSettings', icon: 'cfg', bottom: true },
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
  /* S-5: user menu — default CLOSED; Esc / outside click dismiss (target §1). */
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLSpanElement | null>(null);

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

  // S-5: dismiss the user menu on Esc or on any click outside the trigger.
  useEffect(() => {
    if (!userMenuOpen) return undefined;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setUserMenuOpen(false);
    };
    const onDown = (ev: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(ev.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [userMenuOpen]);

  // fix B (G8): on narrow screens the rail scrolls horizontally; bring the
  // active entry into view on mount and on every route change so it is never
  // off-screen. jsdom lacks scrollIntoView, hence the typeof guard.
  useEffect(() => {
    const el = document.querySelector('.a2s-nav.is-active');
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }, [location.pathname]);

  const seg = location.pathname.split('/').filter(Boolean);
  const child = seg[1] ?? '';
  const activeKey = L1_ENTRIES.find((e) => e.path === child)?.key ?? 'navOverview';

  const user = useContext(userContext)?.user;
  const accountLabel = user?.user_name
    ? String(user.user_name)
    : t('agentConsole.v2.shellAccountAnonymous');

  const railEntry = (e: (typeof L1_ENTRIES)[number]) => (
    <NavLink
      key={e.path || 'index'}
      end={e.path === ''}
      to={e.path === '' ? '/agent' : `/agent/${e.path}`}
      className={({ isActive }) => `a2s-nav${isActive ? ' is-active' : ''}`}
      title={t(`agentConsole.v2.${e.key}`)}
      aria-label={t(`agentConsole.v2.${e.key}`)}
    >
      <RailIcon name={e.icon} />
      <span className="a2s-nav-label">{t(`agentConsole.v2.${e.key}`)}</span>
    </NavLink>
  );

  return (
    <div className="agent-app" data-theme={theme} data-testid="agent-console-shell">
      <div className="a2-ambient" aria-hidden="true" />
      <div className="a2s-frame">
        <nav className="a2s-rail" aria-label={t('agentConsole.v2.title')}>
          <span className="a2s-logo a2-mono" aria-hidden="true">
            S
          </span>
          {L1_ENTRIES.filter((e) => !e.bottom).map(railEntry)}
          <span className="a2s-rail-sp" aria-hidden="true" />
          {L1_ENTRIES.filter((e) => e.bottom).map(railEntry)}
          <span
            className="a2s-me a2-mono"
            data-testid="agent-v2-rail-avatar"
            title={accountLabel}
            aria-hidden="true"
          >
            {accountLabel.slice(0, 1).toUpperCase()}
          </span>
          <span className="a2s-railhint" aria-hidden="true">
            <RailIcon name="chevScroll" size={13} />
            {t('agentConsole.v2.shellRailHint')}
          </span>
        </nav>
        <div className="a2s-main">
          <header className="a2s-topbar">
            <nav className="a2s-crumb" aria-label="breadcrumb">
              <span className="a2s-crumb-root">{t('agentConsole.v2.title')}</span>
              <RailIcon name="chevR" size={14} />
              <span className="a2s-crumb-current">{t(`agentConsole.v2.${activeKey}`)}</span>
            </nav>
            <span className="a2s-sp" aria-hidden="true" />
            <label className="a2s-search">
              <RailIcon name="search" size={14} />
              <input
                type="text"
                className="a2s-search-input"
                placeholder={t('agentConsole.v2.shellSearchPlaceholder')}
                aria-label={t('agentConsole.v2.shellSearchPlaceholder')}
                onKeyDown={(ev) => {
                  if (ev.key === 'Escape') (ev.target as HTMLInputElement).blur();
                }}
              />
              <span className="a2s-search-kbd a2-mono" aria-hidden="true">
                ⌘K
              </span>
            </label>
            <span
              className="a2s-chip"
              data-testid="agent-v2-env-chip"
              title={t('agentConsole.v2.envPilot')}
            >
              <span className="a2s-chip-dot" aria-hidden="true" />
              {t('agentConsole.v2.envPilot')}
            </span>
            <button
              type="button"
              className="a2s-ico"
              onClick={() => setTheme((v) => (v === 'dark' ? 'light' : 'dark'))}
              aria-label={t('agentConsole.v2.themeToggle')}
              data-testid="agent-v2-theme-toggle"
            >
              {/* icon-only toggle: sun shows in dark (tap → light), moon in light */}
              <RailIcon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
            </button>
            <span className="a2s-ume" data-testid="agent-v2-account" title={accountLabel}>
              <span className="a2s-ava a2-mono" aria-hidden="true">
                {accountLabel.slice(0, 1).toUpperCase()}
              </span>
              <span className="a2s-ume-nm">{accountLabel}</span>
              <RailIcon name="chevD" size={13} />
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
