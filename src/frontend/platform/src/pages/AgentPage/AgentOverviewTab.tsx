import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StateView, Tag } from '@bisheng/ui';
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
  AgentConsoleApi,
  ApiResult,
  OverviewBundle,
} from '@/controllers/API/agent';
import { AgentSummaryHeader } from './AgentSummaryHeader';
import { BudgetNote } from './BudgetNote';

export interface AgentOverviewTabProps {
  api: AgentConsoleApi;
  employeeId: string;
}

/**
 * Read-only overview tab (slice 1). Data blocks degrade independently:
 * - version: from E5 version.versionNo only; missing -> "unknown" (never guessed)
 * - workstations: first `status · channel` + count ("more" note); E10 not ok -> unavailable
 * - pending approvals: AP4 count for human:<ownerUserId>
 * - cost: fixed "pending contract" note (BudgetNote), no numbers at all
 */
export function AgentOverviewTab({ api, employeeId }: AgentOverviewTabProps) {
  const { t } = useTranslation();
  const [bundle, setBundle] = useState<OverviewBundle | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const employee = await api.getEmployee(employeeId);
      const owner = employee.data?.ownerUserId;
      const [config, workstations, pendingApprovals] = await Promise.all([
        api.getEffectiveConfig(employeeId),
        api.getWorkstations(employeeId),
        owner
          ? api.countPendingApprovals(`human:${owner}`)
          : Promise.resolve({
              ok: false,
              status: 0,
              data: null,
              code: 'agent.overview.owner_missing',
            } satisfies ApiResult<{ count: number }>),
      ]);
      if (!alive) return;
      setBundle({ employee, config, workstations, pendingApprovals });
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [api, employeeId]);

  if (loading && !bundle) {
    return (
      <div
        className="relative w-full py-10 flex justify-center items-center"
        aria-busy="true"
        data-testid="agent-overview-loading"
      >
        <LoadingIcon />
      </div>
    );
  }

  if (!bundle) return null;

  if (!bundle.employee.ok || !bundle.employee.data) {
    return (
      <StateView
        title={t('agentConsole.overview.error')}
        description={bundle.employee.code ?? ''}
      />
    );
  }

  const employee = bundle.employee.data;
  const versionNo = bundle.config.data?.version?.versionNo ?? null;

  const ws = bundle.workstations;
  const wsItems = ws.ok ? ws.data?.items ?? [] : null;
  const workstationText =
    wsItems == null
      ? t('agentConsole.workstation.unavailable')
      : wsItems.length === 0
        ? t('agentConsole.workstation.empty')
        : wsItems.length > 1
          ? `${wsItems[0].status} · ${wsItems[0].channel} ${t('agentConsole.overview.workstationMore')} ${wsItems.length}`
          : `${wsItems[0].status} · ${wsItems[0].channel}`;

  const pa = bundle.pendingApprovals;

  return (
    <div className="w-full max-w-full">
      <AgentSummaryHeader employee={employee} versionNo={versionNo} />

      <dl className="mt-4 grid w-full grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-text-2">{t('agentConsole.overview.workstations')}</dt>
        <dd className="break-all">{workstationText}</dd>

        <dt className="text-text-2">{t('agentConsole.overview.pendingApprovals')}</dt>
        <dd>
          {pa.ok && pa.data ? (
            <Tag color="approving">{`${t('agentConsole.overview.pendingCount')} ${pa.data.count}`}</Tag>
          ) : (
            t('agentConsole.overview.pendingUnavailable')
          )}
        </dd>

        <dt className="text-text-2">{t('agentConsole.overview.responsePolicy')}</dt>
        <dd className="break-all">
          {bundle.config.data?.version?.responsePolicy ?? '—'}
        </dd>

        <dt className="text-text-2">{t('agentConsole.overview.memoryScope')}</dt>
        <dd className="break-all">
          {bundle.config.data?.version?.memoryScope ?? '—'}
        </dd>
      </dl>

      <div className="mt-4">
        <div className="text-sm text-text-2">
          {t('agentConsole.overview.grantsTitle')}
        </div>
        {bundle.config.ok && (bundle.config.data?.grants?.length ?? 0) > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('agentConsole.overview.grantColScope')}</TableHead>
                <TableHead>{t('agentConsole.overview.grantColResource')}</TableHead>
                <TableHead>{t('agentConsole.overview.grantColActions')}</TableHead>
                <TableHead>{t('agentConsole.overview.grantColExpires')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bundle.config.data?.grants.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="max-w-[200px] min-w-0">
                    <div className="break-all">{g.scopeType}</div>
                  </TableCell>
                  <TableCell className="max-w-[220px] min-w-0">
                    <div className="break-all">{g.resourceSelector}</div>
                  </TableCell>
                  <TableCell className="break-all">{g.actions.join(', ')}</TableCell>
                  <TableCell>
                    {g.expiresAt ? g.expiresAt.replace('T', ' ').replace('Z', '') : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="mt-1 text-sm text-text-2">
            {t('agentConsole.overview.noGrants')}
          </div>
        )}
      </div>

      <BudgetNote />
    </div>
  );
}
