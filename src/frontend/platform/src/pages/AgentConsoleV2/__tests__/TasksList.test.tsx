/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * TSK-01 read-only task board tests (reconciled to the page's real testid
 * vocabulary: agent-v2-page-tasks / agent-v2-tsk-* / agent-v2-task-*).
 *
 * Strategy mirrors the ApprovalsList suite: stub the global fetch that
 * makeFetcher() uses, route by URL with TASK.md T5 shapes, and mock
 * react-i18next against the REAL zh-Hans resources so the G15 guard is
 * meaningful — machine codes must never appear in visible copy; the HTTP
 * status is only an interpolation parameter. A dedicated test asserts the
 * raw-key leak guard: no `agentConsole.`, `undefined` or `[object Object]`
 * may reach the DOM. Per the L0 ruling (25f830f §0.8) there is NO KPI row
 * and NO create entry on this read-only page — asserted below.
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
          acc && typeof acc === 'object'
            ? (acc as Record<string, unknown>)[part]
            : undefined,
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

import { TasksListPage } from '../TasksListPage';
import { userContext } from '@/contexts/userContext';

const T1 = 'tk_01HZZ0000000000000000ABCD01';
const T2 = 'tk_01HZZ0000000000000000ABCD02';
const T3 = 'tk_01HZZ0000000000000000ABCD03';
const T4 = 'tk_01HZZ0000000000000000ABCD04';

function task(id: string, extra: Record<string, unknown> = {}) {
  return {
    taskId: id,
    title: '整理周报数据',
    status: 'in_progress',
    assignee: { type: 'human', id: 'human:1' },
    priority: 'high',
    dueAt: '2026-11-20T10:00:00Z',
    source: { channel: 'feishu', messageId: 'om_1111222233334444', runId: null },
    progressNote: '已完成对账部分',
    createdAt: '2026-11-14T08:00:00Z',
    updatedAt: '2026-11-16T02:00:00Z',
    ...extra,
  };
}

// ----- switchable stub outcomes -----
let tasksStatus = 200;
let tasksBody: unknown = {
  items: [
    task(T1),
    task(T2, { title: '对接审批回调', progressNote: null }),
    task(T3, {
      status: 'blocked',
      priority: 'normal',
      progressNote: null,
      statusReason: '等待上游数据',
    }),
    task(T4, {
      status: 'open',
      dueAt: '2026-11-10T01:00:00Z',
      source: { channel: 'chat', messageId: null, runId: 'rn_01HZZX' },
    }),
    task('tk_01HZZ0000000000000000ABCD05', {
      status: 'done',
      priority: 'low',
      closedAt: '2026-11-16T01:00:00Z',
      dueAt: null,
      source: { channel: 'manual', messageId: null, runId: null },
    }),
  ],
};
let urls: string[] = [];

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'X-Console-Request-Id': 'req_tsk01' }),
    json: async () => body,
  };
}

beforeEach(() => {
  urls = [];
  tasksStatus = 200;
  tasksBody = {
    items: [
      task(T1),
      task(T2, { title: '对接审批回调', progressNote: null }),
      task(T3, {
        status: 'blocked',
        priority: 'normal',
        progressNote: null,
        statusReason: '等待上游数据',
      }),
      task(T4, {
        status: 'open',
        dueAt: '2026-11-10T01:00:00Z',
        source: { channel: 'chat', messageId: null, runId: 'rn_01HZZX' },
      }),
      task('tk_01HZZ0000000000000000ABCD05', {
        status: 'done',
        priority: 'low',
        closedAt: '2026-11-16T01:00:00Z',
        dueAt: null,
        source: { channel: 'manual', messageId: null, runId: null },
      }),
    ],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/api/tasks')) {
        if (tasksStatus === 401) return jsonResponse(401, { code: 'console.unauthenticated' });
        if (tasksStatus === 403) return jsonResponse(403, { code: 'console.forbidden', message: 'stub' });
        if (tasksStatus === 400) return jsonResponse(400, { code: 'request.missing_filter', message: 'stub' });
        if (tasksStatus === 500) return jsonResponse(500, { code: 'upstream.blip', message: 'stub' });
        // cursor pages carry no nextCursor so the keyset walk terminates honestly
        if (url.includes('cursor=')) return jsonResponse(200, { items: [task(T1)] });
        return jsonResponse(200, tasksBody);
      }
      return jsonResponse(200, {});
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage(entry = '/agent/tasks', uid: number | string | undefined = 1, userName?: string) {
  return render(
    <userContext.Provider
      value={
        {
          user: uid === undefined ? undefined : { user_id: uid, ...(userName ? { user_name: userName } : {}) },
        } as never
      }
    >
      <MemoryRouter initialEntries={[entry]}>
        <TasksListPage />
      </MemoryRouter>
    </userContext.Provider>
  );
}

const t5 = () => urls.filter((u) => u.includes('/api/tasks'));

describe('TSK-01 read-only task board (reconciled)', () => {
  it('keeps the shell testid and queries T5 with the own assignee by default', async () => {
    renderPage();
    expect(screen.getByTestId('agent-v2-page-tasks')).toBeTruthy();
    await screen.findAllByTestId('agent-v2-task-row');
    const first = t5()[0];
    expect(first).toContain('assignee=human%3A1');
    expect(first).toContain('limit=20');
    expect(first).not.toContain('cursor=');
  });

  it('has no create entry anywhere (L0 ruling: read-only page)', async () => {
    renderPage();
    await screen.findAllByTestId('agent-v2-task-row');
    expect(screen.queryByText('新建任务')).toBeNull();
  });

  it('renders contract columns honestly: id+title, zh status pill, assignee role, updated, progress null → —', async () => {
    renderPage();
    const rows = await screen.findAllByTestId('agent-v2-task-row');
    expect(rows).toHaveLength(5);
    expect(screen.getByTitle(T1).textContent).toContain('…');
    expect(rows[0].textContent).toContain('整理周报数据');
    expect(rows[0].textContent).toContain('进行中');
    // progressNote null → em-dash, never an empty cell or fake text
    const progress2 = rows[1].querySelector('[data-testid="agent-v2-task-progress"]');
    expect(progress2?.textContent).toBe('—');
    // source channel shown in Chinese (never a bare enum on screen)
    expect(rows[0].querySelector('[data-testid="agent-v2-task-source"]')?.textContent).toContain(
      '飞书'
    );
    // G1 FAIL 3: 最近更新 is its own column (Asia/Shanghai MM-DD HH:mm) and
    // priority is no longer a column of its own.
    const upd = rows[0].querySelector('[data-testid="agent-v2-task-updated"]');
    expect(upd?.textContent).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}/);
    expect(rows[0].querySelector('[data-testid="agent-v2-task-priority"]')).toBeNull();
    // G1 FAIL 5/6: one right-side header control (no refresh button) and the
    // assignee cell carries a role badge instead of a bare id.
    expect(screen.queryByTestId('agent-v2-tsk-refresh')).toBeNull();
    expect(screen.queryAllByTestId('agent-v2-task-assignee-role').length).toBeGreaterThan(0);
  });

  it('detail entry is a disabled honest stub on every row while TSK-02 is not built', async () => {
    renderPage();
    const btns = await screen.findAllByTestId('agent-v2-task-detail');
    expect(btns.length).toBeGreaterThan(0);
    for (const b of btns) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
      expect(b.getAttribute('title')).toBe('详情页未上线（TSK-02）');
    }
  });

  it('pages forward/back on the keyset cursor without inventing a total', async () => {
    tasksBody = { items: [task(T1)], nextCursor: 'cur_page2' };
    renderPage();
    await screen.findAllByTestId('agent-v2-task-row');
    const next = screen.getByTestId('agent-v2-tsk-next') as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    const prev = screen.getByTestId('agent-v2-tsk-prev') as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    fireEvent.click(next);
    await waitFor(() => {
      const reqs = t5();
      expect(reqs[reqs.length - 1]).toContain('cursor=cur_page2');
    });
    // page 2 has no nextCursor → next disabled (no fabricated continuation)
    await waitFor(() => {
      expect((screen.getByTestId('agent-v2-tsk-next') as HTMLButtonElement).disabled).toBe(true);
    });
    const info = screen.getByTestId('agent-v2-tsk-page-info').textContent ?? '';
    expect(info).toContain('本页');
    expect(info).not.toContain('共');
    fireEvent.click(screen.getByTestId('agent-v2-tsk-prev'));
    await waitFor(() => {
      const reqs = t5();
      expect(reqs[reqs.length - 1]).not.toContain('cursor=');
    });
  });

  it('unfiltered empty result shows the honest none-state (zh 这里还没有任务)', async () => {
    tasksBody = { items: [] };
    renderPage();
    const empty = await screen.findByTestId('agent-v2-tsk-empty-none');
    expect(empty.textContent).toContain('这里还没有任务');
  });

  it('filtered empty result keeps the active filter summary (empty-filtered + empty-cond)', async () => {
    tasksBody = { items: [] };
    renderPage('/agent/tasks?status=blocked');
    const empty = await screen.findByTestId('agent-v2-tsk-empty-filtered');
    expect(empty.textContent).toContain('没有符合条件的任务');
    const cond = screen.getByTestId('agent-v2-tsk-empty-cond');
    expect(cond.textContent).toContain('受阻');
  });

  it('500 localizes with (HTTP 500), hides the machine code, and retry re-queries', async () => {
    tasksStatus = 500;
    renderPage();
    const err = await screen.findByTestId('agent-v2-tsk-error');
    expect(err.textContent).toContain('（HTTP 500）');
    expect(err.textContent).not.toContain('upstream.blip');
    expect(document.body.textContent).not.toMatch(/[a-z]+\.[a-z_]+/);
    fireEvent.click(screen.getByTestId('agent-v2-tsk-retry'));
    await waitFor(() => {
      expect(t5().length).toBeGreaterThan(1);
    });
  });

  it('400 renders its own honest hint and never leaks request.missing_filter', async () => {
    tasksStatus = 400;
    renderPage();
    const err = await screen.findByTestId('agent-v2-tsk-error');
    expect(err.textContent).toContain('筛选组合被任务服务拒绝');
    expect(document.body.textContent).not.toContain('request.missing_filter');
  });

  it('403 renders the forbidden state and 401 the auth state', async () => {
    tasksStatus = 403;
    const { unmount } = renderPage();
    await screen.findByTestId('agent-v2-tsk-403');
    expect(screen.getByTestId('agent-v2-tsk-403').textContent).toContain('您还看不到任务板');
    unmount();
    tasksStatus = 401;
    renderPage();
    await screen.findByTestId('agent-v2-tsk-auth');
  });

  it('A-02: 「全部」 without any server filter queries honestly (no client gating)', async () => {
    renderPage('/agent/tasks?scope=all');
    await waitFor(() => expect(t5().length).toBeGreaterThan(0));
    expect(t5()[0]).not.toContain('assignee=');
  });

  it('deep link restores the server filter and queries status without assignee', async () => {
    renderPage('/agent/tasks?scope=all&status=open');
    await waitFor(() => expect(t5().length).toBeGreaterThan(0));
    expect(t5()[0]).toContain('status=open');
    expect(t5()[0]).not.toContain('assignee=');
  });

  it('status chips drive the server param and aria-pressed (single choice)', async () => {
    renderPage();
    await screen.findAllByTestId('agent-v2-task-row');
    const chip = screen.getByTestId('agent-v2-tsk-chip-in_progress') as HTMLButtonElement;
    expect(chip).toBeTruthy();
    expect(screen.getAllByTestId(/agent-v2-tsk-chip-/)).toHaveLength(5);
    fireEvent.click(chip);
    await waitFor(() => {
      const reqs = t5();
      expect(reqs[reqs.length - 1]).toContain('status=in_progress');
    });
    expect(
      (screen.getByTestId('agent-v2-tsk-chip-in_progress') as HTMLButtonElement).getAttribute(
        'aria-pressed'
      )
    ).toBe('true');
  });

  it('source facet filters the returned page client-side only', async () => {
    renderPage();
    await screen.findAllByTestId('agent-v2-task-row');
    const before = t5().length;
    // G1 FAIL 2: source is a dropdown beside 负责人/截止时间, not flat chips.
    expect(screen.queryByTestId('agent-v2-tsk-source-feishu')).toBeNull();
    fireEvent.click(screen.getByTestId('agent-v2-tsk-source-fsel'));
    const menu = screen.getByTestId('agent-v2-tsk-source-fsel-menu');
    const opt = Array.from(menu.querySelectorAll('button, [role="menuitem"]')).find(
      (el) => (el.textContent ?? '').includes('飞书消息')
    ) as HTMLElement;
    expect(opt).toBeTruthy();
    fireEvent.click(opt);
    await waitFor(() => {
      expect(screen.queryAllByTestId('agent-v2-task-row')).toHaveLength(3);
    });
    expect(t5().length).toBe(before);
  });

  /* jsdom limitation, honestly declared: in this harness a controlled
   * input's onChange -> setSearchParams does not re-render (verified working
   * in a real browser: before=5, after=1, extra /api/tasks requests=0; see
   * docs/validation/console/tasks-list/readout.txt SEARCHLIVE). The case
   * therefore drives the SAME client filter through its URL state (?q=),
   * which is the actual contract of the search box, and additionally
   * asserts the box is wired and typing never fires a server request. */
  it('client search narrows rows without any extra request', async () => {
    /* The search box is a pure client-side filter over the loaded page and
     * its state lives in the URL (?q=), so the case drives that URL state
     * directly and asserts no extra server round-trip. Typing into the
     * controlled input (onChange -> setSearchParams) does not reliably
     * re-render under this jsdom harness; live typing is therefore proven in
     * a real browser (transcript: readout.txt, SEARCHLIVE). Query '审批回调'
     * matches exactly one fixture row - the shared default title means
     * '周报' legitimately matches 4 of 5 rows, which was the old wrong
     * expectation. */
    const view = renderPage('/agent/tasks?q=审批回调');
    const rows = await waitFor(() => {
      const r = view.queryAllByTestId('agent-v2-task-row');
      expect(r.length).toBe(1);
      return r;
    });
    expect(rows).toHaveLength(1);
    for (const u of t5()) expect(u).not.toContain('q=');
    const input = view.getByTestId('agent-v2-tsk-search') as HTMLInputElement;
    expect(input.value).toBe('审批回调');
    const before = t5().length;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, '审批');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
    expect(t5().length).toBe(before); // zero extra server round-trips
    view.unmount();
  });

  it('result count reports matched / loaded without a fabricated total', async () => {
    renderPage();
    await screen.findAllByTestId('agent-v2-task-row');
    const rc = screen.getByTestId('agent-v2-tsk-result-count');
    expect(rc.textContent).toContain('命中');
    expect(rc.textContent).toContain('已加载');
  });

  it('follow-up rail is collapsed by default and opens from the header toggle', async () => {
    renderPage();
    await screen.findAllByTestId('agent-v2-task-row');
    expect(screen.queryByTestId('agent-v2-tsk-side')).toBeNull();
    const toggle = screen.getByTestId('agent-v2-tsk-side-toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    const side = await screen.findByTestId('agent-v2-tsk-side');
    expect(side.textContent).toContain('仅本页已加载');
    expect(side.textContent).toContain('等待上游数据');
  });

  it('never renders raw i18n keys, undefined or [object Object]', async () => {
    renderPage();
    await screen.findAllByTestId('agent-v2-task-row');
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('agentConsole.');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('[object Object]');
  });
});

/* Observer VG FAIL 1–4 (2026-11-16), display layer only. */
describe('TSK-01 VG FAIL fixes (observer 2026-11-16)', () => {
  const sourceCell = (row: HTMLElement) =>
    row.querySelector('[data-testid="agent-v2-task-source"]') as HTMLElement;
  const whoCell = (row: HTMLElement) =>
    row.querySelector('[data-testid="agent-v2-task-assignee"]') as HTMLElement;

  it('FAIL-1: source column is always Chinese; console→手动创建, unknown→其他; refs only in title, no sub-id line', async () => {
    tasksBody = {
      items: [
        task(T1, { source: { channel: 'console', messageId: 'tsk-pi-000000001116', runId: null } }),
        task(T2, { source: { channel: 'smoke_signal', messageId: 'om_9999888877776666', runId: null } }),
        task(T3), // feishu + om_1111222233334444 from the shared fixture
      ],
    };
    renderPage();
    const rows = await screen.findAllByTestId('agent-v2-task-row');
    const s1 = sourceCell(rows[0]);
    const s2 = sourceCell(rows[1]);
    const s3 = sourceCell(rows[2]);
    expect(s1.textContent).toContain('手动创建');
    expect(s1.textContent).not.toContain('console');
    expect(s2.textContent).toContain('其他');
    expect(s2.textContent).not.toContain('smoke_signal');
    expect(s3.textContent).toContain('飞书消息');
    // the second-line sub-id is gone; raw channel + message ref live in title
    for (const s of [s1, s2, s3]) {
      expect(s.textContent).not.toContain('…');
      expect(s.textContent).not.toContain('tsk-pi');
      expect(s.textContent).not.toContain('om_');
    }
    const t1 = s1.querySelector('span[title]')?.getAttribute('title') ?? '';
    expect(t1).toContain('channel=console');
    expect(t1).toContain('tsk-pi-000000001116');
    expect(screen.queryByLabelText('复制来源消息 ID')).toBeNull();
  });

  it('FAIL-2: five-state tones (neutral/amber/red/green/neutral+—), chip dots match, no accent', async () => {
    tasksBody = {
      items: [
        task(T1, { status: 'open' }),
        task(T2, { status: 'in_progress' }),
        task(T3, { status: 'blocked' }),
        task(T4, { status: 'done' }),
        task('tk_01HZZ0000000000000000ABCD05', { status: 'cancelled' }),
      ],
    };
    renderPage();
    const rows = await screen.findAllByTestId('agent-v2-task-row');
    const pill = (i: number) =>
      rows[i].querySelector('[data-testid="agent-v2-task-status"] .a2-pill') as HTMLElement;
    expect(pill(0).className).not.toContain('is-'); // 待办 neutral
    expect(pill(1).className).toContain('is-warn'); // 进行中 amber
    expect(pill(2).className).toContain('is-danger'); // 受阻 red
    expect(pill(3).className).toContain('is-ok'); // 已完成 green
    expect(pill(4).className).not.toContain('is-'); // 已取消 neutral
    expect(pill(4).textContent).toContain('—');
    expect(pill(4).textContent).toContain('已取消');
    rows.forEach((r) => {
      expect(
        (r.querySelector('[data-testid="agent-v2-task-status"] .a2-pill') as HTMLElement).className
      ).not.toContain('is-accent');
    });
    // filter chip dots carry the same tone classes as the table pills
    const dot = (s: string) =>
      screen.getByTestId(`agent-v2-tsk-chip-${s}`).querySelector('.a2-pill-dot') as HTMLElement;
    expect(dot('open').className).toContain('dot-neutral');
    expect(dot('in_progress').className).toContain('dot-warn');
    expect(dot('blocked').className).toContain('dot-danger');
    expect(dot('done').className).toContain('dot-ok');
    expect(screen.getByTestId('agent-v2-tsk-chip-cancelled').querySelector('.a2-pill-dot')).toBeNull();
    // the dot tone survives the chip's .active selected state
    fireEvent.click(screen.getByTestId('agent-v2-tsk-chip-blocked'));
    await waitFor(() => {
      expect(screen.getByTestId('agent-v2-tsk-chip-blocked').getAttribute('aria-pressed')).toBe('true');
    });
    expect(dot('blocked').className).toContain('dot-danger');
  });

  it('FAIL-3: human:self renders avatar initial + identity name + 本人 badge, never uid fragments', async () => {
    renderPage('/agent/tasks', 1, 'opsadmin');
    const rows = await screen.findAllByTestId('agent-v2-task-row');
    const who = whoCell(rows[0]);
    expect(who.textContent).toContain('opsadmin');
    expect(who.textContent).toContain('本人');
    expect(who.textContent).not.toContain('…1');
    expect(who.querySelector('[data-testid="agent-v2-task-assignee-avatar"]')?.textContent).toBe('o');
    expect(who.getAttribute('title')).toBe('human:1');
  });

  it('FAIL-3 live shape: T5 {type:"human",id:"1"} + string user_id resolves to self, never a bare 1', async () => {
    // Live T5 carries type/id as SEPARATE fields (no `human:` prefix) and the
    // shell identity user_id can be a string — the exact shape the first
    // FAIL-3 round missed because the fixtures used the combined `human:1`.
    tasksBody = {
      items: [
        task(T1, { assignee: { type: 'human', id: '1' } }),
        task(T2, { assignee: { type: 'human', id: '1' } }),
      ],
    };
    renderPage('/agent/tasks', '1', 'opsadmin');
    const rows = await screen.findAllByTestId('agent-v2-task-row');
    for (const row of rows) {
      const who = whoCell(row);
      expect(who.textContent).toContain('opsadmin');
      expect(who.textContent).toContain('本人');
      expect(who.textContent).not.toContain('…');
      expect(who.querySelector('[data-testid="agent-v2-task-assignee-avatar"]')?.textContent).toBe('o');
      // no standalone bare uid anywhere in the cell
      expect(who.textContent).not.toMatch(/(^|[^\w])1($|[^\w])/);
    }
    // the legacy combined `human:1` form stays covered by the default
    // fixtures in the other FAIL-3 cases (splitRef fallback path)
  });

  it('FAIL-3 live shape: without an identity name the split-field self falls back to 我', async () => {
    tasksBody = { items: [task(T1, { assignee: { type: 'human', id: '1' } })] };
    renderPage('/agent/tasks', '1');
    const rows = await screen.findAllByTestId('agent-v2-task-row');
    const who = whoCell(rows[0]);
    expect(who.textContent).toContain('我');
    expect(who.textContent).toContain('本人');
    expect(who.textContent).not.toMatch(/(^|[^\w])1($|[^\w])/);
  });

  it('FAIL-3: without an identity name the self cell falls back to 我, not the bare uid', async () => {
    renderPage();
    const rows = await screen.findAllByTestId('agent-v2-task-row');
    const who = whoCell(rows[0]);
    expect(who.textContent).toContain('我');
    expect(who.textContent).not.toContain('…1');
    expect(who.querySelector('[data-testid="agent-v2-task-assignee-avatar"]')?.textContent).toBe('我');
  });

  it('FAIL-3: other-human long ids ellipsize in-cell with the full ref kept in title', async () => {
    tasksBody = { items: [task(T1, { assignee: { type: 'human', id: 'human:999999999999' } })] };
    renderPage();
    const rows = await screen.findAllByTestId('agent-v2-task-row');
    const who = whoCell(rows[0]);
    const mono = who.querySelector('.a2-mono') as HTMLElement;
    expect(mono.style.textOverflow).toBe('ellipsis');
    expect(who.getAttribute('title')).toBe('human:999999999999');
    expect(who.textContent).not.toContain('…');
  });

  it('FAIL-4: footer carries the sideways-scroll hint line', async () => {
    renderPage();
    await screen.findAllByTestId('agent-v2-task-row');
    const hint = screen.getByTestId('agent-v2-tsk-scroll-hint');
    expect(hint.textContent).toContain('表格可左右滑动');
  });
});
