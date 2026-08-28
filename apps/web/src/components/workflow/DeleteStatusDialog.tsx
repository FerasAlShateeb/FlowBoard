import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { Status } from '@flowboard/shared';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Deleting a board column — which is never JUST a delete.
 *
 * A status may hold tasks, and those tasks have to go somewhere: `statusId` is
 * NOT NULL on the task row, so there is no "leave them unassigned" option to
 * offer. The destination is therefore a required part of the action rather
 * than a follow-up question, which is why this is a dedicated dialog and not
 * the generic `ConfirmDialog`.
 *
 * It is a plain `Dialog` rather than a `FormDialog` for the same reason
 * `ConfirmDialog` is: one closed choice with a guaranteed-valid default has
 * nothing for zod to validate that a pre-selected value does not already
 * guarantee.
 */
export function DeleteStatusDialog({
  status,
  statuses,
  isPending,
  onOpenChange,
  onConfirm,
}: {
  /** `null` closes the dialog. */
  status: Status | null;
  /** The project's full column set — the destination choices come from it. */
  statuses: readonly Status[];
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (moveTasksTo: string) => void;
}) {
  const { t } = useTranslation(['workflow', 'common']);

  // Every column except the one being deleted.
  const destinations = statuses.filter((entry) => entry.id !== status?.id);
  const [moveTasksTo, setMoveTasksTo] = useState<string>('');

  // Default to the FIRST remaining column, re-chosen whenever a different
  // status is opened. Pre-selecting means the destructive button is never
  // disabled for want of a choice the user has no reason to make deliberately.
  useEffect(() => {
    if (status) setMoveTasksTo(destinations[0]?.id ?? '');
    // Keyed on the status being DELETED, not on `destinations` — that array is
    // derived and rebuilt every render, so depending on it would reset the
    // chosen destination under the user on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above.
  }, [status?.id]);

  return (
    <Dialog
      open={status !== null}
      onOpenChange={(open) => {
        if (!isPending) onOpenChange(open);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('workflow:statuses.deleteTitle', { name: status?.name ?? '' })}
          </DialogTitle>
          <DialogDescription>{t('workflow:statuses.deleteBody')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5">
          <Label htmlFor="move-tasks-to">{t('workflow:statuses.moveTasksTo')}</Label>
          <Select value={moveTasksTo} onValueChange={setMoveTasksTo}>
            <SelectTrigger id="move-tasks-to" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {destinations.map((destination) => (
                <SelectItem key={destination.id} value={destination.id}>
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ backgroundColor: destination.color }}
                    />
                    {destination.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            // The safe choice takes focus, so a reflexive Enter dismisses
            // rather than deletes a column.
            autoFocus
            disabled={isPending}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={isPending || moveTasksTo.length === 0}
            onClick={() => {
              onConfirm(moveTasksTo);
            }}
          >
            {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('common:actions.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DeleteStatusDialog;
