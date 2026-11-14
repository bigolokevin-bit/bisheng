/**
 * L4 console v2 P0-14 (l4-hermes-panels) read-only Hermes metrics adapter:
 * `runtime.hermes.summary.v1` and `runtime.hermes.usage.v1` through the BFF
 * whitelist routes `/agent-api/api/hermes-summary` and
 * `/agent-api/api/hermes-usage?days=N`.
 *
 * Field names mirror the runtime source VERBATIM
 * (services/runtime/hermes_metrics.py summary_payload/usage_payload, pinned
 * by design.md §1.1): snake_case keys, no top-level `degraded` boolean —
 * per-source state lives in `sources.<name> = {state, reason?, fallback_source?}`
 * and every value of a degraded source is `null`, never 0. The client never
 * fabricates: missing money renders 「未计价」, missing numbers render 「—」.
 * Same fetch idiom and error semantics as agentConsoleTrends.ts
 * (401 → AuthError, network → UpstreamError, non-OK → envelope with the
 * BFF/upstream `code` preserved). Read-only: there are no write endpoints.
 */
import { AuthError, UpstreamError, type ApiResult } from './agent';

// ---------- Shapes (BFF forwards upstream bodies unmodified) ----------

/** `sources.<name>` block; reason ∈ timeout/unreachable/auth/not_found/
 *  http_5xx/malformed/token_unconfigured/gateway_key_unconfigured. */
export interface HermesSource {
  state: 'ok' | 'degraded';
  reason?: string;
  /** Present only when a local read-only fallback supplied the numbers
   *  (e.g. "sqlite-ro-fallback"). Tokens only — never money. */
  fallback_source?: string;
}

export interface HermesGatewayMetricsToday {
  /** Local day label of the process-side counters; null when degraded. */
  day: string | null;
  requests: number | null;
  messages: number | null;
  tokens: number | null;
  latency_p95_ms: number | null;
}

/** One entry of `gateway.platforms` (trimmed by the runtime). */
export interface HermesGatewayPlatform {
  state: string | null;
  needs_attention: boolean | null;
}

export interface HermesGateway {
  status: string | null;
  platform: string | null;
  version: string | null;
  gateway_state: string | null;
  active_agents: number | null;
  gateway_busy: boolean | null;
  gateway_drainable: boolean | null;
  updated_at: string | null;
  platforms: Record<string, HermesGatewayPlatform>;
  metrics_today: HermesGatewayMetricsToday;
  /** Verbatim runtime note: 当日计数、重启归零、不回填历史. */
  note: string;
}

export interface HermesSystemBlock {
  hermes_version: string | null;
  cpu_count: number | null;
  cpu_percent: number | null;
  load_avg: number[] | null;
  uptime_seconds: number | null;
  memory: { total: number | null; available: number | null; used: number | null; percent: number | null };
  disk: { total: number | null; used: number | null; free: number | null; percent: number | null };
  process: { rss: number | null; num_threads: number | null };
  psutil: unknown;
}

export interface HermesSessionsStats {
  total: number | null;
  active_store: number | null;
  archived: number | null;
  messages: number | null;
  by_source: Record<string, number>;
}

export interface HermesSummary {
  schema: string; // "runtime.hermes.summary.v1"
  sources: {
    gateway_health?: HermesSource;
    dashboard_system?: HermesSource;
    dashboard_sessions_stats?: HermesSource;
  };
  gateway: HermesGateway;
  system: HermesSystemBlock;
  sessions_stats: HermesSessionsStats;
}

export interface HermesUsageTokens {
  total_input: number | null;
  total_output: number | null;
  total_cache_read: number | null;
  total_reasoning: number | null;
}

export interface HermesUsageModelRow {
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

export type HermesCostStatus = 'upstream' | 'estimated' | 'mixed' | 'unknown';

export interface HermesCostEmployeeRow {
  employee_id: string;
  /** Summed ledger value rounded to 6 decimals upstream; rendered verbatim. */
  cost_usd: number;
  cost_status: HermesCostStatus;
  rows: number;
}

export interface HermesCostBlock {
  source: string; // "cost_ledger" — money comes ONLY from our ledger
  /** null with cost_status "unknown" when the window has no ledger rows —
   *  the UI renders 「未计价」, never 0.00. */
  cost_usd: number | null;
  cost_status: HermesCostStatus;
  rows: number;
  per_employee: HermesCostEmployeeRow[];
}

export interface HermesUnattributed {
  /** null when the gateway_sessions source is degraded. */
  sessions: number | null;
  /** Absent entirely when attribution is degraded (never 0-filled). */
  tokens?: HermesUsageTokens;
  note?: string;
}

export interface HermesAttribution {
  state: 'ok' | 'degraded';
  reason?: string;
  note?: string;
  mapped_sessions: number | null;
  unattributed: HermesUnattributed;
}

export interface HermesUsage {
  schema: string; // "runtime.hermes.usage.v1"
  period_days: number;
  sources: {
    dashboard_usage?: HermesSource;
    gateway_sessions?: HermesSource;
    cost_ledger?: { state: 'ok'; source?: string };
  };
  tokens: HermesUsageTokens;
  /** null when the usage source is degraded with no fallback. */
  by_model: HermesUsageModelRow[] | null;
  /** Independent of dashboard degradation: ledger money always has a block. */
  cost: HermesCostBlock;
  attribution: HermesAttribution;
}

// ---------- Narrow interface ----------

export interface AgentConsoleHermesApi {
  /** runtime.hermes.summary.v1 (single instance; no tenant semantics). */
  getSummary(): Promise<ApiResult<HermesSummary>>;
  /** runtime.hermes.usage.v1; invalid/out-of-range days → upstream 422
   *  request.invalid_query passed through untouched. */
  getUsage(days: number): Promise<ApiResult<HermesUsage>>;
}

export interface HttpAgentConsoleHermesApiOptions {
  /** Same-origin prefix routed by Caddy to the console BFF. */
  base?: string;
  getToken?: () => string | null;
}

export function createHttpAgentConsoleHermesApi(
  options: HttpAgentConsoleHermesApiOptions = {},
): AgentConsoleHermesApi {
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

  // Identical semantics to agentConsoleTrends.ts: 401 → AuthError,
  // network failure → UpstreamError, non-OK → envelope preserving the
  // upstream `code` (console.forbidden / runtime.metrics_unconfigured /
  // request.invalid_query all render in the UI). No fabrication anywhere.
  async function request<T>(
    path: string,
    params: Record<string, string | number | undefined> = {},
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
    async getSummary() {
      return request<HermesSummary>('/api/hermes-summary');
    },
    async getUsage(days) {
      return request<HermesUsage>('/api/hermes-usage', { days });
    },
  };
}
