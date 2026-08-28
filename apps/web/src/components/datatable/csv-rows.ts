import type { Label, Sprint, Status, TaskPriority, TaskSummary, TaskType } from '@flowboard/shared';

import type { CsvHeader, CsvRow } from '@/lib/csv';
import type { TableColumnId } from '@/components/datatable/table-model';

/**
 * Task rows → CSV rows: the flattening step, kept pure and away from the
 * transport.
 *
 * WHAT A CELL BECOMES IN A CSV is a set of small decisions that are easy to get
 * wrong and impossible to notice from the UI:
 *
 * * **Dates are ISO** (`2026-03-04`), never the localized `04 Mar 2026` the grid
 *   shows. A CSV is opened by a spreadsheet that will parse the column, and ISO
 *   is the one form every locale's parser agrees on. (The API already stores
 *   them this way, so this is a matter of NOT formatting rather than of
 *   formatting differently.)
 * * **Labels are joined by `;`**, not `,` — a comma inside a field is legal but
 *   forces quoting, and a reader splitting the cell back apart would then have
 *   to un-quote first. A semicolon survives both.
 * * **Enums are localized**, because a human reads them. Ids are not: a status
 *   uuid in a spreadsheet helps nobody, so the status NAME is written.
 * * **Points stay a number**, so the spreadsheet sums the column instead of
 *   concatenating it.
 * * **Empty is empty.** No dash, no "N/A" — an unset due date must not become a
 *   string that breaks a date column's type.
 *
 * VISIBLE COLUMNS ONLY, in the user's own order: the export is "what I am
 * looking at, as a file", not a database dump. That is also why the headers are
 * the same localized strings as the grid's.
 */

/** The lookups a row needs, resolved once per export rather than per row. */
export interface CsvRowContext {
  /** For composing `FB-142` from the summary's bare `number`. */
  projectKey: string;
  statusNames: ReadonlyMap<string, string>;
  sprintNames: ReadonlyMap<string, string>;
  labelNames: ReadonlyMap<string, string>;
  typeLabel: (type: TaskType) => string;
  priorityLabel: (priority: TaskPriority) => string;
  /** What an unset assignee is called, in the UI's language. */
  unassignedLabel: string;
  /** What a task with no sprint is called. */
  backlogLabel: string;
}

/** Builds the id→name maps a {@link CsvRowContext} needs. */
export function csvLookups(
  statuses: readonly Status[],
  sprints: readonly Sprint[],
  labels: readonly Label[],
): Pick<CsvRowContext, 'statusNames' | 'sprintNames' | 'labelNames'> {
  return {
    statusNames: new Map(statuses.map((status) => [status.id, status.name])),
    sprintNames: new Map(sprints.map((sprint) => [sprint.id, sprint.name])),
    labelNames: new Map(labels.map((label) => [label.id, label.name])),
  };
}

/**
 * One task, flattened to primitives keyed by column id.
 *
 * EVERY column is emitted, not only the visible ones: `toCsv` selects by header,
 * so filtering here as well would mean two places that decide what is exported
 * and one of them eventually disagreeing.
 */
export function taskToCsvRow(task: TaskSummary, context: CsvRowContext): CsvRow {
  const labelNames = task.labelIds
    .map((id) => context.labelNames.get(id))
    .filter((name): name is string => name !== undefined);

  return {
    key: `${context.projectKey}-${String(task.number)}`,
    title: task.title,
    type: context.typeLabel(task.type),
    status: context.statusNames.get(task.statusId) ?? '',
    priority: context.priorityLabel(task.priority),
    assignee: task.assignee?.name ?? context.unassignedLabel,
    // A number, so the spreadsheet can total the column. `null` stays null and
    // becomes an empty field — 0 would be a claim nobody made.
    points: task.storyPoints,
    sprint: task.sprintId ? (context.sprintNames.get(task.sprintId) ?? '') : context.backlogLabel,
    labels: labelNames.join(';'),
    startDate: task.startDate,
    dueDate: task.dueDate,
    // The one field that is an INSTANT rather than a calendar day, so it keeps
    // its time and its zone marker.
    updatedAt: task.updatedAt,
  };
}

/**
 * The header record: the visible columns, in the user's order, under the same
 * names the grid shows them.
 */
export function csvHeadersFor(
  columnIds: readonly TableColumnId[],
  labels: Record<string, string>,
): CsvHeader[] {
  return columnIds.map((id) => ({ key: id, label: labels[id] ?? id }));
}
