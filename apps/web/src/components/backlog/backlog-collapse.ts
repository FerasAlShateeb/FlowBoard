import { useCallback, useState } from 'react';

/**
 * Which backlog sections are folded shut, remembered per device.
 *
 * WHY THIS IS NOT A ZUSTAND STORE. The app's UI stores exist for state that
 * more than one component tree reads (the session, the theme, the layout, the
 * board's filter bar). This is read by exactly one page, written by one button
 * on it, and never needed while that page is unmounted — a global store would
 * add a module singleton and a persist middleware to hold a handful of booleans.
 * A local hook over `localStorage` is the honest size of the problem.
 *
 * WHY A MAP AND NOT A SET of collapsed ids. Sections have different DEFAULTS —
 * a completed sprint opens folded, an active one opens expanded — so the stored
 * value has to distinguish "the user folded this" from "the user has never
 * touched this", which a set of ids cannot. An explicit `true`/`false` per id
 * does, and an id that is absent falls back to the section's own default.
 *
 * Every storage access is wrapped: Safari in private mode throws on `setItem`,
 * and a section that cannot remember its fold is not a reason to fail a render.
 */

/** Storage key (conventions: `fb-<name>-v1`). */
export const BACKLOG_COLLAPSE_KEY = 'fb-backlog-collapse-v1';

/** Section id → collapsed. Absent means "never touched; use the default". */
export type CollapseMap = Readonly<Record<string, boolean>>;

/** The backlog section's stable id — sprints use their uuid. */
export const BACKLOG_SECTION_ID = 'backlog';

function storageOf(storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Reads the saved map. Anything unparseable — a hand-edited value, a key left
 * behind by an older shape — reads as "nothing saved" rather than throwing on
 * the first render of the page.
 */
export function readCollapse(storage?: Storage): CollapseMap {
  const store = storageOf(storage);
  if (!store) return {};

  try {
    const raw = store.getItem(BACKLOG_COLLAPSE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const map: Record<string, boolean> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      // Only booleans survive; a stray string would otherwise make
      // `isSectionCollapsed` truthy for a value nothing wrote deliberately.
      if (typeof value === 'boolean') map[id] = value;
    }
    return map;
  } catch {
    return {};
  }
}

/** Saves the map. A storage failure is swallowed — the fold still works. */
export function writeCollapse(map: CollapseMap, storage?: Storage): void {
  const store = storageOf(storage);
  if (!store) return;
  try {
    store.setItem(BACKLOG_COLLAPSE_KEY, JSON.stringify(map));
  } catch {
    // Quota or a blocked storage. Non-fatal by design.
  }
}

/** Is this section folded? `fallback` is the section's own default. */
export function isSectionCollapsed(map: CollapseMap, id: string, fallback = false): boolean {
  return map[id] ?? fallback;
}

/** The map with one section flipped, as a NEW object (never mutated in place). */
export function toggleSection(map: CollapseMap, id: string, fallback = false): CollapseMap {
  return { ...map, [id]: !isSectionCollapsed(map, id, fallback) };
}

/**
 * The hook form: the map is read ONCE on mount (lazy initial state, so the
 * storage hit does not repeat on every render) and written back on every toggle.
 */
export function useSectionCollapse(): {
  isCollapsed: (id: string, fallback?: boolean) => boolean;
  toggle: (id: string, fallback?: boolean) => void;
} {
  const [map, setMap] = useState<CollapseMap>(() => readCollapse());

  const toggle = useCallback((id: string, fallback = false) => {
    setMap((current) => {
      const next = toggleSection(current, id, fallback);
      writeCollapse(next);
      return next;
    });
  }, []);

  const isCollapsed = useCallback(
    (id: string, fallback = false) => isSectionCollapsed(map, id, fallback),
    [map],
  );

  return { isCollapsed, toggle };
}
