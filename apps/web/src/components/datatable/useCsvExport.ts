import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  taskSummarySchema,
  type Label,
  type Sprint,
  type Status,
  type TaskSummary,
} from '@flowboard/shared';

import { api } from '@/lib/api';
import type { TaskFilterInput } from '@/hooks/useTasks';
import { csvFilename, downloadCsv, toCsv } from '@/lib/csv';
import { trackExportCsv } from '@/lib/telemetry-client';
import { useApiErrorToast } from '@/i18n/errors';
import { useColumnLabels } from '@/components/datatable/table-columns';
import { csvHeadersFor, csvLookups, taskToCsvRow } from '@/components/datatable/csv-rows';
import type { TableColumnId } from '@/components/datatable/table-model';
import { useTaskFieldLabels } from '@/components/datatable/task-fields';

/**
 * "Export CSV" — every row the current filters match, not just the page on
 * screen.
 *
 * ═══ WHY IT PAGES THE SERVER INSTEAD OF EXPORTING THE CACHE ════════════════
 *
 * The grid holds ONE page. Exporting what is cached would produce a file whose
 * contents depend on which page the user happened to be looking at — the single
 * most confusing possible behaviour for a button labelled "export". So the
 * export re-runs the same query with the same filters and the same sort, walks
 * the pages, and stops at {@link CSV_EXPORT_CAP}.
 *
 * ═══ WHY THERE IS A CAP AT ALL ═════════════════════════════════════════════
 *
 * The loop is sequential (page N+1's request is only meaningful once page N has
 * been counted), so an unbounded export of a 50 000-task project is fifty
 * round trips with a spinner and no progress bar, and a browser tab holding the
 * whole result set in memory twice — once as parsed tasks, once as a string.
 * 1000 rows is ~10 requests and a file a spreadsheet opens instantly, and it is
 * the number the button's tooltip states up front rather than a silent
 * truncation. A user who hits it is told, and told what to do about it (narrow
 * the filters).
 *
 * ═══ FAILURE ═══════════════════════════════════════════════════════════════
 *
 * A mid-loop failure aborts the whole export rather than writing a partial
 * file: a CSV that silently stops at row 340 is worse than no CSV, because
 * nothing in the file says it is incomplete.
 */

/** The hard ceiling on an export, in rows. Stated in the button's tooltip. */
export const CSV_EXPORT_CAP = 1000;

/** The API's maximum page size, so the cap costs the fewest round trips. */
const EXPORT_PAGE_SIZE = 100;

const taskListSchema = z.array(taskSummarySchema);

export interface CsvExportOptions {
  projectId: string;
  projectKey: string;
  /** The SAME filters the grid is showing. */
  filters: TaskFilterInput;
  /** The SAME `field:asc|desc` the grid is ordered by, if any. */
  sort?: string;
  /** Visible columns, in the user's order — the export mirrors the view. */
  columnIds: readonly TableColumnId[];
  statuses: readonly Status[];
  sprints: readonly Sprint[];
  labels: readonly Label[];
}

export function useCsvExport(options: CsvExportOptions): {
  exportCsv: () => Promise<void>;
  isExporting: boolean;
} {
  const { projectId, projectKey, filters, sort, columnIds, statuses, sprints, labels } = options;
  const { t } = useTranslation(['table']);
  const columnLabels = useColumnLabels();
  const { typeLabel, priorityLabel } = useTaskFieldLabels();
  const onApiError = useApiErrorToast();
  const [isExporting, setIsExporting] = useState(false);

  const exportCsv = useCallback(async () => {
    if (!projectId || isExporting) return;
    setIsExporting(true);

    try {
      const collected: TaskSummary[] = [];
      let page = 1;

      while (collected.length < CSV_EXPORT_CAP) {
        const result = await api.paged(`/projects/${projectId}/tasks`, {
          schema: taskListSchema,
          query: {
            ...filters,
            ...(sort === undefined ? {} : { sort }),
            view: 'flat',
            page,
            pageSize: EXPORT_PAGE_SIZE,
          },
        });

        collected.push(...result.data);

        // Two independent stop conditions, because either can be the truthful
        // one: a short page means the server ran out of rows, and the meta
        // block means we have walked every page it says exist.
        if (result.data.length < EXPORT_PAGE_SIZE) break;
        if (result.meta && page >= result.meta.totalPages) break;
        page += 1;
      }

      const capped = collected.length > CSV_EXPORT_CAP;
      const rows = capped ? collected.slice(0, CSV_EXPORT_CAP) : collected;

      if (rows.length === 0) {
        toast.info(t('table:toolbar.exportEmpty'));
        return;
      }

      const context = {
        projectKey,
        ...csvLookups(statuses, sprints, labels),
        typeLabel,
        priorityLabel,
        unassignedLabel: t('table:filters.unassigned'),
        backlogLabel: t('table:filters.backlog'),
      };

      const csv = toCsv(
        rows.map((task) => taskToCsvRow(task, context)),
        csvHeadersFor(columnIds, columnLabels),
      );

      downloadCsv(csvFilename(`${projectKey}-tasks`), csv);

      // AFTER the download, not before: an export that failed mid-loop threw
      // above and never reaches here, so the event count is a count of files
      // that actually landed. `rows.length` is the post-cap figure — the number
      // in the file, which is what makes the event worth recording at all.
      trackExportCsv('table', rows.length, { projectId });

      if (capped) toast.warning(t('table:toolbar.exportCapped', { cap: CSV_EXPORT_CAP }));
      else toast.success(t('table:toolbar.exported', { count: rows.length }));
    } catch (error) {
      onApiError(error);
    } finally {
      setIsExporting(false);
    }
  }, [
    projectId,
    projectKey,
    filters,
    sort,
    columnIds,
    columnLabels,
    statuses,
    sprints,
    labels,
    typeLabel,
    priorityLabel,
    isExporting,
    onApiError,
    t,
  ]);

  return { exportCsv, isExporting };
}
