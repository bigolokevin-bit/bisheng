/* eslint-disable no-restricted-syntax -- the only Chinese literals in this
 * module are CSV schema data (caliber/unit/comment markers) pinned verbatim
 * by MET01-TARGET-SPEC §7.1; they are file-format content, identical in every
 * locale, never UI copy. All screen copy lives in the locale bundles. */
/**
 * MET-01 `/agent/metrics` pure helpers (MET01-TARGET-SPEC.md §1.4/§2/§7).
 *
 * Honest-data rules pinned here so the page and the tests share one source:
 * - degraded sources never 0-fill: null renders 「暂不可用」/「—」/「未计价」;
 * - money comes ONLY from the tenant cost ledger, never derived from tokens;
 * - aggregates come only from server-side buckets/cells (R7), never from
 *   paginated raw rows;
 * - thresholds are frozen constants (M-GAP-09: no threshold buttons);
 * - heat levels are ceil(count ÷ max × 5) with the SERVER max; missing cells
 *   are legal true zeroes (R7 omits zero cells), never fabricated data.
 */
import type {
  HermesSource,
  HermesSummary,
  HermesUsage,
} from '@/controllers/API/agentConsoleHermes';

import type { ActivityCell } from './v2Data';

// ---------- frozen thresholds (SPEC §1.3 / §2.7; adjusting needs a release) ----------

export const MET_THRESHOLDS = {
  /** CPU / memory percent: <70 neutral, 70–85 warning, ≥85 danger. */
  cpuMem: [70, 85] as const,
  /** Disk percent: <75 neutral, 75–90 warning, ≥90 danger. */
  disk: [75, 90] as const,
  /** Hermes P95 ms: <2000 success, 2000–5000 warning, ≥5000 danger. */
  p95Ms: [2000, 5000] as const,
  /** Process threads: >200 warning. */
  threads: 200,
  /** Gateway heartbeat older than 10 minutes → warning. */
  heartbeatMinutes: 10,
  /** Load average: >cores warning, >2×cores danger. */
  loadWarnFactor: 1,
  loadDangerFactor: 2,
} as const;

export type Tone = '' | 'ok' | 'wr' | 'dg' | 'nt' | 'ac';

/** Percent thresholds → tone class suffix (numbers keep foreground otherwise). */
export function percentTone(v: number | null | undefined, band: readonly [number, number]): Tone {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  if (v >= band[1]) return 'dg';
  if (v >= band[0]) return 'wr';
  return '';
}

export function p95Tone(ms: number | null | undefined): Tone {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '';
  if (ms >= MET_THRESHOLDS.p95Ms[1]) return 'dg';
  if (ms >= MET_THRESHOLDS.p95Ms[0]) return 'wr';
  return 'ok';
}

// ---------- number formatting (null never becomes 0) ----------

export function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString('en-US');
}

/** Compact token form: 1,284 / 640k / 1.24M / 12.4M (SPEC §5 examples). */
export function fmtCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) {
    const m = v / 1_000_000;
    return `${parseFloat((m >= 10 ? m.toFixed(1) : m.toFixed(2)))}M`;
  }
  if (abs >= 1_000) {
    const k = v / 1_000;
    return `${k >= 100 ? Math.round(k) : parseFloat(k.toFixed(1))}k`;
  }
  return Math.round(v).toLocaleString('en-US');
}

/** P95 latency: 0.8s / 2.0s (one decimal of seconds, SPEC §1.5 A2). */
export function fmtP95(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  return `${(ms / 1000).toFixed(1)}s`;
}

export function fmtPercent1(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v.toFixed(1)}%`;
}

export function fmtLoad(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(2);
}

/** Uptime: 3d04h (days>0), else 04h12m, else 12m. */
export function fmtUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d${pad(h)}h`;
  if (h > 0) return `${h}h${pad(m)}m`;
  return `${m}m`;
}

/** Money: fixed 2 decimals; null/unknown is the caller's 「未计价」, never 0.00. */
export function fmtUsd2(v: number | null | undefined): string | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Beijing-time pieces (tz fixed to Asia/Shanghai per SPEC §1.7). */
export function beijingNow(now = new Date()): { dow: number; hour: number; minute: number } {
  const d = new Date(now.getTime() + 480 * 60000);
  const jsDay = d.getUTCDay(); // 0=Sun
  return { dow: jsDay === 0 ? 7 : jsDay, hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/** Beijing today as YYYY-MM-DD (A2 day comparison). */
export function beijingDayIso(now = new Date()): string {
  const d = new Date(now.getTime() + 480 * 60000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Beijing today 00:00 as a UTC ISO string (A2 → runs?since=). */
export function beijingDayStartIso(now = new Date()): string {
  const d = new Date(now.getTime() + 480 * 60000);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - 480 * 60000).toISOString();
}

/** 'MM-DD HH:mm' in Beijing time; cross-year prefixes the year (v2Data idiom). */
export function fmtBeijing(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t + 480 * 60000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const base = `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return d.getUTCFullYear() === new Date(now.getTime() + 480 * 60000).getUTCFullYear()
    ? base
    : `${d.getUTCFullYear()}-${base}`;
}

/** 'HH:mm' Beijing time (A0 「最近更新」). */
export function fmtBeijingHm(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t + 480 * 60000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Gateway heartbeat staleness: >10min → warning (SPEC §1.5 A1). */
export function heartbeatStale(updatedAt: string | null | undefined, now = new Date()): boolean {
  if (!updatedAt) return false;
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t > MET_THRESHOLDS.heartbeatMinutes * 60000;
}

// ---------- degraded-source reason → human copy key + severity (SPEC §2) ----------

export const REASON_KEYS: Record<string, { key: string; tone: 'wr' | 'dg' }> = {
  timeout: { key: 'agentConsole.v2.met.reasonTimeout', tone: 'wr' },
  unreachable: { key: 'agentConsole.v2.met.reasonUnreachable', tone: 'dg' },
  auth: { key: 'agentConsole.v2.met.reasonAuth', tone: 'dg' },
  not_found: { key: 'agentConsole.v2.met.reasonNotFound', tone: 'wr' },
  http_5xx: { key: 'agentConsole.v2.met.reasonHttp5xx', tone: 'dg' },
  malformed: { key: 'agentConsole.v2.met.reasonMalformed', tone: 'dg' },
  token_unconfigured: { key: 'agentConsole.v2.met.reasonTokenUnconfigured', tone: 'wr' },
  gateway_key_unconfigured: { key: 'agentConsole.v2.met.reasonGatewayKeyUnconfigured', tone: 'wr' },
};

export const CONFIG_REASONS = new Set(['auth', 'token_unconfigured', 'gateway_key_unconfigured']);

export function reasonKey(reason: string | undefined | null): string {
  if (reason && REASON_KEYS[reason]) return REASON_KEYS[reason].key;
  return 'agentConsole.v2.met.reasonGeneric';
}

// ---------- A0 verdict: state fields ONLY, never inferred (SPEC §1.4) ----------

export interface A0Verdict {
  level: 'ok' | 'wr' | 'dg' | 'nt';
  /** Append 「配置未完成」 when a degraded reason is a configuration gap. */
  configIncomplete: boolean;
}

export function a0Verdict(s: HermesSummary | null | undefined): A0Verdict {
  if (!s || !s.sources) return { level: 'nt', configIncomplete: false };
  const srcs: (HermesSource | undefined)[] = [
    s.sources.gateway_health,
    s.sources.dashboard_system,
    s.sources.dashboard_sessions_stats,
  ];
  const known = srcs.filter((x): x is HermesSource => Boolean(x && (x.state === 'ok' || x.state === 'degraded')));
  if (known.length < 3) return { level: 'nt', configIncomplete: false };
  const degraded = known.filter((x) => x.state === 'degraded');
  const reasons = degraded.map((x) => x.reason ?? '');
  const gw = s.gateway;
  const gatewayDown =
    gw?.status === 'down' || gw?.gateway_state === 'stopped' || gw?.gateway_state === 'failed';
  if (degraded.length === 3 && reasons.some((r) => r === 'http_5xx' || r === 'unreachable')) {
    return { level: 'dg', configIncomplete: false };
  }
  if (gatewayDown) return { level: 'dg', configIncomplete: false };
  if (degraded.length > 0) {
    return { level: 'wr', configIncomplete: reasons.some((r) => CONFIG_REASONS.has(r)) };
  }
  if (gw?.gateway_state === 'running') return { level: 'ok', configIncomplete: false };
  return { level: 'nt', configIncomplete: false };
}

/** True when every known source is degraded (A block becomes the error card). */
export function allSourcesDegraded(s: HermesSummary | null | undefined): boolean {
  if (!s?.sources) return false;
  const srcs = [s.sources.gateway_health, s.sources.dashboard_system, s.sources.dashboard_sessions_stats];
  return srcs.every((x) => x?.state === 'degraded');
}

// ---------- heat math (R7 cells; server aggregates only) ----------

export interface HeatModel {
  /** 'dow:hour' → count; absent key = legal true 0 (R7 omits zero cells). */
  map: Map<string, number>;
  total: number;
  /** Server response max when present and >0; else the cells' own max. */
  max: number;
  peak: { dow: number; hour: number; count: number } | null;
  /** Peak HOUR (7-day sum at that hour) ÷ Σcells — SPEC §1.7 right column. */
  peakHourShare: number | null;
  /** Σ(hour 0..7) ÷ 56 cells. */
  nightAvg: number | null;
}

export function buildHeat(cells: ActivityCell[] | null | undefined, serverMax?: number | null): HeatModel {
  const map = new Map<string, number>();
  let total = 0;
  let cellsMax = 0;
  let peak: HeatModel['peak'] = null;
  const hourSums = new Array<number>(24).fill(0);
  (cells ?? []).forEach((c) => {
    if (!c || typeof c.count !== 'number' || !Number.isFinite(c.count)) return;
    const dow = c.dow;
    const hour = c.hour;
    if (!(dow >= 1 && dow <= 7) || !(hour >= 0 && hour <= 23)) return;
    const key = `${dow}:${hour}`;
    const prev = map.get(key) ?? 0;
    const count = prev + c.count;
    map.set(key, count);
    total += c.count;
    hourSums[hour] += c.count;
    if (count > cellsMax) cellsMax = count;
    if (!peak || count > peak.count) peak = { dow, hour, count };
  });
  const max = typeof serverMax === 'number' && serverMax > 0 ? serverMax : cellsMax;
  const peakHourShare = peak && total > 0 ? hourSums[peak.hour] / total : null;
  const nightSum = hourSums.slice(0, 8).reduce((a, b) => a + b, 0);
  const nightAvg = total > 0 || nightSum > 0 ? nightSum / 56 : null;
  return { map, total, max, peak, peakHourShare, nightAvg };
}

/** Six-level scale: 0 → heat-0; else ceil(count ÷ max × 5), clamped 1..5. */
export function heatLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(5, Math.max(1, Math.ceil((count / max) * 5)));
}

/**
 * Drill-down start for a (dow,hour) cell: the MOST RECENT Beijing hour with
 * that weekday+hour at or before `now`, as a UTC ISO string. R5 has no
 * `until` (M-GAP-07) so the link carries only this start point.
 */
export function cellSinceIso(dow: number, hour: number, now = new Date()): string {
  const bj = new Date(now.getTime() + 480 * 60000);
  const curDow = bj.getUTCDay() === 0 ? 7 : bj.getUTCDay();
  let deltaDays = (curDow - dow + 7) % 7;
  const candidate = new Date(bj.getTime());
  candidate.setUTCMinutes(0, 0, 0);
  candidate.setUTCHours(hour);
  candidate.setUTCDate(candidate.getUTCDate() - deltaDays);
  if (candidate.getTime() > bj.getTime()) {
    deltaDays += 7;
    candidate.setUTCDate(candidate.getUTCDate() - 7);
  }
  return new Date(candidate.getTime() - 480 * 60000).toISOString();
}

// ---------- CSV export (SPEC §7.1 fixed schema; empty values, never 0) ----------

export interface CsvFetchTimes {
  summary: string | null;
  usage: string | null;
  heat: string | null;
}

export interface CsvInput {
  summary: HermesSummary | null;
  usage: HermesUsage | null;
  heat: HeatModel | null;
  days: 7 | 30;
  fetched: CsvFetchTimes;
}

function csvField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Serialize the CURRENT on-screen aggregates. Null values write an empty
 * string (never 0); money rows carry caliber 租户账本 and 「未计价」 when the
 * ledger has no price. First/last lines are the pinned comment markers.
 */
export function buildMetricsCsv(input: CsvInput): string {
  const rows: string[] = [
    '# seakoi console metrics export v1',
    'section,metric,value,unit,caliber,source_state,window,fetched_at',
  ];
  const push = (
    section: string,
    metric: string,
    value: string | number | null | undefined,
    unit: string,
    caliber: string,
    state: string,
    win: string,
    at: string | null
  ) => {
    rows.push(
      [section, metric, csvField(value), unit, caliber, state, win, csvField(at ?? '')]
        .map(csvField)
        .join(',')
    );
  };
  const s = input.summary;
  const sAt = input.fetched.summary;
  if (s) {
    const gwState = s.sources?.gateway_health?.state ?? 'degraded';
    const sysState = s.sources?.dashboard_system?.state ?? 'degraded';
    const sesState = s.sources?.dashboard_sessions_stats?.state ?? 'degraded';
    const gw = s.gateway;
    push('health', 'gateway.status', gw?.status ?? null, '', '实例', gwState, '', sAt);
    push('health', 'gateway.gateway_state', gw?.gateway_state ?? null, '', '实例', gwState, '', sAt);
    push('health', 'gateway.active_agents', gw?.active_agents ?? null, '个', '实例', gwState, '', sAt);
    push('health', 'gateway.version', gw?.version ?? null, '', '实例', gwState, '', sAt);
    const today = gw?.metrics_today;
    push('health', 'metrics_today.requests', today?.requests ?? null, '次', '实例', gwState, 'today', sAt);
    push('health', 'metrics_today.messages', today?.messages ?? null, '条', '实例', gwState, 'today', sAt);
    push('health', 'metrics_today.tokens', today?.tokens ?? null, 'tokens', '实例', gwState, 'today', sAt);
    push('health', 'metrics_today.latency_p95_ms', today?.latency_p95_ms ?? null, 'ms', '实例', gwState, 'today', sAt);
    const sys = s.system;
    push('health', 'system.cpu_percent', sys?.cpu_percent ?? null, '%', '实例', sysState, '', sAt);
    push('health', 'system.memory.percent', sys?.memory?.percent ?? null, '%', '实例', sysState, '', sAt);
    push('health', 'system.disk.percent', sys?.disk?.percent ?? null, '%', '实例', sysState, '', sAt);
    push('health', 'system.process.num_threads', sys?.process?.num_threads ?? null, '个', '实例', sysState, '', sAt);
    const ses = s.sessions_stats;
    push('health', 'sessions.total', ses?.total ?? null, '个', '实例', sesState, '', sAt);
    push('health', 'sessions.active_store', ses?.active_store ?? null, '个', '实例', sesState, '', sAt);
    push('health', 'sessions.messages', ses?.messages ?? null, '条', '实例', sesState, '', sAt);
  }
  const u = input.usage;
  const uAt = input.fetched.usage;
  if (u) {
    const win = `${input.days}d`;
    const usageState = u.sources?.dashboard_usage?.state ?? 'degraded';
    const tok = u.tokens;
    push('usage', 'tokens.total_input', tok?.total_input ?? null, 'tokens', '实例', usageState, win, uAt);
    push('usage', 'tokens.total_output', tok?.total_output ?? null, 'tokens', '实例', usageState, win, uAt);
    push('usage', 'tokens.total_cache_read', tok?.total_cache_read ?? null, 'tokens', '实例', usageState, win, uAt);
    push('usage', 'tokens.total_reasoning', tok?.total_reasoning ?? null, 'tokens', '实例', usageState, win, uAt);
    const cost = u.cost;
    const priced = cost && cost.cost_usd !== null && cost.cost_usd !== undefined && cost.cost_status !== 'unknown';
    push('usage', 'cost.cost_usd', priced ? cost.cost_usd : null, 'USD', '租户账本', 'ok', win, uAt);
    push('usage', 'cost.cost_status', cost?.cost_status ?? 'unknown', '', '租户账本', 'ok', win, uAt);
    push('usage', 'cost.rows', cost?.rows ?? null, '行', '租户账本', 'ok', win, uAt);
    const attr = u.attribution;
    const attrState = attr?.state ?? 'degraded';
    push('usage', 'attribution.mapped_sessions', attr?.mapped_sessions ?? null, '个', '租户账本', attrState, win, uAt);
    push('usage', 'attribution.unattributed.sessions', attr?.unattributed?.sessions ?? null, '个', '租户账本', attrState, win, uAt);
  }
  const h = input.heat;
  if (h) {
    push('heat', 'activity.max', h.max > 0 ? h.max : null, '次/时', '实例(R7)', 'ok', '28d', input.fetched.heat);
    push('heat', 'activity.total', h.total > 0 ? h.total : null, '次', '实例(R7)', 'ok', '28d', input.fetched.heat);
  }
  rows.push('# 口径：数量来自 Hermes，金额来自本租户账本，不可换算');
  return rows.join('\n');
}

/** metrics-YYYYMMDD-HHmm.csv in Beijing time (SPEC §1.2). */
export function exportFileName(now = new Date()): string {
  const d = new Date(now.getTime() + 480 * 60000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `metrics-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}.csv`;
}

// ---------- error envelope → copy family (SPEC §2 分流, by CODE not text) ----------

export type ErrorFamily =
  | 'login' // 401 console.unauthenticated → redirect, never a page
  | 'upstreamToken' // 401 request.invalid_token → in-card config copy
  | 'forbidden' // 403 console.forbidden → whole-page card
  | 'internalOnly' // 403 runtime.internal_only → config copy, no redirect
  | 'unconfigured' // 503 runtime.*_unconfigured → service-not-wired copy
  | 'upstreamUnavailable' // 502 upstream.unavailable → retry copy
  | 'invalidQuery' // 422 request.invalid_query → params rejected, no rewrite
  | 'notFound' // 404 → metric not deployed yet
  | 'generic';

export function errorFamily(status: number, code: string | undefined): ErrorFamily {
  if (status === 401) {
    if (code === 'console.unauthenticated') return 'login';
    if (code === 'request.invalid_token') return 'upstreamToken';
    return 'generic';
  }
  if (status === 403) {
    if (code === 'runtime.internal_only') return 'internalOnly';
    return 'forbidden';
  }
  if (status === 503 && code && /^runtime\..*_unconfigured$/.test(code)) return 'unconfigured';
  if (status === 502 && code === 'upstream.unavailable') return 'upstreamUnavailable';
  if (status === 422) return 'invalidQuery';
  if (status === 404) return 'notFound';
  return 'generic';
}