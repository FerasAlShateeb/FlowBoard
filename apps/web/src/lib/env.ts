/**
 * Build-time configuration reachable from the browser bundle.
 *
 * Vite only exposes `VITE_`-prefixed variables, and they are INLINED at build
 * time — there is no runtime `process.env` here (ESLint's
 * `no-restricted-globals` enforces that in `src/**`). Anything an operator must
 * change without a rebuild belongs to the API, not to this file.
 */

/**
 * Base URL of the API server, normalised without a trailing slash.
 *
 * The empty string — the default — means SAME ORIGIN, which is the intended
 * deployment: the Vite dev proxy and nginx both forward `/api` and
 * `/socket.io` to the API, so the browser only ever talks to one origin and
 * cookies, CORS and the websocket upgrade all behave like production.
 *
 * Set `VITE_API_URL` only when the SPA is hosted away from the API; the
 * server's CORS allowlist (`WEB_ORIGIN`) must then include the SPA's origin.
 */
export function apiBaseUrl(): string {
  const raw = (import.meta.env.VITE_API_URL as string | undefined)?.trim() ?? '';
  return raw.replace(/\/+$/, '');
}

/** True in `vite dev` / `vitest`; false in a production bundle. */
export function isDev(): boolean {
  return import.meta.env.DEV;
}
