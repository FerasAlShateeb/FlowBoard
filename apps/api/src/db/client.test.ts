/**
 * THE POOL'S SESSION TIME ZONE — a one-line setting every analytics and
 * telemetry bucket boundary depends on.
 *
 * `date_trunc(unit, timestamptz)` truncates in the SESSION's zone, so "which day
 * is this instant in" is answered by a connection setting that the six
 * `date_trunc` call sites in `admin-analytics.service.ts` and
 * `admin-telemetry.service.ts` never mention. The pool pins it to UTC (see the
 * `TimeZone: 'UTC'` note in `db/client.ts`); without the pin the answer comes
 * from whatever the deployment's database is configured to think, and the bug is
 * invisible in development because the compose image happens to be UTC already.
 *
 * The second test is the one that earns its keep. Asserting `current_setting`
 * only proves the option was passed; running the SAME truncation over the SAME
 * instant on a deliberately non-UTC session proves the setting is LOAD-BEARING —
 * that a deployment without it really would file a 23:30Z request under the next
 * day. `Asia/Kolkata` is the control zone because its +05:30 offset moves the
 * day boundary AND is not a whole number of hours, so an hour-granularity bug
 * cannot hide behind it either.
 */
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { env } from '../config/env';
import { closeDb, db } from './client';
import { ensureTestDb } from '../test/test-db';

/** 23:30 UTC on the 30th — which is 05:00 on the 31st in Kolkata. */
const LATE_EVENING_UTC = '2026-08-30T23:30:00.000Z';

beforeAll(async () => {
  await ensureTestDb();
});

afterAll(async () => {
  await closeDb();
});

describe('the application pool', () => {
  it('runs its sessions in UTC', async () => {
    const rows = await db.execute<{ tz: string }>(sql`select current_setting('TimeZone') as tz`);
    expect(rows[0]?.tz).toBe('UTC');
  });

  it('puts a 23:30Z instant in the 30th, where a non-UTC session puts it in the 31st', async () => {
    // Rendered back through `at time zone 'UTC'` and compared as TEXT: the
    // assertion is about which INSTANT the bucket starts at, and reading it as a
    // driver-parsed value would let a client-side date policy answer instead.
    const rows = await db.execute<{ bucket: string }>(
      sql`select (date_trunc('day', ${LATE_EVENING_UTC}::timestamptz) at time zone 'UTC')::text as bucket`,
    );
    expect(rows[0]?.bucket).toBe('2026-08-30 00:00:00');

    // The control: the same statement, on a session that is not pinned to UTC.
    const kolkata = postgres(env.DATABASE_URL, {
      max: 1,
      prepare: false,
      connection: { TimeZone: 'Asia/Kolkata' },
    });
    try {
      const [drifted] = await kolkata<{ bucket: string }[]>`
        select (date_trunc('day', ${LATE_EVENING_UTC}::timestamptz) at time zone 'UTC')::text
          as bucket
      `;
      // 2026-08-31 00:00 +05:30 — a different DAY, from the very same instant.
      expect(drifted?.bucket).toBe('2026-08-30 18:30:00');
    } finally {
      await kolkata.end({ timeout: 5 });
    }
  });

  /**
   * The pin is a STARTUP parameter, so it is carried by every backend the pool
   * opens — including ones opened later to grow it. A `SET` issued once after
   * connect would be forgotten on a reconnect, which is exactly the failure that
   * would only show up under load.
   */
  it('carries the zone on concurrent connections, not just the first one', async () => {
    const zones = await Promise.all(
      Array.from({ length: 5 }, () =>
        db.execute<{ tz: string }>(sql`select current_setting('TimeZone') as tz, pg_sleep(0.05)`),
      ),
    );
    expect(zones.map((rows) => rows[0]?.tz)).toEqual(['UTC', 'UTC', 'UTC', 'UTC', 'UTC']);
  });
});
