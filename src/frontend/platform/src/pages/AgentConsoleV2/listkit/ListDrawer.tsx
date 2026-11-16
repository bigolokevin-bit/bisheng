/**
 * Shared right-side drawer for the console list suite. RUN-01 does not open
 * it (run detail belongs to RUN-02); TSK-01/MET-01 reuse it for row detail.
 * Esc / scrim click close; focus moves to the close button on open and back
 * to the previously focused element on close.
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { LkIcon } from './icons';

export interface ListDrawerProps {
  open: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}

export function ListDrawer({ open, title, closeLabel, onClose, children }: ListDrawerProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    restoreRef.current = document.activeElement;
    closeRef.current?.focus();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (restoreRef.current instanceof HTMLElement) restoreRef.current.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="lk-drawer-scrim" aria-hidden="true" onClick={onClose} />
      <aside className="lk-drawer" role="dialog" aria-modal="true" aria-label={title} data-testid="lk-drawer">
        <div className="lk-drawer-hd">
          <span className="t">{title}</span>
          <button type="button" className="b sm gh" ref={closeRef} aria-label={closeLabel} onClick={onClose}>
            <LkIcon name="x" size={16} />
          </button>
        </div>
        <div className="lk-drawer-bd">{children}</div>
      </aside>
    </>
  );
}