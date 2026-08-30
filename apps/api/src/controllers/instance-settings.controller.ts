/**
 * `/api/instance/config` and `/api/admin/settings` — thin HTTP adapters.
 *
 * The two audiences are separated by the ROUTER's guards, not by anything here
 * (see `routes/instance-settings.routes.ts`): `getConfig` is behind
 * `requireAuth`, the other two behind `requireGlobalAdmin`. A controller that
 * re-checked the role would be a second place to forget it.
 */
import type { Request, Response } from 'express';

import { getParsed } from '../middlewares/validate';
import * as instanceSettingsService from '../services/instance-settings.service';
import { respond } from '../utils/respond';
import type { UpdateInstanceSettingsInput } from '../validation/instance-settings.validation';

/** `GET /api/instance/config` — any signed-in user, read on every boot. */
export async function getConfig(_req: Request, res: Response): Promise<void> {
  respond(res, await instanceSettingsService.getInstanceConfig());
}

/** `GET /api/admin/settings` — global admin. */
export async function getSettings(_req: Request, res: Response): Promise<void> {
  respond(res, await instanceSettingsService.getInstanceSettings());
}

/** `PATCH /api/admin/settings` — global admin. */
export async function updateSettings(_req: Request, res: Response): Promise<void> {
  const input = getParsed<UpdateInstanceSettingsInput>(res, 'body');
  respond(res, await instanceSettingsService.updateInstanceSettings(input));
}
