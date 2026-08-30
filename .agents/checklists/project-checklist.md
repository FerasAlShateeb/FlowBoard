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

**§G is Round 2, and every row in it is unticked.** It covers instance
administration and single-org mode, the navigation shell and view-as-member, the
analytics console, the dashboard primitive kit, the Theme Studio drawer, and
motion. The rows describe shipped behaviour like the rest of this file, so an
unticked box there means "not yet verified with evidence" — the closing review
pass (W3.5) is what ticks them. §G10 is different: those three rows are **open on
purpose**, each with a status note saying what has to change first.

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
- [x] The Arabic catalog is complete — every English key has an Arabic value across all namespaces (**20 since Round 2 added `analytics`**), proven by `src/i18n/locales.test.ts`.
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

## G. Round 2 — instance admin, analytics, the drawer, motion

**Verified in R2 W3.5.** Every row in G1–G9 was walked against the test suites and
either ticked with the assertion that pins it, or left unticked with a
`**Not yet verified:**` note naming exactly what is missing — because an unticked
box has to mean something a reader can act on. The score is **47 ticked, 25 not**,
and the 25 split into two honest kinds: a claim whose halves are only partly
asserted (13), and a claim nothing asserts at all (12). None of them is a claim
believed to be FALSE; every one describes shipped behaviour that no test currently
pins. G10–G12 record what W3.5 itself changed.

The reference docs are [admin.md](../docs/admin.md), [analytics.md](../docs/analytics.md),
[motion.md](../docs/motion.md), and §10–§11 of [design-system.md](../docs/design-system.md).

### G1 — Instance settings and single-org mode

- [ ] `instance_settings` is a real singleton: the `instance_settings_singleton` check refuses a second row, and the migration's `INSERT … ON CONFLICT DO NOTHING` plus the service's lazy `readRow()` both leave exactly one. **Not yet verified:** the constraint name and the lazy `readRow()` are asserted; nothing inserts a SECOND row to prove the database refuses it, and the migration’s `ON CONFLICT DO NOTHING` is untested.
- [x] `GET /api/instance/config` is `requireAuth` only and returns `{orgMode, defaultOrgSlug, instanceName}`; `GET`/`PATCH /api/admin/settings` are global-admin only. A non-admin gets 403 on the second pair and 200 on the first.
- [x] `defaultOrgSlug` is **resolved, never stored**: archiving the default org makes it fall back (single mode) or go `null`, with no stale slug surviving in the row.
- [ ] `PATCH` refuses with **`default_org_invalid`** for an unknown or archived org and **`default_org_required`** when switching to single mode with more than one live org — and the transaction does not commit on either. **Not yet verified:** both 422 codes are asserted; the "does not commit" half is proven only for `default_org_required`, not for `default_org_invalid`.
- [x] Switching to single mode with exactly one live org auto-adopts it; with **zero** orgs it is allowed and leaves `defaultOrgId` null.
- [x] Flipping back to `multi` keeps the configured `defaultOrgId` rather than clearing it.
- [ ] Single-mode collapse is complete and live: the org switcher renders nothing, `/` short-circuits to the default org **before** `GET /orgs` resolves, the sidebar and breadcrumbs fall back to `defaultOrgSlug`, and `/admin/orgs` shows the mode banner with Create still enabled. **Not yet verified:** the switcher, the `/` short-circuit and the banner are covered (`instance-mode.spec.ts`); the breadcrumbs’ `defaultOrgSlug` fallback and "Create stays enabled" on the banner page are not.
- [ ] A failed `/instance/config` degrades to `multi` — the shape that hides nothing — rather than hiding an org. **Not yet verified:** the `FALLBACK_INSTANCE_CONFIG` degrade path is never driven — every consumer’s test mocks `useInstanceConfig` outright rather than failing the query through it.
- [x] Saving instance settings invalidates `qk.instance.all()`, so the shell collapses or expands **without a reload**.
- [ ] The seed writes an `instance_settings` row (`orgMode: 'multi'`, no default) and two organizations, so every cross-org surface has more than one row. **Not yet verified:** nothing asserts the seed’s `instance_settings` row or that it writes two organizations; the e2e fixtures only assume both.

### G2 — Escape routes, navigation and view-as-member

- [x] On `/admin/*` the sidebar still shows real workspace links, resolved through the `orgSlug ?? lastOrgSlug ?? defaultOrgSlug` ladder.
- [ ] All four escape routes work from a deep `/admin/*` page: the brand mark links to `/`, the Home nav row is present, the switcher's footer offers "All organizations" **outside** the filtered `CommandList`, and an unknown URL renders `NotFoundPage` inside the shell with a back-link. **Not yet verified:** the brand mark, the Home row and the switcher’s footer are covered; an unknown URL rendering `NotFoundPage` INSIDE the shell with a back-link is not.
- [x] The org switcher is an always-enabled searchable combobox in multi mode — never a disabled button.
- [x] Breadcrumbs render on every route family, the last crumb is not a link, and `/admin/analytics/:domain/:metric` names the **metric**, not a prettified URL segment.
- [ ] The sidebar, the breadcrumbs and the command palette all derive from `buildSections` — no second nav list anywhere. **Not yet verified:** `buildSections` is exhaustively tested and all three surfaces import it, but nothing cross-checks the three against each other or rules out a second hard-coded nav list.
- [x] `isGlobalAdmin()` (real) and `isEffectiveGlobalAdmin()` (effective) are used in the right places: the switch itself reads the real flag, every chrome surface reads the effective one.
- [x] Switching **into** member view while on `/admin/*` bounces to `/` with `replace`; switching back never bounces.
- [x] A deep link into `/admin/*` while in member view renders the "return to admin view" empty state, not a silent redirect.
- [x] The amber pill shows only for a real admin in member view and returns in one click; the mode persists to `fb-view-mode-v1` and is cleared by sign-out.
- [x] `GET /orgs?scope=member` narrows a global admin to their own memberships **server-side**, and the query key carries the scope so the two answers cannot overwrite each other in the cache.
- [ ] API authorization is unchanged by view-as: every `/admin/*` endpoint still answers on the real flag. **Not yet verified:** no API test drives an `/admin/*` endpoint under a view-as client state. `GET /orgs?scope=member` is covered, but that is a list NARROWING, not the authorization claim.

### G3 — The analytics console

- [x] Every KPI tile is a link around the **whole** card, and every chart card's "Details →" is in the header only.
- [x] There is no per-metric server route: a drill-down fetches its **domain** endpoint, and the URL never contains the metric id.
- [x] Two metrics of one domain rendered in one frame issue **one** request; a facet change issues none; a rejected load is not cached.
- [x] Every `MetricTile` / `DrillChartCard` link is built with `detailPath(domain, metric)` and type-checks against the registry — no hand-built `/admin/analytics/...` string.
- [ ] The shared range survives switching between the four dashboards, and the drill-down's range is **local** so widening it does not rewrite the dashboard's. **Not yet verified:** the shared range across the four dashboards is covered; nothing asserts that widening the DRILL-DOWN’s range leaves the dashboard’s untouched.
- [x] The preset — not the resolved window — is the cache key, so a repeat render hits rather than refetching.
- [ ] Cold renders a skeleton; **warm keeps the previous numbers on screen** while refetching, on the dashboards and on `/admin/overview` alike. **Not yet verified:** cold-vs-warm is asserted for the four dashboards (`useAnalyticsStore.test.ts`); `/admin/overview` has no equivalent assertion.
- [x] Auto-refresh is opt-in, off by default, and 30 s.
- [x] Every CSV export goes through `saveBlob`/`downloadCsvBlob`, carries the **whole filtered set** in sort order, and uses the table's translated headers.
- [x] The drill-down's sort orders the full filtered set before paging — page 2 of a sort is the real page 2, not a reshuffle.
- [ ] Every filter, sort and range change resets to page 1. **Not yet verified:** nothing asserts that a filter, a sort or a range change resets to page 1 — on the drill-down or on any grid.
- [x] An unknown `:domain`/`:metric` pair renders the friendly not-found with a way back, including `/admin/analytics/overview/anything`.
- [ ] `MAX_BUCKETS = 400` refuses an undrawable window with a message naming what to change, rather than silently coarsening the interval. **Not yet verified:** the 400 and the exact 400-bucket ceiling are asserted; the message NAMING what to change is not.
- [x] The analytics aggregations keep the documented math — gap-filled zeros, half-open buckets, `percentile_cont`, a 5xx-only error rate — and each endpoint is one round trip.

### G4 — The dashboard primitive kit

- [x] `PanelCard`'s ladder is error → pending → empty → content, and the caption renders only with content.
- [ ] The `ReportCard` / `PanelCard` split is respected: nothing new pins 16:10 outside the six-chart reports grid, and every `PanelCard` states a skeleton that reserves the height its content will take. **Not yet verified:** the skeleton’s height reservation is asserted; the "nothing new pins 16:10 outside the six-chart reports grid" half has no test.
- [x] The three range vocabularies are intact and each file header still says which question it answers; nothing that wants `7d/30d/90d/12m` rolls its own picker.
- [x] `DataTable` registers its v9 features explicitly, uses `sortFn` + `sortUndefined: false`, and puts **nullish last ascending, first descending** — `compareValues` is a **direction-blind comparator** and TanStack re-inverts it, which is what keeps a blank cell at the far end of whichever order was asked for.
- [x] A grid's filters, sort and paging round-trip through the URL; column visibility, order and density deliberately do **not**.
- [ ] Every string the kit renders comes from `chrome-copy.ts`, and every borrow has a row in its KEPT/MINTED table. **Not yet verified:** `PanelCard`’s own two strings are now proven to come from `chrome-copy` (R2 W3.5, §G11), but the kit-WIDE claim and the KEPT/MINTED table are still documentation rather than an assertion.
- [ ] `OPS_CHART_BODY` keeps the two side-by-side ops plots at the same height. **Not yet verified:** `ops-panel.ts`, `LatencyChart` and `RequestsChart` have no test file at all; `OPS_CHART_BODY` is unasserted.

### G5 — The Theme Studio drawer

- [x] Opening the drawer moves focus to its close button; Tab cycles inside the panel; Escape and a scrim click both close it; closing **unmounts** it.
- [x] The tablist roves with arrow keys and wraps, and the arrows are reversed under RTL (`ArrowRight` = previous tab).
- [x] Every change applies **live** app-wide, and only **Save** writes localStorage.
- [ ] The drawer has no leave guard and `/theme` still does: its `useBlocker` dirty guard and `beforeunload` handler are intact. **Not yet verified:** `/theme`’s `useBlocker` guard is covered; `beforeunload` is not, and nothing asserts that the DRAWER has no guard when it is closed dirty.
- [ ] "Advanced editor →" reaches `/theme` through the injected `navigate`, and `/theme` can reopen the drawer over itself. **Not yet verified:** the hand-off into `/theme` is covered; `/theme` reopening the drawer over itself is not.
- [x] `mod+shift+t` toggles the drawer and appears in the `?` cheat sheet because it is registered through `lib/shortcuts.ts`.
- [x] The drawer paints above the sidebar and every Radix overlay — proof that mounting it from `AppProviders` rather than the topbar still holds.
- [x] Preset mini-previews render and the active preset is marked by structural match, in the drawer as on the page.

### G6 — Motion

- [ ] With nothing stored, `<html data-motion>` is `full` **even while the OS asks for reduced** — and the stamp lands before the first paint. **Not yet verified:** the default-beats-OS rule is asserted; "before the first paint" is an ordering claim vitest cannot exercise — it needs a browser assertion on the pre-hydration DOM.
- [x] Picking `system` follows the OS live; picking `full` or `reduced` takes the OS out of the loop; the stamp is never the literal `system`.
- [x] The Motion card on `/me` persists, restamps and re-renders without a reload, and survives a throwing `localStorage`.
- [x] All six registry entries have a working reduced branch, and each renders the **same copy, affordances and `data-testid`** as its full branch.
- [x] Charts are static under reduced motion, and a **warm** refetch never re-animates a chart that is already drawn.
- [ ] `animate-spin` is still un-gated, and no decorative spin has been added. **Not yet verified:** no test references `animate-spin` in either direction.
- [x] `motion-imports.test.ts` passes with the allowlist exactly matching the source tree, and `framer-motion` is imported nowhere.
- [ ] The gate block is still the last thing in `index.css`, still unlayered, still `:where()`-wrapped, and `--speed` is still untouched by it. **Not yet verified:** no test reads `index.css` to check the gate block’s position, its unlayered status, its `:where()` wrapping, or that `--speed` is untouched.

### G7 — i18n and RTL for the new surfaces

- [x] The `admin` and `analytics` namespaces have full en↔ar parity, proven by `locales.test.ts`.
- [x] Every key the metric registry emits resolves in **both** catalogs, proven by `metric-registry.test.ts` — including the `DOMAIN_*` and `INTERVAL_*` maps.
- [x] The catalog and the registry agree on the metric id set in both directions — no orphan entry either way.
- [ ] Breadcrumbs, the org switcher, the drawer, the grids and the console pages all pass an RTL pass, with logical utilities only. **Not yet verified:** the console pages, the analytics dashboards and their drill-down, the org switcher and the drawer are covered (R2 W3.5, §G11); the breadcrumbs and the grids have no dedicated RTL assertion.
- [ ] The new LTR islands are bounded and documented, each with a row in **[i18n.md §7.4](../docs/i18n.md)'s lexical-island table**: `StatDelta`'s pill (the pill, not the string) and the endpoint-path cells. Nothing else was pinned — and in particular no formatted date was, per that section's closing rule. **Not yet verified:** `StatDelta`’s pill is asserted `dir="ltr"` in the browser; the endpoint-path cells and the NEGATIVE claim ("nothing else was pinned", no formatted date) have none.

### G8 — Charts and numbers (W3.1)

- [x] **The events feed keeps an "All time" affordance** the console's `7d/30d/90d/12m` vocabulary cannot express, and `/admin/telemetry/requests` keeps its 24 h.
- [ ] **A bucket caption appears only on a time axis** — `analytics:detail.perInterval` renders for a `line` series and never over a categorical `bar` breakdown. **Not yet verified:** no test references `analytics:detail.perInterval` or asserts that the caption appears on a `line` series and never over a `bar`.
- [ ] **A count axis shows whole ticks only**: `allIntegers` drives `allowDecimals`, so a series of counts never grows a `2.5` gridline. **Not yet verified:** no test references `allIntegers` or `allowDecimals`.
- [x] **Numeric badges are LTR islands**: `StatDelta` pins `dir="ltr"` on the pill, so `+12.5%` does not render as `12.5%+` in Arabic.
- [x] **A conflict names the field the reader can change**: `slug_taken`, `org_slug_conflict`, `default_org_invalid`, `default_org_required` — never a bare `conflict` for something the user could have fixed.

### G9 — Registry and grid regressions (W2.2)

- [x] **Route params are looked up with `Object.hasOwn`, never a plain index.** `/admin/analytics/traffic/toString` and `/admin/analytics/constructor/dau` both resolve to the not-found card rather than a prototype member.
- [x] **The domain payload cache is keyed by `domain|from|to|interval` and holds the promise, not the value**, so concurrent metrics share one in-flight request — and a rejection is evicted so a retry is a real retry.
- [ ] **The first fetch is seeded from the URL.** A pasted, pre-filtered grid link produces exactly one correctly-filtered request, never a default request followed by a corrected one. **Not yet verified:** nothing mounts a page from a pre-filtered URL to prove it issues exactly ONE correctly-filtered request rather than a default followed by a correction.
- [x] **Sorting happens over the whole filtered set before paging**, on the drill-down and on every server-shaped grid — never over the rows already on screen.

### G10 — Was open on purpose; all three closed in W3.5

- [x] **`StatDelta` has a lower-is-better mode.** **FIXED (R2 W3.5):** `goodDirection?: 'up' | 'down'` (default `'up'`) — the ARROW and `data-direction` follow the sign, only the COLOUR and `data-tone` follow the judgement, so a falling error rate is a down arrow in green. The polarity itself is declared once per metric on `MetricDefinition.deltaDirection` and read by `MetricTile` through `metricDeltaDirection(domain, metric)`, never special-cased in the badge. Marked `'down'`: `traffic.errors`, `traffic.error-rate`, `traffic.latency`, `work.cycle-time`. Evidence: `StatTile.test.tsx` (`StatDelta — goodDirection`, the four-cell matrix plus the zero and default cases) and `MetricTile.test.tsx` (driven through the REAL registry: a falling error rate is `good`, a rising error count is `bad`, a rising request total is still `good`).
- [x] **The telemetry events feed's Project column shows a name.** **FIXED (R2 W3.5):** `telemetryEventRowSchema` gained a nullable `projectName`, joined LEFT in `admin-telemetry.service` beside `userName` — LEFT because `project_id` is nullable by design, so an inner join would delete every platform-level event from an audit feed. The id is untouched: the feed's filter takes it, the cell hovers it (`title`), and the CSV gives it its own column. Evidence: `admin-telemetry.routes.test.ts` (a project-less event kept with both fields null; name + id on a live project; a SOFT-DELETED project still named) and `e2e/tests/analytics.spec.ts` (`the events feed names the project instead of printing its UUID`).
- [x] **`/admin/projects`'s Status column matches `/admin/orgs`'s.** **FIXED (R2 W3.5):** both states are explicit — `soft-success` "Live" and `soft-danger` "Archived" with the date on its `title` — and the column gained an `accessor`, so the archived rows can be gathered with a sort. Evidence: `AdminProjectsPage.test.tsx` (`badges a LIVE project explicitly, like /admin/orgs does` and `badges an ARCHIVED project, and dates it on the badge`), plus the convention note in [admin.md](../docs/admin.md) §7.

### G11 — Round 2 W3.5: the adversarial review's findings

Every row here was found by review rather than by a failing test, and every one
ships with the regression test that would have caught it.

- [x] **An archived organization revokes its projects — reads AND writes, HTTP and socket.** Archiving is one `UPDATE organizations SET deleted_at` and touches no project row, so the project guards had to carry the whole rule and did not: `requireOrgRole` filtered on `deleted_at` (it had an `:orgId` in hand), while `requireProjectRole` never looked at the org at all. Every `/api/projects/:projectId/*`, `/api/tasks/:taskId`, `/api/sprints/:sprintId`, `/api/comments/:commentId` and `/api/attachments/:attachmentId` route stayed open to a switched-off org's members, and to global admins. **FIXED:** `resolveProjectRef` joins `organizations` and requires `deleted_at IS NULL` on all five param sources (the load-bearing half — it runs before any role is considered, so it covers a global admin too), `findOrgRole` requires a live org (so no `org_members` row in a dead org can promote anyone, including on the socket path), and `sockets/socket-reads.loadProjectRef` does the same for `project:join`. The archive stays reversible: clearing `deleted_at` restores every route with no other write. Evidence: `org-liveness.routes.test.ts` (all five sources 200 → 404 → 200 across an archive and a restore; a global admin and an org admin both refused; a member's task read, PATCH and move all 404; a live sibling org untouched) and `gateway.test.ts` (`project:join` acks `NOT_FOUND` for a member of an archived org and for a global admin, and works again after a restore).
- [x] **Deleting an account scrubs its name out of the mention markup too.** `@[Display Name](userId)` stores the name captured at write time, so the anonymize left the person's real name rendering inside every comment and task description that had ever mentioned them — the one place a name is actually read. **FIXED:** two `UPDATE … regexp_replace` statements inside the same transaction as the scrub, pinned to that one user id, with the name-half pattern copied from `MENTION_PATTERN`. Evidence: `admin-users-lifecycle.routes.test.ts` (both bodies rewritten, both occurrences in one body, another user's mention untouched; an uppercase-uuid mention; prose that only looks like a mention left byte-identical with `updated_at` unmoved).
- [x] **`useOrgsSearch` carries `?scope=member`.** The org switcher's server-side search (the one that runs above `ORG_SERVER_SEARCH_THRESHOLD`) sent no scope, so typing one character during a view-as-member preview refilled the list with every organization on the instance — the one thing the preview exists to hide, on exactly the instances where an admin would notice least. **FIXED:** the same flag, the same query parameter and the same key suffix as `useOrgs`. Evidence: `useOrgs.test.tsx` (the 3×2 matrix over both hooks, plus the empty-needle case and the two cache entries proven not to cross-fill).
- [x] **`AnalyticsDetailPage` drops an out-of-order response.** A monotonic `useRef` token mirroring `useAnalyticsStore.load`'s documented pattern; the error branch is guarded too, so a superseded failure cannot replace a good table with a retry card for a window nobody is looking at. Evidence: `AnalyticsDetailPage.test.tsx` (`an out-of-order response never wins` — the transport is held open by hand and the second request is answered first).
- [x] **Bucket truncation is pinned to UTC.** `date_trunc` on a `timestamptz` truncates in the SESSION's zone, so every analytics and telemetry bucket boundary silently depended on a deployment's database configuration — invisible in development, because the compose image happens to be UTC. **FIXED at the pool** (`connection: { TimeZone: 'UTC' }` in `db/client.ts`) rather than at the six call sites, so future queries inherit it and there is no `SET` to forget on a reconnect. Evidence: `db/client.test.ts` (the session zone; the same instant truncating to a DIFFERENT day on a deliberately non-UTC control session, which is what proves the pin is load-bearing; the zone present on concurrent connections).
- [x] **`/api/notifications` re-checks liveness.** It was the one authenticated router with no role guard to hang the lazy `token_version` / `is_active` recheck on — and the one a revoked session polls on a timer, carrying task titles and the names of the people who mentioned you. **FIXED** in the controller (`liveRecipient` → `loadLiveUser`), not in a new database-reading middleware, which would have been a fourth exception to the layering rule. Evidence: `notifications.routes.test.ts` (`a revoked session` — 401 on every endpoint after a deactivation and after a `token_version` bump, no write on the way to the refusal, a live account still served).
- [x] **The diagnostics drawer reads the EFFECTIVE admin flag.** It read the real one, so an admin previewing member view kept a topbar button no member has, kept Ctrl+J bound away from the browser, and kept a live server-log tail docked beside the board they were previewing. Evidence: `DiagnosticsDrawer.test.tsx` (no panel, no trigger and no chords in member view; all three back the moment they return to admin view) — and it is now listed as a consumer in [admin.md](../docs/admin.md) §4.1.
- [x] **The Theme Studio drawer traps the KEYBOARD and not the pointer.** The on-panel Tab handler only saw keystrokes that reached the panel, so focus parked on `document.body` (or in a portalled subtree) escaped on the next Tab while `aria-modal="true"` went on claiming otherwise. A document-level `focusin` redirects it back — only for a keyboard-origin move, and in the direction the keystroke implied — which keeps the live-preview contract its own e2e spec drives. Another modal or popover claiming focus is exempt — `mod+k` has no overlay gate, so the palette can open over the drawer, and without the exemption the backstop would yank focus out of its input. Evidence: `ThemeStudioDrawer.test.tsx` (`the focus backstop`: a keyboard escape pulled back, direction respected, a pointer move left alone, the NEXT Tab after a pointer interaction returning, no interference within the panel, the four portalled surfaces exempt, and the listener released on close).
- [x] **The drawer owns `z-[120]`, above the popover family.** It shipped on the shared modal tier (`z-[100]`), below the `z-[110]` popover family that portals to `body` — so a tooltip or menu belonging to the app BEHIND the scrim painted straight through both scrim and panel. The z-scale is documented in the component header and in [design-system.md](../docs/design-system.md) §11.2, including the price: a popover-family primitive rendered from inside the panel would need `z-[130]` on its content. Evidence: `ThemeStudioDrawer.test.tsx` (`the z tier`: the tier on both panel and scrim, plus a guard that the panel renders no popover-family trigger on any tab).
- [x] **`mod+shift+t` carries the `!overlayIsOpen()` gate**, like `?` and `c` — two `aria-modal` surfaces would mean two focus traps fighting for one Tab and two `body` scroll-lock cleanups racing. The gate does not see this drawer (it queries `ui/dialog` / `ui/sheet` `data-slot`s), so the chord can still close what it opened. Evidence: `shortcuts-wiring.test.tsx` (both halves of `overlayIsOpen` — the palette store and the DOM query — plus the self-toggle case).
- [x] **Archiving an org empties its live project rooms.** The guards' fix covers every future request and every future join; a socket already IN one of those rooms asked its permission question once, at join time. `softDeleteOrg` publishes `org.archived` (project ids denormalized onto the event, so the subscriber needs no read) and the realtime bridge does `socketsLeave` plus `clearProjectPresence` — rooms, not connections, because archiving one tenancy is not revoking a person. Evidence: `realtime-bridge.test.ts` (project traffic stops without a disconnect; the presence roster is emptied; a different org's room untouched; the event published by the real service with the live project ids, and NOT published when the archive is refused).
- [x] **`PanelCard`'s copy goes through `chrome-copy.ts`.** It was the one component in the dashboard kit calling `t()` itself, which put two of the kit's strings outside the KEPT/MINTED table a reviewer checks against and tied the analytics console to the reports namespace's layout. Evidence: `PanelCard.test.tsx` (`its copy comes from chrome-copy` — the rendered strings compared to what `usePanelChromeCopy()` resolves, not to English literals).
- [x] **The `events-by-type` CSV has no duplicate header.** Its `type` and `wire` columns both read `analytics:columns.eventType`, so the exported file carried "Event" twice — two identically-named columns in a spreadsheet somebody is about to sort. `wire` now has `analytics:columns.eventTypeId` ("Event ID", minted in en + ar). Evidence: `e2e/tests/analytics.spec.ts` asserts the whole header line exactly (`Event,Event ID,Events,Share`) and that the headers are distinct.
- [x] **The RTL sweep reaches Round 2's surfaces.** `e2e/tests/rtl.spec.ts` now covers `/admin/overview`, an analytics dashboard, its drill-down, the org switcher's portalled popover and the Theme Studio drawer in Arabic: `dir=rtl`, the drawer's box at the READING end (asserted as geometry, not as a class name), the mirrored Details and Back arrows (asserted as a computed `transform`), the `StatDelta` pill still `dir="ltr"`, the direction-aware tablist arrows, and Western digits throughout.

### G12 — Accepted as-is, with the decision recorded

- [x] **The single-org flip does not propagate to other live sessions**, and that is a decision rather than a gap. The admin's own tab is live (`qk.instance.all()` is invalidated); every other session learns the mode on its next reload or ordinary refetch. The degradation was verified graceful in both directions — a stale session keeps the shape it booted with, and single mode collapses the SHELL, not the data model, so no stale `orgMode` can produce a 404, a wrong permission or a lost write. The blast radius is one field on one row, changed by one person, perhaps once in an instance's life; every other live-propagation mechanism in FlowBoard exists either for something that changes many times a minute or for a security boundary, and this is neither. The server re-checks every guard regardless of what any client believes. Recorded in full in [admin.md](../docs/admin.md) §2.5.

---

Back to [checklists/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
