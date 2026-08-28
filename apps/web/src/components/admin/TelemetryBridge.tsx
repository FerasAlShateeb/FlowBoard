import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { reportPageView } from '@/lib/telemetry-client';

/**
 * The headless page-view emitter. Renders nothing.
 *
 * ── WHAT THE INTEGRATOR MOUNTS ──────────────────────────────────────────────
 * One `<TelemetryBridge />`, anywhere INSIDE the router — `AppShell` is the
 * natural home, since every authenticated route renders through it. There is
 * exactly one alternative, `initTelemetryClient(router)` in `main.tsx` for a
 * composition root that holds the router object instead of a React tree.
 *
 * **Pick one.** Both subscribe to the same navigations and both funnel into the
 * same debounced reporter, so mounting both would double every page view — the
 * dedupe in `reportPageView` only catches a repeat of the SAME path, not two
 * observers of one navigation.
 *
 * ── WHY IT IS A COMPONENT AND NOT A HOOK CALL IN `AppShell` ─────────────────
 * So that mounting it is a one-line, reversible decision made by the file that
 * owns the layout, and so that the layout does not grow an effect belonging to
 * a feature it otherwise knows nothing about. It also means the subscription's
 * lifetime is a mount, which React can reason about, rather than a module-level
 * side effect that survives a hot reload.
 *
 * ── WHY IT LIVES UNDER `components/admin` ───────────────────────────────────
 * It is not admin UI; it is the emitter that fills the admin dashboards. It
 * ships with them because they are one feature and one work package, and
 * splitting the producer from the only consumer of its data across two folders
 * would hide the relationship.
 */
export function TelemetryBridge() {
  const { pathname } = useLocation();

  useEffect(() => {
    // `reportPageView` debounces and drops repeats, so a redirect chain and a
    // StrictMode double-invoke both collapse to one event.
    reportPageView(pathname);
  }, [pathname]);

  return null;
}

export default TelemetryBridge;
