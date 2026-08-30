/**
 * Notification routes. Mount at `/api/notifications`:
 *
 *     apiRouter.use('/notifications', notificationsRouter);
 *
 * `requireAuth` GUARDS THE WHOLE ROUTER and no ROLE guard follows it. Every
 * endpoint here answers about the CALLER's own rows — the recipient id comes off
 * the verified token — so there is no org or project role to check, and adding
 * one would only be able to make the bell wrong.
 *
 * The LIVENESS recheck that the role guards do as a side effect is still owed,
 * and is paid one layer down: each controller resolves its caller through
 * `liveRecipient`, so a deactivated or force-revoked account gets a 401 here
 * exactly as it does from `/auth/me`. See the header of
 * `controllers/notifications.controller.ts` for why that lives in the controller
 * rather than in a fourth database-reading middleware.
 *
 * ROUTE ORDER. `/unread-count`, `/read` and `/read-all` are literal segments
 * and `/:notificationId/read` is two segments deep, so no declaration can
 * shadow another. They are still declared specific-first, to match the house
 * convention in `routes/index.ts`.
 */
import { Router } from 'express';

import {
  getUnreadCount,
  listMyNotifications,
  readAllNotifications,
  readNotification,
  readNotifications,
} from '../controllers/notifications.controller';
import { requireAuth } from '../middlewares/require-auth';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import {
  markNotificationsReadInputSchema,
  notificationListQuerySchema,
  notificationParamsSchema,
} from '../validation/notifications.validation';

export const notificationsRouter: Router = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get('/unread-count', asyncHandler(getUnreadCount));

notificationsRouter.get(
  '/',
  validate(notificationListQuerySchema, 'query'),
  asyncHandler(listMyNotifications),
);

notificationsRouter.post('/read-all', asyncHandler(readAllNotifications));

notificationsRouter.post(
  '/read',
  validate(markNotificationsReadInputSchema),
  asyncHandler(readNotifications),
);

notificationsRouter.post(
  '/:notificationId/read',
  validate(notificationParamsSchema, 'params'),
  asyncHandler(readNotification),
);
