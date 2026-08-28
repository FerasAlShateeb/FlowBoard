import type { TaskPriority, TaskType } from '@flowboard/shared';

import type { TaskFilterInput } from '@/hooks/useTasks';

/**
 * The Table view's filter state, and its translation into a task query.
 *
 * WHY THE TABLE DOES NOT SHARE THE BOARD'S FILTER STORE. `useBoardFilterStore`
 * (`fb-board-filters-v1`) is the BOARD's state: it survives navigation because
 * a board is a place you return to with the same lens. The table is a different
 * question asked of the same rows — "show me every unestimated bug in this
 * sprint, sorted by due date" — and inheriting the board's filters would mean
 * opening the table and seeing a page that silently excludes most of the
 * project. Two views, two independent lenses, two storage keys.
 *
 * THE SHAPE IS ARRAYS OF IDS because that is what the API's multi-value filters
 * take (`?statusId=a,b`), and `TaskFilterInput` is structurally the query
 * params AND the cache key. Converting once, at {@link toTaskFilterInput},
 * keeps every empty-array/`undefined` decision in one place — get that wrong and
 * two filter objects that mean the same thing mint two cache entries.
 */

/**
 * The `'none'` sentinel the API uses for "the NULL bucket".
 *
 * `assigneeId=none` is unassigned, `sprintId=none` is the backlog. Omitting the
 * param means "do not filter", which is a different question — that is exactly
 * why the sentinel exists rather than an empty string.
 */
export const NONE_SENTINEL = 'none';

/** Everything the toolbar can narrow the table by. */
export interface TableFilterState {
  /** Free-text search over title and key prefix. Debounced before it is sent. */
  q: string;
  statusId: string[];
  type: TaskType[];
  priority: TaskPriority[];
  /** May contain {@link NONE_SENTINEL} for "unassigned". */
  assigneeId: string[];
  labelId: string[];
  /** May contain {@link NONE_SENTINEL} for "backlog". */
  sprintId: string[];
}

/** Nothing filtered. A fresh object each call — this is state, not a constant. */
export function emptyTableFilters(): TableFilterState {
  return { q: '', statusId: [], type: [], priority: [], assigneeId: [], labelId: [], sprintId: [] };
}

/** The multi-value keys, in the order their chips and popovers are rendered. */
export const FILTER_KEYS = [
  'statusId',
  'type',
  'priority',
  'assigneeId',
  'labelId',
  'sprintId',
] as const;

export type TableFilterKey = (typeof FILTER_KEYS)[number];

/** How many filter values are active, search included — drives the clear button. */
export function activeFilterCount(filters: TableFilterState): number {
  let total = filters.q.trim() ? 1 : 0;
  for (const key of FILTER_KEYS) total += filters[key].length;
  return total;
}

/** True when nothing is filtered — the empty state's "no rows at all" branch. */
export function isEmptyFilterState(filters: TableFilterState): boolean {
  return activeFilterCount(filters) === 0;
}

/**
 * Filter state → the object `useTaskPage` takes as BOTH its query params and
 * its cache key.
 *
 * EMPTY VALUES ARE OMITTED, not sent empty. `useTasks`' own `toQueryParams`
 * would strip them anyway, but `qk.tasks.list` hashes this object before that
 * happens: `{ statusId: [] }` and `{}` are the same query and must not be two
 * cache entries. (`filtersKey` also drops empties, so this is belt and braces —
 * but the belt is one line and the braces are three files away.)
 *
 * `q` is trimmed here rather than at the input, so a user mid-word does not
 * fire a request for a trailing space.
 */
export function toTaskFilterInput(filters: TableFilterState): TaskFilterInput {
  const query: TaskFilterInput = {};

  const q = filters.q.trim();
  if (q) query.q = q;

  for (const key of FILTER_KEYS) {
    const values = filters[key];
    if (values.length > 0) query[key] = values;
  }

  return query;
}

// NOTE (WP3.8): `TaskListQueryInput`/`withSort` used to live here — an
// intersection that smuggled `sort` through the FILTER object because
// `useTaskPage` had no parameter for it. It does now (`PageParams.sort`), so
// filters and ordering travel separately, which is how the shared contract
// spells them (`taskFiltersSchema` vs `taskListQuerySchema`).

/** Toggles one value of one multi-value filter, returning a new state. */
export function toggleFilterValue(
  filters: TableFilterState,
  key: TableFilterKey,
  value: string,
): TableFilterState {
  const current: readonly string[] = filters[key];
  const next = current.includes(value)
    ? current.filter((entry) => entry !== value)
    : [...current, value];

  // The cast is confined to this one line: `key` indexes a union of string[]
  // and TaskType[]/TaskPriority[], and TypeScript cannot see that `value` came
  // out of the very list it is going back into. The popovers only ever pass ids
  // they rendered from the same option list.
  return { ...filters, [key]: next } as TableFilterState;
}

/** Drops every value of one filter — the chip group's "×". */
export function clearFilter(filters: TableFilterState, key: TableFilterKey): TableFilterState {
  return { ...filters, [key]: [] };
}
