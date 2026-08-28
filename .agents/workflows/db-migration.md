# Workflow: Change the database schema

Drizzle schema edit → generated SQL → applied from an empty database → seed and
tests caught up. The conventions themselves (uuid PKs vs `bigserial` streams,
`columns.ts`'s factories, soft delete vs deactivation, the dual rank columns) are
documented once in `database.md` → conventions — read it, do not restate it here.
This file is the procedure and the hard rules around it. FlowBoard's history is
currently a single applied migration, `0000_initial_schema`, and everything below
is written from what that file actually needed.

## Steps

1. **Edit the schema** — `apps/api/src/db/schema/<domain>.ts`, one file per
   domain, and add a **new** table to `schema/index.ts`: `drizzle.config.ts`
   points at that barrel as its single entry point, so a table missing from it is
   invisible to drizzle-kit _and_ to the relational query API. Use the shared
   column factories rather than re-typing the builder chain — `timestamps()` for
   mutable entities, `createdAt()` for junctions and append-only streams; both
   live in `apps/api/src/db/columns.ts`, deliberately outside `schema/`.

   Declare indexes and CHECKs in the table's third argument. Drizzle emits both,
   including partial ones — `notifications_unread_idx` (`WHERE read_at IS NULL`)
   and `sprints_one_active_per_project` (`WHERE state = 'active'`) are generated,
   not hand-written. A partial **unique** index is a constraint, not an
   optimisation: it is how "one active sprint per project" and "team names unique
   among the undeleted" are expressed.

2. **Generate**: `pnpm --filter @flowboard/api db:generate`. The config runs with
   `verbose: true` and `strict: true`, so it prints the SQL and refuses a
   destructive statement without asking. If you rename the file to something
   descriptive, update the matching `tag` in `drizzle/meta/_journal.json` —
   that journal is the tool's own record and the `meta/` snapshot is what the
   NEXT `db:generate` diffs against.

3. **Read the generated SQL, and hand-edit ONLY what drizzle-kit cannot emit.**
   Its snapshot covers tables, columns, enums, indexes and constraints — it does
   not cover anything outside that schema. In `0000_initial_schema.sql` exactly
   one edit was needed, and it is commented in place at the top of the file:

   ```sql
   -- HAND-EDITED after generation. Do not regenerate this file in place.
   -- drizzle-kit never emits CREATE EXTENSION … but "tasks_title_trgm_idx" is a
   -- GIN index using gin_trgm_ops and fails without pg_trgm.
   CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
   ```

   The same category covers data backfills and `CREATE INDEX CONCURRENTLY`.
   Everything else — the eleven `CHECK` constraints, the pg enums, the four
   partial indexes — came out of the generator untouched, so reach for a CHECK in
   the schema file before you reach for the `.sql`. **Comment every hand-edit**
   and say why the generator could not produce it.

4. **Apply**: `pnpm db:migrate` (→ `apps/api/src/scripts/migrate.ts`). Safe
   against an empty, half-migrated or up-to-date database; Drizzle records what
   it applied in `drizzle.__drizzle_migrations` and skips the rest.

5. **Prove it runs from zero**: `pnpm db:reset` then `pnpm db:seed`. `reset.ts`
   drops **both** `public` and the `drizzle` schema before re-migrating —
   dropping only `public` would leave the journal claiming everything was already
   applied and the follow-up migrate would silently do nothing. A migration that
   only works on your database is not a migration.

6. **Update the seed** (`apps/api/src/scripts/seed.ts`) so every view still
   renders non-empty. The seed is one deterministic transaction, all-or-nothing,
   and refuses to run against a database that already has users — hence the
   `db:reset && db:seed` pairing. It takes **type-only** imports from
   `@flowboard/shared` and no runtime ones, because it must be able to bootstrap
   the database that package's own tests run against.

7. **Update `packages/shared` if the shape crossed the wire.** A column the API
   returns needs its zod schema widened in the same change, or the response fails
   its own parse. A pg enum has a **shared twin** — `notification_type` is
   declared in `db/schema/enums.ts` _and_ as `notificationTypeSchema` in
   `notifications.schema.ts`, and `notifications.service` parses the row value
   through the shared enum precisely because they are two independent
   declarations of the same seven values.

8. **Update the tests.** `apps/api/src/db/schema.test.ts` pins enums, soft-delete
   columns and specific indexes by hand, so a silent rename fails there rather
   than four waves later. Extend the route/service suites for the new column, and
   for a partial unique index add the round-trip that proves it: soft-delete a
   row, re-create with the same key, expect success.

9. **Update [../docs/database.md](../docs/database.md)** — the table map, the
   index list, or the extension notes — and tick the row in
   [../checklists/project-checklist.md](../checklists/project-checklist.md).

## Hard rules

- **Never edit an already-applied migration.** Write a new one. The journal
  records a `when` timestamp and a tag; editing a file that other databases have
  already run produces a schema that differs by history.
- **`apps/api/drizzle/` is in `.prettierignore`, deliberately.** The `.sql` is
  hand-edited only for what drizzle cannot emit, and `meta/` is a snapshot the
  tool DIFFS against — reformatting either makes the next `db:generate` produce a
  spurious change, or a spurious migration.
- **The journal is a snapshot, not a log.** `drizzle/meta/` describes the schema
  drizzle-kit believes exists; it is how the next generate computes a diff. Never
  hand-edit it except to correct a `tag` you renamed in step 2.
- **`timestamptz` always** — never `timestamp` without a zone. `columns.ts`'s
  `tz()` helper exists so nobody has to remember.
- **A logical unique on a soft-deleted table is a partial unique index**, not
  `unique: true`, or a deleted row blocks re-creating its own key forever.

## Checklist

- [ ] Schema edited; a new table added to `schema/index.ts`.
- [ ] Shared column factories used; every timestamp is `timestamptz`.
- [ ] Indexes and CHECKs declared in the schema, not bolted onto the SQL.
- [ ] Generated SQL read; hand-edits limited to extensions/backfills/CONCURRENTLY and commented.
- [ ] `_journal.json` tag matches the filename.
- [ ] `pnpm db:reset && pnpm db:seed` succeeds from empty.
- [ ] Seed updated so every view still renders non-empty.
- [ ] `packages/shared` schemas updated if the shape crossed the wire; pg enum twin in sync.
- [ ] `db/schema.test.ts` and the affected suites updated; soft-delete/re-create tested.
- [ ] `database.md` updated; no applied migration was edited.
- [ ] `pnpm turbo run build lint typecheck test` green.

## Related

- [database.md](../docs/database.md) — conventions, the table map, indexes, extensions, the seed contract.
- [coding-standards.md](../docs/coding-standards.md) — the `Executor = Db | Tx` pattern and soft-delete discipline.
- [add-api-endpoint.md](./add-api-endpoint.md) — exposing the new column over HTTP.
- [testing.md](../docs/testing.md) — the one test database and why runs are sequential.

Back to [workflows/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
