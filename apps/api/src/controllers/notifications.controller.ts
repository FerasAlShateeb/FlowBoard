/**
 * `/api/notifications` — the caller's own notification centre.
 *
 * EVERY HANDLER IS SELF-SCOPED. The recipient is `req.user.id`, taken from the
 * verified access token and never from the path, the query or the body. That is
 * why this router mounts `requireAuth` and nothing else: there is no
 * authorization decision left to make, because there is no way to ask about
 * somebody else's rows.
 */
import type { Request, Response } from 'express';
import type { MarkAllReadResponse, UnreadCount } from '@flowboard/shared';

import { requireUser } from '../middlewares/require-auth';
import { getParsed } from '../middlewares/validate';
import {
  countUnread,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationsRead,
} from '../services/notifications.service';
import { record } from '../services/telemetry.service';
import { respond } from '../utils/respond';
import type {
  MarkNotificationsReadInput,
  NotificationListQuery,
  NotificationParams,
} from '../validation/notifications.validation';

/** `GET /notifications?unread=&type=&page=&pageSize=` — newest first. */
export async function listMyNotifications(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = getParsed<NotificationListQuery>(res, 'query');
  const page = await listNotifications(user.id, query);
  respond(res, page.items, page.meta);
}

/** `GET /notifications/unread-count` — the bell badge, polled and pushed. */
export async function getUnreadCount(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const count = await countUnread(user.id);
  const body: UnreadCount = { count };
  respond(res, body);
}

/**
 * `POST /notifications/:notificationId/read` — the row click.
 *
 * The telemetry event lives HERE rather than in the service because it records
 * a user ACTION ("opened a notification"), and the service's other callers —
 * a future bulk sweep, an admin tool — are not that action.
 */
export async function readNotification(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { notificationId } = getParsed<NotificationParams>(res, 'params');
  const notification = await markNotificationRead(user.id, notificationId);

  record('notification_opened', { notificationId, type: notification.type }, { userId: user.id });

  respond(res, notification);
}

/** `POST /notifications/read` — mark a named set read. Answers the new total. */
export async function readNotifications(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { ids } = getParsed<MarkNotificationsReadInput>(res, 'body');
  const count = await markNotificationsRead(user.id, ids);
  const body: UnreadCount = { count };
  respond(res, body);
}

/** `POST /notifications/read-all` — answers how many rows it stamped. */
export async function readAllNotifications(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const marked = await markAllNotificationsRead(user.id);
  // Annotated rather than an inline literal, like its two siblings: the shape
  // is a contract the web parses with `markAllReadResponseSchema`, so a rename
  // here has to be a compile error rather than a runtime parse failure in a
  // browser. Note it answers how many rows were STAMPED — not the new unread
  // total, which is zero by construction. See the schema's own note.
  const body: MarkAllReadResponse = { marked };
  respond(res, body);
}
