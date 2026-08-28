import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { z } from 'zod';
import { createInviteInputSchema, type Invite } from '@flowboard/shared';

import { inviteLink, useCreateInvite } from '@/hooks/useOrgs';
import { useProjects } from '@/hooks/useProjects';
import FormDialog from '@/components/common/FormDialog';
import CopyButton from '@/components/common/CopyButton';
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

/**
 * Mint an invitation link.
 *
 * THE TOKEN IS SHOWN ONCE, at creation, and the dialog stays open afterwards to
 * show it — that is why this component holds `created` state rather than
 * closing on success. The pending-invites list can re-copy the link later
 * (`inviteSchema` carries the token for admins), but surfacing it immediately
 * is what makes the flow one step instead of two.
 *
 * THE PROJECT GRANT is optional and conditional: `createInviteInputSchema`
 * refuses a `projectId` with no `projectRole`, so the role select only appears
 * once a project is chosen — which turns a cross-field validation error into a
 * field that simply is not there yet.
 */

type InviteValues = z.input<typeof createInviteInputSchema>;

/** Offered link lifetimes. Seven days is the default the contract also uses. */
const EXPIRY_CHOICES = [1, 7, 14, 30, 90] as const;

export function InviteDialog({ orgId, orgName }: { orgId: string; orgName: string }) {
  const { t } = useTranslation(['orgs', 'common']);
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<Invite | null>(null);

  const createInvite = useCreateInvite(orgId);
  const { data: projects } = useProjects(orgId);

  const form = useForm<InviteValues>({
    resolver: zodResolver(createInviteInputSchema),
    defaultValues: {
      email: null,
      orgRole: 'member',
      projectId: null,
      projectRole: null,
      expiresInDays: 7,
    },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const projectId = form.watch('projectId');

  const openDialog = () => {
    setCreated(null);
    form.reset({
      email: null,
      orgRole: 'member',
      projectId: null,
      projectRole: null,
      expiresInDays: 7,
    });
    setOpen(true);
  };

  const onSubmit = (values: InviteValues) => {
    // Input type → output type: the schema's defaults are applied here (see
    // `CreateProjectDialog` for the full reasoning).
    createInvite.mutate(
      {
        email: values.email ?? null,
        orgRole: values.orgRole ?? 'member',
        projectId: values.projectId ?? null,
        projectRole: values.projectRole ?? null,
        expiresInDays: values.expiresInDays ?? 7,
      },
      {
        onSuccess: (invite) => {
          setCreated(invite);
          toast.success(t('orgs:invites.created'));
        },
      },
    );
  };

  return (
    <>
      <Button size="sm" onClick={openDialog}>
        <UserPlus aria-hidden />
        {t('orgs:invites.trigger')}
      </Button>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={t('orgs:invites.dialogTitle', { org: orgName })}
        description={t('orgs:invites.dialogDescription')}
        form={form}
        onSubmit={onSubmit}
        submitLabel={t('orgs:invites.submit')}
        cancelLabel={created ? t('common:actions.close') : undefined}
        isPending={createInvite.isPending}
      >
        {created ? (
          /* The link, once. A read-only input rather than a paragraph so it can
             be selected and dragged as well as copied. */
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">{t('orgs:invites.copyLink')}</span>
            <div className="flex items-center gap-1.5">
              <Input
                readOnly
                dir="ltr"
                value={inviteLink(created.token)}
                className="font-mono text-xs"
                onFocus={(event) => {
                  event.target.select();
                }}
              />
              <CopyButton
                value={inviteLink(created.token)}
                label={t('orgs:invites.copyLink')}
                onCopied={() => {
                  toast.success(t('orgs:invites.linkCopied'));
                }}
              />
            </div>
          </div>
        ) : null}

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('orgs:invites.email')}</FormLabel>
              <FormControl>
                <Input
                  value={field.value ?? ''}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                  type="email"
                  inputMode="email"
                  dir="ltr"
                  placeholder={t('orgs:invites.emailPlaceholder')}
                  onChange={(event) => {
                    // An open (shareable) link is `null`, not `''` — the schema
                    // would reject an empty string as a malformed address.
                    const next = event.target.value.trim();
                    field.onChange(next.length === 0 ? null : next);
                  }}
                />
              </FormControl>
              <FormDescription>{t('orgs:invites.emailHint')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="orgRole"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('orgs:invites.orgRole')}</FormLabel>
                <Select value={field.value ?? 'member'} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="member">{t('orgs:roles.member')}</SelectItem>
                    <SelectItem value="admin">{t('orgs:roles.admin')}</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="expiresInDays"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('orgs:invites.expiresIn')}</FormLabel>
                <Select
                  value={String(field.value ?? 7)}
                  onValueChange={(value) => {
                    field.onChange(Number(value));
                  }}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {EXPIRY_CHOICES.map((days) => (
                      <SelectItem key={days} value={String(days)}>
                        {t('orgs:invites.days', { count: days })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="projectId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('orgs:invites.project')}</FormLabel>
                <Select
                  value={field.value ?? 'none'}
                  onValueChange={(value) => {
                    const next = value === 'none' ? null : value;
                    field.onChange(next);
                    // Clearing the project must clear the role with it, or the
                    // body carries a role for a project it no longer grants.
                    form.setValue('projectRole', next === null ? null : 'member');
                  }}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="none">{t('orgs:createProject.none')}</SelectItem>
                    {(projects ?? []).map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {projectId ? (
            <FormField
              control={form.control}
              name="projectRole"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('orgs:invites.projectRole')}</FormLabel>
                  <Select value={field.value ?? 'member'} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="viewer">{t('orgs:roles.viewer')}</SelectItem>
                      <SelectItem value="member">{t('orgs:roles.member')}</SelectItem>
                      <SelectItem value="admin">{t('orgs:roles.admin')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}
        </div>
      </FormDialog>
    </>
  );
}

export default InviteDialog;
