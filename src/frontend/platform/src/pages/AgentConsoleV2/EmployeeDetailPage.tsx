/* EMP-03: employee detail page (/agent/employees/:id), read-only.
 * Data comes ONLY from the service endpoints (E2 employee, E5 effective
 * config, E10 workstations, E15 versions, R6 run-stats, P9 budget, AP8
 * approval-stats, T5 tasks, R5 runs, A3 audit) fetched through the same
 * /agent-api origin the list page uses. The version chain is E15 rows in
 * real order — never a synthesized chain; missing values render as an em
 * dash or an explicit empty state, never a fabricated number, sparkline
 * or conversation. Machine codes from upstream are never surfaced: error
 * text uses the localized blockUnavailable copy with the HTTP status as
 * parameter only (G15 rule inherited from OV-01). Cross-tenant and
 * unknown ids show the same 404 copy so existence is not leaked. */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useParams, useSearchParams } from 'react-router-dom';

import {
  bucketSum,
  dayWindow,
  fetchApprovalStats,
  fetchBudgetMonth,
  fetchEffectiveConfig,
  fetchEmployeeDetail,
  fetchEmployeeVersions,
  fetchRunStats,
  fetchWorkstations,
  fmtTime,
  fmtUsd,
  makeFetcher,
  monthPeriod,
  sparkPoints,
  type ApiRes,
  type ApprovalStats,
  type BudgetBody,
  type EffectiveConfigBody,
  type EmployeeDetailBody,
  type RunStatsBody,
  type VersionListBody,
  type WorkstationListBody,
} from './v2Data';

import { KpiSpark } from './OverviewBlocks';
import type { OverviewQueueBody } from './OverviewBlocks';

type UnknownRecord = { [key: string]: unknown };

interface Box<T> {
  loading: boolean;
  ok: boolean;
  status: number;
  code?: string;
  data?: T;
}

const IDLE: { loading: false; ok: false; status: 0 } = {
  loading: false,
  ok: false,
  status: 0,
};

function box<T>(res: ApiRes<T>): Box<T> {
  return {
    loading: false,
    ok: res.ok,
    status: res.status,
    code: res.code,
    data: res.ok ? res.data : undefined,
  };
}

const TAB_KEYS = ['overview', 'chat', 'tasks', 'runs', 'audit'] as const;
type TabKey = (typeof TAB_KEYS)[number];

function str(item: UnknownRecord, keys: string[]): string {
  for (const key of keys) {
    const v = item[key];
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number') return String(v);
  }
  return '';
}

/** Localized block error with a block-level retry (same idiom as OV-01
 * G10/G15: retry re-runs the whole silent refetch of this page). */
function BlockError({
  block,
  status,
  onRetry,
  retryTestId,
}: {
  block: string;
  status: number;
  onRetry: () => void;
  retryTestId: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <p className="a2-meta" data-testid={`${retryTestId}-text`}>
        {t('agentConsole.v2.ov.blockUnavailable', { block, code: status })}
      </p>
      <button
        type="button"
        className="a2-btn"
        data-testid={retryTestId}
        onClick={onRetry}
      >
        {t('agentConsole.v2.ov.retry')}
      </button>
    </>
  );
}

export function EmployeeDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetch = makeFetcher();
  const [token, setToken] = useState(0);
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(true);

  const [detail, setDetail] = useState<Box<EmployeeDetailBody>>(IDLE as Box<EmployeeDetailBody>);
  const [config, setConfig] = useState<Box<EffectiveConfigBody>>(IDLE as Box<EffectiveConfigBody>);
  const [versions, setVersions] = useState<Box<VersionListBody>>(IDLE as Box<VersionListBody>);
  const [stations, setStations] = useState<Box<WorkstationListBody>>(IDLE as Box<WorkstationListBody>);
  const [runs, setRuns] = useState<Box<RunStatsBody>>(IDLE as Box<RunStatsBody>);
  const [budget, setBudget] = useState<Box<BudgetBody>>(IDLE as Box<BudgetBody>);
  const [pending, setPending] = useState<Box<ApprovalStats> | null>(null);
  const [tasks, setTasks] = useState<Box<OverviewQueueBody>>(IDLE as Box<OverviewQueueBody>);
  const [runRows, setRunRows] = useState<Box<OverviewQueueBody>>(IDLE as Box<OverviewQueueBody>);
  const [audit, setAudit] = useState<Box<{ events?: UnknownRecord[] }>>(
    IDLE as Box<{ events?: UnknownRecord[] }>
  );

  const refresh = useCallback(() => setToken((x) => x + 1), []);

  const rawTab = searchParams.get('tab');
  const tab: TabKey = (TAB_KEYS as readonly string[]).includes(rawTab ?? '')
    ? (rawTab as TabKey)
    : 'overview';
  const setTab = (next: TabKey) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params);
  };

  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    setLoading(true);
    void (async () => {
      const e2 = await fetchEmployeeDetail(fetch, id);
      if (!alive) return;
      setDetail(box(e2));
      setLoading(false);
      if (!e2.ok) return;
      const at = new Date().toISOString();
      const owner = e2.data?.ownerUserId;
      const w30 = dayWindow(30);
      const w7 = dayWindow(7);
      const [e5, e15, e10, r6, p9, ap8, t5, r5, a3] = await Promise.all([
        fetchEffectiveConfig(fetch, id, at),
        fetchEmployeeVersions(fetch, id, 20),
        fetchWorkstations(fetch, id),
        fetchRunStats(fetch, { ...w7, bucket: 'day', employeeId: id }),
        fetchBudgetMonth(fetch, [id], monthPeriod()),
        owner
          ? fetchApprovalStats(fetch, `human:${owner}`)
          : Promise.resolve(null),
        fetch<OverviewQueueBody>('/api/tasks', {
          assignee: `employee:${id}`,
          limit: 20,
        }),
        fetch<OverviewQueueBody>('/api/runs', { employeeId: id, limit: 20 }),
        fetch<{ events?: UnknownRecord[] }>('/api/audit', {
          employeeId: id,
          from: w30.from,
          to: w30.to,
          limit: 20,
        }),
      ]);
      if (!alive) return;
      setConfig(box(e5));
      setVersions(box(e15));
      setStations(box(e10));
      setRuns(box(r6));
      setBudget(box(p9));
      setPending(ap8 === null ? null : box(ap8));
      setTasks(box(t5));
      setRunRows(box(r5));
      setAudit(box(a3));
      setUpdatedAt(fmtTime(new Date().toISOString()));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  if (loading && !detail.ok && detail.status === 0) {
    return (
      <div className="a2s-page" data-testid="agent-v2-employee-detail">
        <p className="a2-meta">{t('agentConsole.v2.loading')}</p>
      </div>
    );
  }

  /* Whole-page access states: 401 re-login hint, 403 explicit forbidden,
   * 404 / unknown = one single copy shared with cross-tenant (no
   * existence leak). Nothing else renders as a fake detail. */
  if (!detail.ok) {
    const code =
      detail.status === 401
        ? 'unauthorized'
        : detail.status === 403
          ? 'forbidden'
          : 'notFound';
    return (
      <div className="a2s-page" data-testid="agent-v2-employee-detail">
        <div className="a2-card" data-testid={`agent-v2-ed-${code}`}>
          <h1 className="a2-h1">{t(`agentConsole.v2.ed.${code}`)}</h1>
          <p className="a2-meta">
            <NavLink className="a2-btn" to="/agent/employees">
              {t('agentConsole.v2.ed.back')}
            </NavLink>
          </p>
        </div>
      </div>
    );
  }

  const d = detail.data ?? { id };
  const name = d.name || d.id;
  const initial = name.slice(0, 1).toUpperCase();
  const currentVersion = (versions.data?.items ?? []).find(
    (v) => v.id === d.currentVersionId
  );
  const chain = [...(versions.data?.items ?? [])].sort(
    (a, b) => b.versionNo - a.versionNo
  );
  const grants = config.data?.grants ?? [];
  const knowledge = currentVersion?.knowledgeScopes ?? [];
  const budgetRow = budget.data?.items?.[0];
  const sums = bucketSum(runs.data?.buckets);
  const runsSpark = sparkPoints(runs.data?.buckets, 7);
  const terminal = sums.succeeded + sums.failed;
  const successRate = terminal > 0 ? sums.succeeded / terminal : null;
  const pendingCount = pending?.ok ? pending.data?.pending ?? null : null;
  const stationItems = stations.data?.items ?? [];

  const kpi = (key: string, value: string, foot: ReactNode) => (
    <div className="a2-kpi" data-testid={`agent-v2-ed-kpi-${key}`}>
      <span className="a2-kpi-num">{value}</span>
      <span className="a2-meta">
        {t(`agentConsole.v2.ed.kpi_${key}`)}
      </span>
      {foot}
    </div>
  );

  return (
    <div className="a2s-page" data-testid="agent-v2-employee-detail">
      {/* header */}
      <div className="a2s-topbar" style={{ justifyContent: 'space-between' }}>
        <h1 className="a2-h1">{name}</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="a2-micro" data-testid="agent-v2-ed-updated">
            {updatedAt
              ? `${t('agentConsole.v2.ed.updated')} ${updatedAt}`
              : ''}
          </span>
          <button
            type="button"
            className="a2-btn"
            data-testid="agent-v2-ed-refresh"
            onClick={refresh}
          >
            {t('agentConsole.v2.ov.refresh')}
          </button>
          <NavLink className="a2-btn" to="/agent/employees" data-testid="agent-v2-ed-back">
            {t('agentConsole.v2.ed.back')}
          </NavLink>
        </div>
      </div>

      {/* identity banner */}
      <div className="a2-card" data-testid="agent-v2-ed-banner" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div
          className="a2-avatar"
          aria-hidden
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'hsl(var(--accent))',
            color: 'hsl(var(--accent-foreground))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {initial}
        </div>
        <div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <strong>{name}</strong>
            <span className="a2-meta">{d.title || '—'}</span>
            <span className="a2-pill" data-testid="agent-v2-ed-lifecycle">
              {t(`agentConsole.v2.ed.lifecycle.${d.lifecycleState ?? 'unknown'}`, {
                defaultValue: d.lifecycleState ?? '—',
              })}
            </span>
          </div>
          <p className="a2-meta" style={{ margin: '4px 0 0' }}>
            {t('agentConsole.v2.ed.bannerOwner')}{' '}
            <span className="a2-mono">{d.ownerUserId ? `human:${d.ownerUserId}` : '—'}</span>
            {' · '}
            {t('agentConsole.v2.ed.bannerRevision', { count: d.revision ?? 0 })}
            {' · '}
            {d.updatedAt ? `${t('agentConsole.v2.ed.bannerUpdated')} ${fmtTime(d.updatedAt)}` : ''}
          </p>
        </div>
      </div>

      {/* horizontal field row */}
      <div
        className="a2-card"
        data-testid="agent-v2-ed-fields"
        style={{ display: 'flex', gap: 0, flexWrap: 'wrap' }}
      >
        {[
          {
            label: t('agentConsole.v2.ed.fieldRole'),
            value: d.title || '—',
          },
          {
            label: t('agentConsole.v2.ed.fieldVersion'),
            value: currentVersion
              ? t('agentConsole.v2.ed.fieldVersionValue', { no: currentVersion.versionNo })
              : '—',
          },
          {
            label: t('agentConsole.v2.ed.fieldEffective'),
            value: currentVersion?.effectiveFrom ? fmtTime(currentVersion.effectiveFrom) : '—',
          },
          {
            label: t('agentConsole.v2.ed.fieldStations'),
            value: stations.ok ? String(stationItems.length) : '—',
          },
          {
            label: t('agentConsole.v2.ed.fieldBudget'),
            value: currentVersion?.budget?.monthlyCostUsd != null
              ? `${fmtUsd(currentVersion.budget.monthlyCostUsd)} / ${t('agentConsole.v2.ed.month')}`
              : '—',
          },
          {
            label: t('agentConsole.v2.ed.fieldKnowledge'),
            value: knowledge.length ? knowledge.join(', ') : '—',
          },
        ].map((f, i) => (
          <div
            key={f.label}
            style={{
              padding: '0 16px',
              borderLeft: i === 0 ? 'none' : '1px solid hsl(var(--border))',
              flex: '1 1 140px',
            }}
          >
            <div className="a2-micro">{f.label}</div>
            <div className="a2-meta" style={{ overflowWrap: 'anywhere' }}>{f.value}</div>
          </div>
        ))}
      </div>

      {/* 4 KPIs */}
      <div className="a2-kpis" data-testid="agent-v2-ed-kpis">
        {kpi(
          'runs',
          runs.ok ? String(sums.runs) : '—',
          runs.ok ? (
            runsSpark ? (
              <KpiSpark points={runsSpark} testId="agent-v2-ed-kpi-runs-spark" />
            ) : (
              <span className="a2-micro">{t('agentConsole.v2.ov.kpiNoSpark')}</span>
            )
          ) : (
            <BlockError
              block={t('agentConsole.v2.ed.kpi_runs')}
              status={runs.status}
              onRetry={refresh}
              retryTestId="agent-v2-ed-retry-runs-kpi"
            />
          )
        )}
        {kpi(
          'success',
          successRate === null ? '—' : `${Math.round(successRate * 100)}%`,
          <span className="a2-micro">{t('agentConsole.v2.ed.kpiSuccessFoot')}</span>
        )}
        {kpi(
          'cost',
          budget.ok && budgetRow?.costUsd != null ? fmtUsd(budgetRow.costUsd) : '—',
          <span className="a2-micro">{t('agentConsole.v2.ed.kpiCostFoot')}</span>
        )}
        {kpi(
          'pending',
          pendingCount === null ? '—' : String(pendingCount),
          pending === null ? (
            <span className="a2-micro">{t('agentConsole.v2.ed.kpiPendingNoOwner')}</span>
          ) : pending.ok ? null : (
            <BlockError
              block={t('agentConsole.v2.ed.kpi_pending')}
              status={pending.status}
              onRetry={refresh}
              retryTestId="agent-v2-ed-retry-pending"
            />
          )
        )}
      </div>

      {/* tabs */}
      <div
        role="tablist"
        data-testid="agent-v2-ed-tabs"
        style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
      >
        {TAB_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className="a2-btn"
            data-testid={`agent-v2-ed-tab-${k}`}
            onClick={() => setTab(k)}
          >
            {t(`agentConsole.v2.ed.tab_${k}`)}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div className="a2-card" data-testid="agent-v2-ed-panel-overview" role="tabpanel">
          {/* version chain: E15 rows only */}
          <h2 className="a2-h2">{t('agentConsole.v2.ed.chainTitle')}</h2>
          {!versions.ok ? (
            <BlockError
              block={t('agentConsole.v2.ed.chainTitle')}
              status={versions.status}
              onRetry={refresh}
              retryTestId="agent-v2-ed-retry-chain"
            />
          ) : chain.length === 0 ? (
            <p className="a2-meta" data-testid="agent-v2-ed-chain-empty">
              {t('agentConsole.v2.ed.chainEmpty')}
            </p>
          ) : (
            <>
              {chain.map((v) => (
                <div
                  key={v.id}
                  className="a2-card-item"
                  data-testid="agent-v2-ed-version-row"
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span className="a2-mono">
                      {t('agentConsole.v2.ed.fieldVersionValue', { no: v.versionNo })}
                    </span>
                    {v.id === d.currentVersionId ? (
                      <span className="a2-pill" data-testid="agent-v2-ed-current-pill">
                        {t('agentConsole.v2.ed.chainCurrent')}
                      </span>
                    ) : null}
                    <span className="a2-micro">
                      {v.effectiveFrom ? fmtTime(v.effectiveFrom) : '—'} →{' '}
                      {v.effectiveTo ? fmtTime(v.effectiveTo) : t('agentConsole.v2.ed.chainUntilNow')}
                    </span>
                  </div>
                  <p className="a2-meta" style={{ overflowWrap: 'anywhere' }}>
                    {v.changeNote || '—'}
                  </p>
                </div>
              ))}
              <p className="a2-micro" data-testid="agent-v2-ed-chain-foot">
                {t('agentConsole.v2.ed.chainFoot')}
              </p>
            </>
          )}

          {/* blast radius: E5 grants + knowledge scopes */}
          <h2 className="a2-h2" style={{ marginTop: 16 }}>
            {t('agentConsole.v2.ed.blastTitle')}
          </h2>
          {!config.ok ? (
            <BlockError
              block={t('agentConsole.v2.ed.blastTitle')}
              status={config.status}
              onRetry={refresh}
              retryTestId="agent-v2-ed-retry-blast"
            />
          ) : grants.length === 0 ? (
            <p className="a2-meta" data-testid="agent-v2-ed-blast-empty">
              {t('agentConsole.v2.ed.blastEmpty')}
            </p>
          ) : (
            <>
              {grants.map((g) => (
                <div key={g.id} className="a2-card-item" data-testid="agent-v2-ed-grant-row">
                  <span className="a2-mono">{g.id}</span>
                  <p className="a2-meta">
                    {g.scopeType ?? '—'} · {(g.resourceSelector?.types ?? []).join('/') || '—'} ·{' '}
                    {(g.actions ?? []).join('/') || '—'}
                    {g.expiresAt
                      ? ` · ${t('agentConsole.v2.ed.blastExpires', { time: fmtTime(g.expiresAt) })}`
                      : ''}
                    {g.source ? ` · ${t('agentConsole.v2.ed.blastSource', { source: g.source })}` : ''}
                  </p>
                </div>
              ))}
              <p className="a2-micro" data-testid="agent-v2-ed-blast-snapshot">
                {t('agentConsole.v2.ed.blastSnapshot', {
                  ref: config.data?.snapshotRef ?? '—',
                  at: config.data?.resolvedAt ? fmtTime(config.data.resolvedAt) : '—',
                })}
              </p>
            </>
          )}

          {/* budget: current version limits + P9 ledger actual */}
          <h2 className="a2-h2" style={{ marginTop: 16 }}>
            {t('agentConsole.v2.ed.budgetTitle')}
          </h2>
          {currentVersion?.budget ? (
            <p className="a2-meta" data-testid="agent-v2-ed-budget-row">
              {t('agentConsole.v2.ed.budgetDailyTokens', {
                count: currentVersion.budget.dailyTokens ?? 0,
              })}{' · '}
              {t('agentConsole.v2.ed.budgetMonthly', {
                usd: fmtUsd(currentVersion.budget.monthlyCostUsd ?? 0),
              })}{' · '}
              {t('agentConsole.v2.ed.budgetPerRun', {
                usd: fmtUsd(currentVersion.budget.perRunMaxUsd ?? 0),
              })}
            </p>
          ) : (
            <p className="a2-meta">—</p>
          )}
          {budget.ok ? (
            <p className="a2-micro" data-testid="agent-v2-ed-budget-actual">
              {budgetRow && budgetRow.costUsd != null
                ? t('agentConsole.v2.ed.budgetActual', { usd: fmtUsd(budgetRow.costUsd) })
                : t('agentConsole.v2.ed.budgetActualMissing')}
            </p>
          ) : (
            <BlockError
              block={t('agentConsole.v2.ed.budgetTitle')}
              status={budget.status}
              onRetry={refresh}
              retryTestId="agent-v2-ed-retry-budget"
            />
          )}

          {/* workstations: E10 */}
          <h2 className="a2-h2" style={{ marginTop: 16 }}>
            {t('agentConsole.v2.ed.stationsTitle')}
          </h2>
          {!stations.ok ? (
            <BlockError
              block={t('agentConsole.v2.ed.stationsTitle')}
              status={stations.status}
              onRetry={refresh}
              retryTestId="agent-v2-ed-retry-stations"
            />
          ) : stationItems.length === 0 ? (
            <p className="a2-meta" data-testid="agent-v2-ed-stations-empty">
              {t('agentConsole.v2.ed.stationsEmpty')}
            </p>
          ) : (
            stationItems.map((s) => (
              <div key={s.id} className="a2-card-item" data-testid="agent-v2-ed-station-row">
                <span className="a2-mono">{s.id}</span>
                <p className="a2-meta">
                  {s.bindingType ?? '—'}
                  {s.channel ? ` · ${s.channel}` : ''}
                  {s.status ? ` · ${s.status}` : ''}
                </p>
              </div>
            ))
          )}

          {/* lifecycle */}
          <h2 className="a2-h2" style={{ marginTop: 16 }}>
            {t('agentConsole.v2.ed.lifecycleTitle')}
          </h2>
          <p className="a2-meta" data-testid="agent-v2-ed-lifecycle-row">
            {t(`agentConsole.v2.ed.lifecycle.${d.lifecycleState ?? 'unknown'}`, {
              defaultValue: d.lifecycleState ?? '—',
            })}
            {d.createdAt ? ` · ${t('agentConsole.v2.ed.bannerCreated')} ${fmtTime(d.createdAt)}` : ''}
            {d.updatedAt ? ` · ${t('agentConsole.v2.ed.bannerUpdated')} ${fmtTime(d.updatedAt)}` : ''}
          </p>
        </div>
      ) : null}

      {tab === 'chat' ? (
        <div className="a2-card" data-testid="agent-v2-ed-panel-chat" role="tabpanel">
          {/* EMP-03 keeps the chat panel read-only: the conversation surface
           * belongs to P1-8 and no real binding exists to open it from here,
           * so no jump button is rendered (honest state, no fake link). */}
          <p className="a2-meta" data-testid="agent-v2-ed-chat-readonly">
            {t('agentConsole.v2.ed.chatReadonly')}
          </p>
        </div>
      ) : null}

      {tab === 'tasks' ? (
        <div className="a2-card" data-testid="agent-v2-ed-panel-tasks" role="tabpanel">
          <h2 className="a2-h2">{t('agentConsole.v2.ed.tasksTitle')}</h2>
          {!tasks.ok ? (
            <BlockError
              block={t('agentConsole.v2.ed.tasksTitle')}
              status={tasks.status}
              onRetry={refresh}
              retryTestId="agent-v2-ed-retry-tasks"
            />
          ) : (tasks.data?.items ?? []).length === 0 ? (
            <p className="a2-meta" data-testid="agent-v2-ed-tasks-empty">
              {t('agentConsole.v2.ed.tasksEmpty')}
            </p>
          ) : (
            (tasks.data?.items ?? []).map((it, i) => (
              <div
                key={str(it, ['id', 'taskId']) || i}
                className="a2-card-item"
                data-testid="agent-v2-ed-task-row"
              >
                <p className="a2-meta">
                  {str(it, ['title', 'name', 'summary']) || '—'} ·{' '}
                  <span className="a2-mono">{str(it, ['status', 'state']) || '—'}</span>
                </p>
              </div>
            ))
          )}
        </div>
      ) : null}

      {tab === 'runs' ? (
        <div className="a2-card" data-testid="agent-v2-ed-panel-runs" role="tabpanel">
          <h2 className="a2-h2">{t('agentConsole.v2.ed.runsTitle')}</h2>
          {!runRows.ok ? (
            <BlockError
              block={t('agentConsole.v2.ed.runsTitle')}
              status={runRows.status}
              onRetry={refresh}
              retryTestId="agent-v2-ed-retry-runslist"
            />
          ) : (runRows.data?.items ?? []).length === 0 ? (
            <p className="a2-meta" data-testid="agent-v2-ed-runs-empty">
              {t('agentConsole.v2.ed.runsEmpty')}
            </p>
          ) : (
            (runRows.data?.items ?? []).map((it, i) => (
              <div
                key={str(it, ['runId', 'id']) || i}
                className="a2-card-item"
                data-testid="agent-v2-ed-run-row"
              >
                <span className="a2-mono">{str(it, ['runId', 'id']) || '—'}</span>
                <p className="a2-meta">
                  <span className="a2-mono">{str(it, ['status']) || '—'}</span>
                  {it.employeeVersionNo != null ? ` · v${String(it.employeeVersionNo)}` : ''}
                </p>
              </div>
            ))
          )}
        </div>
      ) : null}

      {tab === 'audit' ? (
        <div className="a2-card" data-testid="agent-v2-ed-panel-audit" role="tabpanel">
          <h2 className="a2-h2">{t('agentConsole.v2.ed.auditTitle')}</h2>
          {!audit.ok ? (
            <BlockError
              block={t('agentConsole.v2.ed.auditTitle')}
              status={audit.status}
              onRetry={refresh}
              retryTestId="agent-v2-ed-retry-audit"
            />
          ) : (audit.data?.events ?? []).length === 0 ? (
            <p className="a2-meta" data-testid="agent-v2-ed-audit-empty">
              {t('agentConsole.v2.ed.auditEmpty')}
            </p>
          ) : (
            (audit.data?.events ?? []).map((ev, i) => (
              <div
                key={str(ev, ['eventId', 'id']) || i}
                className="a2-card-item"
                data-testid="agent-v2-ed-audit-row"
              >
                <p className="a2-meta">
                  {str(ev, ['occurredAt', 'recordedAt'])
                    ? fmtTime(str(ev, ['occurredAt', 'recordedAt']))
                    : '—'}{' '}
                  · {str(ev, ['action', 'type', 'eventId']) || '—'}
                </p>
              </div>
            ))
          )}
          <p className="a2-micro" data-testid="agent-v2-ed-audit-window">
            {t('agentConsole.v2.ed.auditWindow')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
