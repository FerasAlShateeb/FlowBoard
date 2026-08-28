/**
 * The suite's own database: creating it, filling it, and proving it is the only
 * one the run touched.
 *
 * Nothing here is Playwright-aware on purpose — `scripts/start-api.ts` calls
 * `provisionE2eDatabase()` before the API process exists, and `global-setup.ts`
 * calls `countRows()` on the DEV database to fence the run. Keeping both in one
 * module that imports neither `@playwright/test` nor the app is what lets them
 * share the connection logic without either one dragging the other in.
 */
import { spawn } from 'node:child_process';
import postgres from 'postgres';

import { E2E_DATABASE_NAME, REPO_ROOT, e2eDatabaseUrl, maintenanceDatabaseUrl } from './env';

/* eslint-disable no-console -- this module is CLI plumbing: its progress has to reach the terminal before any logger exists. */

/** Run a command to completion, streaming nothing, failing loudly. */
async function run(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // `shell: true` with ONE pre-joined string, not an argv array: on Windows
    // `pnpm` is `pnpm.cmd`, which `CreateProcess` cannot execute directly, and
    // Node deprecated (DEP0190) passing separate args alongside `shell: true`
    // because it concatenates them without escaping. Every token here is a
    // hard-coded literal, so there is nothing to escape and nothing to inject.
    const child = spawn([command, ...args].join(' '), { cwd: REPO_ROOT, env, shell: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(' ')} exited ${String(code)}\n` +
            `${stdout.trimEnd()}\n${stderr.trimEnd()}`,
        ),
      );
    });
  });
}

/**
 * Drop and recreate `flowboard_e2e`, then migrate and seed it.
 *
 * DROP-then-CREATE rather than TRUNCATE: the seed refuses to run against a
 * database that already holds users, and a truncate would leave the drizzle
 * journal behind — so a migration file edited since the last run would be
 * silently skipped. Recreating the database is the only version of this that
 * proves "migrations apply from zero" on every single run, which is exactly the
 * property the cold-start requirement is asking for.
 *
 * `WITH (FORCE)` terminates whatever is still connected. Without it, a `pnpm
 * dev` left open against the e2e database — or the previous run's API process
 * during a crash-restart — blocks the DROP forever.
 */
export async function provisionE2eDatabase(): Promise<void> {
  const started = Date.now();
  console.log(`[e2e-db] recreating ${E2E_DATABASE_NAME}…`);

  const admin = postgres(maintenanceDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${E2E_DATABASE_NAME}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${E2E_DATABASE_NAME}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }

  // The api package's OWN scripts, with `DATABASE_URL` overridden — not a
  // reimplementation. `apps/api/src/config/env.ts` loads the root `.env` via
  // dotenv, which never overwrites an already-set variable, so the value passed
  // here wins and the scripts operate on the e2e database.
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: e2eDatabaseUrl() };
  console.log('[e2e-db] applying migrations…');
  await run('pnpm', ['--filter', '@flowboard/api', 'db:migrate'], env);
  console.log('[e2e-db] seeding…');
  await run('pnpm', ['--filter', '@flowboard/api', 'db:seed'], env);

  console.log(`[e2e-db] ready in ${String(Date.now() - started)} ms`);
}

/* eslint-enable no-console */

/** Table name → row count, for every table in `public` except drizzle's journal. */
export type RowCounts = Record<string, number>;

/**
 * Count every row in every table of the database at `databaseUrl`.
 *
 * Used on the DEV database at the start and the end of the run. If a single
 * number moves, something in the suite reached the wrong Postgres — which is
 * the one failure mode a passing e2e suite could otherwise hide.
 */
export async function countRows(databaseUrl: string): Promise<RowCounts> {
  const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    const tables = await client<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT LIKE '\\_\\_drizzle%'
      ORDER BY tablename
    `;
    const counts: RowCounts = {};
    for (const { tablename } of tables) {
      const rows = await client.unsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "${tablename}"`,
      );
      counts[tablename] = rows[0]?.n ?? 0;
    }
    return counts;
  } finally {
    await client.end({ timeout: 5 });
  }
}

/**
 * The seeded global admin's user id, read straight out of a database.
 *
 * THE POINT: the seed is deterministic in its DATA but not in its KEYS — every
 * uuid is minted by Postgres at insert time, so `admin@flowboard.dev` has a
 * different id in `flowboard` (dev), `flowboard_test` (vitest) and
 * `flowboard_e2e`. Comparing this against the id the API hands back at login is
 * therefore an exact answer to "which database is the server actually on?",
 * which no amount of reading `DATABASE_URL` can give you — the value that
 * matters is the one the running process resolved, not the one we meant to pass.
 */
export async function seededAdminId(databaseUrl: string): Promise<string | null> {
  const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    const rows = await client<{ id: string }[]>`
      SELECT id FROM users WHERE email = 'admin@flowboard.dev' LIMIT 1
    `;
    return rows[0]?.id ?? null;
  } finally {
    await client.end({ timeout: 5 });
  }
}

/** `countRows`, or `null` when that database does not exist on this machine. */
export async function countRowsIfPresent(databaseUrl: string): Promise<RowCounts | null> {
  if (databaseUrl === '') return null;
  try {
    return await countRows(databaseUrl);
  } catch {
    // A developer who has never run `pnpm db:seed` has no dev database, and a
    // checkout that has never run the API's integration suites has no
    // `flowboard_test`. Neither is an e2e failure — there is nothing to protect.
    return null;
  }
}

/** Human-readable diff of two count maps; empty when they agree. */
export function diffCounts(before: RowCounts, after: RowCounts): string[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  const drift: string[] = [];
  for (const name of [...names].sort()) {
    const from = before[name] ?? 0;
    const to = after[name] ?? 0;
    if (from !== to) drift.push(`${name}: ${String(from)} → ${String(to)}`);
  }
  return drift;
}
