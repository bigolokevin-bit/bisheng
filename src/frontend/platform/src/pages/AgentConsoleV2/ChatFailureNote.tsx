/**
 * Shared failure block for the console chat page. Copy is keyed by the
 * classified failure kind — machine codes never reach the screen. The gateway
 * request number is shown (or 「未提供」) so an operator can hand it over.
 */
import { useTranslation } from 'react-i18next';

import type { ChatFailure } from './chat01';
import { ReqId } from './listkit/ReqId';

interface ChatFailureNoteProps {
  failure: ChatFailure;
  onRetry: () => void;
  testId: string;
}

export function ChatFailureNote({ failure, onRetry, testId }: ChatFailureNoteProps) {
  const { t } = useTranslation();
  const ns = 'agentConsole.v2.chat01';
  let title = t(`${ns}.readHttp`);
  let hint = t(`${ns}.readHttpHint`);
  if (failure.kind === 'auth') {
    title = t('agentConsole.auth.expired');
    hint = t(`${ns}.authHint`);
  } else if (failure.kind === 'timeout' || failure.kind === 'network') {
    title = t(`${ns}.readFail`);
    hint = t(`${ns}.readFailHint`);
  } else if (failure.kind === 'unavailable') {
    title = t(`${ns}.unavailableTitle`);
    hint = t(`${ns}.unavailableHint`);
  } else if (failure.kind === 'denied') {
    title = t(`${ns}.deniedTitle`);
    hint = t(`${ns}.deniedBody`);
  }

  return (
    <div className="cchat-fail" data-testid={testId}>
      <h3 className="a2-h2">{title}</h3>
      <p className="a2-meta">{hint}</p>
      <div className="cchat-fail-meta">
        {failure.status > 0 ? (
          <span className="a2-micro" data-testid={`${testId}-status`}>
            {t(`${ns}.statusLabel`)} {failure.status}
          </span>
        ) : null}
        <ReqId requestId={failure.requestId} testId={`${testId}-rid`} />
      </div>
      {failure.kind === 'auth' ? null : (
        <div>
          <button
            type="button"
            className="a2-btn"
            onClick={onRetry}
            data-testid={`${testId}-retry`}
          >
            {t(`${ns}.retryRead`)}
          </button>
        </div>
      )}
    </div>
  );
}