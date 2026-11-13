/**
 * S10b-4 read-only approvals adapter (AP4 list + AP3 detail).
 *
 * Field names mirror the approval_public contract shape verbatim; the client
 * never fabricates or guesses values. Types live in this sibling module so
 * agent.ts stays under its line budget. Errors reuse AuthError/UpstreamError
 * so the pages' auth/degrade branches match the rest of the console.
 */
import { stubKeysetPage } from './agentConsoleRead';
import { AuthError, UpstreamError } from './agent';

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'revise_requested'
  | 'expired'
  | 'cancelled'
  | 'consumed'
  | 'superseded';

/** AP4 status narrows to the two buckets this read-only page offers. */
export type ApprovalQueryFilter = 'pending' | 'expired';

export type ApprovalRisk = 'low' | 'medium' | 'high';

/** Reference object as serialized by the domain (e.g. requestedBy). */
export interface ApprovalRef {
  type: string;
  id: string;
}

export interface ApprovalBinding {
  subjectType: string;
  subjectId: string;
  changeKind: string;
  targetHash: string;
  effectiveFrom?: string | null;
}

/** AP2 verdict literals — mirrors the generated DecisionRequest enum. */
export type ApprovalDecisionVerdict = 'approve' | 'reject' | 'revise';

export interface ApprovalDecisionInput {
  verdict: ApprovalDecisionVerdict;
  comment?: string;
}

export interface ApprovalApprover {
  userId: string;
  role?: string | null;
}

export interface ApprovalDecision {
  userId: string;
  verdict: string;
  comment?: string | null;
  decidedAt: string;
}

/** approval_public as returned by AP3/AP4 (camelCase, contract-verbatim). */
export interface Approval {
  approvalId: string;
  tenantId: string;
  type: string;
  action: string;
  runId?: string | null;
  binding: ApprovalBinding;
  argsDigest?: string | null;
  resource?: unknown;
  status: ApprovalStatus;
  riskLevel: ApprovalRisk;
  requestedBy: ApprovalRef | null;
  onBehalfOf?: ApprovalRef | null;
  reasonText?: string | null;
  approvers: ApprovalApprover[];
  requiredApprovals: number;
  decisions: ApprovalDecision[];
  verdict?: string | null;
  decidedAt?: string | null;
  policyDecisionId?: string | null;
  expiresAt: string;
  remainingSeconds: number;
  ttlSeconds: number;
  consumedAt?: string | null;
  supersededBy?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface ApprovalList {
  items: Approval[];
  nextCursor?: string;
}

export interface ListApprovalsParams {
  /** Literal assignee key, e.g. `human:<user_id>` (domain matches verbatim). */
  assignee: string;
  status?: ApprovalQueryFilter;
  limit?: number;
  cursor?: string;
}

/**
 * Build-time write feature flag (S10b-6 p2). Off by default so the shipped
 * read-only console keeps a byte-identical DOM; the test build sets
 * VITE_AGENT_APPROVAL_WRITE=1. There is no runtime frontend toggle — the
 * server-side gate is the BFF's own CONSOLE_APPROVAL_WRITE_ENABLED flag.
 */
export function approvalWriteEnabled(): boolean {
  return import.meta.env.VITE_AGENT_APPROVAL_WRITE === '1';
}

export interface AgentApprovalsApi {
  listApprovals(params: ListApprovalsParams): Promise<ApprovalList>;
  /**
   * AP3 detail via `/api/approval?id=...`. A 404 `approval.not_found`
   * resolves to null: cross-tenant ids and unknown ids are
   * indistinguishable by design (fail closed, never reveal which).
   */
  getApproval(approvalId: string): Promise<Approval | null>;
  /**
   * AP2 decision submit (S10b-6). Optional: pages must hide every write
   * control when the injected api lacks this member (read-only stub layers,
   * older deployments). The HTTP adapter attaches no Authorization on the
   * POST — BFF authenticates the write through the same-origin session
   * cookie only; failures throw UpstreamError carrying the BFF error code as
   * the message so the UI can map copy (approval.unavailable,
   * console.read_only, approval.already_decided, ...).
   */
  decideApproval?(approvalId: string, decision: ApprovalDecisionInput): Promise<void>;
}

/**
 * Domain _effective_status: a pending/approved row past its expiry reads as
 * expired in every view. Pure display normalisation; the server never marks
 * the row itself until the sweep runs.
 */
export function effectiveApprovalStatus(
  row: Approval,
  now = Date.now(),
): ApprovalStatus {
  const ts = Date.parse(row.expiresAt);
  if (
    (row.status === 'pending' || row.status === 'approved') &&
    Number.isFinite(ts) &&
    ts <= now
  ) {
    return 'expired';
  }
  return row.status;
}

// ---------------------------------------------------------------------------
// Stub layer (tests only; the deployed build always uses the HTTP adapter).
// ---------------------------------------------------------------------------

export const DEMO_ASSIGNEE = 'human:demo-approver';
export const DEMO_APPROVAL_1 = '01DEMOAPPROVAL000000000001';
export const DEMO_APPROVAL_2 = '01DEMOAPPROVAL000000000002';
export const DEMO_APPROVAL_3 = '01DEMOAPPROVAL000000000003';
export const DEMO_APPROVAL_4 = '01DEMOAPPROVAL000000000004';

export interface ApprovalFixture {
  approval: Approval;
  /** Assignee keys that can see this approval via AP4. */
  assignees: string[];
}

const baseFixture = {
  tenantId: 'tenant_demo',
  type: 'business_action',
  argsDigest: 'ad_demo_digest',
  requiredApprovals: 1,
  decisions: [],
  verdict: null,
  decidedAt: null,
  consumedAt: null,
  supersededBy: null,
};

/** Deterministic, ASCII-only fixtures (never rendered in the browser build). */
export const DEMO_APPROVAL_FIXTURES: ApprovalFixture[] = [
  {
    assignees: [DEMO_ASSIGNEE],
    approval: {
      ...baseFixture,
      approvalId: DEMO_APPROVAL_1,
      action: 'employee.version.create',
      runId: null,
      binding: {
        subjectType: 'employee',
        subjectId: '01DEMOEMPLOYEE000000000001',
        changeKind: 'employee_version_create',
        targetHash: 'th_demo_0001',
        effectiveFrom: '2026-11-01T00:00:00.000Z',
      },
      status: 'pending',
      riskLevel: 'high',
      requestedBy: { type: 'user', id: 'u_demo_requester' },
      onBehalfOf: { type: 'human', id: 'user_demo_owner' },
      reasonText: 'Publish the new employee version',
      approvers: [{ userId: DEMO_ASSIGNEE, role: 'owner' }],
      policyDecisionId: 'pd_demo_0001',
      expiresAt: '2099-01-01T00:00:00.000Z',
      remainingSeconds: 86400,
      ttlSeconds: 86400,
      createdAt: '2026-10-31T10:00:00.000Z',
    },
  },
  {
    // Pending row past its expiry: must surface as expired, never fake pending.
    assignees: [DEMO_ASSIGNEE],
    approval: {
      ...baseFixture,
      approvalId: DEMO_APPROVAL_2,
      action: 'employee.version.create',
      runId: 'run_demo_0002',
      binding: {
        subjectType: 'employee',
        subjectId: '01DEMOEMPLOYEE000000000002',
        changeKind: 'employee_version_create',
        targetHash: 'th_demo_0002',
        effectiveFrom: null,
      },
      status: 'pending',
      riskLevel: 'medium',
      requestedBy: { type: 'user', id: 'u_demo_requester' },
      onBehalfOf: null,
      reasonText: 'Second draft publish request',
      approvers: [{ userId: DEMO_ASSIGNEE, role: 'owner' }],
      policyDecisionId: 'pd_demo_0002',
      expiresAt: '2020-01-01T00:00:00.000Z',
      remainingSeconds: 0,
      ttlSeconds: 3600,
      createdAt: '2019-12-31T23:00:00.000Z',
    },
  },
  {
    assignees: [DEMO_ASSIGNEE],
    approval: {
      ...baseFixture,
      approvalId: DEMO_APPROVAL_3,
      action: 'grant.escalation',
      runId: null,
      binding: {
        subjectType: 'grant',
        subjectId: 'grant_demo_0003',
        changeKind: 'grant_escalation',
        targetHash: 'th_demo_0003',
        effectiveFrom: null,
      },
      status: 'expired',
      riskLevel: 'low',
      requestedBy: { type: 'user', id: 'u_demo_requester' },
      onBehalfOf: null,
      reasonText: 'Escalated access that was never decided',
      approvers: [{ userId: DEMO_ASSIGNEE, role: 'peer' }],
      policyDecisionId: 'pd_demo_0003',
      expiresAt: '2020-06-01T00:00:00.000Z',
      remainingSeconds: 0,
      ttlSeconds: 3600,
      createdAt: '2020-05-31T23:00:00.000Z',
    },
  },
  {
    // Another assignee's queue: must never leak into this view.
    assignees: ['human:someone-else'],
    approval: {
      ...baseFixture,
      approvalId: DEMO_APPROVAL_4,
      action: 'employee.owner.transfer',
      runId: null,
      binding: {
        subjectType: 'employee',
        subjectId: '01DEMOEMPLOYEE000000000003',
        changeKind: 'employee_owner_transfer',
        targetHash: 'th_demo_0004',
        effectiveFrom: null,
      },
      status: 'pending',
      riskLevel: 'high',
      requestedBy: { type: 'user', id: 'u_demo_requester' },
      onBehalfOf: null,
      reasonText: 'Ownership handover for another reviewer',
      approvers: [{ userId: 'human:someone-else', role: 'owner' }],
      policyDecisionId: 'pd_demo_0004',
      expiresAt: '2099-01-01T00:00:00.000Z',
      remainingSeconds: 86400,
      ttlSeconds: 86400,
      createdAt: '2026-10-31T10:00:00.000Z',
    },
  },
];

export function createStubAgentApprovalsApi(
  fixtures: ApprovalFixture[] = DEMO_APPROVAL_FIXTURES,
): AgentApprovalsApi {
  const all = () => fixtures.map((f) => f.approval);
  return {
    async listApprovals(params) {
      let rows = fixtures.filter((f) => f.assignees.includes(params.assignee));
      // Mirror the domain default: AP4 answers pending unless filtered.
      const filter = params.status ?? 'pending';
      rows = rows.filter(
        (f) => effectiveApprovalStatus(f.approval) === filter,
      );
      return stubKeysetPage(
        rows.map((f) => f.approval),
        params.limit,
        params.cursor,
        100,
      );
    },
    async getApproval(approvalId) {
      const found = all().find((a) => a.approvalId === approvalId);
      return found ?? null;
    },
    async decideApproval(approvalId, decision) {
      const approval = all().find((a) => a.approvalId === approvalId);
      if (!approval) {
        throw new UpstreamError('approval.not_found');
      }
      const fixture = fixtures.find((f) => f.approval === approval);
      if (!fixture || !fixture.assignees.includes(DEMO_ASSIGNEE)) {
        throw new UpstreamError('approval.not_approver');
      }
      if (approval.decisions.some((d) => d.userId === DEMO_ASSIGNEE)) {
        throw new UpstreamError('approval.already_decided');
      }
      if (effectiveApprovalStatus(approval) !== 'pending') {
        throw new UpstreamError('approval.expired');
      }
      // Test-scaffolding semantics only (mirrors domain idempotency shape; the
      // domain stays authoritative in production). Mutating the live fixture is
      // intentional: getApproval returns the same reference, so a refetch after
      // a successful decideApproval shows the new ballot.
      approval.decisions.push({
        userId: DEMO_ASSIGNEE,
        verdict: decision.verdict,
        ...(decision.comment ? { comment: decision.comment } : {}),
        decidedAt: new Date().toISOString(),
      });
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP layer (BFF same-origin routes under /agent-api).
// ---------------------------------------------------------------------------

export interface HttpAgentApprovalsApiOptions {
  getToken?: () => string | null;
}

interface Envelope<T> {
  ok: boolean;
  status: number;
  data: T | null;
  code?: string;
}

/** Same fetch idiom as the console adapter; the BFF accepts the session cookie too. */
async function request<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  getToken: () => string | null,
): Promise<Envelope<T>> {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value));
  });
  const qs = search.toString();
  const url = `/agent-api${path}${qs ? `?${qs}` : ''}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch {
    throw new UpstreamError('console request failed (network)');
  }
  if (res.status === 401) throw new AuthError();
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const envelope = body as { code?: string } | null;
  return {
    ok: res.ok,
    status: res.status,
    data: res.ok ? (body as T) : null,
    code: envelope?.code ?? `agent.http.${res.status}`,
  };
}

/**
 * Same-origin write call against the BFF approval whitelist route. Unlike the
 * GET `request` above this NEVER attaches `Authorization` or any internal
 * token: the browser must not carry credentials material into the write path
 * (ADR-0010 boundary), and the BFF injects the approver identity from the
 * session cookie. `X-Console-Write: 1` is one of the CSRF triple gates.
 */
async function postWrite(
  path: string,
  params: Record<string, string>,
  body: unknown,
): Promise<Envelope<unknown>> {
  const qs = new URLSearchParams(params).toString();
  const url = `/agent-api${path}${qs ? `?${qs}` : ''}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Console-Write': '1',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new UpstreamError('console request failed (network)');
  }
  if (res.status === 401) {
    throw new AuthError();
  }
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  const record =
    parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  const code =
    typeof record?.code === 'string' ? record.code : `agent.http.${res.status}`;
  return { ok: res.ok, status: res.status, data: res.ok ? parsed : null, code };
}

export function createHttpAgentApprovalsApi(
  options: HttpAgentApprovalsApiOptions = {},
): AgentApprovalsApi {
  const getToken =
    options.getToken ??
    (() => {
      try {
        return localStorage.getItem('ws_token');
      } catch {
        return null;
      }
    });

  return {
    async listApprovals(params) {
      // AP4 requires an assignee; never issue an unfiltered query.
      if (!params.assignee) throw new UpstreamError('console.missing_filter');
      const res = await request<
        ApprovalList & { nextCursor?: string | null }
      >(
        '/api/approvals',
        {
          assignee: params.assignee,
          status: params.status,
          limit: params.limit,
          cursor: params.cursor,
        },
        getToken,
      );
      if (!res.ok || !res.data) {
        throw new UpstreamError(res.code ?? 'agent.http.unknown');
      }
      // E11 convention: last page omits the key; normalise an explicit null too.
      return {
        items: res.data.items ?? [],
        nextCursor: res.data.nextCursor ?? undefined,
      };
    },
    async getApproval(approvalId) {
      if (!approvalId) throw new UpstreamError('console.missing_filter');
      // AP3 real route: /agent-api/api/approval?id=... -> BFF -> domain
      // GET /v1/approvals/{id}. 404 approval.not_found maps to null so the
      // UI can show the fail-closed "not found or no access" copy.
      const res = await request<Approval>(
        '/api/approval',
        { id: approvalId },
        getToken,
      );
      if (res.ok && res.data) return res.data;
      if (res.code === 'approval.not_found') return null;
      throw new UpstreamError(res.code ?? 'agent.http.unknown');
    },
    async decideApproval(approvalId, decision) {
      if (!approvalId) {
        throw new UpstreamError('console.missing_filter');
      }
      // Body stays the exact {verdict, comment?} pair the BFF whitelist
      // accepts; a blank comment is omitted instead of sent as ''.
      const body: Record<string, string> = { verdict: decision.verdict };
      if (decision.comment) {
        body.comment = decision.comment;
      }
      const res = await postWrite('/api/approval/decision', { id: approvalId }, body);
      if (!res.ok) {
        throw new UpstreamError(res.code ?? 'agent.http.unknown');
      }
    },
  };
}
