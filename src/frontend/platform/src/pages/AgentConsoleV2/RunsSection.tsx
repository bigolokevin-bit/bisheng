/**
 * RUN-01 `/agent/runs` — read-only run list against the frozen C1 baseline
 * run01-target.html (sha 1cbe1633…) + RUN01-TARGET-SPEC.md.
 *
 * Shape (spec §1): page head (NO KPI layer — R5 has no total) → meta row →
 * FilterBar (only real server dimensions) → one 10-column table card →
 * cursor foot (「本页 N 条 · 下一页」, never 「共 N」) → caliber foot.
 * Structure comes from the shared list suite (./listkit); every value rule
 * (honest identities, the source binding, raw cost/duration/time shaping, the
 * window↔request coupling, the error envelope) lives in ./runs01.ts, and the
 * 375 row-card / 1280 slack layout in ./runs01.css.
 */import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { AgentConsoleApi, EmployeeSummary } from '@/controllers/API/agent';
import type { AgentConsoleRunsApi, Run, RunStatus } from '@/controllers/API/agentConsoleRuns';

import {
  CopyId, CursorFoot, EmptyPanel, FilterBar, LkIcon, ListSkeleton, ReqId,
  StageCard, TableCard, useCursorList,
} from './listkit';
import {
  DEFAULT_LIMIT, DEFAULT_SINCE, EMPLOYEES_LIMIT, LIMITS, RUN_STATUSES,
  RUN_STATUS_LABEL_KEYS, RUNS_NS, SINCE_WINDOWS, STATUS_CHIP_TONE,
  TERMINAL_STATUSES, buildColumns, columnLabelMap, formatCost, formatDuration,
  formatMoment, readRunsQuery, resolveRunSource, runEmployeeChipLabel,
  runEmployeeLabel, runEmployeeTitle, runsErrorView, runsForbiddenView,
  runsQueryToSearch, runStatusLabel, shortRunId, sinceIso, statusPillClass,
  windowLabel, type RunsQuery, type SinceValue,
} from './runs01';
import { avatarChar } from './identity';

import './runs01.css';

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

  const [query, setQuery] = useState<RunsQuery>(() =>
    readRunsQuery(safeSearch(), initialEmployeeId),
  );
  const [employees, setEmployees] = useState<EmployeeSummary[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  /** R2 per-row lazy fills (never batch, never blocking first paint). */
  const [fills, setFills] = useState<Record<string, FillBox>>({});
  const fillRequestedRef = useRef<Set<string>>(new Set());

  // URL hygiene: the parsed state is the single source of truth, so a shared
  // `?window=` alias or an invalid param folds back into the canonical five
  // (replaceState — no history entry, foreign keys like ?src= untouched).
  useEffect(() => {
    writeRunsQuery(query);
  }, [query]);

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

  // Filter change: clear cursor + seen pages (the hook resets on resetKey).
  // The URL mirror lives in the [query] effect above — one writer.
  const updateFilters = useCallback((patch: Partial<RunsQuery>) => {
    setQuery((prev) => ({ ...prev, ...patch, cursor: null }));
  }, []);

  const clearFilters = useCallback(() => {
    updateFilters({ employeeId: '', status: '', since: DEFAULT_SINCE, limit: DEFAULT_LIMIT });
  }, [updateFilters]);

  // Explicit next-page: the hook fetches the cursor, the effect records it in
  // the URL (replaceState). No automatic loading anywhere.
  const onNext = useCallback(() => {
    if (!list.nextCursor) return;
    setQuery((prev) => ({ ...prev, cursor: list.nextCursor }));
    list.loadNext();
  }, [list]);

  const onReloadFirst = useCallback(() => {
    setQuery((prev) => (prev.cursor === null ? prev : { ...prev, cursor: null }));
    list.reloadFirst();
  }, [list]);

  // E11 candidates for the employee select + row names. Cosmetic failure
  // degrades to the readable 「员工 · 短码」 form, never a bare id and never a
  // fabricated name.
  useEffect(() => {
    let live = true;
    consoleApi
      .listEmployees({ limit: EMPLOYEES_LIMIT })
      .then((res) => {
        if (live && res && Array.isArray(res.items)) setEmployees(res.items);
      })
      .catch(() => {
        /* names degrade to the short-code form */
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
  const rowLabels = useMemo(() => columnLabelMap(t), [t]);
  const hasFilter = query.employeeId !== '' || query.status !== '';
  const range = windowLabel(query.since, t);
  const employeeName = runEmployeeLabel(query.employeeId, names, t);

  // ---------- state screens ----------

  if (list.phase === 'loading') {
    return (
      <div className="lk runs01" data-testid="agent-v2-runs">
        <PageHead t={t} updatedAt={updatedAt} range={range} />
        <ListSkeleton ariaLabel={t(`${RUNS_NS}.loadingAria`)} note={t(`${RUNS_NS}.loadingNote`)} />
      </div>
    );
  }

  // QA R2 ④/⑥: one screen for error + 403/404. Copy is human language only —
  // no response body, no upstream machine code, no bare HTTP status; support
  // works from the request id. 403 and 404 share the same view object, so the
  // screen cannot reveal whether a record exists. No data row renders here.
  if (list.phase === 'error' || list.phase === 'forbidden') {
    const stage = list.phase === 'error' ? runsErrorView(t, list.httpStatus) : runsForbiddenView(t);
    return (
      <div className="lk runs01" data-testid="agent-v2-runs">
        <PageHead t={t} updatedAt={updatedAt} range={range} />
        <StageCard icon={stage.icon} title={stage.title} desc={stage.desc} testId={stage.testId}>
          <button type="button" className="b out" data-testid={stage.retryTestId} onClick={onReloadFirst}>
            <LkIcon name="refresh" size={16} />
            {stage.retryLabel}
          </button>
          {stage.backLabel ? (
            <a className="lnk" href="/agent" style={{ alignSelf: 'center' }}>
              {stage.backLabel}
            </a>
          ) : null}
          {/* S4: request line always present — copyable id or 未提供. */}
          <ReqId requestId={list.requestId} testId={stage.reqIdTestId} />
        </StageCard>
      </div>
    );
  }

  // ---------- normal / empty (filters stay on screen in both) ----------

  const filterSummary = [
    query.employeeId ? employeeName : null,
    query.status ? runStatusLabel(t, query.status) : null,
    range,
  ].filter(Boolean).join(' · ');

  return (
    <div className="lk runs01" data-testid="agent-v2-runs">
      <PageHead t={t} updatedAt={updatedAt} range={range} />

      <FilterBar
        ariaLabel={t(`${RUNS_NS}.filterAria`)}
        selectsBefore={[
          {
            id: 'agent-v2-runs-filter-employee',
            // 「员工：小鲤」 when the directory knows the name; an unresolved
            // ref keeps its own readable form (never 「员工：员工 · …」).
            label: runEmployeeChipLabel(query.employeeId, names, t),
            title: t(`${RUNS_NS}.filterEmployeeDirectory`),
            value: query.employeeId,
            active: query.employeeId !== '',
            options: [
              { value: '', label: t('agentConsole.v2.runsFilterAll') },
              // S2: an employee without a name still reads 「员工 · 短码」.
              ...(employees ?? []).map((e) => ({
                value: e.employeeId,
                label: runEmployeeLabel(e.employeeId, names, t),
              })),
            ],
            onChange: (v) => updateFilters({ employeeId: v }),
          },
        ]}
        chips={{
          ariaLabel: t(`${RUNS_NS}.filterStatus`),
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
          ariaLabel: t(`${RUNS_NS}.filterSince`),
          items: SINCE_WINDOWS.map((w) => ({ value: w.value, label: t(w.labelKey) })),
          value: query.since,
          onChange: (v) => updateFilters({ since: v as SinceValue }),
        }}
        selectsAfter={[
          {
            id: 'agent-v2-runs-filter-limit',
            label: t(`${RUNS_NS}.filterLimitN`, { n: query.limit }),
            title: t(`${RUNS_NS}.filterLimitTitle`),
            value: String(query.limit),
            options: LIMITS.map((n) => ({
              value: String(n),
              label: t(`${RUNS_NS}.filterLimitN`, { n }),
            })),
            onChange: (v) => updateFilters({ limit: Number(v) }),
          },
          {
            id: 'agent-v2-runs-filter-source',
            label: t(`${RUNS_NS}.filterSource`),
            value: '',
            options: [],
            onChange: () => undefined,
            disabled: true,
            disabledTitle: t(`${RUNS_NS}.filterSourceDisabled`),
          },
        ]}
        clear={{
          label: t(`${RUNS_NS}.clear`),
          disabled: !hasFilter,
          title: hasFilter ? t(`${RUNS_NS}.clearTitle`) : t(`${RUNS_NS}.clearDisabledTitle`),
          onClear: clearFilters,
        }}
        count={{
          pre: t(`${RUNS_NS}.loadedPrePage`),
          post: t(`${RUNS_NS}.loadedPost`),
          n: list.items.length,
        }}
      />

      {list.items.length === 0 ? (
        <EmptyPanel
          title={t(`${RUNS_NS}.emptyTitle`)}
          desc={
            hasFilter
              ? t(`${RUNS_NS}.emptyDescFiltered`, { filters: filterSummary })
              : t(`${RUNS_NS}.emptyDescPlain`)
          }
          actionLabel={hasFilter ? t(`${RUNS_NS}.emptyClear`) : undefined}
          onAction={hasFilter ? clearFilters : undefined}
        />
      ) : (
        <TableCard
          ariaLabel={t(`${RUNS_NS}.tableAria`)}
          columns={columns}
          foot={
            <CursorFoot
              pageRowsText={t(`${RUNS_NS}.pageRows`, { n: list.items.length })}
              noteText={t(`${RUNS_NS}.cursorNote`, { n: query.limit })}
              hintText={t(`${RUNS_NS}.tblHint`)}
              nextLabel={t(`${RUNS_NS}.next`)}
              nextTitle={t(`${RUNS_NS}.nextTitle`)}
              lastPageTitle={t(`${RUNS_NS}.lastPageTitle`)}
              hasNext={list.nextCursor !== null}
              loadingMore={list.loadingMore}
              onNext={onNext}
              stale={list.stale}
              staleTitle={t(`${RUNS_NS}.staleTitle`)}
              staleDesc={t(`${RUNS_NS}.staleDesc`)}
              staleReloadLabel={t(`${RUNS_NS}.staleReload`)}
              onReloadFirst={onReloadFirst}
              nextErrorText={
                list.nextError !== null ? t(`${RUNS_NS}.nextErrorHuman`) : null
              }
              retryLabel={t(`${RUNS_NS}.nextRetry`)}
              caliberText={t(`${RUNS_NS}.caliberSafe`)}
            />
          }
        >
          {list.items.map((row) => (
            <RunRow
              key={row.runId}
              run={row}
              fill={fills[row.runId]}
              onRetryFill={fetchFill}
              names={names}
              labels={rowLabels}
              t={t}
            />
          ))}
        </TableCard>
      )}

      <div className="pfoot">
        <span>{t(`${RUNS_NS}.footSourceSafe`)}</span>
        <span className="sp" aria-hidden="true" />
        <span>{t(`${RUNS_NS}.footCaliberSafe`)}</span>
        {/* The aggregate figures this page has no source for are named too. */}
        <span>{t(`${RUNS_NS}.footNoAggregate`)}</span>
      </div>
    </div>
  );
}

/** Page head + meta row (no KPI layer, no write buttons, no 「待接入」). */
function PageHead({ t, updatedAt, range }: { t: TFunction; updatedAt: string | null; range: string }) {
  return (
    <>
      <div className="phead">
        <div>
          <h1 className="h1">{t('agentConsole.v2.navRuns')}</h1>
          <p className="sub">{t(`${RUNS_NS}.sub`)}</p>
        </div>
      </div>
      <div className="fresh">
        <LkIcon name="clock" size={13} />
        <span>
          {t(`${RUNS_NS}.freshUpdated`)} <span className="mono">{updatedAt ?? '—'}</span>
        </span>
        <span className="faint">·</span>
        <span data-testid="agent-v2-runs-range">
          {t(`${RUNS_NS}.filterSince`)} {range}
        </span>
        <span className="faint">·</span>
        <span>
          {t(`${RUNS_NS}.freshSource`)} {t(`${RUNS_NS}.metaSourceValue`)} ·{' '}
          {t(`${RUNS_NS}.freshReadonly`)}
        </span>
      </div>
    </>
  );
}

interface RunRowProps {
  run: Run;
  fill?: FillBox;
  onRetryFill: (runId: string) => void;
  /** Employee directory (id → name); absent ⇒ short-code form. */
  names?: Map<string, string>;
  /** Column captions, printed by the ≤767 row cards. */
  labels: Record<string, string>;
  t: TFunction;
}

/** One 10-column row. R5 is the main source; an ok R2 fill overlays the
 *  nullable columns only. Every truncated value keeps its full form in title. */
function RunRow({ run, fill, onRetryFill, names, labels, t }: RunRowProps) {
  const filled = fill?.phase === 'ok' ? fill.run : null;
  const costUsd = filled ? (filled.costUsd ?? run.costUsd) : run.costUsd;
  const costStatus = filled ? (filled.costStatus ?? run.costStatus) : run.costStatus;
  const versionNo = filled ? (filled.employeeVersionNo ?? run.employeeVersionNo) : run.employeeVersionNo;
  const endedAt = filled ? (filled.endedAt ?? run.endedAt) : run.endedAt;
  const statusLabel = runStatusLabel(t, run.status);
  const pillCls = statusPillClass(run.status);
  const knownStatus = RUN_STATUS_LABEL_KEYS[run.status as RunStatus] !== undefined;
  // S2 + QA R2 ②: an unresolved employee reads 「员工 · <8 位短码>」 and a
  // missing ref reads 「未指派」 — no `emp_…`/`employee:`/`human:` text node;
  // the full raw ref stays in the cell title for support.
  const displayName = runEmployeeLabel(run.employeeId, names, t);
  // Only a directory name may lead the avatar (a latin id never does).
  const avaChar = avatarChar(run.employeeId ? names?.get(run.employeeId) : '');
  const source = resolveRunSource(run, t);

  const duration = formatDuration(run.startedAt, endedAt);
  const durationTitle =
    duration === '—' ? t(`${RUNS_NS}.durationNone`) : `${formatMoment(run.startedAt)} → ${formatMoment(endedAt)}`;

  return (
    <tr title={run.runId} data-testid="agent-v2-runs-row">
      <td data-l={labels.run}>
        <CopyId
          value={run.runId}
          display={shortRunId(run.runId)}
          ariaLabel={t(`${RUNS_NS}.copyAria`)}
          copiedLabel={t(`${RUNS_NS}.copied`)}
          testId="agent-v2-runs-id"
        />
      </td>
      <td className="lk-td-who" data-l={labels.employee}>
        <span
          className="who"
          title={runEmployeeTitle(run.employeeId, t)}
          data-testid="agent-v2-runs-employee"
        >
          <span className="ava" aria-hidden="true">
            {avaChar ?? <LkIcon name="users" size={12} />}
          </span>
          <span className="nm">{displayName}</span>
        </span>
      </td>
      <td data-l={labels.status}>
        <span
          className={`pill${pillCls ? ` ${pillCls}` : ''}`}
          title={knownStatus ? t(`${RUNS_NS}.statusHint.${run.status}`) : undefined}
          data-testid="agent-v2-runs-status"
        >
          <span className="dot" aria-hidden="true" />
          {statusLabel}
        </span>
      </td>
      <td
        className={`num mono${duration === '—' ? ' faint' : ''}`}
        title={durationTitle}
        data-l={labels.duration}
        data-testid="agent-v2-runs-duration"
      >
        {duration}
      </td>
      <td className="num" data-l={labels.cost} data-testid="agent-v2-runs-cost">
        <span className="cost">
          {costStatus === 'unknown' ? (
            <span className="v unk" title={t(`${RUNS_NS}.costUnknownTitle`)}>
              {t(`${RUNS_NS}.costUnknownValue`)}
            </span>
          ) : (
            <span
              className={`v${formatCost(costUsd) === '—' ? ' faint' : ''}`}
              title={formatCost(costUsd) === '—' ? t(`${RUNS_NS}.costNoneTitle`) : undefined}
            >
              {formatCost(costUsd)}
            </span>
          )}
          {costStatus === 'upstream' || costStatus === 'estimated' ? (
            <span
              className={`pill ${costStatus === 'upstream' ? 'ok' : 'wr'} xs`}
              title={t(costStatus === 'upstream' ? `${RUNS_NS}.costUpstreamTitle` : `${RUNS_NS}.costEstimatedTitle`)}
              data-testid="agent-v2-runs-cost-status"
            >
              <span className="dot" aria-hidden="true" />
              {t(costStatus === 'upstream' ? 'agentConsole.v2.runsCostUpstream' : 'agentConsole.v2.runsCostEstimated')}
            </span>
          ) : null}
          {fill?.phase === 'error' ? (
            <button
              type="button"
              className="b xs gh"
              title={t(`${RUNS_NS}.detailRetryTitle`)}
              aria-label={t(`${RUNS_NS}.detailRetryTitle`)}
              data-testid="agent-v2-runs-fill-retry"
              onClick={() => onRetryFill(run.runId)}
            >
              <LkIcon name="refresh" size={13} />
            </button>
          ) : null}
        </span>
      </td>
      <td data-l={labels.source} data-testid="agent-v2-runs-source">
        {source.display === '—' ? (
          <span className="faint mono" title={source.title}>
            —
          </span>
        ) : (
          <span className="src" title={source.title}>
            <LkIcon name={source.icon} size={13} />
            <span className="tx">{source.display}</span>
          </span>
        )}
      </td>
      <td
        className="num mono"
        title={versionNo == null ? t(`${RUNS_NS}.versionNone`) : t(`${RUNS_NS}.versionTitle`, { n: versionNo })}
        data-l={labels.version}
        data-testid="agent-v2-runs-version"
      >
        {versionNo == null ? '—' : String(versionNo)}
      </td>
      <td className="num mono" title={run.startedAt} data-l={labels.start} data-testid="agent-v2-runs-start">
        {formatMoment(run.startedAt)}
      </td>
      <td
        className={`num mono${endedAt ? '' : ' faint'}`}
        title={endedAt ?? t(`${RUNS_NS}.endNone`)}
        data-l={labels.end}
        data-testid="agent-v2-runs-end"
      >
        {formatMoment(endedAt)}
      </td>
      <td data-l={labels.action}>
        {/* S3: RUN-02 is live — 「查看」 really navigates (plain anchor, same
            idiom as the audit row run/employee jumps; copy stays separate). */}
        <a
          className="b xs out"
          href={`/agent/runs/${encodeURIComponent(run.runId)}`}
          data-testid="agent-v2-runs-view"
        >
          {t(`${RUNS_NS}.view`)}
        </a>
      </td>
    </tr>
  );
}

/** location.search without throwing in a non-browser host. */
function safeSearch(): string {
  try {
    return window.location.search;
  } catch {
    return '';
  }
}

/** Mirror the query into the URL (replaceState); foreign keys stay as-is. */
function writeRunsQuery(q: RunsQuery): void {
  try {
    const qs = runsQueryToSearch(q, window.location.search);
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  } catch {
    /* history unavailable: filters still work in-memory */
  }
}
