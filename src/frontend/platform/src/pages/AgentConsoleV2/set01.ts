/* SET-01 `/agent/settings` — contract vocabulary and pure read helpers.
 *
 * Split out of the page for the same reason taskDetailKit.tsx exists: the page
 * file holds composition, this file holds the frozen lists (six groups, the
 * write switches, retention constants, the danger公示 rows) and the small pure
 * functions that turn a real BFF payload into a three-state reading.
 *
 * Honest-data rules encoded here (SET01-TARGET-SPEC §3, M2-PRD-DEEP §7):
 * - a boolean is never on/off only: 已开启 / 未开启 / 未知（本次未能读取）;
 * - a degraded source keeps `null` — the UI renders `—`, never 0;
 * - a rule is a contract constant (来源=契约) and is never presented as a
 *   runtime reading; where no endpoint exists the value is 未知, not a guess;
 * - nothing in this file fabricates a number, an id, a token or an upstream
 *   address.
 */
import type { HermesSummary } from '@/controllers/API/agentConsoleHermes';

import type { GroupPhase, SetIconName, SetTone } from './set01Kit';

/* ---------- six groups (order frozen by deep/07 §2.1) ---------- */

export type SectionId = 'tenant' | 'models' | 'policy' | 'integrations' | 'data' | 'danger';

export interface SectionDef {
  id: SectionId;
  icon: SetIconName;
  tone: SetTone;
  /** Rail item label. */
  labelKey: string;
  /** Text for the dot's aria-label (status is never colour-only). */
  dotKey: string;
}

const NS = 'agentConsole.v2.set01';

export const SET_SECTIONS: readonly SectionDef[] = [
  {
    id: 'tenant',
    icon: 'shield',
    tone: 'wr',
    labelKey: `${NS}.navTenant`,
    dotKey: `${NS}.dotTenant`,
  },
  {
    id: 'models',
    icon: 'server',
    tone: 'ok',
    labelKey: `${NS}.navModels`,
    dotKey: `${NS}.dotModels`,
  },
  {
    id: 'policy',
    icon: 'coins',
    tone: 'nt',
    labelKey: `${NS}.navPolicy`,
    dotKey: `${NS}.dotPolicy`,
  },
  {
    id: 'integrations',
    icon: 'bell',
    tone: 'wr',
    labelKey: `${NS}.navIntegrations`,
    dotKey: `${NS}.dotIntegrations`,
  },
  {
    id: 'data',
    icon: 'database',
    tone: 'ok',
    labelKey: `${NS}.navData`,
    dotKey: `${NS}.dotData`,
  },
  {
    id: 'danger',
    icon: 'alert',
    tone: 'nt',
    labelKey: `${NS}.navDanger`,
    dotKey: `${NS}.dotDanger`,
  },
];

export const DEFAULT_SECTION: SectionId = 'tenant';

export function isSectionId(value: string | undefined): value is SectionId {
  return !!value && SET_SECTIONS.some((s) => s.id === value);
}

export function sectionLabelKey(id: SectionId): string {
  return SET_SECTIONS.find((s) => s.id === id)?.labelKey ?? `${NS}.navTenant`;
}

/* ---------- run 2 · 写入开关（CR-M2-02 落地前全部未知） ---------- */

export interface WriteSwitch {
  id: string;
  labelKey: string;
  noteKey: string;
  /** Gap tag rendered next to the value (only where one is documented). */
  tag?: string;
}

export const WRITE_SWITCHES: readonly WriteSwitch[] = [
  { id: 'approval', labelKey: `${NS}.fWriteApproval`, noteKey: `${NS}.nWriteApproval` },
  { id: 'chat', labelKey: `${NS}.fWriteChat`, noteKey: `${NS}.nWriteChat` },
  { id: 'frontend', labelKey: `${NS}.fWriteFrontend`, noteKey: `${NS}.nWriteFrontend` },
  {
    id: 'token',
    labelKey: `${NS}.fWriteToken`,
    noteKey: `${NS}.nWriteToken`,
    tag: 'GAP-SET-05',
  },
];

/* ---------- /policy · rules only (POLICY §1.5) ---------- */

export interface RuleRowDef {
  id: string;
  icon: SetIconName;
  nmKey: string;
  whyKey: string;
  /** Optional in-product destination (a link, never a write control). */
  toKey?: string;
  toLinkKey?: string;
}

export const POLICY_RULES: readonly RuleRowDef[] = [
  {
    id: 'inherit',
    icon: 'info',
    nmKey: `${NS}.pInheritTitle`,
    whyKey: `${NS}.pInheritBody`,
    toKey: `${NS}.pInheritLink`,
    toLinkKey: '/agent/employees',
  },
  { id: 'ledger', icon: 'lock', nmKey: `${NS}.pLedgerTitle`, whyKey: `${NS}.pLedgerBody` },
  { id: 'stale', icon: 'clock', nmKey: `${NS}.pStaleTitle`, whyKey: `${NS}.pStaleBody` },
];

/* ---------- /data · retention constants (AUDIT §1.4 frozen table) ---------- */

export interface RetentionDef {
  id: string;
  labelKey: string;
  /** Either a mono value or a pill label — the shape says which. */
  kind: 'value' | 'pill';
  valueKey?: string;
  unitKey?: string;
  pillKey?: string;
  noteKey: string;
}

export const RETENTION_RULES: readonly RetentionDef[] = [
  {
    id: 'criticalHot',
    labelKey: `${NS}.rCriticalHot`,
    kind: 'value',
    valueKey: `${NS}.rCriticalHotV`,
    unitKey: `${NS}.unitDays`,
    noteKey: `${NS}.rCriticalHotN`,
  },
  {
    id: 'standard',
    labelKey: `${NS}.rStandard`,
    kind: 'value',
    valueKey: `${NS}.rStandardV`,
    unitKey: `${NS}.unitDays`,
    noteKey: `${NS}.rStandardN`,
  },
  {
    id: 'telemetry',
    labelKey: `${NS}.rTelemetry`,
    kind: 'value',
    valueKey: `${NS}.rTelemetryV`,
    unitKey: `${NS}.unitDays`,
    noteKey: `${NS}.rTelemetryN`,
  },
  {
    id: 'rawRef',
    labelKey: `${NS}.rRawRef`,
    kind: 'value',
    valueKey: `${NS}.rRawRefV`,
    unitKey: `${NS}.unitDays`,
    noteKey: `${NS}.rRawRefN`,
  },
  {
    id: 'snapshot',
    labelKey: `${NS}.rSnapshot`,
    kind: 'value',
    valueKey: `${NS}.rSnapshotV`,
    unitKey: `${NS}.unitDays`,
    noteKey: `${NS}.rSnapshotN`,
  },
  {
    id: 'exportCap',
    labelKey: `${NS}.rExportCap`,
    kind: 'value',
    valueKey: `${NS}.rExportCapV`,
    unitKey: `${NS}.unitRows`,
    noteKey: `${NS}.rExportCapN`,
  },
  {
    id: 'scanCap',
    labelKey: `${NS}.rScanCap`,
    kind: 'value',
    valueKey: `${NS}.rScanCapV`,
    unitKey: `${NS}.unitEvents`,
    noteKey: `${NS}.rScanCapN`,
  },
  {
    id: 'delete',
    labelKey: `${NS}.rDelete`,
    kind: 'pill',
    pillKey: `${NS}.rDeleteV`,
    noteKey: `${NS}.rDeleteN`,
  },
];

/* ---------- /integrations · alert policy rows (contract copy) ---------- */

export interface AlertRowDef {
  id: string;
  icon: SetIconName;
  nmKey: string;
  whyKey: string;
  pillKey?: string;
  linkToKey?: string;
  linkLabelKey?: string;
}

export const ALERT_ROWS: readonly AlertRowDef[] = [
  {
    id: 'recipient',
    icon: 'user',
    nmKey: `${NS}.aRecipientTitle`,
    whyKey: `${NS}.aRecipientBody`,
    linkLabelKey: `${NS}.viewInVersion`,
    linkToKey: '/agent/employees',
  },
  {
    id: 'quiet',
    icon: 'clock',
    nmKey: `${NS}.aQuietTitle`,
    whyKey: `${NS}.aQuietBody`,
    linkLabelKey: `${NS}.viewInVersion`,
    linkToKey: '/agent/employees',
  },
  {
    id: 'failClosed',
    icon: 'slash',
    nmKey: `${NS}.aFailClosedTitle`,
    whyKey: `${NS}.aFailClosedBody`,
    pillKey: `${NS}.aFailClosedPill`,
  },
];

/* ---------- /danger ·公示 only, zero clickable danger control ---------- */

export interface DangerRowDef {
  id: string;
  icon: SetIconName;
  nmKey: string;
  whyKey: string;
  /** Plain "去处" sentence when there is no in-product destination. */
  goKey: string;
  /** Optional in-product / external link label + target. */
  linkLabelKey?: string;
  linkTo?: string;
  /** Text after the link (kept separate so the link text stays clean). */
  goSuffixKey?: string;
}

export const DANGER_ROWS: readonly DangerRowDef[] = [
  {
    id: 'tenantSuspend',
    icon: 'slash',
    nmKey: `${NS}.dTenantTitle`,
    whyKey: `${NS}.dTenantBody`,
    goKey: `${NS}.dTenantGo`,
  },
  {
    id: 'employeeArchive',
    icon: 'users',
    nmKey: `${NS}.dArchiveTitle`,
    whyKey: `${NS}.dArchiveBody`,
    goKey: `${NS}.dArchiveGo`,
    linkLabelKey: `${NS}.dArchiveLink`,
    linkTo: '/agent/employees',
    goSuffixKey: `${NS}.dArchiveSuffix`,
  },
  {
    id: 'credentialRotate',
    icon: 'key',
    nmKey: `${NS}.dRotateTitle`,
    whyKey: `${NS}.dRotateBody`,
    goKey: `${NS}.dRotateGo`,
  },
  {
    id: 'auditOff',
    icon: 'shield',
    nmKey: `${NS}.dAuditTitle`,
    whyKey: `${NS}.dAuditBody`,
    goKey: `${NS}.dAuditGo`,
  },
  {
    id: 'modelReset',
    icon: 'server',
    nmKey: `${NS}.dModelTitle`,
    whyKey: `${NS}.dModelBody`,
    goKey: `${NS}.dModelGo`,
    linkLabelKey: `${NS}.dModelLink`,
    linkTo: '/model/management',
  },
];

/* ---------- /tenant · access contract rows (ADR-0011) ---------- */

export interface AccessRowDef {
  id: string;
  icon: SetIconName;
  nmKey: string;
  whyKey: string;
  pillKey?: string;
  tag?: string;
}

export const ACCESS_ROWS: readonly AccessRowDef[] = [
  {
    id: 'who',
    icon: 'user',
    nmKey: `${NS}.acWhoTitle`,
    whyKey: `${NS}.acWhoBody`,
    tag: 'ADR-0011',
  },
  {
    id: 'cross',
    icon: 'lock',
    nmKey: `${NS}.acCrossTitle`,
    whyKey: `${NS}.acCrossBody`,
  },
  {
    id: 'dept',
    icon: 'slash',
    nmKey: `${NS}.acDeptTitle`,
    whyKey: `${NS}.acDeptBody`,
    pillKey: `${NS}.acDeptPill`,
  },
];

/* ---------- read helpers ---------- */

/** Three states only — a read that has not returned is NOT "off". */
export type ReadState = 'ok' | 'degraded' | 'unknown';

export type HermesSourceKey = 'gateway_health' | 'dashboard_system' | 'dashboard_sessions_stats';

/**
 * `sources.<key>.state` straight from the runtime payload. A missing block or
 * a missing summary means 未知, never `ok` (and never a fabricated reason).
 */
export function hermesSourceState(
  summary: HermesSummary | null,
  key: HermesSourceKey,
): ReadState {
  const source = summary?.sources?.[key];
  if (!source) return 'unknown';
  return source.state === 'ok' ? 'ok' : 'degraded';
}

/** The runtime's degraded reason token, or null (shown in a title only). */
export function hermesSourceReason(
  summary: HermesSummary | null,
  key: HermesSourceKey,
): string | null {
  const source = summary?.sources?.[key];
  return source?.reason ?? null;
}

/**
 * Today's gateway request count. `null` is the runtime's own "degraded, value
 * unavailable" signal — it must render as `—`, never as 0 (E06).
 */
export function usageRequests(summary: HermesSummary | null): number | null {
  const value = summary?.gateway?.metrics_today?.requests;
  return typeof value === 'number' ? value : null;
}

/** `gateway.platform` verbatim; only the documented enum is localised. */
export function channelLabel(
  t: (key: string) => string,
  platform: string | null | undefined,
): string {
  if (!platform) return t(`${NS}.unknownRuntime`);
  if (platform === 'feishu') return t(`${NS}.channelFeishu`);
  return platform;
}

/** A read that failed with a status the group gate understands. */
export function phaseFromStatus(status: number): GroupPhase {
  if (status === 403) return 'forbidden';
  if (status === 404) return 'unsupported';
  return 'error';
}

/** Locale-aware integer grouping for the one real counter on this page. */
export function groupNumber(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}