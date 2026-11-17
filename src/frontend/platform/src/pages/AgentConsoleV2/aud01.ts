/**
 * AUD-01 `/agent/audit` pure helpers + read-only adapter
 * (AUD01-TARGET-SPEC.md §1.5/§1.7/§1.8/§2/§7).
 *
 * Everything here is contract-shaped, not UI-shaped:
 * - A3 `GET /api/audit` → `{ events, nextCursor? }`; the last page OMITS the
 *   cursor key. The BFF rejects an unfiltered query (400 console.missing_filter)
 *   and the upstream rejects a too-broad one (audit.query_too_broad), so this
 *   module never builds a filter-less request (`hasAnyAuditFilter`).
 * - A7 `GET /api/audit-verify` → `{ok, complete, scanned}` + conditional keys.
 *   Green is allowed ONLY when ok && complete && scanned>0 && anchor exists —
 *   `complete=false` (truncated at 100,000) must never look green (§1.6).
 * - The two "same window" notions differ on purpose: the LIST filters
 *   `occurred_at` closed/closed, the CHAIN check reads `recorded_at`
 *   half-open `[from,to)`. They are computed by separate functions here.
 *
 * Security: every string below is upstream free text. Helpers only format or
 * classify — they never build markup. Rendering is the page's job and always
 * goes through React children (no innerHTML anywhere).
 */
import { AuthError, type ApiResult } from '@/controllers/API/agent';

import { actorLabel, resourceTypeLabel } from './identity';

// ---------- A3 shapes (audit.py `_PUBLIC_OPTIONAL`, audit_query.py) ----------

export interface AuditActor {
  type: string;
  id: string;
  displayName?: string;
}

export interface AuditResource {
  type: string;
  id: string;
  ownerRef?: string;
  scopeRef?: string;
}

export interface AuditError {
  code?: string;
  messageRedacted?: string;
}

/**
 * One audit event. Ten keys are always present; the optional ones are absent
 * (not null) when the thing never happened — absence means "did not happen",
 * never "empty value" (§2.2).
 */
export interface AuditEvent {
  eventId: string;
  schemaVersion: string | number;
  tenantId: string;
  occurredAt: string;
  recordedAt: string;
  sourceSystem: string;
  actor: AuditActor;
  action: string;
  resource: AuditResource;
  outcome: string;
  onBehalfOf?: string;
  responsibleHumanId?: string;
  responsibleUnresolvedReason?: string;
  decision?: string;
  runId?: string;
  taskId?: string;
  policyDecisionId?: string;
  approvalId?: string;
  employeeVersionRef?: string;
  policySnapshotRef?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  payloadRef?: string;
  correlationId?: string;
  error?: AuditError;
  prevHash?: string;
  hash?: string;
}

export interface AuditListShape {
  events: AuditEvent[];
  /** Absent on the last page (key omission, not null). */
  nextCursor?: string;
}

/** A3 filter params — cursor is pagination, NOT a filter (`audit_query.py:163`). */
export interface ListAuditParams {
  runId?: string;
  taskId?: string;
  actorId?: string;
  resourceId?: string;
  action?: string;
  /** ISO-8601 lower bound on `occurredAt` (closed). */
  from?: string;
  /** ISO-8601 upper bound on `occurredAt` (closed). */
  to?: string;
  limit?: number;
  cursor?: string;
}

// ---------- A7 shapes (audit_verify.py) ----------

export interface AuditVerifyResult {
  ok: boolean;
  complete: boolean;
  scanned: number;
  brokenCount?: number;
  brokenEventIds?: string[];
  anchorCheckpointId?: string;
  preAnchorEventCount?: number;
  chainHeadHash?: string;
}

/** `BROKEN_IDS_LIMIT` in audit_verify.py — beyond it the UI must say "first 20". */
export const BROKEN_IDS_LIMIT = 20;

/**
 * Green gate (spec §1.6 first line): ALL FOUR must hold. Anything else stays
 * neutral / warning / danger — `ok` alone is not evidence (§9 item 5).
 */
export function isVerifyGreen(r: AuditVerifyResult | null | undefined): boolean {
  return (
    !!r && r.ok === true && r.complete === true && r.scanned > 0 && !!r.anchorCheckpointId
  );
}

export type VerifyState = 's0' | 's1' | 's2' | 's3' | 's4';

/**
 * Classify an A7 response into one of the four non-error states.
 * Order matters: a broken chain (ok=false) outranks truncation, and
 * `complete=false` outranks the green gate (the S2 "looks fine" trap).
 */
export function classifyVerify(r: AuditVerifyResult | null | undefined): Exclude<VerifyState, 's4'> {
  if (!r) return 's0';
  if (r.ok === false) return 's3';
  if (r.complete !== true) return 's2';
  if (isVerifyGreen(r)) return 's1';
  return 's0';
}

// ---------- adapter ----------

export interface AuditApiResult<T> extends ApiResult<T> {
  /** Echoed by the BFF when the gateway supplies it (S4 「报障时提供这个号」). */
  requestId?: string;
}

export interface AuditApi {
  /** A3. Never called without at least one real filter. */
  listAudit(params: ListAuditParams): Promise<AuditApiResult<AuditListShape>>;
  /** A7. Both bounds are mandatory upstream. */
  verifyAudit(params: { from: string; to: string }): Promise<AuditApiResult<AuditVerifyResult>>;
}

export interface HttpAuditApiOptions {
  /** Same-origin prefix routed to the console BFF. */
  base?: string;
  getToken?: () => string | null;
  /** First-paint guard: the loading screen promises ~10s, so honour it. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** GET through the console BFF, returning status/code instead of throwing. */
export function createHttpAuditApi(options: HttpAuditApiOptions = {}): AuditApi {
  /* Same-origin prefix routed by Caddy to the console BFF; every path below
   * keeps the BFF's own `/api/` segment (`/agent-api/api/…`), exactly like
   * createHttpAgentConsoleApi's `/api/tasks` and createHttpAgentConsoleRunsApi's
   * `/api/runs`. Dropping it yields a Caddy 404 — the AUD-01 VG block. */
  const base = options.base ?? '/agent-api';
  const getToken =
    options.getToken ??
    (() => (typeof localStorage !== 'undefined' ? localStorage.getItem('ws_token') : null));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function get<T>(path: string, params: Record<string, string | number | undefined>) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') qs.set(key, String(value));
    }
    const query = qs.toString();
    const url = `${base}${path}${query ? `?${query}` : ''}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let res: Response;
    try {
      res = await fetch(url, { headers, signal: controller?.signal });
    } catch {
      // Network / abort: honest "could not reach it" — status 0, never a
      // login redirect (that is 401 only) and never fabricated data.
      return {
        ok: false,
        status: 0,
        data: null,
        code: controller?.signal.aborted ? 'console.timeout' : 'console.network',
      } satisfies AuditApiResult<T>;
    } finally {
      if (timer) clearTimeout(timer);
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
        requestId: res.headers?.get?.('x-console-request-id') ?? res.headers?.get?.('x-request-id') ?? undefined,
      } satisfies AuditApiResult<T>;
    }
    return {
      ok: true,
      status: res.status,
      data: (body ?? {}) as T,
      requestId: res.headers?.get?.('x-console-request-id') ?? res.headers?.get?.('x-request-id') ?? undefined,
    } satisfies AuditApiResult<T>;
  }

  return {
    async listAudit(params) {
      const res = await get<AuditListShape>('/api/audit', {
        runId: params.runId,
        taskId: params.taskId,
        actorId: params.actorId,
        resourceId: params.resourceId,
        action: params.action,
        from: params.from,
        to: params.to,
        limit: params.limit,
        cursor: params.cursor,
      });
      if (!res.ok || !res.data) return res;
      const body = res.data as AuditListShape & { items?: AuditEvent[] };
      // Live A3 wraps rows under `events`; tolerate `items` for the stubs.
      const events = Array.isArray(body.events) ? body.events : (body.items ?? []);
      return {
        ...res,
        data: { events, nextCursor: body.nextCursor ?? undefined },
      };
    },

    verifyAudit({ from, to }) {
      return get<AuditVerifyResult>('/api/audit-verify', { from, to });
    },
  };
}

// ---------- query state (URL is the single source, spec §7 深链) ----------

export const LIST_LIMITS = [20, 50, 100, 200] as const;
export const DEFAULT_LIMIT = 50;
export type WindowKey = '24h' | '7d' | '30d' | 'custom';
export const DEFAULT_WINDOW: WindowKey = '24h';

const WINDOW_HOURS: Record<Exclude<WindowKey, 'custom'>, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
};

export interface AuditQuery {
  window: WindowKey;
  /** Custom window bounds (ISO); empty = that bound is not used. */
  from: string;
  to: string;
  runId: string;
  taskId: string;
  actorId: string;
  resourceId: string;
  action: string;
  limit: number;
  cursor: string | null;
}

export function emptyQuery(): AuditQuery {
  return {
    window: DEFAULT_WINDOW,
    from: '',
    to: '',
    runId: '',
    taskId: '',
    actorId: '',
    resourceId: '',
    action: '',
    limit: DEFAULT_LIMIT,
    cursor: null,
  };
}

/**
 * LIST window: `occurred_at` closed/closed (repository.page_audit_events).
 * Both bounds are sent so the request always carries a real filter.
 */
export function listRange(q: AuditQuery, nowMs = Date.now()): { from?: string; to?: string } {
  if (q.window === 'custom') {
    return { from: q.from || undefined, to: q.to || undefined };
  }
  const hours = WINDOW_HOURS[q.window];
  return {
    from: new Date(nowMs - hours * 3600_000).toISOString(),
    to: new Date(nowMs).toISOString(),
  };
}

/** At least one A3 filter present — mirrors the BFF `require_any` guard. */
export function hasAnyAuditFilter(q: AuditQuery, nowMs = Date.now()): boolean {
  const { from, to } = listRange(q, nowMs);
  return [q.runId, q.taskId, q.actorId, q.resourceId, q.action, from, to].some(
    (v) => typeof v === 'string' && v !== '',
  );
}

export function requestParams(q: AuditQuery, nowMs = Date.now()): ListAuditParams {
  const { from, to } = listRange(q, nowMs);
  return {
    runId: q.runId || undefined,
    taskId: q.taskId || undefined,
    actorId: q.actorId || undefined,
    resourceId: q.resourceId || undefined,
    action: q.action || undefined,
    from,
    to,
    limit: q.limit,
  };
}

/** Stable identity for the cursor hook's reset signal. */
export function filterSignature(q: AuditQuery): string {
  return [
    q.window,
    q.from,
    q.to,
    q.runId,
    q.taskId,
    q.actorId,
    q.resourceId,
    q.action,
    q.limit,
  ].join('|');
}

const WINDOW_KEYS: WindowKey[] = ['24h', '7d', '30d', 'custom'];

export function readAuditQuery(search: string): AuditQuery {
  const base = emptyQuery();
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(search);
  } catch {
    return base;
  }
  const window = p.get('window');
  const limit = Number(p.get('limit'));
  return {
    window: WINDOW_KEYS.includes(window as WindowKey) ? (window as WindowKey) : base.window,
    from: p.get('from') ?? '',
    to: p.get('to') ?? '',
    runId: p.get('runId') ?? '',
    taskId: p.get('taskId') ?? '',
    actorId: p.get('actorId') ?? '',
    resourceId: p.get('resourceId') ?? '',
    action: p.get('action') ?? '',
    limit: (LIST_LIMITS as readonly number[]).includes(limit) ? limit : base.limit,
    cursor: p.get('cursor') || null,
  };
}

/** `history.replaceState` only — filters never stack history entries (§7). */
export function writeAuditQuery(q: AuditQuery): void {
  try {
    const p = new URLSearchParams(window.location.search);
    p.set('window', q.window);
    const pairs: Array<[string, string]> = [
      ['from', q.from],
      ['to', q.to],
      ['runId', q.runId],
      ['taskId', q.taskId],
      ['actorId', q.actorId],
      ['resourceId', q.resourceId],
      ['action', q.action],
    ];
    for (const [key, value] of pairs) {
      if (value) p.set(key, value);
      else p.delete(key);
    }
    p.set('limit', String(q.limit));
    // Cursor goes into the URL for refresh-restore only (spec §7 深链).
    if (q.cursor) p.set('cursor', q.cursor);
    else p.delete('cursor');
    const qs = p.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  } catch {
    /* history unavailable: filters keep working in memory */
  }
}

// ---------- search dispatch (spec §1.5 F2) ----------

export type SearchTarget =
  | { kind: 'runId' | 'taskId' | 'resourceId' | 'action'; value: string }
  | { kind: 'employee'; value: string }
  | { kind: 'event'; value: string };

/**
 * Prefix dispatch. Exact IDs only — audit has no full-text index, so this is
 * never a fuzzy search. `ev_` is recognised but NOT queryable (details belong
 * to AUD-02, A4 is per-event), and `emp_` asks the operator to choose a side
 * instead of guessing (§1.5 F3).
 */
export function dispatchSearch(text: string): SearchTarget | null {
  const value = wireText(text).trim();
  if (!value) return null;
  if (value.startsWith('rn_')) return { kind: 'runId', value };
  if (value.startsWith('tk_')) return { kind: 'taskId', value };
  if (value.startsWith('ap_')) return { kind: 'resourceId', value };
  if (value.startsWith('emp_')) return { kind: 'employee', value };
  if (value.startsWith('ev_')) return { kind: 'event', value };
  return { kind: 'action', value };
}

// ---------- wire-value hygiene ----------

/**
 * Text from a JSON wire value.
 *
 * `schemaVersion: 1` (a number, which the live API really sends) used to reach
 * `String#trim()` and crash a whole page — the E11 class of defect. Every
 * wire-shaped helper coerces through here first, so a drifted producer can
 * cost a wrong word but never a white screen.
 */
export function wireText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/**
 * Enum identity: a known value is matched case-insensitively (`EMPLOYEE` →
 * `employee`) so the localized word still resolves; an unlisted value keeps
 * its original spelling and is rendered verbatim (未收录不机翻).
 */
export function normalizeEnum(value: unknown, known: ReadonlySet<string>): string {
  const raw = wireText(value);
  const lower = raw.trim().toLowerCase();
  return known.has(lower) ? lower : raw;
}

/** Known actor types (AUD-01/AUD-02 share this enum). */
export const ACTOR_TYPES: ReadonlySet<string> = new Set([
  'human',
  'employee',
  'service',
  'system',
]);

/** Readable actor line; upper-case enum variants resolve like their known form. */
export function actorText(
  actor: AuditActor | null | undefined,
  names: Map<string, string> | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const type = normalizeEnum(actor?.type, ACTOR_TYPES);
  const id = wireText(actor?.id);
  const displayName = wireText(actor?.displayName) || undefined;
  if (!type && !id && !displayName) return t('agentConsole.v2.id.unknown');
  return actorLabel({ type, id, displayName }, names, t);
}

/**
 * Resource type word (`EMPLOYEE` → 「员工」). The identity module knows the
 * translated set; an unlisted type keeps its raw spelling.
 */
export function resourceWord(
  type: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const raw = wireText(type);
  const lower = raw.trim().toLowerCase();
  const word = resourceTypeLabel(lower, t);
  return word === lower ? raw : word;
}

/** True for an employee resource, regardless of the wire's letter case. */
export function isEmployeeResource(type: unknown): boolean {
  return wireText(type).trim().toLowerCase() === 'employee';
}

// ---------- value maps (spec §1.7 C2/C3/C6/C7) ----------

export const SOURCE_LABEL_KEYS: Record<string, string> = {
  employee: 'sourceEmployee',
  policy: 'sourcePolicy',
  approval: 'sourceApproval',
  runtime: 'sourceRuntime',
  channel: 'sourceChannel',
  bisheng: 'sourceBisheng',
  console: 'sourceConsole',
};

const SOURCE_VALUES: ReadonlySet<string> = new Set(Object.keys(SOURCE_LABEL_KEYS));

/** Source-system word (7 known values, case-insensitive); unlisted stays verbatim. */
export function sourceWord(
  source: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const raw = wireText(source);
  const key = SOURCE_LABEL_KEYS[normalizeEnum(raw, SOURCE_VALUES)];
  return key ? t(`agentConsole.v2.aud01.${key}`) : raw;
}

/**
 * Exact action → label. Unknown actions render the RAW value in mono and get
 * no invented Chinese name (未收录不机翻, §1.7 C3).
 */
export const ACTION_LABEL_KEYS: Record<string, string> = {
  'grant.created': 'actionGrantCreated',
  'employee.version.create': 'actionEmployeeVersionCreate',
  'employee.lifecycle.update': 'actionEmployeeLifecycleUpdate',
  'workstation.bound': 'actionWorkstationBound',
  'message.send': 'actionMessageSend',
  'approval.decided': 'actionApprovalDecided',
  'policy.check': 'actionPolicyCheck',
  'kb.read': 'actionKbRead',
};

const ACTION_VALUES: ReadonlySet<string> = new Set(Object.keys(ACTION_LABEL_KEYS));

/** Label key for a known action, or null when the action is unlisted. */
export function actionLabelKey(action: unknown): string | null {
  return ACTION_LABEL_KEYS[normalizeEnum(action, ACTION_VALUES)] ?? null;
}

/** `not_applicable` is handled separately: `—` with its own tooltip (G-05). */
export const DECISION_KEYS: Record<string, string> = {
  allow: 'decisionAllow',
  deny: 'decisionDeny',
  require_approval: 'decisionRequireApproval',
  approved: 'decisionApproved',
  rejected: 'decisionRejected',
};

export const OUTCOME_KEYS: Record<string, string> = {
  success: 'outcomeSuccess',
  failure: 'outcomeFailure',
  denied: 'outcomeDenied',
  pending: 'outcomePending',
};

const DECISION_VALUES: ReadonlySet<string> = new Set([...Object.keys(DECISION_KEYS), 'not_applicable']);
const OUTCOME_VALUES: ReadonlySet<string> = new Set(Object.keys(OUTCOME_KEYS));

/** Wire decision → known enum key, or the raw value when unlisted. */
export function decisionEnum(decision: unknown): string {
  return normalizeEnum(decision, DECISION_VALUES);
}

/** Wire outcome → known enum key, or the raw value when unlisted. */
export function outcomeEnum(outcome: unknown): string {
  return normalizeEnum(outcome, OUTCOME_VALUES);
}

/** Pill tone suffixes. `not_applicable`/absent never get a semantic colour. */
export function decisionTone(decision: string | undefined): string {
  const d = decisionEnum(decision);
  if (d === 'allow' || d === 'approved') return 'ok';
  if (d === 'deny' || d === 'rejected') return 'dg';
  if (d === 'require_approval') return 'wr';
  return '';
}

export function outcomeTone(outcome: string | undefined): string {
  const o = outcomeEnum(outcome);
  if (o === 'success') return 'ok';
  if (o === 'failure' || o === 'denied') return 'dg';
  if (o === 'pending') return 'wr';
  return '';
}

export function actorIcon(type: unknown): string {
  const t = normalizeEnum(type, ACTOR_TYPES);
  if (t === 'human') return 'user';
  if (t === 'employee') return 'users';
  if (t === 'service') return 'server';
  if (t === 'system') return 'cpu';
  return 'user';
}

// ---------- time formatting ----------

const SHANGHAI = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

interface Parts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

function shParts(iso: string): Parts | null {
  const ms = Date.parse(wireText(iso));
  if (!Number.isFinite(ms)) return null;
  const out: Record<string, string> = {};
  for (const p of SHANGHAI.formatToParts(new Date(ms))) out[p.type] = p.value;
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour,
    minute: out.minute,
  };
}

/** C1 display: `MM-DD HH:mm`, `YYYY-` prefixed when not the current year. */
export function formatOccurred(iso: string, nowMs = Date.now()): string {
  const p = shParts(iso);
  if (!p) return '—';
  const nowYear = shParts(new Date(nowMs).toISOString())?.year;
  const head = p.year === nowYear ? '' : `${p.year}-`;
  return `${head}${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** Meta row / freshness stamp — same Shanghai wall clock. */
export function formatStamp(iso: string): string {
  const p = shParts(iso);
  if (!p) return '—';
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** Verify window readout: `2026-11-16T09:20Z` (minutes resolution, UTC). */
export function formatUtcMinute(iso: string): string {
  const ms = Date.parse(wireText(iso));
  if (!Number.isFinite(ms)) return '—';
  return `${new Date(ms).toISOString().slice(0, 16)}Z`;
}

/** S1: the same readout in Shanghai wall clock `2026-11-16 17:20`. */
export function formatShanghaiMinute(iso: string): string {
  const p = shParts(iso);
  if (!p) return '—';
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** recordedAt − occurredAt, `+0.8s` style; null when either is unparsable. */
export function formatLatency(occurredAt: string, recordedAt: string): string | null {
  const a = Date.parse(wireText(occurredAt));
  const b = Date.parse(wireText(recordedAt));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const ms = b - a;
  const sign = ms < 0 ? '−' : '+';
  const abs = Math.abs(ms);
  if (abs < 1000) return `${sign}${abs}ms`;
  if (abs < 60_000) return `${sign}${(abs / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(abs / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${sign}${m}m${String(s).padStart(2, '0')}s`;
}

/** >5min between occurredAt and recordedAt ⇒ 「钟差」 (spec §1.7 C1). */
export const CLOCK_SKEW_MS = 5 * 60 * 1000;

export function clockSkewMs(occurredAt: string, recordedAt: string): number {
  const a = Date.parse(wireText(occurredAt));
  const b = Date.parse(wireText(recordedAt));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.abs(b - a);
}

export function formatSpan(ms: number): string {
  const totalSeconds = Math.round(Math.abs(ms) / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  return `${m}m${String(s).padStart(2, '0')}s`;
}

// ---------- ID display ----------

/**
 * Visual truncation ONLY — full value stays in title/copy (§3). Hash IDs keep
 * more tail (they are compared by suffix), everything else keeps prefix+4…4.
 */
export function shortId(id: string | undefined): string {
  const text = wireText(id);
  if (!text.trim()) return '—';
  if (text.startsWith('ah_')) {
    return text.length <= 14 ? text : `ah_${text.slice(3, 7)}…${text.slice(-6)}`;
  }
  const us = text.indexOf('_');
  if (us > 0 && us <= 4 && text.length > us + 9) {
    return `${text.slice(0, us + 5)}…${text.slice(-4)}`;
  }
  if (text.length <= 14) return text;
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

/** `human:u_10001` → `u_10001`; anything else unchanged (never invented). */
export function onBehalfDisplay(onBehalfOf: string): string {
  const raw = wireText(onBehalfOf);
  return raw.startsWith('human:') ? raw.slice('human:'.length) : raw;
}

// ---------- row expansion: field diff (spec §1.8) ----------

export interface DiffRow {
  kind: 'add' | 'del' | 'chg';
  key: string;
  before?: unknown;
  after?: unknown;
}

export interface DiffResult {
  rows: DiffRow[];
  /** Keys present on both sides with equal values (contract says impossible). */
  sameKeys: string[];
  /** Any single value whose JSON form exceeds 4KB (§1.8 data-quality warning). */
  oversized: boolean;
}

export const OVERSIZED_VALUE_BYTES = 4096;

function valueText(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return '';
  }
}

function byteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  return text.length * 2;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Key-level diff. Only `after` → add (+), only `before` → del (−), both and
 * different → chg (~); equal values are NOT rendered (contract stores diffs).
 */
export function diffRows(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): DiffResult {
  const b = isPlainObject(before) ? before : {};
  const a = isPlainObject(after) ? after : {};
  const keys: string[] = [];
  for (const key of Object.keys(b)) keys.push(key);
  for (const key of Object.keys(a)) if (!keys.includes(key)) keys.push(key);

  const rows: DiffRow[] = [];
  const sameKeys: string[] = [];
  let oversized = false;

  for (const key of keys) {
    const hasB = Object.prototype.hasOwnProperty.call(b, key);
    const hasA = Object.prototype.hasOwnProperty.call(a, key);
    if (hasB && byteLength(valueText(b[key])) > OVERSIZED_VALUE_BYTES) oversized = true;
    if (hasA && byteLength(valueText(a[key])) > OVERSIZED_VALUE_BYTES) oversized = true;

    if (hasA && !hasB) rows.push({ kind: 'add', key, after: a[key] });
    else if (hasB && !hasA) rows.push({ kind: 'del', key, before: b[key] });
    else if (valueText(b[key]) !== valueText(a[key])) {
      rows.push({ kind: 'chg', key, before: b[key], after: a[key] });
    } else {
      sameKeys.push(key);
    }
  }
  return { rows, sameKeys, oversized };
}

/** Objects/arrays are shown as one-line JSON by default (§1.8). */
export function isStructured(v: unknown): boolean {
  return typeof v === 'object' && v !== null;
}

// ---------- verify window (independent of the list window, §1.4) ----------

export const VERIFY_WINDOWS = ['1h', '24h', '7d', '30d'] as const;
export type VerifyWindow = (typeof VERIFY_WINDOWS)[number];
export const DEFAULT_VERIFY_WINDOW: VerifyWindow = '24h';

const VERIFY_HOURS: Record<VerifyWindow, number> = {
  '1h': 1,
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
};

/** `recorded_at` half-open `[from,to)` — a different window from the list. */
export function verifyRange(w: VerifyWindow, nowMs = Date.now()): { from: string; to: string } {
  const hours = VERIFY_HOURS[w];
  return {
    from: new Date(nowMs - hours * 3600_000).toISOString(),
    to: new Date(nowMs).toISOString(),
  };
}

// ---------- misc ----------

/** Locale-aware integer grouping (1,284). */
export function groupNumber(n: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(n);
  } catch {
    return String(n);
  }
}