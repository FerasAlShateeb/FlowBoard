/**
 * `GET /api/admin/projects` — the cross-organization project list.
 *
 * This endpoint is the inverse of every other project read in the product:
 * `/projects/*` resolves a project, then its org, then the caller's membership,
 * and refuses anything else. This one deliberately crosses all of that, which is
 * why the guard is asserted first and why the shape carries the ORGANIZATION on
 * every row.
 *
 * The rest of the suite is about the four DERIVED columns — members, tasks, open
 * tasks, last activity — because they are what makes the page worth opening, and
 * a correlated subquery that resolves against the wrong table returns a
 * plausible zero without erroring (see the header of
 * `services/admin-projects.service.ts`). Every count is therefore asserted
 * against an arrangement where the right answer is NOT zero and NOT the same as
 * its neighbours.
 */
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { activity, closeDb, db, organizations, projects } from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import {
  addProjectMember,
  bearer,
  createProject,
  createTask,
  createUser,
  type TestProject,
  type TestUser,
} from './fixtures';
import { buildInstanceAdminApp } from './instance-admin-test-app';

const app = buildInstanceAdminApp();

beforeAll(async () => {
  await ensureTestDb();
});

beforeEach(async () => {
  await truncateAllTables();
});

afterAll(async () => {
  await closeDb();
});

async function seedOrg(
  name: string,
  slug: string,
  options: { deleted?: boolean } = {},
): Promise<{ id: string; name: string; slug: string }> {
  const [row] = await db
    .insert(organizations)
    .values({ name, slug, deletedAt: options.deleted === true ? new Date() : null })
    .returning({ id: organizations.id });
  if (!row) throw new Error('org insert returned no row');
  return { id: row.id, name, slug };
}

async function setLead(projectId: string, userId: string): Promise<void> {
  await db.update(projects).set({ leadId: userId }).where(eq(projects.id, projectId));
}

/** One audit row, at a chosen instant — `lastActivityAt` is `max(created_at)`. */
async function seedActivity(projectId: string, at: Date): Promise<void> {
  await db.insert(activity).values({ projectId, action: 'task.created', createdAt: at });
}

const list = (user: TestUser, query = '') =>
  request(app).get(`/api/admin/projects${query}`).set('Authorization', bearer(user));

interface Row {
  projectId: string;
  key: string;
  name: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  leadName: string | null;
  memberCount: number;
  taskCount: number;
  openTaskCount: number;
  lastActivityAt: string | null;
  deletedAt: string | null;
}

function keys(body: { data: Row[] }): string[] {
  return body.data.map((row) => row.key);
}

describe('the guard', () => {
  it('401s without a session', async () => {
    expect((await request(app).get('/api/admin/projects')).status).toBe(401);
  });

  it('403s a signed-in non-admin, even one who leads a project', async () => {
    const user = await createUser();
    const org = await seedOrg('Acme', 'acme');
    const project = await createProject(org.id, { key: 'ACME' });
    await setLead(project.id, user.id);

    const res = await list(user);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });
});

describe('the row shape', () => {
  it('denormalizes the organization onto every project, across tenants', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const acme = await seedOrg('Acme Corporation', 'acme');
    const globex = await seedOrg('Globex Corp', 'globex');
    await createProject(acme.id, { key: 'FLOW', name: 'FlowBoard Web' });
    await createProject(globex.id, { key: 'GX', name: 'Globex Storefront' });

    const res = await list(root);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const rows: Row[] = res.body.data;
    const flow = rows.find((row) => row.key === 'FLOW');
    expect(flow).toMatchObject({
      name: 'FlowBoard Web',
      orgId: acme.id,
      orgName: 'Acme Corporation',
      orgSlug: 'acme',
      deletedAt: null,
    });
  });

  it('carries the lead NAME, and null for a project with no lead', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const lead = await createUser({ name: 'Maya Chen' });
    const org = await seedOrg('Acme', 'acme');
    const led = await createProject(org.id, { key: 'LED' });
    await createProject(org.id, { key: 'UNLED' });
    await setLead(led.id, lead.id);

    const rows: Row[] = (await list(root)).body.data;

    expect(rows.find((row) => row.key === 'LED')?.leadName).toBe('Maya Chen');
    expect(rows.find((row) => row.key === 'UNLED')?.leadName).toBeNull();
  });

  it('counts members, live tasks and OPEN tasks separately', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const org = await seedOrg('Acme', 'acme');
    const project = await createProject(org.id, { key: 'FLOW' });
    const [todo, , done] = project.statusIds;

    await addProjectMember(project.id, root.id, 'admin');
    await addProjectMember(project.id, (await createUser()).id, 'member');
    await createTask(project.id, todo);
    await createTask(project.id, todo);
    await createTask(project.id, done);

    const [row] = (await list(root)).body.data as Row[];

    expect(row).toMatchObject({ memberCount: 2, taskCount: 3, openTaskCount: 2 });
  });

  it('never counts one project against its neighbour', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const org = await seedOrg('Acme', 'acme');
    const busy = await createProject(org.id, { key: 'BUSY' });
    await createProject(org.id, { key: 'QUIET' });
    await createTask(busy.id, busy.statusIds[0]);
    await createTask(busy.id, busy.statusIds[0]);

    const rows: Row[] = (await list(root)).body.data;

    expect(rows.find((row) => row.key === 'BUSY')?.taskCount).toBe(2);
    expect(rows.find((row) => row.key === 'QUIET')?.taskCount).toBe(0);
  });

  it('reports the newest activity instant, and null when nothing has happened', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const org = await seedOrg('Acme', 'acme');
    const busy = await createProject(org.id, { key: 'BUSY' });
    await createProject(org.id, { key: 'NEW' });
    await seedActivity(busy.id, new Date('2026-01-01T00:00:00Z'));
    await seedActivity(busy.id, new Date('2026-03-01T12:00:00Z'));

    const rows: Row[] = (await list(root)).body.data;

    expect(rows.find((row) => row.key === 'BUSY')?.lastActivityAt).toBe('2026-03-01T12:00:00.000Z');
    expect(rows.find((row) => row.key === 'NEW')?.lastActivityAt).toBeNull();
  });
});

describe('archived rows', () => {
  it('hides archived projects by default', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const org = await seedOrg('Acme', 'acme');
    await createProject(org.id, { key: 'LIVE' });
    await createProject(org.id, { key: 'GONE', deleted: true });

    expect(keys((await list(root)).body)).toEqual(['LIVE']);
  });

  it('hides the projects of an archived ORGANIZATION too', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const live = await seedOrg('Live', 'live');
    const gone = await seedOrg('Gone', 'gone', { deleted: true });
    await createProject(live.id, { key: 'LIVE' });
    await createProject(gone.id, { key: 'ORPHAN' });

    expect(keys((await list(root)).body)).toEqual(['LIVE']);
  });

  it('includeArchived=1 returns both, with deletedAt set on the archived one', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const live = await seedOrg('Live', 'live');
    const goneOrg = await seedOrg('Gone', 'gone', { deleted: true });
    await createProject(live.id, { key: 'LIVE' });
    await createProject(live.id, { key: 'GONE', deleted: true });
    await createProject(goneOrg.id, { key: 'ORPHAN' });

    const res = await list(root, '?includeArchived=1&sort=name:asc');
    const rows: Row[] = res.body.data;

    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.key === 'GONE')?.deletedAt).toEqual(expect.any(String));
    // A live project inside an archived org is not itself archived — the row is
    // honest about that, and the ORG column is what explains why it is hidden by
    // default.
    expect(rows.find((row) => row.key === 'ORPHAN')?.deletedAt).toBeNull();
  });
});

describe('filters', () => {
  it('narrows to one organization', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const acme = await seedOrg('Acme', 'acme');
    const globex = await seedOrg('Globex', 'globex');
    await createProject(acme.id, { key: 'FLOW' });
    await createProject(globex.id, { key: 'GX' });

    expect(keys((await list(root, `?orgId=${acme.id}`)).body)).toEqual(['FLOW']);
  });

  it('422s an orgId that is not a uuid', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    expect((await list(root, '?orgId=acme')).status).toBe(422);
  });

  it('matches `q` against the project name', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const org = await seedOrg('Acme', 'acme');
    await createProject(org.id, { key: 'FLOW', name: 'FlowBoard Web' });
    await createProject(org.id, { key: 'CORE', name: 'Core Platform' });

    expect(keys((await list(root, '?q=platform')).body)).toEqual(['CORE']);
  });

  it('matches `q` against the project KEY, case-insensitively', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const org = await seedOrg('Acme', 'acme');
    await createProject(org.id, { key: 'FLOW', name: 'FlowBoard Web' });
    await createProject(org.id, { key: 'CORE', name: 'Core Platform' });

    expect(keys((await list(root, '?q=flo')).body)).toEqual(['FLOW']);
  });
});

describe('sorting', () => {
  it('sorts by name in both directions', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const org = await seedOrg('Acme', 'acme');
    await createProject(org.id, { key: 'BETA', name: 'Beta' });
    await createProject(org.id, { key: 'ALPHA', name: 'Alpha' });

    expect(keys((await list(root, '?sort=name:asc')).body)).toEqual(['ALPHA', 'BETA']);
    expect(keys((await list(root, '?sort=name:desc')).body)).toEqual(['BETA', 'ALPHA']);
  });

  it('sorts by ORGANIZATION name, not by its opaque id', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const zeta = await seedOrg('Zeta', 'zeta');
    const alpha = await seedOrg('Alpha', 'alpha');
    await createProject(zeta.id, { key: 'Z1', name: 'Z One' });
    await createProject(alpha.id, { key: 'A1', name: 'A One' });

    expect(keys((await list(root, '?sort=org:asc')).body)).toEqual(['A1', 'Z1']);
  });

  it('sorts by task count', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const org = await seedOrg('Acme', 'acme');
    const many = await createProject(org.id, { key: 'MANY' });
    const few = await createProject(org.id, { key: 'FEW' });
    await createTask(many.id, many.statusIds[0]);
    await createTask(many.id, many.statusIds[0]);
    await createTask(few.id, few.statusIds[0]);

    expect(keys((await list(root, '?sort=taskCount:desc')).body)).toEqual(['MANY', 'FEW']);
    expect(keys((await list(root, '?sort=taskCount:asc')).body)).toEqual(['FEW', 'MANY']);
  });

  it('puts never-active projects LAST whichever way lastActivityAt is sorted', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const org = await seedOrg('Acme', 'acme');
    const older = await createProject(org.id, { key: 'OLDER', name: 'Older' });
    const newer = await createProject(org.id, { key: 'NEWER', name: 'Newer' });
    await createProject(org.id, { key: 'SILENT', name: 'Silent' });
    await seedActivity(older.id, new Date('2026-01-01T00:00:00Z'));
    await seedActivity(newer.id, new Date('2026-06-01T00:00:00Z'));

    expect(keys((await list(root, '?sort=lastActivityAt:desc')).body)).toEqual([
      'NEWER',
      'OLDER',
      'SILENT',
    ]);
    // Ascending too: "never" is the absence of an answer, not the oldest one.
    expect(keys((await list(root, '?sort=lastActivityAt:asc')).body)).toEqual([
      'OLDER',
      'NEWER',
      'SILENT',
    ]);
  });

  it('defaults to most-recently-active first, silent projects last', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const org = await seedOrg('Acme', 'acme');
    const busy = await createProject(org.id, { key: 'BUSY', name: 'Busy' });
    await createProject(org.id, { key: 'SILENT', name: 'Silent' });
    await seedActivity(busy.id, new Date('2026-06-01T00:00:00Z'));

    expect(keys((await list(root)).body)).toEqual(['BUSY', 'SILENT']);
  });

  it('422s a sort field that is not on the closed list', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const res = await list(root, '?sort=openTaskCount:desc');
    expect(res.status).toBe(422);
  });
});

describe('pagination', () => {
  it('carries the meta block and slices the page', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const org = await seedOrg('Acme', 'acme');
    const made: TestProject[] = [];
    for (let i = 0; i < 5; i += 1) {
      made.push(
        await createProject(org.id, { key: `P${String(i)}`, name: `Project ${String(i)}` }),
      );
    }

    const res = await list(root, '?page=2&pageSize=2&sort=name:asc');

    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toEqual({ page: 2, pageSize: 2, total: 5, totalPages: 3 });
    expect(made).toHaveLength(5);
  });

  it('defaults to page 1 of 25', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    expect((await list(root)).body.meta).toMatchObject({ page: 1, pageSize: 25 });
  });

  it('422s a pageSize above the hard ceiling', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    expect((await list(root, '?pageSize=500')).status).toBe(422);
  });

  it('counts the FILTERED total, not the whole platform', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const acme = await seedOrg('Acme', 'acme');
    const globex = await seedOrg('Globex', 'globex');
    await createProject(acme.id, { key: 'A1' });
    await createProject(acme.id, { key: 'A2' });
    await createProject(globex.id, { key: 'G1' });

    expect((await list(root, `?orgId=${acme.id}`)).body.meta.total).toBe(2);
  });
});
