/**
 * Request schemas for the six project reports.
 *
 * Two query shapes only, both from `@flowboard/shared`: the sprint-scoped
 * reports take `?sprintId`, the date-ranged ones take `?from&to` as CALENDAR
 * DAYS (`isoDate`, not instants) — the buckets a report returns are days, and
 * accepting an instant here would invite a client to shift them by a timezone.
 */
import { z } from 'zod';
import { reportRangeQuerySchema, sprintReportQuerySchema, uuid } from '@flowboard/shared';

export const reportParamsSchema = z.object({ projectId: uuid });
export type ReportParams = z.infer<typeof reportParamsSchema>;

export { reportRangeQuerySchema, sprintReportQuerySchema };
