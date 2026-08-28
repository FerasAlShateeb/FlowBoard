// Report response contracts — the six charts on the project dashboard.
//
// Every series is returned PRE-AGGREGATED and pre-bucketed by day: the charts are
// Recharts components that map a row to a point, and pushing the bucketing into
// SQL keeps the browser out of the business of re-deriving history from a task
// list. Day buckets are `isoDate` (calendar days), never instants — see the note
// on `isoDate` in `common.ts` for why that distinction is load-bearing here.
//
// Runtime-neutral: zod only, no DOM/Node globals.
import { z } from 'zod';
import { isoDate, isoDateTime, uuid } from './common';
import { nameSchema, userSummarySchema } from './users.schema';
import { taskKeySchema } from './tasks.schema';
import { statusCategorySchema } from './workflow.schema';

/** `?sprintId=` — the sprint a burndown/burnup is drawn for. */
export const sprintReportQuerySchema = z.object({
  sprintId: uuid,
});
export type SprintReportQuery = z.infer<typeof sprintReportQuerySchema>;

/** `?from=&to=` — the window a date-ranged report covers, inclusive. */
export const reportRangeQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
});
export type ReportRangeQuery = z.infer<typeof reportRangeQuerySchema>;

/**
 * One day of a burndown: what is left versus the straight line from the sprint's
 * commitment to zero. `idealPoints` is computed server-side so the chart draws
 * two series from one payload and never disagrees with itself about the sprint's
 * length.
 */
export const burndownDaySchema = z.object({
  date: isoDate,
  remainingPoints: z.number().nonnegative(),
  idealPoints: z.number().nonnegative(),
});
export type BurndownDay = z.infer<typeof burndownDaySchema>;

/** `GET /projects/:projectId/reports/burndown?sprintId=`. */
export const burndownReportSchema = z.object({
  days: z.array(burndownDaySchema),
});
export type BurndownReport = z.infer<typeof burndownReportSchema>;

/**
 * One day of a burnup. Two series again, but the pair that exposes SCOPE CREEP:
 * `completedPoints` climbs while `scopePoints` should be flat — a rising scope
 * line is the thing a burndown hides.
 */
export const burnupDaySchema = z.object({
  date: isoDate,
  completedPoints: z.number().nonnegative(),
  scopePoints: z.number().nonnegative(),
});
export type BurnupDay = z.infer<typeof burnupDaySchema>;

/** `GET /projects/:projectId/reports/burnup?sprintId=`. */
export const burnupReportSchema = z.object({
  days: z.array(burnupDaySchema),
});
export type BurnupReport = z.infer<typeof burnupReportSchema>;

/**
 * One day of the cumulative-flow diagram: how many tasks sat in each status
 * CATEGORY that day, reconstructed from the activity stream.
 *
 * Keyed by category rather than by status because a CFD must stay comparable
 * across a workflow edit — renaming or deleting a column would otherwise put a
 * hole in the middle of the chart. The record is exhaustive (all three keys
 * always present, zeroes included) so the stacked areas never gap.
 */
export const cumulativeFlowDaySchema = z.object({
  date: isoDate,
  counts: z.record(statusCategorySchema, z.number().int().nonnegative()),
});
export type CumulativeFlowDay = z.infer<typeof cumulativeFlowDaySchema>;

/** `GET /projects/:projectId/reports/cumulative-flow?from=&to=`. */
export const cumulativeFlowReportSchema = z.object({
  days: z.array(cumulativeFlowDaySchema),
});
export type CumulativeFlowReport = z.infer<typeof cumulativeFlowReportSchema>;

/**
 * One completed sprint's velocity bar pair. Both numbers are the stamps taken at
 * start and at complete (see `sprints.schema.ts`), never recomputed.
 */
export const velocitySprintSchema = z.object({
  sprintId: uuid,
  name: nameSchema,
  committedPoints: z.number().nonnegative(),
  completedPoints: z.number().nonnegative(),
});
export type VelocitySprint = z.infer<typeof velocitySprintSchema>;

/** `GET /projects/:projectId/reports/velocity` — completed sprints, oldest first. */
export const velocityReportSchema = z.object({
  sprints: z.array(velocitySprintSchema),
});
export type VelocityReport = z.infer<typeof velocityReportSchema>;

/**
 * One resolved task's cycle time. The clock starts when the task first entered an
 * `in_progress` status (not when it was created — a year in the backlog is not
 * cycle time) and stops at `resolvedAt`.
 */
export const cycleTimeTaskSchema = z.object({
  taskId: uuid,
  key: taskKeySchema,
  startedAt: isoDateTime,
  resolvedAt: isoDateTime,
  hours: z.number().nonnegative(),
});
export type CycleTimeTask = z.infer<typeof cycleTimeTaskSchema>;

/**
 * `GET /projects/:projectId/reports/cycle-time?from=&to=`. Percentiles are
 * server-computed over the SAME rows returned in `tasks`, so the scatter and the
 * reference lines can never disagree. `p50`/`p90` are `null` when nothing
 * resolved in the window.
 */
export const cycleTimeReportSchema = z.object({
  tasks: z.array(cycleTimeTaskSchema),
  p50: z.number().nonnegative().nullable(),
  p90: z.number().nonnegative().nullable(),
});
export type CycleTimeReport = z.infer<typeof cycleTimeReportSchema>;

/** One assignee's open load. `user: null` is the unassigned bucket. */
export const workloadAssigneeSchema = z.object({
  user: userSummarySchema.nullable(),
  openTasks: z.number().int().nonnegative(),
  openPoints: z.number().nonnegative(),
});
export type WorkloadAssignee = z.infer<typeof workloadAssigneeSchema>;

/** `GET /projects/:projectId/reports/workload` — open work per assignee. */
export const workloadReportSchema = z.object({
  assignees: z.array(workloadAssigneeSchema),
});
export type WorkloadReport = z.infer<typeof workloadReportSchema>;
