import { beforeEach, describe, expect, it } from 'vitest';

import {
  BOARD_FILTER_STORAGE_KEY,
  EMPTY_BOARD_FILTERS,
  activeFilterCount,
  isUnfiltered,
  laneStorageKey,
  toTaskFilterInput,
  useBoardFilterStore,
} from '@/stores/useBoardFilterStore';

/**
 * The board filter store, as PURE STATE — no React, no jsdom.
 *
 * Zustand stores are plain objects with a `setState`/`getState` pair, so the
 * interesting half (what a toggle does, what the derived query looks like, what
 * "clear" is careful NOT to clear) is reachable without rendering anything. The
 * hooks are one `useSyncExternalStore` away from what is asserted here.
 */

const PROJECT = 'project-1';
const OTHER = 'project-2';

/** The slice one project holds right now. */
function stateOf(projectId: string) {
  return useBoardFilterStore.getState().byProject[projectId] ?? EMPTY_BOARD_FILTERS;
}

beforeEach(() => {
  useBoardFilterStore.setState({ byProject: {} });
});

describe('useBoardFilterStore', () => {
  it('toggles a value on and then back off', () => {
    const { toggleAssignee } = useBoardFilterStore.getState();

    toggleAssignee(PROJECT, 'user-a');
    expect(stateOf(PROJECT).assigneeIds).toEqual(['user-a']);

    toggleAssignee(PROJECT, 'user-a');
    expect(stateOf(PROJECT).assigneeIds).toEqual([]);
  });

  it('preserves the order of the values it does not touch', () => {
    const { toggleType } = useBoardFilterStore.getState();

    toggleType(PROJECT, 'bug');
    toggleType(PROJECT, 'story');
    toggleType(PROJECT, 'epic');
    toggleType(PROJECT, 'story');

    expect(stateOf(PROJECT).types).toEqual(['bug', 'epic']);
  });

  it('keeps each project independent', () => {
    const { toggleLabel } = useBoardFilterStore.getState();

    toggleLabel(PROJECT, 'label-a');
    toggleLabel(OTHER, 'label-b');

    expect(stateOf(PROJECT).labelIds).toEqual(['label-a']);
    expect(stateOf(OTHER).labelIds).toEqual(['label-b']);
  });

  it('returns the SAME slice object when a setter is a no-op', () => {
    // Identity stability is the contract `useBoardFilters` depends on: a fresh
    // object every render would loop `useSyncExternalStore` and churn the
    // board's query key.
    const { setSwimlane, setQuery } = useBoardFilterStore.getState();

    setSwimlane(PROJECT, 'assignee');
    const first = stateOf(PROJECT);

    setSwimlane(PROJECT, 'assignee');
    setQuery(PROJECT, '');

    expect(stateOf(PROJECT)).toBe(first);
  });

  it('clears the SELECTION but keeps the swimlane view preference', () => {
    const { toggleAssignee, setQuery, setSwimlane, toggleLane, clearFilters } =
      useBoardFilterStore.getState();

    toggleAssignee(PROJECT, 'user-a');
    setQuery(PROJECT, 'login');
    setSwimlane(PROJECT, 'priority');
    toggleLane(PROJECT, laneStorageKey('priority', 'high'));

    clearFilters(PROJECT);

    const state = stateOf(PROJECT);
    expect(state.assigneeIds).toEqual([]);
    expect(state.query).toBe('');
    // A folded lane and a grouping mode are how the user reads the board, not
    // what the board is filtered to.
    expect(state.swimlane).toBe('priority');
    expect(state.collapsedLanes).toEqual(['priority:high']);
  });

  it('qualifies a collapsed lane by its grouping mode', () => {
    const { toggleLane } = useBoardFilterStore.getState();

    toggleLane(PROJECT, laneStorageKey('priority', 'high'));
    toggleLane(PROJECT, laneStorageKey('assignee', 'high'));

    expect(stateOf(PROJECT).collapsedLanes).toEqual(['priority:high', 'assignee:high']);
  });

  it('persists under the `fb-board-filters-v1` key', () => {
    useBoardFilterStore.getState().toggleType(PROJECT, 'bug');

    const raw = localStorage.getItem(BOARD_FILTER_STORAGE_KEY);
    expect(raw).toContain('bug');
    expect(raw).toContain(PROJECT);
  });
});

describe('toTaskFilterInput', () => {
  it('omits every empty group', () => {
    expect(toTaskFilterInput(EMPTY_BOARD_FILTERS)).toEqual({});
  });

  it('maps each group onto its contract filter key', () => {
    const filters = toTaskFilterInput({
      ...EMPTY_BOARD_FILTERS,
      assigneeIds: ['user-a', 'none'],
      types: ['bug'],
      priorities: ['high', 'highest'],
      labelIds: ['label-a'],
      query: '  login  ',
    });

    expect(filters).toEqual({
      assigneeId: ['user-a', 'none'],
      type: ['bug'],
      priority: ['high', 'highest'],
      labelId: ['label-a'],
      q: 'login',
    });
  });

  it('drops a query that is only whitespace', () => {
    expect(toTaskFilterInput({ ...EMPTY_BOARD_FILTERS, query: '   ' })).toEqual({});
  });

  it('copies the arrays rather than sharing the store’s', () => {
    const state = { ...EMPTY_BOARD_FILTERS, types: ['bug' as const] };
    const filters = toTaskFilterInput(state);
    expect(filters.type).not.toBe(state.types);
    expect(filters.type).toEqual(['bug']);
  });
});

describe('activeFilterCount', () => {
  it('counts GROUPS, not values', () => {
    expect(
      activeFilterCount({
        ...EMPTY_BOARD_FILTERS,
        assigneeIds: ['a', 'b', 'c'],
        labelIds: ['x'],
      }),
    ).toBe(2);
  });

  it('treats a whitespace query as no filter at all', () => {
    expect(isUnfiltered({ ...EMPTY_BOARD_FILTERS, query: ' ' })).toBe(true);
    expect(isUnfiltered({ ...EMPTY_BOARD_FILTERS, query: 'x' })).toBe(false);
  });
});
