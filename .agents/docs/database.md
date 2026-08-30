# Database

Postgres 17 + **Drizzle ORM** + **postgres-js** + **drizzle-kit**. Everything
lives under `apps/api/src/db/`, one file per domain, and nothing above the
service layer imports it.

```
apps/api/
├── drizzle.config.ts          # drizzle-kit config (generate only)
├── drizzle/                   # 0000_initial_schema.sql · 0001_instance_settings.sql
│                              # + meta/_journal.json
└── src/
    ├── db/
    │   ├── client.ts          # pool, `db`, `Tx`, `withTx`, `closeDb`
    │   ├── columns.ts         # timestamps() / createdAt() / deletedAt() factories
    │   ├── index.ts           # barrel: `import { db, withTx, tasks } from '../db'`
    │   ├── schema.test.ts     # schema contract tests (no live DB needed)
    │   └── schema/
    │       ├── index.ts       # re-exports every table — drizzle-kit's entry point
    │       ├── enums.ts       users.ts   orgs.ts     teams.ts    projects.ts
    │       ├── instance-settings.ts      # the deployment singleton
    │       ├── workflow.ts    sprints.ts tasks.ts    comments.ts
    │       └── activity.ts    notifications.ts       telemetry.ts
    └── scripts/               # migrate.ts · seed.ts · reset.ts
                               # + seed-utils.ts (pure helpers) · script-logger.ts
```

**There are two migrations**, both entries in `drizzle/meta/_journal.json`
(journal `version: 7`):

| File                         | What it adds                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0000_initial_schema.sql`    | Every table, index, enum and check below except the next row. Hand-edited to prepend `CREATE EXTENSION pg_trgm`.                                                  |
| `0001_instance_settings.sql` | `instance_settings`, the multi-org / single-org singleton. Hand-edited to append an idempotent `INSERT … ON CONFLICT DO NOTHING` for row 1 — see the file's note. |

Nothing in this document describes an unapplied change.

---

## Conventions

| Rule                                                                                                                                         | Why                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **uuid PKs** for domain entities (`gen_random_uuid()`)                                                                                       | ids travel in URLs and socket payloads; a guessable serial leaks row counts                                                                                                                                            |
| **`bigserial` PKs** for append-only streams (`activity`, `telemetry_events`, `request_logs`)                                                 | monotonic ids give cheap keyset pagination and the log drawer's `sinceId` cursor                                                                                                                                       |
| **`timestamptz`** everywhere for instants; **`date`** for calendar days (`tasks.start_date` / `due_date`, `sprints.start_date` / `end_date`) | the gantt, the calendar and a sprint window are day tools — a timezone on a boundary shifts it for anyone west of UTC, which is how a two-week sprint renders as thirteen days                                         |
| **Colours are `#rrggbb` hex literals** (`statuses.color`, `labels.color`), never design-token names                                          | they are user-chosen DATA, validated by the shared `hexColor`, and must mean the same thing in both themes and in a CSV export. `projects.avatar_color` is the exception and IS a token name — it is chrome, not data. |
| **`tasks.story_points` is `numeric(5,1)`**, read as a `number` (`mode: 'number'`)                                                            | the shared contract allows halves (0.5); an `integer` column would round a value the user typed with no error anywhere                                                                                                 |
| `created_at` / `updated_at` via `timestamps()`; `updated_at` maintained by Drizzle's `$onUpdate`                                             | the API is the only writer; an app-level hook is visible to reviewers, a trigger is not                                                                                                                                |
| **snake_case in the database, camelCase in TypeScript** — every column names both explicitly                                                 | no implicit casing magic to remember when reading raw SQL                                                                                                                                                              |
| **No `any`.** Row types come from inference: `export type TaskRow = typeof tasks.$inferSelect`                                               | lint-enforced project-wide                                                                                                                                                                                             |
| `jsonb` columns infer as `unknown`                                                                                                           | parse them with a zod schema at the boundary; never cast                                                                                                                                                               |

### Soft delete

`deleted_at` exists on exactly six tables: **organizations, teams, projects,
tasks, comments, attachments**. `src/db/schema.test.ts` fails if that list
changes without a deliberate edit.

- **Every read of those tables must filter `isNull(table.deletedAt)`.** There is
  no global scope doing it for you. The one index that assumes it —
  `tasks_assignee_idx` — is partial (`WHERE deleted_at IS NULL`), so a query that
  forgets the filter also loses the index.
- Junction, member, status and sprint rows **hard-delete** behind service guards
  (e.g. a status may not be deleted while tasks reference it — `tasks.status_id`
  is `ON DELETE RESTRICT`, so the database refuses too).
- **Users are never deleted.** Deactivate: `is_active = false` **and** bump
  `token_version`, which invalidates every outstanding access and refresh token.
  `DELETE /api/admin/users/:userId` is an **anonymize**, not a delete: the row
  survives with `name = 'Deleted user'`, the address rewritten to a unique
  `deleted+<uuid>@flowboard.invalid` (the column is NOT NULL and unique on
  `lower(email)`, so it cannot be nulled), the avatar cleared, `is_active` false,
  `token_version` bumped, and every `org_members` / `project_members` row
  removed. Comments, activity and assignments keep pointing at a real row.
- Deleting a task cascades to its **subtasks** (`parent_id` is `ON DELETE
CASCADE`) but not to its epic children (`epic_id` is `ON DELETE SET NULL`).

### Enums

`src/db/schema/enums.ts` holds all seven pg enums:
`task_type`, `task_priority`, `org_role`, `project_role`, `sprint_state`,
`status_category`, `notification_type`.

**Every one of them mirrors a `z.enum` in `packages/shared` — same members, same
order.** They are the two ends of one wire (the column stores the value, the
browser parses it), so `task_mentioned` where the contract says `mentioned` is
not a synonym, it is a payload the web rejects at the boundary.
`src/db/schema.test.ts` asserts the parity for all seven; if you add a member,
add it in both places in the same commit.

They live in one file rather than in their domain files because a `pgEnum` value
is read **eagerly** while a table is declared, and `project_role` is needed by
both `projects.ts` and `orgs.ts`. Every other cross-file reference is a
`references(() => other.id)` thunk that Node resolves long after module load, so
those import cycles are harmless — an eager one across a cycle would resolve to
`undefined` depending on which file the loader reached first.

**Not enums, on purpose:**

- **Workflow statuses and transitions are data tables.** Per-project custom
  workflows are the product; "add a column" must never be a migration.
- **`telemetry_events.type`** is `text`, validated by the shared zod enum at the
  `record()` boundary. Adding an event type ships with the feature.
- **`activity.action`** is `text` for the same reason (dot-namespaced:
  `task.created`, `task.field_changed`, `comment.added`, `sprint.started`).
  The column accepts anything; the **closed set is `activityActionSchema`**, and
  every read parses through it — so a value outside the enum inserts happily and
  then fails the whole feed request with a 422. Do not confuse these with the
  SOCKET event names (`comment:created`), which are a separate vocabulary.
- **`users.locale`** is `text` — adding Arabic-plus-one should not be DDL.
- **`instance_settings.org_mode`** is `text`, validated by the shared
  `orgModeSchema` on every read. A third deployment shape must not be a
  migration, and the column has exactly one writer.

---

## Table map

### Identity & tenancy

| Table                    | One-liner                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                  | The only account table. Unique on `lower(email)` via a functional index. No self-registration; `is_global_admin`, `token_version`, `locale`, `is_active`.                                                                                                                                                                                    |
| `organizations`          | Top of the hierarchy. `slug` is the `/o/:orgSlug` URL segment, format-checked.                                                                                                                                                                                                                                                               |
| `org_members`            | PK `(org_id, user_id)` + `org_role`. Extra index on `user_id` for the org switcher.                                                                                                                                                                                                                                                          |
| `invites`                | Opaque `token`, optional email lock, optional **direct project grant** (`project_id` + `project_role` are all-or-nothing, check-constrained), `expires_at`, and the acceptance stamps `accepted_at` / `accepted_by_id` — invite _status_ is derived from those two plus `expires_at`, never stored. `invited_by_id` is `ON DELETE SET NULL`. |
| `teams` / `team_members` | People grouping, not a permission boundary. Team names are unique per org **among live rows**.                                                                                                                                                                                                                                               |
| `instance_settings`      | The deployment SINGLETON: `id` is an `integer` pinned to 1 by a check, plus `org_mode` (`'multi'`/`'single'`, plain `text` parsed by the shared `orgModeSchema`), a nullable `default_org_id` (`ON DELETE SET NULL`) and `instance_name`. Written by `services/instance-settings.service.ts`, which also ensures the row lazily.             |

### Projects & workflow

| Table                  | One-liner                                                                                                                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`             | Unique `(org_id, key)`; `key` matches `^[A-Z][A-Z0-9]{1,9}$`. `task_counter` is the `PROJ-123` sequence (check-constrained `>= 0`). Optional `team_id` and `lead_id` — both display-only, both `ON DELETE SET NULL`. `avatar_color` is a design-token name defaulting to `indigo`.              |
| `project_members`      | PK `(project_id, user_id)` + `project_role`. Effective permission = global admin ⊃ org admin ⊃ this row, so a guard must resolve in that order rather than requiring a row.                                                                                                                     |
| `statuses`             | The board columns: `category` (todo/in_progress/done), `color`, `position`, nullable `wip_limit`. `position` is deliberately **not** unique — reordering rewrites the whole set in one transaction and a non-deferrable unique index would trip halfway.                                        |
| `workflow_transitions` | The whitelist. **Zero rows for a `from_status_id` = every target allowed**; one row makes the set exhaustive. That is how a new project gets an open workflow without N² rows.                                                                                                                  |
| `labels`               | Project-scoped tags, unique name per project.                                                                                                                                                                                                                                                   |
| `sprints`              | `state`, planned window (**`date`** columns — a sprint boundary is a calendar day), actual `started_at` / `completed_at` (`timestamptz` — those are instants), and the two **stamped** point columns. Velocity reads the stamps, so re-estimating after a sprint closes cannot rewrite history. |

### Work

| Table                                                 | One-liner                                                                                                                                                                                                                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasks`                                               | The centre. `(project_id, number)` unique → the `PROJ-123` key. Type/status/priority, assignee/reporter, points, `start_date`/`due_date`, `sprint_id` (null = backlog), `epic_id` + `parent_id` self-FKs, **`board_rank` + `backlog_rank`**, `resolved_at`. |
| `task_labels` / `task_watchers` / `task_dependencies` | Junctions. Watchers carry `is_muted` (keep the row, suppress delivery). Dependencies are blocker→blocked with a unique pair and a self-edge check; **cycle detection is service-side** — Postgres cannot express it.                                        |
| `comments`                                            | Markdown body with `@[Display Name](userId)` mentions. `edited_at` is distinct from `updated_at`: only a human edit sets it.                                                                                                                                |
| `attachments`                                         | Metadata only; bytes live in MinIO. `s3_key` is `{orgId}/{projectId}/{taskId}/{uuid}-{name}` and unique. `confirmed_at IS NULL` means "presigned but never uploaded" — invisible to the UI, reapable by a sweeper.                                          |

### Streams

| Table              | One-liner                                                                                                                                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activity`         | Append-only audit. One row per changed field (`action`, `field`, `old_value`/`new_value` jsonb). **Never updated, never deleted, not even softly** — the task history, the project feed and the CFD report are all replays of it.                                                             |
| `notifications`    | In-app only. Payload is **denormalized on purpose** so a notification still renders after its task is renamed or soft-deleted, and the bell menu needs no joins. It also keeps nullable `project_id` / `task_id` / `comment_id` FKs — those are the deep-link targets, not the render source. |
| `telemetry_events` | Product analytics. `type` is text (see above), plus optional user/org/project, a jsonb `payload`, and `session_id` — an anonymous per-browser-tab grouping key, **not a token**; nothing authenticates with it.                                                                               |
| `request_logs`     | One row per HTTP request: `method`, `path`, `status_code`, `duration_ms`, plus optional `user_id`, `ip` and `user_agent`. `path` is the **normalized route pattern** (`/api/tasks/:taskId`) — storing raw URLs turns "top endpoints" into a list of a million uuids.                          |

---

## Ordering: the two rank columns

`tasks.board_rank` and `tasks.backlog_rank` are **fractional-index** `text`
columns (base-62 keys from the `fractional-indexing` package's
`generateKeyBetween`, wrapped in `packages/shared/src/rank.ts`).

- **Two independent orderings.** `board_rank` orders within
  `(project_id, status_id)` — a Kanban column. `backlog_rank` orders within
  `(project_id, sprint_id)` — a backlog or sprint panel. Moving a card on the
  board must not reshuffle the backlog.
- **Insert between two neighbours is O(1)** and touches exactly one row, so a
  drag is a single `UPDATE` instead of renumbering the column.
- **Reads are a plain `ORDER BY`**, served by `tasks_board_idx` /
  `tasks_backlog_idx` — no window functions, no post-sorting in JS.
- **The client computes an optimistic rank** for instant feedback; the server
  **recomputes authoritatively** from `beforeTaskId` / `afterTaskId` inside the
  move transaction, because two people can drag into the same gap at once.
- **Rebalance:** when a generated key would exceed ~60 characters, the service
  rewrites that column's ranks **inside the same transaction** and sets
  `rebalanced: true` in the socket payload so other clients refetch.
- Keys sort by plain byte comparison. The seed hand-writes its keys
  (`a0`…`az`, then `b00`…) rather than importing the shared helper — see
  `src/scripts/seed-utils.ts` for why, and `seed-utils.test.ts` for the
  ordering property that pins it.

---

## Indexes worth knowing

The schema declares **41 indexes** (count them with
`grep -hoE "(uniqueIndex|index)\('[a-z_0-9]+'" apps/api/src/db/schema/*.ts | sort -u | wc -l`).
This section covers the ones whose shape
encodes a decision; the rest are the obvious "the PK cannot serve this
direction" reverse lookups (`org_members_user_idx`, `team_members_user_idx`,
`project_members_user_idx`, `task_labels_label_idx`, `task_watchers_user_idx`,
`task_dependencies_blocked_idx`, `invites_org_idx`, `invites_email_idx`,
`projects_org_idx`, `teams_org_idx`, `workflow_transitions_project_idx`,
`sprints_project_state_idx`, `attachments_task_idx`).

`tasks` carries seven read paths, one per thing the product actually does:

| Index                                                       | Serves                                    |
| ----------------------------------------------------------- | ----------------------------------------- |
| `tasks_board_idx (project_id, status_id, board_rank)`       | one board column, already ordered         |
| `tasks_backlog_idx (project_id, sprint_id, backlog_rank)`   | one sprint / the backlog, already ordered |
| `tasks_assignee_idx (assignee_id) WHERE deleted_at IS NULL` | "my work", workload report                |
| `tasks_epic_idx (epic_id)`                                  | roadmap epic roll-ups                     |
| `tasks_parent_idx (parent_id)`                              | subtask lists                             |
| `tasks_project_due_date_idx (project_id, due_date)`         | calendar / gantt windows                  |
| `tasks_title_trgm_idx` GIN `gin_trgm_ops`                   | command-palette fuzzy search              |

Plus, elsewhere:

- `users_email_lower_unique` — **unique on `lower(email)`**, so `Ada@x.dev` and
  `ada@x.dev` are the same account, and the login lookup uses the same index.
- `sprints_one_active_per_project` — unique on `(project_id) WHERE state = 'active'`.
  Two concurrent `/start` calls race **in the database** and one loses; no
  application locking.
- `projects_org_key_unique (org_id, key)` and `tasks_project_number_unique
(project_id, number)` — together they make `PROJ-123` globally unambiguous.
- `notifications_recipient_idx (recipient_id, created_at DESC)` — the
  notifications page, and `notifications_unread_idx (recipient_id, created_at
DESC) WHERE read_at IS NULL` — partial, because the unread set stays tiny while
  the read set grows forever. This is what keeps the badge's `COUNT(*)` an
  index-only scan.
- `activity_project_idx (project_id, id DESC)` and `activity_task_idx (task_id, id)`.
  Note both key on **`id`, not `created_at`**: rows written inside one
  transaction share a timestamp, and only the bigserial gives a total order.
- `statuses_project_name_unique (project_id, name)` and
  `labels_project_name_unique (project_id, name)` — a board column and a label
  are addressed by name in the UI, so duplicates are a product bug, not a
  cosmetic one. `statuses_project_position_idx (project_id, position)` serves the
  ordered read; `position` itself is deliberately not unique (see above).
- `workflow_transitions_pair_unique (from_status_id, to_status_id)` and
  `task_dependencies_pair_unique (blocker_task_id, blocked_task_id)` — both
  whitelists are sets, so the duplicate is rejected by the database rather than
  by a pre-read.
- `comments_task_idx (task_id, created_at)` — the thread reads one task's
  comments oldest-first, which is the one place `created_at` is the right key.
- The two stream tables index for their dashboards, not for their writes:
  `telemetry_events_type_created_idx (type, created_at DESC)`,
  `telemetry_events_created_idx (created_at DESC)`,
  `telemetry_events_user_idx (user_id)`;
  `request_logs_created_idx (created_at DESC)`,
  `request_logs_path_created_idx (path, created_at DESC)`,
  `request_logs_status_idx (status_code)`. Both tables are written
  fire-and-forget, so an index that slows an insert costs a user nothing.

### Check constraints

**Seventeen, and the shipped list is exactly this:**

| Constraint                           | Enforces                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `organizations_slug_format`          | `^[a-z0-9](-?[a-z0-9]+)*$`                                                                   |
| `instance_settings_singleton`        | `id = 1` — one configuration row, enforced by the database rather than by convention         |
| `projects_key_format`                | `^[A-Z][A-Z0-9]{1,9}$`                                                                       |
| `projects_task_counter_non_negative` | `task_counter >= 0`                                                                          |
| `invites_project_grant_complete`     | `(project_id IS NULL) = (project_role IS NULL)`                                              |
| `statuses_position_non_negative`     | `position >= 0`                                                                              |
| `statuses_wip_limit_positive`        | `wip_limit IS NULL OR wip_limit > 0`                                                         |
| `workflow_transitions_not_self`      | `from_status_id <> to_status_id`                                                             |
| `sprints_window_ordered`             | `end_date >= start_date` when both are set                                                   |
| `sprints_points_non_negative`        | both stamped point columns, when set                                                         |
| `tasks_number_positive`              | `number > 0`                                                                                 |
| `tasks_story_points_non_negative`    | `story_points IS NULL OR story_points >= 0` (**zero is legal** — a spike is a real estimate) |
| `tasks_dates_ordered`                | `due_date >= start_date` when both are set                                                   |
| `tasks_not_own_epic`                 | `epic_id <> id`                                                                              |
| `tasks_not_own_parent`               | `parent_id <> id`                                                                            |
| `task_dependencies_not_self`         | `blocker_task_id <> blocked_task_id`                                                         |
| `attachments_size_positive`          | `size_bytes > 0` — a zero-byte row means the presign lied                                    |

Everything graph-shaped (dependency cycles, transition legality, "an epic parent
must actually be of type `epic`") is service-side: Postgres cannot express it.

---

## Extensions

**drizzle-kit never emits `CREATE EXTENSION`** — extensions are outside the
schema snapshot it diffs. The pattern, used by `0000_initial_schema.sql` for
`pg_trgm` (which `tasks_title_trgm_idx` needs):

1. `pnpm --filter @flowboard/api db:generate`
2. Open the generated `.sql` and **prepend** the statement, ending it with the
   breakpoint marker so the migrator runs it as its own statement:

   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
   ```

3. Leave a comment saying the file was hand-edited and why.

Because the snapshot does not track extensions, a later `db:generate` will not
try to remove it, and `IF NOT EXISTS` keeps re-runs harmless.

---

## Scripts

All four run from `apps/api`. `db:migrate`, `db:seed` and `db:reset` read
`DATABASE_URL` through `src/config/env.ts` (which loads `apps/api/.env`, then
the repo-root `.env`, dotenv never overwriting an already-set variable).

**`db:generate` is the exception: it does not go through `env.ts` at all.**
drizzle-kit loads `drizzle.config.ts` through its own esbuild ESM loader, where
`__dirname` does not exist and a zod failure inside `env.ts` would `process.exit`
with a message aimed at an API operator rather than at someone running a
migration. So the two-file dotenv chain is replicated verbatim in
`drizzle.config.ts` and only `DATABASE_URL` is read. **If you change the chain in
`env.ts`, change it there too.**

```bash
docker compose -f docker-compose.dev.yml up -d   # postgres on 5433, minio on 9000

pnpm --filter @flowboard/api db:generate   # schema → new drizzle/NNNN_*.sql
pnpm --filter @flowboard/api db:migrate    # apply pending migrations
pnpm --filter @flowboard/api db:seed       # fill an EMPTY database with demo data
pnpm --filter @flowboard/api db:reset      # DROP everything, then migrate
```

> The dev compose publishes Postgres on **5433**, not 5432, because another
> project's Postgres owns 5432 on this machine. `POSTGRES_PORT` and
> `DATABASE_URL` in the root `.env` must stay in sync.

**The test database is a different database on the same container**
(`flowboard_test`), created and migrated by `src/test/test-db.ts` rather than by
any of these scripts — never point `db:reset` or `db:seed` at it. See
[testing.md §2.2](./testing.md) and
[coding-standards.md §6.4](./coding-standards.md#64-fileparallelism-and-the-api-test-database).

- **`db:migrate`** is safe to re-run: Drizzle records applied files in
  `drizzle.__drizzle_migrations`. It reports how many were newly applied.
- **`db:reset`** drops **both** the `public` schema and the `drizzle` schema —
  dropping only `public` would leave the journal claiming everything is applied
  and the follow-up migrate would silently do nothing. It **refuses to run when
  `NODE_ENV=production`** and prints the host/database it is about to destroy.
- **`db:seed`** is one transaction (all-or-nothing) and **refuses to run against
  a database that already has users** — it selects one `users` row first and
  exits 1 with the `db:reset` hint if it finds anything. Use
  `db:reset && db:seed`. On success it prints a per-table row count, then the
  two sign-in lines: **the demo passwords are surfaced by the script's own
  output, nowhere else.** There is no credentials file to look up.

### What the seed contains

Deterministic (one seeded LCG — same data every run), sized so that **no view and
no chart renders empty**:

|          |                                                                                                                                                                                                                                                                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in  | `admin@flowboard.dev` / `admin1234` (global admin) — every other account uses `password1234`                                                                                                                                                                                                                                                                           |
| People   | 10 users: a global admin, a **non-global org admin**, a **viewer**, an Arabic-locale account, one **deactivated** account, and one who belongs to Globex ONLY                                                                                                                                                                                                          |
| Instance | 1 `instance_settings` row — `orgMode: 'multi'`, no default org. W3.1 flips this one row to walk the single-org path                                                                                                                                                                                                                                                    |
| Orgs     | **Two**, so every cross-organization surface has more than one row. `acme` — 9 members, 2 teams, 3 invites (open / project-granting / expired). `globex` — 5 members (4 shared with Acme, 1 its own), no teams, 4 invites of which **2 are accepted** so the growth acceptance rate is not zero                                                                        |
| Projects | **FLOW** — default 3-column workflow, **zero** transition rows (everything allowed). **CORE** — custom 5-column workflow, a transition whitelist, and a WIP limit of 3 on "In Progress" that the seed sits exactly at. **GX** and **OPS** (Globex) — both the default workflow                                                                                         |
| Tasks    | 90 (**38 FLOW · 23 CORE · 17 GX · 12 OPS**): all five types, epics with children, subtasks, 7 dependency edges (a 4-link chain plus independent pairs), label links, watcher rows of which exactly **one is muted**, varied priorities and points, dates spanning past and future                                                                                      |
| Sprints  | 7. FLOW: one **completed** (points stamped, tasks resolved inside the window), one **active**, one **planned**. CORE: one active. GX: one completed + one active. OPS: one active. Plus a backlog remainder in each project                                                                                                                                            |
| Talk     | 50 comments including one `@[Sara Novak](userId)` mention                                                                                                                                                                                                                                                                                                              |
| Streams  | **306** activity rows (one `task.created` per task, an assignment row, one per status hop, one `comment.added` per comment attributed to its own author), 5 notifications (read and unread), **260** telemetry events over 14 days across **11** types and **both** organizations, **500** request logs over 7 days with varied route patterns and a latency long tail |

Attachments are deliberately **not** seeded: rows without matching MinIO objects
would give the UI broken download links.

---

## Adding a migration

1. **Edit the schema** in `apps/api/src/db/schema/<domain>.ts`. Add the table to
   `schema/index.ts` if it is new — `drizzle.config.ts` points at that barrel as
   its **single** entry point (`schema: './src/db/schema/index.ts'`, not a
   `*.ts` glob, which would hand drizzle-kit every table twice), so a table
   missing from it is invisible to both drizzle-kit and the relational query API.
2. **Generate**: `pnpm --filter @flowboard/api db:generate`. Read the SQL it
   produced. Rename it to something descriptive and update the matching `tag` in
   `drizzle/meta/_journal.json` if you do.
3. **Hand-edit only for what drizzle cannot express** — extensions (above), data
   backfills, `CREATE INDEX CONCURRENTLY`. Comment the edit.
4. **Apply**: `pnpm --filter @flowboard/api db:migrate`.
5. **Prove it runs from zero**: `pnpm --filter @flowboard/api db:reset` then
   `db:seed`. "Migrations are idempotent from an empty database" is a checklist
   item, not a hope.
6. **Update `src/db/schema.test.ts`.** A new table fails its `EXPECTED_TABLES`
   list immediately, and it also pins the seven enum member lists, their parity
   with the `@flowboard/shared` zod enums, the soft-delete set, which tables get
   `updated_at`, snake_case column naming, the seven `tasks` read paths (in
   order), the partial/GIN/unique index properties, the `tasks` check list, and
   `bigserial` ids on the three stream tables. Those expectations are written out
   by hand rather than derived from the schema, precisely so a silent rename
   fails here rather than at runtime — **it needs no live database**, so it is
   also the cheapest place to run first.
7. **Never edit an already-applied migration file.** Write a new one.

---

## Using the client

```ts
import { db, withTx, tasks, projects, activity } from '../db';
```

- **`db`** — the pooled Drizzle instance (`max: 10`, `prepare: false` so the pool
  survives a future transaction-pooling proxy).
- **`withTx(fn)`** — _the_ multi-write helper. Almost every FlowBoard mutation
  writes more than one row, because each also appends an activity entry:

  ```ts
  const task = await withTx(async (tx) => {
    const [project] = await tx
      .update(projects)
      .set({ taskCounter: sql`${projects.taskCounter} + 1` })
      .where(eq(projects.id, projectId))
      .returning({ number: projects.taskCounter });      // atomic — never read-then-write
    const [row] = await tx.insert(tasks).values({ …, number: project.number }).returning();
    await tx.insert(activity).values({ projectId, taskId: row.id, action: 'task.created' });
    return row;
  });
  ```

- **`Tx`** — the transaction handle type, derived from `db` so it cannot drift.
  Write services as `fn(input, tx: Tx | Db = db)` and they compose into a caller's
  transaction for free.
- **`closeDb()`** — graceful shutdown and CLI scripts (which otherwise hang on
  idle pool connections).

Layering rule: **`routes → controllers → services → db`.** Controllers and routes
must never import `src/db`.

---

## Related docs

- [architecture.md](./architecture.md) — the layering rule and its three exceptions.
- [admin.md](./admin.md) — `instance_settings`, single-org mode, and the
  anonymize-delete this document's soft-delete section summarises.
- [coding-standards.md](./coding-standards.md) — `withTx`, the `Executor` pattern
  and the mutation trio.
- [../workflows/db-migration.md](../workflows/db-migration.md) — the procedure.

Back to [docs/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
