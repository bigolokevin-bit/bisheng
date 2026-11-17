/**
 * SKILL-01 — read-only skill governance (/agent/skills).
 *
 * Pure shape/derive logic for the tenant skill ledger. The BFF route
 * GET /agent-api/api/skills proxies the domain's GET /v1/skills verbatim
 * (BFF commit c3b64b7; domain list_skills): the body is
 *
 *   { items: [{ skillId, name, version, contentHash, ownerUserId,
 *               sharedWith: [employeeId…], sharedCount, scope }],
 *     asOf, nextCursor? }
 *
 * `scope` is derived upstream from the CURRENT employee versions:
 * sharedWith.length >= 2 → tenant-shared, == 1 → employee-exclusive,
 * == 0 → unused. The page never re-derives scope differently; it only
 * turns the three known values into human Chinese copy. An unknown value
 * renders '—' — the raw enum is never printed (L0 lane contract §2).
 *
 * No total is supplied: the overview strip counts the rows of THIS read
 * and says so when `nextCursor` proves more rows exist. Nothing is summed
 * or extrapolated.
 */

export const SKILL_SCOPES = ['tenant-shared', 'employee-exclusive', 'unused'] as const;

export type SkillScope = (typeof SKILL_SCOPES)[number];

/** One ledger row; every display key is optional (absence renders '—'). */
export interface SkillRow {
  skillId?: string;
  id?: string;
  name?: string;
  version?: string | number | null;
  contentHash?: string | null;
  ownerUserId?: string | null;
  owner?: string | null;
  sharedWith?: unknown;
  sharedCount?: number | null;
  scope?: string | null;
}

export interface SkillListBody {
  items?: SkillRow[] | null;
  asOf?: string | null;
  nextCursor?: string | null;
}

/** Trimmed non-empty string, or null. Finite numbers are stringified. */
export function readText(v: unknown): string | null {
  if (typeof v === 'string') {
    const s = v.trim();
    return s ? s : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/** True only for a finite number — a string count is never coerced. */
export function readCount(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Reference labels from `sharedWith`. The domain sends employeeId strings;
 * an object form is tolerated (employeeId/id/name) so a future enrichment
 * cannot leak '[object Object]'. Unknown shapes are skipped.
 */
export function readRefs(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  v.forEach((it) => {
    const direct = readText(it);
    if (direct) {
      out.push(direct);
      return;
    }
    if (it && typeof it === 'object') {
      const o = it as Record<string, unknown>;
      const label = readText(o.employeeId) ?? readText(o.id) ?? readText(o.name);
      if (label) out.push(label);
    }
  });
  return out;
}

/** Rows from the list envelope; a bare array is tolerated. */
export function skillRows(body: SkillListBody | SkillRow[] | null | undefined): SkillRow[] {
  if (Array.isArray(body)) return body.filter((r) => r != null && typeof r === 'object');
  const items = body?.items;
  return Array.isArray(items) ? items.filter((r) => r != null && typeof r === 'object') : [];
}

/** Stable React key: ledger id, else the display name, else the row index. */
export function skillKey(row: SkillRow, index: number): string {
  return readText(row.skillId) ?? readText(row.id) ?? readText(row.name) ?? `row-${index}`;
}

/** Short content fingerprint for the cell; the full value stays in title. */
export function shortHash(v: unknown): string | null {
  const s = readText(v);
  if (!s) return null;
  if (s.length <= 16) return s;
  return `${s.slice(0, 10)}…${s.slice(-4)}`;
}

export type SkillVisibility =
  | { kind: 'shared'; count: number }
  | { kind: 'exclusive' }
  | { kind: 'unused' }
  | { kind: 'unknown' };

/**
 * Human visibility for one row. The supplied `sharedCount` wins; without it
 * the real member list length is used. An inconsistent pair (tenant-shared
 * with 1 member, employee-exclusive with 2) is `unknown` → '—', never a
 * guessed number and never the raw enum.
 */
export function visibilityOf(row: SkillRow): SkillVisibility {
  const scope = readText(row.scope);
  const supplied = readCount(row.sharedCount);
  const count = supplied ?? (Array.isArray(row.sharedWith) ? readRefs(row.sharedWith).length : null);
  if (scope === 'tenant-shared' && count != null && count >= 2) {
    return { kind: 'shared', count };
  }
  if (scope === 'employee-exclusive' && count === 1) return { kind: 'exclusive' };
  if (scope === 'unused' && count === 0) return { kind: 'unused' };
  return { kind: 'unknown' };
}

export interface SkillStats {
  total: number;
  /** null = at least one row's scope is unknown, so the count would lie. */
  shared: number | null;
  exclusive: number | null;
}

/** Overview-strip numbers, counted over the rows of this read only. */
export function deriveStats(rows: SkillRow[]): SkillStats {
  let shared = 0;
  let exclusive = 0;
  let unknown = 0;
  rows.forEach((row) => {
    const v = visibilityOf(row);
    if (v.kind === 'shared') shared += 1;
    else if (v.kind === 'exclusive') exclusive += 1;
    else if (v.kind === 'unknown') unknown += 1;
  });
  return {
    total: rows.length,
    shared: unknown > 0 ? null : shared,
    exclusive: unknown > 0 ? null : exclusive,
  };
}

/** First three referents + the remaining count (0 → no 「另有」 line). */
export function firstRefs(ids: string[], take = 3): { shown: string[]; rest: number } {
  return { shown: ids.slice(0, take), rest: Math.max(0, ids.length - take) };
}

/** Employee ids are deep links; any other label is plain text. */
export function isEmployeeRef(id: string): boolean {
  return id.startsWith('emp_');
}