/**
 * Request validation for the per-project workflow editor —
 * `/api/projects/:projectId/{statuses,transitions}`.
 */
import { z } from 'zod';
import {
  createStatusInputSchema,
  deleteStatusInputSchema,
  reorderStatusesInputSchema,
  replaceTransitionsInputSchema,
  updateStatusInputSchema,
  uuid,
} from '@flowboard/shared';

/** `/api/projects/:projectId/statuses` and `…/transitions`. */
export const workflowParamsSchema = z.object({ projectId: uuid });
export type WorkflowParams = z.infer<typeof workflowParamsSchema>;

/** `/api/projects/:projectId/statuses/:statusId`. */
export const statusParamsSchema = z.object({ projectId: uuid, statusId: uuid });
export type StatusParams = z.infer<typeof statusParamsSchema>;

/**
 * `DELETE /api/projects/:projectId/statuses/:statusId` body.
 *
 * The shape is the shared `deleteStatusInputSchema`; what is added here is the
 * `.nullish()` tolerance, and that is not decoration — Express 5 leaves
 * `req.body` `undefined` when a DELETE arrives with no `Content-Type`, and a
 * bare object schema would reject that as "expected object". The empty body is
 * a legitimate request ("delete this column, it holds nothing"), so it must
 * parse to `{}` rather than 422.
 */
export const deleteStatusBodySchema = deleteStatusInputSchema
  .nullish()
  .transform((value) => value ?? {});
export type DeleteStatusBody = z.infer<typeof deleteStatusBodySchema>;

export {
  createStatusInputSchema,
  deleteStatusInputSchema,
  reorderStatusesInputSchema,
  replaceTransitionsInputSchema,
  updateStatusInputSchema,
};
export type CreateStatusBody = z.infer<typeof createStatusInputSchema>;
export type UpdateStatusBody = z.infer<typeof updateStatusInputSchema>;
export type ReorderStatusesBody = z.infer<typeof reorderStatusesInputSchema>;
export type ReplaceTransitionsBody = z.infer<typeof replaceTransitionsInputSchema>;
