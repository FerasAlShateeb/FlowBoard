/**
 * Activity — the append-only audit stream.
 *
 * Rows are NEVER updated and NEVER deleted (not even soft): the task history
 * panel, the project feed and the cumulative-flow report are all replays of this
 * table. One row per changed field, so a PATCH touching three fields writes
 * three rows and the UI can render "changed priority from High to Medium".
 */
import { bigserial, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { createdAt } from '../columns';
import { projects } from './projects';
import { tasks } from './tasks';
import { users } from './users';

export const activity = pgTable(
  'activity',
  {
    /** `bigserial`, not uuid: this is a stream, and monotonic ids give cheap cursors. */
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** `NULL` for project-level events (workflow edited, sprint started). */
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    /** `NULL` for system-generated entries. */
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),

    /**
     * Dot-namespaced action, e.g. `task.created`, `task.field_changed`,
     * `comment.added`, `sprint.started`. `text`, not a pg enum, so adding an
     * action is not a migration — but the closed set IS the shared
     * `activityActionSchema`, and every read parses through it. A value outside
     * that enum inserts happily and then fails the whole feed request.
     *
     * Not to be confused with the SOCKET event names (`comment:created`), which
     * are a different namespace with a different vocabulary.
     */
    action: text('action').notNull(),
    /** For `*.field_changed`: which column moved. `NULL` otherwise. */
    field: text('field'),
    /** `unknown` on the TS side — read it back through a zod parse, never cast. */
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),

    ...createdAt(),
  },
  (table) => [
    /** Task history panel: one task's stream in insertion order. */
    index('activity_task_idx').on(table.taskId, table.id),
    /** Project feed and the CFD report: newest first, keyset-paginated on `id`. */
    index('activity_project_idx').on(table.projectId, table.id.desc()),
  ],
);

export type ActivityRow = typeof activity.$inferSelect;
export type NewActivityRow = typeof activity.$inferInsert;
