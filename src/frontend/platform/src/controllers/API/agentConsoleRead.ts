/**
 * Read-only console list contracts (tasks / runs / audit) + stub helpers.
 *
 * Split out of `agent.ts` only to keep each file under the 600-line frontend
 * rule; the AgentConsoleApi interface, both adapters and DEMO_FIXTURES still
 * live there and re-export everything below.
 *
 * Field naming follows the BFF read endpoints (all GET-only, keyset cursor,
 * last page OMITS the `nextCursor` key):
 * - T5 `GET /api/tasks` -> TaskList; params assignee/status/dueBefore,
 *   limit <= 200.
 * - R5 `GET /api/runs` -> RunList; params employeeId/status/since,
 *   limit <= 100.
 * - A3 `GET /api/audit` -> AuditList; the BFF REJECTS an unfiltered query
 *   with 400 `console.missing_filter`, so the client never sends one
 *   (see `hasAnyAuditFilter`). limit <= 200.
 */

// ---------- T5 tasks ----------

export type TaskStatus = 'open' | 'in_progress' | 'done' | 'blocked' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high';

/** Task source envelope; `channel` is the only display field, extras are tolerated. */
export interface TaskSource {
  channel: string;
  [key: string]: unknown;
}

export interface Task {
  taskId: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  /** Contract-guaranteed key, nullable: never fabricate a value. */
  progressNote: string | null;
  /** Contract-guaranteed key, nullable. */
  statusReason: string | null;
  source: TaskSource;
  createdAt: string;
  updatedAt: string;
  /**
   * List-filter key (T5 `assignee=employee:<id>`); not a display column.
   * Optional because the display subset above is what the UI is guaranteed.
   */
  assignee?: string;
}

export interface TaskList {
  items: Task[];
  nextCursor?: string;
}

export interface ListTasksParams {
  assignee?: string;
  status?: TaskStatus;
  /** ISO-8601 upper bound on `dueAt`. */
  dueBefore?: string;
  /** Default 20, max 200 (T5). */
  limit?: number;
  cursor?: string;
}

// ---------- R5 runs ----------

export type RunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface Run {
  runId: string;
  status: RunStatus;
  employeeVersionNo: number;
  startedAt: string | null;
  endedAt: string | null;
  /** Raw upstream figure; the UI always labels it with the basis (S5.6). */
  costUsd: number;
  reasonCode: string | null;
  attemptNo: number;
  taskId: string | null;
  /**
   * List-filter key (R5 `employeeId=`); not a display column. Optional for
   * the same reason as Task.assignee above.
   */
  employeeId?: string;
}

export interface RunList {
  items: Run[];
  nextCursor?: string;
}

export interface ListRunsParams {
  employeeId?: string;
  status?: RunStatus;
  /** ISO-8601 lower bound; not-yet-started rows are kept. */
  since?: string;
  /** Default 20, max 100 (R5). */
  limit?: number;
  cursor?: string;
}

// ---------- A3 audit ----------

export type AuditOutcome = 'success' | 'failure' | 'denied' | 'pending';

export interface AuditActor {
  type: string;
  id: string;
}

export interface AuditResource {
  type: string;
  id: string;
}

export interface AuditEvent {
  eventId: string;
  occurredAt: string;
  actor: AuditActor;
  action: string;
  resource: AuditResource;
  outcome: AuditOutcome;
  decision: string | null;
  responsibleHumanId: string | null;
  runId: string;
  taskId: string;
}

export interface AuditList {
  items: AuditEvent[];
  nextCursor?: string;
}

export interface ListAuditParams {
  runId?: string;
  taskId?: string;
  actorId?: string;
  resourceId?: string;
  action?: string;
  from?: string;
  to?: string;
  /** Default 20, max 200 (A3). */
  limit?: number;
  cursor?: string;
}

/**
 * Client-side guard mirroring the BFF precondition: A3 answers 400
 * `console.missing_filter` to an unfiltered query, so the UI must never
 * build one. Returns true when at least one real filter is present.
 */
export function hasAnyAuditFilter(params: ListAuditParams): boolean {
  return [
    params.runId,
    params.taskId,
    params.actorId,
    params.resourceId,
    params.action,
    params.from,
    params.to,
  ].some((v) => v !== undefined && v !== '');
}

/**
 * Deterministic stub pagination shared by the three list stubs. Mirrors the
 * `listEmployees` stub exactly: clamp limit (default 20, cap `max`), numeric
 * offset cursor, OMIT the nextCursor key on the last page.
 */
export function stubKeysetPage<T>(
  rows: T[],
  limit: number | undefined,
  cursor: string | undefined,
  max: number,
): { items: T[]; nextCursor?: string } {
  const effLimit = Math.min(Math.max(limit ?? 20, 1), max);
  const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
  const page = rows.slice(offset, offset + effLimit);
  const result: { items: T[]; nextCursor?: string } = { items: page };
  if (offset + effLimit < rows.length) {
    result.nextCursor = String(offset + effLimit);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Demo fixtures for the read tabs (stub data / preview ONLY). ASCII-only
// values (i18n no-hardcoded-Chinese lint), zero randomness, ordered newest
// first like the real keyset endpoints.
// ---------------------------------------------------------------------------

const DEMO_EMP1 = '01DEMOEMPLOYEE000000000001';
const DEMO_EMP2 = '01DEMOEMPLOYEE000000000002';
const DEMO_TASK1 = '01DEMOTASK0000000000000001';
export const DEMO_RUN1 = '01DEMORUN000000000000000001';
const DEMO_RUN2 = '01DEMORUN000000000000000002';

export const DEMO_TASKS: Task[] = [
  {
    taskId: DEMO_TASK1,
    assignee: `employee:${DEMO_EMP1}`,
    title: 'Draft the store-visit script for the demo group',
    status: 'open',
    priority: 'high',
    dueAt: '2026-11-15T10:00:00Z',
    progressNote: null,
    statusReason: null,
    source: { channel: 'wechat', externalRef: 'demo-group-001' },
    createdAt: '2026-11-10T08:05:00Z',
    updatedAt: '2026-11-11T02:00:00Z',
  },
  {
    taskId: '01DEMOTASK0000000000000002',
    assignee: `employee:${DEMO_EMP1}`,
    title: 'Collect review notes for the published digest',
    status: 'in_progress',
    priority: 'normal',
    dueAt: '2026-11-13T18:00:00Z',
    progressNote: 'Second draft shared with the reviewer',
    statusReason: null,
    source: { channel: 'wecom' },
    createdAt: '2026-11-09T01:00:00Z',
    updatedAt: '2026-11-11T05:30:00Z',
  },
  {
    taskId: '01DEMOTASK0000000000000003',
    assignee: `employee:${DEMO_EMP1}`,
    title: 'Prepare the weekly channel digest',
    status: 'blocked',
    priority: 'low',
    dueAt: null,
    progressNote: null,
    statusReason: 'Waiting for the publish plan approval',
    source: { channel: 'slack' },
    createdAt: '2026-11-08T00:00:00Z',
    updatedAt: '2026-11-10T09:00:00Z',
  },
];

export const DEMO_RUNS: Run[] = [
  {
    runId: DEMO_RUN1,
    employeeId: DEMO_EMP1,
    status: 'completed',
    employeeVersionNo: 3,
    startedAt: '2026-11-11T01:00:00Z',
    endedAt: '2026-11-11T01:04:30Z',
    costUsd: 0.42,
    reasonCode: null,
    attemptNo: 1,
    taskId: DEMO_TASK1,
  },
  {
    runId: DEMO_RUN2,
    employeeId: DEMO_EMP1,
    status: 'failed',
    employeeVersionNo: 2,
    startedAt: '2026-11-10T09:30:00Z',
    endedAt: '2026-11-10T09:31:00Z',
    // Zero stays zero WITH the basis label; never hidden, never summed.
    costUsd: 0,
    reasonCode: 'upstream.timeout',
    attemptNo: 2,
    taskId: null,
  },
  {
    runId: '01DEMORUN000000000000000003',
    employeeId: DEMO_EMP1,
    status: 'interrupted',
    employeeVersionNo: 2,
    startedAt: '2026-11-09T22:00:00Z',
    endedAt: null,
    costUsd: 0.05,
    reasonCode: 'worker.restart',
    attemptNo: 1,
    taskId: null,
  },
  {
    runId: '01DEMORUN000000000000000004',
    employeeId: DEMO_EMP2,
    status: 'cancelled',
    employeeVersionNo: 1,
    startedAt: null,
    endedAt: null,
    costUsd: 0,
    reasonCode: null,
    attemptNo: 1,
    taskId: null,
  },
];

export const DEMO_AUDIT_EVENTS: AuditEvent[] = [
  {
    eventId: '01DEMOAUDIT00000000000001',
    occurredAt: '2026-11-11T01:00:10Z',
    actor: { type: 'employee', id: DEMO_EMP1 },
    action: 'message.propose',
    resource: { type: 'channel', id: 'demo-group-001' },
    outcome: 'success',
    decision: null,
    responsibleHumanId: 'user_demo_owner',
    runId: DEMO_RUN1,
    taskId: DEMO_TASK1,
  },
  {
    eventId: '01DEMOAUDIT00000000000002',
    occurredAt: '2026-11-11T01:01:00Z',
    actor: { type: 'human', id: 'user_demo_owner' },
    action: 'approval.approve',
    resource: { type: 'proposal', id: 'prop_demo_001' },
    outcome: 'success',
    decision: 'approve',
    responsibleHumanId: 'user_demo_owner',
    runId: DEMO_RUN1,
    taskId: DEMO_TASK1,
  },
  {
    eventId: '01DEMOAUDIT00000000000003',
    occurredAt: '2026-11-11T01:03:20Z',
    actor: { type: 'employee', id: DEMO_EMP1 },
    action: 'file.write',
    resource: { type: 'workspace', id: 'ws_demo_1' },
    outcome: 'denied',
    decision: 'policy_deny',
    responsibleHumanId: null,
    runId: DEMO_RUN1,
    taskId: DEMO_TASK1,
  },
  // Belongs to the FAILED run (DEMO_RUN2): must not leak into the default
  // audit view, which filters on the most recent run only.
  {
    eventId: '01DEMOAUDIT00000000000004',
    occurredAt: '2026-11-10T09:30:40Z',
    actor: { type: 'system', id: 'scheduler' },
    action: 'run.cancel',
    resource: { type: 'run', id: DEMO_RUN2 },
    outcome: 'failure',
    decision: null,
    responsibleHumanId: null,
    runId: DEMO_RUN2,
    taskId: null,
  },
];
