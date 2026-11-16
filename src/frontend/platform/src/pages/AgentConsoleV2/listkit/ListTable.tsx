/**
 * Shared table card + cursor pagination foot for the console list suite.
 *
 * Table: one card, padding 0; fixed column order supplied by the page;
 * horizontal hairlines only (last row none); <1280 scrolls INSIDE the card
 * while the page itself never overflows (AC §4: 375 表格横向滚动可用).
 *
 * Foot (无总数口径, spec §1.5): 「本页 N 条」 + caliber note + scroll hint +
 * explicit 「下一页」 (enabled only while nextCursor exists). No 「上一页」,
 * no pager, no 「共 N」/「a–b」 anywhere. The stale-guard variant replaces the
 * next button with the localized 「游标已失效」 + explicit reload-first.
 */
import type { ReactNode } from 'react';

import { LkIcon } from './icons';

export interface LkColumn {
  key: string;
  label: string;
  width?: number;
  align?: 'right';
}

export function TableCard({
  ariaLabel,
  columns,
  children,
  foot,
}: {
  ariaLabel: string;
  columns: LkColumn[];
  /** Rendered <tr> rows. */
  children: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="tblwrap">
        <table className="tbl" aria-label={ariaLabel}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={c.align === 'right' ? 'r' : undefined}
                  style={c.width ? { width: c.width } : undefined}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
      {foot}
    </div>
  );
}

export interface CursorFootProps {
  /** = current items.length; never claims a global total. */
  pageRowsText: string;
  /** 「游标分页 · 每页 N 条 · 无总数」 (limit-synced). */
  noteText: string;
  hintText: string;
  nextLabel: string;
  nextTitle: string;
  lastPageTitle: string;
  hasNext: boolean;
  loadingMore: boolean;
  onNext: () => void;
  /** Replay guard tripped — show stale copy + explicit reload-first. */
  stale: boolean;
  staleTitle: string;
  staleDesc: string;
  staleReloadLabel: string;
  onReloadFirst: () => void;
  /** Failed next page: rows stay, inline retry (HTTP code only). */
  nextErrorText?: string | null;
  retryLabel?: string;
  /** Second line: the data-caliber footnote. */
  caliberText?: string;
}

export function CursorFoot({
  pageRowsText,
  noteText,
  hintText,
  nextLabel,
  nextTitle,
  lastPageTitle,
  hasNext,
  loadingMore,
  onNext,
  stale,
  staleTitle,
  staleDesc,
  staleReloadLabel,
  onReloadFirst,
  nextErrorText,
  retryLabel,
  caliberText,
}: CursorFootProps) {
  return (
    <>
      <div className="rule" />
      <div className="rfoot" data-testid="lk-cursor-foot">
        <span className="pg" data-testid="lk-page-rows">
          {pageRowsText}
        </span>
        <span className="lg">{noteText}</span>
        <span className="tblhint">
          <LkIcon name="moveH" size={13} />
          {hintText}
        </span>
        <div className="sp" aria-hidden="true" />
        {stale ? (
          <span className="stale-note" role="alert" data-testid="lk-stale">
            <span>
              {staleTitle} {staleDesc}
            </span>
            <button type="button" className="b sm out" data-testid="lk-reload-first" onClick={onReloadFirst}>
              {staleReloadLabel}
            </button>
          </span>
        ) : (
          <>
            {nextErrorText ? (
              <span className="lg" role="alert" data-testid="lk-next-error" style={{ color: 'hsl(var(--danger))' }}>
                {nextErrorText}
                {retryLabel ? (
                  <button type="button" className="b xs gh" onClick={onNext} data-testid="lk-next-retry">
                    {retryLabel}
                  </button>
                ) : null}
              </span>
            ) : null}
            <button
              type="button"
              className="b sm out"
              disabled={!hasNext || loadingMore}
              aria-disabled={!hasNext || loadingMore || undefined}
              title={hasNext ? nextTitle : lastPageTitle}
              data-testid="lk-next"
              onClick={onNext}
            >
              {nextLabel} <LkIcon name="chevR" size={14} />
            </button>
          </>
        )}
      </div>
      {caliberText ? (
        <>
          <div className="rule" />
          <div className="rfoot is-caliber">
            <span className="lg">{caliberText}</span>
          </div>
        </>
      ) : null}
    </>
  );
}