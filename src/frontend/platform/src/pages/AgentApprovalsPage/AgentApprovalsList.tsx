import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Select, StateView, Tag } from '@bisheng/ui';
import type { SelectValue } from '@bisheng/ui';
import { useSelectLabels } from '@/components/bs-comp/formFields/useSelectLabels';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/bs-ui/table';
import { LoadingIcon } from '@/components/bs-icons/loading';
import type {
  AgentApprovalsApi,
  Approval,
  ApprovalQueryFilter,
} from '@/controllers/API/agentConsoleApprovals';
import {
  effectiveApprovalStatus,
} from '@/controllers/API/agentConsoleApprovals';
import { AuthError, UpstreamError } from '@/controllers/API/agent';

export interface AgentApprovalsListProps {
  api: AgentApprovalsApi;
  /** Literal assignee key `human:<user_id>`; queries are never unfiltered. */
  assignee: string;
  /** AP4 default page size is 20; overridable for tests. */
  pageSize?: number;
  onSelect(row: Approval): void;
}

const APPROVAL_FILTER_LABEL_KEYS: Record<string, string> = {
  pending: 'agentConsole.approvals.status.pending',
  expired: 'agentConsole.approvals.status.expired',
};

export const APPROVAL_STATUS_LABEL_KEYS: Record<string, string> = {
  pending: 'agentConsole.approvals.status.pending',
  approved: 'agentConsole.approvals.status.approved',
  rejected: 'agentConsole.approvals.status.rejected',
  revise_requested: 'agentConsole.approvals.status.reviseRequested',
  expired: 'agentConsole.approvals.status.expired',
  cancelled: 'agentConsole.approvals.status.cancelled',
  consumed: 'agentConsole.approvals.status.consumed',
  superseded: 'agentConsole.approvals.status.superseded',
};

/**
 * Approval status colours are not part of the frozen §5.7 maps (lifecycle /
 * task / run / outcome); this uses existing Tag semantics only, no new tokens:
 * an open to-do reads brand, everything settled or expired reads default.
 */
export function approvalStatusTagColor(
  status: string,
): 'brand' | 'default' {
  return status === 'pending' ? 'brand' : 'default';
}

export function approvalRiskTagColor(
  risk: string,
): 'default' | 'warning' | 'danger' {
  switch (risk) {
    case 'high':
      return 'danger';
    case 'medium':
      return 'warning';
    default:
      return 'default';
  }
}

export const APPROVAL_RISK_LABEL_KEYS: Record<string, string> = {
  low: 'agentConsole.approvals.risk.low',
  medium: 'agentConsole.approvals.risk.medium',
  high: 'agentConsole.approvals.risk.high',
};

export function useEnumLabel() {
  const { t } = useTranslation();
  return (keys: Record<string, string>, value: string) =>
    keys[value] ? t(keys[value]) : value;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').replace('Z', '');
}

/**
 * Read-only pending-expiry queue (AP4). Always queried with
 * assignee=human:<user_id>; an optional status filter narrows to the two
 * buckets the page offers and stays server-side. Expired rows must read as
 * expired (domain _effective_status), never as pending.
 */
export function AgentApprovalsList({
  api,
  assignee,
  pageSize = 20,
  onSelect,
}: AgentApprovalsListProps) {
  const { t } = useTranslation();
  const selectLabels = useSelectLabels();
  const enumLabel = useEnumLabel();
  const [statusFilter, setStatusFilter] = useState<ApprovalQueryFilter | null>(
    null,
  );
  const [rows, setRows] = useState<Approval[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<{ code?: string } | null>(null);
  const reqSeq = useRef(0);

  const load = useCallback(
    async (status: ApprovalQueryFilter | null, cursor?: string) => {
      const seq = ++reqSeq.current;
      setLoading(true);
      try {
        const res = await api.listApprovals({
          assignee,
          status: status ?? undefined,
          limit: pageSize,
          cursor,
        });
        if (seq !== reqSeq.current) return;
        setError(null);
        setRows((prev) => (cursor ? [...prev, ...res.items] : res.items));
        setNextCursor(res.nextCursor);
      } catch (err) {
        if (seq !== reqSeq.current) return;
        setError({
          code:
            err instanceof AuthError
              ? 'agent.auth.expired'
              : err instanceof UpstreamError && err.message
                ? err.message
                : 'agent.approvals.request_failed',
        });
      } finally {
        if (seq === reqSeq.current) {
          setLoading(false);
          setLoaded(true);
        }
      }
    },
    [api, assignee, pageSize],
  );

  useEffect(() => {
    void load(statusFilter, undefined);
  }, [statusFilter, load]);

  const handleLoadMore = () => {
    if (nextCursor) void load(statusFilter, nextCursor);
  };

  const statusOptions = (
    ['pending', 'expired'] as ApprovalQueryFilter[]
  ).map((s) => ({ value: s, label: enumLabel(APPROVAL_FILTER_LABEL_KEYS, s) }));

  return (
    <div className="w-full max-w-full">
      <div className="mb-3 w-[200px]">
        <Select
          {...selectLabels}
          options={statusOptions}
          value={statusFilter ?? undefined}
          allowClear
          size="small"
          placeholder={t('agentConsole.approvals.filterStatus')}
          aria-label={t('agentConsole.approvals.filterStatus')}
          onChange={(v: SelectValue | null) =>
            setStatusFilter(
              v == null ? null : (String(v) as ApprovalQueryFilter),
            )
          }
        />
      </div>
      <div className="relative w-full" aria-busy={loading}>
        {loading && rows.length === 0 && (
          <div
            data-testid="agent-approvals-loading"
            className="absolute w-full h-full top-0 left-0 flex justify-center items-center z-10 bg-[rgba(255,255,255,0.6)] dark:bg-blur-shared"
          >
            <LoadingIcon />
          </div>
        )}
        {error ? (
          error.code === 'agent.auth.expired' ? (
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
          ) : (
            <StateView
              title={t('agentConsole.approvals.error')}
              description={error.code ?? ''}
              action={
                <Button
                  variant="outlined"
                  onClick={() => void load(statusFilter)}
                >
                  {t('agentConsole.list.retry')}
                </Button>
              }
            />
          )
        ) : rows.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[220px]">{t('agentConsole.approvals.colId')}</TableHead>
                  <TableHead className="w-[180px]">{t('agentConsole.approvals.colAction')}</TableHead>
                  <TableHead className="w-[160px]">{t('agentConsole.approvals.colChangeKind')}</TableHead>
                  <TableHead className="w-[180px]">{t('agentConsole.approvals.colSubject')}</TableHead>
                  <TableHead className="w-[100px]">{t('agentConsole.approvals.colRisk')}</TableHead>
                  <TableHead className="w-[200px]">{t('agentConsole.approvals.colExpires')}</TableHead>
                  <TableHead className="w-[110px]">{t('agentConsole.approvals.colStatus')}</TableHead>
                  <TableHead className="w-[80px] text-right">{t('agentConsole.list.colAction')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const status = effectiveApprovalStatus(row);
                  return (
                    <TableRow key={row.approvalId} data-testid={`agent-approval-row-${row.approvalId}`}>
                      <TableCell className="max-w-[220px] min-w-0">
                        {/* Wrap instead of ellipsis: reviewers must be able to
                            read the full approvalId from the list screenshot. */}
                        <div className="break-all" title={row.approvalId}>
                          {row.approvalId}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[180px] min-w-0">
                        <div className="truncate" title={row.action}>
                          {row.action}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[160px] min-w-0">
                        <div className="break-all">{row.binding.changeKind}</div>
                      </TableCell>
                      <TableCell className="max-w-[180px] min-w-0">
                        <div className="break-all">{row.binding.subjectId}</div>
                      </TableCell>
                      <TableCell>
                        <Tag color={approvalRiskTagColor(row.riskLevel)}>
                          {enumLabel(APPROVAL_RISK_LABEL_KEYS, row.riskLevel)}
                        </Tag>
                      </TableCell>
                      <TableCell className="max-w-[200px] min-w-0">
                        <div className="break-all">{formatTime(row.expiresAt)}</div>
                        <div className="text-text-3">
                          {t('agentConsole.approvals.remaining', {
                            seconds: row.remainingSeconds,
                          })}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Tag color={approvalStatusTagColor(status)}>
                          {enumLabel(APPROVAL_STATUS_LABEL_KEYS, status)}
                        </Tag>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <Button
                            size="small"
                            variant="link"
                            onClick={() => onSelect(row)}
                          >
                            {t('agentConsole.list.detail')}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {loading && (
              <div className="flex justify-center py-2">
                <LoadingIcon className="size-8" />
              </div>
            )}
            {nextCursor && !loading && (
              <div className="flex justify-center py-2">
                <Button variant="filled" onClick={handleLoadMore}>
                  {t('agentConsole.list.loadMore')}
                </Button>
              </div>
            )}
          </>
        ) : loaded ? (
          <StateView
            title={t('agentConsole.approvals.empty')}
            description={t('agentConsole.approvals.emptyHint')}
          />
        ) : null}
      </div>
    </div>
  );
}
