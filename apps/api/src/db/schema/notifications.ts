/**
 * In-app notifications (there is no email channel).
 *
 * The payload is deliberately DENORMALIZED: a notification must still render
 * after the task it points at is soft-deleted or renamed, and the bell menu must
 * not fan out into five joins per row.
 */
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { createdAt } from '../columns';
import { comments } from './comments';
import { notificationTypeEnum } from './enums';
import { projects } from './projects';
import { tasks } from './tasks';
import { users } from './users';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Who caused it. `NULL` for system notifications. */
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    type: notificationTypeEnum('type').notNull(),

    /** Deep-link targets; all nullable because not every type has all three. */
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id').references(() => comments.id, { onDelete: 'cascade' }),

    /**
     * Snapshot for rendering: `{ taskKey, taskTitle, projectKey, actorName, … }`.
     * Typed `unknown`; the bell menu parses it with the shared zod schema.
     */
    payload: jsonb('payload'),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),

    ...createdAt(),
  },
  (table) => [
    /** The notifications page: everything for me, newest first. */
    index('notifications_recipient_idx').on(table.recipientId, table.createdAt.desc()),
    /**
     * The badge count and the `?unread` filter. Partial, because the unread set
     * stays tiny while the read set grows without bound — this is the index that
     * keeps `COUNT(*) WHERE read_at IS NULL` an index-only scan forever.
     */
    index('notifications_unread_idx')
      .on(table.recipientId, table.createdAt.desc())
      .where(sql`read_at IS NULL`),
  ],
);

export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;
