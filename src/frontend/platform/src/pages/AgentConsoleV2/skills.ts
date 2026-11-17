/**
 * SKILL-01 — read-only skill governance (layer-A read of the skill ledger).
 *
 * Pure logic only: shapes mirror the read-only skills endpoint handed down by
 * L0 (BFF GET /agent-api/api/skills). Live probe 2026-11-17 on 8092:
 *   GET /api/skills            → 401 console.unauthenticated (endpoint EXISTS,
 *                                identity gate reached; no cookie by design)
 *   GET /agent-api/api/skills  → 401 on the dev-served origin 8182 (same gate)
 *   GET :8101/v1/skills        → 400 (old upstream, not the console口)
 * The row shape is therefore NOT verified against a 200 body yet, so every
 * display field is declared optional: a missing key renders '—', never 0 and
 * never a guess (same stance as MATRIX-01 after its 404 probe).
 *
 * Conventions kept from the family pages:
 * - camelCase optional fields; missing → '—' at the call site;
 * - unknown enum values pass through verbatim (mono + warn pill), no machine
 *   translation of `scope`;
 * - counts are only shown when supplied (or derivable from a real name list);
 *   an unknown audience size is stated as unknown instead of fabricated as 0;
 * - no money fields on this page at all.
 */

/** Known audience scopes on the skill ledger. */
export const SKILL_SCOPES = ['tenant-shared', 'employee-exclusive', 'unused'] as const;

export type SkillScope = (typeof SKILL_SCOPES)[number];

/**
 * i18n key per known scope. `tenant-shared` carries a {{count}}, handled by
 * scopeBadge() so an unknown audience size is never printed as 0.
 */
export const SCOPE_KEY: Record<string, string> = {
  'tenant-shared': 'agentConsole.v2.sk.scopeShared',
  'employee-exclusive': 'agentConsole.v2.sk.scopeExclusive',
  unused: 'agentConsole.v2.sk.scopeUnused',
};

export const SCOPE_TONE: Record<string, 'accent' | 'warn' | 'neutral'> = {
  'tenant-shared': 'accent',
  'employee-exclusive': 'neutral',
  unused: 'warn',
};

/** One skill ledger row. Every key optional: absence is rendered honestly. */
export interface SkillRow {
  /** Ledger id, when the endpoint supplies one (used for keys/titles only). */
  skillId?: string;
  id?: string;
  name?: string;
  description?: string | null;
  version?: string | number | null;
  owner?: string | null;
  contentHash?: string | null;
  scope?: string | null;
  sharedWith?: unknown;
  sharedCount?: number | null;
  referencedBy?: unknown;
}

export interface SkillListBody {
  items?: SkillRow[] | null;
  nextCursor?: string | null;
}

/**
 * Rows from the response body. The list envelope is `{items: [...]}`; a bare
 * array is tolerated because the read口 shape is unverified. Anything else is
 * "no rows" — never a fabricated row.
 */
export function skillRows(body: SkillListBody | SkillRow[] | null | undefined): SkillRow[] {
  if (Array.isArray(body)) return body.filter((r) => r != null && typeof r === 'object');
  const items = body?.items;
  return Array.isArray(items) ? items.filter((r) => r != null && typeof r === 'object') : [];
}

/** Trimmed non-empty string, or null. Numbers (ids/versions) are stringified. */
export function readText(v: unknown): string | null {
  if (typeof v === 'string') {
    const s = v.trim();
    return s ? s : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/** True only for a finite number — a string count is not coerced (no guessing). */
export function readCount(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Display labels from a list that may be plain names or reference objects.
 * Unknown object shapes are skipped rather than stringified ('[object Object]'
 * must never reach the screen).
 */
export function readNames(v: unknown): string[] {
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
      const label =
        readText(o.name) ??
        readText(o.displayName) ??
        readText(o.label) ??
        readText(o.employeeName) ??
        readText(o.title);
      if (label) out.push(label);
    }
  });
  return out;
}

/** Stable React key: ledger id, else the display name, else the row index. */
export function skillKey(row: SkillRow, index: number): string {
  return readText(row.skillId) ?? readText(row.id) ?? readText(row.name) ?? `row-${index}`;
}

/** Content fingerprint, shortened for the card; the full value stays in title. */
export function shortHash(v: unknown): string | null {
  const s = readText(v);
  if (!s) return null;
  if (s.length <= 16) return s;
  return `${s.slice(0, 10)}…${s.slice(-4)}`;
}

export interface ScopeBadge {
  /** i18n key when the scope is known. */
  key: string | null;
  /** Unknown enum value, rendered verbatim (mono + warn pill). */
  verbatim: string | null;
  /** Interpolation count for tenant-shared, only when honestly available. */
  count?: number;
  tone: 'accent' | 'warn' | 'neutral';
}

/**
 * Badge for one row's scope. A tenant-shared skill with no supplied count and
 * no member list says "audience size not provided" — it never prints 0.
 */
export function scopeBadge(scope: unknown, sharedWith: unknown, sharedCount: unknown): ScopeBadge {
  const raw = readText(scope);
  if (!raw) return { key: null, verbatim: null, tone: 'neutral' };
  const key = SCOPE_KEY[raw];
  const tone = SCOPE_TONE[raw] ?? 'warn';
  if (!key) return { key: null, verbatim: raw, tone };
  if (raw === 'tenant-shared') {
    const supplied = readCount(sharedCount);
    const count = supplied ?? (Array.isArray(sharedWith) ? readNames(sharedWith).length : null);
    if (count == null) return { key: 'agentConsole.v2.sk.scopeSharedUnknown', tone, verbatim: null };
    return { key, count, tone, verbatim: null };
  }
  return { key, verbatim: null, tone };
}

export type ScopeToneClass = ' is-accent' | ' is-warn' | ' is-danger' | ' is-ok' | '';

export function scopeToneClass(tone: 'accent' | 'warn' | 'neutral'): ScopeToneClass {
  if (tone === 'accent') return ' is-accent';
  if (tone === 'warn') return ' is-warn';
  return '';
}