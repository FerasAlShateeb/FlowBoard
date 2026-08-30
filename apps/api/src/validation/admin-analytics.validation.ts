/**
 * The query shape behind `GET /api/admin/analytics/*`.
 *
 * ONE SCHEMA FOR ALL FIVE DOMAINS, and it is a RE-EXPORT of
 * `@flowboard/shared`'s `analyticsWindowQuerySchema` rather than a local copy.
 * The web builds these query strings and parses the responses, so a server-only
 * definition would be half a contract — and the whole point of a single window
 * schema is that `/engagement`, `/work`, `/traffic` and `/growth` can never
 * drift apart on what `?from`, `?to` and `?interval` mean.
 *
 * The module exists at all because routers in this API import their schemas from
 * `validation/`, never from the shared package directly: it is the one place a
 * server-side narrowing (an extra `?limit`, a sort whitelist) can be added later
 * without touching every route that already validates against it. Compare
 * `admin-telemetry.validation.ts`, which re-exports three shared schemas and
 * adds three genuinely server-local ones.
 *
 * NOTHING IS DEFAULTED HERE. `from`, `to` and `interval` stay optional and are
 * filled in by `resolveAnalyticsWindow` in the service (30 days, daily), so a
 * direct service call and an HTTP call cannot disagree about the default window
 * — the same rule the telemetry feed's `?sort` follows.
 */
export { analyticsWindowQuerySchema } from '@flowboard/shared';

export type { AnalyticsInterval, AnalyticsWindowQuery } from '@flowboard/shared';
