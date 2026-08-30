import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download, X } from 'lucide-react';
import { telemetryEventTypeSchema, type TelemetryEventRow } from '@flowboard/shared';

import { csvFilename, toCsv, type CsvRow } from '@/lib/csv';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import PageHeader from '@/components/common/PageHeader';
import {
  DataTable,
  col,
  PAGE_SIZE_OPTIONS,
  type FacetDef,
  type SortState,
} from '@/components/dashboard/DataTable';
import { downloadCsvBlob } from '@/components/dashboard/save-blob';
import TelemetryEventBadge, { useEventTypeLabel } from '@/components/admin/TelemetryEventBadge';
import TelemetryRangePicker from '@/components/admin/TelemetryRangePicker';
import {
  filterWindow,
  TELEMETRY_FILTER_PRESETS,
  type TelemetryFilterPreset,
} from '@/components/admin/telemetry-range';
import { useTelemetryFormat } from '@/components/admin/telemetry-format';
import { useTelemetryEvents, type TelemetryEventFilters } from '@/hooks/useAdminTelemetry';
import { decodeGridParams, useGridUrlState, type GridParamDefs } from '@/hooks/useGridUrlState';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The raw telemetry stream — every recorded event, filterable, sortable,
 * linkable and exportable.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is the drill-down the ops charts point at: the overview says "events
 * spiked at 14:00", and this page says which ones.
 *
 * ── ROUND 2: IT IS A REAL GRID NOW ──────────────────────────────────────────
 * The hand-rolled table, the single-select chip bar and the local-only state
 * are gone. What replaced them, and why each one matters:
 *
 *  - **The generic `DataTable`**, so the events feed sorts, hides columns and
 *    pages exactly like every other grid in FlowBoard, and an e2e spec that
 *    knows one grid knows this one (`table-facet-*`, `table-page`, `table-range`).
 *  - **`useGridUrlState`**, so a narrowed feed is a URL somebody can paste into
 *    an incident channel. Filters, sort and paging live in the query string;
 *    column layout and density deliberately do not (see that hook's header).
 *  - **A MULTI-select type facet.** The old control offered one event type at a
 *    time while the endpoint has always accepted a comma-separated list —
 *    "logins and sign-ups, nothing else" was a question the API could answer
 *    and the UI could not ask.
 *  - **CSV export** of the page's rows, through the same `save-blob` the
 *    analytics drill-downs use.
 *
 * ── THE FEED STILL DEFAULTS TO ALL TIME ─────────────────────────────────────
 * Unlike every chart in this package and unlike the analytics domains, `/events`
 * applies no implicit window. The feed's job is "find the event I am looking
 * for", and a hidden 24-hour default is how "I cannot find last month's login"
 * becomes a support ticket. That is also why this page keeps
 * `TelemetryRangePicker` rather than adopting the console's `RangePicker`: the
 * console's four presets have no "All time", and the feed's most important
 * window is the one that is not a window.
 *
 * ── EVERY NARROWING RESETS TO PAGE 1 ────────────────────────────────────────
 * Narrowing to `task_created` while on page 7 of the unfiltered feed would
 * otherwise land on a page that no longer exists, which renders as an empty
 * table indistinguishable from "there are no such events".
 *
 * ── WHY THE STATE LIVES IN A REF AS WELL AS IN `useState` ───────────────────
 * `useGridUrlState.get()` is called from inside an effect — i.e. AFTER the
 * render that mounted the hook — so a closure over this render's values is one
 * commit stale, and the writer would flush pre-hydration state back over the
 * URL it had just read. The hook's own header says to read a store's
 * `getState()`. `stateRef` is that store: `apply` writes the ref synchronously
 * before it schedules the render, so `get()` is never behind.
 *
 * ── THE PAYLOAD MOVED FROM A ROW TO A POPOVER ───────────────────────────────
 * The old expander was a real `<tr colSpan>`, chosen so the JSON stayed
 * copy-pasteable. The generic grid has no row-expansion feature and adding one
 * to W1.4's kit is not this wave's call, so the payload lives behind a popover
 * instead — still selectable and copyable (Radix does not close on selection),
 * and it gains a scroll container, which the inline row never had for a large
 * bag. The testid (`telemetry-event-payload`) is unchanged.
 */

const EVENT_TYPES = telemetryEventTypeSchema.options;

/** Sortable columns, exactly what `admin-telemetry.service#eventOrderBy` honours. */
const SORT_FIELDS = ['createdAt', 'type'] as const;

const DEFAULT_PAGE_SIZE = 20;

interface EventsGridState {
  type: string[];
  userId: string;
  range: string;
  sort: string;
  order: string;
  page: number;
  pageSize: number;
  [key: string]: string | string[] | number | undefined;
}

const GRID_PARAMS: GridParamDefs<EventsGridState> = {
  type: { kind: 'list', values: EVENT_TYPES },
  userId: { kind: 'text' },
  range: { kind: 'enum', values: TELEMETRY_FILTER_PRESETS, default: 'all' },
  // `clearable`: a user who turns the sort OFF is making a different statement
  // from a user who never set one, and `?sort=` is how that round-trips.
  sort: { kind: 'enum', values: SORT_FIELDS, default: 'createdAt', clearable: true },
  order: { kind: 'enum', values: ['asc', 'desc'], default: 'desc' },
  page: { kind: 'int', default: 1, min: 1 },
  pageSize: { kind: 'int', default: DEFAULT_PAGE_SIZE, values: PAGE_SIZE_OPTIONS },
};

/**
 * The state a deep link implies, read SYNCHRONOUSLY at mount.
 *
 * `useGridUrlState` hydrates from an effect, which runs after the first render
 * has already committed — and this page fires its query during that render. So
 * without this, opening `?type=auth_login&range=7d` cost TWO requests: one for
 * the defaults nobody asked for, then the real one, with the wrong rows
 * flashing in between. Seeding from the URL makes the hook's own hydration a
 * no-op that agrees with what is already on screen.
 *
 * `decodeGridParams` fills every default and silently drops anything invalid,
 * so a hand-mangled query string still produces a complete, legal state.
 */
function stateFromUrl(): EventsGridState {
  const search = typeof window === 'undefined' ? '' : window.location.search;
  return decodeGridParams(GRID_PARAMS, new URLSearchParams(search));
}

export default function AdminTelemetryEventsPage() {
  const { t } = useTranslation(['admin', 'analytics', 'common']);
  const format = useTelemetryFormat();
  const eventTypeLabel = useEventTypeLabel();

  const [state, setState] = useState<EventsGridState>(stateFromUrl);
  const stateRef = useRef(state);

  /** The single writer. Keeps the ref and the render in lockstep — see header. */
  const commit = useCallback((next: EventsGridState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  /** Any narrowing: merge the patch and go back to page 1. */
  const narrow = useCallback(
    (patch: Partial<EventsGridState>) => {
      commit({ ...stateRef.current, ...patch, page: 1 });
    },
    [commit],
  );

  useGridUrlState<EventsGridState>({
    params: GRID_PARAMS,
    get: () => stateRef.current,
    apply: commit,
    // A facet, a sort or a range is a step Back should walk; paging is not.
    push: ['type', 'userId', 'range', 'sort'],
  });

  const query = useMemo((): TelemetryEventFilters => {
    const window = filterWindow(state.range as TelemetryFilterPreset);
    return {
      // The contract is multi-value and `toQuery` comma-joins it.
      type: state.type.length > 0 ? (state.type as TelemetryEventFilters['type']) : undefined,
      userId: state.userId === '' ? undefined : state.userId,
      from: window?.from,
      to: window?.to,
    };
  }, [state.range, state.type, state.userId]);

  const events = useTelemetryEvents(query, {
    page: state.page,
    pageSize: state.pageSize,
    // The wire spelling is `field:direction`; a cleared sort sends nothing and
    // lets the endpoint fall back to its own newest-first ordering.
    sort: state.sort === '' ? undefined : `${state.sort}:${state.order}`,
  });

  const rows = events.data?.rows ?? [];
  /** The actor name shown in the chip — taken off a row, never a lookup. */
  const [userName, setUserName] = useState<string | null>(null);

  const columns = useMemo(
    () => [
      col<TelemetryEventRow>({
        id: 'createdAt',
        header: t('admin:events.column.time'),
        // Present ⇒ the header is sortable. The SERVER does the ordering (the
        // grid is in manual mode), so this is a declaration, not a comparator.
        accessor: (row) => row.createdAt,
        enableHiding: false,
        // NO `dir="ltr"` (W3.2) — the same rule `AdminUsersPage`'s created
        // column records, and this cell was the one place still breaking it.
        // `format.stamp` is `Intl.DateTimeFormat(getIntlLocale(), …)`, so in
        // Arabic it emits ARABIC PROSE with a Latin day and clock inside it
        // ("30 أغسطس، 19:43:54"). Forcing that string LTR reorders it: the
        // bidi algorithm pulled the day number clean off its month and parked
        // it at the far end, so the RTL feed read "أغسطس، 19:43:54 30".
        //
        // Nothing here needs an island. The digits are already Western by
        // policy (`getIntlLocale` → `ar-u-nu-latn`), `tabular-nums` still
        // keeps the column fixed-width, and `Intl`'s own output carries the
        // marks it needs to render correctly in the page's direction.
        cell: (row) => (
          <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            {format.stamp(row.createdAt)}
          </span>
        ),
      }),
      col<TelemetryEventRow>({
        id: 'type',
        header: t('admin:events.column.type'),
        accessor: (row) => row.type,
        cell: (row) => <TelemetryEventBadge type={row.type} />,
      }),
      col<TelemetryEventRow>({
        id: 'user',
        header: t('admin:events.column.user'),
        cell: (row) =>
          row.userName === null || row.userId === null ? (
            <span className="text-xs text-muted-foreground">{t('admin:events.system')}</span>
          ) : (
            // Clicking a name narrows the feed to that person. This is why the
            // page needs no user picker: FlowBoard has no global user directory
            // that is not org-scoped, and "the person on the row in front of
            // me" is the only actor anyone wants to filter by while reading.
            <button
              type="button"
              className="max-w-40 truncate text-xs text-foreground underline-offset-2 hover:underline"
              onClick={() => {
                setUserName(row.userName);
                narrow({ userId: row.userId ?? '' });
              }}
            >
              {row.userName}
            </button>
          ),
      }),
      /*
        THE PROJECT COLUMN SHOWS A NAME (R2 W3.5).

        It used to render `row.projectId` — a raw UUID, in a mono LTR island,
        one column away from a User cell that already showed a person's name.
        Nobody can act on a UUID, and this table's entire job is to be read.
        `projectName` now rides the row (a LEFT JOIN in
        `admin-telemetry.service`), and the id is still in the payload for the
        filter and the expander.

        THE ID IS THE FALLBACK, NOT A DEAD END. `telemetry_events` is
        append-only with no cascade, so a row outlives the project it names on
        purpose; when the join finds nothing the cell shows the id in the old
        mono island rather than an em dash, because "an event about a project
        that no longer resolves" is a real answer and losing the id would make
        it unfollowable. The id also rides `title` on the named case, so it is
        one hover away whichever branch drew the cell.
      */
      col<TelemetryEventRow>({
        id: 'project',
        header: t('admin:events.column.project'),
        accessor: (row) => row.projectName ?? row.projectId,
        cell: (row) =>
          row.projectId === null ? (
            <span className="text-muted-foreground">—</span>
          ) : row.projectName === null ? (
            <span
              dir="ltr"
              title={row.projectId}
              className="block max-w-40 truncate font-mono text-[11px]"
            >
              {row.projectId}
            </span>
          ) : (
            <span
              title={row.projectId}
              data-testid="telemetry-event-project"
              className="block max-w-40 truncate text-xs text-foreground"
            >
              {row.projectName}
            </span>
          ),
      }),
    ],
    [t, format, narrow],
  );

  const facets: FacetDef[] = [
    {
      id: 'type',
      label: t('analytics:ops.events.typeFacet'),
      // MULTI, unlike the control this replaced — the endpoint always accepted
      // a list, and "logins and sign-ups" is a real question.
      multi: true,
      value: state.type,
      options: EVENT_TYPES.map((type) => ({ value: type, label: eventTypeLabel(type) })),
      onChange: (next) => {
        narrow({ type: next });
      },
    },
  ];

  const exportCsv = () => {
    try {
      const headers = [
        { key: 'createdAt', label: t('admin:events.column.time') },
        { key: 'type', label: t('admin:events.column.type') },
        { key: 'user', label: t('admin:events.column.user') },
        { key: 'project', label: t('admin:events.column.project') },
        // The id keeps its own column rather than replacing the name: a
        // spreadsheet is where somebody joins this export against another one.
        { key: 'projectId', label: t('admin:events.column.projectId') },
        { key: 'payload', label: t('admin:events.column.details') },
      ];
      const csvRows: CsvRow[] = rows.map((row) => ({
        // The RAW instant, not the localized stamp: a spreadsheet sorts an ISO
        // string correctly and cannot sort "27 Aug 2026, 11:59".
        createdAt: row.createdAt,
        type: row.type,
        user: row.userName ?? t('admin:events.system'),
        project: row.projectName ?? row.projectId ?? '',
        projectId: row.projectId ?? '',
        payload: row.payload === null ? '' : JSON.stringify(row.payload),
      }));
      downloadCsvBlob(toCsv(csvRows, headers), csvFilename('flowboard-telemetry-events'));
    } catch {
      toast.error(t('analytics:ops.events.exportError'));
    }
  };

  return (
    <>
      <PageHeader title={t('admin:events.title')} description={t('admin:events.description')}>
        <div className="flex flex-wrap items-center gap-2">
          <TelemetryRangePicker
            value={state.range as TelemetryFilterPreset}
            // `TELEMETRY_FILTER_PRESETS`, not the picker's default set (W3.1).
            // The default is the three CHART windows — 24h/7d/30d — and this
            // page's default range is `all`. Without this prop the "All time"
            // chip was never rendered: nothing looked selected on arrival, and
            // clicking any window was a ONE-WAY DOOR out of the un-windowed
            // feed, which is the single behaviour this page's header argues it
            // must never lose.
            presets={TELEMETRY_FILTER_PRESETS}
            onChange={(next) => {
              narrow({ range: next });
            }}
          />
          {state.userId === '' ? null : (
            <Badge variant="secondary" className="gap-1">
              <span>{userName ?? state.userId}</span>
              <button
                type="button"
                aria-label={t('admin:events.filter.clearUser')}
                data-testid="telemetry-events-clear-user"
                onClick={() => {
                  setUserName(null);
                  narrow({ userId: '' });
                }}
              >
                <X className="size-3" aria-hidden />
              </button>
            </Badge>
          )}
        </div>
      </PageHeader>

      <DataTable
        aria-label={t('analytics:ops.events.aria')}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        rowTestId={() => 'telemetry-event-row'}
        loading={events.isPending}
        meta={events.data?.meta ?? null}
        onPageChange={(page) => {
          commit({ ...stateRef.current, page });
        }}
        onPageSizeChange={(pageSize) => {
          // A different page size renumbers every page; page 7 of 20 is not
          // page 7 of 100.
          narrow({ pageSize });
        }}
        sort={{ sort: state.sort === '' ? undefined : state.sort, order: sortOrder(state.order) }}
        onSortChange={(next: SortState) => {
          narrow({ sort: next.sort ?? '', order: next.order ?? 'desc' });
        }}
        facets={facets}
        emptyMessage={t('admin:events.emptyBody')}
        enableColumnReorder={false}
        actions={(row) => <PayloadPopover row={row} />}
        toolbar={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={rows.length === 0}
            onClick={exportCsv}
            data-testid="telemetry-events-export"
          >
            <Download aria-hidden />
            {t('analytics:ops.events.export')}
          </Button>
        }
      />
    </>
  );
}

/** Narrows the URL's free-form `order` back to the grid's two directions. */
function sortOrder(value: string): 'asc' | 'desc' | undefined {
  return value === 'asc' || value === 'desc' ? value : undefined;
}

/**
 * The payload, behind a popover.
 *
 * Only a row that HAS one gets a trigger — the alternative is a button that
 * opens an empty box, which teaches the reader nothing and costs a click to
 * find out. `payload` is an uninterpreted jsonb bag whose shape differs per
 * event type (a `page_view` carries a path, a `search_performed` a query and a
 * result count), so there is no column decomposition to do here: the keys are
 * open by contract.
 */
function PayloadPopover({ row }: { row: TelemetryEventRow }) {
  const { t } = useTranslation(['admin']);
  const hasPayload = row.payload !== null && Object.keys(row.payload).length > 0;
  if (!hasPayload) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="text-xs">
          {t('admin:events.column.details')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <pre
          dir="ltr"
          data-testid="telemetry-event-payload"
          className="max-h-64 overflow-auto rounded-[var(--radius)] border border-border bg-surface p-2 font-mono text-[11px] text-muted-foreground"
        >
          {JSON.stringify(row.payload, null, 2)}
        </pre>
      </PopoverContent>
    </Popover>
  );
}
