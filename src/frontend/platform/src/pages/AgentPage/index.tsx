import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@bisheng/ui';
import type { AgentConsoleApi } from '@/controllers/API/agent';
import { AgentListPage } from './AgentListPage';
import { AgentOverviewTab } from './AgentOverviewTab';

export interface AgentPageProps {
  /**
   * Injected narrow API (slice 1: pass `createStubAgentConsoleApi(...)`).
   * Not wired into routes/menu yet — component-level acceptance only.
   */
  api: AgentConsoleApi;
}

/**
 * Console page shell: employee list <-> overview panel.
 * Single-tab stage does not mount the shared Tabs control yet (its spec
 * requires >= 2 items); Tabs lands together with the second tab.
 */
export function AgentPage({ api }: AgentPageProps) {
  const { t } = useTranslation();
  const [employeeId, setEmployeeId] = useState<string | null>(null);

  if (employeeId) {
    return (
      <div className="w-full max-w-full p-4">
        <div className="mb-2">
          <Button variant="text" onClick={() => setEmployeeId(null)}>
            {t('agentConsole.detail.back')}
          </Button>
        </div>
        <AgentOverviewTab api={api} employeeId={employeeId} />
      </div>
    );
  }

  return (
    <div className="w-full max-w-full p-4">
      <AgentListPage api={api} onSelect={setEmployeeId} />
    </div>
  );
}
