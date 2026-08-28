/**
 * drizzle-kit configuration — used ONLY by `pnpm db:generate` (and the ad-hoc
 * `drizzle-kit studio` / `check`). The running API never reads this file; it
 * builds its connection in `src/db/client.ts`.
 *
 * WHY THE DOTENV CHAIN IS DUPLICATED HERE
 * `src/config/env.ts` is the single place the API reads `process.env`, and the
 * obvious move is to import it. drizzle-kit, however, loads this config through
 * its own esbuild-based ESM loader, outside the app's CommonJS/NodeNext
 * resolution — `env.ts` uses `__dirname`, which is not defined there, and a
 * zod failure inside it calls `process.exit(1)` with a message aimed at an API
 * operator rather than at someone running a migration. So the two-file dotenv
 * chain is replicated verbatim (apps/api/.env first, repo-root .env second,
 * dotenv never overwriting an already-set variable) and only the one variable
 * this tool needs is read. If you change the chain in `env.ts`, change it here.
 *
 * Paths are resolved from `process.cwd()`, which is `apps/api` — that is where
 * both the `db:*` package scripts and `pnpm --filter @flowboard/api` run.
 */
import path from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

loadDotenv({ path: path.resolve(process.cwd(), '.env'), quiet: true });
loadDotenv({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env at the repo root, then run drizzle-kit from apps/api (pnpm --filter @flowboard/api db:generate).',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  // One entry point, not a `*.ts` glob: the barrel already re-exports every
  // table, and globbing the folder would hand drizzle-kit each table twice
  // (once from its own file, once from index.ts).
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: databaseUrl },
  // Print the SQL being generated, and refuse to run a destructive statement
  // without asking.
  verbose: true,
  strict: true,
});
