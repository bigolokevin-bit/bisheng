/* eslint-disable no-restricted-syntax -- fixtures mirror the T2 capture shape; assertions pin the real zh-Hans copy */
/**
 * TSK-02 `/agent/tasks/:taskId` — read-only task detail on the frozen C1
 * baseline (tsk02-target.html + TSK02-TARGET-SPEC.md).
 *
 * Covers the automatable TSK02-E01…E14 keys: T2 wiring + 17-field traversal
 * with 缺席 ≠ null, progressNote three states, human assignee without a
 * stitched name, source.runId → RUN-02, the read-only state machine (zero
 * controls, terminal no-out-edge), statusReason anomaly, relatedTaskIds copy,
 * closedAt terminal-only, the A3 ?taskId= entry, zero write entries, the five
 * screens (400 / 403 / 404 / 500 / normal) and the 375 CSS contract (jsdom
 * cannot measure layout, so the responsive rules are asserted from the
 * stylesheet itself).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

import type { ApiResult } from '@/controllers/API/agent';
import type { AgentConsoleApi } from '@/controllers/API/agent';
import type { AgentConsoleRunsApi } from '@/controllers/API/agentConsoleRuns';
import type {
  AgentConsoleTaskDetailApi,
  TaskDetail,
} from '@/controllers/API/agentConsoleTaskDetail';

import { TaskDetailPage } from '../TaskDetailPage';

// ---------------------------------------------------------------- fixtures

const TASK_ID = 'tk_01M7KQ3F9XW2T8V4N6P0R5S8J2';
const EMP_XIAOLI = 'emp_86A81CE8FF6F42E187BCF2B540';
const TENANT = 't_seakoi_pilot_secret';
const RUN_ID = 'rn_01M7DEY86XMD8J2SJZES4TGPWJ';
const NOW = Date.parse('2026-11-17T10:20:00+08:00');

function makeTask(over: Partial<TaskDetail> = {}): TaskDetail {
  return {
    taskId: TASK_ID,
    tenantId: TENANT,
    title: '核对订单 SO-20261116-0842 的发货时效并回写客户备注',
    description:
      '客户在飞书里问订单 SO-20261116-0842 是否还在承诺时效内。需要核对下单时间、仓库出库时间、承运商揽收时间三段。',
    assignee: { type: 'employee', id: EMP_XIAOLI },
    createdBy: { type: 'human', id: 'u_c7f3d2a91b46' },
    source: {
      channel: 'feishu',
      messageId: 'om_9f4c2b71ae034d95',
      conversationRef: 'oc_b4d1e8a2f6c93057',
      runId: RUN_ID,
    },
    employeeVersionRef: 'ev_7c2a91d4b8f04e63',
    dueAt: '2026-11-18T18:00:00+08:00',
    priority: 'high',
    status: 'in_progress',
    statusReason: null,
    progressNote:
      '时效已核对完：出库到揽收相差 5 小时，仍在承诺 72 小时内。CRM 备注已回写。',
    relatedTaskIds: ['tk_01M7JH52WDQ4R9X1K8N3P6V0TZ', 'tk_01M7KP08M3XE6BQ2R9T4W7Y1ZS3D'],
    createdAt: '2026-11-16T09:12:04+08:00',
    updatedAt: '2026-11-17T10:04:33+08:00',
    ...over,
  };
}

type MockedTaskApi = AgentConsoleTaskDetailApi & { getTaskDetail: Mock };

function okTask(task: TaskDetail): ApiResult<TaskDetail> {
  return { ok: true, status: 200, data: task };
}

function makeApi(result: ApiResult<TaskDetail> = okTask(makeTask())): MockedTaskApi {
  return { getTaskDetail: vi.fn().mockResolvedValue(result) };
}

function makeRunsApi(status: 'completed' | 'failed' | 'running' = 'completed'): AgentConsoleRunsApi {
  return {
    listRuns: vi.fn(),
    listEvents: vi.fn(),
    getRunDetail: vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      data: { runId: RUN_ID, status },
    }),
  } as unknown as AgentConsoleRunsApi;
}

function makeConsoleApi(
  items: Array<{ employeeId: string; name: string }> = [{ employeeId: EMP_XIAOLI, name: '小鲤' }],
): AgentConsoleApi {
  return { listEmployees: vi.fn().mockResolvedValue({ items }) } as unknown as AgentConsoleApi;
}

function renderPage(opts: {
  api?: AgentConsoleTaskDetailApi;
  runsApi?: AgentConsoleRunsApi;
  consoleApi?: AgentConsoleApi;
  taskId?: string;
} = {}) {
  const taskId = opts.taskId ?? TASK_ID;
  return render(
    <MemoryRouter initialEntries={[`/agent/tasks/${taskId}`]}>
      <Routes>
        <Route
          path="/agent/tasks/:taskId"
          element={
            <TaskDetailPage
              api={opts.api ?? makeApi()}
              runsApi={opts.runsApi ?? makeRunsApi()}
              consoleApi={opts.consoleApi ?? makeConsoleApi()}
              nowOverride={NOW}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function waitReady() {
  await screen.findByTestId('agent-v2-task-summary');
  await act(async () => {
    await Promise.resolve();
  });
}

function clip(): Mock {
  return navigator.clipboard.writeText as unknown as Mock;
}

beforeEach(() => {
  window.history.replaceState(null, '', `/agent/tasks/${TASK_ID}`);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------- header / fields

describe('TSK-02 — header, meta row and the 17-field traversal', () => {
  it('E01: the page header carries pill + title + truncated id, with no endpoint text', async () => {
    const api = makeApi();
    renderPage({ api });
    await waitReady();

    expect(api.getTaskDetail).toHaveBeenCalledWith({ id: TASK_ID });
    /* Q2: the endpoint and the T2 phase code are engineering language. */
    expect(screen.getByTestId('agent-v2-task-fresh').textContent).not.toContain('GET /api');
    expect(screen.getByTestId('agent-v2-task-fresh').textContent).not.toContain('T2');
    expect(screen.getByTestId('agent-v2-task-fresh').textContent).toContain('更新于');

    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toContain('核对订单 SO-20261116-0842 的发货时效并回写客户备注');
    expect(h1.textContent).toContain('进行中');
    expect(h1.textContent).not.toContain(TASK_ID);

    const idCell = screen.getByTestId('agent-v2-task-id');
    expect(idCell.textContent).toContain('tk_01M7…S8J2');
    expect(idCell.getAttribute('title')).toBe(TASK_ID);
    fireEvent.click(within(idCell).getByRole('button'));
    expect(clip()).toHaveBeenCalledWith(TASK_ID);

    expect(screen.getByTestId('agent-v2-task-pri-badge').textContent).toContain('高优');
  });

  it('E02/E04: employee assignee resolves a name + EMP-03 link; human creator stays raw', async () => {
    renderPage();
    await waitReady();

    const assignee = screen.getByTestId('agent-v2-task-f-assignee');
    expect(assignee.textContent).toContain('小鲤');
    expect(assignee.textContent).toContain('员工');
    expect(screen.getByTestId('agent-v2-task-assignee-link').getAttribute('href')).toBe(
      `/agent/employees/${EMP_XIAOLI}`,
    );

    const creator = screen.getByTestId('agent-v2-task-f-creator');
    // S2: readable 「用户 #…」 inline; the full raw ref lives in copy/title.
    expect(creator.textContent).toContain('用户 #u_c7f3d2a91b46');
    expect(creator.textContent).not.toContain('human:');
    expect(screen.getByTestId('agent-v2-task-creator-raw').getAttribute('title')).toBe(
      'human:u_c7f3d2a91b46',
    );
    expect(creator.textContent).toContain('人类');
    expect(creator.textContent).toContain('不猜、不拼');
    expect(screen.queryByTestId('agent-v2-task-creator-link')).toBeNull();
  });

  it('E02 → S2: an unknown employee degrades to 「员工 · 短码」, never a bare emp_ id or a fabricated name', async () => {
    renderPage({
      consoleApi: {
        listEmployees: vi.fn().mockRejectedValue(new Error('offline')),
      } as unknown as AgentConsoleApi,
    });
    await waitReady();
    const assignee = screen.getByTestId('agent-v2-task-f-assignee');
    expect(assignee.textContent).toContain('员工 · B540');
    expect(assignee.textContent).not.toContain('emp_');
    expect(assignee.textContent).not.toContain('小鲤');
  });

  it('E02: tenantId never reaches the DOM; due is derived against the page clock', async () => {
    renderPage();
    await waitReady();
    expect(document.body.textContent).not.toContain(TENANT);

    const due = screen.getByTestId('agent-v2-task-f-due');
    expect(due.textContent).toContain('11-18 18:00');
    expect(due.textContent).toContain('剩约 1 天');
    expect(screen.getByTestId('agent-v2-task-f-due').textContent).not.toContain('已逾期');
  });

  it('E10: closedAt only renders for a terminal task', async () => {
    renderPage({ api: makeApi(okTask(makeTask({ status: 'in_progress', closedAt: '2026-11-17T10:00:00+08:00' }))) });
    await waitReady();
    expect(screen.queryByTestId('agent-v2-task-f-closed')).toBeNull();

    cleanup();
    renderPage({
      api: makeApi(
        okTask(
          makeTask({
            status: 'done',
            progressNote: '已完成并发送。',
            closedAt: '2026-11-16T16:20:55+08:00',
          }),
        ),
      ),
    });
    await waitReady();
    expect(screen.getByTestId('agent-v2-task-f-closed').textContent).toContain('11-16 16:20');
  });

  it('E02: absent optional keys render no row (priority, description, related, run)', async () => {
    renderPage({
      api: makeApi(
        okTask(
          makeTask({
            priority: undefined,
            description: undefined,
            relatedTaskIds: undefined,
            source: { channel: 'system', messageId: 'sch_202611_monthly_recalc' },
          }),
        ),
      ),
    });
    await waitReady();
    expect(screen.queryByTestId('agent-v2-task-f-priority')).toBeNull();
    expect(screen.queryByTestId('agent-v2-task-f-desc')).toBeNull();
    expect(screen.queryByTestId('agent-v2-task-related')).toBeNull();
    expect(screen.getByTestId('agent-v2-task-run-empty').textContent).toContain(
      '这个任务没有关联的运行',
    );
  });
});

// ---------------------------------------------------------------- progress / reason

describe('TSK-02 — progressNote three states and statusReason anomaly', () => {
  it('E03: a value is shown verbatim, never summarized', async () => {
    const note = '时效已核对完：出库到揽收相差 5 小时，仍在承诺 72 小时内。';
    renderPage({ api: makeApi(okTask(makeTask({ progressNote: note }))) });
    await waitReady();
    const body = screen.getByTestId('agent-v2-task-progress-body');
    expect(body.textContent).toContain(note);
    expect(body.textContent).toContain('最后状态变更');
    expect(body.textContent).toContain('11-17 10:04');
  });

  it('E03: a null value reads 「—」 + updatedAt (never invented)', async () => {
    renderPage({ api: makeApi(okTask(makeTask({ progressNote: null }))) });
    await waitReady();
    const body = screen.getByTestId('agent-v2-task-progress-body');
    expect(body.textContent).toContain('—');
    expect(body.textContent).toContain('11-17 10:04');
    expect(body.textContent).toContain('不靠模型回忆');
  });

  it('E08/E03: done without a progress note is surfaced as a data anomaly', async () => {
    renderPage({
      api: makeApi(
        okTask(
          makeTask({
            status: 'done',
            progressNote: null,
            closedAt: '2026-11-17T10:04:33+08:00',
          }),
        ),
      ),
    });
    await waitReady();
    expect(screen.getByTestId('agent-v2-task-anomaly-progress').textContent).toContain(
      '未记录进展说明（数据异常）',
    );
    // and it does not pretend there is progress
    expect(screen.getByTestId('agent-v2-task-progress-body').textContent).toContain(
      '—',
    );
  });

  it('E08: a blocked task with a reason renders the reason card in danger tone', async () => {
    renderPage({
      api: makeApi(
        okTask(
          makeTask({
            status: 'blocked',
            statusReason: '等客户提供开票资料，已两次催办未回',
            progressNote: '税号与开票名称已核对无误。',
            dueAt: '2026-11-15T17:30:00+08:00',
          }),
        ),
      ),
    });
    await waitReady();
    const reason = screen.getByTestId('agent-v2-task-reason');
    expect(reason.textContent).toContain('等客户提供开票资料');
    expect(reason.textContent).toContain('受阻超过 72 小时');
    // VG FAIL-1: the contract key stays in the title, never in visible text.
    expect(reason.textContent).not.toContain('status_reason');
    expect(reason.textContent).toContain('受阻原因 · 契约必填');
    expect(reason.querySelector('[title="契约字段 status_reason"]')).not.toBeNull();
    expect(screen.queryByTestId('agent-v2-task-anomaly')).toBeNull();
    expect(screen.getByTestId('agent-v2-task-overdue').textContent).toContain('已逾期 1 天');
  });

  it('E08: blocked/cancelled without a reason shows the anomaly bar, not a blank or a dash', async () => {
    renderPage({
      api: makeApi(
        okTask(
          makeTask({
            status: 'cancelled',
            statusReason: null,
            progressNote: null,
            closedAt: '2026-11-13T11:47:02+08:00',
          }),
        ),
      ),
    });
    await waitReady();
    const bar = screen.getByTestId('agent-v2-task-anomaly');
    expect(bar.textContent).toContain('未记录原因（数据异常）');
    expect(bar.textContent).toContain('不替它编一个原因');
    expect(bar.getAttribute('role')).toBe('status');
    expect(screen.queryByTestId('agent-v2-task-reason')).toBeNull();
  });
});

// ---------------------------------------------------------------- links

describe('TSK-02 — reference links and idempotence ids', () => {
  it('E05: source.runId links to RUN-02 and carries the run status pill', async () => {
    renderPage({ runsApi: makeRunsApi('completed') });
    await waitReady();
    const link = screen.getByTestId('agent-v2-task-run-link');
    expect(link.getAttribute('href')).toBe(`/agent/runs/${RUN_ID}`);
    await waitFor(() =>
      expect(screen.getByTestId('agent-v2-task-run-status').textContent).toContain('已完成'),
    );
    expect(screen.getByTestId('agent-v2-task-run').textContent).toContain('运行完成不等于任务完成');
  });

  it('E09: relatedTaskIds are copyable and jump on the same route (direction never invented)', async () => {
    renderPage();
    await waitReady();
    const card = screen.getByTestId('agent-v2-task-related');
    expect(card.textContent).toContain('2 条');
    // T2 returns a flat id list: no row may claim a parent/child direction.
    const keys = Array.from(card.querySelectorAll('.a2t-k')).map((n) => n.textContent);
    expect(keys).toEqual(['关联任务 1', '关联任务 2']);

    fireEvent.click(within(screen.getByTestId('agent-v2-task-related-id-0')).getByRole('button'));
    expect(clip()).toHaveBeenCalledWith('tk_01M7JH52WDQ4R9X1K8N3P6V0TZ');
    expect(screen.getByTestId('agent-v2-task-related-link-1').getAttribute('href')).toBe(
      '/agent/tasks/tk_01M7KP08M3XE6BQ2R9T4W7Y1ZS3D',
    );
  });

  it('E11: the audit entry filters A3 by taskId', async () => {
    renderPage();
    await waitReady();
    const link = screen.getByTestId('agent-v2-task-audit-link');
    expect(link.getAttribute('href')).toBe(`/agent/audit?taskId=${TASK_ID}`);
    expect(screen.getByTestId('agent-v2-task-audit-filter').textContent).toBe(
      'taskId=tk_01M7…S8J2',
    );
    // no embedded audit table on this page
    expect(screen.queryByTestId('agent-v2-audit-table')).toBeNull();
  });

  it('E09: the message id is copied verbatim, not the truncated display', async () => {
    renderPage();
    await waitReady();
    fireEvent.click(within(screen.getByTestId('agent-v2-task-message-id')).getByRole('button'));
    expect(clip()).toHaveBeenCalledWith('om_9f4c2b71ae034d95');
    expect(screen.getByTestId('agent-v2-task-message-id').textContent).toContain('om_9f4c…4d95');
  });
});

// ---------------------------------------------------------------- state machine

describe('TSK-02 — read-only state machine card', () => {
  it('E06: the card contains zero buttons, links or form controls', async () => {
    renderPage();
    await waitReady();
    const card = screen.getByTestId('agent-v2-task-sm-card');
    expect(card.querySelectorAll('button,a[href],input,select,textarea,[role="button"]').length).toBe(0);
  });

  it('E06/E07: six numbered legal edges + the cancel bypass are stated, not offered', async () => {
    renderPage();
    await waitReady();
    const card = screen.getByTestId('agent-v2-task-sm-card');
    const text = card.textContent ?? '';
    for (const n of ['1', '2', '3', '4', '5', '6', '×']) {
      expect(within(card).getAllByText(n).length).toBeGreaterThan(0);
    }
    expect(text).toContain('待办 → 进行中');
    expect(text).toContain('进行中 → 受阻');
    expect(text).toContain('受阻 → 进行中');
    expect(text).toContain('取消旁路');
    expect(text).toContain('不提供任何操作入口');
    expect(text).toContain('已完成、已取消是终态');
    expect(text).toContain('守卫：完成必须有进展说明；受阻与取消必须写原因');
    expect(screen.getByTestId('agent-v2-task-sm').textContent).toContain(
      '状态机来自任务契约',
    );
  });

  it('E07: terminal states draw no out-edge and never a reopen entry', async () => {
    renderPage({
      api: makeApi(
        okTask(
          makeTask({
            status: 'done',
            progressNote: '已完成并发送。',
            closedAt: '2026-11-16T16:20:55+08:00',
          }),
        ),
      ),
    });
    await waitReady();
    const card = screen.getByTestId('agent-v2-task-sm-card');
    expect(card.textContent).toContain('已完成 → 任何状态');
    expect(card.textContent).toContain('终态没有出边，回退会被拒');
    expect(card.textContent).toContain('已完成不可回退；需要继续做请新建任务并关联');
    expect(card.textContent).not.toContain('重新打开');
    expect(screen.queryByTestId('agent-v2-task-smgraph')).toBeNull();
  });

  it('E07: blocked cannot jump to done — it is stated as rejected, never drawn as a path', async () => {
    renderPage({
      api: makeApi(
        okTask(makeTask({ status: 'blocked', statusReason: '等客户资料' })),
      ),
    });
    await waitReady();
    const card = screen.getByTestId('agent-v2-task-sm-card');
    expect(card.textContent).toContain('受阻 → 已完成');
    expect(card.textContent).toContain('表外流转，会被拒');
    expect(card.querySelectorAll('button,a[href],input,select,textarea').length).toBe(0);
  });
});

// ---------------------------------------------------------------- zero write / states

describe('TSK-02 — zero write entries and the five screens', () => {
  it('E14: no leak words, no total concept, no raw enum in visible text', async () => {
    renderPage();
    await waitReady();
    const text = screen.getByTestId('agent-v2-task-detail').textContent ?? '';
    for (const leak of ['undefined', 'NaN', '[object Object]', 'null', '待接入', '共 ', 'upstream']) {
      expect(text).not.toContain(leak);
    }
    expect(text).not.toContain('in_progress');
    expect(text).not.toContain('statusReason');
    expect(text).not.toContain('feishu');
  });

  it('E12: no write verb exists anywhere — not even a disabled control', async () => {
    renderPage();
    await waitReady();
    const writeVerbs = /重跑|中止|删除|新建|批量|创建|改派|编辑|重新打开/;
    const controls = Array.from(
      document.querySelectorAll('button, a, [role="button"]'),
    ) as HTMLElement[];
    for (const c of controls) {
      expect(c.textContent ?? '').not.toMatch(writeVerbs);
    }
    expect(document.querySelectorAll('input, select, textarea, form').length).toBe(0);
    expect(screen.queryByRole('button', { name: /改派|编辑|迁移|取消任务|标为完成/ })).toBeNull();
    expect(screen.getByTestId('agent-v2-task-detail').textContent).toContain('本页只读');
  });

  it('E13: 403 and 404 share one body, differing only by the status code', async () => {
    const forbidden = { ok: false, status: 403, data: null, code: 'console.forbidden' };
    const notFound = { ok: false, status: 404, data: null, code: 'task.not_found' };

    renderPage({ api: makeApi(forbidden) });
    const a = (await screen.findByTestId('agent-v2-task-forbidden')).textContent ?? '';
    cleanup();

    renderPage({ api: makeApi(notFound) });
    const b = (await screen.findByTestId('agent-v2-task-forbidden')).textContent ?? '';

    expect(a.replace('403', 'NNN')).toBe(b.replace('404', 'NNN'));
    expect(a).toContain('您还看不到这条任务');
    expect(a).not.toContain('task.not_found');
    expect(screen.queryByTestId('agent-v2-task-summary')).toBeNull();
  });

  it('E13: a missing task id renders the 400 stage without calling T2', async () => {
    const api = makeApi();
    render(
      <MemoryRouter>
        <TaskDetailPage api={api} taskIdOverride="" nowOverride={NOW} />
      </MemoryRouter>,
    );
    expect((await screen.findByTestId('agent-v2-task-error')).textContent).toContain(
      '这条链接少了任务编号',
    );
    expect(screen.getByTestId('agent-v2-task-error').textContent).toContain('HTTP 400');
    expect(api.getTaskDetail).not.toHaveBeenCalled();
  });

  it('E13: a 500 stage shows HTTP only, hides upstream codes and cached data', async () => {
    renderPage({
      api: makeApi({ ok: false, status: 500, data: null, code: 'task.upstream_unavailable' }),
    });
    const stage = await screen.findByTestId('agent-v2-task-error');
    expect(stage.textContent).toContain('HTTP 500');
    expect(stage.textContent).toContain('没有展示上一次的缓存数据');
    expect(stage.textContent).not.toContain('task.upstream_unavailable');
  });

  it('E13: loading is a skeleton with no pill, id or timestamp', async () => {
    const pending = new Promise<ApiResult<TaskDetail>>(() => undefined);
    renderPage({ api: { getTaskDetail: vi.fn().mockReturnValue(pending) } });
    const skel = await screen.findByTestId('agent-v2-task-loading');
    expect(skel.textContent).not.toContain(TASK_ID);
    expect(skel.querySelector('.pill')).toBeNull();
    expect(screen.queryByTestId('agent-v2-task-status')).toBeNull();
  });
});

// ---------------------------------------------------------------- css contract

describe('TSK-02 — 375/1440 stylesheet contract', () => {
  it('E14: below 768 the graph is hidden and the edge table carries the same facts', () => {
    const css = readFileSync(
      resolve(__dirname, '..', 'taskDetail.css'),
      'utf8',
    );
    const block = css.slice(css.indexOf('@media (max-width: 767px)'));
    expect(block).toContain('.a2t-smg');
    expect(block).toContain('display: none');
    // 420: key/value rows stack instead of overflowing
    expect(css).toContain('@media (max-width: 419px)');
    expect(css).toContain('flex-direction: column');
  });

  it('E14: no literal color values outside the token block', () => {
    const css = readFileSync(resolve(__dirname, '..', 'taskDetail.css'), 'utf8');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
  });
});