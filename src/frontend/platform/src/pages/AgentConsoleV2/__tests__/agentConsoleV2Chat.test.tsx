/**
 * P0-13 Route A: the V2 detail section mounts ChatTab as the contract chat
 * surface (BFF-gated send + R3 polling) beside the read-only app iframe
 * panel. These tests cover the integration only; ChatTab behavior itself is
 * covered by agentPageChat.test.tsx, and iframe rules by agentConsoleV2.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { userContext } from '@/contexts/userContext';
import type { AgentConsoleApi } from '@/controllers/API/agent';

import { AgentConsoleV2Page } from '../AgentConsoleV2Page';

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
      ],
    }),
    countPendingApprovals: vi.fn().mockResolvedValue({ ok: true, data: { count: 0 } }),
    getEmployee: vi.fn().mockResolvedValue({
      ok: true,
      data: { id: 'emp_1', tenantId: 't', name: 'Koi Claw', title: 'assistant', lifecycleState: 'active', currentVersionId: 'ver_1', ownerUserId: 'opsadmin', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-11-13T00:00:00Z' },
    }),
    getEffectiveConfig: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        employee: {},
        version: { id: 'ver_1', employeeId: 'emp_1', versionNo: 7, jobDescription: 'jd', grantIds: [], responsePolicy: 'strict', memoryScope: 'none' },
        grants: [],
        resolvedAt: '2026-11-13T00:00:00Z',
        snapshotRef: 'SNAP-MUST-NOT-LEAK',
      },
    }),
    getWorkstations: vi.fn().mockResolvedValue({ ok: true, data: { items: [] } }),
    ...over,
  } as unknown as AgentConsoleApi;
}

function renderV2(api: AgentConsoleApi) {
  vi.stubEnv('VITE_AGENT_CONSOLE_V2', '1');
  return render(
    <userContext.Provider
      value={{ user: { user_id: 1, web_menu: ['admin', 'agent'] }, setUser: vi.fn(), savedComponents: [], addSavedComponent: vi.fn(), checkComponentsName: vi.fn(), delComponent: vi.fn() } as never}
    >
      <AgentConsoleV2Page consoleApi={api} approvalsApi={{ listApprovals: vi.fn().mockResolvedValue({ items: [] }), getApproval: vi.fn().mockResolvedValue(undefined) } as never} />
    </userContext.Provider>,
  );
}

async function openDetail(api: AgentConsoleApi) {
  renderV2(api);
  await screen.findByText('Koi Claw');
  fireEvent.click(screen.getAllByText('agentConsole.v2.detail')[0]);
  return screen.findByTestId('agent-v2-chatpanel');
}

describe('agentConsoleV2 chat panel (P0-13 Route A)', () => {
  it('mounts ChatTab as its own card next to the iframe panel', async () => {
    const panel = await openDetail(consoleApi({
      sendChat: vi.fn().mockResolvedValue({ ok: true, status: 201, data: { runId: '01RUNX', status: 'queued' } }),
      listRunEvents: vi.fn().mockResolvedValue({ ok: true, status: 200, data: { items: [] } }),
    }));
    // Contract chat surface exists even with no app binding at all, while
    // the legacy iframe card still shows guidance (no affordances inside).
    expect(within(panel).getByPlaceholderText('agentConsole.chat.inputPlaceholder')).toBeTruthy();
    const iframeCard = await screen.findByTestId('agent-v2-chat');
    expect(await within(iframeCard).findByTestId('agent-v2-chat-unbound')).toBeTruthy();
  });

  it('sends through api.sendChat and renders runId + R3 reply', async () => {
    const sendChat = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      data: { runId: '01RUNV2TEST0000000000000001', status: 'queued' },
    });
    const listRunEvents = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        items: [
          { seq: 1, eventType: 'message', payload: { text: 'hello from runtime' }, occurredAt: '2026-11-14T00:00:01Z' },
          { seq: 2, eventType: 'completed', payload: {}, occurredAt: '2026-11-14T00:00:02Z' },
        ],
      },
    });
    const panel = await openDetail(consoleApi({ sendChat, listRunEvents }));
    fireEvent.change(within(panel).getByPlaceholderText('agentConsole.chat.inputPlaceholder'), {
      target: { value: 'ping' },
    });
    fireEvent.click(within(panel).getByText('agentConsole.chat.send'));
    await waitFor(() => expect(sendChat).toHaveBeenCalledTimes(1));
    const call = sendChat.mock.calls[0][0] as { employeeId: string; text: string; chatRequestKey: string };
    expect(call.employeeId).toBe('emp_1');
    expect(call.text).toBe('ping');
    expect(typeof call.chatRequestKey).toBe('string');
    expect(await within(panel).findByText('hello from runtime')).toBeTruthy();
    // runId appears in both the user-row chip and the assistant row
    expect(within(panel).getAllByText(/01RUNV2TEST/).length).toBeGreaterThan(0);
  });

  it('shows the honest not-wired state when the api has no chat methods', async () => {
    const panel = await openDetail(consoleApi());
    // consoleApi() without sendChat/listRunEvents overrides: ChatTab must
    // not fake a chat surface; it degrades to the notWired key.
    // Note: this api object has NO sendChat, unlike the previous cases.
    expect(within(panel).queryByPlaceholderText('agentConsole.chat.inputPlaceholder')).toBeNull();
    expect(within(panel).getByText('agentConsole.chat.notWired')).toBeTruthy();
  });
});
