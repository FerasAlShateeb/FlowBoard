/**
 * `/api/admin/telemetry/*` + `POST /api/telemetry/events` integration suite.
 *
 * THE ARITHMETIC IS THE FEATURE, so it is what this file asserts. Every fixture
 * below is written at an EXPLICIT instant and every expectation is a number
 * worked out by hand from those instants — a zero-filled bucket at 10:00, an
 * `errorRate` of 0.25 from one 500 in four requests, a p95 of 38.5 interpolated
 * between 30 and 40. Asserting "the response parses" would pass equally well
 * against a query that buckets by the wrong column.
 *
 * EVERY PAYLOAD IS PARSED WITH THE SHARED SCHEMA before it is inspected. That is
 * what makes these tests a contract check rather than a snapshot of whatever the
 * service happens to return: a field renamed on the server fails here even if
 * the number under it is right.
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  latencyReportSchema,
  requestsOverTimeSchema,
  telemetryEventsResponseSchema,
  telemetryOverviewSchema,
  topEndpointsSchema,
} from '@flowboard/shared';

import { closeDb, db, telemetryEvents } from '../../db';
import { setTelemetrySink } from '../../services/telemetry.service';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import { bearer, seedOrg, seedProject, seedUser, tokensFor } from './identity-test-app';
import {
  at,
  buildTelemetryTestApp,
  daysFrom,
  hoursFrom,
  seedEvent,
  seedLatencies,
  seedRequestLog,
} from './telemetry-test-app';

const app = buildTelemetryTestApp();

/** The day every request-log fixture lives on. Fixed, so bucket edges are exact. */
const DAY = at('2026-08-20T00:00:00.000Z');
const H = (hour: number): Date => hoursFrom(DAY, hour);

beforeAll(async () => {
  await ensureTestDb();
});

beforeEach(async () => {
  setTelemetrySink(null);
  await truncateAllTables();
});

afterAll(async () => {
  setTelemetrySink(null);
  await closeDb();
});

async function seedAdmin() {
  const admin = await seedUser({ name: 'Root', isGlobalAdmin: true });
  return { admin, token: tokensFor(admin).accessToken };
}

async function seedMember() {
  const member = await seedUser({ name: 'Ada Lovelace' });
  return { member, token: tokensFor(member).accessToken };
}

/** `GET` as a global admin, asserting a 200 and returning the parsed envelope. */
async function getOk(path: string, token: string) {
  const res = await request(app).get(path).set('Authorization', bearer(token));
  // The body is the assertion message: a 500 here is a SQL failure, and the
  // envelope carries the reason a bare status code would not.
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { data: unknown; meta?: unknown };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Overview
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/telemetry/overview', () => {
  it('answers with zeros rather than nulls on an empty deployment', async () => {
    const { token } = await seedAdmin();

    const body = await getOk('/api/admin/telemetry/overview', token);

    expect(telemetryOverviewSchema.parse(body.data)).toEqual({
      dau: 0,
      eventsToday: 0,
      tasksCreated7d: 0,
      tasksCompleted7d: 0,
      activeProjects: 0,
    });
  });

  it('counts DISTINCT users today and every event today, ignoring anonymous rows', async () => {
    const { admin, token } = await seedAdmin();
    const { member } = await seedMember();
    const now = new Date();
    // Just after midnight UTC — inside "today" whatever hour the suite runs at.
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 30),
    );

    await seedEvent({ type: 'page_view', createdAt: today, userId: admin.id });
    // Same user twice: DAU is distinct users, not events.
    await seedEvent({ type: 'page_view', createdAt: today, userId: admin.id });
    await seedEvent({ type: 'page_view', createdAt: today, userId: member.id });
    // A signed-out page view: an event, but not a user.
    await seedEvent({ type: 'page_view', createdAt: today, userId: null });
    // Three days ago: inside the 7-day window, outside "today".
    await seedEvent({ type: 'page_view', createdAt: daysFrom(now, -3), userId: member.id });

    const overview = telemetryOverviewSchema.parse(
      (await getOk('/api/admin/telemetry/overview', token)).data,
    );

    expect(overview.dau).toBe(2);
    expect(overview.eventsToday).toBe(4);
  });

  it('counts the 7-day task figures by TYPE and drops anything older', async () => {
    const { admin, token } = await seedAdmin();
    const now = new Date();

    await seedEvent({ type: 'task_created', createdAt: daysFrom(now, -1), userId: admin.id });
    await seedEvent({ type: 'task_created', createdAt: daysFrom(now, -6), userId: admin.id });
    await seedEvent({ type: 'task_completed', createdAt: daysFrom(now, -2), userId: admin.id });
    // Ten days back — outside the window, and the reason the window exists.
    await seedEvent({ type: 'task_created', createdAt: daysFrom(now, -10), userId: admin.id });
    // A different event type entirely must not leak into either count.
    await seedEvent({ type: 'task_moved', createdAt: daysFrom(now, -1), userId: admin.id });

    const overview = telemetryOverviewSchema.parse(
      (await getOk('/api/admin/telemetry/overview', token)).data,
    );

    expect(overview.tasksCreated7d).toBe(2);
    expect(overview.tasksCompleted7d).toBe(1);
  });

  it('counts DISTINCT projects touched in the last 7 days', async () => {
    const { admin, token } = await seedAdmin();
    const org = await seedOrg({ createdById: admin.id });
    const alpha = await seedProject(org.id);
    const beta = await seedProject(org.id);
    const now = new Date();

    await seedEvent({ type: 'task_created', createdAt: daysFrom(now, -1), projectId: alpha.id });
    await seedEvent({ type: 'task_moved', createdAt: daysFrom(now, -2), projectId: alpha.id });
    await seedEvent({ type: 'task_created', createdAt: daysFrom(now, -3), projectId: beta.id });
    // Project-less events (a login) must not become a phantom "active project".
    await seedEvent({ type: 'auth_login', createdAt: daysFrom(now, -1), projectId: null });
    // Outside the window.
    await seedEvent({ type: 'task_created', createdAt: daysFrom(now, -9), projectId: beta.id });

    const overview = telemetryOverviewSchema.parse(
      (await getOk('/api/admin/telemetry/overview', token)).data,
    );

    expect(overview.activeProjects).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The raw event feed
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/telemetry/events', () => {
  it('pages through the feed newest-first with the counts in the ENVELOPE', async () => {
    const { admin, token } = await seedAdmin();
    for (let index = 0; index < 5; index += 1) {
      await seedEvent({ type: 'page_view', createdAt: H(index), userId: admin.id });
    }

    const body = await getOk('/api/admin/telemetry/events?page=1&pageSize=2', token);
    const rows = telemetryEventsResponseSchema.parse(body.data);

    expect(rows).toHaveLength(2);
    expect(body.meta).toEqual({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
    // Newest first: the 04:00 event, then 03:00.
    expect(rows[0]?.createdAt).toBe(H(4).toISOString());
    expect(rows[1]?.createdAt).toBe(H(3).toISOString());
  });

  it('joins the actor name and carries the payload bag through untouched', async () => {
    const { admin, token } = await seedAdmin();
    await seedEvent({
      type: 'search_performed',
      createdAt: H(1),
      userId: admin.id,
      payload: { query: 'flow', resultCount: 3 },
    });
    // A system event with no actor: `userName` must be null, not missing.
    await seedEvent({ type: 'sprint_completed', createdAt: H(2), userId: null });

    const rows = telemetryEventsResponseSchema.parse(
      (await getOk('/api/admin/telemetry/events', token)).data,
    );

    expect(rows[0]?.userName).toBeNull();
    expect(rows[1]?.userName).toBe('Root');
    expect(rows[1]?.payload).toEqual({ query: 'flow', resultCount: 3 });
    // bigserial ids cross the wire as decimal STRINGS.
    expect(rows[1]?.id).toMatch(/^\d+$/u);
  });

  it('filters on a comma-separated list of types', async () => {
    const { admin, token } = await seedAdmin();
    await seedEvent({ type: 'page_view', createdAt: H(1), userId: admin.id });
    await seedEvent({ type: 'task_created', createdAt: H(2), userId: admin.id });
    await seedEvent({ type: 'comment_added', createdAt: H(3), userId: admin.id });

    const body = await getOk('/api/admin/telemetry/events?type=page_view,comment_added', token);
    const rows = telemetryEventsResponseSchema.parse(body.data);

    expect(rows.map((row) => row.type).sort()).toEqual(['comment_added', 'page_view']);
    expect(body.meta).toMatchObject({ total: 2 });
  });

  it('filters on the actor and on the window independently', async () => {
    const { admin, token } = await seedAdmin();
    const { member } = await seedMember();
    await seedEvent({ type: 'page_view', createdAt: H(1), userId: admin.id });
    await seedEvent({ type: 'page_view', createdAt: H(5), userId: member.id });
    await seedEvent({ type: 'page_view', createdAt: H(9), userId: member.id });

    const byUser = telemetryEventsResponseSchema.parse(
      (await getOk(`/api/admin/telemetry/events?userId=${member.id}`, token)).data,
    );
    expect(byUser).toHaveLength(2);

    const inWindow = telemetryEventsResponseSchema.parse(
      (
        await getOk(
          `/api/admin/telemetry/events?from=${H(4).toISOString()}&to=${H(6).toISOString()}`,
          token,
        )
      ).data,
    );
    expect(inWindow).toHaveLength(1);
    expect(inWindow[0]?.userId).toBe(member.id);
  });

  it('honours `?sort=createdAt:asc`', async () => {
    const { admin, token } = await seedAdmin();
    await seedEvent({ type: 'page_view', createdAt: H(1), userId: admin.id });
    await seedEvent({ type: 'page_view', createdAt: H(2), userId: admin.id });

    const rows = telemetryEventsResponseSchema.parse(
      (await getOk('/api/admin/telemetry/events?sort=createdAt:asc', token)).data,
    );

    expect(rows[0]?.createdAt).toBe(H(1).toISOString());
  });

  it('rejects an unknown event type and an over-sized page with 422', async () => {
    const { token } = await seedAdmin();

    const badType = await request(app)
      .get('/api/admin/telemetry/events?type=definitely_not_an_event')
      .set('Authorization', bearer(token));
    expect(badType.status).toBe(422);

    const badPage = await request(app)
      .get('/api/admin/telemetry/events?pageSize=500')
      .set('Authorization', bearer(token));
    expect(badPage.status).toBe(422);

    const badSort = await request(app)
      .get('/api/admin/telemetry/events?sort=payload:desc')
      .set('Authorization', bearer(token));
    expect(badSort.status).toBe(422);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Requests over time
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/telemetry/requests-over-time', () => {
  /** 09:15 → 100 ms, 09:45 → 300 ms, 11:05 → 50 ms. The 10:00 hour is silent. */
  async function seedThreeRequests(): Promise<void> {
    await seedRequestLog({ createdAt: at('2026-08-20T09:15:00.000Z'), durationMs: 100 });
    await seedRequestLog({ createdAt: at('2026-08-20T09:45:00.000Z'), durationMs: 300 });
    await seedRequestLog({ createdAt: at('2026-08-20T11:05:00.000Z'), durationMs: 50 });
  }

  it('buckets by hour and FILLS THE SILENT HOUR with a zero row', async () => {
    const { token } = await seedAdmin();
    await seedThreeRequests();

    const body = await getOk(
      `/api/admin/telemetry/requests-over-time?bucket=hour&from=${H(9).toISOString()}&to=${H(11).toISOString()}`,
      token,
    );

    expect(requestsOverTimeSchema.parse(body.data).buckets).toEqual([
      { ts: H(9).toISOString(), count: 2, avgDurationMs: 200 },
      // The whole reason the spine exists: an outage must be a visible zero,
      // not an absent point the chart draws a straight line across.
      { ts: H(10).toISOString(), count: 0, avgDurationMs: 0 },
      { ts: H(11).toISOString(), count: 1, avgDurationMs: 50 },
    ]);
  });

  it('buckets by day, averaging the whole day into one point', async () => {
    const { token } = await seedAdmin();
    await seedThreeRequests();

    const body = await getOk(
      `/api/admin/telemetry/requests-over-time?bucket=day&from=${daysFrom(DAY, -2).toISOString()}&to=${DAY.toISOString()}`,
      token,
    );

    // (100 + 300 + 50) / 3 = 150.
    expect(requestsOverTimeSchema.parse(body.data).buckets).toEqual([
      { ts: daysFrom(DAY, -2).toISOString(), count: 0, avgDurationMs: 0 },
      { ts: daysFrom(DAY, -1).toISOString(), count: 0, avgDurationMs: 0 },
      { ts: DAY.toISOString(), count: 3, avgDurationMs: 150 },
    ]);
  });

  it('rejects an unknown bucket and a reversed window', async () => {
    const { token } = await seedAdmin();

    const badBucket = await request(app)
      .get('/api/admin/telemetry/requests-over-time?bucket=week')
      .set('Authorization', bearer(token));
    expect(badBucket.status).toBe(422);

    const reversed = await request(app)
      .get(
        `/api/admin/telemetry/requests-over-time?from=${H(11).toISOString()}&to=${H(9).toISOString()}`,
      )
      .set('Authorization', bearer(token));
    expect(reversed.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Top endpoints
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/telemetry/top-endpoints', () => {
  /**
   * Four GETs (one of them a 500) and two POSTs (one of them a 404).
   *
   *   GET  /api/tasks/:taskId  → count 4, avg (100+200+300+400)/4 = 250, 1 of 4 is 5xx → 0.25
   *   POST /api/tasks          → count 2, avg (10+30)/2 = 20, the 404 is NOT an error → 0
   */
  async function seedTraffic(): Promise<void> {
    await seedRequestLog({ createdAt: H(9), durationMs: 100 });
    await seedRequestLog({ createdAt: H(9), durationMs: 200 });
    await seedRequestLog({ createdAt: H(9), durationMs: 300, statusCode: 500 });
    await seedRequestLog({ createdAt: H(9), durationMs: 400 });
    await seedRequestLog({
      createdAt: H(9),
      durationMs: 10,
      method: 'POST',
      path: '/api/tasks',
    });
    await seedRequestLog({
      createdAt: H(9),
      durationMs: 30,
      method: 'POST',
      path: '/api/tasks',
      statusCode: 404,
    });
  }

  const WINDOW = `from=${DAY.toISOString()}&to=${daysFrom(DAY, 1).toISOString()}`;

  it('groups by method + path, busiest first, with a 5xx-only error rate', async () => {
    const { token } = await seedAdmin();
    await seedTraffic();

    const body = await getOk(`/api/admin/telemetry/top-endpoints?${WINDOW}`, token);

    expect(topEndpointsSchema.parse(body.data).endpoints).toEqual([
      { method: 'GET', path: '/api/tasks/:taskId', count: 4, avgDurationMs: 250, errorRate: 0.25 },
      // A 404 is the API telling the truth about a missing row, not a failure —
      // counting it would put every healthy endpoint permanently in the red.
      { method: 'POST', path: '/api/tasks', count: 2, avgDurationMs: 20, errorRate: 0 },
    ]);
  });

  it('respects `?limit`', async () => {
    const { token } = await seedAdmin();
    await seedTraffic();

    const body = await getOk(`/api/admin/telemetry/top-endpoints?${WINDOW}&limit=1`, token);
    const { endpoints } = topEndpointsSchema.parse(body.data);

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]?.method).toBe('GET');
  });

  it('rejects a limit above the ceiling', async () => {
    const { token } = await seedAdmin();

    const res = await request(app)
      .get('/api/admin/telemetry/top-endpoints?limit=1000')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(422);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Latency percentiles
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/telemetry/latency', () => {
  it('interpolates every percentile from one grouped scan', async () => {
    const { token } = await seedAdmin();
    // Four samples in the 09:00 hour; the 10:00 hour is left empty.
    await seedLatencies(H(9), [10, 20, 30, 40]);

    const body = await getOk(
      `/api/admin/telemetry/latency?bucket=hour&from=${H(9).toISOString()}&to=${H(10).toISOString()}`,
      token,
    );
    const { buckets } = latencyReportSchema.parse(body.data);

    // `percentile_cont` over [10,20,30,40] interpolates at index f*(n-1):
    //   p50 → 1.5   → 20 + 0.5·10 = 25
    //   p90 → 2.7   → 30 + 0.7·10 = 37
    //   p95 → 2.85  → 30 + 0.85·10 = 38.5
    //   p99 → 2.97  → 30 + 0.97·10 = 39.7
    expect(buckets[0]).toEqual({
      ts: H(9).toISOString(),
      p50: 25,
      p90: 37,
      p95: 38.5,
      p99: 39.7,
      max: 40,
      count: 4,
    });
  });

  it('zero-fills a silent bucket and marks it with `count: 0`', async () => {
    const { token } = await seedAdmin();
    await seedLatencies(H(9), [10, 20, 30, 40]);

    const body = await getOk(
      `/api/admin/telemetry/latency?bucket=hour&from=${H(9).toISOString()}&to=${H(10).toISOString()}`,
      token,
    );
    const { buckets } = latencyReportSchema.parse(body.data);

    expect(buckets).toHaveLength(2);
    // `count: 0` is what lets the chart BREAK the line here rather than plot a
    // 0 ms p95 that never happened.
    expect(buckets[1]).toEqual({
      ts: H(10).toISOString(),
      p50: 0,
      p90: 0,
      p95: 0,
      p99: 0,
      max: 0,
      count: 0,
    });
  });

  it('refuses a window that would produce an undrawable number of buckets', async () => {
    const { token } = await seedAdmin();

    const res = await request(app)
      .get(
        `/api/admin/telemetry/latency?bucket=minute&from=${daysFrom(DAY, -30).toISOString()}&to=${DAY.toISOString()}`,
      )
      .set('Authorization', bearer(token));

    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. The guard
// ═══════════════════════════════════════════════════════════════════════════

describe('the global-admin gate', () => {
  const PATHS = [
    '/api/admin/telemetry/overview',
    '/api/admin/telemetry/events',
    '/api/admin/telemetry/requests-over-time',
    '/api/admin/telemetry/top-endpoints',
    '/api/admin/telemetry/latency',
  ] as const;

  it('answers 403 to a signed-in non-admin on every endpoint', async () => {
    const { token } = await seedMember();

    for (const path of PATHS) {
      const res = await request(app).get(path).set('Authorization', bearer(token));
      expect(res.status, path).toBe(403);
    }
  });

  it('answers 401 with no token at all', async () => {
    for (const path of PATHS) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(401);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Client ingest
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/telemetry/events', () => {
  /**
   * `record()` is fire-and-forget: the handler answers BEFORE the insert
   * resolves. Polling is therefore the honest way to observe the row — awaiting
   * a promise the contract does not expose would test a different function.
   */
  async function waitForEvents(expected: number): Promise<(typeof telemetryEvents.$inferSelect)[]> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const rows = await db.select().from(telemetryEvents);
      if (rows.length >= expected) return rows;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return db.select().from(telemetryEvents);
  }

  function wireSink(): void {
    setTelemetrySink(async (event) => {
      await db.insert(telemetryEvents).values(event);
    });
  }

  it('records a page view attributed to the TOKEN, not to the body', async () => {
    const { member, token } = await seedMember();
    const org = await seedOrg({ createdById: member.id });
    wireSink();

    const res = await request(app)
      .post('/api/telemetry/events')
      .set('Authorization', bearer(token))
      .send({
        type: 'page_view',
        orgId: org.id,
        payload: { path: '/o/:orgSlug/p/:projectKey/board' },
      });

    expect(res.status).toBe(204);

    const [row] = await waitForEvents(1);
    expect(row?.type).toBe('page_view');
    expect(row?.userId).toBe(member.id);
    expect(row?.orgId).toBe(org.id);
    expect(row?.payload).toEqual({ path: '/o/:orgSlug/p/:projectKey/board' });
  });

  it('accepts the other two client-observable events', async () => {
    const { token } = await seedMember();
    wireSink();

    for (const type of ['theme_changed', 'export_csv'] as const) {
      const res = await request(app)
        .post('/api/telemetry/events')
        .set('Authorization', bearer(token))
        .send({ type });
      expect(res.status, type).toBe(204);
    }

    expect(await waitForEvents(2)).toHaveLength(2);
  });

  it('REFUSES a server-authoritative event type', async () => {
    const { token } = await seedMember();
    wireSink();

    for (const type of ['task_completed', 'auth_login', 'sprint_started'] as const) {
      const res = await request(app)
        .post('/api/telemetry/events')
        .set('Authorization', bearer(token))
        .send({ type });
      // A browser that could post these could write a history that never
      // happened — and the dashboard above would report it as fact.
      expect(res.status, type).toBe(422);
    }

    expect(await db.select().from(telemetryEvents)).toHaveLength(0);
  });

  it('refuses an unbounded payload bag', async () => {
    const { token } = await seedMember();
    const payload = Object.fromEntries(
      Array.from({ length: 40 }, (_value, index) => [`k${String(index)}`, index]),
    );

    const res = await request(app)
      .post('/api/telemetry/events')
      .set('Authorization', bearer(token))
      .send({ type: 'page_view', payload });

    expect(res.status).toBe(422);
  });

  it('is closed to anonymous callers', async () => {
    const res = await request(app).post('/api/telemetry/events').send({ type: 'page_view' });
    expect(res.status).toBe(401);
  });
});
