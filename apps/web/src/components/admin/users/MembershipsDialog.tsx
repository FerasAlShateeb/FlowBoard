import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminUserRow, OrgRole } from '@flowboard/shared';

import { useAdminOrgs } from '@/hooks/useAdminOrgs';
import { useOrgMembershipMutations } from '@/hooks/useAdminUsers';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * `Manage memberships…` — one account's organizations, edited live.
 *
 * ═══ IT WRITES IMMEDIATELY, AND SAYS SO ══════════════════════════════════
 *
 * There is no Save button. Each row is its own request against the org's own
 * membership endpoints (`POST|PATCH|DELETE /orgs/:orgId/members[/:userId]`), so
 * a dialog-wide "save" would have to batch several independent writes and
 * invent a rollback for the third one failing. The description says changes
 * apply immediately; the footer's only button is Close.
 *
 * ═══ WHY IT REUSES THE ORG ENDPOINTS ═════════════════════════════════════
 *
 * FlowBoard has no admin-scoped membership route, and it does not need one: a
 * global admin passes the org-admin floor on every organization. Minting a
 * parallel `/admin/users/:id/memberships` surface would be a second
 * implementation of the same three writes, with its own activity rows and its
 * own chance to disagree about what "remove" means.
 *
 * The id travels IN THE VARIABLES rather than being bound at hook-creation
 * (see `useOrgMembershipMutations`), because this dialog edits several
 * organizations in one sitting.
 *
 * ═══ THE ROW SHOWN IS THE CACHE'S ════════════════════════════════════════
 *
 * `user.memberships` comes from the list query, and every mutation here
 * invalidates it — so the dialog re-renders from the server's answer rather
 * than from local bookkeeping. That is what keeps it honest when a write is
 * refused: nothing moves until the refetch says it did.
 */
export function MembershipsDialog({
  user,
  onOpenChange,
}: {
  /** The account being edited, or `null` while the dialog is closed. */
  user: AdminUserRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const orgsQuery = useAdminOrgs({});
  const { add, update, remove, isPending } = useOrgMembershipMutations();

  const [draftOrgId, setDraftOrgId] = useState('');
  const [draftRole, setDraftRole] = useState<OrgRole>('member');

  const open = user !== null;
  const memberships = user?.memberships ?? [];
  const joined = new Set(memberships.map((entry) => entry.orgId));
  const available = (orgsQuery.data ?? []).filter((org) => !joined.has(org.id));

  const addMembership = () => {
    if (!user || draftOrgId === '') return;
    const org = (orgsQuery.data ?? []).find((entry) => entry.id === draftOrgId);

    add.mutate(
      { orgId: draftOrgId, userId: user.id, role: draftRole },
      {
        onSuccess: () => {
          toast.success(t('admin:users.memberships.added', { org: org?.name ?? '' }));
          setDraftOrgId('');
          setDraftRole('member');
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="memberships-dialog">
        <DialogHeader>
          <DialogTitle>
            {t('admin:users.memberships.title', { name: user?.name ?? '' })}
          </DialogTitle>
          <DialogDescription>{t('admin:users.memberships.description')}</DialogDescription>
        </DialogHeader>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            {t('admin:users.memberships.current')}
          </h3>

          {memberships.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('admin:users.memberships.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {memberships.map((entry) => (
                <li
                  key={entry.orgId}
                  className="flex items-center gap-2 rounded-[var(--radius)] border border-border px-2 py-1.5"
                  data-testid={`membership-${entry.orgSlug}`}
                >
                  <span className="min-w-0 flex-1 truncate text-sm">{entry.orgName}</span>

                  <Select
                    value={entry.role}
                    disabled={isPending}
                    onValueChange={(next) => {
                      if (!user || next === entry.role) return;
                      update.mutate(
                        {
                          orgId: entry.orgId,
                          userId: user.id,
                          role: next === 'admin' ? 'admin' : 'member',
                        },
                        {
                          onSuccess: () => {
                            toast.success(
                              t('admin:users.memberships.roleChanged', { org: entry.orgName }),
                            );
                          },
                        },
                      );
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-44"
                      aria-label={t('admin:users.memberships.roleFor', { org: entry.orgName })}
                      data-testid={`membership-role-${entry.orgSlug}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">{t('admin:users.orgRole.member')}</SelectItem>
                      <SelectItem value="admin">{t('admin:users.orgRole.admin')}</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={isPending}
                    aria-label={t('admin:users.memberships.remove', { org: entry.orgName })}
                    onClick={() => {
                      if (!user) return;
                      remove.mutate(
                        { orgId: entry.orgId, userId: user.id },
                        {
                          onSuccess: () => {
                            toast.success(
                              t('admin:users.memberships.removed', { org: entry.orgName }),
                            );
                          },
                        },
                      );
                    }}
                  >
                    <X aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2 border-t border-border pt-3">
          <h3 className="text-xs font-medium text-muted-foreground">
            {t('admin:users.memberships.addTitle')}
          </h3>

          {available.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('admin:users.memberships.noneLeft')}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={draftOrgId} onValueChange={setDraftOrgId} disabled={isPending}>
                <SelectTrigger
                  size="sm"
                  className="min-w-40 flex-1"
                  aria-label={t('admin:users.memberships.org')}
                  data-testid="memberships-add-org"
                >
                  <SelectValue placeholder={t('admin:users.memberships.orgPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {available.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={draftRole}
                disabled={isPending}
                onValueChange={(next) => {
                  setDraftRole(next === 'admin' ? 'admin' : 'member');
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-40"
                  aria-label={t('admin:users.memberships.role')}
                  data-testid="memberships-add-role"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">{t('admin:users.orgRole.member')}</SelectItem>
                  <SelectItem value="admin">{t('admin:users.orgRole.admin')}</SelectItem>
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending || draftOrgId === ''}
                onClick={addMembership}
                data-testid="memberships-add"
              >
                <Plus aria-hidden />
                {t('admin:users.memberships.add')}
              </Button>
            </div>
          )}
        </section>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('common:actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default MembershipsDialog;
