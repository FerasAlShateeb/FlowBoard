import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * The destructive-action confirmation — one component for every "are you sure?"
 * in the product.
 *
 * BUILT ON `ui/dialog`, NOT AN ALERT-DIALOG PRIMITIVE. FlowBoard's frozen
 * primitive set has no `alert-dialog`, so this composes `Dialog` and supplies
 * the two behaviours an alert dialog adds: the CANCEL button takes initial
 * focus (so a stray Enter dismisses rather than destroys), and Escape closes
 * without acting. Everything else — the focus trap, the overlay, the labelled
 * title — Radix's Dialog already provides.
 *
 * THE TYPED GATE (`confirmValue`) is for the small number of actions that
 * cannot be undone at all: deleting an organization or a project. Making
 * someone type the name is friction on purpose, and it is deliberately NOT
 * applied to the everyday deletes — friction everywhere is friction nowhere.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  isPending = false,
  confirmValue,
  confirmValueHint,
  variant = 'destructive',
  showCancel = true,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Already translated. */
  title: string;
  description?: string;
  /** Defaults to the generic `common:actions.confirm`. */
  confirmLabel?: string;
  onConfirm: () => void;
  isPending?: boolean;
  /** When set, the confirm button unlocks only once this is typed verbatim. */
  confirmValue?: string;
  confirmValueHint?: string;
  variant?: 'destructive' | 'default';
  /**
   * Set false for an ACKNOWLEDGEMENT — a dialog whose action has already
   * happened and offers nothing to decline.
   *
   * The one live case is the admin user directory's temporary-password reveal:
   * the account is already created and the credential is already generated, so
   * a button labelled "Cancel" beside "I have copied it" reads as "undo the
   * account" to exactly the nervous reader who most needs to trust this dialog.
   * The confirm button then takes initial focus, since it is the only one —
   * which is safe here precisely BECAUSE nothing is being destroyed.
   *
   * Do not reach for this to make a destructive confirm tidier. The cancel
   * button and its autofocus are the whole reason this component exists.
   */
  showCancel?: boolean;
  /** Extra content between the description and the buttons. */
  children?: ReactNode;
}) {
  const { t } = useTranslation(['common']);
  const [typed, setTyped] = useState('');

  // Reset the gate whenever the dialog opens, so reopening it after a cancel
  // does not arrive pre-unlocked from the previous attempt.
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const gated = confirmValue !== undefined;
  const unlocked = !gated || typed.trim() === confirmValue;

  const confirm = () => {
    if (!unlocked || isPending) return;
    onConfirm();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        {children}

        {gated ? (
          <div className="grid gap-1.5">
            <Label htmlFor="confirm-gate">
              {confirmValueHint ?? t('common:confirm.typeToConfirm', { value: confirmValue })}
            </Label>
            <Input
              id="confirm-gate"
              value={typed}
              autoComplete="off"
              onChange={(event) => {
                setTyped(event.target.value);
              }}
              onKeyDown={(event) => {
                // Enter submits from the gate field — the only field here, so
                // there is no ambiguity about what it would submit.
                if (event.key === 'Enter') {
                  event.preventDefault();
                  confirm();
                }
              }}
            />
          </div>
        ) : null}

        <DialogFooter>
          {showCancel ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              // The safe choice takes focus. A confirmation whose destructive
              // button is focused turns a reflexive Enter into a deletion.
              autoFocus
              disabled={isPending}
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {t('common:actions.cancel')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant={variant}
            size="sm"
            // Focus has to land somewhere; with no cancel button, here.
            autoFocus={!showCancel}
            disabled={!unlocked || isPending}
            onClick={confirm}
          >
            {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {confirmLabel ?? t('common:actions.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ConfirmDialog;
