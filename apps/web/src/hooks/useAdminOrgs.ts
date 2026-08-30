import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { z } from 'zod';
import {
  orgAdminRowSchema,
  orgDetailSchema,
  orgWithRoleSchema,
  type CreateOrgInput,
  type OrgAdminRow,
  type OrgDetail,
  type OrgWithRole,
  type UpdateOrgInput,
} from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useApiErrorToast } from '@/i18n/errors';

/**
 * `/admin/orgs` — the ORGANIZATIONS CONSOLE's data layer.
 *
 * ═══ WHY THIS IS NOT `useOrgs` ════════════════════════════════════════════
 *
 * `useOrgs()` answers "which organizations does the signed-in person belong
 * to" — the switcher's question, cached under `qk.orgs.mine()` and read by the
 * sidebar, the home redirect and every client-side permission check. This module
 * answers a different one: "every organization in the deployment, ARCHIVED ONES
 * INCLUDED", which only a global admin may ask and which the restore flow
 * depends on. Two questions, two cache entries (`qk.adminOrgs.*`), so restoring
 * an org can never leave the switcher rendering a stale list — and a member's
 * switcher can never be hydrated out of an admin table.
 *
 * ═══ ONE ENDPOINT, TWO ROW SHAPES ═════════════════════════════════════════
 *
 * `GET /orgs` switches its payload on `includeDeleted` alone (see
 * `orgs.service.listOrgs`): with the flag it answers {@link OrgAdminRow}s —
 * `deletedAt` present, no `role` — and without it the ordinary
 * {@link OrgWithRole} rows. A table cannot render two shapes, so the flag-off
 * branch is WIDENED here, at the boundary, by parsing the narrow shape and
 * setting `deletedAt: null`. That is not a fiction: a row the endpoint returned
 * without the flag is by definition not archived.
 *
 * The alternative — always sending `includeDeleted=1` and filtering in the
 * browser — was rejected because it would make the "Show archived" toggle a
 * client-side lie, and because it asks the server for rows the operator did not
 * ask to see.
 *
 * ═══ WHY THE CREATE MUTATION LIVES HERE ══════════════════════════════════
 *
 * `useOrgs` used to carry a `useCreateOrg` that invalidated `qk.orgs.all()`
 * only, which does NOT reach `['admin','orgs']` — so a create fired through it
 * would leave this table showing a deployment without the org that was just
 * made. Every mutation below invalidates BOTH prefixes, plus `qk.instance.all()`
 * where the instance's own default organization can be affected. That hook had
 * no caller and W3.1 deleted it, so `POST /orgs` now has exactly one door.
 */

const adminRowListSchema = z.array(orgAdminRowSchema);
const liveRowListSchema = z.array(orgWithRoleSchema);

/** The two filters the console offers. Both are answered server-side. */
export interface AdminOrgFilters {
  /** Case-insensitive fragment of the org NAME or its SLUG. */
  q?: string;
  /** Global-admin only. Widens the list to soft-deleted organizations. */
  includeDeleted?: boolean;
}

/** A live `GET /orgs` row, widened to the admin table's shape. */
function widen(org: OrgWithRole): OrgAdminRow {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
    memberCount: org.memberCount,
    projectCount: org.projectCount,
    // Not a guess: the endpoint only returns live rows without the flag.
    deletedAt: null,
  };
}

/**
 * Filters as the key factory and the query string both want them.
 *
 * `includeDeleted: false` is DROPPED rather than sent as `false`: an absent flag
 * and a false one are the same request, and letting them differ would mint two
 * cache entries for one result.
 */
function filterRecord(filters: AdminOrgFilters): Record<string, string | boolean | undefined> {
  const q = filters.q?.trim();
  return {
    ...(q === undefined || q === '' ? {} : { q }),
    ...(filters.includeDeleted === true ? { includeDeleted: true } : {}),
  };
}

/**
 * `GET /orgs?q&includeDeleted` — every organization, name-ordered by the server.
 *
 * UNPAGINATED, because the endpoint is: it answers a plain array with no `meta`
 * block. The page slices and sorts what it renders (see `AdminOrgsPage`), which
 * is honest for a list whose realistic ceiling is a few hundred rows and whose
 * `q` is already server-side.
 */
export function adminOrgsQueryOptions(filters: AdminOrgFilters) {
  const query = filterRecord(filters);
  const includeDeleted = filters.includeDeleted === true;

  return queryOptions({
    queryKey: qk.adminOrgs.list(query),
    queryFn: async ({ signal }): Promise<OrgAdminRow[]> => {
      if (includeDeleted) {
        return api.get('/orgs', { schema: adminRowListSchema, query, signal });
      }
      const live = await api.get('/orgs', { schema: liveRowListSchema, query, signal });
      return live.map(widen);
    },
    staleTime: 10_000,
  });
}

export function useAdminOrgs(filters: AdminOrgFilters): UseQueryResult<OrgAdminRow[]> {
  return useQuery(adminOrgsQueryOptions(filters));
}

/**
 * Everything an organization mutation can have invalidated.
 *
 * Four prefixes, and each one is a bug that has been shipped without it: the
 * admin table (this module), the switcher's list, the cross-org projects
 * overview (archiving an org archives its projects as far as a reader is
 * concerned) and the instance config (single mode resolves `/` through an org
 * that may have just been archived or renamed).
 */
function useOrgInvalidator(): () => void {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.adminOrgs.all() });
    void queryClient.invalidateQueries({ queryKey: qk.orgs.all() });
    void queryClient.invalidateQueries({ queryKey: qk.adminProjects.all() });
    void queryClient.invalidateQueries({ queryKey: qk.instance.all() });
  };
}

/** `POST /orgs` — global admin. The caller becomes the new org's first admin. */
export function useCreateAdminOrg() {
  const invalidate = useOrgInvalidator();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (input: CreateOrgInput) =>
      api.post<OrgDetail>('/orgs', input, { schema: orgDetailSchema }),
    onSuccess: invalidate,
    onError,
  });
}

/**
 * `PATCH /orgs/:orgId` — rename or re-slug.
 *
 * Takes the id PER CALL rather than per hook (the shape `useOrgs.useUpdateOrg`
 * uses): a table's rename dialog is one component that edits whichever row's
 * menu opened it, and a hook bound to an id at mount would have to be remounted
 * — and its mutation state reset — on every open.
 */
export function useUpdateAdminOrg() {
  const invalidate = useOrgInvalidator();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: ({ orgId, input }: { orgId: string; input: UpdateOrgInput }) =>
      api.patch<OrgDetail>(`/orgs/${orgId}`, input, { schema: orgDetailSchema }),
    onSuccess: invalidate,
    onError,
  });
}

/**
 * `DELETE /orgs/:orgId` — the SOFT delete the console calls "archive".
 *
 * Deliberately NOT `useOrgs.useDeleteOrg`, which drops the entire query cache:
 * that is right for a page that is about to navigate away from an org it was
 * inside, and wrong here — the admin stays on a table that would then have to
 * re-request everything it is still looking at. Archiving is reversible
 * ({@link useRestoreOrg}), so the correct blast radius is the four prefixes
 * above.
 */
export function useArchiveOrg() {
  const invalidate = useOrgInvalidator();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (orgId: string) => api.del<void>(`/orgs/${orgId}`),
    onSuccess: invalidate,
    onError,
  });
}

/**
 * `POST /orgs/:orgId/restore` — un-archive, answering the restored ADMIN row.
 *
 * NO DEFAULT `onError`. Restore has one failure the operator can actually act
 * on — **409 `org_slug_conflict`**, meaning another organization took the slug
 * while this one was archived — and the remedy ("rename the live one, or
 * re-slug this one") is not something a generic toast can say. The page supplies
 * its own handler; adding one here too would raise two toasts for one failure.
 */
export function useRestoreOrg() {
  const invalidate = useOrgInvalidator();

  return useMutation({
    mutationFn: (orgId: string) =>
      api.post<OrgAdminRow>(`/orgs/${orgId}/restore`, undefined, { schema: orgAdminRowSchema }),
    onSuccess: invalidate,
  });
}

/** The envelope code a restore answers when the slug is no longer free. */
export const ORG_SLUG_CONFLICT_CODE = 'org_slug_conflict';
