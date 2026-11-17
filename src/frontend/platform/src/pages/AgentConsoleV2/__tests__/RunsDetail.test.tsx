/* eslint-disable no-restricted-syntax -- fixtures mirror the R2/R3 capture shape; assertions pin the real zh-Hans copy */
/**
 * RUN-02 `/agent/runs/:runId` — read-only run detail on the frozen C1
 * baseline (run02-target.html + RUN02-TARGET-SPEC.md).
 *
 * Covers the automatable RUN02-E01…E27 keys: header/meta/summary/governance,
 * cost four shapes, duration honesty, employee name resolution, the nine
 * trace derivation shapes (incl. the seq > terminalSeq negative case), gap
 * caliber, payload preservation, unknown/missing-tool labeling, count without
 * denominator, load-more page params, no-event = zero R3 request, five states
 * (403/404 same body), zero write entries, 2s polling + visibility pause,
 * 3-failure alert, terminal stop, late-response discard, and the 375 CSS
 * contract (jsdom cannot measure layout, so the responsive rules themselves
 * are asserted from runDetail.css).
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
          acc && typeof acc === 'object'
            ? (acc as Record<string, unknown>)[part]
            : undefined,
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
  return { useTranslation: () => ({ t }) };
});

import type { ApiResult } from '@/controllers/API/agent';
import type { AgentConsoleApi } from '@/controllers/API/agent';
import type {
  AgentConsoleRunsApi,
  Run,
  RunEvent,
  RunEventList,
} from '@/controllers/API/agentConsoleRuns';

import { RunDetailPage } from '../RunDetailPage';

// ---------------------------------------------------------------- fixtures

const RUN_ID = 'rn_01M7DEY86XMD8J2SJZES4TGPWJ';
const EMP_XIAOLI = 'emp_86A81CE8FF6F42E187BCF2B540';
const TENANT = 't_seakoi_pilot_secret';

function makeRun(over: Partial<Run> = {}): Run {
  return {
    runId: RUN_ID,
    tenantId: TENANT,
    employeeId: EMP_XIAOLI,
    employeeVersionNo: 12,
    policySnapshotRef: 'pss_9f2c1a77d4e04b86',
    upstreamRunId: 'run_4b0c801e2cd14e40ab9e998fabb61dae',
    channelEventId: 'om_c4d8e2f1a9b391ab',
    taskId: 'tk_01M7DEY7QK3T8V2W4X6Y8A0BCE',
    previousRunId: 'rn_01M7DEY5PLM3ZQ8RTVXW2N4JKL',
    attemptNo: 2,
    status: 'completed',
    reasonCode: 'run.upstream_completed',
    budgetCapUsd: 0.5,
    costUsd: 0.009875,
    costStatus: 'upstream',
    startedAt: '2026-11-16T08:52:10+08:00',
    endedAt: '2026-11-16T08:56:42+08:00',
    lastEventSeq: 12,
    createdAt: '2026-11-16T08:51:58+08:00',
    updatedAt: '2026-11-16T08:56:44+08:00',
    ...over,
  };
}

function ev(
  seq: number,
  eventType: string,
  payload: unknown,
  occurredAt: string,
  pulledAt: string,
): RunEvent {
  return {
    runId: RUN_ID,
    seq,
    eventType,
    payload: payload as Record<string, unknown>,
    occurredAt,
    pulledAt,
  };
}

const EVENTS: RunEvent[] = [
  ev(1, 'message', { delta: '您好，我来核对这笔订单', upstreamEvent: 'message.delta', upstreamSeq: 0 }, '2026-11-16T08:52:14.220+08:00', '2026-11-16T08:52:17.400+08:00'),
  ev(2, 'tool_call', { stepSeq: 2, toolName: 'order.read' }, '2026-11-16T08:52:41.004+08:00', '2026-11-16T08:52:43.000+08:00'),
  ev(3, 'tool_result', { stepSeq: 2, toolName: 'order.read' }, '2026-11-16T08:53:09.661+08:00', '2026-11-16T08:53:11.000+08:00'),
  ev(4, 'tool_call', { stepSeq: 4, toolName: 'crm.write' }, '2026-11-16T08:53:22.118+08:00', '2026-11-16T08:53:24.000+08:00'),
  ev(5, 'tool_result', { stepSeq: 4, toolName: 'crm.write' }, '2026-11-16T08:54:05.902+08:00', '2026-11-16T08:54:07.000+08:00'),
  ev(6, 'tool_call', { stepSeq: 4, toolName: 'crm.write' }, '2026-11-16T08:54:06.402+08:00', '2026-11-16T08:54:08.000+08:00'),
  ev(7, 'tool_result', { stepSeq: 7, toolName: 'price.read' }, '2026-11-16T08:54:19.301+08:00', '2026-11-16T08:54:21.000+08:00'),
  ev(8, 'tool_call', { stepSeq: 8, toolName: 'knowledge.search' }, '2026-11-16T08:54:44.002+08:00', '2026-11-16T08:54:46.000+08:00'),
  ev(9, 'tool_result', '[truncated upstream frame]', '2026-11-16T08:55:02.718+08:00', '2026-11-16T08:55:04.000+08:00'),
  ev(10, 'approval_requested', { event: 'approval.requested', upstreamEvent: 'approval.requested', upstreamSeq: 9, run_id: 'run_4b0c', seq: 9, timestamp: 1794493219.402 }, '2026-11-16T08:55:31.104+08:00', '2026-11-16T08:55:33.000+08:00'),
  ev(11, 'completed', { completed: true, interrupted: false, partial: false, output: '已核对完成', reasonCode: 'run.upstream_completed', usage: { input_tokens: 12290, output_tokens: 96, total_tokens: 12386 } }, '2026-11-16T08:56:42.004+08:00', '2026-11-16T08:56:45.300+08:00'),
  ev(12, 'tool_result', { stepSeq: 8, toolName: 'knowledge.search' }, '2026-11-16T08:57:10.588+08:00', '2026-11-16T08:58:12.551+08:00'),
];

function okEvents(items: RunEvent[] = EVENTS, nextSeq: number | null = 12, hasMore = false): ApiResult<RunEventList> {
  return { ok: true, status: 200, data: { items, nextSeq, hasMore } };
}

type MockedRunsApi = AgentConsoleRunsApi & {
  listRuns: Mock;
  listEvents: Mock;
  getRunDetail: Mock;
};

function makeApi(over: {
  run?: Run | ApiResult<Run>;
  events?: ApiResult<RunEventList>;
} = {}): MockedRunsApi {
  const detail: ApiResult<Run> =
    over.run && typeof over.run === 'object' && 'ok' in over.run
      ? over.run
      : { ok: true, status: 200, data: (over.run as Run) ?? makeRun() };
  return {
    listRuns: vi.fn(),
    getRunDetail: vi.fn().mockResolvedValue(detail),
    listEvents: vi.fn().mockResolvedValue(over.events ?? okEvents()),
  };
}

function makeConsoleApi(items: Array<{ employeeId: string; name: string }> = [{ employeeId: EMP_XIAOLI, name: '小鲤' }]) {
  return {
    listEmployees: vi.fn().mockResolvedValue({ items }),
  } as unknown as AgentConsoleApi;
}

function renderPage(api: AgentConsoleRunsApi, consoleApi: AgentConsoleApi = makeConsoleApi()) {
  return render(
    <MemoryRouter initialEntries={[`/agent/runs/${RUN_ID}`]}>
      <Routes>
        <Route path="/agent/runs/:runId" element={<RunDetailPage api={api} consoleApi={consoleApi} />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function waitReady() {
  await screen.findByTestId('agent-v2-rd-summary');
  // Settle the cosmetic E11 name lookup so no state update lands outside act.
  await act(async () => {
    await Promise.resolve();
  });
}

function clip(): Mock {
  return navigator.clipboard.writeText as unknown as Mock;
}

beforeEach(() => {
  window.history.replaceState(null, '', `/agent/runs/${RUN_ID}`);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------- header / summary

describe('RUN-02 — header, meta row and summary card', () => {
  it('E01/E02: back row, status pill, h1 (not the id), truncated id + full-value copy', async () => {
    const api = makeApi();
    renderPage(api);
    await waitReady();

    expect(screen.getByTestId('agent-v2-rd-back').textContent).toContain('返回运行列表');
    expect(screen.getByTestId('agent-v2-rd-status').textContent).toBe('已完成');

    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toContain('运行详情');
    expect(h1.textContent).not.toContain(RUN_ID);

    const idCell = screen.getByTestId('agent-v2-rd-id');
    expect(idCell.textContent).toContain('rn_01M7…GPWJ');
    expect(idCell.getAttribute('title')).toBe(RUN_ID);
    fireEvent.click(within(idCell).getByRole('button'));
    expect(clip()).toHaveBeenCalledWith(RUN_ID);

    fireEvent.click(screen.getByTestId('agent-v2-rd-copy-link'));
    await waitFor(() => expect(clip()).toHaveBeenCalledWith(window.location.href));
  });

  it('E03/E05: meta row carries freshness, poll state, seq and the read-only caliber', async () => {
    renderPage(makeApi());
    await waitReady();

    const fresh = screen.getByTestId('agent-v2-rd-fresh');
    expect(fresh.textContent).toContain('更新于');
    expect(screen.getByTestId('agent-v2-rd-poll').textContent).toBe('已结束 · 停止刷新');
    expect(screen.getByTestId('agent-v2-rd-seq').textContent).toBe('12');
    expect(fresh.textContent).toContain('只读详情，不提供中止、重跑、续跑与导出');
    /* Q2: no endpoints or run-phase codes on screen; only the human caliber. */
    expect(fresh.textContent).not.toContain('GET /api');
    expect(fresh.textContent).not.toContain('R2');
    expect(fresh.textContent).not.toContain('R3');
  });

  it('E07/E10: eight fields + wide governance; tenantId never reaches the DOM', async () => {
    renderPage(makeApi());
    await waitReady();

    expect(screen.getByTestId('agent-v2-rd-f-status').textContent).toContain('已完成');
    const employee = screen.getByTestId('agent-v2-rd-f-employee');
    expect(employee.textContent).toContain('小鲤');
    expect(employee.textContent).toContain('查看员工详情');
    expect(screen.getByTestId('agent-v2-rd-f-version').textContent).toContain('12');
    expect(screen.getByTestId('agent-v2-rd-f-duration').textContent).toContain('4m32s');
    expect(screen.getByTestId('agent-v2-rd-f-cost').textContent).toContain('0.009875');
    expect(screen.getByTestId('agent-v2-rd-f-cost').textContent).toContain('上游实测');
    expect(screen.getByTestId('agent-v2-rd-f-cap').textContent).toContain('0.5');
    expect(screen.getByTestId('agent-v2-rd-f-cap').textContent).toContain('2%');
    expect(screen.getByTestId('agent-v2-rd-f-start').textContent).toContain('11-16 08:52');
    expect(screen.getByTestId('agent-v2-rd-f-end').textContent).toContain('11-16 08:56');

    const gov = screen.getByTestId('agent-v2-rd-gov');
    /* Q2: the raw run id stays in the copy buffer/title, never as body text. */
    expect(gov.textContent).not.toContain(RUN_ID);
    expect(gov.textContent).toContain('…');
    expect(gov.textContent).toContain('run_4b0c…b61dae');
    expect(gov.textContent).toContain('pss_9f2…4b86');
    expect(gov.textContent).toContain('执行引擎侧 ID，对账用');
    expect(document.body.textContent).not.toContain(TENANT);
  });

  it('E11 → S2: a failed employee lookup degrades to 「员工 · 短码」 (never a bare emp_ id, never a fabricated name)', async () => {
    renderPage(makeApi(), {
      listEmployees: vi.fn().mockRejectedValue(new Error('offline')),
    } as unknown as AgentConsoleApi);
    await waitReady();
    const employee = screen.getByTestId('agent-v2-rd-f-employee');
    expect(employee.textContent).toContain('员工 · B540');
    expect(employee.textContent).not.toContain('emp_');
    expect(employee.textContent).not.toContain('小鲤');
  });

  it('E08: cost keeps the raw value, prints unknown literally and never shows USD 0.00', async () => {
    const unknown = makeApi({ run: makeRun({ costUsd: null, costStatus: 'unknown', endedAt: null }) });
    const first = renderPage(unknown);
    await waitReady();
    expect(screen.getByTestId('agent-v2-rd-f-cost').textContent).toContain('unknown');
    expect(document.body.textContent).not.toContain('USD 0.00');
    first.unmount();

    const missing = makeApi({ run: makeRun({ costUsd: undefined, costStatus: null }) });
    renderPage(missing);
    await waitReady();
    expect(screen.getByTestId('agent-v2-rd-f-cost').textContent).toContain('—尚无成本账目');
    cleanup();

    const mixed = makeApi({ run: makeRun({ costStatus: 'mixed' }) });
    renderPage(mixed);
    await waitReady();
    expect(screen.getByTestId('agent-v2-rd-f-cost').textContent).toContain('含估算');
    expect(screen.getByTestId('agent-v2-rd-f-cost').textContent).toContain('0.009875');
  });

  it('E09: a live run shows a local timer marked non-upstream, never a fabricated end', async () => {
    const api = makeApi({
      run: makeRun({ status: 'running', endedAt: null, costStatus: 'unknown', costUsd: null, lastEventSeq: 1, reasonCode: null }),
      events: okEvents([EVENTS[0]], 1, false),
    });
    renderPage(api);
    await waitReady();
    const duration = screen.getByTestId('agent-v2-rd-f-duration');
    expect(duration.textContent).toContain('进行中 · 本地计时');
    expect(duration.textContent).toContain('本地计时，非上游值');
    expect(screen.getByTestId('agent-v2-rd-f-end').textContent).toContain('未结束');
    expect(screen.getByTestId('agent-v2-rd-poll').textContent).toBe('运行中 · 每 2 秒刷新');
  });

  it('E17/E20/E21/E22: related card, read-only state machine and reason mapping', async () => {
    renderPage(makeApi());
    await waitReady();

    const rel = screen.getByTestId('agent-v2-rd-rel');
    expect(rel.textContent).toContain('来源消息');
    expect(rel.textContent).toContain('om_c4d…91ab');
    expect(rel.textContent).toContain('关联任务');
    expect(rel.textContent).toContain('上一轮');
    expect(rel.textContent).toContain('第 2 次');
    expect(rel.textContent).toContain('查看本次运行的审计事件');
    expect(rel.textContent).toContain('记录时间');
    expect(rel.textContent).toContain('续跑是新运行，不复活上一轮');

    const taskView = within(rel).getByTestId('agent-v2-rd-task-view');
    // S3: TSK-02 is live — the jump is a real link.
    expect(taskView.tagName).toBe('A');
    expect(taskView.getAttribute('href')).toBe('/agent/tasks/tk_01M7DEY7QK3T8V2W4X6Y8A0BCE');
    expect(within(rel).getByTestId('agent-v2-rd-audit').getAttribute('href')).toBe(
      `/agent/audit?runId=${encodeURIComponent(RUN_ID)}`,
    );
    expect(within(rel).getByTestId('agent-v2-rd-prev').getAttribute('href')).toBe(
      '/agent/runs/rn_01M7DEY5PLM3ZQ8RTVXW2N4JKL',
    );

    const sm = screen.getByTestId('agent-v2-rd-sm');
    const nodes = within(sm).getByTestId('agent-v2-rd-sm-nodes');
    const aria = nodes.querySelector('[role="img"]')?.getAttribute('aria-label') ?? '';
    expect(aria).toContain('当前为已完成');
    expect(sm.textContent).toContain('已完成（当前终态）');
    expect(sm.textContent).toContain('不能接着同一个运行恢复');
    expect(sm.textContent).toContain('状态机来自运行契约，不是本页读数');
    expect(within(sm).queryAllByRole('button')).toHaveLength(0);

    expect(screen.getByTestId('agent-v2-rd-reason').textContent).toBe('执行引擎报告完成');
    expect(screen.getByTestId('agent-v2-rd-reason').parentElement?.textContent).not.toContain(
      'run.upstream_completed',
    );
  });

  it('E20/E22: an unlisted reason is a human fallback, never the raw code; a terminal run without a code shows none', async () => {
    const api = makeApi({ run: makeRun({ reasonCode: 'run.mystery_code' }) });
    const first = renderPage(api);
    await waitReady();
    const reason = screen.getByTestId('agent-v2-rd-reason');
    expect(reason.textContent).toBe('原因码未收录');
    expect(reason.parentElement?.textContent).not.toContain('run.mystery_code');
    first.unmount();

    renderPage(makeApi({ run: makeRun({ reasonCode: null }) }));
    await waitReady();
    expect(screen.queryByTestId('agent-v2-rd-reason')).toBeNull();
  });

  it('E23: caliber card explains the three cost shapes and the derived ratio', async () => {
    renderPage(makeApi());
    await waitReady();
    const cal = screen.getByTestId('agent-v2-rd-caliber');
    expect(cal.textContent).toContain('上游实测');
    expect(cal.textContent).toContain('估算');
    expect(cal.textContent).toContain('unknown');
    expect(cal.textContent).toContain('尚无账目，成本未知；不显示 0');
    expect(cal.textContent).toContain('占上限 2% 由两者计算得出');
    expect(cal.textContent).toContain('步骤级成本没有读取通路');
  });
});

// ---------------------------------------------------------------- trace

describe('RUN-02 — trace derivation (runTrace.ts)', () => {
  it('E11/E12/E16: labels all nine derived shapes without swallowing any', async () => {
    renderPage(makeApi());
    await waitReady();

    const trace = screen.getByTestId('agent-v2-rd-trace');
    expect(trace.textContent).toContain('已加载 12 条事件 · 步骤 4 个');

    const rows = screen.getAllByTestId('agent-v2-rd-row');
    expect(rows).toHaveLength(10);

    const text = rows.map((r) => r.textContent ?? '');
    expect(text.some((r) => r.includes('已配对'))).toBe(true);
    expect(text.some((r) => r.includes('待结果'))).toBe(true);
    expect(text.some((r) => r.includes('重复调用'))).toBe(true);
    expect(text.some((r) => r.includes('孤立结果'))).toBe(true);
    expect(text.some((r) => r.includes('坏载荷'))).toBe(true);
    expect(text.some((r) => r.includes('终态后事件'))).toBe(true);
    expect(text.some((r) => r.includes('流内事件'))).toBe(true);
    expect(text.some((r) => r.includes('终态'))).toBe(true);
    expect(text.some((r) => r.includes('序号 12'))).toBe(true);
  });

  it('E12 negative: seq > terminalSeq keeps the fact and settles nothing (step 8 stays pending)', async () => {
    renderPage(makeApi());
    await waitReady();

    const knowledgeRows = screen
      .getAllByTestId('agent-v2-rd-row')
      .filter((r) => (r.textContent ?? '').includes('knowledge.search'));
    expect(knowledgeRows).toHaveLength(2);

    const step = knowledgeRows.find((r) => r.getAttribute('data-kind') === 'step');
    const after = knowledgeRows.find((r) => r.getAttribute('data-kind') === 'event');
    expect(step?.getAttribute('data-state')).toBe('pending');
    expect(step?.textContent).toContain('待结果');
    expect(step?.textContent).not.toContain('已配对');
    expect(step?.textContent).toContain('调用序号 8 · 结果序号 —');
    expect(after?.textContent).toContain('终态后事件');
    expect(after?.textContent).toContain('拉取滞后 +62.0s');
  });

  it('E15: gap is the event interval (labelled non-engine), first row shows none', async () => {
    renderPage(makeApi());
    await waitReady();

    const rows = screen.getAllByTestId('agent-v2-rd-row');
    expect(rows[0].textContent).not.toContain('+0.0s');
    expect(rows[0].textContent).not.toMatch(/\+\d+\.\d+s/);

    const paired = rows.find((r) => (r.textContent ?? '').includes('order.read'));
    const gap = within(paired as HTMLElement).getByText('+28.7s');
    expect(gap.getAttribute('title')).toBe('事件间隔，非引擎计量');
    expect(screen.getByTestId('agent-v2-rd-trace').textContent).toContain(
      '耗时列是事件间隔，非引擎计量',
    );
  });

  it('E14/E15: step detail hides step cost and interprets only stepSeq/toolName', async () => {
    renderPage(makeApi());
    await waitReady();
    const trace = screen.getByTestId('agent-v2-rd-trace');
    expect(trace.textContent).toContain('不显示（无单 run 成本明细通路）');
    expect(trace.textContent).toContain('只有「步骤序号」与「工具名」会被解释');
    expect(trace.textContent).not.toContain('意图识别');
    expect(trace.textContent).not.toContain('知识检索');
  });

  it('E15: bad payload is kept verbatim and 复制 JSON copies the original text', async () => {
    renderPage(makeApi());
    await waitReady();

    const bad = screen
      .getAllByTestId('agent-v2-rd-row')
      .find((r) => (r.textContent ?? '').includes('坏载荷'));
    expect(bad).toBeDefined();
    expect(within(bad as HTMLElement).getByText('[truncated upstream frame]')).toBeTruthy();

    const copyBtn = within(bad as HTMLElement).getByTestId('agent-v2-rd-copy-json');
    fireEvent.click(copyBtn);
    await waitFor(() => expect(clip()).toHaveBeenCalled());
    expect(clip().mock.calls.some((call) => call[0] === '[truncated upstream frame]')).toBe(true);
  });

  it('E15/E16: empty payload shows {}, unknown event type stays raw; missing toolName derives no step', async () => {
    const events = [
      ev(1, 'tool_call', {}, '2026-11-16T09:00:00.000+08:00', '2026-11-16T09:00:02.000+08:00'),
      ev(2, 'mystery.event', { foo: 'bar' }, '2026-11-16T09:00:05.000+08:00', '2026-11-16T09:00:06.000+08:00'),
    ];
    const api = makeApi({
      run: makeRun({ status: 'running', endedAt: null, lastEventSeq: 2, costStatus: 'unknown', costUsd: null, reasonCode: null }),
      events: okEvents(events, 2, false),
    });
    renderPage(api);
    await waitReady();

    const trace = screen.getByTestId('agent-v2-rd-trace');
    expect(trace.textContent).toContain('已加载 2 条事件 · 步骤 0 个');
    expect(trace.textContent).toContain('缺工具名');
    expect(trace.textContent).toContain('未知事件');
    expect(trace.textContent).toContain('mystery.event');
    expect(trace.textContent).toContain('{}');
  });

  it('E18: 加载更多 sends sinceSeq=nextSeq&limit=200 and de-duplicates by seq', async () => {
    const api = makeApi();
    api.listEvents
      .mockResolvedValueOnce(okEvents(EVENTS.slice(0, 10), 10, true))
      .mockResolvedValueOnce(okEvents(EVENTS, 12, false));
    renderPage(api);
    await waitReady();

    const more = await screen.findByTestId('agent-v2-rd-more');
    fireEvent.click(more);

    await waitFor(() => expect(api.listEvents).toHaveBeenCalledTimes(2));
    expect(api.listEvents.mock.calls[1][0]).toEqual({ runId: RUN_ID, sinceSeq: 10, limit: 200 });
    await waitFor(() =>
      expect(screen.getByTestId('agent-v2-rd-trace').textContent).toContain('已加载 12 条事件'),
    );
    const seqs = screen.getAllByTestId('agent-v2-rd-row').map((r) => r.textContent ?? '');
    expect(seqs.filter((r) => r.includes('序号 12'))).toHaveLength(1);
    expect(screen.queryByTestId('agent-v2-rd-more')).toBeNull();
  });

  it('E17: count has no denominator and the page has no total/pager copy', async () => {
    renderPage(makeApi());
    await waitReady();
    expect(screen.getByTestId('agent-v2-rd-trace').textContent).toContain('已加载 12 条事件 · 步骤 4 个');
    expect(document.body.textContent).not.toMatch(/共\s*\d+\s*条|页码|第\s*\d+\s*页/);
  });
});

// ---------------------------------------------------------------- empty state / states

describe('RUN-02 — no-event and failure states', () => {
  it('E13: lastEventSeq=0 makes zero R3 requests and shows the honest empty card', async () => {
    const api = makeApi({
      run: makeRun({
        status: 'pending',
        startedAt: '',
        endedAt: null,
        reasonCode: null,
        costUsd: null,
        costStatus: null,
        lastEventSeq: 0,
      }),
    });
    renderPage(api);
    await waitReady();

    expect(api.listEvents).not.toHaveBeenCalled();
    const empty = screen.getByTestId('agent-v2-rd-empty');
    expect(empty.textContent).toContain('这次运行没有事件');
    expect(empty.textContent).toContain('本页不会补出假步骤、也不会把它判成失败');
    expect(screen.getByTestId('agent-v2-rd-empty-retry').textContent).toContain('重新拉取');
    expect(screen.getByTestId('agent-v2-rd-fresh').textContent).not.toContain('未发起请求');
    const duration = screen.getByTestId('agent-v2-rd-f-duration');
    expect(duration.textContent).toContain('未开始，不编数字');
    expect(duration.textContent).toContain('—');
  });

  it('E24: 403 and 404 share one body, only the HTTP code differs (no existence leak)', async () => {
    const forbidden = makeApi({ run: { ok: false, status: 403, data: null, code: 'console.forbidden' } });
    const first = renderPage(forbidden);
    const card403 = await screen.findByTestId('agent-v2-rd-forbidden');
    const text403 = (card403.textContent ?? '').replace('HTTP 403', 'HTTP <code>');
    expect(text403).toContain('您还看不到这次运行');
    expect(text403).toContain('当前账号没有开通「运行」模块的查看权限');
    expect(document.body.textContent).not.toContain('console.forbidden');
    expect(forbidden.listEvents).not.toHaveBeenCalled();
    first.unmount();

    const missing = makeApi({ run: { ok: false, status: 404, data: null, code: 'run.not_found' } });
    renderPage(missing);
    const card404 = await screen.findByTestId('agent-v2-rd-forbidden');
    const text404 = (card404.textContent ?? '').replace('HTTP 404', 'HTTP <code>');
    expect(text404).toBe(text403);
    expect(document.body.textContent).not.toContain('run.not_found');
  });

  it('E24: a 5xx shows localized copy + HTTP code and retries the head only', async () => {
    const api = makeApi();
    api.getRunDetail
      .mockResolvedValueOnce({ ok: false, status: 500, data: null, code: 'agent.http.500' })
      .mockResolvedValueOnce({ ok: true, status: 200, data: makeRun() });
    renderPage(api);

    const stage = await screen.findByTestId('agent-v2-rd-error');
    expect(stage.textContent).toContain('运行详情没能加载出来');
    expect(stage.textContent).toContain('HTTP 500');
    expect(stage.textContent).toContain('没有展示上一次的缓存数据');
    expect(document.body.textContent).not.toContain('502 upstream');

    fireEvent.click(screen.getByTestId('agent-v2-rd-error-retry'));
    await waitReady();
    // Retry re-fetches the head; the terminal event then triggers exactly one
    // head refresh (spec §7 终止), so 2+ is the honest floor.
    expect(api.getRunDetail.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('E24: a network failure is localized (no raw browser error) and 400 skips the request', async () => {
    const api = makeApi();
    api.getRunDetail.mockRejectedValueOnce(new Error('Failed to fetch'));
    const first = renderPage(api);
    const stage = await screen.findByTestId('agent-v2-rd-error');
    expect(stage.textContent).toContain('网络不可达');
    expect(document.body.textContent).not.toContain('Failed to fetch');
    first.unmount();

    const offline = makeApi();
    cleanup();
    render(
      <MemoryRouter initialEntries={['/agent/runs/']}>
        <Routes>
          <Route path="/agent/runs" element={<RunDetailPage api={offline} consoleApi={makeConsoleApi()} />} />
        </Routes>
      </MemoryRouter>,
    );
    const missingStage = await screen.findByTestId('agent-v2-rd-error');
    expect(missingStage.textContent).toContain('HTTP 400');
    expect(missingStage.textContent).toContain('地址里的运行编号不完整');
    expect(offline.getRunDetail).not.toHaveBeenCalled();
  });

  it('E24/E29: the loading skeleton is static and never shows data placeholders', async () => {
    const api = makeApi();
    let release: (v: ApiResult<Run>) => void = () => undefined;
    api.getRunDetail.mockReturnValue(
      new Promise<ApiResult<Run>>((resolvePromise) => {
        release = resolvePromise;
      }),
    );
    renderPage(api);
    const loading = screen.getByTestId('agent-v2-rd-loading');
    expect(loading.textContent).toContain('首次加载不设固定超时假上限');
    expect(screen.queryByTestId('agent-v2-rd-summary')).toBeNull();
    release({ ok: true, status: 200, data: makeRun() });
    await waitReady();
  });
});

// ---------------------------------------------------------------- discipline guards

describe('RUN-02 — zero write entries and honest guards', () => {
  it('E04: no abort/rerun/resume/export/trigger control exists in the DOM', async () => {
    renderPage(makeApi());
    await waitReady();
    const controls = [
      ...screen.getAllByRole('button'),
      ...screen.getAllByRole('link'),
    ].filter((el) => el.getAttribute('aria-disabled') !== 'true' && !(el as HTMLButtonElement).disabled);
    const writeish = controls.filter((el) =>
      /重跑|中止|续跑|导出|手动触发|停止运行|删除|新建|批量|创建|批准|驳回|发送|编辑|保存|提交/.test(
        el.textContent ?? '',
      ),
    );
    expect(writeish).toHaveLength(0);
    expect(document.body.textContent).not.toContain('待接入');
  });

  it('E26/E27: a terminal run stops polling and a late response after unmount is discarded', async () => {
    const api = makeApi();
    const view = renderPage(api);
    await waitReady();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2200));
    });
    // Terminal head + terminal event: one initial read, one event page, one
    // post-terminal head refresh — then nothing (no 2s cadence for a terminal run).
    expect(api.listEvents).toHaveBeenCalledTimes(1);
    expect(api.getRunDetail).toHaveBeenCalledTimes(2);

    let release: (v: ApiResult<Run>) => void = () => undefined;
    const slow = makeApi();
    slow.getRunDetail.mockReturnValue(
      new Promise<ApiResult<Run>>((resolvePromise) => {
        release = resolvePromise;
      }),
    );
    view.unmount();
    cleanup();
    const second = renderPage(slow);
    second.unmount();
    release({ ok: true, status: 200, data: makeRun() });
    await act(async () => {
      await Promise.resolve();
    });
    expect(slow.listEvents).not.toHaveBeenCalled();
  });
});

describe('RUN-02 — polling cadence, visibility and the 3-failure alert', () => {
  const runningRun = makeRun({
    status: 'running',
    endedAt: null,
    costUsd: null,
    costStatus: 'unknown',
    reasonCode: null,
    lastEventSeq: 1,
  });
  const runningEvents = okEvents([EVENTS[0]], 1, false);

  it('E25: polls every 2s while running; hidden pauses and visible catches up', async () => {
    const api = makeApi({ run: runningRun, events: runningEvents });
    renderPage(api);
    await waitReady();
    await waitFor(() => expect(api.listEvents).toHaveBeenCalledTimes(1));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 2300));
    });
    expect(api.listEvents.mock.calls.length).toBeGreaterThanOrEqual(2);

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    const pausedCallCount = api.listEvents.mock.calls.length;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2300));
    });
    expect(api.listEvents.mock.calls.length).toBe(pausedCallCount);

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(api.listEvents.mock.calls.length).toBeGreaterThan(pausedCallCount);
  }, 15000);

  it('E25/E26: three consecutive failures show the alert without ever calling the run failed', async () => {
    vi.useFakeTimers();
    const api = makeApi({ run: runningRun, events: runningEvents });
    api.listEvents.mockResolvedValue({ ok: false, status: 500, data: null, code: 'agent.http.500' });
    renderPage(api);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('agent-v2-rd-status').textContent).toBe('运行中');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });

    const alert = screen.getByTestId('agent-v2-rd-alert');
    expect(alert.textContent).toContain('事件流暂时连不上');
    expect(alert.textContent).toContain('这不代表这次运行失败或结束');
    expect(screen.getByTestId('agent-v2-rd-status').textContent).toBe('运行中');
    expect(screen.getByTestId('agent-v2-rd-poll').textContent).toContain('连接中断，正在重试');
    expect(screen.getByTestId('agent-v2-rd-alert-retry').textContent).toContain('立即重试');
  });
});

// ---------------------------------------------------------------- responsive contract

describe('RUN-02 — 375 / theme contract (CSS level, jsdom cannot measure layout)', () => {
  const css = readFileSync(
    resolve(__dirname, '../runDetail.css'),
    'utf8',
  );

  it('E18/E26: split degrades to one column and HFieldRow to 2/1 columns at the breakpoints', () => {
    expect(css).toMatch(/@media \(max-width: 1279px\)[\s\S]*a2r-split[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*a2r-hf[\s\S]*flex: 1 1 50%/);
    expect(css).toMatch(/@media \(max-width: 419px\)[\s\S]*a2r-hf[\s\S]*flex: 1 1 100%/);
  });

  it('E18/E26: JSON blocks scroll inside their card (never the page) and rows wrap at 375', () => {
    expect(css).toMatch(/\.a2r-json[\s\S]*overflow-x: auto/);
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*a2r-nm[\s\S]*white-space: normal/);
    expect(css).not.toMatch(/100vw|width:\s*375px/);
  });

  it('E27: tokens only — no raw hex colors, no second theme block in this page', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/data-theme/);
  });
});