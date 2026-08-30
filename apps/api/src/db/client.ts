/**
 * The database connection — one pool for the whole process.
 *
 * Everything that touches Postgres goes through `db` (or `withTx`). Controllers
 * and routes must never import this module: the layering is
 * `routes → controllers → services → db`.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '../config/env';
import * as schema from './schema';

/**
 * postgres-js connection pool.
 *
 * `prepare: false` — named prepared statements are per-connection server-side
 * objects, which break the moment the pool sits behind a transaction-pooling
 * proxy (PgBouncer, Supavisor) that hands a different backend to each query.
 * FlowBoard's dev compose talks to Postgres directly, but this is a
 * deploy-topology decision that must not be discovered in production; the cost
 * is one extra parse per query, which is noise next to the network round-trip.
 *
 * ═══ `TimeZone: 'UTC'` — WHY THE SESSION IS PINNED (R2 W3.5) ════════════════
 *
 * `date_trunc(unit, timestamptz)` is NOT absolute. Postgres converts the value
 * into the SESSION's `TimeZone` first, truncates there, and converts back — so
 * the same instant lands in a different day bucket depending on a setting the
 * query never mentions. Every analytics and telemetry series in the product is
 * built that way (`admin-analytics.service.ts`'s `windowCte`,
 * `admin-telemetry.service.ts`'s `requestsOverTime` and `eventsOverTime`), and
 * the API deliberately speaks UTC everywhere else: the contract's instants are
 * `isoDateTime`, the web resolves its windows in UTC, and `startOfUtcDay` in the
 * telemetry service computes today's boundary in Node.
 *
 * Without this pin the boundary depends on the SERVER's `timezone` GUC — which
 * is whatever the image, the managed provider or a `postgresql.conf` says.
 * FlowBoard's own compose image happens to be UTC, so the bug is invisible in
 * development and appears only on a deployment whose database is set to, say,
 * `America/New_York`: every daily bucket would silently start at 05:00Z and the
 * "today" tile would disagree with the chart beside it by five hours.
 *
 * IT IS PINNED HERE RATHER THAN PASSED PER CALL. The alternative is
 * `date_trunc(unit, ts, 'UTC')` at each of the six call sites, which fixes the
 * queries that exist and none of the ones a later wave writes — and this is a
 * connection-level property with a connection-level home. `connection` sends the
 * value as a startup parameter, so EVERY backend the pool opens (including ones
 * opened later to grow the pool) carries it; there is no `SET` to forget on a
 * reconnect.
 *
 * Nothing else in the app is sensitive to it: `timestamptz` values are absolute
 * and postgres-js parses them into `Date` regardless of the session zone, and
 * the `date` columns (a sprint's planned window) carry no zone at all.
 */
const queryClient = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
  connection: { TimeZone: 'UTC' },
});

export const db = drizzle(queryClient, { schema });

export type Schema = typeof schema;
export type Db = typeof db;

/**
 * The transaction handle, derived from `db` rather than hand-written, so it can
 * never drift from the schema generic.
 */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Run `fn` inside one transaction. **The** canonical multi-write helper.
 *
 * Every mutation that writes more than one row — and in FlowBoard that is
 * almost all of them, because each one also appends an activity row — must go
 * through this. Throwing from `fn` rolls the whole thing back.
 *
 * Services should accept an optional `Tx` so they compose:
 * `async function addTask(input: Input, tx: Tx | Db = db)`.
 *
 * @example
 *   const task = await withTx(async (tx) => {
 *     const [row] = await tx.update(projects)…returning();
 *     await tx.insert(activity).values({ … });
 *     return row;
 *   });
 */
export function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

/** Drain the pool. For graceful shutdown and for CLI scripts, which otherwise hang. */
export async function closeDb(): Promise<void> {
  await queryClient.end({ timeout: 5 });
}
