/**
 * Workflow-editor integration suite —
 * `/api/projects/:projectId/{statuses,transitions}`.
 *
 * Beyond the role matrix (every mutation is `admin`, every read is `viewer`),
 * three behaviours get their own assertions because they are the ones that can
 * silently destroy work:
 *
 *  - deleting a column that still holds tasks must refuse without `moveTasksTo`,
 *    and must relocate them — with fresh tail ranks — when it is given;
 *  - the order PUT must reject a set that is not exactly the project's columns,
 *    so a stale drag cannot drop a concurrently-added column;
 *  - the transition PUT must reject ids from another project and must not let a
 *    self-loop through.
 *
 * Every mutation is also expected to publish exactly one `workflow.changed`
 * domain event — the seam Wave 4's realtime layer subscribes to.
 */
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';

import { activity, closeDb, db, statuses, tasks, workflowTransitions } from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import { clearDomainEventHandlers, onDomainEvent } from '../../utils/domain-events';
import type { DomainEventMap } from '../../utils/domain-events';
import { bearer, createProject, createProjectWorld, createTask, createTestApp } from './fixtures';

const app = createTestApp();

beforeAll(async () => {
  await ensureTestDb();
});

beforeEach(async () => {
  await truncateAllTables();
});

afterEach(() => {
  clearDomainEventHandlers();
});

afterAll(async () => {
  await closeDb();
});

/** Collect `workflow.changed` payloads published while the callback runs. */
function captureWorkflowEvents(): DomainEventMap['workflow.changed'][] {
  const seen: DomainEventMap['workflow.changed'][] = [];
  onDomainEvent('workflow.changed', (payload) => {
    seen.push(payload);
  });
  return seen;
}

describe('GET /api/projects/:projectId/statuses', () => {
  it('returns the board columns in position order to a viewer', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .get(`/api/projects/${world.project.id}/statuses`)
      .set('Authorization', bearer(world.projectViewer));

    expect(res.status).toBe(200);
    expect(res.body.data.map((s: { name: string }) => s.name)).toEqual([
      'To Do',
      'In Progress',
      'Done',
    ]);
  });

  it('403s an org member with no project role', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .get(`/api/projects/${world.project.id}/statuses`)
      .set('Authorization', bearer(world.orgMember));

    expect(res.status).toBe(403);
  });
});

describe('POST /api/projects/:projectId/statuses', () => {
  it('403s a project member', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .post(`/api/projects/${world.project.id}/statuses`)
      .set('Authorization', bearer(world.projectMember))
      .send({ name: 'In Review', category: 'in_progress', color: '#ff8800' });

    expect(res.status).toBe(403);
  });

  it('appends at max(position) + 1 for a project admin', async () => {
    const world = await createProjectWorld();
    const events = captureWorkflowEvents();

    const res = await request(app)
      .post(`/api/projects/${world.project.id}/statuses`)
      .set('Authorization', bearer(world.projectAdmin))
      .set('X-Socket-Id', 'socket-abc')
      .send({ name: 'In Review', category: 'in_progress', color: '#ff8800', wipLimit: 3 });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'In Review',
      category: 'in_progress',
      color: '#ff8800',
      position: 3,
      wipLimit: 3,
    });

    expect(events).toEqual([
      {
        projectId: world.project.id,
        actorId: world.projectAdmin.id,
        // The test app does not mount socketIdMiddleware, so the header is not
        // read: what matters is that the field is present and explicitly null.
        originSocketId: null,
        change: 'statuses',
      },
    ]);

    const audit = await db.select().from(activity).where(eq(activity.projectId, world.project.id));
    expect(audit).toEqual([
      expect.objectContaining({ action: 'workflow.changed', field: 'status' }),
    ]);
  });

  it('409s a duplicate status name inside the project', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .post(`/api/projects/${world.project.id}/statuses`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ name: 'Done', category: 'done', color: '#22c55e' });

    expect(res.status).toBe(409);
  });

  it('422s a WIP limit of zero, which is not how you say unlimited', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .post(`/api/projects/${world.project.id}/statuses`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ name: 'Blocked', category: 'todo', color: '#ff0000', wipLimit: 0 });

    expect(res.status).toBe(422);
  });
});

describe('PATCH /api/projects/:projectId/statuses/:statusId', () => {
  it('403s a project member', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .patch(`/api/projects/${world.project.id}/statuses/${world.project.statusIds[0]}`)
      .set('Authorization', bearer(world.projectMember))
      .send({ name: 'Backlog' });

    expect(res.status).toBe(403);
  });

  it('renames and re-limits for a project admin', async () => {
    const world = await createProjectWorld();
    const events = captureWorkflowEvents();

    const res = await request(app)
      .patch(`/api/projects/${world.project.id}/statuses/${world.project.statusIds[0]}`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ name: 'Backlog', wipLimit: 5 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Backlog', wipLimit: 5, position: 0 });
    expect(events).toHaveLength(1);
  });

  it('404s a status that belongs to another project', async () => {
    const world = await createProjectWorld();
    const other = await createProject(world.org.id);

    const res = await request(app)
      .patch(`/api/projects/${world.project.id}/statuses/${other.statusIds[0]}`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ name: 'Nope' });

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/projects/:projectId/statuses/order', () => {
  it('403s a project member', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .put(`/api/projects/${world.project.id}/statuses/order`)
      .set('Authorization', bearer(world.projectMember))
      .send({ statusIds: [...world.project.statusIds].reverse() });

    expect(res.status).toBe(403);
  });

  it('rewrites every position for a project admin', async () => {
    const world = await createProjectWorld();
    const [todo, inProgress, done] = world.project.statusIds;

    const res = await request(app)
      .put(`/api/projects/${world.project.id}/statuses/order`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ statusIds: [done, todo, inProgress] });

    expect(res.status).toBe(200);
    expect(res.body.data.map((s: { id: string }) => s.id)).toEqual([done, todo, inProgress]);
    expect(res.body.data.map((s: { position: number }) => s.position)).toEqual([0, 1, 2]);

    const rows = await db
      .select({ id: statuses.id })
      .from(statuses)
      .where(eq(statuses.projectId, world.project.id))
      .orderBy(asc(statuses.position));
    expect(rows.map((r) => r.id)).toEqual([done, todo, inProgress]);
  });

  it('422s a list that omits a column (the stale-drag case)', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .put(`/api/projects/${world.project.id}/statuses/order`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ statusIds: [world.project.statusIds[0], world.project.statusIds[1]] });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('422s a list carrying a status from another project', async () => {
    const world = await createProjectWorld();
    const other = await createProject(world.org.id);

    const res = await request(app)
      .put(`/api/projects/${world.project.id}/statuses/order`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({
        statusIds: [world.project.statusIds[0], world.project.statusIds[1], other.statusIds[0]],
      });

    expect(res.status).toBe(422);
  });

  it('422s a duplicated id', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .put(`/api/projects/${world.project.id}/statuses/order`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({
        statusIds: [
          world.project.statusIds[0],
          world.project.statusIds[0],
          world.project.statusIds[1],
        ],
      });

    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/projects/:projectId/statuses/:statusId', () => {
  it('403s a project member', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .delete(`/api/projects/${world.project.id}/statuses/${world.project.statusIds[1]}`)
      .set('Authorization', bearer(world.projectMember));

    expect(res.status).toBe(403);
  });

  it('deletes an empty column for a project admin', async () => {
    const world = await createProjectWorld();
    const events = captureWorkflowEvents();

    const res = await request(app)
      .delete(`/api/projects/${world.project.id}/statuses/${world.project.statusIds[1]}`)
      .set('Authorization', bearer(world.projectAdmin));

    expect(res.status).toBe(204);
    expect(events).toHaveLength(1);

    const rows = await db.select().from(statuses).where(eq(statuses.projectId, world.project.id));
    expect(rows).toHaveLength(2);
  });

  it('409s when the column still holds tasks and no target was named', async () => {
    const world = await createProjectWorld();
    await createTask(world.project.id, world.project.statusIds[0]);
    await createTask(world.project.id, world.project.statusIds[0]);

    const res = await request(app)
      .delete(`/api/projects/${world.project.id}/statuses/${world.project.statusIds[0]}`)
      .set('Authorization', bearer(world.projectAdmin));

    expect(res.status).toBe(409);
    expect(res.body.error.details).toMatchObject({ taskCount: 2 });

    const rows = await db.select().from(statuses).where(eq(statuses.projectId, world.project.id));
    expect(rows).toHaveLength(3);
  });

  it('moves the tasks to the named column, appending fresh tail ranks', async () => {
    const world = await createProjectWorld();
    const [todo, inProgress] = world.project.statusIds;
    const sitting = await createTask(world.project.id, inProgress, { boardRank: 'a0' });
    const first = await createTask(world.project.id, todo, { boardRank: 'a1' });
    const second = await createTask(world.project.id, todo, { boardRank: 'a2' });

    const res = await request(app)
      .delete(`/api/projects/${world.project.id}/statuses/${todo}`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ moveTasksTo: inProgress });

    expect(res.status).toBe(204);

    const rows = await db
      .select({ id: tasks.id, statusId: tasks.statusId, boardRank: tasks.boardRank })
      .from(tasks)
      .where(eq(tasks.projectId, world.project.id))
      .orderBy(asc(tasks.boardRank));

    expect(rows.every((row) => row.statusId === inProgress)).toBe(true);
    // The card that was already there keeps its place; the moved pair lands
    // after it, in the order it had in the retired column.
    expect(rows.map((row) => row.id)).toEqual([sitting.id, first.id, second.id]);

    const remaining = await db
      .select()
      .from(statuses)
      .where(eq(statuses.projectId, world.project.id));
    expect(remaining).toHaveLength(2);
  });

  it('stamps resolved_at when the destination column is a done column', async () => {
    const world = await createProjectWorld();
    const [todo, , done] = world.project.statusIds;
    const task = await createTask(world.project.id, todo);

    const res = await request(app)
      .delete(`/api/projects/${world.project.id}/statuses/${todo}`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ moveTasksTo: done });

    expect(res.status).toBe(204);
    const [row] = await db
      .select({ resolvedAt: tasks.resolvedAt })
      .from(tasks)
      .where(eq(tasks.id, task.id));
    expect(row?.resolvedAt).toBeInstanceOf(Date);
  });

  it('400s when moveTasksTo names the column being deleted', async () => {
    const world = await createProjectWorld();
    await createTask(world.project.id, world.project.statusIds[0]);

    const res = await request(app)
      .delete(`/api/projects/${world.project.id}/statuses/${world.project.statusIds[0]}`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ moveTasksTo: world.project.statusIds[0] });

    expect(res.status).toBe(400);
  });

  it('400s when moveTasksTo names a status from another project', async () => {
    const world = await createProjectWorld();
    const other = await createProject(world.org.id);
    await createTask(world.project.id, world.project.statusIds[0]);

    const res = await request(app)
      .delete(`/api/projects/${world.project.id}/statuses/${world.project.statusIds[0]}`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ moveTasksTo: other.statusIds[0] });

    expect(res.status).toBe(400);
  });

  it('409s on the last remaining column', async () => {
    const world = await createProjectWorld();
    const [todo, inProgress, done] = world.project.statusIds;
    const admin = bearer(world.projectAdmin);
    await request(app)
      .delete(`/api/projects/${world.project.id}/statuses/${inProgress}`)
      .set('Authorization', admin);
    await request(app)
      .delete(`/api/projects/${world.project.id}/statuses/${done}`)
      .set('Authorization', admin);

    const res = await request(app)
      .delete(`/api/projects/${world.project.id}/statuses/${todo}`)
      .set('Authorization', admin);

    expect(res.status).toBe(409);
  });
});

describe('GET /api/projects/:projectId/transitions', () => {
  it('is empty on a fresh project, which means every move is allowed', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .get(`/api/projects/${world.project.id}/transitions`)
      .set('Authorization', bearer(world.projectViewer));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('403s an org member with no project role', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .get(`/api/projects/${world.project.id}/transitions`)
      .set('Authorization', bearer(world.orgMember));

    expect(res.status).toBe(403);
  });
});

describe('PUT /api/projects/:projectId/transitions', () => {
  it('403s a project member', async () => {
    const world = await createProjectWorld();
    const [todo, inProgress] = world.project.statusIds;

    const res = await request(app)
      .put(`/api/projects/${world.project.id}/transitions`)
      .set('Authorization', bearer(world.projectMember))
      .send({ transitions: [{ fromStatusId: todo, toStatusId: inProgress }] });

    expect(res.status).toBe(403);
  });

  it('replaces the whole set for a project admin', async () => {
    const world = await createProjectWorld();
    const [todo, inProgress, done] = world.project.statusIds;
    const events = captureWorkflowEvents();

    const first = await request(app)
      .put(`/api/projects/${world.project.id}/transitions`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ transitions: [{ fromStatusId: todo, toStatusId: inProgress }] });
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(1);

    const second = await request(app)
      .put(`/api/projects/${world.project.id}/transitions`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ transitions: [{ fromStatusId: inProgress, toStatusId: done }] });

    expect(second.status).toBe(200);
    expect(second.body.data).toEqual([
      expect.objectContaining({
        projectId: world.project.id,
        fromStatusId: inProgress,
        toStatusId: done,
      }),
    ]);
    expect(events).toHaveLength(2);
    expect(events[0]?.change).toBe('transitions');
  });

  it('clears every restriction on an empty array', async () => {
    const world = await createProjectWorld();
    const [todo, inProgress] = world.project.statusIds;
    await request(app)
      .put(`/api/projects/${world.project.id}/transitions`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ transitions: [{ fromStatusId: todo, toStatusId: inProgress }] });

    const res = await request(app)
      .put(`/api/projects/${world.project.id}/transitions`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ transitions: [] });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    const rows = await db
      .select()
      .from(workflowTransitions)
      .where(eq(workflowTransitions.projectId, world.project.id));
    expect(rows).toEqual([]);
  });

  it('422s a self-loop', async () => {
    const world = await createProjectWorld();
    const [todo] = world.project.statusIds;

    const res = await request(app)
      .put(`/api/projects/${world.project.id}/transitions`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ transitions: [{ fromStatusId: todo, toStatusId: todo }] });

    expect(res.status).toBe(422);
  });

  it('400s an edge that references another project', async () => {
    const world = await createProjectWorld();
    const other = await createProject(world.org.id);
    const [todo] = world.project.statusIds;

    const res = await request(app)
      .put(`/api/projects/${world.project.id}/transitions`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ transitions: [{ fromStatusId: todo, toStatusId: other.statusIds[0] }] });

    expect(res.status).toBe(400);
    expect(res.body.error.details.statusIds).toEqual([other.statusIds[0]]);
  });

  it('collapses a duplicated edge instead of tripping the unique index', async () => {
    const world = await createProjectWorld();
    const [todo, inProgress] = world.project.statusIds;

    const res = await request(app)
      .put(`/api/projects/${world.project.id}/transitions`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({
        transitions: [
          { fromStatusId: todo, toStatusId: inProgress },
          { fromStatusId: todo, toStatusId: inProgress },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});
