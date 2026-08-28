/**
 * Project integration suite — `/api/orgs/:orgId/projects` and
 * `/api/projects/:projectId`.
 *
 * Two things here are load-bearing beyond the role matrix:
 *
 *  - **Default workflow seeding.** A project that committed without its three
 *    board columns would be unusable and unrepairable by any later request, so
 *    the create path is asserted on the statuses AND on the zero transition
 *    rows that make a fresh workflow fully open.
 *  - **Effective role resolution.** The list endpoint must widen org and global
 *    admins to `admin` server-side; the browser never re-derives the chain.
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { activity, closeDb, db, projectMembers, projects, workflowTransitions } from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import {
  addOrgMember,
  addProjectMember,
  bearer,
  createOrg,
  createProject,
  createProjectWorld,
  createTeam,
  createTestApp,
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

describe('GET /api/orgs/:orgId/projects', () => {
  it('shows a plain org member only the projects they hold a role on', async () => {
    const world = await createProjectWorld();
    await createProject(world.org.id, { name: 'Invisible' });

    const res = await request(app)
      .get(`/api/orgs/${world.org.id}/projects`)
      .set('Authorization', bearer(world.projectViewer));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: world.project.id, role: 'viewer' });
  });

  it('returns an empty list to an org member with no project roles', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .get(`/api/orgs/${world.org.id}/projects`)
      .set('Authorization', bearer(world.orgMember));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('widens an org admin to admin on every project in the org', async () => {
    const world = await createProjectWorld();
    await createProject(world.org.id);

    const res = await request(app)
      .get(`/api/orgs/${world.org.id}/projects`)
      .set('Authorization', bearer(world.orgAdmin));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((p: { role: string }) => p.role === 'admin')).toBe(true);
  });

  it('widens a global admin the same way with no membership rows at all', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .get(`/api/orgs/${world.org.id}/projects`)
      .set('Authorization', bearer(world.globalAdmin));

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ id: world.project.id, role: 'admin' });
  });

  it('hides archived projects by default and includes them on request', async () => {
    const world = await createProjectWorld();
    await createProject(world.org.id, { name: 'Archived', deleted: true });

    const byDefault = await request(app)
      .get(`/api/orgs/${world.org.id}/projects`)
      .set('Authorization', bearer(world.orgAdmin));
    expect(byDefault.body.data).toHaveLength(1);

    const withArchived = await request(app)
      .get(`/api/orgs/${world.org.id}/projects?includeArchived=true`)
      .set('Authorization', bearer(world.orgAdmin));
    expect(withArchived.body.data).toHaveLength(2);
  });

  it('403s a signed-in stranger', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .get(`/api/orgs/${world.org.id}/projects`)
      .set('Authorization', bearer(world.outsider));

    expect(res.status).toBe(403);
  });
});

describe('POST /api/orgs/:orgId/projects', () => {
  it('403s an org member', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .post(`/api/orgs/${world.org.id}/projects`)
      .set('Authorization', bearer(world.orgMember))
      .send({ key: 'NEW', name: 'New Project' });

    expect(res.status).toBe(403);
  });

  it('creates for an org admin, uppercasing the key', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .post(`/api/orgs/${world.org.id}/projects`)
      .set('Authorization', bearer(world.orgAdmin))
      .send({ key: 'flow', name: 'Flow' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ key: 'FLOW', name: 'Flow', role: 'admin' });
  });

  it('seeds the three default statuses and no transition rows', async () => {
    const world = await createProjectWorld();

    const created = await request(app)
      .post(`/api/orgs/${world.org.id}/projects`)
      .set('Authorization', bearer(world.orgAdmin))
      .send({ key: 'SEED', name: 'Seeded' });
    const projectId = created.body.data.id as string;

    const detail = await request(app)
      .get(`/api/projects/${projectId}`)
      .set('Authorization', bearer(world.orgAdmin));

    expect(detail.status).toBe(200);
    expect(detail.body.data.statuses.map((s: { name: string }) => s.name)).toEqual([
      'To Do',
      'In Progress',
      'Done',
    ]);
    expect(detail.body.data.statuses.map((s: { category: string }) => s.category)).toEqual([
      'todo',
      'in_progress',
      'done',
    ]);
    expect(detail.body.data.statuses.map((s: { position: number }) => s.position)).toEqual([
      0, 1, 2,
    ]);

    const transitions = await db
      .select()
      .from(workflowTransitions)
      .where(eq(workflowTransitions.projectId, projectId));
    expect(transitions).toEqual([]);
  });

  it('makes the creator the project admin and records project.created', async () => {
    const world = await createProjectWorld();

    const created = await request(app)
      .post(`/api/orgs/${world.org.id}/projects`)
      .set('Authorization', bearer(world.orgAdmin))
      .send({ key: 'AUD', name: 'Audited' });
    const projectId = created.body.data.id as string;

    const members = await db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.projectId, projectId));
    expect(members).toEqual([
      expect.objectContaining({ userId: world.orgAdmin.id, role: 'admin' }),
    ]);

    const rows = await db.select().from(activity).where(eq(activity.projectId, projectId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'project.created',
      actorId: world.orgAdmin.id,
      taskId: null,
      newValue: { key: 'AUD', name: 'Audited' },
    });
  });

  it('409s a key already used in the org, including by an archived project', async () => {
    const world = await createProjectWorld();
    await createProject(world.org.id, { key: 'TAKEN', deleted: true });

    const res = await request(app)
      .post(`/api/orgs/${world.org.id}/projects`)
      .set('Authorization', bearer(world.orgAdmin))
      .send({ key: 'TAKEN', name: 'Clash' });

    expect(res.status).toBe(409);
  });

  it('422s a key that breaks the shared format', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .post(`/api/orgs/${world.org.id}/projects`)
      .set('Authorization', bearer(world.orgAdmin))
      .send({ key: '9BAD', name: 'Bad Key' });

    expect(res.status).toBe(422);
  });

  it('400s a team that belongs to another organization', async () => {
    const world = await createProjectWorld();
    const otherOrg = await createOrg();
    const foreignTeam = await createTeam(otherOrg.id);

    const res = await request(app)
      .post(`/api/orgs/${world.org.id}/projects`)
      .set('Authorization', bearer(world.orgAdmin))
      .send({ key: 'TEAM', name: 'Wrong Team', teamId: foreignTeam.id });

    expect(res.status).toBe(400);
  });

  it('400s a lead who is not a member of the organization', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .post(`/api/orgs/${world.org.id}/projects`)
      .set('Authorization', bearer(world.orgAdmin))
      .send({ key: 'LEAD', name: 'Wrong Lead', leadId: world.outsider.id });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/projects/:projectId', () => {
  it('returns the boot payload to a viewer', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .get(`/api/projects/${world.project.id}`)
      .set('Authorization', bearer(world.projectViewer));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: world.project.id,
      key: world.project.key,
      role: 'viewer',
      memberCount: 3,
      labels: [],
    });
    expect(res.body.data.statuses).toHaveLength(3);
  });

  it('403s an org member with no project role', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .get(`/api/projects/${world.project.id}`)
      .set('Authorization', bearer(world.orgMember));

    expect(res.status).toBe(403);
  });

  it('404s an archived project', async () => {
    const world = await createProjectWorld();
    const archived = await createProject(world.org.id, { deleted: true });
    await addProjectMember(archived.id, world.projectViewer.id, 'viewer');

    const res = await request(app)
      .get(`/api/projects/${archived.id}`)
      .set('Authorization', bearer(world.projectViewer));

    expect(res.status).toBe(404);
  });

  it('resolves a global admin to role admin', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .get(`/api/projects/${world.project.id}`)
      .set('Authorization', bearer(world.globalAdmin));

    expect(res.body.data.role).toBe('admin');
  });
});

describe('PATCH /api/projects/:projectId', () => {
  it('403s a project member', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .patch(`/api/projects/${world.project.id}`)
      .set('Authorization', bearer(world.projectMember))
      .send({ name: 'Renamed' });

    expect(res.status).toBe(403);
  });

  it('updates for a project admin and audits one row per changed field', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .patch(`/api/projects/${world.project.id}`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ name: 'Renamed', leadId: world.projectMember.id });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: 'Renamed',
      leadId: world.projectMember.id,
      lead: { id: world.projectMember.id, name: 'Project Member' },
      role: 'admin',
    });

    const rows = await db.select().from(activity).where(eq(activity.projectId, world.project.id));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.field).sort()).toEqual(['leadId', 'name']);
    expect(rows.every((row) => row.action === 'project.updated')).toBe(true);
  });

  it('audits nothing when the patch changes no value', async () => {
    const world = await createProjectWorld();

    // The fixture project already has a null description, so this is a no-op
    // patch that still has to answer 200 with the current row.
    const res = await request(app)
      .patch(`/api/projects/${world.project.id}`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ description: null });

    expect(res.status).toBe(200);
    const rows = await db.select().from(activity).where(eq(activity.projectId, world.project.id));
    expect(rows).toEqual([]);
  });

  it('400s a lead from outside the organization', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .patch(`/api/projects/${world.project.id}`)
      .set('Authorization', bearer(world.projectAdmin))
      .send({ leadId: world.outsider.id });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/projects/:projectId', () => {
  it('403s a project member', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .delete(`/api/projects/${world.project.id}`)
      .set('Authorization', bearer(world.projectMember));

    expect(res.status).toBe(403);
  });

  it('archives for a project admin and the project stops resolving', async () => {
    const world = await createProjectWorld();

    const res = await request(app)
      .delete(`/api/projects/${world.project.id}`)
      .set('Authorization', bearer(world.projectAdmin));

    expect(res.status).toBe(204);

    const [row] = await db
      .select({ deletedAt: projects.deletedAt })
      .from(projects)
      .where(eq(projects.id, world.project.id));
    expect(row?.deletedAt).toBeInstanceOf(Date);

    const after = await request(app)
      .get(`/api/projects/${world.project.id}`)
      .set('Authorization', bearer(world.projectAdmin));
    expect(after.status).toBe(404);
  });

  it('writes a `project.deleted` audit row in the same transaction', async () => {
    const world = await createProjectWorld();

    await request(app)
      .delete(`/api/projects/${world.project.id}`)
      .set('Authorization', bearer(world.projectAdmin));

    // `activity` is append-only and never soft-deleted, so this row outlives
    // the project — which is the point. It is what the feed shows when somebody
    // asks where a project went, at exactly the moment nobody can go and look.
    const rows = await db
      .select({ oldValue: activity.oldValue, taskId: activity.taskId })
      .from(activity)
      .where(eq(activity.action, 'project.deleted'));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.oldValue).toMatchObject({ key: world.project.key });
    // Project-scoped, so no task.
    expect(rows[0]?.taskId).toBeNull();
  });

  it('leaves an unrelated org member unable to reach it either way', async () => {
    const world = await createProjectWorld();
    const otherOrg = await createOrg();
    await addOrgMember(otherOrg.id, world.outsider.id, 'admin');

    const res = await request(app)
      .delete(`/api/projects/${world.project.id}`)
      .set('Authorization', bearer(world.outsider));

    expect(res.status).toBe(403);
  });
});
