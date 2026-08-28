/**
 * `/api/projects/:projectId/members` integration suite.
 *
 * The rule worth its own suite is the ASYMMETRIC last-admin guard: a project
 * admin may not empty the admin list (they would lock themselves out), but an
 * org or global admin may, because the inheritance chain still gives them
 * access. Both halves are asserted, in both directions (demote and remove).
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

import { activity, closeDb, db, projectMembers } from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import { bearer, createProjectWorld, createTestApp } from './fixtures';

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

describe('GET /api/projects/:projectId/members', () => {
  it('lists members to a viewer', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .get(`/api/projects/${world.project.id}/members`)
      .set('Authorization', bearer(world.projectViewer));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data.map((m: { role: string }) => m.role).sort()).toEqual([
      'admin',
      'member',
      'viewer',
    ]);
  });

  it('403s an org member with no project role', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .get(`/api/projects/${world.project.id}/members`)
      .set('Authorization', bearer(world.orgMember));

    expect(res.status).toBe(403);
  });
});

describe('POST /api/projects/:projectId/members', () => {
  it('403s a project member', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .post(`/api/projects/${world.project.id}/members`)
      .set('Authorization', bearer(world.projectMember))
      .send({ userId: world.orgMember.id, role: 'viewer' });

    expect(res.status).toBe(403);
  });

  it('grants a role for a project admin and audits member.added', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .post(`/api/projects/${world.project.id}/members`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ userId: world.orgMember.id, role: 'member' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      projectId: world.project.id,
      user: { id: world.orgMember.id },
      role: 'member',
    });

    const rows = await db.select().from(activity).where(eq(activity.projectId, world.project.id));
    expect(rows).toEqual([
      expect.objectContaining({ action: 'member.added', actorId: world.projectAdmin.id }),
    ]);
  });

  it('400s someone who is not a member of the project organization', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .post(`/api/projects/${world.project.id}/members`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ userId: world.outsider.id, role: 'viewer' });

    expect(res.status).toBe(400);
  });

  it('409s an existing member', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .post(`/api/projects/${world.project.id}/members`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ userId: world.projectViewer.id, role: 'member' });

    expect(res.status).toBe(409);
  });
});

describe('PATCH /api/projects/:projectId/members/:userId', () => {
  it('403s a project member', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .patch(`/api/projects/${world.project.id}/members/${world.projectViewer.id}`)
      .set('Authorization', bearer(world.projectMember))
      .send({ role: 'admin' });

    expect(res.status).toBe(403);
  });

  it('changes a role for a project admin', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .patch(`/api/projects/${world.project.id}/members/${world.projectViewer.id}`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ role: 'member' });

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('member');
  });

  it('409s a project admin demoting the last project admin', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .patch(`/api/projects/${world.project.id}/members/${world.projectAdmin.id}`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ role: 'member' });

    expect(res.status).toBe(409);

    const [row] = await db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, world.project.id),
          eq(projectMembers.userId, world.projectAdmin.id),
        ),
      );
    expect(row?.role).toBe('admin');
  });

  it('lets an org admin demote the last project admin', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .patch(`/api/projects/${world.project.id}/members/${world.projectAdmin.id}`)
      .set('Authorization', bearer(world.orgAdmin))
      .send({ role: 'viewer' });

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('viewer');
  });

  it('404s a user who holds no role on the project', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .patch(`/api/projects/${world.project.id}/members/${world.orgMember.id}`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ role: 'member' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/projects/:projectId/members/:userId', () => {
  it('403s a project member', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .delete(`/api/projects/${world.project.id}/members/${world.projectViewer.id}`)
      .set('Authorization', bearer(world.projectMember));

    expect(res.status).toBe(403);
  });

  it('removes for a project admin and audits member.removed', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .delete(`/api/projects/${world.project.id}/members/${world.projectViewer.id}`)
      .set('Authorization', bearer(world.projectAdmin));

    expect(res.status).toBe(204);

    const rows = await db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.projectId, world.project.id));
    expect(rows).toHaveLength(2);

    const audit = await db.select().from(activity).where(eq(activity.projectId, world.project.id));
    expect(audit).toEqual([expect.objectContaining({ action: 'member.removed' })]);
  });

  it('409s a project admin removing the last project admin', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .delete(`/api/projects/${world.project.id}/members/${world.projectAdmin.id}`)
      .set('Authorization', bearer(world.projectAdmin));

    expect(res.status).toBe(409);
  });

  it('lets a global admin remove the last project admin', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .delete(`/api/projects/${world.project.id}/members/${world.projectAdmin.id}`)
      .set('Authorization', bearer(world.globalAdmin));

    expect(res.status).toBe(204);
  });
});
