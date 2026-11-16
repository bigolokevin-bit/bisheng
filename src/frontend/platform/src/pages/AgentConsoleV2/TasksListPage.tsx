/* TSK-01 read-only task board — /agent/tasks.
 * Element-level build source: docs/validation/console/tasks-list/
 * PAGE-BUILD-CARD-TSK01.md (H/F/T/P/ST/FT blocks, A-01…A-37) with
 * tsk01-target.html as the single visual baseline. Read-only ONLY (§0.1):
 * no create / edit / transition / batch entry points; the row 「详情」 stays
 * a disabled placeholder while TSK-02 is unbuilt.
 *
 * Honesty rules carried from the card:
 * - T5 is the only list source; no total exists, so no 「共 N 条」 (A-28).
 * - 来源 is a client facet over loaded rows; it never enters a request
 *   (A-14), and the caliber line says so (F-07/A-16).
 * - A-02/Q4: 「全部」 with no other filter is sent as-is — NO client-side
 *   gate and NO silently added filter; a BFF/上游 400 renders via ST-03.
 * - P-03: cursor replay guard — a page overlapping the seen taskId set
 *   stops the walk with an explicit hint; never auto-returns to page 1.
 * - H-03: a failed refresh keeps the previous rows + 「未更新」 badge;
 *   filter/page errors replace the table body (ST-03) while filters and
 *   the cursor stack survive in the URL.
 * - ST-04/05: 403 shows the permission block; 401 defers to the shell
 *   re-login flow (kept as a minimal localized note — see VISUAL-CHECKLIST).
 * Machine codes (console.*, request.*, task.*) never reach the screen;
 * copy interpolates the HTTP status only (G15, same as APR-01). */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { userContext } from '@/contexts/userContext';

import {
  fetchEmployeesPage,
  fetchTasksPage,
  fmtId,
  fmtTime,
  makeFetcher,
  type ApiRes,
  type Fetcher,
  type TaskListBody,
  type TaskRow,
} from './v2Data';

/* A-01 (假定): page size fixed at 20, not exposed in the UI. */
const PAGE_LIMIT = 20;

/* F-02: exactly the five contract enums; unknown values get the defensive
 * neutral-pill + mono raw rendering of T-02 ⑤, never a guessed mapping. */
const TASK_STATUSES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'] as const;

/* VG FAIL-2 (observer 2026-11-16) five-state tones — no accent (blue-purple)
 * on any status: 待办 neutral gray, 进行中 warning amber, 受阻 danger red,
 * 已完成 success green, 已取消 neutral gray + 「—」 marker. */
const STATUS_TONE: Record<string, string> = {
  open: '',
  in_progress: 'is-warn',
  blocked: 'is-danger',
  done: 'is-ok',
  cancelled: '',
};

/* VG FAIL-2: filter-chip dots carry the SAME tone as the table pills. The
 * dot color is pinned per status so the shell's `.active` selected-chip
 * background can never repaint a dot into the accent hue. */
const STATUS_DOT: Record<string, string> = {
  open: 'dot-neutral',
  in_progress: 'dot-warn',
  blocked: 'dot-danger',
  done: 'dot-ok',
  cancelled: 'dot-neutral',
};

/* F-04: preset shortcuts ONLY — the request carries a single dueBefore
 * bound; there is no dueAfter in the contract and none is invented (A-13). */
const DUE_KEYS = ['7d', 'today', 'overdue'] as const;
type DueKey = (typeof DUE_KEYS)[number];

function isDueKey(v: string): v is DueKey {
  return (DUE_KEYS as readonly string[]).includes(v);
}

function dueBeforeIso(key: DueKey, now = Date.now()): string {
  if (key === '7d') return new Date(now + 7 * 86400000).toISOString();
  if (key === 'today') {
    // next 00:00 in Asia/Shanghai (+08:00, no DST)
    const sh = new Date(now + 8 * 3600000);
    return new Date(Date.UTC(sh.getUTCFullYear(), sh.getUTCMonth(), sh.getUTCDate() + 1) - 8 * 3600000).toISOString();
  }
  return new Date(now).toISOString(); // overdue: due_before = now
}

/* T-05 overdue caliber: non-terminal statuses only — blocked carries its own
 * semantic, done/cancelled never flag overdue (A-21). */
function isOverdue(r: TaskRow, now = Date.now()): boolean {
  if (r.status !== 'open' && r.status !== 'in_progress') return false;
  if (!r.dueAt) return false;
  const t = Date.parse(r.dueAt);
  return !Number.isNaN(t) && t < now;
}

/* E11 name resolution (card §2 ID/E11): 会话内缓存, single fetch per
 * session; failure resets so a later page can retry. Display-only — it
 * never adds filter semantics (F-03). */
let employeeNamesCache: Promise<Record<string, string>> | null = null;
function loadEmployeeNames(fetchApi: Fetcher): Promise<Record<string, string>> {
  if (!employeeNamesCache) {
    employeeNamesCache = fetchEmployeesPage(fetchApi, { limit: 200 })
      .then((res) => {
        if (!res.ok) {
          employeeNamesCache = null;
          return {};
        }
        const map: Record<string, string> = {};
        (res.data?.items ?? []).forEach((e) => {
          map[e.employeeId] = e.name;
        });
        return map;
      })
      .catch(() => {
        employeeNamesCache = null;
        return {};
      });
  }
  return employeeNamesCache;
}

/** split `employee:abc` / `human:9` → {type, bare}; bare id only, the bare
 *  prefix must never render as subject text (A-19). */
function splitRef(id: string | undefined): { type: string; bare: string } {
  if (!id) return { type: '', bare: '' };
  const idx = id.indexOf(':');
  return idx >= 0 ? { type: id.slice(0, idx), bare: id.slice(idx + 1) } : { type: '', bare: id };
}

function last6(id: string): string {
  return id ? `…${id.slice(-6)}` : '';
}

/* Inline Lucide-style icons (1.5px stroke, currentColor — the shell C1
 * audit forbids Unicode glyphs). */
const ICON_PATHS: Record<string, JSX.Element> = {
  refresh: (
    <>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.36 2.64L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.36-2.64L3 16" />
      <path d="M8 16H3v5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  cal: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" x2="16" y1="2" y2="6" />
      <line x1="8" x2="8" y1="2" y2="6" />
      <line x1="3" x2="21" y1="10" y2="10" />
    </>
  ),
  moveH: (
    <>
      <polyline points="18 8 22 12 18 16" />
      <polyline points="6 8 2 12 6 16" />
      <line x1="2" x2="22" y1="12" y2="12" />
    </>
  ),
  chevD: <path d="m6 9 6 6 6-6" />,
  chevL: <path d="m15 18-6-6 6-6" />,
  chevR: <path d="m9 18 6-6-6-6" />,
  msg: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  copy: (
    <>
      <rect width="14" height="14" x="8" y="8" rx="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </>
  ),
  inbox: (
    <>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
  alert: (
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  shield: (
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a2 2 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a2 2 0 0 1-1 1z" />
  ),
};

function Icon({ name, size = 14 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none' }}
    >
      {ICON_PATHS[name] ?? null}
    </svg>
  );
}

/* ---------- small popover (fsel dropdown, FilterBar V2.10 形态) ---------- */
interface FselProps {
  testid: string;
  label: string;
  display: string;
  icon?: string;
  disabled?: boolean;
  children: (close: () => void) => JSX.Element;
}

/* VG FAIL-1 (observer 2026-11-16): the source column is ALWAYS Chinese —
 * feishu→飞书消息, chat→对话, manual→手动创建, system→系统计划,
 * console→手动创建 (console-created rows are manual by caliber); any unknown
 * enum renders 「其他」 and the raw value survives only in the cell title.
 * A bare `console` (or any raw enum) must never reach the screen. */
const SRC_LABEL_KEY: Record<string, string> = {
  feishu: 'agentConsole.v2.tsk.srcFeishu',
  chat: 'agentConsole.v2.tsk.srcChat',
  manual: 'agentConsole.v2.tsk.srcManual',
  system: 'agentConsole.v2.tsk.srcSystem',
  console: 'agentConsole.v2.tsk.srcManual',
};

function Fsel({ testid, label, display, icon, disabled, children }: FselProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(false);
    };
    const onDown = (ev: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className="a2-btn"
        data-testid={testid}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        {icon ? <Icon name={icon} size={13} /> : null}
        {label} <b style={{ fontWeight: 500 }}>{display}</b>
        <Icon name="chevD" size={13} />
      </button>
      {open && (
        <div
          className="a2-card"
          role="menu"
          data-testid={`${testid}-menu`}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 20,
            minWidth: 208,
            padding: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </span>
  );
}

function MenuItem({
  active,
  onClick,
  children,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
      className={active ? 'a2-pill active' : undefined}
      style={{
        textAlign: 'left',
        padding: '6px 9px',
        borderRadius: 8,
        background: 'transparent',
        border: 'none',
        color: 'inherit',
        fontSize: 13,
      }}
      title={hint}
    >
      {children}
    </button>
  );
}

/* =================================================================== */

export function TasksListPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const fetchApi: Fetcher = useMemo(() => makeFetcher(), []);
  const ctx = useContext(userContext) as
    | { user?: { user_id?: number | string; user_name?: string; name?: string; username?: string } }
    | null;
  const uid = String(ctx?.user?.user_id ?? '');
  /* VG FAIL-3: identity display name — user_name first, name/username as
     fallbacks; the who cell falls back to 「我」, never the bare uid. */
  const userName = String(ctx?.user?.user_name || ctx?.user?.name || ctx?.user?.username || '');

  /* F-01 default scope=mine (假定 A-02); no uid ⇒ 「我的」 disabled with an
     explicit reason sentinel. */
  const scope = searchParams.get('scope') === 'all' ? 'all' : 'mine';
  const status = searchParams.get('status') ?? '';
  const assigneeFilter = searchParams.get('assignee') ?? '';
  const rawDue = searchParams.get('due') ?? '';
  const dueKey: DueKey | '' = isDueKey(rawDue) ? rawDue : '';
  /* F-05 来源 facet lives in the URL but is client-side only (A-14). */
  const sourceFacet = searchParams.get('source') ?? '';
  const cursor = searchParams.get('cursor') ?? '';
  /* fix C1b: q is a client-side filter over loaded rows only (never sent). */
  const q = searchParams.get('q') ?? '';

  const effAssignee = assigneeFilter || (scope === 'mine' && uid ? `human:${uid}` : '');

  const [reloadToken, setReloadToken] = useState(0);
  const [listRes, setListRes] = useState<ApiRes<TaskListBody> | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [curSig, setCurSig] = useState('');
  /* last successfully rendered page (H-03 keeps it across a failed refresh) */
  const [okView, setOkView] = useState<{ sig: string; items: TaskRow[]; nextCursor?: string } | null>(null);
  const [notUpdated, setNotUpdated] = useState(false);
  const [cursorStale, setCursorStale] = useState(false);
  const [freshAt, setFreshAt] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});
  /* fix C1b (L0 ruling 3): the follow-up rail is optional, default collapsed. */
  const [sideOpen, setSideOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState('');
  const pagesRef = useRef<string[]>(['']);
  const seenRef = useRef<Set<string>>(new Set());

  /* E11 display-name resolution (once per session, cached module-side). */
  useEffect(() => {
    let alive = true;
    loadEmployeeNames(fetchApi).then((m) => {
      if (alive) setNames(m);
    });
    return () => {
      alive = false;
    };
  }, [fetchApi]);

  const patchParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams);
      Object.entries(patch).forEach(([k, v]) => {
        if (v === null || v === '') next.delete(k);
        else next.set(k, v);
      });
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const resetWalk = () => {
    pagesRef.current = [''];
  };

  /* F-01/A-10: switching scope explicitly clears a manually picked assignee
     (nothing is silently dropped); the caliber line states the division. */
  const handleScope = (next: 'mine' | 'all') => {
    resetWalk();
    patchParams({
      scope: next === 'mine' ? null : next,
      assignee: null,
      cursor: null,
    });
  };

  const handleStatus = (value: string) => {
    resetWalk();
    patchParams({ status: value, cursor: null });
  };

  const handleAssignee = (value: string) => {
    resetWalk();
    patchParams({ assignee: value, cursor: null });
  };

  const handleDue = (value: string) => {
    resetWalk();
    patchParams({ due: value, cursor: null });
  };

  /* F-05: the source facet lives in the Fsel dropdown and writes the URL
     param directly — faceting never refetches, it re-filters loaded rows. */

  /* F-06/A-15: clear restores the default view (scope=mine, no extras) and
     never touches identity or theme. */
  const handleClear = () => {
    resetWalk();
    patchParams({
      scope: null,
      status: null,
      assignee: null,
      due: null,
      source: null,
      q: null,
      cursor: null,
    });
  };

  /* H-03/A-08: refresh re-sends the current filters + cursor stack home page. */
  const handleRetry = () => setReloadToken((n) => n + 1);

  const handleNextPage = () => {
    const nc = okView?.nextCursor;
    if (!nc || cursorStale) return;
    pagesRef.current.push(nc);
    patchParams({ cursor: nc });
  };

  const handlePrevPage = () => {
    if (pagesRef.current.length <= 1) return;
    pagesRef.current.pop();
    const prev = pagesRef.current[pagesRef.current.length - 1] ?? '';
    patchParams({ cursor: prev || null });
  };

  /* ---------- T5 fetch (always sent; A-02 forbids client gating) ---------- */
  useEffect(() => {
    let alive = true;
    const dueBefore = dueKey ? dueBeforeIso(dueKey) : '';
    const sig = `${effAssignee}|${status}|${dueBefore}|${cursor}|${PAGE_LIMIT}`;
    setCurSig(sig);
    setListLoading(true);
    fetchTasksPage(fetchApi, {
      assignee: effAssignee || undefined,
      status: status || undefined,
      dueBefore: dueBefore || undefined,
      limit: PAGE_LIMIT,
      cursor: cursor || undefined,
    }).then((res) => {
      if (!alive) return;
      setListRes(res);
      setListLoading(false);
      if (!res.ok) {
        /* H-03: a same-query failure (refresh) keeps the rows + badge;
           filter/page failures fall through to the ST-03 block below. */
        if (okView && okView.sig === sig) setNotUpdated(true);
        return;
      }
      const items = res.data?.items ?? [];
      setNotUpdated(false);
      setFreshAt(new Date().toISOString());
      if (cursor) {
        /* P-03/A-30: replay guard — any overlap with seen taskIds stops
           the walk; we keep the current page and say so. Never silently
           return to page one, never keep paging. */
        if (items.some((r) => seenRef.current.has(r.taskId))) {
          setCursorStale(true);
          setOkView((v) => (v ? { ...v, nextCursor: res.data?.nextCursor } : v));
          return;
        }
        items.forEach((r) => seenRef.current.add(r.taskId));
      } else {
        seenRef.current = new Set(items.map((r) => r.taskId));
        setCursorStale(false);
      }
      setOkView({ sig, items, nextCursor: res.data?.nextCursor });
    });
    return () => {
      alive = false;
    };
    // okView intentionally omitted: only `sig` from it is read, and adding
    // it would refetch on every state write (the guard stays correct because
    // sig already encodes the full query identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchApi, effAssignee, status, dueKey, cursor, reloadToken]);

  /* Esc collapses all expanded rows (T-09 ⑥). */
  useEffect(() => {
    if (expanded.size === 0) return undefined;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setExpanded(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const toggleExpanded = (taskId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const copyValue = (key: string, value: string) => {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(value).then(() => {
        setCopiedKey(key);
        window.setTimeout(() => setCopiedKey((c) => (c === key ? '' : c)), 1200);
      });
    }
  };

  /* ---------- status / label helpers ---------- */
  const statusText = (s: string) => {
    if ((TASK_STATUSES as readonly string[]).includes(s)) {
      return t(`agentConsole.v2.tsk.statusLabel.${s}`, s);
    }
    return null; // unknown enum → defensive mono rendering (T-02 ⑤)
  };

  /* VG FAIL-1: unknown channels read 「其他」 everywhere (facet, condition
     line, cells); the raw enum is kept for titles only. */
  const channelName = (ch: string) =>
    SRC_LABEL_KEY[ch] ? t(SRC_LABEL_KEY[ch]) : t('agentConsole.v2.tsk.srcOther');

  /* F-05 facet options come from what the loaded page actually carries —
     no speculative channels are pre-rendered (A-14 ⑤). Memoized so the
     derived useMemos below keep stable dependencies (lint: exhaustive-deps). */
  const okItems = useMemo(() => okView?.items ?? [], [okView]);
  const pageChannels = useMemo(() => {
    const set = new Set<string>();
    okItems.forEach((r) => {
      if (r.source?.channel) set.add(r.source.channel);
    });
    return Array.from(set).sort();
  }, [okItems]);

  /* fix C1b: source facet first, then the client-only q search (title/id). */
  const displayRows = useMemo(() => {
    const bySource = sourceFacet
      ? okItems.filter((r) => r.source?.channel === sourceFacet)
      : okItems;
    const needle = q.trim().toLowerCase();
    return needle
      ? bySource.filter(
          (r) =>
            (r.title ?? '').toLowerCase().includes(needle) ||
            (r.taskId ?? '').toLowerCase().includes(needle)
        )
      : bySource;
  }, [okItems, sourceFacet, q]);

  /* fix C1b (L0 ruling 3): rail rows derive from loaded data only. */
  const sideRows = useMemo(
    () => okItems.filter((r) => r.status === 'blocked' || isOverdue(r)),
    [okItems]
  );

  /* ---------- top-level states (ST-01…05) ---------- */
  const isAuth =
    listRes && !listRes.ok && (listRes.code === 'console.unauthenticated' || listRes.status === 401);
  const isForbidden =
    listRes && !listRes.ok && (listRes.code === 'console.forbidden' || listRes.status === 403);
  const isQueryError = listRes && !listRes.ok && !isAuth && !isForbidden && listRes.status === 400;
  const isTimeout = listRes && !listRes.ok && !isAuth && !isForbidden && listRes.status === 0;
  const isError = listRes && !listRes.ok && !isAuth && !isForbidden && !isQueryError && !isTimeout;
  /* H-03: refresh failed on the SAME query → rows + badge, no ST-03 block. */
  const refreshKeep =
    !!listRes && !listRes.ok && !isAuth && !isForbidden && notUpdated && okView !== null && curSig === okView.sig;

  const hasAnyFilter = Boolean(
    status || assigneeFilter || dueKey || sourceFacet || q.trim()
  );

  /* ST-02 条件行: the active server filters + facet, name = value pairs. */
  const conditionText = useMemo(() => {
    const parts: string[] = [];
    if (status) parts.push(`${t('agentConsole.v2.tsk.filterStatus')} = ${statusText(status) ?? status}`);
    if (assigneeFilter) {
      const { type, bare } = splitRef(assigneeFilter);
      const label =
        assigneeFilter === `human:${uid}`
          ? t('agentConsole.v2.tsk.assigneeSelf')
          : type === 'employee' && names[bare]
            ? names[bare]
            : bare || assigneeFilter;
      parts.push(`${t('agentConsole.v2.tsk.filterAssignee')} = ${label}`);
    }
    if (dueKey) parts.push(`${t('agentConsole.v2.tsk.filterDue')} = ${t(`agentConsole.v2.tsk.due${dueKey === '7d' ? '7d' : dueKey === 'today' ? 'Today' : 'Overdue'}`)}`);
    if (sourceFacet)
      parts.push(`${t('agentConsole.v2.tsk.filterSource')} = ${channelName(sourceFacet)}`);
    return parts.join(' · ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, status, assigneeFilter, dueKey, sourceFacet, names, uid]);

  /* assignee display for T-03 (A-19: never a bare `employee:`/`human:`).
     VG FAIL-3 (observer 2026-11-16): `human:<uid>` matching the current
     identity renders avatar initial + display name (identity user_name /
     name / username, fallback 「我」) + 「本人」 micro-badge — never the bare
     uid nor a `…1` fragment. Resolved employees show directory name + badge;
     the unresolved fallback is an em-dash. Any long id that must stay visible
     (other humans, no name endpoint) is ellipsized inside the cell with the
     full ref kept in the cell title — no id fragments are printed. */
  const assigneeView = (
    r: TaskRow,
  ): { nm: string; id: string; isMe: boolean; mono: boolean; roleKey: string } => {
    const { type, bare } = splitRef(r.assignee?.id);
    if (!bare) return { nm: '—', id: '', isMe: false, mono: false, roleKey: '' };
    const isMe = type === 'human' && uid !== '' && bare === uid;
    if (isMe) {
      return {
        nm: userName || t('agentConsole.v2.tsk.me'),
        id: '',
        isMe: true,
        mono: false,
        roleKey: 'agentConsole.v2.tsk.roleSelf',
      };
    }
    if (type === 'employee') {
      const name = names[bare];
      return name
        ? { nm: name, id: '', isMe: false, mono: false, roleKey: 'agentConsole.v2.tsk.roleEmployee' }
        : { nm: '—', id: '', isMe: false, mono: true, roleKey: 'agentConsole.v2.tsk.roleEmployee' };
    }
    // human others: no human-name endpoint — mono uid stays honest (ellipsis
    // + title in the cell), no role word, no fragment
    return { nm: bare, id: '', isMe: false, mono: true, roleKey: '' };
  };

  /* ---------- body by state ---------- */
  let body: JSX.Element;
  if (isForbidden) {
    /* ST-04/A-34: no retry bait, no task data anywhere on the page. */
    body = (
      <div className="a2-card" data-testid="agent-v2-tsk-403">
        <p className="a2-h2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="shield" size={16} />
          {t('agentConsole.v2.tsk.forbiddenTitle')}
        </p>
        <p className="a2-card-sub">{t('agentConsole.v2.tsk.forbiddenHint')}</p>
      </div>
    );
  } else if (isAuth) {
    /* ST-05: the shell owns the re-login flow; the page renders only a
       minimal localized note (deviation logged in VISUAL-CHECKLIST). */
    body = (
      <div className="a2-card" data-testid="agent-v2-tsk-auth">
        <p className="a2-h2">{t('agentConsole.auth.expired')}</p>
      </div>
    );
  } else if ((isQueryError || isTimeout || isError) && !refreshKeep) {
    /* ST-03/A-33: localized subject + (HTTP nnn) only; request id is a
       mono copyable auxiliary; retry re-sends this exact query. */
    const code = listRes?.status ?? 0;
    body = (
      <div className="a2-card" data-testid="agent-v2-tsk-error">
        <p className="a2-h2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="alert" size={16} />
          {isQueryError
            ? t('agentConsole.v2.tsk.errQuery')
            : isTimeout
              ? t('agentConsole.v2.tsk.errTimeout')
              : t('agentConsole.v2.tsk.errHttp', { code })}
        </p>
        <p className="a2-card-sub">{t('agentConsole.v2.tsk.errKeepNote')}</p>
        {listRes?.requestId && (
          <span className="a2-mono a2-micro" data-testid="agent-v2-tsk-error-reqid">
            <button
              type="button"
              className="a2-btn"
              aria-label={t('agentConsole.v2.tsk.reqIdAria')}
              onClick={() => copyValue('req', listRes.requestId as string)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <Icon name="copy" size={12} />
              {fmtId(listRes.requestId)}
            </button>
            {copiedKey === 'req' ? ` ${t('agentConsole.v2.tsk.copied')}` : ''}
          </span>
        )}
        <button type="button" className="a2-btn" data-testid="agent-v2-tsk-retry" onClick={handleRetry}>
          {t('agentConsole.v2.retry')}
        </button>
      </div>
    );
  } else if (listLoading && !okView && !refreshKeep) {
    /* ST-01/A-31: 6 pulse rows, no fake numbers; shell + filter bar stay. */
    body = (
      <div className="a2s-skeleton" data-testid="agent-v2-tsk-loading" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <span className="a2s-sk-row" key={i} />
        ))}
      </div>
    );
  } else if (okView && displayRows.length === 0 && !refreshKeep) {
    /* ST-02/A-32: the two empty variants are never mixed. */
    body = hasAnyFilter ? (
      <div className="a2-card" data-testid="agent-v2-tsk-empty-filtered">
        <p className="a2-h2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="inbox" size={16} />
          {t('agentConsole.v2.tsk.emptyFiltered')}
        </p>
        <p className="a2-card-sub" data-testid="agent-v2-tsk-empty-cond">
          {t('agentConsole.v2.tsk.emptyCond', { conditions: conditionText })}
        </p>
        <button type="button" className="a2-btn" onClick={handleClear}>
          {t('agentConsole.v2.tsk.clear')}
        </button>
      </div>
    ) : (
      <div className="a2-card" data-testid="agent-v2-tsk-empty-none">
        <p className="a2-h2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="inbox" size={16} />
          {t('agentConsole.v2.tsk.emptyNone')}
        </p>
      </div>
    );
  } else if (okView || refreshKeep) {
    const shown = refreshKeep ? (okView?.items ?? []) : displayRows;
    const shownNext = refreshKeep ? okView?.nextCursor : okView?.nextCursor;
    const tableCard = (
      <div className="a2-card" data-testid="agent-v2-tsk-table-card">
        <div className="a2-card-head">
          <span className="a2-h2">{t('agentConsole.v2.tsk.hdTitle')}</span>
          <span className="a2-pill">{t('agentConsole.v2.tsk.hdReadonly')}</span>
          <span className="a2-sp" />
          <span className="a2-micro" data-testid="agent-v2-tsk-order-note">
            {t('agentConsole.v2.tsk.hdOrder')}
          </span>
        </div>
        {refreshKeep && (
          <p className="a2-meta" data-testid="agent-v2-tsk-banner" role="status">
            {isQueryError
              ? t('agentConsole.v2.tsk.errQuery')
              : isTimeout
                ? t('agentConsole.v2.tsk.errTimeout')
                : t('agentConsole.v2.tsk.errHttp', { code: listRes?.status ?? 0 })}
            {' · '}
            {t('agentConsole.v2.tsk.errKeepNote')}
          </p>
        )}
        {cursorStale && (
          <p className="a2-meta" data-testid="agent-v2-tsk-cursor-stale" role="alert">
            {t('agentConsole.v2.tsk.cursorStale')}
            {' · '}
            <button type="button" className="a2-btn" onClick={handleRetry}>
              {t('agentConsole.v2.tsk.refresh')}
            </button>
          </p>
        )}
        <div className="a2-table-scroll">
          <table className="a2-table" data-testid="agent-v2-tsk-table">
            <thead>
              <tr>
                <th>{t('agentConsole.v2.tsk.colTask')}</th>
                <th>{t('agentConsole.v2.colStatus')}</th>
                <th>{t('agentConsole.v2.colOwner')}</th>
                <th>{t('agentConsole.v2.tsk.filterSource')}</th>
                <th>{t('agentConsole.tasks.colDueAt')}</th>
                <th>{t('agentConsole.v2.tsk.colUpdated')}</th>
                <th>{t('agentConsole.v2.tsk.colProgress')}</th>
                <th>{t('agentConsole.v2.tsk.colAction')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const av = assigneeView(r);
                const overdue = isOverdue(r);
                const isOpen = expanded.has(r.taskId);
                const stLabel = statusText(r.status);
                const prio = !r.priority ? 'normal' : r.priority;
                const prioKnown = prio === 'low' || prio === 'normal' || prio === 'high';
                return (
                  <FragmentRow
                    key={r.taskId}
                    r={r}
                    overdue={overdue}
                    isOpen={isOpen}
                    av={av}
                    stLabel={stLabel}
                    prio={prio}
                    prioKnown={prioKnown}
                    onToggle={() => toggleExpanded(r.taskId)}
                    onCopy={(val, key) => copyValue(key, val)}
                    copiedKey={copiedKey}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
        {/* P-01/P-02: mono page info, no total; cursor never on screen */}
        <div className="a2-card-head">
          <span className="a2-mono a2-micro" data-testid="agent-v2-tsk-page-info">
            {t('agentConsole.v2.tsk.pageInfo', { count: shown.length })}
            {!shownNext ? t('agentConsole.v2.tsk.lastPage') : ''}
          </span>
          <span className="a2-sp" />
          <button
            type="button"
            className="a2-btn"
            data-testid="agent-v2-tsk-prev"
            aria-label={t('agentConsole.v2.tsk.prevPage')}
            onClick={handlePrevPage}
            disabled={pagesRef.current.length <= 1}
          >
            <Icon name="chevL" size={14} />
          </button>
          <button
            type="button"
            className="a2-btn"
            data-testid="agent-v2-tsk-next"
            aria-label={t('agentConsole.v2.tsk.nextPage')}
            onClick={handleNextPage}
            disabled={!shownNext || cursorStale}
          >
            <Icon name="chevR" size={14} />
          </button>
        </div>
      </div>
    );
    /* fix C1b (L0 ruling 3): optional follow-up rail, derived from loaded rows
     * only, default collapsed, never fabricating a cross-page total. */
    body = (
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 480px', minWidth: 0 }}>{tableCard}</div>
        {sideOpen ? (
          <aside
            className="a2-card"
            data-testid="agent-v2-tsk-side"
            style={{
              flex: '0 1 256px',
              width: 256,
              minWidth: 220,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div>
              <span className="a2-h2">{t('agentConsole.v2.tsk.sideToggle')}</span>{' '}
              <span className="a2-micro">
                {t('agentConsole.v2.tsk.sideCount', { count: sideRows.length })}
              </span>
            </div>
            <p className="a2-micro">
              {t('agentConsole.v2.tsk.sideNote')} · {t('agentConsole.v2.tsk.loadedNote')}
            </p>
            {sideRows.length === 0 ? (
              <p className="a2-micro">{t('agentConsole.v2.tsk.sideEmpty')}</p>
            ) : (
              sideRows.map((r) => (
                <div
                  key={r.taskId}
                  data-testid="agent-v2-tsk-side-row"
                  style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                >
                  <span>
                    <span
                      className={`a2-pill${STATUS_TONE[r.status ?? ''] ? ` ${STATUS_TONE[r.status ?? '']}` : ''}`}
                    >
                      {statusText(r.status ?? '') ?? r.status ?? '—'}
                    </span>
                  </span>
                  <span
                    title={r.taskId}
                    style={{
                      maxWidth: 220,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {r.title}
                  </span>
                  <span className="a2-micro">
                    {r.statusReason
                      || r.progressNote
                      || (r.updatedAt
                        ? t('agentConsole.v2.tsk.noProgress', { time: fmtTime(r.updatedAt) })
                        : '—')}
                  </span>
                  {r.dueAt ? (
                    <span className={isOverdue(r) ? 'a2-mono a2-danger' : 'a2-mono'}>
                      {t('agentConsole.v2.tsk.due')} {fmtTime(r.dueAt)}
                    </span>
                  ) : null}
                </div>
              ))
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="a2-btn"
                data-testid="agent-v2-tsk-side-only-blocked"
                onClick={() => handleStatus('blocked')}
              >
                {t('agentConsole.v2.tsk.sideOnlyBlocked')}
              </button>
              <button
                type="button"
                className="a2-btn"
                data-testid="agent-v2-tsk-side-only-overdue"
                onClick={() => handleDue('overdue')}
              >
                {t('agentConsole.v2.tsk.sideOnlyOverdue')}
              </button>
            </div>
          </aside>
        ) : null}
      </div>
    );
  } else {
    /* initial load with nothing rendered yet */
    body = (
      <div className="a2s-skeleton" data-testid="agent-v2-tsk-loading" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <span className="a2s-sk-row" key={i} />
        ))}
      </div>
    );
  }

  /* F-07/A-16: the caliber line is ALWAYS present. */
  const caliberLine = hasAnyFilter
    ? `${t('agentConsole.v2.tsk.caliberServer')} · ${t('agentConsole.v2.tsk.caliberClient')}${
        sourceFacet ? ` · ${t('agentConsole.v2.tsk.srcNote')}` : ''
      }`
    : scope === 'mine'
      ? t('agentConsole.v2.tsk.caliberNone')
      : t('agentConsole.v2.tsk.caliberNoneAll');

  const assigneeDisplay = () => {
    if (!assigneeFilter) return t('agentConsole.v2.tsk.assigneeAny');
    if (assigneeFilter === `human:${uid}`) return t('agentConsole.v2.tsk.assigneeSelf');
    const { type, bare } = splitRef(assigneeFilter);
    if (type === 'employee' && names[bare]) return names[bare];
    return bare || assigneeFilter;
  };

  const dueDisplay = () => {
    if (!dueKey) return t('agentConsole.v2.tsk.dueAny');
    if (dueKey === '7d') return t('agentConsole.v2.tsk.due7d');
    if (dueKey === 'today') return t('agentConsole.v2.tsk.dueToday');
    return t('agentConsole.v2.tsk.dueOverdue');
  };

  return (
    <div className="a2s-page" data-testid="agent-v2-page-tasks">
      {/* ---- H-01…H-04 page head ---- */}
      <div className="a2-card-head">
        <div>
          <h1 className="a2-h1">{t('agentConsole.v2.navTasks')}</h1>
          <p className="a2-meta">{t('agentConsole.v2.tsk.desc')}</p>
        </div>
        <span className="a2-sp" />
        {/* G1 FAIL 5: baseline header right side carries ONE control — the
            warning-triangle follow-up toggle. No refresh button exists there. */}
        <button
          type="button"
          className="a2-btn"
          data-testid="agent-v2-tsk-side-toggle"
          aria-expanded={sideOpen}
          aria-controls="agent-v2-tsk-side"
          onClick={() => setSideOpen((v) => !v)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Icon name="alert" size={14} />
          {t('agentConsole.v2.tsk.sideToggle')}
          <Icon name="chevD" size={13} />
        </button>
      </div>
      <p className="a2-meta" data-testid="agent-v2-tsk-fresh" aria-live="polite">
        <Icon name="clock" size={13} /> {t('agentConsole.v2.tsk.freshAt', { time: freshAt ? fmtTime(freshAt) : '—' })}
        {notUpdated && (
          <span className="a2-pill is-warn" data-testid="agent-v2-tsk-not-updated" style={{ marginLeft: 8 }}>
            {t('agentConsole.v2.tsk.notUpdated')}
          </span>
        )}
        {' · '}
        {t('agentConsole.v2.tsk.caliberData')}
      </p>

      {/* ---- F-01…F-07 filter bar (ST-01: stays visible, disabled while loading) ---- */}
      <div className="a2-card" data-testid="agent-v2-tsk-filters">
        <div className="a2-chips">
          <div className="a2-chips" role="group" aria-label={t('agentConsole.v2.tsk.scopeGroup')}>
            <button
              type="button"
              className={`a2-pill${scope === 'mine' ? ' active' : ''}`}
              aria-pressed={scope === 'mine'}
              data-testid="agent-v2-tsk-scope-mine"
              disabled={!uid}
              title={!uid ? t('agentConsole.v2.tsk.scopeMineNoUid') : undefined}
              onClick={() => handleScope('mine')}
            >
              {t('agentConsole.v2.tsk.scopeMine')}
            </button>
            <button
              type="button"
              className={`a2-pill${scope === 'all' ? ' active' : ''}`}
              aria-pressed={scope === 'all'}
              data-testid="agent-v2-tsk-scope-all"
              title={t('agentConsole.v2.tsk.scopeAllNote')}
              onClick={() => handleScope('all')}
            >
              {t('agentConsole.v2.tsk.scopeAll')}
            </button>
          </div>

          {/* fix C1b (target §1.4): single-choice status chips mirror the T5 status param. */}
          <div
            className="a2-chips"
            role="group"
            aria-label={t('agentConsole.v2.tsk.filterStatus')}
            data-testid="agent-v2-tsk-status-chips"
          >
            {TASK_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={`a2-pill${status === s ? ' active' : ''}`}
                aria-pressed={status === s}
                data-testid={`agent-v2-tsk-chip-${s}`}
                onClick={() => handleStatus(status === s ? '' : s)}
              >
                {s === 'cancelled' ? (
                  <span className="a2-mono">—</span>
                ) : (
                  /* VG FAIL-2: chip dot = the table pill's status tone */
                  <span className={`a2-pill-dot ${STATUS_DOT[s]}`} aria-hidden />
                )}
                {t(`agentConsole.v2.tsk.statusLabel.${s}`, s)}{' '}
                <b>{okItems.filter((r) => r.status === s).length}</b>
              </button>
            ))}
          </div>

          {/* F-02 status */}
          <Fsel
            testid="agent-v2-tsk-filter-status"
            label={t('agentConsole.v2.tsk.filterStatus')}
            display={status ? statusText(status) ?? status : t('agentConsole.v2.tsk.statusAny')}
            disabled={listLoading}
          >
            {(close) => (
              <>
                <MenuItem
                  active={!status}
                  onClick={() => {
                    handleStatus('');
                    close();
                  }}
                >
                  {t('agentConsole.v2.tsk.statusAny')}
                </MenuItem>
                {TASK_STATUSES.map((s) => (
                  <MenuItem
                    key={s}
                    active={status === s}
                    onClick={() => {
                      handleStatus(s);
                      close();
                    }}
                  >
                    {t(`agentConsole.v2.tsk.statusLabel.${s}`, s)}
                  </MenuItem>
                ))}
              </>
            )}
          </Fsel>

          {/* F-03 assignee picker: self + E11 employees, literal values only */}
          <Fsel
            testid="agent-v2-tsk-filter-assignee"
            label={t('agentConsole.v2.tsk.filterAssignee')}
            display={assigneeDisplay()}
            disabled={listLoading}
          >
            {(close) => (
              <>
                <MenuItem
                  active={!assigneeFilter}
                  onClick={() => {
                    handleAssignee('');
                    close();
                  }}
                >
                  {t('agentConsole.v2.tsk.assigneeAny')}
                </MenuItem>
                {uid && (
                  <MenuItem
                    active={assigneeFilter === `human:${uid}`}
                    onClick={() => {
                      handleAssignee(`human:${uid}`);
                      close();
                    }}
                  >
                    {t('agentConsole.v2.tsk.assigneeSelf')}
                  </MenuItem>
                )}
                {Object.entries(names).map(([id, name]) => (
                  <MenuItem
                    key={id}
                    active={assigneeFilter === `employee:${id}`}
                    onClick={() => {
                      handleAssignee(`employee:${id}`);
                      close();
                    }}
                  >
                    {name} <span className="a2-mono a2-micro">{last6(id)}</span>
                  </MenuItem>
                ))}
              </>
            )}
          </Fsel>

          {/* F-04 due presets */}
          <Fsel
            testid="agent-v2-tsk-filter-due"
            label={t('agentConsole.v2.tsk.filterDue')}
            display={dueDisplay()}
            icon="cal"
            disabled={listLoading}
          >
            {(close) => (
              <>
                <MenuItem
                  active={!dueKey}
                  onClick={() => {
                    handleDue('');
                    close();
                  }}
                >
                  {t('agentConsole.v2.tsk.dueAny')}
                </MenuItem>
                <MenuItem
                  active={dueKey === '7d'}
                  hint={t('agentConsole.v2.tsk.dueTruncNote')}
                  onClick={() => {
                    handleDue('7d');
                    close();
                  }}
                >
                  {t('agentConsole.v2.tsk.due7d')}
                </MenuItem>
                <MenuItem
                  active={dueKey === 'today'}
                  hint={t('agentConsole.v2.tsk.dueTruncNote')}
                  onClick={() => {
                    handleDue('today');
                    close();
                  }}
                >
                  {t('agentConsole.v2.tsk.dueToday')}
                </MenuItem>
                <MenuItem
                  active={dueKey === 'overdue'}
                  hint={t('agentConsole.v2.tsk.dueTruncNote')}
                  onClick={() => {
                    handleDue('overdue');
                    close();
                  }}
                >
                  {t('agentConsole.v2.tsk.dueOverdue')}
                </MenuItem>
              </>
            )}
          </Fsel>

          {/* G1 FAIL 2: source is a dropdown next to 负责人/截止时间 (baseline
              structure), never a row of flat chips. Options come from what the
              loaded page actually carries (A-14 ⑤). */}
          <Fsel
            testid="agent-v2-tsk-source-fsel"
            label={t('agentConsole.v2.tsk.filterSource')}
            display={sourceFacet ? channelName(sourceFacet) : t('agentConsole.v2.tsk.sourceAny')}
            icon="msg"
            disabled={listLoading || pageChannels.length === 0}
          >
            {(close) => (
              <>
                <MenuItem
                  active={!sourceFacet}
                  onClick={() => {
                    patchParams({ source: null });
                    close();
                  }}
                >
                  {t('agentConsole.v2.tsk.sourceAny')}
                </MenuItem>
                {pageChannels.map((ch) => (
                  <MenuItem
                    key={ch}
                    active={sourceFacet === ch}
                    hint={t('agentConsole.v2.tsk.srcNote')}
                    onClick={() => {
                      patchParams({ source: ch });
                      close();
                    }}
                  >
                    {channelName(ch)}
                  </MenuItem>
                ))}
              </>
            )}
          </Fsel>

          {/* fix C1b (target §1.4): client-only search over loaded rows. */}
          <input
            type="search"
            className="a2-input"
            style={{ width: 260, maxWidth: '100%' }}
            data-testid="agent-v2-tsk-search"
            placeholder={t('agentConsole.v2.tsk.searchPh')}
            aria-label={t('agentConsole.v2.tsk.searchPh')}
            value={q}
            onChange={(e) => patchParams({ q: e.target.value || null })}
          />

          <span className="a2-sp" />
          {/* F-06 clear */}
          <button
            type="button"
            className="a2-btn"
            data-testid="agent-v2-tsk-clear"
            disabled={!hasAnyFilter || listLoading}
            title={!hasAnyFilter ? t('agentConsole.v2.tsk.clearDisabledTitle') : undefined}
            onClick={handleClear}
          >
            {t('agentConsole.v2.tsk.clear')}
          </button>
        </div>
        <p className="a2-micro" data-testid="agent-v2-tsk-result-count">
          {t('agentConsole.v2.tsk.resultCount', {
            shown: displayRows.length,
            loaded: okItems.length,
          })}
        </p>
        <p className="a2-micro" data-testid="agent-v2-tsk-caliber">
          {caliberLine}
        </p>
      </div>

      {body}

      {/* ---- FT-01 footer caliber ---- */}
      <div className="a2-card-head">
        <span className="a2-micro" data-testid="agent-v2-tsk-footer">
          {t('agentConsole.v2.tsk.footerCaliber')}
        </span>
        <span className="a2-sp" />
        <span className="a2-micro">{t('agentConsole.v2.tsk.footerKeys')}</span>
      </div>
      {/* VG FAIL-4 (375): the table scrolls inside its card while the page
          stays overflow-free — say so once, under the footer caliber. */}
      <p
        className="a2-micro"
        data-testid="agent-v2-tsk-scroll-hint"
        style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}
      >
        <Icon name="moveH" size={13} />
        {t('agentConsole.v2.tsk.footerScroll')}
      </p>
    </div>
  );
}

/* ---------- row + read-only expansion (T-09) ---------- */

interface AssigneeView {
  nm: string;
  id: string;
  isMe: boolean;
  mono: boolean;
}

interface RowProps {
  r: TaskRow;
  overdue: boolean;
  isOpen: boolean;
  av: AssigneeView;
  stLabel: string | null;
  prio: string;
  prioKnown: boolean;
  onToggle: () => void;
  onCopy: (value: string, key: string) => void;
  copiedKey: string;
}

function FragmentRow({ r, overdue, isOpen, av, stLabel, prio, prioKnown, onToggle, onCopy, copiedKey }: RowProps) {
  const { t } = useTranslation();
  const src = r.source ?? {};
  const expandedFields = buildExpandFields(t as (k: string, d?: string) => string, r);
  return (
    <>
      <tr data-testid="agent-v2-task-row" data-task-id={r.taskId}>
        <td>
          {/* T-01: expand chevron + truncated title + copyable short id */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <button
              type="button"
              className="a2-btn"
              aria-label={t(isOpen ? 'agentConsole.v2.tsk.collapse' : 'agentConsole.v2.tsk.expand')}
              aria-expanded={isOpen}
              data-testid="agent-v2-task-expand"
              onClick={onToggle}
              style={{ padding: '0 6px' }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                style={{ transform: isOpen ? 'rotate(180deg)' : undefined }}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <div style={{ minWidth: 0 }}>
              <div
                className="a2-cell-nowrap"
                style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={r.title}
                data-testid="agent-v2-task-title"
              >
                {prioKnown && prio === 'high' && (
                  <span
                    className="a2-pill a2-warn"
                    style={{ marginRight: 6, fontSize: 11, padding: '1px 6px' }}
                    data-testid="agent-v2-task-pri-chip"
                    title={t('agentConsole.tasks.priority.high', 'high')}
                  >
                    {t('agentConsole.v2.tsk.priHighChip')}
                  </span>
                )}
                {r.title ?? '—'}
              </div>
              <span className="a2-mono a2-micro" title={r.taskId}>
                <button
                  type="button"
                  onClick={() => onCopy(r.taskId, `t:${r.taskId}`)}
                  aria-label={t('agentConsole.v2.tsk.copyTaskId')}
                  style={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', padding: 0 }}
                >
                  {fmtId(r.taskId)}
                </button>
                {copiedKey === `t:${r.taskId}` ? ` ${t('agentConsole.v2.tsk.copied')}` : ''}
              </span>
            </div>
          </div>
        </td>
        {/* T-02 status pill: dot + localized text; title keeps the raw enum */}
        <td className="a2-cell-nowrap" data-testid="agent-v2-task-status" title={r.status}>
          {stLabel ? (
            <span className={`a2-pill${STATUS_TONE[r.status] ? ` ${STATUS_TONE[r.status]}` : ''}`}>
              {r.status === 'cancelled' ? (
                /* VG FAIL-2: 已取消 = neutral gray + 「—」, same as its chip */
                <span className="a2-mono">—</span>
              ) : (
                <span className={`a2-pill-dot ${STATUS_DOT[r.status] ?? ''}`} aria-hidden />
              )}
              {stLabel}
            </span>
          ) : (
            <span className="a2-pill">
              <span className="a2-mono">{r.status}</span>
            </span>
          )}
        </td>
        {/* T-03 assignee — VG FAIL-3: 20px initial avatar + display name +
            role micro-badge; long ids ellipsize in-cell, full ref in title */}
        <td className="a2-cell-nowrap" data-testid="agent-v2-task-assignee" title={r.assignee?.id}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', minWidth: 0 }}>
            {!av.mono && av.nm !== '—' && (
              <span className="a2-who-avatar" aria-hidden data-testid="agent-v2-task-assignee-avatar">
                {av.nm.slice(0, 1)}
              </span>
            )}
            <span
              className={av.mono ? 'a2-mono' : undefined}
              style={
                av.mono
                  ? {
                      maxWidth: 160,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      display: 'inline-block',
                      verticalAlign: 'bottom',
                    }
                  : undefined
              }
            >
              {av.nm}
            </span>
            {av.roleKey && (
              <span
                className="a2-pill"
                style={{ fontSize: 11, padding: '1px 8px', flex: 'none' }}
                data-testid="agent-v2-task-assignee-role"
              >
                {t(av.roleKey)}
              </span>
            )}
            {av.id ? <span className="a2-mono a2-micro">{` ${av.id}`}</span> : null}
          </span>
        </td>
        {/* T-06 source — VG FAIL-1: one Chinese channel line only; the raw
            enum and the message reference live in the title, never as a
            second-line sub-id. runId keeps its runs deep link. */}
        <td className="a2-cell-nowrap" data-testid="agent-v2-task-source">
          {src.channel ? (
            <div>
              <span
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                title={`channel=${src.channel}${src.messageId ? ` · ${src.messageId}` : ''}`}
              >
                <Icon name="msg" size={13} />
                {SRC_LABEL_KEY[src.channel]
                  ? t(SRC_LABEL_KEY[src.channel])
                  : t('agentConsole.v2.tsk.srcOther')}
              </span>
              {src.runId && (
                <NavLink
                  className="a2-mono a2-micro"
                  to={`/agent/runs?run=${encodeURIComponent(src.runId)}`}
                  title={t('agentConsole.v2.tsk.runLinkAria')}
                  aria-label={t('agentConsole.v2.tsk.runLinkAria')}
                  data-testid="agent-v2-task-run-link"
                >
                  {fmtId(src.runId)}
                </NavLink>
              )}
            </div>
          ) : (
            '—'
          )}
        </td>
        {/* T-05 due */}
        <td className="a2-cell-nowrap" data-testid="agent-v2-task-due" title={r.dueAt ?? undefined}>
          {r.dueAt ? (
            <>
              <span className={`a2-mono${overdue ? ' a2-danger-text' : ''}`}>{fmtTime(r.dueAt)}</span>
              {overdue && (
                <span className="a2-pill is-danger" style={{ marginLeft: 6, fontSize: 11, padding: '1px 8px' }}>
                  {t('agentConsole.v2.tsk.overdue')}
                </span>
              )}
            </>
          ) : (
            <span className="a2-meta">—</span>
          )}
        </td>
        {/* G1 FAIL 3: 最近更新 — baseline column, Asia/Shanghai MM-DD HH:mm */}
        <td
          className="a2-cell-nowrap"
          data-testid="agent-v2-task-updated"
          title={r.updatedAt ?? undefined}
        >
          {r.updatedAt ? fmtTime(r.updatedAt) : '—'}
        </td>
        {/* T-07 progress: single line; null AND empty string both render — */}
        <td data-testid="agent-v2-task-progress">
          <span
            className="a2-cell-nowrap"
            style={{ maxWidth: 220, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'bottom' }}
            title={r.progressNote || undefined}
          >
            {r.progressNote ? r.progressNote : '—'}
          </span>
        </td>
        {/* T-08 detail: disabled placeholder, no route (TSK-02 unbuilt) */}
        <td>
          <button
            type="button"
            className="a2-btn"
            data-testid="agent-v2-task-detail"
            disabled
            aria-disabled="true"
            title={t('agentConsole.v2.tsk.detailDisabled')}
            style={{ opacity: 0.4, boxShadow: 'none', cursor: 'not-allowed' }}
          >
            {t('agentConsole.v2.detail')}
          </button>
        </td>      </tr>
      {isOpen && (
        <tr data-testid="agent-v2-task-expanded" data-task-id={r.taskId}>
          <td colSpan={8}>
            {expandedFields.length === 0 ? (
              <span className="a2-meta">{t('agentConsole.v2.tsk.expNone')}</span>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12 }}>
                {expandedFields.map((f) => (
                  <div key={f.k} style={{ minWidth: 0, gridColumn: f.wide ? 'span 4' : undefined }}>
                    <span className="a2-micro">{f.k}</span>
                    <div className="a2-card-sub">{f.v}</div>
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

interface ExpField {
  k: string;
  v: string;
  wide?: boolean;
}

/* T-09/A-25: read-only expansion of fields T5 ALREADY returns. Nothing is
   fetched from T2 here; empty fields are simply not shown. */
function buildExpandFields(t: (k: string, d?: string) => string, r: TaskRow): ExpField[] {
  const fields: ExpField[] = [];
  if (r.description)
    fields.push({ k: t('agentConsole.v2.tsk.expDescription'), v: r.description, wide: true });
  if (r.progressNote) fields.push({ k: t('agentConsole.v2.tsk.expProgress'), v: r.progressNote, wide: true });
  if ((r.status === 'blocked' || r.status === 'cancelled') && r.statusReason)
    fields.push({ k: t('agentConsole.v2.tsk.expReason'), v: r.statusReason, wide: true });
  if (r.source) {
    const parts: string[] = [];
    if (r.source.channel) parts.push(r.source.channel);
    if (r.source.conversationRef) parts.push(`${t('agentConsole.v2.tsk.expConversation')}: ${r.source.conversationRef}`);
    if (r.source.messageId) parts.push(r.source.messageId);
    if (r.source.runId) parts.push(`run: ${r.source.runId}`);
    if (parts.length) fields.push({ k: t('agentConsole.v2.tsk.expSource'), v: parts.join(' · ') });
  }
  const tl: string[] = [];
  if (r.createdAt) tl.push(`${t('agentConsole.v2.tsk.expCreated')} ${fmtTime(r.createdAt)}`);
  if (r.updatedAt) tl.push(`${t('agentConsole.v2.tsk.expUpdated')} ${fmtTime(r.updatedAt)}`);
  if (r.closedAt) tl.push(`${t('agentConsole.v2.tsk.expClosed')} ${fmtTime(r.closedAt)}`);
  if (tl.length) fields.push({ k: t('agentConsole.v2.tsk.expTimeline'), v: tl.join(' · ') });
  if (r.employeeVersionRef)
    fields.push({ k: t('agentConsole.v2.tsk.expVersion'), v: r.employeeVersionRef });
  if (r.relatedTaskIds?.length)
    fields.push({ k: t('agentConsole.v2.tsk.expRelated'), v: r.relatedTaskIds.map((id) => fmtId(id)).join(' · ') });
  return fields;
}
