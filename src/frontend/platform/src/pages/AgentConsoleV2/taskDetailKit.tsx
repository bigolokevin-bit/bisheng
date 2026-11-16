/* TSK-02 task-detail kit: contract vocabulary, pure formatters and the
 * read-only state-machine drawing, split out of the page so the page file
 * holds composition only (same idiom as runDetailKit.tsx /
 * approvalDetailKit.tsx).
 *
 * Discipline (TASK v1.0 is the only source of truth):
 * - labels come from the frozen five-value status enum and the channel map
 *   already used by TSK-01; an unlisted channel reads 「其他」, never a guess;
 * - `status_reason` / `progress_note` are read verbatim — a missing value is
 *   surfaced as an anomaly (page level), never replaced by a made-up sentence;
 * - the state machine is a *drawing of the contract*: five nodes, the six
 *   legal edges, the cancel bypass; the card contains no button, link or form
 *   control (E06) and the current node uses accent, not a status tone.
 */
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';

import type { TaskDetailStatus } from '@/controllers/API/agentConsoleTaskDetail';

/* ---------- contract vocabulary ---------- */

export const TASK_STATUSES: readonly TaskDetailStatus[] = [
  'open',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
];

/** Terminal states have no out-edge (TASK §2). */
export const TERMINAL_TASK_STATUSES: ReadonlySet<TaskDetailStatus> = new Set([
  'done',
  'cancelled',
]);

/** Status pill tone — TSK-01 shipped mapping (L0 ruling 2026-11-17). */
export function taskTone(status: TaskDetailStatus): '' | 'ok' | 'wr' | 'dg' | 'nt' {
  if (status === 'in_progress') return 'wr';
  if (status === 'blocked') return 'dg';
  if (status === 'done') return 'ok';
  if (status === 'cancelled') return 'nt';
  return '';
}

export function statusKey(status: TaskDetailStatus): string {
  return `agentConsole.v2.tsk.statusLabel.${status}`;
}

/** Unknown channels fall back to 「其他」 (same map as TSK-01). */
export const CHANNEL_KEYS: Record<string, string> = {
  feishu: 'agentConsole.v2.tsk.src.feishu',
  chat: 'agentConsole.v2.tsk.src.chat',
  manual: 'agentConsole.v2.tsk.src.manual',
  console: 'agentConsole.v2.tsk.src.console',
  system: 'agentConsole.v2.tsk.src.system',
};

export function channelLabel(t: TFunction, channel: string): string {
  const key = CHANNEL_KEYS[channel];
  return t(key ?? 'agentConsole.v2.tsk.src.other');
}

export function priorityKey(priority: string): string | null {
  if (priority === 'high') return 'agentConsole.v2.tsk02.priHigh';
  if (priority === 'low') return 'agentConsole.v2.tsk02.priLow';
  if (priority === 'normal') return 'agentConsole.v2.tsk02.priNormal';
  return null;
}

/* ---------- pure formatters ---------- */

/**
 * Mono ref truncation, TSK-02 §4: prefix + first 4 … last 4 for ULIDs
 * (`tk_01M7…S8J2`, `om_9f4c…4d95`, `rn_01M7…GPWJ`); cron-style schedule refs
 * keep their stable head/tail (`sch_202611…recalc`). The full value is always
 * in `title` and is what gets copied.
 */
export function shortTaskRef(id: string | null | undefined): string {
  if (!id) return '—';
  if (id.startsWith('sch_') && id.length > 16) return `${id.slice(0, 10)}…${id.slice(-6)}`;
  if (id.length <= 11) return id;
  return `${id.slice(0, 7)}…${id.slice(-4)}`;
}

const DAY_MS = 86_400_000;

/** Whole days between two instants (floor), never negative here. */
export function overdueDays(dueAt: string, nowMs: number): number | null {
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return null;
  if (due >= nowMs) return null;
  return Math.floor((nowMs - due) / DAY_MS);
}

/**
 * Due line caliber (target §1.3): the remaining/overdue figure is a local
 * derivation, stated as such; a terminal task stops computing it.
 */
export function dueNote(
  t: TFunction,
  dueAt: string | null | undefined,
  status: TaskDetailStatus,
  nowMs: number,
): string {
  if (!dueAt) return t('agentConsole.v2.tsk02.dueNoneNote');
  if (TERMINAL_TASK_STATUSES.has(status)) return t('agentConsole.v2.tsk02.dueTerminalNote');
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return t('agentConsole.v2.tsk02.dueDerivedNote');
  if (due <= nowMs) {
    const days = overdueDays(dueAt, nowMs) ?? 0;
    return days >= 1
      ? t('agentConsole.v2.tsk02.dueOverdueNote', { n: days })
      : t('agentConsole.v2.tsk02.dueOverdueToday');
  }
  const diff = due - nowMs;
  const days = Math.floor(diff / DAY_MS);
  const hours = Math.floor((diff % DAY_MS) / 3_600_000);
  return days > 0
    ? t('agentConsole.v2.tsk02.dueRemainDays', { d: days, h: hours })
    : t('agentConsole.v2.tsk02.dueRemainHours', { h: Math.max(1, hours) });
}

/* ---------- state machine (TASK §2, frozen table) ---------- */

type SmStatus = 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';

const NODES: Record<SmStatus, { x: number; y: number; w: number }> = {
  open: { x: 22, y: 47, w: 76 },
  in_progress: { x: 205, y: 47, w: 90 },
  blocked: { x: 177, y: 137, w: 76 },
  done: { x: 440, y: 47, w: 76 },
  cancelled: { x: 440, y: 137, w: 76 },
};

/** Legal edges 1–6 exactly as frozen; `from` drives the accent highlight. */
const EDGE_PATHS: { d: string; from: SmStatus }[] = [
  { d: 'M98 60 H200', from: 'open' },
  { d: 'M60 73 V110 H215 V135', from: 'open' },
  { d: 'M60 47 V20 H478 V44', from: 'open' },
  { d: 'M245 73 V135', from: 'in_progress' },
  { d: 'M295 60 H436', from: 'in_progress' },
  { d: 'M215 137 V76', from: 'blocked' },
];

/** Cancel bypass: three unfinished states → cancelled, needs a reason. */
const BYPASS_PATHS: { d: string; from: SmStatus }[] = [
  { d: 'M40 73 V182 H478 V166', from: 'open' },
  { d: 'M250 73 V182', from: 'in_progress' },
  { d: 'M215 163 V182', from: 'blocked' },
];

const NUMBERS: { n: string; x: number; y: number; from: SmStatus }[] = [
  { n: '1', x: 150, y: 54, from: 'open' },
  { n: '2', x: 150, y: 106, from: 'open' },
  { n: '3', x: 269, y: 15, from: 'open' },
  { n: '4', x: 232, y: 108, from: 'in_progress' },
  { n: '5', x: 366, y: 54, from: 'in_progress' },
  { n: '6', x: 198, y: 108, from: 'blocked' },
];

export interface SmEdge {
  n: string;
  label: string;
  guard: string;
  off?: boolean;
  byp?: boolean;
}

/**
 * Edge rows for the card. Normal (open / in_progress) renders the full frozen
 * table with the edges that do not start at the current state dimmed; the
 * other three states list only what is visible from where they stand, plus
 * the out-of-table transition that would be rejected — as text, never as a
 * clickable path (SPEC §2).
 */
export function smEdges(status: TaskDetailStatus, t: TFunction): SmEdge[] {
  const s = status as SmStatus;
  if (s === 'blocked') {
    return [
      {
        n: '6',
        label: t('agentConsole.v2.tsk02.sm.e6'),
        guard: t('agentConsole.v2.tsk02.sm.e6Guard'),
      },
      {
        n: '×',
        label: t('agentConsole.v2.tsk02.sm.bypBlocked'),
        guard: t('agentConsole.v2.tsk02.sm.bypGuard'),
        byp: true,
      },
      {
        n: '—',
        label: t('agentConsole.v2.tsk02.sm.blockedToDone'),
        guard: t('agentConsole.v2.tsk02.sm.blockedToDoneGuard'),
        off: true,
      },
    ];
  }
  if (s === 'done') {
    return [
      {
        n: '5',
        label: t('agentConsole.v2.tsk02.sm.e5'),
        guard: t('agentConsole.v2.tsk02.sm.e5DoneGuard'),
      },
      {
        n: '—',
        label: t('agentConsole.v2.tsk02.sm.doneToAny'),
        guard: t('agentConsole.v2.tsk02.sm.terminalNoOut'),
        off: true,
      },
      {
        n: '—',
        label: t('agentConsole.v2.tsk02.sm.doneToCancelled'),
        guard: t('agentConsole.v2.tsk02.sm.terminalNoCancel'),
        off: true,
      },
    ];
  }
  if (s === 'cancelled') {
    return [
      {
        n: '×',
        label: t('agentConsole.v2.tsk02.sm.bypAll'),
        guard: t('agentConsole.v2.tsk02.sm.bypCancelledGuard'),
        byp: true,
      },
      {
        n: '—',
        label: t('agentConsole.v2.tsk02.sm.cancelledToAny'),
        guard: t('agentConsole.v2.tsk02.sm.terminalNoOut'),
        off: true,
      },
      {
        n: '—',
        label: t('agentConsole.v2.tsk02.sm.cancelledToCancelled'),
        guard: t('agentConsole.v2.tsk02.sm.terminalNoCancel'),
        off: true,
      },
    ];
  }
  const rows: SmEdge[] = [
    { n: '1', label: t('agentConsole.v2.tsk02.sm.e1'), guard: t('agentConsole.v2.tsk02.sm.e1Guard') },
    { n: '2', label: t('agentConsole.v2.tsk02.sm.e2'), guard: t('agentConsole.v2.tsk02.sm.e2Guard') },
    { n: '3', label: t('agentConsole.v2.tsk02.sm.e3'), guard: t('agentConsole.v2.tsk02.sm.e3Guard') },
    { n: '4', label: t('agentConsole.v2.tsk02.sm.e4'), guard: t('agentConsole.v2.tsk02.sm.e2Guard') },
    { n: '5', label: t('agentConsole.v2.tsk02.sm.e5'), guard: t('agentConsole.v2.tsk02.sm.e3Guard') },
    { n: '6', label: t('agentConsole.v2.tsk02.sm.e6'), guard: t('agentConsole.v2.tsk02.sm.e6Guard') },
    {
      n: '×',
      label: t('agentConsole.v2.tsk02.sm.bypAll'),
      guard: t('agentConsole.v2.tsk02.sm.bypGuard'),
      byp: true,
    },
  ];
  // Edges that do not start at the current state stay visible but dimmed.
  const origin: Record<string, SmStatus> = { '1': 'open', '2': 'open', '3': 'open', '4': 'in_progress', '5': 'in_progress', '6': 'blocked', '×': s === 'open' ? 'open' : 'in_progress' };
  for (const row of rows) {
    if (row.byp) continue;
    if (origin[row.n] !== s) row.off = true;
  }
  return rows;
}

export function smTerms(status: TaskDetailStatus, t: TFunction): string[] {
  if (status === 'done') {
    return [
      t('agentConsole.v2.tsk02.sm.termDone1'),
      t('agentConsole.v2.tsk02.sm.termDone2'),
    ];
  }
  if (status === 'cancelled') {
    return [
      t('agentConsole.v2.tsk02.sm.termCancelled1'),
      t('agentConsole.v2.tsk02.sm.termCancelled2'),
    ];
  }
  return [
    t('agentConsole.v2.tsk02.sm.term1'),
    t('agentConsole.v2.tsk02.sm.term2'),
    t('agentConsole.v2.tsk02.sm.term3'),
    t('agentConsole.v2.tsk02.sm.term4'),
  ];
}

/** One-line "where can it go" statement — a description, not an entry. */
export function smFoot(status: TaskDetailStatus, t: TFunction): string {
  if (TERMINAL_TASK_STATUSES.has(status)) {
    return t('agentConsole.v2.tsk02.sm.footTerminal', {
      status: t(statusKey(status)),
    });
  }
  if (status === 'blocked') {
    return t('agentConsole.v2.tsk02.sm.footBlocked', { status: t(statusKey(status)) });
  }
  return t('agentConsole.v2.tsk02.sm.footOpen', {
    status: t(statusKey(status)),
    to: t(
      status === 'open'
        ? 'agentConsole.v2.tsk02.sm.toFromOpen'
        : 'agentConsole.v2.tsk02.sm.toFromProgress',
    ),
  });
}

/** The five-node graph. Hidden below 768px (the numbered edge table carries it). */
export function StateGraph({
  status,
  label,
  t,
}: {
  status: TaskDetailStatus;
  label: string;
  t: TFunction;
}) {
  const cur = status as SmStatus;
  const node = (key: SmStatus) => {
    const n = NODES[key];
    const terminal = key === 'done' || key === 'cancelled';
    return (
      <g key={key}>
        <rect
          className={`a2t-nd${key === cur ? ' cur' : ''}${terminal ? ' term' : ''}`}
          x={n.x}
          y={n.y}
          width={n.w}
          height={26}
          rx={8}
        />
        {terminal ? (
          <rect
            className={`a2t-nd inner${key === cur ? ' cur' : ''}`}
            x={n.x + 4}
            y={n.y + 4}
            width={n.w - 8}
            height={18}
            rx={6}
          />
        ) : null}
        <text
          className={`a2t-lbl${key === cur ? ' cur' : ''}`}
          x={n.x + n.w / 2}
          y={n.y + 17}
          textAnchor="middle"
        >
          {t(statusKey(key))}
        </text>
      </g>
    );
  };
  return (
    <svg
      className="a2t-smg"
      viewBox="0 0 560 200"
      role="img"
      aria-label={label}
      data-testid="agent-v2-task-smgraph"
    >
      {EDGE_PATHS.map((e, i) => (
        <path
          key={`e${i}`}
          className={`a2t-eg${e.from === cur ? ' on' : ''}`}
          d={e.d}
        />
      ))}
      {BYPASS_PATHS.map((e, i) => (
        <path
          key={`b${i}`}
          className={`a2t-eg by${e.from === cur ? ' on' : ''}`}
          d={e.d}
        />
      ))}
      {(['open', 'in_progress', 'blocked', 'done', 'cancelled'] as SmStatus[]).map(node)}
      {NUMBERS.map((n) => (
        <text
          key={`n${n.n}`}
          className={`a2t-num${n.from === cur ? ' on' : ''}`}
          x={n.x}
          y={n.y}
          textAnchor="middle"
        >
          {n.n}
        </text>
      ))}
      <text className="a2t-cap" x={330} y={196} textAnchor="middle">
        {t('agentConsole.v2.tsk02.sm.bypassCap')}
      </text>
    </svg>
  );
}

/* ---------- small presentational pieces ---------- */

/** Status pill: dot + text; cancelled uses a mono dash (never color alone). */
export function TaskPill({
  status,
  t,
  testId,
  xs,
}: {
  status: TaskDetailStatus;
  t: TFunction;
  testId?: string;
  xs?: boolean;
}) {
  const tone = taskTone(status);
  const cancelled = status === 'cancelled';
  return (
    <span
      className={`pill${tone ? ` ${tone}` : ''}${xs ? ' xs' : ''}`}
      title={t(`agentConsole.v2.tsk02.statusNote.${status}`)}
      data-testid={testId}
      data-status={status}
    >
      {cancelled ? (
        <span className="dash" aria-hidden="true">
          —
        </span>
      ) : (
        <span className="dot" aria-hidden="true" />
      )}
      {t(statusKey(status))}
    </span>
  );
}

/** Key/value row used by the source / related / audit / caliber cards. */
export function KV({
  k,
  children,
  testId,
}: {
  k: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="a2t-row" data-testid={testId}>
      <span className="a2t-k">{k}</span>
      <span className="a2t-v">{children}</span>
    </div>
  );
}