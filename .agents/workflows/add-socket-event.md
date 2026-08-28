# Workflow: Add a socket event

From the shared contract to the browser cache, in order. The decoupling this
protects is the reason Wave 2 and Wave 4 could be written in parallel: **a
service publishes a domain event and is done — it never imports the socket
layer.** Worked from `task:moved` (the pass-through case) and `workflow:changed`
(the hydrated case). Read `realtime.md` → the complete event map and
`architecture.md` → the domain-event bus first.

## Steps

1. **Add the event to the shared contract** —
   `packages/shared/src/socket/events.schema.ts`. Four edits, all in that one
   file: the payload schema, the `SOCKET_EVENTS` constant (`scope:verb`, e.g.
   `task:moved`), the `serverToClientEventSchemas` registry, and the
   `ServerToClientEvents` map. Both `Server<…>` (api) and `Socket<…>` (web) are
   generic over that map, so a name typo or a shape change is a compile error at
   **both** ends of the same commit.

   ```ts
   export const taskMovedPayloadSchema = z.object({
     projectId: uuid,
     taskId: uuid,
     statusId: uuid,
     boardRank: rankSchema,
     rebalanced: z.boolean(),
   });
   ```

   **Ship the smallest patch that reproduces the change**, always including
   `projectId` so a listener can route to a cache key without inspecting the room
   it arrived on. Payloads carry `taskSummarySchema`, never the full task.

2. **Publish a domain event from the service.** Add the entry to
   `DomainEventMap` in `apps/api/src/utils/domain-events.ts`, extending
   `DomainEventContext` (`projectId`, `actorId`, `originSocketId`). Where a field
   means the same thing on the wire, **type it FROM the shared schema** rather
   than re-declaring it, so a contract change breaks the bridge at compile time:

   ```ts
   'task.moved': DomainEventContext &
     Pick<TaskMovedPayload, 'taskId' | 'statusId' | 'boardRank' | 'rebalanced'> & {
       statusChanged: boolean; // INTERNAL — notifications need it, the browser does not
     };
   ```

   The service then calls `publishDomainEvent('task.moved', {...})` **after the
   transaction commits** — publishing inside it would broadcast a change that
   then rolled back. `originSocketId` comes from the controller's
   `getSocketId(res)`, which reads the `X-Socket-Id` header
   (`middlewares/socket-id.ts`). A domain event is NOT a socket payload: the bus
   carries ids and flags, the wire carries the hydrated entity.

3. **Subscribe in the bridge and hydrate** —
   `apps/api/src/sockets/realtime-bridge.ts`, inside `registerRealtimeBridge()`.
   Most handlers need a read, because the bus payload is minimal. Reads go
   **through services** (`getTask`, `requireSprint`, `listStatuses`,
   `listTransitions`); the four with no service to call go through
   `sockets/socket-reads.ts`, which is the documented exception to the layering
   rule and explains itself in its header. A read that comes back empty is a
   **skipped emit, never a throw** — the event fires after the commit, so a row
   that vanished means there is nothing to broadcast.

4. **Parse against the shared schema before emitting, always — not only in dev.**
   One zod parse of an object you just built, for three things: the "zod at every
   boundary" rule holds on the socket boundary too; a hydration bug surfaces as a
   logged, dropped emit rather than a half-patched board; and **`parse()` strips
   internal fields**, which is what stops a spread from leaking `actorId` to
   every viewer.

5. **Emit through the echo-suppressing target.** Every project emit goes through
   `projectTarget()`, which exists so there is exactly ONE place `.except()`
   could be forgotten:

   ```ts
   function projectTarget(projectId: string, originSocketId: string | null) {
     const io = tryGetIo();
     if (!io) return null; // a script publishing with no gateway attached
     return io.to(projectRoom(projectId)).except(originSocketId ?? '');
   }

   onDomainEvent('task.moved', ({ projectId, originSocketId, ...move }) => {
     projectTarget(projectId, originSocketId)?.emit(
       SOCKET_EVENTS.TASK_MOVED,
       taskMovedPayloadSchema.parse({ projectId, ...move }),
     );
   });
   ```

   `?? ''` is the no-origin case (a server-side actor, curl, a client with no
   socket): the empty string is a room nobody is in, so it excludes nobody. A
   **user-scoped** event uses `io.to(userRoom(recipientId))` with no `except` —
   see `notification:new`, which suppresses nothing because the fan-out never
   writes a row for the actor.

6. **Map it to a cache on the web** — `apps/web/src/lib/realtime-cache.ts`. Add
   the `apply*` function and its entry in `createRealtimeCacheHandlers`, which is
   typed as the shared `ServerToClientEvents` map, so a listener added to the
   contract and forgotten here is a **compile error**. The rule is **patch what
   you can name, invalidate what you cannot**:

   ```ts
   // named → written directly, no request at all
   queryClient.setQueryData(qk.project.statuses(payload.projectId), payload.statuses);
   // not derivable from the payload → let it refetch
   void queryClient.invalidateQueries({ queryKey: qk.task.detail(payload.taskId) });
   ```

   `scheduleProjectRefresh` is the deliberate, 300 ms-debounced escape hatch and
   the only place a whole-project invalidation may originate. Nothing here asks
   "did I cause this?" — it cannot arrive, because the server already excluded
   this tab.

7. **Subscribe it in `hooks/useRealtime.ts`.** Add the name to `PROJECT_EVENTS`
   (project room) or `USER_EVENTS` (`user:{id}`, live on every page, so the bell
   works outside a project). Every payload is parsed **again** here via
   `serverToClientEventSchemas` — a stale tab left open across a deploy is
   exactly when the two ends disagree — and a failure is a logged, dropped event.
   **Reconnect is a cache invalidation:** there is no replay buffer, so on a
   _re_-connect the hook re-joins the room (Socket.IO restores transports, never
   rooms) and calls `scheduleProjectRefresh`. A first connect does not.

8. **Test both sides.** API: `apps/api/src/sockets/__tests__/realtime-bridge.test.ts`
   drives `publishDomainEvent` directly against a real gateway
   (`__tests__/harness.ts`) — the seam the design intends; the route suites
   already prove the events are published. Assert delivery to the observer,
   **non-delivery to the origin socket**, and that no internal field reaches the
   wire. Web: seed a `QueryClient` and call the `apply*` function — no React, no
   transport, no timers.

## The three classic mistakes

- **Forgetting `.except(originSocketId)`.** The actor's own card jumps: the tab
  already painted the change twice (optimistically, then from the HTTP response)
  and the echo is a third, later write. Always emit through `projectTarget`.
- **Emitting an unparsed payload.** It ships `actorId`, `originSocketId` and any
  internal flag straight to every viewer, and a hydration slip (a `Date` that
  never became an ISO string) becomes a client-side parse failure on a board
  that is already half-patched.
- **A blanket `invalidateQueries({ queryKey: ['project', id] })`.** It refetches
  the board, the backlog, six reports and the activity feed several times a
  second for a change that moved one card — and it undoes the actor's optimistic
  update. Patch the key the payload names; reach for `scheduleProjectRefresh`
  only when the effect genuinely is not derivable.

## Checklist

- [ ] Payload schema + `SOCKET_EVENTS` + `serverToClientEventSchemas` + `ServerToClientEvents` all updated; payload carries `projectId` and the smallest reproducing patch.
- [ ] `DomainEventMap` entry `Pick`s its wire fields from the shared type; internals stay internal.
- [ ] Service publishes **after** commit and imports nothing from `sockets/`.
- [ ] Bridge hydrates through a service (or `socket-reads.ts`); an empty read skips the emit.
- [ ] `schema.parse(...)` on every emit; project emits go through `projectTarget`.
- [ ] `realtime-cache.ts` handler patches a named key; name added to `PROJECT_EVENTS` / `USER_EVENTS`.
- [ ] Bridge test asserts delivery, echo suppression, and no leaked internal fields.
- [ ] `pnpm turbo run build lint typecheck test` green.

## Related

- [realtime.md](../docs/realtime.md) — the event map, rooms, echo suppression, the cache-write mapping table, reconnect.
- [architecture.md](../docs/architecture.md) — the domain-event bus; sockets: rooms and echo suppression.
- [add-api-endpoint.md](./add-api-endpoint.md) — the mutation that publishes the event.
- [add-notification-trigger.md](./add-notification-trigger.md) — the other subscriber to the same bus.

Back to [workflows/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
