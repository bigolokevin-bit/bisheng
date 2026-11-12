import { useTranslation } from 'react-i18next';
import { Tag } from '@bisheng/ui';
import type { LifecycleState } from '@/controllers/API/agent';

/**
 * Lifecycle -> Tag color mapping, fixed by CONSOLE-EXTENSION-PLAN SS5.7
 * (semantic colors only, no new palette):
 * active -> success, paused/suspended -> warning, offboarding -> warning,
 * draft/onboarding/archived -> default(gray).
 */
export function lifecycleTagColor(
  state: LifecycleState,
): 'success' | 'warning' | 'default' {
  switch (state) {
    case 'active':
      return 'success';
    case 'paused':
    case 'suspended':
    case 'offboarding':
      return 'warning';
    case 'draft':
    case 'onboarding':
    case 'archived':
    default:
      return 'default';
  }
}

const LIFECYCLE_LABEL_KEYS: Record<LifecycleState, string> = {
  draft: 'agentConsole.lifecycle.draft',
  onboarding: 'agentConsole.lifecycle.onboarding',
  active: 'agentConsole.lifecycle.active',
  paused: 'agentConsole.lifecycle.paused',
  offboarding: 'agentConsole.lifecycle.offboarding',
  suspended: 'agentConsole.lifecycle.suspended',
  archived: 'agentConsole.lifecycle.archived',
};

export function StatusChip({ state }: { state: LifecycleState }) {
  const { t } = useTranslation();
  return (
    <Tag color={lifecycleTagColor(state)} dot>
      {t(LIFECYCLE_LABEL_KEYS[state])}
    </Tag>
  );
}
