/**
 * Attachment routes. Mount at the API root:
 * `apiRouter.use('/', attachmentsRouter)`.
 *
 * `/presign` is declared BEFORE the confirm route on the same path prefix —
 * Express matches in declaration order, and `/tasks/:taskId/attachments` would
 * otherwise never be reached for a POST to `…/attachments/presign`.
 *
 * Downloading is a read (`viewer`); uploading is a write (`member`). Deletion
 * has a further uploader-or-admin rule that needs the row, so it lives in the
 * service.
 */
import { Router } from 'express';

import {
  confirmTaskAttachment,
  getTaskAttachmentUrl,
  listTaskAttachments,
  presignTaskAttachment,
  removeTaskAttachment,
} from '../controllers/attachments.controller';
import { requireAuth } from '../middlewares/require-auth';
import { requireProjectRole } from '../middlewares/require-roles';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import {
  attachmentParamsSchema,
  confirmAttachmentBodySchema,
  presignAttachmentInputSchema,
  taskAttachmentsParamsSchema,
} from '../validation/attachments.validation';

export const attachmentsRouter: Router = Router();

// Scoped to the prefixes this router owns — see `tasks.routes.ts` for why a
// root-stacked router must not guard paths it does not answer.
attachmentsRouter.use(['/tasks/:taskId/attachments', '/attachments'], requireAuth);

attachmentsRouter.post(
  '/tasks/:taskId/attachments/presign',
  validate(taskAttachmentsParamsSchema, 'params'),
  requireProjectRole('member', 'taskId'),
  validate(presignAttachmentInputSchema),
  asyncHandler(presignTaskAttachment),
);

attachmentsRouter.get(
  '/tasks/:taskId/attachments',
  validate(taskAttachmentsParamsSchema, 'params'),
  requireProjectRole('viewer', 'taskId'),
  asyncHandler(listTaskAttachments),
);

attachmentsRouter.post(
  '/tasks/:taskId/attachments',
  validate(taskAttachmentsParamsSchema, 'params'),
  requireProjectRole('member', 'taskId'),
  validate(confirmAttachmentBodySchema),
  asyncHandler(confirmTaskAttachment),
);

attachmentsRouter.get(
  '/attachments/:attachmentId/url',
  validate(attachmentParamsSchema, 'params'),
  requireProjectRole('viewer', 'attachmentId'),
  asyncHandler(getTaskAttachmentUrl),
);

attachmentsRouter.delete(
  '/attachments/:attachmentId',
  validate(attachmentParamsSchema, 'params'),
  requireProjectRole('member', 'attachmentId'),
  asyncHandler(removeTaskAttachment),
);
