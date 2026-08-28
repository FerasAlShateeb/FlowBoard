/**
 * `/api/admin/users` integration suite.
 *
 * Two properties dominate: the global-admin gate (every route must be closed to
 * everyone else, including org admins), and the fact that deactivation and
 * force-logout REVOKE LIVE SESSIONS rather than merely flipping a flag — the
 * consequence `updateUserInputSchema` cannot express, which is exactly why it
 * is asserted here.
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb } from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import { setAuthProvider } from '../../services/auth.service';
import {
  bearer,
  buildTestApp,
  orgRolesOf,
  seedOrg,
  seedOrgMember,
  seedUser,
  tokensFor,
  TEST_PASSWORD,
} from './identity-test-app';

const app = buildTestApp();

beforeAll(async () => {
  await ensureTestDb();
});

beforeEach(async () => {
  setAuthProvider(null);
  await truncateAllTables();
});

afterAll(async () => {
  await closeDb();
});

async function seedGlobalAdmin() {
  const admin = await seedUser({ name: 'Root', isGlobalAdmin: true });
  return { admin, token: tokensFor(admin).accessToken };
}

describe('GET /api/admin/users', () => {
  it('returns a page of accounts with pagination meta in the envelope', async () => {
    const { token } = await seedGlobalAdmin();
    for (let i = 0; i < 4; i += 1) await seedUser();

    const res = await request(app)
      .get('/api/admin/users?page=1&pageSize=2')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
    expect(res.body.data[0]).not.toHaveProperty('passwordHash');
  });

  it('defaults to page 1 of 25', async () => {
    const { token } = await seedGlobalAdmin();

    const res = await request(app).get('/api/admin/users').set('Authorization', bearer(token));

    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 25 });
  });

  it('filters on a name fragment', async () => {
    const { token } = await seedGlobalAdmin();
    await seedUser({ name: 'Ada Lovelace' });
    await seedUser({ name: 'Grace Hopper' });

    const res = await request(app)
      .get('/api/admin/users?q=lovel')
      .set('Authorization', bearer(token));

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Ada Lovelace');
  });

  it('filters on an email fragment, case-insensitively', async () => {
    const { token } = await seedGlobalAdmin();
    await seedUser({ email: 'ada@lovelace.dev' });

    const res = await request(app)
      .get('/api/admin/users?q=LOVELACE')
      .set('Authorization', bearer(token));

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].email).toBe('ada@lovelace.dev');
  });

  it('filters on isActive', async () => {
    const { token } = await seedGlobalAdmin();
    await seedUser({ isActive: false });

    const active = await request(app)
      .get('/api/admin/users?isActive=true')
      .set('Authorization', bearer(token));
    const inactive = await request(app)
      .get('/api/admin/users?isActive=false')
      .set('Authorization', bearer(token));

    expect(active.body.meta.total).toBe(1);
    expect(inactive.body.meta.total).toBe(1);
    expect(inactive.body.data[0].isActive).toBe(false);
  });

  it('rejects a pageSize above the hard ceiling', async () => {
    const { token } = await seedGlobalAdmin();

    const res = await request(app)
      .get('/api/admin/users?pageSize=500')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(422);
  });

  it('forbids a non-admin, even an org admin', async () => {
    const orgAdmin = await seedUser();
    const org = await seedOrg();
    await seedOrgMember(org.id, orgAdmin.id, 'admin');

    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', bearer(tokensFor(orgAdmin).accessToken));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/admin/users');

    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/users', () => {
  it('provisions an account that can immediately log in', async () => {
    const { token } = await seedGlobalAdmin();

    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', bearer(token))
      .send({
        email: 'New.Hire@Flowboard.dev',
        name: 'New Hire',
        password: 'temporary-password',
        isGlobalAdmin: false,
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      email: 'new.hire@flowboard.dev',
      name: 'New Hire',
      isActive: true,
      isGlobalAdmin: false,
      locale: 'en',
    });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'new.hire@flowboard.dev', password: 'temporary-password' });
    expect(login.status).toBe(200);
  });

  it('can mint another global admin', async () => {
    const { token } = await seedGlobalAdmin();

    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', bearer(token))
      .send({
        email: 'second-root@flowboard.dev',
        name: 'Second Root',
        password: 'temporary-password',
        isGlobalAdmin: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.isGlobalAdmin).toBe(true);
  });

  it('drops the new account into the orgs it was given, in one transaction', async () => {
    const { token } = await seedGlobalAdmin();
    const alpha = await seedOrg({ slug: 'alpha' });
    const beta = await seedOrg({ slug: 'beta' });

    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', bearer(token))
      .send({
        email: 'multi@flowboard.dev',
        name: 'Multi',
        password: 'temporary-password',
        orgMemberships: [
          { orgId: alpha.id, role: 'admin' },
          { orgId: beta.id, role: 'member' },
        ],
      });

    expect(res.status).toBe(201);
    const roles = await orgRolesOf(res.body.data.id);
    expect(roles).toHaveLength(2);
    expect(roles).toEqual(
      expect.arrayContaining([
        { orgId: alpha.id, role: 'admin' },
        { orgId: beta.id, role: 'member' },
      ]),
    );
  });

  it('rolls the account back when one of the orgs does not exist', async () => {
    const { token } = await seedGlobalAdmin();

    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', bearer(token))
      .send({
        email: 'ghost@flowboard.dev',
        name: 'Ghost',
        password: 'temporary-password',
        orgMemberships: [{ orgId: '00000000-0000-4000-8000-000000000000', role: 'member' }],
      });

    expect(res.status).toBe(400);

    // Nothing was committed: the address is still free.
    const list = await request(app)
      .get('/api/admin/users?q=ghost')
      .set('Authorization', bearer(token));
    expect(list.body.data).toEqual([]);
  });

  it('conflicts on an address that already exists, whatever its casing', async () => {
    const { token } = await seedGlobalAdmin();
    await seedUser({ email: 'taken@flowboard.dev' });

    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', bearer(token))
      .send({ email: 'TAKEN@flowboard.dev', name: 'Clash', password: 'temporary-password' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('enforces the password policy', async () => {
    const { token } = await seedGlobalAdmin();

    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', bearer(token))
      .send({ email: 'weak@flowboard.dev', name: 'Weak', password: 'short' });

    expect(res.status).toBe(422);
  });

  it('forbids a non-admin', async () => {
    const nobody = await seedUser();

    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', bearer(tokensFor(nobody).accessToken))
      .send({ email: 'x@flowboard.dev', name: 'X', password: 'temporary-password' });

    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/admin/users/:userId', () => {
  it('renames and re-locales an account', async () => {
    const { token } = await seedGlobalAdmin();
    const target = await seedUser({ name: 'Before' });

    const res = await request(app)
      .patch(`/api/admin/users/${target.id}`)
      .set('Authorization', bearer(token))
      .send({ name: 'After', locale: 'ar' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'After', locale: 'ar' });
  });

  it('promotes an account to global admin', async () => {
    const { token } = await seedGlobalAdmin();
    const target = await seedUser();

    const res = await request(app)
      .patch(`/api/admin/users/${target.id}`)
      .set('Authorization', bearer(token))
      .send({ isGlobalAdmin: true });

    expect(res.body.data.isGlobalAdmin).toBe(true);

    // The claim is only in a NEW token — the old one still says "not admin".
    const list = await request(app)
      .get('/api/admin/users')
      .set('Authorization', bearer(tokensFor({ ...target, isGlobalAdmin: true }).accessToken));
    expect(list.status).toBe(200);
  });

  it('deactivating an account revokes its live sessions', async () => {
    const { token } = await seedGlobalAdmin();
    const target = await seedUser({ email: 'doomed@flowboard.dev' });
    const victim = tokensFor(target);

    // The session works before the change.
    expect(
      (await request(app).get('/api/auth/me').set('Authorization', bearer(victim.accessToken)))
        .status,
    ).toBe(200);

    const res = await request(app)
      .patch(`/api/admin/users/${target.id}`)
      .set('Authorization', bearer(token))
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);

    // Access token: dead. Refresh token: dead. Password: no longer accepted.
    expect(
      (await request(app).get('/api/auth/me').set('Authorization', bearer(victim.accessToken)))
        .status,
    ).toBe(401);
    expect(
      (await request(app).post('/api/auth/refresh').send({ refreshToken: victim.refreshToken }))
        .status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .send({ email: 'doomed@flowboard.dev', password: TEST_PASSWORD })
      ).status,
    ).toBe(401);
  });

  it('reactivating an account lets it log in again', async () => {
    const { token } = await seedGlobalAdmin();
    const target = await seedUser({ email: 'back@flowboard.dev', isActive: false });

    await request(app)
      .patch(`/api/admin/users/${target.id}`)
      .set('Authorization', bearer(token))
      .send({ isActive: true });

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'back@flowboard.dev', password: TEST_PASSWORD });
    expect(login.status).toBe(200);
  });

  it('forceLogout revokes sessions without deactivating the account', async () => {
    const { token } = await seedGlobalAdmin();
    const target = await seedUser({ email: 'kicked@flowboard.dev' });
    const victim = tokensFor(target);

    const res = await request(app)
      .patch(`/api/admin/users/${target.id}`)
      .set('Authorization', bearer(token))
      .send({ forceLogout: true });

    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(true);
    expect(
      (await request(app).post('/api/auth/refresh').send({ refreshToken: victim.refreshToken }))
        .status,
    ).toBe(401);

    // They can sign back in — this is a kick, not a ban.
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .send({ email: 'kicked@flowboard.dev', password: TEST_PASSWORD })
      ).status,
    ).toBe(200);
  });

  it('changes the login address', async () => {
    const { token } = await seedGlobalAdmin();
    const target = await seedUser({ email: 'old@flowboard.dev' });

    const res = await request(app)
      .patch(`/api/admin/users/${target.id}`)
      .set('Authorization', bearer(token))
      .send({ email: 'new@flowboard.dev' });

    expect(res.status).toBe(200);
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .send({ email: 'new@flowboard.dev', password: TEST_PASSWORD })
      ).status,
    ).toBe(200);
  });

  it('conflicts when the new address belongs to someone else', async () => {
    const { token } = await seedGlobalAdmin();
    await seedUser({ email: 'taken@flowboard.dev' });
    const target = await seedUser({ email: 'mine@flowboard.dev' });

    const res = await request(app)
      .patch(`/api/admin/users/${target.id}`)
      .set('Authorization', bearer(token))
      .send({ email: 'taken@flowboard.dev' });

    expect(res.status).toBe(409);
  });

  it('allows re-sending an account its own address unchanged', async () => {
    const { token } = await seedGlobalAdmin();
    const target = await seedUser({ email: 'same@flowboard.dev' });

    const res = await request(app)
      .patch(`/api/admin/users/${target.id}`)
      .set('Authorization', bearer(token))
      .send({ email: 'same@flowboard.dev', name: 'Renamed' });

    expect(res.status).toBe(200);
  });

  it('refuses to let an admin deactivate themselves', async () => {
    const { admin, token } = await seedGlobalAdmin();

    const res = await request(app)
      .patch(`/api/admin/users/${admin.id}`)
      .set('Authorization', bearer(token))
      .send({ isActive: false });

    expect(res.status).toBe(400);
  });

  it('refuses to let an admin drop their own global-admin flag', async () => {
    const { admin, token } = await seedGlobalAdmin();

    const res = await request(app)
      .patch(`/api/admin/users/${admin.id}`)
      .set('Authorization', bearer(token))
      .send({ isGlobalAdmin: false });

    expect(res.status).toBe(400);
  });

  it('lets one admin demote another', async () => {
    const { token } = await seedGlobalAdmin();
    const other = await seedUser({ isGlobalAdmin: true });

    const res = await request(app)
      .patch(`/api/admin/users/${other.id}`)
      .set('Authorization', bearer(token))
      .send({ isGlobalAdmin: false });

    expect(res.status).toBe(200);
    expect(res.body.data.isGlobalAdmin).toBe(false);
  });

  it('404s on an account that does not exist', async () => {
    const { token } = await seedGlobalAdmin();

    const res = await request(app)
      .patch('/api/admin/users/00000000-0000-4000-8000-000000000000')
      .set('Authorization', bearer(token))
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
  });

  it('422s on a non-uuid id', async () => {
    const { token } = await seedGlobalAdmin();

    const res = await request(app)
      .patch('/api/admin/users/not-a-uuid')
      .set('Authorization', bearer(token))
      .send({ name: 'Nope' });

    expect(res.status).toBe(422);
  });

  it('422s on an empty patch', async () => {
    const { token } = await seedGlobalAdmin();
    const target = await seedUser();

    const res = await request(app)
      .patch(`/api/admin/users/${target.id}`)
      .set('Authorization', bearer(token))
      .send({});

    expect(res.status).toBe(422);
  });

  it('forbids a non-admin', async () => {
    const nobody = await seedUser();
    const target = await seedUser();

    const res = await request(app)
      .patch(`/api/admin/users/${target.id}`)
      .set('Authorization', bearer(tokensFor(nobody).accessToken))
      .send({ name: 'Hijack' });

    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/users/:userId/reset-password', () => {
  it('sets the new password and revokes every session', async () => {
    const { token } = await seedGlobalAdmin();
    const target = await seedUser({ email: 'reset@flowboard.dev' });
    const victim = tokensFor(target);

    const res = await request(app)
      .post(`/api/admin/users/${target.id}/reset-password`)
      .set('Authorization', bearer(token))
      .send({ password: 'an-admin-issued-password' });

    expect(res.status).toBe(204);
    expect(
      (await request(app).post('/api/auth/refresh').send({ refreshToken: victim.refreshToken }))
        .status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .send({ email: 'reset@flowboard.dev', password: TEST_PASSWORD })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .send({ email: 'reset@flowboard.dev', password: 'an-admin-issued-password' })
      ).status,
    ).toBe(200);
  });

  it('enforces the password policy', async () => {
    const { token } = await seedGlobalAdmin();
    const target = await seedUser();

    const res = await request(app)
      .post(`/api/admin/users/${target.id}/reset-password`)
      .set('Authorization', bearer(token))
      .send({ password: 'short' });

    expect(res.status).toBe(422);
  });

  it('404s on an account that does not exist', async () => {
    const { token } = await seedGlobalAdmin();

    const res = await request(app)
      .post('/api/admin/users/00000000-0000-4000-8000-000000000000/reset-password')
      .set('Authorization', bearer(token))
      .send({ password: 'an-admin-issued-password' });

    expect(res.status).toBe(404);
  });

  it('forbids a non-admin', async () => {
    const nobody = await seedUser();
    const target = await seedUser();

    const res = await request(app)
      .post(`/api/admin/users/${target.id}/reset-password`)
      .set('Authorization', bearer(tokensFor(nobody).accessToken))
      .send({ password: 'an-admin-issued-password' });

    expect(res.status).toBe(403);
  });

  it('requires authentication', async () => {
    const target = await seedUser();

    const res = await request(app)
      .post(`/api/admin/users/${target.id}/reset-password`)
      .send({ password: 'an-admin-issued-password' });

    expect(res.status).toBe(401);
  });
});
