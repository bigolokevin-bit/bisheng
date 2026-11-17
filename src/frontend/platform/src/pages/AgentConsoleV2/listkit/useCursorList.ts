/**
 * Shared cursor-pagination hook for the console list suite (RUN-01 first
 * consumer; TSK-01/MET-01 reuse).
 *
 * 无总数口径: the upstream page carries only `items` + `nextCursor` — no
 * total, no page numbers, no 「上一页」. Advancing is ALWAYS an explicit
 * button action (loadNext); nothing auto-loads.
 *
 * 防重放守卫 (RUN01-TARGET-SPEC §7, first red line): upstream answers an
 * invalid/expired cursor with a SILENT first-page 200, not a 4xx. So every
 * page's runId set is remembered; if a newly fetched page intersects ANY
 * seen page (including page 1), the hook stops merging, raises `stale`, and
 * waits for the user's explicit 「重新加载第一页」 (reloadFirst). It never
 * silently resets and never issues a third automatic request.
 *
 * Known limitation (honest, spec §7.6): a cursor restored from the URL is a
 * fresh first request with an empty seen-set — an upstream first-page replay
 * is then undetectable. That is upstream semantics, not a page-local guess.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { AuthError, type ApiResult } from '@/controllers/API/agent';

export interface CursorPage<T> {
  items: T[];
  nextCursor?: string | null;
}

/**
 * S4 additions on top of `ApiResult`: an optional `requestId` (shown on the
 * error screens — absent reads 「未提供」, never silence) and the 10s loading
 * watchdog (`LOADING_LIMIT_MS`): a first page still loading after that long
 * flips the screen to the honest 「本次未能读取」 error state + retry, so no
 * skeleton can spin forever on a hung request. A late success still lands
 * and replaces the error screen.
 */
export type CursorFetchResult<T> = ApiResult<CursorPage<T>> & { requestId?: string };

export type CursorFetch<T> = (cursor: string | null) => Promise<CursorFetchResult<T>>;

export type ListPhase = 'loading' | 'ok' | 'error' | 'forbidden';

export const LOADING_LIMIT_MS = 10_000;

export interface CursorListState<T> {
  phase: ListPhase;
  items: T[];
  /** HTTP status of the failed first-page request (0 = network failure). */
  httpStatus: number;
  /** S4: the failed/served request's id when the gateway supplied one. */
  requestId: string | null;
  nextCursor: string | null;
  /** Replay guard tripped: a fetched page overlapped a seen page. */
  stale: boolean;
  loadingMore: boolean;
  /** HTTP status of a failed next-page request (items stay on screen). */
  nextError: number | null;
  loadNext: () => void;
  /** Explicit user action — the ONLY way back to page 1 after stale. */
  reloadFirst: () => void;
}

interface Options<T> {
  fetchPage: CursorFetch<T>;
  keyOf: (item: T) => string;
  /** Changing this signature resets seen-pages/cursor and re-queries page 1. */
  resetKey: string;
  /** Cursor restored from the URL (treated as a fresh first request). */
  initialCursor?: string | null;
  /** 401 (AuthError) — the page decides the login redirect. */
  onAuth?: () => void;
}

export function useCursorList<T>({
  fetchPage,
  keyOf,
  resetKey,
  initialCursor,
  onAuth,
}: Options<T>): CursorListState<T> {
  const [phase, setPhase] = useState<ListPhase>('loading');
  const [items, setItems] = useState<T[]>([]);
  const [httpStatus, setHttpStatus] = useState(0);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextError, setNextError] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  /** One Set of row keys per accepted page — the replay-guard memory. */
  const seenRef = useRef<Array<Set<string>>>([]);
  const liveRef = useRef(true);
  const busyRef = useRef(false);

  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const keyRef = useRef(keyOf);
  keyRef.current = keyOf;
  const authRef = useRef(onAuth);
  authRef.current = onAuth;
  const initialCursorRef = useRef(initialCursor);
  initialCursorRef.current = initialCursor;
  /** reloadFirst must query page 1 even if the URL still carries a cursor. */
  const skipInitialCursorRef = useRef(false);

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  // First page (or filter change / explicit reload). Filter changes clear the
  // seen-page memory and the cursor (spec §7.5).
  useEffect(() => {
    let live = true;
    let settled = false;
    seenRef.current = [];
    busyRef.current = true;
    setPhase('loading');
    setItems([]);
    setHttpStatus(0);
    setRequestId(null);
    setNextCursor(null);
    setStale(false);
    setNextError(null);
    setLoadingMore(false);
    const cursor = skipInitialCursorRef.current ? null : (initialCursorRef.current ?? null);
    skipInitialCursorRef.current = false;
    /* S4 loading watchdog: still pending after LOADING_LIMIT_MS ⇒ honest
       「本次未能读取」 error screen with retry. No second request is fired. */
    const watchdog = window.setTimeout(() => {
      if (!live || settled) return;
      setHttpStatus(0);
      setPhase('error');
    }, LOADING_LIMIT_MS);
    fetchRef
      .current(cursor)
      .then((res) => {
        window.clearTimeout(watchdog);
        if (!live) return;
        settled = true;
        busyRef.current = false;
        setRequestId(res.requestId ?? null);
        if (res.ok && res.data && Array.isArray(res.data.items)) {
          seenRef.current = [new Set(res.data.items.map((it) => keyRef.current(it)))];
          setItems(res.data.items);
          setNextCursor(res.data.nextCursor ?? null);
          setPhase('ok');
        } else if (!res.ok && (res.status === 403 || res.status === 404)) {
          // 404 (cross-tenant / missing) renders the SAME body as 403 —
          // never leak existence (spec §1.6).
          setHttpStatus(res.status);
          setPhase('forbidden');
        } else {
          setHttpStatus(res.ok ? 0 : res.status);
          setPhase('error');
        }
      })
      .catch((e: unknown) => {
        window.clearTimeout(watchdog);
        if (!live) return;
        settled = true;
        busyRef.current = false;
        // S4.5: a thrown adapter error can still carry the gateway id.
        setRequestId((e as { requestId?: string } | null)?.requestId ?? null);
        if (e instanceof AuthError) {
          authRef.current?.();
          return;
        }
        setHttpStatus(0);
        setPhase('error');
      });
    return () => {
      live = false;
      window.clearTimeout(watchdog);
    };
  }, [resetKey, nonce]);

  const loadNext = useCallback(() => {
    if (busyRef.current || stale) return;
    const cursor = nextCursor;
    if (!cursor) return;
    busyRef.current = true;
    let settled = false;
    setLoadingMore(true);
    setNextError(null);
    /* S4: same 10s cap on the next page — the button becomes the retry. */
    const watchdog = window.setTimeout(() => {
      if (!liveRef.current || settled) return;
      settled = true;
      busyRef.current = false;
      setLoadingMore(false);
      setNextError(0);
    }, LOADING_LIMIT_MS);
    fetchRef
      .current(cursor)
      .then((res) => {
        window.clearTimeout(watchdog);
        if (!liveRef.current) return;
        settled = true;
        busyRef.current = false;
        setLoadingMore(false);
        setRequestId(res.requestId ?? null);
        if (res.ok && res.data && Array.isArray(res.data.items)) {
          const keys = res.data.items.map((it) => keyRef.current(it));
          const overlaps = seenRef.current.some((seen) => keys.some((k) => seen.has(k)));
          if (overlaps) {
            // Guard: do NOT merge, do NOT auto-retry, do NOT silently reset.
            setStale(true);
            return;
          }
          seenRef.current = [...seenRef.current, new Set(keys)];
          setItems((prev) => [...prev, ...res.data!.items]);
          setNextCursor(res.data.nextCursor ?? null);
        } else if (!res.ok && (res.status === 403 || res.status === 404)) {
          setHttpStatus(res.status);
          setPhase('forbidden');
        } else {
          // A failed next page keeps the rows already on screen; the same
          // button becomes the retry (no cached-data lie, no full reset).
          setNextError(res.ok ? 0 : res.status);
        }
      })
      .catch((e: unknown) => {
        window.clearTimeout(watchdog);
        if (!liveRef.current) return;
        settled = true;
        busyRef.current = false;
        setLoadingMore(false);
        setRequestId((e as { requestId?: string } | null)?.requestId ?? null);
        if (e instanceof AuthError) {
          authRef.current?.();
          return;
        }
        setNextError(0);
      });
  }, [nextCursor, stale]);

  const reloadFirst = useCallback(() => {
    skipInitialCursorRef.current = true;
    setNonce((n) => n + 1);
  }, []);

  return {
    phase,
    items,
    httpStatus,
    requestId,
    nextCursor,
    stale,
    loadingMore,
    nextError,
    loadNext,
    reloadFirst,
  };
}