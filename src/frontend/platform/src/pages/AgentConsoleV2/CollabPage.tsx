/**
 * COL-01 `/agent/collab` — the read-only collaboration view.
 *
 * Three blocks, one screen:
 *   ① every employee-to-employee delegation (seven columns, newest action first)
 *   ② the selected delegation: who handed what to whom, the owner's ledger, the
 *      four-node stage rail and the handover chain as a timeline
 *   ③ the audit association of that same delegation (read-only)
 *
 * Wire honesty: the query face is `GET /api/delegations` (+ `/chain`). While
 * the BFF routes are unwired the first read answers 404 — the page then shows
 * the single 403/404 screen (「你看不到这些记录」), never fixture data. Nothing
 * on this page writes: the four write actions are one static sentence until
 * the backend is wired (spec §2, E06).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { createHttpAgentConsoleApi, type AgentConsoleApi } from '@/controllers/API/agent';

import { CopyId, EmptyPanel, ListSkeleton, ReqId, StageCard, LkIcon } from './listkit';
import {
  createHttpCollabApi,
  directoryFrom,
  mergeChain,
  fmtStamp,
  namesFrom,
  personName,
  personRole,
  sortDelegations,
  taskLabel,
  tailOf,
  correlationCode,
  EMPTY_FILTER,
  filterDelegations,
  fmtUsd,
  isFilterActive,
  nextActions,
  readCollabQuery,
  writeCollabQuery,
  writeErrorKey,
  statusLabelKey,
  type ChainRow,
  type DelegationFilter,
  type StatusFilter,
  type WindowFilter,
  type CollabApi,
  type DelegationAction,
  type DelegationRow,
  type EmployeeDirectory,
} from './collab';
import {
  BudgetBlock,
  CollabFoot,
  CollabHead,
  PersonLine,
  ReadonlyBanner,
  StageRail,
  StatusPill,
  TerminalLine,
  Timeline,
  timelineRows,
} from './collabKit';
import { fmtId } from './v2Data';
import './collab.css';

const NS = 'agentConsole.v2.collab';
const EMPLOYEES_LIMIT = 200;

export interface CollabPageProps {
  api?: CollabApi;
  consoleApi?: Pick<AgentConsoleApi, 'listEmployees'>;
  initialSelectedId?: string;
}

type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; rows: DelegationRow[]; nextCursor?: string }
  | { kind: 'empty' }
  | { kind: 'denied'; requestId?: string }
  | { kind: 'error'; requestId?: string; timeout: boolean }
  | { kind: 'auth' };

type MoreState = 'idle' | 'loading' | 'error';

type ChainState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; rows: ChainRow[] }
  | { kind: 'error' }
  | { kind: 'denied'; requestId?: string };

export function CollabPage({ api, consoleApi, initialSelectedId }: CollabPageProps) {
  const { t } = useTranslation();
  const collabApi = useMemo(() => api ?? createHttpCollabApi(), [api]);
  const employeesApi = useMemo(
    () => consoleApi ?? createHttpAgentConsoleApi(),
    [consoleApi],
  );

  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [chain, setChain] = useState<ChainState>({ kind: 'idle' });
  const [directory, setDirectory] = useState<EmployeeDirectory>(() => new Map());
  const [fetchedAt, setFetchedAt] = useState<string | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialSelectedId);
  const [reloadToken, setReloadToken] = useState(0);
  const [more, setMore] = useState<MoreState>('idle');
  const [chainToken, setChainToken] = useState(0);
  const [authLost, setAuthLost] = useState(false);
  // The URL drives the filters (FILT-01..03): refresh, back/forward and a shared
  // link all land on the same three legs. Nothing is mirrored in local state.
  const [searchParams, setSearchParams] = useSearchParams();
  const { filter: filters, unknown: unknownFilters } = useMemo(
    () => readCollabQuery(searchParams.toString()),
    [searchParams],
  );
  const applyFilters = useCallback(
    (next: DelegationFilter) => {
      const query = writeCollabQuery(next);
      setSearchParams(new URLSearchParams(query.startsWith('?') ? query.slice(1) : query));
    },
    [setSearchParams],
  );

  // Directory names: degraded silently — 「员工 · 末4位」 is the honest fallback.
  useEffect(() => {
    let live = true;
    employeesApi
      .listEmployees({ limit: EMPLOYEES_LIMIT })
      .then((res) => {
        if (!live) return;
        if (Array.isArray(res.items)) setDirectory(directoryFrom(res.items));
      })
      .catch(() => {
        /* names degrade; ids never render raw */
      });
    return () => {
      live = false;
    };
  }, [employeesApi]);

  // Block ①.
  useEffect(() => {
    let live = true;
    setList({ kind: 'loading' });
    setMore('idle');
    collabApi
      .listDelegations()
      .then((res) => {
        if (!live) return;
        if (res.status === 401) {
          setList({ kind: 'auth' });
          window.location.assign('/');
          return;
        }
        if (res.status === 403 || res.status === 404) {
          setList({ kind: 'denied', requestId: res.requestId });
          return;
        }
        if (!res.ok || !res.data || !Array.isArray(res.data.items)) {
          setList({
            kind: 'error',
            requestId: res.requestId,
            timeout: res.code === 'console.timeout',
          });
          return;
        }
        setFetchedAt(res.data.asOf ?? new Date().toISOString());
        const rows = sortDelegations(res.data.items);
        if (!rows.length) {
          setList({ kind: 'empty' });
          return;
        }
        setList({ kind: 'ready', rows, nextCursor: res.data.nextCursor ?? undefined });
        setSelectedId((current) => {
          if (current && rows.some((row) => row.delegationId === current)) return current;
          return rows[0]?.delegationId;
        });
      })
      .catch(() => {
        if (live) setList({ kind: 'error', timeout: false });
      });
    return () => {
      live = false;
    };
  }, [collabApi, reloadToken]);

  // Block ② chain for the selected delegation.
  useEffect(() => {
    if (!selectedId) {
      setChain({ kind: 'idle' });
      return;
    }
    let live = true;
    setChain({ kind: 'loading' });
    collabApi
      .getChain(selectedId)
      .then((res) => {
        if (!live) return;
        if (res.status === 403 || res.status === 404) {
          setChain({ kind: 'denied', requestId: res.requestId });
          return;
        }
        if (!res.ok || !res.data || !Array.isArray(res.data.items)) {
          setChain({ kind: 'error' });
          return;
        }
        setChain({ kind: 'ready', rows: mergeChain(res.data.items) });
      })
      .catch(() => {
        if (live) setChain({ kind: 'error' });
      });
    return () => {
      live = false;
    };
  }, [collabApi, selectedId, chainToken]);

  const names = useMemo(() => namesFrom(directory), [directory]);
  const rows = list.kind === 'ready' ? list.rows : [];
  const selected = useMemo(
    () => rows.find((row) => row.delegationId === selectedId),
    [rows, selectedId],
  );

  // §FILT: narrowing happens on what was loaded; no re-query, no total.
  const visible = useMemo(() => filterDelegations(rows, filters), [rows, filters]);
  const participants = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) {
      for (const id of [row.fromEmployeeId, row.toEmployeeId]) {
        if (id && !seen.has(id)) seen.set(id, personName(id, names, t));
      }
    }
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [rows, names, t]);
  const filterActive = isFilterActive(filters);
  const clearFilters = useCallback(() => applyFilters(EMPTY_FILTER), [applyFilters]);

  // A filtered-out selection would leave the detail card describing a row
  // the reader can no longer see; move the selection to the first visible row.
  useEffect(() => {
    if (list.kind !== 'ready') return;
    if (selectedId && visible.some((row) => row.delegationId === selectedId)) return;
    setSelectedId(visible[0]?.delegationId);
  }, [list.kind, visible, selectedId]);

  const retryList = useCallback(() => setReloadToken((n) => n + 1), []);
  const retryChain = useCallback(() => setChainToken((n) => n + 1), []);
  // A write succeeded: re-read list + chain from the server, never patch locally.
  const refreshAfterWrite = useCallback(() => {
    setReloadToken((n) => n + 1);
    setChainToken((n) => n + 1);
  }, []);

  // Cursor paging: append only, never re-sort into a different first row, so a
  // selected delegation cannot jump under the reader's cursor.
  const loadMore = useCallback(() => {
    if (list.kind !== 'ready' || !list.nextCursor) return;
    const cursor = list.nextCursor;
    setMore('loading');
    collabApi
      .listDelegations(cursor)
      .then((res) => {
        if (res.status === 401) {
          window.location.assign('/');
          return;
        }
        if (!res.ok || !res.data || !Array.isArray(res.data.items)) {
          setMore('error');
          return;
        }
        const page = res.data;
        if (page.asOf) setFetchedAt(page.asOf);
        setMore('idle');
        setList((current) => {
          if (current.kind !== 'ready') return current;
          const seen = new Set(current.rows.map((row) => row.delegationId));
          const added = page.items.filter((row) => !seen.has(row.delegationId));
          return {
            kind: 'ready',
            rows: [...current.rows, ...added],
            nextCursor: page.nextCursor ?? undefined,
          };
        });
      })
      .catch(() => setMore('error'));
  }, [collabApi, list]);

  return (
    <div className="a2s-page">
      <div className="lk collab" data-testid="agent-v2-page-collab">
      <CollabHead
        fetchedAt={fetchedAt}
        t={t}
        actions={
          list.kind === 'ready' || list.kind === 'empty' ? (
            <button type="button" className="b out sm" onClick={retryList} data-testid="collab-reload">
              <LkIcon name="refresh" />
              {t(`${NS}.actions.reload`)}
            </button>
          ) : null
        }
      />
      {authLost ? (
        <div className="wauth" role="status" data-testid="collab-auth-banner">
          <LkIcon name="alert" />
          <span>{t(`${NS}.write.error.session`)}</span>
        </div>
      ) : null}
      <ReadonlyBanner t={t} />

      {list.kind === 'loading' ? (
        <ListSkeleton ariaLabel={t(`${NS}.state.loading.title`)} note={t(`${NS}.state.loading.note`)} />
      ) : null}

      {list.kind === 'empty' ? (
        <EmptyPanel
          title={t(`${NS}.state.empty.title`)}
          desc={t(`${NS}.state.empty.body`)}
          actionLabel={t(`${NS}.actions.backToTasks`)}
          onAction={() => {
            window.location.assign('/agent/tasks');
          }}
        />
      ) : null}

      {list.kind === 'denied' ? (
        <StageCard
          icon="lock"
          title={t(`${NS}.state.denied.title`)}
          desc={
            <>
              <p>{t(`${NS}.state.denied.body`)}</p>
              <ReqId requestId={list.requestId} testId="collab-denied-req" />
            </>
          }
          testId="collab-denied"
        >
          <button type="button" className="b out" onClick={() => window.location.reload()}>
            {t(`${NS}.actions.refresh`)}
          </button>
          <Link className="b gh" to="/agent/tasks">
            {t(`${NS}.actions.backToTasks`)}
          </Link>
        </StageCard>
      ) : null}

      {list.kind === 'error' ? (
        <StageCard
          icon="alert"
          title={t(`${NS}.state.error.title`)}
          desc={
            <>
              <p>{list.timeout ? t(`${NS}.state.error.timeout`) : t(`${NS}.state.error.body`)}</p>
              <ReqId requestId={list.requestId} testId="collab-error-req" />
            </>
          }
          testId="collab-error"
        >
          <button type="button" className="b pri" onClick={retryList} data-testid="collab-error-retry">
            {t(`${NS}.actions.retry`)}
          </button>
          <Link className="b gh" to="/agent/tasks">
            {t(`${NS}.actions.backToTasks`)}
          </Link>
        </StageCard>
      ) : null}

      {list.kind === 'ready' ? (
        <>
          {unknownFilters.length > 0 ? (
            <p className="cfnote" role="status" data-testid="collab-filter-unknown">
              {t(`${NS}.filter.unknown`)}
            </p>
          ) : null}
          <FilterBar
            filters={filters}
            onChange={(patch) => applyFilters({ ...filters, ...patch })}
            participants={participants}
            active={filterActive}
            onClear={clearFilters}
            t={t}
          />
          {visible.length === 0 ? (
            <EmptyPanel
              title={t(`${NS}.state.empty.title`)}
              desc={t('agentConsole.v2.tsk.emptyCond', { conditions: filterSummary(filters, names, t) })}
              actionLabel={t('agentConsole.v2.tsk.clear')}
              onAction={clearFilters}
            />
          ) : (
          <DelegationTable
            rows={visible}
            directory={directory}
            names={names}
            selectedId={selectedId}
            onSelect={setSelectedId}
            nextCursor={list.kind === 'ready' ? list.nextCursor : undefined}
            more={more}
            onLoadMore={loadMore}
            t={t}
          />
          )}
          {selected ? (
            <DelegationPanel
              row={selected}
              directory={directory}
              names={names}
              chain={chain}
              onRetryChain={retryChain}
              api={collabApi}
              onMutated={refreshAfterWrite}
              onAuthLost={() => setAuthLost(true)}
              t={t}
            />
          ) : null}
          {selected ? <AuditPanel row={selected} t={t} /> : null}
        </>
      ) : null}

        <CollabFoot t={t} />
      </div>
    </div>
  );
}

const STATUS_FILTERS: Array<{ value: StatusFilter }> = [
  { value: 'all' },
  { value: 'requested' },
  { value: 'accepted' },
  { value: 'handed_off' },
  { value: 'completed' },
  { value: 'rejected' },
];

const WINDOW_FILTERS: Array<{ value: WindowFilter; key: string }> = [
  { value: 'all', key: 'agentConsole.v2.runsFilterAll' },
  { value: '24h', key: 'agentConsole.v2.runs01.window24h' },
  { value: '7d', key: 'agentConsole.v2.runs01.window7d' },
  { value: '30d', key: 'agentConsole.v2.runs01.window30d' },
];

function filterSummary(filters: DelegationFilter, names: Map<string, string>, t: TFunction): string {
  const parts: string[] = [];
  if (filters.status !== 'all') parts.push(t(statusLabelKey(filters.status)));
  if (filters.window !== 'all') {
    const hit = WINDOW_FILTERS.find((item) => item.value === filters.window);
    if (hit) parts.push(t(hit.key));
  }
  if (filters.participant) parts.push(personName(filters.participant, names, t));
  return parts.join(' · ');
}

/** §FILT-01..04 — segmented status, segmented window, participant select, clear.
 *  Every control has an action; no filter hides the row it would act on. */
function FilterBar({
  filters,
  onChange,
  participants,
  active,
  onClear,
  t,
}: {
  filters: DelegationFilter;
  onChange: (patch: Partial<DelegationFilter>) => void;
  participants: Array<{ id: string; name: string }>;
  active: boolean;
  onClear: () => void;
  t: TFunction;
}) {
  return (
    <div className="fbar cfilt" data-testid="collab-filters">
      <label className="fsel">
        <span className="micro">{t('tenant.statusFilter')}</span>
        <select
          value={filters.status}
          onChange={(event) => onChange({ status: event.target.value as StatusFilter })}
          data-testid="collab-filter-status"
        >
          {STATUS_FILTERS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.value === 'all' ? t('agentConsole.v2.tsk.statusAny') : t(statusLabelKey(item.value))}
            </option>
          ))}
        </select>
      </label>
      <span className="micro">{t('agentConsole.v2.runs01.filterSince')}</span>
      <div className="seg" role="group" aria-label={t('agentConsole.v2.runs01.filterSince')}>
        {WINDOW_FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={filters.window === item.value}
            onClick={() => onChange({ window: item.value })}
            data-testid={`collab-filter-window-${item.value}`}
          >
            {t(item.key)}
          </button>
        ))}
      </div>
      <label className="fsel">
        <span className="micro">{t('agentConsole.v2.aud01.filterEmployee')}</span>
        <select
          value={filters.participant}
          onChange={(event) => onChange({ participant: event.target.value })}
          data-testid="collab-filter-participant"
        >
          <option value="">{t('agentConsole.v2.emp.filterAll')}</option>
          {participants.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </label>
      {active ? (
        <button type="button" className="b gh sm" onClick={onClear} data-testid="collab-clear-filters">
          {t('agentConsole.v2.tsk.clear')}
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- block ①

function DelegationTable({
  rows,
  directory,
  names,
  selectedId,
  onSelect,
  nextCursor,
  more,
  onLoadMore,
  t,
}: {
  rows: DelegationRow[];
  directory: EmployeeDirectory;
  names: Map<string, string>;
  selectedId?: string;
  onSelect: (id: string) => void;
  nextCursor?: string;
  more: MoreState;
  onLoadMore: () => void;
  t: TFunction;
}) {
  return (
    <section className="card ctable-card" aria-labelledby="collab-list-h">
      <div className="card-hd">
        <div>
          <h2 className="t" id="collab-list-h">{t(`${NS}.list.title`)}</h2>
          <p className="hd-note">{t(`${NS}.list.note`)}</p>
        </div>
      </div>
      <div className="tblwrap">
        <table className="tbl ctbl">
          <caption className="sr-only">{t(`${NS}.list.title`)}</caption>
          <thead>
            <tr>
              <th scope="col" className="c-task">{t(`${NS}.list.col.task`)}</th>
              <th scope="col">{t(`${NS}.list.col.from`)}</th>
              <th scope="col">{t(`${NS}.list.col.to`)}</th>
              <th scope="col">{t(`${NS}.list.col.budget`)}</th>
              <th scope="col">{t(`${NS}.list.col.status`)}</th>
              <th scope="col">{t(`${NS}.list.col.updated`)}</th>
              <th scope="col" className="c-act">{t(`${NS}.list.col.action`)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const from = personName(row.fromEmployeeId, names, t);
              const to = personName(row.toEmployeeId, names, t);
              const owner = personName(row.budget?.ownerEmployeeId ?? row.fromEmployeeId, names, t);
              const isSelected = row.delegationId === selectedId;
              return (
                <tr
                  key={row.delegationId}
                  className={isSelected ? 'is-selected' : undefined}
                  data-testid={`collab-row-${row.delegationId}`}
                >
                  <td data-l={t(`${NS}.list.col.task`)}>
                    <div className="cttl">
                      <span className="ttl">{taskLabel(row, t)}</span>
                      <span className="micro" title={row.taskId}>
                        {t(`${NS}.list.taskTail`, { tail: tailOf(row.taskId) })}
                        {' · '}
                        <span className="mono">{correlationCode(row)}</span>
                      </span>
                      <Link className="lnk tlink" to={`/agent/tasks/${row.taskId}`}>
                        {t(`${NS}.audit.task`)}
                      </Link>
                    </div>
                  </td>
                  <td data-l={t(`${NS}.list.col.from`)}>
                    <span className="who">
                      <span className="ava" aria-hidden="true">{Array.from(from)[0] ?? '·'}</span>
                      <span className="nm">
                        {from}
                        {personRole(row.fromEmployeeId, directory) ? (
                          <span className="role">{personRole(row.fromEmployeeId, directory)}</span>
                        ) : null}
                      </span>
                    </span>
                  </td>
                  <td data-l={t(`${NS}.list.col.to`)}>
                    <span className="who">
                      <span className="ava" aria-hidden="true">{Array.from(to)[0] ?? '·'}</span>
                      <span className="nm">
                        {to}
                        {personRole(row.toEmployeeId, directory) ? (
                          <span className="role">{personRole(row.toEmployeeId, directory)}</span>
                        ) : null}
                      </span>
                    </span>
                  </td>
                  <td data-l={t(`${NS}.list.col.budget`)}>
                    <span className="budcell">
                      {t(`${NS}.list.budgetOwner`, { name: owner })}
                      {typeof row.budget?.usedCostUsd === 'number' ? (
                        <span className="mono ubud">{fmtUsd(row.budget.usedCostUsd)}</span>
                      ) : null}
                    </span>
                  </td>
                  <td data-l={t(`${NS}.list.col.status`)}>
                    <StatusPill status={row.status} t={t} />
                  </td>
                  <td data-l={t(`${NS}.list.col.updated`)} className="mono c-tm">
                    {row.updatedAt ?? row.createdAt ? (
                      <span title={row.updatedAt ?? row.createdAt}>
                        {fmtStamp((row.updatedAt ?? row.createdAt) as string)}
                      </span>
                    ) : (
                      <span className="faint">{t(`${NS}.list.timeMissing`)}</span>
                    )}
                  </td>
                  <td data-l={t(`${NS}.list.col.action`)} className="c-act">
                    <button
                      type="button"
                      className={`b sm ${isSelected ? 'gh' : 'out'}`}
                      aria-pressed={isSelected}
                      onClick={() => onSelect(row.delegationId)}
                      data-testid={`collab-view-${row.delegationId}`}
                    >
                      <LkIcon name="search" />
                      {t(`${NS}.list.view`)}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="lk-more">
        <span className="micro">{t('agentConsole.v2.skills.loaded', { count: rows.length })}</span>
        {nextCursor ? (
          <button
            type="button"
            className="b out sm"
            onClick={onLoadMore}
            disabled={more === 'loading'}
            aria-busy={more === 'loading'}
            data-testid="collab-load-more"
          >
            <LkIcon name="chevD" />
            {t('agentConsole.list.loadMore')}
          </button>
        ) : null}
        {more === 'error' ? (
          <span className="micro faint">{t('agentConsole.v2.run02.moreError')}</span>
        ) : null}
      </div>
      <div className="card-ft">{t(`${NS}.list.foot`)}</div>
    </section>
  );
}

// ---------------------------------------------------------------- block ②

function DelegationPanel({
  row,
  directory,
  names,
  chain,
  onRetryChain,
  api,
  onMutated,
  onAuthLost,
  t,
}: {
  row: DelegationRow;
  directory: EmployeeDirectory;
  names: Map<string, string>;
  chain: ChainState;
  onRetryChain: () => void;
  api: CollabApi;
  onMutated: () => void;
  onAuthLost: () => void;
  t: TFunction;
}) {
  const from = personName(row.fromEmployeeId, names, t);
  const to = personName(row.toEmployeeId, names, t);
  const owner = personName(row.budget?.ownerEmployeeId ?? row.fromEmployeeId, names, t);
  const timeline = chain.kind === 'ready' ? timelineRows(chain.rows, row.status, names, t) : [];

  return (
    <section className="card cdetail" aria-labelledby="collab-detail-h" data-testid="collab-detail">
      <div className="card-hd">
        <div className="hd-main">
          <span className="zno" aria-hidden="true">{t(`${NS}.detail.mark`)}</span>
          <div>
            <h2 className="t" id="collab-detail-h">
              {t(`${NS}.detail.title`)}
              <StatusPill status={row.status} t={t} xs />
            </h2>
            <p className="hd-note">{t(`${NS}.detail.note`, { tail: tailOf(row.taskId) })}</p>
          </div>
        </div>
      </div>

      <div className="cbody">
        <div className="cpair">
          <PersonLine
            name={from}
            role={personRole(row.fromEmployeeId, directory)}
            tag={t(`${NS}.detail.fromTag`)}
            tagTone="acc"
            sub={t(`${NS}.detail.fromSub`)}
          />
          <span className="carrow" aria-hidden="true"><LkIcon name="arrowLeft" /></span>
          <PersonLine
            name={to}
            role={personRole(row.toEmployeeId, directory)}
            tag={t(`${NS}.detail.toTag`)}
            tagTone="nt"
            sub={t(`${NS}.detail.toSub`)}
          />
          <BudgetBlock budget={row.budget} ownerName={owner} t={t} />
        </div>

        <StageRail status={row.status} t={t} />

        <div className="tlblock">
          <h3 className="tl-h">{t(`${NS}.chain.title`)}</h3>
          {chain.kind === 'loading' ? (
            <div className="skel tl-skel" aria-busy="true" aria-label={t(`${NS}.chain.loading`)}>
              <div className="srow-skel" />
              <div className="srow-skel" />
              <div className="srow-skel" />
              <p className="skel-note">{t(`${NS}.chain.loading`)}</p>
            </div>
          ) : null}
          {chain.kind === 'ready' && chain.rows.length === 0 ? (
            <p className="tl-none">{t(`${NS}.chain.emptyBody`)}</p>
          ) : null}
          {chain.kind === 'ready' && chain.rows.length > 0 ? (
            <Timeline rows={timeline} t={t} />
          ) : null}
          {chain.kind === 'error' ? (
            <div className="chain-err" role="status">
              <p>{t(`${NS}.chain.error`)}</p>
              <button type="button" className="b out sm" onClick={onRetryChain} data-testid="collab-chain-retry">
                <LkIcon name="refresh" />
                {t(`${NS}.actions.retry`)}
              </button>
            </div>
          ) : null}
          {chain.kind === 'denied' ? (
            <div className="chain-err" role="status">
              <p>{t(`${NS}.chain.denied`)}</p>
              <ReqId requestId={chain.requestId} testId="collab-chain-req" />
            </div>
          ) : null}
        </div>

        <TerminalLine status={row.status} t={t} />
        {nextActions(row.status).length > 0 ? (
          <WriteActions
            row={row}
            api={api}
            onMutated={onMutated}
            onAuthLost={onAuthLost}
            t={t}
          />
        ) : (
          <p className="wnote" data-testid="collab-write-note">
            <LkIcon name="lock" />
            <span>{t(`${NS}.write.terminal`)}</span>
          </p>
        )}
      </div>

      <div className="card-ft">{t(`${NS}.detail.axisNote`)}</div>
    </section>
  );
}

// ---------------------------------------------------------------- write actions

function newRequestId(): string {
  const random = globalThis.crypto as Crypto | undefined;
  if (random && typeof random.randomUUID === 'function') return random.randomUUID();
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const ACTION_ORDER: DelegationAction[] = ['reject', 'accept', 'handoff', 'complete'];

function WriteActions({
  row,
  api,
  onMutated,
  onAuthLost,
  t,
}: {
  row: DelegationRow;
  api: CollabApi;
  onMutated: () => void;
  onAuthLost: () => void;
  t: TFunction;
}) {
  const actions = nextActions(row.status);
  const [open, setOpen] = useState<DelegationAction | null>(null);
  const [reason, setReason] = useState('');
  const [progress, setProgress] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ key: string; requestId?: string } | null>(null);
  const requestIdRef = useRef<string | null>(null);

  if (!actions.length) return null;

  const needsReason = open === 'reject';
  const needsProgress = open === 'complete';
  const valid = needsReason ? reason.trim().length > 0 : needsProgress ? progress.trim().length > 0 : true;

  const close = () => {
    if (busy) return;
    setOpen(null);
    setReason('');
    setProgress('');
    setFailure(null);
  };

  const submit = async () => {
    if (!open || !valid || busy) return;
    setBusy(true);
    setFailure(null);
    // One key per submission attempt chain; a retry reuses it, success drops it.
    const requestId = requestIdRef.current ?? newRequestId();
    requestIdRef.current = requestId;
    const body = open === 'reject'
      ? { reason: reason.trim() }
      : open === 'complete'
        ? { progressNote: progress.trim() }
        : {};
    const result = await api.submitDelegationAction(open, row.delegationId, body, requestId);
    setBusy(false);
    if (result.ok) {
      requestIdRef.current = null;
      setOpen(null);
      setReason('');
      setProgress('');
      onMutated();
      return;
    }
    if (result.status === 401) onAuthLost();
    setFailure({ key: writeErrorKey(result.status, result.code), requestId: result.requestId });
  };

  return (
    <div className="abox" data-testid="collab-write-actions">
      <p className="turn">{t(`${NS}.write.turn.${actions[0]}`)}</p>
      <div className="abtns">
        {ACTION_ORDER.filter((action) => actions.includes(action)).map((action) => (
          <button
            key={action}
            type="button"
            className={`b sm ${action === 'reject' ? 'out' : 'pri'}`}
            onClick={() => {
              setOpen(action);
              setReason('');
              setProgress('');
              setFailure(null);
            }}
            aria-expanded={open === action}
            data-testid={`collab-action-${action}`}
          >
            {t(`${NS}.write.action.${action}`)}
          </button>
        ))}
      </div>

      {open ? (
        <div className="ibox" role="group" aria-label={t(`${NS}.write.confirmTitle.${open}`)} data-testid="collab-write-box">
          <p className="ith">{t(`${NS}.write.confirmTitle.${open}`)}</p>
          <p className="ibd">{t(`${NS}.write.consequence.${open}`)}</p>
          {needsReason ? (
            <label className="lbl">
              <span>{t(`${NS}.write.reasonLabel`)}</span>
              <textarea
                className="ta"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={t(`${NS}.write.reasonPlaceholder`)}
                rows={3}
                disabled={busy}
                data-testid="collab-write-reason"
              />
            </label>
          ) : null}
          {needsProgress ? (
            <label className="lbl">
              <span>{t(`${NS}.write.progressLabel`)}</span>
              <textarea
                className="ta"
                value={progress}
                onChange={(event) => setProgress(event.target.value)}
                placeholder={t(`${NS}.write.progressPlaceholder`)}
                rows={3}
                disabled={busy}
                data-testid="collab-write-progress"
              />
            </label>
          ) : null}
          <div className="acts2">
            <button type="button" className="b out sm" onClick={close} disabled={busy} data-testid="collab-write-cancel">
              {t(`${NS}.write.cancel`)}
            </button>
            <button
              type="button"
              className={`b sm ${open === 'reject' ? 'dgr' : 'pri'}`}
              onClick={submit}
              disabled={busy || !valid}
              aria-busy={busy}
              data-testid="collab-write-confirm"
            >
              {busy ? t(`${NS}.write.busy`) : t(`${NS}.write.confirm`)}
            </button>
          </div>
          {failure ? (
            <p className="werr" role="status" data-testid="collab-write-error">
              {t(failure.key)}
              <ReqId requestId={failure.requestId} testId="collab-write-req" />
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- block ③

function AuditPanel({ row, t }: { row: DelegationRow; t: ReturnType<typeof useTranslation>['t'] }) {
  return (
    <section className="card caudit" aria-labelledby="collab-audit-h" data-testid="collab-audit">
      <div className="card-hd">
        <div className="hd-main">
          <span className="zno" aria-hidden="true">{t(`${NS}.audit.mark`)}</span>
          <div>
            <h2 className="t" id="collab-audit-h">{t(`${NS}.audit.title`)}</h2>
            <p className="hd-note">{t(`${NS}.audit.note`)}</p>
          </div>
        </div>
      </div>
      <div className="audit-rows">
        <div className="arow">
          <span className="k">{t(`${NS}.audit.task`)}</span>
          <CopyId
            value={row.taskId}
            display={fmtId(row.taskId)}
            ariaLabel={t(`${NS}.audit.copyTask`)}
            copiedLabel={t(`${NS}.audit.copied`)}
            testId="collab-audit-task"
          />
        </div>
        <div className="arow">
          <span className="k">{t(`${NS}.audit.delegation`)}</span>
          <CopyId
            value={row.delegationId}
            display={fmtId(row.delegationId)}
            ariaLabel={t(`${NS}.audit.copyDelegation`)}
            copiedLabel={t(`${NS}.audit.copied`)}
            testId="collab-audit-delegation"
          />
        </div>
        <div className="arow">
          <span className="k">{t(`${NS}.audit.request`)}</span>
          {row.requestId ? (
            <CopyId
              value={row.requestId}
              display={fmtId(row.requestId)}
              ariaLabel={t(`${NS}.audit.copyRequest`)}
              copiedLabel={t(`${NS}.audit.copied`)}
              testId="collab-audit-request"
            />
          ) : (
            <span className="faint">{t(`${NS}.audit.missing`)}</span>
          )}
        </div>
      </div>
      <p className="audit-line">{t(`${NS}.audit.body`)}</p>
      <div className="card-ft">{t(`${NS}.audit.foot`)}</div>
    </section>
  );
}

export default CollabPage;