/**
 * Request validation for `/api/notifications`.
 *
 * The query and the bulk-read body come STRAIGHT from `@flowboard/shared` —
 * they are the contract the web client builds its requests from, and
 * re-declaring them here is how the two ends drift. Only the route params are
 * local, because a URL segment is a server-side concern the browser never
 * validates.
 */
import { z } from 'zod';
import {
  markNotificationsReadInputSchema,
  notificationListQuerySchema,
  uuid,
} from '@flowboard/shared';

/** `/api/notifications/:notificationId/read`. */
export const notificationParamsSchema = z.object({ notificationId: uuid });
export type NotificationParams = z.infer<typeof notificationParamsSchema>;

export { markNotificationsReadInputSchema, notificationListQuerySchema };
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadInputSchema>;
