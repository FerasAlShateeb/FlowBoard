/**
 * `/api/orgs` integration suite — against the live `flowboard_test` database.
 *
 * The spine of this file is the ROLE MATRIX: every mutating endpoint is asserted
 * twice, once refused at the role below its floor and once accepted at the floor
 * itself. A guard that is accidentally removed passes a "happy path" suite and
 * fails here.
 *
 * The other recurring theme is the last-admin rule. An organization whose only
 * administrator can be removed — or quietly demoted, which is the same outcome
 * through a different button — is unrecoverable without a global admin, so both
 * doors are tested.
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

import { closeDb, db, orgMembers, organizations } from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import {
  addOrgMember,
  bearer,
  createOrg,
  createProject,
  createTeam,
  createTestApp,
  createUser,
} from './fixtures';

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

describe('GET /api/orgs', () => {
  it('401s without a token', async () => {
    const res = await request(app).get('/api/orgs');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('returns only the orgs the caller belongs to, with role and counts', async () => {
    const user = await createUser();
    const mine = await createOrg({ name: 'Mine' });
    await createOrg({ name: 'Theirs' });
    await addOrgMember(mine.id, user.id, 'member');
    await createProject(mine.id);

    const res = await request(app).get('/api/orgs').set('Authorization', bearer(user));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id: mine.id,
      name: 'Mine',
      role: 'member',
      memberCount: 1,
      projectCount: 1,
    });
  });

  it('shows a global admin every live org at role admin, with no membership row', async () => {
    const admin = await createUser({ isGlobalAdmin: true });
    await createOrg({ name: 'A' });
    await createOrg({ name: 'B' });

    const res = await request(app).get('/api/orgs').set('Authorization', bearer(admin));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((org: { role: string }) => org.role === 'admin')).toBe(true);
  });

  it('hides soft-deleted orgs from a member of one', async () => {
    const user = await createUser();
    const gone = await createOrg({ deleted: true });
    await addOrgMember(gone.id, user.id, 'admin');

    const res = await request(app).get('/api/orgs').set('Authorization', bearer(user));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('POST /api/orgs', () => {
  it('403s for an authenticated non-global-admin', async () => {
    const user = await createUser();

    const res = await request(app)
      .post('/api/orgs')
      .set('Authorization', bearer(user))
      .send({ name: 'Acme', slug: 'acme' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('creates the org and makes the caller its first admin', async () => {
    const admin = await createUser({ isGlobalAdmin: true });

    const res = await request(app)
      .post('/api/orgs')
      .set('Authorization', bearer(admin))
      .send({ name: 'Acme', slug: 'acme' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Acme',
      slug: 'acme',
      role: 'admin',
      memberCount: 1,
      projectCount: 0,
      teamCount: 0,
    });

    const rows = await db
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.orgId, res.body.data.id as string));
    expect(rows).toEqual([expect.objectContaining({ userId: admin.id, role: 'admin' })]);
  });

  it('hands the admin seat to the chosen owner instead of the caller', async () => {
    const admin = await createUser({ isGlobalAdmin: true });
    const owner = await createUser();

    const res = await request(app)
      .post('/api/orgs')
      .set('Authorization', bearer(admin))
      .send({ name: 'Owned', slug: 'owned', adminUserId: owner.id });

    expect(res.status).toBe(201);
    const rows = await db
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.orgId, res.body.data.id as string));
    expect(rows).toEqual([expect.objectContaining({ userId: owner.id, role: 'admin' })]);
  });

  it('409s on a duplicate slug', async () => {
    const admin = await createUser({ isGlobalAdmin: true });
    await request(app)
      .post('/api/orgs')
      .set('Authorization', bearer(admin))
      .send({ name: 'Acme', slug: 'acme' });

    const res = await request(app)
      .post('/api/orgs')
      .set('Authorization', bearer(admin))
      .send({ name: 'Acme Two', slug: 'acme' });

    expect(res.status).toBe(409);
    // `slug_taken`, not the generic `conflict` (W3.1). The web catalog renders
    // `conflict` as "Someone else changed this first. Refresh and try again.",
    // which is the optimistic-concurrency sentence and is useless advice for a
    // slug that belongs to another organization. The code IS the copy, so the
    // assertion is on the code.
    expect(res.body.error.code).toBe('slug_taken');
  });

  it('422s a slug that is not URL-safe', async () => {
    const admin = await createUser({ isGlobalAdmin: true });

    const res = await request(app)
      .post('/api/orgs')
      .set('Authorization', bearer(admin))
      .send({ name: 'Acme', slug: 'Not A Slug' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_error');
  });
});

describe('GET /api/orgs/:orgId', () => {
  it('returns the detail with the caller role and a team count', async () => {
    const user = await createUser();
    const org = await createOrg({ name: 'Acme' });
    await addOrgMember(org.id, user.id, 'member');
    await createTeam(org.id);
    await createTeam(org.id);

    const res = await request(app).get(`/api/orgs/${org.id}`).set('Authorization', bearer(user));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: org.id, role: 'member', teamCount: 2 });
  });

  it('403s a signed-in stranger', async () => {
    const stranger = await createUser();
    const org = await createOrg();

    const res = await request(app)
      .get(`/api/orgs/${org.id}`)
      .set('Authorization', bearer(stranger));

    expect(res.status).toBe(403);
  });

  it('404s a soft-deleted org even for its own admin', async () => {
    const user = await createUser();
    const org = await createOrg({ deleted: true });
    await addOrgMember(org.id, user.id, 'admin');

    const res = await request(app).get(`/api/orgs/${org.id}`).set('Authorization', bearer(user));

    expect(res.status).toBe(404);
  });

  it('422s a non-uuid org id instead of reaching the driver', async () => {
    const user = await createUser();

    const res = await request(app).get('/api/orgs/not-a-uuid').set('Authorization', bearer(user));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_error');
  });
});

describe('PATCH /api/orgs/:orgId', () => {
  it('403s an org member', async () => {
    const member = await createUser();
    const org = await createOrg();
    await addOrgMember(org.id, member.id, 'member');

    const res = await request(app)
      .patch(`/api/orgs/${org.id}`)
      .set('Authorization', bearer(member))
      .send({ name: 'Renamed' });

    expect(res.status).toBe(403);
  });

  it('renames for an org admin', async () => {
    const admin = await createUser();
    const org = await createOrg();
    await addOrgMember(org.id, admin.id, 'admin');

    const res = await request(app)
      .patch(`/api/orgs/${org.id}`)
      .set('Authorization', bearer(admin))
      .send({ name: 'Renamed', slug: 'renamed' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Renamed', slug: 'renamed' });
  });

  it('409s when the new slug is taken', async () => {
    const admin = await createUser();
    const org = await createOrg();
    const other = await createOrg();
    await addOrgMember(org.id, admin.id, 'admin');

    const res = await request(app)
      .patch(`/api/orgs/${org.id}`)
      .set('Authorization', bearer(admin))
      .send({ slug: other.slug });

    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/orgs/:orgId', () => {
  it('403s an org admin who is not a global admin', async () => {
    const admin = await createUser();
    const org = await createOrg();
    await addOrgMember(org.id, admin.id, 'admin');

    const res = await request(app)
      .delete(`/api/orgs/${org.id}`)
      .set('Authorization', bearer(admin));

    expect(res.status).toBe(403);
  });

  it('soft-deletes for a global admin and the org stops resolving', async () => {
    const globalAdmin = await createUser({ isGlobalAdmin: true });
    const org = await createOrg();

    const res = await request(app)
      .delete(`/api/orgs/${org.id}`)
      .set('Authorization', bearer(globalAdmin));

    expect(res.status).toBe(204);

    const [row] = await db
      .select({ deletedAt: organizations.deletedAt })
      .from(organizations)
      .where(eq(organizations.id, org.id));
    expect(row?.deletedAt).toBeInstanceOf(Date);

    const after = await request(app)
      .get(`/api/orgs/${org.id}`)
      .set('Authorization', bearer(globalAdmin));
    expect(after.status).toBe(404);
  });
});

describe('/api/orgs/:orgId/members', () => {
  it('lists members to any org member and filters on ?q', async () => {
    const viewer = await createUser({ name: 'Zoe Reader' });
    const other = await createUser({ name: 'Ada Lovelace' });
    const org = await createOrg();
    await addOrgMember(org.id, viewer.id, 'member');
    await addOrgMember(org.id, other.id, 'admin');

    const all = await request(app)
      .get(`/api/orgs/${org.id}/members`)
      .set('Authorization', bearer(viewer));
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(2);
    expect(all.body.data[0]).toMatchObject({
      orgId: org.id,
      user: { id: other.id, name: 'Ada Lovelace' },
      email: other.email,
      role: 'admin',
    });

    const filtered = await request(app)
      .get(`/api/orgs/${org.id}/members?q=lovelace`)
      .set('Authorization', bearer(viewer));
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].user.id).toBe(other.id);
  });

  it('403s a member trying to add someone', async () => {
    const member = await createUser();
    const newcomer = await createUser();
    const org = await createOrg();
    await addOrgMember(org.id, member.id, 'member');

    const res = await request(app)
      .post(`/api/orgs/${org.id}/members`)
      .set('Authorization', bearer(member))
      .send({ userId: newcomer.id, role: 'member' });

    expect(res.status).toBe(403);
  });

  it('adds by user id for an org admin', async () => {
    const admin = await createUser();
    const newcomer = await createUser();
    const org = await createOrg();
    await addOrgMember(org.id, admin.id, 'admin');

    const res = await request(app)
      .post(`/api/orgs/${org.id}/members`)
      .set('Authorization', bearer(admin))
      .send({ userId: newcomer.id, role: 'member' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ user: { id: newcomer.id }, role: 'member' });
  });

  it('adds by email too', async () => {
    const admin = await createUser();
    const newcomer = await createUser();
    const org = await createOrg();
    await addOrgMember(org.id, admin.id, 'admin');

    const res = await request(app)
      .post(`/api/orgs/${org.id}/members`)
      .set('Authorization', bearer(admin))
      .send({ email: newcomer.email.toUpperCase(), role: 'admin' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ user: { id: newcomer.id }, role: 'admin' });
  });

  it('422s when both userId and email are supplied', async () => {
    const admin = await createUser();
    const newcomer = await createUser();
    const org = await createOrg();
    await addOrgMember(org.id, admin.id, 'admin');

    const res = await request(app)
      .post(`/api/orgs/${org.id}/members`)
      .set('Authorization', bearer(admin))
      .send({ userId: newcomer.id, email: newcomer.email, role: 'member' });

    expect(res.status).toBe(422);
  });

  it('404s an account that does not exist', async () => {
    const admin = await createUser();
    const org = await createOrg();
    await addOrgMember(org.id, admin.id, 'admin');

    const res = await request(app)
      .post(`/api/orgs/${org.id}/members`)
      .set('Authorization', bearer(admin))
      .send({ email: 'nobody@flowboard.test', role: 'member' });

    expect(res.status).toBe(404);
  });

  it('409s on someone who is already a member', async () => {
    const admin = await createUser();
    const org = await createOrg();
    await addOrgMember(org.id, admin.id, 'admin');

    const res = await request(app)
      .post(`/api/orgs/${org.id}/members`)
      .set('Authorization', bearer(admin))
      .send({ userId: admin.id, role: 'member' });

    expect(res.status).toBe(409);
  });
});

describe('/api/orgs/:orgId/members/:userId', () => {
  it('403s a member changing a role', async () => {
    const member = await createUser();
    const target = await createUser();
    const org = await createOrg();
    await addOrgMember(org.id, member.id, 'member');
    await addOrgMember(org.id, target.id, 'member');

    const res = await request(app)
      .patch(`/api/orgs/${org.id}/members/${target.id}`)
      .set('Authorization', bearer(member))
      .send({ role: 'admin' });

    expect(res.status).toBe(403);
  });

  it('promotes for an org admin', async () => {
    const admin = await createUser();
    const target = await createUser();
    const org = await createOrg();
    await addOrgMember(org.id, admin.id, 'admin');
    await addOrgMember(org.id, target.id, 'member');

    const res = await request(app)
      .patch(`/api/orgs/${org.id}/members/${target.id}`)
      .set('Authorization', bearer(admin))
      .send({ role: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('admin');
  });

  it('409s when demoting the last administrator', async () => {
    const admin = await createUser();
    const org = await createOrg();
    await addOrgMember(org.id, admin.id, 'admin');

    const res = await request(app)
      .patch(`/api/orgs/${org.id}/members/${admin.id}`)
      .set('Authorization', bearer(admin))
      .send({ role: 'member' });

    expect(res.status).toBe(409);
    const [row] = await db
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.userId, admin.id)));
    expect(row?.role).toBe('admin');
  });

  it('403s a member removing someone', async () => {
    const member = await createUser();
    const target = await createUser();
    const org = await createOrg();
    await addOrgMember(org.id, member.id, 'member');
    await addOrgMember(org.id, target.id, 'member');

    const res = await request(app)
      .delete(`/api/orgs/${org.id}/members/${target.id}`)
      .set('Authorization', bearer(member));

    expect(res.status).toBe(403);
  });

  it('removes for an org admin', async () => {
    const admin = await createUser();
    const target = await createUser();
    const org = await createOrg();
    await addOrgMember(org.id, admin.id, 'admin');
    await addOrgMember(org.id, target.id, 'member');

    const res = await request(app)
      .delete(`/api/orgs/${org.id}/members/${target.id}`)
      .set('Authorization', bearer(admin));

    expect(res.status).toBe(204);
    const rows = await db.select().from(orgMembers).where(eq(orgMembers.orgId, org.id));
    expect(rows).toHaveLength(1);
  });

  it('409s when removing the last administrator', async () => {
    const admin = await createUser();
    const org = await createOrg();
    await addOrgMember(org.id, admin.id, 'admin');

    const res = await request(app)
      .delete(`/api/orgs/${org.id}/members/${admin.id}`)
      .set('Authorization', bearer(admin));

    expect(res.status).toBe(409);
  });
});

describe('GET /api/orgs/:orgId/users', () => {
  it('returns the picker directory and hides deactivated accounts', async () => {
    const member = await createUser({ name: 'Active One' });
    const retired = await createUser({ name: 'Retired One', isActive: false });
    const org = await createOrg();
    await addOrgMember(org.id, member.id, 'member');
    await addOrgMember(org.id, retired.id, 'member');

    const res = await request(app)
      .get(`/api/orgs/${org.id}/users`)
      .set('Authorization', bearer(member));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toEqual({
      user: { id: member.id, name: 'Active One', avatarUrl: null },
      email: member.email,
      role: 'member',
    });
  });

  it('403s a signed-in stranger', async () => {
    const stranger = await createUser();
    const org = await createOrg();

    const res = await request(app)
      .get(`/api/orgs/${org.id}/users`)
      .set('Authorization', bearer(stranger));

    expect(res.status).toBe(403);
  });
});
