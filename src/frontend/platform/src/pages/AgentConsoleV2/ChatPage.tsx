/**
 * L4p2 — `控制台直聊` (route /agent/chat).
 *
 * Left: session list. Right: message stream read from the BFF. Bottom: the
 * input bar. Four screens are mandatory here — loading, empty, error (human
 * copy + request number) and 403/404 (one identical whole-page body). A
 * failure never leaves a fabricated reply behind and never keeps stale
 * conversation data on screen.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import type {
  ChatApi,
  ChatFailure,
  ChatMessageRow,
  ChatResult,
  ChatSessionDetailBody,
  ChatSessionRow,
} from './chat01';
import {
  chatFailure,
  chatErrorKind,
  createChatApi,
  fmtChatTime,
  pickSessionId,
  sortMessages,
} from './chat01';
import { ChatComposer } from './ChatComposer';
import { ChatFailureNote } from './ChatFailureNote';
import { ChatThread, type ChatThreadState } from './ChatThread';
import { ReqId } from './listkit/ReqId';
import './chat01.css';

type ListState = 'loading' | 'ready' | 'empty' | 'error' | 'denied';

interface ChatPageProps {
  /** Tests inject a fake transport; production uses the same-origin BFF. */
  api?: ChatApi;
}

export default function ChatPage({ api }: ChatPageProps = {}) {
  const { t } = useTranslation();
  const ns = 'agentConsole.v2.chat01';
  const client = useMemo(() => api ?? createChatApi(), [api]);
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedSession = searchParams.get('session');
  const linkedEmployee = searchParams.get('employeeId') ?? undefined;

  const [listState, setListState] = useState<ListState>('loading');
  const [listFailure, setListFailure] = useState<ChatFailure | null>(null);
  const [items, setItems] = useState<ChatSessionRow[]>([]);
  const [listNonce, setListNonce] = useState(0);
  const silentListRef = useRef(false);

  const [selected, setSelected] = useState<string | null>(linkedSession);
  const [threadState, setThreadState] = useState<ChatThreadState>('idle');
  const [threadFailure, setThreadFailure] = useState<ChatFailure | null>(null);
  const [detail, setDetail] = useState<ChatSessionDetailBody | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [detailNonce, setDetailNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    const silent = silentListRef.current;
    silentListRef.current = false;
    if (!silent) {
      setListState('loading');
      setListFailure(null);
    }
    client.listSessions({ employeeId: linkedEmployee, limit: 50 }).then((res) => {
      if (!alive) return;
      if (!res.ok) {
        // A quiet refresh must not wipe a list that is already on screen.
        if (silent) return;
        const failure = chatFailure(res);
        setListFailure(failure);
        setItems([]);
        setListState(failure.kind === 'denied' ? 'denied' : 'error');
        return;
      }
      const rows = (res.data?.items ?? []).filter(
        (row): row is ChatSessionRow => Boolean(row && typeof row.sessionId === 'string' && row.sessionId),
      );
      setItems(rows);
      setListFailure(null);
      setListState(rows.length > 0 ? 'ready' : 'empty');
      setSelected((prev) => {
        /* Leg 5: a deep link the list does not contain must not be traded for
         * the newest row. Dropping the selection leaves the thread pane idle,
         * which is where the neutral notice renders. linkedSession is read
         * from the address on every render, so it is deliberately not added
         * to the effect deps: the list must not re-fetch on navigation. */
        if (
          linkedSession &&
          prev === linkedSession &&
          !rows.some((r) => r.sessionId === linkedSession)
        ) {
          return null;
        }
        return pickSessionId(rows, prev);
      });
    });
    return () => {
      alive = false;
    };
  }, [client, linkedEmployee, listNonce]);

  useEffect(() => {
    if (!selected) {
      setThreadState('idle');
      setThreadFailure(null);
      setDetail(null);
      setMessages([]);
      return undefined;
    }
    let alive = true;
    setThreadState('loading');
    setThreadFailure(null);
    setDetail(null);
    setMessages([]);
    client.sessionDetail(selected).then((res: ChatResult<ChatSessionDetailBody>) => {
      if (!alive) return;
      if (!res.ok) {
        const failure = chatFailure(res);
        setThreadFailure(failure);
        setThreadState(failure.kind === 'denied' ? 'denied' : 'error');
        return;
      }
      const body = res.data ?? null;
      setDetail(body);
      setMessages(sortMessages(body?.messages));
      setThreadState('ready');
    });
    return () => {
      alive = false;
    };
  }, [client, detailNonce, selected]);

  function retryList() {
    setListNonce((n) => n + 1);
  }

  function retryThread() {
    setDetailNonce((n) => n + 1);
  }

  /** After a successful send: re-read the thread, refresh the list order quietly. */
  function handleSent() {
    setDetailNonce((n) => n + 1);
    silentListRef.current = true;
    setListNonce((n) => n + 1);
  }

  function selectSession(sessionId: string) {
    setSelected(sessionId);
    const next = new URLSearchParams(searchParams);
    next.set('session', sessionId);
    setSearchParams(next, { replace: true });
  }

  function backToList() {
    setSelected(null);
    const next = new URLSearchParams(searchParams);
    next.delete('session');
    setSearchParams(next, { replace: true });
  }

  const composerDisabled = threadState !== 'ready';

  /* Leg 5: a deep link that is not in the loaded list must not fall back
   * silently. pickSessionId() swaps the id out, so the mismatch below is the
   * honest signal that the address points at nothing we actually read. */
  const deepMissing =
    Boolean(linkedSession) &&
    selected !== linkedSession &&
    (listState === 'ready' || listState === 'empty');

  /* D5: with both panes empty there is nothing to stretch. Let the columns
   * take their content height instead of floating a half-page card over a
   * blank column and a composer glued to the bottom. */
  const idleLayout = listState === 'empty' || threadState === 'idle';

  return (
    <div className="a2s-page cchat-page" data-testid="agent-v2-page-chat">
      <header className="cchat-head">
        <div className="cchat-head-text">
          <h1 className="a2-h1">{t(`${ns}.title`)}</h1>
          <p className="a2-meta">{t(`${ns}.subtitle`)}</p>
        </div>
        <span className="a2-micro" data-testid="agent-v2-chat-tz">
          {t(`${ns}.tzNote`)}
        </span>
      </header>

      {listState === 'loading' ? (
        <div className="cchat-shell" data-testid="agent-v2-chat-loading">
          <div className="a2-card cchat-list">
            <div className="a2s-skeleton">
              <div className="a2s-sk-row" />
              <div className="a2s-sk-row is-short" />
              <div className="a2s-sk-row" />
            </div>
          </div>
          <div className="a2-card cchat-thread">
            <div className="a2s-skeleton">
              <div className="a2s-sk-row" />
              <div className="a2s-sk-row" />
              <div className="a2s-sk-row is-short" />
            </div>
          </div>
        </div>
      ) : null}

      {/*
        403 and 404 share ONE whole-page body on purpose: a conversation the
        caller may not see and one that does not exist must look identical.
      */}
      {listState === 'denied' ? (
        <div className="a2-card cchat-gate" data-testid="agent-v2-chat-page-denied">
          <h2 className="a2-h2">{t(`${ns}.deniedTitle`)}</h2>
          <p className="a2-meta">{t(`${ns}.deniedBody`)}</p>
          <ReqId requestId={listFailure?.requestId} testId="agent-v2-chat-page-denied-rid" />
          <div>
            <button
              type="button"
              className="a2-btn"
              onClick={retryList}
              data-testid="agent-v2-chat-page-denied-retry"
            >
              {t(`${ns}.retryRead`)}
            </button>
          </div>
        </div>
      ) : null}

      {listState === 'error' && listFailure ? (
        <div className="a2-card cchat-gate" data-testid="agent-v2-chat-page-error">
          <ChatFailureNote
            failure={listFailure}
            onRetry={retryList}
            testId="agent-v2-chat-page-error-note"
          />
        </div>
      ) : null}

      {listState === 'ready' || listState === 'empty' ? (
        <div className={idleLayout ? 'cchat-shell is-idle' : 'cchat-shell'}>
          <aside
            className="a2-card cchat-list"
            aria-label={t(`${ns}.listAria`)}
            data-testid="agent-v2-chat-list"
          >
            <div className="cchat-list-head">
              <h2 className="a2-h2">{t(`${ns}.listTitle`)}</h2>
              <span className="a2-meta" data-testid="agent-v2-chat-list-count">
                {t(`${ns}.listCount`, { n: items.length })}
              </span>
            </div>
            {listState === 'empty' ? (
              <div className="cchat-placeholder is-list" data-testid="agent-v2-chat-list-empty">
                <h3 className="a2-h2">{t(`${ns}.listEmptyTitle`)}</h3>
                <p className="a2-meta">{t(`${ns}.listEmptyHint`)}</p>
                <Link
                  to="/agent/employees"
                  className="a2-btn"
                  data-testid="agent-v2-chat-list-empty-go"
                >
                  {t(`${ns}.listEmptyGo`)}
                </Link>
              </div>
            ) : (
              <ul className="cchat-rows" role="list">
                {items.map((row) => {
                  const active = row.sessionId === selected;
                  return (
                    <li key={row.sessionId}>
                      <button
                        type="button"
                        className={active ? 'cchat-row is-active' : 'cchat-row'}
                        aria-current={active ? 'true' : undefined}
                        onClick={() => selectSession(row.sessionId)}
                        data-testid="agent-v2-chat-session"
                        data-session-id={row.sessionId}
                      >
                        <span className="cchat-row-title">
                          {row.title?.trim() || t(`${ns}.untitled`)}
                        </span>
                        <span className="cchat-row-time a2-mono">{fmtChatTime(row.updatedAt)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <section className="a2-card cchat-thread" data-testid="agent-v2-chat-thread">
            <ChatThread
              state={threadState}
              failure={threadFailure}
              detail={detail}
              messages={messages}
              sessionId={selected}
              emptyList={listState === 'empty'}
              deepMissing={deepMissing}
              onRetry={retryThread}
              onBack={backToList}
            />
            <ChatComposer
              key={selected ?? 'none'}
              api={client}
              sessionId={selected}
              disabled={composerDisabled}
              onSent={handleSent}
              onUnreadable={retryThread}
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}