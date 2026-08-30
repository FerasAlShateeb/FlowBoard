# Diagnostics (the log viewer)

The in-app server-log tail: pino writes every line to stdout **and** to a bounded
in-memory ring, a global admin polls that ring over REST, and a non-modal,
four-side dockable drawer renders it. Read this before adding a log line you
expect to see in the drawer, before touching `/api/admin/logs`, and before writing
an e2e spec against the panel (§5 is the testid contract).

## 1. The ring buffer

`apps/api/src/utils/log-ring.ts` owns the ring; `apps/api/src/utils/logger.ts`
feeds it through a single pino multistream:

```ts
export const logger = pino(
  { level: env.LOG_LEVEL },
  pino.multistream([{ stream: process.stdout }, { stream: ringStream, level: 'trace' }]),
);
```

One tee, so **every existing child-logger call site feeds the ring for free** with
zero call-site changes.

### 1.1 The contract

| Property     | Value                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------- |
| Capacity     | `RING_CAPACITY = 500`, drop-oldest (`ring.shift()`)                                            |
| Ids          | `nextId` starts at 1, strictly monotonic, **never reused across evictions**                    |
| Scope        | Process-local heap. Not persisted, not shared, not shipped anywhere                            |
| Record shape | `{ id, time, levelNum, msg, context }` internally; serialized as `ServerLogRecord`             |
| `context`    | every pino binding except `RESERVED_KEYS` = `level`, `time`, `msg`, `pid`, `hostname`          |
| Sink         | `ringStream.write(line)` → `JSON.parse` → `push()`; **malformed lines are silently swallowed** |

The monotonic-and-never-reused id is what makes a `sinceId` cursor survive
eviction: the client asks for "everything after 812" and gets the right answer
whether or not 812 is still in the buffer. `push()` ignores non-objects rather than
throwing — it runs _inside_ a log write, and a bad line must never break logging.

`snapshot(options)` materialises the ring: filter by `id > sinceId` and
`levelNum >= min`, map numeric pino levels to labels via `LEVEL_LABEL` (10→`trace`
… 60→`fatal`, unknown → `info`), then **tail**-slice to `min(limit, RING_CAPACITY)`.
Tail, not head — a client that fell behind wants the newest lines it is missing.
`lastId` is the highest id **currently in the ring regardless of filter**, `0` when
empty. `clearRing()` exists for tests only.

### 1.2 Log through pino or it never reaches the drawer

**A `console.log` bypasses the ring entirely.** It is not filtered, not
transformed, not late — it simply never happens as far as the drawer is concerned,
because the ring is a pino stream and nothing else writes to it.

That is one of the reasons **`no-console` is `'error'`** in
`packages/config/eslint.config.mjs`. There is exactly one sanctioned exception in
the API — the boot-time env failure in `apps/api/src/config/env.ts`, which must
reach the operator even when the logger cannot start, and carries an inline
`eslint-disable-next-line` with that reason. Import `logger` (or a
`logger.child({ scope })`) everywhere else.

### 1.3 Two caveats, on purpose

1. **`LOG_LEVEL` gates the ring's content.** The ring's own stream is pinned to
   `level: 'trace'` so it never filters _below_ the logger, but the logger only
   emits at or above `env.LOG_LEVEL` (default `info`). The ring can only ever hold
   what the process logged — set `LOG_LEVEL=debug` to see finer records.
2. **⚠️ Single-instance only.** The ring and its id counter live in one process's
   heap and only ever see lines _that_ process wrote. Behind two API replicas the
   drawer tails whichever instance the load balancer picked, and `sinceId` — a
   per-process counter — jumps backwards on every reroute. Horizontal scaling
   swaps the implementation behind the same `push` / `snapshot` / `ringStream`
   trio (a Redis capped list with ids minted by `INCR`); nothing outside
   `log-ring.ts` changes.

## 2. The endpoint

```
GET /api/admin/logs?sinceId=&level=&limit=
```

Mounted by `apps/api/src/routes/admin-logs.routes.ts` (the router is mounted at
`/admin`, and it declares `/logs`), handled by `getServerLogs` in
`apps/api/src/controllers/admin-logs.controller.ts` — three lines, because the
schema defaults leave the controller nothing to decide.

### 2.1 Guard

`requireAuth` **then** `requireGlobalAdmin`. Not "logged-in" surface:
**log lines routinely carry user emails, user ids, project ids and error
messages**, which is exactly why the client store refuses to persist them (§3.2).

| Failure            | Response                                                     |
| ------------------ | ------------------------------------------------------------ |
| no / bad token     | **401** `unauthorized`                                       |
| not a global admin | **403** `forbidden` — "Global administrator access required" |
| bad query          | **422** `validation_error` (e.g. `?level=nope`)              |

### 2.2 Query and response

`serverLogsQuerySchema` lives in `packages/shared/src/diagnostics.schema.ts` and is
re-exported through `apps/api/src/validation/admin-logs.validation.ts` so route
files keep importing validation from `src/validation/*` like every other quartet.

| Param     | Schema                                         | Default | Cap |
| --------- | ---------------------------------------------- | ------- | --- |
| `sinceId` | `z.coerce.number().int().nonnegative()`        | `0`     | —   |
| `level`   | `logLevelSchema.optional()` (minimum severity) | none    | —   |
| `limit`   | `z.coerce.number().int().min(1).max(500)`      | `500`   | 500 |

The 500 in the shared schema is a literal — a runtime-neutral package cannot
import a Node-side constant — so `admin-logs.validation.ts` carries a **compile-time
assertion** that it still equals the ring's real capacity:

```ts
type AssertRingCapacity<T extends 500> = T;
export type _RingCapacityMatchesContract = AssertRingCapacity<typeof RING_CAPACITY>;
```

A type error there is the signal to change both.

The response is the standard envelope wrapping `serverLogsSnapshotSchema`:

| Schema                     | Shape                                                                |
| -------------------------- | -------------------------------------------------------------------- |
| `logLevelSchema`           | `z.enum(['trace','debug','info','warn','error','fatal'])`            |
| `serverLogRecordSchema`    | `{ id: int≥0, time: epoch-ms, level, msg: string, context: record }` |
| `serverLogsSnapshotSchema` | `{ records: ServerLogRecord[], lastId: int≥0 }`                      |

### 2.3 Why it is polled, not pushed over the socket

FlowBoard has a perfectly good Socket.IO layer, and the log tail deliberately does
not use it:

- **Auth is already solved for REST** — Bearer + `requireGlobalAdmin`. A log
  stream would need its own admin-gated socket surface for a feature that is only
  ever open on one screen.
- **Zero new realtime surface.** The typed event maps in `@flowboard/shared` stay
  untouched, so nothing about the socket contract has to grow an admin tier.
- **A cursor is cheaper than a subscription.** One small request every 2 s, only
  while the drawer is open and only for a global admin (§3.2), and the cursor makes
  each response carry only what is new.

## 3. The drawer

`apps/web/src/components/diagnostics/` — five source files plus a hook. It is a
**panel, not a dialog**: non-modal, no scrim, no focus trap, no scroll lock.
The entire point is watching the log _while_ using the app — click a card, watch
the request land.

### 3.1 Docking and geometry

State lives in `apps/web/src/stores/useLayoutStore.ts`; the pure helpers live in
`apps/web/src/components/diagnostics/diag-chrome.ts`.

| Concern             | Value                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| Sides               | `DiagDock = 'bottom' \| 'left' \| 'right' \| 'top'`; `isSideDock()` = left/right                 |
| Cycle order         | `DIAG_DOCK_CYCLE = ['bottom', 'right', 'left', 'top']`                                           |
| Height (top/bottom) | `diagHeight`, default **288**, clamped `[160px, 70vh]` (`DIAG_HEIGHT_MIN`, `DIAG_HEIGHT_MAX_VH`) |
| Width (left/right)  | `diagWidth`, default **380**, clamped `[280px, 60vw]` (`DIAG_WIDTH_MIN`, `DIAG_WIDTH_MAX_VW`)    |
| Shell axis          | `shellDirectionClass(dock)` → `flex-row` for side docks, `flex-col` for top/bottom               |
| Flex order          | `isDrawerFirst(dock, rtl)` → `order-first` / `order-last`                                        |
| Inner border        | `DOCK_BORDER_CLASS` — physical `border-t/b/r/l`                                                  |

**The drawer is a real flex child of the shell, not an overlay.** It is sized in
px and the page content reflows around it. `AppShell.tsx` mounts it **once,
unconditionally**, and the drawer picks its own placement with an `order` class —
which is what lets a dock switch reflow **without remounting**, keeping `LogList`'s
polling effect alive across a redock. A conditional position in the JSX would
remount the subtree and reset the tail on every flip.

**Clamping** (`clampSize` in `useLayoutStore.ts`) takes the viewport as a
_parameter_ with a lazy default, so the rule is testable in the node environment.
A viewport of `0` (no window, or a hidden tab reporting nothing) means "enforce the
minimum only" — clamping to 70% of zero would collapse a good persisted size to the
floor on the next hydrate. `Math.max(ceiling, min)` guards the genuinely small
viewport where the fraction lands below the minimum. Because `partialize` writes
the raw field and hydration bypasses the setters, `onRehydrateStorage` re-runs
`setDiagHeight` / `setDiagWidth` — a size saved on a 4K monitor and restored on a
laptop is re-clamped.

**RTL — the one deliberate physical-direction deviation in the app.** Dock sides
are _physical_ (a devtools convention: "dock it to the left of my screen"), while
everything else in FlowBoard uses logical properties. CSS `direction: rtl` reverses
the main axis of a flex **row**, so a physical-left dock must become the **last**
flex child under Arabic — hence the XOR:

```ts
export function isDrawerFirst(dock: DiagDock, rtl: boolean): boolean {
  return isSideDock(dock) ? (dock === 'left') !== rtl : dock === 'top';
}
```

Columns are unaffected by direction (`top` is above `bottom` in every language), so
the top/bottom branch ignores `rtl` entirely. `rtl` is an **argument**, not an
`isRTL()` call, so the whole truth table — four docks × two directions — is a node
test.

**Narrow viewports force bottom.** `useIsNarrowViewport()` watches
`NARROW_VIEWPORT_QUERY = '(max-width: 767.98px)'` through `useSyncExternalStore`
over `matchMedia` — one event per _crossing_, not one per pixel of a drag, and no
mount-time gap between reading the value and subscribing (that gap is exactly what
renders one frame of a side dock on a phone). `useEffectiveDiagDock()` in
`useDiagDock.ts` returns `'bottom'` while narrow and the stored dock otherwise.
**The stored preference is untouched** and restored the moment the window widens:
a narrow viewport is a temporary fact about the window, not a change of mind. Both
the drawer (which paints itself) and `AppShell` (which sets the flex axis) read the
same hook, so they cannot disagree about which edge is in play.

**Resizing** — `DrawerResizeHandle.tsx`, a `role="separator"` with
`aria-orientation` (`vertical` for a side dock — the orientation is the _line_ it
draws, not the axis it moves along). It sits absolutely on the **dock-opposite
physical edge** (bottom dock → grip on top; left dock → grip on the right), because
that is the only edge facing the page. The pointer math is per-side so the panel
always grows _toward_ the pointer:

| Dock     | Size from pointer              |
| -------- | ------------------------------ |
| `bottom` | `window.innerHeight - clientY` |
| `top`    | `clientY`                      |
| `left`   | `clientX`                      |
| `right`  | `window.innerWidth - clientX`  |

Move/up listeners go on the **window**, not the handle — a fast drag outruns a 6px
grip. Keyboard resize moves `KEYBOARD_STEP = 24` px per arrow on the resize axis;
`Home`/`End` pass `0` / `Number.MAX_SAFE_INTEGER` and let the store's clamp resolve
them to the extremes.

### 3.2 The poll store

`apps/web/src/stores/useDiagLogsStore.ts`.

| Constant / field   | Value                                                                               |
| ------------------ | ----------------------------------------------------------------------------------- |
| `POLL_INTERVAL_MS` | `2000`                                                                              |
| `LOGS_CAP`         | `1000` retained records, drop-oldest                                                |
| `RENDER_ROW_CAP`   | `500` painted rows (`diag-chrome.ts`) — copy still serializes the full filtered set |
| `lastId`           | the cursor, sent back as the next `sinceId`                                         |
| `paused`           | stops **fetching**, not just rendering                                              |
| `minLevel`         | `LevelFilter = 'all' \| LogLevel`, applied **at render**                            |
| `error`            | localized failure string, cleared by the next successful request                    |

**Zustand, not TanStack Query, on purpose:** Query caches an _answer_; this store
accumulates a _conversation_. Each poll returns only what is newer than the cursor,
so the useful value is the union of every response so far — a shape Query's cache
would fight (`select` cannot append, and a refetch would blow away the history).

**Never persist this store.** Log lines carry user emails and ids — the reason the
route is global-admin only — and writing them to `localStorage` would leave them on
the disk of whatever machine an admin happened to debug from.

The polling window is **`LogList`'s lifetime**: `startPolling()` on mount,
`stopPolling()` on unmount, and the drawer only renders `LogList` when it is open
and the viewer is a global admin. So the loop exists exactly while an admin is
looking at it; closing the drawer stops it, and so does signing out.

Two guards make the append idempotent:

- **Single-flight** — a module-scoped `pollInFlight` flag makes overlapping
  `poll()` calls no-op, released in `finally` even on a rejected request.
- **Strictly-newer append** — `snapshot.records.filter(r => r.id > state.lastId)`.

Without them, two polls at the same cursor both fetch `sinceId=<n>` and both append
the same records: a duplicate `key={record.id}` and a doubled tail. That happens
more easily than it sounds — StrictMode's double effect, a tick landing on a slow
request, or `resume()` racing the loop. `pollTimer` is likewise module-scoped and
**cleared before it is set**, so a StrictMode double mount or an HMR reload can
never leave two loops running against one cursor.

Snapshots are `serverLogsSnapshotSchema.safeParse`d and a malformed one is
**dropped silently**, not surfaced — deliberately _not_ the api client's `schema`
option. The drawer is what an admin debugs a broken deploy with, and turning one
bad frame into a red error state would hide the tail that explains it.

### 3.3 Restart rewind

`tsx watch` restarts the API on every save, and `nextId` resets to 1. The first
branch inside `poll()`'s `set()` handles it:

```ts
if (snapshot.lastId < state.lastId) return { records: [], lastId: 0 };
```

A snapshot whose head sits **below** the cursor means a new generation of the ring.
Keeping the old records would collide their ids with the new ones; keeping the old
cursor would filter every incoming record out forever — **a tail that silently goes
dead**. Start over instead, and the next tick streams the young ring from 0. A
`paused` check runs first (a pause can land between the `await` and the `set`).

### 3.4 Stick to bottom, and the rest of the list

`LogList.tsx` keeps `stickRef` as a **ref, not state** — it must not re-render.

- After every change in row count: if `stickRef.current`, scroll to
  `scrollHeight` and hide the jump pill; otherwise show it.
- `onScroll` recomputes `stickRef.current = isNearBottom(element)`, where
  `isNearBottom` (in `diag-chrome.ts`) is
  `scrollHeight - scrollTop - clientHeight <= 24`. It takes the three plain numbers
  rather than an `HTMLElement`, so the behaviour that matters — "a user who
  scrolled up keeps their place" — is arithmetic with a DOM-free test.
- The **jump pill** (`fb-diag-jump`) scrolls to the bottom, re-arms the stick, and
  hides itself.

Filtering is a **render** concern: the store keeps every record it was sent, so
raising the minimum level and lowering it again _reveals_ the hidden lines rather
than having thrown them away. `LEVEL_FILTER_CHOICES = ['all','debug','info','warn','error']`
— `trace` and `fatal` are absent on purpose: they are ends of the scale, not useful
floors.

**Copy is JSONL** — `logsToJsonl(filterByMinLevel(records, minLevel))`, one
`JSON.stringify` per record joined by `\n`, no trailing newline. JSONL rather than a
JSON array because that is what `jq`, `pino-pretty` and a grep on the other end of a
paste already read. `copyText()` is best-effort: it never throws and never rejects
(`navigator.clipboard` is absent over plain HTTP), and returns whether the API was
reachable at all. The drawer reads `records` through `getState()` at click time
rather than subscribing — the copy must be of what is on screen at the click.

**Non-modal, spelled out:** `useLayoutStore.closeAllOverlays()` closes the palette
and the mobile nav and **deliberately excludes `diagOpen`** — a global Escape must
not kill a running tail. The drawer instead handles Escape only when focus is
inside it (`onKeyDown` → `stopPropagation()` + `setDiagOpen(false)`), so Escape
closes it when you are working in it but never from across the app. `diagOpen` is
also **not persisted**: restoring a reload into an open devtools panel is
disorienting.

**Admin gating happens twice.** The drawer renders `null` for a non-admin and
registers neither its topbar slot nor its shortcuts, so Ctrl+J keeps its browser
meaning for everyone else. That is presentation only — the server enforces
`requireGlobalAdmin` on `/api/admin/logs` regardless, and that is the boundary that
matters. The admin flag is read the same way `routes/guards.tsx` reads it: the
`/auth/me` response when it has arrived, the persisted `useAuthStore` flag while it
is in flight, so the drawer does not blink out of existence on every reload.

**And it is the EFFECTIVE flag** (R2 W3.5): the ladder above is ANDed with
`!viewingAsMember`, so an admin previewing member view gets no trigger, no chords
and no panel. The drawer is chrome, and admin.md §4.1's rule for chrome is that
every surface reads `isEffectiveGlobalAdmin()` — it is listed there as a consumer.

## 4. Keyboard

Both chords are registered through the central registry
(`registerShortcut` in `apps/web/src/lib/shortcuts.ts`) rather than as loose
listeners, so the shortcut cheat sheet can list them truthfully and a collision is
loud rather than silent. Both are registered **only for an effective global admin**
(§3.x above: the real flag AND `!viewingAsMember`).

| Chord         | `id`                    | Action                                                   | `allowInInputs` |
| ------------- | ----------------------- | -------------------------------------------------------- | --------------- |
| `mod+j`       | `diagnostics.toggle`    | `toggleDiag()`                                           | `true`          |
| `mod+shift+j` | `diagnostics.cycleDock` | `cycleDiagDock()`, and opens the drawer if it was closed | `true`          |

`mod` is Ctrl **or** Cmd (`event.ctrlKey || event.metaKey`). Both set
`allowInInputs: true` — **a devtools toggle that stops working because the cursor
is in a search box is a devtools toggle you stop trusting.** A matched chord is
consumed (`preventDefault` + `stopPropagation`), which is what takes Ctrl+J away
from the browser's downloads panel — for admins only.

**Registration order is not load-bearing.** `matchChord` enforces Shift in both
directions for an alphanumeric key (`shiftIsModifierFor`), so `mod+j` and
`mod+shift+j` are genuinely distinct chords. The order in `DiagnosticsDrawer.tsx`
is kept only because the cheat sheet lists chords in registration order.

The topbar trigger (`fb-diag-trigger`) is the discoverable half: a keyboard-only
entry point is invisible. It is registered through `registerTopbarSlot` at
`order: 30` (the slot the registry reserves for diagnostics) from inside the same
admin guard, so a non-admin's topbar has no button rather than a button that
refuses.

## 5. Testids

Every `data-testid` under `apps/web/src/components/diagnostics/`. E2E specs depend
on these — **treat renaming one as a breaking change.**

| Testid                   | File                     | Identifies                                                                  |
| ------------------------ | ------------------------ | --------------------------------------------------------------------------- |
| `fb-diag-trigger`        | `DiagnosticsDrawer.tsx`  | Topbar toggle button (`aria-pressed` reflects open state)                   |
| `fb-diag-drawer`         | `DiagnosticsDrawer.tsx`  | The `<section role="region">`; also carries `data-dock={dock}`              |
| `fb-diag-paused`         | `DiagnosticsDrawer.tsx`  | The "paused" pill in the header, present only while paused                  |
| `fb-diag-level`          | `DiagnosticsDrawer.tsx`  | Min-level filter trigger; carries `data-min-level={minLevel}`               |
| `fb-diag-level-{choice}` | `DiagnosticsDrawer.tsx`  | One radio item per `LEVEL_FILTER_CHOICES` — `all\|debug\|info\|warn\|error` |
| `fb-diag-pause`          | `DiagnosticsDrawer.tsx`  | Pause / resume toggle (`aria-pressed`)                                      |
| `fb-diag-clear`          | `DiagnosticsDrawer.tsx`  | Clear the view (keeps the cursor)                                           |
| `fb-diag-copy`           | `DiagnosticsDrawer.tsx`  | Copy the filtered tail as JSONL                                             |
| `fb-diag-dock-cycle`     | `DiagnosticsDrawer.tsx`  | Dock cycle button; its glyph is the **current** dock                        |
| `fb-diag-close`          | `DiagnosticsDrawer.tsx`  | Close the drawer                                                            |
| `fb-diag-resize`         | `DrawerResizeHandle.tsx` | The drag/keyboard `role="separator"` grip                                   |
| `fb-diag-list`           | `LogList.tsx`            | The scroller                                                                |
| `fb-diag-empty`          | `LogList.tsx`            | Empty state (or the paused hint)                                            |
| `fb-diag-error`          | `LogList.tsx`            | Request-failure message, shown instead of the empty state                   |
| `fb-diag-jump`           | `LogList.tsx`            | "Jump to latest" pill, visible only when stick-to-bottom released           |
| `fb-diag-row`            | `LogList.tsx`            | One log row; carries `data-level` and `data-log-id`                         |
| `fb-diag-row-time`       | `LogList.tsx`            | The `HH:mm:ss.SSS` column                                                   |
| `fb-diag-level-badge`    | `LogList.tsx`            | The tinted severity badge on a row                                          |
| `fb-diag-row-msg`        | `LogList.tsx`            | The message text                                                            |
| `fb-diag-chip`           | `LogList.tsx`            | One context chip from `CONTEXT_CHIP_KEYS`                                   |
| `fb-diag-context`        | `LogList.tsx`            | The `<details>` holding the full JSON context                               |

`CONTEXT_CHIP_KEYS = ['userId', 'projectId', 'taskId', 'scope']` is an
**allowlist**, not "the first three keys": those four are the ids you scan a log
with in this app, and everything else stays behind the expander where it cannot
push the message off the row. `formatLogTime` is hand-padded rather than
`Intl.DateTimeFormat` — a devtools column must be fixed-width, 24-hour and
millisecond-precise in every locale, three things the locale-aware formatter would
each undo.

## 6. Storage keys

The drawer persists **preferences only**, all under one key.

| Key            | Storage        | Owner            | Holds                                                                                                                |
| -------------- | -------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| `fb-layout-v1` | `localStorage` | `useLayoutStore` | `sidebarCollapsed`, `diagDock`, `diagHeight`, `diagWidth` (persist `version: 1`)                                     |
| `fb-auth-v1`   | `localStorage` | `useAuthStore`   | `accessToken`, `refreshToken`, `user` — the source of the admin flag the drawer gates on ([auth.md](./auth.md) §7.2) |

Not persisted, and each for a reason: **`diagOpen`** (restoring a reload into an
open devtools panel is disorienting, not helpful), **`minLevel` / `paused`**
(session-scoped view state), and **the records themselves** (§3.2 — they carry user
emails and ids).

`LAYOUT_STORAGE_VERSION = 1` exists because WP4.4 dropped a placeholder `diagTab`
field: the drawer shipped **tab-less** — one surface, the log tail — and zustand's
default merge is a shallow spread of the stored object over the initial state,
which would otherwise resurrect `diagTab` as a stray field on every hydrate,
forever. `migrate` is written as a **whitelist** rather than a `delete`, so any
future stray a rolled-back build wrote is left behind too. New keys follow the
`fb-<name>-v1` convention — see [coding-standards.md](./coding-standards.md).

Back to [docs/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
