/**
 * P0-15 W1 shell acceptance surface: 8 L1 routes behind one rail/topbar
 * shell, dark-default theme with persistence, unknown-route 404 page, and
 * the page-level error boundary with retry. Components are exercised through
 * the real Shell; page children are lightweight stubs so no network fires.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// The Shell builds its api bundle from these factories; stub them so mount
// never reaches for localStorage tokens or fetch.
vi.mock('@/controllers/API/agent', () => ({
  createHttpAgentConsoleApi: () => ({}),
}));
vi.mock('@/controllers/API/agentConsoleHermes', () => ({
  createHttpAgentConsoleHermesApi: () => ({}),
}));
vi.mock('@/controllers/API/agentConsoleRuns', () => ({
  createHttpAgentConsoleRunsApi: () => ({}),
}));
vi.mock('@/controllers/API/agentConsoleTrends', () => ({
  createHttpAgentConsoleTrendsApi: () => ({}),
}));

import { AgentConsoleShell, ShellBoundary } from '../Shell';

const stub = (testid: string) => <div data-testid={testid} />;

function renderShell(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/agent" element={<AgentConsoleShell />}>
          <Route index element={stub('page-overview')} />
          <Route path="employees" element={stub('page-employees')} />
          <Route path="approvals" element={stub('page-approvals')} />
          <Route path="tasks" element={stub('page-tasks')} />
          <Route path="runs" element={stub('page-runs')} />
          <Route path="metrics" element={stub('page-metrics')} />
          <Route path="audit" element={stub('page-audit')} />
          <Route path="settings" element={stub('page-settings')} />
          <Route path="*" element={stub('page-404')} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('AgentConsoleShell (W1)', () => {
  it('renders all 8 L1 nav entries and the employees route outlet', () => {
    renderShell('/agent/employees');
    for (const key of [
      'agentConsole.v2.navOverview',
      'agentConsole.v2.navEmployees',
      'agentConsole.v2.navApprovals',
      'agentConsole.v2.navTasks',
      'agentConsole.v2.navRuns',
      'agentConsole.v2.navMetrics',
      'agentConsole.v2.navAudit',
      'agentConsole.v2.navSettings',
    ]) {
      expect(screen.getByLabelText(key)).toBeInTheDocument();
    }
    expect(screen.getByTestId('page-employees')).toBeInTheDocument();
    expect(screen.getByTestId('agent-console-shell')).toBeInTheDocument();
  });

  it('defaults to dark theme and persists the light switch', () => {
    renderShell('/agent');
    const shell = screen.getByTestId('agent-console-shell');
    expect(shell).toHaveAttribute('data-theme', 'dark');
    fireEvent.click(screen.getByLabelText('agentConsole.v2.themeToggle'));
    expect(shell).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem('agentConsole.v2.theme')).toBe('light');
  });

  it('unknown deep links land on the 404 outlet', () => {
    renderShell('/agent/nope-not-a-page');
    expect(screen.getByTestId('page-404')).toBeInTheDocument();
  });

  it('route env chip and account fallback render honest placeholders', () => {
    renderShell('/agent');
    expect(screen.getByTestId('agent-v2-env-chip')).toHaveTextContent(
      'agentConsole.v2.envPilot',
    );
    // The account chip renders the signed-in user name when the host app
    // context provides one, and the anonymous placeholder otherwise. Both
    // outcomes are honest; assert only that a label is present.
    const account = screen.getByTestId('agent-v2-account');
    expect(account.textContent).toBeTruthy();
  });
});

describe('ShellBoundary (W1 error surface)', () => {
  it('catches a crashing child and recovers on retry', () => {
    let boom = true;
    const Bomb = () => {
      if (boom) throw new Error('page exploded');
      return <div data-testid="page-back" />;
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ShellBoundary
        failedCopy="agentConsole.v2.shellPageError"
        failedHint="agentConsole.v2.shellPageErrorHint"
        retryCopy="agentConsole.v2.retry"
      >
        <Bomb />
      </ShellBoundary>,
    );
    expect(screen.getByTestId('agent-v2-page-error')).toBeInTheDocument();
    boom = false;
    fireEvent.click(screen.getByText('agentConsole.v2.retry'));
    expect(screen.getByTestId('page-back')).toBeInTheDocument();
    spy.mockRestore();
  });
});
