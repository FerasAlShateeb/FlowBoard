import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { z } from 'zod';
import { createProjectInputSchema } from '@flowboard/shared';

import { normalizeProjectKey, suggestProjectKey } from '@/lib/project-key';
import { projectPath } from '@/hooks/useRouteScope';
import { useCreateProject } from '@/hooks/useProjects';
import { useTeams } from '@/hooks/useTeams';
import FormDialog from '@/components/common/FormDialog';
import UserSelect from '@/components/common/UserSelect';
import { Button } from '@/components/ui/button';
import {
  FormControl,
  FormDescription,
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
 * Create a project — the org-admin action on the org home grid.
 *
 * THE ONE INTERESTING BEHAVIOUR is the key field. It follows the name
 * (`Payments Platform` → `PP`) until the user edits it, and then it stops:
 * `keyTouched` latches on the first manual keystroke and is never unset. That
 * matters because a key cannot be changed after creation — it is baked into
 * every task key, every deep link and every pasted reference — so silently
 * overwriting a deliberate choice on the next name keystroke would produce a
 * permanent mistake.
 *
 * On success the user is taken STRAIGHT TO THE NEW BOARD rather than back to
 * the grid: they just described a project, and the next thing they want is
 * somewhere to put work.
 */

type CreateProjectValues = z.input<typeof createProjectInputSchema>;

export function CreateProjectDialog({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const { t } = useTranslation(['orgs', 'common']);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // A ref, not state: nothing renders from it, and it must not schedule a
  // re-render in the middle of the name field's onChange.
  const keyTouched = useRef(false);

  const createProject = useCreateProject(orgId);
  const { data: teams } = useTeams(orgId);

  const form = useForm<CreateProjectValues>({
    resolver: zodResolver(createProjectInputSchema),
    defaultValues: {
      name: '',
      key: '',
      description: null,
      teamId: null,
      leadId: null,
    },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const openDialog = () => {
    keyTouched.current = false;
    form.reset({ name: '', key: '', description: null, teamId: null, leadId: null });
    setOpen(true);
  };

  const onSubmit = (values: CreateProjectValues) => {
    // The form binds the schema's INPUT type, where every defaulted field is
    // optional; the request takes its OUTPUT type, where they are not. The
    // defaults are applied here rather than widening the mutation's signature,
    // so the contract stays the single authority on what a create looks like.
    createProject.mutate(
      {
        key: values.key,
        name: values.name,
        description: values.description ?? null,
        teamId: values.teamId ?? null,
        leadId: values.leadId ?? null,
      },
      {
        onSuccess: (project) => {
          toast.success(t('orgs:createProject.success', { key: project.key }));
          setOpen(false);
          void navigate(projectPath(orgSlug, project.key, 'board'));
        },
      },
    );
  };

  const keyValue = form.watch('key') || t('orgs:createProject.keyPlaceholder');

  return (
    <>
      <Button size="sm" onClick={openDialog}>
        <Plus aria-hidden />
        {t('orgs:createProject.trigger')}
      </Button>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t('orgs:createProject.title')}
        description={t('orgs:createProject.description')}
        form={form}
        onSubmit={onSubmit}
        submitLabel={t('orgs:createProject.submit')}
        isPending={createProject.isPending}
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('orgs:createProject.name')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoFocus
                  placeholder={t('orgs:createProject.namePlaceholder')}
                  onChange={(event) => {
                    field.onChange(event);
                    if (keyTouched.current) return;
                    const suggested = suggestProjectKey(event.target.value);
                    // `shouldValidate: false` — suggesting a one-character key
                    // mid-typing and immediately flagging it as too short is
                    // the app arguing with the user about its own guess.
                    form.setValue('key', suggested, { shouldValidate: false });
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="key"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('orgs:createProject.key')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  // A key is a Latin identifier in every locale.
                  dir="ltr"
                  className="font-mono uppercase"
                  maxLength={10}
                  placeholder={t('orgs:createProject.keyPlaceholder')}
                  onChange={(event) => {
                    keyTouched.current = true;
                    // Normalizing on the way in means the field can never hold
                    // a value the schema rejects — no error for a character the
                    // input could simply have refused.
                    field.onChange(normalizeProjectKey(event.target.value));
                  }}
                />
              </FormControl>
              <FormDescription>
                {t('orgs:createProject.keyHint', { key: keyValue })}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('orgs:createProject.projectDescription')}</FormLabel>
              <FormControl>
                <Textarea
                  value={field.value ?? ''}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                  rows={3}
                  placeholder={t('orgs:createProject.descriptionPlaceholder')}
                  onChange={(event) => {
                    // The contract's "no description" is `null`, not `''`.
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
                <FormLabel>{t('orgs:createProject.lead')}</FormLabel>
                <UserSelect
                  orgId={orgId}
                  value={field.value ?? null}
                  onChange={field.onChange}
                  ariaLabel={t('orgs:createProject.lead')}
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
                <FormLabel>{t('orgs:createProject.team')}</FormLabel>
                <Select
                  // Radix Select has no empty-string value, so "none" needs a
                  // sentinel of its own; it is mapped back to `null` on change.
                  value={field.value ?? 'none'}
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
                    <SelectItem value="none">{t('orgs:createProject.none')}</SelectItem>
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
      </FormDialog>
    </>
  );
}

export default CreateProjectDialog;
