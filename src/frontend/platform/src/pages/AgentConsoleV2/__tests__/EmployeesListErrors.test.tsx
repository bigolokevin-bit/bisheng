/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * EMP-01 r5 (G15): the employees list error states must render fully
 * localized copy — 401 / 403 / generic 5xx each readable on its own, HTTP
 * status only as an interpolation parameter, and internal machine codes
 * (console.forbidden, run.invalid_query, budget.range_too_large,
 * agent.http.*) never in the DOM. The requestId is reachable only through
 * the explicit "复制诊断" control, which copies the request id alone —
 * never the bearer token, never the response body.
 *
 * Unlike the raw-key suite, this file mocks react-i18next with the real
 * zh-Hans dictionary (same idiom as OverviewErrors.test.tsx), so the strict
 * "no dotted identifier anywhere" check is meaningful: a missing key would
 * render its dotted path and fail the assertion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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

import { EmployeesListPage } from '../EmployeesListPage';

const REQ_ID = 'req_emp01_diag';
const TOKEN = 'tok_sup3r_secret';

const EMP = {
  employeeId: 'emp_AAAAAAAAAAAAAAAAAAAAAAAA',
  name: '鲤爪',
  lifecycleState: 'active',
  ownerUserId: 'user_1',
};

type Mode = 'ok' | 'list500' | 'list403' | 'list401' | 'budget500';
let mode: Mode = 'ok';

function bodyFor(url: string): unknown {
  if (url.includes('/api/employees')) {
    if (mode === 'list403') return { code: 'console.forbidden', message: 'no' };
    if (mode === 'list401') return { code: 'console.unauthenticated', message: 'expired' };
    if (mode === 'list500') return { code: 'run.invalid_query', message: 'bad' };
    return { items: [EMP] };
  }
  if (url.includes('/api/employee-stats')) return { total: 1, byLifecycle: { active: 1 } };
  if (url.includes('/api/approval-stats')) return { pending: 0, dueSoon: 0 };
  if (url.includes('/api/budget-usage')) {
    if (mode === 'budget500') return { code: 'budget.range_too_large', message: 'too wide' };
    return { items: [], missingEmployeeIds: [EMP.employeeId] };
  }
  if (url.includes('/api/run-activity')) return { cells: [], max: 0 };
  if (url.includes('/api/run-stats')) return { buckets: [] };
  if (url.includes('/api/workstations')) return { items: [] };
  return { items: [] };
}

function statusFor(url: string): number {
  if (url.includes('/api/employees') && mode === 'list500') return 500;
  if (url.includes('/api/employees') && mode === 'list403') return 403;
  if (url.includes('/api/employees') && mode === 'list401') return 401;
  if (url.includes('/api/budget-usage') && mode === 'budget500') return 500;
  return 200;
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const status = statusFor(url);
      return new Response(JSON.stringify(bodyFor(url)), {
        status,
        headers: { 'Content-Type': 'application/json', 'X-Console-Request-Id': REQ_ID },
      });
    })
  );
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/agent/employees']}>
      <EmployeesListPage />
    </MemoryRouter>
  );
}

// Machine-code shape: dotted lowercase identifiers such as console.forbidden,
// budget.range_too_large or agent.http.500. With the real dictionary loaded,
// NOTHING on this page legitimately matches — raw i18n keys would too.
const CODEISH = /[a-z]+\.[a-z_]+/;

function pageText() {
  return screen.getByTestId('agent-v2-employees-page').textContent ?? '';
}

beforeEach(() => {
  mode = 'ok';
  localStorage.setItem('ws_token', TOKEN);
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('EMP-01 r5 localized error states (G15)', () => {
  it('generic 500: readable copy + HTTP status, machine code absent everywhere, retry kept', async () => {
    mode = 'list500';
    renderPage();
    await screen.findByTestId('agent-v2-employees-error');
    const text = pageText();
    expect(text).toContain('查询失败，请重试');
    expect(text).toContain('数字员工暂时取不到（HTTP 500）');
    expect(text).toContain('复制诊断');
    expect(text).toContain('重试');
    // the injected machine code (run.invalid_query) and the request id are
    // not in the DOM at all — requestId lives behind the copy control only.
    expect(text).not.toMatch(CODEISH);
    expect(text).not.toContain(REQ_ID);
    expect(text).not.toContain(TOKEN);
    expect(screen.getByTestId('agent-v2-employees-retry')).toBeInTheDocument();
  });

  it('403: no-permission copy, no console.forbidden in the DOM', async () => {
    mode = 'list403';
    renderPage();
    await screen.findByTestId('agent-v2-employees-403');
    const text = pageText();
    expect(text).toContain('没有管理控制台权限');
    expect(text).toContain('当前账号没有管理数字员工的权限');
    expect(text).not.toMatch(CODEISH);
    expect(text).not.toContain(REQ_ID);
  });

  it('401: session-expired copy, no console.unauthenticated in the DOM', async () => {
    mode = 'list401';
    renderPage();
    await screen.findByTestId('agent-v2-employees-auth');
    const text = pageText();
    expect(text).toContain('登录已失效');
    expect(text).toContain('登录状态已失效，请重新登录后重试。');
    expect(text).not.toMatch(CODEISH);
    expect(text).not.toContain(REQ_ID);
  });

  it('budget-usage 500: cost KPI shows 「—」 + one reason line, never HTTP 500 or budget.range_too_large', async () => {
    mode = 'budget500';
    renderPage();
    await screen.findByTestId('agent-v2-kpi-cost-error');
    const text = pageText();
    // P0-1: one neutral reason, no HTTP status, no machine code, no bare key.
    expect(text).toContain('成本数据暂时不可用');
    expect(text).not.toContain('HTTP');
    expect(text).not.toContain('暂时取不到');
    expect(text).not.toMatch(CODEISH);
    expect(text).not.toContain(REQ_ID);
    // same shape as the healthy card: the value line still renders 「—」
    expect(screen.getByTestId('agent-v2-kpi-cost').textContent).toBe('—');
    // the list itself is healthy and must render the table, not a page error
    expect(screen.getByTestId('agent-v2-employees-table')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-v2-employees-error')).toBeNull();
  });

  it('P0-1: KPI failure DOM is theme/breakpoint independent — one reason line, never a status code', async () => {
    mode = 'budget500';
    renderPage();
    const reason = await screen.findByTestId('agent-v2-kpi-cost-error');
    // the exact text is the dictionary value regardless of theme tokens, so
    // dark / light / 375 all render this same node with the same string
    expect(reason.textContent).toBe('成本数据暂时不可用');
    expect(reason.textContent).not.toMatch(/\d{3}/);
    // the old code-in-parentheses shape had no value line at all
    const card = reason.parentElement as HTMLElement;
    expect(card.textContent).toContain('—');
    expect(card.textContent).toContain('复制诊断');
  });

  it('P0-2: owner cell renders the full human ref, never a bare uid', async () => {
    EMP.ownerUserId = '1';
    try {
      renderPage();
      const cell = await screen.findByTestId('agent-v2-col-owner');
      expect(cell.textContent).toBe('human:1');
      expect(cell.textContent).not.toBe('1');
      expect(cell.getAttribute('title')).toBe('human:1');
    } finally {
      EMP.ownerUserId = 'user_1';
    }
  });

  it('copy diagnostics puts only the requestId on the clipboard — never token or code', async () => {
    mode = 'list500';
    const writeText = vi.fn(async (value: string) => value);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderPage();
    await screen.findByTestId('agent-v2-employees-error');
    fireEvent.click(screen.getByTestId('agent-v2-employees-diag'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = String(writeText.mock.calls[0][0]);
    expect(copied).toBe(REQ_ID);
    expect(copied).not.toContain(TOKEN);
    expect(copied).not.toMatch(CODEISH);
    await waitFor(() =>
      expect(screen.getByTestId('agent-v2-employees-diag').textContent).toContain('已复制')
    );
  });

  it('healthy state regression: table renders, no error copy anywhere', async () => {
    mode = 'ok';
    renderPage();
    await screen.findByTestId('agent-v2-employees-table');
    const text = pageText();
    expect(text).toContain('鲤爪');
    expect(text).not.toContain('暂时取不到');
    expect(text).not.toContain('查询失败');
    expect(text).not.toContain('复制诊断');
    expect(text).not.toMatch(CODEISH);
    expect(screen.queryByTestId('agent-v2-employees-error')).toBeNull();
    expect(screen.queryByTestId('agent-v2-kpi-cost-error')).toBeNull();
  });
});
