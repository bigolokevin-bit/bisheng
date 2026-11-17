/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * EMP-01 employee list (S3-W2). The suite pins the PRD v0.3 contract:
 * six columns, a default 在岗 filter, a real create entry, per-row chat link,
 * honest budget states and no engineering language on screen.
 */
import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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

import { EmployeesListPage } from '../EmployeesListPage';
import { todayBeijingWindow } from '../employeesShared';
import { userContext } from '@/contexts/userContext';

const EMP_A = {
  employeeId: 'emp_AB12CD34',
  name: '小鲤',
  title: '产品助理',
  lifecycleState: 'active',
  ownerUserId: 'human:7',
  skillCount: 4,
  enrichment: { effectiveBudget: { monthlyCostUsd: 1200 } },
};
const EMP_B = {
  employeeId: 'emp_EF56GH78',
  name: '阿墨',
  title: '渠道分析',
  lifecycleState: 'paused',
  ownerUserId: 'pilot_owner_placeholder',
  enrichment: { effectiveBudget: {} },
};
const EMP_C = {
  employeeId: 'emp_IJ90KL12',
  name: '无预算',
  lifecycleState: 'active',
};

let urls: string[] = [];
let listStatus = 200;
let listBody: unknown = { items: [EMP_A, EMP_B, EMP_C], nextCursor: null };
let listRequestId: string | null = null;
let runStatus = 200;
let runRequestId: string | null = null;
let listByCursor: Record<string, unknown> = {};

function response(status: number, body: unknown, requestId: string | null = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: (name: string) => (name.toLowerCase() === 'x-console-request-id' ? requestId : null) },
  } as unknown as Response;
}

function stubFetch() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    urls.push(url);
    if (url.includes('/api/employees')) {
      const cursor = new URL(url, 'http://x').searchParams.get('cursor');
      if (cursor && listByCursor[cursor]) return response(200, listByCursor[cursor], listRequestId);
      return response(listStatus, listBody, listRequestId);
    }
    if (url.includes('/api/run-stats')) {
      return response(runStatus, { buckets: [{ bucketStart: '2026-11-17T00:00:00Z', runs: 3, succeeded: 2, failed: 1 }] }, runRequestId);
    }
    return response(200, {});
  }) as never;
}

function renderPage(entry = '/agent/employees') {
  return render(
    <userContext.Provider value={{ user: { user_id: 9, user_name: '小浩' } } as never}>
      <MemoryRouter initialEntries={[entry]}>
        <EmployeesListPage />
      </MemoryRouter>
    </userContext.Provider>,
  );
}

function guardNoRawKeys() {
  const body = document.body.textContent ?? '';
  expect(body).not.toContain('agentConsole.');
  expect(body).not.toContain('[object Object]');
  expect(body).not.toContain('undefined');
  expect(body).not.toContain('emp_');
  expect(body).not.toContain('pilot_owner_placeholder');
}

beforeEach(() => {
  urls = [];
  listStatus = 200;
  listBody = { items: [EMP_A, EMP_B, EMP_C], nextCursor: null };
  listRequestId = null;
  runStatus = 200;
  runRequestId = null;
  listByCursor = {};
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EMP-01 employee list', () => {
  it('shows the skeleton before the list lands', async () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as never;
    renderPage();
    expect(screen.getByTestId('agent-v2-employees-loading')).toBeTruthy();
  });

  it('asks for the on-duty page with enrichment, no total and no matrix route', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-emp-table');
    const url = urls.find((u) => u.includes('/api/employees')) ?? '';
    expect(url).toContain('lifecycleState=active');
    expect(url).toContain('limit=20');
    expect(decodeURIComponent(url)).toContain('expand=version,workstations,knowledge,pending');
    expect(urls.some((u) => u.includes('/api/matrix'))).toBe(false);
  });

  it('renders the six PRD columns plus the action column', async () => {
    renderPage();
    const table = await screen.findByTestId('agent-v2-emp-table');
    const headers = Array.from(table.querySelectorAll('[role="columnheader"]')).map(
      (node) => node.textContent,
    );
    expect(headers).toEqual(['名称', '短码', '岗位', '技能数', '今日运行', '月度预算', '动作']);
  });

  it('prints a real name, the readable short code and the role', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-emp-table');
    expect(screen.getByTestId('agent-v2-emp-name-emp_AB12CD34').textContent).toBe('小鲤');
    expect(screen.getByTestId('agent-v2-emp-code-emp_AB12CD34').textContent).toBe('员工 · AB12CD34');
    expect(screen.getByTestId('agent-v2-emp-row-emp_AB12CD34').textContent).toContain('产品助理');
    const pill = screen.getByTestId('agent-v2-emp-row-emp_AB12CD34').querySelector('.emp-pill');
    expect(pill?.getAttribute('title')).toBe('active');
    guardNoRawKeys();
  });

  /* Q2: the short code is the only identity on screen; the native id is a
   * tooltip, never body text. */
  it('never prints a raw employee id in visible text; the raw value lives in title', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-emp-table');
    const code = screen.getByTestId('agent-v2-emp-code-emp_AB12CD34');
    expect(code.textContent).toBe('员工 · AB12CD34');
    expect(code.getAttribute('title')).toBe('emp_AB12CD34');
    expect(document.body.textContent).not.toMatch(/emp_[A-Za-z0-9]/);
  });

  it('links each row to its detail page and to the chat page by employee id', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-emp-table');
    expect(screen.getByTestId('agent-v2-emp-name-emp_AB12CD34').closest('a')?.getAttribute('href')).toBe(
      '/agent/employees/emp_AB12CD34',
    );
    expect(screen.getByTestId('agent-v2-emp-chat-emp_AB12CD34').getAttribute('href')).toBe(
      '/agent/chat?employeeId=emp_AB12CD34',
    );
    expect(screen.getByTestId('agent-v2-employees-create').getAttribute('href')).toBe(
      '/agent/employees/new',
    );
  });

  it('shows the configured budget in USD and never converts it client-side', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-emp-table');
    expect(screen.getByTestId('agent-v2-emp-budget-emp_AB12CD34').textContent).toBe('$1,200.00');
  });

  it('separates a budget object with no limits from a missing budget object', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-emp-table');
    expect(screen.getByTestId('agent-v2-emp-budget-emp_EF56GH78').textContent).toBe('未配置');
    expect(screen.getByTestId('agent-v2-emp-budget-emp_IJ90KL12').textContent).toBe('—');
  });

  it('never renders the raw owner placeholder; an unassigned slot says 未指派', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-emp-table');
    expect(screen.getByTestId('agent-v2-emp-owner-emp_AB12CD34').textContent).toContain('用户 #7');
    expect(screen.getByTestId('agent-v2-emp-owner-emp_EF56GH78').textContent).toContain('未指派');
    guardNoRawKeys();
  });

  it('shows the skill count only when the row really carries one', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-emp-table');
    expect(screen.getByTestId('agent-v2-emp-skills-emp_AB12CD34').textContent).toBe('4');
    expect(screen.getByTestId('agent-v2-emp-skills-emp_EF56GH78').textContent).toBe('—');
  });

  it('hydrates today runs from the day window and keeps failures honest', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('agent-v2-emp-runs-emp_AB12CD34').textContent).toBe(
        '3 次 · 成功 2 · 失败 1',
      ),
    );
    const runUrl = urls.find((u) => u.includes('/api/run-stats')) ?? '';
    expect(runUrl).toContain('bucket=day');
    expect(runUrl).toContain('employeeId=emp_AB12CD34');
    const win = todayBeijingWindow();
    expect(decodeURIComponent(runUrl)).toContain(`from=${win.from}`);
    expect(decodeURIComponent(runUrl)).toContain('to=');
  });

  it('switches the status filter and keeps it in the URL', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-emp-table');
    fireEvent.click(screen.getByTestId('agent-v2-emp-status-paused'));
    await waitFor(() =>
      expect(urls.some((u) => u.includes('/api/employees') && u.includes('lifecycleState=paused'))).toBe(
        true,
      ),
    );
    expect(screen.getByTestId('agent-v2-emp-status-paused').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('agent-v2-emp-status-active').getAttribute('aria-pressed')).toBe('false');
  });

  it('omits the lifecycle parameter for 全部', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-emp-table');
    fireEvent.click(screen.getByTestId('agent-v2-emp-status-all'));
    await waitFor(() => {
      const calls = urls.filter((u) => u.includes('/api/employees'));
      const last = calls[calls.length - 1] ?? '';
      expect(last.includes('lifecycleState')).toBe(false);
    });
  });

  it('commits the keyword after a pause and refetches without a client-side filter', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-emp-table');
    fireEvent.change(screen.getByTestId('agent-v2-emp-search'), { target: { value: '小鲤' } });
    await waitFor(
      () => {
        const hit = urls.find((u) => u.includes('/api/employees') && u.includes('keyword='));
        expect(hit).toBeTruthy();
        expect(decodeURIComponent(hit ?? '')).toContain('keyword=小鲤');
      },
      { timeout: 2000 },
    );
  });

  it('offers a single clear action once a filter is active', async () => {
    listBody = { items: [], nextCursor: null };
    renderPage('/agent/employees?keyword=zzz');
    await screen.findByTestId('agent-v2-employees-nomatch');
    fireEvent.click(screen.getByTestId('agent-v2-emp-clear'));
    await waitFor(() => {
      const calls = urls.filter((u) => u.includes('/api/employees'));
      const last = calls[calls.length - 1] ?? '';
      expect(last.includes('keyword=')).toBe(false);
    });
    expect((screen.getByTestId('agent-v2-emp-search') as HTMLInputElement).value).toBe('');
  });

  it('shows the true empty state with a create entry', async () => {
    listBody = { items: [], nextCursor: null };
    renderPage();
    const empty = await screen.findByTestId('agent-v2-employees-empty');
    expect(empty.textContent).toContain('还没有数字员工');
    expect(within(empty).getByText('新建员工').closest('a')?.getAttribute('href')).toBe(
      '/agent/employees/new',
    );
    expect(screen.queryByTestId('agent-v2-emp-table')).toBeNull();
  });

  it('separates no-match from truly empty and names the active filter', async () => {
    listBody = { items: [], nextCursor: null };
    renderPage('/agent/employees?keyword=zzz');
    const noMatch = await screen.findByTestId('agent-v2-employees-nomatch');
    expect(noMatch.textContent).toContain('当前筛选：「zzz」');
    expect(screen.queryByTestId('agent-v2-employees-empty')).toBeNull();
  });

  it('turns a 403 into a permission card with the request number and no retry', async () => {
    listStatus = 403;
    listBody = { code: 'console.forbidden', message: 'forbidden' };
    listRequestId = 'req-403';
    renderPage();
    const card = await screen.findByTestId('agent-v2-employees-403');
    expect(card.textContent).toContain('没有管理控制台权限');
    expect(card.textContent).toContain('req-403');
    expect(screen.queryByTestId('agent-v2-employees-retry')).toBeNull();
    guardNoRawKeys();
  });

  it('turns 403 and 404 into the same permission body', async () => {
    listStatus = 404;
    listBody = { code: 'console.not_found' };
    listRequestId = 'req-404';
    renderPage();
    const card = await screen.findByTestId('agent-v2-employees-404');
    expect(card.textContent).toContain('没有管理控制台权限');
    expect(card.textContent).toContain('req-404');
    expect(screen.queryByTestId('agent-v2-employees-retry')).toBeNull();
  });

  it('turns a 401 into the session-expired card', async () => {
    listStatus = 401;
    listBody = { code: 'console.unauthenticated' };
    renderPage();
    const card = await screen.findByTestId('agent-v2-employees-auth');
    expect(card.textContent).toContain('登录已失效');
    expect(card.textContent).toContain('请重新登录');
  });

  it('keeps a human message, a request number and a working retry on 500', async () => {
    listStatus = 500;
    listBody = { code: 'console.upstream_error' };
    listRequestId = 'req-500';
    renderPage();
    const card = await screen.findByTestId('agent-v2-employees-error');
    expect(card.textContent).toContain('本次未能读取');
    expect(card.textContent).toContain('查询失败，请重试');
    expect(card.textContent).toContain('req-500');
    expect(card.textContent).not.toContain('HTTP');
    expect(card.textContent).not.toContain('HTTP 500');
    listStatus = 200;
    listBody = { items: [EMP_A], nextCursor: null };
    fireEvent.click(screen.getByTestId('agent-v2-employees-retry'));
    expect(await screen.findByTestId('agent-v2-emp-row-emp_AB12CD34')).toBeTruthy();
  });

  it('degrades a failed per-row run read to — with a human title and request id, no HTTP', async () => {
    runStatus = 502;
    runRequestId = 'req-runs';
    renderPage();
    await screen.findByTestId('agent-v2-emp-table');
    await waitFor(() => {
      expect(screen.getByTestId('agent-v2-emp-runs-emp_AB12CD34').getAttribute('title')).toContain('req-runs');
    });
    const cell = screen.getByTestId('agent-v2-emp-runs-emp_AB12CD34');
    expect(cell.textContent).toBe('—');
    expect(cell.getAttribute('title')).toContain('运行记录加载失败');
    expect(cell.getAttribute('title')).not.toContain('HTTP');
  });

  it('reads a dead network as a timeout/network failure, never as not found', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('offline');
    }) as never;
    renderPage();
    const card = await screen.findByTestId('agent-v2-employees-error');
    expect(card.textContent).toContain('无法连接员工服务');
    expect(card.textContent).toContain('未提供');
    expect(card.textContent).not.toContain('员工不存在或无权访问');
  });

  it('loads the next cursor page, accumulates rows and drops the button at the end', async () => {
    listBody = { items: [EMP_A, EMP_B], nextCursor: 'c2' };
    listByCursor = { c2: { items: [EMP_C], nextCursor: null } };
    renderPage();
    await screen.findByTestId('agent-v2-emp-row-emp_AB12CD34');
    expect(screen.getByTestId('agent-v2-emp-loaded').textContent).toBe('已加载 2 名员工');
    fireEvent.click(screen.getByTestId('agent-v2-emp-next'));
    expect(await screen.findByTestId('agent-v2-emp-row-emp_IJ90KL12')).toBeTruthy();
    expect(screen.getByTestId('agent-v2-emp-loaded').textContent).toBe('已加载 3 名员工');
    expect(screen.queryByTestId('agent-v2-emp-next')).toBeNull();
    const nextCall = urls.filter((u) => u.includes('/api/employees')).pop() ?? '';
    expect(nextCall).toContain('cursor=c2');
  });

  it('renders no dead or permanently disabled control after load', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-emp-table');
    const dead = document.querySelectorAll(
      'button[disabled], a[aria-disabled="true"], [role="button"][aria-disabled="true"]',
    );
    expect(dead.length).toBe(0);
  });

  it('keeps the responsive card layout and token-only colours in CSS', () => {
    const css = readFileSync(`${process.cwd()}/src/pages/AgentConsoleV2/employeesList.css`, 'utf8');
    expect(css).toContain('@media (max-width: 900px)');
    expect(css).toContain('@media (max-width: 520px)');
    expect(css).toContain('content: attr(data-label)');
    expect(css).not.toContain('backdrop-filter');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});