/**
 * `/api/auth/*` integration suite — against the live `flowboard_test` database.
 *
 * The theme running through it is REVOCATION: almost every case here exists to
 * prove that a `token_version` bump (logout-all, change-password, admin action)
 * actually kills a session, because that is the one auth property a unit test
 * on a service cannot demonstrate end to end.
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { closeDb, db, users } from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import { setAuthProvider } from '../../services/auth.service';
import type { AuthProvider } from '../../services/auth/auth-provider';
import {
  bearer,
  buildTestApp,
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
  setAuthProvider(null);
  await closeDb();
});

async function login(email: string, password = TEST_PASSWORD) {
  return request(app).post('/api/auth/login').send({ email, password });
}

describe('POST /api/auth/login', () => {
  it('returns the account and a token pair for valid credentials', async () => {
    const user = await seedUser({ email: 'ada@flowboard.dev', name: 'Ada' });

    const res = await login('ada@flowboard.dev');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({
      id: user.id,
      email: 'ada@flowboard.dev',
      name: 'Ada',
      isGlobalAdmin: false,
      isActive: true,
    });
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(res.body.data.user).not.toHaveProperty('tokenVersion');
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(typeof res.body.data.refreshToken).toBe('string');
    expect(res.body.data.accessToken).not.toBe(res.body.data.refreshToken);
  });

  it('matches the address case-insensitively', async () => {
    await seedUser({ email: 'ada@flowboard.dev' });

    const res = await login('  ADA@Flowboard.DEV  ');

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('ada@flowboard.dev');
  });

  it('rejects a wrong password with 401 and no hint about the account', async () => {
    await seedUser({ email: 'ada@flowboard.dev' });

    const res = await login('ada@flowboard.dev', 'not-the-password');

    expect(res.status).toBe(401);
    // `invalid_credentials`, NOT the generic `unauthorized` the guards throw.
    // Both are 401s; the login form branches on the code to say something
    // useful, and `lib/api.ts` must not spend a refresh token on either.
    expect(res.body.error.code).toBe('invalid_credentials');
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('answers an unknown address exactly like a wrong password', async () => {
    const res = await login('nobody@flowboard.dev');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('refuses a deactivated account even with the right password', async () => {
    await seedUser({ email: 'gone@flowboard.dev', isActive: false });

    const res = await login('gone@flowboard.dev');

    // Indistinguishable from a wrong password, on purpose: a distinct
    // "deactivated" answer would confirm the address has an account.
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('rejects a malformed body with 422 and field details', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_error');
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });
});

describe('POST /api/auth/refresh', () => {
  it('rotates both halves of the pair', async () => {
    const user = await seedUser();
    const { refreshToken } = tokensFor(user);

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken });

    expect(res.status).toBe(200);
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(typeof res.body.data.refreshToken).toBe('string');

    // The new access token really works.
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', bearer(res.body.data.accessToken));
    expect(me.status).toBe(200);
  });

  it('refuses an access token presented as a refresh token', async () => {
    const user = await seedUser();
    const { accessToken } = tokensFor(user);

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: accessToken });

    expect(res.status).toBe(401);
  });

  it('refuses a refresh token whose tokenVersion is stale', async () => {
    const user = await seedUser();
    const { refreshToken } = tokensFor(user);
    await db.update(users).set({ tokenVersion: 5 }).where(eq(users.id, user.id));

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Session has been revoked');
  });

  it('refuses a refresh token for a deactivated account', async () => {
    const user = await seedUser();
    const { refreshToken } = tokensFor(user);
    await db.update(users).set({ isActive: false }).where(eq(users.id, user.id));

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken });

    expect(res.status).toBe(401);
  });

  it('rejects garbage with 401, not 500', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: 'nonsense' });

    expect(res.status).toBe(401);
  });

  /**
   * WHAT ROTATION DOES AND DOES NOT MEAN HERE — pinned because two files
   * describe it differently.
   *
   * `auth.service.refresh()` re-signs both halves and says so plainly: "The
   * spent refresh token is not denylisted (there is no store to deny it in)."
   * So a refresh token is reusable until `token_version` moves, and two
   * concurrent refreshes with the SAME token both succeed.
   *
   * The web client's `lib/api.ts` header states the opposite as its motivation
   * for the single-flight refresh ("the API ROTATES the refresh token, so the
   * first request invalidates the token the other five are still holding").
   * That sentence is stronger than this endpoint's behaviour. The single-flight
   * is still worth having — six refreshes for one expiry is six round trips and
   * six writes' worth of pointless work, and a future denylist would make the
   * sentence true — but the API contract is what is asserted below, and a
   * change to it should break these tests rather than surprise a client.
   */
  it('does not invalidate the spent refresh token — it stays usable until revocation', async () => {
    const user = await seedUser();
    const { refreshToken } = tokensFor(user);

    const first = await request(app).post('/api/auth/refresh').send({ refreshToken });
    const second = await request(app).post('/api/auth/refresh').send({ refreshToken });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it('answers two SIMULTANEOUS refreshes of one token without a 500 or a deadlock', async () => {
    const user = await seedUser();
    const { refreshToken } = tokensFor(user);

    const [a, b] = await Promise.all([
      request(app).post('/api/auth/refresh').send({ refreshToken }),
      request(app).post('/api/auth/refresh').send({ refreshToken }),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    // Both answers are usable sessions — the endpoint is a pure re-sign of a
    // freshly read row, so concurrency has nothing to serialize.
    for (const res of [a, b]) {
      const me = await request(app)
        .get('/api/auth/me')
        .set('Authorization', bearer(res.body.data.accessToken));
      expect(me.status).toBe(200);
    }
  });

  it('DOES kill every outstanding refresh token once the version is bumped', async () => {
    // The actual revocation boundary, and the reason the reuse above is not a
    // hole: `logout?all=true`, a password change or an admin action moves
    // `token_version`, and every token minted before it dies at once.
    const user = await seedUser();
    const { refreshToken } = tokensFor(user);
    const rotated = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(rotated.status).toBe(200);

    await db
      .update(users)
      .set({ tokenVersion: user.tokenVersion + 1 })
      .where(eq(users.id, user.id));

    for (const token of [refreshToken, rotated.body.data.refreshToken]) {
      const res = await request(app).post('/api/auth/refresh').send({ refreshToken: token });
      expect(res.status).toBe(401);
    }
  });
});

describe('POST /api/auth/logout', () => {
  it('is a client-side no-op without ?all — the refresh token still works', async () => {
    const user = await seedUser();
    const { accessToken, refreshToken } = tokensFor(user);

    const out = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', bearer(accessToken));

    expect(out.status).toBe(200);
    expect(out.body.data).toEqual({ revokedAll: false });

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(200);
  });

  it('?all=true revokes every outstanding token', async () => {
    const user = await seedUser();
    const { accessToken, refreshToken } = tokensFor(user);

    const out = await request(app)
      .post('/api/auth/logout?all=true')
      .set('Authorization', bearer(accessToken));

    expect(out.status).toBe(200);
    expect(out.body.data).toEqual({ revokedAll: true });

    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(refreshed.status).toBe(401);

    const me = await request(app).get('/api/auth/me').set('Authorization', bearer(accessToken));
    expect(me.status).toBe(401);
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the account, its org memberships and the admin flag', async () => {
    const user = await seedUser({ name: 'Grace', isGlobalAdmin: true });
    const alpha = await seedOrg({ name: 'Alpha', slug: 'alpha' });
    const beta = await seedOrg({ name: 'Beta', slug: 'beta' });
    await seedOrgMember(alpha.id, user.id, 'admin');
    await seedOrgMember(beta.id, user.id, 'member');
    const { accessToken } = tokensFor(user);

    const res = await request(app).get('/api/auth/me').set('Authorization', bearer(accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ id: user.id, name: 'Grace' });
    expect(res.body.data.isGlobalAdmin).toBe(true);
    expect(res.body.data.memberships).toHaveLength(2);
    expect(res.body.data.memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orgId: alpha.id, orgSlug: 'alpha', role: 'admin' }),
        expect.objectContaining({ orgId: beta.id, orgSlug: 'beta', role: 'member' }),
      ]),
    );
  });

  it('returns an empty membership list for an account in no org', async () => {
    const user = await seedUser();
    const { accessToken } = tokensFor(user);

    const res = await request(app).get('/api/auth/me').set('Authorization', bearer(accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data.memberships).toEqual([]);
  });

  it('rejects a token minted before a tokenVersion bump', async () => {
    const user = await seedUser();
    const { accessToken } = tokensFor(user);
    await db.update(users).set({ tokenVersion: 9 }).where(eq(users.id, user.id));

    const res = await request(app).get('/api/auth/me').set('Authorization', bearer(accessToken));

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Session has been revoked');
  });

  it('rejects a request with no Authorization header', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
  });

  it('rejects a refresh token used as a bearer credential', async () => {
    const user = await seedUser();
    const { refreshToken } = tokensFor(user);

    const res = await request(app).get('/api/auth/me').set('Authorization', bearer(refreshToken));

    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/auth/me', () => {
  it('updates the fields a user owns about themselves', async () => {
    const user = await seedUser({ name: 'Before' });
    const { accessToken } = tokensFor(user);

    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', bearer(accessToken))
      .send({ name: 'After', locale: 'ar', avatarUrl: 'https://cdn.flowboard.dev/a.png' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: 'After',
      locale: 'ar',
      avatarUrl: 'https://cdn.flowboard.dev/a.png',
    });
  });

  it('accepts a null avatarUrl (render initials)', async () => {
    const user = await seedUser();
    const { accessToken } = tokensFor(user);

    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', bearer(accessToken))
      .send({ avatarUrl: null });

    expect(res.status).toBe(200);
    expect(res.body.data.avatarUrl).toBeNull();
  });

  it('rejects an empty patch with 422', async () => {
    const user = await seedUser();
    const { accessToken } = tokensFor(user);

    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', bearer(accessToken))
      .send({});

    expect(res.status).toBe(422);
  });

  it('requires authentication', async () => {
    const res = await request(app).patch('/api/auth/me').send({ name: 'Nope' });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/change-password', () => {
  it('rotates the password, returns a fresh pair, and kills the old sessions', async () => {
    const user = await seedUser({ email: 'ada@flowboard.dev' });
    const { accessToken, refreshToken } = tokensFor(user);

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', bearer(accessToken))
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'a-brand-new-password' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(user.id);

    // The pair handed back keeps the caller signed in...
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', bearer(res.body.data.accessToken));
    expect(me.status).toBe(200);

    // ...while every token minted before the change is dead.
    const stale = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(stale.status).toBe(401);

    // And the new password is the one that works now.
    expect((await login('ada@flowboard.dev', TEST_PASSWORD)).status).toBe(401);
    expect((await login('ada@flowboard.dev', 'a-brand-new-password')).status).toBe(200);
  });

  it('rejects a wrong current password with 400, not 401', async () => {
    const user = await seedUser();
    const { accessToken } = tokensFor(user);

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', bearer(accessToken))
      .send({ currentPassword: 'wrong-password', newPassword: 'a-brand-new-password' });

    // 400, so the web client's 401 interceptor does not bounce a signed-in
    // user to /login over a typo.
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });

  it('refuses to "change" a password to itself', async () => {
    const user = await seedUser();
    const { accessToken } = tokensFor(user);

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', bearer(accessToken))
      .send({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD });

    expect(res.status).toBe(400);
  });

  it('enforces the password policy on the NEW password only', async () => {
    const user = await seedUser();
    const { accessToken } = tokensFor(user);

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', bearer(accessToken))
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'short' });

    expect(res.status).toBe(422);
  });

  it('requires authentication', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'a-brand-new-password' });

    expect(res.status).toBe(401);
  });
});

describe('the AuthProvider seam', () => {
  it('routes login through whatever provider is installed', async () => {
    const user = await seedUser({ email: 'directory@flowboard.dev' });
    const calls: { email: string; password: string }[] = [];

    const stub: AuthProvider = {
      id: 'stub-directory',
      supportsPasswordChange: false,
      verifyCredentials: async (email, password) => {
        calls.push({ email, password });
        return Promise.resolve(email === 'directory@flowboard.dev' ? user : null);
      },
    };
    setAuthProvider(stub);

    const accepted = await login('directory@flowboard.dev', 'whatever-the-directory-says');
    expect(accepted.status).toBe(200);
    expect(calls).toEqual([
      { email: 'directory@flowboard.dev', password: 'whatever-the-directory-says' },
    ]);

    const rejected = await login('someone-else@flowboard.dev', 'x');
    expect(rejected.status).toBe(401);
  });

  it('refuses password changes when the provider owns the password', async () => {
    const user = await seedUser();
    const { accessToken } = tokensFor(user);
    setAuthProvider({
      id: 'stub-directory',
      supportsPasswordChange: false,
      verifyCredentials: () => Promise.resolve(user),
    });

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', bearer(accessToken))
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'a-brand-new-password' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/directory/i);
  });

  it('falls back to the local provider when reset to null', async () => {
    setAuthProvider({
      id: 'stub',
      supportsPasswordChange: true,
      verifyCredentials: () => Promise.resolve(null),
    });
    setAuthProvider(null);
    await seedUser({ email: 'ada@flowboard.dev' });

    expect((await login('ada@flowboard.dev')).status).toBe(200);
  });
});
