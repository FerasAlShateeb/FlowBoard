import type { z } from 'zod';
import type { PaginationMeta } from '@flowboard/shared';
import { apiBaseUrl } from '@/lib/env';
import { useAuthStore } from '@/stores/useAuthStore';

/**
 * THE HTTP client. Every request FlowBoard's web app makes goes through this
 * module, and it is the only place that knows about the response envelope, the
 * bearer token, or the refresh cycle.
 *
 * Four responsibilities, in order of how surprising they are:
 *
 * 1. **Envelope unwrap.** The API answers `{ success, data, meta? }` or
 *    `{ success: false, error: { code, message, details? } }`. Callers get
 *    `data` on success and an {@link ApiError} throw on failure, so a data hook
 *    never writes `if (!res.success)`.
 * 2. **Optional zod parse.** Pass `schema` and the payload is validated at the
 *    boundary — the project's "zod at every boundary, both ends" rule.
 * 3. **Single-flight refresh.** See {@link refreshSession}.
 * 4. **`X-Socket-Id` on mutations.** See {@link setSocketIdProvider}.
 */

/** Thrown for every non-2xx response and every envelope with `success: false`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code = 'unknown_error', details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * The envelope error code that means "your access token aged out" — the ONLY
 * 401 that triggers a refresh. A 401 for any other reason (revoked
 * `tokenVersion`, a tampered token, a deactivated account) is terminal: retrying
 * it would just burn the refresh token too.
 */
export const TOKEN_EXPIRED_CODE = 'token_expired';

/** Status/code used when `fetch` itself rejects (offline, DNS, CORS). */
export const NETWORK_ERROR_CODE = 'network_error';

// ───────────────────────────────────────────────────────────────────────────
// Socket id
// ───────────────────────────────────────────────────────────────────────────

type SocketIdProvider = () => string | null;

let socketIdProvider: SocketIdProvider | null = null;

/**
 * Registers the source of the current Socket.IO connection id.
 *
 * ECHO SUPPRESSION (plan §Socket.IO map). Every mutation carries the sender's
 * socket id in `X-Socket-Id`; the API publishes domain events with that
 * `originSocketId` and emits `io.to(room).except(originSocketId)`. The actor's
 * own cache is therefore written by its optimistic update plus the mutation
 * response — never a second time by its own broadcast, which is what would make
 * a dragged card jump.
 *
 * WP4.1 calls this once with `() => socket.id ?? null`. Until then the provider
 * is null, the header is simply absent, and the server treats every mutation as
 * having no origin — correct behaviour, just without the optimisation.
 *
 * A FUNCTION rather than a value because the id changes on every reconnect.
 */
export function setSocketIdProvider(provider: SocketIdProvider | null): void {
  socketIdProvider = provider;
}

// ───────────────────────────────────────────────────────────────────────────
// Query strings
// ───────────────────────────────────────────────────────────────────────────

/** A value that can appear in a query string. */
export type QueryValue =
  string | number | boolean | null | undefined | readonly (string | number)[];

/**
 * Builds `?a=1&b=x,y` from a params object, or `''` when nothing survives.
 *
 * Arrays are COMMA-JOINED rather than repeated (`?label=bug,ui`, not
 * `?label=bug&label=ui`) because that is the multi-value filter format the API
 * validates (plan §REST surface). `null`, `undefined` and `''` are dropped, so
 * a caller can pass an optional filter straight through without a conditional
 * — an omitted filter and an empty one mean the same thing here.
 */
export function toQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      search.set(key, value.join(','));
      continue;
    }
    const asString = String(value);
    if (asString === '') continue;
    search.set(key, asString);
  }

  const query = search.toString();
  return query ? `?${query}` : '';
}

// ───────────────────────────────────────────────────────────────────────────
// Envelope
// ───────────────────────────────────────────────────────────────────────────

interface RawEnvelope {
  success?: boolean;
  data?: unknown;
  meta?: PaginationMeta;
  error?: { code?: string; message?: string; details?: unknown } | null;
}

async function readEnvelope(res: Response): Promise<RawEnvelope | null> {
  try {
    return (await res.json()) as RawEnvelope;
  } catch {
    // Not JSON at all — an nginx error page, a proxy timeout, or a 204.
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Single-flight refresh
// ───────────────────────────────────────────────────────────────────────────

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Refreshes the token pair AT MOST ONCE at a time.
 *
 * THE RACE THIS EXISTS TO KILL. A board page fires six queries in parallel on
 * mount. If the access token has just expired, all six get a 401 within
 * milliseconds of each other. Without the shared promise each one would POST
 * `/auth/refresh` independently; the API ROTATES the refresh token, so the
 * first request invalidates the token the other five are still holding, and
 * five of the six log the user out. Funnelling them through one promise means
 * one rotation and six retries.
 *
 * Resolves `true` when the store now holds a fresh pair. On ANY failure it
 * clears the session and resolves `false` — it never throws, because callers
 * are inside an error path already and a rejection here would mask the original
 * 401 with a less useful one.
 */
function refreshSession(): Promise<boolean> {
  refreshInFlight ??= performRefresh().finally(() => {
    // Cleared once the shared promise settles, so the NEXT expiry starts a new
    // flight rather than replaying this one's outcome forever.
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/**
 * The single round trip behind {@link refreshSession}.
 *
 * ═══ IT CAN OUTLIVE THE SESSION THAT STARTED IT ════════════════════════════
 *
 * A refresh is a network call, and a person can sign out — or sign in as
 * somebody else — while it is in the air. Every write below is therefore
 * conditional on the store still being on the SAME session generation it was
 * when this flight began (`stores/useAuthStore`, `sessionGeneration`):
 *
 *   - a late SUCCESS must not `setTokens`: that is a signed-out tab getting a
 *     valid pair written back into persisted storage, which signs the user in
 *     again on the next boot. It is the bug this guard exists for.
 *   - a late FAILURE must not `clearSession` either, which is the subtler half:
 *     by then the tokens it would drop can belong to a session established
 *     AFTER this refresh started, so clearing would sign out the user who just
 *     signed in.
 *
 * The captured generation is read once, before the `await`, and compared once,
 * after it — the only two moments that matter, because nothing between them
 * touches the store.
 */
async function performRefresh(): Promise<boolean> {
  const { refreshToken, sessionGeneration } = useAuthStore.getState();

  /** Has the session changed identity since this flight started? */
  const superseded = (): boolean => useAuthStore.getState().sessionGeneration !== sessionGeneration;

  /** Tear the session down — unless a newer one has already replaced it. */
  const abandon = (): boolean => {
    if (!superseded()) useAuthStore.getState().clearSession();
    return false;
  };

  // No await has happened yet, so the session cannot have moved: clear directly.
  if (!refreshToken) {
    useAuthStore.getState().clearSession();
    return false;
  }

  try {
    const res = await fetch(`${apiBaseUrl()}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const envelope = await readEnvelope(res);

    if (!res.ok || envelope?.success !== true) return abandon();

    // Hand-checked rather than zod-parsed: this runs during error recovery, so
    // a schema import failing here would be the second failure in a row.
    const data = envelope.data as { accessToken?: unknown; refreshToken?: unknown } | null;
    if (typeof data?.accessToken !== 'string' || typeof data.refreshToken !== 'string') {
      return abandon();
    }

    // THE RACE. A logout (or a fresh login) that landed while this was in
    // flight has already bumped the generation; writing here would undo it.
    // The caller reads `false` and stops retrying, which is correct — there is
    // no session left to retry under.
    if (superseded()) return false;

    useAuthStore
      .getState()
      .setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    return true;
  } catch {
    // Network failure mid-refresh. Clearing is the safe verdict: the tokens we
    // hold are known-stale, and a signed-out user can retry by signing in.
    return abandon();
  }
}

// ───────────────────────────────────────────────────────────────────────────
// The request pipeline
// ───────────────────────────────────────────────────────────────────────────

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions<T> {
  /** JSON request body. Omit for GET/DELETE. */
  body?: unknown;
  /** Zod schema applied to the envelope's `data`. */
  schema?: z.ZodType<T>;
  /** Query params, serialised by {@link toQuery}. */
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
  /** Extra headers. Merged last, so a caller can override anything. */
  headers?: Record<string, string>;
}

export interface ApiResult<T> {
  data: T;
  meta?: PaginationMeta;
}

function buildUrl(path: string, query: Record<string, QueryValue> | undefined): string {
  return `${apiBaseUrl()}/api${path}${query ? toQuery(query) : ''}`;
}

async function execute<T>(
  method: HttpMethod,
  path: string,
  options: RequestOptions<T>,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };

  const token = useAuthStore.getState().accessToken;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  // Only mutations need an origin: a GET produces no broadcast to suppress.
  if (method !== 'GET') {
    const socketId = socketIdProvider?.();
    if (socketId) headers['X-Socket-Id'] = socketId;
  }

  Object.assign(headers, options.headers);

  try {
    return await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      // Same-origin by default; the dev proxy and nginx both forward `/api`.
      credentials: 'include',
    });
  } catch (error) {
    // An aborted request must surface as an AbortError, NOT as a network
    // ApiError — TanStack Query keys its cancellation handling on that.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Could not reach the server.', 0, NETWORK_ERROR_CODE, error);
  }
}

async function request<T>(
  method: HttpMethod,
  path: string,
  options: RequestOptions<T> = {},
): Promise<ApiResult<T>> {
  let res = await execute(method, path, options);
  let envelope = await readEnvelope(res);

  // The one retry. Gated on BOTH the status and the code so an unrelated 401
  // (revoked token version, disabled account) fails fast instead of spending
  // the refresh token on a request that can never succeed.
  if (res.status === 401 && envelope?.error?.code === TOKEN_EXPIRED_CODE) {
    const refreshed = await refreshSession();
    if (refreshed) {
      res = await execute(method, path, options);
      envelope = await readEnvelope(res);
    }
  }

  // 204/205 carry no body by design (e.g. `DELETE /tasks/:id/watchers/me`).
  // Without this branch the success gate below would read the missing envelope
  // as a failure on a request that actually succeeded.
  if (res.ok && envelope === null && (res.status === 204 || res.status === 205)) {
    return { data: undefined as T };
  }

  if (!res.ok || envelope?.success !== true) {
    throw new ApiError(
      envelope?.error?.message ?? `Request failed with status ${res.status}`,
      res.status,
      envelope?.error?.code ?? 'unknown_error',
      envelope?.error?.details,
    );
  }

  const data = options.schema ? options.schema.parse(envelope.data) : (envelope.data as T);
  return { data, meta: envelope.meta };
}

/**
 * The verbs. Each returns the unwrapped `data`, because that is what >95% of
 * call sites want; {@link paged} is the escape hatch for list endpoints that
 * also need the `meta` block.
 */
export const api = {
  get: <T = unknown>(path: string, options?: RequestOptions<T>): Promise<T> =>
    request<T>('GET', path, options).then((result) => result.data),

  post: <T = unknown>(path: string, body?: unknown, options?: RequestOptions<T>): Promise<T> =>
    request<T>('POST', path, { ...options, body }).then((result) => result.data),

  patch: <T = unknown>(path: string, body?: unknown, options?: RequestOptions<T>): Promise<T> =>
    request<T>('PATCH', path, { ...options, body }).then((result) => result.data),

  put: <T = unknown>(path: string, body?: unknown, options?: RequestOptions<T>): Promise<T> =>
    request<T>('PUT', path, { ...options, body }).then((result) => result.data),

  del: <T = unknown>(path: string, options?: RequestOptions<T>): Promise<T> =>
    request<T>('DELETE', path, options).then((result) => result.data),

  /** GET returning `{ data, meta }` — for `?page&pageSize` list endpoints. */
  paged: <T = unknown>(path: string, options?: RequestOptions<T>): Promise<ApiResult<T>> =>
    request<T>('GET', path, options),
};

/**
 * TEST SEAM. Drops the in-flight refresh promise so one suite's simulated
 * expiry cannot leak into the next. Not for application code.
 */
export function __resetRefreshStateForTests(): void {
  refreshInFlight = null;
}
