/**
 * S3-W2 display helpers shared by the EMP-01 list and EMP-03 detail pages.
 *
 * The PRD (docs/product/console-v3/PRD-v0.3.md) fixes four vocabulary rules
 * these helpers enforce: the employee short code is eight uppercase
 * characters, money is USD rendered by fmtMoney (never a client conversion),
 * every Beijing time is YYYY-MM-DD HH:mm to the minute, and a missing value
 * is an em dash — never 0, never a raw placeholder such as
 * `pilot_owner_placeholder`.
 */
import { ownerDisplayLabel, isPlaceholderIdentity } from './identity';
import type { EmployeeRow } from './v2Data';

type Translate = (key: string, opts?: Record<string, unknown>) => string;

const PLACEHOLDER_OWNERS = new Set([
  'pilot_owner_placeholder',
  'pilot-owner-placeholder',
  'placeholder',
  'owner_placeholder',
]);

const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** Beijing wall-clock, full date to the minute. Invalid input is '—'. */
export function fmtBeijingFull(iso?: string | null): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return '—';
  const b = new Date(ms + 8 * 3600_000);
  return `${b.getUTCFullYear()}-${pad(b.getUTCMonth() + 1)}-${pad(b.getUTCDate())} ${pad(
    b.getUTCHours()
  )}:${pad(b.getUTCMinutes())}`;
}

/**
 * PRD §1 L5: money is `$0.00` in USD, and a missing amount is '—'.
 * The value comes from the service — never a client-side conversion.
 */
export function fmtMoney(v?: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * PRD §1 L5 / §6.7: `emp_XXXXXXXX` renders as eight uppercase characters
 * (the 「员工 · A1B2C3D4」 label is composed with the shared id.employeeRef
 * key at the call site). Non-employee ids fall back to the first eight
 * alphanumerics so the rule stays uniform; a value too short to fill eight
 * characters is returned as-is rather than padded with invented digits.
 */
export function employeeShortCode(id?: string | null): string | null {
  const trimmed = (id ?? '').trim();
  if (!trimmed) return null;
  const raw = trimmed.startsWith('emp_') ? trimmed.slice(4) : trimmed;
  const cleaned = raw.replace(/[^0-9a-zA-Z]/g, '');
  if (!cleaned) return null;
  return cleaned.slice(0, 8).toUpperCase();
}

/**
 * Empty, opaque platform placeholders, and the pilot seed marker all mean
 * "no owner assigned". `identity.isPlaceholderIdentity` covers the shared
 * placeholders; `pilot_owner_placeholder` is added here because the identity
 * module predates the console v3 seed data.
 */
export function isUnassignedOwner(ownerUserId?: string | null): boolean {
  const value = (ownerUserId ?? '').trim();
  if (!value) return true;
  if (PLACEHOLDER_OWNERS.has(value.toLowerCase())) return true;
  if (value === 'human:' || value === 'user:') return true;
  return isPlaceholderIdentity(value);
}

/** Owner slot label: never leaks a placeholder; an empty slot is '—'. */
export function ownerSlotLabel(
  ownerUserId: string | null | undefined,
  t: Translate,
  opts?: { currentUid?: string | number; currentName?: string }
): string {
  if (isUnassignedOwner(ownerUserId)) return t('agentConsole.v2.id.none');
  return ownerDisplayLabel(ownerUserId ?? '', t, {
    currentUid:
      opts?.currentUid === undefined || opts.currentUid === null || opts.currentUid === ''
        ? undefined
        : String(opts.currentUid),
    currentName: opts?.currentName,
  });
}

export interface BudgetLike {
  dailyTokens?: number | null;
  monthlyCostUsd?: number | null;
  perRunMaxUsd?: number | null;
}

export type BudgetView =
  | { kind: 'missing' }
  | { kind: 'unset' }
  | { kind: 'configured'; dailyTokens: number | null; monthlyUsd: number | null; perRunUsd: number | null };

/**
 * Three honest budget states (PRD §6.4):
 * - `missing`  — no budget object at all → the caller renders '—'
 * - `unset`    — an object with all three fields null → 「未配置」
 * - `configured` — at least one field is a real number; individual null
 *   fields stay null so the caller can render '—' per field.
 */
export function budgetView(budget?: BudgetLike | null): BudgetView {
  if (budget == null) return { kind: 'missing' };
  const daily = typeof budget.dailyTokens === 'number' && Number.isFinite(budget.dailyTokens) ? budget.dailyTokens : null;
  const monthly =
    typeof budget.monthlyCostUsd === 'number' && Number.isFinite(budget.monthlyCostUsd)
      ? budget.monthlyCostUsd
      : null;
  const perRun =
    typeof budget.perRunMaxUsd === 'number' && Number.isFinite(budget.perRunMaxUsd) ? budget.perRunMaxUsd : null;
  if (daily == null && monthly == null && perRun == null) return { kind: 'unset' };
  return { kind: 'configured', dailyTokens: daily, monthlyUsd: monthly, perRunUsd: perRun };
}

/**
 * Skill count is not part of the E11 employee contract today; MatrixPage
 * reads it from the (undeployed) /api/matrix route. Accept it only when the
 * backend actually sends a finite number — never derive it from skills text.
 */
export function rowSkillCount(row: EmployeeRow): number | null {
  const direct = (row as EmployeeRow & { skillCount?: unknown }).skillCount;
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  return null;
}

/** Beijing-day window [00:00, now] as ISO instants. */
export function todayBeijingWindow(now = new Date()): { from: string; to: string } {
  const shifted = new Date(now.getTime() + 8 * 3600_000);
  const startMs =
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 8 * 3600_000;
  return { from: new Date(startMs).toISOString(), to: now.toISOString() };
}

export type StatusKey = 'active' | 'paused' | 'all';

/** PRD EMP-FILTER-02: default is 在岗; 暂停 maps to paused; all clears. */
export function parseStatusKey(raw: string | null): StatusKey {
  if (raw === 'paused' || raw === 'all') return raw;
  return 'active';
}