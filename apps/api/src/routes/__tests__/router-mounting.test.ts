/**
 * WP2.5 integration gate: every Wave-2 router is REACHABLE through the real
 * `createApp()`, and nothing shadows anything.
 *
 * WHY THIS SUITE EXISTS SEPARATELY FROM THE DOMAIN SUITES. Each work package's
 * tests build their own minimal app (`identity-test-app.ts`, `fixtures.ts`,
 * `task-domain.fixtures.ts`) so a suite fails for its own package's reasons —
 * which is right, and which also means NONE of them exercise the one thing that
 * can only go wrong once all thirteen routers share a single mount tree:
 * ordering.
 *
 * THREE OVERLAPS ARE REAL, and each is asserted below:
 *
 *  1. `/orgs/:orgId/search` belongs to `searchRouter` (root-stacked), but
 *     `orgsRouter` owns `/orgs` and is mounted FIRST. It has no `/:orgId/search`
 *     route, so the request must fall through.
 *  2. `/projects/:projectId/{tasks,sprints,reports}` belong to root-stacked
 *     routers, but `projectsRouter` owns `/projects` and mounts `workflowRouter`
 *     on the bare `/:projectId`. That sub-router claims only `/statuses` and
 *     `/transitions`.
 *  3. `/admin/users`, `/admin/telemetry` and `/admin/logs` are THREE routers on
 *     one prefix (WP4.7 added the middle one). ROUND 2 makes it SIX, adding
 *     `/admin/analytics`, `/admin/projects` and `/admin/settings` — see the
 *     Round 2 block at the bottom of this file.
 *
 * WAVE 4 ALSO ADDED A GUARD ASYMMETRY worth its own assertion: the telemetry
 * contract is two routers with opposite audiences — `/admin/telemetry/*` is
 * global-admin, `/telemetry/events` is any signed-in user. Mounting the ingest
 * half under `/admin` (or the read half outside it) would be a privilege bug
 * that no unit test in `admin-telemetry.*` can see, because both halves pass
 * their own suites either way. The pair of tests below is where that is caught.
 *
 * AND ONE NEGATIVE: an unmatched URL must still produce the 404 ENVELOPE. This
 * is not pedantry — the root-stacked routers originally applied `requireAuth`
 * router-wide, which turned every unknown `/api/*` path into a 401 because the
 * guard ran before Express could discover there was no route. The guards are now
 * scoped to the prefixes each router owns (see `tasks.routes.ts`), and this is
 * the assertion that keeps them that way.
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Express } from 'express';

import { createApp } from '../../app';
import { closeDb, db, orgMembers } from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import { seedTask, seedWorld, type World } from './task-domain.fixtures';
import { signAccessToken } from '../../utils/jwt';

let app: Express;
let world: World;
let taskId: string;

function auth(userId: string, isGlobalAdmin = false): string {
  return `Bearer ${signAccessToken({ sub: userId, tokenVersion: 0, isGlobalAdmin })}`;
}

beforeAll(async () => {
  await ensureTestDb();
  app = createApp();
});

beforeEach(async () => {
  await truncateAllTables();
  world = await seedWorld();
  taskId = await seedTask(world, { title: 'Mounted' });
});

afterAll(async () => {
  await closeDb();
});

describe('unmatched URLs', () => {
  it('answer with the 404 envelope, not a guard 401', async () => {
    const response = await request(app).get('/api/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, error: { code: 'not_found' } });
  });

  it('stay 404 even under a prefix a router owns half of', async () => {
    // `/orgs` is `orgsRouter`'s, but nothing answers `/orgs/.../nope`.
    const response = await request(app)
      .get(`/api/orgs/${world.orgId}/nope`)
      .set('Authorization', auth(world.admin.id));

    expect(response.status).toBe(404);
  });
});

describe('identity routers', () => {
  it('mounts authRouter at /api/auth', async () => {
    const response = await request(app).get('/api/auth/me');
    expect(response.status).toBe(401);
  });

  it('mounts invitesRouter at /api/orgs/:orgId/invites, ahead of orgsRouter', async () => {
    // The invites router guards at the ORG-admin floor, and `seedWorld` makes
    // its four accounts org MEMBERS (their differences are project roles). A
    // 403 here would prove nothing about mounting, so promote first.
    await db
      .update(orgMembers)
      .set({ role: 'admin' })
      .where(and(eq(orgMembers.orgId, world.orgId), eq(orgMembers.userId, world.admin.id)));

    const response = await request(app)
      .get(`/api/orgs/${world.orgId}/invites`)
      .set('Authorization', auth(world.admin.id));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it('mounts adminUsersRouter, adminTelemetryRouter and adminLogsRouter on the SAME /admin prefix', async () => {
    const token = auth(world.admin.id, true);

    const users = await request(app).get('/api/admin/users').set('Authorization', token);
    expect(users.status).toBe(200);

    const telemetry = await request(app)
      .get('/api/admin/telemetry/overview')
      .set('Authorization', token);
    expect(telemetry.status).toBe(200);

    // Neither narrower mount swallows the broader one's route.
    const logs = await request(app).get('/api/admin/logs').set('Authorization', token);
    expect(logs.status).toBe(200);
  });

  it('mounts notificationsRouter at /api/notifications, guarded but not role-gated', async () => {
    // A plain project MEMBER — the bell is about the caller's own rows, so
    // there is no role floor to clear.
    const token = auth(world.member.id);

    const list = await request(app).get('/api/notifications').set('Authorization', token);
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);

    const count = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', token);
    expect(count.status).toBe(200);
    expect(count.body.data).toEqual({ count: 0 });

    // The literal `/unread-count` segment is not shadowed by `/:notificationId`
    // — that route is POST-only and two segments deep, but assert the negative
    // anyway, since the two mounts are one typo apart.
    expect((await request(app).get('/api/notifications')).status).toBe(401);
  });
});

describe('org and project routers', () => {
  it('mounts orgsRouter and its team / project sub-routers', async () => {
    const token = auth(world.admin.id);

    expect((await request(app).get('/api/orgs').set('Authorization', token)).status).toBe(200);
    expect(
      (await request(app).get(`/api/orgs/${world.orgId}/teams`).set('Authorization', token)).status,
    ).toBe(200);
    expect(
      (await request(app).get(`/api/orgs/${world.orgId}/projects`).set('Authorization', token))
        .status,
    ).toBe(200);
  });

  it('mounts projectsRouter and its members / labels / activity / workflow sub-routers', async () => {
    const token = auth(world.admin.id);
    const base = `/api/projects/${world.projectId}`;

    for (const path of [base, `${base}/members`, `${base}/labels`, `${base}/activity`]) {
      expect((await request(app).get(path).set('Authorization', token)).status).toBe(200);
    }

    // The workflow router is mounted on the BARE `/:projectId`, which is the
    // mount most likely to swallow a sibling.
    expect((await request(app).get(`${base}/statuses`).set('Authorization', token)).status).toBe(
      200,
    );
    expect((await request(app).get(`${base}/transitions`).set('Authorization', token)).status).toBe(
      200,
    );
  });
});

describe('the six root-stacked task-domain routers', () => {
  it('reaches tasks on BOTH of its nestings', async () => {
    const token = auth(world.member.id);

    expect(
      (await request(app).get(`/api/projects/${world.projectId}/tasks`).set('Authorization', token))
        .status,
    ).toBe(200);
    expect(
      (await request(app).get(`/api/tasks/${taskId}`).set('Authorization', token)).status,
    ).toBe(200);
  });

  it('reaches comments, attachments and sprints past the /projects and /tasks mounts', async () => {
    const token = auth(world.member.id);

    expect(
      (await request(app).get(`/api/tasks/${taskId}/comments`).set('Authorization', token)).status,
    ).toBe(200);
    expect(
      (await request(app).get(`/api/tasks/${taskId}/attachments`).set('Authorization', token))
        .status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`/api/projects/${world.projectId}/sprints`)
          .set('Authorization', token)
      ).status,
    ).toBe(200);
  });

  it('reaches reports past workflowRouter on the bare /:projectId mount', async () => {
    const response = await request(app)
      .get(`/api/projects/${world.projectId}/reports/velocity`)
      .set('Authorization', auth(world.member.id));

    expect(response.status).toBe(200);
  });

  /**
   * THE ONE THAT NEARLY BROKE. `orgsRouter` is mounted at `/orgs` BEFORE the
   * root-stacked six, and it applies `requireAuth` router-wide. It has no
   * `/:orgId/search` route, so Express must fall through to `searchRouter` —
   * the request passes through two `requireAuth` calls and one route.
   */
  it('reaches /orgs/:orgId/search THROUGH the earlier /orgs mount', async () => {
    const response = await request(app)
      .get(`/api/orgs/${world.orgId}/search`)
      .query({ q: 'Mounted' })
      .set('Authorization', auth(world.member.id));

    expect(response.status).toBe(200);
    expect(response.body.data.results).toHaveLength(1);
    expect(response.body.data.results[0].taskId).toBe(taskId);
  });
});

describe('the two telemetry routers keep their opposite guards', () => {
  it('serves the admin aggregations to a global admin and 403s a plain member', async () => {
    expect(
      (
        await request(app)
          .get('/api/admin/telemetry/overview')
          .set('Authorization', auth(world.admin.id, true))
      ).status,
    ).toBe(200);

    expect(
      (
        await request(app)
          .get('/api/admin/telemetry/overview')
          .set('Authorization', auth(world.member.id))
      ).status,
    ).toBe(403);
  });

  it('accepts a client event at /api/telemetry/events from a NON-admin', async () => {
    const response = await request(app)
      .post('/api/telemetry/events')
      .set('Authorization', auth(world.member.id))
      .send({ type: 'page_view', payload: { path: '/board' } });

    expect(response.status).toBe(204);
  });

  it('still narrows the ingest route to the client-permitted event types', async () => {
    // Proves the mount carries the router's `validate()`, not just the path.
    const response = await request(app)
      .post('/api/telemetry/events')
      .set('Authorization', auth(world.member.id))
      .send({ type: 'auth_login' });

    expect(response.status).toBe(422);
  });
});

describe('foundation routes still answer', () => {
  it('serves /api/health publicly', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
  });
});

/**
 * ── ROUND 2: the three routers W1.0 pre-mounted ─────────────────────────────
 *
 * `/admin/analytics`, `/admin/projects` and `/admin/settings` are mounted with
 * their guards from the day the seam was created; W1.1 and W1.2 filled in the
 * handlers behind them (the shared `501 not_implemented` body they carried in
 * between is gone, deleted with its last call site in W3.1). This block asserts
 * the two things that were TRUE IN BOTH STATES, so it did not have to be
 * rewritten when the bodies landed — and so nobody had to open this
 * stitch-adjacent file mid-wave:
 *
 *   - the GUARD contract: 401 with no session, 403 for a non-admin. That is
 *     what the router-wide `use()` buys, and it is exactly what a per-route
 *     guard added later would be able to lose.
 *   - REACHABILITY: an authenticated global admin gets anything except a 404.
 *     A 404 is what an unmounted path answers, and — because an empty router
 *     falls straight through to the 404 handler — it is also what a router
 *     mounted but never wired would answer. Asserting `not 404` distinguishes
 *     "the seam works" from "the seam was never connected" while staying true
 *     across the 501 → 200 transition.
 *
 * `/instance/config` rides along here because it is the ODD GUARD in the set:
 * it is `requireAuth` only, deliberately, since every signed-in session reads it
 * on boot. Mounting it under `/admin` (or giving it the admin guard by copy and
 * paste) would break the app for every non-admin — a bug no unit test in the
 * instance-settings suites can see, because that module passes its own tests
 * either way. This is where it is caught, exactly as the telemetry pair above.
 */
describe('the Round 2 instance-admin and analytics mounts', () => {
  const ADMIN_PATHS = [
    '/api/admin/analytics/overview',
    '/api/admin/analytics/engagement',
    '/api/admin/analytics/work',
    '/api/admin/analytics/traffic',
    '/api/admin/analytics/growth',
    '/api/admin/projects',
    '/api/admin/settings',
  ];

  it('reaches every global-admin path — none of them 404s', async () => {
    const token = auth(world.admin.id, true);

    for (const path of ADMIN_PATHS) {
      const response = await request(app).get(path).set('Authorization', token);
      expect(response.status, path).not.toBe(404);
    }
  });

  it('401s every one of them without a session', async () => {
    for (const path of ADMIN_PATHS) {
      expect((await request(app).get(path)).status, path).toBe(401);
    }
  });

  it('403s every one of them for a signed-in non-admin', async () => {
    const token = auth(world.member.id);

    for (const path of ADMIN_PATHS) {
      const response = await request(app).get(path).set('Authorization', token);
      expect(response.status, path).toBe(403);
    }
  });

  it('keeps the narrow /admin mounts ahead of the bare one', async () => {
    // `adminLogsRouter` owns the bare `/admin`; if it ever answered first, the
    // five narrow prefixes above would 404 and `/admin/logs` would still pass.
    const token = auth(world.admin.id, true);

    expect((await request(app).get('/api/admin/logs').set('Authorization', token)).status).toBe(
      200,
    );
    expect((await request(app).get('/api/admin/users').set('Authorization', token)).status).toBe(
      200,
    );
  });

  it('serves /api/instance/config to a NON-admin — its guard is auth, not admin', async () => {
    const response = await request(app)
      .get('/api/instance/config')
      .set('Authorization', auth(world.member.id));

    expect(response.status).not.toBe(404);
    expect(response.status).not.toBe(403);
  });

  it('still refuses /api/instance/config without a session', async () => {
    expect((await request(app).get('/api/instance/config')).status).toBe(401);
  });
});
