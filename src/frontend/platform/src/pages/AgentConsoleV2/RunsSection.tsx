/**
 * RUN-01 `/agent/runs` — read-only run list, rebuilt against the frozen C1
 * baseline run01-target.html (sha 1cbe1633…) + RUN01-TARGET-SPEC.md.
 *
 * Shape (spec §1): page head (NO KPI layer — R5 has no total) → meta row →
 * FilterBar (only real server dimensions) → one 10-column table card →
 * cursor foot (「本页 N 条 · 下一页」, never 「共 N」) → caliber foot.
 * Structure comes from the shared list suite (./listkit), built once for
 * RUN-01/TSK-01/MET-01.
 *
 * Honest-data rules (ACCEPTANCE.md + spec §2/§7):
 * - R5 is the main source; every request carries `since` (default 7d, always
 *   sent — upstream rejects filter-less queries with 400 request.missing_filter,
 *   which is surfaced as a localized in-page error, never silently widened).
 * - `nextCursor` is consumed explicitly by the 「下一页」 button only; the
 *   replay guard lives in useCursorList (spec §7 first red line).
 * - Nullable columns (costUsd/costStatus/employeeVersionNo/endedAt) are filled
 *   per-row lazily from R2 (/api/run-detail) — never batch, never prefetch,
 *   never blocking first paint; a failed fill keeps —/unknown + inline retry.
 * - costUsd renders verbatim (0.009875 never becomes 0.00); costStatus
 *   `unknown` renders the literal word (never 0, never —); double-null is —.
 * - Durations only exist when endedAt exists; times are Asia/Shanghai
 *   MM-DD HH:mm; unknown status enums are logged loudly and rendered raw.
 * - No write entries anywhere (R4 belongs elsewhere); 「查看」 stays disabled
 *   with a reason until RUN-02 exists; no R3 consumption on this page.
 * - Filters + cursor live in the URL query (employeeId/status/since/limit/
 *   cursor); foreign markers like ?src=ov are neither consumed nor errored.
 *   A URL-restored cursor is a fresh first request (spec §2.4 known limit).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { AgentConsoleApi, EmployeeSummary } from '@/controllers/API/agent';
import {
  type AgentConsoleRunsApi,
  type Run,
  type RunStatus,
} from '@/controllers/API/agentConsoleRuns';

import {
  CopyId,
  CursorFoot,
  EmptyPanel,
  FilterBar,
  LkIcon,
  ListSkeleton,
  StageCard,
  TableCard,
  useCursorList,
  type LkColumn,
} from './listkit';

/** RunStatus contract enum, in filter order (agentrun_models.py). */
const RUN_STATUSES: RunStatus[] = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
];

/** Frozen run-status labels, already present in all three locales. */
const RUN_STATUS_LABEL_KEYS: Record<RunStatus, string> = {
  pending: 'agentConsole.runs.status.pending',
  running: 'agentConsole.runs.status.running',
  completed: 'agentConsole.runs.status.completed',
  failed: 'agentConsole.runs.status.failed',
  cancelled: 'agentConsole.runs.status.cancelled',
  interrupted: 'agentConsole.runs.status.interrupted',
};

/** Chip tone classes (target §1.3): dot keeps the semantic color when选中. */
const STATUS_CHIP_TONE: Record<RunStatus, string> = {
  pending: 's-pend',
  running: 's-run',
  completed: 's-done',
  failed: 's-fail',
  cancelled: 's-cancel',
  interrupted: 's-int',
};

/** Pill tone (spec §2.1, same mapping as the frozen RunsSection). */
function statusPillClass(status: string): string {
  if (status === 'completed') return 'ok';
  if (status === 'pending' || status === 'running') return 'wr';
  if (status === 'failed' || status === 'cancelled' || status === 'interrupted') return 'dg';
  return '';
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

/** since windows: the URL carries the relative key; requests carry the ISO
 *  start computed at send time (spec §1.3: 24h/7d/30d 换算 ISO 起点). */
const SINCE_WINDOWS = [
  { value: '24h', hours: 24, labelKey: 'agentConsole.v2.runs01.since24h', windowKey: 'agentConsole.v2.runs01.window24h' },
  { value: '7d', hours: 24 * 7, labelKey: 'agentConsole.v2.runs01.since7d', windowKey: 'agentConsole.v2.runs01.window7d' },
  { value: '30d', hours: 24 * 30, labelKey: 'agentConsole.v2.runs01.since30d', windowKey: 'agentConsole.v2.runs01.window30d' },
] as const;
type SinceValue = (typeof SINCE_WINDOWS)[number]['value'];

const LIMITS = [20, 50, 100];
const DEFAULT_LIMIT = 20;
const DEFAULT_SINCE: SinceValue = '7d';
/** E11 candidate page size (spec §1.3: GET /api/employees?limit=100). */
const EMPLOYEES_LIMIT = 100;

function sinceIso(window: SinceValue): string {
  const hours = SINCE_WINDOWS.find((w) => w.value === window)?.hours ?? 24 * 7;
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

// ---------- URL query (spec §2.4: only these five params are consumed) ----------

interface RunsQuery {
  employeeId: string;
  status: string;
  since: SinceValue;
  limit: number;
  cursor: string | null;
}

function readRunsQuery(initialEmployeeId?: string | null): RunsQuery {
  let p = new URLSearchParams();
  try {
    p = new URLSearchParams(window.location.search);
  } catch {
    /* non-browser环境: defaults below */
  }
  const since = p.get('since');
  const limit = Number(p.get('limit'));
  const status = p.get('status') ?? '';
  return {
    employeeId: initialEmployeeId || p.get('employeeId') || '',
    status: (RUN_STATUSES as string[]).includes(status) ? status : '',
    since: SINCE_WINDOWS.some((w) => w.value === since) ? (since as SinceValue) : DEFAULT_SINCE,
    limit: LIMITS.includes(limit) ? limit : DEFAULT_LIMIT,
    cursor: p.get('cursor') || null,
  };
}

function writeRunsQuery(q: RunsQuery): void {
  try {
    const p = new URLSearchParams(window.location.search);
    // Foreign markers (?src=ov …) are preserved untouched — not consumed.
    if (q.employeeId) p.set('employeeId', q.employeeId);
    else p.delete('employeeId');
    if (q.status) p.set('status', q.status);
    else p.delete('status');
    p.set('since', q.since);
    p.set('limit', String(q.limit));
    if (q.cursor) p.set('cursor', q.cursor);
    else p.delete('cursor');
    const qs = p.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  } catch {
    /* history unavailable: filters still work in-memory */
  }
}

// ---------- formatting (field names are law; no fabricated values) ----------

/** runId: prefix + ULID first4 … last4 (spec §5.1); full value in title/copy. */
function shortRunId(id: string): string {
  if (id.startsWith('rn_') && id.length > 11) return `${id.slice(0, 7)}…${id.slice(-4)}`;
  if (id.length <= 9) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

/** channelEventId: first6 … last4 (target §1.4 column 6). */
function shortEventId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

const SHANGHAI_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Asia/Shanghai MM-DD HH:mm (current-year convention, same as TSK/OV). */
function formatMoment(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const parts: Record<string, string> = {};
  for (const p of SHANGHAI_PARTS.formatToParts(new Date(ms))) parts[p.type] = p.value;
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** endedAt − startedAt, human-compact. No end ⇒ —, never a fake duration. */
function formatDuration(startedAt?: string | null, endedAt?: string | null): string {
  if (!startedAt || !endedAt) return '—';
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

/** Raw upstream figure, never re-rounded (0.009875 must not render as 0.00). */
function formatCost(costUsd?: number | null): string {
  return typeof costUsd === 'number' && Number.isFinite(costUsd) ? String(costUsd) : '—';
}

function runStatusLabel(t: TFunction, status: string): string {
  const key = RUN_STATUS_LABEL_KEYS[status as RunStatus];
  if (key === undefined) {
    console.error('[AgentConsoleV2] unknown run status:', status);
    return status;
  }
  return t(key);
}

/** 10 columns, fixed order (AC §3); widths from target §4.1. */
function buildColumns(t: TFunction): LkColumn[] {
  return [
    { key: 'run', label: t('agentConsole.v2.runs01.colRun') },
    { key: 'employee', label: t('agentConsole.v2.runs01.colEmployee'), width: 112 },
    { key: 'status', label: t('agentConsole.v2.runs01.colStatus'), width: 96 },
    { key: 'duration', label: t('agentConsole.v2.runs01.colDuration'), width: 80, align: 'right' },
    { key: 'cost', label: t('agentConsole.v2.runs01.colCost'), width: 148, align: 'right' },
    { key: 'source', label: t('agentConsole.v2.runs01.colSource'), width: 128 },
    { key: 'version', label: t('agentConsole.v2.runs01.colVersion'), width: 60, align: 'right' },
    { key: 'start', label: t('agentConsole.v2.runs01.colStart'), width: 110, align: 'right' },
    { key: 'end', label: t('agentConsole.v2.runs01.colEnd'), width: 110, align: 'right' },
    { key: 'action', label: t('agentConsole.v2.runs01.colAction'), width: 72 },
  ];
}

type FillBox = { phase: 'loading' } | { phase: 'ok'; run: Run } | { phase: 'error' };

export interface RunsSectionProps {
  /** R5/R2 read-only adapter (injectable for tests, HTTP fallback on the page). */
  api: AgentConsoleRunsApi;
  /** E11 only: employee names for the rows and the filter select. */
  consoleApi: AgentConsoleApi;
  /** Set when entering from an employee's 「查看运行」 action. */
  initialEmployeeId?: string | null;
}

export function RunsSection({ api, consoleApi, initialEmployeeId }: RunsSectionProps) {
  const { t } = useTranslation();

  const [query, setQuery] = useState<RunsQuery>(() => readRunsQuery(initialEmployeeId));
  const [employees, setEmployees] = useState<EmployeeSummary[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  /** R2 per-row lazy fills (never batch, never blocking first paint). */
  const [fills, setFills] = useState<Record<string, FillBox>>({});
  const fillRequestedRef = useRef<Set<string>>(new Set());

  // 401 → login (the login page lives at "/"); never an in-page state.
  const onAuth = useCallback(() => {
    window.location.assign('/');
  }, []);

  const resetKey = `${query.employeeId}|${query.status}|${query.since}|${query.limit}`;

  const fetchPage = useCallback(
    (cursor: string | null) =>
      api.listRuns({
        employeeId: query.employeeId || undefined,
        status: query.status || undefined,
        // since is ALWAYS sent (default 7d) — the upstream hard requirement.
        since: sinceIso(query.since),
        limit: query.limit,
        cursor: cursor ?? undefined,
      }),
    [api, query.employeeId, query.status, query.since, query.limit],
  );

  const list = useCursorList<Run>({
    fetchPage,
    keyOf: (r) => r.runId,
    resetKey,
    initialCursor: query.cursor,
    onAuth,
  });

  // Filter change: clear cursor + seen pages (the hook resets on resetKey)
  // and write the five params back to the URL.
  const updateFilters = useCallback((patch: Partial<RunsQuery>) => {
    setQuery((prev) => {
      const next = { ...prev, ...patch, cursor: null };
      writeRunsQuery(next);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    updateFilters({ employeeId: '', status: '', since: DEFAULT_SINCE, limit: DEFAULT_LIMIT });
  }, [updateFilters]);

  // Explicit next-page: record the consumed cursor in the URL (replaceState),
  // then let the hook fetch it. No automatic loading anywhere.
  const onNext = useCallback(() => {
    if (!list.nextCursor) return;
    setQuery((prev) => {
      const next = { ...prev, cursor: list.nextCursor };
      writeRunsQuery(next);
      return next;
    });
    list.loadNext();
  }, [list]);

  const onReloadFirst = useCallback(() => {
    setQuery((prev) => {
      const next = { ...prev, cursor: null };
      writeRunsQuery(next);
      return next;
    });
    list.reloadFirst();
  }, [list]);

  // E11 candidates for the employee select + row names. Cosmetic failure
  // degrades to the raw employeeId (a real value, never a fabricated name).
  useEffect(() => {
    let live = true;
    consoleApi
      .listEmployees({ limit: EMPLOYEES_LIMIT })
      .then((res) => {
        if (live && res && Array.isArray(res.items)) setEmployees(res.items);
      })
      .catch(() => {
        /* names degrade to raw ids */
      });
    return () => {
      live = false;
    };
  }, [consoleApi]);

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of employees ?? []) map.set(e.employeeId, e.name);
    return map;
  }, [employees]);

  // Freshness stamp: only set when a real page landed.
  useEffect(() => {
    if (list.phase === 'ok') setUpdatedAt(formatMoment(new Date().toISOString()));
  }, [list.phase, list.items]);

  // Filter changes drop the previous query's lazy fills.
  useEffect(() => {
    fillRequestedRef.current = new Set();
    setFills({});
  }, [resetKey]);

  const fetchFill = useCallback(
    (runId: string) => {
      setFills((prev) => ({ ...prev, [runId]: { phase: 'loading' } }));
      api
        .getRunDetail({ id: runId })
        .then((res) => {
          if (res.ok && res.data) {
            setFills((prev) => ({ ...prev, [runId]: { phase: 'ok', run: res.data as Run } }));
          } else {
            setFills((prev) => ({ ...prev, [runId]: { phase: 'error' } }));
          }
        })
        .catch(() => {
          setFills((prev) => ({ ...prev, [runId]: { phase: 'error' } }));
        });
    },
    [api],
  );

  // R2 lazy fill: terminal runs missing nullable columns only. Non-terminal
  // runs legitimately have no endedAt/cost yet — no request, no fabricated 0.
  useEffect(() => {
    if (list.phase !== 'ok') return;
    for (const r of list.items) {
      if (!TERMINAL_STATUSES.has(r.status)) continue;
      const missing =
        r.costUsd == null || r.costStatus == null || r.endedAt == null || r.employeeVersionNo == null;
      if (!missing || fillRequestedRef.current.has(r.runId)) continue;
      fillRequestedRef.current.add(r.runId);
      fetchFill(r.runId);
    }
  }, [list.phase, list.items, fetchFill]);

  const columns = useMemo(() => buildColumns(t), [t]);
  const hasFilter = query.employeeId !== '' || query.status !== '';
  const sinceWindow = SINCE_WINDOWS.find((w) => w.value === query.since) ?? SINCE_WINDOWS[1];

  const employeeLabel = query.employeeId
    ? t('agentConsole.v2.runs01.filterEmployeeValue', {
        name: names.get(query.employeeId) ?? query.employeeId,
      })
    : t('agentConsole.v2.runs01.filterEmployee');

  // ---------- state screens ----------

  if (list.phase === 'loading') {
    return (
      <div className="lk" data-testid="agent-v2-runs">
        <PageHead t={t} updatedAt={updatedAt} />
        <ListSkeleton
          ariaLabel={t('agentConsole.v2.runs01.loadingAria')}
          note={t('agentConsole.v2.runs01.loadingNote')}
        />
      </div>
    );
  }

  if (list.phase === 'error') {
    const code = list.httpStatus;
    const desc =
      code === 400 ? (
        t('agentConsole.v2.runs01.errorDesc400')
      ) : code > 0 ? (
        <>
          {t('agentConsole.v2.runs01.errorDescPre')}
          <span className="mono">HTTP {code}</span>
          {t('agentConsole.v2.runs01.errorDescPost')}
        </>
      ) : (
        t('agentConsole.v2.runs01.errorDescNetwork')
      );
    return (
      <div className="lk" data-testid="agent-v2-runs">
        <PageHead t={t} updatedAt={updatedAt} />
        <StageCard icon="alert" title={t('agentConsole.v2.runs01.errorTitle')} desc={desc} testId="agent-v2-runs-error">
          <button type="button" className="b out" data-testid="agent-v2-runs-retry" onClick={onReloadFirst}>
            <LkIcon name="refresh" size={16} />
            {t('agentConsole.v2.runs01.reload')}
          </button>
          {code !== 400 ? (
            <a className="lnk" href="/agent" style={{ alignSelf: 'center' }}>
              {t('agentConsole.v2.runs01.backOverview')}
            </a>
          ) : null}
        </StageCard>
      </div>
    );
  }

  if (list.phase === 'forbidden') {
    // 403 and 404 share the SAME body — only the HTTP code differs (no
    // existence leak). No data row is ever rendered here.
    return (
      <div className="lk" data-testid="agent-v2-runs">
        <PageHead t={t} updatedAt={updatedAt} />
        <StageCard
          icon="lock"
          title={t('agentConsole.v2.runs01.forbiddenTitle')}
          desc={
            <>
              {t('agentConsole.v2.runs01.forbiddenDescPre')}
              <span className="mono">HTTP {list.httpStatus}</span>
              {t('agentConsole.v2.runs01.forbiddenDescPost')}
            </>
          }
          testId="agent-v2-runs-forbidden"
        >
          <button type="button" className="b out" data-testid="agent-v2-runs-forbidden-retry" onClick={onReloadFirst}>
            <LkIcon name="refresh" size={16} />
            {t('agentConsole.v2.runs01.forbiddenRetry')}
          </button>
        </StageCard>
      </div>
    );
  }

  // ---------- normal / empty (filters stay on screen in both) ----------

  const filterSummary = [
    query.employeeId ? (names.get(query.employeeId) ?? query.employeeId) : null,
    query.status ? runStatusLabel(t, query.status) : null,
    t(sinceWindow.windowKey),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="lk" data-testid="agent-v2-runs">
      <PageHead t={t} updatedAt={updatedAt} />

      <FilterBar
        ariaLabel={t('agentConsole.v2.runs01.filterAria')}
        selectsBefore={[
          {
            id: 'agent-v2-runs-filter-employee',
            label: employeeLabel,
            title: t('agentConsole.v2.runs01.filterEmployeeTitle'),
            value: query.employeeId,
            active: query.employeeId !== '',
            options: [
              { value: '', label: t('agentConsole.v2.runsFilterAll') },
              ...(employees ?? []).map((e) => ({ value: e.employeeId, label: e.name })),
            ],
            onChange: (v) => updateFilters({ employeeId: v }),
          },
        ]}
        chips={{
          ariaLabel: t('agentConsole.v2.runs01.filterStatus'),
          allValue: '',
          allLabel: t('agentConsole.v2.runsFilterAll'),
          value: query.status,
          items: RUN_STATUSES.map((s) => ({
            value: s,
            label: t(RUN_STATUS_LABEL_KEYS[s]),
            tone: STATUS_CHIP_TONE[s],
            dot: true,
          })),
          onChange: (v) => updateFilters({ status: v }),
        }}
        seg={{
          ariaLabel: t('agentConsole.v2.runs01.filterSince'),
          items: SINCE_WINDOWS.map((w) => ({ value: w.value, label: t(w.labelKey) })),
          value: query.since,
          onChange: (v) => updateFilters({ since: v as SinceValue }),
        }}
        selectsAfter={[
          {
            id: 'agent-v2-runs-filter-limit',
            label: t('agentConsole.v2.runs01.filterLimit', { n: query.limit }),
            title: t('agentConsole.v2.runs01.filterLimitTitle'),
            value: String(query.limit),
            options: LIMITS.map((n) => ({
              value: String(n),
              label: t('agentConsole.v2.runs01.filterLimit', { n }),
            })),
            onChange: (v) => updateFilters({ limit: Number(v) }),
          },
          {
            id: 'agent-v2-runs-filter-source',
            label: t('agentConsole.v2.runs01.filterSource'),
            value: '',
            options: [],
            onChange: () => undefined,
            disabled: true,
            disabledTitle: t('agentConsole.v2.runs01.filterSourceDisabled'),
          },
        ]}
        clear={{
          label: t('agentConsole.v2.runs01.clear'),
          disabled: !hasFilter,
          title: hasFilter
            ? t('agentConsole.v2.runs01.clearTitle')
            : t('agentConsole.v2.runs01.clearDisabledTitle'),
          onClear: clearFilters,
        }}
        count={{
          pre: t('agentConsole.v2.runs01.loadedPre'),
          post: t('agentConsole.v2.runs01.loadedPost'),
          n: list.items.length,
        }}
      />

      {list.items.length === 0 ? (
        <EmptyPanel
          title={t('agentConsole.v2.runs01.emptyTitle')}
          desc={
            hasFilter
              ? t('agentConsole.v2.runs01.emptyDescFiltered', { filters: filterSummary })
              : t('agentConsole.v2.runs01.emptyDescPlain')
          }
          actionLabel={hasFilter ? t('agentConsole.v2.runs01.emptyClear') : undefined}
          onAction={hasFilter ? clearFilters : undefined}
        />
      ) : (
        <TableCard
          ariaLabel={t('agentConsole.v2.runs01.tableAria')}
          columns={columns}
          foot={
            <CursorFoot
              pageRowsText={t('agentConsole.v2.runs01.pageRows', { n: list.items.length })}
              noteText={t('agentConsole.v2.runs01.cursorNote', { n: query.limit })}
              hintText={t('agentConsole.v2.runs01.tblHint')}
              nextLabel={t('agentConsole.v2.runs01.next')}
              nextTitle={t('agentConsole.v2.runs01.nextTitle')}
              lastPageTitle={t('agentConsole.v2.runs01.lastPageTitle')}
              hasNext={list.nextCursor !== null}
              loadingMore={list.loadingMore}
              onNext={onNext}
              stale={list.stale}
              staleTitle={t('agentConsole.v2.runs01.staleTitle')}
              staleDesc={t('agentConsole.v2.runs01.staleDesc')}
              staleReloadLabel={t('agentConsole.v2.runs01.staleReload')}
              onReloadFirst={onReloadFirst}
              nextErrorText={
                list.nextError !== null
                  ? list.nextError > 0
                    ? t('agentConsole.v2.runs01.nextError', { code: list.nextError })
                    : t('agentConsole.v2.runs01.nextErrorNetwork')
                  : null
              }
              retryLabel={t('agentConsole.v2.runs01.nextRetry')}
              caliberText={t('agentConsole.v2.runs01.caliber')}
            />
          }
        >
          {list.items.map((row) => (
            <RunRow
              key={row.runId}
              run={row}
              fill={fills[row.runId]}
              onRetryFill={fetchFill}
              name={names.get(row.employeeId)}
              t={t}
            />
          ))}
        </TableCard>
      )}

      <div className="pfoot">
        <span>{t('agentConsole.v2.runs01.footSource')}</span>
        <span className="sp" aria-hidden="true" />
        <span>{t('agentConsole.v2.runs01.footCaliber')}</span>
      </div>
    </div>
  );
}

/** Page head + meta row (no KPI layer, no write buttons, no 「待接入」). */
function PageHead({ t, updatedAt }: { t: TFunction; updatedAt: string | null }) {
  return (
    <>
      <div className="phead">
        <div>
          <h1 className="h1">{t('agentConsole.v2.navRuns')}</h1>
          <p className="sub">{t('agentConsole.v2.runs01.sub')}</p>
        </div>
      </div>
      <div className="fresh">
        <LkIcon name="clock" size={13} />
        <span>
          {t('agentConsole.v2.runs01.freshUpdated')} <span className="mono">{updatedAt ?? '—'}</span>
        </span>
        <span className="faint">·</span>
        <span>
          {t('agentConsole.v2.runs01.freshSource')} <span className="mono">GET /api/runs</span> (R5) ·{' '}
          {t('agentConsole.v2.runs01.freshReadonly')}
        </span>
      </div>
    </>
  );
}

interface RunRowProps {
  run: Run;
  fill?: FillBox;
  onRetryFill: (runId: string) => void;
  name?: string;
  t: TFunction;
}

/** One 10-column row. R5 is the main source; an ok R2 fill overlays the
 *  nullable columns only. Every truncated value keeps its full form in title. */
function RunRow({ run, fill, onRetryFill, name, t }: RunRowProps) {
  const filled = fill?.phase === 'ok' ? fill.run : null;
  const costUsd = filled ? (filled.costUsd ?? run.costUsd) : run.costUsd;
  const costStatus = filled ? (filled.costStatus ?? run.costStatus) : run.costStatus;
  const versionNo = filled ? (filled.employeeVersionNo ?? run.employeeVersionNo) : run.employeeVersionNo;
  const endedAt = filled ? (filled.endedAt ?? run.endedAt) : run.endedAt;

  const statusLabel = runStatusLabel(t, run.status);
  const pillCls = statusPillClass(run.status);
  const statusHintKey = `agentConsole.v2.runs01.statusHint.${run.status}`;
  const displayName = name ?? run.employeeId;

  const duration = formatDuration(run.startedAt, endedAt);
  const durationTitle =
    duration === '—'
      ? t('agentConsole.v2.runs01.durationNone')
      : `${run.startedAt} → ${endedAt}`;

  return (
    <tr title={run.runId} data-testid="agent-v2-runs-row">
      <td>
        <CopyId
          value={run.runId}
          display={shortRunId(run.runId)}
          ariaLabel={t('agentConsole.v2.runs01.copyAria')}
          copiedLabel={t('agentConsole.v2.runs01.copied')}
          testId="agent-v2-runs-id"
        />
      </td>
      <td className="lk-td-who">
        <span className="who" title={run.employeeId} data-testid="agent-v2-runs-employee">
          <span className="ava" aria-hidden="true">
            {displayName.slice(0, 1)}
          </span>
          <span className="nm">{displayName}</span>
        </span>
      </td>
      <td>
        <span
          className={`pill${pillCls ? ` ${pillCls}` : ''}`}
          title={RUN_STATUS_LABEL_KEYS[run.status as RunStatus] ? t(statusHintKey) : undefined}
          data-testid="agent-v2-runs-status"
        >
          <span className="dot" aria-hidden="true" />
          {statusLabel}
        </span>
      </td>
      <td
        className={`num mono${duration === '—' ? ' faint' : ''}`}
        title={durationTitle}
        data-testid="agent-v2-runs-duration"
      >
        {duration}
      </td>
      <td className="num" data-testid="agent-v2-runs-cost">
        <span className="cost">
          {costStatus === 'unknown' ? (
            <span className="v unk" title={t('agentConsole.v2.runs01.costUnknownTitle')}>
              unknown
            </span>
          ) : (
            <span
              className={`v${formatCost(costUsd) === '—' ? ' faint' : ''}`}
              title={formatCost(costUsd) === '—' ? t('agentConsole.v2.runs01.costNoneTitle') : undefined}
            >
              {formatCost(costUsd)}
            </span>
          )}
          {costStatus === 'upstream' ? (
            <span className="pill ok xs" title={t('agentConsole.v2.runs01.costUpstreamTitle')} data-testid="agent-v2-runs-cost-status">
              <span className="dot" aria-hidden="true" />
              {t('agentConsole.v2.runsCostUpstream')}
            </span>
          ) : costStatus === 'estimated' ? (
            <span className="pill wr xs" title={t('agentConsole.v2.runs01.costEstimatedTitle')} data-testid="agent-v2-runs-cost-status">
              <span className="dot" aria-hidden="true" />
              {t('agentConsole.v2.runsCostEstimated')}
            </span>
          ) : null}
          {fill?.phase === 'error' ? (
            <button
              type="button"
              className="b xs gh"
              title={t('agentConsole.v2.runs01.detailRetryTitle')}
              aria-label={t('agentConsole.v2.runs01.detailRetryTitle')}
              data-testid="agent-v2-runs-fill-retry"
              onClick={() => onRetryFill(run.runId)}
            >
              <LkIcon name="refresh" size={13} />
            </button>
          ) : null}
        </span>
      </td>
      <td data-testid="agent-v2-runs-source">
        {run.channelEventId ? (
          <span
            className="src"
            title={t('agentConsole.v2.runs01.sourceTitle', { id: run.channelEventId })}
          >
            <LkIcon name="msg" size={13} />
            <span className="tx">{shortEventId(run.channelEventId)}</span>
          </span>
        ) : (
          <span className="faint mono" title={t('agentConsole.v2.runs01.sourceNoneTitle')}>
            —
          </span>
        )}
      </td>
      <td
        className="num mono"
        title={t('agentConsole.v2.runs01.versionTitle', { n: versionNo })}
        data-testid="agent-v2-runs-version"
      >
        {versionNo == null ? '—' : String(versionNo)}
      </td>
      <td className="num mono" title={run.startedAt} data-testid="agent-v2-runs-start">
        {formatMoment(run.startedAt)}
      </td>
      <td
        className={`num mono${endedAt ? '' : ' faint'}`}
        title={endedAt ?? t('agentConsole.v2.runs01.endNone')}
        data-testid="agent-v2-runs-end"
      >
        {formatMoment(endedAt)}
      </td>
      <td>
        <button
          type="button"
          className="b xs out"
          disabled
          aria-disabled="true"
          title={t('agentConsole.v2.runs01.viewDisabledTitle')}
          data-testid="agent-v2-runs-view"
        >
          {t('agentConsole.v2.runs01.view')}
        </button>
      </td>
    </tr>
  );
}