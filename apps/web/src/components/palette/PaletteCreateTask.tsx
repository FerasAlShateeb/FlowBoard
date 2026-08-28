import type { RouteScope } from '@/hooks/useRouteScope';
import { projectPath } from '@/hooks/useRouteScope';
import { useOrgBySlug } from '@/hooks/useOrgs';
import { useProjectByKey } from '@/hooks/useProjects';
import { usePaletteStore } from '@/stores/usePaletteStore';
import { TaskCreateDialog } from '@/components/tasks/TaskCreateDialog';

/**
 * The `c` / "Create task…" dialog, resolved for the project in the URL.
 *
 * ═══ WHY THIS ADAPTER EXISTS ═══════════════════════════════════════════════
 *
 * WP3.2's `TaskCreateDialog` takes IDs (`projectId`, `orgId`); the URL — and
 * therefore everything this package knows — carries a SLUG and a KEY. The two
 * lookups (`slug → org`, `key → project`) both resolve from lists the shell has
 * already fetched, so this costs no request on a project page.
 *
 * ═══ MOUNTED ONLY WHILE OPEN ═══════════════════════════════════════════════
 *
 * The caller renders this component only when `createTaskOpen` is true, and
 * that is deliberate rather than lazy. `TaskCreateDialog` fetches the project's
 * statuses, sprints and labels ON MOUNT, not on open — keeping it mounted for
 * the life of every project page would mean three requests per page for a
 * dialog most visits never open. The cost is that it disappears without its
 * close animation, which is the cheaper half of that trade.
 */
export interface PaletteCreateTaskProps {
  scope: RouteScope;
  /** Same injected navigation the palette uses. See `app-router.ts`. */
  navigate: (to: string) => void;
}

export default function PaletteCreateTask({ scope, navigate }: PaletteCreateTaskProps) {
  const open = usePaletteStore((state) => state.createTaskOpen);
  const setOpen = usePaletteStore((state) => state.setCreateTaskOpen);

  const { org } = useOrgBySlug(scope.orgSlug);
  const { project } = useProjectByKey(org?.id, scope.projectKey);

  const orgSlug = scope.orgSlug;
  // Nothing to create INTO yet: either the URL is not inside a project, or the
  // org/project lists are still in flight. The shortcut's own `enabled` gate
  // covers the first case; this covers the moment before the cache is warm.
  if (orgSlug === null || project === null) return null;

  return (
    <TaskCreateDialog
      open={open}
      onOpenChange={setOpen}
      projectId={project.id}
      orgId={org?.id ?? null}
      onCreated={(task) => {
        // Land on the new task's sheet. Someone who quick-created from a
        // keyboard chord almost always has something to add to it next.
        navigate(`${projectPath(orgSlug, project.key, 'board')}/t/${task.key}`);
      }}
    />
  );
}
