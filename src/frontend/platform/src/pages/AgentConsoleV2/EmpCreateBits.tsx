/**
 * EMP-02 `/agent/employees/new` — the parts of the screen that are not the form
 * and not the result card: the page-level lines, the loading skeleton, the
 * whole-page stage screens (load error / session / forbidden) and the collapsed
 * technical fold.
 *
 * Extracted from `EmployeeCreatePage.tsx` so every file stays under the repo's
 * 600-line rule. The DOM mirrors `emp02-target.html` minus its review chrome:
 * no `.rev` bar, no `.statenote`, no demo footnotes (SPEC §6).
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { LkIcon } from './listkit';

const KEYS = {
  freshLead: 'agentConsole.v2.emp02.freshLead',
  freshStrong: 'agentConsole.v2.emp02.freshStrong',
  freshRest: 'agentConsole.v2.emp02.freshRest',
  freshDraft: 'agentConsole.v2.emp02.freshDraft',
  freshAudit: 'agentConsole.v2.emp02.freshAudit',
  title: 'agentConsole.v2.emp02.title',
  sub: 'agentConsole.v2.emp02.sub',
  back: 'agentConsole.v2.emp02.back',
  loadingAria: 'agentConsole.v2.emp02.loadingAria',
  techSummary: 'agentConsole.v2.emp02.techSummary',
  pfootSource: 'agentConsole.v2.emp02.pfootSource',
  pfootCaliber: 'agentConsole.v2.emp02.pfootCaliber',
  pfootLanguage: 'agentConsole.v2.emp02.pfootLanguage',
} as const;

/**
 * Collapsed 「技术信息（报障时提供）」. This fold is the ONLY place a status
 * code or a request id is ever rendered (SPEC §0 zero-engineering-language,
 * E09/E14); closed by default.
 */
export function TechInfo({ rows, center }: { rows: string[]; center?: boolean }) {
  const { t } = useTranslation();
  return (
    <details className="tech">
      <summary>
        <LkIcon name="info" size={13} />
        {t(KEYS.techSummary)}
      </summary>
      <div className="kv" style={center ? { justifyContent: 'center' } : undefined}>
        {rows.map((row) => (
          <span key={row}>{row}</span>
        ))}
      </div>
    </details>
  );
}

/** The honest line above the head: this page writes, it does not preview. */
export function CreateFreshLine() {
  const { t } = useTranslation();
  return (
    <div className="fresh" data-testid="agent-v2-emp-c-create-fresh">
      <LkIcon name="clock" size={13} />
      <span>
        {t(KEYS.freshLead)}
        <b>{t(KEYS.freshStrong)}</b>
        {t(KEYS.freshRest)}
      </span>
      <span className="faint">·</span>
      <span>{t(KEYS.freshDraft)}</span>
      <span className="faint">·</span>
      <span>{t(KEYS.freshAudit)}</span>
    </div>
  );
}

/**
 * Page head, constant across states (SPEC §3). No solid button lives here —
 * the only solid button on the writable page is 保存 in the card footer (E01).
 */
export function CreateHead() {
  const { t } = useTranslation();
  return (
    <div className="phead">
      <div style={{ minWidth: 0 }}>
        <div className="h1">
          <LkIcon name="userPlus" size={20} />
          {t(KEYS.title)}
        </div>
        <div className="sub">{t(KEYS.sub)}</div>
      </div>
      <span className="sp" />
      <div className="acts">
        <Link className="lnk" to="/agent/employees" data-testid="agent-v2-emp-c-back">
          <LkIcon name="arrowLeft" size={13} />
          {t(KEYS.back)}
        </Link>
      </div>
    </div>
  );
}

export function CreateFoot() {
  const { t } = useTranslation();
  return (
    <div className="pfoot">
      <span>{t(KEYS.pfootSource)}</span>
      <span className="sp" aria-hidden="true" />
      <span>{t(KEYS.pfootCaliber)}</span>
      <span className="sp" aria-hidden="true" />
      <span>{t(KEYS.pfootLanguage)}</span>
    </div>
  );
}

/**
 * Identity-wait skeleton (E11). Bar geometry matches the real controls; the
 * card renders NO readable characters — no 「0」, no 「—」, no placeholder
 * names — because a skeleton must never be mistaken for a reading.
 */
export function FormSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="flow" data-testid="agent-v2-emp-c-loading">
      <div className="flayout">
        <div className="fcol">
          <div className="card skel" role="status" aria-label={t(KEYS.loadingAria)}>
            <div className="card-hd">
              <div className="bar" style={{ width: 104, height: 14 }} />
              <span className="sp" />
              <div className="bar" style={{ width: 132, height: 11 }} />
            </div>
            <div className="fset">
              <div className="frow2">
                <div className="field">
                  <div className="bar" style={{ width: 52, height: 11, marginBottom: 8 }} />
                  <div className="bar" style={{ height: 40 }} />
                </div>
                <div className="field">
                  <div className="bar" style={{ width: 52, height: 11, marginBottom: 8 }} />
                  <div className="bar" style={{ height: 40 }} />
                </div>
              </div>
              <div className="field">
                <div className="bar" style={{ width: 52, height: 11, marginBottom: 8 }} />
                <div className="bar" style={{ height: 40 }} />
              </div>
              <div className="field">
                <div className="bar" style={{ width: 52, height: 11, marginBottom: 8 }} />
                <div className="bar" style={{ height: 88 }} />
              </div>
              <div className="field">
                <div className="bar" style={{ width: 52, height: 11, marginBottom: 8 }} />
                <div className="bar" style={{ height: 88 }} />
              </div>
            </div>
            <div className="facts">
              <div className="bar" style={{ width: 72, height: 36 }} />
              <span className="sp" />
              <div className="bar" style={{ width: 96, height: 36 }} />
            </div>
          </div>
        </div>
        <div className="side skel" aria-hidden="true">
          <div className="card">
            <div className="card-hd">
              <div className="bar" style={{ width: 96, height: 13 }} />
            </div>
            <div className="pvbody">
              <div className="badge">
                <div className="bar" style={{ width: 44, height: 44, borderRadius: 12 }} />
                <div className="bar" style={{ width: 120, height: 13 }} />
                <div className="bar" style={{ width: 88, height: 11 }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export interface StageScreenProps {
  testId: string;
  icon: 'lock' | 'alert';
  title: string;
  desc: string;
  actions?: ReactNode;
  /** One honest sentence under the actions (reference `.vn`). */
  note?: string;
  /** Reporting rows for the collapsed fold; the only place codes are shown. */
  techRows?: string[];
}

/**
 * Whole-page replacement stage (E10): rendered INSTEAD of the form — never a
 * skeleton that then vanishes, never a form left behind.
 */
export function StageScreen({ testId, icon, title, desc, actions, note, techRows }: StageScreenProps) {
  return (
    <div className="flow-narrow">
      <div className="card stage" data-testid={testId}>
        <span className="ic">
          <LkIcon name={icon} size={20} />
        </span>
        <div className="t">{title}</div>
        <div className="s">{desc}</div>
        {actions ? <div className="acts2">{actions}</div> : null}
        {note ? <p className="vn">{note}</p> : null}
        {techRows && techRows.length ? <TechInfo rows={techRows} center /> : null}
      </div>
    </div>
  );
}
