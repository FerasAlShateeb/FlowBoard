import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import { z } from 'zod';
import { createTeamInputSchema, type Team } from '@flowboard/shared';

import { useOrgBySlug } from '@/hooks/useOrgs';
import {
  useCreateTeam,
  useDeleteTeam,
  useReplaceTeamMembers,
  useTeam,
  useTeams,
  useUpdateTeam,
} from '@/hooks/useTeams';
import FormDialog from '@/components/common/FormDialog';
import PageHeader from '@/components/common/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import ErrorState from '@/components/common/ErrorState';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import { UserMultiSelect } from '@/components/common/UserSelect';
import UserAvatar from '@/components/common/UserAvatar';
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
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

/**
 * `/o/:orgSlug/teams` — the org's grouping layer.
 *
 * Worth restating on the page that edits them: a team is NOT a permission
 * boundary. A project may name an owning team for filtering and reporting, but
 * access is decided by project membership plus the org-admin widening rule.
 * The subtitle says so, because "add someone to the team so they can see the
 * project" is the obvious wrong guess.
 *
 * THE ROSTER IS REPLACED WHOLESALE (`PUT …/members`). A multi-select produces a
 * final set, and one idempotent request beats a burst of add/remove calls that
 * can half-apply.
 */

type TeamValues = z.input<typeof createTeamInputSchema>;

export default function OrgTeamsPage() {
  const { t } = useTranslation(['orgs', 'common']);
  const { orgSlug = '' } = useParams<{ orgSlug: string }>();

  const { org } = useOrgBySlug(orgSlug);
  const orgId = org?.id ?? '';
  const isAdmin = org?.role === 'admin';

  const { data: teams, isPending, error, refetch } = useTeams(org?.id);

  const [editing, setEditing] = useState<Team | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Team | null>(null);
  const [managing, setManaging] = useState<Team | null>(null);

  const deleteTeam = useDeleteTeam(orgId);

  const confirmDelete = () => {
    if (!deleting) return;
    deleteTeam.mutate(deleting.id, {
      onSuccess: () => {
        toast.success(t('orgs:teams.deleted'));
        setDeleting(null);
      },
    });
  };

  return (
    <section>
      <PageHeader
        title={t('orgs:teams.title')}
        description={t('orgs:teams.subtitle')}
        actions={
          isAdmin ? (
            <Button
              size="sm"
              onClick={() => {
                setCreating(true);
              }}
            >
              <Plus aria-hidden />
              {t('orgs:teams.create')}
            </Button>
          ) : undefined
        }
      />

      {error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : isPending ? (
        <div className="grid gap-[var(--gap)] sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
          {[0, 1, 2].map((index) => (
            <Card key={index} className="gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
            </Card>
          ))}
        </div>
      ) : (teams?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<Users className="size-4" />}
          title={t('orgs:teams.empty')}
          message={t('orgs:teams.emptyBody')}
        />
      ) : (
        <ul className="grid gap-[var(--gap)] sm:grid-cols-2 lg:grid-cols-3">
          {(teams ?? []).map((team) => (
            <li key={team.id}>
              <Card className="h-full gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{team.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('orgs:teams.members', { count: team.memberCount })}
                    </p>
                  </div>
                  {isAdmin ? (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('orgs:teams.editTitle')}
                        onClick={() => {
                          setEditing(team);
                        }}
                      >
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('orgs:teams.deleteTitle', { name: team.name })}
                        onClick={() => {
                          setDeleting(team);
                        }}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  ) : null}
                </div>

                {team.description ? (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{team.description}</p>
                ) : null}

                {isAdmin ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-auto w-full"
                    onClick={() => {
                      setManaging(team);
                    }}
                  >
                    <Users aria-hidden />
                    {t('orgs:teams.manageMembers')}
                  </Button>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {isAdmin ? (
        <>
          <TeamFormDialog orgId={orgId} open={creating} onOpenChange={setCreating} team={null} />
          <TeamFormDialog
            orgId={orgId}
            // Keyed by team id so the form remounts (and re-seeds) when a
            // different team is opened rather than keeping the previous values.
            key={editing?.id ?? 'edit'}
            open={editing !== null}
            onOpenChange={(next) => {
              if (!next) setEditing(null);
            }}
            team={editing}
          />
          <TeamMembersDialog
            orgId={orgId}
            team={managing}
            onOpenChange={(next) => {
              if (!next) setManaging(null);
            }}
          />
          <ConfirmDialog
            open={deleting !== null}
            onOpenChange={(next) => {
              if (!next) setDeleting(null);
            }}
            title={t('orgs:teams.deleteTitle', { name: deleting?.name ?? '' })}
            description={t('orgs:teams.deleteBody')}
            confirmLabel={t('common:actions.delete')}
            isPending={deleteTeam.isPending}
            onConfirm={confirmDelete}
          />
        </>
      ) : null}
    </section>
  );
}

/** Create or rename — one form, because the fields are identical. */
function TeamFormDialog({
  orgId,
  open,
  onOpenChange,
  team,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` creates; a team edits it. */
  team: Team | null;
}) {
  const { t } = useTranslation(['orgs', 'common']);
  const createTeam = useCreateTeam(orgId);
  const updateTeam = useUpdateTeam(orgId);

  const form = useForm<TeamValues>({
    resolver: zodResolver(createTeamInputSchema),
    defaultValues: { name: team?.name ?? '', description: team?.description ?? null },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  useEffect(() => {
    if (open) form.reset({ name: team?.name ?? '', description: team?.description ?? null });
    // Re-seeding on OPEN, not on mount: the dialog stays mounted between uses.
    // deps are the FIELD VALUES, not the objects: `form` is stable across renders (RHF) and the
    // data object is rebuilt every render, so depending on either would reset the form under
    // the user mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above.
  }, [open, team?.name, team?.description]);

  const onSubmit = (values: TeamValues) => {
    const done = (message: string) => () => {
      toast.success(message);
      onOpenChange(false);
    };

    // Input type → output type: `description` is optional on the way in and
    // nullable on the wire.
    const payload = { name: values.name, description: values.description ?? null };

    if (team) {
      updateTeam.mutate(
        { teamId: team.id, ...payload },
        { onSuccess: done(t('orgs:teams.updated')) },
      );
      return;
    }
    createTeam.mutate(payload, { onSuccess: done(t('orgs:teams.created')) });
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={team ? t('orgs:teams.editTitle') : t('orgs:teams.createTitle')}
      form={form}
      onSubmit={onSubmit}
      submitLabel={team ? t('common:actions.save') : t('common:actions.create')}
      isPending={createTeam.isPending || updateTeam.isPending}
    >
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('orgs:teams.name')}</FormLabel>
            <FormControl>
              <Input {...field} autoFocus placeholder={t('orgs:teams.namePlaceholder')} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('orgs:teams.description')}</FormLabel>
            <FormControl>
              <Textarea
                value={field.value ?? ''}
                onBlur={field.onBlur}
                name={field.name}
                ref={field.ref}
                rows={3}
                placeholder={t('orgs:teams.descriptionPlaceholder')}
                onChange={(event) => {
                  const next = event.target.value;
                  field.onChange(next.length === 0 ? null : next);
                }}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialog>
  );
}

/**
 * The roster editor.
 *
 * Not a `FormDialog`: there is no zod schema to bind and no field validation —
 * the payload is an array of ids, and an empty one is legal ("no members").
 * A plain dialog with a multi-select is the honest shape.
 */
function TeamMembersDialog({
  orgId,
  team,
  onOpenChange,
}: {
  orgId: string;
  team: Team | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(['orgs', 'common']);
  const { data: detail, isPending } = useTeam(orgId, team?.id);
  const replaceMembers = useReplaceTeamMembers(orgId);

  const [selected, setSelected] = useState<string[]>([]);

  // Seed from the server's roster whenever a different team is opened, or the
  // detail lands after the dialog is already showing.
  useEffect(() => {
    if (detail) setSelected(detail.members.map((member) => member.user.id));
  }, [detail]);

  const save = () => {
    if (!team) return;
    replaceMembers.mutate(
      { teamId: team.id, userIds: selected },
      {
        onSuccess: () => {
          toast.success(t('orgs:teams.membersSaved'));
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={team !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('orgs:teams.membersTitle', { name: team?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('orgs:teams.membersDescription')}</DialogDescription>
        </DialogHeader>

        {isPending ? (
          <Skeleton className="h-8 w-full" />
        ) : (
          <UserMultiSelect
            orgId={orgId}
            value={selected}
            onChange={setSelected}
            placeholder={t('orgs:teams.manageMembers')}
            ariaLabel={t('orgs:teams.membersTitle', { name: team?.name ?? '' })}
          />
        )}

        {selected.length === 0 && !isPending ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <UserAvatar user={null} size="xs" />
            {t('orgs:teams.noMembers')}
          </p>
        ) : null}

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
          <Button size="sm" disabled={replaceMembers.isPending} onClick={save}>
            {t('common:actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
