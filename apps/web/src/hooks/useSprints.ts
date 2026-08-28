import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';
import {
  sprintSchema,
  type CompleteSprintInput,
  type CreateSprintInput,
  type Sprint,
  type SprintState,
  type StartSprintInput,
  type UpdateSprintInput,
} from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useApiErrorToast } from '@/i18n/errors';

/**
 * Sprints — the scrum cycle (plan → start → complete) and the two point stamps
 * that make velocity meaningful.
 *
 * EVERY MUTATION INVALIDATES THE TASK CACHES TOO, which is easy to forget and
 * always wrong to omit: starting a sprint does not change any task row, but
 * completing one MOVES every unfinished task out of it, and creating one adds a
 * bucket the backlog has to render. The sprint list and the backlog are two
 * views of the same planning state.
 */

const sprintListSchema = z.array(sprintSchema);

/** `GET /projects/:projectId/sprints?state=` — the backlog page's sprint list. */
export function useSprints(
  projectId: string | null | undefined,
  state?: SprintState,
): UseQueryResult<Sprint[]> {
  return useQuery({
    queryKey: qk.sprints.list(projectId ?? '', state),
    queryFn: ({ signal }) =>
      api.get(`/projects/${projectId ?? ''}/sprints`, {
        schema: sprintListSchema,
        query: state ? { state } : {},
        signal,
      }),
    enabled: Boolean(projectId),
  });
}

/**
 * The one running sprint, derived from the list rather than fetched.
 *
 * A project has at most one `active` sprint — enforced by a partial unique
 * index, not by hope — so this is a `find`, and it costs no extra request on a
 * page that already has the list.
 */
export function useActiveSprint(projectId: string | null | undefined): {
  sprint: Sprint | null;
  isPending: boolean;
} {
  const { data, isPending } = useSprints(projectId);
  return { sprint: data?.find((entry) => entry.state === 'active') ?? null, isPending };
}

/** Invalidates everything a sprint change can reach. */
function useSprintInvalidation(projectId: string): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.sprints.all(projectId) });
    void queryClient.invalidateQueries({ queryKey: qk.tasks.all(projectId) });
    // Velocity and burndown both read sprint stamps.
    void queryClient.invalidateQueries({ queryKey: qk.reports.all(projectId) });
  };
}

/** `POST /projects/:projectId/sprints` — creates in the `planned` state. */
export function useCreateSprint(projectId: string) {
  const invalidate = useSprintInvalidation(projectId);
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (input: CreateSprintInput) =>
      api.post<Sprint>(`/projects/${projectId}/sprints`, input, { schema: sprintSchema }),
    onSuccess: invalidate,
    onError,
  });
}

/**
 * `PATCH /sprints/:sprintId` — name, goal, planned dates.
 *
 * A sprint is addressed GLOBALLY by its id once it exists, like a task: only
 * the collection (`/projects/:projectId/sprints`) hangs off the project,
 * because that is the scope a sprint is created in. `projectId` is still a hook
 * argument — it is what the invalidation targets, not part of the URL.
 */
export function useUpdateSprint(projectId: string) {
  const invalidate = useSprintInvalidation(projectId);
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: ({ sprintId, ...input }: UpdateSprintInput & { sprintId: string }) =>
      api.patch<Sprint>(`/sprints/${sprintId}`, input, {
        schema: sprintSchema,
      }),
    onSuccess: invalidate,
    onError,
  });
}

/** `DELETE /sprints/:sprintId` — its tasks fall to the backlog. */
export function useDeleteSprint(projectId: string) {
  const invalidate = useSprintInvalidation(projectId);
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (sprintId: string) => api.del<void>(`/sprints/${sprintId}`),
    onSuccess: invalidate,
    onError,
  });
}

/**
 * `POST /sprints/:sprintId/start` — stamps `committedPoints` from the scope at
 * this instant, which is what makes velocity a fact rather than a moving
 * target. Fails if another sprint is already active.
 */
export function useStartSprint(projectId: string) {
  const invalidate = useSprintInvalidation(projectId);
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: ({ sprintId, ...input }: StartSprintInput & { sprintId: string }) =>
      api.post<Sprint>(`/sprints/${sprintId}/start`, input, {
        schema: sprintSchema,
      }),
    onSuccess: invalidate,
    onError,
  });
}

/**
 * `POST /sprints/:sprintId/complete` — stamps `completedPoints` and relocates
 * every task that is not in a `done` status.
 *
 * `moveIncompleteTo` is required by the contract: `'backlog'` clears
 * `sprint_id`, a uuid moves them into that planned sprint. There is no "leave
 * them here" option, deliberately — that is what keeps a completed sprint's
 * numbers immutable.
 */
export function useCompleteSprint(projectId: string) {
  const invalidate = useSprintInvalidation(projectId);
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: ({ sprintId, ...input }: CompleteSprintInput & { sprintId: string }) =>
      api.post<Sprint>(`/sprints/${sprintId}/complete`, input, {
        schema: sprintSchema,
      }),
    onSuccess: invalidate,
    onError,
  });
}
