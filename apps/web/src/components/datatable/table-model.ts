import type { TaskSortQuery } from '@flowboard/shared';

/**
 * The Table view's column vocabulary — the one place the set of columns, their
 * default order, their default widths and their server-sort mapping are named.
 *
 * WHY A STANDALONE MODULE rather than facts embedded in the column definitions.
 * Four separate consumers need this vocabulary and only one of them renders:
 * the column-config popover (order + visibility), the persistence layer (which
 * ids are still real after a release renamed one), the CSV exporter (which
 * columns to write, in which order) and the header row (which columns the
 * server can actually sort). Putting it in `TaskDataTable.tsx` would make all
 * four import a React component to read a list of strings, and would make the
 * pure parts untestable without a DOM.
 */

/**
 * Every column the table can show, in DEFAULT ORDER.
 *
 * The order here is the reading order of a work item: what it is (`key`,
 * `title`, `type`), where it stands (`status`, `priority`, `assignee`), what it
 * costs (`points`), and when (`sprint`, `labels`, dates, `updatedAt`). A user's
 * saved order overrides it; a reset returns to exactly this.
 *
 * `as const` is load-bearing: {@link TableColumnId} is derived from it, so
 * adding a column here is the only edit needed to make it a legal id
 * everywhere, and removing one turns every stale reference into a type error.
 */
export const TABLE_COLUMN_IDS = [
  'key',
  'title',
  'type',
  'status',
  'priority',
  'assignee',
  'points',
  'sprint',
  'labels',
  'startDate',
  'dueDate',
  'updatedAt',
] as const;

export type TableColumnId = (typeof TABLE_COLUMN_IDS)[number];

/** The default order, as a plain readonly list. */
export const DEFAULT_COLUMN_ORDER: readonly TableColumnId[] = TABLE_COLUMN_IDS;

/**
 * Columns hidden until someone asks for them.
 *
 * `startDate` only: most teams schedule by due date alone, and twelve visible
 * columns on a 1280px screen leaves the title — the one column anyone actually
 * reads — squeezed to nothing. Everything else earns its place by default.
 */
export const DEFAULT_HIDDEN_COLUMNS: readonly TableColumnId[] = ['startDate'];

/**
 * Column widths in px, used to build the grid template.
 *
 * `title` is the flex column and its number is a MINIMUM rather than a fixed
 * width — see `columnTemplate()` in `TaskDataTable`. The rest are sized to
 * their worst realistic content: a status name and a sprint name can be long,
 * a points value never exceeds four characters.
 */
export const COLUMN_SIZES: Record<TableColumnId, number> = {
  key: 104,
  title: 280,
  type: 116,
  status: 152,
  priority: 124,
  assignee: 168,
  points: 76,
  sprint: 152,
  labels: 184,
  startDate: 128,
  dueDate: 128,
  updatedAt: 128,
};

/**
 * Columns whose numeric content must line up vertically — rendered with
 * `tabular-nums` and Latin digits (see `lib/lang-policy`: FlowBoard's numerals
 * stay Western in every language precisely so these columns stay aligned).
 */
export const NUMERIC_COLUMNS: readonly TableColumnId[] = [
  'key',
  'points',
  'startDate',
  'dueDate',
  'updatedAt',
];

/**
 * A field name the API's `?sort=` accepts.
 *
 * Derived from the SHARED contract (`taskSortQuerySchema`), not re-typed here:
 * the server's `switch` maps this exact union to Drizzle columns, so a column
 * that offers a sort the contract does not list is a compile error rather than
 * a 422 discovered by a user clicking a header.
 */
export type TaskSortField = TaskSortQuery['field'];

/**
 * Column → server sort field, or `null` for "the server cannot sort by this".
 *
 * FIVE COLUMNS ARE NOT SORTABLE, and that is a server-side gap rather than a UI
 * choice: `taskSortQuerySchema` offers `createdAt`, `updatedAt`, `dueDate`,
 * `startDate`, `priority`, `number`, `title`, `storyPoints` — nothing for
 * `type`, `status`, `assignee`, `sprint` or `labels`. Sorting those client-side
 * would sort only the CURRENT PAGE, which reads as the sort being broken. So
 * their headers are plain labels with no affordance at all.
 *
 * `key` maps to `number`: a task key is `<projectKey>-<number>` within one
 * project, so ordering by the number is ordering by the key, and it is an
 * integer index rather than a string comparison.
 */
export const SORT_FIELD_BY_COLUMN: Record<TableColumnId, TaskSortField | null> = {
  key: 'number',
  title: 'title',
  type: null,
  status: null,
  priority: 'priority',
  assignee: null,
  points: 'storyPoints',
  sprint: null,
  labels: null,
  startDate: 'startDate',
  dueDate: 'dueDate',
  updatedAt: 'updatedAt',
};

/** Columns whose cells open an inline editor. `key` and `updatedAt` are reads. */
export const EDITABLE_COLUMNS: readonly TableColumnId[] = [
  'title',
  'type',
  'status',
  'priority',
  'assignee',
  'points',
  'sprint',
  'labels',
  'startDate',
  'dueDate',
];

const COLUMN_ID_SET = new Set<string>(TABLE_COLUMN_IDS);

/**
 * Narrows an unknown string to a live column id.
 *
 * The guard exists for PERSISTED data: `fb-table-columns-v1` may have been
 * written by a build that had a column this one no longer defines (or vice
 * versa), and feeding a dead id into the table's `columnOrder` state produces a
 * column that occupies a slot and renders nothing.
 */
export function isTableColumnId(value: unknown): value is TableColumnId {
  return typeof value === 'string' && COLUMN_ID_SET.has(value);
}

/** Is this column sortable by the server? */
export function isSortableColumn(columnId: string): boolean {
  return isTableColumnId(columnId) && SORT_FIELD_BY_COLUMN[columnId] !== null;
}
