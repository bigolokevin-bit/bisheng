/**
 * OV-01 additions (PRD v0.3 §5.1): the three elements the first pass did not
 * render — OV-LIST-01 最近运行 / OV-CARD-01 员工矩阵入口 / OV-CARD-02 协作入口.
 *
 * Same contract as the rest of the page: no writes, every row opens a real
 * route, empty states name the next step, errors stay human and carry the
 * gateway request id, and a 404 on either entry card hides the card instead
 * of showing a broken box (upstream may not deploy those modules yet).
 */
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import type { Run } from '@/controllers/API/agentConsoleRuns';
import { BlockError, Icon, displayActor, type BlockState } from './OverviewBlocks';
import type { DelegationListShape } from './collab';
import type { MatrixListBody } from './matrix';
import { fmtId, fmtTime } from './v2Data';

export interface RecentRunsBody {
  items?: Run[] | null;
}

const RUN_STATUS_KEY: Record<string, string> = {
  pending: 'agentConsole.runs.status.pending',
  running: 'agentConsole.runs.status.running',
  completed: 'agentConsole.runs.status.completed',
  failed: 'agentConsole.runs.status.failed',
  cancelled: 'agentConsole.runs.status.cancelled',
  interrupted: 'agentConsole.runs.status.interrupted',
};

function runTone(status: string): string {
  if (status === 'completed') return 'ok';
  if (status === 'failed' || status === 'cancelled' || status === 'interrupted') return 'dg';
  return 'wr';
}

function sortRecent(runs: Run[]): Run[] {
  return [...runs]
    .sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')))
    .slice(0, 5);
}

/* OV-LIST-01 — 最近运行 5 行, each row opens /agent/runs/:id. */
export function RecentRunsBlock({
  state,
  onRetry,
}: {
  state: BlockState<RecentRunsBody>;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const raw = state.data?.items;
  const malformed = state.ok && !Array.isArray(raw);
  const runs = sortRecent(Array.isArray(raw) ? raw : []);
  return (
    <section className="ov-card" data-testid="agent-v2-ov-recent-runs">
      <div className="ov-card-hd">
        <span className="t">{t('agentConsole.v2.emp.colLastRun')}</span>
        <span className="sp" />
        <NavLink className="ov-lnk" to="/agent/runs" data-testid="agent-v2-ov-recent-runs-all">
          {t('agentConsole.v2.ov.viewAll')}
          <Icon name="arrow" size={13} />
        </NavLink>
      </div>
      {state.loading ? (
        <div className="ov-scan" data-testid="agent-v2-ov-recent-runs-loading">
          …
        </div>
      ) : !state.ok || malformed ? (
        <div className="ov-buds">
          <BlockError
            message={t('agentConsole.v2.runsError')}
            state={malformed ? { ...state, ok: false } : state}
            onRetry={onRetry}
            testId="agent-v2-ov-recent-runs-error"
            retryTestId="agent-v2-ov-retry-recent-runs"
          />
        </div>
      ) : runs.length === 0 ? (
        <div className="ov-buds">
          <p className="ov-empty-line" data-testid="agent-v2-ov-recent-runs-empty">
            {t('agentConsole.v2.runsEmpty')}
          </p>
          <NavLink className="ov-lnk" to="/agent/runs">
            {t('agentConsole.v2.ov.queueGoRuns')}
            <Icon name="arrow" size={13} />
          </NavLink>
        </div>
      ) : (
        <div className="ov-tblwrap">
          <table className="ov-tbl ov-rtbl" aria-label={t('agentConsole.v2.emp.colLastRun')}>
            <thead>
              <tr>
                <th>{t('agentConsole.v2.runs01.colStatus')}</th>
                <th>{t('agentConsole.v2.runs01.colRun')}</th>
                <th>{t('agentConsole.v2.runs01.colEmployee')}</th>
                <th>{t('agentConsole.v2.ov.colTime')}</th>
                <th>{t('agentConsole.v2.runs01.colAction')}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const to = `/agent/runs/${encodeURIComponent(run.runId)}`;
                return (
                  <tr key={run.runId} data-testid="agent-v2-ov-recent-run-row">
                    <td>
                      <span className={`ov-pill ${runTone(run.status)} xs`}>
                        <span className="dot" />
                        {RUN_STATUS_KEY[run.status]
                          ? t(RUN_STATUS_KEY[run.status])
                          : t('agentConsole.v2.id.unknown')}
                      </span>
                    </td>
                    <td>
                      <NavLink className="ov-lnk a2-mono" to={to} title={run.runId}>
                        {fmtId(run.runId)}
                      </NavLink>
                    </td>
                    <td className="ov-clip" title={run.employeeId ?? undefined}>
                      {run.employeeId ? displayActor(run.employeeId, t) ?? '—' : '—'}
                    </td>
                    <td className="ov-nowrap">{fmtTime(run.startedAt)}</td>
                    <td>
                      <NavLink className="ov-lnk" to={to}>
                        {t('agentConsole.v2.collab.list.view')}
                        <Icon name="arrow" size={13} />
                      </NavLink>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* OV-CARD-01 — 员工矩阵入口; 404 hides it entirely. */
export function MatrixEntryCard({
  state,
  onRetry,
}: {
  state: BlockState<MatrixListBody>;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (!state.ok && state.status === 404) return null;
  const raw = state.data?.items;
  const malformed = state.ok && !Array.isArray(raw);
  const items = Array.isArray(raw) ? raw : [];
  const riskKnown = items.every((row) => row.risk != null);
  const risky = riskKnown
    ? items.filter(
        (row) =>
          (row.risk?.failedRuns ?? 0) > 0 ||
          (row.risk?.blockedApprovals ?? 0) > 0 ||
          row.risk?.budgetOver === true
      ).length
    : 0;
  return (
    <section className="ov-card ov-entry" data-testid="agent-v2-ov-matrix-card">
      <div className="ov-card-hd">
        <span className="t">{t('agentConsole.v2.mtx.title')}</span>
        <span className="sp" />
        <NavLink className="ov-lnk" to="/agent/matrix" data-testid="agent-v2-ov-matrix-open">
          {t('agentConsole.v2.ov.viewAll')}
          <Icon name="arrow" size={13} />
        </NavLink>
      </div>
      <div className="ov-entry-bd">
        {state.loading ? (
          <p className="a2-meta">{t('agentConsole.v2.mtx.loading')}</p>
        ) : !state.ok || malformed ? (
          <BlockError
            message={t('agentConsole.v2.errorQuery')}
            state={malformed ? { ...state, ok: false } : state}
            onRetry={onRetry}
            testId="agent-v2-ov-matrix-error"
            retryTestId="agent-v2-ov-retry-matrix"
          />
        ) : items.length === 0 ? (
          <div className="ov-empty-cta" data-testid="agent-v2-ov-matrix-empty">
            <p className="a2-meta">{t('agentConsole.v2.emp.emptyEmployees')}</p>
            <NavLink className="ov-lnk" to="/agent/employees/new">
              {t('agentConsole.v2.emp.createEntry')}
              <Icon name="arrow" size={13} />
            </NavLink>
          </div>
        ) : (
          <div className="ov-entry-meta" data-testid="agent-v2-ov-matrix-count">
            <span className="a2-meta">{t('agentConsole.v2.mtx.loaded', { count: items.length })}</span>
            {risky > 0 ? (
              <span className="ov-pill wr xs">
                <span className="dot" />
                {t('agentConsole.v2.colRisk')} {risky}
              </span>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

/* OV-CARD-02 — 协作入口; 404 hides it entirely. */
export function CollabEntryCard({
  state,
  onRetry,
}: {
  state: BlockState<DelegationListShape>;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (!state.ok && state.status === 404) return null;
  const raw = state.data?.items;
  const malformed = state.ok && !Array.isArray(raw);
  const items = Array.isArray(raw) ? raw : [];
  return (
    <section className="ov-card ov-entry" data-testid="agent-v2-ov-collab-card">
      <div className="ov-card-hd">
        <span className="t">{t('agentConsole.v2.collab.title')}</span>
        <span className="sp" />
        <NavLink className="ov-lnk" to="/agent/collab" data-testid="agent-v2-ov-collab-open">
          {t('agentConsole.v2.ov.viewAll')}
          <Icon name="arrow" size={13} />
        </NavLink>
      </div>
      <div className="ov-entry-bd">
        {state.loading ? (
          <p className="a2-meta">{t('agentConsole.v2.collab.state.loading.title')}</p>
        ) : !state.ok || malformed ? (
          <BlockError
            message={t('agentConsole.v2.errorQuery')}
            state={malformed ? { ...state, ok: false } : state}
            onRetry={onRetry}
            testId="agent-v2-ov-collab-error"
            retryTestId="agent-v2-ov-retry-collab"
          />
        ) : items.length === 0 ? (
          <div className="ov-empty-cta" data-testid="agent-v2-ov-collab-empty">
            <p className="a2-meta">{t('agentConsole.v2.collab.state.empty.title')}</p>
            <NavLink className="ov-lnk" to="/agent/collab">
              {t('agentConsole.v2.ov.viewAll')}
              <Icon name="arrow" size={13} />
            </NavLink>
          </div>
        ) : (
          <div className="ov-entry-meta">
            <span className="a2-meta">{t('agentConsole.v2.skills.loaded', { count: items.length })}</span>
            <span className="a2-meta">{t('agentConsole.v2.collab.list.title')}</span>
          </div>
        )}
      </div>
    </section>
  );
}