/**
 * P0-13 Route A chat panel tests. Data source = deterministic stub api or
 * inline vi.fn() mocks; the real BFF/login path is NOT exercised here
 * (acceptance gate owns it). Copy assertions match on i18n keys because the
 * global test setup mocks react-i18next with t: (key) => key.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  createStubAgentConsoleApi,
  DEMO_FIXTURES,
  STUB_CHAT_RUN_ID,
  type AgentConsoleApi,
  type ApiResult,
  type ChatRunResult,
  type RunEventItem,
  type RunEventList,
  type Workstation,
} from '@/controllers/API/agent';
import { ChatTab } from '../ChatTab';

afterEach(cleanup);

const EMP1 = '01DEMOEMPLOYEE000000000001';

const stub = () => createStubAgentConsoleApi(DEMO_FIXTURES);

const okResult = <T,>(data: T): ApiResult<T> => ({ ok: true, status: 200, data });

const events = (items: RunEventItem[]): ApiResult<RunEventList> => okResult({ items });

const typeAndSend = (text: string) => {
  const box = screen.getByPlaceholderText('agentConsole.chat.inputPlaceholder');
  fireEvent.change(box, { target: { value: text } });
  // Enter sends (Shift+Enter would insert a newline; design §3).
  fireEvent.keyDown(box, { key: 'Enter', shiftKey: false });
};

const sendButton = () => screen.getByRole('button', { name: 'agentConsole.chat.send' });

describe('ChatTab send flow (stub adapter)', () => {
  it('optimistic user row appears, gains sent + runId chip, and the stub echo renders as an assistant row', async () => {
    const { container } = render(<ChatTab api={stub()} employeeId={EMP1} />);
    // Empty state before any message.
    expect(screen.getByText('agentConsole.chat.empty')).toBeInTheDocument();
    typeAndSend('hello koi');
    // Optimistic row renders synchronously: text + pending chip.
    expect(screen.getByText('hello koi')).toBeInTheDocument();
    expect(screen.getByText('agentConsole.chat.status.pending')).toBeInTheDocument();
    // After the stub run dispatch + first poll: sent + runId chip + echo.
    await screen.findByText('agentConsole.chat.status.sent');
    // The runId chip appears on the user row (and mirrors onto the reply row).
    expect(screen.getAllByText(STUB_CHAT_RUN_ID).length).toBeGreaterThanOrEqual(1);
    await screen.findByText('stub:hello koi');
    expect(screen.getByText('agentConsole.chat.status.done')).toBeInTheDocument();
    // Honesty guard: no token material ever reaches the DOM (design §1).
    expect(container.innerHTML).not.toMatch(/ws_token|Bearer/i);
  });

  it('send button (not only Enter) dispatches the strict ChatRequest body', async () => {
    const base = stub();
    const sendChat = vi.fn(base.sendChat!);
    render(<ChatTab api={{ ...base, sendChat }} employeeId={EMP1} />);
    const box = screen.getByPlaceholderText('agentConsole.chat.inputPlaceholder');
    fireEvent.change(box, { target: { value: 'via button' } });
    fireEvent.click(sendButton());
    await waitFor(() => expect(sendChat).toHaveBeenCalledTimes(1));
    expect(sendChat).toHaveBeenCalledWith({
      employeeId: EMP1,
      text: 'via button',
      chatRequestKey: expect.any(String),
    });
  });

  it('ignores a blank draft (no dispatch, no row)', async () => {
    const base = stub();
    const sendChat = vi.fn(base.sendChat!);
    render(<ChatTab api={{ ...base, sendChat }} employeeId={EMP1} />);
    const box = screen.getByPlaceholderText('agentConsole.chat.inputPlaceholder');
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: false });
    expect(sendChat).not.toHaveBeenCalled();
    expect(screen.getByText('agentConsole.chat.empty')).toBeInTheDocument();
  });
});

describe('ChatTab reply rendering (R3 events)', () => {
  const sendOk = (runId = '01RUNCHATREPLY0000000000001') =>
    vi.fn().mockResolvedValue(okResult<ChatRunResult>({ runId, status: 'running' }));

  it('completed without any message event renders the empty-reply notice, never fake text', async () => {
    const base = stub();
    const api: AgentConsoleApi = {
      ...base,
      sendChat: sendOk(),
      listRunEvents: vi
        .fn()
        .mockResolvedValue(
          events([
            { seq: 1, eventType: 'started', payload: null, occurredAt: '2026-11-14T00:00:00Z' },
            { seq: 2, eventType: 'completed', payload: null, occurredAt: '2026-11-14T00:00:02Z' },
          ]),
        ),
    };
    render(<ChatTab api={api} employeeId={EMP1} />);
    typeAndSend('ping');
    await screen.findByText('agentConsole.chat.emptyReply');
    expect(screen.getByText('agentConsole.chat.status.done')).toBeInTheDocument();
  });

  it('a failed terminal event surfaces its reasonCode verbatim', async () => {
    const base = stub();
    const api: AgentConsoleApi = {
      ...base,
      sendChat: sendOk('01RUNCHATFAIL0000000000001'),
      listRunEvents: vi.fn().mockResolvedValue(
        events([
          {
            seq: 1,
            eventType: 'failed',
            payload: { reasonCode: 'upstream.timeout' },
            occurredAt: '2026-11-14T00:00:02Z',
          },
        ]),
      ),
    };
    render(<ChatTab api={api} employeeId={EMP1} />);
    typeAndSend('ping');
    await screen.findByText('agentConsole.chat.status.failed');
    expect(screen.getByText('upstream.timeout')).toBeInTheDocument();
  });
});

describe('ChatTab honest failure mapping (design §1)', () => {
  it('401 envelope renders the sign-in-again copy on the user row', async () => {
    const base = stub();
    const api: AgentConsoleApi = {
      ...base,
      sendChat: vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        data: null,
        code: 'console.unauthenticated',
      }),
    };
    render(<ChatTab api={api} employeeId={EMP1} />);
    typeAndSend('ping');
    await screen.findByText('agentConsole.chat.error.unauthenticated');
    expect(screen.getByText('agentConsole.chat.status.failed')).toBeInTheDocument();
  });

  it('5xx envelope marks the row failed, and retry reuses the SAME chatRequestKey', async () => {
    const base = stub();
    const sendChat = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        data: null,
        code: 'console.upstream_unavailable',
      })
      .mockResolvedValueOnce(okResult<ChatRunResult>({ runId: '01RUNRETRYOK000000000001', status: 'running' }));
    const api: AgentConsoleApi = { ...base, sendChat };
    render(<ChatTab api={api} employeeId={EMP1} />);
    typeAndSend('idempotent ping');
    await screen.findByText('agentConsole.chat.error.unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'agentConsole.chat.retry' }));
    await waitFor(() => expect(sendChat).toHaveBeenCalledTimes(2));
    const [first, second] = sendChat.mock.calls as [
      { chatRequestKey: string; text: string },
      { chatRequestKey: string; text: string },
    ];
    // Same key + same body => upstream idempotency cannot create a second run.
    expect(second.chatRequestKey).toBe(first.chatRequestKey);
    expect(second).toEqual(first);
    await screen.findByText('agentConsole.chat.status.sent');
  });

  it('409 code is surfaced verbatim (no invented copy)', async () => {
    const base = stub();
    const api: AgentConsoleApi = {
      ...base,
      sendChat: vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        data: null,
        code: 'run.employee_not_active',
      }),
    };
    render(<ChatTab api={api} employeeId={EMP1} />);
    typeAndSend('ping');
    await screen.findByText('run.employee_not_active');
  });
});

describe('ChatTab adapter degradation (design §4)', () => {
  it('api without sendChat/listRunEvents shows the chat-not-wired state', () => {
    const base = stub();
    const api = { ...base, sendChat: undefined, listRunEvents: undefined } as AgentConsoleApi;
    render(<ChatTab api={api} employeeId={EMP1} />);
    expect(screen.getByText('agentConsole.chat.notWired')).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText('agentConsole.chat.inputPlaceholder'),
    ).toBeNull();
  });
});

describe('ChatTab Bisheng iframe fallback entry (design §3)', () => {
  const appWs: Workstation = {
    id: 'ws_app_1',
    employeeId: EMP1,
    bindingType: 'app',
    channel: 'bisheng',
    externalRef: 'app_demo_9',
    capabilities: ['chat'],
    status: 'active',
  };

  it('shows the Open-in-Bisheng link only for a bindingType=app row with externalRef', async () => {
    const api = createStubAgentConsoleApi({
      ...DEMO_FIXTURES,
      workstations: { [EMP1]: [appWs] },
    });
    render(<ChatTab api={api} employeeId={EMP1} />);
    const link = await screen.findByRole('link', {
      name: 'agentConsole.chat.openInBisheng',
    });
    expect(link).toHaveAttribute('href', '/workspace/chat/assistant/auth/app_demo_9');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('hides the entry for non-app bindings (stub demo: group + dm only)', async () => {
    const base = stub();
    const getWorkstations = vi.fn(base.getWorkstations);
    render(<ChatTab api={{ ...base, getWorkstations }} employeeId={EMP1} />);
    // Let the workstation round-trip settle, THEN assert absence.
    await waitFor(() => expect(getWorkstations).toHaveBeenCalledWith(EMP1));
    await getWorkstations.mock.results[0]!.value;
    expect(
      screen.queryByRole('link', { name: 'agentConsole.chat.openInBisheng' }),
    ).toBeNull();
  });
});
