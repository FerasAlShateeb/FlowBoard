import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';

import { useAuthStore } from '@/stores/useAuthStore';
import { endSessionLocally, useMe } from '@/hooks/useAuth';
import { resolveAuthGate, returnToPath } from '@/routes/auth-gate';
import EmptyState from '@/components/common/EmptyState';
import PageSpinner from '@/components/common/PageSpinner';

/**
 * Route guards, mounted as ELEMENTS rather than wrapped around each page — so
 * the whole protected subtree is declared once in the route table and a new
 * page cannot forget to opt in.
 *
 * The decision logic lives in `routes/auth-gate.ts` (pure, unit-tested); these
 * components only read state and render the outcome.
 */

/**
 * Protects the app shell.
 *
 * TWO CHECKS, NOT ONE. A token in localStorage proves only that someone signed
 * in on this device once — it says nothing about whether the session survived.
 * A `tokenVersion` bump (deactivation, password reset, "sign out everywhere")
 * revokes it server-side without touching the copy here, so the guard also
 * validates with `GET /auth/me` and treats a 401/403 as terminal.
 *
 * The single-flight refresh in `lib/api.ts` handles "expired while working";
 * this guard is what handles "expired while away".
 *
 * A deep link survives the detour: the requested path is stashed in navigation
 * state and `LoginPage` returns there.
 */
export function RequireAuth() {
  const location = useLocation();
  const hasToken = useAuthStore((state) => state.accessToken !== null);
  const { data: me, error } = useMe();

  const gate = resolveAuthGate({ hasToken, hasUser: me !== undefined, error });

  // Clearing is a SIDE EFFECT, so it cannot happen during render — React may
  // render this component twice (StrictMode) or throw the pass away entirely.
  // The redirect below is rendered either way; the effect only tidies up the
  // dead tokens behind it.
  useEffect(() => {
    if (gate === 'rejected') endSessionLocally();
  }, [gate]);

  if (gate === 'checking') return <PageSpinner full />;

  if (gate === 'signed-out' || gate === 'rejected') {
    const from = returnToPath(location.pathname, location.search);
    return <Navigate to="/login" replace state={from === null ? undefined : { from }} />;
  }

  return <Outlet />;
}

/**
 * Global-admin-only routes.
 *
 * Renders a refusal IN PLACE rather than redirecting: a redirect to `/` from a
 * bookmarked admin URL looks like the app losing the navigation, and if the
 * flag were ever wrong in the other direction a redirect loop is far worse than
 * a message.
 *
 * The flag is read from `/auth/me` when that has resolved and from the
 * persisted session otherwise, so a demotion that happened on another device
 * takes effect as soon as the session query lands — rather than staying wrong
 * until the next sign-in.
 *
 * This is CHROME, not a security boundary. Every admin endpoint re-checks the
 * claim server-side (`requireGlobalAdmin`), so a tampered store buys an
 * attacker a page full of failed requests and nothing else.
 */
export function RequireGlobalAdmin() {
  const { t } = useTranslation(['auth']);
  const storedFlag = useAuthStore((state) => state.isGlobalAdmin());
  const { data: me, isPending } = useMe();

  const isGlobalAdmin = me ? me.isGlobalAdmin : storedFlag;

  // Only wait when the persisted flag says "no": showing the refusal for a beat
  // and then revealing the page would be worse than a brief spinner, while an
  // admin whose stored flag already says "yes" should never see one at all.
  if (!isGlobalAdmin && isPending) return <PageSpinner />;

  if (!isGlobalAdmin) {
    return (
      <EmptyState
        icon={<ShieldAlert className="size-4" />}
        title={t('auth:session.adminOnly')}
        message={t('auth:session.adminOnlyBody')}
      />
    );
  }
  return <Outlet />;
}

/**
 * `/login` is for signed-OUT users; an authenticated visit goes home.
 *
 * Gated on the TOKEN alone, deliberately. Validating with `/auth/me` here would
 * mean a user whose session just died has to wait for a round trip before the
 * sign-in form appears — and if that request failed, they would be stuck on a
 * spinner with no way back in. A stale token that bounces them to `/` is
 * self-correcting: `RequireAuth` validates there and sends them straight back.
 *
 * IT HONOURS `state.from`, and that is not a nicety — it is what makes a deep
 * link survive the sign-in detour. `LoginPage` calls `navigate(from)` after a
 * successful sign-in, but writing the token to the store re-renders THIS guard
 * in the same pass, while the location is still `/login`; a bare
 * `<Navigate to="/">` therefore renders and wins the race, and every user who
 * followed a link to a task landed on the org home instead. Redirecting to the
 * same place the login page would have gone makes the two agree, so whichever
 * runs last is right. (`returnToPath` guarantees `from` is never `/login`
 * itself, so this cannot loop.)
 */
export function PublicOnly() {
  const location = useLocation();
  const hasToken = useAuthStore((state) => state.accessToken !== null);
  if (hasToken) {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }
  return <Outlet />;
}
