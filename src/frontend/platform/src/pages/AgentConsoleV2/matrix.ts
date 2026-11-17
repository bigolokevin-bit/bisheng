/**
 * MATRIX-01 — read-only employee matrix (layer-A aggregation screen).
 *
 * Pure logic only: shapes mirror the BFF contract handed down by L0
 * (GET /agent-api/api/matrix → upstream /v1/matrix/employees). The upstream
 * is NOT yet deployed (live probe 2026-11-17: 8101 /v1/matrix/employees →
 * 404), so the page must render four honest states and never fabricate rows.
 *
 * Conventions kept from the family pages (TasksListPage / EmployeeDetailPage):
 * - camelCase optional fields; missing value renders '—', never 0 or fake data;
 * - unknown enum values pass through verbatim (no machine translation);
 * - budget honesty (fork main a57232b): a null budget object shows '—',
 *   a configured-but-partial field shows 「未配置」, never USD 0.00;
 * - money formatting goes through fmtUsd only ('USD 120.00'), never CNY glyphs.
 */

export const MATRIX_LIFECYCLES = [
  'active',
  'onboarding',
  'paused',
  'offboarding',
  'draft',
  'archived',
] as const;

export type MatrixLifecycle = (typeof MATRIX_LIFECYCLES)[number];

export interface MatrixBudget {
  /** null/undefined = not configured for this period. */
  dailyTokens?: number | null;
  monthlyCostUsd?: number | null;
  perRunMaxUsd?: number | null;
  /** Display period label source, e.g. '2026-11'. Optional per contract. */
  period?: string;
}

export interface MatrixTodayRuns {
  total?: number;
  succeeded?: number;
  failed?: number;
}

export interface MatrixRisk {
  blockedApprovals?: number;
  failedRuns?: number;
  budgetOver?: boolean;
}

export interface MatrixEmployeeRow {
  employeeId: string;
  name?: string;
  /** Position/version reference, e.g. 'v3' or a version id. */
  versionRef?: string;
  lifecycle?: string;
  skillCount?: number;
  budget?: MatrixBudget | null;
  todayRuns?: MatrixTodayRuns | null;
  risk?: MatrixRisk | null;
}

export interface MatrixListBody {
  items?: MatrixEmployeeRow[] | null;
  nextCursor?: string | null;
}

/** lifecycle → locale key under agentConsole.v2.mtx.*; unknown → null. */
export const LIFECYCLE_KEY: Record<string, string> = {
  active: 'agentConsole.v2.mtx.stActive',
  onboarding: 'agentConsole.v2.mtx.stOnboarding',
  paused: 'agentConsole.v2.mtx.stPaused',
  offboarding: 'agentConsole.v2.mtx.stOffboarding',
  draft: 'agentConsole.v2.mtx.stDraft',
  archived: 'agentConsole.v2.mtx.stArchived',
};

export const LIFECYCLE_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  active: 'ok',
  onboarding: 'warn',
  paused: 'warn',
  offboarding: 'danger',
  draft: 'neutral',
  archived: 'neutral',
};

/** Budget honesty predicate mirroring EmployeeDetailPage (a57232b). */
export function isBudgetConfigured(b: MatrixBudget | null | undefined): b is MatrixBudget {
  return b != null && (b.dailyTokens != null || b.monthlyCostUsd != null || b.perRunMaxUsd != null);
}

/** Count of risk signals present on a row (0 = no risk). */
export function riskSignalCount(risk: MatrixRisk | null | undefined): number {
  if (!risk) return 0;
  let n = 0;
  if ((risk.blockedApprovals ?? 0) > 0) n += 1;
  if ((risk.failedRuns ?? 0) > 0) n += 1;
  if (risk.budgetOver === true) n += 1;
  return n;
}
