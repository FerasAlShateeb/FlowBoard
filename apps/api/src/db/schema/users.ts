/**
 * Users — the only account table.
 *
 * FlowBoard has **no self-registration**: rows are created by a global admin or
 * by accepting an invite. Users are never deleted (activity, comments and
 * attachments must keep pointing at a real person) — they are deactivated with
 * `is_active = false` plus a `token_version` bump, which invalidates every
 * outstanding access and refresh token.
 */
import { sql } from 'drizzle-orm';
import { boolean, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { timestamps } from '../columns';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * Stored verbatim (display casing preserved); uniqueness and lookups go
     * through `lower(email)` — see the functional index below.
     */
    email: text('email').notNull(),
    /** `scrypt$N$r$p$salt$hash` — see `src/utils/password.ts`. */
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    avatarUrl: text('avatar_url'),

    /** Bypasses every org/project role check. Kept deliberately rare. */
    isGlobalAdmin: boolean('is_global_admin').notNull().default(false),
    /**
     * Bumped on password change, logout-all and deactivation. Every JWT carries
     * the version it was minted with; a mismatch means "revoked".
     */
    tokenVersion: integer('token_version').notNull().default(0),
    /** UI language. Plain text, not an enum — adding a locale is not a migration. */
    locale: text('locale').notNull().default('en'),
    isActive: boolean('is_active').notNull().default(true),

    ...timestamps(),
  },
  (table) => [
    // Case-insensitive uniqueness. A plain UNIQUE on `email` would happily
    // accept `Ada@x.dev` alongside `ada@x.dev`, and the login lookup
    // (`WHERE lower(email) = lower($1)`) uses this same index.
    uniqueIndex('users_email_lower_unique').on(sql`lower(${table.email})`),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
