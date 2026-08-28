import { router } from '@/routes';

/**
 * The palette's link to the router — WITHOUT router context.
 *
 * ═══ THE CONSTRAINT ════════════════════════════════════════════════════════
 *
 * `main.tsx` renders `<AppProviders><RouterProvider/></AppProviders>`. The
 * providers are therefore ABOVE the router, and anything mounted beside
 * `{children}` in `AppProviders` is outside router context: `useNavigate()`,
 * `useLocation()` and `useRouteScope()` all throw there ("useNavigate() may be
 * used only in the context of a <Router>").
 *
 * The palette has to live there anyway. The alternatives were all worse:
 *   - `AppShell.tsx` is inside the router, and is WP4.4's file this wave.
 *   - `routes/index.tsx` is declared FINAL by WP1.4 and shared by five agents.
 *   - Rendering the whole palette out of a `TopbarSlots` registration would put
 *     a modal inside the topbar's flex row, against that registry's documented
 *     contract ("keep it to an icon button sized `size-7`").
 *
 * ═══ THE ANSWER ════════════════════════════════════════════════════════════
 *
 * A data router is an OBJECT, not only a context. `createBrowserRouter` returns
 * one with `navigate()`, a `state` and a `subscribe()` — the same object the
 * `RouterProvider` below is rendering. Reading location from it and pushing
 * navigations into it is not a workaround; it is the API the context is a
 * convenience over. The React binding is `useSyncExternalStore`, which is
 * exactly what `RouterProvider` itself does internally.
 *
 * This module is the ONLY place that imports the router singleton, so the
 * palette's components stay testable with a `vi.fn()` navigate and a plain
 * pathname string.
 */

/** Push an in-app navigation. Fire-and-forget: nothing awaits a route change. */
export function navigateApp(to: string): void {
  void router.navigate(to);
}

/** `useSyncExternalStore` subscribe: fires on every router state change. */
export function subscribeToLocation(onChange: () => void): () => void {
  return router.subscribe(() => {
    onChange();
  });
}

/**
 * `useSyncExternalStore` snapshot. A STRING, deliberately — the store contract
 * requires a referentially stable value between changes, and the location
 * object is a fresh identity on every navigation.
 */
export function currentPathname(): string {
  return router.state.location.pathname;
}
