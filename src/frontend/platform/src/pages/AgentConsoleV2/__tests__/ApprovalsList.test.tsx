/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * APR-01 approvals pending list tests.
 *
 * Strategy: stub the global fetch that makeFetcher() uses, routed by URL,
 * returning the live-verified AP4/AP8 shapes (l4wae-probe 2026-11-16:
 * AP4 REQUIRES assignee and rejects status=history; AP8 returns
 * {pending,dueSoon}). react-i18next is mocked against the REAL zh-Hans
 * resources (OverviewErrors pattern) so the G15 guard below is meaningful:
 * machine codes must never appear in visible error copy, only the HTTP
 * status as interpolation param.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
        dict,
      );
    if (typeof defOrOpts === 'string') {
      return typeof value === 'string' ? value : defOrOpts;
    }
    if (typeof value !== 'string') return String(key);
    const options = (defOrOpts ?? {}) as Record<string, unknown>;
    // mirror i18next: {{var}} interpolation only
    return value.replace(/\{\{(\w+)\}\}/g, (m, name: string) =>
      name in options ? String(options[name]) : m
    );
  };
  return { useTranslation: () => ({ t }) };
});

import { ApprovalsListPage } from '../ApprovalsListPage';
import { userContext } from '@/contexts/userContext';

const A1 = 'appr_1111222233334444AAAABBBBCCCC0001';
const A2 = 'appr_1111222233334444AAAABBBBCCCC0002';
const AC = 'appr_CONFIRM000000000000000000000003';

function futureIso(seconds = 3600): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function approval(id: string, type = 'business_action', extra: Record<string, unknown> = {}) {
  return {
    approvalId: id,
    tenantId: 't1',
    type,
    status: 'pending',
    requestedBy: { type: 'human', id: 'human:9' },
    onBehalfOf: { type: 'human', id: 'human:7' },
    action: 'grant_escalation',
    resource: { kind: 'grant' },
    argsDigest: 'sha256:abc',
    binding: { subjectType: 'employee', subjectId: 'emp_1', changeKind: 'permission', targetHash: 'h' },
    riskLevel: 'high',
    reasonText: '',
    approvers: [{ userId: 'human:1' }],
    requiredApprovals: 1,
    decisions: [],
    ttlSeconds: 86400,
    expiresAt: futureIso(),
    remainingSeconds: 3600,
    createdAt: '2026-11-15T10:00:00Z',
    ...extra,
  };
}

// ----- switchable stub outcomes -----
let approvalsStatus = 200;
let approvalsBody: unknown = { items: [approval(A1), approval(A2), approval(AC, 'confirm')] };
let statsStatus = 200;
let statsBody: unknown = { pending: 3, dueSoon: 1 };
let urls: string[] = [];
let methods: string[] = [];
let bodies: Array<Record<string, unknown>> = [];
let writeStatus = 200;
let writeCode = 'console.forbidden';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'X-Console-Request-Id': 'req_apr01' }),
    json: async () => body,
  };
}

beforeEach(() => {
  urls = [];
  methods = [];
  bodies = [];
  writeStatus = 200;
  writeCode = 'console.forbidden';
  approvalsStatus = 200;
  approvalsBody = { items: [approval(A1), approval(A2), approval(AC, 'confirm')] };
  statsStatus = 200;
  statsBody = { pending: 3, dueSoon: 1 };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      methods.push(init?.method ?? 'GET');
      if (url.includes('/api/approval/decision')) {
        bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        if (writeStatus === 200) return jsonResponse(200, { approvalId: 'x', status: 'approved' });
        return jsonResponse(writeStatus, { code: writeCode, message: 'stub' });
      }
      if (url.includes('/api/approval-stats')) {
        return jsonResponse(statsStatus, statsStatus === 200 ? statsBody : { code: 'upstream.blip' });
      }
      if (url.includes('/api/approvals')) {
        if (approvalsStatus === 500) {
          // injected machine code must NEVER reach the screen (G15)
          return jsonResponse(500, { code: 'request.missing_filter', message: 'stub' });
        }
        if (approvalsStatus === 403) {
          return jsonResponse(403, { code: 'console.forbidden', message: 'stub' });
        }
        return jsonResponse(200, approvalsBody);
      }
      return jsonResponse(200, {});
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function renderPage(entry = '/agent/approvals') {
  return render(
    <userContext.Provider value={{ user: { user_id: 1 } } as never}>
      <MemoryRouter initialEntries={[entry]}>
        <ApprovalsListPage />
      </MemoryRouter>
    </userContext.Provider>
  );
}

describe('APR-01 approvals pending list', () => {
  it('queries AP4 with own canonical assignee and pending status', async () => {
    renderPage();
    await screen.findAllByTestId('agent-v2-approval-row');
    const ap4 = urls.find((u) => u.includes('/api/approvals'));
    expect(ap4).toContain('assignee=human%3A1');
    expect(ap4).toContain('status=pending');
    expect(ap4).toContain('limit=20');
    expect(urls.some((u) => u.includes('/api/approval-stats') && u.includes('assignee=human%3A1'))).toBe(true);
  });

  it('renders queue rows from the AP4 fixture and excludes confirm type', async () => {
    renderPage();
    await screen.findAllByTestId('agent-v2-approval-row');
    const rows = screen.getAllByTestId('agent-v2-approval-row');
    expect(rows).toHaveLength(2);
    expect(document.querySelector(`[data-approval-id="${AC}"]`)).toBeNull();
    // truncated identifiable id + title carries the full id
    expect(screen.getByTitle(A1).textContent).toContain('…');
    // action/changeKind, employee (onBehalfOf preferred), localized risk and status
    expect(rows[0].textContent).toContain('grant_escalation');
    expect(rows[0].textContent).toContain('human:7');
    expect(rows[0].textContent).toContain('高风险');
    expect(rows[0].textContent).toContain('待处理');
    // P1-4: countdown reads as a duration (hh:mm:ss), not a raw second count
    expect(rows[0].textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(rows[0].textContent).not.toMatch(/剩余 \d+ 秒/);
  });

  it('shows the AP8 badge on the pending tab', async () => {
    renderPage();
    const badge = await screen.findByTestId('agent-v2-approvals-count');
    expect(badge.textContent).toBe('3');
    expect(screen.getByTestId('agent-v2-approvals-due-soon').textContent).toContain('1');
  });

  it('countdown follows contract remainingSeconds when it disagrees with expiresAt (L6 F-1)', async () => {
    approvalsBody = {
      items: [
        approval(A1, 'business_action', {
          expiresAt: futureIso(7200),
          remainingSeconds: 60,
        }),
      ],
    };
    renderPage();
    const row = await screen.findByTestId('agent-v2-approval-row');
    const cd = row.querySelector('[data-testid="agent-v2-approval-countdown"]');
    // 60s → hh:mm:ss; the raw second count is the title, never the label
    expect(cd?.textContent).toBe('00:01:00');
    expect(cd?.textContent).not.toContain('7200');
    expect(cd?.getAttribute('title')).toContain('remainingSeconds=60');
  });

  it('P1-4: countdown title keeps the raw seconds next to the absolute expiry, hh:mm:ss never folds hours into days', async () => {
    approvalsBody = {
      items: [approval(A1, 'business_action', { expiresAt: futureIso(90000), remainingSeconds: 90061 })],
    };
    renderPage();
    const row = await screen.findByTestId('agent-v2-approval-row');
    const cd = row.querySelector('[data-testid="agent-v2-approval-countdown"]');
    // 25h1m1s stays 25:01:01 — no 1d, no rounding
    expect(cd?.textContent).toBe('25:01:01');
    expect(cd?.getAttribute('title')).toContain('remainingSeconds=90061');
  });

  it('requests AP8 with dueWithinSeconds=86400 (L6 F-2)', async () => {
    renderPage();
    await screen.findAllByTestId('agent-v2-approval-row');
    expect(
      urls.some(
        (u) => u.includes('/api/approval-stats') && u.includes('dueWithinSeconds=86400')
      )
    ).toBe(true);
  });

  it('renders risk as a dot+text pill (L6 F-3)', async () => {
    renderPage();
    await screen.findAllByTestId('agent-v2-approval-row');
    const pill = document.querySelector(
      '[data-testid="agent-v2-approval-risk"] .a2-pill'
    );
    expect(pill).not.toBeNull();
    expect(pill?.querySelector('.a2-pill-dot')).not.toBeNull();
    expect(pill?.className).toContain('is-danger');
  });

  it('hides the badge when AP8 fails — never a fake zero', async () => {
    statsStatus = 500;
    renderPage();
    await screen.findAllByTestId('agent-v2-approval-row');
    expect(screen.queryByTestId('agent-v2-approvals-count')).toBeNull();
    // the pending tab carries no count text at all when AP8 is down
    expect(screen.getByTestId('agent-v2-approvals-tab-pending').textContent).toBe('待办');
  });

  it('renders a localized block-level error with retry and no machine code (G15)', async () => {
    approvalsStatus = 500;
    renderPage();
    const err = await screen.findByTestId('agent-v2-approvals-queue-error');
    expect(err.textContent).toContain('审批队列');
    expect(err.textContent).toContain('HTTP 500');
    const codeish = /[a-z]+\.[a-z_]+/;
    expect(err.textContent ?? '').not.toMatch(codeish);
    document
      .querySelectorAll('[data-testid$="-error"]')
      .forEach((el) => expect(el.textContent ?? '').not.toMatch(codeish));
    expect(document.body.textContent).not.toContain('request.missing_filter');

    // retry recovers real rows once the endpoint is healthy
    approvalsStatus = 200;
    fireEvent.click(screen.getByTestId('agent-v2-approvals-retry-queue'));
    await waitFor(() => expect(screen.getAllByTestId('agent-v2-approval-row')).toHaveLength(2));
    expect(screen.queryByTestId('agent-v2-approvals-error')).toBeNull();
  });

  it('shows an explicit 403 state for non-admin deep links', async () => {
    approvalsStatus = 403;
    renderPage('/agent/approvals?focus=whatever');
    const card = await screen.findByTestId('agent-v2-approvals-403');
    expect(card.textContent).toContain('无权查看审批队列');
  });

  it('shows the empty state when the queue has no rows', async () => {
    approvalsBody = { items: [] };
    renderPage();
    const empty = await screen.findByTestId('agent-v2-approvals-empty');
    expect(empty.textContent).toContain('暂无待办审批');
  });

  it('batch checkboxes and select-current-page drive the selected count; decide buttons stay disabled when the build switch is off', async () => {
    renderPage();
    await screen.findAllByTestId('agent-v2-approval-row');
    const decide = screen.getByTestId('agent-v2-approvals-decide-approve');
    expect((decide as HTMLButtonElement).disabled).toBe(true);
    const reject = screen.getByTestId('agent-v2-approvals-decide-reject');
    expect((reject as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('agent-v2-approvals-batch-note').textContent).toContain(
      '批量决策未启用'
    );
    expect(screen.getByTestId('agent-v2-approvals-selected-count').textContent).toContain('已选 0 项');
    fireEvent.click(screen.getByTestId('agent-v2-approvals-select-all'));
    expect(screen.getByTestId('agent-v2-approvals-selected-count').textContent).toContain('已选 2 项');
    // even with a valid selection the server-side-unbacked build cannot write
    expect(screen.getByTestId('agent-v2-approvals-batch-note').textContent).toContain(
      '本环境未开放在线决策'
    );
    fireEvent.click(screen.getAllByTestId('agent-v2-approval-check')[0]);
    expect(screen.getByTestId('agent-v2-approvals-selected-count').textContent).toContain('已选 1 项');
  });

  it('P0-3: checkboxes are token-drawn controls — unchecked ≠ solid block, checked state carried by :checked', async () => {
    renderPage();
    await screen.findAllByTestId('agent-v2-approval-row');
    const all = screen.getByTestId('agent-v2-approvals-select-all') as HTMLInputElement;
    const row = screen.getAllByTestId('agent-v2-approval-check')[0] as HTMLInputElement;
    // same themed class in both states: dark/light differ only by tokens
    expect(all.className).toContain('a2-check');
    expect(row.className).toContain('a2-check');
    // untouched queue = hollow outline, matching 「已选 0 项」
    expect(all.checked).toBe(false);
    expect(row.checked).toBe(false);
    fireEvent.click(row);
    expect((screen.getAllByTestId('agent-v2-approval-check')[0] as HTMLInputElement).checked).toBe(true);
    expect((screen.getAllByTestId('agent-v2-approval-check')[0] as HTMLInputElement).className).toContain('a2-check');
    expect(screen.getByTestId('agent-v2-approvals-selected-count').textContent).toContain('已选 1 项');
  });

  it('highlights the ?focus row and syncs back/refresh through the URL', async () => {
    renderPage(`/agent/approvals?focus=${A2}`);
    await screen.findAllByTestId('agent-v2-approval-row');
    const row = document.querySelector(`[data-approval-id="${A2}"]`);
    expect(row?.getAttribute('data-focus')).toBe('true');
    expect(document.querySelector(`[data-approval-id="${A1}"]`)?.getAttribute('data-focus')).toBeNull();
  });

  it('history tab is disabled with an honest reason and never fetches status=history', async () => {
    renderPage('/agent/approvals?status=history');
    const panel = await screen.findByTestId('agent-v2-approvals-history');
    expect(panel.textContent).toContain('已决列表本波未提供');
    const tabs = screen.getByTestId('agent-v2-approvals-tab-history');
    expect((tabs as HTMLButtonElement).disabled).toBe(true);
    expect(tabs.getAttribute('title')).toContain('已决列表本波未提供');
    expect(urls.some((u) => u.includes('status=history'))).toBe(false);
    // back to 待办 restores the live queue
    fireEvent.click(screen.getByTestId('agent-v2-approvals-back-pending'));
    await waitFor(() => expect(screen.getAllByTestId('agent-v2-approval-row')).toHaveLength(2));
  });

  it('renders the no-identity state instead of an unfiltered query', async () => {
    cleanup();
    render(
      <userContext.Provider value={{ user: undefined } as never}>
        <MemoryRouter initialEntries={['/agent/approvals']}>
          <ApprovalsListPage />
        </MemoryRouter>
      </userContext.Provider>
    );
    const card = await screen.findByTestId('agent-v2-approvals-no-identity');
    expect(card.textContent).toContain('无法获取当前用户身份');
    expect(urls.some((u) => u.includes('/api/approvals'))).toBe(false);
  });
});

/* ------------------------------------------------------------------------- */
/* APR-03: batch decision write. The gate reads only fields the payload       */
/* carries; a missing changeKind or an outbound row disables the batch rather */
/* than guessing. Writes are sequential and stop at the first failure.        */
/* ------------------------------------------------------------------------- */

const AM = 'appr_MESSAGESEND000000000000000004';

function messageSendApproval(id: string) {
  return approval(id, 'business_action', {
    action: 'message.send',
    binding: {
      subjectType: 'employee',
      subjectId: 'emp_1',
      changeKind: 'message_send',
      targetHash: 'th_msg',
    },
  });
}

function decisionCalls(): string[] {
  return urls.filter((u) => u.includes('/api/approval/decision'));
}

describe('APR-03 — batch decision write (build switch on)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_AGENT_APPROVAL_WRITE', '1');
  });

  it('enables both buttons for a fully decidable selection and asks for a second confirm', async () => {
    renderPage();
    await screen.findAllByTestId('agent-v2-approval-row');
    const approve = screen.getByTestId('agent-v2-approvals-decide-approve') as HTMLButtonElement;
    expect(approve.disabled).toBe(true); // nothing selected yet

    fireEvent.click(screen.getByTestId('agent-v2-approvals-select-all'));
    await waitFor(() => expect(approve.disabled).toBe(false));
    expect((screen.getByTestId('agent-v2-approvals-decide-reject') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId('agent-v2-approvals-batch-note').textContent).toContain('逐单提交');

    fireEvent.click(approve);
    const dialog = await screen.findByTestId('agent-v2-decision-dialog');
    expect(dialog.textContent).toContain('2');
    expect(screen.getByTestId('agent-v2-decision-target').textContent).toContain('…');
    // no comment field in batch mode
    expect(screen.getByTestId('agent-v2-decision-dialog').querySelector('textarea')).toBeNull();
    expect(decisionCalls()).toHaveLength(0);
  });

  it('cancelling the batch dialog posts nothing', async () => {
    renderPage();
    await screen.findAllByTestId('agent-v2-approval-row');
    fireEvent.click(screen.getByTestId('agent-v2-approvals-select-all'));
    fireEvent.click(await screen.findByTestId('agent-v2-approvals-decide-approve'));
    await screen.findByTestId('agent-v2-decision-dialog');
    fireEvent.click(screen.getByTestId('agent-v2-decision-cancel'));
    await waitFor(() => expect(screen.queryByTestId('agent-v2-decision-dialog')).toBeNull());
    expect(decisionCalls()).toHaveLength(0);
    expect(screen.getByTestId('agent-v2-approvals-selected-count').textContent).toContain('已选 2 项');
  });

  it('confirms sequentially, clears the selection and refreshes the queue', async () => {
    renderPage();
    await screen.findAllByTestId('agent-v2-approval-row');
    const listGets = () => urls.filter((u) => u.includes('/api/approvals?')).length;
    const before = listGets();
    fireEvent.click(screen.getByTestId('agent-v2-approvals-select-all'));
    fireEvent.click(await screen.findByTestId('agent-v2-approvals-decide-approve'));
    fireEvent.click(await screen.findByTestId('agent-v2-decision-confirm'));

    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[0]).toEqual({ verdict: 'approve' });
    expect(bodies[1]).toEqual({ verdict: 'approve' });
    expect(decisionCalls()[0]).toContain(`id=${A1}`);
    expect(decisionCalls()[1]).toContain(`id=${A2}`);

    await screen.findByTestId('agent-v2-approvals-batch-ok');
    expect(screen.getByTestId('agent-v2-approvals-batch-ok').textContent).toContain('2');
    expect(screen.getByTestId('agent-v2-approvals-selected-count').textContent).toContain('已选 0 项');
    expect(screen.queryByTestId('agent-v2-decision-dialog')).toBeNull();
    await waitFor(() => expect(listGets()).toBeGreaterThan(before));
  });

  it('reject submits the reject verdict for every selected row', async () => {
    renderPage();
    await screen.findAllByTestId('agent-v2-approval-row');
    fireEvent.click(screen.getByTestId('agent-v2-approvals-select-all'));
    fireEvent.click(await screen.findByTestId('agent-v2-approvals-decide-reject'));
    fireEvent.click(await screen.findByTestId('agent-v2-decision-confirm'));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies.every((b) => b.verdict === 'reject')).toBe(true);
  });

  it('a mixed selection containing message_send keeps the batch disabled with the honest reason', async () => {
    approvalsBody = { items: [approval(A1), messageSendApproval(AM)] };
    renderPage();
    await screen.findAllByTestId('agent-v2-approval-row');
    fireEvent.click(screen.getByTestId('agent-v2-approvals-select-all'));
    const approve = screen.getByTestId('agent-v2-approvals-decide-approve') as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(approve.title).toContain('外发类审批');
    expect(screen.getByTestId('agent-v2-approvals-batch-note').textContent).toContain(
      '所选包含外发类审批'
    );
    expect(decisionCalls()).toHaveLength(0);
  });

  it('a row without changeKind keeps the batch disabled — no invented kind', async () => {
    approvalsBody = {
      items: [
        approval(A1),
        approval(A2, 'business_action', {
          binding: { subjectType: 'employee', subjectId: 'emp_1', targetHash: 'h' },
        }),
      ],
    };
    renderPage();
    await screen.findAllByTestId('agent-v2-approval-row');
    fireEvent.click(screen.getByTestId('agent-v2-approvals-select-all'));
    expect((screen.getByTestId('agent-v2-approvals-decide-approve') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('agent-v2-approvals-batch-note').textContent).toContain('缺少变更类型字段');
  });

  it('a row the user does not approve keeps the batch disabled', async () => {
    approvalsBody = {
      items: [approval(A1), approval(A2, 'business_action', { approvers: [{ userId: 'human:42' }] })],
    };
    renderPage();
    await screen.findAllByTestId('agent-v2-approval-row');
    fireEvent.click(screen.getByTestId('agent-v2-approvals-select-all'));
    expect((screen.getByTestId('agent-v2-approvals-decide-approve') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('agent-v2-approvals-batch-note').textContent).toContain('不是审批人');
  });

  it('stops at the first failure and reports the success count plus the cause', async () => {
    writeStatus = 403;
    writeCode = 'console.forbidden';
    renderPage();
    await screen.findAllByTestId('agent-v2-approval-row');
    fireEvent.click(screen.getByTestId('agent-v2-approvals-select-all'));
    fireEvent.click(await screen.findByTestId('agent-v2-approvals-decide-approve'));
    fireEvent.click(await screen.findByTestId('agent-v2-decision-confirm'));

    const result = await screen.findByTestId('agent-v2-approvals-batch-result');
    expect(bodies).toHaveLength(1); // stopped after the first failure
    expect(result.textContent).toContain('已成功 0 单');
    expect(result.textContent).toContain('服务端拒绝了本次决策');
    expect(result.textContent).toContain('HTTP 403');
    expect(result.textContent).not.toContain('console.forbidden');
    expect(screen.queryByTestId('agent-v2-decision-dialog')).toBeNull();
    // the un-submitted rows stay selected for a retry
    expect(screen.getByTestId('agent-v2-approvals-selected-count').textContent).toContain('已选 2 项');
  });
});

describe('APR-01 P1 round: disabled visuals, concrete disable reason, hh:mm:ss, scroll hint', () => {
  it('P1-2: batch approve/reject stay DISABLED and name the real gate (write path now wired)', async () => {
    renderPage();
    await screen.findAllByTestId('agent-v2-approval-row');
    for (const id of ['agent-v2-approvals-decide-approve', 'agent-v2-approvals-decide-reject']) {
      const btn = screen.getByTestId(id) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.getAttribute('disabled')).not.toBeNull();
      // Merged semantics: the title carries the gate that actually blocks the
      // write (here: nothing selected yet), and never the obsolete
      // "AP2 not wired / M1 read-only" copy.
      expect(btn.title).toContain('批量决策未启用');
      expect(btn.title).not.toContain('AP2');
      expect(btn.title).not.toContain('M1 只读');
    }
    // once a valid selection exists the reason becomes the environment switch
    fireEvent.click(screen.getByTestId('agent-v2-approvals-select-all'));
    for (const id of ['agent-v2-approvals-decide-approve', 'agent-v2-approvals-decide-reject']) {
      const btn = screen.getByTestId(id) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.title).toContain('本环境未开放在线决策');
    }
    // the visual contract lives in the shared CSS (appearance only)
    const css = readFileSync(resolve(process.cwd(), 'src/pages/AgentConsoleV2/agentConsoleV2.css'), 'utf8');
    expect(css).toMatch(/\.a2-btn\[disabled\][^{]*\{[^}]*opacity/);
    expect(css).toMatch(/\.a2-pill\[disabled\]/);
  });

  it('P1-3: 「表格可左右滑动」 only when the wrapper actually overflows', async () => {
    renderPage();
    await screen.findAllByTestId('agent-v2-approval-row');
    const wrap = screen.getByTestId('agent-v2-approvals-table-scroll');
    expect(screen.queryByTestId('agent-v2-approvals-scroll-hint')).toBeNull();
    Object.defineProperty(wrap, 'scrollWidth', { configurable: true, value: 880 });
    Object.defineProperty(wrap, 'clientWidth', { configurable: true, value: 343 });
    fireEvent(window, new Event('resize'));
    const hint = await screen.findByTestId('agent-v2-approvals-scroll-hint');
    expect(hint.textContent).toContain('表格可左右滑动');
    Object.defineProperty(wrap, 'scrollWidth', { configurable: true, value: 1270 });
    Object.defineProperty(wrap, 'clientWidth', { configurable: true, value: 1270 });
    fireEvent(window, new Event('resize'));
    await waitFor(() => expect(screen.queryByTestId('agent-v2-approvals-scroll-hint')).toBeNull());
  });
});
