/**
 * Project membership — the explicit `project_members` grants.
 *
 * The last-admin rule here is deliberately WEAKER than the org one. An org with
 * no admin is unrecoverable without a global admin; a project with no explicit
 * admin is still administered by every org admin through the inheritance chain.
 * So the guard refuses only when the caller is themselves just a project admin —
 * an org or global admin may empty the list, because they keep access either
 * way.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import type { ProjectMember, ProjectRole } from '@flowboard/shared';

import { db, orgMembers, projectMembers, users, withTx } from '../db';
import type { Tx } from '../db';
import { ApiError } from '../utils/api-error';
import { recordActivity } from './activity.service';
import { isUniqueViolation } from './pg-errors';
import type { Actor } from './orgs.service';
import type { ActorContext } from './projects.service';

const memberColumns = {
  projectId: projectMembers.projectId,
  role: projectMembers.role,
  joinedAt: projectMembers.createdAt,
  userId: users.id,
  name: users.name,
  avatarUrl: users.avatarUrl,
};

interface MemberColumnRow {
  projectId: string;
  role: ProjectRole;
  joinedAt: Date;
  userId: string;
  name: string;
  avatarUrl: string | null;
}

function toProjectMember(row: MemberColumnRow): ProjectMember {
  return {
    projectId: row.projectId,
    user: { id: row.userId, name: row.name, avatarUrl: row.avatarUrl },
    role: row.role,
    joinedAt: row.joinedAt.toISOString(),
  };
}

/** `GET /projects/:projectId/members` — any project viewer. */
export async function listProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const rows = await db
    .select(memberColumns)
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(users.name));
  return rows.map(toProjectMember);
}

async function loadProjectMember(projectId: string, userId: string): Promise<ProjectMember> {
  const [row] = await db
    .select(memberColumns)
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.userId, users.id))
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  if (!row) throw ApiError.notFound('That user is not a member of this project');
  return toProjectMember(row);
}

/**
 * Does the caller outrank the project? Global admins and org admins do, and
 * that is what lifts the last-project-admin guard for them.
 */
export async function outranksProject(actor: Actor, orgId: string): Promise<boolean> {
  if (actor.isGlobalAdmin) return true;
  const [row] = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, actor.id)))
    .limit(1);
  return row?.role === 'admin';
}

async function countProjectAdmins(projectId: string, executor: Tx): Promise<number> {
  const [row] = await executor
    .select({ total: sql<number>`count(*)::int` })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, 'admin')));
  return row?.total ?? 0;
}

/**
 * `POST /projects/:projectId/members` — project admin.
 *
 * The grantee must already be a member of the project's ORG: a project role is
 * a narrowing of org access, never a way around it.
 */
export async function addProjectMember(
  projectId: string,
  orgId: string,
  input: { userId: string; role: ProjectRole },
  context: ActorContext,
): Promise<ProjectMember> {
  const [inOrg] = await db
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, input.userId)))
    .limit(1);
  if (!inOrg) {
    throw ApiError.badRequest("That user is not a member of this project's organization");
  }

  const [existing] = await db
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, input.userId)))
    .limit(1);
  if (existing) throw ApiError.conflict('That user is already a member of this project');

  await withTx(async (tx) => {
    try {
      await tx.insert(projectMembers).values({ projectId, userId: input.userId, role: input.role });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict('That user is already a member of this project');
      }
      throw error;
    }
    await recordActivity(
      {
        projectId,
        actorId: context.actorId,
        action: 'member.added',
        field: 'projectMember',
        newValue: { userId: input.userId, role: input.role },
      },
      tx,
    );
  });

  return loadProjectMember(projectId, input.userId);
}

/** `PATCH /projects/:projectId/members/:userId` — project admin. */
export async function updateProjectMemberRole(
  projectId: string,
  userId: string,
  role: ProjectRole,
  options: { callerOutranksProject: boolean },
): Promise<ProjectMember> {
  await withTx(async (tx) => {
    const [current] = await tx
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    if (!current) throw ApiError.notFound('That user is not a member of this project');

    if (current.role === 'admin' && role !== 'admin' && !options.callerOutranksProject) {
      const admins = await countProjectAdmins(projectId, tx);
      if (admins <= 1) {
        throw ApiError.conflict('A project must keep at least one administrator');
      }
    }

    await tx
      .update(projectMembers)
      .set({ role })
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
  });

  return loadProjectMember(projectId, userId);
}

/** `DELETE /projects/:projectId/members/:userId` — project admin. */
export async function removeProjectMember(
  projectId: string,
  userId: string,
  context: ActorContext,
  options: { callerOutranksProject: boolean },
): Promise<void> {
  await withTx(async (tx) => {
    const [current] = await tx
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    if (!current) throw ApiError.notFound('That user is not a member of this project');

    if (current.role === 'admin' && !options.callerOutranksProject) {
      const admins = await countProjectAdmins(projectId, tx);
      if (admins <= 1) {
        throw ApiError.conflict('A project must keep at least one administrator');
      }
    }

    await tx
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));

    await recordActivity(
      {
        projectId,
        actorId: context.actorId,
        action: 'member.removed',
        field: 'projectMember',
        oldValue: { userId, role: current.role },
      },
      tx,
    );
  });
}
