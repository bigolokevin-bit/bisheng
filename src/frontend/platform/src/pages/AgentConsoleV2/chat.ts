/**
 * CHAT-01 — console direct chat (/agent/chat), pure logic.
 *
 * Shapes mirror the console-session family handed down by L0:
 *   POST /api/console-sessions                     → 201 {sessionId, tenantId, employeeId, createdAt, updatedAt}
 *   GET  /api/console-sessions?employeeId=&limit=  → 200 {items[+messageCount], nextCursor?}
 *   GET  /api/console-sessions/{id}                → 200 session + messageCount + messages[]
 *   POST /api/console-sessions/{id}/messages        → 201 {sessionId, requestId, userMessage, assistantMessage, updatedAt}
 *
 * Live probe 2026-11-17 on 8092: GET /api/console-sessions?limit=5 without a
 * cookie answers 401 {code:"console.unauthenticated"} with an
 * X-Console-Request-Id header — the read endpoint EXISTS behind the identity
 * gate. The 200 body shape is therefore not verified against a live row, so
 * every display field below is optional: absence renders '—', never 0 and
 * never a guess (same stance as MATRIX-01 / SKILL-01).
 *
 * Two rules this module exists to enforce:
 * - `citations` is shown ONLY when the assistant message truly carries a
 *   non-empty list. No empty-list placeholder, no invented reference.
 * - every send carries a fresh requestId (server-side idempotency key); the
 *   generator must not collide across sends inside one session.
 */

export interface ConsoleSessionSummary {
  sessionId?: string;
  id?: string;
  title?: string | null;
  name?: string | null;
  tenantId?: string | null;
  employeeId?: string | null;
  messageCount?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ConsoleMessageRow {
  seq?: number | null;
  role?: string | null;
  content?: string | null;
  requestId?: string | null;
  createdAt?: string | null;
  citations?: unknown;
}

export interface ConsoleSessionListBody {
  items?: ConsoleSessionSummary[] | null;
  nextCursor?: string | null;
}

export interface ConsoleSessionDetailBody extends ConsoleSessionSummary {
  messages?: ConsoleMessageRow[] | null;
}

export interface ConsoleSendBody {
  sessionId?: string;
  requestId?: string;
  userMessage?: ConsoleMessageRow | null;
  assistantMessage?: ConsoleMessageRow | null;
  updatedAt?: string | null;
}

/** Trimmed non-empty string, or null. Numbers (seq/messageCount) are stringified. */
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

/** Sessions from the list envelope. A bare array is tolerated (shape unverified). */
export function sessionRows(
  body: ConsoleSessionListBody | ConsoleSessionSummary[] | null | undefined,
): ConsoleSessionSummary[] {
  if (Array.isArray(body)) return body.filter((r) => r != null && typeof r === 'object');
  const items = body?.items;
  return Array.isArray(items) ? items.filter((r) => r != null && typeof r === 'object') : [];
}

/**
 * Messages of one session, server order (seq ASC) when seq is supplied. Rows
 * without content are dropped: an empty bubble would be a fabricated reply.
 */
export function messageRows(detail: ConsoleSessionDetailBody | null | undefined): ConsoleMessageRow[] {
  const raw = detail?.messages;
  if (!Array.isArray(raw)) return [];
  const rows = raw.filter(
    (m): m is ConsoleMessageRow => m != null && typeof m === 'object' && readText(m.content) != null,
  );
  const seqKnown = rows.every((m) => readCount(m.seq) != null);
  if (seqKnown) rows.sort((a, b) => (readCount(a.seq) ?? 0) - (readCount(b.seq) ?? 0));
  return rows;
}

/** Stable key: session id, else title, else the row index. */
export function sessionKey(row: ConsoleSessionSummary, index: number): string {
  return readText(row.sessionId) ?? readText(row.id) ?? readText(row.title) ?? `session-${index}`;
}

export const ROLE_KEYS: Record<string, string> = {
  user: 'agentConsole.v2.cs.roleUser',
  assistant: 'agentConsole.v2.cs.roleAssistant',
};

/**
 * Role label: known roles get human words, an unknown enum passes through
 * verbatim (mono + warn pill), never a machine translation.
 */
export function roleLabel(role: unknown): { key: string | null; verbatim: string | null } {
  const raw = readText(role);
  if (!raw) return { key: null, verbatim: null };
  const key = ROLE_KEYS[raw];
  return key ? { key, verbatim: null } : { key: null, verbatim: raw };
}

/** A message's reference list is real only when it is a non-empty array. */
export function citationList(v: unknown): unknown[] {
  return Array.isArray(v) && v.length > 0 ? v : [];
}

export function hasCitations(v: unknown): boolean {
  return citationList(v).length > 0;
}

/**
 * Display labels for references. Unknown object shapes are skipped rather than
 * stringified ('[object Object]' must never reach the screen); the caller falls
 * back to a plain count when no label can be derived.
 */
export function citationLabels(v: unknown): string[] {
  const out: string[] = [];
  citationList(v).forEach((it) => {
    const direct = readText(it);
    if (direct) {
      out.push(direct);
      return;
    }
    if (it && typeof it === 'object') {
      const o = it as Record<string, unknown>;
      const label =
        readText(o.title) ??
        readText(o.name) ??
        readText(o.label) ??
        readText(o.documentName) ??
        readText(o.source) ??
        readText(o.uri) ??
        readText(o.url) ??
        readText(o.snippet);
      if (label) out.push(label);
    }
  });
  return out;
}

/**
 * Unique idempotency key per send. crypto.randomUUID is the normal path; the
 * fallback mixes a counter into the timestamp so two sends inside the same
 * millisecond still differ (a repeated key would replay the first answer).
 */
let sendCounter = 0;

export function newRequestId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      /* fall through to the timestamp form */
    }
  }
  sendCounter += 1;
  return `cs-${Date.now().toString(36)}-${sendCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Localized copy key for a failed send. Machine codes only pick the copy —
 * they never reach the screen (G15). 401/403 mean the message was NOT
 * delivered; 502 means the upstream answer failed and no rows were persisted,
 * so the optimistic bubble is removed instead of being kept as a fake reply.
 */
export function sendErrorKey(status: number, code?: string): string {
  switch (code) {
    case 'console.unauthenticated':
    case 'request.invalid_token':
      return 'agentConsole.v2.cs.sendFailSession';
    case 'runtime.internal_only':
    case 'request.missing_tenant':
    case 'console.forbidden':
      return 'agentConsole.v2.cs.sendFailForbidden';
    case 'console_session.not_found':
      return 'agentConsole.v2.cs.sendFailGone';
    case 'hermes.unavailable':
      return 'agentConsole.v2.cs.sendFailUpstream';
    case 'request.invalid_body':
    case 'request.invalid_request':
    case 'console.missing_param':
      return 'agentConsole.v2.cs.sendFailInvalid';
    case 'console.timeout':
    case 'console.network':
      return 'agentConsole.v2.cs.sendFailNetwork';
    default:
      break;
  }
  if (status === 0) return 'agentConsole.v2.cs.sendFailNetwork';
  if (status === 401) return 'agentConsole.v2.cs.sendFailSession';
  if (status === 403) return 'agentConsole.v2.cs.sendFailForbidden';
  if (status === 404) return 'agentConsole.v2.cs.sendFailGone';
  if (status === 400 || status === 422) return 'agentConsole.v2.cs.sendFailInvalid';
  if (status >= 500) return 'agentConsole.v2.cs.sendFailUpstream';
  return 'agentConsole.v2.cs.sendFail';
}

export interface SendResult {
  ok: boolean;
  status: number;
  data: ConsoleSendBody | null;
  code?: string;
  requestId?: string;
}

/**
 * POST /api/console-sessions/{id}/messages. The only write call of this page.
 * Not routed through makeFetcher(): that helper is a GET-shaped reader with no
 * method/body slot. Same-origin only — the BFF attaches the operator identity
 * from the session cookie (ADR-0010 boundary), so no Authorization is sent.
 */
export async function postMessage(
  sessionId: string,
  payload: { requestId: string; content: string },
): Promise<SendResult> {
  if (!sessionId) return { ok: false, status: 0, data: null, code: 'console.missing_param' };
  const url = `/agent-api/api/console-sessions/${encodeURIComponent(sessionId)}/messages`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Console-Write': '1',
      },
      body: JSON.stringify({ requestId: payload.requestId, content: payload.content }),
    });
  } catch {
    return { ok: false, status: 0, data: null, code: 'console.network' };
  }
  const requestId = res.headers?.get?.('X-Console-Request-Id') ?? undefined;
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const env = parsed as { code?: string; message?: string } | null;
    return {
      ok: false,
      status: res.status,
      data: null,
      code: env?.code ?? `agent.http.${res.status}`,
      requestId,
    };
  }
  return { ok: true, status: res.status, data: (parsed as ConsoleSendBody) ?? null, requestId };
}