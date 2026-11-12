import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, StateView, Tag } from '@bisheng/ui';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/bs-ui/table';
import { LoadingIcon } from '@/components/bs-icons/loading';
import type { AgentConsoleApi, Run } from '@/controllers/API/agent';
import { AuthError, UpstreamError } from '@/controllers/API/agent';

export interface AgentRunsTabProps {
  api: AgentConsoleApi;
  employeeId: string;
  /** R5 page size; overridable for tests. */
  pageSize?: number;
}

/**
 * Frozen §5.7 map for run status. The contract names `succeeded` while live
 * R5 data uses `completed`; both map to success so either spelling renders.
 */
export function runTagColor(
  status: string,
): 'brand' | 'warning' | 'success' | 'danger' | 'default' {
  switch (status) {
    case 'completed':
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'danger';
    case 'pending':
    case 'running':
      return 'brand';
    case 'interrupted':
      return 'warning';
    case 'cancelled':
    default:
      return 'default';
  }
}

const RUN_STATUS_LABEL_KEYS: Record<string, string> = {
  pending: 'agentConsole.runs.status.pending',
  running: 'agentConsole.runs.status.running',
  completed: 'agentConsole.runs.status.completed',
  succeeded: 'agentConsole.runs.status.completed',
  failed: 'agentConsole.runs.status.failed',
  cancelled: 'agentConsole.runs.status.cancelled',
  interrupted: 'agentConsole.runs.status.interrupted',
};

/** Known enum -> localized label; unknown values render verbatim (never guessed). */
function useEnumLabel() {
  const { t } = useTranslation();
  return (keys: Record<string, string>, value: string) =>
    keys[value] ? t(keys[value]) : value;
}

const formatTime = (iso: string | null) =>
  iso ? iso.replace('T', ' ').replace('Z', '') : '—';

/**
 * Read-only run list (R5). Always filtered by employeeId (no unfiltered
 * query), keyset cursor "load more" like AgentListPage. costUsd is a raw
 * upstream figure: the column header carries the 口径 annotation and rows
 * show `0.00` truthfully — nothing is aggregated client-side (BudgetNote
 * owns the "aggregate pending contract" stance).
 */
export function AgentRunsTab({ api, employeeId, pageSize = 20 }: AgentRunsTabProps) {
  const { t } = useTranslation();
  const enumLabel = useEnumLabel();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rows, setRows] = useState<Run[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<{ code?: string } | null>(null);
  const reqSeq = useRef(0);

  const load = useCallback(
    async (cursor?: string) => {
      const seq = ++reqSeq.current;
      setLoading(true);
      try {
        const res = await api.listRuns({ employeeId, limit: pageSize, cursor });
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
                : 'agent.runs.request_failed',
        });
      } finally {
        if (seq === reqSeq.current) {
          setLoading(false);
          setLoaded(true);
        }
      }
    },
    [api, employeeId, pageSize],
  );

  useEffect(() => {
    void load(undefined);
  }, [load]);

  const handleLoadMore = () => {
    if (nextCursor) void load(nextCursor);
  };

  return (
    <div className="w-full max-w-full">
      <div className="relative w-full" aria-busy={loading}>
        {loading && rows.length === 0 && (
          <div
            data-testid="agent-runs-loading"
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
              title={t('agentConsole.runs.error')}
              description={error.code ?? ''}
              action={
                <Button variant="outlined" onClick={() => void load()}>
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
                  <TableHead className="w-[200px]">{t('agentConsole.runs.colRunId')}</TableHead>
                  <TableHead className="w-[120px]">{t('agentConsole.runs.colStatus')}</TableHead>
                  <TableHead className="w-[110px]">{t('agentConsole.runs.colVersion')}</TableHead>
                  <TableHead className="w-[240px]">{t('agentConsole.runs.colTime')}</TableHead>
                  <TableHead className="w-[150px]">{t('agentConsole.runs.colCostUsd')}</TableHead>
                  <TableHead className="w-[80px] text-right">{t('agentConsole.list.colAction')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((run) => {
                  const expanded = expandedId === run.runId;
                  return (
                    <Fragment key={run.runId}>
                      <TableRow>
                        <TableCell className="max-w-[200px] min-w-0">
                          <div className="truncate" title={run.runId}>
                            {run.runId}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Tag color={runTagColor(run.status)}>
                            {enumLabel(RUN_STATUS_LABEL_KEYS, run.status)}
                          </Tag>
                        </TableCell>
                        <TableCell>
                          {t('agentConsole.runs.versionNo', {
                            no: run.employeeVersionNo,
                          })}
                        </TableCell>
                        <TableCell className="max-w-[240px] min-w-0">
                          <div className="break-all">
                            {formatTime(run.startedAt)}
                            {' → '}
                            {formatTime(run.endedAt)}
                          </div>
                        </TableCell>
                        <TableCell>
                          {/* §5.6: each raw per-run figure is followed by its
                              口径 label in the same cell — never a bare number,
                              never a client-side aggregate (BudgetNote owns the
                              "aggregate pending contract" copy). */}
                          <div className="break-all">{`${run.costUsd.toFixed(2)} ${t(
                            "agentConsole.runs.costBasis",
                          )}`}</div>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end">
                            <Button
                              size="small"
                              variant="link"
                              onClick={() =>
                                setExpandedId(expanded ? null : run.runId)
                              }
                            >
                              {expanded
                                ? t('agentConsole.runs.collapse')
                                : t('agentConsole.runs.expand')}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {expanded ? (
                        <TableRow data-testid={`agent-run-detail-${run.runId}`}>
                          <TableCell colSpan={6}>
                            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
                              <dt className="text-text-2">
                                {t('agentConsole.runs.reasonCode')}
                              </dt>
                              <dd className="min-w-0 break-all">
                                {run.reasonCode ?? '—'}
                              </dd>
                              <dt className="text-text-2">
                                {t('agentConsole.runs.attemptNo')}
                              </dt>
                              <dd>{run.attemptNo}</dd>
                              <dt className="text-text-2">
                                {t('agentConsole.runs.taskId')}
                              </dt>
                              <dd className="min-w-0 break-all">
                                {run.taskId ?? '—'}
                              </dd>
                            </dl>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
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
          <StateView title={t('agentConsole.runs.empty')} />
        ) : null}
      </div>
    </div>
  );
}
