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
 */
const queryClient = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
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
