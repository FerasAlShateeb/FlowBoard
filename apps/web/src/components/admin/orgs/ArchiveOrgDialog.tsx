import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { OrgAdminRow } from '@flowboard/shared';

import { useArchiveOrg } from '@/hooks/useAdminOrgs';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
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
 * Archive an organization — the console's one destructive action.
 *
 * ═══ AN `AlertDialog`, NOT `ConfirmDialog` ═══════════════════════════════
 *
 * `common/ConfirmDialog` composes `ui/dialog` and re-implements two of the
 * three behaviours an alert dialog gives for free. FlowBoard now HAS the
 * primitive (W1.4 hand-copied it), and the differences are load-bearing here:
 * `role="alertdialog"` announces the consequence with the title, there is no
 * dismiss-by-outside-click, and focus lands on Cancel. Migrating the older call
 * sites is W3.1's job; new destructive surfaces start on the primitive.
 *
 * ═══ THE TYPED GATE ══════════════════════════════════════════════════════
 *
 * Archiving takes every project, team and task in the organization out of
 * reach. That is the same weight as the org danger zone's delete, so it wears
 * the same friction: the confirm unlocks only once the org's NAME is typed
 * verbatim. It is deliberately not applied to the everyday actions — friction
 * everywhere is friction nowhere — and the copy is careful to say the operation
 * is reversible, because it is (see the Restore row action).
 */
export function ArchiveOrgDialog({
  org,
  onOpenChange,
  onArchived,
}: {
  /** The row being archived, or `null` while the dialog is closed. */
  org: OrgAdminRow | null;
  onOpenChange: (open: boolean) => void;
  onArchived?: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const archive = useArchiveOrg();
  const [typed, setTyped] = useState('');

  const open = org !== null;

  // Reset the gate on every open, so reopening after a cancel does not arrive
  // pre-unlocked from the previous attempt.
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const unlocked = org !== null && typed.trim() === org.name;

  const confirm = () => {
    if (!org || !unlocked || archive.isPending) return;
    archive.mutate(org.id, {
      onSuccess: () => {
        toast.success(t('admin:orgs.archive.archived', { name: org.name }));
        onOpenChange(false);
        onArchived?.();
      },
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="archive-org-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('admin:orgs.archive.title', { name: org?.name ?? '' })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('admin:orgs.archive.body')}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-1.5">
          <Label htmlFor="archive-org-gate">
            {t('admin:orgs.archive.confirmHint', { value: org?.name ?? '' })}
          </Label>
          <Input
            id="archive-org-gate"
            value={typed}
            autoComplete="off"
            data-testid="archive-org-gate"
            onChange={(event) => {
              setTyped(event.target.value);
            }}
            onKeyDown={(event) => {
              // Enter submits from the gate — the only field here, so there is
              // no ambiguity about what it would submit.
              if (event.key === 'Enter') {
                event.preventDefault();
                confirm();
              }
            }}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={archive.isPending}>
            {t('common:actions.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: 'destructive' }))}
            disabled={!unlocked || archive.isPending}
            // Radix closes the dialog on Action by default; the mutation owns
            // the close so a failure leaves the dialog open with its toast.
            onClick={(event) => {
              event.preventDefault();
              confirm();
            }}
          >
            {archive.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('admin:orgs.archive.submit')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default ArchiveOrgDialog;
