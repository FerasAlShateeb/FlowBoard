import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { Status, StatusCategory } from '@flowboard/shared';

import { useDeleteStatus, useReorderStatuses, useUpdateStatus } from '@/hooks/useWorkflow';
import StatusRow from '@/components/workflow/StatusRow';
import DeleteStatusDialog from '@/components/workflow/DeleteStatusDialog';

/**
 * The draggable list of a project's board columns.
 *
 * ORDER IS OPTIMISTIC LOCAL STATE, then a whole-set PUT. `arrayMove` settles
 * the list under the pointer immediately and `useReorderStatuses` sends the
 * complete id list; the server rejects a list that is not exactly the project's
 * current status set, so a concurrent column add cannot be silently dropped by
 * a stale drag.
 *
 * WHY A LOCAL COPY AT ALL, when the mutation is already optimistic: the
 * mutation writes the PROJECT DETAIL cache, which the parent re-reads — a round
 * trip through TanStack that lands a frame later than the pointer. Holding the
 * order here means the row is under the cursor when it is dropped, and the
 * effect below re-syncs whenever the server's copy actually changes.
 *
 * BOTH SENSORS are registered. The pointer sensor has an activation distance so
 * a click on the grip is still a click; the keyboard sensor is what makes the
 * reorder reachable without a mouse (checklist §B: dnd keyboard sensor).
 *
 * THE DRAG NARRATES ITSELF (WP5.1). A keyboard sensor with no `announcements`
 * is a keyboard drag nobody can follow: dnd-kit falls back to its own hard-coded
 * ENGLISH sentences, which name the opaque droppable INDEX ("was moved over
 * droppable area 3") rather than the column — untranslated on an Arabic page,
 * and uninformative on either. `workflow:dnd.*` names the status and its
 * one-based position instead.
 */
/**
 * The VALUE signature that decides when the local copy re-syncs from the server.
 *
 * `StatusList` keeps its own `order` array so a drag can reorder the list under
 * the pointer before the server has agreed. That copy has to be refreshed when
 * the server data really changes, and must NOT be refreshed on every parent
 * render — depending on the array identity would churn constantly and fight an
 * in-progress drag. Hence a signature.
 *
 * ── IT MUST COVER EVERY FIELD A ROW RENDERS, NOT JUST THE IDS ───────────────
 * This was the id sequence alone, and that was too narrow. A rename changes a
 * status's `name` and not its id, so the signature did not move, the effect
 * never re-ran, and `order` went on holding the STALE `Status` objects. The
 * symptom was a row whose name input showed the new name — that input has its
 * own local state, so it looked correct — while its delete button still
 * announced the old one (`aria-label="Delete <old name>?"`), until something
 * else changed the id set or the page reloaded. A screen-reader user was told
 * the wrong thing about a destructive action, which is the worst place in the
 * form to be stale. `e2e/tests/workflow.spec.ts` is what caught it.
 *
 * A drag is still safe: it reorders locally and changes no server value, so
 * this signature does not move mid-drag.
 */
export function statusSyncSignature(statuses: Status[]): string {
  return statuses
    .map(
      (status) =>
        `${status.id}:${status.name}:${status.category}:${status.color}:${String(status.wipLimit)}`,
    )
    .join('|');
}

export function StatusList({
  projectId,
  statuses,
  disabled,
}: {
  projectId: string;
  statuses: Status[];
  disabled?: boolean;
}) {
  const { t } = useTranslation(['workflow']);
  const [order, setOrder] = useState<Status[]>(statuses);
  const [deleting, setDeleting] = useState<Status | null>(null);

  const updateStatus = useUpdateStatus(projectId);
  const reorderStatuses = useReorderStatuses(projectId);
  const deleteStatus = useDeleteStatus(projectId);

  const serverOrder = statusSyncSignature(statuses);
  useEffect(() => {
    setOrder(statuses);
    // `serverOrder` is the VALUE signature of `statuses`; depending on the array itself would
    // re-run on every parent render and fight an in-progress drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above.
  }, [serverOrder]);

  const sensors = useSensors(
    // 4px before a drag starts: below that, a press on the grip is a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = order.findIndex((status) => status.id === active.id);
    const to = order.findIndex((status) => status.id === over.id);
    if (from === -1 || to === -1) return;

    const next = arrayMove(order, from, to);
    setOrder(next);

    reorderStatuses.mutate(
      next.map((status) => status.id),
      {
        onSuccess: () => {
          toast.success(t('workflow:statuses.reordered'));
        },
        onError: () => {
          // The hook already restored the CACHE and toasted; this restores the
          // local copy, which the hook cannot see.
          setOrder(statuses);
        },
      },
    );
  };

  /** Screen-reader narration. See the note at the top of the file. */
  const announcements = useMemo<Announcements>(() => {
    const total = order.length;
    const nameOf = (id: UniqueIdentifier): string =>
      order.find((status) => status.id === id)?.name ?? String(id);
    // One-based, because it is read aloud to a person, not used as an index.
    const positionOf = (id: UniqueIdentifier): number =>
      order.findIndex((status) => status.id === id) + 1;

    return {
      onDragStart: ({ active }) =>
        t('workflow:dnd.picked', {
          name: nameOf(active.id),
          position: positionOf(active.id),
          total,
        }),
      onDragOver: ({ active, over }) =>
        over
          ? t('workflow:dnd.over', {
              name: nameOf(active.id),
              position: positionOf(over.id),
              total,
            })
          : undefined,
      onDragEnd: ({ active, over }) =>
        over
          ? t('workflow:dnd.dropped', {
              name: nameOf(active.id),
              position: positionOf(over.id),
              total,
            })
          : undefined,
      onDragCancel: ({ active }) =>
        t('workflow:dnd.cancelled', {
          name: nameOf(active.id),
          position: positionOf(active.id),
        }),
    };
  }, [order, t]);

  const screenReaderInstructions = useMemo(
    () => ({ draggable: t('workflow:statuses.reorderHint') }),
    [t],
  );

  const patch = (statusId: string, changes: Parameters<typeof updateStatus.mutate>[0]) => {
    updateStatus.mutate(changes, {
      onSuccess: () => {
        toast.success(t('workflow:statuses.updated'));
      },
    });
    return statusId;
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        // A vertical list can only reorder vertically, and confining the drag
        // to the parent stops a row being flung out of the card.
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        accessibility={{ announcements, screenReaderInstructions }}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={order.map((status) => status.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex flex-col gap-1.5">
            {order.map((status) => (
              <StatusRow
                key={status.id}
                status={status}
                disabled={disabled}
                canDelete={order.length > 1}
                onRename={(name) => {
                  patch(status.id, { statusId: status.id, name });
                }}
                onCategoryChange={(category: StatusCategory) => {
                  patch(status.id, { statusId: status.id, category });
                }}
                onColorChange={(color) => {
                  patch(status.id, { statusId: status.id, color });
                }}
                onWipChange={(wipLimit) => {
                  patch(status.id, { statusId: status.id, wipLimit });
                }}
                onDelete={() => {
                  setDeleting(status);
                }}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <DeleteStatusDialog
        status={deleting}
        statuses={order}
        isPending={deleteStatus.isPending}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={(moveTasksTo) => {
          if (!deleting) return;
          deleteStatus.mutate(
            { statusId: deleting.id, moveTasksTo },
            {
              onSuccess: () => {
                toast.success(t('workflow:statuses.deleted'));
                setDeleting(null);
              },
            },
          );
        }}
      />
    </>
  );
}

export default StatusList;
