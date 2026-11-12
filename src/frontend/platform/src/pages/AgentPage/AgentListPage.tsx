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
