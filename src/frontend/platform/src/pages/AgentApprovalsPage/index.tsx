import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, StateView } from '@bisheng/ui';
import { userContext } from '@/contexts/userContext';
import type {
  AgentApprovalsApi,
  Approval,
} from '@/controllers/API/agentConsoleApprovals';
import { createHttpAgentApprovalsApi } from '@/controllers/API/agentConsoleApprovals';
import { AgentApprovalsList } from './AgentApprovalsList';
import { ApprovalDetail } from './ApprovalDetail';

const defaultApi = createHttpAgentApprovalsApi();

export interface AgentApprovalsPageProps {
  /** Injectable for tests; the deployed page uses the same-origin BFF. */
  api?: AgentApprovalsApi;
}

/**
 * S10b-4 read-only approval to-do page (/agent/approvals).
 *
 * The assignee is always `human:<user_id>` taken from the live Bisheng user
 * session — never guessed, never hardcoded. If the session identity is not
 * available the page refuses to query and shows an explicit state.
 */
export function AgentApprovalsPage({
  api = defaultApi,
}: AgentApprovalsPageProps = {}) {
  const { t } = useTranslation();
  const { user } = useContext(userContext);
  const userId = user?.user_id as string | number | undefined;
  const [selected, setSelected] = useState<Approval | null>(null);

  if (userId === undefined || userId === null || userId === '') {
    return (
      <div className="w-full max-w-full p-4">
        <StateView
          title={t('agentConsole.approvals.identityUnavailable')}
          description={t('agentConsole.approvals.identityUnavailableHint')}
        />
      </div>
    );
  }

  if (selected) {
    return (
      <div className="w-full max-w-full p-4">
        <div className="mb-3">
          <Button
            variant="link"
            onClick={() => setSelected(null)}
          >
            {t('agentConsole.detail.back')}
          </Button>
        </div>
        <ApprovalDetail
          api={api}
          approval={selected}
          currentHumanId={`human:${userId}`}
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-full p-4">
      <AgentApprovalsList
        api={api}
        assignee={`human:${userId}`}
        onSelect={setSelected}
      />
    </div>
  );
}
