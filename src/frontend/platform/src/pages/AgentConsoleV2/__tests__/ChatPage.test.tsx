/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * L4p2 console chat page tests.
 *
 * The transport is injected (ChatApi), so every state is deterministic: four
 * screens, 403/404 parity, no fabricated reply, draft kept on failure, and the
 * idempotent requestId reused only for the same submission.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', async () => {
  const mod = await import('../../../../public/locales/zh-Hans/bs.json');
  const dict: Record<string, unknown> = (mod as { default: Record<string, unknown> }).default;
  const lookup = (key: string): unknown => {
    let cur: unknown = dict;
    for (const part of key.split('.')) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  };
  const t = (key: string, defOrOpts?: unknown): string => {
    const val = lookup(key);
    if (typeof val !== 'string') return typeof defOrOpts === 'string' ? defOrOpts : key;
    if (defOrOpts && typeof defOrOpts === 'object') {
      return val.replace(/\{\{(\w+)\}\}/g, (_m, k: string) =>
        String((defOrOpts as Record<string, unknown>)[k] ?? ''),
      );
    }
    return val;
  };
  return { useTranslation: () => ({ t }) };
});

import ChatPage from '../ChatPage';
import type { ChatApi, ChatResult } from '../chat01';
import { fmtChatTime } from '../chat01';

const SESSION_A = {
  sessionId: 'ses_a1',
  title: '渠道费用核对',
  employeeId: 'emp_x2',
  updatedAt: '2026-11-17T02:03:00.000Z',
};

function ok<T>(data: T): ChatResult<T> {
  return { ok: true, status: 200, data };
}

function fail(status: number, code: string, requestId?: string): ChatResult<never> {
  return { ok: false, status, data: null, code, requestId };
}

function makeApi(patch: Partial<ChatApi> = {}): ChatApi {
  return {
    listSessions: vi.fn(async () => ok({ items: [SESSION_A] })),
    sessionDetail: vi.fn(async (sessionId: string) =>
      ok({ sessionId, title: SESSION_A.title, employeeId: 'emp_x2', updatedAt: SESSION_A.updatedAt, messages: [] }),
    ),
    sendMessage: vi.fn(async () => ok(null)),
    ...patch,
  } as ChatApi;
}

function renderPage(api: ChatApi, entry = '/agent/chat') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ChatPage api={api} />
    </MemoryRouter>,
  );
}

function guardNoRawKeys() {
  const body = document.body.textContent ?? '';
  expect(body).not.toContain('agentConsole.');
  expect(body).not.toContain('[object Object]');
  expect(body).not.toContain('undefined');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('L4p2 console chat page', () => {
  it('shows a skeleton while the session list is loading', async () => {
    let release: (v: ChatResult<{ items: typeof SESSION_A[] }>) => void = () => {};
    const api = makeApi({
      listSessions: vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      ),
    });
    renderPage(api);
    expect(screen.getByTestId('agent-v2-chat-loading')).toBeTruthy();
    release(ok({ items: [SESSION_A] }));
    await screen.findByTestId('agent-v2-chat-list');
  });

  it('renders sessions and two-color bubbles from the server payload', async () => {
    const api = makeApi({
      sessionDetail: vi.fn(async (sessionId: string) =>
        ok({
          sessionId,
          title: SESSION_A.title,
          employeeId: 'emp_x2',
          updatedAt: SESSION_A.updatedAt,
          messages: [
            { role: 'user', at: '2026-11-17T02:03:00.000Z', text: '这笔费用对不上' },
            { role: 'assistant', at: '2026-11-17T02:04:00.000Z', text: '我核对一下明细。' },
            { role: 'assistant', at: '2026-11-17T02:05:00.000Z', text: '   ' },
          ],
        }),
      ),
    });
    renderPage(api);

    await screen.findByText('这笔费用对不上');
    expect(screen.getByText('我核对一下明细。')).toBeTruthy();
    expect(screen.getByText('暂无内容')).toBeTruthy();
    const bubbles = screen.getAllByTestId('agent-v2-chat-msg');
    expect(bubbles).toHaveLength(3);
    expect(bubbles[0].className).toContain('is-me');
    expect(bubbles[1].className).toContain('is-other');
    expect(screen.getAllByText(fmtChatTime('2026-11-17T02:03:00.000Z')).length).toBeGreaterThan(0);
    expect(screen.getByTestId('agent-v2-chat-thread-title').textContent).toContain('渠道费用核对');
    guardNoRawKeys();
  });

  /* D2 / D6: the empty list states itself once, in the list card, and points
   * at the next step. The thread pane no longer repeats the same headline, and
   * the send path stays shut until a session exists. */
  it('states the empty list once and offers the next step, keeping send disabled', async () => {
    const api = makeApi({ listSessions: vi.fn(async () => ok({ items: [] })) });
    renderPage(api);
    await screen.findByTestId('agent-v2-chat-list-empty');
    expect(screen.getAllByText('还没有会话').length).toBe(1);
    const card = screen.getByTestId('agent-v2-chat-list-empty');
    expect(card).toHaveTextContent('与数字员工开始对话后，会话会出现在这里。');
    const go = screen.getByTestId('agent-v2-chat-list-empty-go');
    expect(go.getAttribute('href')).toBe('/agent/employees');
    expect(screen.getByTestId('agent-v2-chat-idle')).toBeInTheDocument();
    expect(screen.getByTestId('agent-v2-chat-idle')).not.toHaveTextContent('还没有会话');
    expect(screen.getByTestId('agent-v2-chat-input')).toBeDisabled();
    expect(screen.getByTestId('agent-v2-chat-send')).toBeDisabled();
    guardNoRawKeys();
  });

  /* Leg 5: a deep link to a session we never read must say so instead of
   * quietly falling back to the newest row. */
  it('names a deep-linked session that is not in the list, with a way back', async () => {
    const api = makeApi({
      listSessions: vi.fn(async () => ok({ items: [SESSION_A] })),
      sessionDetail: vi.fn(async () => fail(404, 'console_session.not_found', 'req_deep')),
    });
    renderPage(api, '/agent/chat?session=ses_gone');
    await screen.findByTestId('agent-v2-chat-thread-missing');
    const note = screen.getByTestId('agent-v2-chat-thread-missing');
    expect(note).toHaveTextContent('该会话不在本次读取范围内，可能已删除或链接失效。');
    expect(note).not.toHaveTextContent('ses_gone');
    expect(screen.queryAllByTestId('agent-v2-chat-msg')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('agent-v2-chat-thread-missing-back'));
    await waitFor(() => {
      expect(screen.queryByTestId('agent-v2-chat-thread-missing')).toBeNull();
    });
    expect(screen.getByTestId('agent-v2-chat-idle')).toBeInTheDocument();
    guardNoRawKeys();
  });

  it('does not fabricate a thread when a deep-linked session never arrives on an empty list', async () => {
    const api = makeApi({ listSessions: vi.fn(async () => ok({ items: [] })) });
    renderPage(api, '/agent/chat?session=ses_gone');
    await screen.findByTestId('agent-v2-chat-thread-missing');
    expect(screen.queryAllByTestId('agent-v2-chat-msg')).toHaveLength(0);
    expect(screen.getByTestId('agent-v2-chat-list-empty-go')).toBeInTheDocument();
  });

  /* D6: the keyboard hint lives in one place — below the box, not twice. */
  it('keeps the Enter hint out of the placeholder so it is not printed twice', async () => {
    const api = makeApi();
    renderPage(api);
    await screen.findByTestId('agent-v2-chat-list');
    const input = screen.getByTestId('agent-v2-chat-input') as HTMLTextAreaElement;
    expect(input.placeholder).toBe('输入消息…');
    expect(input.placeholder).not.toContain('Shift+Enter');
    expect(screen.getByTestId('agent-v2-chat-thread').textContent).toContain(
      'Enter 发送，Shift+Enter 换行',
    );
  });

  it('renders one identical whole-page body for 403 and 404', async () => {
    const first = renderPage(makeApi({ listSessions: vi.fn(async () => fail(403, 'request.invalid_token', 'req_denied')) }));
    await screen.findByTestId('agent-v2-chat-page-denied');
    const denied403 = document.body.textContent ?? '';
    expect(denied403).toContain('无法查看会话');
    expect(denied403).not.toContain('403');
    first.unmount();

    renderPage(makeApi({ listSessions: vi.fn(async () => fail(404, 'console_session.not_found', 'req_denied')) }));
    await screen.findByTestId('agent-v2-chat-page-denied');
    expect(document.body.textContent).toEqual(denied403);
  });

  it('replaces the page with human copy, status and request id on 502, and retries', async () => {
    const listSessions = vi
      .fn()
      .mockResolvedValueOnce(fail(502, 'hermes.unavailable', 'req_502'))
      .mockResolvedValueOnce(ok({ items: [SESSION_A] }));
    const api = makeApi({ listSessions });
    renderPage(api);

    await screen.findByTestId('agent-v2-chat-page-error');
    expect(screen.getByText('会话服务暂不可用')).toBeTruthy();
    expect(screen.getByTestId('agent-v2-chat-page-error-note-status').textContent).toContain('502');
    expect(screen.getByTestId('agent-v2-chat-page-error-note-rid').textContent).toContain('req_502');
    guardNoRawKeys();

    fireEvent.click(screen.getByTestId('agent-v2-chat-page-error-note-retry'));
    await screen.findByTestId('agent-v2-chat-list');
    expect(listSessions).toHaveBeenCalledTimes(2);
  });

  it('treats a timeout as unreadable with a retry, not as an empty list', async () => {
    const api = makeApi({ listSessions: vi.fn(async () => fail(0, 'console.timeout')) });
    renderPage(api);
    await screen.findByTestId('agent-v2-chat-page-error');
    expect(screen.getByText('本次未能读取')).toBeTruthy();
    expect(screen.queryByTestId('agent-v2-chat-list-empty')).toBeNull();
    expect(screen.getByTestId('agent-v2-chat-page-error-note-retry')).toBeTruthy();
  });

  it('keeps the draft on a failed send and reuses the requestId on retry', async () => {
    const sendMessage = vi.fn(async () => fail(502, 'hermes.unavailable', 'gw_send_1'));
    const api = makeApi({ sendMessage });
    renderPage(api);
    const input = (await screen.findByTestId('agent-v2-chat-input')) as HTMLTextAreaElement;
    await waitFor(() => expect(input).not.toBeDisabled());

    fireEvent.change(input, { target: { value: '帮我看下这笔费用' } });
    fireEvent.click(screen.getByTestId('agent-v2-chat-send'));

    await screen.findByTestId('agent-v2-chat-send-error');
    expect(input.value).toBe('帮我看下这笔费用');
    expect(screen.getByText('消息没有送出')).toBeTruthy();
    expect(screen.getByTestId('agent-v2-chat-send-error-status').textContent).toContain('502');
    expect(screen.getByTestId('agent-v2-chat-send-error-rid').textContent).toContain('gw_send_1');

    const firstId = (sendMessage.mock.calls[0] as unknown[])[1] as string;
    expect(firstId).toBeTruthy();

    fireEvent.click(screen.getByTestId('agent-v2-chat-send-retry'));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    expect((sendMessage.mock.calls[1] as unknown[])[1]).toBe(firstId);

    fireEvent.change(input, { target: { value: '换一个问题' } });
    fireEvent.click(screen.getByTestId('agent-v2-chat-send'));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(3));
    expect((sendMessage.mock.calls[2] as unknown[])[1]).not.toBe(firstId);
    expect((sendMessage.mock.calls[2] as unknown[])[2]).toBe('换一个问题');
  });

  it('clears the draft after a successful send and re-reads the thread (no local echo)', async () => {
    let detailCalls = 0;
    const api = makeApi({
      sessionDetail: vi.fn(async (sessionId: string) => {
        detailCalls += 1;
        return ok({
          sessionId,
          title: SESSION_A.title,
          messages:
            detailCalls === 1
              ? []
              : [{ role: 'user', at: '2026-11-17T02:10:00.000Z', text: '帮我看下这笔费用' }],
        });
      }),
    });
    renderPage(api);
    const input = (await screen.findByTestId('agent-v2-chat-input')) as HTMLTextAreaElement;
    await waitFor(() => expect(input).not.toBeDisabled());

    fireEvent.change(input, { target: { value: '帮我看下这笔费用' } });
    expect(screen.getByText('暂无消息')).toBeTruthy();
    fireEvent.click(screen.getByTestId('agent-v2-chat-send'));

    await screen.findByText('帮我看下这笔费用');
    expect(screen.getAllByText('帮我看下这笔费用')).toHaveLength(1);
    expect(input.value).toBe('');
    expect(detailCalls).toBe(2);
  });

  it('fences an unreadable conversation to its own pane and returns to the list', async () => {
    const api = makeApi({
      sessionDetail: vi.fn(async () => fail(404, 'console_session.not_found', 'req_thread')),
    });
    renderPage(api);
    await screen.findByTestId('agent-v2-chat-thread-denied');
    expect(screen.getByText('无法查看该会话')).toBeTruthy();
    expect(screen.getByTestId('agent-v2-chat-send')).toBeDisabled();

    fireEvent.click(screen.getByTestId('agent-v2-chat-thread-back'));
    await screen.findByTestId('agent-v2-chat-idle');
    expect(screen.getByTestId('agent-v2-chat-input')).toBeDisabled();
  });

  /* R2 leg 5 reversed the behaviour this case used to pin: trading a stale
   * deep link for the newest row read as a silent substitution, so the page
   * now leaves the thread idle and names the link instead of fetching a
   * different session behind the user's back. */
  it('does not trade a stale deep link for the newest row', async () => {
    const api = makeApi();
    renderPage(api, '/agent/chat?session=ses_gone');
    await screen.findByTestId('agent-v2-chat-thread-missing');
    const calls = (api.sessionDetail as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
    expect(calls).not.toContain('ses_a1');
    expect(screen.queryAllByTestId('agent-v2-chat-msg')).toHaveLength(0);
  });

  it('keeps the responsive contract in the lane stylesheet (static check)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const css = fs.readFileSync(path.join(process.cwd(), 'src/pages/AgentConsoleV2/chat01.css'), 'utf8');
    // 375: list and stream stack in one column, input bar sticks to the bottom.
    expect(css).toContain('@media (max-width: 900px)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(css).toContain('position: sticky');
    const thread = fs.readFileSync(
      path.join(process.cwd(), 'src/pages/AgentConsoleV2/ChatThread.tsx'),
      'utf8',
    );
    expect(thread).not.toContain('dangerouslySetInnerHTML');
  });
});