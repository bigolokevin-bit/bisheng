/**
 * Console page registry — the seam that keeps page lanes out of
 * `routes/index.tsx`.
 *
 * Guards three things:
 *  ① the registry still describes exactly the route table that was inline
 *     before the extraction (same 21 entries, same order, same param names,
 *     same lazy boundaries, same settings redirect, same splat 404);
 *  ② every rail entry in Shell.tsx `L1_ENTRIES` has a route in the registry —
 *     this is the check that would have caught skills / chat / collab shipping
 *     a page with no way to reach it;
 *  ③ `routes/index.tsx` no longer imports console pages directly, so a
 *     page lane cannot grow the inline table back (single-writer rule).
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/controllers/API/agent', () => ({ createHttpAgentConsoleApi: () => ({}) }));
vi.mock('@/controllers/API/agentConsoleHermes', () => ({
  createHttpAgentConsoleHermesApi: () => ({}) ,
}));
vi.mock('@/controllers/API/agentConsoleRuns', () => ({
  createHttpAgentConsoleRunsApi: () => ({}),
}));
vi.mock('@/controllers/API/agentConsoleTrends', () => ({
  createHttpAgentConsoleTrendsApi: () => ({}),
}));

import { CONSOLE_V2_CHILDREN } from '../../../routes/consolePages';
import { L1_ENTRIES } from '../Shell';

const root = process.cwd();
const file = (rel: string) => readFileSync(join(root, 'src', rel), 'utf8');

/** `{ index: true }` reads as '', the splat stays '*'. */
const routeKeys = CONSOLE_V2_CHILDREN.map((e) =>
  (e as { index?: boolean; path?: string }).index ? '' : (e as { path: string }).path,
);

describe('console page registry (routes/consolePages.tsx)', () => {
  it('keeps the 21 entries of the former inline table, in order', () => {
    expect(routeKeys).toEqual([
      '',
      'employees',
      'employees/new',
      'employees/:id',
      'matrix',
      'skills',
      'approvals',
      'approvals/:id',
      'tasks',
      'tasks/new',
      'tasks/:taskId',
      'collab',
      'runs',
      'runs/:runId',
      'metrics',
      'audit',
      'audit/:eventId',
      'settings',
      'settings/:section',
      'chat',
      '*',
    ]);
  });

  it('keeps the settings redirect and the in-shell splat 404', () => {
    const settings = CONSOLE_V2_CHILDREN.find((e) => (e as { path?: string }).path === 'settings');
    const element = (settings as { element: { type: unknown; props: { to?: string; replace?: boolean } } })
      .element;
    // a redirect, not a lazy page: the section nav needs one canonical landing
    expect(typeof element.type).toBe('function');
    expect(element.props.to).toBe('/agent/settings/tenant');
    expect(element.props.replace).toBe(true);

    const last = CONSOLE_V2_CHILDREN[CONSOLE_V2_CHILDREN.length - 1] as { path: string };
    expect(last.path).toBe('*');
  });

  it('keeps every page behind a lazy boundary (same chunk seams as before)', () => {
    for (const e of CONSOLE_V2_CHILDREN) {
      const element = (e as { element: { type: { $$typeof?: symbol } } }).element;
      if ((e as { path?: string }).path === 'settings') continue;
      expect(String(element.type.$$typeof)).toContain('react.lazy');
    }
  });

  it('gives every rail entry a route', () => {
    for (const entry of L1_ENTRIES) {
      expect(routeKeys, `rail entry ${entry.key} has no route`).toContain(entry.path);
    }
  });

  it('leaves routes/index.tsx free of direct console page imports', () => {
    const routes = file('routes/index.tsx');
    const consoleModules = [...routes.matchAll(/@\/pages\/AgentConsoleV2\/([A-Za-z0-9_]+)/g)]
      .map((m) => m[1])
      // the v2 feature flag legitimately stays in the route table: it gates
      // both the legacy in-MainLayout routes and the shell branch
      .filter((name) => name !== 'flag');
    // only the shell may be referenced there; every page comes from the registry
    expect(consoleModules).toEqual(['Shell']);
    expect(routes).toContain('children: CONSOLE_V2_CHILDREN');
    const registry = file('routes/consolePages.tsx');
    expect(registry).not.toContain('@/pages/AgentConsoleV2/Shell');
  });
});
