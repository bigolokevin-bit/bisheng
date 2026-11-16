/* APR-02 approval detail (page card docs/validation/console/approval-detail).
 * Read-only: the ONLY data source is AP3 GET /api/approval?id=<approvalId>
 * through the same-origin /agent-api BFF. No AP2 write, no batch, no
 * approver editing — every decision button stays disabled this wave.
 * The change-detail block comes from AP3's additive `detail` projection
 * (CR-043, targetHash-anchored): the server omits the key when the hash gate
 * does not pass, and the page then says 不可得 — it never recomputes a diff
 * on the client and never fabricates a value for a missing field (card §2).
 * Countdown honours the server's remainingSeconds only; expiresAt is title
 * text, never a client-side derivation. Error copy is the OV-01 G15 idiom:
 * localized blockUnavailable + the HTTP status as the only interpolation
 * param — machine codes (approval.*, policy.*) never reach the screen, and
 * unknown / cross-tenant ids share one 404 copy so existence is not leaked. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useParams } from 'react-router-dom';

import { fmtId, fmtTime, makeFetcher, type ApiRes, type Fetcher } from './v2Data';

// AP3 approval_public as returned by the live BFF (key sets verified
// 2026-11-16, probe legs l4wag-apr02a/c). Everything except approvalId is
// optional: an absent key renders as — or an explicit 不可得, never a guess.
interface ApprovalRefLite { type?: string; id?: string }
interface ApproverLite { userId?: string; role?: string | null }
interface DecisionLite {
  userId?: string;
  verdict?: string;
  comment?: string | null;
  decidedAt?: string;
  consumedAt?: string | null;
}
interface BindingLite { subjectType?: string; subjectId?: string; changeKind?: string; targetHash?: string }
/* CR-043 canonical six keys + the provenance marker `source`. Values stay
 * loose: the projection passes the resource through, so an added_grants
 * entry can be a grant id string or a whole grant object. */
interface ChangeDetailLite {
  employeeId?: unknown;
  fromVersionId?: unknown;
  toVersionNo?: unknown;
  addedGrants?: unknown;
  removedGrantIds?: unknown;
  effectiveFrom?: unknown;
  source?: string;
}
interface VersionRowLite { versionNo?: number; effectiveFrom?: string; status?: string; knowledgeCount?: number }
interface DetailProjectionLite { changeDetail?: ChangeDetailLite; versions?: VersionRowLite[] }
// AP3 approval_public (camelCase, contract-verbatim); `detail` is additive
interface ApprovalDetailBody {
  approvalId: string;
  type?: string;
  action?: string;
  status?: string;
  riskLevel?: string;
  binding?: BindingLite;
  argsDigest?: string | null;
  requestedBy?: ApprovalRefLite | null;
  onBehalfOf?: ApprovalRefLite | null;
  reasonText?: string | null;
  approvers?: ApproverLite[];
  requiredApprovals?: number;
  decisions?: DecisionLite[];
  verdict?: string | null;
  decidedAt?: string | null;
  policyDecisionId?: string | null;
  expiresAt?: string | null;
  remainingSeconds?: number | null;
  ttlSeconds?: number | null;
  consumedAt?: string | null;
  supersededBy?: string | null;
  createdAt?: string | null;
  detail?: DetailProjectionLite | null;
}

interface MetaItem { label: string; value: string; testId: string; title?: string }

// server status snake_case → locale status key camelCase (same vocabulary as
// the passed APR-01 list page; kept local so this page owns its glue)
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

function statusKey(status: string): string {
  return STATUS_KEYS[status] ?? status;
}

// read-only action row: the verbs exist for the next wave, the handlers do
// not (card §3.5 — no AP2 request leaves this page)
const DECIDE_VERBS = ['approve', 'reject', 'revise'] as const;

// copy feedback after the id copy button is pressed (idle renders nothing)
const COPY_TEXT = { ok: 'agentConsole.v2.aprd.copied', fail: 'agentConsole.v2.aprd.copyFailed' } as const;

// DESIGN-SYSTEM risk tones for the dot+text pill (same vocabulary as the
// passed APR-01 list; neutral fallback for an unknown enum).
function riskTone(riskLevel: string): string {
  if (riskLevel === 'high') return 'is-danger';
  if (riskLevel === 'medium') return 'is-warn';
  return 'is-accent';
}

// AP3 is the only endpoint this page calls (card §2: 唯一数据源).
function fetchApprovalDetail(fetchApi: Fetcher, id: string): Promise<ApiRes<ApprovalDetailBody>> {
  return fetchApi<ApprovalDetailBody>('/api/approval', { id });
}

function hasValue(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '';
}

/** {type,id} reference objects render as `type:id`, never [object Object]. */
function refText(ref: ApprovalRefLite | null | undefined): string {
  if (!ref) return '—';
  const type = typeof ref.type === 'string' && ref.type ? ref.type : '';
  const id = typeof ref.id === 'string' && ref.id ? ref.id : '';
  if (type && id) return `${type}:${id}`;
  return id || type || '—';
}

/** Scalar text; an ISO timestamp gets the console's Asia/Shanghai rendering
 *  and anything else stays the raw value (opaque digests are never re-formatted). */
function scalarText(v: unknown): string {
  if (typeof v !== 'string') {
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '—';
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v))) return fmtTime(v);
  return v;
}

/** A grant entry is either an id string or a grant object; anything else
 *  renders — instead of an invented label. */
function grantText(g: unknown): string {
  if (typeof g === 'string') return g;
  if (g && typeof g === 'object') {
    const rec = g as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id : '';
    const scope = typeof rec.scopeType === 'string' ? rec.scopeType : '';
    const actions = Array.isArray(rec.actions) ? rec.actions.filter((a) => typeof a === 'string') : [];
    const tail = actions.length ? ` · ${scope || '—'}/${actions.join('+')}` : '';
    if (id) return `${id}${tail}`;
    if (scope && actions.length) return `${scope}/${actions.join('+')}`;
  }
  return '—';
}

function listText(v: unknown): string {
  if (Array.isArray(v)) return v.length ? v.map(grantText).join(' · ') : '—';
  if (typeof v === 'string') return v || '—';
  return scalarText(v);
}

/** Only the canonical keys that are REALLY present become rows (card §2:
 *  字段真实出现才渲染); `source` is the projection's own provenance marker. */
function sixKeyRows(cd: ChangeDetailLite): { key: string; value: string; testId: string }[] {
  const rows: { key: string; value: string; testId: string }[] = [];
  const push = (key: string, value: unknown, testId: string, asList = false) => {
    if (value !== undefined) rows.push({ key, value: asList ? listText(value) : scalarText(value), testId });
  };
  push('k_employeeId', cd.employeeId, 'agent-v2-aprd-diff-employee');
  push('k_fromVersionId', cd.fromVersionId, 'agent-v2-aprd-diff-from');
  push('k_toVersionNo', cd.toVersionNo, 'agent-v2-aprd-diff-to');
  push('k_addedGrants', cd.addedGrants, 'agent-v2-aprd-diff-added', true);
  push('k_removedGrantIds', cd.removedGrantIds, 'agent-v2-aprd-diff-removed', true);
  push('k_effectiveFrom', cd.effectiveFrom, 'agent-v2-aprd-diff-effective');
  push('k_source', cd.source, 'agent-v2-aprd-diff-source');
  return rows;
}

export function ApprovalDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const fetchApi: Fetcher = useMemo(() => makeFetcher(), []);
  const [res, setRes] = useState<ApiRes<ApprovalDetailBody> | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  /* The server's remainingSeconds is anchored to the moment the payload
   * arrived; the 1 s tick only interpolates the label (APR-01 L6 F-1 idiom).
   * No client clock ever decides an expired state. */
  const [receivedAt, setReceivedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle');

  const handleRetry = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    if (!id) {
      setRes(null);
      setLoading(false);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    fetchApprovalDetail(fetchApi, id).then((r) => {
      if (!alive) return;
      setRes(r);
      if (r.ok) setReceivedAt(Date.now());
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [fetchApi, id, reloadToken]);

  // a 200 body without approvalId is an empty payload, not a detail row
  const data = res?.ok && res.data?.approvalId ? res.data : null;
  const status = data?.status ?? '';

  useEffect(() => {
    if (status !== 'pending') return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  const handleCopy = useCallback(() => {
    const full = data?.approvalId ?? id;
    if (!full) return;
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (clip?.writeText) {
      clip.writeText(full).then(() => setCopyState('ok')).catch(() => setCopyState('fail'));
      return;
    }
    // no clipboard API: the id stays selectable and the full value in title
    setCopyState('fail');
  }, [data?.approvalId, id]);

  const isAuth = !!res && !res.ok && (res.code === 'console.unauthenticated' || res.status === 401);
  const isForbidden = !!res && !res.ok && (res.code === 'console.forbidden' || res.status === 403);
  const isMissing = !!res && !res.ok && res.status === 404;
  const isError = !!res && !res.ok && !isAuth && !isForbidden && !isMissing;
  const isEmpty = !!res && res.ok && !res.data?.approvalId;

  /* card §2: the countdown is the server number, nothing else. A payload
   * without remainingSeconds shows — (expiresAt stays title text only). */
  const remainingShown = useMemo(() => {
    const raw = data?.remainingSeconds;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
    if (status !== 'pending') return raw;
    const elapsed = Math.max(0, Math.floor((now - receivedAt) / 1000));
    return Math.max(0, raw - elapsed);
  }, [data?.remainingSeconds, status, now, receivedAt]);

  const changeKind = data?.binding?.changeKind ?? '';
  const projection = data?.detail ?? null;
  const changeDetail = projection?.changeDetail ?? null;
  const versionRows = projection?.versions ?? [];
  const decisions = data?.decisions ?? [];

  const grid = (items: MetaItem[]) => (
    <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap' }}>
      {items.map((it) => (
        <div
          key={it.testId}
          className="a2-card-item"
          data-testid={it.testId}
          title={it.title}
          style={{ flex: '1 1 180px', minWidth: 0 }}
        >
          <div className="a2-micro">{it.label}</div>
          <div className="a2-meta" style={{ overflowWrap: 'anywhere' }}>
            {it.value || '—'}
          </div>
        </div>
      ))}
    </div>
  );

  if (loading && !res) {
    return (
      <div className="a2s-page" data-testid="agent-v2-aprd">
        <div className="a2s-skeleton" data-testid="agent-v2-aprd-loading" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <span className="a2s-sk-row" key={i} />
          ))}
        </div>
      </div>
    );
  }

  /* Whole-page access states: 401 re-login, 403 forbidden, 404 one copy for
   * unknown AND cross-tenant (fail-closed), empty payload, everything else
   * localized block error + retry. Upstream codes are never rendered. */
  if (!data) {
    const state = isAuth
      ? { testId: 'agent-v2-aprd-unauthorized', title: t('agentConsole.auth.expired'), hint: t('agentConsole.v2.aprd.unauthorizedHint') }
      : isForbidden
        ? { testId: 'agent-v2-aprd-forbidden', title: t('agentConsole.v2.aprd.forbidden'), hint: t('agentConsole.v2.aprd.forbiddenHint') }
        : isMissing
          ? { testId: 'agent-v2-aprd-not-found', title: t('agentConsole.approvals.notFound'), hint: t('agentConsole.v2.aprd.notFoundHint') }
          : isEmpty
            ? { testId: 'agent-v2-aprd-empty', title: t('agentConsole.v2.aprd.empty'), hint: t('agentConsole.v2.aprd.emptyHint') }
            : { testId: 'agent-v2-aprd-error', title: t('agentConsole.v2.aprd.blockDetail'), hint: '' };
    return (
      <div className="a2s-page" data-testid="agent-v2-aprd">
        <div className="a2-card" data-testid={state.testId}>
          <h1 className="a2-h1">{state.title}</h1>
          {state.hint ? <p className="a2-card-sub">{state.hint}</p> : null}
          {isError ? (
            <>
              {/* G15 idiom: localized copy + HTTP status, never the code */}
              <p className="a2-meta" data-testid="agent-v2-aprd-detail-error">
                {t('agentConsole.v2.ov.blockUnavailable', {
                  block: t('agentConsole.v2.aprd.blockDetail'),
                  code: res?.status ?? 0,
                })}
              </p>
              <button type="button" className="a2-btn" data-testid="agent-v2-aprd-retry" onClick={handleRetry}>
                {t('agentConsole.v2.ov.retry')}
              </button>
            </>
          ) : null}
          <p className="a2-meta">
            <NavLink className="a2-btn" to="/agent/approvals" data-testid="agent-v2-aprd-back">
              {t('agentConsole.v2.aprd.back')}
            </NavLink>
          </p>
        </div>
      </div>
    );
  }

  const item = (labelKey: string, value: string, testId: string, title?: string): MetaItem => ({
    label: t(labelKey),
    value,
    testId,
    title,
  });
  const num = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '—');
  const iso = (v?: string | null): string => (v ? fmtTime(v) : '—');

  const metaItems = [
    item('agentConsole.approvals.requestedBy', refText(data.requestedBy), 'agent-v2-aprd-meta-requester'),
    item('agentConsole.approvals.onBehalfOf', refText(data.onBehalfOf), 'agent-v2-aprd-meta-behalf'),
    item(
      'agentConsole.approvals.approvers',
      (data.approvers ?? []).map((a) => `${a.userId ?? '—'}${a.role ? ` (${a.role})` : ''}`).join(' · '),
      'agent-v2-aprd-meta-approvers',
    ),
    item('agentConsole.approvals.requiredApprovals', num(data.requiredApprovals), 'agent-v2-aprd-meta-required'),
    item(
      'agentConsole.v2.aprd.ttl',
      typeof data.ttlSeconds === 'number' ? t('agentConsole.v2.aprd.ttlValue', { seconds: data.ttlSeconds }) : '—',
      'agent-v2-aprd-meta-ttl',
    ),
    /* expiresAt is title text only — the visible number is the server's
     * remainingSeconds, so a mismatch can never overwrite the countdown. */
    item(
      'agentConsole.v2.aprd.remainingLabel',
      remainingShown === null ? '—' : t('agentConsole.approvals.remaining', { seconds: remainingShown }),
      'agent-v2-aprd-meta-remaining',
      data.expiresAt ? fmtTime(data.expiresAt) : undefined,
    ),
    item('agentConsole.approvals.policyDecisionId', data.policyDecisionId ?? '—', 'agent-v2-aprd-meta-policy'),
    item('agentConsole.v2.aprd.argsDigest', data.argsDigest ?? '—', 'agent-v2-aprd-meta-digest'),
    item('agentConsole.approvals.createdAt', iso(data.createdAt), 'agent-v2-aprd-meta-created'),
  ];

  const bindingItems = [
    item('agentConsole.approvals.binding', data.binding?.subjectType ?? '—', 'agent-v2-aprd-binding-subject-type'),
    item('agentConsole.approvals.subjectId', data.binding?.subjectId ?? '—', 'agent-v2-aprd-binding-subject-id'),
    item('agentConsole.approvals.changeKind', changeKind || '—', 'agent-v2-aprd-binding-kind'),
    // targetHash appears only because the server sent it (never derived)
    ...(hasValue(data.binding?.targetHash)
      ? [item('agentConsole.approvals.targetHash', String(data.binding?.targetHash), 'agent-v2-aprd-binding-hash')]
      : []),
  ];

  const verdictText = hasValue(data.verdict)
    ? `${t(`agentConsole.approvals.verdict.${String(data.verdict)}`, String(data.verdict))}${
        data.decidedAt ? ` · ${fmtTime(data.decidedAt)}` : ''
      }`
    : '';
  // rows appear only for the terminal fields the server actually sent
  const terminalItems = [
    ...(verdictText ? [item('agentConsole.v2.aprd.finalVerdict', verdictText, 'agent-v2-aprd-terminal-verdict')] : []),
    ...(hasValue(data.consumedAt)
      ? [item('agentConsole.approvals.consumedAt', iso(String(data.consumedAt)), 'agent-v2-aprd-terminal-consumed')]
      : []),
    ...(hasValue(data.supersededBy)
      ? [item('agentConsole.v2.aprd.supersededBy', String(data.supersededBy), 'agent-v2-aprd-terminal-superseded')]
      : []),
  ];

  const diffItems: MetaItem[] = changeDetail
    ? sixKeyRows(changeDetail).map((r) => ({ label: t(`agentConsole.v2.aprd.${r.key}`), value: r.value, testId: r.testId }))
    : [];

  return (
    <div className="a2s-page" data-testid="agent-v2-aprd">
      {/* ---------- 1. header: id (truncated + copyable), status, risk, type */}
      <div className="a2-card-head" style={{ alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <h1 className="a2-h1" data-testid="agent-v2-aprd-heading">
              {t('agentConsole.v2.aprd.heading')}
            </h1>
            <span className="a2-mono" data-testid="agent-v2-aprd-id" title={data.approvalId} style={{ userSelect: 'all' }}>
              {fmtId(data.approvalId)}
            </span>
            <button
              type="button"
              className="a2-btn"
              data-testid="agent-v2-aprd-copy"
              title={data.approvalId}
              onClick={handleCopy}
            >
              {t('agentConsole.v2.aprd.copyId')}
            </button>
            <span className="a2-micro" data-testid="agent-v2-aprd-copy-state">
              {copyState === 'idle' ? '' : t(COPY_TEXT[copyState])}
            </span>
          </div>
          <p className="a2-meta" data-testid="agent-v2-aprd-kind">
            {t('agentConsole.approvals.changeKind')} {changeKind || '—'}
          </p>
        </div>
        <p className="a2-meta">
          <NavLink className="a2-btn" to="/agent/approvals" data-testid="agent-v2-aprd-back">
            {t('agentConsole.v2.aprd.back')}
          </NavLink>
        </p>
      </div>

      <div className="a2-chips" style={{ marginBottom: 12 }}>
        <span className="a2-pill" data-testid="agent-v2-aprd-status">
          {t(`agentConsole.approvals.status.${statusKey(status)}`, status || '—')}
        </span>
        <span className={`a2-pill ${riskTone(data.riskLevel ?? '')}`} data-testid="agent-v2-aprd-risk">
          <span className="a2-pill-dot" aria-hidden />
          {t(`agentConsole.approvals.risk.${data.riskLevel ?? ''}`, data.riskLevel ?? '—')}
        </span>
        <span className="a2-pill" data-testid="agent-v2-aprd-type">
          {t('agentConsole.approvals.type')} {data.type || '—'}
        </span>
        <span className="a2-pill" data-testid="agent-v2-aprd-action">
          {t('agentConsole.approvals.action')} {data.action || '—'}
        </span>
      </div>

      {/* ---------- 2. metadata + binding ---------- */}
      <div className="a2-card" data-testid="agent-v2-aprd-meta">
        <h2 className="a2-h2">{t('agentConsole.v2.aprd.sectionMeta')}</h2>
        {grid(metaItems)}
        <p className="a2-micro" data-testid="agent-v2-aprd-remaining-foot">
          {t('agentConsole.v2.aprd.remainingFoot')}
        </p>
        <div className="a2-card-item" data-testid="agent-v2-aprd-reason">
          <div className="a2-micro">{t('agentConsole.approvals.reasonText')}</div>
          <p className="a2-meta" style={{ overflowWrap: 'anywhere' }}>
            {data.reasonText || '—'}
          </p>
        </div>
      </div>

      <div className="a2-card" data-testid="agent-v2-aprd-binding" style={{ marginTop: 12 }}>
        <h2 className="a2-h2">{t('agentConsole.v2.aprd.sectionBinding')}</h2>
        {grid(bindingItems)}
      </div>

      {/* ---------- 3. change detail, branched by changeKind ---------- */}
      <div className="a2-card" data-testid="agent-v2-aprd-change" style={{ marginTop: 12 }}>
        <h2 className="a2-h2">{t('agentConsole.v2.aprd.sectionChange')}</h2>
        {changeKind === 'employee_version_create' && changeDetail ? (
          <>
            <p className="a2-meta" data-testid="agent-v2-aprd-diff-head">
              {t('agentConsole.v2.aprd.k_fromVersionId')}{' '}
              <span className="a2-mono">{scalarText(changeDetail.fromVersionId)}</span> →{' '}
              {t('agentConsole.v2.aprd.k_toVersionNo')}{' '}
              <span className="a2-mono">{scalarText(changeDetail.toVersionNo)}</span>
            </p>
            {grid(diffItems)}
            {versionRows.length > 0 ? (
              <div className="a2-table-scroll" style={{ marginTop: 8 }}>
                <table className="a2-table" data-testid="agent-v2-aprd-versions">
                  <thead>
                    <tr>
                      <th>{t('agentConsole.v2.aprd.versionsColNo')}</th>
                      <th>{t('agentConsole.v2.aprd.versionsColState')}</th>
                      <th>{t('agentConsole.approvals.effectiveFrom')}</th>
                      <th>{t('agentConsole.v2.aprd.versionsColKnowledge')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versionRows.map((v, i) => (
                      <tr key={v.versionNo ?? i} data-testid="agent-v2-aprd-version-row">
                        <td className="a2-mono">{typeof v.versionNo === 'number' ? `v${v.versionNo}` : '—'}</td>
                        <td>
                          {v.status === 'current'
                            ? t('agentConsole.v2.aprd.versionCurrent')
                            : v.status === 'superseded'
                              ? t('agentConsole.v2.aprd.versionSuperseded')
                              : '—'}
                        </td>
                        <td className="a2-cell-nowrap">{v.effectiveFrom ? fmtTime(v.effectiveFrom) : '—'}</td>
                        <td className="a2-cell-nowrap">
                          {typeof v.knowledgeCount === 'number'
                            ? t('agentConsole.v2.aprd.knowledgeCount', { count: v.knowledgeCount })
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="a2-micro" data-testid="agent-v2-aprd-versions-empty">
                {t('agentConsole.v2.aprd.unavailable')}
              </p>
            )}
          </>
        ) : changeKind === 'employee_version_create' ? (
          /* projection absent = the targetHash gate did not pass (or the
             running domain predates CR-043): honest 不可得, no client diff */
          <p className="a2-meta" data-testid="agent-v2-aprd-change-unavailable">
            {t('agentConsole.v2.aprd.unavailable')}
          </p>
        ) : changeKind === 'message_send' ? (
          <p className="a2-meta" data-testid="agent-v2-aprd-change-digest-only">
            {t('agentConsole.v2.aprd.digestOnly')}
          </p>
        ) : (
          <p className="a2-meta" data-testid="agent-v2-aprd-change-contract">
            {t('agentConsole.v2.aprd.contractUndefined')}
          </p>
        )}
      </div>

      {/* ---------- 4. decision history ---------- */}
      <div className="a2-card" data-testid="agent-v2-aprd-decisions" style={{ marginTop: 12 }}>
        <h2 className="a2-h2">{t('agentConsole.approvals.decisions')}</h2>
        {decisions.length === 0 ? (
          <p className="a2-meta" data-testid="agent-v2-aprd-decisions-empty">
            {t('agentConsole.approvals.decisionsEmpty')}
          </p>
        ) : (
          decisions.map((d, i) => (
            <div
              key={`${d.userId ?? 'd'}-${d.decidedAt ?? i}`}
              className="a2-card-item"
              data-testid="agent-v2-aprd-decision-row"
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span className="a2-pill" data-testid="agent-v2-aprd-decision-verdict">
                  {t(`agentConsole.approvals.verdict.${d.verdict ?? ''}`, d.verdict ?? '—')}
                </span>
                <span className="a2-mono">{d.userId ?? '—'}</span>
                <span className="a2-micro">{d.decidedAt ? fmtTime(d.decidedAt) : '—'}</span>
              </div>
              {hasValue(d.comment) ? (
                <p className="a2-meta" data-testid="agent-v2-aprd-decision-comment" style={{ overflowWrap: 'anywhere' }}>
                  {String(d.comment)}
                </p>
              ) : null}
              {hasValue(d.consumedAt) ? (
                <p className="a2-micro" data-testid="agent-v2-aprd-decision-consumed">
                  {t('agentConsole.approvals.consumedAt')} {fmtTime(String(d.consumedAt))}
                </p>
              ) : null}
            </div>
          ))
        )}
        {terminalItems.length > 0 ? grid(terminalItems) : null}
      </div>

      {/* ---------- 5. actions: ALL disabled this wave (no AP2 wiring) ------ */}
      <div className="a2-card" data-testid="agent-v2-aprd-actions" style={{ marginTop: 12 }}>
        <h2 className="a2-h2">{t('agentConsole.v2.aprd.sectionActions')}</h2>
        <div className="a2-card-actions">
          {DECIDE_VERBS.map((verb) => (
            <button
              key={verb}
              type="button"
              className="a2-btn"
              data-testid={`agent-v2-aprd-decide-${verb}`}
              disabled
              title={t('agentConsole.v2.aprd.readonlyNote')}
            >
              {t(`agentConsole.approvals.verdict.${verb}`)}
            </button>
          ))}
        </div>
        <p className="a2-micro" data-testid="agent-v2-aprd-actions-note">
          {t('agentConsole.v2.aprd.readonlyNote')}
        </p>
      </div>
    </div>
  );
}
