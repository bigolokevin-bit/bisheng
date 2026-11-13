/**
 * L4 console v2-3 (P0-5): the 「趋势与成本」 section on the employee detail.
 * Three blocks, each degrading independently:
 * - R6 7-day run trend (bars; missing p95 → 「样本不足」; estimatedRuns>0 →
 *   「含估算」; unknownRuns>0 → 「含未记账」).
 * - R7 7×24 activity heat over the last 4 weeks (dow rows Sun-first via
 *   dayIndexOf, which normalizes ISO dow 1–7 and 0-based dow alike).
 * - P9 current-month cost (missing ledger row → 「无成本记录」, never 0.00).
 * Empty series render an explicit empty state — no fake curve is ever drawn
 * (S10b-v2 honest-data rules). Layout is fraction-based (minmax(0,1fr)) so
 * 375px and 1440px both stay free of horizontal overflow.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  dayIndexOf,
  type AgentConsoleTrendsApi,
  type BudgetUsageItem,
  type RunActivityCell,
  type RunStatsBucket,
} from '@/controllers/API/agentConsoleTrends';

type Box<T> = { phase: 'loading' } | { phase: 'ok'; value: T } | { phase: 'error' };

const boxLoading = { phase: 'loading' } as const;
const boxError = { phase: 'error' } as const;

const DAY_ORDER = [
  'agentConsole.v2.daySun',
  'agentConsole.v2.dayMon',
  'agentConsole.v2.dayTue',
  'agentConsole.v2.dayWed',
  'agentConsole.v2.dayThu',
  'agentConsole.v2.dayFri',
  'agentConsole.v2.daySat',
] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Rolling 7-day window as ISO timestamps (runtime parses bare YYYY-MM-DD as
 * local midnight and treats `to` as an EXCLUSIVE upper bound, which dropped
 * today's runs — so we send explicit instants): `from` is the local start of
 * the day 6 days ago, `to` is tomorrow's local midnight, guaranteeing every
 * run up to "now" falls inside the window. `period` stays YYYY-MM for P9.
 */
export function buildWindow(): { from: string; to: string; period: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    period: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`,
  };
}

/** MM-DD label from an upstream bucketStart (ISO instant or bare date). */
function dayLabel(bucketStart: string): string {
  return bucketStart.slice(5, 10);
}

function fmtCost(v: number): string {
  return v.toFixed(2);
}

export interface TrendsCostsSectionProps {
  employeeId: string;
  api: AgentConsoleTrendsApi;
}

export function TrendsCostsSection({ employeeId, api }: TrendsCostsSectionProps) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<Box<RunStatsBucket[]>>(boxLoading);
  const [heat, setHeat] = useState<Box<{ cells: RunActivityCell[]; max: number }>>(boxLoading);
  const [cost, setCost] = useState<Box<BudgetUsageItem | null>>(boxLoading);

  // `span`: the rolling window (avoid shadowing the global `window`).
  const span = useMemo(() => buildWindow(), []);

  useEffect(() => {
    let live = true;
    const setS = (b: Box<RunStatsBucket[]>) => {
      if (live) setStats(b);
    };
    const setH = (b: Box<{ cells: RunActivityCell[]; max: number }>) => {
      if (live) setHeat(b);
    };
    const setC = (b: Box<BudgetUsageItem | null>) => {
      if (live) setCost(b);
    };
    setStats(boxLoading);
    setHeat(boxLoading);
    setCost(boxLoading);

    api
      .getRunStats({ from: span.from, to: span.to, employeeId, bucket: 'day' })
      .then((res) =>
        setS(
          res.ok && res.data && Array.isArray(res.data.buckets)
            ? { phase: 'ok', value: res.data.buckets }
            : boxError,
        ),
      )
      .catch(() => setS(boxError));

    api
      .getRunActivity({ weeks: 4, employeeId, tz: 'Asia/Shanghai' })
      .then((res) => {
        if (!res.ok || !res.data || !Array.isArray(res.data.cells)) {
          setH(boxError);
          return;
        }
        const cells = res.data.cells;
        const max =
          typeof res.data.max === 'number' && res.data.max > 0
            ? res.data.max
            : cells.reduce((m, c) => Math.max(m, c.count), 0);
        setH({ phase: 'ok', value: { cells, max } });
      })
      .catch(() => setH(boxError));

    api
      .getBudgetUsage({ employeeId, periodKind: 'month', period: span.period })
      .then((res) => {
        if (!res.ok || !res.data) {
          setC(boxError);
          return;
        }
        const row = (res.data.items ?? []).find((i) => i.employeeId === employeeId) ?? null;
        setC({ phase: 'ok', value: row });
      })
      .catch(() => setC(boxError));

    return () => {
      live = false;
    };
  }, [api, employeeId, span]);

  const p95 = useMemo(() => {
    if (stats.phase !== 'ok') return null;
    for (let i = stats.value.length - 1; i >= 0; i -= 1) {
      const v = stats.value[i].p95DurationMs;
      if (typeof v === 'number') return v;
    }
    return null;
  }, [stats]);

  const markers = useMemo(() => {
    const est = stats.phase === 'ok' && stats.value.some((b) => (b.estimatedRuns ?? 0) > 0);
    const unknown = stats.phase === 'ok' && stats.value.some((b) => (b.unknownRuns ?? 0) > 0);
    return { est, unknown };
  }, [stats]);

  return (
    <div className="a2-card" data-testid="agent-v2-trends">
      <h2 className="a2-h2">{t('agentConsole.v2.trendsTitle')}</h2>
      <div className="a2-trends-grid">
        {/* ---------- R6: 7-day trend ---------- */}
        <section className="a2-trends-block" data-testid="agent-v2-trend-7d" aria-label={t('agentConsole.v2.trends7d')}>
          <h3 className="a2-micro">{t('agentConsole.v2.trends7d')}</h3>
          {stats.phase === 'loading' ? <p className="a2-meta">{t('agentConsole.v2.loading')}</p> : null}
          {stats.phase === 'error' ? (
            <p className="a2-meta" data-testid="agent-v2-trend-error">{t('agentConsole.v2.trendError')}</p>
          ) : null}
          {stats.phase === 'ok' && stats.value.length === 0 ? (
            <p className="a2-meta" data-testid="agent-v2-trend-empty">{t('agentConsole.v2.trendEmpty')}</p>
          ) : null}
          {stats.phase === 'ok' && stats.value.length > 0 ? (
            <>
              <div className="a2-trend-legend">
                <span className="a2-micro">{t('agentConsole.v2.trendP95')}: </span>
                <span className="a2-mono" data-testid="agent-v2-trend-p95">
                  {p95 === null ? t('agentConsole.v2.trendP95None') : `${p95} ms`}
                </span>
                {markers.est ? (
                  <span className="a2-pill is-warn" data-testid="agent-v2-trend-chip-estimated">
                    {t('agentConsole.v2.trendEstimated')}
                  </span>
                ) : null}
                {markers.unknown ? (
                  <span className="a2-pill is-warn" data-testid="agent-v2-trend-chip-uncounted">
                    {t('agentConsole.v2.trendUncounted')}
                  </span>
                ) : null}
              </div>
              <div className="a2-trend-chart" role="img" aria-label={t('agentConsole.v2.trends7d')}>
                {(() => {
                  const maxTotal = stats.value.reduce(
                    (m, b) => Math.max(m, (b.succeeded ?? 0) + (b.failed ?? 0)),
                    0,
                  );
                  return stats.value.map((b) => {
                    const okN = b.succeeded ?? 0;
                    const badN = b.failed ?? 0;
                    const hPct = maxTotal > 0 ? (((okN + badN) / maxTotal) * 100) : 0;
                    const okPct = okN + badN > 0 ? (okN / (okN + badN)) * 100 : 0;
                    return (
                      <div
                        key={b.bucketStart}
                        className="a2-trend-col"
                        data-testid="agent-v2-trend-bar"
                        title={`${b.bucketStart.slice(0, 10)} ✓${okN} ✗${badN}`}
                      >
                        <div className="a2-trend-coltrack">
                          <div className="a2-trend-stack" style={{ height: `${hPct}%` }}>
                            <div className="a2-trend-seg-bad" style={{ height: `${100 - okPct}%` }} />
                            <div className="a2-trend-seg-ok" style={{ height: `${okPct}%` }} />
                          </div>
                        </div>
                        <div className="a2-trend-day a2-mono">{dayLabel(b.bucketStart)}</div>
                      </div>
                    );
                  });
                })()}
              </div>
              <p className="a2-micro">
                {t('agentConsole.v2.trendSucceeded')} / {t('agentConsole.v2.trendFailed')}
              </p>
            </>
          ) : null}
        </section>

        {/* ---------- R7: 7×24 heat ---------- */}
        <section className="a2-trends-block" data-testid="agent-v2-heat" aria-label={t('agentConsole.v2.trendsHeat')}>
          <h3 className="a2-micro">{t('agentConsole.v2.trendsHeat')}</h3>
          {heat.phase === 'loading' ? <p className="a2-meta">{t('agentConsole.v2.loading')}</p> : null}
          {heat.phase === 'error' ? (
            <p className="a2-meta" data-testid="agent-v2-heat-error">{t('agentConsole.v2.heatError')}</p>
          ) : null}
          {heat.phase === 'ok' && heat.value.cells.length === 0 ? (
            <p className="a2-meta" data-testid="agent-v2-heat-empty">{t('agentConsole.v2.heatEmpty')}</p>
          ) : null}
          {heat.phase === 'ok' && heat.value.cells.length > 0 ? (
            <div className="a2-heat" data-testid="agent-v2-heat-grid">
              {DAY_ORDER.map((dayKey, dayIdx) => {
                const row = heat.value.cells.filter((c) => dayIndexOf(c.dow) === dayIdx);
                return (
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
                            data-testid="agent-v2-heat-cell"
                            title={`${t(dayKey)} ${pad2(hour)}:00 · ${count}`}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>

        {/* ---------- P9: current-month cost ---------- */}
        <section className="a2-trends-block" data-testid="agent-v2-cost" aria-label={t('agentConsole.v2.trendsCost')}>
          <h3 className="a2-micro">{t('agentConsole.v2.trendsCost')}</h3>
          {cost.phase === 'loading' ? <p className="a2-meta">{t('agentConsole.v2.loading')}</p> : null}
          {cost.phase === 'error' ? (
            <p className="a2-meta" data-testid="agent-v2-cost-error">{t('agentConsole.v2.costError')}</p>
          ) : null}
          {cost.phase === 'ok' && cost.value === null ? (
            <p className="a2-meta" data-testid="agent-v2-cost-missing">{t('agentConsole.v2.costNone')}</p>
          ) : null}
          {cost.phase === 'ok' && cost.value ? (
            (() => {
              const row = cost.value;
              const hasCost = typeof row.costUsd === 'number';
              const est =
                row.estimated === true || row.costStatus === 'estimated' || row.costStatus === 'mixed';
              const uncounted = row.uncounted === true || row.costStatus === 'unknown';
              return (
                <div className="a2-trend-legend">
                  <span className="a2-kpi-num a2-mono" data-testid="agent-v2-cost-value">
                    {hasCost && !uncounted ? fmtCost(row.costUsd as number) : t('agentConsole.v2.costUnknown')}
                  </span>
                  {est ? (
                    <span className="a2-pill is-warn" data-testid="agent-v2-cost-chip-estimated">
                      {t('agentConsole.v2.trendEstimated')}
                    </span>
                  ) : null}
                  {uncounted ? (
                    <span className="a2-pill is-warn" data-testid="agent-v2-cost-chip-uncounted">
                      {t('agentConsole.v2.trendUncounted')}
                    </span>
                  ) : null}
                </div>
              );
            })()
          ) : null}
        </section>
      </div>
    </div>
  );
}
