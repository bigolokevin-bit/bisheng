/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * P0-5 v2-3: 「趋势与成本」 detail section (R6 trend / R7 heat / P9 cost)
 * under the real zh-Hans resources. Covers the honest-data rules from
 * CR-031/CR-032: missing p95 → 样本不足, estimatedRuns>0 → 含估算,
 * empty series → empty state with no drawn bars, missing ledger row →
 * 无成本记录 (never 0.00), per-block error states.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@/components/bs-ui/message', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('react-i18next', async () => {
  const mod = (await import('../../../../public/locales/zh-Hans/bs.json')) as {
    default: Record<string, unknown>;
  };
  const dict = mod.default;
  const t = (key: unknown, def?: unknown): string => {
    const value = String(key)
      .split('.')
      .reduce<unknown>(
        (acc, part) =>
          acc && typeof acc === 'object'
            ? (acc as Record<string, unknown>)[part]
            : undefined,
        dict,
      );
    if (typeof value === 'string') return value;
    if (typeof def === 'string') return def;
    return String(key);
  };
  return { useTranslation: () => ({ t }) };
});

import { AgentConsoleV2Page } from '../AgentConsoleV2Page';
import { userContext } from '@/contexts/userContext';
import type {
  AgentConsoleTrendsApi,
  BudgetUsageResponse,
  RunActivityResponse,
  RunStatsResponse,
} from '@/controllers/API/agentConsoleTrends';

const EMP = {
  employeeId: 'emp_1',
  tenantId: 't',
  name: 'Koi Claw',
  title: 'assistant',
  lifecycleState: 'active',
  currentVersionId: 'ver_1',
  ownerUserId: 'opsadmin',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-11-13T00:00:00Z',
};

const consoleApi = {
  listEmployees: vi.fn().mockResolvedValue({ items: [EMP] }),
  countPendingApprovals: vi.fn().mockResolvedValue({ ok: true, data: { count: 0 } }),
  getEmployee: vi.fn().mockResolvedValue({ ok: true, data: EMP }),
  getEffectiveConfig: vi.fn().mockResolvedValue({ ok: true, data: { employee: EMP, grants: [] } }),
  getWorkstations: vi.fn().mockResolvedValue({ ok: true, data: { items: [] } }),
} as never;

const approvalsApi = {
  listApprovals: vi.fn().mockResolvedValue({ ok: true, data: { items: [] } }),
} as never;

afterEach(() => {
  cleanup();
});

function trendsApi(over: {
  stats?: RunStatsResponse | { ok: false };
  activity?: RunActivityResponse | { ok: false };
  budget?: BudgetUsageResponse | { ok: false };
}): AgentConsoleTrendsApi {
  const stats = over.stats ?? { buckets: [] };
  const activity = over.activity ?? { cells: [] };
  const budget = over.budget ?? { items: [], missingEmployeeIds: [EMP.employeeId] };
  return {
    getRunStats: vi
      .fn()
      .mockResolvedValue('buckets' in stats ? { ok: true, status: 200, data: stats } : stats),
    getRunActivity: vi
      .fn()
      .mockResolvedValue('cells' in activity ? { ok: true, status: 200, data: activity } : activity),
    getBudgetUsage: vi
      .fn()
      .mockResolvedValue('items' in budget ? { ok: true, status: 200, data: budget } : budget),
  } as unknown as AgentConsoleTrendsApi;
}

async function openTrends(api: AgentConsoleTrendsApi) {
  render(
    <userContext.Provider
      value={{ user: { user_id: 1, web_menu: ['admin', 'agent'] }, setUser: vi.fn(), savedComponents: [], addSavedComponent: vi.fn(), checkComponentsName: vi.fn(), delComponent: vi.fn() } as never}
    >
      <AgentConsoleV2Page consoleApi={consoleApi} approvalsApi={approvalsApi} trendsApi={api} />
    </userContext.Provider>,
  );
  await screen.findByText('Koi Claw');
  fireEvent.click(screen.getAllByText('详情')[0]);
  const section = await screen.findByTestId('agent-v2-trends');
  await waitFor(() => expect(section.textContent).not.toContain('加载中…'));
  return section;
}

describe('console v2 trends & costs section (P0-5)', () => {
  it('R6: missing p95 shows 样本不足 and estimatedRuns>0 shows 含估算, bars render', async () => {
    const section = await openTrends(
      trendsApi({
        stats: {
          buckets: [
            { period: '2026-11-08', succeeded: 3, failed: 1, upstreamRuns: 4, estimatedRuns: 0 },
            { period: '2026-11-09', succeeded: 0, failed: 2, upstreamRuns: 0, estimatedRuns: 5, costUsd: 1.2 },
          ],
        },
      }),
    );
    expect(within(section).getByTestId('agent-v2-trend-p95').textContent).toBe('样本不足');
    expect(within(section).getByTestId('agent-v2-trend-chip-estimated').textContent).toBe('含估算');
    expect(within(section).queryByTestId('agent-v2-trend-chip-uncounted')).toBeNull();
    expect(within(section).getAllByTestId('agent-v2-trend-bar')).toHaveLength(2);
  });

  it('R6: p95 present shows the number; empty buckets show empty state with zero bars', async () => {
    const section = await openTrends(
      trendsApi({ stats: { buckets: [{ period: '2026-11-10', succeeded: 9, failed: 0, p95DurationMs: 1830 }] } }),
    );
    expect(within(section).getByTestId('agent-v2-trend-p95').textContent).toBe('1830 ms');
    cleanup();

    const empty = await openTrends(trendsApi({ stats: { buckets: [] } }));
    expect(within(empty).getByTestId('agent-v2-trend-empty').textContent).toBe('暂无运行数据');
    expect(within(empty).queryAllByTestId('agent-v2-trend-bar')).toHaveLength(0);
  });

  it('R6 error state is explicit and local to the block', async () => {
    const section = await openTrends(
      trendsApi({ stats: { ok: false } as never, activity: { cells: [{ dow: 1, hour: 9, count: 2 }], max: 2 } }),
    );
    expect(within(section).getByTestId('agent-v2-trend-error').textContent).toBe('趋势数据获取失败');
    expect(within(section).getByTestId('agent-v2-heat-grid')).toBeTruthy();
  });

  it('R7: ISO dow cells lay out with Sun-first rows and scale from max', async () => {
    const section = await openTrends(
      trendsApi({
        activity: {
          cells: [
            { dow: 1, hour: 9, count: 8 },
            { dow: 7, hour: 23, count: 2 },
          ],
          max: 8,
        },
      }),
    );
    const rows = within(section).getAllByTestId('agent-v2-heat-cell');
    expect(rows).toHaveLength(168);
    // Mon 09:00 = hottest (level 4); Sun 23:00 = level 1 (ceil(2/8*4)).
    const titles = rows.map((c) => c.getAttribute('title') ?? '');
    expect(titles.some((x) => x.startsWith('周一 09:00'))).toBe(true);
    expect(titles.some((x) => x.startsWith('周日 23:00'))).toBe(true);
    const mon9 = rows.find((c) => (c.getAttribute('title') ?? '').startsWith('周一 09:00'))!;
    const sun23 = rows.find((c) => (c.getAttribute('title') ?? '').startsWith('周日 23:00'))!;
    expect(mon9.className).toContain('is-l4');
    expect(sun23.className).toContain('is-l1');
    expect(within(section).queryByTestId('agent-v2-heat-empty')).toBeNull();
  });

  it('R7: no cells renders the empty state only, never a fake grid', async () => {
    const section = await openTrends(trendsApi({ activity: { cells: [] } }));
    expect(within(section).getByTestId('agent-v2-heat-empty').textContent).toBe('暂无活动数据');
    expect(within(section).queryByTestId('agent-v2-heat-grid')).toBeNull();
  });

  it('P9: missing ledger row shows 无成本记录 and never 0.00', async () => {
    const section = await openTrends(trendsApi({}));
    expect(within(section).getByTestId('agent-v2-cost-missing').textContent).toBe('无成本记录');
    expect(within(section).getByTestId('agent-v2-cost').textContent).not.toContain('0.00');
  });

  it('P9: cost row renders two decimals; estimated marker shows 含估算', async () => {
    const section = await openTrends(
      trendsApi({
        budget: {
          items: [
            { employeeId: EMP.employeeId, period: '2026-11', periodKind: 'month', costUsd: 12.5, estimated: true },
          ],
        },
      }),
    );
    expect(within(section).getByTestId('agent-v2-cost-value').textContent).toBe('12.50');
    expect(within(section).getByTestId('agent-v2-cost-chip-estimated').textContent).toBe('含估算');
    expect(within(section).queryByTestId('agent-v2-cost-missing')).toBeNull();
  });

  it('P9: uncounted cost shows 成本未知 + 含未记账 instead of a number', async () => {
    const section = await openTrends(
      trendsApi({
        budget: {
          items: [
            { employeeId: EMP.employeeId, period: '2026-11', periodKind: 'month', costStatus: 'unknown' },
          ],
        },
      }),
    );
    expect(within(section).getByTestId('agent-v2-cost-value').textContent).toBe('成本未知');
    expect(within(section).getByTestId('agent-v2-cost-chip-uncounted').textContent).toBe('含未记账');
  });

  it('per-block errors degrade independently', async () => {
    const section = await openTrends(
      trendsApi({ stats: { ok: false } as never, activity: { ok: false } as never, budget: { ok: false } as never }),
    );
    expect(within(section).getByTestId('agent-v2-trend-error')).toBeTruthy();
    expect(within(section).getByTestId('agent-v2-heat-error').textContent).toBe('活动数据获取失败');
    expect(within(section).getByTestId('agent-v2-cost-error').textContent).toBe('成本数据获取失败');
  });

  it('requests the documented BFF params (bucket=day, weeks=4, tz, month period)', async () => {
    const api = trendsApi({});
    await openTrends(api);
    expect(api.getRunStats).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: 'emp_1', bucket: 'day', from: expect.any(String), to: expect.any(String) }),
    );
    expect(api.getRunActivity).toHaveBeenCalledWith({ weeks: 4, employeeId: 'emp_1', tz: 'Asia/Shanghai' });
    expect(api.getBudgetUsage).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId: 'emp_1', periodKind: 'month', period: expect.stringMatching(/^\d{4}-\d{2}$/) }),
    );
  });
});
