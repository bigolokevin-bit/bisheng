/**
 * SKILL-01 — read-only skill governance (/agent/skills).
 *
 * One screen for the tenant skill ledger: name, version, content fingerprint,
 * owner, visibility (shared with N employees / exclusive to one / unused) and
 * the referencing employees (first three + 「另有 N 位」). Every row expands
 * inline — no new route — into the full ledger key, full fingerprint, version,
 * owner and the complete reference list.
 *
 * Data source: BFF GET /agent-api/api/skills (read-only proxy of GET /v1/skills,
 * BFF c3b64b7 → domain list_skills). The body is { items, asOf, nextCursor? };
 * sharedWith carries employee ids. The page renders loading / empty / error /
 * forbidden (403 and 404 share one body) and never fabricates rows. A read
 * keeps its 10s cap inside makeFetcher: a hung request flips to the honest
 * 「本次未能读取」 screen with retry.
 *
 * Zero write entry: create / edit / delete / upload are deliberately absent.
 * The LinSight SkillManagement structure was read for reference only; its
 * components ship write surfaces (form drawer, upload dialog, delete/edit in
 * the detail sheet) and are NOT imported (lane contract §2). The table is
 * drawn from our a2-* design language.
 *
 * Zero engineering language: the raw scope enum, field names, error codes and
 * UTC stamps never reach the DOM. Only a failed screen may carry one status
 * number inside a human sentence; time is Asia/Shanghai via fmtTime.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Icon } from './OverviewBlocks';
import { ReqId } from './listkit/ReqId';
import { fmtId, fmtTime, makeFetcher, type ApiRes, type Fetcher } from './v2Data';
import {
  deriveStats,
  firstRefs,
  isEmployeeRef,
  readRefs,
  readText,
  shortHash,
  skillKey,
  skillRows,
  visibilityOf,
  type SkillListBody,
  type SkillRow,
} from './skills';
import './skills.css';

const DASH = '—';

function CopyButton({
  value,
  label,
  copiedLabel,
  ariaLabel,
  testId,
}: {
  value: string;
  label: string;
  copiedLabel: string;
  ariaLabel: string;
  testId: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = () => {
    try {
      void navigator.clipboard?.writeText(value);
    } catch {
      /* clipboard unavailable: the full value stays visible in title */
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      className="a2-btn skl-copy"
      data-testid={testId}
      aria-label={ariaLabel}
      onClick={copy}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}

function PageHead({ asOf }: { asOf: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="a2-card-head skl-head">
      <div className="skl-head-main">
        <h1 className="a2-h1">{t('agentConsole.v2.skills.title')}</h1>
        <p className="a2-meta">{t('agentConsole.v2.skills.desc')}</p>
      </div>
      <div className="skl-asof">
        <span className="a2-micro">{t('agentConsole.v2.skills.asOf')}</span>
        <span className="a2-mono" data-testid="agent-v2-skills-asof">
          {asOf ? fmtTime(asOf) : DASH}
        </span>
      </div>
    </div>
  );
}

function ScopePill({ row }: { row: SkillRow }) {
  const { t } = useTranslation();
  const v = visibilityOf(row);
  if (v.kind === 'shared') {
    return (
      <span className="a2-pill is-accent">
        {t('agentConsole.v2.skills.scopeShared', { count: v.count })}
      </span>
    );
  }
  if (v.kind === 'exclusive') {
    return <span className="a2-pill">{t('agentConsole.v2.skills.scopeExclusive')}</span>;
  }
  if (v.kind === 'unused') {
    return <span className="a2-pill is-warn">{t('agentConsole.v2.skills.scopeUnused')}</span>;
  }
  return <span className="a2-pill">{DASH}</span>;
}

function RefLink({ id, className = 'skl-ref' }: { id: string; className?: string }) {
  if (isEmployeeRef(id)) {
    return (
      <Link
        className={`a2-mono ${className}`}
        to={`/agent/employees/${encodeURIComponent(id)}`}
        title={id}
      >
        {fmtId(id)}
      </Link>
    );
  }
  return (
    <span className={`a2-mono ${className}`} title={id}>
      {fmtId(id)}
    </span>
  );
}

function SkillRowView({ row, index }: { row: SkillRow; index: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const id = readText(row.skillId) ?? readText(row.id);
  const name = readText(row.name);
  const version = readText(row.version);
  const owner = readText(row.ownerUserId) ?? readText(row.owner);
  const fullHash = readText(row.contentHash);
  const hash = shortHash(row.contentHash);
  const refs = readRefs(row.sharedWith);
  const refsProvided = Array.isArray(row.sharedWith);
  const { shown, rest } = firstRefs(refs);
  const key = skillKey(row, index);

  return (
    <>
      <tr data-testid="agent-v2-skills-row" data-skill={key}>
        <td>
          <div className="skl-name">
            <span className="skl-name-main" data-testid="agent-v2-skills-name" title={id ?? undefined}>
              {name ?? t('agentConsole.v2.skills.unnamed')}
            </span>
            {id ? <span className="a2-micro a2-mono skl-id">{fmtId(id)}</span> : null}
          </div>
        </td>
        <td className="a2-cell-nowrap" data-testid="agent-v2-skills-version">
          {version ? <span className="a2-mono">{version}</span> : DASH}
        </td>
        <td data-testid="agent-v2-skills-hash">
          {hash && fullHash ? (
            <span className="skl-hash">
              <span className="a2-mono skl-hash-short" title={fullHash}>
                {hash}
              </span>
              <CopyButton
                value={fullHash}
                label={t('agentConsole.v2.skills.hashCopy')}
                copiedLabel={t('agentConsole.v2.skills.hashCopied')}
                ariaLabel={t('agentConsole.v2.skills.hashCopyAria', { name: name ?? key })}
                testId="agent-v2-skills-hash-copy"
              />
            </span>
          ) : (
            DASH
          )}
        </td>
        <td data-testid="agent-v2-skills-owner">
          {owner ? (
            <span className="a2-mono skl-owner" title={owner}>
              {fmtId(owner)}
            </span>
          ) : (
            DASH
          )}
        </td>
        <td data-testid="agent-v2-skills-scope">
          <ScopePill row={row} />
        </td>
        <td data-testid="agent-v2-skills-refs">
          {refs.length === 0 ? (
            refsProvided ? (
              <span className="a2-meta">{t('agentConsole.v2.skills.refsNone')}</span>
            ) : (
              DASH
            )
          ) : (
            <span className="skl-refs">
              {shown.map((ref) => (
                <RefLink key={ref} id={ref} />
              ))}
              {rest > 0 ? (
                <span className="a2-micro" data-testid="agent-v2-skills-refs-more">
                  {t('agentConsole.v2.skills.refsMore', { count: rest })}
                </span>
              ) : null}
            </span>
          )}
        </td>
        <td className="r">
          <button
            type="button"
            className="a2-btn skl-expand"
            aria-expanded={open}
            aria-label={t(
              open ? 'agentConsole.v2.skills.collapse' : 'agentConsole.v2.skills.expand',
            )}
            data-testid="agent-v2-skills-expand"
            onClick={() => setOpen((v) => !v)}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ transform: open ? 'rotate(180deg)' : undefined }}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </td>
      </tr>
      {open ? (
        <tr data-testid="agent-v2-skills-expanded" data-skill={key}>
          <td colSpan={7}>
            <div className="skl-exp">
              <div className="skl-exp-grid">
                <div className="skl-exp-item">
                  <span className="a2-micro">{t('agentConsole.v2.skills.detailId')}</span>
                  <span className="skl-exp-v">
                    <span className="a2-mono skl-break" data-testid="agent-v2-skills-detail-id">
                      {id ?? DASH}
                    </span>
                    {id ? (
                      <CopyButton
                        value={id}
                        label={t('agentConsole.v2.skills.hashCopy')}
                        copiedLabel={t('agentConsole.v2.skills.hashCopied')}
                        ariaLabel={t('agentConsole.v2.skills.idCopyAria')}
                        testId="agent-v2-skills-detail-id-copy"
                      />
                    ) : null}
                  </span>
                </div>
                <div className="skl-exp-item">
                  <span className="a2-micro">{t('agentConsole.v2.skills.detailHash')}</span>
                  <span className="skl-exp-v">
                    <span className="a2-mono skl-break" data-testid="agent-v2-skills-detail-hash">
                      {fullHash ?? DASH}
                    </span>
                    {fullHash ? (
                      <CopyButton
                        value={fullHash}
                        label={t('agentConsole.v2.skills.hashCopy')}
                        copiedLabel={t('agentConsole.v2.skills.hashCopied')}
                        ariaLabel={t('agentConsole.v2.skills.hashCopyAria', { name: name ?? key })}
                        testId="agent-v2-skills-detail-hash-copy"
                      />
                    ) : null}
                  </span>
                </div>
                <div className="skl-exp-item">
                  <span className="a2-micro">{t('agentConsole.v2.skills.colVersion')}</span>
                  <span className="skl-exp-v" data-testid="agent-v2-skills-detail-version">
                    {version ?? DASH}
                  </span>
                </div>
                <div className="skl-exp-item">
                  <span className="a2-micro">{t('agentConsole.v2.skills.colOwner')}</span>
                  <span className="skl-exp-v a2-mono" data-testid="agent-v2-skills-detail-owner">
                    {owner ?? DASH}
                  </span>
                </div>
                <div className="skl-exp-item skl-exp-wide">
                  <span className="a2-micro">{t('agentConsole.v2.skills.detailRefs')}</span>
                  <span className="skl-refs" data-testid="agent-v2-skills-detail-refs">
                    {refs.length > 0
                      ? refs.map((ref) => <RefLink key={ref} id={ref} />)
                      : refsProvided
                        ? t('agentConsole.v2.skills.detailRefsEmpty')
                        : DASH}
                  </span>
                </div>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export default function SkillsPage() {
  const { t } = useTranslation();
  const fetchApi: Fetcher = useMemo(() => makeFetcher(), []);
  const [res, setRes] = useState<ApiRes<SkillListBody | SkillRow[]> | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchApi<SkillListBody | SkillRow[]>('/api/skills').then((r) => {
      if (!alive) return;
      setRes(r);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [fetchApi, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  const body = res && res.ok ? res.data : null;
  const rows: SkillRow[] = res && res.ok ? skillRows(body) : [];
  const asOf = body && !Array.isArray(body) ? readText(body.asOf) : null;
  const hasMore = !!body && !Array.isArray(body) && !!readText(body.nextCursor);
  const stats = deriveStats(rows);

  const isTimeout = res != null && !res.ok && res.status === 0 && res.code === 'console.timeout';
  const isNetwork = res != null && !res.ok && res.status === 0 && !isTimeout;
  const isSessionExpired = res != null && !res.ok && res.status === 401;
  const isForbidden = res != null && !res.ok && (res.status === 403 || res.status === 404);

  /* ---- loading ---- */
  if (loading) {
    return (
      <div className="a2s-page" data-testid="agent-v2-skills-page">
        <PageHead asOf={null} />
        <div className="a2s-skeleton" data-testid="agent-v2-skills-loading" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <span className="a2s-sk-row" key={i} />
          ))}
        </div>
      </div>
    );
  }

  /* ---- 403 / 404: one body, whole page replaced, existence never leaked ---- */
  if (isForbidden) {
    return (
      <div className="a2s-page" data-testid="agent-v2-skills-page">
        <div className="a2-card" data-testid="agent-v2-skills-forbidden">
          <p className="a2-h2 skl-state-h">
            <Icon name="shield" size={16} />
            {t('agentConsole.v2.skills.forbiddenTitle')}
          </p>
          <p className="a2-card-sub">{t('agentConsole.v2.skills.forbiddenDesc')}</p>
          <span className="skl-block">
            <ReqId requestId={res?.requestId} testId="agent-v2-skills-forbidden-reqid" />
          </span>
          <Link className="a2-btn" to="/agent" data-testid="agent-v2-skills-back">
            {t('agentConsole.v2.skills.backHome')}
          </Link>
        </div>
      </div>
    );
  }

  /* ---- session expired ---- */
  if (isSessionExpired) {
    return (
      <div className="a2s-page" data-testid="agent-v2-skills-page">
        <div className="a2-card" data-testid="agent-v2-skills-error">
          <p className="a2-h2 skl-state-h">
            <Icon name="alert" size={16} />
            {t('agentConsole.auth.expired')}
          </p>
          <p className="a2-card-sub">{t('agentConsole.v2.skills.errKeep')}</p>
          <span className="skl-block">
            <ReqId requestId={res?.requestId} testId="agent-v2-skills-error-reqid" />
          </span>
          <button
            type="button"
            className="a2-btn"
            data-testid="agent-v2-skills-retry"
            onClick={retry}
          >
            {t('agentConsole.v2.skills.retry')}
          </button>
        </div>
      </div>
    );
  }

  /* ---- request failed (honest degrade) ---- */
  if (res != null && !res.ok) {
    const reason = isTimeout
      ? t('agentConsole.v2.skills.errTimeout')
      : isNetwork
        ? t('agentConsole.v2.skills.errNetwork')
        : t('agentConsole.v2.skills.errHttp', { code: res.status });
    return (
      <div className="a2s-page" data-testid="agent-v2-skills-page">
        <PageHead asOf={null} />
        <div className="a2-card" data-testid="agent-v2-skills-error">
          <p className="a2-h2 skl-state-h">
            <Icon name="alert" size={16} />
            {t('agentConsole.v2.skills.errTitle')}
          </p>
          <p className="a2-card-sub">{reason}</p>
          <p className="a2-card-sub">{t('agentConsole.v2.skills.errKeep')}</p>
          <span className="skl-block">
            <ReqId requestId={res.requestId} testId="agent-v2-skills-error-reqid" />
          </span>
          <button
            type="button"
            className="a2-btn"
            data-testid="agent-v2-skills-retry"
            onClick={retry}
          >
            {t('agentConsole.v2.skills.retry')}
          </button>
        </div>
      </div>
    );
  }

  /* ---- empty ---- */
  if (rows.length === 0) {
    return (
      <div className="a2s-page" data-testid="agent-v2-skills-page">
        <PageHead asOf={asOf} />
        <div className="a2-card" data-testid="agent-v2-skills-empty">
          <p className="a2-h2 skl-state-h">
            <Icon name="file" size={16} />
            {t('agentConsole.v2.skills.emptyTitle')}
          </p>
          <p className="a2-card-sub">{t('agentConsole.v2.skills.emptyHint')}</p>
        </div>
      </div>
    );
  }

  /* ---- normal ---- */
  return (
    <div className="a2s-page" data-testid="agent-v2-skills-page">
      <PageHead asOf={asOf} />

      <div className="a2-kpis" data-testid="agent-v2-skills-kpis">
        <div className="a2-kpi">
          <span className="a2-meta">{t('agentConsole.v2.skills.kpiTotal')}</span>
          <span className="a2-kpi-num" data-testid="agent-v2-skills-kpi-total">
            {stats.total}
            {hasMore ? '+' : ''}
          </span>
          <span className="a2-meta">{t('agentConsole.v2.skills.kpiTotalNote')}</span>
        </div>
        <div className="a2-kpi">
          <span className="a2-meta">{t('agentConsole.v2.skills.kpiShared')}</span>
          <span className="a2-kpi-num" data-testid="agent-v2-skills-kpi-shared">
            {stats.shared ?? DASH}
          </span>
          <span className="a2-meta">{t('agentConsole.v2.skills.kpiSharedNote')}</span>
        </div>
        <div className="a2-kpi">
          <span className="a2-meta">{t('agentConsole.v2.skills.kpiExclusive')}</span>
          <span className="a2-kpi-num" data-testid="agent-v2-skills-kpi-exclusive">
            {stats.exclusive ?? DASH}
          </span>
          <span className="a2-meta">{t('agentConsole.v2.skills.kpiExclusiveNote')}</span>
        </div>
      </div>

      <div className="a2-card" data-testid="agent-v2-skills-table-card">
        <div className="a2-card-head">
          <span className="a2-h2">{t('agentConsole.v2.skills.ledgerTitle')}</span>
          <span className="a2-pill">{t('agentConsole.v2.skills.readOnly')}</span>
          <span className="a2-sp" />
          <span className="a2-micro" data-testid="agent-v2-skills-loaded">
            {t('agentConsole.v2.skills.loaded', { count: rows.length })}
          </span>
        </div>

        <div className="a2-table-scroll" data-testid="agent-v2-skills-table-scroll">
          <table className="a2-table skl-table" aria-label={t('agentConsole.v2.skills.ariaTable')}>
            <colgroup>
              <col style={{ width: '23%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '5%' }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">{t('agentConsole.v2.skills.colName')}</th>
                <th scope="col">{t('agentConsole.v2.skills.colVersion')}</th>
                <th scope="col">{t('agentConsole.v2.skills.colHash')}</th>
                <th scope="col">{t('agentConsole.v2.skills.colOwner')}</th>
                <th scope="col">{t('agentConsole.v2.skills.colVisibility')}</th>
                <th scope="col">{t('agentConsole.v2.skills.colRefs')}</th>
                <th scope="col" className="r">
                  <span className="skl-sr">{t('agentConsole.v2.skills.colExpand')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <SkillRowView key={skillKey(row, i)} row={row} index={i} />
              ))}
            </tbody>
          </table>
        </div>

        <p className="a2-micro skl-scrollhint" data-testid="agent-v2-skills-scrollhint">
          <Icon name="arrow" size={12} />
          {t('agentConsole.v2.skills.scrollHint')}
        </p>

        {hasMore ? (
          <p className="a2-meta" data-testid="agent-v2-skills-more">
            {t('agentConsole.v2.skills.more', { count: rows.length })}
          </p>
        ) : null}
      </div>
    </div>
  );
}