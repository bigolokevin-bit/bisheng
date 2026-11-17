/**
 * S4.5 — the console request id must ride every adapter result (success,
 * failure, and the 401 AuthError throw) so the error screens can print a
 * copyable number instead of 「未提供」. Header lookup is case-insensitive by
 * DOM contract; the stub emulates Headers.get with a lowercase map.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthError } from '@/controllers/API/agent';
import { createHttpAgentConsoleRunsApi } from '@/controllers/API/agentConsoleRuns';
import { createHttpAgentConsoleTaskDetailApi } from '@/controllers/API/agentConsoleTaskDetail';
import { createHttpAgentConsoleHermesApi } from '@/controllers/API/agentConsoleHermes';
import { createHttpAuditApi } from '../aud01';

function response(opts: {
  status: number;
  ok: boolean;
  body?: unknown;
  headers?: Record<string, string>;
}): Response {
  // emulate the real Headers.get: lookup is case-insensitive
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers ?? {})) map[k.toLowerCase()] = v;
  return {
    status: opts.status,
    ok: opts.ok,
    headers: { get: (k: string) => map[k.toLowerCase()] ?? null },
    json: async () => opts.body ?? {},
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('S4.5 — X-Console-Request-Id on adapter results', () => {
  const RID = 'req_01ABCDEF';

  it('runs api: ok + failure envelopes carry requestId', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response({ status: 200, ok: true, body: { items: [] }, headers: { 'x-console-request-id': RID } }))
        .mockResolvedValueOnce(response({ status: 500, ok: false, body: { code: 'console.upstream' }, headers: { 'X-Console-Request-Id': RID } })),
    );
    const api = createHttpAgentConsoleRunsApi({ getToken: () => null });
    expect((await api.listRuns({ since: '2026-11-16T00:00:00Z' })).requestId).toBe(RID);
    const bad = await api.listRuns({ since: '2026-11-16T00:00:00Z' });
    expect(bad.ok).toBe(false);
    expect(bad.requestId).toBe(RID);
  });

  it('task-detail api: ok + failure envelopes carry requestId', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response({ status: 200, ok: true, body: { id: 'tk_1' }, headers: { 'x-console-request-id': RID } }))
        .mockResolvedValueOnce(response({ status: 403, ok: false, body: {}, headers: { 'x-console-request-id': RID } })),
    );
    const api = createHttpAgentConsoleTaskDetailApi({ getToken: () => null });
    expect((await api.getTaskDetail({ id: 'tk_1' })).requestId).toBe(RID);
    expect((await api.getTaskDetail({ id: 'tk_1' })).requestId).toBe(RID);
  });

  it('hermes api (SET-01 source): failure envelope + 401 throw carry requestId', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response({ status: 503, ok: false, body: {}, headers: { 'x-console-request-id': RID } }))
        .mockResolvedValueOnce(response({ status: 401, ok: false, body: {}, headers: { 'x-console-request-id': RID } })),
    );
    const api = createHttpAgentConsoleHermesApi({ getToken: () => null });
    expect((await api.getSummary()).requestId).toBe(RID);
    await expect(api.getSummary()).rejects.toMatchObject({ name: 'AuthError', requestId: RID });
    // the thrown instance still is an AuthError — semantics unchanged
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ status: 401, ok: false })));
    await expect(api.getSummary()).rejects.toBeInstanceOf(AuthError);
  });

  it('audit api (AUD-01/SET-01 source): prefers x-console-request-id, falls back to x-request-id', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response({ status: 200, ok: true, body: { events: [] }, headers: { 'x-console-request-id': RID, 'x-request-id': 'other' } }))
        .mockResolvedValueOnce(response({ status: 200, ok: true, body: { events: [] }, headers: { 'x-request-id': 'gw_only' } })),
    );
    const api = createHttpAuditApi({ getToken: () => null });
    expect((await api.listAudit({ from: 'a', to: 'b' })).requestId).toBe(RID);
    expect((await api.listAudit({ from: 'a', to: 'b' })).requestId).toBe('gw_only');
  });

  it('absent header stays absent — 「未提供」 must stay reachable, never fabricated', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ status: 200, ok: true, body: { items: [] } })));
    const api = createHttpAgentConsoleRunsApi({ getToken: () => null });
    expect((await api.listRuns({ since: '2026-11-16T00:00:00Z' })).requestId).toBeUndefined();
  });
});
