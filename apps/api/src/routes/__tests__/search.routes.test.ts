/**
 * `GET /api/orgs/:orgId/search` — the command palette.
 *
 * Two things are asserted that a naive `ILIKE` implementation would get wrong:
 * a pasted KEY outranks every fuzzy title hit, and the result set is filtered by
 * project membership INSIDE the query — searching must not be the place where
 * "which projects exist" leaks.
 */
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { MAX_SEARCH_RESULTS, type SearchResponse } from '@flowboard/shared';

import { closeDb, db, orgMembers, projectMembers, projects } from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import {
  auth,
  captureTelemetry,
  createTaskTestApp,
  flushAsync,
  seedTask,
  seedUser,
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

function search(query: Record<string, unknown>, actor = world.member): request.Test {
  return request(app)
    .get(`/api/orgs/${world.orgId}/search`)
    .query(query)
    .set('Authorization', auth(actor));
}

describe('search matching and ranking', () => {
  it('puts an exact key hit ahead of a fuzzy title hit', async () => {
    const keyed = await seedTask(world, { title: 'Something unrelated' });
    await seedTask(world, { title: 'A task that mentions the key in words' });

    const [row] = await db
      .select({ key: projects.key })
      .from(projects)
      .where(eq(projects.id, world.projectId));
    const detail = await request(app)
      .get(`/api/tasks/${keyed}`)
      .set('Authorization', auth(world.member));
    const key = `${row?.key ?? ''}-${String(detail.body.data.number)}`;

    const response = await search({ q: key });
    expect(response.status).toBe(200);
    const results = (response.body.data as SearchResponse).results;
    expect(results[0]?.taskId).toBe(keyed);
    expect(results[0]?.key).toBe(key);
  });

  it('matches on title substrings', async () => {
    await seedTask(world, { title: 'Refactor the rank rebalancer' });
    await seedTask(world, { title: 'Write the changelog' });

    const response = await search({ q: 'rebalancer' });
    const results = (response.body.data as SearchResponse).results;
    expect(results.map((result) => result.title)).toEqual(['Refactor the rank rebalancer']);
  });

  it('matches a bare number as a key prefix', async () => {
    // Numbers 1..12, so the last one is two digits — the shared query schema
    // has a two-character floor, and a one-digit trigram scan is exactly what
    // that floor exists to refuse.
    let taskId = '';
    for (let index = 0; index < 12; index += 1) {
      taskId = await seedTask(world, { title: `Numbered ${String(index)}` });
    }
    const detail = await request(app)
      .get(`/api/tasks/${taskId}`)
      .set('Authorization', auth(world.member));
    const number = detail.body.data.number as number;
    expect(number).toBe(12);

    const response = await search({ q: String(number) });
    const results = (response.body.data as SearchResponse).results;
    expect(results.map((result) => result.taskId)).toContain(taskId);
  });

  it('carries the project identity every deep link needs', async () => {
    await seedTask(world, { title: 'Deep linkable' });
    const response = await search({ q: 'linkable' });
    expect((response.body.data as SearchResponse).results[0]).toMatchObject({
      projectId: world.projectId,
      projectKey: world.projectKey,
    });
  });

  it('omits soft-deleted tasks', async () => {
    await seedTask(world, { title: 'Vanished entirely', deletedAt: new Date() });
    const response = await search({ q: 'Vanished' });
    expect((response.body.data as SearchResponse).results).toEqual([]);
  });

  it('records search_performed telemetry', async () => {
    const telemetry = captureTelemetry();
    await seedTask(world, { title: 'Telemetered' });

    await search({ q: 'Telemetered' });
    await flushAsync();

    const event = telemetry.find((entry) => entry.type === 'search_performed');
    expect(event?.payload).toMatchObject({ query: 'Telemetered', resultCount: 1 });
  });
});

describe('search visibility', () => {
  it('hides projects the caller is not a member of', async () => {
    // A second project in the SAME org that `world.member` has no row for.
    const [hidden] = await db
      .insert(projects)
      .values({ orgId: world.orgId, key: 'HID', name: 'Hidden project' })
      .returning({ id: projects.id });
    const hiddenWorld: World = { ...world, projectId: hidden?.id ?? '' };
    await seedTask(hiddenWorld, { title: 'Secret roadmap item' });
    await seedTask(world, { title: 'Visible roadmap item' });

    const response = await search({ q: 'roadmap' });
    const titles = (response.body.data as SearchResponse).results.map((result) => result.title);
    expect(titles).toEqual(['Visible roadmap item']);
  });

  it('shows every project in the org to an org admin', async () => {
    const [hidden] = await db
      .insert(projects)
      .values({ orgId: world.orgId, key: 'HID2', name: 'Other project' })
      .returning({ id: projects.id });
    const hiddenWorld: World = { ...world, projectId: hidden?.id ?? '' };
    await seedTask(hiddenWorld, { title: 'Secret roadmap item' });
    await seedTask(world, { title: 'Visible roadmap item' });

    await db
      .update(orgMembers)
      .set({ role: 'admin' })
      .where(and(eq(orgMembers.orgId, world.orgId), eq(orgMembers.userId, world.admin.id)));

    const response = await search({ q: 'roadmap' }, world.admin);
    expect((response.body.data as SearchResponse).results).toHaveLength(2);
  });

  it('shows every project in the org to a global admin', async () => {
    const globalAdmin = await seedUser({ name: 'Global', isGlobalAdmin: true });
    await seedTask(world, { title: 'Visible roadmap item' });

    const response = await search({ q: 'roadmap' }, globalAdmin);
    expect(response.status).toBe(200);
    expect((response.body.data as SearchResponse).results).toHaveLength(1);
  });

  it('refuses somebody who is not in the org at all', async () => {
    const stranger = await seedUser({ name: 'Stranger' });
    const response = await search({ q: 'anything' }, stranger);
    expect(response.status).toBe(403);
  });

  it('does not reach across organizations', async () => {
    const otherWorld = await seedWorld();
    await seedTask(otherWorld, { title: 'Foreign roadmap item' });
    await db.insert(projectMembers).values({
      projectId: otherWorld.projectId,
      userId: world.member.id,
      role: 'member',
    });

    const response = await search({ q: 'roadmap' });
    expect((response.body.data as SearchResponse).results).toEqual([]);
  });
});

describe('search query validation', () => {
  it('needs at least two characters', async () => {
    const response = await search({ q: 'a' });
    expect(response.status).toBe(422);
  });

  it('serves the ceiling limit, and REFUSES anything above it', async () => {
    for (let index = 0; index < 30; index += 1) {
      await seedTask(world, { title: `Repeated subject ${String(index)}` });
    }

    const atCeiling = await search({ q: 'Repeated', limit: MAX_SEARCH_RESULTS });
    expect((atCeiling.body.data as SearchResponse).results).toHaveLength(MAX_SEARCH_RESULTS);

    // 422, not a silent clamp. The ceiling lives in the shared
    // `searchQuerySchema`, so a caller asking for 50 learns its request was
    // wrong instead of reading 25 rows as "that is all there is".
    const overCeiling = await search({ q: 'Repeated', limit: MAX_SEARCH_RESULTS + 1 });
    expect(overCeiling.status).toBe(422);
  });

  it('honours a smaller explicit limit', async () => {
    for (let index = 0; index < 5; index += 1) {
      await seedTask(world, { title: `Repeated subject ${String(index)}` });
    }

    const response = await search({ q: 'Repeated', limit: 2 });
    expect((response.body.data as SearchResponse).results).toHaveLength(2);
  });
});
