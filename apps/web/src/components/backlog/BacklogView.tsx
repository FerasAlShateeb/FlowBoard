import { useCallback, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ListOrdered, Plus } from 'lucide-react';
import type { ProjectDetail, Sprint, TaskSummary } from '@flowboard/shared';

import type { SprintBucket } from '@/lib/board-cache';
import { backlogBucketKey } from '@/hooks/useTasks';
import { useRankTask } from '@/hooks/useTaskMutations';
import { useDeleteSprint, useSprints } from '@/hooks/useSprints';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import PageHeader from '@/components/common/PageHeader';
import { taskKeyOf } from '@/components/board/BoardCard';
import { BACKLOG_SECTION_ID, useSectionCollapse } from '@/components/backlog/backlog-collapse';
import {
  APPEND_INDEX,
  parseBucketDroppableId,
  resolveBacklogDragEnd,
} from '@/components/backlog/backlog-dnd';
import BacklogSection from '@/components/backlog/BacklogSection';
import BacklogTaskRow from '@/components/backlog/BacklogTaskRow';
import CompleteSprintDialog from '@/components/backlog/CompleteSprintDialog';
import SprintFormDialog from '@/components/backlog/SprintFormDialog';
import SprintSection from '@/components/backlog/SprintSection';
import StartSprintDialog from '@/components/backlog/StartSprintDialog';
import type { BacklogRowContext } from '@/components/backlog/TaskRowList';

/**
 * The backlog page's body: the stack of sections, the one `DndContext` they all
 * live in, and the four dialogs the sprint lifecycle needs.
 *
 * ── One DndContext, many SortableContexts ───────────────────────────────────
 * Every section is a separate cache entry and a separate `SortableContext`, but
 * they share ONE `DndContext` — that is what makes dragging a story out of the
 * running sprint and into the backlog a single gesture. The context also owns
 * the `DragOverlay`, so the row being dragged is drawn once, above everything,
 * instead of being clipped by whichever section's `overflow-hidden` it happens
 * to be crossing.
 *
 * ── The order of the stack is the order of a planning session ───────────────
 * The running sprint first (it is the only section describing the present),
 * then what is planned, then what is finished, then the backlog. A planner works
 * top-down: check what is in flight, fill the next sprint, pull from the pile.
 *
 * ── Drag end reads the CACHE, not the DOM ───────────────────────────────────
 * `resolveBacklogDragEnd` is handed the complete cached order of every bucket,
 * because the backlog section can be filtering its rows and a mapping computed
 * from what is rendered would place the row relative to the wrong neighbours.
 * The mapping itself is pure and unit-tested; this component only supplies the
 * data and fires the mutation.
 */
export function BacklogView({
  projectId,
  projectKey,
  project,
  canWrite,
}: {
  projectId: string;
  projectKey: string;
  project: ProjectDetail;
  canWrite: boolean;
}) {
  const { t } = useTranslation(['backlog', 'common']);
  const queryClient = useQueryClient();

  const sprintList = useSprints(projectId);
  const { rank } = useRankTask({ projectId });
  const deleteSprint = useDeleteSprint(projectId);
  const { isCollapsed, toggle } = useSectionCollapse();

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Sprint | null>(null);
  const [startTarget, setStartTarget] = useState<Sprint | null>(null);
  const [completeTarget, setCompleteTarget] = useState<Sprint | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Sprint | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const sprints = useMemo(() => sprintList.data ?? [], [sprintList.data]);

  const active = useMemo(() => sprints.filter((s) => s.state === 'active'), [sprints]);
  const planned = useMemo(
    () => [...sprints.filter((s) => s.state === 'planned')].sort(byPlannedOrder),
    [sprints],
  );
  const completed = useMemo(
    () =>
      [...sprints.filter((s) => s.state === 'completed')].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    [sprints],
  );

  /** Top to bottom, exactly as rendered. */
  const ordered = useMemo(
    () => [...active, ...planned, ...completed],
    [active, planned, completed],
  );

  /**
   * The complete cached order of every bucket — what the drag mapping and the
   * overlay both read.
   *
   * Straight out of the query client rather than lifted into state: the sections
   * each own their query (the number of sprints changes, so the page cannot loop
   * hooks over them), and the cache is where those results already live.
   */
  const readBuckets = useCallback(() => {
    const ids: SprintBucket[] = [null, ...ordered.map((sprint) => sprint.id)];
    return ids.map((sprintId) => ({
      sprintId,
      tasks: queryClient.getQueryData<TaskSummary[]>(backlogBucketKey(projectId, sprintId)) ?? [],
    }));
  }, [queryClient, projectId, ordered]);

  const sensors = useSensors(
    // 4px of slop: below that a press on the grip is still a click, which is
    // what keeps the row's own controls usable on touch.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const draggingTask = useMemo(() => {
    if (!draggingId) return null;
    for (const bucket of readBuckets()) {
      const found = bucket.tasks.find((task) => task.id === draggingId);
      if (found) return found;
    }
    return null;
  }, [draggingId, readBuckets]);

  const rowContext: BacklogRowContext = useMemo(
    () => ({
      projectKey,
      labels: project.labels,
      statuses: project.statuses,
      // A completed sprint is not a destination — its numbers are stamped.
      moveTargets: [...active, ...planned],
      canWrite,
      onMove: (taskId, from, to) => {
        // `APPEND_INDEX` rather than a computed position: a menu move has no
        // drop point, and "the end of that bucket" is the only honest answer.
        rank({ taskId, fromSprintId: from, toSprintId: to, toIndex: APPEND_INDEX });
      },
    }),
    [projectKey, project.labels, project.statuses, active, planned, canWrite, rank],
  );

  /**
   * Screen-reader narration for the drag (WP5.1).
   *
   * Without it dnd-kit reads its own hard-coded English — "Draggable item 3 was
   * moved over droppable area 7" — which is untranslated on an Arabic page and
   * useless on any page: an opaque id is not a task and a droppable index is
   * not a sprint. Every sentence here names the TASK KEY and the SECTION, both
   * resolved out of the same cached buckets the drag mapping reads, so the
   * narration can never describe a different list from the one being reordered.
   */
  const announcements = useMemo<Announcements>(() => {
    // Read the cache at ANNOUNCEMENT time, not at memo time: a drag that starts
    // right after a mutation would otherwise narrate the pre-mutation order.
    const bucketsNow = () => readBuckets();

    const sectionName = (sprintId: SprintBucket): string =>
      sprintId === null
        ? t('backlog:sections.backlog')
        : (ordered.find((sprint) => sprint.id === sprintId)?.name ??
          t('backlog:sections.sprintLabel'));

    /** The bucket a task id sits in, or `undefined` for a stale id. */
    const bucketOfTask = (id: string) => bucketsNow().find((b) => b.tasks.some((x) => x.id === id));

    const keyOf = (id: UniqueIdentifier): string => {
      const taskId = String(id);
      const task = bucketOfTask(taskId)?.tasks.find((x) => x.id === taskId);
      return task ? taskKeyOf(projectKey, task) : taskId;
    };

    /** A drop target is either a row (land on it) or a section (append). */
    const targetOf = (id: UniqueIdentifier): { section: string; position: number } => {
      const overId = String(id);
      const asBucket = parseBucketDroppableId(overId);
      if (asBucket !== undefined) {
        const bucket = bucketsNow().find((b) => b.sprintId === asBucket);
        return { section: sectionName(asBucket), position: (bucket?.tasks.length ?? 0) + 1 };
      }
      const bucket = bucketOfTask(overId);
      return {
        section: sectionName(bucket?.sprintId ?? null),
        // One-based: read aloud to a person, not used as an index.
        position: (bucket?.tasks.findIndex((x) => x.id === overId) ?? 0) + 1,
      };
    };

    const sourceOf = (id: UniqueIdentifier): string =>
      sectionName(bucketOfTask(String(id))?.sprintId ?? null);

    return {
      onDragStart: ({ active }) =>
        t('backlog:dnd.picked', { key: keyOf(active.id), section: sourceOf(active.id) }),
      onDragOver: ({ active, over }) =>
        over ? t('backlog:dnd.over', { key: keyOf(active.id), ...targetOf(over.id) }) : undefined,
      onDragEnd: ({ active, over }) =>
        over
          ? t('backlog:dnd.dropped', { key: keyOf(active.id), ...targetOf(over.id) })
          : undefined,
      onDragCancel: ({ active }) =>
        t('backlog:dnd.cancelled', { key: keyOf(active.id), section: sourceOf(active.id) }),
    };
  }, [ordered, projectKey, readBuckets, t]);

  const screenReaderInstructions = useMemo(
    () => ({ draggable: t('backlog:dnd.instructions') }),
    [t],
  );

  const onDragStart = (event: DragStartEvent) => {
    setDraggingId(String(event.active.id));
  };

  const onDragEnd = (event: DragEndEvent) => {
    setDraggingId(null);
    if (!canWrite) return;

    const intent = resolveBacklogDragEnd({
      activeId: String(event.active.id),
      overId: event.over ? String(event.over.id) : null,
      buckets: readBuckets().map((bucket) => ({
        sprintId: bucket.sprintId,
        taskIds: bucket.tasks.map((task) => task.id),
      })),
    });

    if (intent) rank(intent);
  };

  const header = (
    <PageHeader
      title={t('backlog:title')}
      description={t('backlog:description')}
      actions={
        canWrite ? (
          <Button
            size="sm"
            onClick={() => {
              setEditTarget(null);
              setFormOpen(true);
            }}
          >
            <Plus aria-hidden />
            {t('backlog:actions.newSprint')}
          </Button>
        ) : undefined
      }
    />
  );

  if (sprintList.isPending) {
    return (
      <div>
        {header}
        <div className="flex flex-col gap-3">
          {[0, 1].map((section) => (
            <Skeleton key={section} className="h-32 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (sprintList.error) {
    return (
      <div>
        {header}
        <ErrorState
          error={sprintList.error}
          onRetry={() => {
            void sprintList.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div>
      {header}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        // A backlog is a stack of vertical lists; sideways travel would only let
        // a row be dragged out of the page.
        modifiers={[restrictToVerticalAxis]}
        accessibility={{ announcements, screenReaderInstructions }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setDraggingId(null);
        }}
      >
        <div className="flex flex-col gap-3">
          {ordered.length === 0 ? (
            <EmptyState
              icon={<ListOrdered className="size-4" />}
              title={t('backlog:empty.title')}
              message={t('backlog:empty.body')}
              action={
                canWrite ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditTarget(null);
                      setFormOpen(true);
                    }}
                  >
                    <Plus aria-hidden />
                    {t('backlog:actions.newSprint')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            ordered.map((sprint) => (
              <SprintSection
                key={sprint.id}
                projectId={projectId}
                sprint={sprint}
                context={rowContext}
                // Finished sprints open folded: they are history, and a project
                // accumulates them faster than it accumulates anything else.
                isCollapsed={isCollapsed(sprint.id, sprint.state === 'completed')}
                onToggle={() => {
                  toggle(sprint.id, sprint.state === 'completed');
                }}
                onEdit={() => {
                  setEditTarget(sprint);
                  setFormOpen(true);
                }}
                onStart={() => {
                  setStartTarget(sprint);
                }}
                onComplete={() => {
                  setCompleteTarget(sprint);
                }}
                onDelete={() => {
                  setDeleteTarget(sprint);
                }}
              />
            ))
          )}

          <BacklogSection
            projectId={projectId}
            context={rowContext}
            isCollapsed={isCollapsed(BACKLOG_SECTION_ID)}
            onToggle={() => {
              toggle(BACKLOG_SECTION_ID);
            }}
          />
        </div>

        {/* The ghost. Drawn outside every section so it is never clipped, and
            without sortable wiring so it cannot become a drop target itself. */}
        <DragOverlay>
          {draggingTask ? (
            <ul className="list-none">
              <BacklogTaskRow
                overlay
                task={draggingTask}
                projectKey={projectKey}
                labels={project.labels}
                statuses={project.statuses}
              />
            </ul>
          ) : null}
        </DragOverlay>
      </DndContext>

      <SprintFormDialog
        projectId={projectId}
        sprint={editTarget}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditTarget(null);
        }}
      />

      {/* The start and complete dialogs are MOUNTED WITH THEIR TARGET rather
          than kept open with a nullable sprint: each reads that sprint's bucket
          for its scope summary, and a hook keyed on `null` would read the
          backlog's numbers into a sprint's dialog. */}
      {startTarget ? (
        <StartSprintDialog
          projectId={projectId}
          sprint={startTarget}
          statuses={project.statuses}
          open
          onOpenChange={(open) => {
            if (!open) setStartTarget(null);
          }}
        />
      ) : null}

      {completeTarget ? (
        <CompleteSprintDialog
          projectId={projectId}
          sprint={completeTarget}
          statuses={project.statuses}
          plannedSprints={planned}
          open
          onOpenChange={(open) => {
            if (!open) setCompleteTarget(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t('backlog:remove.title', { name: deleteTarget?.name ?? '' })}
        description={t('backlog:remove.body')}
        confirmLabel={t('common:actions.delete')}
        isPending={deleteSprint.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteSprint.mutate(deleteTarget.id, {
            onSuccess: () => {
              toast.success(t('backlog:remove.deleted'));
              setDeleteTarget(null);
            },
          });
        }}
      />
    </div>
  );
}

/**
 * Planned sprints, in the order a planner reads them: the one with the earliest
 * planned start first, undated ones after (they are not scheduled yet), and
 * creation order as the tiebreak so the list never reshuffles on a refetch.
 */
function byPlannedOrder(a: Sprint, b: Sprint): number {
  if (a.startDate && b.startDate && a.startDate !== b.startDate) {
    return a.startDate.localeCompare(b.startDate);
  }
  if (a.startDate && !b.startDate) return -1;
  if (!a.startDate && b.startDate) return 1;
  return a.createdAt.localeCompare(b.createdAt);
}

export default BacklogView;
