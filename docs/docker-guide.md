# Docker guide (for beginners)

This guide explains what FlowBoard's containers actually do, and how to drive
them. You do not need to understand Docker to use FlowBoard — the
[README](../README.md) gives you the commands — but five minutes here will save
you an hour the first time something goes wrong.

There are **two** stacks, and picking the wrong one is the most common source of
confusion:

| File                     | What it runs                                                   | Use it when                                                  |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------ |
| `docker-compose.dev.yml` | Postgres + MinIO only. Your code runs natively via `pnpm dev`. | **You are writing code.** This is the default.               |
| `docker-compose.yml`     | Everything, including the API and the web app behind nginx.    | You are deploying, or checking that a real deployment works. |

Most of this guide is about the first one; jump to
[Running the production stack](#running-the-production-stack) for the second.

---

## What Docker is doing for you

FlowBoard needs two pieces of infrastructure that are annoying to install by
hand:

| Container              | What it is                             | Why FlowBoard needs it                                                                                                                 |
| ---------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `flowboard-postgres`   | A **PostgreSQL 17** database           | Stores everything: users, organizations, projects, tasks, comments, activity history.                                                  |
| `flowboard-minio`      | **MinIO**, an S3-compatible file store | Stores file attachments on tasks. It speaks the same language as Amazon S3, so the code that works here works unchanged in production. |
| `flowboard-minio-init` | A one-shot setup job                   | Runs once, creates the `flowboard-attachments` storage bucket, and exits. Seeing it as `Exited (0)` is **correct** — it finished.      |

Docker runs each of these in an isolated container, so nothing is installed on
your actual machine and deleting them leaves no trace.

**The API and the web app do NOT run in Docker during development.** They run
natively via `pnpm dev`, because that gives instant reloading and a usable
debugger. This split — infrastructure in Docker, your code native — is called a
_hybrid dev loop_, and it is the recommended way to work on FlowBoard.

---

## The commands

All of them are run from the project folder.

```bash
# Start everything (the -d means "in the background")
docker compose -f docker-compose.dev.yml up -d

# See what is running and whether it is healthy
docker compose -f docker-compose.dev.yml ps

# Watch the logs live (Ctrl+C to stop watching — this does not stop the containers)
docker compose -f docker-compose.dev.yml logs -f

# Watch just one service
docker compose -f docker-compose.dev.yml logs -f postgres

# Stop the containers, KEEPING your data
docker compose -f docker-compose.dev.yml down

# Stop the containers and DELETE all data (fresh start)
docker compose -f docker-compose.dev.yml down -v
```

### Reading `ps` output

```
NAME                   IMAGE                STATUS
flowboard-minio        minio/minio:latest   Up 52 seconds (healthy)
flowboard-minio-init   minio/mc:latest      Exited (0) 20 seconds ago
flowboard-postgres     postgres:17-alpine   Up 21 seconds (healthy)
```

- **`Up … (healthy)`** — good. FlowBoard's compose file defines a _health check_
  for each service, so "healthy" means the service actually answered a real
  request, not just that the process started.
- **`Up … (health: starting)`** — wait a few seconds and check again.
- **`Exited (0)`** on `minio-init` — good, it did its job.
- **`Exited (1)`** or **`Restarting`** on anything else — read the logs.

---

## Your data lives in volumes

The containers themselves are disposable. Your data lives in two named Docker
_volumes_, `flowboard-postgres-data` and `flowboard-minio-data`, which survive
`down`, restarts, and upgrades.

That is why there are two different stop commands:

- `down` removes the containers, **keeps** the volumes → your projects and tasks
  are still there next time.
- `down -v` removes the containers **and the volumes** → everything is gone. Use
  it deliberately, when you want a genuinely clean slate.

---

## Poking at things directly

**MinIO has a web console** at <http://localhost:9001>. Log in with `flowboard` /
`flowboard-dev-secret` and you can browse the `flowboard-attachments` bucket and
see uploaded files.

**Postgres accepts a SQL shell:**

```bash
docker exec -it flowboard-postgres psql -U postgres -d flowboard
```

Then `\dt` lists the tables, and `\q` quits.

---

## Common problems

### "Bind for 0.0.0.0:5432 failed: port is already allocated"

Something else on your machine already owns port 5432 — almost always another
project's Postgres container, or a Postgres you installed directly.

Find the culprit:

```bash
docker ps
```

Then either stop it, or move FlowBoard out of its way by adding two lines to your
`.env`:

```dotenv
POSTGRES_PORT=5433
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/flowboard
```

Both must change together: the first tells Docker which port to publish, the
second tells FlowBoard where to look. Then `up -d` again.

The same idea applies to ports 9000/9001 if MinIO collides with something.

### "Cannot connect to the Docker daemon"

Docker Desktop is not running. Start it and wait for the whale icon to settle.

### The database exists but has no tables

Migrations have not been run yet:

```bash
pnpm db:migrate
pnpm db:seed
```

### `POSTGRES_DB` changes did nothing

The database name is only created on the **first** boot of an empty volume.
Changing it later requires `down -v` (which deletes your data) or creating the
database by hand.

### MinIO says the bucket does not exist

Re-run the one-shot init job:

```bash
docker compose -f docker-compose.dev.yml up -d minio-init
```

It is idempotent (`mc mb --ignore-existing`), so running it again is safe.

---

## Running the production stack

Everything above this line was `docker-compose.dev.yml` — infrastructure only,
with your code running natively. The **production** stack is the other file,
plain `docker-compose.yml`, and it runs _everything_ in containers: Postgres,
MinIO, the API, and nginx serving the built web app.

The two stacks are completely isolated — different project name, different
container names, different volumes, different host ports — so you can leave the
dev stack running while you try the production one.

| Container                   | What it is                  | Notes                                                              |
| --------------------------- | --------------------------- | ------------------------------------------------------------------ |
| `flowboard-prod-postgres`   | PostgreSQL 17               | **Not published to your machine.** Only the API can reach it.      |
| `flowboard-prod-minio`      | MinIO object storage        | Published, because the browser uploads attachments straight to it. |
| `flowboard-prod-minio-init` | One-shot bucket setup       | `Exited (0)` is correct.                                           |
| `flowboard-prod-migrate`    | One-shot database migration | Runs before the API on every `up`. `Exited (0)` is correct.        |
| `flowboard-prod-api`        | Express 5 + Socket.IO       | **Not published either** — nginx is the only route to it.          |
| `flowboard-prod-web`        | nginx + the built SPA       | **This is the one you open**: <http://localhost:8080>.             |

Users only ever talk to nginx. It serves the JavaScript bundle and forwards
`/api` and `/socket.io` to the API over Docker's private network, so the browser
sees a single origin — no CORS to configure, no second certificate, no separate
websocket host.

---

### Before you start

- **Docker Desktop (or Docker Engine) with Compose v2.** Check with
  `docker compose version`.
- **About 2 GB of free disk** for the two images plus the base images they pull.
- **Windows only — check your line endings first.** The images are built on
  Linux, where a `\r` at the end of a shell script or an entrypoint is a runtime
  failure, not a warning. The repo's `.gitattributes` forces LF, but a
  misconfigured Git can still check files out with CRLF:

  ```bash
  git config core.autocrlf false   # then re-clone, or: git rm --cached -r . && git reset --hard
  ```

  The symptom if you get this wrong is a container that exits immediately with
  something like `exec /docker-entrypoint.sh: no such file or directory`.

---

### Step 1 — write the environment file

The production stack refuses to start without real secrets. That is deliberate:
an example password that silently reaches production would sign tokens anyone
could forge.

Generate four values, each one separately:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Put them in a file next to `docker-compose.yml`:

```dotenv
POSTGRES_PASSWORD=<generated>
JWT_SECRET=<generated>
JWT_REFRESH_SECRET=<generated — must DIFFER from JWT_SECRET>
S3_SECRET_KEY=<generated>
WEB_ORIGIN=http://localhost:8080
```

Those five are the whole required set. Everything else has a working default;
see the **PRODUCTION** block at the bottom of
[`.env.example`](../.env.example) for the full list.

Two things that bite people:

- **`WEB_ORIGIN` must be the URL you type in the browser** — scheme, host and
  port, no trailing slash. It is the permission list for both API requests and
  the realtime connection. Get it wrong and the login page loads perfectly, then
  every action fails with a network error nobody can explain.
- **`POSTGRES_PASSWORD` becomes part of a URL.** If yours contains `@ : / ? #`,
  percent-encode it. The `base64url` generator above never produces those
  characters, which is why it is the recommended one.

**Which file?** On a server, name it `.env` and you are done. On a development
machine you already have a `.env` full of _development_ values — and Compose
does not merge two files, so keep production values in their own file and name
it every time:

```bash
docker compose --env-file .env.production up -d
```

Every command below assumes a plain `.env`; add `--env-file .env.production` to
each one if you went the second route.

---

### Step 2 — build the images

```bash
docker compose build
```

First run takes a few minutes (it installs the whole workspace and compiles both
apps); later runs reuse cached layers and are much faster. You end up with two
images:

```
flowboard-prod-api    200MB
flowboard-prod-web     65MB
```

---

### Step 3 — start it

```bash
docker compose up -d
```

You do not have to sequence anything by hand — Compose enforces the order, and
watching it do so is the clearest explanation of how the stack fits together:

1. **`postgres` and `minio` start** and are polled until their health checks
   pass. Nothing that needs them starts before that.
2. **`minio-init` runs**, creates the attachments bucket, exits 0.
3. **`migrate` runs**, applies any pending database migrations, exits 0. It is
   idempotent: on an unchanged deploy it prints `database already up to date`.
4. **`api` starts**, but only because migrate exited _successfully_. A failed
   migration leaves the API stopped rather than serving errors against a
   half-migrated schema.
5. **`web` starts** once the API reports healthy.

Expect roughly this:

```
 Container flowboard-prod-postgres     Healthy
 Container flowboard-prod-minio        Healthy
 Container flowboard-prod-minio-init   Exited
 Container flowboard-prod-migrate      Exited
 Container flowboard-prod-api          Healthy
 Container flowboard-prod-web          Started
```

---

### Step 4 — check it worked

```bash
docker compose ps
```

```
NAME                      STATUS                    PORTS
flowboard-prod-api        Up 10 seconds (healthy)   4000/tcp
flowboard-prod-minio      Up 16 seconds (healthy)   0.0.0.0:9200->9200/tcp, 127.0.0.1:9201->9201/tcp
flowboard-prod-postgres   Up 16 seconds (healthy)   5432/tcp
flowboard-prod-web        Up 4 seconds (healthy)    0.0.0.0:8080->80/tcp
```

Note what is _missing_ from that list: Postgres shows `5432/tcp` with no
`0.0.0.0->` in front of it, and the API shows `4000/tcp` the same way. That
means the port exists inside Docker's network but is **not** reachable from your
machine or the internet. Only nginx (8080) and MinIO (9200) are.

Then ask the API itself, through nginx:

```bash
curl http://localhost:8080/api/health
```

```json
{ "success": true, "data": { "status": "ok", "uptimeSeconds": 16, "db": "ok" } }
```

`"db": "ok"` is the part that matters — the health check runs a real query, so a
healthy answer means the API can actually serve requests, not merely that Node
started.

Finally open <http://localhost:8080>. You should get the login page.

---

### Step 5 — demo data (optional, never on a real deployment)

The seed is **never** run automatically. It creates a fictional company with
nine users whose passwords are printed in this guide, which is exactly what you
do not want on a server. Run it by hand, once, on a database you are happy to
throw away:

```bash
docker compose run --rm --no-deps api node dist/scripts/seed.js
```

It prints a summary and the demo credentials:

```
✔ seed complete
  users 9 · organizations 1 · projects 2 · tasks 61 · comments 34 · activity 210
  sign in as admin@flowboard.dev / admin1234  (global admin)
  every other account uses password1234
```

The seed refuses to run against a database that already has users. To start
over: `docker compose run --rm --no-deps api node dist/scripts/reset.js` (which
**drops every table**), then migrate and seed again.

---

### Which ports are published

| Port   | Service         | Who needs it                                                      |
| ------ | --------------- | ----------------------------------------------------------------- |
| `8080` | nginx / the app | **Everyone.** This is FlowBoard.                                  |
| `9200` | MinIO S3 API    | Browsers, for attachment upload and download.                     |
| `9201` | MinIO console   | You. Bound to `127.0.0.1`, so it is never reachable from off-box. |

They were chosen to stay out of the dev stack's way (`5173` Vite, `4000` API,
`5432` Postgres, `9000`/`9001` MinIO), so both stacks can run at once.

**Why attachments need a published MinIO port.** The API never carries file
bytes: it hands the browser a signed, time-limited URL and the browser talks to
storage directly. That keeps large uploads off the API entirely — but it means
the signed URL has to be an address _the browser can reach_. An S3 signature
covers the host and the port, so the same address must also work from inside the
API container. `docker-compose.yml` arranges that by giving MinIO the network
alias `flowboard.localhost`: inside Docker the name resolves to the container,
and in a browser it resolves to your own machine (browsers send any
`*.localhost` name to loopback), both on port 9200. That is also why the port
mapping reads `9200:9200` and not `9200:9000` — the numbers must match, or every
signature fails.

---

### Updating a deployment

```bash
git pull
docker compose up -d --build
```

`--build` is not optional. The web app's configuration is compiled _into_ the
JavaScript bundle at build time, so a restart alone ships the old settings. The
`migrate` service re-runs automatically as part of `up`, before the new API
starts.

To roll only the database forward, without touching the running app:

```bash
docker compose run --rm migrate
```

---

### Backing up

Two things hold state, and neither one lives in a container:

**The database.** `pg_dump` writes a single restorable file:

```bash
docker compose exec -T postgres pg_dump -U flowboard flowboard | gzip > flowboard-$(date +%F).sql.gz
```

Restore into an empty database:

```bash
gunzip -c flowboard-2026-08-28.sql.gz | docker compose exec -T postgres psql -U flowboard flowboard
```

**The attachments.** They are in the `flowboard-prod_minio-data` volume. Copy it
out with a throwaway container:

```bash
docker run --rm -v flowboard-prod_minio-data:/data -v "$PWD:/backup" alpine \
  tar czf /backup/minio-$(date +%F).tar.gz -C /data .
```

A database backup without the matching attachment backup restores to a board
whose files all 404, so take them together.

---

### Putting HTTPS in front

nginx in the `web` container speaks plain HTTP on purpose — certificates,
renewal and redirects belong to one layer, and that layer should be in front of
the whole stack. Point Caddy, Traefik, a Cloudflare tunnel, or your existing
reverse proxy at `localhost:8080`, then:

- set `WEB_ORIGIN=https://flowboard.example.com` (the **public** URL),
- put a TLS terminator in front of the MinIO port too and set
  `S3_PUBLIC_HOST=storage.example.com` with `S3_SCHEME=https` and `S3_PORT=443`,
- rebuild: `docker compose up -d --build`.

---

### Common problems (production stack)

| Symptom                                                                                               | Cause and fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error while interpolating services.api.environment: required variable POSTGRES_PASSWORD is missing`  | A required secret is not set. Compose names the offending variable. See Step 1 — and if you keep production values in `.env.production`, remember `--env-file .env.production` on **every** command, including `build` and `logs`.                                                                                                                                                                                                                                                    |
| `Bind for 0.0.0.0:8080 failed: port is already allocated`                                             | Something else owns 8080. Set `WEB_PORT=8081` in your env file, and change `WEB_ORIGIN` to match — they must always agree.                                                                                                                                                                                                                                                                                                                                                            |
| Port `5432` is taken by another project                                                               | Cannot affect this stack: the production Postgres is **not published**. (The dev stack does publish it, which is where you hit this — typically against another project's `gamedash-postgres` container. Fix it there with `POSTGRES_PORT`, as described earlier in this guide.)                                                                                                                                                                                                      |
| `flowboard-prod-api` never becomes healthy; logs show `Invalid environment configuration:` and a list | The API validates its whole environment at boot and exits rather than start half-configured. The listed lines are the exact problems — a missing `JWT_SECRET`, a `WEB_ORIGIN` that is not a URL, a `DATABASE_URL` that will not parse (an unescaped `@` or `#` in the password), an `S3_ENDPOINT` without a scheme, a `LOG_LEVEL` that is not one of `fatal error warn info debug trace`, or a TTL not written like `15m` / `30d`. Fix the env file and `docker compose up -d` again. |
| `dependency failed to start: container flowboard-prod-migrate exited (1)`                             | A migration failed, and the API was correctly held back. `docker compose logs migrate` has the SQL error. The database is untouched by the failed step — fix the migration, rebuild, retry.                                                                                                                                                                                                                                                                                           |
| Login page loads, then every action fails with a network error                                        | `WEB_ORIGIN` does not match the URL in the address bar. `http://localhost:8080` and `http://127.0.0.1:8080` are **different origins**; so is the same host with a different port. Fix it and `docker compose up -d`.                                                                                                                                                                                                                                                                  |
| Realtime never connects (the board does not update live)                                              | Same cause as above — the realtime handshake checks the same origin. Confirm with `docker compose logs web`: a working connection logs `"GET /socket.io/?EIO=4&transport=websocket HTTP/1.1" 101`. A `101` is the websocket upgrade; anything else (`400`, `403`) is the handshake being rejected.                                                                                                                                                                                    |
| Attachments fail with `SignatureDoesNotMatch`                                                         | The address the browser used is not the one the API signed. Either `S3_PORT` was changed on only one side of the port mapping, or `S3_PUBLIC_HOST` does not resolve to this machine from the browser. Both halves of the mapping must be the same number.                                                                                                                                                                                                                             |
| A container exits instantly with `no such file or directory` on a script                              | CRLF line endings. See **Before you start** — re-check out the repo with `core.autocrlf false` and rebuild.                                                                                                                                                                                                                                                                                                                                                                           |
| Code changes do not appear after `up -d`                                                              | You need `--build`. The web bundle is compiled into the image.                                                                                                                                                                                                                                                                                                                                                                                                                        |

---

### Stopping and cleaning up

```bash
docker compose down       # stop, KEEP the database and attachments
docker compose down -v    # stop and DELETE both volumes — irreversible
```

`down` leaves the images in place, so the next `up -d` is immediate.

---

Back to the [README](../README.md) · developer docs start at
[AGENTS.md](../AGENTS.md).
