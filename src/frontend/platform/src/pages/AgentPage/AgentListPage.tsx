import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, SearchInput, StateView } from '@bisheng/ui';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/bs-ui/table';
import { LoadingIcon } from '@/components/bs-icons/loading';
import type { AgentConsoleApi, EmployeeSummary } from '@/controllers/API/agent';
import { StatusChip } from './StatusChip';

export interface AgentListPageProps {
  api: AgentConsoleApi;
  /** E11 default page size is 20; overridable for tests. */
  pageSize?: number;
  onSelect?: (employeeId: string) => void;
}

/**
 * Small-viewport flag for the card/table layout switch.
 * Falls back to false when `matchMedia` is unavailable (jsdom/SSR).
 */
function useIsNarrow(): boolean {
  const query = '(max-width: 639px)';
  const [narrow, setNarrow] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mql = window.matchMedia(query);
    const handleChange = () => setNarrow(mql.matches);
    if (typeof mql.addEventListener !== 'function') {
      return undefined;
    }
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);
  return narrow;
}

/**
 * Read-only employee list shell (E11 EmployeeSummary).
 * Cursor pagination placeholder: E11 returns no `total`, so we offer
 * "load more" on `nextCursor` instead of numbered paging.
 */
export function AgentListPage({ api, pageSize = 20, onSelect }: AgentListPageProps) {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState('');
  const [rows, setRows] = useState<EmployeeSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<{ code?: string } | null>(null);
  const reqSeq = useRef(0);
  const narrow = useIsNarrow();

  const load = useCallback(
    async (kw: string, cursor?: string) => {
      const seq = ++reqSeq.current;
      setLoading(true);
      try {
        const res = await api.listEmployees({
          keyword: kw || undefined,
          limit: pageSize,
          cursor,
        });
        if (seq !== reqSeq.current) return;
        setError(null);
        setRows((prev) => (cursor ? [...prev, ...res.items] : res.items));
        setNextCursor(res.nextCursor);
      } catch {
        if (seq !== reqSeq.current) return;
        setError({ code: 'agent.list.request_failed' });
      } finally {
        if (seq === reqSeq.current) {
          setLoading(false);
          setLoaded(true);
        }
      }
    },
    [api, pageSize],
  );

  useEffect(() => {
    void load(keyword, undefined);
  }, [keyword, load]);

  const handleLoadMore = () => {
    if (nextCursor) void load(keyword, nextCursor);
  };

  return (
    <div className="w-full max-w-full">
      <div className="mb-3 w-full max-w-[320px]">
        <SearchInput
          placeholder={t('agentConsole.list.searchPlaceholder')}
          onSearch={setKeyword}
        />
      </div>
      <div className="relative w-full" aria-busy={loading}>
        {loading && rows.length === 0 && (
          <div
            data-testid="agent-list-loading"
            className="absolute w-full h-full top-0 left-0 flex justify-center items-center z-10 bg-[rgba(255,255,255,0.6)] dark:bg-blur-shared"
          >
            <LoadingIcon />
          </div>
        )}
        {error ? (
          <StateView
            title={t('agentConsole.list.error')}
            description={error.code ?? ''}
            action={
              <Button variant="outlined" onClick={() => void load(keyword)}>
                {t('agentConsole.list.retry')}
              </Button>
            }
          />
        ) : rows.length > 0 ? (
          <>
            {narrow ? (
              <ul data-testid="agent-list-cards" className="m-0 flex list-none flex-col gap-2 p-0">
                {rows.map((e) => (
                  <li key={e.employeeId} className="min-w-0 rounded border border-border-base p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 break-words font-medium">{e.name}</div>
                      <StatusChip state={e.lifecycleState} />
                    </div>
                    <div className="mt-1 break-words text-sm text-text-2">{e.title}</div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-sm text-text-2">
                      <div className="min-w-0 break-all">{e.ownerUserId}</div>
                      <div className="shrink-0">{e.updatedAt.replace('T', ' ').replace('Z', '')}</div>
                    </div>
                    <div className="mt-2 flex justify-end">
                      <Button
                        size="small"
                        variant="link"
                        onClick={() => onSelect?.(e.employeeId)}
                      >
                        {t('agentConsole.list.detail')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[220px]">{t('agentConsole.list.colName')}</TableHead>
                  <TableHead>{t('agentConsole.list.colTitle')}</TableHead>
                  <TableHead>{t('agentConsole.list.colLifecycle')}</TableHead>
                  <TableHead>{t('agentConsole.list.colOwner')}</TableHead>
                  <TableHead>{t('agentConsole.list.colUpdatedAt')}</TableHead>
                  <TableHead className="text-right">{t('agentConsole.list.colAction')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.employeeId}>
                    <TableCell className="font-medium max-w-[220px] min-w-0">
                      <div className="break-all">{e.name}</div>
                    </TableCell>
                    <TableCell className="max-w-[220px] min-w-0">
                      <div className="break-all">{e.title}</div>
                    </TableCell>
                    <TableCell>
                      <StatusChip state={e.lifecycleState} />
                    </TableCell>
                    <TableCell className="max-w-[160px] min-w-0">
                      <div className="break-all">{e.ownerUserId}</div>
                    </TableCell>
                    <TableCell>{e.updatedAt.replace('T', ' ').replace('Z', '')}</TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button
                          size="small"
                          variant="link"
                          onClick={() => onSelect?.(e.employeeId)}
                        >
                          {t('agentConsole.list.detail')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            )}
            {loading && (
              <div className="flex justify-center py-2">
                <LoadingIcon className="size-8" />
              </div>
            )}
            {nextCursor && !loading && (
              <div className="flex justify-center py-2">
                <Button variant="filled" onClick={handleLoadMore}>
                  {t('agentConsole.list.loadMore')}
                </Button>
              </div>
            )}
            <div className="mt-2 text-sm text-text-2">
              {t('agentConsole.list.cursorNote')}
            </div>
          </>
        ) : loaded ? (
          <StateView
            title={t('agentConsole.list.empty')}
            description={t('agentConsole.list.emptyHint')}
          />
        ) : null}
      </div>
    </div>
  );
}
