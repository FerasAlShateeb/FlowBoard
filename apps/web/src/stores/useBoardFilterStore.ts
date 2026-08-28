import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { TaskPriority, TaskType } from '@flowboard/shared';

import type { TaskFilterInput } from '@/hooks/useTasks';

/**
 * The Kanban board's filter bar and swimlane mode — UI state, which is exactly
 * Zustand's remit here. Nothing server-derived lives in this file; the rows the
 * filters SELECT are TanStack Query's business.
 *
 * ── KEYED PER PROJECT, ON PURPOSE ──────────────────────────────────────────
 * A filter set is a statement about one project's board ("my bugs in the
 * payments project"), and its assignee ids, label ids and epic ids are only
 * meaningful there. One global bag would carry a label id from project A into
 * project B's query string, where it selects nothing and reads to the user as
 * an empty board. So the persisted shape is `byProject`, and every action takes
 * a `projectId`.
 *
 * ── THE OBJECT IDENTITY RULE ───────────────────────────────────────────────
 * {@link useBoardFilters} must return a value whose identity is STABLE while
 * the filters are unchanged. Two reasons, both load-bearing:
 *
 *   1. A zustand selector that builds a fresh object every call makes
 *      `useSyncExternalStore` see a new snapshot on every render — an infinite
 *      loop, not a performance note.
 *   2. The same object is handed to `useBoard()` AND to `useMoveTask()`. They
 *      derive the board's cache key from it (`qk.tasks.board`), and an
 *      optimistic drag that lands on a different key is a card that snaps back
 *      and then jumps into place when the response arrives.
 *
 * Both are satisfied by selecting the STORED slice (whose identity only changes
 * when it is written) and deriving the query shape in a `useMemo` keyed on it.
 *
 * ── WHY `q` IS COMMITTED, NOT LIVE ─────────────────────────────────────────
 * The text query is a server filter (`?q=` → trigram + key prefix), so every
 * keystroke that reached this store would be a new cache key and a new request.
 * `BoardFilterBar` therefore holds the live input locally and debounces the
 * write to {@link BoardFilterStore.setQuery}.
 */

/** How the board groups cards into horizontal lanes. */
export type SwimlaneMode = 'none' | 'assignee' | 'epic' | 'priority';

/** Every swimlane mode, in the order the picker offers them. */
export const SWIMLANE_MODES: readonly SwimlaneMode[] = ['none', 'assignee', 'epic', 'priority'];

/**
 * The `'none'` sentinel the API's nullable-id filters take: `assigneeId=none`
 * selects the UNASSIGNED bucket, which is a different question from omitting
 * the parameter ("do not filter by assignee"). Spelled once here so the filter
 * bar's "Unassigned" row and the swimlane grouping agree on it.
 */
export const NO_VALUE = 'none';

/** Board filter key (conventions: `fb-<name>-v1`). */
export const BOARD_FILTER_STORAGE_KEY = 'fb-board-filters-v1';

/** One project's filter selection. Plain arrays so it serialises as-is. */
export interface BoardFilterState {
  /** User ids, plus {@link NO_VALUE} for "unassigned". */
  assigneeIds: string[];
  types: TaskType[];
  priorities: TaskPriority[];
  labelIds: string[];
  /** The COMMITTED text query — debounced by the filter bar, never live. */
  query: string;
  swimlane: SwimlaneMode;
  /**
   * Collapsed lanes, stored as `${mode}:${laneId}`. Qualified by mode because
   * a lane id is only unique within one grouping — `high` is a priority lane
   * and could equally be an epic's id in another mode.
   */
  collapsedLanes: string[];
}

/**
 * The neutral filter set.
 *
 * A module CONSTANT rather than a factory: it is the fallback every project
 * without a stored entry selects, so it has to be the same object every time
 * or the identity rule above is broken for the (very common) unfiltered board.
 * Nothing mutates it — every action writes a fresh state object.
 */
export const EMPTY_BOARD_FILTERS: BoardFilterState = Object.freeze({
  assigneeIds: [],
  types: [],
  priorities: [],
  labelIds: [],
  query: '',
  swimlane: 'none',
  collapsedLanes: [],
}) as BoardFilterState;

interface BoardFilterStore {
  byProject: Record<string, BoardFilterState>;

  toggleAssignee: (projectId: string, assigneeId: string) => void;
  toggleType: (projectId: string, type: TaskType) => void;
  togglePriority: (projectId: string, priority: TaskPriority) => void;
  toggleLabel: (projectId: string, labelId: string) => void;
  setQuery: (projectId: string, query: string) => void;
  setSwimlane: (projectId: string, swimlane: SwimlaneMode) => void;
  toggleLane: (projectId: string, laneKey: string) => void;
  /** Clears the SELECTION only — swimlane mode and collapsed lanes are a view
   *  preference, not a filter, and clearing them on "clear filters" would
   *  re-expand every lane the user deliberately folded away. */
  clearFilters: (projectId: string) => void;
}

/** Adds or removes a member, preserving the order of the rest. */
function toggleMember<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

export const useBoardFilterStore = create<BoardFilterStore>()(
  persist(
    (set) => {
      /** Applies a change to one project's slice, creating it on first touch. */
      const patch = (
        projectId: string,
        update: (current: BoardFilterState) => BoardFilterState,
      ): void => {
        set((state) => ({
          byProject: {
            ...state.byProject,
            [projectId]: update(state.byProject[projectId] ?? EMPTY_BOARD_FILTERS),
          },
        }));
      };

      return {
        byProject: {},

        toggleAssignee: (projectId, assigneeId) => {
          patch(projectId, (current) => ({
            ...current,
            assigneeIds: toggleMember(current.assigneeIds, assigneeId),
          }));
        },

        toggleType: (projectId, type) => {
          patch(projectId, (current) => ({
            ...current,
            types: toggleMember(current.types, type),
          }));
        },

        togglePriority: (projectId, priority) => {
          patch(projectId, (current) => ({
            ...current,
            priorities: toggleMember(current.priorities, priority),
          }));
        },

        toggleLabel: (projectId, labelId) => {
          patch(projectId, (current) => ({
            ...current,
            labelIds: toggleMember(current.labelIds, labelId),
          }));
        },

        setQuery: (projectId, query) => {
          patch(projectId, (current) =>
            current.query === query ? current : { ...current, query },
          );
        },

        setSwimlane: (projectId, swimlane) => {
          patch(projectId, (current) =>
            current.swimlane === swimlane ? current : { ...current, swimlane },
          );
        },

        toggleLane: (projectId, laneKey) => {
          patch(projectId, (current) => ({
            ...current,
            collapsedLanes: toggleMember(current.collapsedLanes, laneKey),
          }));
        },

        clearFilters: (projectId) => {
          patch(projectId, (current) => ({
            ...current,
            assigneeIds: [],
            types: [],
            priorities: [],
            labelIds: [],
            query: '',
          }));
        },
      };
    },
    {
      name: BOARD_FILTER_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ byProject: state.byProject }),
    },
  ),
);

// ───────────────────────────────────────────────────────────────────────────
// Derivation (pure — unit-tested without React)
// ───────────────────────────────────────────────────────────────────────────

/**
 * The exact `TaskFilterInput` the board query and its mutations take.
 *
 * Empty selections are dropped rather than sent as empty arrays: `useTasks`'
 * `toQueryParams` would drop them anyway, but `qk.tasks.board`'s `filtersKey`
 * is what decides the CACHE KEY, and an explicit `[]` and an absent key must
 * resolve to one entry — otherwise clearing the last filter chip would fetch
 * the unfiltered board a second time under a different key.
 */
export function toTaskFilterInput(state: BoardFilterState): TaskFilterInput {
  const filters: TaskFilterInput = {};
  if (state.assigneeIds.length > 0) filters.assigneeId = [...state.assigneeIds];
  if (state.types.length > 0) filters.type = [...state.types];
  if (state.priorities.length > 0) filters.priority = [...state.priorities];
  if (state.labelIds.length > 0) filters.labelId = [...state.labelIds];

  const query = state.query.trim();
  if (query.length > 0) filters.q = query;

  return filters;
}

/**
 * How many filter GROUPS are narrowing the board — the number on the filter
 * bar's badge.
 *
 * Groups, not values: "three assignees and a label" is TWO things the user has
 * to undo, and counting four would suggest four chips they cannot find.
 */
export function activeFilterCount(state: BoardFilterState): number {
  let count = 0;
  if (state.assigneeIds.length > 0) count += 1;
  if (state.types.length > 0) count += 1;
  if (state.priorities.length > 0) count += 1;
  if (state.labelIds.length > 0) count += 1;
  if (state.query.trim().length > 0) count += 1;
  return count;
}

/** True when nothing is selected — the board is showing every card it has. */
export function isUnfiltered(state: BoardFilterState): boolean {
  return activeFilterCount(state) === 0;
}

/** The storage key for one lane's collapsed flag. */
export function laneStorageKey(mode: SwimlaneMode, laneId: string): string {
  return `${mode}:${laneId}`;
}

// ───────────────────────────────────────────────────────────────────────────
// Hooks
// ───────────────────────────────────────────────────────────────────────────

/**
 * One project's raw filter state. Identity-stable: the fallback is a module
 * constant and every write produces exactly one new object.
 */
export function useBoardFilterState(projectId: string | null | undefined): BoardFilterState {
  const stored = useBoardFilterStore((state) =>
    projectId ? state.byProject[projectId] : undefined,
  );
  return stored ?? EMPTY_BOARD_FILTERS;
}

/**
 * THE object to pass to `useBoard(projectId, filters)` and
 * `useMoveTask({ projectId, filters })` — the same one, to both.
 *
 * @example
 *   const filters = useBoardFilters(projectId);
 *   const board = useBoard(projectId, filters);
 *   const { move } = useMoveTask({ projectId, filters });
 */
export function useBoardFilters(projectId: string | null | undefined): TaskFilterInput {
  const state = useBoardFilterState(projectId);
  return useMemo(() => toTaskFilterInput(state), [state]);
}

/** Whether one lane is folded away, for the current project and mode. */
export function useIsLaneCollapsed(
  projectId: string | null | undefined,
  mode: SwimlaneMode,
  laneId: string,
): boolean {
  const state = useBoardFilterState(projectId);
  return state.collapsedLanes.includes(laneStorageKey(mode, laneId));
}
