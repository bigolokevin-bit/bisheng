import { useTranslation } from 'react-i18next';

/**
 * Cost red line (CONSOLE-EXTENSION-PLAN SS5.6): cost aggregation has no
 * contract yet, so the console shows a fixed note instead of any number.
 * Never render 0 and never sum costs on the client.
 */
export function BudgetNote() {
  const { t } = useTranslation();
  return (
    <div className="mt-3 text-sm text-text-2" data-testid="agent-budget-note">
      {t('agentConsole.cost.pending')}
    </div>
  );
}
