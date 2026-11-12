import { useCallback, useEffect, useRef, useState } from 'react';
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
import type { AgentConsoleApi, AuditEvent } from '@/controllers/API/agent';
import { AuthError, UpstreamError } from '@/controllers/API/agent';

export interface AgentAuditTabProps {
  api: AgentConsoleApi;
  employeeId: string;
  /** A3 default page size is 20; overridable for tests (like AgentListPage). */
  pageSize?: number;
}

/** Frozen §5.7 map: success->success, failure->danger, denied->warning, pending->gray. */
export function auditOutcomeTagColor(
  outcome: string,
): 'success' | 'danger' | 'warning' | 'default' {
  switch (outcome) {
    case 'success':
      return 'success';
    case 'failure':
      return 'danger';
    case 'denied':
      return 'warning';
    case 'pending':
    default:
      return 'default';
  }
}

const AUDIT_OUTCOME_LABEL_KEYS: Record<string, string> = {
  success: 'agentConsole.audit.outcome.success',
  failure: 'agentConsole.audit.outcome.failure',
  denied: 'agentConsole.audit.outcome.denied',
  pending: 'agentConsole.audit.outcome.pending',
};

/**
 * Read-only audit list (A3). A3 FORBIDS unfiltered queries (BFF 400
 * `console.missing_filter`), so the filter is derived internally:
 * listRuns({employeeId, limit: 1}) -> latest run -> listAudit({runId}).
 * With no run at all, listAudit is never called and the empty state shows.
 */
export function AgentAuditTab({ api, employeeId, pageSize = 20 }: AgentAuditTabProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<{ code?: string } | null>(null);
  const reqSeq = useRef(0);
  // Latest-run filter, resolved once per employee; cleared on employee change
  // and before a full retry so the freshest run is always re-derived.
  const runFilterRef = useRef<string | null>(null);

  const load = useCallback(
    async (cursor?: string) => {
      const seq = ++reqSeq.current;
      setLoading(true);
      try {
        let runId = runFilterRef.current;
        if (!runId) {
          const runs = await api.listRuns({ employeeId, limit: 1 });
          runId = runs.items[0]?.runId ?? null;
          if (seq !== reqSeq.current) return;
          if (!runId) {
            // No run: an unfiltered audit query is illegal, so skip the
            // listAudit call entirely; rows stay empty -> empty StateView.
            runFilterRef.current = null;
            setRows([]);
            setNextCursor(undefined);
            setError(null);
            return;
          }
          runFilterRef.current = runId;
        }
        const res = await api.listAudit({ runId, limit: pageSize, cursor });
        if (seq !== reqSeq.current) return;
        setError(null);
        setRows((prev) => (cursor ? [...prev, ...res.items] : res.items));
        setNextCursor(res.nextCursor);
      } catch (err) {
        if (seq !== reqSeq.current) return;
        runFilterRef.current = null;
        setError({
          code:
            err instanceof AuthError
              ? 'agent.auth.expired'
              : err instanceof UpstreamError && err.message
                ? err.message
                : 'agent.audit.request_failed',
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
    runFilterRef.current = null;
    void load();
  }, [load]);

  const handleLoadMore = () => {
    if (nextCursor) void load(nextCursor);
  };

  return (
    <div className="w-full max-w-full">
      <div className="relative w-full" aria-busy={loading}>
        {loading && rows.length === 0 && (
          <div
            data-testid="agent-audit-loading"
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
              title={t('agentConsole.audit.error')}
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
                  <TableHead className="w-[160px]">{t('agentConsole.audit.colOccurredAt')}</TableHead>
                  <TableHead className="w-[200px]">{t('agentConsole.audit.colActor')}</TableHead>
                  <TableHead className="w-[160px]">{t('agentConsole.audit.colAction')}</TableHead>
                  <TableHead className="w-[200px]">{t('agentConsole.audit.colResource')}</TableHead>
                  <TableHead className="w-[90px]">{t('agentConsole.audit.colOutcome')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((event) => (
                  <TableRow key={event.eventId}>
                    <TableCell className="max-w-[160px] min-w-0">
                      <div className="break-all">
                        {event.occurredAt.replace('T', ' ').replace('Z', '')}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[200px] min-w-0">
                      <div className="break-all">
                        {`${event.actor.type} · ${event.actor.id}`}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[160px] min-w-0">
                      <div className="break-all">{event.action}</div>
                    </TableCell>
                    <TableCell className="max-w-[200px] min-w-0">
                      <div className="break-all">
                        {`${event.resource.type} · ${event.resource.id}`}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Tag color={auditOutcomeTagColor(event.outcome)}>
                        {AUDIT_OUTCOME_LABEL_KEYS[event.outcome]
                          ? t(AUDIT_OUTCOME_LABEL_KEYS[event.outcome])
                          : event.outcome}
                      </Tag>
                    </TableCell>
                  </TableRow>
                ))}
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
          // Same empty copy for "no run to filter on" and "no events":
          // both mean nothing matched, and no unfiltered query was made.
          <StateView title={t('agentConsole.audit.empty')} />
        ) : null}
      </div>
    </div>
  );
}
