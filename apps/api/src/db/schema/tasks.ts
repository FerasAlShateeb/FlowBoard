/**
 * Tasks — the heart of FlowBoard — plus labels, watchers and dependencies.
 *
 * A task is addressed publicly by `PROJ-123`, which is `projects.key` joined to
 * `tasks.number`; the number comes from the project's atomic counter. The two
 * fractional-index rank columns are what make the board and the backlog
 * reorderable in O(1) inserts with a plain `ORDER BY` — see
 * `.agents/docs/database.md` for the full strategy.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { createdAt, deletedAt, timestamps } from '../columns';
import { taskPriorityEnum, taskTypeEnum } from './enums';
import { projects } from './projects';
import { sprints } from './sprints';
import { statuses } from './workflow';
import { users } from './users';

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** The `123` in `FLOW-123`. Allocated from `projects.task_counter`, never reused. */
    number: integer('number').notNull(),

    title: text('title').notNull(),
    /** Markdown. Mentions are encoded `@[Display Name](userId)` so renames stay resolvable. */
    description: text('description'),

    type: taskTypeEnum('type').notNull().default('task'),
    /**
     * RESTRICT, not CASCADE: deleting a board column that still holds tasks must
     * fail loudly rather than silently delete work.
     */
    statusId: uuid('status_id')
      .notNull()
      .references(() => statuses.id, { onDelete: 'restrict' }),
    priority: taskPriorityEnum('priority').notNull().default('medium'),

    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),

    /**
     * `numeric(5,1)`, not `integer`: the shared `storyPointsSchema` accepts
     * halves (0.5 is a real Fibonacci-ish estimate teams use for trivia), and an
     * integer column would have silently rounded them — a value the user typed,
     * changed by the database, with no error anywhere. `mode: 'number'` keeps
     * the TypeScript side a `number` rather than the string `numeric` otherwise
     * infers to, so every arithmetic site (velocity, burndown, workload) is
     * unchanged.
     */
    storyPoints: numeric('story_points', { precision: 5, scale: 1, mode: 'number' }),
    /** Plain `date`, not `timestamptz`: the gantt and calendar are calendar-day tools. */
    startDate: date('start_date'),
    dueDate: date('due_date'),

    /** `NULL` = in the backlog. */
    sprintId: uuid('sprint_id').references(() => sprints.id, { onDelete: 'set null' }),

    /** Roadmap grouping — points at a task of type `epic` (service-enforced). */
    epicId: uuid('epic_id').references((): AnyPgColumn => tasks.id, { onDelete: 'set null' }),
    /** Subtask parent. CASCADE: deleting a parent takes its subtasks with it. */
    parentId: uuid('parent_id').references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),

    /** Fractional index within `(project_id, status_id)` — the Kanban column order. */
    boardRank: text('board_rank').notNull(),
    /** Fractional index within `(project_id, sprint_id)` — backlog / sprint order. */
    backlogRank: text('backlog_rank').notNull(),

    /** Stamped when the task first enters a `done`-category status; cleared on reopen. */
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),

    ...timestamps(),
    ...deletedAt(),
  },
  (table) => [
    uniqueIndex('tasks_project_number_unique').on(table.projectId, table.number),

    // ── The seven read paths the product actually has ─────────────────────
    /** Board: one column's cards, already ordered. */
    index('tasks_board_idx').on(table.projectId, table.statusId, table.boardRank),
    /** Backlog / sprint panel: one sprint's rows, already ordered. */
    index('tasks_backlog_idx').on(table.projectId, table.sprintId, table.backlogRank),
    /** "My work" and the workload report. Partial — soft-deleted rows are noise. */
    index('tasks_assignee_idx')
      .on(table.assigneeId)
      .where(sql`deleted_at IS NULL`),
    /** Roadmap epic roll-ups. */
    index('tasks_epic_idx').on(table.epicId),
    /** Subtask lists on the task detail panel. */
    index('tasks_parent_idx').on(table.parentId),
    /** Calendar and gantt window queries. */
    index('tasks_project_due_date_idx').on(table.projectId, table.dueDate),
    /**
     * Command-palette / search trigram index. Requires `pg_trgm`, which the
     * initial migration creates by hand — drizzle-kit does not emit
     * `CREATE EXTENSION` (see database.md → "Extensions").
     */
    index('tasks_title_trgm_idx').using('gin', sql`${table.title} gin_trgm_ops`),

    check('tasks_number_positive', sql`${table.number} > 0`),
    check(
      'tasks_story_points_non_negative',
      sql`${table.storyPoints} IS NULL OR ${table.storyPoints} >= 0`,
    ),
    check(
      'tasks_dates_ordered',
      sql`${table.startDate} IS NULL OR ${table.dueDate} IS NULL OR ${table.dueDate} >= ${table.startDate}`,
    ),
    check('tasks_not_own_epic', sql`${table.epicId} IS NULL OR ${table.epicId} <> ${table.id}`),
    check(
      'tasks_not_own_parent',
      sql`${table.parentId} IS NULL OR ${table.parentId} <> ${table.id}`,
    ),
  ],
);

/**
 * Free-form project-scoped tags.
 *
 * `color` is a HEX literal (`#64748b`), matching the shared `hexColor`
 * contract and the hex picker the label editor renders. It is deliberately NOT
 * a design-token name: a label's colour is user-chosen from a full picker, so
 * there is no fixed token to name — unlike the Theme Studio's palette, which
 * is authored in OKLCH tokens precisely because it IS fixed.
 */
export const labels = pgTable(
  'labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#64748b'),

    ...timestamps(),
  },
  (table) => [uniqueIndex('labels_project_name_unique').on(table.projectId, table.name)],
);

export const taskLabels = pgTable(
  'task_labels',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),

    ...createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.labelId] }),
    // Filtering a board by label reads label → tasks, the direction the PK cannot serve.
    index('task_labels_label_idx').on(table.labelId),
  ],
);

/**
 * Watchers — the notification fan-out list.
 *
 * `is_muted` keeps the row (so the UI still shows "you are watching") while
 * suppressing delivery, which is what an assignee who wants quiet actually
 * wants; deleting the row would just get re-added by the next auto-watch rule.
 */
export const taskWatchers = pgTable(
  'task_watchers',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    isMuted: boolean('is_muted').notNull().default(false),

    ...createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.userId] }),
    index('task_watchers_user_idx').on(table.userId),
  ],
);

/**
 * "Blocks" edges. Cycles are prevented in the service (a graph walk before
 * insert) — Postgres cannot express that constraint — but self-edges and
 * duplicate pairs are rejected here.
 */
export const taskDependencies = pgTable(
  'task_dependencies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The task that must finish first. */
    blockerTaskId: uuid('blocker_task_id')
      .notNull()
      .references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
    /** The task held up by it. */
    blockedTaskId: uuid('blocked_task_id')
      .notNull()
      .references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),

    ...createdAt(),
  },
  (table) => [
    uniqueIndex('task_dependencies_pair_unique').on(table.blockerTaskId, table.blockedTaskId),
    index('task_dependencies_blocked_idx').on(table.blockedTaskId),
    check('task_dependencies_not_self', sql`${table.blockerTaskId} <> ${table.blockedTaskId}`),
  ],
);

export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;
export type LabelRow = typeof labels.$inferSelect;
export type NewLabelRow = typeof labels.$inferInsert;
export type TaskLabelRow = typeof taskLabels.$inferSelect;
export type NewTaskLabelRow = typeof taskLabels.$inferInsert;
export type TaskWatcherRow = typeof taskWatchers.$inferSelect;
export type NewTaskWatcherRow = typeof taskWatchers.$inferInsert;
export type TaskDependencyRow = typeof taskDependencies.$inferSelect;
export type NewTaskDependencyRow = typeof taskDependencies.$inferInsert;
