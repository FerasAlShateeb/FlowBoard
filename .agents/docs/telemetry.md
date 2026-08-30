# Telemetry

FlowBoard measures itself. No third-party analytics SDK ships in either bundle:
two append-only Postgres tables — `telemetry_events` (semantic product events)
and `request_logs` (one row per finished HTTP request) — feed every admin
dashboard in the product. Read this before you emit an event, add a `record()`
call, touch the request-log middleware, or build a chart on
`/api/admin/telemetry/*`.

**Two endpoint families read these tables, and the split is by question, not by
data.** `/api/admin/telemetry/*` — this document — answers "what exactly
happened, and is the server healthy right now?": the raw event feed, requests
over time, latency, top endpoints. `/api/admin/analytics/*` answers "how is the
product doing over a window?" and is [analytics.md](./analytics.md). Emission,
the closed event enum, the ingest contract and the aggregation math below are
shared by both; **the analytics console added no event type and no column.**

The realtime counterpart is [realtime.md](./realtime.md); the pino ring buffer
behind `/api/admin/logs` is a different system entirely and lives in
[diagnostics.md](./diagnostics.md).

## 1. The shape of the system

| Piece               | File                                                    | What it is                                                             |
| ------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| Event vocabulary    | `packages/shared/src/telemetry.schema.ts`               | The closed zod enum, the stored-row shape, every admin response shape. |
| Recorder            | `apps/api/src/services/telemetry.service.ts`            | `record()` — fire-and-forget, sink-injected, never awaited.            |
| Request-log buffer  | `apps/api/src/middlewares/request-logger.ts`            | Batched `res.on('finish')` writer plus `resolveRoutePattern`.          |
| Tables              | `apps/api/src/db/schema/telemetry.ts`                   | `telemetry_events` + `request_logs`, with their indexes.               |
| Aggregations        | `apps/api/src/services/admin-telemetry.service.ts`      | Five SQL-only reads. No bucketing in JavaScript.                       |
| Routes              | `apps/api/src/routes/admin-telemetry.routes.ts`         | Two routers: the admin read half, the authenticated ingest half.       |
| Validation          | `apps/api/src/validation/admin-telemetry.validation.ts` | The `?sort`, `?limit` and client-permitted-subset narrowings.          |
| Sink wiring         | `apps/api/src/bootstrap.ts`                             | The composition root. The only file that hands Drizzle to either sink. |
| Browser emitter     | `apps/web/src/lib/telemetry-client.ts`                  | The three client events, the debounce, the path template.              |
| Page-view mount     | `apps/web/src/components/admin/TelemetryBridge.tsx`     | Headless. Mounted once, in `AppShell`.                                 |
| Dashboard queries   | `apps/web/src/hooks/useAdminTelemetry.ts`               | Five TanStack options factories + their hooks.                         |
| Window/bucket logic | `apps/web/src/components/admin/telemetry-range.ts`      | Presets, derived buckets, cache-key segments. Pure module.             |

**Two tables, two failure postures, one rule.** Both streams are written
fire-and-forget, and both drop data rather than fail a user request. That is the
non-negotiable property of this whole subsystem: telemetry that can take the site
down is worse than no telemetry.

## 2. The event vocabulary

### 2.1 The closed enum

`telemetryEventTypeSchema` in `packages/shared/src/telemetry.schema.ts` lists
**twelve** types and nothing else. The column is `text`, not a pg enum
(`apps/api/src/db/schema/telemetry.ts`) — **adding an event type is a shared-package
change and a deploy, never a migration**, while the enum still makes a typo at a
`record()` call site a compile error and an unknown `?type=` a 422.

| Event                 | What it means                                            | Payload fields                                    |
| --------------------- | -------------------------------------------------------- | ------------------------------------------------- |
| `auth_login`          | Credentials verified on `POST /api/auth/login`.          | `{ provider }` — the `AuthProvider`'s `id`.       |
| `page_view`           | A settled client-side navigation.                        | `{ path }` — the route TEMPLATE, never a URL.     |
| `task_created`        | A task row was inserted.                                 | `{ taskId, type }`                                |
| `task_moved`          | A Kanban drop committed.                                 | `{ taskId, statusId }` — the destination status.  |
| `task_completed`      | A task reached a `done`-category status.                 | `{ taskId }`                                      |
| `sprint_started`      | `POST /sprints/:sprintId/start` committed.               | `{ sprintId, committedPoints }`                   |
| `sprint_completed`    | `POST /sprints/:sprintId/complete` committed.            | `{ sprintId, completedPoints, movedTasks }`       |
| `comment_added`       | A comment row was inserted.                              | `{ taskId, commentId }`                           |
| `search_performed`    | A cross-project search returned.                         | `{ query, resultCount }`                          |
| `notification_opened` | A single notification was fetched by id.                 | `{ notificationId, type }`                        |
| `theme_changed`       | A Theme Studio preset or the light/dark toggle was used. | `{ theme }` — preset name, or `'light'`/`'dark'`. |
| `export_csv`          | A table view's CSV download ran.                         | `{ source, rows }` — `source` is `'table'` today. |

**There is deliberately no `taskId` column.** `TelemetryContext` carries only
`userId`, `orgId` and `projectId` — the three the table has columns for and the
three the dashboards group by. A per-task drill-down is not a question these
endpoints answer, and a fourth indexed FK on the hottest append-only stream in
the product is write amplification. **Put entity ids in the `payload` bag**, as
every row above does.

`payload` is an uninterpreted `jsonb` bag. `telemetry_events` also carries a
`session_id` text column ("groups events from one browser tab session; anonymous,
not a token"), but **nothing currently writes it** — `record()` builds its insert
from `type` + the three context ids + `payload`, so the column is reserved
capacity, not a field you can read.

On the web, `apps/web/src/components/admin/TelemetryEventBadge.tsx` collapses the
twelve into four colour families — `session` / `write` / `complete` / `passive` —
because a twelve-colour key is a key nobody memorises. Its label is translated;
its `title` keeps the raw type so an admin can paste it into a SQL `WHERE`.

## 3. Emission sites

### 3.1 Server-authoritative events (9 of the 12)

Every one is recorded **after** its `db.transaction()` resolves, immediately
before the matching `publishDomainEvent()` call. That ordering is the shipped
pattern — see the mismatch note in §9.

| Event                 | Emitting file                                                                                                                                                   | Context stamped                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `auth_login`          | `apps/api/src/services/auth.service.ts` (`login`)                                                                                                               | `userId` only                                                   |
| `task_created`        | `apps/api/src/services/tasks.service.ts` (`createTask`)                                                                                                         | `userId`, `orgId`, `projectId`                                  |
| `task_moved`          | `apps/api/src/services/tasks.service.ts` (`moveTask`)                                                                                                           | `userId`, `orgId`, `projectId`                                  |
| `task_completed`      | `apps/api/src/services/tasks.service.ts` — **two sites**: `patchTask` (when the patch resolved the task) and `moveTask` (when the drop landed in a done column) | `userId`, `orgId`, `projectId`                                  |
| `comment_added`       | `apps/api/src/services/comments.service.ts`                                                                                                                     | `userId`, `orgId`, `projectId`                                  |
| `sprint_started`      | `apps/api/src/services/sprints.service.ts` (`startSprint`)                                                                                                      | `userId`, `orgId`, `projectId`                                  |
| `sprint_completed`    | `apps/api/src/services/sprints.service.ts` (`completeSprint`)                                                                                                   | `userId`, `orgId`, `projectId`                                  |
| `search_performed`    | `apps/api/src/services/search.service.ts`                                                                                                                       | `userId`, `orgId` — **no `projectId`**, search is cross-project |
| `notification_opened` | `apps/api/src/controllers/notifications.controller.ts`                                                                                                          | `userId` only                                                   |

`notification_opened` is the one event recorded from a **controller** rather than
a service: reading one notification is not a domain mutation and has no service
transaction to hang off.

### 3.2 Client-emitted events — exactly three

`CLIENT_TELEMETRY_EVENT_TYPES` in
`apps/api/src/validation/admin-telemetry.validation.ts` is
`['page_view', 'theme_changed', 'export_csv']`, pinned with
`satisfies readonly TelemetryEventType[]` so a rename in `@flowboard/shared`
breaks this list at compile time instead of silently turning a permitted event
into a rejected one. The browser mirrors the same three as
`ClientTelemetryEventType` in `apps/web/src/lib/telemetry-client.ts`.

| Event           | Emitter                                | Call sites                                                                                                                                                                               |
| --------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page_view`     | `reportPageView()` → `trackPageView()` | `apps/web/src/components/admin/TelemetryBridge.tsx` (mounted in `apps/web/src/components/layout/AppShell.tsx`). `initTelemetryClient(router)` is the imperative alternative.             |
| `theme_changed` | `trackThemeChanged(theme)`             | `apps/web/src/components/layout/Topbar.tsx` (light/dark toggle), `apps/web/src/components/theme/ColorsPanel.tsx` (preset click), `apps/web/src/pages/ThemePage.tsx` (Theme Studio save). |
| `export_csv`    | `trackExportCsv(source, rows)`         | `apps/web/src/components/datatable/useCsvExport.ts` — `trackExportCsv('table', rows.length, { projectId })`.                                                                             |

**Mount `TelemetryBridge` OR call `initTelemetryClient`, never both.** They
subscribe to the same navigations and funnel into the same debounced reporter;
the dedupe in `reportPageView` only catches a repeat of the _same_ path, not two
observers of one navigation, so both would double every page view. `AppShell`
mounts the bridge — that is the app's single initialisation.

### 3.3 The ingest contract

| Property    | Value                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| Endpoint    | `POST /api/telemetry/events` (`telemetryIngestRouter`, mounted at `/telemetry` in `apps/api/src/routes/index.ts`) |
| Guard       | `requireAuth` — any authenticated user. **Not** `requireGlobalAdmin`.                                             |
| Rate limit  | `telemetryIngestRateLimit` = `makeRateLimit({ windowMs: 60_000, limit: 120 })` — 120/min per user.                |
| Body schema | `clientTelemetryEventInputSchema` — `{ type, orgId?, projectId?, payload? }`                                      |
| `type`      | Narrowed to the three above. Anything else is a **422**, not a silently-dropped row.                              |
| `payload`   | At most `MAX_CLIENT_PAYLOAD_KEYS` = **12** keys (`.refine`).                                                      |
| Response    | **204 No Content**, always.                                                                                       |

**The actor is the token, never the body.** `telemetryEventInputSchema` has no
`userId` field at all, and `ingestEvent` in
`apps/api/src/controllers/admin-telemetry.controller.ts` takes it from
`requireUser(req)`. A client that could name the actor could attribute a page
view to anybody, and the DAU number on the dashboard would become an assertion by
the client rather than a measurement.

**`orgId` and `projectId` ARE accepted from the body** — they are dimensions of
what the user was looking at, not claims about who they are, and both are foreign
keys, so an invented id cannot be stored.

**`createdAt` is never accepted.** It is the column default; there is no field for
a client-supplied timestamp anywhere in the input schema.

**204, not 200, and the emitter ignores the response.** `record()` returns `void`
and the row is inserted after the handler has already answered, so there is
nothing truthful to put in a body: an `{ id }` would be a fabrication and a
`{ success: true }` would claim a durability this path does not offer.

**The path is a template before it leaves the browser.** `normalizePath()` in
`telemetry-client.ts` turns `/o/acme/p/FB/board/t/FB-142` into
`/o/:orgSlug/p/:projectKey/board/t/:taskKey`, driven by `PARAM_AFTER` (the
segment that _introduces_ a parameter: `o` → `:orgSlug`, `p` → `:projectKey`,
`t` → `:taskKey`, `invite` → `:token`) and `STATIC_SEGMENTS`. Anything in neither
set becomes `:id`. Two reasons, and the second is the one that matters:
cardinality, and **privacy** — an org slug and a task key are the names of real
customers and real work, and they have no business in a stream a global admin
browses. The ids that do matter have foreign-keyed columns instead, where they
can be joined and deleted with the row they point at.

**Two gates decide whether anything is sent at all** (`isTelemetryEnabled()`):
`import.meta.env.MODE === 'test'` (no vitest suite opens a network connection or
leaves a stray POST in a `fetch` mock's call list) and a null `accessToken` (an
anonymous page view is not recordable). **Page views are then debounced by
`PAGE_VIEW_DEBOUNCE_MS` = 400 ms** and de-duplicated against `lastReportedPath`,
so the redirect chain `/` → `/o/acme` → `/o/acme/p/FB/board` — one navigation to
the user, three to the router — collapses to the destination they landed on.

## 4. `record()` semantics

```ts
export function record(
  type: TelemetryEventType,
  payload?: Record<string, unknown> | null,
  context: TelemetryContext = {},
): void;
```

**Never `await record()`** — it returns `void`, so there is nothing to await, and
that is the point. It never throws, never rejects, and adds no latency to the
mutation that called it. A caller can drop it on the last line of a service
function without a `try`/`catch` and without changing that function's failure
modes, which is the only way "record telemetry from every mutation" survives
contact with real code.

Three defences make that true:

1. **No sink ⇒ no-op.** `sink` starts `null`; `record()` returns immediately.
   Unit tests and any process that never called `bootstrap()` pay nothing.
2. **A rejected sink is swallowed.** `void current(event).catch(noop)` — the
   `noop` comment says it: "telemetry is best-effort; failures are never
   surfaced".
3. **A synchronously-throwing sink is caught too.** The `try`/`catch` around the
   call exists for a mis-wired injection: a sink that throws before returning a
   promise must not take the caller's mutation with it.

**The sink is injected, never imported.** `setTelemetrySink()` is called exactly
once, from `apps/api/src/bootstrap.ts`:

```ts
setTelemetrySink(async (event) => {
  await db.insert(telemetryEvents).values(event);
});
```

The indirection began as a build-order workaround (the API core was written
before `src/db/**` existed) and earns its keep permanently: the fire-and-forget
contract is asserted in `apps/api/src/services/telemetry.service.test.ts` against
a fake sink, and a hard `import { db }` would drag a live pool into every one of
those tests. `hasTelemetrySink()` exists for diagnostics; `setTelemetrySink(null)`
detaches. `server.ts` calls `bootstrap()` once, before it listens; **`app.ts` does
not** — supertest builds the app with no database.

## 5. The `request_logs` pipeline

### 5.1 The middleware

`requestLogger` is **first** in the middleware chain (`apps/api/src/app.ts`:
`requestLogger → cors → json → urlencoded → socketId → rateLimit → /api router →
notFound → errorHandler`). That position is load-bearing: its
`res.on('finish')` timer then measures the whole request, body parsing and a
rate-limit rejection included. **A logger that only sees the requests that got
through is not an observability tool.**

| Knob                | Value                                            | Why                                                                  |
| ------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| `FLUSH_INTERVAL_MS` | `5_000`                                          | Ceiling on how stale the table can be under light traffic.           |
| `FLUSH_THRESHOLD`   | `50`                                             | Rows buffered before an immediate flush. One multi-row INSERT.       |
| Timer               | `setInterval` + `timer.unref()`                  | Never holds the event loop — or a vitest worker — open.              |
| Failure             | drop the batch                                   | No retry, no queue. `buffer` is emptied _before_ the sink is called. |
| Shutdown            | `flushRequestLogs()` in `apps/api/src/server.ts` | SIGTERM/SIGINT loses at most the in-flight batch.                    |

The sink is the mirror of the telemetry one, wired in the same `bootstrap()`:
`setRequestLogSink(async (rows) => { if (rows.length === 0) return; await db.insert(requestLogs).values(rows); })`.
**The middleware hands over whole batches, which is the entire reason the buffer
exists** — one INSERT per five seconds rather than one per request.

Stored fields, one row per finished request: `method`, `path` (see §5.2),
`statusCode`, `durationMs` (from `process.hrtime.bigint()`, stamped on
`req.startedAt`), `userId` (`req.user?.id ?? null`), `ip`, `userAgent`,
`createdAt`.

### 5.2 Route-pattern normalization — the subtle part

`path` is the **route pattern**, never the interpolated URL. Grouping by raw path
makes "top endpoints" a list of a million distinct uuids instead of a top ten.

`resolveRoutePattern(req)` is exported (and unit-tested) because getting it right
under Express 5 is not obvious:

1. `rawPath = req.originalUrl.split('?')[0] ?? req.path` — the query string never
   reaches the column.
2. If `req.route?.path` is a string, count its non-empty segments (`consumed`).
3. The **mount prefix** is `rawPath`'s segments minus the last `consumed` of
   them. A route mounted at `/` consumes nothing, so the whole URL is the prefix.
4. Those prefix segments still hold **real ids**, so they go through
   `normalizePath()`: a uuid → `:id`, an all-digits segment → `:id`, a task key
   matching `/^[A-Z][A-Z0-9]{1,9}-\d+$/u` (`FB-123`) → `:key`.
5. The route's own tail already carries `:param` names and is kept **verbatim**,
   then the two are joined, collapsed (`/{2,}` → `/`) and de-trailing-slashed.
6. No route matched (a 404), or the route used a RegExp/array path: normalise the
   whole path instead.

**Do not read `req.baseUrl` here.** It is only correct while the request is
_inside_ the mounted router; Express restores it as the stack unwinds, and an
error response unwinds all the way to the app-level error handler before it
writes. By the time `finish` fires on a 401/403/404/500, `req.baseUrl` is back to
`''` while `req.route` still points at the matched route. Trusting it logged
`GET /logs` instead of `GET /api/admin/logs` — which would have made the
error-rate-by-endpoint table group every failure under a stub of its real path,
and silently, since the success rows looked right.

`apps/api/src/middlewares/request-logger.test.ts` pins the whole contract:
`/api/projects/<uuid>/tasks/<uuid>?expand=…` → `'/api/projects/:id/tasks/:taskId'`
(the prefix uuid normalised, the route's own param name kept — the more
informative name on the half we know); an unmatched `/api/tasks/<uuid>` →
`'/api/tasks/:id'` with status 404; the 401 above → `'/api/admin/logs'`; 50
requests flush with no explicit call; a rejected sink loses its batch and queues
nothing for a retry storm.

### 5.3 Cardinality rationale

Three indexes on `request_logs` exist to serve exactly the three admin reads:
`request_logs_created_idx` on `createdAt desc` (requests-over-time, latency),
`request_logs_path_created_idx` on `(path, createdAt desc)` (top endpoints,
per-endpoint latency), `request_logs_status_idx` on `statusCode` (error slices).
Every one of them is only useful while `path` is a bounded vocabulary. **A raw
path defeats all three at once**, so normalization is not a nicety — it is what
makes the table queryable.

## 6. Admin endpoints

Mounted at `/api/admin/telemetry` (`apiRouter.use('/admin/telemetry', adminTelemetryRouter)`).
The guard is a **blanket** `adminTelemetryRouter.use(requireAuth, requireGlobalAdmin)`,
so a route added later cannot be born unguarded.

| Method | Path                                      | Query                                                                                | `data` payload                                                                 |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `GET`  | `/api/admin/telemetry/overview`           | none                                                                                 | `TelemetryOverview` — 5 KPI numbers                                            |
| `GET`  | `/api/admin/telemetry/events`             | `type` (comma list), `userId`, `projectId`, `from`, `to`, `page`, `pageSize`, `sort` | `TelemetryEventRow[]` — **a plain array**, pagination in the envelope's `meta` |
| `GET`  | `/api/admin/telemetry/requests-over-time` | `from`, `to`, `bucket` (`minute`\|`hour`\|`day`, default `hour`)                     | `{ buckets: RequestsBucket[] }`                                                |
| `GET`  | `/api/admin/telemetry/top-endpoints`      | `from`, `to`, `limit` (1–100, default 10)                                            | `{ endpoints: TopEndpoint[] }`                                                 |
| `GET`  | `/api/admin/telemetry/latency`            | `from`, `to`, `bucket`                                                               | `{ buckets: LatencyBucket[] }`                                                 |
| `POST` | `/api/telemetry/events`                   | — (body; `requireAuth` only)                                                         | **204** — see §3.3                                                             |

**Why two routers in one file.** The read half exposes every user's activity,
every request path and every latency figure in the deployment — global-admin
surface. The write half is a signed-in user reporting their own page view.
Stacking them in one router would mean per-route guards on both, which is exactly
the arrangement where someone eventually forgets one. They stay in one file
because they are one contract: the events the ingest route accepts are the events
the admin feed lists, and the narrowing that keeps a browser from writing
`task_completed` is in the validation module both import.

Two window rules to know:

- **`?from`/`?to` default to the last 7 days** (`DEFAULT_RANGE_DAYS`) ending now,
  via `resolveWindow()`. An unparseable instant or `from > to` is a **400**.
- **`/events` has no implicit window at all.** It is the "what exactly happened"
  view, it is already bounded by `?page&pageSize`, and a hidden 24-hour default
  would turn "I cannot find last month's login" into a support ticket. Its `type`
  filter is nevertheless _always_ present: with no `?type=` the query still
  constrains `type` to `KNOWN_EVENT_TYPES` (the whole enum), which keeps the count
  and the rows consistent and guarantees every row satisfies
  `telemetryEventRowSchema` — the column is `text`, so a value from a rolled-back
  build is a real if rare possibility.

**`MAX_BUCKETS` = 1500**, checked in JavaScript _before_ the query runs. A minute
bucket over the default week is 10 080 rows, which is neither drawable nor cheap,
and `generate_series` would happily materialise it first and let the failure be a
timeout. Refusing with a 400 beats silently coarsening the bucket: a chart
labelled "per minute" that is secretly hourly is a lie.

### 6.1 The analytics family, and what it does not duplicate

`/api/admin/analytics/{overview,engagement,work,traffic,growth}` reads the same
two tables (plus `users`, `organizations`, `projects`, `tasks` and `invites`)
behind the same `requireAuth, requireGlobalAdmin` router guard. Three properties
keep the two families from drifting into each other:

- **The five telemetry endpoints were not replaced.** They still own the event
  feed and the ops charts, and `/admin/telemetry*` still renders them.
- **The math is the same math.** `generate_series` spine, half-open bucket
  bounds, `percentile_cont`, an `errorRate` that counts 5xx only, one round trip
  per endpoint (§7). A new aggregation that disagrees with §7 is a bug on
  whichever side it lives.
- **The bucket ceilings differ on purpose.** `MAX_BUCKETS` is **1 500** here and
  **400** in the analytics service: an ops chart draws a week of minutes, while
  a console plot targets 10–100 points and coarsens its interval to stay there.

The one figure the two surfaces define differently is **cycle time**, and it is
documented rather than reconciled — the console measures `resolved_at −
created_at`, the per-project reports dashboard starts the clock at the first
`in_progress` transition. Cite which surface a number came from.

`?sort` on `/events` is restricted by `sortQueryFor(TELEMETRY_EVENT_SORT_FIELDS)`
to `createdAt` and `type` — the two columns with an index behind them, which is
what keeps `?sort=payload` from reaching the query builder. It is left
**optional** rather than defaulted, so the default (`createdAt:desc`) belongs to
the service and a direct service call cannot disagree with an HTTP one. `id desc`
is always the final ORDER BY term: `created_at` has millisecond resolution and a
burst written in one transaction shares it exactly, so without the bigserial
tiebreak the same row appears on page 1 _and_ page 2 while another never appears.

## 7. The math decisions

Everything is aggregated **in SQL**. A month of traffic is millions of rows, and
pulling them into Node to bucket them there would move the whole month over the
wire to produce 168 numbers. Every function in
`apps/api/src/services/admin-telemetry.service.ts` returns from one round trip;
the only JavaScript in the hot path is the row → contract mapping.

### 7.1 Percentiles: `percentile_cont`, four of them

```sql
coalesce(round(percentile_cont(0.5)  within group (order by logs.duration_ms)::numeric, 2), 0)::float8 as "p50",
coalesce(round(percentile_cont(0.9)  within group (order by logs.duration_ms)::numeric, 2), 0)::float8 as "p90",
coalesce(round(percentile_cont(0.95) within group (order by logs.duration_ms)::numeric, 2), 0)::float8 as "p95",
coalesce(round(percentile_cont(0.99) within group (order by logs.duration_ms)::numeric, 2), 0)::float8 as "p99",
coalesce(max(logs.duration_ms), 0)::float8 as "max",
count(logs.id)::int as "count"
```

**`percentile_cont`, interpolated — not `percentile_disc`.** Latency is a
continuous quantity, and a p99 over 40 samples that can only ever be one of 40
observed values is a step function, not a percentile. (`reports.service.ts` makes
the opposite choice for cycle time, deliberately, for the opposite reason.) All
four percentiles **and** the max come from **one grouped scan**; four separate
queries over the same rows would be four sorts of the same data.

The web draws only p50/p95/p99 (`apps/web/src/components/admin/LatencyChart.tsx`):
five lines is a hairball, p90 sits between two lines already drawn, and the max is
one outlier's line rather than a distribution's. Both stay in the payload and in
the tooltip.

### 7.2 Half-open bucket boundaries

Both time series build a `generate_series` **spine** and LEFT JOIN the data onto
it:

```sql
with spine as (
  select generate_series(
    date_trunc(${bucket}, ${from}::timestamptz),
    date_trunc(${bucket}, ${to}::timestamptz),
    ${step}::interval
  ) as ts
)
...
left join request_logs as logs
  on logs.created_at >= spine.ts
 and logs.created_at <  spine.ts + ${step}::interval
```

**`>= ts AND < ts + interval` — half-open, on purpose.** A request landing exactly
on a bucket boundary belongs to exactly one bucket; `BETWEEN` is inclusive at both
ends and would count that request twice, in the bucket it ended and the bucket it
started.

**The window snaps outward.** The series runs from `date_trunc(bucket, from)`
through `date_trunc(bucket, to)` **inclusive**, so `09:30 → 11:15` hourly yields
the 09:00, 10:00 and 11:00 buckets, each counting its whole hour. Clipping the
first and last buckets to the exact instants produces two short bars for a reason
the chart cannot show, which reads as a traffic dip that is really a rounding
artefact.

**Empty buckets are rows, not gaps.** The spine is the zero-fill: an hour with no
traffic comes back as `count: 0` rather than as a missing point. That is a
contract with the chart — Recharts draws a line through whatever points it is
given, so omitting quiet hours would draw a straight line across an outage and
make it invisible. The latency series zero-fills the same way but ships
`count: 0` alongside, and the client uses that count to **break** the line rather
than plot a 0 ms p95 that never happened: zero requests is a true measurement,
zero milliseconds is not a measurement at all.

Both endpoints use the **same** spine over the same window, which is why the
volume chart and the latency chart share an x-axis domain exactly — a server-side
property, so neither chart reconciles axes on the client.

`instant()` converts every `Date` to an ISO string before it is interpolated into
a raw `sql` fragment, and every one is cast `::timestamptz` on the SQL side.
Drizzle encodes a parameter through the _column_ it is compared against; a `Date`
in a hand-written fragment has no column to learn from, reaches postgres-js as an
unencoded object, and fails at bind time.

### 7.3 `errorRate` counts 5xx only

```sql
round(
  (count(*) filter (where logs.status_code >= 500))::numeric / count(*)::numeric,
  4
)::float8 as "errorRate"
```

**4xx is excluded deliberately.** A 404 on a deleted task and a 403 on a
permission boundary are the API doing its job; folding them in would put a
healthy endpoint permanently in the red and train the reader to ignore the
column. It is a **share in `[0, 1]`**, not a percentage — the contract says
`z.number().min(0).max(1)`, and formatting belongs to the view.

Grouping is by `(method, path)`: the same path under GET and DELETE are two
endpoints with two latency profiles, and merging them hides the expensive one
behind the cheap one's volume. The ORDER BY carries `method, path` as a tiebreak
so two endpoints with equal traffic do not swap places between two identical
requests.

`apps/web/src/components/admin/TopEndpointsTable.tsx` colours the rate in three
steps, not a gradient: `0` → muted (zero is the expected state; painting it green
would make the healthy majority the loudest thing in the table), `< 1%` →
`soft-warning`, `≥ DANGER_ERROR_RATE` (0.01) → `soft-danger`. One in a hundred
requests failing with a 5xx is already a bad day for an endpoint.

### 7.4 "Today" is a UTC calendar day

`overview()` computes five numbers as `FILTER` clauses on **one** pass over
`telemetry_events` — five queries would each re-walk the index and, worse, each
see a slightly different "now".

| Field              | Window                   | SQL                                                                         |
| ------------------ | ------------------------ | --------------------------------------------------------------------------- |
| `dau`              | current UTC calendar day | `count(distinct user_id) filter (where created_at >= ${day})`               |
| `eventsToday`      | current UTC calendar day | `count(*) filter (where created_at >= ${day})`                              |
| `tasksCreated7d`   | last 7 days              | `count(*) filter (where type = 'task_created' and created_at >= ${week})`   |
| `tasksCompleted7d` | last 7 days              | `count(*) filter (where type = 'task_completed' and created_at >= ${week})` |
| `activeProjects`   | last 7 days              | `count(distinct project_id) filter (where created_at >= ${week})`           |

**DAU is a calendar day, not a rolling 24 hours.** It resets at 00:00 UTC, climbs
through the day, and is directly comparable between days and against
`eventsToday`, which is counted the same way. A rolling window would make a
Monday-morning DAU include half of Sunday. The boundary is computed in Node
(`startOfUtcDay`) rather than with `date_trunc('day', now())` so it cannot
silently follow the database session's timezone.

## 8. The web side

### 8.1 Windows and buckets

`apps/web/src/components/admin/telemetry-range.ts` is a pure module — no React,
no Intl, no i18next.

**Instants, not calendar days.** The opposite convention from
`components/reports/report-range.ts`, and the difference is real: a burndown
bucket is a calendar day and carries `YYYY-MM-DD` strings; a request-volume bucket
is an hour, and "the 14:00 hour" is a point on a global timeline. Expressing it as
a local calendar day puts an off-by-one in the middle of the traffic chart for
every reader west of Greenwich.

| Export                       | Value                                                                 |
| ---------------------------- | --------------------------------------------------------------------- |
| `TELEMETRY_PRESETS`          | `['24h', '7d', '30d']` — shortest first, which is also the tab order. |
| `DEFAULT_TELEMETRY_PRESET`   | `'24h'`                                                               |
| `presetWindow(preset, now?)` | `{ from, to }` as two ISO strings.                                    |
| `presetBucket(preset)`       | `24h → hour`, `7d → hour`, `30d → day`.                               |
| `TELEMETRY_FILTER_PRESETS`   | `['all', '24h', '7d', '30d']` — the feed only.                        |
| `filterWindow(preset, now?)` | `undefined` for `'all'`, meaning no filter.                           |
| `windowKey(window, bucket?)` | `` `${from}..${to}` `` plus `` `#${bucket}` `` when given.            |

**Presets only, no calendar popover.** An operator looking at request latency asks
"is it bad right now", "was it bad today", or "has it been getting worse this
month" — never "the fortnight of the 3rd". The reports dashboard, which _does_ get
that question, has the calendar pair instead.

**The bucket is part of the cache key.** `?bucket=hour` and `?bucket=day` over one
window are two different payloads from the same URL path; a key that ignored it
would serve the daily series to the hourly chart on a toggle, which looks exactly
like a chart that has silently stopped updating.

**The feed gets an `'all'` option the charts deliberately lack.** A chart with no
window has no x-axis. The feed is a table whose most common use is "find the event
I am looking for", and the API agrees — `/events` is the one endpoint with no
implicit range (§6).

### 8.2 The bucket toggle

`TelemetryBucketToggle` offers **`hour` and `day` only**, and only on
`AdminTelemetryRequestsPage`. Elsewhere the bucket is derived from the window,
because "30 days at minute resolution" is 43 200 marks on a 600-pixel canvas.
`minute` exists in the contract for a live incident view and the server refuses a
window wide enough to make it expensive, so a chip that produced a 400 for two of
the three windows would be a control that mostly does not work.

**The toggle follows the window until it is touched.** `bucketOverride` is
separate state from `preset`; changing the range sets it back to `null` so the
window's sensible default returns, and after an explicit pick it stays picked. A
control that silently undoes itself is worse than no control.

### 8.3 Pages and charts

| Page                             | Route                       | What it holds                                                                       |
| -------------------------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| `AdminTelemetryPage.tsx`         | `/admin/telemetry`          | The ops overview: KPI row + requests + latency + top endpoints (limit 10).          |
| `AdminTelemetryRequestsPage.tsx` | `/admin/telemetry/requests` | The same three panels plus the hour/day toggle; `ENDPOINT_LIMIT = 20`.              |
| `AdminTelemetryEventsPage.tsx`   | `/admin/telemetry/events`   | The raw feed on the generic `DataTable` — facets, sortable headers, URL state, CSV. |

Round 2 rebuilt the chrome of all three without changing a query:

- **The panels moved from `ReportCard` onto `PanelCard`**, so the two
  side-by-side plots now state their own height through `OPS_CHART_BODY` in
  `apps/web/src/components/admin/ops-panel.ts` rather than inheriting a pinned
  16:10 aspect. Two callers stating a height separately is how a pair of
  side-by-side plots drifts apart — see [design-system.md](./design-system.md)
  §10.2 and §10.7.
- **The events feed runs on the generic grid** (`components/dashboard/DataTable`
  - `hooks/useGridUrlState`), so a filtered feed is a link somebody can paste
    into an incident channel, and its CSV is the query rather than the page.
- **Both range pickers stayed, deliberately.** `/admin/telemetry/requests` needs
  24 h and the feed needs **All time**, neither of which the console's
  `7d/30d/90d/12m` vocabulary can express, so
  `components/admin/TelemetryRangePicker.tsx` survived the migration onto
  `components/dashboard/RangePicker` (design-system.md §10.3).
- **One rough edge is open:** the feed's Project column renders `row.projectId`
  as a raw UUID while the adjacent User column is a clickable name. Fixing it
  needs a project name or key denormalized onto `telemetryEventRowSchema` — an
  API contract change, not a render change. It has an unticked row in
  [project-checklist.md](../checklists/project-checklist.md) §G.

- **The KPI row ignores the window, on purpose.** `/overview` takes no range, so
  two people quoting DAU mean the same thing. A range-tunable headline number is
  a number that depends on what the reader last clicked.
- **One error state for five tiles.** `TelemetryStatRow` renders a single
  `ErrorState`, unlike the reports dashboard's per-card degradation — those six
  cards are six independent queries; these five numbers come from one request, and
  five identical error boxes would be five times the noise for one fact.
- **One query per panel, never one per page.** A slow percentile scan costs the
  reader one card, not the screen. Every panel owns its own skeleton, error state
  with retry, and empty message; there is no page-level loading gate.
- **`RequestsChart` is a filled area; `LatencyChart` is bare lines** (p50/p95/p99
  only). Volume accumulates under the curve, latency is a level — the fill is what
  tells the two charts apart without reading two axis labels.
- **Every response is zod-parsed** through `api`'s `schema` option
  (`useAdminTelemetry.ts`). An endpoint that stopped emitting `errorRate` must fail
  in the table that reads it, not render a column of `undefined`.
- **Filter changes reset the feed to page 1**, through a single `commit()`
  function, so the reset cannot be forgotten at one call site.

`apps/web/src/components/admin/telemetry-format.ts` memoizes its formatters per
locale (an axis tick formatter runs once per tick per render) and keeps digits
Latin in both languages (`getIntlLocale()` returns `ar-u-nu-latn`). Paths,
timestamps and numerals are pinned `dir="ltr"` cell by cell — a leading slash
rendered at the reading end of an RTL run turns `/api/tasks` into `api/tasks/`.

## 9. Things the older notes got wrong

Two claims that circulated before the code landed, corrected here so nobody
propagates them:

- **`record()` does not run inside the write's transaction.** Every server-side
  call site invokes it _after_ `db.transaction()` has resolved, next to
  `publishDomainEvent()`. It could not be otherwise: `record()` takes no `tx`
  parameter, and the sink closes over the top-level `db`. An event is therefore
  recorded only for a write that actually committed — which is the behaviour you
  want — but "same transaction boundary" is not what ships.
- **Not every mutation records an event.** Nine of the twelve types have
  server-side emission sites (§3.1) and the enum is deliberately small: "each one
  answers a question someone actually asks of the admin dashboard, and an event
  nobody charts is just write amplification". There is no `task_deleted`, no
  `project_created`, no `member_invited`.

## Related docs

- [analytics.md](./analytics.md) — the other reader of these two tables: the
  metric registry, the five domain endpoints, and the events-vs-analytics split.
- [admin.md](./admin.md) — the console shell both families live in.
- [diagnostics.md](./diagnostics.md) — the pino ring buffer, a different system
  entirely.
- [design-system.md](./design-system.md) — `PanelCard`, `OPS_CHART_BODY`, and the
  three range vocabularies.
- [architecture.md](./architecture.md) — `bootstrap()` and the injected sinks.

Back to [docs/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
