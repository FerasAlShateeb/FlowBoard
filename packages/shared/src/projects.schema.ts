// Project contracts: the project row, its three-level membership, and the label
// vocabulary that lives on it.
//
// Labels are defined HERE rather than in `tasks.schema.ts` even though tasks are
// their loudest consumer: a label belongs to a project (it is part of
// `projectDetail`), and defining it here keeps the module graph acyclic —
// `tasks.schema.ts` imports labels from this file, and this file imports nothing
// from tasks.
//
// Runtime-neutral: zod only, no DOM/Node globals.
import { z } from 'zod';
import {
  booleanQuery,
  hexColor,
  isoDateTime,
  paginationQuerySchema,
  slugSchema,
  sortQueryFor,
  uuid,
} from './common';
import { nameSchema, userSummarySchema } from './users.schema';
import { statusSchema } from './workflow.schema';
import { VM_KEY_FORMAT, VM_TOO_LONG, VM_UPDATE_AT_LEAST_ONE_FIELD } from './validation-messages';

/**
 * A project key — the `FLOW` in `FLOW-123`. Uppercase, starts with a letter,
 * 2-10 characters, unique per organization. Short because it prefixes every
 * task key a human ever types, reads or pastes into a commit message.
 */
export const projectKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/, VM_KEY_FORMAT));
export type ProjectKey = z.infer<typeof projectKeySchema>;

/**
 * Project-level role. The read/write/settings split every project guard uses:
 * `viewer` reads, `member` writes tasks, `admin` edits the project and its
 * workflow. Widened by org admin and global admin.
 */
export const projectRoleSchema = z.enum(['admin', 'member', 'viewer']);
export type ProjectRole = z.infer<typeof projectRoleSchema>;

/** Optional free-text blurb shown on the project header and picker. */
export const projectDescriptionSchema = z.string().trim().max(2000, VM_TOO_LONG).nullable();

/**
 * A label: a per-project tag with a color, applied to tasks many-to-many.
 * Project-scoped rather than global so two projects can both have a "backend"
 * label without fighting over its color.
 */
export const labelSchema = z.object({
  id: uuid,
  projectId: uuid,
  name: nameSchema,
  color: hexColor,
});
export type Label = z.infer<typeof labelSchema>;

/** `POST /projects/:projectId/labels`. */
export const createLabelInputSchema = z.object({
  name: nameSchema,
  color: hexColor,
});
export type CreateLabelInput = z.infer<typeof createLabelInputSchema>;

/** `PATCH /projects/:projectId/labels/:labelId` — at least one field required. */
export const updateLabelInputSchema = z
  .object({
    name: nameSchema,
    color: hexColor,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: VM_UPDATE_AT_LEAST_ONE_FIELD });
export type UpdateLabelInput = z.infer<typeof updateLabelInputSchema>;

/**
 * A project row. `teamId` is the optional owning team (grouping only, never
 * permission); `leadId` is the optional display owner.
 */
export const projectSchema = z.object({
  id: uuid,
  orgId: uuid,
  key: projectKeySchema,
  name: nameSchema,
  description: projectDescriptionSchema,
  teamId: uuid.nullable(),
  leadId: uuid.nullable(),
  /** Denormalized so headers and pickers render the lead without a second call. */
  lead: userSummarySchema.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Project = z.infer<typeof projectSchema>;

/**
 * `GET /orgs/:orgId/projects` row — a project plus the caller's EFFECTIVE role
 * on it (already widened by org/global admin server-side, so the client never
 * re-implements the resolution chain).
 */
export const projectWithRoleSchema = projectSchema.extend({
  role: projectRoleSchema,
});
export type ProjectWithRole = z.infer<typeof projectWithRoleSchema>;

/**
 * `GET /projects/:projectId` — the one call every project view boots from.
 *
 * It bundles the workflow columns and the label vocabulary because the board
 * needs both before it can draw a single card, and the client-side "is this drop
 * allowed" pre-check (WIP limits, transitions) reads them straight out of this
 * cache entry rather than round-tripping per drag.
 */
export const projectDetailSchema = projectWithRoleSchema.extend({
  statuses: z.array(statusSchema),
  labels: z.array(labelSchema),
  memberCount: z.number().int().nonnegative(),
});
export type ProjectDetail = z.infer<typeof projectDetailSchema>;

/** `POST /orgs/:orgId/projects` — the creator becomes the project's first admin. */
export const createProjectInputSchema = z.object({
  key: projectKeySchema,
  name: nameSchema,
  description: projectDescriptionSchema.default(null),
  teamId: uuid.nullable().default(null),
  leadId: uuid.nullable().default(null),
});
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

/**
 * `PATCH /projects/:projectId` — at least one field required.
 *
 * `key` is absent on purpose: it is baked into every existing task key
 * (`FLOW-123`), every deep link and every pasted reference, so renaming it would
 * silently break history. A project that needs a different key is a new project.
 */
export const updateProjectInputSchema = z
  .object({
    name: nameSchema,
    description: projectDescriptionSchema,
    teamId: uuid.nullable(),
    leadId: uuid.nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: VM_UPDATE_AT_LEAST_ONE_FIELD });
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;

/**
 * A row of `GET /api/admin/projects` — the CROSS-ORGANIZATION project list a
 * global admin reads, one row per project in the whole deployment.
 *
 * ── WHY IT IS NOT {@link projectSchema} ─────────────────────────────────────
 * Every other project payload answers "what is this project?" for somebody
 * inside it. This one answers "what is going on across the platform?" for
 * somebody outside all of them, and the two shapes disagree on almost every
 * field:
 *
 *  - There is NO `role`. A global admin administers projects they are not a
 *    member of; synthesising `'admin'` would make the client's permission checks
 *    agree with a fiction (the same reasoning as `orgAdminRowSchema`).
 *  - The ORGANIZATION is denormalized onto the row (`orgName`, `orgSlug`). The
 *    table's first job is to say which tenant a project belongs to, and it
 *    groups and links by it; joining against `GET /orgs` client-side would make
 *    the page depend on a second query and render raw UUIDs until it lands.
 *  - The LEAD is a NAME, not a `userSummary`. This table shows a text column,
 *    never an avatar, and shipping the full summary for every row on every page
 *    is bytes nothing renders.
 *  - The COUNTS and `lastActivityAt` are the point of the row. "Which projects
 *    are actually alive?" is unanswerable from a project list that does not
 *    carry them, and computing them per row client-side is N+1 by another name.
 *
 * `projectId` rather than a bare `id` because the row already carries `orgId`:
 * two id fields on one object, one of them called `id`, is exactly where a
 * `row.id` in a link ends up pointing at the wrong entity.
 *
 * `deletedAt` is non-null for an ARCHIVED project, which the list only returns
 * under `includeArchived` — see {@link adminProjectsListQuerySchema}.
 */
export const adminProjectRowSchema = z.object({
  projectId: uuid,
  key: projectKeySchema,
  name: nameSchema,
  orgId: uuid,
  orgName: nameSchema,
  orgSlug: slugSchema,
  /** Display name of the project lead, or `null` when the project has none. */
  leadName: nameSchema.nullable(),
  memberCount: z.number().int().nonnegative(),
  /** Live (non-archived) tasks. */
  taskCount: z.number().int().nonnegative(),
  /** Live tasks whose status is not in the `done` category. */
  openTaskCount: z.number().int().nonnegative(),
  /**
   * The newest `activity` row for the project, or `null` for one where nothing
   * has ever happened. Nullable is the whole reason the table sorts it
   * NULLS LAST: a brand-new project is not the most recently active one.
   */
  lastActivityAt: isoDateTime.nullable(),
  deletedAt: isoDateTime.nullable(),
});
export type AdminProjectRow = z.infer<typeof adminProjectRowSchema>;

/**
 * The sortable columns of the admin projects table.
 *
 * A closed list rather than an open `?sort=` string: the parsed field is handed
 * to a query builder, so anything outside this set has to be rejected at the
 * boundary rather than reaching SQL. `org` sorts by organization NAME (what the
 * column renders), not by `orgId` — sorting a table of names by an opaque uuid
 * looks random to the person reading it.
 */
export const adminProjectSortFields = ['name', 'org', 'taskCount', 'lastActivityAt'] as const;

/**
 * `GET /api/admin/projects?q&orgId&includeArchived&page&pageSize&sort`.
 *
 * `q` matches the project name OR its key — an admin looking for a project types
 * either, and `FLOW` is often faster to type than "FlowBoard Web".
 *
 * `includeArchived` widens the list to soft-deleted projects AND to the projects
 * of soft-deleted organizations. The two are one switch on purpose: archiving an
 * organization archives everything under it as far as a reader is concerned, so
 * a list that hid the org but kept showing its projects would be describing a
 * state the product does not have.
 */
export const adminProjectsListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  orgId: uuid.optional(),
  includeArchived: booleanQuery.optional(),
  sort: sortQueryFor(adminProjectSortFields).optional(),
});
export type AdminProjectsListQuery = z.infer<typeof adminProjectsListQuerySchema>;

/** A row of `GET /projects/:projectId/members`. */
export const projectMemberSchema = z.object({
  projectId: uuid,
  user: userSummarySchema,
  role: projectRoleSchema,
  joinedAt: isoDateTime,
});
export type ProjectMember = z.infer<typeof projectMemberSchema>;

/** `POST /projects/:projectId/members` — grant an org member a project role. */
export const addProjectMemberInputSchema = z.object({
  userId: uuid,
  role: projectRoleSchema,
});
export type AddProjectMemberInput = z.infer<typeof addProjectMemberInputSchema>;

/** `PATCH /projects/:projectId/members/:userId` — change a project role. */
export const updateProjectMemberInputSchema = z.object({
  role: projectRoleSchema,
});
export type UpdateProjectMemberInput = z.infer<typeof updateProjectMemberInputSchema>;
