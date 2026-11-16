/**
 * P0-15 W2 data layer for the parity console (SPEC §4 / employees-list card).
 *
 * Everything goes through the same-origin BFF (/agent-api) — the browser never
 * talks to 8000/8001 directly, and no fixture ships in the production bundle.
 * Cross-employee aggregates come only from service endpoints (E14/R6/AP8/P9);
 * this module never sums paginated rows to fake a total. Missing values render
 * as '—' (never 0.00, never a fake curve, never an internal placeholder).
 */
import type { Approval, ApprovalBinding } from '@/controllers/API/agentConsoleApprovals';

export interface ApiRes<T> {
  ok: boolean;
  status: number;
  data: T | null;
  code?: string;
  message?: string;
  requestId?: string;
}

export type Fetcher = <T>(
  path: string,
  params?: Record<string, string | number | undefined>
) => Promise<ApiRes<T>>;

// ---------- shapes (field names verified live 2026-11-15, w1-shape-verify2) ----------

// Batch enrichment from E11 `?expand=` (dimensions: version, workstations,
// knowledge, pending). The domain omits a key when the source row is missing —
// never fabricate zero values here.
export interface EmployeeEnrichment {
  currentVersionNo?: number;
  effectiveFrom?: string;
  effectiveBudget?: VersionBudget;
  knowledgeCount?: number;
  workstationCount?: number;
  pendingApprovalCount?: number;
}

export interface EmployeeRow {
  employeeId: string;
  name: string;
  title?: string;
  lifecycleState: string;
  ownerUserId?: string;
  updatedAt?: string;
  enrichment?: EmployeeEnrichment;
}

export interface EmployeeListBody {
  items: EmployeeRow[];
  nextCursor?: string;
}

export interface EmployeeStats {
  total: number;
  byLifecycle: Record<string, number>;
}

export const LIFECYCLE_ORDER = ['active', 'onboarding', 'paused', 'offboarding', 'draft', 'archived'] as const;

export interface RunBucket {
  bucketStart: string;
  runs: number;
  succeeded: number;
  failed: number;
  costUsd?: number | null;
  upstreamRuns?: number;
  estimatedRuns?: number;
  unknownRuns?: number;
  // fix B (G4): deep 01-overview OV-22 — the service omits this key when the
  // bucket sample is <20; absence is a break in the P95 line, never a 0.
  p95DurationMs?: number | null;
}

export interface RunStatsBody {
  from?: string;
  to?: string;
  bucket?: string;
  buckets: RunBucket[];
}

export interface ActivityCell {
  dow: number; // 1=Mon … 7=Sun
  hour: number; // 0-23
  count: number;
}

export interface ActivityBody {
  from?: string;
  to?: string;
  tz?: string;
  max?: number;
  cells: ActivityCell[];
}

export interface ApprovalStats {
  pending: number;
  dueSoon: number;
}

export interface BudgetItem {
  employeeId: string;
  period: string;
  periodKind: string;
  tokensUsed?: number;
  costUsd?: number | null;
  reserved?: number | null;
  updatedAt?: string;
}

export interface BudgetBody {
  items: BudgetItem[];
  missingEmployeeIds?: string[];
}

export interface VersionBudget {
  dailyTokens?: number;
  monthlyCostUsd?: number;
  perRunMaxUsd?: number;
}

export interface EmployeeVersion {
  id: string;
  employeeId: string;
  versionNo: number;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  changeNote?: string | null;
  knowledgeScopes?: string[];
  grantIds?: string[];
  budget?: VersionBudget | null;
}

export interface VersionListBody {
  items: EmployeeVersion[];
}

export interface WorkstationRow {
  id: string;
  bindingType: string;
  channel?: string;
  status?: string;
  capabilities?: string[];
}

export interface WorkstationListBody {
  items: WorkstationRow[];
}

// EMP-03 (E2): /api/employee answers a FLAT record (verified against the live
// BFF 2026-11-16), no `data` envelope. Unknown or cross-tenant ids return the
// SAME 404 body (employee.not_found) so existence is never disclosed; the
// machine code must never reach the screen (G15 rule).
export interface EmployeeDetailBody {
  id: string;
  tenantId?: string;
  name?: string;
  title?: string;
  lifecycleState?: string;
  currentVersionId?: string;
  ownerUserId?: string;
  createdAt?: string;
  updatedAt?: string;
  revision?: number;
}

// EMP-03 (E5): /api/effective-config?id=&at= resolved permission snapshot
// (verified live: grants is an array of scope objects, not ids).
export interface EffectiveGrant {
  id: string;
  employeeId?: string;
  scopeType?: string;
  resourceSelector?: { types?: string[]; [key: string]: unknown };
  actions?: string[];
  source?: string;
  expiresAt?: string | null;
}

export interface EffectiveConfigBody {
  employee?: EmployeeDetailBody;
  version?: EmployeeVersion;
  grants?: EffectiveGrant[];
  resolvedAt?: string;
  snapshotRef?: string;
}

// ---------- fetcher factory ----------

export function makeFetcher(base = '/agent-api', getToken?: () => string | null): Fetcher {
  const readToken =
    getToken ??
    (() => {
      try {
        return localStorage.getItem('ws_token');
      } catch {
        return null;
      }
    });
  return async <T>(
    path: string,
    params: Record<string, string | number | undefined> = {}
  ): Promise<ApiRes<T>> => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') search.set(k, String(v));
    });
    const qs = search.toString();
    const url = `${base}${path}${qs ? `?${qs}` : ''}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = readToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await fetch(url, { headers });
    } catch {
      return { ok: false, status: 0, data: null, code: 'console.network' };
    }
    const requestId = res.headers.get('X-Console-Request-Id') ?? undefined;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
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
    return { ok: true, status: res.status, data: body as T, requestId };
  };
}

// ---------- endpoint helpers (all read-only BFF routes) ----------

export function fetchEmployeesPage(
  fetch: Fetcher,
  args: {
    keyword?: string;
    lifecycleState?: string;
    limit?: number;
    cursor?: string;
    // Server-supported batch dimensions only: version,workstations,knowledge,pending.
    expand?: string;
  }
): Promise<ApiRes<EmployeeListBody>> {
  return fetch<EmployeeListBody>('/api/employees', {
    keyword: args.keyword,
    lifecycleState: args.lifecycleState,
    limit: args.limit ?? 20,
    cursor: args.cursor,
    expand: args.expand,
  });
}

export function fetchEmployeeStats(fetch: Fetcher): Promise<ApiRes<EmployeeStats>> {
  return fetch<EmployeeStats>('/api/employee-stats');
}

export function fetchRunStats(
  fetch: Fetcher,
  args: { from: string; to: string; bucket?: string; employeeId?: string }
): Promise<ApiRes<RunStatsBody>> {
  return fetch<RunStatsBody>('/api/run-stats', {
    from: args.from,
    to: args.to,
    bucket: args.bucket ?? 'day',
    employeeId: args.employeeId,
  });
}

export function fetchApprovalStats(fetch: Fetcher, assignee: string): Promise<ApiRes<ApprovalStats>> {
  return fetch<ApprovalStats>('/api/approval-stats', { assignee });
}

export function fetchActivity(
  fetch: Fetcher,
  args: { weeks?: number; tz?: string; employeeId?: string } = {}
): Promise<ApiRes<ActivityBody>> {
  return fetch<ActivityBody>('/api/run-activity', {
    weeks: args.weeks ?? 1,
    tz: args.tz ?? 'Asia/Shanghai',
    employeeId: args.employeeId,
  });
}

export function fetchBudgetMonth(
  fetch: Fetcher,
  employeeIds: string[],
  period: string
): Promise<ApiRes<BudgetBody>> {
  return fetch<BudgetBody>('/api/budget-usage', {
    employeeId: employeeIds.join(','),
    period,
    periodKind: 'month',
  });
}

export function fetchLatestVersion(fetch: Fetcher, employeeId: string): Promise<ApiRes<EmployeeVersion>> {
  return fetch<VersionListBody>('/api/employee-versions', { id: employeeId, limit: 1 }).then((res) => {
    if (!res.ok) return { ...res, data: null };
    const first = res.data?.items?.[0];
    return { ...res, data: first ?? null };
  });
}

export function fetchWorkstations(fetch: Fetcher, employeeId: string): Promise<ApiRes<WorkstationListBody>> {
  return fetch<WorkstationListBody>('/api/workstations', { id: employeeId, limit: 100 });
}

// EMP-03 fetchers — request shapes verified against the live BFF 2026-11-16.
export function fetchEmployeeDetail(
  fetch: Fetcher,
  employeeId: string
): Promise<ApiRes<EmployeeDetailBody>> {
  return fetch<EmployeeDetailBody>('/api/employee', { id: employeeId });
}

export function fetchEffectiveConfig(
  fetch: Fetcher,
  employeeId: string,
  at: string
): Promise<ApiRes<EffectiveConfigBody>> {
  return fetch<EffectiveConfigBody>('/api/effective-config', { id: employeeId, at });
}

export function fetchEmployeeVersions(
  fetch: Fetcher,
  employeeId: string,
  limit = 20
): Promise<ApiRes<VersionListBody>> {
  return fetch<VersionListBody>('/api/employee-versions', { id: employeeId, limit });
}

// TSK-01 (T5): GET /api/tasks?assignee=&status=&dueBefore=&cursor=&limit=.
// Server-side filters ONLY: assignee/status/dueBefore. There is no source
// query upstream — the page keeps 来源 as a client facet over the returned
// page and must never smuggle it into this request (ACCEPTANCE §2).
export function fetchTasksPage(
  fetch: Fetcher,
  args: {
    assignee?: string;
    status?: string;
    dueBefore?: string;
    limit?: number;
    cursor?: string;
  }
): Promise<ApiRes<TaskListBody>> {
  return fetch<TaskListBody>('/api/tasks', {
    assignee: args.assignee,
    status: args.status,
    dueBefore: args.dueBefore,
    limit: args.limit ?? 20,
    cursor: args.cursor,
  });
}

// TSK-01 (T5): read-only task list. Field vocabulary follows CONTRACT
// TASK.md v1.0 with the BFF camelCase mapping (ACCEPTANCE tasks-list §2):
// progressNote is ALWAYS present and may be null; source carries
// {channel,messageId,runId?}; dueAt absent → null. The BFF gate requires at
// least one of assignee/status — the page never issues an unfiltered query.
export interface TaskAssigneeRef {
  type?: string;
  id?: string;
}

export interface TaskSourceRef {
  channel?: string;
  messageId?: string;
  conversationRef?: string | null;
  runId?: string | null;
}

export interface TaskRow {
  taskId: string;
  title: string;
  description?: string | null;
  status: string;
  assignee?: TaskAssigneeRef | null;
  priority?: string | null;
  dueAt?: string | null;
  source?: TaskSourceRef | null;
  progressNote?: string | null;
  employeeVersionRef?: string | null;
  relatedTaskIds?: string[] | null;
  createdAt?: string;
  updatedAt?: string;
  statusReason?: string | null;
  closedAt?: string | null;
}

export interface TaskListBody {
  items: TaskRow[];
  nextCursor?: string;
}

// ---------- utilities ----------

/** Run fn over items with at most `cap` in flight; preserves input order. */
export async function mapLimit<T, R>(items: T[], cap: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next;
      next += 1;
      out[idx] = await fn(items[idx]);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(cap, items.length)) }, () => worker());
  await Promise.all(workers);
  return out;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** UTC day window of the last `days` days, ending now. */
export function dayWindow(days: number, now = new Date()): { from: string; to: string } {
  const to = now.toISOString();
  const start = new Date(now.getTime() - days * 86400000);
  start.setUTCHours(0, 0, 0, 0);
  return { from: start.toISOString(), to };
}

export function monthPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`;
}

export function isoDay(date: string, tzOffsetMin = 480): string {
  const d = new Date(new Date(date).getTime() + tzOffsetMin * 60000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Money: missing/NaN never renders as 0.00 — the card forbids fake zeroes. */
export function fmtUsd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `USD ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtRatio(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

/** Asia/Shanghai 'MM-DD HH:mm' (cross-year adds the year, per SPEC §2.2). */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(new Date(iso).getTime() + 480 * 60000);
  if (Number.isNaN(d.getTime())) return '—';
  const base = `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return d.getUTCFullYear() === new Date().getUTCFullYear() ? base : `${d.getUTCFullYear()}-${base}`;
}

/** IDs: monospace, truncated 6…last4, copyable elsewhere. */
export function fmtId(id: string | null | undefined): string {
  if (!id) return '—';
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export function bucketSum(buckets: RunBucket[] | null | undefined): { runs: number; succeeded: number; failed: number; cost: number | null } {
  if (!buckets || buckets.length === 0) return { runs: 0, succeeded: 0, failed: 0, cost: null };
  let runs = 0;
  let succeeded = 0;
  let failed = 0;
  let cost: number | null = null;
  buckets.forEach((b) => {
    runs += b.runs ?? 0;
    succeeded += b.succeeded ?? 0;
    failed += b.failed ?? 0;
    if (typeof b.costUsd === 'number' && Number.isFinite(b.costUsd)) cost = (cost ?? 0) + b.costUsd;
  });
  return { runs, succeeded, failed, cost };
}

export interface StationSummary {
  groups: number;
  dms: number;
  crons: number;
  total: number;
}

export function summarizeStations(items: WorkstationRow[] | null | undefined): StationSummary {
  const rows = items ?? [];
  let groups = 0;
  let dms = 0;
  let crons = 0;
  rows.forEach((w) => {
    const caps = w.capabilities ?? [];
    const isCron = w.bindingType === 'cron' || caps.includes('cron') || caps.includes('schedule');
    if (isCron) crons += 1;
    if (w.bindingType === 'group') groups += 1;
    if (w.bindingType === 'dm') dms += 1;
  });
  return { groups, dms, crons, total: rows.length };
}

// ---------------------------------------------------------------------------
// APR-02 (AP3): GET /api/approval?id= detail. The flat approval_public shape is
// the frozen Approval contract (controllers/API/agentConsoleApprovals); CR-043
// adds an OPTIONAL `detail` projection and message_send bindings carry extra
// runId/messageDigest keys. Everything here is present-only: a missing key is
// never fabricated, and `detail` absent means "unavailable", never zero.
// ---------------------------------------------------------------------------

/** One added grant inside changeDetail.addedGrants (canonical resource shape). */
export interface ApprovalAddedGrant {
  id?: string;
  employeeId?: string;
  scopeType?: string;
  resourceSelector?: { types?: string[]; [key: string]: unknown };
  actions?: string[];
  expiresAt?: string | null;
  source?: string;
}

/** CR-043 canonical six-key camel projection + derivation source label. */
export interface ApprovalChangeDetail {
  employeeId: string;
  fromVersionId: string;
  toVersionNo: number;
  addedGrants: ApprovalAddedGrant[];
  removedGrantIds: string[];
  effectiveFrom: string;
  source: string;
}

/** detail.versions row — NOTE: the projection carries NO version id key. */
export interface ApprovalDetailVersion {
  versionNo: number;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  status?: string;
  budget?: unknown;
  knowledgeCount?: number;
}

export interface ApprovalDetailEmployee {
  employeeId: string;
  name?: string | null;
  title?: string | null;
  lifecycleState?: string | null;
  ownerUserId?: string | null;
  currentVersionId?: string | null;
}

export interface ApprovalDetailProjection {
  changeDetail: ApprovalChangeDetail;
  versions?: ApprovalDetailVersion[];
  employee?: ApprovalDetailEmployee;
}

/** message_send bindings add runId/messageDigest (present-only, D-1). */
export interface ApprovalBindingFull extends ApprovalBinding {
  runId?: string | null;
  messageDigest?: string | null;
}

export interface ApprovalDetailBody extends Approval {
  binding: ApprovalBindingFull;
  detail?: ApprovalDetailProjection;
}

export function fetchApprovalDetail(
  fetch: Fetcher,
  approvalId: string
): Promise<ApiRes<ApprovalDetailBody>> {
  return fetch<ApprovalDetailBody>('/api/approval', { id: approvalId });
}

/** Sparkline points from day buckets (last N); returns null when no data —
 *  callers must then show an honest empty note, never a flat fake curve. */
export function sparkPoints(buckets: RunBucket[] | null | undefined, days: number): number[] | null {
  if (!buckets || buckets.length === 0) return null;
  const byDay = new Map<string, number>();
  buckets.forEach((b) => byDay.set(isoDay(b.bucketStart), b.runs ?? 0));
  const pts: number[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * 86400000);
    pts.push(byDay.get(isoDay(d.toISOString())) ?? 0);
  }
  return pts.some((p) => p > 0) ? pts : null;
}
