/**
 * TSK-03 `/agent/tasks/new` — manual task creation.
 * Built against the locked C1 baseline `tsk03-target.html` + TSK03-TARGET-SPEC.
 *
 * Four fields, one read-only source row, one solid button. The source is fixed
 * to 手工创建 and is NOT a control: a channel selector or a message id input
 * would let a person impersonate a channel (TASK.md §1.1 manual shape).
 *
 * This file owns the state machine and composes the screen from its siblings:
 * `TskCreateBits.tsx` (page lines, skeleton, stage screens, side column),
 * `TskCreateForm.tsx` (the write form) and `TskCreateResultCard.tsx`
 * (success / replay / conflict). The split keeps every file under the repo's
 * 600-line rule and follows the EMP-02 layout.
 *
 * Hard rules carried by this file:
 * - The button REALLY creates: POST /api/tasks with `source: {"kind":"manual"}`,
 *   an `Idempotency-Key` generated once per submission and reused by retries.
 *   No channel, no messageId, no created_by, no status (§5).
 * - Assignees are real employees from E11; offboarding, archived and draft are
 *   excluded (assigning work to them creates a task that stalls immediately,
 *   §9-2, and the domain answers 内容不合格 for a draft assignee — an option
 *   that can only fail is not a choice). On-duty and onboarding stay,
 *   annotated with their state.
 * - A deep link (?assignee=employee:<id> / ?priority=low|normal|high) prefills
 *   what it can and says in one neutral line what it could not apply; nothing
 *   is dropped in silence, and no id from the URL is ever put on screen.
 * - No assignee candidates ⇒ the select is NOT rendered at all: a block
 *   explains why, offers 「去新建员工」/「重新读取」, keeps the typed title, and
 *   disables the primary button with a readable reason (E06).
 * - 次优先级 vocabulary is 低 / 普通 / 高 — never 中, never the raw enum (E04).
 * - Same replay/conflict/failed/forbidden rules as EMP-02; success does not
 *   auto-navigate and never claims 「已通知负责人」 (E09).
 * - Zero engineering language in body copy: statuses, ids, field names and the
 *   submission key live only inside the collapsed 技术信息. No amount, no due
 *   date input anywhere on the page.
 */
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { userContext } from '@/contexts/userContext';

import { useConsoleCrumbTail } from './Shell';
import {
  fetchEmployeesPage,
  makeFetcher,
  FETCH_TIMEOUT_MS,
  type EmployeeRow,
} from './v2Data';
import {
  isDirty,
  newIdempotencyKey,
  readCreatedTask,
  submitWrite,
  type WriteFailureKind,
} from './createFlow';
import {
  AuthScreen,
  CANDIDATE_MAX_PAGES,
  CANDIDATE_PAGE,
  EXCLUDED_LIFECYCLE,
  ForbiddenScreen,
  FormSkeleton,
  LoadErrorScreen,
  PRISTINE,
  PageShell,
  parseDeepLink,
  type Candidate,
  type DeepLink,
  type FieldErrors,
  type SaveFailure,
} from './TskCreateBits';
import { TskCreateForm } from './TskCreateForm';
import { TskCreateResultCard, type ResultState } from './TskCreateResultCard';
import './createFlow.css';

type Stage = 'loading' | 'ready' | 'error' | 'forbidden' | 'auth';

export function TaskCreatePage({ writeEnv }: { writeEnv?: Parameters<typeof submitWrite>[0]['env'] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  useConsoleCrumbTail(t('agentConsole.v2.tsk03.crumb'));

  const ctx = useContext(userContext) as
    | { user?: { user_id?: number | string; user_name?: string; name?: string; username?: string } }
    | null;
  const currentName = String(
    ctx?.user?.user_name || ctx?.user?.name || ctx?.user?.username || ''
  ).trim();

  const [stage, setStage] = useState<Stage>('loading');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const [values, setValues] = useState({ ...PRISTINE });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [result, setResult] = useState<ResultState | null>(null);
  const [copied, setCopied] = useState(false);
  const [escWarn, setEscWarn] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  /* deep link: notices the page must say out loud (locale key names) */
  const [deepNotices, setDeepNotices] = useState<string[]>([]);
  /* request id and status of the failed read, so the 无权限 screen can offer
     them in the collapsed fold and nowhere else (SPEC §5) */
  const [readRequestId, setReadRequestId] = useState<string | undefined>(undefined);
  const [readStatus, setReadStatus] = useState<number | undefined>(undefined);

  const linkRef = useRef<DeepLink | null>(null);
  if (linkRef.current === null) linkRef.current = parseDeepLink(location.search);
  const linkUsedRef = useRef(false);

  const titleRef = useRef<HTMLInputElement | null>(null);
  const assigneeRef = useRef<HTMLSelectElement | null>(null);
  const keyRef = useRef<string | null>(null);
  const attemptsRef = useRef(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const escTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dirty = isDirty(values, PRISTINE);
  const selected = candidates.find((c) => c.id === values.assigneeId) ?? null;
  /* What the link managed to set stays visible as a highlight plus one plain
     line; the value itself is shown as the person's name, never as an id. */
  const deepAssignee = Boolean(linkRef.current?.assigneeId) && values.assigneeId === linkRef.current?.assigneeId;
  const deepPriority = Boolean(linkRef.current?.priority) && values.priority === linkRef.current?.priority;

  const pushNotice = useCallback((key: string) => {
    setDeepNotices((prev) => (prev.includes(key) ? prev : [...prev, key]));
  }, []);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
      if (escTimer.current) clearTimeout(escTimer.current);
    },
    []
  );

  /* ---------- assignee candidates (E11, real employees only) ---------- */
  useEffect(() => {
    let live = true;
    setStage('loading');
    const watchdog = window.setTimeout(() => {
      if (live) setStage((prev) => (prev === 'loading' ? 'error' : prev));
    }, FETCH_TIMEOUT_MS);

    void (async () => {
      const fetcher = makeFetcher();
      const rows: EmployeeRow[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < CANDIDATE_MAX_PAGES; page += 1) {
        const res = await fetchEmployeesPage(fetcher, { limit: CANDIDATE_PAGE, cursor });
        if (!live) return;
        if (!res.ok) {
          window.clearTimeout(watchdog);
          setReadRequestId(res.requestId);
          setReadStatus(res.status);
          if (res.status === 401) setStage('auth');
          else if (res.status === 403 || res.status === 404) setStage('forbidden');
          else setStage('error');
          return;
        }
        const items = res.data?.items ?? [];
        rows.push(...items);
        if (!res.data?.nextCursor) break;
        cursor = res.data.nextCursor;
      }
      if (!live) return;
      window.clearTimeout(watchdog);
      const usable: Candidate[] = [];
      for (const row of rows) {
        const id = (row.employeeId ?? '').trim();
        const state = (row.lifecycleState ?? '').trim();
        if (!id || EXCLUDED_LIFECYCLE.has(state)) continue;
        if (usable.some((c) => c.id === id)) continue;
        usable.push({
          id,
          name: (row.name ?? '').trim(),
          title: (row.title ?? '').trim(),
          lifecycleState: state,
        });
      }
      usable.sort((a, b) => a.name.localeCompare(b.name));
      setCandidates(usable);
      setReadRequestId(undefined);
      setReadStatus(undefined);
      /* A deep link is consumed once, against the roster it actually got: the
         id is matched, never trusted, and an id that is not here is reported
         in user language instead of vanishing. No raw id reaches the screen. */
      const link = linkRef.current;
      if (link && !linkUsedRef.current) {
        linkUsedRef.current = true;
        if (link.badAssigneeShape) pushNotice('deepBadAssignee');
        if (link.assigneeId) {
          if (usable.some((c) => c.id === link.assigneeId)) setValues((p) => ({ ...p, assigneeId: link.assigneeId }));
          else pushNotice('deepMissingAssignee');
        }
      }
      setValues((prev) => {
        if (!prev.assigneeId) return prev;
        return usable.some((c) => c.id === prev.assigneeId) ? prev : { ...prev, assigneeId: '' };
      });
      setStage('ready');
    })();

    return () => {
      live = false;
      window.clearTimeout(watchdog);
    };
  }, [reloadToken]);

  /* deep link: the priority needs no roster, so it lands at once. An answer
     the link never gave is said out loud, in plain words, without red. */
  useEffect(() => {
    const link = linkRef.current;
    if (!link) return undefined;
    if (link.priority) setValues((prev) => ({ ...prev, priority: link.priority }));
    else if (link.badPriority) pushNotice('deepBadPriority');
    return undefined;
  }, [pushNotice]);

  /* Enter the page on the title once candidates are ready (§4 focus). */
  useEffect(() => {
    if (stage === 'ready' && !result) titleRef.current?.focus();
  }, [stage, result]);

  const leave = useCallback(() => navigate('/agent/tasks'), [navigate]);

  useEffect(() => {
    if (!dirty || result) return undefined;
    const onBeforeUnload = (ev: BeforeUnloadEvent) => {
      ev.preventDefault();
      ev.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty, result]);

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

  const setField = <K extends keyof typeof PRISTINE>(key: K, next: (typeof PRISTINE)[K]) => {
    setValues((prev) => ({ ...prev, [key]: next }));
    if (key === 'title') setErrors((prev) => ({ ...prev, title: undefined }));
    if (key === 'assigneeId') setErrors((prev) => ({ ...prev, assignee: undefined }));
  };

  const validate = useCallback((): FieldErrors => {
    const next: FieldErrors = {};
    if (!values.title.trim()) {
      next.title = values.title
        ? t('agentConsole.v2.tsk03.errTitleBlank')
        : t('agentConsole.v2.tsk03.errTitleRequired');
    }
    if (!values.assigneeId || !candidates.some((c) => c.id === values.assigneeId)) {
      next.assignee = t('agentConsole.v2.tsk03.errAssigneeRequired');
    }
    return next;
  }, [candidates, t, values.assigneeId, values.title]);

  const onSubmit = async (ev?: { preventDefault?: () => void }) => {
    ev?.preventDefault?.();
    if (submitting || result) return;
    setSubmitted(true);

    const nextErrors = validate();
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      setFailure(null);
      if (nextErrors.title) titleRef.current?.focus();
      else assigneeRef.current?.focus();
      return;
    }

    if (!keyRef.current) keyRef.current = newIdempotencyKey();
    const key = keyRef.current;
    attemptsRef.current += 1;
    setSubmitting(true);
    setFailure(null);

    const body: Record<string, unknown> = {
      title: values.title.trim(),
      assignee: { type: 'employee', id: values.assigneeId },
      priority: values.priority,
      // Fixed by this page: a manual task is not extracted from a channel
      // message, and no channel/messageId is invented to satisfy the other
      // shape (TASK.md §1.1).
      source: { kind: 'manual' },
    };
    if (values.note.trim()) body.description = values.note.trim();

    const outcome = await submitWrite<unknown>({ path: '/api/tasks', body, key, env: writeEnv });
    setSubmitting(false);

    if (outcome.ok) {
      const created = readCreatedTask(outcome.data);
      if (!created) {
        setFailure({ kind: 'unavailable', requestId: outcome.requestId });
        return;
      }
      setResult({
        kind: attemptsRef.current > 1 ? 'replay' : 'success',
        task: created,
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
    setDeepNotices([]);
    window.setTimeout(() => titleRef.current?.focus(), 0);
  };

  const onCancel = () => {
    if (dirty && !result) setConfirmLeave(true);
    else leave();
  };

  if (stage === 'loading') {
    return (
      <PageShell escWarn={escWarn}>
        <FormSkeleton />
      </PageShell>
    );
  }

  if (stage === 'error') {
    return (
      <PageShell escWarn={escWarn}>
        <LoadErrorScreen onRetry={() => setReloadToken((n) => n + 1)} />
      </PageShell>
    );
  }

  if (stage === 'auth') {
    return (
      <PageShell escWarn={escWarn}>
        <AuthScreen />
      </PageShell>
    );
  }

  if (stage === 'forbidden') {
    return (
      <PageShell escWarn={escWarn}>
        <ForbiddenScreen
          onRetry={() => setReloadToken((n) => n + 1)}
          readRequestId={readRequestId}
          readStatus={readStatus}
        />
      </PageShell>
    );
  }

  if (result) {
    return (
      <PageShell escWarn={escWarn}>
        <TskCreateResultCard
          result={result}
          copied={copied}
          onCopy={copyId}
          onRestart={restart}
          fallbackAssignee={
            selected
              ? `${selected.name}${selected.title ? ` · ${selected.title}` : ''}`
              : t('agentConsole.v2.tsk03.resultAssigneeUnknown')
          }
        />
      </PageShell>
    );
  }

  const errorCount = Object.values(errors).filter(Boolean).length;
  const showInvalid = submitted && errorCount > 0;
  const noCandidates = candidates.length === 0;
  const saveDisabled = submitting || noCandidates;
  const previewTitle = values.title.trim();

  return (
    <PageShell escWarn={escWarn}>
      <TskCreateForm
        values={values}
        errors={errors}
        setField={setField}
        showInvalid={showInvalid}
        errorCount={errorCount}
        submitting={submitting}
        saveDisabled={saveDisabled}
        failure={failure}
        onSubmit={onSubmit}
        onCancel={onCancel}
        onReload={() => setReloadToken((n) => n + 1)}
        deepNotices={deepNotices}
        deepAssignee={deepAssignee}
        deepPriority={deepPriority}
        candidates={candidates}
        selected={selected}
        noCandidates={noCandidates}
        currentName={currentName}
        confirmLeave={confirmLeave}
        onLeave={leave}
        onKeep={() => setConfirmLeave(false)}
        previewTitle={previewTitle}
        titleRef={titleRef}
        assigneeRef={assigneeRef}
      />
    </PageShell>
  );
}