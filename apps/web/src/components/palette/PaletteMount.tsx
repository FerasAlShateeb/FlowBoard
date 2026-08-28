import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { useAuthStore } from '@/stores/useAuthStore';
import { useLayoutStore } from '@/stores/useLayoutStore';
import { usePaletteStore } from '@/stores/usePaletteStore';
import { registerTopbarSlot } from '@/components/layout/TopbarSlots';
import { currentPathname, navigateApp, subscribeToLocation } from '@/components/palette/app-router';
import { scopeFromPathname } from '@/components/palette/palette-items';
import CommandPalette from '@/components/palette/CommandPalette';
import GlobalShortcuts from '@/components/palette/GlobalShortcuts';
import PaletteCreateTask from '@/components/palette/PaletteCreateTask';
import PaletteTrigger from '@/components/palette/PaletteTrigger';
import ShortcutsCheatSheet from '@/components/palette/ShortcutsCheatSheet';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The one thing `AppProviders` mounts for this package.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * It is a single component rather than three, because all three need the same
 * two facts — where the user is, and whether there is a session — and deriving
 * them once is the difference between one router subscription and three.
 *
 * ═══ WHY IT IS ABOVE THE ROUTER, AND HOW IT SURVIVES THAT ══════════════════
 *
 * `main.tsx` renders `<AppProviders><RouterProvider/></AppProviders>`, so
 * everything here is OUTSIDE router context and `useNavigate`/`useMatch` would
 * throw. The location is read from the router OBJECT instead
 * (`app-router.ts`), through `useSyncExternalStore` — the same binding
 * `RouterProvider` uses internally — and turned into a scope by a pure
 * `matchPath` call. Query context and i18n are both available here, which is
 * everything else the palette needs.
 *
 * The alternative mounts were all worse; see `app-router.ts` for the list.
 *
 * ═══ SIGNED OUT ════════════════════════════════════════════════════════════
 *
 * The three surfaces do not render without a session — the login screen has
 * nothing to search, navigate to, or create — but `GlobalShortcuts` still
 * mounts, because it owns the app's single keydown listener and other packages
 * register chords against it.
 */
export default function PaletteMount() {
  const pathname = useSyncExternalStore(subscribeToLocation, currentPathname, currentPathname);
  const scope = useMemo(() => scopeFromPathname(pathname), [pathname]);

  // The TOKEN, not `/auth/me`: this decides whether to mount UI, and a query
  // that is still resolving would flicker the topbar button on every boot.
  const signedIn = useAuthStore((state) => state.accessToken !== null);

  const paletteOpen = usePaletteStore((state) => state.open);
  const createTaskOpen = usePaletteStore((state) => state.createTaskOpen);

  /**
   * One-way mirror into the chrome store.
   *
   * `useLayoutStore.paletteOpen` predates this package (Wave 1 reserved it) and
   * other code asks it "is a modal overlay up?". The palette's own state lives
   * in `usePaletteStore` — it has a needle and a mode, which a bare boolean
   * cannot hold — so this keeps the older flag honest without making it an
   * authority. WRITE ONLY: reading it back would be a loop, and
   * `closeAllOverlays()` therefore does not close the palette (Escape does,
   * through Radix). Reported as a wave gap.
   */
  useEffect(() => {
    useLayoutStore.getState().setPaletteOpen(paletteOpen);
  }, [paletteOpen]);

  // The topbar button. Registered from an effect (not at module scope) so it
  // disappears with the session, and unregistered by the returned function.
  useEffect(() => {
    if (!signedIn) return;
    return registerTopbarSlot({
      id: 'palette-trigger',
      zone: 'end',
      order: 10,
      render: () => <PaletteTrigger />,
    });
  }, [signedIn]);

  return (
    <>
      <GlobalShortcuts scope={scope} signedIn={signedIn} />
      {signedIn ? (
        <>
          <CommandPalette scope={scope} navigate={navigateApp} />
          <ShortcutsCheatSheet />
          {createTaskOpen ? <PaletteCreateTask scope={scope} navigate={navigateApp} /> : null}
        </>
      ) : null}
    </>
  );
}
