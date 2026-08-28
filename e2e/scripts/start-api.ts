/**
 * The API server, with its database provisioned first.
 *
 * ── Why this wrapper exists instead of a plain `globalSetup` ────────────────
 *
 * The plan assumed Playwright runs `globalSetup` before `webServer`. It does
 * not. `createGlobalSetupTasks()` in `playwright/lib/runner` orders the phases
 *
 *     remove output dirs → PLUGIN SETUP (this is webServer) → global setup
 *
 * so by the time a `globalSetup` file runs, both servers have already booted
 * and answered their readiness probes. An API that boots against a database
 * that does not exist yet exits on the spot, and the run dies in `webServer`
 * with a timeout that says nothing about the real cause.
 *
 * Putting the provisioning INSIDE the server's own start command removes the
 * ordering question entirely: the database is created, migrated and seeded, and
 * only then does anything try to connect to it. The health probe in
 * `playwright.config.ts` therefore means what it claims to mean — "the API is
 * up AND its database is reachable".
 *
 * The child inherits `DATABASE_URL` from `apiChildEnv()`, so the servers can
 * never reach the dev database; `global-setup.ts` proves that afterwards by
 * counting rows on both sides of the run.
 */
import { spawn } from 'node:child_process';

import { apiChildEnv, REPO_ROOT } from '../helpers/env';
import { provisionE2eDatabase } from '../helpers/database';

/* eslint-disable no-console -- process-level plumbing: this runs before, and instead of, any logger. */

async function main(): Promise<void> {
  await provisionE2eDatabase();

  // Printed WITHOUT credentials, and printed on every run: "which database is
  // the API on" is the one question a green suite can answer wrongly, so the
  // answer belongs in the log rather than in a comment. `global-setup.ts` then
  // proves it independently, by comparing the seeded admin's uuid against the
  // one a real login returns.
  const env = apiChildEnv();
  const target = new URL(env.DATABASE_URL ?? 'postgres://localhost/unset');
  console.log(`[e2e-db] starting the API against ${target.host}${target.pathname}`);

  // One string, not argv + `shell: true` — see the note in `helpers/database.ts`.
  const child = spawn('pnpm --filter @flowboard/api dev', {
    cwd: REPO_ROOT,
    env,
    // Playwright pipes this process's stdio into its own `[WebServer]` prefix,
    // so inheriting hands the API's pino output straight through to the report.
    stdio: 'inherit',
    shell: true,
  });

  // Playwright terminates the whole process tree (`taskkill /T` on Windows,
  // the process group elsewhere), so this is belt-and-braces for a manual
  // Ctrl+C: forward the signal rather than orphaning a watcher on port 4000.
  const forward = (signal: NodeJS.Signals) => (): void => {
    child.kill(signal);
  };
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));

  child.on('exit', (code, signal) => {
    process.exit(signal !== null ? 1 : (code ?? 0));
  });
}

main().catch((error: unknown) => {
  console.error('[e2e-db] could not provision the e2e database');
  console.error(error);
  process.exit(1);
});

/* eslint-enable no-console */
