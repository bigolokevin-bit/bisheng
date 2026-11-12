/**
 * Slice-1 component tests for the digital-employee console (list shell +
 * overview tab). Data source = deterministic stub fixtures; login/BFF are
 * intentionally NOT exercised here.
 *
 * jsdom has no layout engine, so "no horizontal overflow at 375px" is
 * asserted as DOM/class structure (break-all on long-string cells); the
 * pixel-level check is reported as NOT MEASURED.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  createHttpAgentConsoleApi,
  createStubAgentConsoleApi,
  DEMO_FIXTURES,
  AuthError,
  UpstreamError,
  type AgentConsoleApi,
  type AuditList,
  type EmployeeList,
  type RunList,
  type TaskList,
} from '@/controllers/API/agent';
import { DEMO_RUN1 } from '@/controllers/API/agentConsoleRead';
import { AgentListPage } from '../AgentListPage';
import { AgentOverviewTab } from '../AgentOverviewTab';
import { AgentPage } from '../index';
import { lifecycleTagColor, StatusChip } from '../StatusChip';
import { AgentTasksTab } from '../AgentTasksTab';
import { AgentRunsTab } from '../AgentRunsTab';
import { AgentAuditTab } from '../AgentAuditTab';

afterEach(cleanup);

/** Read-only guard: the new tabs must never expose a write affordance. */
const expectNoWriteButtons = () => {
  const buttons = Array.from(document.querySelectorAll('button')).map(
    (b) => b.textContent ?? '',
  );
  expect(
    buttons.some((label) =>
      /create|delete|edit|publish|stop|start/i.test(label),
    ),
  ).toBe(false);
};

const EMP1 = '01DEMOEMPLOYEE000000000001';
const EMP2 = '01DEMOEMPLOYEE000000000002';
const LONG_NAME =
  'ExtremelyLongEmployeeDisplayNameUsedToVerifyThatNarrowViewportRowsDoNotOverflowHorizontallyStubDemo';

const stub = () => createStubAgentConsoleApi(DEMO_FIXTURES);

describe('AgentListPage', () => {
  it('shows a loading state, then renders E11 rows (stub data)', async () => {
    const { container } = render(<AgentListPage api={stub()} />);
    expect(
      container.querySelector('[data-testid="agent-list-loading"]'),
    ).toBeTruthy();
    await screen.findByText('Koi Claw (stub demo)');
    expect(screen.getByText('Inspector Two (stub demo)')).toBeInTheDocument();
    expect(
      container.querySelector('[data-testid="agent-list-loading"]'),
    ).toBeFalsy();
  });

  it('renders the empty state when fixtures have no employees', async () => {
    const emptyApi = createStubAgentConsoleApi({ employees: [] });
    render(<AgentListPage api={emptyApi} />);
    await screen.findByText('agentConsole.list.empty');
  });

  it('renders the error state with a retry action when the api throws', async () => {
    const failing: AgentConsoleApi = {
      ...stub(),
      listEmployees: async (): Promise<EmployeeList> => {
        throw new Error('stub failure');
      },
    };
    render(<AgentListPage api={failing} />);
    await screen.findByText('agentConsole.list.error');
    expect(screen.getByText('agentConsole.list.retry')).toBeInTheDocument();
  });

  it('filters rows by keyword (E11 semantics, case-insensitive)', async () => {
    const { container } = render(<AgentListPage api={stub()} />);
    await screen.findByText('Koi Claw (stub demo)');
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'claw' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.queryByText('Inspector Two (stub demo)')).toBeNull(),
    );
    expect(screen.getByText('Koi Claw (stub demo)')).toBeInTheDocument();
  });

  it('loads the next cursor page via the load-more placeholder', async () => {
    const { getByRole, queryByText } = render(
      <AgentListPage api={stub()} pageSize={2} />,
    );
    await screen.findByText('Koi Claw (stub demo)');
    expect(queryByText(LONG_NAME)).toBeNull();
    fireEvent.click(getByRole('button', { name: 'agentConsole.list.loadMore' }));
    await screen.findByText(LONG_NAME);
    expect(
      queryByText('agentConsole.list.loadMore' as string),
    ).toBeNull();
  });

  it('wraps long names with break-all cells (375 overflow guard, DOM-level)', async () => {
    const { container } = render(<AgentListPage api={stub()} />);
    const longCell = await screen.findByText(LONG_NAME);
    expect(longCell.className).toContain('break-all');
    expect(container.querySelector('table')).toBeTruthy();
  });
});

describe('StatusChip (SS5.7 mapping)', () => {
  it('maps lifecycle states to frozen semantic tag colors', () => {
    expect(lifecycleTagColor('active')).toBe('success');
    expect(lifecycleTagColor('paused')).toBe('warning');
    expect(lifecycleTagColor('suspended')).toBe('warning');
    expect(lifecycleTagColor('archived')).toBe('default');
  });

  it('renders a Tag with the mapped semantic class token', () => {
    const { container } = render(<StatusChip state="active" />);
    expect(container.textContent).toBe('agentConsole.lifecycle.active');
    expect(container.innerHTML).toMatch(/success/);
  });
});

describe('AgentOverviewTab', () => {
  it('shows key fields from the stub bundle (name, v3, workstation line, grants, cost note)', async () => {
    render(<AgentOverviewTab api={stub()} employeeId={EMP1} />);
    await screen.findByText('v3');
    expect(screen.getAllByText('Koi Claw (stub demo)').length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText(/active · wechat/)).toBeTruthy();
    expect(screen.getByText('agentConsole.overview.pendingApprovals')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('space:store-visit')).toBeInTheDocument();
    expect(screen.getByText('agentConsole.cost.pending')).toBeInTheDocument();
    // cost red line: no currency numbers anywhere
    expect(screen.queryByText(/\$\s?\d|US\$/)).toBeNull();
  });

  it('degrades per block when config/workstations are missing', async () => {
    render(<AgentOverviewTab api={stub()} employeeId={EMP2} />);
    await screen.findByText('agentConsole.workstation.unavailable');
    expect(screen.getByText('agentConsole.overview.versionUnknown')).toBeInTheDocument();
    expect(screen.getByText('agentConsole.overview.noGrants')).toBeInTheDocument();
    expect(screen.getByText('agentConsole.overview.pendingApprovals')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('shows the workstation empty copy when the list exists but is empty', async () => {
    const api = createStubAgentConsoleApi({
      ...DEMO_FIXTURES,
      workstations: { ...DEMO_FIXTURES.workstations, [EMP1]: [] },
    });
    render(<AgentOverviewTab api={api} employeeId={EMP1} />);
    await screen.findByText('agentConsole.workstation.empty');
  });
});

describe('AgentPage shell', () => {
  it('navigates list -> overview -> back without any write action', async () => {
    render(<AgentPage api={stub()} />);
    await screen.findByText('Koi Claw (stub demo)');
    fireEvent.click(screen.getAllByText('agentConsole.list.detail')[0]);
    await screen.findByText('v3');
    fireEvent.click(screen.getByText('agentConsole.detail.back'));
    await screen.findByText('Inspector Two (stub demo)');
    // read-only guard: no create/edit/delete buttons anywhere
    const buttons = Array.from(document.querySelectorAll('button')).map(
      (b) => b.textContent ?? '',
    );
    expect(
      buttons.some((label) =>
        /create|delete|edit|publish|stop|start/i.test(label),
      ),
    ).toBe(false);
  });

  it('detail view mounts the four tabs and switches to tasks lazily', async () => {
    const base = stub();
    // Inactive tabs are not mounted, so tasks must not be fetched yet.
    const listTasks = vi.fn(base.listTasks);
    render(<AgentPage api={{ ...base, listTasks }} />);
    await screen.findByText('Koi Claw (stub demo)');
    fireEvent.click(screen.getAllByText('agentConsole.list.detail')[0]);
    expect(screen.getByRole('tab', { name: 'agentConsole.tabs.overview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'agentConsole.tabs.tasks' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'agentConsole.tabs.runs' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'agentConsole.tabs.audit' })).toBeInTheDocument();
    expect(listTasks).not.toHaveBeenCalled();
    // Radix tab triggers activate on mouseDown (repo idiom:
    // dshPageNavigation.test.tsx); a bare click leaves aria-selected unchanged.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'agentConsole.tabs.tasks' }), {
      button: 0,
      ctrlKey: false,
    });
    await screen.findByText('Draft the store-visit script for the demo group');
    expect(listTasks).toHaveBeenCalledTimes(1);
    expect(
      listTasks.mock.calls[0][0].assignee,
    ).toBe(`employee:${EMP1}`);
    expectNoWriteButtons();
  });
});

describe('AgentTasksTab (read-only T5)', () => {
  it('renders stub task rows with frozen §5.7 status/priority labels', async () => {
    render(<AgentTasksTab api={stub()} employeeId={EMP1} />);
    await screen.findByText('Draft the store-visit script for the demo group');
    expect(
      screen.getByText('Collect review notes for the published digest'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Prepare the weekly channel digest'),
    ).toBeInTheDocument();
    expect(screen.getByText('agentConsole.tasks.status.open')).toBeInTheDocument();
    expect(screen.getByText('agentConsole.tasks.status.blocked')).toBeInTheDocument();
    expect(screen.getByText('agentConsole.tasks.priority.high')).toBeInTheDocument();
  });

  it('expands a row to progressNote / statusReason / source.channel', async () => {
    render(<AgentTasksTab api={stub()} employeeId={EMP1} />);
    await screen.findByText('Draft the store-visit script for the demo group');
    fireEvent.click(screen.getAllByText('agentConsole.tasks.expand')[1]);
    expect(
      await screen.findByText('Second draft shared with the reviewer'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('agentConsole.tasks.progressNote'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('agentConsole.tasks.sourceChannel'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('agentConsole.tasks.collapse')[0]);
    expect(
      screen.queryByText('Second draft shared with the reviewer'),
    ).toBeNull();
  });

  it('appends the next cursor page via the load-more button', async () => {
    render(<AgentTasksTab api={stub()} employeeId={EMP1} pageSize={2} />);
    await screen.findByText('Draft the store-visit script for the demo group');
    expect(screen.queryByText('Prepare the weekly channel digest')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'agentConsole.list.loadMore' }));
    await screen.findByText('Prepare the weekly channel digest');
    expect(screen.queryByText('agentConsole.list.loadMore')).toBeNull();
  });

  it('shows the empty state when fixtures have no tasks', async () => {
    const emptyApi = createStubAgentConsoleApi({ ...DEMO_FIXTURES, tasks: [] });
    render(<AgentTasksTab api={emptyApi} employeeId={EMP1} />);
    await screen.findByText('agentConsole.tasks.empty');
  });

  it('shows error + retry when listTasks fails', async () => {
    const failing: AgentConsoleApi = {
      ...stub(),
      listTasks: async (): Promise<TaskList> => {
        throw new UpstreamError('agent.http.502');
      },
    };
    render(<AgentTasksTab api={failing} employeeId={EMP1} />);
    await screen.findByText('agentConsole.tasks.error');
    expect(screen.getByText('agent.http.502')).toBeInTheDocument();
    expect(screen.getByText('agentConsole.list.retry')).toBeInTheDocument();
  });

  it('shows the re-login view when listTasks throws AuthError', async () => {
    const authApi: AgentConsoleApi = {
      ...stub(),
      listTasks: async (): Promise<TaskList> => {
        throw new AuthError();
      },
    };
    render(<AgentTasksTab api={authApi} employeeId={EMP1} />);
    await screen.findByText('agentConsole.auth.expired');
    expect(screen.getByText('agentConsole.auth.relogin')).toBeInTheDocument();
  });

  it('is read-only: no create/edit/delete affordances', async () => {
    render(<AgentTasksTab api={stub()} employeeId={EMP1} />);
    await screen.findByText('Draft the store-visit script for the demo group');
    expectNoWriteButtons();
  });
});

describe('AgentRunsTab (read-only R5)', () => {
  it('renders stub runs, short runId, cost always with the basis label', async () => {
    const { container } = render(<AgentRunsTab api={stub()} employeeId={EMP1} />);
    // §5.6: every figure carries its 口径 annotation in the same cell
    // (combined leaf), so the matchers below are deliberately regexes.
    await screen.findByText(/0\.42\s+agentConsole\.runs\.costBasis/);
    expect(screen.getByText(/0\.00\s+agentConsole\.runs\.costBasis/)).toBeInTheDocument();
    expect(screen.getByText(/0\.05\s+agentConsole\.runs\.costBasis/)).toBeInTheDocument();
    expect(
      screen.getByText('01DEMORUN000000000000000001'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('01DEMORUN000000000000000002'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('01DEMORUN000000000000000003'),
    ).toBeInTheDocument();
    // times render as one cell of three text nodes; match the row text
    expect(container.textContent).toMatch(
      /2026-11-11 01:00:00\s*→\s*2026-11-11 01:04:30/,
    );
    // reasonCode is次屏: hidden until the row is expanded
    expect(screen.queryByText('upstream.timeout')).toBeNull();
    expect(screen.getByText('agentConsole.runs.status.failed')).toBeInTheDocument();
    // other employee's cancelled run must not leak through the employee filter
    expect(screen.queryByText('01DEMORUN000000000000000004')).toBeNull();
  });

  it('appends the next cursor page via the load-more button', async () => {
    render(<AgentRunsTab api={stub()} employeeId={EMP1} pageSize={2} />);
    await screen.findByText(/0\.42\s+agentConsole\.runs\.costBasis/);
    expect(screen.queryByText(/0\.05\s+agentConsole\.runs\.costBasis/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'agentConsole.list.loadMore' }));
    await screen.findByText(/0\.05\s+agentConsole\.runs\.costBasis/);
    expect(
      screen.getByText('01DEMORUN000000000000000003'),
    ).toBeInTheDocument();
    expect(screen.queryByText('agentConsole.list.loadMore')).toBeNull();
    // expand the failed run (second row) to reveal its reasonCode
    fireEvent.click(
      screen.getAllByRole('button', { name: 'agentConsole.runs.expand' })[1],
    );
    await screen.findByText('upstream.timeout');
  });

  it('shows the empty state when fixtures have no runs', async () => {
    const emptyApi = createStubAgentConsoleApi({ ...DEMO_FIXTURES, runs: [] });
    render(<AgentRunsTab api={emptyApi} employeeId={EMP1} />);
    await screen.findByText('agentConsole.runs.empty');
  });

  it('shows error + retry when listRuns fails', async () => {
    const failing: AgentConsoleApi = {
      ...stub(),
      listRuns: async (): Promise<RunList> => {
        throw new Error('stub failure');
      },
    };
    render(<AgentRunsTab api={failing} employeeId={EMP1} />);
    await screen.findByText('agentConsole.runs.error');
    expect(screen.getByText('agentConsole.list.retry')).toBeInTheDocument();
  });

  it('is read-only: no create/edit/delete affordances', async () => {
    render(<AgentRunsTab api={stub()} employeeId={EMP1} />);
    await screen.findByText(/0\.42\s+agentConsole\.runs\.costBasis/);
    expectNoWriteButtons();
  });
});

describe('AgentAuditTab (read-only A3, filter derived from latest run)', () => {
  it('derives the runId filter from the most recent run and never queries unfiltered', async () => {
    const base = stub();
    const listAudit = vi.fn(base.listAudit);
    render(<AgentAuditTab api={{ ...base, listAudit }} employeeId={EMP1} />);
    await screen.findByText('message.propose');
    expect(listAudit).toHaveBeenCalledWith(
      expect.objectContaining({ runId: DEMO_RUN1 }),
    );
    // The employee identity appears in two rows (propose actor + denied
    // file-write actor), so the assertion counts matches instead of pinning one.
    expect(screen.getAllByText('employee · 01DEMOEMPLOYEE000000000001').length).toBe(2);
    expect(screen.getByText('workspace · ws_demo_1')).toBeInTheDocument();
    expect(
      screen.getAllByText('employee · 01DEMOEMPLOYEE000000000001').length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('workspace · ws_demo_1')).toBeInTheDocument();
    expect(screen.getByText('agentConsole.audit.outcome.denied')).toBeInTheDocument();
    // the failed run's event (run.cancel, DEMO_RUN2) must not leak in
    expect(screen.queryByText('run.cancel')).toBeNull();
  });

  it('with no runs, shows empty WITHOUT calling listAudit', async () => {
    const base = createStubAgentConsoleApi({ ...DEMO_FIXTURES, runs: [] });
    const listAudit = vi.fn(base.listAudit);
    render(<AgentAuditTab api={{ ...base, listAudit }} employeeId={EMP1} />);
    await screen.findByText('agentConsole.audit.empty');
    expect(listAudit).not.toHaveBeenCalled();
  });

  it('appends the next cursor page via the load-more button', async () => {
    const base = stub();
    render(<AgentAuditTab api={base} employeeId={EMP1} pageSize={2} />);
    await screen.findByText('message.propose');
    expect(screen.queryByText('file.write')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'agentConsole.list.loadMore' }));
    await screen.findByText('file.write');
  });

  it('shows error + retry when the prelude run query fails', async () => {
    const failing: AgentConsoleApi = {
      ...stub(),
      listRuns: async (): Promise<RunList> => {
        throw new UpstreamError('console.upstream_down');
      },
    };
    render(<AgentAuditTab api={failing} employeeId={EMP1} />);
    await screen.findByText('agentConsole.audit.error');
    expect(screen.getByText('console.upstream_down')).toBeInTheDocument();
    expect(screen.getByText('agentConsole.list.retry')).toBeInTheDocument();
  });

  it('shows the re-login view when listAudit throws AuthError', async () => {
    const authApi: AgentConsoleApi = {
      ...stub(),
      listAudit: async (): Promise<AuditList> => {
        throw new AuthError();
      },
    };
    render(<AgentAuditTab api={authApi} employeeId={EMP1} />);
    await screen.findByText('agentConsole.auth.expired');
    expect(screen.getByText('agentConsole.auth.relogin')).toBeInTheDocument();
  });

  it('is read-only: no create/edit/delete affordances', async () => {
    render(<AgentAuditTab api={stub()} employeeId={EMP1} />);
    await screen.findByText('message.propose');
    expectNoWriteButtons();
  });
});

describe('agent console HTTP listAudit guard', () => {
  it('never sends an unfiltered audit query (console.missing_filter)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const api = createHttpAgentConsoleApi({ getToken: () => null });
      await expect(api.listAudit({ limit: 50 })).rejects.toThrow(
        'console.missing_filter',
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ items: [] }),
      } as unknown as Response);
      const res = await api.listAudit({ runId: 'r1', limit: 50 });
      expect(res.items).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
