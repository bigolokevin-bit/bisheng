import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tabs } from '@bisheng/ui';
import type { AgentConsoleApi } from '@/controllers/API/agent';
import { createHttpAgentConsoleApi } from '@/controllers/API/agent';
import { AgentListPage } from './AgentListPage';
import { AgentOverviewTab } from './AgentOverviewTab';
import { AgentTasksTab } from './AgentTasksTab';
import { AgentRunsTab } from './AgentRunsTab';
import { AgentAuditTab } from './AgentAuditTab';

/**
 * Default real adapter: same-origin `/agent-api` -> console BFF, using the
 * Bisheng login token from localStorage. Created once per app, not per render
 * (child effects depend on the `api` identity).
 */
let defaultApi: AgentConsoleApi | null = null;
function getDefaultApi(): AgentConsoleApi {
  if (!defaultApi) {
    defaultApi = createHttpAgentConsoleApi();
  }
  return defaultApi;
}

export interface AgentPageProps {
  /**
   * Injected narrow API. Production routes use the default real adapter;
   * tests and the visual harness pass `createStubAgentConsoleApi(...)`.
   */
  api?: AgentConsoleApi;
}

/**
 * Console page shell: employee list <-> detail tabs (overview / tasks /
 * runs / audit). All tabs are read-only; inactive tabs are not mounted, so
 * they issue no requests until opened (Radix unmounts inactive panels).
 */
export function AgentPage({ api }: AgentPageProps) {
  const { t } = useTranslation();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const resolvedApi = api ?? getDefaultApi();

  if (employeeId) {
    return (
      <div className="w-full max-w-full p-4">
        <div className="mb-2">
          <Button variant="text" onClick={() => setEmployeeId(null)}>
            {t('agentConsole.detail.back')}
          </Button>
        </div>
        <Tabs
          aria-label={t('agentConsole.breadcrumb.root')}
          defaultActiveKey="overview"
          items={[
            {
              key: 'overview',
              label: t('agentConsole.tabs.overview'),
              children: (
                <AgentOverviewTab api={resolvedApi} employeeId={employeeId} />
              ),
            },
            {
              key: 'tasks',
              label: t('agentConsole.tabs.tasks'),
              children: <AgentTasksTab api={resolvedApi} employeeId={employeeId} />,
            },
            {
              key: 'runs',
              label: t('agentConsole.tabs.runs'),
              children: <AgentRunsTab api={resolvedApi} employeeId={employeeId} />,
            },
            {
              key: 'audit',
              label: t('agentConsole.tabs.audit'),
              children: <AgentAuditTab api={resolvedApi} employeeId={employeeId} />,
            },
          ]}
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-full p-4">
      <AgentListPage api={resolvedApi} onSelect={setEmployeeId} />
    </div>
  );
}
