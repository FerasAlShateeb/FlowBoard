import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';
import {
  changePasswordInputSchema,
  localeSchema,
  nameSchema,
  VM_REQUIRED,
  type ChangePasswordInput,
  type Locale,
} from '@flowboard/shared';

import { getIntlLocale, setLangPref } from '@/lib/lang-policy';
import { useChangePassword, useMe, useUpdateMe } from '@/hooks/useAuth';
import PageHeader from '@/components/common/PageHeader';
import PageSpinner from '@/components/common/PageSpinner';
import ErrorState from '@/components/common/ErrorState';
import UserAvatar from '@/components/common/UserAvatar';
import { Badge } from '@/components/ui/badge';
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

/**
 * `/me` — the signed-in user's own profile and credentials.
 *
 * TWO INDEPENDENT FORMS, not one. Profile fields and a password change have
 * different endpoints, different failure modes and different consequences
 * (changing a password revokes every other device), and a single Save that
 * sometimes signs you out of your phone is a surprise. Two cards, two submits.
 */

/**
 * The profile form's schema.
 *
 * Assembled from the SHARED field schemas rather than reusing
 * `updateMeInputSchema` wholesale: that one is `.partial()` with an
 * at-least-one-field refinement, which is right for a PATCH body and wrong for
 * a form (RHF needs every field present, and "change something" is not a field
 * error). The FIELD rules — and therefore the messages `FormMessage`
 * localizes — are the shared ones either way.
 *
 * `avatarUrl` is a plain string here and normalized to `null` on submit: an
 * empty input means "no avatar", and `z.url()` would reject the empty string
 * before the user had typed anything.
 */
const profileFormSchema = z.object({
  name: nameSchema,
  locale: localeSchema,
  avatarUrl: z.string().trim(),
});

type ProfileValues = z.input<typeof profileFormSchema>;

/**
 * The password form: the shared change-password contract plus a confirmation
 * field, which is UI-only (the API has no use for it).
 *
 * WHY THIS ONE SCHEMA IS BUILT WITH `t()` WHEN NO OTHER FORM IN THE APP IS.
 * The house rule is that forms never translate their own field errors: they
 * bind the SHARED schemas, whose English messages are the wire contract, and
 * `FormMessage` localizes each one at render through `i18n/validation.ts`. That
 * works because every one of those messages has a shared constant.
 *
 * "Those passwords do not match" has none — and cannot: no schema on the API
 * side has two password fields to compare, because the confirmation never
 * leaves the browser. An untranslated literal would reach `FormMessage`, find
 * no entry in the map, and be passed through as English. So the message is
 * translated where it is created. The other two fields still carry the shared
 * constants and are still localized the normal way.
 *
 * `VM_REQUIRED` on the confirmation is the shared constant for "you left this
 * empty", which DOES have a map entry — so only the mismatch is local.
 */
function buildPasswordSchema(mismatchMessage: string) {
  return changePasswordInputSchema
    .extend({ confirmPassword: z.string().min(1, VM_REQUIRED) })
    .refine((value) => value.newPassword === value.confirmPassword, {
      // `path` puts the error under the confirmation field rather than at the
      // form root, where RHF would have nowhere to render it.
      path: ['confirmPassword'],
      message: mismatchMessage,
    });
}

type PasswordValues = z.input<ReturnType<typeof buildPasswordSchema>>;

export default function ProfilePage() {
  const { t } = useTranslation(['settings', 'common']);
  const { data: session, isPending, error, refetch } = useMe();
  // `/auth/me` answers `{ user, memberships, isGlobalAdmin }`; this page is the
  // account card, so it reads the `user` half.
  const me = session?.user;

  if (isPending) return <PageSpinner />;
  if (error || !me) {
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }

  const memberSince = new Intl.DateTimeFormat(getIntlLocale(), { dateStyle: 'long' }).format(
    new Date(me.createdAt),
  );

  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-[var(--gap)]">
      <PageHeader
        title={t('settings:profile.title')}
        description={t('settings:profile.subtitle')}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('settings:profile.account')}</CardTitle>
          <CardDescription>{t('settings:profile.accountDescription')}</CardDescription>
        </CardHeader>

        <div className="flex items-center gap-3">
          <UserAvatar user={{ id: me.id, name: me.name, avatarUrl: me.avatarUrl }} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{me.name}</p>
            <p className="truncate text-xs text-muted-foreground" dir="ltr">
              {me.email}
            </p>
          </div>
          {me.isGlobalAdmin ? (
            <Badge variant="soft-primary" className="ms-auto">
              {t('settings:profile.globalAdmin')}
            </Badge>
          ) : null}
        </div>

        <ProfileForm
          key={me.id}
          initial={{ name: me.name, locale: me.locale, avatarUrl: me.avatarUrl ?? '' }}
        />

        <p className="text-[11px] text-muted-foreground">
          {t('settings:profile.memberSince', { date: memberSince })}
        </p>
      </Card>

      <PasswordCard />
    </section>
  );
}

/** The profile fields — name, avatar, account locale. */
function ProfileForm({ initial }: { initial: ProfileValues }) {
  const { t } = useTranslation(['settings', 'common']);
  const updateMe = useUpdateMe();

  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: initial,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  // Re-seed when the server's copy changes underneath (another device, or the
  // `/auth/me` refetch landing after first paint). `reset` rather than
  // `defaultValues`, which RHF reads only on mount.
  useEffect(() => {
    form.reset(initial);
    // Comparing by value, not identity: `initial` is rebuilt every render.
    // deps are the FIELD VALUES, not the objects: `form` is stable across renders (RHF) and the
    // data object is rebuilt every render, so depending on either would reset the form under
    // the user mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above.
  }, [initial.name, initial.locale, initial.avatarUrl]);

  const onSubmit = (values: ProfileValues) => {
    const avatarUrl = values.avatarUrl.trim();
    updateMe.mutate(
      {
        name: values.name,
        locale: values.locale as Locale,
        // Empty input means "show my initials", which the contract spells as
        // `null` — not `''`, which would fail the URL check.
        avatarUrl: avatarUrl.length > 0 ? avatarUrl : null,
      },
      {
        onSuccess: (user) => {
          toast.success(t('settings:profile.saved'));
          // The ACCOUNT locale is the durable preference; the topbar switch is
          // device-local. Saving one without applying it would leave the page
          // in a language the user just said they did not want.
          setLangPref(user.locale);
        },
      },
    );
  };

  return (
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
              <FormLabel>{t('settings:profile.name')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoComplete="name"
                  placeholder={t('settings:profile.namePlaceholder')}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="avatarUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('settings:profile.avatarUrl')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="url"
                  dir="ltr"
                  inputMode="url"
                  placeholder={t('settings:profile.avatarPlaceholder')}
                />
              </FormControl>
              <FormDescription>{t('settings:profile.avatarHint')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="locale"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('settings:profile.locale')}</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {/* Each language is named IN ITSELF — a reader looking for
                      Arabic scans for العربية, not for "Arabic". */}
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
                </SelectContent>
              </Select>
              <FormDescription>{t('settings:profile.localeHint')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={updateMe.isPending}>
            {updateMe.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('common:actions.saveChanges')}
          </Button>
        </div>
      </form>
    </Form>
  );
}

/** The change-password card. */
function PasswordCard() {
  const { t } = useTranslation(['settings', 'common']);
  const changePassword = useChangePassword();

  // Rebuilt when the language changes, so a mid-session switch re-renders the
  // mismatch message in the new language rather than keeping the stale one.
  const schema = useMemo(() => buildPasswordSchema(t('settings:password.mismatch')), [t]);

  const form = useForm<PasswordValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const onSubmit = (values: PasswordValues) => {
    const input: ChangePasswordInput = {
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    };
    changePassword.mutate(input, {
      onSuccess: () => {
        toast.success(t('settings:password.changed'));
        // Never leave a filled password form on screen after a success.
        form.reset({ currentPassword: '', newPassword: '', confirmPassword: '' });
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings:password.title')}</CardTitle>
        <CardDescription>{t('settings:password.description')}</CardDescription>
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
            name="currentPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('settings:password.current')}</FormLabel>
                <FormControl>
                  <Input {...field} type="password" autoComplete="current-password" dir="ltr" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="newPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('settings:password.next')}</FormLabel>
                <FormControl>
                  <Input {...field} type="password" autoComplete="new-password" dir="ltr" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('settings:password.confirm')}</FormLabel>
                <FormControl>
                  <Input {...field} type="password" autoComplete="new-password" dir="ltr" />
                </FormControl>
                {/* Already-translated messages pass through `FormMessage`
                    untouched — see `buildPasswordSchema`. */}
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={changePassword.isPending}>
              {changePassword.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('settings:password.submit')}
            </Button>
          </div>
        </form>
      </Form>
    </Card>
  );
}
