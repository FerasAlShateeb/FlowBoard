/**
 * Integration-test database helper.
 *
 * Vitest pins `DATABASE_URL` to the `flowboard_test` database on the dev
 * Postgres container (see `vitest.config.ts`), so `src/db/client.ts` already
 * connects to the right place under test. This module makes that database
 * exist and be migrated, and clears it between suites.
 *
 * Suites run sequentially (`fileParallelism: false`) — `truncateAllTables()`
 * in a `beforeEach`/`beforeAll` is safe. Usage:
 *
 *   beforeAll(async () => { await ensureTestDb(); });
 *   beforeEach(async () => { await truncateAllTables(); });
 *   afterAll(async () => { await closeDb(); });
 */
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { env } from '../config/env';
import { db } from '../db';

let prepared: Promise<void> | null = null;

async function createDatabaseIfMissing(): Promise<void> {
  const url = new URL(env.DATABASE_URL);
  const targetDb = url.pathname.replace(/^\//u, '');
  // Connect to the maintenance database to be able to CREATE DATABASE.
  url.pathname = '/postgres';
  const admin = postgres(url.toString(), { max: 1 });
  try {
    const existing = await admin`SELECT 1 FROM pg_database WHERE datname = ${targetDb}`;
    if (existing.length === 0) {
      await admin.unsafe(`CREATE DATABASE "${targetDb}"`);
    }
  } finally {
    await admin.end();
  }
}

/** Create (if needed) + migrate the test database. Memoized per process. */
export function ensureTestDb(): Promise<void> {
  prepared ??= (async () => {
    await createDatabaseIfMissing();
    const migrationClient = postgres(env.DATABASE_URL, { max: 1 });
    try {
      await migrate(drizzle(migrationClient), {
        migrationsFolder: path.resolve(__dirname, '../../drizzle'),
      });
    } finally {
      await migrationClient.end();
    }
  })();
  return prepared;
}

/** TRUNCATE every public table except the drizzle migration journal. */
export async function truncateAllTables(): Promise<void> {
  const rows = await db.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '\\_\\_drizzle%'
  `);
  const names = rows.map((row) => `"${row.tablename}"`).join(', ');
  if (names.length === 0) return;
  await db.execute(sql.raw(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`));
}
