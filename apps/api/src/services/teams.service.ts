/**
 * Team logic.
 *
 * Teams are a ROSTER, never a permission boundary (see `teams.schema.ts`), so
 * nothing in this file touches access resolution — every caller has already
 * passed `requireOrgRole`.
 *
 * Two rules live here:
 *  - a team is soft-deleted, and the same transaction detaches every project
 *    that pointed at it, so no project is left showing a team that has stopped
 *    existing;
 *  - a roster may only contain accounts that are members of the owning org — a
 *    team is a subdivision of the org, not a back door into it.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Team, TeamDetail, TeamMember } from '@flowboard/shared';

import { db, orgMembers, projects, teamMembers, teams, users, withTx } from '../db';
import { ApiError } from '../utils/api-error';
import { isUniqueViolation } from './pg-errors';

const teamColumns = {
  id: teams.id,
  orgId: teams.orgId,
  name: teams.name,
  description: teams.description,
  createdAt: teams.createdAt,
  updatedAt: teams.updatedAt,
};

interface TeamColumnRow {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Correlated roster size. The column names are spelled out because drizzle
 * renders `${table.column}` unqualified inside a raw `sql` projection on a
 * single-table select — which in a correlated subquery silently compares the
 * inner table to itself. See the longer note in `orgs.service.ts`.
 */
const memberCountSql = sql<number>`(
  SELECT count(*)::int FROM ${teamMembers}
  WHERE ${teamMembers}."team_id" = ${teams}."id"
)`;

function toTeam(row: TeamColumnRow, memberCount: number): Team {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    description: row.description,
    memberCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** `GET /orgs/:orgId/teams` — any org member. */
export async function listTeams(orgId: string): Promise<Team[]> {
  const rows = await db
    .select({ ...teamColumns, memberCount: memberCountSql })
    .from(teams)
    .where(and(eq(teams.orgId, orgId), isNull(teams.deletedAt)))
    .orderBy(asc(teams.name));
  return rows.map((row) => toTeam(row, row.memberCount));
}

/** Load a live team of this org, or throw 404. */
async function requireTeam(orgId: string, teamId: string): Promise<TeamColumnRow> {
  const [row] = await db
    .select(teamColumns)
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.orgId, orgId), isNull(teams.deletedAt)))
    .limit(1);
  if (!row) throw ApiError.notFound('Team not found');
  return row;
}

async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
  const rows = await db
    .select({
      teamId: teamMembers.teamId,
      joinedAt: teamMembers.createdAt,
      userId: users.id,
      name: users.name,
      avatarUrl: users.avatarUrl,
    })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teamMembers.teamId, teamId))
    .orderBy(asc(users.name));

  return rows.map((row) => ({
    teamId: row.teamId,
    user: { id: row.userId, name: row.name, avatarUrl: row.avatarUrl },
    joinedAt: row.joinedAt.toISOString(),
  }));
}

/** `GET /orgs/:orgId/teams/:teamId` — the team plus its roster. */
export async function getTeamDetail(orgId: string, teamId: string): Promise<TeamDetail> {
  const row = await requireTeam(orgId, teamId);
  const members = await listTeamMembers(teamId);
  return { ...toTeam(row, members.length), members };
}

/**
 * `POST /orgs/:orgId/teams` — org admin.
 *
 * The name index is partial (`WHERE deleted_at IS NULL`), so a soft-deleted
 * "Platform" does not block a new one — which is why the pre-check filters on
 * live rows too and the constraint catch is the only race guard needed.
 */
export async function createTeam(
  orgId: string,
  input: { name: string; description: string | null },
): Promise<Team> {
  try {
    const [row] = await db
      .insert(teams)
      .values({ orgId, name: input.name, description: input.description })
      .returning(teamColumns);
    if (!row) throw ApiError.internal('Team insert returned no row');
    return toTeam(row, 0);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw ApiError.conflict('A team with that name already exists in this organization');
    }
    throw error;
  }
}

/** `PATCH /orgs/:orgId/teams/:teamId` — org admin. */
export async function updateTeam(
  orgId: string,
  teamId: string,
  input: { name?: string; description?: string | null },
): Promise<Team> {
  await requireTeam(orgId, teamId);
  try {
    await db
      .update(teams)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
      })
      .where(and(eq(teams.id, teamId), eq(teams.orgId, orgId), isNull(teams.deletedAt)));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw ApiError.conflict('A team with that name already exists in this organization');
    }
    throw error;
  }

  const row = await requireTeam(orgId, teamId);
  const [count] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId));
  return toTeam(row, count?.total ?? 0);
}

/**
 * `DELETE /orgs/:orgId/teams/:teamId` — org admin, soft.
 *
 * `projects.team_id` is `ON DELETE SET NULL`, but a SOFT delete never fires that
 * trigger; the detach is therefore explicit, and shares the transaction so a
 * project can never point at a team that is already gone.
 */
export async function softDeleteTeam(orgId: string, teamId: string): Promise<void> {
  await requireTeam(orgId, teamId);
  await withTx(async (tx) => {
    await tx.update(projects).set({ teamId: null }).where(eq(projects.teamId, teamId));
    await tx
      .update(teams)
      .set({ deletedAt: new Date() })
      .where(and(eq(teams.id, teamId), eq(teams.orgId, orgId), isNull(teams.deletedAt)));
  });
}

/**
 * `PUT /orgs/:orgId/teams/:teamId/members` — org admin, whole-set replace.
 *
 * Duplicates in the request are collapsed rather than rejected: the input is a
 * SET, and a multi-select that emits the same id twice is a client bug the user
 * cannot act on.
 */
export async function replaceTeamMembers(
  orgId: string,
  teamId: string,
  userIds: readonly string[],
): Promise<TeamDetail> {
  await requireTeam(orgId, teamId);
  const unique = [...new Set(userIds)];

  if (unique.length > 0) {
    const rows = await db
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), inArray(orgMembers.userId, unique)));
    const allowed = new Set(rows.map((row) => row.userId));
    const strangers = unique.filter((id) => !allowed.has(id));
    if (strangers.length > 0) {
      throw ApiError.badRequest('Every team member must be a member of the organization', {
        userIds: strangers,
      });
    }
  }

  await withTx(async (tx) => {
    await tx.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
    if (unique.length > 0) {
      await tx.insert(teamMembers).values(unique.map((userId) => ({ teamId, userId })));
    }
  });

  return getTeamDetail(orgId, teamId);
}
