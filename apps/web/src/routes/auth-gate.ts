import { ApiError } from '@/lib/api';

/**
 * The guard's DECISION, extracted from the guard.
 *
 * `routes/guards.tsx` is JSX and the web package's test environment is
 * deliberately DOM-free (`vitest.config.ts` runs `environment: 'node'`, and no
 * jsdom is installed). Rendering a router under a query provider to assert
 * "does an expired session redirect?" would mean adding a DOM to the whole
 * suite in order to test four `if`s. Those four `if`s live here instead, as a
 * pure function over three inputs, and `auth-gate.test.ts` covers the matrix.
 *
 * The guard component then contains nothing a test would want to assert: it
 * reads state, calls this, and renders one of four things.
 */

/** What `RequireAuth` should do with the current session. */
export type AuthGate =
  /** No token at all — send to `/login`, remembering where they were headed. */
  | 'signed-out'
  /** Token present, `/auth/me` still in flight — hold the route with a splash. */
  | 'checking'
  /** The server refused the token. Clear the session, then send to `/login`. */
  | 'rejected'
  /** Render the protected subtree. */
  | 'allowed';

/** The three things the gate needs to know, all readable without a DOM. */
export interface AuthGateInput {
  /** Is there a persisted access token? */
  hasToken: boolean;
  /** Has `GET /auth/me` produced a user yet? */
  hasUser: boolean;
  /** The `/auth/me` failure, if it failed. */
  error: unknown;
}

/**
 * Decides what the app shell's guard does.
 *
 * THE ONE JUDGEMENT CALL worth reading: a NON-AUTH failure of `/auth/me` — a
 * 500, a dropped connection, a proxy timeout — resolves to `allowed`, not
 * `rejected`. Signing someone out because their wifi blinked is hostile and
 * loses their place; the pages behind the guard all have their own error
 * states, and every request they make carries the same token, so a genuinely
 * dead session surfaces immediately anyway. Only a verdict FROM THE SERVER
 * ABOUT THE TOKEN (401/403) is treated as terminal.
 *
 * `checking` is only reachable while a token exists and no user has arrived
 * yet. Once a user has been fetched, a later background refetch never returns
 * the app to a splash — that would blank the screen on a window focus.
 */
export function resolveAuthGate({ hasToken, hasUser, error }: AuthGateInput): AuthGate {
  if (!hasToken) return 'signed-out';
  if (isSessionRejection(error)) return 'rejected';
  if (hasUser) return 'allowed';
  if (error !== null && error !== undefined) return 'allowed';
  return 'checking';
}

/**
 * Is this error the server saying "this token is no good"?
 *
 * 401 is the obvious one. 403 is included because a deactivated account can
 * surface either way depending on which middleware catches it first, and both
 * mean the same thing to a session: it is over.
 */
export function isSessionRejection(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.status === 401 || error.status === 403;
}

/**
 * The path to return to after signing in.
 *
 * Built here rather than inline so the login page and the guard agree on the
 * shape (`/o/acme/p/FB/board?filter=mine`), and so `/login` itself can never be
 * stored as a return target — which would bounce a freshly signed-in user
 * straight back to the form.
 */
export function returnToPath(pathname: string, search: string): string | null {
  if (pathname === '/login') return null;
  return `${pathname}${search}`;
}
