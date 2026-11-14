/**
 * Digital-employee console (S10b slice 1) narrow data-layer interface.
 *
 * STUB NOTICE: this slice ships only `createStubAgentConsoleApi(fixtures)`,
 * a stub/fixture adapter for component tests and preview. It performs NO
 * network request, never reads the `ws_token` from storage, and never sends
 * any internal token. Real login/BFF paths are NOT verified; data source = stub.
 *
 * Field naming follows the contracts (CONSOLE@v0.1 / EMPLOYEE E11+E2 / E5 /
 * E10 / AP4):
 * - E11 `GET /v1/employees` -> EmployeeSummary (6 fields), keyset cursor,
 *   no `total`; last page OMITS the `nextCursor` key (not null).
 * - E10 `GET /v1/employees/{id}/workstations` -> {items[], nextCursor?}.
 * - AP4 `GET /v1/approvals?assignee=&status=pending` -> slice 1 uses the
 *   pending count only.
 *
 * Read tabs (tasks / runs / audit) add listTasks / listRuns / listAudit;
 * their contract types, stub helpers and demo fixtures live in
 * `./agentConsoleRead` (600-line file rule) and are re-exported below.
 */

import {
  DEMO_AUDIT_EVENTS,
  DEMO_RUNS,
  DEMO_TASKS,
  hasAnyAuditFilter,
  stubKeysetPage,
  type AuditEvent,
  type AuditList,
  type ListAuditParams,
  type ListRunsParams,
  type ListTasksParams,
  type Run,
  type RunList,
  type Task,
  type TaskList,
} from './agentConsoleRead';

export type {
  AuditActor,
  AuditEvent,
  AuditList,
  AuditOutcome,
  AuditResource,
  ListAuditParams,
  ListRunsParams,
  ListTasksParams,
  Run,
  RunList,
  RunStatus,
  Task,
  TaskList,
  TaskPriority,
  TaskSource,
  TaskStatus,
} from './agentConsoleRead';

// ---------- Contract types (subset used by slice 1) ----------

// Lifecycle per contracts EMPLOYEE.md §2: draft -> onboarding -> active ⇄
// paused; active/paused -> offboarding -> archived. 'suspended' is NOT a
// lifecycle state (legacy value, 工位语义 only) kept tolerated for old stubs.
export type LifecycleState =
  | 'draft'
  | 'onboarding'
  | 'active'
  | 'paused'
  | 'offboarding'
  | 'archived'
  | 'suspended';

/** E11 EmployeeSummary: list rows carry exactly these 6 fields. */
export interface EmployeeSummary {
  employeeId: string;
  name: string;
  title: string;
  lifecycleState: LifecycleState;
  ownerUserId: string;
  updatedAt: string; // ISO-8601
}

/** E11 response: last page omits the nextCursor key entirely. */
export interface EmployeeList {
  items: EmployeeSummary[];
  nextCursor?: string;
}

export interface ListEmployeesParams {
  /** Substring match on name and current-version title, case-insensitive; empty string = not provided. */
  keyword?: string;
  lifecycleState?: LifecycleState;
  /** Default 20, max 200 (E11). */
  limit?: number;
  /** Opaque keyset cursor; ordering fixed: (created_at DESC, id DESC). */
  cursor?: string;
}

/** E2 profile subset (currentVersionId kept for overview fallback logic). */
export interface EmployeeDetail {
  id: string;
  tenantId: string;
  name: string;
  title: string;
  lifecycleState: LifecycleState;
  currentVersionId: string | null;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
}

/** E5 grant subset. */
export interface EffectiveGrant {
  id: string;
  scopeType: string;
  /** E5 tagged selector: plain string or {type, ...} object. */
  resourceSelector: string | { type: string; [k: string]: unknown };
  actions: string[];
  source: string;
  expiresAt: string | null;
}

/** E5 effective-config subset (version.versionNo is the single source for the overview "version"). */
export interface EffectiveConfig {
  employee: EmployeeDetail;
  version: {
    id: string;
    employeeId: string;
    versionNo: number;
    jobDescription: string;
    grantIds: string[];
    responsePolicy: string;
    memoryScope: string;
  } | null;
  grants: EffectiveGrant[];
  resolvedAt: string;
  snapshotRef: string;
}

/** E10 workstation (all 7 fields required; status enum pending|active|suspended). */
export interface Workstation {
  id: string;
  employeeId: string;
  bindingType: string;
  channel: string;
  externalRef: string;
  capabilities: string[];
  status: 'pending' | 'active' | 'suspended';
}

export interface WorkstationList {
  items: Workstation[];
  nextCursor?: string;
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  code?: string;
  message?: string;
}

/** Overview fetch aggregate; each block may fail independently (per-block degradation). */
export interface OverviewBundle {
  employee: ApiResult<EmployeeDetail>;
  config: ApiResult<EffectiveConfig>;
  workstations: ApiResult<WorkstationList>;
  pendingApprovals: ApiResult<{ count: number }>;
}

// ---------- P0-13 Route A chat types (design §4) ----------

/** Strict body of `POST /api/employee-chat` (E5 -> P5 -> R1 server-side). */
export interface ChatRequest {
  employeeId: string;
  text: string;
  /** Client-generated UUID per user message; reused verbatim on retry so the
   * upstream idempotency key cannot create a second run for one message. */
  chatRequestKey: string;
}

/** R1 dispatch result: the created run plus its first status. */
export interface ChatRunResult {
  runId: string;
  status: string;
}

/**
 * One R3 run event (contract vocabulary: started / message / completed /
 * failed / cancelled / interrupted; reasonCode on failures). Narrower than
 * `agentConsoleRuns.RunEvent`: the chat panel only reads these fields.
 */
export interface RunEventItem {
  seq: number;
  eventType: string;
  /** Object in live captures; nullable and fail-soft on anything else. */
  payload: Record<string, unknown> | null;
  occurredAt: string;
}

/** R3 page normalized to `{items}` client-side (live uses `items`, older
 * envelopes `events`; the stub uses `items`). */
export interface RunEventList {
  items: RunEventItem[];
}

// ---------- Narrow interface ----------

export interface AgentConsoleApi {
  listEmployees(params: ListEmployeesParams): Promise<EmployeeList>;
  getEmployee(employeeId: string): Promise<ApiResult<EmployeeDetail>>;
  getEffectiveConfig(employeeId: string): Promise<ApiResult<EffectiveConfig>>;
  getWorkstations(employeeId: string): Promise<ApiResult<WorkstationList>>;
  /** AP4: assignee=human:<current user> + status=pending; slice 1 returns the count only. */
  countPendingApprovals(assignee: string): Promise<ApiResult<{ count: number }>>;
  /** T5 read-only task list; the tabs always pass assignee (no unfiltered query). */
  listTasks(params: ListTasksParams): Promise<TaskList>;
  /** R5 read-only run list; the tabs always pass employeeId. */
  listRuns(params: ListRunsParams): Promise<RunList>;
  /**
   * A3 read-only audit list. The BFF rejects an unfiltered query with 400
   * `console.missing_filter`, so callers MUST pass at least one filter
   * (runId/taskId/actorId/resourceId/action/from/to); the HTTP adapter
   * throws UpstreamError('console.missing_filter') without sending if not.
   */
  listAudit(params: ListAuditParams): Promise<AuditList>;
  /**
   * P0-13 Route A: send one chat message (E5 -> P5 -> R1 server-side; the
   * BFF returns the runId + first status). OPTIONAL so existing stubs and
   * tests keep compiling; ChatTab degrades to "chat not wired" when absent.
   */
  sendChat?(input: ChatRequest): Promise<ApiResult<ChatRunResult>>;
  /**
   * P0-13 Route A (R3): incremental event poll for one run. `sinceSeq` is an
   * exclusive lower bound. OPTIONAL for the same reason as sendChat.
   */
  listRunEvents?(
    runId: string,
    sinceSeq: number,
    limit?: number,
  ): Promise<ApiResult<RunEventList>>;
}

// ---------- Stub / fixture adapter (tests & preview only; no network, no tokens) ----------

/** Fixed fake runId used by the stub chat methods (deterministic, ASCII). */
export const STUB_CHAT_RUN_ID = '01RUNSTUBCHAT0000000000001';
/** Fixed stub event timestamps (no clock reads, no randomness). */
const STUB_CHAT_TS = ['2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z', '2026-01-01T00:00:02Z'];

export interface AgentConsoleFixtures {
  employees: EmployeeSummary[];
  details?: Record<string, EmployeeDetail>;
  configs?: Record<string, EffectiveConfig>;
  workstations?: Record<string, Workstation[]>;
  pendingApprovalCounts?: Record<string, number>;
  tasks?: Task[];
  runs?: Run[];
  audit?: AuditEvent[];
}

function mkResult<T>(data: T): ApiResult<T> {
  return { ok: true, status: 200, data };
}

export function mkNotFound<T = never>(code = 'employee.not_found'): ApiResult<T> {
  return { ok: false, status: 404, data: null, code, message: 'not found (stub)' };
}

/**
 * Deterministic E11-shaped stub filtering: case-insensitive keyword substring
 * (empty = not provided), exact lifecycleState filter, limit default 20 / max
 * 200, numeric-offset cursor slicing the fixture order. Stub keeps the order
 * given by fixtures (the real endpoint orders by created_at DESC, id DESC).
 * No randomness anywhere.
 */
export function createStubAgentConsoleApi(
  fixtures: AgentConsoleFixtures,
): AgentConsoleApi {
  // Last text sent through the stub chat methods (scripted echo source).
  let lastStubChatText: string | null = null;
  return {
    async listEmployees({ keyword, lifecycleState, limit, cursor }) {
      const kw = (keyword ?? '').trim().toLowerCase();
      const effLimit = Math.min(Math.max(limit ?? 20, 1), 200);
      let rows = fixtures.employees.slice();
      if (kw) {
        rows = rows.filter(
          (e) =>
            e.name.toLowerCase().includes(kw) ||
            e.title.toLowerCase().includes(kw),
        );
      }
      if (lifecycleState) {
        rows = rows.filter((e) => e.lifecycleState === lifecycleState);
      }
      const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
      const page = rows.slice(offset, offset + effLimit);
      const result: EmployeeList = { items: page };
      if (offset + effLimit < rows.length) {
        result.nextCursor = String(offset + effLimit);
      }
      return result;
    },

    async getEmployee(employeeId) {
      const detail = fixtures.details?.[employeeId];
      return detail ? mkResult(detail) : mkNotFound();
    },

    async getEffectiveConfig(employeeId) {
      const cfg = fixtures.configs?.[employeeId];
      return cfg ? mkResult(cfg) : mkNotFound();
    },

    async getWorkstations(employeeId) {
      const list = fixtures.workstations?.[employeeId];
      return list ? mkResult({ items: list }) : mkNotFound();
    },

    async countPendingApprovals(assignee) {
      const counts = fixtures.pendingApprovalCounts;
      if (!counts || !(assignee in counts)) return mkResult({ count: 0 });
      return mkResult({ count: counts[assignee] });
    },

    async listTasks({ assignee, status, dueBefore, limit, cursor }) {
      let rows = (fixtures.tasks ?? []).slice();
      if (assignee) rows = rows.filter((t) => t.assignee === assignee);
      if (status) rows = rows.filter((t) => t.status === status);
      if (dueBefore) {
        rows = rows.filter((t) => t.dueAt !== null && t.dueAt <= dueBefore);
      }
      return stubKeysetPage(rows, limit, cursor, 200);
    },

    async listRuns({ employeeId, status, since, limit, cursor }) {
      let rows = (fixtures.runs ?? []).slice();
      if (employeeId) rows = rows.filter((r) => r.employeeId === employeeId);
      if (status) rows = rows.filter((r) => r.status === status);
      // Not-yet-started rows (startedAt null) survive `since`.
      if (since) rows = rows.filter((r) => r.startedAt === null || r.startedAt >= since);
      return stubKeysetPage(rows, limit, cursor, 100);
    },

    async listAudit({ runId, taskId, actorId, resourceId, action, from, to, limit, cursor }) {
      let rows = (fixtures.audit ?? []).slice();
      if (runId) rows = rows.filter((a) => a.runId === runId);
      if (taskId) rows = rows.filter((a) => a.taskId === taskId);
      if (actorId) rows = rows.filter((a) => a.actor.id === actorId);
      if (resourceId) rows = rows.filter((a) => a.resource.id === resourceId);
      if (action) rows = rows.filter((a) => a.action === action);
      if (from) rows = rows.filter((a) => a.occurredAt >= from);
      if (to) rows = rows.filter((a) => a.occurredAt <= to);
      return stubKeysetPage(rows, limit, cursor, 200);
    },

    // P0-13 chat stub: deterministic scripted echo (design §4). NOT real
    // data: one fixed runId, the echo of the last user text prefixed with
    // "stub:", fixed timestamps; no randomness, no network, no tokens.
    async sendChat(input) {
      lastStubChatText = input.text;
      return mkResult<ChatRunResult>({
        runId: STUB_CHAT_RUN_ID,
        status: 'running',
      });
    },

    async listRunEvents(runId, sinceSeq) {
      if (runId !== STUB_CHAT_RUN_ID || lastStubChatText === null) {
        return mkResult<RunEventList>({ items: [] });
      }
      const all: RunEventItem[] = [
        { seq: 1, eventType: 'started', payload: null, occurredAt: STUB_CHAT_TS[0] },
        {
          seq: 2,
          eventType: 'message',
          payload: { text: `stub:${lastStubChatText}` },
          occurredAt: STUB_CHAT_TS[1],
        },
        { seq: 3, eventType: 'completed', payload: null, occurredAt: STUB_CHAT_TS[2] },
      ];
      const from = sinceSeq ?? 0;
      return mkResult<RunEventList>({ items: all.filter((e) => e.seq > from) });
    },
  };
}

/**
 * Demo fixtures (3+ employees, multiple lifecycle states, long-field samples)
 * used ONLY by component tests / preview. ASCII-only values so the i18n
 * no-hardcoded-Chinese lint stays green. Not real tenant data.
 */
export const DEMO_FIXTURES: AgentConsoleFixtures = (() => {
  const employees: EmployeeSummary[] = [
    {
      employeeId: '01DEMOEMPLOYEE000000000001',
      name: 'Koi Claw (stub demo)',
      title: 'Store-visit content planner',
      lifecycleState: 'active',
      ownerUserId: 'user_demo_owner',
      updatedAt: '2026-11-10T08:00:00Z',
    },
    {
      employeeId: '01DEMOEMPLOYEE000000000002',
      name: 'Inspector Two (stub demo)',
      title: 'Channel config inspector',
      lifecycleState: 'paused',
      ownerUserId: 'user_second_owner',
      updatedAt: '2026-11-09T02:30:00Z',
    },
    {
      employeeId: '01DEMOEMPLOYEE000000000003',
      name:
        'ExtremelyLongEmployeeDisplayNameUsedToVerifyThatNarrowViewportRowsDoNotOverflowHorizontallyStubDemo',
      title:
        'Cross-domain-composite-job-title-verification-string-storevisit-ads-review-fullchain',
      lifecycleState: 'archived',
      ownerUserId: 'user_other_owner',
      updatedAt: '2026-11-01T12:00:00Z',
    },
  ];
  const details: Record<string, EmployeeDetail> = {};
  for (const e of employees) {
    details[e.employeeId] = {
      id: e.employeeId,
      tenantId: 'tenant_demo',
      name: e.name,
      title: e.title,
      lifecycleState: e.lifecycleState,
      currentVersionId: `ver_${e.employeeId.slice(-3)}_03`,
      ownerUserId: e.ownerUserId,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: e.updatedAt,
    };
  }
  const configs: Record<string, EffectiveConfig> = {
    '01DEMOEMPLOYEE000000000001': {
      employee: details['01DEMOEMPLOYEE000000000001'],
      version: {
        id: 'ver_001_03',
        employeeId: '01DEMOEMPLOYEE000000000001',
        versionNo: 3,
        jobDescription: 'Owns store-visit video scripts and publish plans (stub data)',
        grantIds: ['grant_readonly_1', 'grant_readonly_2'],
        responsePolicy: 'approval_required_on_write',
        memoryScope: 'tenant',
      },
      grants: [
        {
          id: 'grant_readonly_1',
          scopeType: 'knowledge_space',
          resourceSelector: 'space:store-visit',
          actions: ['read'],
          source: 'role',
          expiresAt: null,
        },
        {
          id: 'grant_readonly_2',
          scopeType: 'channel',
          resourceSelector: 'channel:wechat/group-demo',
          actions: ['read', 'propose'],
          source: 'direct',
          expiresAt: '2026-12-31T23:59:59Z',
        },
      ],
      resolvedAt: '2026-11-10T08:00:00Z',
      snapshotRef: 'snap_demo_0003',
    },
  };
  const workstations: Record<string, Workstation[]> = {
    '01DEMOEMPLOYEE000000000001': [
      {
        id: 'ws_demo_1',
        employeeId: '01DEMOEMPLOYEE000000000001',
        bindingType: 'group',
        channel: 'wechat',
        externalRef: 'demo-group-001',
        capabilities: ['mention', 'digest'],
        status: 'active',
      },
      {
        id: 'ws_demo_2',
        employeeId: '01DEMOEMPLOYEE000000000001',
        bindingType: 'dm',
        channel: 'wecom',
        externalRef: 'demo-dm-002',
        capabilities: ['mention'],
        status: 'suspended',
      },
    ],
  };
  return {
    employees,
    details,
    configs,
    workstations,
    pendingApprovalCounts: { 'human:user_demo_owner': 2 },
    tasks: DEMO_TASKS,
    runs: DEMO_RUNS,
    audit: DEMO_AUDIT_EVENTS,
  };
})();

// ---------------------------------------------------------------------------
// Real HTTP adapter (S10b-2 pitch 3). Same-origin `/agent-api` prefix served
// by Caddy and proxied to the console BFF; the BFF injects tenant + internal
// token after checking the Bisheng login token via /api/v1/user/info.
// Never fabricates data: 401 raises AuthError, 5xx/network raises UpstreamError.
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  constructor(message = 'login required or expired') {
    super(message);
    this.name = 'AuthError';
  }
}

export class UpstreamError extends Error {
  constructor(message = 'console upstream unavailable') {
    super(message);
    this.name = 'UpstreamError';
  }
}

export interface HttpAgentConsoleApiOptions {
  /** Same-origin prefix routed by Caddy to the console BFF. */
  base?: string;
  /** Token provider; defaults to the Bisheng web token in localStorage. */
  getToken?: () => string | null;
}

/**
 * P0-13 design §1: normalize all three live error shapes —
 * BFF `{code,message}`, runtime `{error:{code,message,details}}`,
 * FastAPI `{detail}` — into `{code, message}`. Never fabricates: without a
 * code in the body the fallback is `agent.http.<status>`.
 */
function readErrorEnvelope(
  body: unknown,
  status: number,
): { code: string; message?: string } {
  const fallbackCode = `agent.http.${status}`;
  if (typeof body !== 'object' || body === null) {
    return { code: fallbackCode };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.code === 'string') {
    return {
      code: b.code,
      message: typeof b.message === 'string' ? b.message : undefined,
    };
  }
  const nested = b.error;
  if (typeof nested === 'object' && nested !== null) {
    const e = nested as Record<string, unknown>;
    return {
      code: typeof e.code === 'string' ? e.code : fallbackCode,
      message: typeof e.message === 'string' ? e.message : undefined,
    };
  }
  if (typeof b.detail === 'string') {
    return { code: fallbackCode, message: b.detail };
  }
  return { code: fallbackCode };
}

export function createHttpAgentConsoleApi(
  options: HttpAgentConsoleApiOptions = {},
): AgentConsoleApi {
  const base = options.base ?? '/agent-api';
  const getToken =
    options.getToken ??
    (() =>
      typeof localStorage !== 'undefined'
        ? localStorage.getItem('ws_token')
        : null);

  async function request<T>(
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<ApiResult<T>> {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        qs.set(key, String(value));
      }
    }
    const query = qs.toString();
    const url = `${base}${path}${query ? `?${query}` : ''}`;
    const token = getToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let res: Response;
    try {
      res = await fetch(url, { headers });
    } catch {
      throw new UpstreamError('console request failed (network)');
    }
    if (res.status === 401) {
      throw new AuthError();
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      if (res.ok) {
        throw new UpstreamError('invalid JSON from console gateway');
      }
    }
    if (!res.ok) {
      const envelope = body as { code?: string; message?: string } | null;
      return {
        ok: false,
        status: res.status,
        data: null,
        code: envelope?.code ?? `agent.http.${res.status}`,
        message: envelope?.message,
      };
    }
    return { ok: true, status: res.status, data: body as T };
  }

  /**
   * P0-13 write variant: same-origin POST with the JSON + write-gate headers
   * (design §4). Unlike the GET `request`, auth/network failures come back as
   * ApiResult (status + normalized code) so the chat panel can render honest
   * per-row failure states instead of unmounting into a page-level error.
   */
  async function postJson<T>(path: string, body: unknown): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Console-Write': '1',
    };
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch {
      return {
        ok: false,
        status: 0,
        data: null,
        code: 'console.upstream_unavailable',
        message: 'console request failed (network)',
      };
    }
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      if (res.ok) {
        throw new UpstreamError('invalid JSON from console gateway');
      }
    }
    if (!res.ok) {
      const err = readErrorEnvelope(payload, res.status);
      return { ok: false, status: res.status, data: null, code: err.code, message: err.message };
    }
    return { ok: true, status: res.status, data: payload as T };
  }

  /** GET variant of postJson error honesty: never throws on 401/4xx/5xx;
   * every failure becomes ApiResult with the three-form normalized code. */
  async function requestChecked<T>(
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<ApiResult<T>> {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        qs.set(key, String(value));
      }
    }
    const query = qs.toString();
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    let res: Response;
    try {
      res = await fetch(`${base}${path}${query ? `?${query}` : ''}`, { headers });
    } catch {
      return {
        ok: false,
        status: 0,
        data: null,
        code: 'console.upstream_unavailable',
        message: 'console request failed (network)',
      };
    }
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      if (res.ok) {
        throw new UpstreamError('invalid JSON from console gateway');
      }
    }
    if (!res.ok) {
      const err = readErrorEnvelope(payload, res.status);
      return { ok: false, status: res.status, data: null, code: err.code, message: err.message };
    }
    return { ok: true, status: res.status, data: payload as T };
  }

  return {
    async listEmployees({ keyword, lifecycleState, limit, cursor }) {
      const res = await request<EmployeeList>('/api/employees', {
        keyword,
        lifecycleState,
        limit,
        cursor,
      });
      if (!res.ok || !res.data) {
        throw new UpstreamError(res.code ?? 'agent.http.unknown');
      }
      return res.data;
    },
    async getEmployee(employeeId) {
      return request<EmployeeDetail>('/api/employee', { id: employeeId });
    },
    async getEffectiveConfig(employeeId) {
      return request<EffectiveConfig>('/api/effective-config', {
        id: employeeId,
      });
    },
    async getWorkstations(employeeId) {
      // E10 page cap is 100; overview only lists the first row + count.
      return request<WorkstationList>('/api/workstations', {
        id: employeeId,
        limit: 100,
      });
    },
    async countPendingApprovals(assignee) {
      const res = await request<{ items: unknown[]; nextCursor?: string }>(
        '/api/approvals',
        { assignee, status: 'pending', limit: 100 },
      );
      if (res.ok && res.data) {
        if (res.data.nextCursor !== undefined) {
          // Truncated page: the count would understate reality, so we
          // degrade to the "not wired yet" note instead of showing a lie.
          return {
            ok: false,
            status: res.status,
            data: null,
            code: 'agent.approvals_overflow',
          };
        }
        return {
          ok: true,
          status: res.status,
          data: { count: res.data.items.length },
        };
      }
      return res;
    },

    async listTasks({ assignee, status, dueBefore, limit, cursor }) {
      const res = await request<TaskList>('/api/tasks', {
        assignee,
        status,
        dueBefore,
        limit,
        cursor,
      });
      if (!res.ok || !res.data) {
        throw new UpstreamError(res.code ?? 'agent.http.unknown');
      }
      return res.data;
    },

    async listRuns({ employeeId, status, since, limit, cursor }) {
      // Live R5 returns `"nextCursor": null` on the last page (vs E11 which
      // omits the key); normalize so the UI treats both as "no more pages".
      const res = await request<RunList & { nextCursor?: string | null }>(
        '/api/runs',
        { employeeId, status, since, limit, cursor },
      );
      if (!res.ok || !res.data) {
        throw new UpstreamError(res.code ?? 'agent.http.unknown');
      }
      const { nextCursor, items } = res.data;
      return { items: items ?? [], nextCursor: nextCursor ?? undefined };
    },

    async listAudit({ runId, taskId, actorId, resourceId, action, from, to, limit, cursor }) {
      const params = { runId, taskId, actorId, resourceId, action, from, to, limit, cursor };
      // A3 rejects unfiltered queries (400 console.missing_filter); never
      // send one, and pass the code through unchanged so the UI shows it.
      if (!hasAnyAuditFilter(params)) {
        throw new UpstreamError('console.missing_filter');
      }
      const res = await request<
        AuditList & { events?: AuditEvent[]; nextCursor?: string | null }
      >('/api/audit', params);
      if (!res.ok || !res.data) {
        throw new UpstreamError(res.code ?? 'agent.http.unknown');
      }
      // Live A3 wraps rows under `events` (not `items`); normalize both shapes.
      const rows = res.data.items ?? res.data.events ?? [];
      return { items: rows, nextCursor: res.data.nextCursor ?? undefined };
    },

    async sendChat(input) {
      // Strict body per design §1; the BFF identity gate resolves
      // tenant/actor from the Bisheng session. No internal token here.
      return postJson<ChatRunResult>('/api/employee-chat', {
        employeeId: input.employeeId,
        text: input.text,
        chatRequestKey: input.chatRequestKey,
      });
    },

    async listRunEvents(runId, sinceSeq, limit) {
      if (!runId) {
        // A missing runId is a client bug; mirror agentConsoleRuns and fail
        // soft as an honest unavailable result instead of sending a bad query.
        return {
          ok: false,
          status: 0,
          data: null,
          code: 'agent.runs.missing_required_param',
        };
      }
      const res = await requestChecked<
        RunEventList & { events?: unknown[]; nextSeq?: number | null; hasMore?: boolean }
      >('/api/run-events', { runId, sinceSeq, limit });
      if (!res.ok || !res.data) {
        return { ok: false, status: res.status, data: null, code: res.code, message: res.message };
      }
      // Live R3 wraps rows under `items`; older/harness envelopes `events`.
      const rows = (res.data.items ?? res.data.events ?? []) as RunEventItem[];
      return { ok: true, status: res.status, data: { items: rows } };
    },
  };
}
