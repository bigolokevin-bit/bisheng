/**
 * L4 console v2 (l4-console-v2-trace) read-only runs/events adapter:
 * R5 runs list (BFF GET /api/runs, existing v2-1 proxy) and R3 event
 * stream (BFF GET /api/run-events, new read-only proxy) through the
 * console BFF whitelist routes.
 *
 * Field names mirror the live captures verbatim (design.md 数据面事实,
 * 2026-11-14 实采 evidence/r5-runs.json / evidence/r3-*.json — field
 * names are law). The client never fabricates values: pagination is
 * `nextCursor` on runs and `nextSeq`/`hasMore` on events, exactly as
 * captured. Types live in this sibling module so agent.ts stays under
 * its line budget, same idiom as agentConsoleTrends / agentConsoleApprovals.
 */
import { AuthError, UpstreamError, type ApiResult } from './agent';

// ---------- Shapes (BSS: BFF forwards upstream bodies unmodified) ----------

/**
 * RunStatus contract enum (services/domain/schemas/agentrun_models.py):
 * pending/running/completed/failed/cancelled/interrupted.
 */
export type RunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

/**
 * One R5 run row. All fields captured in evidence/r5-runs.json; the keys
 * observed as `null` there (channelEventId/taskId/previousRunId) stay
 * `string | null`. `endedAt` is `null` on non-terminal runs (the UI shows
 * 「—」 for duration instead of fabricating one); `reasonCode`/`costUsd`/
 * `costStatus` are nullable until the run carries them.
 */
export interface Run {
  runId: string;
  tenantId: string;
  employeeId: string;
  employeeVersionNo: number;
  policySnapshotRef: string;
  upstreamRunId: string;
  channelEventId: string | null;
  taskId: string | null;
  previousRunId: string | null;
  attemptNo: number;
  status: RunStatus;
  reasonCode?: string | null;
  budgetCapUsd?: number | null;
  costUsd?: number | null;
  costStatus?: string | null;
  startedAt: string;
  endedAt?: string | null;
  lastEventSeq: number;
  createdAt: string;
  updatedAt: string;
}

export interface RunsListResult {
  items: Run[];
  /** Cursor page token; `null` on the last page (evidence/r5-runs.json). */
  nextCursor?: string | null;
}

/**
 * One R3 event. `payload` is an object in every live capture
 * (evidence/r3-events.json: `message` carries delta/upstreamEvent,
 * `completed` carries output/reasonCode/completed); the trace builder
 * fail-softs on anything else.
 */
export interface RunEvent {
  runId: string;
  seq: number;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  pulledAt: string;
}

/**
 * R3 page. sinceSeq is an exclusive lower bound (>sinceSeq);
 * nextSeq = max seq of this page; hasMore drives 「加载更多」.
 * Verified live with limit=2: p1=[1,2] nextSeq=2 hasMore=true,
 * p2(sinceSeq=2)=[3,4,5] nextSeq=5 hasMore=false.
 */
export interface RunEventList {
  items: RunEvent[];
  nextSeq: number | null;
  hasMore: boolean;
}

// ---------- Narrow interface ----------

export interface AgentConsoleRunsApi {
  /**
   * R5 runs list. Upstream rejects filter-less queries (400
   * request.missing_filter): callers must pass at least one of
   * employeeId/status/since; the UI always sends `since`.
   */
  listRuns(params: {
    employeeId?: string;
    status?: string;
    since?: string;
    limit?: number;
    cursor?: string;
  }): Promise<ApiResult<RunsListResult>>;
  /** R3 event stream for one run (runId required — BFF 400 console.missing_param). */
  listEvents(params: {
    runId: string;
    sinceSeq?: number;
    limit?: number;
  }): Promise<ApiResult<RunEventList>>;
}

export interface HttpAgentConsoleRunsApiOptions {
  /** Same-origin prefix routed by Caddy to the console BFF. */
  base?: string;
  getToken?: () => string | null;
}

export function createHttpAgentConsoleRunsApi(
  options: HttpAgentConsoleRunsApiOptions = {},
): AgentConsoleRunsApi {
  const base = options.base ?? '/agent-api';
  const getToken =
    options.getToken ??
    (() => {
      try {
        return localStorage.getItem('ws_token');
      } catch {
        return null;
      }
    });

  // Same fetch idiom as the console/approvals/trends adapters: 401 → AuthError,
  // network/parse failure → UpstreamError, non-OK status → envelope with
  // the BFF `code` preserved. No fabrication anywhere.
  async function request<T>(
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<ApiResult<T>> {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') search.set(key, String(value));
    });
    const qs = search.toString();
    const url = `${base}${path}${qs ? `?${qs}` : ''}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await fetch(url, { headers });
    } catch {
      throw new UpstreamError('console request failed (network)');
    }
    if (res.status === 401) throw new AuthError();
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const envelope = body as { code?: string; message?: string } | null;
      return {
        ok: false,
        status: res.status,
        data: null,
        code: envelope?.code ?? `agent.http.${res.status}`,
        message: envelope?.message,
      };
    }
    return { ok: true, status: res.status, data: body as T };
  }

  return {
    async listRuns({ employeeId, status, since, limit, cursor }) {
      return request<RunsListResult>('/api/runs', {
        employeeId,
        status,
        since,
        limit,
        cursor,
      });
    },
    async listEvents({ runId, sinceSeq, limit }) {
      // The BFF requires runId (translated into the upstream path);
      // a missing required query param would be a client bug, so guard.
      if (!runId) {
        throw new UpstreamError('agent.runs.missing_required_param');
      }
      return request<RunEventList>('/api/run-events', { runId, sinceSeq, limit });
    },
  };
}
