/**
 * WP2.2 integration-test support: a minimal app that mounts only this work
 * package's routers, plus row builders that write fixtures straight to the
 * database.
 *
 * WHY ROWS AND NOT THE API: a role-matrix suite has to arrange states the API
 * deliberately refuses to create (an org whose only admin is someone else, a
 * project a viewer can see but not touch, a soft-deleted org). Building those
 * through endpoints would mean the arrangement shares failure modes with the
 * assertion — a broken guard would quietly produce a passing test.
 *
 * Lives in `__tests__/` rather than beside the suites because `tsconfig.json`
 * excludes that folder from the build: this module imports `supertest`, a
 * devDependency that must never reach `dist/`.
 */
import express, { type Express } from 'express';
import type { OrgRole, ProjectRole, StatusCategory } from '@flowboard/shared';

import {
  db,
  labels,
  organizations,
  orgMembers,
  projectMembers,
  projects,
  statuses,
  tasks,
  teamMembers,
  teams,
  users,
} from '../../db';
import { errorHandler, notFound } from '../../middlewares/error-handler';
import { signAccessToken } from '../../utils/jwt';
import { orgsRouter } from '../orgs.routes';
import { projectsRouter } from '../projects.routes';

/**
 * The app under test.
 *
 * Deliberately NOT `createApp()`: this suite must fail when WP2.2's routers
 * break, not when a sibling work package's router is mid-edit. The pieces that
 * shape the contract — JSON body parsing, the 404 fallthrough and the single
 * error-envelope formatter — are all here; the rate limiter and request logger
 * are not, because neither changes a response body.
 */
export function createTestApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use('/api/orgs', orgsRouter);
  app.use('/api/projects', projectsRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

let sequence = 0;
/** Monotonic suffix so slugs, keys and emails stay unique inside a suite. */
function nextId(): number {
  sequence += 1;
  return sequence;
}

export interface TestUser {
  id: string;
  name: string;
  email: string;
  token: string;
}

/** Insert a user and mint a matching access token (same `tokenVersion`). */
export async function createUser(
  overrides: { name?: string; isGlobalAdmin?: boolean; isActive?: boolean } = {},
): Promise<TestUser> {
  const n = nextId();
  const name = overrides.name ?? `User ${n}`;
  const email = `user${n}@flowboard.test`;
  const [row] = await db
    .insert(users)
    .values({
      email,
      name,
      passwordHash: 'scrypt$test',
      isGlobalAdmin: overrides.isGlobalAdmin ?? false,
      isActive: overrides.isActive ?? true,
    })
    .returning({ id: users.id, tokenVersion: users.tokenVersion });
  if (!row) throw new Error('user insert returned no row');

  return {
    id: row.id,
    name,
    email,
    token: signAccessToken({
      sub: row.id,
      tokenVersion: row.tokenVersion,
      isGlobalAdmin: overrides.isGlobalAdmin ?? false,
    }),
  };
}

/** `Authorization` header for a fixture user. */
export function bearer(user: TestUser): string {
  return `Bearer ${user.token}`;
}

export async function createOrg(
  overrides: { name?: string; deleted?: boolean } = {},
): Promise<{ id: string; slug: string }> {
  const n = nextId();
  const slug = `org-${n}`;
  const [row] = await db
    .insert(organizations)
    .values({
      name: overrides.name ?? `Org ${n}`,
      slug,
      deletedAt: overrides.deleted === true ? new Date() : null,
    })
    .returning({ id: organizations.id });
  if (!row) throw new Error('org insert returned no row');
  return { id: row.id, slug };
}

export async function addOrgMember(
  orgId: string,
  userId: string,
  role: OrgRole = 'member',
): Promise<void> {
  await db.insert(orgMembers).values({ orgId, userId, role });
}

export async function createTeam(orgId: string, name?: string): Promise<{ id: string }> {
  const [row] = await db
    .insert(teams)
    .values({ orgId, name: name ?? `Team ${nextId()}` })
    .returning({ id: teams.id });
  if (!row) throw new Error('team insert returned no row');
  return { id: row.id };
}

export async function addTeamMember(teamId: string, userId: string): Promise<void> {
  await db.insert(teamMembers).values({ teamId, userId });
}

export interface TestProject {
  id: string;
  key: string;
  /** The three seeded statuses, in board order. */
  statusIds: [string, string, string];
}

/**
 * A project with the same three-column workflow `POST /orgs/:orgId/projects`
 * seeds, written directly so suites that are not testing creation can start
 * from a usable board.
 */
export async function createProject(
  orgId: string,
  overrides: { key?: string; name?: string; teamId?: string | null; deleted?: boolean } = {},
): Promise<TestProject> {
  const n = nextId();
  const key = overrides.key ?? `P${n}`;
  const [row] = await db
    .insert(projects)
    .values({
      orgId,
      key,
      name: overrides.name ?? `Project ${n}`,
      teamId: overrides.teamId ?? null,
      deletedAt: overrides.deleted === true ? new Date() : null,
    })
    .returning({ id: projects.id });
  if (!row) throw new Error('project insert returned no row');

  const seeded: { name: string; category: StatusCategory; color: string }[] = [
    { name: 'To Do', category: 'todo', color: '#64748b' },
    { name: 'In Progress', category: 'in_progress', color: '#3b82f6' },
    { name: 'Done', category: 'done', color: '#22c55e' },
  ];
  const statusRows = await db
    .insert(statuses)
    .values(
      seeded.map((status, position) => ({
        projectId: row.id,
        name: status.name,
        category: status.category,
        color: status.color,
        position,
      })),
    )
    .returning({ id: statuses.id, position: statuses.position });

  const ordered = [...statusRows].sort((a, b) => a.position - b.position).map((s) => s.id);
  const [todo, inProgress, done] = ordered;
  if (todo === undefined || inProgress === undefined || done === undefined) {
    throw new Error('status seed returned the wrong number of rows');
  }

  return { id: row.id, key, statusIds: [todo, inProgress, done] };
}

export async function addProjectMember(
  projectId: string,
  userId: string,
  role: ProjectRole,
): Promise<void> {
  await db.insert(projectMembers).values({ projectId, userId, role });
}

export async function createLabel(
  projectId: string,
  overrides: { name?: string; color?: string } = {},
): Promise<{ id: string }> {
  const [row] = await db
    .insert(labels)
    .values({
      projectId,
      name: overrides.name ?? `label-${nextId()}`,
      color: overrides.color ?? '#ff00ff',
    })
    .returning({ id: labels.id });
  if (!row) throw new Error('label insert returned no row');
  return { id: row.id };
}

/** A task pinned to a status — the fixture the status-delete matrix needs. */
export async function createTask(
  projectId: string,
  statusId: string,
  overrides: { title?: string; boardRank?: string } = {},
): Promise<{ id: string }> {
  const n = nextId();
  const [row] = await db
    .insert(tasks)
    .values({
      projectId,
      number: n,
      title: overrides.title ?? `Task ${n}`,
      statusId,
      boardRank: overrides.boardRank ?? `a${n.toString().padStart(3, '0')}`,
      backlogRank: `a${n.toString().padStart(3, '0')}`,
    })
    .returning({ id: tasks.id });
  if (!row) throw new Error('task insert returned no row');
  return { id: row.id };
}

/**
 * A ready-made project world: an org, a project, and one account per role.
 *
 * Every mutating-endpoint test needs the same cast — someone allowed and
 * someone not — so building it once keeps each suite's arrangement to a line.
 */
export interface ProjectWorld {
  org: { id: string; slug: string };
  project: TestProject;
  globalAdmin: TestUser;
  orgAdmin: TestUser;
  orgMember: TestUser;
  projectAdmin: TestUser;
  projectMember: TestUser;
  projectViewer: TestUser;
  /** Not a member of the org at all — the "shouldn't see this exists" case. */
  outsider: TestUser;
}

export async function createProjectWorld(): Promise<ProjectWorld> {
  const org = await createOrg();
  const project = await createProject(org.id);

  const [globalAdmin, orgAdmin, orgMember, projectAdmin, projectMember, projectViewer, outsider] =
    await Promise.all([
      createUser({ isGlobalAdmin: true, name: 'Global Admin' }),
      createUser({ name: 'Org Admin' }),
      createUser({ name: 'Org Member' }),
      createUser({ name: 'Project Admin' }),
      createUser({ name: 'Project Member' }),
      createUser({ name: 'Project Viewer' }),
      createUser({ name: 'Outsider' }),
    ]);

  await addOrgMember(org.id, orgAdmin.id, 'admin');
  for (const member of [orgMember, projectAdmin, projectMember, projectViewer]) {
    await addOrgMember(org.id, member.id, 'member');
  }

  await addProjectMember(project.id, projectAdmin.id, 'admin');
  await addProjectMember(project.id, projectMember.id, 'member');
  await addProjectMember(project.id, projectViewer.id, 'viewer');

  return {
    org,
    project,
    globalAdmin,
    orgAdmin,
    orgMember,
    projectAdmin,
    projectMember,
    projectViewer,
    outsider,
  };
}
