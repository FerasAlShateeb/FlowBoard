import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Link2, Search, Trash2, Users } from 'lucide-react';
import type { Invite, OrgMember, OrgRole } from '@flowboard/shared';

import { getIntlLocale } from '@/lib/lang-policy';
import {
  inviteLink,
  useOrgBySlug,
  useOrgInvites,
  useOrgMembers,
  useRemoveOrgMember,
  useRevokeInvite,
  useUpdateOrgMember,
} from '@/hooks/useOrgs';
import { useAuthStore } from '@/stores/useAuthStore';
import InviteDialog from '@/components/org/InviteDialog';
import PageHeader from '@/components/common/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import CopyButton from '@/components/common/CopyButton';
import RoleBadge from '@/components/common/RoleBadge';
import { UserChip } from '@/components/common/UserAvatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * `/o/:orgSlug/members` — who is in the organization, and the links that let
 * more people in.
 *
 * ROLE EDITING IS INLINE. A role is a single closed choice with two values, so
 * a dialog to change it would be three interactions for one decision. The
 * select writes straight through, and a failure toasts and reverts by refetch.
 *
 * THE LAST-ADMIN GUARD is client-side chrome only: the select disables demoting
 * yourself when you are the only admin. The server enforces it for real — this
 * just avoids offering an action that is going to be refused.
 */
export default function OrgMembersPage() {
  const { t } = useTranslation(['orgs', 'common']);
  const { orgSlug = '' } = useParams<{ orgSlug: string }>();
  const [filter, setFilter] = useState('');
  const [removing, setRemoving] = useState<OrgMember | null>(null);

  const myId = useAuthStore((state) => state.user?.id ?? null);
  const { org } = useOrgBySlug(orgSlug);
  const isAdmin = org?.role === 'admin';

  const { data: members, isPending, error, refetch } = useOrgMembers(org?.id);
  // Invites are admin-only surface; a member requesting them would just 403.
  const { data: invites } = useOrgInvites(org?.id, { enabled: isAdmin });

  const updateMember = useUpdateOrgMember(org?.id ?? '');
  const removeMember = useRemoveOrgMember(org?.id ?? '');

  const adminCount = (members ?? []).filter((member) => member.role === 'admin').length;

  const needle = filter.trim().toLowerCase();
  const visible = (members ?? []).filter(
    (member) =>
      needle.length === 0 ||
      member.user.name.toLowerCase().includes(needle) ||
      member.email.toLowerCase().includes(needle),
  );

  const changeRole = (member: OrgMember, role: OrgRole) => {
    updateMember.mutate(
      { userId: member.user.id, role },
      {
        onSuccess: () => {
          toast.success(
            t('orgs:members.roleChanged', {
              name: member.user.name,
              role: role === 'admin' ? t('orgs:roles.admin') : t('orgs:roles.member'),
            }),
          );
        },
      },
    );
  };

  const confirmRemove = () => {
    if (!removing) return;
    removeMember.mutate(removing.user.id, {
      onSuccess: () => {
        toast.success(t('orgs:members.removed', { name: removing.user.name }));
        setRemoving(null);
      },
    });
  };

  return (
    <section className="flex flex-col gap-[var(--gap)]">
      <PageHeader
        title={t('orgs:members.title')}
        description={t('orgs:members.subtitle', { org: org?.name ?? orgSlug })}
        actions={isAdmin && org ? <InviteDialog orgId={org.id} orgName={org.name} /> : undefined}
      >
        {(members?.length ?? 0) > 0 ? (
          <div className="relative max-w-xs">
            <Search
              className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
              }}
              className="h-7 ps-8 text-xs"
              placeholder={t('orgs:members.searchPlaceholder')}
              aria-label={t('orgs:members.searchPlaceholder')}
            />
          </div>
        ) : null}
      </PageHeader>

      {error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : isPending ? (
        <TableSkeleton />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Users className="size-4" />}
          title={needle ? t('common:states.noResults') : t('orgs:members.empty')}
          message={needle ? undefined : t('orgs:members.emptyBody')}
        />
      ) : (
        <Card className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('orgs:members.columnMember')}</TableHead>
                <TableHead className="hidden md:table-cell">
                  {t('orgs:members.columnJoined')}
                </TableHead>
                <TableHead className="w-40">{t('orgs:members.columnRole')}</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">{t('orgs:members.columnActions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((member) => {
                const isMe = member.user.id === myId;
                // Demoting the only admin would lock the org; the server
                // refuses it, so the control simply is not offered.
                const lockedAdmin = member.role === 'admin' && adminCount <= 1;

                return (
                  <TableRow key={member.user.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <UserChip user={member.user} secondary={member.email} />
                        {isMe ? <Badge variant="outline">{t('orgs:members.you')}</Badge> : null}
                      </div>
                    </TableCell>

                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                      {formatDate(member.joinedAt)}
                    </TableCell>

                    <TableCell>
                      {isAdmin ? (
                        <Select
                          value={member.role}
                          disabled={lockedAdmin || updateMember.isPending}
                          onValueChange={(value) => {
                            changeRole(member, value === 'admin' ? 'admin' : 'member');
                          }}
                        >
                          <SelectTrigger
                            size="sm"
                            className="w-full"
                            aria-label={t('orgs:members.columnRole')}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="member">{t('orgs:roles.member')}</SelectItem>
                            <SelectItem value="admin">{t('orgs:roles.admin')}</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <RoleBadge role={member.role} />
                      )}
                      {lockedAdmin && isAdmin ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {t('orgs:members.lastAdmin')}
                        </p>
                      ) : null}
                    </TableCell>

                    <TableCell>
                      {isAdmin && !lockedAdmin ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('orgs:members.removeTitle', { name: member.user.name })}
                          onClick={() => {
                            setRemoving(member);
                          }}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {isAdmin && org ? <PendingInvites orgId={org.id} invites={invites} /> : null}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => {
          if (!next) setRemoving(null);
        }}
        title={t('orgs:members.removeTitle', { name: removing?.user.name ?? '' })}
        description={t('orgs:members.removeBody')}
        confirmLabel={t('common:actions.remove')}
        isPending={removeMember.isPending}
        onConfirm={confirmRemove}
      />
    </section>
  );
}

/** The pending-invite list: copy a link, or revoke it. */
function PendingInvites({ orgId, invites }: { orgId: string; invites: Invite[] | undefined }) {
  const { t } = useTranslation(['orgs', 'common']);
  const [revoking, setRevoking] = useState<Invite | null>(null);
  const revokeInvite = useRevokeInvite(orgId);

  // Accepted invites are history, not pending work — the list only shows what
  // someone could still act on.
  const pending = (invites ?? []).filter((invite) => invite.acceptedAt === null);

  const confirmRevoke = () => {
    if (!revoking) return;
    revokeInvite.mutate(revoking.id, {
      onSuccess: () => {
        toast.success(t('orgs:invites.revoked'));
        setRevoking(null);
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('orgs:invites.title')}</CardTitle>
        <CardDescription>{t('orgs:invites.subtitle')}</CardDescription>
      </CardHeader>

      {pending.length === 0 ? (
        <p className="py-3 text-xs text-muted-foreground">{t('orgs:invites.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {pending.map((invite) => {
            const expired = new Date(invite.expiresAt).getTime() < Date.now();
            return (
              <li key={invite.id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                <Link2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground" dir="ltr">
                    {invite.email ?? t('orgs:invites.anyone')}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {/* `createdBy` is nullable: `invites.invited_by_id` is ON
                        DELETE SET NULL, so a link outlives the admin who minted
                        it. */}
                    {invite.createdBy
                      ? t('orgs:invites.invitedBy', { name: invite.createdBy.name })
                      : t('orgs:invites.invitedByUnknown')}{' '}
                    ·{' '}
                    {expired
                      ? t('orgs:invites.expired')
                      : t('orgs:invites.expiresOn', { date: formatDate(invite.expiresAt) })}
                  </p>
                </div>

                <RoleBadge role={invite.orgRole} />

                <CopyButton
                  value={inviteLink(invite.token)}
                  label={t('orgs:invites.copyLink')}
                  onCopied={() => {
                    toast.success(t('orgs:invites.linkCopied'));
                  }}
                />

                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('orgs:invites.revoke')}
                  onClick={() => {
                    setRevoking(invite);
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(next) => {
          if (!next) setRevoking(null);
        }}
        title={t('orgs:invites.revokeTitle')}
        description={t('orgs:invites.revokeBody')}
        confirmLabel={t('orgs:invites.revoke')}
        isPending={revokeInvite.isPending}
        onConfirm={confirmRevoke}
      />
    </Card>
  );
}

/** Medium date in the user's locale, with Western digits under `ar`. */
function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), { dateStyle: 'medium' }).format(new Date(iso));
}

function TableSkeleton() {
  return (
    <Card className="gap-2" aria-hidden>
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-6 rounded-full" />
          <Skeleton className="h-3 w-40" />
          <Skeleton className="ms-auto h-6 w-24" />
        </div>
      ))}
    </Card>
  );
}
