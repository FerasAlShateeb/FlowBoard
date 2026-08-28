import { defineConfig, devices } from '@playwright/test';

import { API_PORT, WEB_PORT } from './helpers/env';

/**
 * Playwright configuration.
 *
 * ── What a cold start looks like ────────────────────────────────────────────
 *
 * `pnpm --filter @flowboard/e2e test` needs nothing but a running dev Postgres
 * (`docker compose -f docker-compose.dev.yml up -d`) and a Chromium binary
 * (`pnpm --filter @flowboard/e2e exec playwright install chromium`, once — pnpm
 * blocks dependency lifecycle scripts, so `pnpm install` does not fetch it).
 *
 * Everything else the run provisions itself: `scripts/start-api.ts` drops and
 * recreates the `flowboard_e2e` database, migrates it from zero, seeds it, and
 * only THEN starts the API against it. Two consecutive runs are therefore
 * identical, and neither of them can see what the previous one wrote.
 *
 * ── The database, and why it is not `globalSetup`'s job ─────────────────────
 *
 * Playwright orders its startup phases
 *
 *     remove output dirs → plugin setup (THIS IS `webServer`) → global setup
 *
 * so a `globalSetup` that provisioned the database would run minutes after the
 * API had already tried — and failed — to connect to it. The provisioning
 * therefore lives inside the API's own start command, where the ordering is not
 * a question. `global-setup.ts` keeps the job only a global hook can do: it
 * counts every row of the DEV database before and after the run and fails if
 * one of them moved, which is the proof that the suite never left its own
 * database.
 *
 * ── Servers are never reused ────────────────────────────────────────────────
 *
 * `reuseExistingServer` is OFF, including locally. A `pnpm dev` already
 * listening on 4000 is connected to the DEV database, and silently attaching to
 * it would point the whole write-heavy suite at real data — the exact failure
 * the e2e database exists to prevent. Playwright fails fast with "port is
 * already used" instead, which is a five-second fix rather than a restore.
 */
const API_HEALTH = `http://localhost:${String(API_PORT)}/api/health`;
const WEB_URL = `http://localhost:${String(WEB_PORT)}`;

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  outputDir: './test-results',

  /**
   * SEQUENTIAL, deliberately.
   *
   * Every worker would share the one seeded `flowboard_e2e` database, and the
   * specs are write-heavy against SHARED seeded rows: `board.spec` drags a card
   * that `realtime.spec` is watching, `sprint.spec` completes the sprint
   * `table.spec` is sorting by. Isolating them would mean a database per worker
   * — N migrate-and-seed passes for a suite that already fits in single-digit
   * minutes, and a cleanup story for the leftovers. Parallelism here would buy
   * wall-clock time and pay for it in failures that land in whichever spec was
   * unlucky rather than in the one with the bug.
   */
  fullyParallel: false,
  workers: 1,

  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  /**
   * PER-TEST BUDGET, raised from Playwright's 30 s default.
   *
   * This suite drives two real servers, a real database and a real browser, and
   * the gate runs it after ~1 500 Vitest cases have warmed nothing. The first
   * spec to visit a route pays for a cold Vite compile of that route's chunk —
   * observed at 30.5 s against a 30 s ceiling on a loaded machine, and 4.7 s on
   * an idle one. That is a coin flip, not a signal.
   *
   * A timeout is a HANG DETECTOR, not a performance budget.
   */
  timeout: 90_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // A cold Vite dev server compiles the route chunk on first navigation, so
    // the first action against a route is legitimately slow.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // `diagnostics.spec` asserts the drawer's "copy as JSONL" button, which
    // goes through `navigator.clipboard.writeText`. Chromium prompts for that
    // permission unless it is granted up front; localhost is a secure context,
    // so the API itself is available.
    permissions: ['clipboard-read', 'clipboard-write'],
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      // NOT `pnpm --filter @flowboard/api dev`: the wrapper provisions the e2e
      // database first and then execs that same command with DATABASE_URL
      // overridden. See `scripts/start-api.ts`.
      command: 'pnpm exec tsx ./scripts/start-api.ts',
      // The health probe, not the port: a bound port means "node started",
      // while a 200 from `/api/health` means the database is reachable too,
      // which is the thing every spec actually depends on.
      url: API_HEALTH,
      reuseExistingServer: false,
      // Drop + create + migrate + seed happens inside this command, so the
      // budget covers a full provisioning pass, not just a process spawn.
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter @flowboard/web dev',
      url: WEB_URL,
      cwd: '..',
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
