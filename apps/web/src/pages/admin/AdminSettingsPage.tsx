import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Building2, Info, Loader2 } from 'lucide-react';
import { z } from 'zod';
import { instanceSettingsSchema, type UpdateInstanceSettingsInput } from '@flowboard/shared';

import { ApiError } from '@/lib/api';
import { useAdminOrgs } from '@/hooks/useAdminOrgs';
import {
  DEFAULT_ORG_INVALID_CODE,
  DEFAULT_ORG_REQUIRED_CODE,
  useInstanceSettings,
  useUpdateInstanceSettings,
} from '@/hooks/useInstanceSettings';
import { useApiErrorMessage } from '@/i18n/errors';
import { SectionHeader } from '@/components/dashboard/SectionHeader';
import { formatInstant } from '@/components/dashboard/format';
import ErrorState from '@/components/common/ErrorState';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

/**
 * `/admin/settings` — the instance singleton: what this deployment calls
 * itself, and whether it presents as a platform of organizations or as one
 * workspace.
 *
 * ═══ WHY THE RESOLVER IS NOT `updateInstanceSettingsInputSchema` ══════════
 *
 * That schema is the PATCH BODY's shape: every field optional, at least one
 * required, expressed as a `.refine()`. It is exactly right for a request and
 * exactly wrong for a form, where all three fields are always present and each
 * must be validated on its own — a partial schema would accept an empty
 * instance name because "absent" is legal on the wire.
 *
 * So the form picks its fields off `instanceSettingsSchema` (the READ shape, a
 * plain object), which binds `instanceName` to the same `nameSchema` and
 * `orgMode` to the same enum the server enforces, with the same shared
 * validation messages `FormMessage` localizes. The wire body is still typed
 * `UpdateInstanceSettingsInput`, so a contract change breaks the build here.
 *
 * ═══ THE CROSS-FIELD RULE IS THE SERVER'S, AND THAT IS DELIBERATE ═════════
 *
 * "Single mode requires a default organization that EXISTS" is a database
 * question — does that row exist, and is it un-archived? — which is why the
 * shared schema explicitly declines to express it (see its header). Duplicating
 * a weaker version of it here would produce a form that passes its own check and
 * then fails the server's, with two different sentences for one problem.
 *
 * Instead the two 422 codes are caught and attached to the FIELD they are about:
 *
 *   - `default_org_required` → "pick one"
 *   - `default_org_invalid`  → "that one is gone or archived"
 *
 * A toast would be wrong for both: it vanishes while the admin is still reading
 * the form, and it names no field.
 *
 * ═══ SAVING RELAYS THE SHELL ═════════════════════════════════════════════
 *
 * The mutation invalidates `qk.instance.all()`, which reaches `config()` as
 * well as `settings()` — so the org switcher disappears, the sidebar re-scopes
 * and `/` starts short-circuiting the moment the PATCH lands. Invalidating only
 * the settings key would leave an admin looking at a saved form and an unchanged
 * application.
 */

/**
 * `defaultOrgId` is a STRING here, never `null`: `ui/select` has no concept of a
 * null value, and Radix reserves `''` for "nothing selected". The empty string
 * is mapped back to `null` at the boundary, in {@link toPatch}.
 */
const settingsFormSchema = instanceSettingsSchema
  .pick({ instanceName: true, orgMode: true })
  .extend({ defaultOrgId: z.string() });

type SettingsFormValues = z.infer<typeof settingsFormSchema>;

/** The PATCH body, typed against the shared contract. */
function toPatch(values: SettingsFormValues): UpdateInstanceSettingsInput {
  return {
    instanceName: values.instanceName,
    orgMode: values.orgMode,
    defaultOrgId: values.defaultOrgId === '' ? null : values.defaultOrgId,
  };
}

export default function AdminSettingsPage() {
  const { t } = useTranslation(['admin', 'common']);
  const describeError = useApiErrorMessage();

  const query = useInstanceSettings();
  const orgsQuery = useAdminOrgs({});
  const update = useUpdateInstanceSettings();

  const settings = query.data;
  const orgs = orgsQuery.data ?? [];

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: { instanceName: '', orgMode: 'multi', defaultOrgId: '' },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  // RE-BASELINED WHENEVER THE SERVER'S COPY CHANGES — on first load, and after a
  // successful save (the mutation writes the response into the cache). Resetting
  // is what makes `isDirty` mean "differs from what is stored" rather than
  // "differs from an empty form".
  useEffect(() => {
    if (!settings) return;
    form.reset({
      instanceName: settings.instanceName,
      orgMode: settings.orgMode,
      defaultOrgId: settings.defaultOrgId ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.instanceName, settings?.orgMode, settings?.defaultOrgId]);

  const orgMode = form.watch('orgMode');
  const dirty = form.formState.isDirty;

  const onSubmit = (values: SettingsFormValues) => {
    update.mutate(toPatch(values), {
      onSuccess: () => {
        toast.success(t('admin:settings.saved'));
      },
      onError: (error: unknown) => {
        // The two field-level failures. See the header for why they do not
        // become toasts.
        if (error instanceof ApiError && error.code === DEFAULT_ORG_REQUIRED_CODE) {
          form.setError('defaultOrgId', { message: t('admin:settings.defaultOrg.required') });
          return;
        }
        if (error instanceof ApiError && error.code === DEFAULT_ORG_INVALID_CODE) {
          form.setError('defaultOrgId', { message: t('admin:settings.defaultOrg.invalid') });
          return;
        }
        toast.error(describeError(error));
      },
    });
  };

  if (query.error) {
    return (
      <section className="flex flex-col gap-[var(--gap)]">
        <SectionHeader
          title={t('admin:settings.title')}
          subtitle={t('admin:settings.description')}
        />
        <ErrorState
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
        />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-[var(--gap)]">
      <SectionHeader
        title={t('admin:settings.title')}
        subtitle={
          settings
            ? t('admin:settings.lastUpdated', { date: formatInstant(settings.updatedAt) })
            : t('admin:settings.description')
        }
      />

      {query.isPending ? (
        <Card className="gap-3" aria-hidden>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-full max-w-sm" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-16 w-full" />
        </Card>
      ) : (
        <Form {...form}>
          <form
            noValidate
            className="flex flex-col gap-[var(--gap)]"
            data-testid="instance-settings-form"
            onSubmit={(event) => {
              void form.handleSubmit(onSubmit)(event);
            }}
          >
            {/* ── Identity ─────────────────────────────────────────────── */}
            <Card className="gap-4">
              <CardHeader>
                <CardTitle>{t('admin:settings.identity.title')}</CardTitle>
                <CardDescription>{t('admin:settings.identity.description')}</CardDescription>
              </CardHeader>

              <FormField
                control={form.control}
                name="instanceName"
                render={({ field }) => (
                  <FormItem className="max-w-sm">
                    <FormLabel>{t('admin:settings.identity.name')}</FormLabel>
                    <FormControl>
                      <Input {...field} autoComplete="off" data-testid="instance-name-input" />
                    </FormControl>
                    <FormDescription>{t('admin:settings.identity.nameHint')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Card>

            {/* ── Organization mode ────────────────────────────────────── */}
            <Card className="gap-4">
              <CardHeader>
                <CardTitle>{t('admin:settings.mode.title')}</CardTitle>
                <CardDescription>{t('admin:settings.mode.description')}</CardDescription>
              </CardHeader>

              <FormField
                control={form.control}
                name="orgMode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('admin:settings.mode.label')}</FormLabel>
                    <FormControl>
                      <ToggleGroup
                        type="single"
                        variant="outline"
                        value={field.value}
                        // A ToggleGroup can be emptied by re-pressing the active
                        // item; a MODE cannot be unset, so an empty value is
                        // ignored rather than written as `''`.
                        onValueChange={(next) => {
                          if (next === 'multi' || next === 'single') field.onChange(next);
                        }}
                        aria-label={t('admin:settings.mode.label')}
                        className="w-full max-w-md"
                      >
                        <ToggleGroupItem value="multi" data-testid="org-mode-multi">
                          {t('admin:settings.mode.multi')}
                        </ToggleGroupItem>
                        <ToggleGroupItem value="single" data-testid="org-mode-single">
                          {t('admin:settings.mode.single')}
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </FormControl>
                    <FormDescription>
                      {field.value === 'single'
                        ? t('admin:settings.mode.singleHint')
                        : t('admin:settings.mode.multiHint')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/*
                The explanation appears WITH the choice, not after it. An
                operator flipping a deployment-wide switch needs to read what it
                does before they press Save, and `role="note"` keeps it out of
                the assertive live region (it is not a response to anything).
              */}
              {orgMode === 'single' ? (
                <Alert variant="info" data-testid="single-mode-alert">
                  <Info aria-hidden />
                  <AlertTitle>{t('admin:settings.modeAlert.title')}</AlertTitle>
                  <AlertDescription>{t('admin:settings.modeAlert.body')}</AlertDescription>
                </Alert>
              ) : null}

              <FormField
                control={form.control}
                name="defaultOrgId"
                render={({ field }) => (
                  <FormItem className="max-w-sm">
                    <FormLabel>{t('admin:settings.defaultOrg.label')}</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={orgsQuery.isPending || orgs.length === 0}
                      >
                        <SelectTrigger
                          size="sm"
                          className="w-full"
                          aria-label={t('admin:settings.defaultOrg.label')}
                          data-testid="default-org-select"
                        >
                          <SelectValue
                            placeholder={
                              orgsQuery.isPending
                                ? t('admin:settings.defaultOrg.loading')
                                : t('admin:settings.defaultOrg.placeholder')
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {orgs.map((org) => (
                            <SelectItem key={org.id} value={org.id}>
                              <Building2 aria-hidden className="size-3.5" />
                              {org.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormDescription>
                      {orgs.length === 0 && !orgsQuery.isPending
                        ? t('admin:settings.defaultOrg.empty')
                        : t('admin:settings.defaultOrg.hint')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Card>

            <div className="flex items-center justify-end gap-3">
              {dirty ? null : (
                <span className="text-xs text-muted-foreground">
                  {t('admin:settings.unchanged')}
                </span>
              )}
              <Button
                type="submit"
                size="sm"
                disabled={!dirty || update.isPending}
                data-testid="save-instance-settings"
              >
                {update.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {t('admin:settings.save')}
              </Button>
            </div>
          </form>
        </Form>
      )}
    </section>
  );
}
