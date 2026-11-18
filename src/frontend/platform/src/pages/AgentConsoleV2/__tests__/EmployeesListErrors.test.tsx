/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * EMP-03 detail honesty suite (S3-W2): placeholder owner, full Beijing
 * timestamps, the three budget states, whole-page access states and the
 * chat link. Machine codes never reach the screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

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

import { EmployeeDetailPage } from '../EmployeeDetailPage';
import { userContext } from '@/contexts/userContext';

const EMP = 'emp_AB12CD34';
const AT = '2026-11-17T12:12:00Z';

let urls: string[] = [];
let detailStatus = 200;
let detailBody: Record<string, unknown> = {};
let versionBudget: Record<string, unknown> | undefined = { monthlyCostUsd: 10 };

function response(status: number, body: unknown, requestId: string | null = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: (name: string) => (name.toLowerCase() === 'x-console-request-id' ? requestId : null) },
  } as unknown as Response;
}

function route(url: string): Response {
  if (url.includes('/api/employee?')) return response(detailStatus, detailBody, 'req-1');
  if (url.includes('/api/employee-versions')) {
    return response(200, {
      items: currentVersionId
        ? [
            {
              id: 'v3',
              employeeId: EMP,
              versionNo: 3,
              effectiveFrom: AT,
              effectiveTo: null,
              budget: versionBudget,
            },
          ]
        : [],
    });
  }
  if (url.includes('/api/effective-config')) {
    return response(200, { employee: detailBody, version: null, grants: [], resolvedAt: AT });
  }
  if (url.includes('/api/workstations')) return response(200, { items: [] });
  if (url.includes('/api/run-stats')) return response(200, { buckets: [] });
  if (url.includes('/api/budget-usage')) {
    return response(200, { items: [{ employeeId: EMP, period: '2026-11', costUsd: 12.5 }] });
  }
  if (url.includes('/api/approval-stats')) return response(200, { pending: 0, dueSoon: 0 });
  return response(200, { items: [] });
}

let currentVersionId = 'v3';

function renderDetail(entry = `/agent/employees/${EMP}`) {
  return render(
    <userContext.Provider value={{ user: { user_id: 9, user_name: '小浩' } } as never}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/agent/employees/:id" element={<EmployeeDetailPage />} />
        </Routes>
      </MemoryRouter>
    </userContext.Provider>,
  );
}

function guardNoRawKeys() {
  const body = document.body.textContent ?? '';
  expect(body).not.toContain('agentConsole.');
  expect(body).not.toContain('pilot_owner_placeholder');
  expect(body).not.toContain('[object Object]');
  expect(body).not.toContain('undefined');
}

beforeEach(() => {
  urls = [];
  detailStatus = 200;
  currentVersionId = 'v3';
  versionBudget = { monthlyCostUsd: 10 };
  detailBody = {
    id: EMP,
    name: '小鲤',
    title: '产品助理',
    lifecycleState: 'active',
    ownerUserId: 'human:9',
    currentVersionId: 'v3',
    revision: 2,
    createdAt: AT,
    updatedAt: AT,
  };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    urls.push(url);
    return route(url);
  }) as never;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EMP-03 employee detail honesty', () => {
  it('renders the identity and the current version', async () => {
    renderDetail();
    expect((await screen.findAllByText('小鲤')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('产品助理').length).toBeGreaterThan(0);
    expect(screen.getAllByText('v3').length).toBeGreaterThan(0);
    guardNoRawKeys();
  });

  it('shows a placeholder owner as 未指派 and never calls approval-stats for it', async () => {
    detailBody = { ...detailBody, ownerUserId: 'pilot_owner_placeholder' };
    renderDetail();
    const owner = await screen.findByTestId('agent-v2-ed-owner');
    expect(owner.textContent).toBe('未指派');
    expect(document.body.textContent).not.toContain('pilot_owner_placeholder');
    expect(screen.queryByTestId('agent-v2-ed-help-owner')).toBeNull();
    expect(urls.some((u) => u.includes('/api/approval-stats'))).toBe(false);
    guardNoRawKeys();
  });

  it('prints effective times as full Beijing minutes', async () => {
    renderDetail();
    await screen.findAllByText('小鲤');
    expect(document.body.textContent).toContain('2026-11-17 20:12');
    expect(document.body.textContent).not.toContain('2026-11-17T12:12');
  });

  it('prints the configured monthly limit in the PRD money format', async () => {
    renderDetail();
    const row = await screen.findByTestId('agent-v2-ed-budget-row');
    expect(row.textContent).toContain('月度成本上限 $10.00');
    expect(row.textContent).toContain('日 token 额度 —');
    expect(row.textContent).toContain('单次上限 —');
    expect(row.textContent).not.toContain('USD');
  });

  it('reads a budget object with no limits as not configured, not zero', async () => {
    versionBudget = {};
    renderDetail();
    const row = await screen.findByTestId('agent-v2-ed-budget-row');
    expect(row.textContent).toBe('本版本未配置预算');
    expect(row.textContent).not.toContain('$0.00');
  });

  it('reads an absent budget object as unknown (—)', async () => {
    currentVersionId = '';
    renderDetail();
    const row = await screen.findByTestId('agent-v2-ed-budget-row');
    expect(row.textContent).toBe('—');
  });

  it('shows the ledger actual in USD with two decimals', async () => {
    renderDetail();
    const actual = await screen.findByTestId('agent-v2-ed-budget-actual');
    expect(actual.textContent).toContain('$12.50');
    expect(document.body.textContent).not.toContain('USD 12.50');
  });

  it('links the chat panel to the chat page with the employee id', async () => {
    renderDetail();
    await screen.findAllByText('小鲤');
    const tabs = screen.getAllByRole('tab');
    fireEvent.click(tabs[1]);
    const link = await screen.findByTestId('agent-v2-ed-chat-link');
    expect(link.getAttribute('href')).toBe(`/agent/chat?employeeId=${EMP}`);
  });

  it('keeps a request number on the 404 whole-page state and offers the way back', async () => {
    detailStatus = 404;
    detailBody = { code: 'employee.not_found' };
    renderDetail();
    const card = await screen.findByTestId('agent-v2-ed-notFound');
    expect(card.textContent).toContain('员工不存在或无权访问');
    expect(card.textContent).toContain('req-1');
    expect(screen.queryByText('小鲤')).toBeNull();
    expect(screen.getByText('返回员工列表').closest('a')?.getAttribute('href')).toBe(
      '/agent/employees',
    );
  });

  it('shows the same neutral body for 403 and 404', async () => {
    detailStatus = 403;
    detailBody = { code: 'console.forbidden' };
    renderDetail();
    const card = await screen.findByTestId('agent-v2-ed-forbidden');
    expect(card.textContent).toContain('员工不存在或无权访问');
    expect(card.textContent).not.toContain('无权限查看该员工');
    expect(card.textContent).toContain('req-1');
  });

  it('separates an expired session from both access states', async () => {
    detailStatus = 401;
    detailBody = { code: 'console.unauthenticated' };
    renderDetail();
    const card = await screen.findByTestId('agent-v2-ed-unauthorized');
    expect(card.textContent).toContain('登录已失效');
  });

  it('keeps a network failure as 未能读取 with retry, never not found', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('offline');
    }) as never;
    renderDetail();
    const card = await screen.findByTestId('agent-v2-ed-readFailed');
    expect(card.textContent).toContain('无法连接员工服务');
    expect(card.textContent).toContain('未提供');
    expect(screen.queryByTestId('agent-v2-ed-notFound')).toBeNull();
  });

  it('renders a real owner as a readable name and keeps the raw ref in the title only', async () => {
    renderDetail();
    const owner = await screen.findByTestId('agent-v2-ed-owner');
    expect(owner.textContent).toBe('小浩');
    expect((owner as HTMLElement).title).toBe('human:9');
    guardNoRawKeys();
  });

  it('does not leak machine codes into any state', async () => {
    detailStatus = 500;
    detailBody = { code: 'console.upstream_error' };
    renderDetail();
    const card = await screen.findByTestId('agent-v2-ed-unavailable');
    expect(card.textContent).toContain('本次未能读取');
    expect(card.textContent).toContain('请求编号');
    expect(card.textContent).not.toContain('HTTP');
    expect(screen.queryByTestId('agent-v2-ed-notFound')).toBeNull();
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('console.upstream_error');
  });
});