/**
 * Shared state screens for the console list suite (run01-target §1.6):
 * loading skeleton (NO animation — static --surface-2 blocks, never mistaken
 * for data), in-card empty panel (filters stay on screen), and the centered
 * error / forbidden stage cards. Copy is supplied by the page (localized,
 * HTTP code only — upstream machine codes never reach the DOM).
 */
import type { ReactNode } from 'react';

import { LkIcon } from './icons';

/** Static skeleton: filter-bar blocks + six row blocks + the honesty note. */
export function ListSkeleton({ ariaLabel, note }: { ariaLabel: string; note: string }) {
  const widths = ['18%', '16%', '20%', '15%', '19%', '17%'];
  return (
    <div className="skel" role="status" aria-label={ariaLabel} data-testid="lk-skeleton">
      <div className="fbar" aria-hidden="true">
        <div className="bar" style={{ width: 88, height: 32 }} />
        <div className="bar" style={{ width: 360, maxWidth: '60%', height: 30 }} />
        <div className="bar" style={{ width: 180, height: 32 }} />
        <div className="sp" />
        <div className="bar" style={{ width: 96 }} />
      </div>
      <div className="card" style={{ padding: 0 }} aria-hidden="true">
        {widths.map((w, i) => (
          // Static skeleton rows: index keys are stable (no reordering).
          <div className="srow-skel" key={i}>
            <div className="bar" style={{ width: w }} />
            <div className="bar" style={{ width: 72 }} />
            <div className="bar" style={{ width: 64 }} />
            <div className="bar" style={{ width: 56, marginLeft: 'auto' }} />
            <div className="bar" style={{ width: 96 }} />
            <div className="bar" style={{ width: 88 }} />
          </div>
        ))}
      </div>
      <div className="skel-note">{note}</div>
    </div>
  );
}

/** In-card empty panel — the filter bar above stays visible and active. */
export function EmptyPanel({
  title,
  desc,
  actionLabel,
  onAction,
}: {
  title: string;
  desc: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="empty" data-testid="lk-empty">
        <span className="ic" aria-hidden="true">
          <LkIcon name="inbox" size={20} />
        </span>
        <div className="t">{title}</div>
        <div className="s">{desc}</div>
        {actionLabel && onAction ? (
          <button type="button" className="b out" data-testid="lk-empty-action" onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Centered single-card stage (error / forbidden). desc may embed the mono
 *  HTTP code; children are the action buttons. */
export function StageCard({
  icon,
  title,
  desc,
  children,
  testId,
}: {
  icon: 'alert' | 'lock';
  title: string;
  desc: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="card stage" data-testid={testId}>
      <span className="ic" aria-hidden="true">
        <LkIcon name={icon} size={20} />
      </span>
      <div className="t">{title}</div>
      <div className="s">{desc}</div>
      {children ? <div className="acts2">{children}</div> : null}
    </div>
  );
}