import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, StateView, Tag } from '@bisheng/ui';
import { LoadingIcon } from '@/components/bs-icons/loading';
import type {
  AgentConsoleApi,
  ApiResult,
  EmployeeDetail,
  OverviewBundle,
} from '@/controllers/API/agent';
import { AuthError } from '@/controllers/API/agent';
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
  const [authFailed, setAuthFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      // Network/5xx failures degrade every block independently; an AuthError
      // from any call means the session is gone -> full re-login view.
      const degrade = <T,>(err: unknown): ApiResult<T> => ({
        ok: false,
        status: 0,
        data: null,
        code: err instanceof AuthError ? 'agent.auth.expired' : 'agent.upstream',
      });
      let employee: ApiResult<EmployeeDetail>;
      try {
        employee = await api.getEmployee(employeeId);
      } catch (err) {
        if (!alive) return;
        if (err instanceof AuthError) {
          setAuthFailed(true);
          setLoading(false);
          return;
        }
        employee = degrade<EmployeeDetail>(err);
        setBundle({
          employee,
          config: degrade(err),
          workstations: degrade(err),
          pendingApprovals: degrade(err),
        });
        setLoading(false);
        return;
      }
      const owner = employee.data?.ownerUserId;
      const settle = async <T,>(p: Promise<ApiResult<T>>): Promise<ApiResult<T>> => {
        try {
          return await p;
        } catch (err) {
          return degrade<T>(err);
        }
      };
      const [config, workstations, pendingApprovals] = await Promise.all([
        settle(api.getEffectiveConfig(employeeId)),
        settle(api.getWorkstations(employeeId)),
        owner
          ? settle(api.countPendingApprovals(`human:${owner}`))
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

  if (authFailed) {
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
          ? `${wsItems[0].status} · ${wsItems[0].channel} ${t('agentConsole.overview.workstationMore', { count: wsItems.length })}`
          : `${wsItems[0].status} · ${wsItems[0].channel}`;

  const pa = bundle.pendingApprovals;

  // Readable labels for known enum values; unknown values render verbatim.
  const POLICY_LABEL_KEYS: Record<string, string> = {
    approval_required_on_write: 'agentConsole.overview.policy.approvalRequiredOnWrite',
  };
  const SCOPE_LABEL_KEYS: Record<string, string> = {
    tenant: 'agentConsole.overview.scope.tenant',
  };
  // Real E5 data may return these as objects (e.g. memoryScope =
  // {employeeScope, teamScopeIds, retentionDays}); rendering a non-string
  // value as a React child throws, so objects degrade to a readable label.
  const enumOrLabel = (value: unknown, labels: Record<string, string>): string => {
    if (typeof value === 'string' && value) {
      return labels[value] ? t(labels[value]) : value;
    }
    if (value && typeof value === 'object') {
      return t('agentConsole.overview.complex');
    }
    return '—';
  };
  const policyText = enumOrLabel(bundle.config.data?.version?.responsePolicy, POLICY_LABEL_KEYS);
  const scopeText = enumOrLabel(bundle.config.data?.version?.memoryScope, SCOPE_LABEL_KEYS);

  return (
    <div className="w-full max-w-full">
      <AgentSummaryHeader employee={employee} versionNo={versionNo} />

      <dl className="mt-4 grid w-full grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-text-2">{t('agentConsole.overview.workstations')}</dt>
        <dd className="min-w-0 break-all">{workstationText}</dd>

        <dt className="text-text-2">{t('agentConsole.overview.pendingApprovals')}</dt>
        <dd>
          {pa.ok && pa.data ? (
            <Tag color="approving">{String(pa.data.count)}</Tag>
          ) : pa.code === 'agent.approvals_overflow' ||
            pa.code === 'agent.approvals_not_wired' ? (
            t('agentConsole.overview.pendingWiring')
          ) : (
            t('agentConsole.overview.pendingUnavailable')
          )}
        </dd>

        <dt className="text-text-2">{t('agentConsole.overview.responsePolicy')}</dt>
        <dd className="min-w-0 break-all">{policyText}</dd>

        <dt className="text-text-2">{t('agentConsole.overview.memoryScope')}</dt>
        <dd className="min-w-0 break-all">{scopeText}</dd>
      </dl>

      <div className="mt-4">
        <div className="text-sm text-text-2">
          {t('agentConsole.overview.grantsTitle')}
        </div>
        {bundle.config.ok && (bundle.config.data?.grants?.length ?? 0) > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {bundle.config.data?.grants.map((g) => (
              <li key={g.id} className="min-w-0 rounded border border-border-base p-3">
                <div className="break-all">
                  <span className="text-text-2">
                    {t('agentConsole.overview.grantColScope')}
                  </span>{' '}
                  {g.scopeType}
                </div>
                <div className="break-all">
                  <span className="text-text-2">
                    {t('agentConsole.overview.grantColResource')}
                  </span>{' '}
                  {typeof g.resourceSelector === 'string'
                    ? g.resourceSelector
                    : String(g.resourceSelector?.type ?? 'grant')}
                </div>
                <div className="break-all">
                  <span className="text-text-2">
                    {t('agentConsole.overview.grantColActions')}
                  </span>{' '}
                  {g.actions.join(', ')}
                </div>
                <div className="break-all">
                  <span className="text-text-2">
                    {t('agentConsole.overview.grantColExpires')}
                  </span>{' '}
                  {g.expiresAt ? g.expiresAt.replace('T', ' ').replace('Z', '') : '—'}
                </div>
              </li>
            ))}
          </ul>
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
