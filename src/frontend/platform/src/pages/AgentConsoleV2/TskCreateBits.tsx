/**
 * TSK-03 `/agent/tasks/new` — the parts of the screen that are not the write
 * form and not the result card: the page-level lines, the loading skeleton, the
 * whole-page stage screens (load error / session / forbidden), the read-only
 * side column and the collapsed technical fold.
 *
 * Extracted from `TaskCreatePage.tsx` so every file stays under the repo's
 * 600-line rule, following the `EmpCreateBits.tsx` split. Pure move: no markup,
 * test id, class name or wording changed.
 */
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { HelpTip } from './HelpTip';
import { avatarChar } from './identity';
import { LkIcon } from './listkit';

export const PRISTINE = { title: '', assigneeId: '', priority: 'normal', note: '' };

export type TaskCreateValues = typeof PRISTINE;

export type SetField = <K extends keyof TaskCreateValues>(
  key: K,
  next: TaskCreateValues[K]
) => void;

/* Presentation order only: 1 = 低, 2 = 普通, 3 = 高. The DOM never carries the
 * wire enum (SPEC §8 E04); the submit body still sends low/normal/high (§5). */
export const PRIORITIES = ['low', 'normal', 'high'] as const;
/* draft is here because the domain refuses it (task.assignee_invalid): a
 * candidate that can only ever fail must not be offered as a choice. */
export const EXCLUDED_LIFECYCLE = new Set(['offboarding', 'archived', 'draft']);

/* Bounded candidate walk: enough for a pilot tenant, never an unbounded page
 * chain that could keep the form loading forever. */
export const CANDIDATE_PAGE = 100;
export const CANDIDATE_MAX_PAGES = 3;

export interface FieldErrors {
  title?: string;
  assignee?: string;
}

export interface Candidate {
  id: string;
  name: string;
  title: string;
  lifecycleState: string;
}

/** A write attempt the service refused: content (400) or service (5xx/0). */
export type SaveFailure = { kind: 'invalid' | 'unavailable'; requestId?: string };

export interface DeepLink {
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
export function parseDeepLink(search: string): DeepLink {
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

export function candidateLabel(c: Candidate, t: TFunction): string {
  const state = t(`agentConsole.lifecycle.${c.lifecycleState}`, c.lifecycleState);
  return [c.name || t('agentConsole.v2.id.unnamed'), c.title].filter(Boolean).join(' · ') + `（${state}）`;
}

export function TechInfo({ rows, center }: { rows: string[]; center?: boolean }) {
  const { t } = useTranslation();
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

export function FormSkeleton() {
  const { t } = useTranslation();
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

function CreateFoot() {
  const { t } = useTranslation();
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

function CreateFreshLine() {
  const { t } = useTranslation();
  return (
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
}

function CreateHead() {
  const { t } = useTranslation();
  return (
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
}

/** The page frame every stage shares: the honest line, the head, the Esc band. */
export function PageShell({ escWarn, children }: { escWarn: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="a2s-page">
      <div className="lk tsk03" data-testid="agent-v2-task-create">
        <CreateFreshLine />
        <CreateHead />
        {escWarn ? (
          <div className="roband" role="status" data-testid="agent-v2-tsk-c-esc-warn">
            <LkIcon name="info" size={14} />
            <span>{t('agentConsole.v2.tsk03.escWarn')}</span>
          </div>
        ) : null}
        {children}
        <CreateFoot />
      </div>
    </div>
  );
}

export function LoadErrorScreen({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
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
            onClick={onRetry}
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

export function AuthScreen() {
  const { t } = useTranslation();
  return (
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

/* What this screen says: one plain explanation and two real exits (返回
   任务列表 / 重新读取 — the retry re-runs this very read, and if it comes
   back forbidden again, that is the honest answer). Everything about how
   the screen is built is gone: no 「逐字相同，只有码不同」, no 「不会先渲染
   骨架」, no 「不会泄露谁有权限」. Those are construction notes for the
   reviewer, not words for the person standing here (R2 fix order D2 /
   SPEC §6). 码值 and 请求编号 live only in the collapsed fold, so 403 and
   404 keep one body and differ only under the fold (E13). */
export function ForbiddenScreen({
  onRetry,
  readRequestId,
  readStatus,
}: {
  onRetry: () => void;
  readRequestId?: string;
  readStatus?: number;
}) {
  const { t } = useTranslation();
  return (
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
            onClick={onRetry}
          >
            <LkIcon name="refresh" size={16} />
            {t('agentConsole.v2.tsk03.forbiddenRetry')}
          </button>
        </div>
        <TechInfo
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

/** Read-only side column: live preview, the three things that happen next, and
 *  why the source is fixed. */
export function TskCreateSide({
  priority,
  previewTitle,
  selected,
}: {
  priority: string;
  previewTitle: string;
  selected: Candidate | null;
}) {
  const { t } = useTranslation();
  return (
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
                {t(`agentConsole.v2.tsk03.priority.${priority}`)}
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
  );
}