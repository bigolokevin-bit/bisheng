/**
 * COL-01 presentational parts for `/agent/collab`.
 *
 * Everything here renders ONLY what the wire carried: names come from the
 * employee directory, times from the chain, percentages from the owner's
 * ledger. Nothing is inferred, no amount is formatted, no enum text or raw id
 * reaches the page body (ids appear truncated inside copy controls whose title
 * holds the full value).
 */
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';

import { CopyId, LkIcon } from './listkit';
import {
  budgetBarWidth,
  budgetView,
  chainActor,
  isTerminal,
  noteLabelKey,
  phaseGlyph,
  phaseLabelKey,
  railStages,
  statusDotShape,
  statusLabelKey,
  statusTone,
  type BudgetView,
  type ChainRow,
  type DelegationBudget,
  type DelegationRow,
} from './collab';
import { fmtId } from './v2Data';
import { fmtStamp } from './collab';

const NS = 'agentConsole.v2.collab';

// ---------------------------------------------------------------- atoms

/** CJK name → first glyph; otherwise a neutral letter, never an empty circle. */
export function PetAvatar({ name }: { name: string }) {
  const trimmed = (name ?? '').trim();
  let glyph = '·';
  if (trimmed) {
    const first = Array.from(trimmed)[0] ?? '';
    glyph = /[\u3400-\u9fff]/.test(first) ? first : (Array.from(trimmed)[0] ?? '·').toUpperCase();
  }
  return <span className="ava" aria-hidden="true">{glyph}</span>;
}

export function StatusPill({ status, t, xs = false }: { status: string; t: TFunction; xs?: boolean }) {
  const tone = statusTone(status);
  const dot = statusDotShape(status);
  return (
    <span className={`pill ${tone}${xs ? ' xs' : ''}`}>
      <span className={`dot${dot === 'ring' ? ' ring' : ''}`} aria-hidden="true" />
      {t(statusLabelKey(status))}
    </span>
  );
}

/** 「已用 x%」 only inside the owner's ledger; no currency, ever. */
export function BudgetBlock({
  budget,
  ownerName,
  t,
}: {
  budget: DelegationBudget | null | undefined;
  ownerName: string;
  t: TFunction;
}) {
  const view: BudgetView = budgetView(budget);
  return (
    <div className="bud">
      <div className="budl">{t(`${NS}.detail.budgetOwner`, { name: ownerName })}</div>
      <div className="budv">
        {view.kind === 'pct' ? t(`${NS}.detail.budgetUsed`, { pct: view.pct }) : null}
        {view.kind === 'noLedger' ? t(`${NS}.detail.budgetUsed`, { pct: 0 }) : null}
        {view.kind === 'unconfigured' ? t(`${NS}.detail.budgetUnconfigured`) : null}
        {view.kind === 'unpriced' ? t(`${NS}.detail.budgetUnpriced`) : null}
      </div>
      <div className="budbar" aria-hidden="true">
        <i style={{ width: `${budgetBarWidth(view)}%` }} />
      </div>
      <div className="budn">
        {view.kind === 'noLedger'
          ? t(`${NS}.detail.budgetNoLedger`)
          : t(`${NS}.detail.budgetCap`, { name: ownerName })}
      </div>
      <p className="budnote">{t(`${NS}.detail.budgetNote`)}</p>
    </div>
  );
}

export function StageRail({ status, t }: { status: string; t: TFunction }) {
  const nodes = railStages(status);
  return (
    <ol className="srail" aria-label={t(`${NS}.detail.stageRail`)}>
      {nodes.map((node) => (
        <li
          key={node.key}
          className={`snode ${node.state}`}
          {...(node.state === 'current' ? { 'aria-current': 'step' as const } : {})}
        >
          <span className="sdot" aria-hidden="true">
            {node.state === 'done' ? <LkIcon name="check" /> : null}
          </span>
          <span className="sn">{t(statusLabelKey(node.key))}</span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- timeline

export interface TimelineRow {
  key: string;
  /** Heading already translated? no: keep the key so both branches stay i18n. */
  labelKey: string;
  timeKey: 'at' | 'notYet' | 'never' | 'none';
  at?: string;
  actor?: string;
  noteLabelKey?: string;
  note?: string;
  mergedLedgers?: number;
  tone: 'done' | 'current' | 'pending' | 'stop';
  glyph: 'check' | 'clock' | 'moveH' | 'x' | 'hist';
}

const STAGE_ORDER = ['requested', 'accepted', 'handed_off', 'completed'] as const;

function rankOf(phase: string): number | undefined {
  switch (phase) {
    case 'requested':
    case 'delegation.requested':
      return 0;
    case 'accepted':
    case 'delegation.accepted':
      return 1;
    case 'handed_off':
    case 'delegation.handed_off':
      return 2;
    case 'completed':
    case 'delegation.completed':
      return 3;
    default:
      return undefined;
  }
}

/** Chain rows first, then the stages that have not happened yet (已走过 keeps
 *  its own wording). A rejected delegation renders its remaining stages as
 *  「不发生」 instead of pretending they are still ahead. */
export function timelineRows(rows: ChainRow[], status: string, names: Map<string, string>, t: TFunction): TimelineRow[] {
  const out: TimelineRow[] = [];
  let maxRank = -1;
  for (const row of rows) {
    const rank = rankOf(row.phase);
    if (rank !== undefined && rank > maxRank) maxRank = rank;
    const charged = row.phase === 'charged-merged';
    out.push({
      key: `ev-${out.length}`,
      labelKey: phaseLabelKey(row.phase),
      timeKey: 'at',
      at: row.at,
      actor: charged ? undefined : chainActor(row.actor, names, t),
      noteLabelKey: charged ? undefined : noteLabelKey(row.phase),
      note: row.note,
      mergedLedgers: row.mergedLedgers,
      tone: charged ? 'done' : row.phase === 'rejected' || row.phase === 'delegation.rejected' ? 'stop' : 'done',
      glyph: phaseGlyph(row.phase),
    });
  }
  const rejected = status === 'rejected' || status === 'expired';
  const statusRank = rankOf(status);
  if (statusRank !== undefined && statusRank > maxRank) maxRank = statusRank;
  for (let rank = maxRank + 1; rank < STAGE_ORDER.length; rank += 1) {
    out.push({
      key: `pend-${rank}`,
      labelKey: statusLabelKey(STAGE_ORDER[rank]),
      timeKey: rejected ? 'never' : 'notYet',
      tone: 'pending',
      glyph: 'clock',
    });
  }
  return out;
}

export function Timeline({ rows, t }: { rows: TimelineRow[]; t: TFunction }) {
  if (!rows.length) {
    return <p className="tl-none">{t(`${NS}.chain.emptyBody`)}</p>;
  }
  return (
    <ol className="tl">
      {rows.map((row) => (
        <li key={row.key} className={`tlrow ${row.tone}`}>
          <span className="tdot" role="img" aria-label={t(row.labelKey)}>
            <LkIcon name={row.glyph} />
          </span>
          <div className="tlc">
            <div className="tlh">
              <span className="stg">{t(row.labelKey)}</span>
              <span className={`tm${row.timeKey === 'at' ? ' mono' : ''}`}>
                {row.timeKey === 'at'
                  ? fmtStamp(row.at)
                  : row.timeKey === 'notYet'
                    ? t(`${NS}.chain.notYet`)
                    : row.timeKey === 'never'
                      ? t(`${NS}.chain.never`)
                      : t(`${NS}.person.noActor`)}
              </span>
              {row.actor ? <span className="ppl">{row.actor}</span> : null}
            </div>
            {row.mergedLedgers ? (
              <div className="tln">
                <span className="k">{t(`${NS}.chain.chargedLine`)}</span>
                <span className="q">{t(`${NS}.chain.chargedMerged`, { count: row.mergedLedgers })}</span>
              </div>
            ) : null}
            {row.note ? (
              <div className="tln">
                <span className="k">{t(row.noteLabelKey ?? `${NS}.chain.noteLabel`)}</span>
                <span className="q">{row.note}</span>
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- detail

export function PersonLine({
  id,
  name,
  role,
  tag,
  tagTone,
  sub,
}: {
  id?: string;
  name: string;
  role: string;
  tag: string;
  tagTone: 'acc' | 'nt';
  sub: string;
}) {
  return (
    <div className="person">
      <span className="ava-lg" aria-hidden="true">
        {Array.from(name.trim())[0] ?? '·'}
      </span>
      <div className="pmeta">
        <div className="pname">
          <span className="nm">{name}</span>
          <span className={`tagx ${tagTone}`}>{tag}</span>
        </div>
        <div className="psub">
          {role ? `${role} · ` : ''}
          {sub}
        </div>
        <span className="pid mono" title={id}>{fmtId(id)}</span>
      </div>
    </div>
  );
}

export function TerminalLine({ status, t }: { status: string; t: TFunction }) {
  if (!isTerminal(status)) return null;
  return (
    <div className="endline">
      <LkIcon name="lock" />
      <span>
        {t(`${NS}.detail.terminal`, { status: t(statusLabelKey(status)) })} {t(`${NS}.detail.terminalTail`)}
      </span>
    </div>
  );
}

/** Read-only write surface: one sentence, zero controls (E06). */
export function WriteNote({ t }: { t: TFunction }) {
  return (
    <div className="wnote" data-testid="collab-write-note">
      <LkIcon name="lock" />
      <span>{t(`${NS}.write.closed`)}</span>
    </div>
  );
}

// ---------------------------------------------------------------- chrome

export function ReadonlyBanner({ t }: { t: TFunction }) {
  return (
    <div className="roband">
      <LkIcon name="lock" />
      <p>{t(`${NS}.banner.body`)}</p>
      <span className="mono">{t(`${NS}.banner.tail`)}</span>
    </div>
  );
}

export function CollabHead({
  fetchedAt,
  t,
  actions,
}: {
  fetchedAt?: string;
  t: TFunction;
  actions?: ReactNode;
}) {
  return (
    <header className="phead">
      <div>
        <h1 className="h1">{t(`${NS}.title`)}</h1>
        <p className="sub">{t(`${NS}.subtitle`)}</p>
      </div>
      <div className="fresh">
        <LkIcon name="clock" />
        <span>{t(`${NS}.fresh.at`)}</span>
        <span className="mono">{fetchedAt ? fmtStamp(fetchedAt) : t(`${NS}.fresh.none`)}</span>
        <span className="faint">·</span>
        <span>{t(`${NS}.fresh.source`)}</span>
        <span className="faint">·</span>
        <span>{t(`${NS}.fresh.manual`)}</span>
        {actions ? <span className="fresh-acts">{actions}</span> : null}
      </div>
    </header>
  );
}

export function CollabFoot({ t }: { t: TFunction }) {
  return (
    <footer className="pfoot">
      <span>{t(`${NS}.title`)}</span>
      <span className="sp" />
      <span>{t(`${NS}.foot.left`)}</span>
      <span className="mono">{t(`${NS}.foot.right`)}</span>
    </footer>
  );
}