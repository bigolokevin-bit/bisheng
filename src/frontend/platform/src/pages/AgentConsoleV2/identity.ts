/**
 * S2 quality surgery — readable identities (display layer ONLY).
 *
 * Console v2 must never print raw internal identifiers as user-facing text:
 * - `human:<id>` / bare numeric uids → 「用户 #<id>」 (or the resolved name when
 *   the caller already has one — no new endpoint is invented here);
 * - placeholder owners (`owner`, `owner@example.com`, any `@example.com`) →
 *   the honest 「未知」, never the seed string;
 * - `emp_<long id>` → employee name when the directory is loaded, otherwise
 *   「员工 · <tail>」 — the `emp_` prefix stays in title/copy surfaces only;
 * - system / service actors → 「系统 · <id>」/「服务 · <id>」;
 * - avatars: only a CJK name keeps its first character; a stray Latin letter
 *   is meaningless, so callers fall back to a neutral icon (`avatarChar`
 *   returns null).
 *
 * Honesty rules carried by every helper:
 * - missing data → 「未知」/「未命名」/「—」 placeholders, NEVER a fabricated name;
 * - unknown enums pass through verbatim (未收录不机翻, same caliber as aud01);
 * - full raw values stay available to title/copy via the call sites (§3 idiom:
 *   truncation is visual only). No routing, BFF or contract change.
 */

/** All new copy lives under this namespace in `agentConsole.v2.id`. */
export const ID_NS = 'agentConsole.v2.id';

type TFn = (key: string, options?: Record<string, unknown>) => string;

// ---------- raw-value hygiene ----------

const PLACEHOLDER_OWNERS = new Set(['owner', 'owner@example.com', 'admin@example.com', 'changeme']);

/**
 * Seed / placeholder identities that must never reach the screen. Matched on
 * the bare value, case-insensitively; any `@example.com` address counts.
 */
export function isPlaceholderIdentity(value?: string | null): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  if (!v) return false;
  return PLACEHOLDER_OWNERS.has(v) || v.endsWith('@example.com');
}

/** Split `human:9` / `employee:abc` → bare id after the FIRST colon. */
export function bareId(value: string): string {
  const i = value.indexOf(':');
  return i > 0 ? value.slice(i + 1) : value;
}

/** Type prefix of a combined ref (`human:1` → `human`); '' when absent. */
export function idPrefix(value: string): string {
  const i = value.indexOf(':');
  return i > 0 ? value.slice(0, i) : '';
}

/** Stable distinguisher for short labels: last `n` chars of the bare id. */
export function idTail(value?: string | null, n = 4): string {
  const b = bareId(value ?? '');
  return b ? b.slice(-n) : '';
}

/**
 * Is this bare human value an opaque uid (needs the readable fallback form)
 * rather than a display name? Names like `opsadmin` / 「陈诚」 stay verbatim —
 * the same caliber the overview attention table already uses.
 */
export function looksLikeOpaqueUid(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (/^\d+$/.test(v)) return true; // 1 / 999999999999
  if (/^(u|user|uid|human|member|acct|account)[_.-]/i.test(v)) return true; // u_10001, user-1
  if (/[_-]\d+$/.test(v)) return true; // user_1
  if (v.length >= 12 && /^[0-9a-f_-]+$/i.test(v) && /\d/.test(v)) return true; // hex/id-ish
  return false;
}

// ---------- human actors ----------

/**
 * `1` / `u_10001` (whatever the bare human uid is) → 「用户 #<uid>」.
 * A resolved `name` wins; name-shaped values stay verbatim; placeholders
 * degrade to 「未知」 — never the seed.
 */
export function humanLabel(bare: string | null | undefined, t: TFn, name?: string | null): string {
  const n = (name ?? '').trim();
  const v = (bare ?? '').trim();
  if (!v && !n) return t(`${ID_NS}.unknown`);
  if (n) return n;
  if (isPlaceholderIdentity(v)) return t(`${ID_NS}.unknown`);
  return looksLikeOpaqueUid(v) ? t(`${ID_NS}.userRef`, { id: v }) : v;
}

/** `onBehalfOf`/`assignee` combined refs → readable, prefix never printed. */
export function humanRefLabel(raw: string | null | undefined, t: TFn, name?: string | null): string {
  if (!raw || !raw.trim()) return t(`${ID_NS}.none`);
  return humanLabel(bareId(raw), t, name);
}

/**
 * Employee `ownerUserId` from E11/E12 — may already carry a type prefix.
 * The current operator's own uid resolves to their session display name when
 * the caller supplies one; everything else lands on 「用户 #<uid>」.
 */
export function ownerDisplayLabel(
  ownerUserId: string | null | undefined,
  t: TFn,
  opts: { currentUid?: string; currentName?: string } = {},
): string {
  const raw = (ownerUserId ?? '').trim();
  if (!raw || isPlaceholderIdentity(raw) || isPlaceholderIdentity(bareId(raw))) {
    return t(`${ID_NS}.unknown`);
  }
  const bare = bareId(raw);
  if (opts.currentUid && bare === opts.currentUid) {
    return humanLabel(bare, t, opts.currentName ?? null);
  }
  return humanLabel(bare, t);
}

// ---------- employees ----------

export interface NamedEntity {
  id: string;
  name?: string | null;
}

/** Trimmed names that occur more than once in the visible set. */
export function duplicateNames(rows: ReadonlyArray<NamedEntity>): Set<string> {
  const seen = new Map<string, number>();
  for (const r of rows) {
    const n = (r.name ?? '').trim();
    if (n) seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  const dups = new Set<string>();
  seen.forEach((count, name) => {
    if (count > 1) dups.add(name);
  });
  return dups;
}

/**
 * Employee display name: real name; duplicates carry the id tail as a
 * distinguisher (「小鲤 · 3D7E」); an empty name is 「未命名」, never an id.
 */
export function employeeDisplayName(row: NamedEntity, dups: ReadonlySet<string>, t: TFn): string {
  const raw = (row.name ?? '').trim();
  if (!raw) return t(`${ID_NS}.unnamed`);
  if (dups.has(raw)) {
    const tail = idTail(row.id);
    return tail ? `${raw} · ${tail}` : raw;
  }
  return raw;
}

/** Employee id → directory name when loaded, else 「员工 · <tail>」. */
export function employeeLabelById(
  id: string | null | undefined,
  names: Map<string, string> | undefined,
  t: TFn,
): string {
  const bare = (id ? bareId(id) : '').trim();
  if (!bare || isPlaceholderIdentity(bare)) return t(`${ID_NS}.unknown`);
  const name = names?.get(bare)?.trim() || names?.get(id ?? '')?.trim();
  if (name) return name;
  const tail = idTail(bare);
  return tail ? t(`${ID_NS}.employeeRef`, { tail }) : t(`${ID_NS}.employee`);
}

// ---------- actors (AUD-01 style {type,id,displayName?}) ----------

/** Chinese words for the known actor types; unknown types pass through. */
export function actorTypeLabel(type: string, t: TFn): string {
  switch (type) {
    case 'human':
      return t(`${ID_NS}.typeHuman`);
    case 'employee':
      return t(`${ID_NS}.typeEmployee`);
    case 'system':
      return t(`${ID_NS}.typeSystem`);
    case 'service':
      return t(`${ID_NS}.typeService`);
    default:
      return type;
  }
}

/**
 * One readable actor line. displayName wins (upstream-provided names are the
 * truth); otherwise each type degrades to a readable form — the combined
 * `human:`-style prefix is never printed, and `employee-api` becomes
 * 「系统 · employee-api」.
 */
export function actorLabel(
  actor: { type: string; id: string; displayName?: string },
  names: Map<string, string> | undefined,
  t: TFn,
): string {
  const dn = (actor.displayName ?? '').trim();
  if (dn) return dn;
  const bare = bareId(actor.id);
  if (!bare || isPlaceholderIdentity(bare)) return t(`${ID_NS}.unknown`);
  switch (actor.type) {
    case 'human':
      return humanLabel(bare, t);
    case 'employee':
      return employeeLabelById(actor.id, names, t);
    case 'system':
      return t(`${ID_NS}.systemActor`, { id: bare });
    case 'service':
      return t(`${ID_NS}.serviceActor`, { id: bare });
    default:
      return `${actorTypeLabel(actor.type, t)} · ${bare}`;
  }
}

// ---------- resources (AUD-01) ----------

const RESOURCE_TYPE_KEYS = new Set([
  'employee',
  'employee_version',
  'grant',
  'action',
  'approval',
  'task',
  'run',
  'policy',
  'policy_snapshot',
  'knowledge_base',
  'channel',
  'workstation',
]);

/** `employee` → 「员工」; unlisted enums stay verbatim (never invented). */
export function resourceTypeLabel(type: string, t: TFn): string {
  return RESOURCE_TYPE_KEYS.has(type) ? t(`${ID_NS}.res.${type}`) : type;
}

/**
 * Resource cell display for employee-typed resources: name when the
 * directory resolved, 「员工 · <tail>」 otherwise — no bare `emp_` ids.
 */
export function employeeResourceIdLabel(
  id: string,
  names: Map<string, string> | undefined,
  t: TFn,
): string {
  return employeeLabelById(id, names, t);
}

// ---------- generic identity refs (overview queues, approvals) ----------

/**
 * Any `assignee` / `createdBy` / `onBehalfOf` style string from an upstream
 * body → readable. Prefixed refs lose the prefix into a type word; a bare
 * numeric uid becomes 「用户 #N」; real display names (opsadmin…) stay as-is.
 */
export function identityText(raw: string | null | undefined, t: TFn): string {
  const v = (raw ?? '').trim();
  if (!v) return t(`${ID_NS}.none`);
  if (isPlaceholderIdentity(v) || isPlaceholderIdentity(bareId(v))) return t(`${ID_NS}.unknown`);
  const prefix = idPrefix(v);
  const bare = bareId(v);
  switch (prefix) {
    case 'human':
    case 'user':
      return humanLabel(bare, t);
    case 'employee':
      return humanLikeOrRef(bare, t);
    default:
      break;
  }
  if (v.startsWith('emp_')) return bareLabel(v, t);
  if (/^\d+$/.test(v)) return humanLabel(v, t);
  return v;
}

function bareLabel(id: string, t: TFn): string {
  const tail = idTail(id);
  return tail ? t(`${ID_NS}.employeeRef`, { tail }) : t(`${ID_NS}.employee`);
}

function humanLikeOrRef(value: string, t: TFn): string {
  // `employee:` + something that is not an id-shaped string is treated as a
  // plain display name — never rewritten into a number.
  if (/^(emp|e)[_-]/i.test(value) || /^\d+$/.test(value)) return bareLabel(value, t);
  return value;
}

// ---------- avatars ----------

/**
 * Avatar character: the first character of a CJK name is meaningful (「小鲤」→
 * 「小」), a Latin initial is a stray letter → null, and the caller renders a
 * stable neutral icon instead.
 */
export function avatarChar(name?: string | null): string | null {
  const ch = Array.from((name ?? '').trim())[0];
  if (!ch) return null;
  if (isPlaceholderIdentity(name)) return null;
  // Non-ASCII first code point ⇒ treat as a display name we can lead with.
  return ch.charCodeAt(0) > 0x7f ? ch : null;
}
