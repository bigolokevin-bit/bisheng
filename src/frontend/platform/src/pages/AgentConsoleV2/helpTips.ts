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
  /** SET-01: a write switch that cannot be read is unknown, not "off". */
  'settingsWriteUnknown',
  /** AUD-02: why a read-only detail page has no write action at all. */
  'aud02Readonly',
  /** AUD-02: the event id is the idempotency key (re-sends keep it). */
  'eventIdKey',
  /** AUD-02: tenant is shown in full because roles do not exist yet. */
  'tenantFull',
  /** AUD-02: responsible person vs actor, and the four responsibility states. */
  'responsible',
  /** AUD-02: a large object is referenced by key, never by content. */
  'payloadRef',
  /** AUD-02: `error.code` is a business class, not an internal error code. */
  'errClass',
  /** AUD-02: one hash cannot self-verify; the chain is checked per window. */
  'hashChain',
  /** AUD-02: an absent field drops its row; 「—」 means a value, not absence. */
  'absentField',
  /** EMP-02: permission is decided by the service, not by a clickable-if-lucky button. */
  'emp02Perm',
  /** EMP-02: a repeated submission returns the first result instead of failing. */
  'emp02Replay',
  /** TSK-03: the source is a record, not a choice — no channel to impersonate. */
  'tsk03Source',
  /** TSK-03: retrying the same submission never creates a second task. */
  'tsk03Replay',
] as const;

export type HelpTerm = (typeof HELP_TERMS)[number];

/** `agentConsole.v2.help.<term>.<part>` — the only key shape HelpTip resolves. */
export function helpKey(term: HelpTerm, part: 'title' | 'body'): string {
  return `agentConsole.v2.help.${term}.${part}`;
}