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
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

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

function routeRequest(url: string) {
  urls.push(url);
  if (url.includes('/api/employees')) {
    if (employeesStatus !== 200) {
      return jsonResponse(employeesStatus, {
        code: employeesStatus === 403 ? 'console.forbidden' : 'console.upstream',
        message: 'stubbed failure',
      });
    }
    return jsonResponse(200, {
      ...employeesBody(employeesEnriched),
      ...(employeesNextCursor ? { nextCursor: employeesNextCursor } : {}),
    });
  }
  if (url.includes('/api/employee-stats')) return jsonResponse(200, statsBody);
  if (url.includes('/api/approval-stats')) return jsonResponse(200, { pending: 3, dueSoon: 1 });
  if (url.includes('/api/budget-usage')) {
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
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/agent/employees" element={<EmployeesListPage />} />
      </Routes>
      <RouteSearchProbe />
    </MemoryRouter>
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
});
