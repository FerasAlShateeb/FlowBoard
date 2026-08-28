import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Chrome state: what is collapsed, what is open, where the devtools drawer
 * lives. UI ONLY — Zustand's remit in this app. Nothing server-derived belongs
 * here; that is TanStack Query's job.
 *
 * NOTE: the UI LANGUAGE deliberately does not live here. It is
 * `lib/lang-policy.ts` (device-local `fb-lang-v1`, stamped on `<html lang|dir>`
 * before first paint) because a zustand field cannot answer "which way does
 * this page run?" until React has mounted.
 */

/**
 * Which PHYSICAL window edge the diagnostics drawer docks to — browser-devtools
 * convention. `left`/`right` are physical, not logical start/end: a developer
 * moving the console around is thinking about their screen, not about reading
 * order. The shell compensates for RTL when it places the flex child.
 */
export type DiagDock = 'bottom' | 'left' | 'right' | 'top';

/** Ctrl+Shift+J cycle order: default first, then both sides, then the top. */
export const DIAG_DOCK_CYCLE: readonly DiagDock[] = ['bottom', 'right', 'left', 'top'];

/** True for the two docks whose size is a WIDTH; the rest use a height. */
export function isSideDock(dock: DiagDock): boolean {
  return dock === 'left' || dock === 'right';
}

/** Layout key (conventions: `fb-<name>-v1`). */
export const LAYOUT_STORAGE_KEY = 'fb-layout-v1';

/**
 * Persisted-shape version.
 *
 * Bumped to 1 by WP4.4, which dropped the placeholder `diagTab` field: the
 * drawer shipped TAB-LESS (one surface — the log tail), so a persisted tab id
 * selects nothing. Zustand's default merge is a shallow spread of the stored
 * object over the initial state, which would otherwise resurrect `diagTab` as a
 * stray field on every hydrate, forever.
 */
export const LAYOUT_STORAGE_VERSION = 1;

export const DIAG_HEIGHT_DEFAULT = 288;
export const DIAG_WIDTH_DEFAULT = 380;

/**
 * Size bounds for the drawer, in px and viewport fractions.
 *
 * The minimums are functional, not aesthetic: below ~160px of height the header
 * plus a single log row no longer fit, and below ~280px of width a timestamp,
 * a level badge and any message at all cannot share a line. The maximums keep
 * the page the drawer is meant to be watched ALONGSIDE from disappearing —
 * a devtools panel that eats the app is a modal with extra steps.
 */
export const DIAG_HEIGHT_MIN = 160;
export const DIAG_HEIGHT_MAX_VH = 0.7;
export const DIAG_WIDTH_MIN = 280;
export const DIAG_WIDTH_MAX_VW = 0.6;

/**
 * Clamps a candidate size against `[min, fraction × viewport]`.
 *
 * The viewport is a PARAMETER with a lazy default rather than a `window` read
 * inside, so the rule is testable in the node environment (where there is no
 * window at all) without a jsdom boot. A viewport of 0 — no window, or a
 * hidden tab reporting nothing — means "enforce the minimum only": clamping to
 * 70% of zero would collapse a perfectly good persisted size to the floor on
 * the next hydrate.
 *
 * `Math.max(ceiling, min)` guards the genuinely small viewport where the
 * fraction lands BELOW the minimum; the floor wins there, and the panel simply
 * overflows a window nothing useful fits in anyway.
 */
function clampSize(value: number, min: number, fraction: number, viewport: number): number {
  if (!Number.isFinite(value)) return min;
  const ceiling = viewport > 0 ? Math.max(Math.round(viewport * fraction), min) : Infinity;
  return Math.min(Math.max(Math.round(value), min), ceiling);
}

function viewportHeight(): number {
  return typeof window === 'undefined' ? 0 : window.innerHeight;
}

function viewportWidth(): number {
  return typeof window === 'undefined' ? 0 : window.innerWidth;
}

/** Clamp for the top/bottom docks' height. */
export function clampDiagHeight(height: number, viewport = viewportHeight()): number {
  return clampSize(height, DIAG_HEIGHT_MIN, DIAG_HEIGHT_MAX_VH, viewport);
}

/** Clamp for the left/right docks' width. */
export function clampDiagWidth(width: number, viewport = viewportWidth()): number {
  return clampSize(width, DIAG_WIDTH_MIN, DIAG_WIDTH_MAX_VW, viewport);
}

interface LayoutState {
  /** Desktop sidebar collapsed to icons. Persisted — it is a work-style choice. */
  sidebarCollapsed: boolean;
  /** Mobile off-canvas nav. NOT persisted: an open drawer is never a preference. */
  mobileNavOpen: boolean;
  /** Command palette (Ctrl+K). Not persisted, same reason. */
  paletteOpen: boolean;

  /**
   * Diagnostics drawer (WP4.4). NOT persisted as OPEN — a reload should not
   * restore a devtools panel over the app — but the dock side and the two
   * per-axis sizes are genuine preferences and are.
   *
   * `diagHeight` and `diagWidth` are INDEPENDENT on purpose: bottom and top
   * docks resize a height, left and right a width, and flipping between them
   * should return each side to the size you last gave it rather than
   * reinterpreting one number as the other axis.
   */
  diagOpen: boolean;
  diagDock: DiagDock;
  diagHeight: number;
  diagWidth: number;

  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setMobileNavOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  setDiagOpen: (open: boolean) => void;
  toggleDiag: () => void;
  setDiagDock: (dock: DiagDock) => void;
  cycleDiagDock: () => void;
  setDiagHeight: (height: number) => void;
  setDiagWidth: (width: number) => void;
  /** Escape behaviour: closes every MODAL overlay. */
  closeAllOverlays: () => void;
}

/** Exactly what `partialize` writes — the shape `migrate` reads back. */
type PersistedLayout = Pick<
  LayoutState,
  'sidebarCollapsed' | 'diagDock' | 'diagHeight' | 'diagWidth'
>;

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      sidebarCollapsed: false,
      mobileNavOpen: false,
      paletteOpen: false,

      diagOpen: false,
      diagDock: 'bottom',
      diagHeight: DIAG_HEIGHT_DEFAULT,
      diagWidth: DIAG_WIDTH_DEFAULT,

      setSidebarCollapsed: (sidebarCollapsed) => {
        set({ sidebarCollapsed });
      },
      toggleSidebar: () => {
        set({ sidebarCollapsed: !get().sidebarCollapsed });
      },
      setMobileNavOpen: (mobileNavOpen) => {
        set({ mobileNavOpen });
      },
      setPaletteOpen: (paletteOpen) => {
        set({ paletteOpen });
      },
      togglePalette: () => {
        set({ paletteOpen: !get().paletteOpen });
      },

      setDiagOpen: (diagOpen) => {
        set({ diagOpen });
      },
      toggleDiag: () => {
        set({ diagOpen: !get().diagOpen });
      },
      setDiagDock: (diagDock) => {
        set({ diagDock });
      },
      cycleDiagDock: () => {
        const index = DIAG_DOCK_CYCLE.indexOf(get().diagDock);
        const next = DIAG_DOCK_CYCLE[(index + 1) % DIAG_DOCK_CYCLE.length];
        if (next) set({ diagDock: next });
      },
      // Clamped IN THE STORE, not at the drag handle: the same bounds have to
      // hold for a keyboard resize, a persisted value from a much larger
      // window, and a future preset — and a clamp that lives in one caller is a
      // clamp the next caller forgets.
      setDiagHeight: (height) => {
        set({ diagHeight: clampDiagHeight(height) });
      },
      setDiagWidth: (width) => {
        set({ diagWidth: clampDiagWidth(width) });
      },

      // `diagOpen` is deliberately NOT closed here: the diagnostics drawer is
      // NON-MODAL (devtools semantics), so a global Escape must not kill a live
      // log tail. It closes only via its own control or Ctrl+J.
      closeAllOverlays: () => {
        set({ paletteOpen: false, mobileNavOpen: false });
      },
    }),
    {
      name: LAYOUT_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: LAYOUT_STORAGE_VERSION,
      // Only genuine PREFERENCES persist. Transient open/closed state is
      // excluded on purpose: restoring a reload into an open palette, an open
      // mobile drawer or an open devtools panel is disorienting, not helpful.
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        diagDock: state.diagDock,
        diagHeight: state.diagHeight,
        diagWidth: state.diagWidth,
      }),
      // v0 → v1: drop the placeholder `diagTab`. Written as a whitelist rather
      // than a `delete`, so any future stray field a rolled-back build wrote is
      // also left behind instead of being merged into live state.
      migrate: (persisted, version) => {
        const stored = (persisted ?? {}) as Partial<PersistedLayout>;
        if (version >= LAYOUT_STORAGE_VERSION) return stored;
        return {
          sidebarCollapsed: stored.sidebarCollapsed,
          diagDock: stored.diagDock,
          diagHeight: stored.diagHeight,
          diagWidth: stored.diagWidth,
        };
      },
      // A size saved on a 4K monitor and restored on a laptop would otherwise
      // hydrate straight past the ceiling, because `partialize` writes the raw
      // field and hydration bypasses the setters that clamp.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.setDiagHeight(state.diagHeight);
        state.setDiagWidth(state.diagWidth);
      },
    },
  ),
);
