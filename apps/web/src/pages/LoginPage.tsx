import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { z } from 'zod';
import { loginInputSchema, loginResponseSchema } from '@flowboard/shared';

import { ApiError, NETWORK_ERROR_CODE, api } from '@/lib/api';
import { useAuthStore } from '@/stores/useAuthStore';
import BrandMark from '@/components/common/BrandMark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

/**
 * The sign-in page — and this wave's design showcase.
 *
 * VISUAL IDEA (Linear's sign-in, reduced to tokens): a very wide, very faint
 * radial wash of the accent behind a deep neutral ground (`.fb-auth-bg`), a
 * hairline grid masked to fade out below the fold (`.fb-grid-overlay`), and one
 * small, quiet card floating on top. Everything is a design token, so the whole
 * treatment follows the Theme Studio and both palettes for free.
 *
 * THERE IS NO SIGN-UP. FlowBoard accounts are admin-provisioned or created by
 * redeeming an invite (plan §Accounts), so the page must not offer a link that
 * does not exist — hence the plain "ask an administrator" line.
 *
 * WAVE-1 REALITY. `POST /api/auth/login` does not exist yet (WP2.1 builds it),
 * so a submit here 404s. That is a HANDLED path, not a broken one:
 * `lib/api.ts` throws a typed `ApiError`, {@link errorMessageKey} maps it to a
 * translated string, and the user gets a toast. This is exactly the code path
 * that will run against the real endpoint.
 */

/**
 * The request body is `@flowboard/shared`'s `loginInputSchema` — the SAME object
 * the API validates the request with, so a contract change breaks both ends in
 * one commit. Its messages are the shared English constants; `FormMessage`
 * localizes them at render time (see `i18n/validation.ts`), which is why nothing
 * here builds a schema out of `t()`.
 *
 * `LoginInput` is the schema's OUTPUT type (email trimmed and lowercased). The
 * form binds to raw text, so the field values are typed as the schema's input.
 */
type LoginValues = z.input<typeof loginInputSchema>;

/**
 * Envelope error code → catalog key.
 *
 * The API's `error.code` is stable machine-readable surface; `error.message` is
 * English prose meant for logs. Branching on the code and rendering OUR string
 * is what keeps a raw server message off an Arabic screen. Anything unmapped
 * falls through to a deliberately vague `unknown` — a login form must never
 * leak which half of the pair was wrong.
 */
const ERROR_KEYS = {
  invalid_credentials: 'auth:errors.invalid_credentials',
  /**
   * RESERVED, and not reachable through `LocalAuthProvider`: it returns the
   * same failure for a deactivated account as for a wrong password, so the form
   * cannot be used to confirm that an address has an account. A future
   * directory-backed provider that distinguishes them has somewhere to land.
   */
  account_disabled: 'auth:errors.account_disabled',
  rate_limited: 'auth:errors.rate_limited',
  [NETWORK_ERROR_CODE]: 'auth:errors.network',
} as const;

function errorMessageKey(
  error: unknown,
): (typeof ERROR_KEYS)[keyof typeof ERROR_KEYS] | 'auth:errors.unknown' {
  if (!(error instanceof ApiError)) return 'auth:errors.unknown';
  const key = ERROR_KEYS[error.code as keyof typeof ERROR_KEYS];
  return key ?? 'auth:errors.unknown';
}

export default function LoginPage() {
  const { t } = useTranslation(['auth', 'common']);
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((s) => s.setSession);
  const [revealed, setRevealed] = useState(false);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginInputSchema),
    defaultValues: { email: '', password: '' },
    // Validate on blur, re-validate on change: a message that appears while you
    // are still typing your email is noise, but once it has appeared it should
    // clear the moment you fix it.
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  /**
   * Where to land after a successful sign-in. `RequireAuth` stashes the
   * originally requested path in navigation state, so a deep link survives the
   * detour through the login page.
   */
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const onSubmit = async (values: LoginValues) => {
    try {
      // The response is PARSED, not cast: `lib/api.ts` runs the envelope's
      // `data` through `loginResponseSchema`, so a server that drifts from the
      // contract fails here rather than writing a malformed session into
      // localStorage where every later read inherits the problem.
      const session = await api.post('/auth/login', values, { schema: loginResponseSchema });
      setSession(session);
      toast.success(t('auth:login.success'));
      void navigate(from, { replace: true });
    } catch (error) {
      toast.error(t(errorMessageKey(error)));
    }
  };

  const submitting = form.formState.isSubmitting;

  return (
    <div className="fb-auth-bg relative flex min-h-dvh items-center justify-center p-6">
      {/* Decorative only — the grid carries no information, so it is hidden
          from assistive tech and never intercepts a pointer. */}
      <div
        className="fb-grid-overlay pointer-events-none absolute inset-0 opacity-40"
        aria-hidden
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark size={40} />
          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              {t('auth:login.title')}
            </h1>
            <p className="text-xs text-muted-foreground">{t('auth:login.subtitle')}</p>
          </div>
        </div>

        <div className="rounded-[var(--card-radius)] border border-border bg-surface/80 p-5 shadow-[var(--shadow-2)] backdrop-blur-xl">
          <Form {...form}>
            <form
              noValidate
              onSubmit={(event) => {
                void form.handleSubmit(onSubmit)(event);
              }}
              className="flex flex-col gap-4"
            >
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('auth:login.email')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        inputMode="email"
                        autoComplete="username"
                        autoFocus
                        // Email addresses are Latin identifiers even on an
                        // Arabic page: forcing LTR keeps `@` and `.` from being
                        // reordered by the bidi algorithm mid-typing.
                        dir="ltr"
                        placeholder={t('auth:login.emailPlaceholder')}
                        disabled={submitting}
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
                    <FormLabel>{t('auth:login.password')}</FormLabel>
                    {/*
                      The reveal button's positioning wrapper sits OUTSIDE
                      `FormControl`, not inside it. `FormControl` is a Radix
                      `Slot`: it forwards `id` / `aria-describedby` /
                      `aria-invalid` onto its ONE child. Wrapping the input in a
                      div made that child the div, so the label's `htmlFor`
                      pointed at a `<div>` and the password field had no
                      accessible name at all — invisible on screen, fatal to a
                      screen reader and to `getByLabel` in the e2e smoke.
                    */}
                    <div className="relative">
                      <FormControl>
                        <Input
                          {...field}
                          type={revealed ? 'text' : 'password'}
                          autoComplete="current-password"
                          dir="ltr"
                          placeholder={t('auth:login.passwordPlaceholder')}
                          disabled={submitting}
                          // Reserve room for the reveal button on the reading-
                          // END side, so a long password never runs under it.
                          className="pe-9"
                        />
                      </FormControl>
                      <button
                        type="button"
                        onClick={() => setRevealed((current) => !current)}
                        // `-translate-y-1/2` is a transform, not an inset, so
                        // it is direction-independent; `end-1` mirrors.
                        className="absolute end-1 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-[var(--btn-radius)] text-muted-foreground transition-colors duration-[var(--speed)] hover:text-foreground"
                        aria-label={
                          revealed ? t('auth:login.hidePassword') : t('auth:login.showPassword')
                        }
                        aria-pressed={revealed}
                        tabIndex={-1}
                      >
                        {revealed ? (
                          <EyeOff className="size-4" aria-hidden />
                        ) : (
                          <Eye className="size-4" aria-hidden />
                        )}
                      </button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" size="lg" disabled={submitting} className="mt-1 w-full">
                {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {submitting ? t('auth:login.submitting') : t('auth:login.submit')}
              </Button>
            </form>
          </Form>
        </div>

        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          {t('auth:login.noAccount')}
        </p>
      </div>
    </div>
  );
}
