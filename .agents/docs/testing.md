# Testing

The FlowBoard test pyramid: what each layer owns, the exact command that runs
each suite, the infrastructure each one needs, the fixture/harness catalogue,
and the current spec inventory. Read this before writing a test, and before
deciding which layer a new test belongs in. The **mechanics** — the jsdom
pragma, cleanup, the `ResizeObserver` stub, `test-db.ts`'s usage contract and
`fileParallelism` — live in
[coding-standards.md §6](./coding-standards.md#6-test-conventions); this file
does not repeat them.

---

## 1. The pyramid

### 1.1 The layers, and what each one owns

| Layer              | Tool                                                | Lives in                                               | Owns                                                                                                                                                                                                                                |
| ------------------ | --------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract           | Vitest, colocated beside the schema                 | `packages/shared/src/*.test.ts`                        | The zod schemas themselves: what a payload must contain, what it must reject, and the envelope's shape. Both ends of every wire parse against these, so they are asserted once here rather than in every consumer.                  |
| Pure unit          | Vitest, **colocated** `*.test.ts` beside the unit   | `apps/api/src/utils`, `apps/web/src/lib`, view helpers | Pure logic: rank math, Gantt geometry, transition/WIP rules, report aggregations, the realtime cache reducer, the refresh single-flight. No DOM, no database, no network.                                                           |
| Component          | Vitest + jsdom + Testing Library                    | `apps/web/src/components/**`, `apps/web/src/pages/**`  | What a user sees and clicks: rendered copy, roles and accessible names, disabled states, optimistic updates, and the Radix-driven interactions (`userEvent`).                                                                       |
| API integration    | Supertest against a migrated + seeded test database | `apps/api/src/routes/__tests__/**`                     | Every endpoint: envelope shape, zod rejection, the role matrix (a viewer must not write), transactions, concurrency.                                                                                                                |
| Socket integration | A real Socket.IO server + real `socket.io-client`   | `apps/api/src/sockets/__tests__/**`                    | The transport contract: handshake acceptance and refusal, room membership, and `.except(originSocketId)` echo suppression proven across two live clients.                                                                           |
| End-to-end         | Playwright                                          | `e2e/`                                                 | Real user journeys through a real browser: auth, board drag-and-drop, task lifecycle, sprint cycle, table + CSV, calendar, Gantt drag, notifications, two-context realtime, admin, log drawer, theme, and an Arabic/RTL smoke test. |

**Push every assertion as far down the pyramid as it will go.** A rule that can
be stated about a pure function (`rankBetween`, `resolutionFor`, `daysBetween`)
costs milliseconds there and seconds through a browser, and it names the defect
instead of a symptom three layers away.

### 1.2 What each layer must NOT do

| Layer              | Must never                                                                                                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract           | Import from `apps/*`. `packages/shared` is a leaf — a test that reaches upward inverts the dependency graph and breaks `turbo run build`'s topological order.                                                                                        |
| Pure unit          | Touch a database, a socket, `fetch`, or the DOM. If it needs one of those it is not a unit test; move it up a layer instead of stubbing four things.                                                                                                 |
| Component          | Open a real network connection. `vi.mock('@/lib/api')` or a stubbed `fetch` — a suite that hits a dev server passes or fails on whether somebody left `pnpm dev` running.                                                                            |
| Component          | Reach into Postgres. There is no database in `apps/web`'s test environment at all, and adding one would make a render assertion depend on a migration.                                                                                               |
| API integration    | Arrange state through the endpoints it is testing. Use the row builders (§3.2) — a broken guard that refuses to create the fixture would otherwise produce a quietly **passing** test.                                                               |
| API integration    | Assume a row survives from a previous test. `truncateAllTables()` runs in `beforeEach`; anything a case needs, that case creates.                                                                                                                    |
| Socket integration | Mock `io`. A spy on `to()`/`except()`/`emit()` can only prove the code called the methods we wrote; it cannot prove the other tab received the event and this one did not, which IS the contract (see the header of `sockets/__tests__/harness.ts`). |
| End-to-end         | Own anything a lower layer can hold. Browser time is the scarcest budget in the repo.                                                                                                                                                                |

---

## 2. Running the suites

### 2.1 The commands

| Command                                                         | Runs                                                                    |
| --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm test`                                                     | Every suite via turbo (`turbo run test`), **e2e included** — see §2.5.  |
| `pnpm --filter @flowboard/shared test`                          | The contract suites only. No infrastructure at all.                     |
| `pnpm --filter @flowboard/api test`                             | The API suites. **31 of the 46 files need a live Postgres** — see §2.2. |
| `pnpm --filter @flowboard/web test`                             | The web suites. No infrastructure; jsdom is a devDependency.            |
| `pnpm --filter @flowboard/e2e exec playwright install chromium` | Fetch the browser. Once per machine — `pnpm install` does not do it.    |
| `pnpm e2e`                                                      | Just the Playwright suite (`pnpm --filter @flowboard/e2e test`).        |

**Watch mode is `vitest` without `run`.** Each package's `test` script is
`vitest run`, so drop through to the binary for the watcher:

```bash
pnpm --filter @flowboard/web exec vitest              # watch every web suite
pnpm --filter @flowboard/api exec vitest --watch      # explicit, same thing
```

**A single file is a positional path argument; a single case is `-t`.** Both are
`vitest run` flags, so both go after `exec vitest run`:

```bash
pnpm --filter @flowboard/web exec vitest run src/lib/realtime-cache.test.ts
pnpm --filter @flowboard/api exec vitest run src/routes/__tests__/sprints.routes.test.ts
pnpm --filter @flowboard/api exec vitest run -t 'refuses a second active sprint'
```

**Prefer the single-file form while iterating on an API suite.** The API run is
sequential by design (§2.3) and takes ~100 s end to end; one route file takes
about two seconds.

### 2.2 Does the API suite need a live Postgres? Yes — 31 of its 46 files do

**`DATABASE_URL` is the variable, and `apps/api/vitest.config.ts` sets it
itself** — it is not read from an `.env` file:

```ts
env: {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/flowboard_test',
  …
}
```

Vitest puts that into `process.env` before any module loads, and
`src/config/env.ts`'s dotenv chain **never overwrites an already-set variable**
— so the suite talks to `flowboard_test` on port **5433** whether or not you
have an `apps/api/.env`, and whatever is in that file cannot redirect a test
run. That is deliberate: the alternative is a test result that depends on a
git-ignored file.

**What happens if Postgres is not listening on 5433.** `src/test/test-db.ts`'s
`ensureTestDb()` opens a connection to the `postgres` maintenance database to
issue `CREATE DATABASE` — so the failure arrives in `beforeAll` as a connection
error (`ECONNREFUSED 127.0.0.1:5433`), and **every test in all 31
database-backed files fails at once**. It is never a subtle wrong answer; it is
a wall of identical connection errors. Bring the container up first:

```bash
docker compose -f docker-compose.dev.yml up -d      # postgres on 5433, minio on 9000
```

**The database itself does not need to pre-exist, and never needs migrating by
hand.** `ensureTestDb()` creates `flowboard_test` if it is missing and runs the
drizzle migrations from `apps/api/drizzle`, memoized per process.

**MinIO is not required.** The `S3_*` values in the vitest config are fake
strings that satisfy `env.ts`'s fail-fast validation; nothing in the
unit/integration suites opens a socket to object storage — the attachment suites
assert over presigned-URL shapes and metadata rows.

**The 15 files that need nothing** are the ones that never import
`src/test/test-db`: `app.test.ts`, `db/schema.test.ts`, the four
`middlewares/*.test.ts`, `scripts/seed-utils.test.ts`,
`services/task-move.service.test.ts`, `services/telemetry.service.test.ts`,
`sockets/presence.test.ts`, `utils/domain-events.test.ts`, `utils/jwt.test.ts`
and `utils/log-ring.test.ts`. `db/schema.test.ts` in particular is a **schema
contract** suite that reads Drizzle's table metadata in memory — it is the
cheapest place to catch a renamed enum member or a dropped index.

### 2.3 One test database, and the rule that comes with it

Every API integration suite talks to **one** database — `flowboard_test` on the
dev Postgres container. `src/test/test-db.ts` creates it if missing, migrates it
once per process, and each suite calls `truncateAllTables()` in a `beforeEach`.
The mechanics and the `beforeAll`/`beforeEach`/`afterAll` contract to copy are
[coding-standards.md §6.4](./coding-standards.md#64-fileparallelism-and-the-api-test-database).

That design has exactly one operational rule attached to it:

> **Nothing may run two test processes against `flowboard_test` at the same
> time.** `fileParallelism: false` makes the suites inside ONE `vitest run`
> sequential — it says nothing about a second `vitest run` you start in another
> terminal, or a `turbo` invocation that happens to schedule two api tasks
> together. A concurrent run truncates the tables the other one is
> mid-assertion on, and the failures land in whichever suite was unlucky, which
> makes them look like flakes in code that is fine.

Per-package databases were considered and rejected: the suites already run in
about a minute and a half sequentially, and N databases means N migrate passes
plus a cleanup story for the leftovers (Wave 4 left a stray `flowboard_test_wp42`
behind exactly this way — it is still on the dev container).

**`hookTimeout` is 30 s in the api config** (R2 W3.5), while `testTimeout` keeps
Vitest's default. The 10 s hook default assumes a `beforeEach` that wires up
objects; these hooks do real I/O — `truncateAllTables()` is a `TRUNCATE` across
every table, and the socket suites additionally boot an HTTP and a Socket.IO
server per test, thirty-plus times in `realtime-bridge.test.ts` alone. That is
well under 10 s idle and not under load: `turbo run test` schedules
`@flowboard/api` alongside the web package's 2 500-test suite, and the full gate
failed twice in exactly that hook while the two competed for cores. **Raise a
HOOK timeout, never a TEST one** — a hook deadline is a deadlock detector on
setup, while a test deadline is an assertion about how fast the product answers.

**If a suite fails with `type "…" already exists` or `relation … already
exists`,** the migration FILE changed and the test database still holds the old
one under a different hash. Drop it and let the next run rebuild it:

```bash
docker exec flowboard-postgres psql -U postgres \
  -c 'DROP DATABASE IF EXISTS flowboard_test WITH (FORCE);'
```

### 2.4 Web suites need nothing, and are not serialised

`apps/web/vitest.config.ts` sets no `fileParallelism`, because the web suites are
hermetic: the storage shim in `src/test/setup.ts` is re-cleared per test, the
zustand stores re-baseline in their own `beforeEach`, and nothing shares a
process-external resource. It does raise `testTimeout`/`hookTimeout` to **20 s** —
read the header comment in that file before lowering it. A timeout is a deadlock
detector, not a performance budget.

### 2.5 The wave gate runs Playwright too

`e2e#test` is part of `turbo run test`, so **`pnpm turbo run build lint
typecheck test` boots a browser**. One prerequisite is not something turbo can
arrange: **Chromium must be installed.** `pnpm install` does not fetch it (pnpm
blocks dependency lifecycle scripts), so run the `playwright install` line in
§2.1 once per machine. The suite's database and server prerequisites are §6's,
not this section's.

`turbo.json` gives `e2e#test` two properties that are both load-bearing:

- **`"cache": false`** — its result depends on process and database state that
  no input hash can observe, so a cached "pass" would be a replay of an old run
  rather than a run.
- **`"dependsOn": ["@flowboard/web#test", "@flowboard/api#test"]`** — it runs
  last, alone. Turbo would otherwise schedule a browser suite driving two real
  dev servers beside ~2 600 Vitest cases, and the observed symptom was one
  arbitrary spec failing per gate run, a different one each time, all passing
  standalone. It also fails fast: a broken unit test now short-circuits the
  browser run instead of racing it.

---

## 3. The fixture and harness catalogue

There is no global setup file on the API side and exactly one on the web side.
Everything else is an explicit import, so a suite's dependencies are visible in
its import block.

| File                                                                         | Provides                                                                                                                                                                                                                                                                                                                                   | Used by                                                                                                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/test/test-db.ts`                                               | `ensureTestDb()` (create + migrate, memoized per process) and `truncateAllTables()` (`TRUNCATE … RESTART IDENTITY CASCADE` over every non-journal table).                                                                                                                                                                                  | All 31 database-backed API files                                                                                                                           |
| `apps/api/src/routes/__tests__/identity-test-app.ts`                         | `buildTestApp()` (auth + invites + admin-users routers), `seedUser`/`seedOrg`/`seedOrgMember`/`seedProject`/`seedInvite`, `tokensFor`, `bearer`, `orgRolesOf`, `projectRolesOf`, and `TEST_PASSWORD`.                                                                                                                                      | `auth`, `invites`, `admin-users` route suites                                                                                                              |
| `apps/api/src/routes/__tests__/fixtures.ts`                                  | `createTestApp()` (orgs + projects routers), `createUser`/`createOrg`/`createTeam`/`createProject`/`createLabel`/`createTask`, and `createProjectWorld()` — one org, one project, and one account per role including an `outsider`.                                                                                                        | `orgs`, `projects`, `teams`, `project-members`, `labels`, `workflow` route suites                                                                          |
| `apps/api/src/routes/__tests__/task-domain.fixtures.ts`                      | `createTaskTestApp()` (tasks + comments + attachments + sprints + search + reports, behind `socketIdMiddleware`), `seedWorld()` with `inProgressWipLimit`/`restrictTransitions` options, `seedTask`/`seedSprint`/`seedLabel`/`attachLabel`, `nextRank()`, plus `captureTelemetry`/`captureDomainEvent`/`flushAsync`.                       | `tasks`, `tasks-move`, `tasks-patch`, `comments`, `attachments`, `sprints`, `search`, `reports`, `activity`, `task-activity`, `notifications` route suites |
| `apps/api/src/routes/__tests__/telemetry-test-app.ts`                        | `buildTelemetryTestApp()` (the admin + ingest telemetry routers) and time-explicit seeders `seedEvent`/`seedRequestLog`/`seedLatencies`, with `at`/`hoursFrom`/`daysFrom`.                                                                                                                                                                 | `admin-telemetry` route suite                                                                                                                              |
| `apps/api/src/sockets/__tests__/harness.ts`                                  | `startGateway()` (real `http.Server` + Socket.IO on an ephemeral port, real user resolver), `connectClient`, `waitFor`, `expectNoEvent`, `joinProject`, `leaveProject`, and the `TestClient` type.                                                                                                                                         | `gateway.test.ts`, `realtime-bridge.test.ts`                                                                                                               |
| `apps/web/src/test/setup.ts`                                                 | The only `setupFiles` entry: a real `Storage`-shaped `MemoryStorage` on `localStorage`/`sessionStorage`, cleared in a `beforeEach`.                                                                                                                                                                                                        | Every web suite, automatically                                                                                                                             |
| `apps/web/src/components/tasks/__tests__/test-utils.tsx`                     | `installJsdomStubs()` (ResizeObserver, `matchMedia`, `scrollIntoView`, pointer capture), `createTestQueryClient()` (retries off), `renderWithProviders`, and the task-domain fixtures — `IDS`, `ADA`/`GRACE`, `STATUSES`, `RESTRICTED_TRANSITIONS`, `LABELS`, `SPRINTS`, `makeTask`, `makeSummary`, `COMMENTS`, `ATTACHMENTS`, `ACTIVITY`. | The `components/tasks` jsdom suites, and the notification harness                                                                                          |
| `apps/web/src/components/notifications/__tests__/notifications-fixtures.tsx` | `renderWithProviders` inside `QueryClientProvider` + `MemoryRouter` + `TooltipProvider`, `hookWrapper()` for `renderHook`, `makeNotification`, `makeInfiniteData`. Re-uses `installJsdomStubs` rather than copying it.                                                                                                                     | The four `components/notifications` suites                                                                                                                 |
| `apps/web/src/components/calendar/calendar-test-fixtures.ts`                 | `makeTask(overrides & { id })` — a `TaskSummary` with every field defaulted.                                                                                                                                                                                                                                                               | The five `components/calendar` suites                                                                                                                      |

### 3.1 The supertest app builders, and why there are four

**None of them import `app.ts`.** That is the point. `createApp()` drags in
CORS, the global rate limiter, the request logger (which would write
`request_logs` rows of its own and corrupt every fixture in the telemetry
suite) and the socket bootstrap — none of which shape a response body, and all
of which would couple one work package's tests to a file another work package
owns. Each builder mounts **only** the routers it is about, at the **same paths
`routes/index.ts` mounts them**, behind the same `express.json()`, `notFound`
and `errorHandler`. A test that passes there cannot pass for a reason production
does not share.

The one exception is `routes/__tests__/router-mounting.test.ts`, which exists
precisely to assert that every Wave-2 router is reachable through the **real**
app — the integration gate the four narrow builders deliberately do not provide.

### 3.2 Row builders, not endpoint calls

**Arrange fixtures by writing rows, never by calling the API.** The suites have
to arrange states the API deliberately refuses to create — an org whose only
admin is someone else, a column already sitting at its WIP limit, a rank long
enough to force a rebalance, a soft-deleted org, a task resolved three days ago.
Building those through endpoints makes the arrangement share failure modes with
the assertion, and a broken guard then produces a quietly passing test.

Two details in `task-domain.fixtures.ts` are worth copying rather than
reinventing:

- **`seedTask` allocates its number from the project counter** with the same
  atomic `UPDATE … RETURNING` the service uses. A fixture that invented its own
  number would collide with the next task created through the API.
- **`nextRank()` chains through the shared `rankBetween`**, not a hand-formatted
  string. A fractional index is not an arbitrary sortable string —
  `generateKeyBetween` validates the alphabet and the length prefix, and a
  plausible-looking `a0001` is rejected outright the moment production code
  tries to insert after it.

### 3.3 The socket harness is real all the way down

`startGateway()` boots a real `http.Server` on an ephemeral port (`listen(0)`), a
real Socket.IO server, and hands out real `socket.io-client` connections. It
wires the user resolver to the actual `users` table, because the **revocation**
half of the handshake is under test: without it `io.ts` falls back to its
dev-mode "accept on signature alone" branch and the stale-token case would
silently pass.

- `connectClient` sets `forceNew: true`. socket.io-client caches Managers by
  URL, and two clients sharing one would share a transport and therefore a
  single socket id — which makes every `.except()` assertion meaningless.
- `expectNoEvent(client, event, 400)` is the negative half of echo suppression.
  **Always pair it with a positive assertion on the other client**, so the
  window is proven long enough by the event that did arrive inside it.
- `gateway.close()` disconnects every client it handed out, clears presence and
  the room caches, and closes the server. Call it in `afterEach`; a leaked
  client keeps the process alive.

### 3.4 Web render harnesses

The two jsdom harnesses share `installJsdomStubs()` on purpose — Radix needs
exactly the same three missing browser APIs (`ResizeObserver`, pointer capture,
`scrollIntoView`) in every suite that opens a popover, and two divergent copies
of that list is how one suite starts failing for a reason the other already
solved.

Both `createTestQueryClient()` factories set `retry: false`. The default three
retries with backoff means a test asserting an error state waits several seconds
for a failure the stub produced instantly.

Both declare a **narrow** `ProviderRenderResult` instead of re-exporting Testing
Library's `RenderResult`. Two copies of `pretty-format` exist in this pnpm tree,
so `debug`'s options type differs between the one `render` declares and the one
the call site receives; spreading the result either fails to type-check or
produces an inferred type that is not nameable at all (`TS2742`). Listing the
members the suites actually use sidesteps both, and `screen` covers the rest.

**A suite that renders a grid needs `BrowserRouter`, not `MemoryRouter`.** This
is the one router choice in the repo that is not interchangeable, and it applies
to every page driven by `hooks/useGridUrlState` — `AdminOrgsPage`,
`AdminUsersPage`, `AdminProjectsPage`, `AdminTelemetryEventsPage`.

The hook diffs its own owned params against **`window.location.search`**, not
against the rendered `useSearchParams()` value, because React Router runs
navigations inside a transition: `setSearchParams` writes `window.location`
synchronously while the render carrying the matching value stays deferred and
interruptible. Under a `MemoryRouter` there is no `window.location` to read, so
the hook sees an empty query string, concludes somebody else changed the URL,
and re-hydrates the grid back to its defaults **on every keystroke**. The
symptom is a search box that clears itself, in a component that is fine.

The pure codec — `encodeGridParams`, `decodeGridParams`, `ownedSearch`,
`shouldPush` — is exported precisely so the rules can be tested with no router
and no DOM at all: `hooks/useGridUrlState.test.ts` runs in the default node
environment. **Test the codec there and the wiring in the page suite**; every
bug in this area has been about which values reach the URL.

---

## 4. The spec inventory

**This section is an area map, not a scoreboard.** A file and case count goes
stale within a wave and a stale number is worse than no number, so the totals
live in the command rather than in the prose:

```bash
find apps packages -name '*.test.ts' -o -name '*.test.tsx' | grep -v node_modules | wc -l
grep -rl '@vitest-environment jsdom' apps/web/src | wc -l   # the jsdom subset
pnpm turbo run test                                          # the case count, from the runner
```

Playwright specs are `*.spec.ts` under `e2e/` and are counted in §6, not here.
The one count worth writing down is operational rather than cosmetic — how many
API files need Postgres (§2.2) — because it decides whether a failure is a
missing container or a real defect.

### 4.2 Shared contracts

`auth.test.ts`, `comments.test.ts`, `common.test.ts`, `contracts.test.ts`,
`envelope.test.ts`, `rank.test.ts`, `tasks.test.ts`, `socket/events.test.ts`,
plus the Round-2 trio `instance.test.ts`, `admin-orgs.test.ts` and
`admin-analytics.test.ts`.
`envelope.test.ts` pins the `{success,data,meta?,error?}` shape every response
uses; `rank.test.ts` pins the fractional-index wrappers the board, the backlog
and the seed all depend on; `socket/events.test.ts` walks every server→client
payload schema, so a wire field added on one side and forgotten on the other
fails here rather than in a browser.

### 4.3 API

| Group                               | Notable specs                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `routes/__tests__`                  | `tasks.routes` (incl. unique `PROJ-N` allocation under ten concurrent creates), `tasks-move` / `tasks-patch`, `sprints.routes` (the second-active-sprint race, and the calendar-day window round-trip), `task-activity.routes` (keyset paging, the closed audit enum), `router-mounting.test.ts` (the real-app reachability gate).                                                                                 |
| `routes/__tests__` — instance admin | `instance-settings.routes` (the `/instance/config` vs `/admin/settings` guard split, lazy row creation, every `PATCH` refusal), `orgs-admin.routes` (`?q`, `?scope=member`, `?includeDeleted` and its 403s, the restore matrix), `admin-users-lifecycle.routes` (memberships, provisioning, the whole anonymize-delete suite), `admin-projects.routes` (row shape across tenants, the sort whitelist, pagination). |
| `routes/__tests__` — analytics      | `admin-analytics.routes` — the global-admin gate on all five paths, the shared window contract (interval enum, malformed instant, the bucket ceiling, the 30 d default), then hand-worked figures per domain.                                                                                                                                                                                                      |
| `services`                          | `notifications.service` (recipient math: actor subtraction, mute, watcher fan-out), `task-move.service`, `telemetry.service`.                                                                                                                                                                                                                                                                                      |
| `utils`                             | `rank-rebalance` (the only DB-backed util suite), `jwt`, `domain-events`, `log-ring`, `password` (the scrypt hash/verify round trip).                                                                                                                                                                                                                                                                              |
| `middlewares`                       | `validate` (the zod→422 path), `error-handler` (the single envelope formatter), `request-logger`, `socket-id`, `rate-limit` (the 429 path and its keying).                                                                                                                                                                                                                                                         |
| `sockets`                           | `__tests__/gateway` (handshake accept/refuse, rooms), `__tests__/realtime-bridge` (echo suppression across two live clients), `presence`.                                                                                                                                                                                                                                                                          |
| `db` + `app` + `scripts`            | `db/schema.test.ts` (enum parity against `@flowboard/shared`, the soft-delete list, the seven task read paths, the check-constraint list, bigserial stream ids), `app.test.ts`, `scripts/seed-utils.test.ts` (the rank-ordering property).                                                                                                                                                                         |

**31 of the API's files need a live Postgres**; the 15 that do not are listed in
§2.2 and have not changed.

### 4.4 Web

| Group                        | Notable specs                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/tasks`           | `TaskDetailPanel`, `TaskFieldsSidebar`, `TaskHeaderBar`, `TaskCreateDialog`, `MentionTextarea`, `Markdown`, `AttachmentSection`, plus `mentions`, `task-dates`, `subtask-progress`, `activity-format`, `upload-state`.                                                                                                                                     |
| `hooks`                      | `useTaskMutations`, `useTasks`, `useAuth`, `useWatchers` (every cache entry holding a task's detail), `useRealtime`, `useNotifications`, `useAttachments`, `useReports`, `useSearch`, `useAdminUsers`, `useAdminTelemetry`, plus the Round-2 `useAdminOrgs`, `useAdminProjects`, `useInstanceSettings`, `useLastOrg` and the pure `useGridUrlState` codec. |
| `lib`                        | `api` (envelope unwrap + the single-flight refresh), `realtime-cache`, `board-cache`, `query-keys`, `socket`, `csv`, `format`, `shortcuts`, `telemetry-client`, `project-key`, and the two motion suites (`motion-policy`, `motion-imports`).                                                                                                              |
| `components/dashboard`       | `DataTable`, `PanelCard` (the state ladder and the no-fixed-aspect rule), `StatTile` + `StatDelta`, `range`, `format`, `series-delta`, `save-blob`.                                                                                                                                                                                                        |
| `components/admin/analytics` | `metric-registry` (shape, i18n exhaustiveness over **both** catalogs, `detailPath`/`lookupMetric` prototype guards, sorting, and the one-request-per-domain fetch contract), `MetricChart`, `MetricTile`.                                                                                                                                                  |
| `components/datatable`       | `TaskDataTable`, `cells`, `csv-rows`, `table-sort`, `table-filters`, `table-prefs`, `useCellPatch`.                                                                                                                                                                                                                                                        |
| `stores`                     | `useAuthStore`, `useBoardFilterStore`, `useLayoutStore`, `usePresenceStore`, `useThemeStore`, `useDiagLogsStore`, `useAnalyticsStore` (cold/warm, the preset cache key).                                                                                                                                                                                   |
| `components/theme`           | `ThemeStudio`, `ThemeStudioDrawer` (focus, Escape, the roving tablist and its RTL flip), `theme-presets`, `theme-file`, `theme-storage`, `color`, `favicon-updater`.                                                                                                                                                                                       |
| `components/reports`         | `report-cards`, `report-summaries`, `report-range`, `chart-format`, `chart-theme` (the `chartStyle` token), `chart-animation` (`useColdChart`), `sprint-default`.                                                                                                                                                                                          |
| `components/gantt`           | `GanttChart`, `useGanttGeometry`, `useGanttDependencies`, `gantt-arrows`, `gantt-drag`, `gantt-rows`.                                                                                                                                                                                                                                                      |
| `components/board`           | `BoardCanvas`, `BoardColumn`, `BoardCard`, `dnd`, `swimlanes`, `board-meta`, `DropSettle`.                                                                                                                                                                                                                                                                 |
| `components/backlog`         | `BacklogSections`, `SprintDialogs`, `backlog-dnd`, `backlog-points`, `backlog-dates`, `backlog-collapse`.                                                                                                                                                                                                                                                  |
| `components/navigation`      | `nav.config` (the `buildSections` gate matrix), `breadcrumb-trail` (the four crumb families), `view-as` (the bounce rule) — all node-environment, no router, no i18next.                                                                                                                                                                                   |
| `components/layout`          | `Sidebar` and `OrgSwitcher` (the escape routes), `PresenceAvatars`.                                                                                                                                                                                                                                                                                        |
| `components/palette`         | `CommandPalette`, `ShortcutsCheatSheet`, `shortcuts-wiring`, `palette-items`, `chords`.                                                                                                                                                                                                                                                                    |
| `components/calendar`        | `CalendarMonthView`, `useCalendarTasks`, `calendar-layout`, `calendar-dates`, `calendar-dnd`.                                                                                                                                                                                                                                                              |
| `components/notifications`   | `NotificationBell`, `NotificationsPage`, `optimistic-read`, `notification-sentence`.                                                                                                                                                                                                                                                                       |
| `components/common`          | `task-icons`, `MotionCard`, `RouteSkeleton`.                                                                                                                                                                                                                                                                                                               |
| `components/ui`              | `round2-primitives`, `alert-dialog`, `collapsible`, `animated-tooltip`.                                                                                                                                                                                                                                                                                    |
| `pages` + `routes`           | `ThemePage`, the five `admin/Admin*Page` suites, `admin/AnalyticsDetailPage` and `AnalyticsEngagementPage`, `project/TaskSheetPage`, `routes/auth-gate`.                                                                                                                                                                                                   |
| `i18n`                       | `locales` (en↔ar key parity — the Arabic catalogue is complete and must stay complete), `errors`, `validation`.                                                                                                                                                                                                                                            |
| `components/admin`           | `admin-telemetry-ui`, `telemetry-range`.                                                                                                                                                                                                                                                                                                                   |
| `components/diagnostics`     | `DiagnosticsDrawer`, `diag-chrome`.                                                                                                                                                                                                                                                                                                                        |
| `components/workflow`        | `StatusList` — `statusSyncSignature`, the rule deciding when the editor's local copy re-syncs from the server.                                                                                                                                                                                                                                             |

### 4.5 The two enforcement suites

Two web suites are not tests of behaviour but of **discipline**, and both would
be worthless as a convention:

- **`lib/motion-imports.test.ts`** reads the real source tree with
  `import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', eager: true })` and
  asserts the files importing the `motion` library are **exactly**
  `MOTION_LIBRARY_FILES`. The animation runtime is the part `index.css`'s
  `data-motion` gate cannot see, so it is the part counted by hand. It also
  checks the glob sees more than a hundred files, so it cannot rot into a silent
  no-op. See [motion.md](./motion.md) §5.1.
- **`components/admin/analytics/metric-registry.test.ts`** resolves every i18n
  key the registry emits against **both** catalogs and asserts catalog↔registry
  id parity in both directions. English is typed; Arabic is not, so a
  half-translated metric compiles cleanly and fails only here.

**Copy the shape, not the file.** A rule that cannot be expressed in a type is
worth a suite that greps for it — but it needs a self-check (does the scan see
anything at all?) or it becomes a test that passes because it read nothing.

---

## 5. Determinism

A test that fails on a Tuesday is worse than no test: it trains everyone to
re-run instead of read. Four rules hold the suite still.

**Fixed clocks, never `Date.now()` in an assertion.** The telemetry seeders take
an explicit `createdAt` (`at('2026-08-20T09:15:00.000Z')`, `hoursFrom`,
`daysFrom`) precisely because the aggregations are about time: a fixture that
could only be "now" cannot test a bucket boundary, a window edge or a seven-day
cut-off. Where a component must see a moving clock, freeze it with
`vi.useFakeTimers()` and restore it in the same file.

**Fixed seeds, never `Math.random()`.** `src/scripts/seed-utils.ts` exports a
plain LCG (`createRandom(seed)`), and `seed.ts` drives every choice from one
`RANDOM_SEED`. Same seed, same database, every run — which is what makes a
"the burndown looks wrong" report reproducible instead of anecdotal.

**Isolation is per test, not per file.** `truncateAllTables()` in a `beforeEach`
on the API side; `localStorage`/`sessionStorage` cleared in a `beforeEach` on the
web side; `afterEach(cleanup)` in every jsdom suite. A suite that arranges in
`beforeAll` and mutates in a test has already broken its own second run.

**Never assert on an ordering the query does not guarantee.** The board and the
backlog are ordered by their rank columns and nothing else; the activity feed is
ordered by `id`, not by `created_at` (two rows written inside one transaction
share a timestamp). If a test needs a stable order, it must come from an
`ORDER BY` the production query actually issues.

Two async shapes need an explicit settle rather than a sleep:

- **Fire-and-forget writes.** `record()` (telemetry) and the domain-event bus are
  never awaited by the caller. Use `captureTelemetry()` / `captureDomainEvent()`
  plus `await flushAsync()` from `task-domain.fixtures.ts` — a bare assertion
  races the sink.
- **Socket delivery.** Use `waitFor(client, event)` for arrival and
  `expectNoEvent(client, event)` for the negative case. Never a bare
  `setTimeout` assertion.

---

## 6. End-to-end (Playwright)

62 tests in 23 files, all of them write-heavy against real servers, a real
Postgres and a real MinIO. Do not duplicate this section elsewhere: §2.1 gives
the two commands, §2.5 gives the Chromium prerequisite.

⚠️ **The seed has TWO organizations now** (`acme` and `globex`), which changed
the first thing every spec used to do. A fresh session has no remembered org, so
`/` renders the **organization picker** rather than redirecting — `smoke.spec`
and `auth.spec` pick `acme` the way a person would, with
`a[href="/o/acme"]`. Anything that asserts "signing in lands on the org home"
has to click first. The second org is also what makes the switcher, the
cross-org admin tables and single-organization mode testable at all: every one
of those surfaces is a no-op on a one-organization deployment.

### 6.1 A cold start needs two things, and provisions the rest

```bash
docker compose -f docker-compose.dev.yml up -d                   # Postgres + MinIO
pnpm --filter @flowboard/e2e exec playwright install chromium    # once per machine
pnpm e2e
```

Nothing else. The run **drops and recreates its own `flowboard_e2e` database**,
migrates it from zero, seeds it, and only then starts the API against it. Two
consecutive runs are therefore identical, and neither can see what the previous
one wrote — which is what makes the write-heavy specs safe to keep.

### 6.2 The database is provisioned by the API's start command, not by `globalSetup`

**This is the opposite of what the plan assumed, and the ordering is why.**
Playwright runs its startup phases in this order:

```
remove output dirs  →  PLUGIN SETUP (this is `webServer`)  →  global setup
```

`createGlobalSetupTasks()` in `playwright/lib/runner` puts the webServer plugin
_before_ the global-setup files. A `globalSetup` that created the database would
therefore run minutes after the API had already tried — and failed — to connect
to one that did not exist, and the run would die in `webServer` with a timeout
that says nothing about the cause.

So the provisioning lives inside the API's own start command. `webServer[0]` is
`pnpm exec tsx ./scripts/start-api.ts`, which drops/creates/migrates/seeds and
_then_ execs `pnpm --filter @flowboard/api dev` with `DATABASE_URL` overridden.
The health probe on `/api/health` consequently means what it claims: the API is
up **and** its database is reachable.

`DROP DATABASE … WITH (FORCE)` then `CREATE`, rather than a truncate: the seed
refuses to run against a database that already holds users, and a truncate would
leave the drizzle journal behind so an edited migration would be silently
skipped. Recreating proves "migrations apply from zero" on every single run.

### 6.3 What `global-setup.ts` does instead: fence the run

Two jobs no individual spec can do.

1. **Prove the API is on the right database** — not that the right
   `DATABASE_URL` was passed, but that the running process resolved it. The
   seeded admin's uuid is minted by Postgres at insert time, so it differs in
   every copy of the seed; the id a real login returns names the database the
   server is actually serving.
2. **Prove nothing else was written to.** It counts every row of `flowboard`
   (the dev database) and `flowboard_test` (the API's vitest database) before the
   first test and again after the last, and fails the run if one number moved.

A green suite that quietly rewrote the dev database is the failure this exists to
make impossible. Both checks print to stdout, so a passing run says so:

```
[e2e] flowboard_e2e: 90 tasks, 10 users, 4 projects
[e2e] the API is serving flowboard_e2e (admin 6f1e…)
[e2e] flowboard untouched — row counts identical before and after
[e2e] flowboard_test untouched — row counts identical before and after
```

`reuseExistingServer` is **off, including locally**. A `pnpm dev` already on
port 4000 is attached to the dev database, and silently reusing it would point
the whole suite at real data. Playwright fails fast with "port is already used"
instead — a five-second fix rather than a restore.

### 6.4 Sequential, and why it stays that way

`fullyParallel: false`, `workers: 1`. Every worker would share the one seeded
database, and the specs write to _shared seeded rows_: `board.spec` drags a card
`realtime.spec` is watching, `sprint.spec` completes the sprint `table.spec`
sorts by. Isolating them means a database per worker — N migrate-and-seed passes
for a suite that already fits in single-digit minutes, plus a cleanup story for
the leftovers. Parallelism would buy wall-clock time and pay for it in failures
that land in whichever spec was unlucky rather than in the one with the bug.

### 6.5 The request budget — the suite respects the API's rate limits

Two limiters, and the suite obeys both from the client side rather than asking
for either to be weakened.

- **Credentials, 10/minute.** `reserveAuthSlot()` in `helpers/api.ts` paces the
  login/refresh/invite calls, and token pairs are cached per account for the run
  so a file costs one login per account it drives, whatever its test count. Only
  `auth.spec` ever waits.
- **Everything else, 300/minute.** One page load of this app costs eight to ten
  requests, so the run is well into four figures. Volume was never the problem —
  distribution was: unpaced, the suite ran three consecutive minutes at 266-284
  and a 429 landed in whichever spec was unlucky. `helpers/rate-budget.ts`
  counts every API request (browser and helper alike) and holds each test at the
  starting line until the last minute has room for what it is about to spend.
  Measured after: **peak 200/minute, zero 429s.**

A 429 is expensive here in a way worth stating: `helpers/api.ts` retries its
own, but the browser does not. A rejected mutation rolls its optimistic update
back and a rejected query renders "…did not load" — both look exactly like the
feature being broken, in a spec that has nothing wrong with it.

⚠️ **The 300/minute limiter keys by IP, not by user, despite reading as though it
does both.** `app.use('/api', defaultRateLimit, apiRouter)` mounts it ahead of
every router and therefore ahead of `requireAuth`, so `req.user` is undefined
when the key is computed. Splitting the suite across accounts does not raise the
ceiling, and in production an office behind one egress IP shares a single budget.
Reported as a product bug; the budget above is the suite's side of it.

### 6.6 Who each spec signs in as

Spread across six seeded accounts for **coverage**, not for rate limiting (see
the note above — it would not help). Most of the suite runs as a
non-global-admin, which is how the product is actually used, so a permission
regression that only bites ordinary members now has something to fail.

The roles that constrain the mapping: everything in the task domain — create,
patch, move, comment, attach, delete — needs project `member`; sprint **start**
and **complete** need project `admin`; `/admin/**` needs a global admin.

| Account                       | Drives                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `admin@flowboard.dev` (Ada)   | admin, admin-nav, admin-orgs, admin-users, analytics, view-as, auth, diagnostics, smoke, realtime (A) |
| `maya@` — org + project admin | board, task, workflow, theme-drawer (board half), notifications (as the commenter)                    |
| `nina@` — CORE project admin  | sprint, roadmap                                                                                       |
| `sara@` — member              | calendar, theme, notifications, realtime (B)                                                          |
| `liam@` — member              | table, palette, rtl, theme-drawer, instance-mode (the member half)                                    |
| `priya@` — Globex only        | never signs in — she OWNS `view-as.spec`'s fixture org (see below)                                    |
| `omar@` — Arabic locale       | _deliberately not a driver_ — see `helpers/seed.ts`                                                   |

The console specs all run as the global admin because there is no alternative:
`/admin/**` is behind `requireGlobalAdmin`, and `admin.spec` already owns the
one case that proves an org admin is refused.

`priya@` is the exception worth explaining. `view-as.spec` has to observe
`GET /orgs?scope=member` NARROWING something, and Ada is a member of both seeded
organizations — so the spec provisions a third org with `adminUserId: priya`,
which is an organization the admin can see and is not in. Without it, member
view would remove no rows and a green test would prove nothing.

### 6.7 The spec inventory

| File                    |  Tests | What it owns                                                                                                                                                                           |
| ----------------------- | -----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smoke.spec.ts`         |      1 | The one journey through the **login form**; do the two halves of the product still agree at all                                                                                        |
| `auth.spec.ts`          |      5 | Bad password, sign-out, deep-link `returnTo`, invite → account, change-password revokes old refresh                                                                                    |
| `board.spec.ts`         |      6 | Column counts vs the server, drag survives reload, WIP limit refuses, transition whitelist refuses, quick-add, filters + swimlanes                                                     |
| `task.spec.ts`          |      1 | The full lifecycle: `c` → create → fields (incl. 0.5 points) → subtask → dependency cycle refused → @mention → S3 round trip → watch → activity → delete                               |
| `sprint.spec.ts`        |      2 | Backlog reorder survives reload; create → fill → complete the running one → velocity gains a bar → start → board reflects                                                              |
| `table.spec.ts`         |      4 | Inline edit written through, sort by Updated, column hide persists, CSV (BOM + headers + row count)                                                                                    |
| `calendar.spec.ts`      |      3 | Chips on seeded due dates, drag to another day keeps the span length, unscheduled tray schedules                                                                                       |
| `roadmap.spec.ts`       |      3 | Bars + dependency arrows, bar drag moves whole days keeping duration, zoom keeps the today line                                                                                        |
| `realtime.spec.ts`      |      1 | **Two contexts**: A drags → B sees it with no reload; B's @mention rings A's bell; the bell deep-links                                                                                 |
| `notifications.spec.ts` |      3 | Bell count + tab filters, a notification opens its task, mark-all-read                                                                                                                 |
| `admin.spec.ts`         |      3 | Org admin refused in place, provision → temp password → deactivate, telemetry charts + this session's `page_view`s                                                                     |
| `diagnostics.spec.ts`   |      3 | Global-admin only, Ctrl+J + rows streaming + level filter, dock cycle + resize + clipboard JSONL                                                                                       |
| `theme.spec.ts`         |      2 | Preset applies live → saves → survives reload → resets; export/import round trip                                                                                                       |
| `palette.spec.ts`       |      3 | Ctrl+K navigation, 3-char search opens a sheet, `?` cheat sheet reads the live registry                                                                                                |
| `rtl.spec.ts`           |      1 | Arabic: `dir=rtl`, board and sheet still render, **Western digits**, switch back                                                                                                       |
| `workflow.spec.ts`      |      2 | Status add → rename → WIP limit across a reload; delete relocates its tasks via `moveTasksTo`                                                                                          |
| `admin-nav.spec.ts`     |      3 | **The admin trap**: sidebar org row / brand mark / breadcrumb Home each escape `/admin/*`; the switcher is enabled + searchable; the palette carries Home + the admin rows             |
| `admin-orgs.spec.ts`    |      2 | Create → switcher → rename → archive (typed gate) → archived toggle → restore; a duplicate slug gets `slug_taken`, not the refresh message                                             |
| `admin-users.spec.ts`   |      2 | Provision WITH an org grant (one transaction) + the memberships dialog adds a second; anonymize-delete behind a typed-EMAIL gate                                                       |
| `instance-mode.spec.ts` |      2 | Admin flips to single mode → switcher gone, `/` short-circuits, the orgs page explains itself; a two-org member lands in the default with no switcher                                  |
| `analytics.spec.ts`     |      4 | Overview tiles carry numbers; a KPI drills and the back link returns; the range survives Work → Traffic (in-app); a facet narrows table + CSV; events-feed URL state survives a reload |
| `theme-drawer.spec.ts`  |      4 | Three ways in + Escape; apply → save → reload → reset+save; over a LIVE board + the `/theme` hand-off; **reduced-motion smoke** (boots, opens, still drags)                            |
| `view-as.spec.ts`       |      2 | Member view drops the console from sidebar + palette, refuses `/admin/*` IN PLACE with a Return button, narrows the switcher; the pill is the other way back                           |
| **Total**               | **62** |                                                                                                                                                                                        |

### 6.8 Helpers

`e2e/helpers/` — a helper may **arrange, never assert**.

| Module           | Owns                                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `env.ts`         | Repo-root `.env` → the e2e/dev/maintenance database URLs, ports, the API child's env                                               |
| `database.ts`    | Provisioning, row counts, the seeded-admin-id probe                                                                                |
| `api.ts`         | Authenticated client: envelope unwrap, 429 retry honouring `Retry-After`, session + lookup caching                                 |
| `app.ts`         | `signIn` (injects a session), `signInThroughForm`, `useLanguage` / `useMotionPreference`, the dnd-kit drag, toast + board locators |
| `seed.ts`        | What the seed contains, named once — accounts, **both organizations**, project keys, statuses, WIP limit                           |
| `rate-budget.ts` | The 300/minute gate (§6.5)                                                                                                         |
| `test.ts`        | The `test` object every spec imports — attaches the budget automatically                                                           |

Specs import `test`/`expect` from `../helpers/test`, **never** from
`@playwright/test`: reaching past it silently opts that file out of the budget.

### 6.9 Conventions

- **No arbitrary sleeps.** Web-first assertions and `expect.poll` throughout. The
  only waits are the two rate-limit gates, which are the client half of a
  documented server limit.
- **Assert against the server, not the optimistic paint.** A card that moved
  because the cache moved it, over a PATCH that 400ed, looks identical on screen.
  Every mutation is confirmed by a reload or an API read.
- **Restore what you mutate**, or create-then-delete a uniquely-suffixed fixture.
  Each run re-seeds anyway, but a spec that leaves the seed as it found it can be
  run twice inside one run and reasoned about alone. Two domains have no hard
  delete and the sweeper has to know it: an **organization** is archived
  (`admin-orgs`, `view-as`) and an **account** is anonymized (`admin-users`),
  which are the closest thing to a teardown either offers. Both are inert
  afterwards — invisible to every switcher, deactivated, in no organization — so
  neither can reach another spec.
- **A globally shared row needs an unconditional `afterEach`.** There is exactly
  one `instance_settings` row, so `instance-mode.spec` restores `orgMode: multi`
  through the **API** (never the form) whether or not the test got that far. A
  file that flipped the instance and failed on its way back would take the org
  switcher away from `admin-nav`, turn `/` into a redirect for `smoke`, and do it
  in whichever spec ran next.
- **Prefer the grid kit's own testids to role + text.** The dashboard tables all
  render through `components/dashboard/DataTable`, which stamps a stable contract:
  `table-facet-<id>`, `table-facet-<id>-<value>`, `table-facet-<id>-clear`,
  `table-range`, `table-page`, `table-column-<id>`, plus `stat-tile-<id>` /
  `stat-value` and the analytics console's `analytics-kpi-<metric>`. Reaching for
  role + visible text instead is what W3.1 had to unpick when the telemetry feed's
  bespoke single-select combobox became a generic multi-select facet: the
  assertion was unchanged, but every locator that named the old control had to be
  rewritten. Sort headers are the deliberate exception — `aria-sort` on the
  `<th>` **is** the contract, and asserting it is asserting the accessibility
  semantics rather than a class name.
- **`e2e#test` is never cached** (see `turbo.json` and §2.5): its result depends
  on process and database state that no input hash can observe, so a cached
  "pass" would be a replay rather than a run.

### 6.10 Known flake risks

- **dnd-kit drags** need a move past the 4px activation distance and at least one
  more inside the target; `dragTo` in `helpers/app.ts` does four. Drop _targets_
  matter too — dropping on a sprint section's header lands in the section above,
  so `sprint.spec` aims at the empty-state body.
- **A hidden page's timers are throttled.** `diagnostics.spec` opens a second tab
  to make the server log a line, then calls `bringToFront()` before polling —
  without it the drawer's own 2 s poll stalls and the assertion fails only under
  the full suite.
- **The ring buffer holds 500 records** and the list renders at most 500, so on a
  warm server a row _count_ cannot grow. Assert on the highest `data-log-id`.
- **Ordinary requests write no pino line** — `requestLogger` batches to a table
  and the error handler only logs 5xx. The drawer's streaming test triggers a
  socket connection, which does log.
- **The sidebar's org links depend on `fb-last-org-v1`.** `buildSections`
  resolves them from `orgSlug ?? lastOrgSlug ?? defaultOrgSlug`, and on
  `/admin/*` in a multi-org instance only the middle rung can answer. A spec that
  opens the console in a brand-new context sees a Workspace section with **Home
  and nothing else** — correct behaviour, and not the case `admin-nav.spec` is
  about, which is why that file visits `/o/acme` first.
- **The analytics range is in-memory, not in the URL.** `useAnalyticsStore` holds
  it for the four dashboards, so it survives a `<Link>` and dies on a `goto`. The
  detail page keeps its own local range on purpose. A "the range persisted" test
  therefore has to click a nav row; a `page.goto` would silently assert the
  default. (The events feed is the opposite: its state IS the query string.)
- **`page_view` telemetry is spread over the trailing 14 days** with a recency
  bias, so the feed's `24h` preset can legitimately be thin. Assert against
  "All time" (its default) or against a `from=`-windowed API read, as
  `admin.spec` does.
- **The Theme Studio drawer is hand-rolled, not a Radix dialog** — deliberately,
  so the app behind the scrim stays a live preview. It therefore gets none of
  Radix's focus trapping or `aria-hidden` for free, and a spec must not assume
  the background is inert: `theme-drawer.spec` asserts the opposite, that the
  board keeps its DOM.

---

## 7. Coverage and the gate

**There is no line-coverage threshold, and that is deliberate.** Neither vitest
config enables the `coverage` provider. A percentage is satisfied by asserting
that a function returns something; what FlowBoard actually gates on is whether
the _behaviours_ are covered, which is a reviewer judgement rather than a
number.

The gate itself is one command, and it must be green before a wave hands off:

```bash
pnpm turbo run build lint typecheck test
```

The obligations behind it are
[review-checklist.md §9](../checklists/review-checklist.md), reproduced here as
what a reviewer will actually check:

| Obligation                                                                                                      | Where it lands                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Tests are colocated `*.test.ts` beside the code they test.                                                      | Everywhere except the API's `__tests__/` folders, which exist so `tsconfig.json` can keep `supertest` and `socket.io-client` out of `dist/`. |
| A new endpoint has supertest coverage for the happy path, a zod rejection, **and** the role matrix.             | `apps/api/src/routes/__tests__/*.routes.test.ts`                                                                                             |
| New pure logic (rank, geometry, aggregation) has unit tests.                                                    | Colocated beside the unit                                                                                                                    |
| A concurrency-sensitive operation has a test that fires parallel requests.                                      | The `PROJ-N` counter and the one-active-sprint constraint both do                                                                            |
| A schema change updates `src/db/schema.test.ts` if it touched an enum, a soft-delete column, or a pinned index. | `apps/api/src/db/schema.test.ts`                                                                                                             |
| No test was skipped or weakened to make the suite pass.                                                         | `it.skip` / `it.todo` are review findings, not fixes                                                                                         |

**A failing test is a finding, not an obstacle.** Deleting the assertion, adding
a retry, or widening the expectation to whatever the code currently returns are
all ways of converting a caught defect into an uncaught one.

---

Back to [docs/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
