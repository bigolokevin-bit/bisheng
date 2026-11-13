/**
 * S10b workspace-bind page (l4-console-workspace-bind): check whether a runId
 * is bound to tasks and approvals.
 *
 * Honest scope (see the change design.md):
 * - Tasks: the current BFF whitelist rejects runId-only queries with
 *   400 console.missing_filter (domain T5 has no runId filter). That is shown
 *   as a query failure — never as a fake empty success.
 * - Approvals: domain AP4 has no runId parameter either, so we read the
 *   current user's own pending queue and filter the run binding client-side
 *   (runId field or binding.subjectId). The UI states this scope explicitly.
 *
 * Access model: the whole page sits behind the VITE_AGENT_WORKSPACE_BIND
 * build-time flag; with the flag off it renders nothing and issues no
 * requests (unreachable). With the flag on but no admin web_menu entry
 * (admin/backend) it shows a permission notice and still issues no requests.
 */
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@bisheng/ui';

import type { AgentConsoleApi, Task, TaskList } from '@/controllers/API/agent';
import { createHttpAgentConsoleApi } from '@/controllers/API/agent';
import type {
  AgentApprovalsApi,
  Approval,
  ApprovalList,
} from '@/controllers/API/agentConsoleApprovals';
import { createHttpAgentApprovalsApi } from '@/controllers/API/agentConsoleApprovals';
import { workspaceBindEnabled } from '@/controllers/API/agentConsoleRead';
import { userContext } from '@/contexts/userContext';
import { ApprovalDetail } from '@/pages/AgentApprovalsPage/ApprovalDetail';

type Panel<T> =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ok'; items: T[] }
  | { phase: 'error' };

const RUN_ID_MAX = 64;
const RUN_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Raw-value validation: empty, spaces (including leading/trailing), '/' or
 * an over-long id are all rejected before any request is issued. */
export function isValidRunId(raw: string): boolean {
  return raw.length > 0 && raw.length <= RUN_ID_MAX && RUN_ID_PATTERN.test(raw);
}

export interface AgentWorkspaceBindProps {
  consoleApi?: AgentConsoleApi;
  approvalsApi?: AgentApprovalsApi;
}

const DIGEST_TRUNC = 12;

function digestCell(digest: string | null | undefined) {
  const full = digest ?? '';
  if (!full) return <span>—</span>;
  const short =
    full.length > DIGEST_TRUNC ? `${full.slice(0, DIGEST_TRUNC)}…` : full;
  // Truncated display keeps the full value available via the title tooltip.
  return (
    <span className="break-all" title={full}>
      {short}
    </span>
  );
}

export function AgentWorkspaceBind({
  consoleApi,
  approvalsApi,
}: AgentWorkspaceBindProps) {
  const { t } = useTranslation();
  const { user } = useContext(userContext);
  const [runIdInput, setRunIdInput] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [tab, setTab] = useState<'bind' | 'approvals'>('bind');
  const [tasks, setTasks] = useState<Panel<Task>>({ phase: 'idle' });
  const [approvals, setApprovals] = useState<Panel<Approval>>({ phase: 'idle' });
  const [selected, setSelected] = useState<Approval | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);

  const api = useMemo(
    () => ({
      c: consoleApi ?? createHttpAgentConsoleApi(),
      a: approvalsApi ?? createHttpAgentApprovalsApi(),
    }),
    [consoleApi, approvalsApi],
  );

  // Leaving the page must cancel in-flight reads (no setState after unmount).
  useEffect(
    () => () => {
      ctrlRef.current?.abort();
    },
    [],
  );

  const flagOn = workspaceBindEnabled();
  const menus = user?.web_menu ?? [];
  const isAdmin = menus.includes('admin') || menus.includes('backend');

  const runQuery = async () => {
    if (!flagOn || !isAdmin) return;
    if (!isValidRunId(runIdInput)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setSelected(null);
    setTasks({ phase: 'loading' });
    setApprovals({ phase: 'loading' });
    const runId = runIdInput;
    const uid = String(user?.user_id ?? '');

    // Tasks: honest runId-only query; current BFF answers 400 which must
    // surface as a failure, not as an empty success (spec scenario).
    api.c
      .listTasks({ runId, limit: 20 }, ctrl.signal)
      .then((list: TaskList) => {
        if (!ctrl.signal.aborted) setTasks({ phase: 'ok', items: list.items ?? [] });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setTasks({ phase: 'error' });
      });

    // Approvals: own pending queue, then client-side run-binding filter.
    api.a
      .listApprovals(
        { assignee: `human:${uid}`, status: 'pending', limit: 20 },
        ctrl.signal,
      )
      .then((list: ApprovalList) => {
        if (ctrl.signal.aborted) return;
        const linked = (list.items ?? []).filter(
          (row) => row.runId === runId || row.binding?.subjectId === runId,
        );
        setApprovals({ phase: 'ok', items: linked });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setApprovals({ phase: 'error' });
      });
  };

  if (!flagOn) {
    // Build flag off = unreachable by design: no UI, no requests.
    return null;
  }

  if (!isAdmin) {
    return (
      <div data-testid="agent-workspace-bind" className="p-6">
        <p className="text-sm text-text-2">
          {t('agentConsole.workspace.noPermission')}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="agent-workspace-bind" className="p-6 space-y-4">
      <h1 className="text-lg font-medium">
        {t('agentConsole.workspace.tabTitle')}
      </h1>
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor="ws-runid"
          className="text-sm text-text-2"
        >
          {t('agentConsole.workspace.runIdLabel')}
        </label>
        <input
          id="ws-runid"
          aria-label={t('agentConsole.workspace.runIdLabel')}
          className="w-72 rounded-md border border-border bg-transparent px-3 py-2 text-sm"
          value={runIdInput}
          placeholder={t('agentConsole.workspace.runIdPlaceholder')}
          onChange={(e) => setRunIdInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runQuery();
          }}
        />
        <Button
          type="button"
          size="medium"
          variant="primary"
          onClick={() => void runQuery()}
        >
          {t('agentConsole.workspace.query')}
        </Button>
      </div>
      {invalid && (
        <p data-testid="workspace-invalid" className="text-sm text-warning">
          {t('agentConsole.workspace.invalidRunId')}
        </p>
      )}
      <div role="tablist" className="flex items-center gap-2">
        <Button
          type="button"
          role="tab"
          aria-selected={tab === 'bind'}
          variant={tab === 'bind' ? 'primary' : 'link'}
          onClick={() => setTab('bind')}
        >
          {t('agentConsole.workspace.tabBind')}
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={tab === 'approvals'}
          variant={tab === 'approvals' ? 'primary' : 'link'}
          onClick={() => setTab('approvals')}
        >
          {t('agentConsole.workspace.tabApprovals')}
        </Button>
      </div>

      {tab === 'bind' ? (
        <div data-testid="workspace-tasks-panel">
          {tasks.phase === 'loading' && (
            <p className="text-sm text-text-2">{t('agentConsole.workspace.loading')}</p>
          )}
          {tasks.phase === 'error' && (
            <p data-testid="workspace-tasks-error" className="text-sm text-destructive">
              {t('agentConsole.workspace.errorQuery')}
            </p>
          )}
          {tasks.phase === 'ok' && tasks.items.length === 0 && (
            <p data-testid="workspace-tasks-empty" className="text-sm text-text-2">
              {t('agentConsole.workspace.emptyTasks')}
            </p>
          )}
          {tasks.phase === 'ok' && tasks.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-text-2">
                    <th className="text-left font-normal">{t('agentConsole.workspace.colTaskId')}</th>
                    <th className="text-left font-normal">{t('agentConsole.workspace.colTitle')}</th>
                    <th className="text-left font-normal">{t('agentConsole.workspace.colStatus')}</th>
                    <th className="text-left font-normal">{t('agentConsole.workspace.colAssignee')}</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.items.map((task) => (
                    <tr key={task.taskId}>
                      <td className="break-all">{task.taskId}</td>
                      <td className="min-w-0 break-all">{task.title}</td>
                      <td>{task.status}</td>
                      <td className="break-all">{task.assignee ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div data-testid="workspace-approvals-panel">
          <p className="mb-2 text-xs text-text-2">
            {t('agentConsole.workspace.scopeNote')}
          </p>
          {approvals.phase === 'loading' && (
            <p className="text-sm text-text-2">{t('agentConsole.workspace.loading')}</p>
          )}
          {approvals.phase === 'error' && (
            <p data-testid="workspace-approvals-error" className="text-sm text-destructive">
              {t('agentConsole.workspace.errorQuery')}
            </p>
          )}
          {approvals.phase === 'ok' && approvals.items.length === 0 && (
            <p data-testid="workspace-approvals-empty" className="text-sm text-text-2">
              {t('agentConsole.workspace.emptyApprovals')}
            </p>
          )}
          {approvals.phase === 'ok' && approvals.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-text-2">
                    <th className="text-left font-normal">{t('agentConsole.workspace.colApprovalId')}</th>
                    <th className="text-left font-normal">{t('agentConsole.workspace.colAction')}</th>
                    <th className="text-left font-normal">{t('agentConsole.workspace.colStatus')}</th>
                    <th className="text-left font-normal">{t('agentConsole.workspace.colRisk')}</th>
                    <th className="text-left font-normal">{t('agentConsole.workspace.colDigest')}</th>
                    <th className="text-left font-normal" />
                  </tr>
                </thead>
                <tbody>
                  {approvals.items.map((row) => (
                    <tr key={row.approvalId}>
                      <td className="break-all">{row.approvalId}</td>
                      <td className="min-w-0 break-all">{row.action}</td>
                      <td>{row.status}</td>
                      <td>{row.riskLevel}</td>
                      <td className="max-w-[180px]">{digestCell(row.argsDigest)}</td>
                      <td>
                        <Button
                          type="button"
                          size="small"
                          variant="link"
                          onClick={() => setSelected(row)}
                        >
                          {t('agentConsole.workspace.detail')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {selected && (
            <div
              data-testid="workspace-approval-detail"
              className="mt-4 border-t border-border pt-4"
            >
              <ApprovalDetail
                api={api.a}
                approval={selected}
                currentHumanId={`human:${String(user?.user_id ?? '')}`}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
