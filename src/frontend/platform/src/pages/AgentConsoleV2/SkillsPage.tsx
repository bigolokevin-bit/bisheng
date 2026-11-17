/* eslint-disable no-restricted-syntax -- read-only skill governance page, no write entry points by design */
/**
 * SKILL-01 — read-only skill governance (/agent/skills).
 *
 * One screen for the skill ledger: who a skill is shared with (tenant-shared
 * vs employee-exclusive vs unused), its version, content fingerprint, owner and
 * who references it. Data source: BFF GET /agent-api/api/skills (read-only).
 * Probe 2026-11-17: the endpoint exists behind the identity gate (401 without
 * a cookie), the 200 row shape is unverified — the page renders loading /
 * empty / error / normal and never fabricates rows (L0 stance: 缺接口就四态).
 *
 * Zero engineering language on screen: HTTP status only ever appears as an
 * interpolation argument inside a human sentence (same G15 stance as MATRIX-01);
 * no field names, no raw error codes, no UTC stamps. No money fields exist here.
 *
 * Zero write entry: create/edit/delete/upload are deliberately absent. The
 * LinSight skill components were NOT reused — SkillManagement ships create/
 * delete actions, SkillFormDrawer and SkillUploadDialog are pure write surfaces,
 * and SkillDetailSheet is itself a drawer whose header carries edit/delete
 * buttons. None of them can be mounted read-only without dragging a write path
 * into this route, so the card below is hand-built from display-only pieces.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './OverviewBlocks';
import { ReqId } from './listkit/ReqId';
import { makeFetcher, type ApiRes, type Fetcher } from './v2Data';
import {
  readNames,
  readText,
  scopeBadge,
  scopeToneClass,
  shortHash,
  skillKey,
  skillRows,
  type SkillListBody,
  type SkillRow,
} from './skills';

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

  const rows: SkillRow[] = res && res.ok ? skillRows(res.data) : [];

  const isTimeout = res != null && !res.ok && res.status === 0 && res.code === 'console.timeout';
  const isSessionExpired = res != null && !res.ok && res.status === 401;

  /* ---- loading ---- */
  if (loading) {
    return (
      <div className="a2s-page" data-testid="agent-v2-sk-page">
        <h1 className="a2-h1">{t('agentConsole.v2.sk.title')}</h1>
        <p className="a2-meta">{t('agentConsole.v2.sk.desc')}</p>
        <div className="a2s-skeleton" data-testid="agent-v2-sk-loading" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <span className="a2s-sk-row" key={i} />
          ))}
        </div>
      </div>
    );
  }

  /* ---- session expired ---- */
  if (isSessionExpired) {
    return (
      <div className="a2s-page" data-testid="agent-v2-sk-page">
        <div className="a2-card" data-testid="agent-v2-sk-error">
          <p className="a2-h2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="alert" size={16} />
            {t('agentConsole.auth.expired')}
          </p>
          <p className="a2-card-sub">{t('agentConsole.v2.sk.errKeep')}</p>
          <span style={{ display: 'block' }}>
            <ReqId requestId={res?.requestId} testId="agent-v2-sk-error-reqid" />
          </span>
          <button type="button" className="a2-btn" data-testid="agent-v2-sk-retry" onClick={retry}>
            {t('agentConsole.v2.sk.retry')}
          </button>
        </div>
      </div>
    );
  }

  /* ---- request failed (degraded, honest) ---- */
  if (res != null && !res.ok) {
    const code = res.status ?? 0;
    return (
      <div className="a2s-page" data-testid="agent-v2-sk-page">
        <h1 className="a2-h1">{t('agentConsole.v2.sk.title')}</h1>
        <p className="a2-meta">{t('agentConsole.v2.sk.desc')}</p>
        <div className="a2-card" data-testid="agent-v2-sk-error">
          <p className="a2-h2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="alert" size={16} />
            {isTimeout
              ? t('agentConsole.v2.sk.errTimeout')
              : t('agentConsole.v2.sk.errHttp', { code })}
          </p>
          <p className="a2-card-sub">{t('agentConsole.v2.sk.errKeep')}</p>
          <span style={{ display: 'block' }}>
            <ReqId requestId={res.requestId} testId="agent-v2-sk-error-reqid" />
          </span>
          <button type="button" className="a2-btn" data-testid="agent-v2-sk-retry" onClick={retry}>
            {t('agentConsole.v2.sk.retry')}
          </button>
        </div>
      </div>
    );
  }

  /* ---- empty ---- */
  if (rows.length === 0) {
    return (
      <div className="a2s-page" data-testid="agent-v2-sk-page">
        <h1 className="a2-h1">{t('agentConsole.v2.sk.title')}</h1>
        <p className="a2-meta">{t('agentConsole.v2.sk.desc')}</p>
        <div className="a2-card" data-testid="agent-v2-sk-empty">
          <p className="a2-h2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="file" size={16} />
            {t('agentConsole.v2.sk.emptyTitle')}
          </p>
          <p className="a2-card-sub">{t('agentConsole.v2.sk.emptyHint')}</p>
        </div>
      </div>
    );
  }

  /* ---- normal ---- */
  return (
    <div className="a2s-page" data-testid="agent-v2-sk-page">
      <h1 className="a2-h1">{t('agentConsole.v2.sk.title')}</h1>
      <p className="a2-meta">{t('agentConsole.v2.sk.desc')}</p>
      <p className="a2-meta" data-testid="agent-v2-sk-count">
        {t('agentConsole.v2.sk.loaded', { count: rows.length })}
      </p>
      <p className="a2-meta a2-card-sub" data-testid="agent-v2-sk-legend">
        {t('agentConsole.v2.sk.legend')}
      </p>
      <div className="a2-grid2" data-testid="agent-v2-sk-rows">
        {rows.map((r, i) => (
          <SkillCard row={r} index={i} key={skillKey(r, i)} />
        ))}
      </div>
    </div>
  );
}

function SkillCard({ row, index }: { row: SkillRow; index: number }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const name = readText(row.name);
  const description = readText(row.description);
  const id = readText(row.skillId) ?? readText(row.id);
  const version = readText(row.version);
  const owner = readText(row.owner);
  const fullHash = readText(row.contentHash);
  const hash = shortHash(row.contentHash);
  const badge = scopeBadge(row.scope, row.sharedWith, row.sharedCount);
  const sharedNames = readNames(row.sharedWith);
  const refsProvided = row.referencedBy != null;
  const refs = readNames(row.referencedBy);
  const scopeLabel = badge.verbatim ?? (badge.key ? t(badge.key, { count: badge.count ?? '' }) : '—');
  const rowKey = `${skillKey(row, index)}`;

  const copyHash = () => {
    if (!fullHash) return;
    try {
      void navigator.clipboard?.writeText(fullHash);
    } catch {
      /* clipboard unavailable: the full value stays visible in the title */
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="a2-card" data-testid="agent-v2-sk-row" data-skill={rowKey}>
      <p className="a2-card-head" style={{ margin: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Icon name="file" size={16} />
          <span className="a2-h2" style={{ fontWeight: 600 }} title={id ?? undefined}>
            {name ?? t('agentConsole.v2.sk.unnamed')}
          </span>
        </span>
        {badge.verbatim ? (
          <span
            className={`a2-pill${scopeToneClass(badge.tone)}`}
            data-testid="agent-v2-sk-scope"
            title={badge.verbatim}
          >
            <span className="a2-mono">{badge.verbatim}</span>
          </span>
        ) : (
          <span className={`a2-pill${scopeToneClass(badge.tone)}`} data-testid="agent-v2-sk-scope">
            {scopeLabel}
          </span>
        )}
      </p>
      {description ? (
        <p className="a2-card-sub" data-testid="agent-v2-sk-desc">
          {description}
        </p>
      ) : null}
      <p className="a2-meta" data-testid="agent-v2-sk-version">
        {t('agentConsole.v2.sk.version')}{' '}
        {version ? <span className="a2-mono">{version}</span> : '—'}
      </p>
      <p className="a2-meta" data-testid="agent-v2-sk-hash">
        {t('agentConsole.v2.sk.hash')}{' '}
        {hash ? (
          <>
            <span className="a2-mono" title={fullHash ?? undefined}>
              {hash}
            </span>
            <button
              type="button"
              className="a2-btn"
              style={{ marginInlineStart: 8, padding: '0 6px' }}
              data-testid="agent-v2-sk-hash-copy"
              onClick={copyHash}
              title={fullHash ?? undefined}
            >
              {copied ? t('agentConsole.v2.sk.hashCopied') : t('agentConsole.v2.sk.hashCopy')}
            </button>
          </>
        ) : (
          '—'
        )}
      </p>
      <p className="a2-meta" data-testid="agent-v2-sk-owner">
        {t('agentConsole.v2.sk.owner')} {owner ?? '—'}
      </p>
      <p className="a2-meta" data-testid="agent-v2-sk-shared">
        {t('agentConsole.v2.sk.sharedWith')}{' '}
        {sharedNames.length > 0 ? sharedNames.join('、') : '—'}
      </p>
      <p className="a2-meta" data-testid="agent-v2-sk-refs">
        {t('agentConsole.v2.sk.referencedBy')}{' '}
        {refs.length > 0
          ? refs.join('、')
          : refsProvided
            ? t('agentConsole.v2.sk.noReferents')
            : '—'}
      </p>
    </div>
  );
}