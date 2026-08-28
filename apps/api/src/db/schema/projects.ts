/**
 * Projects and project membership.
 *
 * A project owns its own workflow (`statuses` + `workflow_transitions`), its own
 * labels, its own sprints and its own task-number sequence.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, deletedAt, timestamps } from '../columns';
import { projectRoleEnum } from './enums';
import { organizations } from './orgs';
import { teams } from './teams';
import { users } from './users';

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    /** The `FLOW` in `FLOW-123`. Upper-case, unique within the org. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),

    /** Optional owning team and project lead — both display-only. */
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
    leadId: uuid('lead_id').references(() => users.id, { onDelete: 'set null' }),
    /** A design-token name (`--accent-1`…), never a hex literal. */
    avatarColor: text('avatar_color').notNull().default('indigo'),

    /**
     * The issue-number sequence behind `FLOW-123`.
     *
     * ALWAYS allocate with an atomic
     * `UPDATE projects SET task_counter = task_counter + 1 … RETURNING task_counter`
     * inside the creating transaction. A read-then-write hands two concurrent
     * creators the same number and trips the `(project_id, number)` unique index.
     */
    taskCounter: integer('task_counter').notNull().default(0),

    ...timestamps(),
    ...deletedAt(),
  },
  (table) => [
    uniqueIndex('projects_org_key_unique').on(table.orgId, table.key),
    index('projects_org_idx').on(table.orgId),
    check('projects_key_format', sql`${table.key} ~ '^[A-Z][A-Z0-9]{1,9}$'`),
    check('projects_task_counter_non_negative', sql`${table.taskCounter} >= 0`),
  ],
);

/**
 * Explicit per-project roles.
 *
 * Effective permission = global admin ⊃ org admin ⊃ this row. A user with no
 * row here can still reach the project as a global or org admin, so guards must
 * resolve in that order rather than requiring a `project_members` row.
 */
export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: projectRoleEnum('role').notNull().default('member'),

    ...createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index('project_members_user_idx').on(table.userId),
  ],
);

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
export type ProjectMemberRow = typeof projectMembers.$inferSelect;
export type NewProjectMemberRow = typeof projectMembers.$inferInsert;
