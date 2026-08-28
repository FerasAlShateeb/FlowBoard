import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';
import { commentSchema, type Comment } from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useApiErrorToast } from '@/i18n/errors';

/**
 * Task comments.
 *
 * MENTIONS ARE NOT A PARAMETER. A comment body is markdown with
 * `@[Name](userId)` encoded inline, and the SERVER derives the notification
 * recipients from the stored body (`extractMentionUserIds`). So nothing here
 * sends a recipient list: editing a mention out of a comment stops notifying,
 * and a hand-crafted request cannot notify someone the body never named.
 *
 * `commentCount` lives on the task detail, so every write invalidates that too
 * — otherwise the sheet's "3 comments" tab label drifts from the thread under
 * it.
 */

const commentListSchema = z.array(commentSchema);

/** `GET /tasks/:taskId/comments` — oldest first, as a thread reads. */
export function useComments(taskId: string | null | undefined): UseQueryResult<Comment[]> {
  return useQuery({
    queryKey: qk.task.comments(taskId ?? ''),
    queryFn: ({ signal }) =>
      api.get(`/tasks/${taskId ?? ''}/comments`, { schema: commentListSchema, signal }),
    enabled: Boolean(taskId),
  });
}

/** Refreshes the thread and the count the task detail carries. */
function useCommentInvalidation(taskId: string): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.task.comments(taskId) });
    void queryClient.invalidateQueries({ queryKey: qk.task.detail(taskId) });
  };
}

/** `POST /tasks/:taskId/comments`. */
export function useCreateComment(taskId: string) {
  const invalidate = useCommentInvalidation(taskId);
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (body: string) =>
      api.post<Comment>(`/tasks/${taskId}/comments`, { body }, { schema: commentSchema }),
    onSuccess: invalidate,
    onError,
  });
}

/**
 * `PATCH /comments/:commentId` — author-only; stamps `editedAt`.
 *
 * Addressed by comment id alone: an edit does not need to know which task the
 * comment hangs off, and the server resolves the project through
 * comment → task → project to run the guard. `taskId` is still a hook argument
 * because it is the thread cache the write invalidates.
 */
export function useUpdateComment(taskId: string) {
  const invalidate = useCommentInvalidation(taskId);
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
      api.patch<Comment>(`/comments/${commentId}`, { body }, { schema: commentSchema }),
    onSuccess: invalidate,
    onError,
  });
}

/**
 * `DELETE /tasks/:taskId/comments/:commentId`.
 *
 * Optimistic: the comment is on screen and the user asked for it to go. The
 * rollback restores the exact thread snapshot, which is safe here because a
 * comment delete cascades to nothing.
 */
export function useDeleteComment(taskId: string) {
  const queryClient = useQueryClient();
  const invalidate = useCommentInvalidation(taskId);
  const onError = useApiErrorToast();
  const key = qk.task.comments(taskId);

  return useMutation({
    mutationFn: (commentId: string) => api.del<void>(`/comments/${commentId}`),

    onMutate: async (commentId) => {
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueryData<Comment[]>(key);
      queryClient.setQueryData<Comment[]>(key, (current) =>
        current?.filter((comment) => comment.id !== commentId),
      );
      return { snapshot };
    },

    onError: (error, _commentId, context) => {
      if (context) queryClient.setQueryData(key, context.snapshot);
      onError(error);
    },

    onSuccess: invalidate,
  });
}
