import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, StateView, Tag, Textarea } from '@bisheng/ui';
import type { AgentConsoleApi, ChatRequest, RunEventItem } from '@/controllers/API/agent';
import { runTagColor } from './AgentRunsTab';

export interface ChatTabProps {
  api: AgentConsoleApi;
  employeeId: string;
}

/** R3 polling cadence (design §2): 1.5 s interval, ~120 polls soft stop. */
const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 120;
const EVENT_LIMIT = 50;

type UserStatus = 'pending' | 'sent' | 'failed';
type AssistantStatus =
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'stillRunning';

interface ChatRow {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: UserStatus | AssistantStatus;
  runId?: string;
  /** Idempotency key, kept on the optimistic row and reused verbatim on retry. */
  chatRequestKey?: string;
  /** i18n key of the honest failure copy; absent = surface the raw code. */
  errorKey?: string;
  errorCode?: string;
  /** Terminal reasonCode from the event payload, shown verbatim. */
  reasonCode?: string;
  /** completed with no message event: empty-reply notice, never fake text. */
  emptyReply?: boolean;
}

interface PollMeta {
  runId: string;
  sinceSeq: number;
  polls: number;
  hasText: boolean;
  done: boolean;
}

/** Terminal event vocabulary per contract (design §2). */
const TERMINAL_STATUS: Record<string, AssistantStatus> = {
  completed: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
  interrupted: 'interrupted',
};

let keySeq = 0;
/**
 * chatRequestKey per design §1: a client-generated UUID per user message,
 * stable across retries of that message. Falls back to a counter-based id on
 * insecure origins where crypto.randomUUID is unavailable (HTTP deployments).
 */
function newChatRequestKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  keySeq += 1;
  return `ck-${Date.now().toString(36)}-${keySeq.toString(36)}`;
}

/**
 * Honest failure mapping (design §1):
 * 401 -> sign-in copy; 403 -> not-permitted copy; 409 -> surfaced with the
 * code text (returns undefined here; the row renders errorCode verbatim);
 * 5xx / status 0 (network) -> unavailable copy; other 4xx -> rejected copy.
 */
function chatErrorKey(status: number): string | undefined {
  if (status === 401) return 'agentConsole.chat.error.unauthenticated';
  if (status === 403) return 'agentConsole.chat.error.forbidden';
  if (status === 409) return undefined; // code text is the message
  if (status === 0 || status >= 500) return 'agentConsole.chat.error.unavailable';
  return 'agentConsole.chat.error.rejected';
}

/**
 * Design §2 / D-2: message text lives in payload.text, content as fallback.
 * Live Hermes streams reply fragments as payload.delta on message events
 * (verified 2026-11-14, evidence fix409-run15); appendRowText accumulates
 * them, so a delta is returned verbatim here.
 */
function eventText(ev: RunEventItem): string | null {
  const payload = ev.payload;
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.content === 'string') return payload.content;
  if (typeof payload.delta === 'string') return payload.delta;
  return null;
}

function reasonCodeOf(ev: RunEventItem): string | undefined {
  const code = ev.payload?.reasonCode;
  return typeof code === 'string' ? code : undefined;
}

/**
 * P0-13 Route A first-party chat panel (ADR-0013: this panel IS the
 * conversation path; the Bisheng iframe is only a fallback entry).
 * Send -> POST employee-chat (E5->P5->R1 server-side), then poll R3
 * run-events with a sinceSeq cursor until a terminal event. All copy goes
 * through agentConsole.chat.*; nothing is fabricated (design §5).
 */
export function ChatTab({ api, employeeId }: ChatTabProps) {
  const { t } = useTranslation();
  const canChat = typeof api.sendChat === 'function' && typeof api.listRunEvents === 'function';

  const [rows, setRows] = useState<ChatRow[]>([]);
  const [draft, setDraft] = useState('');
  /** Number of sendChat calls in flight; disables the send button (design §3). */
  const [sending, setSending] = useState(0);
  /** Bisheng app-workstation entry, only when bindingType=app + externalRef. */
  const [bishengHref, setBishengHref] = useState<string | null>(null);

  const rowSeq = useRef(0);
  const aliveRef = useRef(true);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const pollsRef = useRef<Map<string, PollMeta>>(new Map());

  useEffect(() => {
    aliveRef.current = true;
    const timers = timersRef.current;
    const polls = pollsRef.current;
    return () => {
      // Unmount / tab switch cleanup (design §2): stop every poll chain.
      aliveRef.current = false;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      polls.clear();
    };
  }, []);

  // Iframe fallback entry (design §3): a secondary link, never embedded.
  useEffect(() => {
    if (!canChat) return;
    let live = true;
    void (async () => {
      try {
        const res = await api.getWorkstations(employeeId);
        const app =
          res.ok && res.data
            ? res.data.items.find((w) => w.bindingType === 'app' && w.externalRef)
            : undefined;
        if (live && app) {
          setBishengHref(`/workspace/chat/assistant/auth/${app.externalRef}`);
        }
      } catch {
        // Honest absence: no workstation data -> no entry, no noise.
      }
    })();
    return () => {
      live = false;
    };
  }, [api, employeeId, canChat]);

  const nextRowId = () => {
    rowSeq.current += 1;
    return `chat-row-${rowSeq.current}`;
  };

  const updateRow = (id: string, patch: Partial<ChatRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const appendRowText = (id: string, chunk: string) => {
    // Live Hermes streams replies as payload.delta fragments; they must be
    // concatenated verbatim (no separator) to rebuild the original text
    // (verified 2026-11-14, evidence fix409-run15: fragments "P"/"0-1"/...).
    setRows((prev) =>
      prev.map((row) =>
        row.id === id ? { ...row, text: row.text + chunk } : row,
      ),
    );
  };

  function schedulePoll(rowId: string) {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      void pollRow(rowId);
    }, POLL_INTERVAL_MS);
    timersRef.current.add(timer);
  }

  async function pollRow(rowId: string) {
    if (!aliveRef.current || !api.listRunEvents) return;
    const meta = pollsRef.current.get(rowId);
    if (!meta || meta.done) return;
    if (meta.polls >= MAX_POLLS) {
      meta.done = true;
      updateRow(rowId, { status: 'stillRunning' });
      return;
    }
    meta.polls += 1;
    try {
      const res = await api.listRunEvents(meta.runId, meta.sinceSeq, EVENT_LIMIT);
      if (!aliveRef.current) return;
      if (!res.ok || !res.data) {
        meta.done = true;
        updateRow(rowId, {
          status: 'failed',
          errorKey: chatErrorKey(res.status),
          errorCode: res.code,
        });
        return;
      }
      for (const ev of res.data.items) {
        if (!ev || typeof ev.seq !== 'number' || ev.seq <= meta.sinceSeq) continue;
        meta.sinceSeq = ev.seq;
        if (ev.eventType === 'message') {
          const text = eventText(ev);
          meta.hasText = true;
          if (text === null) {
            // D-2: render the redacted type name, never fabricate copy.
            console.warn('[ChatTab] message event without parseable text', ev.eventType);
            appendRowText(rowId, t('agentConsole.chat.messageUnreadable', { type: ev.eventType }));
          } else {
            appendRowText(rowId, text);
          }
        } else if (TERMINAL_STATUS[ev.eventType]) {
          // run.completed carries the final text in payload.output when no
          // message fragments were rendered (live Hermes shape, run15
          // evidence); adopt it instead of showing an empty reply.
          if (ev.eventType === 'completed' && !meta.hasText) {
            const out = ev.payload?.output;
            if (typeof out === 'string' && out !== '') {
              meta.hasText = true;
              appendRowText(rowId, out);
            }
          }
          meta.done = true;
          updateRow(rowId, {
            status: TERMINAL_STATUS[ev.eventType],
            reasonCode: reasonCodeOf(ev),
            emptyReply: ev.eventType === 'completed' && !meta.hasText,
          });
          return; // terminal ends this run's chain (design §2)
        }
        // started / unknown event types are ignored: derive nothing.
      }
      schedulePoll(rowId);
    } catch {
      if (!aliveRef.current) return;
      meta.done = true;
      updateRow(rowId, {
        status: 'failed',
        errorKey: 'agentConsole.chat.error.unavailable',
      });
    }
  }

  const dispatch = async (rowId: string, text: string, chatRequestKey: string) => {
    if (!api.sendChat) return;
    setSending((n) => n + 1);
    updateRow(rowId, { status: 'pending' });
    try {
      const input: ChatRequest = { employeeId, text, chatRequestKey };
      const res = await api.sendChat(input);
      if (!aliveRef.current) return;
      const runId = res.ok && res.data ? res.data.runId : undefined;
      if (res.ok && runId) {
        updateRow(rowId, { status: 'sent', runId });
        const assistantId = nextRowId();
        pollsRef.current.set(assistantId, {
          runId,
          sinceSeq: 0,
          polls: 0,
          hasText: false,
          done: false,
        });
        setRows((prev) => [
          ...prev,
          { id: assistantId, role: 'assistant', text: '', status: 'running', runId },
        ]);
        void pollRow(assistantId);
      } else {
        // Failed row keeps its chatRequestKey: retry reuses the SAME key,
        // so upstream idempotency cannot create a second run (design §1).
        updateRow(rowId, {
          status: 'failed',
          errorKey: chatErrorKey(res.status),
          errorCode: res.code,
        });
      }
    } catch {
      if (!aliveRef.current) return;
      updateRow(rowId, {
        status: 'failed',
        errorKey: 'agentConsole.chat.error.unavailable',
      });
    } finally {
      setSending((n) => Math.max(0, n - 1));
    }
  };

  const send = () => {
    const text = draft.trim();
    if (!text || !canChat) return;
    setDraft('');
    const id = nextRowId();
    const key = newChatRequestKey();
    setRows((prev) => [
      ...prev,
      { id, role: 'user', text, status: 'pending', chatRequestKey: key },
    ]);
    void dispatch(id, text, key);
  };

  const retry = (row: ChatRow) => {
    if (!row.chatRequestKey) return;
    updateRow(row.id, { status: 'pending', errorKey: undefined, errorCode: undefined });
    void dispatch(row.id, row.text, row.chatRequestKey);
  };

  const userStatusLabel = (status: UserStatus) =>
    status === 'pending'
      ? t('agentConsole.chat.status.pending')
      : status === 'sent'
        ? t('agentConsole.chat.status.sent')
        : t('agentConsole.chat.status.failed');

  const assistantLabel = (status: AssistantStatus) => {
    switch (status) {
      case 'running':
        return t('agentConsole.chat.status.running');
      case 'done':
        return t('agentConsole.chat.status.done');
      case 'failed':
        return t('agentConsole.chat.status.failed');
      case 'cancelled':
        return t('agentConsole.chat.status.cancelled');
      case 'interrupted':
        return t('agentConsole.chat.status.interrupted');
      case 'stillRunning':
      default:
        return t('agentConsole.chat.status.stillRunning');
    }
  };

  const assistantVocab: Record<AssistantStatus, string> = {
    running: 'running',
    done: 'completed',
    failed: 'failed',
    cancelled: 'cancelled',
    interrupted: 'interrupted',
    stillRunning: 'running',
  };

  if (!canChat) {
    // Design §4 degradation: adapter without the chat methods wired.
    return <StateView title={t('agentConsole.chat.notWired')} />;
  }

  return (
    <div className="flex w-full max-w-full flex-col gap-3">
      <div
        data-testid="agent-chat-list"
        className="flex max-h-[420px] flex-col gap-3 overflow-y-auto"
      >
        {rows.length === 0 ? (
          <StateView title={t('agentConsole.chat.empty')} />
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              data-testid={`agent-chat-row-${row.role}`}
              className="flex flex-col gap-1"
            >
              <div className="text-xs text-text-2">
                {row.role === 'user'
                  ? t('agentConsole.chat.roleUser')
                  : t('agentConsole.chat.roleAssistant')}
              </div>
              {row.role === 'user' ? (
                <div className="break-words whitespace-pre-wrap">{row.text}</div>
              ) : row.text ? (
                <div className="break-words whitespace-pre-wrap">{row.text}</div>
              ) : row.status === 'running' ? (
                <div className="text-sm text-text-2">{t('agentConsole.chat.status.running')}</div>
              ) : row.emptyReply ? (
                // completed with no message event: honest notice, no fake text.
                <div className="text-sm text-text-2">{t('agentConsole.chat.emptyReply')}</div>
              ) : row.status === 'stillRunning' ? (
                <div className="text-sm text-text-2">{t('agentConsole.chat.stillRunning')}</div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {row.role === 'user' ? (
                  <Tag
                    color={
                      row.status === 'sent'
                        ? 'success'
                        : row.status === 'failed'
                          ? 'danger'
                          : 'brand'
                    }
                  >
                    {userStatusLabel(row.status as UserStatus)}
                  </Tag>
                ) : (
                  <Tag color={runTagColor(assistantVocab[row.status as AssistantStatus])}>
                    {assistantLabel(row.status as AssistantStatus)}
                  </Tag>
                )}
                {row.runId ? (
                  <span title={row.runId}>
                    <Tag color="default">{row.runId}</Tag>
                  </span>
                ) : null}
                {row.status === 'failed' ? (
                  <>
                    <span className="break-all text-text-2">
                      {row.errorKey ? t(row.errorKey) : (row.errorCode ?? '')}
                    </span>
                    {row.role === 'user' ? (
                      <Button size="small" variant="link" onClick={() => retry(row)}>
                        {t('agentConsole.chat.retry')}
                      </Button>
                    ) : null}
                  </>
                ) : null}
                {row.role === 'assistant' && row.reasonCode ? (
                  <span className="break-all text-text-2">{row.reasonCode}</span>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Textarea
          rows={2}
          value={draft}
          placeholder={t('agentConsole.chat.inputPlaceholder')}
          textareaClassName="w-full resize-none"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter inserts a newline (design §3).
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="flex items-center justify-between">
          {bishengHref ? (
            <a
              href={bishengHref}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-primary underline"
            >
              {t('agentConsole.chat.openInBisheng')}
            </a>
          ) : (
            <span />
          )}
          <Button
            variant="filled"
            disabled={sending > 0 || draft.trim().length === 0}
            onClick={send}
          >
            {t('agentConsole.chat.send')}
          </Button>
        </div>
      </div>
    </div>
  );
}
