/**
 * THE COMPOSITION ROOT.
 *
 * Four modules in the API core are written to know nothing about the database:
 * the telemetry recorder, the request-log buffer, the socket handshake's user
 * lookup, and the health probe. Each exposes a `setXSink()` / `setXResolver()`
 * and no-ops (or fails closed) until something wires it. This file is that
 * something, and it is the ONLY place those four are wired.
 *
 * WHY THE INDIRECTION SURVIVED WAVE 1. It started as a build-order workaround —
 * the API core was written before `src/db/**` existed — but it earns its keep
 * permanently:
 *
 *  - `telemetry.service` and `request-logger` are fire-and-forget observability.
 *    Their unit suites drive them with a fake sink and assert the fire-and-forget
 *    contract (never awaits, never throws, drops on failure); a hard `import
 *    { db }` would drag a live pool into every one of those tests.
 *  - `sockets/io` and `health.controller` sit ABOVE the service layer, where the
 *    project's layering rule (`routes → controllers → services → db`) forbids a
 *    db import outright.
 *
 * `server.ts` calls `bootstrap()` once, before it listens. `app.ts` does NOT —
 * supertest builds the app without a database, which is what keeps the
 * middleware tests fast and hermetic.
 */
import { eq, sql } from 'drizzle-orm';

import { setDbHealthChecker } from './controllers/health.controller';
import { db, requestLogs, telemetryEvents, users } from './db';
import { setRequestLogSink } from './middlewares/request-logger';
import { registerNotificationSubscribers } from './services/notifications.bootstrap';
import { setTelemetrySink } from './services/telemetry.service';
import { setSocketUserResolver } from './sockets/io';
import { registerRealtimeBridge } from './sockets/realtime-bridge';
import { logger } from './utils/logger';

/**
 * Cheap readiness ping.
 *
 * `select 1` deliberately touches no table: the question a readiness probe asks
 * is "can this process still get a connection and round-trip a query", and a
 * probe that reads a real table would also fail on an unrelated permission or
 * migration problem — turning one bad table into a whole instance out of
 * rotation.
 */
async function pingDb(): Promise<boolean> {
  await db.execute(sql`select 1`);
  return true;
}

/**
 * Wire every persistence injection point to Drizzle. Idempotent, but there is
 * exactly one caller (`server.ts`).
 */
export function bootstrap(): void {
  // 1. Telemetry: one row per product event. `record()` already guarantees the
  //    caller never sees a failure, so this may reject freely.
  setTelemetrySink(async (event) => {
    await db.insert(telemetryEvents).values(event);
  });

  // 2. Request logs: the middleware hands over whole BATCHES (every 5 s or 50
  //    rows), so this is one multi-row INSERT rather than one per request —
  //    which is the entire reason the buffer exists.
  setRequestLogSink(async (rows) => {
    if (rows.length === 0) return;
    await db.insert(requestLogs).values(rows);
  });

  // 3. Socket handshake: the revocation check. A socket lives for hours, so a
  //    deactivated account or a bumped `token_version` must be caught at
  //    connect time rather than whenever the token happens to expire.
  //    `null` (no such user) is a rejected handshake, not an error.
  setSocketUserResolver(async (userId) => {
    const [row] = await db
      .select({ tokenVersion: users.tokenVersion, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ?? null;
  });

  // 4. Readiness. `getHealth` turns a `false`/throw into a 503 so an
  //    orchestrator pulls an instance that cannot serve reads.
  setDbHealthChecker(pingDb);

  // 5–6. Wave-4 domain-event consumers (no-op stubs until their packages land):
  //    realtime socket emits and notification fan-out.
  registerRealtimeBridge();
  registerNotificationSubscribers();

  logger.debug('Persistence sinks wired (telemetry, request logs, socket auth, health)');
}
