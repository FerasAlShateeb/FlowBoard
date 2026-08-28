// Notification contracts — in-app only (no email, no push), delivered by socket
// to `user:{userId}` and listed on the bell menu and the notifications page.
//
// Runtime-neutral: zod only, no DOM/Node globals.
import { z } from 'zod';
import { booleanQuery, isoDateTime, paginationQuerySchema, slugSchema, uuid } from './common';
import { VM_AT_LEAST_ONE_ITEM } from './validation-messages';

/** The seven events that produce a notification. */
export const notificationTypeSchema = z.enum([
  'task_assigned',
  'mentioned',
  'status_changed',
  'comment_added',
  'sprint_started',
  'sprint_completed',
  'due_soon',
]);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

/**
 * The DENORMALIZED payload each notification carries.
 *
 * Every field is optional and every field is a snapshot: a notification renders
 * a sentence about something that happened, and it must keep rendering that
 * sentence after the task is renamed, the project archived, or the actor
 * deactivated. Joining live rows at read time would make old notifications
 * mutate under the reader — and would turn one bell fetch into four joins.
 *
 * `orgSlug` + `projectKey` + `taskKey` are what the row's click target needs to
 * build `/o/:orgSlug/p/:projectKey/board/t/:taskKey` without any lookup.
 */
export const notificationPayloadSchema = z.object({
  taskId: uuid.optional(),
  taskKey: z.string().optional(),
  taskTitle: z.string().optional(),
  orgSlug: slugSchema.optional(),
  projectKey: z.string().optional(),
  projectName: z.string().optional(),
  /** First ~140 chars of the comment, mentions already rendered to plain text. */
  commentExcerpt: z.string().optional(),
  sprintName: z.string().optional(),
  actorName: z.string().optional(),
});
export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;

/** One notification for one recipient. `readAt` is `null` while unread. */
export const notificationSchema = z.object({
  id: uuid,
  recipientId: uuid,
  type: notificationTypeSchema,
  payload: notificationPayloadSchema,
  readAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type Notification = z.infer<typeof notificationSchema>;

/**
 * `GET /notifications/unread-count` — its own tiny endpoint (and its own socket
 * field) because the bell badge is polled/pushed far more often than the list is
 * opened, and it is backed by a partial index on unread rows.
 */
export const unreadCountSchema = z.object({
  count: z.number().int().nonnegative(),
});
export type UnreadCount = z.infer<typeof unreadCountSchema>;

/**
 * `POST /notifications/read-all` — how many rows the sweep actually stamped.
 *
 * NOT a `UnreadCount`, and the difference is deliberate. `POST
 * /notifications/read` answers the new unread TOTAL, because the caller marked
 * a specific set and still needs to know what is left. Mark-all-read leaves
 * nothing: the total is zero by construction, so the only number worth sending
 * is how many were swept, which is what the confirmation toast says ("12
 * notifications marked read") and what distinguishes a real sweep from a click
 * on an already-clear bell.
 */
export const markAllReadResponseSchema = z.object({
  marked: z.number().int().nonnegative(),
});
export type MarkAllReadResponse = z.infer<typeof markAllReadResponseSchema>;

/** `GET /notifications?unread&page&pageSize`. */
export const notificationListQuerySchema = paginationQuerySchema.extend({
  unread: booleanQuery.optional(),
  type: notificationTypeSchema.optional(),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

/** `POST /notifications/read` — mark a specific set read (the row click). */
export const markNotificationsReadInputSchema = z.object({
  ids: z.array(uuid).min(1, VM_AT_LEAST_ONE_ITEM),
});
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadInputSchema>;
