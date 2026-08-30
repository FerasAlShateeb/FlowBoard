// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ServerLogRecord } from '@flowboard/shared';

import '@/i18n';
import {
  clearShortcutsForTest,
  installGlobalShortcutListener,
  useShortcuts,
} from '@/lib/shortcuts';
import { useAuthStore } from '@/stores/useAuthStore';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TopbarSlotZone, __resetTopbarSlotsForTests } from '@/components/layout/TopbarSlots';
import { useLayoutStore } from '@/stores/useLayoutStore';
import { useDiagLogsStore, __resetDiagPollStateForTests } from '@/stores/useDiagLogsStore';
import DiagnosticsDrawer from '@/components/diagnostics/DiagnosticsDrawer';

/**
 * The drawer's rendered contract: who sees it, what it paints, and what its
 * seven controls do. The pure rules underneath (filtering, ordering, the RTL
 * dock math, JSONL) are asserted without a DOM in `diag-chrome.test.ts`; this
 * suite is about the wiring.
 *
 * The API client is mocked so mounting the drawer starts a poll loop that
 * resolves to "nothing new" instead of reaching the network. Its `lastId` is
 * deliberately HUGE: a snapshot whose head sat below the seeded cursor would
 * (correctly) be read as an API restart and wipe the fixtures mid-test.
 */
vi.mock('@/lib/api', async (importOriginal) => ({
  // Partial: `i18n/errors` (reached through `hooks/useAuth`) imports the error
  // codes from this module, so replacing it wholesale breaks the import graph.
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: { get: vi.fn().mockResolvedValue({ records: [], lastId: 1_000_000 }) },
}));

// ───────────────────────────────────────────────────────────────────────────
// jsdom gaps Radix depends on
// ───────────────────────────────────────────────────────────────────────────

class ResizeObserverStub implements ResizeObserver {
  observe(): void {
    /* nothing is measured in these assertions */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
}

const globals = globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserver };
globals.ResizeObserver ??= ResizeObserverStub;
Element.prototype.scrollIntoView ??= function scrollIntoView(): void {
  /* no-op */
};
Element.prototype.hasPointerCapture ??= function hasPointerCapture(): boolean {
  return false;
};
Element.prototype.setPointerCapture ??= function setPointerCapture(): void {
  /* no-op */
};
Element.prototype.releasePointerCapture ??= function releasePointerCapture(): void {
  /* no-op */
};

// ───────────────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────────────

const RECORDS: ServerLogRecord[] = [
  {
    id: 1,
    time: new Date(2026, 4, 2, 14, 30, 5, 250).getTime(),
    level: 'info',
    msg: 'request completed',
    context: { userId: 'u-1', method: 'GET' },
  },
  { id: 2, time: Date.now(), level: 'debug', msg: 'cache miss', context: {} },
  {
    id: 3,
    time: Date.now(),
    level: 'error',
    msg: 'transaction rolled back',
    context: { taskId: 't-9' },
  },
];

function seedRecords(records: ServerLogRecord[] = RECORDS): void {
  useDiagLogsStore.setState({ records, lastId: records[records.length - 1]?.id ?? 0 });
}

/**
 * Signs in a global admin (or a plain member) via the persisted session.
 *
 * `viewingAsMember` goes through the store's own setter rather than `setState`,
 * because it also persists `fb-view-mode-v1` — the posture is a separate key
 * from the session, and the drawer's gate reads the live store value.
 */
function signIn({
  isGlobalAdmin,
  viewingAsMember = false,
}: {
  isGlobalAdmin: boolean;
  viewingAsMember?: boolean;
}): void {
  useAuthStore.setState({
    user: {
      id: '88888888-8888-4888-8888-888888888888',
      email: 'ada@flowboard.dev',
      name: 'Ada Lovelace',
      avatarUrl: null,
      isGlobalAdmin,
      locale: 'en',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  });
  useAuthStore.getState().setViewingAsMember(viewingAsMember);
}

function renderDrawer(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {/* The trigger is a `Tooltip`, which the shell provides for; rendering
            the slot zone here means this suite has to as well. */}
        <TooltipProvider>
          {children}
          {/* The drawer registers its topbar button through the slot registry,
              so a zone has to be on screen for that half of the gate to be
              assertable at all. */}
          <TopbarSlotZone zone="end" />
        </TooltipProvider>
      </QueryClientProvider>
    );
  }
  render(<DiagnosticsDrawer />, { wrapper: Wrapper });
}

/**
 * An open drawer for a signed-in global admin, with the fixtures loaded.
 * The dock is whatever the test set beforehand (`beforeEach` resets it).
 */
function renderOpenForAdmin(): void {
  signIn({ isGlobalAdmin: true });
  useLayoutStore.setState({ diagOpen: true });
  seedRecords();
  renderDrawer();
}

beforeEach(() => {
  clearShortcutsForTest();
  __resetDiagPollStateForTests();
  __resetTopbarSlotsForTests();
  useLayoutStore.setState({ diagOpen: false, diagDock: 'bottom', diagHeight: 288, diagWidth: 380 });
  useAuthStore.setState({ user: null });
  useAuthStore.getState().setViewingAsMember(false);
});

afterEach(() => {
  cleanup();
  clearShortcutsForTest();
  __resetDiagPollStateForTests();
  __resetTopbarSlotsForTests();
  useAuthStore.getState().setViewingAsMember(false);
  vi.unstubAllGlobals();
});

// ───────────────────────────────────────────────────────────────────────────

describe('DiagnosticsDrawer gating', () => {
  it('renders nothing, and registers no chords, for a non-admin', () => {
    signIn({ isGlobalAdmin: false });
    useLayoutStore.setState({ diagOpen: true });

    renderDrawer();

    expect(screen.queryByTestId('fb-diag-drawer')).not.toBeInTheDocument();
    // Ctrl+J keeps its browser meaning for everyone the drawer would refuse.
    expect(registeredIds()).toEqual([]);
  });

  it('renders nothing when closed, but keeps its chords registered', () => {
    signIn({ isGlobalAdmin: true });

    renderDrawer();

    expect(screen.queryByTestId('fb-diag-drawer')).not.toBeInTheDocument();
    expect(registeredIds()).toEqual(['diagnostics.toggle', 'diagnostics.cycleDock']);
  });

  it('opens for a global admin', () => {
    renderOpenForAdmin();

    const drawer = screen.getByTestId('fb-diag-drawer');
    expect(drawer).toBeInTheDocument();
    expect(drawer).toHaveAttribute('data-dock', 'bottom');
    expect(drawer).toHaveAccessibleName('Diagnostics');
  });

  it('registers the topbar trigger for a global admin, and none for a member', () => {
    renderOpenForAdmin();
    expect(screen.getByTestId('fb-diag-trigger')).toBeInTheDocument();

    cleanup();
    __resetTopbarSlotsForTests();
    signIn({ isGlobalAdmin: false });
    useLayoutStore.setState({ diagOpen: true });
    renderDrawer();

    expect(screen.queryByTestId('fb-diag-trigger')).not.toBeInTheDocument();
  });

  /**
   * VIEW-AS-MEMBER IS A CHROME GATE (R2 W3.5).
   *
   * admin.md §4.1: every chrome surface reads `isEffectiveGlobalAdmin()`, and
   * only the switch itself reads the real flag. The drawer read the REAL one, so
   * an admin previewing member view kept a topbar button no member has, kept
   * Ctrl+J bound away from the browser, and kept a live server-log tail docked
   * beside the board they were previewing — the one thing the preview exists to
   * make impossible to see. All three halves of the gate are asserted, because
   * they are three separate `isGlobalAdmin` reads in the component.
   */
  it('renders nothing, registers no chords and offers no trigger while an admin previews member view', () => {
    signIn({ isGlobalAdmin: true, viewingAsMember: true });
    useLayoutStore.setState({ diagOpen: true });
    seedRecords();

    renderDrawer();

    expect(screen.queryByTestId('fb-diag-drawer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fb-diag-trigger')).not.toBeInTheDocument();
    expect(registeredIds()).toEqual([]);
  });

  it('comes back the moment the admin returns to admin view', () => {
    signIn({ isGlobalAdmin: true, viewingAsMember: true });
    useLayoutStore.setState({ diagOpen: true });
    seedRecords();
    renderDrawer();
    expect(screen.queryByTestId('fb-diag-drawer')).not.toBeInTheDocument();

    act(() => {
      useAuthStore.getState().setViewingAsMember(false);
    });

    expect(screen.getByTestId('fb-diag-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('fb-diag-trigger')).toBeInTheDocument();
    expect(registeredIds()).toEqual(['diagnostics.toggle', 'diagnostics.cycleDock']);
  });
});

describe('DiagnosticsDrawer chrome', () => {
  it('exposes every control under a stable testid', () => {
    renderOpenForAdmin();

    for (const testid of [
      'fb-diag-drawer',
      'fb-diag-resize',
      'fb-diag-level',
      'fb-diag-pause',
      'fb-diag-clear',
      'fb-diag-copy',
      'fb-diag-dock-cycle',
      'fb-diag-close',
      'fb-diag-list',
    ]) {
      expect(screen.getByTestId(testid), testid).toBeInTheDocument();
    }
  });

  it('gives the resize grip separator semantics on the right axis', () => {
    renderOpenForAdmin();

    const handle = screen.getByTestId('fb-diag-resize');
    expect(handle).toHaveAttribute('role', 'separator');
    expect(handle).toHaveAttribute('aria-orientation', 'horizontal');

    cleanup();
    useLayoutStore.setState({ diagDock: 'right' });
    renderOpenForAdmin();
    expect(screen.getByTestId('fb-diag-resize')).toHaveAttribute('aria-orientation', 'vertical');
  });

  it('places a physical-right dock LAST in the shell order, in LTR', () => {
    useLayoutStore.setState({ diagDock: 'right' });
    renderOpenForAdmin();

    const drawer = screen.getByTestId('fb-diag-drawer');
    expect(drawer.className).toContain('order-last');
    expect(drawer.className).toContain('border-l');
  });

  it('forces a bottom dock on a narrow viewport without touching the preference', () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: true,
          media: query,
          onchange: null,
          addListener: () => undefined,
          removeListener: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
    useLayoutStore.setState({ diagDock: 'left' });
    renderOpenForAdmin();

    expect(screen.getByTestId('fb-diag-drawer')).toHaveAttribute('data-dock', 'bottom');
    // The chosen side is remembered for when the window widens again.
    expect(useLayoutStore.getState().diagDock).toBe('left');
  });
});

describe('DiagnosticsDrawer rows', () => {
  it('paints one row per record, with local time, level and message', () => {
    renderOpenForAdmin();

    const rows = screen.getAllByTestId('fb-diag-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAttribute('data-level', 'info');
    expect(within(rows[0] as HTMLElement).getByTestId('fb-diag-row-time')).toHaveTextContent(
      '14:30:05.250',
    );
    expect(rows[0]).toHaveTextContent('request completed');
  });

  it('chips only the allowlisted context keys and folds the rest away', () => {
    renderOpenForAdmin();

    const rows = screen.getAllByTestId('fb-diag-row');
    const first = rows[0] as HTMLElement;
    expect(within(first).getByTestId('fb-diag-chip')).toHaveTextContent('userId:u-1');
    // `method` is real context but not an id you scan with — expander only.
    expect(within(first).queryByText(/method:GET/u)).not.toBeInTheDocument();
    expect(within(first).getByTestId('fb-diag-context')).toHaveTextContent('"method": "GET"');

    // A record with no context gets no expander at all.
    expect(within(rows[1] as HTMLElement).queryByTestId('fb-diag-context')).not.toBeInTheDocument();
  });

  it('shows the empty state, and the paused hint instead when paused', () => {
    useDiagLogsStore.setState({ records: [] });
    signIn({ isGlobalAdmin: true });
    useLayoutStore.setState({ diagOpen: true });
    renderDrawer();

    expect(screen.getByTestId('fb-diag-empty')).toHaveTextContent(/No log lines yet/u);

    cleanup();
    useDiagLogsStore.setState({ paused: true });
    renderDrawer();
    expect(screen.getByTestId('fb-diag-empty')).toHaveTextContent(/Paused/u);
  });

  it('shows the failure message when the feed is unavailable', () => {
    useDiagLogsStore.setState({ records: [], error: 'Logs unavailable — the request failed.' });
    signIn({ isGlobalAdmin: true });
    useLayoutStore.setState({ diagOpen: true });
    renderDrawer();

    expect(screen.getByTestId('fb-diag-error')).toBeInTheDocument();
  });
});

describe('DiagnosticsDrawer controls', () => {
  it('filters the visible rows by MINIMUM level', async () => {
    const user = userEvent.setup();
    renderOpenForAdmin();

    await user.click(screen.getByTestId('fb-diag-level'));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Errors and above' }));

    expect(useDiagLogsStore.getState().minLevel).toBe('error');
    const rows = screen.getAllByTestId('fb-diag-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute('data-level', 'error');
    // Filtering is a VIEW concern — nothing was thrown away.
    expect(useDiagLogsStore.getState().records).toHaveLength(3);
  });

  it('copies the filtered records as JSON lines', async () => {
    const user = userEvent.setup();
    // AFTER `setup()`: user-event installs a clipboard stub of its own on the
    // navigator, and would otherwise replace this one.
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    renderOpenForAdmin();
    useDiagLogsStore.setState({ minLevel: 'error' });

    await user.click(screen.getByTestId('fb-diag-copy'));

    expect(writeText).toHaveBeenCalledTimes(1);
    const payload = writeText.mock.calls[0]?.[0] as string;
    expect(payload.split('\n')).toHaveLength(1);
    expect(JSON.parse(payload)).toMatchObject({ id: 3, level: 'error' });
  });

  it('pauses and resumes the tail, and says which it is doing', async () => {
    const user = userEvent.setup();
    renderOpenForAdmin();

    await user.click(screen.getByRole('button', { name: 'Pause the log tail' }));
    expect(useDiagLogsStore.getState().paused).toBe(true);
    expect(screen.getByTestId('fb-diag-paused')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Resume the log tail' }));
    expect(useDiagLogsStore.getState().paused).toBe(false);
  });

  it('clears the view', async () => {
    const user = userEvent.setup();
    renderOpenForAdmin();

    await user.click(screen.getByTestId('fb-diag-clear'));

    expect(screen.queryAllByTestId('fb-diag-row')).toHaveLength(0);
  });

  it('cycles the dock from the header button', async () => {
    const user = userEvent.setup();
    renderOpenForAdmin();

    await user.click(screen.getByTestId('fb-diag-dock-cycle'));

    expect(useLayoutStore.getState().diagDock).toBe('right');
    expect(screen.getByTestId('fb-diag-drawer')).toHaveAttribute('data-dock', 'right');
  });

  it('closes from the X', async () => {
    const user = userEvent.setup();
    renderOpenForAdmin();

    await user.click(screen.getByTestId('fb-diag-close'));

    expect(useLayoutStore.getState().diagOpen).toBe(false);
    expect(screen.queryByTestId('fb-diag-drawer')).not.toBeInTheDocument();
  });

  it('closes on Escape from INSIDE the panel only', async () => {
    const user = userEvent.setup();
    renderOpenForAdmin();

    // From outside: the drawer is non-modal, so a global Escape must not kill
    // a running tail.
    await user.keyboard('{Escape}');
    expect(useLayoutStore.getState().diagOpen).toBe(true);

    screen.getByTestId('fb-diag-close').focus();
    await user.keyboard('{Escape}');
    expect(useLayoutStore.getState().diagOpen).toBe(false);
  });
});

describe('DiagnosticsDrawer shortcuts', () => {
  /**
   * PINS THE PAIR, NOT A WORKAROUND.
   *
   * This assertion was originally load-bearing: `matchChord` used to skip its
   * Shift check whenever the pressed character equalled the chord's key, so
   * `mod+shift+j` ALSO matched a bare Ctrl+J, and only "first match wins" plus
   * this order kept the toggle reachable. WP4.7 fixed the matcher — Shift is
   * now enforced both ways for an alphanumeric key — and
   * `lib/shortcuts.test.ts` proves the two chords separate regardless of which
   * is registered first.
   *
   * The order is kept and still asserted, for two reasons that survive the fix:
   * the cheat sheet lists chords in registration order and reads better with
   * the toggle above the dock cycle, and this is the suite that would notice a
   * third diagnostics chord appearing, disappearing, or landing in the wrong
   * group.
   */
  it('registers exactly its two chords, toggle first', () => {
    signIn({ isGlobalAdmin: true });
    renderDrawer();

    const shortcuts = registeredShortcuts();
    expect(shortcuts.map((s) => `${s.id}:${s.chord}`)).toEqual([
      'diagnostics.toggle:mod+j',
      'diagnostics.cycleDock:mod+shift+j',
    ]);
    expect(shortcuts.every((s) => s.group === 'system')).toBe(true);
    expect(shortcuts[0]?.descriptionKey).toBe('diagnostics:shortcuts.toggle');
  });

  it('Ctrl+J toggles the drawer for an admin', async () => {
    signIn({ isGlobalAdmin: true });
    renderDrawer();
    const uninstall = installGlobalShortcutListener();

    await pressCtrl('j', {});
    expect(useLayoutStore.getState().diagOpen).toBe(true);
    await pressCtrl('j', {});
    expect(useLayoutStore.getState().diagOpen).toBe(false);

    uninstall();
  });

  it('Ctrl+Shift+J cycles the dock and opens a closed drawer', async () => {
    signIn({ isGlobalAdmin: true });
    renderDrawer();
    const uninstall = installGlobalShortcutListener();

    await pressCtrl('j', { shiftKey: true });

    expect(useLayoutStore.getState().diagDock).toBe('right');
    expect(useLayoutStore.getState().diagOpen).toBe(true);

    uninstall();
  });

  it('does nothing for a non-admin', async () => {
    signIn({ isGlobalAdmin: false });
    renderDrawer();
    const uninstall = installGlobalShortcutListener();

    await pressCtrl('j', {});

    expect(useLayoutStore.getState().diagOpen).toBe(false);
    uninstall();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

/** Dispatches a real `keydown`, which is what the global listener hears. */
async function pressCtrl(key: string, init: KeyboardEventInit): Promise<void> {
  const { act } = await import('@testing-library/react');
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, ...init }));
  });
}

/** The live registry, read the way the cheat sheet reads it. */
function registeredShortcuts(): ReturnType<typeof useShortcuts> {
  let snapshot: ReturnType<typeof useShortcuts> = [];
  function Probe() {
    snapshot = useShortcuts();
    return null;
  }
  const view = render(<Probe />);
  view.unmount();
  return snapshot;
}

function registeredIds(): string[] {
  return registeredShortcuts().map((shortcut) => shortcut.id);
}
