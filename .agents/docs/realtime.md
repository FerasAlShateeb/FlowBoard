# Realtime

Socket.IO 4 on the default namespace: a JWT-gated handshake, two kinds of room,
fourteen typed events, an in-memory presence roster, and the echo-suppression
mechanic that keeps a dragged card from jumping. Read this before you add a
socket event, change what a mutation broadcasts, write to a cache from a
listener, or wonder why the tab that made a change does not receive it.

The domain-events bus this all hangs off is [architecture.md](./architecture.md)'s
subject; the handshake's token and `tokenVersion` semantics are
[auth.md](./auth.md)'s. This doc starts where "a socket is connected" begins.

## 1. The shape of the system

| Piece              | File                                                                                            | What it owns                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Wire contract      | `packages/shared/src/socket/events.schema.ts`                                                   | Every payload schema, `SOCKET_EVENTS`, both typed event maps.   |
| Gateway            | `apps/api/src/sockets/io.ts`                                                                    | Handshake, identity, `user:{id}`, the server singleton.         |
| Room protocol      | `apps/api/src/sockets/rooms.ts`                                                                 | The three client→server handlers, membership checks, throttle.  |
| Presence store     | `apps/api/src/sockets/presence.ts`                                                              | Two in-memory maps. No table, no Redis.                         |
| Bridge             | `apps/api/src/sockets/realtime-bridge.ts`                                                       | Domain event → hydrate → parse → emit.                          |
| Socket-layer reads | `apps/api/src/sockets/socket-reads.ts`                                                          | The four SELECTs no service exposes.                            |
| Domain-event bus   | `apps/api/src/utils/domain-events.ts`                                                           | `publishDomainEvent` / `onDomainEvent`, the typed catalogue.    |
| Origin header      | `apps/api/src/middlewares/socket-id.ts`                                                         | `X-Socket-Id` → `res.locals.socketId`.                          |
| Client singleton   | `apps/web/src/lib/socket.ts`                                                                    | One connection per tab, status, `X-Socket-Id` provider.         |
| Cache mapping      | `apps/web/src/lib/realtime-cache.ts`                                                            | Every event → its `setQueryData` / `invalidateQueries`.         |
| Cache algebra      | `apps/web/src/lib/board-cache.ts`                                                               | The writers both the local and the socket path share.           |
| Lifecycle hooks    | `apps/web/src/hooks/useRealtime.ts`                                                             | Connect, join, parse-then-dispatch, reconnect.                  |
| Headless mount     | `apps/web/src/components/layout/RealtimeBridge.tsx`                                             | Resolves the project from the URL; registers the presence slot. |
| Presence UI        | `apps/web/src/components/layout/PresenceAvatars.tsx`, `apps/web/src/stores/usePresenceStore.ts` | The avatar row and its store.                                   |

**Transport facts.** Default namespace (no `/games`-style split). JWT in
`handshake.auth.token`, falling back to the `Authorization` header.
`serveClient: false`. CORS pinned to `env.WEB_ORIGIN` with `credentials: true`.
`InterServerEvents` is declared `Record<string, never>` — **FlowBoard runs a
single Socket.IO node**, and both the presence design (§5) and the absence of an
adapter follow from that.

## 2. The complete event map

Every name lives in `SOCKET_EVENTS` in
`packages/shared/src/socket/events.schema.ts`. **Import the constant; never type
the string** — a rename is then a compile error rather than a listener that
silently never fires.

### 2.1 Client → server (3)

| Event             | Payload                                     | Ack                   | Emitter (web)                                                     | Effect                                                                                  |
| ----------------- | ------------------------------------------- | --------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `project:join`    | `{ projectId: uuid }`                       | `SocketAck`           | `emitProjectJoin()` in `lib/socket.ts`, from `useProjectRealtime` | Membership-checked; joins `project:{projectId}`, seeds presence, broadcasts the roster. |
| `project:leave`   | `{ projectId: uuid }`                       | `SocketAck`           | `emitProjectLeave()`                                              | Leaves the room; drops the presence record; re-broadcasts.                              |
| `presence:update` | `{ projectId: uuid, taskId: uuid \| null }` | **none, by contract** | `emitPresence()`, from `useReportPresence`                        | Throttled re-point of this socket's presence record.                                    |

`ClientToServerEvents` declares the ack callback for the two room events and
**not** for `presence:update`. That asymmetry is the contract: a join has an
answer worth learning, a presence ping does not.

### 2.2 Server → client (11)

`projectTarget` = `io.to(projectRoom(projectId)).except(originSocketId ?? '')`.

| Event              | Payload                                                                                                            | Emitted by                                | Room                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | -------------------------------------- |
| `presence:state`   | `{ projectId, entries: { user: { id, name, avatarUrl }, taskId }[] }`                                              | `broadcastRoster()` in `sockets/rooms.ts` | `project:{id}` — **no `except`**       |
| `task:created`     | `{ projectId, task: TaskSummary }`                                                                                 | bridge ← `task.created`                   | `project:{id}` minus origin            |
| `task:updated`     | `{ projectId, task: TaskSummary, changedFields?: string[] }`                                                       | bridge ← `task.updated`                   | `project:{id}` minus origin            |
| `task:deleted`     | `{ projectId, taskId }`                                                                                            | bridge ← `task.deleted`                   | `project:{id}` minus origin            |
| `task:moved`       | `{ projectId, taskId, statusId, boardRank: string, rebalanced: boolean, updatedAt: string }`                       | bridge ← `task.moved`                     | `project:{id}` minus origin            |
| `comment:created`  | `{ projectId, taskId, comment: Comment }`                                                                          | bridge ← `comment.created`                | `project:{id}` minus origin            |
| `comment:updated`  | `{ projectId, taskId, comment: Comment }`                                                                          | bridge ← `comment.updated`                | `project:{id}` minus origin            |
| `comment:deleted`  | `{ projectId, taskId, commentId }`                                                                                 | bridge ← `comment.deleted`                | `project:{id}` minus origin            |
| `sprint:changed`   | `{ projectId, sprintId, action: 'created'\|'updated'\|'started'\|'completed'\|'deleted', sprint: Sprint \| null }` | bridge ← `sprint.changed`                 | `project:{id}` minus origin            |
| `workflow:changed` | `{ projectId, statuses: Status[], transitions: Transition[] }`                                                     | bridge ← `workflow.changed`               | `project:{id}` minus origin            |
| `notification:new` | `{ notification: Notification, unreadCount: number }`                                                              | bridge ← `notification.created`           | `user:{recipientId}` — **no `except`** |

**Payloads carry `taskSummarySchema`, not the full task.** These events patch
board caches; the detail sheet refetches separately. Broadcasting the detail
shape would ship every card's whole description to every listener on every
keystroke of somebody else's edit.

**Every payload includes `projectId`** so a listener can route to a cache key
without consulting the room it arrived on. The one exception is
`notification:new`, which is addressed to a person and may belong to no project.

Two registries pair each name with its schema:
`serverToClientEventSchemas` (what the browser parses an incoming payload with)
and `clientToServerEventSchemas` (what the gateway validates on). Both are
`as const` objects keyed by the wire name.

**`task:moved` carries `updatedAt` (WP5.6), and it is not decoration.** Every
other task write in the product is ordered by the server's `updated_at` stamp —
`isStaleTaskWrite` in `apps/web/src/lib/board-cache.ts` — so a broadcast and the
HTTP response describing the same edit can arrive either way round without the
older one repainting the card. `task:moved` used to be the single exception: it
carried a destination and a rank and no version at all, so two moves of one card
delivered out of order left the board showing the first until something
refetched. The stamp is read **inside the move transaction**
(`UPDATE … RETURNING`, `apps/api/src/services/tasks.service.ts`) rather than
from a post-commit re-read, for the same reason the audience ids are: a re-read
can pick up a _later_ writer's timestamp and make this move look newer than the
edit that actually followed it, inverting the ordering the stamp exists to fix.
A rebalance does not disturb it — that rewrite is raw SQL and never runs
Drizzle's `$onUpdate` hook.

### 2.3 `sprint:changed` and `workflow:changed`, and why they are shaped that way

`sprint:changed` is **one event for the whole lifecycle**, discriminated by
`action`, because every listener does the same thing regardless of which change
it was: invalidate the sprint list and the backlog. `sprint` is `null` for
`deleted` — and also whenever the read fails, because a backlog that learns
"something happened to this sprint" and invalidates is strictly better than one
that learns nothing.

`workflow:changed` carries the **entire** new workflow rather than a diff, so an
open board re-renders its columns and its forbidden-drop styling from the payload
alone: no refetch, and no flash of a board still drawn with the old column set.
The bus's internal `change: 'statuses' | 'transitions' | 'labels'` discriminator
has no wire counterpart on purpose.

## 3. Rooms

### 3.1 `user:{userId}` — automatic

Joined in `io.ts`'s `connection` handler, before anything else:
`void socket.join(userRoom(userId))`. It carries exactly one event,
`notification:new`. A notification is addressed to a person, not a project, and
several kinds (a due-soon reminder) belong to no project at all.

The web subscribes to it from `useGlobalRealtime()`, which is tied to the
**session**, not to a project. `USER_EVENTS = ['notification:new']`. Folding this
into the project subscription — the mistake the split exists to avoid — would
make the notification bell silently dead on `/notifications`, `/me` and every
`/admin/*` page.

### 3.2 `project:{projectId}` — on demand, membership-checked

`handleJoin` in `apps/api/src/sockets/rooms.ts` runs four steps, in order, and
each has its own ack code:

| Step                                                                  | Failure ack                                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `projectRoomPayloadSchema.safeParse`                                  | `{ ok: false, code: 'BAD_REQUEST', message: 'Invalid payload' }`                      |
| `loadProjectRef(projectId)` — live projects only, `deletedAt IS NULL` | `{ ok: false, code: 'NOT_FOUND', message: 'Project not found' }`                      |
| `resolveProjectRole(...)` returns `null`                              | `{ ok: false, code: 'FORBIDDEN', message: 'You do not have access to this project' }` |
| Handler throws                                                        | `{ ok: false, code: 'INTERNAL', message: 'Could not join the project' }` (logged)     |
| Success                                                               | `{ ok: true }`                                                                        |

`socketAckSchema` is `{ ok: boolean, code?: string, message?: string }` — one
shape for every client→server event, with a **stable `code`** so a join denied by
membership is distinguishable from a transport failure. One is a retry and the
other is not.

**Every join is membership-checked, and the result is acked rather than
assumed.** A project room carries task titles, comment bodies and who is reading
what. `resolveProjectRole` is the same function `requireProjectRole` uses,
exported for exactly this, and it runs the full inheritance chain — global admin
⊃ org admin ⊃ project member. `viewer` is the floor: reading a board is a read,
and the room only ever carries reads. `apps/api/src/sockets/__tests__/gateway.test.ts`
pins all six outcomes (member, viewer, non-member, org member without the
project, org admin, global admin).

**The failure mode without the ack** is the reason it exists: a client that
silently failed to join renders a board that never updates, which is
indistinguishable from a quiet project. `useProjectRealtime` therefore
`console.warn`s `[realtime] project:join refused (<code>)` on `!ack.ok` rather
than failing open.

**`project:leave` always succeeds** — leaving a room you are not in is a no-op —
and the roster is broadcast **after** the removal, to the room the leaver has
already left, so a departing client does not receive its own removal.

Nothing on a socket mutates domain data. **A socket is a subscription, not a
second API**; the browser still writes over HTTP.

## 4. Echo suppression — the core mechanic

### 4.1 The chain

```text
web mutation
  → lib/api.ts execute(): method !== 'GET' → headers['X-Socket-Id'] = socketIdProvider()
  → middlewares/socket-id.ts: res.locals.socketId = <header or null>
  → controller: getSocketId(res) → actor.socketId
  → service: publishDomainEvent('task.moved', { …, originSocketId: actor.socketId })
  → sockets/realtime-bridge.ts: io.to(projectRoom(projectId)).except(originSocketId ?? '')
```

Each link has a rule worth knowing:

- **The provider is a function, registered at import time.**
  `apps/web/src/lib/socket.ts` ends with `setSocketIdProvider(getSocketId)` at
  module scope — not in a hook — because a mutation fired before any component
  mounted a realtime hook must still carry the header. It is a function rather
  than a value because **the id changes on every reconnect**.
- **Only mutations send it.** `if (method !== 'GET')` — a GET produces no
  broadcast to suppress.
- **The header is untrusted input.** `socket-id.ts` length-checks it
  (`MAX_SOCKET_ID_LENGTH = 64`; Socket.IO ids are 20 chars) before it can end up
  in a room name. Anything unusable becomes `null`, never an exception.
- **`?? ''` is the no-origin case.** A server-side actor, a curl request, a client
  with no socket. The empty string is a room nobody is in, so `except('')`
  excludes nobody and everyone in the project room receives the event.
- **There is exactly one place `except()` could be forgotten.**
  `projectTarget()` is a helper rather than an inline chain precisely so that
  place is one line, and `realtime-bridge.test.ts` asserts the contract directly
  ("delivers `task:moved` to the other tab and NOT to the origin socket",
  "delivers to every tab when the event has no origin socket").

### 4.2 The invariant

> **The actor's cache is written by its optimistic update plus the HTTP
> response — never a third time by its own broadcast.**

That is why `apps/web/src/lib/realtime-cache.ts` contains **no** "did I cause
this?" check anywhere. It cannot arrive: the server already excluded this tab's
socket id, so an event reaching those functions is by construction somebody
else's, which is exactly what lets them write caches unconditionally.

**What breaks without it.** A drag lands twice. The tab paints the card at its
new rank optimistically, the mutation response confirms it, and then an
asynchronous third write arrives carrying a state that is at best redundant and
at worst older than a local edit the user has since made — so the card jumps.
Implementing the check on the client instead would mean every listener knowing
its own socket id and every payload carrying an actor id the browser has no other
use for (§4.3).

**`originSocketId` never crosses the wire.** It is consumed by `except()` and
stripped by the payload parse. Forwarding it would invite a client to implement
echo suppression a second time, wrongly.

### 4.3 Presence is deliberately outside this

`broadcastRoster` uses a plain `io.to(projectRoom(projectId))` with no `except`,
and `notification:new` uses `io.to(userRoom(recipientId))` with none either.

- Presence: the joiner needs the **initial roster**, and the roster is a
  whole-set fact rather than a patch (§5). There is nothing to double-apply.
- Notifications: the fan-out never writes a row for the actor, so a
  `notification.created` a tab caused is by construction addressed to somebody
  else. Excluding the origin socket would only matter if you could notify
  yourself, and you cannot.

## 5. The bridge: hydrate, then parse, then emit

`apps/api/src/sockets/realtime-bridge.ts` is the one place the decoupling's two
halves meet. `registerRealtimeBridge()` is called once from `bootstrap()` and is
**idempotent by guard** (`if (unsubscribes.length > 0) return`) — a second call
with handlers still registered would double every broadcast, and a hot reload is
exactly the situation that produces one.

### 5.1 A domain event is not a socket payload

The bus carries the **minimum a subscriber needs to act** — ids and flags. The
wire contract carries the **hydrated entity the browser renders**. Turning one
into the other is this file's actual work, and it means most handlers do a read.

| Domain event              | Read performed                                                                     | Emits              |
| ------------------------- | ---------------------------------------------------------------------------------- | ------------------ |
| `task.created`            | `getTask(taskId)` → `toTaskSummary()`                                              | `task:created`     |
| `task.updated`            | `getTask(taskId)` → `toTaskSummary()`, forwards `changedFields`                    | `task:updated`     |
| `task.moved`              | **none** — the bus payload is `Pick`ed from `TaskMovedPayload`                     | `task:moved`       |
| `task.deleted`            | none — ids only; the row is gone                                                   | `task:deleted`     |
| `comment.created/updated` | `loadComment(commentId)` (`socket-reads.ts`)                                       | `comment:*`        |
| `comment.deleted`         | none — ids only                                                                    | `comment:deleted`  |
| `sprint.changed`          | `requireSprint(db, projectId, sprintId)`, or `Promise.resolve(null)` for `deleted` | `sprint:changed`   |
| `workflow.changed`        | `Promise.all([listStatuses, listTransitions])`                                     | `workflow:changed` |
| `notification.created`    | `loadNotificationPush(notificationId, recipientId)` (`socket-reads.ts`)            | `notification:new` |

**Reads go through services wherever a service exists** — `getTask`,
`requireSprint`, `listStatuses`, `listTransitions`. The four that have no service
to call go through `apps/api/src/sockets/socket-reads.ts`, which is **one of the
three documented exceptions** to the layering rule
([architecture.md](./architecture.md) §3.2) and says why in its header: a user
summary for presence, project → org id for the membership check, one comment by
id, and one notification plus its recipient's unread count. Everything in that
file is a SELECT; it never writes and holds no business rules.

**`task.moved` does no read on purpose.** The drop is the most latency-sensitive
event in the product, so its bus payload is `Pick`ed straight from
`TaskMovedPayload` and broadcasts through. That `Pick` is also why `updatedAt`
needs no line in the bridge: the move service stamps it inside its transaction,
the spread forwards it, and `parse()` would reject a payload missing it. Stamping
it here instead would both reintroduce a read and record a time from _after_ the
commit.

#### The internal fields, and the one that is not internal

Three things ride the bus for `task.moved` and never reach the wire —
`parse()` strips them:

| Bus-only field                              | Who consumes it                                                                                                                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actorId`                                   | the notification fan-out, to avoid notifying the person who acted                                                                                                            |
| `statusChanged`                             | `notifications.service` — a cross-column drop is news, a same-column reorder is not, and the wire payload (which carries only the destination status) cannot tell them apart |
| `assigneeIdAtCommit` / `reporterIdAtCommit` | the {@link AudienceSnapshot} — see below                                                                                                                                     |

**`AudienceSnapshot`** (`apps/api/src/utils/domain-events.ts`) is the task's
audience-defining columns _as they stood in the publishing transaction_. The
fan-out runs after the publisher committed, and it used to answer "who cares
about this task?" with a fresh `SELECT`. That read is a different moment in time
from the event: reassign a task from Ada to Ben while a status change is still in
flight and the notification goes to **Ben** — someone who had nothing to do with
the task when it moved — while Ada, whose task it was, gets nothing.

Watchers are deliberately **not** snapshotted, and the split is about the
direction of the error. Assignee and reporter are exclusive roles, so a late read
_substitutes_ a recipient — a correctness bug. Watchers are an additive,
self-service set, so a late read at worst sends one extra notification to
somebody who just asked to hear about that task. Snapshotting a whole set into
every event would cost a read on the hottest path in the product to prevent
nothing.

`realtime-bridge.test.ts` asserts the exact key list on the delivered payload
rather than sampling it, so a `parse()` that started stripping too much is caught
as readily as one stripping too little — `updatedAt` is the counter-example that
keeps that assertion honest, being on the bus _and_ on the wire.

### 5.2 Parse before emit — always, in every environment

Every handler ends in `<payload>Schema.parse({...})` inside the `emit()` call.
The cost is one zod parse of an object we just built. The benefit is threefold:

1. The project's "zod at every boundary, both ends" rule holds on the socket
   boundary too.
2. A hydration bug — a `Date` that never became an ISO string — surfaces **here**
   as a logged, dropped emit rather than as a client-side parse failure that
   leaves a board half-patched.
3. **It strips internal fields.** `parse()` drops unknown keys, so the spread that
   makes the pass-through cheap cannot leak one.

That third point is load-bearing. What the bus carries and the wire does not:

| Internal field     | On which event      | Why it stays internal                                                                                                           |
| ------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `actorId`          | every project event | The socket layer already routes by room; telling every viewer which user id caused a change is a privacy leak with no consumer. |
| `originSocketId`   | every project event | Consumed by `except()` here. Forwarding it invites a second, wrong client-side implementation.                                  |
| `statusChanged`    | `task.moved`        | The notification fan-out needs "between columns vs. within one"; a browser re-renders the card either way.                      |
| `mentionedUserIds` | `comment.*`         | The mention fan-out's input, not the thread's.                                                                                  |
| `change`           | `workflow.changed`  | The wire ships the whole workflow, so the browser never needs to know which third moved.                                        |

The one field that **is** forwarded because a receiver cannot re-derive it is
`changedFields` on `task:updated` — see §7.2. `realtime-bridge.test.ts` has a
test named "does not leak internal domain-event fields onto the wire".

A parse that throws is caught by the bus: `publishDomainEvent` logs and swallows
handler errors by contract, so **a malformed emit can never fail the mutation
that already committed**.

### 5.3 `user.revoked` — the one event that emits nothing

`user.revoked` is account-scoped and carries no `DomainEventContext`: there is no
project, no originating tab to exclude (the point is that **every** tab goes), and
the actor is an administrator whose own session is untouched. It is published when
`token_version` is bumped — a deactivation, an admin force-logout, or a password
reset — and the bridge's handler is one line:

```ts
onDomainEvent('user.revoked', ({ userId }) => {
  tryGetIo()?.in(userRoom(userId)).disconnectSockets(true);
});
```

**Why it has to exist.** Bumping `token_version` stops the next HTTP request and
the next socket **handshake** — both re-check it. It does nothing to a socket
that is _already_ connected, because that check ran once, at connect time. A
deactivated user therefore kept receiving live board and notification traffic
until they happened to reconnect. This closes that window.

`disconnectSockets(true)` closes the underlying connection rather than just
leaving the rooms, so the client's reconnect attempt performs a **fresh
handshake** — which now fails the `tokenVersion` check and surfaces as an auth
error the client handles per §8.5. `tryGetIo()` (not `getIo()`) because a
deactivation can happen in a script with no gateway attached; that is a run with
no listeners, not an error.

**An empty read is a skipped emit, never a throw.** The event fires after the
transaction committed, so a row that vanished in the meantime means there is
nothing to broadcast. `skip()` logs `'Realtime bridge could not hydrate an event
— emit skipped'` and returns.

**`projectTarget()` returns `null` when the gateway was never initialised** — a
script (`seed.ts`, a migration) can publish with no server attached. That is a run
with no listeners, not an error, and it must not throw inside a domain-event
handler.

## 6. Presence

### 6.1 The server's two maps

`apps/api/src/sockets/presence.ts` holds exactly two structures and no table:

```ts
const byProject = new Map<string, Map<string, PresenceRecord>>(); // projectId → socketId → record
const socketProjects = new Map<string, Set<string>>(); // socketId → projects (the disconnect index)
```

A `PresenceRecord` is `{ socketId, user: UserSummary, taskId: string | null }`.

**In-process and ephemeral, deliberately.** Presence is the shortest-lived fact
in the product: true while a socket is open, meaningless the moment it closes.
Persisting it would mean a row per navigation and then owning stale rows after a
crash — a table whose only correct state is "empty" on every restart. A `Map`
restarts empty for free, and FlowBoard runs a single node.

**The unit is a socket; the roster is per user.** Bookkeeping is keyed by socket
id because that is what joins, leaves and disconnects — one person with the board
open in two tabs is two sockets, and closing one must not remove their avatar.
`presenceRoster()` collapses sockets into people, **preferring the tab that has a
task open** ("Ada is reading FLOW-12" is strictly more informative than "Ada is
here"), and sorts by name with an id tiebreak so two clients receiving the same
set render the same order — an unordered roster makes avatars shuffle on every
unrelated join.

**`socketProjects` exists for the disconnect.** A disconnect arrives with nothing
but a socket id and has to leave every room that socket was in; scanning every
project would be O(projects), the index makes it O(rooms this socket joined).
Both maps are only ever written through the exported functions, which is what
keeps them from drifting.

### 6.2 Lifecycle

| Moment            | What happens                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `project:join` ok | `summaryFor(socket)` (cached per socket) → `setPresence(projectId, { socketId, user, taskId: null })` → `broadcastRoster`. |
| `presence:update` | Throttled; `updatePresenceTask` → `broadcastRoster` only if something actually changed.                                    |
| `project:leave`   | `removePresence` → `broadcastRoster` only if a record was removed (skips a duplicate leave).                               |
| `disconnect`      | `removeSocket(socket.id)` returns the affected projects → one `broadcastRoster` each; the per-socket caches are dropped.   |

**There is no heartbeat and no TTL.** A presence entry lives exactly as long as
its socket; Socket.IO's own disconnect detection is the liveness signal, and the
`disconnect` handler in `rooms.ts` is the only reaper.

**The throttle is server-side, not client-side.** `PRESENCE_THROTTLE_MS = 1000`,
one accepted update per second per socket. `presence:update` fires on navigation,
and a client bug (or a hostile one) could fire it in a loop, each costing a
broadcast to every socket in the room. **The excess is dropped, not queued** —
presence is a current-state fact, so the next update supersedes the one that was
dropped. That is why `useReportPresence` may call `emitPresence` as freely as its
own state changes.

**An update for a room the socket never joined is ignored, not an implicit
join.** `updatePresenceTask` returns `false` for an absent record — presence in a
room the membership check never ran on would be a way to appear inside a project
you cannot read. It also returns `false` for a no-op repeat of the same task,
which saves the room a broadcast.

**The user summary is read once per socket.** `loadUserSummary` on the first join,
cached in `userCache` for the connection's life: a notification-only connection
that never opens a project never pays for it, and one hopping between five
projects pays once.

### 6.3 Fan-out cost

`presence:state` re-broadcasts the **full** roster rather than a diff, costing
O(people in room) per join, leave, update and disconnect. A room holds a handful
of people, so a whole-set payload is smaller than the bookkeeping a diff protocol
needs to survive a reconnect — and a diff that arrives out of order leaves a
ghost avatar on screen with nothing to correct it.

### 6.4 The client store

`apps/web/src/stores/usePresenceStore.ts` is the one store in `stores/` that is
**not** persisted. Every other store writes through zustand's `persist` to an
`fb-*-v1` key because its state is a preference; presence is server-authored and
true only while a socket is open. Restoring it from `localStorage` would paint a
roster of people who left hours ago and then correct itself on the first
`presence:state`. **Starting empty is the only correct initial value.**

- `setRoster(projectId, entries)` **replaces**, never merges — the payload is the
  whole set.
- Keyed by project, because a tab can hold caches for more than one (the org
  switcher does not unmount the app).
- `usePresenceRoster` returns a **module-scope stable `EMPTY_ROSTER`** for an
  unknown project; a fresh `[]` per render would make zustand's reference
  comparison see a change every render and re-render forever.
- `useOthersPresent` drops the reader's own entry. **Self-exclusion is a view
  concern, not a protocol one**: the server fans one payload out unchanged, and
  filtering server-side would mean building a different payload per socket. A
  `WeakMap` keyed on the roster reference preserves the input array when nothing
  is dropped.
- `useRealtime` ignores a roster whose `projectId` does not match the one it is
  subscribed to — a tab that just switched can still receive one in-flight
  broadcast from the room it left.

`PresenceAvatars` renders **nothing** when nobody else is present: an empty state
would be permanent chrome reporting the most common fact in the product. It shows
at most `MAX_VISIBLE = 5` faces plus a `+n`, a success-coloured `AvatarBadge` dot
when someone has a task open, and reads that task's key **straight out of the
query cache without subscribing** — turning it into a `useQuery` per avatar would
fire up to five requests every time somebody clicked a card.

## 7. Web cache-write mapping

This is the table a view author needs. `qk` is
`apps/web/src/lib/query-keys.ts`; the functions are in
`apps/web/src/lib/realtime-cache.ts`.

> **Patch what you can name, invalidate what you cannot.** The failure mode this
> file exists to avoid is the lazy one — invalidating `['project', id]` on every
> event. On a busy board that is a refetch of the board, the backlog, six reports
> and the activity feed several times a second, for changes that moved one card.

| Event              | Handler                | Writes (`setQueryData` / `setQueriesData`)                                                                                                                                                    | Invalidates                                                                                                                                                                                              |
| ------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task:created`     | `applyTaskCreated`     | `writeTaskSummaryEverywhere` → every `qk.tasks.all(projectId)` entry (boards upsert; flat lists patch only if they already hold the card)                                                     | `[...qk.tasks.all(projectId), 'backlog']` with `refetchType: 'none'`                                                                                                                                     |
| `task:updated`     | `applyTaskUpdated`     | `writeTaskSummaryEverywhere`                                                                                                                                                                  | `qk.task.detail(taskId)`; **and only when `changedFields` names `'dependencies'` or is absent** — `qk.task.dependencies(taskId)` (active) + `qk.project.dependencies(projectId)` (`refetchType: 'none'`) |
| `task:moved`       | `applyTaskMoved`       | `rebalanced: false` → splice the card into its column at its new `boardRank` via `upsertBoardTask` over `qk.tasks.all(projectId)`, **guarded per entry by `isStaleTaskWrite` on `updatedAt`** | `rebalanced: true` → **`qk.tasks.all(projectId)`, and nothing is spliced**; either way `qk.task.detail(taskId)`                                                                                          |
| `task:deleted`     | `applyTaskDeleted`     | `removeTaskEverywhere` — drops the card from every collection                                                                                                                                 | `removeQueries({ queryKey: qk.task.all(taskId) })` — a removal, not an invalidation                                                                                                                      |
| `comment:created`  | `applyCommentCreated`  | `bumpCommentCount(+1)` across `qk.tasks.all(projectId)`                                                                                                                                       | `qk.task.comments(taskId)`, `qk.task.detail(taskId)`                                                                                                                                                     |
| `comment:updated`  | `applyCommentUpdated`  | —                                                                                                                                                                                             | `qk.task.comments(taskId)`                                                                                                                                                                               |
| `comment:deleted`  | `applyCommentDeleted`  | `bumpCommentCount(-1)`, clamped at 0                                                                                                                                                          | `qk.task.comments(taskId)`, `qk.task.detail(taskId)`                                                                                                                                                     |
| `sprint:changed`   | `applySprintChanged`   | —                                                                                                                                                                                             | `qk.sprints.all(projectId)`, `[...qk.tasks.all(projectId), 'backlog']`, **and `qk.reports.all(projectId)` only for `started` / `completed`**                                                             |
| `workflow:changed` | `applyWorkflowChanged` | `qk.project.statuses(projectId)` ← `payload.statuses`; `qk.project.transitions(projectId)` ← `payload.transitions`                                                                            | `qk.project.detail(projectId)` — it embeds its own copy of the workflow                                                                                                                                  |
| `notification:new` | `applyNotificationNew` | `qk.notifications.unreadCount()` ← `payload.unreadCount`; prepend the row to page 1 of every existing `qk.notifications.list(true/false)` infinite cache                                      | `qk.notifications.all()` with `refetchType: 'none'`                                                                                                                                                      |
| `presence:state`   | **not in this file**   | `usePresenceStore.setRoster` — ephemeral UI state, not server-state cache                                                                                                                     | —                                                                                                                                                                                                        |

The handler table itself is typed as the shared `ServerToClientEvents` map, so
**an event added to the contract and forgotten here is a compile error**, not a
listener that silently updates nothing. `createRealtimeCacheHandlers` returns
`Omit<RealtimeHandlers, 'presence:state'>` and `useRealtime` wires that one event
to the store directly.

### 7.1 Details worth knowing before you add a row

- **`task:updated` invalidates the detail entry rather than writing it.** The
  payload is a summary; overwriting a cached `Task` with it would lose the
  description, watchers and dependency lists the sheet renders. Invalidation
  refetches only if a sheet is actually open.
- **A flat list is a filtered page.** `writeCollections` in
  `apps/web/src/lib/board-cache.ts` patches a row a list already holds but **never
  inserts** one it does not — deciding a task now qualifies for "assigned to me"
  is the server's call. Boards upsert; lists patch. The closing
  `invalidateQueries({ refetchType: 'none' })` is what reconciles membership on
  the next focus.
- **The remote and local paths share one writer.**
  `writeTaskSummaryEverywhere` (socket) and `writeTaskEverywhere` (local
  mutation) sit on one `writeCollections` core. The two used to be separate
  implementations and had already drifted — only one of them patched the
  `qk.tasks.byKey` entry a deep link renders from. `removeTaskEverywhere` is
  literally the same function both delete paths call.
- **`scheduleProjectRefresh` is the only sanctioned whole-project
  invalidation**, and it is debounced by `PROJECT_REFRESH_DEBOUNCE_MS = 300`,
  keyed per project so two open projects cannot cancel each other. The events
  that need it arrive in bursts — a sprint completing re-ranks every incomplete
  task, a reconnect replays whatever was missed — and each alone would trigger a
  full refetch. Fifty refetches become one, at the cost of up to 300 ms of
  staleness on a change this tab did not make.
- **The notification splice only touches caches that already exist.**
  `setQueriesData` skips absent entries by construction; seeding one would hand
  the next `useInfiniteQuery` a single-row page with fabricated `meta` — a "Load
  more" button computing its next page from a total of one. It is de-duplicated
  by id (a reconnect can replay a push the list already holds, and a doubled row
  in a notification centre is a support ticket) and returns the **same reference**
  when there is nothing to do, so an untouched cache does not re-render every
  subscriber.

### 7.2 `changedFields` — the one forwarded hint

`task:updated` collapses **four** different mutations: a field patch, a backlog
re-rank, a dependency edge, and a confirmed attachment. The new summary alone
cannot tell them apart, because a dependency edge changes no field the summary
carries.

The one cache that needs the distinction is the Roadmap's arrow layer,
`qk.project.dependencies(projectId)` — it lives **outside** the `qk.tasks` prefix
and is therefore missed by every task invalidation. Before `changedFields`
existed the client invalidated the whole edge set on **every** remote keystroke.

**Absent means unknown, not "nothing changed".** The field is optional on the
wire; a publisher that cannot enumerate its change omits it, and
`touchedDependencies()` treats `undefined` as "maybe" and invalidates. Treating it
as "no" would silently stop updating the arrows for any future publisher that
forgets the field. The values are loose `string[]`, not an enum — this is a
**hint for cache targeting**, and a closed enum would turn adding a column into a
wire-contract change.

## 8. Connection lifecycle and reconnect

### 8.1 The client singleton

One connection per tab, for the whole session (`apps/web/src/lib/socket.ts`).
Every project view, the bell and the presence stack want realtime; N connections
would mean N handshakes, N `user:{id}` memberships and N socket ids — with only
one of them in `X-Socket-Id`, so **echo suppression would fail for the other
N−1**.

- **`autoConnect: false`.** The connection opens when a session exists, not when
  the module is first imported. Importing it from a login page must not fire an
  unauthenticated handshake the gateway will refuse.
- **The auth CALLBACK, not an auth object.** `auth: (cb) => cb({ token })` is
  re-invoked on every reconnect attempt, so a socket that dropped while the access
  token was expiring reconnects with whatever the single-flight refresh has since
  written. A static `auth: { token }` pins the value captured at connect time and
  reconnects forever with a token the gateway rejects.
- **Default transports** (polling → websocket upgrade) are left in place: a
  network that blocks upgrades still gets realtime, just over long-polling.
- **`disconnectSocket()` keeps the instance.** Its listeners belong to whatever is
  still mounted; tearing it down would leave those components subscribed to a dead
  object.
- **Status is a three-state `useSyncExternalStore` pair**
  (`disconnected` / `connecting` / `connected`), not React state, because the fact
  lives in a module singleton several components read independently.

### 8.2 Reconnect semantics

**Missed events are unrecoverable, and the client says so rather than pretending
otherwise.** While the socket was down every event the project produced was lost:
there is no replay buffer, and building one would mean the server holding per-tab
state for the length of a bad wifi hop.

Two facts drive the recovery in `useProjectRealtime`:

1. **Socket.IO restores transports across a reconnect, never rooms.** The join
   therefore runs on **every** connect — `onSocketConnect(join)` — and, if the
   socket is already connected (a project switch inside one session, where no
   `connect` event is coming), directly.
2. **A reconnect is not a first connect.** `lib/socket.ts` counts connections;
   `onSocketConnect` reports `isReconnect = connectionCount > 1`. Only a
   _re_-connect calls `scheduleProjectRefresh(queryClient, projectId)`, which
   debounce-invalidates `qk.project.all(projectId)` — the whole project prefix,
   refetching exactly what is mounted. Invalidating on a first connect would
   refetch a board the mount just fetched.

The refresh fires **after** the ack comes back `ok`: a refused join has no room to
catch up on.

### 8.3 `rebalanced: true`

`task:moved` carries `rebalanced` because the server sometimes rewrites **every**
rank in the destination column. When it does, every _other_ cached rank in that
column is stale, and a one-card splice would produce a board ordered by a mix of
old and new keys. `applyTaskMoved` therefore invalidates `qk.tasks.all(projectId)`
and returns before touching anything — **the one place in `realtime-cache.ts`
where a real refetch is the correct answer rather than the lazy one**.

`realtime-cache.test.ts` pins both branches ("splices the card into its new column
at its new rank" / "invalidates the whole task prefix instead of splicing when
rebalanced"), plus the case that catches the naive implementation: a board that
never held the card is left alone, because the card is filtered out of that view
and inserting it would defeat the filter.

### 8.4 Parse before dispatch, on the client too

`subscribe()` in `useRealtime.ts` attaches one listener per event name that runs
`serverToClientEventSchemas[name].safeParse(raw)` before touching a cache. A
failure is a `console.warn('[realtime] dropped a malformed <name> payload')` and
nothing else.

**Both ends validate, and that is not redundancy.** The server validates before
it emits (§5.2) and the client validates before it writes, because the case that
matters is a **mismatched deploy** — an old tab left open across a release — which
is precisely when the two ends disagree. A dropped event beats a board spliced
with a field that is missing.

### 8.5 Handshake failures

`SocketAuthError` carries `data.code`, surfaced to the client's `connect_error`:

| Code               | When                                                           |
| ------------------ | -------------------------------------------------------------- |
| `AUTH_FAILED`      | No token, an unverifiable token, or a `tokenVersion` mismatch. |
| `ACCOUNT_DISABLED` | The resolver returned `null` or `isActive: false`.             |
| `AUTH_UNAVAILABLE` | **Production only** — no `SocketUserResolver` is wired.        |

**The handshake re-checks `tokenVersion`, once per connection.** An HTTP request
lives milliseconds, so a stale access token is a 15-minute window nobody pays a
`SELECT` per request to close. A socket lives for hours, and a revoked session
must not keep streaming a project's task updates until the token happens to
expire.

**With no resolver the gateway fails closed in production** and
allows-with-a-warning in dev/test. A foundation package that silently accepted
revoked tokens in prod would be a security bug shipped by omission. The resolver
is injected from `bootstrap()` — `sockets/io.ts` sits above the service layer,
where the layering rule forbids a `db` import outright.

## 9. The rule: services never import the socket layer

A Wave-2 service publishes `task.moved` and is **done**. It never imports
Socket.IO, never knows a browser exists. `realtime-bridge.ts` subscribes from its
own file, `notifications.bootstrap.ts` subscribes independently, and adding
realtime edited **no service file** — which is what let waves 2 and 4 be written
in parallel. See [architecture.md](./architecture.md) for the bus's place in the
layering.

Three properties of `apps/api/src/utils/domain-events.ts` you can rely on:

- **Typed, and not built on `EventEmitter`.** `on(event: string, listener:
(...args: any[]) => void)` erases the payload type at the boundary, and `any` is
  a hard lint gate here. A plain `Map` of handler arrays keeps
  `publishDomainEvent('task.moved', …)` checked against exactly what
  `DomainEventMap` declares. The storage type is `(payload: never) => …`, which
  every concrete handler is assignable to by contravariance and which nothing can
  be called through by accident.
- **Synchronous and non-throwing.** Handlers run in registration order; a thrown
  error or a rejected promise is logged and swallowed. **A broken notification
  fan-out must not roll back a task move that already committed.** The handler
  list is copied before iteration, so a handler may unsubscribe itself while it
  runs.
- **Fields shared with the wire are typed FROM the shared schema** —
  `Pick<TaskMovedPayload, …>`, `SprintChangedPayload['action']`,
  `NotificationType` — so a contract change is a compile error in the bridge
  rather than a payload that quietly stops matching.

Publishing happens **after** the transaction commits, alongside the telemetry
`record()` call — see [telemetry.md](./telemetry.md) §3.1 and §9.

## 10. Mounting it

One line in the authed tree. `RealtimeBridge` renders nothing; its whole job is
to be a component so a hook has a lifecycle to hang off. It is designed to sit in
`AppShell`, **above** the project routes, so one instance covers every view and
the socket is not torn down when the user moves from the board to the backlog.
`useParams()` returns `{}` up there (it is scoped to the closest matched route),
so the project comes from `useRouteScope()` plus the two cached lookups that turn
a slug and a key into ids — the same queries every project page already runs.

**`projectId` is `null` on `/notifications`, `/me`, `/admin/*` and every org-level
page. That is not a degraded mode**: the connection is still open there (the bell
needs `user:{id}` everywhere), only the project room is not joined.

The bridge also registers the presence stack into the topbar through
`registerTopbarSlot({ id: 'presence', zone: 'end', order: 15 })` — from inside an
effect, not at module scope, so the avatars appear only while a project is open,
with no conditional inside `Topbar.tsx`. `NotificationsBridge` registers the bell
at order 20 and listens to **no socket at all**: `applyNotificationNew` owns
`notification:new`, and both the badge and every list live under the
`qk.notifications` prefix, so they update with no coupling between the two
packages.

Back to [docs/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
