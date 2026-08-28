/**
 * Organization + org-membership logic.
 *
 * Two rules are enforced here and nowhere else:
 *
 *  - **Soft-deleted orgs do not exist.** Every read filters
 *    `organizations.deleted_at IS NULL`; `requireOrgRole` does the same, so a
 *    deleted org 404s at the guard before a controller can leak it.
 *  - **An org always has at least one admin.** Removing or demoting the last
 *    `admin` row is a 409, because the alternative is an organization nobody can
 *    administer and only a global admin can rescue.
 *
 * Org membership is NOT written to the `activity` stream: `activity.project_id`
 * is `NOT NULL`, so the audit table cannot hold an org-level row. See the note
 * on {@link addOrgMember}.
 */
import { and, asc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import type {
  Org,
  OrgMember,
  OrgRole,
  OrgUser,
  OrgWithRole,
  UserListQuery,
} from '@flowboard/shared';

import { db, organizations, orgMembers, projects, teams, users, withTx, type Tx } from '../db';
import { ApiError } from '../utils/api-error';
import type { CreateOrgBody } from '../validation/orgs.validation';
import { isUniqueViolation } from './pg-errors';

/** The caller, as every service in this package needs to know them. */
export interface Actor {
  id: string;
  isGlobalAdmin: boolean;
}

/**
 * `GET /orgs/:orgId` — the org header. Extends the list row with the team count
 * the org home page renders next to members and projects.
 */
export interface OrgDetail extends OrgWithRole {
  teamCount: number;
}

/**
 * Correlated counts, so one round-trip answers the whole org card.
 *
 * ── Why the column names are written out ────────────────────────────────────
 * Drizzle renders a `${table.column}` chunk inside a raw `sql` PROJECTION
 * *unqualified* when the surrounding select has a single table (its
 * `isSingleTable` optimization). In a correlated subquery that is silently
 * wrong: `WHERE "org_id" = "id"` resolves both sides against the SUBQUERY's
 * table, so the count is always 0 and nothing errors.
 *
 * Interpolating the TABLE (`${teams}` → `"teams"`) and spelling the column out
 * forces full qualification in every context. The names are the physical
 * snake_case ones, which `src/db/schema.test.ts` pins.
 */
const memberCountSql = sql<number>`(
  SELECT count(*)::int FROM ${orgMembers}
  WHERE ${orgMembers}."org_id" = ${organizations}."id"
)`;

const projectCountSql = sql<number>`(
  SELECT count(*)::int FROM ${projects}
  WHERE ${projects}."org_id" = ${organizations}."id" AND ${projects}."deleted_at" IS NULL
)`;

const teamCountSql = sql<number>`(
  SELECT count(*)::int FROM ${teams}
  WHERE ${teams}."org_id" = ${organizations}."id" AND ${teams}."deleted_at" IS NULL
)`;

const orgColumns = {
  id: organizations.id,
  name: organizations.name,
  slug: organizations.slug,
  createdAt: organizations.createdAt,
  updatedAt: organizations.updatedAt,
};

interface OrgColumnRow {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

function toOrg(row: OrgColumnRow): Org {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * `GET /orgs` — the org switcher's feed.
 *
 * A global admin sees every live organization at role `admin` even without a
 * membership row: the guard chain already grants them that access, and a
 * switcher that hid the orgs they can administer would make the product
 * unnavigable for the one account that has to fix things.
 */
export async function listOrgsForUser(actor: Actor): Promise<OrgWithRole[]> {
  if (actor.isGlobalAdmin) {
    const rows = await db
      .select({ ...orgColumns, memberCount: memberCountSql, projectCount: projectCountSql })
      .from(organizations)
      .where(isNull(organizations.deletedAt))
      .orderBy(asc(organizations.name));
    return rows.map((row) => ({
      ...toOrg(row),
      role: 'admin' as const,
      memberCount: row.memberCount,
      projectCount: row.projectCount,
    }));
  }

  const rows = await db
    .select({
      ...orgColumns,
      role: orgMembers.role,
      memberCount: memberCountSql,
      projectCount: projectCountSql,
    })
    .from(orgMembers)
    .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
    .where(and(eq(orgMembers.userId, actor.id), isNull(organizations.deletedAt)))
    .orderBy(asc(organizations.name));

  return rows.map((row) => ({
    ...toOrg(row),
    role: row.role,
    memberCount: row.memberCount,
    projectCount: row.projectCount,
  }));
}

/** Load one live org with its counts, or throw 404. */
export async function getOrgDetail(orgId: string, role: OrgRole): Promise<OrgDetail> {
  const [row] = await db
    .select({
      ...orgColumns,
      memberCount: memberCountSql,
      projectCount: projectCountSql,
      teamCount: teamCountSql,
    })
    .from(organizations)
    .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
    .limit(1);

  if (!row) throw ApiError.notFound('Organization not found');

  return {
    ...toOrg(row),
    role,
    memberCount: row.memberCount,
    projectCount: row.projectCount,
    teamCount: row.teamCount,
  };
}

/** 409 if the slug is taken — including by a soft-deleted org, whose unique index still holds it. */
async function assertSlugFree(slug: string, excludeOrgId?: string): Promise<void> {
  const [taken] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (taken && taken.id !== excludeOrgId) {
    throw ApiError.conflict('That organization slug is already in use');
  }
}

/**
 * `POST /orgs` — global-admin surface.
 *
 * The org row and its first admin membership are written in ONE transaction:
 * an org with no admin is unusable, so the two writes must not be able to come
 * apart.
 */
export async function createOrg(input: CreateOrgBody, actor: Actor): Promise<OrgDetail> {
  const adminUserId = input.adminUserId ?? actor.id;
  await assertSlugFree(input.slug);

  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, adminUserId), eq(users.isActive, true)))
    .limit(1);
  if (!admin) throw ApiError.notFound('The chosen organization admin does not exist');

  const created = await withTx(async (tx) => {
    let row: OrgColumnRow | undefined;
    try {
      [row] = await tx
        .insert(organizations)
        .values({ name: input.name, slug: input.slug, createdById: actor.id })
        .returning(orgColumns);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict('That organization slug is already in use');
      }
      throw error;
    }
    if (!row) throw ApiError.internal('Organization insert returned no row');

    await tx.insert(orgMembers).values({ orgId: row.id, userId: adminUserId, role: 'admin' });
    return row;
  });

  return {
    ...toOrg(created),
    role: 'admin',
    memberCount: 1,
    projectCount: 0,
    teamCount: 0,
  };
}

/** `PATCH /orgs/:orgId` — org admin. */
export async function updateOrg(
  orgId: string,
  input: { name?: string; slug?: string },
  role: OrgRole,
): Promise<OrgDetail> {
  if (input.slug !== undefined) await assertSlugFree(input.slug, orgId);

  const [row] = await db
    .update(organizations)
    .set({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.slug === undefined ? {} : { slug: input.slug }),
    })
    .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
    .returning({ id: organizations.id });

  if (!row) throw ApiError.notFound('Organization not found');
  return getOrgDetail(orgId, role);
}

/**
 * `DELETE /orgs/:orgId` — global admin, soft.
 *
 * The row keeps its projects, tasks and history; it simply stops resolving. The
 * slug stays reserved on purpose (the unique index is unconditional), so a
 * deleted org's `/o/:slug` links can never be silently reassigned to a new org.
 */
export async function softDeleteOrg(orgId: string): Promise<void> {
  const [row] = await db
    .update(organizations)
    .set({ deletedAt: new Date() })
    .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
    .returning({ id: organizations.id });
  if (!row) throw ApiError.notFound('Organization not found');
}

const memberColumns = {
  orgId: orgMembers.orgId,
  role: orgMembers.role,
  joinedAt: orgMembers.createdAt,
  userId: users.id,
  name: users.name,
  avatarUrl: users.avatarUrl,
  email: users.email,
};

interface MemberColumnRow {
  orgId: string;
  role: OrgRole;
  joinedAt: Date;
  userId: string;
  name: string;
  avatarUrl: string | null;
  email: string;
}

function toOrgMember(row: MemberColumnRow): OrgMember {
  return {
    orgId: row.orgId,
    user: { id: row.userId, name: row.name, avatarUrl: row.avatarUrl },
    email: row.email,
    role: row.role,
    joinedAt: row.joinedAt.toISOString(),
  };
}

/** Case-insensitive name-or-email match for the `?q=` filter. */
function searchFilter(q: string | undefined) {
  if (q === undefined || q.length === 0) return undefined;
  const pattern = `%${q}%`;
  return or(ilike(users.name, pattern), ilike(users.email, pattern));
}

/** `GET /orgs/:orgId/members` — any org member. */
export async function listOrgMembers(orgId: string, query: UserListQuery): Promise<OrgMember[]> {
  const filters = [eq(orgMembers.orgId, orgId), searchFilter(query.q)];
  if (query.isActive !== undefined) filters.push(eq(users.isActive, query.isActive));

  const rows = await db
    .select(memberColumns)
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(and(...filters))
    .orderBy(asc(users.name));

  return rows.map(toOrgMember);
}

/**
 * `GET /orgs/:orgId/users` — the picker/mention directory.
 *
 * Deactivated accounts are excluded: this list exists to be assigned work from,
 * and someone who can no longer sign in must not be assignable. The members
 * table (above) still shows them, because an admin has to be able to see and
 * remove them.
 */
export async function listOrgUsers(orgId: string, query: UserListQuery): Promise<OrgUser[]> {
  const rows = await db
    .select(memberColumns)
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(and(eq(orgMembers.orgId, orgId), eq(users.isActive, true), searchFilter(query.q)))
    .orderBy(asc(users.name));

  return rows.map((row) => {
    const member = toOrgMember(row);
    return { user: member.user, email: member.email, role: member.role };
  });
}

/** Read one membership back in its response shape. Throws 404 when absent. */
async function loadOrgMember(orgId: string, userId: string): Promise<OrgMember> {
  const [row] = await db
    .select(memberColumns)
    .from(orgMembers)
    .innerJoin(users, eq(orgMembers.userId, users.id))
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  if (!row) throw ApiError.notFound('That user is not a member of this organization');
  return toOrgMember(row);
}

/**
 * `POST /orgs/:orgId/members` — org admin. Accepts an id or an email.
 *
 * NOT audited: `activity.project_id` is `NOT NULL`, so the audit stream has no
 * room for an org-level row. Project membership (`project-members.service.ts`)
 * IS audited, because it has a project to hang off. Reported as a schema gap.
 */
export async function addOrgMember(
  orgId: string,
  input: { userId?: string; email?: string; role: OrgRole },
): Promise<OrgMember> {
  const identity =
    input.userId === undefined ? ilike(users.email, input.email ?? '') : eq(users.id, input.userId);

  const [user] = await db.select({ id: users.id }).from(users).where(identity).limit(1);
  if (!user) throw ApiError.notFound('No account matches that user');

  const [existing] = await db
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, user.id)))
    .limit(1);
  if (existing) throw ApiError.conflict('That user is already a member of this organization');

  try {
    await db.insert(orgMembers).values({ orgId, userId: user.id, role: input.role });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw ApiError.conflict('That user is already a member of this organization');
    }
    throw error;
  }

  return loadOrgMember(orgId, user.id);
}

/** How many admins the org has right now. Read inside the guarding transaction. */
async function countOrgAdmins(orgId: string, executor: Tx): Promise<number> {
  const [row] = await executor
    .select({ total: sql<number>`count(*)::int` })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, 'admin')));
  return row?.total ?? 0;
}

/**
 * `PATCH /orgs/:orgId/members/:userId` — promote or demote.
 *
 * Demoting the last admin is refused: it is the same "orphaned organization"
 * outcome as removing them, reached by a different button.
 */
export async function updateOrgMemberRole(
  orgId: string,
  userId: string,
  role: OrgRole,
): Promise<OrgMember> {
  await withTx(async (tx) => {
    const [current] = await tx
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
      .limit(1);
    if (!current) throw ApiError.notFound('That user is not a member of this organization');

    if (current.role === 'admin' && role !== 'admin') {
      const admins = await countOrgAdmins(orgId, tx);
      if (admins <= 1) {
        throw ApiError.conflict('An organization must keep at least one administrator');
      }
    }

    await tx
      .update(orgMembers)
      .set({ role })
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));
  });

  return loadOrgMember(orgId, userId);
}

/** `DELETE /orgs/:orgId/members/:userId` — refuses the last admin. */
export async function removeOrgMember(orgId: string, userId: string): Promise<void> {
  await withTx(async (tx) => {
    const [current] = await tx
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
      .limit(1);
    if (!current) throw ApiError.notFound('That user is not a member of this organization');

    if (current.role === 'admin') {
      const admins = await countOrgAdmins(orgId, tx);
      if (admins <= 1) {
        throw ApiError.conflict('An organization must keep at least one administrator');
      }
    }

    await tx
      .delete(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)));
  });
}
