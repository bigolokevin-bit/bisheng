/* eslint-disable no-restricted-syntax -- fixtures are the real captures and assertions the real zh-Hans copy (P0-5 lesson: copy the capture verbatim) */
/**
 * P0-6 v2-4: 「运行与追踪」 section (R5 run list + R3 event timeline) rendered
 * through the real page shell with the real zh-Hans resources.
 *
 * Fixtures are copied VERBATIM from
 * openspec/changes/l4-console-v2-trace/evidence/
 *   r5-runs.json   → RUN (all 20 captured fields, camelCase is law)
 *   r3-page1.json  → PAGE1 (limit=2 page: seq 1..2, nextSeq 2, hasMore true)
 *   r3-page2.json  → PAGE2 (sinceSeq=2 page: seq 3..5, nextSeq 5, hasMore false)
 *   r3-events.json → ALL_EVENTS (the whole stream)
 * The pilot tenant has no tool_call/tool_result events (design.md 风险与裁定),
 * so the pairing fixtures use the contract payload shape {stepSeq, toolName}.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@/components/bs-ui/message', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('react-i18next', async () => {
  const mod = (await import('../../../../public/locales/zh-Hans/bs.json')) as {
    default: Record<string, unknown>;
  };
  const dict = mod.default;
  const t = (key: unknown, def?: unknown): string => {
    const value = String(key)
      .split('.')
      .reduce<unknown>(
        (acc, part) =>
          acc && typeof acc === 'object'
            ? (acc as Record<string, unknown>)[part]
            : undefined,
        dict,
      );
    if (typeof value === 'string') return value;
    if (typeof def === 'string') return def;
    return String(key);
  };
  return { useTranslation: () => ({ t }) };
});

import { AgentConsoleV2Page } from '../AgentConsoleV2Page';
import { userContext } from '@/contexts/userContext';
import type {
  AgentConsoleRunsApi,
  Run,
  RunEvent,
  RunEventList,
} from '@/controllers/API/agentConsoleRuns';

// ---------------------------------------------------------------- fixtures

/** evidence/r5-runs.json → items[0], verbatim. */
const RUN: Run = {
  runId: 'rn_01M7822XN781D2S9JASH5TX1XZ',
  tenantId: 't_seakoi_pilot',
  employeeId: 'emp_9F42AAE299D541FBBB6ECE3671',
  employeeVersionNo: 1,
  policySnapshotRef: 'pol_dev_pilot',
  upstreamRunId: 'run_4b0c801e2cd14e40ab9e998fabb61dae',
  channelEventId: null,
  taskId: null,
  previousRunId: null,
  attemptNo: 1,
  status: 'completed',
  reasonCode: 'run.upstream_completed',
  budgetCapUsd: 10.0,
  costUsd: 0.009875,
  costStatus: 'upstream',
  startedAt: '2026-11-12T14:20:16.457Z',
  endedAt: '2026-11-12T14:21:29.951Z',
  lastEventSeq: 5,
  createdAt: '2026-11-12T14:20:16.457Z',
  updatedAt: '2026-11-12T14:21:29.951Z',
};

const EMP = {
  employeeId: RUN.employeeId,
  id: RUN.employeeId,
  tenantId: RUN.tenantId,
  name: 'Koi Claw',
  title: 'assistant',
  lifecycleState: 'active',
  currentVersionId: 'ver_1',
  ownerUserId: 'opsadmin',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-11-13T00:00:00Z',
};

const PULLED = '2026-11-12T14:21:29.951Z';

/** evidence/r3-page1.json — verbatim. */
const PAGE1: RunEventList = {
  items: [
    {
      runId: 'rn_01M7822XN781D2S9JASH5TX1XZ',
      seq: 1,
      eventType: 'message',
      payload: {
        delta: '我',
        event: 'message.delta',
        run_id: 'run_4b0c801e2cd14e40ab9e998fabb61dae',
        seq: 0,
        timestamp: 1794493219.081192,
        upstreamEvent: 'message.delta',
        upstreamSeq: 0,
      },
      occurredAt: '2026-11-12T14:20:19.081Z',
      pulledAt: '2026-11-12T14:21:29.951Z',
    },
    {
      runId: 'rn_01M7822XN781D2S9JASH5TX1XZ',
      seq: 2,
      eventType: 'message',
      payload: {
        delta: '收到的模型',
        event: 'message.delta',
        run_id: 'run_4b0c801e2cd14e40ab9e998fabb61dae',
        seq: 1,
        timestamp: 1794493219.110207,
        upstreamEvent: 'message.delta',
        upstreamSeq: 1,
      },
      occurredAt: '2026-11-12T14:20:19.110Z',
      pulledAt: '2026-11-12T14:21:29.951Z',
    },
  ],
  nextSeq: 2,
  hasMore: true,
};

/** evidence/r3-page2.json — verbatim. */
const PAGE2: RunEventList = {
  items: [
    {
      runId: 'rn_01M7822XN781D2S9JASH5TX1XZ',
      seq: 3,
      eventType: 'message',
      payload: {
        delta: '是 qwen',
        event: 'message.delta',
        run_id: 'run_4b0c801e2cd14e40ab9e998fabb61dae',
        seq: 2,
        timestamp: 1794493219.1669781,
        upstreamEvent: 'message.delta',
        upstreamSeq: 2,
      },
      occurredAt: '2026-11-12T14:20:19.166Z',
      pulledAt: '2026-11-12T14:21:29.951Z',
    },
    {
      runId: 'rn_01M7822XN781D2S9JASH5TX1XZ',
      seq: 4,
      eventType: 'message',
      payload: {
        delta: '-plus。',
        event: 'message.delta',
        run_id: 'run_4b0c801e2cd14e40ab9e998fabb61dae',
        seq: 3,
        timestamp: 1794493219.232705,
        upstreamEvent: 'message.delta',
        upstreamSeq: 3,
      },
      occurredAt: '2026-11-12T14:20:19.232Z',
      pulledAt: '2026-11-12T14:21:29.951Z',
    },
    {
      runId: 'rn_01M7822XN781D2S9JASH5TX1XZ',
      seq: 5,
      eventType: 'completed',
      payload: {
        completed: true,
        event: 'run.completed',
        interrupted: false,
        output: '我收到的模型是 qwen-plus。',
        partial: false,
        reasonCode: 'run.upstream_completed',
        run_id: 'run_4b0c801e2cd14e40ab9e998fabb61dae',
        runtime: { model: '', provider: '', route_source: 'global' },
        seq: 4,
        timestamp: 1794493219.588205,
        upstreamEvent: 'run.completed',
        upstreamSeq: 4,
        usage: { input_tokens: 12290, output_tokens: 9, total_tokens: 12299 },
      },
      occurredAt: '2026-11-12T14:20:19.588Z',
      pulledAt: '2026-11-12T14:21:29.951Z',
    },
  ],
  nextSeq: 5,
  hasMore: false,
};

/** evidence/r3-events.json — the whole stream in one page (hasMore false). */
const ALL_EVENTS: RunEventList = {
  items: [...PAGE1.items, ...PAGE2.items],
  nextSeq: 5,
  hasMore: false,
};

// contract-shape tool fixtures (see header note)
function ev(runId: string, seq: number, eventType: string, payload: Record<string, unknown>): RunEvent {
  return {
    runId,
    seq,
    eventType,
    payload,
    occurredAt: `2026-11-12T14:20:2${seq % 10}.000Z`,
    pulledAt: PULLED,
  };
}

/** settled (step 1) + pending (step 2) pairing over one run. */
const TOOL_RUN: Run = { ...RUN, runId: 'rn_TOOLSFIXTURE0000000001A', lastEventSeq: 4 };
const TOOL_EVENTS: RunEventList = {
  items: [
    ev(TOOL_RUN.runId, 1, 'tool_call', { stepSeq: 1, toolName: 'search', args: { q: 'pilot' } }),
    ev(TOOL_RUN.runId, 2, 'tool_result', { stepSeq: 1, toolName: 'search', ok: true }),
    ev(TOOL_RUN.runId, 3, 'tool_call', { stepSeq: 2, toolName: 'web_fetch', args: { url: 'https://h1ee.cn' } }),
    ev(TOOL_RUN.runId, 4, 'completed', { completed: true, reasonCode: 'run.upstream_completed' }),
  ],
  nextSeq: 4,
  hasMore: false,
};

/** duplicate-call + orphan-result + post-terminal over one run. */
const ANOM_RUN: Run = {
  ...RUN,
  runId: 'rn_ANOMALYFIXTURE0000000002B',
  status: 'interrupted',
  costStatus: null,
  costUsd: null,
  lastEventSeq: 5,
};
const ANOM_EVENTS: RunEventList = {
  items: [
    ev(ANOM_RUN.runId, 1, 'tool_call', { stepSeq: 1, toolName: 'search', args: { q: 'a' } }),
    ev(ANOM_RUN.runId, 2, 'tool_call', { stepSeq: 1, toolName: 'search', args: { q: 'a' } }),
    ev(ANOM_RUN.runId, 3, 'tool_result', { stepSeq: 3, toolName: 'notify', ok: true }),
    ev(ANOM_RUN.runId, 4, 'completed', { completed: true, reasonCode: 'run.upstream_completed' }),
    ev(ANOM_RUN.runId, 5, 'message', { delta: 'late output after terminal' }),
  ],
  nextSeq: 5,
  hasMore: false,
};

/** running, no endedAt, no cost: nothing may be fabricated. */
const RUNNING_RUN: Run = {
  ...RUN,
  runId: 'rn_RUNNINGFIXTURE000000003C',
  status: 'running',
  endedAt: null,
  costUsd: null,
  costStatus: null,
  lastEventSeq: 0,
};

/** completed run whose cost is an estimate. */
const EST_RUN: Run = { ...RUN, runId: 'rn_ESTIMATEFIXTURE00000004D', costStatus: 'estimated' };

/** run that reports zero events upstream. */
const NOEVENT_RUN: Run = { ...RUN, runId: 'rn_NOEVENTFIXTURE0000000005E', lastEventSeq: 0 };

// ---------------------------------------------------------------- helpers

const ok = <T,>(data: T) => ({ ok: true, status: 200, data });

type EventsSource = RunEventList | ((sinceSeq?: number) => RunEventList);

function makeRunsApi(opts: { runs?: Run[]; events?: Record<string, EventsSource> } = {}) {
  const listRuns = vi.fn().mockImplementation(async () => ok({ items: opts.runs ?? [RUN], nextCursor: null }));
  const listEvents = vi.fn().mockImplementation(async (p: { runId: string; sinceSeq?: number }) => {
    const src = opts.events?.[p.runId];
    if (!src) throw new Error(`no R3 fixture for ${p.runId}`);
    return ok(typeof src === 'function' ? src(p.sinceSeq) : src);
  });
  return { api: { listRuns, listEvents } as unknown as AgentConsoleRunsApi, listRuns, listEvents };
}

const consoleApi = {
  listEmployees: vi.fn().mockResolvedValue({ items: [EMP] }),
  countPendingApprovals: vi.fn().mockResolvedValue(ok({ count: 0 })),
  getEmployee: vi.fn().mockResolvedValue(ok(EMP)),
  getEffectiveConfig: vi.fn().mockResolvedValue(ok({ employee: EMP, grants: [] })),
  getWorkstations: vi.fn().mockResolvedValue(ok({ items: [] })),
} as never;

const approvalsApi = { listApprovals: vi.fn().mockResolvedValue({ items: [] }) } as never;

const trendsApi = {
  getRunStats: vi.fn().mockResolvedValue(ok({ buckets: [] })),
  getRunActivity: vi.fn().mockResolvedValue(ok({ cells: [] })),
  getBudgetUsage: vi.fn().mockResolvedValue(ok({ items: [] })),
} as never;

afterEach(() => {
  cleanup();
});

function mount(api: AgentConsoleRunsApi) {
  return render(
    <userContext.Provider
      value={{ user: { user_id: 1, web_menu: ['admin', 'agent'] }, setUser: vi.fn(), savedComponents: [], addSavedComponent: vi.fn(), checkComponentsName: vi.fn(), delComponent: vi.fn() } as never}
    >
      <AgentConsoleV2Page consoleApi={consoleApi} approvalsApi={approvalsApi} trendsApi={trendsApi} runsApi={api} />
    </userContext.Provider>,
  );
}

/** Rail entry (the surface must be reachable from the shell, not only mounted). */
async function openRuns(api: AgentConsoleRunsApi) {
  mount(api);
  await screen.findByText('Koi Claw');
  fireEvent.click(screen.getByLabelText('运行'));
  const section = await screen.findByTestId('agent-v2-runs');
  await waitFor(() => expect(section.textContent).not.toContain('加载中…'));
  return section;
}

async function openCard(runId: string, api: AgentConsoleRunsApi) {
  const section = await openRuns(api);
  const short = `${runId.slice(0, 4)}…${runId.slice(-4)}`;
  const id = await within(section).findByText(short);
  const card = id.closest('[data-testid="agent-v2-runs-card"]') as HTMLElement;
  fireEvent.click(within(card).getByTestId('agent-v2-runs-toggle'));
  // the R3 round-trip settles inside waitFor's act()
  await waitFor(() => expect(within(card).queryByTestId('agent-v2-ev-loading')).toBeNull());
  return card;
}

// ---------------------------------------------------------------- tests

describe('console v2 runs section (P0-6 v2-4)', () => {
  // (a) rail + run card fields
  it('rail ▶ opens the runs section and renders the captured run card fields', async () => {
    const section = await openRuns(makeRunsApi().api);
    const card = within(section).getByTestId('agent-v2-runs-card');
    // status pill: completed → is-ok with the reused contract label
    const pill = within(card).getByTestId('agent-v2-runs-status');
    expect(pill.textContent).toBe('已完成');
    expect(pill.className).toContain('is-ok');
    // mono truncated runId, full value only in title
    const id = within(card).getByTestId('agent-v2-runs-id');
    expect(id.textContent).toBe('rn_0…X1XZ');
    expect(id.getAttribute('title')).toBe(RUN.runId);
    expect(id.textContent).not.toContain(RUN.runId);
    // employee name from E11, MM-DD HH:mm via the slice(0,16) idiom
    expect(within(card).getByTestId('agent-v2-runs-employee').textContent).toBe('Koi Claw');
    expect(within(card).getByTestId('agent-v2-runs-time').textContent).toBe('2026-11-12 14:20');
    // 73.494s → 1m13s, cost kept verbatim (never re-rounded to 0.00)
    expect(within(card).getByTestId('agent-v2-runs-duration').textContent).toBe('1m13s');
    expect(within(card).getByTestId('agent-v2-runs-cost').textContent).toBe('0.009875');
    const costPill = within(card).getByTestId('agent-v2-runs-cost-status');
    expect(costPill.textContent).toBe('上游实测');
    expect(costPill.className).toContain('is-ok');
    // nothing leaks the tenant/policy internals as labels
    expect(within(section).queryByText('t_seakoi_pilot')).toBeNull();
  });

  it('a running run with no end and no cost renders 「—」 instead of a fabricated duration or pill', async () => {
    const section = await openRuns(makeRunsApi({ runs: [RUNNING_RUN] }).api);
    const card = within(section).getByTestId('agent-v2-runs-card');
    const pill = within(card).getByTestId('agent-v2-runs-status');
    expect(pill.textContent).toBe('运行中');
    expect(pill.className).toContain('is-warn');
    expect(within(card).getByTestId('agent-v2-runs-duration').textContent).toBe('—');
    expect(within(card).getByTestId('agent-v2-runs-cost').textContent).toBe('—');
    expect(within(card).getByTestId('agent-v2-runs-cost-status').textContent).toBe('—');
    expect(card.querySelectorAll('.a2-pill')).toHaveLength(1);
  });

  it('an estimated costStatus shows the warn pill', async () => {
    const section = await openRuns(makeRunsApi({ runs: [EST_RUN] }).api);
    const costPill = within(section).getByTestId('agent-v2-runs-cost-status');
    expect(costPill.textContent).toBe('估算');
    expect(costPill.className).toContain('is-warn');
  });

  it('logs loudly and renders raw for a status outside the contract six', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const odd = { ...RUN, runId: 'rn_ODDSTATUSFIXTURE00000006F', status: 'retired' } as unknown as Run;
    const section = await openRuns(makeRunsApi({ runs: [odd] }).api);
    expect(within(section).getByTestId('agent-v2-runs-status').textContent).toBe('retired');
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('unknown run status'), 'retired');
    errSpy.mockRestore();
  });

  // (b) request discipline
  it('always requests R5 with an ISO 近7天 since and limit 50 — never unconditionally', async () => {
    const { api, listRuns } = makeRunsApi();
    await openRuns(api);
    const isoRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(listRuns).toHaveBeenCalledWith(
      expect.objectContaining({ since: expect.stringMatching(isoRe), limit: 50 }),
    );
    // not a bare YYYY-MM-DD (upstream parses those as local midnight and had
    // been dropping today's runs in P0-5)
    for (const call of listRuns.mock.calls) {
      expect(typeof call[0].since).toBe('string');
      expect(call[0].since).toMatch(isoRe);
      expect(call[0].limit).toBe(50);
    }
    const since = listRuns.mock.calls[0][0].since as string;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    expect(Date.parse(since)).toBeLessThanOrEqual(todayStart.getTime());
    expect(Date.parse(since)).toBeGreaterThanOrEqual(todayStart.getTime() - 7 * 86400000);
  });

  it('the status segment narrows the query and keeps the since window', async () => {
    const { api, listRuns } = makeRunsApi({ runs: [] });
    const section = await openRuns(api);
    fireEvent.click(within(section).getByTestId('agent-v2-runs-status-failed'));
    await waitFor(() =>
      expect(listRuns).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'failed', limit: 50, since: expect.any(String) }),
      ),
    );
    expect(within(section).getByTestId('agent-v2-runs-status-failed').getAttribute('aria-pressed')).toBe('true');
    expect(within(section).getByTestId('agent-v2-runs-empty').textContent).toBe('所选范围内没有运行记录');
  });

  it('the employee select comes from E11 and narrows the query', async () => {
    const { api, listRuns } = makeRunsApi();
    const section = await openRuns(api);
    const select = within(section).getByTestId('agent-v2-runs-filter-employee') as HTMLSelectElement;
    expect(select.value).toBe('');
    fireEvent.change(select, { target: { value: EMP.employeeId } });
    await waitFor(() =>
      expect(listRuns).toHaveBeenLastCalledWith(
        expect.objectContaining({ employeeId: EMP.employeeId, since: expect.any(String) }),
      ),
    );
  });

  // (c) timeline from the real R3 capture
  it('expanding renders the captured stream ascending with message/completed rows', async () => {
    const { api, listEvents } = makeRunsApi({ events: { [RUN.runId]: ALL_EVENTS } });
    const card = await openCard(RUN.runId, api);
    const rows = within(card).getAllByTestId('agent-v2-ev-row');
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => within(r).getByTestId('agent-v2-ev-seq').textContent)).toEqual(['1', '2', '3', '4', '5']);
    expect(rows.map((r) => within(r).getByTestId('agent-v2-ev-type').textContent)).toEqual([
      'message',
      'message',
      'message',
      'message',
      'completed',
    ]);
    for (const r of rows) expect(within(r).getByTestId('agent-v2-ev-time').textContent).toBe('2026-11-12 14:20');
    expect(listEvents).toHaveBeenCalledWith({ runId: RUN.runId, limit: 50 });
    // the pilot stream has no tool events → no step rows are invented
    expect(within(card).queryByTestId('agent-v2-ev-steps')).toBeNull();
  });

  it('payload JSON is collapsed inside <details> and keeps the captured copy', async () => {
    const api = makeRunsApi({ events: { [RUN.runId]: ALL_EVENTS } }).api;
    const card = await openCard(RUN.runId, api);
    const details = within(card).getAllByTestId('agent-v2-ev-payload') as HTMLDetailsElement[];
    expect(details).toHaveLength(5);
    expect(details.every((d) => d.open === false)).toBe(true);
    expect(within(details[0]).getByText('数据')).toBeTruthy();
    expect(details[0].textContent).toContain('"delta": "我"');
    expect(details[4].textContent).toContain('"reasonCode": "run.upstream_completed"');
    expect(details[4].textContent).toContain('"total_tokens": 12299');
  });

  // (d) pagination
  it('加载更多 requests sinceSeq=nextSeq and merges both pages without dupes or gaps', async () => {
    const { api, listEvents } = makeRunsApi({
      events: { [RUN.runId]: (sinceSeq?: number) => (sinceSeq === undefined ? PAGE1 : PAGE2) },
    });
    const card = await openCard(RUN.runId, api);
    expect(within(card).getAllByTestId('agent-v2-ev-row')).toHaveLength(2);
    const more = within(card).getByTestId('agent-v2-ev-load-more');
    expect(more.textContent).toBe('加载更多');
    fireEvent.click(more);
    await waitFor(() => expect(within(card).getAllByTestId('agent-v2-ev-row')).toHaveLength(5));
    expect(listEvents).toHaveBeenNthCalledWith(2, { runId: RUN.runId, sinceSeq: 2, limit: 50 });
    const seqs = within(card)
      .getAllByTestId('agent-v2-ev-row')
      .map((r) => within(r).getByTestId('agent-v2-ev-seq').textContent);
    expect(seqs).toEqual(['1', '2', '3', '4', '5']);
    expect(new Set(seqs).size).toBe(5);
    // hasMore is false now: the affordance disappears, nothing is faked
    expect(within(card).queryByTestId('agent-v2-ev-load-more')).toBeNull();
  });

  it('a re-sent seq is merged once, never duplicated', async () => {
    const { api } = makeRunsApi({
      events: {
        [RUN.runId]: (sinceSeq?: number) =>
          sinceSeq === undefined ? PAGE1 : { items: [...PAGE1.items, ...PAGE2.items], nextSeq: 5, hasMore: false },
      },
    });
    const card = await openCard(RUN.runId, api);
    fireEvent.click(within(card).getByTestId('agent-v2-ev-load-more'));
    await waitFor(() => expect(within(card).getAllByTestId('agent-v2-ev-row')).toHaveLength(5));
    const seqs = within(card)
      .getAllByTestId('agent-v2-ev-row')
      .map((r) => within(r).getByTestId('agent-v2-ev-seq').textContent);
    expect(seqs).toEqual(['1', '2', '3', '4', '5']);
  });

  // (e) tool pairing display
  it('tool_call/tool_result pairs display settled and pending badges with the result seq', async () => {
    const api = makeRunsApi({ runs: [TOOL_RUN], events: { [TOOL_RUN.runId]: TOOL_EVENTS } }).api;
    const card = await openCard(TOOL_RUN.runId, api);
    const steps = within(card).getAllByTestId('agent-v2-ev-step');
    expect(steps).toHaveLength(2);
    expect(within(steps[0]).getByTestId('agent-v2-ev-step-state').textContent).toBe('已配对');
    expect(within(steps[0]).getByTestId('agent-v2-ev-step-state').className).toContain('is-ok');
    expect(within(steps[1]).getByTestId('agent-v2-ev-step-state').textContent).toBe('等待结果');
    expect(within(steps[1]).getByTestId('agent-v2-ev-step-state').className).toContain('is-warn');
    expect(within(steps[0]).getByText('search')).toBeTruthy();
    expect(within(steps[0]).getByText('#2')).toBeTruthy();
    expect(within(steps[1]).getByText('web_fetch')).toBeTruthy();
    expect(within(steps[1]).getByText('—')).toBeTruthy();
    expect(within(card).queryAllByTestId('agent-v2-ev-anomaly')).toHaveLength(0);
  });

  it('duplicate calls, orphan results and post-terminal events are badged, not dropped', async () => {
    const api = makeRunsApi({ runs: [ANOM_RUN], events: { [ANOM_RUN.runId]: ANOM_EVENTS } }).api;
    const card = await openCard(ANOM_RUN.runId, api);
    // every captured event stays on screen (5 rows), ascending
    expect(within(card).getAllByTestId('agent-v2-ev-row')).toHaveLength(5);
    const anomalies = within(card).getAllByTestId('agent-v2-ev-anomaly');
    expect(anomalies.map((a) => a.textContent)).toEqual(['重复调用', '无对应调用']);
    expect(within(card).getByTestId('agent-v2-ev-post-terminal').textContent).toBe('终态后事件');
    const steps = within(card).getAllByTestId('agent-v2-ev-step');
    expect(steps).toHaveLength(2);
    expect(within(steps[1]).getByTestId('agent-v2-ev-step-anomaly').textContent).toBe('重复调用');
    expect(within(card).getByTestId('agent-v2-ev-steps')).toBeTruthy();
  });

  // (f) empty / error states
  it('an empty run list renders the honest empty state and no cards', async () => {
    const section = await openRuns(makeRunsApi({ runs: [] }).api);
    expect(within(section).getByTestId('agent-v2-runs-empty').textContent).toBe('所选范围内没有运行记录');
    expect(within(section).queryAllByTestId('agent-v2-runs-card')).toHaveLength(0);
  });

  it('a run reporting lastEventSeq 0 says 这次运行没有事件 and asks for no events', async () => {
    const { api, listEvents } = makeRunsApi({ runs: [NOEVENT_RUN], events: {} });
    const card = await openCard(NOEVENT_RUN.runId, api);
    expect(within(card).getByTestId('agent-v2-ev-empty').textContent).toBe('这次运行没有事件');
    expect(listEvents).not.toHaveBeenCalled();
  });

  it('a nonzero lastEventSeq whose stream comes back empty also shows the empty state', async () => {
    const streamless = { ...RUN, runId: 'rn_EMPTYSTREAMFIXTURE00007G' };
    const api = makeRunsApi({
      runs: [streamless],
      events: { [streamless.runId]: { items: [], nextSeq: null, hasMore: false } },
    }).api;
    const card = await openCard(streamless.runId, api);
    expect(within(card).getByTestId('agent-v2-ev-empty').textContent).toBe('这次运行没有事件');
  });

  it('a failed runs query degrades to its own error block and 重试 refetches', async () => {
    const { api, listRuns } = makeRunsApi();
    listRuns.mockRejectedValueOnce(new Error('r5 down'));
    const section = await openRuns(api);
    expect(within(section).getByTestId('agent-v2-runs-error').textContent).toContain('运行记录加载失败');
    expect(within(section).queryByTestId('agent-v2-runs-empty')).toBeNull();
    expect(within(section).queryAllByTestId('agent-v2-runs-card')).toHaveLength(0);
    const callsBefore = listRuns.mock.calls.length;
    fireEvent.click(within(section).getByTestId('agent-v2-runs-retry'));
    await waitFor(() => expect(within(section).getAllByTestId('agent-v2-runs-card')).toHaveLength(1));
    expect(listRuns.mock.calls.length).toBe(callsBefore + 1);
    expect(listRuns.mock.calls[listRuns.mock.calls.length - 1][0].since).toEqual(expect.any(String));
  });

  it('a failed event stream errors only its own timeline and retries in place', async () => {
    const { api, listEvents } = makeRunsApi({ events: { [RUN.runId]: ALL_EVENTS } });
    listEvents.mockRejectedValueOnce(new Error('r3 down'));
    const card = await openCard(RUN.runId, api);
    expect(within(card).getByTestId('agent-v2-ev-error').textContent).toBe('事件流加载失败');
    expect(within(card).queryAllByTestId('agent-v2-ev-row')).toHaveLength(0);
    fireEvent.click(within(card).getByTestId('agent-v2-ev-retry'));
    await waitFor(() => expect(within(card).getAllByTestId('agent-v2-ev-row')).toHaveLength(5));
    expect(listEvents).toHaveBeenCalledTimes(2);
  });

  it('an unknown employeeId falls back to the raw id, never a guessed name', async () => {
    const foreign = { ...RUN, runId: 'rn_FOREIGNFIXTURE000000008H', employeeId: 'emp_DELETED000000000000000' };
    const section = await openRuns(makeRunsApi({ runs: [foreign] }).api);
    expect(within(section).getByTestId('agent-v2-runs-employee').textContent).toBe('emp_DELETED000000000000000');
  });

  // (g) detail entry point
  it('detail 「查看运行」 switches to the runs section prefiltered by that employee', async () => {
    const { api, listRuns } = makeRunsApi();
    mount(api);
    await screen.findByText('Koi Claw');
    fireEvent.click(screen.getAllByText('详情')[0]);
    const view = await screen.findByTestId('agent-v2-runs-view');
    fireEvent.click(view);
    const section = await screen.findByTestId('agent-v2-runs');
    await waitFor(() =>
      expect(listRuns).toHaveBeenCalledWith(
        expect.objectContaining({ employeeId: EMP.employeeId, since: expect.any(String), limit: 50 }),
      ),
    );
    // the preset is visible in the filter, not only in the request
    await waitFor(() =>
      expect((within(section).getByTestId('agent-v2-runs-filter-employee') as HTMLSelectElement).value).toBe(
        EMP.employeeId,
      ),
    );
    // still exactly one R5 request, and it carried the employee
    expect(listRuns).toHaveBeenCalledTimes(1);
  });
});
