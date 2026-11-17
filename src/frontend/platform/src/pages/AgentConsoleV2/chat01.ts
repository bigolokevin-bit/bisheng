/**
 * L4p2 console chat (route /agent/chat) data layer.
 *
 * The browser talks ONLY to the same-origin BFF (/agent-api); L7 owns those
 * routes and the runtime session service behind them. Nothing here fabricates
 * a reply: a failed send returns the parsed envelope so the composer can keep
 * the draft and offer a retry, and the thread is re-read from the server
 * instead of being patched with a local echo.
 *
 * Wire shapes (L4-PAGE-LANES + L2 CONSOLE-SESSIONS-SHAPE):
 *   GET  /api/console-sessions                     -> { items: [{sessionId,title,employeeId,updatedAt}], nextCursor? }
 *   GET  /api/console-sessions/<id>                -> { sessionId,title,employeeId,updatedAt, messages: [{role,at,text}] }
 *   POST /api/console-sessions/<id>/messages       -> body EXACTLY { requestId, content }
 * Upstream machine codes stay behind the BFF; only status + request id are
 * used on screen (status number at most, per the console copy rules).
 */
import type { ApiRes } from './v2Data';

export type ChatResult<T> = ApiRes<T>;

/** Same caliber as the other console reads: no skeleton may spin forever. */
export const CHAT_TIMEOUT_MS = 10_000;

export interface ChatSessionRow {
  sessionId: string;
  title?: string | null;
  employeeId?: string | null;
  updatedAt?: string | null;
}

export interface ChatSessionListBody {
  items?: ChatSessionRow[] | null;
  nextCursor?: string | null;
}

export interface ChatMessageRow {
  role?: string | null;
  at?: string | null;
  text?: string | null;
  seq?: number | null;
}

export interface ChatSessionDetailBody {
  sessionId?: string;
  title?: string | null;
  employeeId?: string | null;
  updatedAt?: string | null;
  messages?: ChatMessageRow[] | null;
}

export interface ChatApi {
  listSessions(args?: { employeeId?: string; limit?: number }): Promise<ChatResult<ChatSessionListBody>>;
  sessionDetail(sessionId: string): Promise<ChatResult<ChatSessionDetailBody>>;
  /** `requestId` is generated once per new submission and reused on retry. */
  sendMessage(sessionId: string, requestId: string, content: string): Promise<ChatResult<unknown>>;
}

export interface ChatApiDeps {
  base?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  getToken?: () => string | null;
}

function readStoredToken(): string | null {
  try {
    return localStorage.getItem('ws_token');
  } catch {
    return null;
  }
}

export function createChatApi(deps: ChatApiDeps = {}): ChatApi {
  const base = deps.base ?? '/agent-api';
  const timeoutMs = deps.timeoutMs ?? CHAT_TIMEOUT_MS;
  const fetchImpl: typeof fetch = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const readToken = deps.getToken ?? readStoredToken;

  async function request<T>(path: string, init: RequestInit): Promise<ChatResult<T>> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    };
    const token = readToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, { ...init, headers, signal: controller?.signal });
    } catch {
      if (timer !== null) clearTimeout(timer);
      return {
        ok: false,
        status: 0,
        data: null,
        code: controller?.signal.aborted ? 'console.timeout' : 'console.network',
      };
    }
    const requestId = res.headers.get('X-Console-Request-Id') ?? undefined;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (timer !== null) clearTimeout(timer);
    if (!res.ok) {
      const env = body as { code?: string; message?: string } | null;
      return {
        ok: false,
        status: res.status,
        data: null,
        code: env?.code ?? `agent.http.${res.status}`,
        message: env?.message,
        requestId,
      };
    }
    return { ok: true, status: res.status, data: (body as T) ?? null, requestId };
  }

  return {
    listSessions(args = {}) {
      const qs = new URLSearchParams();
      if (args.employeeId) qs.set('employeeId', args.employeeId);
      if (args.limit) qs.set('limit', String(args.limit));
      const suffix = qs.toString();
      return request<ChatSessionListBody>(
        `/api/console-sessions${suffix ? `?${suffix}` : ''}`,
        { method: 'GET' },
      );
    },

    sessionDetail(sessionId: string) {
      if (!sessionId) {
        return Promise.resolve({ ok: false, status: 0, data: null, code: 'console.missing_param' });
      }
      return request<ChatSessionDetailBody>(
        `/api/console-sessions/${encodeURIComponent(sessionId)}`,
        { method: 'GET' },
      );
    },

    sendMessage(sessionId: string, requestId: string, content: string) {
      if (!sessionId || !requestId || !content.trim()) {
        return Promise.resolve({ ok: false, status: 0, data: null, code: 'console.missing_param' });
      }
      // The body carries exactly the two keys the endpoint accepts; anything
      // else is rejected upstream. No optimistic echo is added anywhere.
      const body = { requestId, content };
      return request<unknown>(
        `/api/console-sessions/${encodeURIComponent(sessionId)}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Console-Write': '1',
          },
          body: JSON.stringify(body),
        },
      );
    },
  };
}

// ---------- failure classification (copy selection only; codes stay hidden) ----------

export type ChatErrorKind = 'timeout' | 'network' | 'auth' | 'denied' | 'unavailable' | 'failed';

/**
 * 403 and 404 share one body on purpose: a session the caller cannot see and
 * a session that does not exist must look identical (L2 contract).
 */
export function chatErrorKind(status: number, code?: string): ChatErrorKind {
  if (status === 0) return code === 'console.timeout' ? 'timeout' : 'network';
  if (status === 401) return 'auth';
  if (status === 403 || status === 404) return 'denied';
  if (status >= 500) return 'unavailable';
  return 'failed';
}

export interface ChatFailure {
  kind: ChatErrorKind;
  status: number;
  requestId?: string;
}

export function chatFailure(res: ChatResult<unknown>): ChatFailure {
  return {
    kind: chatErrorKind(res.status, res.code),
    status: res.status,
    requestId: res.requestId,
  };
}

// ---------- render helpers ----------

/** Two bubble colors: the operator's own lines vs the employee's. */
export function messageSide(role?: string | null): 'me' | 'other' {
  return role === 'user' ? 'me' : 'other';
}

/** Whitespace-only text renders as 「暂无内容」, never as an empty bubble. */
export function hasText(text?: string | null): boolean {
  return typeof text === 'string' && text.trim() !== '';
}

/**
 * Server order is authoritative. When every row carries a numeric seq, honour
 * it (ASC); a page without seq is left exactly as delivered — never re-sorted
 * from a guess.
 */
export function sortMessages(rows?: ChatMessageRow[] | null): ChatMessageRow[] {
  const list = rows ?? [];
  const allSeq = list.length > 0 && list.every((r) => typeof r.seq === 'number' && Number.isFinite(r.seq));
  if (!allSeq) return list.slice();
  return list.slice().sort((a, b) => (a.seq as number) - (b.seq as number));
}

function padTwo(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Beijing time (UTC+8), no raw ISO on screen: today → HH:mm, same year →
 * MM-DD HH:mm, otherwise YYYY-MM-DD HH:mm. Invalid input → '—'.
 */
export function fmtChatTime(iso?: string | null, now: Date = new Date()): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return '—';
  const d = new Date(ms + 480 * 60000);
  const today = new Date(now.getTime() + 480 * 60000);
  const hm = `${padTwo(d.getUTCHours())}:${padTwo(d.getUTCMinutes())}`;
  const sameDay =
    d.getUTCFullYear() === today.getUTCFullYear() &&
    d.getUTCMonth() === today.getUTCMonth() &&
    d.getUTCDate() === today.getUTCDate();
  if (sameDay) return hm;
  const md = `${padTwo(d.getUTCMonth() + 1)}-${padTwo(d.getUTCDate())}`;
  return d.getUTCFullYear() === today.getUTCFullYear()
    ? `${md} ${hm}`
    : `${d.getUTCFullYear()}-${md} ${hm}`;
}

/** Retry of the same submission must reuse its id; a new one is only for new text. */
export function newRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through to the timestamp form */
  }
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Keep the deep link when it still exists, otherwise fall back to the newest row. */
export function pickSessionId(
  items: ChatSessionRow[],
  preferred?: string | null,
): string | null {
  if (preferred && items.some((row) => row.sessionId === preferred)) return preferred;
  return items.length > 0 ? items[0].sessionId : null;
}