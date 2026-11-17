/* SET-01 kit: the settings page's own icon set, status dots, source chips and
 * the four-state group gate, split out so SettingsPage.tsx holds composition
 * only (same idiom as taskDetailKit.tsx / runDetailKit.tsx).
 *
 * Scope discipline:
 * - everything here is presentation: no fetch, no write, no state machine of
 *   its own beyond the gate's render switch;
 * - colours resolve through the existing agentConsoleV2.css tokens (no new hex
 *   value anywhere), so dark/light stay one DOM with only tokens swapped;
 * - the gate is the ONLY place that can replace a whole group: 403 and 404
 *   render a stage card instead of field skeletons (red line 4: never render
 *   skeletons and then drop them), while a plain read failure stays an in-card
 *   error bar so navigation and the other groups survive (S-10).
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

/** Lucide-style 1.5px stroke symbols used by the settings page. */
const PATHS: Record<string, ReactNode> = {
  cfg: (
    <>
      <line x1="4" x2="4" y1="21" y2="14" />
      <line x1="4" x2="4" y1="10" y2="3" />
      <line x1="12" x2="12" y1="21" y2="12" />
      <line x1="12" x2="12" y1="8" y2="3" />
      <line x1="20" x2="20" y1="21" y2="16" />
      <line x1="20" x2="20" y1="12" y2="3" />
      <line x1="2" x2="6" y1="14" y2="14" />
      <line x1="10" x2="14" y1="8" y2="8" />
      <line x1="18" x2="22" y1="16" y2="16" />
    </>
  ),
  shield: (
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
  ),
  shieldCheck: (
    <>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  server: (
    <>
      <rect width="20" height="8" x="2" y="2" rx="2" />
      <rect width="20" height="8" x="2" y="14" rx="2" />
      <line x1="6" x2="6.01" y1="6" y2="6" />
      <line x1="6" x2="6.01" y1="18" y2="18" />
    </>
  ),
  coins: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
      <path d="M7 6h1v4" />
      <path d="m16.71 13.88.7.71-2.82 2.82" />
    </>
  ),
  bell: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </>
  ),
  alert: (
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  key: (
    <>
      <path d="m21 2-2 2" />
      <path d="m18.5 4.5 2 2" />
      <path d="M15.5 7.5 18 10" />
      <path d="M14 12.5a5.5 5.5 0 1 0-7.78 7.78 5.5 5.5 0 0 0 7.78-7.78z" />
      <path d="m9 9 3 3" />
    </>
  ),
  plug: (
    <>
      <path d="M12 22v-4" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v4a6 6 0 0 1-12 0V8Z" />
    </>
  ),
  slash: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m4.9 4.9 14.2 14.2" />
    </>
  ),
  user: (
    <>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  lock: (
    <>
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  refresh: (
    <>
      <path d="M3 12a9 9 0 1 1 9-9 9.75 9.75 0 0 1 6.36 2.64L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 1 1-9 9 9.75 9.75 0 0 1-6.36-2.64L3 16" />
      <path d="M8 16H3v5" />
    </>
  ),
  ext: (
    <>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </>
  ),
  hist: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </>
  ),
};

export type SetIconName = keyof typeof PATHS;

export function SetIcon({ name, size = 16 }: { name: SetIconName; size?: number }) {
  return (
    <svg
      className="lk-i"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** Tone vocabulary shared with the list suite pills (ok / wr / dg / nt). */
export type SetTone = 'ok' | 'wr' | 'dg' | 'nt';

/**
 * Status dot for the secondary navigation. Colour is never the only signal:
 * every dot carries role="img" + an aria-label, and the group's own cards
 * repeat the status in words (SPEC §1.3).
 */
export function SDot({ tone, label, testId }: { tone: SetTone; label: string; testId?: string }) {
  return (
    <span
      className={`s1dot ${tone}`}
      role="img"
      aria-label={label}
      title={label}
      data-testid={testId}
    />
  );
}

/** 「来源=契约 / 非运行时读数」 tag — keeps rules and readings apart (E04). */
export function SrcChip({ tag, children }: { tag: string; children?: ReactNode }) {
  return (
    <span className="s1src">
      <span className="s1src-tag">{tag}</span>
      {children}
    </span>
  );
}

/**
 * Card shell: icon + title (+ mono badge) + right-side action/note, a rule,
 * the body and an optional footer. No write control is ever passed here — the
 * `action` slot is reserved for a read-only probe or an outbound link.
 */
export function SetCard({
  icon,
  title,
  badge,
  note,
  action,
  foot,
  testId,
  children,
}: {
  icon: SetIconName;
  title: string;
  badge?: string;
  note?: ReactNode;
  action?: ReactNode;
  foot?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div className="card" style={{ padding: 0 }} data-testid={testId}>
      <div className="a2r-ch">
        <span className="a2r-cht">
          <SetIcon name={icon} size={18} />
          {title}
        </span>
        {badge ? <span className="a2r-chc mono">{badge}</span> : null}
        <span className="a2r-sp" />
        {action}
        {note ? <span className="a2r-chn">{note}</span> : null}
      </div>
      <div className="rule" />
      {children}
      {foot ? <div className="a2r-cf">{foot}</div> : null}
    </div>
  );
}

/** One row of a rule / access / danger list: icon, name, optional pill, body. */
export function SetRow({
  icon,
  title,
  pill,
  pillTone,
  tag,
  end,
  testId,
  children,
}: {
  icon: SetIconName;
  title: string;
  pill?: string;
  pillTone?: SetTone;
  tag?: string;
  end?: ReactNode;
  testId?: string;
  children?: ReactNode;
}) {
  return (
    <div className="s1row" data-testid={testId}>
      <span className="ic" aria-hidden="true">
        <SetIcon name={icon} size={18} />
      </span>
      <div className="bd">
        <div className="hd">
          <span className="nm">{title}</span>
          {pill ? (
            <span className={`pill ${pillTone ?? 'nt'} xs`}>
              <span className="dot" aria-hidden="true" />
              {pill}
            </span>
          ) : null}
          {tag ? <SrcChip tag={tag} /> : null}
        </div>
        {children}
      </div>
      {end ? <div className="end">{end}</div> : null}
    </div>
  );
}

/* ---------- four-state group gate ---------- */

export type GroupPhase = 'loading' | 'ready' | 'error' | 'forbidden' | 'unsupported';

export interface GroupGateProps {
  phase: GroupPhase;
  /** Group title, used by the error bar and both stage cards. */
  label: string;
  httpStatus?: number;
  requestId?: string | null;
  onRetry?: () => void;
  testIdPrefix: string;
  children: ReactNode;
}

/**
 * Renders one group. `ready` children are the only path that draws field
 * values; 403/404 replace the group outright (never after a skeleton), and a
 * plain failure keeps the group card but says what failed inside it.
 */
export function GroupGate({
  phase,
  label,
  httpStatus = 0,
  requestId = null,
  onRetry,
  testIdPrefix,
  children,
}: GroupGateProps) {
  const { t } = useTranslation();
  const code = httpStatus > 0 ? `HTTP ${httpStatus}` : t('agentConsole.v2.set01.networkError');

  if (phase === 'loading') {
    return (
      <div
        className="skel s1skel"
        role="status"
        aria-label={t('agentConsole.v2.set01.loadingAria')}
        data-testid={`${testIdPrefix}-loading`}
      >
        <div className="card" style={{ padding: 0 }}>
          <div className="a2r-ch">
            <span className="bar" style={{ width: 120, height: 14 }} />
            <span className="a2r-sp" />
            <span className="bar" style={{ width: 160, height: 12 }} />
          </div>
          <div className="rule" />
          <div className="s1sk-row">
            <span className="bar" style={{ width: '60%' }} />
          </div>
          <div className="s1sk-row">
            <span className="bar" style={{ width: '48%' }} />
          </div>
          <div className="s1sk-row">
            <span className="bar" style={{ width: '70%' }} />
          </div>
        </div>
        <p className="s1sk-note">{t('agentConsole.v2.set01.loadingNote')}</p>
      </div>
    );
  }

  if (phase === 'forbidden' || phase === 'unsupported') {
    const forbidden = phase === 'forbidden';
    return (
      <div className="card stage" data-testid={`${testIdPrefix}-${forbidden ? 'forbidden' : 'unsupported'}`}>
        <span className="ic" aria-hidden="true">
          <SetIcon name={forbidden ? 'lock' : 'slash'} size={20} />
        </span>
        <div className="t">
          {t(
            forbidden
              ? 'agentConsole.v2.set01.forbiddenTitle'
              : 'agentConsole.v2.set01.notProvidedTitle',
          )}
        </div>
        <div className="s">
          {forbidden ? (
            <>
              {t('agentConsole.v2.set01.forbiddenDescPre')}
              {label}
              {t('agentConsole.v2.set01.forbiddenDescPost')}
              <span className="mono">{code}</span>
              {t('agentConsole.v2.set01.forbiddenDescTail')}
            </>
          ) : (
            <>
              {t('agentConsole.v2.set01.notProvidedDescPre')}
              <span className="mono">{code}</span>
              {t('agentConsole.v2.set01.notProvidedDescPost')}
            </>
          )}
        </div>
        <div className="acts2">
          {forbidden && onRetry ? (
            <button
              type="button"
              className="b out"
              data-testid={`${testIdPrefix}-forbidden-retry`}
              onClick={onRetry}
            >
              <SetIcon name="refresh" size={16} />
              {t('agentConsole.v2.set01.forbiddenRetry')}
            </button>
          ) : (
            <Link className="b out" to="/agent/settings/tenant">
              {t('agentConsole.v2.set01.notProvidedBack')}
            </Link>
          )}
        </div>
        <div className="s1stage-note">
          {t(
            forbidden
              ? 'agentConsole.v2.set01.forbiddenNote'
              : 'agentConsole.v2.set01.notProvidedNote',
          )}
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="card" style={{ padding: 0 }} data-testid={`${testIdPrefix}-error`}>
        <div className="a2r-ch">
          <span className="a2r-cht">{label}</span>
          <span className="a2r-sp" />
          <span className="a2r-chn">{t('agentConsole.v2.set01.errGroupNote')}</span>
        </div>
        <div className="s1err" role="alert">
          <SetIcon name="alert" size={14} />
          <span className="tx">
            {t('agentConsole.v2.set01.errBodyPre')}
            <span className="mono">{code}</span>
            {t('agentConsole.v2.set01.errBodyPost')}
          </span>
          {requestId ? (
            <span className="rid">
              {t('agentConsole.v2.set01.errReqLabel')} <span className="mono">{requestId}</span>
            </span>
          ) : null}
          {onRetry ? (
            <button
              type="button"
              className="b sm out"
              data-testid={`${testIdPrefix}-retry`}
              onClick={onRetry}
            >
              <SetIcon name="refresh" size={16} />
              {t('agentConsole.v2.set01.retry')}
            </button>
          ) : null}
        </div>
        <div className="a2r-cf">{t('agentConsole.v2.set01.errNote')}</div>
      </div>
    );
  }

  return <>{children}</>;
}