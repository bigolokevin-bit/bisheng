/**
 * S10b workspace-bind page tests (l4-console-workspace-bind).
 * Behavior is driven through injected api fakes; the VITE flag is stubbed per
 * render. URLs/params are asserted exactly (limit=20, assignee literal).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { userContext } from '@/contexts/userContext';
import { UpstreamError } from '@/controllers/API/agent';
import type { AgentConsoleApi } from '@/controllers/API/agent';
import type {
  AgentApprovalsApi,
  Approval,
} from '@/controllers/API/agentConsoleApprovals';

import { AgentWorkspaceBind, isValidRunId } from '../AgentWorkspaceBind';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const ADMIN = { user_id: 42, web_menu: ['admin', 'agent'] };
const VIEWER = { user_id: 42, web_menu: ['agent'] };

function makeApproval(approvalId: string, p: { runId?: string; subjectId?: string; digest?: string | null } = {}): Approval {
  return {
    approvalId,
    tenantId: 'tenant_demo',
    type: 'business_action',
    action: 'run.advance',
    runId: p.runId ?? null,
    binding: {
      subjectType: 'run',
      subjectId: p.subjectId ?? 'sub_other',
      changeKind: 'run_advance',
      targetHash: 'th_demo',
      effectiveFrom: null,
    },
    argsDigest: p.digest ?? null,
    status: 'pending',
    riskLevel: 'high',
    requestedBy: { type: 'employee', id: '01DEMOEMPLOYEE000000000001' },
    approvers: [{ userId: 'human:42', role: 'owner' }],
    requiredApprovals: 1,
    decisions: [],
    expiresAt: '2099-01-01T00:00:00Z',
    remainingSeconds: 86400,
    ttlSeconds: 86400,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

function renderBind(
  user: Record<string, unknown>,
  consoleApi: Partial<AgentConsoleApi>,
  approvalsApi: Partial<AgentApprovalsApi>,
  env?: string,
) {
  vi.stubEnv('VITE_AGENT_WORKSPACE_BIND', env ?? '1');
  return render(
    <userContext.Provider
      value={
        {
          user,
          setUser: vi.fn(),
          savedComponents: [],
          addSavedComponent: vi.fn(),
          checkComponentsName: vi.fn(),
          delComponent: vi.fn(),
        } as never
      }
    >
      <AgentWorkspaceBind
        consoleApi={consoleApi as AgentConsoleApi}
        approvalsApi={approvalsApi as AgentApprovalsApi}
      />
    </userContext.Provider>,
  );
}

function fillAndQuery(runId: string) {
  const input = screen.getByLabelText('agentConsole.workspace.runIdLabel');
  fireEvent.change(input, { target: { value: runId } });
  fireEvent.click(screen.getByText('agentConsole.workspace.query'));
}

describe('agent workspace bind (S10b)', () => {
  it('renders nothing and issues no requests when the flag is off', () => {
    const listTasks = vi.fn();
    const listApprovals = vi.fn();
    const { container } = renderBind(ADMIN, { listTasks }, { listApprovals }, '0');
    expect(container.textContent).toBe('');
    expect(listTasks).not.toHaveBeenCalled();
    expect(listApprovals).not.toHaveBeenCalled();
  });

  it('shows the permission notice without admin web_menu and issues no requests', () => {
    const listTasks = vi.fn();
    const listApprovals = vi.fn();
    renderBind(VIEWER, { listTasks }, { listApprovals });
    expect(screen.getByText('agentConsole.workspace.noPermission')).toBeInTheDocument();
    expect(listTasks).not.toHaveBeenCalled();
    expect(listApprovals).not.toHaveBeenCalled();
  });

  it('queries tasks and approvals with the exact declared parameters', async () => {
    const listTasks = vi.fn().mockResolvedValue({ items: [] });
    const listApprovals = vi.fn().mockResolvedValue({ items: [] });
    renderBind(ADMIN, { listTasks }, { listApprovals });
    fillAndQuery('run_ok1');
    await waitFor(() => expect(listTasks).toHaveBeenCalled());
    expect(listTasks.mock.calls[0][0]).toEqual({ runId: 'run_ok1', limit: 20 });
    expect(listApprovals.mock.calls[0][0]).toEqual({
      assignee: 'human:42',
      status: 'pending',
      limit: 20,
    });
  });

  it('rejects illegal run ids client-side without any request', () => {
    const listTasks = vi.fn();
    const listApprovals = vi.fn();
    renderBind(ADMIN, { listTasks }, { listApprovals });
    for (const bad of ['', 'run/x', 'a b', 'x'.repeat(65), ' run_1 ']) {
      fillAndQuery(bad);
      expect(screen.getByText('agentConsole.workspace.invalidRunId')).toBeInTheDocument();
    }
    expect(listTasks).not.toHaveBeenCalled();
    expect(listApprovals).not.toHaveBeenCalled();
    expect(isValidRunId('run_ok-1')).toBe(true);
    expect(isValidRunId(' run_ok ')).toBe(false);
  });

  it('shows the linked-tasks empty state on a successful empty query', async () => {
    const listTasks = vi.fn().mockResolvedValue({ items: [] });
    renderBind(ADMIN, { listTasks }, { listApprovals: vi.fn().mockResolvedValue({ items: [] }) });
    fillAndQuery('run_empty');
    await waitFor(() =>
      expect(screen.getByTestId('workspace-tasks-empty')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('workspace-tasks-error')).toBeNull();
  });

  it('treats 400 console.missing_filter as a failure, never as an empty success', async () => {
    const listTasks = vi.fn().mockRejectedValue(new UpstreamError('console.missing_filter'));
    renderBind(ADMIN, { listTasks }, { listApprovals: vi.fn().mockResolvedValue({ items: [] }) });
    fillAndQuery('run_denied');
    await waitFor(() => expect(screen.getByTestId('workspace-tasks-error')).toBeInTheDocument());
    expect(screen.getByTestId('workspace-tasks-error').textContent).toBe(
      'agentConsole.workspace.errorQuery',
    );
    expect(screen.queryByTestId('workspace-tasks-empty')).toBeNull();
  });

  it('keeps task and approval panel states independent on partial failure', async () => {
    const listTasks = vi.fn().mockResolvedValue({
      items: [{ taskId: '01T', title: 't', status: 'open' }],
    });
    const listApprovals = vi.fn().mockRejectedValue(new Error('boom'));
    renderBind(ADMIN, { listTasks }, { listApprovals });
    fillAndQuery('run_part');
    fireEvent.click(screen.getByText('agentConsole.workspace.tabApprovals'));
    await waitFor(() => expect(screen.getByTestId('workspace-approvals-error')).toBeInTheDocument());
    fireEvent.click(screen.getByText('agentConsole.workspace.tabBind'));
    expect(screen.getByText('01T')).toBeInTheDocument();
  });

  it('client-filters approvals to the run binding within the user queue', async () => {
    const listApprovals = vi.fn().mockResolvedValue({
      items: [
        makeApproval('ap_byrun', { runId: 'run_x' }),
        makeApproval('ap_bysubject', { subjectId: 'run_x' }),
        makeApproval('ap_foreign', { runId: 'nope', subjectId: 'nope' }),
      ],
    });
    renderBind(ADMIN, { listTasks: vi.fn().mockResolvedValue({ items: [] }) }, { listApprovals });
    fillAndQuery('run_x');
    fireEvent.click(screen.getByText('agentConsole.workspace.tabApprovals'));
    await waitFor(() => expect(screen.getByText('ap_byrun')).toBeInTheDocument());
    expect(screen.getByText('ap_bysubject')).toBeInTheDocument();
    expect(screen.queryByText('ap_foreign')).toBeNull();
    expect(screen.getByTestId('workspace-approvals-panel').textContent).toContain(
      'agentConsole.workspace.scopeNote',
    );
  });

  it('truncates argsDigest for display but keeps the full value accessible', async () => {
    const digest = 'ad_0123456789abcdefghij0123456789';
    const listApprovals = vi.fn().mockResolvedValue({
      items: [makeApproval('ap_digest', { runId: 'run_d', digest })],
    });
    renderBind(ADMIN, { listTasks: vi.fn().mockResolvedValue({ items: [] }) }, { listApprovals });
    fillAndQuery('run_d');
    fireEvent.click(screen.getByText('agentConsole.workspace.tabApprovals'));
    await waitFor(() => expect(screen.getByText('ap_digest')).toBeInTheDocument());
    const cell = document.querySelector(`[title="${digest}"]`);
    expect(cell).not.toBeNull();
    expect((cell as HTMLElement).textContent!.length).toBeLessThan(digest.length);
  });

  it('opens the existing approval detail from the row without new endpoints', async () => {
    const row = makeApproval('ap_detail', { runId: 'run_det' });
    const getApproval = vi.fn().mockResolvedValue(row);
    const listApprovals = vi.fn().mockResolvedValue({ items: [row] });
    renderBind(
      ADMIN,
      { listTasks: vi.fn().mockResolvedValue({ items: [] }) },
      { listApprovals, getApproval },
    );
    fillAndQuery('run_det');
    fireEvent.click(screen.getByText('agentConsole.workspace.tabApprovals'));
    await waitFor(() => expect(screen.getByText('ap_detail')).toBeInTheDocument());
    fireEvent.click(screen.getByText('agentConsole.workspace.detail'));
    await waitFor(() =>
      expect(document.querySelector('[data-testid="agent-approval-detail"]')).not.toBeNull(),
    );
    expect(getApproval).toHaveBeenCalledWith('ap_detail');
    expect(screen.queryByText('agentConsole.approvals.write.submit')).toBeNull();
  });

  it('aborts in-flight queries on unmount', async () => {
    const signals: AbortSignal[] = [];
    const listTasks = vi.fn(
      (_params: unknown, signal?: AbortSignal) =>
        new Promise((resolve) => {
          if (signal) {
            signals.push(signal);
            signal.addEventListener('abort', () => resolve({ items: [] }), { once: true });
          }
        }),
    );
    const { unmount } = renderBind(ADMIN, { listTasks }, { listApprovals: vi.fn() });
    fillAndQuery('run_abort');
    await waitFor(() => expect(signals.length).toBeGreaterThan(0));
    unmount();
    expect(signals[0].aborted).toBe(true);
  });

  it('replaces previous results when a new run is queried', async () => {
    const listTasks = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ taskId: '01OLD', title: 'old', status: 'open' }] })
      .mockResolvedValueOnce({ items: [] });
    renderBind(ADMIN, { listTasks }, { listApprovals: vi.fn().mockResolvedValue({ items: [] }) });
    fillAndQuery('run_one');
    await waitFor(() => expect(screen.getByText('01OLD')).toBeInTheDocument());
    fillAndQuery('run_two');
    await waitFor(() => expect(screen.getByTestId('workspace-tasks-empty')).toBeInTheDocument());
    expect(screen.queryByText('01OLD')).toBeNull();
  });

  it('treats 404 console.unknown_route as a failure on the approvals side', async () => {
    const listApprovals = vi.fn().mockRejectedValue(new UpstreamError('console.unknown_route'));
    renderBind(ADMIN, { listTasks: vi.fn().mockResolvedValue({ items: [] }) }, { listApprovals });
    fillAndQuery('run_404');
    fireEvent.click(screen.getByText('agentConsole.workspace.tabApprovals'));
    await waitFor(() => expect(screen.getByTestId('workspace-approvals-error')).toBeInTheDocument());
    expect(screen.queryByTestId('workspace-approvals-empty')).toBeNull();
  });
});
