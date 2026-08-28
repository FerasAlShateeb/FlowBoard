/**
 * `pnpm --filter @flowboard/api db:migrate`
 *
 * Applies every pending file in `apps/api/drizzle` and exits. Safe to run
 * against an empty database, a half-migrated one, or a fully up-to-date one —
 * Drizzle records applied migrations in `drizzle.__drizzle_migrations` and skips
 * what it has already seen.
 *
 * Uses its OWN single connection rather than the shared pool from
 * `src/db/client.ts`: migrations are strictly sequential, and a pool of ten
 * idle connections just delays process exit.
 */
import path from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { env } from '../config/env';
import { detail, done, failure, step } from './script-logger';

/** `apps/api/drizzle` — resolved from this file so the cwd does not matter. */
export const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../drizzle');

async function countApplied(client: postgres.Sql): Promise<number> {
  // The journal table does not exist before the first migration, and Postgres
  // resolves relations at parse time — so this genuinely needs two round trips.
  const existsRows = await client<{ present: boolean }[]>`
    SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present
  `;
  if (existsRows[0]?.present !== true) {
    return 0;
  }
  const countRows = await client<{ n: number }[]>`
    SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations
  `;
  return countRows[0]?.n ?? 0;
}

/**
 * Run pending migrations.
 *
 * @returns how many migration files were newly applied.
 */
export async function runMigrations(): Promise<number> {
  const client = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const before = await countApplied(client);
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    const after = await countApplied(client);
    return after - before;
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  step(`applying migrations from ${MIGRATIONS_FOLDER}`);
  const applied = await runMigrations();
  if (applied === 0) {
    detail('database already up to date — nothing to apply');
  } else {
    detail(`${applied} migration${applied === 1 ? '' : 's'} applied`);
  }
  done('migrations complete');
}

if (require.main === module) {
  main().then(
    () => {
      process.exit(0);
    },
    (error: unknown) => {
      failure('migration failed', error);
      process.exit(1);
    },
  );
}
