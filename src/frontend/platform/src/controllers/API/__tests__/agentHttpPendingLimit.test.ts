/**
 * A1 guardrail: AP4 rejects limit>100 (400 limit must be an integer
 * between 1 and 100), so the HTTP adapter must request at most 100.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHttpAgentConsoleApi } from '../agent';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('http adapter pending count', () => {
  it('requests pending approvals with limit <= 100', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input));
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [] }),
        } as Response;
      }),
    );
    const api = createHttpAgentConsoleApi({
      base: '/agent-api',
      getToken: () => 'tok-test',
    });
    await Promise.resolve(api.countPendingApprovals('human:1')).catch(() => null);
    expect(urls).toHaveLength(1);
    const limit = Number(
      new URL(urls[0], 'http://localhost').searchParams.get('limit'),
    );
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThanOrEqual(100);
  });
});
