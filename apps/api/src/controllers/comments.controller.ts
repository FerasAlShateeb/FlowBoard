/**
 * Comment controllers. The author-or-admin rule is a service concern (it needs
 * the row), so the controller only forwards the caller's effective project role
 * — which the guard already resolved onto `res.locals`.
 */
import type { Request, Response } from 'express';
import type { CreateCommentInput, PaginationMeta, UpdateCommentInput } from '@flowboard/shared';

import { getParsed } from '../middlewares/validate';
import { getProjectAccess } from '../middlewares/require-roles';
import { respond, respondNoContent } from '../utils/respond';
import {
  createComment,
  deleteComment,
  listComments,
  updateComment,
} from '../services/comments.service';
import { actorOf, scopeOf } from './tasks.controller';
import type {
  CommentListQuery,
  CommentParams,
  TaskCommentsParams,
} from '../validation/comments.validation';

function pageMeta(page: number, pageSize: number, total: number): PaginationMeta {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

/** `GET /api/tasks/:taskId/comments` — oldest first. */
export async function listTaskComments(_req: Request, res: Response): Promise<void> {
  const { taskId } = getParsed<TaskCommentsParams>(res, 'params');
  const { page, pageSize } = getParsed<CommentListQuery>(res, 'query');
  const result = await listComments(taskId, page, pageSize);
  respond(res, result.items, pageMeta(page, pageSize, result.total));
}

/** `POST /api/tasks/:taskId/comments`. */
export async function createTaskComment(req: Request, res: Response): Promise<void> {
  const { taskId } = getParsed<TaskCommentsParams>(res, 'params');
  const input = getParsed<CreateCommentInput>(res);
  const comment = await createComment(scopeOf(res), actorOf(req, res), taskId, input.body);
  respond(res, comment, undefined, 201);
}

/** `PATCH /api/comments/:commentId` — author or project admin. */
export async function patchComment(req: Request, res: Response): Promise<void> {
  const { commentId } = getParsed<CommentParams>(res, 'params');
  const input = getParsed<UpdateCommentInput>(res);
  const comment = await updateComment(
    scopeOf(res),
    actorOf(req, res),
    getProjectAccess(res).role,
    commentId,
    input.body,
  );
  respond(res, comment);
}

/** `DELETE /api/comments/:commentId` — author or project admin. */
export async function removeComment(req: Request, res: Response): Promise<void> {
  const { commentId } = getParsed<CommentParams>(res, 'params');
  await deleteComment(scopeOf(res), actorOf(req, res), getProjectAccess(res).role, commentId);
  respondNoContent(res);
}
