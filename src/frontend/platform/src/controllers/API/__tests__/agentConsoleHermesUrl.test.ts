/**
 * P0-14 (control card 1568): pin the hermes metrics request URLs so the
 * /agent-api prefix (Caddy -> console BFF) can never regress.
 *
 * Two failure shapes must stay impossible:
 *  - a bare "/api/hermes-*" path, which Caddy routes to Bisheng and 404s;
 *  - a doubled "/agent-api/agent-api/..." path from a mistaken prefix edit.
 *
 * Uses the default base (no option passed) so the factory default itself is
 * covered, mirroring the agentHttpPendingLimit.test.ts fetch-stub idiom.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHttpAgentConsoleHermesApi } from '../agentConsoleHermes';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(urls: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response;
    }),
  );
}

describe('hermes metrics http urls (control card 1568)', () => {
  it('getSummary uses the /agent-api prefix exactly once', async () => {
    const urls: string[] = [];
    stubFetch(urls);
    const api = createHttpAgentConsoleHermesApi({ getToken: () => null });
    await api.getSummary();
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe('/agent-api/api/hermes-summary');
    expect(urls[0]).not.toMatch(/\/\/agent-api/);
  });

  it('getUsage keeps prefix + days query without double prefix', async () => {
    const urls: string[] = [];
    stubFetch(urls);
    const api = createHttpAgentConsoleHermesApi({ getToken: () => null });
    await api.getUsage(7);
    expect(urls).toHaveLength(1);
    expect(urls[0]?.startsWith('/agent-api/api/hermes-usage?days=7')).toBe(true);
    expect(urls[0]).not.toMatch(/\/\/agent-api/);
  });
});
