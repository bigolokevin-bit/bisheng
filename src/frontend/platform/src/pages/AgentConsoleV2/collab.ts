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
 * directory (`employeeLabelById`) and degrade to 「员工 · 末4位」, which is the
 * shared, already-localized identity fallback — never a bare `emp_…`.
 *
 * The write surface (accept / reject / handoff / complete) is NOT here: the
 * BFF write routes are not wired yet, so the page renders one static note and
 * zero controls (spec §2, E06).
 */
import type { TFunction } from 'i18next';

import type { EmployeeSummary } from '@/controllers/API/agent';

import { employeeLabelById } from './identity';
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

export interface CollabApi {
  listDelegations(): Promise<CollabApiResult<DelegationListShape>>;
  getChain(delegationId: string): Promise<CollabApiResult<ChainShape>>;
}

export interface HttpCollabApiOptions {
  /** Same-origin prefix routed to the console BFF (`/agent-api/api/…`). */
  base?: string;
  getToken?: () => string | null;
}

/** The BFF owns `/agent-api`; every path keeps its own `/api/` segment. */
export function createHttpCollabApi(options: HttpCollabApiOptions = {}): CollabApi {
  const fetcher = makeFetcher(options.base ?? '/agent-api', options.getToken);
  return {
    listDelegations: () => fetcher<DelegationListShape>('/api/delegations'),
    getChain: (delegationId) =>
      fetcher<ChainShape>(`/api/delegations/${encodeURIComponent(delegationId)}/chain`),
  };
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

/** Display name for an employee id; never the bare id. */
export function personName(
  id: string | null | undefined,
  names: Map<string, string>,
  t: TFunction,
): string {
  return employeeLabelById(id ?? undefined, names, t);
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