// Activity contracts — the append-only audit stream behind the task history
// panel, the project feed, and the cumulative-flow report.
//
// The `activity` table is written on every mutation and NEVER updated or
// deleted, which is what lets the CFD chart be reconstructed from it rather than
// from nightly snapshots. Rows use a bigserial id (a monotonic cursor for
// keyset pagination) carried as a STRING, because a 64-bit integer does not
// survive JSON.
//
// Runtime-neutral: zod only, no DOM/Node globals.
import { z } from 'zod';
import { bigIntId, isoDateTime, paginationQuerySchema, uuid } from './common';
import { userSummarySchema } from './users.schema';

/**
 * The CLOSED set of audit actions, dot-namespaced `subject.verb`.
 *
 * Closed on purpose: the web renders one sentence template per action, and an
 * unknown action would render as raw text in a feed a user is reading. Adding an
 * action means adding it here and to the i18n catalog — that coupling is the
 * point. Note this is a shared zod enum, NOT a pg enum: `activity.action` is a
 * text column, so a new action needs no migration.
 */
export const activityActionSchema = z.enum([
  // Tasks
  'task.created',
  /** A plain field diff — `field`/`oldValue`/`newValue` say which and what. */
  'task.field_changed',
  'task.status_changed',
  'task.assigned',
  'task.moved_sprint',
  'task.ranked',
  'task.deleted',
  // Comments
  'comment.added',
  'comment.edited',
  'comment.deleted',
  // Attachments
  'attachment.added',
  'attachment.deleted',
  // Relationships
  'dependency.added',
  'dependency.removed',
  'watcher.added',
  'watcher.removed',
  'label.added',
  'label.removed',
  // Sprints
  'sprint.created',
  'sprint.started',
  'sprint.completed',
  'sprint.deleted',
  // Project & workflow
  'workflow.changed',
  'project.created',
  'project.updated',
  'project.deleted',
  'member.added',
  'member.removed',
]);
export type ActivityAction = z.infer<typeof activityActionSchema>;

/**
 * One audit row.
 *
 * `field`, `oldValue` and `newValue` are jsonb and therefore typed `unknown`:
 * the column holds whatever the changed field held (a string status id, a
 * number of story points, an array of label ids, `null` for a cleared
 * assignee), and pretending otherwise here would mean a union that every writer
 * has to fight. The RENDERER narrows them, keyed by `action` + `field`, and any
 * shape it does not recognise falls back to a generic sentence. All three are
 * optional: most actions carry none of them.
 *
 * `taskId` is `null` for project-scoped rows (`project.updated`,
 * `workflow.changed`, `member.added`), which is exactly what the project feed
 * shows alongside the task rows.
 */
export const activitySchema = z.object({
  id: bigIntId,
  projectId: uuid,
  taskId: uuid.nullable(),
  /** `null` when the system acted (a sprint auto-completing, say). */
  actor: userSummarySchema.nullable(),
  action: activityActionSchema,
  field: z.unknown().optional(),
  oldValue: z.unknown().optional(),
  newValue: z.unknown().optional(),
  createdAt: isoDateTime,
});
export type Activity = z.infer<typeof activitySchema>;

/**
 * `GET /projects/:projectId/activity` and `GET /tasks/:taskId/activity`.
 *
 * Offset pagination matches the rest of the API, but `beforeId` is offered as
 * well: an append-only stream shifts under an offset every time anyone touches
 * anything, so an infinite-scroll feed keysets on the bigserial cursor instead
 * and never shows a row twice.
 */
export const activityQuerySchema = paginationQuerySchema.extend({
  action: activityActionSchema.optional(),
  beforeId: bigIntId.optional(),
});
export type ActivityQuery = z.infer<typeof activityQuerySchema>;
