/**
 * EMP-02 `/agent/employees/new` — the console's first real write screen.
 * Built against the locked C1 baseline `emp02-target.html` + EMP02-TARGET-SPEC.
 *
 * The screen is deliberately narrow: four fields (name, title, owner, note) and
 * one solid button. Everything else on the reference (职权 / 工位 / 知识范围 /
 * 预算） belongs to approval flows and must NOT appear here (§2).
 *
 * Hard rules carried by this file:
 * - The save button REALLY writes: POST /api/employees with an Idempotency-Key
 *   generated once per submission and reused by every retry (§3, §5). Missing
 *   key is a client bug, never papered over.
 * - A same-key replay is NOT an error: it renders the first result plus a
 *   neutral band, no red, no 「失败」 (§3 replay row, E07).
 * - A same-key/different-body answer is a conflict card that first says the
 *   previous submission already succeeded, and offers exactly two exits (E08).
 * - 403 and 404 share one body so the page never confirms whether an address
 *   exists (E10); 401 gets its own "session expired" screen.
 * - Zero engineering language in body copy: statuses, request ids, field names
 *   and the idempotency key only ever appear inside the collapsed 技术信息.
 * - No amount anywhere on this page: no currency symbol, no 元 (§0).
 * - Success does not auto-navigate: the employee id stays copyable with the
 *   primary button moving the user forward (§9-1).
 */
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { userContext } from '@/contexts/userContext';

import { HelpTip } from './HelpTip';
import { useConsoleCrumbTail } from './Shell';
import { LkIcon } from './listkit';
import { avatarChar } from './identity';
import { FETCH_TIMEOUT_MS } from './v2Data';
import {
  isDirty,
  newIdempotencyKey,
  readCreatedEmployee,
  shortRef,
  submitWrite,
  type CreatedEmployee,
  type WriteFailureKind,
} from './createFlow';
import './createFlow.css';

type Stage = 'ready' | 'loading' | 'forbidden' | 'auth' | 'loadError';

type ResultKind = 'success' | 'replay' | 'conflict';

interface ResultState {
  kind: ResultKind;
  employee?: CreatedEmployee;
  requestId?: string;
}

interface FieldErrors {
  name?: string;
  title?: string;
}

const PRISTINE = { name: '', title: '', note: '' };

export function EmployeeCreatePage({ writeEnv }: { writeEnv?: Parameters<typeof submitWrite>[0]['env'] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useConsoleCrumbTail(t('agentConsole.v2.emp02.crumb'));

  const ctx = useContext(userContext) as
    | { user?: { user_id?: number | string; user_name?: string; name?: string; username?: string } }
    | null;
  const currentUid =
    ctx?.user?.user_id === undefined || ctx?.user?.user_id === null ? '' : String(ctx.user.user_id);
  const currentName = String(
    ctx?.user?.user_name || ctx?.user?.name || ctx?.user?.username || ''
  ).trim();

  const [values, setValues] = useState({ ...PRISTINE });
  /* The page cannot set an owner before the session identity is readable, so
     the first paint is a real wait: skeleton up to 10s, then the honest
     "identity unreadable" form state instead of a fake progress bar. */
  const [stage, setStage] = useState<Stage>('loading');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ kind: 'invalid' | 'unavailable'; requestId?: string } | null>(
    null
  );
  const [result, setResult] = useState<ResultState | null>(null);
  const [copied, setCopied] = useState(false);
  const [escWarn, setEscWarn] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const nameRef = useRef<HTMLInputElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const keyRef = useRef<string | null>(null);
  const attemptsRef = useRef(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const escTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dirty = isDirty(values, PRISTINE);
  const ownerLabel = currentName || t('agentConsole.v2.emp02.ownerAnonymous');
  const ownerInitial = avatarChar(currentName) ?? (currentName ? Array.from(currentName)[0] : null);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
      if (escTimer.current) clearTimeout(escTimer.current);
    },
    []
  );

  /* Enter the page on the first field (§4 focus). */
  useEffect(() => {
    if (stage === 'ready' && !result) nameRef.current?.focus();
  }, [stage, result]);

  /* Identity gate: leave the skeleton as soon as the session is readable, and
     never keep a skeleton up longer than the read budget (E11). */
  useEffect(() => {
    if (stage !== 'loading') return undefined;
    if (currentUid) {
      setStage('ready');
      return undefined;
    }
    const timer = window.setTimeout(
      () => setStage((prev) => (prev === 'loading' ? 'ready' : prev)),
      FETCH_TIMEOUT_MS
    );
    return () => window.clearTimeout(timer);
  }, [currentUid, stage]);

  /* Success focus lands on the result heading, not back at the top (§4). */

  /* Dirty guard: closing the tab or reloading must ask first (§3 idle row). */
  useEffect(() => {
    if (!dirty || result) return undefined;
    const onBeforeUnload = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
      ev.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty, result]);

  const leave = useCallback(() => navigate('/agent/employees'), [navigate]);

  /* Esc: first press warns while there is unsaved content, second press leaves. */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      if (result) return;
      if (!dirty) {
        leave();
        return;
      }
      if (escWarn) {
        leave();
        return;
      }
      setEscWarn(true);
      if (escTimer.current) clearTimeout(escTimer.current);
      escTimer.current = setTimeout(() => setEscWarn(false), 3000);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, escWarn, leave, result]);

  const setField = (key: keyof typeof PRISTINE, next: string) => {
    setValues((prev) => ({ ...prev, [key]: next }));
    if (key === 'name' || key === 'title') {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  };

  const validate = useCallback((): FieldErrors => {
    const next: FieldErrors = {};
    if (!values.name.trim()) {
      next.name = values.name ? t('agentConsole.v2.emp02.errNameBlank') : t('agentConsole.v2.emp02.errNameRequired');
    }
    if (!values.title.trim()) {
      next.title = t('agentConsole.v2.emp02.errTitleRequired');
    }
    return next;
  }, [t, values.name, values.title]);

  const onSubmit = async (ev?: { preventDefault?: () => void }) => {
    ev?.preventDefault?.();
    if (submitting || result) return;
    setSubmitted(true);

    const nextErrors = validate();
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      setFailure(null);
      // Focus the first field that needs attention (§3 invalid row).
      if (nextErrors.name) nameRef.current?.focus();
      else titleRef.current?.focus();
      return;
    }

    // One key per submission group: generated on entering the submitting
    // state, reused by every retry, renewed only by a brand-new submission.
    if (!keyRef.current) keyRef.current = newIdempotencyKey();
    const key = keyRef.current;
    attemptsRef.current += 1;
    setSubmitting(true);
    setFailure(null);

    const body: Record<string, string> = {
      name: values.name.trim(),
      title: values.title.trim(),
    };
    if (currentUid) body.owner_user_id = currentUid;
    if (values.note.trim()) body.note = values.note.trim();

    const outcome = await submitWrite<unknown>({ path: '/api/employees', body, key, env: writeEnv });
    setSubmitting(false);

    if (outcome.ok) {
      const created = readCreatedEmployee(outcome.data);
      if (!created) {
        // A 2xx without an id would leave the user with a fake success.
        setFailure({ kind: 'unavailable', requestId: outcome.requestId });
        return;
      }
      setResult({
        kind: attemptsRef.current > 1 ? 'replay' : 'success',
        employee: created,
        requestId: outcome.requestId,
      });
      return;
    }

    applyFailure(outcome.kind ?? 'unavailable', outcome.requestId);
  };

  const applyFailure = (kind: WriteFailureKind, requestId?: string) => {
    if (kind === 'conflict') {
      setResult({ kind: 'conflict', requestId });
      return;
    }
    if (kind === 'auth') {
      setStage('auth');
      return;
    }
    if (kind === 'forbidden') {
      setStage('forbidden');
      return;
    }
    setFailure({ kind: kind === 'invalid' ? 'invalid' : 'unavailable', requestId });
  };

  const copyId = (value: string) => {
    try {
      void navigator.clipboard?.writeText(value);
    } catch {
      /* clipboard unavailable: the full value stays in the title */
    }
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1400);
  };

  const restart = () => {
    keyRef.current = null;
    attemptsRef.current = 0;
    setValues({ ...PRISTINE });
    setErrors({});
    setSubmitted(false);
    setFailure(null);
    setResult(null);
    setCopied(false);
    setStage('ready');
    window.setTimeout(() => nameRef.current?.focus(), 0);
  };

  const onCancel = () => {
    if (dirty && !result) setConfirmLeave(true);
    else leave();
  };

  const meta = (
    <div className="fresh" data-testid="agent-v2-emp-c-create-fresh">
      <LkIcon name="clock" size={13} />
      <span>
        {t('agentConsole.v2.emp02.freshLead')}
        <b>{t('agentConsole.v2.emp02.freshStrong')}</b>
        {t('agentConsole.v2.emp02.freshRest')}
      </span>
      <span className="faint">·</span>
      <span>{t('agentConsole.v2.emp02.freshDraft')}</span>
      <span className="faint">·</span>
      <span>{t('agentConsole.v2.emp02.freshAudit')}</span>
    </div>
  );

  const head = (
    <div className="phead">
      <div style={{ minWidth: 0 }}>
        <div className="h1">
          <LkIcon name="userPlus" size={20} />
          {t('agentConsole.v2.emp02.title')}
        </div>
        <div className="sub">{t('agentConsole.v2.emp02.sub')}</div>
      </div>
      <span className="sp" />
      <div className="acts">
        <Link className="lnk" to="/agent/employees" data-testid="agent-v2-emp-c-back">
          <LkIcon name="arrowLeft" size={13} />
          {t('agentConsole.v2.emp02.back')}
        </Link>
      </div>
    </div>
  );

  const shell = (body: React.ReactNode) => (
    <div className="a2s-page">
      <div className="lk emp02" data-testid="agent-v2-emp-create">
        {meta}
        {head}
        {escWarn ? (
          <div className="roband" role="status" data-testid="agent-v2-emp-c-esc-warn">
            <LkIcon name="info" size={14} />
            <span>{t('agentConsole.v2.emp02.escWarn')}</span>
          </div>
        ) : null}
        {body}
        <PageFoot t={t} />
      </div>
    </div>
  );

  if (stage === 'loading') return shell(<FormSkeleton t={t} />);

  if (stage === 'loadError') {
    return shell(
      <div className="flow-narrow">
        <div className="card stage" data-testid="agent-v2-emp-c-load-error">
          <span className="ic">
            <LkIcon name="alert" size={20} />
          </span>
          <div className="t">{t('agentConsole.v2.emp02.loadErrorTitle')}</div>
          <div className="s">{t('agentConsole.v2.emp02.loadErrorDesc')}</div>
          <div className="acts2">
            <button
              type="button"
              className="b out"
              data-testid="agent-v2-emp-c-load-retry"
              onClick={() => setStage('ready')}
            >
              <LkIcon name="refresh" size={16} />
              {t('agentConsole.v2.emp02.retry')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'auth') {
    return shell(
      <div className="flow-narrow">
        <div className="card stage" data-testid="agent-v2-emp-c-auth">
          <span className="ic">
            <LkIcon name="lock" size={20} />
          </span>
          <div className="t">{t('agentConsole.v2.emp02.authTitle')}</div>
          <div className="s">{t('agentConsole.v2.emp02.authDesc')}</div>
          <div className="acts2">
            <a className="b out" href="/" data-testid="agent-v2-emp-c-auth-relogin">
              {t('agentConsole.v2.emp02.authAction')}
            </a>
            <Link className="b gh" to="/agent/employees">
              {t('agentConsole.v2.emp02.back')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'forbidden') {
    return shell(
      <div className="flow-narrow">
        <div className="card stage" data-testid="agent-v2-emp-c-forbidden">
          <span className="ic">
            <LkIcon name="lock" size={20} />
          </span>
          <div className="t">{t('agentConsole.v2.emp02.forbiddenTitle')}</div>
          <div className="s">{t('agentConsole.v2.emp02.forbiddenDesc')}</div>
          <div className="acts2">
            <Link className="b out" to="/agent/employees" data-testid="agent-v2-emp-c-forbidden-back">
              <LkIcon name="arrowLeft" size={16} />
              {t('agentConsole.v2.emp02.forbiddenBack')}
            </Link>
          </div>
          <p className="vn">{t('agentConsole.v2.emp02.forbiddenNote')}</p>
          <TechInfo t={t} rows={[t('agentConsole.v2.emp02.techStatusForbidden')]} center />
        </div>
      </div>
    );
  }

  if (result) {
    return shell(<ResultCard t={t} result={result} copied={copied} onCopy={copyId} onRestart={restart} />);
  }

  const errorCount = Object.values(errors).filter(Boolean).length;
  const showInvalid = submitted && errorCount > 0;
  const saveDisabled = submitting || !currentUid;
  const previewName = values.name.trim();
  const previewTitle = values.title.trim();

  return shell(
    <div className="flow" data-testid="agent-v2-emp-c-form-wrap">
      <div className="flayout">
        <div className="fcol">
          <form
            className="card"
            noValidate
            aria-busy={submitting || undefined}
            data-testid="agent-v2-emp-c-form"
            onSubmit={onSubmit}
          >
            <div className="card-hd">
              <span className="t">
                <LkIcon name="user" size={18} />
                {t('agentConsole.v2.emp02.cardTitle')}
              </span>
              <span className="c">{t('agentConsole.v2.emp02.cardChip')}</span>
              <span className="sp" />
              <span className="hd-note">
                {currentName
                  ? t('agentConsole.v2.emp02.cardNote', { name: currentName })
                  : t('agentConsole.v2.emp02.cardNoteAnon')}
              </span>
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
                  onClick={() => void onSubmit()}
                >
                  <LkIcon name="refresh" size={16} />
                  {t('agentConsole.v2.emp02.retry')}
                </button>
              </div>
            ) : null}

            <div className="fset">
              {showInvalid ? (
                <div className="ferrsum" role="alert" data-testid="agent-v2-emp-c-error-summary">
                  <LkIcon name="alert" size={14} />
                  <span>
                    {t('agentConsole.v2.emp02.summaryLead', { count: errorCount })}
                    {[
                      errors.name
                        ? values.name
                          ? t('agentConsole.v2.emp02.sumNameBlank')
                          : t('agentConsole.v2.emp02.sumNameEmpty')
                        : '',
                      errors.title
                        ? values.title
                          ? t('agentConsole.v2.emp02.sumTitleBlank')
                          : t('agentConsole.v2.emp02.sumTitleEmpty')
                        : '',
                    ]
                      .filter(Boolean)
                      .join(t('agentConsole.v2.emp02.sumSep'))}
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
                    onChange={(e) => setField('name', e.target.value)}
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
                    onChange={(e) => setField('title', e.target.value)}
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
                    a one-option dropdown would be a fake control (§9-3, E03). */}
                <div className="locked" data-testid="agent-v2-emp-c-owner">
                  <span className="who">
                    <span className="ava" aria-hidden="true">
                      {ownerInitial ?? <LkIcon name="user" size={13} />}
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
                  onChange={(e) => setField('note', e.target.value)}
                />
                <div className="fhint">{t('agentConsole.v2.emp02.noteHint')}</div>
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
                aria-describedby={!currentUid ? 'emp02-no-identity' : undefined}
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
            {!currentUid ? (
              <p className="card-foot-note" id="emp02-no-identity" data-testid="agent-v2-emp-c-no-identity">
                {t('agentConsole.v2.emp02.noIdentityNote')}
              </p>
            ) : null}
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
                onClick={leave}
              >
                {t('agentConsole.v2.emp02.leaveDiscard')}
              </button>
              <button
                type="button"
                className="b sm gh"
                data-testid="agent-v2-emp-c-leave-keep"
                onClick={() => setConfirmLeave(false)}
              >
                {t('agentConsole.v2.emp02.leaveKeep')}
              </button>
            </div>
          ) : null}
        </div>

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
              <div className="row">
                <span className="k">01</span>
                <div className="body">
                  <div className="nm">{t('agentConsole.v2.emp02.after1Name')}</div>
                  <div className="why">{t('agentConsole.v2.emp02.after1Why')}</div>
                </div>
              </div>
              <div className="row">
                <span className="k">02</span>
                <div className="body">
                  <div className="nm">{t('agentConsole.v2.emp02.after2Name')}</div>
                  <div className="why">{t('agentConsole.v2.emp02.after2Why')}</div>
                </div>
              </div>
              <div className="row">
                <span className="k">03</span>
                <div className="body">
                  <div className="nm">{t('agentConsole.v2.emp02.after3Name')}</div>
                  <div className="why">{t('agentConsole.v2.emp02.after3Why')}</div>
                </div>
              </div>
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
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ result */

function ResultCard({
  t,
  result,
  copied,
  onCopy,
  onRestart,
}: {
  t: TFunction;
  result: ResultState;
  copied: boolean;
  onCopy: (value: string) => void;
  onRestart: () => void;
}) {
  const employee = result.employee;
  const fullId = employee?.id ?? '';
  const detailHref = `/agent/employees/${encodeURIComponent(fullId)}`;
  const name = (employee?.name ?? '').trim();
  const title = (employee?.title ?? '').trim();
  /* The result heading receives focus so a keyboard/screen-reader user lands on
     the outcome instead of the top of the page (§4 focus management). */
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  if (result.kind === 'conflict') {
    return (
      <div className="flow-narrow" data-testid="agent-v2-emp-c-conflict">
        <div className="card result">
          <div className="res-hd">
            <span className="ric wr">
              <LkIcon name="alert" size={20} />
            </span>
            <div>
              <div className="rt">{t('agentConsole.v2.emp02.conflictTitle')}</div>
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
              t={t}
              rows={[
                `${t('agentConsole.v2.emp02.techRequest')} ${result.requestId ?? t('agentConsole.v2.id.requestIdAbsent')}`,
                t('agentConsole.v2.emp02.techStatusConflict'),
              ]}
            />
          </div>
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

  const replay = result.kind === 'replay';
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
              onClick={() => onCopy(fullId)}
            >
              <LkIcon name="copy" size={14} />
              <span aria-live="polite">{copied ? t('agentConsole.v2.emp02.copied') : t('agentConsole.v2.emp02.copy')}</span>
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
            t={t}
            rows={[`${t('agentConsole.v2.emp02.techRequest')} ${result.requestId ?? t('agentConsole.v2.id.requestIdAbsent')}`]}
          />
        </div>
        <div className="facts">
          <button
            type="button"
            className="b gh"
            data-testid="agent-v2-emp-c-again"
            onClick={onRestart}
          >
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

/* ------------------------------------------------------------------ shared bits */

function TechInfo({ t, rows, center }: { t: TFunction; rows: string[]; center?: boolean }) {
  return (
    <details className="tech">
      <summary>
        <LkIcon name="info" size={13} />
        {t('agentConsole.v2.emp02.techSummary')}
      </summary>
      <div className="kv" style={center ? { justifyContent: 'center' } : undefined}>
        {rows.map((row) => (
          <span key={row}>{row}</span>
        ))}
      </div>
    </details>
  );
}

function FormSkeleton({ t }: { t: TFunction }) {
  return (
    <div className="flow" data-testid="agent-v2-emp-c-loading">
      <div className="flayout">
        <div className="fcol">
          <div className="card skel" role="status" aria-label={t('agentConsole.v2.emp02.loadingAria')}>
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
            </div>
            <div className="facts">
              <div className="bar" style={{ width: 72, height: 36 }} />
              <span className="sp" />
              <div className="bar" style={{ width: 96, height: 36 }} />
            </div>
          </div>
          <p className="skel-note">{t('agentConsole.v2.emp02.loadingNote')}</p>
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

function PageFoot({ t }: { t: TFunction }) {
  return (
    <div className="pfoot">
      <span>{t('agentConsole.v2.emp02.pfootSource')}</span>
      <span className="sp" aria-hidden="true" />
      <span>{t('agentConsole.v2.emp02.pfootCaliber')}</span>
      <span className="sp" aria-hidden="true" />
      <span>{t('agentConsole.v2.emp02.pfootLanguage')}</span>
    </div>
  );
}