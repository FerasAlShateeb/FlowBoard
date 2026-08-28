import type { SortingState } from '@tanstack/react-table';

import { SORT_FIELD_BY_COLUMN, isTableColumnId } from '@/components/datatable/table-model';

/**
 * Sort state ⇄ `?sort=field:asc|desc`.
 *
 * THE WHOLE SORT IS SERVER-SIDE, which is the fact that shapes this file.
 * `useTaskPage` fetches ONE page; a client-side comparator would order those 25
 * rows among themselves and leave the other 900 where they were, which reads to
 * a user as "sorting is broken" rather than "sorting is local". So TanStack's
 * sorting feature runs with `manualSorting: true` — it owns the STATE and the
 * asc→desc→none toggle cycle, and this module turns that state into the query
 * parameter the API validates with `taskSortQuerySchema`.
 *
 * Pure and DOM-free on purpose: the mapping is the part that can be wrong in a
 * way nobody notices (a column that sorts by the wrong field still sorts), so
 * it is the part that is unit-tested.
 */

/**
 * The sort state → the API's `sort` parameter, or `undefined` for "unsorted".
 *
 * ONLY THE FIRST ENTRY is read. The table runs with `enableMultiSort: false`,
 * so there is never a second one — but the state is an ARRAY, and silently
 * dropping extra entries is better than sending a parameter the server would
 * reject. `undefined` (not `''`) because `lib/api`'s query builder drops
 * `undefined` keys, so an unsorted table sends no `sort` at all rather than an
 * empty one.
 *
 * A column with no server-side sort field yields `undefined` too. That should
 * be unreachable (those columns set `enableSorting: false`), but a stale
 * persisted sort or a future column rename could produce one, and a 422 on
 * every page load is a worse failure than falling back to the default order.
 */
export function toSortQuery(sorting: SortingState): string | undefined {
  const first = sorting[0];
  if (!first) return undefined;
  if (!isTableColumnId(first.id)) return undefined;

  const field = SORT_FIELD_BY_COLUMN[first.id];
  if (field === null) return undefined;

  return `${field}:${first.desc ? 'desc' : 'asc'}`;
}

/** The `aria-sort` value for one column header. */
export type AriaSort = 'ascending' | 'descending' | 'none';

/**
 * `aria-sort` for a header cell.
 *
 * Every `columnheader` in a sortable grid needs this, not only the sorted one:
 * screen readers announce "not sorted" from an explicit `none`, whereas an
 * ABSENT attribute is announced as nothing at all — indistinguishable from a
 * column that cannot be sorted. The caller omits the attribute entirely for
 * non-sortable columns, which is the correct way to say "this is not a sort
 * control".
 */
export function ariaSortOf(sorting: SortingState, columnId: string): AriaSort {
  const first = sorting[0];
  if (!first || first.id !== columnId) return 'none';
  return first.desc ? 'descending' : 'ascending';
}

/** The three states a sortable header can be in, for icon + label selection. */
export type SortDirection = 'asc' | 'desc' | false;

/** This column's current direction, or `false` when it is not the sorted one. */
export function directionOf(sorting: SortingState, columnId: string): SortDirection {
  const first = sorting[0];
  if (!first || first.id !== columnId) return false;
  return first.desc ? 'desc' : 'asc';
}

/**
 * The direction a click would move this header to — the copy for its
 * accessible hint ("activate to sort descending").
 *
 * Mirrors TanStack's own cycle with `sortDescFirst: false` and
 * `enableSortingRemoval: true`: unsorted → asc → desc → unsorted. Duplicated
 * here rather than read from `column.getNextSortingOrder()` because the hint is
 * rendered from a header context where reading a builder method would hide a
 * state read from React, and because a pure function is testable.
 */
export function nextDirectionOf(sorting: SortingState, columnId: string): 'asc' | 'desc' | 'none' {
  const current = directionOf(sorting, columnId);
  if (current === false) return 'asc';
  if (current === 'asc') return 'desc';
  return 'none';
}
