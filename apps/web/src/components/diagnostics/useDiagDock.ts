import { useLayoutStore, type DiagDock } from '@/stores/useLayoutStore';
import { useIsNarrowViewport } from '@/components/diagnostics/useIsNarrowViewport';

/**
 * The dock the drawer is ACTUALLY rendered on, which is not always the one the
 * user picked: below the `md` breakpoint every dock collapses to `bottom`.
 *
 * The stored preference is deliberately untouched by that collapse — the dock
 * menu keeps showing the chosen side, and widening the window restores it. A
 * narrow viewport is a temporary fact about the window, not a change of mind.
 *
 * Shared by the drawer (which paints itself) and by `AppShell` (which has to
 * run its flex axis the matching way), so the two can never disagree about
 * which edge is in play — a disagreement that shows up as a drawer laid out
 * along the wrong axis, not as an error.
 */
export function useEffectiveDiagDock(): DiagDock {
  const dock = useLayoutStore((state) => state.diagDock);
  return useIsNarrowViewport() ? 'bottom' : dock;
}
