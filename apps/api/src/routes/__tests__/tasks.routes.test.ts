/**
 * Task collection, creation, detail and deletion.
 *
 * The centrepiece here is the CONCURRENCY test for `PROJ-N`: ten simultaneous
 * creates must produce ten distinct numbers. That is the one property the
 * atomic `UPDATE … RETURNING` exists for, and a read-then-write implementation
 * passes every other test in this file.
 */
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { BoardResponse, Task, TaskSummary } from '@flowboard/shared';

import { activity, closeDb, db, taskWatchers, tasks } from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import {
  attachLabel,
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

function tasksUrl(): string {
  return `/api/projects/${world.projectId}/tasks`;
}

describe('GET /api/projects/:projectId/tasks — board view', () => {
  it('returns every column, ordered by board rank, empty ones included', async () => {
    await seedTask(world, { title: 'Second', boardRank: 'a2', statusId: world.statuses.todo });
    await seedTask(world, { title: 'First', boardRank: 'a1', statusId: world.statuses.todo });
    await seedTask(world, { title: 'Doing', statusId: world.statuses.inProgress });

    const response = await request(app)
      .get(tasksUrl())
      .query({ view: 'board' })
      .set('Authorization', auth(world.viewer));

    expect(response.status).toBe(200);
    const board = response.body.data as BoardResponse;
    expect(Object.keys(board.columns).sort()).toEqual(
      [world.statuses.todo, world.statuses.inProgress, world.statuses.done].sort(),
    );
    expect(board.columns[world.statuses.todo]?.map((task) => task.title)).toEqual([
      'First',
      'Second',
    ]);
    expect(board.columns[world.statuses.done]).toEqual([]);
  });

  it('omits soft-deleted tasks', async () => {
    await seedTask(world, { title: 'Alive' });
    await seedTask(world, { title: 'Gone', deletedAt: new Date() });

    const response = await request(app)
      .get(tasksUrl())
      .query({ view: 'board' })
      .set('Authorization', auth(world.viewer));

    const board = response.body.data as BoardResponse;
    expect(board.columns[world.statuses.todo]?.map((task) => task.title)).toEqual(['Alive']);
  });

  it('carries counts, dates and updatedAt on every summary', async () => {
    const taskId = await seedTask(world, { startDate: '2026-01-05', dueDate: '2026-01-09' });
    const labelId = await seedLabel(world);
    await attachLabel(taskId, labelId);

    const response = await request(app)
      .get(tasksUrl())
      .query({ view: 'board' })
      .set('Authorization', auth(world.viewer));

    const summary = (response.body.data as BoardResponse).columns[world.statuses.todo]?.[0];
    expect(summary).toMatchObject({
      commentCount: 0,
      attachmentCount: 0,
      startDate: '2026-01-05',
      dueDate: '2026-01-09',
      labelIds: [labelId],
      hasDescription: false,
    });
    expect(typeof summary?.updatedAt).toBe('string');
  });
});

describe('GET /api/projects/:projectId/tasks — flat view', () => {
  it('paginates and sorts by updatedAt desc by default', async () => {
    await seedTask(world, { title: 'One' });
    await seedTask(world, { title: 'Two' });
    await seedTask(world, { title: 'Three' });

    const response = await request(app)
      .get(tasksUrl())
      .query({ pageSize: 2 })
      .set('Authorization', auth(world.viewer));

    expect(response.status).toBe(200);
    expect((response.body.data as TaskSummary[]).length).toBe(2);
    expect(response.body.meta).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
  });

  it('honours ?sort=number:asc', async () => {
    await seedTask(world, { title: 'One' });
    await seedTask(world, { title: 'Two' });

    const response = await request(app)
      .get(tasksUrl())
      .query({ sort: 'number:asc' })
      .set('Authorization', auth(world.viewer));

    const numbers = (response.body.data as TaskSummary[]).map((task) => task.number);
    expect(numbers).toEqual([...numbers].sort((left, right) => left - right));
  });

  it('rejects an unknown sort field at the boundary', async () => {
    const response = await request(app)
      .get(tasksUrl())
      .query({ sort: 'nonsense:asc' })
      .set('Authorization', auth(world.viewer));

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('validation_error');
  });
});

describe('GET /api/projects/:projectId/tasks — filters', () => {
  it('filters by a comma-separated status list', async () => {
    await seedTask(world, { title: 'Todo one' });
    await seedTask(world, { title: 'Doing one', statusId: world.statuses.inProgress });

    const response = await request(app)
      .get(tasksUrl())
      .query({ statusId: `${world.statuses.inProgress},${world.statuses.done}` })
      .set('Authorization', auth(world.viewer));

    expect((response.body.data as TaskSummary[]).map((task) => task.title)).toEqual(['Doing one']);
  });

  it('treats assigneeId=none as the unassigned bucket', async () => {
    await seedTask(world, { title: 'Assigned', assigneeId: world.member.id });
    await seedTask(world, { title: 'Unassigned' });

    const response = await request(app)
      .get(tasksUrl())
      .query({ assigneeId: 'none' })
      .set('Authorization', auth(world.viewer));

    expect((response.body.data as TaskSummary[]).map((task) => task.title)).toEqual(['Unassigned']);
  });

  it('treats sprintId=none as the backlog, and mixes sentinel with ids', async () => {
    const sprintId = await seedSprint(world);
    await seedTask(world, { title: 'In sprint', sprintId });
    await seedTask(world, { title: 'Backlog' });

    const backlogOnly = await request(app)
      .get(tasksUrl())
      .query({ sprintId: 'none' })
      .set('Authorization', auth(world.viewer));
    expect((backlogOnly.body.data as TaskSummary[]).map((task) => task.title)).toEqual(['Backlog']);

    const both = await request(app)
      .get(tasksUrl())
      .query({ sprintId: `none,${sprintId}` })
      .set('Authorization', auth(world.viewer));
    expect((both.body.data as TaskSummary[]).length).toBe(2);
  });

  it('filters by label and by free text', async () => {
    const labelId = await seedLabel(world, 'backend');
    const tagged = await seedTask(world, { title: 'Tune the query planner' });
    await attachLabel(tagged, labelId);
    await seedTask(world, { title: 'Write the docs' });

    const byLabel = await request(app)
      .get(tasksUrl())
      .query({ labelId })
      .set('Authorization', auth(world.viewer));
    expect((byLabel.body.data as TaskSummary[]).map((task) => task.title)).toEqual([
      'Tune the query planner',
    ]);

    const byText = await request(app)
      .get(tasksUrl())
      .query({ q: 'docs' })
      .set('Authorization', auth(world.viewer));
    expect((byText.body.data as TaskSummary[]).map((task) => task.title)).toEqual([
      'Write the docs',
    ]);
  });

  it('refuses a caller with no project access', async () => {
    const response = await request(app).get(tasksUrl()).set('Authorization', auth(world.outsider));
    expect(response.status).toBe(403);
  });
});

/**
 * The Calendar and Roadmap window. The property under test is that a task is a
 * SPAN: "which tasks touch April" must find the one that starts in March and is
 * due in May, which a due-date-only query cannot.
 */
describe('GET /api/projects/:projectId/tasks — the date window', () => {
  function titlesFor(query: Record<string, string>): Promise<string[]> {
    return request(app)
      .get(tasksUrl())
      .query(query)
      .set('Authorization', auth(world.viewer))
      .then((response) => {
        expect(response.status).toBe(200);
        return (response.body.data as TaskSummary[]).map((task) => task.title).sort();
      });
  }

  /** April 2026 as the grid would ask for it. */
  const APRIL = { from: '2026-04-01', to: '2026-04-30' };

  beforeEach(async () => {
    await seedTask(world, { title: 'Spans', startDate: '2026-03-20', dueDate: '2026-05-10' });
    await seedTask(world, { title: 'DueInside', startDate: null, dueDate: '2026-04-15' });
    await seedTask(world, { title: 'StartsInside', startDate: '2026-04-05', dueDate: null });
    await seedTask(world, { title: 'Before', startDate: '2026-01-02', dueDate: '2026-01-09' });
    await seedTask(world, { title: 'Undated', startDate: null, dueDate: null });
  });

  it('narrows the due-date column on its own', async () => {
    expect(await titlesFor({ dueFrom: APRIL.from, dueTo: APRIL.to })).toEqual(['DueInside']);
  });

  it('narrows the start-date column on its own', async () => {
    expect(await titlesFor({ startFrom: APRIL.from, startTo: APRIL.to })).toEqual(['StartsInside']);
  });

  it('ORs the two ranges rather than intersecting them', async () => {
    // `DueInside` has NO start date and `StartsInside` has NO due date, so each
    // one satisfies exactly one of the two pairs. AND-ing them (the shape a
    // naive `push()` per parameter produces) would return NOTHING here, which
    // is the regression this asserts against.
    expect(
      await titlesFor({
        dueFrom: APRIL.from,
        dueTo: APRIL.to,
        startFrom: APRIL.from,
        startTo: APRIL.to,
      }),
    ).toEqual(['DueInside', 'StartsInside']);
  });

  it('each pair bounds its OWN column — the halves are still ANDs', async () => {
    // `Before` starts on 2026-01-02, so an open-ended upper bound alone catches
    // it: the OR is between the two COLUMNS, not between every bound.
    expect(await titlesFor({ startTo: APRIL.to })).toEqual(['Before', 'Spans', 'StartsInside']);
    expect(await titlesFor({ startFrom: APRIL.from, startTo: APRIL.to })).toEqual(['StartsInside']);
  });

  it('selects the unscheduled tray with ?undated=true — NEITHER date, not either', async () => {
    expect(await titlesFor({ undated: 'true' })).toEqual(['Undated']);
  });

  it('treats ?undated=false as "do not filter"', async () => {
    expect(await titlesFor({ undated: 'false' })).toHaveLength(5);
  });

  it('422s on a malformed date rather than silently ignoring it', async () => {
    const response = await request(app)
      .get(tasksUrl())
      .query({ startFrom: '2026-13-40' })
      .set('Authorization', auth(world.viewer));
    expect(response.status).toBe(422);
  });
});

describe('POST /api/projects/:projectId/tasks', () => {
  it('allocates the next number, composes the key and defaults to the first todo column', async () => {
    const response = await request(app)
      .post(tasksUrl())
      .set('Authorization', auth(world.member))
      .send({ title: 'First issue' });

    expect(response.status).toBe(201);
    const task = response.body.data as Task;
    expect(task.number).toBe(1);
    expect(task.key).toBe(`${world.projectKey}-1`);
    expect(task.statusId).toBe(world.statuses.todo);
    expect(task.reporter?.id).toBe(world.member.id);
  });

  it('allocates UNIQUE numbers under ten concurrent creates', async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        request(app)
          .post(tasksUrl())
          .set('Authorization', auth(world.member))
          .send({ title: `Concurrent ${String(index)}` }),
      ),
    );

    expect(responses.every((response) => response.status === 201)).toBe(true);
    const numbers = responses.map((response) => (response.body.data as Task).number);
    expect(new Set(numbers).size).toBe(10);
    expect([...numbers].sort((left, right) => left - right)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it('accepts an explicit in-project status and refuses a foreign one', async () => {
    const ok = await request(app)
      .post(tasksUrl())
      .set('Authorization', auth(world.member))
      .send({ title: 'Straight to doing', statusId: world.statuses.inProgress });
    expect(ok.status).toBe(201);
    expect((ok.body.data as Task).statusId).toBe(world.statuses.inProgress);

    const other = await seedWorld();
    const bad = await request(app)
      .post(tasksUrl())
      .set('Authorization', auth(world.member))
      .send({ title: 'Wrong column', statusId: other.statuses.todo });
    expect(bad.status).toBe(400);
  });

  it('stamps resolvedAt when a task is created straight into a done column', async () => {
    const response = await request(app)
      .post(tasksUrl())
      .set('Authorization', auth(world.member))
      .send({ title: 'Already finished', statusId: world.statuses.done });

    expect((response.body.data as Task).resolvedAt).not.toBeNull();
  });

  it('validates the epic link and the subtask/parent equivalence', async () => {
    const plainId = await seedTask(world, { title: 'Not an epic' });
    const epicId = await seedTask(world, { title: 'Real epic', type: 'epic' });

    const wrongEpic = await request(app)
      .post(tasksUrl())
      .set('Authorization', auth(world.member))
      .send({ title: 'Bad epic link', epicId: plainId });
    expect(wrongEpic.status).toBe(400);

    const goodEpic = await request(app)
      .post(tasksUrl())
      .set('Authorization', auth(world.member))
      .send({ title: 'Good epic link', epicId });
    expect(goodEpic.status).toBe(201);

    const subtaskWithoutParent = await request(app)
      .post(tasksUrl())
      .set('Authorization', auth(world.member))
      .send({ title: 'Orphan subtask', type: 'subtask' });
    expect(subtaskWithoutParent.status).toBe(400);

    const parentWithoutSubtaskType = await request(app)
      .post(tasksUrl())
      .set('Authorization', auth(world.member))
      .send({ title: 'Parented story', type: 'story', parentId: plainId });
    expect(parentWithoutSubtaskType.status).toBe(400);

    const subtask = await request(app)
      .post(tasksUrl())
      .set('Authorization', auth(world.member))
      .send({ title: 'Proper subtask', type: 'subtask', parentId: plainId });
    expect(subtask.status).toBe(201);

    const nested = await request(app)
      .post(tasksUrl())
      .set('Authorization', auth(world.member))
      .send({
        title: 'Sub-subtask',
        type: 'subtask',
        parentId: (subtask.body.data as Task).id,
      });
    expect(nested.status).toBe(400);
  });

  it('applies labels, bootstraps watchers and auto-watches the reporter', async () => {
    const labelId = await seedLabel(world);
    const response = await request(app)
      .post(tasksUrl())
      .set('Authorization', auth(world.member))
      .send({ title: 'Watched', labelIds: [labelId], watcherIds: [world.admin.id] });

    const task = response.body.data as Task;
    expect(task.labels.map((label) => label.id)).toEqual([labelId]);
    expect([...task.watcherIds].sort()).toEqual([world.member.id, world.admin.id].sort());
  });

  it('refuses a watcher who cannot see the project', async () => {
    const response = await request(app)
      .post(tasksUrl())
      .set('Authorization', auth(world.member))
      .send({ title: 'Bad watcher', watcherIds: [world.outsider.id] });
    expect(response.status).toBe(400);
  });

  it('records activity, telemetry and a domain event', async () => {
    const telemetry = captureTelemetry();
    const events = captureDomainEvent('task.created');

    const response = await request(app)
      .post(tasksUrl())
      .set('Authorization', auth(world.member))
      .send({ title: 'Observed' });
    const taskId = (response.body.data as Task).id;
    await flushAsync();

    const rows = await db
      .select({ action: activity.action, newValue: activity.newValue })
      .from(activity)
      .where(eq(activity.taskId, taskId));
    expect(rows.map((row) => row.action)).toEqual(['task.created']);

    expect(telemetry.map((event) => event.type)).toContain('task_created');
    expect(events).toHaveLength(1);
    expect(events[0]?.taskId).toBe(taskId);
  });

  it('refuses a viewer', async () => {
    const response = await request(app)
      .post(tasksUrl())
      .set('Authorization', auth(world.viewer))
      .send({ title: 'Not allowed' });
    expect(response.status).toBe(403);
  });
});

describe('GET /api/tasks/:taskId and the by-key lookup', () => {
  it('expands labels, watchers, dependencies, subtasks and the epic', async () => {
    const epicId = await seedTask(world, { title: 'Epic', type: 'epic' });
    const created = await request(app)
      .post(tasksUrl())
      .set('Authorization', auth(world.member))
      .send({ title: 'Parent', epicId });
    const taskId = (created.body.data as Task).id;

    await request(app)
      .post(tasksUrl())
      .set('Authorization', auth(world.member))
      .send({ title: 'Child', type: 'subtask', parentId: taskId });

    const blockerId = await seedTask(world, { title: 'Blocker' });
    await request(app)
      .post(`/api/tasks/${taskId}/dependencies`)
      .set('Authorization', auth(world.member))
      .send({ blockerTaskId: blockerId });

    const response = await request(app)
      .get(`/api/tasks/${taskId}`)
      .set('Authorization', auth(world.viewer));

    expect(response.status).toBe(200);
    const task = response.body.data as Task;
    expect(task.epic?.id).toBe(epicId);
    expect(task.epic?.key).toBe(`${world.projectKey}-${String(task.epic?.number ?? 0)}`);
    expect(task.subtaskIds).toHaveLength(1);
    expect(task.dependencies.blockers.map((ref) => ref.id)).toEqual([blockerId]);
    expect(task.dependencies.blocked).toEqual([]);
    expect(task.watcherIds).toContain(world.member.id);
  });

  it('returns the same payload from /tasks/by-key/:taskKey', async () => {
    const created = await request(app)
      .post(tasksUrl())
      .set('Authorization', auth(world.member))
      .send({ title: 'Findable' });
    const task = created.body.data as Task;

    // The WHOLE key (`FLOW-12`), because that is what a pasted deep link and a
    // command-palette hit both carry.
    const response = await request(app)
      .get(`${tasksUrl()}/by-key/${task.key}`)
      .set('Authorization', auth(world.viewer));

    expect(response.status).toBe(200);
    expect((response.body.data as Task).id).toBe(task.id);
  });

  it('lower-cases and trims the key on the way in', async () => {
    const created = await request(app)
      .post(tasksUrl())
      .set('Authorization', auth(world.member))
      .send({ title: 'Case insensitive' });
    const task = created.body.data as Task;

    const response = await request(app)
      .get(`${tasksUrl()}/by-key/${task.key.toLowerCase()}`)
      .set('Authorization', auth(world.viewer));

    expect(response.status).toBe(200);
    expect((response.body.data as Task).id).toBe(task.id);
  });

  it('422s a malformed key and 404s a key whose prefix is another project', async () => {
    const bare = await request(app)
      .get(`${tasksUrl()}/by-key/12`)
      .set('Authorization', auth(world.viewer));
    expect(bare.status).toBe(422);

    const created = await request(app)
      .post(tasksUrl())
      .set('Authorization', auth(world.member))
      .send({ title: 'Prefix check' });
    const task = created.body.data as Task;

    // `:projectId` and the key's prefix are two independent statements about
    // which project this is. When they disagree the request is a stale link,
    // never a request for the other project's task of the same number.
    const wrongPrefix = await request(app)
      .get(`${tasksUrl()}/by-key/ZZZ-${String(task.number)}`)
      .set('Authorization', auth(world.viewer));
    expect(wrongPrefix.status).toBe(404);
  });

  it('404s on an unknown task and 422s on a malformed id', async () => {
    const missing = await request(app)
      .get('/api/tasks/11111111-1111-4111-8111-111111111111')
      .set('Authorization', auth(world.viewer));
    expect(missing.status).toBe(404);

    const malformed = await request(app)
      .get('/api/tasks/not-a-uuid')
      .set('Authorization', auth(world.viewer));
    expect(malformed.status).toBe(422);
  });
});

describe('DELETE /api/tasks/:taskId', () => {
  it('soft-deletes the task and cascades to its subtasks', async () => {
    const parentId = await seedTask(world, { title: 'Parent' });
    const childId = await seedTask(world, {
      title: 'Child',
      type: 'subtask',
      parentId,
    });
    const untouchedId = await seedTask(world, { title: 'Elsewhere' });
    const events = captureDomainEvent('task.deleted');

    const response = await request(app)
      .delete(`/api/tasks/${parentId}`)
      .set('Authorization', auth(world.member));
    expect(response.status).toBe(204);
    await flushAsync();

    const rows = await db.select({ id: tasks.id, deletedAt: tasks.deletedAt }).from(tasks);
    const deleted = new Set(rows.filter((row) => row.deletedAt !== null).map((row) => row.id));
    expect(deleted).toEqual(new Set([parentId, childId]));
    expect(deleted.has(untouchedId)).toBe(false);

    const actions = await db
      .select({ action: activity.action, taskId: activity.taskId })
      .from(activity)
      .where(eq(activity.action, 'task.deleted'));
    expect(actions).toHaveLength(2);
    expect(events.map((event) => event.taskId).sort()).toEqual([parentId, childId].sort());

    const board = await request(app)
      .get(tasksUrl())
      .query({ view: 'board' })
      .set('Authorization', auth(world.viewer));
    expect((board.body.data as BoardResponse).columns[world.statuses.todo]).toHaveLength(1);
  });

  it('refuses a viewer', async () => {
    const taskId = await seedTask(world);
    const response = await request(app)
      .delete(`/api/tasks/${taskId}`)
      .set('Authorization', auth(world.viewer));
    expect(response.status).toBe(403);
  });
});

describe('watchers', () => {
  it('subscribes and unsubscribes the caller, recording activity once', async () => {
    const taskId = await seedTask(world);

    const added = await request(app)
      .put(`/api/tasks/${taskId}/watchers/me`)
      .set('Authorization', auth(world.viewer))
      .send({});
    expect(added.status).toBe(200);
    expect(added.body.data).toMatchObject({ watching: true, isMuted: false });

    // Idempotent: a second PUT is a preference change, not a new subscription.
    await request(app)
      .put(`/api/tasks/${taskId}/watchers/me`)
      .set('Authorization', auth(world.viewer))
      .send({ isMuted: true });

    const watching = await db
      .select({ userId: taskWatchers.userId, isMuted: taskWatchers.isMuted })
      .from(taskWatchers)
      .where(and(eq(taskWatchers.taskId, taskId), eq(taskWatchers.userId, world.viewer.id)));
    expect(watching).toEqual([{ userId: world.viewer.id, isMuted: true }]);

    const addedRows = await db
      .select({ action: activity.action })
      .from(activity)
      .where(eq(activity.action, 'watcher.added'));
    expect(addedRows).toHaveLength(1);

    const removed = await request(app)
      .delete(`/api/tasks/${taskId}/watchers/me`)
      .set('Authorization', auth(world.viewer));
    expect(removed.status).toBe(200);
    expect(removed.body.data).toMatchObject({ watching: false });

    const removedRows = await db
      .select({ action: activity.action })
      .from(activity)
      .where(eq(activity.action, 'watcher.removed'));
    expect(removedRows).toHaveLength(1);
  });
});
