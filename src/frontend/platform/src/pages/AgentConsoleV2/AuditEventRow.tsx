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
  employeeResourceIdLabel,
  isPlaceholderIdentity,
} from './identity';
import {
  actionLabelKey,
  actorText,
  CLOCK_SKEW_MS,
  DECISION_KEYS,
  decisionEnum,
  humanRefDisplay,
  idDisplay,
  isEmployeeResource,
  OUTCOME_KEYS,
  outcomeEnum,
  resourceDisplay,
  resourceWord,
  sourceWord,
  wireText,
  actorIcon,
  clockSkewMs,
  decisionTone,
  diffRows,
  formatLatency,
  formatOccurred,
  formatSpan,
  isStructured,
  outcomeTone,
  shortCode,
  type AuditEvent,
  type DiffRow,
} from './aud01';

/* S3: TSK-02 (`/agent/tasks/:taskId`) is live in the route table — the row
 * jump is a real link now; the old disabled placeholder is removed. */

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

  // Wire values are coerced once: upstream may send numbers, uppercase enums
  // or a `{type,id}` object where the contract says string. Nothing below
  // calls a string method on a raw field.
  const sourceSystem = wireText(event.sourceSystem);
  const action = wireText(event.action);
  const actorType = wireText(event.actor?.type);
  const actorId = wireText(event.actor?.id);
  const runId = wireText(event.runId);
  const taskId = wireText(event.taskId);
  const approvalId = wireText(event.approvalId);
  const resourceType = wireText(event.resource?.type);
  const resourceId = wireText(event.resource?.id);
  const employeeResource = isEmployeeResource(resourceType);
  const res = resourceDisplay(resourceType, resourceId, t);
  const behalfRef = refText(event.onBehalfOf);

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
            <span className="l" title={`sourceSystem=${sourceSystem}`}>
              {sourceLabel(t, sourceSystem)}
            </span>
          </span>
        </td>

        <td data-l={t('agentConsole.v2.aud01.colAction')}>
          <span className="cell2">
            {actionLabelKey(action) ? (
              // Known actions read as human words; the contract value stays in
              // the tooltip only (never a visible second line).
              <span className="l" title={action}>
                {t(`agentConsole.v2.aud01.${actionLabelKey(action)}`)}
              </span>
            ) : (
              // Unknown actions are NOT machine-translated: raw value only.
              <span className="l mono" title={action}>
                {action}
              </span>
            )}
          </span>
        </td>

        <td data-l={t('agentConsole.v2.aud01.colActor')}>
          <span
            className="who"
            title={`actor.type=${actorType} · ${actorId}`}
          >
            <span className="ava">
              <LkIcon name={actorIcon(actorType)} size={13} />
            </span>
            {/* S2: readable identity — displayName, 用户 #N, 员工名/员工 · 短码
                or 「系统 · employee-api」; the raw ref stays in the title only. */}
            <span className="nm">{actorText(event.actor, names, t)}</span>
          </span>
        </td>

        <td data-l={t('agentConsole.v2.aud01.colBehalf')}>
          {behalfRef.trim() ? (
            <span className="behalf" title={`onBehalfOf: ${behalfRef}`}>
              → {isPlaceholderIdentity(behalfRef)
                ? t('agentConsole.v2.id.unknown')
                : humanRefDisplay(behalfRef, t)}
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
          {runId ? (
            <span className="idcell">
              {/* R1 (VG-B1): 「运行 · 短码」 — the raw rn_/ws_ id stays in title. */}
              <CopyId
                value={runId}
                display={idDisplay(runId, t)}
                ariaLabel={t('agentConsole.v2.aud01.copyRun')}
                copiedLabel={t('agentConsole.v2.aud01.copied')}
                href={`/agent/runs/${encodeURIComponent(runId)}`}
                linkLabel={t('agentConsole.v2.aud01.viewRunTitle', { id: runId })}
                testId={`aud01-run-link-${event.eventId}`}
              />
            </span>
          ) : (
            <span className="faint mono">—</span>
          )}
        </td>

        <td className="mono" data-l={t('agentConsole.v2.aud01.colTask')}>
          {taskId ? (
            <span className="idcell">
              <CopyId
                value={taskId}
                display={idDisplay(taskId, t)}
                ariaLabel={t('agentConsole.v2.aud01.copyTask')}
                copiedLabel={t('agentConsole.v2.aud01.copied')}
              />
              {/* S3: real navigation to TSK-02 (same anchor idiom as the
                  employee jump; copy stays independent of the link). */}
              <a
                className="jump"
                href={`/agent/tasks/${encodeURIComponent(taskId)}`}
                data-testid={`aud01-task-jump-${event.eventId}`}
              >
                {t('agentConsole.v2.aud01.viewTask')}
                <LkIcon name="chevR" size={13} />
              </a>
            </span>
          ) : (
            <span className="faint mono">—</span>
          )}
        </td>

        <td data-l={t('agentConsole.v2.aud01.colApproval')}>
          {approvalId ? (
            <span className="idcell">
              <CopyId
                value={approvalId}
                display={idDisplay(approvalId, t)}
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
            title={[
              resourceType ? `${wireText(resourceType)}${resourceId ? `: ${wireText(resourceId)}` : ''}` : null,
              event.resource?.ownerRef ? `ownerRef: ${wireText(event.resource.ownerRef)}` : null,
              event.resource?.scopeRef ? `scopeRef: ${wireText(event.resource.scopeRef)}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || undefined}
          >
            {/* R1 (VG-B1/B4): 「类型 · 短码」 (员工 keeps its name / 员工 · 短码).
                An unreadable resource is omitted entirely; the raw type and id
                stay in the cell title above. */}
            {employeeResource ? (
              <>
                <span className="rt">{resourceWord(resourceType, t)}</span>
                <CopyId
                  value={resourceId}
                  display={employeeResourceIdLabel(resourceId, names, t)}
                  ariaLabel={t('agentConsole.v2.aud01.copyResource')}
                  copiedLabel={t('agentConsole.v2.aud01.copied')}
                />
                <a
                  className="jump"
                  href={`/agent/employees/${encodeURIComponent(resourceId)}`}
                  data-testid={`aud01-employee-link-${event.eventId}`}
                >
                  {t('agentConsole.v2.aud01.viewEmployee')}
                  <LkIcon name="chevR" size={13} />
                </a>
              </>
            ) : (
              <>
                {res.value ? null : res.typeWord ? <span className="rt">{res.typeWord}</span> : null}
                <CopyId
                  value={resourceId}
                  display={res.value ?? ''}
                  ariaLabel={t('agentConsole.v2.aud01.copyResource')}
                  copiedLabel={t('agentConsole.v2.aud01.copied')}
                />
              </>
            )}
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
            {/* R1 (NV): a row-level, always-visible way into the detail page —
                navigation only, the inline expansion stays as it was. */}
            <a
              className="opb detail"
              href={`/agent/audit/${encodeURIComponent(event.eventId)}`}
              aria-label={t('agentConsole.v2.aud01.openDetail')}
              title={t('agentConsole.v2.aud01.openDetail')}
              data-testid={`aud01-detail-${event.eventId}`}
            >
              {t('agentConsole.v2.aud01.detailShort')}
            </a>
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
  // Unlisted enums render verbatim — never invented, never guessed.
  return sourceWord(source, t);
}

/** Wire id that may arrive as a `{type,id}` object (the human ref shape). */
function refText(value: unknown): string {
  if (value && typeof value === 'object') {
    return wireText((value as { id?: unknown }).id);
  }
  return wireText(value);
}

function DecisionCell({ decision, t }: { decision?: string; t: TFunction }) {
  if (decision === undefined || wireText(decision).trim() === '') {
    // Key absent = the event carries no decision field (NOT not_applicable).
    return (
      <span className="faint" title={t('agentConsole.v2.aud01.decisionAbsentTitle')}>
        —
      </span>
    );
  }
  const value = decisionEnum(decision);
  if (value === 'not_applicable') {
    return (
      <span className="faint" title={t('agentConsole.v2.aud01.decisionNaTitle')}>
        —
      </span>
    );
  }
  const key = DECISION_KEYS[value];
  if (key === undefined) {
    // Unlisted enum: the raw token is the honest reading (no invented word).
    return <span className="mono">{wireText(decision)}</span>;
  }
  const titleKey =
    value === 'require_approval'
      ? 'decisionRequireApprovalTitle'
      : value === 'approved'
        ? 'decisionApprovedTitle'
        : value === 'deny'
          ? 'decisionDenyTitle'
          : undefined;
  return (
    <span className={`pill ${decisionTone(value)}`} title={titleKey ? t(`agentConsole.v2.aud01.${titleKey}`) : undefined}>
      <span className="dot" aria-hidden="true" />
      {t(`agentConsole.v2.aud01.${key}`)}
    </span>
  );
}

function OutcomeCell({ outcome, t }: { outcome: string; t: TFunction }) {
  const value = outcomeEnum(outcome);
  const key = OUTCOME_KEYS[value];
  if (key === undefined) {
    return <span className="mono">{wireText(outcome)}</span>;
  }
  return (
    <span className={`pill ${outcomeTone(value)}`}>
      <span className="dot" aria-hidden="true" />
      {t(`agentConsole.v2.aud01.${key}`)}
    </span>
  );
}


/** `⋯` row menu: copy the event id, or open the AUD-02 detail page. */
function RowMenu({ eventId, t }: { eventId: string; t: TFunction }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  /* R1 (NV): the popover used to be `position: absolute` inside the table, so
     the wrapper's `overflow-x: auto` (1280–1399) clipped it and the row looked
     like a dead control. It is now `position: fixed`, anchored to the button by
     measurement — the table (and any sticky header) can no longer crop it. */
  const openMenu = () => {
    const rect = btnRef.current?.getBoundingClientRect?.() ?? null;
    const width = 160;
    const viewport = typeof window !== 'undefined' ? window.innerWidth || 0 : 0;
    const right = rect ? rect.right : 0;
    const rawLeft = right - width;
    const maxLeft = viewport > 0 ? viewport - width - 8 : rawLeft;
    setPos({
      top: (rect ? rect.bottom : 0) + 4,
      left: Math.max(8, Math.min(rawLeft, maxLeft)),
    });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (ev: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(ev.target as Node)) setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(false);
    };
    const onDismiss = () => setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    /* A fixed popover does not follow the row on scroll/resize; dismiss it
       instead of leaving it floating over unrelated rows. */
    window.addEventListener('scroll', onDismiss, true);
    window.addEventListener('resize', onDismiss);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onDismiss, true);
      window.removeEventListener('resize', onDismiss);
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
        ref={btnRef}
        type="button"
        className="opb"
        aria-label={t('agentConsole.v2.aud01.moreActions')}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={`aud01-more-${eventId}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <LkIcon name="more" size={14} />
      </button>
      {open ? (
        <span
          className="opmenu float"
          role="menu"
          style={pos ? { top: pos.top, left: pos.left } : undefined}
        >
          <button type="button" role="menuitem" onClick={copy} data-testid={`aud01-copy-event-${eventId}`}>
            {t('agentConsole.v2.aud01.copyEventId')}
          </button>
          {/* AUD-02 is live: the detail is a real link now (S3's "not built
              yet" reason is gone, same as the task jump). */}
          <a
            role="menuitem"
            className="opmenu-a"
            href={`/agent/audit/${encodeURIComponent(eventId)}`}
            data-testid={`aud01-open-detail-${eventId}`}
          >
            {t('agentConsole.v2.aud01.openDetail')}
          </a>
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
  const hash = wireText(event.hash);
  const prevHash = wireText(event.prevHash);
  const approvalRef = wireText(event.approvalId);
  const correlationRef = wireText(event.correlationId);
  const policyRef = wireText(event.policyDecisionId);
  const errorCode = wireText(event.error?.code);
  const errorMessage = wireText(event.error?.messageRedacted);

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
            {hash ? (
              <CopyId
                value={hash}
                display={shortCode(hash)}
                ariaLabel={t('agentConsole.v2.aud01.copyHash')}
                copiedLabel={t('agentConsole.v2.aud01.copied')}
              />
            ) : (
              <span className="faint">—</span>
            )}
          </div>
          <div className="kv">
            <span className="k">{t('agentConsole.v2.aud01.integPrevLabel')}</span>
            {prevHash ? (
              <CopyId
                value={prevHash}
                display={shortCode(prevHash)}
                ariaLabel={t('agentConsole.v2.aud01.copyPrevHash')}
                copiedLabel={t('agentConsole.v2.aud01.copied')}
              />
            ) : (
              <span className="faint">—</span>
            )}
          </div>
          <div className="integ exp">{t('agentConsole.v2.aud01.noPerEventVerify')}</div>
          {!hash ? (
            <div className="integ exp">{t('agentConsole.v2.aud01.noHashNote')}</div>
          ) : null}
          <div className="kv">
            <span className="k">{t('agentConsole.v2.aud01.integSchemaLabel')}</span>
            <span className="mono">{wireText(event.schemaVersion) || '—'}</span>
          </div>
          {event.error ? (
            <>
              {errorCode ? (
                <div className="kv">
                  <span className="k">{t('agentConsole.v2.aud01.errorCode')}</span>
                  <span className="mono">{errorCode}</span>
                </div>
              ) : null}
              {errorMessage ? (
                <div className="kv">
                  <span className="k">{t('agentConsole.v2.aud01.errorMessage')}</span>
                  <span className="errtext">{errorMessage}</span>
                </div>
              ) : null}
              <div className="integ exp">{t('agentConsole.v2.aud01.errorRedactedNote')}</div>
            </>
          ) : null}
        </div>

        <div className="rel">
          {approvalRef ? (
            <div className="kv">
              <span className="k">{t('agentConsole.v2.aud01.relApproval')}</span>
              <CopyId
                value={approvalRef}
                display={shortCode(approvalRef)}
                ariaLabel={t('agentConsole.v2.aud01.copyApproval')}
                copiedLabel={t('agentConsole.v2.aud01.copied')}
              />
              <a className="jump" href={`/agent/approvals/${encodeURIComponent(approvalRef)}`}>
                {t('agentConsole.v2.aud01.viewApproval')}
                <LkIcon name="chevR" size={13} />
              </a>
            </div>
          ) : null}
          {correlationRef ? (
            <div className="kv">
              <span className="k">{t('agentConsole.v2.aud01.relCorrelation')}</span>
              <CopyId
                value={correlationRef}
                display={shortCode(correlationRef)}
                ariaLabel={t('agentConsole.v2.aud01.copyCorrelation')}
                copiedLabel={t('agentConsole.v2.aud01.copied')}
              />
              <span className="hd-note">{t('agentConsole.v2.aud01.relCorrelationNote')}</span>
            </div>
          ) : null}
          {policyRef ? (
            <div className="kv">
              <span className="k">{t('agentConsole.v2.aud01.relPolicy')}</span>
              <CopyId
                value={policyRef}
                display={shortCode(policyRef)}
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