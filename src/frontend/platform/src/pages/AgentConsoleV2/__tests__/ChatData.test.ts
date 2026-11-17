/**
 * L4p2 chat data layer — wire contract tests.
 * Proves the exact BFF paths, the two-key POST body, the idempotent requestId
 * hand-off, the 10s hard cap, and the render helpers that keep ISO strings and
 * empty bubbles off the screen.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  chatErrorKind,
  createChatApi,
  fmtChatTime,
  messageSide,
  pickSessionId,
  sortMessages,
  type ChatSessionRow,
} from '../chat01';

function mockResponse(
  body: unknown,
  opts: { status?: number; requestId?: string | null } = {},
): Response {
  const status = opts.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'x-console-request-id' ? (opts.requestId ?? null) : null,
    },
  } as unknown as Response;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createChatApi', () => {
  it('reads the session list through the same-origin BFF', async () => {
    const fetchImpl = vi.fn(async () =>
      mockResponse({ items: [{ sessionId: 'ses_1', title: 'A', updatedAt: '2026-11-17T00:00:00Z' }] }),
    );
    const api = createChatApi({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getToken: () => 'tok_1',
    });
    const res = await api.listSessions({ employeeId: 'emp_9', limit: 50 });

    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/agent-api/api/console-sessions?employeeId=emp_9&limit=50');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok_1');
  });

  it('reads one conversation by id (encoded path)', async () => {
    const fetchImpl = vi.fn(async () => mockResponse({ sessionId: 'ses/1', messages: [] }));
    const api = createChatApi({ fetchImpl: fetchImpl as unknown as typeof fetch, getToken: () => null });
    await api.sessionDetail('ses/1');
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
      '/agent-api/api/console-sessions/ses%2F1',
    );
  });

  it('posts exactly {requestId, content} and surfaces the gateway request id', async () => {
    const fetchImpl = vi.fn(async () => mockResponse({}, { status: 201, requestId: 'req_1' }));
    const api = createChatApi({ fetchImpl: fetchImpl as unknown as typeof fetch, getToken: () => null });
    const res = await api.sendMessage('ses_1', 'rid_abc', '你好');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/agent-api/api/console-sessions/ses_1/messages');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    expect(body).toEqual({ requestId: 'rid_abc', content: '你好' });
    expect(Object.keys(body)).toHaveLength(2);
    expect((init.headers as Record<string, string>)['X-Console-Write']).toBe('1');
    expect(res).toMatchObject({ ok: true, status: 201, requestId: 'req_1' });
  });

  it('keeps a 502 envelope honest: status, machine code and request id', async () => {
    const fetchImpl = vi.fn(async () =>
      mockResponse({ code: 'hermes.unavailable', message: 'upstream down' }, { status: 502, requestId: 'req_502' }),
    );
    const api = createChatApi({ fetchImpl: fetchImpl as unknown as typeof fetch, getToken: () => null });
    const res = await api.sendMessage('ses_1', 'rid_abc', '你好');
    expect(res).toMatchObject({ ok: false, status: 502, code: 'hermes.unavailable', requestId: 'req_502' });
    expect(res.data).toBeNull();
  });

  it('aborts at the 10s cap and reports a timeout, never a fake success', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const api = createChatApi({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getToken: () => null,
      timeoutMs: 10_000,
    });
    const pending = api.listSessions();
    await vi.advanceTimersByTimeAsync(10_000);
    const res = await pending;
    expect(res).toMatchObject({ ok: false, status: 0, data: null, code: 'console.timeout' });
  });

  it('maps a transport rejection to console.network', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    const api = createChatApi({ fetchImpl: fetchImpl as unknown as typeof fetch, getToken: () => null });
    const res = await api.listSessions();
    expect(res).toMatchObject({ ok: false, status: 0, code: 'console.network' });
  });

  it('refuses a blank submission without a request', async () => {
    const fetchImpl = vi.fn();
    const api = createChatApi({ fetchImpl: fetchImpl as unknown as typeof fetch, getToken: () => null });
    const res = await api.sendMessage('ses_1', 'rid_abc', '   ');
    expect(res).toMatchObject({ ok: false, status: 0, code: 'console.missing_param' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('render helpers', () => {
  it('classifies failures for copy selection only', () => {
    expect(chatErrorKind(0, 'console.timeout')).toBe('timeout');
    expect(chatErrorKind(0, 'console.network')).toBe('network');
    expect(chatErrorKind(401, 'x')).toBe('auth');
    expect(chatErrorKind(403, 'x')).toBe('denied');
    expect(chatErrorKind(404, 'x')).toBe('denied');
    expect(chatErrorKind(502, 'x')).toBe('unavailable');
    expect(chatErrorKind(400, 'x')).toBe('failed');
  });

  it('formats Beijing time and refuses raw/invalid ISO', () => {
    expect(fmtChatTime('2026-11-17T02:03:00.000Z', new Date('2026-11-17T05:00:00.000Z'))).toBe('10:03');
    expect(fmtChatTime('2025-01-02T02:03:00.000Z', new Date('2026-11-17T05:00:00.000Z'))).toBe(
      '2025-01-02 10:03',
    );
    expect(fmtChatTime('not-a-date')).toBe('—');
    expect(fmtChatTime(null)).toBe('—');
  });

  it('orders messages by seq only when every row carries one', () => {
    const withSeq = sortMessages([
      { text: 'b', seq: 2 },
      { text: 'a', seq: 1 },
    ]);
    expect(withSeq.map((m) => m.text)).toEqual(['a', 'b']);
    const partial = sortMessages([{ text: 'b', seq: 2 }, { text: 'a' }]);
    expect(partial.map((m) => m.text)).toEqual(['b', 'a']);
  });

  it('sides the bubbles and keeps a stale deep link from selecting nothing', () => {
    expect(messageSide('user')).toBe('me');
    expect(messageSide('assistant')).toBe('other');
    expect(messageSide(null)).toBe('other');
    const rows: ChatSessionRow[] = [
      { sessionId: 'ses_new' },
      { sessionId: 'ses_old' },
    ];
    expect(pickSessionId(rows, 'ses_old')).toBe('ses_old');
    expect(pickSessionId(rows, 'ses_gone')).toBe('ses_new');
    expect(pickSessionId([], 'ses_gone')).toBeNull();
  });
});