/**
 * Teams — the org's people-grouping layer.
 *
 * A team is a roster, not a permission boundary: access is always resolved from
 * `org_members` / `project_members`. Projects optionally point at an owning team
 * so the UI can answer "what is Platform working on?".
 */
import { index, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { createdAt, deletedAt, timestamps } from '../columns';
import { organizations } from './orgs';
import { users } from './users';

export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),

    ...timestamps(),
    ...deletedAt(),
  },
  (table) => [
    index('teams_org_idx').on(table.orgId),
    // Names are unique per org among LIVE teams only — soft-deleting "Platform"
    // must not permanently burn the name.
    uniqueIndex('teams_org_name_unique')
      .on(table.orgId, table.name)
      .where(sql`deleted_at IS NULL`),
  ],
);

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    ...createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.userId] }),
    index('team_members_user_idx').on(table.userId),
  ],
);

export type TeamRow = typeof teams.$inferSelect;
export type NewTeamRow = typeof teams.$inferInsert;
export type TeamMemberRow = typeof teamMembers.$inferSelect;
export type NewTeamMemberRow = typeof teamMembers.$inferInsert;
