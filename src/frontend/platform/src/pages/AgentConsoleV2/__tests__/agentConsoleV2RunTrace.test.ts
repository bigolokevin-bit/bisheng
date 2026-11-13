/* eslint-disable no-restricted-syntax -- fixtures mirror the real R3 capture verbatim, Chinese deltas included */
/**
 * l4-console-v2-trace: pairing matrix for the build_run_trace TS port
 * + agentConsoleRuns BFF param serialization.
 *
 * Event fixtures use the real R3 field shape from
 * openspec/changes/l4-console-v2-trace/evidence/r3-events.json
 * ({runId, seq, eventType, payload, occurredAt, pulledAt}). The pilot run
 * carries only message/completed events, so tool_call/tool_result fixtures
 * follow the contract payload shape {stepSeq, toolName, ...} — expected.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHttpAgentConsoleRunsApi, type RunEvent } from '@/controllers/API/agentConsoleRuns';
import { buildRunTrace, TERMINAL_TRACE_EVENT_TYPES } from '@/pages/AgentConsoleV2/runTrace';

const RUN_ID = 'rn_01M7822XN781D2S9JASH5TX1XZ';

/** Real R3 row shape; payload typed loose so fail-soft fixtures can pass junk. */
function ev(
  seq: number,
  eventType: string,
  payload: unknown,
  over: Partial<RunEvent> = {},
): RunEvent {
  return {
    runId: RUN_ID,
    seq,
    eventType,
    payload: payload as RunEvent['payload'],
    occurredAt: `2026-11-12T14:20:0${seq}.000Z`,
    pulledAt: '2026-11-12T14:21:29.951Z',
    ...over,
  };
}

const call = (seq: number, stepSeq: unknown, toolName = 'search') =>
  ev(seq, 'tool_call', { stepSeq, toolName, args: { q: stepSeq } });
const result = (seq: number, stepSeq: unknown, toolName = 'search') =>
  ev(seq, 'tool_result', { stepSeq, toolName, ok: true });

/** evidence/r3-events.json verbatim (pilot run, seq 1..5). */
const R3_EVENTS: RunEvent[] = [
  ev(1, 'message', {
    delta: '我',
    event: 'message.delta',
    run_id: 'run_4b0c801e2cd14e40ab9e998fabb61dae',
    seq: 0,
    timestamp: 1794493219.081192,
    upstreamEvent: 'message.delta',
    upstreamSeq: 0,
  }, { occurredAt: '2026-11-12T14:20:19.081Z' }),
  ev(2, 'message', {
    delta: '收到的模型',
    event: 'message.delta',
    run_id: 'run_4b0c801e2cd14e40ab9e998fabb61dae',
    seq: 1,
    timestamp: 1794493219.110207,
    upstreamEvent: 'message.delta',
    upstreamSeq: 1,
  }, { occurredAt: '2026-11-12T14:20:19.110Z' }),
  ev(3, 'message', {
    delta: '是 qwen',
    event: 'message.delta',
    run_id: 'run_4b0c801e2cd14e40ab9e998fabb61dae',
    seq: 2,
    timestamp: 1794493219.1669781,
    upstreamEvent: 'message.delta',
    upstreamSeq: 2,
  }, { occurredAt: '2026-11-12T14:20:19.166Z' }),
  ev(4, 'message', {
    delta: '-plus。',
    event: 'message.delta',
    run_id: 'run_4b0c801e2cd14e40ab9e998fabb61dae',
    seq: 3,
    timestamp: 1794493219.232705,
    upstreamEvent: 'message.delta',
    upstreamSeq: 3,
  }, { occurredAt: '2026-11-12T14:20:19.232Z' }),
  ev(5, 'completed', {
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
  }, { occurredAt: '2026-11-12T14:20:19.588Z' }),
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildRunTrace pairing matrix', () => {
  it('settles a tool_call → tool_result pair keyed by (stepSeq, toolName)', () => {
    const trace = buildRunTrace([call(2, 1), result(3, 1)]);
    expect(trace.steps).toHaveLength(1);
    const step = trace.steps[0];
    expect(step).toMatchObject({
      stepSeq: 1,
      toolName: 'search',
      state: 'settled',
      resultSeq: 3,
      anomaly: null,
    });
    expect(step.callEvent.seq).toBe(2);
    expect(step.callEvent.role).toBe('call');
    expect(step.resultEvent?.seq).toBe(3);
    expect(step.resultEvent?.role).toBe('result');
    expect(trace.terminalSeq).toBeNull();
  });

  it('leaves an unanswered call pending without fabricating a result', () => {
    const trace = buildRunTrace([call(2, 1)]);
    expect(trace.steps).toHaveLength(1);
    expect(trace.steps[0]).toMatchObject({ state: 'pending', resultSeq: null, anomaly: null });
    expect(trace.steps[0].resultEvent).toBeNull();
  });

  it('flags the second call on an open key as duplicate-call; earliest owns the step', () => {
    const trace = buildRunTrace([call(2, 1), call(3, 1), result(4, 1)]);
    // Earliest owns settlement: exactly one step reaches settled, on call seq 2.
    const settled = trace.steps.filter((s) => s.state === 'settled');
    expect(settled).toHaveLength(1);
    expect(settled[0].callEvent.seq).toBe(2);
    expect(settled[0].resultSeq).toBe(4);
    // The later call is flagged on its event (and its own pending row).
    const dupEvent = trace.events.find((e) => e.seq === 3);
    expect(dupEvent?.anomaly).toBe('duplicate-call');
    const dupStep = trace.steps.find((s) => s.callEvent.seq === 3);
    expect(dupStep).toMatchObject({ state: 'pending', anomaly: 'duplicate-call' });
  });

  it('marks an unmatched result as orphan-result and derives no step', () => {
    const trace = buildRunTrace([result(2, 9, 'missing_tool')]);
    expect(trace.steps).toHaveLength(0);
    expect(trace.events[0].anomaly).toBe('orphan-result');
    expect(trace.events[0].role).toBe('result');
  });

  it('second result on a settled key is orphan-result and the first result persists', () => {
    const trace = buildRunTrace([call(1, 1), result(4, 1), result(6, 1)]);
    expect(trace.steps).toHaveLength(1);
    // trace.py pops the key on the first result: settlement is frozen.
    expect(trace.steps[0].resultSeq).toBe(4);
    expect(trace.steps[0].resultEvent?.seq).toBe(4);
    // The later result never overwrites — it orphans on its own event.
    expect(trace.events.find((e) => e.seq === 4)?.anomaly).toBeUndefined();
    expect(trace.events.find((e) => e.seq === 6)?.anomaly).toBe('orphan-result');
  });

  it('a call re-issued on a settled key is duplicate-call and never re-opens pairing', () => {
    const trace = buildRunTrace([call(1, 1), result(2, 1), call(3, 1), result(4, 1)]);
    // Exactly two rows: the settled call's step + the duplicate's pending step.
    expect(trace.steps).toHaveLength(2);
    expect(trace.steps.find((s) => s.callEvent.seq === 1)).toMatchObject({
      state: 'settled',
      resultSeq: 2,
    });
    const dup = trace.steps.find((s) => s.callEvent.seq === 3);
    expect(dup).toMatchObject({ state: 'pending', anomaly: 'duplicate-call' });
    expect(trace.events.find((e) => e.seq === 3)?.anomaly).toBe('duplicate-call');
    // The duplicate never enters openCalls: its result orphans as well.
    expect(trace.events.find((e) => e.seq === 4)?.anomaly).toBe('orphan-result');
  });

  it('keeps a tool event without toolName as a stream fact, deriving no step', () => {
    const trace = buildRunTrace([ev(3, 'tool_call', { stepSeq: 1, args: {} })]);
    expect(trace.steps).toHaveLength(0);
    expect(trace.events).toHaveLength(1);
    expect(trace.events[0].role).toBe('call');
    expect(trace.events[0].parsed).toBe(true);
  });

  it('overwrites terminalSeq with the later terminal', () => {
    const trace = buildRunTrace([
      ev(3, 'message', { delta: 'x' }),
      ev(5, 'completed', { completed: true }),
      ev(8, 'interrupted', { interrupted: true }),
    ]);
    expect(trace.terminalSeq).toBe(8);
    // The terminal rows themselves are never postTerminal.
    expect(trace.events.find((e) => e.seq === 5)?.postTerminal).toBeUndefined();
    expect(trace.events.find((e) => e.seq === 8)?.postTerminal).toBeUndefined();
    // Terminal vocabulary is complete:
    expect([...TERMINAL_TRACE_EVENT_TYPES].sort()).toEqual(
      ['cancelled', 'completed', 'failed', 'interrupted'],
    );
  });

  it('keeps events after the terminal flagged postTerminal and derives/mutates nothing', () => {
    const trace = buildRunTrace([
      call(2, 1), // opens step A (never settled)
      call(3, 2), // opens step B
      result(4, 2), // settles step B
      ev(5, 'completed', { completed: true }), // terminal at seq 5
      call(6, 3), // must NOT open step C
      result(7, 2), // must NOT re-mutate settled step B
    ]);
    expect(trace.terminalSeq).toBe(5);
    expect(trace.events.map((e) => e.seq)).toEqual([2, 3, 4, 5, 6, 7]);
    const ev6 = trace.events.find((e) => e.seq === 6);
    const ev7 = trace.events.find((e) => e.seq === 7);
    expect(ev6?.postTerminal).toBe(true);
    expect(ev7?.postTerminal).toBe(true);
    // No new steps, no mutation: still exactly steps A(pending) and B(settled at 4).
    expect(trace.steps).toHaveLength(2);
    expect(trace.steps.map((s) => s.stepSeq).sort()).toEqual([1, 2]);
    const stepB = trace.steps.find((s) => s.stepSeq === 2);
    expect(stepB).toMatchObject({ state: 'settled', resultSeq: 4 });
    expect(stepB?.resultEvent?.seq).toBe(4);
    // Post-terminal rows carry no derived pairing fields.
    expect(ev6?.stepSeq).toBeUndefined();
    expect(ev7?.anomaly).toBeUndefined();
  });

  it('treats terminalSeq as a strict lower bound: the terminal event itself stays pairable', () => {
    // seq ties keep stable input order: completed(seq 5) arrives first, then
    // a result at the same seq — 5 > 5 is false, so it still settles.
    const trace = buildRunTrace([call(2, 1), ev(5, 'completed', { completed: true }), result(5, 1)]);
    expect(trace.terminalSeq).toBe(5);
    expect(trace.steps[0]).toMatchObject({ state: 'settled', resultSeq: 5 });
    const resultEvent = trace.events.find((e) => e.seq === 5 && e.role === 'result');
    expect(resultEvent?.postTerminal).toBeUndefined();
  });

  it('falls back to the event seq when payload.stepSeq is missing, NaN, 0, or fractional', () => {
    const trace = buildRunTrace([
      ev(3, 'tool_call', { toolName: 'a' }), // missing → 3
      ev(4, 'tool_call', { stepSeq: 'abc', toolName: 'b' }), // NaN → 4
      ev(5, 'tool_call', { stepSeq: 0, toolName: 'c' }), // falsy → 5
      ev(6, 'tool_call', { stepSeq: 3.5, toolName: 'd' }), // non-integer → 6
    ]);
    expect(trace.steps.map((s) => s.stepSeq)).toEqual([3, 4, 5, 6]);
    expect(trace.events.map((e) => e.stepSeq)).toEqual([3, 4, 5, 6]);
  });

  it('fail-softs on a non-object payload: parsed=false, rawPayload kept, no step', () => {
    const trace = buildRunTrace([
      ev(2, 'tool_call', '{"stepSeq":1,"toolName":"broken"'), // bad JSON string
      ev(3, 'tool_call', 42), // scalar
    ]);
    expect(trace.steps).toHaveLength(0);
    const bad = trace.events.find((e) => e.seq === 2);
    expect(bad).toMatchObject({ parsed: false, payload: null });
    expect(bad?.rawPayload).toBe('{"stepSeq":1,"toolName":"broken"');
    const scalar = trace.events.find((e) => e.seq === 3);
    expect(scalar).toMatchObject({ parsed: false, payload: null, rawPayload: '42' });
  });

  it('parses a JSON-object string payload like trace.py does', () => {
    const trace = buildRunTrace([
      ev(2, 'tool_call', '{"stepSeq":1,"toolName":"search"}'),
      ev(3, 'tool_result', '{"stepSeq":1,"toolName":"search"}'),
    ]);
    expect(trace.events[0].parsed).toBe(true);
    expect(trace.steps[0]).toMatchObject({ toolName: 'search', state: 'settled' });
  });

  it('keeps token/message/approval events as flow and never gates pairing', () => {
    const trace = buildRunTrace([
      ev(1, 'message', { delta: 'hi' }),
      call(2, 1),
      ev(3, 'approval_requested', { stepSeq: 1, toolName: 'search' }),
      ev(4, 'approval_responded', { stepSeq: 1, toolName: 'search', decision: 'allow' }),
      result(5, 1),
      ev(6, 'token', { stepSeq: 1, toolName: 'search', usage: { total_tokens: 12 } }),
    ]);
    // Approvals never become steps and never block the pair around them.
    expect(trace.steps).toHaveLength(1);
    expect(trace.steps[0]).toMatchObject({ state: 'settled', resultSeq: 5 });
    const roles = Object.fromEntries(trace.events.map((e) => [e.seq, e.role]));
    expect(roles).toMatchObject({ 1: 'flow', 3: 'flow', 4: 'flow', 6: 'flow' });
    // Token/message events are untouched stream facts.
    expect(trace.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('does not trust input order: output is ascending by seq, one event lost never', () => {
    const trace = buildRunTrace([R3_EVENTS[4], R3_EVENTS[1], R3_EVENTS[0], R3_EVENTS[3], R3_EVENTS[2]]);
    expect(trace.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('derives the honest picture from the real R3 pilot capture', () => {
    const trace = buildRunTrace(R3_EVENTS);
    expect(trace.runId).toBe(RUN_ID);
    expect(trace.terminalSeq).toBe(5);
    expect(trace.steps).toHaveLength(0); // pilot has no tool events
    expect(trace.events).toHaveLength(5);
    expect(trace.events.every((e) => e.parsed && e.role === 'flow')).toBe(true);
    expect(trace.events.every((e) => e.postTerminal === undefined)).toBe(true);
    expect(trace.events[4].payload).toMatchObject({ completed: true });
  });
});

describe('createHttpAgentConsoleRunsApi param serialization', () => {
  function stubFetch(bodies: unknown[]) {
    const urls: string[] = [];
    const headers: Record<string, string>[] = [];
    let i = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        urls.push(String(input));
        headers.push((init?.headers ?? {}) as Record<string, string>);
        const body = bodies[Math.min(i, bodies.length - 1)];
        i += 1;
        return { ok: true, status: 200, json: async () => body } as Response;
      }),
    );
    return { urls, headers };
  }

  const api = () =>
    createHttpAgentConsoleRunsApi({ base: '/agent-api', getToken: () => 'tok-test' });

  it('GET /agent-api/api/runs sends only defined params (since+limit)', async () => {
    const { urls, headers } = stubFetch([{ items: [], nextCursor: null }]);
    const res = await api().listRuns({
      since: '2026-11-06T00:00:00.000Z',
      limit: 50,
      employeeId: undefined,
      status: undefined,
      cursor: undefined,
    });
    expect(res.ok).toBe(true);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe(
      `/agent-api/api/runs?since=${encodeURIComponent('2026-11-06T00:00:00.000Z')}&limit=50`,
    );
    const search = new URL(urls[0], 'http://localhost').searchParams;
    for (const absent of ['employeeId', 'status', 'cursor']) {
      expect(search.has(absent)).toBe(false);
    }
    expect(headers[0].Authorization).toBe('Bearer tok-test');
  });

  it('GET /agent-api/api/run-events serializes runId, sinceSeq and limit', async () => {
    const { urls } = stubFetch([{ items: [], nextSeq: 5, hasMore: false }]);
    const res = await api().listEvents({ runId: RUN_ID, sinceSeq: 2, limit: 100 });
    expect(res.ok).toBe(true);
    expect(urls[0]).toBe(
      `/agent-api/api/run-events?runId=${RUN_ID}&sinceSeq=2&limit=100`,
    );
  });

  it('omits undefined sinceSeq/limit and guards a missing runId as UpstreamError', async () => {
    const { urls } = stubFetch([{ items: [], nextSeq: 1, hasMore: true }]);
    await api().listEvents({ runId: RUN_ID });
    expect(urls[0]).toBe(`/agent-api/api/run-events?runId=${RUN_ID}`);
    await expect(api().listEvents({ runId: '' })).rejects.toThrow(/missing_required_param/);
  });

  it('maps a non-OK envelope onto ApiResult with the upstream code preserved', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ code: 'request.missing_filter', message: 'need a filter' }),
      }) as Response),
    );
    const res = await api().listRuns({});
    expect(res).toEqual({
      ok: false,
      status: 400,
      data: null,
      code: 'request.missing_filter',
      message: 'need a filter',
    });
  });
});
