/* W1 shell L1 pages. Honest empty shells only — no fake numbers, no fake
 * charts, no fixtures in the bundle. Real content arrives per wave (W2
 * employees list, W3 approvals, W4 metrics/audit polish). Shared with
 * Shell.tsx via useShellApis() so sections reuse one http adapter instance. */
import { useTranslation } from 'react-i18next';
import { NavLink, useParams } from 'react-router-dom';

import { ApprovalDetailPage } from './ApprovalDetailPage';
import { AuditDetailPage } from './AuditDetailPage';
import { AuditListPage } from './AuditListPage';
import { ApprovalsListPage } from './ApprovalsListPage';
import { EmployeeDetailPage } from './EmployeeDetailPage';
import { EmployeeCreatePage } from './EmployeeCreatePage';
import { EmployeesListPage } from './EmployeesListPage';
import { MetricsPage as MetricsScreen } from './MetricsPage';
import { OverviewPage as OverviewScreen } from './OverviewPage';
import { RunDetailPage } from './RunDetailPage';
import { RunsSection } from './RunsSection';
import { useShellApis } from './Shell';
import { TaskDetailPage } from './TaskDetailPage';
import { TaskCreatePage } from './TaskCreatePage';
import { TasksListPage } from './TasksListPage';
import MatrixScreen from './MatrixPage';
import SkillsScreen from './SkillsPage';
import { SettingsPage as SettingsScreen } from './SettingsPage';

export function OverviewPage() {
  /* OV-01 slice 1: header + 4 real-BFF KPIs; remaining blocks are honest
   * placeholders inside OverviewPage until their waves. */
  return <OverviewScreen />;
}

/* W2: the real employee list screen (parity spec §4 / EMP-01). */
export function EmployeesPage() {
  return <EmployeesListPage />;
}

/* EMP-02: real employee creation at /agent/employees/new (emp02-target.html).
 * The only page besides TSK-03 that writes; it posts through the BFF. */
export function EmployeeCreateScreen() {
  return <EmployeeCreatePage />;
}

/* EMP-03: employee detail screen at /agent/employees/:id. */
export function EmployeeDetailScreen() {
  return <EmployeeDetailPage />;
}

/* APR-01: real approvals pending list (owned by the APR-01 page lane). */
export function ApprovalsPage() {
  return <ApprovalsListPage />;
}

/* APR-02: read-only approval detail at /agent/approvals/:id. */
export function ApprovalDetailScreen() {
  return <ApprovalDetailPage />;
}

/* TSK-01: real read-only task board (was an honest empty shell). */
export function TasksPage() {
  return <TasksListPage />;
}

/* TSK-03: manual task creation at /agent/tasks/new (tsk03-target.html).
 * Real write through the BFF; the source is fixed to manual. */
export function TaskCreateScreen() {
  return <TaskCreatePage />;
}

/* TSK-02: read-only task detail at /agent/tasks/:taskId (tsk02-target.html).
 * Remounts per task id so a related-task jump starts from a clean load. */
export function TaskDetailScreen() {
  const { taskId = '' } = useParams();
  return <TaskDetailPage key={taskId} taskIdOverride={taskId} />;
}

/* AUD-01: the real read-only audit list (aud01-target.html). Read-only A3+A7
 * only — the page itself carries zero write entries. */
export function AuditPage() {
  const { consoleApi } = useShellApis();
  return (
    <div className="a2s-page" data-testid="agent-v2-page-audit-shell">
      <AuditListPage consoleApi={consoleApi} />
    </div>
  );
}

/* AUD-02: read-only audit event detail at `/agent/audit/:eventId`
 * (aud02-target.html). Remounts per event id so jumping between two events
 * starts from a clean read instead of showing the previous one's numbers. */
export function AuditDetailScreen() {
  const { consoleApi } = useShellApis();
  const { eventId = '' } = useParams();
  return (
    <AuditDetailPage
      key={eventId}
      eventIdOverride={eventId}
      consoleApi={consoleApi}
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

/* RUN-02: read-only run detail at /agent/runs/:runId (run02-target.html).
 * Remounts per run id so a prev-run jump starts from a clean poll state. */
export function RunDetailScreen() {
  const { runId = '' } = useParams();
  return <RunDetailPage key={runId} runIdOverride={runId} />;
}

/* MET-01: the real read-only metrics projection page (met01-target.html).
 * The legacy embedded HermesMetricsSection stays on the old v2 page. */
export function MetricsPage() {
  return <MetricsScreen />;
}

/* SET-01: read-only system settings at /agent/settings/:section
 * (set01-target.html). Six groups, zero write entry, sanitized readings. */
export function SettingsPage() {
  return <SettingsScreen />;
}

/**
 * MATRIX-01 shell: the screen brings its own data leg (makeFetcher),
 * so no ShellApis are needed here.
 */
export function MatrixPage() {
  return (
    <div className="a2s-page" data-testid="agent-v2-page-matrix">
      <MatrixScreen />
    </div>
  );
}

/**
 * SKILL-01 shell: read-only skill governance. The screen brings its own data
 * leg (makeFetcher), so no ShellApis are needed here.
 */
export function SkillsPage() {
  return (
    <div className="a2s-page" data-testid="agent-v2-page-skills">
      <SkillsScreen />
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
