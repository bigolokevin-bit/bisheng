/**
 * TSK-03 `/agent/tasks/new` — the write form and its read-only side column.
 *
 * Presentational half of the page: `TaskCreatePage.tsx` owns the state machine
 * and hands the rendered values down. Extracted so every file stays under the
 * repo's 600-line rule, following the `EmpCreateForm.tsx` split. Pure move: no
 * markup, test id, class name, field behaviour or wording changed.
 *
 * Rules carried by this card (unchanged):
 * - E04: the priority options are numbered in the DOM and their value is the
 *   word on screen; the wire enum never reaches the markup.
 * - E05: no eligible candidate ⇒ no <select> at all, an explanation block
 *   instead, and the primary button disabled with a readable reason.
 * - D3: a deep link that was applied shows one neutral highlight line, never
 *   an id from the URL.
 */
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { LkIcon } from './listkit';
import {
  PRIORITIES,
  TskCreateSide,
  candidateLabel,
  type Candidate,
  type FieldErrors,
  type SaveFailure,
  type SetField,
  type TaskCreateValues,
} from './TskCreateBits';

export interface TskCreateFormProps {
  values: TaskCreateValues;
  errors: FieldErrors;
  setField: SetField;
  /** True once a submit attempt found client-side errors. */
  showInvalid: boolean;
  errorCount: number;
  submitting: boolean;
  saveDisabled: boolean;
  failure: SaveFailure | null;
  onSubmit: (ev?: { preventDefault?: () => void }) => void;
  onCancel: () => void;
  /** Re-runs the candidate read (empty-state 「重新读取」). */
  onReload: () => void;
  deepNotices: string[];
  deepAssignee: boolean;
  deepPriority: boolean;
  candidates: Candidate[];
  selected: Candidate | null;
  noCandidates: boolean;
  currentName: string;
  confirmLeave: boolean;
  onLeave: () => void;
  onKeep: () => void;
  previewTitle: string;
  titleRef: RefObject<HTMLInputElement | null>;
  assigneeRef: RefObject<HTMLSelectElement | null>;
}

export function TskCreateForm({
  values,
  errors,
  setField,
  showInvalid,
  errorCount,
  submitting,
  saveDisabled,
  failure,
  onSubmit,
  onCancel,
  onReload,
  deepNotices,
  deepAssignee,
  deepPriority,
  candidates,
  selected,
  noCandidates,
  currentName,
  confirmLeave,
  onLeave,
  onKeep,
  previewTitle,
  titleRef,
  assigneeRef,
}: TskCreateFormProps) {
  const { t } = useTranslation();
  return (
    <div className="flow" data-testid="agent-v2-tsk-c-form-wrap">
      <div className="flayout">
        <div className="fcol">
          <form
            className="card"
            noValidate
            aria-busy={submitting || undefined}
            data-testid="agent-v2-tsk-c-form"
            onSubmit={onSubmit}
          >
            <div className="card-hd">
              <span className="t">
                <LkIcon name="flag" size={18} />
                {t('agentConsole.v2.tsk03.cardTitle')}
              </span>
              <span className="c">{t('agentConsole.v2.tsk03.cardChip')}</span>
              <span className="sp" />
              <span className="hd-note">
                {currentName
                  ? t('agentConsole.v2.tsk03.cardNote', { name: currentName })
                  : t('agentConsole.v2.tsk03.cardNoteAnon')}
              </span>
            </div>

            {failure ? (
              <div className="errbar" role="alert" data-testid="agent-v2-tsk-c-save-error">
                <LkIcon name="alert" size={14} />
                <span className="tx">
                  {failure.kind === 'invalid'
                    ? t('agentConsole.v2.tsk03.failInvalid')
                    : t('agentConsole.v2.tsk03.failUnavailable')}
                </span>
                <button
                  type="button"
                  className="b sm out"
                  data-testid="agent-v2-tsk-c-retry"
                  disabled={submitting}
                  onClick={() => void onSubmit()}
                >
                  <LkIcon name="refresh" size={16} />
                  {t('agentConsole.v2.tsk03.retry')}
                </button>
              </div>
            ) : null}

            <div className="fset">
              {deepNotices.length ? (
                /* Neutral line for what the link could not apply: information,
                   not a fault — no red, no error role, no id on screen. */
                <div className="roband" role="note" data-testid="agent-v2-tsk-c-deeplink-note">
                  <LkIcon name="info" size={14} />
                  <span>
                    {deepNotices.map((key) => t(`agentConsole.v2.tsk03.${key}`)).join(t('agentConsole.v2.tsk03.sumSep'))}
                  </span>
                </div>
              ) : null}
              {showInvalid ? (
                <div className="ferrsum" role="alert" data-testid="agent-v2-tsk-c-error-summary">
                  <LkIcon name="alert" size={14} />
                  <span>
                    {t('agentConsole.v2.tsk03.summaryLead', { count: errorCount })}
                    {[
                      errors.title
                        ? values.title
                          ? t('agentConsole.v2.tsk03.sumTitleBlank')
                          : t('agentConsole.v2.tsk03.sumTitleEmpty')
                        : '',
                      errors.assignee ? t('agentConsole.v2.tsk03.sumAssignee') : '',
                    ]
                      .filter(Boolean)
                      .join(t('agentConsole.v2.tsk03.sumSep'))}
                    {t('agentConsole.v2.tsk03.summaryTail')}
                  </span>
                </div>
              ) : null}

              <div className="field">
                <div className="flab">
                  <label htmlFor="tsk03-title">{t('agentConsole.v2.tsk03.titleLabel')}</label>
                  <span className="tagreq">{t('agentConsole.v2.tsk03.required')}</span>
                  <span className="fcount mono" data-testid="agent-v2-tsk-c-title-count">
                    {values.title.length} / 80
                  </span>
                </div>
                <input
                  ref={titleRef}
                  id="tsk03-title"
                  name="title"
                  className="inp"
                  type="text"
                  value={values.title}
                  placeholder={t('agentConsole.v2.tsk03.titlePlaceholder')}
                  autoComplete="off"
                  maxLength={80}
                  disabled={submitting}
                  aria-invalid={errors.title ? true : undefined}
                  aria-describedby={errors.title ? 'tsk03-title-err' : 'tsk03-title-hint'}
                  data-testid="agent-v2-tsk-c-title"
                  onChange={(e) => setField('title', e.target.value)}
                />
                {errors.title ? (
                  <div className="ferr" id="tsk03-title-err" data-testid="agent-v2-tsk-c-title-error">
                    <LkIcon name="alert" size={13} />
                    <span>{errors.title}</span>
                  </div>
                ) : (
                  <div className="fhint" id="tsk03-title-hint">
                    {t('agentConsole.v2.tsk03.titleHint')}
                  </div>
                )}
              </div>

              <div className={`field${deepAssignee ? ' is-deeplink' : ''}`}>
                <div className="flab">
                  <span className="lbl">{t('agentConsole.v2.tsk03.assigneeLabel')}</span>
                  <span className="tagreq">{t('agentConsole.v2.tsk03.required')}</span>
                </div>
                {noCandidates ? (
                  /* No candidate at all: an empty <select> would be a dead
                     control, so the whole block becomes an explanation (§E06). */
                  <div className="emptyblk" role="note" data-testid="agent-v2-tsk-c-assignee-empty">
                    <div className="h">
                      <LkIcon name="users" size={18} />
                      {t('agentConsole.v2.tsk03.emptyTitle')}
                    </div>
                    <div className="s">{t('agentConsole.v2.tsk03.emptyBody')}</div>
                    <div className="acts2">
                      <Link className="b out sm" to="/agent/employees/new" data-testid="agent-v2-tsk-c-empty-create">
                        <LkIcon name="plus" size={16} />
                        {t('agentConsole.v2.tsk03.emptyCreate')}
                      </Link>
                      <button
                        type="button"
                        className="b gh sm"
                        data-testid="agent-v2-tsk-c-empty-reload"
                        onClick={onReload}
                      >
                        <LkIcon name="refresh" size={16} />
                        {t('agentConsole.v2.tsk03.emptyReload')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="selwrap">
                      <select
                        ref={assigneeRef}
                        id="tsk03-assignee"
                        name="assignee"
                        className="inp"
                        value={values.assigneeId}
                        disabled={submitting}
                        aria-invalid={errors.assignee ? true : undefined}
                        aria-describedby={errors.assignee ? 'tsk03-assignee-err' : 'tsk03-assignee-hint'}
                        data-testid="agent-v2-tsk-c-assignee"
                        onChange={(e) => setField('assigneeId', e.target.value)}
                      >
                        <option value="" disabled>
                          {t('agentConsole.v2.tsk03.assigneePlaceholder')}
                        </option>
                        {candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {candidateLabel(c, t)}
                          </option>
                        ))}
                      </select>
                      <LkIcon name="chevD" size={14} />
                    </div>
                    {errors.assignee ? (
                      <div className="ferr" id="tsk03-assignee-err" data-testid="agent-v2-tsk-c-assignee-error">
                        <LkIcon name="alert" size={13} />
                        <span>{errors.assignee}</span>
                      </div>
                    ) : (
                      <div className="fhint" id="tsk03-assignee-hint" data-testid="agent-v2-tsk-c-assignee-hint">
                        {t('agentConsole.v2.tsk03.assigneeHint', { count: candidates.length })}
                      </div>
                    )}
                    {deepAssignee && !errors.assignee ? (
                      <div className="dl-note" data-testid="agent-v2-tsk-c-deeplink-assignee">
                        <LkIcon name="link" size={13} />
                        <span>
                          {t('agentConsole.v2.tsk03.deepAppliedAssignee', {
                            name: selected?.name || t('agentConsole.v2.id.unnamed'),
                          })}
                        </span>
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              <div className={`field${deepPriority ? ' is-deeplink' : ''}`}>
                <div className="flab">
                  <span className="lbl">{t('agentConsole.v2.tsk03.priorityLabel')}</span>
                  <span className="tagreq opt">{t('agentConsole.v2.tsk03.optional')}</span>
                </div>
                <div className="pri" role="radiogroup" aria-label={t('agentConsole.v2.tsk03.priorityLabel')}>
                  {PRIORITIES.map((p, index) => (
                    /* E04: neither the testid nor the input value may carry the
                       wire enum, so the option is numbered and the value is the
                       word on screen. The submit body still sends the enum. */
                    <label className="pri-opt" key={p} data-testid={`agent-v2-tsk-c-priority-${index + 1}`}>
                      <input
                        type="radio"
                        name="priority"
                        value={t(`agentConsole.v2.tsk03.priority.${p}`)}
                        checked={values.priority === p}
                        disabled={submitting}
                        onChange={() => setField('priority', p)}
                      />
                      <span className="t">{t(`agentConsole.v2.tsk03.priority.${p}`)}</span>
                      <span className="d">{t(`agentConsole.v2.tsk03.priorityHint.${p}`)}</span>
                    </label>
                  ))}
                </div>
                <div className="fhint">{t('agentConsole.v2.tsk03.priorityNote')}</div>
                {deepPriority ? (
                  <div className="dl-note" data-testid="agent-v2-tsk-c-deeplink-priority">
                    <LkIcon name="link" size={13} />
                    <span>
                      {t('agentConsole.v2.tsk03.deepAppliedPriority', {
                        value: t(`agentConsole.v2.tsk03.priority.${values.priority}`),
                      })}
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="field">
                <div className="flab">
                  <label htmlFor="tsk03-note">{t('agentConsole.v2.tsk03.noteLabel')}</label>
                  <span className="tagreq opt">{t('agentConsole.v2.tsk03.optional')}</span>
                  <span className="fcount mono" data-testid="agent-v2-tsk-c-note-count">
                    {values.note.length} / 500
                  </span>
                </div>
                <textarea
                  id="tsk03-note"
                  name="note"
                  className="inp"
                  rows={3}
                  maxLength={500}
                  value={values.note}
                  placeholder={t('agentConsole.v2.tsk03.notePlaceholder')}
                  disabled={submitting}
                  data-testid="agent-v2-tsk-c-note"
                  onChange={(e) => setField('note', e.target.value)}
                />
              </div>

              <div className="field">
                <div className="flab">
                  <span className="lbl">{t('agentConsole.v2.tsk03.sourceLabel')}</span>
                  <span className="tagreq opt">{t('agentConsole.v2.tsk03.sourceFixed')}</span>
                </div>
                {/* Read-only by design: the source is a record, not a choice. */}
                <div className="locked" data-testid="agent-v2-tsk-c-source">
                  <LkIcon name="lock" size={14} />
                  <span className="pill nt xs">{t('agentConsole.v2.tsk03.sourceManual')}</span>
                  <span className="sp" />
                  <span className="faint src-note">{t('agentConsole.v2.tsk03.sourceNote')}</span>
                </div>
                <div className="fhint">{t('agentConsole.v2.tsk03.sourceHint')}</div>
              </div>
            </div>

            <div className="facts">
              <button
                type="button"
                className="b gh"
                disabled={submitting}
                data-testid="agent-v2-tsk-c-cancel"
                onClick={onCancel}
              >
                <LkIcon name="arrowLeft" size={16} />
                {t('agentConsole.v2.tsk03.cancel')}
              </button>
              <span className="sp" />
              <button
                type="submit"
                className="b pri"
                disabled={saveDisabled}
                aria-live="polite"
                aria-describedby={noCandidates ? 'tsk03-why-blocked' : undefined}
                data-testid="agent-v2-tsk-c-save"
              >
                {submitting ? (
                  <>
                    <span className="spin" aria-hidden="true" />
                    {t('agentConsole.v2.tsk03.creating')}
                  </>
                ) : (
                  <>
                    <LkIcon name="check" size={16} />
                    {t('agentConsole.v2.tsk03.create')}
                  </>
                )}
              </button>
            </div>
            {noCandidates ? (
              <p className="card-foot-note" id="tsk03-why-blocked" data-testid="agent-v2-tsk-c-why-blocked">
                {t('agentConsole.v2.tsk03.whyBlocked')}
              </p>
            ) : null}
          </form>

          {confirmLeave ? (
            <div className="roband" role="alertdialog" data-testid="agent-v2-tsk-c-leave-confirm">
              <LkIcon name="alert" size={14} />
              <span>
                <b>{t('agentConsole.v2.tsk03.leaveLead')}</b>
                {t('agentConsole.v2.tsk03.leaveRest')}
              </span>
              <span className="sp" />
              <button
                type="button"
                className="b sm out"
                data-testid="agent-v2-tsk-c-leave-discard"
                onClick={onLeave}
              >
                {t('agentConsole.v2.tsk03.leaveDiscard')}
              </button>
              <button
                type="button"
                className="b sm gh"
                data-testid="agent-v2-tsk-c-leave-keep"
                onClick={onKeep}
              >
                {t('agentConsole.v2.tsk03.leaveKeep')}
              </button>
            </div>
          ) : null}
        </div>

        <TskCreateSide priority={values.priority} previewTitle={previewTitle} selected={selected} />
      </div>
    </div>
  );
}