# FlowBoard — Agent Guide

FlowBoard is a **Jira-like project-management web app**, built as a pnpm +
Turborepo monorepo. Organizations contain teams and projects; projects contain
Jira-style issues (`FLOW-142`) that move through **per-project custom workflows**
and are viewed five ways — Kanban board, backlog + sprints, a custom-built
roadmap/Gantt, a data table, and a calendar — plus a reports dashboard. It ships
realtime collaboration with presence, in-app notifications, S3-backed
attachments, a Linear-style dark-first design system with a Theme Studio, full
Arabic/RTL, custom DB-backed telemetry, and a dev-tools-style log viewer.

Read the non-negotiable hard rules in **[CLAUDE.md](./CLAUDE.md)** before writing
any code, then use [`.agents/INDEX.md`](./.agents/INDEX.md) to find the doc for
what you are about to touch.

## Stack at a glance

| Workspace         | What it is                  | Key technology                                                                                                                                                                                                                  |
| ----------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`        | The SPA                     | Vite 7, React 19, Tailwind v4 (CSS-first), 26 hand-copied `radix-ui` primitives, react-router-dom 7, **TanStack Query v5 = server state**, **Zustand 5 = UI state only**, RHF + zod, dnd-kit, TanStack Table, Recharts, i18next |
| `apps/api`        | The REST + realtime backend | Express 5 (CommonJS), Drizzle ORM + postgres-js, Postgres 17, Socket.IO 4, pino, JWT (access + refresh + `tokenVersion`), `@aws-sdk/client-s3`                                                                                  |
| `packages/shared` | The contract layer          | zod schemas for every entity, request, response, and socket event; tsup dual ESM/CJS build; runtime-neutral (no DOM or Node globals)                                                                                            |
| `packages/config` | The toolchain               | tsconfig base/react/node, flat ESLint (`no-explicit-any: error`), Prettier                                                                                                                                                      |
| `e2e`             | End-to-end suite            | Playwright                                                                                                                                                                                                                      |

Layering in the API is strict: **`routes → controllers → services → db`**. Every
response is the `{success,data,meta?,error?}` envelope from `@flowboard/shared`.
Both ends of every boundary parse with the same zod schema.

## Quickstart

```bash
pnpm install                                        # install the monorepo (hoisted linker)
cp .env.example .env                                # PowerShell: Copy-Item .env.example .env
docker compose -f docker-compose.dev.yml up -d      # Postgres 17 + MinIO + bucket bootstrap
pnpm db:migrate                                     # drizzle-kit migrations
pnpm db:seed                                        # demo org, 2 projects, ~60 issues, 2 sprints
pnpm dev                                            # turbo: api (:4000) + web (:5173) + shared (tsup --watch)
```

`pnpm dev` runs three watchers, not two: `@flowboard/shared` rebuilds with
`tsup --watch` so a contract change reaches both apps without a restart. Vite
proxies `/api` and `/socket.io` to `localhost:4000`, so the browser only ever
talks to `:5173`.

The seed prints its credentials — `admin@flowboard.dev` / `admin1234` (global
admin), everyone else `password1234`. It **refuses to run against a non-empty
database**; use `pnpm db:reset` (drop → migrate → seed) instead of seeding twice.

Verification gate — **all four must be green before a change is done**:

```bash
pnpm build       # turbo run build     (tsup + tsc + vite)
pnpm lint        # turbo run lint      (flat config from @flowboard/config)
pnpm typecheck   # turbo run typecheck (tsc --noEmit everywhere)
pnpm test        # turbo run test      (152 vitest files / ~2 900 cases)
```

`pnpm e2e` (Playwright) runs separately. It is deliberately **uncached and
scheduled last, alone** — see the comment on `e2e#test` in `turbo.json`: a browser
suite driving two real servers cannot compete with the Vitest suites for cores,
and a cached "pass" for a browser run would be a replay, not a run. It needs the
dev compose up and the browsers installed once.

Other useful commands:

```bash
pnpm --filter @flowboard/web dev             # just the SPA
pnpm --filter @flowboard/api dev             # just the API
pnpm --filter @flowboard/api test            # just the API suites
pnpm --filter @flowboard/api db:generate     # drizzle-kit generate (after a schema edit)
pnpm db:reset                                # drop → migrate → seed
pnpm format / pnpm format:check              # Prettier over ts/tsx/mjs/json/css/md/yml
pnpm --filter @flowboard/e2e test:install    # download Playwright browsers (once)
docker compose -f docker-compose.dev.yml ps        # health of Postgres + MinIO
docker compose -f docker-compose.dev.yml down -v   # stop AND wipe the volumes
```

The dev loop is **hybrid on purpose**: infrastructure (Postgres + MinIO) runs in
Docker, while the API and web app run natively for the fastest HMR and a usable
debugger. MinIO's console is at <http://localhost:9001> (`flowboard` /
`flowboard-dev-secret`). The all-in-containers production stack is
`docker-compose.yml`; both files are explained in
[docs/docker-guide.md](./docs/docker-guide.md).

## Navigation

**Start at [`.agents/INDEX.md`](./.agents/INDEX.md)** — the master router. Every
folder below has its own `INDEX.md` with one row per file.

```text
.agents/
├── INDEX.md            # master router — read this first
├── docs/               # architecture · coding-standards · design-system · database
│                       # auth · i18n · diagnostics · telemetry · realtime · testing
├── workflows/          # add-api-endpoint · add-view · db-migration
│                       # add-translated-string · add-notification-trigger · add-socket-event
├── checklists/         # project-checklist (the verification backbone) · review-checklist
└── subagents/          # role cards: api-dev · web-dev · reviewer
```

Pick by task, not by curiosity:

| You are about to…                               | Read first                                                                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add or change an HTTP endpoint                  | [workflows/add-api-endpoint.md](./.agents/workflows/add-api-endpoint.md)                                                                                            |
| Change the database schema                      | [workflows/db-migration.md](./.agents/workflows/db-migration.md)                                                                                                    |
| Write any user-facing string                    | [docs/i18n.md](./.agents/docs/i18n.md) + [workflows/add-translated-string.md](./.agents/workflows/add-translated-string.md)                                         |
| Style anything, or add a token                  | [docs/design-system.md](./.agents/docs/design-system.md)                                                                                                            |
| Broadcast something live, or add a notification | [workflows/add-socket-event.md](./.agents/workflows/add-socket-event.md) · [workflows/add-notification-trigger.md](./.agents/workflows/add-notification-trigger.md) |
| Build a new page or view                        | [workflows/add-view.md](./.agents/workflows/add-view.md)                                                                                                            |
| Review someone's change                         | [checklists/review-checklist.md](./.agents/checklists/review-checklist.md)                                                                                          |

Human-facing setup instructions live in **[README.md](./README.md)**, a
screen-by-screen product walkthrough in
[docs/features-tour.md](./docs/features-tour.md), and a beginner Docker
explanation in [docs/docker-guide.md](./docs/docker-guide.md).

## Current state

**The product is complete and the documentation describes what shipped.** All
five views, the task sheet, realtime + presence, notifications, telemetry, the
diagnostics drawer, the Theme Studio, the command palette, and the full
Arabic/RTL catalogue (19 namespaces in each language) are implemented and
covered by 152 Vitest files (2 901 cases: 276 shared-contract, 872 API, 1 753
web) plus the Playwright suite (43 specs in 16 files).

**The API suite needs Postgres.** `apps/api/vitest.config.ts` sets
`DATABASE_URL` itself, pointing at a separate `flowboard_test` database on port
5433; 26 of the API's 41 spec files fail in `beforeAll` without a server there.
See [`.agents/docs/testing.md`](./.agents/docs/testing.md).

Anything a doc in `.agents/` states is meant to be true of the code **today**. If
you find a disagreement, the code is the authority and the doc is the bug — fix
the doc in the same change.
