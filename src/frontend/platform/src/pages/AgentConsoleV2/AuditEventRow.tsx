/**
 * AUD-01 event row + inline expansion (AUD01-TARGET-SPEC §1.7/§1.8).
 *
 * Every upstream string (action / actor.id / actor.displayName / resource.id /
 * resource.type / before-after keys and values / error text) is rendered as a
 * React child, i.e. as TEXT. There is no dangerouslySetInnerHTML, no string
 * concatenation into markup, and truncation is CSS-only (title + copy keep the
 * full original bytes, including quotes).
 *
 * The expansion needs no A4: A3 already returns before/after/hash/prevHash, so
 * the diff and the integrity block are self-sufficient here.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';

import { HelpTip } from './HelpTip';
import { CopyId } from './listkit';
import { LkIcon } from './listkit/icons';
import {
  actorLabel,
  employeeResourceIdLabel,
  humanRefLabel,
  isPlaceholderIdentity,
  resourceTypeLabel,
} from './identity';
import {
  actionLabelKey,
  CLOCK_SKEW_MS,
  DECISION_KEYS,
  OUTCOME_KEYS,
  SOURCE_LABEL_KEYS,
  actorIcon,
  clockSkewMs,
  decisionTone,
  diffRows,
  formatLatency,
  formatOccurred,
  formatSpan,
  isStructured,
  outcomeTone,
  shortId,
  type AuditEvent,
  type DiffRow,
} from './aud01';

/** TSK-02 (`/agent/tasks/:id`) is not built yet: the honest state is disabled. */
export const TASK_DETAIL_READY = false;

const jsonText = (v: unknown): string => {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v) ?? '—';
  } catch {
    return '—';
  }
};

export interface AuditEventRowProps {
  event: AuditEvent;
  t: TFunction;
  /** S2: employeeId → name directory (E11). Cosmetic: absent ⇒ 「员工 · 短码」. */
  names?: Map<string, string>;
}

export function AuditEventRow({ event, t, names }: AuditEventRowProps) {
  const [open, setOpen] = useState(false);
  const occurred = formatOccurred(event.occurredAt);
  const latency = formatLatency(event.occurredAt, event.recordedAt);
  const skew = clockSkewMs(event.occurredAt, event.recordedAt);

  const timeTitle = [
    `${t('agentConsole.v2.aud01.timeOccurred')} ${event.occurredAt}`,
    `${t('agentConsole.v2.aud01.timeRecorded')} ${event.recordedAt}`,
    latency ? `(${latency})` : null,
  ]
    .filter(Boolean)
    .join(' / ');

  return (
    <>
      <tr className={`trow-main${open ? ' exp-open' : ''}`} data-testid={`aud01-row-${event.eventId}`}>
        <td className="num mono" data-l={t('agentConsole.v2.aud01.colTime')} title={timeTitle}>
          {skew > CLOCK_SKEW_MS ? (
            <span className="idcell clock-cell">
              <span>{occurred}</span>
              <span
                className="clock-diff"
                role="img"
                aria-label={t('agentConsole.v2.aud01.clockSkewAria', { span: formatSpan(skew) })}
              >
                <LkIcon name="clockAlert" size={13} />
                {t('agentConsole.v2.aud01.clockSkew')}
                <HelpTip term="clockSkew" testId="aud01-help-skew" />
              </span>
            </span>
          ) : (
            occurred
          )}
        </td>

        <td data-l={t('agentConsole.v2.aud01.colSource')}>
          <span className="cell2">
            <span className="l" title={`sourceSystem=${event.sourceSystem}`}>
              {sourceLabel(t, event.sourceSystem)}
            </span>
          </span>
        </td>

        <td data-l={t('agentConsole.v2.aud01.colAction')}>
          <span className="cell2">
            {actionLabelKey(event.action) ? (
              <span className="l">{t(`agentConsole.v2.aud01.${actionLabelKey(event.action)}`)}</span>
            ) : null}
            {/* Unknown actions are NOT machine-translated: raw value only. */}
            <span className={actionLabelKey(event.action) ? 's' : 'l mono'}>{event.action}</span>
          </span>
        </td>

        <td data-l={t('agentConsole.v2.aud01.colActor')}>
          <span
            className="who"
            title={`actor.type=${event.actor.type} · ${event.actor.id}`}
          >
            <span className="ava">
              <LkIcon name={actorIcon(event.actor.type)} size={13} />
            </span>
            {/* S2: readable identity — displayName, 用户 #N, 员工名/员工 · 短码
                or 「系统 · employee-api」; the raw ref stays in the title only. */}
            <span className="nm">{actorLabel(event.actor, names, t)}</span>
          </span>
        </td>

        <td data-l={t('agentConsole.v2.aud01.colBehalf')}>
          {event.onBehalfOf ? (
            <span className="behalf" title={`onBehalfOf: ${event.onBehalfOf}`}>
              → {isPlaceholderIdentity(event.onBehalfOf)
                ? t('agentConsole.v2.id.unknown')
                : humanRefLabel(event.onBehalfOf, t)}
            </span>
          ) : (
            <span className="faint">—</span>
          )}
        </td>

        <td data-l={t('agentConsole.v2.aud01.colDecision')}>
          <DecisionCell decision={event.decision} t={t} />
        </td>

        <td data-l={t('agentConsole.v2.aud01.colOutcome')}>
          <OutcomeCell outcome={event.outcome} t={t} />
        </td>

        <td className="mono" data-l="run">
          {event.runId ? (
            <span className="idcell">
              {/* the id itself is the RUN-02 jump: one line, like the target */}
              <CopyId
                value={event.runId}
                display={shortId(event.runId)}
                ariaLabel={t('agentConsole.v2.aud01.copyRun')}
                copiedLabel={t('agentConsole.v2.aud01.copied')}
                href={`/agent/runs/${encodeURIComponent(event.runId)}`}
                linkLabel={t('agentConsole.v2.aud01.viewRunTitle', { id: event.runId })}
                testId={`aud01-run-link-${event.eventId}`}
              />
            </span>
          ) : (
            <span className="faint mono">—</span>
          )}
        </td>

        <td className="mono" data-l={t('agentConsole.v2.aud01.colTask')}>
          {event.taskId ? (
            <span className="idcell">
              <CopyId
                value={event.taskId}
                display={shortId(event.taskId)}
                ariaLabel={t('agentConsole.v2.aud01.copyTask')}
                copiedLabel={t('agentConsole.v2.aud01.copied')}
              />
              <TaskJump taskId={event.taskId} t={t} />
            </span>
          ) : (
            <span className="faint mono">—</span>
          )}
        </td>

        <td data-l={t('agentConsole.v2.aud01.colApproval')}>
          {event.approvalId ? (
            <span className="idcell">
              <CopyId
                value={event.approvalId}
                display={shortId(event.approvalId)}
                ariaLabel={t('agentConsole.v2.aud01.copyApproval')}
                copiedLabel={t('agentConsole.v2.aud01.copied')}
              />
              {/* The approval jump lives in the row expansion (the row keeps
                  the copy control only — 88px cannot hold 「审批详情」). */}
            </span>
          ) : (
            <span className="faint mono">—</span>
          )}
        </td>

        <td data-l={t('agentConsole.v2.aud01.colResource')}>
          <span
            className="rescell"
            title={
              event.resource.ownerRef || event.resource.scopeRef
                ? [
                    event.resource.ownerRef ? `ownerRef: ${event.resource.ownerRef}` : null,
                    event.resource.scopeRef ? `scopeRef: ${event.resource.scopeRef}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : undefined
            }
          >
            {/* S2: type word is localized (EMPLOYEE → 员工) and employee
                resources print the name or 「员工 · 短码」 — the CopyId keeps
                the full `emp_…` id in title + copy (visual truncation rule). */}
            <span className="rt">{resourceTypeLabel(event.resource.type, t)}</span>
            <CopyId
              value={event.resource.id}
              display={
                event.resource.type === 'employee'
                  ? employeeResourceIdLabel(event.resource.id, names, t)
                  : shortId(event.resource.id)
              }
              ariaLabel={t('agentConsole.v2.aud01.copyResource')}
              copiedLabel={t('agentConsole.v2.aud01.copied')}
            />
            {event.resource.type === 'employee' ? (
              <a
                className="jump"
                href={`/agent/employees/${encodeURIComponent(event.resource.id)}`}
                data-testid={`aud01-employee-link-${event.eventId}`}
              >
                {t('agentConsole.v2.aud01.viewEmployee')}
                <LkIcon name="chevR" size={13} />
              </a>
            ) : null}
          </span>
        </td>

        <td className="r" data-l={t('agentConsole.v2.aud01.colOps')}>
          <span className="ops">
            <button
              type="button"
              className="opb"
              aria-label={
                open
                  ? t('agentConsole.v2.aud01.collapseRow')
                  : t('agentConsole.v2.aud01.expandRow')
              }
              aria-expanded={open}
              data-testid={`aud01-expand-${event.eventId}`}
              onClick={() => setOpen((v) => !v)}
            >
              <span className="chevwrap">
                <LkIcon name="chevR" size={14} />
              </span>
            </button>
            <RowMenu eventId={event.eventId} t={t} />
          </span>
        </td>
      </tr>

      {open ? (
        <tr className="exp" data-testid={`aud01-exp-${event.eventId}`}>
          <td colSpan={12}>
            <Expansion event={event} t={t} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function sourceLabel(t: TFunction, source: string): string {
  const key = SOURCE_LABEL_KEYS[source];
  if (key === undefined) {
    // Unlisted enums render verbatim — never invented, never guessed.
    console.error('[AUD-01] unknown sourceSystem:', source);
    return source;
  }
  return t(`agentConsole.v2.aud01.${key}`);
}

function DecisionCell({ decision, t }: { decision?: string; t: TFunction }) {
  if (decision === undefined) {
    // Key absent = the event carries no decision field (NOT not_applicable).
    return (
      <span className="faint" title={t('agentConsole.v2.aud01.decisionAbsentTitle')}>
        —
      </span>
    );
  }
  if (decision === 'not_applicable') {
    return (
      <span className="faint" title={t('agentConsole.v2.aud01.decisionNaTitle')}>
        —
      </span>
    );
  }
  const key = DECISION_KEYS[decision];
  if (key === undefined) {
    console.error('[AUD-01] unknown decision:', decision);
    return <span className="mono">{decision}</span>;
  }
  const titleKey =
    decision === 'require_approval'
      ? 'decisionRequireApprovalTitle'
      : decision === 'approved'
        ? 'decisionApprovedTitle'
        : decision === 'deny'
          ? 'decisionDenyTitle'
          : undefined;
  return (
    <span className={`pill ${decisionTone(decision)}`} title={titleKey ? t(`agentConsole.v2.aud01.${titleKey}`) : undefined}>
      <span className="dot" aria-hidden="true" />
      {t(`agentConsole.v2.aud01.${key}`)}
    </span>
  );
}

function OutcomeCell({ outcome, t }: { outcome: string; t: TFunction }) {
  const key = OUTCOME_KEYS[outcome];
  if (key === undefined) {
    console.error('[AUD-01] unknown outcome:', outcome);
    return <span className="mono">{outcome}</span>;
  }
  return (
    <span className={`pill ${outcomeTone(outcome)}`}>
      <span className="dot" aria-hidden="true" />
      {t(`agentConsole.v2.aud01.${key}`)}
    </span>
  );
}

/**
 * C9 three mutually exclusive states (裁定 ②). Loading never spins: it is
 * `aria-busy` + a static icon + copy (DESIGN-SYSTEM §6.6 — no autoplay motion).
 */
function TaskJump({ taskId, t }: { taskId: string; t: TFunction }) {
  const [loading, setLoading] = useState(false);
  const href = `/agent/tasks/${encodeURIComponent(taskId)}`;

  if (!TASK_DETAIL_READY) {
    return (
      <a
        className="jump dis"
        aria-disabled="true"
        title={t('agentConsole.v2.aud01.taskJumpDisabled')}
        onClick={(ev) => ev.preventDefault()}
      >
        {t('agentConsole.v2.aud01.viewTask')}
      </a>
    );
  }
  if (loading) {
    return (
      <span className="jump load" role="status" aria-busy="true" aria-live="polite">
        <LkIcon name="clock" size={13} />
        {t('agentConsole.v2.aud01.taskJumpLoading')}
      </span>
    );
  }
  return (
    <a
      className="jump"
      href={href}
      onClick={(ev) => {
        ev.preventDefault();
        setLoading(true);
        window.location.assign(href);
      }}
    >
      {t('agentConsole.v2.aud01.viewTask')}
      <LkIcon name="chevR" size={13} />
    </a>
  );
}

/** `⋯` row menu: copy the event id; the detail page (AUD-02) is not built. */
function RowMenu({ eventId, t }: { eventId: string; t: TFunction }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (ev: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(ev.target as Node)) setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const copy = useCallback(() => {
    try {
      void navigator.clipboard?.writeText(eventId);
    } catch {
      /* clipboard unavailable: the value stays visible in the row */
    }
    setOpen(false);
  }, [eventId]);

  return (
    <span className="opsmore" ref={rootRef}>
      <button
        type="button"
        className="opb"
        aria-label={t('agentConsole.v2.aud01.moreActions')}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={`aud01-more-${eventId}`}
        onClick={() => setOpen((v) => !v)}
      >
        <LkIcon name="more" size={14} />
      </button>
      {open ? (
        <span className="opmenu" role="menu">
          <button type="button" role="menuitem" onClick={copy} data-testid={`aud01-copy-event-${eventId}`}>
            {t('agentConsole.v2.aud01.copyEventId')}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled
            aria-disabled="true"
            title={t('agentConsole.v2.aud01.detailDisabled')}
          >
            {t('agentConsole.v2.aud01.openDetail')}
          </button>
        </span>
      ) : null}
    </span>
  );
}

function DiffValue({ value }: { value: unknown }) {
  const [expanded, setExpanded] = useState(false);
  if (!isStructured(value)) {
    return <span className="dv">{jsonText(value)}</span>;
  }
  const text = jsonText(value);
  return (
    <span className="dv">
      {expanded ? (
        <pre className="dvpre">{text}</pre>
      ) : (
        <button type="button" className="dvline" title={text} onClick={() => setExpanded(true)}>
          {text}
        </button>
      )}
    </span>
  );
}

function DiffLine({ row, t }: { row: DiffRow; t: TFunction }) {
  const sign = row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : '~';
  return (
    <div className={`drow ${row.kind === 'add' ? 'add' : row.kind === 'del' ? 'del' : 'chg'}`}>
      <span className="sgn" aria-hidden="true">
        {sign}
      </span>
      <span className="dk">{row.key}</span>
      {row.kind === 'chg' ? (
        <>
          <span className="old dv">{jsonText(row.before)}</span>
          <span className="arw" aria-hidden="true">
            →
          </span>
          <DiffValue value={row.after} />
        </>
      ) : (
        <DiffValue value={row.kind === 'add' ? row.after : row.before} />
      )}
      <span className="sr-only">
        {row.kind === 'add'
          ? t('agentConsole.v2.aud01.diffAdded')
          : row.kind === 'del'
            ? t('agentConsole.v2.aud01.diffRemoved')
            : t('agentConsole.v2.aud01.diffChanged')}
      </span>
    </div>
  );
}

function Expansion({ event, t }: { event: AuditEvent; t: TFunction }) {
  const diff = diffRows(event.before, event.after);
  const hasDiff = event.before !== undefined || event.after !== undefined;

  return (
    <div className="expbox">
      <div className="col">
        <div className="hd micro">{t('agentConsole.v2.aud01.diffTitle')}</div>
        {diff.rows.length > 0 ? (
          <div className="dlist">
            {diff.rows.map((row) => (
              <DiffLine key={`${row.kind}:${row.key}`} row={row} t={t} />
            ))}
          </div>
        ) : (
          <div className="dempty">
            {hasDiff
              ? t('agentConsole.v2.aud01.diffSameOnly')
              : t('agentConsole.v2.aud01.diffEmpty')}
          </div>
        )}
        {diff.sameKeys.length > 0 && diff.rows.length > 0 ? (
          <div className="dempty">{t('agentConsole.v2.aud01.diffSameNote')}</div>
        ) : null}
        {hasDiff ? <div className="card-ft onlyAfter">{t('agentConsole.v2.aud01.diffFootnote')}</div> : null}
        {diff.oversized ? (
          <div className="warnline">
            <LkIcon name="alert" size={13} />
            {t('agentConsole.v2.aud01.diffOversized')}
          </div>
        ) : null}
      </div>

      <div className="col">
        <div className="hd micro">{t('agentConsole.v2.aud01.integrityTitle')}</div>
        <div className="integ">
          <div className="kv">
            <span className="k">{t('agentConsole.v2.aud01.integHashLabel')}</span>
            {event.hash ? (
              <CopyId
                value={event.hash}
                display={shortId(event.hash)}
                ariaLabel={t('agentConsole.v2.aud01.copyHash')}
                copiedLabel={t('agentConsole.v2.aud01.copied')}
              />
            ) : (
              <span className="faint">—</span>
            )}
          </div>
          <div className="kv">
            <span className="k">{t('agentConsole.v2.aud01.integPrevLabel')}</span>
            {event.prevHash ? (
              <CopyId
                value={event.prevHash}
                display={shortId(event.prevHash)}
                ariaLabel={t('agentConsole.v2.aud01.copyPrevHash')}
                copiedLabel={t('agentConsole.v2.aud01.copied')}
              />
            ) : (
              <span className="faint">—</span>
            )}
          </div>
          <div className="integ exp">{t('agentConsole.v2.aud01.noPerEventVerify')}</div>
          {!event.hash ? (
            <div className="integ exp">{t('agentConsole.v2.aud01.noHashNote')}</div>
          ) : null}
          <div className="kv">
            <span className="k">{t('agentConsole.v2.aud01.integSchemaLabel')}</span>
            <span className="mono">{event.schemaVersion || '—'}</span>
          </div>
          {event.error ? (
            <>
              {event.error.code ? (
                <div className="kv">
                  <span className="k">{t('agentConsole.v2.aud01.errorCode')}</span>
                  <span className="mono">{event.error.code}</span>
                </div>
              ) : null}
              {event.error.messageRedacted ? (
                <div className="kv">
                  <span className="k">{t('agentConsole.v2.aud01.errorMessage')}</span>
                  <span className="errtext">{event.error.messageRedacted}</span>
                </div>
              ) : null}
              <div className="integ exp">{t('agentConsole.v2.aud01.errorRedactedNote')}</div>
            </>
          ) : null}
        </div>

        <div className="rel">
          {event.approvalId ? (
            <div className="kv">
              <span className="k">{t('agentConsole.v2.aud01.relApproval')}</span>
              <CopyId
                value={event.approvalId}
                display={shortId(event.approvalId)}
                ariaLabel={t('agentConsole.v2.aud01.copyApproval')}
                copiedLabel={t('agentConsole.v2.aud01.copied')}
              />
              <a className="jump" href={`/agent/approvals/${encodeURIComponent(event.approvalId)}`}>
                {t('agentConsole.v2.aud01.viewApproval')}
                <LkIcon name="chevR" size={13} />
              </a>
            </div>
          ) : null}
          {event.correlationId ? (
            <div className="kv">
              <span className="k">{t('agentConsole.v2.aud01.relCorrelation')}</span>
              <CopyId
                value={event.correlationId}
                display={shortId(event.correlationId)}
                ariaLabel={t('agentConsole.v2.aud01.copyCorrelation')}
                copiedLabel={t('agentConsole.v2.aud01.copied')}
              />
              <span className="hd-note">{t('agentConsole.v2.aud01.relCorrelationNote')}</span>
            </div>
          ) : null}
          {event.policyDecisionId ? (
            <div className="kv">
              <span className="k">{t('agentConsole.v2.aud01.relPolicy')}</span>
              <CopyId
                value={event.policyDecisionId}
                display={shortId(event.policyDecisionId)}
                ariaLabel={t('agentConsole.v2.aud01.copyPolicy')}
                copiedLabel={t('agentConsole.v2.aud01.copied')}
              />
              <span className="hd-note">{t('agentConsole.v2.aud01.relPolicyNote')}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}