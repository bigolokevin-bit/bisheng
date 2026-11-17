/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * OV-01 redo (lane/L4-ov01-redo) behavior locks:
 *  1. review annotations are gone (no 参考屏 / 评审 / 行结构示意 / 非真实数据,
 *     no bare 「暂无数据」);
 *  2. the running/unknown residual (14 = 13 + 0 + 1) is spelled out in the
 *     KPI note, the trend summary and the trend foot with the SAME number;
 *  3. queue semantics: a completed task returned by the dueBefore query must
 *     NOT render as an actionable row, and the 0-item rows show the
 *     "这里会出现…" affordance instead of an empty stub;
 *  4. 14 runs / 0 dueSoon → the rail-adjacent pending count and queue count
 *     agree with AP8; no fake sparkline: cards without a trend source render
 *     the dots slot;
 *  5. activity renders a localized action name + mono raw value (never a
 *     bare snake_case on the main line).
 * fetch is stubbed at the global level (makeFetcher uses window fetch).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
        dict
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

const EMP_A = {
  employeeId: 'emp_f2b540',
  name: 'AgentOS 产品助理',
  lifecycleState: 'active',
  enrichment: { effectiveBudget: { monthlyCostUsd: 10 } },
};
const EMP_B = {
  employeeId: 'emp_a22649',
  name: 'AgentOS 产品助理',
  lifecycleState: 'active',
  enrichment: { effectiveBudget: { monthlyCostUsd: 10 } },
};

function dayAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString();
}

function bodyFor(url: string): unknown {
  if (url.includes('/api/employee-stats')) return { total: 2, byLifecycle: { active: 2 } };
  if (url.includes('/api/approval-stats')) return { pending: 0, dueSoon: 0 };
  if (url.includes('/api/run-stats')) {
    // Today's KPI uses a Beijing-day window (from < 2 days ago); the 7-day
    // spark and the 28-day trend keep the wider fixture.
    const from = new URL(url, 'http://localhost').searchParams.get('from');
    const fromMs = from ? Date.parse(from) : Number.NaN;
    if (Number.isFinite(fromMs) && Date.now() - fromMs < 2 * 86400000) {
      return {
        buckets: [{ bucketStart: dayAgo(0), runs: 5, succeeded: 4, failed: 1, costUsd: 0.05 }],
      };
    }
    // current window: 14 runs = 13 succeeded + 0 failed + 1 running/unknown
    // (the residual is what the summary and trend foot lock).
    return {
      buckets: [
        { bucketStart: dayAgo(3), runs: 1, succeeded: 1, failed: 0, costUsd: 0.01 },
        { bucketStart: dayAgo(0), runs: 13, succeeded: 12, failed: 0, costUsd: 0.12 },
      ],
    };
  }
  if (url.includes('/api/run-activity')) {
    return {
      from: dayAgo(28),
      to: dayAgo(0),
      tz: 'Asia/Shanghai',
      max: 8,
      cells: [
        { dow: 5, hour: 14, count: 8 },
        { dow: 5, hour: 15, count: 5 },
      ],
    };
  }
  if (url.includes('/api/budget-usage')) {
    return {
      items: [
        { employeeId: EMP_A.employeeId, period: '2026-11-17', periodKind: 'day', costUsd: 0.05, updatedAt: dayAgo(0) },
        { employeeId: EMP_B.employeeId, period: '2026-11-17', periodKind: 'day', costUsd: 0.01, updatedAt: dayAgo(0) },
      ],
      missingEmployeeIds: [],
    };
  }
  if (url.includes('/api/employees')) return { items: [EMP_A, EMP_B] };
  if (url.includes('/api/matrix')) {
    return { items: [{ employeeId: EMP_A.employeeId, name: EMP_A.name, lifecycle: 'active' }] };
  }
  if (url.includes('/api/delegations')) return { items: [] };
  if (url.includes('/api/approvals')) return { items: [] };
  if (url.includes('/api/tasks')) {
    // the dueBefore query returns a COMPLETED task — it must never look pending
    return {
      items: [
        { taskId: 'tsk_0001aaaabbbbcccc', status: 'done', title: '改价写入' },
        { taskId: 'tsk_0002aaaabbbbcccc', status: 'in_progress', title: '周会纪要归档', createdAt: dayAgo(0.1) },
      ],
    };
  }
  if (url.includes('/api/runs')) return { items: [] };
  if (url.includes('/api/audit')) {
    return {
      events: [
        {
          eventId: 'evt_1',
          occurredAt: dayAgo(0.05),
          action: 'employee.version.created',
          actor: 'opsadmin',
        },
        {
          eventId: 'evt_2',
          occurredAt: dayAgo(0.08),
          action: 'weird.custom.event',
        },
      ],
    };
  }
  return { items: [] };
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      new Response(JSON.stringify(bodyFor(String(input))), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderOverview(entry = '/agent') {
  return render(
    <userContext.Provider value={{ user: { user_id: 1 } } as never}>
      <MemoryRouter initialEntries={[entry]}>
        <OverviewPage />
      </MemoryRouter>
    </userContext.Provider>
  );
}

describe('OV-01 redo', () => {
  it('carries no review annotations anywhere on the page', async () => {
    stubFetch();
    renderOverview();
    await screen.findByTestId('agent-v2-ov-updated');
    const text = document.body.textContent ?? '';
    for (const banned of ['参考屏', '评审', '行结构示意', '非真实数据', '暂无数据']) {
      expect(text).not.toContain(banned);
    }
  });

  it('spells the running/unknown residual identically in summary and trend foot', async () => {
    stubFetch();
    renderOverview();
    await screen.findByTestId('agent-v2-ov-trend-summary');
    const summary = screen.getByTestId('agent-v2-ov-trend-summary');
    expect(summary.textContent).toContain('1 条运行中/未知');
    const foot = screen.getByTestId('agent-v2-ov-trend-foot');
    expect(foot.textContent).toContain('1 条运行中/未知（计入总数 14）');
    // KPI-02 now counts TODAY only (5 runs in the fixture), not the 7-day 14.
    expect(screen.getByTestId('agent-v2-ov-kpi-runs').textContent).toContain('5');
    expect(screen.getByTestId('agent-v2-ov-kpi-runs').textContent).toContain('今日运行');
  });

  it('queue: completed tasks never render as actionable; zero rows state the affordance', async () => {
    stubFetch();
    renderOverview();
    const tasks = await screen.findByTestId('agent-v2-ov-queue-tasks');
    expect(tasks.textContent).not.toContain('改价写入');
    expect(tasks.textContent).not.toContain('done');
    expect(tasks.textContent).toContain('周会纪要归档');
    const approvals = screen.getByTestId('agent-v2-ov-queue-approvals');
    expect(approvals.textContent).toContain('这里会出现：待你审批');
    expect(approvals.textContent).toContain('去审批中心');
  });

  it('KPI cards without a trend source keep the dots slot, cards with buckets keep a spark', async () => {
    stubFetch();
    renderOverview();
    await waitFor(() => expect(screen.getByTestId('agent-v2-ov-kpi-onduty-dots')).toBeInTheDocument());
    // 0 pending is an empty state (copy), not a 40px zero with a fake spark slot.
    expect(screen.getByTestId('agent-v2-ov-kpi-pending-empty')).toHaveTextContent('暂无待办审批');
    expect(screen.queryByTestId('agent-v2-ov-kpi-pending-dots')).toBeNull();
    expect(screen.getByTestId('agent-v2-ov-kpi-runs-spark')).toBeInTheDocument();
    expect(screen.getByTestId('agent-v2-ov-kpi-cost-spark')).toBeInTheDocument();
    // 2 active employees → on-duty KPI shows the real value
    expect(screen.getByTestId('agent-v2-ov-kpi-onduty').textContent).toContain('2');
  });

  it('activity localizes known actions and never prints the raw snake_case', async () => {
    stubFetch();
    renderOverview();
    await screen.findAllByTestId('agent-v2-ov-activity-row');
    const block = screen.getByTestId('agent-v2-ov-block-activity');
    expect(block.textContent).toContain('员工版本创建');
    expect(block.textContent).not.toContain('employee.version.created');
    expect(block.textContent).not.toContain('weird.custom.event');
    expect(document.querySelectorAll('.ov-actn .raw')).toHaveLength(0);
    // unknown action falls back to the generic localized name, not raw text
    const zhs = Array.from(document.querySelectorAll('.ov-actn .zh')).map((el) => el.textContent);
    expect(zhs).toContain('审计事件');
  });

  it('heat draws a real 7×24 grid with focus row and hour-axis labels', async () => {
    stubFetch();
    renderOverview();
    await screen.findByTestId('agent-v2-ov-heat-grid');
    expect(screen.getAllByTestId('agent-v2-ov-heat-row-label')).toHaveLength(7);
    // HE06: the current Beijing hour keeps its own testid; total cells stay 7×24.
    expect(
      screen.getAllByTestId('agent-v2-ov-heat-cell').length +
        screen.getAllByTestId('agent-v2-ov-current-cell').length
    ).toBe(7 * 24);
    expect(screen.getAllByTestId('agent-v2-ov-current-cell')).toHaveLength(1);
    const foot = screen.getByTestId('agent-v2-ov-heat-foot');
    expect(foot.textContent).toContain('不画异常档');
  });

  // C2-F7: URL filters are restorable AND clearable in place.
  it('C2-F7: default URL shows no clear control; non-default params reveal 清除条件', async () => {
    stubFetch();
    const { unmount } = renderOverview();
    await screen.findByTestId('agent-v2-ov-updated');
    expect(screen.queryByTestId('agent-v2-ov-clear-filters')).toBeNull();
    unmount();
    renderOverview('/agent?range=7d&weeks=8&focus=cost');
    const clear = await screen.findByTestId('agent-v2-ov-clear-filters');
    expect(clear.textContent).toBe('清除条件');
  });

  it('C2-F7: focus=cost keeps a persistent visible ring on the cost card', async () => {
    stubFetch();
    renderOverview('/agent?focus=cost');
    const cost = await screen.findByTestId('agent-v2-ov-block-cost');
    await waitFor(() => expect(cost.classList.contains('ov-focus-ring')).toBe(true));
  });

  it('C2-F7: clicking 清除条件 strips range/weeks/focus back to defaults (five-step restore)', async () => {
    stubFetch();
    renderOverview('/agent?range=7d&weeks=8&focus=cost');
    const clear = await screen.findByTestId('agent-v2-ov-clear-filters');
    // step 1: defaults were overridden on arrival
    expect(screen.getByTestId('agent-v2-ov-range-7d').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('agent-v2-ov-weeks-8').getAttribute('aria-pressed')).toBe('true');
    const cost = screen.getByTestId('agent-v2-ov-block-cost');
    expect(cost.classList.contains('ov-focus-ring')).toBe(true);
    // step 2-4: one click removes range, weeks and focus together
    fireEvent.click(clear);
    // step 5: page returns to the default window without a reload
    await waitFor(() => {
      expect(screen.getByTestId('agent-v2-ov-range-28d').getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByTestId('agent-v2-ov-weeks-4').getAttribute('aria-pressed')).toBe('true');
      expect(screen.queryByTestId('agent-v2-ov-clear-filters')).toBeNull();
      expect(cost.classList.contains('ov-focus-ring')).toBe(false);
    });
  });
});
