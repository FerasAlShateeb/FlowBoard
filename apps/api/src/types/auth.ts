/**
 * The identity the auth middlewares attach to a request / socket.
 *
 * Deliberately minimal: it is everything that can be proven from a signed
 * access token WITHOUT a database round-trip. Anything richer (email, display
 * name, org/project memberships) belongs to a service call, not to `req.user` —
 * see `middlewares/require-auth.ts`.
 */
export interface AuthenticatedUser {
  /** `users.id` (uuid) — the token's `sub`. */
  id: string;
  /** Mirrors `users.is_global_admin` at the moment the token was minted. */
  isGlobalAdmin: boolean;
  /**
   * Mirrors `users.token_version`. A password change / force-revoke bumps the
   * column, which invalidates every token minted before the bump. HTTP checks
   * it lazily (Wave 2 role middlewares); the socket handshake checks it eagerly
   * because a socket outlives the request that opened it.
   */
  tokenVersion: number;
}
