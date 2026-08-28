/**
 * The Table view's filter state, as pure data.
 *
 * Everything here is one small function, and every one of them feeds
 * `qk.tasks.list(projectId, filters)` — the cache key. That is what makes the
 * empty-value handling worth pinning: `{ statusId: [] }` and `{}` are the same
 * question, and if they hash differently the table mints a second cache entry
 * and refetches every time the user opens and closes a popover without picking
 * anything.
 */
import { describe, expect, it } from 'vitest';

import {
  FILTER_KEYS,
  NONE_SENTINEL,
  activeFilterCount,
  clearFilter,
  emptyTableFilters,
  isEmptyFilterState,
  toTaskFilterInput,
  toggleFilterValue,
  type TableFilterState,
} from './table-filters';

const STATUS_A = '11111111-1111-4111-8111-111111111111';
const STATUS_B = '22222222-2222-4222-8222-222222222222';
const LABEL_A = '33333333-3333-4333-8333-333333333333';

function filters(overrides: Partial<TableFilterState> = {}): TableFilterState {
  return { ...emptyTableFilters(), ...overrides };
}

describe('emptyTableFilters', () => {
  it('names every multi-value key, so a popover never indexes undefined', () => {
    const empty = emptyTableFilters();
    expect(Object.keys(empty).sort()).toEqual(['q', ...FILTER_KEYS].sort());
    for (const key of FILTER_KEYS) expect(empty[key]).toEqual([]);
    expect(empty.q).toBe('');
  });

  it('hands back a FRESH object each call — this is state, not a constant', () => {
    const first = emptyTableFilters();
    const second = emptyTableFilters();

    first.statusId.push(STATUS_A);

    expect(second.statusId).toEqual([]);
    expect(first).not.toBe(second);
  });
});

describe('activeFilterCount', () => {
  it('is zero for a fresh state', () => {
    expect(activeFilterCount(emptyTableFilters())).toBe(0);
    expect(isEmptyFilterState(emptyTableFilters())).toBe(true);
  });

  it('counts VALUES, not populated keys', () => {
    // The clear button reads this number, and "3 filters" has to mean three
    // chips on screen — two statuses and a label is three, not two.
    expect(activeFilterCount(filters({ statusId: [STATUS_A, STATUS_B], labelId: [LABEL_A] }))).toBe(
      3,
    );
  });

  it('counts the search box as exactly one, however long the term is', () => {
    expect(activeFilterCount(filters({ q: 'rebalance' }))).toBe(1);
  });

  it('does not count whitespace as a search — that is an empty box', () => {
    expect(activeFilterCount(filters({ q: '   ' }))).toBe(0);
    expect(isEmptyFilterState(filters({ q: '   ' }))).toBe(true);
  });

  it('adds the search to the value count', () => {
    expect(activeFilterCount(filters({ q: 'bug', type: ['bug'] }))).toBe(2);
  });

  it('counts the NULL-bucket sentinel like any other value', () => {
    expect(activeFilterCount(filters({ assigneeId: [NONE_SENTINEL] }))).toBe(1);
    expect(isEmptyFilterState(filters({ sprintId: [NONE_SENTINEL] }))).toBe(false);
  });
});

describe('toTaskFilterInput', () => {
  it('OMITS every empty value rather than sending it empty', () => {
    // `useTasks` would strip these before the request anyway — but the cache
    // key is hashed from this object first, so an empty array here is a second
    // cache entry for a query that is identical to the unfiltered one.
    expect(toTaskFilterInput(emptyTableFilters())).toEqual({});
  });

  it('passes the populated filters through as arrays', () => {
    expect(
      toTaskFilterInput(
        filters({ statusId: [STATUS_A, STATUS_B], priority: ['high'], labelId: [LABEL_A] }),
      ),
    ).toEqual({
      statusId: [STATUS_A, STATUS_B],
      priority: ['high'],
      labelId: [LABEL_A],
    });
  });

  it('trims the search term, so a trailing space is not its own query', () => {
    expect(toTaskFilterInput(filters({ q: '  rebalance  ' }))).toEqual({ q: 'rebalance' });
  });

  it('drops a whitespace-only search entirely', () => {
    expect(toTaskFilterInput(filters({ q: '\t \n' }))).toEqual({});
  });

  it('carries the NULL-bucket sentinel through untouched', () => {
    // `assigneeId=none` is "unassigned" and `sprintId=none` is "the backlog" —
    // both are real questions the API answers, and neither is an empty filter.
    expect(
      toTaskFilterInput(filters({ assigneeId: [NONE_SENTINEL], sprintId: [NONE_SENTINEL] })),
    ).toEqual({ assigneeId: [NONE_SENTINEL], sprintId: [NONE_SENTINEL] });
  });

  it('mixes the sentinel with real ids in one filter', () => {
    expect(toTaskFilterInput(filters({ assigneeId: [NONE_SENTINEL, STATUS_A] }))).toEqual({
      assigneeId: [NONE_SENTINEL, STATUS_A],
    });
  });

  it('produces a deep-equal object for two states that mean the same thing', () => {
    // The property the cache key depends on: filtering by nothing and clearing
    // every filter must hash identically.
    const cleared = FILTER_KEYS.reduce<TableFilterState>(
      (state, key) => clearFilter(state, key),
      filters({ statusId: [STATUS_A], type: ['bug'], q: '' }),
    );

    expect(toTaskFilterInput(cleared)).toEqual(toTaskFilterInput(emptyTableFilters()));
  });
});

describe('toggleFilterValue', () => {
  it('adds a value that is not selected, appending it', () => {
    const next = toggleFilterValue(filters({ statusId: [STATUS_A] }), 'statusId', STATUS_B);

    expect(next.statusId).toEqual([STATUS_A, STATUS_B]);
  });

  it('removes a value that is already selected', () => {
    const next = toggleFilterValue(
      filters({ statusId: [STATUS_A, STATUS_B] }),
      'statusId',
      STATUS_A,
    );

    expect(next.statusId).toEqual([STATUS_B]);
  });

  it('round-trips: toggling twice returns to the starting set', () => {
    const start = filters({ type: ['bug'] });

    const there = toggleFilterValue(start, 'type', 'story');
    const back = toggleFilterValue(there, 'type', 'story');

    expect(back.type).toEqual(start.type);
  });

  it('returns a NEW state and never mutates the old one', () => {
    // The toolbar holds this in React state; a mutation would skip the render.
    const before = filters({ statusId: [STATUS_A] });

    const after = toggleFilterValue(before, 'statusId', STATUS_B);

    expect(after).not.toBe(before);
    expect(before.statusId).toEqual([STATUS_A]);
  });

  it('touches only the key it was given', () => {
    const before = filters({ statusId: [STATUS_A], type: ['bug'], q: 'x' });

    const after = toggleFilterValue(before, 'labelId', LABEL_A);

    expect(after.statusId).toEqual([STATUS_A]);
    expect(after.type).toEqual(['bug']);
    expect(after.q).toBe('x');
    expect(after.labelId).toEqual([LABEL_A]);
  });

  it('toggles the NULL-bucket sentinel like any other value', () => {
    const on = toggleFilterValue(emptyTableFilters(), 'assigneeId', NONE_SENTINEL);
    expect(on.assigneeId).toEqual([NONE_SENTINEL]);
    expect(toggleFilterValue(on, 'assigneeId', NONE_SENTINEL).assigneeId).toEqual([]);
  });
});

describe('clearFilter', () => {
  it('drops every value of one filter and leaves the rest standing', () => {
    const before = filters({ statusId: [STATUS_A, STATUS_B], type: ['bug'], q: 'x' });

    const after = clearFilter(before, 'statusId');

    expect(after.statusId).toEqual([]);
    expect(after.type).toEqual(['bug']);
    expect(after.q).toBe('x');
  });

  it('never touches the search term — the chip group s × is not "clear all"', () => {
    expect(clearFilter(filters({ q: 'bug' }), 'type').q).toBe('bug');
  });

  it('is a safe no-op on an already-empty filter', () => {
    expect(clearFilter(emptyTableFilters(), 'priority')).toEqual(emptyTableFilters());
  });

  it('returns a new state without mutating the old one', () => {
    const before = filters({ labelId: [LABEL_A] });

    const after = clearFilter(before, 'labelId');

    expect(after).not.toBe(before);
    expect(before.labelId).toEqual([LABEL_A]);
  });
});
