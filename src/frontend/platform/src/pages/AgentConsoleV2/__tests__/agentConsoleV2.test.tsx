/**
 * S10b-v2-1 console v2 P1 surface tests: token shell + real-data list,
 * detail (identity/version/grants/quota pending states), approvals section,
 * theme persistence, and the honest no-fake-metrics / no-snapshotRef rules.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { userContext } from '@/contexts/userContext';
import type { AgentConsoleApi } from '@/controllers/API/agent';
import type {
  AgentApprovalsApi,
  Approval,
} from '@/controllers/API/agentConsoleApprovals';

import { agentConsoleV2Enabled } from '../flag';
import { AgentConsoleV2Page } from '../AgentConsoleV2Page';

const SNAP = 'SNAP-MUST-NOT-LEAK';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

vi.mock('@/components/bs-ui/message', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

function consoleApi(over: Record<string, unknown> = {}): AgentConsoleApi {
  return {
    listEmployees: vi.fn().mockResolvedValue({
      items: [
        { employeeId: 'emp_1', name: 'Koi Claw', title: 'assistant', lifecycleState: 'active', ownerUserId: 'opsadmin', updatedAt: '2026-11-13T00:00:00Z' },
        { employeeId: 'emp_2', name: 'Inspector', title: 'qa', lifecycleState: 'paused', ownerUserId: 'opsadmin', updatedAt: '2026-11-13T00:00:00Z' },
      ],
    }),
    countPendingApprovals: vi.fn().mockResolvedValue({ ok: true, data: { count: 5 } }),
    getEmployee: vi.fn().mockResolvedValue({
      ok: true,
      data: { id: 'emp_1', tenantId: 't', name: 'Koi Claw', title: 'assistant', lifecycleState: 'active', currentVersionId: 'ver_1', ownerUserId: 'opsadmin', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-11-13T00:00:00Z' },
    }),
    getEffectiveConfig: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        employee: { id: 'emp_1', tenantId: 't', name: 'Koi Claw', title: 'assistant', lifecycleState: 'active', currentVersionId: 'ver_1', ownerUserId: 'opsadmin', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-11-13T00:00:00Z' },
        version: { id: 'ver_1', employeeId: 'emp_1', versionNo: 7, jobDescription: 'jd', grantIds: ['g1'], responsePolicy: 'strict', memoryScope: 'none' },
        grants: [{ id: 'g1', scopeType: 'tool', resourceSelector: 'search.*', actions: ['invoke'], source: 'grant', expiresAt: null }],
        resolvedAt: '2026-11-13T00:00:00Z',
        snapshotRef: SNAP,
      },
    }),
    ...over,
  } as unknown as AgentConsoleApi;
}

function approvalRow(id: string, over: Partial<Approval> = {}): Approval {
  return {
    approvalId: id, tenantId: 't', type: 'business_action', action: 'employee.version.create',
    runId: null, binding: { subjectType: 'run', subjectId: 'sub_other', changeKind: 'k', targetHash: 'th', effectiveFrom: null },
    argsDigest: null, status: 'pending', riskLevel: 'high',
    requestedBy: { type: 'employee', id: 'emp_1' }, approvers: [{ userId: 'human:1', role: 'owner' }],
    requiredApprovals: 1, decisions: [],
    expiresAt: '2099-01-01T00:00:00Z', remainingSeconds: 86400, ttlSeconds: 86400,
    createdAt: '2026-01-01T00:00:00Z', ...over,
  };
}

function approvalsApi(rows: Approval[]): AgentApprovalsApi {
  return {
    listApprovals: vi.fn().mockResolvedValue({ items: rows }),
    getApproval: vi.fn().mockResolvedValue(rows[0]),
  } as unknown as AgentApprovalsApi;
}

function renderV2(api: AgentConsoleApi, ap: AgentApprovalsApi, env = '1') {
  vi.stubEnv('VITE_AGENT_CONSOLE_V2', env);
  return render(
    <userContext.Provider
      value={{ user: { user_id: 1, web_menu: ['admin', 'agent'] }, setUser: vi.fn(), savedComponents: [], addSavedComponent: vi.fn(), checkComponentsName: vi.fn(), delComponent: vi.fn() } as never}
    >
      <AgentConsoleV2Page consoleApi={api} approvalsApi={ap} />
    </userContext.Provider>,
  );
}

describe('agentConsoleV2 flag', () => {
  it('is a build-time constant gated by the exact value 1', () => {
    vi.stubEnv('VITE_AGENT_CONSOLE_V2', '1');
    expect(agentConsoleV2Enabled()).toBe(true);
    vi.stubEnv('VITE_AGENT_CONSOLE_V2', '0');
    expect(agentConsoleV2Enabled()).toBe(false);
    vi.stubEnv('VITE_AGENT_CONSOLE_V2', undefined);
    expect(agentConsoleV2Enabled()).toBe(false);
  });
});

describe('agentConsoleV2 shell + list', () => {
  it('renders rail + KPIs computed from real data (no fake numbers)', async () => {
    window.localStorage.removeItem('agentConsole.v2.theme');
    renderV2(consoleApi(), approvalsApi([]));
    await screen.findByText('Koi Claw');
    expect(screen.getByText('Inspector')).toBeInTheDocument();
    // on-duty this page = 1 (only emp_1 active); pending mine = 5 from AP4
    const nums = document.querySelectorAll('.a2-kpi-num');
    expect(nums[0].textContent).toBe('1');
    expect(nums[1].textContent).toBe('5');
    // trend block is an explicit pending state; no svg/curves anywhere
    expect(screen.getByTestId('agent-v2-trend-pending').textContent).toBe('agentConsole.v2.emptyTrend');
    expect(document.querySelectorAll('svg').length).toBe(0);
  });

  it('lists real employees via E11 keyword passthrough', async () => {
    const api = consoleApi();
    renderV2(api, approvalsApi([]));
    await screen.findByText('Koi Claw');
    fireEvent.change(screen.getByLabelText('agentConsole.v2.search'), { target: { value: 'insp' } });
    fireEvent.click(screen.getByText('agentConsole.v2.query'));
    await waitFor(() => {
      expect((api.listEmployees as ReturnType<typeof vi.fn>).mock.calls.some((c) => (c[0] ?? {}).keyword === 'insp')).toBe(true);
    });
  });

  it('shows pending (not zero) KPI when AP4 count fails, and never an error page', async () => {
    const api = consoleApi({ countPendingApprovals: vi.fn().mockRejectedValue(new Error('x')) });
    renderV2(api, approvalsApi([]));
    await screen.findByText('Koi Claw');
    const nums = document.querySelectorAll('.a2-kpi-num');
    expect(nums[1].textContent).toBe('—');
  });

  it('shows the digit 1 on first screen when real pending count is 1', async () => {
    const api = consoleApi({ countPendingApprovals: vi.fn().mockResolvedValue({ ok: true, data: { count: 1 } }) });
    renderV2(api, approvalsApi([]));
    await screen.findByText('Koi Claw');
    const nums = document.querySelectorAll('.a2-kpi-num');
    expect(nums[1].textContent).toBe('1');
  });

  it('deep-link approvals section fetches the queue on mount without a click', async () => {
    const list = vi.fn().mockResolvedValue({ items: [] });
    const base = approvalsApi([]) as unknown as Record<string, unknown>;
    const api = consoleApi();
    render(
      <userContext.Provider
        value={{ user: { user_id: 1, web_menu: ['admin', 'agent'] }, setUser: vi.fn(), savedComponents: [], addSavedComponent: vi.fn(), checkComponentsName: vi.fn(), delComponent: vi.fn() } as never}
      >
        <AgentConsoleV2Page consoleApi={api} approvalsApi={{ ...base, listApprovals: list } as never} initialSection="appr" />
      </userContext.Provider>,
    );
    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ assignee: 'human:1', status: 'pending', limit: 20 }),
      ),
    );
  });

  it('renders object-shaped E5 resource selectors without crashing', async () => {
    const api = consoleApi({
      getEffectiveConfig: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          employee: { id: 'emp_1', tenantId: 't', name: 'Koi Claw', title: 'assistant', lifecycleState: 'active', currentVersionId: 'ver_1', ownerUserId: 'opsadmin', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-11-13T00:00:00Z' },
          version: { id: 'ver_1', employeeId: 'emp_1', versionNo: 2, effectiveFrom: '2026-11-13T06:30:00.000Z' },
          grants: [{ id: 'gr_1', employeeId: 'emp_1', scopeType: 'business_api', resourceSelector: { type: 'channel_event' }, actions: ['execute'], source: 'role', expiresAt: null }],
          resolvedAt: '2026-11-13T11:31:27.558Z',
          snapshotRef: SNAP,
        },
      }),
    });
    renderV2(api, approvalsApi([]));
    const trs = await screen.findAllByTestId('agent-v2-row');
    fireEvent.click(trs[0].querySelector('button') as Element);
    const chip = await screen.findByText('channel_event · execute');
    expect(chip).toBeTruthy();
    expect(screen.queryByText(SNAP)).toBeNull();
  });

  it('empty list state is honest', async () => {
    const api = consoleApi({ listEmployees: vi.fn().mockResolvedValue({ items: [] }) });
    renderV2(api, approvalsApi([]));
    await screen.findByText('agentConsole.v2.emptyList');
  });

  it('list query failure is an error state, never a fake empty', async () => {
    const api = consoleApi({ listEmployees: vi.fn().mockRejectedValue(new Error('boom')) });
    renderV2(api, approvalsApi([]));
    await screen.findByText('agentConsole.v2.errorQuery');
    expect(screen.queryByText('agentConsole.v2.emptyList')).toBeNull();
  });
});

describe('agentConsoleV2 detail', () => {
  it('identity + current version + grants blast radius from E5; snapshotRef never rendered; chain is pending', async () => {
    const api = consoleApi();
    renderV2(api, approvalsApi([]));
    await screen.findByText('Koi Claw');
    fireEvent.click(screen.getAllByText('agentConsole.v2.detail')[0]);
    await screen.findByText('agentConsole.v2.grantsBlast');
    expect(document.querySelector('[data-testid="agent-v2-identity"]')?.textContent).toContain('Koi Claw');
    // current version 7 rendered from E5.version.versionNo
    expect(document.querySelector('[data-testid="agent-v2-version"]')?.textContent).toContain('v7');
    // chain historical data explicitly pending (no GET versions endpoint exists)
    expect(document.querySelector('[data-testid="agent-v2-chain-pending"]')?.textContent).toBe('agentConsole.v2.emptyChain');
    // grants chips real
    expect(document.querySelector('[data-testid="agent-v2-blast"]')?.textContent).toContain('search.*');
    // quota: pending note, never a fabricated number
    expect(document.querySelector('[data-testid="agent-v2-quota"]')?.textContent).toContain('agentConsole.v2.emptyBudget');
    // snapshotRef must never appear anywhere
    expect(document.body.innerHTML).not.toContain(SNAP);
  });

  it('detail config failure degrades only its blocks', async () => {
    const api = consoleApi({ getEffectiveConfig: vi.fn().mockRejectedValue(new Error('e')) });
    renderV2(api, approvalsApi([]));
    await screen.findByText('Koi Claw');
    fireEvent.click(screen.getAllByText('agentConsole.v2.detail')[0]);
    await waitFor(() => {
      const blast = document.querySelector('[data-testid="agent-v2-blast"]');
      expect(blast?.textContent).toContain('agentConsole.v2.errorQuery');
    });
  });
});

describe('agentConsoleV2 approvals section', () => {
  it('rail approvals opens AP4 self queue with zero write affordances', async () => {
    const rows = [approvalRow('ap_v2_1')];
    const api = consoleApi();
    renderV2(api, approvalsApi(rows));
    await screen.findByText('Koi Claw');
    fireEvent.click(screen.getByLabelText('agentConsole.v2.navApprovals'));
    await screen.findByText('ap_v2_1');
    const labels = [...document.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(labels.some((l) => /批准|驳回|撤回|提交决策|approve/i.test(l ?? ''))).toBe(false);
    expect(document.querySelectorAll('textarea').length).toBe(0);
  });

  it('approval detail reuses ApprovalDetail (AP3) without new endpoints', async () => {
    const rows = [approvalRow('ap_v2_2')];
    const ap = approvalsApi(rows);
    renderV2(consoleApi(), ap);
    await screen.findByText('Koi Claw');
    fireEvent.click(screen.getByLabelText('agentConsole.v2.navApprovals'));
    await screen.findByText('ap_v2_2');
    fireEvent.click(screen.getByText('agentConsole.v2.detail'));
    await waitFor(() => {
      expect(document.querySelector('[data-testid="agent-approval-detail"]')).not.toBeNull();
    });
    expect((ap.getApproval as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('ap_v2_2');
    expect(document.querySelectorAll('textarea').length).toBe(0);
  });

  it('no chat/message input exists anywhere in P1', async () => {
    renderV2(consoleApi(), approvalsApi([]));
    await screen.findByText('Koi Claw');
    expect(document.querySelectorAll('input[type=text][name*=chat], textarea').length).toBe(0);
  });
});

describe('agentConsoleV2 theme', () => {
  it('defaults dark, toggles to light, persists, and rehydrates', async () => {
    window.localStorage.removeItem('agentConsole.v2.theme');
    const { unmount } = renderV2(consoleApi(), approvalsApi([]));
    const root = await screen.findByTestId('agent-console-v2');
    expect(root?.getAttribute('data-theme')).toBe('dark');
    fireEvent.click(screen.getByLabelText('agentConsole.v2.themeToggle'));
    expect(root?.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem('agentConsole.v2.theme')).toBe('light');
    unmount();
    renderV2(consoleApi(), approvalsApi([]));
    const rehydrated = await screen.findByTestId('agent-console-v2');
    expect(rehydrated.getAttribute('data-theme')).toBe('light');
  });
});
