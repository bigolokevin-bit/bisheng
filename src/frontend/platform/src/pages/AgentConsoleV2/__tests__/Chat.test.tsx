/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * CHAT-01 console direct chat tests.
 *
 * Same harness as the Matrix / Skills suites: stub the global fetch, route by
 * URL + method, and mock react-i18next against the REAL zh-Hans resources so
 * raw-key leaks are caught by the DOM guard. Probe 2026-11-17: the console
 * session family exists behind the identity gate (401 console.unauthenticated
 * without a cookie), so the 401 branch is the current real behavior.
 *
 * The write path is pinned hard: a failed send must leave NO assistant bubble
 * and NO optimistic row, and every send must carry its own requestId.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/components/bs-ui/message', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

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
import { userContext } from '@/contexts/userContext';

interface StubCall {
  url: string;
  method: string;
  body: unknown;
}

let calls: StubCall[] = [];
let listStatus = 200;
let listBody: unknown = { items: [] };
let detailStatus = 200;
let detailBody: unknown = {};
let sendStatus = 201;
let sendBody: unknown = {};
let sendDeferred: Promise<unknown> | null = null;
let postRequests: { requestId: string; content: string }[] = [];

function listResponse() {
  const ok = listStatus >= 200 && listStatus < 300;
  return {
    ok,
    status: listStatus,
    json: async () => listBody,
    headers: { get: () => (ok ? null : 'req-list-1') },
  } as unknown as Response;
}

function detailResponse() {
  const ok = detailStatus >= 200 && detailStatus < 300;
  return {
    ok,
    status: detailStatus,
    json: async () => detailBody,
    headers: { get: () => (ok ? null : 'req-detail-1') },
  } as unknown as Response;
}

function sendResponse() {
  const ok = sendStatus >= 200 && sendStatus < 300;
  return {
    ok,
    status: sendStatus,
    json: async () => sendBody,
    headers: { get: () => 'req-send-1' },
  } as unknown as Response;
}

function stubFetch() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    let parsed: unknown = null;
    if (typeof init?.body === 'string') {
      try {
        parsed = JSON.parse(init.body);
        postRequests.push(parsed as { requestId: string; content: string });
      } catch {
        parsed = init.body;
      }
    }
    calls.push({ url, method, body: parsed });

    if (method === 'POST' && /\/api\/console-sessions\/[^/]+\/messages/.test(url)) {
      if (sendDeferred) return (await sendDeferred) as Response;
      return sendResponse();
    }
    if (url.includes('/api/console-sessions/')) return detailResponse();
    if (url.includes('/api/console-sessions')) return listResponse();
    return { ok: true, status: 200, json: async () => ({}), headers: { get: () => null } } as unknown as Response;
  }) as never;
}

function renderPage(entry = '/agent/chat') {
  return render(
    <userContext.Provider value={{ user: { user_id: 1 } as never }}>
      <MemoryRouter initialEntries={[entry]}>
        <ChatPage />
      </MemoryRouter>
    </userContext.Provider>,
  );
}

function guardNoRawKeys() {
  const body = document.body.textContent ?? '';
  expect(body).not.toContain('agentConsole.');
  expect(body).not.toContain('[object Object]');
  expect(body).not.toContain('undefined');
}

const SESSION_A = { sessionId: 'cs_a', updatedAt: '2026-11-17T02:30:00.000Z', messageCount: 3 };
const SESSION_B = { sessionId: 'cs_b', updatedAt: '2026-11-16T09:05:00.000Z', messageCount: 1 };

const MESSAGES_A = [
  { seq: 1, role: 'user', content: '帮我把本周的审批整理一下。', createdAt: '2026-11-17T02:20:00.000Z' },
  {
    seq: 2,
    role: 'assistant',
    content: '已整理好 3 条待批，稍后发你。',
    createdAt: '2026-11-17T02:21:00.000Z',
    citations: [{ title: '审批台账' }, { name: '运行记录' }],
  },
  { seq: 3, role: 'user', content: '好的，谢谢。', createdAt: '2026-11-17T02:22:00.000Z' },
];

beforeEach(() => {
  calls = [];
  postRequests = [];
  listStatus = 200;
  listBody = { items: [] };
  detailStatus = 200;
  detailBody = { sessionId: 'cs_a', messages: [] };
  sendStatus = 201;
  sendBody = {};
  sendDeferred = null;
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function selectFirstSession() {
  const buttons = await screen.findAllByTestId('agent-v2-cs-session');
  buttons[0].click();
  return buttons;
}

describe('CHAT-01 console direct chat', () => {
  it('shows the loading skeleton before the session list lands', async () => {
    let release: (v: unknown) => void = () => {};
    globalThis.fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    ) as never;
    renderPage();
    expect(screen.getByTestId('agent-v2-cs-loading')).toBeTruthy();
    release({ ok: true, status: 200, json: async () => ({ items: [] }), headers: { get: () => null } });
    await waitFor(() => expect(screen.queryByTestId('agent-v2-cs-loading')).toBeNull());
  });

  it('degrades honestly when the session read refuses the identity (401, current live state)', async () => {
    listStatus = 401;
    listBody = { code: 'console.unauthenticated', message: 'identity check failed' };
    renderPage();
    const err = await screen.findByTestId('agent-v2-cs-error');
    const text = err.textContent ?? '';
    expect(text).toContain('登录已失效');
    expect(text).not.toContain('console.unauthenticated');
    expect(text).not.toContain('identity check failed');
    expect(text).not.toContain('401');
    expect(text).not.toContain('/api/');
    guardNoRawKeys();
    expect(screen.getByTestId('agent-v2-cs-error-reqid')).toBeTruthy();
    // retry re-issues the same read request, and never opens a write path
    const before = calls.length;
    screen.getByTestId('agent-v2-cs-retry').click();
    await waitFor(() => expect(calls.length).toBeGreaterThan(before));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    await screen.findByTestId('agent-v2-cs-error');
  });

  it('renders the empty state without fabricating a session or a composer', async () => {
    listBody = { items: [] };
    renderPage();
    await screen.findByTestId('agent-v2-cs-empty');
    expect(screen.queryAllByTestId('agent-v2-cs-session')).toHaveLength(0);
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
    expect((document.body.textContent ?? '').includes('还没有会话')).toBe(true);
    // a bare object with no items key is also "no rows", never a phantom session
    cleanup();
    listBody = {};
    renderPage();
    await screen.findByTestId('agent-v2-cs-empty');
    expect(screen.queryAllByTestId('agent-v2-cs-session')).toHaveLength(0);
    guardNoRawKeys();
  });

  it('lists sessions, opens one, and renders messages with citations only where they exist', async () => {
    listBody = { items: [SESSION_A, SESSION_B] };
    detailBody = { sessionId: 'cs_a', messageCount: 3, messages: MESSAGES_A };
    renderPage();

    const sessions = await screen.findAllByTestId('agent-v2-cs-session');
    expect(sessions).toHaveLength(2);
    // nothing is opened by default: the page asks which session to read
    expect(screen.getByTestId('agent-v2-cs-pick')).toBeTruthy();
    expect(calls.filter((c) => c.url.includes('/api/console-sessions/'))).toHaveLength(0);

    sessions[0].click();
    const msgs = await screen.findAllByTestId('agent-v2-cs-msg');
    expect(msgs).toHaveLength(3);
    expect(msgs[0].textContent).toContain('帮我把本周的审批整理一下。');
    expect(msgs[0].textContent).toContain('我');
    expect(msgs[1].textContent).toContain('数字员工');
    expect(msgs[1].textContent).toContain('已整理好 3 条待批');
    // timestamps go through fmtTime (Asia/Shanghai) — no raw ISO string
    expect(document.body.textContent).not.toContain('2026-11-17T02:20');

    // the assistant row with a real list shows each reference
    const cites = screen.getAllByTestId('agent-v2-cs-citations');
    expect(cites).toHaveLength(1);
    expect(cites[0].textContent).toContain('参考来源');
    expect(cites[0].textContent).toContain('审批台账');
    expect(cites[0].textContent).toContain('运行记录');
    // the row without a citations key renders nothing — no empty placeholder
    expect(msgs[2].querySelector('[data-testid="agent-v2-cs-citations"]')).toBeNull();
    expect(msgs[2].textContent).not.toContain('参考来源');
    guardNoRawKeys();
  });

  it('send 201: the optimistic row is replaced by the server rows', async () => {
    listBody = { items: [SESSION_A] };
    detailBody = { sessionId: 'cs_a', messages: MESSAGES_A };
    let release: (v: unknown) => void = () => {};
    sendDeferred = new Promise((resolve) => {
      release = resolve;
    });
    sendBody = {
      sessionId: 'cs_a',
      requestId: 'server-echo',
      userMessage: { seq: 4, role: 'user', content: '服务器回显的用户消息', createdAt: '2026-11-17T03:00:00.000Z' },
      assistantMessage: {
        seq: 5,
        role: 'assistant',
        content: '服务器给出的回答',
        createdAt: '2026-11-17T03:00:05.000Z',
      },
      updatedAt: '2026-11-17T03:00:05.000Z',
    };
    renderPage();
    await selectFirstSession();
    await screen.findAllByTestId('agent-v2-cs-msg');

    fireEvent.change(screen.getByTestId('agent-v2-cs-input'), { target: { value: '明天上午提醒我复核' } });
    screen.getByTestId('agent-v2-cs-send').click();

    // optimistic: the user's text is on screen immediately, marked as sending
    const pending = await screen.findByTestId('agent-v2-cs-msg-pending');
    expect(pending.closest('[data-testid="agent-v2-cs-msg"]')?.textContent).toContain('明天上午提醒我复核');
    expect(pending.closest('[data-testid="agent-v2-cs-msg"]')?.getAttribute('data-pending')).toBe('1');

    release(sendResponse());
    await waitFor(() => expect(screen.queryByTestId('agent-v2-cs-msg-pending')).toBeNull());
    const after = await screen.findAllByTestId('agent-v2-cs-msg');
    expect(after).toHaveLength(5);
    const text = document.body.textContent ?? '';
    expect(text).toContain('服务器回显的用户消息');
    expect(text).toContain('服务器给出的回答');
    expect(text).not.toContain('明天上午提醒我复核');
    // the composer is cleared after a successful send
    expect((screen.getByTestId('agent-v2-cs-input') as HTMLTextAreaElement).value).toBe('');
  });

  it('send 502: human failure copy, no assistant bubble, optimistic row removed', async () => {
    listBody = { items: [SESSION_A] };
    detailBody = { sessionId: 'cs_a', messages: MESSAGES_A };
    sendStatus = 502;
    sendBody = { code: 'hermes.unavailable', message: 'upstream session failed' };
    renderPage();
    await selectFirstSession();
    await screen.findAllByTestId('agent-v2-cs-msg');

    fireEvent.change(screen.getByTestId('agent-v2-cs-input'), { target: { value: '这条会失败的消息' } });
    screen.getByTestId('agent-v2-cs-send').click();

    const err = await screen.findByTestId('agent-v2-cs-send-error');
    expect(err.textContent).toContain('数字员工暂时没回应，消息未送达');
    expect(err.textContent).not.toContain('502');
    expect(err.textContent).not.toContain('hermes');
    // exactly the three server rows remain: no fake assistant reply, no echo
    const msgs = screen.getAllByTestId('agent-v2-cs-msg');
    expect(msgs).toHaveLength(3);
    expect(msgs.some((m) => (m.textContent ?? '').includes('这条会失败的消息'))).toBe(false);
    // the user's words survive only in the input (kept for a retry), never as a bubble
    expect((screen.getByTestId('agent-v2-cs-input') as HTMLTextAreaElement).value).toBe('这条会失败的消息');
    expect(msgs.filter((m) => m.getAttribute('data-role') === 'assistant')).toHaveLength(1);
    // the pre-existing citation block is the only one; the failed send added none
    expect(screen.getAllByTestId('agent-v2-cs-citations')).toHaveLength(1);
    expect(screen.queryByTestId('agent-v2-cs-msg-pending')).toBeNull();
    guardNoRawKeys();
  });

  it('generates a distinct requestId for every send and posts only to the message route', async () => {
    listBody = { items: [SESSION_A] };
    detailBody = { sessionId: 'cs_a', messages: [] };
    sendBody = {
      sessionId: 'cs_a',
      userMessage: { seq: 1, role: 'user', content: '第一条', createdAt: '2026-11-17T03:00:00.000Z' },
      assistantMessage: { seq: 2, role: 'assistant', content: '收到', createdAt: '2026-11-17T03:00:01.000Z' },
    };
    renderPage();
    await selectFirstSession();
    await waitFor(() => expect(screen.queryByTestId('agent-v2-cs-no-messages')).not.toBeNull());

    fireEvent.change(screen.getByTestId('agent-v2-cs-input'), { target: { value: '第一条' } });
    screen.getByTestId('agent-v2-cs-send').click();
    await waitFor(() => expect(postRequests).toHaveLength(1));
    await waitFor(() => expect((screen.getByTestId('agent-v2-cs-send') as HTMLButtonElement).disabled).toBe(true));

    fireEvent.change(screen.getByTestId('agent-v2-cs-input'), { target: { value: '第二条' } });
    screen.getByTestId('agent-v2-cs-send').click();
    await waitFor(() => expect(postRequests).toHaveLength(2));

    expect(postRequests[0].requestId).toBeTruthy();
    expect(postRequests[1].requestId).toBeTruthy();
    expect(postRequests[0].requestId).not.toBe(postRequests[1].requestId);
    expect(postRequests[0].content).toBe('第一条');
    expect(postRequests[1].content).toBe('第二条');
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(2);
    posts.forEach((p) => expect(p.url).toContain('/api/console-sessions/cs_a/messages'));
    guardNoRawKeys();
  });

  it('has no write control other than the composer', async () => {
    listBody = { items: [SESSION_A, SESSION_B] };
    detailBody = { sessionId: 'cs_a', messages: MESSAGES_A };
    renderPage();
    await selectFirstSession();
    await screen.findAllByTestId('agent-v2-cs-msg');

    // no create / rename / delete / upload affordance anywhere on the page
    expect(document.querySelector('[data-testid*="create"]')).toBeNull();
    expect(document.querySelector('[data-testid*="delete"]')).toBeNull();
    expect(document.querySelector('[data-testid*="rename"]')).toBeNull();
    expect(document.querySelector('[data-testid*="upload"]')).toBeNull();
    expect(document.querySelectorAll('form')).toHaveLength(0);
    expect(document.querySelectorAll('textarea')).toHaveLength(1);
    expect(document.querySelectorAll('input')).toHaveLength(0);

    // buttons are the two session selectors plus the one send control
    const testids = Array.from(document.querySelectorAll('button')).map((b) => b.getAttribute('data-testid'));
    expect(testids).toEqual(['agent-v2-cs-session', 'agent-v2-cs-session', 'agent-v2-cs-send']);

    // clicking a session only reads — the write count stays zero
    screen.getAllByTestId('agent-v2-cs-session')[1].click();
    await waitFor(() => expect(screen.queryByTestId('agent-v2-cs-msg-pending')).toBeNull());
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    guardNoRawKeys();
  });
});