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
