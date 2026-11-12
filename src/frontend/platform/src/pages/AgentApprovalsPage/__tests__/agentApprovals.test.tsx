import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userContext } from '@/contexts/userContext';
import { AuthError, UpstreamError } from '@/controllers/API/agent';
import {
  createHttpAgentApprovalsApi,
  createStubAgentApprovalsApi,
  effectiveApprovalStatus,
  DEMO_APPROVAL_1,
  DEMO_APPROVAL_2,
  DEMO_APPROVAL_3,
  DEMO_APPROVAL_4,
  DEMO_ASSIGNEE,
  DEMO_APPROVAL_FIXTURES,
  type AgentApprovalsApi,
  type Approval,
  type ApprovalFixture,
} from '@/controllers/API/agentConsoleApprovals';
import { AgentApprovalsPage } from '../index';
import { AgentApprovalsList } from '../AgentApprovalsList';
import { ApprovalDetail } from '../ApprovalDetail';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage(api: AgentApprovalsApi, userId: string | number | undefined) {
  return render(
    <userContext.Provider
      value={
        {
          user: userId === undefined ? {} : { user_id: userId },
          setUser: vi.fn(),
          savedComponents: [],
          addSavedComponent: vi.fn(),
          checkComponentsName: vi.fn(),
          delComponent: vi.fn(),
        }
      }
    >
      <AgentApprovalsPage api={api} />
    </userContext.Provider>,
  );
}

/** Builds a pending far-future approval for cursor tests (ASCII only). */
function makeApproval(approvalId: string): Approval {
  return {
    approvalId,
    tenantId: 'tenant_demo',
    type: 'business_action',
    action: 'employee.version.create',
    runId: null,
    binding: {
      subjectType: 'employee',
      subjectId: '01DEMOEMPLOYEE000000000001',
      changeKind: 'employee_version_create',
      targetHash: `th_${approvalId.slice(-4)}`,
      effectiveFrom: null,
    },
    status: 'pending',
    riskLevel: 'high',
    requestedBy: 'human:requester_demo',
    onBehalfOf: null,
    reasonText: `Reason for ${approvalId}`,
    approvers: [{ userId: DEMO_ASSIGNEE, role: 'owner' }],
    requiredApprovals: 1,
    decisions: [],
    verdict: null,
    decidedAt: null,
    policyDecisionId: 'pd_demo',
    expiresAt: '2099-01-01T00:00:00.000Z',
    remainingSeconds: 86400,
    ttlSeconds: 86400,
    consumedAt: null,
    supersededBy: null,
    createdAt: '2026-10-31T10:00:00.000Z',
  };
}

describe('effectiveApprovalStatus', () => {
  it('reads a past-expiry pending row as expired', () => {
    const row = DEMO_APPROVAL_FIXTURES.find(
      (f) => f.approval.approvalId === DEMO_APPROVAL_2,
    )?.approval;
    expect(row?.status).toBe('pending');
    expect(effectiveApprovalStatus(row as Approval)).toBe('expired');
  });

  it('leaves live pending and settled rows untouched', () => {
    const live = DEMO_APPROVAL_FIXTURES.find(
      (f) => f.approval.approvalId === DEMO_APPROVAL_1,
    )?.approval as Approval;
    expect(effectiveApprovalStatus(live)).toBe('pending');
    const expiredRow = DEMO_APPROVAL_FIXTURES.find(
      (f) => f.approval.approvalId === DEMO_APPROVAL_3,
    )?.approval as Approval;
    expect(effectiveApprovalStatus(expiredRow)).toBe('expired');
  });
});

describe('AgentApprovalsPage', () => {
  it('queries AP4 with the literal assignee taken from the user session', async () => {
    const api = createStubAgentApprovalsApi();
    const spy = vi.spyOn(api, 'listApprovals');
    renderPage(api, 'demo-approver');

    await screen.findByText(DEMO_APPROVAL_1);
    expect(spy).toHaveBeenCalledWith({
      assignee: DEMO_ASSIGNEE,
      status: undefined,
      limit: 20,
      cursor: undefined,
    });
    // Pending queue only; expired bucket and other assignees never leak.
    expect(screen.queryByText(DEMO_APPROVAL_3)).toBeNull();
    expect(screen.queryByText(DEMO_APPROVAL_4)).toBeNull();
    // changeKind / subject / risk cells render real values.
    expect(screen.getByText('employee_version_create')).toBeTruthy();
    expect(screen.getByText('01DEMOEMPLOYEE000000000001')).toBeTruthy();
    expect(
      screen.getByText('agentConsole.approvals.risk.high'),
    ).toBeTruthy();
  });

  it('shows an explicit identity state and never queries without a user', async () => {
    const api = createStubAgentApprovalsApi();
    const spy = vi.spyOn(api, 'listApprovals');
    renderPage(api, undefined);

    await screen.findByText('agentConsole.approvals.identityUnavailable');
    expect(spy).not.toHaveBeenCalled();
  });

  it('shows the empty state when the queue has no rows', async () => {
    const api = createStubAgentApprovalsApi([]);
    renderPage(api, 'demo-approver');
    await screen.findByText('agentConsole.approvals.empty');
  });

  it('surfaces expired rows with the expired label in the detail view', async () => {
    const expired = DEMO_APPROVAL_FIXTURES.find(
      (f) => f.approval.approvalId === DEMO_APPROVAL_2,
    )?.approval as Approval;
    // The row itself still reads pending; the detail must normalise it.
    const detailApi: AgentApprovalsApi = {
      listApprovals: async () => ({ items: [] }),
      getApproval: async () => expired,
    };
    render(<ApprovalDetail api={detailApi} approval={expired} />);
    await screen.findByTestId('agent-approval-detail');
    expect(
      screen.getByText('agentConsole.approvals.status.expired'),
    ).toBeTruthy();
    expect(
      screen.queryByText('agentConsole.approvals.status.pending'),
    ).toBeNull();
  });

  it('opens AP3 detail with binding, approvers and reason fields', async () => {
    const api = createStubAgentApprovalsApi();
    const spy = vi.spyOn(api, 'getApproval');
    renderPage(api, 'demo-approver');

    fireEvent.click(await screen.findByText('agentConsole.list.detail'));
    await screen.findByTestId('agent-approval-detail');
    expect(spy).toHaveBeenCalledWith(
      DEMO_APPROVAL_1,
      expect.objectContaining({ approvalId: DEMO_APPROVAL_1 }),
    );
    expect(screen.getByText('Publish the new employee version')).toBeTruthy();
    expect(screen.getByText('th_demo_0001')).toBeTruthy();
    expect(screen.getByText('human:requester_demo')).toBeTruthy();
    expect(
      screen.getByText(`${DEMO_ASSIGNEE} · owner`),
    ).toBeTruthy();
    expect(
      screen.getByText('agentConsole.approvals.decisionsEmpty'),
    ).toBeTruthy();
    expect(
      screen.getByText('agentConsole.approvals.onBehalfOf'),
    ).toBeTruthy();
    expect(screen.getByText('human:user_demo_owner')).toBeTruthy();

    // Back returns to the list.
    fireEvent.click(screen.getByText('agentConsole.detail.back'));
    await screen.findByText(DEMO_APPROVAL_1);
  });

  it('collapses not-found into a single fail-closed message', async () => {
    const api = createStubAgentApprovalsApi();
    const brokenApi: AgentApprovalsApi = {
      listApprovals: api.listApprovals,
      getApproval: async () => null,
    };
    renderPage(brokenApi, 'demo-approver');
    fireEvent.click(await screen.findByText('agentConsole.list.detail'));
    await screen.findByText('agentConsole.approvals.notFound');
  });

  it('shows the error state with the code and a retry', async () => {
    const failing: AgentApprovalsApi = {
      listApprovals: async () => {
        throw new UpstreamError('agent.http.502');
      },
      getApproval: async () => null,
    };
    renderPage(failing, 'demo-approver');
    await screen.findByText('agentConsole.approvals.error');
    expect(screen.getByText('agent.http.502')).toBeTruthy();
  });

  it('routes auth expiry to the re-login state', async () => {
    const expired: AgentApprovalsApi = {
      listApprovals: async () => {
        throw new AuthError();
      },
      getApproval: async () => null,
    };
    renderPage(expired, 'demo-approver');
    await screen.findByText('agentConsole.auth.expired');
    expect(screen.getByText('agentConsole.auth.relogin')).toBeTruthy();
  });

  it('appends the next cursor page via load more', async () => {
    const fixtures: ApprovalFixture[] = [
      { approval: makeApproval('01DEMOAPPROVAL0000000000A1'), assignees: [DEMO_ASSIGNEE] },
      { approval: makeApproval('01DEMOAPPROVAL0000000000A2'), assignees: [DEMO_ASSIGNEE] },
      { approval: makeApproval('01DEMOAPPROVAL0000000000A3'), assignees: [DEMO_ASSIGNEE] },
    ];
    const api = createStubAgentApprovalsApi(fixtures);
    render(
      <AgentApprovalsList
        api={api}
        assignee={DEMO_ASSIGNEE}
        pageSize={2}
        onSelect={vi.fn()}
      />,
    );
    await screen.findByText('01DEMOAPPROVAL0000000000A2');
    expect(screen.queryByText('01DEMOAPPROVAL0000000000A3')).toBeNull();

    fireEvent.click(screen.getByText('agentConsole.list.loadMore'));
    await screen.findByText('01DEMOAPPROVAL0000000000A3');
    expect(
      screen.queryByText('agentConsole.list.loadMore'),
    ).toBeNull();
  });

  it('renders no write-action buttons anywhere (read-only red line)', async () => {
    const api = createStubAgentApprovalsApi();
    renderPage(api, 'demo-approver');
    await screen.findByText(DEMO_APPROVAL_1);
    const banned = /create|delete|edit|approve|reject|revoke|consume|publish|批准|驳回|撤回/i;
    const hits = Array.from(document.querySelectorAll('button')).filter(
      (b) => banned.test(b.textContent ?? ''),
    );
    expect(hits).toHaveLength(0);
    // And clicking into detail keeps the guarantee.
    fireEvent.click(screen.getByText('agentConsole.list.detail'));
    await screen.findByTestId('agent-approval-detail');
    const hits2 = Array.from(document.querySelectorAll('button')).filter(
      (b) => banned.test(b.textContent ?? ''),
    );
    expect(hits2).toHaveLength(0);
  });
});

describe('http approvals adapter', () => {
  function fetchMock(responses: Array<{ ok: boolean; status: number; body: unknown }>) {
    const calls: string[] = [];
    const fn = vi.fn(async (url: RequestInfo | URL) => {
      calls.push(String(url));
      const next = responses.shift();
      if (!next) throw new Error('unexpected fetch');
      return {
        ok: next.ok,
        status: next.status,
        json: async () => next.body,
      } as Response;
    });
    return { fn, calls };
  }

  it('refuses to list without an assignee and never hits the network', async () => {
    const { fn } = fetchMock([]);
    vi.stubGlobal('fetch', fn);
    const api = createHttpAgentApprovalsApi({ getToken: () => null });
    await expect(
      api.listApprovals({ assignee: '' }),
    ).rejects.toThrow('console.missing_filter');
    expect(fn).not.toHaveBeenCalled();
  });

  it('normalises an explicit null nextCursor to undefined', async () => {
    const { fn, calls } = fetchMock([
      { ok: true, status: 200, body: { items: [], nextCursor: null } },
    ]);
    vi.stubGlobal('fetch', fn);
    const api = createHttpAgentApprovalsApi({ getToken: () => null });
    const res = await api.listApprovals({ assignee: 'human:1' });
    expect(res).toEqual({ items: [], nextCursor: undefined });
    expect(calls[0]).toContain('/agent-api/api/approvals?assignee=human%3A1');
  });

  it('keeps the AP4 row when the BFF has no AP3 route (unknown_route)', async () => {
    const { fn } = fetchMock([
      {
        ok: false,
        status: 404,
        body: { code: 'console.unknown_route' },
      },
    ]);
    vi.stubGlobal('fetch', fn);
    const api = createHttpAgentApprovalsApi({ getToken: () => null });
    const row = makeApproval(DEMO_APPROVAL_1);
    await expect(api.getApproval(DEMO_APPROVAL_1, row)).resolves.toBe(row);
  });

  it('returns null for approval.not_found and throws other codes', async () => {
    const { fn } = fetchMock([
      { ok: false, status: 404, body: { code: 'approval.not_found' } },
      { ok: false, status: 502, body: { code: 'upstream.unavailable' } },
    ]);
    vi.stubGlobal('fetch', fn);
    const api = createHttpAgentApprovalsApi({ getToken: () => null });
    await expect(api.getApproval('ap_missing')).resolves.toBeNull();
    await expect(api.getApproval('ap_boom')).rejects.toThrow(
      'upstream.unavailable',
    );
  });

  it('throws AuthError on a 401 envelope', async () => {
    const { fn } = fetchMock([{ ok: false, status: 401, body: {} }]);
    vi.stubGlobal('fetch', fn);
    const api = createHttpAgentApprovalsApi({ getToken: () => null });
    await expect(api.listApprovals({ assignee: 'human:1' })).rejects.toBeInstanceOf(
      AuthError,
    );
  });
});
