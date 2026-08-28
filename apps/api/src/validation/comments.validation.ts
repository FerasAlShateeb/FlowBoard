/**
 * Request schemas for the comment routes. Bodies come from `@flowboard/shared`;
 * the route-parameter shapes are local.
 */
import { z } from 'zod';
import {
  createCommentInputSchema,
  paginationQuerySchema,
  updateCommentInputSchema,
  uuid,
} from '@flowboard/shared';

export const taskCommentsParamsSchema = z.object({ taskId: uuid });
export type TaskCommentsParams = z.infer<typeof taskCommentsParamsSchema>;

export const commentParamsSchema = z.object({ commentId: uuid });
export type CommentParams = z.infer<typeof commentParamsSchema>;

/** A thread is read oldest-first and paginated like every other collection. */
export const commentListQuerySchema = paginationQuerySchema;
export type CommentListQuery = z.infer<typeof commentListQuerySchema>;

export { createCommentInputSchema, updateCommentInputSchema };
