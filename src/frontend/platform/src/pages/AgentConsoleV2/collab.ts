/**
 * COL-01 `/agent/collab` — read-only collaboration view: shapes, adapter and
 * pure helpers (COLLAB-TARGET-SPEC §1–§5, DELEGATION v1.0).
 *
 * Contract-shaped, not UI-shaped:
 * - `GET /api/delegations` → `{ items: [{ delegationId, requestId,
 *   fromEmployeeId, toEmployeeId, taskId, status, createdAt, updatedAt,
 *   budget?{ ownerEmployeeId, usedCostUsd, capCostUsd } }] }`
 * - `GET /api/delegations/:id/chain` → `{ items: [{ phase, at, actor, note? }] }`
 *   in chronological order (the BFF owns the ordering; this module never sorts
 *   the chain, so "先发生" cannot be invented client-side).
 *
 * Money rule: no currency symbol, no conversion. The only derived number the
 * spec allows is the used-percentage INSIDE the owner's ledger (`已用 x%`);
 * every absolute amount stays backend-only and is never rendered here.
 *
 * Identity rule: raw ids never reach the DOM. Employee ids resolve through the
 * directory and otherwise degrade to 「员工 · 8 位大写短码」 (PRD v0.3 §1 L5) —
 * never a bare `emp_…`.
 *
 * The write surface (accept / reject / handoff / complete) is NOT here: the
 * BFF write routes are not wired yet, so the page renders one static note and
 * zero controls (spec §2, E06).
 */
import type { TFunction } from 'i18next';

import type { EmployeeSummary } from '@/controllers/API/agent';

import { makeFetcher } from './v2Data';

// ---------------------------------------------------------------- shapes

export interface DelegationBudget {
  /** DELEGATION v1.0 CHECK: budget owner is always the requesting employee. */
  ownerEmployeeId?: string;
  usedCostUsd?: number | null;
  capCostUsd?: number | null;
}

export interface DelegationRow {
  delegationId: string;
  requestId?: string;
  fromEmployeeId: string;
  toEmployeeId: string;
  taskId: string;
  /** `requested | accepted | handed_off | completed | rejected | expired`;
   *  kept as a string because an unknown future value must not crash the list. */
  status: string;
  createdAt?: string;
  updatedAt?: string;
  /** The task title when the query face carries it; absent is normal. */
  title?: string;
  budget?: DelegationBudget | null;
}

export interface DelegationListShape {
  items: DelegationRow[];
  /** Server read time (ISO). Preferred over the client clock for 「读取于」. */
  asOf?: string;
  /** Cursor pagination; absent/null means this is the last page. */
  nextCursor?: string | null;
}

export interface ChainItem {
  phase: string;
  at: string;
  /** String id or object — the wire face is not frozen in the page contract,
   *  so both shapes are normalized before display. */
  actor?: unknown;
  note?: string;
}

export interface ChainShape {
  items: ChainItem[];
}

/** Local structural twin of the shared `ApiRes` so pages/tests can inject. */
export interface CollabApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  code?: string;
  message?: string;
  requestId?: string;
}

/** The four contract actions; `handoff`/`complete` are addressed by delegation
 *  id on the BFF proxy (the proxy maps it to the task endpoint). */
export type DelegationAction = 'accept' | 'reject' | 'handoff' | 'complete';

export interface DelegationWriteBody {
  /** reject only; required by the page (the contract allows it optional). */
  reason?: string;
  /** complete only; required by the contract. */
  progressNote?: string;
}

export interface CollabApi {
  listDelegations(cursor?: string): Promise<CollabApiResult<DelegationListShape>>;
  getChain(delegationId: string): Promise<CollabApiResult<ChainShape>>;
  submitDelegationAction(
    action: DelegationAction,
    delegationId: string,
    body: DelegationWriteBody,
    requestId: string,
  ): Promise<CollabApiResult<unknown>>;
}

export interface HttpCollabApiOptions {
  /** Same-origin prefix routed to the console BFF (`/agent-api/api/…`). */
  base?: string;
  getToken?: () => string | null;
}

const WRITE_TIMEOUT_MS = 10_000;

function resolveToken(getToken?: () => string | null): string | null {
  if (getToken) return getToken();
  try {
    return localStorage.getItem('ws_token');
  } catch {
    return null;
  }
}

/**
 * Writes cannot reuse `makeFetcher` (GET only). Same trace contract:
 * `X-Console-Request-Id` in, JSON body out, 10s budget, and `X-Request-Id`
 * carrying the page's one-per-submission key so a retry stays traceable.
 */
async function postJson(
  base: string,
  path: string,
  body: unknown,
  options: { getToken?: () => string | null; requestId: string },
): Promise<CollabApiResult<unknown>> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), WRITE_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Request-Id': options.requestId,
    };
    const token = resolveToken(options.getToken);
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const requestId = response.headers.get('X-Console-Request-Id') ?? undefined;
    const text = await response.text().catch(() => '');
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    const record = (parsed ?? {}) as { code?: unknown; message?: unknown };
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data: null,
        code: typeof record.code === 'string' ? record.code : `agent.http.${response.status}`,
        message: typeof record.message === 'string' ? record.message : undefined,
        requestId,
      };
    }
    return { ok: true, status: response.status, data: parsed, requestId };
  } catch (error) {
    const aborted = (error as { name?: string } | null)?.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      data: null,
      code: aborted ? 'console.timeout' : 'console.network',
    };
  } finally {
    window.clearTimeout(timer);
  }
}

/** The BFF owns `/agent-api`; every path keeps its own `/api/` segment. */
export function createHttpCollabApi(options: HttpCollabApiOptions = {}): CollabApi {
  const base = options.base ?? '/agent-api';
  const fetcher = makeFetcher(base, options.getToken);
  return {
    listDelegations: (cursor?: string) =>
      fetcher<DelegationListShape>(
        cursor ? `/api/delegations?cursor=${encodeURIComponent(cursor)}` : '/api/delegations',
      ),
    getChain: (delegationId) =>
      fetcher<ChainShape>(`/api/delegations/${encodeURIComponent(delegationId)}/chain`),
    submitDelegationAction: (action, delegationId, body, requestId) =>
      postJson(base, `/api/delegations/${encodeURIComponent(delegationId)}/${action}`, body, {
        getToken: options.getToken,
        requestId,
      }),
  };
}

/** Which action the current stage allows (DELEGATION §2); requests allow two. */
export function nextActions(status: string): DelegationAction[] {
  if (status === 'requested') return ['accept', 'reject'];
  if (status === 'accepted') return ['handoff'];
  if (status === 'handed_off') return ['complete'];
  return [];
}

/** Human sentence key for a failed write; the raw code never reaches the body. */
export function writeErrorKey(status: number, code?: string): string {
  const ns = 'agentConsole.v2.collab.write.error';
  if (status === 0) return code === 'console.timeout' ? `${ns}.timeout` : `${ns}.network`;
  if (status === 401) return `${ns}.unauthorized`;
  if (status === 403) return `${ns}.noMandate`;
  if (status === 404) return `${ns}.notFound`;
  if (status === 409 || code === 'delegation.illegal_transition') return `${ns}.conflict`;
  if (status === 400) return `${ns}.invalid`;
  return `${ns}.server`;
}

// ---------------------------------------------------------------- status

export type DelegationStatus =
  | 'requested'
  | 'accepted'
  | 'handed_off'
  | 'completed'
  | 'rejected'
  | 'expired';

export const RAIL_STAGES: Array<{ key: Exclude<DelegationStatus, 'rejected' | 'expired'>; rank: number }> = [
  { key: 'requested', rank: 0 },
  { key: 'accepted', rank: 1 },
  { key: 'handed_off', rank: 2 },
  { key: 'completed', rank: 3 },
];

const STATUS_RANK: Record<string, number> = {
  requested: 0,
  accepted: 1,
  handed_off: 2,
  completed: 3,
};

export function isKnownStatus(status: string): status is DelegationStatus {
  return status in STATUS_RANK || status === 'rejected' || status === 'expired';
}

/** The brief's five labels win over the target deck's 「已交接」 wording; one
 *  mapping feeds the column, the pill, the rail and the timeline heading. */
export function statusLabelKey(status: string): string {
  switch (status) {
    case 'requested':
      return 'agentConsole.v2.collab.status.requested';
    case 'accepted':
      return 'agentConsole.v2.collab.status.accepted';
    case 'handed_off':
      return 'agentConsole.v2.collab.status.handedOff';
    case 'completed':
      return 'agentConsole.v2.collab.status.completed';
    case 'rejected':
      return 'agentConsole.v2.collab.status.rejected';
    case 'expired':
      return 'agentConsole.v2.collab.status.expired';
    default:
      return 'agentConsole.v2.collab.status.unknown';
  }
}

/** Pill tone per status: neutral is the rejected branch (never danger, §3). */
export function statusTone(status: string): 'ok' | 'wr' | 'nt' | 'ac' {
  switch (status) {
    case 'requested':
      return 'wr';
    case 'accepted':
      return 'ac';
    case 'handed_off':
      return 'ac';
    case 'completed':
      return 'ok';
    default:
      return 'nt';
  }
}

/** handed_off and completed read as an open ring on the stage dot (§1.1). */
export function statusDotShape(status: string): 'solid' | 'ring' {
  return status === 'handed_off' ? 'ring' : 'solid';
}

export function isTerminal(status: string): boolean {
  return status === 'completed' || status === 'rejected' || status === 'expired';
}

export type StageState = 'done' | 'current' | 'pending' | 'dead';

export interface StageNode {
  key: Exclude<DelegationStatus, 'rejected' | 'expired'>;
  state: StageState;
}

/**
 * Four-node rail derived from the delegation status alone, so it still renders
 * when the chain request fails. rejected/expired keep the request node and mark
 * the rest dead — 「这条路在这里结束」 is the branch row, not a hidden node.
 */
export function railStages(status: string): StageNode[] {
  if (status === 'rejected' || status === 'expired') {
    return RAIL_STAGES.map((s) => ({
      key: s.key,
      state: s.rank === 0 ? 'done' : 'dead',
    }));
  }
  const rank = STATUS_RANK[status];
  if (rank === undefined) {
    return RAIL_STAGES.map((s) => ({ key: s.key, state: 'pending' }));
  }
  return RAIL_STAGES.map((s) => ({
    key: s.key,
    state: s.rank < rank ? 'done' : s.rank === rank ? 'current' : 'pending',
  }));
}

/** Newest action first; a row without updatedAt keeps its server position. */
export function sortDelegations(items: DelegationRow[]): DelegationRow[] {
  const stamp = (row: DelegationRow): number => {
    const raw = row.updatedAt ?? row.createdAt;
    const ms = raw ? new Date(raw).getTime() : Number.NaN;
    return Number.isNaN(ms) ? 0 : ms;
  };
  return items.slice().sort((a, b) => stamp(b) - stamp(a));
}

// ---------------------------------------------------------------- budget

export type BudgetView =
  | { kind: 'unpriced' }
  | { kind: 'unconfigured' }
  | { kind: 'noLedger'; pct: 0 }
  | { kind: 'pct'; pct: number };

/**
 * The only three sentences the spec allows: 「归发起方」 / 「已用 x%」 /
 * 「上限在发起方账上」. No amount is ever derived; a missing cap is
 * 「未配置」, a missing ledger is 0% with the explicit no-money line.
 */
export function budgetView(budget: DelegationBudget | null | undefined): BudgetView {
  if (!budget) return { kind: 'unpriced' };
  const cap = typeof budget.capCostUsd === 'number' && Number.isFinite(budget.capCostUsd)
    ? budget.capCostUsd
    : null;
  if (cap === null || cap <= 0) return { kind: 'unconfigured' };
  const used =
    typeof budget.usedCostUsd === 'number' && Number.isFinite(budget.usedCostUsd)
      ? budget.usedCostUsd
      : null;
  if (used === null) return { kind: 'noLedger', pct: 0 };
  const pct = Math.max(0, Math.round((used / cap) * 100));
  return { kind: 'pct', pct };
}

/** Bar width is clamped; the printed percentage stays the computed number. */
export function budgetBarWidth(view: BudgetView): number {
  if (view.kind === 'pct') return Math.min(100, Math.max(0, view.pct));
  return 0;
}

// ---------------------------------------------------------------- people

export type EmployeeDirectory = Map<string, { name: string; title: string }>;

export function directoryFrom(rows: EmployeeSummary[] | null | undefined): EmployeeDirectory {
  const map: EmployeeDirectory = new Map();
  for (const row of rows ?? []) {
    map.set(row.employeeId, { name: row.name, title: row.title });
  }
  return map;
}

export function namesFrom(directory: EmployeeDirectory): Map<string, string> {
  const map = new Map<string, string>();
  directory.forEach((value, key) => map.set(key, value.name));
  return map;
}

/**
 * PRD v0.3 §1 L5: an employee reference reads 「员工 · 8 位大写短码」, derived
 * from the id body so two employees never collapse onto the same 4-character
 * tail. A directory name always wins; the code is only the honest fallback.
 */
export function shortCode(id: string | null | undefined): string {
  const body = (id ?? '').replace(/^emp_/i, '').replace(/[^0-9a-zA-Z]/g, '');
  return body.slice(0, 8).toUpperCase();
}

/** Display name for an employee id; never the bare id. */
export function personName(
  id: string | null | undefined,
  names: Map<string, string>,
  t: TFunction,
): string {
  const bare = (id ?? '').trim();
  if (!bare || /^(unknown|none|null|undefined)$/i.test(bare)) {
    return t('agentConsole.v2.id.unknown');
  }
  const name = names.get(bare)?.trim();
  if (name) return name;
  const code = shortCode(bare);
  return code
    ? t('agentConsole.v2.id.employeeRef', { tail: code })
    : t('agentConsole.v2.id.employee');
}

/**
 * 「北京时间到分」 as one string (PRD §1 L5): `2026-11-17 20:12`. `sv-SE` already
 * prints `YYYY-MM-DD HH:mm`; the zone is pinned, never the browser default.
 */
export function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return '—';
  const out = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms));
  return out.replace('T', ' ');
}

/** 「岗位」 when the directory knows it; an unknown post is simply omitted. */
export function personRole(id: string | null | undefined, directory: EmployeeDirectory): string {
  if (!id) return '';
  return directory.get(id)?.title ?? '';
}

/**
 * Chain actor normalization. Employee ids resolve; an explicit display name
 * from upstream is free text and stays text (React children, never markup).
 */
export function chainActor(actor: unknown, names: Map<string, string>, t: TFunction): string {
  if (actor === null || actor === undefined || actor === '') return t('agentConsole.v2.collab.person.unknown');
  if (typeof actor === 'string') {
    return actor.startsWith('emp_') ? personName(actor, names, t) : t('agentConsole.v2.collab.person.unknown');
  }
  if (typeof actor === 'object') {
    const record = actor as { id?: unknown; displayName?: unknown; name?: unknown };
    const display = typeof record.displayName === 'string'
      ? record.displayName
      : typeof record.name === 'string'
        ? record.name
        : '';
    if (display.trim()) return display;
    if (typeof record.id === 'string') return personName(record.id, names, t);
  }
  return t('agentConsole.v2.collab.person.unknown');
}

/** Task title when present; otherwise a display label, never the raw task id. */
export function taskLabel(row: DelegationRow, t: TFunction): string {
  const title = (row.title ?? '').trim();
  if (title) return title;
  return t('agentConsole.v2.collab.taskFallback', { tail: tailOf(row.taskId) });
}

export function tailOf(id: string | null | undefined): string {
  if (!id) return '—';
  return id.length > 4 ? id.slice(-4) : id;
}

// ---------------------------------------------------------------- chain

export interface ChainRow {
  phase: string;
  at: string;
  actor: unknown;
  note?: string;
  /** delegation.charged writes two ledger rows in one action → one line. */
  mergedLedgers?: number;
}

/**
 * `delegation.charged` lands twice (day + month ledgers, DELEGATION §4). One
 * action must read as one line, so identical charged rows collapse and carry
 * the count; nothing about amounts is kept.
 */
export function mergeChain(items: ChainItem[]): ChainRow[] {
  const rows: ChainRow[] = [];
  for (const item of items) {
    const isCharge = item.phase === 'delegation.charged' || item.phase === 'charged';
    if (isCharge) {
      const last = rows[rows.length - 1];
      if (last && last.phase === 'charged-merged') {
        last.mergedLedgers = (last.mergedLedgers ?? 1) + 1;
        continue;
      }
      rows.push({ phase: 'charged-merged', at: item.at, actor: item.actor, note: item.note, mergedLedgers: 1 });
      continue;
    }
    rows.push({ phase: item.phase, at: item.at, actor: item.actor, note: item.note });
  }
  return rows;
}

/** Phase → heading key. Unknown phases read 「其他动作」, never the enum text. */
export function phaseLabelKey(phase: string): string {
  switch (phase) {
    case 'requested':
    case 'delegation.requested':
      return 'agentConsole.v2.collab.status.requested';
    case 'accepted':
    case 'delegation.accepted':
      return 'agentConsole.v2.collab.status.accepted';
    case 'handed_off':
    case 'delegation.handed_off':
      return 'agentConsole.v2.collab.status.handedOff';
    case 'completed':
    case 'delegation.completed':
      return 'agentConsole.v2.collab.status.completed';
    case 'rejected':
    case 'delegation.rejected':
      return 'agentConsole.v2.collab.status.rejected';
    case 'expired':
      return 'agentConsole.v2.collab.status.expired';
    case 'charged-merged':
      return 'agentConsole.v2.collab.chain.charged';
    default:
      return 'agentConsole.v2.collab.chain.other';
  }
}

/** Dot glyph per phase (check / clock / moveH / x), mirroring the target deck.
 *  `LkIcon` owns the shared symbol set: no swap/coin glyph exists, so 交接 uses
 *  the two-way arrow and 记账 uses the ledger glyph. */
export function phaseGlyph(phase: string): 'check' | 'clock' | 'moveH' | 'x' | 'hist' {
  switch (phase) {
    case 'accepted':
    case 'delegation.accepted':
    case 'completed':
    case 'delegation.completed':
      return 'check';
    case 'requested':
    case 'delegation.requested':
      return 'clock';
    case 'handed_off':
    case 'delegation.handed_off':
      return 'moveH';
    case 'rejected':
    case 'delegation.rejected':
      return 'x';
    case 'charged-merged':
      return 'hist';
    default:
      return 'clock';
  }
}

/** Note prefix per phase — the spec's own labels, verbatim (§1.1). */
export function noteLabelKey(phase: string): string {
  switch (phase) {
    case 'completed':
    case 'delegation.completed':
      return 'agentConsole.v2.collab.chain.resultLabel';
    case 'rejected':
    case 'delegation.rejected':
      return 'agentConsole.v2.collab.chain.reasonLabel';
    case 'charged-merged':
      return 'agentConsole.v2.collab.chain.noteLabel';
    default:
      return 'agentConsole.v2.collab.chain.noteLabel';
  }
}
// ---------------------------------------------------------------- filters (§FILT)

export type StatusFilter = 'all' | DelegationStatus;
export type WindowFilter = 'all' | '24h' | '7d' | '30d';

export const WINDOW_MS: Record<Exclude<WindowFilter, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export interface DelegationFilter {
  status: StatusFilter;
  window: WindowFilter;
  /** Employee id on either side of the handover; '' means everyone. */
  participant: string;
}

export const EMPTY_FILTER: DelegationFilter = { status: 'all', window: 'all', participant: '' };

export function isFilterActive(filter: DelegationFilter): boolean {
  return filter.status !== 'all' || filter.window !== 'all' || filter.participant !== '';
}

/**
 * Client-side narrowing of the rows already read. Filters never re-query and
 * never invent a count: the page still reports what it loaded, and a row with
 * no timestamp can only survive the 「全部时间」 window (`—` is not 「old」).
 */
export function filterDelegations(
  rows: DelegationRow[],
  filter: DelegationFilter,
  now: number = Date.now(),
): DelegationRow[] {
  return rows.filter((row) => {
    if (filter.status !== 'all' && row.status !== filter.status) return false;
    if (
      filter.participant &&
      row.fromEmployeeId !== filter.participant &&
      row.toEmployeeId !== filter.participant
    ) {
      return false;
    }
    if (filter.window !== 'all') {
      const raw = row.updatedAt ?? row.createdAt;
      const ms = raw ? new Date(raw).getTime() : Number.NaN;
      if (Number.isNaN(ms) || now - ms > WINDOW_MS[filter.window]) return false;
    }
    return true;
  });
}

/** Backend USD only: `$18.00`; a missing value is `—`, never `$0.00`. */
export function fmtUsd(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `$${value.toFixed(2)}`;
}

/** Correlation (requestId) short code, 8 upper-case chars; falls back to the
 *  delegation id so the row key is never blank (`—` when both are missing). */
export function correlationCode(row: DelegationRow): string {
  const raw = (row.requestId ?? row.delegationId ?? '').replace(/[^A-Za-z0-9]/g, '');
  const code = raw.slice(0, 8).toUpperCase();
  return code || '—';
}

// ---------------------------------------------------------------- deep links

const STATUS_FILTER_VALUES: ReadonlyArray<StatusFilter> = [
  'all',
  'requested',
  'accepted',
  'handed_off',
  'completed',
  'rejected',
  'expired',
];

const WINDOW_FILTER_VALUES: ReadonlyArray<WindowFilter> = ['all', '24h', '7d', '30d'];

export interface CollabQuery {
  filter: DelegationFilter;
  /** `param=value` pairs the page did not understand; shown neutrally, never fatal. */
  unknown: string[];
}

/**
 * The URL is the single source of truth for the three filter legs (§FILT-01..03).
 * Unknown or malformed values degrade to the default and are reported back, so a
 * stale bookmark can never crash the page.
 */
export function readCollabQuery(search: string): CollabQuery {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const unknown: string[] = [];

  const rawStatus = params.get('status');
  let status: StatusFilter = 'all';
  if (rawStatus) {
    if ((STATUS_FILTER_VALUES as ReadonlyArray<string>).includes(rawStatus)) {
      status = rawStatus as StatusFilter;
    } else {
      unknown.push(`status=${rawStatus}`);
    }
  }

  const rawWindow = params.get('window');
  let window: WindowFilter = 'all';
  if (rawWindow) {
    if ((WINDOW_FILTER_VALUES as ReadonlyArray<string>).includes(rawWindow)) {
      window = rawWindow as WindowFilter;
    } else {
      unknown.push(`window=${rawWindow}`);
    }
  }

  const rawParticipant = (params.get('participant') ?? '').trim();
  const participant = /^[A-Za-z0-9_:-]{1,64}$/.test(rawParticipant) ? rawParticipant : '';
  if (rawParticipant && !participant) unknown.push(`participant=${rawParticipant}`);

  return { filter: { status, window, participant }, unknown };
}

/** Canonical query string: defaults are omitted, order stays stable. */
export function writeCollabQuery(filter: DelegationFilter): string {
  const params = new URLSearchParams();
  if (filter.status !== 'all') params.set('status', filter.status);
  if (filter.window !== 'all') params.set('window', filter.window);
  if (filter.participant) params.set('participant', filter.participant);
  const query = params.toString();
  return query ? `?${query}` : '';
}
