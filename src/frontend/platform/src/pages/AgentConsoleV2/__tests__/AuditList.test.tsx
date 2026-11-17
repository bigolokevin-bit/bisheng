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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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

  it('S3: the task jump is a real link to TSK-02 and copy stays independent', async () => {
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
    expect(jump.tagName).toBe('A');
    expect(jump.getAttribute('href')).toBe('/agent/tasks/tk_01M7DEY7QK3T8V2W4X6Y8A0BCE');
    expect(jump.getAttribute('aria-disabled')).toBeNull();
    // the copy control is independent of the link
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
    expect(exp.textContent).toContain('变更（修改前 → 修改后）');
    expect(exp.textContent).toContain('scopeType');
    expect(exp.textContent).toContain('+');
    expect(exp.textContent).toContain('契约版本');
    expect(exp.textContent).not.toContain('schemaVersion');
    expect(exp.textContent).toContain('没有「验证此条」入口');
    expect(exp.textContent).toContain('idem_g…8_01');
    expect(exp.textContent).not.toContain('idem_gr_3…');
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
    expect(next.getAttribute('title')).toContain('最后一页');
    expect(next.getAttribute('title')).not.toContain('nextCursor');
    expect(screen.getByTestId('lk-lastpage-note').textContent).toContain('后面没有了');
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
// ---------------------------------------------------------------- S2 identity

describe('AUD-01 S2 — readable identities in list rows', () => {
  it('system actor reads 「系统」 with the worker id in title; an unlisted employee resource reads 「员工 · 短码」, no bare emp_ id', async () => {
    const h = harness({ pages: [okList([FAILED_EVENT])] });
    const { container } = renderPage(h, '?action=employee.version.create');
    await waitFor(() => expect(screen.getByTestId('aud01-row-ev_FAILED')).toBeInTheDocument());
    const row = screen.getByTestId('aud01-row-ev_FAILED');

    const who = row.querySelector('.who') as HTMLElement;
    // R1 (VG-B2): the screen says 「系统」; the worker id stays in title.
    expect(who.textContent).toBe('系统');
    expect(who.getAttribute('title')).toContain('employee-api');

    const resCell = row.querySelector('.rescell') as HTMLElement;
    expect(resCell.querySelector('.rt')?.textContent).toBe('员工');
    expect(resCell.textContent).toContain('员工 · D7E9');
    expect(resCell.textContent).not.toContain('emp_5B3C7A9D');
    // the full raw id stays where support needs it: title + copy
    expect(resCell.querySelector('.cp')?.getAttribute('title')).toBe(
      'emp_5B3C7A9D1E2F4068B5C3D7E9',
    );
    expect(container.textContent).not.toContain('EMPLOYEE');
  });

  it('a directory-listed employee prints its name; onBehalfOf prints 「用户 #…」 without the human: prefix', async () => {
    const named = event({
      eventId: 'ev_NAMED',
      actor: { type: 'employee', id: 'emp_86A81CE8FF6F42E187BCF2B540' },
      resource: { type: 'employee', id: 'emp_86A81CE8FF6F42E187BCF2B540' },
    });
    const h = harness({ pages: [okList([named, event()])] });
    renderPage(h);
    await waitFor(() => expect(screen.getByTestId('aud01-row-ev_NAMED')).toBeInTheDocument());

    const row = screen.getByTestId('aud01-row-ev_NAMED');
    // E11 names land asynchronously: wait for the upgrade, never assert the
    // pre-load snapshot.
    await waitFor(() =>
      expect((row.querySelector('.who') as HTMLElement).textContent).toContain('小鲤'),
    );
    expect((row.querySelector('.rescell') as HTMLElement).textContent).toContain('小鲤');

    const base = screen.getByTestId('aud01-row-ev_01M7DEY8ZQ4R7T2V8X0Y2A4B6C');
    const behalf = (base.querySelector('.behalf') as HTMLElement).textContent ?? '';
    expect(behalf).toContain('用户 #u_10001');
    expect(behalf).not.toContain('human:');
  });
});

// ------------------------------------------------ R1: type+short, plain chrome, live menu

describe('AUD-01 R1 — business ids, plain-language chrome, live row entry', () => {
  it('prints one mid-ellipsis short code for run / task / approval and keeps raw ids in title', async () => {
    const h = harness({ pages: [okList([event()])] });
    renderPage(h);
    await waitFor(() =>
      expect(screen.getByTestId('aud01-row-ev_01M7DEY8ZQ4R7T2V8X0Y2A4B6C')).toBeInTheDocument(),
    );
    const row = screen.getByTestId('aud01-row-ev_01M7DEY8ZQ4R7T2V8X0Y2A4B6C');
    const text = row.textContent ?? '';
    // Merged ground truth (main ea10dfa): the run cell prints the mid-ellipsis
    // short code alone — 「运行 ·」 prefix lives on the type-labelled cells via
    // typeShortLabel, and idDisplay is shortId-only in the merged sheet. Raw id
    // stays in title (next two assertions).
    expect(text).toContain('rn_01M7…GPWJ');
    expect(text).not.toContain('rn_01M7DEY8');
    expect(row.querySelector('[title="rn_01M7DEY86XMD8J2SJZES4TGPWJ"]')).not.toBeNull();
  });

  it('drops engineering chrome from the head and footer (no endpoints, no A3/A7)', async () => {
    const h = harness({ pages: [okList([event()])] });
    renderPage(h);
    await waitFor(() => expect(screen.getByTestId('agent-v2-page-audit')).toBeInTheDocument());
    const page = screen.getByTestId('agent-v2-page-audit').textContent ?? '';
    expect(page).not.toContain('GET /api');
    expect(page).not.toContain('A3');
    expect(page).not.toContain('A7');
    // the read-only promise itself stays
    expect(page).toContain('只读');
    // no ISO/UTC `T…Z` stamp in copy (the sr-only range reads Beijing time)
    expect(page).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it('offers an always-visible row link into the detail page, next to the expansion', async () => {
    const h = harness({ pages: [okList([event()])] });
    renderPage(h);
    const row = await screen.findByTestId('aud01-row-ev_01M7DEY8ZQ4R7T2V8X0Y2A4B6C');
    const detail = screen.getByTestId('aud01-detail-ev_01M7DEY8ZQ4R7T2V8X0Y2A4B6C');
    expect(detail.tagName).toBe('A');
    expect(detail.getAttribute('href')).toBe(
      '/agent/audit/ev_01M7DEY8ZQ4R7T2V8X0Y2A4B6C',
    );
    expect(detail.textContent).toBe('详情');
    // the inline expansion stays independent and still works
    expect(within(row).getByTestId('aud01-expand-ev_01M7DEY8ZQ4R7T2V8X0Y2A4B6C')).toBeTruthy();
  });

  it('opens a real menu (copy + detail) and closes on Escape', async () => {
    const h = harness({ pages: [okList([event()])] });
    renderPage(h);
    const more = await screen.findByTestId('aud01-more-ev_01M7DEY8ZQ4R7T2V8X0Y2A4B6C');
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    await waitFor(() => expect(more.getAttribute('aria-expanded')).toBe('true'));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByTestId('aud01-copy-event-ev_01M7DEY8ZQ4R7T2V8X0Y2A4B6C')).toBeTruthy();
    expect(
      within(menu).getByTestId('aud01-open-detail-ev_01M7DEY8ZQ4R7T2V8X0Y2A4B6C').getAttribute('href'),
    ).toBe('/agent/audit/ev_01M7DEY8ZQ4R7T2V8X0Y2A4B6C');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});

// ---------------------------------------------------------------- S1 language

describe('AUD-01 S1 — engineering language stays off screen', () => {
  it('the verify panel never prints ok/complete/scanned field names', async () => {
    const h = harness({
      pages: [okList([event()])],
      verify: [
        {
          ok: true,
          status: 200,
          data: {
            ok: true,
            complete: true,
            scanned: 42,
            anchorCheckpointId: 'ck_01M7',
          },
        },
      ],
    });
    renderPage(h);
    await waitFor(() => expect(screen.getByTestId('aud01-verify-s1')).toBeInTheDocument());
    const panel = screen.getByTestId('aud01-verify').textContent ?? '';
    expect(panel).not.toContain('ok=true');
    expect(panel).not.toContain('complete');
    expect(panel).not.toContain('scanned');
    expect(screen.getByTestId('aud01-verify-s1').textContent).toContain('链完整');
  });

  it('the verify window reads in Beijing time, the raw UTC bounds live in title', async () => {
    const h = harness({ pages: [okList([event()])] });
    renderPage(h);
    await waitFor(() => expect(screen.getByTestId('aud01-verify-range')).toBeInTheDocument());
    const range = screen.getByTestId('aud01-verify-range');
    expect(range.textContent).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} → \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(range.getAttribute('title')).toMatch(/UTC$/);
  });
});

// ---------------------------------------------------------------- S4 states

describe('AUD-01 S4 — state honesty', () => {
  it('a first page still pending after 10s flips the skeleton to the honest error screen', () => {
    vi.useFakeTimers();
    try {
      const hang: AuditApi = {
        listAudit: () => new Promise(() => undefined),
        verifyAudit: () => new Promise(() => undefined),
      };
      render(<AuditListPage api={hang} initialSearch="?action=message.send" />);
      expect(screen.queryByTestId('aud01-error')).toBeNull();
      act(() => {
        vi.advanceTimersByTime(10_001);
      });
      expect(screen.getByTestId('aud01-error')).toBeInTheDocument();
      // no gateway id on a timed-out request — the line says 「未提供」
      expect(screen.getByTestId('aud01-error-reqid').textContent).toContain('未提供');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ------------------------------------------- L4p4 identity + type closeout

describe('AUD-01 identity closeout — upstream casing never leaks raw machine words', () => {
  it('renders uppercase enums as Chinese and keeps the employee honourific', async () => {
    const h = harness({
      pages: [
        okList([
          event({
            eventId: 'ev_UPPER',
            sourceSystem: 'CHANNEL',
            decision: 'APPROVED',
            outcome: 'SUCCESS',
            actor: { type: 'SYSTEM', id: 'employee-api' },
            resource: { type: 'EMPLOYEE', id: 'emp_5B3C7A9D1E2F4068B5C3D7E9' },
          }),
        ]),
      ],
    });
    renderPage(h);
    const row = await screen.findByTestId('aud01-row-ev_UPPER');
    const text = row.textContent ?? '';
    expect(text).toContain('渠道');
    expect(text).toContain('已批准');
    expect(text).toContain('成功');
    expect(text).toContain('员工');
    expect(text).toContain('系统');
    expect(text).not.toContain('employee-api');
    expect(row.querySelector('.who')?.getAttribute('title')).toContain('employee-api');
    // machine words and the raw employee id stay off the visible line
    expect(text).not.toContain('EMPLOYEE');
    expect(text).not.toContain('SUCCESS');
    expect(text).not.toContain('APPROVED');
    expect(text).not.toContain('emp_5B3C7A9D1E2F4068B5C3D7E9');
    // the copy button still carries the exact value for anyone who needs it
    expect(row.querySelector('[title="emp_5B3C7A9D1E2F4068B5C3D7E9"]')).not.toBeNull();
  });

  it('logs no console error for known or unlisted enum values', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const h = harness({
        pages: [
          okList([
            event({
              eventId: 'ev_UNLISTED',
              sourceSystem: 'mystery',
              decision: 'odd_state',
              outcome: 'half_done',
            }),
          ]),
        ],
      });
      renderPage(h);
      const row = await screen.findByTestId('aud01-row-ev_UNLISTED');
      expect(row.textContent).toContain('mystery');
      expect(row.textContent).toContain('odd_state');
      expect(row.textContent).toContain('half_done');
      const noise = spy.mock.calls.filter((args) => String(args[0]).includes('[AUD-01]'));
      expect(noise).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('shows schemaVersion 0 as 0 in the expansion, not as a dash', async () => {
    const h = harness({
      pages: [okList([event({ eventId: 'ev_V0', schemaVersion: 0 })])],
    });
    renderPage(h);
    fireEvent.click(await screen.findByTestId('aud01-expand-ev_V0'));
    const box = await screen.findByTestId('aud01-exp-ev_V0');
    const rows = Array.from(box.querySelectorAll('.integ .kv'));
    const schemaRow = rows.find((node) => node.querySelector('.k')?.textContent === '契约版本');
    expect(schemaRow).toBeTruthy();
    expect(schemaRow?.querySelector('.mono')?.textContent).toBe('0');
  });

  it('treats the custom window as Beijing wall clock on the way out', async () => {
    const h = harness({});
    renderPage(h, '?window=custom');
    fireEvent.change(await screen.findByTestId('aud01-custom-from'), {
      target: { value: '2026-11-17T09:00' },
    });
    fireEvent.change(screen.getByTestId('aud01-custom-to'), {
      target: { value: '2026-11-17T10:30' },
    });
    fireEvent.click(screen.getByTestId('aud01-custom-apply'));
    await waitFor(() => expect(h.listCalls.length).toBe(1));
    expect(h.listCalls[0].from).toBe('2026-11-17T01:00:00.000Z');
    expect(h.listCalls[0].to).toBe('2026-11-17T02:30:00.000Z');
  });

  it('reads a Beijing custom window back into the inputs', async () => {
    const h = harness({});
    renderPage(
      h,
      '?window=custom&from=2026-11-17T01:00:00.000Z&to=2026-11-17T02:30:00.000Z',
    );
    const from = (await screen.findByTestId('aud01-custom-from')) as HTMLInputElement;
    const to = screen.getByTestId('aud01-custom-to') as HTMLInputElement;
    expect(from.value).toBe('2026-11-17T09:00');
    expect(to.value).toBe('2026-11-17T10:30');
  });
});

// ---------------------------- 1280 band: scroll the wrapper, never squeeze glyphs

describe('AUD-01 width contract — 1280 scrolls instead of clipping characters', () => {
  const css = readFileSync(resolve(__dirname, '../aud01.css'), 'utf8');
  const between = (from: string, to: string) => {
    const start = css.indexOf(from);
    const end = css.indexOf(to, start + from.length);
    return start < 0 ? '' : css.slice(start, end < 0 ? undefined : end);
  };

  it('keeps the 12-column table at its 1282px floor', () => {
    expect(css).toMatch(/table\.tbl\s*\{[^}]*min-width:\s*1282px/);
  });

  it('gives the wrapper scroll and keeps the header sticky in the 1280–1399 band', () => {
    const band = between(
      '@media (min-width: 1280px) and (max-width: 1399px)',
      '@media (min-width: 1400px)',
    );
    // `overflow: auto` scrolls both axes; the header must stay inside the visible area.
    expect(band).toMatch(/overflow(-x)?:\s*auto/);
    expect(band).toContain('position: sticky');
    expect(band).toContain('top: 0');
    expect(band).toMatch(/max-height:\s*calc\(/);
    expect(band).toContain('.tblhint');
    // R2-④: header must ride inside the fold, and the paging contradiction
    // (note 「后面没有了」 + clickable 下一页) is closed in the same band.
    expect(band).toContain('position: sticky');
    // R2-② is pinned against the whole sheet, not the band: the note-vs-button
    // contradiction is not width-specific, so its rule lives outside every
    // breakpoint block (see aud01.css, above the 断点 section).
    expect(css).toContain(".rfoot:has([data-testid='lk-lastpage-note'])");
    expect(band).toContain('mask-image');
  });

  it('drops the wrapper scroll only at 1400+ where the columns fit', () => {
    const wide = between('@media (min-width: 1400px)', '@media (min-width: 1024px)');
    expect(wide).toContain('overflow-x: visible');
  });

  it('never lets a cell break mid-token (ellipsis, no word splitting)', () => {
    expect(css).not.toMatch(/word-break:\s*break-all/);
    expect(css.match(/text-overflow:\s*ellipsis/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(css.match(/white-space:\s*nowrap/g)?.length ?? 0).toBeGreaterThanOrEqual(8);
  });
});

// ---------------------------- VG four items (2026-11-17 closeout)

describe('AUD-01 VG closeout — human words, honest paging, mid-ellipsis codes', () => {
  const TK = 'tk_01M7DF8J5H7K9M1N3P5R7T9V1XZ';
  const EV = 'ev_01M7DEY8ZQ4R7T2V8X0Y2A4B6C';

  it('keeps engineering words off the screen (title only)', async () => {
    const h = harness({
      pages: [okList([event({ eventId: EV, action: 'employee.update', taskId: TK })])],
    });
    renderPage(h);
    const row = await screen.findByTestId(`aud01-row-${EV}`);
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('critical');
    expect(text).not.toContain('（GET）');
    expect(text).not.toContain('(GET)');
    expect(text).not.toContain('employee.update');
    expect(row).toBeTruthy();
  });

  it('names employee.update in Chinese and leaves the raw value in the title', async () => {
    const h = harness({
      pages: [okList([event({ eventId: EV, action: 'employee.update' })])],
    });
    renderPage(h);
    const row = await screen.findByTestId(`aud01-row-${EV}`);
    const label = row.querySelector('[title="employee.update"]');
    expect(label?.textContent).toBe('员工信息更新');
  });

  it('truncates a long id in the middle and keeps the full value in the title', async () => {
    const h = harness({ pages: [okList([event({ eventId: EV, taskId: TK })])] });
    renderPage(h);
    const row = await screen.findByTestId(`aud01-row-${EV}`);
    expect(row.textContent).toContain('tk_01M7…V1XZ');
    expect(row.querySelector(`[title="${TK}"]`)).not.toBeNull();
  });

  it('states the page size without machine words and never contradicts the button', async () => {
    const h = harness({ pages: [okList([event({ eventId: EV })])] });
    renderPage(h);
    await screen.findByTestId(`aud01-row-${EV}`);
    const text = document.body.textContent ?? '';
    expect(text).toContain('不显示总数');
    expect(text).not.toContain('游标分页');
    // a full last page must not claim it was short
    expect(text).not.toContain('不足一整页');
    expect(text).toContain('后面没有了');
  });
});
