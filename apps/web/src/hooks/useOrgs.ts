import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';
import {
  inviteSchema,
  orgDetailSchema,
  orgMemberSchema,
  orgUserSchema,
  orgWithRoleSchema,
  type AddMemberInput,
  type CreateInviteInput,
  type Invite,
  type OrgDetail,
  type OrgMember,
  type OrgRole,
  type OrgUser,
  type OrgWithRole,
  type UpdateOrgInput,
} from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useApiErrorToast } from '@/i18n/errors';
import { useAuthStore } from '@/stores/useAuthStore';

/**
 * Organization data: the list you belong to, one org's detail, its members, its
 * user directory, and its invites.
 *
 * EVERY RESPONSE IS ZOD-PARSED at the boundary, via `lib/api`'s `schema`
 * option — the project's "zod at every boundary, both ends" rule. A server that
 * drifts from the contract fails at the fetch, with the offending field named,
 * rather than three components deep in a render.
 *
 * EVERY MUTATION INVALIDATES BY PREFIX rather than by exact key. `qk.orgs.all()`
 * reaches the list, the detail, the members and the invites in one call, and it
 * keeps working when a later wave adds another org-scoped query — which
 * enumerating exact keys would not.
 */

const orgListSchema = z.array(orgWithRoleSchema);
const memberListSchema = z.array(orgMemberSchema);
const userListSchema = z.array(orgUserSchema);
const inviteListSchema = z.array(inviteSchema);

// ───────────────────────────────────────────────────────────────────────────
// Queries
// ───────────────────────────────────────────────────────────────────────────

/**
 * `GET /orgs` — every organization the signed-in user belongs to, each with
 * their own role in it.
 *
 * This is the org switcher's source, the root redirect's source, and the
 * permission input for "may I create a project here". It is small, changes
 * rarely, and is needed by the shell on every page, so it carries a longer
 * `staleTime` than the app default.
 *
 * ═══ `?scope=member` — WHAT "VIEW AS MEMBER" DOES TO THIS QUERY ════════════
 *
 * `GET /orgs` has a global-admin branch: an admin gets EVERY organization on
 * the instance, not only the ones they belong to. That is right for an admin
 * and wrong for the preview — an admin checking "what does a member see" would
 * otherwise get a switcher listing the whole platform, which is the one thing a
 * member never sees. So member view asks the server to answer as a member.
 *
 * The request is a NARROWING and never a widening, so honouring it costs no
 * security: `scope=member` can only remove rows. It also degrades cleanly while
 * W1.1 is still landing the parameter — an unknown query param is ignored, and
 * the shell renders the admin's own list until it is not.
 *
 * The scope is part of the CACHE KEY, appended to `qk.orgs.mine()` rather than
 * folded into it (the key factory is a frozen stitch file this round). The
 * prefix is unchanged, so every existing `invalidateQueries({ queryKey:
 * qk.orgs.mine() })` and `qk.orgs.all()` still reaches both entries — and
 * flipping the switch swaps lists instead of showing the previous one until a
 * refetch lands.
 */
export function useOrgs(): UseQueryResult<OrgWithRole[]> {
  // The REAL flag: a non-admin's list is already member-scoped, so sending the
  // parameter for them would be a second cache entry holding identical rows.
  const asMember = useAuthStore((state) => state.isGlobalAdmin() && state.viewingAsMember);

  return useQuery({
    queryKey: [...qk.orgs.mine(), asMember ? 'member' : 'all'],
    queryFn: ({ signal }) =>
      api.get('/orgs', {
        schema: orgListSchema,
        query: asMember ? { scope: 'member' } : {},
        signal,
      }),
    staleTime: 5 * 60_000,
  });
}

/**
 * How many organizations the switcher will filter in the browser.
 *
 * Below this the whole list is already cached, so `ui/command`'s matcher costs
 * nothing and never flickers. Above it the list stops being something you
 * scroll — and a forty-org instance is an ADMIN's instance, where the switcher
 * is a search box, not a menu.
 */
export const ORG_SERVER_SEARCH_THRESHOLD = 20;

/**
 * `GET /orgs?q=` — the switcher's server-side search, for large instances.
 *
 * Its own cache entry per needle (the key carries `q`), deliberately: it is a
 * transient answer to one popover session, and letting it share
 * `qk.orgs.mine()` would make the org switcher overwrite the list the sidebar,
 * the home redirect and every permission check read.
 *
 * `enabled` is the caller's, because below the threshold this hook must not run
 * at all. It also degrades: W1.1 adds the `q` parameter, and until it lands an
 * unknown query param is simply ignored and the full list comes back — which
 * the switcher renders unfiltered rather than empty.
 *
 * ═══ IT CARRIES `scope` FOR THE SAME REASON `useOrgs` DOES (R2 W3.5) ═══════
 *
 * This is the OTHER half of the org switcher, and it was answering a different
 * question. `useOrgs` sends `?scope=member` while an admin is previewing member
 * view, so the switcher lists only the orgs they belong to; `useOrgsSearch` sent
 * no scope, so on an instance past {@link ORG_SERVER_SEARCH_THRESHOLD} — the
 * only instances where this hook runs at all — typing into the switcher
 * refilled it with EVERY organization on the platform. The preview leaked
 * exactly the thing it exists to hide, and only on the large instances where an
 * admin would notice least.
 *
 * The flag is read the same way (`isGlobalAdmin() && viewingAsMember`, so a
 * non-admin never spends a second cache entry on identical rows) and the scope
 * is appended to the key the same way, so the two entries cannot cross-fill.
 */
export function useOrgsSearch(
  search: string,
  options: { enabled?: boolean } = {},
): UseQueryResult<OrgWithRole[]> {
  const asMember = useAuthStore((state) => state.isGlobalAdmin() && state.viewingAsMember);
  const q = search.trim();

  return useQuery({
    queryKey: [...qk.orgs.mine(), 'search', q, asMember ? 'member' : 'all'],
    queryFn: ({ signal }) =>
      api.get('/orgs', {
        schema: orgListSchema,
        query: {
          ...(q ? { q } : {}),
          ...(asMember ? { scope: 'member' } : {}),
        },
        signal,
      }),
    enabled: options.enabled ?? true,
    staleTime: 60_000,
  });
}

/**
 * The org whose slug is in the URL, resolved from the list rather than fetched.
 *
 * `/o/:orgSlug` gives a SLUG but every API path below it takes an ID, so
 * something has to bridge the two. Doing it from the already-loaded list means
 * a project page needs one fewer request, and it means an unknown slug is
 * answerable immediately (`found: false`) instead of after a 404.
 */
export function useOrgBySlug(orgSlug: string | null): {
  org: OrgWithRole | null;
  isPending: boolean;
  error: unknown;
} {
  const { data, isPending, error } = useOrgs();
  const org = orgSlug === null ? null : (data?.find((entry) => entry.slug === orgSlug) ?? null);
  return { org, isPending, error };
}

/**
 * `GET /orgs/:orgId` — one organization, with the caller's role and all three
 * counts.
 *
 * `orgDetailSchema`, not `orgWithRoleSchema`: the single-org endpoint also
 * carries `teamCount`, which the list endpoint deliberately does not (a
 * subquery per switcher row for a number the switcher never shows). Parsing
 * with the narrower schema silently DROPPED it — zod objects strip unknown
 * keys, so the org home page's team tile was reading a field that had been
 * thrown away one layer down.
 */
export function useOrg(orgId: string | null | undefined): UseQueryResult<OrgDetail> {
  return useQuery({
    queryKey: qk.orgs.detail(orgId ?? ''),
    queryFn: ({ signal }) => api.get(`/orgs/${orgId ?? ''}`, { schema: orgDetailSchema, signal }),
    enabled: Boolean(orgId),
  });
}

/** `GET /orgs/:orgId/members` — the membership table. */
export function useOrgMembers(orgId: string | null | undefined): UseQueryResult<OrgMember[]> {
  return useQuery({
    queryKey: qk.orgs.members(orgId ?? ''),
    queryFn: ({ signal }) =>
      api.get(`/orgs/${orgId ?? ''}/members`, { schema: memberListSchema, signal }),
    enabled: Boolean(orgId),
  });
}

/**
 * `GET /orgs/:orgId/users` — the directory behind every person picker and the
 * @mention autocomplete.
 *
 * Separate from the members list even though the rows are nearly identical: a
 * picker asks "who can I choose" and re-asks it on every keystroke with a
 * search term, while the members table asks "who is in this org" once. Sharing
 * one cache entry would make the table flicker as someone typed in a dropdown.
 */
export function useOrgUsers(
  orgId: string | null | undefined,
  search?: string,
): UseQueryResult<OrgUser[]> {
  const q = search?.trim() ?? '';
  return useQuery({
    queryKey: qk.orgs.users(orgId ?? '', q),
    queryFn: ({ signal }) =>
      api.get(`/orgs/${orgId ?? ''}/users`, {
        schema: userListSchema,
        query: q ? { q } : {},
        signal,
      }),
    enabled: Boolean(orgId),
    // A directory is stable within a session; re-fetching it per popover open
    // is pure latency for no new information.
    staleTime: 5 * 60_000,
  });
}

/** `GET /orgs/:orgId/invites` — pending links, admin-only. */
export function useOrgInvites(
  orgId: string | null | undefined,
  options: { enabled?: boolean } = {},
): UseQueryResult<Invite[]> {
  return useQuery({
    queryKey: qk.orgs.invites(orgId ?? ''),
    queryFn: ({ signal }) =>
      api.get(`/orgs/${orgId ?? ''}/invites`, { schema: inviteListSchema, signal }),
    enabled: Boolean(orgId) && (options.enabled ?? true),
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Mutations
// ───────────────────────────────────────────────────────────────────────────

/**
 * `POST /orgs` LIVES IN `useAdminOrgs.useCreateAdminOrg`, NOT HERE.
 *
 * A `useCreateOrg` used to sit at this spot and had no caller at all — no UI
 * could create an organization. Round 2's admin Organizations page gave the
 * endpoint its first real consumer, and that consumer needs a cache
 * invalidation this hook never did: `qk.orgs.all()` alone does not reach
 * `['admin','orgs']` or `qk.instance.all()`, so a create fired from here would
 * leave the admin table showing a deployment without the org just made. W3.1
 * deleted the dead hook rather than leave two doors onto one endpoint, one of
 * which quietly lies to the console.
 */

/** `PATCH /orgs/:orgId` — rename or re-slug. */
export function useUpdateOrg(orgId: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (input: UpdateOrgInput) =>
      api.patch<OrgDetail>(`/orgs/${orgId}`, input, { schema: orgDetailSchema }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.orgs.all() });
    },
    onError,
  });
}

/**
 * `DELETE /orgs/:orgId` — global-admin only, and irreversible.
 *
 * The whole cache is dropped rather than invalidated: every project, board and
 * task key still sitting in it belonged to an org that no longer exists, and
 * invalidating would send a burst of requests that all 404.
 */
export function useDeleteOrg() {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (orgId: string) => api.del<void>(`/orgs/${orgId}`),
    onSuccess: () => {
      queryClient.clear();
    },
    onError,
  });
}

/**
 * `POST /orgs/:orgId/members` — add an existing account to the org.
 *
 * The body names the person by `userId` XOR `email` (shared
 * `addMemberInputSchema`): the members screen matches on the address an admin
 * already has in an email thread, and resolving it client-side would need a
 * lookup endpoint that leaks whether an address has an account.
 */
export function useAddOrgMember(orgId: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (input: AddMemberInput) =>
      api.post<OrgMember>(`/orgs/${orgId}/members`, input, { schema: orgMemberSchema }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.orgs.all() });
    },
    onError,
  });
}

/** `PATCH /orgs/:orgId/members/:userId` — promote or demote. */
export function useUpdateOrgMember(orgId: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: OrgRole }) =>
      api.patch<OrgMember>(
        `/orgs/${orgId}/members/${userId}`,
        { role },
        { schema: orgMemberSchema },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.orgs.all() });
    },
    onError,
  });
}

/**
 * `DELETE /orgs/:orgId/members/:userId`.
 *
 * The whole org prefix is invalidated, not just the member list: removing
 * someone changes the org's member count on the picker card, may change what
 * the caller sees if they removed THEMSELVES, and drops them from every project
 * roster in the org.
 */
export function useRemoveOrgMember(orgId: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (userId: string) => api.del<void>(`/orgs/${orgId}/members/${userId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.orgs.all() });
    },
    onError,
  });
}

/** `POST /orgs/:orgId/invites` — mint a link. The token is returned once. */
export function useCreateInvite(orgId: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (input: CreateInviteInput) =>
      api.post<Invite>(`/orgs/${orgId}/invites`, input, { schema: inviteSchema }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.orgs.invites(orgId) });
    },
    onError,
  });
}

/** `DELETE /orgs/:orgId/invites/:inviteId` — the link stops working at once. */
export function useRevokeInvite(orgId: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (inviteId: string) => api.del<void>(`/orgs/${orgId}/invites/${inviteId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.orgs.invites(orgId) });
    },
    onError,
  });
}

/**
 * The absolute URL an invite token is redeemed at — what the admin copies.
 *
 * Built from `window.location.origin` rather than a configured base URL because
 * the link has to work for whoever receives it, which means the host the admin
 * is actually using, not the one an env var was set to at build time.
 */
export function inviteLink(token: string): string {
  return `${window.location.origin}/invite/${token}`;
}
