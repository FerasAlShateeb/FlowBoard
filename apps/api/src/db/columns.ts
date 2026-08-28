/**
 * Reusable column groups.
 *
 * Every FlowBoard table carries the same audit columns, and repeating the
 * `timestamp(...)` builder chain in fourteen files is how the definitions drift
 * apart. These are **factories**, not shared objects: each call returns a fresh
 * builder so two tables can never end up sharing builder state.
 *
 * Lives outside `schema/` on purpose — `drizzle.config.ts` globs
 * `./src/db/schema/*.ts`, and that glob should only ever match files that
 * actually declare tables.
 */
import { timestamp } from 'drizzle-orm/pg-core';

/** `timestamptz`, JS `Date` on the TS side. Never `timestamp` without a zone. */
function tz(name: string) {
  return timestamp(name, { withTimezone: true, mode: 'date' });
}

/**
 * `created_at` + `updated_at` for mutable entities.
 *
 * `updated_at` is maintained by Drizzle (`$onUpdate`) rather than a Postgres
 * trigger: the API is the only writer, and an application-level hook is
 * visible in the code that reviewers read.
 */
export function timestamps() {
  return {
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  };
}

/** `created_at` only — junction rows and append-only streams are never updated. */
export function createdAt() {
  return { createdAt: tz('created_at').notNull().defaultNow() };
}

/**
 * `deleted_at` — the soft-delete marker.
 *
 * Only on organizations, teams, projects, tasks, comments and attachments.
 * EVERY read of those tables must filter `isNull(table.deletedAt)`; see
 * `.agents/docs/database.md`.
 */
export function deletedAt() {
  return { deletedAt: tz('deleted_at') };
}
