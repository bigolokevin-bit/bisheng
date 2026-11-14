/**
 * L4 console v2 P0-14 (l4-hermes-panels): the 「运行指标」 section.
 *
 * Three independently-loaded blocks (design.md §3):
 * - 运行健康: runtime.hermes.summary.v1 — three source rows (gateway /
 *   system / sessions_stats), each headed by its own `sources.<name>.state`
 *   chip: ok → 正常, degraded → 「降级（reason）」 with the value area as
 *   「暂不可用」 (never 0). A failed request (401/403/503) turns the whole
 *   block into 「服务指标暂不可用」 and shows the returned code verbatim.
 *   `gateway.note` (当日计数、重启归零) is rendered verbatim; nulls render
 *   「—」.
 * - 模型与工具用量: runtime.hermes.usage.v1 with a 7/30-day toggle (default
 *   7). Token totals + `by_model` table (null/empty → empty state). Money
 *   reads ONLY the cost block: `cost_usd:null` or `cost_status:"unknown"` →
 *   「未计价」, never 0.00; `per_employee` rows listed as returned;
 *   `attribution.unattributed` gets its own 「未归属」 list; degraded
 *   attribution → chip + 「归属暂不可用」. The tool/skill breakdown does not
 *   exist on this endpoint, so an explicit caliber line states that instead
 *   of drawing a fake table.
 * - 活动热力: platform side = real R7 7×24 heat via the existing trends
 *   adapter (`getRunActivity({weeks:4, tz:'Asia/Shanghai'})`, same fetch and
 *   level math as TrendsCostsSection); Hermes side = `gateway.metrics_today`
 *   day counters as a side column with an explicit caliber note (进程当日
 *   计数、重启归零 vs 平台周矩阵). Missing activity data → empty state only,
 *   never a fake matrix.
 *
 * Honest-data rules: nothing is 0-filled, nothing is estimated, no Hermes
 * Dashboard iframe/embedding, read-only (no write affordances). Every block
 * keeps its own Box loading/error state with the returned code. Layout uses
 * fraction tracks (minmax(0,1fr)) only so 375px and 1440px stay free of
 * horizontal overflow.
 */
import { useEffect, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { AuthError } from '@/controllers/API/agent';
import {
  dayIndexOf,
  type AgentConsoleTrendsApi,
  type RunActivityCell,
} from '@/controllers/API/agentConsoleTrends';
import {
  type AgentConsoleHermesApi,
  type HermesCostStatus,
  type HermesSource,
  type HermesSummary,
  type HermesUsage,
} from '@/controllers/API/agentConsoleHermes';

type Box<T> =
  | { phase: 'loading' }
  | { phase: 'ok'; value: T }
  | { phase: 'error'; code: string | null };

const boxLoading = { phase: 'loading' } as const;

const DAY_ORDER = [
  'agentConsole.v2.daySun',
  'agentConsole.v2.dayMon',
  'agentConsole.v2.dayTue',
  'agentConsole.v2.dayWed',
  'agentConsole.v2.dayThu',
  'agentConsole.v2.dayFri',
  'agentConsole.v2.daySat',
] as const;

/** Reuses the frozen runs cost-status keys where the semantics match. */
const COST_STATUS_PILL: Record<HermesCostStatus, { key: string; cls: string }> = {
  upstream: { key: 'agentConsole.v2.runsCostUpstream', cls: 'is-ok' },
  estimated: { key: 'agentConsole.v2.runsCostEstimated', cls: 'is-warn' },
  mixed: { key: 'agentConsole.v2.metricsCostMixed', cls: 'is-warn' },
  unknown: { key: 'agentConsole.v2.metricsNotPriced', cls: 'is-warn' },
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Error codes: envelope code when present; thrown AuthError is the 401
 *  case of the same idiom; network failures carry no upstream code. */
function errCodeOf(e: unknown): string {
  if (e instanceof AuthError) return 'agent.http.401';
  return 'network';
}

function codeOf(res: { ok: boolean; status: number; code?: string }): string | null {
  if (res.ok) return null;
  return res.code ?? `agent.http.${res.status}`;
}

/** Numbers/strings render verbatim; null/undefined always 「—」, never 0. */
function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
    const s = String(v);
    return s === '' ? '—' : s;
  }
  return '—';
}

function isEmptyRecord(r: Record<string, unknown> | undefined | null): boolean {
  return !r || Object.keys(r).length === 0;
}

/** Per-source state chip: ok → 正常 pill, degraded → 「降级（reason）」.
 *  A missing sources entry (malformed body) degrades honestly, no reason. */
function SourceChip({ t, src }: { t: TFunction; src?: HermesSource }) {
  if (src?.state === 'ok') {
    return (
      <span className="a2-pill is-ok" data-testid="agent-v2-metrics-chip-ok">
        {t('agentConsole.v2.metricsStateOk')}
      </span>
    );
  }
  const reason = typeof src?.reason === 'string' && src.reason ? src.reason : null;
  return (
    <span className="a2-pill is-warn" data-testid="agent-v2-metrics-chip-degraded">
      {reason ? t('agentConsole.v2.metricsDegraded', { reason }) : t('agentConsole.v2.metricsDegradedPlain')}
    </span>
  );
}

function Kv({ label, value, testid }: { label: string; value: string; testid?: string }) {
  return (
    <div className="a2-metrics-kv-item">
      <span className="a2-micro">{label}</span>
      <span className="a2-mono a2-metrics-v" data-testid={testid}>{value}</span>
    </div>
  );
}

export interface HermesMetricsSectionProps {
  hermesApi: AgentConsoleHermesApi;
  /** R7 platform heat (existing trends adapter, platform-level: no employeeId). */
  trendsApi: AgentConsoleTrendsApi;
}

export function HermesMetricsSection({ hermesApi, trendsApi }: HermesMetricsSectionProps) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<Box<HermesSummary>>(boxLoading);
  const [days, setDays] = useState<7 | 30>(7);
  const [usage, setUsage] = useState<Box<HermesUsage>>(boxLoading);
  const [heat, setHeat] = useState<Box<{ cells: RunActivityCell[]; max: number }>>(boxLoading);

  // ---- block A: summary (loaded once) ----
  useEffect(() => {
    let live = true;
    const set = (b: Box<HermesSummary>) => {
      if (live) setSummary(b);
    };
    setSummary(boxLoading);
    hermesApi
      .getSummary()
      .then((res) =>
        res.ok && res.data
          ? set({ phase: 'ok', value: res.data })
          : set({ phase: 'error', code: res.ok ? `agent.http.${res.status}.empty` : codeOf(res) }),
      )
      .catch((e) => set({ phase: 'error', code: errCodeOf(e) }));
    return () => {
      live = false;
    };
  }, [hermesApi]);

  // ---- block B: usage (reloads on the days toggle) ----
  useEffect(() => {
    let live = true;
    const set = (b: Box<HermesUsage>) => {
      if (live) setUsage(b);
    };
    setUsage(boxLoading);
    hermesApi
      .getUsage(days)
      .then((res) =>
        res.ok && res.data
          ? set({ phase: 'ok', value: res.data })
          : set({ phase: 'error', code: res.ok ? `agent.http.${res.status}.empty` : codeOf(res) }),
      )
      .catch((e) => set({ phase: 'error', code: errCodeOf(e) }));
    return () => {
      live = false;
    };
  }, [hermesApi, days]);

  // ---- block C (platform side): R7 heat, same fetch/level math as trends ----
  useEffect(() => {
    let live = true;
    const set = (b: Box<{ cells: RunActivityCell[]; max: number }>) => {
      if (live) setHeat(b);
    };
    setHeat(boxLoading);
    trendsApi
      .getRunActivity({ weeks: 4, tz: 'Asia/Shanghai' })
      .then((res) => {
        if (!res.ok || !res.data || !Array.isArray(res.data.cells)) {
          set({ phase: 'error', code: res.ok ? `agent.http.${res.status}.empty` : codeOf(res) });
          return;
        }
        const cells = res.data.cells;
        const max =
          typeof res.data.max === 'number' && res.data.max > 0
            ? res.data.max
            : cells.reduce((m, c) => Math.max(m, c.count), 0);
        set({ phase: 'ok', value: { cells, max } });
      })
      .catch((e) => set({ phase: 'error', code: errCodeOf(e) }));
    return () => {
      live = false;
    };
  }, [trendsApi]);

  const heatRows = useMemo(() => {
    if (heat.phase !== 'ok') return null;
    return DAY_ORDER.map((dayKey, dayIdx) => {
      const row = heat.value.cells.filter((c) => dayIndexOf(c.dow) === dayIdx);
      return { dayKey, row };
    });
  }, [heat]);

  return (
    <div className="a2-card" data-testid="agent-v2-metrics">
      <h2 className="a2-h2">{t('agentConsole.v2.navMetrics')}</h2>
      <div className="a2-metrics-grid">
        {/* ================= A: 运行健康 ================= */}
        <section className="a2-metrics-block" data-testid="agent-v2-metrics-health" aria-label={t('agentConsole.v2.metricsHealthTitle')}>
          <h3 className="a2-micro">{t('agentConsole.v2.metricsHealthTitle')}</h3>
          {summary.phase === 'loading' ? <p className="a2-meta">{t('agentConsole.v2.loading')}</p> : null}
          {summary.phase === 'error' ? (
            <p className="a2-meta" data-testid="agent-v2-metrics-health-error">
              {t('agentConsole.v2.metricsServiceUnavailable')}
              {summary.code ? <> · <span className="a2-mono">{summary.code}</span></> : null}
            </p>
          ) : null}
          {summary.phase === 'ok'
            ? (() => {
                const s = summary.value;
                const gwSrc = s.sources?.gateway_health;
                const sysSrc = s.sources?.dashboard_system;
                const sesSrc = s.sources?.dashboard_sessions_stats;
                const gwDegraded = gwSrc?.state !== 'ok';
                const sysDegraded = sysSrc?.state !== 'ok';
                const sesDegraded = sesSrc?.state !== 'ok';
                const gw = s.gateway;
                const sys = s.system;
                const ses = s.sessions_stats;
                const loadAvg = Array.isArray(sys?.load_avg) ? sys.load_avg : null;
                return (
                  <div className="a2-metrics-sources">
                    {/* gateway */}
                    <div className="a2-metrics-src" data-testid="agent-v2-metrics-src-gateway">
                      <div className="a2-metrics-head">
                        <h4 className="a2-micro">{t('agentConsole.v2.metricsSourceGateway')}</h4>
                        <SourceChip t={t} src={gwSrc} />
                      </div>
                      {gwDegraded ? (
                        <p className="a2-meta" data-testid="agent-v2-metrics-gateway-unavailable">
                          {t('agentConsole.v2.metricsUnavailable')}
                        </p>
                      ) : (
                        <>
                          <div className="a2-metrics-kv">
                            <Kv label={t('agentConsole.v2.colStatus')} value={fmt(gw?.status)} testid="agent-v2-metrics-gw-status" />
                            <Kv label={t('agentConsole.v2.metricsPlatform')} value={fmt(gw?.platform)} />
                            <Kv label={t('agentConsole.v2.metricsVersion')} value={fmt(gw?.version)} />
                            <Kv label={t('agentConsole.v2.metricsGatewayState')} value={fmt(gw?.gateway_state)} />
                            <Kv label={t('agentConsole.v2.metricsActiveAgents')} value={fmt(gw?.active_agents)} />
                            <Kv label={t('agentConsole.v2.metricsBusy')} value={fmt(gw?.gateway_busy)} />
                            <Kv label={t('agentConsole.v2.metricsDrainable')} value={fmt(gw?.gateway_drainable)} />
                            <Kv label={t('agentConsole.v2.metricsUpdatedAt')} value={fmt(gw?.updated_at)} />
                          </div>
                          <h5 className="a2-micro a2-metrics-sub">{t('agentConsole.v2.metricsToday')}</h5>
                          <div className="a2-metrics-kv" data-testid="agent-v2-metrics-today">
                            <Kv label={t('agentConsole.v2.metricsTodayDay')} value={fmt(gw?.metrics_today?.day)} />
                            <Kv label={t('agentConsole.v2.metricsTodayRequests')} value={fmt(gw?.metrics_today?.requests)} />
                            <Kv label={t('agentConsole.v2.metricsTodayMessages')} value={fmt(gw?.metrics_today?.messages)} />
                            <Kv label={t('agentConsole.v2.metricsTodayTokens')} value={fmt(gw?.metrics_today?.tokens)} />
                            <Kv label={t('agentConsole.v2.metricsTodayLatency')} value={fmt(gw?.metrics_today?.latency_p95_ms)} />
                          </div>
                          {gw?.note ? (
                            <p className="a2-meta a2-metrics-note" data-testid="agent-v2-metrics-gw-note">
                              {gw.note}
                            </p>
                          ) : null}
                          {!isEmptyRecord(gw?.platforms) ? (
                            <div className="a2-metrics-tablewrap" data-testid="agent-v2-metrics-platforms">
                              <table className="a2-table">
                                <thead>
                                  <tr>
                                    <th>{t('agentConsole.v2.metricsPlatform')}</th>
                                    <th>{t('agentConsole.v2.colStatus')}</th>
                                    <th>{t('agentConsole.v2.metricsAttention')}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {Object.entries(gw?.platforms ?? {}).map(([name, p]) => (
                                    <tr key={name}>
                                      <td className="a2-mono">{name}</td>
                                      <td>{fmt(p?.state)}</td>
                                      <td>
                                        {p?.needs_attention === true
                                          ? t('agentConsole.v2.metricsAttentionYes')
                                          : p?.needs_attention === false
                                            ? t('agentConsole.v2.metricsAttentionNo')
                                            : '—'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="a2-meta" data-testid="agent-v2-metrics-platforms-empty">{t('agentConsole.v2.metricsPlatformEmpty')}</p>
                          )}
                        </>
                      )}
                    </div>

                    {/* system */}
                    <div className="a2-metrics-src" data-testid="agent-v2-metrics-src-system">
                      <div className="a2-metrics-head">
                        <h4 className="a2-micro">{t('agentConsole.v2.metricsSourceSystem')}</h4>
                        <SourceChip t={t} src={sysSrc} />
                      </div>
                      {sysDegraded ? (
                        <p className="a2-meta" data-testid="agent-v2-metrics-system-unavailable">
                          {t('agentConsole.v2.metricsUnavailable')}
                        </p>
                      ) : (
                        <div className="a2-metrics-kv">
                          <Kv label={t('agentConsole.v2.metricsVersion')} value={fmt(sys?.hermes_version)} />
                          <Kv label={t('agentConsole.v2.metricsCpuCount')} value={fmt(sys?.cpu_count)} />
                          <Kv label={t('agentConsole.v2.metricsCpuPercent')} value={fmt(sys?.cpu_percent)} />
                          <Kv
                            label={t('agentConsole.v2.metricsLoadAvg')}
                            value={loadAvg && loadAvg.length ? loadAvg.map((v) => fmt(v)).join(' · ') : '—'}
                          />
                          <Kv label={t('agentConsole.v2.metricsUptime')} value={fmt(sys?.uptime_seconds)} />
                          <Kv label={`${t('agentConsole.v2.metricsMemory')} · ${t('agentConsole.v2.metricsMemTotal')}`} value={fmt(sys?.memory?.total)} />
                          <Kv label={`${t('agentConsole.v2.metricsMemory')} · ${t('agentConsole.v2.metricsMemAvailable')}`} value={fmt(sys?.memory?.available)} />
                          <Kv label={`${t('agentConsole.v2.metricsMemory')} · ${t('agentConsole.v2.metricsMemUsed')}`} value={fmt(sys?.memory?.used)} />
                          <Kv label={`${t('agentConsole.v2.metricsMemory')} · ${t('agentConsole.v2.metricsPercent')}`} value={fmt(sys?.memory?.percent)} />
                          <Kv label={`${t('agentConsole.v2.metricsDisk')} · ${t('agentConsole.v2.metricsMemTotal')}`} value={fmt(sys?.disk?.total)} />
                          <Kv label={`${t('agentConsole.v2.metricsDisk')} · ${t('agentConsole.v2.metricsMemUsed')}`} value={fmt(sys?.disk?.used)} />
                          <Kv label={`${t('agentConsole.v2.metricsDisk')} · ${t('agentConsole.v2.metricsDiskFree')}`} value={fmt(sys?.disk?.free)} />
                          <Kv label={`${t('agentConsole.v2.metricsDisk')} · ${t('agentConsole.v2.metricsPercent')}`} value={fmt(sys?.disk?.percent)} />
                          <Kv label={`${t('agentConsole.v2.metricsProcess')} · ${t('agentConsole.v2.metricsProcRss')}`} value={fmt(sys?.process?.rss)} />
                          <Kv label={`${t('agentConsole.v2.metricsProcess')} · ${t('agentConsole.v2.metricsProcThreads')}`} value={fmt(sys?.process?.num_threads)} />
                          <Kv label={t('agentConsole.v2.metricsPsutil')} value={fmt(sys?.psutil)} />
                        </div>
                      )}
                    </div>

                    {/* sessions_stats */}
                    <div className="a2-metrics-src" data-testid="agent-v2-metrics-src-sessions">
                      <div className="a2-metrics-head">
                        <h4 className="a2-micro">{t('agentConsole.v2.metricsSourceSessions')}</h4>
                        <SourceChip t={t} src={sesSrc} />
                      </div>
                      {sesDegraded ? (
                        <p className="a2-meta" data-testid="agent-v2-metrics-sessions-unavailable">
                          {t('agentConsole.v2.metricsUnavailable')}
                        </p>
                      ) : (
                        <>
                          <div className="a2-metrics-kv">
                            <Kv label={t('agentConsole.v2.metricsSessionsTotal')} value={fmt(ses?.total)} />
                            <Kv label={t('agentConsole.v2.metricsSessionsActive')} value={fmt(ses?.active_store)} />
                            <Kv label={t('agentConsole.v2.metricsSessionsArchived')} value={fmt(ses?.archived)} />
                            <Kv label={t('agentConsole.v2.metricsTodayMessages')} value={fmt(ses?.messages)} />
                          </div>
                          {!isEmptyRecord(ses?.by_source) ? (
                            <div className="a2-metrics-tablewrap" data-testid="agent-v2-metrics-by-source">
                              <table className="a2-table">
                                <thead>
                                  <tr>
                                    <th>{t('agentConsole.v2.metricsColSource')}</th>
                                    <th>{t('agentConsole.v2.metricsColCount')}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {Object.entries(ses?.by_source ?? {}).map(([name, n]) => (
                                    <tr key={name}>
                                      <td className="a2-mono">{name}</td>
                                      <td className="a2-mono">{fmt(n)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="a2-meta" data-testid="agent-v2-metrics-by-source-empty">
                              {t('agentConsole.v2.metricsSessionsBySource')} · {t('agentConsole.v2.metricsBreakdownEmpty')}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })()
            : null}
        </section>

        {/* ================= B: 模型与工具用量 ================= */}
        <section className="a2-metrics-block" data-testid="agent-v2-metrics-usage" aria-label={t('agentConsole.v2.metricsUsageTitle')}>
          <div className="a2-metrics-head">
            <h3 className="a2-micro">{t('agentConsole.v2.metricsUsageTitle')}</h3>
            <div className="a2-run-seg" role="group" aria-label={t('agentConsole.v2.metricsUsageTitle')}>
              <button
                type="button"
                className="a2-btn a2-run-seg-btn"
                aria-pressed={days === 7}
                data-testid="agent-v2-metrics-days-7"
                onClick={() => setDays(7)}
              >
                {t('agentConsole.v2.metricsDays7')}
              </button>
              <button
                type="button"
                className="a2-btn a2-run-seg-btn"
                aria-pressed={days === 30}
                data-testid="agent-v2-metrics-days-30"
                onClick={() => setDays(30)}
              >
                {t('agentConsole.v2.metricsDays30')}
              </button>
            </div>
          </div>
          {usage.phase === 'loading' ? <p className="a2-meta">{t('agentConsole.v2.loading')}</p> : null}
          {usage.phase === 'error' ? (
            <p className="a2-meta" data-testid="agent-v2-metrics-usage-error">
              {t('agentConsole.v2.errorQuery')}
              {usage.code ? <> · <span className="a2-mono">{usage.code}</span></> : null}
            </p>
          ) : null}
          {usage.phase === 'ok'
            ? (() => {
                const u = usage.value;
                const usageSrc = u.sources?.dashboard_usage;
                const usageDegraded = usageSrc?.state !== 'ok';
                const hasFallback = Boolean(usageSrc?.fallback_source);
                const cost = u.cost;
                const costStatus = COST_STATUS_PILL[(cost?.cost_status ?? 'unknown') as HermesCostStatus] ?? COST_STATUS_PILL.unknown;
                const notPriced = cost?.cost_usd === null || cost?.cost_usd === undefined || cost?.cost_status === 'unknown';
                const attr = u.attribution;
                const attrDegraded = attr?.state !== 'ok';
                const models = Array.isArray(u.by_model) ? u.by_model : null;
                return (
                  <>
                    <div className="a2-metrics-head">
                      <h4 className="a2-micro">{t('agentConsole.v2.metricsSourceUsage')}</h4>
                      <SourceChip t={t} src={usageSrc} />
                      {hasFallback ? (
                        <span className="a2-pill is-warn" data-testid="agent-v2-metrics-fallback">
                          {t('agentConsole.v2.metricsFallback', { source: usageSrc?.fallback_source })}
                        </span>
                      ) : null}
                    </div>

                    {/* tokens */}
                    {usageDegraded && !hasFallback ? (
                      <p className="a2-meta" data-testid="agent-v2-metrics-tokens-unavailable">
                        {t('agentConsole.v2.metricsUnavailable')}
                      </p>
                    ) : (
                      <div className="a2-metrics-kv" data-testid="agent-v2-metrics-tokens">
                        <Kv label={t('agentConsole.v2.metricsTokIn')} value={fmt(u.tokens?.total_input)} testid="agent-v2-metrics-tok-in" />
                        <Kv label={t('agentConsole.v2.metricsTokOut')} value={fmt(u.tokens?.total_output)} testid="agent-v2-metrics-tok-out" />
                        <Kv label={t('agentConsole.v2.metricsTokCache')} value={fmt(u.tokens?.total_cache_read)} testid="agent-v2-metrics-tok-cache" />
                        <Kv label={t('agentConsole.v2.metricsTokReason')} value={fmt(u.tokens?.total_reasoning)} testid="agent-v2-metrics-tok-reason" />
                      </div>
                    )}

                    {/* by_model: null/empty → honest empty state, no fake table */}
                    <h4 className="a2-micro a2-metrics-sub">{t('agentConsole.v2.metricsColModel')}</h4>
                    {!models || models.length === 0 ? (
                      <p className="a2-meta" data-testid="agent-v2-metrics-models-empty">
                        {t('agentConsole.v2.metricsModelsEmpty')}
                      </p>
                    ) : (
                      <div className="a2-metrics-tablewrap" data-testid="agent-v2-metrics-models">
                        <table className="a2-table">
                          <thead>
                            <tr>
                              <th>{t('agentConsole.v2.metricsColModel')}</th>
                              <th>{t('agentConsole.v2.metricsTokIn')}</th>
                              <th>{t('agentConsole.v2.metricsTokOut')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {models.map((m, i) => (
                              <tr key={`${m?.model ?? 'model'}-${i}`}>
                                <td className="a2-mono">{fmt(m?.model)}</td>
                                <td className="a2-mono">{fmt(m?.input_tokens)}</td>
                                <td className="a2-mono">{fmt(m?.output_tokens)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* cost: money ONLY from cost_ledger; missing → 未计价, never 0.00 */}
                    <div className="a2-metrics-head">
                      <h4 className="a2-micro">{t('agentConsole.v2.metricsCostTotal')}</h4>
                      <span className={`a2-pill ${costStatus.cls}`} data-testid="agent-v2-metrics-cost-chip">
                        {t(costStatus.key)}
                      </span>
                    </div>
                    <div className="a2-metrics-kv">
                      {notPriced ? (
                        <span className="a2-kpi-num a2-mono" data-testid="agent-v2-metrics-cost-notpriced">
                          {t('agentConsole.v2.metricsNotPriced')}
                        </span>
                      ) : (
                        <span className="a2-kpi-num a2-mono" data-testid="agent-v2-metrics-cost-value">
                          {fmt(cost?.cost_usd)}
                        </span>
                      )}
                      <Kv label={t('agentConsole.v2.metricsCostRows')} value={fmt(cost?.rows)} testid="agent-v2-metrics-cost-rows" />
                    </div>
                    <h4 className="a2-micro a2-metrics-sub">{t('agentConsole.v2.metricsCostEmployees')}</h4>
                    {!cost?.per_employee?.length ? (
                      <p className="a2-meta" data-testid="agent-v2-metrics-cost-employees-empty">
                        {t('agentConsole.v2.metricsCostEmployeesEmpty')}
                      </p>
                    ) : (
                      <div className="a2-metrics-tablewrap" data-testid="agent-v2-metrics-cost-employees">
                        <table className="a2-table">
                          <thead>
                            <tr>
                              <th>{t('agentConsole.v2.metricsCostColEmployee')}</th>
                              <th>{t('agentConsole.v2.runsCost')}</th>
                              <th>{t('agentConsole.v2.colStatus')}</th>
                              <th>{t('agentConsole.v2.metricsCostColRows')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cost.per_employee.map((row, i) => {
                              const pill = COST_STATUS_PILL[row?.cost_status] ?? COST_STATUS_PILL.unknown;
                              return (
                                <tr key={`${row?.employee_id ?? 'emp'}-${i}`}>
                                  <td className="a2-mono">{fmt(row?.employee_id)}</td>
                                  <td className="a2-mono">{fmt(row?.cost_usd)}</td>
                                  <td>
                                    <span className={`a2-pill ${pill.cls}`}>{t(pill.key)}</span>
                                  </td>
                                  <td className="a2-mono">{fmt(row?.rows)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* attribution: mapped / 未归属 own list / degraded → 归属暂不可用 */}
                    <div className="a2-metrics-head">
                      <h4 className="a2-micro">{t('agentConsole.v2.metricsAttribution')}</h4>
                      <SourceChip t={t} src={attr?.state === 'ok' ? { state: 'ok' } : { state: 'degraded', reason: attr?.reason }} />
                    </div>
                    {attrDegraded ? (
                      <p className="a2-meta" data-testid="agent-v2-metrics-attribution-unavailable">
                        {t('agentConsole.v2.metricsAttributionUnavailable')}
                      </p>
                    ) : (
                      <>
                        <div className="a2-metrics-kv">
                          <Kv label={t('agentConsole.v2.metricsMapped')} value={fmt(attr?.mapped_sessions)} testid="agent-v2-metrics-mapped" />
                        </div>
                        {attr?.unattributed ? (
                          <div data-testid="agent-v2-metrics-unattributed">
                            <h4 className="a2-micro a2-metrics-sub">{t('agentConsole.v2.metricsUnattributed')}</h4>
                            <div className="a2-metrics-kv">
                              <Kv label={t('agentConsole.v2.metricsUnattrSessions')} value={fmt(attr.unattributed.sessions)} testid="agent-v2-metrics-unattr-sessions" />
                              {attr.unattributed.tokens ? (
                                <>
                                  <Kv label={t('agentConsole.v2.metricsTokIn')} value={fmt(attr.unattributed.tokens.total_input)} />
                                  <Kv label={t('agentConsole.v2.metricsTokOut')} value={fmt(attr.unattributed.tokens.total_output)} />
                                  <Kv label={t('agentConsole.v2.metricsTokCache')} value={fmt(attr.unattributed.tokens.total_cache_read)} />
                                  <Kv label={t('agentConsole.v2.metricsTokReason')} value={fmt(attr.unattributed.tokens.total_reasoning)} />
                                </>
                              ) : null}
                            </div>
                            {attr.unattributed.note || attr.note ? (
                              <p className="a2-meta a2-metrics-note" data-testid="agent-v2-metrics-unattr-note">
                                {attr.unattributed.note ?? attr.note}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    )}

                    {/* declared gap: this endpoint carries no tool/skill dimension */}
                    <p className="a2-meta a2-metrics-note" data-testid="agent-v2-metrics-toolgap">
                      {t('agentConsole.v2.metricsToolSkillGap')}
                    </p>
                  </>
                );
              })()
            : null}
        </section>

        {/* ================= C: 活动热力（平台对照） ================= */}
        <section className="a2-metrics-block" data-testid="agent-v2-metrics-heat" aria-label={t('agentConsole.v2.metricsHeatTitle')}>
          <h3 className="a2-micro">{t('agentConsole.v2.metricsHeatTitle')}</h3>
          <div className="a2-metrics-side">
            {/* platform R7 side — same fetch + levels as TrendsCostsSection */}
            <div className="a2-metrics-src" data-testid="agent-v2-metrics-heat-platform">
              <div className="a2-metrics-head">
                <h4 className="a2-micro">{t('agentConsole.v2.metricsHeatPlatform')}</h4>
              </div>
              {heat.phase === 'loading' ? <p className="a2-meta">{t('agentConsole.v2.loading')}</p> : null}
              {heat.phase === 'error' ? (
                <p className="a2-meta" data-testid="agent-v2-metrics-heat-error">
                  {t('agentConsole.v2.heatError')}
                  {heat.code ? <> · <span className="a2-mono">{heat.code}</span></> : null}
                </p>
              ) : null}
              {heat.phase === 'ok' && heat.value.cells.length === 0 ? (
                <p className="a2-meta" data-testid="agent-v2-metrics-heat-empty">{t('agentConsole.v2.heatEmpty')}</p>
              ) : null}
              {heat.phase === 'ok' && heatRows && heat.value.cells.length > 0 ? (
                <div className="a2-heat" data-testid="agent-v2-metrics-heat-grid">
                  {heatRows.map(({ dayKey, row }) => (
                    <div key={dayKey} className="a2-heat-row">
                      <span className="a2-heat-day">{t(dayKey)}</span>
                      <div className="a2-heat-cells">
                        {Array.from({ length: 24 }, (_, hour) => {
                          const cell = row.find((c) => c.hour === hour);
                          const count = cell?.count ?? 0;
                          const level =
                            heat.value.max > 0 && count > 0
                              ? Math.min(4, Math.max(1, Math.ceil((count / heat.value.max) * 4)))
                              : 0;
                          return (
                            <span
                              key={hour}
                              className={`a2-heat-cell is-l${level}`}
                              data-testid="agent-v2-metrics-heat-cell"
                              title={`${t(dayKey)} ${pad2(hour)}:00 · ${count}`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Hermes side — day counters only, explicit caliber note */}
            <div className="a2-metrics-src" data-testid="agent-v2-metrics-heat-hermes">
              <div className="a2-metrics-head">
                <h4 className="a2-micro">{t('agentConsole.v2.metricsHeatHermes')}</h4>
                {summary.phase === 'ok' ? <SourceChip t={t} src={summary.value.sources?.gateway_health} /> : null}
              </div>
              {summary.phase === 'loading' ? <p className="a2-meta">{t('agentConsole.v2.loading')}</p> : null}
              {summary.phase === 'error' ? (
                <p className="a2-meta" data-testid="agent-v2-metrics-heat-hermes-unavailable">
                  {t('agentConsole.v2.metricsUnavailable')}
                </p>
              ) : null}
              {summary.phase === 'ok' && summary.value.sources?.gateway_health?.state !== 'ok' ? (
                <p className="a2-meta" data-testid="agent-v2-metrics-heat-hermes-degraded">
                  {t('agentConsole.v2.metricsUnavailable')}
                </p>
              ) : null}
              {summary.phase === 'ok' && summary.value.sources?.gateway_health?.state === 'ok' ? (
                <div className="a2-metrics-kv a2-metrics-kv-side">
                  <Kv label={t('agentConsole.v2.metricsTodayDay')} value={fmt(summary.value.gateway?.metrics_today?.day)} />
                  <Kv label={t('agentConsole.v2.metricsTodayRequests')} value={fmt(summary.value.gateway?.metrics_today?.requests)} />
                  <Kv label={t('agentConsole.v2.metricsTodayMessages')} value={fmt(summary.value.gateway?.metrics_today?.messages)} />
                  <Kv label={t('agentConsole.v2.metricsTodayTokens')} value={fmt(summary.value.gateway?.metrics_today?.tokens)} />
                  <Kv label={t('agentConsole.v2.metricsTodayLatency')} value={fmt(summary.value.gateway?.metrics_today?.latency_p95_ms)} />
                </div>
              ) : null}
            </div>
          </div>
          <p className="a2-meta a2-metrics-note" data-testid="agent-v2-metrics-caliber">
            {t('agentConsole.v2.metricsCaliberNote')}
          </p>
        </section>
      </div>
    </div>
  );
}
