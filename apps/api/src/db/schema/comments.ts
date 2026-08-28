/**
 * Comments and attachments — the two things that hang off a task and carry user
 * content, hence both soft-deleted.
 */
import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { deletedAt, timestamps } from '../columns';
import { tasks } from './tasks';
import { users } from './users';

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    /** Markdown with `@[Display Name](userId)` mentions — same encoding as task descriptions. */
    body: text('body').notNull(),
    /** Distinct from `updated_at`, which any system write touches. `NULL` = never edited by a human. */
    editedAt: timestamp('edited_at', { withTimezone: true, mode: 'date' }),

    ...timestamps(),
    ...deletedAt(),
  },
  (table) => [
    // The comment thread reads one task's comments oldest-first.
    index('comments_task_idx').on(table.taskId, table.createdAt),
  ],
);

/**
 * Attachment metadata. The bytes live in MinIO; the API never proxies them.
 *
 * Lifecycle is presign → upload direct to S3 → confirm. `confirmed_at IS NULL`
 * therefore means "presigned but never uploaded" — those rows are invisible to
 * the UI and are what a future sweeper job reaps.
 */
export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    uploadedById: uuid('uploaded_by_id').references(() => users.id, { onDelete: 'set null' }),

    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    /** `bigint` in `number` mode — files stay well inside `Number.MAX_SAFE_INTEGER`. */
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    /** `{orgId}/{projectId}/{taskId}/{uuid}-{name}` — unique so a retry cannot clobber. */
    s3Key: text('s3_key').notNull().unique(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true, mode: 'date' }),

    ...timestamps(),
    ...deletedAt(),
  },
  (table) => [
    index('attachments_task_idx').on(table.taskId),
    check('attachments_size_positive', sql`${table.sizeBytes} > 0`),
  ],
);

export type CommentRow = typeof comments.$inferSelect;
export type NewCommentRow = typeof comments.$inferInsert;
export type AttachmentRow = typeof attachments.$inferSelect;
export type NewAttachmentRow = typeof attachments.$inferInsert;
