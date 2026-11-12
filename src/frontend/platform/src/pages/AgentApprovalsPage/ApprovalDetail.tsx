import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, StateView, Tag } from '@bisheng/ui';
import { LoadingIcon } from '@/components/bs-icons/loading';
import type {
  AgentApprovalsApi,
  Approval,
} from '@/controllers/API/agentConsoleApprovals';
import { effectiveApprovalStatus } from '@/controllers/API/agentConsoleApprovals';
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
  /** The AP4 row that opened this view; used only when the BFF has no AP3 route. */
  approval: Approval;
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
 * Read-only AP3 detail. Cross-tenant / unknown ids collapse into a single
 * "not found or not visible" state (the domain 404 is identical for both).
 * No verdict controls exist anywhere on this page (S10b-6 owns writes).
 */
export function ApprovalDetail({ api, approval }: ApprovalDetailProps) {
  const { t } = useTranslation();
  const enumLabel = useEnumLabel();
  const [view, setView] = useState<DetailView>({ kind: 'loading' });

  const load = useCallback(async () => {
    setView({ kind: 'loading' });
    try {
      const fresh = await api.getApproval(approval.approvalId, approval);
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
    </div>
  );
}
