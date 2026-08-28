# Workflow: Add a notification trigger

A new reason for the bell to light up: shared type → audience → denormalized
payload → bootstrap subscription → socket push → the sentence in both languages.
FlowBoard's notifications are **in-app only** (no email, no push). Worked from
`handleTaskCreated` in `apps/api/src/services/notifications.service.ts` — the
smallest complete handler, and the one that shows both a direct recipient and a
mention fan-out. Read `realtime.md` → rooms and `architecture.md` → the
domain-event bus for the surrounding machinery.

## Steps

1. **Add the type to the enum — in BOTH declarations.** It is a shared zod enum
   _and_ a pg enum, and they are two independent declarations of the same closed
   set:

   - `packages/shared/src/notifications.schema.ts` → `notificationTypeSchema`
   - `apps/api/src/db/schema/enums.ts` → `notificationTypeEnum('notification_type', […])`

   The pg enum means a new value needs a migration (see
   [db-migration.md](./db-migration.md)). `toNotification()` **parses** the row's
   type through the shared enum rather than casting, so a row written outside
   that file that disagrees with either is a loud 500 here instead of a payload
   the browser cannot render. Then add the type to `TYPE_PRIORITY` — a
   `Record<NotificationType, number>` that decides which single row wins when one
   event names the same user twice (lower is stronger; `mentioned: 0`,
   `comment_added: 5`).

2. **Decide the audience, then subtract.** Build a `Candidate[]` of
   `{ userId, type }` from whoever plausibly cares — assignee, reporter, watchers
   (`taskAudience()`), mentioned users (`extractMentionUserIds`), sprint
   participants — then hand it to `fanOut()`, which applies the three
   subtractions in this order:

   - **the ACTOR** — nobody is told about their own action;
   - **MUTED watchers** — an explicit "stop telling me about this task" beats
     every other reason a row could exist, including being the assignee;
   - **users without project visibility** (`filterProjectVisible`) — a
     notification carries the task title and key, so delivering one to a
     non-member is a data leak dressed as a convenience.

   Dedupe happens first, so a user mentioned in a comment on a task they watch
   gets ONE `mentioned` row, never `mentioned` plus `comment_added`.

3. **Build the payload DENORMALIZED.** Every field in
   `notificationPayloadSchema` is optional and every field is a _snapshot_.
   `taskPayload(context, actorName)` copies `taskId`, `taskKey`, `taskTitle`,
   `projectKey`, `projectName`, `orgSlug` and `actorName` onto the row. Two
   reasons, both load-bearing: the sentence must keep rendering after the task is
   renamed, the project archived or the actor deactivated — joining live rows at
   read time would make old notifications mutate under the reader — and one bell
   fetch must stay one indexed read instead of four joins. `loadTaskContext()`
   gathers task + project + org in a single query for exactly this.

4. **Subscribe in the bootstrap, not in the service that mutates.** Add the
   handler to `apps/api/src/services/notifications.service.ts` and wire it in
   `notifications.bootstrap.ts`, where `dispatch()` wraps each call
   fire-and-forget with a trigger-specific log line:

   ```ts
   onDomainEvent('task.created', (event) => {
     dispatch('task.created', { taskId: event.taskId }, () => handleTaskCreated(event));
   });
   ```

   A notification is a courtesy attached to a mutation that **already committed**;
   failing to write one must never surface to the user who moved the card, and
   nothing here is ever awaited by a service. Pick the right event: a Kanban drop
   publishes `task.moved`, not `task.updated`, which is why both are subscribed
   and why `task.moved` carries the internal `statusChanged` flag to tell a
   genuine column change from a re-order.

5. **The push is the bridge's job, not yours.** `fanOut()` inserts every row in
   ONE multi-row `INSERT`, then publishes `notification.created` per row and
   stops — this file never touches Socket.IO. The realtime bridge subscribes,
   re-reads via `loadNotificationPush(notificationId, recipientId)`, and emits
   `notification:new` to **`user:{recipientId}`** with the new unread total
   riding along, so the badge never needs a follow-up request. **No `.except()`
   here** — there is nothing to suppress, because the fan-out never writes a row
   for the actor.

6. **Add the sentence on the web** —
   `apps/web/src/components/notifications/notification-sentence.ts`. `SENTENCE_KEYS`
   is a `Record<NotificationType, string>`, which is what makes a new type a
   **compile error** here rather than a row that renders its own key. Then add
   the copy to `locales/en/notifications.ts` **and** `locales/ar/notifications.ts`
   under `sentence.*`. The namespace's copy rule: one past-tense sentence naming
   the person and the thing ("Ada Lovelace commented on FLOW-142"), never "New
   comment" — a bell is read at a glance, and WHO and WHAT are the two facts a
   reader needs. Every interpolated value has a translated fallback
   (`fallback.someone`, `fallback.aTask`) because the payload is a snapshot.

7. **Build the click target from the payload alone.** `notificationHref()` in
   `apps/web/src/hooks/useNotifications.ts` is a pure function of the payload:
   `/o/${orgSlug}/p/${projectKey}/board/t/${taskKey}` when all three are present,
   `/notifications` otherwise. Whatever your trigger needs to be clickable must
   therefore be _in the payload_ — there is no lookup at render time. The board
   is the landing view because it is the one every project has and the task sheet
   layers over any of the five.

8. **Test both sides.** API:
   `apps/api/src/services/notifications.service.test.ts` — `fanOut` returns the
   rows it wrote precisely so the recipient math can be asserted directly. Cover
   the happy fan-out, **the actor receiving nothing**, a muted watcher receiving
   nothing, a non-member receiving nothing, and the dedupe (one row, strongest
   type). Web: `components/notifications/__tests__/notification-sentence.test.ts`
   for the sentence in both languages, and the fallback path with an empty
   payload.

## Call-outs

- **Never notify the actor.** `fanOut` deletes `input.actorId` from the recipient
  map before anything else. It is also why the `notification:new` emit needs no
  echo suppression — and if you ever bypass `fanOut`, you break both at once.
- **Never join live rows at read time.** The bell reads `notifications` and
  nothing else. If the sentence needs a name, snapshot the name.
- **The badge has its own endpoint and its own path.** `GET /api/notifications/unread-count`
  is backed by the partial index `notifications_unread_idx`
  (`WHERE read_at IS NULL`), which keeps the count an index-only scan forever.
  The web reads it through `useUnreadCount()` at `qk.notifications.unreadCount()`;
  `applyNotificationNew` **writes** that key from the socket payload rather than
  refetching, and `NotificationsBridge.tsx` re-invalidates it on
  `visibilitychange`/`focus` for a tab that slept through a push.

## Checklist

- [ ] Type added to `notificationTypeSchema` **and** `notificationTypeEnum` (+ migration).
- [ ] `TYPE_PRIORITY` entry added; dedupe behaviour considered.
- [ ] Candidate set built, then actor / muted / non-visible subtracted via `fanOut`.
- [ ] Payload fully denormalized — no live joins at read time.
- [ ] Handler subscribed in `notifications.bootstrap.ts`, fire-and-forget.
- [ ] Service publishes `notification.created` only; no socket import.
- [ ] `SENTENCE_KEYS` entry + `sentence.*` copy in **en and ar**, with fallbacks.
- [ ] Click target derivable from the payload alone.
- [ ] Tests: fan-out math (incl. actor-excluded, muted, non-member) + sentence in both languages.
- [ ] `pnpm turbo run build lint typecheck test` green.

## Related

- [realtime.md](../docs/realtime.md) — `user:{userId}` rooms and the `notification:new` push.
- [architecture.md](../docs/architecture.md) — the domain-event bus and who subscribes.
- [add-socket-event.md](./add-socket-event.md) — the bridge half of the delivery.
- [db-migration.md](./db-migration.md) — the pg enum change a new type requires.
- [i18n.md](../docs/i18n.md) — the Arabic glossary the sentence copy must follow.

Back to [workflows/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
