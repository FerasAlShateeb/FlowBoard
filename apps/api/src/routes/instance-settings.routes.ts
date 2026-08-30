/**
 * The instance singleton — TWO routers, because the two halves have opposite
 * audiences and opposite guards. (The same split, for the same reason, as
 * `admin-telemetry.routes.ts`.)
 *
 *   `instanceConfigRouter`  →  mount at `/api/instance`
 *       GET   /config          any authenticated user
 *
 *   `adminSettingsRouter`   →  mount at `/api/admin/settings`
 *       GET   /                global admin
 *       PATCH /                global admin
 *
 * WHY NOT ONE ROUTER. `GET /instance/config` is read by EVERY signed-in
 * session, on boot, before the shell can decide whether to render an org
 * switcher at all — putting it behind the global-admin guard would break the
 * app for everyone who is not an admin. `/admin/settings` is the editable row
 * behind it, including the `defaultOrgId` that decides where a single-org
 * install sends `/`. Stacking them in one router would mean per-route guards on
 * both, which is exactly the arrangement where someone eventually forgets one.
 *
 * They live in ONE FILE because they are one contract: the config payload is a
 * projection of the settings row (`instanceConfigSchema` is the base
 * `instanceSettingsSchema` extends, in `@flowboard/shared`), and the service
 * that resolves `defaultOrgId` → `defaultOrgSlug` serves both. Splitting them
 * would put the two ends of that projection in two places.
 *
 * ── ROUND 2 SEAM (W1.0 → W1.1) ──────────────────────────────────────────────
 * W1.0 created this file with `notImplemented` bodies and owns the mounts, the
 * guards and the paths. **W1.1 filled in the handlers** — the
 * `instance_settings` table, migration `0001`, the seed row and the service
 * behind them — without moving a mount or a guard, which is why
 * `__tests__/router-mounting.test.ts` did not have to change across the
 * 501 → 200 transition.
 */
import { Router } from 'express';

import * as instanceSettingsController from '../controllers/instance-settings.controller';
import { requireAuth, requireGlobalAdmin } from '../middlewares/require-auth';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import { updateInstanceSettingsInputSchema } from '../validation/instance-settings.validation';

// ── Read: the shell's copy of the instance identity ──────────────────────────

export const instanceConfigRouter: Router = Router();

instanceConfigRouter.use(requireAuth);

instanceConfigRouter.get('/config', asyncHandler(instanceSettingsController.getConfig));

// ── Read + write: the admin-editable row ─────────────────────────────────────

export const adminSettingsRouter: Router = Router();

adminSettingsRouter.use(requireAuth, requireGlobalAdmin);

adminSettingsRouter.get('/', asyncHandler(instanceSettingsController.getSettings));
adminSettingsRouter.patch(
  '/',
  validate(updateInstanceSettingsInputSchema, 'body'),
  asyncHandler(instanceSettingsController.updateSettings),
);
