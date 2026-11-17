/* eslint-disable no-restricted-syntax -- fixtures mirror the A4 public shape; assertions pin the real zh-Hans copy */
/**
 * AUD-02 `/agent/audit/:eventId` — read-only event detail on the locked C1
 * baseline (aud02-target.html + AUD02-TARGET-SPEC.md §9 AUD02-E01…E18).
 *
 * Covered here (what jsdom can actually decide):
 * - E01/E02: section order, real field rendering, absence ≠ null (the failure
 *   event loses 代谁 / 四条关联 / 错误分区 / 哈希三段 — none of them becomes `—`);
 * - E03: responsibility four states (A on the success event, B/C/X driven);
 * - E04: hash triple when chained, the 「本条不参与哈希链」 block when not;
 * - E05/E06/E07: error class vs redacted message, ref jumps (task/run/approval)
 *   and the copy-only refs with their reasons;
 * - E10: ZERO write controls — the forbidden verb set never appears on a
 *   button/link, in any state;
 * - E11: 401-less five screens — 400 / 403 / 404 / error / loading, with 403 and
 *   404 sharing one body and differing only by the status code;
 * - E12: the 375 contract is asserted from the stylesheet (jsdom has no layout);
 * - no polling: one read on mount, one more per 「重新读取」.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

import type { AgentConsoleApi } from '@/controllers/API/agent';

import zhHans from '../../../../public/locales/zh-Hans/bs.json';
import { AuditDetailPage } from '../AuditDetailPage';
import { AuditEventRow } from '../AuditEventRow';
import { createHttpAuditDetailApi, pickEvent, schemaLabel, type AuditDetailApi } from '../aud02';
import type { AuditEvent, AuditVerifyResult } from '../aud01';

// ---------------------------------------------------------------- fixtures

const EVENT_ID = 'ev_01M7DF41M2N4P6R8T0V2W4Y6A8';
const TENANT = 't_seakoi_pilot';
const RUN_ID = 'rn_01M7DF8K2M4P6R8T0V2W4Y6A8C';
const TASK_ID = 'tk_01M7DF8J5H7K9M1N3P5R7T9V1XZ';
const APPROVAL_ID = 'ap_01M7DF8H4G6J8K0L2N4P6R8T0VW';
const EMP = 'emp_86A81CE8FF6F42E187BCF2B540';

function event(over: Partial<AuditEvent> = {}): AuditEvent {
  return {
    eventId: EVENT_ID,
    schemaVersion: 'v1',
    tenantId: TENANT,
    occurredAt: '2026-11-17T08:31:07.884Z',
    recordedAt: '2026-11-17T08:31:08.584Z',
    sourceSystem: 'channel',
    actor: { type: 'employee', id: EMP, displayName: '小鲤' },
    action: 'message.send',
    resource: { type: 'channel_event', id: 'om_9c3f5d2a7b1e4c60' },
    outcome: 'success',
    onBehalfOf: 'human:u_10001',
    responsibleHumanId: 'u_10001',
    decision: 'approved',
    runId: RUN_ID,
    taskId: TASK_ID,
    approvalId: APPROVAL_ID,
    policyDecisionId: 'pd_7C2A0F4E6B8D1C3A5E7F9B1D',
    employeeVersionRef: 'empv_01M7DF3ZK1M3P5R7T9V1X3Z5',
    policySnapshotRef: 'ps_01M7DF3ZH5J7L9N1P3R5T7V9',
    before: { status: 'sending' },
    after: { status: 'sent', channelMessageId: 'om_9c3f5d2a7b1e4c60' },
    payloadRef: 'audit-payloads/2026-11-17/ev_01M7DF41M2N4P6R8T0V2W4Y6A8/message.json.gz',
    correlationId: 'msg_01M7DF2W8K4M6P8R0T2V4X6Z',
    prevHash: 'ah_6b0f2e9c4d8a1b37f5e2c0a9d6b4f812',
    hash: 'ah_c47e9b2d5f0a8136e2b9c7d4f1a08635',
    ...over,
  };
}

/** The standard-tier failure: no decision, no diff, no hash, four refs gone. */
function failureEvent(over: Partial<AuditEvent> = {}): AuditEvent {
  return {
    eventId: 'ev_01M7DEY0P9R2T4V6X8Z0B2D4F6G',
    schemaVersion: 'v1',
    tenantId: TENANT,
    occurredAt: '2026-11-17T04:03:11.551Z',
    recordedAt: '2026-11-17T04:03:12.951Z',
    sourceSystem: 'employee',
    actor: { type: 'system', id: 'employee-api' },
    action: 'employee.version.create',
    resource: { type: 'employee', id: EMP },
    outcome: 'failure',
    responsibleUnresolvedReason: 'system_job',
    policyDecisionId: 'pd_9E1B3D5F7A2C4E6B8D0F1A3C',
    employeeVersionRef: 'empv_01M7DEY0K3M5P7R9T1V3X5Z7',
    error: {
      code: 'employee.version.rejected_by_validation',
      messageRedacted: '写入岗位版本时校验未通过：role 取值不在允许范围内。',
    },
    ...over,
  };
}

const S0: AuditVerifyResult = { ok: true, complete: true, scanned: 0 };

interface ApiStub {
  ok: boolean;
  event?: AuditEvent;
  status?: number;
  requestId?: string;
}

function makeApi(stub: ApiStub = { ok: true, event: event() }): AuditDetailApi & {
  getEvent: Mock;
  verifyAudit: Mock;
} {
  const result = stub.ok
    ? { ok: true, status: 200, data: stub.event ?? event() }
    : {
        ok: false,
        status: stub.status ?? 500,
        data: null,
        requestId: stub.requestId,
      };
  return {
    getEvent: vi.fn().mockResolvedValue(result),
    verifyAudit: vi.fn().mockResolvedValue({ ok: true, status: 200, data: S0 }),
    listAudit: vi.fn(),
  } as unknown as AuditDetailApi & { getEvent: Mock; verifyAudit: Mock };
}

const consoleApi = (): Pick<AgentConsoleApi, 'listEmployees'> =>
  ({
    listEmployees: vi.fn().mockResolvedValue({
      items: [
        { employeeId: EMP, name: '小鲤' },
        { employeeId: 'emp_5B3C7A9D1E2F4068B5C3D7E9', name: '小满' },
      ],
    }),
  }) as unknown as Pick<AgentConsoleApi, 'listEmployees'>;

function renderPage(opts: { api?: AuditDetailApi; eventId?: string } = {}) {
  const eventId = opts.eventId ?? EVENT_ID;
  return render(
    <MemoryRouter initialEntries={[`/agent/audit/${eventId}`]}>
      <Routes>
        <Route
          path="/agent/audit/:eventId"
          element={<AuditDetailPage api={opts.api ?? makeApi()} consoleApi={consoleApi()} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function waitReady() {
  await screen.findByTestId('aud02-detail');
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------- adapter

describe('AUD-02 — A4 adapter', () => {
  it('E11: reads /agent-api/api/audit-detail?id= and unwraps a bare or wrapped event', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'req-1' },
      json: async () => ({ event: event() }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const api = createHttpAuditDetailApi({ getToken: () => 'tok' });

    const res = await api.getEvent(EVENT_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/agent-api/api/audit-detail?id=${encodeURIComponent(EVENT_ID)}`,
    );
    expect(res.ok).toBe(true);
    expect(res.data?.eventId).toBe(EVENT_ID);
    expect(res.requestId).toBe('req-1');
    vi.unstubAllGlobals();
  });

  it('E11: 403/404 pass the status through; an empty 200 body is an honest failure', async () => {
    const notFound = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => null },
      json: async () => ({ code: 'audit.event_not_found' }),
    });
    vi.stubGlobal('fetch', notFound);
    const api = createHttpAuditDetailApi({ getToken: () => null });
    const missing = await api.getEvent(EVENT_ID);
    expect(missing.ok).toBe(false);
    expect(missing.status).toBe(404);

    const empty = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', empty);
    const blank = await api.getEvent(EVENT_ID);
    expect(blank.ok).toBe(false);
    expect(blank.data).toBeNull();
    vi.unstubAllGlobals();
  });

  it('never invents an event out of a body without an eventId', () => {
    expect(pickEvent(null)).toBeNull();
    expect(pickEvent({ hello: 'world' })).toBeNull();
    expect(pickEvent({ data: { eventId: 'ev_1' } })?.eventId).toBe('ev_1');
  });
});

// ---------------------------------------------------------------- sections

describe('AUD-02 — sections, fields and absence', () => {
  it('E01: renders the seven-part order with real values and no placeholder copy', async () => {
    renderPage();
    await waitReady();

    const flow = screen.getByTestId('aud02-detail');
    const zones = Array.from(flow.querySelectorAll('.zno')).map((n) => n.textContent);
    expect(zones).toEqual(['01', '02', '03', '04', '05']);

    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toContain('消息发送');
    expect(h1.textContent).toContain('成功');

    // 事件编号: truncated on screen, full value on copy.
    const idCell = screen.getByTestId('aud02-event-id');
    expect(idCell.getAttribute('title')).toBe(EVENT_ID);
    fireEvent.click(within(idCell).getByRole('button'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(EVENT_ID);

    // 租户: labelled mono, full value, and it is the only place it appears.
    expect(screen.getByTestId('aud02-tenant').textContent).toBe(TENANT);
    expect(screen.getByTestId('aud02-f-tenant').textContent).toContain('租户');

    expect(screen.getByTestId('aud02-f-source').textContent).toContain('渠道');
    expect(screen.getByTestId('aud02-f-source').textContent).toContain('channel');
    expect(screen.getByTestId('aud02-f-occurred').textContent).toContain('11-17 16:31:07');
    expect(screen.getByTestId('aud02-f-recorded').textContent).toContain('11-17 16:31:08');
    expect(screen.getByTestId('aud02-f-decision').textContent).toContain('已批准');
    expect(screen.getByTestId('aud02-f-outcome').textContent).toContain('成功');
    expect(screen.getByTestId('aud02-f-actor').textContent).toContain('小鲤');
    expect(screen.getByTestId('aud02-responsible-name').textContent).toContain('用户 #u_10001');

    // The audit fixture is real data now — the reference-screen 「示例数据」 note is gone.
    expect(document.body.textContent).not.toContain('示例数据');
    expect(document.body.textContent).not.toContain('待接入');
    expect(document.body.textContent).not.toContain('TODO');
  });

  it('E02: 代谁 is a sub-line of the actor cell, never a bare human: token', async () => {
    renderPage();
    await waitReady();
    const behalf = screen.getByTestId('aud02-behalf');
    expect(behalf.textContent).toContain('代谁');
    expect(behalf.textContent).toContain('用户 #u_10001');
    expect(behalf.textContent).not.toContain('human:');
  });

  it('E02: an event without 代谁 renders no such line at all', async () => {
    renderPage({ api: makeApi({ ok: true, event: failureEvent() }) });
    await waitReady();
    expect(screen.queryByTestId('aud02-behalf')).toBeNull();
    // The cell keeps its explanation but carries no 「代谁 → …」 sub-line.
    const actor = screen.getByTestId('aud02-f-actor');
    expect(actor.querySelector('.sub2')).toBeNull();
  });

  it('E02: the failure event loses 四条关联 and keeps the two it has', async () => {
    renderPage({ api: makeApi({ ok: true, event: failureEvent() }) });
    await waitReady();

    expect(screen.getByTestId('aud02-ref-policyDecisionId')).toBeTruthy();
    expect(screen.getByTestId('aud02-ref-employeeVersionRef')).toBeTruthy();
    for (const gone of ['runId', 'taskId', 'approvalId', 'correlationId']) {
      expect(screen.queryByTestId(`aud02-ref-${gone}`)).toBeNull();
    }
    const refs = screen.getByTestId('aud02-card-refs');
    expect(refs.textContent).toContain('本条没有记录');
    expect(refs.textContent).toContain('运行');
    expect(refs.textContent).toContain('任务');
  });

  it('E02: decision — absent draws nothing (no 「—」), and says 「没有决定字段」', async () => {
    renderPage({ api: makeApi({ ok: true, event: failureEvent() }) });
    await waitReady();
    const cell = screen.getByTestId('aud02-f-decision');
    // R1 (D4): the card's own rule is 「缺省不画 —」 — the value block is empty.
    expect(screen.getByTestId('aud02-decision-absent').textContent).toBe('');
    expect(cell.querySelector('.v')?.textContent).toBe('');
    expect(cell.textContent).toContain('没有决定字段');
    expect(cell.textContent).not.toContain('不经过权限判定');
  });

  it('E02: not_applicable is `—` too, but says the action skips the check', async () => {
    renderPage({
      api: makeApi({ ok: true, event: event({ decision: 'not_applicable' }) }),
    });
    await waitReady();
    const cell = screen.getByTestId('aud02-f-decision');
    expect(cell.textContent).toContain('该动作不经过权限判定');
  });

  it('E02: no before/after means one honest line, never an empty table', async () => {
    renderPage({ api: makeApi({ ok: true, event: failureEvent() }) });
    await waitReady();
    const diff = screen.getByTestId('aud02-diff');
    expect(diff.textContent).toContain('没有记录变更');
    expect(within(diff).queryAllByTestId('aud02-diff-row')).toHaveLength(0);
  });

  it('E02: the diff renders one row per changed key with its tag', async () => {
    renderPage();
    await waitReady();
    const rows = screen.getAllByTestId('aud02-diff-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].className).toContain('chg');
    expect(rows[0].textContent).toContain('status');
    expect(rows[0].textContent).toContain('变更');
    expect(rows[1].className).toContain('add');
    expect(rows[1].textContent).toContain('channelMessageId');
  });

  it('E07: payloadRef shows the object key only, with no download affordance', async () => {
    renderPage();
    await waitReady();
    const row = screen.getByTestId('aud02-payload-ref');
    expect(row.textContent).toContain('大对象引用');
    expect(row.textContent).toContain('不提供下载或预览');
    expect(within(row).queryByRole('link')).toBeNull();
  });

  it('E07: an event without payloadRef drops the row', async () => {
    renderPage({ api: makeApi({ ok: true, event: failureEvent() }) });
    await waitReady();
    expect(screen.queryByTestId('aud02-payload-ref')).toBeNull();
  });
});

// ---------------------------------------------------------------- responsibility

describe('AUD-02 — responsibility four states (E03)', () => {
  it('A: a responsible human is plain text, no semantic colour', async () => {
    renderPage();
    await waitReady();
    const cell = screen.getByTestId('aud02-f-responsible');
    expect(cell.textContent).toContain('用户 #u_10001');
    expect(cell.textContent).toContain('快照');
    expect(cell.querySelector('.pill')).toBeNull();
  });

  it('B: unresolved + reason is a neutral pill, never danger', async () => {
    renderPage({ api: makeApi({ ok: true, event: failureEvent() }) });
    await waitReady();
    const cell = screen.getByTestId('aud02-f-responsible');
    const pill = cell.querySelector('.pill');
    expect(pill?.className).toContain('nt');
    expect(pill?.className).not.toContain('dg');
    expect(screen.getByTestId('aud02-responsible-reason').textContent).toBe('系统作业');
  });

  it('C: both values show the human plus 「同时标注原因」', async () => {
    renderPage({
      api: makeApi({
        ok: true,
        event: failureEvent({ responsibleHumanId: 'u_10001' }),
      }),
    });
    await waitReady();
    const cell = screen.getByTestId('aud02-f-responsible');
    expect(cell.textContent).toContain('用户 #u_10001');
    expect(cell.textContent).toContain('同时标注原因');
    expect(cell.textContent).toContain('系统作业');
  });

  it('X: both missing is a warning data-quality line, not a blank cell', async () => {
    renderPage({
      api: makeApi({ ok: true, event: failureEvent({ responsibleUnresolvedReason: undefined }) }),
    });
    await waitReady();
    expect(screen.getByTestId('aud02-responsible-missing').className).toContain('wr');
    expect(screen.getByTestId('aud02-f-responsible').textContent).toContain('数据缺陷');
  });
});

// ---------------------------------------------------------------- integrity

describe('AUD-02 — integrity and the mounted chain panel (E04, E13)', () => {
  it('E04: a critical event renders 前序 / 本条 / 后序 with the unknown successor', async () => {
    renderPage();
    await waitReady();
    const chain = screen.getByTestId('aud02-chain3');
    expect(chain.textContent).toContain('前序');
    expect(chain.textContent).toContain('本条');
    expect(chain.textContent).toContain('后序');
    expect(chain.textContent).toContain('未知（本次未能读取）');
    expect(screen.getByTestId('aud02-cur-hash').getAttribute('title')).toBe(
      'ah_c47e9b2d5f0a8136e2b9c7d4f1a08635',
    );
    expect(screen.queryByTestId('aud02-nohash')).toBeNull();
    // 「验证此条」 must not exist anywhere — the rule is stated, not offered.
    expect(screen.getByTestId('aud02-selfproof').textContent).toContain('没有「验证此条」入口');
    expect(
      Array.from(document.querySelectorAll('button')).some((b) =>
        /验证此条/.test(b.textContent ?? ''),
      ),
    ).toBe(false);
  });

  it('E04: a standard event swaps the triple for the 「本条不参与哈希链」 block', async () => {
    renderPage({ api: makeApi({ ok: true, event: failureEvent() }) });
    await waitReady();
    const block = screen.getByTestId('aud02-nohash');
    expect(block.textContent).toContain('本条不参与哈希链');
    expect(block.textContent).toContain('分级设计');
    expect(screen.queryByTestId('aud02-chain3')).toBeNull();
    expect(screen.queryByTestId('aud02-selfproof')).toBeNull();
    // No pill ever claims the event is protected (or unprotected) — the
    // wording list in the copy names both words precisely to refuse them.
    expect(block.querySelector('.pill')?.className).toContain('nt');
    expect(block.textContent).toContain('不是「未保护」');
  });

  it('E13: the A7 panel is mounted inside section 05 and reads the shared adapter', async () => {
    const api = makeApi();
    renderPage({ api });
    await waitReady();
    const mount = screen.getByTestId('aud02-verify-mount');
    expect(mount.querySelector('[data-testid="aud01-verify"]')).toBeTruthy();
    expect(api.verifyAudit).toHaveBeenCalled();
    // The internal endpoint code is not carried onto this page.
    expect(mount.textContent).not.toContain('A7');
  });
});

// ---------------------------------------------------------------- refs

describe('AUD-02 — related references (E06)', () => {
  it('jumps to the live read-only pages by real id', async () => {
    renderPage();
    await waitReady();
    expect(screen.getByTestId('aud02-link-runId').getAttribute('href')).toBe(
      `/agent/runs/${RUN_ID}`,
    );
    expect(screen.getByTestId('aud02-link-taskId').getAttribute('href')).toBe(
      `/agent/tasks/${TASK_ID}`,
    );
    expect(screen.getByTestId('aud02-link-approvalId').getAttribute('href')).toBe(
      `/agent/approvals/${APPROVAL_ID}`,
    );
  });

  it('copy-only refs say why they cannot jump, and the snapshot stays unknown', async () => {
    renderPage();
    await waitReady();
    expect(screen.queryByTestId('aud02-link-policyDecisionId')).toBeNull();
    expect(screen.getByTestId('aud02-ref-policyDecisionId').textContent).toContain('只复制');
    expect(screen.getByTestId('aud02-snapshot-unknown').textContent).toContain(
      '内容未知（本次未能读取）',
    );
    expect(screen.getByTestId('aud02-ref-correlationId').textContent).toContain('只复制');
    // Copy controls still hand out full values.
    fireEvent.click(screen.getByTestId('aud02-copy-correlationId').querySelector('button')!);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'msg_01M7DF2W8K4M6P8R0T2V4X6Z',
    );
  });

  it('an employee resource resolves a name and links to EMP-03', async () => {
    renderPage({ api: makeApi({ ok: true, event: failureEvent() }) });
    await waitReady();
    expect(screen.getByTestId('aud02-employee-link').getAttribute('href')).toBe(
      `/agent/employees/${EMP}`,
    );
    const cell = screen.getByTestId('aud02-f-resource');
    expect(cell.textContent).toContain('小鲤');
    expect(cell.textContent).not.toContain('emp_');
  });
});

// ---------------------------------------------------------------- error section

describe('AUD-02 — error section (E05)', () => {
  it('shows the contract error class and the redacted message, no original text', async () => {
    renderPage({ api: makeApi({ ok: true, event: failureEvent() }) });
    await waitReady();
    expect(screen.getByTestId('aud02-error-code').textContent).toContain(
      'employee.version.rejected_by_validation',
    );
    expect(screen.getByTestId('aud02-error-message').textContent).toContain(
      'role 取值不在允许范围内',
    );
    expect(screen.getByTestId('aud02-error-message').textContent).toContain(
      '不保存原始错误信息',
    );
    // The section only exists when the event has an error.
    const zones = Array.from(document.querySelectorAll('.zno')).map((n) => n.textContent);
    expect(zones[zones.length - 1]).toBe('06');
  });

  it('the success event renders no error section at all', async () => {
    renderPage();
    await waitReady();
    expect(screen.queryByTestId('aud02-card-error')).toBeNull();
    const zones = Array.from(document.querySelectorAll('.zno')).map((n) => n.textContent);
    expect(zones).not.toContain('06');
  });
});

// ---------------------------------------------------------------- read-only

describe('AUD-02 — zero write entries (E09, E10)', () => {
  const WRITE = /导出|下载|修改|删除|补录|还原|回滚|应用回|验证此条|撤销|新建|批量|创建|编辑|保存|批准|驳回|重放/;

  const writeControls = (): string[] =>
    Array.from(document.querySelectorAll('button, a, [role="button"]'))
      .map((el) => (el.textContent ?? '').trim())
      .filter((text) => WRITE.test(text));

  it('the normal screen has none', async () => {
    renderPage();
    await waitReady();
    expect(writeControls()).toEqual([]);
  });

  it('the failure screen has none either', async () => {
    renderPage({ api: makeApi({ ok: true, event: failureEvent() }) });
    await waitReady();
    expect(writeControls()).toEqual([]);
  });

  it('403 and 404 have none, and the banner explains the boundary', async () => {
    renderPage({ api: makeApi({ ok: false, status: 403 }) });
    await screen.findByTestId('aud02-forbidden');
    expect(writeControls()).toEqual([]);
    expect(screen.getByTestId('aud02-readonly-banner').textContent).toContain('本页只读');
    expect(screen.queryByTestId('aud02-detail')).toBeNull();
  });
});

// ---------------------------------------------------------------- state screens

describe('AUD-02 — state screens (E11)', () => {
  it('403 and 404 keep one screen and test ids, but say different, honest things', async () => {
    renderPage({ api: makeApi({ ok: false, status: 403, requestId: 'req-403' }) });
    await screen.findByTestId('aud02-forbidden');
    const forbidden = screen.getByTestId('aud02-forbidden').textContent ?? '';
    // R1 (D2): the code lives in aria/title, never in the sentence.
    expect(screen.getByTestId('aud02-status-code').getAttribute('aria-label')).toBe('HTTP 403');
    expect(forbidden).not.toContain('HTTP 403');
    expect(forbidden).toContain('查看权限');
    // No data, no skeleton — the whole page is replaced.
    expect(screen.queryByTestId('aud02-detail')).toBeNull();
    expect(document.body.textContent).not.toContain(EVENT_ID);

    cleanup();
    renderPage({ api: makeApi({ ok: false, status: 404, requestId: 'req-404' }) });
    await screen.findByTestId('aud02-forbidden');
    const notFound = screen.getByTestId('aud02-forbidden').textContent ?? '';
    expect(screen.getByTestId('aud02-status-code').getAttribute('aria-label')).toBe('HTTP 404');
    // R1 (D1): 404 is 「不存在/超出保留期」, never 「没有查看权限」.
    expect(notFound).not.toContain('HTTP 404');
    expect(notFound).toContain('不存在');
    expect(notFound).toContain('保留期');
    expect(notFound).not.toContain('查看权限');
    // Same structure, same controls: only the copy differs.
    expect(screen.getByTestId('aud02-forbidden-retry')).toBeTruthy();
    expect(screen.getByTestId('aud02-forbidden-reqid').textContent).toContain('req-404');
  });

  it('a 500 shows the plain-language screen with the request id (code in title only)', async () => {
    renderPage({ api: makeApi({ ok: false, status: 502, requestId: '7c1e94d2b08a' }) });
    await screen.findByTestId('aud02-error');
    expect(screen.getByTestId('aud02-error').textContent).toContain('这条事件没能读出来');
    expect(screen.getByTestId('aud02-error').textContent).not.toContain('HTTP 502');
    expect(screen.getByTestId('aud02-error-bar').getAttribute('title')).toBe('HTTP 502');
    expect(screen.getByTestId('aud02-error-bar').textContent).not.toContain('502');
    expect(screen.getByTestId('aud02-error-reqid').textContent).toContain('7c1e94d2b08a');
    expect(screen.queryByTestId('aud02-detail')).toBeNull();
  });

  it('a missing request id is stated, not left blank', async () => {
    renderPage({ api: makeApi({ ok: false, status: 500 }) });
    await screen.findByTestId('aud02-error');
    expect(screen.getByTestId('aud02-error-reqid').textContent).toContain('未提供');
  });

  it('the loading skeleton shows no reading at all', async () => {
    const api = makeApi();
    (api.getEvent as Mock).mockReturnValue(new Promise(() => undefined));
    renderPage({ api });
    const skel = screen.getByRole('status', { name: '审计事件详情加载中' });
    expect(skel.textContent).toContain('超过约 10 秒');
    expect(skel.textContent).not.toContain(EVENT_ID);
    expect(skel.querySelector('.pill')).toBeNull();
  });

  it('an empty event id is the 400 variant, and nothing is requested', async () => {
    const api = makeApi();
    render(
      <MemoryRouter initialEntries={['/agent/audit/']}>
        <Routes>
          <Route path="/agent/audit/" element={<AuditDetailPage api={api} />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByTestId('aud02-error');
    expect(screen.getByTestId('aud02-error').textContent).toContain('这条链接少了事件编号');
    expect(api.getEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- behaviour

describe('AUD-02 — read discipline', () => {
  it('reads once and never polls; 「重新读取」 is the only re-read', async () => {
    const api = makeApi();
    renderPage({ api });
    await waitReady();
    expect(api.getEvent).toHaveBeenCalledTimes(1);
    expect(api.getEvent).toHaveBeenCalledWith(EVENT_ID);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(api.getEvent).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByTestId('aud02-reload'));
      await Promise.resolve();
    });
    expect(api.getEvent).toHaveBeenCalledTimes(2);
  });

  it('「复制链接」 puts the page address on the clipboard', async () => {
    window.history.replaceState(null, '', `/agent/audit/${EVENT_ID}`);
    renderPage();
    await waitReady();
    fireEvent.click(screen.getByTestId('aud02-copy-link'));
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    expect(String((navigator.clipboard.writeText as Mock).mock.calls[0][0])).toContain(
      '/agent/audit/',
    );
  });

  it('the header only offers read actions', async () => {
    renderPage();
    await waitReady();
    const header = screen.getByTestId('aud02-h1').closest('.phead') as HTMLElement;
    const labels = Array.from(header.querySelectorAll('.acts button')).map((b) => b.textContent);
    expect(labels).toEqual(['重新读取', '复制链接']);
  });

  it('upstream free text is rendered as text, never as markup', async () => {
    const evil = '<img src=x onerror=alert(1)>&"\'';
    renderPage({
      api: makeApi({ ok: true, event: failureEvent({ error: { code: 'x', messageRedacted: evil } }) }),
    });
    await waitReady();
    expect(screen.getByTestId('aud02-error-message').textContent).toContain(evil);
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});

// ---------------------------------------------------------------- 375 contract

describe('AUD-02 — 375 responsive contract (E12)', () => {
  const css = readFileSync(resolve(__dirname, '../aud02.css'), 'utf8');

  it('scopes every rule under the page root so nothing leaks', () => {
    const bare = css
      .split('\n')
      .filter((line) => /^\.[a-z]/.test(line.trim()) && !line.includes('.agent-app'));
    expect(bare).toEqual([]);
    expect(css).toContain('.agent-app .lk.aud02 .flow');
    expect(css).toContain('max-width: 1080px');
  });

  it('carries the three breakpoints the reference defines', () => {
    expect(css).toContain('@media (max-width: 1279px)');
    expect(css).toContain('@media (max-width: 767px)');
    expect(css).toContain('@media (max-width: 479px)');
    expect(css).toContain('.hf {');
    expect(css).toContain('flex: 1 1 50%'); // two columns on narrow screens
    expect(css).toContain('flex: 1 1 100%'); // one column under 480
  });

  it('stacks the chain on 375 and keeps both chevrons in the DOM', async () => {
    renderPage();
    await waitReady();
    // The chevron is rotated by CSS (not swapped), so the markup stays one icon
    // per connector — 375 simply turns them downwards.
    const links = screen.getByTestId('aud02-chain3').querySelectorAll('.clink');
    expect(links).toHaveLength(2);
    // Each connector carries both chevrons and 375 simply shows the other one.
    expect(links[0].querySelector('.i-r')).toBeTruthy();
    expect(links[0].querySelector('.i-d')).toBeTruthy();
    expect(css).toContain('flex-direction: column');
    expect(css).toContain('.clink .i-d');
  });

  it('wraps long values instead of clipping them', () => {
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('white-space: pre');
  });
});

// ---------------------------------------------------------------- AUD-01 wiring

describe('AUD-01 row → AUD-02 (the disabled entry is gone)', () => {
  /** The row needs the real dictionary the page receives from i18next. */
  const dict = zhHans as Record<string, unknown>;
  const tRow = ((key: string, opts?: Record<string, unknown>): string => {
    const value = key
      .split('.')
      .reduce<unknown>(
        (acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined),
        dict,
      );
    let text = typeof value === 'string' ? value : key;
    if (opts) for (const [k, v] of Object.entries(opts)) text = text.split(`{{${k}}}`).join(String(v));
    return text;
  }) as never;

  it('「打开详情」 is a real link to /agent/audit/:eventId, not a disabled button', () => {
    render(
      <table>
        <tbody>
          <AuditEventRow event={event()} t={tRow} />
        </tbody>
      </table>,
    );
    fireEvent.click(screen.getByTestId(`aud01-more-${EVENT_ID}`));
    const open = screen.getByTestId(`aud01-open-detail-${EVENT_ID}`);
    expect(open.tagName).toBe('A');
    expect(open.getAttribute('href')).toBe(`/agent/audit/${encodeURIComponent(EVENT_ID)}`);
    expect(open.getAttribute('aria-disabled')).toBeNull();
  });

  it('the task jump stays wired to TSK-02 (S3 not regressed)', () => {
    render(
      <table>
        <tbody>
          <AuditEventRow event={event()} t={tRow} />
        </tbody>
      </table>,
    );
    expect(screen.getByTestId(`aud01-task-jump-${EVENT_ID}`).getAttribute('href')).toBe(
      `/agent/tasks/${encodeURIComponent(TASK_ID)}`,
    );
  });
});

// ---------------------------------------------------- numeric schemaVersion (QA-1)

describe('AUD-02 — numeric schemaVersion tolerance (BFF A4 returns a number)', () => {
  it('schemaLabel maps 1 and 0 to chips, and keeps the neutral empty for blanks', () => {
    expect(schemaLabel(1)).toBe('v1');
    expect(schemaLabel(0)).toBe('v0');
    expect(schemaLabel('v1')).toBe('v1');
    expect(schemaLabel('1')).toBe('v1');
    expect(schemaLabel(null)).toBe('');
    expect(schemaLabel(undefined)).toBe('');
    expect(schemaLabel('  ')).toBe('');
  });

  it('the detail page renders a numeric schemaVersion without crashing', async () => {
    renderPage({ api: makeApi({ ok: true, event: event({ schemaVersion: 1 }) }) });
    await waitReady();
    expect(screen.getByTestId('aud02-detail')).toBeTruthy();
    expect(document.body.textContent).not.toContain('该页加载失败');
  });

  it('the integrity card still shows v1 for a numeric schemaVersion', async () => {
    renderPage({ api: makeApi({ ok: true, event: event({ schemaVersion: 1 }) }) });
    await waitReady();
    const card = screen.getByTestId('aud02-card-integrity');
    expect(card.textContent).toContain('v1');
  });

  it('a list row tolerates a numeric schemaVersion', () => {
    const tRow = (key: string) => key;
    render(
      <table>
        <tbody>
          <AuditEventRow event={event({ schemaVersion: 1 })} t={tRow} />
        </tbody>
      </table>,
    );
    expect(screen.getByTestId(`aud01-row-${EVENT_ID}`)).toBeTruthy();
  });

  it('the 404 screen keeps its retry button and request id (E11)', async () => {
    const api = makeApi({ ok: false, status: 404, requestId: 'req-e11-404' });
    renderPage({ api });
    await screen.findByTestId('aud02-forbidden');
    const retry = screen.getByTestId('aud02-forbidden-retry');
    expect(retry.tagName).toBe('BUTTON');
    expect(screen.getByTestId('aud02-forbidden-reqid').textContent).toContain('req-e11-404');
    fireEvent.click(retry);
    await waitFor(() => expect(api.getEvent).toHaveBeenCalledTimes(2));
  });
});

// ------------------------------------------- L4p4 identity + type closeout

describe('AUD-02 identity closeout — machine casing, tenant and honest links', () => {
  it('renders uppercase enums as Chinese words', async () => {
    const api = makeApi({
      ok: true,
      event: event({
        sourceSystem: 'CHANNEL',
        decision: 'APPROVED',
        outcome: 'SUCCESS',
        resource: { type: 'EMPLOYEE', id: EMP },
      }),
    });
    renderPage({ api });
    await waitReady();
    const body = screen.getByTestId('aud02-detail').textContent ?? '';
    expect(body).toContain('渠道');
    expect(body).toContain('已批准');
    expect(body).toContain('成功');
    expect(body).toContain('员工');
    // the machine word for the resource type must never reach the screen
    expect(body).not.toContain('EMPLOYEE');
  });

  it('keeps the tenant as a labelled mono value, full length, never trimmed', async () => {
    const api = makeApi({ ok: true, event: event({ tenantId: 't_seakoi_pilot_extended' }) });
    renderPage({ api });
    await waitReady();
    const tenant = screen.getByTestId('aud02-tenant');
    expect(tenant.textContent).toBe('t_seakoi_pilot_extended');
    expect(tenant.className.split(/\s+/)).toContain('v');
    expect(tenant.getAttribute('title')).toBe('t_seakoi_pilot_extended');
    const cell = tenant.closest('.hf');
    expect(cell).not.toBeNull();
    expect(cell?.textContent).toContain('租户');
  });

  it('shows the task jump only for a real task id', async () => {
    const api = makeApi({ ok: true, event: event({ taskId: undefined }) });
    renderPage({ api });
    await waitReady();
    expect(screen.queryByTestId('aud02-link-taskId')).toBeNull();
    expect(screen.queryByTestId('aud02-ref-taskId')).toBeNull();
    cleanup();

    const blank = makeApi({ ok: true, event: event({ taskId: '   ' }) });
    renderPage({ api: blank });
    await waitReady();
    expect(screen.queryByTestId('aud02-link-taskId')).toBeNull();
    expect(screen.queryByTestId('aud02-ref-taskId')).toBeNull();
  });

  it('says 未提供 when a 404 arrives without a request id', async () => {
    const api = makeApi({ ok: false, status: 404 });
    renderPage({ api });
    await screen.findByTestId('aud02-forbidden');
    expect(screen.getByTestId('aud02-status-code').getAttribute('aria-label')).toContain('404');
    expect(screen.getByTestId('aud02-forbidden-reqid').textContent).toContain('未提供');
    expect(screen.getByTestId('aud02-forbidden-retry')).toBeTruthy();
  });

  it('survives a numeric actor id without throwing', async () => {
    const api = makeApi({
      ok: true,
      event: event({
        actor: { type: 'employee', id: 42 as unknown as string, displayName: undefined },
      }),
    });
    renderPage({ api });
    await waitReady();
    expect(screen.getByTestId('aud02-f-actor').textContent).toContain('员工');
  });
});

// ------------------------------------------------ R1: D1–D4 + header closeout

describe('AUD-02 R1 — type+short ids, neutral placeholders, plain header', () => {
  it('prints 「事件 · 短码」 for the event id and 「岗位版本 · 短码」 for the version ref', async () => {
    renderPage();
    await waitReady();
    const idCell = screen.getByTestId('aud02-event-id');
    expect(idCell.textContent).toContain('事件 ·');
    expect(idCell.textContent).not.toContain('ev_01M7DF41');
    expect(idCell.getAttribute('title')).toBe(EVENT_ID);
    const version = screen.getByTestId('aud02-ref-employeeVersionRef');
    expect(version.textContent).toContain('岗位版本');
    expect(version.textContent).toContain('X3Z5');
    expect(version.textContent).not.toContain('empv_01M7DF3Z');
  });

  it('reads a seed owner as 「未指派」 while keeping the raw value in title', async () => {
    const api = makeApi({
      ok: true,
      event: event({ responsibleHumanId: 'pilot_owner_placeholder' }),
    });
    renderPage({ api });
    await waitReady();
    const cell = screen.getByTestId('aud02-f-responsible');
    expect(cell.textContent).toContain('未指派');
    expect(cell.textContent).not.toContain('pilot_owner_placeholder');
    expect(cell.querySelector('[title="pilot_owner_placeholder"]')).not.toBeNull();
  });

  it('keeps the detail header free of endpoints and contract codes', async () => {
    renderPage();
    await waitReady();
    const page = screen.getByTestId('agent-v2-page-audit-detail').textContent ?? '';
    expect(page).not.toContain('GET /api');
    expect(page).not.toContain('A4');
    expect(page).not.toContain('A7');
  });
});

// ------------------------------------------- R2: 404 wording + no dash in 判定

describe('AUD-02 R2 — 404 copy and the no-dash rule inside 判定', () => {
  it('404 offers 「再读一次」, never the permission wording', async () => {
    renderPage({ api: makeApi({ ok: false, status: 404, requestId: 'req-404b' }) });
    await screen.findByTestId('aud02-forbidden');
    const retry = screen.getByTestId('aud02-forbidden-retry').textContent ?? '';
    expect(retry).toContain('再读一次');
    expect(retry).not.toContain('已开通');
    expect(screen.getByTestId('aud02-forbidden').textContent).not.toContain('查看权限');
  });

  it('403 keeps the permission wording and its own retry label', async () => {
    renderPage({ api: makeApi({ ok: false, status: 403, requestId: 'req-403b' }) });
    await screen.findByTestId('aud02-forbidden');
    expect(screen.getByTestId('aud02-forbidden-retry').textContent).toContain('已开通');
  });

  it('an unreadable time inside 判定 says 「未记录」, and the card prints no dash', async () => {
    renderPage({
      api: makeApi({
        ok: true,
        event: event({ occurredAt: 'not-a-date', recordedAt: '' }),
      }),
    });
    await waitReady();
    expect(screen.getByTestId('aud02-occurred-missing').textContent).toBe('未记录');
    expect(screen.getByTestId('aud02-recorded-missing').textContent).toBe('未记录');
    // The value blocks carry the word, not a dash, and no arrival gap is
    // claimed when one of the two times is unreadable.
    for (const id of ['aud02-f-occurred', 'aud02-f-recorded', 'aud02-f-decision']) {
      expect(screen.getByTestId(id).querySelector('.v')?.textContent ?? '').not.toContain('—');
    }
    expect(screen.getByTestId('aud02-gap').textContent).not.toContain('相差');
  });
});
