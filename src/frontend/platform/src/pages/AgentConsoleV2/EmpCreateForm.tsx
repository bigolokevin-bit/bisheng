/**
 * EMP-02 `/agent/employees/new` — the write form and its side column.
 *
 * Presentational half of the page: the page component owns the state machine
 * (§3) and hands the rendered values down. The field set is what the write
 * path actually needs (SPEC §2 plus the required first-version job description
 * the domain rejects without — see the receipt note in `EmployeeCreatePage`):
 * 姓名 / 岗位 / 职责说明（必填）+ 所有者只读行 + 备注。
 *
 * Rules carried here:
 * - invalid state (E04): ONE in-card summary + one sentence per field, values
 *   kept, `aria-invalid` + `aria-describedby` wired to the message;
 * - submitting (E05): 保存 becomes 「正在保存…」 with the spinner, every field,
 *   取消 and the button itself are disabled, `aria-busy` sits on the form;
 * - service failure (E09): a `role="alert"` bar at the TOP of the same card +
 *   重试; the status code and request id live only in the collapsed fold;
 * - keyboard (E13): Enter in a text input submits, Enter in a textarea is a
 *   newline; the owner row is not focusable; no positive tabindex anywhere.
 */
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { avatarChar } from './identity';
import { HelpTip } from './HelpTip';
import { LkIcon } from './listkit';
import { TechInfo } from './EmpCreateBits';

/* Internal shapes (repo rule: `type` for internal types, `interface` for Props).
 * They must stay type aliases: `isDirty` takes a `Record<string, string>`, and
 * only an alias gets the implicit index signature an interface never does. */
export type EmpCreateValues = {
  name: string;
  title: string;
  duty: string;
  note: string;
};

export type EmpCreateField = keyof EmpCreateValues;

export const PRISTINE: EmpCreateValues = { name: '', title: '', duty: '', note: '' };

export type FieldErrors = {
  name?: string;
  title?: string;
  duty?: string;
};

/** A write attempt the service refused: content (400) or service (5xx/0). */
export type EmpFailure = {
  kind: 'invalid' | 'unavailable';
  requestId?: string;
  status?: number;
};

export interface EmpCreateFormProps {
  values: EmpCreateValues;
  errors: FieldErrors;
  /** True once a submit attempt found client-side errors (SPEC §3 invalid). */
  showInvalid: boolean;
  submitting: boolean;
  /** Pristine form, missing identity or in flight — save is not clickable (E11). */
  saveDisabled: boolean;
  failure: EmpFailure | null;
  currentName: string;
  confirmLeave: boolean;
  nameRef: RefObject<HTMLInputElement | null>;
  titleRef: RefObject<HTMLInputElement | null>;
  dutyRef: RefObject<HTMLTextAreaElement | null>;
  onFieldChange: (field: EmpCreateField, next: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onLeaveDiscard: () => void;
  onLeaveKeep: () => void;
}

/** Tab order is fixed by DOM order: name → title → duty → note → 取消 → 保存 (E13). */
export function EmpCreateForm({
  values,
  errors,
  showInvalid,
  submitting,
  saveDisabled,
  failure,
  currentName,
  confirmLeave,
  nameRef,
  titleRef,
  dutyRef,
  onFieldChange,
  onSubmit,
  onCancel,
  onLeaveDiscard,
  onLeaveKeep,
}: EmpCreateFormProps) {
  const { t } = useTranslation();
  const errorCount = Object.values(errors).filter(Boolean).length;
  const isTextEntry = (el: EventTarget | null): el is HTMLInputElement =>
    el instanceof HTMLInputElement && el.type === 'text';

  const handleKeyDown = (ev: React.KeyboardEvent<HTMLFormElement>) => {
    // Enter inside a textarea must stay a newline (§4); the guard keeps the
    // submit path off the note and duty boxes.
    if (ev.key !== 'Enter' || ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (!isTextEntry(ev.target)) return;
    ev.preventDefault();
    // The button is unusable on a pristine form (E11) — Enter obeys the same gate.
    if (!submitting && !saveDisabled) onSubmit();
  };

  const hdNote = () => {
    if (failure) return t('agentConsole.v2.emp02.hdNoteKept');
    if (showInvalid && errorCount) {
      return t('agentConsole.v2.emp02.hdNoteFix', { count: errorCount });
    }
    if (submitting) return t('agentConsole.v2.emp02.hdNoteBusy');
    return currentName
      ? t('agentConsole.v2.emp02.cardNote', { name: currentName })
      : t('agentConsole.v2.emp02.cardNoteAnon');
  };

  const techRows = failure
    ? [
        failure.status
          ? t('agentConsole.v2.emp02.techStatusCode', { status: failure.status })
          : t('agentConsole.v2.emp02.techStatusNoCode'),
        `${t('agentConsole.v2.emp02.techRequest')} ${
          failure.requestId || t('agentConsole.v2.emp02.techNotProvided')
        }`,
      ]
    : [];

  return (
    <div className="flow" data-testid="agent-v2-emp-c-form-wrap">
      <div className="flayout">
        <div className="fcol">
          <form
            className="card"
            noValidate
            aria-busy={submitting || undefined}
            data-testid="agent-v2-emp-c-form"
            onSubmit={(ev) => {
              ev.preventDefault();
              onSubmit();
            }}
            onKeyDown={handleKeyDown}
          >
            <div className="card-hd">
              <span className="t">
                <LkIcon name="user" size={18} />
                {t('agentConsole.v2.emp02.cardTitle')}
              </span>
              <span className="c">{t('agentConsole.v2.emp02.cardChip')}</span>
              <span className="sp" />
              <span className="hd-note">{hdNote()}</span>
            </div>

            {failure ? (
              <div className="errbar" role="alert" data-testid="agent-v2-emp-c-save-error">
                <LkIcon name="alert" size={14} />
                <span className="tx">
                  {failure.kind === 'invalid'
                    ? t('agentConsole.v2.emp02.failInvalid')
                    : t('agentConsole.v2.emp02.failUnavailable')}
                </span>
                <button
                  type="button"
                  className="b sm out"
                  data-testid="agent-v2-emp-c-retry"
                  disabled={submitting}
                  onClick={onSubmit}
                >
                  <LkIcon name="refresh" size={16} />
                  {t('agentConsole.v2.emp02.retry')}
                </button>
                {/* E09: the failed banner carries the same technical fold the
                  * other screens have — status and request id go nowhere else. */}
                <TechInfo rows={techRows} />
              </div>
            ) : null}

            <div className="fset">
              {showInvalid && errorCount ? (
                <div className="ferrsum" role="alert" data-testid="agent-v2-emp-c-error-summary">
                  <LkIcon name="alert" size={14} />
                  <span>
                    {t('agentConsole.v2.emp02.summaryLead', { count: errorCount })}
                    {summaryParts(t, values, errors).join(t('agentConsole.v2.emp02.sumSep'))}
                    {t('agentConsole.v2.emp02.summaryTail')}
                  </span>
                </div>
              ) : null}

              <div className="frow2">
                <div className="field">
                  <div className="flab">
                    <label htmlFor="emp02-name">{t('agentConsole.v2.emp02.nameLabel')}</label>
                    <span className="tagreq">{t('agentConsole.v2.emp02.required')}</span>
                  </div>
                  <input
                    ref={nameRef}
                    id="emp02-name"
                    name="name"
                    className="inp"
                    type="text"
                    value={values.name}
                    placeholder={t('agentConsole.v2.emp02.namePlaceholder')}
                    autoComplete="off"
                    maxLength={60}
                    disabled={submitting}
                    aria-invalid={errors.name ? true : undefined}
                    aria-describedby={errors.name ? 'emp02-name-err' : 'emp02-name-hint'}
                    data-testid="agent-v2-emp-c-name"
                    onChange={(e) => onFieldChange('name', e.target.value)}
                  />
                  {errors.name ? (
                    <div className="ferr" id="emp02-name-err" data-testid="agent-v2-emp-c-name-error">
                      <LkIcon name="alert" size={13} />
                      <span>{errors.name}</span>
                    </div>
                  ) : (
                    <div className="fhint" id="emp02-name-hint">
                      {t('agentConsole.v2.emp02.nameHint')}
                    </div>
                  )}
                </div>

                <div className="field">
                  <div className="flab">
                    <label htmlFor="emp02-title">{t('agentConsole.v2.emp02.titleLabel')}</label>
                    <span className="tagreq">{t('agentConsole.v2.emp02.required')}</span>
                  </div>
                  <input
                    ref={titleRef}
                    id="emp02-title"
                    name="title"
                    className="inp"
                    type="text"
                    value={values.title}
                    placeholder={t('agentConsole.v2.emp02.titlePlaceholder')}
                    autoComplete="off"
                    maxLength={60}
                    disabled={submitting}
                    aria-invalid={errors.title ? true : undefined}
                    aria-describedby={errors.title ? 'emp02-title-err' : 'emp02-title-hint'}
                    data-testid="agent-v2-emp-c-title"
                    onChange={(e) => onFieldChange('title', e.target.value)}
                  />
                  {errors.title ? (
                    <div className="ferr" id="emp02-title-err" data-testid="agent-v2-emp-c-title-error">
                      <LkIcon name="alert" size={13} />
                      <span>{errors.title}</span>
                    </div>
                  ) : (
                    <div className="fhint" id="emp02-title-hint">
                      {t('agentConsole.v2.emp02.titleHint')}
                    </div>
                  )}
                </div>
              </div>

              <div className="field">
                <div className="flab">
                  <span className="lbl">{t('agentConsole.v2.emp02.ownerLabel')}</span>
                  <span className="tagreq opt">{t('agentConsole.v2.emp02.optional')}</span>
                </div>
                {/* Read-only accountable person: no candidate source exists, and
                    a one-option dropdown would be a fake control (§9-3, E03).
                    Not focusable on purpose — the tab order skips it. */}
                <div className="locked" data-testid="agent-v2-emp-c-owner">
                  <span className="who">
                    <span className="ava" aria-hidden="true">
                      {avatarChar(currentName) ?? <LkIcon name="user" size={13} />}
                    </span>
                    <span className="nm2">
                      {currentName
                        ? t('agentConsole.v2.emp02.ownerYou', { name: currentName })
                        : t('agentConsole.v2.emp02.ownerAnonymous')}
                    </span>
                  </span>
                  <span className="pill nt xs">{t('agentConsole.v2.emp02.ownerDefault')}</span>
                </div>
                <div className="fhint">{t('agentConsole.v2.emp02.ownerHint')}</div>
              </div>

              <div className="field">
                <div className="flab">
                  <label htmlFor="emp02-duty">{t('agentConsole.v2.emp02.dutyLabel')}</label>
                  <span className="tagreq">{t('agentConsole.v2.emp02.required')}</span>
                  <span className="fcount mono" data-testid="agent-v2-emp-c-duty-count">
                    {values.duty.length} / 500
                  </span>
                </div>
                <textarea
                  ref={dutyRef}
                  id="emp02-duty"
                  name="duty"
                  className="inp"
                  rows={3}
                  maxLength={500}
                  value={values.duty}
                  placeholder={t('agentConsole.v2.emp02.dutyPlaceholder')}
                  disabled={submitting}
                  aria-invalid={errors.duty ? true : undefined}
                  aria-describedby={errors.duty ? 'emp02-duty-err' : 'emp02-duty-hint'}
                  data-testid="agent-v2-emp-c-duty"
                  onChange={(e) => onFieldChange('duty', e.target.value)}
                />
                {errors.duty ? (
                  <div className="ferr" id="emp02-duty-err" data-testid="agent-v2-emp-c-duty-error">
                    <LkIcon name="alert" size={13} />
                    <span>{errors.duty}</span>
                  </div>
                ) : (
                  <div className="fhint" id="emp02-duty-hint">
                    {t('agentConsole.v2.emp02.dutyHint')}
                  </div>
                )}
              </div>

              <div className="field">
                <div className="flab">
                  <label htmlFor="emp02-note">{t('agentConsole.v2.emp02.noteLabel')}</label>
                  <span className="tagreq opt">{t('agentConsole.v2.emp02.optional')}</span>
                  <span className="fcount mono" data-testid="agent-v2-emp-c-note-count">
                    {values.note.length} / 500
                  </span>
                </div>
                <textarea
                  id="emp02-note"
                  name="note"
                  className="inp"
                  rows={3}
                  maxLength={500}
                  value={values.note}
                  placeholder={t('agentConsole.v2.emp02.notePlaceholder')}
                  disabled={submitting}
                  data-testid="agent-v2-emp-c-note"
                  onChange={(e) => onFieldChange('note', e.target.value)}
                />
                {failure ? (
                  /* The reference failed screen says this out loud: pressing
                   * save again can never build a second employee. */
                  <div className="fhint" data-testid="agent-v2-emp-c-fail-hint">
                    {t('agentConsole.v2.emp02.failSafeHint')}
                  </div>
                ) : (
                  <div className="fhint">{t('agentConsole.v2.emp02.noteHint')}</div>
                )}
              </div>
            </div>

            <div className="facts">
              <button
                type="button"
                className="b gh"
                disabled={submitting}
                data-testid="agent-v2-emp-c-cancel"
                onClick={onCancel}
              >
                <LkIcon name="arrowLeft" size={16} />
                {t('agentConsole.v2.emp02.cancel')}
              </button>
              <span className="sp" />
              <button
                type="submit"
                className="b pri"
                disabled={saveDisabled}
                aria-live="polite"
                data-testid="agent-v2-emp-c-save"
              >
                {submitting ? (
                  <>
                    <span className="spin" aria-hidden="true" />
                    {t('agentConsole.v2.emp02.saving')}
                  </>
                ) : (
                  <>
                    <LkIcon name="check" size={16} />
                    {t('agentConsole.v2.emp02.save')}
                  </>
                )}
              </button>
            </div>
          </form>

          {confirmLeave ? (
            <div className="roband" role="alertdialog" data-testid="agent-v2-emp-c-leave-confirm">
              <LkIcon name="alert" size={14} />
              <span>
                <b>{t('agentConsole.v2.emp02.leaveLead')}</b>
                {t('agentConsole.v2.emp02.leaveRest')}
              </span>
              <span className="sp" />
              <button
                type="button"
                className="b sm out"
                data-testid="agent-v2-emp-c-leave-discard"
                onClick={onLeaveDiscard}
              >
                {t('agentConsole.v2.emp02.leaveDiscard')}
              </button>
              <button
                type="button"
                className="b sm gh"
                data-testid="agent-v2-emp-c-leave-keep"
                onClick={onLeaveKeep}
              >
                {t('agentConsole.v2.emp02.leaveKeep')}
              </button>
            </div>
          ) : null}
        </div>

        <EmpCreateSide values={values} currentName={currentName} />
      </div>
    </div>
  );
}

/** 工牌预览 / 建立之后 / 谁可以建 — the three right-hand cards of the reference. */
export function EmpCreateSide({ values, currentName }: { values: EmpCreateValues; currentName: string }) {
  const { t } = useTranslation();
  const previewName = values.name.trim();
  const previewTitle = values.title.trim();
  return (
    <div className="side">
      <div className="card pvc">
        <div className="card-hd">
          <span className="t">{t('agentConsole.v2.emp02.previewTitle')}</span>
          <span className="sp" />
          <span className="hd-note">{t('agentConsole.v2.emp02.previewNote')}</span>
        </div>
        <div className="pvbody">
          <div className="badge">
            <div className="badge-top">
              <span className="pvav" data-testid="agent-v2-emp-c-preview-avatar" aria-hidden="true">
                {previewName ? Array.from(previewName)[0] : <LkIcon name="user" size={20} />}
              </span>
              <div className="pvname">
                <div
                  className={`n${previewName ? '' : ' empty'}`}
                  data-testid="agent-v2-emp-c-preview-name"
                  title={previewName || undefined}
                >
                  {previewName || t('agentConsole.v2.emp02.previewNameEmpty')}
                </div>
                <div
                  className={`t2${previewTitle ? '' : ' empty'}`}
                  data-testid="agent-v2-emp-c-preview-title"
                >
                  {previewTitle || t('agentConsole.v2.emp02.previewTitleEmpty')}
                </div>
              </div>
              <span className="pill nt">{t('agentConsole.v2.emp02.draftPill')}</span>
            </div>
            <div className="badge-ft">
              <span className="micro" style={{ flex: 'none' }}>
                {t('agentConsole.v2.emp02.idLabel')}
              </span>
              <span className="mono pending">{t('agentConsole.v2.emp02.idPending')}</span>
            </div>
          </div>
          <p className="pvhint">{t('agentConsole.v2.emp02.previewHint')}</p>
        </div>
      </div>

      <div className="card">
        <div className="card-hd">
          <span className="t">{t('agentConsole.v2.emp02.afterTitle')}</span>
          <span className="sp" />
        </div>
        <div className="rows">
          {(['after1', 'after2', 'after3'] as const).map((row, idx) => (
            <div className="row" key={row}>
              <span className="k">{`0${idx + 1}`}</span>
              <div className="body">
                <div className="nm">{t(`agentConsole.v2.emp02.${row}Name`)}</div>
                <div className="why">{t(`agentConsole.v2.emp02.${row}Why`)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-hd">
          <span className="t">{t('agentConsole.v2.emp02.permTitle')}</span>
          <HelpTip term="emp02Perm" testId="agent-v2-emp-c-help-perm" />
          <span className="sp" />
        </div>
        <div className="rows">
          <div className="row">
            <span className="k">·</span>
            <div className="body">
              <div className="why">
                {t('agentConsole.v2.emp02.permLine1Lead')}{' '}
                <b>{currentName || t('agentConsole.v2.emp02.ownerAnonymous')}</b>{' '}
                {t('agentConsole.v2.emp02.permLine1Rest')}
              </div>
            </div>
          </div>
          <div className="row">
            <span className="k">·</span>
            <div className="body">
              <div className="why">{t('agentConsole.v2.emp02.permLine2')}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One clause per failing field, in field order (E04 summary). */
function summaryParts(t: ReturnType<typeof useTranslation>['t'], values: EmpCreateValues, errors: FieldErrors): string[] {
  const clause = (err: string | undefined, key: string, filled: boolean) =>
    err ? t(`agentConsole.v2.emp02.${filled ? `${key}Blank` : `${key}Empty`}`) : '';
  return [
    clause(errors.name, 'sumName', Boolean(values.name)),
    clause(errors.title, 'sumTitle', Boolean(values.title)),
    clause(errors.duty, 'sumDuty', Boolean(values.duty)),
  ].filter(Boolean);
}
