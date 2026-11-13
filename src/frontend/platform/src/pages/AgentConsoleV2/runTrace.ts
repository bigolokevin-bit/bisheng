/**
 * L4 console v2 (l4-console-v2-trace): TS port of
 * `services/runtime/trace.py::build_run_trace` — the pure read-only
 * 「call → result」 derivation over one run's R3 event stream.
 *
 * Discipline (design.md §2, verbatim semantics):
 * - Pure function: no state, no network, no React; same input → same output.
 * - Stable seq-ascending order; shuffled input is never guessed.
 * - stepSeq = payload.stepSeq when it is an integer ≠ 0, else event seq
 *   (3.5/NaN/0 fall back), mirroring trace.py's
 *   `int(payload.get("stepSeq") or seq)` governance rule.
 * - Non-object payload → fail-soft: parsed=false, original kept in
 *   rawPayload, never dropped, never guessed.
 * - Terminal vocabulary {completed, failed, interrupted, cancelled}; a
 *   later terminal overwrites terminalSeq; events with seq strictly
 *   greater are kept and flagged postTerminal but derive no steps and
 *   never mutate existing steps; the terminal event itself (seq ==
 *   terminalSeq) is not flagged and stays pairable.
 * - Pair key (stepSeq, toolName), two structures like trace.py:
 *   seenCalls records every key ever called; openCalls holds steps still
 *   awaiting settlement. tool_call opens a pending step and is only
 *   registered in openCalls for a first-seen key (a second call on the
 *   same key flags anomaly=duplicate-call, earliest wins). tool_result
 *   POPS its key: a hit settles the step (resultSeq recorded), so a
 *   later result on the same key misses and flags anomaly=orphan-result
 *   — settled results are never overwritten.
 * - Roles: tool_call=call, tool_result=result, everything else=flow.
 *   token/message events never become steps; approval_requested /
 *   approval_responded are flow and gate nothing, ever.
 * - Tool events without toolName stay raw stream facts (no step derived).
 * - No P1 claims: run_event carries no policy_decision; this view shows
 *   the factual event stream only.
 */
import type { RunEvent } from '@/controllers/API/agentConsoleRuns';

/** 终态事件词汇（trace.py TERMINAL_TRACE_EVENT_TYPES）。 */
export const TERMINAL_TRACE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'interrupted',
  'cancelled',
]);

export type TraceRole = 'call' | 'result' | 'flow';

export type TraceAnomaly = 'duplicate-call' | 'orphan-result';

export type TraceStepState = 'pending' | 'settled';

/** One derived event row (trace.py's per-event `item`). */
export interface TraceEvent {
  seq: number;
  eventType: string;
  /** Parsed object payload; null when parsed=false. */
  payload: Record<string, unknown> | null;
  occurredAt: string;
  pulledAt: string;
  role: TraceRole;
  parsed: boolean;
  /** Kept verbatim when parsed=false (fail-soft). */
  rawPayload?: string;
  /** Governance stepSeq, set on non-postTerminal parsed call/result events. */
  stepSeq?: number;
  /** 'duplicate-call' | 'orphan-result' when pairing flags the event. */
  anomaly?: TraceAnomaly;
  /** True when seq > terminalSeq: kept as fact, derives nothing. */
  postTerminal?: boolean;
}

/** One (stepSeq, toolName) step (trace.py's `step`, minus the display argsHash). */
export interface RunStep {
  stepSeq: number;
  toolName: string;
  callEvent: TraceEvent;
  resultEvent: TraceEvent | null;
  /** seq of the settling tool_result; null while pending. */
  resultSeq: number | null;
  state: TraceStepState;
  /** 'duplicate-call' on the redundant call's own step row (earliest wins settlement). */
  anomaly: TraceAnomaly | null;
}

export interface RunTraceResult {
  runId: string | null;
  /** Steps ordered by call seq ascending. */
  steps: RunStep[];
  /** Every event, seq ascending, none dropped. */
  events: TraceEvent[];
  /** Latest terminal event seq; null when the run never terminated. */
  terminalSeq: number | null;
}

const TOOL_ROLE: Record<string, TraceRole> = {
  tool_call: 'call',
  tool_result: 'result',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** payload → {payload, rawPayload?}. 非对象/坏 JSON 一律 fail-soft（镜像 _parse_payload）。 */
function parsePayload(raw: unknown): {
  payload: Record<string, unknown> | null;
  rawPayload?: string;
} {
  if (isRecord(raw)) return { payload: raw };
  if (typeof raw === 'string' && raw !== '') {
    try {
      const value: unknown = JSON.parse(raw);
      if (isRecord(value)) return { payload: value };
      return { payload: null, rawPayload: JSON.stringify(value) };
    } catch {
      return { payload: null, rawPayload: raw };
    }
  }
  return {
    payload: null,
    rawPayload: raw === undefined || raw === null ? '' : JSON.stringify(raw),
  };
}

/** 治理口径：整数且非 0 才采用 payload.stepSeq，3.5/NaN/0 回落事件 seq（镜像 int(...)）。 */
function stepSeqOf(payload: Record<string, unknown>, seq: number): number {
  const n = Number(payload.stepSeq);
  return Number.isInteger(n) && n !== 0 ? n : seq;
}

/**
 * Derive the call→result layering from one run's events (pure read,
 * input never mutated). Mirrors build_run_trace's return structure.
 */
export function buildRunTrace(events: RunEvent[]): RunTraceResult {
  // Stable seq-ascending order: original index breaks seq ties (no guessing).
  const ordered = events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.seq - b.event.seq || a.index - b.index);

  let runId: string | null = null;
  let terminalSeq: number | null = null;
  const traceEvents: TraceEvent[] = [];
  const steps: RunStep[] = [];
  // Pair key (stepSeq, toolName), mirroring trace.py's two structures:
  // seenCalls owns "earliest call wins"; openCalls holds unsettled steps
  // and a result pops its key, so a second result on a settled key misses
  // and orphans instead of overwriting.
  const seenCalls = new Set<string>();
  const openCalls = new Map<string, RunStep>();

  for (const { event } of ordered) {
    const seq = event.seq;
    const eventType = event.eventType ?? '';
    if (runId === null) runId = event.runId;
    const parsed = parsePayload(event.payload);
    const payload = parsed.payload;

    // 后到的终态覆盖先到的（completed 之后又 interrupted → 取最新）；
    // 审批词不是终态，不设门槛。
    if (TERMINAL_TRACE_EVENT_TYPES.has(eventType)) {
      terminalSeq = seq;
    }
    const postTerminal = terminalSeq !== null && seq > terminalSeq;

    const item: TraceEvent = {
      seq,
      eventType,
      payload,
      occurredAt: event.occurredAt,
      pulledAt: event.pulledAt,
      role: TOOL_ROLE[eventType] ?? 'flow',
      parsed: payload !== null,
    };
    if (payload === null) item.rawPayload = parsed.rawPayload;
    if (postTerminal) item.postTerminal = true;

    // 终态之后的事件一律保留但不派生/不配对；终态事件自身（seq 相等）
    // 仍可配对；unparsed 事件不猜归属。
    if (!postTerminal && (item.role === 'call' || item.role === 'result') && payload !== null) {
      const stepSeq = stepSeqOf(payload, seq);
      item.stepSeq = stepSeq;
      const toolName = String(payload.toolName ?? '');
      if (toolName !== '') {
        const key = `${stepSeq}\u0000${toolName}`;
        if (item.role === 'call') {
          const duplicate = seenCalls.has(key);
          const step: RunStep = {
            stepSeq,
            toolName,
            callEvent: item,
            resultEvent: null,
            resultSeq: null,
            state: 'pending',
            anomaly: duplicate ? 'duplicate-call' : null,
          };
          steps.push(step);
          if (duplicate) {
            // 最早为准：重复 call 标记事件本身，不再进入 openCalls（与
            // trace.py 一致，settled 后再来的同键 call 同样只标 duplicate-call）。
            item.anomaly = 'duplicate-call';
          } else {
            seenCalls.add(key);
            openCalls.set(key, step);
          }
        } else {
          const step = openCalls.get(key);
          if (step === undefined) {
            // openCalls 已被首个 result 弹出：后到同键 result 一律孤挂，
            // 绝不覆盖已结算 step 的 result（trace.py open_calls.pop 语义）。
            item.anomaly = 'orphan-result';
          } else {
            openCalls.delete(key);
            step.resultEvent = item;
            step.resultSeq = seq;
            step.state = 'settled';
          }
        }
      }
      // 缺工具名的 tool 事件信息不全：保留为流内事实，不派生 step。
    }

    traceEvents.push(item);
  }

  steps.sort((a, b) => a.callEvent.seq - b.callEvent.seq);
  return { runId, steps, events: traceEvents, terminalSeq };
}
