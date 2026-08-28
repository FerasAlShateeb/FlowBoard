import { taskPrioritySchema, taskTypeSchema } from '@flowboard/shared';

import {
  DEFAULT_COLUMN_ORDER,
  DEFAULT_HIDDEN_COLUMNS,
  TABLE_COLUMN_IDS,
  isTableColumnId,
  type TableColumnId,
} from '@/components/datatable/table-model';
import {
  FILTER_KEYS,
  emptyTableFilters,
  type TableFilterState,
} from '@/components/datatable/table-filters';

/**
 * The Table view's device-local preferences: which columns are shown and in
 * what order (`fb-table-columns-v1`), and what the view is filtered by
 * (`fb-table-filters-v1`).
 *
 * PER PROJECT, ONE KEY. Both stores are a `Record<projectId, …>` under a single
 * storage key rather than one key per project: a key per project leaks slots
 * nothing ever cleans up, and `localStorage` has no prefix enumeration that is
 * pleasant to write. The record is small — a dozen ids and a handful of uuids
 * per project a person actually opens.
 *
 * EVERY READ IS DEFENSIVE, and that is the point of this module. The data is
 * user-writable (devtools), version-skewed (a deploy can rename a column while
 * a tab holds the old one) and shared with nothing. So nothing here throws:
 * unreadable storage, malformed JSON, a `null` where an array belongs and an id
 * that no longer exists all resolve to the default. A table that silently
 * forgets your column order is a papercut; one that white-screens on a stale
 * key is an outage.
 *
 * The normalisers are exported separately from the load/save pair so they can
 * be tested without touching Web Storage at all.
 */

/** Storage keys — project convention is `fb-<name>-v1`. */
export const COLUMN_PREFS_KEY = 'fb-table-columns-v1';
export const FILTER_PREFS_KEY = 'fb-table-filters-v1';

/** A saved column layout: the full order, plus the ids that are hidden. */
export interface TableColumnPrefs {
  /** Every known column id, exactly once, in display order. */
  order: TableColumnId[];
  /** The subset of `order` that is not rendered. */
  hidden: TableColumnId[];
}

/** The factory-reset layout. A fresh object — callers mutate through setState. */
export function defaultColumnPrefs(): TableColumnPrefs {
  return { order: [...DEFAULT_COLUMN_ORDER], hidden: [...DEFAULT_HIDDEN_COLUMNS] };
}

// ───────────────────────────────────────────────────────────────────────────
// Storage plumbing
// ───────────────────────────────────────────────────────────────────────────

/**
 * Reads one storage key as a `Record<string, unknown>`, or `{}`.
 *
 * `localStorage` itself can THROW, not merely return null: Safari in private
 * mode and any browser with site data blocked raise on access. Hence the
 * try/catch around the read as well as the parse.
 */
function readStore(key: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Writes one project's entry back, leaving the other projects' alone. */
function writeStore(key: string, projectId: string, value: unknown): void {
  try {
    const store = readStore(key);
    if (value === undefined) delete store[projectId];
    else store[projectId] = value;
    localStorage.setItem(key, JSON.stringify(store));
  } catch {
    // Quota exceeded, or storage blocked. The in-memory state is still correct
    // for this session; only the persistence is lost, which is not worth a toast.
  }
}

/** Every string in an unknown value, or `[]` — the shape guard both loaders use. */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

// ───────────────────────────────────────────────────────────────────────────
// Column layout
// ───────────────────────────────────────────────────────────────────────────

/**
 * Reconciles a stored order with the columns this build actually has.
 *
 * THE RELEASE-SKEW PROBLEM this solves: someone saved an order in March, and
 * April's build removed `epic` and added `labels`. Replacing the saved order
 * wholesale would throw away a deliberate customisation over one new column;
 * using it verbatim would leave `labels` unreachable and `epic` occupying a
 * slot that renders nothing.
 *
 * So: keep every stored id that is still real, in the stored order, then splice
 * each MISSING id back in at its DEFAULT index. A new column therefore appears
 * roughly where the designer put it rather than tacked onto the end — which
 * matters, because the end of a twelve-column table is off-screen.
 *
 * Duplicates in the stored array are dropped (a `Set`-backed pass), because a
 * column id appearing twice in `columnOrder` renders the column twice.
 */
export function mergeColumnOrder(stored: readonly string[]): TableColumnId[] {
  const seen = new Set<TableColumnId>();
  const order: TableColumnId[] = [];

  for (const id of stored) {
    if (!isTableColumnId(id) || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }

  DEFAULT_COLUMN_ORDER.forEach((id, index) => {
    if (seen.has(id)) return;
    seen.add(id);
    order.splice(Math.min(index, order.length), 0, id);
  });

  return order;
}

/**
 * An unknown persisted value → a usable layout.
 *
 * A stored entry that is not an object at all (someone's `null`, an old array
 * format) falls back to the defaults INCLUDING the default hidden set —
 * deliberately, because "we could not read your preferences" and "you hid
 * nothing" are different states and only the first one is true.
 */
export function normalizeColumnPrefs(raw: unknown): TableColumnPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultColumnPrefs();

  const record = raw as { order?: unknown; hidden?: unknown };
  const order = mergeColumnOrder(toStringArray(record.order));
  const hidden = toStringArray(record.hidden).filter(isTableColumnId);

  // `key` and `title` are the row's identity: hiding both leaves a table of
  // metadata about rows nobody can name. `key` is the one that is never
  // hideable (`enableHiding: false` on its column), so a stored `hidden`
  // claiming otherwise is dropped here too.
  return { order, hidden: [...new Set(hidden)].filter((id) => id !== 'key') };
}

/** This project's saved layout, or the default. Never throws. */
export function loadColumnPrefs(projectId: string): TableColumnPrefs {
  if (!projectId) return defaultColumnPrefs();
  return normalizeColumnPrefs(readStore(COLUMN_PREFS_KEY)[projectId]);
}

/** Persists this project's layout. Other projects' entries are untouched. */
export function saveColumnPrefs(projectId: string, prefs: TableColumnPrefs): void {
  if (!projectId) return;
  writeStore(COLUMN_PREFS_KEY, projectId, { order: prefs.order, hidden: prefs.hidden });
}

/** Forgets this project's layout — the popover's "reset to default". */
export function clearColumnPrefs(projectId: string): void {
  if (!projectId) return;
  writeStore(COLUMN_PREFS_KEY, projectId, undefined);
}

/**
 * `hidden` → TanStack's `columnVisibility` state.
 *
 * ONLY EXPLICIT `false` HIDES a column in v9; an absent entry is visible. So
 * this emits an entry per hidden id and nothing else, which is also what keeps
 * the state object small enough to compare cheaply.
 */
export function toVisibilityState(hidden: readonly TableColumnId[]): Record<string, boolean> {
  const visibility: Record<string, boolean> = {};
  for (const id of hidden) visibility[id] = false;
  return visibility;
}

/** How many of the known columns are currently shown — the popover's counter. */
export function visibleColumnCount(prefs: TableColumnPrefs): number {
  return TABLE_COLUMN_IDS.length - new Set(prefs.hidden).size;
}

// ───────────────────────────────────────────────────────────────────────────
// Filters
// ───────────────────────────────────────────────────────────────────────────

/**
 * An unknown persisted value → a usable filter state.
 *
 * Ids are kept as opaque strings (they are uuids the server owns, and a label
 * deleted since the filter was saved simply matches nothing), but the CLOSED
 * enums are validated against the shared schemas: `type=widget` would be a 422
 * on every page load, and the only place it can come from is a stale or
 * hand-edited storage entry.
 */
export function normalizeFilterState(raw: unknown): TableFilterState {
  const state = emptyTableFilters();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return state;

  const record = raw as Record<string, unknown>;
  if (typeof record.q === 'string') state.q = record.q;

  for (const key of FILTER_KEYS) {
    const values = toStringArray(record[key]);
    if (key === 'type') {
      state.type = values.filter(
        (value): value is TableFilterState['type'][number] =>
          taskTypeSchema.safeParse(value).success,
      );
      continue;
    }
    if (key === 'priority') {
      state.priority = values.filter(
        (value): value is TableFilterState['priority'][number] =>
          taskPrioritySchema.safeParse(value).success,
      );
      continue;
    }
    state[key] = values;
  }

  return state;
}

/** This project's saved filters, or an empty lens. Never throws. */
export function loadTableFilters(projectId: string): TableFilterState {
  if (!projectId) return emptyTableFilters();
  return normalizeFilterState(readStore(FILTER_PREFS_KEY)[projectId]);
}

/** Persists this project's filters. */
export function saveTableFilters(projectId: string, filters: TableFilterState): void {
  if (!projectId) return;
  writeStore(FILTER_PREFS_KEY, projectId, filters);
}
