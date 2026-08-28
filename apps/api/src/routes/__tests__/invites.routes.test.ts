/**
 * Invite lifecycle — both halves in one suite, because they only mean anything
 * together: an org admin mints a link (`/api/orgs/:orgId/invites`), and an
 * anonymous or signed-in visitor spends it (`/api/auth/invites/:token`).
 *
 * The cases fall into three groups: the admin role matrix, the public preview,
 * and the accept paths (register / attach) with every way a link can be refused
 * — already spent, expired, locked to someone else.
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
  projectRolesOf,
  seedInvite,
  seedOrg,
  seedOrgMember,
  seedProject,
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

/** An org with an admin and a plain member, which most cases below need. */
async function seedOrgWithRoles() {
  const admin = await seedUser({ name: 'Org Admin' });
  const member = await seedUser({ name: 'Org Member' });
  const org = await seedOrg({ name: 'Acme', slug: 'acme' });
  await seedOrgMember(org.id, admin.id, 'admin');
  await seedOrgMember(org.id, member.id, 'member');
  return { admin, member, org };
}

function createInvite(orgId: string, token: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post(`/api/orgs/${orgId}/invites`)
    .set('Authorization', bearer(token))
    .send(body);
}

describe('POST /api/orgs/:orgId/invites', () => {
  it('lets an org admin mint a link and returns the token exactly once', async () => {
    const { admin, org } = await seedOrgWithRoles();

    const res = await createInvite(org.id, tokensFor(admin).accessToken, {
      email: 'newcomer@flowboard.dev',
      orgRole: 'member',
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      orgId: org.id,
      email: 'newcomer@flowboard.dev',
      orgRole: 'member',
      projectId: null,
      projectRole: null,
      acceptedAt: null,
    });
    expect(res.body.data.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(res.body.data.createdBy).toMatchObject({ id: admin.id, name: 'Org Admin' });
    // Default lifetime is seven days.
    const days = (Date.parse(res.body.data.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it('mints an unlocked, shareable link when no email is given', async () => {
    const { admin, org } = await seedOrgWithRoles();

    const res = await createInvite(org.id, tokensFor(admin).accessToken, {});

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBeNull();
    expect(res.body.data.orgRole).toBe('member');
  });

  it('carries an optional direct project grant', async () => {
    const { admin, org } = await seedOrgWithRoles();
    const project = await seedProject(org.id, { key: 'ACME' });

    const res = await createInvite(org.id, tokensFor(admin).accessToken, {
      orgRole: 'member',
      projectId: project.id,
      projectRole: 'viewer',
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ projectId: project.id, projectRole: 'viewer' });
  });

  it('rejects a project grant with no role (the shared refinement)', async () => {
    const { admin, org } = await seedOrgWithRoles();
    const project = await seedProject(org.id, { key: 'ACME' });

    const res = await createInvite(org.id, tokensFor(admin).accessToken, {
      projectId: project.id,
      projectRole: null,
    });

    expect(res.status).toBe(422);
  });

  it('refuses a project that belongs to another organization', async () => {
    const { admin, org } = await seedOrgWithRoles();
    const other = await seedOrg({ slug: 'other' });
    const foreign = await seedProject(other.id, { key: 'OTHER' });

    const res = await createInvite(org.id, tokensFor(admin).accessToken, {
      projectId: foreign.id,
      projectRole: 'member',
    });

    expect(res.status).toBe(400);
  });

  it('refuses to invite someone who is already a member', async () => {
    const { admin, member, org } = await seedOrgWithRoles();

    const res = await createInvite(org.id, tokensFor(admin).accessToken, {
      email: member.email,
    });

    expect(res.status).toBe(409);
  });

  it('forbids a plain org member', async () => {
    const { member, org } = await seedOrgWithRoles();

    const res = await createInvite(org.id, tokensFor(member).accessToken, {});

    expect(res.status).toBe(403);
  });

  it('forbids a signed-in outsider', async () => {
    const { org } = await seedOrgWithRoles();
    const outsider = await seedUser();

    const res = await createInvite(org.id, tokensFor(outsider).accessToken, {});

    expect(res.status).toBe(403);
  });

  it('allows a global admin who is not an org member', async () => {
    const { org } = await seedOrgWithRoles();
    const root = await seedUser({ isGlobalAdmin: true });

    const res = await createInvite(org.id, tokensFor(root).accessToken, {});

    expect(res.status).toBe(201);
  });

  it('requires authentication', async () => {
    const { org } = await seedOrgWithRoles();

    const res = await request(app).post(`/api/orgs/${org.id}/invites`).send({});

    expect(res.status).toBe(401);
  });

  it('404s on an organization that does not exist', async () => {
    const root = await seedUser({ isGlobalAdmin: true });

    const res = await createInvite(
      '00000000-0000-4000-8000-000000000000',
      tokensFor(root).accessToken,
      {},
    );

    expect(res.status).toBe(404);
  });
});

describe('GET /api/orgs/:orgId/invites', () => {
  it('lists pending links and hides expired ones', async () => {
    const { admin, org } = await seedOrgWithRoles();
    await seedInvite(org.id, { token: 'pending-token-aaaaaaaaaaaa', invitedById: admin.id });
    await seedInvite(org.id, {
      token: 'expired-token-bbbbbbbbbbbb',
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await request(app)
      .get(`/api/orgs/${org.id}/invites`)
      .set('Authorization', bearer(tokensFor(admin).accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].token).toBe('pending-token-aaaaaaaaaaaa');
    expect(res.body.data[0].createdBy).toMatchObject({ id: admin.id });
  });

  it('keeps recently accepted invites as a joining trail', async () => {
    const { admin, org } = await seedOrgWithRoles();
    const joiner = await seedUser();
    await seedInvite(org.id, {
      token: 'accepted-token-cccccccccccc',
      acceptedAt: new Date(),
      acceptedById: joiner.id,
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await request(app)
      .get(`/api/orgs/${org.id}/invites`)
      .set('Authorization', bearer(tokensFor(admin).accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].acceptedAt).not.toBeNull();
  });

  it('does not leak another organization’s invites', async () => {
    const { admin, org } = await seedOrgWithRoles();
    const other = await seedOrg({ slug: 'other' });
    await seedInvite(other.id, { token: 'foreign-token-dddddddddddd' });

    const res = await request(app)
      .get(`/api/orgs/${org.id}/invites`)
      .set('Authorization', bearer(tokensFor(admin).accessToken));

    expect(res.body.data).toEqual([]);
  });

  it('forbids a plain member', async () => {
    const { member, org } = await seedOrgWithRoles();

    const res = await request(app)
      .get(`/api/orgs/${org.id}/invites`)
      .set('Authorization', bearer(tokensFor(member).accessToken));

    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/orgs/:orgId/invites/:inviteId', () => {
  it('revokes an unspent link so the token stops resolving', async () => {
    const { admin, org } = await seedOrgWithRoles();
    const invite = await seedInvite(org.id, { token: 'revoke-me-eeeeeeeeeeeeeeee' });

    const res = await request(app)
      .delete(`/api/orgs/${org.id}/invites/${invite.id}`)
      .set('Authorization', bearer(tokensFor(admin).accessToken));

    expect(res.status).toBe(204);
    expect((await request(app).get('/api/auth/invites/revoke-me-eeeeeeeeeeeeeeee')).status).toBe(
      404,
    );
  });

  it('refuses to delete an invite that has already been accepted', async () => {
    const { admin, org } = await seedOrgWithRoles();
    const joiner = await seedUser();
    const invite = await seedInvite(org.id, {
      token: 'spent-token-ffffffffffff',
      acceptedAt: new Date(),
      acceptedById: joiner.id,
    });

    const res = await request(app)
      .delete(`/api/orgs/${org.id}/invites/${invite.id}`)
      .set('Authorization', bearer(tokensFor(admin).accessToken));

    expect(res.status).toBe(409);
  });

  it('cannot reach across organizations by id', async () => {
    const { admin, org } = await seedOrgWithRoles();
    const other = await seedOrg({ slug: 'other' });
    const foreign = await seedInvite(other.id, { token: 'foreign-token-gggggggggggg' });

    const res = await request(app)
      .delete(`/api/orgs/${org.id}/invites/${foreign.id}`)
      .set('Authorization', bearer(tokensFor(admin).accessToken));

    expect(res.status).toBe(404);
  });

  it('forbids a plain member', async () => {
    const { member, org } = await seedOrgWithRoles();
    const invite = await seedInvite(org.id, { token: 'members-cannot-revoke-hhhh' });

    const res = await request(app)
      .delete(`/api/orgs/${org.id}/invites/${invite.id}`)
      .set('Authorization', bearer(tokensFor(member).accessToken));

    expect(res.status).toBe(403);
  });
});

describe('GET /api/auth/invites/:token (public preview)', () => {
  it('describes the invitation without exposing any ids', async () => {
    const { admin, org } = await seedOrgWithRoles();
    const project = await seedProject(org.id, { key: 'ACME', name: 'Acme Web' });
    await seedInvite(org.id, {
      token: 'preview-token-iiiiiiiiiiii',
      email: 'newcomer@flowboard.dev',
      orgRole: 'admin',
      projectId: project.id,
      projectRole: 'viewer',
      invitedById: admin.id,
    });

    const res = await request(app).get('/api/auth/invites/preview-token-iiiiiiiiiiii');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      orgName: 'Acme',
      orgRole: 'admin',
      projectName: 'Acme Web',
      projectRole: 'viewer',
      invitedByName: 'Org Admin',
      email: 'newcomer@flowboard.dev',
      requiresAccount: true,
      status: 'pending',
    });
    expect(res.body.data).not.toHaveProperty('orgId');
    expect(res.body.data).not.toHaveProperty('projectId');
  });

  it('reports requiresAccount=false when the locked address already has an account', async () => {
    const { org } = await seedOrgWithRoles();
    const existing = await seedUser({ email: 'known@flowboard.dev' });
    await seedInvite(org.id, { token: 'known-token-jjjjjjjjjjjj', email: existing.email });

    const res = await request(app).get('/api/auth/invites/known-token-jjjjjjjjjjjj');

    expect(res.body.data.requiresAccount).toBe(false);
  });

  it('still previews an expired link, flagged as expired', async () => {
    const { org } = await seedOrgWithRoles();
    await seedInvite(org.id, {
      token: 'stale-token-kkkkkkkkkkkk',
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await request(app).get('/api/auth/invites/stale-token-kkkkkkkkkkkk');

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('expired');
  });

  it('flags an already-accepted link', async () => {
    const { org } = await seedOrgWithRoles();
    const joiner = await seedUser();
    await seedInvite(org.id, {
      token: 'used-token-llllllllllll',
      acceptedAt: new Date(),
      acceptedById: joiner.id,
    });

    const res = await request(app).get('/api/auth/invites/used-token-llllllllllll');

    expect(res.body.data.status).toBe('accepted');
  });

  it('404s on an unknown token', async () => {
    const res = await request(app).get('/api/auth/invites/no-such-token-mmmmmmmm');

    expect(res.status).toBe(404);
  });

  it('422s on a token too short to be one', async () => {
    const res = await request(app).get('/api/auth/invites/short');

    expect(res.status).toBe(422);
  });
});

describe('POST /api/auth/invites/:token/accept — register mode', () => {
  it('creates the account, grants both memberships, and consumes the link', async () => {
    const { admin, org } = await seedOrgWithRoles();
    const project = await seedProject(org.id, { key: 'ACME' });
    await seedInvite(org.id, {
      token: 'register-token-nnnnnnnnnnnn',
      email: 'newcomer@flowboard.dev',
      orgRole: 'admin',
      projectId: project.id,
      projectRole: 'member',
      invitedById: admin.id,
    });

    const res = await request(app)
      .post('/api/auth/invites/register-token-nnnnnnnnnnnn/accept')
      .send({ mode: 'register', name: 'Newcomer', password: 'a-fresh-password' });

    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({
      email: 'newcomer@flowboard.dev',
      name: 'Newcomer',
      isGlobalAdmin: false,
      isActive: true,
    });
    expect(res.body.data.orgId).toBe(org.id);
    expect(res.body.data.projectId).toBe(project.id);

    const newUserId: string = res.body.data.user.id;
    expect(await orgRolesOf(newUserId)).toEqual([{ orgId: org.id, role: 'admin' }]);
    expect(await projectRolesOf(newUserId)).toEqual([{ projectId: project.id, role: 'member' }]);

    // The returned pair is a real, working session.
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', bearer(res.body.data.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.data.memberships).toHaveLength(1);

    // And the account can log in with the password it just chose.
    const relogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'newcomer@flowboard.dev', password: 'a-fresh-password' });
    expect(relogin.status).toBe(200);

    // The link is spent.
    const preview = await request(app).get('/api/auth/invites/register-token-nnnnnnnnnnnn');
    expect(preview.body.data.status).toBe('accepted');
  });

  it('is not replayable — the second accept is a 409', async () => {
    const { org } = await seedOrgWithRoles();
    await seedInvite(org.id, {
      token: 'once-token-oooooooooooo',
      email: 'once@flowboard.dev',
    });

    const first = await request(app)
      .post('/api/auth/invites/once-token-oooooooooooo/accept')
      .send({ mode: 'register', name: 'Once', password: 'a-fresh-password' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/auth/invites/once-token-oooooooooooo/accept')
      .send({ mode: 'register', name: 'Twice', password: 'a-fresh-password' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('conflict');
  });

  it('refuses an expired link with 400', async () => {
    const { org } = await seedOrgWithRoles();
    await seedInvite(org.id, {
      token: 'expired-accept-pppppppppppp',
      email: 'late@flowboard.dev',
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await request(app)
      .post('/api/auth/invites/expired-accept-pppppppppppp/accept')
      .send({ mode: 'register', name: 'Late', password: 'a-fresh-password' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/expired/i);
  });

  it('refuses a body email that disagrees with the invite’s lock', async () => {
    const { org } = await seedOrgWithRoles();
    await seedInvite(org.id, {
      token: 'locked-token-qqqqqqqqqqqq',
      email: 'locked@flowboard.dev',
    });

    const res = await request(app).post('/api/auth/invites/locked-token-qqqqqqqqqqqq/accept').send({
      mode: 'register',
      name: 'Impostor',
      password: 'a-fresh-password',
      email: 'someone-else@flowboard.dev',
    });

    expect(res.status).toBe(400);
  });

  it('refuses register mode when the address already has an account', async () => {
    const { org } = await seedOrgWithRoles();
    const existing = await seedUser({ email: 'known@flowboard.dev' });
    await seedInvite(org.id, { token: 'dup-token-rrrrrrrrrrrr', email: existing.email });

    const res = await request(app)
      .post('/api/auth/invites/dup-token-rrrrrrrrrrrr/accept')
      .send({ mode: 'register', name: 'Known', password: 'a-fresh-password' });

    expect(res.status).toBe(409);
  });

  it('needs an email when the link is unlocked', async () => {
    const { org } = await seedOrgWithRoles();
    await seedInvite(org.id, { token: 'open-token-ssssssssssss' });

    const res = await request(app)
      .post('/api/auth/invites/open-token-ssssssssssss/accept')
      .send({ mode: 'register', name: 'Anon', password: 'a-fresh-password' });

    expect(res.status).toBe(400);
  });

  it('accepts a caller-supplied email on an unlocked link', async () => {
    const { org } = await seedOrgWithRoles();
    await seedInvite(org.id, { token: 'open-token-tttttttttttt' });

    const res = await request(app).post('/api/auth/invites/open-token-tttttttttttt/accept').send({
      mode: 'register',
      name: 'Anon',
      password: 'a-fresh-password',
      email: 'anon@flowboard.dev',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('anon@flowboard.dev');
  });

  it('refuses register mode from a caller who is already signed in', async () => {
    const { org } = await seedOrgWithRoles();
    const someone = await seedUser();
    await seedInvite(org.id, { token: 'signed-in-token-uuuuuuuu' });

    const res = await request(app)
      .post('/api/auth/invites/signed-in-token-uuuuuuuu/accept')
      .set('Authorization', bearer(tokensFor(someone).accessToken))
      .send({
        mode: 'register',
        name: 'Anon',
        password: 'a-fresh-password',
        email: 'anon@flowboard.dev',
      });

    expect(res.status).toBe(400);
  });

  it('rejects a body that is neither mode', async () => {
    const { org } = await seedOrgWithRoles();
    await seedInvite(org.id, { token: 'mode-token-vvvvvvvvvvvv' });

    const res = await request(app)
      .post('/api/auth/invites/mode-token-vvvvvvvvvvvv/accept')
      .send({ mode: 'teleport' });

    expect(res.status).toBe(422);
  });

  it('404s on an unknown token before it looks at the body', async () => {
    const res = await request(app)
      .post('/api/auth/invites/nope-token-wwwwwwwwwwww/accept')
      .send({ mode: 'register', name: 'Nobody', password: 'a-fresh-password' });

    expect(res.status).toBe(404);
  });
});

describe('POST /api/auth/invites/:token/accept — attach mode', () => {
  it('adds the org to an existing account and consumes the link', async () => {
    const { org } = await seedOrgWithRoles();
    const project = await seedProject(org.id, { key: 'ACME' });
    const outsider = await seedUser({ email: 'outsider@flowboard.dev' });
    await seedInvite(org.id, {
      token: 'attach-token-xxxxxxxxxxxx',
      email: outsider.email,
      orgRole: 'member',
      projectId: project.id,
      projectRole: 'viewer',
    });

    const res = await request(app)
      .post('/api/auth/invites/attach-token-xxxxxxxxxxxx/accept')
      .set('Authorization', bearer(tokensFor(outsider).accessToken))
      .send({ mode: 'attach' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.id).toBe(outsider.id);
    expect(res.body.data.orgId).toBe(org.id);
    expect(await orgRolesOf(outsider.id)).toEqual([{ orgId: org.id, role: 'member' }]);
    expect(await projectRolesOf(outsider.id)).toEqual([{ projectId: project.id, role: 'viewer' }]);

    const preview = await request(app).get('/api/auth/invites/attach-token-xxxxxxxxxxxx');
    expect(preview.body.data.status).toBe('accepted');
  });

  it('works on an unlocked link for any signed-in account', async () => {
    const { org } = await seedOrgWithRoles();
    const outsider = await seedUser();
    await seedInvite(org.id, { token: 'attach-open-yyyyyyyyyyyy', orgRole: 'admin' });

    const res = await request(app)
      .post('/api/auth/invites/attach-open-yyyyyyyyyyyy/accept')
      .set('Authorization', bearer(tokensFor(outsider).accessToken))
      .send({ mode: 'attach' });

    expect(res.status).toBe(201);
    expect(await orgRolesOf(outsider.id)).toEqual([{ orgId: org.id, role: 'admin' }]);
  });

  it('requires a Bearer token', async () => {
    const { org } = await seedOrgWithRoles();
    await seedInvite(org.id, { token: 'attach-anon-zzzzzzzzzzzz' });

    const res = await request(app)
      .post('/api/auth/invites/attach-anon-zzzzzzzzzzzz/accept')
      .send({ mode: 'attach' });

    expect(res.status).toBe(401);
  });

  it('forbids an account whose address is not the one the link is locked to', async () => {
    const { org } = await seedOrgWithRoles();
    const wrongPerson = await seedUser({ email: 'wrong@flowboard.dev' });
    await seedInvite(org.id, {
      token: 'attach-locked-aabbccddeeff',
      email: 'right@flowboard.dev',
    });

    const res = await request(app)
      .post('/api/auth/invites/attach-locked-aabbccddeeff/accept')
      .set('Authorization', bearer(tokensFor(wrongPerson).accessToken))
      .send({ mode: 'attach' });

    expect(res.status).toBe(403);
    expect(await orgRolesOf(wrongPerson.id)).toEqual([]);
  });

  it('rejects a revoked session even though the route is public', async () => {
    const { org } = await seedOrgWithRoles();
    const outsider = await seedUser();
    const { accessToken } = tokensFor(outsider);
    await request(app).post('/api/auth/logout?all=true').set('Authorization', bearer(accessToken));
    await seedInvite(org.id, { token: 'attach-revoked-112233445566' });

    const res = await request(app)
      .post('/api/auth/invites/attach-revoked-112233445566/accept')
      .set('Authorization', bearer(accessToken))
      .send({ mode: 'attach' });

    expect(res.status).toBe(401);
  });

  it('keeps the existing member idempotent-safe when re-invited into the same org', async () => {
    const { member, org } = await seedOrgWithRoles();
    await seedInvite(org.id, {
      token: 'attach-again-778899aabbcc',
      email: member.email,
      orgRole: 'member',
    });

    const res = await request(app)
      .post('/api/auth/invites/attach-again-778899aabbcc/accept')
      .set('Authorization', bearer(tokensFor(member).accessToken))
      .send({ mode: 'attach' });

    expect(res.status).toBe(201);
    expect(await orgRolesOf(member.id)).toEqual([{ orgId: org.id, role: 'member' }]);
  });

  it('is not replayable', async () => {
    const { org } = await seedOrgWithRoles();
    const outsider = await seedUser();
    await seedInvite(org.id, { token: 'attach-once-ddeeff001122' });
    const token = tokensFor(outsider).accessToken;

    const first = await request(app)
      .post('/api/auth/invites/attach-once-ddeeff001122/accept')
      .set('Authorization', bearer(token))
      .send({ mode: 'attach' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/auth/invites/attach-once-ddeeff001122/accept')
      .set('Authorization', bearer(token))
      .send({ mode: 'attach' });
    expect(second.status).toBe(409);
  });
});

describe('end-to-end: mint → preview → accept', () => {
  it('walks the whole flow through the HTTP surface only', async () => {
    const { admin, org } = await seedOrgWithRoles();

    const minted = await createInvite(org.id, tokensFor(admin).accessToken, {
      email: 'walk@flowboard.dev',
      orgRole: 'member',
    });
    expect(minted.status).toBe(201);
    const token: string = minted.body.data.token;

    const preview = await request(app).get(`/api/auth/invites/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({
      orgName: 'Acme',
      email: 'walk@flowboard.dev',
      requiresAccount: true,
      status: 'pending',
    });

    const accepted = await request(app)
      .post(`/api/auth/invites/${token}/accept`)
      .send({ mode: 'register', name: 'Walker', password: TEST_PASSWORD });
    expect(accepted.status).toBe(201);

    const list = await request(app)
      .get(`/api/orgs/${org.id}/invites`)
      .set('Authorization', bearer(tokensFor(admin).accessToken));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].acceptedAt).not.toBeNull();
  });
});
