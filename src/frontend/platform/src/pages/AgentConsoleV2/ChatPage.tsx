/* eslint-disable no-restricted-syntax -- the chat screen's only write is the composer; assertions/JSX keep the family conventions */
/**
 * CHAT-01 — console direct chat (/agent/chat).
 *
 * Session list (left, above on narrow screens) + the selected session's
 * message stream + a composer. Data source: the same-origin BFF
 * `/agent-api/api/console-sessions*`, all five calls through the identity gate.
 * Probe 2026-11-17 on 8092: GET /api/console-sessions?limit=5 without a cookie
 * answers 401 {code:"console.unauthenticated"} with X-Console-Request-Id — the
 * endpoint EXISTS, the 200 body shape is unverified, so the page renders
 * loading / empty / error / normal and never fabricates rows (L0 stance:
 * 缺接口就四态).
 *
 * SEND IS THE ONLY WRITE PATH ON THIS PAGE. There is no create/rename/delete
 * session control: sessions are produced elsewhere (employee binding) and this
 * route only continues an existing one. LinSight's chat components were NOT
 * reused — they carry session management and attachment upload actions, so the
 * stream below is hand-built from display-only pieces (same call as SKILL-01).
 *
 * Zero engineering language on screen: no field names, no raw machine codes;
 * an HTTP status only appears as an interpolation argument inside a human
 * sentence. Timestamps go through fmtTime (Asia/Shanghai), missing → '—'.
 *
 * A `citations` block appears ONLY when the assistant message truly carries a
 * non-empty list — no placeholder, no invented reference. A failed send removes
 * the optimistic bubble and never leaves a fake assistant reply behind.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './OverviewBlocks';
import { ReqId } from './listkit/ReqId';
import { fmtTime, makeFetcher, type ApiRes, type Fetcher } from './v2Data';
import {
  citationLabels,
  citationList,
  hasCitations,
  messageRows,
  newRequestId,
  postMessage,
  readCount,
  readText,
  roleLabel,
  sendErrorKey,
  sessionKey,
  sessionRows,
  type ConsoleMessageRow,
  type ConsoleSessionDetailBody,
  type ConsoleSessionListBody,
  type ConsoleSessionSummary,
} from './chat';

/** One rendered bubble: a server row, or the in-flight optimistic user message. */
interface UiMessage extends ConsoleMessageRow {
  uiKey: string;
  pending?: boolean;
}

const CARD_STYLE = { minWidth: 0 } as const;

export default function ChatPage() {
  const { t } = useTranslation();
  const fetchApi: Fetcher = useMemo(() => makeFetcher(), []);

  const [listRes, setListRes] = useState<ApiRes<ConsoleSessionListBody> | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailRes, setDetailRes] = useState<ApiRes<ConsoleSessionDetailBody> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailNonce, setDetailNonce] = useState(0);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendErrKey, setSendErrKey] = useState<string | null>(null);
  const [pendingMsg, setPendingMsg] = useState<UiMessage | null>(null);
  const [sentMsgs, setSentMsgs] = useState<UiMessage[]>([]);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /* ---- list read ---- */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchApi<ConsoleSessionListBody>('/api/console-sessions', { limit: 20 }).then((r) => {
      if (!alive) return;
      setListRes(r);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [fetchApi, nonce]);

  /* ---- detail read for the selected session ---- */
  useEffect(() => {
    if (!selectedId) {
      setDetailRes(null);
      setDetailLoading(false);
      return undefined;
    }
    let alive = true;
    setDetailLoading(true);
    setDetailRes(null);
    setSentMsgs([]);
    setSendErrKey(null);
    fetchApi<ConsoleSessionDetailBody>(
      `/api/console-sessions/${encodeURIComponent(selectedId)}`,
    ).then((r) => {
      if (!alive) return;
      setDetailRes(r);
      setDetailLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [fetchApi, selectedId, detailNonce]);

  const retryList = useCallback(() => setNonce((n) => n + 1), []);
  const retryDetail = useCallback(() => setDetailNonce((n) => n + 1), []);

  const rows: ConsoleSessionSummary[] =
    listRes && listRes.ok ? sessionRows(listRes.data) : [];

  const isTimeout = listRes != null && !listRes.ok && listRes.status === 0 && listRes.code === 'console.timeout';
  const isSessionExpired = listRes != null && !listRes.ok && listRes.status === 401;

  /* ---- loading ---- */
  if (loading) {
    return (
      <div className="a2s-page" data-testid="agent-v2-cs-page" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 className="a2-h1">{t('agentConsole.v2.cs.title')}</h1>
        <p className="a2-meta">{t('agentConsole.v2.cs.desc')}</p>
        <div className="a2s-skeleton" data-testid="agent-v2-cs-loading" aria-hidden="true">
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
      <div className="a2s-page" data-testid="agent-v2-cs-page" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="a2-card" data-testid="agent-v2-cs-error">
          <p className="a2-h2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="alert" size={16} />
            {t('agentConsole.auth.expired')}
          </p>
          <p className="a2-card-sub">{t('agentConsole.v2.cs.errKeep')}</p>
          <span style={{ display: 'block' }}>
            <ReqId requestId={listRes?.requestId} testId="agent-v2-cs-error-reqid" />
          </span>
          <button type="button" className="a2-btn" data-testid="agent-v2-cs-retry" onClick={retryList}>
            {t('agentConsole.v2.cs.retry')}
          </button>
        </div>
      </div>
    );
  }

  /* ---- request failed (degraded, honest) ---- */
  if (listRes != null && !listRes.ok) {
    const code = listRes.status ?? 0;
    return (
      <div className="a2s-page" data-testid="agent-v2-cs-page" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 className="a2-h1">{t('agentConsole.v2.cs.title')}</h1>
        <p className="a2-meta">{t('agentConsole.v2.cs.desc')}</p>
        <div className="a2-card" data-testid="agent-v2-cs-error">
          <p className="a2-h2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="alert" size={16} />
            {isTimeout
              ? t('agentConsole.v2.cs.errTimeout')
              : t('agentConsole.v2.cs.errHttp', { code })}
          </p>
          <p className="a2-card-sub">{t('agentConsole.v2.cs.errKeep')}</p>
          <span style={{ display: 'block' }}>
            <ReqId requestId={listRes.requestId} testId="agent-v2-cs-error-reqid" />
          </span>
          <button type="button" className="a2-btn" data-testid="agent-v2-cs-retry" onClick={retryList}>
            {t('agentConsole.v2.cs.retry')}
          </button>
        </div>
      </div>
    );
  }

  /* ---- empty: no sessions, therefore nothing to send to ---- */
  if (rows.length === 0) {
    return (
      <div className="a2s-page" data-testid="agent-v2-cs-page" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 className="a2-h1">{t('agentConsole.v2.cs.title')}</h1>
        <p className="a2-meta">{t('agentConsole.v2.cs.desc')}</p>
        <div className="a2-card" data-testid="agent-v2-cs-empty">
          <p className="a2-h2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="clip" size={16} />
            {t('agentConsole.v2.cs.emptyTitle')}
          </p>
          <p className="a2-card-sub">{t('agentConsole.v2.cs.emptyHint')}</p>
        </div>
      </div>
    );
  }

  /* ---- normal ---- */
  const selected =
    rows.find((r, i) => sessionKey(r, i) === selectedId) ?? null;
  const serverMsgs: UiMessage[] = detailRes && detailRes.ok
    ? messageRows(detailRes.data).map((m, i) => ({
        ...m,
        uiKey: `srv-${readCount(m.seq) ?? i}-${readText(m.requestId) ?? i}`,
      }))
    : [];
  const stream: UiMessage[] = [...serverMsgs, ...sentMsgs, ...(pendingMsg ? [pendingMsg] : [])];

  const canSend = selectedId != null && draft.trim().length > 0 && !sending;

  const onSend = () => {
    const text = draft.trim();
    if (!selectedId || !text || sending) return;
    const rid = newRequestId();
    const optimistic: UiMessage = {
      uiKey: `local-${rid}`,
      role: 'user',
      content: text,
      requestId: rid,
      pending: true,
    };
    setSending(true);
    setSendErrKey(null);
    setPendingMsg(optimistic);
    setDraft('');
    postMessage(selectedId, { requestId: rid, content: text }).then((r) => {
      if (!aliveRef.current) return;
      setSending(false);
      setPendingMsg(null);
      if (r.ok) {
        /* 201: the server's rows replace the optimistic bubble. If the
         * envelope omits the user row, the accepted text is kept as the echo
         * (the message WAS persisted — 201 says so), an assistant row is only
         * ever shown when the server actually returned one. */
        const um = r.data?.userMessage;
        const am = r.data?.assistantMessage;
        const next: UiMessage[] = [];
        next.push(
          um && readText(um.content)
            ? { ...um, uiKey: `sent-${readCount(um.seq) ?? rid}-u` }
            : { ...optimistic, pending: false, uiKey: `sent-${rid}-u` },
        );
        if (am && readText(am.content)) {
          next.push({ ...am, uiKey: `sent-${readCount(am.seq) ?? rid}-a` });
        }
        setSentMsgs((prev) => [...prev, ...next]);
        return;
      }
      /* Failure: the message was NOT delivered — drop the bubble, offer the
       * text back for a retry, and say what happened in human words. */
      setSendErrKey(sendErrorKey(r.status, r.code));
      setDraft(text);
      if (r.status === 401) setDetailNonce((n) => n + 1);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();
    onSend();
  };

  return (
    <div className="a2s-page" data-testid="agent-v2-cs-page" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 className="a2-h1">{t('agentConsole.v2.cs.title')}</h1>
      <p className="a2-meta">{t('agentConsole.v2.cs.desc')}</p>

      <div className="a2-grid2" data-testid="agent-v2-cs-body">
        {/* ---- session list (read-only selectors; no create/rename/delete) ---- */}
        <div className="a2-card" data-testid="agent-v2-cs-list" style={CARD_STYLE}>
          <p className="a2-card-head" style={{ margin: 0 }}>
            <span className="a2-h2" style={{ margin: 0 }}>
              {t('agentConsole.v2.cs.listTitle')}
            </span>
            {selected ? (
              <span className="a2-pill is-accent" data-testid="agent-v2-cs-list-count">
                {t('agentConsole.v2.cs.msgCount', { count: readCount(selected.messageCount) ?? '—' })}
              </span>
            ) : null}
          </p>
          <div className="a2-cards" style={{ marginTop: 10 }}>
            {rows.map((r, i) => {
              const key = sessionKey(r, i);
              const title = readText(r.title) ?? readText(r.name);
              const count = readCount(r.messageCount);
              const active = key === selectedId;
              return (
                <button
                  type="button"
                  className="a2-card"
                  data-testid="agent-v2-cs-session"
                  data-session={key}
                  aria-pressed={active}
                  key={key}
                  onClick={() => setSelectedId(key)}
                  style={{
                    width: '100%',
                    minWidth: 0,
                    textAlign: 'left',
                    cursor: 'pointer',
                    borderColor: active ? 'var(--accent-border, rgba(129,118,247,.45))' : undefined,
                    background: active ? 'var(--accent-soft, rgba(129,118,247,.14))' : undefined,
                  }}
                >
                  <span className="a2-h2" style={{ display: 'block', margin: 0, overflowWrap: 'anywhere' }}>
                    {title ?? t('agentConsole.v2.cs.sessionFallback')}
                  </span>
                  <span className="a2-meta" style={{ display: 'block', overflowWrap: 'anywhere' }}>
                    {t('agentConsole.v2.cs.updatedAt')} {fmtTime(r.updatedAt)}
                  </span>
                  <span className="a2-meta" style={{ display: 'block', overflowWrap: 'anywhere' }}>
                    {count != null
                      ? t('agentConsole.v2.cs.msgCount', { count })
                      : t('agentConsole.v2.cs.countUnknown')}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ---- stream + composer ---- */}
        <div className="a2-card" data-testid="agent-v2-cs-stream-card" style={CARD_STYLE}>
          {!selectedId ? (
            <div data-testid="agent-v2-cs-pick">
              <p className="a2-h2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="clip" size={16} />
                {t('agentConsole.v2.cs.pickTitle')}
              </p>
              <p className="a2-card-sub">{t('agentConsole.v2.cs.pickHint')}</p>
            </div>
          ) : detailLoading ? (
            <div className="a2s-skeleton" data-testid="agent-v2-cs-detail-loading" aria-hidden="true">
              {Array.from({ length: 4 }, (_, i) => (
                <span className="a2s-sk-row" key={i} />
              ))}
            </div>
          ) : detailRes != null && !detailRes.ok ? (
            <div data-testid="agent-v2-cs-detail-error">
              <p className="a2-h2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="alert" size={16} />
                {detailRes.status === 0 && detailRes.code === 'console.timeout'
                  ? t('agentConsole.v2.cs.errTimeout')
                  : t('agentConsole.v2.cs.detailErr', { code: detailRes.status ?? 0 })}
              </p>
              <p className="a2-card-sub">{t('agentConsole.v2.cs.errKeep')}</p>
              <span style={{ display: 'block' }}>
                <ReqId requestId={detailRes.requestId} testId="agent-v2-cs-detail-reqid" />
              </span>
              <button
                type="button"
                className="a2-btn"
                data-testid="agent-v2-cs-detail-retry"
                onClick={retryDetail}
              >
                {t('agentConsole.v2.cs.retry')}
              </button>
            </div>
          ) : (
            <>
              <div
                className="a2-cards"
                data-testid="agent-v2-cs-messages"
                style={{ maxHeight: 480, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}
              >
                {stream.length === 0 ? (
                  <p className="a2-card-sub" data-testid="agent-v2-cs-no-messages">
                    {t('agentConsole.v2.cs.noMessages')}
                  </p>
                ) : (
                  stream.map((m) => <MessageBubble msg={m} key={m.uiKey} />)
                )}
              </div>

              <div
                data-testid="agent-v2-cs-composer"
                style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: '1px solid var(--hairline, rgba(255,255,255,.08))',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  minWidth: 0,
                }}
              >
                <label className="a2-meta" htmlFor="agent-v2-cs-input">
                  {t('agentConsole.v2.cs.composerLabel')}
                </label>
                <textarea
                  id="agent-v2-cs-input"
                  data-testid="agent-v2-cs-input"
                  value={draft}
                  rows={2}
                  placeholder={t('agentConsole.v2.cs.composerPlaceholder')}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    minWidth: 0,
                    minHeight: 64,
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    fontSize: 13,
                    lineHeight: '20px',
                    color: 'hsl(var(--foreground))',
                    background: 'hsl(var(--surface))',
                    border: '1px solid var(--hairline, rgba(255,255,255,.08))',
                    borderRadius: 6,
                    padding: '8px 10px',
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="a2-btn is-primary"
                    data-testid="agent-v2-cs-send"
                    disabled={!canSend}
                    onClick={onSend}
                  >
                    {sending ? t('agentConsole.v2.cs.sending') : t('agentConsole.v2.cs.send')}
                  </button>
                  {sendErrKey ? (
                    <span
                      className="a2-meta"
                      data-testid="agent-v2-cs-send-error"
                      style={{ color: 'hsl(var(--warning))', overflowWrap: 'anywhere' }}
                    >
                      {t(sendErrKey)}
                    </span>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: UiMessage }) {
  const { t } = useTranslation();
  const role = roleLabel(msg.role);
  const content = readText(msg.content) ?? '';
  const citations = citationList(msg.citations);
  const labels = citationLabels(msg.citations);
  const isUser = readText(msg.role) === 'user';

  return (
    <div
      className="a2-card"
      data-testid="agent-v2-cs-msg"
      data-role={readText(msg.role) ?? ''}
      data-pending={msg.pending ? '1' : '0'}
      style={{
        minWidth: 0,
        background: isUser ? 'var(--accent-soft, rgba(129,118,247,.14))' : undefined,
      }}
    >
      <p className="a2-meta" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: 0 }}>
        {role.verbatim ? (
          <span className="a2-pill is-warn" data-testid="agent-v2-cs-msg-role" title={role.verbatim}>
            <span className="a2-mono">{role.verbatim}</span>
          </span>
        ) : role.key ? (
          <span className={`a2-pill${isUser ? ' is-accent' : ''}`} data-testid="agent-v2-cs-msg-role">
            {t(role.key)}
          </span>
        ) : (
          <span className="a2-pill" data-testid="agent-v2-cs-msg-role">
            —
          </span>
        )}
        <span className="a2-mono">{fmtTime(msg.createdAt)}</span>
        {msg.pending ? (
          <span className="a2-pill is-warn" data-testid="agent-v2-cs-msg-pending">
            {t('agentConsole.v2.cs.msgPending')}
          </span>
        ) : null}
      </p>
      <p
        data-testid="agent-v2-cs-msg-content"
        style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}
      >
        {content}
      </p>
      {hasCitations(msg.citations) ? (
        <div data-testid="agent-v2-cs-citations" style={{ marginTop: 8, minWidth: 0 }}>
          <p className="a2-meta" style={{ margin: 0 }}>
            {t('agentConsole.v2.cs.citations')}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4, minWidth: 0 }}>
            {labels.length > 0 ? (
              labels.map((label, i) => (
                <span
                  className="a2-pill"
                  data-testid="agent-v2-cs-citation"
                  key={`${label}-${i}`}
                  style={{ maxWidth: '100%', overflowWrap: 'anywhere' }}
                >
                  {label}
                </span>
              ))
            ) : (
              /* a real list exists but no label can be derived from its shape:
               * state the size honestly instead of dropping the block */
              <span className="a2-pill" data-testid="agent-v2-cs-citation">
                {t('agentConsole.v2.cs.citationCount', { count: citations.length })}
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}