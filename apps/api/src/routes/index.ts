/**
 * The API router registry. Mounted once, at `/api`, in `app.ts`.
 *
 * MOUNT ORDER IS NORMATIVE, and there is exactly one rule behind it:
 *
 *   **specific prefixes first, root-stacked routers last.**
 *
 * Express matches `use()` mounts in declaration order and FALLS THROUGH a
 * router that has no matching route, so two routers may legally share a prefix
 * (`/admin/users` and `/admin`, `/orgs/:orgId/invites` and `/orgs`). What is
 * NOT safe is letting a broad mount answer before a narrow one — a router that
 * terminates the request (a 404 handler, a catch-all) would swallow the narrow
 * route forever. None of the routers below terminate, but the ordering makes
 * that property something the file states rather than something a reader has to
 * re-derive from six other files.
 *
 * THE ROOT-STACKED SET (tasks, comments, attachments, sprints, search, reports,
 * task-activity)
 * carry their own FULL paths — `/projects/:projectId/tasks`, `/tasks/:taskId`,
 * `/orgs/:orgId/search` — because the task domain is addressed on two different
 * nestings at once. Stacking them all at `/` costs one fall-through per
 * unmatched router and keeps this registry a one-line change per work package.
 *
 * THREE CROSS-MOUNT OVERLAPS ARE DELIBERATE AND TESTED
 * (`__tests__/router-mounting.test.ts` proves every one of them is reachable):
 *
 *   - `GET /orgs/:orgId/search` lives in `searchRouter` at the root, but
 *     `orgsRouter` owns `/orgs`. `orgsRouter` has no `/:orgId/search` route, so
 *     the request falls through to the search router.
 *   - `/projects/:projectId/{tasks,sprints,reports}` live at the root, but
 *     `projectsRouter` owns `/projects` and mounts `workflowRouter` on the bare
 *     `/:projectId`. That sub-router only claims `/statuses` and
 *     `/transitions`, so everything else falls through.
 *   - `/admin` carries THREE routers: `/admin/users`, `/admin/telemetry` and
 *     the bare `/admin` (logs). The two narrow mounts MUST precede the bare
 *     one — not because `adminLogsRouter` would shadow them today (it declares
 *     only `/logs`), but because the bare mount is the one a future catch-all
 *     would be added to, and by then the ordering would be load-bearing and
 *     unexplained.
 *
 * The cost of a fall-through is one extra `requireAuth` (a JWT verify, no I/O)
 * on those paths, which is cheaper than duplicating the mount tree.
 */
import { Router } from 'express';

import { adminLogsRouter } from './admin-logs.routes';
import { adminTelemetryRouter, telemetryIngestRouter } from './admin-telemetry.routes';
import { adminUsersRouter } from './admin-users.routes';
import { attachmentsRouter } from './attachments.routes';
import { authRouter } from './auth.routes';
import { commentsRouter } from './comments.routes';
import { healthRouter } from './health.routes';
import { invitesRouter } from './invites.routes';
import { notificationsRouter } from './notifications.routes';
import { orgsRouter } from './orgs.routes';
import { projectsRouter } from './projects.routes';
import { reportsRouter } from './reports.routes';
import { searchRouter } from './search.routes';
import { sprintsRouter } from './sprints.routes';
import { taskActivityRouter } from './task-activity.routes';
import { tasksRouter } from './tasks.routes';

export const apiRouter: Router = Router();

// ── Foundation ──────────────────────────────────────────────────────────────
apiRouter.use('/', healthRouter);

// ── Identity & access (WP2.1) ───────────────────────────────────────────────
apiRouter.use('/auth', authRouter);
apiRouter.use('/orgs/:orgId/invites', invitesRouter);
apiRouter.use('/notifications', notificationsRouter);
apiRouter.use('/admin/users', adminUsersRouter);
apiRouter.use('/admin/telemetry', adminTelemetryRouter);
apiRouter.use('/admin', adminLogsRouter);

// ── Telemetry ingest (WP4.3) ────────────────────────────────────────────────
// The WRITE half of the telemetry contract, and the reason it is not under
// `/admin`: any authenticated user reports their own page views. Its read half
// (`adminTelemetryRouter`, above) is global-admin only. See the two-router note
// in `admin-telemetry.routes.ts`.
apiRouter.use('/telemetry', telemetryIngestRouter);

// ── Org structure (WP2.2) ───────────────────────────────────────────────────
// `orgsRouter` also composes teams + the org-scoped project list;
// `projectsRouter` composes members, labels, activity and the workflow editor.
apiRouter.use('/orgs', orgsRouter);
apiRouter.use('/projects', projectsRouter);

// ── Task domain (WP2.3), root-stacked — see the header note ─────────────────
apiRouter.use('/', tasksRouter);
apiRouter.use('/', commentsRouter);
apiRouter.use('/', attachmentsRouter);
apiRouter.use('/', sprintsRouter);
apiRouter.use('/', searchRouter);
apiRouter.use('/', reportsRouter);
apiRouter.use('/', taskActivityRouter);

export {
  adminLogsRouter,
  adminTelemetryRouter,
  adminUsersRouter,
  attachmentsRouter,
  authRouter,
  commentsRouter,
  healthRouter,
  invitesRouter,
  notificationsRouter,
  orgsRouter,
  projectsRouter,
  reportsRouter,
  searchRouter,
  sprintsRouter,
  taskActivityRouter,
  tasksRouter,
  telemetryIngestRouter,
};
