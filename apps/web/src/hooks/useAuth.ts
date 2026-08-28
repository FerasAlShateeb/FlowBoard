import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  loginResponseSchema,
  logoutResponseSchema,
  meResponseSchema,
  userSchema,
  type ChangePasswordInput,
  type LoginInput,
  type LoginResponse,
  type LogoutResponse,
  type MeResponse,
  type SessionMembership,
  type UpdateMeInput,
  type User,
} from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { queryClient as appQueryClient } from '@/lib/query-client';
import { useAuthStore } from '@/stores/useAuthStore';
import { useApiErrorToast } from '@/i18n/errors';

/**
 * The session hooks — the bridge between `stores/useAuthStore` (which holds the
 * tokens and knows nothing else) and the API.
 *
 * THE DIVISION OF LABOUR, and why it is worth stating: the STORE is the source
 * of truth for "is there a token"; `/auth/me` is the source of truth for "is
 * that token still any good, and who does it belong to". Only the second can
 * detect a session revoked while the tab was closed — a deactivated account, a
 * bumped `tokenVersion`, a password reset — because none of those touch the
 * copy in localStorage. `RequireAuth` therefore gates on both.
 *
 * The single-flight refresh in `lib/api.ts` already covers the "expired while
 * you were working" case, so nothing here retries or refreshes; a 401 that
 * reaches these hooks is terminal by construction.
 */

/**
 * `GET /auth/me` — the session validation query.
 *
 * THE PAYLOAD IS A SESSION, NOT A USER: `{ user, memberships, isGlobalAdmin }`.
 * The org switcher needs every org the caller belongs to before it can render,
 * and the route guards need the admin flag; folding all three into the one call
 * every authed boot already makes is a round trip saved on every cold start.
 * (This hook used to parse a bare `userSchema` against that envelope, which
 * could only ever have thrown.)
 *
 * `enabled` on the token means a signed-out visitor never fires it (and never
 * paints a spinner on the login page). `retry: false` because the only failure
 * modes are terminal: a 401 the refresh cycle already declined to rescue, or a
 * network error the guard should surface rather than sit on for a second.
 *
 * The five-minute `staleTime` is deliberately longer than the app default: this
 * is identity, it changes on the order of never, and every route change would
 * otherwise re-ask.
 */
export function useMe(): UseQueryResult<MeResponse> {
  const accessToken = useAuthStore((state) => state.accessToken);
  const setUser = useAuthStore((state) => state.setUser);

  const query = useQuery({
    queryKey: qk.auth.me(),
    queryFn: ({ signal }) => api.get('/auth/me', { schema: meResponseSchema, signal }),
    enabled: accessToken !== null,
    retry: false,
    staleTime: 5 * 60_000,
  });

  // Mirror the authority back into the persisted session, so the topbar, the
  // sidebar's admin section and the locale preference all follow a change made
  // on another device. `setUser` no-ops on an unchanged reference, and the
  // query cache hands back the same object until it refetches — so this runs
  // once per genuine change, not once per render.
  const user = query.data?.user;
  useEffect(() => {
    if (user) setUser(user);
  }, [user, setUser]);

  return query;
}

/**
 * The caller's org memberships, straight off the session payload.
 *
 * The org SWITCHER reads this rather than `useMyOrgs()` (`GET /orgs`): the
 * switcher renders in the shell on every authed route, `/auth/me` is already in
 * flight there, and `GET /orgs` carries per-org member and project counts that
 * a dropdown never shows. The counts belong on the org home page, which fetches
 * them.
 */
export function useMyMemberships(): SessionMembership[] {
  const { data } = useMe();
  return data?.memberships ?? [];
}

/**
 * `POST /auth/login`.
 *
 * On success the session is written FIRST and the cache cleared SECOND: any
 * query that was resolved for the previous (or anonymous) session is now
 * answering the wrong question, and clearing rather than invalidating means
 * nothing re-fetches under the old token in the gap.
 */
export function useLogin() {
  const queryClient = useQueryClient();
  const setSession = useAuthStore((state) => state.setSession);

  return useMutation({
    mutationFn: (input: LoginInput) =>
      api.post<LoginResponse>('/auth/login', input, { schema: loginResponseSchema }),
    onSuccess: (session) => {
      setSession(session);
      queryClient.clear();
      // `/auth/me` is deliberately NOT seeded from the login payload. It
      // answers a SESSION — user + memberships + admin flag — and login answers
      // a user plus tokens. Writing the smaller shape into that cache key would
      // hand the org switcher an undefined `memberships` and render it empty
      // for a user who has orgs. One extra request on sign-in, once.
    },
  });
}

/**
 * `POST /auth/logout` — revoke server-side, then tear down locally.
 *
 * THE LOCAL TEARDOWN IS UNCONDITIONAL. It runs in `onSettled`, not `onSuccess`:
 * if the network call fails, the user still asked to sign out, and an app that
 * stays signed in because a request 500'd is a security surprise. The worst
 * case of clearing anyway is an un-revoked refresh token that expires on its
 * own; the worst case of NOT clearing is a session left open on a shared
 * machine.
 *
 * `queryClient.clear()` (not `invalidateQueries`) because every cached row
 * belongs to the account that is leaving. Invalidating would leave the previous
 * user's task titles on screen while the refetches 401 one by one.
 *
 * @param options.all revoke every device by bumping `tokenVersion`
 */
export function useLogout() {
  const queryClient = useQueryClient();
  const clearSession = useAuthStore((state) => state.clearSession);

  return useMutation({
    mutationFn: ({ all = false }: { all?: boolean } = {}) =>
      api.post<LogoutResponse>('/auth/logout', undefined, {
        query: all ? { all: 'true' } : {},
        schema: logoutResponseSchema,
      }),
    onSettled: () => {
      clearSession();
      queryClient.clear();
    },
  });
}

/**
 * `PATCH /auth/me` — name, avatar, locale. Answers the bare `User`.
 *
 * The session cache entry is PATCHED rather than replaced: `/auth/me` holds a
 * `MeResponse`, and this endpoint changes only its `user` half. Splicing keeps
 * the memberships the switcher is rendering instead of dropping them until the
 * next refetch.
 */
export function useUpdateMe() {
  const queryClient = useQueryClient();
  const setUser = useAuthStore((state) => state.setUser);
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (input: UpdateMeInput) =>
      api.patch<User>('/auth/me', input, { schema: userSchema }),
    onSuccess: (user) => {
      setUser(user);
      queryClient.setQueryData<MeResponse>(qk.auth.me(), (current) =>
        current ? { ...current, user, isGlobalAdmin: user.isGlobalAdmin } : current,
      );
    },
    onError,
  });
}

/**
 * `POST /auth/change-password`.
 *
 * ═══ THE RESPONSE IS A NEW SESSION, AND IT HAS TO BE STORED ════════════════
 *
 * Changing a password bumps the account's `tokenVersion`, which is what signs
 * every OTHER device out — and it would sign THIS one out too, because the
 * access and refresh tokens in the store were minted under the previous
 * version. The endpoint therefore answers with a freshly minted pair
 * (`loginResponseSchema`: user + accessToken + refreshToken), exactly so the
 * device that made the change can stay signed in.
 *
 * Discarding it (`api.post<void>`, as this did until WP5.6) does not fail
 * loudly: the toast says "saved", the page stays put, and the tokens in the
 * store are already dead. The user carries on until the access token expires,
 * at which point the refresh spends a token the server has revoked, the
 * single-flight refresh clears the session, and they are dumped on the login
 * screen minutes later with no connection to what they did.
 *
 * `setSession` rather than `setTokens`: the payload carries the user too, and
 * this genuinely is a new session — it bumps `sessionGeneration`, which
 * correctly discards any refresh still in flight against the old
 * `tokenVersion`.
 *
 * The cache is deliberately NOT cleared: the account is the same person, every
 * cached row still belongs to them, and clearing would blank the settings page
 * they are standing on.
 */
export function useChangePassword() {
  const onError = useApiErrorToast();
  const setSession = useAuthStore((state) => state.setSession);

  return useMutation({
    mutationFn: (input: ChangePasswordInput) =>
      api.post<LoginResponse>('/auth/change-password', input, { schema: loginResponseSchema }),
    onSuccess: (session) => {
      setSession(session);
    },
    onError,
  });
}

/**
 * Tears the session down from OUTSIDE React — the escape hatch `RequireAuth`
 * uses when `/auth/me` returns a terminal 401.
 *
 * It reaches for the module-scope query client rather than a hook's, because it
 * is called from a render path where a mutation would be the wrong tool: there
 * is nothing to send, only local state to drop.
 */
export function endSessionLocally(): void {
  useAuthStore.getState().clearSession();
  appQueryClient.clear();
}
