/**
 * `PATCH /api/tasks/:taskId` and the relationship endpoints.
 *
 * The property under test throughout is that HISTORY MATCHES STATE: a patch
 * that changes three fields writes three activity rows, each naming the field
 * and carrying both values, and a patch that changes nothing writes none.
 */
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import type { Task } from '@flowboard/shared';

import { activity, closeDb, db, taskDependencies, tasks } from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import {
  auth,
  captureDomainEvent,
  captureTelemetry,
  createTaskTestApp,
  flushAsync,
  seedLabel,
  seedSprint,
  seedTask,
  seedWorld,
  stopDomainEvents,
  stopTelemetry,
  type World,
} from './task-domain.fixtures';

const app = createTaskTestApp();
let world: World;

beforeAll(async () => {
  await ensureTestDb();
}, 60_000);

beforeEach(async () => {
  await truncateAllTables();
  world = await seedWorld();
});

afterEach(() => {
  stopTelemetry();
  stopDomainEvents();
});

afterAll(async () => {
  await closeDb();
});

/** Every activity row for a task, oldest first. */
async function historyOf(
  taskId: string,
): Promise<{ action: string; field: string | null; oldValue: unknown; newValue: unknown }[]> {
  return db
    .select({
      action: activity.action,
      field: activity.field,
      oldValue: activity.oldValue,
      newValue: activity.newValue,
    })
    .from(activity)
    .where(eq(activity.taskId, taskId))
    .orderBy(asc(activity.id));
}

describe('PATCH /api/tasks/:taskId — field diffs', () => {
  it('writes one activity row per changed field and none for unchanged ones', async () => {
    const taskId = await seedTask(world, { title: 'Before', priority: 'medium' });

    const response = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set('Authorization', auth(world.member))
      .send({ title: 'After', priority: 'high', type: 'task' });

    expect(response.status).toBe(200);
    expect((response.body.data as Task).title).toBe('After');

    const history = await historyOf(taskId);
    expect(history).toEqual([
      { action: 'task.field_changed', field: 'title', oldValue: 'Before', newValue: 'After' },
      { action: 'task.field_changed', field: 'priority', oldValue: 'medium', newValue: 'high' },
    ]);
  });

  it('stores a HALF story point instead of rounding it away', async () => {
    const taskId = await seedTask(world, { title: 'Estimated' });

    const response = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set('Authorization', auth(world.member))
      .send({ storyPoints: 0.5 });

    // `tasks.story_points` is `numeric(5,1)` (WP2.5 changed it from `integer`),
    // and the shared contract has always allowed halves. The rounding the
    // integer column forced would have turned a deliberate 0.5 into 1 — a value
    // the user typed, changed by the database, with no error anywhere.
    expect(response.status).toBe(200);
    expect((response.body.data as Task).storyPoints).toBe(0.5);

    const stored = await db
      .select({ storyPoints: tasks.storyPoints })
      .from(tasks)
      .where(eq(tasks.id, taskId));
    expect(stored[0]?.storyPoints).toBe(0.5);
  });

  it('records an assignment as task.assigned', async () => {
    const taskId = await seedTask(world);

    await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set('Authorization', auth(world.member))
      .send({ assigneeId: world.admin.id });

    const history = await historyOf(taskId);
    expect(history).toEqual([
      {
        action: 'task.assigned',
        field: 'assigneeId',
        oldValue: null,
        newValue: world.admin.id,
      },
    ]);
  });

  it('refuses an assignee who cannot see the project', async () => {
    const taskId = await seedTask(world);
    const response = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set('Authorization', auth(world.member))
      .send({ assigneeId: world.outsider.id });
    expect(response.status).toBe(400);
  });

  it('stamps resolvedAt entering a done column and clears it on the way out', async () => {
    const telemetry = captureTelemetry();
    const taskId = await seedTask(world);

    const resolved = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set('Authorization', auth(world.member))
      .send({ statusId: world.statuses.done });
    expect((resolved.body.data as Task).resolvedAt).not.toBeNull();
    await flushAsync();
    expect(telemetry.map((event) => event.type)).toContain('task_completed');

    const reopened = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set('Authorization', auth(world.member))
      .send({ statusId: world.statuses.todo });
    expect((reopened.body.data as Task).resolvedAt).toBeNull();

    const actions = (await historyOf(taskId)).map((row) => row.action);
    expect(actions).toEqual(['task.status_changed', 'task.status_changed']);
  });

  it('re-ranks into the destination sprint and records task.moved_sprint', async () => {
    const sprintId = await seedSprint(world);
    const first = await seedTask(world, { sprintId });
    const moved = await seedTask(world);

    const before = await request(app)
      .get(`/api/tasks/${moved}`)
      .set('Authorization', auth(world.viewer));

    const response = await request(app)
      .patch(`/api/tasks/${moved}`)
      .set('Authorization', auth(world.member))
      .send({ sprintId });

    const task = response.body.data as Task;
    expect(task.sprintId).toBe(sprintId);
    expect(task.backlogRank).not.toBe((before.body.data as Task).backlogRank);

    const firstTask = await request(app)
      .get(`/api/tasks/${first}`)
      .set('Authorization', auth(world.viewer));
    // Appended: the newcomer sorts after the sprint's existing row.
    expect(task.backlogRank > (firstTask.body.data as Task).backlogRank).toBe(true);

    expect((await historyOf(moved)).map((row) => row.action)).toEqual(['task.moved_sprint']);
  });

  it('diffs labels into one added / removed row each', async () => {
    const keep = await seedLabel(world, 'keep');
    const drop = await seedLabel(world, 'drop');
    const add = await seedLabel(world, 'add');
    const created = await request(app)
      .post(`/api/projects/${world.projectId}/tasks`)
      .set('Authorization', auth(world.member))
      .send({ title: 'Labelled', labelIds: [keep, drop] });
    const taskId = (created.body.data as Task).id;

    const response = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set('Authorization', auth(world.member))
      .send({ labelIds: [keep, add] });

    const labels = (response.body.data as Task).labels.map((label) => label.id).sort();
    expect(labels).toEqual([keep, add].sort());

    const history = (await historyOf(taskId)).filter((row) => row.action.startsWith('label.'));
    expect(history).toEqual([
      { action: 'label.added', field: 'labelIds', oldValue: null, newValue: add },
      { action: 'label.removed', field: 'labelIds', oldValue: drop, newValue: null },
    ]);
  });

  it('publishes task.updated with the fields that actually moved', async () => {
    const events = captureDomainEvent('task.updated');
    const taskId = await seedTask(world, { title: 'Before' });

    await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set('Authorization', auth(world.member))
      .send({ title: 'After' });
    await flushAsync();

    expect(events).toHaveLength(1);
    expect(events[0]?.changedFields).toEqual(['title']);
    expect(events[0]?.originSocketId).toBeNull();
  });

  it('carries X-Socket-Id through to the domain event for echo suppression', async () => {
    const events = captureDomainEvent('task.updated');
    const taskId = await seedTask(world);

    await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set('Authorization', auth(world.member))
      .set('X-Socket-Id', 'socket-abc')
      .send({ title: 'Changed' });
    await flushAsync();

    expect(events[0]?.originSocketId).toBe('socket-abc');
  });

  it('rejects an empty patch and refuses a viewer', async () => {
    const taskId = await seedTask(world);

    const empty = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set('Authorization', auth(world.member))
      .send({});
    expect(empty.status).toBe(422);

    const viewer = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set('Authorization', auth(world.viewer))
      .send({ title: 'Nope' });
    expect(viewer.status).toBe(403);
  });
});

describe('dependencies', () => {
  async function addDependency(
    taskId: string,
    body: Record<string, string>,
    actor = world.member,
  ): Promise<request.Response> {
    return request(app)
      .post(`/api/tasks/${taskId}/dependencies`)
      .set('Authorization', auth(actor))
      .send(body);
  }

  it('records both directions and shows up on each task detail', async () => {
    const blocker = await seedTask(world, { title: 'Blocker' });
    const blocked = await seedTask(world, { title: 'Blocked' });

    const response = await addDependency(blocked, { blockerTaskId: blocker });
    expect(response.status).toBe(201);
    expect((response.body.data as Task).dependencies.blockers.map((ref) => ref.id)).toEqual([
      blocker,
    ]);

    const other = await request(app)
      .get(`/api/tasks/${blocker}`)
      .set('Authorization', auth(world.viewer));
    expect((other.body.data as Task).dependencies.blocked.map((ref) => ref.id)).toEqual([blocked]);

    const rows = await historyOf(blocked);
    expect(rows.map((row) => row.action)).toEqual(['dependency.added']);
  });

  it('accepts the blockedTaskId direction too', async () => {
    const blocker = await seedTask(world);
    const blocked = await seedTask(world);

    const response = await addDependency(blocker, { blockedTaskId: blocked });
    expect(response.status).toBe(201);
    expect((response.body.data as Task).dependencies.blocked.map((ref) => ref.id)).toEqual([
      blocked,
    ]);
  });

  it('refuses both directions at once, and neither', async () => {
    const a = await seedTask(world);
    const b = await seedTask(world);

    expect((await addDependency(a, { blockerTaskId: b, blockedTaskId: b })).status).toBe(422);
    expect((await addDependency(a, {})).status).toBe(422);
  });

  it('refuses a self-edge and a duplicate pair', async () => {
    const a = await seedTask(world);
    const b = await seedTask(world);

    const self = await addDependency(a, { blockerTaskId: a });
    expect(self.status).toBe(400);

    expect((await addDependency(a, { blockerTaskId: b })).status).toBe(201);
    const duplicate = await addDependency(a, { blockerTaskId: b });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('dependency_exists');
  });

  /**
   * WP5.6 — the duplicate that the pre-check cannot catch.
   *
   * The `SELECT`-then-`INSERT` above is a fast path for a good message, not a
   * lock: two clients linking the same pair at once both read "free", and the
   * loser used to surface a raw `23505` as a 500. It must be the SAME 409 the
   * pre-check produces, because the web client branches on the code.
   *
   * Two real concurrent requests, not a mocked race: `task_dependencies_pair_unique`
   * is the thing under test, and only the database can enforce it.
   */
  it('answers the loser of a concurrent duplicate with 409, never a 500', async () => {
    const a = await seedTask(world);
    const b = await seedTask(world);

    const responses = await Promise.all([
      addDependency(a, { blockerTaskId: b }),
      addDependency(a, { blockerTaskId: b }),
    ]);
    const statuses = responses.map((response) => response.status).sort((x, y) => x - y);

    expect(statuses).toEqual([201, 409]);
    const loser = responses.find((response) => response.status === 409);
    expect(loser?.body.error.code).toBe('dependency_exists');

    // Exactly one edge survived — the constraint did its job and the retry
    // path did not write a second row.
    const detail = await request(app)
      .get(`/api/tasks/${a}`)
      .set('Authorization', auth(world.member));
    expect((detail.body.data as Task).dependencies.blockers.map((ref) => ref.id)).toEqual([b]);
  });

  it('refuses an edge that would close a cycle', async () => {
    const a = await seedTask(world, { title: 'A' });
    const b = await seedTask(world, { title: 'B' });
    const c = await seedTask(world, { title: 'C' });

    // A blocks B, B blocks C.
    expect((await addDependency(b, { blockerTaskId: a })).status).toBe(201);
    expect((await addDependency(c, { blockerTaskId: b })).status).toBe(201);

    // C blocking A would close A -> B -> C -> A.
    const cycle = await addDependency(a, { blockerTaskId: c });
    expect(cycle.status).toBe(409);
    expect(cycle.body.error.code).toBe('dependency_cycle');

    const stored = await db.select({ id: taskDependencies.id }).from(taskDependencies);
    expect(stored).toHaveLength(2);
  });

  it('refuses a task from another project', async () => {
    const mine = await seedTask(world);
    const otherWorld = await seedWorld();
    const theirs = await seedTask(otherWorld);

    const response = await addDependency(mine, { blockerTaskId: theirs });
    expect(response.status).toBe(400);
  });

  it('deletes an edge by the OTHER task id and records it on both tasks', async () => {
    const blocker = await seedTask(world);
    const blocked = await seedTask(world);
    await addDependency(blocked, { blockerTaskId: blocker });

    // The dependency ROW id never crosses the wire — `taskSchema.dependencies`
    // expands each edge as a `TaskRef` — so the address is the pair of tasks.
    const response = await request(app)
      .delete(`/api/tasks/${blocked}/dependencies/${blocker}`)
      .set('Authorization', auth(world.member));

    expect(response.status).toBe(204);
    expect(await db.select({ id: taskDependencies.id }).from(taskDependencies)).toHaveLength(0);

    const removals = await db
      .select({ taskId: activity.taskId })
      .from(activity)
      .where(eq(activity.action, 'dependency.removed'));
    expect(removals).toHaveLength(2);
  });

  it('unlinks from EITHER end — direction is not part of the address', async () => {
    const blocker = await seedTask(world);
    const blocked = await seedTask(world);
    await addDependency(blocked, { blockerTaskId: blocker });

    // Same edge, addressed from the blocker's sheet instead of the blocked
    // one's. The pair is unique and the cycle guard refuses the mirror, so at
    // most one row connects them and "unlink these two" is unambiguous.
    const response = await request(app)
      .delete(`/api/tasks/${blocker}/dependencies/${blocked}`)
      .set('Authorization', auth(world.member));

    expect(response.status).toBe(204);
    expect(await db.select({ id: taskDependencies.id }).from(taskDependencies)).toHaveLength(0);
  });

  it('404s when the two tasks are not connected', async () => {
    const a = await seedTask(world);
    const b = await seedTask(world);

    const response = await request(app)
      .delete(`/api/tasks/${a}/dependencies/${b}`)
      .set('Authorization', auth(world.member));

    expect(response.status).toBe(404);
  });

  it('refuses a viewer', async () => {
    const a = await seedTask(world);
    const b = await seedTask(world);
    const response = await addDependency(a, { blockerTaskId: b }, world.viewer);
    expect(response.status).toBe(403);
  });
});

describe('GET /api/projects/:projectId/dependencies — the whole edge set', () => {
  function edges(projectId: string, actor = world.viewer): request.Test {
    return request(app)
      .get(`/api/projects/${projectId}/dependencies`)
      .set('Authorization', auth(actor));
  }

  async function link(blocked: string, blocker: string): Promise<void> {
    const response = await request(app)
      .post(`/api/tasks/${blocked}/dependencies`)
      .set('Authorization', auth(world.member))
      .send({ blockerTaskId: blocker });
    expect(response.status).toBe(201);
  }

  it('returns EVERY edge as a bare pair of ids', async () => {
    const a = await seedTask(world, { title: 'A' });
    const b = await seedTask(world, { title: 'B' });
    const c = await seedTask(world, { title: 'C' });
    await link(b, a);
    await link(c, b);

    const response = await edges(world.projectId);

    expect(response.status).toBe(200);
    const body = response.body.data as {
      edges: { blockerTaskId: string; blockedTaskId: string }[];
    };
    expect(body.edges).toHaveLength(2);
    expect(body.edges).toEqual(
      expect.arrayContaining([
        { blockerTaskId: a, blockedTaskId: b },
        { blockerTaskId: b, blockedTaskId: c },
      ]),
    );
  });

  it('answers an empty set rather than 404 for a project with no edges', async () => {
    const response = await edges(world.projectId);
    expect(response.status).toBe(200);
    expect((response.body.data as { edges: unknown[] }).edges).toEqual([]);
  });

  it('omits an edge whose task was soft-deleted on EITHER end', async () => {
    const blocker = await seedTask(world);
    const blocked = await seedTask(world);
    const survivorBlocker = await seedTask(world);
    const survivorBlocked = await seedTask(world);
    await link(blocked, blocker);
    await link(survivorBlocked, survivorBlocker);

    // Delete the BLOCKED end — the join that only covers the blocker would
    // still return this edge, pointing the Roadmap at a row it is not drawing.
    await request(app)
      .delete(`/api/tasks/${blocked}`)
      .set('Authorization', auth(world.member))
      .expect(204);

    const response = await edges(world.projectId);
    expect((response.body.data as { edges: { blockedTaskId: string }[] }).edges).toEqual([
      { blockerTaskId: survivorBlocker, blockedTaskId: survivorBlocked },
    ]);
  });

  it('never leaks another project’s edges', async () => {
    const otherWorld = await seedWorld();
    const a = await seedTask(otherWorld);
    const b = await seedTask(otherWorld);
    await request(app)
      .post(`/api/tasks/${b}/dependencies`)
      .set('Authorization', auth(otherWorld.member))
      .send({ blockerTaskId: a })
      .expect(201);

    const response = await edges(world.projectId);
    expect((response.body.data as { edges: unknown[] }).edges).toEqual([]);
  });

  it('is a VIEWER read — and closed to a non-member', async () => {
    expect((await edges(world.projectId, world.viewer)).status).toBe(200);
    expect((await edges(world.projectId, world.outsider)).status).toBe(403);
  });

  it('422s on a malformed project id instead of reaching the guard', async () => {
    const response = await edges('not-a-uuid');
    expect(response.status).toBe(422);
  });
});
