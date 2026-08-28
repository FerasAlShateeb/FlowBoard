import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Columns3, GripVertical, RotateCcw } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { TABLE_COLUMN_IDS, type TableColumnId } from '@/components/datatable/table-model';
import { useColumnLabels } from '@/components/datatable/table-columns';
import type { TableColumnPrefs } from '@/components/datatable/table-prefs';

/**
 * "Columns" — visibility checkboxes plus a drag-to-reorder list.
 *
 * ONE LIST, TWO CONTROLS. Visibility and order are the same question asked
 * twice ("what do I want to see, and where"), and splitting them into a
 * checkbox list and a separate order editor makes a user hunt for the second
 * one. So each row carries a grip, a checkbox and a name, and the row's
 * position in the list IS the column's position in the table.
 *
 * DRAGGING IS NOT THE ONLY WAY TO REORDER. dnd-kit's keyboard sensor is
 * registered, so space picks a row up, arrows move it and space drops it —
 * announced by the hint under the list. A reorder control that only responds to
 * a pointer is a reorder control half the users cannot reach (checklist §B).
 *
 * AND IT NARRATES ITSELF (WP5.1). `table:config.dnd.*` replaces dnd-kit's
 * built-in English commentary, which announces the droppable INDEX rather than
 * the column and leaks English into an Arabic page. `config.reorderHint` — the
 * visible hint under the list — doubles as the library's instructions, so the
 * sighted and the screen-reader user are told the same thing.
 *
 * THE KEY COLUMN CANNOT BE HIDDEN. It is the row's identity and its only link
 * into the task sheet; a table whose rows cannot be named or opened is a report,
 * not a work surface. It can still be MOVED, which is the part people actually
 * want.
 */
export function ColumnConfigPopover({
  prefs,
  onChange,
  onReset,
}: {
  prefs: TableColumnPrefs;
  onChange: (next: TableColumnPrefs) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation(['table']);
  const labels = useColumnLabels();
  const [open, setOpen] = useState(false);

  const hidden = new Set(prefs.hidden);
  const shown = TABLE_COLUMN_IDS.length - hidden.size;

  const sensors = useSensors(
    // 4px before a drag starts, so a press on the grip is still a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = prefs.order.indexOf(active.id as TableColumnId);
    const to = prefs.order.indexOf(over.id as TableColumnId);
    if (from === -1 || to === -1) return;

    onChange({ ...prefs, order: arrayMove(prefs.order, from, to) });
  };

  /** Screen-reader narration. See the note at the top of the file. */
  const announcements = useMemo<Announcements>(() => {
    const total = prefs.order.length;
    const nameOf = (id: UniqueIdentifier): string => labels[id as TableColumnId] ?? String(id);
    // One-based: it is read aloud to a person, not used as an index.
    const positionOf = (id: UniqueIdentifier): number =>
      prefs.order.indexOf(id as TableColumnId) + 1;

    return {
      onDragStart: ({ active }) =>
        t('table:config.dnd.picked', {
          name: nameOf(active.id),
          position: positionOf(active.id),
          total,
        }),
      onDragOver: ({ active, over }) =>
        over
          ? t('table:config.dnd.over', {
              name: nameOf(active.id),
              position: positionOf(over.id),
              total,
            })
          : undefined,
      onDragEnd: ({ active, over }) =>
        over
          ? t('table:config.dnd.dropped', {
              name: nameOf(active.id),
              position: positionOf(over.id),
              total,
            })
          : undefined,
      onDragCancel: ({ active }) =>
        t('table:config.dnd.cancelled', {
          name: nameOf(active.id),
          position: positionOf(active.id),
        }),
    };
  }, [labels, prefs.order, t]);

  const screenReaderInstructions = useMemo(
    () => ({ draggable: t('table:config.reorderHint') }),
    [t],
  );

  const toggle = (columnId: TableColumnId) => {
    const next = new Set(prefs.hidden);
    if (next.has(columnId)) next.delete(columnId);
    else next.add(columnId);
    onChange({ ...prefs, hidden: [...next] });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={t('table:toolbar.columns')}>
          <Columns3 aria-hidden />
          <span className="hidden sm:inline">{t('table:toolbar.columns')}</span>
          <span className="text-muted-foreground tabular-nums" dir="ltr">
            {t('table:toolbar.columnsCount', { shown, total: TABLE_COLUMN_IDS.length })}
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72 p-2">
        <PopoverHeader className="px-1 pb-2">
          <PopoverTitle>{t('table:config.title')}</PopoverTitle>
          <PopoverDescription>{t('table:config.description')}</PopoverDescription>
        </PopoverHeader>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          accessibility={{ announcements, screenReaderInstructions }}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={prefs.order} strategy={verticalListSortingStrategy}>
            <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
              {prefs.order.map((columnId) => (
                <ColumnRow
                  key={columnId}
                  columnId={columnId}
                  label={labels[columnId] ?? columnId}
                  visible={!hidden.has(columnId)}
                  lockedVisible={columnId === 'key'}
                  onToggle={() => {
                    toggle(columnId);
                  }}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>

        <p className="px-1 pt-2 text-[11px] text-muted-foreground">
          {t('table:config.reorderHint')}
        </p>

        <Separator className="my-2" />

        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => {
            onReset();
          }}
        >
          <RotateCcw aria-hidden />
          {t('table:config.reset')}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** One draggable row: grip, checkbox, name. */
function ColumnRow({
  columnId,
  label,
  visible,
  lockedVisible,
  onToggle,
}: {
  columnId: TableColumnId;
  label: string;
  visible: boolean;
  lockedVisible: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation(['table']);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: columnId,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 rounded-[var(--radius)] px-1 py-1 text-xs',
        isDragging ? 'z-10 bg-accent shadow-[var(--shadow-2)]' : 'hover:bg-accent/50',
      )}
    >
      <button
        type="button"
        // The whole row is not the drag handle: the checkbox lives inside it,
        // and a row-wide handle would swallow every click meant for the box.
        {...attributes}
        {...listeners}
        aria-label={t('table:config.reorder', { name: label })}
        className="inline-flex size-5 shrink-0 cursor-grab items-center justify-center rounded-[var(--btn-radius)] text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="size-3.5" aria-hidden />
      </button>

      <Checkbox
        id={`column-${columnId}`}
        checked={visible}
        disabled={lockedVisible}
        aria-label={t('table:config.toggle', { name: label })}
        onCheckedChange={onToggle}
      />

      <label
        htmlFor={`column-${columnId}`}
        className={cn('min-w-0 flex-1 truncate', lockedVisible && 'text-muted-foreground')}
        title={lockedVisible ? t('table:config.locked') : undefined}
      >
        {label}
      </label>
    </li>
  );
}

export default ColumnConfigPopover;
