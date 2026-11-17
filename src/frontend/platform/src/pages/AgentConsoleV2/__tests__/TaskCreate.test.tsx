/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * TSK-03 `/agent/tasks/new` — manual task creation.
 *
 * Same stub strategy as EMP-02: real zh-Hans bundle, stubbed fetch, real
 * MemoryRouter. The assertions follow TSK03-TARGET-SPEC §8:
 * - assignees come from the real employee list; offboarding/archived are out;
 * - with no candidate the <select> does not exist at all and the button is
 *   disabled with a readable reason;
 * - the write body fixes `source` to `{"kind":"manual"}` and never sends a
 *   channel, a message id, a creator or a status;
 * - priority reads 低 / 普通 / 高 only (never 中, never the raw enum);
 * - replay / conflict / 400 / 401 / 403 / 404 behave like EMP-02.
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

import { TaskCreatePage } from '../TaskCreatePage';
import { userContext } from '@/contexts/userContext';

const EMP_A = 'emp_86A81CE8FF6F42E187BCF2B540';
const EMP_B = 'emp_217A91BA995044DFBB3E2E940B';
const EMP_C = 'emp_4C1D77B0A2E3498AB1F5D2C66307';
const EMP_OFF = 'emp_OFFBOARDING000000000000';
const TASK_ID = 'tk_7K2MQ4X9TB3N';

type WriteMode = 'ok' | 'status' | 'network';
let writeMode: WriteMode = 'ok';
let writeStatus = 500;
let employeesBody: unknown = null;
let employeeStatus = 200;
let posts: Array<{ url: string; key: string | null; body: Record<string, unknown> }> = [];
let clipboard: string[] = [];

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'X-Console-Request-Id': 'req_tsk03' }),
    json: async () => body,
  } as unknown as Response;
}

function defaultEmployees() {
  return {
    items: [
      { employeeId: EMP_B, name: '小柯', title: '订单售后专员', lifecycleState: 'active' },
      { employeeId: EMP_A, name: '小鲤', title: '客服值守', lifecycleState: 'active' },
      { employeeId: EMP_C, name: '阿禾', title: '内容编辑', lifecycleState: 'onboarding' },
      { employeeId: EMP_OFF, name: '老陈', title: '已下线', lifecycleState: 'offboarding' },
      { employeeId: 'emp_ARCHIVED00000000000000', name: '旧人', title: '旧岗', lifecycleState: 'archived' },
    ],
  };
}

beforeEach(() => {
  posts = [];
  clipboard = [];
  writeMode = 'ok';
  writeStatus = 500;
  employeeStatus = 200;
  employeesBody = defaultEmployees();
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
      if (!init || init.method !== 'POST') {
        if (employeeStatus !== 200) return jsonResponse(employeeStatus, { code: 'stub.read' });
        return jsonResponse(200, employeesBody);
      }
      const headers = new Headers(init.headers as HeadersInit);
      posts.push({
        url,
        key: headers.get('Idempotency-Key'),
        body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>,
      });
      if (writeMode === 'network') throw new Error('network down');
      if (writeMode === 'status') return jsonResponse(writeStatus, { code: 'stub.write' });
      return jsonResponse(200, {
        taskId: TASK_ID,
        title: '整理 11 月售后工单的退款原因',
        status: 'open',
        priority: 'normal',
        assignee: { type: 'employee', id: EMP_A },
        source: { kind: 'manual' },
      });
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage(entry = '/agent/tasks/new') {
  return render(
    <userContext.Provider value={{ user: { user_id: 1, user_name: '陈诚' } } as never}>
      <MemoryRouter initialEntries={[entry]}>
        <TaskCreatePage />
      </MemoryRouter>
    </userContext.Provider>
  );
}

async function ready() {
  await screen.findByTestId('agent-v2-tsk-c-form');
}

function chooseAssignee(id: string) {
  fireEvent.change(screen.getByTestId('agent-v2-tsk-c-assignee'), { target: { value: id } });
}

function visibleTextWithoutTech(): string {
  const root = screen.getByTestId('agent-v2-task-create');
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('details').forEach((d) => d.remove());
  return clone.textContent ?? '';
}

describe('TSK-03 task create', () => {
  it('lists real employees as assignees and excludes offboarding/archived', async () => {
    renderPage();
    await ready();
    const select = screen.getByTestId('agent-v2-tsk-c-assignee') as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain('小鲤 · 客服值守（在岗）');
    expect(labels).toContain('阿禾 · 内容编辑（入职中）');
    expect(labels.some((l) => l?.includes('老陈'))).toBe(false);
    expect(labels.some((l) => l?.includes('旧人'))).toBe(false);
    expect(screen.getByTestId('agent-v2-tsk-c-assignee-hint').textContent).toContain('共 3 位可选');
  });

  it('checks title and assignee before any request, with the honest required copy', async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getByTestId('agent-v2-tsk-c-save'));

    expect(await screen.findByTestId('agent-v2-tsk-c-error-summary')).toBeTruthy();
    expect(screen.getByTestId('agent-v2-tsk-c-title-error').textContent).toContain('还没填标题。');
    expect(screen.getByTestId('agent-v2-tsk-c-assignee-error').textContent).toContain(
      '还没选负责人。任务必须有一个人负责。'
    );
    expect(posts).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByTestId('agent-v2-tsk-c-title'));
  });

  it('rejects a spaces-only title', async () => {
    renderPage();
    await ready();
    fireEvent.change(screen.getByTestId('agent-v2-tsk-c-title'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('agent-v2-tsk-c-save'));
    expect(await screen.findByTestId('agent-v2-tsk-c-title-error')).toHaveTextContent(
      '只有空格不算填了，请输入标题。'
    );
    expect(posts).toHaveLength(0);
  });

  it('offers exactly 低 / 普通 / 高 with 普通 selected, and never the raw enum or 中', async () => {
    renderPage();
    await ready();
    expect(screen.getByTestId('agent-v2-tsk-c-priority-normal').textContent).toContain('普通');
    expect(screen.getByTestId('agent-v2-tsk-c-priority-low').textContent).toContain('低');
    expect(screen.getByTestId('agent-v2-tsk-c-priority-high').textContent).toContain('高');
    const normal = screen
      .getByTestId('agent-v2-tsk-c-priority-normal')
      .querySelector('input') as HTMLInputElement;
    expect(normal.checked).toBe(true);
    // the segment itself never offers 「中」, and the raw enum stays off screen
    const group = screen.getByTestId('agent-v2-tsk-c-priority-normal').parentElement as HTMLElement;
    expect(group.textContent).not.toContain('中');
    const text = visibleTextWithoutTech();
    expect(text).not.toContain('low');
    expect(text).not.toContain('normal');
    expect(text).not.toContain('high');
  });

  it('writes once with a manual source and renders the result card with a copyable id', async () => {
    renderPage();
    await ready();
    fireEvent.change(screen.getByTestId('agent-v2-tsk-c-title'), {
      target: { value: '整理 11 月售后工单的退款原因' },
    });
    chooseAssignee(EMP_A);
    fireEvent.click(screen.getByTestId('agent-v2-tsk-c-priority-high'));
    fireEvent.change(screen.getByTestId('agent-v2-tsk-c-note'), {
      target: { value: '只统计退款原因' },
    });
    fireEvent.click(screen.getByTestId('agent-v2-tsk-c-save'));

    expect(await screen.findByTestId('agent-v2-tsk-c-result')).toBeTruthy();
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe('/agent-api/api/tasks');
    expect(posts[0].key).toBeTruthy();
    expect(posts[0].body).toEqual({
      title: '整理 11 月售后工单的退款原因',
      assignee: { type: 'employee', id: EMP_A },
      priority: 'high',
      source: { kind: 'manual' },
      description: '只统计退款原因',
    });
    expect(posts[0].body).not.toHaveProperty('channel');
    expect(posts[0].body).not.toHaveProperty('messageId');
    expect(posts[0].body).not.toHaveProperty('created_by');
    expect(posts[0].body).not.toHaveProperty('status');

    const id = screen.getByTestId('agent-v2-tsk-c-result-id');
    expect(id.textContent).toBe('tk_7K2M…TB3N');
    expect(id.getAttribute('title')).toBe(TASK_ID);
    expect(screen.getByTestId('agent-v2-tsk-c-view').getAttribute('href')).toBe(
      `/agent/tasks/${TASK_ID}`
    );
    expect(visibleTextWithoutTech()).not.toContain('已通知负责人');

    fireEvent.click(screen.getByTestId('agent-v2-tsk-c-copy'));
    await waitFor(() => expect(clipboard).toContain(TASK_ID));
  });

  it('presents a same-key replay as the first task with a neutral band', async () => {
    writeMode = 'network';
    renderPage();
    await ready();
    fireEvent.change(screen.getByTestId('agent-v2-tsk-c-title'), { target: { value: '整理退款原因' } });
    chooseAssignee(EMP_A);
    fireEvent.click(screen.getByTestId('agent-v2-tsk-c-save'));

    expect(await screen.findByTestId('agent-v2-tsk-c-save-error')).toBeTruthy();
    const firstKey = posts[0].key;

    writeMode = 'ok';
    fireEvent.click(screen.getByTestId('agent-v2-tsk-c-retry'));

    expect(await screen.findByTestId('agent-v2-tsk-c-replay-band')).toBeTruthy();
    expect(posts[1].key).toBe(firstKey);
    expect(screen.getByTestId('agent-v2-tsk-c-result-id').textContent).toBe('tk_7K2M…TB3N');
    const text = visibleTextWithoutTech();
    expect(text).not.toContain('失败');
  });

  it('turns a same-key/different-body answer into the conflict card with two exits', async () => {
    writeMode = 'status';
    writeStatus = 409;
    renderPage();
    await ready();
    fireEvent.change(screen.getByTestId('agent-v2-tsk-c-title'), { target: { value: '整理退款原因' } });
    chooseAssignee(EMP_A);
    fireEvent.click(screen.getByTestId('agent-v2-tsk-c-save'));

    const conflict = await screen.findByTestId('agent-v2-tsk-c-conflict');
    expect(conflict.textContent).toContain('这次没有建立');
    expect(conflict.textContent).toContain('上一次已经成功');
    expect(screen.getByTestId('agent-v2-tsk-c-conflict-back').getAttribute('href')).toBe('/agent/tasks');
    expect(screen.getByTestId('agent-v2-tsk-c-conflict-reopen')).toBeTruthy();
  });

  it('keeps the typed content on a 400 and shows no status code in body copy', async () => {
    writeMode = 'status';
    writeStatus = 400;
    renderPage();
    await ready();
    fireEvent.change(screen.getByTestId('agent-v2-tsk-c-title'), { target: { value: '整理退款原因' } });
    chooseAssignee(EMP_A);
    fireEvent.click(screen.getByTestId('agent-v2-tsk-c-save'));

    expect(await screen.findByTestId('agent-v2-tsk-c-save-error')).toBeTruthy();
    expect((screen.getByTestId('agent-v2-tsk-c-title') as HTMLInputElement).value).toBe('整理退款原因');
    expect((screen.getByTestId('agent-v2-tsk-c-assignee') as HTMLSelectElement).value).toBe(EMP_A);
    expect(visibleTextWithoutTech()).not.toContain('400');
  });

  it('shows the session-expired screen on 401', async () => {
    writeMode = 'status';
    writeStatus = 401;
    renderPage();
    await ready();
    fireEvent.change(screen.getByTestId('agent-v2-tsk-c-title'), { target: { value: '整理退款原因' } });
    chooseAssignee(EMP_A);
    fireEvent.click(screen.getByTestId('agent-v2-tsk-c-save'));

    const auth = await screen.findByTestId('agent-v2-tsk-c-auth');
    expect(auth.textContent).toContain('登录已失效');
    expect(screen.queryByTestId('agent-v2-tsk-c-form')).toBeNull();
  });

  it('gives 403 and 404 one identical body and renders no form skeleton', async () => {
    employeeStatus = 403;
    const first = renderPage();
    const forbidden403 = (await screen.findByTestId('agent-v2-tsk-c-forbidden')).textContent ?? '';
    first.unmount();

    employeeStatus = 404;
    renderPage();
    const forbidden404 = (await screen.findByTestId('agent-v2-tsk-c-forbidden')).textContent ?? '';

    const stripTech = (s: string) => s.replace(/技术信息[\s\S]*$/, '');
    expect(stripTech(forbidden403)).toBe(stripTech(forbidden404));
    expect(forbidden403).toContain('你暂时不能在这里建任务');
    expect(screen.queryByTestId('agent-v2-tsk-c-form')).toBeNull();
  });

  it('replaces the assignee control with an explanation when nobody can be assigned', async () => {
    employeesBody = { items: [] };
    renderPage();
    await ready();

    expect(screen.getByTestId('agent-v2-tsk-c-assignee-empty')).toBeTruthy();
    expect(screen.queryByTestId('agent-v2-tsk-c-assignee')).toBeNull();
    expect(screen.getByTestId('agent-v2-tsk-c-empty-create').getAttribute('href')).toBe(
      '/agent/employees/new'
    );
    const save = screen.getByTestId('agent-v2-tsk-c-save');
    expect(save).toBeDisabled();
    expect(screen.getByTestId('agent-v2-tsk-c-why-blocked').textContent).toContain('负责人');

    // the typed title survives the empty state
    fireEvent.change(screen.getByTestId('agent-v2-tsk-c-title'), { target: { value: '先写着' } });
    expect((screen.getByTestId('agent-v2-tsk-c-title') as HTMLInputElement).value).toBe('先写着');
  });

  it('locks the card while submitting and sends one request for five clicks', async () => {
    let release: (() => void) | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (!init || init.method !== 'POST') return jsonResponse(200, defaultEmployees());
        const headers = new Headers(init.headers as HeadersInit);
        posts.push({
          url: String(input),
          key: headers.get('Idempotency-Key'),
          body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>,
        });
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return jsonResponse(200, { taskId: TASK_ID, title: '整理退款原因', status: 'open' });
      })
    );

    renderPage();
    await ready();
    fireEvent.change(screen.getByTestId('agent-v2-tsk-c-title'), { target: { value: '整理退款原因' } });
    chooseAssignee(EMP_A);
    const save = screen.getByTestId('agent-v2-tsk-c-save');
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.click(save);

    await waitFor(() => expect(save.textContent).toContain('正在建立…'));
    expect(save).toBeDisabled();
    expect(screen.getByTestId('agent-v2-tsk-c-title')).toBeDisabled();
    expect(screen.getByTestId('agent-v2-tsk-c-assignee')).toBeDisabled();
    expect(screen.getByTestId('agent-v2-tsk-c-cancel')).toBeDisabled();
    expect(screen.getByTestId('agent-v2-tsk-c-form').getAttribute('aria-busy')).toBe('true');
    expect(posts).toHaveLength(1);

    release?.();
    await screen.findByTestId('agent-v2-tsk-c-result');
  });

  it('fixes the source to 手工创建 as a read-only row (no channel, no message id)', async () => {
    renderPage();
    await ready();
    const source = screen.getByTestId('agent-v2-tsk-c-source');
    expect(source.textContent).toContain('手工创建');
    expect(source.querySelector('select, input, textarea')).toBeNull();
    const text = visibleTextWithoutTech();
    for (const banned of ['manual', 'channel', 'messageId', '通道', '消息标识']) {
      expect(text).not.toContain(banned);
    }
  });

  it('renders no engineering language, no amount and no due-date input', async () => {
    renderPage();
    await ready();
    fireEvent.change(screen.getByTestId('agent-v2-tsk-c-title'), { target: { value: '整理退款原因' } });
    chooseAssignee(EMP_A);
    fireEvent.click(screen.getByTestId('agent-v2-tsk-c-save'));
    await screen.findByTestId('agent-v2-tsk-c-result');

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
    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
  });
});