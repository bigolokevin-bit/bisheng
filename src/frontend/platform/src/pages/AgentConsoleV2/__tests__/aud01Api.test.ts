/* eslint-disable no-restricted-syntax -- assertions pin the exact BFF paths, not copy */
/**
 * AUD-01 adapter URL contract.
 *
 * The read path is `/agent-api` (Caddy prefix) + the BFF's own `/api/…` route.
 * Dropping the `/api/` segment is not a cosmetic difference: Caddy answers 404
 * and the page renders its error card, which is what blocked the AUD-01 VG
 * capture. These tests pin the COMPLETE url for both endpoints so the segment
 * cannot go missing again:
 *   A3  GET /agent-api/api/audit?<filters>&limit=&cursor=
 *   A7  GET /agent-api/api/audit-verify?from=&to=
 * (BFF routes: apps/console/server.py `"/api/audit"` and `"/api/audit-verify"`.
 * The per-event detail route is `/api/audit-detail?id=` — A4, owned by AUD-02,
 * never called from this page.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthError } from '@/controllers/API/agent';

import { createHttpAuditApi } from '../aud01';

interface Call {
  url: string;
  headers: Record<string, string>;
}

function stubFetch(body: unknown, init: { status?: number; requestId?: string } = {}): Call[] {
  const calls: Call[] = [];
  const status = init.status ?? 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, opts?: { headers?: Record<string, string> }) => {
      calls.push({ url, headers: (opts?.headers ?? {}) as Record<string, string> });
      return {
        ok: status < 400,
        status,
        json: async () => body,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'x-request-id' ? (init.requestId ?? null) : null,
        },
      } as unknown as Response;
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AUD-01 adapter paths (A3/A7 must keep the BFF /api/ segment)', () => {
  it('A3 calls /agent-api/api/audit with the seven filters, limit and no empty params', async () => {
    const calls = stubFetch({ events: [], nextCursor: undefined });
    const api = createHttpAuditApi({ getToken: () => 'tok' });

    await api.listAudit({
      runId: 'rn_1',
      taskId: '',
      actorId: undefined,
      resourceId: 'emp_1',
      action: 'grant.created',
      from: '2026-11-16T09:20:00.000Z',
      to: '2026-11-17T09:20:00.000Z',
      limit: 50,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      '/agent-api/api/audit?runId=rn_1&resourceId=emp_1&action=grant.created' +
        '&from=2026-11-16T09%3A20%3A00.000Z&to=2026-11-17T09%3A20%3A00.000Z&limit=50',
    );
    expect(calls[0].headers.Authorization).toBe('Bearer tok');
    expect(calls[0].headers.Accept).toBe('application/json');
  });

  it('A3 pagination carries the opaque cursor through untouched', async () => {
    const calls = stubFetch({ events: [] });
    const api = createHttpAuditApi({ getToken: () => null });

    await api.listAudit({ action: 'kb.read', limit: 20, cursor: 'eyJhIjoxfQ==' });

    expect(calls[0].url).toBe('/agent-api/api/audit?action=kb.read&limit=20&cursor=eyJhIjoxfQ%3D%3D');
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it('A7 calls /agent-api/api/audit-verify with both window bounds', async () => {
    const calls = stubFetch({ ok: true, complete: true, scanned: 0 });
    const api = createHttpAuditApi({ getToken: () => 'tok' });

    const res = await api.verifyAudit({
      from: '2026-11-16T09:20:00.000Z',
      to: '2026-11-17T09:20:00.000Z',
    });

    expect(calls[0].url).toBe(
      '/agent-api/api/audit-verify?from=2026-11-16T09%3A20%3A00.000Z&to=2026-11-17T09%3A20%3A00.000Z',
    );
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ ok: true, complete: true, scanned: 0 });
  });

  it('normalizes the A3 envelope (`events`) and keeps a missing nextCursor absent', async () => {
    stubFetch({ events: [{ eventId: 'ev_1' }] });
    const api = createHttpAuditApi({ getToken: () => null });

    const res = await api.listAudit({ action: 'kb.read' });

    expect(res.data?.events).toHaveLength(1);
    expect(res.data && 'nextCursor' in res.data ? res.data.nextCursor : undefined).toBeUndefined();
  });

  it('honours a custom base and still keeps /api/ (no double prefix)', async () => {
    const calls = stubFetch({ events: [] });
    const api = createHttpAuditApi({ base: '', getToken: () => null });

    await api.listAudit({ action: 'kb.read' });

    expect(calls[0].url).toBe('/api/audit?action=kb.read');
  });

  it('401 becomes AuthError (page redirects to login, not an error card)', async () => {
    stubFetch({}, { status: 401 });
    const api = createHttpAuditApi({ getToken: () => null });

    await expect(api.listAudit({ action: 'kb.read' })).rejects.toBeInstanceOf(AuthError);
  });

  it('a failed call returns the HTTP status, code and request id (no throw, no fake data)', async () => {
    stubFetch({ code: 'audit.query_too_broad' }, { status: 400, requestId: 'req-42' });
    const api = createHttpAuditApi({ getToken: () => null });

    const res = await api.verifyAudit({ from: 'a', to: 'b' });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(res.code).toBe('audit.query_too_broad');
    expect(res.requestId).toBe('req-42');
  });
});