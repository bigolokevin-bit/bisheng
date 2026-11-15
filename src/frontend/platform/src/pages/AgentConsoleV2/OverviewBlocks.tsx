/* OV-01 slice 3: cost / quota / activity blocks for the overview page.
 * Cost total is the sum over P9 ledger rows returned by the service; a
 * missing row is never displayed as 0 and an all-missing batch shows an
 * explicit reason. Quota bars need BOTH the ledger cost and the version
 * budget denominator (E11 expand=version → effectiveBudget.monthlyCostUsd);
 * rows without either are omitted, never drawn with fabricated values.
 * The activity feed merges /api/runs?since=... and /api/audit?from=&to=...
 * newest-first; absent fields render as an em-dash. */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { fmtRatio, fmtTime, fmtUsd, type BudgetBody, type EmployeeRow } from './v2Data';

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

export function CostBlock({ state }: { state: BlockState<BudgetBody> }) {
  const { t } = useTranslation();
  const total = state.ok ? sumCost(state.data?.items) : null;
  const missing = state.data?.missingEmployeeIds?.length ?? 0;
  return (
    <div className="a2-card" data-testid="agent-v2-ov-block-cost">
      <h2 className="a2-h2">{t('agentConsole.v2.ov.costTitle')}</h2>
      {state.loading ? (
        <p className="a2-meta">…</p>
      ) : !state.ok ? (
        <p className="a2-meta" data-testid="agent-v2-ov-cost-error">
          {state.code === 'agent-console.no-employees'
            ? t('agentConsole.v2.ov.noEmployeesNote')
            : (state.code ?? `http-${state.status}`)}
        </p>
      ) : (
        <>
          <p className="a2-kpi-num">{fmtUsd(total)}</p>
          {missing > 0 ? (
            <p className="a2-meta" data-testid="agent-v2-ov-cost-missing">
              {t('agentConsole.v2.ov.costMissing', { count: missing })}
            </p>
          ) : null}
          <p className="a2-micro">{t('agentConsole.v2.ov.noteLedger')}</p>
        </>
      )}
    </div>
  );
}

export function QuotaBlock({ cost, rows }: { cost: BlockState<BudgetBody>; rows: EmployeeRow[] }) {
  const { t } = useTranslation();
  const bars = useMemo(() => {
    const costOf = new Map<string, number | null | undefined>();
    for (const item of cost.data?.items ?? []) {
      costOf.set(item.employeeId, item.costUsd);
    }
    const out: { employeeId: string; label: string; value: number; denominator: number }[] = [];
    for (const row of rows) {
      const value = costOf.get(row.employeeId);
      const denominator = row.enrichment?.effectiveBudget?.monthlyCostUsd;
      if (typeof value === 'number' && typeof denominator === 'number' && denominator > 0) {
        out.push({
          employeeId: row.employeeId,
          label: row.name || row.employeeId,
          value,
          denominator,
        });
      }
    }
    return out;
  }, [cost, rows]);
  return (
    <div className="a2-card" data-testid="agent-v2-ov-block-quota">
      <h2 className="a2-h2">{t('agentConsole.v2.ov.quotaTitle')}</h2>
      {cost.loading ? (
        <p className="a2-meta">…</p>
      ) : bars.length === 0 ? (
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
    </div>
  );
}

export function ActivityBlock({
  runs,
  audit,
}: {
  runs: BlockState<{ items: UnknownRecord[] }>;
  audit: BlockState<{ events: UnknownRecord[] }>;
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
        <p className="a2-meta" data-testid="agent-v2-ov-activity-empty">
          {!runs.ok && !audit.ok
            ? t('agentConsole.v2.ov.activityUnavailable')
            : t('agentConsole.v2.ov.activityEmpty')}
        </p>
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
