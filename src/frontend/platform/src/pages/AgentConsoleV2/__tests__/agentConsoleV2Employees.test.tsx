/**
 * W2 employees list screen tests (parity spec §4 / EMP-01).
 *
 * Strategy: stub the global fetch that makeFetcher() uses and return the
 * exact live BFF shapes captured on 2026-11-15 (w1-shape-verify2 probe):
 * E11 rows with batched enrichment, E14 six-state stats, AP8 approval
 * stats, R6 day buckets, R7 activity cells, P9 month ledger rows, E10
 * workstation lists. Platform test setup mocks react-i18next as t(key)=>key,
 * so assertions reference raw keys and unformatted service values.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { userContext } from '@/contexts/userContext';

import { EmployeeDetailPage } from '../EmployeeDetailPage';
import { EmployeesListPage } from '../EmployeesListPage';

const EMP1 = 'emp_86A81CE8FF6F42E187BCF2B540';
const EMP2 = 'emp_0166858D562149938FBDA22649';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'X-Console-Request-Id': 'req_test_w2' }),
    json: async () => body,
  };
}

const employeesBody = (enriched = true) => ({
  items: enriched
    ? [
        {
          employeeId: EMP1,
          name: 'AgentOS Product Assistant',
          title: 'product assistant (pilot)',
          lifecycleState: 'active',
          ownerUserId: 'user_1',
          updatedAt: '2026-11-15T04:21:00Z',
          enrichment: {
            currentVersionNo: 3,
            effectiveFrom: '2026-11-15T03:27:58Z',
            effectiveBudget: { monthlyCostUsd: 10.0, dailyTokens: 100000, perRunMaxUsd: 0.5 },
            knowledgeCount: 1,
            workstationCount: 2,
            pendingApprovalCount: 0,
          },
        },
        {
          employeeId: EMP2,
          name: 'Inspector Two',
          title: 'qa reviewer',
          lifecycleState: 'paused',
          ownerUserId: 'user_second_owner',
          updatedAt: '2026-11-14T04:21:00Z',
        },
      ]
    : [],
});

const statsBody = {
  total: 2,
  byLifecycle: {
    active: 2,
    onboarding: 0,
    paused: 0,
    offboarding: 0,
    draft: 0,
    archived: 0,
  },
};

/** Buckets with the newest non-zero day first in the array tail. */
const runBuckets = [
  {
    bucketStart: '2026-11-12T00:00:00Z',
    runs: 1,
    succeeded: 1,
    failed: 0,
    costUsd: 0.009875,
  },
  {
    bucketStart: '2026-11-14T00:00:00Z',
    runs: 13,
    succeeded: 12,
    failed: 1,
    costUsd: 0.121198,
  },
];

const emptyRunStats = { buckets: [] };

const budgetBody = {
  items: [
    {
      employeeId: EMP1,
      period: '2026-11',
      periodKind: 'month',
      tokensUsed: 0,
      costUsd: 0.121198,
      reserved: 0.0,
      updatedAt: '2026-11-15T00:00:00Z',
    },
  ],
  missingEmployeeIds: [EMP2],
};

const activityBody = {
  from: '2026-11-08T00:00:00Z',
  to: '2026-11-15T00:00:00Z',
  tz: 'Asia/Shanghai',
  max: 4,
  cells: [{ dow: 3, hour: 9, count: 4 }],
};

let urls: string[] = [];
let employeesNextCursor: string | null = null;
let employeesStatus = 200;
let employeesEnriched = true;
// EMP-01 r5 (G15): endpoint failure toggles for the error-state cases.
// statsFail injects the real machine code run.invalid_query on E14 and
// budgetFail injects budget.range_too_large on P9 — both must stay off-screen.
let statsFail = false;
let budgetFail = false;

// BFF-shaped error body for the given HTTP status (never leak into copy).
function errorCodeFor(status: number) {
  if (status === 401) return 'console.unauthenticated';
  if (status === 403) return 'console.forbidden';
  return 'console.upstream';
}

function routeRequest(url: string) {
  urls.push(url);
  if (url.includes('/api/employees')) {
    if (employeesStatus !== 200) {
      return jsonResponse(employeesStatus, {
        code: errorCodeFor(employeesStatus),
        message: 'stubbed failure',
      });
    }
    return jsonResponse(200, {
      ...employeesBody(employeesEnriched),
      ...(employeesNextCursor ? { nextCursor: employeesNextCursor } : {}),
    });
  }
  if (url.includes('/api/employee-stats')) {
    return statsFail
      ? jsonResponse(500, { code: 'run.invalid_query', message: 'stubbed failure' })
      : jsonResponse(200, statsBody);
  }
  if (url.includes('/api/approval-stats')) return jsonResponse(200, { pending: 3, dueSoon: 1 });
  if (url.includes('/api/budget-usage')) {
    if (budgetFail) {
      return jsonResponse(500, { code: 'budget.range_too_large', message: 'stubbed failure' });
    }
    return jsonResponse(200, employeesEnriched ? budgetBody : { items: [], missingEmployeeIds: [] });
  }
  if (url.includes('/api/run-activity')) return jsonResponse(200, activityBody);
  if (url.includes('/api/run-stats')) {
    if (url.includes('employeeId=')) {
      return url.includes(EMP1)
        ? jsonResponse(200, { buckets: runBuckets })
        : jsonResponse(200, emptyRunStats);
    }
    // KPI windows: the later `from` is the current rolling 7-day window.
    const from = decodeURIComponent(url.match(/from=([^&]*)/)?.[1] ?? '');
    return from >= isoWeekAgoBoundary()
      ? jsonResponse(200, { buckets: runBuckets })
      : jsonResponse(200, emptyRunStats);
  }
  if (url.includes('/api/workstations')) {
    return jsonResponse(200, {
      items: url.includes(EMP1)
        ? [
            { id: 'ws_g', bindingType: 'group', channel: 'wechat', status: 'active' },
            { id: 'ws_d', bindingType: 'dm', channel: 'wecom', status: 'suspended' },
          ]
        : [],
    });
  }
  return jsonResponse(200, {});
}

// Rough boundary so "current window" wins regardless of test clock drift:
// any from inside the last 8 days counts as current; older is previous.
function isoWeekAgoBoundary() {
  const d = new Date(Date.now() - 8 * 24 * 3600 * 1000);
  return d.toISOString();
}

function renderPage(entry = '/agent/employees') {
  return render(
    // S4: the 「待我审批」 KPI keys off the SESSION identity (the old code
    // hardcoded human:1); the harness therefore signs in as user 1 — the
    // same subject the approval-stats stub answers for.
    <userContext.Provider value={{ user: { user_id: 1, user_name: 'opsadmin' } } as never}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/agent/employees" element={<EmployeesListPage />} />
        </Routes>
        <RouteSearchProbe />
      </MemoryRouter>
    </userContext.Provider>
  );
}

function RouteSearchProbe() {
  const loc = useLocation();
  return <div data-testid="route-search">{loc.search}</div>;
}

beforeEach(() => {
  urls = [];
  employeesStatus = 200;
  employeesEnriched = true;
  employeesNextCursor = null;
  statsFail = false;
  budgetFail = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => routeRequest(String(input)))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('EmployeesListPage (W2 / EMP-01)', () => {
  it('requests E11 with the real enrichment expand dimensions', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-employees-table');
    const employeesUrl = decodeURIComponent(
      urls.find((u) => u.includes('/api/employees')) ?? ''
    );
    expect(employeesUrl).toContain('expand=version,workstations,knowledge,pending');
    // The card-face wording would be rejected by the domain (400), so the
    // page must never send it.
    expect(employeesUrl).not.toContain('stats,cost,owner');
  });

  it('renders service-aggregate KPIs without fabricated zeros', async () => {
    renderPage();
    const onduty = await screen.findByTestId('agent-v2-kpi-onduty');
    expect(onduty.textContent).toBe('2');
    const pending = await screen.findByTestId('agent-v2-kpi-pending');
    expect(pending.textContent).toBe('3');
    const cost = await screen.findByTestId('agent-v2-kpi-cost');
    expect(cost.textContent).toBe('USD 0.12');
    const anomaly = await screen.findByTestId('agent-v2-kpi-anomaly');
    expect(anomaly.textContent).toBe('1');
    const caliber = await screen.findByTestId('agent-v2-kpi-cost-caliber');
    expect(caliber.textContent).toContain('agentConsole.v2.emp.kpiCaliberLedger');
    const container = await screen.findByTestId('agent-v2-employees-page');
    expect(container.textContent).not.toContain('0.00');
    expect(container.textContent).not.toContain('undefined');
  });

  it('S4: a network failure reads 「未能读取」+retry and never masquerades as notFound', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      })
    );
    render(
      <userContext.Provider value={{ user: { user_id: 1 } } as never}>
        <MemoryRouter initialEntries={['/agent/employees/emp_1']}>
          <Routes>
            <Route path="/agent/employees/:id" element={<EmployeeDetailPage />} />
          </Routes>
        </MemoryRouter>
      </userContext.Provider>
    );
    const card = await screen.findByTestId('agent-v2-ed-readFailed');
    expect(card.textContent).toContain('agentConsole.v2.ed.readFailedTitle');
    expect(screen.queryByTestId('agent-v2-ed-notFound')).toBeNull();
    // no gateway id on a dead network — the line says 未提供 (key form here)
    expect(await screen.findByTestId('agent-v2-ed-reqid')).toHaveTextContent(
      'agentConsole.v2.id.requestIdAbsent'
    );
  });

  it('S4: without a session identity the 「待我审批」 KPI sends no approval-stats request and says why', async () => {
    // Deliberately NO userContext.Provider here — the anonymous case.
    render(
      <MemoryRouter initialEntries={['/agent/employees']}>
        <Routes>
          <Route path="/agent/employees" element={<EmployeesListPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const pending = await screen.findByTestId('agent-v2-kpi-pending');
    expect(pending.textContent).toBe('—');
    const reason = await screen.findByTestId('agent-v2-kpi-pending-error');
    expect(reason.textContent).toBe('agentConsole.v2.emp.kpiPendingNoIdentity');
    // and no approval-stats call carried a guessed identity (S4: no uid ⇒
    // the KPI never fires AP8 at all)
    expect(urls.some((u) => u.includes('/api/approval-stats'))).toBe(false);
  });

  it('shows the ten spec columns in fixed order', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-employees-table');
    const heads = [
      'agentConsole.v2.colName',
      'agentConsole.v2.emp.colVersion',
      'agentConsole.v2.colStatus',
      'agentConsole.v2.colOwner',
      'agentConsole.v2.emp.colWorkstation',
      'agentConsole.v2.emp.colPending',
      'agentConsole.v2.emp.colLastRun',
      'agentConsole.v2.emp.colSuccessRate',
      'agentConsole.v2.emp.colMonthCost',
      'agentConsole.v2.colAction',
    ];
    heads.forEach((key) => {
      expect(screen.getAllByText(key).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('hydrates lazy row cells from E10/R6 and degrades honestly per row', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-employees-table');
    const rows = await screen.findAllByTestId('agent-v2-employee-row');
    expect(rows.length).toBe(2);
    // emp_1 has batched enrichment + lazy stations + lazy runs
    await waitFor(
      () => {
        const cells = screen.getAllByTestId('agent-v2-col-workstation');
        expect(cells[0].textContent).toBe('1 · 1 · 0');
      },
      { timeout: 4000 }
    );
    const versions = screen.getAllByTestId('agent-v2-col-version');
    expect(versions[0].textContent).toContain('v3');
    // emp_2 has no enrichment -> honest dash, never a fake version
    expect(versions[1].textContent).toContain('—');
    expect(versions[1].textContent).toContain('agentConsole.v2.emp.versionUnavailableNote');
    const success = screen.getAllByTestId('agent-v2-col-success');
    expect(success[1].textContent).toBe('—');
    const pendingCounts = screen.getAllByTestId('agent-v2-col-pending');
    expect(pendingCounts[0].textContent).toBe('0');
    // pagination: no nextCursor -> next disabled, prev disabled on page 1
    expect(screen.getByTestId('agent-v2-next-page')).toBeDisabled();
    expect(screen.getByTestId('agent-v2-page-info').textContent).toBe(
      'agentConsole.v2.emp.pageInfo'
    );
  });

  it('maps a 403 employee list to the no-permission state', async () => {
    employeesStatus = 403;
    renderPage();
    await screen.findByTestId('agent-v2-employees-403');
    expect(screen.getByTestId('agent-v2-employees-403').textContent).toContain(
      'agentConsole.v2.emp.noPermission'
    );
  });

  it('maps an empty roster to the empty state, not a fake table', async () => {
    employeesEnriched = false;
    renderPage();
    await screen.findByTestId('agent-v2-employees-empty');
    expect(screen.getByTestId('agent-v2-employees-empty').textContent).toContain(
      'agentConsole.v2.emp.emptyEmployees'
    );
    expect(screen.queryByTestId('agent-v2-employees-table')).toBeNull();
  });

  it('keeps filters honest: lifecycle tabs, disabled extras, create note', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-employees-table');
    expect(screen.getByTestId('agent-v2-filter-active')).toBeTruthy();
    expect(screen.getByTestId('agent-v2-employees-disabled-filters').textContent).toContain(
      'agentConsole.v2.emp.filterDept'
    );
    expect(screen.getByTestId('agent-v2-filter-unavailable-note').textContent).toContain(
      'agentConsole.v2.emp.filterUnavailableNote'
    );
    const create = screen.getByTestId('agent-v2-employees-create');
    expect(create).toBeDisabled();
    expect(screen.getByTestId('agent-v2-employees-create-note').textContent).toContain(
      'agentConsole.v2.emp.createDisabledNote'
    );
  });

  it('renders the platform activity heatmap from R7 cells', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-employees-heat');
    expect(screen.getByTestId('agent-v2-heat-foot').textContent).toContain(
      'agentConsole.v2.emp.heatTzNote'
    );
    expect(screen.getByTestId('agent-v2-employees-heat').textContent).not.toContain('undefined');
  });

  it('EMP-01 C2: sorts the loaded page via clickable headers and records sort in the URL', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-employees-table');
    const rowNames = () =>
      Array.from(
        document.querySelectorAll('[data-testid="agent-v2-employee-row"] td:first-child')
      ).map((td) => td.textContent ?? '');
    expect(rowNames()[0]).toContain('AgentOS Product Assistant');

    // first click: ascending by name -> 'A' < 'I', AgentOS still leads
    fireEvent.click(screen.getByTestId('agent-v2-sort-name'));
    await waitFor(() =>
      expect(decodeURIComponent(screen.getByTestId('route-search').textContent ?? '')).toContain(
        'sort=name:asc'
      )
    );
    const th = screen.getByTestId('agent-v2-sort-name').closest('th');
    expect(th?.getAttribute('aria-sort')).toBe('ascending');
    expect(rowNames()[0]).toContain('AgentOS Product Assistant');

    // second click: descending -> Inspector Two leads
    fireEvent.click(screen.getByTestId('agent-v2-sort-name'));
    await waitFor(() => expect(rowNames()[0]).toContain('Inspector Two'));
    expect(th?.getAttribute('aria-sort')).toBe('descending');
    expect(decodeURIComponent(screen.getByTestId('route-search').textContent ?? '')).toContain(
      'sort=name:desc'
    );

    // third click: sort cleared, service order restored, URL param removed
    fireEvent.click(screen.getByTestId('agent-v2-sort-name'));
    await waitFor(() =>
      expect(screen.getByTestId('route-search').textContent).not.toContain('sort=')
    );
    expect(rowNames()[0]).toContain('AgentOS Product Assistant');
  });

  it('EMP-01 C2: keyset pagination sends the next cursor and keeps state in the URL', async () => {
    employeesNextCursor = 'cur_page2';
    renderPage('/agent/employees?limit=1');
    await screen.findByTestId('agent-v2-employees-table');
    const employeesUrls = () => urls.filter((u) => u.includes('/api/employees'));
    expect(employeesUrls()[0]).toContain('limit=1');
    const next = screen.getByTestId('agent-v2-next-page') as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    await waitFor(() =>
      expect(employeesUrls().some((u) => u.includes('cursor=cur_page2'))).toBe(true)
    );
    expect(screen.getByTestId('route-search').textContent).toContain('cursor=cur_page2');
  });

  // EMP-01 r5 (G15): internal machine codes (console.*, run.*, budget.*,
  // agent.http.*) and the raw requestId must never reach the visible text.
  describe('error copy never carries internal machine codes (G15)', () => {
    const pageText = () =>
      (screen.getByTestId('agent-v2-employees-page').textContent ?? '');

    const assertNoLeak = (codes: string[]) => {
      for (const leak of [...codes, 'agent.http', 'req_test_w2']) {
        expect(pageText()).not.toContain(leak);
      }
    };

    it('403 shows readable no-permission copy; requestId only via copy-diag', async () => {
      employeesStatus = 403;
      renderPage();
      const card = await screen.findByTestId('agent-v2-employees-403');
      expect(card.textContent).toContain('agentConsole.v2.emp.noPermission');
      expect(card.textContent).toContain('agentConsole.v2.emp.forbiddenHint');
      // default state: nothing in the body, no inline requestId
      expect(card.textContent).not.toContain('req_test_w2');
      assertNoLeak(['console.forbidden', 'console.upstream']);
      expect(screen.getByTestId('agent-v2-employees-retry')).toBeInTheDocument();
      // requestId is reachable only through the explicit diagnostic control
      const writeText = vi.fn(async () => {});
      Object.defineProperty(window.navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });
      fireEvent.click(screen.getByTestId('agent-v2-employees-diag'));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('req_test_w2'));
      expect(writeText.mock.calls.flat().join('')).not.toContain('console.forbidden');
    });

    it('401 maps to the session-expired state without leaking console.unauthenticated', async () => {
      employeesStatus = 401;
      renderPage();
      const card = await screen.findByTestId('agent-v2-employees-auth');
      expect(card.textContent).toContain('agentConsole.v2.emp.authExpired');
      expect(card.textContent).toContain('agentConsole.v2.emp.authHint');
      assertNoLeak(['console.unauthenticated']);
      expect(screen.getByTestId('agent-v2-employees-retry')).toBeInTheDocument();
    });

    it('500 list failure keeps a retry and recovers the table when healthy', async () => {
      employeesStatus = 500;
      renderPage();
      const card = await screen.findByTestId('agent-v2-employees-error');
      expect(card.textContent).toContain('agentConsole.v2.errorQuery');
      expect(card.textContent).toContain('agentConsole.v2.ov.blockUnavailable');
      assertNoLeak(['console.upstream']);
      employeesStatus = 200;
      fireEvent.click(screen.getByTestId('agent-v2-employees-retry'));
      await waitFor(() =>
        expect(screen.getByTestId('agent-v2-employees-table')).toBeInTheDocument()
      );
    });

    it('KPI failures show a localized reason and 「—」, never the HTTP status or a machine code', async () => {
      statsFail = true;
      budgetFail = true;
      renderPage();
      await screen.findByTestId('agent-v2-kpi-onduty-error');
      await screen.findByTestId('agent-v2-kpi-cost-error');
      // P0-1: reason-only copy (raw-key suite: the key itself is the text)
      expect(screen.getByTestId('agent-v2-kpi-onduty-error').textContent).toBe(
        'agentConsole.v2.metricsUnavailable'
      );
      expect(screen.getByTestId('agent-v2-kpi-cost-error').textContent).toBe(
        'agentConsole.v2.emp.kpiCostUnavailable'
      );
      // the value line keeps the same shape as the healthy card
      expect(screen.getByTestId('agent-v2-kpi-onduty').textContent).toBe('—');
      expect(screen.getByTestId('agent-v2-kpi-cost').textContent).toBe('—');
      // no HTTP status / no parentheses-code anywhere in the page
      expect(screen.getByTestId('agent-v2-employees-page').textContent).not.toContain('HTTP');
      assertNoLeak(['run.invalid_query', 'budget.range_too_large']);
      // the list itself is healthy — a KPI failure must not fake a page error
      await screen.findByTestId('agent-v2-employees-table');
    });
  });
});

describe('EMP-01 P1 round: disabled visuals, 375 scroll hint, name clipping', () => {
  it('P1-2: create/prev-page are REALLY disabled in the DOM (visual fix only, no functional change)', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-employees-table');
    const create = screen.getByTestId('agent-v2-employees-create') as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(create.getAttribute('disabled')).not.toBeNull();
    expect(create.title).toBe('agentConsole.v2.emp.createDisabledNote');
    // first page → no previous page, and the control is disabled (not just dim)
    const prev = screen.getByText('agentConsole.v2.emp.prevPage') as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    // the visual contract is CSS-side: a disabled .a2-btn must not look clickable
    const css = readFileSync(resolve(process.cwd(), 'src/pages/AgentConsoleV2/agentConsoleV2.css'), 'utf8');
    expect(css).toMatch(/\.a2-btn\[disabled\][^{]*\{[^}]*opacity/);
    expect(css).toMatch(/\.a2-btn\[disabled\][^{]*\{[^}]*cursor:\s*not-allowed/);
  });

  it('P1-3: scroll hint renders only while the wrapper actually overflows (1440 hidden)', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-employees-table');
    const wrap = screen.getByTestId('agent-v2-employees-table-scroll');
    // jsdom measures 0/0 → the table "fits", so no hint is claimed
    expect(screen.queryByTestId('agent-v2-employees-scroll-hint')).toBeNull();
    Object.defineProperty(wrap, 'scrollWidth', { configurable: true, value: 880 });
    Object.defineProperty(wrap, 'clientWidth', { configurable: true, value: 343 });
    fireEvent(window, new Event('resize'));
    expect(await screen.findByTestId('agent-v2-employees-scroll-hint')).toBeInTheDocument();
    Object.defineProperty(wrap, 'scrollWidth', { configurable: true, value: 1270 });
    Object.defineProperty(wrap, 'clientWidth', { configurable: true, value: 1270 });
    fireEvent(window, new Event('resize'));
    await waitFor(() => expect(screen.queryByTestId('agent-v2-employees-scroll-hint')).toBeNull());
  });

  it('OBS: the name cell keeps a readable column and clips instead of breaking per glyph', async () => {
    renderPage();
    await screen.findByTestId('agent-v2-employees-table');
    const cell = screen.getAllByTestId('agent-v2-col-name')[0];
    expect(cell.className).toContain('a2-col-name');
    // full name + title stay reachable as title attributes
    expect(cell.querySelector('[title]')?.getAttribute('title')).toBe(
      'AgentOS Product Assistant'
    );
  });
});
