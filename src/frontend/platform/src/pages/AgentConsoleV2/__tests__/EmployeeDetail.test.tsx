/* EMP-03 RUN-TAB-DATA coverage: derived duration, conservative trigger
 * labels, unknown cost never shown as 0, lazy R3 tail-event summary, and
 * cursor load-more with the stale-overlap guard. No total is ever shown.
 * fetch is stubbed at the global level (makeFetcher uses window fetch). */
/* eslint-disable no-restricted-syntax -- assertions use localized copy */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

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

import { EmployeeDetailPage } from '../EmployeeDetailPage';
import { userContext } from '@/contexts/userContext';

type Mode = 'ok' | 'stale' | 'missing' | 'seq0';
let mode: Mode = 'ok';

const ISO = '2026-11-15T03:27:58.000Z';
const E2 = {
  id: 'emp_1',
  name: '鲤爪',
  title: '产品助理',
  lifecycleState: 'active',
  currentVersionId: 'empv_3',
  ownerUserId: '1',
  createdAt: ISO,
  updatedAt: ISO,
  revision: 2,
};
const BUDGET = { dailyTokens: 100000, monthlyCostUsd: 10, perRunMaxUsd: 0.5 };
const R1 = {
  runId: 'rn_A',
  status: 'completed',
  startedAt: '2026-11-15T10:00:00Z',
  endedAt: '2026-11-15T10:01:23Z',
  costUsd: 0.05,
  costStatus: 'charged',
  employeeVersionNo: 1,
  upstreamRunId: 'up_1',
};
const R2 = {
  runId: 'rn_B',
  status: 'running',
  startedAt: '2026-11-16T01:00:00Z',
  costStatus: 'unknown',
  employeeVersionNo: 2,
  channelEventId: 'ce_1',
};
const R3ROW = {
  runId: 'rn_C',
  status: 'failed',
  startedAt: '2026-11-15T09:00:00Z',
  endedAt: '2026-11-15T09:00:05Z',
};

function bodyFor(url: string): unknown {
  if (url.includes('/api/employee?')) return mode === 'missing' ? { code: 'x' } : E2;
  if (url.includes('/api/effective-config'))
    return {
      employee: E2,
      version: { id: 'empv_3', employeeId: 'emp_1', versionNo: 3, budget: BUDGET },
      grants: [
        {
          id: 'gr_1',
          scopeType: 'channel',
          resourceSelector: { types: ['chat'] },
          actions: ['send'],
          source: 'role',
          expiresAt: '2026-12-31T00:00:00Z',
        },
      ],
      resolvedAt: ISO,
      snapshotRef: 'snap_1',
    };
  if (url.includes('/api/employee-versions'))
    return {
      items: [
        { id: 'empv_3', versionNo: 3, effectiveFrom: ISO, effectiveTo: null, budget: BUDGET },
        {
          id: 'empv_2',
          versionNo: 2,
          effectiveFrom: '2026-11-14T11:30:00Z',
          effectiveTo: ISO,
          changeNote: 'n2',
          budget: BUDGET,
        },
        { id: 'empv_1', versionNo: 1, effectiveFrom: '2026-11-13T22:15:00Z', effectiveTo: '2026-11-14T11:30:00Z', budget: BUDGET },
      ],
    };
  if (url.includes('/api/workstations'))
    return { items: [{ id: 'ws_1', bindingType: 'app', channel: 'feishu', status: 'active' }] };
  if (url.includes('/api/run-stats'))
    return {
      buckets: [
        {
          bucketStart: new Date().toISOString(),
          runs: 13,
          succeeded: 12,
          failed: 0,
          costUsd: 0.1212,
        },
      ],
    };
  if (url.includes('/api/budget-usage'))
    return { items: [{ employeeId: 'emp_1', costUsd: 0.121198 }], missingEmployeeIds: [] };
  if (url.includes('/api/approval-stats')) return { pending: 0, dueSoon: 0 };
  if (url.includes('/api/tasks')) return { items: [] };
  if (url.includes('/api/run-detail')) {
    if (mode === 'seq0') return { runId: 'rn_A', status: 'completed', lastEventSeq: 0 };
    if (url.includes('id=rn_A')) return { runId: 'rn_A', status: 'completed', lastEventSeq: 7 };
    if (url.includes('id=rn_C')) return { runId: 'rn_C', status: 'failed', lastEventSeq: 2 };
    return { runId: 'rn_B', status: 'running', lastEventSeq: null };
  }
  if (url.includes('/api/run-events')) {
    return url.includes('runId=rn_C')
      ? { items: [{ seq: 2, eventType: 'failed', payload: { reasonCode: 'run.upstream_failed' } }] }
      : { items: [{ seq: 7, eventType: 'completed', payload: { output: '最终回复' } }] };
  }
  if (url.includes('/api/runs'))
    return url.includes('cursor=c2')
      ? mode === 'stale'
        ? { items: [R1], nextCursor: null }
        : { items: [R3ROW], nextCursor: null }
      : { items: [R1, R2], nextCursor: 'c2' };
  if (url.includes('/api/audit')) return { events: [] };
  return { items: [] };
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (mode === 'missing' && url.includes('/api/employee?')) {
        return new Response(JSON.stringify({ code: 'employee.not_found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
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
  mode = 'ok';
});

function renderDetail() {
  return render(
    <userContext.Provider value={{ user: { user_id: 1 } } as never}>
      <MemoryRouter initialEntries={['/agent/employees/emp_1']}>
        <Routes>
          <Route path="/agent/employees/:id" element={<EmployeeDetailPage />} />
        </Routes>
      </MemoryRouter>
    </userContext.Provider>
  );
}

async function openRunsTab() {
  await screen.findByTestId('agent-v2-ed-banner');
  fireEvent.click(screen.getByTestId('agent-v2-ed-tab-runs'));
  await screen.findAllByTestId('agent-v2-ed-run-row');
}

describe('EMP-03 runs tab (RUN-TAB-DATA)', () => {
  it('duration, conservative trigger, unknown cost never 0', async () => {
    mode = 'ok';
    stubFetch();
    renderDetail();
    await openRunsTab();
    const rows = screen.getAllByTestId('agent-v2-ed-run-row');
    expect(rows).toHaveLength(2);
    // rn_A: 83s → 1m 23s, cost USD 0.05, upstream id → 上游触发
    expect(rows[0].textContent).toContain('1m 23s');
    expect(rows[0].textContent).toContain('USD 0.05');
    expect(rows[0].textContent).toContain('上游触发');
    // rn_B: running → 进行中, costStatus unknown → literal unknown, never 0.00
    expect(rows[1].textContent).toContain('进行中');
    expect(rows[1].textContent).toContain('unknown');
    expect(rows[1].textContent).not.toContain('0.00');
    expect(rows[1].textContent).toContain('渠道');
  });

  it('lazy summary: tail event payload.output, missing seq → 不可得', async () => {
    mode = 'ok';
    stubFetch();
    renderDetail();
    await openRunsTab();
    const expands = screen.getAllByTestId('agent-v2-ed-run-expand-btn');
    fireEvent.click(expands[0]);
    await waitFor(() =>
      expect(screen.getAllByTestId('agent-v2-ed-run-summary')[0].textContent).toContain(
        '最终回复'
      )
    );
    fireEvent.click(expands[1]);
    await waitFor(() => {
      const texts = screen
        .getAllByTestId('agent-v2-ed-run-summary')
        .map((el) => el.textContent);
      expect(texts.some((x) => (x ?? '').includes('不可得'))).toBe(true);
    });
  });

  it('non-completed terminal tail shows payload.reasonCode (card 481)', async () => {
    mode = 'ok';
    stubFetch();
    renderDetail();
    await openRunsTab();
    fireEvent.click(screen.getByTestId('agent-v2-ed-runs-more'));
    await waitFor(() => expect(screen.getAllByTestId('agent-v2-ed-run-row')).toHaveLength(3));
    const expands = screen.getAllByTestId('agent-v2-ed-run-expand-btn');
    fireEvent.click(expands[2]);
    await waitFor(() => {
      const texts = screen
        .getAllByTestId('agent-v2-ed-run-summary')
        .map((el) => el.textContent);
      expect(texts.some((x) => (x ?? '').includes('run.upstream_failed'))).toBe(true);
    });
  });

  it('lastEventSeq 0 with no events shows the status copy', async () => {
    mode = 'seq0';
    stubFetch();
    renderDetail();
    await openRunsTab();
    fireEvent.click(screen.getAllByTestId('agent-v2-ed-run-expand-btn')[0]);
    await waitFor(() =>
      expect(screen.getAllByTestId('agent-v2-ed-run-summary')[0].textContent).toContain(
        'completed'
      )
    );
  });

  it('load-more consumes nextCursor, hides when done, never shows a total', async () => {
    mode = 'ok';
    stubFetch();
    renderDetail();
    await openRunsTab();
    const more = screen.getByTestId('agent-v2-ed-runs-more');
    fireEvent.click(more);
    await waitFor(() => expect(screen.getAllByTestId('agent-v2-ed-run-row')).toHaveLength(3));
    // second page had no nextCursor → the button disappears
    expect(screen.queryByTestId('agent-v2-ed-runs-more')).toBeNull();
    expect(document.body.textContent).not.toContain('total');
  });

  it('overlapping cursor page stops with the localized stale copy', async () => {
    mode = 'stale';
    stubFetch();
    renderDetail();
    await openRunsTab();
    fireEvent.click(screen.getByTestId('agent-v2-ed-runs-more'));
    await waitFor(() =>
      expect(screen.getByTestId('agent-v2-ed-runs-stale').textContent).toContain('游标已失效')
    );
    // loading stopped: still 2 rows and no more button
    expect(screen.getAllByTestId('agent-v2-ed-run-row')).toHaveLength(2);
    expect(screen.queryByTestId('agent-v2-ed-runs-more')).toBeNull();
  });

  it('unknown id shows the single 404 copy and no machine code leaks', async () => {
    mode = 'missing';
    stubFetch();
    renderDetail();
    await screen.findByTestId('agent-v2-ed-notFound');
    expect(screen.getByTestId('agent-v2-ed-notFound').textContent).toContain(
      '员工不存在或无权访问'
    );
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('employee.not_found');
    expect(body).not.toContain('agentConsole.');
    const codeish = /[a-z]+\.[a-z_]+/;
    document
      .querySelectorAll('[data-testid$="-error"]')
      .forEach((el) => expect(el.textContent ?? '').not.toMatch(codeish));
  });
});
