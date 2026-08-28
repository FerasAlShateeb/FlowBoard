import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';
import { nameSchema, projectDescriptionSchema, uuid } from '@flowboard/shared';

import {
  canAdminProject,
  useDeleteProject,
  useProjectScope,
  useUpdateProject,
} from '@/hooks/useProjects';
import { useTeams } from '@/hooks/useTeams';
import PageSpinner from '@/components/common/PageSpinner';
import ErrorState from '@/components/common/ErrorState';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import UserSelect from '@/components/common/UserSelect';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

/**
 * Project settings → General.
 *
 * THE KEY IS READ-ONLY, and shown anyway. It is baked into every existing task
 * key (`FLOW-123`), every deep link and every pasted reference, so renaming it
 * would silently break history — `updateProjectInputSchema` omits it for that
 * reason. Displaying it disabled, with the explanation underneath, answers
 * "can I change this?" without anyone having to try.
 */

/**
 * The editable fields, assembled from the shared field schemas.
 *
 * `updateProjectInputSchema` itself is `.partial()` with an at-least-one-field
 * refinement — correct for a PATCH body, wrong for a form where every field is
 * always present and "change something" is not a field error.
 */
const generalFormSchema = z.object({
  name: nameSchema,
  description: projectDescriptionSchema,
  leadId: uuid.nullable(),
  teamId: uuid.nullable(),
});

type GeneralValues = z.input<typeof generalFormSchema>;

export default function ProjectGeneralPage() {
  const { t } = useTranslation(['settings', 'common']);
  const navigate = useNavigate();

  const { orgId, orgSlug, projectId, project, role, isPending, error } = useProjectScope();
  const canAdmin = canAdminProject(role);

  const updateProject = useUpdateProject(projectId ?? '', orgId ?? undefined);
  const deleteProject = useDeleteProject(orgId ?? undefined);
  const { data: teams } = useTeams(orgId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const form = useForm<GeneralValues>({
    resolver: zodResolver(generalFormSchema),
    defaultValues: {
      name: project?.name ?? '',
      description: project?.description ?? null,
      leadId: project?.leadId ?? null,
      teamId: project?.teamId ?? null,
    },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  useEffect(() => {
    if (!project) return;
    form.reset({
      name: project.name,
      description: project.description,
      leadId: project.leadId,
      teamId: project.teamId,
    });
    // deps are the FIELD VALUES, not the objects: `form` is stable across renders (RHF) and the
    // data object is rebuilt every render, so depending on either would reset the form under
    // the user mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above.
  }, [project?.id, project?.name, project?.description, project?.leadId, project?.teamId]);

  if (isPending) return <PageSpinner />;
  if (error || !project) return <ErrorState error={error} />;

  const onSubmit = (values: GeneralValues) => {
    updateProject.mutate(values, {
      onSuccess: () => {
        toast.success(t('settings:project.saved'));
      },
    });
  };

  const confirmDelete = () => {
    deleteProject.mutate(project.id, {
      onSuccess: () => {
        toast.success(t('settings:project.deleted'));
        void navigate(`/o/${orgSlug}`, { replace: true });
      },
    });
  };

  return (
    <div className="flex max-w-2xl flex-col gap-[var(--gap)]">
      <Card>
        <CardHeader>
          <CardTitle>{t('settings:project.identity')}</CardTitle>
          <CardDescription>{t('settings:project.identityDescription')}</CardDescription>
        </CardHeader>

        {!canAdmin ? (
          <p className="text-xs text-muted-foreground">{t('settings:project.readOnly')}</p>
        ) : null}

        <Form {...form}>
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              void form.handleSubmit(onSubmit)(event);
            }}
          >
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settings:project.name')}</FormLabel>
                    <FormControl>
                      <Input {...field} disabled={!canAdmin} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Not a FormField — it binds to no form value, because it can
                  never be submitted. */}
              <div className="grid gap-1.5">
                <span className="text-xs font-medium">{t('settings:project.key')}</span>
                <Input value={project.key} readOnly disabled dir="ltr" className="font-mono" />
              </div>
            </div>
            <p className="-mt-2 text-[11px] text-muted-foreground">
              {t('settings:project.keyHint')}
            </p>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('settings:project.description')}</FormLabel>
                  <FormControl>
                    <Textarea
                      value={field.value ?? ''}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                      rows={3}
                      disabled={!canAdmin}
                      placeholder={t('settings:project.descriptionPlaceholder')}
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

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="leadId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settings:project.lead')}</FormLabel>
                    <UserSelect
                      orgId={orgId}
                      value={field.value}
                      onChange={field.onChange}
                      disabled={!canAdmin}
                      ariaLabel={t('settings:project.lead')}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="teamId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settings:project.team')}</FormLabel>
                    <Select
                      value={field.value ?? 'none'}
                      disabled={!canAdmin}
                      onValueChange={(value) => {
                        field.onChange(value === 'none' ? null : value);
                      }}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">{t('settings:project.none')}</SelectItem>
                        {(teams ?? []).map((team) => (
                          <SelectItem key={team.id} value={team.id}>
                            {team.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {canAdmin ? (
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={updateProject.isPending}>
                  {updateProject.isPending ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : null}
                  {t('common:actions.saveChanges')}
                </Button>
              </div>
            ) : null}
          </form>
        </Form>
      </Card>

      {canAdmin ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">{t('settings:project.dangerZone')}</CardTitle>
            <CardDescription>{t('settings:project.dangerDescription')}</CardDescription>
          </CardHeader>
          <div className="flex justify-end">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setConfirmingDelete(true);
              }}
            >
              {t('settings:project.delete')}
            </Button>
          </div>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t('settings:project.deleteTitle', { name: project.name })}
        description={t('settings:project.deleteBody')}
        confirmLabel={t('settings:project.delete')}
        // The second name-gated confirmation in the product. A project delete
        // takes every task with it, so it earns the same friction as an org.
        confirmValue={project.key}
        isPending={deleteProject.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
