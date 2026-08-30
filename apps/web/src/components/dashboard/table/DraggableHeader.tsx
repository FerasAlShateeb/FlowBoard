import type { ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TableHead } from '@/components/ui/table';
import type { AriaSort } from '@/components/datatable/table-sort';
import type { TableChromeCopy } from '@/components/dashboard/chrome-copy';

/**
 * A reorderable `<th>`.
 *
 * ═══ THE CELL IS THE DROP TARGET; THE GRIP IS THE DRAG HANDLE ════════════
 *
 * The whole header is deliberately NOT a handle, because a header's primary job
 * is SORTING. A `PointerSensor` with an 8px activation distance plus a
 * dedicated grip is what keeps a plain click on the label a sort rather than a
 * one-pixel drag that reorders the table by accident.
 *
 * ═══ THE GRIP IS ALSO THE KEYBOARD ENTRY POINT ═══════════════════════════
 *
 * dnd-kit's `KeyboardSensor` activates on the ACTIVATOR NODE, which is why the
 * grip is a real `<button>` carrying `setActivatorNodeRef` and the sortable
 * `attributes`/`listeners`. Space picks the column up, arrows move it, space
 * drops it — a reorder control that only answers to a pointer is a reorder
 * control half the users cannot reach (checklist §B).
 *
 * It is revealed on hover, and on FOCUS: `opacity-0` alone would leave a
 * keyboard user tabbing to an invisible control. `group-hover/col` and
 * `focus-visible` bring it back, and it keeps its box either way so the header
 * never reflows as the pointer crosses it.
 *
 * ═══ `aria-sort` LIVES HERE, NOT ON THE BUTTON ═══════════════════════════
 *
 * The sort state is a property of the COLUMN HEADER CELL, so it is set on the
 * `<th>`. The button inside announces the ACTION a press performs — the two are
 * different sentences and both are needed.
 */
export interface DraggableHeaderProps {
  /** The column id. dnd-kit's sortable id, and the grip's testid suffix. */
  id: string;
  /** Plain-text column name — the grip's accessible name interpolates it. */
  label: string;
  /** `undefined` for a column that is not a sort control at all. */
  ariaSort?: AriaSort;
  copy: TableChromeCopy;
  className?: string;
  children: ReactNode;
}

export function DraggableHeader({
  id,
  label,
  ariaSort,
  copy,
  className,
  children,
}: DraggableHeaderProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <TableHead
      ref={setNodeRef}
      scope="col"
      aria-sort={ariaSort}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('group/col relative', isDragging && 'z-10 bg-secondary opacity-80', className)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={copy.reorderColumn(label)}
          data-testid={`col-drag-${id}`}
          className="cursor-grab rounded-[var(--radius)] text-muted-foreground opacity-0 transition-opacity duration-[var(--speed)] outline-none group-hover/col:opacity-70 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <GripVertical className="size-3" aria-hidden />
        </button>
      </span>
    </TableHead>
  );
}
