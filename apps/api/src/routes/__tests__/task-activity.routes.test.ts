/**
 * `/api/tasks/:taskId/activity` integration suite (WP3.2).
 *
 * The feed is read-only, so there is no write matrix to walk. What needs proving
 * is the four things that separate it from the project feed it shares a service
 * shape with:
 *
 *  1. **Scope** — it returns THIS task's rows and nothing else: not a sibling
 *     task's, and not the project-scoped rows whose `task_id` is null (which the
 *     project feed deliberately does include).
 *  2. **The guard resolves through `:taskId`** — an unknown id and a SOFT-DELETED
 *     task are both 404, because `requireProjectRole` joins `tasks → projects`
 *     with both delete filters applied. A task that was deleted must not answer
 *     with the history of something that is gone.
 *  3. **The role floor is `viewer`** — an org member with no project role is 403,
 *     and a project viewer is 200.
 *  4. **The pagination contract** — the `meta` block every list endpoint returns,
 *     plus the `beforeId` keyset an append-only stream needs.
 *
 * The app under test mounts ONLY this router (plus the 404 fallthrough and the
 * error-envelope formatter), so the suite fails for this work package's reasons
 * rather than a sibling router's.
 */
import request from 'supertest';
import express, { type Express } from 'express';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { activity, closeDb, db, tasks } from '../../db';
import { errorHandler, notFound } from '../../middlewares/error-handler';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import { taskActivityRouter } from '../task-activity.routes';
import {
  bearer,
  createProjectWorld,
  createTask,
  type ProjectWorld,
  type TestUser,
} from './fixtures';

function createActivityTestApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use('/api', taskActivityRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

const app = createActivityTestApp();

/** A uuid that is well-formed but names nothing — the 404 case, not the 422 one. */
const MISSING_TASK_ID = '00000000-0000-4000-8000-000000000000';

beforeAll(async () => {
  await ensureTestDb();
});

beforeEach(async () => {
  await truncateAllTables();
});

afterAll(async () => {
  await closeDb();
});

/** Write `count` audit rows for one task straight to the stream, oldest first. */
async function seedTaskActivity(world: ProjectWorld, taskId: string, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await db.insert(activity).values({
      projectId: world.project.id,
      taskId,
      actorId: world.projectAdmin.id,
      action: 'task.field_changed',
      field: `field-${String(index)}`,
    });
  }
}

function get(taskId: string, user: TestUser, query = '') {
  return request(app)
    .get(`/api/tasks/${taskId}/activity${query}`)
    .set('Authorization', bearer(user));
}

describe('GET /api/tasks/:taskId/activity', () => {
  it('401s an unauthenticated caller', async () => {
    const world = await createProjectWorld();
    const task = await createTask(world.project.id, world.project.statusIds[0]);

    const res = await request(app).get(`/api/tasks/${task.id}/activity`);

    expect(res.status).toBe(401);
  });

  it('404s a task id that names nothing', async () => {
    const world = await createProjectWorld();

    const res = await get(MISSING_TASK_ID, world.projectViewer);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'not_found' } });
  });

  it('404s a SOFT-DELETED task even though its rows are still in the stream', async () => {
    const world = await createProjectWorld();
    const task = await createTask(world.project.id, world.project.statusIds[0]);
    await seedTaskActivity(world, task.id, 2);
    await db.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, task.id));

    const res = await get(task.id, world.projectViewer);

    expect(res.status).toBe(404);
  });

  it('422s a malformed task id before the guard ever queries', async () => {
    const world = await createProjectWorld();

    const res = await get('not-a-uuid', world.projectViewer);

    expect(res.status).toBe(422);
  });

  it('403s an org member with no role on the project', async () => {
    const world = await createProjectWorld();
    const task = await createTask(world.project.id, world.project.statusIds[0]);

    const res = await get(task.id, world.orgMember);

    expect(res.status).toBe(403);
  });

  it('lets a project VIEWER read the history, newest first, with the actor joined', async () => {
    const world = await createProjectWorld();
    const task = await createTask(world.project.id, world.project.statusIds[0]);
    await seedTaskActivity(world, task.id, 3);

    const res = await get(task.id, world.projectViewer);

    expect(res.status).toBe(200);
    expect(res.body.data.map((row: { field: string }) => row.field)).toEqual([
      'field-2',
      'field-1',
      'field-0',
    ]);
    expect(res.body.data[0]).toMatchObject({
      projectId: world.project.id,
      taskId: task.id,
      action: 'task.field_changed',
      actor: { id: world.projectAdmin.id, name: 'Project Admin', avatarUrl: null },
    });
    // bigserial ids cross the wire as strings — see `bigIntId`.
    expect(res.body.data[0].id).toBeTypeOf('string');
  });

  it('returns ONLY this task: not a sibling task, not the project-scoped rows', async () => {
    const world = await createProjectWorld();
    const mine = await createTask(world.project.id, world.project.statusIds[0]);
    const sibling = await createTask(world.project.id, world.project.statusIds[0]);

    await seedTaskActivity(world, mine.id, 2);
    await seedTaskActivity(world, sibling.id, 3);
    // `task_id: null` — the shape the PROJECT feed shows and this one must not.
    await db.insert(activity).values({
      projectId: world.project.id,
      taskId: null,
      actorId: world.projectAdmin.id,
      action: 'workflow.changed',
    });

    const res = await get(mine.id, world.projectViewer);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(2);
    expect(res.body.data).toHaveLength(2);
    for (const row of res.body.data as { taskId: string }[]) {
      expect(row.taskId).toBe(mine.id);
    }
  });

  it('carries a null actor for system-generated rows', async () => {
    const world = await createProjectWorld();
    const task = await createTask(world.project.id, world.project.statusIds[0]);
    await db.insert(activity).values({
      projectId: world.project.id,
      taskId: task.id,
      actorId: null,
      action: 'task.moved_sprint',
    });

    const res = await get(task.id, world.projectViewer);

    expect(res.status).toBe(200);
    expect(res.body.data[0].actor).toBeNull();
  });

  it('defaults to page 1 of 25 and reports the meta block', async () => {
    const world = await createProjectWorld();
    const task = await createTask(world.project.id, world.project.statusIds[0]);
    await seedTaskActivity(world, task.id, 2);

    const res = await get(task.id, world.projectViewer);

    expect(res.body.meta).toEqual({ page: 1, pageSize: 25, total: 2, totalPages: 1 });
  });

  it('honours ?page&pageSize across the whole stream', async () => {
    const world = await createProjectWorld();
    const task = await createTask(world.project.id, world.project.statusIds[0]);
    await seedTaskActivity(world, task.id, 7);

    const first = await get(task.id, world.projectViewer, '?page=1&pageSize=3');
    expect(first.status).toBe(200);
    expect(first.body.meta).toEqual({ page: 1, pageSize: 3, total: 7, totalPages: 3 });
    expect(first.body.data.map((r: { field: string }) => r.field)).toEqual([
      'field-6',
      'field-5',
      'field-4',
    ]);

    const last = await get(task.id, world.projectViewer, '?page=3&pageSize=3');
    expect(last.body.data.map((r: { field: string }) => r.field)).toEqual(['field-0']);
    expect(last.body.meta).toEqual({ page: 3, pageSize: 3, total: 7, totalPages: 3 });
  });

  it('keysets on ?beforeId without repeating a row', async () => {
    const world = await createProjectWorld();
    const task = await createTask(world.project.id, world.project.statusIds[0]);
    await seedTaskActivity(world, task.id, 5);

    const head = await get(task.id, world.projectViewer, '?pageSize=2');
    const cursor = head.body.data[1].id as string;

    const next = await get(task.id, world.projectViewer, `?pageSize=2&beforeId=${cursor}`);

    expect(next.status).toBe(200);
    expect(next.body.data.map((r: { field: string }) => r.field)).toEqual(['field-2', 'field-1']);
  });

  it('422s a pageSize above the hard ceiling', async () => {
    const world = await createProjectWorld();
    const task = await createTask(world.project.id, world.project.statusIds[0]);

    const res = await get(task.id, world.projectViewer, '?pageSize=500');

    expect(res.status).toBe(422);
  });

  it('422s an action outside the closed audit enum', async () => {
    const world = await createProjectWorld();
    const task = await createTask(world.project.id, world.project.statusIds[0]);

    const res = await get(task.id, world.projectViewer, '?action=not.a.thing');

    expect(res.status).toBe(422);
  });
});
