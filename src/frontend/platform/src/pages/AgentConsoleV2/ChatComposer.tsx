/**
 * Bottom input bar of the console chat page.
 *
 * Rules that matter:
 *  - a submission generates ONE requestId; retrying the same text reuses it
 *    (the endpoint is idempotent on that key), new text gets a new one;
 *  - nothing is echoed locally — on success the page re-reads the session, on
 *    failure the draft stays in the box with a human error and its request id;
 *  - while the request is in flight the control is disabled.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChatApi, ChatErrorKind, ChatFailure } from './chat01';
import { chatFailure, newRequestId } from './chat01';
import { ReqId } from './listkit/ReqId';

interface ChatComposerProps {
  api: ChatApi;
  sessionId: string | null;
  /** Blocked because the selected conversation is not readable right now. */
  disabled?: boolean;
  onSent: () => void;
  /** 403/404 on send: the page re-reads the conversation immediately. */
  onUnreadable: () => void;
}

interface PendingSend {
  content: string;
  requestId: string;
}

interface SendFailure {
  failure: ChatFailure;
  clientRequestId: string;
}

export function ChatComposer({ api, sessionId, disabled, onSent, onUnreadable }: ChatComposerProps) {
  const { t } = useTranslation();
  const ns = 'agentConsole.v2.chat01';
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<PendingSend | null>(null);
  const [sendFailure, setSendFailure] = useState<SendFailure | null>(null);

  const content = text.trim();
  const blocked = !sessionId || Boolean(disabled);
  const canSend = !blocked && !sending && content !== '';

  async function submit() {
    if (!sessionId || sending) return;
    const value = text.trim();
    if (!value) return;
    const requestId = pending && pending.content === value ? pending.requestId : newRequestId();
    setPending({ content: value, requestId });
    setSending(true);
    setSendFailure(null);
    const res = await api.sendMessage(sessionId, requestId, value);
    setSending(false);
    if (res.ok) {
      setText('');
      setPending(null);
      setSendFailure(null);
      onSent();
      return;
    }
    const failure = chatFailure(res);
    setSendFailure({ failure, clientRequestId: requestId });
    if (failure.kind === 'denied') onUnreadable();
  }

  function failCopy(kind: ChatErrorKind): string {
    if (kind === 'timeout') return t(`${ns}.sendTimeout`);
    if (kind === 'network') return t(`${ns}.sendNetwork`);
    if (kind === 'denied') return t(`${ns}.sendDenied`);
    if (kind === 'auth') return t('agentConsole.auth.expired');
    return t(`${ns}.sendFailed`);
  }

  const canRetry = Boolean(pending) && pending?.content === content;

  return (
    <div className="cchat-composer">
      {sendFailure ? (
        <div className="cchat-send-fail" role="alert" data-testid="agent-v2-chat-send-error">
          <span className="cchat-send-fail-title">{t(`${ns}.sendFailTitle`)}</span>
          <span className="a2-meta">{failCopy(sendFailure.failure.kind)}</span>
          <span className="a2-meta">{t(`${ns}.sendFailKeep`)}</span>
          <div className="cchat-fail-meta">
            {sendFailure.failure.status > 0 ? (
              <span className="a2-micro" data-testid="agent-v2-chat-send-error-status">
                {t(`${ns}.statusLabel`)} {sendFailure.failure.status}
              </span>
            ) : null}
            <ReqId
              requestId={sendFailure.failure.requestId ?? sendFailure.clientRequestId}
              testId="agent-v2-chat-send-error-rid"
            />
          </div>
          {canRetry ? (
            <div>
              <button
                type="button"
                className="a2-btn"
                onClick={() => void submit()}
                disabled={sending}
                data-testid="agent-v2-chat-send-retry"
              >
                {t(`${ns}.retrySend`)}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <textarea
        className="cchat-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey) return;
          if (e.nativeEvent.isComposing) return;
          e.preventDefault();
          void submit();
        }}
        placeholder={t(`${ns}.placeholder`)}
        aria-label={t(`${ns}.inputAria`)}
        readOnly={sending}
        disabled={blocked}
        data-testid="agent-v2-chat-input"
      />
      <div className="cchat-composer-foot">
        <span className="a2-meta">{t(`${ns}.composerHint`)}</span>
        <button
          type="button"
          className="a2-btn is-primary"
          onClick={() => void submit()}
          disabled={!canSend}
          aria-disabled={!canSend}
          data-testid="agent-v2-chat-send"
        >
          {sending ? t(`${ns}.sending`) : t(`${ns}.send`)}
        </button>
      </div>
    </div>
  );
}