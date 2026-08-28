import { useMutation, useQueryClient } from '@tanstack/react-query';
import { taskSchema, type CreateDependencyInput, type Task } from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useApiErrorToast } from '@/i18n/errors';

/**
 * Task dependencies — the `blocks` relationship.
 *
 * NEITHER WRITE IS OPTIMISTIC, and the reason is the cycle check. The server
 * walks the dependency graph inside the write transaction and refuses anything
 * that would close a loop; only it can answer that. Painting the link first
 * would mean showing an edge that is about to be rejected roughly as often as
 * a user reaches for a dependency they should not have — which is exactly when
 * the honest answer matters most.
 *
 * Like watchers, there is no list query: `taskSchema.dependencies` already
 * carries both directions (`blockers` block this task, `blocked` are blocked by
 * it), expanded as `TaskRef`s the section renders directly.
 */

/**
 * A dependency touches TWO tasks, so both details are invalidated: adding
 * "A blocks B" changes A's `blocked` array and B's `blockers` array, and the
 * other task's sheet may be open in another tab of the same session.
 */
/** Whichever end of the edge is NOT `:taskId` — the input carries exactly one. */
function otherTaskIdOf(input: CreateDependencyInput): string {
  return input.blockerTaskId ?? input.blockedTaskId ?? '';
}

function useDependencyInvalidation(): (taskId: string, otherTaskId: string) => void {
  const queryClient = useQueryClient();
  return (taskId, otherTaskId) => {
    void queryClient.invalidateQueries({ queryKey: qk.task.detail(taskId) });
    void queryClient.invalidateQueries({ queryKey: qk.task.detail(otherTaskId) });
  };
}

/**
 * `POST /tasks/:taskId/dependencies` — declare a `blocks` edge in EITHER
 * direction.
 *
 * ONE ENDPOINT, ONE ROW: "A blocks B" and "B is blocked by A" are the same row
 * read from two ends, so a second endpoint would be a second way to write the
 * same edge — and a second place to get the cycle check wrong. But the
 * DIRECTION is named in the body rather than expressed by re-targeting the POST
 * at the other task: `{ blockerTaskId }` means "that one blocks this one",
 * `{ blockedTaskId }` means "this one blocks that one". Exactly one, enforced by
 * the shared `createDependencyInputSchema`.
 *
 * The section offers both, and a caller that had to flip which task it POSTed
 * to in order to say the second one would eventually flip it the wrong way and
 * write a real, wrong edge.
 */
export function useAddDependency(taskId: string) {
  const invalidate = useDependencyInvalidation();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (input: CreateDependencyInput) =>
      api.post<Task>(`/tasks/${taskId}/dependencies`, input, { schema: taskSchema }),
    onSuccess: (_result, input) => {
      invalidate(taskId, otherTaskIdOf(input));
    },
    onError,
  });
}

/**
 * `DELETE /tasks/:taskId/dependencies/:otherTaskId`.
 *
 * The OTHER TASK's id, not the dependency row's: `taskSchema.dependencies`
 * expands each edge as a `TaskRef`, whose `id` is the task, so the row id is
 * something this hook has never seen. Direction does not enter the address
 * either — the pair is unique, so "unlink these two" is unambiguous whichever
 * list the user clicked from.
 */
export function useRemoveDependency(taskId: string) {
  const invalidate = useDependencyInvalidation();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (otherTaskId: string) =>
      api.del<void>(`/tasks/${taskId}/dependencies/${otherTaskId}`),
    onSuccess: (_result, otherTaskId) => {
      invalidate(taskId, otherTaskId);
    },
    onError,
  });
}
