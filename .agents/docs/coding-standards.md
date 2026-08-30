# Coding Standards

The conventions that apply across every FlowBoard workspace: naming, the lint and
`tsc` gates that are actually enforced, where zod sits on each boundary, the
CommonJS rules `apps/api` lives under, what every mutation owes the audit stream,
the test mechanics, the storage-key registry, and formatting. Read this before
writing code, and re-read §2 and §5 before touching a service.

## 1. Naming

### 1.1 Files

| Kind                   | Convention                         | Real example                                                            |
| ---------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| React component        | `PascalCase.tsx`                   | `apps/web/src/components/board/BoardColumn.tsx`                         |
| Hook                   | `useThing.ts`                      | `apps/web/src/hooks/useTaskMutations.ts`                                |
| Zustand store          | `useThingStore.ts`                 | `apps/web/src/stores/useBoardFilterStore.ts`                            |
| Everything else        | `kebab-case.ts`                    | `apps/web/src/lib/query-keys.ts`, `apps/web/src/lib/board-cache.ts`     |
| API domain files       | the quartet (§1.3)                 | `tasks.routes.ts` / `.controller.ts` / `.service.ts` / `.validation.ts` |
| Shared contract module | `thing.schema.ts`                  | `packages/shared/src/tasks.schema.ts`                                   |
| Drizzle schema module  | `kebab-case.ts` under `db/schema/` | `apps/api/src/db/schema/workflow.ts`                                    |
| Test                   | colocated `*.test.ts(x)`           | `packages/shared/src/rank.test.ts`, `apps/web/src/lib/api.test.ts`      |

**Colocated tests are the default; the one sanctioned exception is
`apps/api/src/routes/__tests__/`.** Route suites are Supertest integration tests
that share fixtures (`fixtures.ts`, `task-domain.fixtures.ts`,
`identity-test-app.ts`), and `apps/api/tsconfig.json` excludes both
`src/**/*.test.ts` and `src/**/__tests__/**` from the emitted build. A helper
that is not itself a suite belongs in that directory too, not beside production
code.

### 1.2 Identifiers and wire names

| Kind                          | Convention                                                 | Example                                               |
| ----------------------------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| Variables, functions          | `camelCase`                                                | `computeRank`, `getParsed`                            |
| Types, interfaces, components | `PascalCase`                                               | `BoardMovePlan`, `ApiError`                           |
| Module constants              | `SCREAMING_SNAKE_CASE`                                     | `NEEDS_REBALANCE_LENGTH`, `PRESENCE_THROTTLE_MS`      |
| Zod schema + inferred type    | `thingSchema` + `export type Thing = z.infer<…>`           | `taskSchema`, `type Task`                             |
| Validation-copy constants     | `VM_*`                                                     | `VM_TITLE_REQUIRED` (§3.5)                            |
| Socket event                  | `scope:verb`                                               | `task:moved`, `project:join`, `presence:update`       |
| Socket room                   | `scope:{id}`, built by a shared helper                     | `projectRoom(id)`, `userRoom(id)`                     |
| Socket ack code               | `SCREAMING_SNAKE`                                          | `BAD_REQUEST`, `FORBIDDEN`, `NOT_FOUND`, `INTERNAL`   |
| HTTP error `code`             | `lower_snake_case`                                         | `not_found`, `validation_error`, `wip_limit_exceeded` |
| REST path                     | plural nouns                                               | `/api/projects/:projectId/tasks`                      |
| DB table                      | `snake_case` plural                                        | `task_labels`, `telemetry_events`, `request_logs`     |
| DB column                     | `snake_case` in Postgres, `camelCase` in the Drizzle model | `board_rank` ↔ `boardRank`                            |
| Web Storage key               | `fb-<name>-v1`                                             | `fb-board-filters-v1` (§7)                            |

Prefer clear words to abbreviations. No `data2`, no `tmp`, no single-letter names
outside loop indices.

### 1.3 The API quartet

One domain is four files, and each has exactly one job:

```text
routes/tasks.routes.ts        path + guard chain + validate() ordering. No logic.
controllers/tasks.controller.ts   getParsed → service → respond. No db, no rules.
services/tasks.service.ts     rules, transactions, activity + telemetry + events.
validation/tasks.validation.ts    route-param schemas; re-exports the shared contracts.
```

`validation/*.validation.ts` should be **thin**. The body and query schemas live
in `@flowboard/shared` and are re-exported so the router has one import site;
what stays local is what only the server knows — the route-parameter shapes.
See [architecture.md](./architecture.md) §2.5.

## 2. TypeScript strictness and the lint gates

Enforcement is split on purpose: `packages/config/tsconfig.base.json` is the type
gate, `packages/config/eslint.config.mjs` is the lint gate, and they run as two
independent turbo tasks (`typecheck`, `lint`).

### 2.1 No `any`

**`@typescript-eslint/no-explicit-any` is `error` in the base config, and there
is no approved escape hatch.** `any` disables the type system exactly at the
boundaries where FlowBoard's bugs are cheapest to catch. Use `unknown` plus a zod
parse, or a real generic. If you think you need one, the contract in
`@flowboard/shared` is wrong.

The codebase demonstrates the alternatives rather than reaching for the hatch:

- `apps/api/src/utils/domain-events.ts` stores heterogeneous handlers as
  `type StoredHandler = (payload: never) => void | Promise<void>`. Parameters are
  contravariant, so every concrete `DomainEventHandler<K>` is assignable to it
  while nothing can be _called_ through it by accident. That is why the bus is
  not built on Node's `EventEmitter`, whose `(...args: any[])` signature erases
  the payload type at the boundary.
- `apps/api/src/services/pg-errors.ts` narrows driver errors through a local
  `interface PgErrorShape { code?: unknown; constraint_name?: unknown }` and
  walks the `cause` chain structurally, never with `instanceof` and never with a
  cast to `any`.

### 2.2 `noUncheckedIndexedAccess`

On in `tsconfig.base.json`, alongside `strict`, `noUnusedLocals`,
`noUnusedParameters`, `noFallthroughCasesInSwitch` and `forceConsistentCasingInFileNames`.

**Indexing yields `T | undefined`, so narrow it — do not assert it away with
`!`.** FlowBoard is full of ordered lists (board columns, fractional ranks,
sprint rows) and this is the option that makes `tasks[0].title` a compile error
instead of a production crash. The shipped idiom is an explicit check that
throws or falls back:

```ts
const ranks = initialRanks(rows.length);
const pairs = rows.map((row, index) => {
  const rank = ranks[index];
  if (rank === undefined) throw ApiError.internal('Rebalance produced too few ranks');
  return { id: row.id, rank };
});
```

Drizzle's `const [row] = await …` destructuring produces the same
`T | undefined`, which is why every service reads `if (!row) …` or
`row?.value ?? 0`.

### 2.3 `verbatimModuleSyntax` — and the one place it is off

`tsconfig.base.json` sets `verbatimModuleSyntax: true` and `isolatedModules:
true`: **type-only imports must say `import type`**, because otherwise a bundler
cannot always tell whether an import has a runtime side effect and erasing it can
silently drop a module that registers something.

**`packages/config/tsconfig.node.json` turns it back off
(`verbatimModuleSyntax: false`).** NodeNext + CommonJS emit cannot honour it for
the interop forms Express and its type packages need. It therefore does **not**
apply to `apps/api` — but write `import type` there anyway; the codebase does,
and `apps/api/src/sockets/rooms.ts` depends on it for correctness: its import of
`FlowBoardServer`/`FlowBoardSocket` from `io.ts` is type-only precisely so the
edge is erased at compile time and does not close a runtime `require()` cycle.

The three tsconfigs:

| File                                  | Extends | Key differences                                                                                           |
| ------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `packages/config/tsconfig.base.json`  | —       | `ESNext`/`Bundler`, `verbatimModuleSyntax`, full strictness, `types: []`, `noEmit: true`.                 |
| `packages/config/tsconfig.node.json`  | base    | `module`/`moduleResolution: NodeNext`, `verbatimModuleSyntax: false`, `types: ["node"]`, `noEmit: false`. |
| `packages/config/tsconfig.react.json` | base    | `lib: [ES2022, DOM, DOM.Iterable]`, `jsx: react-jsx`.                                                     |

`types: []` in the base is deliberate: **ambient type packages are opt-in per
workspace**, so a package that does not declare `"types": ["node"]` cannot
accidentally use Node globals. `apps/web/tsconfig.json` deliberately sets no
`baseUrl` (deprecated, removed in TS 7); `paths` resolves relative to the config
file and mirrors the Vite `resolve.alias` entry — **keep those two in sync**.

### 2.4 The lint config and its per-directory overrides

`packages/config/eslint.config.mjs` exports the base flat config plus two named
blocks that consumers spread. The base is **`recommended`, not
`recommended-type-checked`**, and the header says why: type-aware linting needs a
`projectService`, which then errors on every file outside a tsconfig `include`
(`vite.config.ts`, `playwright.config.ts`, `eslint.config.mjs` itself) and
roughly triples lint time — while `tsc --noEmit` already runs as its own turbo
task.

| Block / workspace                         | Adds                                                                                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| base (all workspaces)                     | `no-explicit-any: error`, `no-unused-vars: error` (with `^_` opt-outs), `no-console: error`, `eslint-config-prettier` **last**.                                                       |
| `sharedPackageConfig` → `packages/shared` | `no-restricted-globals` banning `window`, `document`, `navigator`, `localStorage`, `process`, `require`, `__dirname`.                                                                 |
| `reactHooksConfig` → `apps/web`           | `react-hooks/rules-of-hooks: error`, `react-hooks/exhaustive-deps: **warn**`.                                                                                                         |
| `apps/web` extra block                    | `no-restricted-globals` on `process`/`require`/`__dirname` for `src/**` — **excluding** `src/**/*.test.*` and `src/test/**`. Node globals are re-enabled for root-level config files. |
| `apps/api`, `e2e`                         | `globals.node`.                                                                                                                                                                       |

**`exhaustive-deps` is a warning on purpose.** It is a very good heuristic and
not a proof — a `useRef`, a Zustand selector, a query client are all legitimately
omitted. As an error it would push people toward blanket disables, turning off
the useful 95% with the noisy 5%. **Read every warning, and suppress the
individual line with a comment saying why**, as `useMoveTask` does:

```ts
// eslint-disable-next-line react-hooks/exhaustive-deps -- see above.
[queryClient, mutate, boardKeySignature],
```

`@typescript-eslint/no-unused-vars` allows a leading underscore in
`argsIgnorePattern`, `varsIgnorePattern` and `caughtErrorsIgnorePattern` — the
documented opt-out for genuinely unused Express `_req`/`_next` positions.

**`eslint-config-prettier` is spread last and must stay there** so it can switch
off every stylistic rule the sets above turn on. Prettier owns formatting (§8).

### 2.5 `no-console` and its sanctioned opt-outs

**`no-console` is `error`.** Server logs go through pino (`apps/api/src/utils/logger.ts`)
so they reach the diagnostics ring buffer; client feedback goes through sonner.
A stray `console.log` is either a leaked debug statement or a log line the
diagnostics drawer will never show.

There are exactly four opt-out sites in the repo, each with a per-line reason:

| Site                                        | Reason                                                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/config/env.ts:48`             | Boot-time env-validation failure must reach the operator before pino exists.                                            |
| `apps/api/src/scripts/script-logger.ts:1`   | File-level disable: CLI scripts (`db:migrate`, `db:seed`, `db:reset`) write to stdout by design.                        |
| `apps/web/src/hooks/useRealtime.ts:113,209` | The web bundle has no logger; a dropped malformed socket payload is exactly what the browser console exists to surface. |
| `e2e/tests/wave3-*.spec.ts`                 | Those specs exist to be read as a narrated run.                                                                         |

Use the same form — `// eslint-disable-next-line no-console -- <reason>` — and
nothing else.

### 2.6 The open question at `packages/config/eslint.config.mjs:96`

That file carries one live `TODO` comment, immediately after the note explaining
why the base config is the type-**unaware** `recommended` set. It proposes
re-evaluating whether `apps/api/src/services/**` alone should opt in to
`recommended-type-checked`, for the floating-promise rules.

**Treat it as an open question, not a settled decision.** The trade-off is real
and unresolved: the service layer is the one place where a forgotten `await`
matters most (a fire-and-forget write inside a transaction that has already
returned), and `no-floating-promises` only exists in the type-checked set. Nobody
has yet measured whether scoping a `projectService` to `apps/api/src/services/**`
alone avoids the "file outside `include`" errors and the lint-time cost that
kept the base type-unaware. Until someone does, the codebase compensates by
convention: every deliberate fire-and-forget is written `void fn().catch(log)`
(see `apps/api/src/services/notifications.bootstrap.ts` and
`apps/api/src/sockets/realtime-bridge.ts`), which is greppable in a way a
forgotten `await` is not. **Do not edit that comment as part of unrelated work.**

## 3. Zod at every boundary, both ends

`@flowboard/shared` is the single source of schemas. Never hand-write a duplicate
shape on one side of a boundary; import the schema.

### 3.1 Inbound (API requests)

`validate(schema, part)` from `apps/api/src/middlewares/validate.ts` parses
`body` / `query` / `params` **before** the controller runs, and forwards the
`ZodError` so the single `errorHandler` renders a 422 with per-field
`{ path, code, message }` details. Read the parsed value back with the typed
accessor, never off `req`:

```ts
const { taskId } = getParsed<TaskParams>(res, 'params');
const input = getParsed<MoveTaskInput>(res);
```

**Validate params before the role guard.** A malformed uuid must be a 422 at the
boundary rather than reaching the guard's `WHERE id = 'not-a-uuid'` and surfacing
as a 500. `apps/api/src/routes/tasks.routes.ts` states the order as normative.

### 3.2 Outbound (API responses)

Responses are built from the same shared schemas and sent through
`respond(res, data, meta?, status?)`. **Socket payloads are parsed before they
are emitted, in every environment** — `apps/api/src/sockets/realtime-bridge.ts`
does `taskMovedPayloadSchema.parse({ … })` on the way out. The cost is one parse
of an object you just built; the benefit is that a hydration bug surfaces as a
logged, dropped emit instead of a client-side parse failure that leaves a board
half-patched, **and** that `parse()` strips internal fields (`actorId`,
`statusChanged`) the spread would otherwise leak to a browser.

### 3.3 The web client

`apps/web/src/lib/api.ts` is the only place a response is unwrapped, and the
`schema` option is the parse:

```ts
api.post<MoveTaskResponse>(`/tasks/${plan.taskId}/move`, body, {
  schema: moveTaskResponseSchema,
});
```

Incoming socket events are parsed too — `apps/web/src/hooks/useRealtime.ts`
runs `serverToClientEventSchemas[name].safeParse(raw)` and drops what does not
match, because a mismatched deploy (an old tab left open across a release) is
precisely the case where the two ends disagree.

One documented exception: `performRefresh()` in `lib/api.ts` hand-checks the
token pair with `typeof` instead of a schema, because it runs during error
recovery and a schema import failing there would be the second failure in a row.

### 3.4 Forms

React Hook Form + `@hookform/resolvers`' `zodResolver` over **the same shared
schema the endpoint validates with**. That is what makes a contract change a
compile error on both ends of one commit rather than a form that submits a body
the API refuses.

### 3.5 The validation-message constants

`packages/shared/src/validation-messages.ts` holds every user-facing English
string a schema attaches to a check, as `VM_*` constants plus a
`VALIDATION_MESSAGES` object and two derived types (`ValidationMessageKey`,
`ValidationMessage`).

**Never inline validation copy in a schema.** These strings surface verbatim in
two very different places — an RHF field error and an API `422`'s
`error.details` — and the web localizes the first.
`apps/web/src/i18n/validation.ts` exports
`VALIDATION_MESSAGE_KEYS: Record<ValidationMessage, ValidationKey>`, keyed by the
exact English text — so adding a message without a translation key is a
**compile error**, not English leaking into an Arabic UI.

**The English text IS the wire contract.** `apps/api`'s 422 bodies and the shared
contract tests assert these exact strings, so editing the copy is a deliberate
act, not a typo fix. The reason it is English on the wire — and not a message
key the client resolves — is covered in [i18n.md](./i18n.md); do not re-derive it
here.

### 3.6 Shared chrome reads the catalog in one module

A component family that is **shared chrome** — rendered by several surfaces and
owned by none — must not call `t()` from its parts. The shipped example is
`apps/web/src/components/dashboard/chrome-copy.ts`: two hooks return every
string the generic `DataTable` and `RangePicker` render, and no other file in
`components/dashboard/**` touches i18next. The returned shapes are the contract;
the keys behind them can move without editing a component.

Because the family has no namespace of its own, every string is **borrowed** —
and the module carries a **borrow table, split into KEPT and MINTED**, with a
reason per row. **Add a row when you add a borrow**, and mint into `common:grid.*`
rather than borrow when the source key names a different thing that merely reads
the same today. Full treatment in
[design-system.md](./design-system.md) §10.6.

## 4. CommonJS conventions in `apps/api`

`apps/api/package.json` declares `"type": "commonjs"` and
`apps/api/tsconfig.json` extends `@flowboard/config/tsconfig.node.json`, which
sets `module`/`moduleResolution: NodeNext` and `noEmit: false` (output to
`dist/`, `main: dist/server.js`). NodeNext makes TypeScript resolve and emit
exactly the way Node will at runtime, which is what keeps dual ESM/CJS
dependencies honest.

Consequences, all of them enforced by the build rather than by review:

- **Relative imports are extensionless** — `import { ApiError } from
'../utils/api-error'`. A `.js` suffix is an ESM convention and does not belong
  here.
- **An ESM-only dependency must be reached with a dynamic `import()`.** There is
  currently **no such call in `apps/api/src` production code** — the only
  `await import(...)` in the package is
  `apps/api/src/middlewares/error-handler.test.ts:114`, which re-imports its own
  module to reset state. The rule is live rather than theoretical because the
  project has already hit the case once and solved it a level down:
  `fractional-indexing` is ESM-only, so `packages/shared` bundles it into its CJS
  output (`noExternal` in its `tsup.config.ts`) and exposes `rankBetween` /
  `initialRanks` as ordinary exports. **Prefer that shape** — wrap the ESM-only
  dependency in `packages/shared` — over scattering `await import()` through the
  service layer, where it turns a synchronous helper into an async one.
- `@flowboard/shared` ships both builds (`dist/index.js` / `dist/index.cjs` via
  its `exports` map), which is why `require`ing it from the API and importing it
  from the Vite bundle both work.

## 5. Services: layering, transactions, and the mutation trio

### 5.1 Layering

`routes → controllers → services → db`, one direction only.

- **Never import Drizzle or `src/db` outside `services/` and `db/`.** A
  controller that queries directly cannot be reused inside a transaction, and in
  FlowBoard almost every mutation is a transaction.
- **No `req`/`res` below the controller.** Services take and return plain data
  and throw `ApiError`, which is what makes them callable from the socket bridge
  and from CLI scripts.
- The **three** documented exceptions are spelled out in
  [architecture.md](./architecture.md) §3.2–3.4. Do not add a fourth:

  | File                           | Why                                                                                                                                                                                  |
  | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `sockets/socket-reads.ts`      | Four `SELECT`s the socket bridge needs that no service answers. Reads only, `null` for not-found.                                                                                    |
  | `bootstrap.ts`                 | The composition root — it exists so four modules that must _not_ import `db` can still reach it.                                                                                     |
  | `middlewares/require-roles.ts` | The guards resolve resource→project→membership **before** the controller runs. Routing that through a service would put a service _above_ the middleware layer, inverting the stack. |

- **A controller with no service is a different deviation, and there is exactly
  one**: the `admin-logs` quartet reads an in-memory ring buffer, not a table —
  there is no transaction to join and no rule to hold, so a pass-through service
  file would only imply the logs are durable state. See
  [architecture.md](./architecture.md) §3.5, which also records the consequence:
  the ring is per-process, so behind multiple API instances the endpoint shows
  only the instance that served the request.

### 5.2 `withTx` — the canonical multi-write helper

`apps/api/src/db/client.ts`:

```ts
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
```

`Tx` is **derived from `db`** rather than hand-written, so it can never drift
from the schema generic. **Every mutation that writes more than one row goes
through `withTx`** — and in FlowBoard that is nearly all of them, because each
one also appends an activity row.

**Services that participate in a larger transaction take an optional executor**
so they compose. The shipped shape is a `Db | Tx` union with a `db` default:

```ts
type Executor = Db | Tx;
export async function loadStatuses(executor: Executor, projectId: string): Promise<StatusInfo[]>;
export async function recordActivity(entry: ActivityEntry, executor: Db | Tx = db): Promise<void>;
```

Helpers that only make sense **inside** a transaction take `tx: Tx` outright —
`rebalanceBucket(tx, bucket, movedTaskId?)` is the example, and its type is the
documentation.

### 5.3 The trio every mutation owes

Inside the transaction:

1. **The domain write itself.**
2. **`recordActivity(entry, tx)`** (`apps/api/src/services/activity.service.ts`)
   — the only way a row enters the audit stream. Passing the `Tx` is what makes
   history unable to disagree with state; a multi-field PATCH uses
   `recordActivities` for one INSERT.

After the commit:

3. **`record(type, payload, context)`**
   (`apps/api/src/services/telemetry.service.ts`) — fire-and-forget, returns
   `void`, never throws, and no-ops when no sink is wired.
4. **`publishDomainEvent(name, payload)`** — carrying `actorId` and
   `originSocketId` so the realtime layer can suppress the actor's echo.

`moveTask` in `apps/api/src/services/tasks.service.ts` is the reference
implementation of all four steps.

**Telemetry and domain events go outside the transaction on purpose.** A
notification fan-out or a missed broadcast must never roll back a task move, and
`publishDomainEvent` is synchronous and non-throwing by contract so it cannot.
The activity row is the opposite case and stays **inside**: a partial write that
left the audit stream lying is the failure this rule exists to prevent.

**Step 3 is conditional; steps 1, 2 and 4 are not.** The telemetry enum is a
deliberately small closed set (see [telemetry.md](./telemetry.md)) — it has no
`task_deleted`, no `project_created`, no `member_invited`, because "an event
nobody charts is just write amplification". So `labels.service.ts` writes its
activity row and publishes its domain event and records **no** telemetry, and
that is correct, not an omission. **Never widen the enum just to satisfy this
section**: if no existing type fits your mutation, the answer is usually that it
should not emit one. The activity row and the domain event, by contrast, are
owed by every mutation without exception.

### 5.4 Soft-delete discipline

`apps/api/src/db/columns.ts` exports three column factories — `timestamps()`,
`createdAt()`, `deletedAt()`. They are **factories, not shared objects**, so two
tables can never share builder state. Every timestamp is `timestamptz`
(`withTimezone: true, mode: 'date'`); **never `timestamp` without a zone**.

`deletedAt()` is applied only to **organizations, teams, projects, tasks,
comments and attachments**. **Every read path on those tables must filter
`isNull(table.deletedAt)`** — a missed filter is the classic FlowBoard bug, and
it is silent. The discipline shows up everywhere in the shipped code:
`bucketCondition()` in `rank-rebalance.ts` folds `isNull(tasks.deletedAt)` into
the bucket definition so soft-deleted rows can never take part in ordering;
`resolveProjectRef()` in `require-roles.ts` filters it on **every** joined table
so a task under an archived project is a 404, not a 403.

**Users are never deleted.** They are deactivated (`is_active = false` plus a
`token_version` bump), which is what revokes every live session — see
[auth.md](./auth.md).

### 5.5 `apps/api/src/services/pg-errors.ts`

Two predicates, `isUniqueViolation(error, constraintName?)` (`23505`) and
`isForeignKeyViolation(error)` (`23503`).

**Every uniqueness rule is also pre-checked with a `SELECT`** so the common path
produces a specific message ("that slug is taken"). These predicates cover only
the race the pre-check cannot: two requests that both read "free" before either
writes. Catching the constraint is what makes that a 409 rather than a 500.

**The `cause` chain is walked, and walked structurally.** Drizzle wraps whatever
the driver threw in a `DrizzleQueryError` and hangs the original off `cause`, so
the `postgres-js` error carrying `code` is one or more links down. Matching only
the top-level error silently stopped working when that wrapper was introduced,
and the symptom — a 500 where a 409 belongs — is invisible to the type checker.
Matching is `typeof`-based, never `instanceof`, so the driver's error class stays
out of the service layer.

## 6. Test conventions

This section is the **mechanics**. The pyramid — what belongs in a unit test, a
Supertest integration test or a Playwright spec — is [testing.md](./testing.md).

### 6.1 Environments, and the jsdom pragma

Both Vitest configs set `environment: 'node'`, and `apps/web` **keeps it that
way**. Most web suites cover pure logic — envelope unwrapping, the single-flight
refresh against a mocked `fetch`, the query-key factory, the board-cache reducer
— and booting jsdom for those would tax every suite with a startup it gets
nothing from.

**A suite that renders components opts in per file, with a pragma on the very
first line:**

```ts
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
```

35 files currently do. That is a Vitest feature, not a workaround, and it is
preferred over a second `projects` entry: the opt-in lives next to the code that
needs it, so nobody keeps a glob in sync with which files happen to render.
`apps/web/vitest.config.ts` also raises `testTimeout`/`hookTimeout` to 20 s —
read the header there before lowering it; **a timeout is a deadlock detector, not
a performance budget.**

### 6.2 Cleanup and DOM matchers are per-file, not global

`apps/web/vitest.config.ts` does **not** set `globals: true`, so Testing
Library's automatic cleanup never registers itself. **Every jsdom suite must call
`afterEach(cleanup)` itself**, and must import `@testing-library/jest-dom/vitest`
in the file that uses its matchers. The setup file deliberately does not import
jest-dom — that would load DOM matchers into the node-environment suites too.

### 6.3 `apps/web/src/test/setup.ts` — the Web Storage shim

The one global setup file, and its whole job is **Web Storage, not the DOM**. It
installs a real `Storage`-shaped `MemoryStorage` class onto
`globalThis.localStorage` / `sessionStorage` (with `??=`, so jsdom's own wins
where present) **before any module graph is loaded**, because `useAuthStore`,
`useLayoutStore`, `useBoardFilterStore` and `lib/lang-policy` all reach for
storage at import time and Node has none. A `beforeEach` clears both — persisted
stores are module singletons, so one suite's saved session would otherwise leak
into the next file's first read.

It is a real object rather than a `vi.fn()` mock on purpose: the code under test
only wants somewhere to put strings, and a spy everywhere would turn every
assertion about behaviour into an assertion about calls.

**The `ResizeObserver` stub is _not_ here — it is declared per test file.** jsdom
ships no `ResizeObserver`, and Radix's popper layer, dnd-kit's droppables and
Recharts' containers all measure through one. Suites that need it define a local
no-op class and install it defensively:

```ts
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
```

Keeping it local means the node-environment suites never pay for it, and a file
that stops rendering stops carrying it.

### 6.4 `fileParallelism` and the API test database

**`apps/api/vitest.config.ts` sets `fileParallelism: false`.** The integration
suites share one live `flowboard_test` database and truncate between suites, so
parallel test files would race each other's fixtures. The same config supplies
every variable `apps/api/src/config/env.ts` fails fast on (`DATABASE_URL` on port
**5433**, the JWT secrets, the `S3_*` block, `WEB_ORIGIN`, `LOG_LEVEL: fatal`),
so the suite runs from a cold clone with no `.env` — the alternative is a test
result that depends on a git-ignored file.

`apps/web/vitest.config.ts` sets no `fileParallelism`, i.e. it keeps the
default: web suites are hermetic (the storage shim is per-file, the stores
re-baseline in `beforeEach`) and gain nothing from serialising.

`apps/api/src/test/test-db.ts` is the integration harness. The usage contract is
in its header and is the one to copy:

```ts
beforeAll(async () => {
  await ensureTestDb();
});
beforeEach(async () => {
  await truncateAllTables();
});
afterAll(async () => {
  await closeDb();
});
```

`ensureTestDb()` creates the database if missing (connecting to `postgres` as the
maintenance DB) and runs the drizzle migrations, **memoized per process**.
`truncateAllTables()` issues one `TRUNCATE … RESTART IDENTITY CASCADE` over every
`public` table except the `__drizzle*` journal. **Always `closeDb()` in
`afterAll`** — an open pool hangs the run.

## 7. The storage-key registry

Every persisted browser key is `fb-<name>-v1`, is exported as a named constant
from its owner module, and is listed here. **Add a row when you add a key.**
Bump the suffix only for a shape change a `migrate` cannot absorb.

| Key                      | Storage            | Owner                                                 | Exported constant          | Holds                                                                                                                                                                                              |
| ------------------------ | ------------------ | ----------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fb-auth-v1`             | localStorage       | `apps/web/src/stores/useAuthStore.ts`                 | `AUTH_STORAGE_KEY`         | `{ accessToken, refreshToken, user }` — byte-for-byte what `POST /auth/login` returned.                                                                                                            |
| `fb-theme-v1`            | localStorage       | `apps/web/src/components/theme/theme-storage.ts`      | `THEME_STORAGE_KEY`        | The Theme Studio `ThemeDocument`. Every read is zod-validated.                                                                                                                                     |
| `fb-dark-v1`             | localStorage       | `apps/web/src/components/theme/theme-storage.ts`      | `DARK_STORAGE_KEY`         | `'1'`/`'0'` dark-mode preference — separate from the document, so switching preset does not reset the mode.                                                                                        |
| `fb-lang-v1`             | localStorage       | `apps/web/src/lib/lang-policy.ts`                     | `LANG_STORAGE_KEY`         | The `en`/`ar` preference, read before first paint to stamp `<html lang\|dir>`.                                                                                                                     |
| `fb-layout-v1`           | localStorage       | `apps/web/src/stores/useLayoutStore.ts`               | `LAYOUT_STORAGE_KEY`       | `sidebarCollapsed`, `diagDock`, `diagHeight`, `diagWidth`. Versioned — see below.                                                                                                                  |
| `fb-board-filters-v1`    | localStorage       | `apps/web/src/stores/useBoardFilterStore.ts`          | `BOARD_FILTER_STORAGE_KEY` | `byProject` → assignees, types, priorities, labels, committed query, swimlane mode.                                                                                                                |
| `fb-table-columns-v1`    | localStorage       | `apps/web/src/components/datatable/table-prefs.ts`    | `COLUMN_PREFS_KEY`         | `Record<projectId, { order, hidden }>` for the Table view.                                                                                                                                         |
| `fb-table-filters-v1`    | localStorage       | `apps/web/src/components/datatable/table-prefs.ts`    | `FILTER_PREFS_KEY`         | `Record<projectId, TableFilterState>` — the Table's own lens, distinct from the board's.                                                                                                           |
| `fb-backlog-collapse-v1` | localStorage       | `apps/web/src/components/backlog/backlog-collapse.ts` | `BACKLOG_COLLAPSE_KEY`     | Section id → collapsed. A **map**, not a set: sections have different defaults, so "folded by the user" must be distinguishable from "never touched".                                              |
| `fb-last-org-v1`         | localStorage       | `apps/web/src/hooks/useLastOrg.ts`                    | `LAST_ORG_STORAGE_KEY`     | The last org **slug** (not id — the URL takes a slug, and a stale one degrades to the picker).                                                                                                     |
| `fb-chunk-reload-v1`     | **session**Storage | `apps/web/src/lib/chunk-recovery.ts`                  | `CHUNK_RELOAD_KEY`         | Epoch-ms of the last `vite:preloadError` recovery reload. sessionStorage because the reload wipes the heap and the guard must be per-tab.                                                          |
| `fb-motion-v1`           | localStorage       | `apps/web/src/lib/motion-policy.ts`                   | `MOTION_STORAGE_KEY`       | `'full'` / `'reduced'` / `'system'`. Read pre-paint to stamp `<html data-motion>`; **anything unrecognised falls back to `full`** — see [motion.md](./motion.md) §2.                               |
| `fb-view-mode-v1`        | localStorage       | `apps/web/src/components/navigation/view-as.ts`       | `VIEW_MODE_STORAGE_KEY`    | `'1'`/`'0'` — a global admin's "view as member" posture. Its own key rather than a field inside `fb-auth-v1`, because it is a way of looking, not part of the session; `clearSession()` resets it. |

Three rules the owners all follow, and yours must too:

- **Every access is wrapped.** `localStorage` can _throw_, not merely return
  `null` — Safari in private mode throws on `setItem`. A section that cannot
  remember its fold is not a reason to fail a render.
- **Every read is defensive.** The data is user-writable via devtools and
  version-skewed across a deploy, so malformed JSON, a `null` where an array
  belongs, and an id that no longer exists all resolve to the default.
  `theme-storage.ts` zod-parses; `table-prefs.ts` normalises against the known
  column ids.
- **`partialize` only genuine preferences.** `useLayoutStore` persists four
  fields and deliberately excludes `mobileNavOpen`, `paletteOpen` and `diagOpen`:
  restoring a reload into an open palette or an open devtools panel is
  disorienting, not helpful.

`useLayoutStore` is the one key with a **version and a migration**
(`LAYOUT_STORAGE_VERSION = 1`). v0 → v1 dropped a placeholder `diagTab` field,
and the migrate is written as a **whitelist rather than a `delete`**, because
Zustand's default merge is a shallow spread of the stored object over the initial
state — so any stray field a rolled-back build wrote would otherwise be
resurrected on every hydrate, forever. It also runs `onRehydrateStorage` to push
`diagHeight`/`diagWidth` back through the clamping setters: `partialize` writes
the raw field, and hydration bypasses the setters, so a size saved on a 4K
monitor would restore straight past the ceiling on a laptop. **Copy that pattern
for any persisted numeric bound.**

Two stores deliberately have **no** key: `usePresenceStore` (a rehydrated roster
would paint people who left hours ago) and `useDiagLogsStore` (global-admin log
lines have no business on disk).

## 8. Formatting

**LF line endings everywhere.** `.gitattributes` sets `* text=auto eol=lf` with
binary assets excluded. FlowBoard is developed on Windows and built in Linux
containers, where a CRLF in a script or entrypoint is a runtime failure. On
Windows keep `git config core.autocrlf false`.

Prettier owns formatting, configured once in
`packages/config/prettier.config.mjs` and re-exported by the root
`prettier.config.mjs` so editors (which look at the repo root) and the
`pnpm format` scripts agree:

| Option          | Value   | Note                                                                                                                            |
| --------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `singleQuote`   | `true`  |                                                                                                                                 |
| `semi`          | `true`  |                                                                                                                                 |
| `printWidth`    | `100`   |                                                                                                                                 |
| `trailingComma` | `'all'` |                                                                                                                                 |
| `endOfLine`     | `'lf'`  | **Required.** Without it Prettier follows the platform and rewrites whole files to CRLF on Windows, defeating `.gitattributes`. |

**Edit `packages/config/prettier.config.mjs`, never the root re-export.**

`.prettierignore` excludes the usual generated trees (`node_modules/`, `dist/`,
`build/`, `.turbo/`, `coverage/`, `playwright-report/`, `test-results/`,
`pnpm-lock.yaml`) plus one project-specific entry:

- **`apps/api/drizzle/`** — drizzle-kit's output. The SQL is hand-edited only for
  what drizzle cannot emit (see [database.md](./database.md)), and `meta/` is a
  snapshot the tool **diffs against**. Reformatting either would make the next
  `db:generate` produce a spurious change, or worse, a spurious migration.

The rest of the hard rules — **pnpm only, Node ≥ 22, never the shadcn CLI,
colours only in `apps/web/src/index.css` and the theme presets, every
user-facing string through i18next** — live in [../../CLAUDE.md](../../CLAUDE.md)
and are not repeated here.

## Related docs

- [architecture.md](./architecture.md) — layering, the envelope, the domain-event bus, the frontend state split.
- [database.md](./database.md) — schema conventions, indexes, migrations, the seed.
- [testing.md](./testing.md) — the test pyramid and what each layer owns.
- [i18n.md](./i18n.md) — why validation copy is English on the wire, the RTL rules, and the typed-literal key config modules.
- [design-system.md](./design-system.md) — tokens, hand-copying shadcn primitives, the dashboard kit, the borrow table.
- [motion.md](./motion.md) — `fb-motion-v1`, the `data-motion` gate, and the closed motion registry.
- [admin.md](./admin.md) — `fb-view-mode-v1`, and the instance-admin surfaces above the org boundary.

Back to [docs/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
