/**
 * `/api/projects/:projectId/activity` integration suite.
 *
 * The feed is read-only, so there is no role matrix beyond viewer-vs-stranger;
 * what needs proving is the pagination contract — the `meta` block every list
 * endpoint returns, and the `beforeId` keyset that an infinite-scroll feed needs
 * because an append-only stream shifts under an offset.
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { activity, closeDb, db } from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import { bearer, createProjectWorld, createTestApp, type ProjectWorld } from './fixtures';

const app = createTestApp();

beforeAll(async () => {
  await ensureTestDb();
});

beforeEach(async () => {
  await truncateAllTables();
});

afterAll(async () => {
  await closeDb();
});

/** Write `count` audit rows straight to the stream, oldest first. */
async function seedActivity(world: ProjectWorld, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await db.insert(activity).values({
      projectId: world.project.id,
      actorId: world.projectAdmin.id,
      action: 'project.updated',
      field: `field-${index}`,
    });
  }
}

describe('GET /api/projects/:projectId/activity', () => {
  it('403s an org member with no project role', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .get(`/api/projects/${world.project.id}/activity`)
      .set('Authorization', bearer(world.orgMember));

    expect(res.status).toBe(403);
  });

  it('returns newest first with the joined actor summary', async () => {
    const world = await createProjectWorld();
    await seedActivity(world, 3);

    const res = await request(app)
      .get(`/api/projects/${world.project.id}/activity`)
      .set('Authorization', bearer(world.projectViewer));

    expect(res.status).toBe(200);
    expect(res.body.data.map((row: { field: string }) => row.field)).toEqual([
      'field-2',
      'field-1',
      'field-0',
    ]);
    expect(res.body.data[0]).toMatchObject({
      projectId: world.project.id,
      taskId: null,
      action: 'project.updated',
      actor: { id: world.projectAdmin.id, name: 'Project Admin', avatarUrl: null },
    });
    // bigserial ids cross the wire as strings.
    expect(res.body.data[0].id).toBeTypeOf('string');
  });

  it('carries a null actor for system-generated rows', async () => {
    const world = await createProjectWorld();
    await db.insert(activity).values({
      projectId: world.project.id,
      actorId: null,
      action: 'sprint.completed',
    });

    const res = await request(app)
      .get(`/api/projects/${world.project.id}/activity`)
      .set('Authorization', bearer(world.projectViewer));

    expect(res.status).toBe(200);
    expect(res.body.data[0].actor).toBeNull();
  });

  it('reports the pagination meta and honours ?page&pageSize', async () => {
    const world = await createProjectWorld();
    await seedActivity(world, 7);

    const first = await request(app)
      .get(`/api/projects/${world.project.id}/activity?page=1&pageSize=3`)
      .set('Authorization', bearer(world.projectViewer));

    expect(first.status).toBe(200);
    expect(first.body.meta).toEqual({ page: 1, pageSize: 3, total: 7, totalPages: 3 });
    expect(first.body.data.map((r: { field: string }) => r.field)).toEqual([
      'field-6',
      'field-5',
      'field-4',
    ]);

    const third = await request(app)
      .get(`/api/projects/${world.project.id}/activity?page=3&pageSize=3`)
      .set('Authorization', bearer(world.projectViewer));

    expect(third.body.data.map((r: { field: string }) => r.field)).toEqual(['field-0']);
    expect(third.body.meta).toEqual({ page: 3, pageSize: 3, total: 7, totalPages: 3 });
  });

  it('defaults to page 1 of 25', async () => {
    const world = await createProjectWorld();
    await seedActivity(world, 2);

    const res = await request(app)
      .get(`/api/projects/${world.project.id}/activity`)
      .set('Authorization', bearer(world.projectViewer));

    expect(res.body.meta).toEqual({ page: 1, pageSize: 25, total: 2, totalPages: 1 });
  });

  it('keysets on ?beforeId without repeating a row', async () => {
    const world = await createProjectWorld();
    await seedActivity(world, 5);

    const head = await request(app)
      .get(`/api/projects/${world.project.id}/activity?pageSize=2`)
      .set('Authorization', bearer(world.projectViewer));
    const cursor = head.body.data[1].id as string;

    const next = await request(app)
      .get(`/api/projects/${world.project.id}/activity?pageSize=2&beforeId=${cursor}`)
      .set('Authorization', bearer(world.projectViewer));

    expect(next.status).toBe(200);
    expect(next.body.data.map((r: { field: string }) => r.field)).toEqual(['field-2', 'field-1']);
    const seen = new Set<string>([
      ...head.body.data.map((r: { id: string }) => r.id),
      ...next.body.data.map((r: { id: string }) => r.id),
    ]);
    expect(seen.size).toBe(4);
  });

  it('filters on ?action', async () => {
    const world = await createProjectWorld();
    await seedActivity(world, 2);
    await db.insert(activity).values({
      projectId: world.project.id,
      actorId: world.projectAdmin.id,
      action: 'workflow.changed',
    });

    const res = await request(app)
      .get(`/api/projects/${world.project.id}/activity?action=workflow.changed`)
      .set('Authorization', bearer(world.projectViewer));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  it('422s an unknown action', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .get(`/api/projects/${world.project.id}/activity?action=not.a.thing`)
      .set('Authorization', bearer(world.projectViewer));

    expect(res.status).toBe(422);
  });

  it('422s a pageSize above the hard ceiling', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .get(`/api/projects/${world.project.id}/activity?pageSize=500`)
      .set('Authorization', bearer(world.projectViewer));

    expect(res.status).toBe(422);
  });
});
