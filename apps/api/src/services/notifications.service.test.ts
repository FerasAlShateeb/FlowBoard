/**
 * WP4.2 — the fan-out half: domain event in, recipient set out.
 *
 * WHY THE HANDLERS ARE CALLED DIRECTLY rather than through the bus. The
 * subscribers are fire-and-forget by contract (`void …catch(log)`), so a suite
 * that published an event would have to poll the table and could never
 * distinguish "produced nothing" from "has not finished yet". Calling
 * `handleTaskUpdated(event)` and awaiting it makes every assertion about the
 * RECIPIENT MATH exact. Two tests at the end go through the real bus, which is
 * what proves the wiring in `notifications.bootstrap.ts` is connected at all.
 *
 * Fixtures are rows, not endpoints — see `routes/__tests__/task-domain.fixtures.ts`
 * for that rationale. This suite needs states the API refuses to produce (a
 * watcher who has since lost their project membership, a task that fell due
 * yesterday, a `due_soon` row stamped 23 hours ago).
 */
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { activity, comments, db, notifications, projectMembers, taskWatchers, tasks } from '../db';
import { closeDb } from '../db/client';
import { ensureTestDb, truncateAllTables } from '../test/test-db';
import {
  clearDomainEventHandlers,
  onDomainEvent,
  publishDomainEvent,
  type AudienceSnapshot,
  type DomainEventMap,
} from '../utils/domain-events';
import {
  seedSprint,
  seedTask,
  seedUser,
  seedWorld,
  type UserRef,
  type World,
} from '../routes/__tests__/task-domain.fixtures';
import { registerNotificationSubscribers } from './notifications.bootstrap';
import {
  commentExcerpt,
  handleCommentCreated,
  handleSprintChanged,
  handleTaskCreated,
  handleTaskMoved,
  handleTaskUpdated,
  runDueSoonSweep,
} from './notifications.service';

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

/** Every notification row in the database, newest first. */
async function allNotifications() {
  return db
    .select({
      recipientId: notifications.recipientId,
      actorId: notifications.actorId,
      type: notifications.type,
      taskId: notifications.taskId,
      commentId: notifications.commentId,
      projectId: notifications.projectId,
      payload: notifications.payload,
    })
    .from(notifications);
}

/** The `{recipientId → type}` map an assertion actually cares about. */
async function recipientTypes(): Promise<Record<string, string>> {
  const rows = await allNotifications();
  return Object.fromEntries(rows.map((row) => [row.recipientId, row.type]));
}

async function addWatcher(taskId: string, user: UserRef, isMuted = false): Promise<void> {
  await db.insert(taskWatchers).values({ taskId, userId: user.id, isMuted });
}

async function addComment(taskId: string, author: UserRef, body: string): Promise<string> {
  const [row] = await db
    .insert(comments)
    .values({ taskId, authorId: author.id, body })
    .returning({ id: comments.id });
  if (!row) throw new Error('comment insert returned nothing');
  return row.id;
}

/** The activity row `patchTask` writes for a description edit. */
async function seedDescriptionChange(
  world: World,
  taskId: string,
  actor: UserRef,
  oldValue: string | null,
  newValue: string | null,
): Promise<void> {
  await db.insert(activity).values({
    projectId: world.projectId,
    taskId,
    actorId: actor.id,
    action: 'task.field_changed',
    field: 'description',
    oldValue,
    newValue,
  });
}

/**
 * The audience snapshot a real publisher takes INSIDE its transaction — the
 * task's assignee and reporter as they stand at this instant.
 *
 * Every event builder below goes through it, which is what lets this suite
 * express the race the snapshot exists for: build the event, THEN reassign the
 * task, then hand the event to the handler. It also removes the duplication the
 * old `assigneeId` parameter created, where each caller had to restate the value
 * it had just seeded.
 */
async function audienceOf(taskId: string): Promise<AudienceSnapshot> {
  const [row] = await db
    .select({ assigneeId: tasks.assigneeId, reporterId: tasks.reporterId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return {
    assigneeIdAtCommit: row?.assigneeId ?? null,
    reporterIdAtCommit: row?.reporterId ?? null,
  };
}

async function taskUpdatedEvent(
  world: World,
  actor: UserRef,
  taskId: string,
  changedFields: string[],
): Promise<DomainEventMap['task.updated']> {
  return {
    projectId: world.projectId,
    actorId: actor.id,
    originSocketId: null,
    taskId,
    changedFields,
    ...(await audienceOf(taskId)),
  };
}

let world: World;

beforeAll(async () => {
  await ensureTestDb();
});

beforeEach(async () => {
  await truncateAllTables();
  clearDomainEventHandlers();
  world = await seedWorld();
});

afterAll(async () => {
  clearDomainEventHandlers();
  await closeDb();
});

// ───────────────────────────────────────────────────────────────────────────
// task_assigned
// ───────────────────────────────────────────────────────────────────────────

describe('task_assigned', () => {
  it('notifies the new assignee and never the actor', async () => {
    const taskId = await seedTask(world, { assigneeId: world.viewer.id });

    await handleTaskUpdated(await taskUpdatedEvent(world, world.admin, taskId, ['assigneeId']));

    const rows = await allNotifications();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.recipientId).toBe(world.viewer.id);
    expect(rows[0]?.type).toBe('task_assigned');
    expect(rows[0]?.actorId).toBe(world.admin.id);
  });

  it('writes nothing when a user assigns a task to themselves', async () => {
    const taskId = await seedTask(world, { assigneeId: world.admin.id });

    await handleTaskUpdated(await taskUpdatedEvent(world, world.admin, taskId, ['assigneeId']));

    expect(await allNotifications()).toHaveLength(0);
  });

  it('denormalizes the whole deep-link snapshot into the payload', async () => {
    const taskId = await seedTask(world, { assigneeId: world.member.id, title: 'Ship the bell' });

    await handleTaskCreated({
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
      statusId: world.statuses.todo,
      ...(await audienceOf(taskId)),
    });

    const [row] = await allNotifications();
    expect(row?.type).toBe('task_assigned');
    expect(row?.payload).toMatchObject({
      taskId,
      taskTitle: 'Ship the bell',
      projectKey: world.projectKey,
      actorName: 'Project Admin',
    });
    // `taskKey` and `orgSlug` are what the click target is built from.
    expect(String((row?.payload as { taskKey?: string }).taskKey)).toMatch(
      new RegExp(`^${world.projectKey}-\\d+$`, 'u'),
    );
    expect((row?.payload as { orgSlug?: string }).orgSlug).toMatch(/^wp23-org-/u);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// status_changed
// ───────────────────────────────────────────────────────────────────────────

describe('status_changed', () => {
  it('reaches the assignee, the reporter and every watcher but the actor', async () => {
    const taskId = await seedTask(world, {
      assigneeId: world.viewer.id,
      reporterId: world.member.id,
    });
    const watcher = await seedUser({ name: 'Watcher' });
    await db.insert(projectMembers).values({
      projectId: world.projectId,
      userId: watcher.id,
      role: 'member',
    });
    await addWatcher(taskId, watcher);
    await addWatcher(taskId, world.admin);

    await handleTaskUpdated(await taskUpdatedEvent(world, world.admin, taskId, ['statusId']));

    const byUser = await recipientTypes();
    expect(Object.keys(byUser).sort()).toEqual(
      [world.viewer.id, world.member.id, watcher.id].sort(),
    );
    expect(byUser[world.viewer.id]).toBe('status_changed');
    expect(byUser[world.admin.id]).toBeUndefined();
  });

  it('skips a MUTED watcher even when they are also the assignee', async () => {
    const taskId = await seedTask(world, {
      assigneeId: world.viewer.id,
      reporterId: world.member.id,
    });
    await addWatcher(taskId, world.viewer, true);

    await handleTaskUpdated(await taskUpdatedEvent(world, world.admin, taskId, ['statusId']));

    const byUser = await recipientTypes();
    expect(byUser[world.viewer.id]).toBeUndefined();
    expect(byUser[world.member.id]).toBe('status_changed');
  });

  it('skips a watcher who cannot see the project', async () => {
    const taskId = await seedTask(world);
    // `outsider` belongs to the org but has no project role.
    await addWatcher(taskId, world.outsider);

    await handleTaskUpdated(await taskUpdatedEvent(world, world.admin, taskId, ['statusId']));

    const byUser = await recipientTypes();
    expect(byUser[world.outsider.id]).toBeUndefined();
    // The fixture's default reporter is a real member, and still gets a row —
    // proving the fan-out ran and the outsider was filtered, not that it
    // produced nothing at all.
    expect(byUser[world.member.id]).toBe('status_changed');
  });

  it('ignores a change to a field nobody is notified about', async () => {
    const taskId = await seedTask(world, { assigneeId: world.viewer.id });

    await handleTaskUpdated(
      await taskUpdatedEvent(world, world.admin, taskId, ['priority', 'title']),
    );

    expect(await allNotifications()).toHaveLength(0);
  });

  /**
   * WP5.6 — THE AUDIENCE RACE.
   *
   * The fan-out runs after its publisher committed, so a reassignment that lands
   * in that window used to REDIRECT the notification: the handler re-read
   * `tasks.assignee_id`, found the new person, and told them about a status
   * change they never saw — while the person who actually held the task when it
   * moved was told nothing. Both halves of that are asserted, because fixing
   * only the first (nobody wrong is notified) would also be satisfied by a
   * handler that notifies nobody at all.
   *
   * The `db.update` between building the event and handling it IS the race,
   * deterministically staged: `audienceOf` runs inside `taskUpdatedEvent`, which
   * is the moment the real publisher's transaction reads the row.
   */
  it('addresses the assignee AT COMMIT, not one reassigned after the event', async () => {
    const taskId = await seedTask(world, {
      assigneeId: world.viewer.id,
      reporterId: null,
    });
    const event = await taskUpdatedEvent(world, world.admin, taskId, ['statusId']);

    const latecomer = await seedUser({ name: 'Reassigned To' });
    await db
      .insert(projectMembers)
      .values({ projectId: world.projectId, userId: latecomer.id, role: 'member' });
    await db.update(tasks).set({ assigneeId: latecomer.id }).where(eq(tasks.id, taskId));

    await handleTaskUpdated(event);

    const byUser = await recipientTypes();
    expect(byUser[world.viewer.id]).toBe('status_changed');
    expect(byUser[latecomer.id]).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// task.moved — the board drop
// ───────────────────────────────────────────────────────────────────────────

/**
 * A drop is a status change about half the time, and only that half is news.
 *
 * WP4.7 moved that distinction ONTO THE EVENT (`statusChanged`, set inside the
 * move transaction where the old status is still in scope). These tests used to
 * seed an `activity` row and let the handler read it back — which meant they
 * were really asserting that `moveTask` writes the right audit row LAST, from a
 * suite that never calls `moveTask`. Now they assert the fan-out, and
 * `tasks.service`'s own suite owns whether the flag is set correctly.
 */
describe('task.moved', () => {
  async function moveEvent(taskId: string, actor: UserRef, statusChanged: boolean): Promise<void> {
    await handleTaskMoved({
      projectId: world.projectId,
      actorId: actor.id,
      originSocketId: null,
      taskId,
      statusId: world.statuses.inProgress,
      boardRank: 'a1',
      rebalanced: false,
      updatedAt: '2026-03-04T10:00:00.000Z',
      statusChanged,
      ...(await audienceOf(taskId)),
    });
  }

  it('notifies when the drop actually changed the column', async () => {
    const taskId = await seedTask(world, { assigneeId: world.viewer.id, reporterId: null });

    await moveEvent(taskId, world.admin, true);

    const byUser = await recipientTypes();
    expect(byUser[world.viewer.id]).toBe('status_changed');
  });

  it('stays silent for a re-order inside the same column', async () => {
    const taskId = await seedTask(world, { assigneeId: world.viewer.id, reporterId: null });

    await moveEvent(taskId, world.admin, false);

    expect(await allNotifications()).toHaveLength(0);
  });

  /**
   * The cheap half of the fix, worth pinning: a re-order must not even look the
   * task up. It is the most frequent event on a busy board, and the handler it
   * replaced ran a query on every single one.
   */
  it('does no work at all for a re-order — not even a task lookup', async () => {
    await moveEvent('00000000-0000-4000-8000-000000000000', world.admin, false);

    expect(await allNotifications()).toHaveLength(0);
  });

  /** The board drop's half of the audience race — see the `status_changed` twin. */
  it('tells the person who held the card, not whoever it was handed to after', async () => {
    const taskId = await seedTask(world, { assigneeId: world.viewer.id });
    const snapshot = await audienceOf(taskId);

    const latecomer = await seedUser({ name: 'Reassigned Mid-Drag' });
    await db
      .insert(projectMembers)
      .values({ projectId: world.projectId, userId: latecomer.id, role: 'member' });
    await db.update(tasks).set({ assigneeId: latecomer.id }).where(eq(tasks.id, taskId));

    await handleTaskMoved({
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
      statusId: world.statuses.inProgress,
      boardRank: 'a1',
      rebalanced: false,
      statusChanged: true,
      ...snapshot,
    });

    const byUser = await recipientTypes();
    expect(byUser[world.viewer.id]).toBe('status_changed');
    expect(byUser[latecomer.id]).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// comment_added / mentioned
// ───────────────────────────────────────────────────────────────────────────

describe('comment_added and mentioned', () => {
  it('notifies the task audience and previous authors on the thread', async () => {
    const taskId = await seedTask(world, {
      assigneeId: world.viewer.id,
      reporterId: world.member.id,
    });
    const earlier = await seedUser({ name: 'Earlier Author' });
    await db
      .insert(projectMembers)
      .values({ projectId: world.projectId, userId: earlier.id, role: 'member' });
    await addComment(taskId, earlier, 'I looked at this last week.');
    const commentId = await addComment(taskId, world.admin, 'Any progress here?');

    await handleCommentCreated({
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
      commentId,
      mentionedUserIds: [],
      ...(await audienceOf(taskId)),
    });

    const byUser = await recipientTypes();
    expect(Object.keys(byUser).sort()).toEqual(
      [world.viewer.id, world.member.id, earlier.id].sort(),
    );
    expect(byUser[earlier.id]).toBe('comment_added');
  });

  it('gives a mentioned watcher ONE row, and it is the mention', async () => {
    const taskId = await seedTask(world, {
      assigneeId: world.viewer.id,
      reporterId: world.member.id,
    });
    await addWatcher(taskId, world.viewer);
    const commentId = await addComment(
      taskId,
      world.admin,
      `cc @[Project Viewer](${world.viewer.id}) please look`,
    );

    await handleCommentCreated({
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
      commentId,
      mentionedUserIds: [world.viewer.id],
      ...(await audienceOf(taskId)),
    });

    const rows = await allNotifications();
    const forViewer = rows.filter((row) => row.recipientId === world.viewer.id);
    expect(forViewer).toHaveLength(1);
    expect(forViewer[0]?.type).toBe('mentioned');
    // The reporter still gets the ordinary comment row.
    expect(rows.find((row) => row.recipientId === world.member.id)?.type).toBe('comment_added');
  });

  it('snapshots a plain-text comment excerpt and the comment id', async () => {
    const taskId = await seedTask(world, { assigneeId: world.viewer.id, reporterId: null });
    const commentId = await addComment(
      taskId,
      world.admin,
      `Ping @[Project Viewer](${world.viewer.id})\n\nabout   the   rebalance`,
    );

    await handleCommentCreated({
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
      commentId,
      mentionedUserIds: [],
      ...(await audienceOf(taskId)),
    });

    const rows = await allNotifications();
    const row = rows.find((candidate) => candidate.recipientId === world.viewer.id);
    expect(row?.commentId).toBe(commentId);
    expect((row?.payload as { commentExcerpt?: string }).commentExcerpt).toBe(
      'Ping @Project Viewer about the rebalance',
    );
  });

  it('never notifies a mentioned user who cannot see the project', async () => {
    const taskId = await seedTask(world);
    const commentId = await addComment(taskId, world.admin, 'hidden');

    await handleCommentCreated({
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
      commentId,
      mentionedUserIds: [world.outsider.id],
      ...(await audienceOf(taskId)),
    });

    const byUser = await recipientTypes();
    expect(byUser[world.outsider.id]).toBeUndefined();
    expect(byUser[world.member.id]).toBe('comment_added');
  });
});

describe('mentions in a task description', () => {
  it('notifies only the users the EDIT newly named', async () => {
    const description = `owner @[Project Member](${world.member.id}) and @[Project Viewer](${world.viewer.id})`;
    const taskId = await seedTask(world, { assigneeId: null, reporterId: null });
    await db.update(tasks).set({ description }).where(eq(tasks.id, taskId));
    // The previous body already named the member — only the viewer is new.
    await seedDescriptionChange(
      world,
      taskId,
      world.admin,
      `owner @[Project Member](${world.member.id})`,
      description,
    );

    await handleTaskUpdated(await taskUpdatedEvent(world, world.admin, taskId, ['description']));

    const byUser = await recipientTypes();
    expect(byUser).toEqual({ [world.viewer.id]: 'mentioned' });
  });

  it('notifies everyone a NEW task names, since there is no previous body', async () => {
    const taskId = await seedTask(world, { assigneeId: null, reporterId: null });
    await db
      .update(tasks)
      .set({ description: `hi @[Project Viewer](${world.viewer.id})` })
      .where(eq(tasks.id, taskId));

    await handleTaskCreated({
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
      statusId: world.statuses.todo,
      ...(await audienceOf(taskId)),
    });

    expect(await recipientTypes()).toEqual({ [world.viewer.id]: 'mentioned' });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// sprint_started / sprint_completed
// ───────────────────────────────────────────────────────────────────────────

describe('sprint notifications', () => {
  it('reaches the sprint assignees and the project admins, minus the actor', async () => {
    const sprintId = await seedSprint(world, { name: 'Sprint 9', state: 'active' });
    await seedTask(world, { sprintId, assigneeId: world.viewer.id });
    await seedTask(world, { sprintId, assigneeId: null });

    await handleSprintChanged({
      projectId: world.projectId,
      actorId: world.member.id,
      originSocketId: null,
      sprintId,
      action: 'started',
    });

    const rows = await allNotifications();
    const byUser = await recipientTypes();
    // `admin` is the project's only admin; `viewer` carries a task in it.
    expect(Object.keys(byUser).sort()).toEqual([world.admin.id, world.viewer.id].sort());
    expect(byUser[world.admin.id]).toBe('sprint_started');
    expect(rows[0]?.taskId).toBeNull();
    expect((rows[0]?.payload as { sprintName?: string }).sprintName).toBe('Sprint 9');
  });

  it('maps `completed` to its own type', async () => {
    const sprintId = await seedSprint(world, { name: 'Sprint 9' });
    await seedTask(world, { sprintId, assigneeId: world.viewer.id });

    await handleSprintChanged({
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      sprintId,
      action: 'completed',
    });

    expect((await recipientTypes())[world.viewer.id]).toBe('sprint_completed');
  });

  it('writes nothing for a sprint edit', async () => {
    const sprintId = await seedSprint(world);
    await seedTask(world, { sprintId, assigneeId: world.viewer.id });

    await handleSprintChanged({
      projectId: world.projectId,
      actorId: world.member.id,
      originSocketId: null,
      sprintId,
      action: 'updated',
    });

    expect(await allNotifications()).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// due_soon
// ───────────────────────────────────────────────────────────────────────────

describe('the due-soon sweep', () => {
  const NOW = new Date('2026-03-10T09:00:00.000Z');
  const today = '2026-03-10';
  const tomorrow = '2026-03-11';

  it('notifies the assignee of a task falling due inside the window', async () => {
    await seedTask(world, { assigneeId: world.viewer.id, dueDate: tomorrow });

    const created = await runDueSoonSweep(NOW);

    expect(created).toHaveLength(1);
    expect(created[0]?.recipientId).toBe(world.viewer.id);
    expect(created[0]?.type).toBe('due_soon');
    expect(created[0]?.payload.taskKey).toMatch(new RegExp(`^${world.projectKey}-`, 'u'));
  });

  it('ignores tasks outside the window, unassigned, deleted or already done', async () => {
    await seedTask(world, { assigneeId: world.viewer.id, dueDate: '2026-03-20' });
    await seedTask(world, { assigneeId: world.viewer.id, dueDate: '2026-03-01' });
    await seedTask(world, { assigneeId: null, dueDate: today });
    await seedTask(world, { assigneeId: world.viewer.id, dueDate: today, deletedAt: new Date() });
    await seedTask(world, {
      assigneeId: world.viewer.id,
      dueDate: today,
      statusId: world.statuses.done,
    });

    expect(await runDueSoonSweep(NOW)).toHaveLength(0);
  });

  it('does not notify twice for the same task inside 24 hours', async () => {
    await seedTask(world, { assigneeId: world.viewer.id, dueDate: today });

    expect(await runDueSoonSweep(NOW)).toHaveLength(1);
    // The sweep runs every 30 minutes; the second pass must be a no-op.
    expect(await runDueSoonSweep(new Date(NOW.getTime() + 30 * 60_000))).toHaveLength(0);
  });

  it('notifies again once the earlier row has aged past 24 hours', async () => {
    const taskId = await seedTask(world, { assigneeId: world.viewer.id, dueDate: tomorrow });
    await db.insert(notifications).values({
      recipientId: world.viewer.id,
      type: 'due_soon',
      projectId: world.projectId,
      taskId,
      payload: {},
      createdAt: new Date(NOW.getTime() - 25 * 3_600_000),
    });

    expect(await runDueSoonSweep(NOW)).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The three subtractions, at their edges
// ───────────────────────────────────────────────────────────────────────────

/**
 * The recipient rules stated as absolutes in the file header — "the actor is
 * always subtracted", "priority collapses two triggers into one row", "a
 * recipient must be able to SEE the project" — each have an edge the suites
 * above reach past rather than through. These pin them.
 */
describe('recipient math at the edges', () => {
  /**
   * A task nobody is attached to.
   *
   * `seedTask` defaults `reporterId` to the project member (`?? `, so passing
   * `null` does NOT clear it), which is right for most fixtures and wrong for
   * a test about an empty audience — the reporter would supply the very row the
   * assertion is claiming does not exist.
   */
  async function seedUnattachedTask(): Promise<string> {
    const taskId = await seedTask(world, { assigneeId: null });
    await db.update(tasks).set({ reporterId: null }).where(eq(tasks.id, taskId));
    return taskId;
  }

  it('writes nothing for a SELF-mention: the actor subtraction beats a mention', async () => {
    // `mentioned` is the strongest type there is, so if anything could survive
    // the actor subtraction it would be this. It must not: nobody is told about
    // their own action, including typing their own name.
    const taskId = await seedUnattachedTask();
    const commentId = await addComment(
      taskId,
      world.admin,
      `note to self @[Project Admin](${world.admin.id})`,
    );

    await handleCommentCreated({
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
      commentId,
      mentionedUserIds: [world.admin.id],
      ...(await audienceOf(taskId)),
    });

    expect(await allNotifications()).toHaveLength(0);
  });

  it('gives a WATCHER who is also the new assignee ONE row — the assignment', async () => {
    // Two triggers name the same person in one event: `status_changed` through
    // the watch, `task_assigned` through the assignment. `task_assigned` is the
    // stronger type, and exactly one row must be written.
    const taskId = await seedTask(world, { assigneeId: world.viewer.id });
    await addWatcher(taskId, world.viewer);

    await handleTaskUpdated(
      await taskUpdatedEvent(world, world.admin, taskId, ['statusId', 'assigneeId']),
    );

    const rows = await allNotifications();
    const forViewer = rows.filter((row) => row.recipientId === world.viewer.id);
    expect(forViewer).toHaveLength(1);
    expect(forViewer[0]?.type).toBe('task_assigned');
  });

  it('still MUTES that watcher-assignee when they asked to be left alone', async () => {
    // The mute is subtracted after the priority collapse, so being handed the
    // task does not reopen a conversation the person opted out of.
    const taskId = await seedUnattachedTask();
    await db.update(tasks).set({ assigneeId: world.viewer.id }).where(eq(tasks.id, taskId));
    await addWatcher(taskId, world.viewer, true);

    await handleTaskUpdated(
      await taskUpdatedEvent(world, world.admin, taskId, ['statusId', 'assigneeId']),
    );

    expect(await allNotifications()).toHaveLength(0);
  });

  it('skips a DEACTIVATED recipient, even one with a live project membership', async () => {
    // The visibility filter tests `users.is_active` as well as membership. A
    // deactivated account cannot sign in to read the row, and the payload
    // carries a task title and key — so writing it is storage plus disclosure
    // surface for a mailbox nobody opens.
    const disabled = await seedUser({ name: 'Former Colleague', isActive: false });
    await db
      .insert(projectMembers)
      .values({ projectId: world.projectId, userId: disabled.id, role: 'member' });
    const taskId = await seedTask(world, {
      assigneeId: disabled.id,
      reporterId: world.member.id,
    });

    await handleTaskUpdated(await taskUpdatedEvent(world, world.admin, taskId, ['statusId']));

    const byUser = await recipientTypes();
    expect(byUser[disabled.id]).toBeUndefined();
    // The live reporter still gets a row: the fan-out ran and filtered one
    // recipient, rather than falling over.
    expect(byUser[world.member.id]).toBe('status_changed');
  });

  it('writes nothing at all when every candidate is filtered out', async () => {
    const taskId = await seedUnattachedTask();
    await addWatcher(taskId, world.outsider);

    await handleTaskUpdated(await taskUpdatedEvent(world, world.admin, taskId, ['statusId']));

    expect(await allNotifications()).toHaveLength(0);
  });

  it('does notify a GLOBAL ADMIN who is in no org at all', async () => {
    // The visibility filter mirrors the guards' inheritance chain, and a global
    // admin sits above every membership check in it.
    const superuser = await seedUser({ name: 'Root', isGlobalAdmin: true });
    const taskId = await seedTask(world, { assigneeId: superuser.id, reporterId: null });

    await handleTaskUpdated(await taskUpdatedEvent(world, world.admin, taskId, ['assigneeId']));

    expect((await recipientTypes())[superuser.id]).toBe('task_assigned');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The bus wiring
// ───────────────────────────────────────────────────────────────────────────

describe('the registered subscribers', () => {
  /** Poll, because the subscribers are deliberately not awaited by the bus. */
  async function waitForNotifications(count: number): Promise<void> {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const [row] = await db.select({ total: sql<number>`count(*)::int` }).from(notifications);
      if ((row?.total ?? 0) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`timed out waiting for ${String(count)} notification(s)`);
  }

  it('turns a published `task.updated` into a row', async () => {
    registerNotificationSubscribers();
    const taskId = await seedTask(world, { assigneeId: world.viewer.id });

    publishDomainEvent(
      'task.updated',
      await taskUpdatedEvent(world, world.admin, taskId, ['assigneeId']),
    );

    await waitForNotifications(1);
    expect((await recipientTypes())[world.viewer.id]).toBe('task_assigned');
  });

  it('publishes `notification.created` for every row it writes', async () => {
    const seen: { recipientId: string; type: string }[] = [];
    registerNotificationSubscribers();
    onDomainEvent('notification.created', (event) => {
      seen.push({ recipientId: event.recipientId, type: event.type });
    });

    const taskId = await seedTask(world, {
      assigneeId: world.viewer.id,
      reporterId: world.member.id,
    });
    await handleTaskUpdated(await taskUpdatedEvent(world, world.admin, taskId, ['statusId']));

    expect(seen).toHaveLength(2);
    expect(seen.every((event) => event.type === 'status_changed')).toBe(true);
  });

  /**
   * Every OTHER trigger is subscribed too.
   *
   * `registerNotificationSubscribers` is five near-identical `onDomainEvent`
   * lines, and a handler wired to the wrong event is invisible until somebody
   * reports "the bell never fires when a card is dragged". One published event
   * per subscription is the cheapest possible guard against that.
   */
  it('subscribes `task.created`', async () => {
    registerNotificationSubscribers();
    const taskId = await seedTask(world, { assigneeId: world.viewer.id });

    publishDomainEvent('task.created', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
      statusId: world.statuses.todo,
      ...(await audienceOf(taskId)),
    });

    await waitForNotifications(1);
    expect((await recipientTypes())[world.viewer.id]).toBe('task_assigned');
  });

  it('subscribes `task.moved` — the Kanban drop, which is not a task.updated', async () => {
    registerNotificationSubscribers();
    const taskId = await seedTask(world, { assigneeId: world.viewer.id });

    publishDomainEvent('task.moved', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
      statusId: world.statuses.done,
      boardRank: 'a1',
      rebalanced: false,
      updatedAt: '2026-03-04T10:00:00.000Z',
      statusChanged: true,
      ...(await audienceOf(taskId)),
    });

    await waitForNotifications(1);
    expect((await recipientTypes())[world.viewer.id]).toBe('status_changed');
  });

  it('subscribes `comment.created`', async () => {
    registerNotificationSubscribers();
    const taskId = await seedTask(world, { assigneeId: world.viewer.id });
    const commentId = await addComment(taskId, world.admin, 'Any progress?');

    publishDomainEvent('comment.created', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
      commentId,
      mentionedUserIds: [],
      ...(await audienceOf(taskId)),
    });

    await waitForNotifications(1);
    expect((await recipientTypes())[world.viewer.id]).toBe('comment_added');
  });

  it('subscribes `sprint.changed`', async () => {
    registerNotificationSubscribers();
    const sprintId = await seedSprint(world, { state: 'active' });
    await seedTask(world, { sprintId, assigneeId: world.viewer.id });

    publishDomainEvent('sprint.changed', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      sprintId,
      action: 'started',
    });

    await waitForNotifications(1);
    expect((await recipientTypes())[world.viewer.id]).toBe('sprint_started');
  });

  it('SWALLOWS a fan-out failure instead of surfacing it to the mutation', async () => {
    // The contract the `void … .catch(log)` shape exists to state: a
    // notification is a courtesy attached to a mutation that has ALREADY
    // committed, so nothing that happens here may reach the person who moved
    // the card. A malformed id makes the very first read reject.
    registerNotificationSubscribers();

    expect(() => {
      publishDomainEvent('task.moved', {
        projectId: world.projectId,
        actorId: world.admin.id,
        originSocketId: null,
        taskId: 'not-a-uuid',
        statusId: world.statuses.done,
        boardRank: 'a1',
        rebalanced: false,
        updatedAt: '2026-03-04T10:00:00.000Z',
        statusChanged: true,
        assigneeIdAtCommit: null,
        reporterIdAtCommit: null,
      });
    }).not.toThrow();

    // Give the rejected promise a turn to settle; nothing is written, and the
    // process is still healthy enough to serve the next event.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await allNotifications()).toHaveLength(0);

    const taskId = await seedTask(world, { assigneeId: world.viewer.id });
    publishDomainEvent('task.created', {
      projectId: world.projectId,
      actorId: world.admin.id,
      originSocketId: null,
      taskId,
      statusId: world.statuses.todo,
      assigneeIdAtCommit: world.viewer.id,
      reporterIdAtCommit: null,
    });
    await waitForNotifications(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Pure helpers
// ───────────────────────────────────────────────────────────────────────────

describe('commentExcerpt', () => {
  it('renders mentions as plain text and collapses whitespace', () => {
    expect(commentExcerpt('a @[Ada Lovelace](77777777-7777-4777-8777-777777777777)\n\n b')).toBe(
      'a @Ada Lovelace b',
    );
  });

  it('clips to the limit with an ellipsis', () => {
    expect(commentExcerpt('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}…`);
  });

  it('leaves a short body untouched', () => {
    expect(commentExcerpt('short')).toBe('short');
  });
});

// A guard against a silent regression in the fixture world: the outsider must
// stay invisible to the project, or half the exclusion tests above would pass
// for the wrong reason.
describe('the fixture world', () => {
  it('keeps the outsider out of the project', async () => {
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, world.projectId),
          eq(projectMembers.userId, world.outsider.id),
        ),
      );
    expect(row?.total).toBe(0);
  });
});
