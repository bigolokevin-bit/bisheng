/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * MET-01 `/agent/metrics` page tests (MET01-TARGET-SPEC.md §3/§9).
 *
 * Same harness as the TSK-01 suite: stub the global fetch makeFetcher()
 * uses, route by URL with the frozen runtime shapes, and mock react-i18next
 * against the REAL zh-Hans resources so the raw-key leak guard is
 * meaningful. Covers: normal three-block render, loading skeletons without
 * 0/—, partial/full degradation, empty states (no fake grid, no 0.00),
 * 403 whole-page card, 401 code-split (login vs in-card credential copy),
 * 404 in-card not-wired copy, window toggle keeping old values, URL win
 * fallback, heat drill-down guards, CSV export and the read-only红线.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/components/bs-ui/message', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('react-i18next', async () => {
  const mod = (await import('../../../../public/locales/zh-Hans/bs.json')) as {
    default: Record<string, unknown>;
  };
  const dict = mod.default;
  const t = (key: unknown, defOrOpts?: unknown): string => {
    const value = String(key)
      .split('.')
      .reduce<unknown>(
        (acc, part) =>
          acc && typeof acc === 'object'
            ? (acc as Record<string, unknown>)[part]
            : undefined,
        dict
      );
    if (typeof defOrOpts === 'string') {
      return typeof value === 'string' ? value : defOrOpts;
    }
    if (typeof value === 'string') {
      const options = (defOrOpts ?? {}) as Record<string, unknown>;
      return value.replace(/\{\{(\w+)\}\}/g, (m, name: string) =>
        name in options ? String(options[name]) : m
      );
    }
    return String(key);
  };
  return { useTranslation: () => ({ t }) };
});

import { MetricsPage } from '../MetricsPage';
import type { HermesSummary, HermesUsage } from '@/controllers/API/agentConsoleHermes';
import type { ActivityBody } from '../v2Data';

// ---------------------------------------------------------------- fixtures

const EMP_A = 'emp_86A81CE8FF6F42E187BCF2B540';
const EMP_B = 'emp_5B3C7A9D1E2F4068B5C3D7E9';

function okSummary(): HermesSummary {
  return {
    schema: 'runtime.hermes.summary.v1',
    sources: {
      gateway_health: { state: 'ok' },
      dashboard_system: { state: 'ok' },
      dashboard_sessions_stats: { state: 'ok' },
    },
    gateway: {
      status: 'ok',
      platform: null,
      version: '0.9.2',
      gateway_state: 'running',
      active_agents: 2,
      gateway_busy: false,
      gateway_drainable: true,
      updated_at: new Date().toISOString(),
      platforms: { feishu: { state: 'connected', needs_attention: false }, api: { state: 'connected', needs_attention: true } },
      metrics_today: { day: '2026-11-16', requests: 1284, messages: 3406, tokens: 1243862, latency_p95_ms: 800 },
      note: '当日计数、重启归零、不回填历史',
    },
    system: {
      hermes_version: null,
      cpu_count: 8,
      cpu_percent: 42.5,
      load_avg: [0.42, 0.38, 0.35],
      uptime_seconds: 273600,
      memory: { total: 16777216, available: 6073352, used: 10703864, percent: 63.8 },
      disk: { total: 494384791552, used: 386608906240, free: 107775885312, percent: 78.2 },
      process: { rss: 123456, num_threads: 46 },
      psutil: true,
    },
    sessions_stats: { total: 312, active_store: 28, archived: 284, messages: 4106, by_source: { feishu: 256, chat: 38, api: 14, other: 4 } },
  };
}

function okUsage(): HermesUsage {
  return {
    schema: 'runtime.hermes.usage.v1',
    period_days: 7,
    sources: { dashboard_usage: { state: 'ok' }, gateway_sessions: { state: 'ok' }, cost_ledger: { state: 'ok' } },
    tokens: { total_input: 12438620, total_output: 1862431, total_cache_read: 9204118, total_reasoning: 640220 },
    by_model: [
      { model: 'qwen-max', input_tokens: 6204118, output_tokens: 903220 },
      { model: 'qwen-plus', input_tokens: 3882402, output_tokens: 611871 },
      { model: 'qwen-flash', input_tokens: 1752000, output_tokens: 247340 },
      { model: 'qwen3-max', input_tokens: 600100, output_tokens: 100000 },
    ],
    cost: {
      source: 'cost_ledger',
      cost_usd: 0.11,
      cost_status: 'upstream',
      rows: 14,
      per_employee: [
        { employee_id: EMP_A, cost_usd: 0.09, cost_status: 'upstream', rows: 10 },
        { employee_id: EMP_B, cost_usd: 0.02, cost_status: 'upstream', rows: 4 },
      ],
    },
    attribution: {
      state: 'ok',
      mapped_sessions: 168,
      unattributed: { sessions: 32, tokens: { total_input: 402118, total_output: 58220, total_cache_read: 301004, total_reasoning: 12400 } },
    },
  };
}

function okActivity(): ActivityBody {
  return {
    tz: 'Asia/Shanghai',
    max: 42,
    cells: [
      { dow: 3, hour: 14, count: 42 },
      { dow: 1, hour: 14, count: 20 },
      { dow: 2, hour: 14, count: 18 },
      { dow: 4, hour: 14, count: 20 },
      { dow: 1, hour: 2, count: 10 },
      { dow: 2, hour: 3, count: 10 },
    ],
  };
}

// ---------------------------------------------------------------- stub plumbing

interface Stub {
  summary: { status: number; body: unknown };
  usage: { status: number; body: unknown };
  activity: { status: number; body: unknown };
  employees: { status: number; body: unknown };
  /** When set, usage requests hang until release() is called. */
  usageGate?: { promise: Promise<void>; release: () => void };
}

let stub: Stub;
let urls: string[] = [];
let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'X-Console-Request-Id': 'req_met01' }),
    json: async () => body,
  };
}

function makeGate() {
  let release!: () => void;
  const promise = new Promise<void>((res) => {
    release = res;
  });
  return { promise, release };
}

beforeEach(() => {
  urls = [];
  fetchCalls = [];
  stub = {
    summary: { status: 200, body: okSummary() },
    usage: { status: 200, body: okUsage() },
    activity: { status: 200, body: okActivity() },
    employees: { status: 200, body: { items: [{ employeeId: EMP_A, name: '小鲤', lifecycleState: 'active' }] } },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      fetchCalls.push({ url, init });
      if (url.includes('/api/hermes-summary')) return jsonResponse(stub.summary.status, stub.summary.body);
      if (url.includes('/api/hermes-usage')) {
        if (stub.usageGate) await stub.usageGate.promise;
        return jsonResponse(stub.usage.status, stub.usage.body);
      }
      if (url.includes('/api/run-activity')) return jsonResponse(stub.activity.status, stub.activity.body);
      if (url.includes('/api/employees')) return jsonResponse(stub.employees.status, stub.employees.body);
      return jsonResponse(200, {});
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderPage(entry = '/agent/metrics') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <MetricsPage />
    </MemoryRouter>
  );
}

const bodyText = () => document.body.textContent ?? '';

/** G15-style leak guard: no raw keys, no machine codes, no fake values. */
function expectHonestScreen() {
  const text = bodyText();
  expect(text).not.toContain('agentConsole.');
  expect(text).not.toContain('undefined');
  expect(text).not.toContain('NaN');
  expect(text).not.toContain('[object Object]');
  expect(text).not.toContain('待接入');
  expect(text).not.toContain('0.00');
  for (const code of ['request.', 'runtime.', 'console.', 'upstream.', 'M-GAP-']) {
    // machine codes may live in title attributes, never in visible text
    expect(text).not.toContain(code);
  }
}

// ---------------------------------------------------------------- tests

describe('MET-01 normal state', () => {
  it('renders A→B→C together with the caliber panel open and A0 正常', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-met-agrid');
    expect(screen.getByTestId('agent-v2-page-metrics')).toBeTruthy();
    expect(screen.getByTestId('agent-v2-met-block-b')).toBeTruthy();
    expect(screen.getByTestId('agent-v2-met-block-c')).toBeTruthy();
    expect(screen.getByTestId('agent-v2-met-calib')).toBeTruthy();
    expect(screen.getByTestId('agent-v2-met-a0-level').textContent).toContain('正常');
    // five iron rules on screen
    const calib = screen.getByTestId('agent-v2-met-calib').textContent ?? '';
    for (const rule of ['降级不补零', '金额只认账本', 'token 与金额不同源', '聚合只认服务端', '实例级≠租户级']) {
      expect(calib).toContain(rule);
    }
    // footer iron rule 3
    expect(screen.getByTestId('agent-v2-met-footer').textContent).toContain('数量来自 Hermes，金额来自本租户账本');
    expectHonestScreen();
  });

  it('only GETs the four whitelisted endpoints; no write affordance anywhere', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-met-agrid');
    await screen.findByTestId('agent-v2-met-heat-grid');
    expect(urls.some((u) => u.includes('/api/hermes-summary'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/hermes-usage?days=7'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/run-activity') && u.includes('weeks=4') && u.includes('tz=Asia%2FShanghai'))).toBe(true);
    for (const call of fetchCalls) {
      expect(call.init?.method ?? 'GET').toBe('GET');
    }
    const writeRe = /重跑|中止|删除|新建|批量|创建|停 run|调预算|改阈值/;
    const clickables = document.querySelectorAll('button, a, [role="button"]');
    for (const el of clickables) {
      expect(el.textContent ?? '').not.toMatch(writeRe);
    }
    // thresholds are constants, never a button
    expect(screen.queryByText('调整阈值')).toBeNull();
  });

  it('heat grid: 168 cells, Monday-first rows, 4-hour axis, zero cells not clickable, non-zero drills with since+from', async () => {
    renderPage();
    const grid = await screen.findByTestId('agent-v2-met-heat-grid');
    const cells = grid.querySelectorAll('[data-testid="agent-v2-met-heat-grid-cell"]');
    expect(cells.length).toBe(168);
    const rows = grid.querySelectorAll('.met-hrow');
    expect(rows.length).toBe(7);
    expect(rows[0].textContent).toContain('周一');
    expect(rows[6].textContent).toContain('周日');
    const axis = grid.querySelector('.met-hcs.ax');
    expect(axis?.textContent).toBe('000408121620');
    const peak = grid.querySelector('[data-dow="3"][data-hour="14"]') as HTMLAnchorElement;
    expect(peak.tagName).toBe('A');
    expect(peak.getAttribute('href')).toContain('/agent/runs?since=');
    expect(peak.getAttribute('href')).toContain('from=metrics');
    const zero = grid.querySelector('[data-dow="5"][data-hour="5"]') as HTMLElement;
    expect(zero.tagName).not.toBe('A');
    expect(zero.getAttribute('aria-disabled')).toBe('true');
    // text equivalent exists
    expect(screen.getByTestId('agent-v2-met-heat-summary').textContent).toContain('文本摘要');
    expectHonestScreen();
  });

  it('money renders USD 0.11 with 上游实测; employee names resolved, unknown id gets the honest note', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-met-cost-value');
    expect(screen.getByTestId('agent-v2-met-cost-value').textContent).toContain('0.11');
    expect(screen.getByTestId('agent-v2-met-cost-pill').textContent).toContain('上游实测');
    const rows = screen.getAllByTestId('agent-v2-met-cost-emp-row');
    expect(rows[0].textContent).toContain('小鲤');
    expect(rows[1].textContent).toContain('未在员工表找到');
    expect(rows[0].querySelector('a')?.getAttribute('href')).toContain(`/agent/employees/${EMP_A}?tab=runs`);
    // attribution scope is the last 200 sessions, never "all"
    expect(screen.getByTestId('agent-v2-met-attr').textContent).toContain('最近 200 个会话');
    expectHonestScreen();
  });
});

describe('MET-01 loading state', () => {
  it('three independent skeletons without 0/—; export disabled with a reason', async () => {
    stub.usageGate = makeGate();
    // summary + activity hang too: swap their bodies for never-resolving gates
    const sumGate = makeGate();
    const heatGate = makeGate();
    const origFetch = global.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/hermes-summary')) {
          await sumGate.promise;
          return jsonResponse(200, okSummary());
        }
        if (url.includes('/api/run-activity')) {
          await heatGate.promise;
          return jsonResponse(200, okActivity());
        }
        return (origFetch as typeof fetch)(input, init);
      })
    );
    renderPage();
    await screen.findByTestId('agent-v2-met-skel-a');
    expect(screen.getByTestId('agent-v2-met-skel-b')).toBeTruthy();
    expect(screen.getByTestId('agent-v2-met-skel-c')).toBeTruthy();
    const skelText =
      (screen.getByTestId('agent-v2-met-skel-a').textContent ?? '') +
      (screen.getByTestId('agent-v2-met-skel-b').textContent ?? '') +
      (screen.getByTestId('agent-v2-met-skel-c').textContent ?? '');
    expect(skelText).toBe(''); // bars only — no 0, no —, no fake numbers
    const exportBtn = screen.getByTestId('agent-v2-met-export') as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(true);
    expect(exportBtn.title).toContain('加载');
    expect(screen.getByTestId('agent-v2-met-loading-note').textContent).toContain('骨架里不显示 0 或 —');
    sumGate.release();
    heatGate.release();
    stub.usageGate.release();
    await screen.findByTestId('agent-v2-met-agrid');
  });
});

describe('MET-01 degradation states', () => {
  it('partial: ONE warning strip, A3 honest block, A0 注意, other cards unaffected', async () => {
    const s = okSummary();
    s.sources.dashboard_system = { state: 'degraded', reason: 'timeout' };
    s.system.cpu_percent = null;
    stub.summary.body = s;
    renderPage();
    await screen.findByTestId('agent-v2-met-degstrip');
    const strip = screen.getByTestId('agent-v2-met-degstrip');
    expect(strip.textContent).toContain('有 1 个来源不可用');
    expect(strip.textContent).toContain('系统资源');
    expect(strip.textContent).toContain('上游响应超时');
    expect(screen.getAllByTestId('agent-v2-met-degstrip').length).toBe(1);
    const deg = screen.getByTestId('agent-v2-met-a3-deg');
    expect(deg.textContent).toContain('暂不可用');
    expect(deg.textContent).toContain('这里不显示 0');
    expect(screen.getByTestId('agent-v2-met-a0-level').textContent).toContain('注意');
    // gateway card still renders real numbers
    expect(screen.getByTestId('agent-v2-met-a1-active').textContent).toBe('2');
    expectHonestScreen();
  });

  it('config reason appends 配置未完成 to A0', async () => {
    const s = okSummary();
    s.sources.gateway_health = { state: 'degraded', reason: 'gateway_key_unconfigured' };
    stub.summary.body = s;
    renderPage();
    await screen.findByTestId('agent-v2-met-a0-level');
    expect(screen.getByTestId('agent-v2-met-a0-level').textContent).toContain('配置未完成');
  });

  it('full degradation: A becomes the error card (not empty), B/C keep rendering', async () => {
    const s = okSummary();
    s.sources.gateway_health = { state: 'degraded', reason: 'unreachable' };
    s.sources.dashboard_system = { state: 'degraded', reason: 'unreachable' };
    s.sources.dashboard_sessions_stats = { state: 'degraded', reason: 'unreachable' };
    stub.summary.body = s;
    renderPage();
    await screen.findByTestId('agent-v2-met-a-error');
    expect(screen.getByTestId('agent-v2-met-a-error').textContent).toContain('指标服务暂时联系不上');
    expect(screen.getByTestId('agent-v2-met-a-error').textContent).toContain('这里不显示 0');
    expect(screen.queryByTestId('agent-v2-met-agrid')).toBeNull();
    expect(screen.getByTestId('agent-v2-met-block-b')).toBeTruthy();
    expect(screen.getByTestId('agent-v2-met-heat-grid')).toBeTruthy();
    expect(screen.getByTestId('agent-v2-met-a0-level').textContent).toContain('异常');
    expectHonestScreen();
  });

  it('summary request 502: error card carries HTTP status + request id, never the machine code', async () => {
    stub.summary = { status: 502, body: { code: 'upstream.unavailable', message: 'stub' } };
    renderPage();
    await screen.findByTestId('agent-v2-met-a-error');
    const card = screen.getByTestId('agent-v2-met-a-error');
    expect(card.textContent).toContain('HTTP 502');
    expect(card.textContent).toContain('req_met01');
    expect(card.textContent).not.toContain('upstream.unavailable');
    expect(screen.getByTestId('agent-v2-met-a-error-retry')).toBeTruthy();
    expectHonestScreen();
  });

  it('usage degraded with sqlite fallback: values stay, warning pill + tokens-only note', async () => {
    const u = okUsage();
    u.sources.dashboard_usage = { state: 'degraded', reason: 'timeout', fallback_source: 'sqlite-ro-fallback' };
    stub.usage.body = u;
    renderPage();
    await screen.findByTestId('agent-v2-met-fallback');
    expect(screen.getByTestId('agent-v2-met-fallback').textContent).toContain('降级来源');
    expect(screen.getByTestId('agent-v2-met-tokIn').textContent).toContain('12.4M');
    expect(bodyText()).toContain('仅 token，不含金额');
    // money is independent of dashboard degradation
    expect(screen.getByTestId('agent-v2-met-cost-value').textContent).toContain('0.11');
    expectHonestScreen();
  });
});

describe('MET-01 empty states — never a fake zero', () => {
  it('heat max=0: whole-card empty state, NO 168-cell grid; tokens all 0 → 没有用量; cost 0 rows → 未计价', async () => {
    stub.activity.body = { tz: 'Asia/Shanghai', max: 0, cells: [] };
    const u = okUsage();
    u.tokens = { total_input: 0, total_output: 0, total_cache_read: 0, total_reasoning: 0 };
    u.by_model = [];
    u.cost = { source: 'cost_ledger', cost_usd: null, cost_status: 'unknown', rows: 0, per_employee: [] };
    u.attribution = { state: 'ok', mapped_sessions: 0, unattributed: { sessions: 0 } };
    stub.usage.body = u;
    renderPage();
    await screen.findByTestId('agent-v2-met-heat-empty');
    expect(screen.getByTestId('agent-v2-met-heat-empty').textContent).toContain('近 4 周没有运行记录');
    expect(screen.queryByTestId('agent-v2-met-heat-grid')).toBeNull();
    expect(screen.getByTestId('agent-v2-met-heat-empty-runs')).toBeTruthy();
    expect(screen.getByTestId('agent-v2-met-tokIn').textContent).toContain('近 7 天没有用量');
    expect(screen.getByTestId('agent-v2-met-models-empty').textContent).toContain('近 7 天没有模型用量');
    const cost = screen.getByTestId('agent-v2-met-cost-notpriced');
    expect(cost.textContent).toContain('未计价');
    expect(cost.textContent).toContain('0 行账目');
    expect(screen.getByTestId('agent-v2-met-attr-empty').textContent).toContain('没有可归属的会话');
    expectHonestScreen();
  });

  it('A4 by_source empty object → 暂无来源分布 (empty, not degraded)', async () => {
    const s = okSummary();
    s.sessions_stats.by_source = {};
    stub.summary.body = s;
    renderPage();
    await screen.findByTestId('agent-v2-met-a4-source-empty');
    expect(screen.getByTestId('agent-v2-met-a4-source-empty').textContent).toContain('暂无来源分布');
    expect(screen.queryByTestId('agent-v2-met-a4-deg')).toBeNull();
  });
});

describe('MET-01 auth/error triage by code', () => {
  it('403 console.forbidden → whole-page card, no skeletons, no cards', async () => {
    stub.summary = { status: 403, body: { code: 'console.forbidden' } };
    stub.usage = { status: 403, body: { code: 'console.forbidden' } };
    stub.activity = { status: 403, body: { code: 'console.forbidden' } };
    renderPage();
    await screen.findByTestId('agent-v2-met-forbidden');
    expect(screen.getByTestId('agent-v2-met-forbidden').textContent).toContain('运行指标仅对管理员开放');
    const forbiddenCard = screen.getByTestId('agent-v2-met-forbidden');
    expect(forbiddenCard.textContent).toContain('没有管理控制台权限');
    expect(forbiddenCard.textContent).not.toContain('HTTP 403');
    expect(forbiddenCard.querySelector('.s')?.getAttribute('title')).toContain('HTTP 403');
    expect(screen.queryByTestId('agent-v2-met-skel-a')).toBeNull();
    expect(screen.queryByTestId('agent-v2-met-agrid')).toBeNull();
    expect(screen.getByTestId('agent-v2-met-forbidden-back')).toBeTruthy();
    expectHonestScreen();
  });

  it('401 console.unauthenticated → login with return handoff, never a page', async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, href: 'http://localhost/agent/metrics', assign },
    });
    try {
      stub.summary = { status: 401, body: { code: 'console.unauthenticated' } };
      renderPage();
      await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
      expect(window.localStorage.getItem('LOGIN_PATHNAME')).toBe('http://localhost/agent/metrics');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
      window.localStorage.removeItem('LOGIN_PATHNAME');
      window.localStorage.removeItem('LOGIN_PATHNAME_AT');
    }
  });

  it('401 request.invalid_token → in-card server-credential copy, NO login redirect', async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, href: 'http://localhost/agent/metrics', assign },
    });
    try {
      stub.summary = { status: 401, body: { code: 'request.invalid_token' } };
      renderPage();
      await screen.findByTestId('agent-v2-met-a-error');
      expect(screen.getByTestId('agent-v2-met-a-error').textContent).toContain('服务端凭据未配置');
      expect(assign).not.toHaveBeenCalled();
      expectHonestScreen();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('heat 404 → in-card 「还没有接通」 with request id, other blocks unaffected', async () => {
    stub.activity = { status: 404, body: { code: 'route.not_found' } };
    renderPage();
    await screen.findByTestId('agent-v2-met-heat-404');
    const card = screen.getByTestId('agent-v2-met-heat-404');
    expect(card.textContent).toContain('这项指标本部署还没有接通');
    expect(card.textContent).toContain('req_met01');
    expect(screen.getByTestId('agent-v2-met-agrid')).toBeTruthy();
    expect(screen.getByTestId('agent-v2-met-block-b')).toBeTruthy();
    expectHonestScreen();
  });

  it('heat 422 → params-rejected copy, retry never rewrites the query', async () => {
    stub.activity = { status: 422, body: { code: 'request.invalid_query' } };
    renderPage();
    await screen.findByTestId('agent-v2-met-heat-error');
    expect(screen.getByTestId('agent-v2-met-heat-error').textContent).toContain('时间窗口参数不被接受');
    const before = urls.filter((u) => u.includes('/api/run-activity')).length;
    fireEvent.click(screen.getByTestId('agent-v2-met-heat-error-retry'));
    await waitFor(() => expect(urls.filter((u) => u.includes('/api/run-activity')).length).toBe(before + 1));
    for (const u of urls.filter((x) => x.includes('/api/run-activity'))) {
      expect(u).toContain('weeks=4');
      expect(u).toContain('tz=Asia%2FShanghai');
    }
  });
});

describe('MET-01 window toggle & URL guards', () => {
  it('win=30 keeps previous values + 更新中 while fetching, then swaps; C unaffected', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-met-tokIn');
    expect(screen.getByTestId('agent-v2-met-tokIn').textContent).toContain('12.4M');
    stub.usageGate = makeGate();
    const u30 = okUsage();
    u30.period_days = 30;
    u30.tokens.total_input = 40000000;
    stub.usage.body = u30;
    fireEvent.click(screen.getByTestId('agent-v2-met-win-30'));
    await screen.findByTestId('agent-v2-met-updating');
    // old values still on screen — never cleared to skeletons
    expect(screen.getByTestId('agent-v2-met-tokIn').textContent).toContain('12.4M');
    expect(screen.queryByTestId('agent-v2-met-skel-b')).toBeNull();
    stub.usageGate.release();
    await waitFor(() => expect(screen.getByTestId('agent-v2-met-tokIn').textContent).toContain('40M'));
    expect(urls.some((u) => u.includes('/api/hermes-usage?days=30'))).toBe(true);
    // heat was fetched exactly once (window toggle must not refetch C)
    expect(urls.filter((u) => u.includes('/api/run-activity')).length).toBe(1);
  });

  it('illegal ?win=99 falls back to 7 and the footer records it', async () => {
    renderPage('/agent/metrics?win=99');
    await screen.findByTestId('agent-v2-met-win-fallback');
    expect(screen.getByTestId('agent-v2-met-win-fallback').textContent).toContain('参数已回落');
    expect(urls.some((u) => u.includes('/api/hermes-usage?days=7'))).toBe(true);
  });
});

describe('MET-01 export (the single front-end read-only action)', () => {
  it('downloads the pinned CSV schema with a timestamped name and a success toast', async () => {
    let captured: Blob | null = null;
    const createObjectURL = vi.fn((blob: Blob) => {
      captured = blob;
      return 'blob:stub';
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL, revokeObjectURL }));
    let downloaded: string | null = null;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloaded = this.download;
    });
    renderPage();
    await screen.findByTestId('agent-v2-met-heat-grid');
    const exportBtn = screen.getByTestId('agent-v2-met-export') as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(false);
    fireEvent.click(exportBtn);
    await screen.findByTestId('agent-v2-met-toast');
    expect(screen.getByTestId('agent-v2-met-toast').textContent).toContain('已导出 3 个区块');
    expect(downloaded).toMatch(/^metrics-\d{8}-\d{4}\.csv$/);
    expect(captured).not.toBeNull();
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(captured as unknown as Blob);
    });
    expect(csv.split('\n')[0]).toBe('# seakoi console metrics export v1');
    expect(csv).toContain('section,metric,value,unit,caliber,source_state,window,fetched_at');
    expect(csv.trim().endsWith('# 口径：数量来自 Hermes，金额来自本租户账本，不可换算')).toBe(true);
    expect(csv).toContain('cost.cost_usd,0.11,USD,租户账本');
    clickSpy.mockRestore();
  });
});

/** Text of the line the tip sits on (its <li> or header row). */
function closestText(el: HTMLElement): string {
  const host = el.closest('li') ?? el.closest('.met-fresh') ?? el.parentElement;
  return host?.textContent ?? '';
}

describe('MET-01 P1 batch2 — governance terminology help', () => {
  it('bucketSum rides rule 4 (server-side aggregation) and pendingKpi rides the freshness line', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-met-calib');
    const sum = screen.getByTestId('agent-v2-met-help-bucketsum');
    const pend = screen.getByTestId('agent-v2-met-help-pendingkpi');
    // both anchors live inside the copy they explain, never on their own row
    expect(closestText(sum)).toContain('聚合只认服务端');
    expect(closestText(pend)).toContain('只读投影');
    fireEvent.click(sum);
    const pop = screen.getByRole('tooltip');
    expect(pop.textContent).toContain('bucketSum');
    expect(pop.textContent).toContain('聚合');
    expect(pop.textContent).not.toContain('agentConsole.v2.help');
    // Escape closes; the panel copy underneath is untouched
    fireEvent.keyDown(sum, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByTestId('agent-v2-met-calib').textContent).toContain('聚合只认服务端');
  });
});
