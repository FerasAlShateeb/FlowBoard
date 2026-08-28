import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import type { CreateTaskInput } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { useCreateTask } from '@/hooks/useTaskMutations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * The inline composer in a column footer: a title, Enter, done.
 *
 * WHY A TITLE AND NOTHING ELSE. The board's job is arranging work, not
 * describing it. A quick-add that asked for a type, an assignee and an estimate
 * would be the create DIALOG (WP3.2 owns that, on `C`), and putting it in a
 * column footer would make the fast path slow. Everything else defaults, and
 * the card that appears is one click from the sheet where it gets filled in.
 *
 * WHY THE COMPOSER STAYS OPEN AFTER A SUCCESSFUL ADD. Columns are populated in
 * bursts — a planning session produces six cards, not one — so the field clears
 * and keeps focus. Escape is the way out, and it is spelled out in the hint
 * under the field rather than left to be discovered.
 *
 * NOT OPTIMISTIC, and that is `useCreateTask`'s decision, not this component's:
 * a task has no id, key or rank until the server allocates them, so an
 * optimistic card would be a placeholder to reconcile — and a failed create
 * would show the user a card they named appearing and then vanishing.
 */
export function QuickAddCard({
  projectId,
  statusId,
  statusName,
  open,
  onOpenChange,
  disabled = false,
  className,
}: {
  projectId: string;
  statusId: string;
  /** Named in the trigger's accessible label — "Add a card to In Progress". */
  statusName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation(['board', 'common']);
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const createTask = useCreateTask(projectId);

  // Focus on open, and re-focus when the composer moves between columns (one
  // composer is open at a time, so `open` flipping is the whole signal).
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        data-slot="quick-add-trigger"
        className={cn('w-full justify-start gap-1.5', className)}
        aria-label={t('board:column.add', { status: statusName })}
        onClick={() => {
          onOpenChange(true);
        }}
      >
        <Plus aria-hidden />
        {t('board:quickAdd.open')}
      </Button>
    );
  }

  const submit = () => {
    const trimmed = title.trim();
    if (trimmed.length === 0 || createTask.isPending) return;

    // The contract's `.default()`s make these fields optional on the WIRE and
    // required in its OUTPUT type, which is what the mutation takes. Spelling
    // them out here rather than widening the mutation's signature keeps
    // `@flowboard/shared` the single authority on what a create looks like —
    // same trade as `org/CreateProjectDialog`.
    const input: CreateTaskInput = {
      title: trimmed,
      description: null,
      type: 'task',
      statusId,
      priority: 'medium',
      assigneeId: null,
      storyPoints: null,
      startDate: null,
      dueDate: null,
      sprintId: null,
      epicId: null,
      parentId: null,
      labelIds: [],
      watcherIds: [],
    };

    createTask.mutate(input, {
      onSuccess: (task) => {
        toast.success(t('board:quickAdd.created', { key: task.key }));
        setTitle('');
        inputRef.current?.focus();
      },
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      // Stop here: the shell's global Escape handler closes every overlay, and
      // dismissing a composer should not also collapse the mobile nav.
      event.stopPropagation();
      setTitle('');
      onOpenChange(false);
    }
  };

  return (
    <div
      data-slot="quick-add"
      className={cn('flex flex-col gap-1 rounded-[var(--card-radius)] p-0.5', className)}
    >
      <Input
        ref={inputRef}
        value={title}
        disabled={createTask.isPending}
        placeholder={t('board:quickAdd.placeholder')}
        // Its OWN name, not the openers' — two buttons already answer to
        // "Add a card to In Progress", and a field that answered to the same
        // string would be indistinguishable from them to a screen reader.
        aria-label={t('board:quickAdd.label', { status: statusName })}
        onChange={(event) => {
          setTitle(event.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">{t('board:quickAdd.hint')}</span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              setTitle('');
              onOpenChange(false);
            }}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button
            type="button"
            size="xs"
            disabled={title.trim().length === 0 || createTask.isPending}
            onClick={submit}
          >
            {t('board:quickAdd.submit')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default QuickAddCard;
