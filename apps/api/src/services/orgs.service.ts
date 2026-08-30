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
import { and, asc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import type {
  Org,
  OrgAdminRow,
  OrgListQuery,
  OrgMember,
  OrgRole,
  OrgUser,
  OrgWithRole,
  UserListQuery,
} from '@flowboard/shared';

import { db, organizations, orgMembers, projects, teams, users, withTx, type Tx } from '../db';
import { ApiError } from '../utils/api-error';
import { publishDomainEvent } from '../utils/domain-events';
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
 * `?q=` — a case-insensitive fragment match on the org NAME or its SLUG.
 *
 * Both, because the two are how an organization is addressed in the two places
 * this filter is used: a human types the name into the switcher, and an admin
 * chasing a support ticket has the slug out of a URL.
 */
function orgSearchFilter(q: string | undefined): SQL | undefined {
  if (q === undefined || q.length === 0) return undefined;
  const pattern = `%${q}%`;
  return or(ilike(organizations.name, pattern), ilike(organizations.slug, pattern));
}

/**
 * `GET /orgs?q=&scope=&includeDeleted=` — the org switcher's feed.
 *
 * A global admin sees every live organization at role `admin` even without a
 * membership row: the guard chain already grants them that access, and a
 * switcher that hid the orgs they can administer would make the product
 * unnavigable for the one account that has to fix things.
 *
 * `scope=member` turns that branch OFF — the server half of view-as-member. An
 * admin who has switched into a member's view must see the switcher a member
 * would see, and filtering the admin list client-side would be a lie the moment
 * a page refetched. For everyone else it is a no-op, because the branch it skips
 * was never taken.
 */
export async function listOrgsForUser(
  actor: Actor,
  query: OrgListQuery = {},
): Promise<OrgWithRole[]> {
  const search = orgSearchFilter(query.q);

  if (actor.isGlobalAdmin && query.scope !== 'member') {
    const rows = await db
      .select({ ...orgColumns, memberCount: memberCountSql, projectCount: projectCountSql })
      .from(organizations)
      .where(and(isNull(organizations.deletedAt), search))
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
    .where(and(eq(orgMembers.userId, actor.id), isNull(organizations.deletedAt), search))
    .orderBy(asc(organizations.name));

  return rows.map((row) => ({
    ...toOrg(row),
    role: row.role,
    memberCount: row.memberCount,
    projectCount: row.projectCount,
  }));
}

/**
 * `GET /orgs?includeDeleted=1` — the ADMIN organizations table, archived rows
 * included.
 *
 * A different SHAPE, not just a different filter: {@link OrgAdminRow} carries
 * `deletedAt` and drops `role`, because a global admin administers organizations
 * they are not a member of and a synthetic `'admin'` would make the client's
 * permission checks agree with a fiction.
 */
async function listOrgsForAdmin(query: OrgListQuery): Promise<OrgAdminRow[]> {
  const rows = await db
    .select({
      ...orgColumns,
      deletedAt: organizations.deletedAt,
      memberCount: memberCountSql,
      projectCount: projectCountSql,
    })
    .from(organizations)
    .where(orgSearchFilter(query.q))
    .orderBy(asc(organizations.name));

  return rows.map((row) => ({
    ...toOrg(row),
    deletedAt: row.deletedAt === null ? null : row.deletedAt.toISOString(),
    memberCount: row.memberCount,
    projectCount: row.projectCount,
  }));
}

/**
 * `GET /orgs` — the one endpoint behind the switcher AND the admin table.
 *
 * ── WHICH SHAPE COMES BACK, AND WHY IT SWITCHES ON `includeDeleted` ALONE ───
 * `includeDeleted=1` returns {@link OrgAdminRow}s; anything else returns
 * {@link OrgWithRole}s. It is deliberately NOT `q`, even though `q` is also
 * mostly an admin-table parameter: the org SWITCHER sends `q` too once a
 * deployment has more organizations than a combobox can render, and a global
 * admin typing into it would then get rows with no `role` — a switcher that
 * silently breaks for exactly one account. One flag, one shape, and the flag is
 * the one only the admin table ever sets.
 *
 * `includeDeleted` is GLOBAL-ADMIN ONLY and refused here rather than in the
 * schema: soft-deleted organizations are what the restore flow acts on, and a
 * member must never be able to enumerate them. A zod schema cannot know who is
 * asking.
 *
 * @throws {ApiError} 403 when a non-global-admin asks for archived rows.
 */
export async function listOrgs(
  actor: Actor,
  query: OrgListQuery,
): Promise<OrgWithRole[] | OrgAdminRow[]> {
  if (query.includeDeleted !== true) return listOrgsForUser(actor, query);
  if (!actor.isGlobalAdmin) {
    throw ApiError.forbidden('Global administrator access required to list archived organizations');
  }
  return listOrgsForAdmin(query);
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

/**
 * The envelope code a taken organization slug answers with.
 *
 * `slug_taken`, NOT the generic `conflict` (W3.1). The web catalog maps
 * `conflict` to "Someone else changed this first. Refresh and try again." —
 * the optimistic-concurrency sentence — and refreshing does nothing for a slug
 * that simply belongs to another organization. `errors:slug_taken` ("That
 * address is already in use. Pick another.") was already in both catalogs with
 * no emitter; this is the emitter, and it is the only message that names the
 * field the operator has to change.
 *
 * `org_slug_conflict` stays its own code on the RESTORE path: there the slug
 * was free when the org was archived and was taken since, so the remedy is
 * different and `AdminOrgsPage` branches on it by hand.
 */
const SLUG_TAKEN = 'slug_taken';
const SLUG_TAKEN_MESSAGE = 'That organization slug is already in use';

/** 409 if the slug is taken — including by a soft-deleted org, whose unique index still holds it. */
async function assertSlugFree(slug: string, excludeOrgId?: string): Promise<void> {
  const [taken] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  if (taken && taken.id !== excludeOrgId) {
    throw new ApiError(409, SLUG_TAKEN, SLUG_TAKEN_MESSAGE);
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
        throw new ApiError(409, SLUG_TAKEN, SLUG_TAKEN_MESSAGE);
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
 *
 * ── IT ALSO KICKS THE LIVE ROOMS (R2 W3.5) ─────────────────────────────────
 * "Stops resolving" is a rule about REQUESTS, and R2 W3.5 made the project
 * guards and `project:join` honour it. A socket that is ALREADY in one of this
 * org's project rooms asked its permission question once, at join time, so it
 * would go on receiving task, comment and presence traffic for an organization
 * that had just been switched off. `org.archived` is published so the realtime
 * bridge can empty those rooms — the same shape as the `user.revoked` pattern,
 * one step less severe (rooms, not connections; see the bridge's handler).
 *
 * The project ids are read BEFORE the update, in the same statement's window,
 * and the event is published AFTER it — the house rule for every domain event.
 * A rolled-back archive must not evict anybody, and reading first is what makes
 * the list the set of projects that were live when the archive landed.
 */
export async function softDeleteOrg(orgId: string): Promise<void> {
  const liveProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), isNull(projects.deletedAt)));

  const [row] = await db
    .update(organizations)
    .set({ deletedAt: new Date() })
    .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
    .returning({ id: organizations.id });
  if (!row) throw ApiError.notFound('Organization not found');

  publishDomainEvent('org.archived', {
    orgId,
    projectIds: liveProjects.map((project) => project.id),
  });
}

/**
 * `POST /orgs/:orgId/restore` — global admin, the other half of the soft delete.
 *
 * ── THE THREE ANSWERS, AND WHY THEY ARE DIFFERENT ──────────────────────────
 *   - **404** — no such organization. Note this read does NOT filter
 *     `deleted_at IS NULL`: this is the one endpoint whose whole subject is an
 *     archived row, so the usual "soft-deleted orgs do not exist" rule is
 *     suspended here and nowhere else.
 *   - **409 `conflict`** — it is already live. Answering 200 would make the
 *     admin table's Restore button look like it did something on a row that was
 *     never archived, which is how a stale list becomes a wrong mental model.
 *   - **409 `org_slug_conflict`** — the slug is no longer free.
 *
 * That last branch is UNREACHABLE TODAY, on purpose. `organizations.slug` is
 * unconditionally unique, so archiving an org keeps its slug reserved and no
 * second org can ever hold it (this is also what stops a deleted org's
 * `/o/:slug` links being silently reassigned). The guard exists because the
 * obvious future change — making that index partial on `deleted_at IS NULL` so
 * archiving frees the name — would turn restore into a driver-level unique
 * violation, i.e. a 500. With the check in place it is already a 409 with a code
 * the client can branch on. The catch below is the belt to the pre-check's
 * braces: only the database can rule on a slug taken between the two statements.
 */
export async function restoreOrg(orgId: string): Promise<OrgAdminRow> {
  const [existing] = await db
    .select({ id: organizations.id, slug: organizations.slug, deletedAt: organizations.deletedAt })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!existing) throw ApiError.notFound('Organization not found');
  if (existing.deletedAt === null) {
    throw ApiError.conflict('That organization is not archived');
  }

  const [clash] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      and(
        eq(organizations.slug, existing.slug),
        isNull(organizations.deletedAt),
        sql`${organizations.id} <> ${orgId}`,
      ),
    )
    .limit(1);
  if (clash) {
    throw new ApiError(
      409,
      'org_slug_conflict',
      'A live organization already uses that slug — rename it before restoring this one',
    );
  }

  try {
    await db.update(organizations).set({ deletedAt: null }).where(eq(organizations.id, orgId));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(
        409,
        'org_slug_conflict',
        'A live organization already uses that slug — rename it before restoring this one',
      );
    }
    throw error;
  }

  const [row] = await db
    .select({
      ...orgColumns,
      deletedAt: organizations.deletedAt,
      memberCount: memberCountSql,
      projectCount: projectCountSql,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!row) throw ApiError.internal('Restored organization could not be read back');

  return {
    ...toOrg(row),
    deletedAt: row.deletedAt === null ? null : row.deletedAt.toISOString(),
    memberCount: row.memberCount,
    projectCount: row.projectCount,
  };
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
