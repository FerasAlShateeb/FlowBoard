import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';
import {
  attachmentSchema,
  attachmentUrlSchema,
  presignAttachmentResponseSchema,
  type Attachment,
  type AttachmentUrl,
  type PresignAttachmentResponse,
} from '@flowboard/shared';

import { ApiError, api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useApiErrorToast } from '@/i18n/errors';

/**
 * Attachments — the three-step MinIO/S3 upload.
 *
 *   1. `POST /tasks/:taskId/attachments/presign` → `{ uploadUrl, s3Key }`
 *   2. the browser PUTs the bytes STRAIGHT TO MinIO at `uploadUrl`
 *   3. `POST /tasks/:taskId/attachments` confirms the key and writes the row
 *
 * The file bytes never touch the API process: no request-size ceiling to raise,
 * no memory spike per upload, and the API stays a small stateless container.
 *
 * WHY STEP 2 USES `XMLHttpRequest` AND NOT `fetch`. `fetch` still has no upload
 * progress event — `ReadableStream` request bodies are the standard answer and
 * are not usable here (they require HTTP/2 and are unsupported in Safari), so a
 * 20 MB attachment would show a spinner and nothing else for thirty seconds.
 * XHR's `upload.onprogress` is the only portable source of a real percentage,
 * and this is the one place in the app that reaches past `lib/api.ts` — which
 * is correct in any case, because the request goes to MinIO, carries no bearer
 * token, and must NOT have one attached.
 */

const attachmentListSchema = z.array(attachmentSchema);

/** `GET /tasks/:taskId/attachments`. */
export function useAttachments(taskId: string | null | undefined): UseQueryResult<Attachment[]> {
  return useQuery({
    queryKey: qk.task.attachments(taskId ?? ''),
    queryFn: ({ signal }) =>
      api.get(`/tasks/${taskId ?? ''}/attachments`, { schema: attachmentListSchema, signal }),
    enabled: Boolean(taskId),
  });
}

/** What the upload mutation takes: the file, and where to report progress. */
export interface UploadAttachmentInput {
  file: File;
  /** Called with 0–100 as the bytes go out. Optional; omit for a plain spinner. */
  onProgress?: (percent: number) => void;
  /** Aborts the transfer — wire this to a cancel button. */
  signal?: AbortSignal;
}

/**
 * PUTs a file to a presigned URL, reporting progress.
 *
 * Rejects with an {@link ApiError} shaped like every other failure in the app,
 * so the shared toast helper localizes it without a special case. `upload_failed`
 * is a code the `errors` catalog carries.
 *
 * EXPORTED FOR ITS OWN SUITE. It is the only state machine in the app built on
 * raw XHR — four terminal transitions (load-2xx, load-non-2xx, error, abort)
 * plus a pre-aborted signal — and reaching all five through `useMutation` would
 * mean rendering a provider to assert something with no React in it.
 */
export function putToStorage(
  uploadUrl: string,
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', uploadUrl, true);
    // The presigned URL was signed for this exact content type; sending a
    // different one (or none) makes the signature check fail at MinIO.
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(100);
        resolve();
        return;
      }
      reject(new ApiError('The upload was rejected by storage.', request.status, 'upload_failed'));
    };

    request.onerror = () => {
      reject(new ApiError('The upload could not reach storage.', 0, 'storage_unavailable'));
    };

    request.onabort = () => {
      // Mirrors what `fetch` does on abort, so TanStack Query's cancellation
      // handling recognises it rather than treating it as a real failure.
      reject(new DOMException('Upload aborted', 'AbortError'));
    };

    if (signal) {
      if (signal.aborted) {
        request.abort();
        return;
      }
      signal.addEventListener('abort', () => {
        request.abort();
      });
    }

    request.send(file);
  });
}

/**
 * The whole upload, as one mutation.
 *
 * ORPHAN RISK, ACCEPTED DELIBERATELY (`attachments.schema.ts`): step 2 can
 * succeed while step 3 never arrives, leaving an object in the bucket with no
 * row pointing at it. An orphan blob is cheap and a lifecycle rule sweeps it; a
 * row with no object is a broken download link, which is visible. So the order
 * is bytes-then-row, never the reverse.
 *
 * @example
 *   const upload = useUploadAttachment(taskId);
 *   upload.mutate({ file, onProgress: setPercent });
 */
export function useUploadAttachment(taskId: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: async ({ file, onProgress, signal }: UploadAttachmentInput) => {
      const presigned = await api.post<PresignAttachmentResponse>(
        `/tasks/${taskId}/attachments/presign`,
        {
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        },
        { schema: presignAttachmentResponseSchema, signal },
      );

      await putToStorage(presigned.uploadUrl, file, onProgress, signal);

      // The metadata is re-sent so the server persists it without a HEAD round
      // trip — and re-validated, because a presign is not a promise about what
      // was actually uploaded.
      return api.post<Attachment>(
        `/tasks/${taskId}/attachments`,
        {
          s3Key: presigned.s3Key,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        },
        { schema: attachmentSchema, signal },
      );
    },

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.task.attachments(taskId) });
      // `attachmentCount` lives on the task detail.
      void queryClient.invalidateQueries({ queryKey: qk.task.detail(taskId) });
    },
    onError,
  });
}

/**
 * `GET /attachments/:attachmentId/url` — a short-lived presigned GET.
 *
 * A MUTATION, not a query, even though it only reads: the URL expires, so
 * caching it under a query key would hand a user a dead link the second time
 * they clicked. Minting one on demand is the only correct shape.
 */
export function useAttachmentUrl() {
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (attachmentId: string) =>
      api.get<AttachmentUrl>(`/attachments/${attachmentId}/url`, {
        schema: attachmentUrlSchema,
      }),
    onError,
  });
}

/** `DELETE /attachments/:attachmentId`. */
export function useDeleteAttachment(taskId: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (attachmentId: string) => api.del<void>(`/attachments/${attachmentId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.task.attachments(taskId) });
      void queryClient.invalidateQueries({ queryKey: qk.task.detail(taskId) });
    },
    onError,
  });
}
