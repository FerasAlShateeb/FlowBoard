/**
 * `/api/orgs/:orgId/teams` integration suite.
 *
 * Teams are an org-admin surface with member-level reads, so the matrix is
 * small; the interesting assertions are the two invariants the service owns —
 * a soft delete detaches the projects that pointed at the team, and a roster
 * may only contain accounts that already belong to the organization.
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { closeDb, db, projects, teams } from '../../db';
import { ensureTestDb, truncateAllTables } from '../../test/test-db';
import {
  addOrgMember,
  addTeamMember,
  bearer,
  createOrg,
  createProject,
  createTeam,
  createTestApp,
  createUser,
  type TestUser,
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

interface World {
  org: { id: string; slug: string };
  admin: TestUser;
  member: TestUser;
  stranger: TestUser;
}

async function seedWorld(): Promise<World> {
  const org = await createOrg();
  const admin = await createUser({ name: 'Org Admin' });
  const member = await createUser({ name: 'Org Member' });
  const stranger = await createUser({ name: 'Stranger' });
  await addOrgMember(org.id, admin.id, 'admin');
  await addOrgMember(org.id, member.id, 'member');
  return { org, admin, member, stranger };
}

describe('GET /api/orgs/:orgId/teams', () => {
  it('lists live teams with their roster size for any org member', async () => {
    const { org, member } = await seedWorld();
    const team = await createTeam(org.id, 'Platform');
    await addTeamMember(team.id, member.id);

    const res = await request(app)
      .get(`/api/orgs/${org.id}/teams`)
      .set('Authorization', bearer(member));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id: team.id,
      orgId: org.id,
      name: 'Platform',
      memberCount: 1,
    });
  });

  it('403s a signed-in stranger', async () => {
    const { org, stranger } = await seedWorld();

    const res = await request(app)
      .get(`/api/orgs/${org.id}/teams`)
      .set('Authorization', bearer(stranger));

    expect(res.status).toBe(403);
  });
});

describe('POST /api/orgs/:orgId/teams', () => {
  it('403s an org member', async () => {
    const { org, member } = await seedWorld();

    const res = await request(app)
      .post(`/api/orgs/${org.id}/teams`)
      .set('Authorization', bearer(member))
      .send({ name: 'Platform' });

    expect(res.status).toBe(403);
  });

  it('creates for an org admin', async () => {
    const { org, admin } = await seedWorld();

    const res = await request(app)
      .post(`/api/orgs/${org.id}/teams`)
      .set('Authorization', bearer(admin))
      .send({ name: 'Platform', description: 'Owns the pipes' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      orgId: org.id,
      name: 'Platform',
      description: 'Owns the pipes',
      memberCount: 0,
    });
  });

  it('409s a duplicate name inside the same org', async () => {
    const { org, admin } = await seedWorld();
    await createTeam(org.id, 'Platform');

    const res = await request(app)
      .post(`/api/orgs/${org.id}/teams`)
      .set('Authorization', bearer(admin))
      .send({ name: 'Platform' });

    expect(res.status).toBe(409);
  });
});

describe('GET /api/orgs/:orgId/teams/:teamId', () => {
  it('returns the team with its roster', async () => {
    const { org, member } = await seedWorld();
    const team = await createTeam(org.id, 'Platform');
    await addTeamMember(team.id, member.id);

    const res = await request(app)
      .get(`/api/orgs/${org.id}/teams/${team.id}`)
      .set('Authorization', bearer(member));

    expect(res.status).toBe(200);
    expect(res.body.data.members).toHaveLength(1);
    expect(res.body.data.members[0]).toMatchObject({
      teamId: team.id,
      user: { id: member.id, name: 'Org Member' },
    });
  });

  it('404s a team from another organization', async () => {
    const { admin } = await seedWorld();
    const other = await createOrg();
    const foreign = await createTeam(other.id);
    const mine = await createOrg();
    await addOrgMember(mine.id, admin.id, 'admin');

    const res = await request(app)
      .get(`/api/orgs/${mine.id}/teams/${foreign.id}`)
      .set('Authorization', bearer(admin));

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/orgs/:orgId/teams/:teamId', () => {
  it('403s an org member', async () => {
    const { org, member } = await seedWorld();
    const team = await createTeam(org.id);

    const res = await request(app)
      .patch(`/api/orgs/${org.id}/teams/${team.id}`)
      .set('Authorization', bearer(member))
      .send({ name: 'Renamed' });

    expect(res.status).toBe(403);
  });

  it('renames for an org admin', async () => {
    const { org, admin } = await seedWorld();
    const team = await createTeam(org.id);

    const res = await request(app)
      .patch(`/api/orgs/${org.id}/teams/${team.id}`)
      .set('Authorization', bearer(admin))
      .send({ name: 'Renamed', description: null });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Renamed', description: null });
  });

  it('422s an empty patch', async () => {
    const { org, admin } = await seedWorld();
    const team = await createTeam(org.id);

    const res = await request(app)
      .patch(`/api/orgs/${org.id}/teams/${team.id}`)
      .set('Authorization', bearer(admin))
      .send({});

    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/orgs/:orgId/teams/:teamId', () => {
  it('403s an org member', async () => {
    const { org, member } = await seedWorld();
    const team = await createTeam(org.id);

    const res = await request(app)
      .delete(`/api/orgs/${org.id}/teams/${team.id}`)
      .set('Authorization', bearer(member));

    expect(res.status).toBe(403);
  });

  it('soft-deletes and detaches the projects that pointed at it', async () => {
    const { org, admin } = await seedWorld();
    const team = await createTeam(org.id);
    const project = await createProject(org.id, { teamId: team.id });

    const res = await request(app)
      .delete(`/api/orgs/${org.id}/teams/${team.id}`)
      .set('Authorization', bearer(admin));

    expect(res.status).toBe(204);

    const [teamRow] = await db
      .select({ deletedAt: teams.deletedAt })
      .from(teams)
      .where(eq(teams.id, team.id));
    expect(teamRow?.deletedAt).toBeInstanceOf(Date);

    const [projectRow] = await db
      .select({ teamId: projects.teamId })
      .from(projects)
      .where(eq(projects.id, project.id));
    expect(projectRow?.teamId).toBeNull();

    const list = await request(app)
      .get(`/api/orgs/${org.id}/teams`)
      .set('Authorization', bearer(admin));
    expect(list.body.data).toEqual([]);
  });
});

describe('PUT /api/orgs/:orgId/teams/:teamId/members', () => {
  it('403s an org member', async () => {
    const { org, member } = await seedWorld();
    const team = await createTeam(org.id);

    const res = await request(app)
      .put(`/api/orgs/${org.id}/teams/${team.id}/members`)
      .set('Authorization', bearer(member))
      .send({ userId: [] });

    expect(res.status).toBe(403);
  });

  it('replaces the whole roster for an org admin', async () => {
    const { org, admin, member } = await seedWorld();
    const team = await createTeam(org.id);
    await addTeamMember(team.id, admin.id);

    const res = await request(app)
      .put(`/api/orgs/${org.id}/teams/${team.id}/members`)
      .set('Authorization', bearer(admin))
      .send({ userIds: [member.id] });

    expect(res.status).toBe(200);
    expect(res.body.data.members).toHaveLength(1);
    expect(res.body.data.members[0].user.id).toBe(member.id);
  });

  it('accepts an empty roster', async () => {
    const { org, admin, member } = await seedWorld();
    const team = await createTeam(org.id);
    await addTeamMember(team.id, member.id);

    const res = await request(app)
      .put(`/api/orgs/${org.id}/teams/${team.id}/members`)
      .set('Authorization', bearer(admin))
      .send({ userIds: [] });

    expect(res.status).toBe(200);
    expect(res.body.data.members).toEqual([]);
  });

  it('400s when an id is not a member of the organization', async () => {
    const { org, admin, stranger } = await seedWorld();
    const team = await createTeam(org.id);

    const res = await request(app)
      .put(`/api/orgs/${org.id}/teams/${team.id}/members`)
      .set('Authorization', bearer(admin))
      .send({ userIds: [stranger.id] });

    expect(res.status).toBe(400);
    expect(res.body.error.details.userIds).toEqual([stranger.id]);
  });

  it('collapses duplicate ids instead of failing the unique key', async () => {
    const { org, admin, member } = await seedWorld();
    const team = await createTeam(org.id);

    const res = await request(app)
      .put(`/api/orgs/${org.id}/teams/${team.id}/members`)
      .set('Authorization', bearer(admin))
      .send({ userIds: [member.id, member.id] });

    expect(res.status).toBe(200);
    expect(res.body.data.members).toHaveLength(1);
  });
});
