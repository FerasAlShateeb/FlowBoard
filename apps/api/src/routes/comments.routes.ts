/**
 * Comment routes. Mount at the API root: `apiRouter.use('/', commentsRouter)`.
 *
 * The thread hangs off its task (`/tasks/:taskId/comments`); an individual
 * comment is addressed by id (`/comments/:commentId`) so an edit does not have
 * to know which task it belongs to. `requireProjectRole(…, 'commentId')`
 * resolves the project through comment → task → project.
 *
 * The floor for edit and delete is `member`, but the real rule — author, or a
 * project admin — needs the row and therefore lives in the service.
 */
import { Router } from 'express';

import {
  createTaskComment,
  listTaskComments,
  patchComment,
  removeComment,
} from '../controllers/comments.controller';
import { requireAuth } from '../middlewares/require-auth';
import { requireProjectRole } from '../middlewares/require-roles';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import {
  commentListQuerySchema,
  commentParamsSchema,
  createCommentInputSchema,
  taskCommentsParamsSchema,
  updateCommentInputSchema,
} from '../validation/comments.validation';

export const commentsRouter: Router = Router();

// Scoped to the prefixes this router owns — see `tasks.routes.ts` for why a
// root-stacked router must not guard paths it does not answer.
commentsRouter.use(['/tasks/:taskId/comments', '/comments'], requireAuth);

commentsRouter.get(
  '/tasks/:taskId/comments',
  validate(taskCommentsParamsSchema, 'params'),
  requireProjectRole('viewer', 'taskId'),
  validate(commentListQuerySchema, 'query'),
  asyncHandler(listTaskComments),
);

commentsRouter.post(
  '/tasks/:taskId/comments',
  validate(taskCommentsParamsSchema, 'params'),
  requireProjectRole('member', 'taskId'),
  validate(createCommentInputSchema),
  asyncHandler(createTaskComment),
);

commentsRouter.patch(
  '/comments/:commentId',
  validate(commentParamsSchema, 'params'),
  requireProjectRole('member', 'commentId'),
  validate(updateCommentInputSchema),
  asyncHandler(patchComment),
);

commentsRouter.delete(
  '/comments/:commentId',
  validate(commentParamsSchema, 'params'),
  requireProjectRole('member', 'commentId'),
  asyncHandler(removeComment),
);
