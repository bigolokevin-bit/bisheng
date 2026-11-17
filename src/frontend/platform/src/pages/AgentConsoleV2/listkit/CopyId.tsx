/**
 * Shared mono-ID cell: visual truncation only — the full value stays in the
 * title and is what gets copied. Copy is keyboard-reachable (a real button)
 * and shows 「已复制」 for 1.2s (run01-target §1.4 column 1).
 */
import { useEffect, useRef, useState } from 'react';

import { LkIcon } from './icons';

export interface CopyIdProps {
  /** Full upstream value — copied verbatim, never the truncated display. */
  value: string;
  /** Same-origin jump target (the id itself becomes the link, no extra line). */
  href?: string;
  /** Accessible name for that link (defaults to the value). */
  linkLabel?: string;
  /** Visually truncated form. */
  display: string;
  ariaLabel: string;
  copiedLabel: string;
  testId?: string;
}

export function CopyId({
  value,
  display,
  ariaLabel,
  copiedLabel,
  testId,
  href,
  linkLabel,
}: CopyIdProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const copy = () => {
    try {
      void navigator.clipboard?.writeText(value);
    } catch {
      /* clipboard unavailable: the full value remains in title */
    }
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1200);
  };

  return (
    <span className={`cp${copied ? ' copied' : ''}`} title={value} data-testid={testId}>
      <button type="button" className="cc" aria-label={ariaLabel} onClick={copy}>
        <LkIcon name="copy" size={14} />
      </button>
      {href ? (
        <a className="vv" href={href} aria-label={linkLabel ?? value} title={value}>
          {display}
        </a>
      ) : (
        <span className="vv">{display}</span>
      )}
      <span className="tp" aria-hidden="true">
        {copiedLabel}
      </span>
    </span>
  );
}