/**
 * Zod-validated environment — the ONLY place `process.env` is read.
 *
 * Fails fast at import time with every offending variable listed, so a
 * misconfigured deploy dies on boot instead of 500ing at runtime. Keep the
 * schema in sync with `.env.example` at the repo root.
 */
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Load `apps/api/.env` first (highest precedence), then the repo-root `.env`.
// dotenv never overwrites a variable that is already set.
loadDotenv({ path: path.resolve(__dirname, '../../.env'), quiet: true });
loadDotenv({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });

/** `ms`-package style duration, e.g. `15m`, `2h`, `30d`. */
const durationSchema = z
  .string()
  .regex(/^\d+(ms|s|m|h|d)$/u, 'expected a duration like 15m, 2h or 30d');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),

  JWT_SECRET: z.string().min(8),
  JWT_REFRESH_SECRET: z.string().min(8),
  ACCESS_TOKEN_TTL: durationSchema.default('15m'),
  REFRESH_TOKEN_TTL: durationSchema.default('30d'),

  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().min(1).default('us-east-1'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  // eslint-disable-next-line no-console -- boot-time failure must reach the operator even if the logger cannot start
  console.error(`Invalid environment configuration:\n${details}`);
  process.exit(1);
}

export type Env = z.infer<typeof envSchema>;

export const env: Env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
