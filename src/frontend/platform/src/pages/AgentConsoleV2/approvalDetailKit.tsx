/* APR-02 detail presentational kit: inline SVG icons, copy-id control, field
 * and na-panel primitives, and pure format helpers. Split from the page so
 * ApprovalDetailPage.tsx stays within its line budget; same a2d-* vocabulary
 * (approvalDetail.css), same tokens, no new colors. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApprovalAddedGrant } from './v2Data';

/* ---------- inline SVG icons (Lucide-style 1.5px, currentColor) ---------- */
export function I({ children, className = 'a2d-i' }: { children: ReactNode; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}
export const IChevL = <path d="m15 18-6-6 6-6" />;
export const ICopy = (
  <>
    <rect width="14" height="14" x="8" y="8" rx="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </>
);
export const IShield = <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />;
export const IClock = (
  <>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </>
);
export const ILock = (
  <>
    <rect width="18" height="11" x="3" y="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </>
);
export const IX = (
  <>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </>
);
export const IUndo = (
  <>
    <path d="M3 7v6h6" />
    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
  </>
);
export const ICheck = <path d="M20 6 9 17l-5-5" />;
export const IArrowR = (
  <>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </>
);
export const ILayers = (
  <>
    <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
    <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
    <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
  </>
);
export const ISend = (
  <>
    <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
    <path d="m21.854 2.147-10.94 10.939" />
  </>
);
export const IFile = (
  <>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M10 9H8" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
  </>
);
export const IInbox = (
  <>
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </>
);
export const IRefresh = (
  <>
    <path d="M3 12a9 9 0 1 1 9-9 9.75 9.75 0 0 1 6.36 2.64L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 1 1-9 9 9.75 9.75 0 0 1-6.36-2.64L3 16" />
    <path d="M8 16H3v5" />
  </>
);

/* ---------- helpers ---------- */
/** ap_ + first4 … last4 (target §1.2); short ids stay whole. */
export function fmtApprovalId(id: string): string {
  if (!id) return '—';
  return id.length > 12 ? `${id.slice(0, 7)}…${id.slice(-4)}` : id;
}

/** Human duration parts from whole seconds; <=0 is 「已结束」 (D-4). */
export function durationParts(seconds: number): { key: string; opts?: Record<string, number> } {
  if (!Number.isFinite(seconds) || seconds <= 0) return { key: 'agentConsole.v2.apd.ended' };
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return { key: 'agentConsole.v2.apd.durHoursMinutes', opts: { h, m } };
  if (h > 0) return { key: 'agentConsole.v2.apd.durHours', opts: { h } };
  if (m > 0) return { key: 'agentConsole.v2.apd.durMinutes', opts: { m } };
  return { key: 'agentConsole.v2.apd.durSeconds', opts: { s: seconds } };
}

export function ttlParts(seconds: number): { key: string; opts?: Record<string, number> } {
  if (!Number.isFinite(seconds) || seconds <= 0) return { key: 'agentConsole.v2.apd.durSeconds', opts: { s: 0 } };
  if (seconds % 3600 === 0) return { key: 'agentConsole.v2.apd.ttlHours', opts: { h: seconds / 3600 } };
  return { key: 'agentConsole.v2.apd.ttlMinutes', opts: { m: Math.round(seconds / 60) } };
}

export function grantParts(g: ApprovalAddedGrant | undefined): { types: string; actions: string } {
  return {
    types: (g?.resourceSelector?.types ?? []).join('/') || '—',
    actions: (g?.actions ?? []).join('/') || '—',
  };
}

/* ---------- copy value (keyboard reachable, full value copied) ---------- */
export function CopyValue({
  value,
  aria,
  inline,
  children,
}: {
  value: string;
  aria: string;
  inline?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);
  const doCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 1200);
  }, [value]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <span
      className={`a2d-cp a2-mono${inline ? ' inline' : ''}${state === 'copied' ? ' copied' : ''}${state === 'failed' ? ' failed' : ''}`}
      title={value}
    >
      {children ?? value}
      <span
        role="button"
        tabIndex={0}
        aria-label={aria}
        className="a2d-cc"
        onClick={() => void doCopy()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            void doCopy();
          }
        }}
      >
        <I className="a2d-i a2d-i13">{ICopy}</I>
      </span>
      <span role="status" className="a2d-tp">
        {state === 'copied'
          ? t('agentConsole.v2.apd.copied')
          : state === 'failed'
            ? t('agentConsole.v2.apd.copyFailed')
            : ''}
      </span>
    </span>
  );
}

export function Field({
  label,
  wide,
  mono,
  faint,
  title,
  help,
  children,
}: {
  label: string;
  wide?: boolean;
  mono?: boolean;
  faint?: boolean;
  title?: string;
  /** Optional help tip rendered inline after the label (P1 batch2). */
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`a2d-mfield${wide ? ' wide' : ''}`} title={title}>
      <div className="a2d-fl">
        <span>{label}</span>
        {help}
      </div>
      <div className={`a2d-fv${mono ? ' a2-mono' : ''}${faint ? ' a2d-faint' : ''}`}>{children}</div>
    </div>
  );
}

export function NaPanel({ icon, title, desc, testid }: { icon: ReactNode; title: string; desc: string; testid: string }) {
  return (
    <div className="a2d-na" data-testid={testid}>
      <span className="a2d-ic">
        <I className="a2d-i a2d-i20">{icon}</I>
      </span>
      <div className="a2d-nt">{title}</div>
      <div className="a2d-ns">{desc}</div>
    </div>
  );
}

/** Static loading skeleton (no shimmer animation, target §1.8 loading). */
export function DetailSkeleton({ note, aria }: { note: string; aria: string }) {
  return (
    <div className="a2s-page" data-testid="agent-v2-apd-loading" role="status" aria-label={aria}>
      <div className="a2d-skel" aria-hidden="true">
        <div className="a2d-backrow"><span className="a2d-sk" style={{ width: 120, height: 32 }} /></div>
        <span className="a2d-sk" style={{ width: 220, height: 32 }} />
        <span className="a2d-sk" style={{ width: 'min(420px, 100%)', height: 22 }} />
        <div className="a2d-skcard">
          <span className="a2d-sk" style={{ width: '30%' }} />
          <span className="a2d-sk" style={{ width: '88%' }} />
          <span className="a2d-sk" style={{ width: '72%' }} />
          <span className="a2d-sk" style={{ width: '60%' }} />
        </div>
        <div className="a2d-skcard">
          <span className="a2d-sk" style={{ width: '24%' }} />
          <span className="a2d-sk" style={{ width: '92%' }} />
          <span className="a2d-sk" style={{ width: '55%' }} />
        </div>
      </div>
      <p className="a2d-hd-note" style={{ textAlign: 'center' }}>{note}</p>
    </div>
  );
}
