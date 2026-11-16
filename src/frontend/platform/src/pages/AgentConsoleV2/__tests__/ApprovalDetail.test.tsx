/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * APR-02 read-only approval detail tests.
 *
 * Strategy mirrors ApprovalsList.test: stub the global fetch makeFetcher() uses,
 * routed by URL, returning the live-verified AP3 shape (evidence/00/02) plus the
 * CR-043 additive `detail` projection. react-i18next is mocked against the REAL
 * zh-Hans resources so the leak guard is meaningful: machine codes / raw action
 * / raw changeKind must never appear in visible text (titles only).
 *
 * Coverage: AP3 request + URL direct/refresh recovery; D-1 binding present-only
 * (effectiveFrom/runId/messageDigest); D-2 empty/unknown id 404 same body as 403;
 * D-4 terminal remainingSeconds=0 → 已结束; the four change-detail branches;
 * all-disabled M1 ops with zero AP2; four states + retry; countdown authority.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';

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
        dict,
      );
    if (typeof defOrOpts === 'string') return typeof value === 'string' ? value : defOrOpts;
    if (typeof value !== 'string') return String(key);
    const options = (defOrOpts ?? {}) as Record<string, unknown>;
    return value.replace(/\{\{(\w+)\}\}/g, (m, name: string) =>
      name in options ? String(options[name]) : m,
    );
  };
  return { useTranslation: () => ({ t }) };
});

import { ApprovalDetailPage } from '../ApprovalDetailPage';
import { AgentConsoleShell } from '../Shell';
import { userContext } from '@/contexts/userContext';

const A1 = 'ap_9D21F4A67B3E4C05D8A1F2E3';
const EMP = 'emp_86A81CE8FF6F42E187BCF2B540';
const FROMV = 'empv_DA3408CDC3DC4F8F9BFEED9EF8';

function futureIso(seconds = 3600): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

const changeDetail = {
  employeeId: EMP,
  fromVersionId: FROMV,
  toVersionNo: 3,
  addedGrants: [
    {
      id: 'gr_3A384C3D17154889A609670E8C',
      employeeId: EMP,
      scopeType: 'channel',
      resourceSelector: { types: ['chat'] },
      actions: ['send'],
      expiresAt: '2026-12-31T00:00:00.000Z',
      source: 'role',
    },
  ],
  removedGrantIds: [],
  effectiveFrom: '2026-11-16T02:35:00.000Z',
  source: 'resource+versions',
};

const detailProjection = {
  changeDetail,
  versions: [
    { versionNo: 1, effectiveFrom: '2026-10-01T00:00:00.000Z', effectiveTo: '2026-11-01T00:00:00.000Z', status: 'superseded', knowledgeCount: 1 },
    { versionNo: 2, effectiveFrom: '2026-11-01T00:00:00.000Z', effectiveTo: null, status: 'current', knowledgeCount: 2 },
  ],
  employee: { employeeId: EMP, name: '小鲤', title: '客服', lifecycleState: 'active', ownerUserId: '1', currentVersionId: FROMV },
};

function approval(extra: Record<string, unknown> = {}) {
  return {
    approvalId: A1,
    tenantId: 't1',
    type: 'business_action',
    action: 'employee.version.create',
    status: 'pending',
    riskLevel: 'medium',
    requestedBy: { type: 'user', id: 'human:7' },
    onBehalfOf: { type: 'employee', id: EMP },
    reasonText: '大促期间客户消息增多，需要把处理结论直接发到会话。',
    argsDigest: 'sha256:p07grant',
    policyDecisionId: 'pd_5B0CA9C8091A4D4196A41E7303',
    binding: {
      subjectType: 'employee',
      subjectId: EMP,
      changeKind: 'employee_version_create',
      targetHash: 'th_9f4cdb146a06e8c92207b968612511ae',
      effectiveFrom: '2026-11-16T02:35:00.000Z',
    },
    approvers: [
      { userId: 'human:2', role: 'owner' },
      { userId: 'human:5', role: 'reviewer' },
    ],
    requiredApprovals: 1,
    decisions: [],
    ttlSeconds: 86400,
    expiresAt: futureIso(18600),
    remainingSeconds: 18600,
    createdAt: '2026-11-15T07:30:00.000Z',
    ...extra,
  };
}

// ----- switchable stub outcomes -----
let detailStatus = 200;
let detailBody: unknown = approval({ detail: detailProjection });
let urls: string[] = [];
let methods: string[] = [];
let writeStatus = 200;
let writeBody: unknown = { approvalId: A1, status: 'approved' };
let bodies: Array<Record<string, unknown>> = [];
let writeHeaders: Array<Record<string, string>> = [];

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'X-Console-Request-Id': 'req_apr02' }),
    json: async () => body,
  };
}

beforeEach(() => {
  urls = [];
  methods = [];
  bodies = [];
  writeHeaders = [];
  writeStatus = 200;
  writeBody = { approvalId: A1, status: 'approved' };
  detailStatus = 200;
  detailBody = approval({ detail: detailProjection });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      methods.push(init?.method ?? 'GET');
      if (url.includes('/api/approval/decision')) {
        bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        writeHeaders.push({ ...(init?.headers as Record<string, string>) });
        return jsonResponse(writeStatus, writeBody);
      }
      if (url.includes('/api/approval?')) {
        if (detailStatus === 500) return jsonResponse(500, { code: 'approval.service_unavailable', message: 'stub' });
        if (detailStatus === 404) return jsonResponse(404, { code: 'approval.not_found', message: 'stub' });
        if (detailStatus === 403) return jsonResponse(403, { code: 'console.forbidden', message: 'stub' });
        return jsonResponse(detailStatus, detailBody);
      }
      return jsonResponse(200, {});
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc-probe">{loc.pathname}{loc.search}</div>;
}

function renderDetailAs(userId: number, entry = `/agent/approvals/${A1}`) {
  return render(
    // user_id 2 is in approvers[] of the fixture: the write gate needs a real
    // current user, and tests must never invent an admin role.
    <userContext.Provider value={{ user: { user_id: userId } } as never}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/agent/approvals" element={<div data-testid="list-stub">list</div>} />
          <Route path="/agent/approvals/:id" element={<ApprovalDetailPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </userContext.Provider>,
  );
}

function renderDetail(entry = `/agent/approvals/${A1}`) {
  return renderDetailAs(2, entry);
}

function renderDetailInShell(entry = `/agent/approvals/${A1}`) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/agent" element={<AgentConsoleShell />}>
          <Route path="approvals" element={<div data-testid="list-stub">list</div>} />
          <Route path="approvals/:id" element={<ApprovalDetailPage />} />
        </Route>
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('APR-02 — page footer & shell breadcrumb', () => {
  it('renders the footer caliber row after the ops card', async () => {
    renderDetail();
    await screen.findByTestId('agent-v2-apd-ops');
    const foot = screen.getByTestId('agent-v2-apd-footer');
    expect(foot.textContent).toContain('数据源：AP3 审批详情（唯一）· 明细投影 CR-043 · 决策经 BFF 白名单写路径（二次确认）');
    expect(foot.textContent).toContain('时间北京时间');
    expect(foot.textContent).toContain('剩余时间只认服务端 remainingSeconds');
    expect(foot.textContent).toContain('缺失显示 —/不可得');
    expect(foot.textContent).toContain('不造 0');
    expect(foot.textContent).toContain('无总数');
    expect(foot.textContent).toContain('⌘K');
    expect(foot.textContent).toContain('搜索');
  });

  it('shell breadcrumb adds 「控制台 › 审批 › 截断 id」 with the full id in title', async () => {
    renderDetailInShell();
    await screen.findByTestId('agent-v2-apd-meta');
    const crumb = screen.getByLabelText('breadcrumb');
    expect(crumb.textContent).toContain('控制台');
    expect(crumb.textContent).toContain('审批');
    const tail = screen.getByTestId('agent-v2-crumb-tail');
    expect(tail.textContent).toBe('ap_9D21…F2E3');
    expect(tail.getAttribute('title')).toBe(A1);
  });
});

describe('APR-02 approval detail — data plane & routing', () => {
  it('GETs AP3 /api/approval?id= from the URL param (direct entry)', async () => {
    renderDetail();
    await screen.findByTestId('agent-v2-apd-meta');
    const ap3 = urls.find((u) => u.includes('/api/approval?'));
    expect(ap3).toContain('/agent-api/api/approval?');
    expect(ap3).toContain(`id=${A1}`);
    expect(methods.every((m) => m === 'GET')).toBe(true);
  });

  it('re-GETs on a fresh mount (refresh recovery)', async () => {
    const { unmount } = renderDetail();
    await screen.findByTestId('agent-v2-apd-meta');
    unmount();
    renderDetail();
    await screen.findByTestId('agent-v2-apd-meta');
    expect(urls.filter((u) => u.includes('/api/approval?')).length).toBeGreaterThanOrEqual(2);
  });

  it('back returns to the list URL with filters preserved (id link carries state.from)', async () => {
    function ListStub() {
      const loc = useLocation();
      return (
        <div data-testid="list-stub">
          <NavLink to={`/agent/approvals/${A1}`} state={{ from: `${loc.pathname}${loc.search}` }} data-testid="go-detail">
            open
          </NavLink>
        </div>
      );
    }
    render(
      <MemoryRouter initialEntries={['/agent/approvals?status=pending&limit=20']}>
        <Routes>
          <Route path="/agent/approvals" element={<ListStub />} />
          <Route path="/agent/approvals/:id" element={<ApprovalDetailPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId('go-detail'));
    await screen.findByTestId('agent-v2-apd-back');
    fireEvent.click(screen.getByTestId('agent-v2-apd-back'));
    await waitFor(() =>
      expect(screen.getByTestId('loc-probe').textContent).toBe('/agent/approvals?status=pending&limit=20'),
    );
  });
});

describe('APR-02 — D-1 binding present-only', () => {
  it('message_send shows runId + messageDigest and omits absent effectiveFrom', async () => {
    detailBody = approval({
      action: 'message.send',
      binding: {
        subjectType: 'employee',
        subjectId: EMP,
        changeKind: 'message_send',
        targetHash: 'th_8b2e5f1a9c4d7e0b3f6a1d8c5e2b9f47',
        runId: 'rn_01M7DF41FG124YHW9PR66CJ7HW',
        messageDigest: 'md_5e8b1f4a7c0d3e6f9a2b5c8d1e4f7a0b',
      },
      detail: undefined,
    });
    renderDetail();
    const binding = await screen.findByTestId('agent-v2-apd-binding');
    expect(binding.textContent).toContain('关联运行');
    expect(binding.textContent).toContain('消息摘要');
    expect(binding.textContent).toContain('md_5e8b1f4a7c0d3e6f9a2b5c8d1e4f7a0b');
    // O1: the caliber statement stays present on message_send too.
    expect(binding.textContent).toContain('present-only：响应没有的键不显示、不造值');
    expect(binding.textContent).not.toContain('消息发送单另含运行引用与消息摘要');
    expect(binding.textContent).not.toContain('生效时间');
    expect(screen.getByTitle('rn_01M7DF41FG124YHW9PR66CJ7HW')).toBeTruthy();
  });

  it('P1 batch2: targetHash / messageDigest / present-only / caliber each carry a help tip', async () => {
    detailBody = approval({
      action: 'message.send',
      binding: {
        subjectType: 'employee',
        subjectId: EMP,
        changeKind: 'message_send',
        targetHash: 'th_8b2e5f1a9c4d7e0b3f6a1d8c5e2b9f47',
        runId: 'rn_01M7DF41FG124YHW9PR66CJ7HW',
        messageDigest: 'md_5e8b1f4a7c0d3e6f9a2b5c8d1e4f7a0b',
      },
      detail: undefined,
    });
    renderDetail();
    await screen.findByTestId('agent-v2-apd-binding');
    for (const id of [
      'agent-v2-apd-help-target-hash',
      'agent-v2-apd-help-message-digest',
      'agent-v2-apd-help-present-only',
      'agent-v2-apd-help-caliber',
    ]) {
      const btn = screen.getByTestId(id);
      expect(btn.tagName).toBe('BUTTON');
      expect(btn.getAttribute('aria-label')).toBeTruthy();
      expect(btn.getAttribute('aria-label')).not.toContain('agentConsole.v2.help');
    }
    // opening one explains the term and hides no data (popover is not interactive)
    fireEvent.click(screen.getByTestId('agent-v2-apd-help-target-hash'));
    const pop = screen.getByRole('tooltip');
    expect(pop.textContent).toContain('targetHash');
    expect(pop.textContent).toContain('哈希');
    // the value itself is still on screen
    expect(screen.getByTestId('agent-v2-apd-binding').textContent).toContain(
      'th_8b2e5f1a9c4d7e0b3f6a1d8c5e2b9f47'
    );
    fireEvent.keyDown(screen.getByTestId('agent-v2-apd-help-target-hash'), { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('version binding renders effectiveFrom when present', async () => {
    renderDetail();
    const binding = await screen.findByTestId('agent-v2-apd-binding');
    expect(binding.textContent).toContain('生效时间');
    expect(binding.textContent).not.toContain('关联运行');
    expect(binding.textContent).not.toContain('消息摘要');
  });
});

describe('APR-02 — D-2 empty/unknown id 404 same body as 403', () => {
  it('unknown id → 404 hidden body, no existence leak', async () => {
    detailStatus = 404;
    renderDetail('/agent/approvals/ap_UNKNOWN');
    const card = await screen.findByTestId('agent-v2-apd-notfound');
    expect(card.textContent).toContain('您还看不到这单审批');
    expect(card.textContent).toContain('HTTP 404');
    expect(card.textContent).not.toContain('approval.not_found');
  });

  it('403 uses the SAME body, only the HTTP code differs', async () => {
    detailStatus = 403;
    renderDetail();
    const card = await screen.findByTestId('agent-v2-apd-forbidden');
    expect(card.textContent).toContain('您还看不到这单审批');
    expect(card.textContent).toContain('HTTP 403');
    expect(card.textContent).not.toContain('console.forbidden');
    // same title + same desc template as 404 (only code interpolated)
    expect(card.querySelector('.a2d-st')?.textContent).toBe('您还看不到这单审批');
  });

  it('empty id renders the 404 body without any fetch', async () => {
    render(
      <MemoryRouter initialEntries={['/no-id']}>
        <Routes>
          <Route path="/no-id" element={<ApprovalDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const card = await screen.findByTestId('agent-v2-apd-notfound');
    expect(card.textContent).toContain('您还看不到这单审批');
    expect(urls.filter((u) => u.includes('/api/approval?'))).toHaveLength(0);
  });
});

describe('APR-02 — D-4 terminal & countdown authority', () => {
  it('consumed remainingSeconds=0 → 已结束, never 剩余 0 秒; term bar present', async () => {
    detailBody = approval({
      status: 'consumed',
      riskLevel: 'high',
      remainingSeconds: 0,
      expiresAt: '2026-11-15T07:30:00.000Z',
      verdict: 'approve',
      decidedAt: '2026-11-14T11:31:13.744Z',
      consumedAt: '2026-11-14T11:31:24.232Z',
      decisions: [{ userId: 'human:1', verdict: 'approve', comment: 'P0-7 解阻批准', decidedAt: '2026-11-14T11:31:13.744Z' }],
    });
    renderDetail();
    await screen.findByTestId('agent-v2-apd-meta');
    expect(screen.getByTestId('agent-v2-apd-remaining').textContent).toBe('已结束');
    expect(screen.getByTestId('agent-v2-apd-countdown').textContent).toContain('已结束');
    expect(document.body.textContent).not.toContain('剩余 0 秒');
    const term = screen.getByTestId('agent-v2-apd-term');
    expect(term.textContent).toContain('最终判定');
    expect(term.textContent).toContain('判定时间');
    expect(term.textContent).toContain('消费时间');
    expect(term.textContent).toContain('批准');
    // decision timeline rendered with the comment
    expect(screen.getByTestId('agent-v2-apd-decisions').textContent).toContain('P0-7 解阻批准');
  });

  it('countdown trusts remainingSeconds, not expiresAt', async () => {
    detailBody = approval({ remainingSeconds: 7200, expiresAt: futureIso(999999) });
    renderDetail();
    await screen.findByTestId('agent-v2-apd-meta');
    expect(screen.getByTestId('agent-v2-apd-remaining').textContent).toBe('约 2 小时');
  });

  it('pending decisions empty state copy', async () => {
    renderDetail();
    const empty = await screen.findByTestId('agent-v2-apd-decisions-empty');
    expect(empty.textContent).toContain('暂无决策');
    expect(empty.textContent).toContain('还没有审批人做出决定');
    expect(screen.queryByTestId('agent-v2-apd-term')).toBeNull();
  });
});

describe('APR-02 — change-detail four branches', () => {
  it('version + detail → six keys, before→after, versions snapshot, source note', async () => {
    renderDetail();
    const card = await screen.findByTestId('agent-v2-apd-detail');
    expect(card.textContent).toContain('明细来源：resource+versions');
    expect(card.textContent).toContain('当前生效');
    expect(card.textContent).toContain('批准后新建');
    expect(card.textContent).toContain('v2');
    expect(card.textContent).toContain('v3');
    expect(card.textContent).toContain('目标版本号');
    expect(card.textContent).toContain('移除职权');
    expect(card.textContent).toContain('无'); // removedGrantIds=[] is a fact
    expect(card.textContent).toContain('版本快照');
    // snapshot rows are ONLY existing projection versions (no synthesized v3 row);
    // the proposed v3 lives in the before→after box above.
    expect(card.textContent).toContain('历史');
    expect(card.textContent).toContain('当前生效');
    expect(card.textContent).toContain(FROMV);
  });

  it('version without detail → 变更明细不可得 (no fabrication)', async () => {
    detailBody = approval({ detail: undefined });
    renderDetail();
    const na = await screen.findByTestId('agent-v2-apd-na-nodetail');
    expect(na.textContent).toContain('变更明细不可得');
    expect(na.textContent).toContain('不前端补算');
    // metadata still renders
    expect(screen.getByTestId('agent-v2-apd-meta').textContent).toContain('申请信息');
  });

  it('message_send → 不可得（摘要审批）', async () => {
    detailBody = approval({
      action: 'message.send',
      binding: { subjectType: 'employee', subjectId: EMP, changeKind: 'message_send', targetHash: 'th_x', runId: 'rn_x', messageDigest: 'md_x' },
    });
    renderDetail();
    const na = await screen.findByTestId('agent-v2-apd-na-message');
    expect(na.textContent).toContain('不可得（摘要审批）');
    expect(na.textContent).toContain('隐私设计');
  });

  it('grant_escalation / owner_transfer → 契约未定义', async () => {
    detailBody = approval({ action: 'grant.escalation', binding: { subjectType: 'employee', subjectId: EMP, changeKind: 'grant_escalation', targetHash: 'th_x' } });
    const { unmount } = renderDetail();
    expect((await screen.findByTestId('agent-v2-apd-na-contract')).textContent).toContain('契约未定义');
    unmount();
    detailBody = approval({ action: 'employee.owner.transfer', binding: { subjectType: 'employee', subjectId: EMP, changeKind: 'employee_owner_transfer', targetHash: 'th_x' } });
    renderDetail();
    expect((await screen.findByTestId('agent-v2-apd-na-contract')).textContent).toContain('契约未定义');
  });
});

describe('APR-03 — write gate off by default (build switch) + leak guard', () => {
  it('all three buttons disabled + aria-disabled + honest reason; zero AP2', async () => {
    renderDetail();
    await screen.findByTestId('agent-v2-apd-ops');
    for (const id of ['agent-v2-apd-reject', 'agent-v2-apd-revise', 'agent-v2-apd-approve']) {
      const btn = screen.getByTestId(id) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.title).toBe(
        '本环境未开放在线决策（前端构建开关未开启）：按钮仅作占位说明，本页不发送任何写请求。'
      );
    }
    expect(urls.some((u) => u.includes('/api/approval/decision'))).toBe(false);
    expect(methods.some((m) => m !== 'GET')).toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
    expect(screen.getByTestId('agent-v2-apd-ops-note').textContent).toContain('本环境未开放在线决策');
  });

  it('P0-4: the ops bar always renders the three buttons; 批准 keeps the pri recipe (never white-on-white)', async () => {
    renderDetail();
    await screen.findByTestId('agent-v2-apd-ops');
    const bar = document.querySelector('.a2d-acts') as HTMLElement;
    const btns = Array.from(bar.querySelectorAll('button'));
    // same DOM at every theme/breakpoint — the CSS decides visibility, not v-if
    expect(btns.map((b) => b.getAttribute('data-testid'))).toEqual([
      'agent-v2-apd-reject',
      'agent-v2-apd-revise',
      'agent-v2-apd-approve',
    ]);
    const approve = screen.getByTestId('agent-v2-apd-approve') as HTMLButtonElement;
    expect(approve.className).toContain('a2d-btn');
    expect(approve.className).toContain('pri');
    expect((approve.textContent ?? '').trim()).not.toBe('');
    expect(approve.disabled).toBe(true);
    // root cause guard: a hex in --primary makes `hsl(var(--primary))` invalid,
    // dropping the background and leaving #fff text on the white card.
    const css = readFileSync(
      resolve(process.cwd(), 'src/pages/AgentConsoleV2/agentConsoleV2.css'),
      'utf8',
    );
    const light = css.slice(css.indexOf(".agent-app[data-theme='light']"));
    const lightBlock = light.slice(0, light.indexOf('}'));
    const primary = /--primary:\s*([^;]+);/.exec(lightBlock)?.[1].trim() ?? '';
    expect(primary).not.toMatch(/^#/);
    expect(primary).toMatch(/^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/);
  });

  it('no machine codes / raw action / raw changeKind / undefined / total in visible text', async () => {
    renderDetail();
    await screen.findByTestId('agent-v2-apd-meta');
    const text = document.body.textContent ?? '';
    for (const leak of ['undefined', 'NaN', '[object Object]', '待接入', 'approval.', 'policy.', 'employee.version.create', 'employee_version_create', '共', 'total']) {
      expect(text).not.toContain(leak);
    }
    // raw values live in titles only
    expect(screen.getByTitle('changeKind=employee_version_create · action=employee.version.create')).toBeTruthy();
    // localized labels on screen
    expect(text).toContain('员工版本变更');
    expect(text).toContain('待审批');
    expect(text).toContain('风险：中');
    expect(text).toContain('业务动作');
    expect(text).toContain('任意一位可决');
    expect(text).toContain('24 小时');
    expect(text).toContain('sha256:p07grant'); // short digest verbatim, not padded
  });

  it('copy id is keyboard reachable and copies the full value', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    renderDetail();
    await screen.findByTestId('agent-v2-apd-meta');
    const copyBtn = screen.getByLabelText('复制审批单号');
    expect(copyBtn.getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(copyBtn, { key: 'Enter' });
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(A1));
    await waitFor(() =>
      expect(screen.getAllByRole('status').some((el) => (el.textContent ?? '').includes('已复制'))).toBe(true),
    );
  });
});

describe('APR-02 — four states & retry', () => {
  it('loading skeleton then ready', async () => {
    renderDetail();
    expect(screen.getByTestId('agent-v2-apd-loading')).toBeTruthy();
    await screen.findByTestId('agent-v2-apd-meta');
  });

  it('200 empty body → 审批内容为空', async () => {
    detailBody = {};
    renderDetail();
    const card = await screen.findByTestId('agent-v2-apd-emptybody');
    expect(card.textContent).toContain('审批内容为空');
    expect(card.textContent).toContain('HTTP 200');
  });

  it('500 → localized error + HTTP code (no machine code), retry recovers', async () => {
    detailStatus = 500;
    renderDetail();
    const card = await screen.findByTestId('agent-v2-apd-error');
    expect(card.textContent).toContain('审批详情没能加载出来');
    expect(card.textContent).toContain('HTTP 500');
    expect(card.textContent).not.toContain('approval.service_unavailable');
    // retry now succeeds
    detailStatus = 200;
    fireEvent.click(screen.getByTestId('agent-v2-apd-retry'));
    await screen.findByTestId('agent-v2-apd-meta');
  });
});
/* ------------------------------------------------------------------------- */
/* APR-03: the real decision write path. The build switch is the outer gate,  */
/* then lifecycle + change kind + approver membership + "not voted yet".      */
/* Tests stub only the transport; no mock data reaches a production path.     */
/* ------------------------------------------------------------------------- */

function decisionCalls(): string[] {
  return urls.filter((u) => u.includes('/api/approval/decision'));
}

async function openDialog(opId: 'agent-v2-apd-approve' | 'agent-v2-apd-reject' | 'agent-v2-apd-revise') {
  renderDetail();
  await screen.findByTestId('agent-v2-apd-ops');
  const btn = screen.getByTestId(opId) as HTMLButtonElement;
  expect(btn.disabled).toBe(false);
  fireEvent.click(btn);
  return screen.findByTestId('agent-v2-decision-dialog');
}

describe('APR-03 — decision write path (build switch on)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_AGENT_APPROVAL_WRITE', '1');
  });

  it('approve → confirm posts exactly {verdict} to the whitelist route and refreshes', async () => {
    await openDialog('agent-v2-apd-approve');
    expect(screen.getByTestId('agent-v2-decision-title').textContent).toContain('批准');
    expect(screen.getByTestId('agent-v2-decision-target').textContent).toBe(A1);
    expect(screen.getByTestId('agent-v2-decision-risk').textContent).toContain('不可撤回');

    fireEvent.click(screen.getByTestId('agent-v2-decision-confirm'));
    await waitFor(() => expect(bodies).toHaveLength(1));

    expect(decisionCalls()[0]).toContain('/agent-api/api/approval/decision?');
    expect(decisionCalls()[0]).toContain(`id=${A1}`);
    expect(bodies[0]).toEqual({ verdict: 'approve' });
    // CSRF pair only: the browser never carries Authorization on the write path.
    expect(writeHeaders[0]).toEqual({
      'Content-Type': 'application/json',
      'X-Console-Write': '1',
    });
    // success closes the dialog and re-GETs the detail (authoritative state)
    await waitFor(() => expect(screen.queryByTestId('agent-v2-decision-dialog')).toBeNull());
    await waitFor(() =>
      expect(urls.filter((u) => u.includes('/api/approval?')).length).toBeGreaterThanOrEqual(2)
    );
  });

  it('reject → confirm posts the trimmed comment with the verdict', async () => {
    await openDialog('agent-v2-apd-reject');
    fireEvent.change(screen.getByTestId('agent-v2-decision-comment'), {
      target: { value: '  大促期间口径未对齐  ' },
    });
    fireEvent.click(screen.getByTestId('agent-v2-decision-confirm'));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ verdict: 'reject', comment: '大促期间口径未对齐' });
  });

  it('revise → confirm posts {verdict:"revise"} and omits a blank comment', async () => {
    await openDialog('agent-v2-apd-revise');
    fireEvent.change(screen.getByTestId('agent-v2-decision-comment'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByTestId('agent-v2-decision-confirm'));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ verdict: 'revise' });
    expect(Object.keys(bodies[0])).toEqual(['verdict']);
  });

  it('cancel (and Esc) closes the dialog without any write', async () => {
    await openDialog('agent-v2-apd-approve');
    fireEvent.click(screen.getByTestId('agent-v2-decision-cancel'));
    expect(screen.queryByTestId('agent-v2-decision-dialog')).toBeNull();
    // reopen and close with Esc
    fireEvent.click(screen.getByTestId('agent-v2-apd-approve'));
    await screen.findByTestId('agent-v2-decision-dialog');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('agent-v2-decision-dialog')).toBeNull());
    expect(decisionCalls()).toHaveLength(0);
    expect(bodies).toHaveLength(0);
  });

  it('message_send stays fully disabled with the honest banner and zero POST', async () => {
    detailBody = approval({
      action: 'message.send',
      binding: {
        subjectType: 'employee',
        subjectId: EMP,
        changeKind: 'message_send',
        targetHash: 'th_x',
        runId: 'rn_x',
        messageDigest: 'md_x',
      },
      detail: undefined,
    });
    renderDetail();
    const banner = await screen.findByTestId('agent-v2-apd-outbound-banner');
    expect(banner.textContent).toContain('外发类审批暂不开放在线决策');
    for (const id of ['agent-v2-apd-reject', 'agent-v2-apd-revise', 'agent-v2-apd-approve']) {
      const btn = screen.getByTestId(id) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.title).toContain('外发类审批暂不开放在线决策');
    }
    expect(decisionCalls()).toHaveLength(0);
    expect(document.querySelector('[data-testid="agent-v2-decision-dialog"]')).toBeNull();
  });

  it('a viewer who is not an approver sees disabled controls and no dialog', async () => {
    renderDetailAs(9);
    await screen.findByTestId('agent-v2-apd-ops');
    expect((screen.getByTestId('agent-v2-apd-approve') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('agent-v2-apd-ops-note').textContent).toContain('仅本单审批人可在线决策');
  });

  it('a user who already voted cannot decide again', async () => {
    detailBody = approval({
      detail: detailProjection,
      decisions: [{ userId: 'human:2', verdict: 'approve', comment: '先批', decidedAt: '2026-11-15T09:00:00.000Z' }],
    });
    renderDetail();
    await screen.findByTestId('agent-v2-apd-ops');
    expect((screen.getByTestId('agent-v2-apd-approve') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('agent-v2-apd-ops-note').textContent).toContain('不能重复决策');
  });

  it('a terminal approval cannot be decided', async () => {
    detailBody = approval({ detail: detailProjection, status: 'consumed', remainingSeconds: 0 });
    renderDetail();
    await screen.findByTestId('agent-v2-apd-ops');
    expect((screen.getByTestId('agent-v2-apd-approve') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('agent-v2-apd-ops-note').textContent).toContain('已结束');
    expect(decisionCalls()).toHaveLength(0);
  });

  it('405 console.read_only → localized copy, HTTP status only, dialog stays open', async () => {
    writeStatus = 405;
    writeBody = { code: 'console.read_only', message: 'stub' };
    await openDialog('agent-v2-apd-approve');
    fireEvent.click(screen.getByTestId('agent-v2-decision-confirm'));
    const err = await screen.findByTestId('agent-v2-decision-error');
    expect(err.textContent).toContain('本环境未开放在线决策');
    expect(err.textContent).toContain('HTTP 405');
    expect(err.textContent).not.toContain('console.read_only');
    // no optimistic update: the dialog is still there with the failure
    expect(screen.getByTestId('agent-v2-decision-dialog')).toBeTruthy();
    expect(urls.filter((u) => u.includes('/api/approval?')).length).toBe(1);
  });

  it('403 → localized permission copy without the machine code', async () => {
    writeStatus = 403;
    writeBody = { code: 'console.forbidden', message: 'stub' };
    await openDialog('agent-v2-apd-reject');
    fireEvent.click(screen.getByTestId('agent-v2-decision-confirm'));
    const err = await screen.findByTestId('agent-v2-decision-error');
    expect(err.textContent).toContain('服务端拒绝了本次决策');
    expect(err.textContent).toContain('HTTP 403');
    expect(err.textContent).not.toContain('console.forbidden');
  });

  it('404 folded approval.unavailable → localized "不可决策" copy', async () => {
    writeStatus = 404;
    writeBody = { code: 'approval.unavailable', message: 'stub' };
    await openDialog('agent-v2-apd-approve');
    fireEvent.click(screen.getByTestId('agent-v2-decision-confirm'));
    const err = await screen.findByTestId('agent-v2-decision-error');
    expect(err.textContent).toContain('这单审批当前不可决策');
    expect(err.textContent).toContain('HTTP 404');
    expect(err.textContent).not.toContain('approval.unavailable');
    expect(err.textContent).not.toContain('approval.');
  });
});
