/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * APR-02 approval detail coverage (page card §2/§3/§4):
 * changeKind branching for the change-detail block (including the honest
 * 不可得 when the CR-043 projection is absent), decision timeline + empty
 * state, all-disabled read-only actions with no AP2 request, the server's
 * remainingSeconds winning over expiresAt, the access states 401/403/404,
 * and the G15 rule that machine codes never reach the screen.
 * fetch is stubbed at the global level (makeFetcher uses window fetch).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/components/bs-ui/message', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('react-i18next', async () => {
  const mod = (await import('../../../../public/locales/zh-Hans/bs.json')) as {
    default: Record<string, unknown>;
  };
  const dict = mod.default;
  const lookup = (key: string): unknown =>
    key
      .split('.')
      .reduce<unknown>(
        (acc, part) =>
          acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
        dict,
      );
  // mirror i18next: {{var}} interpolation, string second arg = defaultValue
  const t = (key: unknown, opts?: unknown): string => {
    const value = lookup(String(key));
    if (typeof value !== 'string') return typeof opts === 'string' ? opts : String(key);
    const options = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>;
    return value.replace(/\{\{(\w+)\}\}/g, (m, name: string) =>
      name in options ? String(options[name]) : m,
    );
  };
  return { useTranslation: () => ({ t }) };
});

import { ApprovalDetailPage } from '../ApprovalDetailPage';
import { userContext } from '@/contexts/userContext';

const CODEISH = /[a-z]+\.[a-z_]+/;
const ISO = '2026-11-15T03:27:58.000Z';

// base row = the real AP3 key set seen live (probe l4wag-apr02c)
const base = (over: Record<string, unknown> = {}) => ({
  approvalId: 'ap_AEEC078E0C824E749513AFEC9A',
  tenantId: 'tnt_1',
  type: 'business_action',
  action: 'employee.version.create',
  status: 'consumed',
  riskLevel: 'high',
  binding: {
    subjectType: 'employee',
    subjectId: 'emp_86A81CE8FF6F42E187BCF2B540',
    changeKind: 'employee_version_create',
    targetHash: 'th_62872a9dadb0bfa4ab07c5f81abb0d81',
  },
  argsDigest: '22eadfcebfdaa88b5451bb8622503c876ddfd7418e692056baa29786bb9fb63f',
  requestedBy: { type: 'user', id: '1' },
  reasonText: 'P0-7 live E2E: mount approved temporary grants',
  approvers: [{ userId: 'human:1', role: 'owner' }],
  requiredApprovals: 1,
  decisions: [],
  policyDecisionId: 'pd_p07-v3-esc-20261115T032658Z',
  expiresAt: '2026-11-16T03:26:58.533Z',
  remainingSeconds: 0,
  ttlSeconds: 86400,
  createdAt: '2026-11-15T03:26:58.533Z',
  ...over,
});

// CR-043 projection: canonical six keys + versions (shape of
// services/domain/approval_detail.py build_detail)
const EVC_DETAIL = base({
  detail: {
    changeDetail: {
      employeeId: 'emp_86A81CE8FF6F42E187BCF2B540',
      fromVersionId: 'empv_BEB487D9B8DC46ECB1C1AD663B',
      toVersionNo: 3,
      addedGrants: [
        { id: 'gr_C5C617BFF9944EF0AE1269667E', scopeType: 'business_api', actions: ['execute'] },
        { id: 'gr_EF4FC2AB33A34EE48D6F0DEF41', scopeType: 'channel', actions: ['send'] },
      ],
      removedGrantIds: ['gr_OLD_1'],
      effectiveFrom: '2026-11-15T03:27:58.000Z',
      source: 'binding+versions',
    },
    versions: [
      { versionNo: 3, effectiveFrom: ISO, status: 'current', knowledgeCount: 2 },
      { versionNo: 2, effectiveFrom: '2026-11-14T11:30:47.000Z', status: 'superseded', knowledgeCount: 1 },
    ],
  },
});

const MSG_SEND = base({
  approvalId: 'ap_84BFBFF56BE3444BAB1D4A37D8',
  action: 'message.send',
  riskLevel: 'high',
  binding: {
    subjectType: 'employee',
    subjectId: 'emp_86A81CE8FF6F42E187BCF2B540',
    changeKind: 'message_send',
    targetHash: 'th_9c823cf493c6bf808a0dec2fce980e16',
    messageDigest: 'md_69f2459ca8c26ef830cf0a3c06e6c1b1',
  },
  decisions: [{ userId: 'human:1', verdict: 'approve', comment: 'P0-7 live E2E', decidedAt: ISO }],
  // the live consumed row also carries the terminal fields (probe leg C)
  verdict: 'approve',
  decidedAt: ISO,
  consumedAt: '2026-11-13T22:18:36.889Z',
});

const GRANT_ESC = base({
  approvalId: 'ap_7D484B3FFBE048ECB7B96F92C9',
  action: 'grant.escalation',
  riskLevel: 'medium',
  binding: {
    subjectType: 'employee',
    subjectId: 'emp_86A81CE8FF6F42E187BCF2B540',
    changeKind: 'grant_escalation',
    targetHash: 'th_7111bc64272abf73c0f0e27373c4f4e9',
  },
});

const TRANSFER = base({
  binding: {
    subjectType: 'employee',
    subjectId: 'emp_86A81CE8FF6F42E187BCF2B540',
    changeKind: 'employee_owner_transfer',
  },
});
const BOGUS = base({ binding: { changeKind: 'time_travel' } });
// live reality (probe l4wag-apr02c): employee_version_create WITHOUT detail
const EVC_NO_DETAIL = base();

const PENDING = base({
  status: 'pending',
  verdict: null,
  consumedAt: null,
  remainingSeconds: 3600,
  // deliberately inconsistent with remainingSeconds: the server countdown
  // wins, expiresAt may only appear as title text
  expiresAt: '2026-12-31T23:59:59.000Z',
  decisions: [],
});

type Mode =
  | 'evcDetail'
  | 'evcNoDetail'
  | 'messageSend'
  | 'grantEsc'
  | 'transfer'
  | 'bogus'
  | 'pending'
  | 'notFound'
  | 'unauthorized'
  | 'forbidden'
  | 'serverError'
  | 'emptyBody';

let mode: Mode = 'evcDetail';

function respondFor(url: string): { status: number; body: unknown } {
  if (!url.includes('/api/approval?')) return { status: 404, body: { code: 'agent.http.404' } };
  switch (mode) {
    case 'evcDetail':
      return { status: 200, body: EVC_DETAIL };
    case 'evcNoDetail':
      return { status: 200, body: EVC_NO_DETAIL };
    case 'messageSend':
      return { status: 200, body: MSG_SEND };
    case 'grantEsc':
      return { status: 200, body: GRANT_ESC };
    case 'transfer':
      return { status: 200, body: TRANSFER };
    case 'bogus':
      return { status: 200, body: BOGUS };
    case 'pending':
      return { status: 200, body: PENDING };
    case 'notFound':
      return { status: 404, body: { code: 'approval.not_found', message: 'approval not found' } };
    case 'unauthorized':
      return { status: 401, body: { code: 'console.unauthenticated', message: 'identity check failed' } };
    case 'forbidden':
      return { status: 403, body: { code: 'console.forbidden', message: 'not an approver' } };
    case 'emptyBody':
      return { status: 200, body: {} };
    default:
      return { status: 500, body: { code: 'approval.upstream_unavailable', message: 'domain 8101 down' } };
  }
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const { status, body } = respondFor(url);
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

function renderDetail(id = 'ap_AEEC078E0C824E749513AFEC9A') {
  return render(
    <userContext.Provider value={{ user: { user_id: 1 } } as never}>
      <MemoryRouter initialEntries={[`/agent/approvals/${id}`]}>
        <Routes>
          <Route path="/agent/approvals/:id" element={<ApprovalDetailPage />} />
        </Routes>
      </MemoryRouter>
    </userContext.Provider>,
  );
}

/** Every visible error slot must be localized copy, never an upstream code. */
function expectNoMachineCodesInErrors() {
  document
    .querySelectorAll('[data-testid$="-error"]')
    .forEach((el) => expect(el.textContent ?? '').not.toMatch(CODEISH));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('APR-02 change-detail branching (card §2)', () => {
  it('employee_version_create renders the changeDetail diff rows and versions', async () => {
    mode = 'evcDetail';
    stubFetch();
    renderDetail();

    await screen.findByTestId('agent-v2-aprd-change');
    // from→to is real projection data, not a client derivation
    const head = screen.getByTestId('agent-v2-aprd-diff-head');
    expect(head.textContent).toContain('empv_BEB487D9B8DC46ECB1C1AD663B');
    expect(head.textContent).toContain('3');

    expect(screen.getByTestId('agent-v2-aprd-diff-added').textContent).toContain(
      'gr_C5C617BFF9944EF0AE1269667E',
    );
    expect(screen.getByTestId('agent-v2-aprd-diff-removed').textContent).toContain('gr_OLD_1');
    expect(screen.getByTestId('agent-v2-aprd-diff-source').textContent).toContain('binding+versions');
    // every canonical key that arrived becomes exactly one labelled row
    expect(screen.getByTestId('agent-v2-aprd-diff-employee').textContent).toContain(
      'emp_86A81CE8FF6F42E187BCF2B540',
    );
    expect(screen.getByTestId('agent-v2-aprd-diff-to').textContent).toContain('3');

    const versions = screen.getByTestId('agent-v2-aprd-versions');
    expect(versions.querySelectorAll('[data-testid="agent-v2-aprd-version-row"]')).toHaveLength(2);
    expect(versions.textContent).toContain('当前');
    expect(versions.textContent).toContain('已取代');
  });

  it('employee_version_create without detail says 不可得 and invents nothing', async () => {
    mode = 'evcNoDetail';
    stubFetch();
    renderDetail();

    const note = await screen.findByTestId('agent-v2-aprd-change-unavailable');
    expect(note.textContent).toBe('不可得');
    // no fake diff rows, no fabricated zero version numbers
    expect(screen.queryByTestId('agent-v2-aprd-diff-head')).toBeNull();
    expect(screen.queryByTestId('agent-v2-aprd-versions')).toBeNull();
  });

  it('message_send says the digest-only copy', async () => {
    mode = 'messageSend';
    stubFetch();
    renderDetail('ap_84BFBFF56BE3444BAB1D4A37D8');

    const note = await screen.findByTestId('agent-v2-aprd-change-digest-only');
    expect(note.textContent).toBe('不可得（摘要审批）');
  });

  it('grant_escalation / employee_owner_transfer / unknown kinds say 契约未定义', async () => {
    for (const next of ['grantEsc', 'transfer', 'bogus'] as Mode[]) {
      mode = next;
      stubFetch();
      renderDetail();
      const note = await screen.findByTestId('agent-v2-aprd-change-contract');
      expect(note.textContent).toBe('契约未定义');
      cleanup();
      vi.unstubAllGlobals();
    }
  });
});

describe('APR-02 decisions, actions and countdown', () => {
  it('empty decisions render the honest empty state', async () => {
    mode = 'evcNoDetail';
    stubFetch();
    renderDetail();

    const emptyNote = await screen.findByTestId('agent-v2-aprd-decisions-empty');
    expect(emptyNote.textContent).toBe('暂无决策记录');
  });

  it('decision rows show verdict, decider and decidedAt', async () => {
    mode = 'messageSend';
    stubFetch();
    renderDetail('ap_84BFBFF56BE3444BAB1D4A37D8');

    await screen.findByTestId('agent-v2-aprd-decision-row');
    expect(screen.getByTestId('agent-v2-aprd-decision-verdict').textContent).toBe('批准');
    expect(screen.getByTestId('agent-v2-aprd-decisions').textContent).toContain('human:1');
    expect(screen.getByTestId('agent-v2-aprd-decision-comment').textContent).toContain('P0-7 live E2E');
    // terminal fields present-only: consumedAt comes from the approval row
    expect(screen.getByTestId('agent-v2-aprd-terminal-verdict')).toBeTruthy();
  });

  it('every decision button is disabled and no write request is ever sent', async () => {
    mode = 'pending';
    stubFetch();
    renderDetail();

    for (const verb of ['approve', 'reject', 'revise']) {
      const btn = await screen.findByTestId(`agent-v2-aprd-decide-${verb}`);
      expect(btn).toBeDisabled();
      expect(btn.getAttribute('title')).toBe('M1 只读，写路径归后续波');
    }
    expect(screen.getByTestId('agent-v2-aprd-actions-note').textContent).toBe('M1 只读，写路径归后续波');

    fireEvent.click(screen.getByTestId('agent-v2-aprd-decide-approve'));
    fireEvent.click(screen.getByTestId('agent-v2-aprd-decide-reject'));
    fireEvent.click(screen.getByTestId('agent-v2-aprd-decide-revise'));
    const calls = vi.mocked(fetch).mock.calls.map((c) => [String(c[0]), (c[1] as RequestInit)?.method ?? 'GET']);
    expect(calls.length).toBeGreaterThan(0);
    calls.forEach(([url, method]) => {
      expect(method).toBe('GET');
      expect(url).toContain('/api/approval?');
    });
  });

  it('shows the server remainingSeconds even when it disagrees with expiresAt', async () => {
    mode = 'pending';
    stubFetch();
    renderDetail();

    const cell = await screen.findByTestId('agent-v2-aprd-meta-remaining');
    expect(cell.textContent).toContain('剩余 3600 秒');
    /* expiresAt is title text only: its Asia/Shanghai rendering (a month of
     * slack) must never overwrite the server countdown on screen */
    expect(cell.getAttribute('title')).toBe('2027-01-01 07:59');
    expect(cell.textContent).not.toContain('2027');
  });
});

describe('APR-02 access states and error hygiene (G15)', () => {
  it('404 shows one localized copy for unknown and cross-tenant ids', async () => {
    mode = 'notFound';
    stubFetch();
    renderDetail('ap_00000000000000000000000000');

    const card = await screen.findByTestId('agent-v2-aprd-not-found');
    expect(card.textContent).toContain('未找到或无权查看');
    // the upstream machine code approval.not_found must not be on screen
    expect(card.textContent).not.toContain('approval.not_found');
    expectNoMachineCodesInErrors();
  });

  it('401 and 403 get their own localized copy', async () => {
    mode = 'unauthorized';
    stubFetch();
    renderDetail();
    expect((await screen.findByTestId('agent-v2-aprd-unauthorized')).textContent).toContain(
      '登录已失效',
    );
    cleanup();
    vi.unstubAllGlobals();

    mode = 'forbidden';
    stubFetch();
    renderDetail();
    expect((await screen.findByTestId('agent-v2-aprd-forbidden')).textContent).toContain(
      '无权查看该审批',
    );
    expectNoMachineCodesInErrors();
  });

  it('a 500 uses the blockUnavailable idiom with a working retry', async () => {
    mode = 'serverError';
    stubFetch();
    renderDetail();

    const err = await screen.findByTestId('agent-v2-aprd-detail-error');
    expect(err.textContent).toBe('审批详情暂时取不到（HTTP 500）');
    expectNoMachineCodesInErrors();
    expect(err.textContent).not.toContain('approval.upstream_unavailable');
    // the card itself is the other -error slot; both stay localized
    expect(screen.getByTestId('agent-v2-aprd-error')).toBeInTheDocument();

    mode = 'evcDetail';
    vi.unstubAllGlobals();
    stubFetch();
    fireEvent.click(screen.getByTestId('agent-v2-aprd-retry'));
    await waitFor(() => expect(screen.getByTestId('agent-v2-aprd-change')).toBeInTheDocument());
    expect(screen.queryByTestId('agent-v2-aprd-detail-error')).toBeNull();
  });

  it('a 200 body without approvalId is an empty payload, not a fake detail', async () => {
    mode = 'emptyBody';
    stubFetch();
    renderDetail();

    const card = await screen.findByTestId('agent-v2-aprd-empty');
    expect(card.textContent).toContain('未获得审批数据');
    expect(screen.queryByTestId('agent-v2-aprd-meta')).toBeNull();
  });

  it('no raw i18n key or undefined ever reaches the screen', async () => {
    mode = 'evcDetail';
    stubFetch();
    renderDetail();

    await screen.findByTestId('agent-v2-aprd-actions');
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('agentConsole.');
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('{{');
    expect(body).not.toContain('待接入');
  });

  it('header carries the truncated id, status, risk pill and back link', async () => {
    mode = 'evcDetail';
    stubFetch();
    renderDetail();

    const idCell = await screen.findByTestId('agent-v2-aprd-id');
    expect(idCell.textContent).toBe('ap_AEEC078E0C824E749513AFEC9A'.slice(0, 6) + '…' + 'EC9A');
    expect(idCell.getAttribute('title')).toBe('ap_AEEC078E0C824E749513AFEC9A');
    expect(screen.getByTestId('agent-v2-aprd-status').textContent).toBe('已消费');
    const risk = screen.getByTestId('agent-v2-aprd-risk');
    expect(risk.textContent).toBe('高风险');
    expect(risk.querySelector('.a2-pill-dot')).not.toBeNull();
    expect(risk.className).toContain('is-danger');
    expect(screen.getByTestId('agent-v2-aprd-back')).toHaveAttribute('href', '/agent/approvals');
    expect(screen.getByTestId('agent-v2-aprd-meta-digest').textContent).toContain(
      '22eadfcebfdaa88b5451bb8622503c876ddfd7418e692056baa29786bb9fb63f',
    );
    expect(screen.getByTestId('agent-v2-aprd-binding-hash').textContent).toContain(
      'th_62872a9dadb0bfa4ab07c5f81abb0d81',
    );
  });
});
