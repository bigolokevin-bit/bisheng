import { useTranslation } from 'react-i18next';
import { Breadcrumb } from '@bisheng/ui';
import type { EmployeeDetail } from '@/controllers/API/agent';
import { StatusChip } from './StatusChip';

export interface AgentSummaryHeaderProps {
  employee: EmployeeDetail;
  /** E5 version.versionNo; null when the config is unavailable (never guess). */
  versionNo: number | null;
}

/** Identity header shared by console tabs (CONSOLE-EXTENSION-PLAN SS6). */
export function AgentSummaryHeader({ employee, versionNo }: AgentSummaryHeaderProps) {
  const { t } = useTranslation();
  return (
    <div className="w-full max-w-full">
      <Breadcrumb
        items={[
          { title: t('agentConsole.breadcrumb.root') },
          { title: employee.name },
        ]}
        expandLabel={(hidden: number) => String(hidden)}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-h4 break-all">{employee.name}</span>
        <StatusChip state={employee.lifecycleState} />
      </div>
      <div className="mt-1 text-sm text-text-2">
        <span className="break-all">{employee.title}</span>
        <span> · </span>
        <span>
          {versionNo != null ? `v${versionNo}` : t('agentConsole.overview.versionUnknown')}
        </span>
      </div>
    </div>
  );
}
