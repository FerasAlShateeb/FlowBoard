import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus, Trash2, Users } from 'lucide-react';
import type { ProjectMember, ProjectRole } from '@flowboard/shared';

import { getIntlLocale } from '@/lib/lang-policy';
import {
  canAdminProject,
  useAddProjectMember,
  useProjectMembers,
  useProjectScope,
  useRemoveProjectMember,
  useUpdateProjectMember,
} from '@/hooks/useProjects';
import PageSpinner from '@/components/common/PageSpinner';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import RoleBadge from '@/components/common/RoleBadge';
import UserSelect from '@/components/common/UserSelect';
import { UserChip } from '@/components/common/UserAvatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * Project settings → Members. The org members table, one level down.
 *
 * THE THREE ROLES here are not the org's two: `viewer` reads, `member` writes
 * tasks, `admin` edits the project and its workflow. The note at the bottom
 * says the part that is invisible in the table — an ORG admin administers every
 * project without appearing in any project's roster, because the widening chain
 * (global ⊃ org ⊃ project) is resolved server-side.
 */
export default function ProjectMembersPage() {
  const { t } = useTranslation(['settings', 'orgs', 'common']);
  const { orgId, projectId, project, role, isPending, error } = useProjectScope();
  const canAdmin = canAdminProject(role);

  const {
    data: members,
    isPending: membersPending,
    error: membersError,
    refetch,
  } = useProjectMembers(projectId);

  const updateMember = useUpdateProjectMember(projectId ?? '');
  const removeMember = useRemoveProjectMember(projectId ?? '');

  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ProjectMember | null>(null);

  if (isPending) return <PageSpinner />;
  if (error) return <ErrorState error={error} />;

  const roleLabel = (value: ProjectRole): string =>
    value === 'admin'
      ? t('orgs:roles.admin')
      : value === 'member'
        ? t('orgs:roles.member')
        : t('orgs:roles.viewer');

  const changeRole = (member: ProjectMember, next: ProjectRole) => {
    updateMember.mutate(
      { userId: member.user.id, role: next },
      {
        onSuccess: () => {
          toast.success(
            t('settings:members.roleChanged', {
              name: member.user.name,
              role: roleLabel(next),
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
        toast.success(t('settings:members.removed', { name: removing.user.name }));
        setRemoving(null);
      },
    });
  };

  return (
    <div className="flex flex-col gap-[var(--gap)]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{t('settings:members.title')}</h2>
          <p className="text-xs text-muted-foreground">
            {t('settings:members.subtitle', { project: project?.name ?? '' })}
          </p>
        </div>
        {canAdmin ? (
          <Button
            size="sm"
            onClick={() => {
              setAdding(true);
            }}
          >
            <Plus aria-hidden />
            {t('settings:members.add')}
          </Button>
        ) : null}
      </div>

      {membersError ? (
        <ErrorState
          error={membersError}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : membersPending ? (
        <PageSpinner />
      ) : (members?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<Users className="size-4" />}
          title={t('settings:members.empty')}
          message={t('settings:members.emptyBody')}
        />
      ) : (
        <Card className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('settings:members.columnMember')}</TableHead>
                <TableHead className="hidden md:table-cell">
                  {t('settings:members.columnJoined')}
                </TableHead>
                <TableHead className="w-40">{t('settings:members.columnRole')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(members ?? []).map((member) => (
                <TableRow key={member.user.id}>
                  <TableCell>
                    <UserChip user={member.user} />
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                    {new Intl.DateTimeFormat(getIntlLocale(), { dateStyle: 'medium' }).format(
                      new Date(member.joinedAt),
                    )}
                  </TableCell>
                  <TableCell>
                    {canAdmin ? (
                      <Select
                        value={member.role}
                        disabled={updateMember.isPending}
                        onValueChange={(value) => {
                          changeRole(member, value as ProjectRole);
                        }}
                      >
                        <SelectTrigger
                          size="sm"
                          className="w-full"
                          aria-label={t('settings:members.columnRole')}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="viewer">{t('orgs:roles.viewer')}</SelectItem>
                          <SelectItem value="member">{t('orgs:roles.member')}</SelectItem>
                          <SelectItem value="admin">{t('orgs:roles.admin')}</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <RoleBadge role={member.role} />
                    )}
                  </TableCell>
                  <TableCell>
                    {canAdmin ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('settings:members.removeTitle', {
                          name: member.user.name,
                        })}
                        onClick={() => {
                          setRemoving(member);
                        }}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <p className="text-[11px] text-muted-foreground">{t('settings:members.inheritedNote')}</p>

      <AddMemberDialog
        orgId={orgId}
        projectId={projectId ?? ''}
        open={adding}
        onOpenChange={setAdding}
        existingIds={(members ?? []).map((member) => member.user.id)}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => {
          if (!next) setRemoving(null);
        }}
        title={t('settings:members.removeTitle', { name: removing?.user.name ?? '' })}
        description={t('settings:members.removeBody')}
        confirmLabel={t('common:actions.remove')}
        isPending={removeMember.isPending}
        onConfirm={confirmRemove}
      />
    </div>
  );
}

/**
 * Grant an org member a project role.
 *
 * Not a `FormDialog`: the payload is two enum-ish choices with no free text and
 * no cross-field rules, so zod would validate nothing a disabled submit button
 * does not already prevent.
 */
function AddMemberDialog({
  orgId,
  projectId,
  open,
  onOpenChange,
  existingIds,
}: {
  orgId: string | null;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingIds: readonly string[];
}) {
  const { t } = useTranslation(['settings', 'orgs', 'common']);
  const addMember = useAddProjectMember(projectId);

  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<ProjectRole>('member');

  const submit = () => {
    if (!userId) return;
    addMember.mutate(
      { userId, role },
      {
        onSuccess: (member) => {
          toast.success(t('settings:members.added', { name: member.user.name }));
          setUserId(null);
          setRole('member');
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('settings:members.addTitle')}</DialogTitle>
          <DialogDescription>{t('settings:members.addDescription')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5">
          <Label htmlFor="add-member-person">{t('settings:members.person')}</Label>
          <UserSelect
            orgId={orgId}
            value={userId}
            onChange={setUserId}
            allowClear={false}
            // Someone already on the project would just produce a conflict.
            excludeIds={existingIds}
            ariaLabel={t('settings:members.person')}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="add-member-role">{t('settings:members.role')}</Label>
          <Select
            value={role}
            onValueChange={(value) => {
              setRole(value as ProjectRole);
            }}
          >
            <SelectTrigger id="add-member-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="viewer">{t('orgs:roles.viewer')}</SelectItem>
              <SelectItem value="member">{t('orgs:roles.member')}</SelectItem>
              <SelectItem value="admin">{t('orgs:roles.admin')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button size="sm" disabled={!userId || addMember.isPending} onClick={submit}>
            {t('common:actions.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
