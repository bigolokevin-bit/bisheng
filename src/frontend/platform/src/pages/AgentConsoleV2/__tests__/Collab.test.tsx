/* eslint-disable */
/**
 * COL-01 `/agent/collab` — behaviour tests for the read-only collaboration view.
 *
 * Covers the frozen acceptance points this page owns:
 * - 200 with items → seven-column list, detail card and audit association
 * - 200 with `items: []` → the empty screen (no table, no 「共 0 条」)
 * - 403 and 404 → the SAME full-page screen, byte-identical, data never shown
 * - 500 and the 10 s timeout → the honest error screen with the request id
 * - the six statuses map to their Chinese labels (handed_off → 「交接中」)
 * - the budget column reads 「记在发起方：<name>」 and never a raw employee id
 * - zero write controls: the four actions are one static sentence
 * - `delegation.charged` × 2 collapse into one chain line
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
        (acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined),
        dict,
      );
    let text = typeof value === 'string' ? value : String(key);
    if (opts && typeof opts === 'object') {
      for (const [k, v] of Object.entries(opts as Record<string, unknown>)) {
        text = text.split(`{{${k}}}`).join(String(v));
      }
    }
    return text;
  };
  return { useTranslation: () => ({ t, i18n: { language: 'zh-Hans' } }) };
});

import { CollabPage } from '../CollabPage';
import type {
  ChainItem,
  CollabApi,
  CollabApiResult,
  DelegationListShape,
  DelegationRow,
} from '../collab';
import { EMPTY_FILTER, readCollabQuery, writeCollabQuery } from '../collab';

// ---------------------------------------------------------------- fixtures

const EMP_A = 'emp_01M7DG4KX2Z4B6DAAA';
const EMP_B = 'emp_01M7DG4KX2Z4B6DBBB';
const EMP_C = 'emp_01M7DG4KX2Z4B6DCCC';
const DL = 'dl_01M7DG4KX2Z4B6D0001';
const TK = 'tk_01M7DG4KX2Z4B6D0001';
const RQ = 'rq_01M7DG4KX2Z4B6D0001';

const TITLE = '整理华东十个客户的续费对账单，周五前发出';

function row(overrides: Partial<DelegationRow> = {}): DelegationRow {
  return {
    delegationId: DL,
    requestId: RQ,
    fromEmployeeId: EMP_A,
    toEmployeeId: EMP_B,
    taskId: TK,
    status: 'accepted',
    createdAt: '2026-11-17T06:02:00.000Z',
    updatedAt: '2026-11-17T06:05:00.000Z',
    title: TITLE,
    budget: { ownerEmployeeId: EMP_A, usedCostUsd: 18, capCostUsd: 100 },
    ...overrides,
  };
}

function chain(): ChainItem[] {
  return [
    { phase: 'delegation.requested', at: '2026-11-17T06:02:00.000Z', actor: EMP_A, note: '周五前发出' },
    { phase: 'delegation.accepted', at: '2026-11-17T06:05:00.000Z', actor: EMP_B },
    { phase: 'delegation.charged', at: '2026-11-17T06:06:00.000Z', actor: EMP_A },
    { phase: 'delegation.charged', at: '2026-11-17T06:06:00.000Z', actor: EMP_A },
  ];
}

const EMPLOYEES = {
  items: [
    { employeeId: EMP_A, name: '小鲤', title: '运营', lifecycleState: 'active', ownerUserId: 'u1', updatedAt: '2026-11-01T00:00:00.000Z' },
    { employeeId: EMP_B, name: '小满', title: '运营', lifecycleState: 'active', ownerUserId: 'u2', updatedAt: '2026-11-01T00:00:00.000Z' },
    { employeeId: EMP_C, name: '阿吉', title: '运营', lifecycleState: 'active', ownerUserId: 'u3', updatedAt: '2026-11-01T00:00:00.000Z' },
  ],
  nextCursor: undefined,
};

function ok<T>(data: T): CollabApiResult<T> {
  return { ok: true, status: 200, data, requestId: 'console-req-1' };
}

function fail<T>(status: number, requestId?: string, code?: string): CollabApiResult<T> {
  return { ok: false, status, data: null, requestId, code, message: 'nope' };
}

function makeApi(options: {
  list?: CollabApiResult<DelegationListShape>;
  chains?: Record<string, CollabApiResult<{ items: ChainItem[] }>>;
  write?: CollabApiResult<unknown>;
}): CollabApi {
  return {
    listDelegations: vi.fn(async () => options.list ?? ok({ items: [row()] })),
    getChain: vi.fn(async (id: string) => options.chains?.[id] ?? ok({ items: chain() })),
    submitDelegationAction: vi.fn(async () => options.write ?? ok({})),
  };
}

const consoleApi = {
  listEmployees: vi.fn(async () => EMPLOYEES),
} as unknown as { listEmployees: (params: { limit?: number }) => Promise<typeof EMPLOYEES> };

function renderPage(api: CollabApi) {
  return render(
    <MemoryRouter>
      <CollabPage api={api} consoleApi={consoleApi as never} />
    </MemoryRouter>,
  );
}

async function settled() {
  await waitFor(() => expect(screen.getByTestId('agent-v2-page-collab')).toBeTruthy());
}

// ---------------------------------------------------------------- tests

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('COL-01 collaboration view', () => {
  it('renders the seven-column list, the handover card and the audit association', async () => {
    const api = makeApi({});
    const { container } = renderPage(api);
    await settled();

    // ① the list — seven columns, the task title, both people by name.
    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
    const headers = Array.from(container.querySelectorAll('table.ctbl thead th')).map(
      (th) => th.textContent ?? '',
    );
    expect(headers).toEqual(['任务', '发起人', '接受人', '预算归属', '阶段', '更新时间', '操作']);
    expect(screen.getAllByText('小鲤').length).toBeGreaterThan(0);
    expect(screen.getAllByText('小满').length).toBeGreaterThan(0);

    // ② the handover card — stage rail, budget owner sentence, the chain.
    expect(screen.getByTestId('collab-detail')).toBeTruthy();
    expect(screen.getByText('已用 18%')).toBeTruthy();
    expect(screen.getByText('上限在 小鲤 的账上')).toBeTruthy();
    await waitFor(() => expect(container.querySelector('ol.tl')).toBeTruthy());

    // ③ the audit association — copyable ids, never rendered as raw values.
    expect(screen.getByTestId('collab-audit')).toBeTruthy();
    expect(screen.getByTestId('collab-audit-task')).toBeTruthy();
    expect(container.textContent ?? '').not.toContain('tk_01M7DG4KX2Z4B6D0001');
  });

  it('puts the budget on the requesting side, in words, never a bare id', async () => {
    const api = makeApi({});
    renderPage(api);
    await settled();
    await waitFor(() => expect(screen.getAllByText('记在发起方：小鲤').length).toBeGreaterThan(0));
    const body = screen.getByTestId('agent-v2-page-collab').textContent ?? '';
    expect(body).not.toContain(EMP_A);
    expect(body).not.toContain(EMP_B);
  });

  it('maps every delegation status to its Chinese label (handed_off = 交接中)', async () => {
    const rows = ['requested', 'accepted', 'handed_off', 'completed', 'rejected'].map((status, index) =>
      row({
        delegationId: `${DL}0${index}`,
        status,
        updatedAt: `2026-11-17T06:0${index}:00.000Z`,
      }),
    );
    const api = makeApi({ list: ok({ items: rows }) });
    renderPage(api);
    await waitFor(() => expect(screen.getAllByTestId(/collab-row-/).length).toBe(5));

    for (const label of ['已请求', '已接受', '交接中', '已完成', '已拒绝']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    // unknown statuses degrade to the neutral label, never the enum text.
    expect(screen.queryByText('handed_off')).toBeNull();
  });

  it('shows the empty screen for a successful empty list — no table, no 「共 0 条」', async () => {
    const api = makeApi({ list: ok({ items: [] }) });
    const { container } = renderPage(api);
    await waitFor(() => expect(screen.getByText('暂无可交接的任务')).toBeTruthy());
    expect(container.querySelector('table.ctbl')).toBeNull();
    expect(container.textContent ?? '').not.toContain('共 0');
    expect(screen.getByRole('button', { name: '回任务列表' })).toBeTruthy();
  });

  it('renders 403 and 404 as the same full-page screen, with no data behind it', async () => {
    const denied = makeApi({ list: fail(403, 'console-req-403') });
    const first = renderPage(denied);
    await waitFor(() => expect(screen.getByText('你看不到这些记录')).toBeTruthy());
    const deniedText = first.container.textContent ?? '';
    expect(first.container.querySelector('table.ctbl')).toBeNull();
    cleanup();

    const notFound = makeApi({ list: fail(404, 'console-req-404') });
    const second = renderPage(notFound);
    await waitFor(() => expect(screen.getByText('你看不到这些记录')).toBeTruthy());
    const notFoundText = second.container.textContent ?? '';
    expect(second.container.querySelector('table.ctbl')).toBeNull();

    // Same body copy; only the request id line may differ.
    const strip = (text: string) => text.replace(/console-req-\d+/g, 'REQ');
    expect(strip(notFoundText)).toBe(strip(deniedText));
    expect(first.container.textContent ?? '').not.toContain(TITLE);
  });

  it('shows the error screen with the request id for a 500', async () => {
    const api = makeApi({ list: fail(500, 'console-req-500') });
    renderPage(api);
    await waitFor(() => expect(screen.getByText('这几条记录没能读出来')).toBeTruthy());
    expect(screen.getByText('console-req-500')).toBeTruthy();
    expect(screen.queryByTestId('collab-detail')).toBeNull();
  });

  it('says 本次未能读取 when the read times out', async () => {
    const api = makeApi({ list: fail(0, 'console-req-timeout', 'console.timeout') });
    renderPage(api);
    await waitFor(() => expect(screen.getByText('这几条记录没能读出来')).toBeTruthy());
    expect(screen.getByText(/本次未能读取/)).toBeTruthy();
  });

  it('offers exactly the stage action, never a dead button', async () => {
    const api = makeApi({});
    renderPage(api);
    await settled();
    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());

    // Fixture status is `accepted`, so handoff is the only action on offer.
    expect(screen.getByTestId('collab-action-handoff')).toBeTruthy();
    expect(screen.queryByTestId('collab-action-accept')).toBeNull();
    expect(screen.queryByTestId('collab-action-reject')).toBeNull();
    expect(screen.queryByTestId('collab-action-complete')).toBeNull();
  });

  it('collapses two charged ledger rows into one chain line without any amount', async () => {
    const api = makeApi({});
    const { container } = renderPage(api);
    await settled();
    await waitFor(() => expect(container.querySelector('ol.tl')).toBeTruthy());
    const timeline = container.querySelector('ol.tl') as HTMLElement;

    expect(within(timeline).getAllByText('记账').length).toBe(1);
    expect(
      within(timeline).getByText('日账与月账各记一行，合成一行显示；不显示金额。共 2 行'),
    ).toBeTruthy();
    expect(timeline.textContent ?? '').not.toContain('$');
    expect(timeline.textContent ?? '').not.toContain('¥');
  });

  it('keeps the chain honest when it cannot be read', async () => {
    const api = makeApi({ chains: { [DL]: fail(500, 'console-req-chain') } });
    renderPage(api);
    await waitFor(() => expect(screen.getByText('交接链没能读出来。这一步只是读取，没有改动任何东西。')).toBeTruthy());
    expect(screen.getByTestId('collab-chain-retry')).toBeTruthy();
  });
});

// ---------------------------------------------------------------- S3-W3

describe('COL-01 S3-W3 — PRD v0.3 alignment', () => {
  it('prefers the server asOf over the local clock for 「读取于」', async () => {
    const api = makeApi({ list: ok({ items: [row()], asOf: '2026-11-17T12:34:00.000Z' }) });
    renderPage(api);
    await waitFor(() => expect(screen.getByText(/2026-11-17 20:34/)).toBeTruthy());
  });

  it('reads one cursor page at a time and appends it without a total', async () => {
    const second = row({ delegationId: `${DL}02`, taskId: `${TK}02`, title: '把对账单按客户拆成十份' });
    const calls: Array<string | undefined> = [];
    const api: CollabApi = {
      listDelegations: vi.fn(async (cursor?: string) => {
        calls.push(cursor);
        if (cursor === 'c2') return ok({ items: [second], nextCursor: null });
        return ok({ items: [row()], nextCursor: 'c2' });
      }),
      getChain: vi.fn(async () => ok({ items: chain() })),
    };
    const { container } = renderPage(api);
    await waitFor(() => expect(screen.getByText('已加载 1 条')).toBeTruthy());
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);

    const more = screen.getByTestId('collab-load-more');
    fireEvent.click(more);

    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(2));
    expect(calls).toEqual([undefined, 'c2']);
    expect(screen.getByText('已加载 2 条')).toBeTruthy();
    expect(screen.queryByTestId('collab-load-more')).toBeNull();
    expect(container.textContent).not.toMatch(/共\s*\d+\s*条/);
  });

  it('falls back to 「员工 · 8 位大写短码」 and never shows a raw employee id', async () => {
    const stranger = 'emp_9f3a1b2c4d5e6f70';
    const api = makeApi({ list: ok({ items: [row({ toEmployeeId: stranger })] }) });
    const { container } = renderPage(api);
    await waitFor(() => expect(screen.getByTestId('collab-detail')).toBeTruthy());
    expect(container.textContent).toContain('员工 · 9F3A1B2C');
    expect(container.textContent).not.toContain('emp_9f3a1b2c4d5e6f70');
  });

  it('formats every timestamp as Beijing time to the minute', async () => {
    const api = makeApi({});
    const { container } = renderPage(api);
    await waitFor(() => expect(container.textContent).toContain('2026-11-17 14:05'));
    expect(container.textContent).not.toMatch(/T06:05|06:05/);
  });
});

describe('COL-01 §FILT — filters narrow what was loaded', () => {
  it('filters by status and clears back to the full list', async () => {
    const second = row({ delegationId: `${DL}02`, taskId: `${TK}02`, status: 'requested', title: '把对账单按客户拆成十份' });
    const api = makeApi({ list: ok({ items: [row(), second] }) });
    const { container } = renderPage(api);
    await waitFor(() => expect(screen.getByTestId('collab-filters')).toBeTruthy());
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);

    fireEvent.change(screen.getByTestId('collab-filter-status'), { target: { value: 'requested' } });
    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(1));
    expect(container.textContent).toContain('把对账单按客户拆成十份');

    fireEvent.click(screen.getByTestId('collab-clear-filters'));
    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(2));
    expect(screen.queryByTestId('collab-clear-filters')).toBeNull();
  });

  it('filters by a 24h window on the last action time', async () => {
    const now = Date.now();
    const old = row({ delegationId: `${DL}03`, taskId: `${TK}03`, title: '去年的一份旧交接', updatedAt: new Date(now - 10 * 24 * 3600 * 1000).toISOString() });
    const fresh = row({ delegationId: `${DL}04`, taskId: `${TK}04`, title: '刚刚发生的一次交接', updatedAt: new Date(now - 60 * 1000).toISOString() });
    const api = makeApi({ list: ok({ items: [old, fresh] }) });
    const { container } = renderPage(api);
    await waitFor(() => expect(screen.getByTestId('collab-filters')).toBeTruthy());

    fireEvent.click(screen.getByTestId('collab-filter-window-24h'));
    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(1));
    expect(container.textContent).toContain('刚刚发生的一次交接');
    expect(container.textContent).not.toContain('去年的一份旧交接');
  });

  it('shows the related-task link and the owner-side USD amount without a raw id', async () => {
    const api = makeApi({});
    const { container } = renderPage(api);
    await waitFor(() => expect(container.textContent).toContain('记在发起方：小鲤'));
    expect(container.textContent).toContain('$18.00');
    const link = within(container).getAllByRole('link').find((node) => node.getAttribute('href') === `/agent/tasks/${TK}`);
    expect(link).toBeTruthy();
    expect(container.textContent).not.toContain(TK);
  });
});

describe('COL-01 write actions wired to the BFF proxies', () => {
  function calls(api: CollabApi): unknown[][] {
    return (api.submitDelegationAction as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  }

  it('asks for a reason first, posts once with it, then re-reads the list', async () => {
    const api = makeApi({ list: ok({ items: [row({ status: 'requested' })] }) });
    renderPage(api);
    await settled();
    await waitFor(() => expect(screen.getByTestId('collab-action-reject')).toBeTruthy());

    fireEvent.click(screen.getByTestId('collab-action-reject'));
    const confirm = screen.getByTestId('collab-write-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByTestId('collab-write-reason'), {
      target: { value: '手上排满了，这周接不了' },
    });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() => expect(api.listDelegations).toHaveBeenCalledTimes(2));
    expect(calls(api)).toHaveLength(1);
    const [action, id, body, requestId] = calls(api)[0];
    expect(action).toBe('reject');
    expect(id).toBe(DL);
    expect(body).toEqual({ reason: '手上排满了，这周接不了' });
    expect(typeof requestId).toBe('string');
  });

  it('posts handoff for an accepted stage', async () => {
    const api = makeApi({});
    renderPage(api);
    await settled();
    fireEvent.click(await screen.findByTestId('collab-action-handoff'));
    fireEvent.click(screen.getByTestId('collab-write-confirm'));

    await waitFor(() => expect(calls(api)).toHaveLength(1));
    expect(calls(api)[0][0]).toBe('handoff');
    expect(calls(api)[0][2]).toEqual({});
  });

  it('explains a moved-on stage in words, with the request id and no raw code', async () => {
    const api = makeApi({
      list: ok({ items: [row({ status: 'accepted' })] }),
      write: {
        ok: false,
        status: 409,
        data: null,
        code: 'delegation.illegal_transition',
        requestId: 'console-req-moved',
      },
    });
    const { container } = renderPage(api);
    await settled();
    fireEvent.click(await screen.findByTestId('collab-action-handoff'));
    fireEvent.click(screen.getByTestId('collab-write-confirm'));

    await waitFor(() => expect(screen.getByTestId('collab-write-error')).toBeTruthy());
    const error = screen.getByTestId('collab-write-error');
    expect(error.textContent).toContain('该委托状态已变化，请刷新后重试。');
    expect(error.textContent).toContain('console-req-moved');
    expect(container.textContent).not.toContain('illegal_transition');
    expect(error.textContent).not.toContain('409');
  });

  it('lifts a 401 into the session banner', async () => {
    const api = makeApi({
      list: ok({ items: [row({ status: 'accepted' })] }),
      write: { ok: false, status: 401, data: null, code: 'delegation.unauthorized' },
    });
    renderPage(api);
    await settled();
    fireEvent.click(await screen.findByTestId('collab-action-handoff'));
    fireEvent.click(screen.getByTestId('collab-write-confirm'));

    await waitFor(() => expect(screen.getByTestId('collab-auth-banner')).toBeTruthy());
  });
});

describe('COL-01 deep links (§FILT-01..03)', () => {
  it('reads and writes the three legs canonically', () => {
    expect(readCollabQuery('?status=requested&window=24h&participant=emp_1').filter).toEqual({
      status: 'requested',
      window: '24h',
      participant: 'emp_1',
    });
    expect(readCollabQuery('status=accepted&window=90d').filter).toEqual({
      status: 'accepted',
      window: 'all',
      participant: '',
    });
    expect(readCollabQuery('status=accepted&window=90d').unknown).toEqual(['window=90d']);
    expect(writeCollabQuery(EMPTY_FILTER)).toBe('');
    expect(writeCollabQuery({ status: 'handed_off', window: '7d', participant: '' })).toBe(
      '?status=handed_off&window=7d',
    );
  });

  it('opens straight into the filtered view from a deep link', async () => {
    const api = makeApi({
      list: ok({
        items: [row({ status: 'requested' }), row({ delegationId: 'dl_other', status: 'completed' })],
      }),
    });
    render(
      <MemoryRouter initialEntries={['/agent/collab?status=requested']}>
        <CollabPage api={api} consoleApi={consoleApi as never} />
      </MemoryRouter>,
    );
    await settled();
    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());

    expect(screen.getByTestId('collab-filter-status')).toHaveProperty('value', 'requested');
    expect(screen.getByTestId('collab-row-dl_01M7DG4KX2Z4B6D0001')).toBeTruthy();
    expect(screen.queryByTestId('collab-row-dl_other')).toBeNull();
  });

  it('explains a delegating 403 without a raw code or a retry button', async () => {
    const api = makeApi({
      list: ok({ items: [row({ status: 'accepted' })] }),
      write: { ok: false, status: 403, data: null, code: 'delegation.denied' },
    });
    renderPage(api);
    await settled();
    fireEvent.click(await screen.findByTestId('collab-action-handoff'));
    fireEvent.click(screen.getByTestId('collab-write-confirm'));

    await waitFor(() => expect(screen.getByTestId('collab-write-error')).toBeTruthy());
    const error = screen.getByTestId('collab-write-error');
    expect(error.textContent).toContain('当前账号没有向该员工委派的职责。');
    expect(error.textContent).not.toContain('delegation.denied');
    expect(within(error).queryByRole('button')).toBeNull();
  });
});
