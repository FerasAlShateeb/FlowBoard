import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';
import { createOrgInputSchema } from '@flowboard/shared';

import { clearLastOrgSlug } from '@/hooks/useLastOrg';
import { useDeleteOrg, useOrgBySlug, useUpdateOrg } from '@/hooks/useOrgs';
import { useMe } from '@/hooks/useAuth';
import PageHeader from '@/components/common/PageHeader';
import PageSpinner from '@/components/common/PageSpinner';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

/**
 * `/o/:orgSlug/settings` — the organization's identity and its danger zone.
 *
 * TWO PERMISSION LEVELS on one page, which is why the gating is per-card rather
 * than per-page: an org ADMIN can rename and re-slug; only a GLOBAL admin can
 * delete. That asymmetry is deliberate — deleting an org destroys every project
 * and every task inside it, which is a decision above the org's own hierarchy.
 *
 * The delete confirmation is name-GATED (type the org name). That friction is
 * reserved for the two truly irreversible actions in the product; applying it
 * everywhere would train people to type through it.
 */

/**
 * Reuses `createOrgInputSchema` rather than `updateOrgInputSchema`: the latter
 * is `.partial()` with an at-least-one-field refinement, which is right for a
 * PATCH body and wrong for a form where both fields are always present.
 */
type OrgSettingsValues = z.input<typeof createOrgInputSchema>;

export default function OrgSettingsPage() {
  const { t } = useTranslation(['orgs', 'common']);
  const { orgSlug = '' } = useParams<{ orgSlug: string }>();
  const navigate = useNavigate();

  const { org, isPending } = useOrgBySlug(orgSlug);
  const { data: me } = useMe();

  const updateOrg = useUpdateOrg(org?.id ?? '');
  const deleteOrg = useDeleteOrg();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isAdmin = org?.role === 'admin';
  const isGlobalAdmin = me?.isGlobalAdmin === true;

  const form = useForm<OrgSettingsValues>({
    resolver: zodResolver(createOrgInputSchema),
    defaultValues: { name: org?.name ?? '', slug: org?.slug ?? '' },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  // The org resolves out of the ORG LIST query, so on a cold load it arrives
  // after first paint — the form has to re-seed when it does.
  useEffect(() => {
    if (org) form.reset({ name: org.name, slug: org.slug });
    // deps are the FIELD VALUES, not the objects: `form` is stable across renders (RHF) and the
    // data object is rebuilt every render, so depending on either would reset the form under
    // the user mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above.
  }, [org?.id, org?.name, org?.slug]);

  if (isPending) return <PageSpinner />;

  const onSubmit = (values: OrgSettingsValues) => {
    updateOrg.mutate(values, {
      onSuccess: (updated) => {
        toast.success(t('orgs:settings.saved'));
        // The SLUG is in the URL. Changing it without navigating would leave
        // the page pointing at an address that no longer resolves, and the
        // next refresh would 404.
        if (updated.slug !== orgSlug)
          void navigate(`/o/${updated.slug}/settings`, { replace: true });
      },
    });
  };

  const confirmDelete = () => {
    if (!org) return;
    deleteOrg.mutate(org.id, {
      onSuccess: () => {
        toast.success(t('orgs:settings.deleted'));
        // The remembered org is gone; leaving the key set would send the next
        // boot straight at a 404.
        clearLastOrgSlug();
        void navigate('/', { replace: true });
      },
    });
  };

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-[var(--gap)]">
      <PageHeader
        title={t('orgs:settings.title')}
        description={t('orgs:settings.subtitle', { org: org?.name ?? orgSlug })}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('orgs:settings.identity')}</CardTitle>
          <CardDescription>{t('orgs:settings.identityDescription')}</CardDescription>
        </CardHeader>

        <Form {...form}>
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              void form.handleSubmit(onSubmit)(event);
            }}
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('orgs:settings.name')}</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={!isAdmin} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('orgs:settings.slug')}</FormLabel>
                  <FormControl>
                    {/* A slug is a URL segment — Latin, LTR, in every locale. */}
                    <Input {...field} dir="ltr" className="font-mono" disabled={!isAdmin} />
                  </FormControl>
                  <FormDescription>
                    {t('orgs:settings.slugHint', { slug: form.watch('slug') || orgSlug })}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isAdmin ? (
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={updateOrg.isPending}>
                  {updateOrg.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                  {t('common:actions.saveChanges')}
                </Button>
              </div>
            ) : null}
          </form>
        </Form>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">{t('orgs:settings.dangerZone')}</CardTitle>
          <CardDescription>{t('orgs:settings.dangerDescription')}</CardDescription>
        </CardHeader>

        {isGlobalAdmin ? (
          <div className="flex justify-end">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setConfirmingDelete(true);
              }}
            >
              {t('orgs:settings.delete')}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t('orgs:settings.deleteRestricted')}</p>
        )}
      </Card>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t('orgs:settings.deleteTitle', { name: org?.name ?? '' })}
        description={t('orgs:settings.deleteBody')}
        confirmLabel={t('orgs:settings.delete')}
        confirmValue={org?.name}
        confirmValueHint={t('orgs:settings.deleteConfirmHint')}
        isPending={deleteOrg.isPending}
        onConfirm={confirmDelete}
      />
    </section>
  );
}
