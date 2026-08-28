/**
 * `requestLogger` — buffers one row per finished request and flushes to
 * `request_logs` in batches (every 5 s OR every 50 rows).
 *
 * Fire-and-forget: it never blocks a request, never throws into the chain, and
 * DROPS a batch it cannot write rather than retrying. Telemetry that can take
 * the site down is worse than no telemetry.
 *
 * ── Injection ───────────────────────────────────────────────────────────────
 * WP1.2 must compile with zero imports from `src/db/**`, so the actual insert
 * arrives through `setRequestLogSink()`. The Wave-1 integrator wires it once,
 * at boot, to the drizzle batch insert. Until then every flush is a no-op and
 * the buffer simply never grows past the threshold.
 *
 * ── Path cardinality ────────────────────────────────────────────────────────
 * `path` is the ROUTE PATTERN, not the URL. The admin telemetry dashboards
 * group by it, so `/api/tasks/:taskId` must be one bucket rather than one per
 * task. `req.route` (populated by the time `finish` fires) supplies the
 * matched pattern; the router MOUNT prefix in `req.baseUrl` still holds real
 * ids, so it is normalised segment-wise. Requests that matched no route (404s)
 * fall back to normalising the whole path.
 */
import type { Request, RequestHandler } from 'express';
import type { RequestLogInsert } from '../types/persistence';

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_THRESHOLD = 50;

/** Persists a batch of request rows. Injected by the integrator at boot. */
export type RequestLogSink = (rows: RequestLogInsert[]) => Promise<void>;

let sink: RequestLogSink | null = null;
let buffer: RequestLogInsert[] = [];
let timer: NodeJS.Timeout | null = null;

/**
 * Wire the persistence sink.
 *
 * INJECTION POINT — call once from the composition root:
 * `setRequestLogSink((rows) => db.insert(requestLogs).values(rows).then(() => undefined))`.
 * Pass `null` to detach (tests).
 */
export function setRequestLogSink(next: RequestLogSink | null): void {
  sink = next;
}

function scheduleFlush(): void {
  if (timer) return;
  timer = setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);
  // Never hold the event loop (or a vitest worker) open for the logger.
  timer.unref();
}

/** Hand the current buffer to the sink, swallowing failures. */
async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const rows = buffer;
  buffer = [];
  if (!sink) return;
  try {
    await sink(rows);
  } catch {
    /* best-effort: drop the batch rather than crash or retry-storm */
  }
}

/**
 * Flush immediately. Called on graceful shutdown (SIGTERM/SIGINT) and by tests,
 * so the last few requests before a deploy are not lost.
 */
export async function flushRequestLogs(): Promise<void> {
  await flush();
}

/** Test-only: drop buffered rows and stop the interval. */
export function resetRequestLogger(): void {
  buffer = [];
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Replace concrete ids in a mount prefix with `:id` so buckets stay bounded. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const NUMERIC_PATTERN = /^\d+$/u;
/** Project task keys — `FB-123`. Their own bucket would be one per task. */
const TASK_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}-\d+$/u;

function normalizePath(pathname: string): string {
  const normalized = pathname
    .split('/')
    .map((segment) => {
      if (segment.length === 0) return segment;
      if (UUID_PATTERN.test(segment)) return ':id';
      if (NUMERIC_PATTERN.test(segment)) return ':id';
      if (TASK_KEY_PATTERN.test(segment)) return ':key';
      return segment;
    })
    .join('/');
  return normalized.length > 0 ? normalized : '/';
}

/** Non-empty path segments — `'/api/health'` → `['api', 'health']`. */
function segmentsOf(pathname: string): string[] {
  return pathname.split('/').filter((segment) => segment.length > 0);
}

/**
 * The route pattern this request matched, or a normalised fallback.
 *
 * ── Why the mount prefix is recovered from `originalUrl`, not `req.baseUrl` ──
 * `req.baseUrl` is only correct while the request is INSIDE the mounted router.
 * Express restores it as the stack unwinds, and an error response unwinds all
 * the way to the app-level error handler before it writes — so by the time
 * `finish` fires on a 401/403/404/500, `req.baseUrl` is back to `''` while
 * `req.route` still points at the matched route. Trusting it there logged
 * `GET /logs` instead of `GET /api/admin/logs`, which would have made the admin
 * dashboard's error-rate-by-endpoint table group every failure under a stub of
 * its real path — and silently, since the success rows looked right.
 *
 * The prefix is therefore reconstructed by dropping as many trailing segments
 * from the original URL as the matched route pattern itself consumed. Those
 * prefix segments still hold REAL ids (`/api/projects/<uuid>`), so they are
 * normalised; the route's own tail already carries `:param` names and is kept
 * verbatim, which is why `/api/projects/:id/tasks/:taskId` comes out with the
 * more informative name on the half we know.
 */
export function resolveRoutePattern(req: Request): string {
  const rawPath = req.originalUrl.split('?')[0] ?? req.path;
  const routePath: unknown = req.route?.path;

  if (typeof routePath === 'string') {
    const consumed = segmentsOf(routePath).length;
    const all = segmentsOf(rawPath);
    // A route mounted at `/` consumes nothing, so the whole URL is the prefix.
    const prefixSegments = consumed > 0 ? all.slice(0, Math.max(0, all.length - consumed)) : all;
    const base = prefixSegments.length > 0 ? normalizePath(`/${prefixSegments.join('/')}`) : '';

    const combined = `${base}${routePath}`.replace(/\/{2,}/gu, '/');
    const trimmed = combined.length > 1 ? combined.replace(/\/$/u, '') : combined;
    return trimmed.length > 0 ? trimmed : '/';
  }

  // No route matched (404) or the route used a RegExp/array path.
  return normalizePath(rawPath);
}

export const requestLogger: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();
  req.startedAt = start;

  res.on('finish', () => {
    const durationMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
    buffer.push({
      method: req.method,
      path: resolveRoutePattern(req),
      statusCode: res.statusCode,
      durationMs,
      userId: req.user?.id ?? null,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      createdAt: new Date(),
    });
    scheduleFlush();
    if (buffer.length >= FLUSH_THRESHOLD) void flush();
  });

  next();
};
