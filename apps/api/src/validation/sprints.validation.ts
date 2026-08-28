/**
 * Request schemas for the sprint routes. Bodies come from `@flowboard/shared`,
 * which already refuses an inverted window (`endDate < startDate`) and requires
 * both dates at `/start` — a running sprint with no end date has no burndown
 * x-axis.
 */
import { z } from 'zod';
import {
  completeSprintInputSchema,
  createSprintInputSchema,
  sprintListQuerySchema,
  startSprintInputSchema,
  updateSprintInputSchema,
  uuid,
} from '@flowboard/shared';

export const sprintListParamsSchema = z.object({ projectId: uuid });
export type SprintListParams = z.infer<typeof sprintListParamsSchema>;

export const sprintParamsSchema = z.object({ sprintId: uuid });
export type SprintParams = z.infer<typeof sprintParamsSchema>;

export {
  completeSprintInputSchema,
  createSprintInputSchema,
  sprintListQuerySchema,
  startSprintInputSchema,
  updateSprintInputSchema,
};
