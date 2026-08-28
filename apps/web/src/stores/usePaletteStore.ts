import { create } from 'zustand';

/**
 * The keyboard surfaces' own state: the command palette (Ctrl/⌘+K), the `?`
 * cheat sheet, and the quick "create task" dialog `c` opens.
 *
 * ═══ WHY A STORE AND NOT COMPONENT STATE ═══════════════════════════════════
 *
 * Nothing that opens these owns them. A chord registered in
 * `lib/shortcuts.ts` fires from a module-scope `keydown` listener, the topbar
 * trigger button lives in a `TopbarSlots` registry render, and the palette's
 * own rows close it on select — three call sites, none of which is an ancestor
 * of the dialog. A store is the one shape where "open it" is a function call
 * from anywhere and the dialog is still the single owner of whether it is open.
 *
 * ═══ NOT PERSISTED, AND THAT IS THE POINT ══════════════════════════════════
 *
 * An open palette is never a preference. `useLayoutStore` makes the same call
 * for its own transient flags (see its `partialize`), and restoring a reload
 * into a modal search box with a stale needle in it is disorienting.
 *
 * ═══ WHY IT IS NOT `useLayoutStore.paletteOpen` ════════════════════════════
 *
 * Wave 1 speculated a `paletteOpen` flag there. It is a bare boolean with no
 * room for the needle or the mode, it is entangled with `closeAllOverlays()`
 * (which the diagnostics drawer deliberately opts out of), and `useLayoutStore`
 * belongs to another package this wave. The palette's own state lives here;
 * `PaletteMount` mirrors `open` INTO the layout store one-way, so anything
 * asking "is a modal overlay up?" still gets a true answer. See the report.
 *
 * ═══ `mode` ════════════════════════════════════════════════════════════════
 *
 * One value today. It exists now because the alternative — bolting a second
 * boolean on per mode later — is how a palette ends up with `open`,
 * `commandsOpen` and `projectsOpen` that can all be true at once. The prefix
 * modes a future wave may want (`>` for verbs, `#` for projects, `@` for
 * people) each become another member of this union and nothing else changes.
 */

export type PaletteMode = 'root';

interface PaletteState {
  /** The Ctrl/⌘+K palette. */
  open: boolean;
  /** The live needle, mirrored out of the `ui/command` input. See CommandPalette. */
  query: string;
  mode: PaletteMode;
  /** The `?` cheat sheet. */
  cheatSheetOpen: boolean;
  /** The `c` quick-create dialog (WP3.2's `TaskCreateDialog`). */
  createTaskOpen: boolean;

  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
  setQuery: (query: string) => void;
  setMode: (mode: PaletteMode) => void;
  setCheatSheetOpen: (open: boolean) => void;
  toggleCheatSheet: () => void;
  setCreateTaskOpen: (open: boolean) => void;
  /** True when ANY of the three modal surfaces owns the screen. */
  anyOpen: () => boolean;
}

export const usePaletteStore = create<PaletteState>()((set, get) => ({
  open: false,
  query: '',
  mode: 'root',
  cheatSheetOpen: false,
  createTaskOpen: false,

  // Opening RESETS the needle and the mode. A palette that reopens holding the
  // previous session's search shows stale rows for the time it takes the
  // debounce to notice, and the first keystroke then appends to text the user
  // did not type.
  openPalette: () => {
    set({ open: true, query: '', mode: 'root' });
  },
  closePalette: () => {
    set({ open: false, query: '' });
  },
  togglePalette: () => {
    if (get().open) {
      set({ open: false, query: '' });
      return;
    }
    set({ open: true, query: '', mode: 'root' });
  },
  setQuery: (query) => {
    set({ query });
  },
  setMode: (mode) => {
    set({ mode });
  },
  setCheatSheetOpen: (cheatSheetOpen) => {
    set({ cheatSheetOpen });
  },
  toggleCheatSheet: () => {
    set({ cheatSheetOpen: !get().cheatSheetOpen });
  },
  setCreateTaskOpen: (createTaskOpen) => {
    set({ createTaskOpen });
  },

  anyOpen: () => {
    const state = get();
    return state.open || state.cheatSheetOpen || state.createTaskOpen;
  },
}));

/** TEST SEAM: back to a closed, empty palette between suites. */
export function __resetPaletteStoreForTests(): void {
  usePaletteStore.setState({
    open: false,
    query: '',
    mode: 'root',
    cheatSheetOpen: false,
    createTaskOpen: false,
  });
}
