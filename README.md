# FlowBoard

**FlowBoard is a project-management app for software teams** — the kind of tool
where you file a piece of work as a ticket, drag it across a board as it
progresses, and see at a glance what everyone is working on. If you have used
Jira, Linear, or Trello, you already know the shape of it.

This README is written for someone who has **never touched code**. Follow it top
to bottom and you will have FlowBoard running on your own computer. Every command
is spelled out; you copy and paste it.

---

## What you can do with it

- **Organize work in a hierarchy** — organizations contain teams and projects,
  and a person can belong to several organizations at once.
- **File issues with real issue keys** (`FLOW-142`) as epics, stories, tasks,
  bugs, or subtasks — with priorities, assignees, labels, story points, start and
  due dates, dependencies, watchers, comments with `@mentions`, and file
  attachments.
- **Design your own workflow per project** — your own columns, your own allowed
  moves between them, and work-in-progress limits that stop a column from
  overflowing.
- **See the same work five different ways:**
  - a **Kanban board** you drag cards around,
  - a **backlog** with sprint planning, start, and complete,
  - a **roadmap / Gantt** timeline with draggable bars and dependency arrows,
  - a **table** you can edit inline and export to CSV,
  - a **calendar** you can drag tasks around to reschedule.
- **Watch reports** — burndown, burnup, cumulative flow, velocity, cycle time,
  and workload.
- **Work together live** — changes made by a teammate appear in your browser
  within a second, and you can see who else is looking at the project.
- **Get notified** in-app when you are mentioned, assigned, or something you are
  watching changes.
- **Find anything instantly** — a command palette on `Ctrl+K`, org-wide issue
  search, and a keyboard shortcut for everything (`?` lists them).
- **Make it yours** — a Theme Studio for colours and fonts, light and dark modes,
  and a full **Arabic interface with right-to-left layout**.

**[→ Take the full feature tour](./docs/features-tour.md)** — a screen-by-screen
walkthrough of every surface, including the complete shortcut list.

---

## Screenshots

_This section is the one thing left for a human to finish._

A full set of real screenshots was captured during the build and is sitting in
this session's scratchpad, outside the repository — 17 shots of the English UI
(board, task sheet, backlog, roadmap, table, calendar, dashboard, plus drag,
inline-edit and dependency-arrow close-ups) under `scratchpad/wave3/`, and 13
right-to-left Arabic shots under `scratchpad/wave5-rtl/`.

> **To finish this section:** pick five or six — the board, the roadmap, the task
> sheet, the reports dashboard, and one Arabic/RTL shot make the strongest set —
> copy them into `docs/images/`, and embed them below. They were deliberately
> **not** committed automatically: image binaries are a permanent addition to the
> repository's history, and which ones represent the product is a judgement call,
> not a build step.

---

## Before you start

You need three free tools. Install them in this order.

### 1. Docker Desktop

Docker runs FlowBoard's database and file storage inside tidy containers, so
nothing clutters your computer.

1. Download **Docker Desktop** from
   <https://www.docker.com/products/docker-desktop/> and run the installer.
2. On **Windows**, leave **"Use WSL 2"** enabled when asked. If it offers to
   install a WSL2 update, accept it.
3. **Start Docker Desktop** and wait until its whale icon says it is running.
   Keep it running whenever you use FlowBoard.

### 2. Node.js 22 or newer

Node.js runs the app itself.

1. Download the **LTS** installer from <https://nodejs.org/> and run it.
2. Accept the defaults.

### 3. pnpm

pnpm installs FlowBoard's building blocks. Open a terminal (**PowerShell** on
Windows, **Terminal** on macOS) and run:

```bash
npm install -g pnpm
```

> **Use `pnpm` for everything from here on — never `npm` or `yarn`.** They handle
> this project's structure differently and will break the install.

---

## Get it running

### Step 1 — Get the code

```bash
git clone <this-repository-url>
cd Project-Management
```

### Step 2 — Install the building blocks

```bash
pnpm install
```

This takes a couple of minutes the first time.

### Step 3 — Create your settings file

FlowBoard reads its settings (database address, secret keys, ports) from a file
called `.env`. A ready-made template is included:

```bash
# macOS / Linux / Git Bash
cp .env.example .env
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

The defaults work as-is for local development. Open the file if you are curious —
every line is explained in a comment.

### Step 4 — Start the database and file storage

Make sure Docker Desktop is running, then:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Check that both came up healthy:

```bash
docker compose -f docker-compose.dev.yml ps
```

You should see `flowboard-postgres` and `flowboard-minio` both marked
**healthy**. (A third entry, `flowboard-minio-init`, is supposed to say
`Exited (0)` — it is a one-shot setup job that has finished its work.)

> Seeing `Bind for 0.0.0.0:5432 failed: port is already allocated`? Something
> else on your machine is already using the database port. See
> [docs/docker-guide.md](./docs/docker-guide.md) for the one-line fix.

### Step 5 — Set up the database contents

```bash
pnpm db:migrate   # create the tables
pnpm db:seed      # fill them with a realistic demo project
```

`db:seed` only runs against an **empty** database — it refuses rather than
doubling your demo data. If it stops with "the database already contains users",
use `pnpm db:reset` instead (that wipes everything and re-seeds).

### Step 6 — Start FlowBoard

```bash
pnpm dev
```

Leave that terminal open and go to **<http://localhost:5173>** in your browser.

Sign in with the seeded administrator account:

- **Email:** `admin@flowboard.dev`
- **Password:** `admin1234`

Every other demo account uses `password1234`. Both are printed at the end of
`pnpm db:seed`, along with a row count for each table it filled.

New here? **[Take the feature tour](./docs/features-tour.md)** — it walks through
every screen in the order you would meet them.

---

## Everyday use

| I want to…                      | Command                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| Start working                   | `docker compose -f docker-compose.dev.yml up -d` then `pnpm dev`                          |
| Stop working                    | `Ctrl+C` in the `pnpm dev` terminal, then `docker compose -f docker-compose.dev.yml down` |
| Start over with fresh demo data | `pnpm db:reset`                                                                           |
| See if the database is healthy  | `docker compose -f docker-compose.dev.yml ps`                                             |
| Look at the stored files        | <http://localhost:9001> (user `flowboard`, password `flowboard-dev-secret`)               |

While `pnpm dev` is running, the app rebuilds itself every time a file changes —
just refresh the browser.

---

## Running the tests

FlowBoard ships a full test pyramid. From the repo root:

```bash
pnpm test        # every unit + integration suite (Vitest, across all workspaces)
pnpm build       # compile everything
pnpm lint        # ESLint
pnpm typecheck   # TypeScript, no emit
pnpm e2e         # Playwright browser tests (see below)
```

The first four are the standard gate — all four green is what "done" means here.

The end-to-end suite drives a real browser against a real API and database, so it
needs the containers from Step 4 up. The browsers themselves download once:

```bash
pnpm --filter @flowboard/e2e test:install   # one time
pnpm e2e
```

To run just one workspace's tests: `pnpm --filter @flowboard/web test` (or
`@flowboard/api`, `@flowboard/shared`). Details in
[.agents/docs/testing.md](./.agents/docs/testing.md).

---

## Deploying it

Everything above runs FlowBoard for development, with the database and file
storage in Docker and the app itself running natively. For a real deployment
there is a second compose file — `docker-compose.yml` — that runs the whole stack
in containers: Postgres, MinIO, the API, and the web app behind nginx.

**[docs/docker-guide.md](./docs/docker-guide.md)** explains both files, what each
container does, and how to configure the production one.

---

## Troubleshooting

**"docker: command not found" or "cannot connect to the Docker daemon."**
Docker Desktop is not running. Start it and wait for the whale icon to settle.

**"Port is already allocated."**
Another program owns that port. See [docs/docker-guide.md](./docs/docker-guide.md).

**The page is blank or shows a connection error.**
Check the `pnpm dev` terminal for a red error message. The most common cause is
that Step 4 or Step 5 was skipped.

**Something is badly wrong and you want a clean slate.**

```bash
docker compose -f docker-compose.dev.yml down -v   # deletes the database contents
docker compose -f docker-compose.dev.yml up -d
pnpm db:reset
```

---

## For developers / AI agents

The technical documentation lives elsewhere, and it is thorough:

- **[AGENTS.md](./AGENTS.md)** — the developer guide: stack summary, every
  command, and the map of the documentation tree. **Start here.**
- **[CLAUDE.md](./CLAUDE.md)** — the non-negotiable hard rules (pnpm only, no
  `any`, zod at every boundary, LF endings, i18n for every string).
- **[.agents/INDEX.md](./.agents/INDEX.md)** — the master router into
  architecture, coding standards, the design system, database, auth, i18n,
  diagnostics, telemetry, realtime, and testing docs, plus workflows,
  checklists, and subagent role cards.
- **[docs/features-tour.md](./docs/features-tour.md)** — every surface in the
  product, described at reader level, with the full shortcut list. The fastest
  way to learn what FlowBoard actually does before reading how it does it.
- **[docs/docker-guide.md](./docs/docker-guide.md)** — a beginner-friendly
  explanation of what the containers actually do, plus the production stack.

The stack, in one line: **pnpm + Turborepo monorepo — Vite 7 / React 19 /
Tailwind v4 / TanStack Query on the front end, Express 5 / Drizzle / Postgres 17 /
Socket.IO on the back, with a shared zod contract layer between them.**
