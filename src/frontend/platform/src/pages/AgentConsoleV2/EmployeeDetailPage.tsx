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
import { useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useParams, useSearchParams } from 'react-router-dom';

import { userContext } from '@/contexts/userContext';
import { LkIcon } from './listkit/icons';
import { ReqId } from './listkit/ReqId';
import { avatarChar } from './identity';
import { actionDisplay } from './aud01';
import {
  budgetView,
  fmtBeijingFull,
  fmtMoney,
  isUnassignedOwner,
  ownerSlotLabel,
} from './employeesShared';

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
  fmtId,
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

import { HelpTip } from './HelpTip';
import { KpiSpark } from './OverviewBlocks';
import type { OverviewQueueBody } from './OverviewBlocks';

type UnknownRecord = { [key: string]: unknown };

const TASK_STATUS: Record<string, string> = {
  open: 'open',
  in_progress: 'in_progress',
  blocked: 'blocked',
  done: 'done',
  cancelled: 'cancelled',
};
const RUN_STATUS: Record<string, string> = {
  pending: 'pending',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  interrupted: 'interrupted',
};

interface Box<T> {
  loading: boolean;
  ok: boolean;
  status: number;
  code?: string;
  /** S4: the gateway request id when one came back — the error line needs it. */
  rid?: string;
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
    rid: res.requestId,
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
  state,
  onRetry,
  retryTestId,
}: {
  state: Box<unknown>;
  onRetry: () => void;
  retryTestId: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <p className="a2-meta" data-testid={`${retryTestId}-text`}>
        {t('agentConsole.v2.errorQuery')}
      </p>
      <ReqId requestId={state.rid} testId={`${retryTestId}-rid`} />
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
  /* S2: the session identity is the only human name the client may resolve
     without a new endpoint (same convention as TSK-01). */
  const ctx = useContext(userContext) as
    | { user?: { user_id?: number | string; user_name?: string; name?: string; username?: string } }
    | null;
  const currentUid =
    ctx?.user?.user_id === undefined || ctx?.user?.user_id === null
      ? ''
      : String(ctx.user.user_id);
  const currentName = String(ctx?.user?.user_name || ctx?.user?.name || ctx?.user?.username || '');
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
        owner && !isUnassignedOwner(owner)
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
      setUpdatedAt(fmtBeijingFull(new Date().toISOString()));
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

  /* S4: a network/timeout failure (status 0) is NOT a statement about the
   * resource — it gets its own 「未能读取」 card with retry. Only genuine
   * 401/403/404 answers reach the access states below. */
  if (!detail.ok && !detail.loading && detail.status === 0) {
    return (
      <div className="a2s-page" data-testid="agent-v2-employee-detail">
        <div className="a2-card" data-testid="agent-v2-ed-readFailed">
          <h1 className="a2-h1">{t('agentConsole.v2.ed.readFailedTitle')}</h1>
          <p className="a2-meta">{t('agentConsole.v2.ed.readFailedDesc')}</p>
          <p style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" className="a2-btn" data-testid="agent-v2-ed-retry" onClick={refresh}>
              {t('agentConsole.v2.retry')}
            </button>
            <NavLink className="a2-btn" to="/agent/employees">
              {t('agentConsole.v2.ed.back')}
            </NavLink>
            <ReqId requestId={detail.rid} testId="agent-v2-ed-reqid" />
          </p>
        </div>
      </div>
    );
  }

  /* A 5xx means the employee service is unavailable — it says nothing about
   * whether the employee exists, so it must never borrow the 404 copy. */
  if (!detail.ok && detail.status >= 500) {
    return (
      <div className="a2s-page" data-testid="agent-v2-employee-detail">
        <div className="a2-card" data-testid="agent-v2-ed-unavailable">
          <h1 className="a2-h1">{t('agentConsole.v2.ed.readFailedTitle')}</h1>
          <p className="a2-meta">{t('agentConsole.v2.errorQuery')}</p>
          <p style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" className="a2-btn" data-testid="agent-v2-ed-retry" onClick={refresh}>
              {t('agentConsole.v2.retry')}
            </button>
            <NavLink className="a2-btn" to="/agent/employees">
              {t('agentConsole.v2.ed.back')}
            </NavLink>
            <ReqId requestId={detail.rid} testId="agent-v2-ed-unavailable-rid" />
          </p>
        </div>
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
          <ReqId requestId={detail.rid} testId={`agent-v2-ed-${code}-rid`} />
        </div>
      </div>
    );
  }

  const d = detail.data ?? { id };
  /* S2: an empty name reads 「未命名」 — the raw id stays in the id row, never
     as the page's headline identity. */
  const name = d.name?.trim() || t('agentConsole.v2.id.unnamed');
  const initial = avatarChar(name);
  const currentVersion = (versions.data?.items ?? []).find(
    (v) => v.id === d.currentVersionId
  );
  const chain = [...(versions.data?.items ?? [])].sort(
    (a, b) => b.versionNo - a.versionNo
  );
  const grants = config.data?.grants ?? [];
  const knowledge = currentVersion?.knowledgeScopes ?? [];
  /* PRD L5: three honest budget states — configured (at least one finite
     limit), not configured (a budget object with every limit unset), and
     unknown (no budget object at all, shown as '—'). */
  const versionBudget = currentVersion?.budget;
  const budgetShape = budgetView(versionBudget);
  const budgetUnset = t('agentConsole.v2.ed.budgetUnset');
  const budgetRow = budget.data?.items?.[0];
  const sums = bucketSum(runs.data?.buckets);
  const runsSpark = sparkPoints(runs.data?.buckets, 7);
  const terminal = sums.succeeded + sums.failed;
  const successRate = terminal > 0 ? sums.succeeded / terminal : null;
  const pendingCount = pending?.ok ? pending.data?.pending ?? null : null;
  const stationItems = Array.isArray(stations.data?.items) ? stations.data.items : null;

  const kpi = (key: string, value: string, foot: ReactNode, label?: string) => (
    <div className="a2-kpi" data-testid={`agent-v2-ed-kpi-${key}`}>
      <span className="a2-kpi-num">{value}</span>
      <span className="a2-meta">
        {label ?? t(`agentConsole.v2.ed.kpi_${key}`)}
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
          {initial ?? <LkIcon name="user" size={18} />}
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
            {/* S2: readable owner (「用户 #1」/「未知」); the raw combined ref
                stays in the tooltip only, the prefix never prints inline. */}
            {(() => {
              const raw = (d.ownerUserId ?? '').trim();
              const shown = ownerSlotLabel(raw, t, {
                currentUid,
                currentName: currentName || undefined,
              });
              const ref = raw ? (raw.includes(':') ? raw : `human:${raw}`) : '';
              return (
                <span
                  title={ref && !isUnassignedOwner(raw) ? ref : undefined}
                  data-testid="agent-v2-ed-owner"
                >
                  {shown}
                </span>
              );
            })()}
            {!isUnassignedOwner(d.ownerUserId) ? (
              <HelpTip term="humanPrefix" testId="agent-v2-ed-help-owner" />
            ) : null}
            {' · '}
            {d.revision != null
              ? t('agentConsole.v2.ed.bannerRevision', { count: d.revision })
              : '—'}
            {' · '}
            {d.updatedAt ? `${t('agentConsole.v2.ed.bannerUpdated')} ${fmtBeijingFull(d.updatedAt)}` : ''}
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
            value: currentVersion?.effectiveFrom ? fmtBeijingFull(currentVersion.effectiveFrom) : '—',
          },
          {
            label: t('agentConsole.v2.ed.fieldStations'),
            value: stations.ok && stationItems ? String(stationItems.length) : '—',
          },
          {
            label: t('agentConsole.v2.ed.fieldBudget'),
            value:
              budgetShape.kind === 'configured' && budgetShape.monthlyUsd != null
                ? `${fmtMoney(budgetShape.monthlyUsd)} / ${t('agentConsole.v2.ed.month')}`
                : budgetShape.kind === 'unset'
                  ? budgetUnset
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
              state={runs}
              onRetry={refresh}
              retryTestId="agent-v2-ed-retry-runs-kpi"
            />
          ),
          t('agentConsole.v2.ov.kpiWeekRuns')
        )}
        {kpi(
          'success',
          successRate === null ? '—' : `${Math.round(successRate * 100)}%`,
          <span className="a2-micro">{t('agentConsole.v2.ed.kpiSuccessFoot')}</span>,
          `${t('agentConsole.v2.ov.range7d')} · ${t('agentConsole.v2.ed.kpi_success')}`
        )}
        {kpi(
          'cost',
          budget.ok && budgetRow?.costUsd != null ? fmtMoney(budgetRow.costUsd) : '—',
          <span className="a2-micro">{t('agentConsole.v2.ed.kpiCostFoot')}</span>
        )}
        {kpi(
          'pending',
          pendingCount === null ? '—' : String(pendingCount),
          pending === null ? (
            <span className="a2-micro">{t('agentConsole.v2.ed.kpiPendingNoOwner')}</span>
          ) : pending.ok ? null : (
            <BlockError
              state={pending}
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
              state={versions}
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
                      {v.effectiveFrom ? fmtBeijingFull(v.effectiveFrom) : '—'} →{' '}
                      {v.effectiveTo ? fmtBeijingFull(v.effectiveTo) : t('agentConsole.v2.ed.chainUntilNow')}
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
              state={config}
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
                <div
                  key={g.id}
                  className="a2-card-item"
                  data-testid="agent-v2-ed-grant-row"
                  title={[
                    g.scopeType,
                    (g.resourceSelector?.types ?? []).join('/'),
                    (g.actions ?? []).join('/'),
                    g.source,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  <span className="a2-mono">{fmtId(g.id)}</span>
                  <p className="a2-meta">
                    {g.expiresAt
                      ? t('agentConsole.v2.ed.blastExpires', { time: fmtBeijingFull(g.expiresAt) })
                      : '—'}
                  </p>
                </div>
              ))}
              <p className="a2-micro" data-testid="agent-v2-ed-blast-snapshot">
                {t('agentConsole.v2.ed.blastSnapshot', {
                  ref: config.data?.snapshotRef ?? '—',
                  at: config.data?.resolvedAt ? fmtBeijingFull(config.data.resolvedAt) : '—',
                })}
              </p>
            </>
          )}

          {/* budget: current version limits + P9 ledger actual */}
          <h2 className="a2-h2" style={{ marginTop: 16 }}>
            {t('agentConsole.v2.ed.budgetTitle')}
          </h2>
          {budgetShape.kind === 'missing' ? (
            <p className="a2-meta" data-testid="agent-v2-ed-budget-row">
              —
            </p>
          ) : budgetShape.kind === 'configured' ? (
            <p className="a2-meta" data-testid="agent-v2-ed-budget-row">
              {t('agentConsole.v2.ed.budgetDailyTokens', {
                value:
                  budgetShape.dailyTokens != null
                    ? String(budgetShape.dailyTokens)
                    : budgetUnset,
              })}{' · '}
              {t('agentConsole.v2.ed.budgetMonthly', {
                value:
                  budgetShape.monthlyUsd != null
                    ? fmtMoney(budgetShape.monthlyUsd)
                    : budgetUnset,
              })}{' · '}
              {t('agentConsole.v2.ed.budgetPerRun', {
                value:
                  budgetShape.perRunUsd != null
                    ? fmtMoney(budgetShape.perRunUsd)
                    : budgetUnset,
              })}
            </p>
          ) : (
            <p className="a2-meta" data-testid="agent-v2-ed-budget-row">
              {t('agentConsole.v2.ed.budgetNone')}
            </p>
          )}
          {budget.ok ? (
            <p className="a2-micro" data-testid="agent-v2-ed-budget-actual">
              {budgetRow && budgetRow.costUsd != null
                ? t('agentConsole.v2.ed.budgetActual', { usd: fmtMoney(budgetRow.costUsd) })
                : t('agentConsole.v2.ed.budgetActualMissing')}
            </p>
          ) : (
            <BlockError
              state={budget}
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
              state={stations}
              onRetry={refresh}
              retryTestId="agent-v2-ed-retry-stations"
            />
          ) : stationItems == null ? (
            <p className="a2-meta" data-testid="agent-v2-ed-stations-empty">—</p>
          ) : stationItems.length === 0 ? (
            <p className="a2-meta" data-testid="agent-v2-ed-stations-empty">
              {t('agentConsole.v2.ed.stationsEmpty')}
            </p>
          ) : (
            stationItems.map((s) => (
              <div
                key={s.id}
                className="a2-card-item"
                data-testid="agent-v2-ed-station-row"
                title={[s.bindingType, s.channel, s.status].filter(Boolean).join(' · ')}
              >
                <span className="a2-mono">{fmtId(s.id)}</span>
                <p className="a2-meta">
                  {t('agentConsole.v2.ed.stationsTitle')}
                  {s.channel === 'feishu' ? ` · ${t('agentConsole.v2.set01.channelFeishu')}` : ''}
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
            {d.createdAt ? ` · ${t('agentConsole.v2.ed.bannerCreated')} ${fmtBeijingFull(d.createdAt)}` : ''}
            {d.updatedAt ? ` · ${t('agentConsole.v2.ed.bannerUpdated')} ${fmtBeijingFull(d.updatedAt)}` : ''}
          </p>
        </div>
      ) : null}

      {tab === 'chat' ? (
        <div className="a2-card" data-testid="agent-v2-ed-panel-chat" role="tabpanel">
          {/* EMP-03 → CHAT: the conversation lives on its own page and takes
           * the employee id as a query parameter. */}
          <Link
            className="a2-btn"
            to={`/agent/chat?employeeId=${encodeURIComponent(id)}`}
            data-testid="agent-v2-ed-chat-link"
          >
            {t('agentConsole.v2.navChat')}
          </Link>
        </div>
      ) : null}

      {tab === 'tasks' ? (
        <div className="a2-card" data-testid="agent-v2-ed-panel-tasks" role="tabpanel">
          <h2 className="a2-h2">{t('agentConsole.v2.ed.tasksTitle')}</h2>
          {!tasks.ok ? (
            <BlockError
              state={tasks}
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
                  {(() => {
                    const raw = str(it, ['status', 'state']);
                    return raw && TASK_STATUS[raw] ? t(`agentConsole.v2.tsk.statusLabel.${TASK_STATUS[raw]}`) : '—';
                  })()}
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
              state={runRows}
              onRetry={refresh}
              retryTestId="agent-v2-ed-retry-runslist"
            />
          ) : (runRows.data?.items ?? []).length === 0 ? (
            <p className="a2-meta" data-testid="agent-v2-ed-runs-empty">
              {t('agentConsole.v2.ed.runsEmpty')}
            </p>
          ) : (
            (runRows.data?.items ?? []).map((it, i) => {
              const runId = str(it, ['runId', 'id']);
              const rawStatus = str(it, ['status']);
              const statusKey = rawStatus && RUN_STATUS[rawStatus];
              return (
                <div
                  key={runId || i}
                  className="a2-card-item"
                  data-testid="agent-v2-ed-run-row"
                  title={rawStatus ?? undefined}
                >
                  {runId ? (
                    <NavLink className="a2-mono" to={`/agent/runs/${encodeURIComponent(runId)}`}>
                      {fmtId(runId)}
                    </NavLink>
                  ) : (
                    <span className="a2-mono">—</span>
                  )}
                  <p className="a2-meta">
                    {statusKey ? t(`agentConsole.runs.status.${statusKey}`) : '—'}
                    {it.employeeVersionNo != null ? ` · v${String(it.employeeVersionNo)}` : ''}
                  </p>
                </div>
              );
            })
          )}
        </div>
      ) : null}

      {tab === 'audit' ? (
        <div className="a2-card" data-testid="agent-v2-ed-panel-audit" role="tabpanel">
          <h2 className="a2-h2">{t('agentConsole.v2.ed.auditTitle')}</h2>
          {!audit.ok ? (
            <BlockError
              state={audit}
              onRetry={refresh}
              retryTestId="agent-v2-ed-retry-audit"
            />
          ) : (audit.data?.events ?? []).length === 0 ? (
            <p className="a2-meta" data-testid="agent-v2-ed-audit-empty">
              {t('agentConsole.v2.ed.auditEmpty')}
            </p>
          ) : (
            (audit.data?.events ?? []).map((ev, i) => {
              const evId = str(ev, ['eventId', 'id']);
              const rawAction = str(ev, ['action', 'type']);
              const label = actionDisplay(rawAction, t) ?? t('agentConsole.v2.ov.sourceAudit');
              return (
                <div
                  key={evId || i}
                  className="a2-card-item"
                  data-testid="agent-v2-ed-audit-row"
                  title={rawAction ?? undefined}
                >
                  <p className="a2-meta">
                    {str(ev, ['occurredAt', 'recordedAt'])
                      ? fmtBeijingFull(str(ev, ['occurredAt', 'recordedAt']))
                      : '—'}{' '}
                    ·{' '}
                    {evId ? (
                      <NavLink to={`/agent/audit/${encodeURIComponent(evId)}`}>{label}</NavLink>
                    ) : (
                      label
                    )}
                  </p>
                </div>
              );
            })
          )}
          <p className="a2-micro" data-testid="agent-v2-ed-audit-window">
            {t('agentConsole.v2.ed.auditWindow')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
