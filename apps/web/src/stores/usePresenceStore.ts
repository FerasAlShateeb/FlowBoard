import { create } from 'zustand';
import type { PresenceEntry } from '@flowboard/shared';

/**
 * WHO ELSE IS LOOKING AT THIS PROJECT.
 *
 * ═══ NOT PERSISTED, AND THAT IS THE WHOLE DESIGN ═══════════════════════════
 *
 * Every other store in `stores/` writes through zustand's `persist` to an
 * `fb-*-v1` key, because their state is a PREFERENCE — a collapsed sidebar, a
 * chosen theme, a filter set — and a preference that forgets itself on reload
 * is a bug. Presence is the opposite kind of fact: it is true only while a
 * socket is open, and it is authored by the SERVER, not by this user. Restoring
 * it from localStorage would paint a roster of people who left hours ago and
 * then correct itself the moment the first `presence:state` lands. Starting
 * empty is not a limitation here; it is the only correct initial value.
 *
 * ═══ WHOLE-SET REPLACEMENT, NEVER A DIFF ═══════════════════════════════════
 *
 * `presence:state` carries the FULL roster of a project on every join, leave,
 * update and disconnect, so {@link PresenceState.setRoster} replaces rather
 * than merges. A room holds a handful of people, so the whole set is smaller
 * than the bookkeeping a diff protocol would need to survive one reconnect —
 * and a diff that arrives out of order leaves a ghost avatar on screen with
 * nothing to correct it.
 *
 * ═══ KEYED BY PROJECT ══════════════════════════════════════════════════════
 *
 * A tab can hold caches for more than one project (the org switcher does not
 * unmount the app), so the roster is a map rather than a single array. Reading
 * goes through {@link usePresenceRoster}, which returns a STABLE empty array
 * for an unknown project — a fresh `[]` per render would make zustand's
 * reference comparison see a change on every render and re-render forever.
 */

interface PresenceState {
  /** `projectId` → the roster the server last broadcast. */
  byProject: Record<string, PresenceEntry[]>;
  /** Replace one project's roster (a `presence:state` payload). */
  setRoster: (projectId: string, entries: PresenceEntry[]) => void;
  /** Forget one project — leaving its room, or unmounting the bridge. */
  clearProject: (projectId: string) => void;
  /** Forget everything — sign-out, or a dropped connection. */
  clearAll: () => void;
}

/**
 * The stable empty roster.
 *
 * Module-scope so every "this project has nobody in it" read returns the SAME
 * reference. See the note above: this is what stops an unknown project id from
 * re-rendering its subscriber on every store notification.
 */
const EMPTY_ROSTER: PresenceEntry[] = [];

export const usePresenceStore = create<PresenceState>()((set) => ({
  byProject: {},

  setRoster: (projectId, entries) => {
    set((state) => ({ byProject: { ...state.byProject, [projectId]: entries } }));
  },

  clearProject: (projectId) => {
    set((state) => {
      if (!(projectId in state.byProject)) return state;
      const { [projectId]: _removed, ...rest } = state.byProject;
      return { byProject: rest };
    });
  },

  clearAll: () => {
    set({ byProject: {} });
  },
}));

/** One project's roster, exactly as the server last described it. */
export function usePresenceRoster(projectId: string | null | undefined): PresenceEntry[] {
  return usePresenceStore((state) =>
    projectId === null || projectId === undefined
      ? EMPTY_ROSTER
      : (state.byProject[projectId] ?? EMPTY_ROSTER),
  );
}

/**
 * The roster minus the reader themselves.
 *
 * Self-exclusion is a VIEW concern, not a protocol one: the server broadcasts
 * one roster to the whole room (a payload it can cache and fan out unchanged),
 * and each client drops its own entry. Filtering server-side would mean
 * building a different payload per socket.
 *
 * Memoized against the roster reference so the filtered array is stable between
 * broadcasts — the avatar row is re-rendered by every unrelated store update
 * otherwise.
 */
export function useOthersPresent(
  projectId: string | null | undefined,
  selfUserId: string | null | undefined,
): PresenceEntry[] {
  const roster = usePresenceRoster(projectId);
  return selfUserId === null || selfUserId === undefined
    ? roster
    : filterOutSelf(roster, selfUserId);
}

/**
 * `roster.filter(...)` with a fast path that preserves the input reference when
 * nothing is dropped — so a roster that does not contain the reader does not
 * mint a new array on every render.
 */
const filterCache = new WeakMap<PresenceEntry[], { selfUserId: string; result: PresenceEntry[] }>();

function filterOutSelf(roster: PresenceEntry[], selfUserId: string): PresenceEntry[] {
  const cached = filterCache.get(roster);
  if (cached && cached.selfUserId === selfUserId) return cached.result;

  const result = roster.some((entry) => entry.user.id === selfUserId)
    ? roster.filter((entry) => entry.user.id !== selfUserId)
    : roster;
  filterCache.set(roster, { selfUserId, result });
  return result;
}
