/**
 * `GET /api/orgs` under its Round 2 query string, and `POST /api/orgs/:orgId/restore`.
 *
 * The existing `orgs.routes.test.ts` covers the role matrix and the last-admin
 * rule. This suite covers the two things Round 2 added, both of which are about
 * WHO SEES WHAT rather than about who may write:
 *
 *  - **`?includeDeleted` switches the response SHAPE**, and is global-admin only.
 *    Archived organizations are what the restore flow acts on; a member being
 *    able to enumerate them is an information leak a zod schema cannot prevent,
 *    because a schema does not know who is asking.
 *  - **`?scope=member` turns the global-admin branch OFF.** This is the server
 *    half of view-as-member: an admin who has switched into a member's view must
 *    get the list a member would get, from the server, because client-side
 *    filtering stops being true the moment a page refetches.
 *
 * Restore is asserted through all three of its answers (404 / 409 / 200) plus
 * the property that matters afterwards: the organization RESOLVES again.
 */
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, db, organizations } from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import { addOrgMember, bearer, createProject, createUser, type TestUser } from './fixtures';
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

/** An organization with a chosen name AND slug — both are `?q` targets. */
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

const listOrgs = (user: TestUser, query = '') =>
  request(app).get(`/api/orgs${query}`).set('Authorization', bearer(user));

const restore = (user: TestUser, orgId: string) =>
  request(app).post(`/api/orgs/${orgId}/restore`).set('Authorization', bearer(user));

describe('GET /api/orgs?q=', () => {
  it('filters a member list on a name fragment, case-insensitively', async () => {
    const user = await createUser();
    const acme = await seedOrg('Acme Corporation', 'acme');
    const globex = await seedOrg('Globex Corp', 'globex');
    await addOrgMember(acme.id, user.id, 'member');
    await addOrgMember(globex.id, user.id, 'member');

    const res = await listOrgs(user, '?q=ACME');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].slug).toBe('acme');
  });

  it('filters on the SLUG too — an admin chasing a ticket has the URL, not the name', async () => {
    const user = await createUser();
    const org = await seedOrg('Northwind Traders', 'nwt');
    await addOrgMember(org.id, user.id, 'member');
    const other = await seedOrg('Southwind', 'swd');
    await addOrgMember(other.id, user.id, 'member');

    const res = await listOrgs(user, '?q=nwt');

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Northwind Traders');
  });

  it('filters the global-admin list, which has no membership rows to filter on', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    await seedOrg('Acme Corporation', 'acme');
    await seedOrg('Globex Corp', 'globex');

    const res = await listOrgs(root, '?q=globe');

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].slug).toBe('globex');
    expect(res.body.data[0].role).toBe('admin');
  });

  it('422s a `q` longer than the contract allows', async () => {
    const user = await createUser();
    const res = await listOrgs(user, `?q=${'x'.repeat(121)}`);
    expect(res.status).toBe(422);
  });
});

describe('GET /api/orgs?scope=member', () => {
  it('narrows a global admin to the orgs they are really in', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const mine = await seedOrg('Mine', 'mine');
    await seedOrg('Theirs', 'theirs');
    await addOrgMember(mine.id, root.id, 'member');

    const wide = await listOrgs(root);
    const narrow = await listOrgs(root, '?scope=member');

    expect(wide.body.data).toHaveLength(2);
    expect(narrow.body.data).toHaveLength(1);
    expect(narrow.body.data[0].slug).toBe('mine');
  });

  it('reports the REAL role from the membership row, not a synthetic admin', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const org = await seedOrg('Mine', 'mine');
    await addOrgMember(org.id, root.id, 'member');

    expect((await listOrgs(root)).body.data[0].role).toBe('admin');
    expect((await listOrgs(root, '?scope=member')).body.data[0].role).toBe('member');
  });

  it('returns an empty list for a global admin who belongs to nothing', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    await seedOrg('Theirs', 'theirs');

    expect((await listOrgs(root, '?scope=member')).body.data).toEqual([]);
  });

  it('is a no-op for a plain member — the branch it skips was never taken', async () => {
    const user = await createUser();
    const org = await seedOrg('Mine', 'mine');
    await addOrgMember(org.id, user.id, 'admin');

    const res = await listOrgs(user, '?scope=member');

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].role).toBe('admin');
  });

  it('422s an unknown scope rather than ignoring it', async () => {
    const res = await listOrgs(await createUser(), '?scope=everything');
    expect(res.status).toBe(422);
  });

  it('combines with `q`', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const acme = await seedOrg('Acme', 'acme');
    const globex = await seedOrg('Globex', 'globex');
    await addOrgMember(acme.id, root.id, 'member');
    await addOrgMember(globex.id, root.id, 'member');

    const res = await listOrgs(root, '?scope=member&q=acme');

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].slug).toBe('acme');
  });
});

describe('GET /api/orgs?includeDeleted=1', () => {
  it('hides archived organizations from a global admin by default', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    await seedOrg('Live', 'live');
    await seedOrg('Archived', 'archived', { deleted: true });

    const res = await listOrgs(root);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].slug).toBe('live');
  });

  it('returns ADMIN rows — deletedAt and counts, and no synthetic role', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const live = await seedOrg('Live', 'live');
    await seedOrg('Archived', 'archived', { deleted: true });
    await addOrgMember(live.id, root.id, 'admin');
    await createProject(live.id);

    const res = await listOrgs(root, '?includeDeleted=1');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);

    const rows: { slug: string; deletedAt: string | null }[] = res.body.data;
    const archived = rows.find((row) => row.slug === 'archived');
    const liveRow = res.body.data.find((row: { slug: string }) => row.slug === 'live');

    expect(archived?.deletedAt).toEqual(expect.any(String));
    expect(liveRow).toMatchObject({ deletedAt: null, memberCount: 1, projectCount: 1 });
    expect(liveRow).not.toHaveProperty('role');
  });

  it('403s a plain member who asks for archived rows', async () => {
    const user = await createUser();
    await seedOrg('Archived', 'archived', { deleted: true });

    const res = await listOrgs(user, '?includeDeleted=1');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('403s an ORG admin too — this is platform surface, not org surface', async () => {
    const user = await createUser();
    const org = await seedOrg('Mine', 'mine');
    await addOrgMember(org.id, user.id, 'admin');

    expect((await listOrgs(user, '?includeDeleted=1')).status).toBe(403);
  });

  it('combines with `q` across archived and live rows', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    await seedOrg('Acme Live', 'acme-live');
    await seedOrg('Acme Gone', 'acme-gone', { deleted: true });
    await seedOrg('Globex', 'globex');

    const res = await listOrgs(root, '?includeDeleted=1&q=acme');

    expect(res.body.data).toHaveLength(2);
  });

  it('treats includeDeleted=0 as the ordinary list', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    await seedOrg('Live', 'live');
    await seedOrg('Archived', 'archived', { deleted: true });

    const res = await listOrgs(root, '?includeDeleted=0');

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].role).toBe('admin');
  });
});

describe('POST /api/orgs/:orgId/restore', () => {
  it('401s without a session', async () => {
    const org = await seedOrg('Gone', 'gone', { deleted: true });
    expect((await request(app).post(`/api/orgs/${org.id}/restore`)).status).toBe(401);
  });

  it('403s an org admin who is not a global admin', async () => {
    const user = await createUser();
    const org = await seedOrg('Gone', 'gone', { deleted: true });
    await addOrgMember(org.id, user.id, 'admin');

    const res = await restore(user, org.id);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('422s a non-uuid org id instead of reaching the driver', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    expect((await restore(root, 'not-a-uuid')).status).toBe(422);
  });

  it('404s an organization that does not exist', async () => {
    const root = await createUser({ isGlobalAdmin: true });

    const res = await restore(root, '00000000-0000-4000-8000-000000000000');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('409s an organization that is not archived', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const live = await seedOrg('Live', 'live');

    const res = await restore(root, live.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('restores it and answers with the admin row', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const org = await seedOrg('Gone', 'gone', { deleted: true });
    await addOrgMember(org.id, root.id, 'admin');
    await createProject(org.id);

    const res = await restore(root, org.id);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: org.id,
      slug: 'gone',
      deletedAt: null,
      memberCount: 1,
      projectCount: 1,
    });
  });

  it('makes the organization resolve again everywhere', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const org = await seedOrg('Gone', 'gone', { deleted: true });
    await addOrgMember(org.id, root.id, 'admin');

    const before = await request(app).get(`/api/orgs/${org.id}`).set('Authorization', bearer(root));
    expect(before.status).toBe(404);

    await restore(root, org.id);

    const after = await request(app).get(`/api/orgs/${org.id}`).set('Authorization', bearer(root));
    expect(after.status).toBe(200);
    expect((await listOrgs(root)).body.data).toHaveLength(1);
  });

  it('clears deleted_at in the database, it does not merely hide it', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const org = await seedOrg('Gone', 'gone', { deleted: true });

    await restore(root, org.id);

    const [row] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, org.id), eq(organizations.slug, 'gone')));
    expect(row).toBeDefined();

    const [live] = await db
      .select({ deletedAt: organizations.deletedAt })
      .from(organizations)
      .where(eq(organizations.id, org.id));
    expect(live?.deletedAt).toBeNull();
  });

  it('is not repeatable — the second call 409s', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const org = await seedOrg('Gone', 'gone', { deleted: true });

    expect((await restore(root, org.id)).status).toBe(200);
    expect((await restore(root, org.id)).status).toBe(409);
  });
});
