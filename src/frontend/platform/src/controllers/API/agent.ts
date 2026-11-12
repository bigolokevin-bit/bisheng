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
 */

// ---------- Contract types (subset used by slice 1) ----------

export type LifecycleState = 'active' | 'paused' | 'suspended' | 'archived';

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
  resourceSelector: string;
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

// ---------- Narrow interface ----------

export interface AgentConsoleApi {
  listEmployees(params: ListEmployeesParams): Promise<EmployeeList>;
  getEmployee(employeeId: string): Promise<ApiResult<EmployeeDetail>>;
  getEffectiveConfig(employeeId: string): Promise<ApiResult<EffectiveConfig>>;
  getWorkstations(employeeId: string): Promise<ApiResult<WorkstationList>>;
  /** AP4: assignee=human:<current user> + status=pending; slice 1 returns the count only. */
  countPendingApprovals(assignee: string): Promise<ApiResult<{ count: number }>>;
}

// ---------- Stub / fixture adapter (tests & preview only; no network, no tokens) ----------

export interface AgentConsoleFixtures {
  employees: EmployeeSummary[];
  details?: Record<string, EmployeeDetail>;
  configs?: Record<string, EffectiveConfig>;
  workstations?: Record<string, Workstation[]>;
  pendingApprovalCounts?: Record<string, number>;
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
  };
})();
