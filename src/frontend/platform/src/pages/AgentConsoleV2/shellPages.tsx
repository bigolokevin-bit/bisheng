/* W1 shell L1 pages. Honest empty shells only — no fake numbers, no fake
 * charts, no fixtures in the bundle. Real content arrives per wave (W2
 * employees list, W3 approvals, W4 metrics/audit polish). Shared with
 * Shell.tsx via useShellApis() so sections reuse one http adapter instance. */
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';

import { HermesMetricsSection } from './HermesMetricsSection';
import { RunsSection } from './RunsSection';
import { useShellApis } from './Shell';

interface L1PageProps {
  titleKey: string;
  descKey: string;
  testid: string;
}

function L1Page({ titleKey, descKey, testid }: L1PageProps) {
  const { t } = useTranslation();
  return (
    <div className="a2s-page" data-testid={testid}>
      <h1 className="a2-h1">{t(titleKey)}</h1>
      <p className="a2-meta">{t(descKey)}</p>
      <div className="a2-card">
        <span className="a2-pill" data-testid={`${testid}-pending`}>
          {t('agentConsole.v2.shell.pendingPill')}
        </span>
        <p className="a2-card-sub">{t('agentConsole.v2.shell.emptyDesc')}</p>
      </div>
    </div>
  );
}

export function OverviewPage() {
  return (
    <L1Page
      titleKey="agentConsole.v2.shell.overviewTitle"
      descKey="agentConsole.v2.shell.overviewDesc"
      testid="agent-v2-page-overview"
    />
  );
}

/* W1 placeholder: replaced by the real employee list screen in W2. */
export function EmployeesPage() {
  return (
    <L1Page
      titleKey="agentConsole.v2.navEmployees"
      descKey="agentConsole.v2.shell.employeesDesc"
      testid="agent-v2-page-employees"
    />
  );
}

export function ApprovalsPage() {
  return (
    <L1Page
      titleKey="agentConsole.v2.navApprovals"
      descKey="agentConsole.v2.shell.approvalsDesc"
      testid="agent-v2-page-approvals"
    />
  );
}

export function TasksPage() {
  return (
    <L1Page
      titleKey="agentConsole.v2.navTasks"
      descKey="agentConsole.v2.shell.tasksDesc"
      testid="agent-v2-page-tasks"
    />
  );
}

export function AuditPage() {
  return (
    <L1Page
      titleKey="agentConsole.v2.navAudit"
      descKey="agentConsole.v2.shell.auditDesc"
      testid="agent-v2-page-audit"
    />
  );
}

export function RunsPage() {
  const { runsApi, consoleApi } = useShellApis();
  return (
    <div className="a2s-page" data-testid="agent-v2-page-runs">
      <RunsSection api={runsApi} consoleApi={consoleApi} />
    </div>
  );
}

export function MetricsPage() {
  const { hermesApi, trendsApi } = useShellApis();
  return (
    <div className="a2s-page" data-testid="agent-v2-page-metrics">
      <HermesMetricsSection hermesApi={hermesApi} trendsApi={trendsApi} />
    </div>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  return (
    <div className="a2s-page" data-testid="agent-v2-page-settings">
      <h1 className="a2-h1">{t('agentConsole.v2.navSettings')}</h1>
      <p className="a2-meta">{t('agentConsole.v2.shell.settingsDesc')}</p>
      <div className="a2-card">
        <p className="a2-card-sub">{t('agentConsole.v2.shell.themeNote')}</p>
        <p className="a2-card-sub">{t('agentConsole.v2.shell.envNote')}</p>
        <p className="a2-card-sub">{t('agentConsole.v2.shell.readonlyNote')}</p>
      </div>
    </div>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="a2s-page" data-testid="agent-v2-404">
      <h1 className="a2-h1">{t('agentConsole.v2.notFoundTitle')}</h1>
      <p className="a2-meta">{t('agentConsole.v2.notFoundDesc')}</p>
      <NavLink className="a2-btn" to="/agent">
        {t('agentConsole.v2.backHome')}
      </NavLink>
    </div>
  );
}
