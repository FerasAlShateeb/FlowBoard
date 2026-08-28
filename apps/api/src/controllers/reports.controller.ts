/**
 * Report controllers — six reads, no writes.
 *
 * Each returns exactly the shape its schema in `reports.schema.ts` declares, so
 * the Recharts component on the other end maps a row to a point and never
 * re-derives history in the browser.
 */
import type { Request, Response } from 'express';
import type { ReportRangeQuery, SprintReportQuery } from '@flowboard/shared';

import { getParsed } from '../middlewares/validate';
import { respond } from '../utils/respond';
import {
  burndown,
  burnup,
  cumulativeFlow,
  cycleTime,
  velocity,
  workload,
} from '../services/reports.service';
import type { ReportParams } from '../validation/reports.validation';

/** `GET /api/projects/:projectId/reports/burndown?sprintId=`. */
export async function getBurndown(_req: Request, res: Response): Promise<void> {
  const { projectId } = getParsed<ReportParams>(res, 'params');
  const { sprintId } = getParsed<SprintReportQuery>(res, 'query');
  respond(res, await burndown(projectId, sprintId));
}

/** `GET /api/projects/:projectId/reports/burnup?sprintId=`. */
export async function getBurnup(_req: Request, res: Response): Promise<void> {
  const { projectId } = getParsed<ReportParams>(res, 'params');
  const { sprintId } = getParsed<SprintReportQuery>(res, 'query');
  respond(res, await burnup(projectId, sprintId));
}

/** `GET /api/projects/:projectId/reports/cumulative-flow?from=&to=`. */
export async function getCumulativeFlow(_req: Request, res: Response): Promise<void> {
  const { projectId } = getParsed<ReportParams>(res, 'params');
  const { from, to } = getParsed<ReportRangeQuery>(res, 'query');
  respond(res, await cumulativeFlow(projectId, from, to));
}

/** `GET /api/projects/:projectId/reports/velocity`. */
export async function getVelocity(_req: Request, res: Response): Promise<void> {
  const { projectId } = getParsed<ReportParams>(res, 'params');
  respond(res, await velocity(projectId));
}

/** `GET /api/projects/:projectId/reports/cycle-time?from=&to=`. */
export async function getCycleTime(_req: Request, res: Response): Promise<void> {
  const { projectId } = getParsed<ReportParams>(res, 'params');
  const { from, to } = getParsed<ReportRangeQuery>(res, 'query');
  respond(res, await cycleTime(projectId, from, to));
}

/** `GET /api/projects/:projectId/reports/workload`. */
export async function getWorkload(_req: Request, res: Response): Promise<void> {
  const { projectId } = getParsed<ReportParams>(res, 'params');
  respond(res, await workload(projectId));
}
