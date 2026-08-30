import { defineConfig } from 'vitest/config';

/**
 * Vitest for `@flowboard/api`.
 *
 * `env` supplies the variables `src/config/env.ts` fails fast on, so the suite
 * runs from a cold clone with no `.env` file — the alternative is a test run
 * whose result depends on a git-ignored file. Values are deliberately fake:
 * nothing in the unit/integration suites opens a socket to Postgres or MinIO.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /**
     * Integration suites share one live `flowboard_test` database (see
     * `src/test/test-db.ts`) and truncate between suites — parallel test
     * files would race each other's fixtures, so files run sequentially.
     */
    fileParallelism: false,
    /**
     * 30s for HOOKS, default (5s) for tests.
     *
     * Vitest's 10s hook default assumes a `beforeEach` that wires up objects.
     * These suites' hooks do real I/O: `truncateAllTables()` is a `TRUNCATE`
     * across every table in the schema, and the socket suites additionally boot
     * an HTTP server and a Socket.IO server per test. `realtime-bridge.test.ts`
     * pays for both, thirty-plus times in one file.
     *
     * That is comfortably under 10s on an idle machine and NOT under load —
     * `turbo run test` schedules `@flowboard/api` alongside `@flowboard/web`'s
     * 2 500-test suite, and the gate failed twice in that hook while the two
     * competed for cores. A hook timeout is a deadline on setup, not an
     * assertion, so raising it loses nothing: a genuinely hung hook still fails,
     * three times slower. The TEST timeout is deliberately left alone — that one
     * IS an assertion about how long the product may take to answer.
     */
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      // Port 5433: the dev compose publishes there (5432 is owned by GameDash).
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/flowboard_test',
      JWT_SECRET: 'test-access-secret-value',
      JWT_REFRESH_SECRET: 'test-refresh-secret-value',
      ACCESS_TOKEN_TTL: '15m',
      REFRESH_TOKEN_TTL: '30d',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_ACCESS_KEY: 'test-access-key',
      S3_SECRET_KEY: 'test-secret-key',
      S3_BUCKET: 'flowboard-test',
      S3_REGION: 'us-east-1',
      WEB_ORIGIN: 'http://localhost:5173',
    },
  },
});
