/**
 * Shared, dependency-free help tip for console v2 (P1 batch2).
 *
 * A governance term (targetHash, bucketSum, 「口径」 …) is shown next to the
 * value it explains, as a visible 「?」 button that opens a real popover. The
 * component is presentation-only: it never fetches, never writes, and adds no
 * wrapper that changes a page's layout (an inline 14px circle sits inside the
 * existing label/header line).
 *
 * Interaction contract:
 * - hover shows (mouse), focus shows (Tab), click/tap toggles — so 375 works
 *   without a hover layer
 * - Escape closes and keeps focus on the button
 * - pointer-down outside closes; moving focus out of the tip closes
 * - `aria-label` always names the term, `aria-describedby` points at the open
 *   tooltip, `aria-expanded` tracks state (role="tooltip" on the popover)
 * - the popover is position:fixed and clamped into the viewport, so at 375 it
 *   never spills sideways and it flips above the anchor when the bottom is tight
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { helpKey, type HelpTerm } from './helpTips';

const EDGE = 8;

/** Always-present hook (P1 batch2 contract); a per-term `testId` is extra. */
export const HELPTIP_TESTID = 'agent-v2-helptip';

export interface HelpTipProps {
  term: HelpTerm;
  /** Extra stable hook for tests (`<testId>` on the button, `<testId>-pop` on the popover). */
  testId?: string;
  className?: string;
}

export function HelpTip({ term, testId, className = '' }: HelpTipProps) {
  const { t } = useTranslation();
  /* Three independent open reasons (hover / focus / pinned click) plus a
   * dismissal latch, so Escape can close while the button keeps focus and a
   * mouse-leave never fights a click-pinned tip. */
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLSpanElement | null>(null);
  const tipId = useId();

  const open = !dismissed && (hover || focused || pinned);

  const title = t(helpKey(term, 'title'));
  const body = t(helpKey(term, 'body'));

  const close = useCallback(() => {
    setHover(false);
    setFocused(false);
    setPinned(false);
    setDismissed(true);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (ev: Event) => {
      if (!wrapRef.current?.contains(ev.target as Node)) close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open, close]);

  /* Clamp into the viewport with the popover's real box (measured, not guessed):
   * centred under the button when it fits, pushed inside the 8px gutter when it
   * does not, flipped above the button when the bottom edge is tight. */
  useLayoutEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    const pop = popRef.current;
    if (!btn || !pop) return;
    const b = btn.getBoundingClientRect();
    const p = pop.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const maxLeft = Math.max(EDGE, vw - EDGE - p.width);
    const left = Math.min(Math.max(EDGE, b.left + b.width / 2 - p.width / 2), maxLeft);
    let top = b.bottom + 6;
    if (vh > 0 && top + p.height > vh - EDGE) {
      top = Math.max(EDGE, b.top - p.height - 6);
    }
    setPos({ top, left });
  }, [open]);

  return (
    <span
      className={`a2-ht${className ? ` ${className}` : ''}`}
      ref={wrapRef}
      onMouseEnter={() => {
        setDismissed(false);
        setHover(true);
      }}
      onMouseLeave={() => setHover(false)}
      onBlur={(ev) => {
        if (!wrapRef.current?.contains(ev.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <button
        ref={btnRef}
        type="button"
        className="a2-ht-btn"
        aria-label={`${title} · ${term}`}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        data-testid={testId ?? HELPTIP_TESTID}
        data-ht-id={testId}
        data-term={term}
        onFocus={() => {
          setDismissed(false);
          setFocused(true);
        }}
        onClick={() => {
          setDismissed(false);
          setPinned((v) => !v);
        }}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') {
            ev.stopPropagation();
            close();
          }
        }}
      >
        <span aria-hidden="true">?</span>
      </button>
      {open ? (
        <span
          ref={popRef}
          id={tipId}
          role="tooltip"
          className="a2-ht-pop"
          data-testid={testId ? `${testId}-pop` : 'agent-v2-helptip-pop'}
          data-term={term}
          style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
        >
          <span className="a2-ht-t">{title}</span>
          <span className="a2-ht-b">{body}</span>
        </span>
      ) : null}
    </span>
  );
}