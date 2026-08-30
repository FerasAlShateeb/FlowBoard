/**
 * `instance_settings` — the deployment-level singleton.
 *
 * FlowBoard is open-sourced, and the overwhelmingly common self-hosted shape is
 * ONE company, ONE organization, where the org switcher, the `/o/:orgSlug`
 * prefix and every "pick an organization" empty state are noise. That has to be
 * something an administrator flips at runtime, so it is a ROW rather than an env
 * var: an env var cannot be validated against the data (single mode needs a
 * default org that actually exists and is not archived), and it cannot be edited
 * from the settings page. The env only seeds the row on a fresh install. This is
 * the GitLab pattern, and the shared contract
 * (`packages/shared/src/instance.schema.ts`) documents the two payloads it
 * projects into.
 *
 * ── WHY A SINGLETON TABLE AND NOT A KEY/VALUE BAG ───────────────────────────
 * A `settings(key text, value jsonb)` table would make every read an untyped
 * lookup that can miss, and it could not express `default_org_id`'s FOREIGN KEY.
 * That FK is the whole point: `ON DELETE SET NULL` means hard-deleting the
 * default organization degrades single mode to "no default yet" (which the shell
 * already renders as an empty state) instead of leaving a dangling id that
 * resolves to a 404 on every boot. A jsonb blob cannot be referentially
 * constrained at all.
 *
 * ── THE `id = 1` CHECK ──────────────────────────────────────────────────────
 * "There is exactly one row" is enforced by the database, not by a convention in
 * a service: an `INSERT` of a second configuration is refused by the check rather
 * than silently shadowing the first depending on which one a `LIMIT 1` happens to
 * read. `integer` rather than `uuid` for the same reason — the primary key is a
 * literal an operator can type in psql (`WHERE id = 1`), and there is no id here
 * worth hiding.
 *
 * ── WHY `org_mode` IS `text` AND NOT A pg ENUM ──────────────────────────────
 * Same rule as `telemetry_events.type` and `activity.action` (see
 * `.agents/docs/database.md` § Enums): the closed set lives in
 * `@flowboard/shared`'s `orgModeSchema`, every read parses through it, and adding
 * a third deployment shape later must not be DDL. A pg enum would also have to be
 * mirrored member-for-member in `schema.test.ts`, buying nothing for a column with
 * exactly one writer.
 */
import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { timestamps } from '../columns';
import { organizations } from './orgs';

export const instanceSettings = pgTable(
  'instance_settings',
  {
    /** Always 1 — see the singleton note above. */
    id: integer('id').primaryKey().default(1),
    /**
     * `'multi' | 'single'`, parsed by `orgModeSchema` on every read. Defaults to
     * the shipped SaaS shape so an install that never opens the settings page
     * behaves exactly as it did before this table existed.
     */
    orgMode: text('org_mode').notNull().default('multi'),
    /**
     * THE organization in single mode; advisory in multi mode (it is where `/`
     * would go if the mode were flipped, which is what makes flipping it a
     * one-field change).
     *
     * Nullable because a fresh install has no organization yet, and
     * `ON DELETE SET NULL` because hard-deleting an org must degrade the setting
     * rather than break the boot path. Note that the PRODUCT only ever
     * soft-deletes organizations — `deleted_at` — which this FK cannot see, so
     * the service checks liveness itself.
     */
    defaultOrgId: uuid('default_org_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    /** Branding: the name the shell, the tab title and the sign-in page wear. */
    instanceName: text('instance_name').notNull().default('FlowBoard'),

    ...timestamps(),
  },
  (table) => [check('instance_settings_singleton', sql`${table.id} = 1`)],
);

export type InstanceSettingsRow = typeof instanceSettings.$inferSelect;
export type NewInstanceSettingsRow = typeof instanceSettings.$inferInsert;
