/**
 * Slice-1 component tests for the digital-employee console (list shell +
 * overview tab). Data source = deterministic stub fixtures; login/BFF are
 * intentionally NOT exercised here.
 *
 * jsdom has no layout engine, so "no horizontal overflow at 375px" is
 * asserted as DOM/class structure (break-all on long-string cells); the
 * pixel-level check is reported as NOT MEASURED.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  createStubAgentConsoleApi,
  DEMO_FIXTURES,
  type AgentConsoleApi,
  type EmployeeList,
} from '@/controllers/API/agent';
import { AgentListPage } from '../AgentListPage';
import { AgentOverviewTab } from '../AgentOverviewTab';
import { AgentPage } from '../index';
import { lifecycleTagColor, StatusChip } from '../StatusChip';

afterEach(cleanup);

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
});
