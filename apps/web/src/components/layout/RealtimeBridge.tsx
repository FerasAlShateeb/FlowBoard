import { useEffect } from 'react';

import { useProjectRealtime } from '@/hooks/useRealtime';
import { useOrgBySlug } from '@/hooks/useOrgs';
import { useProjectByKey } from '@/hooks/useProjects';
import { useRouteScope } from '@/hooks/useRouteScope';
import { registerTopbarSlot } from '@/components/layout/TopbarSlots';
import { PresenceAvatars } from '@/components/layout/PresenceAvatars';

/**
 * THE HEADLESS REALTIME MOUNT — the one thing the integrator has to add to the
 * app tree.
 *
 * Renders nothing. Its whole job is to be a component so that a hook has a
 * lifecycle to hang off: it resolves the project from the URL, keeps the socket
 * subscription aligned with it, and registers the presence stack into the
 * topbar.
 *
 * ═══ WHY IT RESOLVES THE PROJECT FROM `useRouteScope` ══════════════════════
 *
 * This component is designed to be mounted in `AppShell` — ABOVE the project
 * routes — so that one instance covers every view and the socket is not torn
 * down and rebuilt when the user moves from the board to the backlog.
 * `useParams()` is scoped to the closest matched route and returns `{}` up
 * there, so the project comes from `useRouteScope()` (`useMatch` against the
 * full location) plus the two lookups that turn a slug and a key into ids.
 * Those lookups are the same cached queries every project page already runs, so
 * they cost nothing extra.
 *
 * `projectId` is null on `/notifications`, `/me`, `/admin/*` and every org-level
 * page. That is not a degraded mode: the CONNECTION is still open there (the
 * notification bell needs `user:{id}` everywhere), only the project ROOM is not
 * joined.
 *
 * ═══ WHY THE PRESENCE SLOT IS REGISTERED HERE ══════════════════════════════
 *
 * `Topbar.tsx` belongs to WP1.4 and is closed. `TopbarSlots` is the extension
 * point it left behind, and registering from inside this component's effect —
 * rather than at module scope — is what makes the avatars appear only while a
 * project is open and disappear on the way out, with no conditional inside the
 * topbar itself. Order 15 puts presence before the notification bell (20) and
 * after the command palette (10).
 */
export function RealtimeBridge() {
  const { orgSlug, projectKey } = useRouteScope();
  const { org } = useOrgBySlug(orgSlug);
  const { project } = useProjectByKey(org?.id, projectKey ?? '');
  const projectId = project?.id ?? null;

  useProjectRealtime(projectId);

  useEffect(() => {
    if (projectId === null) return;
    // `registerTopbarSlot` returns its own unregister function, so it IS the
    // effect's cleanup — and it is guarded against StrictMode's double-invoke.
    return registerTopbarSlot({
      id: 'presence',
      zone: 'end',
      order: 15,
      render: () => <PresenceAvatars projectId={projectId} />,
    });
  }, [projectId]);

  return null;
}

export default RealtimeBridge;
