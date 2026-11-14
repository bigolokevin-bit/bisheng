/* eslint-disable no-restricted-syntax -- fixtures are verbatim runtime.hermes.* captures and assertions the real zh-Hans copy under test */
/**
 * P0-14 (l4-hermes-panels): 「运行指标」 section (运行健康 / 模型与工具用量 /
 * 活动热力) rendered through the real page shell with the real zh-Hans
 * resources.
 *
 * Fixtures are copied VERBATIM from the runtime-shape source of truth,
 * /Users/kevin_studio/Projects/seakoi-agent-os-hermes-panels/apps/console/
 * stub_upstream.py `_hermes_runtime_reply` (hermes_metrics trim outputs,
 * design.md §1.1): snake_case keys, per-source `sources.<name>` state, no
 * top-level degraded boolean, degraded legs = nulls (never 0),
 * `cost_usd:null + cost_status:"unknown"`, unattributed {sessions, tokens,
 * note}. Assertions cover the honest-display rules of
 * openspec/changes/l4-hermes-panels-product/design.md §2/§3: 降级（reason）,
 * 暂不可用, 未计价 (never "0.00"), 未归属, 降级替代来源 chip, 「—」 for nulls,
 * no fake heat matrix, per-block error isolation and request params.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@/components/bs-ui/message', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('react-i18next', async () => {
  const mod = (await import('../../../../public/locales/zh-Hans/bs.json')) as {
    default: Record<string, unknown>;
  };
  const dict = mod.default;
  // Dotted-key resolution against the REAL zh-Hans copy (runs/trends idiom),
  // extended with i18next-style {{var}} interpolation so 降级（{{reason}}）
  // and 降级替代来源：{{source}} assert against the actual runtime strings.
  const t = (key: unknown, arg?: unknown): string => {
    const value = String(key)
      .split('.')
      .reduce<unknown>(
        (acc, part) =>
          acc && typeof acc === 'object'
            ? (acc as Record<string, unknown>)[part]
            : undefined,
        dict,
      );
    let out = typeof value === 'string' ? value : typeof arg === 'string' ? arg : String(key);
    if (arg && typeof arg === 'object') {
      for (const [name, replacement] of Object.entries(arg as Record<string, unknown>)) {
        out = out.split(`{{${name}}}`).join(String(replacement));
      }
    }
    return out;
  };
  return { useTranslation: () => ({ t }) };
});

import { AgentConsoleV2Page } from '../AgentConsoleV2Page';
import { userContext } from '@/contexts/userContext';
import type {
  AgentConsoleHermesApi,
  HermesSummary,
  HermesUsage,
} from '@/controllers/API/agentConsoleHermes';
import type {
  AgentConsoleTrendsApi,
  RunActivityResponse,
} from '@/controllers/API/agentConsoleTrends';

// ---------------------------------------------------------------- fixtures
// stub_upstream.py `_HERMES_GATEWAY` / `_hermes_summary("ok")` — verbatim.
const GATEWAY_NOTE = 'metrics_today 为进程启动后当日计数，重启归零；不回填历史';
const SUMMARY_OK: HermesSummary = {
  schema: 'runtime.hermes.summary.v1',
  sources: {
    gateway_health: { state: 'ok' },
    dashboard_system: { state: 'ok' },
    dashboard_sessions_stats: { state: 'ok' },
  },
  gateway: {
    status: 'ok',
    platform: 'hermes-agent',
    version: 'unknown',
    gateway_state: 'running',
    active_agents: 0,
    gateway_busy: false,
    gateway_drainable: true,
    updated_at: '2026-11-14T00:00:00+00:00',
    platforms: {
      api_server: { state: 'connected', needs_attention: false },
      feishu: { state: 'connected', needs_attention: false },
    },
    metrics_today: {
      day: '2026-11-14',
      requests: 3,
      messages: 4,
      tokens: 5,
      latency_p95_ms: 6,
    },
    note: GATEWAY_NOTE,
  },
  system: {
    hermes_version: '0.16.0',
    cpu_count: 10,
    cpu_percent: 12.5,
    load_avg: [1.0, 2.0, 3.0],
    uptime_seconds: 42,
    memory: { total: 10, available: 5, used: 4, percent: 55.0 },
    disk: { total: 1, used: 2, free: 3, percent: 40.0 },
    process: { rss: 123, num_threads: 7 },
    psutil: true,
  },
  sessions_stats: {
    total: 7,
    active_store: 5,
    archived: 2,
    messages: 100,
    by_source: { api_server: 4, feishu: 3 },
  },
};

// stub_upstream.py `_hermes_summary("degraded")` — verbatim: gateway leg
// stays ok, the two dashboard legs degrade to reason "unreachable" with the
// `_HERMES_SYSTEM_NULL` / `_HERMES_SESSIONS_NULL` all-null blocks.
const SYSTEM_NULL = {
  hermes_version: null,
  cpu_count: null,
  cpu_percent: null,
  load_avg: null,
  uptime_seconds: null,
  memory: { total: null, available: null, used: null, percent: null },
  disk: { total: null, used: null, free: null, percent: null },
  process: { rss: null, num_threads: null },
  psutil: null,
};
const SUMMARY_DEGRADED: HermesSummary = {
  ...SUMMARY_OK,
  sources: {
    gateway_health: { state: 'ok' },
    dashboard_system: { state: 'degraded', reason: 'unreachable' },
    dashboard_sessions_stats: { state: 'degraded', reason: 'unreachable' },
  },
  system: SYSTEM_NULL,
  sessions_stats: {
    total: null,
    active_store: null,
    archived: null,
    messages: null,
    by_source: {},
  },
};

// Runtime null-when-degraded pattern (design §1.1: 降级时对应数值一律 null，
// 绝不 0) with the gateway leg's documented reason from the reason enum.
const GATEWAY_NULL = {
  status: null,
  platform: null,
  version: null,
  gateway_state: null,
  active_agents: null,
  gateway_busy: null,
  gateway_drainable: null,
  updated_at: null,
  platforms: {},
  metrics_today: {
    day: null,
    requests: null,
    messages: null,
    tokens: null,
    latency_p95_ms: null,
  },
  note: GATEWAY_NOTE,
};
const SUMMARY_GATEWAY_DEGRADED: HermesSummary = {
  ...SUMMARY_OK,
  sources: {
    gateway_health: { state: 'degraded', reason: 'gateway_key_unconfigured' },
    dashboard_system: { state: 'ok' },
    dashboard_sessions_stats: { state: 'ok' },
  },
  gateway: GATEWAY_NULL,
};

// Same null pattern while the source itself reports ok (missing trimmed
// fields): values must still render 「—」, never 0.
const SUMMARY_GATEWAY_NULLS: HermesSummary = {
  ...SUMMARY_OK,
  gateway: GATEWAY_NULL,
};

// stub_upstream.py `_hermes_usage(7, "ok")` — verbatim.
const ATTR_NOTE = 'Hermes 会话无 tenant/employee，未经 agent_run 映射统一归未归属，绝不猜';
const USAGE_OK: HermesUsage = {
  schema: 'runtime.hermes.usage.v1',
  period_days: 7,
  sources: {
    dashboard_usage: { state: 'ok' },
    gateway_sessions: { state: 'ok' },
    cost_ledger: { state: 'ok', source: 'cost_ledger' },
  },
  tokens: { total_input: 1000, total_output: 200, total_cache_read: 50, total_reasoning: 30 },
  by_model: [{ model: 'qwen-plus', input_tokens: 1000, output_tokens: 200 }],
  cost: {
    source: 'cost_ledger',
    cost_usd: 0.5,
    cost_status: 'upstream',
    rows: 1,
    per_employee: [
      {
        employee_id: '01EMP00000000000000000DEMO',
        cost_usd: 0.5,
        cost_status: 'upstream',
        rows: 1,
      },
    ],
  },
  attribution: {
    state: 'ok',
    note: ATTR_NOTE,
    mapped_sessions: 1,
    unattributed: {
      sessions: 1,
      tokens: { total_input: 7, total_output: 3, total_cache_read: 1, total_reasoning: 2 },
      note: ATTR_NOTE,
    },
  },
};

// stub_upstream.py `_hermes_usage(days, "degraded")` — dashboard leg timeout:
// tokens null / by_model null, while the cost leg stays independent with
// cost_usd null + cost_status unknown（绝不 0.00）.
const USAGE_DEGRADED: HermesUsage = {
  schema: 'runtime.hermes.usage.v1',
  period_days: 7,
  sources: {
    dashboard_usage: { state: 'degraded', reason: 'timeout' },
    gateway_sessions: { state: 'ok' },
    cost_ledger: { state: 'ok', source: 'cost_ledger' },
  },
  tokens: { total_input: null, total_output: null, total_cache_read: null, total_reasoning: null },
  by_model: null,
  cost: {
    source: 'cost_ledger',
    cost_usd: null,
    cost_status: 'unknown',
    rows: 0,
    per_employee: [],
  },
  attribution: USAGE_OK.attribution,
};

// SQLite read-only degradation marks its source (fallback_source token
// string only — never money, never silent).
const USAGE_FALLBACK: HermesUsage = {
  ...USAGE_OK,
  sources: {
    ...USAGE_OK.sources,
    dashboard_usage: {
      state: 'degraded',
      reason: 'timeout',
      fallback_source: 'sqlite-ro-fallback',
    },
  },
};

// Estimated ledger money + per-employee rows listed as returned.
const USAGE_COST_EST: HermesUsage = {
  ...USAGE_OK,
  cost: {
    source: 'cost_ledger',
    cost_usd: 0.42,
    cost_status: 'estimated',
    rows: 3,
    per_employee: [
      {
        employee_id: '01EMP00000000000000000DEMO',
        cost_usd: 0.42,
        cost_status: 'estimated',
        rows: 3,
      },
      {
        employee_id: '01EMP00000000000000001DEMO',
        cost_usd: 0.072,
        cost_status: 'upstream',
        rows: 1,
      },
    ],
  },
};

// Attribution leg degraded: chip + 「归属暂不可用」, values null (no 0-fill).
const USAGE_ATTR_DEGRADED: HermesUsage = {
  ...USAGE_OK,
  attribution: {
    state: 'degraded',
    reason: 'unreachable',
    mapped_sessions: null,
    unattributed: { sessions: null },
  },
};

// ---------------------------------------------------------------- helpers

const EMP = {
  employeeId: 'emp_1',
  tenantId: 't',
  name: 'Koi Claw',
  title: 'assistant',
  lifecycleState: 'active',
  currentVersionId: 'ver_1',
  ownerUserId: 'opsadmin',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-11-13T00:00:00Z',
};

const consoleApi = {
  listEmployees: vi.fn().mockResolvedValue({ items: [EMP] }),
  countPendingApprovals: vi.fn().mockResolvedValue({ ok: true, data: { count: 0 } }),
  getEmployee: vi.fn().mockResolvedValue({ ok: true, data: EMP }),
  getEffectiveConfig: vi.fn().mockResolvedValue({ ok: true, data: { employee: EMP, grants: [] } }),
  getWorkstations: vi.fn().mockResolvedValue({ ok: true, data: { items: [] } }),
} as never;

const approvalsApi = {
  listApprovals: vi.fn().mockResolvedValue({ ok: true, data: { items: [] } }),
} as never;

const ok = <T,>(data: T) => ({ ok: true as const, status: 200, data });
type Failure = { ok: false; status: number; data: null; code?: string };
const fail = (status: number, code: string): Failure => ({ ok: false, status, data: null, code });
const isFail = (x: unknown): x is Failure =>
  typeof x === 'object' && x !== null && (x as { ok?: unknown }).ok === false;

function makeHermesApi(
  over: {
    summary?: HermesSummary | Failure;
    usage?: HermesUsage | Failure | ((days: number) => HermesUsage);
  } = {},
) {
  const getSummary = vi
    .fn()
    .mockResolvedValue(isFail(over.summary) ? over.summary : ok(over.summary ?? SUMMARY_OK));
  const getUsage = vi.fn().mockImplementation((days: number) => {
    if (isFail(over.usage)) return Promise.resolve(over.usage);
    if (typeof over.usage === 'function') return Promise.resolve(ok(over.usage(days)));
    return Promise.resolve(ok(over.usage ?? { ...USAGE_OK, period_days: days }));
  });
  return {
    api: { getSummary, getUsage } as unknown as AgentConsoleHermesApi,
    getSummary,
    getUsage,
  };
}

function makeTrendsApi(over: { activity?: RunActivityResponse | Failure } = {}) {
  const getRunActivity = vi
    .fn()
    .mockResolvedValue(
      isFail(over.activity) ? over.activity : ok(over.activity ?? { cells: [], max: 0 }),
    );
  const api = {
    getRunStats: vi.fn().mockResolvedValue(ok({ buckets: [] })),
    getRunActivity,
    getBudgetUsage: vi.fn().mockResolvedValue(ok({ items: [] })),
  } as unknown as AgentConsoleTrendsApi;
  return { api, getRunActivity };
}

afterEach(() => {
  cleanup();
});

/** Rail entry: the surface must be reachable from the shell (navMetrics
 *  resolves to the real Chinese label 「运行指标」 through the bs.json mock). */
async function openMetrics(hermesApi: AgentConsoleHermesApi, trendsApi?: AgentConsoleTrendsApi) {
  render(
    <userContext.Provider
      value={{ user: { user_id: 1, web_menu: ['admin', 'agent'] }, setUser: vi.fn(), savedComponents: [], addSavedComponent: vi.fn(), checkComponentsName: vi.fn(), delComponent: vi.fn() } as never}
    >
      <AgentConsoleV2Page
        consoleApi={consoleApi}
        approvalsApi={approvalsApi}
        trendsApi={trendsApi ?? makeTrendsApi().api}
        hermesApi={hermesApi}
      />
    </userContext.Provider>,
  );
  await screen.findByText('Koi Claw');
  fireEvent.click(screen.getByLabelText('运行指标'));
  const section = await screen.findByTestId('agent-v2-metrics');
  await waitFor(() => expect(section.textContent).not.toContain('加载中…'));
  return {
    section,
    health: within(section).getByTestId('agent-v2-metrics-health'),
    usage: within(section).getByTestId('agent-v2-metrics-usage'),
    heat: within(section).getByTestId('agent-v2-metrics-heat'),
  };
}

// ---------------------------------------------------------------- tests

describe('console v2 hermes metrics section (P0-14 l4-hermes-panels)', () => {
  // ---- A. health block ----

  it('rail 运行指标 entry renders healthy sources as 正常 chips with the captured gateway fields', async () => {
    const { api, getSummary, getUsage } = makeHermesApi();
    const { section, health } = await openMetrics(api);
    // rail wiring: the section header is the navMetrics copy
    expect(within(section).getByRole('heading', { level: 2 }).textContent).toBe('运行指标');
    // three independent ok chips (real zh-Hans copy)
    const chips = within(health).getAllByTestId('agent-v2-metrics-chip-ok');
    expect(chips).toHaveLength(3);
    for (const chip of chips) expect(chip.textContent).toBe('正常');
    // values verbatim, nulls never involved here
    expect(within(health).getByTestId('agent-v2-metrics-gw-status').textContent).toBe('ok');
    const today = within(health).getByTestId('agent-v2-metrics-today');
    expect(within(today).getByText('2026-11-14')).toBeTruthy();
    expect(within(today).getByText('3')).toBeTruthy();
    // platforms table listed as returned (needs_attention false → 否)
    const platforms = within(health).getByTestId('agent-v2-metrics-platforms');
    expect(within(platforms).getByText('api_server')).toBeTruthy();
    expect(within(platforms).getByText('feishu')).toBeTruthy();
    expect(within(platforms).getAllByRole('row')).toHaveLength(3);
    // gateway.note rendered verbatim, unedited
    expect(within(health).getByTestId('agent-v2-metrics-gw-note').textContent).toBe(GATEWAY_NOTE);
    // one summary fetch; usage defaults to the 7-day window
    expect(getSummary).toHaveBeenCalledTimes(1);
    expect(getUsage).toHaveBeenCalledWith(7);
  });

  it('a degraded dashboard source shows 降级（reason） plus 暂不可用 and never numeric values', async () => {
    const { api } = makeHermesApi({ summary: SUMMARY_DEGRADED });
    const { health } = await openMetrics(api);
    const degraded = within(health).getAllByTestId('agent-v2-metrics-chip-degraded');
    expect(degraded).toHaveLength(2);
    for (const chip of degraded) expect(chip.textContent).toBe('降级（unreachable）');
    // value area replaced by 暂不可用 — no fields, so no digits at all
    expect(within(health).getByTestId('agent-v2-metrics-system-unavailable').textContent).toBe('暂不可用');
    expect(within(health).getByTestId('agent-v2-metrics-sessions-unavailable').textContent).toBe('暂不可用');
    const sys = within(health).getByTestId('agent-v2-metrics-src-system');
    expect(sys.textContent).not.toMatch(/\d/);
    const ses = within(health).getByTestId('agent-v2-metrics-src-sessions');
    expect(ses.textContent).not.toMatch(/\d/);
    // the gateway leg is independent and still ok
    expect(within(health).getAllByTestId('agent-v2-metrics-chip-ok')).toHaveLength(1);
  });

  it('null gateway fields under an ok source render 「—」 and never 0, with the platforms empty state', async () => {
    const { api } = makeHermesApi({ summary: SUMMARY_GATEWAY_NULLS });
    const { health } = await openMetrics(api);
    expect(within(health).getAllByTestId('agent-v2-metrics-chip-ok')).toHaveLength(3);
    expect(within(health).getByTestId('agent-v2-metrics-gw-status').textContent).toBe('—');
    const today = within(health).getByTestId('agent-v2-metrics-today');
    // five metrics_today values, all null → five 「—」, no fabricated number
    expect(within(today).getAllByText('—')).toHaveLength(5);
    expect(today.textContent).not.toContain('0');
    expect(within(health).getByTestId('agent-v2-metrics-platforms-empty').textContent).toBe('暂无平台连接');
  });

  it('a 503 runtime.metrics_unconfigured summary turns the whole health block into 服务指标暂不可用 with the verbatim code and no fabricated rows', async () => {
    const { api } = makeHermesApi({ summary: fail(503, 'runtime.metrics_unconfigured') });
    const { health, usage, heat } = await openMetrics(
      api,
      makeTrendsApi({ activity: { cells: [{ dow: 1, hour: 9, count: 1 }], max: 1 } }).api,
    );
    const err = within(health).getByTestId('agent-v2-metrics-health-error');
    expect(err.textContent).toContain('服务指标暂不可用');
    expect(err.textContent).toContain('runtime.metrics_unconfigured');
    // nothing of the source layout survives in the failed state
    expect(within(health).queryByTestId('agent-v2-metrics-src-gateway')).toBeNull();
    expect(within(health).queryByTestId('agent-v2-metrics-gw-status')).toBeNull();
    // other blocks keep their own data (per-block isolation, direction 1)
    expect(within(usage).getByTestId('agent-v2-metrics-tok-in').textContent).toBe('1000');
    expect(within(heat).getByTestId('agent-v2-metrics-heat-grid')).toBeTruthy();
  });

  // ---- B. usage block ----

  it('defaults to the 7-day window and the 近 30 天 toggle re-requests with days=30', async () => {
    const { api, getUsage } = makeHermesApi();
    const { usage } = await openMetrics(api);
    expect(getUsage).toHaveBeenCalledTimes(1);
    expect(within(usage).getByTestId('agent-v2-metrics-days-7').getAttribute('aria-pressed')).toBe('true');
    expect(within(usage).getByTestId('agent-v2-metrics-days-30').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(within(usage).getByTestId('agent-v2-metrics-days-30'));
    await waitFor(() => expect(getUsage).toHaveBeenLastCalledWith(30));
    expect(getUsage).toHaveBeenCalledTimes(2);
    expect(within(usage).getByTestId('agent-v2-metrics-days-7').getAttribute('aria-pressed')).toBe('false');
    expect(within(usage).getByTestId('agent-v2-metrics-days-30').getAttribute('aria-pressed')).toBe('true');
  });

  it('renders the four token totals and the by_model rows verbatim, with the declared tool/skill caliber gap', async () => {
    const { api } = makeHermesApi();
    const { usage } = await openMetrics(api);
    expect(within(usage).getByTestId('agent-v2-metrics-tok-in').textContent).toBe('1000');
    expect(within(usage).getByTestId('agent-v2-metrics-tok-out').textContent).toBe('200');
    expect(within(usage).getByTestId('agent-v2-metrics-tok-cache').textContent).toBe('50');
    expect(within(usage).getByTestId('agent-v2-metrics-tok-reason').textContent).toBe('30');
    const models = within(usage).getByTestId('agent-v2-metrics-models');
    expect(within(models).getByText('qwen-plus')).toBeTruthy();
    expect(within(models).getByText('1000')).toBeTruthy();
    expect(within(models).getByText('200')).toBeTruthy();
    // exactly one captured row (header + 1 data row)
    expect(within(models).getAllByRole('row')).toHaveLength(2);
    // no fake tool/skill table — explicit gap line instead (design §3.2)
    expect(
      within(usage).getByTestId('agent-v2-metrics-toolgap').textContent,
    ).toBe('工具/技能分项不在本端点口径内，故此处不展示。');
  });

  it('cost_usd null with cost_status unknown renders 未计价 — the strings "0.00" and "unknown" never appear as money', async () => {
    const { api } = makeHermesApi({ usage: USAGE_DEGRADED });
    const { usage } = await openMetrics(api);
    // dashboard leg degraded without fallback → 暂不可用 instead of token rows
    expect(within(usage).getByTestId('agent-v2-metrics-tokens-unavailable').textContent).toBe('暂不可用');
    // by_model null → honest empty state, no fabricated table
    expect(within(usage).getByTestId('agent-v2-metrics-models-empty').textContent).toBe('暂无模型用量数据');
    // cost block: chip and value both 未计价, no money span at all
    expect(within(usage).getByTestId('agent-v2-metrics-cost-chip').textContent).toBe('未计价');
    expect(within(usage).getByTestId('agent-v2-metrics-cost-notpriced').textContent).toBe('未计价');
    expect(within(usage).queryByTestId('agent-v2-metrics-cost-value')).toBeNull();
    expect(within(usage).getByTestId('agent-v2-metrics-cost-employees-empty').textContent).toBe('暂无按员工账本行');
    // zero-fabrication discipline: never "0.00", never the raw enum token
    expect(usage.textContent).not.toContain('0.00');
    expect(usage.textContent).not.toContain('unknown');
  });

  it('estimated cost shows the 估算 pill, renders ledger money verbatim and lists per_employee as returned', async () => {
    const { api } = makeHermesApi({ usage: USAGE_COST_EST });
    const { usage } = await openMetrics(api);
    expect(within(usage).getByTestId('agent-v2-metrics-cost-chip').textContent).toBe('估算');
    // 6-decimal-summed ledger value, verbatim (no re-rounding to 0.42→0.42 fine, 0.072 stays 0.072)
    expect(within(usage).getByTestId('agent-v2-metrics-cost-value').textContent).toBe('0.42');
    expect(within(usage).getByTestId('agent-v2-metrics-cost-rows').textContent).toBe('3');
    const table = within(usage).getByTestId('agent-v2-metrics-cost-employees');
    expect(within(table).getByText('01EMP00000000000000000DEMO')).toBeTruthy();
    expect(within(table).getByText('01EMP00000000000000001DEMO')).toBeTruthy();
    expect(within(table).getByText('0.072')).toBeTruthy();
    const pills = within(table)
      .getAllByText('估算')
      .concat(within(table).getAllByText('上游实测'));
    expect(pills).toHaveLength(2);
    expect(within(usage).queryByTestId('agent-v2-metrics-cost-notpriced')).toBeNull();
  });

  it('unmapped sessions get their own 未归属 list with sessions, tokens and the verbatim note', async () => {
    const { api } = makeHermesApi();
    const { usage } = await openMetrics(api);
    expect(within(usage).getByTestId('agent-v2-metrics-mapped').textContent).toBe('1');
    const unattr = within(usage).getByTestId('agent-v2-metrics-unattributed');
    expect(within(unattr).getByTestId('agent-v2-metrics-unattr-sessions').textContent).toBe('1');
    // unattributed token quad (7/3/1/2) rendered from the payload, not invented
    expect(within(unattr).getByText('7')).toBeTruthy();
    expect(within(unattr).getByText('3')).toBeTruthy();
    expect(within(unattr).getByText('2')).toBeTruthy();
    expect(within(unattr).getByTestId('agent-v2-metrics-unattr-note').textContent).toBe(ATTR_NOTE);
    expect(within(usage).queryByTestId('agent-v2-metrics-attribution-unavailable')).toBeNull();
  });

  it('degraded attribution shows 降级（reason） and 归属暂不可用 without any unattributed numbers', async () => {
    const { api } = makeHermesApi({ usage: USAGE_ATTR_DEGRADED });
    const { usage } = await openMetrics(api);
    const attrChip = within(usage)
      .getAllByTestId('agent-v2-metrics-chip-degraded')
      .find((c) => c.textContent === '降级（unreachable）');
    expect(attrChip).toBeTruthy();
    expect(within(usage).getByTestId('agent-v2-metrics-attribution-unavailable').textContent).toBe(
      '归属暂不可用',
    );
    expect(within(usage).queryByTestId('agent-v2-metrics-unattributed')).toBeNull();
    expect(within(usage).queryByTestId('agent-v2-metrics-mapped')).toBeNull();
  });

  it('sources.dashboard_usage.fallback_source sqlite-ro-fallback marks the 降级替代来源 chip and keeps token numbers visible', async () => {
    const { api } = makeHermesApi({ usage: USAGE_FALLBACK });
    const { usage } = await openMetrics(api);
    expect(within(usage).getByTestId('agent-v2-metrics-fallback').textContent).toBe(
      '降级替代来源：sqlite-ro-fallback',
    );
    // with a fallback the tokens ARE available — no 暂不可用 placeholder
    expect(within(usage).queryByTestId('agent-v2-metrics-tokens-unavailable')).toBeNull();
    expect(within(usage).getByTestId('agent-v2-metrics-tok-in').textContent).toBe('1000');
  });

  // ---- C. heat block ----

  it('heat requests getRunActivity({weeks:4, tz:Asia/Shanghai}) platform-level and pairs the real grid with the Hermes today counters and caliber note', async () => {
    const { api } = makeHermesApi();
    const trends = makeTrendsApi({ activity: { cells: [{ dow: 3, hour: 14, count: 2 }], max: 2 } });
    const { heat } = await openMetrics(api, trends.api);
    // exact params: platform-level (NO employeeId — the adapter is called
    // with a literal object, so toHaveBeenCalledWith pins key-by-key)
    expect(trends.getRunActivity).toHaveBeenCalledWith({ weeks: 4, tz: 'Asia/Shanghai' });
    const platform = within(heat).getByTestId('agent-v2-metrics-heat-platform');
    const cells = within(platform).getAllByTestId('agent-v2-metrics-heat-cell');
    expect(cells).toHaveLength(168);
    const hot = cells.find((c) => (c.getAttribute('title') ?? '').startsWith('周三 14:00 · 2'));
    expect(hot).toBeTruthy();
    expect(hot!.className).toContain('is-l4');
    // Hermes side column comes from summary.gateway.metrics_today, verbatim
    const hermes = within(heat).getByTestId('agent-v2-metrics-heat-hermes');
    expect(within(hermes).getByText('2026-11-14')).toBeTruthy();
    expect(within(hermes).getByText('5')).toBeTruthy();
    expect(within(hermes).getByText('6')).toBeTruthy();
    // explicit caliber difference, always stated
    expect(within(heat).getByTestId('agent-v2-metrics-caliber').textContent).toContain(
      '口径差异',
    );
  });

  it('empty activity renders the honest empty state with no fake matrix, and a degraded gateway degrades only the Hermes heat side', async () => {
    const { api } = makeHermesApi({ summary: SUMMARY_GATEWAY_DEGRADED });
    const { health, heat } = await openMetrics(api, makeTrendsApi({ activity: { cells: [] } }).api);
    // platform side: empty cells → 暂无活动数据
    expect(within(heat).getByTestId('agent-v2-metrics-heat-empty').textContent).toBe('暂无活动数据');
    // Hermes side: gateway leg degraded → its own 暂不可用 line, no counters
    const hermes = within(heat).getByTestId('agent-v2-metrics-heat-hermes');
    expect(within(hermes).getByTestId('agent-v2-metrics-heat-hermes-degraded').textContent).toBe('暂不可用');
    expect(hermes.textContent).not.toContain('2026-11-14');
    // same reason wording inside the health block
    expect(within(health).getByTestId('agent-v2-metrics-chip-degraded').textContent).toBe(
      '降级（gateway_key_unconfigured）',
    );
    expect(within(health).getByTestId('agent-v2-metrics-gateway-unavailable').textContent).toBe('暂不可用');
    // DEFECT CHECK (design §3.3 / component header: 缺数据 → 该侧空态, never a
    // fake matrix): with zero cells nothing may be drawn.
    expect(within(heat).queryByTestId('agent-v2-metrics-heat-grid')).toBeNull();
  });

  // ---- D. per-block error isolation ----

  it('a 503 usage envelope errors only the usage block; health and the summary-derived Hermes heat column keep their data', async () => {
    const { api } = makeHermesApi({ usage: fail(503, 'runtime.hermes_metrics_unconfigured') });
    const { usage, health, heat } = await openMetrics(api);
    const err = within(usage).getByTestId('agent-v2-metrics-usage-error');
    expect(err.textContent).toContain('查询失败，请重试');
    expect(err.textContent).toContain('runtime.hermes_metrics_unconfigured');
    // usage data area replaced entirely — no partial fabrication
    expect(within(usage).queryByTestId('agent-v2-metrics-tokens')).toBeNull();
    expect(within(usage).queryByTestId('agent-v2-metrics-cost-chip')).toBeNull();
    // health unaffected: gateway fields still render from the summary fixture
    expect(within(health).getByTestId('agent-v2-metrics-gw-status').textContent).toBe('ok');
    // heat Hermes side survives (it reads the summary, not the usage)
    const hermes = within(heat).getByTestId('agent-v2-metrics-heat-hermes');
    expect(within(hermes).getByText('2026-11-14')).toBeTruthy();
  });
});
