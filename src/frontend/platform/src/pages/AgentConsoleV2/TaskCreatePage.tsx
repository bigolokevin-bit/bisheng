/**
 * TSK-03 `/agent/tasks/new` — manual task creation.
 * Built against the locked C1 baseline `tsk03-target.html` + TSK03-TARGET-SPEC.
 *
 * Four fields, one read-only source row, one solid button. The source is fixed
 * to 手工创建 and is NOT a control: a channel selector or a message id input
 * would let a person impersonate a channel (TASK.md §1.1 manual shape).
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
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { userContext } from '@/contexts/userContext';

import { HelpTip } from './HelpTip';
import { useConsoleCrumbTail } from './Shell';
import { LkIcon } from './listkit';
import { avatarChar } from './identity';
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
  shortRef,
  submitWrite,
  type CreatedTask,
  type WriteFailureKind,
} from './createFlow';
import './createFlow.css';

type Stage = 'loading' | 'ready' | 'error' | 'forbidden' | 'auth';

type ResultKind = 'success' | 'replay' | 'conflict';

interface ResultState {
  kind: ResultKind;
  task?: CreatedTask;
  requestId?: string;
}

interface FieldErrors {
  title?: string;
  assignee?: string;
}

interface Candidate {
  id: string;
  name: string;
  title: string;
  lifecycleState: string;
}

const PRISTINE = { title: '', assigneeId: '', priority: 'normal', note: '' };
/* Presentation order only: 1 = 低, 2 = 普通, 3 = 高. The DOM never carries the
 * wire enum (SPEC §8 E04); the submit body still sends low/normal/high (§5). */
const PRIORITIES = ['low', 'normal', 'high'] as const;
/* draft is here because the domain refuses it (task.assignee_invalid): a
 * candidate that can only ever fail must not be offered as a choice. */
const EXCLUDED_LIFECYCLE = new Set(['offboarding', 'archived', 'draft']);

interface DeepLink {
  /** employee:<id> → id; anything else with an assignee= value stays empty */
  assigneeId: string;
  /** assignee= was present but not in employee:<id> shape */
  badAssigneeShape: boolean;
  priority: string;
  badPriority: boolean;
}

/* One read of location.search at mount: a link may name the assignee and the
   priority; anything it says that this page cannot honour is reported, never
   swallowed (R2 fix order D3). */
function parseDeepLink(search: string): DeepLink {
  const params = new URLSearchParams(search);
  const rawAssignee = params.get('assignee') ?? '';
  const rawPriority = params.get('priority') ?? '';
  const shaped = rawAssignee.startsWith('employee:');
  const priority = (PRIORITIES as readonly string[]).includes(rawPriority) ? rawPriority : '';
  return {
    assigneeId: shaped ? rawAssignee.slice('employee:'.length) : '',
    badAssigneeShape: Boolean(rawAssignee) && !shaped,
    priority,
    badPriority: Boolean(rawPriority) && !priority,
  };
}
/* Bounded candidate walk: enough for a pilot tenant, never an unbounded page
 * chain that could keep the form loading forever. */
const CANDIDATE_PAGE = 100;
const CANDIDATE_MAX_PAGES = 3;

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
  const [failure, setFailure] = useState<{ kind: 'invalid' | 'unavailable'; requestId?: string } | null>(
    null
  );
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

  const meta = (
    <div className="fresh" data-testid="agent-v2-tsk-c-fresh">
      <LkIcon name="clock" size={13} />
      <span>
        {t('agentConsole.v2.tsk03.freshLead')}
        <b>{t('agentConsole.v2.tsk03.freshStrong')}</b>
        {t('agentConsole.v2.tsk03.freshRest')}
      </span>
      <span className="faint">·</span>
      <span>{t('agentConsole.v2.tsk03.freshOpen')}</span>
      <span className="faint">·</span>
      <span>{t('agentConsole.v2.tsk03.freshSource')}</span>
    </div>
  );

  const head = (
    <div className="phead">
      <div style={{ minWidth: 0 }}>
        <div className="h1">
          <LkIcon name="plusSquare" size={20} />
          {t('agentConsole.v2.tsk03.title')}
        </div>
        <div className="sub">{t('agentConsole.v2.tsk03.sub')}</div>
      </div>
      <span className="sp" />
      <div className="acts">
        <Link className="lnk" to="/agent/tasks" data-testid="agent-v2-tsk-c-back">
          <LkIcon name="arrowLeft" size={13} />
          {t('agentConsole.v2.tsk03.back')}
        </Link>
      </div>
    </div>
  );

  const shell = (body: React.ReactNode) => (
    <div className="a2s-page">
      <div className="lk tsk03" data-testid="agent-v2-task-create">
        {meta}
        {head}
        {escWarn ? (
          <div className="roband" role="status" data-testid="agent-v2-tsk-c-esc-warn">
            <LkIcon name="info" size={14} />
            <span>{t('agentConsole.v2.tsk03.escWarn')}</span>
          </div>
        ) : null}
        {body}
        <PageFoot t={t} />
      </div>
    </div>
  );

  if (stage === 'loading') return shell(<FormSkeleton t={t} />);

  if (stage === 'error') {
    return shell(
      <div className="flow-narrow">
        <div className="card stage" data-testid="agent-v2-tsk-c-load-error">
          <span className="ic">
            <LkIcon name="alert" size={20} />
          </span>
          <div className="t">{t('agentConsole.v2.tsk03.loadErrorTitle')}</div>
          <div className="s">{t('agentConsole.v2.tsk03.loadErrorDesc')}</div>
          <div className="acts2">
            <button
              type="button"
              className="b out"
              data-testid="agent-v2-tsk-c-load-retry"
              onClick={() => setReloadToken((n) => n + 1)}
            >
              <LkIcon name="refresh" size={16} />
              {t('agentConsole.v2.tsk03.retry')}
            </button>
            <Link className="b gh" to="/agent/tasks">
              {t('agentConsole.v2.tsk03.back')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'auth') {
    return shell(
      <div className="flow-narrow">
        <div className="card stage" data-testid="agent-v2-tsk-c-auth">
          <span className="ic">
            <LkIcon name="lock" size={20} />
          </span>
          <div className="t">{t('agentConsole.v2.tsk03.authTitle')}</div>
          <div className="s">{t('agentConsole.v2.tsk03.authDesc')}</div>
          <div className="acts2">
            <a className="b out" href="/" data-testid="agent-v2-tsk-c-auth-relogin">
              {t('agentConsole.v2.tsk03.authAction')}
            </a>
            <Link className="b gh" to="/agent/tasks">
              {t('agentConsole.v2.tsk03.back')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'forbidden') {
    /* What this screen says: one plain explanation and two real exits (返回
       任务列表 / 重新读取 — the retry re-runs this very read, and if it comes
       back forbidden again, that is the honest answer). Everything about how
       the screen is built is gone: no 「逐字相同，只有码不同」, no 「不会先渲染
       骨架」, no 「不会泄露谁有权限」. Those are construction notes for the
       reviewer, not words for the person standing here (R2 fix order D2 /
       SPEC §6). 码值 and 请求编号 live only in the collapsed fold, so 403 and
       404 keep one body and differ only under the fold (E13). */
    return shell(
      <div className="flow-narrow">
        <div className="card stage" data-testid="agent-v2-tsk-c-forbidden">
          <span className="ic">
            <LkIcon name="lock" size={20} />
          </span>
          <div className="t">{t('agentConsole.v2.tsk03.forbiddenTitle')}</div>
          <div className="s">{t('agentConsole.v2.tsk03.forbiddenDesc')}</div>
          <div className="acts2">
            <Link className="b out" to="/agent/tasks" data-testid="agent-v2-tsk-c-forbidden-back">
              <LkIcon name="arrowLeft" size={16} />
              {t('agentConsole.v2.tsk03.forbiddenBack')}
            </Link>
            <button
              type="button"
              className="b gh"
              data-testid="agent-v2-tsk-c-forbidden-retry"
              onClick={() => setReloadToken((n) => n + 1)}
            >
              <LkIcon name="refresh" size={16} />
              {t('agentConsole.v2.tsk03.forbiddenRetry')}
            </button>
          </div>
          <TechInfo
            t={t}
            rows={[
              `${t('agentConsole.v2.tsk03.techRequest')} ${
                readRequestId ?? t('agentConsole.v2.id.requestIdAbsent')
              }`,
              ...(readStatus
                ? [t('agentConsole.v2.tsk03.techStatusCode', { status: readStatus })]
                : []),
            ]}
            center
          />
        </div>
      </div>
    );
  }

  if (result) {
    return shell(
      <ResultCard
        t={t}
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
    );
  }

  const errorCount = Object.values(errors).filter(Boolean).length;
  const showInvalid = submitted && errorCount > 0;
  const noCandidates = candidates.length === 0;
  const saveDisabled = submitting || noCandidates;
  const previewTitle = values.title.trim();

  return shell(
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
                        onClick={() => setReloadToken((n) => n + 1)}
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
                onClick={leave}
              >
                {t('agentConsole.v2.tsk03.leaveDiscard')}
              </button>
              <button
                type="button"
                className="b sm gh"
                data-testid="agent-v2-tsk-c-leave-keep"
                onClick={() => setConfirmLeave(false)}
              >
                {t('agentConsole.v2.tsk03.leaveKeep')}
              </button>
            </div>
          ) : null}
        </div>

        <div className="side">
          <div className="card pvc">
            <div className="card-hd">
              <span className="t">{t('agentConsole.v2.tsk03.previewTitle')}</span>
              <span className="sp" />
              <span className="hd-note">{t('agentConsole.v2.tsk03.previewNote')}</span>
            </div>
            <div className="pvbody">
              <div className="badge">
                <div className="tk-top">
                  <span className="pill nt">
                    <span className="dot" />
                    {t('agentConsole.v2.tsk03.statusOpen')}
                  </span>
                  <span className="pill nt xs" data-testid="agent-v2-tsk-c-preview-priority">
                    {t(`agentConsole.v2.tsk03.priority.${values.priority}`)}
                  </span>
                  <span className="tk-src">{t('agentConsole.v2.tsk03.sourceManual')}</span>
                </div>
                <div
                  className={`tk-title${previewTitle ? '' : ' empty'}`}
                  data-testid="agent-v2-tsk-c-preview-title"
                >
                  {previewTitle || t('agentConsole.v2.tsk03.previewTitleEmpty')}
                </div>
                <div className="tk-meta">
                  <span className="who">
                    <span className="ava" aria-hidden="true">
                      {selected
                        ? avatarChar(selected.name) ?? (selected.name ? Array.from(selected.name)[0] : '?')
                        : '?'}
                    </span>
                    <span className="nm2" style={selected ? undefined : { color: 'hsl(var(--micro-foreground))' }}>
                      {selected ? selected.name : t('agentConsole.v2.tsk03.previewAssigneeEmpty')}
                    </span>
                  </span>
                  <span className="sep" style={{ opacity: 0.5 }}>
                    ·
                  </span>
                  <span>{t('agentConsole.v2.tsk03.assigneeLabel')}</span>
                </div>
              </div>
              <p className="pvhint">{t('agentConsole.v2.tsk03.previewHint')}</p>
            </div>
          </div>

          <div className="card">
            <div className="card-hd">
              <span className="t">{t('agentConsole.v2.tsk03.afterTitle')}</span>
              <span className="sp" />
            </div>
            <div className="rows">
              <div className="row">
                <span className="k">01</span>
                <div className="body">
                  <div className="nm">{t('agentConsole.v2.tsk03.after1Name')}</div>
                  <div className="why">{t('agentConsole.v2.tsk03.after1Why')}</div>
                </div>
              </div>
              <div className="row">
                <span className="k">02</span>
                <div className="body">
                  <div className="nm">{t('agentConsole.v2.tsk03.after2Name')}</div>
                  <div className="why">{t('agentConsole.v2.tsk03.after2Why')}</div>
                </div>
              </div>
              <div className="row">
                <span className="k">03</span>
                <div className="body">
                  <div className="nm">{t('agentConsole.v2.tsk03.after3Name')}</div>
                  <div className="why">{t('agentConsole.v2.tsk03.after3Why')}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-hd">
              <span className="t">{t('agentConsole.v2.tsk03.whySourceTitle')}</span>
              <HelpTip term="tsk03Source" testId="agent-v2-tsk-c-help-source" />
              <span className="sp" />
            </div>
            <div className="rows">
              <div className="row">
                <span className="k">·</span>
                <div className="body">
                  <div className="why">{t('agentConsole.v2.tsk03.whySourceLine')}</div>
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
  fallbackAssignee,
}: {
  t: TFunction;
  result: ResultState;
  copied: boolean;
  onCopy: (value: string) => void;
  onRestart: () => void;
  fallbackAssignee: string;
}) {
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
              t={t}
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
            t={t}
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

/* ------------------------------------------------------------------ shared bits */

function candidateLabel(c: Candidate, t: TFunction): string {
  const state = t(`agentConsole.lifecycle.${c.lifecycleState}`, c.lifecycleState);
  return [c.name || t('agentConsole.v2.id.unnamed'), c.title].filter(Boolean).join(' · ') + `（${state}）`;
}

function TechInfo({ t, rows, center }: { t: TFunction; rows: string[]; center?: boolean }) {
  return (
    <details className="tech">
      <summary>
        <LkIcon name="info" size={13} />
        {t('agentConsole.v2.tsk03.techSummary')}
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
    <div className="flow" data-testid="agent-v2-tsk-c-loading">
      <div className="flayout">
        <div className="fcol">
          <div className="card skel" role="status" aria-label={t('agentConsole.v2.tsk03.loadingAria')}>
            <div className="card-hd">
              <div className="bar" style={{ width: 96, height: 14 }} />
              <span className="sp" />
              <div className="bar" style={{ width: 132, height: 11 }} />
            </div>
            <div className="fset">
              <div className="field">
                <div className="bar" style={{ width: 52, height: 11, marginBottom: 8 }} />
                <div className="bar" style={{ height: 40 }} />
              </div>
              <div className="field">
                <div className="bar" style={{ width: 60, height: 11, marginBottom: 8 }} />
                <div className="bar" style={{ height: 40 }} />
              </div>
              <div className="field">
                <div className="bar" style={{ width: 52, height: 11, marginBottom: 8 }} />
                <div className="bar" style={{ height: 56 }} />
              </div>
              <div className="field">
                <div className="bar" style={{ width: 52, height: 11, marginBottom: 8 }} />
                <div className="bar" style={{ height: 88 }} />
              </div>
            </div>
            <div className="facts">
              <div className="bar" style={{ width: 72, height: 36 }} />
              <span className="sp" />
              <div className="bar" style={{ width: 104, height: 36 }} />
            </div>
          </div>
          <p className="skel-note">{t('agentConsole.v2.tsk03.loadingNote')}</p>
        </div>
        <div className="side skel" aria-hidden="true">
          <div className="card">
            <div className="card-hd">
              <div className="bar" style={{ width: 96, height: 13 }} />
            </div>
            <div className="pvbody">
              <div className="badge">
                <div className="bar" style={{ width: 120, height: 12 }} />
                <div className="bar" style={{ width: '90%', height: 14 }} />
                <div className="bar" style={{ width: 60, height: 11 }} />
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
      <span>{t('agentConsole.v2.tsk03.pfootSource')}</span>
      <span className="sp" aria-hidden="true" />
      <span>{t('agentConsole.v2.tsk03.pfootCaliber')}</span>
      <span className="sp" aria-hidden="true" />
      <span>{t('agentConsole.v2.tsk03.pfootLanguage')}</span>
    </div>
  );
}