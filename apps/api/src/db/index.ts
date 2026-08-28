/**
 * Database barrel — `import { db, withTx, tasks } from '../db'`.
 *
 * Services import from here; nothing above the service layer imports it at all.
 */
export { closeDb, db, withTx } from './client';
export type { Db, Schema, Tx } from './client';
export * from './schema';
