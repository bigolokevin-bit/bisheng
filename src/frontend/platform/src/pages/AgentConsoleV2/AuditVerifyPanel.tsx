/**
 * AUD-01 chain-verify panel (A7, read-only GET) — AUD01-TARGET-SPEC §1.4/§1.6.
 *
 * The panel is ALWAYS on the page (not a drawer, not behind a button): whether
 * the chain is intact is the credibility precondition of the list, so hiding it
 * would amount to a missing block (deep/06 §8 red line 2).
 *
 * Colour discipline is the core rule of this panel:
 *   green ⇔ ok === true && complete === true && scanned > 0 && anchor exists.
 * S0 (no anchor) is neutral, S2 (truncated) is warning even though ok=true,
 * S3 (broken) is danger, S4 (request failed) never claims anything about data.
 * The panel never says 「疑似篡改」, never infers WHO changed anything, never
 * shows a health percentage (there is no denominator) and never shows a
 * "last verified" timestamp (A7 persists nothing).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { HelpTip } from './HelpTip';
import { CopyId } from './listkit';
import { LkIcon } from './listkit/icons';
import {
  BROKEN_IDS_LIMIT,
  DEFAULT_VERIFY_WINDOW,
  VERIFY_WINDOWS,
  classifyVerify,
  formatUtcMinute,
  groupNumber,
  isVerifyGreen,
  shortId,
  verifyRange,
  type AuditApi,
  type AuditVerifyResult,
  type VerifyWindow,
} from './aud01';

const WINDOW_LABEL_KEYS: Record<VerifyWindow, string> = {
  '1h': 'agentConsole.v2.aud01.verifyWindow1h',
  '24h': 'agentConsole.v2.aud01.verifyWindow24h',
  '7d': 'agentConsole.v2.aud01.verifyWindow7d',
  '30d': 'agentConsole.v2.aud01.verifyWindow30d',
};

export interface AuditVerifyPanelProps {
  api: AuditApi;
}

export function AuditVerifyPanel({ api }: AuditVerifyPanelProps) {
  const { t, i18n } = useTranslation();
  const [window, setWindow] = useState<VerifyWindow>(DEFAULT_VERIFY_WINDOW);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [result, setResult] = useState<AuditVerifyResult | null>(null);
  const [httpStatus, setHttpStatus] = useState(0);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [sent, setSent] = useState<{ from: string; to: string } | null>(null);

  const run = useCallback(
    (w: VerifyWindow) => {
      const range = verifyRange(w);
      setSent(range);
      setPhase('loading');
      setHttpStatus(0);
      setRequestId(null);
      api
        .verifyAudit(range)
        .then((res) => {
          if (res.ok && res.data) {
            setResult(res.data);
            setPhase('ok');
          } else {
            setResult(null);
            setHttpStatus(res.status);
            setRequestId(res.requestId ?? null);
            setPhase('error');
          }
        })
        .catch(() => {
          setResult(null);
          setHttpStatus(0);
          setPhase('error');
        });
    },
    [api],
  );

  // One read-only check with the default window on entry (not polling: the
  // result is a one-shot snapshot, re-run only by the button).
  useEffect(() => {
    run(DEFAULT_VERIFY_WINDOW);
  }, [run]);

  const range = sent ?? verifyRange(window);
  const state = phase === 'ok' ? classifyVerify(result) : null;
  const locale = i18n.language || 'zh-Hans';

  return (
    <section className="card chain01" data-testid="aud01-verify" aria-label={t('agentConsole.v2.aud01.verifyTitle')}>
      <div className="chain01-hd">
        <span className="t">
          <LkIcon name="shieldCheck" size={18} />
          {t('agentConsole.v2.aud01.verifyTitle')}
        </span>
        <span className="c mono">A7</span>
        <div className="sp" />
        <span className="hd-note">{t('agentConsole.v2.aud01.verifyReadonlyNote')}</span>
      </div>

      <div className="chain01-pre">
        <p>
          <span className="n">1</span>
          <span>
            {t('agentConsole.v2.aud01.verifyPremise1')}
            <HelpTip term="criticalChain" testId="aud01-help-critical" />
          </span>
        </p>
        <p>
          <span className="n">2</span>
          <span>
            {t('agentConsole.v2.aud01.verifyPremise2')}
            <HelpTip term="twoWindows" testId="aud01-help-windows" />
          </span>
        </p>
        <p>
          <span className="n">3</span>
          <span>{t('agentConsole.v2.aud01.verifyPremise3')}</span>
        </p>
      </div>

      <div className="chain01-win">
        <span className="lb">{t('agentConsole.v2.aud01.verifyWindowLabel')}</span>
        <div className="seg sm" role="group" aria-label={t('agentConsole.v2.aud01.verifyWindowLabel')}>
          {VERIFY_WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={window === w}
              data-testid={`aud01-vw-${w}`}
              disabled={phase === 'loading'}
              onClick={() => {
                setWindow(w);
              }}
            >
              {t(WINDOW_LABEL_KEYS[w])}
            </button>
          ))}
        </div>
        <span className="mono win-range" data-testid="aud01-verify-range">
          {formatUtcMinute(range.from)} → {formatUtcMinute(range.to)}
        </span>
        <div className="sp" />
        <button
          type="button"
          className="b sm out"
          data-testid="aud01-verify-run"
          aria-busy={phase === 'loading'}
          disabled={phase === 'loading'}
          title={t('agentConsole.v2.aud01.verifyRunTitle')}
          onClick={() => run(window)}
        >
          <LkIcon name="shieldCheck" size={16} />
          {t('agentConsole.v2.aud01.verifyRun')}
        </button>
      </div>

      <div className="rule" />

      {phase === 'loading' ? (
        <div className="cv s0" role="status" aria-busy="true" data-testid="aud01-verify-loading">
          <div className="top">
            <span className="ic">
              <LkIcon name="clock" size={18} />
            </span>
            <div>
              <div className="h">{t('agentConsole.v2.aud01.verifyLoadingTitle')}</div>
              <div className="s">{t('agentConsole.v2.aud01.verifyLoadingDesc')}</div>
            </div>
          </div>
        </div>
      ) : null}

      {phase === 'error' ? (
        <VerifyFailed
          t={t}
          httpStatus={httpStatus}
          requestId={requestId}
          onRetry={() => run(window)}
        />
      ) : null}

      {phase === 'ok' && state === 's0' ? <VerifyNoAnchor t={t} result={result} /> : null}
      {phase === 'ok' && state === 's1' ? (
        <VerifyPassed t={t} result={result!} scannedText={groupNumber(result!.scanned, locale)} />
      ) : null}
      {phase === 'ok' && state === 's2' ? (
        <VerifyTruncated
          t={t}
          result={result!}
          scannedText={groupNumber(result!.scanned, locale)}
          onNarrow={() => {
            setWindow('7d');
            run('7d');
          }}
        />
      ) : null}
      {phase === 'ok' && state === 's3' ? (
        <VerifyBroken
          t={t}
          result={result!}
          scannedText={groupNumber(result!.scanned, locale)}
        />
      ) : null}
    </section>
  );
}

function VerifyNoAnchor({ t, result }: { t: TFunction; result: AuditVerifyResult | null }) {
  return (
    <div className="cv s0" role="status" data-testid="aud01-verify-s0">
      <div className="top">
        <span className="ic">
          <LkIcon name="info" size={18} />
        </span>
        <div>
          <div className="h">{t('agentConsole.v2.aud01.verifyS0Title')}</div>
          <div className="s">{t('agentConsole.v2.aud01.verifyS0Desc')}</div>
        </div>
      </div>
      <div className="nums">
        <span className="big">0</span>
        <span className="unit">{t('agentConsole.v2.aud01.verifyScannedUnit')}</span>
      </div>
      <div className="tail">
        <div className="kv">
          <span className="k">{t('agentConsole.v2.aud01.verifyGateLabel')}</span>
          <span className="mono">
            ok / complete = {String(result?.ok ?? true)} / {String(result?.complete ?? true)}
          </span>
          <span className="hd-note">
            {t('agentConsole.v2.aud01.verifyS0Note')}
            <HelpTip term="greenGate" testId="aud01-help-green" />
          </span>
        </div>
        <div className="kv">
          <span className="k">{t('agentConsole.v2.aud01.verifyAnchorLabel')}</span>
          <span className="hd-note">{t('agentConsole.v2.aud01.verifyAnchorAbsent')}</span>
        </div>
      </div>
    </div>
  );
}

function VerifyPassed({
  t,
  result,
  scannedText,
}: {
  t: TFunction;
  result: AuditVerifyResult;
  scannedText: string;
}) {
  return (
    <div className="cv s1" role="status" data-testid="aud01-verify-s1">
      <div className="top">
        <span className="ic">
          <LkIcon name="shieldCheck" size={18} />
        </span>
        <div>
          <div className="h">{t('agentConsole.v2.aud01.verifyS1Title')}</div>
          <div className="s">{t('agentConsole.v2.aud01.verifyS1Desc', { scanned: scannedText })}</div>
        </div>
      </div>
      <div className="nums">
        <span className="big">{scannedText}</span>
        <span className="unit">{t('agentConsole.v2.aud01.verifyS1Unit')}</span>
      </div>
      <div className="tail">
        <div className="kv">
          <span className="k">{t('agentConsole.v2.aud01.verifyGateLabel')}</span>
          <span className="mono">{t('agentConsole.v2.aud01.verifyGreenGateMono')}</span>
          <span className="hd-note">{t('agentConsole.v2.aud01.verifyGreenGateNote')}</span>
        </div>
        {result.anchorCheckpointId ? (
          <div className="kv">
            <span className="k">{t('agentConsole.v2.aud01.verifyAnchorLabel')}</span>
            <CopyId
              value={result.anchorCheckpointId}
              display={shortId(result.anchorCheckpointId)}
              ariaLabel={t('agentConsole.v2.aud01.verifyCopyAnchor')}
              copiedLabel={t('agentConsole.v2.aud01.copied')}
              testId="aud01-anchor"
            />
          </div>
        ) : null}
        {result.chainHeadHash ? (
          <div className="kv">
            <span className="k">{t('agentConsole.v2.aud01.verifyHeadLabel')}</span>
            <CopyId
              value={result.chainHeadHash}
              display={shortId(result.chainHeadHash)}
              ariaLabel={t('agentConsole.v2.aud01.verifyCopyHead')}
              copiedLabel={t('agentConsole.v2.aud01.copied')}
              testId="aud01-chain-head"
            />
          </div>
        ) : null}
        {typeof result.preAnchorEventCount === 'number' && result.preAnchorEventCount > 0 ? (
          <div className="kv">
            <span className="k">{t('agentConsole.v2.aud01.verifyPreAnchorLabel')}</span>
            <span className="hd-note">
              {t('agentConsole.v2.aud01.verifyPreAnchorNote', { n: result.preAnchorEventCount })}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function VerifyTruncated({
  t,
  result,
  scannedText,
  onNarrow,
}: {
  t: TFunction;
  result: AuditVerifyResult;
  scannedText: string;
  onNarrow: () => void;
}) {
  return (
    <div className="cv s2" role="status" data-testid="aud01-verify-s2">
      <div className="top">
        <span className="ic">
          <LkIcon name="alert" size={18} />
        </span>
        <div>
          <div className="h">{t('agentConsole.v2.aud01.verifyS2Title', { scanned: scannedText })}</div>
          <div className="s">{t('agentConsole.v2.aud01.verifyS2Desc')}</div>
        </div>
      </div>
      <div className="nums">
        <span className="big">{scannedText}</span>
        <span className="unit">{t('agentConsole.v2.aud01.verifyS2Unit')}</span>
      </div>
      <div className="tail">
        <div className="kv">
          <span className="k">{t('agentConsole.v2.aud01.verifyGateLabel')}</span>
          <span className="mono">ok = {String(result.ok)} · complete = {String(result.complete)}</span>
          <span className="hd-note">{t('agentConsole.v2.aud01.verifyS2Note')}</span>
        </div>
        <div className="kv">
          <span className="k">{t('agentConsole.v2.aud01.verifySuggestionLabel')}</span>
          <span className="hd-note">{t('agentConsole.v2.aud01.verifyS2Suggestion')}</span>
        </div>
      </div>
      <div className="acts2">
        <button type="button" className="b sm out" data-testid="aud01-verify-narrow" onClick={onNarrow}>
          {t('agentConsole.v2.aud01.verifyNarrowCta')}
        </button>
      </div>
    </div>
  );
}

function VerifyBroken({
  t,
  result,
  scannedText,
}: {
  t: TFunction;
  result: AuditVerifyResult;
  scannedText: string;
}) {
  const ids = useMemo(() => result.brokenEventIds ?? [], [result]);
  const broken = result.brokenCount ?? ids.length;
  const capped = ids.length >= BROKEN_IDS_LIMIT;
  return (
    <div className="cv s3" role="status" data-testid="aud01-verify-s3">
      <div className="top">
        <span className="ic">
          <LkIcon name="shieldAlert" size={18} />
        </span>
        <div>
          <div className="h">{t('agentConsole.v2.aud01.verifyS3Title')}</div>
          <div className="s">{t('agentConsole.v2.aud01.verifyS3Desc')}</div>
        </div>
      </div>
      <div className="nums">
        <span className="big">{broken}</span>
        <span className="unit">
          {t('agentConsole.v2.aud01.verifyS3Unit', { scanned: scannedText })}
        </span>
      </div>
      {ids.length > 0 ? (
        <div className="blist">
          {ids.map((id, i) => (
            <div className="bitem" key={id}>
              {i === 0 ? <span className="tg">{t('agentConsole.v2.aud01.verifyFirstBreak')}</span> : null}
              <CopyId
                value={id}
                display={shortId(id)}
                ariaLabel={t('agentConsole.v2.aud01.verifyCopyBreak')}
                copiedLabel={t('agentConsole.v2.aud01.copied')}
              />
              {/* AUD-02 (per-event page) is not built: copy works, the link is a
                  true dead end, so it stays disabled with a reason (§1.6 S3). */}
              <button
                type="button"
                className="b xs out"
                disabled
                aria-disabled="true"
                title={t('agentConsole.v2.aud01.verifyViewDisabled')}
              >
                {t('agentConsole.v2.aud01.verifyView')}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="tail">
        <div className="kv">
          <span className="k">{t('agentConsole.v2.aud01.verifyGateLabel')}</span>
          <span className="mono">
            ok = false · complete = {String(result.complete)} · brokenCount = {broken}
          </span>
        </div>
        <div className="kv">
          <span className="k">{t('agentConsole.v2.aud01.verifyLimitLabel')}</span>
          <span className="hd-note">
            {capped
              ? t('agentConsole.v2.aud01.verifyLimitCapped', { n: BROKEN_IDS_LIMIT })
              : t('agentConsole.v2.aud01.verifyLimitOk', {
                  n: BROKEN_IDS_LIMIT,
                  m: ids.length,
                })}
          </span>
        </div>
        {result.anchorCheckpointId || result.chainHeadHash ? (
          <div className="kv">
            <span className="k">{t('agentConsole.v2.aud01.verifyAnchorHeadLabel')}</span>
            <span className="mono">
              {result.anchorCheckpointId ? shortId(result.anchorCheckpointId) : '—'} ·{' '}
              {result.chainHeadHash ? shortId(result.chainHeadHash) : '—'}
            </span>
          </div>
        ) : null}
        <div className="kv">
          <span className="k">{t('agentConsole.v2.aud01.verifyNextLabel')}</span>
          <span className="hd-note">{t('agentConsole.v2.aud01.verifyS3Next')}</span>
        </div>
      </div>
    </div>
  );
}

function VerifyFailed({
  t,
  httpStatus,
  requestId,
  onRetry,
}: {
  t: TFunction;
  httpStatus: number;
  requestId: string | null;
  onRetry: () => void;
}) {
  const code = httpStatus > 0 ? `HTTP ${httpStatus}` : t('agentConsole.v2.aud01.networkError');
  return (
    <div className="cv s4" role="alert" data-testid="aud01-verify-s4">
      <div className="top">
        <span className="ic">
          <LkIcon name="alert" size={18} />
        </span>
        <div>
          <div className="h">{t('agentConsole.v2.aud01.verifyS4Title')}</div>
          <div className="s">
            {t('agentConsole.v2.aud01.verifyS4DescPre')}
            <span className="mono">{code}</span>
            {t('agentConsole.v2.aud01.verifyS4DescPost')}
          </div>
        </div>
      </div>
      <div className="tail">
        {requestId ? (
          <div className="kv">
            <span className="k">{t('agentConsole.v2.aud01.verifyRequestIdLabel')}</span>
            <span className="mono">{requestId}</span>
            <span className="hd-note">{t('agentConsole.v2.aud01.verifyRequestIdNote')}</span>
          </div>
        ) : null}
        <div className="kv">
          <span className="k">{t('agentConsole.v2.aud01.verifyOtherCodesLabel')}</span>
          <span className="hd-note">{t('agentConsole.v2.aud01.verifyS4OtherCodes')}</span>
        </div>
      </div>
      <div className="acts2">
        <button type="button" className="b sm out" data-testid="aud01-verify-retry" onClick={onRetry}>
          <LkIcon name="refresh" size={16} />
          {t('agentConsole.v2.aud01.verifyRetry')}
        </button>
      </div>
    </div>
  );
}

/** Exported for tests: the colour gate must be readable without rendering. */
export { isVerifyGreen };