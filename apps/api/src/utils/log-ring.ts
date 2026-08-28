/**
 * In-memory ring buffer of the most recent server-log lines.
 *
 * pino writes every line to stdout AND to `ringStream` (see `logger.ts`); the
 * diagnostics drawer tails the ring through `GET /api/admin/logs?sinceId=…`.
 * Bounded (drop-oldest), per-process, and stamped with a strictly monotonic
 * `id` that is NEVER reused — that is what makes a `sinceId` cursor survive
 * eviction: the client asks for "everything after 812" and gets the correct
 * answer whether or not 812 is still in the buffer.
 *
 * IMPORTANT: this module must NOT import `logger.ts`. The dependency points
 * logger → ring, and a cycle would make the logger observe a half-initialised
 * ring at module-eval time.
 *
 * ⚠️ SCALING BOUNDARY — SINGLE-INSTANCE ONLY. The ring and its id counter live
 * in this process's heap and only ever see lines THIS process wrote. Behind two
 * API replicas the drawer would tail whichever instance the load balancer
 * picked, and `sinceId` — a per-process counter — would jump backwards on every
 * reroute. Horizontal scaling swaps the implementation behind the same
 * `push` / `snapshot` / `ringStream` trio (a Redis capped list with ids minted
 * by `INCR`, or a real aggregator); nothing outside this file changes.
 */
import {
  logLevelSchema,
  type LogLevel,
  type ServerLogRecord,
  type ServerLogsSnapshot,
} from '@flowboard/shared';

/**
 * Severity vocabulary, the rendered line, and the snapshot payload all come from
 * `@flowboard/shared`'s diagnostics contract — ONE definition, parsed by the
 * drawer at the other end. Re-exported here so the ring stays the single import
 * site for everything about a log line.
 *
 * `ServerLogRecord`/`ServerLogsSnapshot` are the schemas' OUTPUT types, so the
 * objects built below are checked against exactly what the drawer parses.
 */
export type { LogLevel, ServerLogRecord, ServerLogsSnapshot } from '@flowboard/shared';

/**
 * Every level label, ascending by severity. Derived from the shared enum rather
 * than re-typed, so the two can never drift.
 */
export const LOG_LEVELS = logLevelSchema.options;

/**
 * Max lines retained; older lines are evicted first.
 *
 * The shared `serverLogsQuerySchema` caps `limit` at this same number — asking
 * for more than the ring can hold is never meaningful. `admin-logs.validation.ts`
 * asserts the two agree.
 */
export const RING_CAPACITY = 500;

/** A parsed pino record after we stamp it with a ring id. */
interface RingRecord {
  id: number;
  time: number;
  levelNum: number;
  msg: string;
  context: Record<string, unknown>;
}

/** pino numeric level → label. Values outside the map fall back to 'info'. */
const LEVEL_LABEL: Record<number, LogLevel> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

/** Ascending severity of the labels, for min-level comparisons. */
const LEVEL_NUM: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/** pino binding keys that are NOT part of the free-form context. */
const RESERVED_KEYS = new Set(['level', 'time', 'msg', 'pid', 'hostname']);

let ring: RingRecord[] = [];
let nextId = 1;

/** Coerce an unknown pino numeric level to its label (defaulting to 'info'). */
function labelFor(levelNum: number): LogLevel {
  return LEVEL_LABEL[levelNum] ?? 'info';
}

/**
 * Parse one raw pino record (already `JSON.parse`d), stamp it with a fresh
 * monotonic id, and append — evicting the oldest line past `RING_CAPACITY`.
 * Non-objects are ignored rather than throwing: this runs inside a log write.
 */
export function push(raw: unknown): void {
  if (typeof raw !== 'object' || raw === null) return;
  const obj = raw as Record<string, unknown>;

  const context: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!RESERVED_KEYS.has(key)) context[key] = value;
  }

  const record: RingRecord = {
    id: nextId,
    time: typeof obj.time === 'number' ? obj.time : Date.now(),
    levelNum: typeof obj.level === 'number' ? obj.level : 30,
    msg: typeof obj.msg === 'string' ? obj.msg : '',
    context,
  };
  nextId += 1;

  ring.push(record);
  if (ring.length > RING_CAPACITY) ring.shift();
}

export interface SnapshotOptions {
  /** Only return records with `id` strictly greater than this cursor. */
  sinceId?: number;
  /** Minimum severity (inclusive) to include. */
  level?: LogLevel;
  /** Max records to return (tail-capped); defaults to and caps at RING_CAPACITY. */
  limit?: number;
}

/**
 * Materialise the current ring: numeric levels mapped to labels, filtered by
 * `sinceId` and min-`level`, then tail-capped to `limit`. Tail (not head) so a
 * client that fell behind gets the NEWEST lines it is missing, which is what a
 * live tail wants.
 */
export function snapshot(options: SnapshotOptions = {}): ServerLogsSnapshot {
  const { sinceId, level, limit } = options;
  const minLevelNum = level ? LEVEL_NUM[level] : 0;
  const cap = Math.min(limit ?? RING_CAPACITY, RING_CAPACITY);

  const filtered = ring.filter(
    (record) => (sinceId === undefined || record.id > sinceId) && record.levelNum >= minLevelNum,
  );

  const tail = cap > 0 ? filtered.slice(-cap) : [];

  const records: ServerLogRecord[] = tail.map((record) => ({
    id: record.id,
    time: record.time,
    level: labelFor(record.levelNum),
    msg: record.msg,
    context: record.context,
  }));

  const last = ring[ring.length - 1];

  return { records, lastId: last ? last.id : 0 };
}

/** Reset the ring and id counter — test-only. */
export function clearRing(): void {
  ring = [];
  nextId = 1;
}

/**
 * pino multistream sink: each line arrives as a JSON string. Parse-and-push,
 * swallowing malformed lines so a bad write can never break logging.
 */
export const ringStream = {
  write(line: string): void {
    try {
      push(JSON.parse(line));
    } catch {
      /* ignore malformed lines */
    }
  },
};
