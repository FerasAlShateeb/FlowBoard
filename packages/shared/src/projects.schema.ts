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
import { hexColor, isoDateTime, uuid } from './common';
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
