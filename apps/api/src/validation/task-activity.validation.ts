/**
 * Request validation for the PER-TASK activity feed
 * (`GET /api/tasks/:taskId/activity`).
 *
 * A separate file from `activity.validation.ts` even though the QUERY half is
 * identical: the two endpoints differ in the only part that matters to a guard —
 * which route param carries the project. `:projectId` resolves directly;
 * `:taskId` resolves through `tasks → projects`, and that is also what makes a
 * soft-deleted task a 404 rather than an empty feed.
 *
 * The query schema is re-exported rather than redefined. `activityQuerySchema`
 * is documented in `@flowboard/shared` as the contract for BOTH feeds, so a
 * local copy would be a second place for `pageSize`'s ceiling to drift.
 */
import { z } from 'zod';
import { activityQuerySchema, uuid } from '@flowboard/shared';

/** `/api/tasks/:taskId/activity`. */
export const taskActivityParamsSchema = z.object({ taskId: uuid });
export type TaskActivityParams = z.infer<typeof taskActivityParamsSchema>;

export { activityQuerySchema as taskActivityQuerySchema };
export type TaskActivityQuery = z.infer<typeof activityQuerySchema>;
