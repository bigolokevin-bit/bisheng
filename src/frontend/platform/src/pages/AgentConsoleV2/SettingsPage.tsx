/* SET-01 `/agent/settings` — read-only system settings, rebuilt against the
 * frozen C1 baseline set01-target.html + SET01-TARGET-SPEC.md.
 *
 * Shape (SPEC §1): meta row → page-level read-only boundary banner (third
 * state: 未知) → page head (no primary action) → 180px secondary nav of six
 * groups + content → footer.
 *
 * Non-negotiable conventions of this page:
 * - ZERO write entry: no save / reset / edit / danger control exists in the
 *   DOM (not disabled — not rendered). The only buttons are a read-only probe
 *   (重新检测连接), a retry, and the HelpTip's 「?」.
 * - Three states, never two: 已开启 / 未开启 / 未知（本次未能读取）. 未知 is
 *   neutral, is NOT 关, and never becomes ok/error. CR-M2-02 (the self-check
 *   endpoint) has not landed, so every write switch is 未知.
 * - sanitized projection: no env literal, no token, no upstream address, and
 *   the tenant id is never put on screen. Keys show 已配置/未配置/未知 only.
 * - rules vs readings: contract constants carry 来源=契约; readings carry the
 *   endpoint they came from. Degraded keeps `—` (E06), never 0; a missing
 *   endpoint is 未接入 or 未知, never a fabricated number.
 * - the A7 chain panel is the AUD-01 component, mounted here as-is (E05).
 * - four states per read-backed group; 403/404 replace the group outright
 *   (no skeleton-then-vanish), other failures stay in a card-level error bar
 *   with the HTTP code + request id + retry (S-10).
 */
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link, Navigate, useParams } from 'react-router-dom';

import { AuthError } from '@/controllers/API/agent';
import {
  createHttpAgentConsoleHermesApi,
  type AgentConsoleHermesApi,
  type HermesSummary,
} from '@/controllers/API/agentConsoleHermes';
import { userContext } from '@/contexts/userContext';

import { AuditVerifyPanel, type AuditVerifyStatus } from './AuditVerifyPanel';
import { createHttpAuditApi, type AuditApi } from './aud01';
import { HelpTip } from './HelpTip';
import { avatarChar } from './identity';
import { Field, fmtClock } from './runDetailKit';
import {
  ACCESS_ROWS,
  ALERT_ROWS,
  DANGER_ROWS,
  DEFAULT_SECTION,
  POLICY_RULES,
  RETENTION_RULES,
  SET_SECTIONS,
  WRITE_SWITCHES,
  channelLabel,
  groupNumber,
  hermesSourceState,
  isSectionId,
  phaseFromStatus,
  sectionLabelKey,
  usageRequests,
  type SectionId,
} from './set01';
import {
  GroupGate,
  SDot,
  SetCard,
  SetIcon,
  SetRow,
  type GroupPhase,
} from './set01Kit';
import { useConsoleCrumbTail } from './Shell';

import './set01.css';

const NS = 'agentConsole.v2.set01';

/** The loading screen promises ~10s before the group switches to failure. */
const RUNTIME_TIMEOUT_MS = 10_000;

export interface SettingsPageProps {
  /** Route param override (tests); defaults to `:section`. */
  sectionOverride?: SectionId;
  /** Read-only A7 adapter (tests); HTTP fallback on the page. */
  auditApi?: AuditApi;
  /** runtime.hermes.summary.v1 adapter (tests); HTTP fallback on the page. */
  hermesApi?: AgentConsoleHermesApi;
  /** Pins the 「读于」 stamp (tests only). */
  nowOverride?: number;
}

interface HermesView {
  phase: GroupPhase;
  summary: HermesSummary | null;
  status: number;
}

export function SettingsPage({
  sectionOverride,
  auditApi,
  hermesApi,
  nowOverride,
}: SettingsPageProps = {}) {
  const { t } = useTranslation();
  const params = useParams();
  const raw = sectionOverride ?? params.section;
  const section: SectionId | null = isSectionId(raw) ? raw : null;
  const audit = useMemo(() => auditApi ?? createHttpAuditApi(), [auditApi]);
  const hermes = useMemo(() => hermesApi ?? createHttpAgentConsoleHermesApi(), [hermesApi]);

  useConsoleCrumbTail(section ? t(sectionLabelKey(section)) : null);

  const [readAt, setReadAt] = useState(() => nowOverride ?? Date.now());
  const [reloadToken, setReloadToken] = useState(0);
  const [hermesView, setHermesView] = useState<HermesView>({
    phase: 'loading',
    summary: null,
    status: 0,
  });

  const navDot = (def: (typeof SET_SECTIONS)[number]) => {
    if (def.id !== 'models' && def.id !== 'integrations') {
      return { tone: def.tone, label: t(def.dotKey) };
    }
    if (hermesView.phase !== 'ready') return { tone: 'nt', label: t(`${NS}.unknown`) };
    const state = hermesSourceState(hermesView.summary, 'gateway_health');
    return state === 'ok'
      ? { tone: 'ok', label: t(`${NS}.dotModels`) }
      : { tone: 'nt', label: t(`${NS}.unknown`) };
  };

  const [a7, setA7] = useState<AuditVerifyStatus>({
    phase: 'idle',
    httpStatus: 0,
    requestId: null,
  });

  /* ---------- runtime.hermes.summary.v1 (models + integrations) ----------
   * Only the two groups that actually render a runtime reading pay for the
   * call; a visit to /policy, /data or /danger issues no upstream request. */
  const needsRuntime = section === 'models' || section === 'integrations';

  useEffect(() => {
    if (!needsRuntime) return undefined;
    let live = true;
    let settled = false;
    setHermesView((prev) => ({ ...prev, phase: 'loading' }));
    /* The loading screen promises "about 10s, then the error screen" — so the
     * page owns that deadline instead of relying on the network to fail. A
     * late response is dropped rather than flipping the group back to ready. */
    const deadline = setTimeout(() => {
      if (!live || settled) return;
      settled = true;
      setHermesView({ phase: 'error', summary: null, status: 0 });
    }, RUNTIME_TIMEOUT_MS);
    hermes
      .getSummary()
      .then((res) => {
        if (!live || settled) return;
        settled = true;
        clearTimeout(deadline);
        if (res.ok && res.data) {
          setHermesView({ phase: 'ready', summary: res.data, status: res.status });
          setReadAt(nowOverride ?? Date.now());
        } else {
          setHermesView({
            phase: phaseFromStatus(res.status),
            summary: null,
            status: res.status,
          });
        }
      })
      .catch((err: unknown) => {
        if (!live || settled) return;
        settled = true;
        clearTimeout(deadline);
        if (err instanceof AuthError) {
          // 401 → login, never an empty page (SPEC §4).
          window.location.assign('/');
          return;
        }
        setHermesView({ phase: 'error', summary: null, status: 0 });
      });
    return () => {
      live = false;
      clearTimeout(deadline);
    };
  }, [hermes, reloadToken, needsRuntime, nowOverride]);

  /* A7 status is reported by the panel itself — one request, no duplicates. */
  const onAuditStatus = useCallback((status: AuditVerifyStatus) => {
    setA7((prev) =>
      prev.phase === status.phase &&
      prev.httpStatus === status.httpStatus &&
      prev.requestId === status.requestId
        ? prev
        : status,
    );
  }, []);

  const retry = useCallback(() => {
    setReadAt(nowOverride ?? Date.now());
    setA7({ phase: 'idle', httpStatus: 0, requestId: null });
    setReloadToken((n) => n + 1);
  }, [nowOverride]);

  /* Hooks stay above the redirect: the session is read on every render path. */
  const user = useContext(userContext)?.user;
  const accountName = user?.user_name ? String(user.user_name) : null;

  if (!section) {
    return <Navigate to={`/agent/settings/${DEFAULT_SECTION}`} replace />;
  }

  const tenantGate: GroupPhase =
    a7.phase === 'error' && (a7.httpStatus === 403 || a7.httpStatus === 404)
      ? phaseFromStatus(a7.httpStatus)
      : 'ready';

  return (
    <div className="a2s-page">
      <div className="lk a2r a2s1 aud01" data-testid="agent-v2-settings">
        {/* meta row: freshness · data sources · read-only caliber */}
        <div className="fresh" data-testid="agent-v2-set-fresh">
          <SetIcon name="clock" size={13} />
          {a7.phase === 'loading' ? null : (
            <span aria-live="polite">
              {t(`${NS}.metaReadAt`)} <span className="mono">{fmtClock(readAt)}</span>
            </span>
          )}
          <span className="a2s-meta" data-testid="agent-v2-set-sources">
            {t(`${NS}.metaSources`)}
          </span>
        </div>

        {/* page-level read-only boundary: third state (未知), never ok/error */}
        <div className="s1roband" role="note" aria-label={t(`${NS}.roAria`)}>
          <SetIcon name="lock" size={14} />
          <span>
            <b>{t(`${NS}.roTitle`)}</b>
            {t(`${NS}.roBody`)}
          </span>
          <HelpTip term="settingsWriteUnknown" testId="agent-v2-set-ro-help" />
        </div>

        {/* page head — settings has no 「保存全部」, so no primary action */}
        <div className="phead">
          <div style={{ minWidth: 0 }}>
            <h1 className="h1">
              <SetIcon name="cfg" size={20} />
              {t(`${NS}.title`)}
            </h1>
            <p className="s1-sub">{t(`${NS}.sub`)}</p>
          </div>
          <span className="a2r-sp" aria-hidden="true" />
        </div>

        <div className="s1-layout">
          <nav className="s1-secnav" aria-label={t(`${NS}.navAria`)}>
            <div className="s1-cap">{t(`${NS}.navCap`)}</div>
            {SET_SECTIONS.filter((s) => s.id !== 'danger').map((s) => (
              <Link
                key={s.id}
                to={`/agent/settings/${s.id}`}
                className={`s1nav${section === s.id ? ' on' : ''}`}
                aria-current={section === s.id ? 'page' : undefined}
                data-testid={`agent-v2-set-nav-${s.id}`}
              >
                <SetIcon name={s.icon} size={18} />
                <span className="tx">{t(s.labelKey)}</span>
                <SDot tone={navDot(s).tone} label={navDot(s).label} testId={`agent-v2-set-dot-${s.id}`} />
              </Link>
            ))}
            <div className="s1-div" role="separator" />
            {SET_SECTIONS.filter((s) => s.id === 'danger').map((s) => (
              <Link
                key={s.id}
                to={`/agent/settings/${s.id}`}
                className={`s1nav${section === s.id ? ' on' : ''}`}
                aria-current={section === s.id ? 'page' : undefined}
                data-testid={`agent-v2-set-nav-${s.id}`}
              >
                <SetIcon name={s.icon} size={18} />
                <span className="tx">{t(s.labelKey)}</span>
                <SDot tone={navDot(s).tone} label={navDot(s).label} testId={`agent-v2-set-dot-${s.id}`} />
              </Link>
            ))}
            <span className="s1nav-hint">{t(`${NS}.navSwipeHint`)}</span>
          </nav>

          <div className="s1-body">
            {section === 'tenant' ? (
              <GroupGate
                phase={tenantGate}
                label={t(`${NS}.navTenant`)}
                httpStatus={a7.httpStatus}
                requestId={a7.requestId}
                onRetry={retry}
                testIdPrefix="agent-v2-set-tenant"
              >
                <TenantGroup
                  t={t}
                  audit={audit}
                  accountName={accountName}
                  panelKey={reloadToken}
                  onStatus={onAuditStatus}
                />
              </GroupGate>
            ) : null}

            {section === 'models' ? (
              <GroupGate
                phase={hermesView.phase}
                label={t(`${NS}.navModels`)}
                httpStatus={hermesView.status}
                onRetry={retry}
                testIdPrefix="agent-v2-set-models"
              >
                <ModelsGroup t={t} summary={hermesView.summary} />
              </GroupGate>
            ) : null}

            {section === 'policy' ? <PolicyGroup t={t} /> : null}

            {section === 'integrations' ? (
              <GroupGate
                phase={hermesView.phase}
                label={t(`${NS}.navIntegrations`)}
                httpStatus={hermesView.status}
                onRetry={retry}
                testIdPrefix="agent-v2-set-integrations"
              >
                <IntegrationsGroup
                  t={t}
                  summary={hermesView.summary}
                  accountName={accountName}
                  onProbe={retry}
                />
              </GroupGate>
            ) : null}

            {section === 'data' ? <DataGroup t={t} /> : null}

            {section === 'danger' ? <DangerGroup t={t} /> : null}
          </div>
        </div>

        <div className="pfoot">
          <span className="sp" />
          <span>{t(`${NS}.footZeroWrite`)}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- group 1 · 租户与安全 ---------- */

function TenantGroup({
  t,
  audit,
  accountName,
  panelKey,
  onStatus,
}: {
  t: TFunction;
  audit: AuditApi;
  accountName: string | null;
  panelKey: number;
  onStatus: (status: AuditVerifyStatus) => void;
}) {
  return (
    <>
      {/* A7 — the AUD-01 component, same wording, mounted a second time (E05) */}
      <AuditVerifyPanel key={panelKey} api={audit} onStatus={onStatus} cta="link" hideCode />

      <SetCard
        icon="user"
        title={t(`${NS}.identityTitle`)}
        note={t(`${NS}.identityNote`)}
        testId="agent-v2-set-identity"
      >
        <div className="a2r-hfs">
          <Field label={t(`${NS}.fEnv`)} sans testId="agent-v2-set-f-env">
            <span className="pill nt">
              <span className="dot" aria-hidden="true" />
              {t('agentConsole.v2.envPilot')}
            </span>
          </Field>

          <Field label={t(`${NS}.fUser`)} sans note={t(`${NS}.nUser`)} testId="agent-v2-set-f-user">
            {accountName ? (
              <span className="who">
                <span className="ava" aria-hidden="true">
                  {avatarChar(accountName) ?? <SetIcon name="user" size={12} />}
                </span>
                <span className="nm">{accountName}</span>
              </span>
            ) : (
              <span className="pill nt">
                <span className="dot" aria-hidden="true" />
                {t(`${NS}.userAnonymous`)}
              </span>
            )}
          </Field>

          <Field label={t(`${NS}.fEntry`)} note={t(`${NS}.nEntry`)} testId="agent-v2-set-f-entry">
            /agent
          </Field>

          <Field label={t(`${NS}.fTenantId`)} sans note={t(`${NS}.nTenantId`)} testId="agent-v2-set-f-tenant">
            <span className="pill nt">
              <span className="dot" aria-hidden="true" />
              {t(`${NS}.notOnScreen`)}
            </span>
          </Field>

          <Field
            label={t(`${NS}.fBuild`)}
            sans
            wide
            note={t(`${NS}.nBuild`)}
            testId="agent-v2-set-f-build"
          >
            <span className="pill nt">
              <span className="dot" aria-hidden="true" />
              {t(`${NS}.unknownFull`)}
            </span>
          </Field>

          <Field
            label={t(`${NS}.fTenantName`)}
            sans
            note={t(`${NS}.nTenantName`)}
            testId="agent-v2-set-f-tenant-name"
          >
            <span className="pill nt">
              <span className="dot" aria-hidden="true" />
              {t(`${NS}.noEndpoint`)}
            </span>
          </Field>

          <Field
            label={t(`${NS}.fSessionTtl`)}
            sans
            note={t(`${NS}.nSessionTtl`)}
            testId="agent-v2-set-f-session-ttl"
          >
            <span className="pill nt">
              <span className="dot" aria-hidden="true" />
              {t(`${NS}.unknownFull`)}
            </span>
          </Field>
        </div>
      </SetCard>

      <SetCard
        icon="key"
        title={t(`${NS}.writeTitle`)}
        badge={t(`${NS}.writeBadge`)}
        note={t(`${NS}.writeNote`)}
        foot={t(`${NS}.writeFoot`)}
        testId="agent-v2-set-writes"
      >
        <div className="a2r-hfs">
          {WRITE_SWITCHES.map((w) => (
            <Field
              key={w.id}
              label={t(w.labelKey)}
              sans
              testId={`agent-v2-set-write-${w.id}`}
            >
              <span className="pill nt" data-unknown="true">
                <span className="dot" aria-hidden="true" />
                {t(`${NS}.unknown`)}
              </span>
            </Field>
          ))}
        </div>
      </SetCard>

      <SetCard
        icon="shield"
        title={t(`${NS}.accessTitle`)}
        testId="agent-v2-set-access"
      >
        <div className="s1rows">
          {ACCESS_ROWS.map((row) => (
            <SetRow
              key={row.id}
              icon={row.icon}
              title={t(row.nmKey)}
              pill={row.pillKey ? t(row.pillKey) : undefined}
              tag={row.tag}
              testId={`agent-v2-set-access-${row.id}`}
            >
              <div className="why">{t(row.whyKey)}</div>
            </SetRow>
          ))}
        </div>
      </SetCard>
    </>
  );
}

/* ---------- group 2 · 模型与渠道 ---------- */

function ModelsGroup({ t, summary }: { t: TFunction; summary: HermesSummary | null }) {
  const { i18n } = useTranslation();
  const locale = i18n.language || 'zh-Hans';
  const gateway = hermesSourceState(summary, 'gateway_health');
  const requests = usageRequests(summary);

  return (
    <>
      <SetCard
        icon="server"
        title={t(`${NS}.modelsTitle`)}
        action={
          <Link className="b sm out" to="/model/management" target="_blank" rel="noopener noreferrer" data-testid="agent-v2-set-open-model">
            <SetIcon name="ext" size={16} />
            {t(`${NS}.openInBisheng`)}
          </Link>
        }
        testId="agent-v2-set-models"
      >
        <div className="s1rows">
          <SetRow icon="info" title={t(`${NS}.boundaryTitle`)}>
            <div className="why">{t(`${NS}.boundaryBody`)}</div>
          </SetRow>
          <SetRow
            icon="key"
            title={t(`${NS}.providerTitle`)}
            pill={t(`${NS}.providerPill`)}
            testId="agent-v2-set-models-provider"
          >
            <div className="why">{t(`${NS}.providerBody`)}</div>
          </SetRow>
        </div>
      </SetCard>

      <SetCard
        icon="plug"
        title={t(`${NS}.runtimeTitle`)}
        testId="agent-v2-set-runtime"
      >
        <div className="a2r-hfs">
          <Field
            label={t(`${NS}.fGateway`)}
            sans
            testId="agent-v2-set-f-gateway"
          >
            <StatePill t={t} state={gateway} />
          </Field>

          <Field
            label={t(`${NS}.fRequests`)}
            sans
            note={t(`${NS}.nRequests`)}
            testId="agent-v2-set-f-requests"
          >
            {requests === null ? (
              <span className="pill wr">
                <span className="dash" aria-hidden="true">
                  —
                </span>
                {t(`${NS}.degraded`)}
              </span>
            ) : (
              <span className="mono" data-testid="agent-v2-set-requests-value">
                {groupNumber(requests, locale)}
              </span>
            )}
          </Field>

          <Field
            label={t(`${NS}.fChannel`)}
            sans
            note={t(`${NS}.nChannelSafe`)}
            testId="agent-v2-set-f-channel"
          >
            {channelLabel(t, summary?.gateway?.platform ?? null)}
          </Field>

          <Field
            label={t(`${NS}.fDeadLetterLabel`)}
            sans
            note={t(`${NS}.nDeadLetter`)}
            testId="agent-v2-set-f-deadletter"
          >
            <span className="pill nt">
              <span className="dot" aria-hidden="true" />
              {t(`${NS}.notWired`)}
            </span>
          </Field>
        </div>
      </SetCard>
    </>
  );
}

/* ---------- group 3 · 策略与预算 ---------- */

function PolicyGroup({ t }: { t: TFunction }) {
  return (
    <>
      <SetCard
        icon="coins"
        title={t(`${NS}.policyTitle`)}
        foot={t(`${NS}.policyFoot`)}
        testId="agent-v2-set-policy"
      >
        <div className="s1rows">
          {POLICY_RULES.map((row) => (
            <SetRow key={row.id} icon={row.icon} title={t(row.nmKey)}>
              <div className="why">{t(row.whyKey)}</div>
              {row.toKey && row.toLinkKey ? (
                <div className="go">
                  <Link className="lnk acc" to={row.toLinkKey}>
                    <SetIcon name="users" size={13} />
                    {t(row.toKey)}
                  </Link>
                </div>
              ) : null}
            </SetRow>
          ))}
        </div>
      </SetCard>

      <SetCard
        icon="bell"
        title={t(`${NS}.softTitle`)}
        testId="agent-v2-set-soft-alert"
      >
        <div className="a2r-hfs">
          <Field label={t(`${NS}.fThreshold`)} note={t(`${NS}.nThreshold`)} testId="agent-v2-set-f-threshold">
            {t(`${NS}.vThreshold`)}
            <span className="a2r-u">{t(`${NS}.unitFixed`)}</span>
          </Field>
          <Field label={t(`${NS}.fSemantics`)} sans note={t(`${NS}.nSemantics`)} testId="agent-v2-set-f-semantics">
            {t(`${NS}.vSemantics`)}
          </Field>
          <Field label={t(`${NS}.fPush`)} sans note={t(`${NS}.nPush`)} testId="agent-v2-set-f-push">
            {t(`${NS}.vPush`)}
          </Field>
          <Field label={t(`${NS}.fNotify`)} sans note={t(`${NS}.nNotify`)} testId="agent-v2-set-f-notify">
            <span className="pill wr">
              <span className="dot" aria-hidden="true" />
              {t(`${NS}.vNotify`)}
            </span>
          </Field>
        </div>
      </SetCard>

      <SetCard
        icon="shield"
        title={t(`${NS}.judgeTitle`)}
        testId="agent-v2-set-judge"
      >
        <div className="a2r-hfs">
          <Field label={t(`${NS}.judgeProvider`)} sans testId="agent-v2-set-f-judge-provider">
            {t(`${NS}.judgeProviderV`)}
          </Field>
          <Field label={t(`${NS}.judgeCache`)} sans testId="agent-v2-set-f-judge-cache">
            {t(`${NS}.judgeCacheV`)}
          </Field>
          <Field label={t(`${NS}.judgeLatency`)} sans testId="agent-v2-set-f-judge-latency">
            {t(`${NS}.judgeLatencyV`)}
          </Field>
          <Field label={t(`${NS}.judgeSnapshot`)} sans testId="agent-v2-set-f-judge-snapshot">
            {t(`${NS}.judgeSnapshotV`)}
          </Field>
        </div>
      </SetCard>
    </>
  );
}

/* ---------- group 4 · 通知与集成 ---------- */

function IntegrationsGroup({
  t,
  summary,
  accountName,
  onProbe,
}: {
  t: TFunction;
  summary: HermesSummary | null;
  accountName: string | null;
  onProbe: () => void;
}) {
  const gateway = hermesSourceState(summary, 'gateway_health');

  return (
    <>
      <SetCard
        icon="plug"
        title={t(`${NS}.upstreamTitle`)}
        action={
          <button
            type="button"
            className="b sm out"
            title={t(`${NS}.probeTitle`)}
            data-testid="agent-v2-set-probe"
            onClick={onProbe}
          >
            <SetIcon name="refresh" size={16} />
            {t(`${NS}.probe`)}
          </button>
        }
        foot={t(`${NS}.upstreamFoot`)}
        testId="agent-v2-set-upstream"
      >
        <div className="a2r-hfs">
          <Field label={t(`${NS}.fBisheng`)} sans testId="agent-v2-set-f-bisheng">
            <span className="pill nt">
              <span className="dot" aria-hidden="true" />
              {t(`${NS}.unknownFull`)}
            </span>
          </Field>

          <Field label={t(`${NS}.fHermes`)} sans testId="agent-v2-set-f-hermes">
            <StatePill t={t} state={gateway} />
          </Field>

          <Field label={t(`${NS}.fDomain`)} sans testId="agent-v2-set-f-domain">
            <span className="pill wr">
              <span className="dot" aria-hidden="true" />
              {t(`${NS}.vDomain`)}
            </span>
          </Field>

          <Field label={t(`${NS}.fFeishu`)} sans testId="agent-v2-set-f-feishu">
            <span className="pill nt">
              <span className="dot" aria-hidden="true" />
              {t(`${NS}.notWired`)}
            </span>
          </Field>
        </div>
      </SetCard>

      <SetCard
        icon="bell"
        title={t(`${NS}.alertTitle`)}
        note={t(`${NS}.alertNote`)}
        testId="agent-v2-set-alert-policy"
      >
        <div className="s1rows">
          {ALERT_ROWS.map((row) => (
            <SetRow
              key={row.id}
              icon={row.icon}
              title={t(row.nmKey)}
              pill={row.pillKey ? t(row.pillKey) : undefined}
              pillTone="wr"
              end={
                row.linkLabelKey && row.linkToKey ? (
                  <Link className="lnk" to={row.linkToKey} data-testid={`agent-v2-set-alert-${row.id}`}>
                    {t(row.linkLabelKey)}
                  </Link>
                ) : undefined
              }
            >
              <div className="why">{t(row.whyKey)}</div>
            </SetRow>
          ))}
        </div>
      </SetCard>
    </>
  );
}

/* ---------- group 5 · 数据与保留 ---------- */

function DataGroup({ t }: { t: TFunction }) {
  return (
    <SetCard
      icon="database"
      title={t(`${NS}.dataTitle`)}
      testId="agent-v2-set-data"
    >
      <div className="a2r-hfs">
        {RETENTION_RULES.map((rule) => (
          <Field
            key={rule.id}
            label={t(rule.labelKey)}
            sans={rule.kind === 'pill'}
            note={t(rule.noteKey)}
            testId={`agent-v2-set-data-${rule.id}`}
          >
            {rule.kind === 'pill' ? (
              <span className="pill nt">
                <span className="dot" aria-hidden="true" />
                {t(rule.pillKey ?? '')}
              </span>
            ) : (
              <>
                {t(rule.valueKey ?? '')}
                {rule.unitKey ? <span className="a2r-u">{t(rule.unitKey)}</span> : null}
              </>
            )}
          </Field>
        ))}
      </div>
    </SetCard>
  );
}

/* ---------- group 6 · 危险操作 (公示 only, zero clickable danger control) ---------- */

function DangerGroup({ t }: { t: TFunction }) {
  return (
    <>
      <div className="s1roband" role="note" aria-label={t(`${NS}.dangerAria`)}>
        <SetIcon name="alert" size={14} />
        <span>
          <b>{t(`${NS}.dangerBannerTitle`)}</b>
          {t(`${NS}.dangerBannerBody`)}
        </span>
      </div>

      <SetCard
        icon="alert"
        title={t(`${NS}.dangerTitle`)}
        note={t(`${NS}.dangerNote`)}
        foot={t(`${NS}.dangerFoot`)}
        testId="agent-v2-set-danger"
      >
        <div className="s1rows">
          {DANGER_ROWS.map((row) => (
            <SetRow key={row.id} icon={row.icon} title={t(row.nmKey)} testId={`agent-v2-set-danger-${row.id}`}>
              <div className="why">{t(row.whyKey)}</div>
              <div className="go">
                <span>{t(row.goKey)}</span>
                {row.linkLabelKey && row.linkTo ? (
                  row.external ? (
                    <a
                      className="lnk acc"
                      href={row.linkTo}
                      target="_blank"
                      rel="noopener"
                      data-testid={`agent-v2-set-danger-link-${row.id}`}
                    >
                      {t(row.linkLabelKey)}
                      <SetIcon name="ext" size={13} />
                    </a>
                  ) : (
                    <Link
                      className="lnk acc"
                      to={row.linkTo}
                      data-testid={`agent-v2-set-danger-link-${row.id}`}
                    >
                      {t(row.linkLabelKey)}
                    </Link>
                  )
                ) : null}
                {row.goSuffixKey ? <span>{t(row.goSuffixKey)}</span> : null}
              </div>
            </SetRow>
          ))}
        </div>
      </SetCard>
    </>
  );
}

/** Three-state reading pill: ok / degraded / unknown — never on/off. */
function StatePill({ t, state }: { t: TFunction; state: 'ok' | 'degraded' | 'unknown' }) {
  if (state === 'ok') {
    return (
      <span className="pill ok">
        <span className="dot" aria-hidden="true" />
        {t(`${NS}.ok`)}
      </span>
    );
  }
  if (state === 'degraded') {
    return (
      <span className="pill wr">
        <span className="dot" aria-hidden="true" />
        {t(`${NS}.degradedShort`)}
      </span>
    );
  }
  return (
    <span className="pill nt">
      <span className="dot" aria-hidden="true" />
      {t(`${NS}.unknownFull`)}
    </span>
  );
}