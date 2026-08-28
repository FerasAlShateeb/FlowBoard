// Diagnostics contracts: the server-log ring-buffer snapshot exposed to global
// admins via `GET /api/admin/logs`. The API keeps a bounded in-memory ring of
// pino records (500, monotonic ids — `apps/api/src/utils/log-ring.ts`) and
// serializes them through these schemas; the web diagnostics drawer polls the
// snapshot every 2s with the last cursor it saw and parses it back.
//
// This contract is carried over from GameDash VERBATIM. It is a proven shape and
// the drawer is ported alongside it, so any "improvement" here is a divergence
// that costs more than it buys.
//
// Runtime-neutral: zod only, no DOM/Node globals.
import { z } from 'zod';

/** The pino log levels, ordered least -> most severe, mapped from numeric codes. */
export const logLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
export type LogLevel = z.infer<typeof logLevelSchema>;

/**
 * One server-log line as returned by the admin snapshot. `id` is a monotonic
 * ring cursor (for `sinceId` tailing), `time` is epoch-ms, and `context` holds
 * the remaining pino bindings (everything except level/time/msg/pid/hostname).
 */
export const serverLogRecordSchema = z.object({
  id: z.number().int().nonnegative(),
  time: z.number(),
  level: logLevelSchema,
  msg: z.string().default(''),
  context: z.record(z.string(), z.unknown()).default({}),
});
export type ServerLogRecord = z.infer<typeof serverLogRecordSchema>;

/**
 * A tail of the ring: the (level-filtered, limit-capped) records plus `lastId`,
 * the highest id currently in the ring (0 when empty) — the cursor a client
 * passes back as `sinceId` to fetch only newer records.
 *
 * A `lastId` LOWER than the cursor the client holds means the server restarted
 * and the ring rewound; the drawer treats that as "start over" rather than
 * showing a gap.
 */
export const serverLogsSnapshotSchema = z.object({
  records: z.array(serverLogRecordSchema),
  lastId: z.number().int().nonnegative(),
});
export type ServerLogsSnapshot = z.infer<typeof serverLogsSnapshotSchema>;

/**
 * `GET /admin/logs?sinceId&level&limit`. Everything arrives as a query string,
 * so the numbers are coerced. `limit` is capped at (and defaults to) the ring's
 * own capacity: asking for more than the ring holds is never meaningful.
 */
export const serverLogsQuerySchema = z.object({
  sinceId: z.coerce.number().int().nonnegative().default(0),
  level: logLevelSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(500),
});
export type ServerLogsQuery = z.infer<typeof serverLogsQuerySchema>;
