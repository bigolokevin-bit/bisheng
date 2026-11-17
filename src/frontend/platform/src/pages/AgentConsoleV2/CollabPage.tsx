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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { createHttpAgentConsoleApi, type AgentConsoleApi } from '@/controllers/API/agent';

import { CopyId, EmptyPanel, ListSkeleton, ReqId, StageCard, LkIcon } from './listkit';
import {
  createHttpCollabApi,
  directoryFrom,
  mergeChain,
  namesFrom,
  personName,
  personRole,
  sortDelegations,
  taskLabel,
  tailOf,
  type ChainRow,
  type CollabApi,
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
  WriteNote,
  timelineRows,
} from './collabKit';
import { fmtId, fmtTime } from './v2Data';
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
  | { kind: 'ready'; rows: DelegationRow[] }
  | { kind: 'empty' }
  | { kind: 'denied'; requestId?: string }
  | { kind: 'error'; requestId?: string; timeout: boolean }
  | { kind: 'auth' };

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
  const [chainToken, setChainToken] = useState(0);

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
        setFetchedAt(new Date().toISOString());
        const rows = sortDelegations(res.data.items);
        if (!rows.length) {
          setList({ kind: 'empty' });
          return;
        }
        setList({ kind: 'ready', rows });
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

  const retryList = useCallback(() => setReloadToken((n) => n + 1), []);
  const retryChain = useCallback(() => setChainToken((n) => n + 1), []);

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
          <DelegationTable
            rows={rows}
            directory={directory}
            names={names}
            selectedId={selectedId}
            onSelect={setSelectedId}
            t={t}
          />
          {selected ? (
            <DelegationPanel
              row={selected}
              directory={directory}
              names={names}
              chain={chain}
              onRetryChain={retryChain}
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

// ---------------------------------------------------------------- block ①

function DelegationTable({
  rows,
  directory,
  names,
  selectedId,
  onSelect,
  t,
}: {
  rows: DelegationRow[];
  directory: EmployeeDirectory;
  names: Map<string, string>;
  selectedId?: string;
  onSelect: (id: string) => void;
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
                      </span>
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
                    <span className="budcell">{t(`${NS}.list.budgetOwner`, { name: owner })}</span>
                  </td>
                  <td data-l={t(`${NS}.list.col.status`)}>
                    <StatusPill status={row.status} t={t} />
                  </td>
                  <td data-l={t(`${NS}.list.col.updated`)} className="mono c-tm">
                    {row.updatedAt ?? row.createdAt ? (
                      <span title={row.updatedAt ?? row.createdAt}>
                        {fmtTime((row.updatedAt ?? row.createdAt) as string)}
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
  t,
}: {
  row: DelegationRow;
  directory: EmployeeDirectory;
  names: Map<string, string>;
  chain: ChainState;
  onRetryChain: () => void;
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
        <WriteNote t={t} />
      </div>

      <div className="card-ft">{t(`${NS}.detail.axisNote`)}</div>
    </section>
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