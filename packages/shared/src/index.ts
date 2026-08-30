/**
 * @flowboard/shared — the contract barrel.
 *
 * Every cross-boundary payload in FlowBoard (HTTP request/response bodies,
 * socket event payloads, web form inputs) is defined here as a zod schema and
 * consumed by BOTH `apps/api` and `apps/web`. One definition, parsed at both
 * ends: the API validates requests with it, the web parses responses with it,
 * and a contract change is a compile error on both sides in the same commit.
 *
 * Conventions every module here follows:
 *   - `thingSchema` + `export type Thing = z.infer<typeof thingSchema>`;
 *   - user-facing validation copy comes from `validation-messages.ts`, never
 *     inline, so the web can localize it;
 *   - dates cross the wire as ISO strings — `isoDateTime` for instants,
 *     `isoDate` for calendar days;
 *   - nothing in this package may touch DOM or Node globals (lint-enforced via
 *     `@flowboard/config`'s `sharedPackageConfig`), so it imports cleanly into
 *     the Vite bundle and the Node API process alike.
 *
 * ── ROUND 2 FREEZE ──────────────────────────────────────────────────────────
 * This barrel is a STITCH FILE. W1.0 added every export Round 2 needs
 * (`instance.schema`, `admin-analytics.schema`) up front, and W3.1 is the only
 * package allowed to edit it again. W1.1–W1.5 and W2.1–W2.4 add schemas to the
 * modules already listed below — `export *` carries them out with no change
 * here — and they do not add, move or rename a line in this file.
 */

// Primitives, query parsers and the validation copy every schema attaches.
export * from './common';
export * from './validation-messages';

// The response envelope every endpoint is wrapped in.
export * from './envelope';

// Deployment-level configuration (multi-org vs single-org). Upstream of almost
// everything the shell renders, hence its position here.
export * from './instance.schema';

// Identity & access.
export * from './users.schema';
export * from './auth.schema';
export * from './orgs.schema';
export * from './teams.schema';
// Downstream of users + orgs — see the module header for why it is not in
// `users.schema.ts`.
export * from './admin.schema';

// Projects, their workflow and their work.
export * from './projects.schema';
export * from './workflow.schema';
export * from './tasks.schema';
export * from './sprints.schema';
export * from './comments.schema';
export * from './attachments.schema';
export * from './activity.schema';
export * from './notifications.schema';
export * from './reports.schema';

// Platform: analytics, the log drawer, the theme document.
export * from './telemetry.schema';
// Downstream of telemetry (it reuses the event vocabulary and the endpoint row)
// and of projects — see its module header.
export * from './admin-analytics.schema';
export * from './diagnostics.schema';
export * from './theme.schema';

// Fractional-index ordering (board_rank / backlog_rank).
export * from './rank';

// Realtime (Socket.IO) protocol.
export * from './socket/events.schema';
