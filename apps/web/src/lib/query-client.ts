import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';

/**
 * The single QueryClient. Created at module scope (not inside a component) so
 * the cache survives a hot reload and so non-React code — the socket layer's
 * targeted `setQueryData` splices, WP4.1 — can reach it.
 *
 * The defaults below are the ones the whole app inherits; a hook that genuinely
 * needs different behaviour overrides them locally rather than moving them here.
 */

/**
 * 30 seconds. Long enough that navigating board → backlog → board does not
 * refetch, short enough that stale data is measured in seconds. FlowBoard does
 * not lean on polling for freshness: Socket.IO pushes the invalidations, so
 * `staleTime` only has to cover the gap while a socket is connecting.
 */
export const DEFAULT_STALE_TIME_MS = 30_000;

/**
 * One retry — and NOT for 4xx.
 *
 * Retrying a 400/403/404 cannot succeed and only delays the error state by a
 * second, which on a form submit reads as a hang. 401 is excluded too: the
 * refresh cycle in `lib/api.ts` already retried the request once, so a 401 that
 * reaches here is terminal. Network failures and 5xx are the cases a retry
 * actually rescues.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return true;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: DEFAULT_STALE_TIME_MS,
      retry: shouldRetry,
      // Coming back to the tab after lunch should show current data. Cheap,
      // because a fresh query inside `staleTime` is a no-op.
      refetchOnWindowFocus: true,
      // A reconnect is exactly when the socket may have missed events.
      refetchOnReconnect: true,
    },
    mutations: {
      // Mutations are never retried automatically: they are not idempotent
      // (creating a task twice is a real bug), and every failure path in this
      // app already ends in a toast the user can act on.
      retry: false,
    },
  },
});
