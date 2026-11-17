/**
 * EMP-02 `/agent/employees/new` + TSK-03 `/agent/tasks/new` — the one write
 * path both pages share (EMP02-TARGET-SPEC §3/§5, TSK03-TARGET-SPEC §3/§5).
 *
 * The console is read-only everywhere else; these two pages are the exception:
 * the BFF exposes `POST /api/employees` and `POST /api/tasks` and injects
 * tenant / internal token / user context itself. The browser therefore sends
 * exactly three write-relevant things:
 *   - `Authorization: Bearer <session token>` (same as every read),
 *   - `Idempotency-Key` — REQUIRED, generated once when a submit starts and
 *     reused by every retry of that same submission,
 *   - the JSON body (no tenant id, no internal token, no actor id).
 *
 * Idempotency semantics are the product rule, not an implementation detail:
 *   same key + same body  → 200 with the FIRST result (never a second record)
 *   same key + new body   → 409, and the page says 「这次没有保存」
 *   missing key           → a client bug, never papered over with an empty or
 *                           server-generated key
 *
 * Failure classification is by MEANING, not by code: the page branches on
 * `kind` (invalid / auth / forbidden / conflict / unavailable) and the numeric
 * status only ever surfaces inside the collapsed technical details.
 */

export type WriteFailureKind =
  | 'invalid' // 400: the content did not pass the upstream check
  | 'auth' // 401: the session is gone
  | 'forbidden' // 403 / 404: no permission, or the address is not available
  | 'conflict' // 409: same key, different body
  | 'unavailable'; // 0 / 5xx: transport or service failure

export interface WriteSuccess<T> {
  ok: true;
  status: number;
  data: T;
  requestId?: string;
}

export interface WriteFailure {
  ok: false;
  status: number;
  kind: WriteFailureKind;
  /** Upstream machine code — never rendered as body copy, only kept for diagnostics. */
  code?: string;
  requestId?: string;
}

/**
 * One shape for both branches. The repo compiles with `strict: false`, where
 * literal-boolean discrimination in unions is not reliable — so the outcome
 * carries an explicit optional `kind` instead of relying on narrowing.
 */
export interface WriteOutcome<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** Present only when `ok` is false. */
  kind?: WriteFailureKind;
  code?: string;
  requestId?: string;
}

export interface WriteEnv {
  /** Same-origin prefix routed by the gateway to the console BFF. */
  base?: string;
  getToken?: () => string | null;
  /** Test seam; production always uses the global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE = '/agent-api';

/**
 * One key per submission group. `crypto.randomUUID` is available in every
 * browser this console supports; the fallback keeps jsdom and older engines
 * working without silently sending an empty header.
 */
export function newIdempotencyKey(): string {
  try {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {
    /* fall through */
  }
  const rand = () => Math.random().toString(16).slice(2, 10);
  return `${rand()}${rand()}${Date.now().toString(16)}`.slice(0, 32);
}

/** Status → product meaning. 403 and 404 are deliberately one bucket. */
export function classifyStatus(status: number): WriteFailureKind {
  if (status === 400) return 'invalid';
  if (status === 401) return 'auth';
  if (status === 403 || status === 404) return 'forbidden';
  if (status === 409) return 'conflict';
  return 'unavailable';
}

/** Strip a tolerated envelope (`{item}` / `{data}` / `{employee}` / `{task}`). */
export function unwrapBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const rec = body as Record<string, unknown>;
  for (const key of ['item', 'data', 'employee', 'task', 'result']) {
    const inner = rec[key];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner;
  }
  return body;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

export interface CreatedEmployee {
  id: string;
  name?: string;
  title?: string;
  lifecycleState?: string;
}

/** E1 response: `id` + `lifecycleState` (live体), camel/snake both tolerated. */
export function readCreatedEmployee(body: unknown): CreatedEmployee | null {
  const rec = unwrapBody(body) as Record<string, unknown> | null;
  if (!rec || typeof rec !== 'object') return null;
  const id = str(rec.id) ?? str(rec.employeeId) ?? str(rec.employee_id);
  if (!id) return null;
  return {
    id,
    name: str(rec.name),
    title: str(rec.title),
    lifecycleState: str(rec.lifecycleState) ?? str(rec.lifecycle_state),
  };
}

export interface CreatedTask {
  taskId: string;
  title?: string;
  status?: string;
  assignee?: { type?: string; id?: string; displayName?: string } | null;
}

/** T1 response: `taskId`, `assignee`, `status`; snake_case tolerated. */
export function readCreatedTask(body: unknown): CreatedTask | null {
  const rec = unwrapBody(body) as Record<string, unknown> | null;
  if (!rec || typeof rec !== 'object') return null;
  const taskId = str(rec.taskId) ?? str(rec.task_id) ?? str(rec.id);
  if (!taskId) return null;
  const rawAssignee = rec.assignee;
  let assignee: CreatedTask['assignee'] = null;
  if (rawAssignee && typeof rawAssignee === 'object') {
    const a = rawAssignee as Record<string, unknown>;
    assignee = {
      type: str(a.type),
      id: str(a.id) ?? str(a.employeeId) ?? str(a.employee_id),
      displayName: str(a.displayName) ?? str(a.display_name) ?? str(a.name),
    };
  }
  return {
    taskId,
    title: str(rec.title),
    status: str(rec.status),
    assignee,
  };
}

/**
 * Display form of an opaque id: `emp_7K2MQ4X9TB3N` → `emp_7K2M…TB3N`.
 * The full value always stays in `title` and in the copy payload; a short id
 * that would lose information (≤ prefix+4+4+1) is returned unchanged.
 */
export function shortRef(id: string): string {
  const value = id.trim();
  if (!value) return value;
  const underscore = value.indexOf('_');
  const prefix = underscore >= 0 && underscore <= 6 ? value.slice(0, underscore + 1) : '';
  const rest = underscore >= 0 && underscore <= 6 ? value.slice(underscore + 1) : value;
  if (rest.length <= 9) return value;
  return `${prefix}${rest.slice(0, 4)}…${rest.slice(-4)}`;
}

/**
 * The single browser write call. Never throws on HTTP/auth/network failure —
 * every branch becomes a classified outcome so the page can keep the user's
 * typed content on screen instead of unmounting into a page-level error.
 */
export async function submitWrite<T>(
  args: { path: string; body: unknown; key: string; env?: WriteEnv }
): Promise<WriteOutcome<T>> {
  const env = args.env ?? {};
  const base = env.base ?? DEFAULT_BASE;
  const readToken =
    env.getToken ??
    (() => {
      try {
        return typeof localStorage !== 'undefined' ? localStorage.getItem('ws_token') : null;
      } catch {
        return null;
      }
    });
  const doFetch = env.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    // Required by the BFF; a retry reuses this exact value so the upstream
    // idempotency ledger answers with the first result instead of a second row.
    'Idempotency-Key': args.key,
  };
  const token = readToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  if (!doFetch) {
    return { ok: false, status: 0, data: null, kind: 'unavailable', code: 'console.no_fetch' };
  }

  let res: Response;
  try {
    res = await doFetch(`${base}${args.path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(args.body ?? {}),
    });
  } catch {
    return { ok: false, status: 0, data: null, kind: 'unavailable', code: 'console.upstream_unavailable' };
  }

  const requestId = res.headers?.get?.('X-Console-Request-Id') ?? undefined;
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const envelope = (payload ?? {}) as { code?: string };
    return {
      ok: false,
      status: res.status,
      data: null,
      kind: classifyStatus(res.status),
      code: typeof envelope.code === 'string' ? envelope.code : undefined,
      requestId,
    };
  }

  return { ok: true, status: res.status, data: payload as T, requestId };
}

/** True when the incoming values differ from the pristine form (any field). */
export function isDirty(values: Record<string, string>, pristine: Record<string, string>): boolean {
  return Object.keys(values).some((k) => (values[k] ?? '') !== (pristine[k] ?? ''));
}