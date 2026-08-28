/**
 * `pnpm --filter @flowboard/api db:reset`
 *
 * Drops EVERYTHING and migrates back up from zero. This is the command that
 * proves "migrations run from an empty database", and it is the fastest way out
 * of a broken local schema.
 *
 *   db:reset  →  drop public + drizzle schemas  →  db:migrate
 *
 * It deliberately does NOT seed: `pnpm db:reset && pnpm db:seed` keeps the two
 * destructive-and-then-noisy halves separately auditable.
 */
import postgres from 'postgres';

import { env } from '../config/env';
import { runMigrations } from './migrate';
import { detail, done, failure, step } from './script-logger';

async function dropEverything(): Promise<void> {
  const client = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    // `public` holds the tables; `drizzle` holds `__drizzle_migrations`. Dropping
    // only `public` would leave the journal claiming every migration is already
    // applied, and the follow-up migrate would silently do nothing.
    await client.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await client.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await client.unsafe('CREATE SCHEMA public');
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  // THE GUARD. `db:reset` is unrecoverable, so it refuses to even connect in
  // production rather than trusting that the URL points somewhere harmless.
  if (env.NODE_ENV === 'production') {
    failure('db:reset refuses to run with NODE_ENV=production — it destroys all data.');
    process.exit(1);
  }

  // Show the operator which database is about to be destroyed, without the
  // credentials. A wrong DATABASE_URL is the only way this command hurts.
  const target = safeTarget(env.DATABASE_URL);
  step(`dropping and recreating schemas on ${target}`);
  await dropEverything();
  detail('public + drizzle schemas recreated');

  step('re-applying migrations');
  const applied = await runMigrations();
  detail(`${applied} migration${applied === 1 ? '' : 's'} applied`);

  done('database reset — run `pnpm db:seed` to refill it');
}

/** `postgresql://user:pass@host:port/db` → `host:port/db`. */
function safeTarget(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return `${url.host}${url.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

main().then(
  () => {
    process.exit(0);
  },
  (error: unknown) => {
    failure('reset failed', error);
    process.exit(1);
  },
);
