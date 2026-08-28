import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  acceptInviteResponseSchema,
  invitePreviewSchema,
  type AcceptInviteInput,
  type AcceptInviteResponse,
  type InvitePreview,
} from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useAuthStore } from '@/stores/useAuthStore';
import { useApiErrorToast } from '@/i18n/errors';

/**
 * The invite flow — the only way an account is born besides admin
 * provisioning.
 *
 * TWO CALLERS, ONE ENDPOINT. `POST /auth/invites/:token/accept` takes a
 * discriminated union:
 *
 *   - `mode: 'register'` — an anonymous visitor creating the account the invite
 *     is for. The email comes from the invite row unless the link is UNLOCKED
 *     (`invites.email IS NULL`), which is the one case the body may supply one.
 *   - `mode: 'attach'`   — a signed-in user adding an org to their account. The
 *     body carries nothing; identity comes from the Authorization header.
 *
 * THE TWO ANSWER THE SAME SHAPE — `acceptInviteResponseSchema`, a login
 * response plus `orgId`/`projectId`. `attach` gets a token pair too, and that
 * is not redundancy: the caller's existing access token was minted before this
 * org grant, so its claims are stale the moment the grant lands. One schema,
 * parsed once, and the mode only decides what the hook DOES with it.
 */

/**
 * `GET /auth/invites/:token` — the UNAUTHENTICATED preview the landing page
 * renders before asking for anything.
 *
 * `retry: false` because every failure here is terminal and each one has its
 * own copy: the token is wrong, expired, or already redeemed. Retrying an
 * expired invite just delays the explanation.
 */
export function useInvitePreview(token: string | undefined): UseQueryResult<InvitePreview> {
  return useQuery({
    queryKey: qk.auth.invite(token ?? ''),
    queryFn: ({ signal }) =>
      api.get(`/auth/invites/${token ?? ''}`, { schema: invitePreviewSchema, signal }),
    enabled: Boolean(token),
    retry: false,
    // A preview is a snapshot of a one-shot token: refetching it on window
    // focus would be pure noise, and could flip the page to "already used"
    // between the user reading it and submitting.
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** What acceptance produced, plus which of the two ways it happened. */
export interface AcceptInviteResult {
  mode: AcceptInviteInput['mode'];
  session: AcceptInviteResponse;
}

/**
 * `POST /auth/invites/:token/accept`.
 *
 * ON `register` the returned session REPLACES whatever was there: the user has
 * an account now, and making them sign in with credentials they typed thirty
 * seconds ago would be theatre. The cache is cleared because nothing in it
 * belongs to a session that did not exist a moment ago.
 *
 * ON `attach` the tokens are ALSO stored, but the cache is invalidated rather
 * than cleared: the caller is the same person with the same rows, they just
 * gained an org. The fresh pair matters because the old one predates the grant.
 * `/auth/me` is invalidated alongside `/orgs` — it is the payload the org
 * switcher reads its memberships from, and the new org is exactly what is
 * missing from it.
 */
export function useAcceptInvite(token: string) {
  const queryClient = useQueryClient();
  const setSession = useAuthStore((state) => state.setSession);
  const onError = useApiErrorToast();

  return useMutation<AcceptInviteResult, unknown, AcceptInviteInput>({
    mutationFn: async (input) => {
      const session = await api.post<AcceptInviteResponse>(`/auth/invites/${token}/accept`, input, {
        schema: acceptInviteResponseSchema,
      });
      return { mode: input.mode, session };
    },

    onSuccess: (result) => {
      setSession(result.session);

      if (result.mode === 'register') {
        queryClient.clear();
        return;
      }
      void queryClient.invalidateQueries({ queryKey: qk.auth.me() });
      void queryClient.invalidateQueries({ queryKey: qk.orgs.all() });
    },

    onError,
  });
}
