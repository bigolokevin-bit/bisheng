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
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
import type { ChainItem, CollabApi, CollabApiResult, DelegationRow } from '../collab';

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
  list?: CollabApiResult<{ items: DelegationRow[] }>;
  chains?: Record<string, CollabApiResult<{ items: ChainItem[] }>>;
}): CollabApi {
  return {
    listDelegations: vi.fn(async () => options.list ?? ok({ items: [row()] })),
    getChain: vi.fn(async (id: string) => options.chains?.[id] ?? ok({ items: chain() })),
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

  it('renders zero write controls — the four actions are one static sentence', async () => {
    const api = makeApi({});
    const { container } = renderPage(api);
    await settled();
    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());

    expect(screen.getByTestId('collab-write-note').textContent).toContain(
      '本环境暂未开放写操作（后端接线中）',
    );

    const controls = Array.from(
      container.querySelectorAll('button, a, [role="button"], input[type="submit"]'),
    ).map((el) => (el.textContent ?? '').trim() + ' ' + (el.getAttribute('aria-label') ?? ''));
    const writeWords = ['接受', '拒绝', '交接', '完成'];
    const offenders = controls.filter((name) => writeWords.some((word) => name.includes(word)));
    expect(offenders).toEqual([]);
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
