/**
 * L4 console v2-3 (P0-5) read-only trends/costs adapter: R6 run-stats,
 * R7 run-activity and P9 budget-usage through the BFF whitelist routes.
 *
 * Field names mirror the BFF/contract shape verbatim (CR-031 / CR-032).
 * The client never fabricates values: a missing `p95DurationMs` stays
 * missing (the UI renders 「样本不足」), a missing ledger row stays missing
 * (the UI renders 「无成本记录」, never 0.00). Types live in this sibling
 * module so agent.ts stays under its line budget, same idiom as
 * agentConsoleApprovals.
 */
import { AuthError, UpstreamError, type ApiResult } from './agent';

// ---------- Shapes (BSS: BFF forwards upstream bodies unmodified) ----------

/** One R6 bucket. `period` is the day string (bucket=day → YYYY-MM-DD). */
export interface RunStatsBucket {
  period: string;
  runs?: number;
  succeeded: number;
  failed: number;
  /** Omitted entirely when no bucket run has ledger cost (CR-032); never 0-filled. */
  costUsd?: number | null;
  upstreamRuns?: number;
  estimatedRuns?: number;
  /** CR-032: terminal runs without any ledger entry (未记账). */
  unknownRuns?: number;
  /** Absent when the sample is < 20 (CR-031 §2.1-3): the UI says 「样本不足」. */
  p95DurationMs?: number;
}

export interface RunStatsResponse {
  buckets: RunStatsBucket[];
}

/**
 * One R7 activity cell. The contract pins `dow` as ISO (1=Mon…7=Sun);
 * the recovery card described `dow 0=Sun`. `dayIndexOf` below maps both
 * conventions onto the same 0=Sun…6=Sat row index (`dow % 7`), so the
 * renderer is correct against either shape. `hour` is the local hour
 * 0–23 in the requested tz.
 */
export interface RunActivityCell {
  dow: number;
  hour: number;
  count: number;
}

export interface RunActivityResponse {
  cells: RunActivityCell[];
  /** Scaling max from the server; recomputed from cells when absent. */
  max?: number;
  tz?: string;
}

/** One P9 ledger row. The forward-compatible marker fields are rendered
 *  only when present — the current contract row has none of them. */
export interface BudgetUsageItem {
  employeeId: string;
  period: string;
  periodKind: string;
  tokensUsed?: number;
  costUsd?: number | null;
  reserved?: number;
  updatedAt?: string;
  estimated?: boolean;
  uncounted?: boolean;
  costStatus?: string;
}

export interface BudgetUsageResponse {
  items: BudgetUsageItem[];
  /** Employees without a ledger row: 「无成本记录」, never treated as 0. */
  missingEmployeeIds?: string[];
}

// ---------- Narrow interface ----------

export interface AgentConsoleTrendsApi {
  /** R6 interval buckets; day buckets are capped at 90 days upstream. */
  getRunStats(params: {
    from: string;
    to: string;
    employeeId?: string;
    bucket: 'day';
  }): Promise<ApiResult<RunStatsResponse>>;
  /** R7 7×24 heat; weeks 1–12, tz must be an IANA name. */
  getRunActivity(params: {
    weeks: number;
    employeeId?: string;
    tz: string;
  }): Promise<ApiResult<RunActivityResponse>>;
  /** P9 batch budget usage read through the BFF GET→POST read-only proxy. */
  getBudgetUsage(params: {
    employeeId: string;
    periodKind: 'day' | 'month';
    period: string;
  }): Promise<ApiResult<BudgetUsageResponse>>;
}

/** ISO dow (1=Mon…7=Sun) or 0-based dow (0=Sun) → row index 0=Sun…6=Sat. */
export function dayIndexOf(dow: number): number {
  return ((dow % 7) + 7) % 7;
}

export interface HttpAgentConsoleTrendsApiOptions {
  /** Same-origin prefix routed by Caddy to the console BFF. */
  base?: string;
  getToken?: () => string | null;
}

export function createHttpAgentConsoleTrendsApi(
  options: HttpAgentConsoleTrendsApiOptions = {},
): AgentConsoleTrendsApi {
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

  // Same fetch idiom as the console/approvals adapters: 401 → AuthError,
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
    async getRunStats({ from, to, employeeId, bucket }) {
      return request<RunStatsResponse>('/api/run-stats', {
        from,
        to,
        employeeId,
        bucket,
      });
    },
    async getRunActivity({ weeks, employeeId, tz }) {
      return request<RunActivityResponse>('/api/run-activity', {
        weeks,
        employeeId,
        tz,
      });
    },
    async getBudgetUsage({ employeeId, periodKind, period }) {
      // The BFF requires employeeId and period (server.py route table);
      // a missing required query param would be a client bug, so guard.
      if (!employeeId || !period) {
        throw new UpstreamError('agent.trends.missing_required_param');
      }
      return request<BudgetUsageResponse>('/api/budget-usage', {
        employeeId,
        periodKind,
        period,
      });
    },
  };
}
