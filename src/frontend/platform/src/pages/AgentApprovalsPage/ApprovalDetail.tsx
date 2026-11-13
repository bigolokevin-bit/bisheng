import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, StateView, Tag } from '@bisheng/ui';
import { LoadingIcon } from '@/components/bs-icons/loading';
import type {
  AgentApprovalsApi,
  Approval,
} from '@/controllers/API/agentConsoleApprovals';
import {
  approvalWriteEnabled,
  effectiveApprovalStatus,
} from '@/controllers/API/agentConsoleApprovals';
import type { ApprovalDecisionVerdict } from '@/controllers/API/agentConsoleApprovals';
import { AuthError, UpstreamError } from '@/controllers/API/agent';
import {
  APPROVAL_RISK_LABEL_KEYS,
  APPROVAL_STATUS_LABEL_KEYS,
  approvalRiskTagColor,
  approvalStatusTagColor,
  useEnumLabel,
} from './AgentApprovalsList';

export interface ApprovalDetailProps {
  api: AgentApprovalsApi;
  /** The AP4 row selected in the list; the view re-loads it through AP3. */
  approval: Approval;
  /** 'human:<id>' literal of the current Bisheng user (S10b-6 p2 gating). */
  currentHumanId?: string;
}

type DetailView =
  | { kind: 'loading' }
  | { kind: 'notFound' }
  | { kind: 'ready'; approval: Approval }
  | { kind: 'error'; code?: string };

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').replace('Z', '');
}

/** Renders a domain reference object ({ type, id }) as one readable line. */
function refText(ref: { type: string; id: string } | null | undefined): string {
  return ref ? `${ref.type} · ${ref.id}` : '—';
}

/**
 * AP3 detail plus the S10b-6 approval write area. Cross-tenant / unknown ids
 * collapse into a single "not found or not visible" state (the domain 404 is
 * identical for both). Verdict controls render only when approvalWriteEnabled()
 * (VITE_AGENT_APPROVAL_WRITE=1 build) and the current user is a pending
 * approver without a ballot yet; with the flag off the DOM is byte-identical
 * to the read-only page. The BFF CONSOLE_APPROVAL_WRITE_ENABLED switch is the
 * second, server-side gate. Failures never optimistically update the ballots.
 */
export function ApprovalDetail({ api, approval, currentHumanId }: ApprovalDetailProps) {
  const { t } = useTranslation();
  const enumLabel = useEnumLabel();
  const [view, setView] = useState<DetailView>({ kind: 'loading' });
  const load = useCallback(async () => {
    setView({ kind: 'loading' });
    try {
      const fresh = await api.getApproval(approval.approvalId);
      setView(fresh ? { kind: 'ready', approval: fresh } : { kind: 'notFound' });
    } catch (err) {
      setView({
        kind: 'error',
        code:
          err instanceof AuthError
            ? 'agent.auth.expired'
            : err instanceof UpstreamError && err.message
              ? err.message
              : 'agent.approvals.request_failed',
      });
    }
  }, [api, approval]);

  useEffect(() => {
    void load();
  }, [load]);
  // S10b-6 p2 write controls (ticket §1/§4). Server stays the only source for
  // ballots: a accepted decision refreshes through load(), errors map to copy.
  const [verdict, setVerdict] = useState<ApprovalDecisionVerdict | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [writeError, setWriteError] = useState<string | undefined>(undefined);

  const resetWriteState = useCallback(() => {
    setVerdict(null);
    setComment('');
    setWriteError(undefined);
  }, []);

  const submitDecision = useCallback(async () => {
    if (!api.decideApproval || !verdict || submitting) {
      return;
    }
    if (view.kind !== 'ready' || effectiveApprovalStatus(view.approval) !== 'pending') {
      return;
    }
    setSubmitting(true);
    setWriteError(undefined);
    try {
      await api.decideApproval(approval.approvalId, {
        verdict,
        comment: comment.trim() || undefined,
      });
      resetWriteState();
      await load();
    } catch (err) {
      const code = err instanceof UpstreamError ? err.message : '';
      if (code === 'console.read_only') {
        // BFF write switch off: the server flag is the source of truth, so we
        // show honest copy and keep the area mounted (no client lockout).
        setWriteError('agentConsole.approvals.write.disabled');
      } else if (code === 'approval.already_decided') {
        setWriteError('agentConsole.approvals.write.alreadyDecided');
        await load();
      } else if (code === 'approval.expired') {
        setWriteError('agentConsole.approvals.write.expired');
        await load();
      } else if (code === 'approval.not_approver') {
        setWriteError('agentConsole.approvals.write.notApprover');
      } else if (code === 'request.invalid_body') {
        setWriteError('agentConsole.approvals.write.invalidBody');
      } else if (code === 'approval.unavailable') {
        setWriteError('agentConsole.approvals.write.unavailable');
      } else if (
        code === 'approval.service_unavailable' ||
        code === 'upstream.unavailable' ||
        /^agent\.http\.5/.test(code)
      ) {
        setWriteError('agentConsole.approvals.write.unavailableService');
      } else {
        setWriteError('agentConsole.approvals.write.failed');
      }
    } finally {
      setSubmitting(false);
    }
  }, [api, approval.approvalId, verdict, comment, submitting, load, resetWriteState, view]);



  if (view.kind === 'loading') {
    return (
      <div
        data-testid="agent-approval-loading"
        className="relative w-full py-10 flex justify-center items-center"
        aria-busy="true"
      >
        <LoadingIcon />
      </div>
    );
  }
  if (view.kind === 'notFound') {
    return <StateView title={t('agentConsole.approvals.notFound')} />;
  }
  if (view.kind === 'error') {
    if (view.code === 'agent.auth.expired') {
      return (
        <StateView
          title={t('agentConsole.auth.expired')}
          action={
            <Button
              variant="outlined"
              onClick={() => window.location.assign('/login')}
            >
              {t('agentConsole.auth.relogin')}
            </Button>
          }
        />
      );
    }
    return (
      <StateView
        title={t('agentConsole.approvals.error')}
        description={view.code ?? ''}
        action={
          <Button variant="outlined" onClick={() => void load()}>
            {t('agentConsole.list.retry')}
          </Button>
        }
      />
    );
  }

  const row = view.approval;
  const status = effectiveApprovalStatus(row);

  // Visibility conjunction: build flag, an api that exposes the write member,
  // pending status, membership in approvers[], and no ballot yet from this
  // user. A server-side flag gap is handled by the 405 mapping on submit.
  const canVote =
    approvalWriteEnabled() &&
    typeof api.decideApproval === 'function' &&
    status === 'pending' &&
    Boolean(currentHumanId) &&
    row.approvers.some((a) => a.userId === currentHumanId) &&
    !row.decisions.some((d) => d.userId === currentHumanId);

  return (
    <div
      className="w-full max-w-full text-sm"
      data-testid="agent-approval-detail"
    >
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-text-2">{t('agentConsole.approvals.approvalId')}</dt>
        <dd className="min-w-0 break-all">{row.approvalId}</dd>

        <dt className="text-text-2">{t('agentConsole.approvals.colStatus')}</dt>
        <dd>
          <Tag color={approvalStatusTagColor(status)}>
            {enumLabel(APPROVAL_STATUS_LABEL_KEYS, status)}
          </Tag>
        </dd>

        <dt className="text-text-2">{t('agentConsole.approvals.type')}</dt>
        <dd className="min-w-0 break-all">{row.type}</dd>

        <dt className="text-text-2">{t('agentConsole.approvals.action')}</dt>
        <dd className="min-w-0 break-all">{row.action}</dd>

        <dt className="text-text-2">{t('agentConsole.approvals.colRisk')}</dt>
        <dd>
          <Tag color={approvalRiskTagColor(row.riskLevel)}>
            {enumLabel(APPROVAL_RISK_LABEL_KEYS, row.riskLevel)}
          </Tag>
        </dd>

        <dt className="text-text-2">{t('agentConsole.approvals.binding')}</dt>
        <dd className="min-w-0 break-all">{row.binding.subjectType}</dd>

        <dt className="text-text-2">{t('agentConsole.approvals.subjectId')}</dt>
        <dd className="min-w-0 break-all">{row.binding.subjectId}</dd>

        <dt className="text-text-2">{t('agentConsole.approvals.changeKind')}</dt>
        <dd className="min-w-0 break-all">{row.binding.changeKind}</dd>

        <dt className="text-text-2">{t('agentConsole.approvals.targetHash')}</dt>
        <dd className="min-w-0 break-all">{row.binding.targetHash}</dd>

        <dt className="text-text-2">{t('agentConsole.approvals.effectiveFrom')}</dt>
        <dd className="min-w-0 break-all">
          {formatTime(row.binding.effectiveFrom)}
        </dd>

        <dt className="text-text-2">{t('agentConsole.approvals.requestedBy')}</dt>
        <dd className="min-w-0 break-all">{refText(row.requestedBy)}</dd>

        <dt className="text-text-2">{t('agentConsole.approvals.onBehalfOf')}</dt>
        <dd className="min-w-0 break-all">{refText(row.onBehalfOf)}</dd>

        <dt className="text-text-2">{t('agentConsole.approvals.reasonText')}</dt>
        <dd className="min-w-0 break-all">{row.reasonText ?? '—'}</dd>

        <dt className="text-text-2">{t('agentConsole.approvals.approvers')}</dt>
        <dd className="min-w-0">
          {row.approvers.map((a) => (
            <div key={a.userId} className="break-all">
              {a.role ? `${a.userId} · ${a.role}` : a.userId}
            </div>
          ))}
        </dd>

        <dt className="text-text-2">
          {t('agentConsole.approvals.requiredApprovals')}
        </dt>
        <dd className="oc-num">{row.requiredApprovals}</dd>

        <dt className="text-text-2">{t('agentConsole.approvals.decisions')}</dt>
        <dd className="min-w-0">
          {row.decisions.length === 0 ? (
            t('agentConsole.approvals.decisionsEmpty')
          ) : (
            row.decisions.map((d, i) => (
              <div key={`${d.userId}-${i}`} className="break-all">
                {`${d.userId} · ${enumLabel(
                  {
                    approve: 'agentConsole.approvals.verdict.approve',
                    reject: 'agentConsole.approvals.verdict.reject',
                    revise: 'agentConsole.approvals.verdict.revise',
                  },
                  d.verdict,
                )} · ${d.comment ?? '—'} · ${formatTime(d.decidedAt)}`}
              </div>
            ))
          )}
        </dd>

        <dt className="text-text-2">{t('agentConsole.approvals.expiresAt')}</dt>
        <dd className="min-w-0 break-all">
          {formatTime(row.expiresAt)}
          <span className="ml-2 text-text-3">
            {t('agentConsole.approvals.remaining', {
              seconds: row.remainingSeconds,
            })}
          </span>
        </dd>

        <dt className="text-text-2">{t('agentConsole.approvals.consumedAt')}</dt>
        <dd className="min-w-0 break-all">{formatTime(row.consumedAt)}</dd>

        <dt className="text-text-2">
          {t('agentConsole.approvals.policyDecisionId')}
        </dt>
        <dd className="min-w-0 break-all">{row.policyDecisionId ?? '—'}</dd>

        <dt className="text-text-2">{t('agentConsole.approvals.runId')}</dt>
        <dd className="min-w-0 break-all">{row.runId ?? '—'}</dd>

        <dt className="text-text-2">{t('agentConsole.approvals.createdAt')}</dt>
        <dd className="min-w-0 break-all">{formatTime(row.createdAt)}</dd>
      </dl>
      {canVote && (
        <div data-testid="agent-approval-write" className="mt-4 space-y-3 border-t border-border pt-4">
          <div role="group" className="flex items-center gap-2 flex-wrap">
            {(['approve', 'reject', 'revise'] as const).map((v) => (
              <Button
                key={v}
                variant="link"
                aria-pressed={verdict === v}
                disabled={submitting}
                onClick={() => {
                  setWriteError(undefined);
                  setVerdict(v);
                }}
              >
                {t(`agentConsole.approvals.verdict.${v}`)}
              </Button>
            ))}
          </div>
          <textarea
            aria-label={t('agentConsole.approvals.write.commentPlaceholder')}
            value={comment}
            rows={3}
            disabled={submitting}
            placeholder={t('agentConsole.approvals.write.commentPlaceholder')}
            onChange={(e) => setComment(e.target.value)}
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
          />
          <Button
            variant="primary"
            disabled={!verdict || submitting}
            onClick={() => void submitDecision()}
          >
            {t('agentConsole.approvals.write.submit')}
          </Button>
          {writeError && (
            <p data-testid="agent-approval-write-error" className="text-text-3 text-xs break-all">
              {t(writeError)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
