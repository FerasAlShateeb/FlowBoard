import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminUserRow } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { useDeleteAdminUser } from '@/hooks/useAdminUsers';
import { buttonVariants } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * `Delete user…` — the anonymize-and-deactivate confirmation.
 *
 * ═══ THE COPY LEADS WITH WHAT ACTUALLY HAPPENS ═══════════════════════════
 *
 * FlowBoard never hard-deletes an account. The row survives with its identity
 * scrubbed — name → "Deleted user", address → a unique
 * `deleted+<uuid>@flowboard.invalid`, avatar cleared, `isActive` false,
 * `token_version` bumped (which revokes every live session at once). An admin
 * who expects an erase and gets an anonymization has been surprised by the
 * product rather than informed by it, so all three consequences are spelled out
 * BEFORE the gate: what is scrubbed, what is kept, and that every org
 * membership goes.
 *
 * ═══ THE GATE IS THE EMAIL, NOT THE NAME ═════════════════════════════════
 *
 * Two people can share a display name; an address is unique by column
 * constraint, and it is the one identifier an admin can verify against the
 * ticket that asked for the deletion. It is also the value the operation
 * destroys, which makes typing it the last time anyone reads it.
 *
 * ═══ THE SELF-GUARD ══════════════════════════════════════════════════════
 *
 * The action is not offered for your own account (the menu omits it) — an admin
 * who anonymizes themselves has revoked their own sessions and can no longer
 * sign in to undo it, and there is no undo. The server is the real guard; this
 * dialog simply never opens for `isSelf`.
 */
export function DeleteUserDialog({
  user,
  onOpenChange,
  onDeleted,
}: {
  /** The account being deleted, or `null` while the dialog is closed. */
  user: AdminUserRow | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const remove = useDeleteAdminUser();
  const [typed, setTyped] = useState('');

  const open = user !== null;

  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  // Case-insensitive: the address column is, and an admin re-typing a mixed-case
  // address from a ticket should not be told they got it wrong.
  const unlocked = user !== null && typed.trim().toLowerCase() === user.email.toLowerCase();

  const confirm = () => {
    if (!user || !unlocked || remove.isPending) return;
    remove.mutate(user.id, {
      onSuccess: (result) => {
        // A PLURAL key with a real `count`, not an `{{orgs}}` string spliced
        // into a fixed plural noun (W3.2). Zero takes a sentence of its own:
        // "…and removed from 0 organizations" is a clause with nothing to say,
        // and in Arabic a zero-count noun declines differently again.
        const removed = result.membershipsRemoved;
        toast.success(
          removed === 0
            ? t('admin:users.delete.doneNoOrgs', { name: user.name })
            : t('admin:users.delete.done', { name: user.name, count: removed }),
        );
        onOpenChange(false);
        onDeleted?.();
      },
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="delete-user-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('admin:users.delete.title', { name: user?.name ?? '' })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('admin:users.delete.body')}</AlertDialogDescription>
        </AlertDialogHeader>

        <ul className="flex list-disc flex-col gap-1 ps-4 text-xs text-muted-foreground">
          <li>{t('admin:users.delete.keeps')}</li>
          <li>{t('admin:users.delete.memberships')}</li>
        </ul>

        <div className="grid gap-1.5">
          <Label htmlFor="delete-user-gate">
            {t('admin:users.delete.confirmHint', { value: user?.email ?? '' })}
          </Label>
          <Input
            id="delete-user-gate"
            value={typed}
            // An address is machine text; it stays LTR on an RTL page.
            dir="ltr"
            autoComplete="off"
            data-testid="delete-user-gate"
            onChange={(event) => {
              setTyped(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                confirm();
              }
            }}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>
            {t('common:actions.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: 'destructive' }))}
            disabled={!unlocked || remove.isPending}
            data-testid="delete-user-confirm"
            // The mutation owns the close, so a refusal leaves the dialog open
            // beside its toast rather than dismissing over the explanation.
            onClick={(event) => {
              event.preventDefault();
              confirm();
            }}
          >
            {remove.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('admin:users.delete.submit')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default DeleteUserDialog;
