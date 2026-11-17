/**
 * EMP-02 `/agent/employees/new` — the console's first real write screen.
 * Built against the locked C1 baseline `emp02-target.html` + EMP02-TARGET-SPEC.
 *
 * This file owns the state machine (§3) and composes the screen from its
 * siblings: `EmpCreateBits.tsx` (page lines, skeleton, stage screens),
 * `EmpCreateForm.tsx` (the write form + the three side cards) and
 * `EmpCreateResultCard.tsx` (success / replay / conflict).
 *
 * Hard rules carried by this file:
 * - The save button REALLY writes: POST /api/employees with an Idempotency-Key
 *   generated once on entering the submitting state and reused by every retry
 *   (§3, §5). A missing key is a client bug, never papered over.
 * - A same-key replay is NOT an error: it renders the first result plus a
 *   neutral band, no red, no 「失败」 (§3 replay row, E07).
 * - A same-key/different-body answer is a conflict card, not field validation (E08).
 * - 403 and 404 share one body so the page never confirms whether an address
 *   exists (E10); 401 gets its own "session expired" screen.
 * - Zero engineering language in body copy: statuses, request ids, field names
 *   and the submission key only ever appear inside the collapsed 技术信息.
 * - No amount anywhere on this page: no currency symbol, no local-currency word (§0).
 * - Success does not auto-navigate: the employee id stays copyable and the
 *   primary button moves the user forward (§9-1).
 *
 * Declared deviation (EMP-02 R3): the write path hard-requires an
 * `initialVersion` mapping (`employee.invalid_initial_version`, rid
 * 20699f438d83), so the fourth input 「职责说明」 is required and feeds
 * `initialVersion.jobDescription`. That makes the field set 5 rows / 3 required
 * instead of the SPEC §2 "4 项 · 2 必填"; the card chip says what is on screen.
 */
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import { userContext } from '@/contexts/userContext';

import {
  isDirty,
  newIdempotencyKey,
  readCreatedEmployee,
  submitWrite,
} from './createFlow';
import {
  CreateFoot,
  CreateFreshLine,
  CreateHead,
  FormSkeleton,
  StageScreen,
} from './EmpCreateBits';
import {
  EmpCreateForm,
  PRISTINE,
  type EmpCreateField,
  type EmpCreateValues,
  type EmpFailure,
  type FieldErrors,
} from './EmpCreateForm';
import { EmpCreateResultCard, type EmpCreateResult } from './EmpCreateResultCard';
import { LkIcon } from './listkit';
import { useConsoleCrumbTail } from './Shell';
import { FETCH_TIMEOUT_MS } from './v2Data';

import './createFlow.css';

type Stage = 'loading' | 'ready';

/** Whole-page replacement states: the form is never rendered behind them (E10). */
interface Gate {
  kind: 'forbidden' | 'auth' | 'loadError';
  status?: number;
  requestId?: string;
}

export function EmployeeCreatePage({
  writeEnv,
}: {
  writeEnv?: Parameters<typeof submitWrite>[0]['env'];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useConsoleCrumbTail(t('agentConsole.v2.emp02.crumb'));

  const ctx = useContext(userContext) as
    | { user?: { user_id?: number | string; user_name?: string; name?: string; username?: string } }
    | null;
  const currentUid =
    ctx?.user?.user_id === undefined || ctx?.user?.user_id === null ? '' : String(ctx.user.user_id);
  const currentName = String(ctx?.user?.user_name || ctx?.user?.name || ctx?.user?.username || '').trim();

  const [values, setValues] = useState<EmpCreateValues>({ ...PRISTINE });
  /* The page cannot set an owner before the session identity is readable, so
     the first paint is a real wait: skeleton up to the read budget, then the
     honest error screen with 重试 (E11), never a fake progress bar. */
  const [stage, setStage] = useState<Stage>('loading');
  const [gate, setGate] = useState<Gate | null>(null);
  /* Bumped by 重试 on the load-error screen so the same wait re-arms. */
  const [attempt, setAttempt] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<EmpFailure | null>(null);
  const [result, setResult] = useState<EmpCreateResult | null>(null);
  const [escWarn, setEscWarn] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const nameRef = useRef<HTMLInputElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const dutyRef = useRef<HTMLTextAreaElement | null>(null);
  const keyRef = useRef<string | null>(null);
  const attemptsRef = useRef(0);
  const escTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dirty = isDirty(values, PRISTINE);

  useEffect(
    () => () => {
      if (escTimer.current) clearTimeout(escTimer.current);
    },
    []
  );

  /* Enter the page on the first field (§4 focus). */
  useEffect(() => {
    if (stage === 'ready' && !gate && !result) nameRef.current?.focus();
  }, [stage, gate, result]);

  /* Identity gate: leave the skeleton as soon as the session is readable, and
     never keep a skeleton up longer than the read budget (E11: 「10 秒未返回
     切错误态」). */
  useEffect(() => {
    if (stage !== 'loading') return undefined;
    if (currentUid) {
      setStage('ready');
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setGate((prev) => prev ?? { kind: 'loadError' });
    }, FETCH_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [currentUid, stage, attempt]);

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

  /* Esc: first press warns while there is unsaved content (the band self-clears
     after 3s), second press leaves; a clean form leaves at once (§4). */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      if (result || gate) return;
      if (!dirty || escWarn) {
        leave();
        return;
      }
      setEscWarn(true);
      if (escTimer.current) clearTimeout(escTimer.current);
      escTimer.current = setTimeout(() => setEscWarn(false), 3000);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, escWarn, gate, leave, result]);

  const setField = (key: EmpCreateField, next: string) => {
    setValues((prev) => ({ ...prev, [key]: next }));
    if (key === 'name' || key === 'title' || key === 'duty') {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  };

  /* One pass over every rule, all messages collected at once (§3 validating:
     no per-field interruption, and no request leaves the page). */
  const validate = useCallback((): FieldErrors => {
    const next: FieldErrors = {};
    if (!values.name.trim()) {
      next.name = values.name
        ? t('agentConsole.v2.emp02.errNameBlank')
        : t('agentConsole.v2.emp02.errNameRequired');
    }
    if (!values.title.trim()) {
      next.title = t('agentConsole.v2.emp02.errTitleRequired');
    }
    if (!values.duty.trim()) {
      next.duty = values.duty
        ? t('agentConsole.v2.emp02.errDutyBlank')
        : t('agentConsole.v2.emp02.errDutyRequired');
    }
    return next;
  }, [t, values.name, values.title, values.duty]);

  /** Failure branches are chosen by MEANING, never by the numeric code (§5). */
  const applyFailure = (
    kind: string,
    requestId: string | undefined,
    status: number | undefined,
  ) => {
    if (kind === 'conflict') {
      setResult({ kind: 'conflict', requestId });
      return;
    }
    if (kind === 'auth') {
      setGate({ kind: 'auth', requestId, status });
      return;
    }
    if (kind === 'forbidden') {
      // 403 and 404 land in one bucket: the body is identical, only the folded
      // status code differs (E10).
      setGate({ kind: 'forbidden', requestId, status });
      return;
    }
    setFailure({
      kind: kind === 'invalid' ? 'invalid' : 'unavailable',
      requestId,
      status,
    });
  };

  const handleSave = async () => {
    if (submitting || result || gate) return;
    setSubmitted(true);

    const nextErrors = validate();
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      setFailure(null);
      // Focus the first field that needs attention (§3 invalid row, E04).
      if (nextErrors.name) nameRef.current?.focus();
      else if (nextErrors.title) titleRef.current?.focus();
      else dutyRef.current?.focus();
      return;
    }

    // One key per submission group: generated on entering the submitting
    // state, reused by every retry, renewed only by a brand-new submission.
    if (!keyRef.current) keyRef.current = newIdempotencyKey();
    const key = keyRef.current;
    attemptsRef.current += 1;
    setSubmitting(true);
    setFailure(null);

    const body: Record<string, string | Record<string, unknown>> = {
      name: values.name.trim(),
      title: values.title.trim(),
    };
    if (currentUid) body.ownerUserId = currentUid;
    if (values.note.trim()) body.note = values.note.trim();
    /* The domain hard-requires this mapping (`initialVersion is required`).
     * We only carry what the operator actually typed: knowledgeScopes /
     * skillRefs / grantIds stay empty arrays rather than invented values, and
     * `budget` is omitted on purpose — the domain falls back to the policy
     * default only when the key is absent, so a guess would fail closed. */
    body.initialVersion = {
      jobDescription: values.duty.trim(),
      knowledgeScopes: [],
      skillRefs: [],
      grantIds: [],
      effectiveFrom: new Date().toISOString(),
    };

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

    applyFailure(outcome.kind ?? 'unavailable', outcome.requestId, outcome.status);
  };

  const restart = () => {
    keyRef.current = null;
    attemptsRef.current = 0;
    setValues({ ...PRISTINE });
    setErrors({});
    setSubmitted(false);
    setFailure(null);
    setResult(null);
    setGate(null);
    setConfirmLeave(false);
    setEscWarn(false);
    setStage('ready');
    window.setTimeout(() => nameRef.current?.focus(), 0);
  };

  const handleCancel = () => {
    if (dirty && !result) setConfirmLeave(true);
    else leave();
  };

  /* Status code and request id only ever reach the collapsed fold (E09/E14);
     a value the gateway never sent is named 「未提供」 rather than guessed. */
  const techRows = (status?: number, requestId?: string) => [
    status
      ? t('agentConsole.v2.emp02.techStatusCode', { status })
      : t('agentConsole.v2.emp02.techStatusNoCode'),
    `${t('agentConsole.v2.emp02.techRequest')} ${
      requestId || t('agentConsole.v2.emp02.techNotProvided')
    }`,
  ];

  const shell = (body: React.ReactNode) => (
    <div className="a2s-page">
      <div className="lk emp02" data-testid="agent-v2-emp-create">
        <CreateFreshLine />
        <CreateHead />
        {escWarn && !gate && !result ? (
          <div className="roband" role="status" data-testid="agent-v2-emp-c-esc-warn">
            <LkIcon name="info" size={14} />
            <span>{t('agentConsole.v2.emp02.escWarn')}</span>
          </div>
        ) : null}
        {body}
        <CreateFoot />
      </div>
    </div>
  );

  if (gate?.kind === 'forbidden') {
    return shell(
      <StageScreen
        testId="agent-v2-emp-c-forbidden"
        icon="lock"
        title={t('agentConsole.v2.emp02.forbiddenTitle')}
        desc={t('agentConsole.v2.emp02.forbiddenDesc')}
        note={t('agentConsole.v2.emp02.forbiddenNote')}
        actions={
          <Link className="b out" to="/agent/employees" data-testid="agent-v2-emp-c-forbidden-back">
            <LkIcon name="arrowLeft" size={16} />
            {t('agentConsole.v2.emp02.forbiddenBack')}
          </Link>
        }
        techRows={techRows(gate.status, gate.requestId)}
      />
    );
  }

  if (gate?.kind === 'auth') {
    return shell(
      <StageScreen
        testId="agent-v2-emp-c-auth"
        icon="lock"
        title={t('agentConsole.v2.emp02.authTitle')}
        desc={t('agentConsole.v2.emp02.authDesc')}
        actions={
          <>
            <a className="b out" href="/" data-testid="agent-v2-emp-c-auth-relogin">
              {t('agentConsole.v2.emp02.authAction')}
            </a>
            <Link className="b gh" to="/agent/employees">
              {t('agentConsole.v2.emp02.back')}
            </Link>
          </>
        }
        techRows={techRows(gate.status, gate.requestId)}
      />
    );
  }

  if (gate?.kind === 'loadError') {
    return shell(
      <StageScreen
        testId="agent-v2-emp-c-load-error"
        icon="alert"
        title={t('agentConsole.v2.emp02.loadErrorTitle')}
        desc={t('agentConsole.v2.emp02.loadErrorDesc')}
        actions={
          <button
            type="button"
            className="b out"
            data-testid="agent-v2-emp-c-load-retry"
            onClick={() => {
              setGate(null);
              setAttempt((n) => n + 1);
              setStage('loading');
            }}
          >
            <LkIcon name="refresh" size={16} />
            {t('agentConsole.v2.emp02.retry')}
          </button>
        }
        techRows={techRows(gate.status, gate.requestId)}
      />
    );
  }

  if (stage === 'loading') return shell(<FormSkeleton />);

  if (result) {
    return shell(<EmpCreateResultCard result={result} onRestart={restart} />);
  }

  const errorCount = Object.values(errors).filter(Boolean).length;
  const showInvalid = submitted && errorCount > 0;
  /* E11 empty state: a pristine form has nothing to save, so the button starts
   * unusable instead of turning the first click into an error. */
  const saveDisabled = submitting || !currentUid || !dirty;

  return shell(
    <EmpCreateForm
      values={values}
      errors={errors}
      showInvalid={showInvalid}
      submitting={submitting}
      saveDisabled={saveDisabled}
      failure={failure}
      currentName={currentName}
      confirmLeave={confirmLeave}
      nameRef={nameRef}
      titleRef={titleRef}
      dutyRef={dutyRef}
      onFieldChange={setField}
      onSubmit={() => void handleSave()}
      onCancel={handleCancel}
      onLeaveDiscard={leave}
      onLeaveKeep={() => setConfirmLeave(false)}
    />
  );
}
