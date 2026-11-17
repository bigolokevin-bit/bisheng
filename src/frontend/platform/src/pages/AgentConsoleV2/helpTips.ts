/**
 * Console v2 governance-term registry (P1 batch2).
 *
 * One place that names every term the console shows but never explains. The
 * copy lives in the locale bundles (`agentConsole.v2.help.<term>.title|body`,
 * zh-Hans / en-US / ja) so nothing is hardcoded in JSX and the three locales
 * cannot drift silently; this module only holds the term list + the key shape.
 *
 * What the copy may say: what the term means, where the number/value comes
 * from, and that missing data is shown as missing. It must NOT describe
 * behaviour that has not been verified against the service contract, and it
 * never invents a number or a threshold.
 */

export const HELP_TERMS = [
  /** AUD-01: why a read-only page has no export/modify entry at all. */
  'readonlyBanner',
  /** AUD-01: which actions enter the chain (prefix table lives backend-only). */
  'criticalChain',
  /** AUD-01: occurred_at closed/closed vs recorded_at half-open. */
  'twoWindows',
  /** AUD-01: the four conditions that allow a green chain verdict. */
  'greenGate',
  /** AUD-01: employee queries must pick a side (actor vs resource). */
  'empDimension',
  /** AUD-01: occurredAt vs recordedAt drift is a data-quality signal. */
  'clockSkew',
  /** AUD-01: `deny` (decision) is not `denied` (outcome). */
  'decisionPair',
  /** AUD-01: the four outcome values. */
  'outcomeEnum',
  /** AUD-01: the shown time is not the sort key; no column sorting. */
  'timeColumn',
  /** APR-02: hash of the change target this approval was raised for. */
  'targetHash',
  /** APR-02: digest of the message body the approval covers. */
  'messageDigest',
  /** APR-02: fields the response did not carry are simply not rendered. */
  'presentOnly',
  /** MET-01: sums of server-aggregated buckets, never page-by-page adds. */
  'bucketSum',
  /** MET-01: a KPI whose request has not returned yet is not a zero. */
  'pendingKpi',
  /** Any page: what a 「口径」 line is for. */
  'caliber',
  /** TSK-01 / APR-01: `human:` vs `employee:` actor-id prefixes. */
  'humanPrefix',
  /** TSK-01: the machine enum behind the 来源 column. */
  'sourceEnum',
  /** TSK-02: why the task detail has no write control at all. */
  'tsk02Readonly',
  /** TSK-02: one task has exactly one assignee; human ids have no name lookup. */
  'taskAssignee',
  /** TSK-02: `employeeVersionRef` is copy-only (no lookup-by-ref endpoint). */
  'taskVersionRef',
  /** TSK-02: audit requires a filter; `taskId` is the one this page passes. */
  'taskAuditFilter',
] as const;

export type HelpTerm = (typeof HELP_TERMS)[number];

/** `agentConsole.v2.help.<term>.<part>` — the only key shape HelpTip resolves. */
export function helpKey(term: HelpTerm, part: 'title' | 'body'): string {
  return `agentConsole.v2.help.${term}.${part}`;
}