/**
 * Project logic — the list/create half is org-scoped, the read/update half is
 * project-scoped, and both live here because they share one row mapper.
 *
 * The load-bearing piece is {@link createProject}: a project is only usable once
 * it has board columns, so the project row, its creator's admin membership, the
 * three default statuses and the audit entry are written in ONE transaction. A
 * project that committed without its workflow would be a board with no columns
 * and no way to create a task — an inconsistency no later request could repair
 * on its own.
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type {
  Label,
  Project,
  ProjectDetail,
  ProjectRole,
  ProjectWithRole,
  Status,
  StatusCategory,
} from '@flowboard/shared';

import {
  db,
  labels,
  orgMembers,
  projectMembers,
  projects,
  statuses,
  teams,
  users,
  withTx,
} from '../db';
import type { Tx } from '../db';
import { ApiError } from '../utils/api-error';
import { recordActivity } from './activity.service';
import { isUniqueViolation } from './pg-errors';
import type { Actor } from './orgs.service';

/**
 * Who did it, and from which tab.
 *
 * `socketId` is the echo-suppression key copied onto every domain event this
 * work package publishes; `null` means the mutation came from something without
 * a live socket (curl, a test, a future scheduled job).
 */
export interface ActorContext {
  actorId: string;
  socketId: string | null;
}

/**
 * The workflow every new project starts with: the three columns that make a
 * board immediately usable, and ZERO transition rows.
 *
 * No transitions is not an oversight — `workflow_transitions` is a per-source
 * whitelist where an empty set means "every move is allowed" (see
 * `workflow.schema.ts`), so a fresh project is fully open without seeding N²
 * rows that an admin would then have to prune.
 *
 * Colors are hex because `statusSchema.color` is `hexColor`; the column's
 * `'slate'` default is a token name from an earlier design and is never used by
 * this path (see the schema-gap note in the WP2.2 report).
 */
const DEFAULT_STATUSES: readonly { name: string; category: StatusCategory; color: string }[] = [
  { name: 'To Do', category: 'todo', color: '#64748b' },
  { name: 'In Progress', category: 'in_progress', color: '#3b82f6' },
  { name: 'Done', category: 'done', color: '#22c55e' },
];

const projectColumns = {
  id: projects.id,
  orgId: projects.orgId,
  key: projects.key,
  name: projects.name,
  description: projects.description,
  teamId: projects.teamId,
  leadId: projects.leadId,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
};

const leadColumns = {
  leadName: users.name,
  leadAvatarUrl: users.avatarUrl,
};

interface ProjectColumnRow {
  id: string;
  orgId: string;
  key: string;
  name: string;
  description: string | null;
  teamId: string | null;
  leadId: string | null;
  createdAt: Date;
  updatedAt: Date;
  leadName: string | null;
  leadAvatarUrl: string | null;
}

function toProject(row: ProjectColumnRow): Project {
  return {
    id: row.id,
    orgId: row.orgId,
    key: row.key,
    name: row.name,
    description: row.description,
    teamId: row.teamId,
    leadId: row.leadId,
    lead:
      row.leadId === null || row.leadName === null
        ? null
        : { id: row.leadId, name: row.leadName, avatarUrl: row.leadAvatarUrl },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * `GET /orgs/:orgId/projects`.
 *
 * An org admin (and a global admin) sees every project in the org at role
 * `admin`, matching what `requireProjectRole` would grant them; everyone else
 * sees only the projects they hold an explicit `project_members` row on. The
 * role is resolved SERVER-side so the browser never re-implements the
 * inheritance chain.
 */
export async function listProjects(
  orgId: string,
  actor: Actor,
  orgRole: 'admin' | 'member',
  query: { includeArchived: boolean },
): Promise<ProjectWithRole[]> {
  const isOrgAdmin = actor.isGlobalAdmin || orgRole === 'admin';
  const filters = [eq(projects.orgId, orgId)];
  if (!query.includeArchived) filters.push(isNull(projects.deletedAt));

  if (isOrgAdmin) {
    const rows = await db
      .select({ ...projectColumns, ...leadColumns })
      .from(projects)
      .leftJoin(users, eq(projects.leadId, users.id))
      .where(and(...filters))
      .orderBy(asc(projects.key));
    return rows.map((row) => ({ ...toProject(row), role: 'admin' as const }));
  }

  const rows = await db
    .select({ ...projectColumns, ...leadColumns, role: projectMembers.role })
    .from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .leftJoin(users, eq(projects.leadId, users.id))
    .where(and(eq(projectMembers.userId, actor.id), ...filters))
    .orderBy(asc(projects.key));

  return rows.map((row) => ({ ...toProject(row), role: row.role }));
}

/** Load a live project row (with its lead) or throw 404. */
async function requireProjectRow(projectId: string): Promise<ProjectColumnRow> {
  const [row] = await db
    .select({ ...projectColumns, ...leadColumns })
    .from(projects)
    .leftJoin(users, eq(projects.leadId, users.id))
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (!row) throw ApiError.notFound('Project not found');
  return row;
}

function toStatus(row: {
  id: string;
  projectId: string;
  name: string;
  category: StatusCategory;
  color: string;
  position: number;
  wipLimit: number | null;
}): Status {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    category: row.category,
    color: row.color,
    position: row.position,
    wipLimit: row.wipLimit,
  };
}

/**
 * `GET /projects/:projectId` — the one call every project view boots from.
 *
 * Statuses and labels ride along because the board cannot draw a single card
 * without both, and the client-side "is this drop allowed" pre-check reads them
 * straight out of this cache entry.
 */
export async function getProjectDetail(
  projectId: string,
  role: ProjectRole,
): Promise<ProjectDetail> {
  const row = await requireProjectRow(projectId);

  const [statusRows, labelRows, memberCount] = await Promise.all([
    db
      .select()
      .from(statuses)
      .where(eq(statuses.projectId, projectId))
      .orderBy(asc(statuses.position), asc(statuses.name)),
    db.select().from(labels).where(eq(labels.projectId, projectId)).orderBy(asc(labels.name)),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, projectId)),
  ]);

  const projectLabels: Label[] = labelRows.map((label) => ({
    id: label.id,
    projectId: label.projectId,
    name: label.name,
    color: label.color,
  }));

  return {
    ...toProject(row),
    role,
    statuses: statusRows.map(toStatus),
    labels: projectLabels,
    memberCount: memberCount[0]?.total ?? 0,
  };
}

/** The optional `teamId` must name a live team of the SAME org. */
async function assertTeamInOrg(orgId: string, teamId: string | null): Promise<void> {
  if (teamId === null) return;
  const [row] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.orgId, orgId), isNull(teams.deletedAt)))
    .limit(1);
  if (!row) throw ApiError.badRequest('That team does not belong to this organization');
}

/** The optional `leadId` must be a member of the org — you cannot lead from outside it. */
async function assertLeadInOrg(orgId: string, leadId: string | null): Promise<void> {
  if (leadId === null) return;
  const [row] = await db
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, leadId)))
    .limit(1);
  if (!row) throw ApiError.badRequest('The project lead must be a member of this organization');
}

/** Seed the default board columns. Shared by create and (potentially) recovery paths. */
async function seedDefaultStatuses(tx: Tx, projectId: string): Promise<void> {
  await tx.insert(statuses).values(
    DEFAULT_STATUSES.map((status, position) => ({
      projectId,
      name: status.name,
      category: status.category,
      color: status.color,
      position,
    })),
  );
}

/** `POST /orgs/:orgId/projects` — org admin. */
export async function createProject(
  orgId: string,
  input: {
    key: string;
    name: string;
    description: string | null;
    teamId: string | null;
    leadId: string | null;
  },
  actor: Actor,
): Promise<ProjectWithRole> {
  await assertTeamInOrg(orgId, input.teamId);
  await assertLeadInOrg(orgId, input.leadId);

  // `projects_org_key_unique` is unconditional, so a soft-deleted project still
  // owns its key — deliberately, since `PROJ-123` task keys outlive the row.
  const [taken] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.key, input.key)))
    .limit(1);
  if (taken) throw ApiError.conflict('That project key is already used in this organization');

  const projectId = await withTx(async (tx) => {
    let row: { id: string } | undefined;
    try {
      [row] = await tx
        .insert(projects)
        .values({
          orgId,
          key: input.key,
          name: input.name,
          description: input.description,
          teamId: input.teamId,
          leadId: input.leadId,
        })
        .returning({ id: projects.id });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.conflict('That project key is already used in this organization');
      }
      throw error;
    }
    if (!row) throw ApiError.internal('Project insert returned no row');

    await tx.insert(projectMembers).values({ projectId: row.id, userId: actor.id, role: 'admin' });
    await seedDefaultStatuses(tx, row.id);
    await recordActivity(
      {
        projectId: row.id,
        actorId: actor.id,
        action: 'project.created',
        newValue: { key: input.key, name: input.name },
      },
      tx,
    );

    return row.id;
  });

  const created = await requireProjectRow(projectId);
  return { ...toProject(created), role: 'admin' };
}

/** Fields a PATCH may touch; `key` is immutable by contract. */
export interface UpdateProjectFields {
  name?: string;
  description?: string | null;
  teamId?: string | null;
  leadId?: string | null;
}

/**
 * `PATCH /projects/:projectId` — project admin.
 *
 * One audit row per changed field, which is what lets the activity feed render
 * "changed lead from Ada to Grace" instead of "updated the project".
 */
export async function updateProject(
  projectId: string,
  input: UpdateProjectFields,
  context: ActorContext,
  role: ProjectRole,
): Promise<ProjectWithRole> {
  const current = await requireProjectRow(projectId);
  if (input.teamId !== undefined) await assertTeamInOrg(current.orgId, input.teamId);
  if (input.leadId !== undefined) await assertLeadInOrg(current.orgId, input.leadId);

  const changes: { field: keyof UpdateProjectFields; oldValue: unknown; newValue: unknown }[] = [];
  for (const field of ['name', 'description', 'teamId', 'leadId'] as const) {
    const next = input[field];
    if (next === undefined) continue;
    const previous = current[field];
    if (next !== previous) changes.push({ field, oldValue: previous, newValue: next });
  }

  if (changes.length === 0) {
    return { ...toProject(current), role };
  }

  await withTx(async (tx) => {
    await tx
      .update(projects)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.teamId === undefined ? {} : { teamId: input.teamId }),
        ...(input.leadId === undefined ? {} : { leadId: input.leadId }),
      })
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)));

    for (const change of changes) {
      await recordActivity(
        {
          projectId,
          actorId: context.actorId,
          action: 'project.updated',
          field: change.field,
          oldValue: change.oldValue,
          newValue: change.newValue,
        },
        tx,
      );
    }
  });

  const updated = await requireProjectRow(projectId);
  return { ...toProject(updated), role };
}

/**
 * `DELETE /projects/:projectId` — project admin, soft ("archive" in the UI).
 *
 * The archive and its audit row are ONE transaction. `activity` is append-only
 * and never soft-deleted, so the row survives the project and is what the
 * global admin's feed shows when somebody asks where a project went — which is
 * exactly the moment nobody can go and look at the project itself.
 *
 * (`project.deleted` was missing from the closed `activityActionSchema` in
 * Wave 2, so WP2.2 shipped this write-less; WP2.5 added the member and the
 * row.)
 */
export async function softDeleteProject(projectId: string, context: ActorContext): Promise<void> {
  await withTx(async (tx) => {
    const [row] = await tx
      .update(projects)
      .set({ deletedAt: new Date() })
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .returning({ id: projects.id, key: projects.key, name: projects.name });
    if (!row) throw ApiError.notFound('Project not found');

    await recordActivity(
      {
        projectId,
        actorId: context.actorId,
        action: 'project.deleted',
        oldValue: { key: row.key, name: row.name },
      },
      tx,
    );
  });
}
