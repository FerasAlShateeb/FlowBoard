import { Suspense, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { cn } from '@/lib/utils';
import { useLayoutStore } from '@/stores/useLayoutStore';
import Sidebar from '@/components/layout/Sidebar';
import Topbar from '@/components/layout/Topbar';
import PageSpinner from '@/components/common/PageSpinner';
import RouteSkeleton, {
  isRouteViewChange,
  ROUTE_SKELETON_MS,
} from '@/components/common/RouteSkeleton';
import DiagnosticsDrawer from '@/components/diagnostics/DiagnosticsDrawer';
import { shellDirectionClass } from '@/components/diagnostics/diag-chrome';
import { useEffectiveDiagDock } from '@/components/diagnostics/useDiagDock';
import { RealtimeBridge } from '@/components/layout/RealtimeBridge';
import { NotificationsBridge } from '@/components/notifications';
import { TelemetryBridge } from '@/components/admin/TelemetryBridge';

/**
 * The authenticated app frame: navigation column, top bar, and the routed
 * content area.
 *
 * It is a LAYOUT ROUTE, so the sidebar and topbar are mounted once for the
 * whole session — switching between the board and the backlog re-renders only
 * the `<Outlet/>`, and the lazy chunk for the incoming view resolves inside the
 * Suspense boundary below rather than blanking the chrome.
 *
 * `h-dvh` + `overflow-hidden` on the root, with the scroll living on `<main>`:
 * that is what lets a Kanban board own its own horizontal scroll and a sticky
 * column header actually stick. A page that scrolls the document instead would
 * take the topbar with it.
 *
 * It also owns the only piece of motion in the frame: a short `RouteSkeleton`
 * held across a view change (Round 2, §Motion D6). That is chrome, not a page
 * concern — the shell is the one component that can see a navigation happen
 * while both the outgoing and the incoming view are strangers to each other.
 */
export default function AppShell() {
  const mobileNavOpen = useLayoutStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useLayoutStore((s) => s.setMobileNavOpen);
  const closeAllOverlays = useLayoutStore((s) => s.closeAllOverlays);

  // ── The route-change placeholder (Round 2, §Motion D6 entry 5) ─────────────
  // `changingView` is true for `ROUTE_SKELETON_MS` after a move from one VIEW
  // to another, and `RouteSkeleton` stands in for the outgoing page's content
  // for that window. See the render below for what it replaces, and
  // `components/common/RouteSkeleton.tsx` for why a view is not a pathname.
  const location = useLocation();
  const [changingView, setChangingView] = useState(false);
  const previousPathname = useRef<string | null>(null);

  // The shell's own flex axis follows the diagnostics dock: a ROW when the
  // drawer is docked to a side, a COLUMN when it is on the top or bottom. Read
  // unconditionally (the drawer may be closed, or the viewer may not be an
  // admin) so the axis is already correct on the frame the drawer opens.
  const diagDock = useEffectiveDiagDock();

  /*
    Hold the placeholder for a beat on a view change.

    THE PREVIOUS PATHNAME IS A REF, NOT A `firstRender` FLAG. A boolean that
    flips on its first run is wrong under `<StrictMode>`, which mounts, unmounts
    and remounts every effect in development: the second run would find the flag
    already cleared and flash a skeleton on the very first paint. Recording the
    pathname instead makes the effect IDEMPOTENT — a repeat run compares the
    path against itself, `isRouteViewChange` answers `false`, and nothing
    happens. The same property covers a re-render caused by anything other than
    navigation.

    `null` means "the shell has only just mounted", which is deliberately NOT a
    view change: there is no outgoing page to smooth over, and the lazy chunk's
    own `PageSpinner` already owns that moment.
  */
  useEffect(() => {
    const changed = isRouteViewChange(previousPathname.current, location.pathname);
    previousPathname.current = location.pathname;
    if (!changed) return;

    setChangingView(true);
    const timer = window.setTimeout(() => {
      setChangingView(false);
    }, ROUTE_SKELETON_MS);
    return () => {
      // A second navigation inside the window restarts the timer rather than
      // letting the first one cut the second view's placeholder short.
      window.clearTimeout(timer);
    };
  }, [location.pathname]);

  // Escape closes the transient overlays. Registered once for the shell's whole
  // life — the store is read through `getState()` inside the handler rather
  // than captured, so the listener never needs re-binding.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') useLayoutStore.getState().closeAllOverlays();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closeAllOverlays]);

  // Lock the document while the mobile drawer is open, so a touch-scroll drags
  // the drawer's own list instead of the page behind it.
  useEffect(() => {
    document.body.style.overflow = mobileNavOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileNavOpen]);

  return (
    <div
      className={cn(
        'flex h-dvh overflow-hidden bg-background text-foreground',
        shellDirectionClass(diagDock),
      )}
    >
      {/*
        THE DIAGNOSTICS DRAWER (WP4.4) — a push-content devtools panel, NOT an
        overlay. Mounted here ONCE and unconditionally: it renders null when
        closed or when the viewer is not a global admin, and places itself with
        `order-first`/`order-last` (RTL-compensated — see `isDrawerFirst`).
        Keeping the single mount point is what lets a dock switch reflow WITHOUT
        remounting, which is what keeps its 2 s log poll alive across a redock.
        It also owns the Ctrl+J / Ctrl+Shift+J registrations, which is why it
        must stay in the tree even while closed.
      */}
      <DiagnosticsDrawer />

      {/*
        THE WAVE-4 HEADLESS BRIDGES. All three render null; each exists only so
        a hook has a lifecycle, and each is mounted HERE — once, inside the
        authed shell, ABOVE the project routes — for the same reason:

        * `<RealtimeBridge/>` keeps ONE socket subscription aligned with the
          project in the URL. Mounted on a page it would tear the connection
          down and rebuild it on every board → backlog navigation; up here the
          route change is just a room swap. It reads the project from
          `useRouteScope()` precisely because `useParams()` is empty at this
          depth.
        * `<NotificationsBridge/>` registers the bell and refreshes the badge on
          tab focus. Its lifetime must be the SESSION's, which is what mounting
          it inside the authed shell (and not at module scope) buys — the login
          page gets no bell and fires no unauthenticated queries.
        * `<TelemetryBridge/>` starts the client emitters. THIS IS ITS ONLY
          MOUNT: `main.tsx` deliberately does NOT also call
          `initTelemetryClient()`, because two initialisations would double
          every `page_view` row and quietly halve every per-user figure on the
          admin dashboards.

        They sit above `<Sidebar/>` rather than inside the content column so a
        Suspense fallback on a lazy page cannot suspend them along with it.
      */}
      <RealtimeBridge />
      <NotificationsBridge />
      <TelemetryBridge />

      <div className="flex min-h-0 min-w-0 flex-1">
        <Sidebar />

        {/* Mobile scrim. `md:hidden` because the desktop sidebar is a real
            column, not an overlay, and needs no dismiss surface. */}
        {mobileNavOpen ? (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            data-testid="mobile-scrim"
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => {
              setMobileNavOpen(false);
            }}
          />
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[var(--content-max)] p-[var(--page-pad)]">
              {/*
                THE SUSPENSE CONTRACT IS UNCHANGED: `PageSpinner` is still the
                fallback for every lazy route chunk, and it is still the only
                thing that appears on a cold navigation. The route placeholder
                is a SEPARATE state layered inside the same boundary — it
                replaces the outlet's content for `ROUTE_SKELETON_MS` after a
                view change and then hands the slot back.

                Swapping the whole `<Outlet/>` (rather than hiding it) is what
                keeps this honest: a page rendered inside a `display:none`
                wrapper would measure itself at zero width, and the board's
                virtualiser and the Gantt both size themselves off that
                measurement. The cost is that the incoming chunk's request is
                deferred by the length of the placeholder — acceptable because
                the two states are the same message ("a page is coming") and
                because every view has been visited, and therefore cached, by
                the time a user is navigating quickly enough to notice.
              */}
              <Suspense fallback={<PageSpinner />}>
                {changingView ? <RouteSkeleton /> : <Outlet />}
              </Suspense>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
