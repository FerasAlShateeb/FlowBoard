/** Request validation for the project activity feed. */
import { z } from 'zod';
import { activityQuerySchema, uuid } from '@flowboard/shared';

/** `/api/projects/:projectId/activity`. */
export const activityParamsSchema = z.object({ projectId: uuid });
export type ActivityParams = z.infer<typeof activityParamsSchema>;

export { activityQuerySchema };
export type ActivityFeedQuery = z.infer<typeof activityQuerySchema>;
