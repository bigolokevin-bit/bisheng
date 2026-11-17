/* eslint-disable no-restricted-syntax -- fixtures/assertions mirror the frozen AUD-01 copy and the aud01-target.html sample shapes */
/**
 * AUD-01 `/agent/audit` page (AUD01-TARGET-SPEC §1, §9 checklist).
 *
 * Unit-testable C1/C2 assertions:
 * - 12 fixed columns in target order;
 * - ZERO write entries in the DOM (导出/下载/修改/删除/补录/回滚/验证此条/批准/驳回…);
 * - A3 always carries a real filter (default 24h sends both bounds), and the
 *   「no condition」 guide state sends NOTHING;
 * - the chain panel's colour gate: S0 neutral, S2 warning (negative!), S3
 *   danger with the first-break label and a disabled 「查看」, S4 by HTTP code;
 * - free-text safety: upstream markup stays text (no injected children);
 * - task jump is the honest disabled state while TSK-02 is unbuilt, and the
 *   copy button still works;
 * - cursor foot: explicit next page, last page on key omission, stale guard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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
          acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
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

import type { EmployeeList, EmployeeSummary } from '@/controllers/API/agent';

import { AuditListPage } from '../AuditListPage';
import type {
  AuditApi,
  AuditApiResult,
  AuditEvent,
  AuditListShape,
  AuditVerifyResult,
} from '../aud01';

// ---------------------------------------------------------------- fixtures

function event(patch: Partial<AuditEvent> = {}): AuditEvent {
  return {
    eventId: 'ev_01M7DEY8ZQ4R7T2V8X0Y2A4B6C',
    schemaVersion: 'v1',
    tenantId: 'seakoi',
    occurredAt: '2026-11-17T09:18:42.117Z',
    recordedAt: '2026-11-17T09:18:42.917Z',
    sourceSystem: 'policy',
    actor: { type: 'employee', id: 'emp_86A81CE8FF6F42E187BCF2B540', displayName: '小鲤' },
    action: 'policy.check',
    resource: { type: 'action', id: 'order.read' },
    outcome: 'success',
    decision: 'allow',
    onBehalfOf: 'human:u_10001',
    runId: 'rn_01M7DEY86XMD8J2SJZES4TGPWJ',
    ...patch,
  };
}

const GRANT_EVENT = event({
  eventId: 'ev_GRANT_1',
  occurredAt: '2026-11-17T08:55:31.902Z',
  recordedAt: '2026-11-17T08:55:33.102Z',
  sourceSystem: 'employee',
  actor: { type: 'human', id: 'u_10001', displayName: '陈诚' },
  action: 'grant.created',
  decision: 'not_applicable',
  runId: undefined,
  onBehalfOf: undefined,
  approvalId: 'ap_01M7DAJV3K8Q2R5T7V9X1Y3B5D',
  resource: { type: 'grant', id: 'gr_3A384C3D17154889A609670E8C' },
  after: {
    scopeType: 'channel',
    resourceSelector: 'types:[chat]',
    actions: 'send',
    expiresAt: '2026-12-31T23:59:59Z',
    role: 'owner',
  },
  hash: 'ah_4d8e2f1a9b391ab7c5d2e0f8a1b63c42',
  prevHash: 'ah_9f2c1a77d4e04b86a1c9d3f5e7b02c18',
  correlationId: 'idem_gr_3A38_01',
  policyDecisionId: 'pd_5D813E82A7C4096FB1E3D5A8',
});

const UNSAFE_EVENT = event({
  eventId: 'ev_UNSAFE',
  actor: { type: 'human', id: 'u_9', displayName: '<b>陈诚</b> <img src=x onerror=1>' },
  action: 'employee.version.create',
  decision: 'not_applicable',
  outcome: 'success',
  resource: { type: 'employee_version', id: `empv_"quote'd"` },
});

const FAILED_EVENT = event({
  eventId: 'ev_FAILED',
  action: 'employee.version.create',
  actor: { type: 'system', id: 'employee-api' },
  decision: undefined,
  outcome: 'failure',
  resource: { type: 'employee', id: 'emp_5B3C7A9D1E2F4068B5C3D7E9' },
  error: { code: 'employee.version.invalid', messageRedacted: 'version payload rejected' },
});

const EMPLOYEES: EmployeeSummary[] = [
  {
    employeeId: 'emp_86A81CE8FF6F42E187BCF2B540',
    name: '小鲤',
    title: '运营助手',
    lifecycleState: 'active',
    ownerUserId: 'u_10001',
    updatedAt: '2026-11-16T00:00:00Z',
  },
];

function okList(events: AuditEvent[], nextCursor?: string): AuditApiResult<AuditListShape> {
  return { ok: true, status: 200, data: { events, nextCursor } };
}

interface Harness {
  listCalls: Array<Record<string, unknown>>;
  verifyCalls: Array<{ from: string; to: string }>;
  api: AuditApi;
}

function harness(opts: {
  pages?: AuditApiResult<AuditListShape>[];
  verify?: AuditApiResult<AuditVerifyResult>[];
}): Harness {
  const listCalls: Array<Record<string, unknown>> = [];
  const verifyCalls: Array<{ from: string; to: string }> = [];
  const pages = opts.pages ?? [okList([])];
  const verifies = opts.verify ?? [
    { ok: true, status: 200, data: { ok: true, complete: true, scanned: 0 } },
  ];
  return {
    listCalls,
    verifyCalls,
    api: {
      listAudit: (params) => {
        listCalls.push(params as Record<string, unknown>);
        const page = pages[Math.min(listCalls.length - 1, pages.length - 1)];
        return Promise.resolve(page);
      },
      verifyAudit: (params) => {
        verifyCalls.push(params);
        const page = verifies[Math.min(verifyCalls.length - 1, verifies.length - 1)];
        return Promise.resolve(page);
      },
    },
  };
}

const consoleStub = {
  listEmployees: () =>
    Promise.resolve({
      items: EMPLOYEES,
      nextCursor: undefined,
    } as EmployeeList),
};

function renderPage(h: Harness, search = '') {
  return render(<AuditListPage api={h.api} consoleApi={consoleStub} initialSearch={search} />);
}

const FORBIDDEN = /导出|下载|修改|删除|补录|还原|回滚|应用回|验证此条|重新导出|撤销|新建|批量|创建|批准|驳回/;

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------- tests

describe('AUD-01 columns + zero write entries (§1.7, §9 items 3/12)', () => {
  it('renders the 12 columns in the frozen order', async () => {
    const h = harness({ pages: [okList([event()])] });
    const { container } = renderPage(h);
    await waitFor(() => expect(screen.getByTestId('agent-v2-page-audit')).toBeInTheDocument());

    const heads = Array.from(container.querySelectorAll('table.tbl thead th')).map((th) =>
      // the header HelpTip contributes a 「?」 glyph; labels are what matters
      (th.textContent ?? '').replace(/\s+/g, '').replace(/\?/g, ''),
    );
    expect(heads).toEqual([
      '时间',
      '来源',
      '动作',
      '主体',
      '代谁',
      '决定',
      '结果',
      'run',
      '任务',
      '审批',
      '资源',
      '操作',
    ]);
  });

  it('has zero visible write entries and no 「待接入」 placeholder', async () => {
    const h = harness({ pages: [okList([event(), GRANT_EVENT])] });
    const { container } = renderPage(h);
    await waitFor(() => expect(screen.getByTestId('agent-v2-page-audit')).toBeInTheDocument());

    const candidates = Array.from(
      container.querySelectorAll('button, a, [role="button"]'),
    ) as HTMLElement[];
    const offenders = candidates
      .filter((el) => FORBIDDEN.test(el.textContent ?? ''))
      .map((el) => el.textContent);
    expect(offenders).toEqual([]);
    expect(container.textContent).not.toContain('待接入');
  });

  it('keeps the read-only banner on every state (§9 item 2)', async () => {
    const h = harness({
      pages: [{ ok: false, status: 502, data: null }],
    });
    renderPage(h);
    await waitFor(() => expect(screen.getByTestId('aud01-error')).toBeInTheDocument());
    expect(screen.getByRole('note', { name: '本页只读边界' })).toBeInTheDocument();
  });
});

describe('AUD-01 filters → A3 request (§1.5/§7)', () => {
  it('the default window is always sent as from+to (never an unfiltered query)', async () => {
    const h = harness({ pages: [okList([event()])] });
    renderPage(h);
    await waitFor(() => expect(h.listCalls.length).toBe(1));
    const call = h.listCalls[0];
    expect(typeof call.from).toBe('string');
    expect(typeof call.to).toBe('string');
    expect(call.limit).toBe(50);
  });

  it('an empty custom window sends NOTHING and shows the guide state', async () => {
    const h = harness({ pages: [okList([event()])] });
    renderPage(h, '?window=custom');
    await waitFor(() => expect(screen.getByTestId('aud01-nofilter')).toBeInTheDocument());
    expect(h.listCalls).toHaveLength(0);
    expect(screen.getByTestId('lk-loaded').textContent).toContain('未查询');
    expect(screen.getByText('审计查询至少要有一个条件')).toBeInTheDocument();
  });

  it('an action search becomes an exact action filter', async () => {
    const h = harness({ pages: [okList([event()])] });
    renderPage(h);
    await waitFor(() => expect(h.listCalls.length).toBe(1));

    fireEvent.change(screen.getByTestId('aud01-search'), {
      target: { value: 'grant.created' },
    });
    fireEvent.keyDown(screen.getByTestId('aud01-search'), { key: 'Enter' });

    await waitFor(() => expect(h.listCalls.length).toBe(2));
    expect(h.listCalls[1].action).toBe('grant.created');
    expect(h.listCalls[1].actorId).toBeUndefined();
  });

  it('`emp_` asks which side, then filters by resourceId (G-03 UI)', async () => {
    const h = harness({ pages: [okList([event()])] });
    renderPage(h);
    await waitFor(() => expect(h.listCalls.length).toBe(1));

    fireEvent.change(screen.getByTestId('aud01-search'), {
      target: { value: 'emp_86A81CE8FF6F42E187BCF2B540' },
    });
    fireEvent.keyDown(screen.getByTestId('aud01-search'), { key: 'Enter' });
    expect(screen.getByTestId('aud01-emp-pick')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('aud01-emp-pick-resource'));
    await waitFor(() => expect(h.listCalls.length).toBe(2));
    expect(h.listCalls[1].resourceId).toBe('emp_86A81CE8FF6F42E187BCF2B540');
    expect(h.listCalls[1].actorId).toBeUndefined();
  });

  it('`ev_` is refused instead of pretending it can be queried (§9 item 11)', async () => {
    const h = harness({ pages: [okList([event()])] });
    renderPage(h);
    await waitFor(() => expect(h.listCalls.length).toBe(1));

    fireEvent.change(screen.getByTestId('aud01-search'), {
      target: { value: 'ev_01M7DEY8ZQ4R7T2V8X0Y2A4B6C' },
    });
    fireEvent.keyDown(screen.getByTestId('aud01-search'), { key: 'Enter' });
    expect(screen.getByTestId('aud01-search-note')).toBeInTheDocument();
    expect(h.listCalls).toHaveLength(1);
  });

  it('clear falls back to the default 24h window, never to no-filter', async () => {
    const h = harness({ pages: [okList([event()])] });
    renderPage(h, '?action=grant.created');
    await waitFor(() => expect(h.listCalls.length).toBe(1));

    fireEvent.click(screen.getByTestId('lk-clear'));
    await waitFor(() => expect(h.listCalls.length).toBe(2));
    expect(h.listCalls[1].action).toBeUndefined();
    expect(typeof h.listCalls[1].from).toBe('string');
    expect(screen.queryByTestId('aud01-nofilter')).toBeNull();
  });
});

describe('AUD-01 chain panel states (§1.6)', () => {
  it('S0 (no anchor) is neutral — green never appears', async () => {
    const h = harness({
      pages: [okList([event()])],
      verify: [{ ok: true, status: 200, data: { ok: true, complete: true, scanned: 0 } }],
    });
    renderPage(h);
    await waitFor(() => expect(screen.getByTestId('aud01-verify-s0')).toBeInTheDocument());
    expect(screen.queryByTestId('aud01-verify-s1')).toBeNull();
  });

  it('S1 passes only when the four conditions hold', async () => {
    const h = harness({
      pages: [okList([event()])],
      verify: [
        {
          ok: true,
          status: 200,
          data: {
            ok: true,
            complete: true,
            scanned: 1284,
            anchorCheckpointId: 'cpk_20261116_09',
            chainHeadHash: 'ah_9f2c1a77d4e04b86a1c9d3f5e7b02c18',
            preAnchorEventCount: 37,
          },
        },
      ],
    });
    renderPage(h);
    await waitFor(() => expect(screen.getByTestId('aud01-verify-s1')).toBeInTheDocument());
    expect(screen.getByTestId('aud01-verify-s1').textContent).toContain('1,284');
    expect(screen.getByTestId('aud01-verify-s1').textContent).toContain('37');
  });

  it('NEGATIVE: complete=false renders the warning state, not green', async () => {
    const h = harness({
      pages: [okList([event()])],
      verify: [
        {
          ok: true,
          status: 200,
          data: {
            ok: true,
            complete: false,
            scanned: 100_000,
            anchorCheckpointId: 'cpk_20261116_09',
          },
        },
      ],
    });
    renderPage(h);
    await waitFor(() => expect(screen.getByTestId('aud01-verify-s2')).toBeInTheDocument());
    expect(screen.queryByTestId('aud01-verify-s1')).toBeNull();
    const panel = screen.getByTestId('aud01-verify-s2');
    expect(panel.className).toContain('s2');
    expect(panel.textContent).toContain('complete = false');
  });

  it('S3 names the first break, caps the list and keeps 「查看」 disabled', async () => {
    const h = harness({
      pages: [okList([event()])],
      verify: [
        {
          ok: true,
          status: 200,
          data: {
            ok: false,
            complete: true,
            scanned: 1284,
            brokenCount: 3,
            brokenEventIds: ['ev_1', 'ev_2', 'ev_3'],
            anchorCheckpointId: 'cpk_20261116_09',
          },
        },
      ],
    });
    renderPage(h);
    await waitFor(() => expect(screen.getByTestId('aud01-verify-s3')).toBeInTheDocument());
    const panel = screen.getByTestId('aud01-verify-s3');
    expect(panel.textContent).toContain('首个断点');
    expect(panel.textContent).not.toContain('疑似篡改');
    const viewButtons = within(panel)
      .getAllByRole('button', { name: '查看' })
      .filter((b) => (b as HTMLButtonElement).disabled);
    expect(viewButtons).toHaveLength(3);
  });

  it('S4 reports the HTTP code and never claims anything about the chain', async () => {
    const h = harness({
      pages: [okList([event()])],
      verify: [{ ok: false, status: 502, data: null, requestId: '034a01b5817d' }],
    });
    renderPage(h);
    await waitFor(() => expect(screen.getByTestId('aud01-verify-s4')).toBeInTheDocument());
    const panel = screen.getByTestId('aud01-verify-s4');
    expect(panel.textContent).toContain('HTTP 502');
    expect(panel.textContent).toContain('034a01b5817d');
    expect(panel.textContent).toContain('这不表示链有问题');
  });
});

describe('AUD-01 safety + links (§3, §1.7)', () => {
  it('renders upstream markup as text (no injected elements, quotes preserved)', async () => {
    const h = harness({ pages: [okList([UNSAFE_EVENT])] });
    const { container } = renderPage(h);
    await waitFor(() => expect(screen.getByTestId('aud01-row-ev_UNSAFE')).toBeInTheDocument());

    const who = container.querySelector(`[data-testid="aud01-row-ev_UNSAFE"] .who`) as HTMLElement;
    expect(who.querySelector('.nm')?.textContent).toBe('<b>陈诚</b> <img src=x onerror=1>');
    expect(who.querySelectorAll('b, img')).toHaveLength(0);
    expect(container.querySelectorAll('img')).toHaveLength(0);
    const resCell = container.querySelector(
      '[data-testid="aud01-row-ev_UNSAFE"] .rescell .cp',
    ) as HTMLElement;
    // display is truncated; the full original bytes live in title (what copy writes)
    expect(resCell.getAttribute('title')).toBe(`empv_"quote'd"`);
    expect(resCell.textContent).not.toContain('<b>');
  });

  it('task jump is disabled with a reason while TSK-02 is unbuilt, copy still works', async () => {
    const withTask = event({
      eventId: 'ev_TASK',
      action: 'message.send',
      runId: undefined,
      taskId: 'tk_01M7DEY7QK3T8V2W4X6Y8A0BCE',
    });
    const h2 = harness({ pages: [okList([withTask])] });
    renderPage(h2, '?action=message.send');
    await waitFor(() => expect(screen.getByTestId('aud01-row-ev_TASK')).toBeInTheDocument());

    const row = screen.getByTestId('aud01-row-ev_TASK');
    const jump = within(row).getByText('查看任务');
    expect(jump.getAttribute('aria-disabled')).toBe('true');
    expect(jump.getAttribute('href')).toBeNull();
    expect(jump.getAttribute('title')).toContain('TSK-02');
    // the copy control is independent of the dead link
    expect(within(row).getAllByRole('button', { name: '复制任务 ID' })).toHaveLength(1);
  });

  it('run / employee rows link out; the approval jump sits in the expansion', async () => {
    const h = harness({ pages: [okList([event(), GRANT_EVENT, FAILED_EVENT])] });
    renderPage(h);
    await waitFor(() => expect(screen.getByTestId('aud01-row-ev_01M7DEY8ZQ4R7T2V8X0Y2A4B6C')).toBeInTheDocument());

    expect(
      screen
        .getByTestId('aud01-run-link-ev_01M7DEY8ZQ4R7T2V8X0Y2A4B6C')
        .querySelector('a')
        ?.getAttribute('href'),
    ).toBe('/agent/runs/rn_01M7DEY86XMD8J2SJZES4TGPWJ');
    // the approval jump lives in the expansion (the 88px row cell keeps the id only)
    fireEvent.click(screen.getByTestId('aud01-expand-ev_GRANT_1'));
    expect(screen.getByTestId('aud01-exp-ev_GRANT_1').querySelector('a.jump')?.getAttribute('href')).toBe(
      '/agent/approvals/ap_01M7DAJV3K8Q2R5T7V9X1Y3B5D',
    );
    expect(screen.getByTestId('aud01-employee-link-ev_FAILED').getAttribute('href')).toBe(
      '/agent/employees/emp_5B3C7A9D1E2F4068B5C3D7E9',
    );
  });
});

describe('AUD-01 expansion (§1.8)', () => {
  it('opens the key-level diff + integrity without any A4 call', async () => {
    const h = harness({ pages: [okList([GRANT_EVENT])] });
    renderPage(h, '?action=grant.created');
    await waitFor(() => expect(screen.getByTestId('aud01-row-ev_GRANT_1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('aud01-expand-ev_GRANT_1'));
    const exp = screen.getByTestId('aud01-exp-ev_GRANT_1');
    expect(exp.textContent).toContain('变更（before → after）');
    expect(exp.textContent).toContain('scopeType');
    expect(exp.textContent).toContain('+');
    expect(exp.textContent).toContain('schemaVersion');
    expect(exp.textContent).toContain('没有「验证此条」入口');
    expect(exp.textContent).toContain('idem_gr_3…8_01');
    expect(exp.querySelector('.cp[title="idem_gr_3A38_01"]')).not.toBeNull();
    expect(exp.textContent).toContain('无只读通路，不可跳转');
  });

  it('explains an empty diff instead of drawing an empty box', async () => {
    const h = harness({ pages: [okList([event()])] });
    renderPage(h);
    await waitFor(() => expect(screen.getByTestId('aud01-row-ev_01M7DEY8ZQ4R7T2V8X0Y2A4B6C')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('aud01-expand-ev_01M7DEY8ZQ4R7T2V8X0Y2A4B6C'));
    expect(screen.getByTestId('aud01-exp-ev_01M7DEY8ZQ4R7T2V8X0Y2A4B6C').textContent).toContain(
      '该事件不含字段差异',
    );
  });
});

describe('AUD-01 cursor foot (§1.9)', () => {
  it('omitted nextCursor ⇒ disabled next page + the derivation line', async () => {
    const h = harness({ pages: [okList([event(), event({ eventId: 'ev_2' })])] });
    renderPage(h);
    await waitFor(() => expect(screen.getByTestId('lk-page-rows').textContent).toContain('2'));

    const next = screen.getByTestId('lk-next') as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    expect(next.getAttribute('title')).toContain('nextCursor');
    expect(screen.getByTestId('lk-lastpage-note').textContent).toContain('已是末页');
  });

  it('consumes the cursor explicitly and stops on replay', async () => {
    const h = harness({
      pages: [
        okList([event()], 'cursor-1'),
        // replay: page 2 repeats page 1 ⇒ the guard must stop merging
        okList([event()], 'cursor-2'),
      ],
    });
    renderPage(h);
    await waitFor(() => expect((screen.getByTestId('lk-next') as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByTestId('lk-next'));
    await waitFor(() => expect(h.listCalls.length).toBe(2));
    expect(h.listCalls[1].cursor).toBe('cursor-1');
    await waitFor(() => expect(screen.getByTestId('lk-stale')).toBeInTheDocument());
    expect(h.listCalls).toHaveLength(2); // no third automatic request
  });
});

describe('AUD-01 empty / error / forbidden (§1.10)', () => {
  it('empty keeps the filters and explains the grant gap', async () => {
    const h = harness({ pages: [okList([])] });
    renderPage(h, '?action=grant.created');
    await waitFor(() => expect(screen.getByTestId('lk-empty')).toBeInTheDocument());
    expect(screen.getByTestId('lk-empty').textContent).toContain('没有匹配的审计事件');
    expect(screen.getByTestId('lk-empty').textContent).toContain('grant');
    expect(screen.getByTestId('lk-filterbar')).toBeInTheDocument();
  });

  it('error shows the HTTP code and claims no cached data', async () => {
    const h = harness({ pages: [{ ok: false, status: 502, data: null }] });
    renderPage(h);
    await waitFor(() => expect(screen.getByTestId('aud01-error')).toBeInTheDocument());
    const card = screen.getByTestId('aud01-error');
    expect(card.textContent).toContain('HTTP 502');
    expect(card.textContent).toContain('缓存');
    expect(card.textContent).not.toContain('audit.query_too_broad');
    expect(card.textContent).not.toContain('console.missing_filter');
  });

  it('403 replaces the whole page (no half table, no skeleton)', async () => {
    const h = harness({ pages: [{ ok: false, status: 403, data: null }] });
    renderPage(h);
    await waitFor(() => expect(screen.getByTestId('aud01-forbidden')).toBeInTheDocument());
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByTestId('aud01-forbidden').textContent).toContain('HTTP 403');
  });
});