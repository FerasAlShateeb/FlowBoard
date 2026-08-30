/**
 * W1.1's integration-test app: the four routers Round 2's instance
 * administration is made of, mounted at the paths `routes/index.ts` mounts them
 * at.
 *
 * Deliberately NOT `createApp()`. These suites must fail when instance
 * administration breaks, not when a sibling work package's router is mid-edit —
 * W1.2 is writing `admin-analytics.routes.ts` in the same wave. The pieces that
 * shape a RESPONSE are all here (JSON body parsing, the 404 fallthrough, the one
 * error-envelope formatter); the rate limiter, CORS and the request logger are
 * not, because none of them changes a body.
 *
 * The FOUR mounts travel together because the features do: an instance-settings
 * test needs organizations to point the default at, an orgs test needs the
 * settings row to exist, and the admin users/projects tables are the surfaces
 * that read across both. Splitting them into four apps would mean four copies of
 * the same arrangement.
 *
 * Lives in `__tests__/` rather than beside the suites because `tsconfig.json`
 * excludes that folder from the build: this module is imported by files that
 * import `supertest`, a devDependency that must never reach `dist/`.
 */
import express, { type Express } from 'express';

import { errorHandler, notFound } from '../../middlewares/error-handler';
import { adminProjectsRouter } from '../admin-projects.routes';
import { adminUsersRouter } from '../admin-users.routes';
import { adminSettingsRouter, instanceConfigRouter } from '../instance-settings.routes';
import { orgsRouter } from '../orgs.routes';

export function buildInstanceAdminApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  // Narrow `/admin` prefixes first, exactly as the real registry orders them.
  app.use('/api/admin/projects', adminProjectsRouter);
  app.use('/api/admin/settings', adminSettingsRouter);
  app.use('/api/admin/users', adminUsersRouter);
  app.use('/api/instance', instanceConfigRouter);
  app.use('/api/orgs', orgsRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
