/**
 * Diagnostics log feed. Mounted at `/api/admin` → `GET /api/admin/logs`.
 *
 * Guarded by `requireAuth` + `requireGlobalAdmin`: server logs contain user
 * ids, paths and error messages, so this is admin-only surface, not "logged-in"
 * surface.
 */
import { Router } from 'express';
import { getServerLogs } from '../controllers/admin-logs.controller';
import { requireAuth, requireGlobalAdmin } from '../middlewares/require-auth';
import { validate } from '../middlewares/validate';
import { serverLogsQuerySchema } from '../validation/admin-logs.validation';

export const adminLogsRouter: Router = Router();

adminLogsRouter.get(
  '/logs',
  requireAuth,
  requireGlobalAdmin,
  validate(serverLogsQuerySchema, 'query'),
  getServerLogs,
);
