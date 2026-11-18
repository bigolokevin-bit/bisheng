/**
 * TSK-03 `/agent/tasks/new` — the result card: success, same-key replay and
 * conflict. Extracted from `TaskCreatePage.tsx` so every file stays under the
 * repo's 600-line rule, following the `EmpCreateResultCard.tsx` split.
 *
 * Pure move: same tree, same test ids. A replay is the first result plus a
 * neutral band, never an error; a conflict is its own card with its own two
 * next steps. Success does not auto-navigate.
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { shortRef, type CreatedTask } from './createFlow';
import { HelpTip } from './HelpTip';
import { LkIcon } from './listkit';
import { TechInfo } from './TskCreateBits';

export type ResultKind = 'success' | 'replay' | 'conflict';

export interface ResultState {
  kind: ResultKind;
  task?: CreatedTask;
  requestId?: string;
}

export function TskCreateResultCard({
  result,
  copied,
  onCopy,
  onRestart,
  fallbackAssignee,
}: {
  result: ResultState;
  copied: boolean;
  onCopy: (value: string) => void;
  onRestart: () => void;
  fallbackAssignee: string;
}) {
  const { t } = useTranslation();
  const task = result.task;
  const fullId = task?.taskId ?? '';
  const detailHref = `/agent/tasks/${encodeURIComponent(fullId)}`;
  const title = (task?.title ?? '').trim();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const assigneeName = (task?.assignee?.displayName ?? '').trim() || fallbackAssignee;
  /* Hooks stay above the branch: the conflict and success cards are the same
     component, so a conditional hook would crash on a state change. */
  useEffect(() => {
    if (result.kind !== 'conflict') headingRef.current?.focus();
  }, [result.kind]);

  if (result.kind === 'conflict') {
    return (
      <div className="flow-narrow" data-testid="agent-v2-tsk-c-conflict">
        <div className="card result">
          <div className="res-hd">
            <span className="ric wr">
              <LkIcon name="alert" size={20} />
            </span>
            <div>
              <div className="rt">{t('agentConsole.v2.tsk03.conflictTitle')}</div>
              <div className="rs">{t('agentConsole.v2.tsk03.conflictSub')}</div>
            </div>
          </div>
          <div className="res-body">
            <p className="res-p">{t('agentConsole.v2.tsk03.conflictBody')}</p>
            <div className="nextlist">
              <div className="ni">
                <span className="k">{t('agentConsole.v2.tsk03.nextCan')}</span>
                <span>{t('agentConsole.v2.tsk03.conflict1')}</span>
              </div>
              <div className="ni">
                <span className="k">{t('agentConsole.v2.tsk03.nextAlso')}</span>
                <span>{t('agentConsole.v2.tsk03.conflict2')}</span>
              </div>
            </div>
            <TechInfo
              rows={[
                `${t('agentConsole.v2.tsk03.techRequest')} ${result.requestId ?? t('agentConsole.v2.id.requestIdAbsent')}`,
                t('agentConsole.v2.tsk03.techStatusConflict'),
              ]}
            />
          </div>
          <div className="facts">
            <Link className="b out" to="/agent/tasks" data-testid="agent-v2-tsk-c-conflict-back">
              {t('agentConsole.v2.tsk03.conflictBack')}
            </Link>
            <span className="sp" />
            <button
              type="button"
              className="b pri"
              data-testid="agent-v2-tsk-c-conflict-reopen"
              onClick={onRestart}
            >
              {t('agentConsole.v2.tsk03.conflictReopen')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const replay = result.kind === 'replay';
  return (
    <div className="flow-narrow" data-testid="agent-v2-tsk-c-result">
      <div className="card result">
        <div className="res-hd">
          <span className="ric">
            <LkIcon name="check" size={20} />
          </span>
          <div>
            <h2 className="rt" tabIndex={-1} ref={headingRef} data-testid="agent-v2-tsk-c-result-title">
              {t('agentConsole.v2.tsk03.resultTitle')}
            </h2>
            <div className="rs" data-testid="agent-v2-tsk-c-result-sub">
              {title}
            </div>
          </div>
          <span className="sp" />
          <span className="pill nt">
            <span className="dot" />
            {t('agentConsole.v2.tsk03.statusOpen')}
          </span>
        </div>
        <div className="res-body">
          {replay ? (
            <div className="roband" role="note" data-testid="agent-v2-tsk-c-replay-band">
              <LkIcon name="refresh" size={14} />
              <span>
                <b>{t('agentConsole.v2.tsk03.replayLead')}</b>
                {t('agentConsole.v2.tsk03.replayRest')}
              </span>
              <HelpTip term="tsk03Replay" testId="agent-v2-tsk-c-help-replay" />
            </div>
          ) : null}

          <div className="idrow">
            <span className="micro">{t('agentConsole.v2.tsk03.idLabel')}</span>
            <span className="mono" title={fullId} data-testid="agent-v2-tsk-c-result-id">
              {shortRef(fullId)}
            </span>
            <span className="sp" />
            <button
              type="button"
              className="b gh sm"
              title={fullId}
              data-testid="agent-v2-tsk-c-copy"
              onClick={() => onCopy(fullId)}
            >
              <LkIcon name="copy" size={14} />
              <span aria-live="polite">{copied ? t('agentConsole.v2.tsk03.copied') : t('agentConsole.v2.tsk03.copy')}</span>
            </button>
          </div>

          <div className="rule" />

          <div className="nextlist">
            <div className="ni">
              <span className="k">{t('agentConsole.v2.tsk03.assigneeLabel')}</span>
              <span>
                {assigneeName}
                {t('agentConsole.v2.tsk03.resultAssigneeRest')}
              </span>
            </div>
            {replay ? null : (
              <div className="ni">
                <span className="k">{t('agentConsole.v2.tsk03.nextCan')}</span>
                <span>{t('agentConsole.v2.tsk03.resultNext2')}</span>
              </div>
            )}
          </div>

          <TechInfo
            rows={[`${t('agentConsole.v2.tsk03.techRequest')} ${result.requestId ?? t('agentConsole.v2.id.requestIdAbsent')}`]}
          />
        </div>
        <div className="facts">
          <button type="button" className="b gh" data-testid="agent-v2-tsk-c-again" onClick={onRestart}>
            <LkIcon name="plus" size={16} />
            {t('agentConsole.v2.tsk03.resultAgain')}
          </button>
          <span className="sp" />
          <Link className="b pri" to={detailHref} data-testid="agent-v2-tsk-c-view">
            {t('agentConsole.v2.tsk03.resultView')}
            <LkIcon name="chevR" size={16} />
          </Link>
        </div>
      </div>
    </div>
  );
}