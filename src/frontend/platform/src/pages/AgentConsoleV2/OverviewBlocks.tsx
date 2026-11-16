/* OV-01 redo: overview building blocks rebuilt against ov01-target.html.
 * Review annotations are gone (no 参考屏 bar, no dashed "行结构示意" demo
 * row); every value on screen comes from a real BFF response or an honest
 * reason. Queue rows only ever list actionable items — terminal rows are
 * never rendered as pending (MUST 3). Cost block is ONE merged card
 * (total + 30-cell quota + legend + per-employee). Anomalies derive from
 * real aggregates already fetched (window failures, AP8 dueSoon, runs
 * without a ledger row). Activity is a table with localized action names
 * plus the mono raw value, exactly like the target. */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';

import {
  fmtId,
  fmtRatio,
  fmtTime,
  fmtUsd,
  type ApprovalStats,
  type BudgetBody,
  type EmployeeRow,
  type RunStatsBody,
} from './v2Data';

export type UnknownRecord = { [key: string]: unknown };

export interface BlockState<T> {
  loading: boolean;
  ok: boolean;
  status: number;
  code?: string;
  data?: T;
}

export interface OverviewQueueBody {
  items: UnknownRecord[];
  nextCursor?: string;
}

export interface OverviewAuditBody {
  events: UnknownRecord[];
}

export function firstString(item: UnknownRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}

/* ---------- icons (inline SVG, Lucide-style 1.5px stroke, currentColor) ---------- */

const ICON_PATHS: Record<string, React.ReactNode> = {
  clip: (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="m9 14 2 2 4-4" />
    </>
  ),
  act: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  alert: (
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  arrow: (
    <>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </>
  ),
  trend: (
    <>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  shield: (
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a2 2 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a2 2 0 0 1 1 1z" />
  ),
  file: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v5h5" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </>
  ),
  refresh: (
    <>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.36 2.64L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.36-2.64L3 16" />
      <path d="M8 16H3v5" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  className = '',
}: {
  name: keyof typeof ICON_PATHS | string;
  size?: number;
  className?: string;
}) {
  const paths = ICON_PATHS[name];
  if (!paths) return null;
  return (
    <svg
      className={`ov-i ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {paths}
    </svg>
  );
}

/* ---------- width hook (charts draw with real pixel geometry) ---------- */

/* Callback-ref variant: the measured node may mount AFTER this hook first
 * runs (loading branch), so a plain ref + [] deps would never observe it —
 * that bug left the trend chart unmeasured (W=0) and therefore undrawn. */
export function useElementWidth<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return undefined;
    const measure = () => setWidth(el.clientWidth || 0);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width];
}

/* ---------- KPI spark slots (V2.1: slot always exists; no fake curve) ---------- */

export function KpiSpark({ points, testId }: { points: number[]; testId: string }) {
  const w = 118;
  const h = 46;
  const pad = 3;
  const n = points.length;
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = hi === lo ? 1 : hi - lo;
  // C1 P1: pad + <string> used to CONCATENATE ("3"+"18.7"="318.7"), flinging
  // every point but the first outside the 118-wide viewBox — the visible ink
  // was a clipped flat stub. Parenthesise before toFixed so X is numeric.
  const X = (i: number) => (pad + (w - 2 * pad) * (n === 1 ? 0.5 : i / (n - 1))).toFixed(1);
  const Y = (v: number) => (h - pad - (h - 2 * pad) * ((v - lo) / span)).toFixed(1);
  const line = points.map((v, i) => `${i ? 'L' : 'M'}${X(i)} ${Y(v)}`).join('');
  const area = `${line}L${X(n - 1)} ${h - pad}L${X(0)} ${h - pad}Z`;
  return (
    <div className="ov-spark" data-testid={testId}>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={area} className="ov-spark-area" />
        <path d={line} className="ov-spark-line" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

/* Honest "no trend source": an equidistant dot matrix, never a curve. */
export function KpiDots({ testId }: { testId: string }) {
  const w = 118;
  const h = 46;
  const n = 14;
  const gap = w / (n + 1);
  return (
    <div className="ov-dots" data-testid={testId} aria-label="—">
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        {Array.from({ length: n }, (_, i) => (
          <circle key={i} cx={(gap * (i + 1)).toFixed(1)} cy={h / 2} r="1.6" className="ov-dot" />
        ))}
      </svg>
    </div>
  );
}

/* ---------- 30-cell quota segments (D-5 semantics) ---------- */

export function QuotaSegments({
  dayCosts,
  monthDays,
  today,
  limit,
  ariaLabel,
  thin,
}: {
  dayCosts: Map<number, number>;
  monthDays: number;
  today: number;
  limit: number;
  ariaLabel: string;
  thin?: boolean;
}) {
  const { t } = useTranslation();
  const daily = limit / monthDays;
  const cells = [];
  for (let day = 1; day <= monthDays; day += 1) {
    const cost = dayCosts.get(day) ?? 0;
    const label = `${String(day).padStart(2, '0')}`;
    let cls = '';
    let title: string;
    if (cost > 0) {
      const pct = (cost / daily) * 100;
      cls = pct <= 60 ? ' is-a' : pct <= 85 ? ' is-b' : ' is-c';
      title = t('agentConsole.v2.ov.quotaCellFoot', {
        day: label,
        cost: fmtUsd(cost),
        daily: fmtUsd(daily),
        pct: `${Math.round(pct)}%`,
      });
    } else if (day > today) {
      title = t('agentConsole.v2.ov.quotaCellFuture', { day: label });
    } else {
      title = t('agentConsole.v2.ov.quotaCellIdle', { day: label });
    }
    cells.push(<i key={day} className={cls} title={title} />);
  }
  return (
    <div className={`ov-seg30${thin ? ' is-thin' : ''}`} role="img" aria-label={ariaLabel}>
      {cells}
    </div>
  );
}

/* ---------- pending queue (OV-50…54): three sources, actionable only ---------- */

// Terminal task states never render as actionable queue rows (MUST 3):
// dueBefore only says "due date passed", the contract does NOT guarantee the
// filter excludes finished tasks, so the row set is trimmed client-side too.
const TERMINAL_TASK_STATES = new Set([
  'done',
  'closed',
  'cancelled',
  'canceled',
  'completed',
  'archived',
  'succeeded',
  'failed',
  'rejected',
  'approved',
  'consumed',
]);

// status → i18n key (agentConsole.v2.ov.status.*) + pill tone; unknown raw
// values keep their mono form (never fabricated) but render neutral.
const STATUS_KEY: Record<string, string> = {
  pending: 'pending',
  open: 'open',
  in_progress: 'in_progress',
  running: 'running',
  approve: 'approved',
  approved: 'approved',
  reject: 'rejected',
  rejected: 'rejected',
  succeeded: 'succeeded',
  success: 'succeeded',
  failed: 'failed',
  cancelled: 'cancelled',
  canceled: 'canceled',
  paused: 'paused',
};

/* C1 item 8: operators render as bare names (opsadmin / runtime / system).
 * The audit bodies carry prefixed actor ids (human:opsadmin, service:…),
 * so strip the principal prefix for display only — never fabricate. */
export function displayActor(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^(human|service|system|agent):(.+)$/.exec(raw);
  return m ? m[2] : raw;
}

type TFn = (k: string, o?: Record<string, unknown>) => string;

function zhStatus(raw: string | null, t: TFn): { zh: string; mono: boolean; tone: string } {
  if (!raw) return { zh: '—', mono: false, tone: 'nt' };
  const norm = raw.toLowerCase();
  const key = STATUS_KEY[norm];
  if (key) {
    const tone = norm === 'failed' || norm === 'rejected' ? 'dg' : norm === 'approved' || norm === 'succeeded' ? 'ok' : 'nt';
    return { zh: t(`agentConsole.v2.ov.status.${key}`), mono: false, tone };
  }
  return { zh: raw, mono: true, tone: 'nt' };
}

function waitedText(iso: string | null, t: TFn) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const text = h > 0 ? t('agentConsole.v2.ov.waitHm', { h, m: mins % 60 }) : t('agentConsole.v2.ov.waitM', { m: mins });
  return { text, danger: ms > 48 * 3600000 };
}

interface QueueSource {
  id: 'approvals' | 'runs' | 'tasks';
  icon: string;
  title: string;
  unitKey: string;
  hintKey: string;
  goKey: string;
  to: string;
  state: BlockState<OverviewQueueBody>;
  // AP8 count kept next to the list for the consistency check (§4 error).
  truthCount?: number | null;
}

export function QueueBlock({
  sources,
  onRetry,
}: {
  sources: QueueSource[];
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const total = sources.reduce(
    (acc, s) => acc + (s.state.ok ? actionable(s.state.data?.items ?? [], s.id).length : 0),
    0
  );
  return (
    <div className="ov-card" data-testid="agent-v2-ov-queue">
      <div className="ov-card-hd">
        <span className="t">{t('agentConsole.v2.ov.queueTitle')}</span>
        <span className="c" data-testid="agent-v2-ov-queue-count">
          {t('agentConsole.v2.ov.queueCountUnit', { count: total })}
        </span>
        <span className="sp" />
        <span className="hd-note">{t('agentConsole.v2.ov.queueCaliber')}</span>
      </div>
      {sources.map((src) => (
        <QueueRow key={src.id} src={src} onRetry={onRetry} />
      ))}
    </div>
  );
}

function actionable(items: UnknownRecord[], id: QueueSource['id']): UnknownRecord[] {
  if (id !== 'tasks') return items;
  return items.filter((item) => {
    const st = firstString(item, ['status', 'state', 'lifecycleState']);
    return st === null || !TERMINAL_TASK_STATES.has(st.toLowerCase());
  });
}

function QueueRow({ src, onRetry }: { src: QueueSource; onRetry: () => void }) {
  const { t } = useTranslation();
  const items = actionable(src.state.data?.items ?? [], src.id);
  return (
    <div className="ov-qsrc" data-testid={`agent-v2-ov-queue-${src.id}`}>
      <span className="qi">
        <Icon name={src.icon} />
      </span>
      <div className="qt">
        <div className="a">
          {src.title}{' '}
          <span className="ov-pill nt xs a2-mono">{t(`agentConsole.v2.ov.${src.unitKey}`, { count: items.length })}</span>
        </div>
        {src.state.loading ? (
          <div className="qs2">…</div>
        ) : !src.state.ok ? (
          <div className="qs2">
            {src.state.code === 'agent-console.no-uid'
              ? t('agentConsole.v2.ov.queueNoUid')
              : t('agentConsole.v2.ov.queueUnavailable')}
            <button type="button" className="ov-link" data-testid={`agent-v2-ov-retry-queue-${src.id}`} onClick={onRetry}>
              {t('agentConsole.v2.ov.retry')}
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="qs2" data-testid={`agent-v2-ov-queue-${src.id}-empty`}>
            {t(`agentConsole.v2.ov.${src.hintKey}`)}
            {src.id === 'approvals' ? (
              <>
                {' · '}
                <span data-testid="agent-v2-ov-queue-gap-org">{t('agentConsole.v2.ov.queueGapOrgTodos')}</span>
              </>
            ) : null}
            {src.truthCount != null && src.truthCount > 0 ? (
              <span className="ov-warn" data-testid={`agent-v2-ov-queue-${src.id}-mismatch`}>
                {' '}· {t('agentConsole.v2.ov.queueMismatch')}
              </span>
            ) : null}
          </div>
        ) : (
          items.slice(0, 5).map((item, idx) => (
            <div className="ov-ql" key={idx}>
              <span className="l1">
                {(() => {
                  const st = zhStatus(firstString(item, ['status', 'state', 'lifecycleState', 'outcome']), t);
                  return (
                    <span className={`ov-pill ${st.tone} xs${st.mono ? ' a2-mono' : ''}`}>
                      <span className="dot" />
                      {st.zh}
                    </span>
                  );
                })()}
                <span className="nm" title={firstString(item, ['title', 'name', 'resource', 'action']) ?? undefined}>
                  {firstString(item, ['title', 'name', 'resource', 'action']) ?? '—'}
                </span>
                {(() => {
                  const w = waitedText(firstString(item, ['createdAt', 'requestedAt', 'startedAt']), t);
                  return w ? (
                    <span className={`ov-dtl${w.danger ? ' dg' : ' wr'}`}>
                      <Icon name="clock" size={13} />
                      {w.text}
                    </span>
                  ) : null;
                })()}
              </span>
              <span className="l2">
                {firstString(item, ['assignee', 'ownerUserId', 'createdBy']) ? (
                  <span>{firstString(item, ['assignee', 'ownerUserId', 'createdBy'])}</span>
                ) : null}
                <span className="a2-mono">{fmtId(firstString(item, ['approvalId', 'taskId', 'runId', 'id']))}</span>
                <NavLink className="ov-lnk" to={src.to}>
                  {t('agentConsole.v2.ov.queueProcess')}
                  <Icon name="arrow" size={13} />
                </NavLink>
              </span>
            </div>
          ))
        )}
      </div>
      {src.state.ok && items.length > 0 ? (
        <NavLink className="ov-lnk src-go" to={src.to}>
          {t(`agentConsole.v2.ov.${src.goKey}`)}
          <Icon name="arrow" size={13} />
        </NavLink>
      ) : src.state.ok && items.length === 0 && src.state.code !== 'agent-console.no-uid' ? (
        <NavLink className="ov-lnk src-go" to={src.to}>
          {t(`agentConsole.v2.ov.${src.goKey}`)}
          <Icon name="arrow" size={13} />
        </NavLink>
      ) : null}
    </div>
  );
}

/* ---------- merged cost & budget block (G11) ---------- */

function sumCost(items: BudgetBody['items'] | undefined): number | null {
  let sum: number | null = null;
  for (const item of items ?? []) {
    if (typeof item.costUsd === 'number' && Number.isFinite(item.costUsd)) sum = (sum ?? 0) + item.costUsd;
  }
  return sum;
}

export function CostBudgetBlock({
  cost,
  rows,
  dayCosts,
  monthLabel,
  monthDays,
  todayDay,
  unknownRuns,
  onRetry,
}: {
  cost: BlockState<BudgetBody>;
  rows: EmployeeRow[];
  dayCosts: Map<number, number>;
  monthLabel: string;
  monthDays: number;
  todayDay: number;
  unknownRuns: number;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const used = cost.ok ? sumCost(cost.data?.items) : null;
  const missing = cost.data?.missingEmployeeIds?.length ?? 0;
  const limit = useMemo(() => {
    let acc = 0;
    let seen = false;
    for (const row of rows) {
      const d = row.enrichment?.effectiveBudget?.monthlyCostUsd;
      if (typeof d === 'number' && d > 0) {
        acc += d;
        seen = true;
      }
    }
    return seen ? acc : null;
  }, [rows]);
  const bars = useMemo(() => {
    const costOf = new Map<string, number | null | undefined>();
    for (const item of cost.data?.items ?? []) costOf.set(item.employeeId, item.costUsd);
    const out: { employeeId: string; label: string; idTail: string; value: number; denominator: number }[] = [];
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
    return out.sort((a, b) => b.value - a.value);
  }, [cost, rows]);
  const pct = used != null && limit ? (used / limit) * 100 : null;
  const projection =
    used != null && limit && todayDay > 0 && monthDays > 0 ? (used / todayDay) * monthDays : null;
  return (
    <div className="ov-card" id="ov-cost" data-testid="agent-v2-ov-block-cost">
      <div className="ov-card-hd">
        <span className="t">{t('agentConsole.v2.ov.costBudgetTitle')}</span>
        <span className="c a2-mono">{monthLabel}</span>
        <span className="sp" />
        <span className="hd-note">{t('agentConsole.v2.ov.costCaliber')}</span>
      </div>
      {cost.loading ? (
        <div className="ov-buds">…</div>
      ) : !cost.ok ? (
        <div className="ov-buds">
          <p className="a2-meta" data-testid="agent-v2-ov-cost-error">
            {cost.code === 'agent-console.no-employees'
              ? t('agentConsole.v2.ov.noEmployeesNote')
              : t('agentConsole.v2.ov.blockUnavailable', {
                  block: t('agentConsole.v2.ov.costBudgetTitle'),
                  code: cost.status,
                })}
          </p>
          <button type="button" className="a2-btn" data-testid="agent-v2-ov-retry-cost" onClick={onRetry}>
            {t('agentConsole.v2.ov.retry')}
          </button>
        </div>
      ) : (
        <>
          <div className="ov-buds">
            <div className="ov-kr">
              <UsdValue value={used} big />
              <div className="ov-qmeta">
                {pct != null ? (
                  <>
                    <b className="a2-mono">{pct < 10 ? pct.toFixed(1) : Math.round(pct)}%</b>
                    <span>of {fmtUsd(limit)}</span>
                  </>
                ) : (
                  <>
                    <b className="a2-mono">—</b>
                    <span>{t('agentConsole.v2.ov.quotaNoLimit')}</span>
                  </>
                )}
              </div>
            </div>
            {limit != null ? (
              <div className="ov-bud">
                <div className="l">
                  <span className="a2-micro">{t('agentConsole.v2.ov.quotaMicro')}</span>
                  <b className="a2-mono">
                    {fmtUsd(used)} / {limit.toFixed(2)} · {t('agentConsole.v2.ov.quotaRemain', { v: fmtUsd(Math.max(limit - (used ?? 0), 0)) })}
                  </b>
                </div>
                <QuotaSegments
                  dayCosts={dayCosts}
                  monthDays={monthDays}
                  today={todayDay}
                  limit={limit}
                  ariaLabel={t('agentConsole.v2.ov.quotaPctFoot', {
                    pct: pct != null ? `${pct.toFixed(1)}%` : '—',
                    used: fmtUsd(used),
                    limit: fmtUsd(limit),
                  })}
                />
                <div className="ov-qlegend">
                  <span><i className="is-a" />{t('agentConsole.v2.ov.quotaLegendSafe')}</span>
                  <span><i className="is-b" />{t('agentConsole.v2.ov.quotaLegendWarn')}</span>
                  <span><i className="is-c" />{t('agentConsole.v2.ov.quotaLegendOver')}</span>
                  <span><i className="is-i" />{t('agentConsole.v2.ov.quotaLegendIdle')}</span>
                </div>
                {projection != null ? (
                  <p className="ov-h">
                    {t('agentConsole.v2.ov.projection', { v: fmtUsd(projection), days: todayDay })}
                    {missing + unknownRuns > 0
                      ? t('agentConsole.v2.ov.projectionUnknown', { count: missing + unknownRuns })
                      : null}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="a2-meta" data-testid="agent-v2-ov-quota-no-limit">
                {t('agentConsole.v2.ov.quotaNoLimit')}
              </p>
            )}
            {bars.map((bar) => {
              const ratio = bar.value / bar.denominator;
              return (
                <div className="ov-empq" key={bar.employeeId} data-testid="agent-v2-ov-quota-row">
                  <div className="who">
                    <div className="nm">
                      <span className="clip" title={bar.label}>{bar.label}</span>{' '}
                      <span className="a2-mono tail" data-testid="agent-v2-ov-quota-id">{bar.idTail}</span>
                    </div>
                    <div className="rl a2-mono">{t('agentConsole.v2.ov.costLedgerLine')}</div>
                  </div>
                  <span className="bt"><i style={{ width: `${Math.min(ratio, 1) * 100}%` }} /></span>
                  <span className={`pc${ratio >= 0.85 ? ' dg' : ratio >= 0.6 ? ' wr' : ''}`}>{fmtRatio(ratio)}</span>
                  <span className="amt">
                    {fmtUsd(bar.value)} / {fmtUsd(bar.denominator)} ·{' '}
                    {t('agentConsole.v2.ov.quotaRemain', { v: fmtUsd(Math.max(bar.denominator - bar.value, 0)) })}
                  </span>
                </div>
              );
            })}
            {bars.length === 0 ? (
              <p className="a2-meta" data-testid="agent-v2-ov-quota-empty">
                {t('agentConsole.v2.ov.quotaNoDenominator')}
              </p>
            ) : null}
          </div>
          <div className="ov-rule" />
          <div className="ov-rfoot">
            <span className="lg">{t('agentConsole.v2.ov.costFootSuffix')}</span>
            <span className="sp" />
            <NavLink className="ov-lnk" to="/agent/metrics">
              {t('agentConsole.v2.ov.openMetricsCost')}
              <Icon name="arrow" size={13} />
            </NavLink>
          </div>
        </>
      )}
    </div>
  );
}

/* USD with the target's 40px mono split; null renders '—', never 0.00. */
export function UsdValue({ value, big }: { value: number | null; big?: boolean }) {
  if (value == null) return <span className={big ? 'ov-v' : 'a2-mono'}>—</span>;
  const int = Math.floor(value);
  const dec = (value - int).toFixed(2).slice(1);
  return (
    <span className={big ? 'ov-v' : 'a2-mono'}>
      <span className="u">USD</span>
      {int}
      <span className="d">{dec}</span>
    </span>
  );
}

/* ---------- anomaly / alert block (G1) ---------- */

export function AnomalyBlock({
  runs,
  approvals,
  windowLabel,
  unknownRuns,
  budgetOverCount,
  budgetEmpCount,
  scannedAt,
  onRetry,
}: {
  runs: BlockState<RunStatsBody>;
  approvals: BlockState<ApprovalStats>;
  windowLabel: string;
  unknownRuns: number;
  budgetOverCount: number | null;
  budgetEmpCount: number;
  scannedAt: string | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const failed = runs.ok ? sumField(runs.data, 'failed') : null;
  const succeeded = runs.ok ? sumField(runs.data, 'succeeded') : null;
  const dueSoon = approvals.ok ? (approvals.data?.dueSoon ?? null) : null;
  /* A05: 48h backlog has no dedicated field — when AP8 reports zero pending
   * there is provably nothing backlogged; with pending>0 we cannot know, so
   * the honest '—' stays (never fabricate a count). */
  const pendingCount = approvals.ok ? (approvals.data?.pending ?? null) : null;
  const hits =
    (failed != null && failed > 0 ? 1 : 0) +
    (dueSoon != null && dueSoon > 0 ? 1 : 0) +
    (unknownRuns > 0 ? 1 : 0);
  const scan = (
    <div className="ov-scan" data-testid="agent-v2-ov-anomaly-scan">
      <b>
        {t('agentConsole.v2.ov.anomalyScanLine', {
          due: dueSoon ?? '—',
          backlog: pendingCount === 0 ? '0' : '—',
          failed: failed ?? '—',
          total: succeeded != null && failed != null ? succeeded + failed : '—',
          over: budgetOverCount ?? '—',
          emps: budgetEmpCount > 0 ? budgetEmpCount : '—',
          budgetNote: budgetEmpCount === 0 ? t('agentConsole.v2.ov.anomalyBudgetNA') : '',
          noLedger: unknownRuns,
        })}
      </b>
      <br />
      {t('agentConsole.v2.ov.anomalyThreshold')}
    </div>
  );
  return (
    <div className="ov-card" data-testid="agent-v2-ov-block-anomaly">
      <div className="ov-card-hd">
        <span className="t">{t('agentConsole.v2.ov.anomalyTitle')}</span>
        <span className="c a2-mono">{t('agentConsole.v2.ov.anomalyCountUnit', { count: hits })}</span>
        <span className="sp" />
        <span className="hd-note">
          {scannedAt ? t('agentConsole.v2.ov.anomalyScannedAt', { time: fmtTime(scannedAt) }) : ''}
        </span>
      </div>
      {runs.loading || approvals.loading ? (
        <div className="ov-scan">…</div>
      ) : hits === 0 ? (
        <>
          {failed === null || dueSoon === null ? (
            <>
              <p className="ov-empty-line" data-testid="agent-v2-ov-anomaly-runs-state">
                {approvals.code === 'agent-console.no-uid' || runs.code === 'agent-console.no-uid'
                  ? t('agentConsole.v2.ov.noteNoUid')
                  : t('agentConsole.v2.ov.anomalyUnavailable')}
              </p>
              <button
                type="button"
                className="a2-btn ov-xs"
                data-testid="agent-v2-ov-retry-anomaly"
                onClick={onRetry}
              >
                {t('agentConsole.v2.ov.retry')}
              </button>
            </>
          ) : (
            <p className="ov-empty-line" data-testid="agent-v2-ov-anomaly-empty">
              {t('agentConsole.v2.ov.anomalyEmpty')}
            </p>
          )}
          {scan}
        </>
      ) : (
        <>
          {failed != null && failed > 0 ? (
            <div className="ov-arow" data-testid="agent-v2-ov-anomaly-runs">
              <span className="ai dg"><Icon name="alert" size={14} /></span>
              <div className="at">
                <div className="a">{t('agentConsole.v2.ov.anomalyRuns', { count: failed })}</div>
                <div className="ar2">
                  <span className="ov-pill dg xs"><span className="dot" />{windowLabel}</span>
                  {' · '}
                  <NavLink className="ov-lnk" to="/agent/runs">{t('agentConsole.v2.ov.anomalyViewRuns')}</NavLink>
                </div>
              </div>
            </div>
          ) : null}
          {dueSoon != null && dueSoon > 0 ? (
            <div className="ov-arow" data-testid="agent-v2-ov-anomaly-approvals">
              <span className="ai wr"><Icon name="alert" size={14} /></span>
              <div className="at">
                <div className="a">{t('agentConsole.v2.ov.anomalyApprovals', { count: dueSoon })}</div>
                <div className="ar2">
                  <NavLink className="ov-lnk" to="/agent/approvals">{t('agentConsole.v2.ov.queueGoApprovals')}</NavLink>
                </div>
              </div>
            </div>
          ) : null}
          {unknownRuns > 0 ? (
            <div className="ov-arow" data-testid="agent-v2-ov-anomaly-noledger">
              <span className="ai ac"><Icon name="alert" size={14} /></span>
              <div className="at">
                <div className="a">{t('agentConsole.v2.ov.anomalyNoLedger', { count: unknownRuns })}</div>
                <div className="ar2 a2-mono">
                  <span className="ov-pill ac xs">{t('agentConsole.v2.ov.anomalyToneInfo')}</span>
                  {' · '}
                  {t('agentConsole.v2.ov.anomalyRuleAL5')}
                </div>
              </div>
              <NavLink className="a2-btn ov-xs" to="/agent/runs">
                {t('agentConsole.v2.ov.anomalyViewRuns')}
              </NavLink>
            </div>
          ) : null}
          {scan}
        </>
      )}
    </div>
  );
}

function sumField(body: RunStatsBody | undefined, key: 'failed' | 'succeeded'): number | null {
  if (!body) return null;
  let acc = 0;
  for (const b of body.buckets ?? []) acc += typeof b[key] === 'number' ? b[key] : 0;
  return acc;
}

/* ---------- recent activity (OV-A0…A3): table, localized + mono raw ---------- */

// action → i18n key under ov.actions.* (dots become underscores so they
// survive i18next keySeparator). Unknown actions keep a generic localized
// label; the snake_case raw value is always shown in a separate mono line.
function actionMeta(
  action: string | null,
  t: TFn
): { zh: string; srcKey: string; icon: string } {
  const byPrefix: Record<string, { srcKey: string; icon: string }> = {
    employee: { srcKey: 'srcEmployee', icon: 'users' },
    approval: { srcKey: 'srcApproval', icon: 'clip' },
    grant: { srcKey: 'srcGrant', icon: 'shield' },
    budget: { srcKey: 'srcBudget', icon: 'file' },
    run: { srcKey: 'srcRun', icon: 'act' },
  };
  if (!action) return { zh: '—', srcKey: 'sourceAudit', icon: 'file' };
  const prefix = action.split('.')[0];
  const src = byPrefix[prefix] ?? { srcKey: 'sourceAudit', icon: 'file' };
  const key = `agentConsole.v2.ov.actions.${action.replace(/\./g, '_')}`;
  const name = t(key);
  return { zh: name === key ? '' : name, srcKey: src.srcKey, icon: src.icon };
}

const ACTIVITY_LIMIT = 8;

export function ActivityBlock({
  audit,
  onRetry,
}: {
  audit: BlockState<OverviewAuditBody>;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const { rows, truncated } = useMemo(() => {
    const cutoff = Date.now() - 86400000;
    const all: { time: string | null; action: string | null; raw: UnknownRecord }[] = [];
    if (audit.ok) {
      for (const ev of audit.data?.events ?? []) {
        const time = firstString(ev, ['occurredAt', 'recordedAt', 'createdAt']);
        const ms = time ? new Date(time).getTime() : NaN;
        if (Number.isFinite(ms) && ms >= cutoff) {
          all.push({ time, action: firstString(ev, ['action']), raw: ev });
        }
      }
    }
    all.sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''));
    return { rows: all.slice(0, ACTIVITY_LIMIT), truncated: Math.max(all.length - ACTIVITY_LIMIT, 0) };
  }, [audit]);
  return (
    <div className="ov-card" data-testid="agent-v2-ov-block-activity">
      <div className="ov-card-hd">
        <span className="t">{t('agentConsole.v2.ov.activityTitle')}</span>
        <span className="c">{t('agentConsole.v2.ov.activityTitleNote')}</span>
        <span className="sp" />
        <NavLink className="ov-lnk" to="/agent/audit">
          {t('agentConsole.v2.ov.openAuditCenter')}
          <Icon name="arrow" size={13} />
        </NavLink>
      </div>
      {audit.loading ? (
        <div className="ov-scan">…</div>
      ) : !audit.ok ? (
        <div className="ov-buds">
          <p className="a2-meta" data-testid="agent-v2-ov-activity-error">
            {t('agentConsole.v2.ov.activityUnavailable')}
          </p>
          <button type="button" className="a2-btn" data-testid="agent-v2-ov-retry-activity" onClick={onRetry}>
            {t('agentConsole.v2.ov.retry')}
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p className="ov-empty-line" data-testid="agent-v2-ov-activity-empty">
          {t('agentConsole.v2.ov.activityEmpty')}
        </p>
      ) : (
        <>
          <div className="ov-tblwrap">
            <table className="ov-tbl">
              <thead>
                <tr>
                  <th style={{ width: 112 }}>{t('agentConsole.v2.ov.colTime')}</th>
                  <th style={{ width: 96 }}>{t('agentConsole.v2.ov.colSource')}</th>
                  <th>{t('agentConsole.v2.ov.colWhat')}</th>
                  <th className="ov-hide-sm" style={{ width: 120 }}>{t('agentConsole.v2.ov.colActor')}</th>
                  <th style={{ width: 96 }}>{t('agentConsole.v2.ov.colResult')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const meta = actionMeta(row.action, t);
                  const outcome = firstString(row.raw, ['outcome', 'result', 'decision']);
                  const tone = outcome === 'rejected' || row.action?.endsWith('.failed') ? 'dg' : outcome ? 'ok' : 'nt';
                  const resultText = outcome
                    ? zhStatus(outcome, t).zh
                    : row.action?.endsWith('.failed')
                      ? t('agentConsole.v2.trendFailed')
                      : t('agentConsole.v2.ov.resultLogged');
                  return (
                    <tr key={`${row.time}-${idx}`} data-testid="agent-v2-ov-activity-row">
                      <td className="a2-mono ov-nowrap">{row.time ? fmtTime(row.time) : '—'}</td>
                      <td>
                        <span className="ov-src">
                          <Icon name={meta.icon} size={14} />
                          {t(`agentConsole.v2.ov.${meta.srcKey}`)}
                        </span>
                      </td>
                      <td>
                        <div className="ov-actn">
                          <span className="zh" title={row.action ?? undefined}>
                            {meta.zh || t('agentConsole.v2.ov.eventUnknown')}
                          </span>
                          {row.action ? <span className="raw a2-mono">{row.action}</span> : null}
                        </div>
                      </td>
                      <td className="ov-hide-sm ov-clip" title={displayActor(firstString(row.raw, ['actorUserId', 'actor', 'actorId', 'userId'])) ?? undefined}>
                        {displayActor(firstString(row.raw, ['actorUserId', 'actor', 'actorId', 'userId'])) ?? '—'}
                      </td>
                      <td>
                        <span className={`ov-pill ${tone} xs`}>
                          <span className="dot" />
                          {resultText}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {truncated > 0 ? (
            <div className="ov-rfoot">
              <span className="lg" data-testid="agent-v2-ov-activity-truncated">
                {t('agentConsole.v2.ov.queueTruncated', { count: ACTIVITY_LIMIT })}
              </span>
            </div>
          ) : (
            <div className="ov-rule" />
          )}
          <div className="ov-rfoot lg-only">
            <span className="lg">{t('agentConsole.v2.ov.actCaliber')}</span>
          </div>
        </>
      )}
    </div>
  );
}
