/* eslint-disable no-restricted-syntax -- fixtures mirror the R5 capture shape; assertions pin the real zh-Hans copy */
/**
 * RUN-01 `/agent/runs` — the target-aligned read-only run list (RunsSection
 * on the shared listkit suite), rendered with the real zh-Hans resources.
 *
 * Covers the C1/C2 assertions that are unit-testable (RUN01-TARGET-SPEC §9):
 * 10 fixed columns, honest value rendering (raw cost / no fabricated
 * duration), filter→request mapping with since always sent, URL query
 * restore, explicit nextCursor consumption, the §7 replay guard (equivalent
 * coverage to EMP-03's stale-cursor test, not a reuse), the five states incl.
 * 400/403/404, and the R2 per-row lazy fill with inline retry.
 *
 * RUNS-01-R2 blocker coverage (this round): no bare identity in any text node
 * (①), the source column bound to the record's own markers (②), every number
 * carrying its basis with no invented aggregate (③), the error envelope
 * reduced to human copy + request id + retry (④), the window control moving
 * the request AND the rendered range (⑤), and the engineering-language scan
 * plus the 403≡404 body equality (⑥).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@/components/bs-ui/message', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('react-i18next', async () => {
  const mod = (await import('../../../../public/locales/zh-Hans/bs.json')) as {
    default: Record<string, unknown>;
  };
  const dict = mod.default;
  const t = (key: unknown, opts?: unknown): string => {
    const value = String(key)
      .split('.')
      .reduce<unknown>(
        (acc, part) =>
          acc && typeof acc === 'object'
            ? (acc as Record<string, unknown>)[part]
            : undefined,
        dict,
      );
    let text = typeof value === 'string' ? value : String(key);
    if (opts && typeof opts === 'object') {
      for (const [k, v] of Object.entries(opts as Record<string, unknown>)) {
        text = text.split(`{{${k}}}`).join(String(v));
      }
    }
    return text;
  };
  return { useTranslation: () => ({ t }) };
});

import { AuthError, type AgentConsoleApi } from '@/controllers/API/agent';
import type {
  AgentConsoleRunsApi,
  Run,
  RunsListResult,
} from '@/controllers/API/agentConsoleRuns';
import type { ApiResult } from '@/controllers/API/agent';

import { RunsSection } from '../RunsSection';

// ---------------------------------------------------------------- fixtures

const EMP_XIAOLI = 'emp_86A81CE8FF6F42E187BCF2B540';
const EMP_XIAOMA = 'emp_5B3C7A9D1E2F4068B5C3D7E9';
/** The QA R2 repro: an employee the directory does not know (unknown filter). */
const EMP_UNKNOWN = 'emp_00000000000000000000qav';

function makeRun(over: Partial<Run> = {}): Run {
  return {
    runId: 'rn_01M7DF41FG124YHW9PR66CJ7HW',
    tenantId: 't_seakoi_pilot',
    employeeId: EMP_XIAOLI,
    employeeVersionNo: 12,
    policySnapshotRef: 'pol_1',
    upstreamRunId: 'up_1',
    channelEventId: 'om_x2a9f3c7b8d41c',
    taskId: null,
    previousRunId: null,
    attemptNo: 1,
    status: 'completed',
    reasonCode: null,
    budgetCapUsd: null,
    costUsd: 0.009875,
    costStatus: 'upstream',
    startedAt: '2026-11-16T08:52:10+08:00',
    endedAt: '2026-11-16T08:56:42+08:00',
    lastEventSeq: 5,
    createdAt: '2026-11-16T08:52:10+08:00',
    updatedAt: '2026-11-16T08:56:42+08:00',
    ...over,
  };
}

const RUN_A = makeRun();
const RUN_B = makeRun({
  runId: 'rn_01M7DEY86XMD8J2SJZES4TGPWJ',
  employeeId: EMP_XIAOMA,
  status: 'failed',
  costUsd: 0.0023,
  costStatus: 'estimated',
  startedAt: '2026-11-15T22:41:12+08:00',
  endedAt: '2026-11-15T22:43:00+08:00',
});

/** The BFF forwards upstream bodies unmodified, so a record can carry
 *  undeclared markers (source / triggerType / …). Tests add them this way. */
function withWire(run: Run, extras: Record<string, unknown>): Run {
  return { ...run, ...extras } as Run;
}

function okPage(items: Run[], nextCursor: string | null = null): ApiResult<RunsListResult> {
  return { ok: true, status: 200, data: { items, nextCursor } };
}

function failPage(status: number, code = 'agent.http.x'): ApiResult<RunsListResult> {
  return { ok: false, status, data: null, code };
}

type MockedRunsApi = AgentConsoleRunsApi & {
  listRuns: Mock;
  listEvents: Mock;
  getRunDetail: Mock;
};

function makeApi(pages: Array<ApiResult<RunsListResult>>): MockedRunsApi {
  const listRuns = vi.fn();
  for (const p of pages) listRuns.mockResolvedValueOnce(p);
  // Any extra call resolves to an empty last page so accidental auto-loads
  // are visible as extra calls rather than hangs.
  listRuns.mockResolvedValue(okPage([], null));
  return {
    listRuns,
    listEvents: vi.fn().mockResolvedValue({ ok: true, status: 200, data: { items: [], nextSeq: null, hasMore: false } }),
    getRunDetail: vi.fn().mockResolvedValue({ ok: false, status: 404, data: null, code: 'agent.http.404' }),
  };
}

const consoleApi = {
  listEmployees: vi.fn().mockResolvedValue({
    items: [
      { employeeId: EMP_XIAOLI, name: '小鲤' },
      { employeeId: EMP_XIAOMA, name: '小码' },
    ],
  }),
} as unknown as AgentConsoleApi;

function renderRuns(api: AgentConsoleRunsApi, initialEmployeeId?: string | null) {
  return render(
    <RunsSection api={api} consoleApi={consoleApi} initialEmployeeId={initialEmployeeId} />,
  );
}

/** Every rendered text node with non-blank content (the honest way to scan
 *  the screen: attributes like title are deliberately excluded). */
function visibleTextNodes(root: Element): string[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: string[] = [];
  let node = walker.nextNode();
  while (node) {
    const text = (node.textContent ?? '').trim();
    if (text) out.push(text);
    node = walker.nextNode();
  }
  return out;
}

/** The whole screen as one visible string, for the language scans. */
function screenText(): string {
  return visibleTextNodes(document.body).join(' ');
}

beforeEach(() => {
  window.history.replaceState(null, '', '/agent/runs');
  (consoleApi.listEmployees as ReturnType<typeof vi.fn>).mockResolvedValue({
    items: [
      { employeeId: EMP_XIAOLI, name: '小鲤' },
      { employeeId: EMP_XIAOMA, name: '小码' },
    ],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/agent/runs');
});

// ---------------------------------------------------------------- tests

describe('RUN-01 runs list — structure & honest values', () => {
  it('renders the 10 columns in the fixed AC §3 order', async () => {
    renderRuns(makeApi([okPage([RUN_A])]));
    await screen.findByTestId('agent-v2-runs-row');
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual(['运行', '员工', '状态', '耗时', '成本（USD）', '来源', '版本', '开始', '结束', '操作']);
  });

  it('truncates runId visually, keeps the full value in title, copies it keyboard-reachably', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderRuns(makeApi([okPage([RUN_A])]));
    const id = await screen.findByTestId('agent-v2-runs-id');
    expect(id.textContent).toContain('rn_01M7…J7HW');
    expect(id.getAttribute('title')).toBe(RUN_A.runId);
    const btn = within(id).getByRole('button', { name: '复制运行 ID' });
    fireEvent.click(btn);
    expect(writeText).toHaveBeenCalledWith(RUN_A.runId);
    expect(id.textContent).toContain('已复制');
  });

  it('degrades an unresolved employee to 「员工 · 8 位短码」 inside the clipped who cell (VG FAIL-1 → S2 → R2 ①)', async () => {
    // E11 has no entry for this employee: the row shows a readable fallback
    // (never a fabricated name, never a bare emp_ id), clipped inside the
    // fixed 112px column with the full raw id kept in the cell title.
    const orphan = makeRun({ employeeId: 'emp_9F42AAE299CD541FBBB68B0E33671' });
    renderRuns(makeApi([okPage([orphan])]));
    const cell = await screen.findByTestId('agent-v2-runs-employee');
    expect(cell.getAttribute('title')).toBe('emp_9F42AAE299CD541FBBB68B0E33671');
    expect(cell.className).toContain('who');
    const nm = cell.querySelector('.nm');
    expect(nm?.textContent).toBe('员工 · B0E33671');
    expect(nm?.textContent).not.toContain('emp_');
    // hard column boundary: the employee td clips, the name span ellipsizes
    expect(cell.closest('td')?.className).toContain('lk-td-who');
  });

  it.each([
    ['emp_9F42AAE299CD541FBBB68B0E33671'],
    ['empv_9F42AAE299CD541FBBB68B0E33672'],
    ['employee:9F42AAE299CD541FBBB68B0E33673'],
    ['human:u_10001'],
  ])('renders %s as a readable identity — no forbidden text node survives (R2 ①)', async (ref) => {
    renderRuns(makeApi([okPage([makeRun({ employeeId: ref })])]));
    const row = await screen.findByTestId('agent-v2-runs-row');
    expect(visibleTextNodes(row).join('\n')).not.toMatch(/empv?_|employee:|human:/);
    expect(row.querySelector('.nm')?.textContent).toBeTruthy();
  });

  it('reads 「未指派」 when the record carries no employee ref at all (R2 ①)', async () => {
    renderRuns(makeApi([okPage([makeRun({ employeeId: '' })])]));
    const cell = await screen.findByTestId('agent-v2-runs-employee');
    expect(cell.querySelector('.nm')?.textContent).toBe('未指派');
    expect(cell.getAttribute('title')).toBe('运行记录未携带员工');
  });

  it('maps all six status enums to dot+text pills with the frozen color mapping', async () => {
    const statuses = ['pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted'] as const;
    const labels = ['排队中', '运行中', '已完成', '失败', '已取消', '已中断'];
    const tones = ['wr', 'wr', 'ok', 'dg', 'dg', 'dg'];
    const rows = statuses.map((s, i) => makeRun({ runId: `rn_01M7STATUS00000000000000${i}X`, status: s }));
    renderRuns(makeApi([okPage(rows)]));
    await screen.findAllByTestId('agent-v2-runs-row');
    const pills = screen.getAllByTestId('agent-v2-runs-status');
    pills.forEach((p, i) => {
      expect(p.textContent).toBe(labels[i]);
      expect(p.className).toContain(tones[i]);
      expect(p.querySelector('.dot')).not.toBeNull();
    });
  });

  it('logs unknown status enums loudly and renders the raw value (never a guessed label)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderRuns(makeApi([okPage([makeRun({ status: 'weird_new_state' as Run['status'] })])]));
    const pill = await screen.findByTestId('agent-v2-runs-status');
    expect(pill.textContent).toBe('weird_new_state');
    expect(spy).toHaveBeenCalledWith('[AgentConsoleV2] unknown run status:', 'weird_new_state');
    spy.mockRestore();
  });

  it('computes duration from endedAt−startedAt and shows — for unfinished runs', async () => {
    renderRuns(
      makeApi([
        okPage([
          RUN_A,
          makeRun({ runId: 'rn_01M7RUNNING0000000000000X', status: 'running', endedAt: null, costUsd: null, costStatus: 'unknown' }),
        ]),
      ]),
    );
    const cells = await screen.findAllByTestId('agent-v2-runs-duration');
    expect(cells[0].textContent).toBe('4m32s');
    // R2 ⑥: the tooltip reads as human time, not as two ISO strings.
    expect(cells[0].getAttribute('title')).toBe('11-16 08:52 → 11-16 08:56');
    expect(cells[1].textContent).toBe('—');
    expect(cells[1].getAttribute('title')).toBe('未结束：不编造耗时');
  });

  it('renders cost verbatim, an unsettled cost as 「未知」, and double-null — (never 0.00, never 0)', async () => {
    renderRuns(
      makeApi([
        okPage([
          RUN_A, // 0.009875 upstream
          RUN_B, // 0.0023 estimated
          makeRun({ runId: 'rn_01M7UNKNOWN0000000000000X', costUsd: null, costStatus: 'unknown' }),
          makeRun({ runId: 'rn_01M7NULLNULL000000000000X', costUsd: null, costStatus: null, status: 'pending', endedAt: null }),
        ]),
      ]),
    );
    const cells = await screen.findAllByTestId('agent-v2-runs-cost');
    expect(cells[0].textContent).toContain('0.009875');
    expect(cells[0].textContent).toContain('上游实测');
    expect(cells[1].textContent).toContain('0.0023');
    expect(cells[1].textContent).toContain('估算');
    // R2 ②: costStatus=unknown reads 「未知」 — the upstream marker stays in
    // the title only; 0 never appears as a stand-in for an absent figure.
    expect(cells[2].textContent).toContain('未知');
    expect(cells[2].textContent).not.toMatch(/unknown/i);
    expect(cells[2].querySelector('.v.unk')?.getAttribute('title')).toContain('不显示 0');
    expect(cells[2].textContent).not.toContain('0');
    expect(cells[3].textContent).toContain('—');
  });

  it('binds the source column to the record’s own markers, not to a guess (R2 ②)', async () => {
    renderRuns(
      makeApi([
        okPage([
          // a labeled source marker wins over the message reference
          withWire(RUN_A, { source: 'channel' }),
          // case-insensitive mapping of the shared words
          withWire(makeRun({ runId: 'rn_01M7EMP00000000000000000X', channelEventId: null }), {
            sourceSystem: 'EMPLOYEE',
          }),
          // run trigger words
          withWire(makeRun({ runId: 'rn_01M7SCHED00000000000000X', channelEventId: null }), {
            triggerType: 'Schedule',
          }),
          // unlisted value stays verbatim (未收录不机翻)
          withWire(makeRun({ runId: 'rn_01M7MYSTERY000000000000X', channelEventId: null }), {
            trigger: 'upstream-thing',
          }),
          // an identity-shaped marker never prints raw
          withWire(makeRun({ runId: 'rn_01M7IDREF00000000000000X', channelEventId: null }), {
            source: 'employee:9F42AAE299CD541FBBB68B0E33673',
          }),
          // no marker at all: the channel reference is the evidence
          makeRun({ runId: 'rn_01M7EVID00000000000000X' }),
          // nothing anywhere: honest —
          makeRun({ runId: 'rn_01M7NOSRC00000000000000X', channelEventId: null }),
        ]),
      ]),
    );
    const cells = await screen.findAllByTestId('agent-v2-runs-source');
    expect(cells[0].textContent).toContain('渠道');
    expect(cells[1].textContent).toContain('员工域');
    expect(cells[1].textContent).not.toMatch(/EMPLOYEE/);
    expect(cells[2].textContent).toContain('定时');
    expect(cells[3].textContent).toContain('upstream-thing');
    expect(cells[4].textContent).toContain('员工 · ');
    expect(cells[4].textContent).not.toMatch(/employee:/);
    expect(cells[5].textContent).toContain('om_x2a…d41c');
    expect(cells[5].querySelector('.src')?.getAttribute('title')).toBe(
      '渠道消息引用：om_x2a9f3c7b8d41c',
    );
    expect(cells[6].textContent).toBe('—');
    expect(cells[6].querySelector('span')?.getAttribute('title')).toBe(
      '运行记录未携带来源，无法判定触发方式',
    );
    // the marker itself stays readable in the tooltip for support
    expect(cells[0].querySelector('.src')?.getAttribute('title')).toContain('channel');
  });

  it('renders version as the raw integer and times as Asia/Shanghai MM-DD HH:mm', async () => {
    renderRuns(makeApi([okPage([RUN_A])]));
    await screen.findByTestId('agent-v2-runs-row');
    expect(screen.getByTestId('agent-v2-runs-version').textContent).toBe('12');
    expect(screen.getByTestId('agent-v2-runs-version').getAttribute('title')).toBe('员工版本号 12');
    expect(screen.getByTestId('agent-v2-runs-start').textContent).toBe('11-16 08:52');
    expect(screen.getByTestId('agent-v2-runs-end').textContent).toBe('11-16 08:56');
    expect(screen.getByTestId('agent-v2-runs-start').getAttribute('title')).toBe(RUN_A.startedAt);
  });

  it('gives every cell its own caption for the ≤767 row cards (D2)', async () => {
    renderRuns(makeApi([okPage([RUN_A])]));
    const row = await screen.findByTestId('agent-v2-runs-row');
    const cells = Array.from(row.querySelectorAll('td'));
    expect(cells).toHaveLength(10);
    expect(cells.map((td) => td.getAttribute('data-l'))).toEqual([
      '运行',
      '员工',
      '状态',
      '耗时',
      '成本（USD）',
      '来源',
      '版本',
      '开始',
      '结束',
      '操作',
    ]);
    // the page-scoped class is what activates ./runs01.css (row cards / slack)
    expect((screen.getByTestId('agent-v2-runs') as HTMLElement).className).toContain('runs01');
  });

  it('S3: 「查看」 really links to RUN-02 and there are zero write entries', async () => {    renderRuns(makeApi([okPage([RUN_A])]));
    const view = await screen.findByTestId('agent-v2-runs-view');
    expect(view.tagName).toBe('A');
    expect(view.getAttribute('href')).toBe(`/agent/runs/${RUN_A.runId}`);
    const writeish = screen
      .getAllByRole('button')
      .filter((b) => /重跑|中止|删除|新建|批量|创建/.test(b.textContent ?? ''));
    expect(writeish).toHaveLength(0);
    expect(document.body.textContent).not.toContain('待接入');
  });

  it('numbers only ever appear with their basis, and never as an invented total (R2 ③)', async () => {
    renderRuns(makeApi([okPage([RUN_A, RUN_B], 'c1')]));
    await screen.findAllByTestId('agent-v2-runs-row');
    const text = screenText();
    expect(text).toContain('本页已加载 2 条');
    expect(text).toContain('本页 2 条');
    expect(text).toContain('每页 20 条');
    // the aggregates this page has no source for are named as absent, not zeroed
    expect(text).toContain('本页没有总数、成功率与平均耗时');
    expect(text).not.toMatch(/共\s*\d+\s*条|显示\s*\d+[–-]\d+/);
  });
});

describe('RUN-01 runs list — filters, URL, cursor', () => {
  it('always sends since (default 7d) and limit 20 on the first request', async () => {
    const api = makeApi([okPage([RUN_A])]);
    renderRuns(api);
    await screen.findByTestId('agent-v2-runs-row');
    const params = api.listRuns.mock.calls[0][0];
    expect(params.limit).toBe(20);
    expect(params.employeeId).toBeUndefined();
    expect(params.status).toBeUndefined();
    const sinceMs = Date.parse(params.since);
    const expected = Date.now() - 7 * 24 * 3600_000;
    expect(Math.abs(sinceMs - expected)).toBeLessThan(60_000);
  });

  it('maps status chips / since seg / limit select to real request params and writes the URL', async () => {
    const api = makeApi([okPage([RUN_A]), okPage([RUN_B]), okPage([]), okPage([])]);
    renderRuns(api);
    await screen.findByTestId('agent-v2-runs-row');

    fireEvent.click(screen.getByTestId('lk-chip-failed'));
    await waitFor(() => expect(api.listRuns).toHaveBeenCalledTimes(2));
    expect(api.listRuns.mock.calls[1][0].status).toBe('failed');
    expect(window.location.search).toContain('status=failed');

    // ⑤: the window control moves the REQUEST and the RENDERED range together.
    fireEvent.click(screen.getByTestId('lk-seg-24h'));
    await waitFor(() => expect(api.listRuns).toHaveBeenCalledTimes(3));
    const sinceMs = Date.parse(api.listRuns.mock.calls[2][0].since);
    expect(Math.abs(sinceMs - (Date.now() - 24 * 3600_000))).toBeLessThan(60_000);
    expect(window.location.search).toContain('since=24h');
    expect(screen.getByTestId('agent-v2-runs-range').textContent).toContain('近 24 小时');
    expect((screen.getByTestId('lk-seg-24h') as HTMLElement).getAttribute('aria-pressed')).toBe('true');

    // limit select: open the listbox popup and pick 50.
    fireEvent.click(screen.getByTestId('agent-v2-runs-filter-limit'));
    fireEvent.click(within(screen.getByTestId('agent-v2-runs-filter-limit-pop')).getByText('每页 50 条'));
    await waitFor(() => expect(api.listRuns).toHaveBeenCalledTimes(4));
    expect(api.listRuns.mock.calls[3][0].limit).toBe(50);
    expect(window.location.search).toContain('limit=50');
  });

  it.each([
    ['24h', 24],
    ['30d', 24 * 30],
  ])('?window=%s deep link drives the request and the screen (⑤, was a dead control)', async (token, hours) => {
    window.history.replaceState(null, '', `/agent/runs?window=${token}`);
    const api = makeApi([okPage([RUN_A])]);
    renderRuns(api);
    await screen.findByTestId('agent-v2-runs-row');
    const sinceMs = Date.parse(api.listRuns.mock.calls[0][0].since);
    expect(Math.abs(sinceMs - (Date.now() - hours * 3600_000))).toBeLessThan(60_000);
    expect(screen.getByTestId('agent-v2-runs-range').textContent).toContain(
      hours === 24 ? '近 24 小时' : '近 30 天',
    );
    expect((screen.getByTestId(`lk-seg-${token}`) as HTMLElement).getAttribute('aria-pressed')).toBe('true');
    // the alias folds into the canonical param immediately, so a shared link
    // can never carry two contradictory ranges
    expect(window.location.search).toContain(`since=${token}`);
    expect(window.location.search).not.toContain('window=');
  });

  it('an unknown window falls back to the 7-day default instead of an unfiltered request', async () => {
    window.history.replaceState(null, '', '/agent/runs?window=bogus');
    const api = makeApi([okPage([RUN_A])]);
    renderRuns(api);
    await screen.findByTestId('agent-v2-runs-row');
    const sinceMs = Date.parse(api.listRuns.mock.calls[0][0].since);
    expect(Math.abs(sinceMs - (Date.now() - 7 * 24 * 3600_000))).toBeLessThan(60_000);
    expect(screen.getByTestId('agent-v2-runs-range').textContent).toContain('近 7 天');
  });

  it('restores all five params from the URL and treats the cursor as a fresh first request', async () => {
    window.history.replaceState(
      null,
      '',
      `/agent/runs?employeeId=${EMP_XIAOLI}&status=failed&since=24h&limit=50&cursor=abc123&src=ov`,
    );
    const api = makeApi([okPage([RUN_B])]);
    renderRuns(api);
    await screen.findByTestId('agent-v2-runs-row');
    expect(api.listRuns.mock.calls[0][0]).toMatchObject({
      employeeId: EMP_XIAOLI,
      status: 'failed',
      limit: 50,
      cursor: 'abc123',
    });
    // foreign marker preserved, not consumed
    expect(window.location.search).toContain('src=ov');
    // employee select shows the resolved name (带值态)
    expect(screen.getByTestId('agent-v2-runs-filter-employee').textContent).toContain('员工：小鲤');
  });

  it('consumes nextCursor explicitly, merges pages, and disables 下一页 on the last page', async () => {
    const api = makeApi([okPage([RUN_A], 'c1'), okPage([RUN_B], null)]);
    renderRuns(api);
    await screen.findByTestId('agent-v2-runs-row');
    const next = screen.getByTestId('lk-next');
    expect(next).not.toBeDisabled();
    fireEvent.click(next);
    await screen.findAllByTestId('agent-v2-runs-row');
    expect(api.listRuns).toHaveBeenCalledTimes(2);
    expect(api.listRuns.mock.calls[1][0].cursor).toBe('c1');
    expect(screen.getAllByTestId('agent-v2-runs-row')).toHaveLength(2);
    expect(window.location.search).toContain('cursor=c1');
    await waitFor(() => expect(screen.getByTestId('lk-next')).toBeDisabled());
    expect(screen.getByTestId('lk-next').getAttribute('title')).toBe('已是最后一页');
  });

  it('replay guard: an overlapping next page stops merging, shows the stale copy, and never auto-requests a third time', async () => {
    // Bad cursor: upstream silently answers with the FIRST page body (200).
    const api = makeApi([okPage([RUN_A, RUN_B], 'bad'), okPage([RUN_A, RUN_B], 'bad')]);
    renderRuns(api);
    await screen.findAllByTestId('agent-v2-runs-row');
    fireEvent.click(screen.getByTestId('lk-next'));
    await screen.findByTestId('lk-stale');
    // ① stopped merging — still exactly the first page's rows
    expect(screen.getAllByTestId('agent-v2-runs-row')).toHaveLength(2);
    // ② localized stale copy on screen
    expect(screen.getByTestId('lk-stale').textContent).toContain('游标已失效，请重试');
    // ③ exactly two requests — no third automatic request
    expect(api.listRuns).toHaveBeenCalledTimes(2);
    // back to page 1 only via the explicit button
    fireEvent.click(screen.getByTestId('lk-reload-first'));
    await waitFor(() => expect(api.listRuns).toHaveBeenCalledTimes(3));
    expect(api.listRuns.mock.calls[2][0].cursor).toBeUndefined();
  });

  it('clears filters back to defaults and re-queries page 1', async () => {
    window.history.replaceState(null, '', `/agent/runs?employeeId=${EMP_XIAOLI}&status=failed`);
    const api = makeApi([okPage([]), okPage([RUN_A])]);
    renderRuns(api);
    await screen.findByTestId('lk-empty');
    const clear = screen.getByTestId('lk-clear');
    expect(clear).not.toBeDisabled();
    fireEvent.click(clear);
    await screen.findByTestId('agent-v2-runs-row');
    expect(api.listRuns.mock.calls[1][0].employeeId).toBeUndefined();
    expect(api.listRuns.mock.calls[1][0].status).toBeUndefined();
    expect(window.location.search).not.toContain('employeeId=');
    expect(window.location.search).not.toContain('status=');
  });
});

describe('RUN-01 runs list — five states', () => {
  it('shows the static skeleton with the honesty note while loading', async () => {
    const api = makeApi([]);
    api.listRuns.mockReturnValue(new Promise(() => undefined));
    renderRuns(api);
    expect(screen.getByTestId('lk-skeleton')).toBeTruthy();
    expect(document.body.textContent).toContain('首次加载不设固定超时假上限');
    // let the E11 candidates promise settle inside act (no post-test update)
    await waitFor(() => expect(consoleApi.listEmployees).toHaveBeenCalled());
  });

  it('empty with filters keeps the filter bar and offers 清空筛选条件', async () => {
    window.history.replaceState(null, '', `/agent/runs?employeeId=${EMP_XIAOLI}&status=failed`);
    renderRuns(makeApi([okPage([])]));
    await screen.findByTestId('lk-empty');
    expect(screen.getByTestId('lk-filterbar')).toBeTruthy();
    expect(screen.getByTestId('lk-empty').textContent).toContain('暂无运行');
    expect(screen.getByTestId('lk-empty').textContent).toContain('小鲤 · 失败 · 近 7 天');
    expect(screen.getByTestId('lk-loaded').textContent).toContain('0');
    expect(screen.getByTestId('lk-empty-action').textContent).toBe('清空筛选条件');
  });

  it('empty without filters uses the plain copy and no action', async () => {
    renderRuns(makeApi([okPage([])]));
    await screen.findByTestId('lk-empty');
    expect(screen.getByTestId('lk-empty').textContent).toContain('数字员工开始执行后');
    expect(screen.queryByTestId('lk-empty-action')).toBeNull();
  });

  it('400 missing-filter renders its own human copy — no machine code, no HTTP status (④)', async () => {
    renderRuns(makeApi([failPage(400, 'request.missing_filter')]));
    await screen.findByTestId('agent-v2-runs-error');
    const text = screenText();
    expect(text).toContain('请求缺少必需的筛选条件');
    expect(text).not.toContain('request.missing_filter');
    expect(text).not.toMatch(/HTTP\s*\d{3}|\b400\b/);
    expect(screen.getByTestId('agent-v2-runs-retry')).toBeTruthy();
    expect(screen.getByTestId('agent-v2-runs-error-reqid').textContent).toContain('未提供');
  });

  it('5xx renders human copy + request id + retry, and never the response body (④)', async () => {
    renderRuns(
      makeApi([
        {
          ok: false,
          status: 500,
          data: null,
          code: 'runtime.internal',
          message: '{"detail":[{"loc":["query","limit"],"msg":"value is not a valid integer"}]}',
          requestId: 'rid-page-abc',
        },
      ]),
    );
    await screen.findByTestId('agent-v2-runs-error');
    const text = screenText();
    expect(text).toContain('运行列表没能加载出来');
    expect(text).toContain('没有展示上一次的缓存数据');
    expect(screen.getByTestId('agent-v2-runs-error-reqid').textContent).toContain('rid-page-abc');
    expect(screen.getByTestId('agent-v2-runs-retry')).toBeTruthy();
    // no native 422/500 body, no internal code, no bare status, no path echo
    expect(text).not.toContain('value is not a valid integer');
    expect(text).not.toContain('runtime.internal');
    expect(text).not.toMatch(/HTTP\s*\d{3}|\b500\b|detail|\/api\/runs/);
    expect(screen.getByText('先回总览看看')).toBeTruthy();
  });

  it.each([403, 404])('%i renders the forbidden body with human copy + request id (⑥)', async (code) => {
    renderRuns(makeApi([failPage(code, 'console.forbidden')]));
    await screen.findByTestId('agent-v2-runs-forbidden');
    const text = screenText();
    expect(text).toContain('您还看不到运行列表');
    expect(text).toContain('当前账号没有开通「运行」模块的查看权限');
    expect(text).not.toContain('console.forbidden');
    expect(text).not.toMatch(/HTTP\s*\d{3}|\b40[34]\b/);
    expect(screen.queryByTestId('agent-v2-runs-row')).toBeNull();
    expect(screen.getByTestId('agent-v2-runs-forbidden-retry')).toBeTruthy();
    expect(screen.getByTestId('agent-v2-runs-forbidden-reqid')).toBeTruthy();
  });

  it('403 and 404 produce byte-identical screens — the body cannot leak existence (⑥)', async () => {
    const bodies: string[] = [];
    for (const code of [403, 404]) {
      const { unmount } = renderRuns(makeApi([failPage(code, 'console.forbidden')]));
      await screen.findByTestId('agent-v2-runs-forbidden');
      bodies.push(document.body.textContent ?? '');
      unmount();
    }
    expect(bodies[0]).toBe(bodies[1]);
  });

  it('the whole screen stays free of engineering language (⑥)', async () => {
    renderRuns(
      makeApi([
        okPage([
          makeRun({ employeeId: EMP_UNKNOWN, costUsd: null, costStatus: 'unknown' }),
          makeRun({
            runId: 'rn_01M7NOSRC00000000000000X',
            employeeId: EMP_UNKNOWN,
            channelEventId: null,
            employeeVersionNo: null as unknown as number,
          }),
        ], 'c1'),
      ]),
    );
    await screen.findAllByTestId('agent-v2-runs-row');
    const text = screenText();
    // internal ids, field names, contract codes, endpoint paths, run tokens
    expect(text).not.toMatch(/empv?_|employee:|human:/);
    expect(text).not.toMatch(/channelEventId|costStatus|employeeVersionNo|policySnapshotRef|nextCursor|undefined|NaN|\[object Object\]/i);
    expect(text).not.toMatch(/\bR5\b|\bR2\b|RUN-02|GET \/|\/api\//);
    expect(text).not.toMatch(/HTTP\s*\d{3}/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}/); // no raw ISO on screen
    // the employee chip reads the short-code form, never the raw ref
    expect(screen.getByTestId('agent-v2-runs-filter-employee').textContent).not.toContain(EMP_UNKNOWN);
  });

  it('the empty state names an unresolved filter as 「员工 · 短码」, not the raw ref (②)', async () => {
    window.history.replaceState(null, '', `/agent/runs?employeeId=${EMP_UNKNOWN}&status=failed`);
    renderRuns(makeApi([okPage([])]));
    await screen.findByTestId('lk-empty');
    const text = screenText();
    expect(text).not.toContain(EMP_UNKNOWN);
    expect(text).toContain('员工 · 00000qav');
    expect(text).toContain('失败 · 近 7 天');
  });

  it('401 redirects to login instead of rendering an in-page state', async () => {
    const assign = vi.fn();
    const original = window.location;
    // jsdom location is not navigable; swap in a stub carrying the parts the
    // section reads (search/pathname) plus the assign spy.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, search: '', pathname: '/agent/runs', assign },
    });
    try {
      const api = makeApi([]);
      api.listRuns.mockRejectedValue(new AuthError());
      renderRuns(api);
      await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});

describe('RUN-01 runs list — R2 per-row lazy fill', () => {
  it('lazily fills nullable columns of terminal runs only, one row at a time', async () => {
    const terminalMissing = makeRun({
      runId: 'rn_01M7MISSING0000000000000X',
      costUsd: null,
      costStatus: null,
    });
    const runningMissing = makeRun({
      runId: 'rn_01M7RUNNING0000000000000X',
      status: 'running',
      endedAt: null,
      costUsd: null,
      costStatus: null,
    });
    const api = makeApi([okPage([terminalMissing, runningMissing])]);
    (api.getRunDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      data: makeRun({ runId: terminalMissing.runId, costUsd: 0.03125, costStatus: 'upstream' }),
    });
    renderRuns(api);
    await screen.findAllByTestId('agent-v2-runs-row');
    await waitFor(() => expect(api.getRunDetail).toHaveBeenCalledTimes(1));
    expect(api.getRunDetail).toHaveBeenCalledWith({ id: terminalMissing.runId });
    await waitFor(() => {
      const cells = screen.getAllByTestId('agent-v2-runs-cost');
      expect(cells[0].textContent).toContain('0.03125');
      expect(cells[0].textContent).toContain('上游实测');
    });
    // the running row keeps — without any fabricated fill request
    expect(screen.getAllByTestId('agent-v2-runs-cost')[1].textContent).toContain('—');
  });

  it('keeps —/unknown on a failed fill and offers an inline per-row retry', async () => {
    const missing = makeRun({ runId: 'rn_01M7MISSING0000000000000X', costUsd: null, costStatus: null });
    const api = makeApi([okPage([missing])]);
    const detail = api.getRunDetail as ReturnType<typeof vi.fn>;
    detail.mockResolvedValueOnce({ ok: false, status: 500, data: null, code: 'runtime.internal' });
    renderRuns(api);
    const retry = await screen.findByTestId('agent-v2-runs-fill-retry');
    expect(screen.getByTestId('agent-v2-runs-cost').textContent).toContain('—');
    detail.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: makeRun({ runId: missing.runId, costUsd: 0.0041, costStatus: 'estimated' }),
    });
    fireEvent.click(retry);
    await waitFor(() => {
      expect(screen.getByTestId('agent-v2-runs-cost').textContent).toContain('0.0041');
      expect(screen.getByTestId('agent-v2-runs-cost').textContent).toContain('估算');
    });
    expect(detail).toHaveBeenCalledTimes(2);
  });
});