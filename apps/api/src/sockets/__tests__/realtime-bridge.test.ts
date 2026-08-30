import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { closeDb, comments, db, notifications } from '../../db';
import { onDomainEvent, publishDomainEvent } from '../../utils/domain-events';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import {
  seedSprint,
  seedTask,
  seedWorld,
  type World,
} from '../../routes/__tests__/task-domain.fixtures';
import { updateUser } from '../../services/admin-users.service';
import { softDeleteOrg } from '../../services/orgs.service';
import { presenceRoster, presenceSocketCount } from '../presence';
import { registerRealtimeBridge, unregisterRealtimeBridge } from '../realtime-bridge';
import {
  connectClient,
  expectNoEvent,
  joinProject,
  startGateway,
  waitFor,
  waitForDisconnect,
  type Gateway,
  type TestClient,
} from './harness';

/**
 * THE BRIDGE, end to end: a service publishes a domain event, and the OTHER
 * tabs in the project room see it.
 *
 * The suite drives `publishDomainEvent` directly rather than going through an
 * HTTP route, which is exactly the seam the plan designed: services publish and
 * are done, and this package subscribes. Testing through a route would couple
 * these assertions to WP2.3's controllers and prove nothing extra — the route
 * suites already prove the events are published.
 */

let gateway: Gateway;
let world: World;

beforeAll(async () => {
  await ensureTestDb();
});

beforeEach(async () => {
  await truncateAllTables();
  gateway = await startGateway();
  registerRealtimeBridge();
  world = await seedWorld();
});

afterEach(async () => {
  unregisterRealtimeBridge();
  await gateway.close();
});

afterAll(async () => {
  await closeDb();
});

/**
 * The version stamp a move carries. A fixed literal rather than `new Date()`:
 * the assertions below check the bridge FORWARDS the publisher's value
 * verbatim, which a value the bridge could plausibly have re-derived would not
 * prove.
 */
const MOVED_AT = '2026-03-04T10:00:00.000Z';

/** Two members of the seeded project, both connected and joined to its room. */
async function twoJoinedClients(): Promise<{ actor: TestClient; observer: TestClient }> {
  const actor = await connectClient(gateway, world.admin.token);
  const observer = await connectClient(gateway, world.member.token);
  await joinProject(actor, world.projectId);
  await joinProject(observer, world.projectId);
  return { actor, observer };
}

describe('echo suppression — the except(originSocketId) contract', () => {
  /**
   * THE CRITICAL TEST.
   *
   * The actor's tab already painted this move twice — optimistically on drop
   * and again from the HTTP response — so a third, asynchronous write is what
   * makes a just-dragged card jump. Both halves are asserted in ONE test on
   * purpose: the negative assertion is only meaningful because the positive one
   * proves the event really did fire inside the same window.
   */
  it('delivers task:moved to the other tab and NOT to the origin socket', async () => {
    const { actor, observer } = await twoJoinedClients();
    const taskId = await seedTask(world);

    const delivered = waitFor(observer, 'task:moved');
    const withheld = expectNoEvent(actor, 'task:moved');

    publishDomainEvent('task.moved', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: actor.id ?? null,
      taskId,
      statusId: world.statuses.inProgress,
      boardRank: 'a1',
      rebalanced: false,
      updatedAt: MOVED_AT,
    });

    await expect(delivered).resolves.toEqual({
      projectId: world.projectId,
      taskId,
      statusId: world.statuses.inProgress,
      boardRank: 'a1',
      rebalanced: false,
      updatedAt: MOVED_AT,
    });
    await expect(withheld).resolves.toBeUndefined();
  });

  /** A server-side actor (a script, a cron) has no socket to exclude. */
  it('delivers to every tab when the event has no origin socket', async () => {
    const { actor, observer } = await twoJoinedClients();
    const taskId = await seedTask(world);

    const onActor = waitFor(actor, 'task:moved');
    const onObserver = waitFor(observer, 'task:moved');

    publishDomainEvent('task.moved', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
      statusId: world.statuses.done,
      boardRank: 'a2',
      rebalanced: false,
      updatedAt: MOVED_AT,
    });

    await expect(onActor).resolves.toMatchObject({ taskId });
    await expect(onObserver).resolves.toMatchObject({ taskId });
  });

  it('never leaves the project room', async () => {
    const { observer } = await twoJoinedClients();
    // Connected and authenticated, but never joined the project room.
    const bystander = await connectClient(gateway, world.viewer.token);
    const taskId = await seedTask(world);

    const delivered = waitFor(observer, 'task:moved');
    const withheld = expectNoEvent(bystander, 'task:moved');

    publishDomainEvent('task.moved', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
      statusId: world.statuses.todo,
      boardRank: 'a3',
      rebalanced: true,
      updatedAt: MOVED_AT,
    });

    await expect(delivered).resolves.toMatchObject({ rebalanced: true });
    await expect(withheld).resolves.toBeUndefined();
  });

  /**
   * `actorId`, `statusChanged` and the `AudienceSnapshot` pair are all on the
   * bus and must never be on the wire — `parse()` strips them. Every internal
   * field the map declares for `task.moved` is set here, so the assertion below
   * is the whole boundary rather than a sample of it.
   *
   * `updatedAt` is the counter-example that keeps the assertion honest: it is
   * on the bus AND on the wire, so an exact key list catches a `parse()` that
   * started stripping too much as readily as one stripping too little.
   */
  it('does not leak internal domain-event fields onto the wire', async () => {
    const { observer } = await twoJoinedClients();
    const taskId = await seedTask(world);

    const delivered = waitFor(observer, 'task:moved');
    publishDomainEvent('task.moved', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
      statusId: world.statuses.todo,
      boardRank: 'a4',
      rebalanced: false,
      updatedAt: MOVED_AT,
      statusChanged: true,
      assigneeIdAtCommit: world.viewer.id,
      reporterIdAtCommit: world.member.id,
    });

    const payload = await delivered;
    expect(Object.keys(payload).sort()).toEqual([
      'boardRank',
      'projectId',
      'rebalanced',
      'statusId',
      'taskId',
      'updatedAt',
    ]);
    // The stamp is FORWARDED, not re-derived: the bridge must not read the row
    // back and stamp a time from after the commit. See `realtime-bridge`'s
    // `task.moved` handler.
    expect(payload.updatedAt).toBe(MOVED_AT);
  });
});

describe('task events', () => {
  it('hydrates task.created into a task summary', async () => {
    const { observer } = await twoJoinedClients();
    const taskId = await seedTask(world, { title: 'Ship the bridge', type: 'bug' });

    const delivered = waitFor(observer, 'task:created');
    publishDomainEvent('task.created', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
      statusId: world.statuses.todo,
      assigneeIdAtCommit: null,
      reporterIdAtCommit: null,
    });

    const payload = await delivered;
    expect(payload.projectId).toBe(world.projectId);
    expect(payload.task).toMatchObject({
      id: taskId,
      title: 'Ship the bridge',
      type: 'bug',
      statusId: world.statuses.todo,
    });
    // The SUMMARY shape, not the detail one: no description on the wire.
    expect(payload.task).not.toHaveProperty('description');
    expect(payload.task.hasDescription).toBe(false);
  });

  it('hydrates task.updated into a task summary', async () => {
    const { observer } = await twoJoinedClients();
    const taskId = await seedTask(world, { title: 'Renamed by someone else' });

    const delivered = waitFor(observer, 'task:updated');
    publishDomainEvent('task.updated', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
      changedFields: ['title'],
      assigneeIdAtCommit: null,
      reporterIdAtCommit: null,
    });

    await expect(delivered).resolves.toMatchObject({
      projectId: world.projectId,
      task: { id: taskId, title: 'Renamed by someone else' },
    });
  });

  it('emits task:deleted with ids only — no read, because the row is gone', async () => {
    const { observer } = await twoJoinedClients();
    const taskId = await seedTask(world, { deletedAt: new Date() });

    const delivered = waitFor(observer, 'task:deleted');
    publishDomainEvent('task.deleted', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
    });

    await expect(delivered).resolves.toEqual({ projectId: world.projectId, taskId });
  });

  /**
   * A `task.updated` for a row that vanished between the commit and the
   * broadcast must be a skipped emit, not a crash. Proven by the event that
   * follows it arriving normally.
   */
  it('skips the emit when the task can no longer be read', async () => {
    const { observer } = await twoJoinedClients();
    const liveTask = await seedTask(world);

    const withheld = expectNoEvent(observer, 'task:updated', 500);
    publishDomainEvent('task.updated', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId: '00000000-0000-4000-8000-0000000000bb',
      changedFields: ['title'],
      assigneeIdAtCommit: null,
      reporterIdAtCommit: null,
    });
    await expect(withheld).resolves.toBeUndefined();

    const delivered = waitFor(observer, 'task:updated');
    publishDomainEvent('task.updated', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId: liveTask,
      changedFields: ['title'],
      assigneeIdAtCommit: null,
      reporterIdAtCommit: null,
    });
    await expect(delivered).resolves.toMatchObject({ task: { id: liveTask } });
  });
});

describe('comment events', () => {
  it('hydrates comment.created into the full comment', async () => {
    const { observer } = await twoJoinedClients();
    const taskId = await seedTask(world);
    const [row] = await db
      .insert(comments)
      .values({ taskId, authorId: world.admin.id, body: 'Looks good to me' })
      .returning({ id: comments.id });
    if (!row) throw new Error('comment insert returned nothing');

    const delivered = waitFor(observer, 'comment:created');
    publishDomainEvent('comment.created', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
      commentId: row.id,
      mentionedUserIds: [],
      assigneeIdAtCommit: null,
      reporterIdAtCommit: null,
    });

    const payload = await delivered;
    expect(payload).toMatchObject({ projectId: world.projectId, taskId });
    expect(payload.comment).toMatchObject({
      id: row.id,
      body: 'Looks good to me',
      author: { id: world.admin.id },
    });
  });

  it('hydrates comment.updated into the EDITED comment, editedAt included', async () => {
    // The edit path is a separate handler from the create path — the two are
    // near-identical five-line blocks, which is exactly how one ends up bound
    // to the wrong schema or the wrong event name.
    const { observer } = await twoJoinedClients();
    const taskId = await seedTask(world);
    const editedAt = new Date('2026-04-01T09:00:00.000Z');
    const [row] = await db
      .insert(comments)
      .values({ taskId, authorId: world.admin.id, body: 'Fixed the typo', editedAt })
      .returning({ id: comments.id });
    if (!row) throw new Error('comment insert returned nothing');

    const delivered = waitFor(observer, 'comment:updated');
    publishDomainEvent('comment.updated', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
      commentId: row.id,
      mentionedUserIds: [],
      assigneeIdAtCommit: null,
      reporterIdAtCommit: null,
    });

    const payload = await delivered;
    expect(payload).toMatchObject({ projectId: world.projectId, taskId });
    expect(payload.comment).toMatchObject({ id: row.id, body: 'Fixed the typo' });
    expect(payload.comment.editedAt).toBe(editedAt.toISOString());
  });

  it.each(['comment.created', 'comment.updated'] as const)(
    'stays SILENT when %s names a comment that can no longer be read',
    async (event) => {
      // A comment deleted between the mutation and the broadcast. Emitting a
      // half-built payload would fail the schema parse inside a domain-event
      // handler; skipping is the documented answer.
      const { observer } = await twoJoinedClients();
      const taskId = await seedTask(world);

      publishDomainEvent(event, {
        projectId: world.projectId,
        actorId: world.admin.id,
        originSocketId: null,
        taskId,
        commentId: '00000000-0000-4000-8000-0000000000ca',
        mentionedUserIds: [],
        assigneeIdAtCommit: null,
        reporterIdAtCommit: null,
      });

      await expectNoEvent(
        observer,
        event === 'comment.created' ? 'comment:created' : 'comment:updated',
      );
    },
  );

  it('emits comment:deleted with ids only', async () => {
    const { observer } = await twoJoinedClients();
    const taskId = await seedTask(world);
    const commentId = '00000000-0000-4000-8000-0000000000c9';

    const delivered = waitFor(observer, 'comment:deleted');
    publishDomainEvent('comment.deleted', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
      commentId,
    });

    await expect(delivered).resolves.toEqual({ projectId: world.projectId, taskId, commentId });
  });
});

describe('sprint and workflow events', () => {
  it('ships the whole sprint on a lifecycle change', async () => {
    const { observer } = await twoJoinedClients();
    const sprintId = await seedSprint(world, { name: 'Sprint 4', state: 'active' });

    const delivered = waitFor(observer, 'sprint:changed');
    publishDomainEvent('sprint.changed', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      sprintId,
      action: 'started',
    });

    const payload = await delivered;
    expect(payload).toMatchObject({ projectId: world.projectId, sprintId, action: 'started' });
    expect(payload.sprint).toMatchObject({ id: sprintId, name: 'Sprint 4', state: 'active' });
  });

  it('sends a null sprint for a delete — the row is gone by design', async () => {
    const { observer } = await twoJoinedClients();

    const delivered = waitFor(observer, 'sprint:changed');
    publishDomainEvent('sprint.changed', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      sprintId: '00000000-0000-4000-8000-0000000000d9',
      action: 'deleted',
    });

    await expect(delivered).resolves.toMatchObject({ action: 'deleted', sprint: null });
  });

  it('STILL EMITS, with a null sprint, when a non-delete read fails', async () => {
    // Documented and deliberate: a backlog that learns "something happened to
    // this sprint" and invalidates is strictly better than one that learns
    // nothing because a read lost a race.
    const { observer } = await twoJoinedClients();

    const delivered = waitFor(observer, 'sprint:changed');
    publishDomainEvent('sprint.changed', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      sprintId: '00000000-0000-4000-8000-0000000000da',
      action: 'completed',
    });

    await expect(delivered).resolves.toMatchObject({ action: 'completed', sprint: null });
  });

  /**
   * The contract ships the ENTIRE workflow, not the `change` discriminator the
   * bus carries, so an open board re-renders its columns from the payload.
   */
  it('ships every status and transition on a workflow change', async () => {
    const { observer } = await twoJoinedClients();

    const delivered = waitFor(observer, 'workflow:changed');
    publishDomainEvent('workflow.changed', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      change: 'statuses',
    });

    const payload = await delivered;
    expect(payload.projectId).toBe(world.projectId);
    expect(payload.statuses.map((status) => status.id)).toEqual([
      world.statuses.todo,
      world.statuses.inProgress,
      world.statuses.done,
    ]);
    expect(payload.transitions).toEqual([]);
  });
});

describe('notification:new', () => {
  /**
   * The only event on a USER room. It reaches a socket that never joined any
   * project room — `user:{id}` is joined automatically at handshake — and it
   * carries the recipient's live unread total so the bell badge never needs a
   * follow-up request.
   */
  it('lands on the recipient user room with the unread count', async () => {
    const recipient = await connectClient(gateway, world.member.token);
    const taskId = await seedTask(world);

    await db.insert(notifications).values([
      {
        recipientId: world.member.id,
        actorId: world.admin.id,
        type: 'task_assigned',
        projectId: world.projectId,
        taskId,
        payload: { taskTitle: 'Ship the bridge' },
      },
      // A second unread row, so the count is provably a COUNT and not a `1`.
      {
        recipientId: world.member.id,
        actorId: world.admin.id,
        type: 'mentioned',
        projectId: world.projectId,
        taskId,
        payload: {},
      },
    ]);
    const [row] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eqType('task_assigned'));
    if (!row) throw new Error('notification insert returned nothing');

    const delivered = waitFor(recipient, 'notification:new');
    publishDomainEvent('notification.created', {
      recipientId: world.member.id,
      notificationId: row.id,
      type: 'task_assigned',
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
    });

    const payload = await delivered;
    expect(payload.notification).toMatchObject({
      id: row.id,
      recipientId: world.member.id,
      type: 'task_assigned',
      readAt: null,
    });
    expect(payload.notification.payload.taskTitle).toBe('Ship the bridge');
    expect(payload.unreadCount).toBe(2);
  });

  it('is not delivered to a different user', async () => {
    const recipient = await connectClient(gateway, world.member.token);
    const bystander = await connectClient(gateway, world.admin.token);

    await db.insert(notifications).values({
      recipientId: world.member.id,
      actorId: world.admin.id,
      type: 'mentioned',
      projectId: world.projectId,
      payload: {},
    });
    const [row] = await db.select({ id: notifications.id }).from(notifications);
    if (!row) throw new Error('notification insert returned nothing');

    const delivered = waitFor(recipient, 'notification:new');
    const withheld = expectNoEvent(bystander, 'notification:new');

    publishDomainEvent('notification.created', {
      recipientId: world.member.id,
      notificationId: row.id,
      type: 'mentioned',
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
    });

    await expect(delivered).resolves.toMatchObject({ unreadCount: 1 });
    await expect(withheld).resolves.toBeUndefined();
  });

  it('stays silent for a notification id that no longer resolves', async () => {
    // The bus carries only the id; the bridge re-reads the row. A row deleted
    // (or a mismatched recipient) means nothing to push, and the handler must
    // return rather than parse `null` into a payload.
    const recipient = await connectClient(gateway, world.member.token);

    publishDomainEvent('notification.created', {
      recipientId: world.member.id,
      notificationId: '00000000-0000-4000-8000-0000000000db',
      type: 'mentioned',
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
    });

    await expectNoEvent(recipient, 'notification:new');
  });
});

/**
 * WP5.6 — SESSION REVOCATION REACHES OPEN SOCKETS.
 *
 * `token_version` is checked in the handshake and on every HTTP request, which
 * made a deactivation a rule about FUTURE connections only: the websocket a
 * revoked account already had open kept streaming board updates and
 * notifications forever, because an established socket never re-handshakes.
 *
 * Both ends of the fix are covered — the bridge's handler (does the right
 * sockets, and only those, get closed?) and the service wiring (does a real
 * deactivation actually publish the event?).
 */
describe('user.revoked — dropping a revoked account’s live sockets', () => {
  it('closes every socket in the user room and leaves other users connected', async () => {
    // Two tabs for the same account, plus a bystander on another account.
    const firstTab = await connectClient(gateway, world.member.token);
    const secondTab = await connectClient(gateway, world.member.token);
    const bystander = await connectClient(gateway, world.admin.token);

    const firstClosed = waitForDisconnect(firstTab);
    const secondClosed = waitForDisconnect(secondTab);

    publishDomainEvent('user.revoked', { userId: world.member.id });

    await expect(firstClosed).resolves.toBe('io server disconnect');
    await expect(secondClosed).resolves.toBe('io server disconnect');
    expect(bystander.connected).toBe(true);
  });

  it('drops the socket when an admin actually deactivates the account', async () => {
    // Through the SERVICE, not the bus: this is what proves `updateUser`
    // publishes at all. Everything between is real — the token bump, the
    // event, the bridge subscription and the transport.
    const victim = await connectClient(gateway, world.member.token);
    await joinProject(victim, world.projectId);

    const closed = waitForDisconnect(victim);
    await updateUser(world.admin.id, world.member.id, { isActive: false });

    await expect(closed).resolves.toBe('io server disconnect');
  });

  it('drops the socket on a force-logout that changes no column at all', async () => {
    // `forceLogout` is the one field that is not a column, so the patch body is
    // empty and the token bump is the whole request. The disconnect must still
    // happen — this is the path an admin uses to boot a stolen session.
    const victim = await connectClient(gateway, world.viewer.token);

    const closed = waitForDisconnect(victim);
    await updateUser(world.admin.id, world.viewer.id, { forceLogout: true });

    await expect(closed).resolves.toBe('io server disconnect');
  });
});

/**
 * R2 W3.5 — ARCHIVING AN ORG REACHES THE ROOMS IT ALREADY HANDED OUT.
 *
 * The guards' half of the fix (`middlewares/require-roles.ts`,
 * `sockets/socket-reads.ts`) refuses every FUTURE request and every future
 * `project:join`. A socket already sitting in one of the org's project rooms
 * asked its permission question once, at join time, so it went on receiving task
 * and comment traffic for an organization that had just been switched off.
 *
 * The eviction is a room LEAVE, not a disconnect — the deliberate difference
 * from `user.revoked` above. Archiving one tenancy is not revoking a person: the
 * same tab may be watching a live board in another org, and it is certainly
 * still entitled to its notifications. Every test here asserts BOTH halves —
 * the traffic stops AND the connection survives.
 */
describe('org.archived — emptying an archived org’s project rooms', () => {
  it('stops project traffic to sockets that had already joined, without disconnecting them', async () => {
    const { observer } = await twoJoinedClients();
    const taskId = await seedTask(world);

    await softDeleteOrg(world.orgId);
    // Nothing about the socket itself changed — only which rooms it is in.
    expect(observer.connected).toBe(true);

    publishDomainEvent('task.created', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
      statusId: world.statuses.todo,
      assigneeIdAtCommit: null,
      reporterIdAtCommit: null,
    });

    await expectNoEvent(observer, 'task:created');
  });

  it('empties the presence roster, so nobody is left "present" in an unreachable project', async () => {
    await twoJoinedClients();
    expect(presenceSocketCount(world.projectId)).toBe(2);

    publishDomainEvent('org.archived', { orgId: world.orgId, projectIds: [world.projectId] });

    expect(presenceSocketCount(world.projectId)).toBe(0);
    expect(presenceRoster(world.projectId)).toEqual([]);
  });

  it('leaves a DIFFERENT org’s rooms alone', async () => {
    const other = await seedWorld();
    const bystander = await connectClient(gateway, other.member.token);
    await joinProject(bystander, other.projectId);
    const taskId = await seedTask(other);

    await softDeleteOrg(world.orgId);

    publishDomainEvent('task.created', {
      projectId: other.projectId,
      actorId: other.admin.id,
      originSocketId: null,
      taskId,
      statusId: other.statuses.todo,
      assigneeIdAtCommit: null,
      reporterIdAtCommit: null,
    });

    await waitFor(bystander, 'task:created');
    expect(presenceSocketCount(other.projectId)).toBe(1);
  });

  /**
   * The service wiring, not just the handler: this is what proves
   * `softDeleteOrg` publishes at all, and that it names the org's live projects.
   */
  it('is published by the real archive endpoint’s service, carrying the live project ids', async () => {
    const captured: { orgId: string; projectIds: readonly string[] }[] = [];
    const off = onDomainEvent('org.archived', (payload) => {
      captured.push(payload);
    });

    try {
      await softDeleteOrg(world.orgId);
    } finally {
      off();
    }

    expect(captured).toEqual([{ orgId: world.orgId, projectIds: [world.projectId] }]);
  });

  it('publishes nothing when the archive is refused', async () => {
    const captured: unknown[] = [];
    const off = onDomainEvent('org.archived', (payload) => {
      captured.push(payload);
    });

    try {
      // Already archived — `softDeleteOrg` 404s, and a refused archive must not
      // evict anybody.
      await softDeleteOrg(world.orgId);
      captured.length = 0;
      await expect(softDeleteOrg(world.orgId)).rejects.toThrow();
    } finally {
      off();
    }

    expect(captured).toEqual([]);
  });
});

describe('registration is idempotent', () => {
  it('does not double-broadcast when the bridge is registered twice', async () => {
    // A hot reload calls `registerRealtimeBridge()` again with the handlers
    // still attached. Without the guard every event would be emitted twice, and
    // a doubled `task:created` splices the same card into a column twice.
    const { observer } = await twoJoinedClients();
    registerRealtimeBridge();
    const taskId = await seedTask(world);

    let deliveries = 0;
    observer.on('task:created', () => {
      deliveries += 1;
    });

    publishDomainEvent('task.created', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
      statusId: world.statuses.todo,
      assigneeIdAtCommit: null,
      reporterIdAtCommit: null,
    });

    await waitFor(observer, 'task:created');
    // Give a duplicate the same window a real one took.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(deliveries).toBe(1);
    observer.off('task:created');
  });

  it('stops delivering once unregistered, and can be re-registered', async () => {
    const { observer } = await twoJoinedClients();
    const taskId = await seedTask(world);

    unregisterRealtimeBridge();
    publishDomainEvent('task.deleted', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
    });
    await expectNoEvent(observer, 'task:deleted');

    registerRealtimeBridge();
    const delivered = waitFor(observer, 'task:deleted');
    publishDomainEvent('task.deleted', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
    });

    await expect(delivered).resolves.toMatchObject({ projectId: world.projectId, taskId });
  });
});

/** Local helper so the notification query reads as one line above. */
function eqType(type: 'task_assigned' | 'mentioned') {
  return eq(notifications.type, type);
}
