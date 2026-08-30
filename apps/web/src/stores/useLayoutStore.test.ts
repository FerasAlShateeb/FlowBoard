import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clampDiagHeight,
  clampDiagWidth,
  DIAG_DOCK_CYCLE,
  DIAG_HEIGHT_DEFAULT,
  DIAG_HEIGHT_MIN,
  DIAG_WIDTH_DEFAULT,
  DIAG_WIDTH_MIN,
  isSideDock,
  LAYOUT_STORAGE_KEY,
  useLayoutStore,
  type DiagDock,
} from '@/stores/useLayoutStore';

/**
 * The layout store's diagnostics half: the size clamps, the dock cycle, and the
 * one thing a devtools panel must NOT do — close on a global Escape.
 *
 * The clamps are asserted through the pure functions AND through the setters,
 * because the bug they exist to prevent (a drag or a rehydrate writing a size
 * that no viewport can show) is only prevented if the store, not the caller,
 * enforces them.
 */

const INITIAL = useLayoutStore.getState();

beforeEach(() => {
  useLayoutStore.setState({
    diagOpen: false,
    diagDock: 'bottom',
    diagHeight: DIAG_HEIGHT_DEFAULT,
    diagWidth: DIAG_WIDTH_DEFAULT,
    paletteOpen: false,
    mobileNavOpen: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useLayoutStore.setState(INITIAL);
});

describe('clampDiagHeight / clampDiagWidth', () => {
  it('keeps a sensible size untouched', () => {
    expect(clampDiagHeight(320, 1000)).toBe(320);
    expect(clampDiagWidth(420, 1600)).toBe(420);
  });

  it('enforces the floors', () => {
    expect(clampDiagHeight(40, 1000)).toBe(DIAG_HEIGHT_MIN);
    expect(clampDiagWidth(10, 1600)).toBe(DIAG_WIDTH_MIN);
  });

  it('enforces the viewport-relative ceilings (70vh / 60vw)', () => {
    expect(clampDiagHeight(99_999, 1000)).toBe(700);
    expect(clampDiagWidth(99_999, 1600)).toBe(960);
  });

  it('lets the floor win on a viewport too small for the ceiling', () => {
    // 70% of 200px is 140px — below the 160px minimum. The panel overflows a
    // window nothing useful fits in rather than collapsing to nothing.
    expect(clampDiagHeight(500, 200)).toBe(DIAG_HEIGHT_MIN);
  });

  it('enforces the floor only when there is no viewport to measure', () => {
    expect(clampDiagHeight(5_000, 0)).toBe(5_000);
    expect(clampDiagHeight(10, 0)).toBe(DIAG_HEIGHT_MIN);
  });

  it('answers the minimum for a non-finite candidate', () => {
    expect(clampDiagHeight(Number.NaN, 1000)).toBe(DIAG_HEIGHT_MIN);
    expect(clampDiagWidth(Number.POSITIVE_INFINITY, 1600)).toBe(DIAG_WIDTH_MIN);
  });

  it('rounds to whole pixels, so a drag cannot store 287.6', () => {
    expect(clampDiagHeight(287.6, 1000)).toBe(288);
  });
});

describe('setDiagHeight / setDiagWidth', () => {
  it('clamp inside the store, not at the call site', () => {
    vi.stubGlobal('window', { innerHeight: 1000, innerWidth: 1600 });

    useLayoutStore.getState().setDiagHeight(10_000);
    useLayoutStore.getState().setDiagWidth(1);

    expect(useLayoutStore.getState().diagHeight).toBe(700);
    expect(useLayoutStore.getState().diagWidth).toBe(DIAG_WIDTH_MIN);
  });

  it('keeps the two axes independent across a dock flip', () => {
    vi.stubGlobal('window', { innerHeight: 1000, innerWidth: 1600 });

    useLayoutStore.getState().setDiagHeight(340);
    useLayoutStore.getState().setDiagWidth(500);
    useLayoutStore.getState().setDiagDock('right');

    // Flipping to a side dock must not reinterpret the height as a width.
    expect(useLayoutStore.getState().diagHeight).toBe(340);
    expect(useLayoutStore.getState().diagWidth).toBe(500);
  });
});

describe('dock', () => {
  it('cycles bottom → right → left → top → bottom', () => {
    const seen: DiagDock[] = [];
    for (let step = 0; step < DIAG_DOCK_CYCLE.length + 1; step += 1) {
      seen.push(useLayoutStore.getState().diagDock);
      useLayoutStore.getState().cycleDiagDock();
    }
    expect(seen).toEqual(['bottom', 'right', 'left', 'top', 'bottom']);
  });

  it('names the two docks whose size is a width', () => {
    expect(isSideDock('left')).toBe(true);
    expect(isSideDock('right')).toBe(true);
    expect(isSideDock('top')).toBe(false);
    expect(isSideDock('bottom')).toBe(false);
  });
});

describe('open state', () => {
  it('toggles', () => {
    useLayoutStore.getState().toggleDiag();
    expect(useLayoutStore.getState().diagOpen).toBe(true);
    useLayoutStore.getState().toggleDiag();
    expect(useLayoutStore.getState().diagOpen).toBe(false);
  });

  it('survives closeAllOverlays — a global Escape must not kill a live tail', () => {
    useLayoutStore.setState({ diagOpen: true, paletteOpen: true, mobileNavOpen: true });

    useLayoutStore.getState().closeAllOverlays();

    expect(useLayoutStore.getState().diagOpen).toBe(true);
    expect(useLayoutStore.getState().paletteOpen).toBe(false);
    expect(useLayoutStore.getState().mobileNavOpen).toBe(false);
  });
});

/**
 * The Theme Studio drawer's flag (Round 2 §Theme D5). It is the OPPOSITE case
 * to `diagOpen` above: a modal panel, so Escape closes it — and an ephemeral
 * one, so a reload never restores it over the app.
 */
describe('themeStudioOpen', () => {
  it('starts closed and is set explicitly', () => {
    expect(useLayoutStore.getState().themeStudioOpen).toBe(false);

    useLayoutStore.getState().setThemeStudioOpen(true);
    expect(useLayoutStore.getState().themeStudioOpen).toBe(true);

    useLayoutStore.getState().setThemeStudioOpen(false);
    expect(useLayoutStore.getState().themeStudioOpen).toBe(false);
  });

  it('closes with every other MODAL overlay on closeAllOverlays', () => {
    useLayoutStore.setState({ themeStudioOpen: true, diagOpen: true });

    useLayoutStore.getState().closeAllOverlays();

    expect(useLayoutStore.getState().themeStudioOpen).toBe(false);
    // …and still not the non-modal devtools drawer.
    expect(useLayoutStore.getState().diagOpen).toBe(true);
  });

  it('is never persisted — an open modal is not a preference', () => {
    useLayoutStore.setState({ themeStudioOpen: true, sidebarCollapsed: true });

    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}';

    expect(JSON.parse(raw)).toMatchObject({ state: { sidebarCollapsed: true } });
    expect(raw).not.toContain('themeStudioOpen');
  });
});
