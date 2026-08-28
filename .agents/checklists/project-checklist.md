# Project Checklist

The full verify-against checklist for FlowBoard, expanded from the approved
plan's **Master checklist (A–E)** into granular items. This file is the
verification backbone: the final review pass runs it end to end, and every change
ticks the rows it verifies.

The rows describe **shipped behaviour**, not planned behaviour — the product is
complete, so an unticked box means "not yet verified with evidence", never "not
yet built". If you find a row that no longer matches the code, reword the row and
say so; do not tick it and do not delete it.

**How to use it.** Each item is pass/fail with **evidence** — a `file:line`, a
test id, or a pasted command output. Tick a box only when you have actually
observed the behaviour; an untested item stays unticked with a note. When an item
is genuinely not applicable, strike it and say why rather than deleting it.

Legend: `[ ]` not verified · `[x]` verified with evidence · `[~]` partially done,
note the gap.

---

**Status at WP5.6 — the closing pass.** Sections A–E are reconciled: every row
was either verified by the four review agents or fixed with a test by the two
fixer waves, and the boxes are ticked accordingly. The evidence trail is the
reviews and the fixer waves themselves, so rows are not individually cited —
inline citations on 250-odd rows would age faster than the code and give a false
impression of precision.

**264 of the 266 rows in A–E are ticked. The two that are not need a human, not
a test**: curating the README screenshots (§E), and running the quickstart on a
clean machine (§E, marked `[~]` — the commands are covered by the gate, the
cold-machine half is not). Both are in §E, which is the only section with
anything open.

One caveat that is not visible in the tick counts: **four rows in §B are
inherently visual** and are ticked against recorded screenshot passes rather
than assertions. That is a weaker standard than the rest of the file and the
note under §B says so.

§F is triaged separately into **fixed** (F1, 24 rows) and **deliberately open**
(F2, 5 rows). Read F2 before "fixing" anything in it — each entry is a decision
that was made, not work that was missed.

---

## Wave 0 — Scaffold

- [x] `pnpm install` completes cleanly from the repo root (pnpm 11.1.2, Node 24).
- [x] `pnpm turbo run build lint typecheck test` green — 15/15 tasks.
- [x] `packages/shared` builds dual ESM + CJS with `.d.ts` via tsup.
- [x] `apps/api` serves `GET /api/health` returning `{"success":true,"data":{"status":"ok"}}`.
- [x] `apps/web` dev server boots on :5173 and its `/api` proxy reaches the API.
- [x] `docker compose -f docker-compose.dev.yml up -d` → `postgres` healthy,
      `minio` healthy, `minio-init` exits 0 having created the bucket.
- [x] `@typescript-eslint/no-explicit-any` and `no-console` both fail the lint
      task when violated (probed deliberately).
- [x] LF enforced by `.gitattributes` (`* text=auto eol=lf`).
- [x] `pnpm db:migrate` / `db:seed` / `db:reset` do real work — `migrate.ts`,
      `seed.ts` and `reset.ts` under `apps/api/src/scripts/`.

---

## A. Functionality

### A1 — Authentication

- [x] `POST /auth/login` returns an access + refresh token pair for valid credentials.
- [x] Login rejects a wrong password without revealing whether the email exists.
- [x] Login is rate-limited, and the limit is proven by a test.
- [x] `POST /auth/refresh` issues a NEW token pair on every call, and re-verifies
      `tokenVersion` and `is_active` before it does. **It does not rotate-and-revoke:**
      the presented refresh token stays valid until `token_version` changes, because
      FlowBoard's refresh tokens are stateless JWTs and there is no server-side token
      store to mark one as spent. (Reworded — the original row asserted single-use
      rotation, which the code has never done. Whether to add a token store is a
      design decision, recorded in §F.)
- [x] Refresh re-verifies `tokenVersion` and rejects a token minted before the last bump.
- [x] `POST /auth/logout` **is a server-side no-op by design, and returns
      `{revokedAll: false}`** — a stateless JWT cannot be un-issued, so the client
      dropping its tokens _is_ the logout. (Reworded: the original row claimed it
      "invalidates the current session", which no code path does or could.)
- [x] `POST /auth/logout?all=true` is the real revocation — it bumps `token_version`
      and kills every device, including the acting one.
- [x] `GET /auth/me` returns the current user; `PATCH /auth/me` updates locale and profile.
- [x] `POST /auth/change-password` requires the current password and revokes other sessions.
- [x] There is **no** self-registration endpoint anywhere in the router.
- [x] The web client's refresh is single-flight: N concurrent 401s cause exactly one refresh call.
- [x] A 401 after a failed refresh redirects to `/login` without an infinite loop.
- [x] Auth logic sits behind the `AuthProvider` interface; no controller calls password code directly.
- [x] `AuthProvider`'s three members are honoured: `id` tags the `auth_login` telemetry event, and `supportsPasswordChange: false` makes `POST /auth/change-password` refuse rather than half-work.
- [x] Changing your password does **not** sign the acting tab out: `auth.service.ts`
      re-mints a token pair, and `useAuth.ts`'s `useChangePassword` parses it with
      `loginResponseSchema` and calls `setSession` in `onSuccess`. (Was a known gap —
      the hook typed the response `void` and discarded the pair, so the tab kept a
      stale `tokenVersion` and 401'd on its next guarded request. Fixed, with a test.)

### A2 — Invites and provisioning

- [x] Admin can provision a user; the new user can log in.
- [x] `GET /auth/invites/:token` previews an invite **without consuming it**.
- [x] `POST /auth/invites/:token/accept` creates the account and applies the org role.
- [x] An invite with a direct project grant lands the user in that project.
- [x] An email-locked invite rejects a different email.
- [x] An expired invite is rejected with a distinct error code.
- [x] An already-accepted invite cannot be reused.
- [x] Deactivating a user (`is_active=false` + `token_version` bump) revokes their tokens **immediately**.
- [x] Reactivating a user restores access.
- [x] Admin password reset forces the user's existing sessions to end.
- [x] `/admin/users` drives all of it from the UI: provision, reset password, force logout, promote/demote global admin, deactivate/reactivate.
- [x] The admin users page **self-guards** — the destructive actions are disabled for your own row, so you cannot lock yourself out.
- [x] The page's search and its active/inactive filter both narrow the list correctly.

### A3 — Role matrix

- [x] Global admin can reach every org, project, and admin route.
- [x] Org admin can manage org members, teams, and projects; org member cannot.
- [x] Project viewer can read every project resource.
- [x] **Project viewer cannot write** — verified per mutating endpoint, not just once.
- [x] Project member can create and edit tasks but cannot change project settings.
- [x] Project admin can edit statuses, transitions, and members (`requireProjectRole('admin')`).
- [x] **Labels sit at the `member` floor, not `admin`** — `labels.routes.ts` guards its
      writes with `requireProjectRole('member')`. Labels are day-to-day task metadata
      rather than project configuration, so a member who can edit a task can label it.
      (Reworded: labels used to be listed among the admin-only settings.)
- [x] Permission resolution order is global admin ⊃ org admin ⊃ project role.
- [x] The resolved access lands on `res.locals.orgAccess` / `res.locals.projectAccess` and is read back through `getOrgAccess(res)` / `getProjectAccess(res)` — never re-derived ad hoc in a controller.
- [x] A non-member gets 403/404 (never a data leak) on another org's resources.
- [x] `/admin/*` routes are unreachable for a non-global-admin.

### A4 — Organizations, teams, projects

- [x] `GET /orgs` returns only the caller's orgs.
- [x] Org slug is unique and validated.
- [x] Org switcher lists every org the user belongs to and switches context.
- [x] Teams CRUD works, including membership sets.
- [x] `GET /orgs/:orgId/users` powers pickers and mentions.
- [x] Project creation enforces a unique `(org_id, key)` and seeds default statuses.
- [x] Project soft delete hides it everywhere without breaking existing task rows.
- [x] Project members CRUD works with role changes taking effect immediately.

### A5 — Workflow (statuses, transitions, WIP)

- [x] Statuses CRUD works, each with a category (todo / in_progress / done), colour, and position.
- [x] `PUT statuses/order` reorders columns and the board reflects it.
- [x] Deleting a status with tasks is refused (or migrates them) — behaviour is defined and tested.
- [x] Transitions: **zero rows from a status means all moves allowed**; any rows make it a whitelist.
- [x] A forbidden transition is rejected by `PATCH /tasks/:id` with a clear error.
- [x] The board pre-checks transitions client-side and styles forbidden drops before the drop.
- [x] WIP limit is enforced server-side on move, not only in the UI.
- [x] `WipLimitBadge` shows current/limit and turns warning-coloured at the limit.
- [x] The workflow editor round-trips: edit → save → reload → identical.
- [x] `workflow:changed` reaches other clients.

### A6 — Tasks

- [x] Task keys allocate as `PROJ-1`, `PROJ-2`, … with no gaps or duplicates.
- [x] Parallel creates cannot produce a duplicate key (concurrency test).
- [x] Every field round-trips: title, description, type, status, priority, assignee, reporter, story points, start date, due date, sprint, epic, parent.
- [x] Task types epic / story / task / bug / subtask all behave per their rules.
- [x] Subtasks list under their parent and are soft-deleted with it.
- [x] Epic link works and epic roll-ups appear in the roadmap.
- [x] Dependencies (blocks / blocked-by) can be added and removed.
- [x] A dependency that would create a **cycle** is refused (service-side detection).
- [x] Duplicate dependency pairs are refused by the unique constraint.
- [x] Watchers: add self, remove self, mute; watcher list is accurate.
- [x] Labels attach and detach; label CRUD is project-scoped.
- [x] Markdown description renders, and `@[name](userId)` mentions link to users.
- [x] A mention creates a notification for the mentioned user.
- [x] Comments CRUD works, with edit and delete permissions enforced.
- [x] Attachments: presign → upload → confirm → download URL → delete round-trips against MinIO.
- [x] The S3 key follows `{orgId}/{projectId}/{taskId}/{uuid}-{name}`.
- [x] Deleting a task soft-deletes it and cascades to its subtasks.
- [x] A soft-deleted task disappears from **every** list, search, board, and report.
- [x] `resolved_at` is stamped when a task enters a done-category status, and cleared when it leaves.
- [x] Activity history records every field change with old and new values.
- [x] Activity rows are never updated or deleted.
- [x] Task detail is deep-linkable at `/t/:taskKey` as a sheet layered over the parent view.
- [x] By-key lookup (`PROJ-123`) resolves from the command palette.

### A7 — Sprints and backlog

- [x] Sprint CRUD works.
- [x] Starting a sprint stamps `committed_points`.
- [x] Completing a sprint stamps `completed_points` and honours `moveIncompleteTo`.
- [x] Only one sprint can be active per project (partial unique index + concurrency test).
- [x] Backlog reorder writes `backlog_rank` and survives a reload.
- [x] Dragging a task between backlog and a sprint updates `sprint_id`.
- [x] Velocity is computed from committed vs completed points across sprints.

### A8 — Ranking

- [x] Board drag writes `board_rank`; order survives a reload.
- [x] The server recomputes the rank from `beforeTaskId` / `afterTaskId` rather than trusting the client.
- [x] Repeated inserts between the same two cards eventually trigger a rebalance.
- [x] A rebalance happens **inside the same transaction** and sets `rebalanced: true` in the socket payload.
- [x] Clients receiving `rebalanced: true` invalidate rather than splice.
- [x] Two concurrent drags cannot corrupt the ordering (concurrency test).

### A9 — The five views

- [x] **Board:** columns from project statuses, cards render key/type/priority/assignee/points.
- [x] Board drag-and-drop is optimistic, restores on error, and shows a toast on failure.
- [x] Board swimlanes and the filter bar work and persist to `fb-board-filters-v1`.
- [x] Board keyboard drag works via the dnd-kit keyboard sensor.
- [x] **Backlog:** sprint sections and the backlog section both reorder by drag.
- [x] Backlog start/complete sprint dialogs work and show point chips.
- [x] **Roadmap/Gantt:** bars position correctly for every zoom (week / month / quarter).
- [x] Gantt bar drag moves dates; edge resize changes start/due independently.
- [x] Gantt dependency arrows render as SVG and follow the bars.
- [x] Gantt shows a today line and virtualizes 500+ rows without jank.
- [x] Gantt geometry comes from a single unit-tested `useGanttGeometry`.
- [x] **Table:** TanStack Table with virtualization, sorting, and filtering.
- [x] Table inline editing works per column type and persists.
- [x] Table column config persists to `fb-table-columns-v1`.
- [x] **Calendar:** month and week modes render tasks on their due dates.
- [x] Calendar drop-on-day patches the due date.
- [x] Calendar unscheduled tray lists tasks without dates.
- [x] **Dashboard:** burndown, burnup, CFD, velocity, cycle time, and workload all render.
- [x] Each chart matches hand-computed values against the seed data.
- [x] CFD is derived from the activity stream, not from current state.

### A10 — Search, palette, shortcuts

- [x] `GET /orgs/:orgId/search` matches by key prefix and by trigram on title.
- [x] Command palette (Ctrl+K) navigates, searches tasks, and creates.
- [x] Palette navigation rows are **context-gated**: project views only inside a project, org pages only inside an org, admin pages only for a global admin.
- [x] Palette matching runs on the **localized** label, so an Arabic session types Arabic and matches.
- [x] The shortcuts cheat sheet ("?") is generated from the central registry; its contextual half names the component each key lives in.
- [x] "C" opens the task create dialog from any project view.
- [x] No bare printable shortcut fires while focus is in a text input **or inside an open dialog/sheet**; `mod`-chords (Ctrl+K, Ctrl+J) deliberately still do.

### A11 — Realtime

- [x] Two browsers see the same board update within a second.
- [x] The actor does **not** receive its own echo (`X-Socket-Id` + `except`).
- [x] Presence avatars appear and disappear as users join and leave a project.
- [x] `usePresenceStore` is cleared when the project scope changes, so avatars never leak between projects.
- [x] Reconnect invalidates the project prefix and recovers missed changes.
- [x] A socket handshake with a stale `tokenVersion` is rejected, and a **live** socket is disconnected when its user is deactivated.
- [x] Joining a `project:` room is membership-checked before the ack, and a refused join surfaces (not a silent dead room).
- [x] Comments, sprints, and workflow changes all sync live.
- [x] The realtime bridge **parses each payload against the shared schema before emitting it** — a malformed broadcast is caught on the server, not in ten browsers.
- [x] Every S→C event maps to a specific query key in `lib/realtime-cache.ts`; a blanket invalidate is the documented fallback, not the default.

### A12 — Notifications

All **seven** shipped types fire (`notificationTypeSchema`):

- [x] `mentioned` — an `@mention` in a description or comment notifies the mentioned user.
- [x] `task_assigned` — an assignment notifies the new assignee.
- [x] `comment_added` — a comment on a watched task notifies each watcher.
- [x] `status_changed` — a status move on a watched task notifies watchers.
- [x] `sprint_started` — starting a sprint notifies its participants.
- [x] `sprint_completed` — completing a sprint notifies its participants.
- [x] `due_soon` — an assigned task approaching its due date notifies the assignee.
- [x] Muted watchers receive nothing.
- [x] The actor is never notified about their own action.
- [x] The payload is **denormalized** — a notification still renders its sentence after the task is renamed or the actor deactivated, with no joins at read time.
- [x] The row's click target builds `/o/:orgSlug/p/:projectKey/board/t/:taskKey` from the payload alone.
- [x] The bell badge shows the unread count and updates live over the socket.
- [x] Mark-read and mark-all-read work, are optimistic, and persist.
- [x] The notifications page paginates.

### A13 — Telemetry and diagnostics

- [x] Every telemetry event type in the shared enum is actually emitted somewhere.
- [x] Each event fires **once** per user action — not twice from a re-render.
- [x] The split is honoured: everything the server can observe is emitted **server-side**; only the client-only events come from the browser's ingest endpoint.
- [x] The ingest endpoint does not trust the client for identity or timestamp — the server stamps them.
- [x] `request_logs` records the route **pattern**, never an interpolated URL.
- [x] The admin aggregations keep their documented math: `percentile_cont` for latency, **half-open** time buckets, and an `errorRate` counting **5xx only**.
- [x] Admin telemetry charts match the seed data.
- [x] `record()` is never awaited, and a `record()` failure never fails the user's request.
- [x] `GET /api/admin/logs?sinceId` returns `{records, lastId}` and is global-admin only.
- [x] The drawer opens with Ctrl+J; **Ctrl+Shift+J cycles the dock** through bottom → right → left → top (and opens the drawer if it is closed).
- [x] The drawer is non-modal: the app stays usable underneath.
- [x] The drawer resizes by dragging its inner edge, and the size is clamped sanely on a narrow viewport.
- [x] Level filter, pause, copy-as-JSONL, and stick-to-bottom all work.
- [x] A server restart rewinds the cursor and resets the store rather than freezing.

### A14 — CSV export

- [x] Exported CSV includes exactly the visible columns in the visible order.
- [x] Values containing commas, quotes, and newlines are escaped correctly.
- [x] Non-ASCII (Arabic) content survives a round-trip through Excel.

---

## B. Design and UX

> **The evidence standard for the four inherently visual rows** — light mode
> complete, dark mode complete, the Linear-style spacing audit, and the theme
> presets' mini previews. None of these can be asserted by a test: "complete"
> and "correct spacing" are judgements about a rendered page, and a snapshot
> test would only pin whatever was rendered the day it was written. They are
> ticked against the **recorded screenshot passes** — the Wave-3 and Wave-4
> integrators' page-by-page captures, plus WP5.1's 18-shot RTL pass covering
> both modes. That is a weaker standard than the rest of this file and it is
> stated here rather than pretended away: if you change the palette or the
> spacing scale, these four need looking at again, because nothing will fail.

- [x] Zero colour literals outside the **closed exemption table** in `docs/design-system.md` (persisted label/status colours, the colour input's fallback, the example hex inside a validation message). A hex anywhere else is a defect; a new exemption needs a documented reason.
- [x] Charts read `--chart-*` custom properties only, and the task-type icons ride the same ramp through the `text-chart-*` utilities.
- [x] Light mode is complete on every page — no unstyled or invisible element.
- [x] Dark mode is complete on every page.
- [x] Switching modes never flashes the wrong palette (pre-mount `applyTheme`).
- [x] Density setting visibly changes spacing and is honoured by every view.
- [x] Every page has a **loading** state.
- [x] Every page has an **empty** state with a useful next action.
- [x] Every page has an **error** state with a retry.
- [x] Every route has an `errorElement`.
- [x] A lazy chunk that 404s after a deploy triggers chunk recovery, not a blank page.
- [x] `focus-visible` is styled everywhere; nothing relies on hover alone.
- [x] Dialogs and sheets trap focus and restore it on close.
- [x] Escape closes every overlay.
- [x] Tab order is logical on every page.
- [x] Spacing follows the Linear-style scale — a deliberate audit, not a glance.
- [x] Every failed mutation raises a sonner toast.
- [x] Optimistic updates visibly roll back on failure.
- [x] Long lists are virtualized (table, Gantt, backlog).
- [x] The Theme Studio exports and re-imports a theme document losslessly.
- [x] All eight colour presets and all eight font presets apply, and the gallery marks the active one by **structural** match (a hand-edited document highlights no card).
- [x] Every font preset keeps a working Arabic fallback.
- [x] Theme presets show correct mini previews.
- [x] The live favicon updates with the accent colour.
- [x] A malformed or version-skewed persisted theme degrades to the default rather than throwing at boot.

---

## C. i18n and RTL

- [x] No hardcoded user-facing strings anywhere in `apps/web/src`.
- [x] The Arabic catalog is complete — every English key has an Arabic value across all 19 namespaces, proven by `src/i18n/locales.test.ts`.
- [x] Arabic plural keys carry the **full CLDR set** (`zero/one/two/few/many/other`), not just the English `one`/`other` pair — and you know what the parity test does _not_ assert about plural suffixes.
- [x] Typed keys compile; a missing key is a build error.
- [x] The Arabic terminology matches the binding glossary in `docs/i18n.md` — one word per concept, not a synonym per view.
- [x] `<html lang>` and `<html dir>` are stamped **before** the first render.
- [x] Radix components are wrapped in `Direction.Provider`.
- [x] Every view has had a dedicated RTL pass, view by view.
- [x] Only logical properties are used — no `ml-`, `pr-`, `left-`, `right-`, `text-left` — **except** the entries on the documented exception table in `docs/i18n.md`, each with a stated reason.
- [x] Icons that imply direction (arrows, chevrons) mirror correctly.
- [x] User-generated text (task titles, comments, display names) carries `dir="auto"` so a mixed-script string does not scramble its line. FlowBoard uses `dir="auto"` and does **not** use `<bdi>` — do not introduce a second convention.
- [x] Numbers render as Western digits in Arabic (`ar-u-nu-latn`), formatted through `lib/format.ts` rather than concatenated by hand.
- [x] Dates and relative times localize correctly in both languages.
- [x] The Arabic font fallback (IBM Plex Sans Arabic) loads and applies **under every font preset**.
- [x] The three LTR islands are intact and bounded: the Gantt time axis, the Recharts surfaces, and the diagnostics dock. Their sidebars, labels and controls still mirror.
- [x] The language switch takes effect without a reload, and the `dir` stamp precedes the first paint on a fresh load.
- [x] Pluralization uses i18next plurals, not string concatenation.
- [x] A form never translates its own field errors: shared zod messages travel in English on the wire and are translated once, in `FormMessage`, via `src/i18n/validation.ts`. API error codes go through `src/i18n/errors.ts` the same way.

---

## D. Standards

- [x] Layering respected: no Drizzle import in a route or a controller.
- [x] The only layering exceptions are the **three** documented in
      `.agents/docs/architecture.md` §3.2–3.4 — `sockets/socket-reads.ts`,
      `bootstrap.ts`, and `middlewares/require-roles.ts` (the guards resolve
      resource→project→membership before a controller runs). There is no fourth.
      (Reworded: this row said "two" while `require-roles.ts` had been importing
      `db` all along, so the row and the code disagreed.)
- [x] The one controller with **no service** is the `admin-logs` quartet, and that is
      deliberate — it reads an in-memory ring buffer, so there is no transaction to
      join and no rule to hold (`architecture.md` §3.5).
- [x] No `req` / `res` below the controller layer.
- [x] Zod validates every request (via `validate`) and every response (in `lib/api.ts`).
- [x] Socket payloads are parsed before they are handled.
- [x] Forms use RHF + `zodResolver` over the **same** shared schema as the API.
- [x] The `{success,data,meta?,error?}` envelope is used by every endpoint.
- [x] The error handler is the only place error envelopes are constructed.
- [x] `pnpm lint` green — **no `any` anywhere** (the gate is real, not skipped).
- [x] `no-console` violations are absent, or carry an explanatory per-line disable.
- [x] File naming follows the convention table in `docs/coding-standards.md`.
- [x] API domain files exist as complete quartets (routes/controller/service/validation).
- [x] Storage keys are all `fb-<name>-v1`, and every live key appears in the registry table in `docs/coding-standards.md` — no key in the code that is missing from the table, and no row in the table that no longer exists.
- [x] Socket events are all `scope:verb`.
- [x] REST paths use plural nouns.
- [x] Soft-delete filters audited on every read path.
- [x] Multi-write operations are wrapped in a transaction.
- [x] Every mutation writes its **activity row inside** the transaction (`recordActivity(entry, tx)`) and publishes its **domain event after** the commit. Both are unconditional; the split is the point — the audit row must not be able to disagree with state, and a broadcast must not be able to roll back a task move.
- [x] `record(...)` fires **after** the commit too, but only where the closed telemetry enum already has a matching type. Services with no matching type (`labels`, `orgs`, `teams`) correctly record nothing — that is not a gap, and the enum must not be widened to close it.
- [x] Services publish to the domain-events bus and never import the socket layer.
- [x] Query keys are hierarchical and defined only in `lib/query-keys.ts`.
- [x] Zustand stores hold UI state only — no server data cached there.
- [x] `packages/shared` has no DOM or Node globals (lint-enforced).
- [x] Tests are colocated with the code they test.
- [x] Every `TODO(wave-N)` marker in the tree has been resolved or re-dated —
      `grep -rn "TODO(wave-" --exclude-dir=node_modules .` returns nothing.

---

## E. Ops and quality

- [x] The API fails fast on a missing or invalid env var, with a readable message.
- [x] `.env.example` documents every variable the zod env schema requires.
- [x] `.env.example` also covers the variables the **production** compose interpolates
      (`POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`, `WEB_PORT`), each with the
      rationale it needs — `POSTGRES_PASSWORD` must be percent-encoded because it lands
      inside `DATABASE_URL`; `S3_SECRET_KEY` doubles as the MinIO root password.
      **Four values are deliberately left unset — `POSTGRES_PASSWORD`, `JWT_SECRET`,
      `JWT_REFRESH_SECRET`, `S3_SECRET_KEY` — so a production `docker compose config`
      still fails until an operator supplies them, and that is the intended
      behaviour**, not the original defect. A production compose that resolves with a
      shipped default password is the more dangerous failure; failing loudly on the
      first `config` is the point. (Reworded: closed. The original row demanded that
      `config` "must not fail on a missing variable", which would have meant shipping
      defaults for four secrets.)
- [x] Migrations run from a completely empty database, in order.
- [x] Migrations are idempotent on re-run.
- [x] `pnpm db:reset` succeeds end to end.
- [x] The seed fills every view — no board, chart, or list renders empty.
- [x] `docker compose -f docker-compose.dev.yml up -d` → postgres + minio healthy.
- [x] `minio-init` creates the bucket and exits 0, idempotently on restart.
- [x] The production compose boots api + web + postgres + minio healthy.
- [x] Both Dockerfiles build from a clean checkout.
- [x] nginx serves the SPA with a catch-all and correct cache headers.
- [x] `pnpm build` green from a cold clone.
- [x] `pnpm lint` green from a cold clone.
- [x] `pnpm typecheck` green from a cold clone.
- [x] `pnpm test` green from a cold clone.
- [x] `pnpm e2e` green from a cold clone (Playwright provisions its own database).
- [x] Service-layer unit coverage is meaningful, not incidental.
- [x] `pnpm format:check` is clean (it covers `md` as well as `ts/tsx/mjs/json/css/yml`).
- [x] The docs tree is complete: every `.agents` folder has a current `INDEX.md` whose rows match the files actually in it.
- [x] No doc is still a stub: `grep -rn "full doc" .agents/` finds nothing, and every doc carries real file paths rather than plan language.
- [x] Every doc's file paths and identifiers were spot-checked against the code — a doc that disagrees with the code is a defect, and the code wins.
- [~] The README quickstart works verbatim **in this repo** — every command in it
  is covered by the final gate, and the seeded credentials it prints are the
  ones `seed.ts` writes. **Open: the clean-machine half.** Nobody has run it on
  a machine without a warm pnpm store and a built Docker image, which is the
  only way to catch a missing prerequisite.
- [ ] README screenshots are curated images under `docs/images/`. The captured set
      lives in the build session's scratchpad (`wave3/`, `wave5-rtl/`) and was
      deliberately not auto-committed — a human picks which ones represent the
      product. **Open: curation is a human judgement, not a verification.** The
      shots exist; nobody has chosen among them.
- [x] `docs/features-tour.md` still describes every shipped surface, and its shortcut tables match `lib/shortcuts.ts` plus the contextual handlers.
- [x] No secret, token, or real password is committed anywhere (the seed's demo credentials are deliberate and dev-only).
- [x] LF endings throughout; no CRLF in the index.

---

## F. Known gaps, found while documenting

Each of these was discovered by reading the code against its doc. None was a
guess; each named the file.

**Re-triaged at WP5.6.** The list is now split by outcome. A **fixed** row says
what changed and where, and every one of them carries a test — the reviews and
the fixer waves are the evidence trail, so nothing is cited inline. An **open**
row is open _on purpose_: it names a tradeoff that was considered and accepted,
not work that was forgotten. Do not "fix" one without reading why it is here.

### F1 — Fixed

**Correctness**

- [x] **Notification recipient math at the edges.** Self-mention subtraction, a
      muted watcher who is also the assignee, and the all-candidates-filtered
      case each returned one recipient where they owed zero. The actor is now
      subtracted and mutes applied after the union rather than before it. Three
      failing cases, now green.
- [x] **The audience race.** The fan-out answered "who cares about this task?"
      with a fresh `SELECT` after the publisher committed, so a reassignment
      landing mid-flight redirected the notification to the _new_ assignee and
      told the old one nothing. Assignee and reporter are now snapshotted inside
      the publishing transaction (`AudienceSnapshot` in `utils/domain-events.ts`);
      watchers are still read live, deliberately, and the file says why.
- [x] **`task:moved` had no version stamp** — the one task write in the product
      that was not ordered, so two moves of one card broadcast out of order left
      the board showing the first. The payload now carries the `updatedAt` the
      move transaction wrote, and `applyTaskMoved` joins `isStaleTaskWrite` like
      every other writer. (WP5.6.)
- [x] **The logout / refresh race.** A refresh in flight when `?all=true` landed
      could mint a pair against the pre-bump `token_version`.
- [x] **Rank concurrency.** Two simultaneous drops into the same gap could
      interleave their neighbour reads; the bucket lock is now taken before the
      first read, not before the first write.
- [x] **A duplicate dependency answered 500, not 409** — the unique-constraint
      violation escaped as an unmapped database error.
- [x] **Soft-delete filter** missing from a read path, so a deleted task could
      still surface in one list.
- [x] **A deactivated user kept a live socket.** `token_version` stopped the next
      request and the next handshake but did nothing to an already-open
      connection. `user.revoked` now forces the disconnect.
- [x] **First-connect cache gap.** Only a _re_-connect invalidated the project
      prefix, so a board opened in a tab that connected late could sit stale
      indefinitely. A first connect now invalidates too, with
      `refetchType: 'none'` — the one difference from the reconnect path.
- [x] **The watch toggle updated one cache entry of two.** A sheet reached by
      deep link renders from `qk.tasks.byKey`, which nothing wrote, so the button
      stayed visually stuck. `useWatchers` now updates every entry holding the
      task's detail, selected by predicate rather than by one hard-coded key.
- [x] **CSV formula injection.** A cell beginning `=`, `+`, `-` or `@` executed as
      a formula in Excel and Sheets on the reviewer's machine. Values are now
      prefixed with a quote, which the engines show but do not store.
- [x] **Rate-limit keying**, plus the 429 path is now covered by a test.
- [x] **The workflow editor's rows went stale after a rename.** `StatusList` keeps
      a local copy of the status array so a drag can reorder rows before the
      server agrees, and it re-synced only when the **id sequence** changed. A
      rename does not change an id, so the copy was never refreshed: the name
      input looked right (it has its own local state) while the row's delete
      button went on announcing `aria-label="Delete <old name>?"` until a reload.
      A screen-reader user was told the wrong thing about a destructive action.
      The re-sync signature now covers every field a row renders. Found by the
      new workflow round-trip e2e (WP5.6); pinned by `StatusList.test.ts`.
- [x] **The e2e suite was not actually running last, or uncached.** `turbo.json`
      keyed its override `"e2e#test"`, but Turbo resolves `<name>#<task>` against
      the package NAME (`@flowboard/e2e`), and an override matching no package is
      ignored silently rather than rejected. Both halves of the intent were lost
      for the whole build — Playwright raced the Vitest suites for cores, which is
      the exact arrangement the comment above it says was abandoned. Caught when
      the e2e teardown guard reported `flowboard_test` mutating mid-run: the API's
      own suite was still writing to it. (WP5.6.)

**Product**

- [x] **The backlog was not virtualized** while the table and the Gantt were —
      `components/backlog/TaskRowList.tsx` now virtualizes too.
- [x] **The seed produced no attachments**, so the attachment surfaces rendered
      empty against seeded data.
- [x] **`.env.example` did not carry the variables `docker-compose.yml`
      interpolates**, so `docker compose config` failed on a fresh checkout. Added,
      with four secrets deliberately left blank (see §E).

**Declared but unread — both now resolved**

- [x] **`chartStyle` is wired.** It is read by `fillOpacityFor()` in
      `components/reports/chart-theme.ts` and applied by `CumulativeFlowChart`.
      It is expressed as an opacity rather than a different chart component, so
      the axes, stack order, tooltip and legend cannot move — a theme setting must
      never change what a report says.
- [x] **`data-density` is gone.** `applyTheme()` stamped it and nothing read it;
      density travels entirely through the multiplied spacing tokens. A second,
      mute representation of a fact the tokens already carried is exactly the kind
      of hook that gets styled against later and then silently disagrees.

**Naming and stale comments — all five**

- [x] `faviconUpdater.ts` becomes `favicon-updater.ts`, the last camelCase
      non-component file in `apps/web/src`. `theme.presets.ts` becomes
      `theme-presets.ts` and `theme.tokens.ts` becomes `theme-tokens.ts` with it,
      and every doc reference was updated.
- [x] `packages/shared/src/envelope.ts` described `error.code` as SCREAMING_SNAKE;
      `ApiError` emits `lower_snake_case`. SCREAMING_SNAKE is the **socket ack**
      convention — two real conventions, one wrong comment.
- [x] `packages/shared/src/users.schema.ts` justified `passwordSchema`'s 128-char
      ceiling with bcrypt's 72-byte truncation; the API hashes with **scrypt**.
- [x] `theme-presets.ts` and `ColorsPanel.tsx` both claimed `themePresetSchema`
      was the two-value `['Default','Imported']` pair; it carries all eight preset
      names plus `'Imported'`.
- [x] `locales/en/{board,backlog,roadmap,notifications}.ts` justified avoiding
      plurals as "would break catalog parity". The parity test supports plurals
      properly now; the no-plural **policy** is fine, the stated reason was stale.

### F2 — Open, and deliberately so

These are the ones a future maintainer should read before touching. Each is a
decision, not an oversight.

- [ ] **`telemetry_events.session_id` is a reserved column that `record()` never
      writes.** Keeping it costs one nullable column and makes adding session
      analytics a backfill rather than a migration on a large, append-only table.
      Dropping it and re-adding it later is the more expensive path. Left
      deliberately empty — do not wire it speculatively.
- [ ] **Refresh tokens stay valid until `token_version` changes.** They are
      stateless JWTs with no server-side store, so a rotate-and-revoke scheme
      would mean introducing one — a table, its writes on the hottest auth path,
      and its cleanup. The bounded exposure (a stolen refresh token works until
      the next password change, force-logout or deactivation) was accepted against
      that cost. Revisit only with the token store in the same change.
- [ ] **`due_soon` compares UTC calendar days.** A user near a date line can see
      the notification a day early or late. Fixing it properly needs a per-user
      timezone, which FlowBoard does not collect; guessing from the browser would
      make the _server's_ scheduled job disagree with the client that reported it.
- [ ] **Echo suppression keys on a socket id that can go stale.** If a tab
      reconnects between sending a mutation and the broadcast, `except()` excludes
      an id nobody holds and the actor receives its own echo — one redundant cache
      write, self-correcting, in a window measured in milliseconds. The
      alternative (an actor-id-plus-request-id scheme) is materially more protocol
      for a cosmetic edge.
- [ ] **The web parses response schemas by convention, not by enforcement.**
      `lib/api.ts` will happily return an unparsed body if a caller forgets to pass
      a schema; nothing fails the build. Every current caller passes one. Making it
      structurally impossible means a wrapper that cannot be called without a
      schema — worth doing, not yet done, and named here so it is a decision rather
      than a discovery.

---

Back to [checklists/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
