/* Q2 honesty: missing keys/partial ledgers must never become 0 or a positive
 * claim. Every case below is a real service shape from READ-PORT-MATRIX. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

type Emp = {
  employeeId: string;
  name: string;
  lifecycleState: string;
  enrichment?: { effectiveBudget?: { monthlyCostUsd?: number } };
};

const EMP_A: Emp = {
  employeeId: 'emp_a',
  name: '甲',
  lifecycleState: 'active',
  enrichment: { effectiveBudget: { monthlyCostUsd: 10 } },
};
const EMP_B: Emp = {
  employeeId: 'emp_b',
  name: '乙',
  lifecycleState: 'active',
  enrichment: { effectiveBudget: { monthlyCostUsd: 10 } },
};

let scenario: {
  omitTotals?: boolean;
  missingIds?: string[];
  dueSoon?: number;
  total?: number;
  employees?: Emp[];
  budgetItems?: unknown[];
  matrixBody?: unknown;
} = {};

function bodyFor(url: string): unknown {
  if (url.includes('/api/employee-stats')) {
    return {
      ...(scenario.total !== undefined ? { total: scenario.total } : {}),
      byLifecycle: { active: 1 },
    };
  }
  if (url.includes('/api/approval-stats')) {
    return {
      pending: 0,
      ...(scenario.dueSoon !== undefined ? { dueSoon: scenario.dueSoon } : {}),
    };
  }
  if (url.includes('/api/run-stats')) {
    return {
      buckets: [{ bucketStart: new Date().toISOString(), runs: 3, succeeded: 2, failed: 1, costUsd: 0.03 }],
      ...(scenario.omitTotals
        ? {}
        : {
            totals: {
              runs: 3,
              succeeded: 2,
              failed: 1,
              cancelled: 0,
              interrupted: 0,
              running: 0,
              pending: 0,
              costUsd: 0.03,
              unknownRuns: 0,
              sampleCount: 0,
              successRate: 2 / 3,
            },
          }),
    };
  }
  if (url.includes('/api/run-activity')) return { cells: [], max: 0 };
  if (url.includes('/api/audit')) return { events: [] };
  if (url.includes('/api/budget-usage')) {
    return {
      items:
        scenario.budgetItems ??
        [
          { employeeId: 'emp_a', period: '2026-11-17', periodKind: 'day', costUsd: 0.05 },
          { employeeId: 'emp_b', period: '2026-11-17', periodKind: 'day', costUsd: 0.01 },
        ],
      missingEmployeeIds: scenario.missingIds ?? [],
    };
  }
  if (url.includes('/api/employees')) return { items: scenario.employees ?? [EMP_A, EMP_B] };
  if (url.includes('/api/matrix')) return scenario.matrixBody ?? { items: [] };
  if (url.includes('/api/delegations')) return { items: [] };
  if (url.includes('/api/runs')) return { items: [] };
  return { items: [] };
}

function renderOverview() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      new Response(JSON.stringify(bodyFor(String(input))), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  );
  return render(
    <userContext.Provider value={{ user: { user_id: 1 } } as never}>
      <MemoryRouter initialEntries={['/agent']}>
        <OverviewPage />
      </MemoryRouter>
    </userContext.Provider>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  scenario = {};
});

describe('Q2 honesty: no fake zero or positive claim from missing keys', () => {
  it('R6 totals absent: KPI shows —, never the bucket sum', async () => {
    scenario = { omitTotals: true };
    renderOverview();
    expect(await screen.findByTestId('agent-v2-ov-kpi-runs-value')).toHaveTextContent('—');
    const summary = screen.getByTestId('agent-v2-ov-trend-summary');
    expect(summary.textContent).not.toContain('3次');
    expect(summary.textContent).toContain('—次');
  });

  it('P9 missing ledger rows: cost KPI is — with the missing count, not a partial sum', async () => {
    scenario = { missingIds: ['emp_b'] };
    renderOverview();
    const kpi = await screen.findByTestId('agent-v2-ov-kpi-cost');
    expect(kpi).toHaveTextContent('其中 1 名员工无账本返回');
    expect(kpi.textContent).not.toContain('USD0.05');
    expect(await screen.findByTestId('agent-v2-ov-cost-partial')).toHaveTextContent(
      '其中 1 名员工无账本返回'
    );
    const block = screen.getByTestId('agent-v2-ov-block-cost');
    expect(block.textContent).toContain('— / 20.00');
    expect(block.textContent).not.toContain('剩余 USD20.00');
  });

  it('AP8 dueSoon / E14 total absent: no “今天没有到期单”, no “共 0 名在册”', async () => {
    scenario = { dueSoon: undefined, total: undefined };
    renderOverview();
    const pending = await screen.findByTestId('agent-v2-ov-kpi-pending');
    expect(pending.textContent).not.toContain('今天没有到期单');
    expect(pending.textContent).toContain('—');
    const onduty = screen.getByTestId('agent-v2-ov-kpi-onduty');
    expect(onduty.textContent).not.toContain('共 0 名在册');
    expect(onduty.textContent).toContain('—');
  });

  it('partial monthly budgets: no aggregate quota presented as the tenant budget', async () => {
    scenario = {
      employees: [EMP_A, { ...EMP_B, enrichment: { effectiveBudget: {} } }],
    };
    renderOverview();
    const kpi = await screen.findByTestId('agent-v2-ov-kpi-cost');
    expect(kpi.textContent).not.toContain('占月预算');
    expect(screen.queryByTestId('agent-v2-ov-kpi-cost-quota')).toBeNull();
  });

  it('matrix body without items: error, not “还没有数字员工”', async () => {
    scenario = { matrixBody: {} };
    renderOverview();
    expect(await screen.findByTestId('agent-v2-ov-matrix-error')).toBeTruthy();
    expect(screen.queryByTestId('agent-v2-ov-matrix-empty')).toBeNull();
  });
});