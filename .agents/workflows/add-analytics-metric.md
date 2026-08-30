# Workflow: Add an analytics metric

Adds a metric to the `/admin/analytics` console without breaking the four things
that hold it together: **one endpoint per domain**, a **registry entry rather
than a page**, **typed i18n keys in both catalogs**, and an **exhaustiveness
test that fails on a half-finished addition**. Worked end to end from
**`engagement.signups` — the smallest complete entry in the registry** (a single
series, one bucket column, a CSV stem, no facets). Read
[`../docs/analytics.md`](../docs/analytics.md) first for the doctrine; this file
is the order of operations.

The question to settle before step 1: **does the domain payload already carry
the number?** If it does, this is a web-only change and steps 1–2 are skipped.
If it does not, adding a field to an existing domain payload is much cheaper
than adding a domain — five endpoints is the shape, and a sixth would need its
own store slot, its own dashboard page and its own hourly cut-off.

## Steps

1. **Widen the domain payload in `packages/shared` — if you must.**
   `packages/shared/src/admin-analytics.schema.ts` owns every response shape.
   Add the field to the domain's schema (a series is `z.array(seriesPointSchema)`;
   a breakdown row gets its own named schema beside `byProject` / `byOrg`), and
   the barrel carries it out with no edit — `packages/shared/src/index.ts` is a
   frozen stitch file.

   **Do not add a route.** There is deliberately no
   `/admin/analytics/:domain/:metric` on the server, and
   `metric-registry.test.ts` asserts the fetched URL does not contain the metric
   id.

2. **Project it in the domain service — in SQL, in the existing round trip.**
   `apps/api/src/services/admin-analytics.service.ts`. Each domain function
   returns from **one** query; add your aggregate as another column or another
   `FILTER` clause on the pass that is already there, never a second `db.execute`.
   Keep the house math: `generate_series` spine + LEFT JOIN with **half-open**
   bucket bounds (`>= ts AND < ts + interval`), `percentile_cont` for a
   continuous quantity, a share in `[0,1]` rather than a percentage. A quiet
   bucket must come back as a zero row, not a gap — the chart draws a line
   through whatever points it is given, and omitting a quiet hour draws a
   straight line across an outage.

   Extend the supertest suite in the same change:
   `apps/api/src/routes/__tests__/admin-analytics.routes.test.ts`, using the
   time-explicit seeders from `admin-analytics-test-app.ts`
   (`seedAnalyticsTask(..., { createdAt, resolvedAt })`). **Assert a
   hand-computed figure**, not "it is a number" — these are aggregations, and a
   test that only checks the shape passes over an off-by-one bucket.

3. **Add the i18n keys to `locales/en/analytics.ts` FIRST.** English is the key
   shape, so this step is what makes the key exist for TypeScript. A metric needs
   at minimum:

   ```ts
   metrics: { engagement: { signups: { title: 'Sign-ups',
                                       subtitle: 'Accounts created in each bucket.' } } },
   series:  { signups: 'Sign-ups' },   // the chart's series label
   columns: { signups: 'Sign-ups' },   // the table's column header
   ```

   plus `engagement.kpis.<metric>` / `<metric>Caption` if it also gets a KPI
   tile, and a `filters.*` label per facet. Reuse the existing `columns.bucket`,
   `units.*` and `chart.*` entries rather than minting near-duplicates.

4. **Add the Arabic twin in `locales/ar/analytics.ts`, key for key.** Arabic is
   never typed against, so **nothing will fail to compile** if you skip it —
   `metric-registry.test.ts` is what fails, because it resolves every key the
   registry emits against **both** catalogs. Follow the binding glossary in
   [`../docs/i18n.md`](../docs/i18n.md) §3, keep digits Western, and use Arabic
   punctuation.

5. **Write the registry entry** in
   `apps/web/src/components/admin/analytics/metric-registry.ts`, inside its
   domain's object. The whole of `signups` is:

   ```ts
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
   ```

   Five things to get right:

   - **`load` reads `loadDomain.<domain>(window)`** — the promise-cached domain
     fetch. Never `api.get` directly: two metrics of one domain in one frame must
     share one in-flight request, and the cache is what makes that true.
   - **`load` returns `{ points, rows }` and nothing else.** Filtering, sorting
     and paging are `defineMetric`'s job, in that order, over the whole set.
   - **`series.kind`** is `'line'` for a time axis and `'bar'` for a categorical
     one. It is not decoration: the drill-down renders the "Per day." caption
     **only** for a line, because a bucket caption over four project bars answers
     a question nobody asked.
   - **A column is sortable exactly when it has an `accessor`.** Leave it off
     where the loader's order _is_ the reading order (the latency ladder runs
     p50 → max and must not be sortable into nonsense).
   - **`csv` is optional.** Omit the stem and the export button does not render —
     which is right for a metric whose table is three rows.

   If the metric has facets, give each a `labelKey` and a `match(row, value)`;
   `options` may be a function of the rows so the menu stays in step with the
   data. Facet options are computed from the **unfiltered** rows, so choosing one
   value never erases the others.

6. **Link to it.** A KPI tile on the domain dashboard is a `MetricTile` with
   `to={detailPath(DOMAIN, '<metric>')}`; a chart card is a `DrillChartCard`
   whose `to` is the same call. **`detailPath` is typed against the
   registry** (`MetricKey<D>`), so a typo is a compile error and there is no
   hand-built `/admin/analytics/...` string anywhere. Attach a `delta` from
   `seriesDelta(series)` only where **up is good** — `StatDelta` has no
   lower-is-better mode (see [`../docs/analytics.md`](../docs/analytics.md) §11).

7. **Run the exhaustiveness test — it is the real gate.**

   ```bash
   pnpm --filter @flowboard/web test -- src/components/admin/analytics
   ```

   `metric-registry.test.ts` will fail if: the id count no longer matches the
   list it pins; any key you emitted is missing from **either** catalog; the
   catalog has a `metrics.<domain>.<metric>` entry with no registry twin, or the
   reverse; `backTo` is not `DOMAIN_PATHS[domain]`; or two columns share a key.
   **Update the pinned id list deliberately** — that edit is the point at which
   somebody notices a metric was added.

8. **Add the API test's twin on the web side if the projection is non-trivial.**
   A share, a percentile ladder or a top-N slice is pure logic in `load`; assert
   it directly rather than through a rendered chart. `MetricChart`'s `hasSignal`
   and `allIntegers` are exported for exactly this reason — a claim about the
   data that needs no jsdom.

9. **Check it in Arabic and in both themes.** Open the dashboard and the
   drill-down: is the KPI's delta pill still an LTR island? Does the chart's
   colour come from a `--chart-*` role? Does the table's numeric column read
   correctly right-to-left? Then run the full gate.

## Checklist

- [ ] Domain payload field added in `packages/shared/src/admin-analytics.schema.ts` (or reused).
- [ ] Aggregate computed **in SQL**, inside the domain's existing single round trip, with half-open buckets and gap-filled zeros.
- [ ] Supertest asserts a hand-computed figure with time-explicit seeders.
- [ ] **No** new server route; no per-metric endpoint.
- [ ] `locales/en/analytics.ts` keys added — title, subtitle, series label, column header, facet labels.
- [ ] `locales/ar/analytics.ts` twin added key for key, per the glossary.
- [ ] Registry entry written with `load` reading `loadDomain.<domain>`, correct `series.kind`, accessors only where sorting is meaningful, `backTo: DOMAIN_PATHS[domain]`.
- [ ] Tile / card links built with `detailPath(domain, metric)` — no hand-built path.
- [ ] `delta` attached only where up is good.
- [ ] `metric-registry.test.ts` green, including its pinned id list updated deliberately.
- [ ] Arabic + light/dark pass done on the dashboard and the drill-down.
- [ ] Doc row added: the metric table in [`../docs/analytics.md`](../docs/analytics.md) §3.2.
- [ ] `pnpm turbo run build lint typecheck test` green.

## Related

- [analytics.md](../docs/analytics.md) — the doctrine, the registry contract, cold/warm, the domain cache.
- [telemetry.md](../docs/telemetry.md) — the two tables every aggregate reads, and the ops half of `/admin`.
- [add-translated-string.md](./add-translated-string.md) — the catalog mechanics behind steps 3–4.
- [add-api-endpoint.md](./add-api-endpoint.md) — read it if you genuinely need a **new domain** rather than a new metric.
- [design-system.md](../docs/design-system.md) — the dashboard kit the console is drawn with, and the `--chart-*` roles.

Back to [workflows/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
