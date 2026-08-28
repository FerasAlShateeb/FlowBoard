/**
 * Organizations, their membership, and invite links.
 *
 * An organization is the top of the hierarchy (org → teams → projects). A user
 * may belong to any number of orgs; the web app's org switcher reads
 * `org_members` for the current user.
 */
import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { createdAt, deletedAt, timestamps } from '../columns';
import { orgRoleEnum, projectRoleEnum } from './enums';
import { projects } from './projects';
import { users } from './users';

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** URL segment: `/o/:orgSlug`. Lowercase kebab, enforced by the check below. */
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    avatarUrl: text('avatar_url'),
    /** Nullable so deleting the creator is never blocked (users are deactivated, not deleted). */
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),

    ...timestamps(),
    ...deletedAt(),
  },
  (table) => [check('organizations_slug_format', sql`${table.slug} ~ '^[a-z0-9](-?[a-z0-9]+)*$'`)],
);

export const orgMembers = pgTable(
  'org_members',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: orgRoleEnum('role').notNull().default('member'),

    ...createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.userId] }),
    // "Which orgs am I in?" — the org switcher's query, and the PK's leading
    // column is org_id, so it cannot serve this direction.
    index('org_members_user_idx').on(table.userId),
  ],
);

/**
 * Invite links — the only way an account is created besides admin provisioning.
 *
 * An invite always grants org membership and may additionally grant a role on
 * one specific project (the "invite a contractor straight into PROJ" case). The
 * two project columns are all-or-nothing, enforced by a check constraint.
 */
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Random opaque string; the URL is `/invite/:token`. */
    token: text('token').notNull().unique(),
    /** Optional email lock — when set, only that address may accept. */
    email: text('email'),
    orgRole: orgRoleEnum('org_role').notNull().default('member'),

    /** Optional direct project grant. Lazy `() =>` ref: `projects.ts` imports this file back. */
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    projectRole: projectRoleEnum('project_role'),

    invitedById: uuid('invited_by_id').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
    acceptedById: uuid('accepted_by_id').references(() => users.id, { onDelete: 'set null' }),

    ...createdAt(),
  },
  (table) => [
    index('invites_org_idx').on(table.orgId),
    // Preview + "already invited?" lookups are by email within an org.
    index('invites_email_idx').on(table.email),
    check(
      'invites_project_grant_complete',
      sql`(${table.projectId} IS NULL) = (${table.projectRole} IS NULL)`,
    ),
  ],
);

export type OrganizationRow = typeof organizations.$inferSelect;
export type NewOrganizationRow = typeof organizations.$inferInsert;
export type OrgMemberRow = typeof orgMembers.$inferSelect;
export type NewOrgMemberRow = typeof orgMembers.$inferInsert;
export type InviteRow = typeof invites.$inferSelect;
export type NewInviteRow = typeof invites.$inferInsert;
