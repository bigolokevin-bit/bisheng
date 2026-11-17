/**
 * EMP-02 `/agent/employees/new` — the outcome cards that replace the form:
 * success, same-key replay and the same-key/different-body conflict.
 *
 * Structure follows `emp02-target.html` (`sc-ok` / `sc-replay` / `sc-conflict`)
 * minus the review-only `.res-ft` footnotes and `.statenote` paragraphs (§6).
 *
 * Rules carried here:
 * - success (E06): 「员工已建立」 + 姓名·岗位 + 草稿 pill + copyable short id
 *   (full value in `title` and on the clipboard) + 「查看员工详情」. It never
 *   claims 「已可对话」 or 「已可派活」 — a draft answers nobody;
 * - replay (E07): the SAME card plus a neutral band. Not an error: no red, no
 *   error code, no 「失败」, same 编号;
 * - conflict (E08): a result-card variant whose first line says the previous
 *   submission already succeeded, with exactly two exits. It must not read
 *   like field validation.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { CreatedEmployee } from './createFlow';
import { shortRef } from './createFlow';
import { LkIcon } from './listkit';
import { HelpTip } from './HelpTip';
import { TechInfo } from './EmpCreateBits';

export type EmpCreateResultKind = 'success' | 'replay' | 'conflict';

export interface EmpCreateResult {
  kind: EmpCreateResultKind;
  employee?: CreatedEmployee;
  requestId?: string;
}

export interface EmpCreateResultCardProps {
  result: EmpCreateResult;
  onRestart: () => void;
}

export function EmpCreateResultCard({ result, onRestart }: EmpCreateResultCardProps) {
  if (result.kind === 'conflict') return <ConflictCard result={result} onRestart={onRestart} />;
  return <CreatedCard result={result} onRestart={onRestart} />;
}

/** Focus lands on the heading after a screen change (§4 focus management). */
function useHeadingFocus() {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return headingRef;
}

function CreatedCard({ result, onRestart }: EmpCreateResultCardProps) {
  const { t } = useTranslation();
  const headingRef = useHeadingFocus();
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const employee = result.employee;
  const fullId = employee?.id ?? '';
  const detailHref = `/agent/employees/${encodeURIComponent(fullId)}`;
  const name = (employee?.name ?? '').trim();
  const title = (employee?.title ?? '').trim();
  const replay = result.kind === 'replay';

  const handleCopied = () => {
    try {
      void navigator.clipboard?.writeText(fullId);
    } catch {
      /* clipboard unavailable: the full value stays in the title */
    }
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1400);
  };

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  return (
    <div className="flow-narrow" data-testid="agent-v2-emp-c-result">
      <div className="card result">
        <div className="res-hd">
          <span className="ric">
            <LkIcon name="check" size={20} />
          </span>
          <div>
            <h2 className="rt" tabIndex={-1} ref={headingRef} data-testid="agent-v2-emp-c-result-title">
              {t('agentConsole.v2.emp02.resultTitle')}
            </h2>
            <div className="rs" data-testid="agent-v2-emp-c-result-sub">
              {[name, title].filter(Boolean).join(' · ')}
            </div>
          </div>
          <span className="sp" />
          <span className="pill nt">{t('agentConsole.v2.emp02.draftPill')}</span>
        </div>
        <div className="res-body">
          {replay ? (
            <div className="roband" role="note" data-testid="agent-v2-emp-c-replay-band">
              <LkIcon name="refresh" size={14} />
              <span>
                <b>{t('agentConsole.v2.emp02.replayLead')}</b>
                {t('agentConsole.v2.emp02.replayRest')}
              </span>
              <HelpTip term="emp02Replay" testId="agent-v2-emp-c-help-replay" />
            </div>
          ) : null}

          <div className="idrow">
            <span className="micro">{t('agentConsole.v2.emp02.idLabel')}</span>
            <span className="mono" title={fullId} data-testid="agent-v2-emp-c-result-id">
              {shortRef(fullId)}
            </span>
            <span className="sp" />
            <button
              type="button"
              className="b gh sm"
              title={fullId}
              data-testid="agent-v2-emp-c-copy"
              onClick={handleCopied}
            >
              <LkIcon name="copy" size={14} />
              <span aria-live="polite">
                {copied ? t('agentConsole.v2.emp02.copied') : t('agentConsole.v2.emp02.copy')}
              </span>
            </button>
          </div>

          <div className="rule" />

          <div className="nextlist">
            <div className="ni">
              <span className="k">{t('agentConsole.v2.emp02.nextStep')}</span>
              <span>{t('agentConsole.v2.emp02.resultNext1')}</span>
            </div>
            {replay ? null : (
              <div className="ni">
                <span className="k">{t('agentConsole.v2.emp02.nextCan')}</span>
                <span>{t('agentConsole.v2.emp02.resultNext2')}</span>
              </div>
            )}
          </div>

          <TechInfo
            rows={[
              `${t('agentConsole.v2.emp02.techRequest')} ${
                result.requestId || t('agentConsole.v2.emp02.techNotProvided')
              }`,
            ]}
          />
        </div>
        <div className="facts">
          <button type="button" className="b gh" data-testid="agent-v2-emp-c-again" onClick={onRestart}>
            <LkIcon name="plus" size={16} />
            {t('agentConsole.v2.emp02.resultAgain')}
          </button>
          <span className="sp" />
          <Link className="b pri" to={detailHref} data-testid="agent-v2-emp-c-view">
            {t('agentConsole.v2.emp02.resultView')}
            <LkIcon name="chevR" size={16} />
          </Link>
        </div>
      </div>
    </div>
  );
}

function ConflictCard({ result, onRestart }: EmpCreateResultCardProps) {
  const { t } = useTranslation();
  const headingRef = useHeadingFocus();
  return (
    <div className="flow-narrow" data-testid="agent-v2-emp-c-conflict">
      <div className="card result">
        <div className="res-hd">
          <span className="ric wr">
            <LkIcon name="alert" size={20} />
          </span>
          <div>
            <h2 className="rt" tabIndex={-1} ref={headingRef} data-testid="agent-v2-emp-c-conflict-title">
              {t('agentConsole.v2.emp02.conflictTitle')}
            </h2>
            <div className="rs">{t('agentConsole.v2.emp02.conflictSub')}</div>
          </div>
        </div>
        <div className="res-body">
          <p className="res-p">{t('agentConsole.v2.emp02.conflictBody')}</p>
          <div className="nextlist">
            <div className="ni">
              <span className="k">{t('agentConsole.v2.emp02.nextCan')}</span>
              <span>{t('agentConsole.v2.emp02.conflict1')}</span>
            </div>
            <div className="ni">
              <span className="k">{t('agentConsole.v2.emp02.nextAlso')}</span>
              <span>{t('agentConsole.v2.emp02.conflict2')}</span>
            </div>
          </div>
          <TechInfo
            rows={[
              `${t('agentConsole.v2.emp02.techRequest')} ${
                result.requestId || t('agentConsole.v2.emp02.techNotProvided')
              }`,
              t('agentConsole.v2.emp02.techStatusConflict'),
            ]}
          />
        </div>
        {/* Exactly two exits, per E08. */}
        <div className="facts">
          <Link className="b out" to="/agent/employees" data-testid="agent-v2-emp-c-conflict-back">
            {t('agentConsole.v2.emp02.conflictBack')}
          </Link>
          <span className="sp" />
          <button
            type="button"
            className="b pri"
            data-testid="agent-v2-emp-c-conflict-reopen"
            onClick={onRestart}
          >
            {t('agentConsole.v2.emp02.conflictReopen')}
          </button>
        </div>
      </div>
    </div>
  );
}
