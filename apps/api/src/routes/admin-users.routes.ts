/**
 * Global-admin account administration. Mount at `/api/admin/users`.
 *
 *   GET    /                          global admin
 *   POST   /                          global admin
 *   PATCH  /:userId                   global admin
 *   POST   /:userId/reset-password    global admin
 *
 * Mounting at the full `/admin/users` prefix (rather than stacking a second
 * router on `/admin`) keeps this file's paths readable and leaves
 * `adminLogsRouter` and WP4.3's telemetry router free to own their own prefixes
 * without three routers racing for the same match.
 */
import { Router } from 'express';
import { resetPasswordInputSchema } from '@flowboard/shared';

import * as adminUsersController from '../controllers/admin-users.controller';
import { requireAuth, requireGlobalAdmin } from '../middlewares/require-auth';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import {
  adminUpdateUserInputSchema,
  adminUserListQuerySchema,
  adminUserParamsSchema,
  provisionUserInputSchema,
} from '../validation/admin-users.validation';

export const adminUsersRouter: Router = Router();

adminUsersRouter.use(requireAuth, requireGlobalAdmin);

adminUsersRouter.get(
  '/',
  validate(adminUserListQuerySchema, 'query'),
  asyncHandler(adminUsersController.listUsers),
);

adminUsersRouter.post(
  '/',
  validate(provisionUserInputSchema, 'body'),
  asyncHandler(adminUsersController.provisionUser),
);

adminUsersRouter.patch(
  '/:userId',
  validate(adminUserParamsSchema, 'params'),
  validate(adminUpdateUserInputSchema, 'body'),
  asyncHandler(adminUsersController.updateUser),
);

adminUsersRouter.post(
  '/:userId/reset-password',
  validate(adminUserParamsSchema, 'params'),
  validate(resetPasswordInputSchema, 'body'),
  asyncHandler(adminUsersController.resetPassword),
);
