import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { createOrgInputSchema, type OrgAdminRow } from '@flowboard/shared';
import type { z } from 'zod';

import { useCreateAdminOrg, useUpdateAdminOrg } from '@/hooks/useAdminOrgs';
import FormDialog from '@/components/common/FormDialog';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

/**
 * Create or rename an organization — one dialog, two modes.
 *
 * ═══ WHY ONE COMPONENT ═══════════════════════════════════════════════════
 *
 * The two forms collect the same two fields, validate against the same shared
 * schema and differ only in their copy and their verb. Splitting them produced
 * two files whose slug hints drifted apart within a wave; the mode is a prop.
 *
 * ═══ WHY `createOrgInputSchema` FOR BOTH ═════════════════════════════════
 *
 * `updateOrgInputSchema` is `.partial()` with an at-least-one-field refinement.
 * That is the right shape for a PATCH BODY and the wrong one for a FORM, where
 * both fields are always present and both must be validated — the same call
 * `OrgSettingsPage` makes, for the same reason. `adminUserId` is omitted: the
 * console never provisions an org on somebody else's behalf, so the creator
 * becomes its first admin.
 *
 * ═══ THE SLUG IS NOT DERIVED FROM THE NAME ═══════════════════════════════
 *
 * Deliberately no auto-slugify. The slug appears in every URL under the
 * organization and outlives the name; generating it silently is how a
 * deployment ends up with `/o/acme-corporation-ltd-2` because somebody typed a
 * trailing space once. It is a field, with its own hint saying where it shows up.
 */

/** Both fields required, both bound to the shared rules and messages. */
const orgFormSchema = createOrgInputSchema.omit({ adminUserId: true });

/** The form's INPUT type — the schema's defaults are not applied yet. */
type OrgFormValues = z.input<typeof orgFormSchema>;

export interface OrgFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` ⇒ create. A row ⇒ rename that organization. */
  org: OrgAdminRow | null;
}

export function OrgFormDialog({ open, onOpenChange, org }: OrgFormDialogProps) {
  const { t } = useTranslation(['admin', 'common']);
  const create = useCreateAdminOrg();
  const update = useUpdateAdminOrg();

  const editing = org !== null;

  const form = useForm<OrgFormValues>({
    resolver: zodResolver(orgFormSchema),
    defaultValues: { name: org?.name ?? '', slug: org?.slug ?? '' },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  // RE-BASELINED ON OPEN, not on mount: the dialog is kept mounted between
  // openings (Radix unmounts its content, not this component), so a rename
  // opened for a second row would otherwise arrive holding the first row's
  // values — or, worse, a half-edited draft of them.
  useEffect(() => {
    if (open) form.reset({ name: org?.name ?? '', slug: org?.slug ?? '' });
    // `form` is stable across renders; resetting on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, org?.id, org?.name, org?.slug]);

  const onSubmit = (values: OrgFormValues) => {
    if (editing) {
      update.mutate(
        { orgId: org.id, input: { name: values.name, slug: values.slug } },
        {
          onSuccess: (saved) => {
            toast.success(t('admin:orgs.rename.renamed', { name: saved.name }));
            onOpenChange(false);
          },
        },
      );
      return;
    }

    create.mutate(
      { name: values.name, slug: values.slug },
      {
        onSuccess: (saved) => {
          toast.success(t('admin:orgs.create.created', { name: saved.name }));
          form.reset({ name: '', slug: '' });
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        editing ? t('admin:orgs.rename.title', { name: org.name }) : t('admin:orgs.create.title')
      }
      description={
        editing ? t('admin:orgs.rename.description') : t('admin:orgs.create.description')
      }
      form={form}
      onSubmit={onSubmit}
      submitLabel={editing ? t('admin:orgs.rename.submit') : t('admin:orgs.create.submit')}
      isPending={create.isPending || update.isPending}
    >
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('admin:orgs.create.name')}</FormLabel>
            <FormControl>
              <Input {...field} autoComplete="off" data-testid="org-name-input" />
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
            <FormLabel>{t('admin:orgs.create.slug')}</FormLabel>
            <FormControl>
              {/* A slug is machine text: lowercase Latin, hyphens, and part of a
                  URL. It stays LTR on an RTL page, like every other identifier
                  in the product. */}
              <Input {...field} dir="ltr" autoComplete="off" data-testid="org-slug-input" />
            </FormControl>
            <FormDescription>{t('admin:orgs.create.slugHint')}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </FormDialog>
  );
}

export default OrgFormDialog;
