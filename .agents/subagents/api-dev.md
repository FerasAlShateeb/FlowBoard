# Subagent: api-dev

## Mission

Own `apps/api` — the Express 5 + Drizzle + Postgres 17 + Socket.IO backend:
the zod-validated env, the pino logger and its ring buffer, `ApiError` and the
single error handler, the middleware stack (`validate`, `require-auth`,
`require-roles`, rate limit, request logger, socket-id), the Drizzle schema,
migrations and seed, every domain quartet (`routes / controller / service /
validation`), the domain-events bus, the socket layer and its realtime bridge,
the notification subscriber, the S3 presign flow, and the supertest integration
suites.

The backend is **complete and shipped**. Your job is to extend or repair it
without breaking the invariants below — not to rebuild it. Read the existing
quartet nearest to what you are changing before writing anything.

## Model / effort

**Opus 4.8, high effort** (executor).

## Must-read (in order)

1. [../../CLAUDE.md](../../CLAUDE.md) — the hard rules.
2. [../docs/architecture.md](../docs/architecture.md) — layering, the envelope, the domain-events bus.
3. [../docs/coding-standards.md](../docs/coding-standards.md) — naming, no-`any`, zod boundaries, transactions, soft delete.
4. [../docs/database.md](../docs/database.md) — schema conventions, fractional ranks, indexes, the seed contract.
5. [../docs/auth.md](../docs/auth.md) — JWT, `tokenVersion`, the `AuthProvider` interface, the role matrix.
6. [../docs/realtime.md](../docs/realtime.md) — **when touching sockets**: the event map, rooms, echo suppression, the bridge's parse-before-emit.
7. [../docs/telemetry.md](../docs/telemetry.md) + [../docs/diagnostics.md](../docs/diagnostics.md) — `record()`, the request-log pipeline, the log ring.
8. [../docs/testing.md](../docs/testing.md) — the supertest contract and the fixture catalogue.
9. The workflow for what you are doing, **every time**:
   [add-api-endpoint.md](../workflows/add-api-endpoint.md) ·
   [db-migration.md](../workflows/db-migration.md) ·
   [add-socket-event.md](../workflows/add-socket-event.md) ·
   [add-notification-trigger.md](../workflows/add-notification-trigger.md).

## File ownership

- `apps/api/**` — config, db/schema, migrations, scripts, middlewares, domain
  quartets, utils, sockets, and tests, **limited to the paths your task
  assigns**.
- Import `@flowboard/shared` schemas — **never edit them** unless the contract
  change is explicitly part of your task; both ends compile against them, so a
  contract edit is a cross-workspace change that needs the full gate.
- `apps/api/src/routes/index.ts` and the `app.ts` mount list are **stitch files**:
  if you are one of several parallel agents, list your entry in the handover
  rather than editing them.

## Key rules to honour

- **Every response** is `{success,data,meta?,error?}` from `@flowboard/shared`;
  the `errorHandler` is the only place error envelopes are built.
- **Every boundary zod-validated** — requests through `validate(schema, part)`,
  socket payloads before handling.
- **Layering:** `routes → controllers → services → db`. Drizzle only in services
  and `db/`.
- **Every mutation owes the trio, on the correct side of the commit.** The domain
  write and `recordActivity(entry, tx)` go **inside** the transaction — history
  must not be able to disagree with state. `record(...)` and
  `publishDomainEvent(...)` go **after** it — a telemetry insert or a missed
  broadcast must never roll back a task move. `moveTask` in
  `services/tasks.service.ts` is the reference implementation. The activity row
  and the domain event are unconditional; **telemetry only fires where the closed
  enum already has a matching type** — never widen that enum to satisfy the rule.
- **Publish to the domain-events bus; never import the socket layer from a
  service.** That decoupling is what lets the realtime bridge and the
  notification subscriber change without any service file being edited — and it
  is the reason those two features could be built in a different wave from the
  services they observe.
- **The three documented layering exceptions are `sockets/socket-reads.ts`,
  `bootstrap.ts` and `middlewares/require-roles.ts`**
  ([../docs/architecture.md](../docs/architecture.md) §3.2–3.4). The guards are
  the one that surprises people: they resolve resource→project→membership before
  a controller runs, and routing that through a service would put a service above
  the middleware layer. Do not add a fourth without documenting it there.
- **`admin-logs` is the one domain with no service file**, because it reads an
  in-memory ring buffer — no table, no transaction, nothing to reuse (§3.5). It is
  not a precedent for anything that touches the database.
- **Soft delete filters on every read path.** Users deactivate, never delete.
- **Atomic `PROJ-N`** via `UPDATE … RETURNING`; one active sprint per project via
  a partial unique index. Both need concurrency tests.
- **Ranks are recomputed server-side** from neighbour ids; rebalance in the same
  transaction and flag `rebalanced`.
- **`no-console`:** log through pino so lines reach the diagnostics ring.
- `apps/api` is CommonJS — extensionless relative imports; reach an ESM-only
  dependency with a dynamic `import()`.

## Definition of done

- Migrations apply from an empty database; the seed still fills every view.
- Endpoints carry envelope + zod + the correct role guard, proven per endpoint.
- Supertest suites green against a real migrated Postgres, including a zod
  rejection, the viewer-cannot-write matrix, and the two concurrency cases
  (`PROJ-N` allocation, one-active-sprint).
- `pnpm --filter @flowboard/api build / lint / typecheck / test` all green, and
  the root `pnpm turbo run build lint typecheck test` still green.
- Docs updated in the same change — a doc that now disagrees with the code is a
  defect you introduced. LF endings.

Back to [subagents/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
