import { useEffect, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import { GripVertical, Trash2 } from 'lucide-react';
import type { Status, StatusCategory } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { STATUS_COLORS } from '@/lib/label-colors';
import ColorSwatchPicker from '@/components/common/ColorSwatchPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * One board column, as an editable row: drag handle, colour, name, category,
 * WIP limit, delete.
 *
 * EVERY FIELD SAVES ITSELF. There is no Save button on the row and no dirty
 * state to track, because a workflow is edited one field at a time (rename a
 * column, then set its limit) and a form that batches those into one submit
 * makes the user hold five pending changes in their head. The name and the WIP
 * limit commit on BLUR or Enter — not on every keystroke, which would be a
 * PATCH per character — and the two selects commit immediately, since a closed
 * choice has no intermediate state worth debouncing.
 *
 * THE HANDLE IS THE ONLY DRAGGABLE PART (`listeners` on the grip, not the row).
 * The row contains a text input and two selects; making the whole row a drag
 * source would mean a click into the name field starts a drag instead of
 * placing a caret.
 */
export function StatusRow({
  status,
  taskCount,
  disabled,
  onRename,
  onCategoryChange,
  onColorChange,
  onWipChange,
  onDelete,
  canDelete,
}: {
  status: Status;
  /** Shown next to the name so a delete's consequences are visible up front. */
  taskCount?: number;
  disabled?: boolean;
  onRename: (name: string) => void;
  onCategoryChange: (category: StatusCategory) => void;
  onColorChange: (color: string) => void;
  /** `null` clears the limit. */
  onWipChange: (wipLimit: number | null) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const { t } = useTranslation(['workflow', 'common']);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: status.id,
    disabled,
  });

  // Local mirrors so typing is not a controlled round trip through the server.
  const [name, setName] = useState(status.name);
  const [wip, setWip] = useState(status.wipLimit === null ? '' : String(status.wipLimit));

  // Re-seed when the server's copy changes underneath — another admin's edit
  // arriving, or this row's own mutation resolving with a trimmed value.
  useEffect(() => {
    setName(status.name);
  }, [status.name]);
  useEffect(() => {
    setWip(status.wipLimit === null ? '' : String(status.wipLimit));
  }, [status.wipLimit]);

  const commitName = () => {
    const next = name.trim();
    if (next.length === 0) {
      // An empty name is not a save, it is a mistake — put the old one back
      // rather than sending a request the schema will refuse.
      setName(status.name);
      return;
    }
    if (next !== status.name) onRename(next);
  };

  const commitWip = () => {
    const raw = wip.trim();
    if (raw.length === 0) {
      if (status.wipLimit !== null) onWipChange(null);
      return;
    }
    const parsed = Number(raw);
    // A limit below 1 is not "unlimited" — that is what an empty field means —
    // so anything invalid reverts rather than clearing the limit by accident.
    if (!Number.isInteger(parsed) || parsed < 1) {
      setWip(status.wipLimit === null ? '' : String(status.wipLimit));
      return;
    }
    if (parsed !== status.wipLimit) onWipChange(parsed);
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 rounded-[var(--radius)] border border-border bg-surface p-2',
        // The dragged row is lifted rather than hidden, so the gap it leaves is
        // visible and the drop target reads unambiguously.
        isDragging && 'z-10 opacity-80 shadow-[var(--shadow-2)]',
      )}
    >
      <button
        type="button"
        // dnd-kit's own attributes carry the keyboard sensor's ARIA wiring, so
        // space-to-lift and arrows-to-move work with no code here.
        {...attributes}
        {...listeners}
        disabled={disabled}
        aria-label={t('workflow:statuses.reorder')}
        title={t('workflow:statuses.reorderHint')}
        className="inline-flex size-6 shrink-0 cursor-grab items-center justify-center rounded-[var(--btn-radius)] text-muted-foreground transition-colors duration-[var(--speed)] hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:cursor-default disabled:opacity-40"
      >
        <GripVertical className="size-3.5" aria-hidden />
      </button>

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={t('workflow:statuses.color')}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-[var(--btn-radius)] border border-border transition-colors duration-[var(--speed)] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:opacity-50"
          >
            <span
              aria-hidden
              className="size-3.5 rounded-full"
              style={{ backgroundColor: status.color }}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto">
          <ColorSwatchPicker
            value={status.color}
            onChange={onColorChange}
            presets={STATUS_COLORS}
            label={t('workflow:statuses.color')}
          />
        </PopoverContent>
      </Popover>

      <Input
        value={name}
        disabled={disabled}
        aria-label={t('workflow:statuses.editName')}
        className="h-7 min-w-0 flex-1 text-xs"
        onChange={(event) => {
          setName(event.target.value);
        }}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            // `blur()` rather than calling `commitName` directly, so the field
            // also leaves edit focus — Enter in a settings row means "done".
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            setName(status.name);
            event.currentTarget.blur();
          }
        }}
      />

      <Select
        value={status.category}
        disabled={disabled}
        onValueChange={(value) => {
          onCategoryChange(value as StatusCategory);
        }}
      >
        <SelectTrigger size="sm" className="w-32" aria-label={t('workflow:statuses.category')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="todo">{t('workflow:categories.todo')}</SelectItem>
          <SelectItem value="in_progress">{t('workflow:categories.in_progress')}</SelectItem>
          <SelectItem value="done">{t('workflow:categories.done')}</SelectItem>
        </SelectContent>
      </Select>

      <Input
        value={wip}
        disabled={disabled}
        type="number"
        min={1}
        inputMode="numeric"
        aria-label={t('workflow:statuses.wipLimit')}
        placeholder={t('workflow:statuses.wipLimitNone')}
        className="h-7 w-24 text-xs"
        onChange={(event) => {
          setWip(event.target.value);
        }}
        onBlur={commitWip}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />

      {typeof taskCount === 'number' ? (
        <span className="hidden w-24 shrink-0 text-[11px] text-muted-foreground lg:inline">
          {t('workflow:statuses.tasksHere', { count: taskCount })}
        </span>
      ) : null}

      <Button
        variant="ghost"
        size="icon-sm"
        // The last column cannot go: a board with no columns has nowhere to put
        // work, and the server refuses it anyway.
        disabled={disabled || !canDelete}
        aria-label={t('workflow:statuses.deleteTitle', { name: status.name })}
        onClick={onDelete}
      >
        <Trash2 aria-hidden />
      </Button>
    </li>
  );
}

export default StatusRow;
