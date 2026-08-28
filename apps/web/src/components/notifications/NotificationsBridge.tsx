import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { registerTopbarSlot } from '@/components/layout/TopbarSlots';
import { invalidateNotifications } from '@/hooks/useNotifications';
import NotificationBell from '@/components/notifications/NotificationBell';

/**
 * The headless mount point for the notification feature. Renders nothing.
 *
 * ═══ WHAT IT DOES ═════════════════════════════════════════════════════════
 *
 * 1. **Registers the bell into the topbar.** `Topbar.tsx` belongs to WP1.4 and
 *    four Wave-4 packages want a piece of it, so the topbar exposes a registry
 *    instead of children — see `TopbarSlots.tsx`. `order: 20` is the
 *    conventional slot for the bell (10 palette, 20 bell, 30 diagnostics).
 *    The effect returns `registerTopbarSlot`'s own unregister function, which
 *    is StrictMode- and HMR-safe by construction.
 *
 * 2. **Refreshes the badge when the tab comes back.** A tab left open overnight
 *    has a stale count and a socket that may have missed a push while the
 *    machine was asleep. `visibilitychange` + `focus` is the cheap, reliable
 *    catch-up: one tiny request when the user returns.
 *
 * ═══ WHY A COMPONENT AND NOT A MODULE SIDE EFFECT ═════════════════════════
 *
 * Registering at import time would put the bell in the topbar of the LOGIN page
 * too (the module graph is one bundle), and the bell's queries would fire
 * without a session. Mounting it inside the authed shell ties the feature's
 * lifetime to the session's.
 *
 * THE INTEGRATOR MOUNTS THIS — one line, anywhere inside the authed tree:
 *
 *     <NotificationsBridge />
 *
 * ═══ THE REALTIME SEAM ════════════════════════════════════════════════════
 *
 * Nothing here listens to a socket. WP4.1's realtime cache owns the
 * `notification:new` event and invalidates the `qk.notifications` prefix; both
 * the badge and every list live under it, so they update with no coupling
 * between the two packages. {@link invalidateNotifications} is exported for a
 * bridge that would rather call a function than spell a key.
 */
export function NotificationsBridge() {
  const queryClient = useQueryClient();

  useEffect(
    () =>
      registerTopbarSlot({
        id: 'notifications',
        zone: 'end',
        order: 20,
        render: () => <NotificationBell />,
      }),
    [],
  );

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') invalidateNotifications(queryClient);
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [queryClient]);

  return null;
}

export default NotificationsBridge;
