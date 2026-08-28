# Architecture

How FlowBoard is put together: the monorepo and its build graph, the shape of a
single HTTP request from route to envelope, the layering rule and the two places
that are allowed to break it, the domain-event bus that decouples services from
realtime, and the two data flows worth walking end to end (a Kanban drop, and a
sign-in). Read this before anything structural — a new package, a new router, a
new socket event, or a change to how state is cached on the client.

## 1. Monorepo map

FlowBoard is a **pnpm workspace + Turborepo** monorepo. Node `>= 22`, package
manager pinned to `pnpm@11.1.2` via `packageManager` in the root
`package.json`, `node-linker=hoisted` in `.npmrc`.

```text
Project-Management/
├── .npmrc  .gitattributes  .prettierignore  pnpm-workspace.yaml  turbo.json  package.json
├── prettier.config.mjs             # re-exports @flowboard/config/prettier
├── docker-compose.dev.yml          # Postgres + MinIO for local dev
├── CLAUDE.md → AGENTS.md → .agents/     docs/     README.md
├── e2e/                            # @flowboard/e2e — Playwright config + specs
├── packages/
│   ├── config/                     # @flowboard/config — tsconfig / eslint / prettier
│   └── shared/                     # @flowboard/shared — zod schemas (the contract layer)
└── apps/
    ├── api/                        # @flowboard/api — Express 5 + Drizzle + Postgres + Socket.IO
    └── web/                        # @flowboard/web — Vite + React 19 + TanStack Query + Zustand
```

`pnpm-workspace.yaml` globs `apps/*`, `packages/*` and `e2e`.

### 1.1 Dependency edges

```text
web  → @flowboard/shared, @flowboard/config
api  → @flowboard/shared, @flowboard/config
e2e  → @flowboard/config          (Playwright + a raw `postgres` client for fixtures)
shared → @flowboard/config
```

- **`packages/shared` is the contract layer, and it is runtime-neutral.** Every
  entity, request body, response payload and socket event is a zod schema there,
  imported by both ends. `packages/config/eslint.config.mjs` exports
  `sharedPackageConfig`, which bans `window`, `document`, `navigator`,
  `localStorage`, `process`, `require` and `__dirname` inside it — the package is
  bundled into the browser _and_ `require`d by the Node process, so a global that
  exists in only one of them is a production-only crash. The barrel is
  `packages/shared/src/index.ts`.
- **`packages/shared` is dual-built.** `tsup` emits `dist/index.js` (ESM) and
  `dist/index.cjs` (CJS) plus `.d.ts`, which is what lets the CommonJS API and
  the ESM web bundle import the same module. `fractional-indexing` is ESM-only
  and is therefore **bundled into** the CJS output (`noExternal`), so `apps/api`
  never imports it directly — see `packages/shared/src/rank.ts`.
- **`packages/config` ships no code**, only `tsconfig.base.json`,
  `tsconfig.node.json`, `tsconfig.react.json`, `eslint.config.mjs` and
  `prettier.config.mjs`, exposed through the `exports` map in its
  `package.json`.
- **`e2e` does not depend on `shared`.** It drives the product through a browser
  and seeds fixtures with raw SQL, so it deliberately holds no compile-time
  coupling to the contract.

### 1.2 Version pinning: the `catalog:` block

Every version used by **more than one** manifest is pinned once in the
`catalog:` block of `pnpm-workspace.yaml`; a manifest opts in by writing
`"vitest": "catalog:"`. A bump then happens in one file and cannot drift — two
different Vitest majors across `api`/`web`/`shared` is exactly how test
harnesses diverge silently.

**Only promote a dependency to the catalog once a second package needs it.**
Single-consumer deps stay literal in that package's manifest. Two pins carry
non-obvious constraints, documented inline in the file:

| Pin           | Value      | Why it is not `latest`                                                                                                                                                           |
| ------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript`  | `~5.9.3`   | `typescript-eslint@8` declares `typescript: ">=4.8.4 <6.1.0"`; losing it loses the `no-explicit-any` gate. TS 6.0.3 also errors on `tsup --dts`'s injected `baseUrl` (`TS5101`). |
| `@types/node` | `^24.13.0` | Tracks the Node **major actually run**, not npm `latest` — types ahead of the runtime advertise APIs that do not exist.                                                          |

`allowBuilds` in the same file whitelists `esbuild`'s postinstall (pnpm blocks
dependency lifecycle scripts by default); add an entry only with a reason.

### 1.3 The turbo task graph

`turbo.json` defines five tasks. Its `globalEnv` list (`NODE_ENV`, `PORT`,
`DATABASE_URL`, the JWT secrets and TTLs, `WEB_ORIGIN`, `LOG_LEVEL`, `S3_*`,
`VITE_*`) participates in **every** task hash, and `globalDependencies` names
`.env` plus `packages/config/tsconfig.base.json` — the base tsconfig lives in
`packages/config`, not at the root, so a bare filename would match nothing and a
strictness change would replay stale cached passes.

| Task        | `dependsOn`                                  | Cached | Why                                                                                                                                          |
| ----------- | -------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `build`     | `^build`                                     | yes    | Emits `dist/**`. `^build` is what lets `apps/api` and `apps/web` resolve `@flowboard/shared` through its emitted `.d.ts`.                    |
| `dev`       | —                                            | **no** | Persistent watch processes; they never finish, so they can never be replayed.                                                                |
| `lint`      | —                                            | yes    | ESLint reads only source + config, and lint here is type-unaware by design, so no dependency build is needed.                                |
| `typecheck` | `^build`                                     | yes    | `tsc --noEmit` resolves cross-package imports through the dependency's **emitted declarations**, so those must exist first.                  |
| `test`      | `^build`                                     | yes    | Same reason: the suites import `@flowboard/shared` from `dist`. `inputs` is left at `$TURBO_DEFAULT$` — narrowing it can only hide a change. |
| `e2e#test`  | `@flowboard/web#test`, `@flowboard/api#test` | **no** | See below.                                                                                                                                   |

**`e2e#test` is uncached and runs last, alone**, and both halves of that are
deliberate:

- _Uncached_ — Playwright runs against real servers and a real database, so its
  result depends on process and DB state no input hash can observe. A cached pass
  would be a **replay**, not a run.
- _Last, alone_ — without the two `dependsOn` edges, Turbo would schedule the
  browser suite beside ~2 600 Vitest cases in `apps/web` and `apps/api`. A
  browser suite driving two real dev servers cannot compete with that for cores;
  the observed symptom was one arbitrary spec failing per gate run, a different
  one each time, all passing standalone. The edges also make the gate fail
  **fast**: a broken unit test short-circuits the browser run instead of racing
  it.

## 2. The request lifecycle

### 2.1 The chain

`apps/api/src/app.ts` assembles the app, and the middleware order there is
normative:

```text
requestLogger → cors → json → urlencoded → socketId → rateLimit
  → /api router → notFound → errorHandler
```

Two positions are load-bearing. **`requestLogger` is first** so its
`res.on('finish')` timer measures the whole request including body parsing and a
rate-limit rejection. **`errorHandler` is last and alone** — it is the only
error-envelope formatter in the codebase, and `notFound` in front of it is what
turns an unmatched URL into an envelope instead of Express' HTML default.
`createApp()` binds no port, which is what lets supertest drive it with no
database.

Inside a route the order is equally normative
(`apps/api/src/routes/tasks.routes.ts` states it):

```text
validate(paramsSchema, 'params') → requireProjectRole(role, source) → validate(bodySchema)
  → asyncHandler(controller) → service → Drizzle → respond() → (throw) → errorHandler
```

**Params are validated first** so a malformed uuid is a 422 at the boundary
rather than reaching the guard's `WHERE id = 'not-a-uuid'` and surfacing as a 500.

`asyncHandler` (`apps/api/src/utils/async-handler.ts`) wraps the controller.
Express 5 forwards rejected promises on its own, so it is not strictly required —
it exists to keep the handler's declared return type honest (`Promise<void>`)
and to make "this route awaits something" visible in the route table.

### 2.2 `validate(schema, part)` and `getParsed<T>(res, part)`

`apps/api/src/middlewares/validate.ts` exports both, and the pair is **the key
idiom of the layer**.

```ts
export type RequestPart = 'body' | 'query' | 'params';

export function validate<TSchema extends ZodType>(
  schema: TSchema,
  part: RequestPart = 'body',
): RequestHandler;

export function getParsed<TValue>(res: Response, part: RequestPart = 'body'): TValue;
```

`validate` `safeParse`s one request part; on failure it forwards the `ZodError`
to `next()` and the single `errorHandler` renders the 422. On success it does two
things:

1. **Writes `res.locals.parsed[part]`** — the canonical, typed read.
   `getParsed<T>(res, part)` returns the schema's own output type with no cast.
   This is what controllers must use: Express types `req.query` as `ParsedQs`
   (`string | string[] | …`) no matter what the schema coerced it to, so reading
   `req.query.page` as a `number` would be a type lie even when it is a number at
   runtime.
2. **Replaces the request part in place** — plain `defineProperty` for
   `body`/`params`, and `defineProperty` shadowing the prototype getter for
   `query` (Express 5 made `req.query` a lazily-memoised getter, so
   `req.query = parsed` throws in strict mode). This is a compatibility shim so
   anything reading `req.body`/`req.query` directly sees the coerced value and
   the two paths can never disagree.

**`getParsed` throws `ApiError.internal` when the part was never validated.**
That is a wiring bug — a handler reading `getParsed(res, 'query')` with no
`validate(…, 'query')` ahead of it — and failing loudly beats silently returning
`undefined`.

The `res.locals` slots (`parsed`, `socketId`) and `req.user` are declared in one
place, `apps/api/src/types/express.d.ts`, so two work packages can never merge
conflicting `declare global` blocks for the same property.

### 2.3 The envelope

`packages/shared/src/envelope.ts` owns the one response shape.

```ts
export interface SuccessEnvelope<TData> {
  success: true;
  data: TData;
  meta?: PaginationMeta; // { page, pageSize, total, totalPages }
}

export type ErrorEnvelope = { success: false; error: { code; message; details? } };

export function ok<TData>(data: TData, meta?: PaginationMeta): SuccessEnvelope<TData>;
export function fail(error: ApiErrorPayload): ErrorEnvelope;
export function envelopeSchema<TData extends z.ZodType>(data: TData); // discriminated union
```

The two halves are a **discriminated union on `success`**, so narrowing gives
TypeScript `data` on one branch and `error` on the other with no casts.
`envelopeSchema(payloadSchema)` is what `apps/web/src/lib/api.ts` parses every
response with.

The success half is constructed in exactly one place on the server:
`respond(res, data, meta?, status = 200)` in `apps/api/src/utils/respond.ts`
(`respondNoContent(res)` for 204). **Never build an envelope literal in a
controller** — one constructor is what keeps the shape true of every response.

### 2.4 `ApiError` and the error handler

`apps/api/src/utils/api-error.ts` is the typed application error;
`apps/api/src/middlewares/error-handler.ts` is the **only** place one becomes an
envelope. Everywhere else just `throw ApiError.notFound(...)`, which is why
services never need to know they are running inside HTTP.

`resolve(err)` maps three cases:

| Input         | Status  | `code`             | `details`                                  |
| ------------- | ------- | ------------------ | ------------------------------------------ |
| `ApiError`    | its own | its own            | its own                                    |
| `ZodError`    | `422`   | `validation_error` | `{ path, code, message }[]`, one per issue |
| anything else | `500`   | `internal_error`   | withheld                                   |

The `ApiError` static constructors, which are the full catalogue of standard
codes:

| Constructor          | Status | `code`                | Notes                                                                                    |
| -------------------- | ------ | --------------------- | ---------------------------------------------------------------------------------------- |
| `badRequest`         | 400    | `bad_request`         |                                                                                          |
| `unauthorized`       | 401    | `unauthorized`        | "this request had no usable session" — the guards.                                       |
| `invalidCredentials` | 401    | `invalid_credentials` | "the credentials you typed are not a pair". The message never says which half was wrong. |
| `forbidden`          | 403    | `forbidden`           |                                                                                          |
| `notFound`           | 404    | `not_found`           |                                                                                          |
| `conflict`           | 409    | `conflict`            |                                                                                          |
| `validation`         | 422    | `validation_error`    |                                                                                          |
| `tooManyRequests`    | 429    | `rate_limited`        |                                                                                          |
| `internal`           | 500    | `internal_error`      |                                                                                          |
| `serviceUnavailable` | 503    | `service_unavailable` |                                                                                          |

Services also throw `new ApiError(...)` with **domain-specific codes** the web
client branches on: `409 transition_not_allowed` and `409 wip_limit_exceeded`
(`apps/api/src/services/task-move.service.ts`), `409 stale_neighbour`
(`apps/api/src/utils/rank-rebalance.ts`), and `401 token_expired`, which
`apps/web/src/lib/api.ts` treats as the one refreshable 401.

**`code` is stable API surface; `message` is not.** The message is English, for
logs and last-resort toasts. Two further rules in the handler:

- **5xx `details` are withheld in production** (a stack trace or a driver message
  is a disclosure, not a diagnostic) and logged through pino instead — never
  `console.error`, because pino's second sink is the ring buffer behind the
  diagnostics drawer.
- **`res.headersSent` short-circuits to Express' default handler**: a stream that
  already started cannot be re-rendered as an envelope.

### 2.5 A real quartet — the task domain

Four files, one domain, one naming pattern:

| File                                           | Owns                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| `apps/api/src/routes/tasks.routes.ts`          | Paths, guard chain, `validate(...)` ordering. No logic.                |
| `apps/api/src/controllers/tasks.controller.ts` | `getParsed` → service → `respond`. No query building, no rules, no db. |
| `apps/api/src/services/tasks.service.ts`       | Business rules, transactions, activity + telemetry + domain events.    |
| `apps/api/src/validation/tasks.validation.ts`  | Route-param schemas; re-exports the shared body/query contracts.       |

`tasks.validation.ts` is worth reading for what it does **not** contain: the
body and query schemas come straight from `@flowboard/shared`
(`createTaskInputSchema`, `moveTaskInputSchema`, `patchTaskInputSchema`,
`taskListQuerySchema`, …), re-exported so the router has one import site. What
stays local is what only the server knows — `projectParamsSchema`,
`taskParamsSchema`, `taskByKeyParamsSchema`, `dependencyParamsSchema`.

The controller shows the whole idiom in four lines:

```ts
/** `POST /api/tasks/:taskId/move` — the Kanban drop. */
export async function moveTaskCard(req: Request, res: Response): Promise<void> {
  const { taskId } = getParsed<TaskParams>(res, 'params');
  const input = getParsed<MoveTaskInput>(res);
  respond(res, await moveTask(scopeOf(res), actorOf(req, res), taskId, input));
}
```

`scopeOf(res)` reads `{ projectId, orgId }` off `getProjectAccess(res)` — the
access the guard already resolved, **never re-derived**. `actorOf(req, res)`
pairs `requireUser(req).id` with `getSocketId(res)`, which is the echo-suppression
key of §5.

Routers are registered in `apps/api/src/routes/index.ts` and mounted once at
`/api`. Mount order there is normative — **specific prefixes first, root-stacked
routers last** — and three deliberate cross-mount overlaps
(`/orgs/:orgId/search`, `/projects/:projectId/{tasks,sprints,reports}`, the three
`/admin` mounts) are proven reachable by
`apps/api/src/routes/__tests__/router-mounting.test.ts`.

## 3. The layering rule, and its three exceptions

### 3.1 The rule

```text
routes/        path + middleware chain + controller binding. No logic.
controllers/   HTTP ↔ domain. `getParsed` in, `respond` out.
services/      business rules, transactions, activity/telemetry/domain events.
db/            Drizzle client + schema. `db`, `withTx`, `Db`, `Tx`.
```

**Never import `src/db` outside `services/` and `db/`.** A controller that
queries directly cannot be reused inside a transaction, and in FlowBoard almost
every mutation is a transaction that also writes an activity row. Equally,
**services never touch `req`/`res`** — they take and return plain data and throw
`ApiError`, which is what makes them callable from the socket bridge and from
CLI scripts.

`apps/api/src/db/client.ts` states the same rule in its own header, and
`apps/api/src/db/index.ts` is the barrel everything imports from:

```ts
export { closeDb, db, withTx } from './client';
export type { Db, Schema, Tx } from './client';
export * from './schema';
```

Three files legitimately import `src/db` from outside `services/`. All three are
documented in their own headers and enumerated below; nothing else may join them.

They are not three of a kind. `socket-reads.ts` and `require-roles.ts` both run
real queries and are exceptions to the import rule proper; `bootstrap.ts` is an
exception in the other direction — it exists so that four modules which must
NOT import `db` can still reach it. Two further files look like exceptions in a
grep and are not:

| Looks like an exception      | Why it is not one                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `sockets/realtime-bridge.ts` | Imports `db` only to pass it as a service's executor argument (`requireSprint(db, …)`). It runs no query.    |
| `utils/rank-rebalance.ts`    | Imports the `tasks` table and the `Db`/`Tx` types for column refs; every query runs on an injected executor. |

`scripts/` (migrate, seed) and the test fixtures sit outside the request stack
entirely and are not covered by the rule.

### 3.2 Exception 1 — `apps/api/src/sockets/socket-reads.ts`

The socket layer sits **above** services, so the gateway normally calls them, and
mostly does: `apps/api/src/sockets/realtime-bridge.ts` hydrates through
`getTask`, `requireSprint`, `listStatuses` and `listTransitions`. Four reads have
no service to call:

| Read                                            | Why no service answers it                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `loadUserSummary` — name + avatar for presence  | Nothing in the service layer answers it without also answering admin-CRUD questions.            |
| `loadProjectRef` — project → org id             | `require-roles.ts` (§3.4) has the lookup, but only inside a private helper behind a middleware. |
| `loadComment` — one comment by id               | `comments.service` exposes only a paginated thread.                                             |
| `loadNotificationPush` — one row + unread count | Written in parallel with the notifications service; the bridge must not depend on it.           |

The alternative — widening four service APIs purely so the socket layer can
reach them — would leave functions in those services that no HTTP route calls,
which is a worse smell than one clearly-labelled read module.

**The invariant that keeps it safe: everything in the file is a `SELECT`.** It
never writes and contains no business rules, and every function returns `null`
for "not found" rather than throwing — a broadcast fires after the transaction
already committed, so a row that vanished in between means "skip this emit", not
"crash a handler".

### 3.3 Exception 2 — `apps/api/src/bootstrap.ts`, the composition root

Four modules in the API core are written to know nothing about the database.
Each exposes a setter and no-ops (or fails closed) until something wires it.
`bootstrap()` is the **only** place all four are wired:

| Injection point         | Module                                          | What `bootstrap()` supplies                                           |
| ----------------------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| `setTelemetrySink`      | `apps/api/src/services/telemetry.service.ts`    | `db.insert(telemetryEvents).values(event)`                            |
| `setRequestLogSink`     | `apps/api/src/middlewares/request-logger.ts`    | one multi-row `db.insert(requestLogs)` per **batch** (5 s / 50 rows)  |
| `setSocketUserResolver` | `apps/api/src/sockets/io.ts`                    | `tokenVersion` + `isActive` lookup for the handshake revocation check |
| `setDbHealthChecker`    | `apps/api/src/controllers/health.controller.ts` | `pingDb()` — `select 1`, touching no table                            |

The same function also registers the two Wave-4 domain-event consumers:
`registerRealtimeBridge()` and `registerNotificationSubscribers()`.

Two reasons the indirection earns its keep permanently:

- **`telemetry.service` and `request-logger` are fire-and-forget
  observability.** Their unit suites drive them with a fake sink and assert the
  contract (never awaits, never throws, drops on failure); a hard `import { db }`
  would drag a live pool into every one of those tests.
- **`sockets/io` and `health.controller` sit above the service layer**, where
  §3.1 forbids a `db` import outright.

**The invariant: `server.ts` calls `bootstrap()` once, before it listens;
`app.ts` does NOT.** That split is what lets supertest build the app with no
database, and what keeps the observability modules unit-testable against a fake
sink. `pingDb`'s `select 1` deliberately touches no table — a readiness probe
that read a real one would take a whole instance out of rotation over an
unrelated permission or migration problem.

### 3.4 Exception 3 — `apps/api/src/middlewares/require-roles.ts`, the guards

`requireOrgRole` / `requireProjectRole` import `db` and run their own `SELECT`s:
the session-liveness re-check (`assertSessionLive`), the org-role lookup
(`findOrgRole`), the resource→project→org resolution (`resolveProjectRef`), and
the org-admin-inherits-project-admin combination (`resolveProjectRole`).

**Why a service detour would make the layering worse, not better.** A guard runs
_before_ the controller, and its whole job is to decide whether the controller
may run at all. Routing those lookups through, say, a `membership.service` would
put a service **above** the middleware layer in the call graph — middleware →
service → db, while every other request path is controller → service → db. The
stack would then have two different shapes depending on whether the caller is a
guard, and "services are below controllers" would stop being true. One clearly
labelled guard module that queries directly is the smaller distortion.

Three further facts make it safe, and they are the conditions on the exception:

- **Reads only, and no business rules leave the file.** Like §3.2 it is all
  `SELECT`; the only thing it produces is an `OrgAccess` / `ProjectAccess` value
  on `res.locals`, read back through the typed `getOrgAccess` / `getProjectAccess`
  helpers. Controllers never re-derive membership, so the rule stays in one place.
- **The queries are the guard's own reason to exist.** `resolveProjectRef` maps
  a `taskId` / `sprintId` / `commentId` / `attachmentId` to its project — that
  mapping IS the authorization decision, not a piece of domain logic borrowed
  from somewhere else. `socket-reads.ts` names the same helper (§3.2) precisely
  because there is no service that answers it.
- **It is already paying for a round-trip.** The lazy `tokenVersion` / `is_active`
  re-check documented in `require-auth.ts` rides along on a query the guard makes
  anyway, which is what kills a revoked session inside the access token's 15-minute
  window instead of at its expiry.

**Do not add a fourth.** Anything that needs data at request time and is not one
of these three shapes belongs in a service, called from a controller.

### 3.5 The one controller with no service — `admin-logs`

The layering rule's other half — _controllers call services_ — has a single
sanctioned deviation, and it is not a `db` import. The diagnostics quartet:

| File                                                | Role                                                    |
| --------------------------------------------------- | ------------------------------------------------------- |
| `apps/api/src/routes/admin-logs.routes.ts`          | `GET /api/admin/logs`, behind `requireGlobalAdmin`.     |
| `apps/api/src/controllers/admin-logs.controller.ts` | Calls `snapshot()` from `utils/log-ring` directly.      |
| `apps/api/src/validation/admin-logs.validation.ts`  | Re-exports the shared query schema; asserts the cap.    |
| `apps/api/src/utils/log-ring.ts`                    | The in-memory ring buffer pino's second sink writes to. |

There is **no `services/admin-logs.service.ts`, deliberately.** A service exists
to hold business rules and to be callable inside a transaction, and this endpoint
has neither: it reads a bounded, per-process, in-memory array — no table, no
query, no transaction, nothing to reuse. A pass-through service file would add a
layer that re-exports one function and would imply, falsely, that the logs are
durable state. The compile-time `AssertRingCapacity` in the validation file is
what keeps the shared schema's page cap and `RING_CAPACITY` from drifting apart.

The consequence is the important part and it is why this is documented rather
than silently tolerated: **the ring is per-process**, so behind more than one API
instance this endpoint shows the logs of whichever one served the request. It is
a development and single-instance diagnostic, not an observability backend.

## 4. The domain-event bus

`apps/api/src/utils/domain-events.ts` is a typed, in-process, synchronous
emitter. **Services publish; the realtime layer and the notification service
subscribe.** That is what lets realtime and notifications be added without
editing a single service file.

It is deliberately **not** Node's `EventEmitter`: `on(event: string, listener:
(...args: any[]) => void)` erases the payload type at exactly the boundary that
matters, and `any` is a hard lint gate. A plain `Map` of handler arrays keeps
`publishDomainEvent('task.moved', …)` checked against exactly what
`DomainEventMap` declares.

### 4.1 The catalogue

Every project-scoped event carries `DomainEventContext`:

```ts
export interface DomainEventContext {
  projectId: Uuid;
  /** `users.id` of whoever caused the change. INTERNAL — never emitted. */
  actorId: Uuid;
  /** Socket id of the originating tab, or `null` for server-side actors. */
  originSocketId: string | null;
}
```

| Event                  | Extra payload                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `task.created`         | `taskId`, `statusId`, `assigneeId`                                                                                          |
| `task.updated`         | `taskId`, `changedFields: readonly string[]`, `assigneeId`                                                                  |
| `task.moved`           | `Pick<TaskMovedPayload, 'taskId'\|'statusId'\|'boardRank'\|'rebalanced'>` + `statusChanged`                                 |
| `task.deleted`         | `taskId`                                                                                                                    |
| `comment.created`      | `taskId`, `commentId`, `mentionedUserIds`                                                                                   |
| `comment.updated`      | `taskId`, `commentId`, `mentionedUserIds`                                                                                   |
| `comment.deleted`      | `taskId`, `commentId`                                                                                                       |
| `sprint.changed`       | `sprintId`, `action: SprintChangedPayload['action']`                                                                        |
| `workflow.changed`     | `change: 'statuses' \| 'transitions' \| 'labels'`                                                                           |
| `notification.created` | `recipientId`, `notificationId`, `type`, `projectId \| null`, `actorId \| null`, `originSocketId` (no `DomainEventContext`) |

**A domain event is not a socket payload.** The bus carries the minimum a
subscriber needs to decide what to do — ids and flags; the socket contract in
`@flowboard/shared` carries the hydrated entity the browser renders. Where a
field means the same thing on both sides it is **typed from** the shared schema
(`Pick<TaskMovedPayload, …>`, `SprintChangedPayload['action']`,
`NotificationType`) so a contract change is a compile error in the bridge rather
than a payload that quietly stops matching. Internal-only fields (`actorId`,
`originSocketId`, `changedFields`, `mentionedUserIds`, `statusChanged`) never
cross the wire.

### 4.2 Publishers and subscribers

```ts
export function onDomainEvent<TName extends DomainEventName>(
  name: TName,
  handler: DomainEventHandler<TName>,
): Unsubscribe;

export function publishDomainEvent<TName extends DomainEventName>(
  name: TName,
  payload: DomainEventMap[TName],
): void;
```

Publishers are services: `tasks.service.ts` (`task.created`, `task.updated`,
`task.moved`, `task.deleted`), `comments.service.ts`, `sprints.service.ts`,
`workflow.service.ts`, and `notifications.service.ts` for
`notification.created`.

Two subscribers, both registered from `bootstrap()`:

- **`apps/api/src/sockets/realtime-bridge.ts`** (`registerRealtimeBridge`) —
  subscribes to all nine project events plus `notification.created`, hydrates,
  and emits. Idempotent by an explicit guard on its `unsubscribes` array: a
  second call with handlers still registered would double every broadcast, and a
  hot reload is exactly the situation that produces one.
  `unregisterRealtimeBridge()` exists for tests and clean shutdown.
- **`apps/api/src/services/notifications.bootstrap.ts`**
  (`registerNotificationSubscribers`) — subscribes `task.created`,
  `task.updated`, `task.moved`, `comment.created` and `sprint.changed`, and
  starts the due-soon timer sweep (the seventh trigger has no domain event
  behind it, because nothing _happens_ when a due date approaches).

**`publishDomainEvent` is synchronous and non-throwing by contract.** Handlers
run in registration order; a thrown error or a rejected promise is logged and
swallowed. A broken notification fan-out must never roll back a task move that
already committed. `notifications.bootstrap.ts` wraps each handler in its own
`void … .catch(log)` anyway, for a log line that names the trigger and the task
rather than just the event.

### 4.3 Why the indirection

Without the bus, adding realtime would mean editing every service to import
Socket.IO, and adding notifications would mean editing them again. With it, a
service publishes `task.moved` and is done. That is what made the parallel wave
plan possible, and it is what keeps `tasks.service.ts` free of any knowledge
that a browser exists.

## 5. Sockets: rooms and echo suppression

`apps/api/src/sockets/io.ts` owns identity and the server handle: the JWT
handshake gate, and the `user:{userId}` room every connection joins. The
handshake **re-checks `tokenVersion` and `isActive`** through the injected
`SocketUserResolver` — an HTTP request lives milliseconds, but a socket lives for
hours, so a revoked session must not keep streaming a project's updates until the
token happens to expire. With no resolver wired it **fails closed in production**
and allows-with-a-warning in dev/test. `apps/api/src/sockets/rooms.ts` owns the
only three things a connected socket can ask for — `project:join`,
`project:leave`, `presence:update` — every join membership-checked with the same
`resolveProjectRole` the HTTP guard uses, and every result acked.

**Echo suppression is the architectural contract that ties HTTP and sockets
together.** The browser sends its socket id in `X-Socket-Id` on every mutation;
`apps/api/src/middlewares/socket-id.ts` reads it into `res.locals.socketId`
(length-checked, because the header is untrusted input, and unusable values
become `null` rather than an exception); controllers copy it into the actor;
services put it on the domain event as `originSocketId`; and every project emit
in the bridge goes through one helper:

```ts
function projectTarget(projectId: string, originSocketId: string | null) {
  const io = tryGetIo();
  if (!io) return null;
  return io.to(projectRoom(projectId)).except(originSocketId ?? '');
}
```

The tab that caused the change already painted it twice — once optimistically on
drop, once from the HTTP response — and a third, later write is exactly what
makes a just-dragged card jump. `?? ''` is the no-origin case: the empty string
is a room nobody is in, so `except('')` excludes nobody. It is a helper rather
than an inline chain so there is exactly **one** place `except()` could be
forgotten and one place to read to verify it never is.

`notification.created` is the one event that goes to a `user:{id}` room and
suppresses no echo — the fan-out never writes a row for the actor, so a
notification a tab caused is by construction addressed to somebody else.

Full room map, event tables, presence protocol and ack codes:
[realtime.md](./realtime.md).

## 6. Data-flow walkthroughs

### 6.1 What happens when you drag a card

**On the client** (`apps/web/src/hooks/useTaskMutations.ts` +
`apps/web/src/lib/board-cache.ts`):

1. **Drop.** The board hands `useMoveTask`'s `move()` a `BoardMoveIntent` — which
   card, which column it left, which column it landed in, at what index. Nothing
   about ranks: the board does not do fractional-index arithmetic.
2. **Plan.** `planBoardMove(board, intent)` reads the current board cache, lifts
   the card out of the target column **before** reading neighbours (for a
   same-column reorder that is the difference between a valid rank and
   `rankBetween(x, x)`, which throws), and derives `beforeTaskId` /
   `afterTaskId` plus a `clientRank` from `@flowboard/shared`'s `rankBetween`.
   The plan is the mutation's **variables**, so `onMutate` and the request see
   the same numbers. Computing it inside `onMutate` would not work: `mutationFn`
   only ever receives the variables, never the context `onMutate` returned.
3. **`onMutate`.** `cancelQueries` on the board key first — a refetch resolving
   mid-drag would overwrite the splice with pre-move data — then snapshot, then
   `applyBoardMove`, which removes the card from **every** column (a socket event
   may have moved it since) and re-inserts it by rank, not by index. Ordering by
   rank is what keeps the optimistic cache in agreement with what the next fetch
   returns.
4. **Request.** `POST /tasks/:taskId/move` with
   `{ statusId, beforeTaskId, afterTaskId, clientRank }`, parsed on return
   against `moveTaskResponseSchema`.

**On the server** (`apps/api/src/services/tasks.service.ts` → `moveTask`,
inside `withTx`):

5. `requireTaskRow`, `loadStatuses`, then `validateStatusChange` from
   `apps/api/src/services/task-move.service.ts` — the shared rule set for
   **every** status change, drag or field edit alike: the status must belong to
   this project (400), the transition must be allowed (409
   `transition_not_allowed`; **zero rows from a source status means every target
   is allowed**), and the target column's WIP ceiling must have room (409
   `wip_limit_exceeded`, with the moving task excluded and a same-column reorder
   exempt).
6. `computeRank` (`apps/api/src/utils/rank-rebalance.ts`) **re-reads the
   neighbours' current ranks inside the transaction** and generates the key from
   what it finds. That is the whole point: two people dropping into the same gap
   at the same moment cannot produce the same string, because the second reads
   the first's committed row. `clientRank` is honoured **only** for an append
   with no neighbours, and only when it still sorts past the current tail — which
   turns "drop at the end" into a no-op re-render instead of a visible snap.
7. `resolutionFor(from.category, target.category, current.resolvedAt)` decides
   the `resolved_at` stamp, keyed off the status **category**, never its name — a
   project is free to call its done column "Shipped".
8. `UPDATE tasks`. If the computed key crossed `NEEDS_REBALANCE_LENGTH` (60),
   `rebalanceBucket` rewrites every rank in that column in one
   `UPDATE … FROM (VALUES …)` statement, in the same transaction, and the
   response carries `rebalanced: true`.
9. `recordActivity` in the same `Tx` — `task.status_changed` or `task.ranked`.

**After the commit:** `record('task_moved', …)` (plus `task_completed` on the
todo/in-progress → done edge), then
`publishDomainEvent('task.moved', { …, originSocketId, statusChanged })`. The
response is `{ task, rebalanced }`.

**Back out to other clients:** the bridge's `task.moved` handler is the only one
that needs **no read** — the bus payload is `Pick`ed from `TaskMovedPayload`
precisely so the most latency-sensitive event in the product broadcasts straight
through. `taskMovedPayloadSchema.parse()` strips `actorId` and `statusChanged`,
and `projectTarget` excludes the origin socket. Other tabs receive
`task:moved`, `apps/web/src/hooks/useRealtime.ts` re-parses it, and
`apps/web/src/lib/realtime-cache.ts` splices their board cache directly.

**Back on the actor's tab:** `onError` restores the exact snapshot (`undefined`
is a legitimate snapshot — the board had not loaded — and writing it back is
still correct) and raises a localized toast. `onSuccess` writes the
authoritative task; when `rebalanced` is true it **invalidates
`qk.tasks.all(projectId)` instead of splicing**, because every other cached rank
in that column is now stale and a splice would order the board by numbers that no
longer exist.

### 6.2 What happens on login

1. `LoginPage` submits through RHF + `zodResolver(loginInputSchema)`.
2. `POST /api/auth/login` → `publicAuthLimit` (10/min per IP; bypassed under
   `NODE_ENV=test`) → `validate(loginInputSchema, 'body')` →
   `authController.login` → `authService.login`, which calls the auth provider's
   `verifyCredentials` and throws `ApiError.invalidCredentials()` on a miss —
   a 401 with its own code so the form can say something specific, and one
   message for both halves so it is not an account directory.
   `record('auth_login', …)` fires, and the response is a `LoginResponse`:
   the access/refresh pair plus the user summary.
3. `apps/web/src/stores/useAuthStore.ts` persists the whole thing verbatim under
   `fb-auth-v1`. The store is deliberately **dumb** — no fetching, no refresh
   logic, no navigation — which keeps the dependency arrow one-way:
   `lib/api.ts` imports the store, the store imports nothing of the app.
4. Every subsequent request attaches `Authorization: Bearer <accessToken>` in
   `apps/web/src/lib/api.ts`; `requireAuth` verifies the signature with no
   database cost, and the role guards in
   `apps/api/src/middlewares/require-roles.ts` re-check `tokenVersion` and
   `isActive` because they already pay for a round trip.
5. `RequireAuth` (`apps/web/src/routes/guards.tsx`) makes **two** checks, not
   one: a token in localStorage proves only that someone signed in on this device
   once, so the guard also validates with `GET /auth/me` and treats a 401/403 as
   terminal. The single-flight refresh handles "expired while working"; this
   guard handles "expired while away". A deep link survives the detour via
   navigation state.
6. `useRealtime` connects the socket with the same access token; the handshake
   re-resolves the user and joins `user:{id}`.

Full token model, `tokenVersion` semantics, invites and the role matrix:
[auth.md](./auth.md).

## 7. Frontend architecture

### 7.1 Boot order (`apps/web/src/main.tsx`)

The order **is** the file:

1. `import '@/index.css'`, then a **side-effect import of
   `@/stores/useThemeStore`**. That module reads the persisted document at module
   scope and calls `applyTheme()` on the way in, so every token and the `dark`
   class are on `<html>` before React exists. It sits above every component
   import because import order is evaluation order.
2. `initLangPolicy()` — stamps `<html lang|dir>` from the persisted preference,
   synchronously, so an Arabic session is already right-to-left while everything
   below still loads.
3. `initFaviconUpdater()` — paints `<head>` from the theme step 1 applied, then
   subscribes for the life of the tab. It runs here rather than at the theme
   module's scope so importing a module never mutates the document.
4. `await initI18n(getLangPref())` — **the only reason `bootstrap` is async**.
   The Arabic catalog is a dynamic import, and rendering before it resolves would
   paint an English frame and swap every string on screen. A failed load is
   caught and swallowed: English is bundled and is the `fallbackLng`, and a blank
   page is never the right answer.
5. `createRoot(...).render(<StrictMode><AppProviders><RouterProvider/></AppProviders></StrictMode>)`.

### 7.2 Providers (`apps/web/src/AppProviders.tsx`)

Outermost first, and the order matters:

1. **`QueryClientProvider`** (`@/lib/query-client`) — outermost so anything below
   can reach the client.
2. **`Direction.Provider`** — _not_ redundant with `<html dir>`. Radix primitives
   read direction from **this context**, not from the DOM, and default to `ltr`
   with no provider. Without it an Arabic session gets a mirrored layout whose
   dropdowns and sliders still arrow-key the English way. It reads `useLang()`,
   the same policy that stamped `<html dir>`, so DOM and context cannot disagree.
   `Direction` comes off the unified `radix-ui` package.
3. **`TooltipProvider`** — mounted once so the shared skip-delay grace window
   works across a toolbar.

`<PaletteMount/>` (command palette, `?` cheat sheet, `c` quick-create, the single
global keydown listener) is mounted **after** `{children}`, and is therefore a
**sibling of the router, not a child** — `main.tsx` renders
`<AppProviders><RouterProvider/></AppProviders>`, so it cannot call
`useNavigate()`; it reads the location off the router object and takes navigation
as a prop.

The React Query devtools are `import.meta.env.DEV ? lazy(() => import(…)) : null`
**at module scope in that exact shape**. Vite replaces `import.meta.env.DEV` with
the literal `false` in a production build, so Rollup drops the `lazy()` call and
the `import()` inside it. The obvious alternative — a module-scope `lazy()`
rendered behind a `dev ? … : null` — leaves the dynamic import in the module
graph and ships a ~230 KB chunk production never loads.

### 7.3 The router (`apps/web/src/routes/index.tsx`)

- **Every page is `React.lazy`**, so a first visit downloads the shell and one
  view. Pages inside `AppShell` resolve inside its Suspense boundary (the sidebar
  and topbar do not blink on navigation); routes outside the shell — `/login`,
  `/invite/:token` — carry their own full-page boundary via `standalone()`.
- **Guards are route ELEMENTS, not wrappers**: `<PublicOnly/>`, `<RequireAuth/>`,
  `<RequireGlobalAdmin/>` from `apps/web/src/routes/guards.tsx`. The protected
  subtree is declared once, so a new page cannot forget to opt in. The decision
  logic itself lives in `apps/web/src/routes/auth-gate.ts` as pure functions.
- **`errorElement: <RouteErrorScreen/>` on every top-level route object and on
  the `AppShell` layout route.** React Router walks up to the nearest ancestor
  with one, so covering these branches means no thrown route error reaches the
  framework's default page.
- `/invite/:token` is guard-free on purpose — outside `RequireAuth` (a signed-out
  stranger is the primary audience) **and** outside `PublicOnly` (a signed-in
  user must still be able to redeem one).
- **The task sheet is a route-layered overlay.** `taskSheetRoute()` returns
  `{ path: 't/:taskKey', element: <TaskSheetPage/> }` and is added as a **child**
  of each of the six project views. `/…/board/t/FB-142` therefore renders the
  board **and** the sheet over it: the parent stays mounted (no refetch, no
  scroll loss) and closing the sheet is a history `back()`. Each view gets its
  own object rather than a shared instance, because React Router route objects
  are positional.
- `apps/web/src/lib/chunk-recovery.ts` is side-effect imported here so its
  `vite:preloadError` listener exists before any lazy page can be requested.

### 7.4 Server state vs UI state

**TanStack Query v5 owns server state. Zustand 5 owns UI state only. Never cache
server data in Zustand.**

| Concern                                                                                               | Owner                                                                |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Tasks, boards, backlogs, sprints, comments, reports, notifications                                    | TanStack Query, keyed by `apps/web/src/lib/query-keys.ts`            |
| Optimistic drag, cache splices, socket-driven patches                                                 | TanStack Query, via `lib/board-cache.ts` and `lib/realtime-cache.ts` |
| Session (`useAuthStore`), theme (`useThemeStore`), layout (`useLayoutStore`)                          | Zustand, persisted                                                   |
| Board filters (`useBoardFilterStore`)                                                                 | Zustand, persisted per project                                       |
| Palette (`usePaletteStore`), presence (`usePresenceStore`), diagnostics log tail (`useDiagLogsStore`) | Zustand, **not** persisted                                           |

`usePresenceStore` and `useDiagLogsStore` deliberately have no `fb-*-v1` key:
a rehydrated roster would paint people who left hours ago, and admin-only log
lines have no business on disk.

### 7.5 `apps/web/src/lib/api.ts` — the single HTTP chokepoint

Four responsibilities, and it is the only module that knows about any of them:

1. **Envelope unwrap.** Callers get `data` on success and an `ApiError` throw on
   failure, so a data hook never writes `if (!res.success)`.
2. **Optional zod parse.** `api.get(path, { schema })` validates the payload at
   the boundary.
3. **`X-Socket-Id` on mutations only** — a GET produces no broadcast to suppress.
   The id comes from a **provider function** registered with
   `setSocketIdProvider(() => socket.id ?? null)`, not a value, because the id
   changes on every reconnect.
4. **Single-flight refresh.** A board page fires six queries in parallel; if the
   access token has just expired, all six 401 within milliseconds. The API
   **rotates** the refresh token, so six independent `POST /auth/refresh` calls
   means the first invalidates the token the other five hold and five of six log
   the user out. `refreshInFlight ??= performRefresh().finally(…)` funnels them
   into one rotation and six retries. The retry is gated on **both** `status ===
401` and `error.code === TOKEN_EXPIRED_CODE`, so an unrelated 401 (revoked
   `tokenVersion`, disabled account) fails fast instead of burning the refresh
   token on a request that can never succeed.

Two smaller invariants worth knowing: an `AbortError` is re-thrown as itself
rather than wrapped in an `ApiError` (TanStack Query keys its cancellation
handling on that), and a 204/205 with no body returns `{ data: undefined }`
rather than tripping the success gate.

### 7.6 `apps/web/src/lib/query-keys.ts` — the hierarchical tuple factory

TanStack Query matches keys **by prefix**, and FlowBoard leans on that
everywhere: a socket `task:updated` invalidates `qk.project.all(projectId)` and
every board, backlog, table and report query under it refetches, without the
realtime layer knowing any of them exist. That only works if the prefixes are
genuinely hierarchical and spelled identically at every call site — which a
factory guarantees and a hand-written `['tasks', id]` does not.

Three properties are load-bearing:

- **Every level exposes an `all`** plus the concrete keys beneath it, so both
  `invalidateQueries({ queryKey: qk.task.all(id) })` and
  `setQueryData(qk.task.detail(id), …)` work at any depth.
- **`as const` on every return** makes the keys readonly tuples rather than
  `string[]`, so `setQueryData` infers the right payload type.
- **Filters are a stable string, never an object.** Keys compare structurally, and
  `{a:1,b:2}` and `{b:2,a:1}` hash differently — two cache entries for one screen.
  `filtersKey()` sorts, drops empties and sorts array members (lossy, correct for
  a filter bar); `stableKey()` is the lossless general form for anything where
  order and `null` are real distinctions.

Two placement decisions to respect: `qk.task.*` is **top-level** (`['task', id]`)
because the task sheet is deep-linkable by key and must be addressable before the
project id is known, while `qk.project.dependencies` sits under `project` rather
than `tasks` so a drag-induced `qk.tasks.all()` invalidation does not refetch a
set a rank change cannot have altered.

## 8. Critical files

| File                                        | Why it matters                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| `packages/shared/src/index.ts`              | The contract barrel every package codes against.                              |
| `packages/shared/src/envelope.ts`           | The one response shape; `ok`, `fail`, `envelopeSchema`.                       |
| `packages/shared/src/rank.ts`               | Fractional indexing: `rankBetween`, `initialRanks`, `NEEDS_REBALANCE_LENGTH`. |
| `apps/api/src/app.ts`                       | Normative middleware order; builds an app with no port and no database.       |
| `apps/api/src/bootstrap.ts`                 | The only place the four injected persistence sinks are wired.                 |
| `apps/api/src/middlewares/validate.ts`      | `validate()` + `getParsed()` — the layer's key idiom.                         |
| `apps/api/src/middlewares/error-handler.ts` | The only error-envelope formatter in the codebase.                            |
| `apps/api/src/db/schema/tasks.ts`           | Dual fractional-rank columns + the key indexes.                               |
| `apps/api/src/utils/domain-events.ts`       | Decouples services from realtime + notifications.                             |
| `apps/api/src/utils/rank-rebalance.ts`      | Authoritative rank computation + the in-transaction rebalance.                |
| `apps/api/src/sockets/realtime-bridge.ts`   | Domain events → hydrated socket emits, with echo suppression in one helper.   |
| `apps/api/src/sockets/socket-reads.ts`      | The socket layer's read path — documented layering exception #1.              |
| `apps/web/src/main.tsx`                     | The boot order: dir/lang, theme, favicon, awaited i18n, render.               |
| `apps/web/src/lib/query-keys.ts`            | The key factory optimistic DnD and socket sync depend on.                     |
| `apps/web/src/lib/api.ts`                   | Envelope unwrap + zod parse + `X-Socket-Id` + single-flight refresh.          |
| `apps/web/src/lib/board-cache.ts`           | The board's cache algebra, as pure functions.                                 |

## Related docs

- [coding-standards.md](./coding-standards.md) — naming, the lint gates, zod, transactions, storage keys.
- [database.md](./database.md) — the Drizzle schema, soft deletes, migrations, the seed.
- [auth.md](./auth.md) — the token model, `tokenVersion`, invites, the role matrix.
- [realtime.md](./realtime.md) — the full room map, event tables and presence protocol.
- [telemetry.md](./telemetry.md) · [diagnostics.md](./diagnostics.md) — the observability pair.
- [i18n.md](./i18n.md) · [design-system.md](./design-system.md) — the presentation layer.
- [testing.md](./testing.md) — the test pyramid and what each layer owns.

Back to [docs/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
