/* eslint-disable no-restricted-syntax -- these cases pin the real zh-Hans copy */
/**
 * RUN-01 pure helpers (./runs01.ts) — the value-shaping rules the page must
 * never break, checked without rendering:
 * ① identities: no `emp_` / `empv_` / `employee:` / `human:` survives, an
 *    unknown employee reads 「员工 · <8 位短码>」, a missing one 「未指派」;
 * ② source: the record's own markers win (case-insensitive, shared words),
 *    unlisted values stay verbatim, and — only means genuinely absent;
 * ③④ honest numbers and an error envelope free of codes, bodies and paths;
 * ⑤ the window↔request coupling and the URL round-trip.
 */
import { describe, expect, it } from 'vitest';

import type { Run } from '@/controllers/API/agentConsoleRuns';

import {
  LIMITS,
  buildColumns,
  columnLabelMap,
  formatCost,
  formatDuration,
  formatMoment,
  rawSourceField,
  readRunsQuery,
  resolveRunSource,
  runEmployeeChipLabel,
  runEmployeeLabel,
  runEmployeeTitle,
  runsErrorView,
  runsForbiddenView,
  runsQueryToSearch,
  shortEmployeeCode,
  sinceIso,
  windowLabel,
} from '../runs01';

const zh = (await import('../../../../public/locales/zh-Hans/bs.json')).default as Record<
  string,
  unknown
>;

const t = (key: string, opts?: Record<string, unknown>): string => {
  const value = key
    .split('.')
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
      zh,
    );
  let text = typeof value === 'string' ? value : key;
  if (opts) {
    for (const [k, v] of Object.entries(opts)) text = text.split(`{{${k}}}`).join(String(v));
  }
  return text;
};

/** A wire row: extras (source/triggerType/…) are allowed by design, the BFF
 *  forwards upstream bodies unmodified. */
function run(over: Record<string, unknown> = {}): Run {
  return {
    runId: 'rn_01M7DF41FG124YHW9PR66CJ7HW',
    tenantId: 't_seakoi_pilot',
    employeeId: 'emp_86A81CE8FF6F42E187BCF2B540',
    employeeVersionNo: 12,
    policySnapshotRef: 'pol_1',
    upstreamRunId: 'up_1',
    channelEventId: null,
    taskId: null,
    previousRunId: null,
    attemptNo: 1,
    status: 'completed',
    startedAt: '2026-11-16T08:52:10+08:00',
    endedAt: '2026-11-16T08:56:42+08:00',
    lastEventSeq: 5,
    createdAt: '2026-11-16T08:52:10+08:00',
    updatedAt: '2026-11-16T08:56:42+08:00',
    ...over,
  } as Run;
}

const HOUR = 3_600_000;

describe('runs01 — URL query (blocker ⑤)', () => {
  it('defaults to 7 days / 20 rows and never trusts an invalid param', () => {
    expect(readRunsQuery('')).toEqual({
      employeeId: '',
      status: '',
      since: '7d',
      limit: 20,
      cursor: null,
    });
    // garbage must never reach the wire — that is how a native 422 is born
    const q = readRunsQuery('?limit=abc&status=bogus&since=99d&cursor=');
    expect(q.limit).toBe(20);
    expect(q.status).toBe('');
    expect(q.since).toBe('7d');
    expect(q.cursor).toBeNull();
  });

  it('reads ?window=24h|7d|30d as the same control as ?since=', () => {
    expect(readRunsQuery('?window=24h').since).toBe('24h');
    expect(readRunsQuery('?window=30d').since).toBe('30d');
    // since wins when both are present, and an unknown alias falls back
    expect(readRunsQuery('?window=24h&since=30d').since).toBe('30d');
    expect(readRunsQuery('?window=bogus').since).toBe('7d');
  });

  it('folds the alias on write, drops cleared filters and keeps foreign markers', () => {
    const search = runsQueryToSearch(
      { employeeId: '', status: '', since: '30d', limit: 50, cursor: null },
      '?window=24h&src=ov',
    );
    const p = new URLSearchParams(search);
    expect(p.get('since')).toBe('30d');
    expect(p.get('limit')).toBe('50');
    expect(p.get('window')).toBeNull();
    expect(p.get('employeeId')).toBeNull();
    expect(p.get('status')).toBeNull();
    expect(p.get('cursor')).toBeNull();
    expect(p.get('src')).toBe('ov');
  });

  it('a URL-restored cursor round-trips', () => {
    const q = readRunsQuery('?cursor=abc123');
    expect(q.cursor).toBe('abc123');
    expect(runsQueryToSearch(q, '')).toContain('cursor=abc123');
  });

  it('computes the ISO start from the window, not from a hardcoded week', () => {
    const now = Date.parse('2026-11-16T12:00:00Z');
    expect(Date.parse(sinceIso('24h', now))).toBe(now - 24 * HOUR);
    expect(Date.parse(sinceIso('7d', now))).toBe(now - 7 * 24 * HOUR);
    expect(Date.parse(sinceIso('30d', now))).toBe(now - 30 * 24 * HOUR);
  });

  it('every window has a distinct rendered range label', () => {
    const labels = (['24h', '7d', '30d'] as const).map((w) => windowLabel(w, t));
    expect(labels).toEqual(['近 24 小时', '近 7 天', '近 30 天']);
    expect(new Set(labels).size).toBe(3);
  });
});

describe('runs01 — readable identities (blocker ①)', () => {
  it.each([
    ['emp_9F42AAE299CD541FBBB68B0E33671', 'B0E33671'],
    ['empv_9F42AAE299CD541FBBB68B0E33672', 'B0E33672'],
    ['employee:9F42AAE299CD541FBBB68B0E33673', 'B0E33673'],
    ['human:u_10001', 'u_10001'],
    ['abc', 'abc'],
  ])('shortens %s to %s with no prefix left', (raw, expected) => {
    expect(shortEmployeeCode(raw)).toBe(expected);
  });

  it('prefers the directory name, then the short code, then 未指派', () => {
    const names = new Map([['emp_86A81CE8FF6F42E187BCF2B540', '小鲤']]);
    expect(runEmployeeLabel('emp_86A81CE8FF6F42E187BCF2B540', names, t)).toBe('小鲤');
    expect(runEmployeeLabel('emp_86A81CE8FF6F42E187BCF2B540', undefined, t)).toBe('员工 · BCF2B540');
    expect(runEmployeeLabel('emp_9F42AAE299CD541FBBB68B0E33671', names, t)).toBe('员工 · B0E33671');
    expect(runEmployeeLabel('', names, t)).toBe('未指派');
    expect(runEmployeeLabel(null, names, t)).toBe('未指派');
    expect(runEmployeeLabel('owner@example.com', names, t)).toBe('未指派');
  });

  it('a human ref reads as a user, never as an employee or a raw ref', () => {
    expect(runEmployeeLabel('human:u_10001', undefined, t)).toBe('用户 #u_10001');
  });

  it('the filter chip names a known employee and never doubles the word', () => {
    const names = new Map([['emp_86A81CE8FF6F42E187BCF2B540', '小鲤']]);
    expect(runEmployeeChipLabel('', names, t)).toBe('员工');
    expect(runEmployeeChipLabel('emp_86A81CE8FF6F42E187BCF2B540', names, t)).toBe('员工：小鲤');
    expect(runEmployeeChipLabel('emp_9F42AAE299CD541FBBB68B0E33671', names, t)).toBe(
      '员工 · B0E33671',
    );
  });

  it('keeps the full raw ref in the cell title and says why when absent', () => {
    expect(runEmployeeTitle('emp_9F42AAE299CD541FBBB68B0E33671', t)).toBe(
      'emp_9F42AAE299CD541FBBB68B0E33671',
    );
    expect(runEmployeeTitle('', t)).toBe('运行记录未携带员工');
  });

  it.each([
    'emp_9F42AAE299CD541FBBB68B0E33671',
    'empv_9F42AAE299CD541FBBB68B0E33672',
    'employee:9F42AAE299CD541FBBB68B0E33673',
    'human:u_10001',
  ])('no visible label of %s matches the forbidden identity pattern', (raw) => {
    expect(runEmployeeLabel(raw, undefined, t)).not.toMatch(/empv?_|employee:|human:/);
  });
});

describe('runs01 — source column (blocker ②)', () => {
  it('reads the four marker names in priority order and ignores non-strings', () => {
    expect(rawSourceField(run())).toBe('');
    expect(rawSourceField(run({ sourceSystem: 'channel' }))).toBe('channel');
    expect(
      rawSourceField(run({ source: 'api', triggerType: 'schedule', sourceSystem: 'channel' })),
    ).toBe('api');
    // a drifted producer costs a word, never a white screen
    expect(rawSourceField(run({ source: { nested: 1 }, trigger: null }))).toBe('');
  });

  it.each([
    ['channel', '渠道'],
    ['CHANNEL', '渠道'],
    ['employee', '员工域'],
    ['runtime', '运行时'],
    ['console', '管理台'],
    ['schedule', '定时'],
    ['CRON', '定时'],
    ['manual', '手动'],
    ['api', '接口调用'],
    ['task', '任务'],
    ['im', '渠道消息'],
    ['webhook', '外部回调'],
  ])('maps %s to the existing Chinese word %s', (raw, label) => {
    expect(resolveRunSource(run({ source: raw }), t).display).toBe(label);
  });

  it('keeps an unlisted marker verbatim instead of inventing a name', () => {
    expect(resolveRunSource(run({ source: 'upstream-thing' }), t).display).toBe('upstream-thing');
  });

  it('turns an identity-shaped marker into a readable identity', () => {
    const view = resolveRunSource(run({ source: 'employee:9F42AAE299CD541FBBB68B0E33673' }), t);
    expect(view.display).toBe('员工 · B0E33673');
    expect(view.display).not.toMatch(/empv?_|employee:|human:/);
    // the raw marker stays available to support through the title
    expect(view.title).toContain('employee:9F42AAE299CD541FBBB68B0E33673');
  });

  it('falls back to the channel message reference and prints no field name', () => {
    const view = resolveRunSource(run({ channelEventId: 'om_x2a9f3c7b8d41c' }), t);
    expect(view.display).toBe('om_x2a…d41c');
    expect(view.title).toBe('渠道消息引用：om_x2a9f3c7b8d41c');
    expect(view.title).not.toContain('channelEventId');
    expect(view.icon).toBe('msg');
  });

  it('shows — only when the record carries nothing, and says so', () => {
    const view = resolveRunSource(run(), t);
    expect(view.display).toBe('—');
    expect(view.title).toBe('运行记录未携带来源，无法判定触发方式');
  });
});

describe('runs01 — honest values (blockers ②③)', () => {
  it('never turns a missing figure into 0 and never rounds a real one', () => {
    expect(formatCost(null)).toBe('—');
    expect(formatCost(undefined)).toBe('—');
    expect(formatCost(0)).toBe('0');
    expect(formatCost(0.009875)).toBe('0.009875');
    expect(formatCost(Number.NaN)).toBe('—');
  });

  it('has no duration without both ends, and none for a negative span', () => {
    expect(formatDuration('2026-11-16T08:52:10+08:00', null)).toBe('—');
    expect(formatDuration(null, '2026-11-16T08:56:42+08:00')).toBe('—');
    expect(formatDuration('2026-11-16T08:56:42+08:00', '2026-11-16T08:52:10+08:00')).toBe('—');
    expect(formatDuration('2026-11-16T08:52:10+08:00', '2026-11-16T08:56:42+08:00')).toBe('4m32s');
    expect(formatDuration('2026-11-16T08:52:10+08:00', '2026-11-16T10:52:10+08:00')).toBe('2h00m');
  });

  it('renders Beijing minutes and never an ISO string or undefined', () => {
    expect(formatMoment('2026-11-16T08:52:10+08:00')).toBe('11-16 08:52');
    expect(formatMoment('2026-11-16T00:52:10Z')).toBe('11-16 08:52');
    expect(formatMoment(null)).toBe('—');
    expect(formatMoment('not-a-date')).toBe('—');
  });

  it('offers the three page sizes with 20 as the first', () => {
    expect(LIMITS).toEqual([20, 50, 100]);
  });
});

describe('runs01 — error envelope (blockers ④⑥)', () => {
  it.each([400, 422, 500, 0])(
    'the %s screen is human copy with no code, path or status digit',
    (status) => {
      const view = runsErrorView(t, status);
      const text = `${view.title} ${view.desc} ${view.retryLabel} ${view.backLabel ?? ''}`;
      expect(text).not.toMatch(/HTTP|\b\d{3}\b|\/api\/|detail|undefined|NaN/i);
      expect(text.length).toBeGreaterThan(10);
      expect(view.reqIdTestId).toBe('agent-v2-runs-error-reqid');
    },
  );

  it('the 400 case gets its own sentence about the missing filter', () => {
    expect(runsErrorView(t, 400).desc).toContain('筛选条件');
    expect(runsErrorView(t, 500).desc).not.toContain('筛选条件');
    expect(runsErrorView(t, 0).desc).toContain('网络错误');
  });

  it('403 and 404 share one identical view (no existence leak)', () => {
    const view = runsForbiddenView(t);
    const text = `${view.title} ${view.desc} ${view.retryLabel}`;
    expect(view.icon).toBe('lock');
    expect(view.backLabel).toBeNull();
    expect(text).not.toMatch(/HTTP|\b40[34]\b|console\.forbidden|\/api\//);
    expect(text).toContain('管理员');
  });
});

describe('runs01 — columns (AC §3 fixed order)', () => {
  it('keeps the ten frozen captions in order and maps them for the row cards', () => {
    expect(buildColumns(t).map((c) => c.label)).toEqual([
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
    const labels = columnLabelMap(t);
    expect(Object.keys(labels)).toEqual([
      'run',
      'employee',
      'status',
      'duration',
      'cost',
      'source',
      'version',
      'start',
      'end',
      'action',
    ]);
    expect(labels.source).toBe('来源');
  });
});
