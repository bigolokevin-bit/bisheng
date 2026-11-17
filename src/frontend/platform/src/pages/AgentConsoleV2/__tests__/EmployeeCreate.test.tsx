/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * EMP-02 `/agent/employees/new` — the console's first real write screen.
 *
 * Strategy matches the rest of the console suites: stub the global fetch that
 * the write client uses, route by URL, and mock react-i18next against the REAL
 * zh-Hans bundle so the zero-engineering-language guard is meaningful.
 *
 * What must hold (EMP02-TARGET-SPEC §3/§8):
 * - required fields are checked before any request leaves the page;
 * - a success renders the result card with a copyable full id and a real
 *   「查看员工详情」 link, and never claims 「已可对话」;
 * - a same-key retry after a transport failure renders the FIRST result with a
 *   neutral band — no red, no 「失败」 — and reuses the same key;
 * - 400 / 401 / 403 / 404 each get human copy; body text never carries a status
 *   code, a field name or the submission key;
 * - the submitting state locks the whole card and 5 clicks still produce 1 POST.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  const t = (key: unknown, defOrOpts?: unknown): string => {
    const value = String(key)
      .split('.')
      .reduce<unknown>(
        (acc, part) =>
          acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
        dict
      );
    if (typeof defOrOpts === 'string') {
      return typeof value === 'string' ? value : defOrOpts;
    }
    if (typeof value === 'string') {
      const options = (defOrOpts ?? {}) as Record<string, unknown>;
      return value.replace(/\{\{(\w+)\}\}/g, (m, name: string) =>
        name in options ? String(options[name]) : m
      );
    }
    if (value && typeof value === 'object') return String(key);
    return String(key);
  };
  return { useTranslation: () => ({ t }) };
});

import { EmployeeCreatePage } from '../EmployeeCreatePage';
import { userContext } from '@/contexts/userContext';

const EMP_ID = 'emp_7K2MQ4X9TB3N';

type WriteMode = 'ok' | 'status' | 'network' | 'no-body';
let writeMode: WriteMode = 'ok';
let writeStatus = 500;
let writeBody: unknown = null;
let posts: Array<{ url: string; key: string | null; body: Record<string, unknown> }> = [];
let clipboard: string[] = [];

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'X-Console-Request-Id': 'req_emp02' }),
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  posts = [];
  clipboard = [];
  writeMode = 'ok';
  writeStatus = 500;
  writeBody = null;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (v: string) => {
        clipboard.push(v);
      },
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!init || init.method !== 'POST') return jsonResponse(200, { items: [] });
      const headers = new Headers(init.headers as HeadersInit);
      posts.push({
        url,
        key: headers.get('Idempotency-Key'),
        body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>,
      });
      if (writeMode === 'network') throw new Error('network down');
      if (writeMode === 'no-body') return jsonResponse(201, {});
      if (writeMode === 'status') return jsonResponse(writeStatus, { code: 'stub.code' });
      return jsonResponse(
        200,
        writeBody ?? {
          id: EMP_ID,
          name: '小柯',
          title: '订单售后专员',
          lifecycleState: 'draft',
          currentVersionId: 'empv_1',
        }
      );
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage(entry = '/agent/employees/new', uid: number | string | null = 1) {
  return render(
    <userContext.Provider
      value={{ user: uid === null ? undefined : { user_id: uid, user_name: '陈诚' } } as never}
    >
      <MemoryRouter initialEntries={[entry]}>
        <EmployeeCreatePage />
      </MemoryRouter>
    </userContext.Provider>
  );
}

function fill(name: string, title: string, note?: string) {
  fireEvent.change(screen.getByTestId('agent-v2-emp-c-name'), { target: { value: name } });
  fireEvent.change(screen.getByTestId('agent-v2-emp-c-title'), { target: { value: title } });
  if (note !== undefined) {
    fireEvent.change(screen.getByTestId('agent-v2-emp-c-note'), { target: { value: note } });
  }
}

function visibleTextWithoutTech(): string {
  const root = screen.getByTestId('agent-v2-emp-create');
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('details').forEach((d) => d.remove());
  return clone.textContent ?? '';
}

describe('EMP-02 employee create', () => {
  it('checks both required fields before any request and focuses the first one', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('agent-v2-emp-c-save'));

    expect(await screen.findByTestId('agent-v2-emp-c-error-summary')).toBeTruthy();
    expect(screen.getByTestId('agent-v2-emp-c-name-error').textContent).toContain('还没填姓名。');
    expect(screen.getByTestId('agent-v2-emp-c-title-error').textContent).toContain('还没填岗位。');
    expect(posts).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByTestId('agent-v2-emp-c-name'));
  });

  it('rejects a spaces-only name with the honest copy (the service judges the same way)', async () => {
    renderPage();
    fill('   ', '订单售后专员');
    fireEvent.click(screen.getByTestId('agent-v2-emp-c-save'));

    expect(await screen.findByTestId('agent-v2-emp-c-name-error')).toHaveTextContent(
      '只有空格不算填了，请输入名字。'
    );
    expect(screen.getByTestId('agent-v2-emp-c-error-summary').textContent).toContain('姓名只有空格');
    expect(posts).toHaveLength(0);
  });

  it('writes once with one key and renders the result card with a copyable full id', async () => {
    renderPage();
    fill('小柯', '订单售后专员', '先接售后工单');
    fireEvent.click(screen.getByTestId('agent-v2-emp-c-save'));

    expect(await screen.findByTestId('agent-v2-emp-c-result')).toBeTruthy();
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe('/agent-api/api/employees');
    expect(posts[0].key).toBeTruthy();
    expect(posts[0].body).toMatchObject({
      name: '小柯',
      title: '订单售后专员',
      note: '先接售后工单',
      owner_user_id: '1',
    });

    expect(screen.getByTestId('agent-v2-emp-c-result-title').textContent).toBe('员工已建立');
    const id = screen.getByTestId('agent-v2-emp-c-result-id');
    expect(id.textContent).toBe('emp_7K2M…TB3N');
    expect(id.getAttribute('title')).toBe(EMP_ID);
    expect(screen.getByTestId('agent-v2-emp-c-view').getAttribute('href')).toBe(
      `/agent/employees/${EMP_ID}`
    );
    // honesty: a draft cannot answer anyone yet
    expect(visibleTextWithoutTech()).not.toContain('已可对话');
    expect(visibleTextWithoutTech()).not.toContain('已可派活');

    fireEvent.click(screen.getByTestId('agent-v2-emp-c-copy'));
    await waitFor(() => expect(clipboard).toContain(EMP_ID));
    expect(screen.getByTestId('agent-v2-emp-c-copy').textContent).toContain('已复制');
  });

  it('renders a same-key replay as the first result, reusing the key (no second employee)', async () => {
    writeMode = 'network';
    renderPage();
    fill('小柯', '订单售后专员');
    fireEvent.click(screen.getByTestId('agent-v2-emp-c-save'));

    expect(await screen.findByTestId('agent-v2-emp-c-save-error')).toBeTruthy();
    expect(posts).toHaveLength(1);
    const firstKey = posts[0].key;

    writeMode = 'ok';
    fireEvent.click(screen.getByTestId('agent-v2-emp-c-retry'));

    expect(await screen.findByTestId('agent-v2-emp-c-replay-band')).toBeTruthy();
    expect(screen.getByTestId('agent-v2-emp-c-replay-band').textContent).toContain(
      '这次提交之前已经成功过一次'
    );
    expect(posts).toHaveLength(2);
    expect(posts[1].key).toBe(firstKey);
    expect(screen.getByTestId('agent-v2-emp-c-result-id').textContent).toBe('emp_7K2M…TB3N');

    const text = visibleTextWithoutTech();
    expect(text).not.toContain('失败');
    expect(screen.getByTestId('agent-v2-emp-c-result').querySelector('.ric.wr')).toBeNull();
  });

  it('turns a same-key/different-body answer into a conflict card, not a field error', async () => {
    writeMode = 'status';
    writeStatus = 409;
    renderPage();
    fill('小柯', '订单售后专员');
    fireEvent.click(screen.getByTestId('agent-v2-emp-c-save'));

    const conflict = await screen.findByTestId('agent-v2-emp-c-conflict');
    expect(conflict.textContent).toContain('这次没有保存');
    expect(conflict.textContent).toContain('上一次提交已经成功');
    expect(screen.getByTestId('agent-v2-emp-c-conflict-back').getAttribute('href')).toBe(
      '/agent/employees'
    );
    expect(screen.getByTestId('agent-v2-emp-c-conflict-reopen')).toBeTruthy();
    expect(screen.queryByTestId('agent-v2-emp-c-name-error')).toBeNull();
  });

  it('keeps every typed value on a 400 and says it in plain words (no code on screen)', async () => {
    writeMode = 'status';
    writeStatus = 400;
    renderPage();
    fill('小柯', '订单售后专员', '保留这句备注');
    fireEvent.click(screen.getByTestId('agent-v2-emp-c-save'));

    expect(await screen.findByTestId('agent-v2-emp-c-save-error')).toBeTruthy();
    expect((screen.getByTestId('agent-v2-emp-c-name') as HTMLInputElement).value).toBe('小柯');
    expect((screen.getByTestId('agent-v2-emp-c-note') as HTMLTextAreaElement).value).toBe(
      '保留这句备注'
    );
    const text = visibleTextWithoutTech();
    expect(text).not.toContain('400');
    expect(text).not.toContain('stub.code');
  });

  it('shows the session-expired screen on 401', async () => {
    writeMode = 'status';
    writeStatus = 401;
    renderPage();
    fill('小柯', '订单售后专员');
    fireEvent.click(screen.getByTestId('agent-v2-emp-c-save'));

    const auth = await screen.findByTestId('agent-v2-emp-c-auth');
    expect(auth.textContent).toContain('登录已失效');
    expect(auth.textContent).toContain('重新登录');
    expect(screen.queryByTestId('agent-v2-emp-c-form')).toBeNull();
  });

  it('gives 403 and 404 one identical body and no form skeleton', async () => {
    writeMode = 'status';
    writeStatus = 403;
    const first = renderPage();
    fill('小柯', '订单售后专员');
    fireEvent.click(screen.getByTestId('agent-v2-emp-c-save'));
    const forbidden403 = (await screen.findByTestId('agent-v2-emp-c-forbidden')).textContent ?? '';
    first.unmount();

    writeMode = 'status';
    writeStatus = 404;
    renderPage();
    fill('小柯', '订单售后专员');
    fireEvent.click(screen.getByTestId('agent-v2-emp-c-save'));
    const forbidden404 = (await screen.findByTestId('agent-v2-emp-c-forbidden')).textContent ?? '';

    const stripTech = (s: string) => s.replace(/技术信息[\s\S]*$/, '');
    expect(stripTech(forbidden403)).toBe(stripTech(forbidden404));
    expect(forbidden403).toContain('你暂时不能在这里新建员工');
    expect(screen.queryByTestId('agent-v2-emp-c-form')).toBeNull();
  });

  it('locks the card while submitting: one request for five clicks', async () => {
    let release: (() => void) | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (!init || init.method !== 'POST') return jsonResponse(200, { items: [] });
        const headers = new Headers(init.headers as HeadersInit);
        posts.push({
          url: String(input),
          key: headers.get('Idempotency-Key'),
          body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>,
        });
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return jsonResponse(200, { id: EMP_ID, name: '小柯', title: '订单售后专员' });
      })
    );

    renderPage();
    fill('小柯', '订单售后专员');
    const save = screen.getByTestId('agent-v2-emp-c-save');
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.click(save);

    await waitFor(() => expect(save.textContent).toContain('正在保存…'));
    expect(save).toBeDisabled();
    expect(screen.getByTestId('agent-v2-emp-c-name')).toBeDisabled();
    expect(screen.getByTestId('agent-v2-emp-c-note')).toBeDisabled();
    expect(screen.getByTestId('agent-v2-emp-c-cancel')).toBeDisabled();
    expect(screen.getByTestId('agent-v2-emp-c-form').getAttribute('aria-busy')).toBe('true');
    expect(posts).toHaveLength(1);

    release?.();
    await screen.findByTestId('agent-v2-emp-c-result');
  });

  it('renders no engineering language, no amount and no raw status in body copy', async () => {
    renderPage();
    fill('小柯', '订单售后专员', '按话术回');
    fireEvent.click(screen.getByTestId('agent-v2-emp-c-save'));
    await screen.findByTestId('agent-v2-emp-c-result');

    const text = visibleTextWithoutTech();
    for (const banned of [
      'A3',
      'A4',
      'A7',
      'CR-',
      'GAP',
      'PRD',
      'request_id',
      'idempotency',
      'Idempotency',
      'HTTP',
      'undefined',
      'NaN',
      'mock',
      'seed',
      'TODO',
      '待接入',
      '演示',
      '模拟',
      '¥',
      '元',
    ]) {
      expect(text).not.toContain(banned);
    }
    expect(text).not.toContain('owner_user_id');
    expect(text).not.toContain('lifecycle_state');
  });

  it('shows the form skeleton while the session identity is not readable yet', async () => {
    renderPage('/agent/employees/new', null);
    expect(screen.getByTestId('agent-v2-emp-c-loading')).toBeTruthy();
    expect(screen.queryByTestId('agent-v2-emp-c-form')).toBeNull();
    // no reading is rendered inside the skeleton (E11: nothing that looks like data)
    expect(screen.getByTestId('agent-v2-emp-c-loading').textContent).not.toContain('0');
  });

  it('keeps the primary button copy and the exit links (no write control besides save)', async () => {
    renderPage();
    expect(screen.getByTestId('agent-v2-emp-c-save').textContent).toContain('保存');
    expect(screen.getByTestId('agent-v2-emp-c-back').getAttribute('href')).toBe('/agent/employees');
    expect(screen.getByTestId('agent-v2-emp-c-owner').querySelector('select')).toBeNull();
    // exactly four fields, two of them required
    expect(screen.getByTestId('agent-v2-emp-c-form').querySelectorAll('input, textarea').length).toBe(3);
    expect(screen.getAllByText('必填').length).toBe(2);
  });
});