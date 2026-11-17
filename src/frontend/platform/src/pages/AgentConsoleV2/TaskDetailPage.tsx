/* TSK-02 `/agent/tasks/:taskId` — read-only task detail, rebuilt against the
 * frozen C1 baseline tsk02-target.html + TSK02-TARGET-SPEC.md.
 *
 * Shape (spec §1): meta row (freshness · source · read-only caliber) → page
 * read-only boundary banner → back row + page head (status pill + h1 = title +
 * mono taskId + priority badge | refresh · copy link) → summary card
 * (HFieldRow 8 fields + wide description) → split(1fr+380): 进展/受阻原因/
 * 来源/关联运行/关联任务 | 状态机/审计入口/口径 → footer.
 *
 * Honest-data rules (TASK v1.0 + M2-PRD-DEEP §5/§13):
 * - T2 GET /api/task-detail is the only task source. Tenant id is never
 *   rendered; it lives in the env pill title only.
 * - Optional keys that are absent do not get a row (缺席 ≠ null). The only
 *   key that is always present and may be empty is progressNote → 「暂无进展
 *   记录」 + updatedAt, never a sentence invented here.
 * - blocked/cancelled without statusReason, and done without progressNote,
 *   are data anomalies: surfaced in a warning bar, not silently blanked.
 * - human actors read 「用户 #<uid>」 (S2): no name endpoint exists, so the
 *   readable fallback form is the floor and the raw ref lives in copy/title.
 * - The state machine card is a drawing of the frozen table: zero buttons,
 *   zero links, zero form controls (E06); out-of-table transitions are text.
 * - Zero write entries: no reassign / edit / transition / batch / delete
 *   control exists in the DOM, not even a disabled one.
 * - Five states: loading skeleton, HTTP 500 / HTTP 400 (missing id) stages,
 *   403/404 forbidden (same body, code only), normal.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  AuthError,
  createHttpAgentConsoleApi,
  type AgentConsoleApi,
  type EmployeeSummary,
} from '@/controllers/API/agent';
import {
  createHttpAgentConsoleRunsApi,
  type AgentConsoleRunsApi,
  type RunStatus,
} from '@/controllers/API/agentConsoleRuns';
import {
  createHttpAgentConsoleTaskDetailApi,
  type AgentConsoleTaskDetailApi,
  type TaskActorRef,
  type TaskDetail,
} from '@/controllers/API/agentConsoleTaskDetail';

import { HelpTip } from './HelpTip';
import { CopyId, LkIcon, StageCard } from './listkit';
import { avatarChar, employeeLabelById, humanLabel } from './identity';
import { useConsoleCrumbTail } from './Shell';
import { CopyText, Field, Panel, RUN_STATUS_KEYS, fmtClock, fmtMoment, fullIso, statusTone } from './runDetailKit';
import {
  StateGraph,
  TERMINAL_TASK_STATUSES,
  TaskPill,
  channelLabel,
  dueNote,
  overdueDays,
  priorityKey,
  shortTaskRef,
  smEdges,
  smFoot,
  smTerms,
} from './taskDetailKit';

import './runDetail.css';
import './taskDetail.css';

type HeadView =
  | { kind: 'loading' }
  | { kind: 'ready'; task: TaskDetail; pulledAt: number }
  | { kind: 'error'; status: number }
  | { kind: 'forbidden'; status: number };

export interface TaskDetailPageProps {
  /** T2 read-only adapter (injectable for tests, HTTP fallback on the page). */
  api?: AgentConsoleTaskDetailApi;
  /** R2 only: the linked run's status pill (the page never copies run events). */
  runsApi?: AgentConsoleRunsApi;
  /** E11 only: employee display names for the two actor fields. */
  consoleApi?: AgentConsoleApi;
  /** Route param override (tests); defaults to `:taskId`. */
  taskIdOverride?: string;
  /** Pins the page clock for due/overdue derivations (tests only). */
  nowOverride?: number;
}

export function TaskDetailPage({
  api,
  runsApi,
  consoleApi,
  taskIdOverride,
  nowOverride,
}: TaskDetailPageProps = {}) {
  const { t } = useTranslation();
  const params = useParams();
  const navigate = useNavigate();
  const taskId = taskIdOverride ?? params.taskId ?? '';
  const tasks = useMemo(() => api ?? createHttpAgentConsoleTaskDetailApi(), [api]);
  const runs = useMemo(() => runsApi ?? createHttpAgentConsoleRunsApi(), [runsApi]);
  const employees = useMemo(() => consoleApi ?? createHttpAgentConsoleApi(), [consoleApi]);
  useConsoleCrumbTail(t('agentConsole.v2.tsk02.title'));

  const [head, setHead] = useState<HeadView>(() =>
    taskId ? { kind: 'loading' } : { kind: 'error', status: 400 },
  );
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [now, setNow] = useState(() => nowOverride ?? Date.now());

  const onAuth = useCallback(() => {
    window.location.assign('/');
  }, []);

  /* ---------- E11 employee names (cosmetic; failure degrades to raw id) ---------- */
  useEffect(() => {
    let live = true;
    employees
      .listEmployees({ limit: 100 })
      .then((res) => {
        if (!live || !res || !Array.isArray(res.items)) return;
        const map = new Map<string, string>();
        for (const e of res.items as EmployeeSummary[]) {
          if (e.employeeId && e.name) map.set(e.employeeId, e.name);
        }
        setNames(map);
      })
      .catch(() => {
        /* names degrade to the raw employeeId — never a fabricated name */
      });
    return () => {
      live = false;
    };
  }, [employees]);

  /* ---------- T2 head (initial load + full-page retry) ---------- */
  useEffect(() => {
    if (!taskId) return undefined;
    let live = true;
    setHead({ kind: 'loading' });
    setRunStatus(null);
    tasks
      .getTaskDetail({ id: taskId })
      .then((res) => {
        if (!live) return;
        if (res.ok && res.data) {
          setHead({ kind: 'ready', task: res.data, pulledAt: Date.now() });
        } else if (res.status === 403 || res.status === 404) {
          setHead({ kind: 'forbidden', status: res.status });
        } else {
          setHead({ kind: 'error', status: res.status });
        }
      })
      .catch((err: unknown) => {
        if (!live) return;
        if (err instanceof AuthError) {
          onAuth();
          return;
        }
        setHead({ kind: 'error', status: 0 });
      });
    return () => {
      live = false;
    };
  }, [tasks, taskId, reloadToken, onAuth]);

  const linkedRunId = head.kind === 'ready' ? head.task.source?.runId ?? null : null;

  /* ---------- R2: linked run status only (never its event stream) ---------- */
  useEffect(() => {
    if (!linkedRunId) {
      setRunStatus(null);
      return undefined;
    }
    let live = true;
    runs
      .getRunDetail({ id: linkedRunId })
      .then((res) => {
        if (live && res.ok && res.data) setRunStatus(res.data.status);
      })
      .catch(() => {
        /* no pill rather than a guessed run status */
      });
    return () => {
      live = false;
    };
  }, [runs, linkedRunId]);

  const refresh = useCallback(() => {
    setNow(nowOverride ?? Date.now());
    setReloadToken((n) => n + 1);
  }, [nowOverride]);

  const goBack = useCallback(() => {
    navigate('/agent/tasks');
  }, [navigate]);

  /* ---------- state screens ---------- */

  if (head.kind === 'loading') {
    return <TaskSkeleton />;
  }

  if (head.kind === 'forbidden') {
    return (
      <div className="a2s-page">
        <div className="lk a2r a2t" data-testid="agent-v2-task-detail">
          <StageCard
            icon="lock"
            title={t('agentConsole.v2.tsk02.forbiddenTitle')}
            desc={
              <>
                {t('agentConsole.v2.tsk02.forbiddenDescPre')}
                <span className="mono">HTTP {head.status}</span>
                {t('agentConsole.v2.tsk02.forbiddenDescPost')}
              </>
            }
            testId="agent-v2-task-forbidden"
          >
            <button
              type="button"
              className="b out"
              data-testid="agent-v2-task-forbidden-retry"
              onClick={refresh}
            >
              <LkIcon name="refresh" size={16} />
              {t('agentConsole.v2.tsk02.forbiddenRetry')}
            </button>
            <Link className="lnk" to="/agent/tasks" data-testid="agent-v2-task-forbidden-back">
              {t('agentConsole.v2.tsk02.backToList')}
            </Link>
          </StageCard>
        </div>
      </div>
    );
  }

  if (head.kind === 'error') {
    const is400 = head.status === 400;
    return (
      <div className="a2s-page">
        <div className="lk a2r a2t" data-testid="agent-v2-task-detail">
          <StageCard
            icon="alert"
            title={t(
              is400
                ? 'agentConsole.v2.tsk02.error400Title'
                : 'agentConsole.v2.tsk02.errorTitle',
            )}
            desc={
              is400 ? (
                <>
                  {t('agentConsole.v2.tsk02.error400DescPre')}
                  <span className="mono">HTTP 400</span>
                  {t('agentConsole.v2.tsk02.error400DescPost')}
                </>
              ) : (
                <>
                  {t('agentConsole.v2.tsk02.errorDescPre')}
                  <span className="mono">
                    {head.status > 0
                      ? `HTTP ${head.status}`
                      : t('agentConsole.v2.tsk02.errorNetworkCode')}
                  </span>
                  {t('agentConsole.v2.tsk02.errorDescPost')}
                </>
              )
            }
            testId="agent-v2-task-error"
          >
            {is400 ? (
              <Link className="b out" to="/agent/tasks" data-testid="agent-v2-task-error-back">
                {t('agentConsole.v2.tsk02.backToList')}
              </Link>
            ) : (
              <>
                <button
                  type="button"
                  className="b out"
                  data-testid="agent-v2-task-error-retry"
                  onClick={refresh}
                >
                  <LkIcon name="refresh" size={16} />
                  {t('agentConsole.v2.tsk02.reload')}
                </button>
                <Link className="lnk" to="/agent/tasks">
                  {t('agentConsole.v2.tsk02.backFirst')}
                </Link>
              </>
            )}
          </StageCard>
        </div>
      </div>
    );
  }

  /* ---------- normal (head ready) ---------- */

  const task = head.task;
  const status = task.status;
  const terminal = TERMINAL_TASK_STATUSES.has(status);
  const dueMs = task.dueAt ? Date.parse(task.dueAt) : NaN;
  const dueOverdue =
    Number.isFinite(dueMs) && !terminal && dueMs < now;
  const dueDays = task.dueAt ? overdueDays(task.dueAt, now) : null;

  const reasonMissing =
    (status === 'blocked' || status === 'cancelled') &&
    (!task.statusReason || task.statusReason.trim() === '');
  const progressMissing = status === 'done' && !task.progressNote;

  const assignee = actorView(task.assignee, names, t, 'assignee');
  const creator = actorView(task.createdBy, names, t, 'creator');
  const hasDescription =
    typeof task.description === 'string' && task.description.trim() !== '';
  const related = Array.isArray(task.relatedTaskIds)
    ? task.relatedTaskIds.filter((id) => typeof id === 'string' && id !== '')
    : [];
  const hasRun = !!task.source?.runId;

  return (
    <div className="a2s-page">
      <div className="lk a2r a2t" data-testid="agent-v2-task-detail">
        <div className="fresh" data-testid="agent-v2-task-fresh">
          <LkIcon name="clock" size={13} />
          <span aria-live="polite">
            {t('agentConsole.v2.tsk02.updated')}{' '}
            <span className="mono">{fmtClock(head.pulledAt)}</span>
          </span>
          <span className="faint" aria-hidden="true">
            ·
          </span>
          <span>
            {t('agentConsole.v2.tsk02.sourceRowPrefix')}{' '}
            <span className="mono">GET /api/task-detail?id=</span>{' '}
            {t('agentConsole.v2.tsk02.sourceRowSuffix')}
          </span>
        </div>

        {/* Page-level read-only boundary: the DOM has no write entry, and the
            page says so instead of leaving the absence unexplained. */}
        <div className="a2t-roband" role="note" aria-label={t('agentConsole.v2.tsk02.roAria')}>
          <LkIcon name="lock" size={14} />
          <span>
            <b>{t('agentConsole.v2.tsk02.roTitle')}</b>
            {t('agentConsole.v2.tsk02.roBody')}
          </span>
          <HelpTip term="tsk02Readonly" testId="agent-v2-task-ro-help" />
          <span className="a2r-sp" />
          <span className="mono">{t('agentConsole.v2.tsk02.roTag')}</span>
        </div>

        <div className="a2r-backrow">
          <button
            type="button"
            className="b gh sm"
            data-testid="agent-v2-task-back"
            aria-label={t('agentConsole.v2.tsk02.back')}
            onClick={goBack}
          >
            <LkIcon name="chevL" size={14} />
            {t('agentConsole.v2.tsk02.back')}
          </button>
          <span className="a2t-hdn">{t('agentConsole.v2.tsk02.inbound')}</span>
        </div>

        <div className="phead">
          <div className="a2r-headmain">
            <h1 className="h1">
              <TaskPill status={status} t={t} testId="agent-v2-task-status" />
              <span className="a2t-h1tx" data-testid="agent-v2-task-title">
                {task.title}
              </span>
            </h1>
            <div className="a2r-idline">
              <span className="micro">{t('agentConsole.v2.tsk02.idLabel')}</span>
              <CopyId
                value={task.taskId}
                display={shortTaskRef(task.taskId)}
                ariaLabel={t('agentConsole.v2.tsk02.copyTaskId')}
                copiedLabel={t('agentConsole.v2.tsk.copied')}
                testId="agent-v2-task-id"
              />
              {task.priority === 'high' ? (
                <span
                  className="pill wr xs"
                  title={t('agentConsole.v2.tsk02.priHighTitle')}
                  data-testid="agent-v2-task-pri-badge"
                >
                  <span className="dot" aria-hidden="true" />
                  {t('agentConsole.v2.tsk.priHighChip')}
                </span>
              ) : null}
            </div>
          </div>
          <span className="a2r-sp" aria-hidden="true" />
          <div className="a2r-acts">
            <button
              type="button"
              className="b gh"
              title={t('agentConsole.v2.tsk02.refreshTitle')}
              data-testid="agent-v2-task-refresh"
              onClick={refresh}
            >
              <LkIcon name="refresh" size={16} />
              {t('agentConsole.v2.tsk02.refresh')}
            </button>
            <CopyText
              value={typeof window !== 'undefined' ? window.location.href : ''}
              label={t('agentConsole.v2.tsk02.copyLink')}
              aria={t('agentConsole.v2.tsk02.copyLinkTitle')}
              testId="agent-v2-task-copy-link"
              className="b out"
              icon={<LkIcon name="link" size={16} />}
            />
          </div>
        </div>

        {reasonMissing ? (
          <div
            className="a2t-roband a2t-warn"
            role="status"
            aria-live="polite"
            data-testid="agent-v2-task-anomaly"
          >
            <LkIcon name="alert" size={14} />
            <span>
              <b>{t('agentConsole.v2.tsk02.anomalyReasonTitle')}</b>
              {t('agentConsole.v2.tsk02.anomalyReasonBody')}
            </span>
            <span className="a2r-sp" />
            <span className="mono" title="status_reason">
              {t('agentConsole.v2.tsk02.anomalyReasonTag')}
            </span>
          </div>
        ) : progressMissing ? (
          <div
            className="a2t-roband a2t-warn"
            role="status"
            aria-live="polite"
            data-testid="agent-v2-task-anomaly-progress"
          >
            <LkIcon name="alert" size={14} />
            <span>
              <b>{t('agentConsole.v2.tsk02.anomalyProgressTitle')}</b>
              {t('agentConsole.v2.tsk02.anomalyProgressBody')}
            </span>
            <span className="a2r-sp" />
            <span className="mono" title="progress_note">
              {t('agentConsole.v2.tsk02.anomalyProgressTag')}
            </span>
          </div>
        ) : null}

        {/* ---------- summary card: 8 fields + wide description ---------- */}
        <div className="card a2r-panel" data-testid="agent-v2-task-summary">
          <div className="a2r-ch">
            <span className="a2r-cht">{t('agentConsole.v2.tsk02.summaryTitle')}</span>
            <span className="a2r-chc mono">T2</span>
            <span className="a2r-sp" />
            <span className="a2r-chn">{t('agentConsole.v2.tsk02.summaryNote')}</span>
          </div>
          <div className="a2r-hfs">
            <Field
              label={
                <>
                  {t('agentConsole.v2.tsk02.fAssignee')}{' '}
                  <HelpTip term="taskAssignee" testId="agent-v2-task-help-assignee" />
                </>
              }
              sans
              note={assignee.note}
              testId="agent-v2-task-f-assignee"
            >
              {assignee.node}
            </Field>

            <Field
              label={t('agentConsole.v2.tsk02.fCreator')}
              sans
              note={creator.note}
              testId="agent-v2-task-f-creator"
            >
              {creator.node}
            </Field>

            {task.priority ? (
              <Field
                label={t('agentConsole.v2.tsk02.fPriority')}
                sans
                note={
                  task.priority === 'high'
                    ? t('agentConsole.v2.tsk02.priHighNote')
                    : t('agentConsole.v2.tsk02.priNote')
                }
                testId="agent-v2-task-f-priority"
              >
                {priorityKey(task.priority) ? (
                  <span
                    className={`pill${task.priority === 'high' ? ' wr' : ' nt'}`}
                    title={t('agentConsole.v2.tsk02.priHighTitle')}
                  >
                    <span className="dot" aria-hidden="true" />
                    {t(priorityKey(task.priority) as string)}
                  </span>
                ) : (
                  <span className="mono" title={t('agentConsole.v2.tsk02.priUnknownTitle')}>
                    {task.priority}
                  </span>
                )}
              </Field>
            ) : null}

            <Field
              label={t('agentConsole.v2.tsk02.fDue')}
              note={dueNote(t, task.dueAt, status, now)}
              testId="agent-v2-task-f-due"
            >
              {task.dueAt ? (
                <span
                  className={dueOverdue ? 'a2t-danger' : undefined}
                  title={fullIso(task.dueAt)}
                  data-overdue={dueOverdue ? 'true' : 'false'}
                >
                  {fmtMoment(task.dueAt)}
                  {dueOverdue ? (
                    <span className="pill dg xs" data-testid="agent-v2-task-overdue">
                      <span className="dot" aria-hidden="true" />
                      {dueDays && dueDays >= 1
                        ? t('agentConsole.v2.tsk02.overdueDays', { n: dueDays })
                        : t('agentConsole.v2.tsk02.overdue')}
                    </span>
                  ) : null}
                </span>
              ) : (
                <span className="faint">{t('agentConsole.v2.tsk02.dueNone')}</span>
              )}
            </Field>

            <Field
              label={t('agentConsole.v2.tsk02.fStatus')}
              sans
              note={t('agentConsole.v2.tsk02.statusNoteField')}
              testId="agent-v2-task-f-status"
            >
              <TaskPill status={status} t={t} xs />
            </Field>

            {terminal && task.closedAt ? (
              <Field
                label={t('agentConsole.v2.tsk02.fClosed')}
                note={t('agentConsole.v2.tsk02.closedNote')}
                title={fullIso(task.closedAt)}
                testId="agent-v2-task-f-closed"
              >
                {fmtMoment(task.closedAt)}
              </Field>
            ) : null}

            <Field
              label={t('agentConsole.v2.tsk02.fCreated')}
              note={t('agentConsole.v2.tsk02.createdNote', {
                channel: channelLabel(t, task.source?.channel ?? ''),
              })}
              title={fullIso(task.createdAt)}
              testId="agent-v2-task-f-created"
            >
              {fmtMoment(task.createdAt)}
            </Field>

            <Field
              label={t('agentConsole.v2.tsk02.fUpdated')}
              note={t('agentConsole.v2.tsk02.updatedNote')}
              title={fullIso(task.updatedAt)}
              testId="agent-v2-task-f-updated"
            >
              {fmtMoment(task.updatedAt)}
            </Field>

            {hasDescription ? (
              <div className="a2r-hf wide" data-testid="agent-v2-task-f-desc">
                <div className="a2r-fl micro">
                  {t('agentConsole.v2.tsk02.fDesc')}{' '}
                  <span className="a2t-hdn">{t('agentConsole.v2.tsk02.descFold')}</span>
                </div>
                <details className="a2t-fold">
                  <summary>
                    <span className="a2t-foldtx">{task.description}</span>
                    <span className="a2t-more a2t-more-open">
                      {t('agentConsole.v2.tsk02.expand')}
                    </span>
                    <span className="a2t-more a2t-more-close">
                      {t('agentConsole.v2.tsk02.collapse')}
                    </span>
                  </summary>
                </details>
              </div>
            ) : null}
          </div>
        </div>

        <div className="a2r-split">
          <div className="a2r-stack">
            {/* blocked/cancelled reason is its own card, not a status note */}
            {task.statusReason &&
            (status === 'blocked' || status === 'cancelled') ? (
              <Panel
                title={t(
                  status === 'blocked'
                    ? 'agentConsole.v2.tsk02.reasonBlockedTitle'
                    : 'agentConsole.v2.tsk02.reasonCancelledTitle',
                )}
                note={
                  <span title={t('agentConsole.v2.tsk02.reasonNoteTitle')}>
                    {t(
                      status === 'blocked'
                        ? 'agentConsole.v2.tsk02.reasonNote'
                        : 'agentConsole.v2.tsk02.reasonNoteCancelled',
                    )}
                  </span>
                }
                foot={t(
                  status === 'blocked'
                    ? 'agentConsole.v2.tsk02.reasonBlockedFoot'
                    : 'agentConsole.v2.tsk02.reasonCancelledFoot',
                )}
                testId="agent-v2-task-reason"
              >
                <div className="a2t-prog">
                  <div className="a2t-flag" data-testid="agent-v2-task-reason-text">
                    <LkIcon name="alert" size={13} />
                    {task.statusReason}
                  </div>
                  <div className="a2t-mt">
                    <LkIcon name="clock" size={13} />
                    {t('agentConsole.v2.tsk02.writtenAt')}{' '}
                    <span className="mono" title={fullIso(task.updatedAt)}>
                      {fmtMoment(task.updatedAt)}
                    </span>
                    <span className="faint" aria-hidden="true">
                      ·
                    </span>
                    {status === 'blocked'
                      ? t('agentConsole.v2.tsk02.blockedTtl', {
                          at: ttlMoment(task.updatedAt),
                        })
                      : t('agentConsole.v2.tsk02.cancelReasonHint')}
                  </div>
                </div>
              </Panel>
            ) : null}

            <Panel
              title={t('agentConsole.v2.tsk02.progressTitle')}
              note={t('agentConsole.v2.tsk02.progressNoteHead')}
              foot={t('agentConsole.v2.tsk02.progressFoot')}
              testId="agent-v2-task-progress"
            >
              <div
                className={`a2t-prog${task.progressNote ? '' : ' none'}`}
                data-testid="agent-v2-task-progress-body"
              >
                <div className="a2t-tx">
                  {task.progressNote
                    ? task.progressNote
                    : t('agentConsole.v2.tsk02.progressNone')}
                </div>
                <div className="a2t-mt">
                  <LkIcon name="clock" size={13} />
                  {t('agentConsole.v2.tsk02.lastStatusChange')}{' '}
                  <span className="mono" title={fullIso(task.updatedAt)}>
                    {fmtMoment(task.updatedAt)}
                  </span>
                  {task.progressNote ? null : (
                    <>
                      <span className="faint" aria-hidden="true">
                        ·
                      </span>
                      {t('agentConsole.v2.tsk02.progressNoneCaliber')}
                    </>
                  )}
                </div>
              </div>
            </Panel>

            <Panel
              title={t('agentConsole.v2.tsk02.sourceTitle')}
              note={t('agentConsole.v2.tsk02.sourceHeadNote')}
              foot={t('agentConsole.v2.tsk02.sourceFoot')}
              testId="agent-v2-task-source"
            >
              <div className="a2t-rows">
                <div className="a2t-row">
                  <span className="a2t-k">{t('agentConsole.v2.tsk02.channel')}</span>
                  <span
                    className="a2t-v"
                    title={`channel=${task.source?.channel ?? ''}`}
                    data-testid="agent-v2-task-channel"
                  >
                    <LkIcon name="msg" size={13} />
                    {channelLabel(t, task.source?.channel ?? '')}
                  </span>
                </div>
                {task.source?.messageId ? (
                  <div className="a2t-row">
                    <span className="a2t-k">{t('agentConsole.v2.tsk02.messageId')}</span>
                    <span className="a2t-v">
                      <CopyId
                        value={task.source.messageId}
                        display={shortTaskRef(task.source.messageId)}
                        ariaLabel={t('agentConsole.v2.tsk02.copyMessageId')}
                        copiedLabel={t('agentConsole.v2.tsk.copied')}
                        testId="agent-v2-task-message-id"
                      />
                      <span className="a2t-hdn">{t('agentConsole.v2.tsk02.messageIdNote')}</span>
                    </span>
                  </div>
                ) : null}
                {task.source?.conversationRef ? (
                  <div className="a2t-row">
                    <span className="a2t-k">{t('agentConsole.v2.tsk02.conversationRef')}</span>
                    <span className="a2t-v">
                      <CopyId
                        value={task.source.conversationRef}
                        display={shortTaskRef(task.source.conversationRef)}
                        ariaLabel={t('agentConsole.v2.tsk02.copyConversationRef')}
                        copiedLabel={t('agentConsole.v2.tsk.copied')}
                        testId="agent-v2-task-conversation-ref"
                      />
                      <span className="a2t-hdn">
                        {t('agentConsole.v2.tsk02.conversationRefNote')}
                      </span>
                    </span>
                  </div>
                ) : null}
                {task.employeeVersionRef ? (
                  <div className="a2t-row">
                    <span className="a2t-k">{t('agentConsole.v2.tsk02.versionRef')}</span>
                    <span className="a2t-v">
                      <CopyId
                        value={task.employeeVersionRef}
                        display={shortTaskRef(task.employeeVersionRef)}
                        ariaLabel={t('agentConsole.v2.tsk02.copyVersionRef')}
                        copiedLabel={t('agentConsole.v2.tsk.copied')}
                        testId="agent-v2-task-version-ref"
                      />
                      <span className="a2t-hdn">{t('agentConsole.v2.tsk02.versionRefNote')}</span>
                      <HelpTip term="taskVersionRef" testId="agent-v2-task-help-version" />
                    </span>
                  </div>
                ) : null}
              </div>
            </Panel>

            <Panel
              title={t('agentConsole.v2.tsk02.runTitle')}
              note={t('agentConsole.v2.tsk02.runHeadNote')}
              foot={hasRun ? t('agentConsole.v2.tsk02.runFoot') : undefined}
              testId="agent-v2-task-run"
            >
              {hasRun ? (
                <div className="a2t-rows">
                  <div className="a2t-row">
                    <span className="a2t-k">{t('agentConsole.v2.tsk02.runId')}</span>
                    <span className="a2t-v">
                      <CopyId
                        value={task.source.runId as string}
                        display={shortTaskRef(task.source.runId)}
                        ariaLabel={t('agentConsole.v2.tsk02.copyRunId')}
                        copiedLabel={t('agentConsole.v2.tsk.copied')}
                        testId="agent-v2-task-run-id"
                      />
                      <Link
                        className="lnk acc"
                        to={`/agent/runs/${encodeURIComponent(task.source.runId as string)}`}
                        title={t('agentConsole.v2.tsk02.runLinkTitle')}
                        data-testid="agent-v2-task-run-link"
                      >
                        {t('agentConsole.v2.tsk02.runLink')}
                        <LkIcon name="chevR" size={13} />
                      </Link>
                    </span>
                  </div>
                  {runStatus ? (
                    <div className="a2t-row">
                      <span className="a2t-k">{t('agentConsole.v2.tsk02.runStatus')}</span>
                      <span className="a2t-v">
                        <span
                          className={`pill xs${statusTone(runStatus) ? ` ${statusTone(runStatus)}` : ''}`}
                          data-testid="agent-v2-task-run-status"
                        >
                          <span className="dot" aria-hidden="true" />
                          {t(RUN_STATUS_KEYS[runStatus])}
                        </span>
                        <span className="a2t-hdn">{t('agentConsole.v2.tsk02.runStatusNote')}</span>
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="a2t-empty" data-testid="agent-v2-task-run-empty">
                  <span className="a2t-eic" aria-hidden="true">
                    <LkIcon name="inbox" size={20} />
                  </span>
                  <div className="a2t-et">{t('agentConsole.v2.tsk02.runEmptyTitle')}</div>
                  <div className="a2t-es">{t('agentConsole.v2.tsk02.runEmptyDesc')}</div>
                  <Link className="b out" to="/agent/tasks">
                    {t('agentConsole.v2.tsk02.runEmptyAction')}
                  </Link>
                </div>
              )}
            </Panel>

            {related.length > 0 ? (
              <Panel
                title={t('agentConsole.v2.tsk02.relatedTitle')}
                count={t('agentConsole.v2.tsk02.relatedCount', { n: related.length })}
                note={t('agentConsole.v2.tsk02.relatedHeadNote')}
                foot={t('agentConsole.v2.tsk02.relatedFoot')}
                testId="agent-v2-task-related"
              >
                <div className="a2t-rows">
                  {related.map((id, i) => (
                    <div className="a2t-row" key={id}>
                      <span className="a2t-k">
                        {t('agentConsole.v2.tsk02.relatedItem', { n: i + 1 })}
                      </span>
                      <span className="a2t-v">
                        <CopyId
                          value={id}
                          display={shortTaskRef(id)}
                          ariaLabel={t('agentConsole.v2.tsk02.copyRelated', { n: i + 1 })}
                          copiedLabel={t('agentConsole.v2.tsk.copied')}
                          testId={`agent-v2-task-related-id-${i}`}
                        />
                        <Link
                          className="lnk"
                          to={`/agent/tasks/${encodeURIComponent(id)}`}
                          data-testid={`agent-v2-task-related-link-${i}`}
                        >
                          {t('agentConsole.v2.tsk02.view')}
                          <LkIcon name="chevR" size={13} />
                        </Link>
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>
            ) : null}
          </div>

          <div className="a2r-stack">
            {/* red line: this card must contain zero interactive elements */}
            <Panel
              title={t('agentConsole.v2.tsk02.smTitle')}
              note={t('agentConsole.v2.tsk02.smHeadNote', {
                status: t(`agentConsole.v2.tsk.statusLabel.${status}`),
              })}
              foot={smFoot(status, t)}
              testId="agent-v2-task-sm"
            >
              <div data-testid="agent-v2-task-sm-card">
                {status === 'open' || status === 'in_progress' ? (
                  <StateGraph
                    status={status}
                    t={t}
                    label={t('agentConsole.v2.tsk02.smGraphAria', {
                      status: t(`agentConsole.v2.tsk.statusLabel.${status}`),
                    })}
                  />
                ) : null}
                <div className="a2t-edges">
                  {smEdges(status, t).map((e, i) => (
                    <div
                      className={`a2t-edge${e.byp ? ' byp' : ''}${e.off ? ' off' : ''}`}
                      key={`${e.n}-${i}`}
                    >
                      <span className="a2t-n">{e.n}</span>
                      <span className="a2t-f">{e.label}</span>
                      <span className="a2t-g">{e.guard}</span>
                    </div>
                  ))}
                </div>
                <div className="a2t-smnote">{t('agentConsole.v2.tsk02.smNote')}</div>
                <div className="a2t-smterms">
                  {smTerms(status, t).map((term, i) => (
                    <div className={`a2t-smterm${i === 0 ? ' on' : ''}`} key={term}>
                      <span className="a2t-c2" aria-hidden="true">
                        {i === 0 ? <LkIcon name="check" size={13} /> : null}
                      </span>
                      {term}
                    </div>
                  ))}
                </div>
              </div>
            </Panel>

            <Panel
              title={t('agentConsole.v2.tsk02.auditTitle')}
              note={t('agentConsole.v2.tsk02.auditHeadNote')}
              foot={t('agentConsole.v2.tsk02.auditFoot')}
              testId="agent-v2-task-audit"
            >
              <div className="a2t-rows">
                <div className="a2t-row">
                  <span className="a2t-k">{t('agentConsole.v2.tsk02.auditEvents')}</span>
                  <span className="a2t-v">
                    <Link
                      className="lnk acc"
                      to={`/agent/audit?taskId=${encodeURIComponent(task.taskId)}`}
                      title={t('agentConsole.v2.tsk02.auditLinkTitle')}
                      data-testid="agent-v2-task-audit-link"
                    >
                      {t('agentConsole.v2.tsk02.auditLink')}
                      <LkIcon name="chevR" size={13} />
                    </Link>
                    <HelpTip term="taskAuditFilter" testId="agent-v2-task-help-audit" />
                  </span>
                </div>
                <div className="a2t-row">
                  <span className="a2t-k">{t('agentConsole.v2.tsk02.auditFilter')}</span>
                  <span
                    className="a2t-v mono a2t-filter"
                    title={task.taskId}
                    data-testid="agent-v2-task-audit-filter"
                  >
                    taskId={shortTaskRef(task.taskId)}
                  </span>
                </div>
              </div>
            </Panel>

            <Panel
              title={t('agentConsole.v2.tsk02.calTitle')}
              foot={
                <>
                  {t('agentConsole.v2.tsk02.calFootPrefix')}{' '}
                  <span className="mono">GET /api/task-detail?id=</span>
                  {t('agentConsole.v2.tsk02.calFootSuffix')}
                </>
              }
              testId="agent-v2-task-caliber"
            >
              <div className="a2t-rows">
                {(
                  [
                    'calStatus',
                    'calProgress',
                    'calAbsent',
                    'calTime',
                    'calIds',
                  ] as const
                ).map((k) => (
                  <div className="a2t-row" key={k}>
                    <span className="a2t-k">{t(`agentConsole.v2.tsk02.${k}K`)}</span>
                    <span className="a2t-v a2t-wrap">{t(`agentConsole.v2.tsk02.${k}`)}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>

        <div className="pfoot">
          <span>{t('agentConsole.v2.tsk02.footSource')}</span>
          <span className="sp" aria-hidden="true" />
          <span>{t('agentConsole.v2.tsk02.footCaliber')}</span>
          <span className="sp" aria-hidden="true" />
          <span>{t('agentConsole.v2.tsk02.footReadonly')}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */

function ttlMoment(updatedAt: string): string {
  const ms = Date.parse(updatedAt);
  if (!Number.isFinite(ms)) return '—';
  return fmtMoment(new Date(ms + 72 * 3_600_000).toISOString());
}

/**
 * One actor field (S2: readable identities only). `employee` → 20px avatar +
 * E11 name (fallback 「员工 · 短码」) + EMP-03 link; `human` → 「用户 #<uid>」
 * with the full raw ref kept in the copy/title — the `human:` prefix never
 * prints inline. A human name is still never stitched from fragments: there
 * is no name-resolution endpoint, so the readable fallback form is the floor.
 */
function actorView(
  ref: TaskActorRef | undefined,
  names: Map<string, string>,
  t: TFunction,
  kind: 'assignee' | 'creator',
): { node: ReactNode; note?: ReactNode } {
  const id = typeof ref?.id === 'string' ? ref.id : '';
  const type = ref?.type ?? '';
  if (!id) {
    return { node: <span className="faint">—</span> };
  }
  const bare = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
  if (type === 'employee' || id.startsWith('employee:')) {
    const name = names.get(bare);
    const ava = avatarChar(name);
    return {
      node: (
        <>
          <span className="who" title={id}>
            <span className="ava" aria-hidden="true">
              {ava ?? <LkIcon name="users" size={12} />}
            </span>
            <span className="nm">{name ?? employeeLabelById(bare, names, t)}</span>
          </span>
          <span className="pill nt xs">{t('agentConsole.v2.tsk02.actorEmployee')}</span>
        </>
      ),
      note: (
        <Link
          className="lnk"
          to={`/agent/employees/${encodeURIComponent(bare)}`}
          title={id}
          data-testid={`agent-v2-task-${kind}-link`}
        >
          {t('agentConsole.v2.tsk02.viewEmployee')}
          <LkIcon name="chevR" size={13} />
        </Link>
      ),
    };
  }
  const raw = id.startsWith('human:') ? id : `human:${id}`;
  return {
    node: (
      <>
        <CopyId
          value={raw}
          display={humanLabel(bare, t)}
          ariaLabel={t('agentConsole.v2.tsk02.copyActor')}
          copiedLabel={t('agentConsole.v2.tsk.copied')}
          testId={`agent-v2-task-${kind}-raw`}
        />
        <span className="pill nt xs">{t('agentConsole.v2.tsk02.actorHuman')}</span>
      </>
    ),
    note: t('agentConsole.v2.tsk02.actorHumanNote'),
  };
}

/** Skeleton: bars only — no pill, id or timestamp that could be read as data. */
function TaskSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="a2s-page">
      <div className="lk a2r a2t" data-testid="agent-v2-task-detail">
        <div
          className="a2t-skel"
          role="status"
          aria-label={t('agentConsole.v2.tsk02.loadingAria')}
          data-testid="agent-v2-task-loading"
        >
          <div className="a2r-backrow">
            <span className="a2r-sk" style={{ width: 120, height: 12 }} />
          </div>
          <div className="phead">
            <div className="a2t-skhead">
              <span className="a2r-sk" style={{ width: 'min(420px, 100%)', height: 26 }} />
              <span className="a2r-sk" style={{ width: 180, height: 12 }} />
            </div>
            <span className="a2r-sk" style={{ width: 190, height: 32 }} />
          </div>
          <div className="card a2r-panel">
            <div className="a2r-ch">
              <span className="a2r-sk" style={{ width: 96, height: 14 }} />
              <span className="a2r-sp" />
              <span className="a2r-sk" style={{ width: 200, height: 12 }} />
            </div>
            <div className="a2r-hfs">
              {[56, 56, 56, 56, 56, 56, 56].map((w, i) => (
                <div className="a2r-hf" key={i}>
                  <span className="a2r-sk" style={{ width: w, marginBottom: 10 }} />
                  <span className="a2r-sk" style={{ width: 88, height: 16 }} />
                </div>
              ))}
            </div>
          </div>
          <div className="a2r-split">
            <div className="a2r-stack">
              {[0, 1].map((i) => (
                <div className="card a2r-panel" key={i}>
                  <div className="a2r-ch">
                    <span className="a2r-sk" style={{ width: 64, height: 14 }} />
                    <span className="a2r-sp" />
                    <span className="a2r-sk" style={{ width: 140, height: 12 }} />
                  </div>
                  <div className="a2t-skelrow">
                    <span className="a2r-sk" style={{ width: '70%' }} />
                  </div>
                  <div className="a2t-skelrow">
                    <span className="a2r-sk" style={{ width: '52%' }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="card a2r-panel">
              <div className="a2t-skelrow">
                <span className="a2r-sk" style={{ width: 96, height: 14 }} />
              </div>
              <div className="a2t-skelrow">
                <span className="a2r-sk" style={{ width: '100%' }} />
              </div>
              <div className="a2t-skelrow">
                <span className="a2r-sk" style={{ width: '88%' }} />
              </div>
              <div className="a2t-skelrow">
                <span className="a2r-sk" style={{ width: '94%' }} />
              </div>
            </div>
          </div>
          <div className="a2t-hdn a2t-sknote">{t('agentConsole.v2.tsk02.loadingNote')}</div>
        </div>
      </div>
    </div>
  );
}