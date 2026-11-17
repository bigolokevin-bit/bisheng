/**
 * AUD-02 `/agent/audit/:eventId` — read-only audit event detail, built against
 * the locked C1 baseline aud02-target.html + AUD02-TARGET-SPEC.md.
 *
 * Section order is fixed and never re-ordered by "importance" (§9 E01):
 *   01 头 → 02 判定 → 03 变更 → 04 关联 → 05 完整性 (with the shared A7 panel
 *   mounted inside it) → [06 错误, only when the event carries one] → footnote.
 * The footnote deliberately carries NO section number (§10 偏差 5).
 *
 * Hard rules carried by this file:
 * - ZERO write entries. Not a disabled shell — the controls simply do not
 *   exist: no export, download, edit, delete, backfill, replay, "apply the
 *   previous version", "verify this row". The banner explains why (§1.3).
 * - Absence is absence (§2.3): a missing optional key drops its row, its cell,
 *   its section or its chain segment. The 判定 card prints no `—` at all: an
 *   absent / not_applicable decision shows an empty value block and an
 *   unreadable time says 「未记录」, with the note saying which case it is.
 * - Unknown stays neutral: 「未知（本次未能读取）」 never looks like an error and
 *   never looks like a pass. Green impossible by accident — the only colour
 *   gate lives in the shared verify panel (aud01.classifyVerify).
 * - No polling: a single event is immutable. Only 「重新读取」 and a return to
 *   the foreground re-read it (§7).
 * - 403 and 404 share one body; only the status code differs, so the page never
 *   answers "does this event exist".
 * - Every upstream string is rendered as text (React children only), ids are
 *   truncated for display while title/copy keep the full value, and identities
 *   go through identity.ts so no bare `emp_…` / `human:…` token is printed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';

import type { AgentConsoleApi, EmployeeSummary } from '@/controllers/API/agent';

import { AuditVerifyPanel } from './AuditVerifyPanel';
import { HelpTip } from './HelpTip';
import { useConsoleCrumbTail } from './Shell';
import { CopyId, LkIcon, ReqId } from './listkit';
import {
  actorIcon,
  actorText,
  decisionEnum,
  diffRows,
  isEmployeeResource,
  resourceDisplay,
  resourceWord,
  shortCode,
  shortId,
  typeShortLabel,
  wireText,
  type DiffRow,
} from './aud01';
import {
  REF_COPY_KEYS,
  REF_LABEL_KEYS,
  REF_ORDER,
  REF_VIEW_KEYS,
  actionText,
  arrivalGap,
  chainModeOf,
  createHttpAuditDetailApi,
  decisionLabel,
  diffJsonText,
  diffSides,
  employeeText,
  eventClock,
  hasSkew,
  hasValue,
  humanText,
  isNeutralPlaceholder,
  outcomeLabel,
  readStampClock,
  reasonText,
  refShort,
  relatedRefs,
  responsibilityOf,
  schemaLabel,
  shortPath,
  sourceText,
  type AuditDetailApi,
  type AuditEventDetail,
  type RefKey,
} from './aud02';
import { avatarChar } from './identity';
import { FETCH_TIMEOUT_MS } from './v2Data';
/* The mounted chain panel's own vocabulary (chain01 / cv / blist …) is scoped
 * `.lk.aud01` inside aud01.css; importing it here keeps the panel styled even
 * if this page is ever split out of the shared shell chunk. Vite dedupes. */
import './aud01.css';
import './aud02.css';

const EMPLOYEES_LIMIT = 100;

export interface AuditDetailPageProps {
  /** A4 + A7 adapter (injectable in tests; HTTP default in the app). */
  api?: AuditDetailApi;
  /** E11 candidates for readable employee names (degrades to 「员工 · 短码」). */
  consoleApi?: Pick<AgentConsoleApi, 'listEmployees'>;
  /** Route param override (the shell remounts per event id). */
  eventIdOverride?: string;
}

type Head =
  | { kind: 'loading' }
  | { kind: 'ready'; event: AuditEventDetail; readAt: string }
  | { kind: 'error'; status: number; requestId?: string }
  | { kind: 'forbidden'; status: number; requestId?: string };

export function AuditDetailPage({ api, consoleApi, eventIdOverride }: AuditDetailPageProps) {
  const { t } = useTranslation();
  const params = useParams();
  const eventId = eventIdOverride ?? params.eventId ?? '';
  const detailApi = useMemo(() => api ?? createHttpAuditDetailApi(), [api]);
  useConsoleCrumbTail(t('agentConsole.v2.aud02.crumb'));

  const [head, setHead] = useState<Head>(() =>
    eventId ? { kind: 'loading' } : { kind: 'error', status: 400 },
  );
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [reloadToken, setReloadToken] = useState(0);
  const [linkCopied, setLinkCopied] = useState(false);
  const linkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (linkTimer.current) clearTimeout(linkTimer.current);
    },
    [],
  );

  /* ---------- E11 employee names (cosmetic; failure degrades to a short code) ---------- */
  useEffect(() => {
    if (!consoleApi) return undefined;
    let live = true;
    consoleApi
      .listEmployees({ limit: EMPLOYEES_LIMIT })
      .then((res) => {
        if (!live || !res || !Array.isArray(res.items)) return;
        const map = new Map<string, string>();
        for (const e of res.items as EmployeeSummary[]) {
          if (e.employeeId && e.name) map.set(e.employeeId, e.name);
        }
        setNames(map);
      })
      .catch(() => {
        /* names degrade to 「员工 · 短码」 — never a fabricated name */
      });
    return () => {
      live = false;
    };
  }, [consoleApi]);

  /* ---------- A4 head (first load + 「重新读取」) ---------- */
  useEffect(() => {
    if (!eventId) return undefined;
    let live = true;
    setHead((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    /* 10s cap: a hung read flips the skeleton to the honest error screen; a
     * late answer still lands if one arrives after the cap. */
    const watchdog = window.setTimeout(() => {
      if (live) setHead((prev) => (prev.kind === 'loading' ? { kind: 'error', status: 0 } : prev));
    }, FETCH_TIMEOUT_MS);

    detailApi
      .getEvent(eventId)
      .then((res) => {
        window.clearTimeout(watchdog);
        if (!live) return;
        setBusy(false);
        if (res.ok && res.data) {
          setHead({ kind: 'ready', event: res.data, readAt: new Date().toISOString() });
          return;
        }
        if (res.status === 401) {
          /* 401 belongs to the route guard — never an in-page state (§7). */
          window.location.assign('/');
          return;
        }
        if (res.status === 403 || res.status === 404) {
          setHead({ kind: 'forbidden', status: res.status, requestId: res.requestId });
          return;
        }
        setHead({ kind: 'error', status: res.status, requestId: res.requestId });
      })
      .catch(() => {
        window.clearTimeout(watchdog);
        if (!live) return;
        setBusy(false);
        setHead({ kind: 'error', status: 0 });
      });

    return () => {
      live = false;
      window.clearTimeout(watchdog);
    };
  }, [detailApi, eventId, reloadToken]);

  const refresh = useCallback(() => {
    setBusy(true);
    setReloadToken((n) => n + 1);
  }, []);

  const copyLink = useCallback(() => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    try {
      void navigator.clipboard?.writeText(url);
    } catch {
      /* clipboard unavailable: the address stays in the browser bar */
    }
    setLinkCopied(true);
    if (linkTimer.current) clearTimeout(linkTimer.current);
    linkTimer.current = setTimeout(() => setLinkCopied(false), 1200);
  }, []);

  /* No polling: one re-read when the page returns after >5 minutes away. */
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
        refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [refresh]);

  /* ---------- page shell (meta row + banner stay outside every state) ---------- */

  const meta = (
    <div className="fresh" data-testid="aud02-fresh">
      <LkIcon name="clock" size={13} />
      <span>
        {t('agentConsole.v2.aud02.freshReadAt')}{' '}
        <span className="mono" data-testid="aud02-read-at">
          {head.kind === 'ready' ? readStampClock(head.readAt) : '—'}
        </span>
      </span>
      <span className="faint">·</span>
      <span>
        {t('agentConsole.v2.aud01.freshSource')}{' '}
        {t('agentConsole.v2.aud02.freshSourceValue')}
      </span>
      <span className="faint">·</span>
      <span>{t('agentConsole.v2.aud02.freshNoPolling')}</span>
    </div>
  );

  const banner = (
    <div
      className="roband"
      role="note"
      aria-label={t('agentConsole.v2.aud02.bannerAria')}
      data-testid="aud02-readonly-banner"
    >
      <LkIcon name="lock" size={14} />
      <span>
        <b>{t('agentConsole.v2.aud02.bannerLead')}</b>
        {t('agentConsole.v2.aud02.bannerBody')}
      </span>
      <HelpTip term="aud02Readonly" testId="aud02-help-readonly" />
      <div className="sp" />
      <span className="mono">{t('agentConsole.v2.aud02.bannerMono')}</span>
    </div>
  );

  const shell = (body: React.ReactNode) => (
    <div className="a2s-page">
      <div className="lk aud02" data-testid="agent-v2-page-audit-detail">
        {meta}
        {banner}
        {body}
        <PageFoot t={t} />
      </div>
    </div>
  );

  if (head.kind === 'loading') {
    return shell(<DetailSkeleton t={t} />);
  }

  if (head.kind === 'forbidden') {
    /* R1 (D1/D2): 403 and 404 answer the same envelope upstream, but they are
     * different facts. The copy now says which: 404 = this event does not exist
     * or has passed retention, 403 = no view permission. The screen, actions and
     * test ids stay shared, and the status code lives in title/aria only. */
    const notFound = head.status === 404;
    return shell(
      <div className="flow">
        <div
          className="card stage"
          data-testid="aud02-forbidden"
          title={`HTTP ${head.status}`}
        >
          <span className="ic">
            {notFound ? <LkIcon name="info" size={20} /> : <LkIcon name="lock" size={20} />}
          </span>
          <div className="t">
            {t(
              notFound
                ? 'agentConsole.v2.aud02.notFoundTitle'
                : 'agentConsole.v2.aud02.forbiddenTitle',
            )}
          </div>
          <div className="s">
            {t(
              notFound
                ? 'agentConsole.v2.aud02.notFoundDesc'
                : 'agentConsole.v2.aud02.forbiddenDesc',
            )}
          </div>
          <span
            className="sr-only"
            data-testid="aud02-status-code"
            aria-label={`HTTP ${head.status}`}
          />
          <div className="acts2">
            <button
              type="button"
              className="b out"
              data-testid="aud02-forbidden-retry"
              aria-busy={busy}
              disabled={busy}
              onClick={refresh}
            >
              <LkIcon name="refresh" size={16} />
              {t(
                notFound
                  ? 'agentConsole.v2.aud02.notFoundRetry'
                  : 'agentConsole.v2.aud02.forbiddenRetry',
              )}
            </button>
            <Link className="lnk" to="/agent/audit" data-testid="aud02-forbidden-back">
              {t('agentConsole.v2.aud02.backFirst')}
            </Link>
          </div>
          <ReqId requestId={head.requestId} testId="aud02-forbidden-reqid" />
        </div>
      </div>,
    );
  }

  if (head.kind === 'error') {
    const is400 = head.status === 400;
    return shell(
      <div className="flow">
        <div
          className="card stage"
          data-testid="aud02-error"
          title={head.status > 0 ? `HTTP ${head.status}` : undefined}
        >
          <span className="ic">{is400 ? <LkIcon name="info" size={20} /> : <LkIcon name="alert" size={20} />}</span>
          <div className="t">
            {t(
              is400 ? 'agentConsole.v2.aud02.error400Title' : 'agentConsole.v2.aud02.errorTitle',
            )}
          </div>
          <div className="s">
            {is400
              ? t('agentConsole.v2.aud02.error400Desc')
              : t('agentConsole.v2.aud02.errorDesc')}
          </div>
          <span
            className="sr-only"
            data-testid="aud02-status-code"
            aria-label={
              head.status > 0 ? `HTTP ${head.status}` : t('agentConsole.v2.aud02.errorNetworkCode')
            }
          />
          {/* The error facts live in one line: request id + retry. The HTTP code
              stays in title/aria (R1 / D2) — it is a diagnostic value, not copy.
              Support gets a copyable request id instead. */}
          <div
            className="errbar"
            data-testid="aud02-error-bar"
            title={head.status > 0 ? `HTTP ${head.status}` : t('agentConsole.v2.aud02.errorNetworkCode')}
          >
            <LkIcon name="alert" size={14} />
            <div className="bx">
              <ReqId requestId={head.requestId} testId="aud02-error-reqid" />
              <div className="k">{t('agentConsole.v2.aud02.reqIdNote')}</div>
            </div>
            {is400 ? null : (
              <button
                type="button"
                className="b sm out"
                data-testid="aud02-error-retry"
                aria-busy={busy}
                disabled={busy}
                onClick={refresh}
              >
                <LkIcon name="refresh" size={16} />
                {t('agentConsole.v2.aud02.retry')}
              </button>
            )}
          </div>
          <div className="acts2">
            <Link className="lnk" to="/agent/audit" data-testid="aud02-error-back">
              {t('agentConsole.v2.aud02.backFirst')}
            </Link>
          </div>
        </div>
      </div>,
    );
  }

  /* ---------- ready ---------- */

  const event = head.event;
  return shell(
    <div className="flow" data-testid="aud02-detail">
      <BackRow t={t} />
      <Head01
        t={t}
        event={event}
        busy={busy}
        linkCopied={linkCopied}
        onReload={refresh}
        onCopyLink={copyLink}
      />
      <JudgeCard t={t} event={event} names={names} />
      <ChangeCard t={t} event={event} />
      <RefsCard t={t} event={event} />
      <IntegrityCard t={t} event={event} api={detailApi} />
      {hasValue(event.error?.code) || hasValue(event.error?.messageRedacted) ? (
        <ErrorCard t={t} event={event} />
      ) : null}
      <div className="footline" data-testid="aud02-footline">
        <LkIcon name="lock" size={14} />
        <span>
          <b>{t('agentConsole.v2.aud02.footLine')}</b>
        </span>
        <span className="sp" />
        <span className="hd-note">{t('agentConsole.v2.aud02.footLineNote')}</span>
      </div>
    </div>,
  );
}

// ------------------------------------------------------------------ 01 头

function BackRow({ t }: { t: TFunction }) {
  return (
    <div className="backrow">
      <Link
        className="b gh sm"
        to="/agent/audit"
        aria-label={t('agentConsole.v2.aud02.backToList')}
        data-testid="aud02-back"
      >
        <LkIcon name="chevL" size={14} />
        {t('agentConsole.v2.aud02.backToList')}
      </Link>
      <span className="hd-note">{t('agentConsole.v2.aud02.backNote')}</span>
    </div>
  );
}

function Head01({
  t,
  event,
  busy,
  linkCopied,
  onReload,
  onCopyLink,
}: {
  t: TFunction;
  event: AuditEventDetail;
  busy: boolean;
  linkCopied: boolean;
  onReload: () => void;
  onCopyLink: () => void;
}) {
  const outcome = outcomeLabel(event.outcome, t);
  const actionName = actionText(event.action, t);
  const schema = schemaLabel(event.schemaVersion);
  const outcomeRaw = wireText(event.outcome);
  const actionRaw = wireText(event.action);
  const eventId = wireText(event.eventId);

  return (
    <div className="phead">
      <div style={{ minWidth: 0 }}>
        <div className="zline">
          <span className="zno" aria-hidden="true">
            01
          </span>
          <span className="micro">{t('agentConsole.v2.aud02.zoneHead')}</span>
        </div>
        <h1 className="h1" data-testid="aud02-h1">
          {outcome ? (
            <span className={`pill ${outcome.tone}`}>
              <span className="dot" aria-hidden="true" />
              {outcome.text}
            </span>
          ) : (
            <span className="mono">{outcomeRaw}</span>
          )}
          <span className="tx">{actionName ?? <span className="mono">{actionRaw}</span>}</span>
        </h1>
        <div className="idline">
          <span className="micro">{t('agentConsole.v2.aud02.eventIdLabel')}</span>
          <CopyId
            value={eventId}
            display={typeShortLabel(eventId, t) ?? refShort(eventId)}
            ariaLabel={t('agentConsole.v2.aud01.copyEventId')}
            copiedLabel={t('agentConsole.v2.aud01.copied')}
            testId="aud02-event-id"
          />
          <HelpTip term="eventIdKey" testId="aud02-help-eid" />
          {schema ? (
            <span className="c">{t('agentConsole.v2.aud02.schemaChip', { v: schema })}</span>
          ) : null}
        </div>
      </div>
      <div className="sp" />
      <div className="acts">
        <button
          type="button"
          className="b gh"
          title={t('agentConsole.v2.aud02.reloadTitle')}
          aria-busy={busy}
          disabled={busy}
          onClick={onReload}
          data-testid="aud02-reload"
        >
          <LkIcon name="refresh" size={16} />
          {t('agentConsole.v2.aud02.reload')}
        </button>
        <button
          type="button"
          className="b out"
          title={t('agentConsole.v2.aud02.copyLinkTitle')}
          onClick={onCopyLink}
          data-testid="aud02-copy-link"
        >
          <LkIcon name="link" size={16} />
          {linkCopied ? t('agentConsole.v2.aud02.copiedLink') : t('agentConsole.v2.aud02.copyLink')}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 02 判定

function JudgeCard({
  t,
  event,
  names,
}: {
  t: TFunction;
  event: AuditEventDetail;
  names: Map<string, string>;
}) {
  const occurred = eventClock(event.occurredAt);
  const recorded = eventClock(event.recordedAt);
  const gap = arrivalGap(event);
  const skew = hasSkew(event);
  const decision = hasValue(event.decision) ? decisionLabel(wireText(event.decision), t) : null;
  const outcome = outcomeLabel(event.outcome, t);
  const resp = responsibilityOf(event);
  const actorName = actorLabelOf(event.actor, names, t);
  const decisionRaw = wireText(event.decision);
  const outcomeRaw = wireText(event.outcome);
  const resourceType = wireText(event.resource?.type);
  const resourceId = wireText(event.resource?.id);
  const employeeResource = isEmployeeResource(resourceType);
  const ownerRef = wireText(event.resource?.ownerRef);
  const scopeRef = wireText(event.resource?.scopeRef);
  const res = resourceDisplay(resourceType, resourceId, t);
  const onBehalf = (event as unknown as Record<string, unknown>).onBehalfOf;
  const onBehalfRef = typeof onBehalf === 'string' ? onBehalf : '';

  return (
    <div className="card" data-testid="aud02-card-judge">
      <div className="card-hd">
        <span className="zno" aria-hidden="true">
          02
        </span>
        <span className="t">{t('agentConsole.v2.aud02.cardDecision')}</span>
        <span className="c">{t('agentConsole.v2.aud02.chipReadonly')}</span>
        <span className="sp" />
        <span className="hd-note">{t('agentConsole.v2.aud02.cardDecisionNote')}</span>
      </div>

      <div className="hfs">
        {/* 1 发生时间 */}
        <div className="hf" data-testid="aud02-f-occurred">
          <div className="l micro">
            {t('agentConsole.v2.aud02.fOccurred')}
            <HelpTip term="clockSkew" testId="aud02-help-time" />
          </div>
          <div className="v" title={event.occurredAt}>
            {occurred ? (
              <>
                {occurred.clock}
                <span className="u">{occurred.ms}</span>
              </>
            ) : (
              /* D4: the card's own rule is 「不画 —」, so an unreadable time
                 says 「未记录」 instead of a dash. The raw value stays in title. */
              <span className="faint" data-testid="aud02-occurred-missing">
                {t('agentConsole.v2.aud02.timeMissing')}
              </span>
            )}
          </div>
          {occurred ? (
            <div className="n">
              {t('agentConsole.v2.aud02.occurredNote', {
                bj: occurred.beijing,
                utc: occurred.utc,
              })}
            </div>
          ) : null}
        </div>

        {/* 2 落库时间 */}
        <div className="hf" data-testid="aud02-f-recorded">
          <div className="l micro">{t('agentConsole.v2.aud02.fRecorded')}</div>
          <div className="v" title={event.recordedAt}>
            {recorded ? (
              <>
                {recorded.clock}
                <span className="u">{recorded.ms}</span>
              </>
            ) : (
              <span className="faint" data-testid="aud02-recorded-missing">
                {t('agentConsole.v2.aud02.timeMissing')}
              </span>
            )}
          </div>
          <div className={skew ? 'n skew' : 'n'} data-testid="aud02-gap">
            {skew ? (
              <>
                <LkIcon name="clockAlert" size={13} />
                <span className="skeww">{t('agentConsole.v2.aud02.clockSkewWord')}</span>
              </>
            ) : null}
            <span>
              {gap === null
                ? null
                : skew
                  ? t('agentConsole.v2.aud02.recordedSkewNote', { delta: gap })
                  : t('agentConsole.v2.aud02.recordedNote', { delta: gap })}
            </span>
          </div>
        </div>

        {/* 3 来源 */}
        <div className="hf" data-testid="aud02-f-source">
          <div className="l micro">{t('agentConsole.v2.aud02.fSource')}</div>
          <div className="v t">{sourceText(event.sourceSystem, t)}</div>
          <div className="n">{t('agentConsole.v2.aud02.sourceNote', { raw: event.sourceSystem })}</div>
        </div>

        {/* 4 租户 */}
        <div className="hf" data-testid="aud02-f-tenant">
          <div className="l micro">
            {t('agentConsole.v2.aud02.fTenant')}
            <HelpTip term="tenantFull" testId="aud02-help-tenant" />
          </div>
          <div className="v" data-testid="aud02-tenant" title={event.tenantId}>
            {event.tenantId}
          </div>
          <div className="n">{t('agentConsole.v2.aud02.tenantNote')}</div>
        </div>

        {/* 5 判定 */}
        <div className="hf" data-testid="aud02-f-decision">
          <div className="l micro">
            {t('agentConsole.v2.aud02.fDecision')}
            <HelpTip term="decisionPair" testId="aud02-help-decision" />
          </div>
          <div className="v">
            {decision ? (
              <span className={`pill ${decision.tone}`}>
                <span className="dot" aria-hidden="true" />
                {decision.text}
              </span>
            ) : (
              /* R1 (D4): this card's own rule is 「缺省不画 —」, so an absent /
                 not_applicable decision draws nothing; the note below says
                 which of the two it is. */
              <span
                className="faint"
                data-testid="aud02-decision-absent"
                title={
                  hasValue(event.decision)
                    ? t('agentConsole.v2.aud02.decisionNaNote')
                    : t('agentConsole.v2.aud02.decisionAbsentNote')
                }
              />
            )}
          </div>
          <div className="n">
            {!hasValue(event.decision)
              ? t('agentConsole.v2.aud02.decisionAbsentNote')
              : decisionEnum(decisionRaw) === 'not_applicable'
                ? t('agentConsole.v2.aud02.decisionNaNote')
                : decisionEnum(decisionRaw)
                  ? null
                  : t('agentConsole.v2.aud02.decisionNote', { raw: decisionRaw })}
          </div>
        </div>

        {/* 6 结果 */}
        <div className="hf" data-testid="aud02-f-outcome">
          <div className="l micro">{t('agentConsole.v2.aud02.fOutcome')}</div>
          <div className="v">
            {outcome ? (
              <span className={`pill ${outcome.tone}`}>
                <span className="dot" aria-hidden="true" />
                {outcome.text}
              </span>
            ) : (
              <span className="mono">{outcomeRaw}</span>
            )}
          </div>
          <div className="n">{t('agentConsole.v2.aud02.outcomeNote', { raw: outcomeRaw })}</div>
        </div>

        {/* 7 主体（代谁 as a sub-line; the row is absent when there is none） */}
        <div className="hf" data-testid="aud02-f-actor">
          <div className="l micro">{t('agentConsole.v2.aud02.fActor')}</div>
          <div className="v t">
            <span className="who">
              <span className="ava">
                {avatarChar(actorName) ? (
                  <span>{avatarChar(actorName)}</span>
                ) : (
                  <LkIcon name={actorIcon(event.actor.type)} size={13} />
                )}
              </span>
              <span className="nm">{actorName}</span>
            </span>
            <CopyButton
              value={wireText(event.actor?.id)}
              label={t('agentConsole.v2.aud02.copyActor')}
              testId="aud02-copy-actor"
            />
          </div>
          {hasValue(onBehalfRef) ? (
            <div className="sub2" data-testid="aud02-behalf">
              <span className="k">{t('agentConsole.v2.aud02.behalfLabel')}</span>
              <span>→ {humanText(onBehalfRef, t)}</span>
            </div>
          ) : null}
          <div className="n">{t('agentConsole.v2.aud02.behalfNote')}</div>
        </div>

        {/* 8 责任（four states: A / B / C / X） */}
        <div className="hf" data-testid="aud02-f-responsible">
          <div className="l micro">
            {t('agentConsole.v2.aud02.fResponsible')}
            <HelpTip term="responsible" testId="aud02-help-resp" />
          </div>
          {resp === 'a' || resp === 'c' ? (
            <>
              <div className="v t" data-testid="aud02-responsible-name">
                {isNeutralPlaceholder(event.responsibleHumanId) ? (
                  /* R1 (D3): a seed value like `pilot_owner_placeholder` is not
                     a person. Read it as 「未指派」; the raw value stays in title. */
                  <span className="pill nt" title={wireText(event.responsibleHumanId)}>
                    <span className="dot" aria-hidden="true" />
                    {t('agentConsole.v2.aud02.responsiblePlaceholder')}
                  </span>
                ) : (
                  <span title={wireText(event.responsibleHumanId)}>
                    {humanText(event.responsibleHumanId, t)}
                  </span>
                )}
              </div>
              {resp === 'c' ? (
                <div className="sub2">
                  <span className="k">{t('agentConsole.v2.aud02.responsibleBothLabel')}</span>
                  <span>{reasonText(String(event.responsibleUnresolvedReason), t)}</span>
                </div>
              ) : null}
              <div className="n">
                {resp === 'c'
                  ? t('agentConsole.v2.aud02.responsibleBothNote')
                  : t('agentConsole.v2.aud02.responsibleSnapshot')}
              </div>
            </>
          ) : resp === 'b' ? (
            <>
              <div className="v t">
                <span className="pill nt">
                  <span className="dot" aria-hidden="true" />
                  {t('agentConsole.v2.aud02.responsibleUnassigned')}
                </span>
                <span className="uname" data-testid="aud02-responsible-reason">
                  {reasonText(String(event.responsibleUnresolvedReason), t)}
                </span>
              </div>
              <div className="n">{t('agentConsole.v2.aud02.reasonNote')}</div>
            </>
          ) : (
            <>
              <div className="v t">
                <span className="pill wr" data-testid="aud02-responsible-missing">
                  <span className="dot" aria-hidden="true" />
                  {t('agentConsole.v2.aud02.responsibleMissing')}
                </span>
              </div>
              <div className="dq">
                <LkIcon name="alert" size={13} />
                <span>{t('agentConsole.v2.aud02.responsibleMissingNote')}</span>
              </div>
            </>
          )}
        </div>

        {/* 9 资源（wide） */}
        <div className="hf wide" data-testid="aud02-f-resource">
          <div className="l micro">{t('agentConsole.v2.aud02.fResource')}</div>
          <div className="v">
            <span className="micro">{employeeResource ? resourceWord(resourceType, t) : res.typeWord}</span>
            {employeeResource ? (
              <>
                <span className="mono" data-testid="aud02-resource-emp">
                  {employeeText(resourceId, names, t)}
                </span>
                <CopyButton
                  value={resourceId}
                  label={t('agentConsole.v2.aud01.copyResource')}
                  testId="aud02-resource-copy"
                />
                <Link
                  className="lnk acc"
                  to={`/agent/employees/${encodeURIComponent(resourceId)}`}
                  data-testid="aud02-employee-link"
                >
                  {t('agentConsole.v2.aud02.viewEmployee')}
                  <LkIcon name="chevR" size={13} />
                </Link>
              </>
            ) : (
              /* R1 (D3): 「类型 · 短码」; an unreadable id is omitted here and
                 kept in the copy control's title, never sliced into a fragment. */
              <CopyId
                value={resourceId}
                display={res.value ?? ''}
                ariaLabel={t('agentConsole.v2.aud01.copyResource')}
                copiedLabel={t('agentConsole.v2.aud01.copied')}
                testId="aud02-resource-id"
              />
            )}
          </div>
          {ownerRef || scopeRef ? (
            <div className="sub2">
              {ownerRef ? (
                <span>
                  <span className="k">{t('agentConsole.v2.aud02.ownerLabel')}</span>
                  <span className="mono" title={ownerRef}>
                    {typeShortLabel(ownerRef, t) ?? ownerRef}
                  </span>
                </span>
              ) : null}
              {scopeRef ? (
                <span>
                  <span className="k">{t('agentConsole.v2.aud02.scopeLabel')}</span>
                  <span className="mono" title={scopeRef}>
                    {typeShortLabel(scopeRef, t) ?? scopeRef}
                  </span>
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="n">
            {employeeResource
              ? t('agentConsole.v2.aud02.resourceNote')
              : t('agentConsole.v2.aud02.resourceNoteOther')}
          </div>
        </div>
      </div>

      <div className="card-ft">{t('agentConsole.v2.aud02.cardDecisionFoot')}</div>
    </div>
  );
}

// ------------------------------------------------------------------ 03 变更

function ChangeCard({ t, event }: { t: TFunction; event: AuditEventDetail }) {
  const [view, setView] = useState<'diff' | 'json'>('diff');
  const { before, after, anySide } = diffSides(event);
  const diff = diffRows(before, after);
  const payloadRef = (event as unknown as Record<string, unknown>).payloadRef;
  const payload = typeof payloadRef === 'string' ? payloadRef : '';

  return (
    <div className="card" data-testid="aud02-card-change">
      <div className="card-hd">
        <span className="zno" aria-hidden="true">
          03
        </span>
        <span className="t">{t('agentConsole.v2.aud02.cardChange')}</span>
        <span className="c">{t('agentConsole.v2.aud02.chipDiff')}</span>
        <span className="sp" />
        <div
          className="seg sm"
          role="group"
          aria-label={t('agentConsole.v2.aud02.cardChange')}
        >
          <button
            type="button"
            aria-pressed={view === 'diff'}
            data-testid="aud02-view-diff"
            onClick={() => setView('diff')}
          >
            {t('agentConsole.v2.aud02.viewDiff')}
          </button>
          <button
            type="button"
            aria-pressed={view === 'json'}
            data-testid="aud02-view-json"
            onClick={() => setView('json')}
          >
            {t('agentConsole.v2.aud02.viewJson')}
          </button>
        </div>
      </div>

      <div className="dwrap">
        {view === 'diff' ? (
          <div className="dl" data-testid="aud02-diff">
            {!anySide ? (
              <div className="dempty">{t('agentConsole.v2.aud02.diffEmptyNoKeys')}</div>
            ) : diff.rows.length === 0 ? (
              <div className="dempty">{t('agentConsole.v2.aud02.diffEmptySame')}</div>
            ) : (
              diff.rows.map((row) => <DiffLine key={`${row.kind}:${row.key}`} row={row} t={t} />)
            )}
          </div>
        ) : (
          <pre className="jsonbox" data-testid="aud02-diff-json">
            {diffJsonText(event)}
          </pre>
        )}
      </div>

      {hasValue(payload) ? (
        <div className="rowlist">
          <div className="row" data-testid="aud02-payload-ref">
            <span className="k">{t('agentConsole.v2.aud02.payloadRefLabel')}</span>
            <span className="v">
              <CopyId
                value={payload}
                display={shortPath(payload)}
                ariaLabel={t('agentConsole.v2.aud02.payloadRefLabel')}
                copiedLabel={t('agentConsole.v2.aud01.copied')}
                testId="aud02-payload-copy"
              />
              <span className="n">
                {t('agentConsole.v2.aud02.payloadRefNote')}
                <HelpTip term="payloadRef" testId="aud02-help-payload" />
              </span>
            </span>
          </div>
        </div>
      ) : null}

      <div className="card-ft">{t('agentConsole.v2.aud02.cardChangeFoot')}</div>
    </div>
  );
}

/** Objects/arrays serialize to one line; the value block wraps instead of clipping. */
function valueText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null) return 'null';
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return '';
  }
}

function DiffLine({ row, t }: { row: DiffRow; t: TFunction }) {
  const sign = row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : '~';
  const tag =
    row.kind === 'add'
      ? t('agentConsole.v2.aud02.diffTagAdd')
      : row.kind === 'del'
        ? t('agentConsole.v2.aud02.diffTagDel')
        : t('agentConsole.v2.aud02.diffTagChg');
  return (
    <div className={`drow ${row.kind}`} data-testid="aud02-diff-row">
      <span className="sgn" aria-hidden="true">
        {sign}
      </span>
      <span className="dk">{row.key}</span>
      <span className="dv">
        {row.kind === 'chg' ? (
          <>
            <span className="old">{valueText(row.before)}</span>
            <span className="arw" aria-hidden="true">
              {' → '}
            </span>
            <span>{valueText(row.after)}</span>
          </>
        ) : (
          <span>{valueText(row.kind === 'add' ? row.after : row.before)}</span>
        )}
      </span>
      <span className="tagx">{tag}</span>
    </div>
  );
}

// ------------------------------------------------------------------ 04 关联

function RefsCard({ t, event }: { t: TFunction; event: AuditEventDetail }) {
  const refs = relatedRefs(event);
  const present = new Set<RefKey>(refs.map((r) => r.key));
  const missing = REF_ORDER.filter((key) => !present.has(key)).map((key) => t(REF_LABEL_KEYS[key]));

  return (
    <div className="card" data-testid="aud02-card-refs">
      <div className="card-hd">
        <span className="zno" aria-hidden="true">
          04
        </span>
        <span className="t">{t('agentConsole.v2.aud02.cardRefs')}</span>
        <span className="c">{t('agentConsole.v2.aud02.chipRefs')}</span>
        <span className="sp" />
        <span className="hd-note">{t('agentConsole.v2.aud02.cardRefsNote')}</span>
      </div>

      <div className="rowlist">
        {refs.map((ref) => (
          <div className="row" data-testid={`aud02-ref-${ref.key}`} key={ref.key}>
            <span className="k">{t(REF_LABEL_KEYS[ref.key])}</span>
            <span className="v">
              <CopyId
                value={ref.value}
                display={shortCode(ref.value)}
                ariaLabel={t(REF_COPY_KEYS[ref.key])}
                copiedLabel={t('agentConsole.v2.aud01.copied')}
                testId={`aud02-copy-${ref.key}`}
              />
              {ref.href ? (
                <Link className="lnk acc" to={ref.href} data-testid={`aud02-link-${ref.key}`}>
                  {t(REF_VIEW_KEYS[ref.key] as string)}
                  <LkIcon name="chevR" size={13} />
                </Link>
              ) : null}
              {ref.key === 'policySnapshotRef' ? (
                <span className="pill nt" data-testid="aud02-snapshot-unknown">
                  <span className="dot" aria-hidden="true" />
                  {t('agentConsole.v2.aud02.snapshotUnknown')}
                </span>
              ) : null}
              {ref.noteKey ? <span className="n">{t(ref.noteKey)}</span> : null}
            </span>
          </div>
        ))}
      </div>

      <div className="card-ft">
        {missing.length === 0
          ? t('agentConsole.v2.aud02.cardRefsFootAll')
          : t('agentConsole.v2.aud02.cardRefsFootMissing', { list: missing.join('、') })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 05 完整性

function IntegrityCard({
  t,
  event,
  api,
}: {
  t: TFunction;
  event: AuditEventDetail;
  api: AuditDetailApi;
}) {
  const mode = chainModeOf(event);
  const schema = schemaLabel(event.schemaVersion) || 'v1';

  return (
    <div className="card" data-testid="aud02-card-integrity">
      <div className="card-hd">
        <span className="zno" aria-hidden="true">
          05
        </span>
        <span className="t">{t('agentConsole.v2.aud02.cardIntegrity')}</span>
        <span className="c">{t('agentConsole.v2.aud02.chipChain')}</span>
        <span className="sp" />
        <span className="hd-note">{t('agentConsole.v2.aud02.cardIntegrityNote')}</span>
      </div>

      {mode === 'chained' ? (
        <div
          className="chain3"
          role="group"
          aria-label={t('agentConsole.v2.aud02.cardIntegrity')}
          data-testid="aud02-chain3"
        >
          <div className={`cnode${hasValue(event.prevHash) ? '' : ' unk'}`}>
            <div className="k">{t('agentConsole.v2.aud02.chainPrev')}</div>
            <div className="v">
              {hasValue(event.prevHash) ? (
                <CopyId
                  value={wireText(event.prevHash)}
                  display={typeShortLabel(event.prevHash, t) ?? shortId(event.prevHash)}
                  ariaLabel={t('agentConsole.v2.aud01.copyPrevHash')}
                  copiedLabel={t('agentConsole.v2.aud01.copied')}
                  testId="aud02-prev-hash"
                />
              ) : (
                <span className="dim">{t('agentConsole.v2.aud02.chainPrevAbsent')}</span>
              )}
            </div>
            <div className="n">
              {hasValue(event.prevHash)
                ? t('agentConsole.v2.aud02.chainPrevNote')
                : t('agentConsole.v2.aud02.chainPrevAbsentNote')}
            </div>
          </div>
          <div className="clink" aria-hidden="true">
            <span className="i-r">
              <LkIcon name="chevR" size={14} />
            </span>
            <span className="i-d">
              <LkIcon name="chevD" size={14} />
            </span>
          </div>
          <div className="cnode cur">
            <div className="k">{t('agentConsole.v2.aud02.chainCur')}</div>
            <div className="v">
              {hasValue(event.hash) ? (
                <CopyId
                  value={wireText(event.hash)}
                  display={typeShortLabel(event.hash, t) ?? shortId(event.hash)}
                  ariaLabel={t('agentConsole.v2.aud01.copyHash')}
                  copiedLabel={t('agentConsole.v2.aud01.copied')}
                  testId="aud02-cur-hash"
                />
              ) : (
                <span className="dim">{t('agentConsole.v2.aud02.snapshotUnknown')}</span>
              )}
            </div>
            <div className="n">{t('agentConsole.v2.aud02.chainCurNote', { v: schema })}</div>
          </div>
          <div className="clink" aria-hidden="true">
            <span className="i-r">
              <LkIcon name="chevR" size={14} />
            </span>
            <span className="i-d">
              <LkIcon name="chevD" size={14} />
            </span>
          </div>
          <div className="cnode unk">
            <div className="k">{t('agentConsole.v2.aud02.chainNext')}</div>
            <div className="v">
              <span className="pill nt">
                <span className="dot" aria-hidden="true" />
                {t('agentConsole.v2.aud02.chainNextUnknown')}
              </span>
            </div>
            <div className="n">{t('agentConsole.v2.aud02.chainNextNote')}</div>
          </div>
        </div>
      ) : (
        <div
          className="nohash"
          role="note"
          aria-label={t('agentConsole.v2.aud02.nohashPill')}
          data-testid="aud02-nohash"
        >
          <div>
            <span className="pill nt">
              <span className="dot" aria-hidden="true" />
              {t('agentConsole.v2.aud02.nohashPill')}
            </span>
          </div>
          <p>{t('agentConsole.v2.aud02.nohashP1')}</p>
          <p>{t('agentConsole.v2.aud02.nohashP2')}</p>
        </div>
      )}

      <div className="rowlist">
        {mode === 'chained' ? (
          <div className="row" data-testid="aud02-selfproof">
            <span className="k">{t('agentConsole.v2.aud02.rowSelfProof')}</span>
            <span className="v">
              <span className="txt">{t('agentConsole.v2.aud02.selfProofText')}</span>
              <span className="n">
                {t('agentConsole.v2.aud02.selfProofNote')}
                <HelpTip term="hashChain" testId="aud02-help-chain" />
              </span>
            </span>
          </div>
        ) : null}
        <div className="row" data-testid="aud02-row-schema">
          <span className="k">{t('agentConsole.v2.aud02.rowSchema')}</span>
          <span className="v">
            <span className="mono">{schema}</span>
            <span className="n">{t('agentConsole.v2.aud02.schemaNote')}</span>
          </span>
        </div>
        <div className="row">
          <span className="k">
            {mode === 'chained'
              ? t('agentConsole.v2.aud02.rowNoHash')
              : t('agentConsole.v2.aud02.rowWhenHash')}
          </span>
          <span className="v">
            <span className="txt">{t('agentConsole.v2.aud02.noHashText')}</span>
            <span className="n">{t('agentConsole.v2.aud02.noHashNote')}</span>
          </span>
        </div>
      </div>

      <div className="card-ft">{t('agentConsole.v2.aud02.cardIntegrityFoot')}</div>

      {/* The A7 panel is mounted INSIDE section 05 so the seven-part count is
          not broken. Second and last mount of this shared component (the list
          page owns the first); no A-code chip on this page.
          Its styles are scoped `.lk.aud01` (the panel's own vocabulary lives in
          aud01.css), so the host wrapper carries that scope — same look, one
          implementation, no second copy of the panel's rules. */}
      <div className="lk aud01 mount" data-testid="aud02-verify-mount">
        <AuditVerifyPanel api={api} hideCode />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ 06 错误

function ErrorCard({ t, event }: { t: TFunction; event: AuditEventDetail }) {
  return (
    <div className="card" data-testid="aud02-card-error">
      <div className="card-hd">
        <span className="zno" aria-hidden="true">
          06
        </span>
        <span className="t">
          <LkIcon name="alert" size={18} />
          {t('agentConsole.v2.aud02.cardError')}
        </span>
        <span className="c">{t('agentConsole.v2.aud02.chipError')}</span>
        <span className="sp" />
        <span className="hd-note">{t('agentConsole.v2.aud02.cardErrorNote')}</span>
      </div>

      <div className="rowlist">
        {hasValue(event.error?.code) ? (
          <div className="row" data-testid="aud02-error-code">
            <span className="k">
              {t('agentConsole.v2.aud02.errCode')}
              <HelpTip term="errClass" testId="aud02-help-err" />
            </span>
            <span className="v">
              <span className="mono">{wireText(event.error?.code)}</span>
            </span>
          </div>
        ) : null}
        {hasValue(event.error?.messageRedacted) ? (
          <div className="row" data-testid="aud02-error-message">
            <span className="k">{t('agentConsole.v2.aud02.errMessage')}</span>
            <span className="v">
              <span className="msgtext">{wireText(event.error?.messageRedacted)}</span>
              <span className="n">{t('agentConsole.v2.aud02.errRedactedNote')}</span>
            </span>
          </div>
        ) : null}
        <div className="row">
          <span className="k">{t('agentConsole.v2.aud02.errRelation')}</span>
          <span className="v">
            <span className="txt">{t('agentConsole.v2.aud02.errRelationText')}</span>
          </span>
        </div>
      </div>

      <div className="card-ft">{t('agentConsole.v2.aud02.cardErrorFoot')}</div>
    </div>
  );
}

// ------------------------------------------------------------------ shared bits

/** Copy-only identity control: icon + tooltip, no bare id printed on screen. */
function CopyButton({ value, label, testId }: { value: string; label: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = () => {
    try {
      void navigator.clipboard?.writeText(String(value));
    } catch {
      /* clipboard unavailable: the full value stays in the title */
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1200);
  };
  return (
    <button
      type="button"
      className={`cpbtn${copied ? ' copied' : ''}`}
      aria-label={label}
      title={value}
      onClick={copy}
      data-testid={testId}
    >
      <LkIcon name="copy" size={13} />
    </button>
  );
}

/**
 * Readable actor: `displayName` wins (upstream truth), otherwise the type's
 * readable fallback (「员工 · 短码」 / 「用户 #…」 / 「系统 · id」) — never a bare
 * `emp_…` or `human:…` token (S2 caliber).
 */
function actorLabelOf(
  actor: AuditEventDetail['actor'],
  names: Map<string, string>,
  t: TFunction,
): string {
  // One identity path for both pages: case-insensitive type, wire coercion,
  // never a bare `emp_…` / `human:…` token (S2 caliber).
  return actorText(actor, names, t);
}

function DetailSkeleton({ t }: { t: TFunction }) {
  /* Static blocks only — no pulse: a skeleton must not be mistaken for a
   * reading, and it shows no pill, event id or hash (§1.11). */
  const cells = [96, 96, 64, 72, 60, 60, 112, 104];
  return (
    <div className="flow skel" role="status" aria-label={t('agentConsole.v2.aud02.loadingAria')}>
      <div className="backrow">
        <div className="bar" style={{ width: 120, height: 12 }} />
      </div>
      <div className="phead">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minWidth: 0 }}>
          <div className="bar" style={{ width: 300, maxWidth: '100%', height: 26 }} />
          <div className="bar" style={{ width: 220, height: 12 }} />
        </div>
        <div className="bar" style={{ width: 190, height: 32 }} />
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="card-hd">
          <div className="bar" style={{ width: 80, height: 14 }} />
          <div className="sp" />
          <div className="bar" style={{ width: 180, height: 12 }} />
        </div>
        <div className="hfs">
          {cells.map((w, i) => (
            <div className="hf" key={i}>
              <div className="bar" style={{ width: 56, marginBottom: 10 }} />
              <div className="bar" style={{ width: w, height: 16 }} />
            </div>
          ))}
        </div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="card-hd">
          <div className="bar" style={{ width: 140, height: 14 }} />
          <div className="sp" />
          <div className="bar" style={{ width: 120, height: 24 }} />
        </div>
        <div className="skel-row">
          <div className="bar" style={{ width: 84 }} />
          <div className="bar" style={{ width: '60%' }} />
        </div>
        <div className="skel-row">
          <div className="bar" style={{ width: 84 }} />
          <div className="bar" style={{ width: '48%' }} />
        </div>
        <div className="skel-row">
          <div className="bar" style={{ width: 84 }} />
          <div className="bar" style={{ width: '54%' }} />
        </div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="card-hd">
          <div className="bar" style={{ width: 64, height: 14 }} />
          <div className="sp" />
          <div className="bar" style={{ width: 160, height: 12 }} />
        </div>
        <div className="skel-row">
          <div className="bar" style={{ width: 72 }} />
          <div className="bar" style={{ width: 200 }} />
        </div>
        <div className="skel-row">
          <div className="bar" style={{ width: 72 }} />
          <div className="bar" style={{ width: 170 }} />
        </div>
      </div>
      <div className="hd-note center">{t('agentConsole.v2.aud02.loadingNote')}</div>
    </div>
  );
}

function PageFoot({ t }: { t: TFunction }) {
  return (
    <div className="pfoot">
      <span>{t('agentConsole.v2.aud02.pfootSource')}</span>
      <span className="sp" aria-hidden="true" />
      <span>{t('agentConsole.v2.aud02.pfootCaliber')}</span>
      <span className="sp" aria-hidden="true" />
      <span>{t('agentConsole.v2.aud02.pfootReadonly')}</span>
    </div>
  );
}