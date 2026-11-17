/**
 * Right pane of the console chat page: session header plus the message stream.
 * Every bubble renders its text through React children only — no HTML sink.
 * A conversation that loads, or a message with no text, says so in words
 * instead of leaving an empty block.
 */
import { useTranslation } from 'react-i18next';

import type { ChatFailure, ChatMessageRow, ChatSessionDetailBody } from './chat01';
import { fmtChatTime, hasText, messageSide } from './chat01';
import { ChatFailureNote } from './ChatFailureNote';
import { ReqId } from './listkit/ReqId';
import { idTail } from './identity';

export type ChatThreadState = 'idle' | 'loading' | 'ready' | 'error' | 'denied';

interface ChatThreadProps {
  state: ChatThreadState;
  failure: ChatFailure | null;
  detail: ChatSessionDetailBody | null;
  messages: ChatMessageRow[];
  sessionId: string | null;
  emptyList: boolean;
  deepMissing: boolean;
  onRetry: () => void;
  onBack: () => void;
}

export function ChatThread({
  state,
  failure,
  detail,
  messages,
  sessionId,
  emptyList,
  deepMissing,
  onRetry,
  onBack,
}: ChatThreadProps) {
  const { t } = useTranslation();
  const ns = 'agentConsole.v2.chat01';
  // PRD CHAT-HEAD-01: a session with no title reads 未命名会话 — a
  // truncated id is engineering language and never becomes a heading.
  const title = detail?.title?.trim() || '';
  const showHeader = Boolean(sessionId) && state !== 'denied';

  return (
    <div className="cchat-thread-inner">
      {showHeader ? (
        <header className="cchat-thread-head">
          {/* PRD CHAT-HEAD-02: below 900px the list and thread stack, so the
              thread needs its own way back to the list. */}
          <button
            type="button"
            className="a2-btn cchat-back"
            onClick={onBack}
            data-testid="agent-v2-chat-back"
          >
            {t(`${ns}.backToList`)}
          </button>
          <h2 className="a2-h2" data-testid="agent-v2-chat-thread-title">
            {title || t(`${ns}.untitled`)}
          </h2>
          <div className="cchat-thread-meta">
            {/* R3b-1: the payload carries no employee name, so the meta shows
                the label plus a 4-char tail and keeps the raw id in `title`.
                Formatting only — no directory lookup, no extra request. */}
            {detail?.employeeId ? (
              <span className="a2-meta">
                {`${t(`${ns}.employeeLabel`)} · `}
                <span className="a2-mono" title={detail.employeeId}>
                  {idTail(detail.employeeId, 4) || '—'}
                </span>
              </span>
            ) : null}
            {detail?.updatedAt ? (
              <span className="a2-meta">
                {t(`${ns}.updatedLabel`)} <span className="a2-mono">{fmtChatTime(detail.updatedAt)}</span>
              </span>
            ) : null}
          </div>
        </header>
      ) : null}

      {state === 'idle' && deepMissing ? (
        <div
          className="cchat-placeholder"
          data-testid="agent-v2-chat-thread-missing"
        >
          <h3 className="a2-h2">{t(`${ns}.sessionMissingTitle`)}</h3>
          <p className="a2-meta">{t(`${ns}.sessionMissing`)}</p>
          <div>
            <button
              type="button"
              className="a2-btn"
              onClick={onBack}
              data-testid="agent-v2-chat-thread-missing-back"
            >
              {t(`${ns}.backToList`)}
            </button>
          </div>
        </div>
      ) : null}

      {state === 'idle' && !deepMissing ? (
        <div className="cchat-placeholder" data-testid="agent-v2-chat-idle">
          {emptyList ? null : (
            <h3 className="a2-h2">{t(`${ns}.selectHint`)}</h3>
          )}
          <p className="a2-meta">
            {emptyList ? t(`${ns}.noSessionsHint`) : t(`${ns}.threadHint`)}
          </p>
        </div>
      ) : null}

      {state === 'loading' ? (
        <div className="a2s-skeleton cchat-msgs-skeleton" data-testid="agent-v2-chat-thread-loading">
          <div className="a2s-sk-row" />
          <div className="a2s-sk-row is-short" />
          <div className="a2s-sk-row" />
          <div className="a2s-sk-row is-short" />
        </div>
      ) : null}

      {state === 'denied' ? (
        <div className="cchat-placeholder" data-testid="agent-v2-chat-thread-denied">
          <h3 className="a2-h2">{t(`${ns}.deniedThreadTitle`)}</h3>
          <p className="a2-meta">{t(`${ns}.deniedBody`)}</p>
          <div className="cchat-fail-meta">
            <ReqId requestId={failure?.requestId} testId="agent-v2-chat-thread-denied-rid" />
          </div>
          <div>
            <button
              type="button"
              className="a2-btn"
              onClick={onBack}
              data-testid="agent-v2-chat-thread-back"
            >
              {t(`${ns}.backToList`)}
            </button>
          </div>
        </div>
      ) : null}

      {state === 'error' && failure ? (
        <ChatFailureNote
          failure={failure}
          onRetry={onRetry}
          testId="agent-v2-chat-thread-error"
        />
      ) : null}

      {state === 'ready' ? (
        messages.length === 0 ? (
          <div className="cchat-placeholder" data-testid="agent-v2-chat-messages-empty">
            <h3 className="a2-h2">{t(`${ns}.msgEmpty`)}</h3>
            <p className="a2-meta">{t(`${ns}.msgEmptyHint`)}</p>
          </div>
        ) : (
          <div
            className="cchat-msgs"
            role="log"
            aria-label={t(`${ns}.threadAria`)}
            data-testid="agent-v2-chat-messages"
          >
            {messages.map((msg, index) => {
              const side = messageSide(msg.role);
              return (
                <div
                  key={msg.seq ?? `${msg.at ?? 'msg'}-${index}`}
                  className={`cchat-msg is-${side}`}
                  data-testid="agent-v2-chat-msg"
                >
                  <div className="cchat-bubble">
                    {hasText(msg.text) ? (
                      msg.text
                    ) : (
                      <span className="cchat-note">{t(`${ns}.msgNoText`)}</span>
                    )}
                  </div>
                  <span className="cchat-msg-time">{fmtChatTime(msg.at)}</span>
                </div>
              );
            })}
          </div>
        )
      ) : null}
    </div>
  );
}