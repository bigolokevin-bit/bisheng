/**
 * Shared FilterBar (V2.10, cross-page identical structure) for the console
 * list suite. Only REAL server-side dimensions are ever rendered as controls:
 * a dimension without an upstream parameter is passed in `disabled` with a
 * reason title — never a client-side fake filter (L6 C-3). No free-text
 * search and no sort control unless the page explicitly supplies them.
 *
 * Structure (run01-target §1.3): select chips → status chips (single-select,
 * no counts — no total source) → seg → trailing selects → spacer → clear →
 * 「已加载 N 条」 (loaded count only, never 「共 N 条」).
 */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { LkIcon } from './icons';

export interface LkOption {
  value: string;
  label: string;
}

export interface LkSelectSpec {
  id: string;
  /** Button text, already resolved by the page (e.g. 「员工：小鲤」). */
  label: string;
  title?: string;
  value: string;
  options: LkOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  disabledTitle?: string;
  /** Has a non-default value → accent 「带值态」. */
  active?: boolean;
}

export interface LkChipSpec {
  value: string;
  label: string;
  /** Semantic tone class suffix (s-pend/s-run/s-done/s-fail/s-cancel/s-int). */
  tone?: string;
  dot?: boolean;
}

export interface LkSegItem {
  value: string;
  label: string;
}

/** One outline select chip with a real listbox popup (施工弹层). */
export function LkSelect({ spec }: { spec: LkSelectSpec }) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (ev: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(ev.target as Node)) setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (value: string) => {
    spec.onChange(value);
    setOpen(false);
  };

  const onKeyDown = (ev: ReactKeyboardEvent) => {
    if (spec.disabled) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIdx(Math.max(0, spec.options.findIndex((o) => o.value === spec.value)));
        return;
      }
      setActiveIdx((i) => {
        const n = spec.options.length;
        return ev.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n;
      });
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      if (open && activeIdx >= 0 && spec.options[activeIdx]) pick(spec.options[activeIdx].value);
      else setOpen((v) => !v);
    }
  };

  return (
    <div className="lk-selwrap" ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className={`fsel${spec.active ? ' on' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={spec.disabled}
        aria-disabled={spec.disabled || undefined}
        title={spec.disabled ? spec.disabledTitle : spec.title}
        data-testid={spec.id}
        onClick={() => !spec.disabled && setOpen((v) => !v)}
        onKeyDown={onKeyDown}
      >
        {spec.label} <LkIcon name="chevD" size={13} />
      </button>
      {open && !spec.disabled ? (
        <ul className="lk-pop" role="listbox" aria-label={spec.label} data-testid={`${spec.id}-pop`}>
          {spec.options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === spec.value}
              className={i === activeIdx ? 'is-active' : undefined}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => pick(o.value)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export interface FilterBarProps {
  ariaLabel: string;
  /** Leading selects (e.g. employee). */
  selectsBefore?: LkSelectSpec[];
  chips?: {
    ariaLabel: string;
    items: LkChipSpec[];
    value: string;
    onChange: (value: string) => void;
    /** The 「全部」 chip value (neutral, no dot). */
    allValue: string;
    allLabel: string;
  };
  seg?: {
    ariaLabel: string;
    items: LkSegItem[];
    value: string;
    onChange: (value: string) => void;
  };
  /** Trailing selects (e.g. limit, disabled source). */
  selectsAfter?: LkSelectSpec[];
  clear?: {
    label: string;
    disabled: boolean;
    title: string;
    onClear: () => void;
  };
  /** 「已加载 N 条」 — loaded count only, never a total/denominator. */
  count?: { pre: string; post: string; n: number };
}

export function FilterBar({
  ariaLabel,
  selectsBefore,
  chips,
  seg,
  selectsAfter,
  clear,
  count,
}: FilterBarProps) {
  return (
    <div className="fbar" role="search" aria-label={ariaLabel} data-testid="lk-filterbar">
      {selectsBefore?.map((s) => <LkSelect key={s.id} spec={s} />)}
      {chips ? (
        <div className="fchips" role="group" aria-label={chips.ariaLabel}>
          <button
            type="button"
            className="fchip"
            aria-pressed={chips.value === chips.allValue}
            data-testid="lk-chip-all"
            onClick={() => chips.onChange(chips.allValue)}
          >
            {chips.allLabel}
          </button>
          {chips.items.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`fchip${c.tone ? ` ${c.tone}` : ''}`}
              aria-pressed={chips.value === c.value}
              data-testid={`lk-chip-${c.value}`}
              onClick={() => chips.onChange(c.value)}
            >
              {c.dot ? <span className="dot" aria-hidden="true" /> : null}
              {c.label}
            </button>
          ))}
        </div>
      ) : null}
      {seg ? (
        <div className="seg" role="group" aria-label={seg.ariaLabel}>
          {seg.items.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-pressed={seg.value === s.value}
              data-testid={`lk-seg-${s.value}`}
              onClick={() => seg.onChange(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      ) : null}
      {selectsAfter?.map((s) => <LkSelect key={s.id} spec={s} />)}
      <div className="sp" aria-hidden="true" />
      {clear ? (
        <button
          type="button"
          className="b gh sm"
          disabled={clear.disabled}
          aria-disabled={clear.disabled || undefined}
          title={clear.title}
          data-testid="lk-clear"
          onClick={clear.onClear}
        >
          {clear.label}
        </button>
      ) : null}
      {count ? (
        <span className="fres" data-testid="lk-loaded">
          {count.pre} <b>{count.n}</b> {count.post}
        </span>
      ) : null}
    </div>
  );
}