/* APR-02/03: approval detail (/agent/approvals/:id). Data comes ONLY
 * from AP3 GET /api/approval?id= (same-origin /agent-api); the frozen Approval
 * contract + CR-043 additive `detail` projection drive every field — missing
 * keys render — or an honest "unavailable" panel, never a fabricated value or
 * client-side diff. APR-03 wires the decision write path: approve/reject/revise
 * POST to the BFF whitelist route only after a second confirm, and only for a
 * live (non-terminal, unexpired) non-`message_send` approval where the current
 * user is an approver who has not voted yet. `message_send` stays fully
 * disabled behind an honest banner. Countdown trusts only remainingSeconds
 * (expiresAt = tooltip); terminal 0 reads 「已结束」 (D-4). Unknown/cross-tenant
 * ids share ONE 404/403 body (D-2); binding effectiveFrom/runId/messageDigest
 * are present-only (D-1). Machine codes stay in titles; errors show localized
 * copy + a copyable request id; no HTTP status or field name reaches the view. */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { approvalWriteEnabled } from '@/controllers/API/agentConsoleApprovals';
import { userContext } from '@/contexts/userContext';

import {
  decisionErrorKey,
  fetchApprovalDetail,
  fmtId,
  fmtTime,
  makeFetcher,
  postApprovalDecision,
  type ApprovalDetailBody,
  type ApprovalDetailVersion,
  type DecisionVerdict,
  type Fetcher,
} from './v2Data';

import {
  CopyValue, DetailSkeleton, Field, NaPanel, I,
  IChevL, IShield, IClock, ILock, IX, IUndo, ICheck, IArrowR, ILayers, ISend, IFile, IInbox, IRefresh,
  fmtApprovalId, durationParts, ttlParts, grantParts,
} from './approvalDetailKit';

import { HelpTip } from './HelpTip';
import { LkIcon } from './listkit/icons';
import { ReqId } from './listkit/ReqId';
import { actorTypeLabel, avatarChar, bareId, employeeLabelById, humanLabel, identityText } from './identity';
import { useConsoleCrumbTail } from './Shell';
import { ApprovalDecisionDialog } from './ApprovalDecisionDialog';

import './approvalDetail.css';

type View =
  | { kind: 'loading' }
  | { kind: 'ready'; data: ApprovalDetailBody; receivedAt: number }
  | { kind: 'empty'; rid?: string }
  | { kind: 'hidden'; code: 404 | 403; rid?: string }
  | { kind: 'error'; status: number; timeout?: boolean; rid?: string };

const TERMINAL = ['approved', 'rejected', 'expired', 'cancelled', 'consumed', 'superseded'];

const KIND_KEYS: Record<string, string> = {
  employee_version_create: 'employee_version_create',
  message_send: 'message_send',
  grant_escalation: 'grant_escalation',
  employee_owner_transfer: 'employee_owner_transfer',
};

const STATUS_KEYS: Record<string, string> = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  revise_requested: 'reviseRequested',
  expired: 'expired',
  cancelled: 'cancelled',
  consumed: 'consumed',
  superseded: 'superseded',
};

const STATUS_TONE: Record<string, string> = {
  pending: ' is-warn',
  revise_requested: ' is-warn',
  approved: ' is-ok',
  consumed: ' is-ok',
  rejected: ' is-danger',
};

export function ApprovalDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const fetchApi: Fetcher = useMemo(() => makeFetcher(), []);
  useConsoleCrumbTail(id ? fmtApprovalId(id) : null, id || undefined);
  const [token, setToken] = useState(0);
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [now, setNow] = useState(() => Date.now());
  const warnedKinds = useRef<Set<string>>(new Set());

  // ---- APR-03 write state (single decision through the confirm dialog) ----
  const ctx = useContext(userContext) as { user?: { user_id?: number | string } } | null;
  const myId =
    ctx?.user?.user_id === undefined || ctx?.user?.user_id === null
      ? ''
      : `human:${ctx.user.user_id}`;
  const [decision, setDecision] = useState<DecisionVerdict | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [writeErr, setWriteErr] = useState<{ status: number; code?: string } | null>(null);

  const retry = useCallback(() => setToken((n) => n + 1), []);

  // A new id resets the write area: no stale ballot state leaks across rows.
  useEffect(() => {
    setDecision(null);
    setComment('');
    setWriteErr(null);
  }, [id]);

  const openDecision = (verdict: DecisionVerdict) => {
    setWriteErr(null);
    setComment('');
    setDecision(verdict);
  };

  const submitDecision = useCallback(async () => {
    if (!decision || busy || !id) return;
    setBusy(true);
    setWriteErr(null);
    const res = await postApprovalDecision(id, { verdict: decision, comment });
    setBusy(false);
    if (res.ok) {
      setDecision(null);
      setComment('');
      retry();
      return;
    }
    if (res.status === 401) {
      window.location.assign('/login');
      return;
    }
    setWriteErr({ status: res.status, code: res.code });
    // The ballot/lifecycle moved under us (already decided, expired): close the
    // dialog and reload the authoritative row instead of retrying blindly.
    if (res.status === 409 || res.code === 'approval.already_decided' || res.code === 'approval.expired') {
      setDecision(null);
      setComment('');
      retry();
    }
  }, [busy, comment, decision, id, retry]);
  // Back preserves the list filters: the APR-01 id link carries state.from, and
  // a real browser history entry (idx>0) also restores the prior list URL. Direct
  // entry / refresh with no prior entry falls back to the plain list.
  const goBack = useCallback(() => {
    const from = (location.state as { from?: string } | null)?.from;
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (from || idx > 0) navigate(-1);
    else navigate('/agent/approvals');
  }, [navigate, location.state]);

  // ---- AP3 fetch: direct URL / refresh re-GETs :id; 10s soft timeout ----
  useEffect(() => {
    if (!id) {
      setView({ kind: 'hidden', code: 404 });
      return undefined;
    }
    let alive = true;
    setView({ kind: 'loading' });
    const timer = window.setTimeout(() => {
      if (alive) {
        alive = false;
        setView({ kind: 'error', status: 0, timeout: true });
      }
    }, 10000);
    void fetchApprovalDetail(fetchApi, id).then((res) => {
      if (!alive) return;
      alive = false;
      window.clearTimeout(timer);
      if (res.ok) {
        if (!res.data || !res.data.approvalId) setView({ kind: 'empty', rid: res.requestId });
        else setView({ kind: 'ready', data: res.data, receivedAt: Date.now() });
      } else if (res.status === 401) {
        window.location.assign('/login');
      } else if (res.status === 404) {
        setView({ kind: 'hidden', code: 404, rid: res.requestId });
      } else if (res.status === 403) {
        setView({ kind: 'hidden', code: 403, rid: res.requestId });
      } else {
        setView({ kind: 'error', status: res.status, rid: res.requestId });
      }
    });
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [id, token, fetchApi]);

  // ---- display tick: interpolates the server's remainingSeconds only ----
  useEffect(() => {
    if (view.kind !== 'ready') return undefined;
    const iv = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(iv);
  }, [view.kind]);

  const apd = (key: string, opts?: Record<string, unknown>) => t(`agentConsole.v2.apd.${key}`, opts);
  const apdDef = (key: string, def: string) => t(`agentConsole.v2.apd.${key}`, def);

  const backBtn = (
    <button type="button" className="a2d-gh" onClick={goBack} data-testid="agent-v2-apd-back" title={apd('backTitle')}>
      <I className="a2d-i a2d-i14">{IChevL}</I>
      {apd('back')}
    </button>
  );

  /* ---------- whole-page states (one shared stage body) ---------- */
  if (view.kind === 'loading') {
    return <DetailSkeleton note={apd('loadingNote')} aria={apd('loadingAria')} />;
  }

  const stage = (
    icon: ReactNode,
    title: string,
    desc: ReactNode,
    retryLabel: string,
    testid: string,
    reqLine?: ReactNode,
    withRetry = true,
  ) => (
    <div className="a2s-page" data-testid="agent-v2-approval-detail">
      <div className="a2d-backrow">{backBtn}</div>
      <div className="a2d-card a2d-stage" data-testid={testid}>
        <span className="a2d-ic"><I className="a2d-i a2d-i20">{icon}</I></span>
        <div className="a2d-st">{title}</div>
        <div className="a2d-ss">{desc}</div>
        <div className="a2d-acts2">
          {withRetry ? (
            <button type="button" className="a2d-btn out" onClick={retry} data-testid="agent-v2-apd-retry">
              <I>{IRefresh}</I>
              {retryLabel}
            </button>
          ) : null}
          <button type="button" className="a2d-gh" onClick={goBack}>
            <I className="a2d-i a2d-i14">{IChevL}</I>
            {apd('back')}
          </button>
        </div>
        {/* S4: error/hidden/empty stages carry the request line — id or 「未提供」. */}
        {reqLine}
      </div>
    </div>
  );

  if (view.kind === 'hidden') {
    return stage(
      ILock,
      apd('hiddenTitle'),
      apd('hiddenDesc'),
      apd('refreshTry'),
      view.code === 404 ? 'agent-v2-apd-notfound' : 'agent-v2-apd-forbidden',
      <ReqId requestId={view.rid} testId="agent-v2-apd-hidden-reqid" />,
      false,
    );
  }
  if (view.kind === 'empty') {
    return stage(
      IInbox,
      apd('emptyTitle'),
      apd('emptyDesc'),
      apd('reload'),
      'agent-v2-apd-emptybody',
      <ReqId requestId={(view as { rid?: string }).rid} testId="agent-v2-apd-empty-reqid" />,
    );
  }
  if (view.kind === 'error') {
    return stage(
      IInbox,
      apd('errorTitle'),
      view.timeout ? apd('errorTimeoutDesc') : apd('errorDesc'),
      apd('reload'),
      'agent-v2-apd-error',
      <ReqId requestId={view.rid} testId="agent-v2-apd-error-reqid" />,
    );
  }

  /* ---------- ready ---------- */
  const row = view.data;
  const binding = row.binding;
  const kind = binding.changeKind ?? '';
  const isTerminal = TERMINAL.includes(row.status);
  const statusKey = STATUS_KEYS[row.status];
  const statusLabel = statusKey ? apd(`status.${statusKey}`) : '—';
  const statusTone = STATUS_TONE[row.status] ?? '';
  const kindKnown = Boolean(KIND_KEYS[kind]);
  if (!kindKnown && kind && !warnedKinds.current.has(kind)) {
    warnedKinds.current.add(kind);
    console.warn('[apr02] unknown changeKind enum, raw value kept in title only:', kind);
  }
  const kindLabel = kindKnown ? apd(`kind.${KIND_KEYS[kind]}`) : kind ? apd('kindOther') : '—';
  const riskTone =
    row.riskLevel === 'high' ? 'hsl(var(--danger))' : row.riskLevel === 'medium' ? 'hsl(var(--warning))' : 'hsl(var(--micro-foreground))';
  const riskLabel =
    row.riskLevel === 'low' || row.riskLevel === 'medium' || row.riskLevel === 'high'
      ? apd(`risk.${row.riskLevel}`)
      : apd('riskUnknown');
  const typeLabel = row.type === 'business_action' || row.type === 'confirm' ? apd(`type.${row.type}`) : apd('typeUnknown');

  const serverRemaining = typeof row.remainingSeconds === 'number' && Number.isFinite(row.remainingSeconds) ? row.remainingSeconds : null;
  const elapsed = Math.max(0, Math.floor((now - view.receivedAt) / 1000));
  const remaining = serverRemaining === null ? null : Math.max(0, serverRemaining - elapsed);
  const dur = remaining === null ? null : durationParts(remaining);
  const durText = dur ? t(dur.key, dur.opts) : '—';
  const ended = remaining !== null && remaining <= 0;

  /* APR-03 write eligibility. Every input is a field the payload actually
   * carries: build-time write switch, live lifecycle, non-outbound change kind,
   * approver membership (`approvers[].userId`) and "I have not voted yet".
   * There is no client-invented admin role: an unauthorized account still sees
   * disabled controls and the BFF stays the final 403 gate. */
  const writeFlag = approvalWriteEnabled();
  const outbound = kind === 'message_send';
  const isApprover = myId !== '' && (row.approvers ?? []).some((a) => a.userId === myId);
  const alreadyVoted = myId !== '' && (row.decisions ?? []).some((d) => d.userId === myId);
  const decidable =
    writeFlag && row.status === 'pending' && !ended && !outbound && isApprover && !alreadyVoted;
  const opsNote = outbound
    ? apd('opsNoteMessageSendDesc')
    : !writeFlag
      ? apd('opsNoteWriteOff')
      : row.status !== 'pending' || ended
        ? apd('opsNoteEnded')
        : !isApprover
          ? apd('opsNoteNotApprover')
          : alreadyVoted
            ? apd('opsNoteVoted')
            : apd('opsNoteWritable');
  const writeErrorCopy = writeErr
    ? t(`agentConsole.v2.decide.err.${decisionErrorKey(writeErr.status, writeErr.code)}`, {
        code: writeErr.status,
      })
    : '';

  const detail = row.detail;
  const change = detail?.changeDetail;
  const employeeName = detail?.employee?.name ?? null;
  const subjectName = binding.subjectType === 'employee' && detail?.employee?.employeeId === binding.subjectId ? employeeName : null;
  const fromNo = change ? change.toVersionNo - 1 : null;

  const refNode = (ref: { type: string; id: string } | null | undefined, name?: string | null) => {
    if (!ref) return <span className="a2d-faint">—</span>;
    if (name) {
      return (
        <span className="a2d-who" title={`${ref.type} · ${ref.id}`}>
          <span className="a2d-ava" aria-hidden="true">
            {avatarChar(name) ?? <LkIcon name="user" size={12} />}
          </span>
          {name}
          <span className="a2d-u">{actorTypeLabel(ref.type, t)}</span>
        </span>
      );
    }
    // S2: no raw `type · human:id` line — each type degrades to a readable
    // form (「用户 #7」/「员工 · 短码」); the full ref stays in the title.
    const bare = bareId(ref.id);
    const label =
      ref.type === 'human' || ref.type === 'user'
        ? humanLabel(bare, t)
        : ref.type === 'employee'
          ? employeeLabelById(ref.id, undefined, t)
          : identityText(ref.id, t);
    return (
      <span className="a2d-who" title={`${ref.type} · ${ref.id}`}>
        {label}
      </span>
    );
  };

  const renderChangeDetail = () => {
    if (kind === 'employee_version_create' && change) {
      const versions = detail?.versions ?? [];
      const added = change.addedGrants ?? [];
      const removed = change.removedGrantIds ?? [];
      const first = added[0];
      const afterSub =
        added.length > 1
          ? apd('grantAddedCount', { count: added.length })
          : first
            ? apd('grantAdded', {
                grant:
                  apd('grantChannel', grantParts(first)) +
                  (first.expiresAt ? apd('grantExpiresSuffix', { time: fmtTime(first.expiresAt) }) : ''),
              })
            : apd('none');
      return (
        <>
          <div className="a2d-sec">
            <div className="a2-micro">{apd('versionChange')}</div>
            <div className="a2d-diffto">
              <div className="a2d-box">
                <span className="a2d-a">{isTerminal ? apd('beforeTerminal') : apd('beforeCurrent')}</span>
                <span className="a2d-b">v{fromNo}</span>
                <span className="a2d-c a2-mono" title={change.fromVersionId}>{fmtId(change.fromVersionId)}</span>
              </div>
              <I className="a2d-i a2d-arr">{IArrowR}</I>
              <div className="a2d-box to">
                <span className="a2d-a">{isTerminal ? apd('afterTerminal') : apd('afterPending')}</span>
                <span className="a2d-b">v{change.toVersionNo}</span>
                <span className="a2d-c">{afterSub}</span>
              </div>
            </div>
            <table className="a2d-kvt" aria-label={apd('detailTitle')}>
              <tbody>
                <tr>
                  <td className="k">{apd('kEmployee')}</td>
                  <td title={change.employeeId}>
                    {employeeName ?? employeeLabelById(change.employeeId, undefined, t)}
                  </td>
                </tr>
                <tr>
                  <td className="k">{apd('kFromVersion')}</td>
                  <td title={change.fromVersionId}>
                    <span className="a2-mono">v{fromNo}</span>
                    <span className="a2d-vtag">{fmtId(change.fromVersionId)}</span>
                  </td>
                </tr>
                <tr>
                  <td className="k">{apd('kToVersion')}</td>
                  <td title={String(change.toVersionNo)}>{change.toVersionNo}</td>
                </tr>
                <tr>
                  <td className="k">{apd('kAdded')}</td>
                  <td>
                    {added.length === 0 ? (
                      apd('none')
                    ) : (
                      <>
                        {apd('grantChannel', grantParts(first))}
                        <span className="a2d-vtag">
                          {first.expiresAt
                            ? apd('grantMeta', { count: added.length, expires: fmtTime(first.expiresAt), source: first.source ?? '—' })
                            : apd('grantMetaNoExpires', { count: added.length, source: first.source ?? '—' })}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="k">{apd('kRemoved')}</td>
                  <td title={removed.join(', ')}>
                    {removed.length === 0 ? apd('none') : <span className="a2-mono">{removed.map((x) => fmtId(x)).join('、')}</span>}
                  </td>
                </tr>
                <tr>
                  <td className="k">{apd('kEffective')}</td>
                  <td className="a2-mono" title={fmtTime(change.effectiveFrom)}>{fmtTime(change.effectiveFrom)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {versions.length > 0 ? (
            <div className="a2d-sec">
              <div className="a2-micro">{apd('versionSnapshot')}</div>
              <table className="a2d-kvt" aria-label={apd('versionSnapshot')}>
                <thead>
                  <tr>
                    <th style={{ width: 72 }}>{apd('vColNo')}</th>
                    <th>{apd('vColEffective')}</th>
                    <th style={{ width: 110 }}>{apd('vColMark')}</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v: ApprovalDetailVersion) => {
                    // Marks are UI-derived (target §1.5). Rows are ONLY the CR-043
                    // projection's existing versions — the proposed new version is
                    // shown in the before→after box, never synthesized as a row.
                    let mark: ReactNode;
                    if (isTerminal && v.versionNo === fromNo) {
                      mark = <span className="a2d-vtag">{apd('vMarkBefore')}</span>;
                    } else if (v.status === 'current') {
                      mark = <span className="a2-pill a2d-xs">{apd('vMarkCurrent')}</span>;
                    } else {
                      mark = <span className="a2d-vtag">{apd('vMarkHistory')}</span>;
                    }
                    return (
                      <tr key={v.versionNo}>
                        <td className="a2-mono">v{v.versionNo}</td>
                        <td className="a2-mono">{v.effectiveFrom ? fmtTime(v.effectiveFrom) : '—'}</td>
                        <td>{mark}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="a2d-hd-note" style={{ marginTop: 8 }}>{apd('vNote')}</div>
            </div>
          ) : null}
        </>
      );
    }
    if (kind === 'employee_version_create') {
      return <NaPanel icon={IFile} title={apd('naNoDetailTitle')} desc={apd('naNoDetailDesc')} testid="agent-v2-apd-na-nodetail" />;
    }
    if (kind === 'message_send') {
      return <NaPanel icon={ISend} title={apd('naMessageTitle')} desc={apd('naMessageDesc')} testid="agent-v2-apd-na-message" />;
    }
    return <NaPanel icon={IFile} title={apd('naContractTitle')} desc={apd('naContractDesc')} testid="agent-v2-apd-na-contract" />;
  };

  const decisions = [...(row.decisions ?? [])].sort((a, b) => Date.parse(a.decidedAt) - Date.parse(b.decidedAt));
  const verdictTone = (v: string) => (v === 'approve' ? ' is-ok' : v === 'reject' ? ' is-danger' : v === 'revise' ? ' is-warn' : '');
  const verdictLabel = (v: string) =>
    v === 'approve' || v === 'reject' || v === 'revise' ? apd(`verdict.${v}`) : apd('verdictUnknown');

  return (
    <div className="a2s-page" data-testid="agent-v2-approval-detail">
      <div className="a2d-backrow">{backBtn}</div>

      {/* header */}
      <div className="a2d-phead">
        <div style={{ minWidth: 0 }}>
          <h1 className="a2d-h1" title={[kind, row.action].filter(Boolean).join(' · ')}>{kindLabel}</h1>
          <div className="a2d-tags">
            <CopyValue value={row.approvalId} aria={apd('copyIdAria')}>
              <span style={{ fontWeight: 400 }}>{fmtApprovalId(row.approvalId)}</span>
            </CopyValue>
            <span className={`a2-pill${statusTone}`} title={row.status} data-testid="agent-v2-apd-status">
              <span className="a2-pill-dot" aria-hidden="true" />
              {statusLabel}
            </span>
            <span className="a2-pill" title={row.riskLevel} data-testid="agent-v2-apd-risk">
              <span style={{ color: riskTone, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <I className="a2d-i a2d-i13">{IShield}</I>
                {riskLabel}
              </span>
            </span>
            <span className="a2-pill" title={row.type}>{typeLabel}</span>
            <span
              className={`a2-pill${ended || isTerminal ? '' : ' is-warn'}`}
              title={row.expiresAt ? fmtTime(row.expiresAt) : undefined}
              data-testid="agent-v2-apd-countdown"
            >
              <I className="a2d-i a2d-i13">{IClock}</I>
              {ended ? apd('ended') : dur ? apd('pillExpires', { dur: durText }) : '—'}
            </span>
          </div>
        </div>
      </div>
      <div className="a2d-fresh">
        <I className="a2d-i a2d-i13">{IClock}</I>
        <span>{apd('updated', { time: fmtTime(new Date(view.receivedAt).toISOString()) })}</span>
        <span className="a2d-faint">·</span>
        <span>{apd('source')}</span>
      </div>

      {/* metadata */}
      <div className="a2d-card" data-testid="agent-v2-apd-meta">
        <div className="a2d-card-hd">
          <span className="a2d-t">{apd('metaTitle')}</span>
          <span className="a2d-sp" />
          <span className="a2d-hd-note">{apd('metaNote')}</span>
        </div>
        <div className="a2d-rule" />
        <div className="a2d-meta">
          <Field label={apd('fRequestedBy')}>{refNode(row.requestedBy, row.requestedBy?.type === 'employee' ? subjectName : null)}</Field>
          <Field label={apd('fOnBehalfOf')}>{refNode(row.onBehalfOf, row.onBehalfOf?.type === 'employee' && row.onBehalfOf.id === binding.subjectId ? subjectName : null)}</Field>
          <Field label={apd('fApprovers')}>
            <span className="a2d-appr">
              {(row.approvers ?? []).map((a) => (
                <span key={a.userId} className="a2-pill a2d-xs" title={[a.userId, a.role].filter(Boolean).join(' · ')}>
                  <span>{identityText(a.userId, t)}</span>
                  {a.role ? <span className="a2d-u">{apdDef(`role.${a.role}`, apd('roleUnknown'))}</span> : null}
                </span>
              ))}
            </span>
          </Field>
          <Field label={apd('fRequired')} mono title={String(row.requiredApprovals)}>
            {row.requiredApprovals}
            {row.requiredApprovals === 1 ? <span className="a2d-u">{apd('fRequiredAny')}</span> : null}
          </Field>
          <Field label={apd('fTtl')} mono title={`${row.ttlSeconds}s`}>
            {t(ttlParts(row.ttlSeconds).key, ttlParts(row.ttlSeconds).opts)}
          </Field>
          <Field label={apd('fRemaining')} mono faint={ended || isTerminal} title={row.remainingSeconds == null ? undefined : `${row.remainingSeconds}s`}>
            <span data-testid="agent-v2-apd-remaining" style={ended || isTerminal ? undefined : { color: 'hsl(var(--warning))' }}>
              {durText}
            </span>
          </Field>
          <Field label={apd('fCreated')} mono title={fmtTime(row.createdAt)}>{fmtTime(row.createdAt)}</Field>
          <Field label={apd('fExpires')} mono faint={isTerminal} title={fmtTime(row.expiresAt)}>{fmtTime(row.expiresAt)}</Field>
          <Field label={apd('fPolicy')} wide mono>
            {row.policyDecisionId ? (
              <CopyValue value={row.policyDecisionId} aria={apd('copyPolicyAria')} inline>
                {fmtId(row.policyDecisionId)}
              </CopyValue>
            ) : '—'}
          </Field>
          <Field label={apd('fArgs')} wide mono>
            {row.argsDigest ? (
              <CopyValue value={row.argsDigest} aria={apd('copyArgsAria')} inline>
                {fmtId(row.argsDigest)}
              </CopyValue>
            ) : '—'}
          </Field>
          <Field label={apd('fReason')} wide>
            {row.reasonText ? <div className="a2d-quote">{row.reasonText}</div> : '—'}
          </Field>
        </div>
      </div>

      {/* binding (present-only, D-1) */}
      <div className="a2d-card" data-testid="agent-v2-apd-binding">
        <div className="a2d-card-hd">
          <span className="a2d-t">{apd('bindTitle')}</span>
          <span className="a2d-sp" />
          <span className="a2d-hd-note">
            {apd('bindNote')}
            <HelpTip term="presentOnly" testId="agent-v2-apd-help-present-only" className="a2d-hd-help" />
          </span>
        </div>
        <div className="a2d-rule" />
        <div className="a2d-meta">
          <Field label={apd('fSubjectType')} title={binding.subjectType}>
            {binding.subjectType === 'employee' ? apd('subjectEmployee') : apd('subjectUnknown')}
          </Field>
          <Field label={apd('fSubject')}>
            <span className="a2d-who" title={binding.subjectId}>
              {subjectName ? <span className="a2d-ava" aria-hidden="true">{avatarChar(subjectName) ?? <LkIcon name="user" size={12} />}</span> : null}
              <span className="a2-mono" style={{ fontSize: 12 }}>{fmtId(binding.subjectId)}</span>
              {subjectName ? <span className="a2d-u">{subjectName}</span> : null}
            </span>
          </Field>
          <Field label={apd('fChangeKind')} title={kind}>{kindLabel}</Field>
          {binding.effectiveFrom ? (
            <Field label={apd('fEffectiveFrom')} mono title={fmtTime(binding.effectiveFrom)}>
              {fmtTime(binding.effectiveFrom)}
            </Field>
          ) : null}
          {binding.runId ? (
            <Field label={apd('fRunId')}>
              <CopyValue value={binding.runId} aria={apd('copyRunAria')}>
                <span style={{ fontSize: 12 }}>{fmtId(binding.runId)}</span>
              </CopyValue>
            </Field>
          ) : null}
          {binding.messageDigest ? (
            <Field
              label={apd('fMessageDigest')}
              wide
              mono
              title={binding.messageDigest}
              help={<HelpTip term="messageDigest" testId="agent-v2-apd-help-message-digest" />}
            >
              <CopyValue value={binding.messageDigest} aria={apd('copyMessageDigestAria')} inline>
                {fmtId(binding.messageDigest)}
              </CopyValue>
            </Field>
          ) : null}
          <Field
            label={apd('fTargetHash')}
            wide
            mono
            title={binding.targetHash}
            help={<HelpTip term="targetHash" testId="agent-v2-apd-help-target-hash" />}
          >
            <CopyValue value={binding.targetHash} aria={apd('copyTargetHashAria')} inline>
              {fmtId(binding.targetHash)}
            </CopyValue>
          </Field>
        </div>
      </div>

      {/* change detail (four branches) */}
      <div className="a2d-card" data-testid="agent-v2-apd-detail">
        <div className="a2d-card-hd">
          <span className="a2d-t">{apd('detailTitle')}</span>
          <span className="a2-pill is-accent a2d-xs" title={kind}>
            <I className="a2d-i a2d-i13">{kind === 'message_send' ? ISend : kind === 'grant_escalation' ? IShield : ILayers}</I>
            {kindLabel}
          </span>
          <span className="a2d-sp" />
          {change ? <span className="a2d-hd-note">{apd('detailSource')}</span> : null}
        </div>
        <div className="a2d-rule" />
        {renderChangeDetail()}
      </div>

      {/* decision history */}
      <div className="a2d-card" data-testid="agent-v2-apd-decisions">
        <div className="a2d-card-hd">
          <span className="a2d-t">{apd('decisionsTitle')}</span>
          <span className="a2d-sp" />
          <span className="a2d-hd-note">{apd('decisionsNote')}</span>
        </div>
        <div className="a2d-rule" />
        {decisions.length === 0 ? (
          <NaPanel icon={IInbox} title={apd('decisionsEmptyTitle')} desc={apd('decisionsEmptyDesc')} testid="agent-v2-apd-decisions-empty" />
        ) : (
          <div className="a2d-sec">
            <ul className="a2d-tl">
              {decisions.map((d, i) => (
                <li key={`${d.userId}-${i}`} className={`a2d-ti${d.verdict === 'approve' ? ' ok' : d.verdict === 'reject' ? ' dg' : ''}`}>
                  <span className="a2d-nd">
                    <I className="a2d-i" >{d.verdict === 'approve' ? ICheck : d.verdict === 'reject' ? IX : IUndo}</I>
                  </span>
                  <div className="a2d-thd">
                    <span className="a2d-nm" title={d.userId}>{identityText(d.userId, t)}</span>
                    <span className={`a2-pill a2d-xs${verdictTone(d.verdict)}`} title={d.verdict}>
                      <span className="a2-pill-dot" aria-hidden="true" />
                      {verdictLabel(d.verdict)}
                    </span>
                    <span className="a2d-tm a2-mono" title={d.decidedAt}>{fmtTime(d.decidedAt)}</span>
                  </div>
                  {d.comment ? <div className="a2d-cm">{d.comment}</div> : null}
                </li>
              ))}
            </ul>
          </div>
        )}
        {isTerminal ? (
          <div className="a2d-term" data-testid="agent-v2-apd-term">
            <Field label={apd('termVerdict')}>
              {row.verdict ? (
                <span className={`a2-pill a2d-xs${verdictTone(row.verdict)}`} title={row.verdict}>
                  <span className="a2-pill-dot" aria-hidden="true" />
                  {verdictLabel(row.verdict)}
                </span>
              ) : (
                '—'
              )}
            </Field>
            <Field label={apd('termDecidedAt')} mono title={row.decidedAt ? fmtTime(row.decidedAt) : undefined}>{fmtTime(row.decidedAt)}</Field>
            <Field label={apd('termConsumedAt')} mono title={row.consumedAt ? fmtTime(row.consumedAt) : undefined}>{fmtTime(row.consumedAt)}</Field>
            {row.supersededBy ? (
              <Field label={apd('termSupersededBy')}>
                <NavLink className="a2d-link" to={`/agent/approvals/${row.supersededBy}`} title={row.supersededBy}>
                  {fmtApprovalId(row.supersededBy)}
                </NavLink>
              </Field>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* operations — APR-03: real decision write, gated + confirmed */}
      <div className="a2d-card" data-testid="agent-v2-apd-ops">
        <div className="a2d-sec">
          <div className="a2-micro">{apd('opsTitle')}</div>
          {outbound ? (
            <div className="a2d-banner" role="status" data-testid="agent-v2-apd-outbound-banner">
              <I className="a2d-i a2d-i16">{ISend}</I>
              <div>
                <div className="a2d-banner-t">{apd('outboundTitle')}</div>
                <div className="a2d-banner-d">{apd('outboundDesc')}</div>
              </div>
            </div>
          ) : null}
          <div className="a2d-acts">
            <button
              type="button"
              className="a2d-btn dgs"
              disabled={!decidable || busy}
              aria-disabled={!decidable || busy}
              title={decidable ? apd('rejectTitle') : opsNote}
              onClick={() => openDecision('reject')}
              data-testid="agent-v2-apd-reject"
            >
              <I>{IX}</I>
              {apd('reject')}
            </button>
            <span className="a2d-sp" />
            <button
              type="button"
              className="a2d-btn out"
              disabled={!decidable || busy}
              aria-disabled={!decidable || busy}
              title={decidable ? apd('reviseTitle') : opsNote}
              onClick={() => openDecision('revise')}
              data-testid="agent-v2-apd-revise"
            >
              <I>{IUndo}</I>
              {apd('revise')}
            </button>
            <span className="a2d-vsep" />
            <button
              type="button"
              className="a2d-btn pri"
              disabled={!decidable || busy}
              aria-disabled={!decidable || busy}
              title={decidable ? apd('approveTitle') : opsNote}
              onClick={() => openDecision('approve')}
              data-testid="agent-v2-apd-approve"
            >
              <I>{ICheck}</I>
              {apd('approve')}
            </button>
          </div>
          <div className="a2d-opnote" data-testid="agent-v2-apd-ops-note">
            <I className="a2d-i a2d-i14">{decidable ? IShield : ILock}</I>
            <span>{opsNote}</span>
          </div>
          {!decision && writeErr ? (
            <div className="a2d-writeerr" role="alert" data-testid="agent-v2-apd-write-error">
              {writeErrorCopy}
            </div>
          ) : null}
        </div>
      </div>

      {decision ? (
        <ApprovalDecisionDialog
          verdict={decision}
          title={t('agentConsole.v2.decide.dialog.title', { verb: apd(`verdict.${decision}`) })}
          target={fmtApprovalId(row.approvalId)}
          kindLabel={kindLabel}
          riskLabel={riskLabel}
          riskNote={t('agentConsole.v2.decide.dialog.riskNote')}
          withComment
          comment={comment}
          onComment={setComment}
          busy={busy}
          error={writeErr ? writeErrorCopy : undefined}
          onCancel={() => {
            setDecision(null);
            setComment('');
            setWriteErr(null);
          }}
          onConfirm={() => void submitDecision()}
        />
      ) : null}

      {/* footer caliber (target .pfoot) */}
      <div className="a2d-pfoot" data-testid="agent-v2-apd-footer">
        <span>{apd('footSource')}</span>
        <span>
          {apd('footCaliber')}
          {/* P1 batch2: the footer line IS the caliber statement — explain it here. */}
          <HelpTip term="caliber" testId="agent-v2-apd-help-caliber" className="a2d-pfoot-help" />
        </span>
        {/* S3: the ⌘K search hint pointed at the removed dead global search. */}
      </div>
    </div>
  );
}