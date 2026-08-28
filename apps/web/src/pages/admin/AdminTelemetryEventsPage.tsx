import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PageHeader from '@/components/common/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import TablePagination, { type PageSize } from '@/components/datatable/TablePagination';
import TelemetryEventsTable from '@/components/admin/TelemetryEventsTable';
import TelemetryFilters, { type TelemetryFiltersValue } from '@/components/admin/TelemetryFilters';
import { filterWindow } from '@/components/admin/telemetry-range';
import { useTelemetryEvents, type TelemetryEventFilters } from '@/hooks/useAdminTelemetry';

/**
 * The raw telemetry stream — every recorded event, filterable and paginated.
 *
 * This is the drill-down the charts point at: the overview says "events spiked
 * at 14:00", and this page says which ones.
 *
 * ── THE FEED DEFAULTS TO ALL TIME ───────────────────────────────────────────
 * Unlike every chart in this package, and unlike the four aggregation
 * endpoints, `/events` applies no implicit window. The feed's job is "find the
 * event I am looking for", and a hidden 24-hour default turns "I cannot find
 * last month's login" into a support ticket. The window is a filter the reader
 * opts into.
 *
 * ── FILTER CHANGES RESET TO PAGE 1 ──────────────────────────────────────────
 * Narrowing to `task_created` while on page 7 of the unfiltered feed would
 * otherwise land on a page that no longer exists, which renders as an empty
 * table that looks exactly like "there are no such events". `commit()` is the
 * single place both the filters and the page size go through, so the reset
 * cannot be forgotten at one call site.
 *
 * ── PAGINATION LIVES IN THE ENVELOPE ────────────────────────────────────────
 * `meta` comes back beside `data`, never inside it, so the footer's range
 * ("1–25 of 312") is the server's count rather than `rows.length` — which on a
 * short last page would say "25" for twelve rows.
 */

const DEFAULT_PAGE_SIZE: PageSize = 25;

export default function AdminTelemetryEventsPage() {
  const { t } = useTranslation(['admin', 'common']);

  const [filters, setFilters] = useState<TelemetryFiltersValue>({
    type: undefined,
    preset: 'all',
    userId: undefined,
    userName: undefined,
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);

  /**
   * The filter bar's state → the endpoint's query parameters.
   *
   * Memoized on the filter identity because the result is part of the query
   * key: a fresh object every render would be a fresh key every render, and the
   * feed would refetch forever.
   */
  const query = useMemo((): TelemetryEventFilters => {
    const window = filterWindow(filters.preset);
    return {
      // The contract is multi-value; the control offers one at a time.
      type: filters.type === undefined ? undefined : [filters.type],
      userId: filters.userId,
      from: window?.from,
      to: window?.to,
    };
  }, [filters]);

  const events = useTelemetryEvents(query, { page, pageSize });
  const rows = events.data?.rows ?? [];

  /** Every filter change goes through here — see the header on the page reset. */
  const commit = (next: TelemetryFiltersValue): void => {
    setFilters(next);
    setPage(1);
  };

  return (
    <>
      <PageHeader title={t('admin:events.title')} description={t('admin:events.description')}>
        <TelemetryFilters value={filters} onChange={commit} />
      </PageHeader>

      <Card className="flex flex-col gap-2 p-[var(--card-pad)]">
        {events.error ? (
          <ErrorState
            error={events.error}
            onRetry={() => void events.refetch()}
            className="py-10"
          />
        ) : events.isPending ? (
          <div className="flex flex-col gap-2" data-testid="telemetry-events-skeleton">
            {SKELETON_ROWS.map((width) => (
              <Skeleton key={width} className="h-7" style={{ width: `${width}%` }} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={t('admin:events.empty')}
            message={t('admin:events.emptyBody')}
            className="py-10"
          />
        ) : (
          <TelemetryEventsTable
            rows={rows}
            onFilterUser={(userId) => {
              const match = rows.find((row) => row.userId === userId);
              commit({ ...filters, userId, userName: match?.userName ?? undefined });
            }}
          />
        )}

        <TablePagination
          meta={events.data?.meta}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(next) => {
            setPageSize(next);
            // A different page size renumbers every page; page 7 of 25 is not
            // page 7 of 100.
            setPage(1);
          }}
        />
      </Card>
    </>
  );
}

/** A ragged profile — an even one reads as a loaded table. */
const SKELETON_ROWS = [100, 96, 88, 92, 84, 90, 80] as const;
