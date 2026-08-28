/**
 * Request schemas for the attachment routes.
 *
 * The 25 MB ceiling is enforced by the shared `fileSizeSchema` at BOTH ends of
 * the flow — at presign, where it decides whether a URL is issued at all, and
 * again at confirm, because a presign is a permission to upload rather than a
 * promise about what was uploaded.
 *
 * WP2.3's local `confirmAttachmentBodySchema` (which additionally accepted the
 * `attachmentId` the presign hands back) was promoted into the shared
 * `confirmAttachmentInputSchema` by WP2.5, along with `attachmentId` on the
 * presign response — the web upload hook sends and receives both.
 */
import { z } from 'zod';
import { uuid } from '@flowboard/shared';

export {
  confirmAttachmentInputSchema,
  presignAttachmentInputSchema,
  presignAttachmentResponseSchema,
} from '@flowboard/shared';

export type {
  ConfirmAttachmentInput,
  PresignAttachmentInput,
  PresignAttachmentResponse,
} from '@flowboard/shared';

/** Legacy alias — WP2.3's name for what is now the shared confirm contract. */
export { confirmAttachmentInputSchema as confirmAttachmentBodySchema } from '@flowboard/shared';
export type { ConfirmAttachmentInput as ConfirmAttachmentBody } from '@flowboard/shared';

export const taskAttachmentsParamsSchema = z.object({ taskId: uuid });
export type TaskAttachmentsParams = z.infer<typeof taskAttachmentsParamsSchema>;

export const attachmentParamsSchema = z.object({ attachmentId: uuid });
export type AttachmentParams = z.infer<typeof attachmentParamsSchema>;
