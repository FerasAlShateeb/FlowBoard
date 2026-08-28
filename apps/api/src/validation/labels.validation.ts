/** Request validation for `/api/projects/:projectId/labels`. */
import { z } from 'zod';
import { createLabelInputSchema, updateLabelInputSchema, uuid } from '@flowboard/shared';

/** `/api/projects/:projectId/labels`. */
export const labelListParamsSchema = z.object({ projectId: uuid });
export type LabelListParams = z.infer<typeof labelListParamsSchema>;

/** `/api/projects/:projectId/labels/:labelId`. */
export const labelParamsSchema = z.object({ projectId: uuid, labelId: uuid });
export type LabelParams = z.infer<typeof labelParamsSchema>;

export { createLabelInputSchema, updateLabelInputSchema };
export type CreateLabelBody = z.infer<typeof createLabelInputSchema>;
export type UpdateLabelBody = z.infer<typeof updateLabelInputSchema>;
