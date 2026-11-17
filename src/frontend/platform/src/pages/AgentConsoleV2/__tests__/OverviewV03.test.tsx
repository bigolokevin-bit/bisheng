/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * PRD v0.3 §5.1 additions (OV-01):
 *  - OV-LIST-01 最近运行: at most 5 rows, every row opens /agent/runs/:id,
 *    empty state names the next step;
 *  - OV-CARD-01/02 入口卡: both render with a real route, an upstream 404
 *    hides the card, a 500 keeps a human error + request id + retry;
 *  - OV-ACT-01 刷新 is disabled while any block is loading;
 *  - no engineering language on screen and no solid primary button.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/components/bs-ui/message', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('react-i18next', async () => {
  const mod = (await import('../../../../public/locales/zh-Hans/bs.json')) as {
    default: Record<string, unknown>;
  };
  const dict = mod.default;
  const t = (key: unknown, opts?: unknown): string => {
    const value = String(key)
      .split('.')
      .reduce<unknown>(
        (acc, part) =>
          acc && typeof acc === 'object'
            ? (acc as Record<string, unknown>)[part]
            : undefined,
        dict,
      );
    if (typeof value !== 'string') return String(key);
    const options = (opts ?? {}) as Record<string, unknown>;
    return value.replace(/\{\{(\w+)\}\}/g, (m, name: string) =>
      name in options ? String(options[name]) : m
    );
  };
  return { useTranslation: () => ({ t }) };
});

import { OverviewPage } from '../OverviewPage';
import { userContext } from '@/contexts/userContext';

type Scenario = {
  matrixStatus?: number;
  matrixRequestId?: string;
  matrixItems?: unknown[];
  collabItems?: unknown[];
  recentItems?: unknown[];
  gate?: boolean;
};

let scenario: Scenario = {};
let release: (() => void) | null = null;
let gate: Promise<void> | null = null;

const EMP = { employeeId: 'emp_1', name: '鲤爪' };

function runRow(n: number) {
  return {
    runId: `run_000000000000000${n}`,
    employeeId: EMP.employeeId,
    status: n === 5 ? 'failed' : 'completed',
    startedAt: new Date(Date.now() - n * 60000).toISOString(),
    endedAt: null,
    costUsd: 0.01,
  };
}

function bodyFor(url: string): unknown {
  if (url.includes('/api/employee-stats')) return { total: 1, byLifecycle: { active: 1 } };
  if (url.includes('/api/approval-stats')) return { pending: 0, dueSoon: 0 };
  if (url.includes('/api/run-stats')) {
    const day = new Date().toISOString();
    return { buckets: [{ bucketStart: day, runs: 3, succeeded: 2, failed: 1, costUsd: 0.03 }] };
  }
  if (url.includes('/api/run-activity')) return { cells: [], max: 0 };
  if (url.includes('/api/audit')) return { events: [] };
  if (url.includes('/api/budget-usage')) return { items: [], missingEmployeeIds: [] };
  if (url.includes('/api/employees')) return { items: [EMP] };
  if (url.includes('/api/matrix')) return { items: scenario.matrixItems ?? [] };
  if (url.includes('/api/delegations')) return { items: scenario.collabItems ?? [] };
  if (url.includes('/api/runs')) return { items: scenario.recentItems ?? [] };
  return { items: [] };
}

function stubFetch() {
  gate = scenario.gate
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (gate) await gate;
      const url = String(input);
      if (url.includes('/api/matrix') && scenario.matrixStatus && scenario.matrixStatus !== 200) {
        return new Response(JSON.stringify({ code: 'agent.http.500' }), {
          status: scenario.matrixStatus,
          headers: {
            'Content-Type': 'application/json',
            'X-Console-Request-Id': scenario.matrixRequestId ?? 'req-test-matrix',
          },
        });
      }
      return new Response(JSON.stringify(bodyFor(url)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  scenario = {};
  release = null;
  gate = null;
});

function renderOverview() {
  return render(
    <userContext.Provider value={{ user: { user_id: 1 } } as never}>
      <MemoryRouter initialEntries={['/agent']}>
        <OverviewPage />
      </MemoryRouter>
    </userContext.Provider>
  );
}

describe('OV-01 PRD §5.1 additions', () => {
  it('OV-LIST-01: renders at most 5 recent runs, each row a real detail route', async () => {
    scenario = { recentItems: [1, 2, 3, 4, 5, 6].map(runRow) };
    stubFetch();
    renderOverview();
    const rows = await screen.findAllByTestId('agent-v2-ov-recent-run-row');
    expect(rows).toHaveLength(5);
    const hrefs = Array.from(rows[0].querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/agent/runs/run_0000000000000001');
    expect(screen.getByTestId('agent-v2-ov-recent-runs-all').getAttribute('href')).toBe('/agent/runs');
  });

  it('OV-LIST-01: empty recent runs names the next step instead of a dead table', async () => {
    scenario = { recentItems: [] };
    stubFetch();
    renderOverview();
    const empty = await screen.findByTestId('agent-v2-ov-recent-runs-empty');
    expect(empty).toBeInTheDocument();
    const links = Array.from(screen.getByTestId('agent-v2-ov-recent-runs').querySelectorAll('a'));
    expect(links.some((a) => a.getAttribute('href') === '/agent/runs')).toBe(true);
  });

  it('OV-CARD-01/02: entry cards carry real routes and real counts', async () => {
    scenario = {
      matrixItems: [{ employeeId: 'emp_1', name: '鲤爪' }, { employeeId: 'emp_2', name: '鲤爪二' }],
      collabItems: [{ taskId: 'tsk_1' }],
    };
    stubFetch();
    renderOverview();
    expect(await screen.findByTestId('agent-v2-ov-matrix-count')).toHaveTextContent('已加载 2 名员工');
    expect(screen.getByTestId('agent-v2-ov-matrix-open').getAttribute('href')).toBe('/agent/matrix');
    expect(screen.getByTestId('agent-v2-ov-collab-open').getAttribute('href')).toBe('/agent/collab');
    expect(screen.getByTestId('agent-v2-ov-collab-card').textContent).toContain('已加载 1 条');
  });

  it('OV-CARD-01: an upstream 404 hides the card instead of showing a broken door', async () => {
    scenario = { matrixStatus: 404 };
    stubFetch();
    renderOverview();
    await screen.findByTestId('agent-v2-ov-collab-card');
    expect(screen.queryByTestId('agent-v2-ov-matrix-card')).toBeNull();
  });

  it('OV-CARD-01: a 500 shows a human reason + request id + retry that recovers', async () => {
    scenario = { matrixStatus: 500, matrixRequestId: 'req-mx-9' };
    stubFetch();
    renderOverview();
    const error = await screen.findByTestId('agent-v2-ov-matrix-error');
    expect(error.textContent).toContain('查询失败');
    expect(error.textContent).toContain('请求编号');
    expect(error.textContent).toContain('req-mx-9');
    expect(error.textContent).not.toContain('HTTP');

    scenario = { matrixItems: [{ employeeId: 'emp_1', name: '鲤爪' }] };
    fireEvent.click(screen.getByTestId('agent-v2-ov-retry-matrix'));
    expect(await screen.findByTestId('agent-v2-ov-matrix-count')).toHaveTextContent('已加载 1 名员工');
  });

  it('OV-ACT-01: refresh is disabled while blocks load and unlocks afterwards', async () => {
    scenario = { gate: true };
    stubFetch();
    renderOverview();
    const refresh = screen.getByTestId('agent-v2-ov-refresh');
    expect(refresh).toBeDisabled();
    expect(refresh.getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(refresh).not.toBeDisabled());
    expect(refresh.getAttribute('aria-busy')).toBe('false');
  });

  it('keeps engineering language off screen and stays at zero solid primary buttons', async () => {
    scenario = {
      matrixItems: [{ employeeId: 'emp_1', name: '鲤爪' }],
      collabItems: [],
      recentItems: [runRow(1)],
    };
    stubFetch();
    renderOverview();
    await screen.findByTestId('agent-v2-ov-updated');
    const text = document.body.textContent ?? '';
    for (const banned of ['UTC', 'HTTP', 'AL-5', 'M2', '/api/', 'employee.version']) {
      expect(text).not.toContain(banned);
    }
    expect(document.querySelectorAll('.a2-btn.is-primary')).toHaveLength(0);
    expect(document.querySelectorAll('a[href="#"]')).toHaveLength(0);
  });

  it('mobile: entry cards collapse and the runs table scrolls inside its card', () => {
    const css = readFileSync(
      `${process.cwd()}/src/pages/AgentConsoleV2/overview.css`,
      'utf8'
    );
    expect(css).toContain('@media (max-width: 900px)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(css).toContain('.ov-rtbl { min-width: 620px; }');
  });
});