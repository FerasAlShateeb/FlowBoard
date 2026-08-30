# Analytics Console

The global-admin analytics console at `/admin/analytics/*` — four domain
dashboards, twenty drillable metrics, and exactly one drill-down page. It is
built on a **registry**, not on pages: adding a metric is a registry entry plus
two catalog entries, and there is no per-metric endpoint, no per-metric route
component and no per-metric query key.

Read this before touching anything under `/admin/analytics`, before adding a
number to an admin surface, and before deciding whether a question belongs here
or in the ops half of [telemetry.md](./telemetry.md). The recipe for adding a
metric is
[workflows/add-analytics-metric.md](../workflows/add-analytics-metric.md).

## 1. The doctrine

Five rules. Each one exists because the alternative was tried, or because the
GameDash console this was ported from learned it the hard way.

| Rule                                                   | What it means                                                                                                                                                                                                                |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The tile IS the link**                               | A KPI card is a `<Link>` around the whole card (`MetricTile` → `StatTile`'s `to`). A number worth showing on a dashboard is a number somebody will want to open, and a separate "view" affordance is a second thing to find. |
| **Details lives in the header, never around the card** | On a chart card the link is one `<Link>` in `PanelCard`'s toolbar slot. A plot is interactive — hover, tooltip, cursor — and a card-wide anchor swallows every one of those, turning a hover into a navigation.              |
| **No per-metric endpoints**                            | The server exposes **one route per domain**. Twenty metrics over five routes; filtering, sorting and paging all happen in the browser.                                                                                       |
| **One domain call, then client projection**            | A dashboard or a drill-down loads the whole domain payload once and projects the metric out of it. Two metrics of one domain rendered in the same frame share one in-flight request.                                         |
| **A metric is data, not a page**                       | `metric-registry.ts` holds the title key, the series, the columns, the facets, the CSV stem and the loader. `AnalyticsDetailPage` is the only drill-down component in the app and it is looked up, not switched on.          |

The two rules that are easiest to break by accident are the third and fourth,
so they are asserted rather than trusted: `metric-registry.test.ts` fetches
through a real `defineMetric#fetch` and checks the requested URL **does not
contain the metric id**, and that changing a facet issues **no second request**.

## 2. The API — five domain endpoints

Router `apps/api/src/routes/admin-analytics.routes.ts`, mounted at
`/api/admin/analytics` in `apps/api/src/routes/index.ts`. The guard is a
router-wide `adminAnalyticsRouter.use(requireAuth, requireGlobalAdmin)`, so a
route added later cannot be born unguarded — the same arrangement
`admin-telemetry.routes.ts` uses and for the same reason.

| Method | Path                              | Query                  | `data` payload                                                                                                                               |
| ------ | --------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/admin/analytics/overview`   | _(parsed, ignored)_    | `{ users:{total,active30d}, orgs, projects, tasks:{total,completed30d}, eventsSeries (14 daily), requestsSeries (24 hourly), errorRate24h }` |
| `GET`  | `/api/admin/analytics/engagement` | `from`,`to`,`interval` | `{ mau, dauSeries, signupsSeries, stickinessSeries, activityByHour (exactly 24), eventsByType[] }`                                           |
| `GET`  | `/api/admin/analytics/work`       | `from`,`to`,`interval` | `{ tasksCreatedSeries, tasksCompletedSeries, cycleTimeSeries, cycleTimePercentiles:{p50,p90,p95}, pointsCompletedSeries, byProject[] }`      |
| `GET`  | `/api/admin/analytics/traffic`    | `from`,`to`,`interval` | `{ requestsSeries, errorSeries, errorRateSeries, latency:{p50,p90,p95,p99,max}, topEndpoints[], statusBreakdown:{2xx,3xx,4xx,5xx} }`         |
| `GET`  | `/api/admin/analytics/growth`     | `from`,`to`,`interval` | `{ orgsCreatedSeries, invitesSentSeries, invitesAcceptedSeries, acceptanceRate, byOrg[] }`                                                   |

Contracts live in `packages/shared/src/admin-analytics.schema.ts`; the API's
`validation/admin-analytics.validation.ts` **re-exports** them rather than
redefining, so the two ends cannot drift. A series point is
`{ t: isoDateTime, value: number }` (`seriesPointSchema`).

**`overview` is deliberately outside `analyticsDomainSchema`.** The enum is
`['engagement','work','traffic','growth']` — the four domains that have a
registry and therefore a drill-down. `/admin/overview` is a landing page of
fixed windows (14 days of events, 24 hours of requests, a 30-day active-user
count), so a range picker on it would make two people quoting the same headline
number mean different things. `/admin/analytics/overview/anything` lands on the
drill-down's friendly not-found, on purpose.

### 2.1 The window contract

`resolveAnalyticsWindow(query, now)` in
`apps/api/src/services/admin-analytics.service.ts` owns the defaults, so a
direct service call and an HTTP call cannot disagree:

- **Defaults are `DEFAULT_WINDOW_DAYS = 30` ending now, interval `day`.** They
  are applied in the service, not in the zod schema — the schema's three fields
  are all optional.
- **An unparseable instant is a 400**, not a 422: the string parsed fine as an
  ISO date-time, it just does not name a moment.
- **`MAX_BUCKETS = 400`, checked in JavaScript before the query runs.** The
  message names the number and the interval and tells the reader what to change
  ("narrow the range or widen the interval"). Refusing beats silently
  coarsening: a chart labelled "per hour" that is secretly daily is a lie. Note
  the ceiling is 400 here against `/api/admin/telemetry`'s 1 500 — the console
  draws ~10–100 points per plot by design (§5.2), the ops charts draw a week of
  minutes.
- The gap-fill, half-open bucket and `percentile_cont` decisions are the same
  ones [telemetry.md](./telemetry.md) §7 documents, and for the same reasons.
  Every endpoint returns from **one round trip**; there is no bucketing in
  JavaScript.

### 2.2 One definition that is deliberately not shared

**Cycle time means two different things in two places, and the service header
says so.** The console computes `resolved_at − created_at`; the per-project
reports dashboard (`apps/api/src/services/reports.service.ts`) starts the clock
at the task's first entry into an `in_progress` status, read off the activity
stream. Same unit (hours), different question — "how long from filing to done"
versus "how long once we started". **Do not reconcile them by editing one**;
cite which surface a number came from.

## 3. The registry — `apps/web/src/components/admin/analytics/metric-registry.ts`

### 3.1 `MetricDefinition`

```ts
export interface MetricDefinition {
  titleKey: AnalyticsKey; // analytics:metrics.<domain>.<metric>.title
  subtitleKey?: AnalyticsKey;
  series?: MetricSeriesConfig; // absent ⇒ a table-only drill-down
  columns: MetricColumn[];
  filters?: MetricFilterConfig[];
  csv?: MetricCsvConfig; // absent ⇒ no export button
  backTo: string; // DOMAIN_PATHS[domain] — the dashboard to return to
  fetch: MetricFetch;
}
```

`defineMetric` takes everything above **except** `fetch`, plus a
`load(window) => { points, rows }`, and synthesizes the `fetch` around it:

```text
load once  →  resolve facet options from the UNFILTERED rows
           →  applyFilters  →  sortRows (the WHOLE set)  →  pageOf
```

**The order is the contract.** Facet options come from the unfiltered rows, so
choosing one value does not erase the others from the menu. The sort runs over
the whole filtered set **before** the slice, because sorting the twenty-five
rows already on screen would make page 2 of a sort a reshuffle rather than the
real page 2. `exportRows` carries the entire filtered set, not the page (§5.4).

Supporting shapes worth knowing: `MetricColumn { key, headerKey, align?, value,
accessor?, mono?, enableHiding? }` — an `accessor` is what makes a column
sortable, and a column without one keeps the loader's order (the latency ladder
is unsorted by design, since p50 → max is the reading order). `MetricFilterConfig
{ key, labelKey, options, match }` — `options` may be a function of the rows,
which is how the by-project and top-endpoints facets stay in step with the data.

### 3.2 The twenty metrics

`METRIC_REGISTRY = { engagement, work, traffic, growth }`, each a plain object
`satisfies Record<string, MetricDefinition>`. `MetricKey<D>` is
`keyof MetricRegistry[D] & string`, so `detailPath(domain, metric)` cannot name
a metric that does not exist.

| Domain       | Metrics                                                                                 |
| ------------ | --------------------------------------------------------------------------------------- |
| `engagement` | `dau` · `signups` · `stickiness` · `activity-by-hour` · `events-by-type`                |
| `work`       | `tasks-created` · `tasks-completed` · `cycle-time` · `points-completed` · `by-project`  |
| `traffic`    | `requests` · `errors` · `error-rate` · `latency` · `top-endpoints` · `status-breakdown` |
| `growth`     | `orgs-created` · `invites-sent` · `invites-accepted` · `by-org`                         |

`metric-registry.test.ts` pins the exact twenty ids **and** their count, so
adding one is a deliberate edit in two places rather than a silent drift.

### 3.3 Lookup is `Object.hasOwn`, never a plain index

`lookupMetric(domain, metric)` and `metricTitleKey(domain, metric)` both guard
with a pair of `Object.hasOwn` checks and return `null` for anything else.
**These two strings come off a URL.** A plain index would resolve
`/admin/analytics/traffic/toString` to `Object.prototype.toString` and
`/admin/analytics/constructor/dau` to a function — the first renders something
nonsensical, the second can throw. The tests name both cases explicitly.

## 4. The key layer — `metric-catalog.ts`

`apps/web/src/components/admin/analytics/metric-catalog.ts` is the registry's
**pure half**: the `LeafPath` type, `AnalyticsKey`, and `metricTitleKey()`. It
imports the English catalog and nothing else.

```ts
type LeafPath<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafPath<T[K]>}`;
}[keyof T & string];

export type AnalyticsKey = `analytics:${LeafPath<typeof enAnalytics>}`;
export type MetricTitleKey = Extract<AnalyticsKey, `analytics:metrics.${string}.title`>;
```

**Why it is a separate module from the registry.** `metric-registry.ts` holds
`load()` functions, so importing it drags in `lib/api` and a live i18next
instance. `components/navigation/breadcrumb-trail.ts` needs exactly one fact the
registry owns — what a metric is _called_, so
`/admin/analytics/engagement/dau` breadcrumbs as "… › Engagement › Daily active
users" instead of the prettified segment "Dau" — and its whole value is being a
pure function of a URL, testable in a node environment with nothing booted. The
catalog gives it that fact for the price of one object import.

**The catalog is a faithful proxy for the registry's id set, and that is
enforced, not hoped for:** `metric-registry.test.ts` asserts a
`metrics.<domain>.<metric>` catalog entry for every registry id **and no
orphans**, in both directions. The catalog's own header names that test, because
if it ever goes the module's premise goes with it.

`metric-registry.ts` re-exports `AnalyticsKey`, `LeafPath` and `MetricTitleKey`,
so an existing `import { type AnalyticsKey } from './metric-registry'` still
compiles. See [i18n.md](./i18n.md) §2.5 for the wider "typed-literal key config
module" pattern this belongs to — and for `AdminReuseKey`, the two `admin:` keys
the console deliberately reuses rather than re-minting.

## 5. The client

### 5.1 The domain payload cache

```ts
const domainCache = new Map<string, Promise<unknown>>();
// key: `${domain}|${window.from}|${window.to}|${window.interval}`
```

Three rules, all stated at the definition:

- **The promise is cached, not the value.** Two metrics of one domain mounted in
  the same frame share the in-flight request rather than racing two identical
  ones — whichever asks first creates the entry and the rest await it.
- **A rejection is never cached.** The drill-down's only retry is its error
  state's button, and a cached failure would make that button a no-op forever.
- **One entry per domain.** A new window evicts the old rather than
  accumulating, because a drill-down reads one window at a time and an unbounded
  map on a page somebody leaves open all day is a leak with extra steps.

**This is what makes "filters and paging are client-side" true rather than half
true.** Without it the projection still happened in the browser, but `fetch()`
re-ran `defineMetric`'s `load()` on every facet click, every sort toggle and
every page step — so narrowing a table to one HTTP method re-ran a
`generate_series` aggregate over `request_logs` for a payload that had not
changed. Staleness is bounded by the range picker: changing the window changes
the key.

**The four dashboards do not read this cache at all** — `useAnalyticsStore` is
theirs (§5.2), with its own explicit `force` path for auto-refresh. The domain
cache serves the drill-down page. `__clearMetricDomainCache()` is the test seam;
the map is module-global and would otherwise leak across cases.

### 5.2 The shared range — `apps/web/src/stores/useAnalyticsStore.ts`

One `RangeValue` shared across all four dashboards, plus one `DomainSlot` per
domain (`{ status, error, data, loadedKey }`), in Zustand, unpersisted.

- **The window is shared because the four dashboards are one investigation.**
  Switching from Engagement to Traffic must not silently reset the range you
  just widened. The drill-down page is the deliberate exception — see §6.
- **The cache key is the preset, not the resolved window.**
  `rangeKeyOf(range) = ` `` `${preset}|${from ?? ''}|${to ?? ''}` `` — because
  `windowFor()` resolves `30d` against the clock at request time, so a resolved
  `from`/`to` pair changes every millisecond and would never hit.
- `HOURLY_UP_TO_DAYS = { engagement: 2, work: 2, traffic: 7, growth: 2 }` —
  traffic alone keeps hourly buckets out to a week, because a traffic question
  is usually about a spike. `intervalForSpan` in
  `components/dashboard/range.ts` then coarsens: daily to 45 days, weekly to
  200, monthly beyond. The target is 10–100 points on a plot.

### 5.3 Cold vs warm — the reason this is not TanStack Query

**Cold means "I have never had data", not "a request is in flight."**

```ts
status: slot.data === null ? 'loading' : slot.status; // only a COLD slot flips
```

A warm refresh — a range change, the 30-second auto-refresh, a Back into a
dashboard — keeps the previous numbers on screen while it re-reads. A cold slot
renders `KpiSkeleton` / `PanelCard`'s skeleton.

TanStack Query's `isPending` is false during a background refetch, so a
query-driven page cannot tell "I have never had data" from "I have last
minute's data and am re-reading" without a second piece of state. That is the
whole reason the four drillable dashboards use a bespoke store.
`/admin/overview` — which has no shared window — **does** use react-query, with
`placeholderData: keepPreviousData` for the same warm effect, keyed
`qk.analytics.domain('overview', '')`.

The same word carries into the charts: `useColdChart()` is what makes a Recharts
plot animate on a first paint and never re-animate on a refresh. See
[motion.md](./motion.md) §4, entry `report-chart-cold-draw`.

### 5.4 CSV

Every export goes through `downloadCsvBlob` in
`components/dashboard/save-blob.ts` and `toCsv` / `csvFilename` in `lib/csv.ts`.
**There is no export endpoint**, deliberately: these payloads are already in the
browser, and a `/export.csv` route would be a second source of truth for the
same rows. The file's headers are the table's headers, translated, built from
the registry's own `columns` — and the rows are the **whole filtered set** in
sort order, never the visible page.

## 6. The pages

| Route                              | File                                      | Shape                                                                                                      |
| ---------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `/admin/analytics/engagement`      | `pages/admin/AnalyticsEngagementPage.tsx` | KPI row of `MetricTile`s → a grid of `DrillChartCard`s. Shared range picker in the header.                 |
| `/admin/analytics/work`            | `pages/admin/AnalyticsWorkPage.tsx`       | Same shape; the percentile ladder is a panel, not a chart.                                                 |
| `/admin/analytics/traffic`         | `pages/admin/AnalyticsTrafficPage.tsx`    | Same shape; endpoint paths are LTR islands (§8).                                                           |
| `/admin/analytics/growth`          | `pages/admin/AnalyticsGrowthPage.tsx`     | Same shape; `byOrg` is an all-time inventory, not window-scoped.                                           |
| `/admin/analytics/:domain/:metric` | `pages/admin/AnalyticsDetailPage.tsx`     | The one drill-down: range picker → chart → facet row → `DataTable` → CSV, all looked up from the registry. |

Four decisions in `AnalyticsDetailPage` are worth knowing before you change it:

- **An unknown pair is a card, not a crash.** These URLs get bookmarked and
  pasted into incident channels and outlive a rename, so a stale one renders a
  friendly not-found with a way back. A blank screen tells the reader nothing
  about whether the link is wrong or the console is broken.
- **The drill-down's range is LOCAL.** A drill-down is a different
  investigation — "the spike, up close" — and widening to 90 d to find its shape
  must not rewrite the window on the dashboard you will click Back to.
- **Client-paged, server-shaped.** The table is handed a `meta`, which puts
  `DataTable` in manual mode, so TanStack sorts nothing here; the sort state
  travels back into `definition.fetch` (§3.1).
- **Every filter, sort and range change resets to page 1.** Narrowing while on
  page 7 otherwise lands on a page that no longer exists, which renders as an
  empty table indistinguishable from "there is nothing here".

`AutoRefreshSwitch` (`components/admin/analytics/AutoRefreshSwitch.tsx`) is
**opt-in and off by default**, at 30 s. A dashboard that moves under a reader
who is mid-sentence about it is worse than one they have to reload.

## 7. Charts — `components/admin/analytics/MetricChart.tsx`

`METRIC_CHART_HEIGHT = 240`, the same number `PanelCard`'s
`DEFAULT_CHART_HEIGHT` and `components/admin/ops-panel.ts`'s `OPS_CHART_BODY`
(`h-60`) use, so a console page's plots line up whichever component drew them.

Three exported predicates carry rules that a test can assert without rendering
Recharts into a zero-sized jsdom box:

| Export                      | Decides                                                                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hasSignal(rows, series)`   | Whether anything is worth charting. **Gap-filled series mean "no activity" arrives as real zeroes**, so emptiness is a predicate over the VALUES, never over the array length.           |
| `allIntegers(rows, series)` | Whether every plotted number is whole — i.e. whether this is a **count**. Feeds the y-axis's `allowDecimals`, so a count axis never grows a `2.5`. An all-missing series answers `true`. |
| `pointRows` / `pointSeries` | `MetricPoint[]` → the single-series row shape and its descriptor, so a registry entry never hand-builds either.                                                                          |

**A bucket caption belongs only on a time axis.** `AnalyticsDetailPage` renders
`analytics:detail.perInterval` ("Per day.") only when
`(definition.series.kind ?? 'line') === 'line'`. A `bar` in this registry is a
categorical breakdown — one bar per project, per org, per hour-of-day, per
status class — whose x-axis is not time at all, and "Delivery by project · Per
day." over four project bars answers a question nobody asked, wrongly. `kind` is
the registry's own discriminator for exactly that distinction, so it is read
rather than re-derived from a list of metric ids that would go stale.

Colours come from the `--chart-*` roles like every other chart in the app —
never a literal, never `getComputedStyle`. See
[design-system.md](./design-system.md) §6.

## 8. RTL and i18n

- **Every string in the console is a key**, and the registry stores keys rather
  than copy: `titleKey`, `subtitleKey`, `headerKey`, `labelKey`. They are typed
  as `AnalyticsKey`, so a renamed catalog entry is a compile error (§4).
- **Both catalogs are asserted at runtime.** English is the type authority and
  Arabic is never typed against, so `metric-registry.test.ts` resolves every key
  the registry emits against **`en` and `ar`**, plus `DOMAIN_LABEL_KEYS`,
  `DOMAIN_ERROR_KEYS` and `INTERVAL_LABEL_KEYS`.
- **Two LTR islands are new in this console** and are listed in
  [i18n.md](./i18n.md) §7.4: `StatDelta`'s numeric badge (a leading `+`/`-` is a
  BiDi-neutral character, so `+12.5%` rendered as `12.5%+` in Arabic — a
  footnote marker rather than a rise), and endpoint paths in
  `AnalyticsTrafficPage` / `TopEndpointsTable` (a leading slash at the reading
  end of an RTL run turns `/api/tasks` into `api/tasks/`).
- Numbers go through `components/dashboard/format.ts`, which applies
  `getIntlLocale()` over `lib/format.ts` — Western digits in both languages.

## 9. Testing

| File                                                                                         | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/routes/__tests__/admin-analytics.routes.test.ts`                               | The global-admin gate on all five paths; the shared window contract (interval enum, malformed instant 400, reversed window, the bucket ceiling, the 30 d/daily default); then hand-worked figures per endpoint — stickiness, cycle time, error rate, acceptance rate, soft-delete invisibility, gap-filled zeros, NULL-vs-zero percentiles                                                                                                                       |
| `apps/api/src/routes/__tests__/admin-analytics-test-app.ts`                                  | `buildAnalyticsTestApp()` plus time-explicit seeders (`seedAnalyticsUser/Org/Project/Task/Invite`, `seedMembership`, `seedDoneStatus`) — every one takes an explicit instant, because the aggregations are about time                                                                                                                                                                                                                                            |
| `apps/web/src/components/admin/analytics/metric-registry.test.ts`                            | Shape (four domains, the exact twenty ids, `backTo`, unique column keys); **i18n exhaustiveness over both catalogs, both directions**; `detailPath`/`lookupMetric` including the `Object.hasOwn` guards; `compareRows`/`sortRows` (nullish last, numeric not lexical); and `fetch` — one request per domain, no second request on a facet change, two metrics sharing one in-flight promise, rejections not cached, `exportRows` carrying the whole filtered set |
| `MetricChart.test.tsx` · `MetricTile.test.tsx`                                               | The chart predicates and the tile-is-the-link contract                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/web/src/stores/useAnalyticsStore.test.ts`                                              | Cold/warm, the preset cache key, monotonic load sequencing                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/web/src/pages/admin/AnalyticsDetailPage.test.tsx` · `AnalyticsEngagementPage.test.tsx` | The page-level shapes, the not-found card, page-1 resets                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/web/src/components/dashboard/range.test.ts`                                            | `windowFor` / `intervalForSpan` / `rangeLabel`                                                                                                                                                                                                                                                                                                                                                                                                                   |

## 10. Where the ops half ends and the console begins

Both live under `/admin` and both read the same two tables, and the split is by
**question**, not by data:

| Surface                                         | Answers                                                                                               | Docs                           |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------ |
| `/api/admin/telemetry/*` + `/admin/telemetry*`  | "What exactly happened, and is the server healthy right now?" — the raw event feed, requests, latency | [telemetry.md](./telemetry.md) |
| `/api/admin/analytics/*` + `/admin/analytics/*` | "How is the product doing over a window?" — engagement, delivery, traffic shape, growth               | this file                      |

Consequences worth remembering:

- **The events feed keeps an "All time" affordance the console cannot express.**
  `TELEMETRY_FILTER_PRESETS` includes `'all'`; the console's vocabulary is
  `7d/30d/90d/12m` plus a custom calendar. A feed's most common use is "find the
  event I am looking for", and a hidden window turns "I cannot find last month's
  login" into a support ticket. That is also why
  `components/admin/TelemetryRangePicker.tsx` survived the migration onto
  `components/dashboard/RangePicker` — see [design-system.md](./design-system.md)
  §10.3 for the three range vocabularies and which question each answers.
- **`/admin/telemetry` and `/admin/telemetry/requests` are the ops pages**, now
  drawn with `PanelCard` + `OPS_CHART_BODY` rather than `ReportCard`.
- **The telemetry endpoints were not replaced.** The five
  `/api/admin/telemetry/*` routes still exist and still own the feed and the ops
  charts; the console is additive.

## 11. Polarity, and the events feed's Project column

Both of this section's former open items closed in R2 W3.5. What replaced them is
a rule each, worth knowing before touching either surface.

### 11.1 A trend badge's polarity lives in the registry

Some metrics improve as they FALL — error rate, error count, p95 latency, cycle
time — so a green `+18%` on those tiles says the opposite of what happened.
`StatDelta` takes `goodDirection?: 'up' | 'down'` (default `'up'`), and the split
is what makes it safe:

- **the arrow and `data-direction` follow the SIGN.** A number that fell always
  draws a down arrow. That is a statement of fact and never changes meaning.
- **the colour and `data-tone` (`good` / `bad` / `flat`) follow the JUDGEMENT**,
  which is `sign === goodDirection`.

So a falling error rate is a **down arrow in green**. The old objection — "the
same `+18%` would get two colours depending on which card it landed on" — is
answered by that split: the two cards also draw two different arrows and expose
two different `data-tone`s, so nothing is silently re-coloured.

**The fact itself is not in the component.** `MetricDefinition.deltaDirection`
declares it, one line next to the metric's own title, columns and loader;
`MetricTile` reads it through `metricDeltaDirection(domain, metric)`, so a KPI
tile and the drill-down it links to cannot disagree. Marked `'down'` today:
`traffic.errors`, `traffic.error-rate`, `traffic.latency`, `work.cycle-time`.

`MetricTile.goodDirection` is an explicit override, and exists for exactly one
shape: a tile whose id is not a registry id (Traffic's `p95` tile drills into
`latency`). Everything else declares it on the metric.

### 11.2 The events feed names the project

`telemetryEventRowSchema` carries a nullable `projectName`, joined LEFT in
`admin-telemetry.service` beside the existing `userName`. **Both joins must stay
LEFT**: `user_id` and `project_id` are nullable by design (an `auth_login`
belongs to no project), so an inner join would not blank a cell — it would delete
every platform-level event from an audit feed. A soft-deleted project still
resolves, which is what the feed wants.

`AdminTelemetryEventsPage` renders the name, keeps the id on the cell's `title`,
and exports both (`project` and `projectId` columns in the CSV). The id is
untouched in the payload because the feed's project filter takes it.

## Related docs

- [admin.md](./admin.md) — the instance-admin console the analytics pages sit
  beside, and the nav/breadcrumb model that reaches both.
- [telemetry.md](./telemetry.md) — the two tables, the closed event enum, the
  ops endpoints, and the aggregation math this console reuses.
- [design-system.md](./design-system.md) — the dashboard primitive kit
  (`StatTile`, `PanelCard`, `RangePicker`, `DataTable`, `useGridUrlState`), the
  `ReportCard`-vs-`PanelCard` rule, and the `--chart-*` roles.
- [motion.md](./motion.md) — `report-chart-cold-draw`, the registry entry behind
  a chart that animates once.
- [i18n.md](./i18n.md) — typed-literal key config modules, and the LTR islands
  this console added.
- [../workflows/add-analytics-metric.md](../workflows/add-analytics-metric.md) —
  the recipe.

Back to [docs/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
