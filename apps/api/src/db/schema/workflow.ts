/**
 * Per-project workflow: board columns and the legal moves between them.
 *
 * These are DATA tables, not enums — every project defines its own columns, so
 * "add a column" must never be a migration. Reports and `tasks.resolved_at` key
 * off `statuses.category`, never off the human-facing name.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { createdAt, timestamps } from '../columns';
import { statusCategoryEnum } from './enums';
import { projects } from './projects';

/**
 * A board column. Hard-deleted (no `deleted_at`) behind a service guard that
 * refuses while tasks still reference it — the `tasks.status_id` FK is
 * `RESTRICT` so the database refuses too.
 */
export const statuses = pgTable(
  'statuses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: statusCategoryEnum('category').notNull(),
    /**
     * A HEX literal (`#64748b`), matching the shared `hexColor` contract and
     * the picker the workflow editor renders. Slate — the neutral — is the
     * default so a column created without a colour choice looks deliberate
     * rather than loud.
     */
    color: text('color').notNull().default('#64748b'),

    /**
     * Left-to-right board order. Deliberately NOT unique per project: reordering
     * writes the whole set inside one transaction and would trip a
     * non-deferrable unique index halfway through.
     */
    position: integer('position').notNull(),
    /** Kanban WIP limit; `null` = unlimited. Enforced by the task service on transition. */
    wipLimit: integer('wip_limit'),

    ...timestamps(),
  },
  (table) => [
    uniqueIndex('statuses_project_name_unique').on(table.projectId, table.name),
    index('statuses_project_position_idx').on(table.projectId, table.position),
    check('statuses_position_non_negative', sql`${table.position} >= 0`),
    check('statuses_wip_limit_positive', sql`${table.wipLimit} IS NULL OR ${table.wipLimit} > 0`),
  ],
);

/**
 * Transition whitelist.
 *
 * Semantics matter: **zero rows for a given `from_status_id` means every target
 * is allowed**; as soon as one row exists for that source, the set becomes an
 * exhaustive whitelist. That is what lets a brand-new project have a fully open
 * workflow without seeding N² rows.
 */
export const workflowTransitions = pgTable(
  'workflow_transitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    fromStatusId: uuid('from_status_id')
      .notNull()
      .references((): AnyPgColumn => statuses.id, { onDelete: 'cascade' }),
    toStatusId: uuid('to_status_id')
      .notNull()
      .references((): AnyPgColumn => statuses.id, { onDelete: 'cascade' }),

    ...createdAt(),
  },
  (table) => [
    uniqueIndex('workflow_transitions_pair_unique').on(table.fromStatusId, table.toStatusId),
    index('workflow_transitions_project_idx').on(table.projectId),
    check('workflow_transitions_not_self', sql`${table.fromStatusId} <> ${table.toStatusId}`),
  ],
);

export type StatusRow = typeof statuses.$inferSelect;
export type NewStatusRow = typeof statuses.$inferInsert;
export type WorkflowTransitionRow = typeof workflowTransitions.$inferSelect;
export type NewWorkflowTransitionRow = typeof workflowTransitions.$inferInsert;
