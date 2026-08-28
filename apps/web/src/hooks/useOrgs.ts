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
  type CreateOrgInput,
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
 */
export function useOrgs(): UseQueryResult<OrgWithRole[]> {
  return useQuery({
    queryKey: qk.orgs.mine(),
    queryFn: ({ signal }) => api.get('/orgs', { schema: orgListSchema, signal }),
    staleTime: 5 * 60_000,
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

/** `POST /orgs` — the creator becomes its first admin. */
export function useCreateOrg() {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (input: CreateOrgInput) =>
      api.post<OrgDetail>('/orgs', input, { schema: orgDetailSchema }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.orgs.all() });
    },
    onError,
  });
}

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
