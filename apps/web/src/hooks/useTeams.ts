import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';
import {
  teamDetailSchema,
  teamSchema,
  type CreateTeamInput,
  type Team,
  type TeamDetail,
  type UpdateTeamInput,
} from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useApiErrorToast } from '@/i18n/errors';

/**
 * Teams — an org's grouping layer.
 *
 * Worth remembering while reading: a team is NOT a permission boundary
 * (`teams.schema.ts`). A project may name an owning team for filtering and
 * reporting, but access is still decided by `project_members` plus the
 * org-admin widening rule. So nothing here invalidates project membership.
 *
 * The roster is replaced WHOLESALE (`PUT …/members`) rather than diffed with
 * add/remove calls: the editor is a multi-select that produces a final set, and
 * one idempotent request beats a partially-applied burst.
 */

const teamListSchema = z.array(teamSchema);

/** `GET /orgs/:orgId/teams`. */
export function useTeams(orgId: string | null | undefined): UseQueryResult<Team[]> {
  return useQuery({
    queryKey: qk.orgs.teams(orgId ?? ''),
    queryFn: ({ signal }) =>
      api.get(`/orgs/${orgId ?? ''}/teams`, { schema: teamListSchema, signal }),
    enabled: Boolean(orgId),
  });
}

/** `GET /orgs/:orgId/teams/:teamId` — the team plus its roster. */
export function useTeam(
  orgId: string | null | undefined,
  teamId: string | null | undefined,
): UseQueryResult<TeamDetail> {
  return useQuery({
    queryKey: qk.orgs.team(orgId ?? '', teamId ?? ''),
    queryFn: ({ signal }) =>
      api.get(`/orgs/${orgId ?? ''}/teams/${teamId ?? ''}`, {
        schema: teamDetailSchema,
        signal,
      }),
    enabled: Boolean(orgId) && Boolean(teamId),
  });
}

/** `POST /orgs/:orgId/teams`. */
export function useCreateTeam(orgId: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (input: CreateTeamInput) =>
      api.post<Team>(`/orgs/${orgId}/teams`, input, { schema: teamSchema }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.orgs.teams(orgId) });
    },
    onError,
  });
}

/** `PATCH /orgs/:orgId/teams/:teamId`. */
export function useUpdateTeam(orgId: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: ({ teamId, ...input }: UpdateTeamInput & { teamId: string }) =>
      api.patch<Team>(`/orgs/${orgId}/teams/${teamId}`, input, { schema: teamSchema }),
    onSuccess: (_team, variables) => {
      void queryClient.invalidateQueries({ queryKey: qk.orgs.teams(orgId) });
      void queryClient.invalidateQueries({ queryKey: qk.orgs.team(orgId, variables.teamId) });
    },
    onError,
  });
}

/**
 * `DELETE /orgs/:orgId/teams/:teamId`.
 *
 * The org prefix is invalidated rather than just the team list, because a
 * project that named this team as its owner now shows none — and that project
 * detail is cached elsewhere in the tree.
 */
export function useDeleteTeam(orgId: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (teamId: string) => api.del<void>(`/orgs/${orgId}/teams/${teamId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.orgs.all() });
    },
    onError,
  });
}

/**
 * `PUT /orgs/:orgId/teams/:teamId/members` — replace the roster.
 *
 * An empty array is legal and means "no members", which is why the input is not
 * validated for length here: `replaceTeamMembersInputSchema` deliberately
 * allows it, and a team that has just lost its last member is a real state.
 */
export function useReplaceTeamMembers(orgId: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: ({ teamId, userIds }: { teamId: string; userIds: string[] }) =>
      api.put<TeamDetail>(
        `/orgs/${orgId}/teams/${teamId}/members`,
        { userIds },
        { schema: teamDetailSchema },
      ),
    onSuccess: (team, variables) => {
      queryClient.setQueryData(qk.orgs.team(orgId, variables.teamId), team);
      // The card in the grid shows a member count, which just changed.
      void queryClient.invalidateQueries({ queryKey: qk.orgs.teams(orgId) });
    },
    onError,
  });
}
