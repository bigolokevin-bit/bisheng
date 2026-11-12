import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
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
import type { AgentConsoleApi, Task, TaskStatus } from '@/controllers/API/agent';
import { AuthError, UpstreamError } from '@/controllers/API/agent';

export interface AgentTasksTabProps {
  api: AgentConsoleApi;
  employeeId: string;
  /** T5 default page size is 20; overridable for tests (like AgentListPage). */
  pageSize?: number;
}

/** Frozen §5.7 map: open/in_progress -> brand, blocked -> warning, done -> success, cancelled -> gray. */
export function taskTagColor(
  status: string,
): 'brand' | 'warning' | 'success' | 'default' {
  switch (status) {
    case 'open':
    case 'in_progress':
      return 'brand';
    case 'blocked':
      return 'warning';
    case 'done':
      return 'success';
    case 'cancelled':
    default:
      return 'default';
  }
}

const TASK_STATUS_LABEL_KEYS: Record<string, string> = {
  open: 'agentConsole.tasks.status.open',
  in_progress: 'agentConsole.tasks.status.inProgress',
  done: 'agentConsole.tasks.status.done',
  blocked: 'agentConsole.tasks.status.blocked',
  cancelled: 'agentConsole.tasks.status.cancelled',
};

const TASK_PRIORITY_LABEL_KEYS: Record<string, string> = {
  low: 'agentConsole.tasks.priority.low',
  normal: 'agentConsole.tasks.priority.normal',
  high: 'agentConsole.tasks.priority.high',
};

/** Known enum -> localized label; unknown values render verbatim (never guessed). */
function useEnumLabel() {
  const { t } = useTranslation();
  return (keys: Record<string, string>, value: string) =>
    keys[value] ? t(keys[value]) : value;
}

/**
 * Read-only task list (T5). Always filtered by assignee=`employee:<id>`
 * (no unfiltered query), optional status narrowing, keyset cursor
 * "load more" exactly like AgentListPage. Row expansion is display-only:
 * progressNote / statusReason / source.channel per §5 columns.
 */
export function AgentTasksTab({ api, employeeId, pageSize = 20 }: AgentTasksTabProps) {
  const { t } = useTranslation();
  const selectLabels = useSelectLabels();
  const enumLabel = useEnumLabel();
  const [statusFilter, setStatusFilter] = useState<TaskStatus | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rows, setRows] = useState<Task[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<{ code?: string } | null>(null);
  const reqSeq = useRef(0);

  const load = useCallback(
    async (status: TaskStatus | null, cursor?: string) => {
      const seq = ++reqSeq.current;
      setLoading(true);
      try {
        const res = await api.listTasks({
          assignee: `employee:${employeeId}`,
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
                : 'agent.tasks.request_failed',
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
    void load(statusFilter, undefined);
  }, [statusFilter, load]);

  const handleLoadMore = () => {
    if (nextCursor) void load(statusFilter, nextCursor);
  };

  const statusOptions = (
    ['open', 'in_progress', 'done', 'blocked', 'cancelled'] as TaskStatus[]
  ).map((s) => ({ value: s, label: enumLabel(TASK_STATUS_LABEL_KEYS, s) }));

  return (
    <div className="w-full max-w-full">
      <div className="mb-3 w-[200px]">
        <Select
          {...selectLabels}
          options={statusOptions}
          value={statusFilter ?? undefined}
          allowClear
          size="small"
          placeholder={t('agentConsole.tasks.filterStatus')}
          aria-label={t('agentConsole.tasks.filterStatus')}
          onChange={(v: SelectValue | null) =>
            setStatusFilter(v == null ? null : (String(v) as TaskStatus))
          }
        />
      </div>
      <div className="relative w-full" aria-busy={loading}>
        {loading && rows.length === 0 && (
          <div
            data-testid="agent-tasks-loading"
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
              title={t('agentConsole.tasks.error')}
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
                  <TableHead className="w-[280px]">{t('agentConsole.tasks.colTitle')}</TableHead>
                  <TableHead className="w-[120px]">{t('agentConsole.tasks.colStatus')}</TableHead>
                  <TableHead className="w-[100px]">{t('agentConsole.tasks.colPriority')}</TableHead>
                  <TableHead className="w-[160px]">{t('agentConsole.tasks.colDueAt')}</TableHead>
                  <TableHead className="w-[80px] text-right">{t('agentConsole.list.colAction')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((task) => {
                  const expanded = expandedId === task.taskId;
                  return (
                    <Fragment key={task.taskId}>
                      <TableRow>
                        <TableCell className="max-w-[280px] min-w-0">
                          <div className="truncate" title={task.title}>
                            {task.title}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Tag color={taskTagColor(task.status)}>
                            {enumLabel(TASK_STATUS_LABEL_KEYS, task.status)}
                          </Tag>
                        </TableCell>
                        <TableCell>{enumLabel(TASK_PRIORITY_LABEL_KEYS, task.priority)}</TableCell>
                        <TableCell className="max-w-[160px] min-w-0">
                          <div className="break-all">
                            {task.dueAt ? task.dueAt.replace('T', ' ').replace('Z', '') : '—'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end">
                            <Button
                              size="small"
                              variant="link"
                              onClick={() => setExpandedId(expanded ? null : task.taskId)}
                            >
                              {expanded
                                ? t('agentConsole.tasks.collapse')
                                : t('agentConsole.tasks.expand')}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {expanded ? (
                        <TableRow data-testid={`agent-task-detail-${task.taskId}`}>
                          <TableCell colSpan={5}>
                            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
                              <dt className="text-text-2">{t('agentConsole.tasks.progressNote')}</dt>
                              <dd className="min-w-0 break-all">{task.progressNote ?? '—'}</dd>
                              <dt className="text-text-2">{t('agentConsole.tasks.statusReason')}</dt>
                              <dd className="min-w-0 break-all">{task.statusReason ?? '—'}</dd>
                              <dt className="text-text-2">{t('agentConsole.tasks.sourceChannel')}</dt>
                              <dd className="min-w-0 break-all">{task.source?.channel ?? '—'}</dd>
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
          <StateView title={t('agentConsole.tasks.empty')} />
        ) : null}
      </div>
    </div>
  );
}
