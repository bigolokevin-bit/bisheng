/* OV-01 slice 3 + fix A: cost/budget (merged into ONE block per ACCEPTANCE
 * §7 G11), anomalies (G1), queue sections (moved from OverviewPage) and the
 * activity feed. Cost total is the sum over P9 ledger rows returned by the
 * service; a missing row is never displayed as 0 and an all-missing batch
 * shows an explicit reason. Quota bars need BOTH the ledger cost and the
 * version budget denominator (E11 expand=version → effectiveBudget
 * .monthlyCostUsd); rows without either are omitted, never fabricated.
 * The anomaly block derives ONLY from real aggregates already fetched for
 * the KPIs (R6 failed sum over the window + AP8 dueSoon); when both are 0
 * it states the scanned scope instead of hiding itself. Queue rows render
 * whatever safe string fields the real API returns; absent fields fall back
 * to an em-dash. The activity feed merges /api/runs?since=... and
 * /api/audit?from=&to=... newest-first. */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';

import {
  bucketSum,
  fmtRatio,
  fmtTime,
  fmtUsd,
  type ApprovalStats,
  type BudgetBody,
  type EmployeeRow,
  type RunStatsBody,
} from './v2Data';

type UnknownRecord = { [key: string]: unknown };

interface BlockState<T> {
  loading: boolean;
  ok: boolean;
  status: number;
  code?: string;
  data?: T;
}

function firstString(item: UnknownRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}

function sumCost(items: BudgetBody['items'] | undefined): number | null {
  let sum: number | null = null;
  for (const item of items ?? []) {
    if (typeof item.costUsd === 'number') sum = (sum ?? 0) + item.costUsd;
  }
  return sum;
}

export function CostBudgetBlock({
  cost,
  rows,
  onRetry,
}: {
  cost: BlockState<BudgetBody>;
  rows: EmployeeRow[];
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const total = cost.ok ? sumCost(cost.data?.items) : null;
  const missing = cost.data?.missingEmployeeIds?.length ?? 0;
  // fix A (G11): the quota bars moved INSIDE this merged block; a bar still
  // needs BOTH the real ledger cost and the real budget denominator.
  const bars = useMemo(() => {
    const costOf = new Map<string, number | null | undefined>();
    for (const item of cost.data?.items ?? []) {
      costOf.set(item.employeeId, item.costUsd);
    }
    const out: {
      employeeId: string;
      label: string;
      // fix B (G12): short id suffix so same-named employees stay distinguishable.
      idTail: string;
      value: number;
      denominator: number;
    }[] = [];
    for (const row of rows) {
      const value = costOf.get(row.employeeId);
      const denominator = row.enrichment?.effectiveBudget?.monthlyCostUsd;
      if (typeof value === 'number' && typeof denominator === 'number' && denominator > 0) {
        out.push({
          employeeId: row.employeeId,
          label: row.name || row.employeeId,
          idTail: row.employeeId.slice(-6).toLowerCase(),
          value,
          denominator,
        });
      }
    }
    return out;
  }, [cost, rows]);
  return (
    <div className="a2-card" data-testid="agent-v2-ov-block-cost">
      <h2 className="a2-h2">{t('agentConsole.v2.ov.costBudgetTitle')}</h2>
      {cost.loading ? (
        <p className="a2-meta">…</p>
      ) : !cost.ok ? (
        <>
          <p className="a2-meta" data-testid="agent-v2-ov-cost-error">
            {cost.code === 'agent-console.no-employees'
              ? t('agentConsole.v2.ov.noEmployeesNote')
              : t('agentConsole.v2.ov.blockUnavailable', {
                  block: t('agentConsole.v2.ov.costBudgetTitle'),
                  code: cost.status,
                })}
          </p>
          {/* fix B (G10): block-level retry entry */}
          <button
            type="button"
            className="a2-btn"
            data-testid="agent-v2-ov-retry-cost"
            onClick={onRetry}
          >
            {t('agentConsole.v2.ov.retry')}
          </button>
        </>
      ) : (
        <>
          <p className="a2-kpi-num">{fmtUsd(total)}</p>
          {missing > 0 ? (
            <p className="a2-meta" data-testid="agent-v2-ov-cost-missing">
              {t('agentConsole.v2.ov.costMissing', { count: missing })}
            </p>
          ) : null}
          <p className="a2-micro">{t('agentConsole.v2.ov.noteLedger')}</p>
          <p className="a2-meta" data-testid="agent-v2-ov-quota-subtitle" style={{ marginTop: 12 }}>
            {t('agentConsole.v2.ov.quotaTitle')}
          </p>
          {bars.length === 0 ? (
            <p className="a2-meta" data-testid="agent-v2-ov-quota-empty">
              {t('agentConsole.v2.ov.quotaNoDenominator')}
            </p>
          ) : (
            bars.map((bar) => {
              const ratio = bar.value / bar.denominator;
              const tone = ratio >= 0.85 ? ' a2-danger' : ratio >= 0.6 ? ' a2-warn' : '';
              return (
                <div
                  className="a2-card-item"
                  key={bar.employeeId}
                  data-testid="agent-v2-ov-quota-row"
                >
                  <div className="a2-card-head">
                    <span className="a2-meta">{bar.label}</span>
                    {/* fix B (G12): last 6 chars of the employee id, real data. */}
                    <span
                      className="a2-mono a2-micro"
                      data-testid="agent-v2-ov-quota-id"
                    >
                      {bar.idTail}
                    </span>
                    <span className={`a2-micro${tone}`}>{fmtRatio(ratio)}</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: 'rgba(128, 128, 128, 0.15)' }}>
                    <div
                      style={{
                        width: `${Math.min(ratio, 1) * 100}%`,
                        height: '100%',
                        borderRadius: 3,
                        background: 'hsl(var(--accent))',
                      }}
                    />
                  </div>
                  <p className="a2-micro">
                    {fmtUsd(bar.value)} / {fmtUsd(bar.denominator)}
                  </p>
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}

/* fix A (G1): the eighth block, derived strictly from the two REAL aggregates
 * already fetched for the KPI row — R6 run-stats failed sum over the current
 * window and AP8 approval-stats dueSoon. When both are zero it shows the
 * honest empty state plus the scanned scope; the block is never omitted. */
export function AnomalyBlock({
  runs,
  approvals,
  days,
  onRetry,
}: {
  runs: BlockState<RunStatsBody>;
  approvals: BlockState<ApprovalStats>;
  days: number;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const failed = runs.ok ? bucketSum(runs.data?.buckets).failed : null;
  const dueSoon = approvals.ok ? (approvals.data?.dueSoon ?? null) : null;
  const scan = (
    <p className="a2-micro" data-testid="agent-v2-ov-anomaly-scan">
      {t('agentConsole.v2.ov.anomalyScan', { days })}
    </p>
  );
  return (
    <div className="a2-card" data-testid="agent-v2-ov-block-anomaly">
      <h2 className="a2-h2">{t('agentConsole.v2.ov.anomalyTitle')}</h2>
      {runs.loading || approvals.loading ? (
        <p className="a2-meta">…</p>
      ) : failed === 0 && dueSoon === 0 ? (
        <>
          <p className="a2-meta" data-testid="agent-v2-ov-anomaly-empty">
            {t('agentConsole.v2.ov.anomalyEmpty')}
          </p>
          {scan}
        </>
      ) : (
        <>
          {failed === null ? (
            <p className="a2-meta" data-testid="agent-v2-ov-anomaly-runs-state">
              {runs.code === 'agent-console.no-uid'
                ? t('agentConsole.v2.ov.noteNoUid')
                : t('agentConsole.v2.ov.anomalyUnavailable')}
            </p>
          ) : failed > 0 ? (
            <p className="a2-card-sub" data-testid="agent-v2-ov-anomaly-runs">
              <span>{t('agentConsole.v2.ov.anomalyRuns', { count: failed })}</span>
              {' · '}
              <NavLink className="a2-micro" to="/agent/runs">
                {t('agentConsole.v2.ov.viewAll')}
              </NavLink>
            </p>
          ) : null}
          {dueSoon === null ? (
            <p className="a2-meta" data-testid="agent-v2-ov-anomaly-approvals-state">
              {approvals.code === 'agent-console.no-uid'
                ? t('agentConsole.v2.ov.noteNoUid')
                : t('agentConsole.v2.ov.anomalyUnavailable')}
            </p>
          ) : dueSoon > 0 ? (
            <p className="a2-card-sub" data-testid="agent-v2-ov-anomaly-approvals">
              <span>{t('agentConsole.v2.ov.anomalyApprovals', { count: dueSoon })}</span>
              {' · '}
              <NavLink className="a2-micro" to="/agent/approvals">
                {t('agentConsole.v2.ov.viewAll')}
              </NavLink>
            </p>
          ) : null}
          {/* fix B (G10): retry entry when either source is unavailable */}
          {failed === null || dueSoon === null ? (
            <button
              type="button"
              className="a2-btn"
              data-testid="agent-v2-ov-retry-anomaly"
              onClick={onRetry}
            >
              {t('agentConsole.v2.ov.retry')}
            </button>
          ) : null}
          {scan}
        </>
      )}
    </div>
  );
}

/* fix A (G2): tiny sparkline for KPI cards, drawn strictly from the run-stats
 * day buckets the page already fetched; a null series draws nothing. */
export function KpiSpark({ points, testId }: { points: number[]; testId: string }) {
  const width = 72;
  const height = 20;
  const max = Math.max(...points, 1);
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const coords = points
    .map(
      (value, index) =>
        `${(index * step).toFixed(1)},${(height - (value / max) * (height - 2) - 1).toFixed(1)}`
    )
    .join(' ');
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      data-testid={testId}
      style={{ display: 'block' }}
    >
      <polyline points={coords} fill="none" stroke="hsl(var(--accent))" strokeWidth="1.5" />
    </svg>
  );
}

// fix A: queue sections moved here from OverviewPage (slice 2) unchanged in
// behaviour; rows render whatever safe string fields the real API returns.
export interface OverviewQueueBody {
  items: UnknownRecord[];
  nextCursor?: string;
}

function queueLabel(item: UnknownRecord): string {
  return (
    firstString(item, [
      'title',
      'name',
      'action',
      'resource',
      'approvalId',
      'taskId',
      'runId',
      'employeeId',
    ]) ?? '—'
  );
}

function queueStatus(item: UnknownRecord): string {
  return firstString(item, ['status', 'lifecycleState', 'outcome']) ?? '—';
}

export function QueueSection({
  titleKey,
  state,
  to,
  onRetry,
}: {
  titleKey: string;
  state: BlockState<OverviewQueueBody>;
  to: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const items = state.ok ? (state.data?.items ?? []) : [];
  return (
    <div className="a2-card-item" data-testid={`agent-v2-ov-queue-${titleKey}`}>
      <div className="a2-card-head">
        <span className="a2-meta">{t(`agentConsole.v2.ov.${titleKey}`)}</span>
        <NavLink className="a2-micro" to={to}>
          {t('agentConsole.v2.ov.viewAll')}
        </NavLink>
      </div>
      {state.loading ? (
        <p className="a2-meta">…</p>
      ) : !state.ok ? (
        <>
          <p className="a2-meta" data-testid={`agent-v2-ov-queue-${titleKey}-empty`}>
            {state.code === 'agent-console.no-uid'
              ? t('agentConsole.v2.ov.queueNoUid')
              : t('agentConsole.v2.ov.queueUnavailable')}
          </p>
          {/* fix B (G10): per-section retry entry */}
          <button
            type="button"
            className="a2-btn"
            data-testid={`agent-v2-ov-retry-queue-${titleKey}`}
            onClick={onRetry}
          >
            {t('agentConsole.v2.ov.retry')}
          </button>
        </>
      ) : items.length === 0 ? (
        <p className="a2-meta" data-testid={`agent-v2-ov-queue-${titleKey}-empty`}>
          {t('agentConsole.v2.ov.queueEmpty')}
        </p>
      ) : (
        items.map((item, index) => (
          <p className="a2-card-sub" key={`${titleKey}-${index}`}>
            <span>{queueLabel(item)}</span>
            {' · '}
            <span className="a2-mono">{queueStatus(item)}</span>
          </p>
        ))
      )}
    </div>
  );
}

export function ActivityBlock({
  runs,
  audit,
  onRetry,
}: {
  runs: BlockState<{ items: UnknownRecord[] }>;
  audit: BlockState<{ events: UnknownRecord[] }>;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const rows = useMemo(() => {
    type Row = { time: string | null; source: 'run' | 'audit'; what: string };
    const out: Row[] = [];
    if (runs.ok) {
      for (const item of runs.data?.items ?? []) {
        const time = firstString(item, ['startedAt', 'createdAt', 'updatedAt']);
        const what =
          [firstString(item, ['runId']), firstString(item, ['status', 'outcome'])]
            .filter(Boolean)
            .join(' · ') || '—';
        out.push({ time, source: 'run', what });
      }
    }
    if (audit.ok) {
      for (const ev of audit.data?.events ?? []) {
        out.push({
          time: firstString(ev, ['occurredAt', 'recordedAt']),
          source: 'audit',
          what: firstString(ev, ['action']) ?? '—',
        });
      }
    }
    out.sort((x, y) => (y.time ?? '').localeCompare(x.time ?? ''));
    return out;
  }, [runs, audit]);
  return (
    <div className="a2-card" data-testid="agent-v2-ov-block-activity">
      <h2 className="a2-h2">{t('agentConsole.v2.ov.activityTitle')}</h2>
      {runs.loading || audit.loading ? (
        <p className="a2-meta">…</p>
      ) : rows.length === 0 ? (
        <>
          <p className="a2-meta" data-testid="agent-v2-ov-activity-empty">
            {!runs.ok && !audit.ok
              ? t('agentConsole.v2.ov.activityUnavailable')
              : t('agentConsole.v2.ov.activityEmpty')}
          </p>
          {/* fix B (G10): retry only when both sources failed (not a real empty) */}
          {!runs.ok && !audit.ok ? (
            <button
              type="button"
              className="a2-btn"
              data-testid="agent-v2-ov-retry-activity"
              onClick={onRetry}
            >
              {t('agentConsole.v2.ov.retry')}
            </button>
          ) : null}
        </>
      ) : (
        <>
          <p className="a2-meta" data-testid="agent-v2-ov-activity-head">
            {t('agentConsole.v2.ov.colTime')} · {t('agentConsole.v2.ov.colSource')} ·{' '}
            {t('agentConsole.v2.ov.colWhat')}
          </p>
          {rows.map((row, index) => (
            <p
              className="a2-card-sub"
              key={`${row.source}-${index}`}
              data-testid="agent-v2-ov-activity-row"
            >
              <span>{row.time ? fmtTime(row.time) : '—'}</span>
              {' · '}
              <span>
                {row.source === 'run'
                  ? t('agentConsole.v2.ov.sourceRun')
                  : t('agentConsole.v2.ov.sourceAudit')}
              </span>
              {' · '}
              <span className="a2-mono">{row.what}</span>
            </p>
          ))}
        </>
      )}
    </div>
  );
}
