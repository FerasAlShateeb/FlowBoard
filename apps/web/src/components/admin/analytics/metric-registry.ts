import {
  analyticsEngagementSchema,
  analyticsGrowthSchema,
  analyticsTrafficSchema,
  analyticsWorkSchema,
  telemetryEventTypeSchema,
  type AnalyticsDomain,
  type AnalyticsEngagement,
  type AnalyticsGrowth,
  type AnalyticsTraffic,
  type AnalyticsWork,
  type TelemetryEventType,
} from '@flowboard/shared';
import type { ZodType } from 'zod';

import i18n from '@/i18n';
import { api } from '@/lib/api';
import { getIntlLocale } from '@/lib/lang-policy';
import type { AnalyticsWindow, WindowInterval } from '@/components/dashboard/range';
import type { GoodDirection } from '@/components/dashboard/StatDelta';
import type { AnalyticsKey } from '@/components/admin/analytics/metric-catalog';
import {
  bucketLabel,
  formatCount,
  formatInstant,
  formatMs,
  formatShare,
} from '@/components/dashboard/format';
import { formatDecimal } from '@/components/reports/chart-format';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The metric registry — one table that turns every KPI tile and every chart in
 * the analytics console into a working drill-down page.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The alternative was a bespoke detail page per metric (twenty of them), each
 * re-implementing a range picker, a chart, a table and a CSV button. Instead
 * `AnalyticsDetailPage` is ONE page parameterised by
 * `/admin/analytics/:domain/:metric`, and every entry below supplies the five
 * things that actually differ: what to call it, how to load it, what the table
 * columns are, which client-side facets make sense, and whether the rows are
 * worth exporting.
 *
 * ═══ THREE PROPERTIES WORTH KEEPING ══════════════════════════════════════
 *
 *  - **The API is not extended to serve this page.** Each domain endpoint
 *    already returns its whole payload in one round trip (see
 *    `packages/shared/src/admin-analytics.schema.ts`), so a detail fetch reuses
 *    that same call and PROJECTS the metric out of it. There is no
 *    `/analytics/:domain/:metric` on the server and there must not be one.
 *  - **Filters, sorting and paging are client-side, and honestly so.** The
 *    analytics endpoints expose a window and nothing else, so "filter by
 *    method" is a predicate over rows we already hold, not a query param the
 *    server would ignore. Row counts are bounded by the payload contracts (24
 *    hours, four status classes, one row per project/org/endpoint/event type),
 *    so nothing here can page unboundedly.
 *  - **{@link detailPath} is typed against this object**, so a tile can only
 *    link to a metric that exists — a broken drill-down is a compile error, not
 *    a friendly-but-wrong "unknown metric" screen a user discovers.
 *
 * ═══ THIS MODULE HOLDS i18n KEYS, NEVER COPY ═════════════════════════════
 *
 * The registry is module-scope data: a literal `title: 'Cycle time'` would be
 * evaluated once at import and freeze the console in whichever language
 * happened to be active then. So every user-facing field is a `…Key` resolved
 * by the render site through {@link MetricTranslate}.
 *
 * FlowBoard's twist on GameDash's port: those keys are **typed literals**, not
 * `string`. {@link AnalyticsKey} is DERIVED from the English catalog
 * (`locales/en/analytics.ts`), the same guarantee `components/navigation/
 * nav.config.ts` buys with a hand-written union — except here the union is
 * computed, so renaming a catalog key breaks this file at compile time and
 * nobody has to remember to widen a list. `metric-registry.test.ts` is the
 * belt to that brace: it walks the whole registry and resolves every key
 * against BOTH catalogs at runtime, which is what catches a key that exists in
 * English and was never translated.
 *
 * The one exception is inside a `load()`: those run per FETCH, not at import,
 * so the handful of row labels that are copy rather than a wire identifier (an
 * event type's name on the x-axis) go through `i18n.t` directly. They are
 * re-read on the next load rather than on a language switch — a fair trade
 * against threading a translator through every projection. Table CELLS have no
 * such excuse: {@link MetricColumn.value} takes the translator as its second
 * argument and is therefore fully reactive.
 */

/* ------------------------------------------------------------------ */
/* Key types                                                           */
/* ------------------------------------------------------------------ */

/**
 * Every key the `analytics` namespace can resolve, prefixed.
 *
 * Defined in `metric-catalog.ts` and re-exported here, because that module is
 * the DEPENDENCY-FREE half of this one: the breadcrumb trail needs a metric's
 * title key and must not pay for `lib/api` or a live i18next to get it. Every
 * existing `import { …, type AnalyticsKey } from './metric-registry'` still
 * resolves — the type simply has one home now instead of two.
 */
export type {
  AnalyticsKey,
  LeafPath,
  MetricTitleKey,
} from '@/components/admin/analytics/metric-catalog';

/**
 * The two `admin:` keys this module deliberately REUSES rather than re-mints.
 *
 * An event type's name and the millisecond unit must read identically on the
 * events feed and on the Traffic dashboard; a second spelling of "ms" in a
 * second namespace is exactly how two surfaces start disagreeing. `admin` is
 * W2.1's file and nothing is added to it — these are reads.
 */
export type AdminReuseKey = 'admin:units.ms' | `admin:eventType.${TelemetryEventType}`;

/** Every key the registry can hand a render site. */
export type MetricKeyRef = AnalyticsKey | AdminReuseKey;

/**
 * A `t` narrowed to the keys this module emits.
 *
 * The typed `t` accepts literal keys from the English catalog — exactly the
 * guarantee we want at hand-written call sites, and exactly the thing a key
 * read out of a registry cannot satisfy without a cast. Render sites cast ONCE
 * through this alias, the same shape `nav.config#NavTranslate` uses.
 */
export type MetricTranslate = (key: MetricKeyRef, options?: Record<string, unknown>) => string;

/** `WindowInterval` → the catalog key for its word ("per **day**"). */
export const INTERVAL_LABEL_KEYS = {
  hour: 'analytics:intervals.hour',
  day: 'analytics:intervals.day',
  week: 'analytics:intervals.week',
  month: 'analytics:intervals.month',
} as const satisfies Record<WindowInterval, AnalyticsKey>;

/**
 * Domain → the catalog key for its name. The SAME key feeds the dashboard's
 * page title and the detail page's back link, so the two cannot drift.
 */
export const DOMAIN_LABEL_KEYS = {
  engagement: 'analytics:domains.engagement',
  work: 'analytics:domains.work',
  traffic: 'analytics:domains.traffic',
  growth: 'analytics:domains.growth',
} as const satisfies Record<AnalyticsDomain, AnalyticsKey>;

/** Per-domain fallback sentence when a request carries no message of its own. */
export const DOMAIN_ERROR_KEYS = {
  engagement: 'analytics:engagement.loadError',
  work: 'analytics:work.loadError',
  traffic: 'analytics:traffic.loadError',
  growth: 'analytics:growth.loadError',
} as const satisfies Record<AnalyticsDomain, AnalyticsKey>;

/** Where each domain's dashboard lives. Also every metric's back link. */
export const DOMAIN_PATHS = {
  engagement: '/admin/analytics/engagement',
  work: '/admin/analytics/work',
  traffic: '/admin/analytics/traffic',
  growth: '/admin/analytics/growth',
} as const satisfies Record<AnalyticsDomain, string>;

/* ------------------------------------------------------------------ */
/* Contracts                                                           */
/* ------------------------------------------------------------------ */

/** One point of a chart (already labelled for the x-axis). */
export interface MetricPoint {
  label: string;
  value: number;
}

/** A table row. Loosely typed because ONE page renders every metric's rows. */
export type MetricRow = Record<string, unknown>;

export interface MetricColumn {
  key: string;
  /** i18n key (`analytics:columns.*`) for the header. */
  headerKey: AnalyticsKey;
  /** Logical alignment — `end` is right in English and left in Arabic. */
  align?: 'start' | 'end';
  /** Cell text, already formatted. The translator is passed in, not captured. */
  value: (row: MetricRow, translate: MetricTranslate) => string;
  /** Render monospaced (paths, methods, slugs, status classes). */
  mono?: boolean;
  /**
   * Comparable value for sorting. Its PRESENCE is what makes the column's
   * header sortable — and the sort is applied to the whole filtered row set
   * *before* {@link pageOf} slices it, so page 2 of a sort is the real page 2
   * and not a reshuffle of the rows that happened to be on screen. `value`
   * cannot double as the comparator: it returns display text (`"1,024"`,
   * `"73%"`), which sorts lexically and would order `9` after `10`.
   */
  accessor?: (row: MetricRow) => string | number | boolean | null | undefined;
  /** `false` pins the column visible (never offered in the Columns menu). */
  enableHiding?: boolean;
}

/** A drill-down's sort intent — structurally `DataTable`'s own `SortState`. */
export interface MetricSortState {
  sort?: string;
  order?: 'asc' | 'desc';
}

/**
 * One facet choice.
 *
 * Exactly one label field is set: `labelKey` for real copy (an event type's
 * name), `label` for a value that IS the identifier it filters on — an HTTP
 * method, a status class, an organization's own name. Translating the latter
 * would stop it matching the row it selects.
 *
 * There is deliberately NO "All …" sentinel option, unlike GameDash's select:
 * FlowBoard's `FacetFilter` is a checkbox list with its own Clear row, and an
 * empty-valued checkbox beside it would be two ways to say the same thing.
 */
export interface MetricOption {
  value: string;
  label?: string;
  labelKey?: MetricKeyRef;
}

export interface MetricFilterConfig {
  key: string;
  /** i18n key (`analytics:filters.*`) for the facet's own name. */
  labelKey: AnalyticsKey;
  /**
   * The choices. A FUNCTION when the vocabulary is data rather than an enum —
   * the "organization" facet on `work/by-project` can only offer the orgs that
   * actually appear in the window, and a closed list would be a lie the moment
   * someone creates an org. Resolved against the UNFILTERED rows, so narrowing
   * to one org does not then hide every other option.
   */
  options: MetricOption[] | ((rows: MetricRow[]) => MetricOption[]);
  /** Client-side predicate (see the banner — the endpoints carry no facets). */
  match: (row: MetricRow, value: string) => boolean;
}

export interface MetricSeriesConfig {
  /** i18n key (`analytics:series.*`) for the legend/tooltip name. */
  labelKey: AnalyticsKey;
  /** Chart colour token index → `var(--chart-N)`. */
  color: 1 | 2 | 3 | 4 | 5;
  /** `bar` for a categorical x-axis, `line` for a time axis. */
  kind?: 'line' | 'bar';
  /** Tooltip/value formatter (defaults to a thousands-separated integer). */
  format?: (value: number, translate: MetricTranslate) => string;
}

/** Where an export lands. Absent ⇒ this metric offers no CSV. */
export interface MetricCsvConfig {
  /** Filename stem — `<stem>-YYYY-MM-DD.csv` via `lib/csv.csvFilename`. */
  stem: string;
}

export interface MetricPage {
  points: MetricPoint[];
  /** The current page's slice. */
  rows: MetricRow[];
  /**
   * The WHOLE filtered, sorted row set — what a CSV export writes.
   *
   * Exporting `rows` would produce a file whose contents depend on which page
   * the reader happened to be on, which is the single most confusing possible
   * behaviour for a button labelled "export". Every metric here is bounded by
   * its payload contract, so holding the full set costs nothing.
   */
  exportRows: MetricRow[];
  /** Facet id → the options resolved against the unfiltered rows. */
  facetOptions: Record<string, MetricOption[]>;
  total: number;
  page: number;
  pageSize: number;
}

export type MetricFetch = (
  window: AnalyticsWindow,
  filters: Record<string, string>,
  page: number,
  sort?: MetricSortState,
) => Promise<MetricPage>;

export interface MetricDefinition {
  /** i18n key (`analytics:metrics.<domain>.<metric>.title`). */
  titleKey: AnalyticsKey;
  /** i18n key: the same path, `.subtitle`. */
  subtitleKey?: AnalyticsKey;
  /** Absent ⇒ the detail page renders the table only. */
  series?: MetricSeriesConfig;
  columns: MetricColumn[];
  filters?: MetricFilterConfig[];
  /** Absent ⇒ no export button. */
  csv?: MetricCsvConfig;
  /**
   * Which way this metric has to move to be an IMPROVEMENT. Default `'up'`.
   *
   * ═══ WHY IT LIVES HERE AND NOT IN THE BADGE (R2 W3.5) ══════════════════
   *
   * `StatDelta` used to have no lower-is-better mode at all, and its header
   * said why: whether `+18%` is good news is a fact about the METRIC, not about
   * a pill, and encoding it in the component would give the same number two
   * colours with nothing explaining the difference. That reasoning was right;
   * the missing half was a place to declare the fact. This is that place — one
   * line, next to the metric's own title, columns and loader, so a KPI tile and
   * the drill-down it links to can never disagree about polarity.
   *
   * `'down'` is for the metrics that improve as they fall: error counts, error
   * rate, latency, cycle time. Everything else — every count, rate and total —
   * is `'up'` and says nothing.
   */
  deltaDirection?: GoodDirection;
  /** The dashboard this metric belongs to (the detail page's back link). */
  backTo: string;
  fetch: MetricFetch;
}

/** Rows per drill-down page. Every metric here is bounded, so this is comfort. */
export const METRIC_PAGE_SIZE = 25;

/* ------------------------------------------------------------------ */
/* Cell and comparator helpers                                         */
/* ------------------------------------------------------------------ */

/** The placeholder for a value that does not exist. Not prose — no locale. */
const DASH = '—';

const text =
  (key: string) =>
  (row: MetricRow): string => {
    const value = row[key];
    return value === null || value === undefined || value === '' ? DASH : String(value);
  };

const count =
  (key: string) =>
  (row: MetricRow): string =>
    formatCount(Number(row[key] ?? 0));

/** A 0–1 ratio as a percent. NEVER for a value already in percent units. */
const share =
  (key: string, digits = 1) =>
  (row: MetricRow): string =>
    formatShare(Number(row[key] ?? 0), digits);

const millis =
  (key: string) =>
  (row: MetricRow, translate: MetricTranslate): string =>
    formatMs(Number(row[key] ?? 0), translate('admin:units.ms'));

/** Hours, one decimal. `null` is `—`: "nothing resolved" is not "zero hours". */
const hours =
  (key: string) =>
  (row: MetricRow, translate: MetricTranslate): string => {
    const value = row[key];
    if (value === null || value === undefined) return DASH;
    return `${formatDecimal(Number(value), getIntlLocale())} ${translate('analytics:units.hours')}`;
  };

/* Comparator sources (see `MetricColumn.accessor` — never the formatted text). */
const num =
  (key: string) =>
  (row: MetricRow): number | null => {
    const value = row[key];
    // `null` stays `null` so `compareRows` sinks it, rather than becoming a 0
    // that claims a project resolved everything instantly.
    return value === null || value === undefined ? null : Number(value);
  };

const str =
  (key: string) =>
  (row: MetricRow): string =>
    String(row[key] ?? '');

/**
 * Buckets sort by their RAW timestamp where the loader kept one (`Jul 3` before
 * `Jul 10`, which a lexical label sort gets backwards), falling back to the
 * label for the hour-of-day metric whose `00:00…23:00` labels already sort.
 */
const bucketOrder = (row: MetricRow): string => String(row.t ?? row.label ?? '');

/** The `{ t, value }` bucket table every time-series metric shares. */
function bucketColumns(
  headerKey: AnalyticsKey,
  format: (row: MetricRow, translate: MetricTranslate) => string,
): MetricColumn[] {
  return [
    {
      key: 'bucket',
      headerKey: 'analytics:columns.bucket',
      value: text('label'),
      accessor: bucketOrder,
      enableHiding: false,
    },
    { key: 'value', headerKey, align: 'end', value: format, accessor: num('value') },
  ];
}

/* ------------------------------------------------------------------ */
/* Filter / sort / page                                                */
/* ------------------------------------------------------------------ */

function applyFilters(
  rows: MetricRow[],
  filters: Record<string, string>,
  configs: MetricFilterConfig[],
): MetricRow[] {
  return configs.reduce((acc, config) => {
    const value = filters[config.key];
    return value ? acc.filter((row) => config.match(row, value)) : acc;
  }, rows);
}

/**
 * Nullish/blank LAST in both directions — an absent value is not a small one.
 *
 * The same rule (and the same reasoning) as `DataTable.compareValues`, restated
 * here rather than imported so the registry keeps its one-way dependency on the
 * grid: this module must stay importable by a node-environment test that never
 * loads TanStack, dnd-kit or a single React component.
 */
export function compareRows(a: unknown, b: unknown, dir: 1 | -1): number {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty || bEmpty) return aEmpty && bEmpty ? 0 : aEmpty ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return dir * (a - b);
  return dir * String(a).localeCompare(String(b));
}

/**
 * Order the FULL filtered row set before it is paged. A column with no
 * `accessor` (and an empty sort) leaves the loader's own order alone — the
 * honest default, since the bucket loaders already hand back newest-first and
 * the latency ladder's order IS its meaning.
 */
export function sortRows(
  rows: MetricRow[],
  sort: MetricSortState | undefined,
  columns: MetricColumn[],
): MetricRow[] {
  if (!sort?.sort) return rows;
  const accessor = columns.find((column) => column.key === sort.sort)?.accessor;
  if (!accessor) return rows;
  const dir = sort.order === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => compareRows(accessor(a), accessor(b), dir));
}

function pageOf(
  rows: MetricRow[],
  page: number,
): Pick<MetricPage, 'rows' | 'total' | 'page' | 'pageSize'> {
  const safePage = Math.max(1, page);
  const start = (safePage - 1) * METRIC_PAGE_SIZE;
  return {
    rows: rows.slice(start, start + METRIC_PAGE_SIZE),
    total: rows.length,
    page: safePage,
    pageSize: METRIC_PAGE_SIZE,
  };
}

/** Resolve a facet's choices — static list, or derived from the loaded rows. */
export function resolveFacetOptions(config: MetricFilterConfig, rows: MetricRow[]): MetricOption[] {
  return typeof config.options === 'function' ? config.options(rows) : config.options;
}

/** What `FacetFilter` renders: `{ value, label }`, translated where needed. */
export function optionsOf(
  options: MetricOption[],
  translate: MetricTranslate,
): { value: string; label: string }[] {
  return options.map((option) => ({
    value: option.value,
    label: option.labelKey ? translate(option.labelKey) : (option.label ?? option.value),
  }));
}

/**
 * Builds a definition whose `fetch` loads once, then FILTERS → SORTS → PAGES.
 *
 * The order is the whole point: filtering before sorting keeps a facet from
 * reordering rows it removed, and sorting before paging is what makes page 2 of
 * a sorted table the real page 2.
 */
function defineMetric(
  args: Omit<MetricDefinition, 'fetch'> & {
    load: (window: AnalyticsWindow) => Promise<{ points: MetricPoint[]; rows: MetricRow[] }>;
  },
): MetricDefinition {
  const { load, ...definition } = args;
  const configs = definition.filters ?? [];

  return {
    ...definition,
    fetch: async (window, filters, page, sort) => {
      const { points, rows } = await load(window);
      const facetOptions = Object.fromEntries(
        configs.map((config) => [config.key, resolveFacetOptions(config, rows)]),
      );
      const ordered = sortRows(applyFilters(rows, filters, configs), sort, definition.columns);
      return { points, exportRows: ordered, facetOptions, ...pageOf(ordered, page) };
    },
  };
}

/* ------------------------------------------------------------------ */
/* Domain loaders — one call per domain, projected many ways            */
/* ------------------------------------------------------------------ */

/** One round trip for a whole domain, zod-parsed at the boundary. */
async function getDomain<T>(
  domain: AnalyticsDomain,
  schema: ZodType<T>,
  window: AnalyticsWindow,
): Promise<T> {
  return api.get<T>(`/admin/analytics/${domain}`, {
    schema,
    query: { from: window.from, to: window.to, interval: window.interval },
  });
}

/**
 * The last payload fetched per domain, keyed by its exact window.
 *
 * ═══ WHY THIS IS NOT AN OPTIMISATION ═════════════════════════════════════
 *
 * It is what makes the module banner's second claim TRUE. Without it, "filters
 * and paging are client-side" is only half honest: the projection happens in
 * the browser, but `fetch()` re-ran `defineMetric`'s `load()` on every facet
 * click, every sort toggle and every page step — so narrowing a table to one
 * HTTP method re-ran a `generate_series` aggregate over `request_logs`. The
 * payload had not changed; only the predicate over it had.
 *
 * ═══ THE THREE RULES ═════════════════════════════════════════════════════
 *
 *  - **A REJECTION IS NEVER CACHED.** The detail page's only retry is the error
 *    state's button, and a cached failure would make that button a no-op
 *    forever.
 *  - **ONE ENTRY PER DOMAIN.** A drill-down reads one window at a time, so a
 *    new window evicts the old rather than accumulating; an unbounded map on a
 *    page somebody leaves open all day is a leak with extra steps.
 *  - **THE PROMISE IS CACHED, NOT THE VALUE.** Two metrics of one domain
 *    mounted in the same frame share the in-flight request instead of racing
 *    two identical ones.
 *
 * Staleness is bounded by the range picker: changing the window changes the
 * key. The four dashboards do not read this at all — `useAnalyticsStore` is
 * their cache, and it has its own explicit `force` path for auto-refresh.
 */
const domainCache = new Map<string, Promise<unknown>>();

/** TEST SEAM: the map is module-global and would leak across cases. */
export function __clearMetricDomainCache(): void {
  domainCache.clear();
}

function cachedDomain<T>(
  domain: AnalyticsDomain,
  schema: ZodType<T>,
  window: AnalyticsWindow,
): Promise<T> {
  const key = `${domain}|${window.from}|${window.to}|${window.interval}`;
  const hit = domainCache.get(key);
  if (hit) return hit as Promise<T>;

  const promise = getDomain<T>(domain, schema, window).catch((error: unknown) => {
    domainCache.delete(key);
    throw error;
  });

  for (const existing of [...domainCache.keys()]) {
    if (existing.startsWith(`${domain}|`)) domainCache.delete(existing);
  }
  domainCache.set(key, promise);
  return promise;
}

const loadDomain = {
  engagement: (w: AnalyticsWindow): Promise<AnalyticsEngagement> =>
    cachedDomain('engagement', analyticsEngagementSchema, w),
  work: (w: AnalyticsWindow): Promise<AnalyticsWork> =>
    cachedDomain('work', analyticsWorkSchema, w),
  traffic: (w: AnalyticsWindow): Promise<AnalyticsTraffic> =>
    cachedDomain('traffic', analyticsTrafficSchema, w),
  growth: (w: AnalyticsWindow): Promise<AnalyticsGrowth> =>
    cachedDomain('growth', analyticsGrowthSchema, w),
};

/**
 * Series → chart points + a NEWEST-FIRST table of the same buckets.
 *
 * The rows keep the RAW `t` alongside the display label purely so the Bucket
 * column can sort chronologically (see `bucketOrder`); nothing renders it.
 */
export function fromSeries(
  series: readonly { t: string; value: number }[],
  interval: WindowInterval,
): { points: MetricPoint[]; rows: MetricRow[] } {
  const points = series.map((point) => ({
    label: bucketLabel(point.t, interval),
    value: point.value,
  }));
  const rows: MetricRow[] = series.map((point, index) => ({
    t: point.t,
    label: points[index]?.label ?? point.t,
    value: point.value,
  }));
  return { points, rows: rows.reverse() };
}

/* ------------------------------------------------------------------ */
/* Facet vocabularies                                                  */
/* ------------------------------------------------------------------ */

/** The closed telemetry vocabulary, labelled from the events feed's own keys. */
const EVENT_TYPE_OPTIONS: MetricOption[] = telemetryEventTypeSchema.options.map((type) => ({
  value: type,
  labelKey: `admin:eventType.${type}` as const,
}));

/** The verbs FlowBoard's API actually serves. Identifiers, never translated. */
const METHOD_OPTIONS: MetricOption[] = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].map((method) => ({
  value: method,
  label: method,
}));

/** The four HTTP status classes — the same four `statusBreakdown` always sends. */
export const STATUS_CLASSES = ['2xx', '3xx', '4xx', '5xx'] as const;

const STATUS_CLASS_OPTIONS: MetricOption[] = STATUS_CLASSES.map((cls) => ({
  value: cls,
  label: cls,
}));

/** Organizations, derived from the rows: a closed list would be a lie. */
function orgOptionsFrom(rows: MetricRow[]): MetricOption[] {
  const seen = new Map<string, string>();
  for (const row of rows) {
    const slug = row.orgSlug;
    if (typeof slug !== 'string' || seen.has(slug)) continue;
    seen.set(slug, typeof row.orgName === 'string' ? row.orgName : slug);
  }
  return [...seen]
    .sort(([, a], [, b]) => a.localeCompare(b))
    .map(([value, label]) => ({ value, label }));
}

/* ------------------------------------------------------------------ */
/* Engagement                                                          */
/* ------------------------------------------------------------------ */

const engagement = {
  dau: defineMetric({
    titleKey: 'analytics:metrics.engagement.dau.title',
    subtitleKey: 'analytics:metrics.engagement.dau.subtitle',
    series: { labelKey: 'analytics:series.activeUsers', color: 2 },
    columns: bucketColumns('analytics:columns.activeUsers', count('value')),
    csv: { stem: 'flowboard-engagement-dau' },
    backTo: DOMAIN_PATHS.engagement,
    load: async (window) =>
      fromSeries((await loadDomain.engagement(window)).dauSeries, window.interval),
  }),

  signups: defineMetric({
    titleKey: 'analytics:metrics.engagement.signups.title',
    subtitleKey: 'analytics:metrics.engagement.signups.subtitle',
    series: { labelKey: 'analytics:series.signups', color: 1 },
    columns: bucketColumns('analytics:columns.signups', count('value')),
    csv: { stem: 'flowboard-engagement-signups' },
    backTo: DOMAIN_PATHS.engagement,
    load: async (window) =>
      fromSeries((await loadDomain.engagement(window)).signupsSeries, window.interval),
  }),

  stickiness: defineMetric({
    titleKey: 'analytics:metrics.engagement.stickiness.title',
    subtitleKey: 'analytics:metrics.engagement.stickiness.subtitle',
    // A 0–1 ratio, so the tooltip formats it as a percent rather than as
    // "0.0417 active users" — the one series in this domain that is not a count.
    series: {
      labelKey: 'analytics:series.stickiness',
      color: 3,
      format: (value) => formatShare(value, 1),
    },
    columns: bucketColumns('analytics:columns.stickiness', share('value')),
    csv: { stem: 'flowboard-engagement-stickiness' },
    backTo: DOMAIN_PATHS.engagement,
    load: async (window) =>
      fromSeries((await loadDomain.engagement(window)).stickinessSeries, window.interval),
  }),

  'activity-by-hour': defineMetric({
    titleKey: 'analytics:metrics.engagement.activity-by-hour.title',
    subtitleKey: 'analytics:metrics.engagement.activity-by-hour.subtitle',
    series: { labelKey: 'analytics:series.events', color: 4, kind: 'bar' },
    columns: [
      {
        key: 'hour',
        headerKey: 'analytics:columns.utcHour',
        value: text('label'),
        accessor: bucketOrder,
        mono: true,
        enableHiding: false,
      },
      {
        key: 'value',
        headerKey: 'analytics:columns.events',
        align: 'end',
        value: count('value'),
        accessor: num('value'),
      },
    ],
    csv: { stem: 'flowboard-engagement-activity-by-hour' },
    backTo: DOMAIN_PATHS.engagement,
    load: async (window) => {
      const { activityByHour } = await loadDomain.engagement(window);
      // `00:00`…`23:00`: a fixed-width, digit-only label that sorts correctly as
      // text, which is why this metric alone needs no raw `t` on its rows.
      const points = activityByHour.map((bucket) => ({
        label: `${String(bucket.hour).padStart(2, '0')}:00`,
        value: bucket.value,
      }));
      return { points, rows: points.map((point) => ({ ...point })) };
    },
  }),

  'events-by-type': defineMetric({
    titleKey: 'analytics:metrics.engagement.events-by-type.title',
    subtitleKey: 'analytics:metrics.engagement.events-by-type.subtitle',
    series: { labelKey: 'analytics:series.events', color: 5, kind: 'bar' },
    columns: [
      {
        key: 'type',
        headerKey: 'analytics:columns.eventType',
        // Fully reactive: the row keeps the wire identifier and the CELL
        // translates it, so a language switch relabels the table without a
        // refetch. The chart's x-axis labels cannot do this (see `load`).
        value: (row, translate) =>
          typeof row.type === 'string'
            ? translate(`admin:eventType.${row.type as TelemetryEventType}`)
            : DASH,
        accessor: str('type'),
        enableHiding: false,
      },
      {
        // The WIRE identifier, beside the translated name in the column above.
        // Its own header (R2 W3.5): sharing `eventType` printed "Event" twice
        // in the table and, worse, twice in the CSV — two identically-named
        // columns in a file somebody is about to sort.
        key: 'wire',
        headerKey: 'analytics:columns.eventTypeId',
        value: text('type'),
        accessor: str('type'),
        mono: true,
      },
      {
        key: 'value',
        headerKey: 'analytics:columns.events',
        align: 'end',
        value: count('value'),
        accessor: num('value'),
      },
      {
        key: 'share',
        headerKey: 'analytics:columns.share',
        align: 'end',
        value: share('share'),
        accessor: num('share'),
      },
    ],
    filters: [
      {
        key: 'type',
        labelKey: 'analytics:filters.eventType',
        options: EVENT_TYPE_OPTIONS,
        match: (row, value) => row.type === value,
      },
    ],
    csv: { stem: 'flowboard-engagement-events-by-type' },
    backTo: DOMAIN_PATHS.engagement,
    load: async (window) => {
      const { eventsByType } = await loadDomain.engagement(window);
      const total = eventsByType.reduce((sum, entry) => sum + entry.count, 0);
      const rows: MetricRow[] = eventsByType.map((entry) => ({
        // Read per FETCH, not at import — see the module banner's exception.
        label: i18n.t(`admin:eventType.${entry.type}`),
        type: entry.type,
        value: entry.count,
        share: total > 0 ? entry.count / total : 0,
      }));
      return {
        points: rows.map((row) => ({ label: String(row.label), value: Number(row.value) })),
        rows,
      };
    },
  }),
} satisfies Record<string, MetricDefinition>;

/* ------------------------------------------------------------------ */
/* Work                                                                */
/* ------------------------------------------------------------------ */

const work = {
  'tasks-created': defineMetric({
    titleKey: 'analytics:metrics.work.tasks-created.title',
    subtitleKey: 'analytics:metrics.work.tasks-created.subtitle',
    series: { labelKey: 'analytics:series.tasksCreated', color: 1 },
    columns: bucketColumns('analytics:columns.tasksCreated', count('value')),
    csv: { stem: 'flowboard-work-tasks-created' },
    backTo: DOMAIN_PATHS.work,
    load: async (window) =>
      fromSeries((await loadDomain.work(window)).tasksCreatedSeries, window.interval),
  }),

  'tasks-completed': defineMetric({
    titleKey: 'analytics:metrics.work.tasks-completed.title',
    subtitleKey: 'analytics:metrics.work.tasks-completed.subtitle',
    series: { labelKey: 'analytics:series.tasksCompleted', color: 2 },
    columns: bucketColumns('analytics:columns.tasksCompleted', count('value')),
    csv: { stem: 'flowboard-work-tasks-completed' },
    backTo: DOMAIN_PATHS.work,
    load: async (window) =>
      fromSeries((await loadDomain.work(window)).tasksCompletedSeries, window.interval),
  }),

  'cycle-time': defineMetric({
    titleKey: 'analytics:metrics.work.cycle-time.title',
    subtitleKey: 'analytics:metrics.work.cycle-time.subtitle',
    // Hours, not a count — and therefore NOT summable. The formatter is what
    // stops the tooltip reading "1,024" on a duration.
    series: {
      labelKey: 'analytics:series.cycleTime',
      color: 3,
      format: (value, translate) =>
        `${formatDecimal(value, getIntlLocale())} ${translate('analytics:units.hours')}`,
    },
    columns: bucketColumns('analytics:columns.cycleTime', hours('value')),
    csv: { stem: 'flowboard-work-cycle-time' },
    // Work finished FASTER is the good news, like latency above.
    deltaDirection: 'down',
    backTo: DOMAIN_PATHS.work,
    load: async (window) =>
      fromSeries((await loadDomain.work(window)).cycleTimeSeries, window.interval),
  }),

  'points-completed': defineMetric({
    titleKey: 'analytics:metrics.work.points-completed.title',
    subtitleKey: 'analytics:metrics.work.points-completed.subtitle',
    series: { labelKey: 'analytics:series.points', color: 4 },
    columns: bucketColumns('analytics:columns.points', count('value')),
    csv: { stem: 'flowboard-work-points-completed' },
    backTo: DOMAIN_PATHS.work,
    load: async (window) =>
      fromSeries((await loadDomain.work(window)).pointsCompletedSeries, window.interval),
  }),

  'by-project': defineMetric({
    titleKey: 'analytics:metrics.work.by-project.title',
    subtitleKey: 'analytics:metrics.work.by-project.subtitle',
    series: { labelKey: 'analytics:series.tasksCompleted', color: 2, kind: 'bar' },
    columns: [
      {
        key: 'project',
        headerKey: 'analytics:columns.project',
        value: text('projectName'),
        accessor: str('projectName'),
        enableHiding: false,
      },
      {
        key: 'projectKey',
        headerKey: 'analytics:columns.projectKey',
        value: text('projectKey'),
        accessor: str('projectKey'),
        mono: true,
      },
      {
        key: 'org',
        headerKey: 'analytics:columns.org',
        value: text('orgName'),
        accessor: str('orgName'),
      },
      {
        key: 'created',
        headerKey: 'analytics:columns.tasksCreated',
        align: 'end',
        value: count('created'),
        accessor: num('created'),
      },
      {
        key: 'completed',
        headerKey: 'analytics:columns.tasksCompleted',
        align: 'end',
        value: count('completed'),
        accessor: num('completed'),
      },
      {
        key: 'cycleTimeHours',
        headerKey: 'analytics:columns.cycleTime',
        align: 'end',
        value: hours('cycleTimeHours'),
        // `null` sorts LAST in both directions: a project that resolved nothing
        // is not the fastest project in the deployment.
        accessor: num('cycleTimeHours'),
      },
      {
        key: 'points',
        headerKey: 'analytics:columns.points',
        align: 'end',
        value: count('points'),
        accessor: num('points'),
      },
    ],
    filters: [
      {
        key: 'orgSlug',
        labelKey: 'analytics:filters.org',
        options: orgOptionsFrom,
        match: (row, value) => row.orgSlug === value,
      },
    ],
    csv: { stem: 'flowboard-work-by-project' },
    backTo: DOMAIN_PATHS.work,
    load: async (window) => {
      const { byProject } = await loadDomain.work(window);
      const rows: MetricRow[] = byProject.map((project) => ({
        ...project,
        label: project.projectName,
      }));
      // The chart is the TOP TEN by completion; twenty-five bars is a barcode.
      const points = [...byProject]
        .sort((a, b) => b.completed - a.completed)
        .slice(0, 10)
        .map((project) => ({ label: project.projectKey, value: project.completed }));
      return { points, rows };
    },
  }),
} satisfies Record<string, MetricDefinition>;

/* ------------------------------------------------------------------ */
/* Traffic                                                             */
/* ------------------------------------------------------------------ */

/**
 * The percentile ladder, in READING order — p50 through max.
 *
 * Exported because the Traffic dashboard draws the same five rungs as a tile
 * grid rather than a chart, and the two must not disagree about which rungs
 * exist or what order they climb in.
 */
export const LATENCY_LADDER = ['p50', 'p90', 'p95', 'p99', 'max'] as const;

const traffic = {
  requests: defineMetric({
    titleKey: 'analytics:metrics.traffic.requests.title',
    subtitleKey: 'analytics:metrics.traffic.requests.subtitle',
    series: { labelKey: 'analytics:series.requests', color: 2 },
    columns: bucketColumns('analytics:columns.requests', count('value')),
    csv: { stem: 'flowboard-traffic-requests' },
    backTo: DOMAIN_PATHS.traffic,
    load: async (window) =>
      fromSeries((await loadDomain.traffic(window)).requestsSeries, window.interval),
  }),

  errors: defineMetric({
    titleKey: 'analytics:metrics.traffic.errors.title',
    subtitleKey: 'analytics:metrics.traffic.errors.subtitle',
    series: { labelKey: 'analytics:series.errors', color: 5 },
    columns: bucketColumns('analytics:columns.errors', count('value')),
    csv: { stem: 'flowboard-traffic-errors' },
    // Fewer 5xx is the good news. Without this the KPI tile painted a rising
    // error count green (R2 W3.5).
    deltaDirection: 'down',
    backTo: DOMAIN_PATHS.traffic,
    load: async (window) =>
      fromSeries((await loadDomain.traffic(window)).errorSeries, window.interval),
  }),

  'error-rate': defineMetric({
    titleKey: 'analytics:metrics.traffic.error-rate.title',
    subtitleKey: 'analytics:metrics.traffic.error-rate.subtitle',
    series: {
      labelKey: 'analytics:series.errorRate',
      color: 5,
      format: (value) => formatShare(value, 2),
    },
    columns: bucketColumns('analytics:columns.errorRate', share('value', 2)),
    csv: { stem: 'flowboard-traffic-error-rate' },
    deltaDirection: 'down',
    backTo: DOMAIN_PATHS.traffic,
    load: async (window) =>
      fromSeries((await loadDomain.traffic(window)).errorRateSeries, window.interval),
  }),

  latency: defineMetric({
    titleKey: 'analytics:metrics.traffic.latency.title',
    subtitleKey: 'analytics:metrics.traffic.latency.subtitle',
    series: {
      labelKey: 'analytics:series.milliseconds',
      color: 3,
      kind: 'bar',
      format: (value, translate) => formatMs(value, translate('admin:units.ms')),
    },
    // NO ACCESSORS, and no CSV. The p50 → max order IS the meaning of this
    // table; a sort that scrambled the percentile ladder would destroy the only
    // thing it communicates, and five rows you can read at a glance do not need
    // to become a file.
    columns: [
      {
        key: 'percentile',
        headerKey: 'analytics:columns.percentile',
        value: text('label'),
        mono: true,
        enableHiding: false,
      },
      {
        key: 'ms',
        headerKey: 'analytics:columns.duration',
        align: 'end',
        value: millis('value'),
      },
    ],
    // Declared even though today's p95 tile carries no delta: the polarity is a
    // fact about latency, not about which tile happens to show it.
    deltaDirection: 'down',
    backTo: DOMAIN_PATHS.traffic,
    load: async (window) => {
      const { latency } = await loadDomain.traffic(window);
      const rows: MetricRow[] = LATENCY_LADDER.map((key) => ({ label: key, value: latency[key] }));
      return {
        points: rows.map((row) => ({ label: String(row.label), value: Number(row.value) })),
        rows,
      };
    },
  }),

  'top-endpoints': defineMetric({
    titleKey: 'analytics:metrics.traffic.top-endpoints.title',
    subtitleKey: 'analytics:metrics.traffic.top-endpoints.subtitle',
    series: { labelKey: 'analytics:series.requests', color: 1, kind: 'bar' },
    columns: [
      {
        key: 'method',
        headerKey: 'analytics:columns.method',
        value: text('method'),
        mono: true,
        accessor: str('method'),
      },
      {
        key: 'path',
        headerKey: 'analytics:columns.path',
        value: text('path'),
        mono: true,
        accessor: str('path'),
        enableHiding: false,
      },
      {
        key: 'value',
        headerKey: 'analytics:columns.requests',
        align: 'end',
        value: count('value'),
        accessor: num('value'),
      },
      {
        key: 'avgDurationMs',
        headerKey: 'analytics:columns.avg',
        align: 'end',
        value: millis('avgDurationMs'),
        accessor: num('avgDurationMs'),
      },
      {
        key: 'errorRate',
        headerKey: 'analytics:columns.errorRate',
        align: 'end',
        value: share('errorRate'),
        accessor: num('errorRate'),
      },
    ],
    filters: [
      {
        key: 'method',
        labelKey: 'analytics:filters.method',
        options: METHOD_OPTIONS,
        match: (row, value) => row.method === value,
      },
    ],
    csv: { stem: 'flowboard-traffic-top-endpoints' },
    backTo: DOMAIN_PATHS.traffic,
    load: async (window) => {
      const { topEndpoints } = await loadDomain.traffic(window);
      const rows: MetricRow[] = topEndpoints.map((endpoint) => ({
        ...endpoint,
        label: `${endpoint.method} ${endpoint.path}`,
        value: endpoint.count,
      }));
      return {
        // The endpoint list arrives sorted by count, so the first ten ARE the
        // top ten. The bar is labelled by path alone: the method is already the
        // column beside it and repeating it doubles every tick's width.
        points: rows.slice(0, 10).map((row) => ({
          label: String(row.path),
          value: Number(row.value),
        })),
        rows,
      };
    },
  }),

  'status-breakdown': defineMetric({
    titleKey: 'analytics:metrics.traffic.status-breakdown.title',
    subtitleKey: 'analytics:metrics.traffic.status-breakdown.subtitle',
    series: { labelKey: 'analytics:series.responses', color: 4, kind: 'bar' },
    columns: [
      {
        key: 'class',
        headerKey: 'analytics:columns.statusClass',
        value: text('label'),
        mono: true,
        accessor: str('label'),
        enableHiding: false,
      },
      {
        key: 'value',
        headerKey: 'analytics:columns.responses',
        align: 'end',
        value: count('value'),
        accessor: num('value'),
      },
      {
        key: 'share',
        headerKey: 'analytics:columns.share',
        align: 'end',
        value: share('share'),
        accessor: num('share'),
      },
    ],
    filters: [
      {
        key: 'statusClass',
        labelKey: 'analytics:filters.statusClass',
        options: STATUS_CLASS_OPTIONS,
        match: (row, value) => row.label === value,
      },
    ],
    csv: { stem: 'flowboard-traffic-status-breakdown' },
    backTo: DOMAIN_PATHS.traffic,
    load: async (window) => {
      const { statusBreakdown } = await loadDomain.traffic(window);
      const entries = STATUS_CLASSES.map((cls) => ({ label: cls, value: statusBreakdown[cls] }));
      const total = entries.reduce((sum, entry) => sum + entry.value, 0);
      return {
        points: entries.map((entry) => ({ ...entry })),
        rows: entries.map((entry) => ({
          ...entry,
          share: total > 0 ? entry.value / total : 0,
        })),
      };
    },
  }),
} satisfies Record<string, MetricDefinition>;

/* ------------------------------------------------------------------ */
/* Growth                                                              */
/* ------------------------------------------------------------------ */

const growth = {
  'orgs-created': defineMetric({
    titleKey: 'analytics:metrics.growth.orgs-created.title',
    subtitleKey: 'analytics:metrics.growth.orgs-created.subtitle',
    series: { labelKey: 'analytics:series.orgs', color: 1 },
    columns: bucketColumns('analytics:columns.orgsCreated', count('value')),
    csv: { stem: 'flowboard-growth-orgs-created' },
    backTo: DOMAIN_PATHS.growth,
    load: async (window) =>
      fromSeries((await loadDomain.growth(window)).orgsCreatedSeries, window.interval),
  }),

  'invites-sent': defineMetric({
    titleKey: 'analytics:metrics.growth.invites-sent.title',
    subtitleKey: 'analytics:metrics.growth.invites-sent.subtitle',
    series: { labelKey: 'analytics:series.invitesSent', color: 4 },
    columns: bucketColumns('analytics:columns.invitesSent', count('value')),
    csv: { stem: 'flowboard-growth-invites-sent' },
    backTo: DOMAIN_PATHS.growth,
    load: async (window) =>
      fromSeries((await loadDomain.growth(window)).invitesSentSeries, window.interval),
  }),

  'invites-accepted': defineMetric({
    titleKey: 'analytics:metrics.growth.invites-accepted.title',
    subtitleKey: 'analytics:metrics.growth.invites-accepted.subtitle',
    series: { labelKey: 'analytics:series.invitesAccepted', color: 2 },
    columns: bucketColumns('analytics:columns.invitesAccepted', count('value')),
    csv: { stem: 'flowboard-growth-invites-accepted' },
    backTo: DOMAIN_PATHS.growth,
    load: async (window) =>
      fromSeries((await loadDomain.growth(window)).invitesAcceptedSeries, window.interval),
  }),

  'by-org': defineMetric({
    titleKey: 'analytics:metrics.growth.by-org.title',
    subtitleKey: 'analytics:metrics.growth.by-org.subtitle',
    series: { labelKey: 'analytics:series.tasks', color: 3, kind: 'bar' },
    columns: [
      {
        key: 'org',
        headerKey: 'analytics:columns.org',
        value: text('orgName'),
        accessor: str('orgName'),
        enableHiding: false,
      },
      {
        key: 'orgSlug',
        headerKey: 'analytics:columns.orgSlug',
        value: text('orgSlug'),
        accessor: str('orgSlug'),
        mono: true,
      },
      {
        key: 'memberCount',
        headerKey: 'analytics:columns.members',
        align: 'end',
        value: count('memberCount'),
        accessor: num('memberCount'),
      },
      {
        key: 'projectCount',
        headerKey: 'analytics:columns.projects',
        align: 'end',
        value: count('projectCount'),
        accessor: num('projectCount'),
      },
      {
        key: 'taskCount',
        headerKey: 'analytics:columns.tasks',
        align: 'end',
        value: count('taskCount'),
        accessor: num('taskCount'),
      },
      {
        key: 'lastActivityAt',
        headerKey: 'analytics:columns.lastActivity',
        // An org created and never touched is precisely the row this table
        // exists to surface, so `null` renders as `—` and sorts LAST rather
        // than being filtered out or pretending to be the epoch.
        value: (row) => {
          const value = row.lastActivityAt;
          return typeof value === 'string' ? formatInstant(value) : DASH;
        },
        accessor: (row) => (typeof row.lastActivityAt === 'string' ? row.lastActivityAt : null),
      },
    ],
    csv: { stem: 'flowboard-growth-by-org' },
    backTo: DOMAIN_PATHS.growth,
    load: async (window) => {
      const { byOrg } = await loadDomain.growth(window);
      const rows: MetricRow[] = byOrg.map((org) => ({ ...org, label: org.orgName }));
      // `byOrg` is ALL-TIME inventory, not a windowed series — see the schema.
      // The bars are the ten biggest by task count, which is the question a
      // "which orgs actually use this deployment" table is asked.
      const points = [...byOrg]
        .sort((a, b) => b.taskCount - a.taskCount)
        .slice(0, 10)
        .map((org) => ({ label: org.orgSlug, value: org.taskCount }));
      return { points, rows };
    },
  }),
} satisfies Record<string, MetricDefinition>;

/* ------------------------------------------------------------------ */
/* The registry                                                        */
/* ------------------------------------------------------------------ */

export const METRIC_REGISTRY = { engagement, work, traffic, growth } as const;

export type MetricRegistry = typeof METRIC_REGISTRY;
export type MetricKey<D extends AnalyticsDomain> = keyof MetricRegistry[D] & string;

/**
 * The drill-down URL for a metric.
 *
 * Typed against the registry on purpose: a tile that links to a metric nobody
 * defined is a TYPE ERROR here rather than an "unknown metric" screen a user
 * discovers. `DOMAIN_PATHS[domain]` rather than a second literal, so a route
 * rename cannot leave the dashboards and the drill-downs pointing at different
 * prefixes.
 */
export function detailPath<D extends AnalyticsDomain>(domain: D, metric: MetricKey<D>): string {
  return `${DOMAIN_PATHS[domain]}/${metric}`;
}

/**
 * Resolve a route's `:domain/:metric` pair; `null` for anything unknown.
 *
 * `Object.hasOwn`, not a plain index, on BOTH segments. These strings come
 * straight off a URL anybody can type, and a plain lookup happily resolves
 * every inherited `Object.prototype` member: `/admin/analytics/traffic/toString`
 * would return a FUNCTION, which the detail page would then treat as a metric
 * definition and crash on `definition.columns`. The friendly not-found card is
 * the correct answer to a hand-typed path, and this is what routes it there.
 */
export function lookupMetric(
  domain: string | undefined,
  metric: string | undefined,
): MetricDefinition | null {
  if (domain === undefined || metric === undefined) return null;
  if (!Object.hasOwn(METRIC_REGISTRY, domain)) return null;
  const entry = (METRIC_REGISTRY as Record<string, Record<string, MetricDefinition>>)[domain];
  if (entry === undefined || !Object.hasOwn(entry, metric)) return null;
  return entry[metric] ?? null;
}

/**
 * The polarity of a metric's trend badge — `'up'` unless the registry says
 * otherwise (R2 W3.5).
 *
 * Takes the loose `string | undefined` pair rather than the typed one because
 * its callers are RENDERING a tile, and a tile's `metric` id is not always a
 * registry key: Traffic's p95 tile is called `p95` and drills into `latency`.
 * An unknown pair therefore has to be an answer, not an error — and `'up'` is
 * the right answer, because it is what a badge with no declared polarity has
 * always meant.
 */
export function metricDeltaDirection(
  domain: string | undefined,
  metric: string | undefined,
): GoodDirection {
  return lookupMetric(domain, metric)?.deltaDirection ?? 'up';
}
