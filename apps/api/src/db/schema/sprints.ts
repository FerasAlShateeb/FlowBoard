/**
 * Sprints — the scrum layer over the backlog.
 *
 * `tasks.sprint_id IS NULL` means "in the backlog". Velocity comes from the two
 * stamped point columns rather than from re-summing tasks, so re-estimating a
 * task after a sprint closes cannot rewrite history.
 *
 * Hard-deleted (no `deleted_at`) behind a service guard.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamps } from '../columns';
import { sprintStateEnum } from './enums';
import { projects } from './projects';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const sprints = pgTable(
  'sprints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    goal: text('goal'),
    state: sprintStateEnum('state').notNull().default('planned'),

    /**
     * Planned window. Set at creation for `planned` sprints, adjustable until
     * start.
     *
     * `date`, not `timestamptz`, and for the same reason `tasks.due_date` is:
     * a sprint boundary is a CALENDAR DAY, not an instant. Stamping it with a
     * timezone invites every reader to re-interpret it locally, which is
     * precisely how a two-week sprint renders as thirteen days on a burndown
     * for anyone west of UTC. The shared contract carries `isoDate`
     * (`YYYY-MM-DD`) on both ends, so the column now stores exactly what
     * crosses the wire.
     *
     * `startedAt` / `completedAt` below stay `timestamptz` — those ARE
     * instants: the moment somebody pressed the button.
     */
    startDate: date('start_date'),
    endDate: date('end_date'),
    /** Actual lifecycle stamps, written by `/start` and `/complete`. */
    startedAt: tz('started_at'),
    completedAt: tz('completed_at'),

    /** Sum of story points at the moment `/start` ran — the burndown's ceiling. */
    committedPoints: integer('committed_points'),
    /** Sum of DONE story points at the moment `/complete` ran — the velocity chart's bar. */
    completedPoints: integer('completed_points'),

    ...timestamps(),
  },
  (table) => [
    // THE one-active-sprint guarantee. A partial unique index, not application
    // logic: two concurrent `/start` calls race in the database and one loses.
    uniqueIndex('sprints_one_active_per_project')
      .on(table.projectId)
      .where(sql`state = 'active'`),
    index('sprints_project_state_idx').on(table.projectId, table.state),
    check(
      'sprints_window_ordered',
      sql`${table.startDate} IS NULL OR ${table.endDate} IS NULL OR ${table.endDate} >= ${table.startDate}`,
    ),
    check(
      'sprints_points_non_negative',
      sql`(${table.committedPoints} IS NULL OR ${table.committedPoints} >= 0) AND (${table.completedPoints} IS NULL OR ${table.completedPoints} >= 0)`,
    ),
  ],
);

export type SprintRow = typeof sprints.$inferSelect;
export type NewSprintRow = typeof sprints.$inferInsert;
