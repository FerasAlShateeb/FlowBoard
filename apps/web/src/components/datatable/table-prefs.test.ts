import { describe, expect, it } from 'vitest';

import { DEFAULT_COLUMN_ORDER, DEFAULT_HIDDEN_COLUMNS } from '@/components/datatable/table-model';
import { emptyTableFilters } from '@/components/datatable/table-filters';
import {
  COLUMN_PREFS_KEY,
  FILTER_PREFS_KEY,
  clearColumnPrefs,
  defaultColumnPrefs,
  loadColumnPrefs,
  loadTableFilters,
  mergeColumnOrder,
  normalizeColumnPrefs,
  normalizeFilterState,
  saveColumnPrefs,
  saveTableFilters,
  toVisibilityState,
  visibleColumnCount,
} from '@/components/datatable/table-prefs';

/**
 * These preferences are the one piece of Table state that survives a reload, so
 * every hostile input they can meet — malformed JSON, a dead column id, a
 * duplicate, an enum value from a hand-edited entry — is asserted here rather
 * than discovered as a blank column in production.
 *
 * `src/test/setup.ts` clears the storage shim before each test.
 */

describe('mergeColumnOrder', () => {
  it('returns the default order when nothing is stored', () => {
    expect(mergeColumnOrder([])).toEqual([...DEFAULT_COLUMN_ORDER]);
  });

  it('honours a saved order', () => {
    const stored = [
      'title',
      'key',
      ...DEFAULT_COLUMN_ORDER.filter((id) => id !== 'title' && id !== 'key'),
    ];
    expect(mergeColumnOrder(stored).slice(0, 2)).toEqual(['title', 'key']);
  });

  it('drops an id this build no longer defines', () => {
    expect(mergeColumnOrder(['epic', 'key'])).not.toContain('epic');
  });

  it('drops a duplicated id rather than rendering the column twice', () => {
    const order = mergeColumnOrder(['key', 'key', 'title']);
    expect(order.filter((id) => id === 'key')).toHaveLength(1);
  });

  it('splices a newly-introduced column in at its default position', () => {
    // A layout saved before `labels` existed.
    const stored = DEFAULT_COLUMN_ORDER.filter((id) => id !== 'labels');
    const merged = mergeColumnOrder(stored);
    expect(merged).toHaveLength(DEFAULT_COLUMN_ORDER.length);
    expect(merged.indexOf('labels')).toBe(DEFAULT_COLUMN_ORDER.indexOf('labels'));
  });

  it('always yields every known column exactly once', () => {
    const merged = mergeColumnOrder(['title']);
    expect(new Set(merged).size).toBe(DEFAULT_COLUMN_ORDER.length);
  });
});

describe('normalizeColumnPrefs', () => {
  it('falls back to the defaults for a non-object entry', () => {
    expect(normalizeColumnPrefs(null)).toEqual(defaultColumnPrefs());
    expect(normalizeColumnPrefs('nope')).toEqual(defaultColumnPrefs());
    expect(normalizeColumnPrefs(['key'])).toEqual(defaultColumnPrefs());
  });

  it('keeps an explicit empty hidden set — that is not the same as "unreadable"', () => {
    expect(normalizeColumnPrefs({ order: [...DEFAULT_COLUMN_ORDER], hidden: [] }).hidden).toEqual(
      [],
    );
  });

  it('drops a hidden id that is not a real column', () => {
    expect(normalizeColumnPrefs({ hidden: ['epic', 'points'] }).hidden).toEqual(['points']);
  });

  it('refuses to hide the key column', () => {
    expect(normalizeColumnPrefs({ hidden: ['key'] }).hidden).toEqual([]);
  });
});

describe('column prefs persistence', () => {
  it('returns the defaults when nothing has been saved', () => {
    expect(loadColumnPrefs('p1')).toEqual(defaultColumnPrefs());
  });

  it('round-trips a layout for one project', () => {
    saveColumnPrefs('p1', { order: ['title', 'key'], hidden: ['points'] });
    const loaded = loadColumnPrefs('p1');
    expect(loaded.order.slice(0, 2)).toEqual(['title', 'key']);
    expect(loaded.hidden).toEqual(['points']);
  });

  it('keeps projects independent under one storage key', () => {
    saveColumnPrefs('p1', { order: ['title', 'key'], hidden: ['points'] });
    saveColumnPrefs('p2', { order: [...DEFAULT_COLUMN_ORDER], hidden: [] });

    expect(loadColumnPrefs('p1').hidden).toEqual(['points']);
    expect(loadColumnPrefs('p2').hidden).toEqual([]);
  });

  it('resets one project without disturbing another', () => {
    saveColumnPrefs('p1', { order: ['title'], hidden: ['points'] });
    saveColumnPrefs('p2', { order: ['title'], hidden: ['sprint'] });

    clearColumnPrefs('p1');

    expect(loadColumnPrefs('p1')).toEqual(defaultColumnPrefs());
    expect(loadColumnPrefs('p2').hidden).toEqual(['sprint']);
  });

  it('survives malformed JSON in storage', () => {
    localStorage.setItem(COLUMN_PREFS_KEY, '{not json');
    expect(loadColumnPrefs('p1')).toEqual(defaultColumnPrefs());
  });

  it('survives a storage entry that is not an object', () => {
    localStorage.setItem(COLUMN_PREFS_KEY, '"a string"');
    expect(loadColumnPrefs('p1')).toEqual(defaultColumnPrefs());
  });
});

describe('toVisibilityState', () => {
  it('emits an explicit false per hidden column and nothing else', () => {
    expect(toVisibilityState(['points', 'sprint'])).toEqual({ points: false, sprint: false });
  });

  it('is empty when nothing is hidden — an absent entry means visible', () => {
    expect(toVisibilityState([])).toEqual({});
  });

  it('counts the visible columns for the popover', () => {
    expect(visibleColumnCount({ order: [...DEFAULT_COLUMN_ORDER], hidden: [] })).toBe(
      DEFAULT_COLUMN_ORDER.length,
    );
    expect(visibleColumnCount(defaultColumnPrefs())).toBe(
      DEFAULT_COLUMN_ORDER.length - DEFAULT_HIDDEN_COLUMNS.length,
    );
  });
});

describe('filter persistence', () => {
  it('starts from an empty lens', () => {
    expect(loadTableFilters('p1')).toEqual(emptyTableFilters());
  });

  it('round-trips a filter set per project', () => {
    saveTableFilters('p1', {
      ...emptyTableFilters(),
      q: 'login',
      type: ['bug'],
      assigneeId: ['none'],
    });

    const loaded = loadTableFilters('p1');
    expect(loaded.q).toBe('login');
    expect(loaded.type).toEqual(['bug']);
    expect(loaded.assigneeId).toEqual(['none']);
    expect(loadTableFilters('p2')).toEqual(emptyTableFilters());
  });

  it('drops an enum value the contract does not accept', () => {
    expect(normalizeFilterState({ type: ['bug', 'widget'], priority: ['nope', 'high'] })).toEqual({
      ...emptyTableFilters(),
      type: ['bug'],
      priority: ['high'],
    });
  });

  it('keeps opaque ids untouched — a deleted label simply matches nothing', () => {
    expect(normalizeFilterState({ labelId: ['abc', 'def'] }).labelId).toEqual(['abc', 'def']);
  });

  it('survives malformed JSON', () => {
    localStorage.setItem(FILTER_PREFS_KEY, 'null');
    expect(loadTableFilters('p1')).toEqual(emptyTableFilters());
  });

  it('ignores a non-array value where a list belongs', () => {
    expect(normalizeFilterState({ statusId: 'a,b', q: 42 })).toEqual(emptyTableFilters());
  });
});
