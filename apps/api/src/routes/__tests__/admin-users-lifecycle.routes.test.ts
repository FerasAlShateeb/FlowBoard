/**
 * `/api/admin/users` — the Round 2 half: the memberships column, provisioning
 * INTO organizations, and `DELETE` as an anonymize-and-deactivate.
 *
 * `admin-users.routes.test.ts` covers the global-admin gate and the
 * revoke-on-deactivate consequence. This suite covers what deletion actually
 * means in a product that never drops a `users` row:
 *
 *  - the IDENTITY is scrubbed (name, email, avatar) and the account deactivated;
 *  - `token_version` is bumped, and `user.revoked` is published AFTER the
 *    commit so an already-open socket is closed rather than left streaming to a
 *    deleted account;
 *  - the MEMBERSHIPS go, org and project alike — scrubbing a name while leaving
 *    the account on three member lists deletes nothing that mattered;
 *  - the HISTORY survives. That is the whole reason the row is kept: comments,
 *    activity rows and assignments have to keep reading correctly.
 */
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  closeDb,
  comments,
  db,
  orgMembers,
  organizations,
  projectMembers,
  tasks,
  users,
} from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import { clearDomainEventHandlers, onDomainEvent } from '../../utils/domain-events';
import {
  addOrgMember,
  addProjectMember,
  bearer,
  createProject,
  createTask,
  createUser,
  type TestUser,
} from './fixtures';
import { buildInstanceAdminApp } from './instance-admin-test-app';

const app = buildInstanceAdminApp();

beforeAll(async () => {
  await ensureTestDb();
});

beforeEach(async () => {
  clearDomainEventHandlers();
  await truncateAllTables();
});

afterAll(async () => {
  clearDomainEventHandlers();
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

const listUsers = (user: TestUser, query = '') =>
  request(app).get(`/api/admin/users${query}`).set('Authorization', bearer(user));

const deleteUser = (actor: TestUser, userId: string) =>
  request(app).delete(`/api/admin/users/${userId}`).set('Authorization', bearer(actor));

interface ListedRow {
  id: string;
  name: string;
  memberships: { orgId: string; orgName: string; orgSlug: string; role: string }[];
}

function rowFor(body: { data: ListedRow[] }, userId: string): ListedRow {
  const row = body.data.find((entry) => entry.id === userId);
  if (!row) throw new Error(`user ${userId} not in the page`);
  return row;
}

describe('GET /api/admin/users — the memberships column', () => {
  it('carries every organization an account is in, denormalized', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const target = await createUser({ name: 'Multi' });
    const acme = await seedOrg('Acme Corporation', 'acme');
    const globex = await seedOrg('Globex Corp', 'globex');
    await addOrgMember(acme.id, target.id, 'admin');
    await addOrgMember(globex.id, target.id, 'member');

    const res = await listUsers(root);

    expect(res.status).toBe(200);
    const row = rowFor(res.body, target.id);
    expect(row.memberships).toEqual([
      { orgId: acme.id, orgName: 'Acme Corporation', orgSlug: 'acme', role: 'admin' },
      { orgId: globex.id, orgName: 'Globex Corp', orgSlug: 'globex', role: 'member' },
    ]);
  });

  it('answers with an empty array — not a missing field — for an account in no org', async () => {
    const root = await createUser({ isGlobalAdmin: true });

    const row = rowFor(await (await listUsers(root)).body, root.id);

    expect(row.memberships).toEqual([]);
  });

  it('excludes ARCHIVED organizations — a chip that links to a 404 is worse than none', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const target = await createUser();
    const live = await seedOrg('Live', 'live');
    const gone = await seedOrg('Gone', 'gone', { deleted: true });
    await addOrgMember(live.id, target.id, 'member');
    await addOrgMember(gone.id, target.id, 'member');

    const row = rowFor((await listUsers(root)).body, target.id);

    expect(row.memberships).toHaveLength(1);
    expect(row.memberships[0]?.orgSlug).toBe('live');
  });

  it('resolves every row on the page independently', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const acme = await seedOrg('Acme', 'acme');
    const globex = await seedOrg('Globex', 'globex');
    const first = await createUser();
    const second = await createUser();
    await addOrgMember(acme.id, first.id, 'member');
    await addOrgMember(globex.id, second.id, 'admin');

    const body = (await listUsers(root)).body;

    expect(rowFor(body, first.id).memberships[0]?.orgSlug).toBe('acme');
    expect(rowFor(body, second.id).memberships[0]?.orgSlug).toBe('globex');
    expect(rowFor(body, root.id).memberships).toEqual([]);
  });
});

describe('POST /api/admin/users — provisioning into organizations', () => {
  it('returns the memberships it just created, in list-row shape', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const acme = await seedOrg('Acme', 'acme');

    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', bearer(root))
      .send({
        email: 'newbie@flowboard.dev',
        name: 'Newbie',
        password: 'temporary-password',
        orgMemberships: [{ orgId: acme.id, role: 'admin' }],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.memberships).toEqual([
      { orgId: acme.id, orgName: 'Acme', orgSlug: 'acme', role: 'admin' },
    ]);
  });

  it('refuses an ARCHIVED organization and rolls the whole account back', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const gone = await seedOrg('Gone', 'gone', { deleted: true });

    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', bearer(root))
      .send({
        email: 'ghost@flowboard.dev',
        name: 'Ghost',
        password: 'temporary-password',
        orgMemberships: [{ orgId: gone.id, role: 'member' }],
      });

    expect(res.status).toBe(400);
    expect((await listUsers(root, '?q=ghost')).body.data).toEqual([]);
  });
});

describe('DELETE /api/admin/users/:userId', () => {
  it('403s a non-admin', async () => {
    const nobody = await createUser();
    const target = await createUser();

    const res = await deleteUser(nobody, target.id);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('401s without a session', async () => {
    const target = await createUser();
    expect((await request(app).delete(`/api/admin/users/${target.id}`)).status).toBe(401);
  });

  it('422s a non-uuid id', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    expect((await deleteUser(root, 'nope')).status).toBe(422);
  });

  it('404s an account that does not exist', async () => {
    const root = await createUser({ isGlobalAdmin: true });

    const res = await deleteUser(root, '00000000-0000-4000-8000-000000000000');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('refuses SELF-deletion — recovering from it needs another admin', async () => {
    const root = await createUser({ isGlobalAdmin: true });

    const res = await deleteUser(root, root.id);

    expect(res.status).toBe(400);
    const [row] = await db.select().from(users).where(eq(users.id, root.id));
    expect(row?.isActive).toBe(true);
  });

  it('scrubs the identity and deactivates the account', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const target = await createUser({ name: 'Dana Weiss' });
    await db
      .update(users)
      .set({ avatarUrl: 'https://example.test/dana.png' })
      .where(eq(users.id, target.id));

    const res = await deleteUser(root, target.id);

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({
      id: target.id,
      name: 'Deleted user',
      avatarUrl: null,
      isActive: false,
    });
    expect(res.body.data.user.email).toMatch(/^deleted\+[0-9a-f-]+@flowboard\.invalid$/u);
  });

  it('keeps the row — the id is still the author of everything it wrote', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const target = await createUser();
    const org = await seedOrg('Acme', 'acme');
    const project = await createProject(org.id);
    const task = await createTask(project.id, project.statusIds[0]);
    const [comment] = await db
      .insert(comments)
      .values({ taskId: task.id, authorId: target.id, body: 'Still here.' })
      .returning({ id: comments.id });

    await deleteUser(root, target.id);

    const [row] = await db.select().from(users).where(eq(users.id, target.id));
    expect(row).toBeDefined();
    const [survivor] = await db
      .select({ authorId: comments.authorId })
      .from(comments)
      .where(eq(comments.id, comment?.id ?? ''));
    expect(survivor?.authorId).toBe(target.id);
  });

  /**
   * THE MENTION MARKUP IS PART OF THE IDENTITY (R2 W3.5).
   *
   * `@[Display Name](userId)` stores the name captured at write time, so
   * scrubbing the `users` row alone left the deleted person's real name
   * rendering inside every comment and task description that had ever mentioned
   * them — the one place a name is actually read. Both bodies are asserted, and
   * so is a mention of a DIFFERENT user in the same string: the rewrite is
   * pinned to one id, and a regex that lost that pin would silently anonymize
   * everybody.
   */
  it("rewrites the deleted account's mentions in comments and task descriptions, and leaves other people's alone", async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const target = await createUser({ name: 'Dana Weiss' });
    const bystander = await createUser({ name: 'Ada Lovelace' });
    const org = await seedOrg('Acme', 'acme');
    const project = await createProject(org.id);
    const task = await createTask(project.id, project.statusIds[0]);

    const body = `cc @[Dana Weiss](${target.id}) and @[Ada Lovelace](${bystander.id}) — thanks @[Dana Weiss](${target.id})`;
    const [comment] = await db
      .insert(comments)
      .values({ taskId: task.id, authorId: bystander.id, body })
      .returning({ id: comments.id });
    await db
      .update(tasks)
      .set({
        description: `Owner: @[Dana Weiss](${target.id}). Reviewer: @[Ada Lovelace](${bystander.id}).`,
      })
      .where(eq(tasks.id, task.id));

    await deleteUser(root, target.id);

    const [scrubbedComment] = await db
      .select({ body: comments.body })
      .from(comments)
      .where(eq(comments.id, comment?.id ?? ''));
    // BOTH occurrences — the replace is global within a body.
    expect(scrubbedComment?.body).toBe(
      `cc @[Deleted user](${target.id}) and @[Ada Lovelace](${bystander.id}) — thanks @[Deleted user](${target.id})`,
    );
    expect(scrubbedComment?.body).not.toContain('Dana Weiss');

    const [scrubbedTask] = await db
      .select({ description: tasks.description })
      .from(tasks)
      .where(eq(tasks.id, task.id));
    expect(scrubbedTask?.description).toBe(
      `Owner: @[Deleted user](${target.id}). Reviewer: @[Ada Lovelace](${bystander.id}).`,
    );
  });

  /**
   * The id half of `MENTION_PATTERN` is `[0-9a-fA-F]`, so a hand-written body
   * can carry an uppercase uuid and still be a mention the renderer chips and
   * `extractMentionUserIds` notifies. The scrub matches case-insensitively for
   * exactly that reason.
   */
  it('rewrites a mention written with an uppercase uuid', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const target = await createUser({ name: 'Dana Weiss' });
    const org = await seedOrg('Acme', 'acme');
    const project = await createProject(org.id);
    const task = await createTask(project.id, project.statusIds[0]);
    const [comment] = await db
      .insert(comments)
      .values({
        taskId: task.id,
        authorId: root.id,
        body: `ping @[Dana Weiss](${target.id.toUpperCase()})`,
      })
      .returning({ id: comments.id });

    await deleteUser(root, target.id);

    const [row] = await db
      .select({ body: comments.body })
      .from(comments)
      .where(eq(comments.id, comment?.id ?? ''));
    expect(row?.body).not.toContain('Dana Weiss');
    expect(row?.body).toContain('@[Deleted user]');
  });

  /**
   * Prose that merely LOOKS like a mention is left alone: the `~*` in the WHERE
   * is the same regex as the replace, so a body with no real mention is not even
   * written — which is what keeps `updated_at` honest across the instance.
   */
  it('leaves prose that is not a mention untouched, and does not rewrite unrelated bodies', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const target = await createUser({ name: 'Dana Weiss' });
    const org = await seedOrg('Acme', 'acme');
    const project = await createProject(org.id);
    const task = await createTask(project.id, project.statusIds[0]);
    const prose = `email dana@example.test, see @[Dana Weiss](not-a-uuid) and ${target.id}`;
    const [comment] = await db
      .insert(comments)
      .values({ taskId: task.id, authorId: root.id, body: prose })
      .returning({ id: comments.id, updatedAt: comments.updatedAt });

    await deleteUser(root, target.id);

    const [row] = await db
      .select({ body: comments.body, updatedAt: comments.updatedAt })
      .from(comments)
      .where(eq(comments.id, comment?.id ?? ''));
    expect(row?.body).toBe(prose);
    expect(row?.updatedAt.getTime()).toBe(comment?.updatedAt.getTime());
  });

  it('drops every org AND project membership, and reports the org count', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const target = await createUser();
    const acme = await seedOrg('Acme', 'acme');
    const globex = await seedOrg('Globex', 'globex');
    const project = await createProject(acme.id);
    await addOrgMember(acme.id, target.id, 'member');
    await addOrgMember(globex.id, target.id, 'admin');
    await addProjectMember(project.id, target.id, 'member');

    const res = await deleteUser(root, target.id);

    expect(res.body.data.membershipsRemoved).toBe(2);
    expect(await db.select().from(orgMembers).where(eq(orgMembers.userId, target.id))).toEqual([]);
    expect(
      await db.select().from(projectMembers).where(eq(projectMembers.userId, target.id)),
    ).toEqual([]);
  });

  it('reports zero for an account that belonged to nothing', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const target = await createUser();

    expect((await deleteUser(root, target.id)).body.data.membershipsRemoved).toBe(0);
  });

  it('bumps token_version, which kills every issued token', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const target = await createUser();
    const [before] = await db
      .select({ tokenVersion: users.tokenVersion })
      .from(users)
      .where(eq(users.id, target.id));

    await deleteUser(root, target.id);

    const [after] = await db
      .select({ tokenVersion: users.tokenVersion })
      .from(users)
      .where(eq(users.id, target.id));
    expect(after?.tokenVersion).toBe((before?.tokenVersion ?? 0) + 1);
  });

  it('publishes `user.revoked` so an already-open socket is closed', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const target = await createUser();
    const revoked: string[] = [];
    const off = onDomainEvent('user.revoked', ({ userId }) => revoked.push(userId));

    await deleteUser(root, target.id);
    off();

    expect(revoked).toEqual([target.id]);
  });

  it('publishes NOTHING when the request is refused', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const revoked: string[] = [];
    const off = onDomainEvent('user.revoked', ({ userId }) => revoked.push(userId));

    await deleteUser(root, root.id);
    await deleteUser(root, '00000000-0000-4000-8000-000000000000');
    off();

    expect(revoked).toEqual([]);
  });

  it('409s a second deletion — the account is already anonymous', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const target = await createUser();

    expect((await deleteUser(root, target.id)).status).toBe(200);
    const again = await deleteUser(root, target.id);

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('conflict');
  });

  it('gives each deletion a unique address, so the unique index holds', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const first = await createUser();
    const second = await createUser();

    const one = await deleteUser(root, first.id);
    const two = await deleteUser(root, second.id);

    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    expect(one.body.data.user.email).not.toBe(two.body.data.user.email);
  });

  it('still lists the scrubbed row, with no memberships left', async () => {
    const root = await createUser({ isGlobalAdmin: true });
    const target = await createUser();
    const acme = await seedOrg('Acme', 'acme');
    await addOrgMember(acme.id, target.id, 'member');

    await deleteUser(root, target.id);
    const row = rowFor((await listUsers(root)).body, target.id);

    expect(row.name).toBe('Deleted user');
    expect(row.memberships).toEqual([]);
  });
});
