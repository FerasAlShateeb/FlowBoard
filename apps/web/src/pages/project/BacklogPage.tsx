import { Outlet } from 'react-router-dom';

import { canWriteProject, useProjectScope } from '@/hooks/useProjects';
import ErrorState from '@/components/common/ErrorState';
import PageSpinner from '@/components/common/PageSpinner';
import BacklogView from '@/components/backlog/BacklogView';

/**
 * Backlog and sprint planning (WP3.3).
 *
 * THIN BY DESIGN: this file resolves the route scope, decides between the three
 * page-level states, and renders. Everything else — the section stack, the
 * single drag context they share, the sprint lifecycle dialogs — is
 * `components/backlog/**`, which is what keeps the page testable as a routing
 * decision rather than as a view.
 *
 * THE `<Outlet/>` IS NOT OPTIONAL. `t/:taskKey` is a CHILD of this route, so
 * that is where the deep-linkable task sheet renders, layered over the backlog
 * with the page still mounted behind it. Removing it does not break the build —
 * it silently makes every task link from this view render nothing.
 */
export default function BacklogPage() {
  const { projectId, projectKey, project, role, isPending, error } = useProjectScope();

  return (
    <>
      {isPending ? (
        <PageSpinner />
      ) : error || !projectId || !project ? (
        // A missing project after a settled load is the same failure as a failed
        // one: the scope hook returns `null` for a key that resolved to nothing.
        <ErrorState error={error} />
      ) : (
        <BacklogView
          projectId={projectId}
          projectKey={projectKey}
          project={project}
          canWrite={canWriteProject(role)}
        />
      )}
      <Outlet />
    </>
  );
}
