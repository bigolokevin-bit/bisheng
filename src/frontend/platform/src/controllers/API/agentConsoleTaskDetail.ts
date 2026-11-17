/**
 * TSK-02 task-detail read adapter: T2 `GET /v1/tasks/{id}` through the BFF
 * read-only proxy `GET /api/task-detail?id=` (CR-M2-01, landed on main
 * `abfaf8a`/`7c69be3`; same family as `/api/run-detail` and
 * `/api/audit-detail`).
 *
 * Field names mirror the upstream `task_public` projection verbatim (the BFF
 * forwards the body unmodified — see apps/console/tests/conftest.py T2 probe):
 * camelCase keys, `progressNote` present and nullable, optional keys simply
 * absent when the contract has no value. This module never invents a key and
 * never coerces a missing value to an empty string.
 *
 * Read-only: T3 (PATCH) and T4 (transitions) are NOT in the BFF whitelist and
 * are not called from here — there is no write method on this interface.
 */
import { AuthError, UpstreamError, type ApiResult } from './agent';

// ---------- Shapes (TASK v1.0 §1, as projected by task_public) ----------

export type TaskDetailStatus = 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
export type TaskDetailPriority = 'low' | 'normal' | 'high';

/** `assignee` / `created_by`: exactly one actor, `{type, id}`. */
export interface TaskActorRef {
  type: 'employee' | 'human' | string;
  id: string;
}

/**
 * `source` — the idempotence basis. `channel` + `messageId` are the display
 * pair; `conversationRef` and `runId` are optional (absent, not `null`, when
 * the projection has no value — tolerate both shapes, render neither as a
 * placeholder).
 */
export interface TaskDetailSource {
  channel: string;
  messageId?: string | null;
  conversationRef?: string | null;
  runId?: string | null;
}

/**
 * One T2 task detail. 17 contract fields; `tenantId` is carried for the
 * env-pill title only and is never rendered as a field.
 */
export interface TaskDetail {
  taskId: string;
  tenantId?: string;
  title: string;
  /** Optional: key absent → the description row is not rendered at all. */
  description?: string | null;
  assignee: TaskActorRef;
  createdBy: TaskActorRef;
  source: TaskDetailSource;
  employeeVersionRef?: string | null;
  /** Optional: absent → 「无截止」 (a semantic, not a missing value). */
  dueAt?: string | null;
  /** Optional: absent → no priority row (the contract default is not a fact). */
  priority?: TaskDetailPriority | string | null;
  status: TaskDetailStatus;
  /** Contract-required for blocked/cancelled; a missing value is data anomaly. */
  statusReason?: string | null;
  /** Contract guarantees the key; it may be null. Never fabricate a value. */
  progressNote?: string | null;
  /** Optional: absent → the whole related-tasks card is not rendered. */
  relatedTaskIds?: string[] | null;
  createdAt: string;
  updatedAt: string;
  /** Terminal states only; absent on every non-terminal task. */
  closedAt?: string | null;
}

// ---------- Narrow interface ----------

export interface AgentConsoleTaskDetailApi {
  /**
   * T2 single-task detail. 200/403/404 share one body shape upstream (403 and
   * 404 differ only by status code); a missing id is the caller's 400 (the
   * BFF answers `console.missing_param`).
   */
  getTaskDetail(params: { id: string }): Promise<ApiResult<TaskDetail>>;
}

export interface HttpAgentConsoleTaskDetailApiOptions {
  /** Same-origin prefix routed by Caddy to the console BFF. */
  base?: string;
  getToken?: () => string | null;
}

export function createHttpAgentConsoleTaskDetailApi(
  options: HttpAgentConsoleTaskDetailApiOptions = {},
): AgentConsoleTaskDetailApi {
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

  // Same fetch idiom as the runs/audit detail adapters: 401 → AuthError,
  // network/parse failure → UpstreamError, non-OK status → envelope with the
  // BFF code preserved (never translated here).
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
    const rid = res.headers?.get?.('x-console-request-id') ?? undefined;
    if (res.status === 401) throw Object.assign(new AuthError(), { requestId: rid });
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
        requestId: rid,
      };
    }
    return { ok: true, status: res.status, data: body as T, requestId: rid };
  }

  return {
    async getTaskDetail({ id }) {
      // A missing id would be a client bug: the page renders its own 400
      // variant and never calls this with ''.
      if (!id) throw new UpstreamError('agent.tasks.missing_required_param');
      return request<TaskDetail>('/api/task-detail', { id });
    },
  };
}