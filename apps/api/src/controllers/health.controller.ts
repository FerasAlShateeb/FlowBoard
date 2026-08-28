/**
 * Liveness / readiness probe.
 *
 * Also the reference implementation of the response contract: every route in
 * FlowBoard answers with `{ success, data, meta?, error? }` — never a bare
 * payload.
 *
 * ── Injection ───────────────────────────────────────────────────────────────
 * A readiness probe that does not touch the database is a liveness probe with
 * extra steps, but WP1.2 may not import `src/db/**`. The ping therefore arrives
 * through `setDbHealthChecker()`; with none wired the endpoint reports
 * `db: 'unknown'` and stays a 200 (the process IS alive), so the route is
 * useful before the DB package exists and honest afterwards.
 */
import type { Request, Response } from 'express';
import { ApiError } from '../utils/api-error';
import { respond } from '../utils/respond';

/** Resolves true when the database answered a trivial query. */
export type DbHealthChecker = () => Promise<boolean>;

/** Database leg of the probe, as reported in the payload. */
export type DbHealth = 'ok' | 'down' | 'unknown';

export interface HealthPayload {
  status: 'ok';
  /** Whole seconds since this process started. */
  uptimeSeconds: number;
  timestamp: string;
  db: DbHealth;
}

let dbHealthChecker: DbHealthChecker | null = null;

/**
 * Wire the database ping.
 *
 * INJECTION POINT — call once from the composition root:
 * `setDbHealthChecker(() => pingDb())`. Pass `null` to detach (tests).
 */
export function setDbHealthChecker(checker: DbHealthChecker | null): void {
  dbHealthChecker = checker;
}

async function checkDb(): Promise<DbHealth> {
  if (!dbHealthChecker) return 'unknown';
  try {
    return (await dbHealthChecker()) ? 'ok' : 'down';
  } catch {
    return 'down';
  }
}

/**
 * `GET /api/health`.
 *
 * @throws {ApiError} 503 when a wired database ping fails — an orchestrator
 * must be able to pull an instance that cannot serve reads out of rotation.
 */
export async function getHealth(_req: Request, res: Response): Promise<void> {
  const db = await checkDb();
  if (db === 'down') {
    throw ApiError.serviceUnavailable('Database is unreachable');
  }
  const payload: HealthPayload = {
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    db,
  };
  respond(res, payload);
}
