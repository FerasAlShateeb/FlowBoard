/**
 * Where the suite runs, and against what.
 *
 * Everything here is derived from the repo-root `.env` — the same file the API
 * and the Vite dev server read — with ONE substitution: the database name. The
 * suite is write-heavy (it creates tasks, starts sprints, deletes users), so it
 * gets its own database and never borrows `flowboard` (dev) or `flowboard_test`
 * (the API's vitest integration suites, which truncate between cases).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `<repo>/e2e` — this package's root, resolved from this file, not the cwd. */
export const E2E_DIR: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** `<repo>` — the monorepo root. */
export const REPO_ROOT: string = path.resolve(E2E_DIR, '..');

/** The database this suite owns outright and recreates on every run. */
export const E2E_DATABASE_NAME = 'flowboard_e2e';

/**
 * A minimal `.env` reader.
 *
 * Deliberately NOT `dotenv`: this package would have to depend on it purely to
 * read four keys, and dotenv's real value — precedence rules and `process.env`
 * mutation — is the opposite of what is wanted here. Nothing below writes to
 * `process.env`; callers pass the values explicitly to the child processes that
 * need them, so there is no ambient state to get wrong.
 */
function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

let cached: Record<string, string> | null = null;

/**
 * The repo-root `.env`, overlaid by anything already exported in the shell.
 *
 * Shell wins, matching dotenv's own precedence, so `DATABASE_URL=… pnpm e2e`
 * still points the suite at a different Postgres.
 */
export function rootEnv(): Record<string, string> {
  if (cached === null) {
    let fileValues: Record<string, string> = {};
    try {
      fileValues = parseEnvFile(readFileSync(path.join(REPO_ROOT, '.env'), 'utf8'));
    } catch {
      // No `.env` at the root: fall back entirely to the shell environment.
      // `requireEnv` below turns a genuinely missing value into a clear error.
    }
    const shell: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) shell[key] = value;
    }
    cached = { ...fileValues, ...shell };
  }
  return cached;
}

function requireEnv(key: string): string {
  const value = rootEnv()[key];
  if (value === undefined || value === '') {
    throw new Error(
      `e2e: ${key} is not set. Copy .env.example to .env at the repo root, or export it.`,
    );
  }
  return value;
}

/** The DEV database URL, exactly as the app uses it. Never written to by this suite. */
export function devDatabaseUrl(): string {
  return requireEnv('DATABASE_URL');
}

/** The same server, same credentials — a different database name. */
export function e2eDatabaseUrl(): string {
  const url = new URL(devDatabaseUrl());
  url.pathname = `/${E2E_DATABASE_NAME}`;
  return url.toString();
}

/**
 * Every database on this server that the suite must NOT write to, by name.
 *
 * `flowboard` is the dev database behind a developer's `pnpm dev`;
 * `flowboard_test` is the one the API's vitest integration suites create,
 * migrate and TRUNCATE between cases. Both are fenced at both ends of the run by
 * `global-setup.ts`, because the failure they guard against — an override that
 * silently did not reach the server — is invisible in a green suite and
 * expensive to discover later.
 */
export function foreignDatabases(): Record<string, string> {
  const dev = devDatabaseUrl();
  const devName = new URL(dev).pathname.slice(1);
  const test = new URL(dev);
  test.pathname = '/flowboard_test';
  return { [devName]: dev, flowboard_test: test.toString() };
}

/**
 * The `postgres` maintenance database on the same server.
 *
 * `CREATE DATABASE` and `DROP DATABASE` cannot run from inside the database
 * they are operating on, so provisioning connects here instead.
 */
export function maintenanceDatabaseUrl(): string {
  const url = new URL(devDatabaseUrl());
  url.pathname = '/postgres';
  return url.toString();
}

export const API_PORT: number = Number(rootEnv().PORT ?? '4000');
export const WEB_PORT: number = Number(rootEnv().WEB_PORT ?? '5173');
export const API_ORIGIN = `http://localhost:${String(API_PORT)}`;
export const WEB_ORIGIN = `http://localhost:${String(WEB_PORT)}`;

/**
 * The environment the API child process is started with.
 *
 * `DATABASE_URL` is the whole point: `apps/api/src/config/env.ts` loads the
 * root `.env` with dotenv, and dotenv NEVER overwrites a variable that is
 * already set — so an explicit value here wins over the file, which is what
 * keeps the servers off the dev database.
 */
export function apiChildEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: e2eDatabaseUrl(),
    // The suite asserts on log rows in the diagnostics drawer; `info` would
    // hide the request-level lines those assertions look for.
    LOG_LEVEL: rootEnv().LOG_LEVEL ?? 'debug',
    NODE_ENV: 'development',
  };
}
