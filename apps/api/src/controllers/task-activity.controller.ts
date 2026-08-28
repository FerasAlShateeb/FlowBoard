/** `/api/tasks/:taskId/activity` — one task's audit history. */
import type { Request, Response } from 'express';

import { getParsed } from '../middlewares/validate';
import { listTaskActivity } from '../services/task-activity.service';
import { respond } from '../utils/respond';
import type { TaskActivityParams, TaskActivityQuery } from '../validation/task-activity.validation';

/**
 * `GET /tasks/:taskId/activity?page=&pageSize=&action=&beforeId=` — any project
 * viewer.
 *
 * The task id comes from the PARSED params rather than `req.params`, so the
 * value the service sees is the one the uuid schema accepted. The guard ahead of
 * this handler has already proven the task exists, is not soft-deleted, and
 * belongs to a project the caller can read.
 */
export async function listTaskActivityFeed(_req: Request, res: Response): Promise<void> {
  const { taskId } = getParsed<TaskActivityParams>(res, 'params');
  const query = getParsed<TaskActivityQuery>(res, 'query');
  const page = await listTaskActivity(taskId, query);
  respond(res, page.items, page.meta);
}
