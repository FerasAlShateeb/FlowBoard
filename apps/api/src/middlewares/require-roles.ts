/**
 * Role guards that need real lookups — `requireOrgRole` / `requireProjectRole`.
 *
 * Resolution order (the plan's inheritance chain): global admin ⊃ org admin
 * (implicit project admin) ⊃ explicit project membership. Floors: reads =
 * `viewer`, writes = `member`, settings = `admin`.
 *
 * These guards are also where `tokenVersion` / `is_active` are lazily
 * re-checked (see the note in `require-auth.ts`): they already pay for a
 * database round-trip, so a revoked session dies here with a 401 instead of
 * living out the access token's 15-minute window.
 *
 * Access results land on `res.locals` and are read back with the typed
 * `getOrgAccess` / `getProjectAccess` helpers — controllers never re-derive
 * membership. A missing entity is a 404; an authenticated caller without
 * sufficient role is a 403 (existence of orgs/projects is not treated as a
 * secret inside a company tool — simpler to test and debug than 404-masking).
 *
 * ═══ ORG LIVENESS IS PART OF RESOLUTION, NOT A SEPARATE CHECK (R2 W3.5) ═════
 *
 * Archiving an organization is `DELETE /api/admin/orgs/:orgId` → a soft delete
 * (`organizations.deleted_at`), and the instance console presents it as
 * "revoke this deployment". It used to revoke almost nothing: `requireOrgRole`
 * checked `organizations.deletedAt` because it had an `:orgId` in hand, but the
 * project guards never looked at the org at all. A project row is not soft
 * deleted when its org is archived (the archive is one UPDATE, by design — see
 * `orgs.service.softDeleteOrg`), so every `/api/projects/:projectId/*`,
 * `/api/tasks/:taskId`, `/api/sprints/:sprintId`, `/api/comments/:commentId`
 * and `/api/attachments/:attachmentId` route still resolved, still found the
 * caller's `org_members` row, and still answered — reads AND writes — for an
 * organization the admin had just switched off.
 *
 * Both halves of the chain therefore join `organizations` and require
 * `deleted_at IS NULL`:
 *
 *  - {@link resolveProjectRef} — a project inside an archived org does not
 *    resolve, so the route 404s exactly as it does for a deleted project. This
 *    is the load-bearing half: it fires before any role is considered, so it
 *    covers a global admin browsing the archived org's tasks too.
 *  - {@link findOrgRole} — an `org_members` row in an archived org grants no
 *    role, so the inheritance chain cannot promote anyone through a dead org.
 *    Defence in depth for the ref check, and the half that also protects
 *    {@link resolveProjectRole}'s socket callers.
 *
 * The archive is reversible (`POST /api/admin/orgs/:orgId/restore`), and so is
 * this: clearing `deleted_at` makes every one of those routes resolve again
 * with no other write.
 */
import type { RequestHandler, Response } from 'express';
import { and, eq, isNull } from 'drizzle-orm';

import {
  attachments,
  comments,
  db,
  organizations,
  orgMembers,
  projectMembers,
  projects,
  sprints,
  tasks,
  users,
} from '../db';
import { ApiError } from '../utils/api-error';
import { requireUser } from './require-auth';

export type OrgRole = 'admin' | 'member';
export type ProjectRole = 'admin' | 'member' | 'viewer';

export interface OrgAccess {
  orgId: string;
  /** Effective role — global admins resolve to `admin` even without membership. */
  role: OrgRole;
}

export interface ProjectAccess {
  projectId: string;
  orgId: string;
  /** Effective role after the inheritance chain. */
  role: ProjectRole;
}

const ORG_ROLE_RANK: Record<OrgRole, number> = { member: 1, admin: 2 };
const PROJECT_ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, member: 2, admin: 3 };

/**
 * Where to find the project on the route. `auto` probes params in this order;
 * name one explicitly when a route carries more than one candidate.
 */
export type ProjectIdSource = 'projectId' | 'taskId' | 'sprintId' | 'commentId' | 'attachmentId';

const AUTO_SOURCES: readonly ProjectIdSource[] = [
  'projectId',
  'taskId',
  'sprintId',
  'commentId',
  'attachmentId',
];

/** Express 5 types route params as `string | string[]`; guards only accept the scalar form. */
function paramString(req: Parameters<RequestHandler>[0], name: string): string | undefined {
  const value = req.params[name];
  return typeof value === 'string' ? value : undefined;
}

/** 401 if the user row was revoked/deactivated since the token was minted. */
async function assertSessionLive(userId: string, tokenVersion: number): Promise<void> {
  const [row] = await db
    .select({ tokenVersion: users.tokenVersion, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row || !row.isActive || row.tokenVersion !== tokenVersion) {
    throw ApiError.unauthorized('Session has been revoked');
  }
}

/**
 * The caller's org role, or `null`.
 *
 * An archived organization grants NO role, however real the `org_members` row
 * is — see the header. The join is what makes that true for every caller of
 * {@link resolveProjectRole}, including the socket gateway's `project:join`.
 */
async function findOrgRole(userId: string, orgId: string): Promise<OrgRole | null> {
  const [row] = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
    .where(
      and(
        eq(orgMembers.orgId, orgId),
        eq(orgMembers.userId, userId),
        isNull(organizations.deletedAt),
      ),
    )
    .limit(1);
  return row?.role ?? null;
}

/**
 * Resolve `{projectId, orgId}` from whichever param the route carries.
 *
 * EVERY path joins `organizations` and requires a live one. A project whose org
 * was archived is unreachable through all five sources — that is the fix
 * described in the header, and it is deliberately here rather than in the role
 * check so that it also covers a global admin, who never consults a role.
 */
async function resolveProjectRef(
  source: ProjectIdSource,
  paramValue: string,
): Promise<{ projectId: string; orgId: string } | null> {
  if (source === 'projectId') {
    const [row] = await db
      .select({ projectId: projects.id, orgId: projects.orgId })
      .from(projects)
      .innerJoin(organizations, eq(projects.orgId, organizations.id))
      .where(
        and(
          eq(projects.id, paramValue),
          isNull(projects.deletedAt),
          isNull(organizations.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  if (source === 'taskId') {
    const [row] = await db
      .select({ projectId: projects.id, orgId: projects.orgId })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .innerJoin(organizations, eq(projects.orgId, organizations.id))
      .where(
        and(
          eq(tasks.id, paramValue),
          isNull(tasks.deletedAt),
          isNull(projects.deletedAt),
          isNull(organizations.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  if (source === 'sprintId') {
    const [row] = await db
      .select({ projectId: projects.id, orgId: projects.orgId })
      .from(sprints)
      .innerJoin(projects, eq(sprints.projectId, projects.id))
      .innerJoin(organizations, eq(projects.orgId, organizations.id))
      .where(
        and(
          eq(sprints.id, paramValue),
          isNull(projects.deletedAt),
          isNull(organizations.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  if (source === 'commentId') {
    const [row] = await db
      .select({ projectId: projects.id, orgId: projects.orgId })
      .from(comments)
      .innerJoin(tasks, eq(comments.taskId, tasks.id))
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .innerJoin(organizations, eq(projects.orgId, organizations.id))
      .where(
        and(
          eq(comments.id, paramValue),
          isNull(comments.deletedAt),
          isNull(tasks.deletedAt),
          isNull(projects.deletedAt),
          isNull(organizations.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  const [row] = await db
    .select({ projectId: projects.id, orgId: projects.orgId })
    .from(attachments)
    .innerJoin(tasks, eq(attachments.taskId, tasks.id))
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .innerJoin(organizations, eq(projects.orgId, organizations.id))
    .where(
      and(
        eq(attachments.id, paramValue),
        isNull(attachments.deletedAt),
        isNull(tasks.deletedAt),
        isNull(projects.deletedAt),
        isNull(organizations.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Effective project role for a user, or `null` when they have no access.
 * Exported for services that need access checks outside a request (sockets).
 *
 * It takes a ref rather than an id, so ORG LIVENESS IS THE CALLER'S FIRST GATE:
 * `requireProjectRole` gets its ref from {@link resolveProjectRef} and the
 * socket gateway from `sockets/socket-reads.loadProjectRef`, both of which now
 * refuse to produce a ref for an archived org. The `findOrgRole` join below is
 * the second gate — it is what stops an org-admin membership in an archived org
 * from promoting anyone, even if a future caller hands in a hand-built ref.
 *
 * The global-admin short-circuit stays a short-circuit on purpose: a global
 * admin's access is not derived from any org row, so gating it here would only
 * duplicate the ref check that already ran.
 */
export async function resolveProjectRole(
  user: { id: string; isGlobalAdmin: boolean },
  projectRef: { projectId: string; orgId: string },
): Promise<ProjectRole | null> {
  if (user.isGlobalAdmin) return 'admin';
  const orgRole = await findOrgRole(user.id, projectRef.orgId);
  if (orgRole === 'admin') return 'admin';
  const [membership] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(
      and(eq(projectMembers.projectId, projectRef.projectId), eq(projectMembers.userId, user.id)),
    )
    .limit(1);
  return membership?.role ?? null;
}

/** Guard factory: caller must hold at least `minRole` in the `:orgId` org. */
export function requireOrgRole(minRole: OrgRole): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      const user = requireUser(req);
      await assertSessionLive(user.id, user.tokenVersion);

      const orgId = paramString(req, 'orgId');
      if (orgId === undefined)
        throw ApiError.internal('requireOrgRole used on a route without :orgId');

      const [org] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
        .limit(1);
      if (!org) throw ApiError.notFound('Organization not found');

      const role: OrgRole | null = user.isGlobalAdmin ? 'admin' : await findOrgRole(user.id, orgId);
      if (role === null) throw ApiError.forbidden('You are not a member of this organization');
      if (ORG_ROLE_RANK[role] < ORG_ROLE_RANK[minRole]) {
        throw ApiError.forbidden('Insufficient organization role');
      }

      res.locals['orgAccess'] = { orgId, role } satisfies OrgAccess;
      next();
    })().catch(next);
  };
}

/**
 * Guard factory: caller must hold at least `minRole` on the project the route
 * points at (directly via `:projectId`, or through a task / sprint / comment /
 * attachment id).
 */
export function requireProjectRole(
  minRole: ProjectRole,
  source: ProjectIdSource | 'auto' = 'auto',
): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      const user = requireUser(req);
      await assertSessionLive(user.id, user.tokenVersion);

      let resolvedSource: ProjectIdSource | undefined;
      let paramValue: string | undefined;
      if (source === 'auto') {
        for (const candidate of AUTO_SOURCES) {
          const value = paramString(req, candidate);
          if (value !== undefined) {
            resolvedSource = candidate;
            paramValue = value;
            break;
          }
        }
      } else {
        resolvedSource = source;
        paramValue = paramString(req, source);
      }
      if (resolvedSource === undefined || paramValue === undefined) {
        throw ApiError.internal('requireProjectRole could not find a project-bearing route param');
      }

      const ref = await resolveProjectRef(resolvedSource, paramValue);
      if (ref === null) throw ApiError.notFound('Not found');

      const role = await resolveProjectRole(user, ref);
      if (role === null) throw ApiError.forbidden('You do not have access to this project');
      if (PROJECT_ROLE_RANK[role] < PROJECT_ROLE_RANK[minRole]) {
        throw ApiError.forbidden('Insufficient project role');
      }

      res.locals['projectAccess'] = { ...ref, role } satisfies ProjectAccess;
      next();
    })().catch(next);
  };
}

/** Typed read-back for controllers behind `requireOrgRole`. Throws on wiring bugs. */
export function getOrgAccess(res: Response): OrgAccess {
  const access = res.locals['orgAccess'] as OrgAccess | undefined;
  if (!access) throw ApiError.internal('getOrgAccess called on a route without requireOrgRole');
  return access;
}

/** Typed read-back for controllers behind `requireProjectRole`. Throws on wiring bugs. */
export function getProjectAccess(res: Response): ProjectAccess {
  const access = res.locals['projectAccess'] as ProjectAccess | undefined;
  if (!access) {
    throw ApiError.internal('getProjectAccess called on a route without requireProjectRole');
  }
  return access;
}
