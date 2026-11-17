/**
 * S4 — the error-screen request line. Copyable when the gateway supplied a
 * request id; an explicit 「未提供」 when it did not — silence would leave the
 * operator wondering whether a number is missing or nothing exists.
 * Kept out of the HTTP/code surfaces per the S1 caliber (人话 + id only).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface ReqIdProps {
  requestId?: string | null;
  testId?: string;
}

export function ReqId({ requestId, testId }: ReqIdProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  if (!requestId) {
    return (
      <span className="rid-absent" data-testid={testId}>
        {t('agentConsole.v2.id.requestId')}：{t('agentConsole.v2.id.requestIdAbsent')}
      </span>
    );
  }

  const copy = () => {
    try {
      void navigator.clipboard?.writeText(requestId);
    } catch {
      /* clipboard unavailable: the value stays visible for selection */
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <span className="rid" data-testid={testId}>
      {t('agentConsole.v2.id.requestId')}：<span className="mono">{requestId}</span>
      <button type="button" className="rid-copy" onClick={copy} aria-label={t('agentConsole.v2.id.copyRequestId')}>
        {copied ? t('agentConsole.v2.id.copiedShort') : t('agentConsole.v2.id.copyRequestId')}
      </button>
    </span>
  );
}
