/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * MATRIX-01 read-only employee matrix tests.
 *
 * Same harness as the TasksList suite: stub the global fetch that
 * makeFetcher() uses, route by URL, and mock react-i18next against the REAL
 * zh-Hans resources so raw-key leaks are caught by the DOM guard. The live
 * upstream (/v1/matrix/employees) is NOT deployed — the 404 path below is
 * the CURRENT real behavior, and the assertions demand a human sentence
 * with zero engineering language on screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/components/bs-ui/message', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('react-i18next', async () => {
  const mod = await import('../../../../public/locales/zh-Hans/bs.json');
  const dict: Record<string, unknown> = (mod as { default: Record<string, unknown> }).default;
  const lookup = (key: string): unknown => {
    let cur: unknown = dict;
    for (const part of key.split('.')) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  };
  const t = (key: string, defOrOpts?: unknown): string => {
    const val = lookup(key);
    if (typeof val !== 'string') return typeof defOrOpts === 'string' ? defOrOpts : key;
    if (defOrOpts && typeof defOrOpts === 'object') {
      return val.replace(/\{\{(\w+)\}\}/g, (_m, k: string) =>
        String((defOrOpts as Record<string, unknown>)[k] ?? ''),
      );
    }
    return val;
  };
  return { useTranslation: () => ({ t }) };
});

import MatrixPage from '../MatrixPage';
import { userContext } from '@/contexts/userContext';

let urls: string[] = [];
let matrixStatus = 200;
let matrixBody: unknown = { items: [] };

function stubFetch() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    urls.push(url);
    if (url.includes('/api/matrix')) {
      return {
        ok: matrixStatus >= 200 && matrixStatus < 300,
        status: matrixStatus,
        json: async () => matrixBody,
        headers: { get: () => null },
      } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}), headers: { get: () => null } } as unknown as Response;
  }) as never;
}

function renderPage(entry = '/agent/matrix') {
  return render(
    <userContext.Provider value={{ user: { user_id: 1 } as never }}>
      <MemoryRouter initialEntries={[entry]}>
        <MatrixPage />
      </MemoryRouter>
    </userContext.Provider>,
  );
}

function guardNoRawKeys() {
  const body = document.body.textContent ?? '';
  expect(body).not.toContain('agentConsole.');
  expect(body).not.toContain('[object Object]');
  expect(body).not.toContain('undefined');
}

const ROW_A = {
  employeeId: 'emp_x2',
  name: '小鲤',
  versionRef: 'v3',
  lifecycle: 'active',
  skillCount: 4,
  budget: { monthlyCostUsd: 120, dailyTokens: null, perRunMaxUsd: null, period: '2026-11' },
  todayRuns: { total: 5, succeeded: 4, failed: 1 },
  risk: { blockedApprovals: 2, failedRuns: 1, budgetOver: false },
};
const ROW_B = {
  employeeId: 'emp_x9',
  lifecycle: 'paused',
  budget: null,
  todayRuns: null,
};

beforeEach(() => {
  urls = [];
  matrixStatus = 200;
  matrixBody = { items: [] };
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MATRIX-01 read-only employee matrix', () => {
  it('shows the loading skeleton before the response lands', async () => {
    let release: (v: unknown) => void = () => {};
    globalThis.fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    ) as never;
    renderPage();
    expect(screen.getByTestId('agent-v2-mtx-loading')).toBeTruthy();
    release({ ok: true, status: 200, json: async () => ({ items: [] }), headers: { get: () => null } });
    await waitFor(() => expect(screen.queryByTestId('agent-v2-mtx-loading')).toBeNull());
  });

  it('degrades honestly when the aggregation endpoint is not live (404)', async () => {
    matrixStatus = 404;
    matrixBody = { detail: 'Not Found' };
    renderPage();
    await screen.findByTestId('agent-v2-mtx-error');
    const err = screen.getByTestId('agent-v2-mtx-error');
    const text = err.textContent ?? '';
    // human sentence, zero engineering language on screen:
    expect(text).toContain('暂时读不到员工矩阵');
    expect(text).not.toContain('agent.http');
    expect(text).not.toContain('Not Found');
    expect(text).not.toContain('items');
    expect(text).not.toContain('/api/');
    guardNoRawKeys();
    // retry re-issues the same read-only request
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
    screen.getByTestId('agent-v2-mtx-retry').click();
    await waitFor(() =>
      expect(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
          String(c[0]).includes('/api/matrix'),
        ).length,
      ).toBeGreaterThan(0),
    );
  });

  it('renders the empty state without fabricating rows', async () => {
    matrixStatus = 200;
    matrixBody = { items: [] };
    renderPage();
    await screen.findByTestId('agent-v2-mtx-empty');
    expect(screen.queryAllByTestId('agent-v2-mtx-row')).toHaveLength(0);
    expect((document.body.textContent ?? '').includes('暂无员工')).toBe(true);
    guardNoRawKeys();
  });

  it('renders real rows: lifecycle, version, skills, honest money, risk, detail link', async () => {
    matrixStatus = 200;
    matrixBody = { items: [ROW_A, ROW_B] };
    renderPage();
    const rows = await screen.findAllByTestId('agent-v2-mtx-row');
    expect(rows).toHaveLength(2);

    const [a, b] = rows;
    expect(a.textContent).toContain('小鲤');
    expect(a.textContent).toContain('在岗');
    expect(a.textContent).toContain('v3');
    expect(a.textContent).toContain('技能数');
    // money: fmtUsd only, never ¥/元, never USD 0.00 for null fields
    expect(a.textContent).toContain('USD 120.00');
    expect(a.textContent).not.toContain('¥');
    expect(a.textContent).not.toContain('元');
    expect(a.textContent).not.toContain('USD 0.00');
    // today runs detail + risk
    expect(a.textContent).toContain('受阻审批 2');
    expect(a.textContent).toContain('今日失败 1');
    // detail navigation
    const link = a.querySelector('[data-testid="agent-v2-mtx-link"]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/agent/employees/emp_x2');

    // unknown-name + null budget object → '—', never 「未配置」misuse, never 0
    expect(b.textContent).toContain('未命名员工');
    expect(b.textContent).toContain('暂停');
    const bBudget = b.querySelector('[data-testid="agent-v2-mtx-budget"]') as HTMLElement;
    expect(bBudget.textContent).toContain('—');
    expect(bBudget.textContent).not.toContain('0');

    guardNoRawKeys();
    for (const u of urls) expect(u).toContain('/api/matrix');
    expect(urls.some((u) => u.includes('limit=50'))).toBe(true);
  });

  it('marks a partially configured budget as 未配置, never USD 0.00', async () => {
    matrixStatus = 200;
    matrixBody = {
      items: [{ employeeId: 'emp_x3', name: '小码', lifecycle: 'active', budget: { monthlyCostUsd: null, dailyTokens: 5000 } }],
    };
    renderPage();
    const rows = await screen.findAllByTestId('agent-v2-mtx-row');
    const budget = rows[0].querySelector('[data-testid="agent-v2-mtx-budget"]') as HTMLElement;
    expect(budget.textContent).toContain('未配置');
    expect(budget.textContent).not.toContain('USD 0.00');
    guardNoRawKeys();
  });

  it('passes unknown lifecycle values through verbatim without machine translation', async () => {
    matrixStatus = 200;
    matrixBody = { items: [{ employeeId: 'emp_x7', name: '阿七', lifecycle: 'sabbatical' }] };
    renderPage();
    const rows = await screen.findAllByTestId('agent-v2-mtx-row');
    expect(rows[0].textContent).toContain('sabbatical');
    guardNoRawKeys();
  });

  it('has zero write entry points on the whole page', async () => {
    matrixStatus = 200;
    matrixBody = { items: [ROW_A, ROW_B] };
    renderPage();
    await screen.findAllByTestId('agent-v2-mtx-row');
    expect(document.querySelectorAll('button')).toHaveLength(0);
    expect(document.querySelector('input')).toBeNull();
    expect(document.querySelector('form')).toBeNull();
  });

  it('reads the upstream field spelling: lifecycleState + currentVersionId', async () => {
    matrixStatus = 200;
    matrixBody = {
      items: [
        {
          employeeId: 'emp_u1',
          name: '上游',
          lifecycleState: 'offboarding',
          currentVersionId: 'v7',
        },
      ],
    };
    renderPage();
    const rows = await screen.findAllByTestId('agent-v2-mtx-row');
    const status = rows[0].querySelector('[data-testid="agent-v2-mtx-status"]') as HTMLElement;
    const version = rows[0].querySelector('[data-testid="agent-v2-mtx-version"]') as HTMLElement;
    expect(status.textContent).toBe('离职中');
    expect(version.textContent).toContain('v7');
    expect(version.textContent).not.toMatch(/—\s*$/);
    guardNoRawKeys();
  });

  it('absent risk renders —, never 无风险; zero runs says 今日未运行', async () => {
    matrixStatus = 200;
    matrixBody = {
      items: [{ employeeId: 'emp_u2', name: '空数据', lifecycle: 'active', todayRuns: { total: 0 } }],
    };
    renderPage();
    const rows = await screen.findAllByTestId('agent-v2-mtx-row');
    const risk = rows[0].querySelector('[data-testid="agent-v2-mtx-risk"]') as HTMLElement;
    const runs = rows[0].querySelector('[data-testid="agent-v2-mtx-runs"]') as HTMLElement;
    expect(risk.textContent).not.toContain('无风险');
    expect(risk.textContent?.trim()).toBe('—');
    expect(runs.textContent).toContain('今日未运行');
    guardNoRawKeys();
  });
});
