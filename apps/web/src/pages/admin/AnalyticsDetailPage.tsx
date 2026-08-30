import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import { analyticsDomainSchema } from '@flowboard/shared';

import { useApiErrorMessage } from '@/i18n/errors';
import { csvFilename, toCsv, type CsvRow } from '@/lib/csv';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { SectionHeader } from '@/components/dashboard/SectionHeader';
import { RangePicker } from '@/components/dashboard/RangePicker';
import { PanelCard } from '@/components/dashboard/PanelCard';
import { DataTable, col, type FacetDef, type SortState } from '@/components/dashboard/DataTable';
import { downloadCsvBlob } from '@/components/dashboard/save-blob';
import { DEFAULT_RANGE, windowFor, type RangeValue } from '@/components/dashboard/range';
import MetricChart, { pointRows, pointSeries } from '@/components/admin/analytics/MetricChart';
import {
  DOMAIN_LABEL_KEYS,
  INTERVAL_LABEL_KEYS,
  lookupMetric,
  optionsOf,
  type MetricPage,
  type MetricRow,
  type MetricTranslate,
} from '@/components/admin/analytics/metric-registry';
import { HOURLY_UP_TO_DAYS } from '@/stores/useAnalyticsStore';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The ONE drill-down page: `/admin/analytics/:domain/:metric`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every KPI tile and every chart in the console links here, and the shape of
 * the page — range picker, chart, facet row, table, CSV — is identical
 * whichever metric asked for it. What differs (title, loader, columns, facets,
 * export) is looked up in `metric-registry`, so adding a drill-down is a
 * registry entry rather than a page.
 *
 * ═══ AN UNKNOWN PAIR IS A CARD, NOT A CRASH ══════════════════════════════
 *
 * These are URLs people bookmark, paste into incident channels and keep after a
 * metric is renamed. A stale one renders a friendly not-found with a way back,
 * because a blank screen tells the reader nothing about whether the link is
 * wrong or the console is broken. The `:domain` segment is parsed against
 * `analyticsDomainSchema` as well as looked up, so `/admin/analytics/overview/x`
 * — a domain that deliberately has no registry — lands here too.
 *
 * ═══ THE RANGE IS LOCAL, AND THAT IS DELIBERATE ══════════════════════════
 *
 * The four dashboards share one window (`useAnalyticsStore`) because they are
 * one investigation. A drill-down is a DIFFERENT investigation — "the spike, up
 * close" — and widening to 90d to find its shape must not silently rewrite the
 * window on the dashboard you will click Back to.
 *
 * ═══ CLIENT-PAGED, SERVER-SHAPED ═════════════════════════════════════════
 *
 * The table is handed a `meta`, which puts `DataTable` in MANUAL mode — so
 * TanStack never sorts anything here. The sort state travels back into
 * `definition.fetch`, which orders the whole filtered row set BEFORE it slices
 * a page (see `sortRows` in the registry). Letting the grid sort would only
 * reorder the twenty-five rows already on screen, and page 2 of a sort would be
 * a reshuffle rather than the real page 2.
 *
 * Every filter, sort and range change resets to page 1 — narrowing while on
 * page 7 otherwise lands on a page that no longer exists, which renders as an
 * empty table indistinguishable from "there is nothing here".
 *
 * ═══ THE EXPORT IS THE WHOLE FILTERED SET ════════════════════════════════
 *
 * Not the page. `MetricPage.exportRows` carries every row the facets matched,
 * in sort order; the CSV is built from the registry's own columns so the file's
 * headers are the table's headers, translated. No server endpoint is involved —
 * these payloads are bounded, and inventing a `/export.csv` route for data the
 * browser already holds would be a second source of truth for the same rows.
 */

const EMPTY_PAGE: MetricPage = {
  points: [],
  rows: [],
  exportRows: [],
  facetOptions: {},
  total: 0,
  page: 1,
  pageSize: 25,
};

type Status = 'idle' | 'loading' | 'ready' | 'error';

export default function AnalyticsDetailPage() {
  const { domain, metric } = useParams<{ domain: string; metric: string }>();
  const definition = lookupMetric(domain, metric);
  const { t } = useTranslation(['analytics', 'admin', 'common']);
  const describeError = useApiErrorMessage();
  // The registry stores i18n KEYS, not copy — one cast, see `MetricTranslate`.
  const tk = t as unknown as MetricTranslate;

  const [range, setRange] = useState<RangeValue>(DEFAULT_RANGE);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({});
  const [data, setData] = useState<MetricPage>(EMPTY_PAGE);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<unknown>(null);
  const [exporting, setExporting] = useState(false);

  const domainKey = analyticsDomainSchema.safeParse(domain);
  /**
   * The domain's own hourly cut-off, so a drill-down buckets EXACTLY like the
   * dashboard it came from — Traffic keeps hours across a week, the rest do not.
   * An unknown domain never reaches a fetch, so the default is only ever used
   * for the render that precedes the not-found card.
   */
  const hourlyUpToDays = domainKey.success ? HOURLY_UP_TO_DAYS[domainKey.data] : undefined;

  const window = useMemo(() => windowFor(range, hourlyUpToDays), [range, hourlyUpToDays]);

  /**
   * The monotonic token that makes an OUT-OF-ORDER RESPONSE LOSE.
   *
   * The same guarantee `useAnalyticsStore.load` documents, for the same reason,
   * on the page that needs it most: every control here re-fires the loader —
   * the range picker, five facets, the sort, and the pager — and `fetch` is a
   * registry function whose latency varies by metric and by window. Widen 7d →
   * 30d → 90d in three clicks and three requests are in flight; without the
   * token the SLOWEST one paints last, and the table shows 30d rows under a 90d
   * pill with no way to tell. Narrowing a facet is worse: the wider, slower
   * answer lands on top of the narrower one and the filter looks broken.
   *
   * A `useRef` and not module scope (which is what the store uses): the store is
   * a singleton keyed by domain, while this page is remounted per metric route,
   * and a token that outlived the mount would make the first load of the NEXT
   * drill-down lose to nothing. Bumping it on every entry also covers unmount —
   * a response that resolves after the user has navigated away compares against
   * a ref nobody reads.
   */
  const loadSeq = useRef(0);

  // `filters` is state, so its identity only changes when a facet actually
  // changes — no serialized stand-in key is needed in the dependency list.
  const load = useCallback(async () => {
    if (!definition) return;
    const id = (loadSeq.current += 1);
    setStatus('loading');
    setError(null);
    try {
      const next = await definition.fetch(window, filters, page, sort);
      if (id !== loadSeq.current) return;
      setData(next);
      setStatus('ready');
    } catch (cause) {
      // The ERROR is guarded too. A superseded request that fails must not
      // replace a good table with a retry card for a window nobody is looking
      // at any more.
      if (id !== loadSeq.current) return;
      setStatus('error');
      setError(cause);
    }
  }, [definition, window, filters, page, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = useMemo(
    () =>
      (definition?.columns ?? []).map((column) =>
        col<MetricRow>({
          id: column.key,
          header: tk(column.headerKey),
          align: column.align,
          enableHiding: column.enableHiding,
          // Carried ONLY so the header renders as sortable; the ordering itself
          // happens in the registry, before paging (see the header).
          accessor: column.accessor,
          cell: (row: MetricRow) =>
            column.mono ? (
              <span dir="ltr" className="font-mono text-xs">
                {column.value(row, tk)}
              </span>
            ) : (
              column.value(row, tk)
            ),
        }),
      ),
    [definition, tk],
  );

  const facets = useMemo<FacetDef[]>(
    () =>
      (definition?.filters ?? []).map((facet): FacetDef => {
        const active = filters[facet.key];
        return {
          id: facet.key,
          label: tk(facet.labelKey),
          // Single-select: the registry's `match` compares ONE value, and a
          // multi-select facet would silently apply only the last chip.
          multi: false,
          value: active === undefined ? [] : [active],
          options: optionsOf(data.facetOptions[facet.key] ?? [], tk),
          onChange: (next: string[]) => {
            const chosen = next[0];
            setFilters((previous) => {
              const merged = { ...previous };
              if (chosen === undefined) delete merged[facet.key];
              else merged[facet.key] = chosen;
              return merged;
            });
            setPage(1);
          },
        };
      }),
    [definition, filters, data.facetOptions, tk],
  );

  if (!definition || !domainKey.success) {
    return (
      <div className="flex flex-col gap-[var(--gap)]" data-testid="admin-analytics-detail-missing">
        <SectionHeader
          title={t('analytics:detail.notFound.title')}
          subtitle={t('analytics:detail.notFound.subtitle')}
        />
        <EmptyState
          title={t('analytics:detail.notFound.emptyTitle')}
          message={t('analytics:detail.notFound.emptyMessage', {
            domain: domain ?? '—',
            metric: metric ?? '—',
          })}
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/analytics/engagement" data-testid="analytics-detail-notfound-back">
                <ArrowLeft className="rtl:rotate-180" aria-hidden />
                {t('analytics:detail.notFound.back')}
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const activeDomain = domainKey.data;
  const csv = definition.csv;

  const exportCsv = () => {
    if (!csv) return;
    setExporting(true);
    try {
      const headers = definition.columns.map((column) => ({
        key: column.key,
        label: tk(column.headerKey),
      }));
      // The rows are FLATTENED through the same `value()` the table renders, so
      // the file and the screen can never disagree about what a cell says.
      const rows: CsvRow[] = data.exportRows.map((row) =>
        Object.fromEntries(definition.columns.map((column) => [column.key, column.value(row, tk)])),
      );
      downloadCsvBlob(toCsv(rows, headers), csvFilename(csv.stem));
    } catch (cause) {
      toast.error(describeError(cause) || t('analytics:detail.exportError'));
    } finally {
      setExporting(false);
    }
  };

  const cold = status === 'loading' && data.rows.length === 0;

  return (
    <div className="flex flex-col gap-[var(--gap)]" data-testid="admin-analytics-detail">
      <SectionHeader
        title={tk(definition.titleKey)}
        subtitle={
          // The way BACK lives in the sentence that says where you are — the
          // reason `SectionHeader.subtitle` is a node rather than a string.
          <span className="flex flex-wrap items-center gap-1.5">
            <Link
              to={definition.backTo}
              data-testid="analytics-detail-back"
              className="inline-flex items-center gap-1 text-primary transition-opacity duration-[var(--speed)] hover:opacity-80"
            >
              <ArrowLeft className="size-3.5 rtl:rotate-180" aria-hidden />
              {t(DOMAIN_LABEL_KEYS[activeDomain])}
            </Link>
            {definition.subtitleKey === undefined ? null : (
              <>
                <span aria-hidden>·</span>
                <span>{tk(definition.subtitleKey)}</span>
              </>
            )}
          </span>
        }
        actions={
          <RangePicker
            value={range}
            onChange={(next) => {
              setRange(next);
              setPage(1);
            }}
            testId="analytics-detail-range"
          />
        }
      />

      {status === 'error' ? (
        <ErrorState
          error={error}
          title={t('analytics:detail.loadError')}
          onRetry={() => {
            void load();
          }}
        />
      ) : (
        <>
          {definition.series === undefined ? null : (
            <PanelCard
              title={tk(definition.titleKey)}
              caption={
                /*
                  THE BUCKET CAPTION BELONGS TO A TIME AXIS ONLY (W3.1).

                  "Per day." explains what one point on a LINE means, because a
                  line's x-axis is the window sliced into buckets. A `bar` chart
                  in this registry is a categorical breakdown — one bar per
                  project, per org, per hour-of-day, per status class — where
                  the x-axis is not time at all, so the sentence was answering a
                  question nobody had asked and answering it wrongly ("Delivery
                  by project · Per day." over four project bars).

                  `kind` is the registry's own discriminator for exactly this
                  distinction (see `MetricChart`: bar for a categorical axis,
                  line for a time axis), so it is read here rather than
                  re-derived from a metric id list that would go stale.
                */
                (definition.series.kind ?? 'line') === 'line' ? (
                  <p className="text-xs text-muted-foreground">
                    {t('analytics:detail.perInterval', {
                      interval: t(INTERVAL_LABEL_KEYS[window.interval]),
                    })}
                  </p>
                ) : undefined
              }
              testId="analytics-detail-chart"
            >
              <MetricChart
                rows={pointRows(data.points)}
                series={pointSeries(
                  tk(definition.series.labelKey),
                  definition.series.color,
                  definition.series.format === undefined
                    ? undefined
                    : (value) => definition.series?.format?.(value, tk) ?? String(value),
                )}
                kind={definition.series.kind ?? 'line'}
                title={tk(definition.titleKey)}
                height={280}
                loading={cold}
                emptyTitle={t('analytics:detail.chartEmpty.title')}
                emptyMessage={t('analytics:detail.chartEmpty.message')}
                testId="analytics-detail-plot"
              />
            </PanelCard>
          )}

          <PanelCard title={tk(definition.titleKey)} testId="analytics-detail-table">
            <DataTable
              aria-label={t('analytics:detail.tableAria', { title: tk(definition.titleKey) })}
              columns={columns}
              rows={data.rows}
              rowKey={(row) => String(row.label ?? JSON.stringify(row))}
              loading={status === 'loading'}
              // `meta` is what puts the grid in MANUAL mode (see the header) —
              // and the registry, not a server, is what filled it in.
              meta={{
                page: data.page,
                pageSize: data.pageSize,
                total: data.total,
                totalPages: Math.max(1, Math.ceil(data.total / data.pageSize)),
              }}
              onPageChange={setPage}
              sort={sort}
              onSortChange={(next) => {
                setSort(next);
                setPage(1);
              }}
              facets={facets}
              emptyMessage={t('analytics:detail.tableEmpty')}
              enableColumnReorder={false}
              toolbar={
                csv === undefined ? undefined : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={exporting || data.exportRows.length === 0}
                    onClick={exportCsv}
                    data-testid="analytics-detail-export"
                  >
                    {exporting ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Download aria-hidden />
                    )}
                    {t('analytics:detail.export')}
                  </Button>
                )
              }
            />
          </PanelCard>
        </>
      )}
    </div>
  );
}
