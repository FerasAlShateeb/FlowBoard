import { describe, expect, it } from 'vitest';
import type { SortingState } from '@tanstack/react-table';

import { SORT_FIELD_BY_COLUMN, isSortableColumn } from '@/components/datatable/table-model';
import {
  ariaSortOf,
  directionOf,
  nextDirectionOf,
  toSortQuery,
} from '@/components/datatable/table-sort';

/**
 * The sort mapping is server contract, not presentation: a column that sorts by
 * the wrong field still LOOKS sorted, so the mapping is the part worth pinning
 * down.
 */

describe('toSortQuery', () => {
  it('sends nothing for an unsorted table', () => {
    expect(toSortQuery([])).toBeUndefined();
  });

  it('maps an ascending sort to `field:asc`', () => {
    expect(toSortQuery([{ id: 'dueDate', desc: false }])).toBe('dueDate:asc');
  });

  it('maps a descending sort to `field:desc`', () => {
    expect(toSortQuery([{ id: 'dueDate', desc: true }])).toBe('dueDate:desc');
  });

  it('maps the key column to the `number` field, not a string compare', () => {
    expect(toSortQuery([{ id: 'key', desc: false }])).toBe('number:asc');
  });

  it('maps the points column to `storyPoints`', () => {
    expect(toSortQuery([{ id: 'points', desc: true }])).toBe('storyPoints:desc');
  });

  it('ignores a column the server cannot sort by', () => {
    expect(toSortQuery([{ id: 'assignee', desc: false }])).toBeUndefined();
  });

  it('ignores a column id this build no longer defines', () => {
    expect(toSortQuery([{ id: 'epicRank', desc: false }])).toBeUndefined();
  });

  it('reads only the first entry — the table is single-sort', () => {
    const sorting: SortingState = [
      { id: 'title', desc: false },
      { id: 'dueDate', desc: true },
    ];
    expect(toSortQuery(sorting)).toBe('title:asc');
  });
});

describe('the toggle cycle', () => {
  it('runs unsorted → ascending → descending → unsorted', () => {
    expect(nextDirectionOf([], 'title')).toBe('asc');
    expect(nextDirectionOf([{ id: 'title', desc: false }], 'title')).toBe('desc');
    expect(nextDirectionOf([{ id: 'title', desc: true }], 'title')).toBe('none');
  });

  it('offers ascending first on a column that is not the sorted one', () => {
    expect(nextDirectionOf([{ id: 'dueDate', desc: true }], 'title')).toBe('asc');
  });

  it('reports the current direction, or false when unsorted', () => {
    expect(directionOf([], 'title')).toBe(false);
    expect(directionOf([{ id: 'title', desc: false }], 'title')).toBe('asc');
    expect(directionOf([{ id: 'title', desc: true }], 'title')).toBe('desc');
    expect(directionOf([{ id: 'title', desc: true }], 'dueDate')).toBe(false);
  });
});

describe('ariaSortOf', () => {
  it('announces the sorted column', () => {
    expect(ariaSortOf([{ id: 'title', desc: false }], 'title')).toBe('ascending');
    expect(ariaSortOf([{ id: 'title', desc: true }], 'title')).toBe('descending');
  });

  it('announces an explicit "none" for every other sortable column', () => {
    // An ABSENT aria-sort is indistinguishable from "cannot be sorted".
    expect(ariaSortOf([{ id: 'title', desc: false }], 'dueDate')).toBe('none');
    expect(ariaSortOf([], 'dueDate')).toBe('none');
  });
});

describe('isSortableColumn', () => {
  it('accepts exactly the columns the shared contract can serve', () => {
    expect(isSortableColumn('key')).toBe(true);
    expect(isSortableColumn('title')).toBe(true);
    expect(isSortableColumn('priority')).toBe(true);
    expect(isSortableColumn('points')).toBe(true);
    expect(isSortableColumn('startDate')).toBe(true);
    expect(isSortableColumn('dueDate')).toBe(true);
    expect(isSortableColumn('updatedAt')).toBe(true);
  });

  it('rejects the five columns with no server-side sort field', () => {
    for (const id of ['type', 'status', 'assignee', 'sprint', 'labels']) {
      expect(isSortableColumn(id)).toBe(false);
    }
  });

  it('rejects an unknown id', () => {
    expect(isSortableColumn('nope')).toBe(false);
  });

  it('keeps the map exhaustive over every declared column', () => {
    // A new column added to TABLE_COLUMN_IDS without a decision here would be
    // silently unsortable; the Record type makes that a compile error, and this
    // guards the runtime shape too.
    expect(Object.values(SORT_FIELD_BY_COLUMN)).not.toContain(undefined);
  });
});
