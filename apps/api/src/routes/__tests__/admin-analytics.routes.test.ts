/**
 * `/api/admin/analytics/*` integration suite — the five domain aggregations.
 *
 * THE ARITHMETIC IS THE FEATURE, so it is what this file asserts. Every fixture
 * is written at an EXPLICIT instant and every expectation is a number worked out
 * by hand from those instants: a stickiness of 0.5 from one active user against
 * a trailing MAU of two, a p95 of 29.1 interpolated between 12 and 30 hours, an
 * acceptance rate of 0.5 from two accepted invites in a cohort of four, a
 * zero-filled bucket on a silent day. Asserting "the response parses" would pass
 * equally well against a query that buckets by the wrong column.
 *
 * EVERY PAYLOAD IS PARSED WITH ITS SHARED SCHEMA before it is inspected. That is
 * what makes these tests a contract check rather than a snapshot of whatever the
 * service happens to return: a field renamed on the server fails here even if
 * the number under it is right. It is also what enforces the two shapes the
 * contract states outright — `activityByHour` is `.length(24)`, and the cycle
 * percentiles are nullable rather than zero.
 *
 * THE FOUR WINDOWED DOMAINS ARE PINNED WITH `?from&to`, so nothing in them
 * depends on when the suite runs. `/overview` cannot be: its windows are fixed
 * by the contract (14 days, 24 hours, trailing 30 days), so its fixtures are
 * written relative to a real `now`, exactly as the telemetry overview suite's
 * are.
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  analyticsEngagementSchema,
  analyticsGrowthSchema,
  analyticsOverviewSchema,
  analyticsTrafficSchema,
  analyticsWorkSchema,
} from '@flowboard/shared';

import { closeDb } from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import {
  at,
  bearer,
  buildAnalyticsTestApp,
  daysFrom,
  hoursFrom,
  seedAnalyticsInvite,
  seedAnalyticsOrg,
  seedAnalyticsTask,
  seedAnalyticsUser,
  seedEvent,
  seedMembership,
  seedProjectRef,
  seedRequestLog,
  tokensFor,
  type ProjectRef,
} from './admin-analytics-test-app';

const app = buildAnalyticsTestApp();

/** The day every windowed fixture lives on. Fixed, so bucket edges are exact. */
const DAY = at('2026-08-20T00:00:00.000Z');
/** Whole days from {@link DAY}. */
const D = (days: number): Date => daysFrom(DAY, days);
/** Whole hours from {@link DAY}. */
const H = (hours: number): Date => hoursFrom(DAY, hours);

/**
 * The three-day daily window every windowed test uses: buckets D0, D1, D2.
 *
 * `to` is D2 rather than D3 on purpose — the window snaps OUTWARD to whole
 * buckets, so `to` naming a bucket includes the whole of it.
 */
const WINDOW = `from=${D(0).toISOString()}&to=${D(2).toISOString()}&interval=day`;

/** The instants of the three buckets, in order — every series is compared to these. */
const BUCKETS = [D(0).toISOString(), D(1).toISOString(), D(2).toISOString()];

const PATHS = [
  '/api/admin/analytics/overview',
  '/api/admin/analytics/engagement',
  '/api/admin/analytics/work',
  '/api/admin/analytics/traffic',
  '/api/admin/analytics/growth',
] as const;

beforeAll(async () => {
  await ensureTestDb();
});

beforeEach(async () => {
  await truncateAllTables();
});

afterAll(async () => {
  await closeDb();
});

/** A global admin plus its bearer token — the only caller these endpoints have. */
async function seedAdmin(): Promise<{ id: string; token: string }> {
  const admin = await seedAnalyticsUser({ name: 'Root', isGlobalAdmin: true });
  return { id: admin.id, token: tokensFor(admin).accessToken };
}

/** `GET` as a global admin, asserting a 200 and returning the envelope's `data`. */
async function getOk(path: string, token: string): Promise<unknown> {
  const res = await request(app).get(path).set('Authorization', bearer(token));
  // The body is the assertion message: a 500 here is a SQL failure, and the
  // envelope carries the reason a bare status code would not.
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as { data: unknown }).data;
}

/** A series flattened to its values — the shape every hand-worked expectation takes. */
function values(series: { t: string; value: number }[]): number[] {
  return series.map((point) => point.value);
}

/** The bucket instants of a series, for asserting the spine itself. */
function instants(series: { t: string; value: number }[]): string[] {
  return series.map((point) => point.t);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. The guard, and the window contract every domain shares
// ═══════════════════════════════════════════════════════════════════════════

describe('the global-admin gate', () => {
  it('answers 401 with no token at all', async () => {
    for (const path of PATHS) {
      expect((await request(app).get(path)).status, path).toBe(401);
    }
  });

  it('answers 403 to a signed-in non-admin on every domain', async () => {
    const member = await seedAnalyticsUser({ name: 'Ada Lovelace' });
    const token = tokensFor(member).accessToken;

    for (const path of PATHS) {
      const res = await request(app).get(path).set('Authorization', bearer(token));
      expect(res.status, path).toBe(403);
    }
  });
});

describe('the shared window contract', () => {
  it('rejects an interval outside the closed enum on EVERY domain, /overview included', async () => {
    const { token } = await seedAdmin();

    for (const path of PATHS) {
      const res = await request(app)
        .get(`${path}?interval=fortnight`)
        .set('Authorization', bearer(token));
      // A 422 on four paths and a 200 on the fifth would teach a client
      // something false about the API.
      expect(res.status, path).toBe(422);
    }
  });

  it('rejects a malformed instant with 422', async () => {
    const { token } = await seedAdmin();

    const res = await request(app)
      .get('/api/admin/analytics/work?from=last-tuesday')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(422);
  });

  it('rejects a reversed window with 400', async () => {
    const { token } = await seedAdmin();

    const res = await request(app)
      .get(`/api/admin/analytics/work?from=${D(2).toISOString()}&to=${D(0).toISOString()}`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(400);
  });

  it('refuses a window that would produce an undrawable number of buckets', async () => {
    const { token } = await seedAdmin();

    // 30 days of hourly buckets is 721 — past the 400 ceiling. The guard runs in
    // JavaScript, before `generate_series` can materialise the rows.
    const res = await request(app)
      .get(
        `/api/admin/analytics/traffic?from=${D(-30).toISOString()}&to=${D(0).toISOString()}&interval=hour`,
      )
      .set('Authorization', bearer(token));

    expect(res.status).toBe(400);
  });

  it('accepts a window right at the ceiling', async () => {
    const { token } = await seedAdmin();

    // 399 hours + 1 = 400 buckets exactly: allowed.
    const res = await request(app)
      .get(
        `/api/admin/analytics/traffic?from=${H(0).toISOString()}&to=${H(399).toISOString()}&interval=hour`,
      )
      .set('Authorization', bearer(token));

    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('defaults to a 30-day daily window when nothing is passed', async () => {
    const { token } = await seedAdmin();

    const traffic = analyticsTrafficSchema.parse(
      await getOk('/api/admin/analytics/traffic', token),
    );

    // 30 days back through today, snapped to whole days: 31 buckets.
    expect(traffic.requestsSeries).toHaveLength(31);
    expect(values(traffic.requestsSeries).every((value) => value === 0)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Overview
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/analytics/overview', () => {
  it('answers with zeros and FULL spines on an empty deployment', async () => {
    const { token } = await seedAdmin();

    const overview = analyticsOverviewSchema.parse(await getOk(PATHS[0], token));

    expect(overview).toMatchObject({
      users: { total: 1, active30d: 0 },
      orgs: 0,
      projects: 0,
      tasks: { total: 0, completed30d: 0 },
      errorRate24h: 0,
    });
    // The two spines are fixed by the contract and do not depend on the data.
    expect(overview.eventsSeries).toHaveLength(14);
    expect(overview.requestsSeries).toHaveLength(24);
    expect(values(overview.eventsSeries).every((value) => value === 0)).toBe(true);
  });

  it('counts LIVE orgs, projects and tasks — soft-deleted rows are invisible', async () => {
    const { token } = await seedAdmin();
    const now = new Date();

    const live = await seedAnalyticsOrg();
    const archived = await seedAnalyticsOrg({ deletedAt: now });

    const liveProject = await seedProjectRef(live.id);
    const deletedProject = await seedProjectRef(live.id, { deletedAt: now });
    // A live project inside a DELETED org: the org's deletion reaches it too.
    const orphanProject = await seedProjectRef(archived.id);

    await seedAnalyticsTask(liveProject, { createdAt: daysFrom(now, -1) });
    await seedAnalyticsTask(liveProject, { createdAt: daysFrom(now, -1), deletedAt: now });
    await seedAnalyticsTask(deletedProject, { createdAt: daysFrom(now, -1) });
    await seedAnalyticsTask(orphanProject, { createdAt: daysFrom(now, -1) });

    const overview = analyticsOverviewSchema.parse(await getOk(PATHS[0], token));

    expect(overview.orgs).toBe(1);
    expect(overview.projects).toBe(1);
    // One task of four: the other three are deleted, in a deleted project, or in
    // a project whose org is deleted.
    expect(overview.tasks.total).toBe(1);
  });

  it('counts DISTINCT active users over 30 days, ignoring anonymous and older events', async () => {
    const { id: adminId, token } = await seedAdmin();
    const member = await seedAnalyticsUser({ name: 'Ada Lovelace' });
    const now = new Date();

    await seedEvent({ type: 'page_view', createdAt: daysFrom(now, -1), userId: adminId });
    // The same user twice: this is distinct users, not events.
    await seedEvent({ type: 'page_view', createdAt: daysFrom(now, -2), userId: adminId });
    await seedEvent({ type: 'page_view', createdAt: daysFrom(now, -3), userId: member.id });
    // A signed-out page view: an event, but not a user.
    await seedEvent({ type: 'page_view', createdAt: daysFrom(now, -1), userId: null });
    // Outside the 30-day window, and the reason the window exists.
    await seedEvent({ type: 'auth_login', createdAt: daysFrom(now, -40), userId: member.id });

    const overview = analyticsOverviewSchema.parse(await getOk(PATHS[0], token));

    expect(overview.users).toEqual({ total: 2, active30d: 2 });
  });

  it('counts tasks completed in the trailing 30 days off `resolved_at`', async () => {
    const { token } = await seedAdmin();
    const now = new Date();
    const org = await seedAnalyticsOrg();
    const project = await seedProjectRef(org.id);

    await seedAnalyticsTask(project, {
      createdAt: daysFrom(now, -40),
      resolvedAt: daysFrom(now, -2),
    });
    await seedAnalyticsTask(project, {
      createdAt: daysFrom(now, -40),
      resolvedAt: daysFrom(now, -35),
    });
    // Never resolved: part of `total`, not of `completed30d`.
    await seedAnalyticsTask(project, { createdAt: daysFrom(now, -1) });

    const overview = analyticsOverviewSchema.parse(await getOk(PATHS[0], token));

    expect(overview.tasks).toEqual({ total: 3, completed30d: 1 });
  });

  it('fills the two fixed sparklines from the two append-only streams', async () => {
    const { id: adminId, token } = await seedAdmin();
    const now = new Date();
    // Half past midnight UTC — inside "today" whatever hour the suite runs at,
    // and therefore inside the LAST daily bucket.
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 30),
    );
    const thisHour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);

    await seedEvent({ type: 'page_view', createdAt: today, userId: adminId });
    await seedEvent({ type: 'task_created', createdAt: today, userId: adminId });
    // 20 days back: outside the 14-day spine entirely.
    await seedEvent({ type: 'page_view', createdAt: daysFrom(now, -20), userId: adminId });

    await seedRequestLog({ createdAt: thisHour, durationMs: 10 });
    await seedRequestLog({ createdAt: thisHour, durationMs: 20 });

    const overview = analyticsOverviewSchema.parse(await getOk(PATHS[0], token));

    expect(overview.eventsSeries).toHaveLength(14);
    expect(overview.eventsSeries[13]?.value).toBe(2);
    expect(overview.requestsSeries).toHaveLength(24);
    expect(overview.requestsSeries[23]?.value).toBe(2);
    // The 20-day-old event is outside the spine, so nothing else carries it.
    expect(values(overview.eventsSeries).reduce((sum, value) => sum + value, 0)).toBe(2);
  });

  it('reads `errorRate24h` as the 4xx+5xx SHARE of the last 24 hours', async () => {
    const { token } = await seedAdmin();
    const now = new Date();
    const recent = new Date(now.getTime() - 3_600_000);

    await seedRequestLog({ createdAt: recent, durationMs: 10 });
    await seedRequestLog({ createdAt: recent, durationMs: 10 });
    // The contract counts BOTH client and server errors here — unlike
    // `topEndpoints`, whose rate is 5xx-only by its own older contract.
    await seedRequestLog({ createdAt: recent, durationMs: 10, statusCode: 404 });
    await seedRequestLog({ createdAt: recent, durationMs: 10, statusCode: 500 });
    // 30 hours old: outside the window, and it would move the figure to 0.4.
    await seedRequestLog({ createdAt: new Date(now.getTime() - 30 * 3_600_000), durationMs: 10 });

    const overview = analyticsOverviewSchema.parse(await getOk(PATHS[0], token));

    expect(overview.errorRate24h).toBe(0.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Engagement
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/analytics/engagement', () => {
  const PATH = `${PATHS[1]}?${WINDOW}`;

  it('buckets DISTINCT actors per day and fills the silent day with a zero', async () => {
    const { token } = await seedAdmin();
    const ada = await seedAnalyticsUser({ name: 'Ada' });
    const bob = await seedAnalyticsUser({ name: 'Bob' });

    await seedEvent({ type: 'page_view', createdAt: H(9), userId: ada.id });
    // The same actor twice in one bucket counts once.
    await seedEvent({ type: 'task_created', createdAt: H(11), userId: ada.id });
    await seedEvent({ type: 'page_view', createdAt: H(9), userId: bob.id });
    await seedEvent({ type: 'page_view', createdAt: H(30), userId: ada.id });
    // Anonymous: an event, never an actor.
    await seedEvent({ type: 'page_view', createdAt: H(31), userId: null });

    const engagement = analyticsEngagementSchema.parse(await getOk(PATH, token));

    expect(instants(engagement.dauSeries)).toEqual(BUCKETS);
    // D2 is silent and must be a visible zero, not an absent point.
    expect(values(engagement.dauSeries)).toEqual([2, 1, 0]);
  });

  it('reads signups off `users.created_at`, not off any event', async () => {
    const { token } = await seedAdmin();
    await seedAnalyticsUser({ createdAt: H(3) });
    await seedAnalyticsUser({ createdAt: H(20) });
    await seedAnalyticsUser({ createdAt: H(30) });
    // Long before the window.
    await seedAnalyticsUser({ createdAt: D(-40) });

    const engagement = analyticsEngagementSchema.parse(await getOk(PATH, token));

    expect(values(engagement.signupsSeries)).toEqual([2, 1, 0]);
  });

  it('computes stickiness as bucket DAU over the TRAILING 30-day MAU', async () => {
    const { token } = await seedAdmin();
    const ada = await seedAnalyticsUser({ name: 'Ada' });
    const bob = await seedAnalyticsUser({ name: 'Bob' });

    await seedEvent({ type: 'page_view', createdAt: H(9), userId: ada.id });
    await seedEvent({ type: 'page_view', createdAt: H(33), userId: bob.id });

    const engagement = analyticsEngagementSchema.parse(await getOk(PATH, token));

    // D0: DAU {Ada} = 1, trailing MAU as of D1 = {Ada} = 1        → 1
    // D1: DAU {Bob} = 1, trailing MAU as of D2 = {Ada, Bob} = 2   → 0.5
    // D2: DAU {} = 0,    trailing MAU as of D3 = {Ada, Bob} = 2   → 0
    expect(values(engagement.stickinessSeries)).toEqual([1, 0.5, 0]);
    // The scalar is the window's own end: both actors are inside 30 days of it.
    expect(engagement.mau).toBe(2);
  });

  it('answers 0 rather than NaN for stickiness when nobody has ever shown up', async () => {
    const { token } = await seedAdmin();

    const engagement = analyticsEngagementSchema.parse(await getOk(PATH, token));

    expect(values(engagement.stickinessSeries)).toEqual([0, 0, 0]);
    expect(engagement.mau).toBe(0);
    expect(engagement.eventsByType).toEqual([]);
  });

  it('always returns 24 hour buckets, in order, in UTC', async () => {
    const { token } = await seedAdmin();
    const ada = await seedAnalyticsUser({ name: 'Ada' });

    await seedEvent({
      type: 'page_view',
      createdAt: at('2026-08-20T09:15:00.000Z'),
      userId: ada.id,
    });
    await seedEvent({
      type: 'page_view',
      createdAt: at('2026-08-20T09:45:00.000Z'),
      userId: ada.id,
    });
    await seedEvent({
      type: 'page_view',
      createdAt: at('2026-08-21T23:30:00.000Z'),
      userId: ada.id,
    });
    // Outside the window: the histogram is window-scoped like everything else.
    await seedEvent({
      type: 'page_view',
      createdAt: at('2026-08-25T09:10:00.000Z'),
      userId: ada.id,
    });

    const engagement = analyticsEngagementSchema.parse(await getOk(PATH, token));

    // `.length(24)` is asserted by the schema itself; this pins the CONTENT.
    expect(engagement.activityByHour).toHaveLength(24);
    expect(engagement.activityByHour.map((bucket) => bucket.hour)).toEqual(
      Array.from({ length: 24 }, (_value, index) => index),
    );
    expect(engagement.activityByHour[9]?.value).toBe(2);
    expect(engagement.activityByHour[23]?.value).toBe(1);
    expect(engagement.activityByHour.reduce((sum, bucket) => sum + bucket.value, 0)).toBe(3);
  });

  it('breaks events down by type, busiest first, over the CLOSED vocabulary', async () => {
    const { token } = await seedAdmin();
    const ada = await seedAnalyticsUser({ name: 'Ada' });

    await seedEvent({ type: 'page_view', createdAt: H(1), userId: ada.id });
    await seedEvent({ type: 'page_view', createdAt: H(2), userId: ada.id });
    await seedEvent({ type: 'page_view', createdAt: H(26), userId: ada.id });
    await seedEvent({ type: 'task_created', createdAt: H(3), userId: ada.id });
    // A type from a build that has been rolled back. The column is `text`, so
    // this row exists; letting it through would fail the shared enum.
    await seedEvent({ type: 'definitely_not_an_event', createdAt: H(4), userId: ada.id });
    // Outside the window.
    await seedEvent({ type: 'task_created', createdAt: D(9), userId: ada.id });

    const engagement = analyticsEngagementSchema.parse(await getOk(PATH, token));

    expect(engagement.eventsByType).toEqual([
      { type: 'page_view', count: 3 },
      { type: 'task_created', count: 1 },
    ]);
  });

  it('slices the same day into hours when asked to', async () => {
    const { token } = await seedAdmin();
    const ada = await seedAnalyticsUser({ name: 'Ada' });

    await seedEvent({
      type: 'page_view',
      createdAt: at('2026-08-20T09:15:00.000Z'),
      userId: ada.id,
    });
    await seedEvent({
      type: 'page_view',
      createdAt: at('2026-08-20T11:05:00.000Z'),
      userId: ada.id,
    });

    const engagement = analyticsEngagementSchema.parse(
      await getOk(
        `${PATHS[1]}?from=${H(9).toISOString()}&to=${H(11).toISOString()}&interval=hour`,
        token,
      ),
    );

    expect(instants(engagement.dauSeries)).toEqual([
      H(9).toISOString(),
      H(10).toISOString(),
      H(11).toISOString(),
    ]);
    expect(values(engagement.dauSeries)).toEqual([1, 0, 1]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Work
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/analytics/work', () => {
  const PATH = `${PATHS[2]}?${WINDOW}`;

  /**
   * Two tasks, both created at D0 00:00:
   *   #1 resolved at D0 12:00 → 12 hours, 2.5 points
   *   #2 resolved at D1 06:00 → 30 hours, 3 points
   * plus one that never resolved.
   */
  async function seedDelivery(): Promise<ProjectRef> {
    const org = await seedAnalyticsOrg({ name: 'Acme' });
    const project = await seedProjectRef(org.id, { name: 'Apollo' });

    await seedAnalyticsTask(project, { createdAt: D(0), resolvedAt: H(12), storyPoints: 2.5 });
    await seedAnalyticsTask(project, { createdAt: D(0), resolvedAt: H(30), storyPoints: 3 });
    await seedAnalyticsTask(project, { createdAt: H(1) });
    return project;
  }

  it('buckets creations and completions off their own columns', async () => {
    const { token } = await seedAdmin();
    await seedDelivery();

    const work = analyticsWorkSchema.parse(await getOk(PATH, token));

    expect(instants(work.tasksCreatedSeries)).toEqual(BUCKETS);
    // All three were created on D0; two of them resolved, on D0 and D1.
    expect(values(work.tasksCreatedSeries)).toEqual([3, 0, 0]);
    expect(values(work.tasksCompletedSeries)).toEqual([1, 1, 0]);
  });

  it('averages cycle time per bucket in HOURS and zero-fills the quiet ones', async () => {
    const { token } = await seedAdmin();
    await seedDelivery();

    const work = analyticsWorkSchema.parse(await getOk(PATH, token));

    // The average is over what RESOLVED in the bucket, so each bucket has one
    // sample here; the unresolved task contributes to neither.
    expect(values(work.cycleTimeSeries)).toEqual([12, 30, 0]);
  });

  it('interpolates the cycle-time percentiles over the whole window', async () => {
    const { token } = await seedAdmin();
    await seedDelivery();

    const work = analyticsWorkSchema.parse(await getOk(PATH, token));

    // `percentile_cont` over [12, 30] interpolates at f·(n−1):
    //   p50 → 0.5   → 12 + 0.50·18 = 21
    //   p90 → 0.9   → 12 + 0.90·18 = 28.2
    //   p95 → 0.95  → 12 + 0.95·18 = 29.1
    expect(work.cycleTimePercentiles).toEqual({ p50: 21, p90: 28.2, p95: 29.1 });
  });

  it('answers NULL percentiles — not zeros — when nothing resolved', async () => {
    const { token } = await seedAdmin();
    const org = await seedAnalyticsOrg();
    const project = await seedProjectRef(org.id);
    await seedAnalyticsTask(project, { createdAt: H(1) });

    const work = analyticsWorkSchema.parse(await getOk(PATH, token));

    // "Nothing finished" and "everything finished instantly" are different
    // answers, and a 0 on a p95 tile reads as the second.
    expect(work.cycleTimePercentiles).toEqual({ p50: null, p90: null, p95: null });
    expect(values(work.cycleTimeSeries)).toEqual([0, 0, 0]);
  });

  it('sums FRACTIONAL story points into the bucket the task resolved in', async () => {
    const { token } = await seedAdmin();
    await seedDelivery();

    const work = analyticsWorkSchema.parse(await getOk(PATH, token));

    expect(values(work.pointsCompletedSeries)).toEqual([2.5, 3, 0]);
  });

  it('lists EVERY live project, including the ones that did nothing', async () => {
    const { token } = await seedAdmin();
    const project = await seedDelivery();
    const idleOrg = await seedAnalyticsOrg({ name: 'Globex' });
    await seedProjectRef(idleOrg.id, { name: 'Zeus' });

    const work = analyticsWorkSchema.parse(await getOk(PATH, token));

    expect(work.byProject).toHaveLength(2);
    const [busy, idle] = work.byProject;

    expect(busy).toEqual({
      projectId: project.id,
      projectKey: project.key,
      projectName: 'Apollo',
      orgId: expect.any(String) as string,
      orgName: 'Acme',
      orgSlug: expect.any(String) as string,
      created: 3,
      completed: 2,
      // The row's own MEDIAN of [12, 30].
      cycleTimeHours: 21,
      points: 5.5,
    });
    // A project that has gone quiet is exactly the row this table exists to
    // surface, so it must be present rather than filtered out.
    expect(idle).toMatchObject({
      projectName: 'Zeus',
      created: 0,
      completed: 0,
      cycleTimeHours: null,
      points: 0,
    });
  });

  it('excludes soft-deleted tasks, projects and organizations from every figure', async () => {
    const { token } = await seedAdmin();
    const now = new Date();
    const org = await seedAnalyticsOrg({ name: 'Acme' });
    const archivedOrg = await seedAnalyticsOrg({ name: 'Gone', deletedAt: now });

    const project = await seedProjectRef(org.id, { name: 'Apollo' });
    const deletedProject = await seedProjectRef(org.id, { name: 'Dead', deletedAt: now });
    const orphanProject = await seedProjectRef(archivedOrg.id, { name: 'Orphan' });

    await seedAnalyticsTask(project, { createdAt: D(0), resolvedAt: H(12), storyPoints: 2 });
    await seedAnalyticsTask(project, {
      createdAt: D(0),
      resolvedAt: H(13),
      storyPoints: 99,
      deletedAt: now,
    });
    await seedAnalyticsTask(deletedProject, {
      createdAt: D(0),
      resolvedAt: H(14),
      storyPoints: 99,
    });
    await seedAnalyticsTask(orphanProject, { createdAt: D(0), resolvedAt: H(15), storyPoints: 99 });

    const work = analyticsWorkSchema.parse(await getOk(PATH, token));

    expect(values(work.tasksCreatedSeries)).toEqual([1, 0, 0]);
    expect(values(work.tasksCompletedSeries)).toEqual([1, 0, 0]);
    expect(values(work.pointsCompletedSeries)).toEqual([2, 0, 0]);
    expect(work.byProject.map((row) => row.projectName)).toEqual(['Apollo']);
  });

  it('counts only what falls INSIDE the window', async () => {
    const { token } = await seedAdmin();
    const org = await seedAnalyticsOrg();
    const project = await seedProjectRef(org.id);

    await seedAnalyticsTask(project, { createdAt: D(-5), resolvedAt: D(-4) });
    await seedAnalyticsTask(project, { createdAt: D(10), resolvedAt: D(11) });

    const work = analyticsWorkSchema.parse(await getOk(PATH, token));

    expect(values(work.tasksCreatedSeries)).toEqual([0, 0, 0]);
    expect(work.cycleTimePercentiles.p50).toBeNull();
    // The project row survives — it is live — but its window figures are empty.
    expect(work.byProject[0]).toMatchObject({ created: 0, completed: 0, cycleTimeHours: null });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Traffic
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/analytics/traffic', () => {
  const PATH = `${PATHS[3]}?${WINDOW}`;

  /** Four requests on D0 — one 404 and one 500 — and one on D2. D1 is silent. */
  async function seedTraffic(): Promise<void> {
    await seedRequestLog({ createdAt: H(9), durationMs: 100 });
    await seedRequestLog({ createdAt: H(10), durationMs: 200 });
    await seedRequestLog({ createdAt: H(11), durationMs: 300, statusCode: 404 });
    await seedRequestLog({ createdAt: H(12), durationMs: 400, statusCode: 500 });
    await seedRequestLog({ createdAt: H(50), durationMs: 500, statusCode: 301 });
  }

  it('sends the request count, the error count and the error RATE per bucket', async () => {
    const { token } = await seedAdmin();
    await seedTraffic();

    const traffic = analyticsTrafficSchema.parse(await getOk(PATH, token));

    expect(instants(traffic.requestsSeries)).toEqual(BUCKETS);
    expect(values(traffic.requestsSeries)).toEqual([4, 0, 1]);
    // 4xx + 5xx, per the contract — the 301 is not an error.
    expect(values(traffic.errorSeries)).toEqual([2, 0, 0]);
    // A rate and a count answer different questions; the silent bucket is 0,
    // never a division by zero.
    expect(values(traffic.errorRateSeries)).toEqual([0.5, 0, 0]);
  });

  it('interpolates the latency ladder over the whole window', async () => {
    const { token } = await seedAdmin();
    for (const durationMs of [10, 20, 30, 40]) {
      await seedRequestLog({ createdAt: H(9), durationMs });
    }

    const traffic = analyticsTrafficSchema.parse(await getOk(PATH, token));

    // `percentile_cont` over [10,20,30,40] interpolates at f·(n−1):
    //   p50 → 1.5 → 25   p90 → 2.7 → 37   p95 → 2.85 → 38.5   p99 → 2.97 → 39.7
    expect(traffic.latency).toEqual({ p50: 25, p90: 37, p95: 38.5, p99: 39.7, max: 40 });
  });

  it('answers a zeroed ladder rather than nulls on a silent window', async () => {
    const { token } = await seedAdmin();

    const traffic = analyticsTrafficSchema.parse(await getOk(PATH, token));

    expect(traffic.latency).toEqual({ p50: 0, p90: 0, p95: 0, p99: 0, max: 0 });
    expect(traffic.topEndpoints).toEqual([]);
    expect(traffic.statusBreakdown).toEqual({ '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 });
  });

  it('groups top endpoints by method + path with a 5xx-ONLY error rate', async () => {
    const { token } = await seedAdmin();
    await seedRequestLog({ createdAt: H(9), durationMs: 100 });
    await seedRequestLog({ createdAt: H(9), durationMs: 200 });
    await seedRequestLog({ createdAt: H(9), durationMs: 300, statusCode: 500 });
    await seedRequestLog({ createdAt: H(9), durationMs: 400 });
    await seedRequestLog({ createdAt: H(9), durationMs: 10, method: 'POST', path: '/api/tasks' });
    await seedRequestLog({
      createdAt: H(9),
      durationMs: 30,
      method: 'POST',
      path: '/api/tasks',
      statusCode: 404,
    });

    const traffic = analyticsTrafficSchema.parse(await getOk(PATH, token));

    // Identical to the ops page's `top-endpoints`, deliberately: the two views
    // of one table must never disagree. A 404 is the API telling the truth
    // about a missing row, so it is not an endpoint error here.
    expect(traffic.topEndpoints).toEqual([
      { method: 'GET', path: '/api/tasks/:taskId', count: 4, avgDurationMs: 250, errorRate: 0.25 },
      { method: 'POST', path: '/api/tasks', count: 2, avgDurationMs: 20, errorRate: 0 },
    ]);
  });

  it('always carries all four status classes, zero-filled', async () => {
    const { token } = await seedAdmin();
    await seedTraffic();

    const traffic = analyticsTrafficSchema.parse(await getOk(PATH, token));

    expect(traffic.statusBreakdown).toEqual({ '2xx': 2, '3xx': 1, '4xx': 1, '5xx': 1 });
  });

  it('ignores traffic outside the window entirely', async () => {
    const { token } = await seedAdmin();
    await seedRequestLog({ createdAt: D(-1), durationMs: 900, statusCode: 500 });
    await seedRequestLog({ createdAt: D(3), durationMs: 900, statusCode: 500 });

    const traffic = analyticsTrafficSchema.parse(await getOk(PATH, token));

    expect(values(traffic.requestsSeries)).toEqual([0, 0, 0]);
    expect(traffic.statusBreakdown).toEqual({ '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 });
    expect(traffic.latency.max).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Growth
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/admin/analytics/growth', () => {
  const PATH = `${PATHS[4]}?${WINDOW}`;

  it('buckets organization creations, live ones only', async () => {
    const { token } = await seedAdmin();
    await seedAnalyticsOrg({ createdAt: H(2) });
    await seedAnalyticsOrg({ createdAt: H(6) });
    await seedAnalyticsOrg({ createdAt: H(30) });
    // Soft-deleted: invisible to analytics, including to its own creation.
    await seedAnalyticsOrg({ createdAt: H(3), deletedAt: new Date() });
    // Before the window.
    await seedAnalyticsOrg({ createdAt: D(-20) });

    const growth = analyticsGrowthSchema.parse(await getOk(PATH, token));

    expect(instants(growth.orgsCreatedSeries)).toEqual(BUCKETS);
    expect(values(growth.orgsCreatedSeries)).toEqual([2, 1, 0]);
  });

  it('buckets invites by the instant each column records', async () => {
    const { token } = await seedAdmin();
    const org = await seedAnalyticsOrg({ createdAt: D(-40) });

    await seedAnalyticsInvite(org.id, { createdAt: H(1), acceptedAt: H(2) });
    await seedAnalyticsInvite(org.id, { createdAt: H(3), acceptedAt: H(28) });
    await seedAnalyticsInvite(org.id, { createdAt: H(29) });
    // An invite sent before the window but accepted inside it: the two series
    // read two different columns and must disagree about this row.
    await seedAnalyticsInvite(org.id, { createdAt: D(-2), acceptedAt: H(52) });

    const growth = analyticsGrowthSchema.parse(await getOk(PATH, token));

    expect(values(growth.invitesSentSeries)).toEqual([2, 1, 0]);
    expect(values(growth.invitesAcceptedSeries)).toEqual([1, 1, 1]);
  });

  it('reads the acceptance rate as a COHORT rate over the invites sent in the window', async () => {
    const { token } = await seedAdmin();
    const org = await seedAnalyticsOrg({ createdAt: D(-40) });

    await seedAnalyticsInvite(org.id, { createdAt: H(1), acceptedAt: H(2) });
    // Accepted long AFTER the window closes: still an accepted invite from this
    // cohort, which is why the rate is not the ratio of the two series.
    await seedAnalyticsInvite(org.id, { createdAt: H(3), acceptedAt: D(40) });
    await seedAnalyticsInvite(org.id, { createdAt: H(5) });
    await seedAnalyticsInvite(org.id, { createdAt: H(7) });
    // Outside the cohort entirely.
    await seedAnalyticsInvite(org.id, { createdAt: D(-9), acceptedAt: D(-8) });

    const growth = analyticsGrowthSchema.parse(await getOk(PATH, token));

    expect(growth.acceptanceRate).toBe(0.5);
    expect(values(growth.invitesAcceptedSeries)).toEqual([1, 0, 0]);
  });

  it('answers 0 rather than NaN when no invites were sent', async () => {
    const { token } = await seedAdmin();

    const growth = analyticsGrowthSchema.parse(await getOk(PATH, token));

    expect(growth.acceptanceRate).toBe(0);
    expect(growth.byOrg).toEqual([]);
  });

  it('ignores invites belonging to a soft-deleted organization', async () => {
    const { token } = await seedAdmin();
    const archived = await seedAnalyticsOrg({ createdAt: D(-40), deletedAt: new Date() });
    await seedAnalyticsInvite(archived.id, { createdAt: H(1), acceptedAt: H(2) });

    const growth = analyticsGrowthSchema.parse(await getOk(PATH, token));

    expect(values(growth.invitesSentSeries)).toEqual([0, 0, 0]);
    expect(growth.acceptanceRate).toBe(0);
  });

  it('sizes every live org and stamps its last activity', async () => {
    const { token } = await seedAdmin();
    const now = new Date();
    const ada = await seedAnalyticsUser({ name: 'Ada' });
    const bob = await seedAnalyticsUser({ name: 'Bob' });

    const acme = await seedAnalyticsOrg({ name: 'Acme', createdAt: D(-40) });
    const untouched = await seedAnalyticsOrg({ name: 'Zenith', createdAt: D(-40) });
    await seedAnalyticsOrg({ name: 'Gone', createdAt: D(-40), deletedAt: now });

    await seedMembership(acme.id, ada.id);
    await seedMembership(acme.id, bob.id);
    await seedMembership(untouched.id, ada.id);

    const project = await seedProjectRef(acme.id);
    await seedProjectRef(acme.id, { deletedAt: now });
    await seedAnalyticsTask(project, { createdAt: H(1) });
    await seedAnalyticsTask(project, { createdAt: H(2) });
    await seedAnalyticsTask(project, { createdAt: H(3), deletedAt: now });

    await seedEvent({ type: 'page_view', createdAt: H(4), userId: ada.id, orgId: acme.id });
    await seedEvent({ type: 'task_created', createdAt: H(20), userId: ada.id, orgId: acme.id });

    const growth = analyticsGrowthSchema.parse(await getOk(PATH, token));

    expect(growth.byOrg).toHaveLength(2);
    // Newest activity first; an org nobody has ever touched sorts last with a
    // NULL stamp rather than being filtered out.
    expect(growth.byOrg[0]).toEqual({
      orgId: acme.id,
      orgName: 'Acme',
      orgSlug: acme.slug,
      memberCount: 2,
      projectCount: 1,
      taskCount: 2,
      lastActivityAt: H(20).toISOString(),
    });
    expect(growth.byOrg[1]).toMatchObject({
      orgName: 'Zenith',
      memberCount: 1,
      projectCount: 0,
      taskCount: 0,
      lastActivityAt: null,
    });
  });

  it('keeps byOrg all-time while the series stay window-scoped', async () => {
    const { token } = await seedAdmin();
    const ada = await seedAnalyticsUser({ name: 'Ada' });
    const org = await seedAnalyticsOrg({ name: 'Acme', createdAt: D(-40) });
    const project = await seedProjectRef(org.id);

    // Everything here happened long before the window, so the series are empty…
    await seedAnalyticsTask(project, { createdAt: D(-30) });
    await seedEvent({ type: 'page_view', createdAt: D(-30), userId: ada.id, orgId: org.id });

    const growth = analyticsGrowthSchema.parse(await getOk(PATH, token));

    expect(values(growth.orgsCreatedSeries)).toEqual([0, 0, 0]);
    // …while the table still reports what the deployment actually holds.
    expect(growth.byOrg[0]).toMatchObject({
      taskCount: 1,
      lastActivityAt: D(-30).toISOString(),
    });
  });
});
