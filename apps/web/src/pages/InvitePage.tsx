import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Building2, Loader2, MailWarning } from 'lucide-react';
import type { z } from 'zod';
import { acceptInviteRegisterSchema, type InvitePreview } from '@flowboard/shared';

import { getIntlLocale } from '@/lib/lang-policy';
import { useAcceptInvite, useInvitePreview } from '@/hooks/useInvite';
import { useAuthStore } from '@/stores/useAuthStore';
import { useApiErrorMessage } from '@/i18n/errors';
import BrandMark from '@/components/common/BrandMark';
import EmptyState from '@/components/common/EmptyState';
import RoleBadge from '@/components/common/RoleBadge';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

/**
 * `/invite/:token` — the invite landing page.
 *
 * PUBLIC AND GUARD-FREE, deliberately outside BOTH `RequireAuth` (a signed-out
 * stranger is the primary audience of an invite link) and `PublicOnly` (an
 * already-signed-in user must still be able to redeem one). It also sits
 * outside `AppShell`: there is no org context yet.
 *
 * ONE PAGE, TWO FLOWS, chosen by the preview's `requiresAccount` flag:
 *   - **register** — no account exists for this invite yet. Name + password;
 *     the email comes from the invite row, never from this form.
 *   - **attach**   — someone is signed in. One button; identity comes from the
 *     Authorization header.
 *
 * The preview deliberately carries NO IDS (`auth.schema.ts`): a stranger
 * holding a leaked token learns the org's name and who invited them, and
 * nothing that would let them address the org's rows.
 */

type RegisterValues = z.input<typeof acceptInviteRegisterSchema>;

export default function InvitePage() {
  const { t } = useTranslation(['auth', 'common', 'orgs']);
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const describeError = useApiErrorMessage();

  const signedInUser = useAuthStore((state) => state.user);
  const { data: preview, isPending, error } = useInvitePreview(token);
  const accept = useAcceptInvite(token ?? '');

  const form = useForm<RegisterValues>({
    resolver: zodResolver(acceptInviteRegisterSchema),
    // `mode` is fixed by the schema's discriminant and never edited, so it is a
    // default value rather than a field.
    defaultValues: { mode: 'register', name: '', password: '' },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const onAccepted = (organization: string) => {
    toast.success(t('auth:invite.register.success', { organization }));
    // `replace`, so the back button does not return to a token that has just
    // been spent.
    void navigate('/', { replace: true });
  };

  const submitRegister = (values: RegisterValues) => {
    accept.mutate(
      { mode: 'register', name: values.name, password: values.password },
      {
        onSuccess: () => {
          onAccepted(preview?.orgName ?? '');
        },
      },
    );
  };

  const submitAttach = () => {
    accept.mutate(
      { mode: 'attach' },
      {
        onSuccess: () => {
          toast.success(t('auth:invite.attach.success', { organization: preview?.orgName ?? '' }));
          void navigate('/', { replace: true });
        },
      },
    );
  };

  return (
    <div className="fb-auth-bg relative flex min-h-dvh items-center justify-center p-6">
      <div
        className="fb-grid-overlay pointer-events-none absolute inset-0 opacity-40"
        aria-hidden
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <BrandMark size={40} />
        </div>

        <div className="rounded-[var(--card-radius)] border border-border bg-surface/80 p-5 shadow-[var(--shadow-2)] backdrop-blur-xl">
          {isPending ? (
            <div
              role="status"
              aria-label={t('auth:invite.loading')}
              className="flex flex-col items-center gap-3 py-6"
            >
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
              <p className="text-xs text-muted-foreground">{t('auth:invite.loading')}</p>
            </div>
          ) : error || !preview ? (
            <EmptyState
              icon={<MailWarning className="size-4" />}
              title={t('auth:invite.invalid')}
              // The server's own explanation ("expired", "already used") is
              // more useful than a generic line, and `describeError` has
              // already localized it.
              message={error ? describeError(error) : t('auth:invite.invalidBody')}
              action={
                <Button asChild variant="outline" size="sm">
                  <Link to="/login">{t('auth:invite.goToSignIn')}</Link>
                </Button>
              }
            />
          ) : preview.status !== 'pending' ? (
            /* A spent or expired link previews successfully (200 with a
               `status`) — only the ACCEPT call refuses it. Branching here is
               what stops the page rendering a signup form that is guaranteed to
               fail on submit, and the two states get different copy because
               they have different remedies: sign in, or ask for a new link. */
            <EmptyState
              icon={<MailWarning className="size-4" />}
              title={
                preview.status === 'accepted' ? t('auth:invite.used') : t('auth:invite.expired')
              }
              message={
                preview.status === 'accepted'
                  ? t('auth:invite.usedBody')
                  : t('auth:invite.expiredBody')
              }
              action={
                <Button asChild variant="outline" size="sm">
                  <Link to="/login">{t('auth:invite.goToSignIn')}</Link>
                </Button>
              }
            />
          ) : (
            <>
              <InviteSummary preview={preview} />

              {preview.requiresAccount ? (
                <Form {...form}>
                  <form
                    noValidate
                    className="mt-4 flex flex-col gap-4"
                    onSubmit={(event) => {
                      void form.handleSubmit(submitRegister)(event);
                    }}
                  >
                    <p className="text-xs text-muted-foreground">
                      {t('auth:invite.register.description')}
                    </p>

                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('auth:invite.register.name')}</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              autoComplete="name"
                              autoFocus
                              placeholder={t('auth:invite.register.namePlaceholder')}
                              disabled={accept.isPending}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('auth:invite.register.password')}</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="password"
                              autoComplete="new-password"
                              dir="ltr"
                              placeholder={t('auth:invite.register.passwordPlaceholder')}
                              disabled={accept.isPending}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button type="submit" size="lg" className="w-full" disabled={accept.isPending}>
                      {accept.isPending ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : null}
                      {t('auth:invite.register.submit')}
                    </Button>
                  </form>
                </Form>
              ) : signedInUser ? (
                <div className="mt-4 flex flex-col gap-3">
                  <p className="text-xs text-muted-foreground">
                    {t('auth:invite.attach.description')}
                  </p>
                  <Button
                    size="lg"
                    className="w-full"
                    disabled={accept.isPending}
                    onClick={submitAttach}
                  >
                    {accept.isPending ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : null}
                    {t('auth:invite.attach.submit', { organization: preview.orgName })}
                  </Button>
                  <p className="text-center text-[11px] text-muted-foreground">
                    {t('auth:invite.attach.switchAccount')}
                  </p>
                </div>
              ) : (
                /*
                  An account EXISTS for this invite but nobody is signed in.
                  Registering would collide with the existing account and
                  attaching needs a bearer token, so the only honest next step
                  is the sign-in form — which returns here afterwards.
                */
                <div className="mt-4 flex flex-col gap-3">
                  <p className="text-xs text-muted-foreground">{t('auth:invite.usedBody')}</p>
                  <Button asChild size="lg" className="w-full">
                    <Link to="/login" state={{ from: `/invite/${token ?? ''}` }}>
                      {t('auth:invite.goToSignIn')}
                    </Link>
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The preview card: who invited you, to what, and with which role. */
function InviteSummary({ preview }: { preview: InvitePreview }) {
  const { t } = useTranslation(['auth']);

  // `getIntlLocale()` carries `-u-nu-latn` for Arabic, so the date renders with
  // Western digits alongside the Latin identifiers elsewhere on the page.
  const expires = new Intl.DateTimeFormat(getIntlLocale(), { dateStyle: 'medium' }).format(
    new Date(preview.expiresAt),
  );

  return (
    <div className="flex flex-col gap-3 text-center">
      <span className="mx-auto flex size-9 items-center justify-center rounded-[var(--radius)] border border-border bg-surface-raised text-muted-foreground">
        <Building2 className="size-4" aria-hidden />
      </span>

      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          {t('auth:invite.title', { organization: preview.orgName })}
        </h1>
        <p className="text-xs text-muted-foreground">
          {t('auth:invite.subtitle', { name: preview.invitedByName })}
        </p>
      </div>

      <div className="flex flex-col items-center gap-1.5 text-xs text-muted-foreground">
        {/* The role is a BADGE next to the sentence rather than interpolated
            into it: the same three role words appear on every members table
            and invite row, and keeping one rendering of them means a reader
            recognises the chip rather than re-parsing a sentence. */}
        <span className="inline-flex items-center gap-1.5">
          {t('auth:invite.asRole')}
          <RoleBadge role={preview.orgRole} />
        </span>

        {preview.projectName && preview.projectRole ? (
          <span className="inline-flex items-center gap-1.5">
            {t('auth:invite.withProject', { project: preview.projectName })}
            <RoleBadge role={preview.projectRole} />
          </span>
        ) : null}

        {preview.email ? (
          <span dir="ltr">{t('auth:invite.lockedTo', { email: preview.email })}</span>
        ) : null}

        <span>{t('auth:invite.expiresOn', { date: expires })}</span>
      </div>
    </div>
  );
}
