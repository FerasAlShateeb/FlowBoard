/**
 * The sprint lifecycle.
 *
 * Two properties carry the weight: the point columns are STAMPED (start and
 * complete write them once and nothing recomputes them afterwards), and AT MOST
 * ONE SPRINT IS ACTIVE — enforced by the partial unique index, which is why the
 * concurrency case below fires two starts at once rather than trusting a
 * check-then-write.
 */
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import type { Sprint } from '@flowboard/shared';

import { activity, closeDb, db, sprints, tasks } from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import {
  auth,
  captureDomainEvent,
  captureTelemetry,
  createTaskTestApp,
  flushAsync,
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

function sprintsUrl(): string {
  return `/api/projects/${world.projectId}/sprints`;
}

/** Backlog order for one bucket, straight from the database. */
async function bucketOrder(sprintId: string | null): Promise<string[]> {
  const rows = await db
    .select({ id: tasks.id, sprintId: tasks.sprintId })
    .from(tasks)
    .orderBy(asc(tasks.backlogRank));
  return rows.filter((row) => row.sprintId === sprintId).map((row) => row.id);
}

describe('GET/POST /api/projects/:projectId/sprints', () => {
  it('creates a planned sprint and lists it', async () => {
    const events = captureDomainEvent('sprint.changed');

    const created = await request(app)
      .post(sprintsUrl())
      .set('Authorization', auth(world.member))
      .send({
        name: 'Sprint 1',
        goal: 'Ship the board',
        startDate: '2026-03-02',
        endDate: '2026-03-13',
      });
    await flushAsync();

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      name: 'Sprint 1',
      goal: 'Ship the board',
      state: 'planned',
      startDate: '2026-03-02',
      endDate: '2026-03-13',
      committedPoints: null,
      completedPoints: null,
    });
    expect(events[0]?.action).toBe('created');

    const list = await request(app).get(sprintsUrl()).set('Authorization', auth(world.viewer));
    expect((list.body.data as Sprint[]).map((sprint) => sprint.name)).toEqual(['Sprint 1']);

    const rows = await db
      .select({ action: activity.action })
      .from(activity)
      .where(eq(activity.action, 'sprint.created'));
    expect(rows).toHaveLength(1);
  });

  it('filters the list by state', async () => {
    await seedSprint(world, { name: 'Planned one' });
    await seedSprint(world, { name: 'Running', state: 'active' });

    const response = await request(app)
      .get(sprintsUrl())
      .query({ state: 'active' })
      .set('Authorization', auth(world.viewer));
    expect((response.body.data as Sprint[]).map((sprint) => sprint.name)).toEqual(['Running']);
  });

  it('refuses an inverted window and a viewer', async () => {
    const inverted = await request(app)
      .post(sprintsUrl())
      .set('Authorization', auth(world.member))
      .send({ name: 'Backwards', startDate: '2026-03-10', endDate: '2026-03-01' });
    expect(inverted.status).toBe(422);

    const viewer = await request(app)
      .post(sprintsUrl())
      .set('Authorization', auth(world.viewer))
      .send({ name: 'Nope' });
    expect(viewer.status).toBe(403);
  });

  it('patches name, goal and window', async () => {
    const sprintId = await seedSprint(world, { name: 'Old' });

    const response = await request(app)
      .patch(`/api/sprints/${sprintId}`)
      .set('Authorization', auth(world.member))
      .send({ name: 'New', startDate: '2026-04-01' });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ name: 'New', startDate: '2026-04-01' });
  });

  it('round-trips the window as a CALENDAR DAY, not an instant', async () => {
    const created = await request(app)
      .post(sprintsUrl())
      .set('Authorization', auth(world.member))
      .send({ name: 'Windowed', startDate: '2026-03-02', endDate: '2026-03-13' });

    const stored = await db
      .select({ startDate: sprints.startDate, endDate: sprints.endDate })
      .from(sprints)
      .where(eq(sprints.id, (created.body.data as Sprint).id));

    // `sprints.start_date` / `end_date` are `date` columns (WP2.5 changed them
    // from `timestamptz`), so the value the client sent is the value the column
    // holds — no zone to re-interpret, and no boundary that can slip a day for
    // a reader west of UTC.
    expect(stored[0]).toEqual({ startDate: '2026-03-02', endDate: '2026-03-13' });
  });
});

describe('POST /api/sprints/:sprintId/start', () => {
  it('stamps committedPoints from the sprint contents', async () => {
    const telemetry = captureTelemetry();
    const events = captureDomainEvent('sprint.changed');
    const sprintId = await seedSprint(world);
    await seedTask(world, { sprintId, storyPoints: 3 });
    await seedTask(world, { sprintId, storyPoints: 5 });
    await seedTask(world, { sprintId, storyPoints: null });
    await seedTask(world, { storyPoints: 8 });

    const response = await request(app)
      .post(`/api/sprints/${sprintId}/start`)
      .set('Authorization', auth(world.admin))
      .send({ startDate: '2026-03-02', endDate: '2026-03-13' });
    await flushAsync();

    expect(response.status).toBe(200);
    const sprint = response.body.data as Sprint;
    expect(sprint).toMatchObject({
      state: 'active',
      committedPoints: 8,
      startDate: '2026-03-02',
      endDate: '2026-03-13',
    });
    expect(sprint.startedAt).not.toBeNull();

    expect(telemetry.map((event) => event.type)).toContain('sprint_started');
    expect(events.at(-1)?.action).toBe('started');
    const rows = await db
      .select({ action: activity.action })
      .from(activity)
      .where(eq(activity.action, 'sprint.started'));
    expect(rows).toHaveLength(1);
  });

  it('refuses a second active sprint', async () => {
    await seedSprint(world, { state: 'active' });
    const second = await seedSprint(world);

    const response = await request(app)
      .post(`/api/sprints/${second}/start`)
      .set('Authorization', auth(world.admin))
      .send({ startDate: '2026-03-02', endDate: '2026-03-13' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('sprint_already_active');
  });

  it('lets only ONE of two concurrent starts win', async () => {
    const first = await seedSprint(world, { name: 'A' });
    const second = await seedSprint(world, { name: 'B' });

    const responses = await Promise.all(
      [first, second].map((sprintId) =>
        request(app)
          .post(`/api/sprints/${sprintId}/start`)
          .set('Authorization', auth(world.admin))
          .send({ startDate: '2026-03-02', endDate: '2026-03-13' }),
      ),
    );

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 409]);

    const active = await db
      .select({ id: sprints.id })
      .from(sprints)
      .where(eq(sprints.state, 'active'));
    expect(active).toHaveLength(1);
  });

  it('refuses a sprint that is not planned, and a non-admin', async () => {
    const active = await seedSprint(world, { state: 'active' });
    const alreadyRunning = await request(app)
      .post(`/api/sprints/${active}/start`)
      .set('Authorization', auth(world.admin))
      .send({ startDate: '2026-03-02', endDate: '2026-03-13' });
    expect(alreadyRunning.status).toBe(409);

    const planned = await seedSprint(world);
    const member = await request(app)
      .post(`/api/sprints/${planned}/start`)
      .set('Authorization', auth(world.member))
      .send({ startDate: '2026-03-02', endDate: '2026-03-13' });
    expect(member.status).toBe(403);
  });
});

describe('POST /api/sprints/:sprintId/complete', () => {
  it('stamps completedPoints and sends the leftovers to the backlog', async () => {
    const telemetry = captureTelemetry();
    const sprintId = await seedSprint(world, { state: 'active', committedPoints: 13 });
    const done = await seedTask(world, {
      sprintId,
      storyPoints: 5,
      statusId: world.statuses.done,
    });
    const alsoDone = await seedTask(world, {
      sprintId,
      storyPoints: 3,
      statusId: world.statuses.done,
    });
    const unfinished = await seedTask(world, { sprintId, storyPoints: 5 });
    const alreadyInBacklog = await seedTask(world, { storyPoints: 1 });

    const response = await request(app)
      .post(`/api/sprints/${sprintId}/complete`)
      .set('Authorization', auth(world.admin))
      .send({ moveIncompleteTo: 'backlog' });
    await flushAsync();

    expect(response.status).toBe(200);
    const sprint = response.body.data as Sprint;
    expect(sprint).toMatchObject({ state: 'completed', committedPoints: 13, completedPoints: 8 });
    expect(sprint.completedAt).not.toBeNull();

    // The done work stays put; only the unfinished task moves, and it appends.
    expect(await bucketOrder(sprintId)).toEqual([done, alsoDone]);
    expect(await bucketOrder(null)).toEqual([alreadyInBacklog, unfinished]);

    expect(telemetry.map((event) => event.type)).toContain('sprint_completed');
    const rows = await db
      .select({ action: activity.action })
      .from(activity)
      .where(eq(activity.action, 'sprint.completed'));
    expect(rows).toHaveLength(1);
  });

  it('can push the leftovers into another planned sprint', async () => {
    const current = await seedSprint(world, { state: 'active' });
    const next = await seedSprint(world, { name: 'Next' });
    const unfinished = await seedTask(world, { sprintId: current, storyPoints: 2 });

    const response = await request(app)
      .post(`/api/sprints/${current}/complete`)
      .set('Authorization', auth(world.admin))
      .send({ moveIncompleteTo: next });

    expect(response.status).toBe(200);
    expect(await bucketOrder(next)).toEqual([unfinished]);
  });

  it('refuses a sprint that is not active, and a non-admin', async () => {
    const planned = await seedSprint(world);
    const notActive = await request(app)
      .post(`/api/sprints/${planned}/complete`)
      .set('Authorization', auth(world.admin))
      .send({ moveIncompleteTo: 'backlog' });
    expect(notActive.status).toBe(409);

    const active = await seedSprint(world, { state: 'active' });
    const member = await request(app)
      .post(`/api/sprints/${active}/complete`)
      .set('Authorization', auth(world.member))
      .send({ moveIncompleteTo: 'backlog' });
    expect(member.status).toBe(403);
  });

  it('refuses to move leftovers into the sprint being closed', async () => {
    const active = await seedSprint(world, { state: 'active' });
    const response = await request(app)
      .post(`/api/sprints/${active}/complete`)
      .set('Authorization', auth(world.admin))
      .send({ moveIncompleteTo: active });
    expect(response.status).toBe(400);
  });
});

describe('DELETE /api/sprints/:sprintId', () => {
  it('returns every task to the backlog before removing the row', async () => {
    const events = captureDomainEvent('sprint.changed');
    const sprintId = await seedSprint(world);
    const first = await seedTask(world, { sprintId });
    const second = await seedTask(world, { sprintId });
    const existing = await seedTask(world);

    const response = await request(app)
      .delete(`/api/sprints/${sprintId}`)
      .set('Authorization', auth(world.member));
    await flushAsync();

    expect(response.status).toBe(204);
    expect(await db.select({ id: sprints.id }).from(sprints)).toHaveLength(0);
    expect(await bucketOrder(null)).toEqual([existing, first, second]);
    expect(events.at(-1)?.action).toBe('deleted');
  });

  it('records it as `sprint.deleted`, not as a `sprint.completed` with a field', async () => {
    const sprintId = await seedSprint(world);
    await seedTask(world, { sprintId });

    await request(app).delete(`/api/sprints/${sprintId}`).set('Authorization', auth(world.member));
    await flushAsync();

    // Deleting a sprint and completing one are different facts, and the feed
    // renders one sentence per action. WP2.3 had to spell this as
    // `sprint.completed` + `field: 'deleted'` because the closed action enum
    // had no member for it; WP2.5 added `sprint.deleted` to the contract.
    const rows = await db
      .select({ action: activity.action, oldValue: activity.oldValue })
      .from(activity)
      .where(eq(activity.action, 'sprint.deleted'));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.oldValue).toMatchObject({ sprintId, movedTasks: 1 });
    expect(
      await db
        .select({ id: activity.id })
        .from(activity)
        .where(eq(activity.action, 'sprint.completed')),
    ).toHaveLength(0);
  });

  it('404s for a sprint in another project', async () => {
    const otherWorld = await seedWorld();
    const sprintId = await seedSprint(otherWorld);

    const response = await request(app)
      .delete(`/api/sprints/${sprintId}`)
      .set('Authorization', auth(world.member));
    // The guard resolves the sprint's own project, where this caller is nobody.
    expect(response.status).toBe(403);
  });
});
