/**
 * The fence around the run.
 *
 * The database this suite USES is created, migrated and seeded by
 * `scripts/start-api.ts`, which is the API server's start command — see the long
 * comment there for why Playwright's phase ordering forces the provisioning to
 * live in that file rather than in this one.
 *
 * What is left for a real `globalSetup` is the pair of things no individual spec
 * can do.
 *
 * 1. **Prove the API is on the right database.** Not "prove we passed the right
 *    `DATABASE_URL`" — prove the server that answered actually resolved it. The
 *    seeded admin's uuid is minted by Postgres at insert time, so it is
 *    different in every copy of the seed; the id a real login returns therefore
 *    names the database the process is serving.
 *
 * 2. **Prove nothing else was written to.** It counts every row of the two
 *    databases this suite must never touch — `flowboard` (the dev database a
 *    person's `pnpm dev` uses) and `flowboard_test` (the API's vitest
 *    integration suites) — before the first test and again after the last one,
 *    and fails the run if a single number moved.
 *
 * Fifteen write-heavy spec files against a server configured from a `.env` file
 * is exactly the setup where "it passed" and "it passed against the right
 * database" are different claims. This is the only place that can tell them
 * apart, and a suite that cannot tell them apart is one bad override away from
 * silently rewriting someone's work.
 */
import { ApiClient } from './helpers/api';
import { countRowsIfPresent, diffCounts, seededAdminId, type RowCounts } from './helpers/database';
import { e2eDatabaseUrl, E2E_DATABASE_NAME, foreignDatabases } from './helpers/env';
import { ADMIN } from './helpers/seed';

/* eslint-disable no-console -- globalSetup has no reporter to write through; stdout is the channel. */

/** Tables whose seeded counts prove the e2e database is the FULL seed, not a husk. */
const REQUIRED_NON_EMPTY = ['users', 'organizations', 'projects', 'statuses', 'tasks'] as const;

export default async function globalSetup(): Promise<() => Promise<void>> {
  // ── The e2e database really is provisioned ───────────────────────────────
  // `start-api.ts` has already run by now (webServer plugins precede
  // globalSetup). If its seed silently produced an empty database, every spec
  // below would fail on a missing locator and none of them would say why.
  const e2eCounts = await countRows();
  const empty = REQUIRED_NON_EMPTY.filter((table) => (e2eCounts[table] ?? 0) === 0);
  if (empty.length > 0) {
    throw new Error(
      `e2e: ${E2E_DATABASE_NAME} is missing seed data in ${empty.join(', ')}. ` +
        'Check the [WebServer] output for a failed migrate or seed.',
    );
  }
  console.log(
    `[e2e] ${E2E_DATABASE_NAME}: ${String(e2eCounts.tasks ?? 0)} tasks, ` +
      `${String(e2eCounts.users ?? 0)} users, ${String(e2eCounts.projects ?? 0)} projects`,
  );

  // ── The RUNNING SERVER is on it, not merely configured for it ────────────
  const expectedAdminId = await seededAdminId(e2eDatabaseUrl());
  const session = await ApiClient.session(ADMIN.email, ADMIN.password);
  if (expectedAdminId === null || session.user.id !== expectedAdminId) {
    throw new Error(
      `e2e: the API is NOT serving ${E2E_DATABASE_NAME}.\n` +
        `  ${E2E_DATABASE_NAME} says admin is ${String(expectedAdminId)}\n` +
        `  the API says admin is ${session.user.id}\n` +
        'The DATABASE_URL override did not reach the server process — see scripts/start-api.ts.',
    );
  }
  console.log(`[e2e] the API is serving ${E2E_DATABASE_NAME} (admin ${session.user.id})`);

  // ── Fence every database that is not ours ────────────────────────────────
  const baselines = new Map<string, RowCounts>();
  for (const [name, url] of Object.entries(foreignDatabases())) {
    const counts = await countRowsIfPresent(url);
    // Absent is fine: a machine that has never run `pnpm db:seed` has no dev
    // database, and there is simply nothing there to protect.
    if (counts === null) continue;
    baselines.set(name, counts);
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    console.log(
      `[e2e] ${name} baseline: ${String(total)} rows across ${String(Object.keys(counts).length)} tables`,
    );
  }

  return async function globalTeardown(): Promise<void> {
    const damaged: string[] = [];
    for (const [name, before] of baselines) {
      const after = await countRowsIfPresent(foreignDatabases()[name] ?? '');
      if (after === null) continue;
      const drift = diffCounts(before, after);
      if (drift.length > 0) {
        damaged.push(`${name}:\n${drift.map((line) => `    ${line}`).join('\n')}`);
      } else {
        console.log(`[e2e] ${name} untouched — row counts identical before and after`);
      }
    }
    if (damaged.length > 0) {
      throw new Error(
        `e2e: a database this suite must never write to CHANGED during this run:\n  ${damaged.join(
          '\n  ',
        )}\nA server was pointed at the wrong DATABASE_URL — the suite may only ever write to ` +
          `${E2E_DATABASE_NAME}.`,
      );
    }
  };
}

/** Row counts for the suite's own database. */
async function countRows(): Promise<RowCounts> {
  const counts = await countRowsIfPresent(e2eDatabaseUrl());
  if (counts === null) {
    throw new Error(`e2e: ${E2E_DATABASE_NAME} does not exist — provisioning never ran.`);
  }
  return counts;
}

/* eslint-enable no-console */
