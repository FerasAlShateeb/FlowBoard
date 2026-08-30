/**
 * `/api/notifications` — the caller's own notification centre.
 *
 * EVERY HANDLER IS SELF-SCOPED. The recipient is `req.user.id`, taken from the
 * verified access token and never from the path, the query or the body. That is
 * why this router mounts `requireAuth` and nothing else: there is no
 * authorization decision left to make, because there is no way to ask about
 * somebody else's rows.
 *
 * ═══ SELF-SCOPED IS NOT THE SAME AS UNCHECKED (R2 W3.5) ════════════════════
 *
 * `requireAuth` verifies a SIGNATURE and stops there — the `token_version` and
 * `is_active` re-read is deliberately lazy, because a SELECT in front of every
 * request would be paid by every request (see the note in `require-auth.ts`).
 * The project and org guards pay for that lookup anyway, so they do the recheck;
 * `/auth/me`, `/auth/refresh` and `change-password` do it through
 * {@link loadLiveUser} for the same reason.
 *
 * This router had NEITHER. It mounts `requireAuth` alone, so a deactivated or
 * force-revoked account kept a fully working notification centre — list, badge
 * and mark-read — for the remaining life of its access token, which is the one
 * surface a revoked session polls on a timer and therefore the one most likely
 * to still be open. Notification payloads carry task titles and the names of the
 * people who mentioned you.
 *
 * So every handler resolves its caller through {@link liveRecipient}. It is one
 * indexed primary-key read on a router whose own queries already touch the
 * database, and it makes the answer here match `/auth/me`'s: a revoked token is
 * 401, not 200 with somebody's mentions in it.
 */
import type { Request, Response } from 'express';
import type { MarkAllReadResponse, UnreadCount } from '@flowboard/shared';

import { requireUser } from '../middlewares/require-auth';
import type { AuthenticatedUser } from '../types/auth';
import { getParsed } from '../middlewares/validate';
import {
  countUnread,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationsRead,
} from '../services/notifications.service';
import { loadLiveUser } from '../services/auth/user-lookup';
import { record } from '../services/telemetry.service';
import { respond } from '../utils/respond';
import type {
  MarkNotificationsReadInput,
  NotificationListQuery,
  NotificationParams,
} from '../validation/notifications.validation';

/**
 * The caller, proven still live — 401 if the account was deactivated or its
 * sessions revoked since the token was minted.
 *
 * A CONTROLLER helper calling a service, not a new middleware: a middleware that
 * reads the database would be a fourth exception to `routes → controllers →
 * services → db`, and the architecture doc's list of three is closed.
 * `loadLiveUser` throws the same `401 Session has been revoked` that `/auth/me`
 * answers with, so a client that already handles one handles the other.
 */
async function liveRecipient(req: Request): Promise<AuthenticatedUser> {
  const user = requireUser(req);
  await loadLiveUser(user.id, user.tokenVersion);
  return user;
}

/** `GET /notifications?unread=&type=&page=&pageSize=` — newest first. */
export async function listMyNotifications(req: Request, res: Response): Promise<void> {
  const user = await liveRecipient(req);
  const query = getParsed<NotificationListQuery>(res, 'query');
  const page = await listNotifications(user.id, query);
  respond(res, page.items, page.meta);
}

/** `GET /notifications/unread-count` — the bell badge, polled and pushed. */
export async function getUnreadCount(req: Request, res: Response): Promise<void> {
  const user = await liveRecipient(req);
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
  const user = await liveRecipient(req);
  const { notificationId } = getParsed<NotificationParams>(res, 'params');
  const notification = await markNotificationRead(user.id, notificationId);

  record('notification_opened', { notificationId, type: notification.type }, { userId: user.id });

  respond(res, notification);
}

/** `POST /notifications/read` — mark a named set read. Answers the new total. */
export async function readNotifications(req: Request, res: Response): Promise<void> {
  const user = await liveRecipient(req);
  const { ids } = getParsed<MarkNotificationsReadInput>(res, 'body');
  const count = await markNotificationsRead(user.id, ids);
  const body: UnreadCount = { count };
  respond(res, body);
}

/** `POST /notifications/read-all` — answers how many rows it stamped. */
export async function readAllNotifications(req: Request, res: Response): Promise<void> {
  const user = await liveRecipient(req);
  const marked = await markAllNotificationsRead(user.id);
  // Annotated rather than an inline literal, like its two siblings: the shape
  // is a contract the web parses with `markAllReadResponseSchema`, so a rename
  // here has to be a compile error rather than a runtime parse failure in a
  // browser. Note it answers how many rows were STAMPED — not the new unread
  // total, which is zero by construction. See the schema's own note.
  const body: MarkAllReadResponse = { marked };
  respond(res, body);
}
