/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * OV-01 error states: a failed block shows a human reason, the gateway
 * request id (copyable), and a block-level retry; retry recovers real data
 * once the endpoint is healthy. Engineering detail stays off screen.
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
        dict,
      );
    if (typeof value !== 'string') return String(key);
    const options = (opts ?? {}) as Record<string, unknown>;
    // mirror i18next: {{var}} interpolation only
    return value.replace(/\{\{(\w+)\}\}/g, (m, name: string) =>
      name in options ? String(options[name]) : m
    );
  };
  return { useTranslation: () => ({ t }) };
});

import { OverviewPage } from '../OverviewPage';
import { userContext } from '@/contexts/userContext';

type Mode = 'fail' | 'ok';
let mode: Mode = 'fail';

const EMP = { employeeId: 'emp_1', name: '鲤爪' };

function bodyFor(url: string): unknown {
  if (url.includes('/api/employee-stats')) return { total: 1, byLifecycle: { active: 1 } };
  if (url.includes('/api/approval-stats')) return { pending: 0, dueSoon: 0 };
  if (url.includes('/api/run-stats')) {
    const day = new Date().toISOString();
    return {
      from: day,
      to: day,
      bucket: 'day',
      buckets: [{ bucketStart: day, runs: 3, succeeded: 2, failed: 1, costUsd: 0.03 }],
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
    };
  }
  if (url.includes('/api/run-activity')) return { cells: [], max: 0 };
  if (url.includes('/api/audit')) return { events: [] };
  if (url.includes('/api/budget-usage')) return { items: [], missingEmployeeIds: [] };
  if (url.includes('/api/employees')) return { items: [EMP] };
  return { items: [] };
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (mode === 'fail' && url.includes('/api/run-stats')) {
        return new Response(JSON.stringify({ code: 'agent.http.500' }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'X-Console-Request-Id': 'req-test-500',
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
});

function renderOverview() {
  return render(
    <userContext.Provider
      value={{ user: { user_id: 1 } } as never}
    >
      <MemoryRouter initialEntries={['/agent']}>
        <OverviewPage />
      </MemoryRouter>
    </userContext.Provider>
  );
}

describe('OV-01 fix B (G10) block-level error states', () => {
  it('run-stats 500 renders trend + KPI error copy with request id and retry', async () => {
    mode = 'fail';
    stubFetch();
    renderOverview();

    const retry = await screen.findByTestId('agent-v2-ov-retry-trend');
    expect(retry).toBeInTheDocument();

    const trendError = screen.getByTestId('agent-v2-ov-trend-error');
    expect(trendError.textContent).toContain('趋势数据获取失败');
    expect(trendError.textContent).toContain('请求编号');
    expect(trendError.textContent).toContain('req-test-500');
    // no engineering detail: status codes / dotted machine codes stay off screen
    expect(trendError.textContent).not.toContain('HTTP');

    expect(screen.getByTestId('agent-v2-ov-retry-kpi-runs')).toBeInTheDocument();
    const runsError = screen.getByTestId('agent-v2-ov-kpi-runs-error');
    expect(runsError.textContent).toContain('查询失败');
    expect(runsError.textContent).not.toContain('HTTP');
    const codeish = /[a-z]+\.[a-z_]+/;
    expect(runsError.textContent ?? '').not.toMatch(codeish);
    document
      .querySelectorAll('[data-testid$="-error"]')
      .forEach((el) => expect(el.textContent ?? '').not.toMatch(codeish));
    expect(screen.getByTestId('agent-v2-ov-kpi-runs-reqid').textContent).toContain('req-test-500');

    // other blocks are untouched by the failure
    expect(screen.getByTestId('agent-v2-ov-block-anomaly')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-v2-ov-trend-bars')).toBeNull();
  });

  it('block retry recovers real data when the endpoint turns healthy', async () => {
    mode = 'fail';
    stubFetch();
    renderOverview();

    const retry = await screen.findByTestId('agent-v2-ov-retry-trend');
    mode = 'ok';
    fireEvent.click(retry);

    await waitFor(() =>
      expect(screen.getByTestId('agent-v2-ov-trend-bars')).toBeInTheDocument()
    );
    // fix B (G15): after retry the runs KPI shows the recovered real value.
    await waitFor(() =>
      expect(screen.getByTestId('agent-v2-ov-kpi-runs').textContent).toContain('3')
    );
    expect(screen.queryByTestId('agent-v2-ov-trend-error')).toBeNull();
    expect(screen.queryByTestId('agent-v2-ov-retry-trend')).toBeNull();
    // heat never failed, so it must not carry a retry affordance either
    expect(screen.queryByTestId('agent-v2-ov-retry-heat')).toBeNull();
  });
});
