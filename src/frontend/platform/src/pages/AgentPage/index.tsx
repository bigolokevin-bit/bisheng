import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@bisheng/ui';
import type { AgentConsoleApi } from '@/controllers/API/agent';
import { createHttpAgentConsoleApi } from '@/controllers/API/agent';
import { AgentListPage } from './AgentListPage';
import { AgentOverviewTab } from './AgentOverviewTab';

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
 * Console page shell: employee list <-> overview panel.
 * Single-tab stage does not mount the shared Tabs control yet (its spec
 * requires >= 2 items); Tabs lands together with the second tab.
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
        <AgentOverviewTab api={resolvedApi} employeeId={employeeId} />
      </div>
    );
  }

  return (
    <div className="w-full max-w-full p-4">
      <AgentListPage api={resolvedApi} onSelect={setEmployeeId} />
    </div>
  );
}
