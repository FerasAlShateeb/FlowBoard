/**
 * The CROSS-ORGANIZATION project list (`GET /api/admin/projects`).
 *
 * Every other project read in FlowBoard is org-scoped: it resolves a project,
 * then its org, then the caller's membership, and answers 403 for anything else
 * (`middlewares/require-roles.ts`). This one asks the opposite question — "every
 * project in the deployment, whoever owns it" — which is why it lives behind the
 * global-admin floor on its own router rather than as a route on `projectsRouter`.
 *
 * ── ONE ROUND TRIP PER PAGE ────────────────────────────────────────────────
 * The row carries four derived numbers (members, tasks, open tasks, last
 * activity), and the naive shape of that is a query per project per column. All
 * four are CORRELATED SUBQUERIES in the projection instead, so a page of 25 is
 * two statements: the count and the page.
 *
 * ── WHY THE COLUMN NAMES ARE WRITTEN OUT IN THE RAW SQL ────────────────────
 * The same trap `orgs.service.ts` documents: Drizzle renders a `${table.column}`
 * chunk inside a raw `sql` projection UNQUALIFIED when the surrounding select has
 * a single table, and in a correlated subquery that silently resolves both sides
 * against the subquery's own table — a count that is always zero and never
 * errors. Interpolating the TABLE and spelling the column out forces full
 * qualification in every context. The names are the physical snake_case ones,
 * which `src/db/schema.test.ts` pins.
 */
import { and, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { AdminProjectRow, PaginationMeta } from '@flowboard/shared';

import {
  activity,
  db,
  organizations,
  projectMembers,
  projects,
  statuses,
  tasks,
  users,
} from '../db';
import type { AdminProjectsListQuery } from '../validation/admin-projects.validation';

/** A page of projects plus the envelope's `meta` block. */
export interface AdminProjectPage {
  rows: AdminProjectRow[];
  meta: PaginationMeta;
}

const memberCountSql = sql<number>`(
  SELECT count(*)::int FROM ${projectMembers}
  WHERE ${projectMembers}."project_id" = ${projects}."id"
)`;

const taskCountSql = sql<number>`(
  SELECT count(*)::int FROM ${tasks}
  WHERE ${tasks}."project_id" = ${projects}."id" AND ${tasks}."deleted_at" IS NULL
)`;

/**
 * Live tasks that are not in a `done` column.
 *
 * "Open" is defined by the status CATEGORY, not by a status name or by
 * `resolved_at`: workflows are per-project data (a column may be called
 * "Shipped", "Closed" or anything else), and `status_category` is the fixed
 * reporting bucket every custom workflow still has to declare.
 */
const openTaskCountSql = sql<number>`(
  SELECT count(*)::int FROM ${tasks}
  JOIN ${statuses} ON ${statuses}."id" = ${tasks}."status_id"
  WHERE ${tasks}."project_id" = ${projects}."id"
    AND ${tasks}."deleted_at" IS NULL
    AND ${statuses}."category" <> 'done'
)`;

/**
 * The newest audit row for the project — "is anything actually happening here?".
 *
 * `activity` is the right source rather than `tasks.updated_at`: the stream is
 * append-only and covers comments, sprints and workflow edits too, and it is
 * never rewritten, so this cannot be moved by a backfill.
 */
const lastActivityAtSql = sql<Date | string | null>`(
  SELECT max(${activity}."created_at") FROM ${activity}
  WHERE ${activity}."project_id" = ${projects}."id"
)`;

/**
 * Normalize a raw-SQL timestamp onto the wire's ISO string.
 *
 * Typed `Date | string` rather than asserted: postgres-js parses `timestamptz`
 * into a `Date`, but that is a driver configuration detail this module should
 * not depend on for a value that arrives through a raw projection.
 */
function toIsoDateTime(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * `?q=` — the project NAME or its KEY.
 *
 * Both, because an admin looking for a project has whichever is shorter to hand:
 * `FLOW` out of a task reference, or "FlowBoard Web" off the page they were just
 * looking at.
 */
function searchFilter(q: string | undefined): SQL | undefined {
  if (q === undefined || q.length === 0) return undefined;
  const pattern = `%${q}%`;
  return or(ilike(projects.name, pattern), ilike(projects.key, pattern));
}

function buildFilters(query: AdminProjectsListQuery): SQL | undefined {
  const filters: (SQL | undefined)[] = [searchFilter(query.q)];

  if (query.orgId !== undefined) filters.push(eq(projects.orgId, query.orgId));

  // ONE switch for both soft deletes: archiving an organization archives
  // everything under it as far as a reader is concerned, so a list that hid the
  // org while still showing its projects would describe a state the product
  // does not have.
  if (query.includeArchived !== true) {
    filters.push(isNull(projects.deletedAt), isNull(organizations.deletedAt));
  }

  return and(...filters);
}

/**
 * `ORDER BY`, three-state and NULLS LAST.
 *
 * Nullish last in BOTH directions, deliberately: "never had any activity" is not
 * the most recent project when sorting descending, and it is not the oldest one
 * when sorting ascending either — it is the absence of an answer, and it belongs
 * at the end of the list whichever way the arrow points. Postgres' default
 * (`NULLS LAST` for ASC, `NULLS FIRST` for DESC) would float the empty projects
 * to the top of the most useful sort in the table.
 *
 * Every sort ends with `projects.id` so a page boundary is stable: two projects
 * with the same name, or the same task count, must not be able to swap places
 * between page 1 and page 2 and lose a row.
 */
function buildOrderBy(query: AdminProjectsListQuery): SQL[] {
  const direction = sql.raw(query.sort?.direction === 'asc' ? 'asc' : 'desc');
  const tiebreak = [sql`${projects}."name" asc`, sql`${projects}."id" asc`];

  switch (query.sort?.field) {
    case 'name':
      return [sql`${projects}."name" ${direction}`, sql`${projects}."id" asc`];
    case 'org':
      return [sql`${organizations}."name" ${direction}`, ...tiebreak];
    case 'taskCount':
      return [sql`${taskCountSql} ${direction}`, ...tiebreak];
    case 'lastActivityAt':
      return [sql`${lastActivityAtSql} ${direction} NULLS LAST`, ...tiebreak];
    default:
      // The default view answers "what is alive right now?", which is the
      // question the page is opened to ask.
      return [sql`${lastActivityAtSql} desc NULLS LAST`, ...tiebreak];
  }
}

/**
 * `GET /api/admin/projects?q&orgId&includeArchived&page&pageSize&sort` — global
 * admin.
 */
export async function listProjects(query: AdminProjectsListQuery): Promise<AdminProjectPage> {
  const where = buildFilters(query);

  const [totalRow] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(projects)
    .innerJoin(organizations, eq(projects.orgId, organizations.id))
    .where(where);
  const total = totalRow?.value ?? 0;

  const rows = await db
    .select({
      projectId: projects.id,
      key: projects.key,
      name: projects.name,
      orgId: organizations.id,
      orgName: organizations.name,
      orgSlug: organizations.slug,
      leadName: users.name,
      deletedAt: projects.deletedAt,
      memberCount: memberCountSql,
      taskCount: taskCountSql,
      openTaskCount: openTaskCountSql,
      lastActivityAt: lastActivityAtSql,
    })
    .from(projects)
    // INNER on the org (a project cannot exist without one), LEFT on the lead
    // (`projects.lead_id` is nullable and `ON DELETE SET NULL`) — an inner join
    // there would silently drop every unled project from the platform view.
    .innerJoin(organizations, eq(projects.orgId, organizations.id))
    .leftJoin(users, eq(projects.leadId, users.id))
    .where(where)
    .orderBy(...buildOrderBy(query))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  return {
    rows: rows.map((row) => ({
      projectId: row.projectId,
      key: row.key,
      name: row.name,
      orgId: row.orgId,
      orgName: row.orgName,
      orgSlug: row.orgSlug,
      leadName: row.leadName,
      memberCount: row.memberCount,
      taskCount: row.taskCount,
      openTaskCount: row.openTaskCount,
      lastActivityAt: toIsoDateTime(row.lastActivityAt),
      deletedAt: row.deletedAt === null ? null : row.deletedAt.toISOString(),
    })),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  };
}
