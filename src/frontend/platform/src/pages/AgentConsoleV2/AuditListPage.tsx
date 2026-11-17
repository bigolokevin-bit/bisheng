/**
 * AUD-01 `/agent/audit` — read-only audit event list, built against the frozen
 * C1 baseline aud01-target.html (sha 1de49c3e…) + AUD01-TARGET-SPEC.md.
 *
 * Shape (spec §4.1): page head → meta row → page-level read-only banner →
 * A7 chain-verify panel (always on) → one card holding FilterBar + applied
 * chips + 12-column table + cursor foot + caliber foot → page foot.
 *
 * Hard rules carried by this file:
 * - ZERO write entries: no export/download/edit/delete/backfill/rollback/
 *   "verify this row". The banner explains WHY there is no export button
 *   (A5 is POST; the read-only BFF answers 405) instead of drawing a dead one.
 * - A3 rejects filter-less queries. The default window (24h) is ALWAYS a real
 *   filter, so a normal first paint is honest; clearing the time window with
 *   nothing else selected lands on the 「至少一个条件」 guide and sends NOTHING.
 * - No total, no pager, no 「上一页」: the foot says 「本页 N 条」 and the
 *   next button consumes `nextCursor` explicitly (last page = key omitted).
 * - Green is impossible in this file by accident: the colour gate lives in
 *   aud01.classifyVerify (ok && complete && scanned>0 && anchor).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { AgentConsoleApi, EmployeeSummary } from '@/controllers/API/agent';

import { AuditEventRow } from './AuditEventRow';
import { AuditVerifyPanel } from './AuditVerifyPanel';
import { employeeLabelById } from './identity';
import { HelpTip } from './HelpTip';
import {
  CursorFoot,
  EmptyPanel,
  FilterBar,
  ListSkeleton,
  LkIcon,
  LkSelect,
  ReqId,
  StageCard,
  TableCard,
  useCursorList,
  type LkColumn,
} from './listkit';
import {
  DEFAULT_WINDOW,
  LIST_LIMITS,
  createHttpAuditApi,
  dispatchSearch,
  emptyQuery,
  filterSignature,
  formatShanghaiMinute,
  formatStamp,
  hasAnyAuditFilter,
  listRange,
  readAuditQuery,
  requestParams,
  shortId,
  writeAuditQuery,
  type AuditApi,
  type AuditEvent,
  type AuditQuery,
  type WindowKey,
  actionDisplay,
} from './aud01';
import './aud01.css';

const EMPLOYEES_LIMIT = 100;
const FRESH_STAMP = () => new Date().toISOString();

const WINDOW_SEG: Array<{ value: WindowKey; labelKey: string }> = [
  { value: '24h', labelKey: 'agentConsole.v2.aud01.window24h' },
  { value: '7d', labelKey: 'agentConsole.v2.aud01.window7d' },
  { value: '30d', labelKey: 'agentConsole.v2.aud01.window30d' },
  { value: 'custom', labelKey: 'agentConsole.v2.aud01.windowCustom' },
];

/** Employee dimension is 「either side」 — never both (spec §1.5 F3). */
type EmployeeMode = 'actor' | 'resource';

export interface AuditListPageProps {
  /** A3+A7 read-only adapter (injectable in tests; HTTP default in the app). */
  api?: AuditApi;
  /** E11 candidates for the employee chip + row names (degrades to raw ids). */
  consoleApi?: Pick<AgentConsoleApi, 'listEmployees'>;
  /** Initial search string (tests); defaults to `window.location.search`. */
  initialSearch?: string;
}

export function AuditListPage({ api, consoleApi, initialSearch }: AuditListPageProps) {
  const { t } = useTranslation();
  const auditApi = useMemo(() => api ?? createHttpAuditApi(), [api]);

  const [query, setQuery] = useState<AuditQuery>(() =>
    readAuditQuery(initialSearch ?? (typeof window !== 'undefined' ? window.location.search : '')),
  );
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [employees, setEmployees] = useState<EmployeeSummary[] | null>(null);
  const [searchText, setSearchText] = useState('');
  const [pendingEmp, setPendingEmp] = useState<string | null>(null);
  const [searchNote, setSearchNote] = useState<'event' | null>(null);
  const [customFrom, setCustomFrom] = useState(() => toLocalInput(query.from));
  const [customTo, setCustomTo] = useState(() => toLocalInput(query.to));
  const [customError, setCustomError] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const hasFilter = hasAnyAuditFilter(query);
  const signature = filterSignature(query);
  const hasFilterRef = useRef(hasFilter);
  hasFilterRef.current = hasFilter;

  // 401 → login (page-level redirect, never an in-page state).
  const onAuth = useCallback(() => {
    window.location.assign('/');
  }, []);

  const fetchPage = useCallback(
    (cursor: string | null) => {
      if (!hasFilterRef.current) {
        // No filter ⇒ NO request at all (not even a 400 probe).
        return Promise.resolve({
          ok: true,
          status: 200,
          data: { items: [] as AuditEvent[], nextCursor: undefined },
        });
      }
      return auditApi
        .listAudit({ ...requestParams(query), cursor: cursor ?? undefined })
        .then((res) =>
          res.ok && res.data
            ? {
                ok: true,
                status: res.status,
                data: { items: res.data.events, nextCursor: res.data.nextCursor },
                // S4.5: carry the gateway id so the error screens can print it.
                requestId: res.requestId,
              }
            : {
                ok: false,
                status: res.status,
                data: null,
                code: res.code,
                requestId: res.requestId,
              },
        );
    },
    [auditApi, query],
  );

  const list = useCursorList<AuditEvent>({
    fetchPage,
    keyOf: (e) => e.eventId,
    resetKey: `${signature}|${hasFilter ? 'y' : 'n'}`,
    initialCursor: query.cursor,
    onAuth,
  });

  const updateQuery = useCallback((patch: Partial<AuditQuery>) => {
    setQuery((prev) => {
      const next = { ...prev, ...patch, cursor: null };
      writeAuditQuery(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    const next = { ...emptyQuery(), limit: query.limit };
    setCustomFrom('');
    setCustomTo('');
    setCustomError(false);
    setPendingEmp(null);
    setSearchNote(null);
    setQuery(next);
    writeAuditQuery(next);
  }, [query.limit]);

  const onNext = useCallback(() => {
    if (!list.nextCursor) return;
    setQuery((prev) => {
      const next = { ...prev, cursor: list.nextCursor };
      writeAuditQuery(next);
      return next;
    });
    list.loadNext();
  }, [list]);

  const reloadFirst = useCallback(() => {
    setQuery((prev) => {
      const next = { ...prev, cursor: null };
      writeAuditQuery(next);
      return next;
    });
    list.reloadFirst();
  }, [list]);

  // Employee candidates: cosmetic failure degrades to the raw id (real value).
  useEffect(() => {
    if (!consoleApi) return undefined;
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

  // Freshness stamp only when a real page landed (never in the guide state).
  useEffect(() => {
    if (list.phase === 'ok' && hasFilter) setUpdatedAt(formatStamp(FRESH_STAMP()));
  }, [list.phase, list.items, hasFilter]);

  // No polling. A page returning from the background after >5 min re-reads
  // page 1 once (spec §7 轮询 row).
  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000) {
        hiddenAt = 0;
        reloadFirst();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [reloadFirst]);

  // `/` focuses the page search (⌘K stays the shell's global search).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== '/' || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const el = ev.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
      ev.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const employeeId = query.actorId || query.resourceId;
  const employeeMode: EmployeeMode = query.resourceId ? 'resource' : 'actor';

  const setEmployee = useCallback(
    (id: string, mode: EmployeeMode) => {
      updateQuery({
        actorId: id && mode === 'actor' ? id : '',
        resourceId: id && mode === 'resource' ? id : '',
      });
    },
    [updateQuery],
  );

  const submitSearch = useCallback(() => {
    const target = dispatchSearch(searchText);
    setSearchNote(null);
    setPendingEmp(null);
    if (!target) return;
    if (target.kind === 'event') {
      // `ev_` is NOT queryable here: details are a whole page (AUD-02).
      setSearchNote('event');
      return;
    }
    if (target.kind === 'employee') {
      setPendingEmp(target.value);
      return;
    }
    setSearchText('');
    updateQuery({
      runId: target.kind === 'runId' ? target.value : '',
      taskId: target.kind === 'taskId' ? target.value : '',
      resourceId: target.kind === 'resourceId' ? target.value : '',
      action: target.kind === 'action' ? target.value : '',
      actorId: '',
    });
  }, [searchText, updateQuery]);

  const applyCustom = useCallback(() => {
    const from = fromLocalInput(customFrom);
    const to = fromLocalInput(customTo);
    if (from && to && Date.parse(from) > Date.parse(to)) {
      setCustomError(true);
      return; // blocked BEFORE any request (upstream would 400 the same way)
    }
    setCustomError(false);
    updateQuery({ window: 'custom', from, to });
  }, [customFrom, customTo, updateQuery]);

  const clearTime = useCallback(() => {
    setCustomFrom('');
    setCustomTo('');
    setCustomError(false);
    updateQuery({ window: 'custom', from: '', to: '' });
  }, [updateQuery]);

  const columns = useMemo(() => buildColumns(t), [t]);
  const range = listRange(query);
  const hasExtra = hasExtraFilters(query);
  const empLabel = employeeId
    ? t('agentConsole.v2.aud01.filterEmployeeValue', {
        name: employeeLabelById(employeeId, names, t),
      })
    : t('agentConsole.v2.aud01.filterEmployee');

  const searchBox = (
    <div className="fsearch">
      <LkIcon name="search" size={14} />
      <input
        ref={searchRef}
        type="text"
        value={searchText}
        placeholder={t('agentConsole.v2.aud01.searchPlaceholder')}
        aria-label={t('agentConsole.v2.aud01.searchAria')}
        data-testid="aud01-search"
        onChange={(ev) => {
          setSearchText(ev.target.value);
          setSearchNote(null);
        }}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            submitSearch();
          }
        }}
      />
      <span className="k">
        <kbd>/</kbd>
      </span>
    </div>
  );

  const employeeControls = (
    <>
      <LkSelect
        spec={{
          id: 'aud01-filter-employee',
          label: empLabel,
          title: t('agentConsole.v2.aud01.filterEmployeeTitle'),
          value: employeeId,
          active: employeeId !== '',
          options: [
            { value: '', label: t('agentConsole.v2.aud01.filterAll') },
            ...(employees ?? []).map((e) => ({
              value: e.employeeId,
              // S2: an employee without a name still reads 「员工 · 短码」
              label: employeeLabelById(e.employeeId, names, t),
            })),
          ],
          onChange: (v) => setEmployee(v, employeeMode),
        }}
      />
      {employeeId ? (
        <div className="seg sm" role="group" aria-label={t('agentConsole.v2.aud01.empModeAria')}>
          <button
            type="button"
            aria-pressed={employeeMode === 'actor'}
            data-testid="aud01-emp-as-actor"
            onClick={() => setEmployee(employeeId, 'actor')}
          >
            {t('agentConsole.v2.aud01.empAsActor')}
          </button>
          <button
            type="button"
            aria-pressed={employeeMode === 'resource'}
            data-testid="aud01-emp-as-resource"
            onClick={() => setEmployee(employeeId, 'resource')}
          >
            {t('agentConsole.v2.aud01.empAsResource')}
          </button>
        </div>
      ) : null}
      <HelpTip term="empDimension" testId="aud01-help-emp" />
    </>
  );

  const filterBar = (
    <>
      <FilterBar
        ariaLabel={t('agentConsole.v2.aud01.filterAria')}
        search={searchBox}
        mid={employeeControls}
        seg={{
          ariaLabel: t('agentConsole.v2.aud01.filterWindowAria'),
          items: WINDOW_SEG.map((w) => ({ value: w.value, label: t(w.labelKey) })),
          value: query.window,
          onChange: (v) => {
            if (v === 'custom') {
              updateQuery({ window: 'custom', from: fromLocalInput(customFrom), to: fromLocalInput(customTo) });
              return;
            }
            updateQuery({ window: v as WindowKey, from: '', to: '' });
          },
        }}
        selectsAfter={[
          {
            id: 'aud01-filter-limit',
            label: t('agentConsole.v2.aud01.filterLimit', { n: query.limit }),
            title: t('agentConsole.v2.aud01.filterLimitTitle'),
            value: String(query.limit),
            options: LIST_LIMITS.map((n) => ({
              value: String(n),
              label: t('agentConsole.v2.aud01.filterLimit', { n }),
            })),
            onChange: (v) => updateQuery({ limit: Number(v) }),
          },
        ]}
        clear={{
          label: t('agentConsole.v2.aud01.clear'),
          disabled: !hasExtra,
          title: hasExtra
            ? t('agentConsole.v2.aud01.clearTitle')
            : t('agentConsole.v2.aud01.clearDisabledTitle'),
          onClear: clearAll,
        }}
        count={
          hasFilter
            ? {
                pre: t('agentConsole.v2.aud01.loadedPre'),
                post: t('agentConsole.v2.aud01.loadedPost'),
                n: list.phase === 'ok' ? list.items.length : 0,
              }
            : { pre: t('agentConsole.v2.aud01.notQueriedPre'), post: '', n: 0 }
        }
      />

      {query.window === 'custom' ? (
        <div className="custombar">
          <label>
            <span>{t('agentConsole.v2.aud01.customFrom')}</span>
            <input
              type="datetime-local"
              value={customFrom}
              data-testid="aud01-custom-from"
              onChange={(ev) => setCustomFrom(ev.target.value)}
            />
          </label>
          <label>
            <span>{t('agentConsole.v2.aud01.customTo')}</span>
            <input
              type="datetime-local"
              value={customTo}
              data-testid="aud01-custom-to"
              onChange={(ev) => setCustomTo(ev.target.value)}
            />
          </label>
          <button type="button" className="b sm out" data-testid="aud01-custom-apply" onClick={applyCustom}>
            {t('agentConsole.v2.aud01.customApply')}
          </button>
          <button type="button" className="b sm gh" data-testid="aud01-custom-clear" onClick={clearTime}>
            {t('agentConsole.v2.aud01.customClear')}
          </button>
          {customError ? (
            <span className="alertline" role="alert" data-testid="aud01-custom-error">
              {t('agentConsole.v2.aud01.customRangeError')}
            </span>
          ) : null}
        </div>
      ) : null}

      {searchNote === 'event' ? (
        <div className="alertline inline" role="alert" data-testid="aud01-search-note">
          {t('agentConsole.v2.aud01.searchEventNotQueryable')}
        </div>
      ) : null}

      {pendingEmp ? (
        <div className="alertline inline" data-testid="aud01-emp-pick">
          <span>{t('agentConsole.v2.aud01.empPickPrompt', { id: pendingEmp })}</span>
          <button
            type="button"
            className="b xs out"
            data-testid="aud01-emp-pick-actor"
            onClick={() => {
              setEmployee(pendingEmp, 'actor');
              setPendingEmp(null);
              setSearchText('');
            }}
          >
            {t('agentConsole.v2.aud01.empAsActor')}
          </button>
          <button
            type="button"
            className="b xs out"
            data-testid="aud01-emp-pick-resource"
            onClick={() => {
              setEmployee(pendingEmp, 'resource');
              setPendingEmp(null);
              setSearchText('');
            }}
          >
            {t('agentConsole.v2.aud01.empAsResource')}
          </button>
        </div>
      ) : null}

      <div className="fchips" data-testid="aud01-chips">
        <span className="lb">{t('agentConsole.v2.aud01.applied')}</span>
        {query.window === 'custom' && !query.from && !query.to ? (
          <span className="ftag">
            <span className="fk">{t('agentConsole.v2.aud01.chipTime')}</span>
            <span className="fv">{t('agentConsole.v2.aud01.noTimeWindow')}</span>
          </span>
        ) : (
          <span className="ftag">
            <span className="fk">{t('agentConsole.v2.aud01.chipTime')}</span>
            <span className="fv">
              {query.window === 'custom'
                ? `${query.from ? formatStamp(query.from) : '—'} → ${query.to ? formatStamp(query.to) : '—'}`
                : t(WINDOW_SEG.find((w) => w.value === query.window)!.labelKey)}
            </span>
            {query.window === 'custom' ? (
              <button
                type="button"
                className="rm"
                aria-label={t('agentConsole.v2.aud01.removeTime')}
                data-testid="aud01-chip-time-rm"
                onClick={clearTime}
              >
                <LkIcon name="x" size={13} />
              </button>
            ) : (
              <span className="hd-note">{t('agentConsole.v2.aud01.timeAlwaysOn')}</span>
            )}
          </span>
        )}
        {query.action ? (
          <RemovableTag
            label={t('agentConsole.v2.aud01.chipAction')}
            value={actionDisplay(query.action, t) ?? query.action}
            title={query.action}
            ariaLabel={t('agentConsole.v2.aud01.removeAction')}
            onRemove={() => updateQuery({ action: '' })}
            testId="aud01-chip-action"
          />
        ) : null}
        {query.runId ? (
          <RemovableTag
            label="run"
            value={shortId(query.runId)}
            title={query.runId}
            ariaLabel={t('agentConsole.v2.aud01.removeRun')}
            onRemove={() => updateQuery({ runId: '' })}
            testId="aud01-chip-run"
          />
        ) : null}
        {query.taskId ? (
          <RemovableTag
            label={t('agentConsole.v2.aud01.colTask')}
            value={shortId(query.taskId)}
            title={query.taskId}
            ariaLabel={t('agentConsole.v2.aud01.removeTask')}
            onRemove={() => updateQuery({ taskId: '' })}
            testId="aud01-chip-task"
          />
        ) : null}
        {query.actorId ? (
          <RemovableTag
            label={t('agentConsole.v2.aud01.empAsActor')}
            value={employeeLabelById(query.actorId, names, t)}
            title={query.actorId}
            ariaLabel={t('agentConsole.v2.aud01.removeEmployee')}
            onRemove={() => updateQuery({ actorId: '' })}
            testId="aud01-chip-actor"
          />
        ) : null}
        {query.resourceId ? (
          <RemovableTag
            label={t('agentConsole.v2.aud01.empAsResource')}
            value={employeeLabelById(query.resourceId, names, t)}
            title={query.resourceId}
            ariaLabel={t('agentConsole.v2.aud01.removeResource')}
            onRemove={() => updateQuery({ resourceId: '' })}
            testId="aud01-chip-resource"
          />
        ) : null}
        <span className="fnote">{t('agentConsole.v2.aud01.chipNote')}</span>
      </div>
      <div className="rule" />
    </>
  );

  const head = (
    <PageHead t={t} updatedAt={updatedAt} />
  );

  // ---------- state screens ----------

  if (!hasFilter) {
    return (
      <div className="lk aud01" data-testid="agent-v2-page-audit">
        {head}
        <ReadonlyBanner t={t} />
        <NoFilterGuide
          t={t}
          filterBar={filterBar}
          onWiden={() => updateQuery({ window: '7d' })}
          onFocusSearch={() => searchRef.current?.focus()}
        />
        <PageFoot t={t} />
      </div>
    );
  }

  if (list.phase === 'loading') {
    return (
      <div className="lk aud01" data-testid="agent-v2-page-audit">
        {head}
        <ReadonlyBanner t={t} />
        <AuditVerifyPanel api={auditApi} showCode={false} />
        <ListSkeleton
          ariaLabel={t('agentConsole.v2.aud01.loadingAria')}
          note={t('agentConsole.v2.aud01.loadingNote')}
        />
        <PageFoot t={t} />
      </div>
    );
  }

  if (list.phase === 'error') {
    const code = list.httpStatus;
    return (
      <div className="lk aud01" data-testid="agent-v2-page-audit">
        {head}
        <ReadonlyBanner t={t} />
        <StageCard
          icon="alert"
          title={t('agentConsole.v2.aud01.errorTitle')}
          desc={
            code > 0 ? (
              <>
                {t('agentConsole.v2.aud01.errorDescPre')}
                <span className="mono">HTTP {code}</span>
                {t('agentConsole.v2.aud01.errorDescPost')}
              </>
            ) : (
              t('agentConsole.v2.aud01.errorDescNetwork')
            )
          }
          testId="aud01-error"
        >
          <button type="button" className="b out" data-testid="aud01-retry" onClick={reloadFirst}>
            <LkIcon name="refresh" size={16} />
            {t('agentConsole.v2.aud01.reload')}
          </button>
          <a className="lnk" href="/agent" style={{ alignSelf: 'center' }}>
            {t('agentConsole.v2.aud01.backOverview')}
          </a>
          {/* S4: the request line is always present — copyable id or 未提供. */}
          <ReqId requestId={list.requestId} testId="aud01-error-reqid" />
        </StageCard>
        <PageFoot t={t} />
      </div>
    );
  }

  if (list.phase === 'forbidden') {
    // 403 and 404 share one body — never leak existence, never half a table.
    return (
      <div className="lk aud01" data-testid="agent-v2-page-audit">
        {head}
        <ReadonlyBanner t={t} />
        <StageCard
          icon="lock"
          title={t('agentConsole.v2.aud01.forbiddenTitle')}
          desc={
            <>
              {t('agentConsole.v2.aud01.forbiddenDescPre')}
              <span className="mono">HTTP {list.httpStatus}</span>
              {t('agentConsole.v2.aud01.forbiddenDescPost')}
            </>
          }
          testId="aud01-forbidden"
        >
          <button
            type="button"
            className="b out"
            data-testid="aud01-forbidden-retry"
            onClick={reloadFirst}
          >
            <LkIcon name="refresh" size={16} />
            {t('agentConsole.v2.aud01.forbiddenRetry')}
          </button>
          <ReqId requestId={list.requestId} testId="aud01-forbidden-reqid" />
        </StageCard>
        <PageFoot t={t} />
      </div>
    );
  }

  // ---------- normal / empty ----------

  return (
    <div className="lk aud01" data-testid="agent-v2-page-audit">
      {head}
      <ReadonlyBanner t={t} />
      <AuditVerifyPanel api={auditApi} showCode={false} />

      <div className="card" style={{ padding: 0 }}>
        {filterBar}
        {list.items.length === 0 ? (
          <EmptyPanel
            title={t('agentConsole.v2.aud01.emptyTitle')}
            desc={t('agentConsole.v2.aud01.emptyDesc')}
            actionLabel={t('agentConsole.v2.aud01.emptyClear')}
            onAction={clearAll}
          />
        ) : (
          <TableCard
            ariaLabel={t('agentConsole.v2.aud01.tableAria')}
            columns={columns}
            foot={
              <CursorFoot
                pageRowsText={t('agentConsole.v2.aud01.pageRows', { n: list.items.length })}
                noteText={t('agentConsole.v2.aud01.cursorNoteHuman', { n: query.limit })}
                lastPageNote={
                  list.nextCursor
                    ? undefined
                    : t('agentConsole.v2.aud01.lastPageNoteHuman', {
                        n: list.items.length,
                      })
                }
                hintText={t('agentConsole.v2.aud01.tblHintHuman')}
                nextLabel={t('agentConsole.v2.aud01.next')}
                nextTitle={t('agentConsole.v2.aud01.nextTitleHuman')}
                lastPageTitle={t('agentConsole.v2.aud01.lastPageTitle')}
                hasNext={list.nextCursor !== null}
                loadingMore={list.loadingMore}
                onNext={onNext}
                stale={list.stale}
                staleTitle={t('agentConsole.v2.aud01.staleTitle')}
                staleDesc={t('agentConsole.v2.aud01.staleDesc')}
                staleReloadLabel={t('agentConsole.v2.aud01.staleReload')}
                onReloadFirst={reloadFirst}
                nextErrorText={
                  list.nextError !== null
                    ? list.nextError > 0
                      ? t('agentConsole.v2.aud01.nextError', { code: list.nextError })
                      : t('agentConsole.v2.aud01.nextErrorNetwork')
                    : null
                }
                retryLabel={t('agentConsole.v2.aud01.nextRetry')}
                caliberText={t('agentConsole.v2.aud01.caliber')}
              />
            }
          >
            {list.items.map((event) => (
              <AuditEventRow key={event.eventId} event={event} t={t} names={names} />
            ))}
          </TableCard>
        )}
      </div>
      <PageFoot t={t} />
      <span className="sr-only" data-testid="aud01-range">
        {formatShanghaiMinute(range.from ?? '')} → {formatShanghaiMinute(range.to ?? '')}
      </span>
    </div>
  );
}

// ---------- subcomponents ----------

function PageHead({ t, updatedAt }: { t: TFunction; updatedAt: string | null }) {
  return (
    <>
      <div className="phead">
        <div>
          <h1 className="h1">{t('agentConsole.v2.navAudit')}</h1>
          <p className="sub">{t('agentConsole.v2.aud01.sub')}</p>
        </div>
      </div>
      <div className="fresh">
        <LkIcon name="clock" size={13} />
        <span>
          {t('agentConsole.v2.aud01.freshUpdated')} <span className="mono">{updatedAt ?? '—'}</span>
        </span>
        <span className="faint">·</span>
        <span>
          {t('agentConsole.v2.aud01.freshSource')}{' '}
          {t('agentConsole.v2.aud01.freshSourceValue')} · {t('agentConsole.v2.aud01.freshReadonly')}
        </span>
        <span className="faint">·</span>
        <span>{t('agentConsole.v2.aud01.freshNoPolling')}</span>
      </div>
    </>
  );
}

function ReadonlyBanner({ t }: { t: TFunction }) {
  return (
    <div className="roband" role="note" aria-label={t('agentConsole.v2.aud01.bannerAria')}>
      <LkIcon name="lock" size={14} />
      <span>
        <b>{t('agentConsole.v2.aud01.bannerLead')}</b>
        {t('agentConsole.v2.aud01.bannerBodyHuman')}
      </span>
      <HelpTip term="readonlyBanner" testId="aud01-help-readonly" />
      <div className="sp" />
      <span className="mono">{t('agentConsole.v2.aud01.bannerMono')}</span>
    </div>
  );
}

function RemovableTag({
  label,
  value,
  title,
  ariaLabel,
  onRemove,
  testId,
}: {
  label: string;
  value: string;
  title?: string;
  ariaLabel: string;
  onRemove: () => void;
  testId: string;
}) {
  return (
    <span className="ftag" data-testid={testId}>
      <span className="fk">{label}</span>
      <span className="fv" title={title}>
        {value}
      </span>
      <button type="button" className="rm" aria-label={ariaLabel} onClick={onRemove}>
        <LkIcon name="x" size={13} />
      </button>
    </span>
  );
}

function NoFilterGuide({
  t,
  filterBar,
  onWiden,
  onFocusSearch,
}: {
  t: TFunction;
  filterBar: ReactNode;
  onWiden: () => void;
  onFocusSearch: () => void;
}) {
  return (
    <div className="card" style={{ padding: 0 }} data-testid="aud01-nofilter">
      {filterBar}
      <div className="guide">
        <span className="ic" aria-hidden="true">
          <LkIcon name="info" size={20} />
        </span>
        <div className="t">{t('agentConsole.v2.aud01.guideTitle')}</div>
        <div className="s">{t('agentConsole.v2.aud01.guideDesc')}</div>
        <div className="qs">
          <button type="button" className="b sm out" data-testid="aud01-guide-widen" onClick={onWiden}>
            {t('agentConsole.v2.aud01.guideWiden')}
          </button>
          <button type="button" className="b sm out" data-testid="aud01-guide-run" onClick={onFocusSearch}>
            {t('agentConsole.v2.aud01.guideRun')}
          </button>
          <button type="button" className="b sm out" data-testid="aud01-guide-action" onClick={onFocusSearch}>
            {t('agentConsole.v2.aud01.guideAction')}
          </button>
        </div>
      </div>
    </div>
  );
}

function PageFoot({ t }: { t: TFunction }) {
  return (
    <div className="pfoot">
      <span>{t('agentConsole.v2.aud01.footSource')}</span>
      <span className="sp" aria-hidden="true" />
      <span>{t('agentConsole.v2.aud01.footCaliber')}</span>
    </div>
  );
}

// ---------- helpers ----------

function buildColumns(t: TFunction): LkColumn[] {
  return [
    {
      key: 'time',
      label: (
        <span className="inf">
          {t('agentConsole.v2.aud01.colTime')}
          <HelpTip term="timeColumn" testId="aud01-help-time" />
        </span>
      ),
      width: 112,
      align: 'right',
    },
    { key: 'source', label: t('agentConsole.v2.aud01.colSource'), width: 84 },
    { key: 'action', label: t('agentConsole.v2.aud01.colAction'), width: 160 },
    { key: 'actor', label: t('agentConsole.v2.aud01.colActor'), width: 138 },
    { key: 'behalf', label: t('agentConsole.v2.aud01.colBehalf'), width: 84 },
    {
      key: 'decision',
      label: (
        <span className="inf">
          {t('agentConsole.v2.aud01.colDecision')}
          <HelpTip term="decisionPair" testId="aud01-help-decision" />
        </span>
      ),
      width: 96,
    },
    {
      key: 'outcome',
      label: (
        <span className="inf">
          {t('agentConsole.v2.aud01.colOutcome')}
          <HelpTip term="outcomeEnum" testId="aud01-help-outcome" />
        </span>
      ),
      width: 96,
    },
    { key: 'run', label: 'run', width: 108 },
    { key: 'task', label: t('agentConsole.v2.aud01.colTask'), width: 108 },
    { key: 'approval', label: t('agentConsole.v2.aud01.colApproval'), width: 88 },
    { key: 'resource', label: t('agentConsole.v2.aud01.colResource'), width: 112 },
    // 96px holds three 28px controls (expand · 详情 link · ⋯ menu); the 28px
    // comes out of 动作/主体 so the 12-column sum stays at the 1282 floor.
    { key: 'ops', label: t('agentConsole.v2.aud01.colOps'), width: 96, align: 'right' },
  ];
}

/** Only the default/empty time window is "nothing to clear" (spec §1.5 F4). */
function hasExtraFilters(q: AuditQuery): boolean {
  return Boolean(
    q.runId ||
      q.taskId ||
      q.actorId ||
      q.resourceId ||
      q.action ||
      (q.window === 'custom' && (q.from || q.to)) ||
      (q.window !== DEFAULT_WINDOW && !(q.window === 'custom' && !q.from && !q.to)),
  );
}

/** ISO → `<input type="datetime-local">` value, always Beijing wall clock (minutes). */
function toLocalInput(iso: string): string {
  if (!iso) return '';
  const stamp = formatShanghaiMinute(iso);
  return stamp === '—' ? '' : stamp.replace(' ', 'T');
}

/** `<input type="datetime-local">` value (Beijing wall clock) → ISO (empty stays empty). */
function fromLocalInput(value: string): string {
  if (!value) return '';
  const stamp = value.length === 16 ? `${value}:00` : value;
  const ms = Date.parse(`${stamp}+08:00`);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString();
}