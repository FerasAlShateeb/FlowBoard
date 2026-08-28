/**
 * Task controllers — envelope in, envelope out, and nothing else.
 *
 * Each one does exactly three things: read the values `validate()` already
 * parsed, hand them to a service, and answer through `respond()`. No query
 * building, no rule checks, no database import — that is the layering rule
 * (`routes → controllers → services → db`) and it is what makes the services
 * testable without HTTP.
 */
import type { Request, Response } from 'express';
import type { PaginationMeta } from '@flowboard/shared';

import { getParsed } from '../middlewares/validate';
import { requireUser } from '../middlewares/require-auth';
import { getProjectAccess } from '../middlewares/require-roles';
import { getSocketId } from '../middlewares/socket-id';
import { respond, respondNoContent } from '../utils/respond';
import {
  addDependency,
  createTask,
  deleteTask,
  getTask,
  getTaskByProjectKey,
  listBoard,
  listProjectDependencies,
  listTasks,
  moveTask,
  patchTask,
  rankTask,
  removeDependency,
  unwatchTask,
  watchTask,
  type ProjectScope,
  type TaskActor,
} from '../services/tasks.service';
import type {
  DependencyInputBody,
  DependencyParams,
  TaskByKeyParams,
  TaskListRequestQuery,
  TaskParams,
} from '../validation/tasks.validation';
import type {
  CreateTaskInput,
  MoveTaskInput,
  PatchTaskInput,
  RankTaskInput,
  WatchTaskInput,
} from '@flowboard/shared';

/**
 * Who is acting, and from which tab.
 *
 * `socketId` comes from the `X-Socket-Id` header and rides every domain event
 * this request publishes, so the originating tab is excluded from the
 * broadcast — its cache was already written by its optimistic update plus this
 * response, and an echo would be a third, later write.
 *
 * Shared by every controller in this work package.
 */
export function actorOf(req: Request, res: Response): TaskActor {
  return { userId: requireUser(req).id, socketId: getSocketId(res) };
}

/** The project this request was authorised against. Never re-derived. */
export function scopeOf(res: Response): ProjectScope {
  const access = getProjectAccess(res);
  return { projectId: access.projectId, orgId: access.orgId };
}

function pageMeta(page: number, pageSize: number, total: number): PaginationMeta {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

/**
 * `GET /api/projects/:projectId/tasks`.
 *
 * Two shapes behind one route because they answer the same question for two
 * different renderers: `view=board` returns every column keyed by status id and
 * ignores pagination (a board is not a page), `view=flat` returns a sorted page
 * with envelope `meta`.
 */
export async function listProjectTasks(_req: Request, res: Response): Promise<void> {
  const scope = scopeOf(res);
  const query = getParsed<TaskListRequestQuery>(res, 'query');
  const { view, page, pageSize, sort, ...filters } = query;

  if (view === 'board') {
    respond(res, await listBoard(scope, filters));
    return;
  }

  const result = await listTasks(scope, { filters, page, pageSize, sort });
  respond(res, result.items, pageMeta(page, pageSize, result.total));
}

/** `POST /api/projects/:projectId/tasks`. */
export async function createProjectTask(req: Request, res: Response): Promise<void> {
  const input = getParsed<CreateTaskInput>(res);
  const task = await createTask(scopeOf(res), actorOf(req, res), input);
  respond(res, task, undefined, 201);
}

/** `GET /api/tasks/:taskId`. */
export async function getTaskDetail(_req: Request, res: Response): Promise<void> {
  const { taskId } = getParsed<TaskParams>(res, 'params');
  respond(res, await getTask(taskId));
}

/** `GET /api/projects/:projectId/tasks/by-key/:taskKey` — same payload, human id. */
export async function getTaskByKey(_req: Request, res: Response): Promise<void> {
  const { projectId, taskKey } = getParsed<TaskByKeyParams>(res, 'params');
  respond(res, await getTaskByProjectKey(projectId, taskKey));
}

/** `PATCH /api/tasks/:taskId`. */
export async function patchTaskDetail(req: Request, res: Response): Promise<void> {
  const { taskId } = getParsed<TaskParams>(res, 'params');
  const input = getParsed<PatchTaskInput>(res);
  respond(res, await patchTask(scopeOf(res), actorOf(req, res), taskId, input));
}

/** `POST /api/tasks/:taskId/move` — the Kanban drop. */
export async function moveTaskCard(req: Request, res: Response): Promise<void> {
  const { taskId } = getParsed<TaskParams>(res, 'params');
  const input = getParsed<MoveTaskInput>(res);
  respond(res, await moveTask(scopeOf(res), actorOf(req, res), taskId, input));
}

/** `POST /api/tasks/:taskId/rank` — the backlog / sprint reorder. */
export async function rankTaskCard(req: Request, res: Response): Promise<void> {
  const { taskId } = getParsed<TaskParams>(res, 'params');
  const input = getParsed<RankTaskInput>(res);
  respond(res, await rankTask(scopeOf(res), actorOf(req, res), taskId, input));
}

/** `DELETE /api/tasks/:taskId` — soft, cascading to subtasks. */
export async function deleteTaskDetail(req: Request, res: Response): Promise<void> {
  const { taskId } = getParsed<TaskParams>(res, 'params');
  await deleteTask(scopeOf(res), actorOf(req, res), taskId);
  respondNoContent(res);
}

/** `PUT /api/tasks/:taskId/watchers/me` — idempotent self-subscribe. */
export async function putWatcher(req: Request, res: Response): Promise<void> {
  const { taskId } = getParsed<TaskParams>(res, 'params');
  const input = getParsed<WatchTaskInput>(res);
  respond(res, await watchTask(scopeOf(res), actorOf(req, res), taskId, input.isMuted));
}

/** `DELETE /api/tasks/:taskId/watchers/me`. */
export async function deleteWatcher(req: Request, res: Response): Promise<void> {
  const { taskId } = getParsed<TaskParams>(res, 'params');
  respond(res, await unwatchTask(scopeOf(res), actorOf(req, res), taskId));
}

/**
 * `GET /api/projects/:projectId/dependencies` — every `blocks` edge, at once.
 *
 * The Roadmap's arrow layer. Takes no query at all: the whole point of the route
 * is that one request replaces one-detail-fetch-per-visible-row, and a filter
 * would put the caller back to reasoning about which arrows it is missing.
 */
export async function listDependencies(_req: Request, res: Response): Promise<void> {
  respond(res, await listProjectDependencies(scopeOf(res)));
}

/** `POST /api/tasks/:taskId/dependencies` — either direction of `blocks`. */
export async function postDependency(req: Request, res: Response): Promise<void> {
  const { taskId } = getParsed<TaskParams>(res, 'params');
  const input = getParsed<DependencyInputBody>(res);
  const task = await addDependency(scopeOf(res), actorOf(req, res), taskId, input);
  respond(res, task, undefined, 201);
}

/** `DELETE /api/tasks/:taskId/dependencies/:otherTaskId`. */
export async function deleteDependency(req: Request, res: Response): Promise<void> {
  const { taskId, otherTaskId } = getParsed<DependencyParams>(res, 'params');
  await removeDependency(scopeOf(res), actorOf(req, res), taskId, otherTaskId);
  respondNoContent(res);
}
