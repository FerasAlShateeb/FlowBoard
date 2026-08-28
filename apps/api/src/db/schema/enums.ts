/**
 * Postgres enums — the closed vocabularies.
 *
 * WHY THIS FILE EXISTS (a deliberate deviation from strict one-file-per-domain):
 * `project_role` is needed by BOTH `projects.ts` (project_members) and
 * `orgs.ts` (invites can carry a direct project grant). Every other cross-file
 * reference in this schema is a `references(() => other.id)` thunk, which
 * Node resolves long after module evaluation — so import cycles are harmless.
 * A `pgEnum` value, by contrast, is read **eagerly** while the table is being
 * declared, and an eager read across an import cycle resolves to `undefined`
 * depending on which file the loader happens to reach first (drizzle-kit globs
 * `schema/*.ts` alphabetically, so `activity.ts` pulls in `projects.ts` before
 * `orgs.ts` ever runs). Hoisting the enums here makes the eager dependency
 * graph a strict tree and the schema load-order independent.
 *
 * WHAT BELONGS HERE: genuinely closed sets that need a migration to change.
 * Per-project workflow statuses and transitions are **data tables**, not enums
 * — that is the entire point of custom workflows. `telemetry_events.type` and
 * `activity.action` are `text` validated by the shared zod enums, so adding an
 * event or audit action never costs a migration.
 */
import { pgEnum } from 'drizzle-orm/pg-core';

/** Jira-style issue types. `subtask` rows always have a `parent_id`. */
export const taskTypeEnum = pgEnum('task_type', ['epic', 'story', 'task', 'bug', 'subtask']);

/** Ordered low → high; the UI sorts on the declaration order, not the label. */
export const taskPriorityEnum = pgEnum('task_priority', [
  'lowest',
  'low',
  'medium',
  'high',
  'highest',
]);

/** Organization membership. Global admins outrank both without a row. */
export const orgRoleEnum = pgEnum('org_role', ['admin', 'member']);

/** Project membership. Resolution order: global admin ⊃ org admin ⊃ project role. */
export const projectRoleEnum = pgEnum('project_role', ['admin', 'member', 'viewer']);

/** Sprint lifecycle. A project may have at most one `active` sprint (partial unique index). */
export const sprintStateEnum = pgEnum('sprint_state', ['planned', 'active', 'completed']);

/**
 * The fixed bucket a per-project status column falls into. Reports (burndown,
 * CFD, cycle time) and `tasks.resolved_at` key off the category, never off the
 * status name — a project may call its done column "Shipped".
 */
export const statusCategoryEnum = pgEnum('status_category', ['todo', 'in_progress', 'done']);

/**
 * In-app notification kinds.
 *
 * MEMBERS AND ORDER ARE THE SHARED `notificationTypeSchema`, VERBATIM. This
 * enum and that zod enum describe the same closed set at two ends of one wire —
 * the column stores it, the bell menu parses it — so a name that differs by a
 * prefix (`task_mentioned` vs `mentioned`) is not a synonym, it is a payload the
 * web rejects at the boundary. `schema.test.ts` pins the list.
 *
 * Wave 4 wires four triggers (assignment, mention, comment on a watched task,
 * status change on a watched task); the other three are declared up front so
 * adding them later is not a migration.
 */
export const notificationTypeEnum = pgEnum('notification_type', [
  'task_assigned',
  'mentioned',
  'status_changed',
  'comment_added',
  'sprint_started',
  'sprint_completed',
  'due_soon',
]);

export type TaskType = (typeof taskTypeEnum.enumValues)[number];
export type TaskPriority = (typeof taskPriorityEnum.enumValues)[number];
export type OrgRole = (typeof orgRoleEnum.enumValues)[number];
export type ProjectRole = (typeof projectRoleEnum.enumValues)[number];
export type SprintState = (typeof sprintStateEnum.enumValues)[number];
export type StatusCategory = (typeof statusCategoryEnum.enumValues)[number];
export type NotificationType = (typeof notificationTypeEnum.enumValues)[number];
