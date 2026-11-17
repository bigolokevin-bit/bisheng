/**
 * AUD-02 `/agent/audit/:eventId` — contract-shaped helpers + the A4 read-only
 * adapter (AUD02-TARGET-SPEC.md §2/§3, deep/06 §3).
 *
 * A4 `GET /api/audit-detail?id=<eventId>` returns one `audit_public()` event:
 * 10 required keys, 17 optional keys that are ABSENT (not null) when the thing
 * never happened. This module never fills such a hole: absence is returned as
 * absence and the page drops the row (§2.3). A7 (`/api/audit-verify`) is not
 * re-implemented — the AUD-01 adapter is reused verbatim so the panel stays the
 * same component with the same numbers.
 *
 * 403 / 404 / malformed-id all answer the SAME body upstream; nothing here
 * distinguishes them beyond the status code it was handed.
 *
 * Security: every string handled below is upstream free text. Helpers only
 * format, classify and slice — rendering is the page's job and always goes
 * through React children (no markup building anywhere in this file).
 */
import { AuthError } from '@/controllers/API/agent';

import {
  actionLabelKey,
  createHttpAuditApi,
  decisionEnum,
  decisionTone,
  formatLatency,
  outcomeEnum,
  outcomeTone,
  shortId,
  sourceWord,
  wireText,
  type AuditApi,
  type AuditEvent,
} from './aud01';
import {
  ID_NS,
  bareId,
  employeeLabelById,
  humanLabel,
  isPlaceholderIdentity,
} from './identity';
import { makeFetcher, type ApiRes } from './v2Data';

export type { AuditEvent } from './aud01';
export type { ApiRes } from './v2Data';

// ---------- A4 shapes ----------

/**
 * One event detail is exactly the list row shape (§2.2). Optional fields are
 * absent when the event has no value for them; `null` is tolerated (some
 * projections send it) but is treated as absence, never as "empty string".
 */
export type AuditEventDetail = AuditEvent;

/** Detail read state — `error` carries the HTTP code as sent, never a guess. */
export interface AuditDetailApi extends AuditApi {
  /** A4. `id` is always a real event id: an empty id is the page's 400. */
  getEvent(id: string): Promise<ApiRes<AuditEventDetail>>;
}

export interface HttpAuditDetailApiOptions {
  /** Same-origin prefix routed by Caddy to the console BFF. */
  base?: string;
  getToken?: () => string | null;
}

/**
 * The body is forwarded from the upstream projection. Live A4 answers with the
 * event object itself; a wrapped envelope (`{event}`, `{item}`, `{data}`) is
 * tolerated so the page renders the event either way — but a body WITHOUT an
 * `eventId` is never coerced into a blank event: it becomes an honest failure.
 */
export function pickEvent(body: unknown): AuditEventDetail | null {
  if (!body || typeof body !== 'object') return null;
  const isEvent = (v: unknown): v is AuditEventDetail =>
    !!v && typeof v === 'object' && typeof (v as { eventId?: unknown }).eventId === 'string';
  if (isEvent(body)) return body;
  for (const key of ['event', 'item', 'data', 'result'] as const) {
    const inner = (body as Record<string, unknown>)[key];
    if (isEvent(inner)) return inner;
  }
  return null;
}

export function createHttpAuditDetailApi(
  options: HttpAuditDetailApiOptions = {},
): AuditDetailApi {
  const getJson = makeFetcher(options.base, options.getToken);
  /* A7 stays the AUD-01 adapter: same query params, same body, same colour
   * gate. Duplicating it here would be a second source of truth. */
  const list = createHttpAuditApi(options);

  return {
    verifyAudit: (params) => list.verifyAudit(params),
    /* The shared A7 panel is typed against the AUD-01 adapter, so the composed
     * object carries A3 as well. AUD-02 never calls it — this page has no list
     * and no filters; it is here only to satisfy the one shared interface. */
    listAudit: (params) => list.listAudit(params),

    async getEvent(id) {
      const res = await getJson<unknown>('/api/audit-detail', { id });
      if (res.status === 401) throw new AuthError();
      if (!res.ok) {
        return { ...res, data: null } satisfies ApiRes<AuditEventDetail>;
      }
      const event = pickEvent(res.data);
      if (!event) {
        /* A 200 with no event is still "could not read it": the page says so
         * and offers a retry instead of drawing an empty detail. */
        return {
          ok: false,
          status: res.status,
          data: null,
          code: 'console.empty_body',
          requestId: res.requestId,
        } satisfies ApiRes<AuditEventDetail>;
      }
      return { ...res, data: event } satisfies ApiRes<AuditEventDetail>;
    },
  };
}

// ---------- absence semantics (§2.3) ----------

/** Optional keys present with a usable (non-empty) value. */
export function hasValue(value: unknown): boolean {
  return wireText(value).trim() !== '';
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Dict = Record<string, any>;

/**
 * `before`/`after` are optional objects; `{}` is not a change. A side that is
 * absent is NOT rendered as an empty brace pair.
 */
export function diffSides(event: AuditEventDetail): {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  anySide: boolean;
} {
  const d = event as unknown as Dict;
  const before = isPlainObject(d.before) ? (d.before as Record<string, unknown>) : undefined;
  const after = isPlainObject(d.after) ? (d.after as Record<string, unknown>) : undefined;
  const anySide = Object.keys(before ?? {}).length > 0 || Object.keys(after ?? {}).length > 0;
  return { before, after, anySide };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Raw-JSON view: only the sides the event actually carries. */
export function diffJsonText(event: AuditEventDetail): string {
  const { before, after } = diffSides(event);
  const out: Record<string, unknown> = {};
  if (before !== undefined) out.before = before;
  if (after !== undefined) out.after = after;
  try {
    return JSON.stringify(out, null, 2);
  } catch {
    return '{}';
  }
}

// ---------- responsibility four states (§1.5.1 / deep 06 §3.3) ----------

export type Responsibility = 'a' | 'b' | 'c' | 'x';

export const UNRESOLVED_REASONS = ['unknown_sender', 'system_job', 'missing_owner'] as const;
export type UnresolvedReason = (typeof UNRESOLVED_REASONS)[number];

export function isUnresolvedReason(v: string): v is UnresolvedReason {
  return (UNRESOLVED_REASONS as readonly string[]).includes(v);
}

/**
 * A = a responsible human; B = unresolved + a reason; C = both (a data-quality
 * signal, never produced by internal writers); X = both missing (a contract
 * violation — the page must say so instead of leaving the cell blank).
 */
export function responsibilityOf(event: AuditEventDetail): Responsibility {
  const human = (event as Dict).responsibleHumanId;
  const reason = (event as Dict).responsibleUnresolvedReason;
  const hasHuman = hasValue(human);
  const hasReason = hasValue(reason);
  if (hasHuman && hasReason) return 'c';
  if (hasHuman) return 'a';
  if (hasReason) return 'b';
  return 'x';
}

// ---------- hash-chain presence (§1.8) ----------

export type ChainMode = 'chained' | 'unchained';

/** A hash OR a previous hash means the event is on the chain. */
export function chainModeOf(event: AuditEventDetail): ChainMode {
  return hasValue(event.hash) || hasValue(event.prevHash) ? 'chained' : 'unchained';
}

// ---------- time (§1.5 cells 1–2) ----------

const SHANGHAI_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const UTC_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

interface WallClock {
  /** `11-17 16:31:07` — the mono headline, Beijing wall clock. */
  clock: string;
  /** `.884` — milliseconds, rendered smaller next to `clock`. */
  ms: string;
  /** `16:31:07.884` in Beijing. */
  beijing: string;
  /** `08:31:07.884` in UTC (the contract stores UTC; shown labelled). */
  utc: string;
}

function partsOf(fmt: Intl.DateTimeFormat, ms: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ms))) out[p.type] = p.value;
  return out;
}

/** Full-second + millisecond rendering; null when the value is unparsable. */
export function eventClock(iso: string | undefined): WallClock | null {
  const ms = Date.parse(wireText(iso));
  if (!Number.isFinite(ms)) return null;
  const bj = partsOf(SHANGHAI_PARTS, ms);
  const ut = partsOf(UTC_PARTS, ms);
  const frac = `.${String(new Date(ms).getUTCMilliseconds()).padStart(3, '0')}`;
  const bjTime = `${bj.hour}:${bj.minute}:${bj.second}`;
  const utTime = `${ut.hour}:${ut.minute}:${ut.second}`;
  return {
    clock: `${bj.month}-${bj.day} ${bjTime}`,
    ms: frac,
    beijing: `${bjTime}${frac}`,
    utc: `${utTime}${frac}`,
  };
}

/** `+0.7s` between occurred and recorded; null when either is unparsable. */
export function arrivalGap(event: AuditEventDetail): string | null {
  return formatLatency(event.occurredAt, event.recordedAt);
}

export const SKEW_MS = 5 * 60 * 1000;

/** >5min drift is a data-quality signal, never an error (§1.5 cell 2). */
export function hasSkew(event: AuditEventDetail): boolean {
  const a = Date.parse(wireText(event.occurredAt));
  const b = Date.parse(wireText(event.recordedAt));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(b - a) > SKEW_MS;
}

// ---------- labels ----------

/** `schemaVersion` as shown in the chip: `v1` for both `1` and `v1`. */
export function schemaLabel(version: string | number | null | undefined): string {
  const v = String(version ?? '').trim();
  if (!v) return '';
  return /^v/i.test(v) ? v : `v${v}`;
}

/**
 * The action's readable name. Known actions come from the AUD-01 table (same
 * words, one source); an unlisted action keeps its raw value — never invented,
 * never machine-translated.
 */
export function actionText(action: string, t: (key: string) => string): string | null {
  const key = actionLabelKey(action);
  return key ? t(`agentConsole.v2.aud01.${key}`) : null;
}

/** Outcome pill label + tone (shared enum, same colour gate as the list). */
export function outcomeLabel(
  outcome: string,
  t: (key: string) => string,
): { text: string; tone: string } | null {
  const value = outcomeEnum(outcome);
  if (!value) return null;
  const key = `agentConsole.v2.aud01.outcome${value.charAt(0).toUpperCase()}${value.slice(1)}`;
  const text = t(key);
  if (!text || text === key) return null;
  return { text, tone: outcomeTone(value) };
}

/** Decision pill label + tone; `not_applicable` and absence never get colour. */
export function decisionLabel(
  decision: string,
  t: (key: string) => string,
): { text: string; tone: string } | null {
  const value = decisionEnum(decision);
  if (!value || value === 'not_applicable') return null;
  const key = `agentConsole.v2.aud01.decision${value.charAt(0).toUpperCase()}${value.slice(1)}`;
  const text = t(key);
  if (!text || text === key) return null;
  return { text, tone: decisionTone(value) };
}

/** Source-system word (7 known values; anything else stays verbatim). */
export function sourceText(source: string, t: (key: string) => string): string {
  return sourceWord(source, t);
}

/** Unresolved-reason words; an unlisted value passes through (未收录不机翻). */
export function reasonText(reason: string, t: (key: string) => string): string {
  const raw = wireText(reason);
  const value = raw.trim().toLowerCase();
  if (value === 'unknown_sender') return t('agentConsole.v2.aud02.reasonUnknownSender');
  if (value === 'system_job') return t('agentConsole.v2.aud02.reasonSystemJob');
  if (value === 'missing_owner') return t('agentConsole.v2.aud02.reasonMissingOwner');
  return raw;
}

/** Employee reference → name, 「员工 · 短码」, or 「未知」 (never a bare emp_ id). */
export function employeeText(
  id: string | null | undefined,
  names: Map<string, string> | undefined,
  t: (key: string) => string,
): string {
  return employeeLabelById(wireText(id), names, t);
}

/** Human reference (`u_10001` / `human:u_10001`) → 「用户 #…」 or a real name. */
export function humanText(
  raw: string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
  name?: string | null,
): string {
  const value = bareId(wireText(raw).trim());
  if (!value) return t(`${ID_NS}.unknown`);
  return humanLabel(value, t, name);
}

/** True when an id must not be printed verbatim (placeholders / opaque uids). */
export function looksUnreadableId(value: string | undefined): boolean {
  const v = wireText(value).trim();
  return v === '' || isPlaceholderIdentity(v);
}

// ---------- related references (§1.7) ----------

export type RefKey =
  | 'runId'
  | 'taskId'
  | 'approvalId'
  | 'policyDecisionId'
  | 'employeeVersionRef'
  | 'policySnapshotRef'
  | 'correlationId';

export const REF_ORDER: RefKey[] = [
  'runId',
  'taskId',
  'approvalId',
  'policyDecisionId',
  'employeeVersionRef',
  'policySnapshotRef',
  'correlationId',
];

export const REF_LABEL_KEYS: Record<RefKey, string> = {
  runId: 'agentConsole.v2.aud02.refRun',
  taskId: 'agentConsole.v2.aud02.refTask',
  approvalId: 'agentConsole.v2.aud02.refApproval',
  policyDecisionId: 'agentConsole.v2.aud02.refPolicy',
  employeeVersionRef: 'agentConsole.v2.aud02.refVersion',
  policySnapshotRef: 'agentConsole.v2.aud02.refSnapshot',
  correlationId: 'agentConsole.v2.aud02.refCorrelation',
};

/** Only these three have a live read-only target page. */
export const REF_HREF: Partial<Record<RefKey, (id: string) => string>> = {
  runId: (id) => `/agent/runs/${encodeURIComponent(id)}`,
  taskId: (id) => `/agent/tasks/${encodeURIComponent(id)}`,
  approvalId: (id) => `/agent/approvals/${encodeURIComponent(id)}`,
};

/** Copy-only refs and the reason they cannot be a link (§1.7 table). */
export const REF_NOTE_KEYS: Partial<Record<RefKey, string>> = {
  policyDecisionId: 'agentConsole.v2.aud02.notePolicy',
  employeeVersionRef: 'agentConsole.v2.aud02.noteVersion',
  policySnapshotRef: 'agentConsole.v2.aud02.noteSnapshot',
  correlationId: 'agentConsole.v2.aud02.noteCorrelation',
};

/** Accessible name of the copy control, per reference. */
export const REF_COPY_KEYS: Record<RefKey, string> = {
  runId: 'agentConsole.v2.aud01.copyRun',
  taskId: 'agentConsole.v2.aud01.copyTask',
  approvalId: 'agentConsole.v2.aud01.copyApproval',
  policyDecisionId: 'agentConsole.v2.aud01.copyPolicy',
  employeeVersionRef: 'agentConsole.v2.aud02.copyVersionRef',
  policySnapshotRef: 'agentConsole.v2.aud02.copySnapshotRef',
  correlationId: 'agentConsole.v2.aud01.copyCorrelation',
};

/** Only the three jump-capable refs carry a link label. */
export const REF_VIEW_KEYS: Partial<Record<RefKey, string>> = {
  runId: 'agentConsole.v2.aud02.viewRun',
  taskId: 'agentConsole.v2.aud02.viewTask',
  approvalId: 'agentConsole.v2.aud02.viewApproval',
};

export interface RelatedRef {
  key: RefKey;
  value: string;
  href: string | null;
  noteKey: string | null;
}

/** Present references in fixed order; absent ones are simply not returned. */
export function relatedRefs(event: AuditEventDetail): RelatedRef[] {
  const d = event as unknown as Dict;
  const out: RelatedRef[] = [];
  for (const key of REF_ORDER) {
    const raw = d[key];
    if (!hasValue(raw)) continue;
    const value = String(raw);
    out.push({
      key,
      value,
      href: REF_HREF[key] ? REF_HREF[key]!(value) : null,
      noteKey: REF_NOTE_KEYS[key] ?? null,
    });
  }
  return out;
}

/** Display truncation only — the full value stays in title/copy. */
export function refShort(value: string): string {
  return shortId(value);
}

/**
 * Object keys are paths, not ids: `audit-payloads/2026-11-17/ev_…/message.json.gz`
 * truncated to `audi…n.gz` would say nothing. Keep the first segment and the
 * file name; the full key stays in title/copy (§3.1: display only).
 */
export function shortPath(value: string): string {
  const parts = value.split('/').filter(Boolean);
  if (parts.length <= 2) return value;
  return `${parts[0]}/…/${parts[parts.length - 1]}`;
}

// ---------- misc ----------

/** Compact acknowledgement that an event was read: `11-17 09:21:04`. */
export function readStampClock(iso: string): string {
  return eventClock(iso)?.clock ?? '—';
}

export type DetailHead =
  | { kind: 'loading' }
  | { kind: 'ready'; event: AuditEventDetail; readAt: string }
  | { kind: 'error'; status: number; requestId?: string }
  | { kind: 'forbidden'; status: number; requestId?: string };