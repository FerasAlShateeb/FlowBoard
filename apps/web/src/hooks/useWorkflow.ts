import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';
import {
  statusSchema,
  transitionSchema,
  type CreateStatusInput,
  type DeleteStatusInput,
  type Status,
  type Transition,
  type TransitionEdge,
  type UpdateStatusInput,
  type Workflow,
} from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useProject } from '@/hooks/useProjects';
import { useApiErrorToast } from '@/i18n/errors';

/**
 * The per-project workflow: the board's columns (`statuses`) and the optional
 * whitelist of moves between them (`transitions`).
 *
 * WHERE THE DATA COMES FROM, and why it is split. `statuses` arrive on the
 * PROJECT DETAIL payload — the board has to have them before it can draw a
 * single column, so making it wait for a second request would put a frame of
 * empty board on screen every navigation. `transitions` do NOT: they are needed
 * only for drop styling and the settings editor, they are the larger of the two
 * (n² in the worst case), and a project with no restrictions has none at all.
 * So they get their own query, and `useWorkflow` recombines the halves for
 * callers that want the whole picture.
 *
 * EVERY MUTATION HERE INVALIDATES `qk.project.detail` — that is where the board
 * reads its columns from, so a status rename that refreshed only this hook's
 * own cache would leave the old name on the board until the next navigation.
 */

const transitionListSchema = z.array(transitionSchema);

// ───────────────────────────────────────────────────────────────────────────
// Queries
// ───────────────────────────────────────────────────────────────────────────

/**
 * The project's status columns, in board order.
 *
 * Read from the project detail rather than fetched: one payload, one cache
 * entry, no chance of the board and the editor disagreeing about the column
 * set. Sorted defensively by `position` — the API orders them, but a socket
 * patch or an optimistic edit could arrive out of order and a mis-sorted board
 * is a very confusing bug for a very cheap guard.
 */
export function useStatuses(projectId: string | null | undefined): {
  statuses: Status[];
  isPending: boolean;
  error: unknown;
} {
  const { data, isPending, error } = useProject(projectId);

  const statuses = useMemo(
    () => [...(data?.statuses ?? [])].sort((a, b) => a.position - b.position),
    [data?.statuses],
  );

  return { statuses, isPending, error };
}

/** `GET /projects/:projectId/transitions` — the whole set, or `[]` for "open". */
export function useTransitions(projectId: string | null | undefined): UseQueryResult<Transition[]> {
  return useQuery({
    queryKey: qk.project.transitions(projectId ?? ''),
    queryFn: ({ signal }) =>
      api.get(`/projects/${projectId ?? ''}/transitions`, {
        schema: transitionListSchema,
        signal,
      }),
    enabled: Boolean(projectId),
    staleTime: 2 * 60_000,
  });
}

/**
 * Both halves as one {@link Workflow} — what the settings editor loads and what
 * the board's forbidden-drop pre-check reads.
 *
 * `isPending` is true while EITHER half is loading, because a board that draws
 * its columns before it knows the transitions would show every drop as allowed
 * for a frame and then start refusing some.
 */
export function useWorkflow(projectId: string | null | undefined): {
  workflow: Workflow;
  isPending: boolean;
  error: unknown;
} {
  const { statuses, isPending: statusesPending, error: statusesError } = useStatuses(projectId);
  const {
    data: transitions,
    isPending: transitionsPending,
    error: transitionsError,
  } = useTransitions(projectId);

  const workflow = useMemo<Workflow>(
    () => ({ statuses, transitions: transitions ?? [] }),
    [statuses, transitions],
  );

  return {
    workflow,
    isPending: statusesPending || transitionsPending,
    error: statusesError ?? transitionsError,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Mutations
// ───────────────────────────────────────────────────────────────────────────

/**
 * The shared invalidation for every workflow write.
 *
 * Three targets, each for a different reason: the DETAIL carries the columns
 * the board draws, the TRANSITIONS entry carries the rules, and the TASK caches
 * carry cards whose `statusId` may have just been repointed by a status delete.
 */
function useWorkflowInvalidation(projectId: string): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.project.detail(projectId) });
    void queryClient.invalidateQueries({ queryKey: qk.project.transitions(projectId) });
    void queryClient.invalidateQueries({ queryKey: qk.tasks.all(projectId) });
  };
}

/** `POST /projects/:projectId/statuses` — appended at the end of the board. */
export function useCreateStatus(projectId: string) {
  const invalidate = useWorkflowInvalidation(projectId);
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (input: CreateStatusInput) =>
      api.post<Status>(`/projects/${projectId}/statuses`, input, { schema: statusSchema }),
    onSuccess: invalidate,
    onError,
  });
}

/** `PATCH /projects/:projectId/statuses/:statusId` — name, category, colour, WIP. */
export function useUpdateStatus(projectId: string) {
  const invalidate = useWorkflowInvalidation(projectId);
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: ({ statusId, ...input }: UpdateStatusInput & { statusId: string }) =>
      api.patch<Status>(`/projects/${projectId}/statuses/${statusId}`, input, {
        schema: statusSchema,
      }),
    onSuccess: invalidate,
    onError,
  });
}

/**
 * `DELETE /projects/:projectId/statuses/:statusId` with `{ moveTasksTo }` in
 * the BODY.
 *
 * A body, not a query param, because the destination is a DECISION about where
 * work goes rather than a filter on what is deleted — and because
 * `deleteStatusInputSchema` is a shared contract, so the same object shape is
 * validated at both ends. `lib/api`'s `del` sends a JSON body like any other
 * verb.
 *
 * The destination is REQUIRED by the UI even though it is optional on the wire
 * (the server only insists when the column still holds tasks): a column's tasks
 * have to go somewhere, and asking afterwards — "where did my twelve cards
 * go?" — is not a recoverable question.
 */
export function useDeleteStatus(projectId: string) {
  const invalidate = useWorkflowInvalidation(projectId);
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: ({ statusId, moveTasksTo }: DeleteStatusInput & { statusId: string }) =>
      api.del<void>(`/projects/${projectId}/statuses/${statusId}`, {
        body: { moveTasksTo } satisfies DeleteStatusInput,
      }),
    onSuccess: invalidate,
    onError,
  });
}

/**
 * `PUT /projects/:projectId/statuses/order` — the complete, ordered id list.
 *
 * OPTIMISTIC, because this is a drag: the column list must settle under the
 * pointer the moment it is dropped, not a round trip later. The rollback
 * restores the previous project detail wholesale — the payload is small and
 * splicing back a partial order is more code than it is worth.
 *
 * The server rejects a list that is not exactly the project's current status
 * set, so a concurrent column add cannot be silently dropped by a stale drag —
 * which is what makes the optimistic write safe to keep until the response
 * lands.
 */
export function useReorderStatuses(projectId: string) {
  const queryClient = useQueryClient();
  const invalidate = useWorkflowInvalidation(projectId);
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (statusIds: string[]) =>
      api.put<void>(`/projects/${projectId}/statuses/order`, { statusIds }),

    onMutate: async (statusIds) => {
      const key = qk.project.detail(projectId);
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueryData(key);

      queryClient.setQueryData(key, (current: unknown) => {
        if (!current || typeof current !== 'object') return current;
        const detail = current as { statuses?: Status[] };
        if (!detail.statuses) return current;

        // Rewrite `position` from the new order rather than only re-sorting the
        // array: everything downstream sorts by `position`, so an array whose
        // order and positions disagree would resolve differently per consumer.
        const byId = new Map(detail.statuses.map((status) => [status.id, status]));
        const reordered = statusIds
          .map((id, index) => {
            const status = byId.get(id);
            return status ? { ...status, position: index } : null;
          })
          .filter((status): status is Status => status !== null);

        return { ...detail, statuses: reordered };
      });

      return { snapshot, key };
    },

    onError: (error, _statusIds, context) => {
      if (context) queryClient.setQueryData(context.key, context.snapshot);
      onError(error);
    },

    onSuccess: invalidate,
  });
}

/**
 * `PUT /projects/:projectId/transitions` — replaces the ENTIRE set.
 *
 * A whole-set PUT is the only safe shape for a graph editor: a per-edge API
 * lets a half-applied burst leave a status whitelisted with a single
 * unreachable target, which is a workflow nobody can escape. An empty array
 * means "no restrictions anywhere".
 */
export function useReplaceTransitions(projectId: string) {
  const invalidate = useWorkflowInvalidation(projectId);
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (transitions: TransitionEdge[]) =>
      api.put<void>(`/projects/${projectId}/transitions`, { transitions }),
    onSuccess: invalidate,
    onError,
  });
}
