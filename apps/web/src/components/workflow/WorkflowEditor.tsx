import { useTranslation } from 'react-i18next';
import { Columns3 } from 'lucide-react';

import { useWorkflow } from '@/hooks/useWorkflow';
import PageSpinner from '@/components/common/PageSpinner';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import AddStatusDialog from '@/components/workflow/AddStatusDialog';
import StatusList from '@/components/workflow/StatusList';
import TransitionMatrix from '@/components/workflow/TransitionMatrix';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The per-project workflow editor: the board's columns, and the moves allowed
 * between them.
 *
 * TWO CARDS, ONE ORDER, and the order is the argument: you cannot define
 * transitions between columns that do not exist yet, and the matrix's own axes
 * are the status list. Statuses first, transitions second — the matrix even
 * refuses to render below two columns and says so.
 *
 * The two halves save differently on purpose, which is worth knowing before
 * reading either: status fields save THEMSELVES on blur (a workflow is edited
 * one field at a time), while the transition graph is a DRAFT with a Save
 * button (`PUT /transitions` replaces the whole set in one transaction). See
 * each component's header for the full reasoning.
 *
 * Exported as its own component rather than written into the page so the board
 * (WP3.1) could embed it in a side panel later without moving code out of a
 * route file.
 */
export function WorkflowEditor({
  projectId,
  projectName,
  canAdmin,
}: {
  projectId: string;
  projectName: string;
  canAdmin: boolean;
}) {
  const { t } = useTranslation(['workflow']);
  const { workflow, isPending, error } = useWorkflow(projectId);

  if (isPending) return <PageSpinner />;
  if (error) return <ErrorState error={error} />;

  return (
    <div className="flex flex-col gap-[var(--gap)]">
      <div>
        <h2 className="text-sm font-semibold">{t('workflow:title')}</h2>
        <p className="text-xs text-muted-foreground">
          {t('workflow:subtitle', { project: projectName })}
        </p>
        {!canAdmin ? (
          <p className="mt-1 text-xs text-muted-foreground">{t('workflow:readOnly')}</p>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('workflow:statuses.title')}</CardTitle>
          <CardDescription>{t('workflow:statuses.description')}</CardDescription>
        </CardHeader>

        {workflow.statuses.length === 0 ? (
          <EmptyState
            icon={<Columns3 className="size-4" />}
            title={t('workflow:statuses.empty')}
            message={t('workflow:statuses.emptyBody')}
          />
        ) : (
          <StatusList projectId={projectId} statuses={workflow.statuses} disabled={!canAdmin} />
        )}

        {canAdmin ? (
          <div className="flex justify-end">
            <AddStatusDialog projectId={projectId} />
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('workflow:transitions.title')}</CardTitle>
          <CardDescription>{t('workflow:transitions.description')}</CardDescription>
        </CardHeader>

        <TransitionMatrix
          projectId={projectId}
          statuses={workflow.statuses}
          transitions={workflow.transitions}
          disabled={!canAdmin}
        />
      </Card>
    </div>
  );
}

export default WorkflowEditor;
