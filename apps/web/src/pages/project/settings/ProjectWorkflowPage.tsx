import { canAdminProject, useProjectScope } from '@/hooks/useProjects';
import PageSpinner from '@/components/common/PageSpinner';
import ErrorState from '@/components/common/ErrorState';
import WorkflowEditor from '@/components/workflow/WorkflowEditor';

/**
 * Project settings → Workflow.
 *
 * A THIN ROUTE FILE on purpose: it resolves the URL scope and hands off. The
 * editor lives in `components/workflow/` so the board (WP3.1) can embed the
 * same component in a side panel without anything moving out of a page module.
 */
export default function ProjectWorkflowPage() {
  const { projectId, project, role, isPending, error } = useProjectScope();

  if (isPending) return <PageSpinner />;
  if (error || !projectId || !project) return <ErrorState error={error} />;

  return (
    <WorkflowEditor
      projectId={projectId}
      projectName={project.name}
      canAdmin={canAdminProject(role)}
    />
  );
}
