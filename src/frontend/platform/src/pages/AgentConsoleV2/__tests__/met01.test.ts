/* eslint-disable no-restricted-syntax -- assertions intentionally use the
 * pinned CSV schema literals (file-format content, identical in every locale)
 * and the localized copy under test. */
/**
 * MET-01 pure-helper tests (met01.ts) — the honest-data rules pinned by
 * MET01-TARGET-SPEC.md §1.4/§2/§7: null never becomes 0, money only from
 * the ledger, A0 verdict reads state fields only, heat levels use the
 * SERVER max with ceil(count÷max×5), error triage is by CODE not text,
 * and the CSV schema writes empty strings (never 0) for missing values.
 */
import { describe, expect, it } from 'vitest';

import {
  a0Verdict,
  allSourcesDegraded,
  beijingDayIso,
  beijingDayStartIso,
  buildHeat,
  buildMetricsCsv,
  cellSinceIso,
  errorFamily,
  exportFileName,
  fmtCompact,
  fmtInt,
  fmtP95,
  fmtUptime,
  fmtUsd2,
  heartbeatStale,
  heatLevel,
  MET_THRESHOLDS,
  percentTone,
  p95Tone,
  reasonKey,
} from '../met01';
import type { HermesSummary } from '@/controllers/API/agentConsoleHermes';

function summary(overrides: Partial<HermesSummary> = {}): HermesSummary {
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
      updated_at: '2026-11-16T01:38:12Z',
      platforms: {},
      metrics_today: { day: '2026-11-16', requests: 1284, messages: 3406, tokens: 1243862, latency_p95_ms: 800 },
      note: '',
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
    sessions_stats: { total: 312, active_store: 28, archived: 284, messages: 4106, by_source: { feishu: 256 } },
    ...overrides,
  } as HermesSummary;
}

describe('MET-01 formatting — null never becomes 0', () => {
  it('fmtInt / fmtCompact / fmtP95 render — for null/undefined/NaN', () => {
    for (const f of [fmtInt, fmtCompact, fmtP95]) {
      expect(f(null)).toBe('—');
      expect(f(undefined)).toBe('—');
      expect(f(Number.NaN)).toBe('—');
    }
    expect(fmtInt(1284)).toBe('1,284');
    expect(fmtCompact(1243862)).toBe('1.24M');
    expect(fmtCompact(12438620)).toBe('12.4M');
    expect(fmtCompact(640220)).toBe('640k');
    expect(fmtCompact(9204118)).toBe('9.2M');
    expect(fmtP95(800)).toBe('0.8s');
  });

  it('fmtUsd2 returns null for missing money (caller renders 未计价, never 0.00)', () => {
    expect(fmtUsd2(null)).toBeNull();
    expect(fmtUsd2(undefined)).toBeNull();
    expect(fmtUsd2(0.11)).toBe('0.11');
    expect(fmtUsd2(0)).toBe('0.00'); // a REAL ledger zero is still a priced value
  });

  it('fmtUptime: 3d04h / 04h12m / 12m, — for null', () => {
    expect(fmtUptime(3 * 86400 + 4 * 3600)).toBe('3d04h');
    expect(fmtUptime(4 * 3600 + 12 * 60)).toBe('04h12m');
    expect(fmtUptime(12 * 60)).toBe('12m');
    expect(fmtUptime(null)).toBe('—');
  });

  it('percentTone / p95Tone follow the frozen threshold bands', () => {
    expect(percentTone(69.9, MET_THRESHOLDS.cpuMem)).toBe('');
    expect(percentTone(70, MET_THRESHOLDS.cpuMem)).toBe('wr');
    expect(percentTone(85, MET_THRESHOLDS.cpuMem)).toBe('dg');
    expect(percentTone(78.2, MET_THRESHOLDS.disk)).toBe('wr');
    expect(percentTone(90, MET_THRESHOLDS.disk)).toBe('dg');
    expect(percentTone(null, MET_THRESHOLDS.disk)).toBe('');
    expect(p95Tone(800)).toBe('ok');
    expect(p95Tone(2000)).toBe('wr');
    expect(p95Tone(5000)).toBe('dg');
    expect(p95Tone(null)).toBe('');
  });

  it('heartbeatStale: >10min warns, missing never warns', () => {
    const now = new Date('2026-11-16T02:00:00Z');
    expect(heartbeatStale('2026-11-16T01:38:12Z', now)).toBe(true);
    expect(heartbeatStale('2026-11-16T01:55:00Z', now)).toBe(false);
    expect(heartbeatStale(null, now)).toBe(false);
  });
});

describe('MET-01 A0 verdict — state fields only, never inferred', () => {
  it('three ok + running → ok', () => {
    expect(a0Verdict(summary())).toEqual({ level: 'ok', configIncomplete: false });
  });
  it('any degraded → wr; config reasons append 配置未完成', () => {
    const s = summary();
    s.sources.dashboard_system = { state: 'degraded', reason: 'timeout' };
    expect(a0Verdict(s)).toEqual({ level: 'wr', configIncomplete: false });
    s.sources.dashboard_system = { state: 'degraded', reason: 'token_unconfigured' };
    expect(a0Verdict(s)).toEqual({ level: 'wr', configIncomplete: true });
  });
  it('gateway down/stopped/failed → dg even with ok sources', () => {
    const s = summary();
    s.gateway.gateway_state = 'stopped';
    expect(a0Verdict(s).level).toBe('dg');
  });
  it('all degraded with http_5xx/unreachable → dg', () => {
    const s = summary();
    s.sources.gateway_health = { state: 'degraded', reason: 'unreachable' };
    s.sources.dashboard_system = { state: 'degraded', reason: 'unreachable' };
    s.sources.dashboard_sessions_stats = { state: 'degraded', reason: 'unreachable' };
    expect(a0Verdict(s).level).toBe('dg');
    expect(allSourcesDegraded(s)).toBe(true);
  });
  it('missing/unknown sources → nt (never yellow pretending)', () => {
    expect(a0Verdict(null).level).toBe('nt');
    const s = summary();
    delete s.sources.dashboard_system;
    expect(a0Verdict(s).level).toBe('nt');
    const s2 = summary();
    s2.gateway.gateway_state = 'draining';
    expect(a0Verdict(s2).level).toBe('nt');
  });
  it('reasonKey maps known reasons and falls back to generic', () => {
    expect(reasonKey('timeout')).toBe('agentConsole.v2.met.reasonTimeout');
    expect(reasonKey('something_else')).toBe('agentConsole.v2.met.reasonGeneric');
    expect(reasonKey(undefined)).toBe('agentConsole.v2.met.reasonGeneric');
  });
});

describe('MET-01 heat math — server aggregates only', () => {
  const cells = [
    { dow: 3, hour: 14, count: 42 },
    { dow: 1, hour: 14, count: 20 },
    { dow: 2, hour: 14, count: 18 },
    { dow: 4, hour: 14, count: 20 },
    { dow: 1, hour: 2, count: 10 },
    { dow: 2, hour: 3, count: 10 },
  ];

  it('buildHeat: total, server max precedence, peak hour share, night average', () => {
    const m = buildHeat(cells, 42);
    expect(m.total).toBe(120);
    expect(m.max).toBe(42);
    expect(m.peak).toEqual({ dow: 3, hour: 14, count: 42 });
    // peak HOUR = 42+20+18+20 = 100 → 100/120
    expect(m.peakHourShare).toBeCloseTo(100 / 120, 6);
    // night = 10+10 = 20 → 20/56
    expect(m.nightAvg).toBeCloseTo(20 / 56, 6);
    // server max wins over cells max
    expect(buildHeat(cells, 100).max).toBe(100);
    // absent/zero server max falls back to the cells' own max
    expect(buildHeat(cells, 0).max).toBe(42);
    expect(buildHeat(cells, null).max).toBe(42);
  });

  it('invalid cells are dropped, never fabricated; empty → max 0', () => {
    const m = buildHeat([{ dow: 0, hour: 5, count: 9 }, { dow: 8, hour: 1, count: 9 }, { dow: 1, hour: 24, count: 9 }, { dow: 1, hour: 1, count: Number.NaN }], 5);
    expect(m.total).toBe(0);
    expect(m.map.size).toBe(0);
    expect(buildHeat([], 0).max).toBe(0);
    expect(buildHeat(null).peak).toBeNull();
  });

  it('heatLevel: ceil(count÷max×5) clamped 1..5; zero/max0 → 0', () => {
    expect(heatLevel(0, 42)).toBe(0);
    expect(heatLevel(1, 42)).toBe(1);
    expect(heatLevel(9, 42)).toBe(2); // ceil(9/42*5)=ceil(1.07)=2
    expect(heatLevel(42, 42)).toBe(5);
    expect(heatLevel(100, 42)).toBe(5);
    expect(heatLevel(5, 0)).toBe(0);
  });

  it('cellSinceIso: most recent Beijing weekday+hour at or before now', () => {
    // 2026-11-16 is a Monday; 09:40 Beijing = 01:40 UTC.
    const now = new Date('2026-11-16T01:40:00Z');
    // Monday 09:00 Beijing today → 2026-11-16T01:00:00Z
    expect(cellSinceIso(1, 9, now)).toBe('2026-11-16T01:00:00.000Z');
    // Monday 14:00 is still ahead today → last Monday (11-09)
    expect(cellSinceIso(1, 14, now)).toBe('2026-11-09T06:00:00.000Z');
    // Wednesday 14:00 → 2026-11-11 14:00 Beijing = 06:00 UTC
    expect(cellSinceIso(3, 14, now)).toBe('2026-11-11T06:00:00.000Z');
    // Sunday 23:00 → 2026-11-15 23:00 Beijing = 15:00 UTC
    expect(cellSinceIso(7, 23, now)).toBe('2026-11-15T15:00:00.000Z');
  });

  it('Beijing day helpers cut the day at +08:00', () => {
    const now = new Date('2026-11-15T17:30:00Z'); // 11-16 01:30 Beijing
    expect(beijingDayIso(now)).toBe('2026-11-16');
    expect(beijingDayStartIso(now)).toBe('2026-11-15T16:00:00.000Z');
  });
});

describe('MET-01 error triage — by CODE, never by text (SPEC §2)', () => {
  it.each([
    [401, 'console.unauthenticated', 'login'],
    [401, 'request.invalid_token', 'upstreamToken'],
    [401, 'whatever.else', 'generic'],
    [403, 'console.forbidden', 'forbidden'],
    [403, 'runtime.internal_only', 'internalOnly'],
    [503, 'runtime.metrics_unconfigured', 'unconfigured'],
    [503, 'runtime.gateway_key_unconfigured', 'unconfigured'],
    [503, 'something.else', 'generic'],
    [502, 'upstream.unavailable', 'upstreamUnavailable'],
    [422, 'request.invalid_query', 'invalidQuery'],
    [404, 'anything', 'notFound'],
    [500, 'upstream.blip', 'generic'],
  ] as const)('%i + %s → %s', (status, code, family) => {
    expect(errorFamily(status, code)).toBe(family);
  });
});

describe('MET-01 CSV export — fixed schema, empty never 0 (SPEC §7.1)', () => {
  const fetched = { summary: '2026-11-16T01:40:00Z', usage: '2026-11-16T01:40:00Z', heat: '2026-11-16T01:40:00Z' };

  it('first/last comment markers and the pinned header', () => {
    const csv = buildMetricsCsv({ summary: null, usage: null, heat: null, days: 7, fetched });
    const lines = csv.split('\n');
    expect(lines[0]).toBe('# seakoi console metrics export v1');
    expect(lines[1]).toBe('section,metric,value,unit,caliber,source_state,window,fetched_at');
    expect(lines[lines.length - 1]).toBe('# 口径：数量来自 Hermes，金额来自本租户账本，不可换算');
  });

  it('degraded/null values write empty strings, never 0; unknown money stays unpriced', () => {
    const s = summary();
    s.sources.dashboard_system = { state: 'degraded', reason: 'timeout' };
    s.system.cpu_percent = null;
    const csv = buildMetricsCsv({
      summary: s,
      usage: {
        schema: 'runtime.hermes.usage.v1',
        period_days: 7,
        sources: { dashboard_usage: { state: 'ok' } },
        tokens: { total_input: 12438620, total_output: null, total_cache_read: null, total_reasoning: null },
        by_model: [],
        cost: { source: 'cost_ledger', cost_usd: null, cost_status: 'unknown', rows: 0, per_employee: [] },
        attribution: { state: 'ok', mapped_sessions: 168, unattributed: { sessions: 32 } },
      },
      heat: buildHeat([], 0),
      days: 7,
      fetched,
    });
    const cpu = csv.split('\n').find((l) => l.includes('system.cpu_percent'));
    expect(cpu).toBeDefined();
    expect(cpu!.split(',')[2]).toBe(''); // value empty, NOT 0
    expect(cpu).toContain('degraded');
    const money = csv.split('\n').find((l) => l.includes('cost.cost_usd'));
    expect(money!.split(',')[2]).toBe('');
    expect(csv).not.toMatch(/,0\.00,/);
    // heat max=0/total=0 → empty values, not fabricated zeroes
    const heatMax = csv.split('\n').find((l) => l.includes('activity.max'));
    expect(heatMax!.split(',')[2]).toBe('');
  });

  it('exportFileName: metrics-YYYYMMDD-HHmm.csv in Beijing time', () => {
    expect(exportFileName(new Date('2026-11-16T01:40:00Z'))).toBe('metrics-20261116-0940.csv');
  });
});